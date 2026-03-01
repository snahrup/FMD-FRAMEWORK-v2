# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse_name": "",
# META       "default_lakehouse_workspace_id": "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a",
# META       "known_lakehouses": []
# META     },
# META     "environment": {}
# META   }
# META }

# MARKDOWN ********************

# # FMD Processing Landing Zone Main Notebook
# 
# ## Overview
# This notebook orchestrates the execution of custom notebooks for landing zone data processing in the FMD framework. It serves as a wrapper that prepares execution parameters and invokes custom data extraction notebooks to load data from external sources into the Landing Zone.
# 
# ## Key Features
# - **Custom Notebook Execution**: Invokes user-defined custom notebooks for data extraction
# - **Parameter Management**: Prepares and passes all required parameters to child notebooks
# - **Error Handling**: Captures and handles notebook execution failures with detailed error reporting
# - **Audit Integration**: Tracks execution with pipeline run GUIDs and trigger information
# - **Flexible Configuration**: Supports customizable notebook names and last load values for incremental loads
# 
# ## Process Flow
# 1. Initialize parameters (entity, target paths, custom notebook name)
# 2. Format and validate GUIDs for pipeline and trigger tracking
# 3. Prepare notebook parameters including audit metadata
# 4. Execute the specified custom notebook with timeout (900 seconds)
# 5. Handle execution results and errors
# 6. Return execution results to calling pipeline
# 
# ## Parameters


# CELL ********************

import uuid
import requests
import struct
import pyodbc

from datetime import datetime, timezone
from json import loads, dumps
from py4j.protocol import Py4JJavaError


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# PARAMETERS CELL ********************

###############################Target Parameters###############################
EntityId = ''
EntityLayer = "LandingZone"
DataSourceName = "NB"
TargetFilePath = ""
TargetFileName = ""
TargetLakehouseGuid = ""
WorkspaceGuid = ""
LastLoadValue = None
CustomNotebookName = "NB_FMD_CUSTOM_NOTEBOOK_TEMPLATE"
TriggerGuid = ""
TriggerTime = ""
TriggerType = ""

###############################Logging Parameters###############################
driver = '{ODBC Driver 18 for SQL Server}'

result_data=''

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

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

## always use notebook guid instead of pipeline id
PipelineName = notebookutils.runtime.context.get('currentNotebookName')
PipelineGuid = str(notebookutils.runtime.context.get('currentNotebookId'))
PipelineParentRunGuid = notebookutils.runtime.context.get('PipelineParentRunGuid')
PipelineRunGuid = str(uuid.uuid4())
TriggerGuid = format_guid(TriggerGuid)
NotebookExecutionId = str(uuid.uuid4())

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

# Load connection config for EntityStatus updates
_config_settings = notebookutils.variableLibrary.getLibrary("VAR_CONFIG_FMD")
_lz_connstring = _config_settings.fmd_fabric_db_connection
_lz_database = _config_settings.fmd_fabric_db_name

def update_entity_status(entity_id, layer, status, error_msg=None):
    """Update EntityStatusSummary via sp_UpsertEntityStatus after each entity load."""
    try:
        _token = notebookutils.credentials.getToken(
            'https://analysis.windows.net/powerbi/api'
        ).encode("UTF-16-LE")
        _token_struct = struct.pack(f'<I{len(_token)}s', len(_token), _token)

        conn = pyodbc.connect(
            f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={_lz_connstring};PORT=1433;DATABASE={_lz_database};",
            attrs_before={1256: _token_struct},
            timeout=60
        )
        err_param = ""
        if error_msg:
            safe_msg = str(error_msg)[:500].replace("'", "''")
            err_param = f", @ErrorMessage = '{safe_msg}'"
        sql = (
            f"EXEC [execution].[sp_UpsertEntityStatus] "
            f"@LandingzoneEntityId = {entity_id}, "
            f"@Layer = '{layer}', "
            f"@Status = '{status}'"
            f"{err_param}"
        )
        with conn.cursor() as cur:
            cur.execute(sql)
            conn.commit()
        conn.close()
    except Exception as e:
        print(f"  [WARN] EntityStatus update failed for {entity_id}: {e}")

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

# MARKDOWN ********************

# ## Define Notebooks settings

# CELL ********************

notebook_params = {}
notebook_params["PipelineGuid"] = PipelineGuid
notebook_params["PipelineName"] = PipelineName
notebook_params["TriggerGuid"] = TriggerGuid
notebook_params["TriggerType"] = TriggerType
notebook_params["TriggerTime"] = TriggerTime
notebook_params["WorkspaceGuid"] = WorkspaceGuid  
notebook_params["PipelineParentRunGuid"] = PipelineParentRunGuid
notebook_params["PipelineRunGuid"] = PipelineRunGuid
notebook_params["NotebookExecutionId"] = NotebookExecutionId
notebook_params["driver"] = driver
notebook_params["EntityId"] = EntityId 
notebook_params["EntityLayer"] = EntityLayer 
notebook_params["DataSourceName"] = DataSourceName 
notebook_params["TargetFilePath"] = TargetFilePath 
notebook_params["TargetFileName"] = TargetFileName 
notebook_params["TargetLakehouseGuid"] = TargetLakehouseGuid 
notebook_params["WorkspaceGuid"] = WorkspaceGuid 
notebook_params["LastLoadValue"] = LastLoadValue 

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# MARKDOWN ********************

# ## Execute Notebook

# CELL ********************

result = None
fail = None
try:
    result = notebookutils.notebook.run(CustomNotebookName, 900, notebook_params)
    # Update EntityStatus on successful load
    update_entity_status(EntityId, "landingzone", "loaded")
except Py4JJavaError as e:
    # Inspect the Java exception message
    if "NotebookExecutionException" in str(e):
        fail = e
        update_entity_status(EntityId, "landingzone", "not_started", str(e))
except Exception as e:
    update_entity_status(EntityId, "landingzone", "not_started", str(e))
    print(notebook_params)
    raise(e)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

result

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

if fail:
    raise ValueError(F"""Notebook: {CustomNotebookName} failed with error: {e}""")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

TotalRuntime = str((datetime.now() - starttime))
notebookutils.notebook.exit(result)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
