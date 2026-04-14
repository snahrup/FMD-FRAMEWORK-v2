"""
Prepare a vsc-fabric runtime payload from the local control plane.

Creates two artifacts:
  1. A consistent SQLite snapshot of the local control-plane DB.
  2. A fresh entities_export.json for scripts/turbo_extract.py.

This is meant to run on the laptop before syncing state to vsc-fabric.
It avoids copying a live SQLite file directly and ensures the remote
extractor uses the latest entity registry from the local control plane.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


DEFAULT_DB = (
    Path(__file__).resolve().parent.parent
    / "dashboard"
    / "app"
    / "api"
    / "fmd_control_plane.db"
)


EXPORT_SQL = """
SELECT
    le.LandingzoneEntityId AS id,
    le.SourceSchema AS schema,
    le.SourceName AS "table",
    ds.Name AS source,
    c.ServerName AS server,
    c.DatabaseName AS database,
    ROUND(COALESCE(hist.avg_duration, 0), 2) AS avg_duration,
    CAST(COALESCE(hist.avg_rows, 0) AS INTEGER) AS avg_rows
FROM lz_entities le
JOIN datasources ds
  ON ds.DataSourceId = le.DataSourceId
JOIN connections c
  ON c.ConnectionId = ds.ConnectionId
LEFT JOIN (
    SELECT
        EntityId,
        AVG(COALESCE(DurationSeconds, 0)) AS avg_duration,
        AVG(COALESCE(RowsRead, 0)) AS avg_rows
    FROM engine_task_log
    WHERE Layer = 'landing'
      AND Status = 'succeeded'
    GROUP BY EntityId
) hist
  ON hist.EntityId = le.LandingzoneEntityId
WHERE le.IsActive = 1
  AND COALESCE(c.ServerName, '') <> ''
  AND c.ServerName <> 'FabricSql'
ORDER BY ds.Name, le.SourceSchema, le.SourceName
"""


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def backup_db(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()

    src = _connect(source)
    try:
        dst = sqlite3.connect(str(destination), timeout=30)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def export_entities(snapshot_db: Path, output_json: Path) -> int:
    conn = _connect(snapshot_db)
    try:
        rows = conn.execute(EXPORT_SQL).fetchall()
    finally:
        conn.close()

    payload = [dict(row) for row in rows]
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return len(payload)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create a DB snapshot + entities_export.json for vsc-fabric sync."
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB,
        help=f"Source SQLite DB (default: {DEFAULT_DB})",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        required=True,
        help="Output directory for payload artifacts.",
    )
    parser.add_argument(
        "--snapshot-name",
        default="fmd_control_plane.snapshot.db",
        help="Snapshot filename (default: fmd_control_plane.snapshot.db)",
    )
    parser.add_argument(
        "--entities-name",
        default="entities_export.json",
        help="Entities export filename (default: entities_export.json)",
    )
    args = parser.parse_args()

    db_path = args.db.resolve()
    out_dir = args.out_dir.resolve()
    snapshot_path = out_dir / args.snapshot_name
    entities_path = out_dir / args.entities_name

    if not db_path.exists():
        raise SystemExit(f"Control-plane DB not found: {db_path}")

    backup_db(db_path, snapshot_path)
    entity_count = export_entities(snapshot_path, entities_path)

    print(f"Snapshot: {snapshot_path}")
    print(f"Entities: {entities_path}")
    print(f"Entity count: {entity_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
