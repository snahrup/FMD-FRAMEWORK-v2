"""Create and run a diagnostic notebook to isolate Bronze failure.

This version replicates the Bronze notebook's META header (lakehouse bindings),
parameter cell, imports, and stored proc definitions — but skips actual data processing.
"""
import json, urllib.request, urllib.parse, os, time, base64
from datetime import datetime
from urllib.error import HTTPError

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
CODE_WS = 'c0366b24-e6f8-4994-b4df-b765ecb5bbf8'
DATA_WS = '0596d0e7-e036-451d-a967-41a284302e8d'

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


def fabric_api(method, path, payload=None):
    url = f'https://api.fabric.microsoft.com/v1/{path}'
    body_data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(url, data=body_data, method=method, headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    try:
        resp = urllib.request.urlopen(req)
        raw = resp.read().decode()
        return resp.status, json.loads(raw) if raw.strip() else {}
    except HTTPError as e:
        return e.code, {'error': e.read().decode()[:300]}


# Diagnostic notebook content — mirrors Bronze notebook structure
# Same lakehouse bindings, param cell, imports, stored proc defs
# BUT no actual data processing (no Spark reads, no Delta operations)
TEST_NB = r'''# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "f06393ca-c024-435f-8d7f-9f5aa3bb4cb3",
# META       "default_lakehouse_name": "LH_BRONZE_LAYER",
# META       "default_lakehouse_workspace_id": "0596d0e7-e036-451d-a967-41a284302e8d",
# META       "known_lakehouses": [
# META         {
# META           "id": "f06393ca-c024-435f-8d7f-9f5aa3bb4cb3"
# META         },
# META         {
# META           "id": "3b9a7e79-1615-4ec2-9e93-0bdebe985d5a"
# META         }
# META       ]
# META     }
# META   }
# META }

# CELL ********************

print("STEP 1: Loading variable libraries...")
config_settings = notebookutils.variableLibrary.getLibrary("VAR_CONFIG_FMD")
default_settings = notebookutils.variableLibrary.getLibrary("VAR_FMD")
print("STEP 1: OK")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# PARAMETERS CELL ********************

# Set arguments (same as Bronze notebook)
PrimaryKeys = ""
SourceFileType='parquet'
IsIncremental = False

SourceWorkspace= ''
SourceLakehouse = ''
SourceLakehouseName = ''
SourceFilePath = ''
SourceFileName = ''
DataSourceNamespace = ''

TargetWorkspace = ''
TargetLakehouse = ''
TargetLakehouseName = ''
TargetSchema = ''
TargetName = ''

LandingzoneEntityId =""
BronzeLayerEntityId =""

# Pipeline context parameters
NotebookExecutionId = ""
PipelineRunGuid = ""
PipelineParentRunGuid = ""
TriggerType = "API"
TriggerGuid = ""

# CSV
CompressionType = 'infer'
ColumnDelimiter = ','
RowDelimiter = '\n'
EscapeCharacter = '"'
Encoding = 'UTF-8'
first_row_is_header = True
infer_schema = True
key_vault = default_settings.key_vault_uri_name
cleansing_rules = []

driver = '{ODBC Driver 18 for SQL Server}'
connstring = config_settings.fmd_fabric_db_connection
database = config_settings.fmd_fabric_db_name
schema_enabled = default_settings.lakehouse_schema_enabled
EntityLayer = 'Bronze'
result_data = ''

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

print("STEP 2: Imports...")
import re
from datetime import datetime, timezone
import json
from delta.tables import *
from pyspark.sql.functions import sha2, concat_ws, md5, StringType, current_timestamp
print("STEP 2: OK")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

print("STEP 3: Token + utility functions...")
start_audit_time = datetime.now()
token = notebookutils.credentials.getToken('https://analysis.windows.net/powerbi/api')

import struct, pyodbc

def build_exec_statement(proc_name, **params):
    param_strs = []
    for key, value in params.items():
        if value is not None:
            if isinstance(value, str):
                param_strs.append(f"@{key}='{value}'")
            else:
                param_strs.append(f"@{key}={value}")
    if param_strs:
        return f"EXEC {proc_name}, " + ", ".join(param_strs)
    else:
        return f"EXEC {proc_name}"

def execute_with_outputs(exec_statement, driver, connstring, database, **params):
    token = notebookutils.credentials.getToken('https://analysis.windows.net/powerbi/api').encode("UTF-16-LE")
    token_struct = struct.pack(f'<I{len(token)}s', len(token), token)
    conn = pyodbc.connect(
        f"DRIVER={driver};SERVER={connstring};PORT=1433;DATABASE={database};",
        attrs_before={1256: token_struct},
        timeout=12
    )
    if exec_statement:
        sql_to_run = build_exec_statement(exec_statement, **params)
    else:
        raise ValueError("Provide exec_statement.")

    result_sets = []
    messages = []
    return_code = None
    out_params = {}
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
            conn.timeout = 10
            cursor.execute(sql_to_run)
            while True:
                if cursor.description:
                    cols = [d[0] for d in cursor.description]
                    rows = cursor.fetchall()
                    result_sets.append([dict(zip(cols, r)) for r in rows])
                if not cursor.nextset():
                    break
            if result_sets:
                last = result_sets[-1]
                if len(last) == 1 and "__return_code__" in last[0]:
                    return_code = last[0]["__return_code__"]
                    result_sets = result_sets[:-1]
            if result_sets:
                maybe = result_sets[-1]
                if len(maybe) == 1 and any(k.startswith("__out_") for k in maybe[0].keys()):
                    out_params = {k.replace("__out_", ""): v for k, v in maybe[0].items()}
                    result_sets = result_sets[:-1]
            try:
                cursor.commit()
            except:
                pass
    finally:
        try:
            conn.close()
        except:
            pass
    return {"result_sets": result_sets, "return_code": return_code, "out_params": out_params, "messages": messages}

print("STEP 3: OK")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

print("STEP 4: Building stored proc definitions...")
TriggerTime = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
notebook_name = notebookutils.runtime.context['currentNotebookName']
print(f"  notebook_name = {notebook_name}")

StartNotebookActivity = (
    f"[logging].[sp_AuditNotebook] "
    f"@NotebookGuid = \"{NotebookExecutionId}\", "
    f"@NotebookName = \"{notebook_name}\", "
    f"@PipelineRunGuid = \"{PipelineRunGuid}\", "
    f"@PipelineParentRunGuid = \"{PipelineParentRunGuid}\", "
    f"@NotebookParameters = \"{TargetName}\", "
    f"@TriggerType = \"{TriggerType}\", "
    f"@TriggerGuid = \"{TriggerGuid}\", "
    f"@TriggerTime = \"{TriggerTime}\", "
    f"@LogData = '{{\"Action\":\"Start\"}}', "
    f"@LogType = \"StartNotebookActivity\", "
    f"@WorkspaceGuid = \"{SourceWorkspace}\", "
    f"@EntityId = \"{BronzeLayerEntityId}\", "
    f"@EntityLayer = \"{EntityLayer}\""
)
print(f"  StartNotebookActivity SQL = {StartNotebookActivity[:80]}...")
print("STEP 4: OK")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

print("STEP 5: Calling execute_with_outputs(StartNotebookActivity)...")
try:
    execute_with_outputs(StartNotebookActivity, driver, connstring, database)
    print("STEP 5: OK — StartNotebookActivity logged to SQL")
except Exception as e:
    print(f"STEP 5 FAILED: {e}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

print("STEP 6: Spark conf settings...")
spark.conf.set("sprk.sql.parquet.vorder.enabled", "false")
spark.conf.set("spark.sql.parquet.int96RebaseModeInRead", "CORRECTED")
spark.conf.set("spark.sql.parquet.int96RebaseModeInWrite", "CORRECTED")
spark.conf.set("spark.sql.parquet.datetimeRebaseModeInRead", "CORRECTED")
spark.conf.set("spark.sql.parquet.datetimeRebaseModeInWrite", "CORRECTED")
spark.conf.set('spark.microsoft.delta.optimize.fast.enabled', True)
spark.conf.set('spark.microsoft.delta.optimize.fileLevelTarget.enabled', True)
spark.conf.set('spark.databricks.delta.autoCompact.enabled', True)
print("STEP 6: OK")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

print("STEP 7: Set loading paths...")
source_changes_data_path = f"abfss://{SourceWorkspace}@onelake.dfs.fabric.microsoft.com/{SourceLakehouse}/Files/{SourceFilePath}/{SourceFileName}"
if str(schema_enabled).lower() == 'true':
    target_data_path = f"abfss://{TargetWorkspace}@onelake.dfs.fabric.microsoft.com/{TargetLakehouse}/Tables/{DataSourceNamespace}/{TargetSchema}_{TargetName}"
else:
    target_data_path = f"abfss://{TargetWorkspace}@onelake.dfs.fabric.microsoft.com/{TargetLakehouse}/Tables/{DataSourceNamespace}_{TargetSchema}_{TargetName}"
print(f"  source = {source_changes_data_path[:60]}...")
print(f"  target = {target_data_path[:60]}...")
print("STEP 7: OK")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

print("ALL DIAGNOSTIC STEPS PASSED")
notebookutils.notebook.exit("DIAG_OK")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
'''

content_b64 = base64.b64encode(TEST_NB.encode()).decode()

# Find or create
status, data = fabric_api('GET', f'workspaces/{CODE_WS}/items?type=Notebook')
diag_id = None
for item in data.get('value', []):
    if item['displayName'] == 'NB_DIAGNOSTIC_MINIMAL':
        diag_id = item['id']
        break

if not diag_id:
    status, data = fabric_api('POST', f'workspaces/{CODE_WS}/items', {
        'displayName': 'NB_DIAGNOSTIC_MINIMAL',
        'type': 'Notebook',
    })
    diag_id = data.get('id')
    print(f'Created diagnostic notebook: {diag_id}')
else:
    print(f'Found existing diagnostic notebook: {diag_id}')

# Upload definition
status, data = fabric_api('POST', f'workspaces/{CODE_WS}/items/{diag_id}/updateDefinition', {
    'definition': {
        'parts': [{
            'path': 'notebook-content.py',
            'payload': content_b64,
            'payloadType': 'InlineBase64',
        }]
    }
})
print(f'Upload status: {status}')

# Trigger with same params as the Bronze test
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
            'SourceLakehouse': {'value': '3b9a7e79-1615-4ec2-9e93-0bdebe985d5a', 'type': 'string'},
            'SourceLakehouseName': {'value': 'LH_DATA_LANDINGZONE', 'type': 'string'},
            'TargetWorkspace': {'value': DATA_WS, 'type': 'string'},
            'TargetLakehouse': {'value': 'f06393ca-c024-435f-8d7f-9f5aa3bb4cb3', 'type': 'string'},
            'TargetLakehouseName': {'value': 'LH_BRONZE_LAYER', 'type': 'string'},
            'DataSourceNamespace': {'value': 'mes', 'type': 'string'},
            'LandingzoneEntityId': {'value': '1', 'type': 'string'},
            'BronzeLayerEntityId': {'value': '1', 'type': 'string'},
        }
    }
}

time.sleep(15)  # Wait for Fabric to process the updated definition
url = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{diag_id}/jobs/instances?jobType=RunNotebook'
payload = json.dumps(params).encode()
req = urllib.request.Request(
    url, data=payload, method='POST',
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
)
resp = urllib.request.urlopen(req)
loc = resp.headers.get('Location', '')
run_id = loc.split('/')[-1]
print(f'Triggered! Run ID: {run_id}')

# Poll
for i in range(20):
    time.sleep(15)
    url = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{diag_id}/jobs/instances/{run_id}'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    status = data.get('status', 'Unknown')
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] Status: {status}', flush=True)
    if status in ('Completed', 'Failed', 'Cancelled'):
        print(json.dumps(data, indent=2))
        break
