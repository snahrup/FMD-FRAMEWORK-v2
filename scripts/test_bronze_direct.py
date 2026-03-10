"""Test Bronze child notebook directly with a single entity."""
import json, urllib.request, urllib.parse, os, time
from datetime import datetime
from urllib.error import HTTPError

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
CODE_WS = 'c0366b24-e6f8-4994-b4df-b765ecb5bbf8'
DATA_WS = '0596d0e7-e036-451d-a967-41a284302e8d'
BRONZE_NB_ID = 'a2712a97-ebde-4036-b704-4892b8c4f7af'  # NB_FMD_LOAD_LANDING_BRONZE

# Lakehouse IDs
LH_LZ = '3b9a7e79-1615-4ec2-9e93-0bdebe985d5a'
LH_BRONZE = 'f06393ca-c024-435f-8d7f-9f5aa3bb4cb3'

env_path = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'app', 'api', '.env')
with open(env_path) as f:
    for line in f:
        if line.startswith('FABRIC_CLIENT_SECRET='):
            SECRET = line.strip().split('=', 1)[1]

body = urllib.parse.urlencode({
    'grant_type': 'client_credentials',
    'client_id': CLIENT,
    'client_secret': SECRET,
    'scope': 'https://api.fabric.microsoft.com/.default',
}).encode()
req = urllib.request.Request(
    f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
    data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'},
)
token = json.loads(urllib.request.urlopen(req).read())['access_token']


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


# Test entity: ActualCycleTime from MES (small table)
params = {
    'executionData': {
        'parameters': {
            'SourceFilePath': {'value': 'mes/dbo/', 'type': 'string'},
            'SourceFileName': {'value': 'ActualCycleTime', 'type': 'string'},
            'TargetSchema': {'value': 'dbo', 'type': 'string'},
            'TargetName': {'value': 'ActualCycleTime', 'type': 'string'},
            'PrimaryKeys': {'value': 'ActualCycleTimeId', 'type': 'string'},
            'SourceFileType': {'value': 'parquet', 'type': 'string'},
            'IsIncremental': {'value': 'False', 'type': 'string'},
            'SourceWorkspace': {'value': DATA_WS, 'type': 'string'},
            'SourceLakehouse': {'value': LH_LZ, 'type': 'string'},
            'SourceLakehouseName': {'value': 'LH_DATA_LANDINGZONE', 'type': 'string'},
            'TargetWorkspace': {'value': DATA_WS, 'type': 'string'},
            'TargetLakehouse': {'value': LH_BRONZE, 'type': 'string'},
            'TargetLakehouseName': {'value': 'LH_BRONZE_LAYER', 'type': 'string'},
            'DataSourceNamespace': {'value': 'mes', 'type': 'string'},
            'LandingzoneEntityId': {'value': '1', 'type': 'string'},
            'BronzeLayerEntityId': {'value': '1', 'type': 'string'},
        }
    }
}

log(f'Triggering Bronze notebook with ActualCycleTime...')
log(f'Notebook: {BRONZE_NB_ID}')

url = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{BRONZE_NB_ID}/jobs/instances?jobType=RunNotebook'
payload = json.dumps(params).encode()
req = urllib.request.Request(
    url, data=payload, method='POST',
    headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    },
)

try:
    resp = urllib.request.urlopen(req)
    loc = resp.headers.get('Location', '')
    run_id = loc.split('/')[-1]
    log(f'Triggered! Run ID: {run_id}')
except HTTPError as e:
    log(f'Trigger FAILED: {e.code} {e.read().decode()[:500]}')
    exit(1)

# Poll
for i in range(30):
    time.sleep(15)
    url = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{BRONZE_NB_ID}/jobs/instances/{run_id}'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    try:
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read())
        status = data.get('status', 'Unknown')
        log(f'Status: {status}')
        if status in ('Completed', 'Failed', 'Cancelled'):
            log(json.dumps(data, indent=2))
            break
    except HTTPError as e:
        log(f'Poll error: {e.code} {e.read().decode()[:200]}')

log('Done.')
