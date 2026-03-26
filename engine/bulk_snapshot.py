"""
FMD v3 Engine — Bulk Snapshot Mode.

Fast-path extraction for initial loads, backfills, and full refreshes.
No watermarks, no retries, no circuit breakers — just parallel extract
and land as fast as possible.

Design:
    - Reuses SourceConnection for on-prem SQL Server access
    - ConnectorX for speed (pyodbc fallback)
    - Polars → Parquet → OneLake via existing loader
    - ThreadPoolExecutor for table-level parallelism
    - Logs to engine_task_log for dashboard visibility
    - One source at a time to avoid cross-source contention

Usage:
    python -m engine.worker --bulk --layers landing
    python -m engine.worker --bulk --entity-ids 1 2 3
    POST /api/engine/start  {"mode": "bulk", "layers": ["landing"]}
"""

import io
import logging
import threading
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import List, Optional, Callable

import polars as pl

from engine.auth import TokenProvider
from engine.connections import SourceConnection, build_source_map
from engine.loader import OneLakeLoader
from engine.logging_db import AuditLogger
from engine.models import EngineConfig, Entity, RunResult
from engine.vpn import ensure_vpn, is_vpn_up

log = logging.getLogger("fmd.bulk_snapshot")

# ConnectorX — optional Rust-based SQL reader
try:
    import connectorx as cx
    HAS_CONNECTORX = True
except ImportError:
    HAS_CONNECTORX = False

# Column types to exclude (same as extractor.py)
_BINARY_TYPE_NAMES = frozenset({
    "timestamp", "rowversion", "binary", "varbinary", "image",
    "geometry", "geography", "xml", "hierarchyid", "sql_variant",
})


class BulkSnapshot:
    """Parallel bulk extraction — moves data fast with minimal ceremony.

    Usage::

        snap = BulkSnapshot(config, source_conn, loader, audit)
        results = snap.run(run_id, entities, max_workers=8)
    """

    def __init__(
        self,
        config: EngineConfig,
        source_conn: SourceConnection,
        loader: OneLakeLoader,
        audit: AuditLogger,
        stop_check: Optional[Callable[[], bool]] = None,
    ):
        self._config = config
        self._source = source_conn
        self._loader = loader
        self._audit = audit
        self._stop_check = stop_check or (lambda: False)

    def run(
        self,
        run_id: str,
        entities: List[Entity],
        max_workers: int = 16,
    ) -> List[RunResult]:
        """Extract all entities in parallel with adaptive concurrency.

        Starts at max_workers, monitors throughput, and scales up/down:
          - If avg extract time < 10s → ramp up (tables are small, go faster)
          - If avg extract time > 60s → throttle down (big tables saturating source)
          - If failures spike → throttle down aggressively

        Returns a list of RunResult — one per entity.
        """
        if not entities:
            log.warning("[%s] Bulk snapshot: no entities to process", run_id[:8])
            return []

        # VPN check
        if not is_vpn_up():
            log.warning("[%s] VPN down — attempting auto-connect", run_id[:8])
            if not ensure_vpn(timeout_seconds=120):
                log.error("[%s] VPN not available — aborting bulk snapshot", run_id[:8])
                return [
                    RunResult(
                        entity_id=e.id, layer="landing", status="failed",
                        error="VPN not connected — all source servers unreachable",
                        error_suggestion="Connect to WatchGuard VPN and retry.",
                    )
                    for e in entities
                ]

        # Group by source for logging
        source_map = build_source_map(entities)

        # Sort within each source: fast/small tables first, heavy grinders last.
        # Uses prior task_log data to estimate extract time.
        size_hints = self._load_size_hints([e.id for e in entities])
        for key, group in source_map.items():
            group.sort(key=lambda e: size_hints.get(e.id, 0))

        for (server, database), group in source_map.items():
            heavy = sum(1 for e in group if size_hints.get(e.id, 0) > 60)
            log.info(
                "[%s] Bulk: %s/%s — %d entities queued (%d heavy)",
                run_id[:8], server, database, len(group), heavy,
            )

        # Round-robin interleave across sources to spread load
        interleaved = self._interleave(source_map)
        total = len(interleaved)

        # ── Adaptive concurrency ────────────────────────────────────────
        min_workers = 4
        ceil_workers = min(max_workers, 32)  # hard cap
        active_workers = max_workers
        semaphore = threading.Semaphore(active_workers)
        sem_lock = threading.Lock()
        recent_durations: deque = deque(maxlen=20)  # rolling window of last 20 extract times
        recent_failures: deque = deque(maxlen=20)

        log.info(
            "[%s] Bulk snapshot: %d entities, %d sources, %d initial workers (adaptive %d–%d)",
            run_id[:8], total, len(source_map), active_workers, min_workers, ceil_workers,
        )

        results: list[RunResult] = []
        completed = 0
        t_start = time.time()

        # Build index lookup for progress reporting
        entity_index = {e.id: i + 1 for i, e in enumerate(interleaved)}

        def _adapt_concurrency():
            """Adjust semaphore based on recent performance."""
            nonlocal active_workers
            if len(recent_durations) < 5:
                return  # not enough data yet

            avg_dur = sum(recent_durations) / len(recent_durations)
            fail_rate = sum(recent_failures) / len(recent_failures) if recent_failures else 0

            old = active_workers
            if fail_rate > 0.3:
                # Lots of failures — back off hard
                active_workers = max(min_workers, active_workers - 4)
            elif avg_dur > 120:
                # Big tables dominating — ease off
                active_workers = max(min_workers, active_workers - 2)
            elif avg_dur > 60:
                active_workers = max(min_workers, active_workers - 1)
            elif avg_dur < 5 and fail_rate < 0.05:
                # Small tables flying — ramp up
                active_workers = min(ceil_workers, active_workers + 4)
            elif avg_dur < 15 and fail_rate < 0.1:
                active_workers = min(ceil_workers, active_workers + 2)

            if active_workers != old:
                diff = active_workers - old
                with sem_lock:
                    if diff > 0:
                        for _ in range(diff):
                            semaphore.release()
                    elif diff < 0:
                        # Can't shrink a semaphore directly — just let threads
                        # drain naturally by not releasing on completion
                        pass
                log.info(
                    "[%s] Adaptive: %d → %d workers (avg=%.1fs, fail=%.0f%%)",
                    run_id[:8], old, active_workers, avg_dur, fail_rate * 100,
                )

        def _worker(entity: Entity):
            semaphore.acquire()
            try:
                return self._extract_and_land(run_id, entity)
            finally:
                semaphore.release()

        with ThreadPoolExecutor(max_workers=ceil_workers) as pool:
            futures = {}
            for entity in interleaved:
                if self._stop_check():
                    results.append(RunResult(
                        entity_id=entity.id, layer="landing", status="skipped",
                    ))
                    continue

                # ── EMIT "extracting" event BEFORE submitting ──
                idx = entity_index.get(entity.id, 0)
                self._audit.log_entity_start(run_id, entity, "landing", idx, total)

                future = pool.submit(_worker, entity)
                futures[future] = entity

            for future in as_completed(futures):
                entity = futures[future]
                try:
                    result = future.result()
                except Exception as exc:
                    result = RunResult(
                        entity_id=entity.id, layer="landing", status="failed",
                        error=str(exc)[:500],
                    )

                results.append(result)
                completed += 1

                # Track for adaptive scaling
                recent_durations.append(result.duration_seconds)
                recent_failures.append(1 if result.status == "failed" else 0)
                _adapt_concurrency()

                # ── EMIT completion event immediately ──
                self._audit.log_entity_result(run_id, entity, result)
                if result.succeeded:
                    self._audit.mark_entity_loaded(
                        entity,
                        entity.namespace or entity.source_database,
                        f"{entity.source_name.strip()}.parquet",
                    )

                # Progress log every entity
                elapsed = time.time() - t_start
                ok = sum(1 for r in results if r.succeeded)
                fail = sum(1 for r in results if r.status == "failed")
                total_rows = sum(r.rows_read for r in results)
                total_bytes = sum(r.bytes_transferred for r in results)
                rate = completed / max(elapsed, 0.1)
                eta = (total - completed) / max(rate, 0.01)
                log.info(
                    "[%s] Bulk: %d/%d done (%d ok, %d fail) %.0fs elapsed, ~%.0fs remaining [%dw]",
                    run_id[:8], completed, total, ok, fail, elapsed, eta, active_workers,
                )

                # ── Heartbeat progress into engine_runs every 5 completions ──
                if completed % 5 == 0 or completed == total:
                    self._audit.heartbeat_progress(
                        run_id=run_id,
                        completed=completed,
                        succeeded=ok,
                        failed=fail,
                        total_rows=total_rows,
                        total_bytes=total_bytes,
                        elapsed_seconds=round(elapsed, 1),
                        eta_seconds=round(eta, 1),
                        active_workers=active_workers,
                    )

        # Final summary
        elapsed = time.time() - t_start
        ok = sum(1 for r in results if r.succeeded)
        fail = sum(1 for r in results if r.status == "failed")
        skip = sum(1 for r in results if r.status == "skipped")
        total_rows = sum(r.rows_read for r in results)
        total_bytes = sum(r.bytes_transferred for r in results)

        log.info(
            "[%s] BULK COMPLETE: %d entities — %d ok, %d fail, %d skip | "
            "%d rows, %.1f MB | %.0fs (%.1f entities/sec)",
            run_id[:8], len(results), ok, fail, skip,
            total_rows, total_bytes / (1024 * 1024),
            elapsed, len(results) / max(elapsed, 0.1),
        )

        return results

    def _extract_and_land(self, run_id: str, entity: Entity) -> RunResult:
        """Extract one entity (full load) and upload to OneLake.

        No watermark logic. No retries. Just SELECT * → Parquet → OneLake.
        """
        t0 = time.perf_counter()
        table_name = entity.qualified_name
        source_name = entity.source_name.strip()

        if not source_name:
            return RunResult(
                entity_id=entity.id, layer="landing", status="failed",
                error="Blank SourceName",
            )

        # ── Extract ──────────────────────────────────────────────────────
        query = f"SELECT * FROM {table_name}"

        try:
            if HAS_CONNECTORX and self._config.use_connectorx:
                df = self._extract_cx(entity, query, run_id)
            else:
                df = self._extract_pyodbc(entity, query, run_id)
        except Exception as exc:
            elapsed = time.perf_counter() - t0
            error_msg = str(exc)[:500]
            log.error(
                "[%s] Bulk extract FAILED: %s — %s (%.1fs)",
                run_id[:8], table_name, error_msg[:120], elapsed,
            )
            return RunResult(
                entity_id=entity.id, layer="landing", status="failed",
                duration_seconds=round(elapsed, 2),
                error=error_msg,
                extraction_method="connectorx" if HAS_CONNECTORX else "pyodbc",
            )

        rows_read = len(df)
        extract_time = time.perf_counter() - t0

        if rows_read == 0:
            log.info("[%s] Bulk: %s — 0 rows (empty table)", run_id[:8], source_name)
            return RunResult(
                entity_id=entity.id, layer="landing", status="succeeded",
                rows_read=0, rows_written=0, duration_seconds=round(extract_time, 2),
                extraction_method="connectorx" if HAS_CONNECTORX else "pyodbc",
                watermark_strategy="bulk_snapshot",
            )

        # ── Parquet ──────────────────────────────────────────────────────
        t_parquet = time.perf_counter()
        buf = io.BytesIO()
        df.write_parquet(buf, compression="snappy")
        parquet_bytes = buf.getvalue()
        parquet_time = time.perf_counter() - t_parquet

        # ── Upload ───────────────────────────────────────────────────────
        t_upload = time.perf_counter()
        upload_result, file_path, file_name = self._loader.upload_entity(
            entity, parquet_bytes, run_id,
        )
        upload_time = time.perf_counter() - t_upload

        total_time = time.perf_counter() - t0

        if not upload_result.succeeded:
            log.error(
                "[%s] Bulk upload FAILED: %s — %s",
                run_id[:8], source_name, upload_result.error,
            )
            return RunResult(
                entity_id=entity.id, layer="landing", status="failed",
                rows_read=rows_read,
                duration_seconds=round(total_time, 2),
                error=upload_result.error,
                extraction_method="connectorx" if HAS_CONNECTORX else "pyodbc",
                watermark_strategy="bulk_snapshot",
            )

        log.info(
            "[%s] Bulk OK: %s — %d rows, %.1f KB (extract=%.1fs parquet=%.1fs upload=%.1fs)",
            run_id[:8], source_name, rows_read,
            len(parquet_bytes) / 1024,
            extract_time, parquet_time, upload_time,
        )

        return RunResult(
            entity_id=entity.id,
            layer="landing",
            status="succeeded",
            rows_read=rows_read,
            rows_written=rows_read,
            bytes_transferred=len(parquet_bytes),
            duration_seconds=round(total_time, 2),
            extraction_method="connectorx" if HAS_CONNECTORX else "pyodbc",
            watermark_strategy="bulk_snapshot",
        )

    # ------------------------------------------------------------------
    # Extraction backends
    # ------------------------------------------------------------------

    def _extract_cx(
        self, entity: Entity, query: str, run_id: str,
    ) -> pl.DataFrame:
        """ConnectorX: fast Rust-based extraction → Polars DataFrame."""
        uri = self._source.build_connectorx_uri(
            entity.source_server, entity.source_database
        )
        df = cx.read_sql(uri, query, return_type="polars")

        # Drop binary columns that break downstream
        drop_cols = [c for c in df.columns if c.lower() in _BINARY_TYPE_NAMES]
        if drop_cols:
            df = df.drop(drop_cols)
        return df

    def _extract_pyodbc(
        self, entity: Entity, query: str, run_id: str,
    ) -> pl.DataFrame:
        """pyodbc fallback: standard ODBC extraction → Polars DataFrame."""
        with self._source.connect(
            entity.source_server, entity.source_database
        ) as conn:
            cursor = conn.cursor()
            cursor.execute(query)

            if not cursor.description:
                return pl.DataFrame()

            col_names = [desc[0] for desc in cursor.description]
            col_types = {
                desc[0]: desc[1].__name__ if hasattr(desc[1], "__name__") else str(desc[1])
                for desc in cursor.description
            }

            # Filter binary columns
            safe_indices = []
            safe_names = []
            for i, name in enumerate(col_names):
                if col_types.get(name, "").lower() not in _BINARY_TYPE_NAMES:
                    safe_indices.append(i)
                    safe_names.append(name)

            # Fetch all rows
            all_rows = cursor.fetchall()
            if not all_rows:
                return pl.DataFrame()

            # Filter columns
            if len(safe_indices) < len(col_names):
                all_rows = [
                    tuple(row[i] for i in safe_indices) for row in all_rows
                ]

            # Build DataFrame
            data = {}
            for col_idx, name in enumerate(safe_names):
                data[name] = [row[col_idx] for row in all_rows]

            return pl.DataFrame(data)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _interleave(source_map: dict) -> list:
        """Round-robin interleave entities across sources."""
        queues = list(source_map.values())
        max_len = max(len(q) for q in queues) if queues else 0
        result = []
        for i in range(max_len):
            for q in queues:
                if i < len(q):
                    result.append(q[i])
        return result

    @staticmethod
    def _load_size_hints(entity_ids: list[int]) -> dict[int, float]:
        """Load estimated extract duration from prior task_log entries.

        Returns {entity_id: avg_duration_seconds}. Entities with no history
        return 0 (treated as fast/unknown → scheduled first).
        """
        if not entity_ids:
            return {}
        try:
            import sqlite3
            from pathlib import Path
            db_path = Path(__file__).resolve().parent.parent / "dashboard" / "app" / "api" / "fmd_control_plane.db"
            conn = sqlite3.connect(str(db_path), timeout=10)
            conn.row_factory = sqlite3.Row
            # Use placeholders for all IDs
            placeholders = ",".join("?" for _ in entity_ids)
            rows = conn.execute(
                f"SELECT EntityId, AVG(DurationSeconds) as avg_dur "
                f"FROM engine_task_log "
                f"WHERE Status = 'succeeded' AND EntityId IN ({placeholders}) "
                f"GROUP BY EntityId",
                entity_ids,
            ).fetchall()
            conn.close()
            return {r["EntityId"]: r["avg_dur"] or 0 for r in rows}
        except Exception as exc:
            log.warning("Could not load size hints: %s", exc)
            return {}
