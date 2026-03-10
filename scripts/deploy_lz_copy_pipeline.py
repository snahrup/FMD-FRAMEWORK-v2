"""
Deploy PL_FMD_LDZ_COPY_SQL pipeline to Fabric workspace (CODE Dev).

This is the thin copy pipeline that does ONE thing:
  AzureSqlSource (via gateway connection) → ParquetSink (lakehouse)

The notebook NB_FMD_LOAD_LANDINGZONE_MAIN invokes this pipeline per-entity.
"""
import json, base64, urllib.request, urllib.parse, os, sys
from fmd_config import load_fmd_config

_cfg = load_fmd_config()
TENANT = _cfg['tenant_id']
CLIENT = _cfg['client_id']
SECRET = _cfg['client_secret']
WS_CODE = _cfg['workspaces'].get('workspace_code', '')

PL_NAME = 'PL_FMD_LDZ_COPY_SQL'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PL_PATH = os.path.join(ROOT, 'src', f'{PL_NAME}.DataPipeline', 'pipeline-content.json')

# Try to load secret from .env if not in environment
if not SECRET:
    env_path = os.path.join(ROOT, 'dashboard', 'app', 'api', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith('FABRIC_CLIENT_SECRET='):
                    SECRET = line.split('=', 1)[1].strip()
                    break

if not SECRET:
    print("ERROR: FABRIC_CLIENT_SECRET not found in env or .env file")
    sys.exit(1)


def get_token():
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': 'https://api.fabric.microsoft.com/.default',
    })
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=body.encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
    )
    return json.loads(urllib.request.urlopen(req).read())['access_token']


def api_get(token, url):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    return json.loads(urllib.request.urlopen(req).read())


def api_post(token, url, data=None):
    body = json.dumps(data).encode() if data else b''
    req = urllib.request.Request(
        url, data=body, method='POST',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    )
    return urllib.request.urlopen(req)


# ── 1. Read pipeline JSON ──
print(f"[1/4] Reading {PL_PATH}...")
with open(PL_PATH, 'r', encoding='utf-8') as f:
    pl_json = f.read()

pl_data = json.loads(pl_json)
params = list(pl_data.get('properties', {}).get('parameters', {}).keys())
activities = [a['name'] for a in pl_data.get('properties', {}).get('activities', [])]
print(f"  Parameters: {params}")
print(f"  Activities: {activities}")

pl_b64 = base64.b64encode(pl_json.encode()).decode()

# ── 2. Authenticate ──
print(f"\n[2/4] Authenticating...")
token = get_token()
print("  OK")

# ── 3. Find pipeline in workspace ──
print(f"\n[3/4] Looking for {PL_NAME} in workspace...")
items = api_get(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items?type=DataPipeline')
pl_map = {item['displayName']: item['id'] for item in items.get('value', [])}

if PL_NAME in pl_map:
    pl_id = pl_map[PL_NAME]
    print(f"  Found: {pl_id}")
else:
    pl_id = None
    print(f"  Not found - will create")

# ── 4. Upload ──
print(f"\n[4/4] Uploading to Fabric...")

definition = {
    "definition": {
        "parts": [{
            "path": "pipeline-content.json",
            "payload": pl_b64,
            "payloadType": "InlineBase64",
        }],
    }
}

if pl_id:
    try:
        resp = api_post(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items/{pl_id}/updateDefinition', definition)
        print(f"  UPDATED: HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:500]
        print(f"  ERROR: HTTP {e.code} - {err}")
        sys.exit(1)
else:
    create_body = {"displayName": PL_NAME, "type": "DataPipeline"}
    create_body.update(definition)
    try:
        resp = api_post(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items', create_body)
        result = json.loads(resp.read())
        print(f"  CREATED: {PL_NAME} - ID: {result.get('id', '?')}")
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:500]
        print(f"  ERROR: HTTP {e.code} - {err}")
        sys.exit(1)

# ── 5. Capture pipeline ID into config.json ──
final_id = pl_id  # existing pipeline ID (update path)
if not final_id:
    # Was a create — ID captured above in `result`
    final_id = result.get('id', '')

if final_id:
    config_path = os.path.join(ROOT, 'dashboard', 'app', 'api', 'config.json')
    with open(config_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
    cfg.setdefault('engine', {})['pipeline_copy_sql_id'] = final_id
    cfg['engine']['pipeline_workspace_id'] = WS_CODE
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2)
        f.write('\n')
    print(f"\n[5/5] Updated config.json:")
    print(f"  pipeline_copy_sql_id = {final_id}")
    print(f"  pipeline_workspace_id = {WS_CODE}")
else:
    print("\n[5/5] WARNING: Could not capture pipeline ID — update config.json manually")

print(f"\nDone! Pipeline {PL_NAME} deployed to CODE workspace.")
print(f"  Activities: {activities}")
print(f"  Parameters: {params}")
print(f"  Pipeline ID: {final_id or '(unknown)'}")
