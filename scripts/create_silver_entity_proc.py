"""
Create sp_UpsertPipelineSilverLayerEntity stored procedure
modeled after sp_UpsertPipelineBronzeLayerEntity.

Steps:
  1. Query the Bronze proc definition
  2. Create the Silver equivalent
  3. Verify both table and proc exist
"""

import struct
import json
import urllib.request
import urllib.parse
import pyodbc

# ── Config ──────────────────────────────────────────────────────────────
TENANT   = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT   = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET   = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
SERVER   = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
DATABASE = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"

# ── Get SP token ────────────────────────────────────────────────────────
token_url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
token_data = urllib.parse.urlencode({
    "grant_type": "client_credentials",
    "client_id": CLIENT,
    "client_secret": SECRET,
    "scope": "https://database.windows.net/.default",
}).encode()

req = urllib.request.Request(token_url, data=token_data, method="POST")
with urllib.request.urlopen(req) as resp:
    token_json = json.loads(resp.read())
access_token = token_json["access_token"]
token_bytes = access_token.encode("UTF-16-LE")
token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

print("[OK] Token acquired")

# ── Connect ─────────────────────────────────────────────────────────────
conn_str = (
    "Driver={ODBC Driver 18 for SQL Server};"
    f"Server={SERVER};"
    f"Database={DATABASE};"
    "Encrypt=Yes;TrustServerCertificate=No;"
)
conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
cursor = conn.cursor()
print("[OK] Connected to Fabric SQL")

# ── STEP 1: Get Bronze proc definition ─────────────────────────────────
print("\n" + "=" * 80)
print("STEP 1: Bronze proc definition")
print("=" * 80)

cursor.execute("""
    SELECT ROUTINE_DEFINITION
    FROM INFORMATION_SCHEMA.ROUTINES
    WHERE ROUTINE_NAME = 'sp_UpsertPipelineBronzeLayerEntity'
""")
row = cursor.fetchone()
if row:
    bronze_def = row[0]
    print(bronze_def)
else:
    print("[WARN] Bronze proc not found in INFORMATION_SCHEMA — trying sys.sql_modules")
    cursor.execute("""
        SELECT m.definition
        FROM sys.sql_modules m
        JOIN sys.objects o ON m.object_id = o.object_id
        WHERE o.name = 'sp_UpsertPipelineBronzeLayerEntity'
    """)
    row = cursor.fetchone()
    if row:
        bronze_def = row[0]
        print(bronze_def)
    else:
        bronze_def = None
        print("[ERROR] Could not retrieve Bronze proc definition from any source")

# ── Also check what columns the Silver table has ────────────────────────
print("\n" + "=" * 80)
print("PipelineSilverLayerEntity table columns")
print("=" * 80)

cursor.execute("""
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'execution'
      AND TABLE_NAME = 'PipelineSilverLayerEntity'
    ORDER BY ORDINAL_POSITION
""")
cols = cursor.fetchall()
if cols:
    for c in cols:
        print(f"  {c[0]:40s} {c[1]:15s} len={c[2]}  nullable={c[3]}  default={c[4]}")
else:
    print("[WARN] Table execution.PipelineSilverLayerEntity not found — checking if it needs to be created")

# ── STEP 2: Create the Silver proc ─────────────────────────────────────
print("\n" + "=" * 80)
print("STEP 2: Creating sp_UpsertPipelineSilverLayerEntity")
print("=" * 80)

# Build the CREATE statement modeled after Bronze proc
silver_proc_sql = """
CREATE OR ALTER PROCEDURE [execution].[sp_UpsertPipelineSilverLayerEntity]
    @SchemaName NVARCHAR(200) = NULL,
    @TableName NVARCHAR(200) = NULL,
    @IsProcessed BIT = 0,
    @SilverLayerEntityId INT
WITH EXECUTE AS CALLER
AS
SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM [execution].[PipelineSilverLayerEntity]
    WHERE [SilverLayerEntityId] = @SilverLayerEntityId
    AND [IsProcessed] = 0
)
BEGIN
    INSERT INTO [execution].[PipelineSilverLayerEntity]
        ([SilverLayerEntityId], [TableName], [SchemaName], [IsProcessed], [InsertDateTime], [LoadEndDateTime])
    VALUES
        (@SilverLayerEntityId, @TableName, @SchemaName, @IsProcessed, GETUTCDATE(),
         CASE WHEN @IsProcessed = 1 THEN GETUTCDATE() ELSE NULL END);
END
ELSE
BEGIN
    UPDATE [execution].[PipelineSilverLayerEntity]
    SET [IsProcessed] = @IsProcessed,
        [LoadEndDateTime] = CASE WHEN @IsProcessed = 1 THEN GETUTCDATE() ELSE [LoadEndDateTime] END,
        [TableName] = COALESCE(@TableName, [TableName]),
        [SchemaName] = COALESCE(@SchemaName, [SchemaName])
    WHERE [SilverLayerEntityId] = @SilverLayerEntityId
    AND [IsProcessed] = 0;
END
""".strip()

print("SQL to execute:")
print(silver_proc_sql)
print()

try:
    cursor.execute(silver_proc_sql)
    conn.commit()
    print("[OK] sp_UpsertPipelineSilverLayerEntity created successfully")
except pyodbc.Error as e:
    print(f"[ERROR] Failed to create proc: {e}")
    # If CREATE OR ALTER isn't supported, try DROP + CREATE
    if "CREATE OR ALTER" in str(e) or "Incorrect syntax" in str(e):
        print("[RETRY] Trying DROP IF EXISTS + CREATE...")
        try:
            cursor.execute("DROP PROCEDURE IF EXISTS [execution].[sp_UpsertPipelineSilverLayerEntity]")
            conn.commit()
            # Replace CREATE OR ALTER with just CREATE
            create_only = silver_proc_sql.replace("CREATE OR ALTER", "CREATE")
            cursor.execute(create_only)
            conn.commit()
            print("[OK] sp_UpsertPipelineSilverLayerEntity created successfully (DROP+CREATE)")
        except pyodbc.Error as e2:
            print(f"[ERROR] DROP+CREATE also failed: {e2}")

# ── STEP 3: Verify ─────────────────────────────────────────────────────
print("\n" + "=" * 80)
print("STEP 3: Verification")
print("=" * 80)

# Verify proc exists
print("\n--- Stored procedures matching '*SilverLayerEntity*' ---")
cursor.execute("""
    SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE, CREATED, LAST_ALTERED
    FROM INFORMATION_SCHEMA.ROUTINES
    WHERE ROUTINE_NAME LIKE '%SilverLayerEntity%'
""")
procs = cursor.fetchall()
if procs:
    for p in procs:
        print(f"  [{p[0]}].[{p[1]}]  type={p[2]}  created={p[3]}  altered={p[4]}")
else:
    print("  (none found)")

# Verify table exists
print("\n--- Tables matching '*SilverLayerEntity*' ---")
cursor.execute("""
    SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%SilverLayerEntity%'
""")
tables = cursor.fetchall()
if tables:
    for t in tables:
        print(f"  [{t[0]}].[{t[1]}]  type={t[2]}")
else:
    print("  (none found)")

# Also show the Bronze proc for comparison
print("\n--- All Bronze + Silver pipeline procs ---")
cursor.execute("""
    SELECT ROUTINE_SCHEMA, ROUTINE_NAME
    FROM INFORMATION_SCHEMA.ROUTINES
    WHERE ROUTINE_NAME LIKE '%PipelineBronzeLayerEntity%'
       OR ROUTINE_NAME LIKE '%PipelineSilverLayerEntity%'
    ORDER BY ROUTINE_NAME
""")
all_procs = cursor.fetchall()
for p in all_procs:
    print(f"  [{p[0]}].[{p[1]}]")

cursor.close()
conn.close()
print("\n[DONE] Script complete")
