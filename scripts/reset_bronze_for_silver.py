"""
Reset PipelineBronzeLayerEntity.IsProcessed = 0 so LOAD_SILVER can reprocess.

The Silver stored proc (sp_UpsertPipelineSilverLayerEntity) was missing its
output SELECT, causing execute_with_outputs() to silently fail the commit.
Result: Bronze records got marked as processed but Silver records never got created.

This script resets Bronze records so the Silver pipeline picks them up again.
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

# ── Current State ──
print("\n" + "=" * 70)
print("BEFORE RESET")
print("=" * 70)

cursor.execute("""
    SELECT IsProcessed, COUNT(*) as cnt
    FROM execution.PipelineBronzeLayerEntity
    GROUP BY IsProcessed
""")
rows = cursor.fetchall()
for r in rows:
    print(f"  IsProcessed={r[0]}: {r[1]} records")

cursor.execute("SELECT COUNT(*) FROM execution.PipelineSilverLayerEntity")
silver_cnt = cursor.fetchone()[0]
print(f"  PipelineSilverLayerEntity: {silver_cnt} records")

# ── Reset ──
print("\n" + "=" * 70)
print("RESETTING Bronze IsProcessed = 0")
print("=" * 70)

cursor.execute("""
    UPDATE execution.PipelineBronzeLayerEntity
    SET IsProcessed = 0, LoadEndDateTime = NULL
    WHERE IsProcessed = 1
""")
affected = cursor.rowcount
conn.commit()
print(f"  [OK] Reset {affected} Bronze records to IsProcessed=0")

# ── Verify ──
print("\n" + "=" * 70)
print("AFTER RESET")
print("=" * 70)

cursor.execute("""
    SELECT IsProcessed, COUNT(*) as cnt
    FROM execution.PipelineBronzeLayerEntity
    GROUP BY IsProcessed
""")
rows = cursor.fetchall()
for r in rows:
    print(f"  IsProcessed={r[0]}: {r[1]} records")

cursor.close()
conn.close()
print("\n[DONE] Bronze records reset. Run LOAD_SILVER to reprocess.")
print("  Use: python scripts/run_load_all.py --only LOAD_SILVER")
