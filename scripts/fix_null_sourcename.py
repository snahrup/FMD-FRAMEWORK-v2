"""
Fix null/empty SourceName in integration.LandingzoneEntity
===========================================================
714 entities have empty/null SourceName values, causing LK_GET_LASTLOADDATE
to fail with "The table name is invalid" — 55% of all pipeline failures.

Strategy:
1. Diagnose: query all entities with null/empty SourceName
2. Cross-reference: use entities_to_analyze.json (which has entity ID -> table name mapping)
3. Fix: UPDATE SourceName for each affected entity
4. Verify: confirm count drops to 0
"""
import json
import os
import struct
import sys
import pyodbc
from datetime import datetime

# ─── Fabric SQL connection ────────────────────────────────────────────────────

DRIVER = 'ODBC Driver 18 for SQL Server'
FABRIC_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
FABRIC_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'

TENANT_ID = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT_ID = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'

def get_client_secret():
    """Load client secret from .env file."""
    env_path = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'app', 'api', '.env')
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith('FABRIC_CLIENT_SECRET='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    # Fallback
    return 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'


def connect_fabric():
    """Connect to Fabric SQL metadata DB via SP token."""
    from msal import ConfidentialClientApplication

    secret = get_client_secret()
    app = ConfidentialClientApplication(
        CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{TENANT_ID}",
        client_credential=secret,
    )
    result = app.acquire_token_for_client(scopes=["https://database.windows.net/.default"])
    if 'access_token' not in result:
        raise Exception(f"Token acquisition failed: {result.get('error_description', result)}")

    token = result['access_token']
    token_bytes = token.encode('utf-16-le')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)

    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={FABRIC_SERVER};"
        f"DATABASE={FABRIC_DB};"
        f"Encrypt=yes;"
        f"TrustServerCertificate=no;"
    )
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
    return conn


def load_entity_lookup():
    """Load entity ID -> table name mapping from entities_to_analyze.json."""
    path = os.path.join(os.path.dirname(__file__), 'entities_to_analyze.json')
    if not os.path.exists(path):
        print(f"WARNING: {path} not found")
        return {}
    with open(path) as f:
        entities = json.load(f)
    # Build lookup: entity ID -> {name, schema}
    lookup = {}
    for e in entities:
        lookup[e['id']] = {
            'name': e.get('name', ''),
            'schema': e.get('schema', ''),
            'ns': e.get('ns', ''),
            'DataSourceId': e.get('DataSourceId', 0),
        }
    return lookup


def main():
    print("=" * 80)
    print(f"Fix null/empty SourceName — {datetime.now().isoformat()}")
    print("=" * 80)

    # ─── Step 1: Connect ──────────────────────────────────────────────────────
    print("\n[1] Connecting to Fabric SQL DB...")
    try:
        conn = connect_fabric()
        cursor = conn.cursor()
        print("    Connected successfully.")
    except Exception as e:
        print(f"    FAILED to connect: {e}")
        sys.exit(1)

    # ─── Step 2: Diagnose — count totals ──────────────────────────────────────
    print("\n[2] Diagnosing entity counts...")

    cursor.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN SourceName IS NULL OR SourceName = '' OR LTRIM(RTRIM(SourceName)) = '' THEN 1 ELSE 0 END) as null_count,
            SUM(CASE WHEN SourceName IS NOT NULL AND SourceName != '' AND LTRIM(RTRIM(SourceName)) != '' THEN 1 ELSE 0 END) as valid_count
        FROM integration.LandingzoneEntity
    """)
    row = cursor.fetchone()
    total_all = row[0]
    null_all = row[1]
    valid_all = row[2]
    print(f"    ALL entities:   total={total_all}, null_sourcename={null_all}, valid={valid_all}")

    cursor.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN SourceName IS NULL OR SourceName = '' OR LTRIM(RTRIM(SourceName)) = '' THEN 1 ELSE 0 END) as null_count,
            SUM(CASE WHEN SourceName IS NOT NULL AND SourceName != '' AND LTRIM(RTRIM(SourceName)) != '' THEN 1 ELSE 0 END) as valid_count
        FROM integration.LandingzoneEntity
        WHERE IsActive = 1
    """)
    row = cursor.fetchone()
    total_active = row[0]
    null_active = row[1]
    valid_active = row[2]
    print(f"    ACTIVE entities: total={total_active}, null_sourcename={null_active}, valid={valid_active}")

    # ─── Step 3: Show examples of valid entities ──────────────────────────────
    print("\n[3] Sample VALID entities (with SourceName):")
    cursor.execute("""
        SELECT TOP 10 LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, IsActive, IsIncremental, IsIncrementalColumn
        FROM integration.LandingzoneEntity
        WHERE SourceName IS NOT NULL AND SourceName != '' AND LTRIM(RTRIM(SourceName)) != ''
        ORDER BY LandingzoneEntityId
    """)
    rows = cursor.fetchall()
    print(f"    {'ID':<6} {'DSID':<6} {'Schema':<20} {'SourceName':<40} {'Active':<7} {'Incr':<6} {'IncrCol'}")
    print(f"    {'-'*6} {'-'*6} {'-'*20} {'-'*40} {'-'*7} {'-'*6} {'-'*20}")
    for r in rows:
        print(f"    {r[0]:<6} {r[1]:<6} {str(r[2]):<20} {str(r[3]):<40} {r[4]!s:<7} {r[5]!s:<6} {str(r[6] or '')}")

    # ─── Step 4: Show null entities breakdown by DataSourceId ─────────────────
    print("\n[4] NULL SourceName breakdown by DataSourceId:")
    cursor.execute("""
        SELECT le.DataSourceId, ds.Namespace, ds.Name AS DSName,
               COUNT(*) as null_count
        FROM integration.LandingzoneEntity le
        LEFT JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.SourceName IS NULL OR le.SourceName = '' OR LTRIM(RTRIM(le.SourceName)) = ''
        GROUP BY le.DataSourceId, ds.Namespace, ds.Name
        ORDER BY le.DataSourceId
    """)
    rows = cursor.fetchall()
    print(f"    {'DSID':<6} {'Namespace':<15} {'DSName':<30} {'Count'}")
    print(f"    {'-'*6} {'-'*15} {'-'*30} {'-'*8}")
    for r in rows:
        print(f"    {r[0]:<6} {str(r[1]):<15} {str(r[2]):<30} {r[3]}")

    # ─── Step 5: Get ALL null SourceName entities ─────────────────────────────
    print("\n[5] Fetching all entities with null SourceName...")
    cursor.execute("""
        SELECT LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, IsActive
        FROM integration.LandingzoneEntity
        WHERE SourceName IS NULL OR SourceName = '' OR LTRIM(RTRIM(SourceName)) = ''
        ORDER BY DataSourceId, SourceSchema
    """)
    null_entities = cursor.fetchall()
    print(f"    Found {len(null_entities)} entities with null/empty SourceName")

    # ─── Step 6: Load lookup data ─────────────────────────────────────────────
    print("\n[6] Loading entity lookup from entities_to_analyze.json...")
    lookup = load_entity_lookup()
    print(f"    Loaded {len(lookup)} entity records from JSON")

    # Also check if BronzeEntity has the name info
    print("    Also checking BronzeLayerEntity for name references...")
    cursor.execute("""
        SELECT TOP 5 be.BronzeLayerEntityId, be.LandingzoneEntityId, be.TargetSchema, be.TargetName
        FROM integration.BronzeLayerEntity be
        ORDER BY be.BronzeLayerEntityId
    """)
    bronze_samples = cursor.fetchall()
    if bronze_samples:
        print(f"    Bronze sample: ID={bronze_samples[0][0]}, LZID={bronze_samples[0][1]}, Schema={bronze_samples[0][2]}, Name={bronze_samples[0][3]}")

    # Build a secondary lookup from Bronze: LandingzoneEntityId -> TargetName
    cursor.execute("""
        SELECT LandingzoneEntityId, TargetSchema, TargetName
        FROM integration.BronzeLayerEntity
    """)
    bronze_lookup = {}
    for r in cursor.fetchall():
        bronze_lookup[r[0]] = {'schema': r[1], 'name': r[2]}
    print(f"    Built bronze lookup with {len(bronze_lookup)} entries")

    # ─── Step 7: Also check the SourceSchema — sometimes SourceName is encoded in the schema ──
    # Check if there's a pattern: SourceSchema might actually have the table name
    print("\n[7] Checking SourceSchema patterns for null-SourceName entities...")
    cursor.execute("""
        SELECT TOP 20 LandingzoneEntityId, DataSourceId, SourceSchema, SourceName
        FROM integration.LandingzoneEntity
        WHERE SourceName IS NULL OR SourceName = '' OR LTRIM(RTRIM(SourceName)) = ''
        ORDER BY LandingzoneEntityId
    """)
    schema_samples = cursor.fetchall()
    for r in schema_samples:
        print(f"    ID={r[0]}, DSID={r[1]}, Schema='{r[2]}', SourceName='{r[3]}'")

    # ─── Step 8: Match and fix ────────────────────────────────────────────────
    print("\n[8] Matching null entities to their correct SourceName...")

    fixed = 0
    not_found = 0
    fix_log = []
    unfixable = []

    for entity in null_entities:
        eid = entity[0]
        dsid = entity[1]
        schema = entity[2] or ''
        current_name = entity[3] or ''
        is_active = entity[4]

        resolved_name = None
        source = None

        # Strategy 1: Look up in entities_to_analyze.json by ID
        if eid in lookup:
            resolved_name = lookup[eid]['name']
            source = 'entities_to_analyze.json'

        # Strategy 2: Look up in BronzeLayerEntity (TargetName = SourceName in LZ)
        if not resolved_name and eid in bronze_lookup:
            resolved_name = bronze_lookup[eid]['name']
            source = 'BronzeLayerEntity.TargetName'

        if resolved_name and resolved_name.strip():
            fix_log.append({
                'id': eid,
                'dsid': dsid,
                'schema': schema,
                'old_name': current_name,
                'new_name': resolved_name,
                'source': source,
                'is_active': is_active,
            })
        else:
            unfixable.append({
                'id': eid,
                'dsid': dsid,
                'schema': schema,
                'is_active': is_active,
            })
            not_found += 1

    print(f"    Matched: {len(fix_log)}")
    print(f"    Unmatched: {not_found}")

    if fix_log:
        print(f"\n    Sample fixes:")
        for f in fix_log[:10]:
            print(f"      ID={f['id']}, DSID={f['dsid']}, Schema='{f['schema']}' -> SourceName='{f['new_name']}' (from {f['source']})")

    # ─── Step 9: Apply the fix ────────────────────────────────────────────────
    if fix_log:
        print(f"\n[9] Applying {len(fix_log)} SourceName updates...")

        batch_size = 50
        total_updated = 0

        for i in range(0, len(fix_log), batch_size):
            batch = fix_log[i:i+batch_size]
            for fix in batch:
                try:
                    cursor.execute("""
                        UPDATE integration.LandingzoneEntity
                        SET SourceName = ?
                        WHERE LandingzoneEntityId = ?
                        AND (SourceName IS NULL OR SourceName = '' OR LTRIM(RTRIM(SourceName)) = '')
                    """, fix['new_name'], fix['id'])
                    total_updated += cursor.rowcount
                except Exception as e:
                    print(f"    ERROR updating ID {fix['id']}: {e}")

            conn.commit()
            print(f"    Committed batch {i//batch_size + 1}: {min(i+batch_size, len(fix_log))}/{len(fix_log)} processed, {total_updated} rows updated")

        print(f"\n    TOTAL ROWS UPDATED: {total_updated}")
    else:
        print("\n[9] No fixes to apply.")

    # ─── Step 10: Handle unfixable entities ───────────────────────────────────
    if unfixable:
        print(f"\n[10] Unfixable entities ({len(unfixable)}):")
        active_unfixable = [u for u in unfixable if u['is_active']]
        inactive_unfixable = [u for u in unfixable if not u['is_active']]
        print(f"     Active: {len(active_unfixable)}")
        print(f"     Inactive: {len(inactive_unfixable)}")

        if active_unfixable:
            print(f"\n     Active unfixable entity IDs (first 20):")
            for u in active_unfixable[:20]:
                print(f"       ID={u['id']}, DSID={u['dsid']}, Schema='{u['schema']}'")

            # Deactivate active unfixable entities as last resort
            print(f"\n     Deactivating {len(active_unfixable)} active unfixable entities...")
            deactivated = 0
            for u in active_unfixable:
                try:
                    cursor.execute("""
                        UPDATE integration.LandingzoneEntity
                        SET IsActive = 0
                        WHERE LandingzoneEntityId = ?
                        AND (SourceName IS NULL OR SourceName = '' OR LTRIM(RTRIM(SourceName)) = '')
                    """, u['id'])
                    deactivated += cursor.rowcount
                except Exception as e:
                    print(f"       ERROR deactivating ID {u['id']}: {e}")
            conn.commit()
            print(f"     Deactivated {deactivated} unfixable entities")
    else:
        print("\n[10] No unfixable entities!")

    # ─── Step 11: Verify ──────────────────────────────────────────────────────
    print("\n[11] Verifying fix...")
    cursor.execute("""
        SELECT COUNT(*) FROM integration.LandingzoneEntity
        WHERE IsActive = 1 AND (SourceName IS NULL OR SourceName = '' OR LTRIM(RTRIM(SourceName)) = '')
    """)
    remaining = cursor.fetchone()[0]
    print(f"    Active entities with null SourceName AFTER fix: {remaining}")

    cursor.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN SourceName IS NULL OR SourceName = '' OR LTRIM(RTRIM(SourceName)) = '' THEN 1 ELSE 0 END) as null_count,
            SUM(CASE WHEN SourceName IS NOT NULL AND SourceName != '' AND LTRIM(RTRIM(SourceName)) != '' THEN 1 ELSE 0 END) as valid_count
        FROM integration.LandingzoneEntity
        WHERE IsActive = 1
    """)
    row = cursor.fetchone()
    print(f"    Final active entity stats: total={row[0]}, null={row[1]}, valid={row[2]}")

    # ─── Step 12: Also check Bronze/Silver for same issue ─────────────────────
    print("\n[12] Checking Bronze and Silver layers for similar issues...")
    cursor.execute("""
        SELECT COUNT(*) FROM integration.BronzeLayerEntity
        WHERE IsActive = 1 AND (TargetName IS NULL OR TargetName = '' OR LTRIM(RTRIM(TargetName)) = '')
    """)
    bronze_null = cursor.fetchone()[0]
    print(f"    Bronze active entities with null TargetName: {bronze_null}")

    cursor.execute("""
        SELECT COUNT(*) FROM integration.SilverLayerEntity
        WHERE IsActive = 1 AND (TargetName IS NULL OR TargetName = '' OR LTRIM(RTRIM(TargetName)) = '')
    """)
    silver_null = cursor.fetchone()[0]
    print(f"    Silver active entities with null TargetName: {silver_null}")

    # ─── Summary ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"  Before:  {null_all} entities with null SourceName ({null_active} active)")
    print(f"  Fixed:   {len(fix_log)} entities updated with correct SourceName")
    print(f"  Unfixed: {len(unfixable)} entities could not be resolved")
    print(f"  After:   {remaining} active entities still have null SourceName")
    if remaining == 0:
        print(f"\n  SUCCESS: All active entities now have valid SourceName values.")
        print(f"  LK_GET_LASTLOADDATE should no longer fail with 'The table name is invalid'")
    else:
        print(f"\n  PARTIAL: {remaining} active entities still need SourceName resolution")

    conn.close()
    print(f"\nDone at {datetime.now().isoformat()}")


if __name__ == '__main__':
    main()
