# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "cf57e8bf-7b34-471b-adea-ed80d05a4fdb",
# META       "default_lakehouse_name": "LH_BRONZE_LAYER",
# META       "default_lakehouse_workspace_id": "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a",
# META       "known_lakehouses": [
# META         {
# META           "id": "cf57e8bf-7b34-471b-adea-ed80d05a4fdb"
# META         },
# META         {
# META           "id": "2aef4ede-2918-4a6b-8ec6-a42108c67806"
# META         }
# META       ]
# META     },
# META     "environment": {}
# META   }
# META }

# MARKDOWN ********************

# # FMD Parallel Processing Main Notebook
# 
# ## Overview
# This notebook orchestrates parallel execution of data processing notebooks in the FMD framework. It handles batching, sequencing, and parallel execution of notebooks while managing dependencies and execution order.
# 
# ## Key Features
# - **Parallel Execution**: Executes multiple notebooks concurrently using `runMultiple` (max 50 per batch)
# - **Group Processing**: Groups related files by data source, target schema, and target table
# - **Sequential Ordering**: Processes files within the same group sequentially based on filename timestamps
# - **Batch Management**: Automatically creates execution batches while ensuring grouped items stay together
# - **Dependency Handling**: Maintains execution dependencies within file groups
# - **Auto-Discovery**: Automatically creates the custom DQ cleansing notebook if it doesn't exist
# 
# ## Parameters

# CELL ********************

from json import loads, dumps
import uuid
import re
from datetime import datetime, timezone
from collections import defaultdict
from typing import List

NotebookExecutionId = str(uuid.uuid4())



# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# PARAMETERS CELL ********************

Path = ""
useRootDefaultLakehouse= True
PipelineRunGuid = ""
PipelineGuid = ""
TriggerGuid = ""
TriggerTime = ""
TriggerType = ""

notebook_entities = ""
chunk_mode = ""


###############################Logging Parameters###############################
driver = '{ODBC Driver 18 for SQL Server}'


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

def format_guid(input_str: str) -> str:
    """
    Formats the input string by adding hyphens at specific positions if they are missing.
    Parameters:
    - input_str (str): The input string to be formatted.
    Returns:
    - str: The formatted string.
    """
    if "-" not in input_str and len(input_str) == 32:
        formatted_str = '-'.join([input_str[:8], input_str[8:12], input_str[12:16], input_str[16:20], input_str[20:]])
        return formatted_str
    else:
        return input_str
def is_valid_guid(guid_str: str) -> bool:
    """
    Check if a string is a valid GUID.

    Parameters:
    - guid_str (str): The string to be checked.

    Returns:
    - bool: True if the string is a valid GUID, False otherwise.
    """
    try:
        uuid_obj = uuid.UUID(guid_str)
        # Check if the UUID is valid
        return str(uuid_obj) == guid_str
    except ValueError:
        return False

def extract_ts_from_name(name: str) -> datetime:
    """
    Extracts YYYYMMDDHHMM from names like 'Sales_Invoices_202601311402.parquet'
    """
    match = re.search(r'_(\d{12})(?=\.parquet$)', name)
    if not match:
        raise ValueError(f"Invalid filename timestamp: {name}")
    return datetime.strptime(match.group(1), "%Y%m%d%H%M")


def group_key(item):
    """
    Define what 'same files' means. Adjust as needed.
    Here: group by data source + target + partition path.
    """
    p = item["params"]
    return (
        p.get("DataSourceNamespace"),
        p.get("TargetSchema"),
        p.get("TargetName")
    )

def batched(lst, first_size, default_size):
    """Yield first batch with 'first_size', then others with 'default_size'."""
    if not lst:
        return
    yield lst[:first_size]
    pos = first_size
    while pos < len(lst):
        yield lst[pos:pos+default_size]
        pos += default_size


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

## always use notebook guid instead of pipeline id
PipelineName = notebookutils.runtime.context.get('currentNotebookName')
PipelineGuid = str(notebookutils.runtime.context.get('currentNotebookId'))
WorkspaceGuid = notebookutils.runtime.context.get('currentWorkspaceId')
PipelineParentRunGuid = notebookutils.runtime.context.get('PipelineParentRunGuid')
PipelineRunGuid = str(uuid.uuid4())
TriggerGuid = format_guid(TriggerGuid)

if not PipelineParentRunGuid:
    PipelineParentRunGuid='00000000-0000-0000-0000-000000000000'
if not PipelineGuid:
    PipelineGuid='00000000-0000-0000-0000-000000000000'
if not TriggerGuid or not is_valid_guid(TriggerGuid):
    TriggerGuid = '00000000-0000-0000-0000-000000000000'
if not TriggerTime:
    TriggerTime=''
if not TriggerType:
    TriggerType=''
if not WorkspaceGuid:
    WorkspaceGuid='00000000-0000-0000-0000-000000000000'

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

starttime = datetime.now()

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

nb_name = 'NB_FMD_CUSTOM_DQ_CLEANSING'
nb_exists = False

try:
    notebookutils.notebook.get(nb_name)
    nb_exists = True
except:
    nb_exists = False

print("=" * 50)
print(f"Notebook Name : {nb_name}")
print(f"Exists        : {nb_exists}")
print("=" * 50)

if not nb_exists:
    print(f"Creating       : Running...")
    import requests
    import sempy.fabric as fabric
    import json
    import base64
    
    access_token =  notebookutils.credentials.getToken('https://analysis.windows.net/powerbi/api')
    workspace_id = fabric.get_notebook_workspace_id()
    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/notebooks"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    cell_code = """
    # Implement custom cleansings function here

    #def <functienaam> (df, columns, args):
    #    print(args['<custom parameter name>']) # use of custom parameters
    #    for column in columns: # apply function foreach column
    #        df = df.<custom logic>
    #    return df #always return dataframe.
    """

    notebook_json = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "cells": [
            {
                "cell_type": "code",
                "source": cell_code.strip().splitlines(keepends=True),
                "execution_count": None,
                "outputs": [],
                "metadata": {}
            }
        ],
        "metadata": {
            "language_info": {
                "name": "python"
            }
        }
    }

    notebook_str = json.dumps(notebook_json)
    notebook_bytes = notebook_str.encode('utf-8')
    notebook_base64 = base64.b64encode(notebook_bytes).decode('utf-8')

    payload = {
        "displayName": nb_name,
        "description": f"An automatic generated description for {nb_name}",
        "type": "Notebook",
        "definition": {
            "format": "ipynb",
            "parts": [
                {
                    "path": "notebook-content.ipynb",
                    "payload": notebook_base64,
                    "payloadType": "InlineBase64"
                }
            ]
        }
    }
    
    response = requests.post(url, headers=headers, json=payload)

    if response.status_code == 201 or 202:
        print(f"Created        : Successful")
        print("=" * 50)
    else:
        print(f"Created                      : Error")
        print(f"Failed to create notebook    : {response.status_code}")
        print(response.text)
        print("=" * 50)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Define Notebooks settings

# CELL ********************

if isinstance(Path, str):
    path_data = loads(Path)
elif isinstance(Path, List):
    path_data = Path
elif isinstance(Path, dict):
    path_data = [Path]

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# --- FETCH_FROM_SQL: Bypass ADF/Fabric 1MB pipeline parameter limit ---
# When the stored proc returns a lightweight signal instead of the full entity
# payload, the notebook fetches entities directly from SQL via pyodbc.
# This avoids the 1MB limit on pipeline parameters while keeping the pipeline
# JSON completely unchanged — the Lookup still calls the same stored proc name.
if (len(path_data) == 1
    and isinstance(path_data[0], dict)
    and path_data[0].get("path") == "FETCH_FROM_SQL"):

    import struct as _struct
    import pyodbc as _pyodbc

    _signal = path_data[0]["params"]
    _proc = _signal["proc"]
    _layer = _signal["layer"]
    _count = _signal.get("count", "?")

    print(f"FETCH_FROM_SQL: {_layer} layer — fetching {_count} entities directly from SQL...")

    _config = notebookutils.variableLibrary.getLibrary("VAR_CONFIG_FMD")
    _connstring = _config.fmd_fabric_db_connection
    _database = _config.fmd_fabric_db_name

    _token = notebookutils.credentials.getToken(
        'https://analysis.windows.net/powerbi/api'
    ).encode("UTF-16-LE")
    _token_struct = _struct.pack(f'<I{len(_token)}s', len(_token), _token)

    _conn = _pyodbc.connect(
        f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={_connstring};PORT=1433;DATABASE={_database};",
        attrs_before={1256: _token_struct},
        timeout=60
    )

    with _conn.cursor() as _cur:
        _cur.execute(f"EXEC {_proc}")
        _cols = [d[0] for d in _cur.description]
        _rows = _cur.fetchall()
    _conn.close()

    if _rows and 'NotebookParams' in _cols:
        _idx = _cols.index('NotebookParams')
        _full_json = _rows[0][_idx]
        path_data = loads(_full_json)
        print(f"FETCH_FROM_SQL: Loaded {len(path_data)} entities from SQL (bypassed 1MB limit)")
    else:
        raise ValueError(f"FETCH_FROM_SQL: No data returned from {_proc}")

    del _struct, _pyodbc, _signal, _proc, _layer, _count, _config, _connstring, _database
    del _token, _token_struct, _conn, _cols, _rows, _idx, _full_json

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

for i, item in enumerate(path_data):
    item["notebook_path"] = item["path"]
    data_source = item["params"]["TargetSchema"].split("/")[0]
    schema_table = "".join(item["params"]["TargetName"].split("_")[:2])
    item["notebook_activity_id"] = f"{data_source}_{schema_table}"

    # inject runtime params
    item["params"]["PipelineGuid"] = PipelineGuid
    item["params"]["PipelineName"] = PipelineName
    item["params"]["TriggerGuid"] = TriggerGuid
    item["params"]["TriggerType"] = TriggerType
    item["params"]["TriggerTime"] = TriggerTime
    item["params"]["WorkspaceGuid"] = WorkspaceGuid
    item["params"]["PipelineParentRunGuid"] = PipelineParentRunGuid
    item["params"]["PipelineRunGuid"] = PipelineRunGuid
    item["params"]["NotebookExecutionId"] = NotebookExecutionId
    item["params"]["useRootDefaultLakehouse"] = useRootDefaultLakehouse
    item["params"]["driver"] = driver


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# Chunking DISABLED — Fabric doesn't support recursive notebook.run() calls.
# The batching below (runMultiple with 50-activity batches) handles large entity
# sets natively. Stdout suppression (sys.stdout redirect) keeps output under 1MB.
CHUNK_SIZE = 99999
_chunking_active = False

if _chunking_active:
    import math
    num_chunks = math.ceil(len(path_data) / CHUNK_SIZE)
    total_succeeded = 0
    total_failed = 0
    all_failures = []

    print(f"Chunking {len(path_data)} entities into {num_chunks} chunks of ~{CHUNK_SIZE}")

    for ci in range(num_chunks):
        chunk = path_data[ci * CHUNK_SIZE : (ci + 1) * CHUNK_SIZE]
        print(f"  Chunk {ci + 1}/{num_chunks}: {len(chunk)} entities...")

        try:
            chunk_exit = notebookutils.notebook.run(
                "NB_FMD_PROCESSING_PARALLEL_MAIN",
                timeout_seconds=7200,
                arguments={
                    "Path": dumps(chunk),
                    "chunk_mode": "batch",
                    "useRootDefaultLakehouse": str(useRootDefaultLakehouse),
                    "TriggerGuid": TriggerGuid,
                    "TriggerTime": TriggerTime,
                    "TriggerType": TriggerType,
                }
            )
            if isinstance(chunk_exit, str):
                try:
                    chunk_exit = loads(chunk_exit)
                except:
                    chunk_exit = {"succeeded": len(chunk), "failed": 0, "failures": []}
            total_succeeded += chunk_exit.get("succeeded", 0)
            total_failed += chunk_exit.get("failed", 0)
            if chunk_exit.get("failures"):
                all_failures.extend(chunk_exit["failures"])
            print(f"  Chunk {ci + 1}: {chunk_exit.get('succeeded', '?')} ok, {chunk_exit.get('failed', 0)} failed")
        except Exception as e:
            print(f"  Chunk {ci + 1} ERROR: {str(e)[:300]}")
            total_failed += len(chunk)

    print(f"\n{'='*60}")
    print(f"Execution Summary: {len(path_data)} entities | {total_succeeded} succeeded | {total_failed} failed")
    print(f"{'='*60}")

    TotalRuntime = str((datetime.now() - starttime))
    print(f"\nCompleted in {TotalRuntime}")

    exit_value = {"total": len(path_data), "succeeded": total_succeeded, "failed": total_failed, "failures": all_failures[:20]}

    if total_failed > 0:
        notebookutils.notebook.exit(dumps(exit_value))
        raise ValueError(f"Failed notebooks: {total_failed}/{len(path_data)}")

    notebookutils.notebook.exit(dumps(exit_value))

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Execute Notebooks (batch mode — single chunk)

# CELL ********************

# Guard: skip all runMultiple execution when chunking handled this run
if _chunking_active:
    notebookutils.notebook.exit(dumps({"skipped": "chunking_handled"}))

cmd_dags = []

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# group by your definition of “same files”
groups = defaultdict(list)
for idx, it in enumerate(path_data):
    groups[group_key(it)].append((idx, it))

def safe_sort_key(pair):
    item = pair[1]
    name = item["params"].get("SourceFileName")

    if not name:
        return (datetime.max, "")   # no filename → put at end

    try:
        ts = extract_ts_from_name(name)
        return (ts, name)
    except:
        return (datetime.max, name) # malformed filename → also at end

largest_group_size = 1

for g, entries in list(groups.items()):
    sorted_entries = sorted(entries, key=safe_sort_key)

    for order_idx, (orig_idx, item) in enumerate(sorted_entries):
        item["is_grouped_job"] = True
        item["order_index"] = order_idx

    groups[g] = sorted_entries
    largest_group_size = max(largest_group_size, len(sorted_entries))

# Build a notebooks list that keeps groups intact
# Strategy: place grouped items contiguously, preserving their internal order.
# You can choose the order of groups; here we keep original appearance order.
seen_indices = set()
ordered_notebooks = []
for idx, it in enumerate(path_data):
    if idx in seen_indices:
        continue
    g = group_key(it)
    if g in groups:
        for orig_idx, mem in groups[g]:
            if orig_idx not in seen_indices:
                ordered_notebooks.append(mem)
                seen_indices.add(orig_idx)

# Add any remaining (non-grouped) items (if any)
for idx, it in enumerate(path_data):
    if idx not in seen_indices:
        ordered_notebooks.append(it)

# Batching with guarantee: no group split across batches
# Cap batches at 50 (runMultiple limit) while ensuring largest group fits in one batch
max_concurrent_notebooks = 50
if largest_group_size > max_concurrent_notebooks:
    print(f"WARNING: largest group has {largest_group_size} items, exceeds runMultiple limit of {max_concurrent_notebooks}")
first_batch_size = min(max_concurrent_notebooks, max(max_concurrent_notebooks, largest_group_size))

for n, batch in enumerate(batched(ordered_notebooks, first_batch_size, max_concurrent_notebooks)):
    activities = []
    # Track last activity name per group to wire dependsOn inside that group
    last_activity_name_by_group = {}

    for i, nb in enumerate(batch):
        activity_name = f"{nb['notebook_activity_id']}_{n}_{i}"
        activity = {
            "name": activity_name,
            "path": nb["notebook_path"],
            "timeoutPerCellInSeconds": 600,
            "args": nb["params"],
            "retry": 2,
            "retryIntervalInSeconds": 0
        }

        if nb.get("is_grouped_job"):
            g = group_key(nb)
            prev = last_activity_name_by_group.get(g)
            if prev is not None:
                # Chain to the previous activity within the same group
                activity["dependencies"] = [prev]
            last_activity_name_by_group[g] = activity_name

        activities.append(activity)

    cmd_dag = {
        "activities": activities,
        "timeoutInSeconds": 7200,
        "concurrency": len(activities)  # Allow concurrent execution; in-group dependencies enforced by dependsOn
    }
    cmd_dags.append(cmd_dag)
    print(f"Batch {n + 1}: {len(activities)} activities created")

print(f"\nTotal batches: {len(cmd_dags)} (runMultiple limit: 50 per batch)")


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# Execute Notebooks in batches (runMultiple max: 50 notebooks per call)
# Suppress stdout during runMultiple to stay under Fabric 1MB output limit.
# runMultiple generates significant internal output (Spark session info,
# monitoring URLs, etc.) that accumulates across batches.
import sys, io

results = {}
for batch_idx, cmd_dag in enumerate(cmd_dags):
    try:
        print(f"Batch {batch_idx + 1}/{len(cmd_dags)}: {len(cmd_dag['activities'])} activities...")
        _old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        try:
            batch_results = notebookutils.mssparkutils.notebook.runMultiple(cmd_dag, {"displayDAGViaGraphviz": False})
        finally:
            sys.stdout = _old_stdout
        results.update(batch_results)
        print(f"  Batch {batch_idx + 1} done")
    except Exception as e:
        sys.stdout = _old_stdout
        if hasattr(e, 'result'):
            print(f"  Batch {batch_idx + 1} partial ({str(e)[:100]})")
            results.update(e.result)
        else:
            print(f"  Batch {batch_idx + 1} ERROR: {str(e)[:200]}")
            raise

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# Convert the data into a single result set (minimal to stay under 1MB output limit)
result_set = []
for table_name, table_data in results.items():
    exception_str = str(table_data["exception"])
    entry = {"TableName": table_name, "exception": exception_str}
    if exception_str != "None":
        entry["exitVal"] = table_data["exitVal"]
    result_set.append(entry)

succeeded = [r for r in result_set if r.get('exception') == 'None']
failed_items = [r for r in result_set if r.get('exception') != 'None']
print(f"\n{'='*60}")
print(f"Execution Summary: {len(result_set)} activities | {len(succeeded)} succeeded | {len(failed_items)} failed")
print(f"{'='*60}")
if failed_items:
    print(dumps(failed_items, indent=2))

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

fails = []
for result in result_set:
    if result.get('exception') != "None":
        fails.append(result)

if fails:
    failed_names = [r['TableName'] for r in fails[:10]]
    print(f"ERRORS: {len(fails)} failed")
    for f in fails[:10]:
        print(f"  {f['TableName']}: {str(f['exception'])[:100]}")
    raise ValueError(f"Failed notebooks: {failed_names}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

try:
    # Minimal exit value to stay under Fabric 1MB output limit
    exit_value = {
        "total": len(result_set),
        "succeeded": len(succeeded),
        "failed": len(failed_items),
        "failures": [{"TableName": f["TableName"], "exception": f["exception"]} for f in failed_items] if failed_items else []
    }
except Exception as e:
    print(e)
    exit_value = 'Error in Exit Value or No Notebooks to Process'

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

TotalRuntime = str((datetime.now() - starttime))
print(f"Completed in {TotalRuntime}")
notebookutils.notebook.exit(exit_value)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
