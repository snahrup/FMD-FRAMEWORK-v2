"""OneLake Parquet/Delta -> SQLite ingest.

Replaces _sync_fabric_to_sqlite(). Reads local Parquet files written by
Fabric notebooks (via OneLake sync agent) and upserts into SQLite.
"""
import logging
import os
import re
from pathlib import Path

import pyarrow.parquet as pq

from dashboard.app.api import db

log = logging.getLogger("fmd.delta_ingest")

# Pattern for validating SQL identifier names from untrusted Parquet column headers.
_IDENT_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')

ONELAKE_DIR = Path(os.environ.get("ONELAKE_MOUNT_PATH", ""))

# Map of parquet filename (without extension) -> (SQLite table, primary key column)
TABLE_MAP = {
    "engine_runs": ("engine_runs", "RunId"),
    "engine_task_log": ("engine_task_log", "id"),
    "pipeline_audit": ("pipeline_audit", "id"),
    "copy_activity_audit": ("copy_activity_audit", "id"),
    "entity_status": ("entity_status", None),  # composite PK (LandingzoneEntityId, Layer)
    "notebook_executions": ("notebook_executions", "id"),
}

# Watermarks: filename stem -> last modified timestamp
_watermarks: dict[str, float] = {}


def _coerce(v) -> object:
    """Coerce a pyarrow scalar value to a SQLite-compatible Python type.

    - None stays None.
    - NaT (pyarrow/pandas timestamp sentinel) becomes None.
    - Everything else is stringified so SQLite TEXT columns accept it.
    """
    if v is None:
        return None
    cls_name = type(v).__name__
    if "NaTType" in cls_name or "NaT" == cls_name:
        return None
    # pyarrow scalars that aren't plain Python int/float/str need str()
    if isinstance(v, (int, float, str, bool)):
        return v
    return str(v)


def ingest_all() -> None:
    """Scan ONELAKE_DIR for Parquet files and upsert into SQLite."""
    if not ONELAKE_DIR or not ONELAKE_DIR.exists():
        log.warning("OneLake dir not set or doesn't exist: %s", ONELAKE_DIR)
        return

    for pq_file in ONELAKE_DIR.glob("*.parquet"):
        stem = pq_file.stem
        if stem not in TABLE_MAP:
            continue

        # Watermark check — skip file if mtime hasn't changed since last ingest
        mtime = pq_file.stat().st_mtime
        if _watermarks.get(stem) == mtime:
            log.debug("Skipping %s — unchanged", stem)
            continue

        table_name, _pk = TABLE_MAP[stem]
        try:
            arrow_table = pq.read_table(pq_file)
            df_rows = arrow_table.to_pydict()  # dict of column -> list of values
            if not df_rows:
                continue
            row_count = len(next(iter(df_rows.values())))
            if row_count == 0:
                continue

            cols = list(df_rows.keys())
            # Sanitize column names: strip brackets and reject anything
            # that is not a simple identifier (alphanumeric + underscore).
            safe_cols = []
            for c in cols:
                cleaned = c.replace("[", "").replace("]", "")
                if not _IDENT_RE.match(cleaned):
                    raise ValueError(f"Unsafe column name in Parquet file: {c!r}")
                safe_cols.append(cleaned)
            col_names = ", ".join(f"[{c}]" for c in safe_cols)
            placeholders = ", ".join(["?"] * len(safe_cols))
            # table_name from TABLE_MAP whitelist; bracket-escape for defense-in-depth
            safe_table = table_name.replace("]", "]]")
            sql = (
                "INSERT OR REPLACE INTO [" + safe_table + "] "
                "(" + col_names + ") VALUES (" + placeholders + ")"
            )

            conn = db.get_db()
            try:
                for i in range(row_count):
                    row_vals = tuple(_coerce(df_rows[c][i]) for c in cols)
                    conn.execute(sql, row_vals)
                conn.commit()
                _watermarks[stem] = mtime
                log.info(
                    "Ingested %s: %d rows into %s",
                    pq_file.name,
                    row_count,
                    table_name,
                )
            finally:
                conn.close()
        except Exception:
            log.exception("Failed to ingest %s", pq_file.name)


def start_ingest_thread(interval_seconds: int = 1800) -> None:
    """Start a background daemon thread that runs ingest_all() on a schedule.

    Args:
        interval_seconds: Seconds to sleep between ingest cycles (default 30 min).
    """
    import threading
    import time

    def _loop() -> None:
        while True:
            try:
                ingest_all()
            except Exception:
                log.exception("Delta ingest cycle failed")
            time.sleep(interval_seconds)

    t = threading.Thread(target=_loop, daemon=True, name="delta-ingest")
    t.start()
    log.info("Delta ingest thread started (interval=%ds)", interval_seconds)
