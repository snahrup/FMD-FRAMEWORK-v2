"""Check if Landing Zone files actually exist in OneLake."""
import json
from urllib.request import Request, urlopen
from urllib.parse import urlencode, quote
from urllib.error import HTTPError

import sys
from pathlib import Path
sys.path.append(os.path.join(os.path.dirname(__file__)))
try:
    from centralized_id_registry import IDRegistry
    registry = IDRegistry()
    TENANT = registry.config.get("tenant", {}).get("tenant_id", "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303")
    CLIENT = registry.config.get("tenant", {}).get("client_id", "ac937c5d-4bdd-438f-be8b-84a850021d2d")
    WS_DATA = registry.config.get("workspaces", {}).get("DATA_DEV", "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a")
    LH_LZ = registry.config.get("lakehouses", {}).get("LANDINGZONE_DEV", "2aef4ede-2918-4a6b-8ec6-a42108c67806")
except ImportError:
    TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
    CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
    WS_DATA = 'a3a180ff-fbc2-48fd-a65f-27ae7bb6709a'
    LH_LZ = '2aef4ede-2918-4a6b-8ec6-a42108c67806'

SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'

def get_token(scope):
    data = urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': scope,
    }).encode()
    req = Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=data, method='POST'
    )
    return json.loads(urlopen(req).read())['access_token']

# Try multiple scopes for OneLake
scopes = [
    'https://storage.azure.com/.default',
    'https://onelake.dfs.fabric.microsoft.com/.default',
]

for scope in scopes:
    print(f'\n{"="*70}')
    print(f'TRYING SCOPE: {scope}')
    print(f'{"="*70}')

    try:
        token = get_token(scope)
        print(f'  Token OK (first 20 chars: {token[:20]}...)')
    except Exception as e:
        print(f'  Token FAILED: {e}')
        continue

    # Try listing root of lakehouse filesystem
    urls_to_try = [
        # ADLS Gen2 path format: list filesystem
        f'https://onelake.dfs.fabric.microsoft.com/{WS_DATA}/{LH_LZ}?resource=filesystem&recursive=false',
        # List directory 'Files'
        f'https://onelake.dfs.fabric.microsoft.com/{WS_DATA}/{LH_LZ}?resource=filesystem&directory=Files&recursive=false',
        # Alternative format with path
        f'https://onelake.dfs.fabric.microsoft.com/{WS_DATA}/{LH_LZ}/Files?resource=directory&recursive=false',
    ]

    for url in urls_to_try:
        print(f'\n  URL: {url}')
        req = Request(url, headers={
            'Authorization': f'Bearer {token}',
            'x-ms-version': '2021-06-08',
        })
        try:
            resp = urlopen(req)
            body = resp.read().decode()
            print(f'  Status: {resp.status}')

            try:
                data = json.loads(body)
                paths = data.get('paths', [])
                print(f'  Found {len(paths)} paths:')
                for p in paths[:30]:
                    name = p.get('name', '?')
                    is_dir = p.get('isDirectory', '?')
                    size = p.get('contentLength', '?')
                    print(f'    {name} (dir={is_dir}, size={size})')
            except json.JSONDecodeError:
                print(f'  Raw response: {body[:500]}')

            # If we got a listing, also check specific entity paths
            if resp.status == 200:
                print(f'\n  Checking specific entity paths...')
                test_dirs = [
                    'Files/etq',
                    'Files/etq/ETQ',
                    'Files/etq/ETQ/2026',
                    'Files/etq/ETQ/2026/02',
                    'Files/etq/ETQ/2026/02/24',
                    'Files/mes',
                    'Files/m3c',
                    'Files/LZ_RAW',
                ]
                for d in test_dirs:
                    d_url = f'https://onelake.dfs.fabric.microsoft.com/{WS_DATA}/{LH_LZ}?resource=filesystem&directory={quote(d)}&recursive=false'
                    d_req = Request(d_url, headers={
                        'Authorization': f'Bearer {token}',
                        'x-ms-version': '2021-06-08',
                    })
                    try:
                        d_resp = urlopen(d_req)
                        d_data = json.loads(d_resp.read().decode())
                        d_paths = d_data.get('paths', [])
                        file_count = sum(1 for p in d_paths if not p.get('isDirectory', False))
                        dir_count = sum(1 for p in d_paths if p.get('isDirectory', False))
                        print(f'    {d}: {len(d_paths)} items ({dir_count} dirs, {file_count} files)')
                        if file_count > 0 and file_count <= 5:
                            for p in d_paths:
                                if not p.get('isDirectory', False):
                                    print(f'      FILE: {p.get("name", "?")} ({p.get("contentLength", "?")} bytes)')
                        elif file_count > 5:
                            for p in d_paths[:3]:
                                if not p.get('isDirectory', False):
                                    print(f'      FILE: {p.get("name", "?")} ({p.get("contentLength", "?")} bytes)')
                            print(f'      ... and {file_count - 3} more files')
                    except HTTPError as e:
                        if e.code == 404:
                            print(f'    {d}: NOT FOUND (404)')
                        else:
                            print(f'    {d}: Error {e.code}')
                    except Exception as e:
                        print(f'    {d}: {str(e)[:100]}')

            break  # Stop trying URLs if one worked

        except HTTPError as e:
            body = e.read().decode()[:200]
            print(f'  Error {e.code}: {body}')
        except Exception as e:
            print(f'  Error: {str(e)[:200]}')

    # If we got results, don't try other scopes
    if resp.status == 200:
        break

print(f'\n{"="*70}')
print('DONE')
print(f'{"="*70}')
