"""
Deep diagnostic for SourceName issues in LandingzoneEntity
===========================================================
The simple null/empty check shows 0 affected entities, but pipelines still
fail with "The table name is invalid". Let's investigate deeper.
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
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)

def run_query(cursor, label, sql):
    """Run a query and print results."""
    print(f"\n--- {label} ---")
    try:
        cursor.execute(sql)
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        if not rows:
            print("  (no rows)")
            return rows

        # Calculate column widths
        widths = [max(len(str(col)), max(len(str(r[i] if r[i] is not None else 'NULL')) for r in rows)) for i, col in enumerate(cols)]
        widths = [min(w, 60) for w in widths]

        # Print header
        header = "  " + " | ".join(str(c).ljust(w) for c, w in zip(cols, widths))
        print(header)
        print("  " + "-+-".join("-" * w for w in widths))

        # Print rows (max 30)
        for r in rows[:30]:
            line = "  " + " | ".join(str(r[i] if r[i] is not None else 'NULL').ljust(w)[:w] for i, w in enumerate(widths))
            print(line)
        if len(rows) > 30:
            print(f"  ... ({len(rows)} total rows, showing first 30)")

        return rows
    except Exception as e:
        print(f"  ERROR: {e}")
        return []

def main():
    print("=" * 80)
    print(f"Deep SourceName Diagnostic — {datetime.now().isoformat()}")
    print("=" * 80)

    conn = connect_fabric()
    cursor = conn.cursor()
    print("Connected to Fabric SQL DB.\n")

    # 1. Total entity counts
    run_query(cursor, "1. Entity totals", """
        SELECT
            COUNT(*) as Total,
            SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) as Active,
            SUM(CASE WHEN IsActive = 0 THEN 1 ELSE 0 END) as Inactive
        FROM integration.LandingzoneEntity
    """)

    # 2. Check for whitespace-only or suspicious SourceName values
    run_query(cursor, "2. SourceName length distribution (looking for short/empty-ish)", """
        SELECT
            LEN(SourceName) as NameLen,
            COUNT(*) as cnt
        FROM integration.LandingzoneEntity
        WHERE LEN(SourceName) <= 3 OR SourceName IS NULL
        GROUP BY LEN(SourceName)
        ORDER BY LEN(SourceName)
    """)

    # 3. Check for SourceName with only whitespace
    run_query(cursor, "3. Entities with whitespace-only or single-char SourceName", """
        SELECT TOP 20 LandingzoneEntityId, DataSourceId, SourceSchema,
               SourceName, LEN(SourceName) as NameLen,
               UNICODE(SourceName) as FirstCharCode, IsActive
        FROM integration.LandingzoneEntity
        WHERE LEN(LTRIM(RTRIM(SourceName))) <= 1
        ORDER BY LEN(SourceName)
    """)

    # 4. Check the execution views that the pipeline actually uses
    run_query(cursor, "4a. List all views in execution schema", """
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.VIEWS
        WHERE TABLE_SCHEMA = 'execution'
        ORDER BY TABLE_NAME
    """)

    # 4b. Check the LZ view definition
    run_query(cursor, "4b. vw_LoadSourceToLandingzone definition", """
        SELECT TOP 1 VIEW_DEFINITION
        FROM INFORMATION_SCHEMA.VIEWS
        WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'vw_LoadSourceToLandingzone'
    """)

    # 5. Sample from the execution view to see what the pipeline sees
    run_query(cursor, "5a. vw_LoadSourceToLandingzone sample (first 10)", """
        SELECT TOP 10 EntityId, DataSourceId, SourceSchema, SourceName, IsIncremental
        FROM execution.vw_LoadSourceToLandingzone
        ORDER BY EntityId
    """)

    # 5b. Check for NULL SourceName in the view
    run_query(cursor, "5b. vw_LoadSourceToLandingzone - entities with null/empty SourceName", """
        SELECT COUNT(*) as NullSourceNameInView
        FROM execution.vw_LoadSourceToLandingzone
        WHERE SourceName IS NULL OR SourceName = '' OR LTRIM(RTRIM(SourceName)) = ''
    """)

    # 6. Check TargetFileName which is what the LZ pipeline actually uses
    run_query(cursor, "6a. Entities with null/empty TargetFileName", """
        SELECT COUNT(*) as NullTargetFileName
        FROM integration.LandingzoneEntity
        WHERE IsActive = 1 AND (TargetFileName IS NULL OR TargetFileName = '' OR LTRIM(RTRIM(TargetFileName)) = '')
    """)

    run_query(cursor, "6b. TargetFileName sample", """
        SELECT TOP 10 LandingzoneEntityId, SourceSchema, SourceName, TargetFileName, TargetFilePath
        FROM integration.LandingzoneEntity
        WHERE IsActive = 1
        ORDER BY LandingzoneEntityId
    """)

    # 7. Check all columns in LandingzoneEntity
    run_query(cursor, "7. LandingzoneEntity column schema", """
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'LandingzoneEntity'
        ORDER BY ORDINAL_POSITION
    """)

    # 8. Check DataSource table
    run_query(cursor, "8. DataSource table", """
        SELECT * FROM integration.DataSource ORDER BY DataSourceId
    """)

    # 9. Breakdown by DataSource — how many entities per source
    run_query(cursor, "9. Entity count by DataSource (active only)", """
        SELECT ds.DataSourceId, ds.Namespace, ds.Name, ds.IsActive as DS_Active,
               COUNT(le.LandingzoneEntityId) as EntityCount,
               SUM(CASE WHEN le.IsActive = 1 THEN 1 ELSE 0 END) as ActiveEntities,
               SUM(CASE WHEN le.IsActive = 0 THEN 1 ELSE 0 END) as InactiveEntities
        FROM integration.DataSource ds
        LEFT JOIN integration.LandingzoneEntity le ON ds.DataSourceId = le.DataSourceId
        GROUP BY ds.DataSourceId, ds.Namespace, ds.Name, ds.IsActive
        ORDER BY ds.DataSourceId
    """)

    # 10. Check the stored proc that builds the JSON params
    run_query(cursor, "10. Stored procedures in execution schema", """
        SELECT p.name, s.name as schema_name
        FROM sys.procedures p
        JOIN sys.schemas s ON p.schema_id = s.schema_id
        WHERE s.name = 'execution'
        ORDER BY p.name
    """)

    # 11. Execute the sp_GetLandingzoneEntity and check for issues
    print("\n--- 11. Testing sp_GetLandingzoneEntity output ---")
    try:
        cursor.execute("EXEC execution.sp_GetLandingzoneEntity")
        row = cursor.fetchone()
        if row:
            result_json = row[0]
            if result_json:
                entities = json.loads(result_json)
                print(f"  Total entities in proc output: {len(entities)}")

                # Check for empty TargetName in the JSON
                empty_target = [e for e in entities if not e.get('params', {}).get('TargetName', '').strip()]
                print(f"  Entities with empty TargetName: {len(empty_target)}")
                if empty_target:
                    print(f"  First 5 empty TargetName entities:")
                    for e in empty_target[:5]:
                        print(f"    {json.dumps(e, indent=4)}")

                # Check for empty TargetSchema
                empty_schema = [e for e in entities if not e.get('params', {}).get('TargetSchema', '').strip()]
                print(f"  Entities with empty TargetSchema: {len(empty_schema)}")

                # Show first entity for reference
                if entities:
                    print(f"\n  Sample entity from proc output:")
                    print(f"    {json.dumps(entities[0], indent=4)}")
            else:
                print("  Proc returned NULL")
        else:
            print("  Proc returned no rows")
    except Exception as e:
        print(f"  ERROR executing proc: {e}")

    # 12. Check the LK_GET_LASTLOADDATE related view/table
    run_query(cursor, "12a. LandingzoneEntityLastLoadValue table", """
        SELECT TOP 10 *
        FROM execution.LandingzoneEntityLastLoadValue
        ORDER BY LandingzoneEntityId
    """)

    run_query(cursor, "12b. Count of entities in LastLoadValue table", """
        SELECT COUNT(*) as TotalLastLoadValues
        FROM execution.LandingzoneEntityLastLoadValue
    """)

    # 13. Check if SourceName contains the table name used by LK_GET_LASTLOADDATE
    # The lookup might use SourceName differently than we think
    run_query(cursor, "13. vw_LoadSourceToLandingzone full column list", """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'vw_LoadSourceToLandingzone'
        ORDER BY ORDINAL_POSITION
    """)

    # 14. Check BronzeLayerEntity schema
    run_query(cursor, "14. BronzeLayerEntity column schema", """
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'BronzeLayerEntity'
        ORDER BY ORDINAL_POSITION
    """)

    # 15. Check if Bronze entities have null target names
    run_query(cursor, "15. Bronze entities with null TargetEntityName", """
        SELECT COUNT(*) as NullCount
        FROM integration.BronzeLayerEntity
        WHERE IsActive = 1
        AND (TargetEntityName IS NULL OR TargetEntityName = '' OR LTRIM(RTRIM(TargetEntityName)) = '')
    """)

    conn.close()
    print(f"\nDiagnostic complete at {datetime.now().isoformat()}")

if __name__ == '__main__':
    main()
