"""Select a safe explicit entity for real-loader smoke tests.

The script never starts a load. It only reads the local SQLite control-plane DB
and chooses one active entity that looks small and has the least recent failure
risk based on local audit history.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path


DB_PATH = Path(__file__).resolve().parents[1] / "dashboard" / "app" / "api" / "fmd_control_plane.db"

MONSTER_HINTS = (
    "history",
    "archive",
    "audit",
    "transaction",
    "ledger",
    "detail",
    "log",
)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _score(row: sqlite3.Row) -> tuple[int, int, int, str]:
    source_name = str(row["SourceName"] or "").lower()
    has_recent_failure = int(row["recent_failures"] or 0) > 0
    monster_name = any(hint in source_name for hint in MONSTER_HINTS)
    historical_rows = int(row["historical_rows"] or 0)
    has_historical_rows = historical_rows > 0
    # Prefer active, non-failed entities with known small historical row counts.
    return (
        1 if has_recent_failure else 0,
        1 if monster_name else 0,
        0 if has_historical_rows else 1,
        historical_rows if has_historical_rows else 999_999_999,
        str(row["DataSourceName"] or ""),
        str(row["SourceSchema"] or ""),
        str(row["SourceName"] or ""),
    )


def main() -> int:
    if not DB_PATH.exists():
        print(json.dumps({"error": f"Control-plane DB not found: {DB_PATH}"}, indent=2))
        return 1

    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                e.LandingzoneEntityId AS entity_id,
                COALESCE(NULLIF(d.DisplayName, ''), d.Name) AS DataSourceName,
                COALESCE(NULLIF(d.Namespace, ''), d.Name) AS Namespace,
                e.SourceSchema,
                e.SourceName,
                e.IsIncremental,
                COALESCE(MAX(CASE WHEN LOWER(t.Status) = 'failed' THEN 1 ELSE 0 END), 0) AS recent_failures,
                COALESCE(MIN(CASE WHEN LOWER(t.Status) = 'succeeded' AND COALESCE(t.RowsRead, 0) > 0 THEN t.RowsRead END), 0) AS historical_rows,
                MAX(CASE WHEN LOWER(t.Status) = 'succeeded' THEN t.created_at ELSE NULL END) AS last_success_at
            FROM lz_entities e
            LEFT JOIN datasources d ON d.DataSourceId = e.DataSourceId
            LEFT JOIN engine_task_log t
              ON t.EntityId = e.LandingzoneEntityId
             AND LOWER(COALESCE(t.Layer, '')) = 'landing'
             AND t.created_at >= datetime('now', '-30 days')
            WHERE e.IsActive = 1
              AND TRIM(COALESCE(e.SourceName, '')) <> ''
              AND TRIM(COALESCE(e.SourceSchema, '')) <> ''
            GROUP BY
                e.LandingzoneEntityId,
                d.DisplayName,
                d.Name,
                d.Namespace,
                e.SourceSchema,
                e.SourceName,
                e.IsIncremental
            """
        ).fetchall()

    if not rows:
        print(json.dumps({"error": "No active entities found in the control-plane DB."}, indent=2))
        return 1

    chosen = sorted(rows, key=_score)[0]
    historical_rows = int(chosen["historical_rows"] or 0)
    result = {
        "entity_id": int(chosen["entity_id"]),
        "source": str(chosen["DataSourceName"] or ""),
        "namespace": str(chosen["Namespace"] or ""),
        "schema": str(chosen["SourceSchema"] or ""),
        "table": str(chosen["SourceName"] or ""),
        "is_incremental": bool(chosen["IsIncremental"]),
        "historical_rows": historical_rows,
        "last_success_at": chosen["last_success_at"],
        "reason": (
            "Active entity with no recent landing failures and the smallest known historical row count."
            if historical_rows > 0
            else "Active entity with complete metadata; no historical row-count signal was available."
        ),
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
