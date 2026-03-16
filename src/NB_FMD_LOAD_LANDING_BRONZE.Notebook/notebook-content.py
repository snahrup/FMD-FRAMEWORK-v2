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
# META           "id": "3b9a7e79-1615-4ec2-9e93-0bdebe985d5a"
# META         }
# META       ]
# META     },
# META     "environment": {}
# META   }
# META }

# MARKDOWN ********************

# # FMD Load Landing Zone to Bronze Notebook
# 
# ## Overview
# This notebook handles the data loading process from the Landing Zone to the Bronze layer in the FMD framework. It processes source files, applies data quality checks, performs cleansing, and loads data into Bronze Delta tables.
# 
# ## Key Features
# - **Source File Validation**: Checks if source files exist before processing
# - **Data Quality Checks**: Validates primary keys and detects duplicates
# - **Cleansing Rules**: Applies configurable cleansing rules from the framework database
# - **Change Detection**: Uses hash columns to detect changes in data
# - **Incremental Loading**: Supports both full and incremental load patterns
# - **Audit Logging**: Tracks execution details in the framework database
# - **Delta Lake Integration**: Writes data to Delta tables with optimization settings
# 
# ## Process Flow
# 1. Load libraries and configuration settings
# 2. Set up audit logging and database connections
# 3. Read source file from Landing Zone (Parquet/CSV)
# 4. Perform data quality checks (PK validation, duplicate detection)
# 5. Apply cleansing rules from framework configuration
# 6. Add hash columns for change tracking
# 7. Execute incremental or full load to Bronze Delta table
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

# Pipeline context parameters — normally injected by ForEach activity.
# Default to valid GUID values for direct RunNotebook API invocation.
NotebookExecutionId = "00000000-0000-0000-0000-000000000000"
PipelineRunGuid = "00000000-0000-0000-0000-000000000000"
PipelineParentRunGuid = "00000000-0000-0000-0000-000000000000"
TriggerType = "API"
TriggerGuid = "00000000-0000-0000-0000-000000000000"

# # CSV
CompressionType = 'infer'
ColumnDelimiter = ','
RowDelimiter = '\n'
EscapeCharacter = '"'
Encoding = 'UTF-8'
first_row_is_header = True
infer_schema = True
key_vault =default_settings.key_vault_uri_name
cleansing_rules = []

###############################Logging Parameters###############################
driver = '{ODBC Driver 18 for SQL Server}'
connstring=config_settings.fmd_fabric_db_connection
database=config_settings.fmd_fabric_db_name
schema_enabled =default_settings.lakehouse_schema_enabled
EntityLayer='Bronze'
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
from pyspark.sql.functions import sha2, concat_ws, md5, StringType,current_timestamp

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

# ## Define Audit Helpers and Logging Setup

# CELL ********************

# Ensure TriggerTime is formatted correctly
TriggerTime = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
notebook_name=  notebookutils.runtime.context['currentNotebookName']

# GetCleansingRule still uses pyodbc (read from Fabric SQL metadata DB)
GetCleansingRule = (
    f"[execution].[sp_GetBronzeCleansingRule] "
    f"@BronzeLayerEntityId = \"{BronzeLayerEntityId}\""
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


def _register_lz_entity_processed():
    """Mark LZ file as processed in pipeline_lz_entity Delta table (replaces sp_UpsertPipelineLandingzoneEntity)."""
    _write_audit_to_delta("pipeline_lz_entity", {
        "LandingzoneEntityId": int(LandingzoneEntityId) if LandingzoneEntityId else None,
        "FileName": SourceFileName,
        "FilePath": SourceFilePath,
        "IsProcessed": 1,
        "InsertDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


def _register_bronze_entity(is_processed=False):
    """Write to pipeline_bronze_entity Delta table (replaces sp_UpsertPipelineBronzeLayerEntity)."""
    _write_audit_to_delta("pipeline_bronze_entity", {
        "BronzeLayerEntityId": int(BronzeLayerEntityId) if BronzeLayerEntityId else None,
        "TableName": TargetName,
        "SchemaName": TargetSchema,
        "IsProcessed": 1 if is_processed else 0,
        "InsertDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


def _upsert_entity_status(status, error_msg=None):
    """Write to entity_status Delta table (replaces sp_UpsertEntityStatus)."""
    _write_audit_to_delta("entity_status", {
        "LandingzoneEntityId": int(LandingzoneEntityId) if LandingzoneEntityId else None,
        "Layer": "bronze",
        "Status": status,
        "ErrorMessage": str(error_msg)[:500] if error_msg else None,
        "UpdatedBy": "notebook-bronze",
        "LoadEndDateTime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Set Configuration

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

# CELL ********************

#Make sure you have disabled V-Order, Bronze we want to load fast

spark.conf.set("sprk.sql.parquet.vorder.enabled", "false")

spark.conf.set("spark.sql.parquet.int96RebaseModeInRead", "CORRECTED")
spark.conf.set("spark.sql.parquet.int96RebaseModeInWrite", "CORRECTED")
spark.conf.set("spark.sql.parquet.datetimeRebaseModeInRead", "CORRECTED")
spark.conf.set("spark.sql.parquet.datetimeRebaseModeInWrite", "CORRECTED")

spark.conf.set('spark.microsoft.delta.optimize.fast.enabled', True)
spark.conf.set('spark.microsoft.delta.optimize.fileLevelTarget.enabled', True)
spark.conf.set('spark.databricks.delta.autoCompact.enabled', True)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Set your loading paths

# CELL ********************

# Path format: {Namespace}/{Table} — see ARCHITECTURE.md and config.json "paths" section
source_changes_data_path = f"abfss://{SourceWorkspace}@onelake.dfs.fabric.microsoft.com/{SourceLakehouse}/Files/{SourceFilePath}/{SourceFileName}"
target_data_path = f"abfss://{TargetWorkspace}@onelake.dfs.fabric.microsoft.com/{TargetLakehouse}/Tables/{DataSourceNamespace}/{TargetName}"


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Load new from Data Landingzone

# CELL ********************

if _processing_error is None:
    # Check file existence using Spark (more robust than notebookutils.fs.exists for cross-workspace access)
    _file_exists = False
    try:
        _file_exists = notebookutils.fs.exists(source_changes_data_path)
    except Exception as _e:
        print(f"notebookutils.fs.exists failed: {_e}")
        _file_exists = False

    # Fallback: try reading with Spark directly if notebookutils says file doesn't exist
    if not _file_exists:
        try:
            _test_df = spark.read.format(SourceFileType).option("header","true").load(source_changes_data_path)
            _test_count = _test_df.limit(1).count()
            if _test_count > 0:
                _file_exists = True
                print(f"File found via Spark (notebookutils.fs.exists returned False): {source_changes_data_path}")
        except Exception as _e2:
            print(f"Spark read also failed: {_e2}")
            _file_exists = False

    if not _file_exists:
        print(f"FILE NOT FOUND: {source_changes_data_path}")
        _register_lz_entity_processed()
        TotalRuntime = str((datetime.now() - start_audit_time))
        end_audit_time =  str(datetime.now())
        start_audit_time =str(start_audit_time)
        result_data = {
        "Action" : "End", "CopyOutput":{
            "Total Runtime": TotalRuntime,
            "TargetSchema": TargetSchema,
            "TargetName" : TargetName,
            "SourceFilePath" : SourceFilePath,
            "SourceFileName" : 'FILE NOT FOUND',
            "LandingzoneEntityId" : LandingzoneEntityId,
            "EntityId" : BronzeLayerEntityId,
            "StartTime" : start_audit_time,
            "EndTime" : end_audit_time

        }
        }
        _audit_notebook_end(result_data)

        notebookutils.notebook.exit("FILE_NOT_FOUND")

    # Read all incoming changes in Parquet format
    try:
        dfDataChanged= spark.read\
                        .format(SourceFileType) \
                        .option("header","true") \
                        .load(f"{source_changes_data_path}")
    except Exception as _e:
        _processing_error = f"Spark read failed for {SourceFileName}: {_e}"
        print(f"ERROR: {_processing_error}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

if _processing_error is None:
    # Replace spaces with underscores in column names
    new_columns = [col.replace(' ', '') for col in dfDataChanged.columns]
    # Rename the columns
    dfDataChanged = dfDataChanged.toDF(*new_columns)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## DQ Checks

# CELL ********************

if _processing_error is None:
    try:
        #split PKcolumns string on , ; or :
        PrimaryKeys = str(PrimaryKeys)

        PrimaryKeys = re.split('[, ; :]', PrimaryKeys)
        #remove potential whitespaces around Pk columns
        PrimaryKeys = [column.strip() for column in PrimaryKeys if column != ""]

        # Handle "N/A" or empty PKs — fall back to using ALL columns as composite key
        if not PrimaryKeys or PrimaryKeys == ["N/A"] or PrimaryKeys == ["n/a"] or PrimaryKeys == [""]:
            print(f"WARNING: PrimaryKeys is '{PrimaryKeys}' — using all columns as composite key for {TargetName}")
            key_columns = list(dfDataChanged.columns)
        else:
            key_columns = PrimaryKeys
            # Check if all PK's exist in source
            for pk_column in key_columns:
                if pk_column not in dfDataChanged.columns:
                    # Log warning but don't crash — remove missing PKs
                    print(f"WARNING: PK column '{pk_column}' not found in source for {TargetName}. Available: {dfDataChanged.columns[:10]}...")
                    key_columns = [k for k in key_columns if k in dfDataChanged.columns]

            # If no valid PK columns remain, fall back to all columns
            if not key_columns:
                print(f"WARNING: No valid PK columns found for {TargetName} — using all columns as composite key")
                key_columns = list(dfDataChanged.columns)

        read_key_columns = [column for column in dfDataChanged.columns if column in key_columns]

        # Add a column with the calculated hash, easier in later stage of with multiple PK
        dfDataChanged = (dfDataChanged
                        .withColumn("HashedPKColumn", sha2(concat_ws("||", *read_key_columns), 256)))
    except Exception as _e:
        _processing_error = f"PK validation failed for {TargetName}: {_e}"
        print(f"ERROR: {_processing_error}")


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Check for Duplicates

# CELL ********************

if _processing_error is None:
    try:
        if dfDataChanged.select('HashedPKColumn').distinct().count() != dfDataChanged.select('HashedPKColumn').count():
            print(f'WARNING: Source file contains duplicated rows for PK: {", ".join(key_columns)} in {TargetName}. Deduplicating...')
            dfDataChanged = dfDataChanged.dropDuplicates(['HashedPKColumn'])
    except Exception as _e:
        _processing_error = f"Duplicate check failed for {TargetName}: {_e}"
        print(f"ERROR: {_processing_error}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Perform Cleansing

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
        cleansing_rules = []

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

# MARKDOWN ********************

# ## Add Hash

# CELL ********************

if _processing_error is None:
    try:
        non_key_columns = [column for column in dfDataChanged.columns if column not in key_columns]

        #add a hashed cloumn to detect changes
        dfDataChanged = dfDataChanged.withColumn("HashedNonKeyColumns", md5(concat_ws("||", *non_key_columns).cast(StringType())))

        #Add RecordLoadDate to see when the record arrived
        dfDataChanged = dfDataChanged.withColumn('RecordLoadDate', current_timestamp())
    except Exception as _e:
        _processing_error = f"Hash column creation failed for {TargetName}: {_e}"
        print(f"ERROR: {_processing_error}")


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
            TotalRuntime = str((datetime.now() - start_audit_time))
            end_audit_time =  str(datetime.now())
            start_audit_time =str(start_audit_time)
            # Your data
            result_data = {
                "Action" : "End", "CopyOutput":{
                    "Total Runtime": TotalRuntime,
                    "TargetSchema": TargetSchema,
                    "TargetName" : TargetName,
                    "SourceFilePath" : SourceFilePath,
                    "SourceFileName" : SourceFileName,
                    "LandingzoneEntityId" : LandingzoneEntityId,
                    "EntityId" : BronzeLayerEntityId,
                    "StartTime" : start_audit_time,
                    "EndTime" : end_audit_time

                }
                }

            _register_lz_entity_processed()
            _register_bronze_entity(is_processed=True)
            try:
                _upsert_entity_status("loaded")
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

# ## Merge table

# CELL ********************

if _processing_error is None:
    try:
        #merge table
        deltaTable = DeltaTable.forPath(spark, f'{target_data_path}')
        if IsIncremental in [False, 'false', 'False']:
            merge = deltaTable.alias('original') \
                .merge(dfDataChanged.alias('updates'), 'original.HashedPKColumn == updates.HashedPKColumn') \
                .whenNotMatchedInsertAll() \
                .whenMatchedUpdateAll('original.HashedNonKeyColumns != updates.HashedNonKeyColumns') \
                .whenNotMatchedBySourceDelete() \
                .execute()
        elif IsIncremental not in [False, 'false', 'False']:
            merge = deltaTable.alias('original') \
                .merge(dfDataChanged.alias('updates'), 'original.HashedPKColumn == updates.HashedPKColumn') \
                .whenNotMatchedInsertAll() \
                .whenMatchedUpdateAll('original.HashedNonKeyColumns != updates.HashedNonKeyColumns') \
                .execute()
    except Exception as _e:
        _processing_error = f"Delta merge failed for {TargetName}: {_e}"
        print(f"ERROR: {_processing_error}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Define Results

# CELL ********************

TotalRuntime = str((datetime.now() - start_audit_time))
end_audit_time =  str(datetime.now())
start_audit_time =str(start_audit_time)

if _processing_error is not None:
    # Error path — log the error and exit with ERROR status
    result_data = {
        "Action" : "End", "CopyOutput":{
            "Total Runtime": TotalRuntime,
            "TargetSchema": TargetSchema,
            "TargetName" : TargetName,
            "SourceFilePath" : SourceFilePath,
            "SourceFileName" : SourceFileName,
            "LandingzoneEntityId" : LandingzoneEntityId,
            "EntityId" : BronzeLayerEntityId,
            "StartTime" : start_audit_time,
            "EndTime" : end_audit_time,
            "Error" : str(_processing_error)[:500]
        }
    }
    print(f"ENTITY FAILED: {TargetName} — {_processing_error}")
else:
    # Success path
    result_data = {
        "Action" : "End", "CopyOutput":{
            "Total Runtime": TotalRuntime,
            "TargetSchema": TargetSchema,
            "TargetName" : TargetName,
            "SourceFilePath" : SourceFilePath,
            "SourceFileName" : SourceFileName,
            "LandingzoneEntityId" : LandingzoneEntityId,
            "EntityId" : BronzeLayerEntityId,
            "StartTime" : start_audit_time,
            "EndTime" : end_audit_time
        }
    }


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Logging and update queue

# CELL ********************

try:
    _register_lz_entity_processed()
    _register_bronze_entity(is_processed=True)
    # Update EntityStatus based on processing result
    if _processing_error is not None:
        try:
            _upsert_entity_status("not_started", error_msg=_processing_error)
        except Exception as _es_err:
            print(f"  [WARN] EntityStatus error update failed: {_es_err}")
    else:
        try:
            _upsert_entity_status("loaded")
        except Exception as _es_err:
            print(f"  [WARN] EntityStatus update failed: {_es_err}")
    _audit_notebook_end(result_data)
except Exception as _log_err:
    print(f"WARNING: Final logging failed for {TargetName}: {_log_err}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Notebook exit

# CELL ********************

if _processing_error is not None:
    notebookutils.notebook.exit(f"ERROR: {str(_processing_error)[:200]}")
else:
    notebookutils.notebook.exit("OK")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
