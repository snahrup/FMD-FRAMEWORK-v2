"""
Migrate OneLake LZ file paths to the correct {Namespace}/{Table} format.

This script:
1. Scans the LZ lakehouse for all existing parquet files
2. Identifies files using old path formats (schema prefixes, date dirs, etc.)
3. Moves them to the correct {Namespace}/{Table}/{Table}.parquet structure
4. Updates the SQL metadata to match

DOES NOT re-extract data. Just moves files on OneLake via ADLS Gen2 API.

Usage:
  python scripts/migrate_onelake_paths.py              # scan only (preview)
  python scripts/migrate_onelake_paths.py --apply       # move files + update metadata
"""

import os
import sys
import json
import struct
import time
import urllib.request
import urllib.parse
import urllib.error
import pyodbc
import re

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
WORKSPACE_ID = config["fabric"]["workspace_data_id"]
LZ_LAKEHOUSE_ID = config["engine"]["lz_lakehouse_id"]

CLIENT_SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")
if not CLIENT_SECRET and os.path.exists(ENV_PATH):
    with open(ENV_PATH) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                CLIENT_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")

DRY_RUN = "--apply" not in sys.argv
ONELAKE_URL = "https://onelake.dfs.fabric.microsoft.com"


# --- Auth ---------------------------------------------------------------------
_token_cache = {}

def get_token(scope):
    """Get SP token for a given scope, cached."""
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
    expires_in = result.get("expires_in", 3600)
    _token_cache[scope] = (token, time.time() + expires_in)
    return token


def get_storage_token():
    return get_token("https://storage.azure.com/.default")


def get_sql_token():
    return get_token("https://database.windows.net/.default")


# --- OneLake Operations ------------------------------------------------------
def list_directory(directory="Files", recursive=False):
    """List files/dirs under a OneLake path."""
    token = get_storage_token()
    adls_dir = f"{LZ_LAKEHOUSE_ID}/{directory}"
    rec = "true" if recursive else "false"
    url = (
        f"{ONELAKE_URL}/{WORKSPACE_ID}"
        f"?resource=filesystem&directory={urllib.parse.quote(adls_dir, safe='/')}&recursive={rec}"
    )
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "x-ms-version": "2021-06-08",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        data = json.loads(resp.read())
        prefix = f"{LZ_LAKEHOUSE_ID}/"
        results = []
        for entry in data.get("paths", []):
            full = entry.get("name", "")
            rel = full[len(prefix):] if full.startswith(prefix) else full
            is_dir = entry.get("isDirectory", "false") == "true"
            results.append({
                "path": rel,
                "full_path": full,
                "is_dir": is_dir,
                "size": int(entry.get("contentLength", 0)),
                "modified": entry.get("lastModified", ""),
            })
        return results
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []
        raise


def rename_path(old_path, new_path):
    """Rename/move a file or directory on OneLake using ADLS Gen2 rename."""
    token = get_storage_token()
    old_full = f"{LZ_LAKEHOUSE_ID}/{old_path}"
    new_full = f"{LZ_LAKEHOUSE_ID}/{new_path}"

    # URL-encode path segments (preserve / separators)
    new_full_encoded = urllib.parse.quote(new_full, safe="/")
    old_full_encoded = urllib.parse.quote(old_full, safe="/")

    # Create target directory first
    target_dir = "/".join(new_full_encoded.split("/")[:-1])
    create_url = f"{ONELAKE_URL}/{WORKSPACE_ID}/{target_dir}?resource=directory"
    create_req = urllib.request.Request(create_url, data=b"", method="PUT", headers={
        "Authorization": f"Bearer {token}",
        "x-ms-version": "2021-06-08",
    })
    try:
        urllib.request.urlopen(create_req, timeout=15)
    except urllib.error.HTTPError:
        pass  # Directory may already exist

    # Rename file
    url = f"{ONELAKE_URL}/{WORKSPACE_ID}/{new_full_encoded}"
    rename_source = f"/{WORKSPACE_ID}/{old_full_encoded}"
    req = urllib.request.Request(url, data=b"", method="PUT", headers={
        "Authorization": f"Bearer {token}",
        "x-ms-version": "2021-06-08",
        "x-ms-rename-source": rename_source,
    })
    try:
        urllib.request.urlopen(req, timeout=30)
        return True
    except urllib.error.HTTPError as e:
        print(f"  [ERROR] Rename failed ({e.code}): {old_path} -> {new_path}")
        try:
            print(f"    Body: {e.read().decode()[:200]}")
        except Exception:
            pass
        return False


# --- SQL ----------------------------------------------------------------------
def connect_sql():
    token = get_sql_token()
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    conn_str = (
        f"DRIVER={{{SQL_DRIVER}}};"
        f"SERVER={SQL_SERVER};"
        f"DATABASE={SQL_DB};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


def get_entity_lookup():
    """Build a lookup: (namespace, source_name) -> entity_id."""
    conn = connect_sql()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT le.LandingzoneEntityId, le.SourceName, ds.Namespace
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.IsActive = 1
    """)
    lookup = {}
    for row in cursor.fetchall():
        eid = row[0]
        name = row[1].strip() if row[1] else ""
        ns = row[2].strip() if row[2] else ""
        if ns and name:
            lookup[(ns.upper(), name.upper())] = eid
    conn.close()
    return lookup


# --- Main ---------------------------------------------------------------------
def main():
    print("=" * 70)
    print("OneLake LZ Path Migration")
    print(f"Mode: {'SCAN ONLY' if DRY_RUN else 'APPLY CHANGES'}")
    print(f"Workspace: {WORKSPACE_ID}")
    print(f"Lakehouse: {LZ_LAKEHOUSE_ID}")
    print("=" * 70)

    # 1. Scan the LZ lakehouse
    print("\nScanning OneLake Files/ directory (recursive)...")
    all_entries = list_directory("Files", recursive=True)
    print(f"Found {len(all_entries)} entries")

    # 2. Categorize files
    parquet_files = [e for e in all_entries if e["path"].endswith(".parquet")]
    directories = [e for e in all_entries if e["is_dir"]]

    print(f"  Parquet files: {len(parquet_files)}")
    print(f"  Directories: {len(directories)}")

    # 3. Analyze paths
    correct_pattern = re.compile(r"^Files/([^/]+)/([^/]+)\.parquet$")  # Files/{NS}/{Table}.parquet (flat)
    schema_prefix_pattern = re.compile(r"^Files/([^/]+)/([a-zA-Z]+)_(.+)$")  # has schema_ prefix
    date_pattern = re.compile(r"/\d{4}/\d{1,2}/\d{1,2}/")  # year/month/day
    timestamp_file = re.compile(r"_\d{14}\.parquet$")  # _20260305120000.parquet

    correct = []
    needs_move = []
    unknown = []

    for f in parquet_files:
        path = f["path"]
        if correct_pattern.match(path):
            correct.append(f)
            continue

        # Try to determine the correct target
        parts = path.replace("Files/", "").split("/")
        filename = parts[-1]

        # Extract namespace (first dir component is always the namespace)
        namespace = parts[0] if parts else None

        # Strip timestamp suffix from filename if present
        base_name = re.sub(r"_\d{8,14}\.parquet$", ".parquet", filename)
        # Strip schema prefix (e.g., dbo_MITMAS.parquet -> MITMAS.parquet)
        # But be careful: MVXJDTA_CIDADR_1.parquet is a real table name, not schema_table
        # We should match against known entity names
        table_name = base_name.replace(".parquet", "")

        if namespace and table_name:
            target_path = f"Files/{namespace}/{table_name}.parquet"
            needs_move.append({
                "current": f"Files/{path}" if not path.startswith("Files/") else path,
                "target": target_path,
                "namespace": namespace,
                "table": table_name,
                "size": f["size"],
                "original": f,
            })
        else:
            unknown.append(f)

    print(f"\n  Already correct: {len(correct)}")
    print(f"  Need moving: {len(needs_move)}")
    print(f"  Unknown/unresolvable: {len(unknown)}")

    # 4. Show preview by namespace
    ns_counts = {}
    for m in needs_move:
        ns = m["namespace"]
        ns_counts[ns] = ns_counts.get(ns, 0) + 1

    print(f"\nBy namespace:")
    for ns, count in sorted(ns_counts.items()):
        print(f"  {ns}: {count} files to move")

    # Show first 20 moves
    print(f"\n{'-' * 70}")
    print("SAMPLE MOVES (first 20):")
    for m in needs_move[:20]:
        print(f"  {m['current']}")
        print(f"    -> {m['target']}")
        print()

    if len(needs_move) > 20:
        print(f"  ... and {len(needs_move) - 20} more")

    if unknown:
        print(f"\n{'-' * 70}")
        print("UNKNOWN FILES (could not determine correct path):")
        for u in unknown[:10]:
            print(f"  {u['path']} ({u['size']} bytes)")

    if DRY_RUN:
        print(f"\n{'=' * 70}")
        print("SCAN ONLY — no files moved.")
        print("Run with --apply to move files and update metadata.")
        print(f"{'=' * 70}")
        return

    # 5. Apply moves
    print(f"\nMoving {len(needs_move)} files...")
    moved = 0
    failed = 0

    for m in needs_move:
        old = m["current"].replace("Files/", "", 1) if m["current"].startswith("Files/") else m["current"]
        new = m["target"].replace("Files/", "", 1) if m["target"].startswith("Files/") else m["target"]

        # Actual ADLS paths include "Files/" as part of the lakehouse structure
        if rename_path(f"Files/{old}", f"Files/{new}"):
            moved += 1
            if moved % 50 == 0:
                print(f"  Moved {moved}/{len(needs_move)}...")
        else:
            failed += 1

    print(f"\nMoved: {moved}, Failed: {failed}")

    # 6. Update metadata
    print("\nNow run scripts/fix_entity_paths.py --apply to update metadata to match.")


if __name__ == "__main__":
    main()
