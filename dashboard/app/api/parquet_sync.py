"""SQLite to Parquet export — background sync module.

Maintains a dirty-table set protected by a threading.Lock.  A daemon thread
calls _export_once() every 10 seconds and writes any queued tables out to the
local OneLake directory as Parquet files, so Fabric can pick them up.

Usage (server startup):
    from dashboard.app.api import parquet_sync
    parquet_sync.start_export_thread()

Marking a table dirty after a write:
    parquet_sync.queue_export("connections")
"""

import os
import logging
import threading
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from dashboard.app.api import db as fmd_db

log = logging.getLogger("fmd.parquet_sync")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

EXPORTABLE_TABLES: frozenset[str] = frozenset({
    "connections",
    "datasources",
    "lz_entities",
    "bronze_entities",
    "silver_entities",
    "lakehouses",
    "workspaces",
    "pipelines",
    "entity_status",
    "pipeline_audit",
    "copy_activity_audit",
    "engine_runs",
    "engine_task_log",
})

# Defaults to "" (empty) — no-op when ONELAKE_LOCAL_DIR is not set.
ONELAKE_DIR: Path = Path(os.environ.get("ONELAKE_LOCAL_DIR", ""))

# ---------------------------------------------------------------------------
# Internal state
# ---------------------------------------------------------------------------

_dirty_tables: set[str] = set()
_dirty_lock: threading.Lock = threading.Lock()

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def queue_export(table_name: str) -> None:
    """Mark *table_name* as dirty so it will be exported on the next cycle.

    Raises ValueError if *table_name* is not in EXPORTABLE_TABLES.
    """
    if table_name not in EXPORTABLE_TABLES:
        raise ValueError(
            f"Unknown table '{table_name}'. "
            f"Must be one of: {sorted(EXPORTABLE_TABLES)}"
        )
    with _dirty_lock:
        _dirty_tables.add(table_name)
    log.debug("Queued export for table '%s'", table_name)


# ---------------------------------------------------------------------------
# Export implementation
# ---------------------------------------------------------------------------


def _export_once() -> None:
    """Single-pass export: drain the dirty set and write each table to Parquet.

    This is intentionally synchronous so it can be called directly in tests.
    On any per-table failure the table is re-added to the dirty set for retry.
    """
    with _dirty_lock:
        to_export = set(_dirty_tables)
        _dirty_tables.clear()

    if not to_export:
        return

    if not ONELAKE_DIR or not ONELAKE_DIR.exists():
        # No destination configured or directory is gone — put everything back.
        with _dirty_lock:
            _dirty_tables.update(to_export)
        log.warning(
            "ONELAKE_DIR '%s' does not exist; re-queuing %d table(s).",
            ONELAKE_DIR,
            len(to_export),
        )
        return

    for table_name in to_export:
        try:
            rows = fmd_db.query(f"SELECT * FROM [{table_name}]")
            if not rows:
                log.debug("Table '%s' is empty — skipping Parquet write.", table_name)
                continue

            arrow_table = pa.table(
                {col: [row[col] for row in rows] for col in rows[0].keys()}
            )
            dest = ONELAKE_DIR / f"{table_name}.parquet"
            pq.write_table(arrow_table, dest)
            log.info("Exported %d rows from '%s' → %s", len(rows), table_name, dest)

        except Exception as exc:  # pylint: disable=broad-except
            log.error(
                "Failed to export table '%s': %s — re-queuing for retry.",
                table_name,
                exc,
            )
            with _dirty_lock:
                _dirty_tables.add(table_name)


def _export_loop() -> None:
    """Infinite loop: run _export_once() every 10 seconds."""
    while True:
        try:
            _export_once()
        except Exception as exc:  # pylint: disable=broad-except
            log.error("Unexpected error in export loop: %s", exc)
        time.sleep(10)


def start_export_thread() -> threading.Thread:
    """Create and start the daemon export thread.  Returns the Thread object."""
    t = threading.Thread(target=_export_loop, name="parquet-sync", daemon=True)
    t.start()
    log.info("Parquet sync thread started (daemon=True, interval=10s).")
    return t
