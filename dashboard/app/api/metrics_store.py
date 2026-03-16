"""FMD Metrics Store — SQLite time-series storage for pipeline monitoring.

Captures periodic snapshots of entity counts, pipeline runs, and lakehouse row counts
to enable trend analysis and executive reporting. Zero external dependencies.
"""

import sqlite3
import json
import threading
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger('fmd-metrics')

DB_PATH = Path(__file__).parent / 'fmd_metrics.db'
_db_lock = threading.Lock()


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db():
    """Create tables if they don't exist."""
    conn = _get_conn()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS layer_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                source_system TEXT NOT NULL,
                layer TEXT NOT NULL,
                entity_count INTEGER NOT NULL DEFAULT 0,
                active_count INTEGER NOT NULL DEFAULT 0,
                processed_count INTEGER DEFAULT NULL,
                row_count INTEGER DEFAULT NULL
            );

            CREATE TABLE IF NOT EXISTS pipeline_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                run_guid TEXT UNIQUE,
                pipeline_name TEXT NOT NULL,
                entity_layer TEXT,
                status TEXT NOT NULL,
                start_time TEXT,
                end_time TEXT,
                duration_sec REAL,
                entity_count INTEGER DEFAULT 0,
                error_summary TEXT
            );

            CREATE TABLE IF NOT EXISTS health_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                health TEXT NOT NULL,
                total_entities INTEGER NOT NULL DEFAULT 0,
                lz_count INTEGER NOT NULL DEFAULT 0,
                bronze_count INTEGER NOT NULL DEFAULT 0,
                silver_count INTEGER NOT NULL DEFAULT 0,
                bronze_rows INTEGER DEFAULT 0,
                silver_rows INTEGER DEFAULT 0,
                pipeline_success_rate REAL DEFAULT 0,
                recent_errors TEXT
            );

            CREATE TABLE IF NOT EXISTS dq_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                entity_count INTEGER NOT NULL DEFAULT 0,
                with_data INTEGER NOT NULL DEFAULT 0,
                empty INTEGER NOT NULL DEFAULT 0,
                total_rows INTEGER DEFAULT 0,
                coverage REAL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_layer_captured ON layer_snapshots(captured_at);
            CREATE INDEX IF NOT EXISTS idx_pipeline_captured ON pipeline_runs(captured_at);
            CREATE INDEX IF NOT EXISTS idx_health_captured ON health_snapshots(captured_at);
            CREATE INDEX IF NOT EXISTS idx_dq_captured ON dq_snapshots(captured_at);
        """)
        conn.commit()
    finally:
        conn.close()
    log.info(f'Metrics DB initialized at {DB_PATH}')


def record_layer_snapshot(source_system: str, layer: str, entity_count: int,
                          active_count: int = 0, processed_count: int = None,
                          row_count: int = None):
    """Record a point-in-time snapshot of entity counts for a source/layer."""
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:00Z')  # Round to minute
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO layer_snapshots "
                "(captured_at, source_system, layer, entity_count, active_count, processed_count, row_count) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (now, source_system, layer, entity_count, active_count, processed_count, row_count)
            )
            conn.commit()
        finally:
            conn.close()


def record_pipeline_run(run_guid: str, pipeline_name: str, entity_layer: str,
                        status: str, start_time: str = None, end_time: str = None,
                        duration_sec: float = None, entity_count: int = 0,
                        error_summary: str = None):
    """Record or update a pipeline run."""
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO pipeline_runs "
                "(captured_at, run_guid, pipeline_name, entity_layer, status, "
                "start_time, end_time, duration_sec, entity_count, error_summary) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (now, run_guid, pipeline_name, entity_layer, status,
                 start_time, end_time, duration_sec, entity_count, error_summary)
            )
            conn.commit()
        finally:
            conn.close()


def record_health_snapshot(health: str, total_entities: int,
                           lz_count: int, bronze_count: int, silver_count: int,
                           bronze_rows: int = 0, silver_rows: int = 0,
                           pipeline_success_rate: float = 0,
                           recent_errors: list = None):
    """Record an overall health snapshot."""
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:00Z')
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT INTO health_snapshots "
                "(captured_at, health, total_entities, lz_count, bronze_count, silver_count, "
                "bronze_rows, silver_rows, pipeline_success_rate, recent_errors) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (now, health, total_entities, lz_count, bronze_count, silver_count,
                 bronze_rows, silver_rows, pipeline_success_rate,
                 json.dumps(recent_errors) if recent_errors else None)
            )
            conn.commit()
        finally:
            conn.close()


def get_layer_trends(hours: int = 24, source_system: str = None) -> list[dict]:
    """Get layer snapshot trends over the last N hours."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%SZ')
    conn = _get_conn()
    try:
        if source_system:
            rows = conn.execute(
                "SELECT * FROM layer_snapshots WHERE captured_at >= ? AND source_system = ? "
                "ORDER BY captured_at",
                (cutoff, source_system)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM layer_snapshots WHERE captured_at >= ? ORDER BY captured_at",
                (cutoff,)
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_health_trends(hours: int = 24) -> list[dict]:
    """Get health snapshots over the last N hours."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%SZ')
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM health_snapshots WHERE captured_at >= ? ORDER BY captured_at",
            (cutoff,)
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get('recent_errors'):
                try:
                    d['recent_errors'] = json.loads(d['recent_errors'])
                except (json.JSONDecodeError, TypeError):
                    pass
            result.append(d)
        return result
    finally:
        conn.close()


def get_recent_pipeline_runs(limit: int = 20) -> list[dict]:
    """Get recent pipeline runs."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM pipeline_runs ORDER BY captured_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_pipeline_success_rate(hours: int = 24) -> dict:
    """Calculate pipeline success rate over the last N hours."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%SZ')
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT COUNT(*) as total, "
            "SUM(CASE WHEN status = 'Succeeded' THEN 1 ELSE 0 END) as succeeded, "
            "SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) as failed, "
            "SUM(CASE WHEN status = 'InProgress' THEN 1 ELSE 0 END) as running "
            "FROM pipeline_runs WHERE captured_at >= ?",
            (cutoff,)
        ).fetchone()
        total = row['total'] or 0
        return {
            'total': total,
            'succeeded': row['succeeded'] or 0,
            'failed': row['failed'] or 0,
            'running': row['running'] or 0,
            'successRate': round((row['succeeded'] or 0) / total * 100, 1) if total > 0 else 0,
        }
    finally:
        conn.close()


def record_dq_snapshot(entity_count: int, with_data: int, empty: int,
                       total_rows: int, coverage: float):
    """Record a DQ overview snapshot for trend analysis."""
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:00Z')
    with _db_lock:
        conn = _get_conn()
        try:
            # Deduplicate: only insert if no snapshot in last 5 minutes
            existing = conn.execute(
                "SELECT id FROM dq_snapshots WHERE captured_at = ?", (now,)
            ).fetchone()
            if existing:
                conn.execute(
                    "UPDATE dq_snapshots SET entity_count=?, with_data=?, empty=?, "
                    "total_rows=?, coverage=? WHERE id=?",
                    (entity_count, with_data, empty, total_rows, coverage, existing['id'])
                )
            else:
                conn.execute(
                    "INSERT INTO dq_snapshots "
                    "(captured_at, entity_count, with_data, empty, total_rows, coverage) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (now, entity_count, with_data, empty, total_rows, coverage)
                )
            conn.commit()
        finally:
            conn.close()


def get_dq_snapshots(hours: int = 168) -> list[dict]:
    """Get DQ snapshots over the last N hours (default 7 days)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%SZ')
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM dq_snapshots WHERE captured_at >= ? ORDER BY captured_at",
            (cutoff,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def cleanup_old_data(days: int = 30):
    """Remove data older than N days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute("DELETE FROM layer_snapshots WHERE captured_at < ?", (cutoff,))
            conn.execute("DELETE FROM health_snapshots WHERE captured_at < ?", (cutoff,))
            conn.execute("DELETE FROM pipeline_runs WHERE captured_at < ?", (cutoff,))
            conn.execute("DELETE FROM dq_snapshots WHERE captured_at < ?", (cutoff,))
            conn.commit()
        finally:
            conn.close()
