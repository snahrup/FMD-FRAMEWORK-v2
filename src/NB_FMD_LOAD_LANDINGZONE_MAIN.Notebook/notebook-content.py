# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "",
# META       "default_lakehouse_name": "LH_DATA_LANDINGZONE",
# META       "default_lakehouse_workspace_id": "0596d0e7-e036-451d-a967-41a284302e8d",
# META       "known_lakehouses": [
# META         {
# META           "id": "3b9a7e79-1615-4ec2-9e93-0bdebe985d5a"
# META         }
# META       ]
# META     },
# META     "environment": {}
# META   }
# META }

# MARKDOWN ********************

# # FMD Landing Zone Loader — Notebook Edition (v2.3 Parallel)
#
# ## Overview
# Replaces the 11-pipeline LZ chain (`PL_FMD_LOAD_LANDINGZONE` → `PL_FMD_LDZ_COMMAND_*` → `PL_FMD_LDZ_COPY_FROM_*`)
# with a single notebook that handles all orchestration, logging, and error handling.
#
# ## Architecture
# - **Notebook** handles: metadata queries, entity grouping, source type routing, error continuation,
#   audit logging, watermark management, and summary reporting.
# - **Thin copy pipeline** (`PL_FMD_LDZ_COPY_SQL`) handles: the actual data copy via Fabric's
#   gateway-backed connection. This is the only part that requires pipeline — Fabric Spark can't route
#   JDBC through on-premises data gateways, but pipeline Copy Activities can.
#
# ## What This Notebook Does
# 1. Queries `vw_LoadSourceToLandingzone` for active entities (same view the pipeline used)
# 2. Groups entities by DataSource
# 3. For each entity: invokes `PL_FMD_LDZ_COPY_SQL` which copies data through the gateway connection
# 4. Calls the same stored procedures for execution tracking and audit logging
# 5. Registers files for Bronze pickup
# 6. **Continues on failure** — one bad entity does NOT kill the rest
#
# ## What This Notebook Does NOT Change
# - Bronze layer (still `NB_FMD_LOAD_LANDING_BRONZE` via `NB_FMD_PROCESSING_PARALLEL_MAIN`)
# - Silver layer (still `NB_FMD_LOAD_BRONZE_SILVER` via `NB_FMD_PROCESSING_PARALLEL_MAIN`)
# - Metadata DB schema, views, stored procedures
# - Entity registrations
# - Lakehouse paths or file naming conventions

# CELL ********************

config_settings = notebookutils.variableLibrary.getLibrary("VAR_CONFIG_FMD")
default_settings = notebookutils.variableLibrary.getLibrary("VAR_FMD")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# PARAMETERS CELL ********************

###############################
# Filter Parameters
###############################

# Filter by DataSource namespace (e.g., "OPTIVA", "MES", "ETQ"). Empty = all active sources.
DataSourceFilter = ""

# Filter by specific DataSourceId. 0 = all. Use this for targeted runs.
DataSourceIdFilter = 0

# Maximum entities to process (0 = unlimited). Useful for test runs.
MaxEntities = 0

# Maximum concurrent pipeline jobs. Each job runs independently through the gateway.
MaxParallel = 5

###############################
# Copy Pipeline Configuration
###############################

# Name of the thin copy pipeline deployed in the CODE workspace.
# This pipeline does ONE thing: Copy Activity from source (via gateway) to lakehouse (parquet).
CopyPipelineName = "PL_FMD_LDZ_COPY_SQL"

# CODE workspace where the copy pipeline lives.
CodeWorkspaceGuid = "c0366b24-e6f8-4994-b4df-b765ecb5bbf8"

# Item ID of the copy pipeline in Fabric (from deploy_lz_copy_pipeline.py output).
CopyPipelineId = "9a06a21d-d139-4356-81d2-6d6e0630a01b"

###############################
# Logging & Pipeline Context
###############################
driver = '{ODBC Driver 18 for SQL Server}'
connstring = config_settings.fmd_fabric_db_connection
database = config_settings.fmd_fabric_db_name

# Set by orchestrator pipeline (or defaults for manual runs)
TriggerGuid = ""
TriggerTime = ""
TriggerType = ""

# Dry run mode — queries metadata and validates but does NOT extract data
DryRun = False

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Load Libraries

# CELL ********************

import json
import uuid
import struct
import pyodbc
import re
import time
import traceback
import urllib.request
import urllib.error
from datetime import datetime, timezone
from collections import defaultdict

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# --- Inlined from NB_FMD_UTILITY_FUNCTIONS (removed %run for SP API compatibility) ---
import struct, pyodbc

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

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

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

def execute_with_outputs(exec_statement, driver, connstring, database, **params):
    """
    Runs the given T-SQL (optionally wrapping to capture return code).
    Returns a dict with:
      - result_sets: list[list[dict]]
      - return_code: int or None
      - out_params: dict (if you selected them)
      - messages: list[str]
    """
    # Get token for Azure SQL authentication
    token = notebookutils.credentials.getToken('https://analysis.windows.net/powerbi/api').encode("UTF-16-LE")
    token_struct = struct.pack(f'<I{len(token)}s', len(token), token)

    # Build connection
    conn = pyodbc.connect(
        f"DRIVER={driver};SERVER={connstring};PORT=1433;DATABASE={database};",
        attrs_before={1256: token_struct},
        timeout=12
    )
    if exec_statement:
        # Use the safe builder for stored procedures
        sql_to_run = build_exec_statement(exec_statement, **params)
        use_wrapper = True   # we know we appended a return code / out params trailer
    else:
        if not exec_statement:
            raise ValueError("Provide either proc_name+params or exec_statement.")
        trimmed = exec_statement.strip().upper()
        use_wrapper = trimmed.startswith("EXEC ") or trimmed.startswith("EXECUTE ")
        if use_wrapper and include_return_code:
            # Add return code wrapper if it's a bare EXEC
            sql_to_run = f"""
            SET NOCOUNT ON;
            DECLARE @__ret INT;
            {exec_statement.rstrip(';')};
            SELECT @__ret AS __return_code__;
            """
        else:
            sql_to_run = exec_statement


    result_sets = []
    messages = []
    return_code = None
    out_params = {}

    try:
        with conn.cursor() as cursor:
            # Warm-up
            cursor.execute("SELECT 1")
            cursor.fetchone()
            conn.timeout = 10

            cursor.execute(sql_to_run)

            # Collect result sets
            while True:
                if cursor.description:
                    cols = [d[0] for d in cursor.description]
                    rows = cursor.fetchall()
                    result_sets.append([dict(zip(cols, r)) for r in rows])
                if not cursor.nextset():
                    break

            # If wrapped, pick return code from the last set (and remove it from result_sets)
            if use_wrapper and result_sets:
                last = result_sets[-1]
                if len(last) == 1 and "__return_code__" in last[0]:
                    return_code = last[0]["__return_code__"]
                    result_sets = result_sets[:-1]  # remove synthetic RC set

            # If you also SELECT'ed OUTPUT params (e.g., SELECT @p AS p)
            # you can parse them from another final small result set:
            # Example pattern:
            #   SELECT @out1 AS __out_out1, @out2 AS __out_out2;
            if result_sets:
                # Heuristic: if the final set looks like a single-row out-param bag, peel it off
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

    return {
        "result_sets": result_sets,
        "return_code": return_code,
        "out_params": out_params,
        "messages": messages
    }
# --- End inlined NB_FMD_UTILITY_FUNCTIONS ---

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Runtime Context

# CELL ********************

start_time = datetime.now()
notebook_name = notebookutils.runtime.context.get('currentNotebookName', 'NB_FMD_LOAD_LANDINGZONE_MAIN')
notebook_id = str(notebookutils.runtime.context.get('currentNotebookId', ''))
workspace_guid = notebookutils.runtime.context.get('currentWorkspaceId', '')
PipelineParentRunGuid = notebookutils.runtime.context.get('PipelineParentRunGuid', '')
PipelineRunGuid = str(uuid.uuid4())
NotebookExecutionId = str(uuid.uuid4())

def format_guid(s):
    if s and "-" not in s and len(s) == 32:
        return '-'.join([s[:8], s[8:12], s[12:16], s[16:20], s[20:]])
    return s or '00000000-0000-0000-0000-000000000000'

TriggerGuid = format_guid(TriggerGuid)
if not PipelineParentRunGuid:
    PipelineParentRunGuid = '00000000-0000-0000-0000-000000000000'
if not TriggerTime:
    TriggerTime = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
if not TriggerType:
    TriggerType = 'Manual'

print(f"{'='*70}")
print(f"NB_FMD_LOAD_LANDINGZONE_MAIN  (v2.2 — Parallel Pipeline Invocation)")
print(f"{'='*70}")
print(f"Run ID        : {PipelineRunGuid}")
print(f"Notebook Exec : {NotebookExecutionId}")
print(f"DS Filter     : {DataSourceFilter or 'ALL'}")
print(f"DS ID Filter  : {DataSourceIdFilter or 'ALL'}")
print(f"Max Entities  : {MaxEntities or 'UNLIMITED'}")
print(f"Max Parallel  : {MaxParallel}")
print(f"Copy Pipeline : {CopyPipelineName} ({CopyPipelineId[:8]}...) @ {CodeWorkspaceGuid[:8]}...")
print(f"Dry Run       : {DryRun}")
print(f"Started       : {start_time.strftime('%Y-%m-%d %H:%M:%S UTC')}")
print(f"{'='*70}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Metadata DB Functions

# CELL ********************

def query_metadata(sql, params=None):
    """Run a query against the Fabric SQL metadata DB. Returns list of dicts."""
    token = notebookutils.credentials.getToken('https://analysis.windows.net/powerbi/api').encode("UTF-16-LE")
    token_struct = struct.pack(f'<I{len(token)}s', len(token), token)
    conn = pyodbc.connect(
        f"DRIVER={driver};SERVER={connstring};PORT=1433;DATABASE={database};",
        attrs_before={1256: token_struct},
        timeout=30
    )
    try:
        with conn.cursor() as cur:
            if params:
                cur.execute(sql, params)
            else:
                cur.execute(sql)
            if cur.description:
                columns = [col[0] for col in cur.description]
                return [dict(zip(columns, row)) for row in cur.fetchall()]
            return []
    finally:
        conn.close()


def _write_audit_to_delta(table_name: str, data: dict):
    """Write a single audit record to a Delta table in the default lakehouse."""
    try:
        from pyspark.sql import SparkSession
        from datetime import datetime as _dt
        _spark = SparkSession.builder.getOrCreate()
        data["created_at"] = _dt.utcnow().isoformat() + "Z"
        _df = _spark.createDataFrame([data])
        _df.write.mode("append").format("delta").saveAsTable(table_name)
    except Exception as _delta_err:
        print(f"  [WARN] Delta write to {table_name} failed: {_delta_err}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Fetch Entities from Metadata DB

# CELL ********************

# Build the WHERE filter — use the SAME view the pipelines use
where_clauses = ["1=1"]
if DataSourceFilter:
    where_clauses.append(f"DataSourceNamespace = '{DataSourceFilter}'")
if DataSourceIdFilter and DataSourceIdFilter > 0:
    where_clauses.append(f"DataSourceId = {DataSourceIdFilter}")

where_sql = " AND ".join(where_clauses)

entity_sql = f"""
SELECT *
FROM [execution].[vw_LoadSourceToLandingzone]
WHERE {where_sql}
ORDER BY DataSourceId, SourceSchema, SourceName
"""

print(f"Querying vw_LoadSourceToLandingzone with filter: {where_sql}")
entities = query_metadata(entity_sql)
print(f"Found {len(entities)} active entities")

# Print column names on first run so we can verify
if entities:
    print(f"View columns: {list(entities[0].keys())}")

if MaxEntities and MaxEntities > 0:
    entities = entities[:MaxEntities]
    print(f"Limited to first {MaxEntities} entities")

# Group by DataSource for reporting
ds_groups = defaultdict(list)
for e in entities:
    ds_groups[e.get('DataSourceNamespace', 'UNKNOWN')].append(e)

print(f"\nEntity Breakdown:")
for ns, group in sorted(ds_groups.items()):
    ct = group[0].get('ConnectionType', '?') if group else '?'
    print(f"  {ns}: {len(group)} entities (ConnectionType={ct})")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Validate Connection Map

# CELL ********************

# Validate that each DataSource has a ConnectionGuid (required for pipeline copy).
# No server resolution needed — the pipeline's Copy Activity uses the ConnectionGuid
# to route through the Fabric gateway connection transparently.

connection_map = {}
missing_connections = []

seen_ds = set()
for e in entities:
    ds_id = str(e.get('DataSourceId', ''))
    if ds_id in seen_ds:
        continue
    seen_ds.add(ds_id)

    conn_guid = e.get('ConnectionGuid', '')
    namespace = e.get('DataSourceNamespace', '')
    db_name = e.get('DataSourceName', '')
    conn_type = e.get('ConnectionType', '')
    ds_type = e.get('DataSourceType', '')

    if conn_guid:
        connection_map[ds_id] = {
            "connection_guid": str(conn_guid),
            "namespace": namespace,
            "database": db_name,
            "connection_type": conn_type,
            "datasource_type": ds_type,
        }
    else:
        missing_connections.append(f"DS {ds_id} ({namespace}): No ConnectionGuid!")

print(f"\nConnection Map ({len(connection_map)} sources):")
for ds_id, info in sorted(connection_map.items()):
    print(f"  DS {ds_id} ({info['namespace']}): {info['database']} "
          f"[{info['connection_type']}] ConnGuid={info['connection_guid'][:8]}...")

if missing_connections:
    print(f"\nWARNING — Missing connections (these entities will be skipped):")
    for msg in missing_connections:
        print(f"  {msg}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Copy Pipeline Function

# CELL ********************

def build_source_query(entity):
    """Build the SELECT query for extracting data from the source table."""
    schema = entity['SourceSchema'] or 'dbo'
    table = entity['SourceName']
    return f"SELECT * FROM [{schema}].[{table}]"


def build_incremental_query(entity, last_load_value):
    """Build incremental SELECT with WHERE clause on watermark column."""
    schema = entity['SourceSchema'] or 'dbo'
    table = entity['SourceName']
    incr_col = entity.get('IsIncrementalColumn', '')

    if not incr_col or not last_load_value:
        return build_source_query(entity)

    # Quote the value — handle both datetime and numeric watermarks
    try:
        float(last_load_value)
        where = f"[{incr_col}] > {last_load_value}"
    except (ValueError, TypeError):
        where = f"[{incr_col}] > '{last_load_value}'"

    return f"SELECT * FROM [{schema}].[{table}] WHERE {where}"


def submit_pipeline_job(entity, source_query, token):
    """
    Fire off a pipeline copy job via Fabric REST API. Returns polling URL immediately.
    Does NOT wait for completion — that's handled by the parallel poll loop.
    """
    conn_guid = str(entity.get('ConnectionGuid', ''))
    params = {
        "ConnectionGuid": conn_guid,
        "SourceSchema": entity.get('SourceSchema') or 'dbo',
        "SourceName": entity['SourceName'],
        "SourceDataRetrieval": source_query,
        "DatasourceName": entity.get('DataSourceName', ''),
        "WorkspaceGuid": str(entity['WorkspaceGuid']).lower(),
        "TargetLakehouseGuid": str(entity['TargetLakehouseGuid']).lower(),
        "TargetFilePath": entity['TargetFilePath'],
        "TargetFileName": entity['TargetFileName'],
    }

    invoke_url = (
        f"https://api.fabric.microsoft.com/v1/workspaces/{CodeWorkspaceGuid}"
        f"/items/{CopyPipelineId}/jobs/instances?jobType=Pipeline"
    )
    body = json.dumps({"executionData": {"parameters": params}}).encode()
    req = urllib.request.Request(
        invoke_url, data=body, method='POST',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    )
    try:
        resp = urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()[:500]
        raise RuntimeError(f"Failed to invoke copy pipeline: HTTP {e.code} — {err_body}")

    location = resp.headers.get('Location', '')
    resp_data = resp.read().decode()

    if not location and resp_data:
        job_info = json.loads(resp_data)
        job_id = job_info.get('id', '')
        if job_id:
            location = (
                f"https://api.fabric.microsoft.com/v1/workspaces/{CodeWorkspaceGuid}"
                f"/items/{CopyPipelineId}/jobs/instances/{job_id}"
            )

    if not location:
        raise RuntimeError("Pipeline invoked but no Location header or job ID returned")

    return location


def poll_job_status(location, token):
    """Poll a single job. Returns (status_str, failure_reason_or_None)."""
    poll_req = urllib.request.Request(location, headers={'Authorization': f'Bearer {token}'})
    poll_resp = urllib.request.urlopen(poll_req)
    job = json.loads(poll_resp.read().decode())
    status = job.get('status', '')
    reason = None
    if status in ('Failed', 'Cancelled', 'Deduped'):
        r = job.get('failureReason', {})
        reason = r.get('message', '') if isinstance(r, dict) else str(r)
    return status, reason

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Metadata Logging Functions

# CELL ********************

def log_copy_start(entity):
    """Log StartCopyActivity to copy_activity_audit Delta table (replaces sp_AuditCopyActivity)."""
    try:
        _write_audit_to_delta("copy_activity_audit", {
            "PipelineRunGuid": PipelineRunGuid,
            "CopyActivityName": notebook_name,
            "CopyActivityParameters": entity["SourceName"],
            "EntityLayer": "Landingzone",
            "TriggerType": TriggerType,
            "LogType": "StartCopyActivity",
            "LogDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "LogData": '{"Action":"Start"}',
            "EntityId": int(entity["EntityId"]) if entity.get("EntityId") else None,
        })
    except Exception as e:
        print(f"  WARNING: log_copy_start failed for {entity['SourceName']}: {str(e)[:200]}")


def log_copy_end(entity, row_count, duration_sec):
    """Log EndCopyActivity to copy_activity_audit Delta table (replaces sp_AuditCopyActivity)."""
    log_data = json.dumps({
        "Action": "End",
        "rowsCopied": row_count,
        "duration": f"{duration_sec:.1f}s",
        "source": f"{entity['SourceSchema']}.{entity['SourceName']}"
    })
    try:
        _write_audit_to_delta("copy_activity_audit", {
            "PipelineRunGuid": PipelineRunGuid,
            "CopyActivityName": notebook_name,
            "CopyActivityParameters": entity["SourceName"],
            "EntityLayer": "Landingzone",
            "TriggerType": TriggerType,
            "LogType": "EndCopyActivity",
            "LogDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "LogData": log_data,
            "EntityId": int(entity["EntityId"]) if entity.get("EntityId") else None,
        })
    except Exception as e:
        print(f"  WARNING: log_copy_end failed for {entity['SourceName']}: {str(e)[:200]}")


def log_copy_failure(entity, error_msg):
    """Log FailedCopyActivity to copy_activity_audit Delta table (replaces sp_AuditCopyActivity)."""
    log_data = json.dumps({"Action": "Error", "Message": str(error_msg)[:500]})
    try:
        _write_audit_to_delta("copy_activity_audit", {
            "PipelineRunGuid": PipelineRunGuid,
            "CopyActivityName": notebook_name,
            "CopyActivityParameters": entity["SourceName"],
            "EntityLayer": "Landingzone",
            "TriggerType": TriggerType,
            "LogType": "FailedCopyActivity",
            "LogDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "LogData": log_data,
            "EntityId": int(entity["EntityId"]) if entity.get("EntityId") else None,
        })
    except Exception as e:
        print(f"  WARNING: log_copy_failure failed for {entity['SourceName']}: {str(e)[:200]}")


def register_lz_entity(entity):
    """Write to pipeline_lz_entity Delta table (replaces sp_UpsertPipelineLandingzoneEntity)."""
    try:
        _write_audit_to_delta("pipeline_lz_entity", {
            "LandingzoneEntityId": int(entity["EntityId"]) if entity.get("EntityId") else None,
            "FileName": entity.get("TargetFileName"),
            "FilePath": entity.get("TargetFilePath"),
            "IsProcessed": 0,
            "InsertDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
    except Exception as e:
        print(f"  WARNING: register_lz_entity failed for {entity['SourceName']}: {str(e)[:200]}")


def update_watermark(entity_id, new_value):
    """Write watermark to watermarks Delta table (replaces sp_UpsertLandingZoneEntityLastLoadValue)."""
    if not new_value:
        return
    try:
        _write_audit_to_delta("watermarks", {
            "LandingzoneEntityId": int(entity_id) if entity_id else None,
            "LoadValue": str(new_value),
            "LastLoadDatetime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
    except Exception as e:
        print(f"  WARNING: update_watermark failed for entity {entity_id}: {str(e)[:200]}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Pre-Flight Validation

# CELL ********************

# Load existing watermark values for incremental entities.
# NOTE: No connectivity test needed — the pipeline handles gateway routing.
# If the gateway connection fails, the pipeline will return an error per-entity.

incremental_ids = [e['EntityId'] for e in entities if str(e.get('IsIncremental', '')).lower() in ('true', '1')]
last_load_values = {}

if incremental_ids:
    id_list = ','.join(str(i) for i in incremental_ids)
    try:
        llv_rows = query_metadata(f"""
            SELECT LandingzoneEntityId, LoadValue
            FROM integration.LandingzoneEntityLastLoadValue
            WHERE LandingzoneEntityId IN ({id_list})
        """)
        last_load_values = {r['LandingzoneEntityId']: r['LoadValue'] for r in llv_rows}
        print(f"Loaded {len(last_load_values)} existing watermark values for incremental entities")
    except Exception as e:
        print(f"  WARNING: Could not load watermark values (table may not exist): {str(e)[:200]}")
        print(f"  All entities will use full load")

# Validate entities have required fields
valid_count = 0
skip_reasons = defaultdict(int)
for e in entities:
    conn_guid = e.get('ConnectionGuid', '')
    if not conn_guid:
        skip_reasons['no_connection_guid'] += 1
        continue
    if not e.get('TargetLakehouseGuid'):
        skip_reasons['no_target_lakehouse'] += 1
        continue
    if not e.get('TargetFilePath') or not e.get('TargetFileName'):
        skip_reasons['no_target_path'] += 1
        continue
    valid_count += 1

print(f"\nPre-flight summary:")
print(f"  Valid entities ready for copy: {valid_count}/{len(entities)}")
if skip_reasons:
    for reason, count in skip_reasons.items():
        print(f"  Will skip {count} entities: {reason}")
print(f"  Incremental entities: {len(incremental_ids)} ({len(last_load_values)} with existing watermarks)")
print(f"  Copy pipeline: {CopyPipelineName} in workspace {CodeWorkspaceGuid[:8]}...")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Main Extraction Loop

# CELL ********************

succeeded = 0
failed = 0
skipped = 0
submitted = 0
failures = []
results_by_source = defaultdict(lambda: {"ok": 0, "fail": 0, "skip": 0, "rows": 0})

total = len(entities)
print(f"\n{'='*70}")
print(f"Processing {total} entities via {CopyPipelineName} (MaxParallel={MaxParallel})")
print(f"{'='*70}\n")

# ── Phase 1: Pre-process entities into a submission queue ──
entity_queue = []  # list of (idx, entity, query)
for idx, entity in enumerate(entities):
    ns = entity.get('DataSourceNamespace', '?')
    source_name = entity['SourceName']
    source_schema = entity.get('SourceSchema') or 'dbo'
    entity_id = entity['EntityId']
    conn_guid = entity.get('ConnectionGuid', '')
    progress = f"[{idx+1}/{total}]"

    if not conn_guid:
        print(f"{progress} SKIP {ns}.{source_schema}.{source_name} — no ConnectionGuid")
        skipped += 1
        results_by_source[ns]["skip"] += 1
        continue

    if not entity.get('TargetLakehouseGuid') or not entity.get('TargetFilePath') or not entity.get('TargetFileName'):
        print(f"{progress} SKIP {ns}.{source_schema}.{source_name} — missing target lakehouse/path/filename")
        skipped += 1
        results_by_source[ns]["skip"] += 1
        continue

    if DryRun:
        is_incr = str(entity.get('IsIncremental', '')).lower() in ('true', '1')
        llv = last_load_values.get(entity_id, 'N/A')
        print(f"{progress} [DRY] {ns}.{source_schema}.{source_name} (incr={is_incr}, watermark={llv})")
        skipped += 1
        results_by_source[ns]["skip"] += 1
        continue

    # Build extraction query
    source_retrieval = (entity.get('SourceDataRetrieval') or '').strip()
    is_incremental = str(entity.get('IsIncremental', '')).lower() in ('true', '1')

    if source_retrieval:
        query = source_retrieval
    elif is_incremental and entity_id in last_load_values:
        query = build_incremental_query(entity, last_load_values[entity_id])
    else:
        query = build_source_query(entity)

    entity_queue.append((idx, entity, query))

print(f"\nReady: {len(entity_queue)} entities to copy, {skipped} skipped, parallelism={MaxParallel}")

# ── Phase 2: Parallel pipeline execution ──
# active_jobs: list of {idx, entity, location, start_time}
active_jobs = []
token = notebookutils.credentials.getToken('https://api.fabric.microsoft.com')
poll_cycle = 0

while entity_queue or active_jobs:
    # Fill active slots up to MaxParallel
    while entity_queue and len(active_jobs) < MaxParallel:
        idx, entity, query = entity_queue.pop(0)
        ns = entity.get('DataSourceNamespace', '?')
        source_name = entity['SourceName']
        source_schema = entity.get('SourceSchema') or 'dbo'

        log_copy_start(entity)
        try:
            location = submit_pipeline_job(entity, query, token)
            active_jobs.append({
                'idx': idx, 'entity': entity, 'location': location,
                'start_time': time.time(), 'query': query,
            })
            submitted += 1
            print(f"[{idx+1}/{total}] SUBMIT {ns}.{source_schema}.{source_name}")
        except Exception as e:
            error_msg = str(e)[:500]
            failed += 1
            results_by_source[ns]["fail"] += 1
            failures.append({
                "entity": f"{ns}.{source_schema}.{source_name}",
                "entity_id": entity['EntityId'],
                "error": error_msg, "duration": "0.0s"
            })
            log_copy_failure(entity, error_msg)
            print(f"[{idx+1}/{total}] FAIL (submit) {ns}.{source_schema}.{source_name} — {error_msg[:200]}")

    if not active_jobs:
        break

    # Wait then poll all active jobs
    time.sleep(15)
    poll_cycle += 1
    still_running = []

    for job in active_jobs:
        entity = job['entity']
        ns = entity.get('DataSourceNamespace', '?')
        source_name = entity['SourceName']
        source_schema = entity.get('SourceSchema') or 'dbo'
        duration = time.time() - job['start_time']

        try:
            status, reason = poll_job_status(job['location'], token)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                token = notebookutils.credentials.getToken('https://api.fabric.microsoft.com')
                still_running.append(job)
                continue
            still_running.append(job)
            continue

        if status == 'Completed':
            register_lz_entity(entity)
            log_copy_end(entity, 0, duration)
            # Update watermark for incremental entities so next run only gets new data
            is_incr = str(entity.get('IsIncremental', '')).lower() in ('true', '1')
            if is_incr and entity.get('IsIncrementalColumn'):
                # Use the copy start time as the new watermark — guarantees no gaps
                watermark_val = datetime.fromtimestamp(job['start_time']).strftime('%Y-%m-%d %H:%M:%S')
                update_watermark(entity['EntityId'], watermark_val)
            succeeded += 1
            results_by_source[ns]["ok"] += 1
            print(f"[{job['idx']+1}/{total}] OK {ns}.{source_schema}.{source_name} — copied in {duration:.1f}s")

        elif status in ('Failed', 'Cancelled', 'Deduped'):
            error_msg = f"Pipeline {status}: {reason or 'no details'}"
            failed += 1
            results_by_source[ns]["fail"] += 1
            failures.append({
                "entity": f"{ns}.{source_schema}.{source_name}",
                "entity_id": entity['EntityId'],
                "error": error_msg, "duration": f"{duration:.1f}s"
            })
            log_copy_failure(entity, error_msg)
            print(f"[{job['idx']+1}/{total}] FAIL {ns}.{source_schema}.{source_name} — {error_msg[:200]}")

        else:
            still_running.append(job)

    active_jobs = still_running

    # Status line every 4 poll cycles (~60s)
    if active_jobs and poll_cycle % 4 == 0:
        running_names = [f"{j['entity']['SourceName']}({time.time()-j['start_time']:.0f}s)" for j in active_jobs[:6]]
        queued = len(entity_queue)
        print(f"  ... {len(active_jobs)} running, {queued} queued, {succeeded} OK, {failed} fail | {', '.join(running_names)}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Summary and Exit

# CELL ********************

total_duration = (datetime.now() - start_time).total_seconds()
total_minutes = total_duration / 60

print(f"\n{'='*70}")
print(f"LANDING ZONE EXTRACTION COMPLETE")
print(f"{'='*70}")
print(f"Total time    : {total_minutes:.1f} min ({total_duration:.0f}s)")
print(f"Total entities: {total}")
print(f"  Succeeded   : {succeeded}")
print(f"  Failed      : {failed}")
print(f"  Skipped     : {skipped}")
print(f"{'='*70}")

print(f"\nPer-Source Breakdown:")
print(f"{'Source':<15} {'OK':>6} {'Fail':>6} {'Skip':>6} {'Rows':>12}")
print(f"{'-'*50}")
for ns in sorted(results_by_source.keys()):
    r = results_by_source[ns]
    print(f"{ns:<15} {r['ok']:>6} {r['fail']:>6} {r['skip']:>6} {r['rows']:>12,}")

if failures:
    print(f"\nFailed Entities ({len(failures)}):")
    for f in failures[:50]:
        print(f"  {f['entity']} ({f['duration']}): {f['error'][:200]}")

# Build exit value — same structure as NB_FMD_PROCESSING_PARALLEL_MAIN for compatibility
exit_value = {
    "total": total,
    "succeeded": succeeded,
    "failed": failed,
    "skipped": skipped,
    "duration_minutes": round(total_minutes, 1),
    "failures": failures[:20]  # Cap at 20 to stay under output limits
}

print(f"\n{'='*70}")
if failed == 0 and skipped == 0:
    print(f"STATUS: ALL {succeeded} ENTITIES LOADED SUCCESSFULLY")
elif failed == 0:
    print(f"STATUS: {succeeded} LOADED, {skipped} SKIPPED")
else:
    print(f"STATUS: {succeeded} LOADED, {failed} FAILED, {skipped} SKIPPED")
print(f"{'='*70}")

notebookutils.notebook.exit(json.dumps(exit_value))

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
