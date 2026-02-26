"""Check what paths/GUIDs the Bronze view returns and if LZ files exist."""
import json, struct, pyodbc
from urllib.request import Request, urlopen
from urllib.parse import urlencode

import sys
from pathlib import Path
sys.path.append(os.path.join(os.path.dirname(__file__)))
try:
    from centralized_id_registry import IDRegistry
    registry = IDRegistry()
    TENANT = registry.config.get("tenant", {}).get("tenant_id", "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303")
    CLIENT = registry.config.get("tenant", {}).get("client_id", "ac937c5d-4bdd-438f-be8b-84a850021d2d")
    SERVER = registry.config.get("database", {}).get("db_endpoint", "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433")
    DATABASE = "SQL_INTEGRATION_FRAMEWORK-" + registry.config.get("database", {}).get("db_item_id", "501d6b17-fcee-47f3-bbb3-54e05f2a3fc0")
    WS_DATA = registry.config.get("workspaces", {}).get("DATA_DEV", "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a")
    LH_LZ = registry.config.get("lakehouses", {}).get("LANDINGZONE_DEV", "2aef4ede-2918-4a6b-8ec6-a42108c67806")
    LH_BRONZE = registry.config.get("lakehouses", {}).get("BRONZE_DEV", "cf57e8bf-7b34-471b-adea-ed80d05a4fdb")
except ImportError:
    TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
    CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
    SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
    DATABASE = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
    WS_DATA = 'a3a180ff-fbc2-48fd-a65f-27ae7bb6709a'
    LH_LZ = '2aef4ede-2918-4a6b-8ec6-a42108c67806'
    LH_BRONZE = 'cf57e8bf-7b34-471b-adea-ed80d05a4fdb'

SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'

def get_sql_token():
    data = urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': 'https://analysis.windows.net/powerbi/api/.default',
    }).encode()
    req = Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=data, method='POST'
    )
    return json.loads(urlopen(req).read())['access_token']

def get_onelake_token():
    data = urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': 'https://storage.azure.com/.default',
    }).encode()
    req = Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=data, method='POST'
    )
    return json.loads(urlopen(req).read())['access_token']

token = get_sql_token()
token_bytes = token.encode('UTF-16-LE')
token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
conn = pyodbc.connect(
    f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};PORT=1433;DATABASE={DATABASE};',
    attrs_before={1256: token_struct},
    timeout=30,
    autocommit=True
)
cur = conn.cursor()

# 1. Check what the view returns for a few entities
print('='*70)
print('SAMPLE ENTITIES FROM vw_LoadToBronzeLayer')
print('='*70)

cur.execute("""
    SELECT TOP 5
        EntityId, SourceFilePath, SourceFileName,
        SourceWorkspaceId, SourceLakehouseId, SourceLakehouseName,
        TargetWorkspaceId, TargetLakehouseId, TargetLakehouseName,
        TargetSchema, TargetName, DataSourceNamespace
    FROM [execution].[vw_LoadToBronzeLayer]
    ORDER BY SourceFileName ASC
""")
cols = [c[0] for c in cur.description]
for row in cur.fetchall():
    d = dict(zip(cols, row))
    print(f'\n  Entity {d["EntityId"]}: {d["DataSourceNamespace"]}/{d["TargetSchema"]}.{d["TargetName"]}')
    print(f'    Source: {d["SourceLakehouseName"]} ({d["SourceLakehouseId"]})')
    print(f'    Source WS: {d["SourceWorkspaceId"]}')
    print(f'    Source Path: Files/{d["SourceFilePath"]}/{d["SourceFileName"]}')
    print(f'    Target: {d["TargetLakehouseName"]} ({d["TargetLakehouseId"]})')
    print(f'    Target WS: {d["TargetWorkspaceId"]}')

    # Build the full abfss path the notebook would use
    abfss = f'abfss://{d["SourceWorkspaceId"]}@onelake.dfs.fabric.microsoft.com/{d["SourceLakehouseId"]}/Files/{d["SourceFilePath"]}/{d["SourceFileName"]}'
    print(f'    Full abfss: {abfss}')

# 2. Check known workspace/lakehouse IDs
print(f'\n{"="*70}')
print('EXPECTED LAKEHOUSE IDS')
print(f'{"="*70}')
print(f'  DATA workspace: {WS_DATA}')
print(f'  LH_DATA_LANDINGZONE: {LH_LZ}')
print(f'  LH_BRONZE_LAYER: {LH_BRONZE}')

# 3. Check distinct workspace/lakehouse combos in the view
print(f'\n{"="*70}')
print('DISTINCT SOURCE WORKSPACE + LAKEHOUSE IN VIEW')
print(f'{"="*70}')

cur.execute("""
    SELECT DISTINCT
        SourceWorkspaceId, SourceLakehouseId, SourceLakehouseName,
        COUNT(*) as cnt
    FROM [execution].[vw_LoadToBronzeLayer]
    GROUP BY SourceWorkspaceId, SourceLakehouseId, SourceLakehouseName
""")
for row in cur.fetchall():
    ws_match = 'MATCH' if str(row[0]).lower() == WS_DATA else 'MISMATCH!'
    lh_match = 'MATCH' if str(row[1]).lower() == LH_LZ else 'MISMATCH!'
    print(f'  WS: {row[0]} [{ws_match}]')
    print(f'  LH: {row[1]} [{lh_match}] ({row[2]})')
    print(f'  Count: {row[3]}')
    print()

print(f'{"="*70}')
print('DISTINCT TARGET WORKSPACE + LAKEHOUSE IN VIEW')
print(f'{"="*70}')

cur.execute("""
    SELECT DISTINCT
        TargetWorkspaceId, TargetLakehouseId, TargetLakehouseName,
        COUNT(*) as cnt
    FROM [execution].[vw_LoadToBronzeLayer]
    GROUP BY TargetWorkspaceId, TargetLakehouseId, TargetLakehouseName
""")
for row in cur.fetchall():
    ws_match = 'MATCH' if str(row[0]).lower() == WS_DATA else 'MISMATCH!'
    lh_match = 'MATCH' if str(row[1]).lower() == LH_BRONZE else 'MISMATCH!'
    print(f'  WS: {row[0]} [{ws_match}]')
    print(f'  LH: {row[1]} [{lh_match}] ({row[2]})')
    print(f'  Count: {row[3]}')
    print()

# 4. Check OneLake - are there actually files in the LZ?
print(f'{"="*70}')
print('ONELAKE: LANDING ZONE FILES')
print(f'{"="*70}')

try:
    ol_token = get_onelake_token()
    ws_id = WS_DATA
    lh_id = LH_LZ

    # List top-level directories in Files/
    url = f'https://onelake.dfs.fabric.microsoft.com/{ws_id}/{lh_id}/Files?resource=directory&recursive=false'
    req = Request(url, headers={'Authorization': f'Bearer {ol_token}'})
    try:
        resp = urlopen(req)
        paths = json.loads(resp.read()).get('paths', [])
        print(f'  Top-level dirs in Files/: {len(paths)}')
        for p in paths[:30]:
            print(f'    {p.get("name", "?")} (dir={p.get("isDirectory", "?")}, size={p.get("contentLength", "?")})')
    except Exception as e:
        err = str(e)
        # Try alternative - list at root level
        url2 = f'https://onelake.dfs.fabric.microsoft.com/{ws_id}/{lh_id}?resource=filesystem'
        req2 = Request(url2, headers={'Authorization': f'Bearer {ol_token}'})
        try:
            resp2 = urlopen(req2)
            paths = json.loads(resp2.read()).get('paths', [])
            print(f'  Root paths: {len(paths)}')
            for p in paths[:30]:
                print(f'    {p.get("name", "?")} (dir={p.get("isDirectory", "?")}, size={p.get("contentLength", "?")})')
        except Exception as e2:
            print(f'  Error listing: {e2}')

        # Also try with the lakehouse name
        url3 = f'https://onelake.dfs.fabric.microsoft.com/{ws_id}/LH_DATA_LANDINGZONE.Lakehouse/Files?resource=directory'
        req3 = Request(url3, headers={'Authorization': f'Bearer {ol_token}'})
        try:
            resp3 = urlopen(req3)
            paths = json.loads(resp3.read()).get('paths', [])
            print(f'  Files/ via name: {len(paths)}')
            for p in paths[:30]:
                print(f'    {p.get("name", "?")}')
        except Exception as e3:
            print(f'  Error via name: {e3}')

except Exception as e:
    print(f'  OneLake token error: {e}')

conn.close()
print(f'\n{"="*70}')
print('DONE')
print(f'{"="*70}')
