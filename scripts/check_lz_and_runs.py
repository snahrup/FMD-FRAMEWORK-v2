"""Check if Landing Zone has data and if LZ pipeline has ever run."""
import json
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
WS_CODE = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
import requests

import sys
from pathlib import Path

# Add the scripts directory to the python path so we can import the registry
from centralized_id_registry import IDRegistry
registry = IDRegistry()

WS_DATA = registry.config.get("workspaces", {}).get("DATA_DEV", "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a")

PIPELINES = {
    'PL_FMD_LOAD_LANDINGZONE': '3d0b3b2b-a069-40dc-b735-d105f9e66838',
    'PL_FMD_LOAD_BRONZE': '8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3',
    'PL_FMD_LOAD_SILVER': '90c0535c-c5dc-43a3-b51e-c44ef1808a60',
    'PL_FMD_LOAD_ALL': '7079544a-fa8c-4ed1-94f4-ca997e825da1',
}

def get_token():
    data = urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': 'https://api.fabric.microsoft.com/.default',
    }).encode()
    req = Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=data, method='POST'
    )
    return json.loads(urlopen(req).read())['access_token']

def api(token, method, url):
    req = Request(url, method=method,
                  headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    if method == 'POST':
        req.data = b''
    try:
        return json.loads(urlopen(req).read())
    except HTTPError as e:
        body = e.read().decode()[:500]
        return {'error': e.code, 'body': body}

token = get_token()
print('[OK] Auth\n')

# 1. Check run history for key pipelines
for name, pid in PIPELINES.items():
    print(f'{"="*70}')
    print(f'{name} ({pid})')
    print(f'{"="*70}')

    url = f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items/{pid}/jobs/instances?limit=5'
    result = api(token, 'GET', url)

    if 'error' in result:
        print(f'  Error: {result}')
    else:
        instances = result.get('value', [])
        if not instances:
            print(f'  *** NO RUNS FOUND ***')
        else:
            print(f'  {len(instances)} recent runs:')
            for inst in instances:
                status = inst.get('status', '?')
                start = inst.get('startTimeUtc', '?')
                end = inst.get('endTimeUtc', '?')
                fail = inst.get('failureReason', {})
                duration = ''
                if start != '?' and end != '?':
                    from datetime import datetime
                    try:
                        s = datetime.fromisoformat(start.rstrip('Z').split('.')[0])
                        e = datetime.fromisoformat(end.rstrip('Z').split('.')[0])
                        duration = f' ({(e-s).seconds}s)'
                    except:
                        pass
                print(f'    {status}{duration} | {start} -> {end}')
                if fail:
                    msg = fail.get('message', str(fail))[:200]
                    print(f'    Failure: {msg}')
    print()

# 2. Check lakehouses in DATA workspace
print(f'{"="*70}')
print('LAKEHOUSES IN DATA WORKSPACE')
print(f'{"="*70}')
url = f'https://api.fabric.microsoft.com/v1/workspaces/{WS_DATA}/items?type=Lakehouse'
result = api(token, 'GET', url)
if 'error' in result:
    print(f'  Error: {result}')
else:
    for item in result.get('value', []):
        print(f'  {item["displayName"]} -> {item["id"]}')

# 3. Check what's in the LZ lakehouse using OneLake API
print(f'\n{"="*70}')
print('LANDING ZONE LAKEHOUSE CONTENTS (OneLake)')
print(f'{"="*70}')

# List lakehouses to find LZ
if 'error' not in result:
    for item in result.get('value', []):
        if 'landing' in item['displayName'].lower() or 'lz' in item['displayName'].lower():
            lh_id = item['id']
            lh_name = item['displayName']
            print(f'\nChecking {lh_name} ({lh_id})...')

            # Try OneLake file system API
            onelake_url = f'https://onelake.dfs.fabric.microsoft.com/{WS_DATA}/{lh_id}/Files?resource=filesystem&recursive=false'
            ol_result = api(token, 'GET', onelake_url)
            if 'error' in ol_result:
                print(f'  OneLake error: {ol_result}')

                # Try alternative OneLake paths
                alt_url = f'https://onelake.dfs.fabric.microsoft.com/{WS_DATA}/{lh_id}?resource=filesystem'
                alt_result = api(token, 'GET', alt_url)
                if 'error' in alt_result:
                    print(f'  Alt error: {alt_result}')
                else:
                    paths = alt_result.get('paths', [])
                    print(f'  Found {len(paths)} top-level items')
                    for p in paths[:20]:
                        print(f'    {p.get("name", "?")} (dir={p.get("isDirectory", "?")}, size={p.get("contentLength", "?")})')
            else:
                paths = ol_result.get('paths', [])
                print(f'  Found {len(paths)} items')
                for p in paths[:20]:
                    print(f'    {p.get("name", "?")}')
