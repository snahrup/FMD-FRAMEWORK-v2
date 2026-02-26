"""
Two fixes:
1. Revert Bronze + Silver pipeline IfCondition back to uppercase .NotebookParams
2. Upload NB_FMD_DQ_CLEANSING to the Fabric workspace
"""
import json, base64, urllib.request, urllib.parse, time, sys, os

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
WS_CODE = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'

BRONZE_ID = '8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3'
SILVER_ID = '90c0535c-c5dc-43a3-b51e-c44ef1808a60'


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


# ── Auth ──
print("[1/4] Authenticating...")
token = get_token()
print("  OK")

# ── Fix 1: Revert pipeline IfConditions to uppercase .NotebookParams ──
print("\n[2/4] Reverting pipeline IfConditions to .NotebookParams (uppercase)...")

for name, pid in [("PL_FMD_LOAD_BRONZE", BRONZE_ID), ("PL_FMD_LOAD_SILVER", SILVER_ID)]:
    print(f"\n  Processing {name}...")

    # Get current definition
    resp = api_post(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items/{pid}/getDefinition')
    defn = json.loads(resp.read())

    for part in defn.get('definition', {}).get('parts', []):
        if part.get('path', '').endswith('.json'):
            content = base64.b64decode(part['payload']).decode()

            # Count replacements
            count = content.count('.notebookParams')
            if count == 0:
                print(f"  Already uses .NotebookParams — no changes needed")
                continue

            # Replace lowercase with uppercase
            fixed = content.replace('.notebookParams', '.NotebookParams')
            print(f"  Replaced {count} occurrences of .notebookParams -> .NotebookParams")

            # Encode back
            part['payload'] = base64.b64encode(fixed.encode()).decode()

    # Update definition
    update_body = {"definition": defn['definition']}
    try:
        resp = api_post(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items/{pid}/updateDefinition', update_body)
        print(f"  Updated: HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        print(f"  ERROR: HTTP {e.code} — {e.read().decode()[:300]}")


# ── Fix 2: Check existing notebooks ──
print("\n[3/4] Checking existing notebooks in workspace...")

# List all notebooks in workspace
items = api_get(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items?type=Notebook')
nb_names = {item['displayName']: item['id'] for item in items.get('value', [])}
print(f"  Found {len(nb_names)} notebooks:")
for nb in sorted(nb_names.keys()):
    print(f"    {nb}")

# Check which notebooks are needed
needed = ['NB_FMD_DQ_CLEANSING']
missing = [n for n in needed if n not in nb_names]

if not missing:
    print("\n  All needed notebooks already exist!")
else:
    print(f"\n  MISSING notebooks: {missing}")

    # ── Upload missing notebooks ──
    print("\n[4/4] Uploading missing notebooks...")

    for nb_name in missing:
        src_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src', f'{nb_name}.Notebook')
        nb_content_path = os.path.join(src_dir, 'notebook-content.py')

        if not os.path.exists(nb_content_path):
            print(f"  ERROR: {nb_content_path} not found locally!")
            continue

        print(f"  Reading {nb_content_path}...")
        with open(nb_content_path, 'r', encoding='utf-8') as f:
            py_source = f.read()

        # Build ipynb format
        cells = []
        # Split on cell markers if they exist
        if '# METADATA' in py_source or '# CELL' in py_source:
            # Fabric .py format — split into cells
            current_cell = []
            cell_type = 'code'
            for line in py_source.split('\n'):
                if line.strip().startswith('# METADATA'):
                    if current_cell:
                        cells.append({
                            "cell_type": cell_type,
                            "source": '\n'.join(current_cell),
                            "metadata": {},
                            "outputs": [],
                            "execution_count": None,
                        })
                    current_cell = []
                    cell_type = 'code'
                    continue
                if line.strip().startswith('# MARKDOWN'):
                    cell_type = 'markdown'
                    continue
                current_cell.append(line)
            if current_cell:
                cells.append({
                    "cell_type": cell_type,
                    "source": '\n'.join(current_cell),
                    "metadata": {},
                    "outputs": [],
                    "execution_count": None,
                })
        else:
            # Single cell with all content
            cells.append({
                "cell_type": "code",
                "source": py_source,
                "metadata": {},
                "outputs": [],
                "execution_count": None,
            })

        ipynb = {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {
                "language_info": {"name": "python"},
                "a]]a]kernel_info": {"name": "synapse_pyspark"},
            },
            "cells": cells,
        }

        ipynb_b64 = base64.b64encode(json.dumps(ipynb).encode()).decode()

        # Create notebook item
        print(f"  Creating {nb_name} in workspace...")
        create_body = {
            "displayName": nb_name,
            "type": "Notebook",
            "definition": {
                "format": "ipynb",
                "parts": [
                    {
                        "path": "notebook-content.ipynb",
                        "payload": ipynb_b64,
                        "payloadType": "InlineBase64",
                    }
                ],
            },
        }

        try:
            resp = api_post(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items', create_body)
            result = json.loads(resp.read())
            print(f"  CREATED: {nb_name} — ID: {result.get('id', '?')}")
        except urllib.error.HTTPError as e:
            err = e.read().decode()[:500]
            print(f"  ERROR creating {nb_name}: HTTP {e.code} — {err}")

            # If 409 conflict, try updating instead
            if e.code == 409 and nb_name in nb_names:
                print(f"  Trying updateDefinition instead...")
                update_body = {
                    "definition": {
                        "format": "ipynb",
                        "parts": [{
                            "path": "notebook-content.ipynb",
                            "payload": ipynb_b64,
                            "payloadType": "InlineBase64",
                        }],
                    }
                }
                try:
                    resp = api_post(token, f'https://api.fabric.microsoft.com/v1/workspaces/{WS_CODE}/items/{nb_names[nb_name]}/updateDefinition', update_body)
                    print(f"  UPDATED: {nb_name}")
                except urllib.error.HTTPError as e2:
                    print(f"  ERROR updating: HTTP {e2.code} — {e2.read().decode()[:300]}")

print("\n✓ Done!")
