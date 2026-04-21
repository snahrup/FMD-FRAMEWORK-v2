"""Validate active source metadata against live source databases.

This script closes the audit gap around stale metadata registrations and dead
SQL connection rows. It can:
  - report active SQL connections that are unusable (missing server/database)
  - verify that active lz_entities still exist in their source database
  - deactivate missing entities plus linked bronze/silver rows when --apply is set

Dry-run by default. Pass --apply to persist deactivations.
"""

from __future__ import annotations

import argparse
from collections import defaultdict

import dashboard.app.api.control_plane_db as cpdb
from engine.config import load_config
from engine.connections import SourceConnection


def _matches_source(row: dict, source_filter: str) -> bool:
    if not source_filter:
        return True
    wanted = source_filter.strip().lower()
    candidates = {
        str(row.get("Name") or "").strip().lower(),
        str(row.get("DisplayName") or "").strip().lower(),
        str(cpdb._normalize_display_namespace(row.get("Namespace")) or "").strip().lower(),
    }
    return wanted in candidates


def _deactivate_unusable_connections(conn, apply: bool) -> list[dict]:
    rows = [
        dict(row)
        for row in conn.execute(
            "SELECT ConnectionId, Name, Type, ServerName, DatabaseName, IsActive "
            "FROM connections "
            "WHERE IsActive = 1 AND LOWER(COALESCE(Type, '')) = 'sql' "
            "  AND (TRIM(COALESCE(ServerName, '')) = '' OR TRIM(COALESCE(DatabaseName, '')) = '')"
        ).fetchall()
    ]
    if apply:
        for row in rows:
            conn.execute(
                "UPDATE connections SET IsActive = 0 WHERE ConnectionId = ?",
                (row["ConnectionId"],),
            )
    return rows


def _entity_rows(conn, source_filter: str) -> list[dict]:
    rows = [
        dict(row)
        for row in conn.execute(
            "SELECT e.LandingzoneEntityId, e.SourceSchema, e.SourceName, e.IsActive, "
            "       d.DataSourceId, d.Name, d.DisplayName, d.Namespace, "
            "       c.ConnectionId, c.Type AS ConnectionType, c.ServerName, c.DatabaseName "
            "FROM lz_entities e "
            "JOIN datasources d ON d.DataSourceId = e.DataSourceId "
            "JOIN connections c ON c.ConnectionId = d.ConnectionId "
            "WHERE e.IsActive = 1 AND d.IsActive = 1 AND c.IsActive = 1 "
            "  AND LOWER(COALESCE(c.Type, '')) = 'sql' "
            "ORDER BY d.Namespace, e.SourceSchema, e.SourceName"
        ).fetchall()
    ]
    return [row for row in rows if _matches_source(row, source_filter)]


def _deactivate_entities(conn, entity_ids: list[int]) -> None:
    for entity_id in entity_ids:
        conn.execute(
            "UPDATE lz_entities SET IsActive = 0 WHERE LandingzoneEntityId = ?",
            (entity_id,),
        )
        conn.execute(
            "UPDATE bronze_entities SET IsActive = 0 WHERE LandingzoneEntityId = ?",
            (entity_id,),
        )
        conn.execute(
            "UPDATE silver_entities "
            "SET IsActive = 0 "
            "WHERE BronzeLayerEntityId IN ("
            "    SELECT BronzeLayerEntityId FROM bronze_entities WHERE LandingzoneEntityId = ?"
            ")",
            (entity_id,),
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate source metadata against live source systems")
    parser.add_argument("--source", help="Optional source filter, e.g. OPTIVA or MES")
    parser.add_argument("--limit", type=int, help="Optional max number of entities to validate")
    parser.add_argument("--apply", action="store_true", help="Deactivate bad rows instead of only reporting them")
    args = parser.parse_args()

    cp_conn = cpdb._get_conn()
    try:
        bad_connections = _deactivate_unusable_connections(cp_conn, apply=args.apply)
        if bad_connections:
            print("Unusable active SQL connections:")
            for row in bad_connections:
                print(
                    f"  - {row['ConnectionId']}: {row['Name']} "
                    f"(server={row['ServerName'] or '-'}, database={row['DatabaseName'] or '-'})"
                )

        entities = _entity_rows(cp_conn, args.source or "")
        if args.limit:
            entities = entities[: args.limit]

        if not entities:
            print("No matching active SQL-backed entities found.")
            if args.apply:
                cp_conn.commit()
            return 0

        cfg = load_config()
        source_conn = SourceConnection(cfg)
        grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for row in entities:
            grouped[(row["ServerName"], row["DatabaseName"])].append(row)

        missing: list[dict] = []
        for (server, database), group_rows in grouped.items():
            print(f"Checking {server}/{database} ({len(group_rows)} entities)")
            sql = (
                "SELECT 1 "
                "FROM INFORMATION_SCHEMA.TABLES "
                "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
                "UNION ALL "
                "SELECT 1 "
                "FROM INFORMATION_SCHEMA.VIEWS "
                "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?"
            )
            try:
                with source_conn.connect(server, database, timeout=20) as live_conn:
                    cursor = live_conn.cursor()
                    for row in group_rows:
                        schema = str(row.get("SourceSchema") or "dbo")
                        table = str(row.get("SourceName") or "")
                        exists = cursor.execute(sql, schema, table, schema, table).fetchone() is not None
                        if not exists:
                            missing.append(row)
                            print(
                                f"  MISSING: {row['LandingzoneEntityId']} "
                                f"{cpdb._normalize_display_namespace(row.get('Namespace'))}.{schema}.{table}"
                            )
            except Exception as exc:
                print(f"  ERROR: failed to validate {server}/{database} -> {exc}")

        if missing and args.apply:
            _deactivate_entities(cp_conn, [int(row["LandingzoneEntityId"]) for row in missing])
            cp_conn.commit()

        action = "Deactivated" if args.apply else "Would deactivate"
        print(f"{action} {len(missing)} stale entit(y/ies).")
        return 0
    finally:
        cp_conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
