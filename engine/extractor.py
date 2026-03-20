"""
FMD v3 Engine — Data extraction from source SQL servers.

Reads data via pyodbc, converts to Polars DataFrame, writes to Parquet bytes.
Handles:
  - Full loads (SELECT * FROM ...)
  - Incremental loads (WHERE watermark_col > last_value)
  - Chunked reads for large tables (>chunk_rows threshold)
  - SourceName whitespace stripping (caused 55% of v2 LZ failures)
  - Exclusion of rowversion/timestamp columns from comparison
"""

import io
import logging
import time
from datetime import datetime
from typing import Optional

import polars as pl
import pyodbc

from engine.connections import SourceConnection
from engine.models import EngineConfig, Entity, RunResult, LogEnvelope

log = logging.getLogger("fmd.extractor")

# Column types that cannot be compared as varchar — exclude from watermark reads
# FIXED: CRITICAL BUG #8 — Extended list to include geometry, geography, xml, hierarchyid, sql_variant
_BINARY_TYPE_NAMES = frozenset({
    "timestamp", "rowversion", "binary", "varbinary", "image",
    "geometry", "geography", "xml", "hierarchyid", "sql_variant"
})


class DataExtractor:
    """Extract data from on-prem SQL servers into Parquet byte buffers.

    Usage::

        extractor = DataExtractor(config, source_conn)
        parquet_bytes, result = extractor.extract(entity)
        if result.succeeded:
            # parquet_bytes is ready for OneLake upload
    """

    def __init__(self, config: EngineConfig, source_conn: SourceConnection):
        self._config = config
        self._source = source_conn

    def extract(
        self,
        entity: Entity,
        run_id: str = "",
    ) -> tuple[Optional[bytes], RunResult]:
        """Extract data for a single entity and return (parquet_bytes, result).

        Parameters
        ----------
        entity : Entity
            The entity to extract.
        run_id : str
            Current run ID for logging.

        Returns
        -------
        tuple[Optional[bytes], RunResult]
            Parquet bytes (None on failure) and a RunResult with metrics.
        """
        t0 = time.perf_counter()
        source_name = entity.source_name.strip()  # CRITICAL: whitespace fix

        if not source_name:
            return None, RunResult(
                entity_id=entity.id,
                layer="landing",
                status="failed",
                error="Empty SourceName after stripping whitespace",
                error_suggestion="Check integration.LandingzoneEntity.SourceName — it's blank or whitespace-only.",
            )

        query, params = entity.build_source_query()
        log.info(
            "[%s] Extracting entity %d: %s.%s from %s/%s (incremental=%s)",
            run_id[:8] if run_id else "?",
            entity.id,
            entity.source_schema,
            source_name,
            entity.source_server,
            entity.source_database,
            entity.is_incremental,
        )

        try:
            with self._source.connect(
                entity.source_server, entity.source_database
            ) as conn:
                cursor = conn.cursor()
                cursor.execute(query, params)

                if not cursor.description:
                    elapsed = time.perf_counter() - t0
                    return None, RunResult(
                        entity_id=entity.id,
                        layer="landing",
                        status="succeeded",
                        rows_read=0,
                        rows_written=0,
                        duration_seconds=round(elapsed, 2),
                    )

                col_names = [desc[0] for desc in cursor.description]
                col_types = {
                    desc[0]: desc[1].__name__ if hasattr(desc[1], "__name__") else str(desc[1])
                    for desc in cursor.description
                }

                # Filter out binary/rowversion columns that break downstream
                safe_indices = []
                safe_names = []
                for i, name in enumerate(col_names):
                    type_name = col_types.get(name, "").lower()
                    if type_name not in _BINARY_TYPE_NAMES:
                        safe_indices.append(i)
                        safe_names.append(name)

                # Read in chunks for large tables
                all_rows: list[tuple] = []
                while True:
                    batch = cursor.fetchmany(self._config.chunk_rows)
                    if not batch:
                        break
                    # Filter columns per row
                    if len(safe_indices) < len(col_names):
                        batch = [
                            tuple(row[i] for i in safe_indices) for row in batch
                        ]
                    all_rows.extend(batch)

                rows_read = len(all_rows)

                if rows_read == 0:
                    elapsed = time.perf_counter() - t0

                    # FIXED: CRITICAL BUG #10 — Distinguish empty table from missing table
                    # If we got here, the query executed successfully but returned 0 rows
                    # This is legitimate for incremental loads (no new data since last watermark)
                    # OR for empty source tables (which is also OK)
                    # Log this for operator awareness
                    if entity.is_incremental:
                        log.info(
                            "[%s] Entity %d (incremental): Query returned 0 rows "
                            "(no data since watermark %s)",
                            run_id[:8] if run_id else "?",
                            entity.id,
                            entity.last_load_value,
                        )
                    else:
                        log.warning(
                            "[%s] Entity %d (full load): Query returned 0 rows "
                            "(table may be empty). Verify table exists: %s",
                            run_id[:8] if run_id else "?",
                            entity.id,
                            entity.qualified_name,
                        )

                    return None, RunResult(
                        entity_id=entity.id,
                        layer="landing",
                        status="succeeded",
                        rows_read=0,
                        rows_written=0,
                        duration_seconds=round(elapsed, 2),
                        watermark_before=entity.last_load_value,
                        watermark_after=entity.last_load_value,
                        error_suggestion=(
                            "No rows extracted. "
                            "For incremental loads this is OK (no new data since last watermark). "
                            "For full loads, verify the source table is not empty."
                        ),
                    )

                # Build Polars DataFrame — handle type coercion gracefully
                df = self._rows_to_dataframe(safe_names, all_rows)

                # Compute new watermark value if incremental
                new_watermark = self._compute_watermark(entity, df)

                # Write to Parquet in memory
                parquet_buf = io.BytesIO()
                df.write_parquet(parquet_buf, compression="snappy")
                parquet_bytes = parquet_buf.getvalue()

                elapsed = time.perf_counter() - t0
                log.info(
                    "[%s] Entity %d extracted: %d rows, %.1f KB, %.1fs",
                    run_id[:8] if run_id else "?",
                    entity.id,
                    rows_read,
                    len(parquet_bytes) / 1024,
                    elapsed,
                )

                return parquet_bytes, RunResult(
                    entity_id=entity.id,
                    layer="landing",
                    status="succeeded",
                    rows_read=rows_read,
                    rows_written=rows_read,
                    bytes_transferred=len(parquet_bytes),
                    duration_seconds=round(elapsed, 2),
                    watermark_before=entity.last_load_value,
                    watermark_after=new_watermark,
                )

        except pyodbc.Error as exc:
            elapsed = time.perf_counter() - t0
            error_msg = str(exc)
            suggestion = self._diagnose_error(error_msg, entity)
            log.error(
                "[%s] Entity %d extraction failed: %s", run_id[:8] if run_id else "?", entity.id, error_msg
            )
            return None, RunResult(
                entity_id=entity.id,
                layer="landing",
                status="failed",
                duration_seconds=round(elapsed, 2),
                error=error_msg,
                error_suggestion=suggestion,
            )

        except Exception as exc:
            elapsed = time.perf_counter() - t0
            log.error(
                "[%s] Entity %d unexpected error: %s", run_id[:8] if run_id else "?", entity.id, exc,
                exc_info=True,
            )
            return None, RunResult(
                entity_id=entity.id,
                layer="landing",
                status="failed",
                duration_seconds=round(elapsed, 2),
                error=str(exc),
                error_suggestion="Unexpected error during extraction. Check the stack trace in the engine logs.",
            )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _rows_to_dataframe(col_names: list[str], rows: list[tuple]) -> pl.DataFrame:
        """Convert raw pyodbc rows to a Polars DataFrame.

        Handles mixed types gracefully by casting everything to string
        for columns that have type conflicts (common with SQL Server
        sql_variant or columns with NULLs alongside non-NULL values).
        """
        # Build column-oriented data
        col_data: dict[str, list] = {name: [] for name in col_names}
        for row in rows:
            for i, name in enumerate(col_names):
                col_data[name].append(row[i])

        # Let Polars infer types — fall back to Utf8 on failure
        series_list: list[pl.Series] = []
        for name in col_names:
            try:
                series_list.append(pl.Series(name, col_data[name]))
            except Exception as e:
                # Type conflict — stringify everything
                log.debug("Polars type inference failed for column %s, stringifying: %s", name, e)
                series_list.append(
                    pl.Series(name, [str(v) if v is not None else None for v in col_data[name]])
                )

        return pl.DataFrame(series_list)

    @staticmethod
    def _compute_watermark(entity: Entity, df: pl.DataFrame) -> Optional[str]:
        """Compute the new watermark value from the extracted data.

        Returns the MAX value of the watermark column as a string,
        or None if the entity is not incremental.
        """
        if not entity.is_incremental or not entity.watermark_column:
            return entity.last_load_value

        wm_col = entity.watermark_column
        if wm_col not in df.columns:
            return entity.last_load_value

        try:
            max_val = df.select(pl.col(wm_col).max()).item()
            if max_val is None:
                return entity.last_load_value
            return str(max_val)
        except Exception as e:
            log.warning("Failed to compute watermark for entity %d column %s: %s", entity.id, wm_col, e)
            return entity.last_load_value

    @staticmethod
    def _diagnose_error(error_msg: str, entity: Entity) -> str:
        """Translate common pyodbc errors into plain-English suggestions."""
        msg_lower = error_msg.lower()

        if "could not open a connection" in msg_lower or "[53]" in error_msg:
            return (
                f"Cannot reach {entity.source_server}. "
                "Check VPN connection — all on-prem sources require corporate VPN."
            )

        if "login failed" in msg_lower:
            return (
                f"Authentication failed on {entity.source_server}/{entity.source_database}. "
                "Verify Trusted_Connection works — try sqlcmd from this machine."
            )

        if "invalid object name" in msg_lower or "invalid column name" in msg_lower:
            return (
                f"Table or column not found: {entity.qualified_name}. "
                "The source schema may have changed — re-run load optimization analysis."
            )

        if "timeout" in msg_lower:
            return (
                f"Query timed out on {entity.qualified_name}. "
                "Consider adding an index on the watermark column, increasing query_timeout (currently config-level), "
                "or switching to incremental loads for this table."
            )

        if "out of memory" in msg_lower or "memory" in msg_lower:
            return (
                f"Out of memory extracting {entity.qualified_name}. "
                "Reduce chunk_rows in engine config to lower memory usage."
            )

        return f"Extraction failed for {entity.qualified_name}. See error details above."
