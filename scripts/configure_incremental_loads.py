#!/usr/bin/env python3
"""
configure_incremental_loads.py — Discover watermark columns and enable incremental loads.

Connects to on-prem source SQL servers (VPN required) and:
  1. Discovers primary keys (sys.indexes)
  2. Discovers watermark columns for incremental loads (datetime/identity)
  3. Updates metadata DB: IsIncremental + IsIncrementalColumn on LandingzoneEntity
  4. Updates metadata DB: PrimaryKeys on BronzeLayerEntity
  5. Seeds LastLoadValue with last successful LZ execution timestamp per entity
     (so the next run is immediately incremental — no wasted full-load cycle)

Watermark priority:
  rowversion (SKIP — binary can't compare as varchar)
  *Modified*/*Updated* datetime  → priority 2
  *Created*/*Inserted* datetime  → priority 3
  identity column               → priority 4
  other datetime                → priority 5
  (Only priority ≤ 3 auto-qualify as incremental)

Usage:
    python scripts/configure_incremental_loads.py              # run for real
    python scripts/configure_incremental_loads.py --dry-run    # preview only
    python scripts/configure_incremental_loads.py --seed-only  # skip discovery, just seed watermarks

Requires: VPN connected (for source SQL servers), pyodbc
Author: Steve Nahrup
"""

import argparse
import json
import os
import struct
import sys
import time as time_mod
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
FABRIC_API = "https://api.fabric.microsoft.com/v1"

_token_cache = {}


def get_client_secret():
    env_path = os.path.join(PROJECT_DIR, "dashboard", "app", "api", ".env")
    with open(env_path) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("FABRIC_CLIENT_SECRET not found in dashboard/app/api/.env")


def get_token(scope="https://api.fabric.microsoft.com/.default"):
    cached = _token_cache.get(scope)
    if cached and cached["expires"] > time_mod.time():
        return cached["token"]
    data = urlencode({
        "client_id": CLIENT_ID,
        "client_secret": get_client_secret(),
        "scope": scope,
        "grant_type": "client_credentials",
    }).encode()
    req = Request(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data=data, method="POST",
    )
    resp = json.loads(urlopen(req).read())
    _token_cache[scope] = {
        "token": resp["access_token"],
        "expires": time_mod.time() + resp.get("expires_in", 3600) - 60,
    }
    return resp["access_token"]


def fabric_get(path):
    token = get_token()
    url = f"{FABRIC_API}/{path.lstrip('/')}" if not path.startswith("http") else path
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    req = Request(url, headers=headers)
    try:
        resp = urlopen(req)
        return resp.status, json.loads(resp.read())
    except HTTPError as e:
        return e.code, {"error": e.read().decode()[:500]}


def connect_metadata_db():
    """Connect to the Fabric SQL metadata database."""
    import pyodbc

    # Load config to get server/database
    config_path = os.path.join(PROJECT_DIR, "dashboard", "app", "api", "config.json")
    with open(config_path) as f:
        config = json.load(f)

    server = config.get("sql_server", "")
    database = config.get("sql_database", "")
    if not server or not database:
        raise RuntimeError("sql_server/sql_database not in config.json")

    sql_token = get_token("https://database.windows.net/.default")
    token_bytes = sql_token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

    server_conn = f"{server},1433" if ",1433" not in server else server
    conn_str = f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server_conn};DATABASE={database};"
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
    return conn


def discover_watermarks(meta_conn, dry_run=False):
    """Discover PKs and watermark columns from on-prem sources. Returns results dict."""
    import pyodbc

    meta_cursor = meta_conn.cursor()

    # Get datasources with connection details
    meta_cursor.execute(
        "SELECT ds.DataSourceId, ds.Name, ds.Namespace, c.ConnectionGuid "
        "FROM integration.DataSource ds "
        "JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId "
        "WHERE ds.Namespace NOT IN ('ONELAKE', 'NB')"
    )
    datasources = [
        {"id": row[0], "name": row[1], "namespace": row[2], "connGuid": row[3]}
        for row in meta_cursor.fetchall()
    ]

    if not datasources:
        print("  No on-prem datasources found")
        return {"total": 0, "incremental": 0, "pks": 0, "results": []}

    # Resolve gateway connections → server/database
    status, gw_data = fabric_get("connections")
    if status != 200 or not gw_data:
        print(f"  Could not retrieve Fabric connections (HTTP {status})")
        return {"total": 0, "incremental": 0, "pks": 0, "results": []}

    gw_by_id = {}
    for conn in gw_data.get("value", []):
        details = conn.get("connectionDetails", {})
        params = {p["name"]: p["value"] for p in details.get("parameters", []) if "name" in p and "value" in p}
        gw_by_id[conn["id"].lower()] = {
            "server": params.get("server", params.get("host", "")),
            "database": params.get("database", ""),
        }

    total_pks = 0
    total_incremental = 0
    total_entities = 0
    all_results = []

    for ds in datasources:
        conn_guid = ds["connGuid"].lower()
        gw = gw_by_id.get(conn_guid)
        if not gw or not gw["server"]:
            print(f"  [SKIP] DS {ds['id']} ({ds['name']}): gateway not resolved")
            continue

        src_server = gw["server"]
        src_database = gw["database"]
        ns = ds["namespace"]
        print(f"\n  --- {ns}: {ds['name']} ({src_server}/{src_database}) ---")

        if dry_run:
            print(f"  [DRY] Would analyze {src_server}/{src_database}")
            continue

        # Connect to source (Windows Auth via VPN)
        try:
            src_conn_str = (
                f"DRIVER={{ODBC Driver 18 for SQL Server}};"
                f"SERVER={src_server};DATABASE={src_database};"
                f"Trusted_Connection=yes;TrustServerCertificate=yes;"
            )
            src_conn = pyodbc.connect(src_conn_str, timeout=15)
        except Exception as e:
            print(f"  [FAIL] Source connection failed: {str(e)[:150]}")
            print(f"         Is VPN connected? Can you reach {src_server}?")
            continue

        src_cursor = src_conn.cursor()

        # Discover PKs
        pk_map = {}
        try:
            src_cursor.execute("""
                SELECT s.name, t.name, c.name
                FROM sys.indexes i
                JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                JOIN sys.tables t ON i.object_id = t.object_id
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE i.is_primary_key = 1
                ORDER BY s.name, t.name, ic.key_ordinal
            """)
            for row in src_cursor.fetchall():
                pk_map.setdefault((row[0], row[1]), []).append(row[2])
            print(f"  PKs discovered: {len(pk_map)} tables have primary keys")
        except Exception as e:
            print(f"  PK discovery failed: {e}")

        # Discover watermark candidates
        wm_map = {}
        try:
            src_cursor.execute("""
                SELECT s.name, t.name, c.name, tp.name,
                       COLUMNPROPERTY(t.object_id, c.name, 'IsIdentity')
                FROM sys.columns c
                JOIN sys.tables t ON c.object_id = t.object_id
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                JOIN sys.types tp ON c.system_type_id = tp.system_type_id AND c.user_type_id = tp.user_type_id
                WHERE (
                    tp.name IN ('datetime','datetime2','datetimeoffset','smalldatetime')
                    OR COLUMNPROPERTY(t.object_id, c.name, 'IsIdentity') = 1
                )
            """)
            for row in src_cursor.fetchall():
                key = (row[0], row[1])
                col, dtype, is_id = row[2], row[3], row[4]
                col_lower = col.lower()
                # Skip rowversion/timestamp — binary types can't compare as varchar
                if dtype in ('timestamp', 'rowversion'):
                    continue
                elif dtype in ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime'):
                    if any(kw in col_lower for kw in ('modif', 'updat', 'chang', 'last_')):
                        pri = 2
                    elif any(kw in col_lower for kw in ('creat', 'insert', 'added')):
                        pri = 3
                    else:
                        pri = 5
                elif is_id:
                    pri = 4
                else:
                    pri = 6
                wm_map.setdefault(key, []).append({"column": col, "type": dtype, "priority": pri, "is_identity": bool(is_id)})
        except Exception as e:
            print(f"  Watermark discovery failed: {e}")

        src_conn.close()

        # Get entities for this datasource
        meta_cursor.execute(
            "SELECT LandingzoneEntityId, SourceSchema, SourceName "
            "FROM integration.LandingzoneEntity "
            "WHERE DataSourceId = ? AND IsActive = 1",
            (ds["id"],)
        )
        entities = [(row[0], row[1], row[2]) for row in meta_cursor.fetchall()]

        ds_pks = 0
        ds_inc = 0
        for eid, schema, table in entities:
            total_entities += 1
            key = (schema, table)

            result = {
                "id": eid, "ns": ns, "schema": schema, "name": table,
                "primary_keys": None, "watermark_col": None, "watermark_type": None,
                "watermark_priority": None, "watermark_candidates": [],
                "is_incremental": False,
            }

            # Update PKs on Bronze entity
            pks = pk_map.get(key, [])
            if pks:
                ds_pks += 1
                total_pks += 1
                pk_str = ','.join(pks)
                result["primary_keys"] = pk_str
                try:
                    meta_cursor.execute(
                        "UPDATE integration.BronzeLayerEntity SET PrimaryKeys = ? "
                        "WHERE LandingzoneEntityId = ?",
                        (pk_str, eid)
                    )
                    meta_cursor.commit()
                except Exception:
                    pass

            # Determine incremental load strategy
            candidates = wm_map.get(key, [])
            result["watermark_candidates"] = candidates
            watermarks = sorted(candidates, key=lambda w: w["priority"])
            best_wm = watermarks[0] if watermarks else None
            if best_wm and best_wm["priority"] <= 3:
                ds_inc += 1
                total_incremental += 1
                result["watermark_col"] = best_wm["column"]
                result["watermark_type"] = best_wm["type"]
                result["watermark_priority"] = best_wm["priority"]
                result["is_incremental"] = True
                try:
                    meta_cursor.execute(
                        "UPDATE integration.LandingzoneEntity "
                        "SET IsIncremental = 1, IsIncrementalColumn = ? "
                        "WHERE LandingzoneEntityId = ?",
                        (best_wm["column"], eid)
                    )
                    meta_cursor.commit()
                except Exception as e:
                    print(f"    [ERR] Failed to update entity {eid}: {e}")

            all_results.append(result)

        print(f"  {len(entities)} entities: {ds_pks} PKs, {ds_inc} incremental")

    return {
        "total": total_entities,
        "incremental": total_incremental,
        "pks": total_pks,
        "results": all_results,
    }


def seed_watermark_values(meta_conn, dry_run=False):
    """Seed LastLoadValue from last successful LZ execution timestamps.

    For entities that are now marked IsIncremental=1 but have empty/no LastLoadValue,
    uses the most recent successful LZ pipeline execution timestamp as the watermark.
    This avoids a wasted full-load cycle.
    """
    cursor = meta_conn.cursor()

    # Find incremental entities with missing/empty watermark values
    cursor.execute("""
        SELECT le.LandingzoneEntityId, le.SourceSchema, le.SourceName,
               le.IsIncrementalColumn, ds.Namespace,
               (SELECT MAX(ple.LoadEndDateTime)
                FROM execution.PipelineLandingzoneEntity ple
                WHERE ple.LandingzoneEntityId = le.LandingzoneEntityId
                  AND ple.IsProcessed = 1) AS LastSuccessfulLoad,
               llv.LoadValue AS CurrentWatermark
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        LEFT JOIN execution.LandingzoneEntityLastLoadValue llv
            ON le.LandingzoneEntityId = llv.LandingzoneEntityId
        WHERE le.IsActive = 1
          AND le.IsIncremental = 1
          AND le.IsIncrementalColumn IS NOT NULL
          AND le.IsIncrementalColumn != ''
    """)

    rows = cursor.fetchall()
    seeded = 0
    skipped_has_value = 0
    skipped_no_exec = 0
    total = len(rows)

    print(f"\n  Found {total} incremental entities to check for watermark seeding")

    for row in rows:
        eid, schema, table, incr_col, ns = row[0], row[1], row[2], row[3], row[4]
        last_load = row[5]  # datetime or None
        current_wm = row[6]  # existing watermark value or None

        # Skip if already has a real watermark value
        if current_wm and current_wm.strip():
            skipped_has_value += 1
            continue

        # Need a timestamp to seed with
        if not last_load:
            skipped_no_exec += 1
            if dry_run:
                print(f"    [DRY] {ns}.{schema}.{table} — no LZ execution found, would skip")
            continue

        # Use the last successful LZ load timestamp as watermark seed
        seed_value = last_load.strftime('%Y-%m-%d %H:%M:%S') if hasattr(last_load, 'strftime') else str(last_load)

        if dry_run:
            print(f"    [DRY] {ns}.{schema}.{table} — would seed watermark '{incr_col}' = '{seed_value}'")
            seeded += 1
            continue

        try:
            # Upsert the LastLoadValue
            cursor.execute("""
                IF EXISTS (SELECT 1 FROM execution.LandingzoneEntityLastLoadValue WHERE LandingzoneEntityId = ?)
                    UPDATE execution.LandingzoneEntityLastLoadValue
                    SET LoadValue = ?
                    WHERE LandingzoneEntityId = ?
                ELSE
                    INSERT INTO execution.LandingzoneEntityLastLoadValue (LandingzoneEntityId, LoadValue)
                    VALUES (?, ?)
            """, (eid, seed_value, eid, eid, seed_value))
            cursor.commit()
            seeded += 1
        except Exception as e:
            print(f"    [ERR] Failed to seed {ns}.{schema}.{table} (entity {eid}): {e}")

    print(f"\n  Watermark Seeding Results:")
    print(f"    Seeded: {seeded}")
    print(f"    Already had value: {skipped_has_value}")
    print(f"    No LZ execution (can't seed): {skipped_no_exec}")
    print(f"    Total incremental entities: {total}")

    return {"seeded": seeded, "skipped_has_value": skipped_has_value, "skipped_no_exec": skipped_no_exec}


def main():
    parser = argparse.ArgumentParser(description="Configure incremental loads for FMD entities")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no DB writes")
    parser.add_argument("--seed-only", action="store_true", help="Skip watermark discovery, just seed values")
    args = parser.parse_args()

    print("=" * 70)
    print("FMD Incremental Load Configuration")
    print("=" * 70)
    print(f"  Timestamp: {datetime.now().isoformat()}")
    print(f"  Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    if args.seed_only:
        print(f"  Seed-only mode (skipping watermark discovery)")

    # Connect to metadata DB
    print("\n  Connecting to Fabric SQL metadata DB...")
    try:
        meta_conn = connect_metadata_db()
        print("  Connected.")
    except Exception as e:
        print(f"  [FAIL] Cannot connect to metadata DB: {e}")
        sys.exit(1)

    # Step 1: Discover watermarks (unless seed-only)
    discovery_results = None
    if not args.seed_only:
        print("\n" + "-" * 50)
        print("STEP 1: Watermark Discovery (requires VPN)")
        print("-" * 50)
        discovery_results = discover_watermarks(meta_conn, dry_run=args.dry_run)
        print(f"\n  Discovery Summary: {discovery_results['total']} entities, "
              f"{discovery_results['pks']} PKs, {discovery_results['incremental']} incremental")

    # Step 2: Seed watermark values
    print("\n" + "-" * 50)
    print("STEP 2: Seed Watermark Values from Execution History")
    print("-" * 50)
    seed_results = seed_watermark_values(meta_conn, dry_run=args.dry_run)

    meta_conn.close()

    # Save results
    output = {
        "timestamp": datetime.now().isoformat(),
        "dry_run": args.dry_run,
        "discovery": {
            "total_analyzed": discovery_results["total"] if discovery_results else 0,
            "incremental_found": discovery_results["incremental"] if discovery_results else 0,
            "pks_found": discovery_results["pks"] if discovery_results else 0,
        },
        "seeding": seed_results,
    }

    if discovery_results and discovery_results.get("results"):
        output["entities"] = discovery_results["results"]

    results_path = os.path.join(SCRIPT_DIR, "incremental_load_config_results.json")
    with open(results_path, "w") as f:
        json.dump(output, f, indent=2, default=str)
    print(f"\n  Results saved to: {results_path}")

    print("\n" + "=" * 70)
    print("DONE")
    if not args.dry_run and discovery_results and discovery_results["incremental"] > 0:
        print(f"\n  {discovery_results['incremental']} entities configured for incremental loads.")
        print(f"  {seed_results['seeded']} watermark values seeded from execution history.")
        print(f"  Next LZ run will use incremental queries (only new/changed rows).")
    elif args.dry_run:
        print("\n  This was a dry run. Re-run without --dry-run to apply changes.")
    print("=" * 70)


if __name__ == "__main__":
    main()
