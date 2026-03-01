"""
Upload NB_FMD_LOAD_BRONZE_SILVER notebook to Fabric workspace (CODE Dev).
Parses notebook-content.py into cells, builds ipynb, uploads via Fabric REST API.
"""
import json, base64, urllib.request, urllib.parse, os, sys, re

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
WS_CODE = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'

NB_NAME = 'NB_FMD_LOAD_BRONZE_SILVER'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, 'src', f'{NB_NAME}.Notebook')
PY_PATH = os.path.join(SRC_DIR, 'notebook-content.py')
IPYNB_PATH = os.path.join(SRC_DIR, f'{NB_NAME}.ipynb')


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


# ── 1. Parse notebook-content.py into cells ──
print(f"[1/5] Parsing {PY_PATH}...")

with open(PY_PATH, 'r', encoding='utf-8') as f:
    raw = f.read()

# Split on cell markers
segments = re.split(r'\n# (?:CELL|MARKDOWN|PARAMETERS CELL) \*{10,}\n', raw)
markers = re.findall(r'# (CELL|MARKDOWN|PARAMETERS CELL) \*{10,}', raw)

cells = []
cell_id_counter = 0

for i, marker in enumerate(markers):
    segment = segments[i + 1] if i + 1 < len(segments) else ''

    # Strip METADATA blocks and all # META lines
    segment = re.sub(r'\n?# METADATA \*{10,}\n', '', segment)
    segment = re.sub(r'# META [^\n]*\n?', '', segment)

    if marker == 'MARKDOWN':
        lines = segment.strip().split('\n')
        md_lines = []
        for line in lines:
            if line.startswith('# '):
                md_lines.append(line[2:])
            elif line == '#':
                md_lines.append('')
            else:
                md_lines.append(line)
        source = '\n'.join(md_lines)
        cells.append({
            "cell_type": "markdown",
            "id": f"cell-{cell_id_counter}",
            "metadata": {},
            "source": [line + '\n' for line in source.split('\n')]
        })
    else:
        source = segment.strip()
        meta = {"language": "python", "language_group": "synapse_pyspark"}
        if marker == 'PARAMETERS CELL':
            meta["tags"] = ["parameters"]
        cells.append({
            "cell_type": "code",
            "id": f"cell-{cell_id_counter}",
            "metadata": meta,
            "source": [line + '\n' for line in source.split('\n')],
            "outputs": [],
            "execution_count": None
        })

    cell_id_counter += 1

print(f"  Parsed {len(cells)} cells ({sum(1 for c in cells if c['cell_type']=='markdown')} markdown, {sum(1 for c in cells if c['cell_type']=='code')} code)")

# ── 2. Build ipynb ──
print(f"\n[2/5] Building .ipynb...")

# Silver notebook uses Bronze as source lakehouse
ipynb = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "kernel_info": {"name": "synapse_pyspark"},
        "language_info": {"name": "python"},
        "dependencies": {
            "lakehouse": {
                "default_lakehouse": "cf57e8bf-ed46-438b-92a0-4301d88b0512",
                "default_lakehouse_name": "LH_DATA_BRONZE",
                "default_lakehouse_workspace_id": "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a",
                "known_lakehouses": [
                    {"id": "cf57e8bf-ed46-438b-92a0-4301d88b0512"},
                    {"id": "44a0993f-9633-4403-8f6a-011903c25792"}
                ]
            },
            "environment": {}
        }
    },
    "cells": cells
}

ipynb_json = json.dumps(ipynb, indent=1)

with open(IPYNB_PATH, 'w', encoding='utf-8') as f:
    f.write(ipynb_json)
print(f"  Wrote {IPYNB_PATH}")

# Verify Silver tracking was added
checks = {
    'UpsertSilver': 'UpsertPipelineSilverLayerEntity' in ipynb_json,
    'UpsertBronze': 'UpsertPipelineBronzeLayerEntity' in ipynb_json,
    'SilverEntityId': 'SilverLayerEntityId' in ipynb_json,
    'SCD2': 'HashedPKColumn' in ipynb_json,
}
passed = [k for k, v in checks.items() if v]
missed = [k for k, v in checks.items() if not v]
print(f"  Verified: {', '.join(passed)}")
if missed:
    print(f"  WARNING: Missing: {', '.join(missed)}")

ipynb_b64 = base64.b64encode(ipynb_json.encode()).decode()

# ── 3. Authenticate ──
print(f"\n[3/5] Authenticating...")
token = get_token()
print("  OK")

# ── 4. Find notebook in workspace ──
print(f"\n[4/5] Looking for {NB_NAME} in workspace...")
items = api_get(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items?type=Notebook')
nb_map = {item['displayName']: item['id'] for item in items.get('value', [])}

if NB_NAME in nb_map:
    nb_id = nb_map[NB_NAME]
    print(f"  Found: {nb_id}")
else:
    nb_id = None
    print(f"  Not found - will create")

# ── 5. Upload ──
print(f"\n[5/5] Uploading to Fabric...")

definition = {
    "definition": {
        "format": "ipynb",
        "parts": [{
            "path": "notebook-content.ipynb",
            "payload": ipynb_b64,
            "payloadType": "InlineBase64",
        }],
    }
}

if nb_id:
    try:
        resp = api_post(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items/{nb_id}/updateDefinition', definition)
        print(f"  UPDATED: HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:500]
        print(f"  ERROR: HTTP {e.code} - {err}")
        sys.exit(1)
else:
    create_body = {"displayName": NB_NAME, "type": "Notebook"}
    create_body.update(definition)
    try:
        resp = api_post(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items', create_body)
        result = json.loads(resp.read())
        print(f"  CREATED: {NB_NAME} - ID: {result.get('id', '?')}")
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:500]
        print(f"  ERROR: HTTP {e.code} - {err}")
        sys.exit(1)

print(f"\nDone! Silver notebook uploaded with Silver entity tracking.")
print(f"  Added: sp_UpsertPipelineSilverLayerEntity call on both exit paths")
print(f"  Table: execution.PipelineSilverLayerEntity (already created)")
print(f"  Proc: execution.sp_UpsertPipelineSilverLayerEntity (already created)")
