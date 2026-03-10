"""
Targeted diagnostic: Find SourceName values with leading/trailing whitespace
or other subtle issues that would cause LK_GET_LASTLOADDATE to fail.
"""
import json
import os
import struct
import sys
import pyodbc
from datetime import datetime

DRIVER = 'ODBC Driver 18 for SQL Server'
FABRIC_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
FABRIC_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
TENANT_ID = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT_ID = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'

def get_client_secret():
    env_path = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'app', 'api', '.env')
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith('FABRIC_CLIENT_SECRET='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'

def connect_fabric():
    from msal import ConfidentialClientApplication
    secret = get_client_secret()
    app = ConfidentialClientApplication(
        CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{TENANT_ID}",
        client_credential=secret,
    )
    result = app.acquire_token_for_client(scopes=["https://database.windows.net/.default"])
    if 'access_token' not in result:
        raise Exception(f"Token failed: {result.get('error_description', result)}")
    token = result['access_token']
    token_bytes = token.encode('utf-16-le')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    conn_str = f"DRIVER={{{DRIVER}}};SERVER={FABRIC_SERVER};DATABASE={FABRIC_DB};Encrypt=yes;TrustServerCertificate=no;"
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)

def main():
    print("=" * 80)
    print(f"SourceName Whitespace & Quality Diagnostic — {datetime.now().isoformat()}")
    print("=" * 80)

    conn = connect_fabric()
    cursor = conn.cursor()
    print("Connected.\n")

    # 1. Find entities where SourceName != LTRIM(RTRIM(SourceName))
    print("--- 1. Entities with leading/trailing whitespace in SourceName ---")
    cursor.execute("""
        SELECT LandingzoneEntityId, DataSourceId, SourceSchema,
               SourceName,
               LEN(SourceName) as RawLen,
               LEN(LTRIM(RTRIM(SourceName))) as TrimmedLen,
               IsActive
        FROM integration.LandingzoneEntity
        WHERE SourceName != LTRIM(RTRIM(SourceName))
        ORDER BY DataSourceId, LandingzoneEntityId
    """)
    ws_rows = cursor.fetchall()
    print(f"  Found {len(ws_rows)} entities with whitespace issues")
    if ws_rows:
        print(f"  {'ID':<6} {'DSID':<6} {'Schema':<15} {'SourceName':<45} {'RawLen':<8} {'TrimLen':<8} {'Active'}")
        print(f"  {'-'*6} {'-'*6} {'-'*15} {'-'*45} {'-'*8} {'-'*8} {'-'*7}")
        for r in ws_rows[:30]:
            name_repr = repr(str(r[3]))
            print(f"  {r[0]:<6} {r[1]:<6} {str(r[2]):<15} {name_repr:<45} {r[4]:<8} {r[5]:<8} {r[6]}")
        if len(ws_rows) > 30:
            print(f"  ... ({len(ws_rows)} total)")

    # 2. Find entities where FileName has issues
    print("\n--- 2. Entities with empty/null FileName ---")
    cursor.execute("""
        SELECT COUNT(*) as cnt
        FROM integration.LandingzoneEntity
        WHERE IsActive = 1 AND (FileName IS NULL OR FileName = '' OR LTRIM(RTRIM(FileName)) = '')
    """)
    print(f"  Active entities with empty FileName: {cursor.fetchone()[0]}")

    cursor.execute("""
        SELECT COUNT(*) as cnt
        FROM integration.LandingzoneEntity
        WHERE IsActive = 1 AND FileName != LTRIM(RTRIM(FileName))
    """)
    print(f"  Active entities with whitespace in FileName: {cursor.fetchone()[0]}")

    # 3. Check vw_LoadSourceToLandingzone for TargetFileName / SourceName issues
    print("\n--- 3. Execution view: TargetFileName null/empty check ---")
    cursor.execute("""
        SELECT COUNT(*) as cnt
        FROM execution.vw_LoadSourceToLandingzone
        WHERE TargetFileName IS NULL OR TargetFileName = '' OR LTRIM(RTRIM(TargetFileName)) = ''
    """)
    print(f"  Null/empty TargetFileName in view: {cursor.fetchone()[0]}")

    cursor.execute("""
        SELECT COUNT(*) as cnt
        FROM execution.vw_LoadSourceToLandingzone
        WHERE TargetFilePath IS NULL OR TargetFilePath = '' OR LTRIM(RTRIM(TargetFilePath)) = ''
    """)
    print(f"  Null/empty TargetFilePath in view: {cursor.fetchone()[0]}")

    # 4. Get the full view definition to understand the column mapping
    print("\n--- 4. Full vw_LoadSourceToLandingzone view definition ---")
    cursor.execute("""
        SELECT OBJECT_DEFINITION(OBJECT_ID('execution.vw_LoadSourceToLandingzone'))
    """)
    view_def = cursor.fetchone()[0]
    print(view_def)

    # 5. Check sp_GetLandingzoneEntity_Full output
    print("\n--- 5. sp_GetLandingzoneEntity_Full output sample ---")
    try:
        cursor.execute("EXEC execution.sp_GetLandingzoneEntity_Full")
        cols = [c[0] for c in cursor.description]
        print(f"  Columns: {cols}")
        rows = cursor.fetchmany(5)
        for i, r in enumerate(rows):
            print(f"\n  Row {i+1}:")
            for j, col in enumerate(cols):
                val = r[j]
                if val is not None and isinstance(val, str) and val != val.strip():
                    print(f"    {col}: {repr(val)} *** HAS WHITESPACE ***")
                else:
                    print(f"    {col}: {val}")
        # Count remaining
        remaining = cursor.fetchall()
        print(f"\n  Total rows from Full proc: {5 + len(remaining)}")
    except Exception as e:
        print(f"  ERROR: {e}")

    # 6. Specifically check LK_GET_LASTLOADDATE flow
    # The pipeline probably does: SELECT * FROM execution.vw_LoadSourceToLandingzone WHERE EntityId = ?
    # Then uses SourceName to build the query
    print("\n--- 6. LastLoadValue coverage analysis ---")
    cursor.execute("""
        SELECT
            v.EntityId,
            v.SourceSchema,
            v.SourceName,
            v.TargetFileName,
            CASE WHEN llv.LandingzoneEntityId IS NULL THEN 'MISSING' ELSE 'EXISTS' END as HasLastLoad,
            llv.LoadValue
        FROM execution.vw_LoadSourceToLandingzone v
        LEFT JOIN execution.LandingzoneEntityLastLoadValue llv ON v.EntityId = llv.LandingzoneEntityId
        WHERE llv.LandingzoneEntityId IS NULL
        ORDER BY v.EntityId
    """)
    missing_llv = cursor.fetchall()
    print(f"  Entities in view but MISSING from LastLoadValue: {len(missing_llv)}")
    if missing_llv:
        for r in missing_llv[:10]:
            print(f"    EntityId={r[0]}, Schema={r[1]}, Name={r[2]}, TargetFileName={r[3]}")

    # 7. Check if there's a mismatch between entity count in view vs base table
    cursor.execute("SELECT COUNT(*) FROM execution.vw_LoadSourceToLandingzone")
    view_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM integration.LandingzoneEntity WHERE IsActive = 1")
    active_count = cursor.fetchone()[0]
    print(f"\n--- 7. Count comparison ---")
    print(f"  Entities in view: {view_count}")
    print(f"  Active in base table: {active_count}")
    print(f"  Difference: {active_count - view_count}")

    if active_count != view_count:
        print("\n  Finding entities active in base table but missing from view...")
        cursor.execute("""
            SELECT le.LandingzoneEntityId, le.DataSourceId, le.SourceSchema, le.SourceName, le.IsActive
            FROM integration.LandingzoneEntity le
            WHERE le.IsActive = 1
            AND le.LandingzoneEntityId NOT IN (
                SELECT EntityId FROM execution.vw_LoadSourceToLandingzone
            )
            ORDER BY le.LandingzoneEntityId
        """)
        missing = cursor.fetchall()
        print(f"  Found {len(missing)} active entities NOT in view")
        for r in missing[:20]:
            print(f"    ID={r[0]}, DSID={r[1]}, Schema={r[2]}, Name={r[3]}, Active={r[4]}")

    conn.close()
    print(f"\nDone at {datetime.now().isoformat()}")

if __name__ == '__main__':
    main()
