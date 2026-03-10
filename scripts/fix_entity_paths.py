"""
Fix Entity Metadata Paths — One-time migration.

Updates all LandingzoneEntity records to use the correct path format:
  FilePath = '{Namespace}/{Table}'
  FileName = '{Table}.parquet'

See ARCHITECTURE.md for the canonical path format: {Namespace}/{Table} everywhere.

This script:
1. Queries all entities with their DataSource namespace
2. Computes the correct FilePath and FileName
3. Shows a preview of what will change
4. Updates only if --apply is passed

Usage:
  python scripts/fix_entity_paths.py              # dry-run (preview only)
  python scripts/fix_entity_paths.py --apply      # apply changes
"""

import os
import sys
import struct
import json
import urllib.request
import pyodbc

# --- Config -------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
CONFIG_PATH = os.path.join(ROOT_DIR, "dashboard", "app", "api", "config.json")
ENV_PATH = os.path.join(ROOT_DIR, "dashboard", "app", "api", ".env")

with open(CONFIG_PATH) as f:
    config = json.load(f)

SQL_SERVER = config["sql"]["server"]
SQL_DB = config["sql"]["database"]
SQL_DRIVER = config["sql"]["driver"]
TENANT = config["fabric"]["tenant_id"]
CLIENT_ID = config["fabric"]["client_id"]

# Load secret from .env
CLIENT_SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")
if not CLIENT_SECRET and os.path.exists(ENV_PATH):
    with open(ENV_PATH) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                CLIENT_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")

DRY_RUN = "--apply" not in sys.argv


def get_sp_token():
    """Get Service Principal token for Fabric SQL."""
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope": "https://database.windows.net/.default",
    }).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read())["access_token"]


def connect_sql():
    """Connect to Fabric SQL DB using SP token."""
    token = get_sp_token()
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    conn_str = (
        f"DRIVER={{{SQL_DRIVER}}};"
        f"SERVER={SQL_SERVER};"
        f"DATABASE={SQL_DB};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
    return conn


import urllib.parse


def main():
    print("=" * 70)
    print("FMD Entity Path Migration")
    print(f"Mode: {'DRY RUN (preview only)' if DRY_RUN else 'APPLY CHANGES'}")
    print("=" * 70)

    conn = connect_sql()
    cursor = conn.cursor()

    # Query all LZ entities with their namespace
    cursor.execute("""
        SELECT
            le.LandingzoneEntityId,
            le.SourceName,
            le.FileName,
            le.FilePath,
            ds.Namespace,
            ds.Name AS DataSourceName
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.IsActive = 1
        ORDER BY ds.Namespace, le.SourceName
    """)

    rows = cursor.fetchall()
    print(f"\nTotal active LZ entities: {len(rows)}")

    changes = []
    already_correct = 0
    needs_fix = 0

    for row in rows:
        eid = row[0]
        source_name = row[1].strip() if row[1] else ""
        current_filename = row[2].strip() if row[2] else ""
        current_filepath = row[3].strip() if row[3] else ""
        namespace = row[4].strip() if row[4] else ""
        ds_name = row[5]

        if not source_name or not namespace:
            print(f"  [SKIP] Entity {eid}: missing SourceName or Namespace")
            continue

        # Correct values per ARCHITECTURE.md — flat: Files/{Namespace}/{Table}.parquet
        correct_filepath = namespace
        correct_filename = f"{source_name}.parquet"

        if current_filepath == correct_filepath and current_filename == correct_filename:
            already_correct += 1
            continue

        needs_fix += 1
        changes.append({
            "id": eid,
            "source_name": source_name,
            "namespace": namespace,
            "old_filepath": current_filepath,
            "old_filename": current_filename,
            "new_filepath": correct_filepath,
            "new_filename": correct_filename,
        })

    print(f"\nAlready correct: {already_correct}")
    print(f"Need fixing: {needs_fix}")

    if not changes:
        print("\nNothing to fix!")
        conn.close()
        return

    # Show preview
    print(f"\n{'-' * 70}")
    print("CHANGES PREVIEW (first 20):")
    print(f"{'-' * 70}")
    for c in changes[:20]:
        print(f"  [{c['namespace']}] {c['source_name']}:")
        if c["old_filepath"] != c["new_filepath"]:
            print(f"    FilePath: '{c['old_filepath']}' -> '{c['new_filepath']}'")
        if c["old_filename"] != c["new_filename"]:
            print(f"    FileName: '{c['old_filename']}' -> '{c['new_filename']}'")

    if len(changes) > 20:
        print(f"\n  ... and {len(changes) - 20} more entities")

    # Count by namespace
    ns_counts = {}
    for c in changes:
        ns = c["namespace"]
        ns_counts[ns] = ns_counts.get(ns, 0) + 1
    print(f"\nBreakdown by namespace:")
    for ns, count in sorted(ns_counts.items()):
        print(f"  {ns}: {count} entities")

    if DRY_RUN:
        print(f"\n{'=' * 70}")
        print("DRY RUN — no changes applied.")
        print("Run with --apply to update the metadata DB.")
        print(f"{'=' * 70}")
        conn.close()
        return

    # Apply changes
    print(f"\nApplying {len(changes)} updates...")
    updated = 0
    errors = 0

    for c in changes:
        try:
            safe_filepath = c["new_filepath"].replace("'", "''")
            safe_filename = c["new_filename"].replace("'", "''")
            cursor.execute(
                f"UPDATE integration.LandingzoneEntity "
                f"SET FilePath = '{safe_filepath}', FileName = '{safe_filename}' "
                f"WHERE LandingzoneEntityId = {c['id']}"
            )
            cursor.commit()
            updated += 1
        except Exception as e:
            errors += 1
            print(f"  [ERROR] Entity {c['id']} ({c['source_name']}): {str(e)[:200]}")

    print(f"\nDone! Updated: {updated}, Errors: {errors}")

    # Also update execution.PipelineLandingzoneEntity for entities that have been loaded
    print("\nUpdating execution.PipelineLandingzoneEntity paths...")
    cursor.execute("""
        SELECT
            ple.PipelineLandingzoneEntityId,
            le.SourceName,
            ds.Namespace,
            ple.FileName AS CurrentFileName,
            ple.FilePath AS CurrentFilePath
        FROM execution.PipelineLandingzoneEntity ple
        JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.IsActive = 1
    """)

    exec_rows = cursor.fetchall()
    exec_updated = 0
    exec_already = 0

    for r in exec_rows:
        ple_id = r[0]
        source_name = r[1].strip() if r[1] else ""
        namespace = r[2].strip() if r[2] else ""
        cur_fn = r[3].strip() if r[3] else ""
        cur_fp = r[4].strip() if r[4] else ""

        correct_fp = namespace
        correct_fn = f"{source_name}.parquet"

        if cur_fp == correct_fp and cur_fn == correct_fn:
            exec_already += 1
            continue

        try:
            safe_fp = correct_fp.replace("'", "''")
            safe_fn = correct_fn.replace("'", "''")
            cursor.execute(
                f"UPDATE execution.PipelineLandingzoneEntity "
                f"SET FilePath = '{safe_fp}', FileName = '{safe_fn}' "
                f"WHERE PipelineLandingzoneEntityId = {ple_id}"
            )
            cursor.commit()
            exec_updated += 1
        except Exception as e:
            print(f"  [ERROR] PLE {ple_id}: {str(e)[:200]}")

    print(f"Execution entities: Updated {exec_updated}, Already correct: {exec_already}")

    conn.close()
    print("\nMigration complete!")


if __name__ == "__main__":
    main()
