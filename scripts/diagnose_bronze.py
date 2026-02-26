"""Deep diagnosis: what's actually in the database and what the pipeline sees."""
import json, struct, pyodbc, base64
from urllib.request import Request, urlopen
from urllib.parse import urlencode

TENANT_ID = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT_ID = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
CLIENT_SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
DATABASE = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
WS_CODE = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
BRONZE_PIPELINE_ID = '8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3'


def get_fabric_token():
    data = urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'scope': 'https://api.fabric.microsoft.com/.default',
    }).encode()
    req = Request(
        f'https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token',
        data=data, method='POST'
    )
    return json.loads(urlopen(req).read())['access_token']


def get_sql_token():
    data = urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'scope': 'https://analysis.windows.net/powerbi/api/.default',
    }).encode()
    req = Request(
        f'https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token',
        data=data, method='POST'
    )
    return json.loads(urlopen(req).read())['access_token']


def connect_sql():
    token = get_sql_token()
    token_bytes = token.encode('UTF-16-LE')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    return pyodbc.connect(
        f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};PORT=1433;DATABASE={DATABASE};',
        attrs_before={1256: token_struct},
        timeout=30,
        autocommit=True
    )


def fabric_api(token, method, path, body=None):
    url = f'https://api.fabric.microsoft.com/v1{path}'
    data = json.dumps(body).encode() if body else (b'' if method == 'POST' else None)
    req = Request(url, data=data, method=method,
                  headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    try:
        resp = urlopen(req)
        return json.loads(resp.read())
    except Exception as e:
        return {'error': str(e)}


# ═════════════════════════════════════════════════════
# 1. Check what stored proc is ACTUALLY in the database
# ═════════════════════════════════════════════════════
print('='*70)
print('SECTION 1: STORED PROCEDURE DEFINITION (sp_helptext)')
print('='*70)

conn = connect_sql()
cur = conn.cursor()

try:
    cur.execute("EXEC sp_helptext '[execution].[sp_GetBronzelayerEntity]'")
    proc_text = ''.join(row[0] for row in cur.fetchall())
    print(proc_text)

    # Check key indicators
    if 'FETCH_FROM_SQL' in proc_text:
        print('\n>>> SIGNAL PROC DETECTED! This is the signal version, not the full payload.')
    elif 'STRING_AGG' in proc_text:
        print('\n>>> FULL PAYLOAD PROC DETECTED. This is the original full version.')
    else:
        print('\n>>> UNKNOWN PROC VARIANT')

    if 'AS NotebookParams' in proc_text:
        print('>>> Column alias: NotebookParams (PascalCase) ✓')
    elif 'AS notebookParams' in proc_text:
        print('>>> Column alias: notebookParams (camelCase) ✗ MISMATCH!')
    else:
        print(f'>>> Column alias: could not determine from proc text')

    if 'TOP 500' in proc_text:
        print('>>> TOP 500 limit in place ✓')
    elif 'TOP 100 PERCENT' in proc_text:
        print('>>> TOP 100 PERCENT — no limit! May exceed 1MB')
    else:
        print('>>> No TOP clause found')

except Exception as e:
    print(f'ERROR: {e}')


# ═════════════════════════════════════════════════════
# 2. Execute the proc and inspect the output
# ═════════════════════════════════════════════════════
print('\n' + '='*70)
print('SECTION 2: PROC EXECUTION OUTPUT')
print('='*70)

try:
    cur.execute('EXEC [execution].[sp_GetBronzelayerEntity]')
    row = cur.fetchone()
    if row is None:
        print('>>> PROC RETURNED NO ROWS!')
    else:
        val = row[0]
        if val is None:
            print('>>> PROC RETURNED NULL!')
        else:
            val_str = str(val)
            print(f'Output length: {len(val_str)} chars')
            print(f'Output starts with: {val_str[:200]}')
            print(f'Output ends with: ...{val_str[-100:]}')

            # Try to parse as JSON
            try:
                parsed = json.loads(val_str)
                print(f'JSON array length: {len(parsed)}')
                if len(parsed) > 0:
                    first = parsed[0]
                    print(f'First element path: {first.get("path", "N/A")}')
                    if first.get("path") == "FETCH_FROM_SQL":
                        print('>>> THIS IS A SIGNAL! The proc returns a fetch signal, not actual entities.')
                        print(f'    Signal params: {first.get("params", {})}')
                    else:
                        print(f'First element params keys: {list(first.get("params", {}).keys())}')
            except json.JSONDecodeError as e:
                print(f'JSON PARSE ERROR: {e}')
                print(f'First 500 chars: {val_str[:500]}')

        # Check column name from cursor description
        col_name = cur.description[0][0] if cur.description else 'UNKNOWN'
        print(f'\n>>> Column name from cursor.description: "{col_name}"')

except Exception as e:
    print(f'ERROR executing proc: {e}')


# ═════════════════════════════════════════════════════
# 3. Check the view data
# ═════════════════════════════════════════════════════
print('\n' + '='*70)
print('SECTION 3: VIEW AND ENTITY COUNTS')
print('='*70)

queries = [
    ("vw_LoadToBronzeLayer", "SELECT COUNT(*) FROM [execution].[vw_LoadToBronzeLayer]"),
    ("vw_LoadToSilverLayer", "SELECT COUNT(*) FROM [execution].[vw_LoadToSilverLayer]"),
    ("vw_LoadSourceToLandingzone", "SELECT COUNT(*) FROM [execution].[vw_LoadSourceToLandingzone]"),
    ("Active LZ entities", "SELECT COUNT(*) FROM [execution].[LandingzoneEntity] WHERE IsActive = 1"),
    ("Active Bronze entities", "SELECT COUNT(*) FROM [execution].[BronzeLayerEntity] WHERE IsActive = 1"),
    ("Active Silver entities", "SELECT COUNT(*) FROM [execution].[SilverLayerEntity] WHERE IsActive = 1"),
    ("Inactive LZ entities", "SELECT COUNT(*) FROM [execution].[LandingzoneEntity] WHERE IsActive = 0"),
    ("Inactive Bronze entities", "SELECT COUNT(*) FROM [execution].[BronzeLayerEntity] WHERE IsActive = 0"),
    ("PipelineBronzeLayerEntity rows", "SELECT COUNT(*) FROM [execution].[PipelineBronzeLayerEntity]"),
]

for label, sql in queries:
    try:
        cur.execute(sql)
        row = cur.fetchone()
        print(f'  {label}: {row[0]}')
    except Exception as e:
        print(f'  {label}: ERROR - {e}')


# ═════════════════════════════════════════════════════
# 4. Check _Full proc variants
# ═════════════════════════════════════════════════════
print('\n' + '='*70)
print('SECTION 4: CHECK FOR _FULL PROC VARIANTS')
print('='*70)

try:
    cur.execute("""
        SELECT s.name + '.' + p.name AS proc_name
        FROM sys.procedures p
        JOIN sys.schemas s ON p.schema_id = s.schema_id
        WHERE p.name LIKE '%Entity%'
        ORDER BY p.name
    """)
    for row in cur.fetchall():
        print(f'  {row[0]}')
except Exception as e:
    print(f'  ERROR: {e}')


# ═════════════════════════════════════════════════════
# 5. Check latest pipeline runs from audit log
# ═════════════════════════════════════════════════════
print('\n' + '='*70)
print('SECTION 5: LATEST BRONZE PIPELINE AUDIT LOGS')
print('='*70)

try:
    cur.execute("""
        SELECT TOP 10
            LogType, LogData, PipelineName,
            LogDateTime, PipelineRunGuid
        FROM [logging].[PipelineAuditLog]
        WHERE PipelineName LIKE '%Bronze%' OR PipelineName LIKE '%BRONZE%'
        ORDER BY LogDateTime DESC
    """)
    cols = [c[0] for c in cur.description]
    for row in cur.fetchall():
        d = dict(zip(cols, row))
        print(f'  [{d["LogDateTime"]}] {d["LogType"]}: {d["PipelineName"]}')
        if d["LogData"]:
            print(f'    Data: {str(d["LogData"])[:200]}')
        print(f'    RunGuid: {d["PipelineRunGuid"]}')
        print()
except Exception as e:
    print(f'  ERROR: {e}')


# ═════════════════════════════════════════════════════
# 6. Get the DEPLOYED pipeline definition from Fabric
# ═════════════════════════════════════════════════════
print('\n' + '='*70)
print('SECTION 6: DEPLOYED PIPELINE DEFINITION (Fabric API)')
print('='*70)

fabric_token = get_fabric_token()

defn = fabric_api(fabric_token, 'POST',
    f'/workspaces/{WS_CODE}/items/{BRONZE_PIPELINE_ID}/getDefinition')

if 'error' in defn:
    print(f'ERROR: {defn["error"]}')
else:
    for part in defn.get('definition', {}).get('parts', []):
        if part.get('path', '').endswith('.json'):
            content = base64.b64decode(part['payload']).decode()
            pipeline = json.loads(content)

            for act in pipeline.get('properties', {}).get('activities', []):
                name = act.get('name')
                atype = act.get('type')

                if atype == 'IfCondition':
                    expr = act.get('typeProperties', {}).get('expression', {}).get('value', '')
                    print(f'\nIfCondition "{name}":')
                    print(f'  Expression: {expr.strip()}')

                    # Check casing
                    if '.NotebookParams' in expr:
                        print('  >>> Uses .NotebookParams (PascalCase) ✓')
                    elif '.notebookParams' in expr:
                        print('  >>> Uses .notebookParams (camelCase) ✗ MISMATCH!')

                    # Check notebook params in false branch
                    false_acts = act.get('typeProperties', {}).get('ifFalseActivities', [])
                    for fa in false_acts:
                        if fa.get('type') == 'TridentNotebook':
                            nb_params = fa.get('typeProperties', {}).get('parameters', {})
                            for k, v in nb_params.items():
                                val = v.get('value', {})
                                if isinstance(val, dict):
                                    val_expr = val.get('value', '')
                                else:
                                    val_expr = str(val)
                                print(f'\n  Notebook param "{k}": {val_expr}')
                                if '.NotebookParams' in val_expr:
                                    print(f'    >>> PascalCase ✓')
                                elif '.notebookParams' in val_expr:
                                    print(f'    >>> camelCase ✗ MISMATCH!')

conn.close()

print('\n' + '='*70)
print('DIAGNOSIS COMPLETE')
print('='*70)
