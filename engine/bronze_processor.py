"""
FMD v3 Engine — Local Bronze Processor.

Replicates NB_FMD_LOAD_LANDING_BRONZE logic in pure Python:
    LZ Parquet → hash PKs → deduplicate → change-detect → Delta merge → Bronze lakehouse.

Uses polars for DataFrame operations and deltalake for Delta table I/O.
"""

import logging
import time
from datetime import datetime, timezone
from typing import List, Optional

import polars as pl

from engine.models import BronzeEntity, EngineConfig, RunResult
from engine.auth import TokenProvider, SCOPE_ONELAKE
from engine.onelake_io import OneLakeIO

log = logging.getLogger("fmd.bronze")


# ---------------------------------------------------------------------------
# Pure transformation functions (stateless, testable)
# ---------------------------------------------------------------------------

def clean_column_names(df: pl.DataFrame) -> pl.DataFrame:
    """Strip whitespace from column names (matches notebook line 548)."""
    rename_map = {c: c.strip() for c in df.columns if c != c.strip()}
    return df.rename(rename_map) if rename_map else df


def hash_pk_columns(df: pl.DataFrame, pk_columns: list[str]) -> pl.DataFrame:
    """Add HashedPKColumn — hash of PK columns concatenated with ||.

    If no valid PKs found in the DataFrame, falls back to hashing ALL columns.
    Matches notebook lines 595-596.
    """
    # Filter to PK columns that actually exist in the DataFrame
    valid_pks = [c for c in pk_columns if c in df.columns]
    if not valid_pks:
        valid_pks = df.columns  # fallback: all columns

    # Concatenate PKs with || separator, cast all to string first
    concat_expr = pl.concat_str(
        [pl.col(c).cast(pl.Utf8).fill_null("") for c in valid_pks],
        separator="||",
    )
    return df.with_columns(
        concat_expr.hash(seed=0, seed_1=1, seed_2=2, seed_3=3)
        .cast(pl.Utf8)
        .alias("HashedPKColumn")
    )


def deduplicate(df: pl.DataFrame) -> pl.DataFrame:
    """Remove duplicate rows by HashedPKColumn. Matches notebook lines 617-619."""
    return df.unique(subset=["HashedPKColumn"], keep="first")


def hash_non_key_columns(df: pl.DataFrame, pk_columns: list[str]) -> pl.DataFrame:
    """Add HashedNonKeyColumns — hash of all non-PK columns for change detection.

    Matches notebook lines 925-932.
    """
    non_key = [c for c in df.columns
               if c not in pk_columns and c not in ("HashedPKColumn", "HashedNonKeyColumns", "RecordLoadDate")]
    if not non_key:
        non_key = [c for c in df.columns if c != "HashedPKColumn"]

    concat_expr = pl.concat_str(
        [pl.col(c).cast(pl.Utf8).fill_null("") for c in non_key],
        separator="||",
    )
    return df.with_columns(
        concat_expr.hash(seed=10, seed_1=11, seed_2=12, seed_3=13)
        .cast(pl.Utf8)
        .alias("HashedNonKeyColumns")
    )


def add_record_load_date(df: pl.DataFrame) -> pl.DataFrame:
    """Add RecordLoadDate timestamp column."""
    return df.with_columns(
        pl.lit(datetime.now(timezone.utc)).alias("RecordLoadDate")
    )


# ---------------------------------------------------------------------------
# Bronze Processor class
# ---------------------------------------------------------------------------

class BronzeProcessor:
    """Process entities from Landing Zone parquet → Bronze Delta tables.

    Usage::

        bp = BronzeProcessor(config, token_provider)
        result = bp.process_entity(entity, run_id)
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._io = OneLakeIO(config, token_provider)
        self._token_provider = token_provider

    def process_entity(self, entity: BronzeEntity, run_id: str) -> RunResult:
        """Process a single entity: LZ parquet → Bronze Delta table.

        Steps:
        1. Read parquet from LZ lakehouse
        2. Clean column names
        3. Hash PKs → HashedPKColumn
        4. Deduplicate on PK hash
        5. Hash non-PKs → HashedNonKeyColumns
        6. Add RecordLoadDate
        7. Delta merge (or initial write) to Bronze lakehouse
        """
        t0 = time.perf_counter()
        workspace_id = entity.workspace_guid or self._config.workspace_data_id

        log.info("[%s] Bronze: processing entity %d (%s.%s)",
                 run_id[:8], entity.bronze_entity_id, entity.namespace, entity.source_name)

        # Step 1: Read LZ parquet
        df = self._io.read_parquet(workspace_id, entity.lz_parquet_path)
        if df is None or len(df) == 0:
            return RunResult(
                entity_id=entity.bronze_entity_id,
                layer="bronze",
                status="skipped",
                error="No data in LZ parquet file",
                error_suggestion="Ensure Landing Zone has been loaded first.",
            )

        rows_read = len(df)

        # Steps 2-6: Transform
        df = clean_column_names(df)
        df = hash_pk_columns(df, entity.pk_columns)
        df = deduplicate(df)
        df = hash_non_key_columns(df, entity.pk_columns)
        df = add_record_load_date(df)

        rows_after_dedup = len(df)

        # Step 7: Write to Bronze Delta table
        table_path = entity.delta_table_path
        existing = self._io.read_delta(workspace_id, table_path)

        if existing is None:
            # First load — write directly
            log.info("[%s] Bronze %s: first load, writing %d rows",
                     run_id[:8], entity.source_name, len(df))
            success = self._io.write_delta(workspace_id, table_path, df, mode="overwrite")
        else:
            # Merge: insert new + update changed + delete missing (full load only)
            df = self._merge_bronze(existing, df, entity.is_incremental)
            log.info("[%s] Bronze %s: merged, writing %d rows",
                     run_id[:8], entity.source_name, len(df))
            success = self._io.write_delta(workspace_id, table_path, df, mode="overwrite")

        elapsed = time.perf_counter() - t0

        if not success:
            return RunResult(
                entity_id=entity.bronze_entity_id,
                layer="bronze",
                status="failed",
                rows_read=rows_read,
                duration_seconds=round(elapsed, 2),
                error="Failed to write Delta table to Bronze lakehouse",
            )

        return RunResult(
            entity_id=entity.bronze_entity_id,
            layer="bronze",
            status="succeeded",
            rows_read=rows_read,
            rows_written=rows_after_dedup,
            duration_seconds=round(elapsed, 2),
        )

    def _merge_bronze(
        self, existing: pl.DataFrame, incoming: pl.DataFrame, is_incremental: bool
    ) -> pl.DataFrame:
        """Merge incoming data with existing Bronze Delta table.

        Full load: incoming IS the truth — just return it (overwrite).
        Incremental: insert new + update changed (no deletes).
        """
        # Ensure both DataFrames have HashedPKColumn
        if "HashedPKColumn" not in existing.columns:
            return incoming  # existing table has no hash — just overwrite

        if is_incremental:
            # Keep all existing rows, update/insert from incoming
            matched = existing.join(
                incoming.select(["HashedPKColumn", "HashedNonKeyColumns"]),
                on="HashedPKColumn",
                how="left",
                suffix="_new",
            )
            changed_pks = matched.filter(
                pl.col("HashedNonKeyColumns_new").is_not_null()
                & (pl.col("HashedNonKeyColumns") != pl.col("HashedNonKeyColumns_new"))
            )["HashedPKColumn"]

            existing_pks = existing["HashedPKColumn"]
            new_rows = incoming.filter(~pl.col("HashedPKColumn").is_in(existing_pks))

            unchanged = existing.filter(~pl.col("HashedPKColumn").is_in(changed_pks))
            updated = incoming.filter(pl.col("HashedPKColumn").is_in(changed_pks))

            result = pl.concat([unchanged, updated, new_rows], how="diagonal_relaxed")
            return result
        else:
            # Full load — incoming IS the truth, just return it
            return incoming
