"""Detailed OneLake file check — prints actual paths returned."""
import json
from urllib.request import Request, urlopen
from urllib.parse import urlencode, quote
from urllib.error import HTTPError

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'

WS_DATA = 'a3a180ff-fbc2-48fd-a65f-27ae7bb6709a'
LH_LZ = '2aef4ede-2918-4a6b-8ec6-a42108c67806'

def get_token():
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

token = get_token()

def list_dir(directory, label=""):
    """List a directory in OneLake and return paths."""
    url = f'https://onelake.dfs.fabric.microsoft.com/{WS_DATA}/{LH_LZ}?resource=filesystem&directory={quote(directory)}&recursive=false'
    req = Request(url, headers={
        'Authorization': f'Bearer {token}',
        'x-ms-version': '2021-06-08',
    })
    try:
        resp = urlopen(req)
        data = json.loads(resp.read().decode())
        paths = data.get('paths', [])
        print(f'\n  [{label or directory}] ({len(paths)} items)')
        for p in paths:
            name = p.get('name', '?')
            is_dir = p.get('isDirectory', False)
            size = p.get('contentLength', '0')
            icon = '  DIR' if is_dir else ' FILE'
            print(f'    {icon}: {name} ({size} bytes)')
        return paths
    except HTTPError as e:
        body = e.read().decode()[:200]
        print(f'\n  [{label or directory}] Error {e.code}: {body[:100]}')
        return []
    except Exception as e:
        print(f'\n  [{label or directory}] Error: {str(e)[:100]}')
        return []

def list_dir_recursive(directory, depth=0, max_depth=4):
    """Recursively list a directory."""
    indent = '  ' * depth
    url = f'https://onelake.dfs.fabric.microsoft.com/{WS_DATA}/{LH_LZ}?resource=filesystem&directory={quote(directory)}&recursive=false'
    req = Request(url, headers={
        'Authorization': f'Bearer {token}',
        'x-ms-version': '2021-06-08',
    })
    try:
        resp = urlopen(req)
        data = json.loads(resp.read().decode())
        paths = data.get('paths', [])
        for p in paths:
            name = p.get('name', '?')
            is_dir = p.get('isDirectory', False)
            size = p.get('contentLength', '0')
            if is_dir:
                print(f'{indent}  DIR: {name}/')
                if depth < max_depth:
                    list_dir_recursive(name, depth + 1, max_depth)
            else:
                print(f'{indent} FILE: {name} ({size} bytes)')
        return paths
    except HTTPError as e:
        if e.code == 404:
            print(f'{indent}  (not found)')
        return []
    except Exception:
        return []


print('='*70)
print('ONELAKE LANDING ZONE - DETAILED FILE LISTING')
print(f'Workspace: {WS_DATA}')
print(f'Lakehouse: {LH_LZ}')
print('='*70)

# 1. List root
print('\n--- ROOT (Files/) ---')
root_paths = list_dir('Files', 'ROOT')

# 2. For each root dir, list contents
for p in root_paths:
    name = p.get('name', '')
    if p.get('isDirectory'):
        sub_paths = list_dir(name, name)
        # Go one more level
        for sp in sub_paths:
            sname = sp.get('name', '')
            if sp.get('isDirectory'):
                list_dir(sname, sname)

# 3. Try recursive listing of the full Files tree (max depth 4)
print('\n\n--- FULL RECURSIVE TREE (max depth 4) ---')
list_dir_recursive('Files', 0, 4)

# 4. Also check what the Bronze entity view says the paths should be
print('\n\n--- CHECKING ENTITY SOURCE PATHS ---')
# Get a few sample entity paths from SQL
import struct, pyodbc
SQL_TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
SQL_CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SQL_SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
DATABASE = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'

sql_token_data = urlencode({
    'grant_type': 'client_credentials',
    'client_id': SQL_CLIENT,
    'client_secret': SQL_SECRET,
    'scope': 'https://analysis.windows.net/powerbi/api/.default',
}).encode()
sql_req = Request(
    f'https://login.microsoftonline.com/{SQL_TENANT}/oauth2/v2.0/token',
    data=sql_token_data, method='POST'
)
sql_token = json.loads(urlopen(sql_req).read())['access_token']
sql_token_bytes = sql_token.encode('UTF-16-LE')
sql_token_struct = struct.pack(f'<I{len(sql_token_bytes)}s', len(sql_token_bytes), sql_token_bytes)
conn = pyodbc.connect(
    f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};PORT=1433;DATABASE={DATABASE};',
    attrs_before={1256: sql_token_struct},
    timeout=30,
    autocommit=True
)
cur = conn.cursor()

# Get 5 sample entity paths from the Bronze view
cur.execute("""
    SELECT TOP 5
        EntityId, SourceFilePath, SourceFileName,
        SourceLakehouseId, SourceLakehouseName,
        DataSourceNamespace, TargetName
    FROM [execution].[vw_LoadToBronzeLayer]
    ORDER BY EntityId ASC
""")
cols = [c[0] for c in cur.description]
for row in cur.fetchall():
    d = dict(zip(cols, row))
    full_path = f'Files/{d["SourceFilePath"]}/{d["SourceFileName"]}'
    print(f'\n  Entity {d["EntityId"]} ({d["DataSourceNamespace"]}.{d["TargetName"]})')
    print(f'    Expected path: {full_path}')
    print(f'    Lakehouse: {d["SourceLakehouseName"]} ({d["SourceLakehouseId"]})')

    # Check if this path exists in OneLake
    check_url = f'https://onelake.dfs.fabric.microsoft.com/{WS_DATA}/{LH_LZ}/{quote(full_path)}?resource=file'
    check_req = Request(check_url, method='HEAD', headers={
        'Authorization': f'Bearer {token}',
        'x-ms-version': '2021-06-08',
    })
    try:
        check_resp = urlopen(check_req)
        print(f'    STATUS: EXISTS ({check_resp.status})')
    except HTTPError as e:
        print(f'    STATUS: {e.code} ({"NOT FOUND" if e.code == 404 else "ERROR"})')
    except Exception as e:
        print(f'    STATUS: Error - {str(e)[:80]}')

conn.close()

print(f'\n{"="*70}')
print('DONE')
print(f'{"="*70}')
