"""
Pre-Flight Path Audit — The validation step that should have always existed.

Pulls registered entity names from the SQL metadata DB, lists actual files
on the OneLake LZ lakehouse, and shows a side-by-side comparison:
  - What the metadata says each entity's path SHOULD be
  - What file (if any) actually exists on OneLake for that entity
  - Mismatches, missing files, orphan files

Usage:
  python scripts/preflight_path_audit.py
"""

import os
import sys
import json
import struct
import re
import time
import urllib.request
import urllib.parse
import urllib.error
import pyodbc

# --- Config ---
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
WORKSPACE_ID = config["fabric"]["workspace_data_id"]
LZ_LAKEHOUSE_ID = config["engine"]["lz_lakehouse_id"]

CLIENT_SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")
if not CLIENT_SECRET and os.path.exists(ENV_PATH):
    with open(ENV_PATH) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                CLIENT_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")

ONELAKE_URL = "https://onelake.dfs.fabric.microsoft.com"

_token_cache = {}

def get_token(scope):
    if scope in _token_cache:
        token, exp = _token_cache[scope]
        if time.time() < exp - 60:
            return token
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope": scope,
    }).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    resp = urllib.request.urlopen(req, timeout=15)
    result = json.loads(resp.read())
    token = result["access_token"]
    _token_cache[scope] = (token, time.time() + result.get("expires_in", 3600))
    return token


def connect_sql():
    token = get_token("https://database.windows.net/.default")
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    conn_str = (
        f"DRIVER={{{SQL_DRIVER}}};"
        f"SERVER={SQL_SERVER};"
        f"DATABASE={SQL_DB};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


def list_onelake_files():
    token = get_token("https://storage.azure.com/.default")
    adls_dir = f"{LZ_LAKEHOUSE_ID}/Files"
    url = (
        f"{ONELAKE_URL}/{WORKSPACE_ID}"
        f"?resource=filesystem&directory={urllib.parse.quote(adls_dir, safe='/')}&recursive=true"
    )
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "x-ms-version": "2021-06-08",
    })
    resp = urllib.request.urlopen(req, timeout=30)
    data = json.loads(resp.read())
    prefix = f"{LZ_LAKEHOUSE_ID}/"
    files = []
    for entry in data.get("paths", []):
        full = entry.get("name", "")
        rel = full[len(prefix):] if full.startswith(prefix) else full
        is_dir = entry.get("isDirectory", "false") == "true"
        if not is_dir and rel.endswith(".parquet"):
            size = int(entry.get("contentLength", 0))
            files.append({"path": rel, "size": size})
    return files


def extract_table_name(filename):
    """Extract the probable table name from a filename, stripping timestamps and extensions."""
    name = filename.replace(".parquet", "")
    # Strip timestamp suffix like _202603042159 or _20260305120000
    name = re.sub(r"_\d{12,14}$", "", name)
    return name


def main():
    print("=" * 80)
    print("PRE-FLIGHT PATH AUDIT")
    print("=" * 80)

    # 1. Get registered entities from metadata DB
    print("\n[1] Querying metadata DB for all registered entities...")
    conn = connect_sql()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            le.LandingzoneEntityId,
            le.SourceSchema,
            le.SourceName,
            le.FileName,
            le.FilePath,
            ds.Namespace,
            ds.Name AS DataSourceName,
            ds.DataSourceId
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.IsActive = 1
        ORDER BY ds.Namespace, le.SourceName
    """)
    entities = []
    for row in cursor.fetchall():
        entities.append({
            "id": row[0],
            "schema": (row[1] or "").strip(),
            "name": (row[2] or "").strip(),
            "filename": (row[3] or "").strip(),
            "filepath": (row[4] or "").strip(),
            "namespace": (row[5] or "").strip(),
            "datasource": (row[6] or "").strip(),
        })
    conn.close()
    print(f"   Found {len(entities)} active entities")

    # 2. List actual files on OneLake
    print("\n[2] Listing files on OneLake LZ lakehouse...")
    onelake_files = list_onelake_files()
    print(f"   Found {len(onelake_files)} parquet files")

    # 3. Build lookup: table name -> OneLake files
    # OneLake files are at paths like: Files/etq/2026/03/04/CustomerContacts_202603042159.parquet
    onelake_by_table = {}  # (namespace, table_name) -> list of file paths
    for f in onelake_files:
        path = f["path"]
        parts = path.replace("Files/", "").split("/")
        namespace = parts[0].lower() if parts else ""
        filename = parts[-1]
        table_name = extract_table_name(filename)
        key = (namespace, table_name.upper())
        if key not in onelake_by_table:
            onelake_by_table[key] = []
        onelake_by_table[key].append(f)

    # 4. Cross-reference
    print("\n[3] Cross-referencing entities vs OneLake files...")
    print("=" * 80)

    matched = 0
    missing = 0
    ns_stats = {}

    # Group entities by namespace
    by_ns = {}
    for e in entities:
        ns = e["namespace"]
        if ns not in by_ns:
            by_ns[ns] = []
        by_ns[ns].append(e)

    for ns in sorted(by_ns.keys()):
        ns_entities = by_ns[ns]
        ns_matched = 0
        ns_missing = 0
        ns_misnamed = []

        print(f"\n--- {ns.upper()} ({len(ns_entities)} entities) ---")
        print(f"{'Entity Name':<45} {'Expected Path':<35} {'OneLake Status'}")
        print(f"{'-'*45} {'-'*35} {'-'*30}")

        for e in ns_entities:
            expected_path = f"Files/{ns}/{e['name']}.parquet"
            key = (ns.lower(), e["name"].upper())
            onelake_match = onelake_by_table.get(key)

            if onelake_match:
                actual_path = onelake_match[0]["path"]
                size_kb = onelake_match[0]["size"] / 1024
                if actual_path == expected_path:
                    status = f"OK ({size_kb:.0f} KB)"
                    ns_matched += 1
                else:
                    status = f"WRONG PATH: {actual_path}"
                    ns_misnamed.append((e["name"], actual_path, expected_path))
                    ns_matched += 1  # file exists, just wrong path
            else:
                status = "MISSING"
                ns_missing += 1

            # Only print mismatches and missing (skip OK for brevity)
            if "WRONG PATH" in status or "MISSING" in status:
                print(f"  {e['name']:<43} {expected_path:<35} {status}")

        matched += ns_matched
        missing += ns_missing

        print(f"\n  Summary: {ns_matched} found on OneLake, {ns_missing} missing")
        if ns_misnamed:
            print(f"  {len(ns_misnamed)} files exist but at WRONG paths (need renaming)")

        ns_stats[ns] = {
            "total": len(ns_entities),
            "found": ns_matched,
            "missing": ns_missing,
            "wrong_path": len(ns_misnamed),
        }

    # 5. Check for orphan files (on OneLake but not in metadata)
    entity_keys = set()
    for e in entities:
        entity_keys.add((e["namespace"].lower(), e["name"].upper()))

    orphans = []
    for key, files in onelake_by_table.items():
        if key not in entity_keys:
            for f in files:
                orphans.append(f["path"])

    # 6. Final report
    print(f"\n{'=' * 80}")
    print("FINAL REPORT")
    print(f"{'=' * 80}")
    print(f"\nRegistered entities: {len(entities)}")
    print(f"OneLake files:       {len(onelake_files)}")
    print(f"Matched:             {matched}")
    print(f"Missing from OneLake: {missing}")
    print(f"Orphan files:        {len(orphans)}")

    print(f"\nBy namespace:")
    print(f"  {'Namespace':<12} {'Total':<8} {'Found':<8} {'Missing':<10} {'Wrong Path'}")
    print(f"  {'-'*12} {'-'*8} {'-'*8} {'-'*10} {'-'*10}")
    for ns, stats in sorted(ns_stats.items()):
        print(f"  {ns:<12} {stats['total']:<8} {stats['found']:<8} {stats['missing']:<10} {stats['wrong_path']}")

    if orphans:
        print(f"\nOrphan files (on OneLake but not in metadata):")
        for o in orphans[:20]:
            print(f"  {o}")
        if len(orphans) > 20:
            print(f"  ... and {len(orphans) - 20} more")

    print(f"\nExpected path format: Files/{{Namespace}}/{{Table}}.parquet")
    print(f"Example: Files/MES/MITMAS.parquet")


if __name__ == "__main__":
    main()
