"""
Push Incremental Load Flags to Fabric SQL Metadata DB
=====================================================
Reads entities_to_analyze.json (which has 625 entities with is_incr=True and incr_col set)
and updates integration.LandingzoneEntity.IsIncremental / IsIncrementalColumn in the Fabric DB.

The Load Optimization Engine already discovered these columns but never wrote them back.
This script closes that gap.

Usage:
    python scripts/push_incremental_flags.py [--dry-run]
"""
import json
import os
import sys
import struct
import pyodbc
from collections import Counter

DRIVER = 'ODBC Driver 18 for SQL Server'
FABRIC_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
FABRIC_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'


def get_fabric_token():
    from msal import ConfidentialClientApplication
    env_path = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'app', 'api', '.env')
    env_vars = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env_vars[k.strip()] = v.strip().strip('"').strip("'")
    tenant_id = env_vars.get('FABRIC_TENANT_ID', 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303')
    client_id = env_vars.get('FABRIC_CLIENT_ID', 'ac937c5d-4bdd-438f-be8b-84a850021d2d')
    client_secret = env_vars.get('FABRIC_CLIENT_SECRET', '')
    app = ConfidentialClientApplication(
        client_id,
        authority=f"https://login.microsoftonline.com/{tenant_id}",
        client_credential=client_secret,
    )
    result = app.acquire_token_for_client(scopes=["https://analysis.windows.net/powerbi/api/.default"])
    if 'access_token' not in result:
        raise Exception(f"Token acquisition failed: {result.get('error_description', result)}")
    return result['access_token']


def connect_fabric():
    token = get_fabric_token()
    token_bytes = token.encode('utf-16-le')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={FABRIC_SERVER};"
        f"DATABASE={FABRIC_DB};"
        f"Encrypt=yes;"
        f"TrustServerCertificate=no;"
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


def main():
    dry_run = '--dry-run' in sys.argv

    # Load entities with known incremental columns
    entities_path = os.path.join(os.path.dirname(__file__), 'entities_to_analyze.json')
    with open(entities_path) as f:
        all_entities = json.load(f)

    incremental = [e for e in all_entities if e.get('is_incr') and e.get('incr_col')]
    print(f"Total entities in file: {len(all_entities)}")
    print(f"Entities with incremental flags: {len(incremental)}")

    ns_counts = Counter(e['ns'] for e in incremental)
    for ns in sorted(ns_counts):
        print(f"  {ns}: {ns_counts[ns]}")

    if dry_run:
        print("\n[DRY RUN] Would update the following entities:")
        for e in incremental[:10]:
            print(f"  LZ Entity {e['id']}: {e['ns']}/{e['schema']}.{e['name']} -> IsIncremental=1, IsIncrementalColumn='{e['incr_col']}'")
        if len(incremental) > 10:
            print(f"  ... and {len(incremental) - 10} more")
        return

    print(f"\nConnecting to Fabric SQL DB...")
    conn = connect_fabric()
    cursor = conn.cursor()

    # First, check current state
    cursor.execute("SELECT COUNT(*) FROM integration.LandingzoneEntity WHERE IsIncremental = 1")
    current_incr = cursor.fetchone()[0]
    print(f"Currently incremental in DB: {current_incr}")

    updated = 0
    skipped = 0
    errors = []

    for e in incremental:
        eid = e['id']
        incr_col = e['incr_col'].replace("'", "''")  # SQL escape
        try:
            cursor.execute(
                "UPDATE integration.LandingzoneEntity "
                "SET IsIncremental = 1, IsIncrementalColumn = ? "
                "WHERE LandingzoneEntityId = ?",
                incr_col, eid
            )
            if cursor.rowcount > 0:
                updated += 1
            else:
                skipped += 1
        except Exception as ex:
            errors.append({'id': eid, 'name': e['name'], 'error': str(ex)[:200]})

        if (updated + skipped) % 100 == 0:
            conn.commit()
            print(f"  Progress: {updated} updated, {skipped} skipped, {len(errors)} errors")

    conn.commit()

    # Verify
    cursor.execute("SELECT COUNT(*) FROM integration.LandingzoneEntity WHERE IsIncremental = 1")
    new_incr = cursor.fetchone()[0]

    print(f"\n{'='*60}")
    print(f"DONE")
    print(f"{'='*60}")
    print(f"Updated: {updated}")
    print(f"Skipped (entity not found): {skipped}")
    print(f"Errors: {len(errors)}")
    print(f"DB incremental count: {current_incr} -> {new_incr}")
    if errors:
        print(f"\nFirst 5 errors:")
        for err in errors[:5]:
            print(f"  Entity {err['id']} ({err['name']}): {err['error']}")

    cursor.close()
    conn.close()


if __name__ == '__main__':
    main()
