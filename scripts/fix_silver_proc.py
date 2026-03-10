"""
Fix sp_UpsertPipelineSilverLayerEntity: add output SELECT.

The Silver proc was missing the final SELECT statement that the Bronze proc has.
Without it, execute_with_outputs() gets no result set and cursor.commit() may
fail silently (bare except:pass swallows the error).

This script:
  1. Queries current Silver proc definition
  2. Deploys the fixed version with output SELECT
  3. Also queries Bronze proc for comparison
  4. Checks PipelineSilverLayerEntity row count
"""

import struct
import json
import urllib.request
import urllib.parse
import os
import pyodbc

# ── Config ──
TENANT = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT = "ac937c5d-4bdd-438f-be8b-84a850021d2d"

def get_client_secret():
    env_path = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'app', 'api', '.env')
    with open(env_path) as f:
        for line in f:
            if line.startswith('FABRIC_CLIENT_SECRET='):
                return line.strip().split('=', 1)[1]
    raise RuntimeError('FABRIC_CLIENT_SECRET not found in .env')

SECRET = get_client_secret()

SERVER = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
DATABASE = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"

# ── Get SP token ──
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

# ── Connect ──
conn_str = (
    "Driver={ODBC Driver 18 for SQL Server};"
    f"Server={SERVER};"
    f"Database={DATABASE};"
    "Encrypt=Yes;TrustServerCertificate=No;"
)
conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
cursor = conn.cursor()
print("[OK] Connected to Fabric SQL")

# ── Step 1: Check current state ──
print("\n" + "=" * 70)
print("STEP 1: Current state")
print("=" * 70)

# Check Silver proc exists
cursor.execute("""
    SELECT m.definition
    FROM sys.sql_modules m
    JOIN sys.objects o ON m.object_id = o.object_id
    WHERE o.name = 'sp_UpsertPipelineSilverLayerEntity'
""")
row = cursor.fetchone()
if row:
    silver_def = row[0]
    has_output_select = 'SELECT @SilverLayerEntityId' in silver_def
    print(f"  Silver proc exists, has output SELECT: {has_output_select}")
    if has_output_select:
        print("  [SKIP] Silver proc already has output SELECT - no fix needed")
else:
    silver_def = None
    print("  [WARN] Silver proc not found!")

# Check Bronze proc for comparison
cursor.execute("""
    SELECT m.definition
    FROM sys.sql_modules m
    JOIN sys.objects o ON m.object_id = o.object_id
    WHERE o.name = 'sp_UpsertPipelineBronzeLayerEntity'
""")
row = cursor.fetchone()
if row:
    bronze_def = row[0]
    bronze_has_select = 'SELECT @BronzeLayerEntityId' in bronze_def
    print(f"  Bronze proc exists, has output SELECT: {bronze_has_select}")
else:
    print("  [WARN] Bronze proc not found!")

# Check row counts
cursor.execute("SELECT COUNT(*) FROM execution.PipelineSilverLayerEntity")
silver_count = cursor.fetchone()[0]
cursor.execute("SELECT COUNT(*) FROM execution.PipelineBronzeLayerEntity")
bronze_count = cursor.fetchone()[0]
print(f"\n  PipelineBronzeLayerEntity rows: {bronze_count}")
print(f"  PipelineSilverLayerEntity rows: {silver_count}")

# ── Step 2: Deploy fixed proc ──
print("\n" + "=" * 70)
print("STEP 2: Deploying fixed sp_UpsertPipelineSilverLayerEntity")
print("=" * 70)

fixed_proc_sql = """
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

-- Output SELECT required by execute_with_outputs() to properly commit
SELECT @SilverLayerEntityId AS SilverLayerEntityId;
""".strip()

try:
    cursor.execute(fixed_proc_sql)
    conn.commit()
    print("[OK] sp_UpsertPipelineSilverLayerEntity deployed with output SELECT")
except Exception as e:
    print(f"[ERROR] Failed to deploy: {e}")

# ── Step 3: Verify ──
print("\n" + "=" * 70)
print("STEP 3: Verification")
print("=" * 70)

cursor.execute("""
    SELECT m.definition
    FROM sys.sql_modules m
    JOIN sys.objects o ON m.object_id = o.object_id
    WHERE o.name = 'sp_UpsertPipelineSilverLayerEntity'
""")
row = cursor.fetchone()
if row:
    new_def = row[0]
    has_select = 'SELECT @SilverLayerEntityId' in new_def
    print(f"  Silver proc has output SELECT: {has_select}")
    if has_select:
        print("  [OK] Fix verified!")
    else:
        print("  [FAIL] Output SELECT not found in deployed proc")
else:
    print("  [FAIL] Proc not found after deploy!")

# ── Step 4: Quick test ──
print("\n" + "=" * 70)
print("STEP 4: Quick test (dry run with a non-existent entity)")
print("=" * 70)

# Use entity ID 999999 which won't exist - test that the proc runs and returns a result
try:
    cursor.execute("""
        EXEC [execution].[sp_UpsertPipelineSilverLayerEntity]
            @SchemaName = 'test_schema',
            @TableName = 'test_table',
            @IsProcessed = 0,
            @SilverLayerEntityId = 999999
    """)
    # Collect result
    if cursor.description:
        cols = [d[0] for d in cursor.description]
        row = cursor.fetchone()
        if row:
            result = dict(zip(cols, row))
            print(f"  Result: {result}")
            print("  [OK] Proc returns result set correctly")
        else:
            print("  [WARN] No row returned")
    else:
        print("  [FAIL] No result set - output SELECT not working")

    # Rollback test data
    conn.rollback()
    print("  [OK] Test data rolled back")
except Exception as e:
    print(f"  [ERROR] Test failed: {e}")
    conn.rollback()

cursor.close()
conn.close()
print("\n[DONE] Script complete")
