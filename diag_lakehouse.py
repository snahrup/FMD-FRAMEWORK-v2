#!/usr/bin/env python3
"""Quick check: are lakehouse GUIDs correct in the metadata?"""
import json, os, struct, time
from urllib.request import Request, urlopen
from urllib.parse import urlencode

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = ""
DB_ITEM_ID = "501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"
DB_ENDPOINT = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"

env_path = os.path.join(os.path.dirname(__file__), "dashboard", "app", "api", ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                CLIENT_SECRET = line.split("=", 1)[1].strip()

_tc = {}
def get_token(scope="https://database.windows.net/.default"):
    if scope in _tc and time.time() < _tc[scope]["e"] - 60:
        return _tc[scope]["t"]
    data = urlencode({"grant_type":"client_credentials","client_id":CLIENT_ID,
        "client_secret":CLIENT_SECRET,"scope":scope}).encode()
    req = Request(f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",data=data,method="POST")
    with urlopen(req) as resp:
        r = json.loads(resp.read())
    _tc[scope] = {"t":r["access_token"],"e":time.time()+r.get("expires_in",3600)}
    return _tc[scope]["t"]

def query_sql(q):
    import pyodbc
    t = get_token()
    tb = t.encode("utf-16-le")
    ts = struct.pack(f"<I{len(tb)}s", len(tb), tb)
    s = DB_ENDPOINT.replace(",1433","")
    cs = f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={s},1433;DATABASE=SQL_INTEGRATION_FRAMEWORK-{DB_ITEM_ID};Encrypt=Yes;TrustServerCertificate=No;"
    conn = pyodbc.connect(cs, attrs_before={1256: ts})
    cur = conn.cursor()
    cur.execute(q)
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    conn.close()
    return cols, rows

print("--- Lakehouse table ---")
cols, rows = query_sql("SELECT * FROM [integration].[Lakehouse]")
print(f"Columns: {cols}")
for r in rows:
    print(f"  {list(r)}")

print("\n--- View TargetLakehouseGuid and WorkspaceGuid ---")
cols, rows = query_sql(
    "SELECT DISTINCT TargetLakehouseGuid, WorkspaceGuid "
    "FROM [execution].[vw_LoadSourceToLandingzone]"
)
for r in rows:
    print(f"  LH={r[0]}, WS={r[1]}")

print(f"\n--- Expected values ---")
print(f"  LH_DATA_LANDINGZONE should be: 2aef4ede-2918-4a6b-8ec6-a42108c67806")
print(f"  DATA workspace should be: a3a180ff-fbc2-48fd-a65f-27ae7bb6709a")

print("\n--- Connection GUIDs in use ---")
cols, rows = query_sql(
    "SELECT DISTINCT ConnectionGuid FROM [execution].[vw_LoadSourceToLandingzone]"
)
for r in rows:
    print(f"  {r[0]}")

print("\n--- Sample entities (first 3) ---")
cols, rows = query_sql(
    "SELECT TOP 3 EntityId, DataSourceName, SourceSchema, SourceName, "
    "ConnectionGuid, TargetLakehouseGuid, WorkspaceGuid, SourceDataRetrieval "
    "FROM [execution].[vw_LoadSourceToLandingzone]"
)
for r in rows:
    print(f"  Entity {r[0]}: {r[1]}.{r[2]}.{r[3]}")
    print(f"    ConnectionGuid: {r[4]}")
    print(f"    LakehouseGuid: {r[5]}")
    print(f"    WorkspaceGuid: {r[6]}")
    print(f"    SourceDataRetrieval: {str(r[7])[:100]}")
