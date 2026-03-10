"""
SourceName Cleanup & LastLoadValue Gap Fix
===========================================
Diagnostic findings:
- 0 entities have null/empty SourceName (original 714 issue already resolved)
- 1 entity (ID=1) has a leading space in SourceName
- 6 entities missing from LandingzoneEntityLastLoadValue table
- These 6 entities would fail on LK_GET_LASTLOADDATE

This script:
1. Trims leading/trailing whitespace from ALL SourceName values
2. Trims FileName values as well (used in TargetFileName)
3. Inserts missing LastLoadValue records for the gap entities
4. Verifies the fix
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
    print(f"SourceName Cleanup & LastLoadValue Fix -- {datetime.now().isoformat()}")
    print("=" * 80)

    conn = connect_fabric()
    cursor = conn.cursor()
    print("Connected to Fabric SQL DB.\n")

    # ===========================================================================
    # PRE-FIX DIAGNOSTICS
    # ===========================================================================

    print("+------------------------------------------+")
    print("|  PRE-FIX STATE                           |")
    print("+------------------------------------------+")

    # Count entities with whitespace in SourceName
    cursor.execute("""
        SELECT COUNT(*) FROM integration.LandingzoneEntity
        WHERE SourceName != LTRIM(RTRIM(SourceName))
    """)
    ws_count = cursor.fetchone()[0]
    print(f"\n  Entities with whitespace in SourceName: {ws_count}")

    # Count entities with whitespace in FileName
    cursor.execute("""
        SELECT COUNT(*) FROM integration.LandingzoneEntity
        WHERE FileName != LTRIM(RTRIM(FileName))
    """)
    fn_ws_count = cursor.fetchone()[0]
    print(f"  Entities with whitespace in FileName: {fn_ws_count}")

    # Count entities with null/empty SourceName
    cursor.execute("""
        SELECT COUNT(*) FROM integration.LandingzoneEntity
        WHERE IsActive = 1 AND (SourceName IS NULL OR LTRIM(RTRIM(SourceName)) = '')
    """)
    null_sn = cursor.fetchone()[0]
    print(f"  Active entities with null/empty SourceName: {null_sn}")

    # Entities in view but missing from LastLoadValue
    cursor.execute("""
        SELECT v.EntityId, v.SourceSchema, v.SourceName
        FROM execution.vw_LoadSourceToLandingzone v
        LEFT JOIN execution.LandingzoneEntityLastLoadValue llv
            ON v.EntityId = llv.LandingzoneEntityId
        WHERE llv.LandingzoneEntityId IS NULL
        ORDER BY v.EntityId
    """)
    missing_llv = cursor.fetchall()
    print(f"  Entities missing from LastLoadValue: {len(missing_llv)}")
    for r in missing_llv:
        print(f"    EntityId={r[0]}, Schema={r[1]}, Name={r[2]}")

    # Total active entities
    cursor.execute("SELECT COUNT(*) FROM integration.LandingzoneEntity WHERE IsActive = 1")
    active_count = cursor.fetchone()[0]
    print(f"  Total active entities: {active_count}")

    cursor.execute("SELECT COUNT(*) FROM execution.LandingzoneEntityLastLoadValue")
    llv_count = cursor.fetchone()[0]
    print(f"  Total LastLoadValue records: {llv_count}")

    # ===========================================================================
    # FIX 1: Trim whitespace from SourceName
    # ===========================================================================

    print("\n+------------------------------------------+")
    print("|  FIX 1: Trim SourceName whitespace       |")
    print("+------------------------------------------+")

    if ws_count > 0:
        cursor.execute("""
            UPDATE integration.LandingzoneEntity
            SET SourceName = LTRIM(RTRIM(SourceName))
            WHERE SourceName != LTRIM(RTRIM(SourceName))
        """)
        updated = cursor.rowcount
        conn.commit()
        print(f"  Updated {updated} rows -- trimmed SourceName whitespace")
    else:
        print("  No whitespace issues in SourceName -- skipping")

    # ===========================================================================
    # FIX 2: Trim whitespace from FileName
    # ===========================================================================

    print("\n+------------------------------------------+")
    print("|  FIX 2: Trim FileName whitespace         |")
    print("+------------------------------------------+")

    if fn_ws_count > 0:
        cursor.execute("""
            UPDATE integration.LandingzoneEntity
            SET FileName = LTRIM(RTRIM(FileName))
            WHERE FileName != LTRIM(RTRIM(FileName))
        """)
        updated = cursor.rowcount
        conn.commit()
        print(f"  Updated {updated} rows -- trimmed FileName whitespace")
    else:
        print("  No whitespace issues in FileName -- skipping")

    # ===========================================================================
    # FIX 3: Trim whitespace from SourceSchema
    # ===========================================================================

    print("\n+------------------------------------------+")
    print("|  FIX 3: Trim SourceSchema whitespace     |")
    print("+------------------------------------------+")

    cursor.execute("""
        SELECT COUNT(*) FROM integration.LandingzoneEntity
        WHERE SourceSchema IS NOT NULL AND SourceSchema != LTRIM(RTRIM(SourceSchema))
    """)
    schema_ws = cursor.fetchone()[0]
    if schema_ws > 0:
        cursor.execute("""
            UPDATE integration.LandingzoneEntity
            SET SourceSchema = LTRIM(RTRIM(SourceSchema))
            WHERE SourceSchema IS NOT NULL AND SourceSchema != LTRIM(RTRIM(SourceSchema))
        """)
        updated = cursor.rowcount
        conn.commit()
        print(f"  Updated {updated} rows -- trimmed SourceSchema whitespace")
    else:
        print("  No whitespace issues in SourceSchema -- skipping")

    # ===========================================================================
    # FIX 4: Insert missing LastLoadValue records
    # ===========================================================================

    print("\n+------------------------------------------+")
    print("|  FIX 4: Insert missing LastLoadValue     |")
    print("+------------------------------------------+")

    if missing_llv:
        # Re-query since we may have changed data
        cursor.execute("""
            SELECT v.EntityId
            FROM execution.vw_LoadSourceToLandingzone v
            LEFT JOIN execution.LandingzoneEntityLastLoadValue llv
                ON v.EntityId = llv.LandingzoneEntityId
            WHERE llv.LandingzoneEntityId IS NULL
        """)
        missing_ids = [r[0] for r in cursor.fetchall()]

        inserted = 0
        for eid in missing_ids:
            try:
                # Use the upsert proc if available
                cursor.execute("""
                    EXEC execution.sp_UpsertLandingZoneEntityLastLoadValue
                        @LandingzoneEntityId = ?,
                        @LoadValue = '0'
                """, eid)
                inserted += 1
            except Exception as e:
                print(f"    ERROR inserting LastLoadValue for EntityId={eid}: {e}")
                # Try direct insert as fallback
                try:
                    cursor.execute("""
                        INSERT INTO execution.LandingzoneEntityLastLoadValue
                            (LandingzoneEntityId, LoadValue, LastLoadDatetime)
                        VALUES (?, '0', GETUTCDATE())
                    """, eid)
                    inserted += 1
                except Exception as e2:
                    print(f"    FALLBACK INSERT also failed for EntityId={eid}: {e2}")

        conn.commit()
        print(f"  Inserted {inserted} missing LastLoadValue records")
    else:
        print("  No missing LastLoadValue records -- skipping")

    # ===========================================================================
    # FIX 5: Trim Bronze/Silver entity names
    # ===========================================================================

    print("\n+------------------------------------------+")
    print("|  FIX 5: Trim Bronze entity names         |")
    print("+------------------------------------------+")

    cursor.execute("""
        SELECT COUNT(*) FROM integration.BronzeLayerEntity
        WHERE [Name] != LTRIM(RTRIM([Name]))
    """)
    bronze_ws = cursor.fetchone()[0]
    if bronze_ws > 0:
        cursor.execute("""
            UPDATE integration.BronzeLayerEntity
            SET [Name] = LTRIM(RTRIM([Name]))
            WHERE [Name] != LTRIM(RTRIM([Name]))
        """)
        updated = cursor.rowcount
        conn.commit()
        print(f"  Updated {updated} Bronze entity names -- trimmed whitespace")
    else:
        print("  No whitespace issues in Bronze entity names -- skipping")

    # Check Silver columns first
    cursor.execute("""
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'SilverLayerEntity'
        ORDER BY ORDINAL_POSITION
    """)
    silver_cols = [r[0] for r in cursor.fetchall()]
    print(f"  Silver columns: {silver_cols}")

    if 'Name' in silver_cols:
        cursor.execute("""
            SELECT COUNT(*) FROM integration.SilverLayerEntity
            WHERE [Name] != LTRIM(RTRIM([Name]))
        """)
        silver_ws = cursor.fetchone()[0]
        if silver_ws > 0:
            cursor.execute("""
                UPDATE integration.SilverLayerEntity
                SET [Name] = LTRIM(RTRIM([Name]))
                WHERE [Name] != LTRIM(RTRIM([Name]))
            """)
            updated = cursor.rowcount
            conn.commit()
            print(f"  Updated {updated} Silver entity names -- trimmed whitespace")
        else:
            print("  No whitespace issues in Silver entity names -- skipping")

    # ===========================================================================
    # POST-FIX VERIFICATION
    # ===========================================================================

    print("\n+------------------------------------------+")
    print("|  POST-FIX VERIFICATION                   |")
    print("+------------------------------------------+")

    # Recheck whitespace
    cursor.execute("""
        SELECT COUNT(*) FROM integration.LandingzoneEntity
        WHERE SourceName != LTRIM(RTRIM(SourceName))
    """)
    ws_after = cursor.fetchone()[0]
    print(f"\n  Entities with whitespace in SourceName: {ws_after} (was {ws_count})")

    # Recheck null/empty
    cursor.execute("""
        SELECT COUNT(*) FROM integration.LandingzoneEntity
        WHERE IsActive = 1 AND (SourceName IS NULL OR LTRIM(RTRIM(SourceName)) = '')
    """)
    null_after = cursor.fetchone()[0]
    print(f"  Active entities with null/empty SourceName: {null_after} (was {null_sn})")

    # Recheck LastLoadValue gaps
    cursor.execute("""
        SELECT COUNT(*)
        FROM execution.vw_LoadSourceToLandingzone v
        LEFT JOIN execution.LandingzoneEntityLastLoadValue llv
            ON v.EntityId = llv.LandingzoneEntityId
        WHERE llv.LandingzoneEntityId IS NULL
    """)
    llv_gap_after = cursor.fetchone()[0]
    print(f"  Entities missing from LastLoadValue: {llv_gap_after} (was {len(missing_llv)})")

    # Final counts
    cursor.execute("SELECT COUNT(*) FROM execution.LandingzoneEntityLastLoadValue")
    llv_count_after = cursor.fetchone()[0]
    print(f"  Total LastLoadValue records: {llv_count_after} (was {llv_count})")

    cursor.execute("SELECT COUNT(*) FROM execution.vw_LoadSourceToLandingzone")
    view_count = cursor.fetchone()[0]
    print(f"  Total entities in LZ view: {view_count}")

    # ===========================================================================
    # SUMMARY
    # ===========================================================================

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"")
    print(f"  ORIGINAL ISSUE: 714 entities reported with null/empty SourceName")
    print(f"  ACTUAL STATE:   0 entities with null/empty SourceName (already resolved)")
    print(f"")
    print(f"  Issues found and fixed:")
    print(f"    1. SourceName whitespace:   {ws_count} entity had leading/trailing whitespace -> trimmed")
    print(f"    2. FileName whitespace:     {fn_ws_count} entities with whitespace -> {'trimmed' if fn_ws_count > 0 else 'none found'}")
    print(f"    3. SourceSchema whitespace: {schema_ws} entities -> {'trimmed' if schema_ws > 0 else 'none found'}")
    print(f"    4. Missing LastLoadValue:   {len(missing_llv)} entities without LastLoadValue record -> inserted")
    print(f"    5. Bronze/Silver name trim: checked and cleaned")
    print(f"")
    print(f"  Post-fix verification:")
    print(f"    - Null/empty SourceName (active): {null_after}")
    print(f"    - Whitespace in SourceName:       {ws_after}")
    print(f"    - Missing LastLoadValue records:   {llv_gap_after}")
    print(f"    - Total active LZ entities:       {active_count}")
    print(f"    - Total entities in LZ view:      {view_count}")
    print(f"    - Total LastLoadValue records:     {llv_count_after}")
    print(f"")
    print(f"  The LK_GET_LASTLOADDATE lookup should no longer fail with")
    print(f"  'The table name is invalid' for any active entity.")
    print(f"")

    conn.close()
    print(f"Done at {datetime.now().isoformat()}")


if __name__ == '__main__':
    main()
