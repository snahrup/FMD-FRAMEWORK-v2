import os
"""
Regenerate NB_FMD_LOAD_LANDINGZONE_MAIN.ipynb from notebook-content.py,
then upload to Fabric workspace (CODE Dev).
"""
import json, base64, urllib.request, urllib.parse, os, sys, re

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = os.environ.get('FABRIC_CLIENT_SECRET', '')
WS_CODE = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'

NB_NAME = 'NB_FMD_LOAD_LANDINGZONE_MAIN'
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
# Identify marker types in order
markers = re.findall(r'# (CELL|MARKDOWN|PARAMETERS CELL) \*{10,}', raw)

cells = []
cell_id_counter = 0

# First segment is the top-level metadata (before first CELL/MARKDOWN marker)
# Skip it — it's notebook-level metadata, not a cell

for i, marker in enumerate(markers):
    segment = segments[i + 1] if i + 1 < len(segments) else ''

    # Strip METADATA blocks and all # META lines from the segment
    segment = re.sub(r'\n?# METADATA \*{10,}\n', '', segment)
    segment = re.sub(r'# META [^\n]*\n?', '', segment)

    if marker == 'MARKDOWN':
        # Strip leading "# " from each line to get markdown content
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
        # CELL or PARAMETERS CELL — code cell
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

ipynb = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "kernel_info": {"name": "synapse_pyspark"},
        "language_info": {"name": "python"},
        "dependencies": {
            "lakehouse": {
                "default_lakehouse": "2aef4ede-2918-4a6b-8ec6-a42108c67806",
                "default_lakehouse_name": "LH_DATA_LANDINGZONE",
                "default_lakehouse_workspace_id": "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a",
                "known_lakehouses": [{"id": "2aef4ede-2918-4a6b-8ec6-a42108c67806"}]
            },
            "environment": {}
        }
    },
    "cells": cells
}

ipynb_json = json.dumps(ipynb, indent=1)

# Write local .ipynb
with open(IPYNB_PATH, 'w', encoding='utf-8') as f:
    f.write(ipynb_json)
print(f"  Wrote {IPYNB_PATH}")

# Quick sanity check — verify key params
checks = {
    'OPTIVA': 'OPTIVA' in ipynb_json,
    'DS8': 'DataSourceIdFilter = 8' in ipynb_json,
    'CopyPipeline': 'PL_FMD_LDZ_COPY_SQL' in ipynb_json,
    'REST_API': 'jobs/instances?jobType=Pipeline' in ipynb_json,
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

print(f"\nDone! Notebook uploaded (v2 — Hybrid Pipeline).")
print(f"  DataSourceFilter = OPTIVA")
print(f"  DataSourceIdFilter = 8")
print(f"  MaxEntities = 5")
print(f"  CopyPipeline = PL_FMD_LDZ_COPY_SQL")
print(f"  DryRun = False")
print(f"\nPREREQ: Deploy PL_FMD_LDZ_COPY_SQL first: python scripts/deploy_lz_copy_pipeline.py")
print(f"Then open the notebook in Fabric and Run All.")
