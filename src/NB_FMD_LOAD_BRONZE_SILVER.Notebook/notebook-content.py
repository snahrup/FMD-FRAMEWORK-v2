# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "",
# META       "default_lakehouse_name": "LH_BRONZE_LAYER",
# META       "default_lakehouse_workspace_id": "0596d0e7-e036-451d-a967-41a284302e8d",
# META       "known_lakehouses": [
# META         {
# META           "id": "f06393ca-c024-435f-8d7f-9f5aa3bb4cb3"
# META         },
# META         {
# META           "id": "f85e1ba0-2e40-4de5-be1e-f8ad3ddbc652"
# META         }
# META       ]
# META     }
# META   }
# META }

# MARKDOWN ********************

# # FMD Load Bronze to Silver Notebook
# 
# ## Overview
# This notebook handles the data transformation and loading process from the Bronze layer to the Silver layer in the FMD framework. It implements Slowly Changing Dimension (SCD) Type 2 logic to track historical changes while applying data quality checks and cleansing rules.
# 
# ## Key Features
# - **SCD Type 2 Implementation**: Maintains complete history of records with versioning and temporal tracking
# - **Change Detection**: Uses hashed columns to identify inserts, updates, and deletes
# - **Data Quality & Cleansing**: Applies configurable cleansing rules from the framework database
# - **Soft Deletes**: Marks deleted records with IsDeleted flag while preserving history
# - **Temporal Tracking**: Maintains RecordStartDate, RecordEndDate, RecordModifiedDate, and IsCurrent flags
# - **V-Order Optimization**: Enables V-Order for improved query performance on Silver tables
# - **Change Data Feed**: Enables CDC capabilities for downstream consumers
# - **Audit Logging**: Tracks execution details in the framework database
# 
# ## SCD Type 2 Operations
# - **Inserts**: New records marked as IsCurrent=True with RecordEndDate='9999-12-31'
# - **Updates**: Old version marked as IsCurrent=False, new version inserted with IsCurrent=True
# - **Deletes**: Records marked as IsDeleted=True and IsCurrent=False
# 
# ## Process Flow
# 1. Load configuration and Bronze source data
# 2. Apply cleansing rules from framework configuration
# 3. Calculate hash columns for change detection
# 4. Add SCD Type 2 tracking columns
# 5. Identify changes (inserts, updates, deletes) by comparing with existing Silver data
# 6. Execute Delta merge operation applying SCD Type 2 logic
# 7. Optimize and vacuum Delta table
# 8. Update processing status and complete audit logging

# CELL ********************

config_settings=notebookutils.variableLibrary.getLibrary("VAR_CONFIG_FMD")
default_settings=notebookutils.variableLibrary.getLibrary("VAR_FMD")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# PARAMETERS CELL ********************

# Set arguments
PrimaryKeys = "HashedPKColumn"
IsIncremental = False

SourceWorkspace= ""
SourceLakehouse =""
SourceLakehouseName =''
SourceSchema = ""
SourceName = ""
DataSourceNamespace =""
BronzeLayerEntityId =""
SilverLayerEntityId=""

# Pipeline context parameters — normally injected by ForEach activity.
# Default to valid GUID values for direct RunNotebook API invocation.
NotebookExecutionId = "00000000-0000-0000-0000-000000000000"
PipelineRunGuid = "00000000-0000-0000-0000-000000000000"
PipelineParentRunGuid = "00000000-0000-0000-0000-000000000000"
TriggerType = "API"
TriggerGuid = "00000000-0000-0000-0000-000000000000"

TargetWorkspace= ""
TargetLakehouse =""
TargetLakehouseName =''
TargetSchema = ""
TargetName = ""
cleansing_rules = []
key_vault =default_settings.key_vault_uri_name
###############################Logging Parameters###############################
driver = '{ODBC Driver 18 for SQL Server}'
connstring=config_settings.fmd_fabric_db_connection
database=config_settings.fmd_fabric_db_name
schema_enabled =default_settings.lakehouse_schema_enabled
EntityLayer='Silver'
result_data=''

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Load Libraries

# CELL ********************

import re
from datetime import datetime, timezone
import json
from delta.tables import *
from pyspark.sql.functions import sha2, concat_ws, md5, StringType,current_timestamp, expr


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Define Starttime

# CELL ********************

start_audit_time = datetime.now()


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

token =  notebookutils.credentials.getToken('https://analysis.windows.net/powerbi/api')

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Execution Logic

# CELL ********************

# --- Inlined from NB_FMD_UTILITY_FUNCTIONS (removed %run for SP API compatibility) ---
import struct, pyodbc

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

_SAFE_PROC_RE = re.compile(r'^[\w.\[\]]+$')

def _safe_proc_name(name):
    """Validate stored procedure name to prevent SQL injection."""
    if not name or not _SAFE_PROC_RE.match(name):
        raise ValueError(f"Invalid stored procedure name: {name!r}")
    return name

def build_exec_statement(proc_name, **params):
    safe_proc = _safe_proc_name(proc_name)
    param_strs = []
    for key, value in params.items():
        if value is not None:
            if not re.match(r'^\w+$', key):
                raise ValueError(f"Invalid parameter name: {key!r}")
            if isinstance(value, str):
                param_strs.append(f"@{key}='{value.replace(chr(39), chr(39)+chr(39))}'")
            else:
                param_strs.append(f"@{key}={value}")

    if param_strs:
        return f"EXEC {safe_proc}, " + ", ".join(param_strs)
    else:
        return f"EXEC {safe_proc}"

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
            except Exception as e:
                print(f"Warning: cursor.commit() failed (non-fatal): {e}")

    finally:
        try:
            conn.close()
        except Exception as e:
            print(f"Warning: conn.close() failed (non-fatal): {e}")

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

# ## Define Audit Helpers and Logging Setup

# CELL ********************

# Ensure TriggerTime is formatted correctly
TriggerTime = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
notebook_name=  notebookutils.runtime.context['currentNotebookName']

# GetCleansingRule still uses pyodbc (read from Fabric SQL metadata DB)
GetCleansingRule = (
    f"[execution].[sp_GetSilverCleansingRule] "
    f"@SilverLayerEntityId = \"{SilverLayerEntityId}\""
)


def _write_audit_to_delta(table_name: str, data: dict):
    """Write a single audit record to a Delta table in the default lakehouse."""
    try:
        from pyspark.sql import SparkSession as _SparkSession
        from datetime import datetime as _dt
        _spark = _SparkSession.builder.getOrCreate()
        data["created_at"] = _dt.utcnow().isoformat() + "Z"
        _df = _spark.createDataFrame([data])
        _df.write.mode("append").format("delta").saveAsTable(table_name)
    except Exception as _delta_err:
        print(f"  [WARN] Delta write to {table_name} failed: {_delta_err}")


def _audit_notebook_start():
    """Write StartNotebookActivity to notebook_executions Delta table (replaces sp_AuditNotebook)."""
    _write_audit_to_delta("notebook_executions", {
        "NotebookName": notebook_name,
        "PipelineRunGuid": PipelineRunGuid,
        "EntityId": int(BronzeLayerEntityId) if BronzeLayerEntityId else None,
        "EntityLayer": EntityLayer,
        "LogType": "StartNotebookActivity",
        "LogDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "LogData": '{"Action":"Start"}',
        "Status": "Started",
        "StartedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


def _audit_notebook_end(log_data_dict=None):
    """Write EndNotebookActivity to notebook_executions Delta table (replaces sp_AuditNotebook)."""
    _write_audit_to_delta("notebook_executions", {
        "NotebookName": notebook_name,
        "PipelineRunGuid": PipelineRunGuid,
        "EntityId": int(BronzeLayerEntityId) if BronzeLayerEntityId else None,
        "EntityLayer": EntityLayer,
        "LogType": "EndNotebookActivity",
        "LogDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "LogData": json.dumps(log_data_dict) if log_data_dict else None,
        "Status": "Completed",
        "EndedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


def _register_bronze_entity_processed():
    """Write to pipeline_bronze_entity Delta table (replaces sp_UpsertPipelineBronzeLayerEntity)."""
    _write_audit_to_delta("pipeline_bronze_entity", {
        "BronzeLayerEntityId": int(BronzeLayerEntityId) if BronzeLayerEntityId else None,
        "TableName": TargetName,
        "SchemaName": TargetSchema,
        "IsProcessed": 1,
        "InsertDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


def _register_silver_entity_processed():
    """Write to pipeline_bronze_entity with layer=silver (replaces sp_UpsertPipelineSilverLayerEntity).
    Note: pipeline_bronze_entity is reused for silver tracking; no separate silver pipeline table exists.
    """
    _write_audit_to_delta("pipeline_bronze_entity", {
        "BronzeLayerEntityId": int(SilverLayerEntityId) if SilverLayerEntityId else None,
        "TableName": TargetName,
        "SchemaName": TargetSchema,
        "IsProcessed": 1,
        "InsertDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


def _upsert_entity_status_silver(status, error_msg=None):
    """Write to entity_status Delta table for silver layer (replaces sp_UpsertEntityStatus).
    Uses BronzeLayerEntityId as the entity key — the entity chain is resolved downstream.
    """
    _write_audit_to_delta("entity_status", {
        "LandingzoneEntityId": int(BronzeLayerEntityId) if BronzeLayerEntityId else None,
        "Layer": "silver",
        "Status": status,
        "ErrorMessage": str(error_msg)[:500] if error_msg else None,
        "UpdatedBy": "notebook-silver",
        "LoadEndDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

try:
    _audit_notebook_start()
except Exception as _audit_err:
    print(f"WARNING: StartNotebookActivity audit logging failed: {_audit_err}")
_processing_error = None  # Global error flag — if set, downstream cells skip and we log the error at exit

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Set Configuration

# CELL ********************

#Make sure you have enabled V-Order

spark.conf.set("spark.sql.parquet.vorder.enabled", "true")

spark.conf.set("spark.sql.parquet.int96RebaseModeInRead", "CORRECTED")
spark.conf.set("spark.sql.parquet.int96RebaseModeInWrite", "CORRECTED")
spark.conf.set("spark.sql.parquet.datetimeRebaseModeInRead", "CORRECTED")
spark.conf.set("spark.sql.parquet.datetimeRebaseModeInWrite", "CORRECTED")

spark.conf.set('spark.microsoft.delta.optimize.fast.enabled', True)
spark.conf.set('spark.microsoft.delta.optimize.fileLevelTarget.enabled', True)
spark.conf.set('spark.databricks.delta.autoCompact.enabled', True)

spark.conf.set('spark.microsoft.delta.properties.defaults.enableChangeDataFeed',True)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Set your loading paths

# CELL ********************

# Path format: {Namespace}/{Table} — see ARCHITECTURE.md and config.json "paths" section
source_changes_data_path = f"abfss://{SourceWorkspace}@onelake.dfs.fabric.microsoft.com/{SourceLakehouse}/Tables/{DataSourceNamespace}/{SourceName}"
target_data_path = f"abfss://{TargetWorkspace}@onelake.dfs.fabric.microsoft.com/{TargetLakehouse}/Tables/{DataSourceNamespace}/{TargetName}"


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

if _processing_error is None:
    try:
        #Read all incoming changes in Parquet format
        dfDataChanged= spark.read\
                        .format("delta") \
                        .load(f"{source_changes_data_path}")
    except Exception as _e:
        _processing_error = f"Spark read failed for {SourceName} from Bronze: {_e}"
        print(f"ERROR: {_processing_error}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

#display(dfDataChanged)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ### Perform Cleansing

# CELL ********************

if _processing_error is None:
    if cleansing_rules == "":
        cleansing_rules = []

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

if _processing_error is None:
    try:
        CleansingRules=execute_with_outputs(GetCleansingRule, driver, connstring, database)
        rules_str = None
        # Extract the string
        rules_str = CleansingRules["result_sets"][0][0]["CleansingRules"]
        if rules_str != None :
        # Convert JSON text → Python dict/list
            cleansing_rules = json.loads(rules_str)
    except Exception as _e:
        print(f"WARNING: Cleansing rules fetch failed for {TargetName}: {_e}. Continuing without cleansing.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# --- Inlined from NB_FMD_DQ_CLEANSING (removed %run for SP API compatibility) ---
# Custom DQ cleansing functions can be defined here

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

def dynamic_call_cleansing_function(df: DataFrame,
        func_name: str,
        columns: str,
        *args,
        **kwargs):

    func = globals().get(func_name)

    if func:
        try:
            return func(df, columns, *args, **kwargs)
        except Exception as e:
            raise ValueError(f"Function '{func_name}' failed with Error: {e}")
    else:
        raise ValueError(f"Function '{func_name}' not found")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

def normalize_cleansing_rules(cleansing_rules):
    if cleansing_rules is None:
        return []

    # JSON string → Python object
    if isinstance(cleansing_rules, str):
        cleansing_rules = cleansing_rules.strip()
        if not cleansing_rules:
            return []
        cleansing_rules = json.loads(cleansing_rules)

    # Single dict → wrap in list
    if isinstance(cleansing_rules, dict):
        cleansing_rules = [cleansing_rules]

    if not isinstance(cleansing_rules, list):
        raise TypeError(
            f"cleansing_rules must be a list of dicts, got {type(cleansing_rules).__name__}"
        )

    for i, rule in enumerate(cleansing_rules):
        if not isinstance(rule, dict):
            raise TypeError(
                f"Rule at index {i} is not a dict (got {type(rule).__name__})"
            )

    return cleansing_rules

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

def handle_cleansing_functions(df: DataFrame, cleansing_rules):
    cleansing_rules = normalize_cleansing_rules(cleansing_rules)

    for rule in cleansing_rules:
        function = rule.get("function")
        if not function:
            print(f"'function' missing in: {rule}")
            continue

        parameters = rule.get("parameters")
        columns_raw = rule.get("columns")

        columns = (
            [c.strip() for c in columns_raw.split(";") if c.strip()]
            if columns_raw else []
        )

        df = dynamic_call_cleansing_function(
            df,
            function,
            columns,
            parameters
        )

    return df

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

from pyspark.sql.functions import col, trim, regexp_replace, lower, upper, initcap, when, length, lit, coalesce,to_date, to_timestamp, when
from pyspark.sql import DataFrame

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

def normalize_text(df: DataFrame, columns, args):
    """
    Args (all optional in args dict):
      - case: one of {'lower','upper','title', None}  (default: None)
      - collapse_spaces: bool (default: True)
      - empty_as_null: bool (default: True)
    """
    case = args.get('case', None)
    collapse_spaces = args.get('collapse_spaces', True)
    empty_as_null = args.get('empty_as_null', True)

    for c in columns:
        expr = trim(col(c))
        if collapse_spaces:
            # Replace 2+ spaces with a single space
            expr = regexp_replace(expr, r"\s{2,}", " ")
        if case == 'lower':
            expr = lower(expr)
        elif case == 'upper':
            expr = upper(expr)
        elif case == 'title':
            expr = initcap(expr)

        if empty_as_null:
            expr = when(length(expr) == 0, lit(None)).otherwise(expr)

        df = df.withColumn(c, expr)
    return df

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

def fill_nulls(df: DataFrame, columns, args):
    """
    Args:
      - defaults: dict[str, any]   -> per-column default values
      - default_string: str or None
      - default_numeric: int/float or None
      - default_date: date string in 'yyyy-MM-dd' or None
    """
    defaults = args.get('defaults', {}) or {}
    default_string = args.get('default_string', None)
    default_numeric = args.get('default_numeric', None)
    default_date = args.get('default_date', None)

    for c in columns:
        if c in defaults:
            df = df.withColumn(c, coalesce(col(c), lit(defaults[c])))
        else:
            dtype = [f.dataType for f in df.schema.fields if f.name == c]
            dtype = dtype[0] if dtype else None
            if dtype is None:
                continue

            if default_string is not None and dtype.simpleString().startswith('string'):
                df = df.withColumn(c, coalesce(col(c), lit(default_string)))
            elif default_numeric is not None and dtype.simpleString() in ('int', 'bigint', 'double', 'float', 'decimal'):
                df = df.withColumn(c, coalesce(col(c), lit(default_numeric)))
            elif default_date is not None and dtype.simpleString() in ('date',):
                df = df.withColumn(c, coalesce(col(c), lit(default_date)))
    return df

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

def parse_datetime(df: DataFrame, columns, args):
    """
    Args:
      - target_type: 'date'|'timestamp' (default: 'date')
      - formats: list[str] of formats, e.g. ['yyyy-MM-dd','dd/MM/yyyy','MM-dd-yyyy']
      - into: str or None  -> if provided and len(columns)==1, write into this column name
      - keep_original: bool (default: True)
    """
    target_type = args.get('target_type', 'date')
    formats = args.get('formats', ['yyyy-MM-dd'])
    into = args.get('into', None)
    keep_original = args.get('keep_original', True)

    for c in columns:
        parsed = None
        for fmt in formats:
            candidate = to_timestamp(col(c), fmt) if target_type == 'timestamp' else to_date(col(c), fmt)
            parsed = candidate if parsed is None else coalesce(parsed, candidate)

        out_col = into if (into and len(columns) == 1) else c
        df = df.withColumn(out_col, parsed)
        if into and not keep_original and out_col != c:
            df = df.drop(c)
    return df
# --- End inlined NB_FMD_DQ_CLEANSING ---

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

if _processing_error is None:
    try:
        dfDataChanged=handle_cleansing_functions(dfDataChanged,cleansing_rules)
    except Exception as _e:
        print(f"WARNING: Cleansing application failed for {TargetName}: {_e}. Continuing without cleansing.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

if _processing_error is None:
    try:
        non_key_columns = [column for column in dfDataChanged.columns if column not in ('HashedPKColumn')]

        #add a hashed cloumn to detect changes

        dfDataChanged = dfDataChanged.withColumn("HashedNonKeyColumns", md5(concat_ws("||", *non_key_columns).cast(StringType())))
    except Exception as _e:
        _processing_error = f"Hash column creation failed for {TargetName}: {_e}"
        print(f"ERROR: {_processing_error}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

if _processing_error is None:
    dfDataChanged = dfDataChanged.withColumn('IsCurrent', lit(True).cast('boolean'))
    dfDataChanged = dfDataChanged.withColumn('RecordStartDate', current_timestamp())
    dfDataChanged = dfDataChanged.withColumn('RecordModifiedDate', current_timestamp())
    dfDataChanged = dfDataChanged.withColumn('RecordEndDate', lit('9999-12-31').cast('timestamp'))
    dfDataChanged = dfDataChanged.withColumn('IsDeleted', lit(False).cast('boolean'))

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Read Original if exists

# CELL ********************

if _processing_error is None:
    try:
        #Check if Target exist, if exists read the original data if not create table and exit
        if DeltaTable.isDeltaTable(spark, target_data_path):
            # Read original/current data
            dfDataOriginal = (spark
                                .read.format("delta")
                                .load(target_data_path)
                                )

        else:
            # Use first load when no data exists yet and then exit
            dfDataChanged.write.format("delta").mode("overwrite").save(target_data_path)
            TotalRuntime = str((datetime.now() - start_audit_time))

            # Your data
            result_data = {
                "Action" : "End", "CopyOutput":{
                    "Total Runtime": TotalRuntime,
                    "TargetSchema": TargetSchema,
                    "TargetName" : TargetName,
                    "EntityId" : SilverLayerEntityId,
                    "StartTime" : start_audit_time,
                    "EndTime" : end_audit_time

                }
                }

            _register_bronze_entity_processed()
            _register_silver_entity_processed()
            try:
                _upsert_entity_status_silver("loaded")
            except Exception as _es_err:
                print(f"  [WARN] EntityStatus update failed: {_es_err}")
            _audit_notebook_end(result_data)

            notebookutils.notebook.exit("OK")
    except Exception as _e:
        _processing_error = f"Delta table read/write failed for {TargetName}: {_e}"
        print(f"ERROR: {_processing_error}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Add columns for Merge SCD 2

# CELL ********************

if _processing_error is None:
    #add a new column MergeKey based on the HashedPKColumn
    dfDataChanged = dfDataChanged.withColumn('HashedPKColumn', dfDataChanged['HashedPKColumn'])
    dfDataChanged = dfDataChanged.withColumn('Action', lit('U'))

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

if _processing_error is None:
    columns_to_insert_deletes = {f"changes.{column}" for column in dfDataOriginal.columns if column not in ('HashedPKColumn', 'Action')}
    columns_original = {f"original.{column}" for column in dfDataOriginal.columns if column not in ('HashedPKColumn', 'Action')}


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Check for changes

# CELL ********************

if _processing_error is None:
    try:
        # Define columns to insert and delete
        columns_to_insert_deletes = {f"changes.{column}" for column in dfDataOriginal.columns if column not in ('HashedPKColumn', 'Action')}

        #### Join DataFrames for deletes
        #
        # Here, we identify all of the records that are:
        #   1. NOT in the incoming changes, but IN the original
        #   2. IN the incoming changes, but DELETED in the original
        #
        # Both require updates.
        #
        # For 1:
        #   This requires the original row to be set to IsDeleted=True
        #
        # For 2:
        #   This requires the original row to be set to IsCurrent=False
        #   These rows are accompanied by inserts, which will be identified seperately (in df_inserts)
        ####
        df_deletes = (
            dfDataOriginal.alias('original')
            .join(
                dfDataChanged.alias('changes'),
                (dfDataChanged.HashedPKColumn == dfDataOriginal.HashedPKColumn) &
                (dfDataOriginal.IsDeleted.cast('boolean') == lit(False).cast('boolean')),
                how='left'
            )
            .where("changes.HashedPKColumn is null")
            .where("original.IsCurrent == true")
            .select(
                "original.HashedPKColumn",
                "original.RecordStartDate",
                "original.HashedNonKeyColumns",
                lit('D').alias('Action'),
                *columns_to_insert_deletes
            )
            .withColumn('RecordEndDate', current_timestamp())
            .drop(col("changes.RecordStartDate"))
            .drop(col("changes.HashedNonKeyColumns"))
            .withColumn('IsCurrent', lit(False))
            .withColumn('IsDeleted', lit(True))
        )

        #### Process updated records (new rows)
        #
        # Here, we identify all of the records that are:
        #   - IN the incoming changes, AND IN the original, but
        #     with different content, i.e. different HashedNonKeyColumns
        #
        # Here, we isolate the rows from the incoming changes (new) because we
        # need to INSERT the new rows.
        #
        ####
        df_updates_new = (
            dfDataOriginal.alias('original')
            .join(
                dfDataChanged.alias('changes'),
                (dfDataChanged.HashedPKColumn == dfDataOriginal.HashedPKColumn) &
                (dfDataOriginal.IsDeleted.cast('boolean') == lit(False).cast('boolean')) &
                (dfDataOriginal.IsCurrent.cast('boolean') == lit(True).cast('boolean')),
                how='inner'
            )
            .where("changes.HashedNonKeyColumns <> original.HashedNonKeyColumns")
            .select(
                "changes.HashedPKColumn",
                lit('I').alias('Action'),
                *columns_to_insert_deletes
            )
            .withColumn('RecordEndDate', lit('9999-12-31').cast('timestamp'))
            .withColumn('IsCurrent', lit(True))
            .withColumn('IsDeleted', lit(False))
        )

        #### Process updated records (old rows)
        #
        # Here, we identify all of the records that are:
        #   - IN the incoming changes, AND IN the original, but
        #     with different content, i.e. different HashedNonKeyColumns
        #
        # Here, we isolate the rows from the original (old) because we
        # need to UPDATE the old rows.
        #
        ####
        df_updates_old = (
            dfDataOriginal.alias('original')
            .join(
                dfDataChanged.alias('changes'),
                (dfDataChanged.HashedPKColumn == dfDataOriginal.HashedPKColumn) &
                (dfDataOriginal.IsDeleted.cast('boolean') == lit(False).cast('boolean')) &
                (dfDataOriginal.IsCurrent.cast('boolean') == lit(True).cast('boolean')),
                how='inner'
            )
            .where("changes.HashedNonKeyColumns <> original.HashedNonKeyColumns")
            .select(
                "changes.HashedPKColumn",
                "changes.RecordStartDate",
                lit('U').alias('Action'),
                *columns_original
            )
            .withColumn('RecordEndDate', expr("changes.RecordStartDate - interval 0.001 seconds"))
            .drop(col("changes.RecordStartDate"))
            .withColumn('IsCurrent', lit(False))
            .withColumn('IsDeleted', lit(False))
        )

        #### Process inserted records
        #
        # Here, we identify all of the records that are:
        #   - IN the incoming changes, and NOT IN the original
        #
        # We need to INSERT these rows.
        #
        ####
        df_inserts = (
            dfDataChanged.alias('changes')
            .join(
                dfDataOriginal.alias('original'),
                (dfDataChanged.HashedPKColumn == dfDataOriginal.HashedPKColumn) &
                (dfDataOriginal.IsDeleted.cast('boolean') == lit(False).cast('boolean')),
                how='left'
            )
            .where("original.HashedPKColumn is null")
            .select(
                "changes.HashedPKColumn",
                lit('I').alias('Action'),
                *columns_to_insert_deletes
            )
            .withColumn('RecordEndDate', lit('9999-12-31').cast('timestamp'))
            .withColumn('IsCurrent', lit(True))
            .withColumn('IsDeleted', lit(False))
        )

        ### Final merged DataFrame
        #
        # Here, we merge all of the changed we plan to do: inserts, updates, and deletes.
        # The operation that is listed under 'Action' identifies what happens:
        #
        # For rows marked as D:
        #     If the current row IS NOT marked as IsDeleted: we set IsDeleted to True.
        #     If the current row IS marked as IsDeleted: we set IsCurrent to False
        #
        # For rows marked as U:
        #     The current row is set to IsCurrent=False
        #
        # For rows marked as I:
        #     The row is inserted with IsCurrent=True
        #
        dfDataChanged = (
            df_deletes
            .unionByName(df_updates_new)
            .unionByName(df_updates_old)
            .unionByName(df_inserts)
        )
    except Exception as _e:
        _processing_error = f"SCD2 change detection failed for {TargetName}: {_e}"
        print(f"ERROR: {_processing_error}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Merge table

# CELL ********************

if _processing_error is None:
    columns_to_insert = {column: f"updates.{column}" for column in dfDataOriginal.columns if column not in ('IsCurrent', 'HashedNonKeyColumns', 'RecordStartDate', 'HashedPKColumn', 'RecordModifiedDate', 'RecordEndDate', 'IsDeleted', 'Action')}

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

if _processing_error is None:
    try:
        deltaTable = DeltaTable.forPath(spark, f'{target_data_path}')

        merge = deltaTable.alias('original') \
            .merge(dfDataChanged.alias('updates'), 'original.HashedPKColumn = updates.HashedPKColumn and original.RecordStartDate = updates.RecordStartDate') \
            .whenMatchedUpdate(
                    #
                    # Handle rows to be (soft-) deleted:
                    # These rows have action 'D' and are NOT deleted in the original
                    #
                    condition="original.IsCurrent == True AND original.IsDeleted == False AND updates.Action = 'D'",
                    set={
                        "IsDeleted": lit(True),
                        "RecordEndDate": col('updates.RecordEndDate')
                    }) \
            .whenMatchedUpdate(
                    #
                    # Handle rows to be updated.
                    # These rows have either action 'D' and ARE deleted in the original (so IsCurrent needs to be set to False)
                    # Or these have action 'U' and, are accompanied by inserts, but IsCurrent must be set to False.
                    #
                condition="updates.HashedNonKeyColumns == original.HashedNonKeyColumns and original.IsCurrent = 1  ",
                set={
                    "IsCurrent": lit(0),
                    "RecordEndDate": col('updates.RecordStartDate')
                }) \
            .whenNotMatchedInsert(
                    #
                    # Handle inserts.
                    # These rows have action 'I' and must be inserted.
                    #
                values={**columns_to_insert,
                        "HashedPKColumn": col("updates.HashedPKColumn"),
                        "HashedNonKeyColumns": col("updates.HashedNonKeyColumns"),
                        "IsCurrent": lit(1),
                        "RecordStartDate": current_timestamp(),
                        "RecordModifiedDate": current_timestamp(),
                        "RecordEndDate": lit('9999-12-31').cast('timestamp'),
                        "IsDeleted": lit(0)})

        # Execute the merge operation
        merge.execute()
    except Exception as _e:
        _processing_error = f"Delta merge execution failed for {TargetName}: {_e}"
        print(f"ERROR: {_processing_error}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Define Results

# CELL ********************

if _processing_error is None:
    TotalRuntime = str((datetime.now() - start_audit_time))
    end_audit_time =  str(datetime.now())
    start_audit_time =str(start_audit_time)
    result_data = {
        "Action" : "End", "CopyOutput":{
            "Total Runtime": TotalRuntime,
            "TargetSchema": TargetSchema,
            "TargetName" : TargetName,
            "EntityId" : SilverLayerEntityId,
            "StartTime" : start_audit_time,
            "EndTime" : end_audit_time
        }
    }


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

if _processing_error is None:
    _register_bronze_entity_processed()
    _register_silver_entity_processed()
    try:
        _upsert_entity_status_silver("loaded")
    except Exception as _es_err:
        print(f"  [WARN] EntityStatus update failed: {_es_err}")
    _audit_notebook_end(result_data)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Notebook exit

# CELL ********************

if _processing_error is not None:
    # ── ERROR PATH: write failure to Delta so dashboard sees it ──
    print(f"SILVER NOTEBOOK FAILED: {_processing_error}")
    try:
        end_audit_time = str(datetime.now())
        if not isinstance(start_audit_time, str):
            start_audit_time = str(start_audit_time)
        error_result = {
            "Action": "End",
            "CopyOutput": {
                "Total Runtime": "N/A (error)",
                "TargetSchema": TargetSchema,
                "TargetName": TargetName,
                "EntityId": SilverLayerEntityId,
                "StartTime": start_audit_time,
                "EndTime": end_audit_time,
                "Error": _processing_error[:500]
            }
        }
        # Write error status so dashboard EntityDigest shows failure
        try:
            _upsert_entity_status_silver("not_started", error_msg=_processing_error)
        except Exception as _es_err:
            print(f"  [WARN] EntityStatus error update failed: {_es_err}")
        _audit_notebook_end(error_result)
    except Exception as _exit_err:
        print(f"  [WARN] Error-path Delta writes failed: {_exit_err}")
    notebookutils.notebook.exit(f"ERROR: {_processing_error[:200]}")
else:
    notebookutils.notebook.exit("OK")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
