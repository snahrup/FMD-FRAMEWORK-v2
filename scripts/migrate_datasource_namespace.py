#!/usr/bin/env python3
"""
migrate_datasource_namespace.py — Update DataSource.Namespace to target_schema values.

Reads target_schema from config/source_systems.yaml and updates the existing
DataSource rows in the Fabric SQL metadata DB. This is needed after adding
target_schema support so that Bronze/Silver notebooks use the correct
lakehouse schema names instead of 'dbo'.

Usage:
    python scripts/migrate_datasource_namespace.py [--dry-run]
"""

import os
import struct
import sys
import time
from urllib.request import Request, urlopen
from urllib.parse import urlencode

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml is required. Install with: pip install pyyaml")
    sys.exit(1)

try:
    import pyodbc
except ImportError:
    print("ERROR: pyodbc is required. Install with: pip install pyodbc")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"


def get_client_secret():
    env_path = os.path.join(REPO_ROOT, "dashboard", "app", "api", ".env")
    with open(env_path) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("FABRIC_CLIENT_SECRET not found")


def get_sql_token():
    data = urlencode({
        "client_id": CLIENT_ID,
        "client_secret": get_client_secret(),
        "scope": "https://database.windows.net/.default",
        "grant_type": "client_credentials",
    }).encode()
    req = Request(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data=data, method="POST",
    )
    resp = urlopen(req)
    import json
    return json.loads(resp.read())["access_token"]


def get_db_info():
    """Read SQL DB connection info from .deploy_state.json."""
    state_path = os.path.join(REPO_ROOT, ".deploy_state.json")
    import json
    with open(state_path) as f:
        state = json.load(f)
    sql_db = state.get("sql_db", {})
    return sql_db.get("server", ""), sql_db.get("database", "")


def main():
    dry_run = "--dry-run" in sys.argv

    # Load source_systems.yaml
    yaml_path = os.path.join(REPO_ROOT, "config", "source_systems.yaml")
    with open(yaml_path) as f:
        cfg = yaml.safe_load(f) or {}
    datasources = cfg.get("datasources", {})

    # Build the mapping: DataSource.Name -> target namespace
    namespace_map = {}
    for ds_name, ds_def in datasources.items():
        target = ds_def.get("target_schema") or ds_def.get("namespace", ds_name)
        namespace_map[ds_name] = target

    if not namespace_map:
        print("No datasources found in source_systems.yaml")
        return

    print("Target schema mapping:")
    for ds_name, ns in namespace_map.items():
        print(f"  {ds_name} -> {ns}")

    if dry_run:
        print("\n[DRY RUN] Would update the above DataSource.Namespace values")
        return

    # Connect to metadata DB
    server, database = get_db_info()
    if not server or not database:
        print("ERROR: No SQL DB info in .deploy_state.json")
        sys.exit(1)

    token = get_sql_token()
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

    server_conn = f"{server},1433" if ",1433" not in server else server
    conn_str = f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server_conn};DATABASE={database};"

    print(f"\nConnecting to {server_conn}...")
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
    cursor = conn.cursor()
    cursor.execute("SELECT 1")
    cursor.fetchone()
    print("[OK] Connected\n")

    # Show current state
    cursor.execute("SELECT DataSourceId, Name, Namespace, Type FROM integration.DataSource ORDER BY DataSourceId")
    rows = cursor.fetchall()
    print("Current DataSource rows:")
    print(f"  {'ID':>4}  {'Name':<25}  {'Namespace':<15}  {'Type':<15}")
    print(f"  {'-'*4}  {'-'*25}  {'-'*15}  {'-'*15}")
    for r in rows:
        print(f"  {r[0]:>4}  {r[1]:<25}  {r[2]:<15}  {r[3]:<15}")

    # Update each datasource
    print("\nUpdating Namespace values...")
    updated = 0
    for ds_name, target_ns in namespace_map.items():
        cursor.execute(
            "UPDATE integration.DataSource SET Namespace = ? WHERE Name = ? AND Namespace != ?",
            (target_ns, ds_name, target_ns)
        )
        if cursor.rowcount > 0:
            print(f"  [OK] {ds_name}: Namespace -> '{target_ns}' ({cursor.rowcount} row(s))")
            updated += 1
        else:
            print(f"  [--] {ds_name}: already '{target_ns}' or not found")

    cursor.commit()

    # Verify
    print(f"\nUpdated {updated} DataSource rows.")
    cursor.execute("SELECT DataSourceId, Name, Namespace, Type FROM integration.DataSource ORDER BY DataSourceId")
    rows = cursor.fetchall()
    print("\nAfter update:")
    print(f"  {'ID':>4}  {'Name':<25}  {'Namespace':<15}  {'Type':<15}")
    print(f"  {'-'*4}  {'-'*25}  {'-'*15}  {'-'*15}")
    for r in rows:
        print(f"  {r[0]:>4}  {r[1]:<25}  {r[2]:<15}  {r[3]:<15}")

    cursor.close()
    conn.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
