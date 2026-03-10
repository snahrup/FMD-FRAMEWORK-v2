"""
Investigate and fix unprocessed Bronze entities + check Silver tracking.
Steps:
  1. Check why 6 M3 entities never loaded through LZ
  2. Fix 3 MES zombie Bronze rows
  3. Check PipelineSilverLayerEntity table creation
  4. Create PipelineSilverLayerEntity if missing
  5. Check Silver pending entities
  6. Summary counts
"""

import struct
import json
import urllib.request
import urllib.parse
import urllib.error
import pyodbc
import sys

# ── Config ──────────────────────────────────────────────────────────────────
TENANT   = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT   = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET   = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
SERVER   = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
DATABASE = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"

TARGET_BRONZE_IDS = [1565, 1569, 1570, 1571, 1575, 1657]
ZOMBIE_BRONZE_IDS = [310, 426, 1048]


def get_token():
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    body = urllib.parse.urlencode({
        "grant_type":    "client_credentials",
        "client_id":     CLIENT,
        "client_secret": SECRET,
        "scope":         "https://database.windows.net/.default",
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
        return data["access_token"]
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"Token request failed: {e.code}")
        print(f"Error body: {error_body}")
        raise


def get_connection(token_str):
    token_bytes = token_str.encode("UTF-16-LE")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        f"Encrypt=yes;"
        f"TrustServerCertificate=no;"
    )
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
    return conn


def run_query(cursor, sql, label=None, commit=False):
    """Execute a query, print results, return rows."""
    if label:
        print(f"\n{'='*80}")
        print(f"  {label}")
        print(f"{'='*80}")
    try:
        cursor.execute(sql)
    except Exception as e:
        print(f"  SQL ERROR: {e}")
        return []
    if commit:
        cursor.connection.commit()
    if cursor.description:
        cols = [d[0] for d in cursor.description]
        rows = cursor.fetchall()
        # Print header
        col_widths = []
        for i, c in enumerate(cols):
            max_w = len(c)
            for r in rows:
                val = str(r[i]) if r[i] is not None else "NULL"
                max_w = max(max_w, len(val))
            col_widths.append(min(max_w, 60))
        header = " | ".join(c.ljust(col_widths[i]) for i, c in enumerate(cols))
        print(header)
        print("-" * len(header))
        for r in rows:
            vals = []
            for i, v in enumerate(r):
                s = str(v) if v is not None else "NULL"
                if len(s) > 60:
                    s = s[:57] + "..."
                vals.append(s.ljust(col_widths[i]))
            print(" | ".join(vals))
        print(f"\n({len(rows)} row(s))")
        return rows
    else:
        rc = cursor.rowcount
        print(f"  -> {rc} row(s) affected")
        return rc


def main():
    print("Authenticating with Service Principal...")
    token = get_token()
    print("Token acquired. Connecting to Fabric SQL...")
    conn = get_connection(token)
    cursor = conn.cursor()
    print("Connected.\n")

    # ════════════════════════════════════════════════════════════════════════
    # STEP 1: Check why 6 M3 entities never loaded through LZ
    # ════════════════════════════════════════════════════════════════════════
    print("\n" + "#"*80)
    print("# STEP 1: Check why 6 M3 entities never loaded through LZ")
    print("#" + " "*78 + "#")
    print(f"# Target BronzeLayerEntityIds: {TARGET_BRONZE_IDS}")
    print("#"*80)

    # First check which of the 6 Bronze IDs actually exist
    ids_str = ",".join(str(x) for x in TARGET_BRONZE_IDS)
    run_query(cursor, f"""
        SELECT be.BronzeLayerEntityId, be.LandingzoneEntityId, be.Schema, be.Name, be.IsActive
        FROM integration.BronzeLayerEntity be
        WHERE be.BronzeLayerEntityId IN ({ids_str})
    """, "1a: BronzeLayerEntity rows for the 6 target IDs")

    # Get the LandingzoneEntityIds for the ones that exist
    cursor.execute(f"""
        SELECT DISTINCT be.LandingzoneEntityId
        FROM integration.BronzeLayerEntity be
        WHERE be.BronzeLayerEntityId IN ({ids_str})
    """)
    lz_ids = [row[0] for row in cursor.fetchall()]
    lz_ids_str = ",".join(str(x) for x in lz_ids) if lz_ids else "0"
    print(f"\n  Mapped LandingzoneEntityIds: {lz_ids}")

    # 1b: Check if these LZ entities appear in the LZ pending view
    # The view uses EntityId (which is LandingzoneEntityId)
    run_query(cursor, f"""
        SELECT * FROM execution.vw_LoadSourceToLandingzone
        WHERE EntityId IN ({lz_ids_str})
    """, "1b: LZ Pending View for these LZ entities")

    # 1c: LZ entity details (IsActive check)
    run_query(cursor, f"""
        SELECT le.LandingzoneEntityId, le.SourceName, le.SourceSchema, le.IsActive,
          le.FileName, le.IsIncremental, ds.Namespace, ds.DataSourceId
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.LandingzoneEntityId IN ({lz_ids_str})
    """, "1c: LZ Entity details (IsActive, FileName, DataSource)")

    # 1d: PipelineLandingzoneEntity rows — have they ever been picked up?
    run_query(cursor, f"""
        SELECT ple.PipelineLandingzoneEntityId, ple.LandingzoneEntityId,
          ple.FileName, ple.IsProcessed, ple.LoadEndDateTime, ple.InsertDateTime
        FROM execution.PipelineLandingzoneEntity ple
        WHERE ple.LandingzoneEntityId IN ({lz_ids_str})
    """, "1d: PipelineLandingzoneEntity rows (have they ever been picked up?)")

    # 1e: Check the DataSource connection for these entities
    run_query(cursor, f"""
        SELECT DISTINCT ds.DataSourceId, ds.Namespace, ds.Name as DSName, ds.DataSourceType,
          c.ConnectionType, c.ConnectionGuid
        FROM integration.DataSource ds
        JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
        JOIN integration.LandingzoneEntity le ON le.DataSourceId = ds.DataSourceId
        WHERE le.LandingzoneEntityId IN ({lz_ids_str})
    """, "1e: DataSource + Connection details for these entities")

    # ════════════════════════════════════════════════════════════════════════
    # STEP 2: Fix the 3 MES zombie Bronze rows
    # ════════════════════════════════════════════════════════════════════════
    print("\n" + "#"*80)
    print(f"# STEP 2: Fix 3 MES zombie Bronze rows ({ZOMBIE_BRONZE_IDS})")
    print("#"*80)

    zombie_ids_str = ",".join(str(x) for x in ZOMBIE_BRONZE_IDS)

    # 2a: Confirm zombie rows
    rows = run_query(cursor, f"""
        SELECT pbe.PipelineBronzeLayerEntityId, pbe.BronzeLayerEntityId, pbe.TableName,
          pbe.SchemaName, pbe.IsProcessed, pbe.LoadEndDateTime, pbe.InsertDateTime
        FROM execution.PipelineBronzeLayerEntity pbe
        WHERE pbe.BronzeLayerEntityId IN ({zombie_ids_str})
    """, "2a: Confirm zombie PipelineBronzeLayerEntity rows")

    # Count how many are actually zombies (IsProcessed=0)
    if rows and len(rows) > 0:
        zombie_count = sum(1 for r in rows if r[4] == False)  # IsProcessed column
        print(f"\n  Found {zombie_count} zombie rows (IsProcessed=0) out of {len(rows)} total")
    else:
        zombie_count = 0
        print("\n  No PipelineBronzeLayerEntity rows found for these IDs")

    # 2b: Delete zombie rows
    if zombie_count > 0:
        result = run_query(cursor, f"""
            DELETE FROM execution.PipelineBronzeLayerEntity
            WHERE BronzeLayerEntityId IN ({zombie_ids_str})
            AND IsProcessed = 0
        """, "2b: DELETE zombie rows (IsProcessed=0)", commit=True)
        print(f"  CONFIRMED: Deleted {result} zombie row(s)")
    else:
        print("\n  SKIP: No zombie rows to delete")

    # 2c: Verify they now appear in Bronze pending
    run_query(cursor, f"""
        SELECT * FROM execution.vw_LoadToBronzeLayer
        WHERE EntityId IN ({zombie_ids_str})
    """, "2c: Verify entities now appear in Bronze pending view")

    # 2d: Also show what entities 310, 426, 1048 are
    run_query(cursor, f"""
        SELECT be.BronzeLayerEntityId, be.LandingzoneEntityId, be.Schema, be.Name,
          le.SourceName, ds.Namespace
        FROM integration.BronzeLayerEntity be
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE be.BronzeLayerEntityId IN ({zombie_ids_str})
    """, "2d: Entity details for the 3 zombie Bronze IDs")

    # ════════════════════════════════════════════════════════════════════════
    # STEP 3: Check PipelineSilverLayerEntity table creation
    # ════════════════════════════════════════════════════════════════════════
    print("\n" + "#"*80)
    print("# STEP 3: Check PipelineSilverLayerEntity table + Silver stored procs")
    print("#"*80)

    # 3a: All execution tables
    run_query(cursor, """
        SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'execution'
        ORDER BY TABLE_NAME
    """, "3a: All tables/views in [execution] schema")

    # 3b: Silver stored procs
    run_query(cursor, """
        SELECT ROUTINE_SCHEMA, ROUTINE_NAME
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_NAME LIKE '%Silver%'
    """, "3b: Stored procs with 'Silver' in name")

    # 3c: Procs referencing PipelineSilverLayerEntity
    run_query(cursor, """
        SELECT ROUTINE_SCHEMA, ROUTINE_NAME, LEFT(ROUTINE_DEFINITION, 500) as def_preview
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_DEFINITION LIKE '%PipelineSilverLayerEntity%'
    """, "3c: Procs referencing PipelineSilverLayerEntity")

    # ════════════════════════════════════════════════════════════════════════
    # STEP 4: Create PipelineSilverLayerEntity table if it doesn't exist
    # ════════════════════════════════════════════════════════════════════════
    print("\n" + "#"*80)
    print("# STEP 4: Create PipelineSilverLayerEntity if missing")
    print("#"*80)

    # 4a: Check PipelineBronzeLayerEntity structure for reference
    run_query(cursor, """
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'PipelineBronzeLayerEntity'
        ORDER BY ORDINAL_POSITION
    """, "4a: PipelineBronzeLayerEntity structure (reference)")

    # 4b: Check if PipelineSilverLayerEntity already exists
    cursor.execute("""
        SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'PipelineSilverLayerEntity'
    """)
    exists = cursor.fetchone()[0]

    if exists:
        print("\n  PipelineSilverLayerEntity already exists -- skipping CREATE.")
        run_query(cursor, """
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'PipelineSilverLayerEntity'
            ORDER BY ORDINAL_POSITION
        """, "4b: Existing PipelineSilverLayerEntity structure")
    else:
        print("\n  PipelineSilverLayerEntity does NOT exist -- creating it now...")
        run_query(cursor, """
            CREATE TABLE execution.PipelineSilverLayerEntity (
                PipelineSilverLayerEntityId INT IDENTITY(1,1) PRIMARY KEY,
                SilverLayerEntityId INT NOT NULL,
                TableName NVARCHAR(200),
                SchemaName NVARCHAR(200),
                IsProcessed BIT NOT NULL DEFAULT 0,
                InsertDateTime DATETIME2 DEFAULT GETUTCDATE(),
                LoadEndDateTime DATETIME2 NULL
            )
        """, "4b: CREATE TABLE execution.PipelineSilverLayerEntity", commit=True)

        # Verify creation
        run_query(cursor, """
            SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME = 'PipelineSilverLayerEntity'
        """, "4c: Verify PipelineSilverLayerEntity was created")

        run_query(cursor, """
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'PipelineSilverLayerEntity'
            ORDER BY ORDINAL_POSITION
        """, "4d: New PipelineSilverLayerEntity structure")

    # ════════════════════════════════════════════════════════════════════════
    # STEP 5: Check Silver pending entities
    # ════════════════════════════════════════════════════════════════════════
    print("\n" + "#"*80)
    print("# STEP 5: Check Silver pending entities")
    print("#"*80)

    run_query(cursor, """
        SELECT * FROM execution.vw_LoadToSilverLayer
    """, "5a: Silver pending view (vw_LoadToSilverLayer) -- ALL rows")

    # Also check total Silver entity count
    run_query(cursor, """
        SELECT COUNT(*) as TotalSilverEntities,
          SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) as ActiveSilver
        FROM integration.SilverLayerEntity
    """, "5b: Total Silver entity counts")

    # Check if any Silver entities have been processed
    run_query(cursor, """
        SELECT COUNT(*) as ProcessedSilverPipelineRows
        FROM execution.PipelineSilverLayerEntity
        WHERE IsProcessed = 1
    """, "5c: Already-processed Silver pipeline entity rows")

    # ════════════════════════════════════════════════════════════════════════
    # STEP 6: Summary counts
    # ════════════════════════════════════════════════════════════════════════
    print("\n" + "#"*80)
    print("# STEP 6: Summary pipeline health counts")
    print("#"*80)

    run_query(cursor, """
        SELECT 'LZ Pending' as metric, COUNT(*) as cnt FROM execution.vw_LoadSourceToLandingzone
        UNION ALL
        SELECT 'Bronze Pending', COUNT(*) FROM execution.vw_LoadToBronzeLayer
        UNION ALL
        SELECT 'Silver Pending', COUNT(*) FROM execution.vw_LoadToSilverLayer
    """, "6a: Overall pipeline health summary")

    # Additional context: total registered entities per layer
    run_query(cursor, """
        SELECT 'LZ Total' as metric, COUNT(*) as cnt FROM integration.LandingzoneEntity WHERE IsActive = 1
        UNION ALL
        SELECT 'LZ Inactive', COUNT(*) FROM integration.LandingzoneEntity WHERE IsActive = 0
        UNION ALL
        SELECT 'Bronze Total', COUNT(*) FROM integration.BronzeLayerEntity WHERE IsActive = 1
        UNION ALL
        SELECT 'Bronze Inactive', COUNT(*) FROM integration.BronzeLayerEntity WHERE IsActive = 0
        UNION ALL
        SELECT 'Silver Total', COUNT(*) FROM integration.SilverLayerEntity WHERE IsActive = 1
        UNION ALL
        SELECT 'Silver Inactive', COUNT(*) FROM integration.SilverLayerEntity WHERE IsActive = 0
    """, "6b: Registered entity counts by layer")

    # Check LZ processed vs unprocessed
    run_query(cursor, """
        SELECT 'LZ Processed' as metric, COUNT(*) as cnt
        FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 1
        UNION ALL
        SELECT 'LZ Unprocessed', COUNT(*)
        FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 0
        UNION ALL
        SELECT 'Bronze Processed', COUNT(*)
        FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 1
        UNION ALL
        SELECT 'Bronze Unprocessed', COUNT(*)
        FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 0
    """, "6c: Pipeline processing status")

    cursor.close()
    conn.close()
    print("\n" + "="*80)
    print("  DONE -- all 6 steps completed successfully.")
    print("="*80)


if __name__ == "__main__":
    main()
