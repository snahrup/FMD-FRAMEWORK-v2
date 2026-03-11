"""SQLite connection helpers for the FMD dashboard.

Thin wrapper providing get_db(), query(), execute(), and init_db().
The schema mirrors control_plane_db.py's init_db() — both create the
same tables (IF NOT EXISTS), so they're compatible.
"""
import sqlite3
import logging
from pathlib import Path

log = logging.getLogger("fmd.db")

DB_PATH = Path(__file__).parent / "fmd_control_plane.db"


def get_db() -> sqlite3.Connection:
    """Return a new SQLite connection with WAL mode and row_factory."""
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def query(sql: str, params: tuple = ()) -> list[dict]:
    """Execute a SELECT and return list of dicts."""
    conn = get_db()
    try:
        cursor = conn.execute(sql, params)
        cols = [d[0] for d in cursor.description] if cursor.description else []
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
    finally:
        conn.close()


def execute(sql: str, params: tuple = ()) -> None:
    """Execute a write statement (INSERT/UPDATE/DELETE)."""
    conn = get_db()
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Create all tables if they don't exist.

    Delegates to control_plane_db.init_db() which owns the schema.
    Temporarily redirects control_plane_db.DB_PATH to our DB_PATH so
    that both modules always operate on the same file — this matters
    during testing when DB_PATH is patched to a temp location.
    """
    import dashboard.app.api.control_plane_db as cpdb
    original = cpdb.DB_PATH
    try:
        cpdb.DB_PATH = DB_PATH
        cpdb.init_db()
    finally:
        cpdb.DB_PATH = original
    log.info("SQLite DB initialized at %s", DB_PATH)
