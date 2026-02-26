"""Fetch Bronze pipeline definition from Fabric API and print all activities."""
import json, base64, urllib.request, urllib.parse

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'

# Auth
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
token = json.loads(urllib.request.urlopen(req).read())['access_token']
print('Auth OK')

# Get Bronze pipeline definition
WS = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
BRONZE_ID = '8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3'

req = urllib.request.Request(
    f'https://api.fabric.microsoft.com/v1/workspaces/{WS}/items/{BRONZE_ID}/getDefinition',
    method='POST',
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
)
resp = json.loads(urllib.request.urlopen(req).read())

for part in resp.get('definition', {}).get('parts', []):
    if part.get('path', '').endswith('.json'):
        content = base64.b64decode(part['payload']).decode()
        pipeline = json.loads(content)

        for act in pipeline.get('properties', {}).get('activities', []):
            atype = act.get('type', '?')
            name = act.get('name', '?')
            print(f'\n[{atype}] {name}')

            deps = act.get('dependsOn', [])
            if deps:
                for d in deps:
                    print(f'  dependsOn: {d.get("activity","?")} ({",".join(d.get("dependencyConditions",[]))})')

            if atype == 'Lookup':
                src = act.get('typeProperties', {}).get('source', {})
                proc = src.get('sqlReaderStoredProcedureName', 'N/A')
                first_row = act.get('typeProperties', {}).get('firstRowOnly', 'N/A')
                print(f'  Proc: {proc}')
                print(f'  firstRowOnly: {first_row}')
                params = src.get('storedProcedureParameters', {})
                if params:
                    for k, v in params.items():
                        print(f'  Param {k}: {v}')

            if atype == 'IfCondition':
                expr = act.get('typeProperties', {}).get('expression', {}).get('value', '')
                print(f'  Expression: {expr}')
                true_acts = act.get('typeProperties', {}).get('ifTrueActivities', [])
                false_acts = act.get('typeProperties', {}).get('ifFalseActivities', [])
                for ta in true_acts:
                    print(f'  TRUE  -> [{ta.get("type")}] {ta.get("name")}')
                    if ta.get('type') == 'TridentNotebook':
                        params = ta.get('typeProperties', {}).get('notebookParameters', {})
                        for k, v in params.items():
                            val = str(v.get('value', ''))[:300]
                            print(f'           param {k}: {val}')
                for fa in false_acts:
                    print(f'  FALSE -> [{fa.get("type")}] {fa.get("name")}')

            if atype == 'ForEach':
                items_expr = act.get('typeProperties', {}).get('items', {}).get('value', '')
                print(f'  Items: {items_expr[:400]}')
                inner = act.get('typeProperties', {}).get('activities', [])
                for ia in inner:
                    print(f'  Inner -> [{ia.get("type")}] {ia.get("name")}')
                    if ia.get('type') == 'IfCondition':
                        ie = ia.get('typeProperties', {}).get('expression', {}).get('value', '')
                        print(f'    Expression: {ie}')
                        for ta in ia.get('typeProperties', {}).get('ifTrueActivities', []):
                            print(f'    TRUE  -> [{ta.get("type")}] {ta.get("name")}')
                            if ta.get('type') == 'TridentNotebook':
                                params = ta.get('typeProperties', {}).get('notebookParameters', {})
                                for k, v in params.items():
                                    val = str(v.get('value', ''))[:300]
                                    print(f'             param {k}: {val}')
                        for fa in ia.get('typeProperties', {}).get('ifFalseActivities', []):
                            print(f'    FALSE -> [{fa.get("type")}] {fa.get("name")}')
                    elif ia.get('type') == 'TridentNotebook':
                        params = ia.get('typeProperties', {}).get('notebookParameters', {})
                        for k, v in params.items():
                            val = str(v.get('value', ''))[:300]
                            print(f'    param {k}: {val}')

        # Also dump the raw JSON for forensics
        with open('bronze_pipeline_definition.json', 'w') as f:
            json.dump(pipeline, f, indent=2)
        print('\n--- Full definition saved to bronze_pipeline_definition.json ---')
