"""
Fix Rowversion/Timestamp Watermark Entities
============================================
Entities with watermark columns of SQL Server type `timestamp`/`rowversion` cause
"Implicit conversion from data type varchar to timestamp is not allowed" errors
in the LK_GET_LASTLOADDATE pipeline activity.

Root cause: The view `execution.vw_LoadSourceToLandingzone` constructs:
  - LastLoadValue query: CONVERT(VARCHAR, MAX(column), 120) -- fails for binary rowversion
  - SourceDataRetrieval: WHERE column > 'stored_value' -- fails for binary rowversion

Fix: Set affected entities to full load (IsIncremental=0, IsIncrementalColumn=NULL).

Known rowversion column names in this environment:
  - 'timestamp' (171 entities: 168 M3C/DI_PRD_Staging + 3 MES)
  - 'rec_timestamp' (13 entities: all MES)

14 entities actually hit the error in production logs (2026-02-27):
  MES entities: 184, 185, 186, 197, 198, 250, 251, 302, 303, 430, 444, 445, 460, 462

Total fixed: 187 entities (184 from timestamp/rec_timestamp + 3 additional bad entities)

This script is idempotent -- safe to re-run. It will detect and fix any entities
that get re-introduced with rowversion watermarks (e.g., after re-running
push_incremental_flags.py or deploy_from_scratch.py phase 13.5).

Usage:
    python scripts/fix_rowversion_watermarks.py [--check-only]
"""
import pyodbc
import struct
import os
import sys
from collections import defaultdict
from datetime import datetime

DRIVER = 'ODBC Driver 18 for SQL Server'
FABRIC_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
FABRIC_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
TENANT_ID = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT_ID = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'

# Column names known to be rowversion/timestamp binary type in source databases.
# These cannot be used as watermarks because the pipeline constructs:
#   CONVERT(VARCHAR, MAX(col), 120) -- style 120 is datetime format, invalid for binary
#   WHERE col > 'varchar_value'     -- implicit conversion varchar->timestamp not allowed
ROWVERSION_COLUMN_NAMES = ('timestamp', 'rec_timestamp')


def get_client_secret():
    env_path = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'app', 'api', '.env')
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith('FABRIC_CLIENT_SECRET='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise Exception("FABRIC_CLIENT_SECRET not found in .env")


def get_fabric_token():
    from msal import ConfidentialClientApplication
    client_secret = get_client_secret()
    app = ConfidentialClientApplication(
        CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{TENANT_ID}",
        client_credential=client_secret,
    )
    result = app.acquire_token_for_client(scopes=["https://database.windows.net/.default"])
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
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)


def main():
    check_only = '--check-only' in sys.argv

    print("=" * 80)
    print("FMD FRAMEWORK -- Fix Rowversion/Timestamp Watermark Entities")
    print(f"Mode: {'CHECK ONLY' if check_only else 'FIX'}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)

    conn = connect_fabric()
    cursor = conn.cursor()

    # Find affected entities
    col_conditions = " OR ".join(f"le.IsIncrementalColumn = '{col}'" for col in ROWVERSION_COLUMN_NAMES)
    cursor.execute(f"""
        SELECT le.LandingzoneEntityId, le.SourceSchema, le.SourceName,
               le.IsIncrementalColumn, le.DataSourceId, ds.Name as DataSourceName
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.IsIncremental = 1
          AND le.IsIncrementalColumn IS NOT NULL
          AND ({col_conditions})
        ORDER BY le.DataSourceId, le.SourceSchema, le.SourceName
    """)
    affected = cursor.fetchall()

    # Also check for any other suspicious patterns (broader search)
    cursor.execute("""
        SELECT le.LandingzoneEntityId, le.SourceSchema, le.SourceName,
               le.IsIncrementalColumn, le.DataSourceId, ds.Name
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.IsIncremental = 1
          AND le.IsIncrementalColumn IS NOT NULL
          AND (
              LOWER(le.IsIncrementalColumn) LIKE '%timestamp%'
              OR LOWER(le.IsIncrementalColumn) LIKE '%rowversion%'
              OR LOWER(le.IsIncrementalColumn) LIKE '%ssma%'
          )
    """)
    broader = cursor.fetchall()

    if not affected and not broader:
        # Verify the fix is still in place
        cursor.execute("""
            SELECT COUNT(*) FROM integration.LandingzoneEntity
            WHERE IsIncremental = 0 AND IsIncrementalColumn IS NULL
        """)
        fixed_count = cursor.fetchone()[0]

        cursor.execute("""
            SELECT COUNT(*) FROM integration.LandingzoneEntity
            WHERE IsIncremental = 1 AND IsIncrementalColumn IS NOT NULL
        """)
        incr_count = cursor.fetchone()[0]

        print(f"\n  No rowversion/timestamp watermark entities found.")
        print(f"  Already fixed (full load, column=NULL): {fixed_count}")
        print(f"  Current incremental entities: {incr_count}")
        print(f"\n  Fix is already applied. Nothing to do.")
        conn.close()
        return

    all_affected = list({r[0]: r for r in list(affected) + list(broader)}.values())
    print(f"\n  Found {len(all_affected)} entities to fix:")

    by_ds = defaultdict(list)
    for row in all_affected:
        by_ds[row[5]].append(row)

    for ds_name in sorted(by_ds.keys()):
        entities = by_ds[ds_name]
        print(f"\n  {ds_name} ({len(entities)} entities):")
        for e in entities:
            print(f"    ID={e[0]:<5} {e[1]}.{e[2]:<45} col={e[3]}")

    if check_only:
        print(f"\n  [CHECK ONLY] Would fix {len(all_affected)} entities. Use without --check-only to apply.")
        conn.close()
        return

    # Apply fix
    ids_to_fix = [row[0] for row in all_affected]
    chunk_size = 50
    total_updated = 0
    for i in range(0, len(ids_to_fix), chunk_size):
        chunk = ids_to_fix[i:i + chunk_size]
        placeholders = ','.join('?' * len(chunk))
        cursor.execute(f"""
            UPDATE integration.LandingzoneEntity
            SET IsIncremental = 0, IsIncrementalColumn = NULL
            WHERE LandingzoneEntityId IN ({placeholders})
        """, *chunk)
        total_updated += cursor.rowcount

    conn.commit()

    # Verify
    placeholders = ','.join('?' * len(ids_to_fix))
    cursor.execute(f"""
        SELECT COUNT(*) FROM integration.LandingzoneEntity
        WHERE LandingzoneEntityId IN ({placeholders})
          AND IsIncremental = 0 AND IsIncrementalColumn IS NULL
    """, *ids_to_fix)
    verified = cursor.fetchone()[0]

    conn.close()

    print(f"\n{'='*80}")
    print(f"FIX APPLIED")
    print(f"{'='*80}")
    print(f"  Rows updated: {total_updated}")
    print(f"  Verified (confirmed full load): {verified}/{len(ids_to_fix)}")
    print(f"  LK_GET_LASTLOADDATE will no longer fail for these entities.")
    print(f"\nCompleted: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == '__main__':
    main()
