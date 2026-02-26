"""Get the ACTUAL pipeline run details from Fabric - what really happened."""
import json, sys
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
BRONZE_ID = '8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3'

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
print('[OK] Auth')

# Try multiple approaches to find run history

# 1. Get recent job instances for the Bronze pipeline
print('\n' + '='*70)
print('APPROACH 1: Job instances for Bronze pipeline (CODE workspace)')
print('='*70)
for ws in [WS_CODE, WS_DATA]:
    ws_label = 'CODE' if ws == WS_CODE else 'DATA'
    url = f'https://api.fabric.microsoft.com/v1/workspaces/{ws}/items/{BRONZE_ID}/jobs/instances?limit=5'
    result = api(token, 'GET', url)
    if 'error' in result:
        print(f'  [{ws_label}] Error {result["error"]}: {result["body"][:200]}')
    else:
        instances = result.get('value', [])
        print(f'  [{ws_label}] Found {len(instances)} job instances')
        for inst in instances[:5]:
            print(f'    ID: {inst.get("id", "?")}')
            print(f'    Status: {inst.get("status", "?")}')
            print(f'    StartTime: {inst.get("startTimeUtc", "?")}')
            print(f'    EndTime: {inst.get("endTimeUtc", "?")}')
            if inst.get('failureReason'):
                print(f'    FailureReason: {inst["failureReason"]}')
            print()

# 2. List ALL items in both workspaces to find the pipeline
print('\n' + '='*70)
print('APPROACH 2: Find ALL pipeline items')
print('='*70)
for ws, label in [(WS_CODE, 'CODE'), (WS_DATA, 'DATA')]:
    url = f'https://api.fabric.microsoft.com/v1/workspaces/{ws}/items?type=DataPipeline'
    result = api(token, 'GET', url)
    if 'error' in result:
        print(f'  [{label}] Error: {result}')
    else:
        items = result.get('value', [])
        print(f'  [{label}] Found {len(items)} pipelines:')
        for item in items:
            print(f'    {item["displayName"]} -> {item["id"]}')

# 3. Try to get job instances using the correct pipeline ID from each workspace
print('\n' + '='*70)
print('APPROACH 3: Job instances for ALL pipelines found')
print('='*70)
for ws, label in [(WS_CODE, 'CODE'), (WS_DATA, 'DATA')]:
    url = f'https://api.fabric.microsoft.com/v1/workspaces/{ws}/items?type=DataPipeline'
    result = api(token, 'GET', url)
    if 'error' in result:
        continue
    for item in result.get('value', []):
        if 'bronze' in item['displayName'].lower() or 'BRONZE' in item['displayName']:
            pid = item['id']
            pname = item['displayName']
            jobs_url = f'https://api.fabric.microsoft.com/v1/workspaces/{ws}/items/{pid}/jobs/instances?limit=3'
            jobs = api(token, 'GET', jobs_url)
            if 'error' in jobs:
                print(f'  [{label}] {pname} ({pid}): Error {jobs}')
            else:
                instances = jobs.get('value', [])
                print(f'  [{label}] {pname} ({pid}): {len(instances)} runs')
                for inst in instances:
                    status = inst.get('status', '?')
                    start = inst.get('startTimeUtc', '?')
                    end = inst.get('endTimeUtc', '?')
                    fail = inst.get('failureReason', {})
                    print(f'    {status} | {start} -> {end}')
                    if fail:
                        print(f'    Failure: {json.dumps(fail)[:300]}')

# 4. Check the item details for the Bronze pipeline
print('\n' + '='*70)
print('APPROACH 4: Bronze pipeline item details')
print('='*70)
for ws, label in [(WS_CODE, 'CODE'), (WS_DATA, 'DATA')]:
    url = f'https://api.fabric.microsoft.com/v1/workspaces/{ws}/items/{BRONZE_ID}'
    result = api(token, 'GET', url)
    if 'error' in result:
        print(f'  [{label}] {result}')
    else:
        print(f'  [{label}] {json.dumps(result, indent=2)}')
