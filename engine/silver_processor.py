"""
FMD v3 Engine — Local Silver Processor with SCD Type 2.

Replicates NB_FMD_LOAD_BRONZE_SILVER logic in pure Python:
    Bronze Delta → SCD Type 2 change detection → Silver Delta.

SCD Type 2 columns:
    IsCurrent (bool)       — True for the latest version of each record
    RecordStartDate (ts)   — When this version became effective
    RecordEndDate (ts)     — When this version was superseded (9999-12-31 for current)
    RecordModifiedDate (ts)— Last modification timestamp
    IsDeleted (bool)       — Soft delete flag (True if record was removed from source)
"""

import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

import polars as pl

from engine.models import SilverEntity, EngineConfig, RunResult
from engine.auth import TokenProvider
from engine.onelake_io import OneLakeIO

log = logging.getLogger("fmd.silver")

_FAR_FUTURE = datetime(9999, 12, 31, tzinfo=timezone.utc)
_SCD_COLUMNS = ["IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "IsDeleted"]


# ---------------------------------------------------------------------------
# Pure transformation functions (stateless, testable)
# ---------------------------------------------------------------------------

def add_scd_columns(df: pl.DataFrame) -> pl.DataFrame:
    """Add SCD Type 2 columns to incoming data (new records).

    Matches notebook lines 813-818.
    """
    now = datetime.now(timezone.utc)
    return df.with_columns(
        pl.lit(True).alias("IsCurrent"),
        pl.lit(now).alias("RecordStartDate"),
        pl.lit(now).alias("RecordModifiedDate"),
        pl.lit(_FAR_FUTURE).alias("RecordEndDate"),
        pl.lit(False).alias("IsDeleted"),
    )


def detect_changes(
    existing: pl.DataFrame,
    incoming: pl.DataFrame,
) -> Tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame, pl.DataFrame]:
    """Detect inserts, updates, and soft deletes for SCD Type 2.

    Returns (inserts, updates_new, updates_old, deletes) — four DataFrames.

    Logic (matches notebook lines 920-1076):
        - inserts: rows in incoming but NOT in existing (by PK hash)
        - updates_new: rows where PK exists but content hash changed → new version
        - updates_old: matching old versions → mark IsCurrent=False, set RecordEndDate
        - deletes: rows in existing (IsCurrent=True, IsDeleted=False) but NOT in incoming
    """
    now = datetime.now(timezone.utc)

    # Filter existing to current, non-deleted rows only
    current_existing = existing.filter(
        (pl.col("IsCurrent") == True) & (pl.col("IsDeleted") == False)
    )
    existing_pks = current_existing["HashedPKColumn"]
    incoming_pks = incoming["HashedPKColumn"]

    # --- Inserts: in incoming but not in existing ---
    inserts = incoming.filter(~pl.col("HashedPKColumn").is_in(existing_pks.to_list()))
    inserts = add_scd_columns(inserts)

    # --- Find matched rows (same PK) ---
    matched = current_existing.join(
        incoming.select(["HashedPKColumn", "HashedNonKeyColumns"]),
        on="HashedPKColumn",
        how="inner",
        suffix="_incoming",
    )

    # --- Updates: PK exists but content hash changed ---
    changed = matched.filter(
        pl.col("HashedNonKeyColumns") != pl.col("HashedNonKeyColumns_incoming")
    )
    changed_pks_list = changed["HashedPKColumn"].to_list() if len(changed) > 0 else []

    # updates_old: existing rows being superseded
    updates_old = current_existing.filter(
        pl.col("HashedPKColumn").is_in(changed_pks_list)
    ).with_columns(
        pl.lit(False).alias("IsCurrent"),
        pl.lit(now - timedelta(milliseconds=1)).alias("RecordEndDate"),
        pl.lit(now).alias("RecordModifiedDate"),
    )

    # updates_new: incoming rows replacing the old versions
    updates_new = incoming.filter(
        pl.col("HashedPKColumn").is_in(changed_pks_list)
    )
    updates_new = add_scd_columns(updates_new)

    # --- Soft deletes: in existing but not in incoming ---
    deletes = current_existing.filter(
        ~pl.col("HashedPKColumn").is_in(incoming_pks.to_list())
    ).with_columns(
        pl.lit(False).alias("IsCurrent"),
        pl.lit(True).alias("IsDeleted"),
        pl.lit(now).alias("RecordEndDate"),
        pl.lit(now).alias("RecordModifiedDate"),
    )

    return inserts, updates_new, updates_old, deletes


# ---------------------------------------------------------------------------
# Silver Processor class
# ---------------------------------------------------------------------------

class SilverProcessor:
    """Process entities from Bronze Delta → Silver Delta with SCD Type 2.

    Usage::

        sp = SilverProcessor(config, token_provider)
        result = sp.process_entity(entity, run_id)
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._io = OneLakeIO(config, token_provider)

    def process_entity(self, entity: SilverEntity, run_id: str) -> RunResult:
        """Process a single entity: Bronze Delta → Silver Delta with SCD Type 2.

        Steps:
        1. Read Bronze Delta table
        2. Read existing Silver Delta table (if any)
        3. If no Silver exists → initial load with SCD columns
        4. If Silver exists → detect changes → union change sets → overwrite
        """
        t0 = time.perf_counter()
        workspace_id = entity.workspace_guid or self._config.workspace_data_id

        log.info("[%s] Silver: processing entity %d (%s.%s)",
                 run_id[:8], entity.silver_entity_id, entity.namespace, entity.source_name)

        # Step 1: Read Bronze Delta
        bronze_df = self._io.read_delta(workspace_id, entity.bronze_delta_path)
        if bronze_df is None or len(bronze_df) == 0:
            return RunResult(
                entity_id=entity.silver_entity_id,
                layer="silver",
                status="skipped",
                error="No data in Bronze Delta table",
                error_suggestion="Ensure Bronze has been loaded first.",
            )

        rows_read = len(bronze_df)

        # Step 2: Read existing Silver
        silver_df = self._io.read_delta(workspace_id, entity.delta_table_path)

        if silver_df is None:
            # Step 3: First load — add SCD columns and write
            log.info("[%s] Silver %s: first load, adding SCD columns to %d rows",
                     run_id[:8], entity.source_name, rows_read)
            result_df = add_scd_columns(bronze_df)
        else:
            # Step 4: Detect changes and merge
            inserts, updates_new, updates_old, deletes = detect_changes(silver_df, bronze_df)

            insert_count = len(inserts)
            update_count = len(updates_new)
            delete_count = len(deletes)

            log.info("[%s] Silver %s: %d inserts, %d updates, %d deletes",
                     run_id[:8], entity.source_name, insert_count, update_count, delete_count)

            if insert_count == 0 and update_count == 0 and delete_count == 0:
                elapsed = time.perf_counter() - t0
                return RunResult(
                    entity_id=entity.silver_entity_id,
                    layer="silver",
                    status="succeeded",
                    rows_read=rows_read,
                    rows_written=0,
                    duration_seconds=round(elapsed, 2),
                )

            # Build the new Silver table:
            # Keep all historical rows + unchanged current rows, add changes
            unchanged = silver_df.filter(
                ~pl.col("HashedPKColumn").is_in(
                    pl.concat([updates_old.select("HashedPKColumn"),
                               deletes.select("HashedPKColumn")], how="vertical_relaxed")["HashedPKColumn"]
                ) | (pl.col("IsCurrent") == False)
            )

            parts = [unchanged, inserts, updates_new, updates_old, deletes]
            parts = [p for p in parts if len(p) > 0]
            result_df = pl.concat(parts, how="diagonal_relaxed")

        # Write Silver Delta table
        success = self._io.write_delta(workspace_id, entity.delta_table_path, result_df, mode="overwrite")
        elapsed = time.perf_counter() - t0

        if not success:
            return RunResult(
                entity_id=entity.silver_entity_id,
                layer="silver",
                status="failed",
                rows_read=rows_read,
                duration_seconds=round(elapsed, 2),
                error="Failed to write Delta table to Silver lakehouse",
            )

        return RunResult(
            entity_id=entity.silver_entity_id,
            layer="silver",
            status="succeeded",
            rows_read=rows_read,
            rows_written=len(result_df),
            duration_seconds=round(elapsed, 2),
        )
