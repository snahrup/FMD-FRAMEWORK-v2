"""
Fix Bronze/Silver entity activation + populate pipeline queue tables.

Root cause: Bronze entities exist but IsActive=0, pipeline queue tables empty.
This causes sp_GetBronzelayerEntity and sp_GetSilverlayerEntity to return [].
"""
import json
import os
import struct
import pyodbc
import urllib.request
import urllib.parse
from pathlib import Path

# Load config + .env
env_path = Path(__file__).resolve().parent.parent / "dashboard" / "app" / "api" / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

config_path = Path(__file__).resolve().parent.parent / "dashboard" / "app" / "api" / "config.json"
with open(config_path) as f:
    cfg = json.load(f)

secret = os.environ.get("FABRIC_CLIENT_SECRET", cfg["fabric"].get("client_secret", ""))
tenant = cfg["fabric"]["tenant_id"]
client = cfg["fabric"]["client_id"]

# Get SQL token
data = urllib.parse.urlencode({
    "grant_type": "client_credentials",
    "client_id": client,
    "client_secret": secret,
    "scope": "https://analysis.windows.net/powerbi/api/.default",
}).encode()
req = urllib.request.Request(
    f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", data=data
)
resp = json.loads(urllib.request.urlopen(req).read())
token = resp["access_token"]
token_bytes = token.encode("UTF-16-LE")
token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

conn = pyodbc.connect(
    f"DRIVER={{ODBC Driver 18 for SQL Server}};"
    f"SERVER={cfg['sql']['server']};PORT=1433;"
    f"DATABASE={cfg['sql']['database']};",
    attrs_before={1256: token_struct},
    timeout=60,
)
conn.autocommit = True

# === Step 1: Activate Bronze entities for active LZ entities ===
print("Step 1: Activate Bronze entities...")
with conn.cursor() as cur:
    cur.execute("""
        UPDATE BLE SET IsActive = 1
        FROM integration.BronzeLayerEntity BLE
        INNER JOIN integration.LandingzoneEntity LZE
            ON LZE.LandingzoneEntityId = BLE.LandingzoneEntityId
        WHERE LZE.IsActive = 1 AND BLE.IsActive = 0
    """)
    print(f"  Activated {cur.rowcount} Bronze entities")

# === Step 2: Activate Silver entities ===
print("Step 2: Activate Silver entities...")
with conn.cursor() as cur:
    cur.execute("""
        UPDATE SLE SET IsActive = 1
        FROM integration.SilverLayerEntity SLE
        INNER JOIN integration.BronzeLayerEntity BLE
            ON BLE.BronzeLayerEntityId = SLE.BronzeLayerEntityId
        INNER JOIN integration.LandingzoneEntity LZE
            ON LZE.LandingzoneEntityId = BLE.LandingzoneEntityId
        WHERE LZE.IsActive = 1 AND BLE.IsActive = 1 AND SLE.IsActive = 0
    """)
    print(f"  Activated {cur.rowcount} Silver entities")

# === Step 3: Populate PipelineLandingzoneEntity queue ===
print("Step 3: Populate LZ queue...")
with conn.cursor() as cur:
    cur.execute("""
        INSERT INTO execution.PipelineLandingzoneEntity
            (LandingzoneEntityId, FilePath, FileName, InsertDateTime, IsProcessed)
        SELECT
            LZE.LandingzoneEntityId,
            COALESCE(DS.Namespace, 'default') + '/' AS FilePath,
            LZE.SourceName + '.parquet' AS FileName,
            GETUTCDATE(),
            0
        FROM integration.LandingzoneEntity LZE
        INNER JOIN integration.DataSource DS ON DS.DataSourceId = LZE.DataSourceId
        WHERE LZE.IsActive = 1
        AND NOT EXISTS (
            SELECT 1 FROM execution.PipelineLandingzoneEntity PLZE
            WHERE PLZE.LandingzoneEntityId = LZE.LandingzoneEntityId
        )
    """)
    print(f"  Inserted {cur.rowcount} LZ queue entries")

with conn.cursor() as cur:
    cur.execute(
        "UPDATE execution.PipelineLandingzoneEntity SET IsProcessed = 0 WHERE IsProcessed = 1"
    )
    print(f"  Reset {cur.rowcount} existing LZ queue entries to IsProcessed=0")

# === Step 4: Populate PipelineBronzeLayerEntity queue ===
print("Step 4: Populate Bronze queue...")
with conn.cursor() as cur:
    cur.execute("""
        INSERT INTO execution.PipelineBronzeLayerEntity
            (BronzeLayerEntityId, TableName, SchemaName, InsertDateTime, IsProcessed)
        SELECT
            BLE.BronzeLayerEntityId,
            BLE.Name AS TableName,
            BLE.[Schema] AS SchemaName,
            GETUTCDATE(),
            0
        FROM integration.BronzeLayerEntity BLE
        WHERE BLE.IsActive = 1
        AND NOT EXISTS (
            SELECT 1 FROM execution.PipelineBronzeLayerEntity PBLE
            WHERE PBLE.BronzeLayerEntityId = BLE.BronzeLayerEntityId
        )
    """)
    print(f"  Inserted {cur.rowcount} Bronze queue entries")

with conn.cursor() as cur:
    cur.execute(
        "UPDATE execution.PipelineBronzeLayerEntity SET IsProcessed = 0 WHERE IsProcessed = 1"
    )
    print(f"  Reset {cur.rowcount} existing Bronze queue entries to IsProcessed=0")

# === Verify ===
print("\n=== Verification ===")
with conn.cursor() as cur:
    cur.execute("SELECT IsActive, COUNT(*) FROM integration.BronzeLayerEntity GROUP BY IsActive")
    for row in cur.fetchall():
        print(f"  Bronze IsActive={row[0]}: {row[1]}")

with conn.cursor() as cur:
    cur.execute("SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 0")
    print(f"  LZ queue ready: {cur.fetchone()[0]}")

with conn.cursor() as cur:
    cur.execute("SELECT COUNT(*) FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 0")
    print(f"  Bronze queue ready: {cur.fetchone()[0]}")

# Test stored procs
print("\n=== Testing stored procs ===")
with conn.cursor() as cur:
    cur.execute("EXEC [execution].[sp_GetBronzelayerEntity]")
    row = cur.fetchone()
    if row and row[0]:
        entities = json.loads(row[0])
        print(f"  sp_GetBronzelayerEntity: {len(entities)} entities")
    else:
        print("  sp_GetBronzelayerEntity: EMPTY!")

with conn.cursor() as cur:
    cur.execute("EXEC [execution].[sp_GetSilverlayerEntity]")
    row = cur.fetchone()
    if row and row[0]:
        entities = json.loads(row[0])
        print(f"  sp_GetSilverlayerEntity: {len(entities)} entities")
    else:
        print("  sp_GetSilverlayerEntity: EMPTY!")

conn.close()
print("\nDone.")
