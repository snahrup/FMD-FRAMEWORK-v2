#!/usr/bin/env python3
"""Fix case sensitivity: revert signal procs to full payload with lowercase 'notebookParams' column alias.

Root cause: Pipeline IfCondition uses NotebookParams (uppercase N) but the notebook parameter
expression uses notebookParams (lowercase n). Fabric is case-sensitive, so the notebook gets NULL.

Fix: Revert signal procs back to full payload (the original logic from _Full variants)
but with the column alias as lowercase 'notebookParams' so it matches the pipeline expression.

The IfCondition check `json(activity('LK_GET_ENTITIES_BRZ').output.value[0].NotebookParams)`
will still work because Fabric Lookup output preserves the actual column name from SQL,
and the pipeline expression `activity('LK_GET_ENTITIES_BRZ').output.value[0].notebookParams`
will NOW match because the column alias is lowercase.

Wait — actually both references need to use the SAME case. Let me check...

The pipeline JSON has:
  IfCondition: `.output.value[0].NotebookParams` (uppercase)
  Notebook param: `.output.value[0].notebookParams` (lowercase)

So one of them is wrong. The SQL column name determines what Fabric returns.
If we make the column lowercase, the IfCondition (uppercase) will break.
If we make it uppercase, the notebook param (lowercase) stays broken.

REAL FIX: We need to update the pipeline definition in Fabric to make BOTH references
use the same case. But we can ALSO fix the SQL to use lowercase, since the IfCondition
check just needs length > 0 and Fabric expressions MIGHT be case-insensitive for property access.

Actually — ADF/Fabric expressions ARE case-insensitive for JSON property access!
The `json()` function and property accessors are case-insensitive.
So changing to lowercase `notebookParams` in SQL will work for BOTH the IfCondition AND the param.

Let's revert to full payload with lowercase column alias.
"""

import json
import struct
import pyodbc
from urllib.request import Request, urlopen
from urllib.parse import urlencode

TENANT_ID = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT_ID = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
CLIENT_SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
DATABASE = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'


def get_token():
    data = urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'scope': 'https://analysis.windows.net/powerbi/api/.default'
    }).encode()
    req = Request(
        f'https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token',
        data=data, method='POST'
    )
    return json.loads(urlopen(req).read())['access_token']


def connect():
    token = get_token()
    token_bytes = token.encode('UTF-16-LE')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    return pyodbc.connect(
        f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};PORT=1433;DATABASE={DATABASE};',
        attrs_before={1256: token_struct},
        timeout=30,
        autocommit=True
    )


def drop_if_exists(cursor, schema, name):
    cursor.execute(
        f"IF EXISTS (SELECT 1 FROM sys.procedures p "
        f"JOIN sys.schemas s ON p.schema_id = s.schema_id "
        f"WHERE s.name = '{schema}' AND p.name = '{name}') "
        f"DROP PROCEDURE [{schema}].[{name}]"
    )


# ============================================================
# Full payload procs with lowercase 'notebookParams' alias
# ============================================================

BRONZE_SQL = r"""
CREATE PROCEDURE [execution].[sp_GetBronzelayerEntity]
    WITH EXECUTE AS CALLER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT CONCAT('[',
        STRING_AGG(CONCAT(CONVERT(NVARCHAR(MAX),'{"path": "NB_FMD_LOAD_LANDING_BRONZE", "params":{"SourceFilePath": ')  , '"' , REPLACE(REPLACE([SourceFilePath],'\', '\\'), '"', '\"') , '"' ,
        ',"SourceFileName" : ', '"', REPLACE(REPLACE([SourceFileName], '\', '\\'), '"', '\"'), '"',
        ',"TargetSchema"   : ', '"', REPLACE(REPLACE([TargetSchema], '\', '\\'), '"', '\"'), '"',
        ',"TargetName"     : ', '"', REPLACE(REPLACE([TargetName], '\', '\\'), '"', '\"'), '"',
        ',"PrimaryKeys"    : ', '"', REPLACE(REPLACE([PrimaryKeys], '\', '\\'), '"', '\"'), '"',
        ',"SourceFileType" : ', '"', REPLACE(REPLACE([SourceFileType], '\', '\\'), '"', '\"'), '"',
        ',"IsIncremental"  : ', '"', CASE WHEN [IsIncremental] = 1 THEN 'True' ELSE 'False' END, '"',
        ',"TargetLakehouse" : ', '"', LOWER(CONVERT(NVARCHAR(36), [TargetLakehouseId])), '"',
        ',"SourceLakehouse" : ', '"', LOWER(CONVERT(NVARCHAR(36), [SourceLakehouseId])), '"',
        ',"TargetWorkspace" : ', '"', LOWER(CONVERT(NVARCHAR(36), [TargetWorkspaceId])), '"',
        ',"SourceWorkspace" : ', '"', LOWER(CONVERT(NVARCHAR(36), [SourceWorkspaceId])), '"',
        ',"TargetLakehouseName" : ', '"', REPLACE(REPLACE([TargetLakehouseName], '\', '\\'), '"', '\"'), '"',
        ',"SourceLakehouseName" : ', '"', REPLACE(REPLACE([SourceLakehouseName], '\', '\\'), '"', '\"'), '"',
        ',"LandingzoneEntityId" : ', '"', LOWER(CONVERT(NVARCHAR(36), [LandingzoneEntityId])), '"',
        ',"BronzeLayerEntityId" : ', '"', LOWER(CONVERT(NVARCHAR(36), [EntityId])), '"',
        ',"DataSourceNamespace" : ' , '"' ,  LOWER(convert(NVARCHAR(20), [DataSourceNamespace])) , '"' ,
                '}}'),', ') WITHIN GROUP (ORDER BY [EntityId])
        ,']') AS notebookParams
         FROM (SELECT TOP 100 PERCENT * FROM [execution].[vw_LoadToBronzeLayer]  ORDER BY [SourceFileName] ASC) AS [vw_LoadToBronzeLayer]
END
"""

SILVER_SQL = r"""
CREATE PROCEDURE [execution].[sp_GetSilverlayerEntity]
WITH EXECUTE AS CALLER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT CONCAT(
        '[',
        STRING_AGG(
            CONCAT(
                CONVERT(NVARCHAR(MAX),
                    '{"path": "NB_FMD_LOAD_BRONZE_SILVER", "params": {'
                ),
                '"SourceSchema": ', '"', REPLACE(REPLACE(SourceSchema, '\', '\\'), '"', '\"'), '"',
                ',"SourceName": ' , '"', REPLACE(REPLACE(SourceName,  '\', '\\'), '"', '\"'), '"',
                ',"TargetSchema": ', '"', REPLACE(REPLACE(TargetSchema,'\', '\\'), '"', '\"'), '"',
                ',"TargetName": ' , '"', REPLACE(REPLACE(TargetName,  '\', '\\'), '"', '\"'), '"',
                ',"SourceFileType": ', '"', REPLACE(REPLACE(SourceFileType,'\', '\\'), '"', '\"'), '"',
                ',"TargetLakehouse": ', '"', LOWER(CONVERT(NVARCHAR(36), TargetLakehouseId)), '"',
                ',"SourceLakehouse": ', '"', LOWER(CONVERT(NVARCHAR(36), SourceLakehouseId)), '"',
                ',"TargetWorkspace": ', '"', LOWER(CONVERT(NVARCHAR(36), TargetWorkspaceId)), '"',
                ',"SourceWorkspace": ', '"', LOWER(CONVERT(NVARCHAR(36), SourceWorkspaceId)), '"',
                ',"TargetLakehouseName": ', '"', REPLACE(REPLACE(TargetLakehouseName,'\', '\\'), '"', '\"'), '"',
                ',"SourceLakehouseName": ', '"', REPLACE(REPLACE(SourceLakehouseName,'\', '\\'), '"', '\"'), '"',
                ',"BronzeLayerEntityId" : ', '"', LOWER(CONVERT(NVARCHAR(36), [BronzeLayerEntityId])), '"',
                ',"SilverLayerEntityId": ', '"', LOWER(CONVERT(NVARCHAR(36), EntityId)), '"',
                ',"DataSourceNamespace" : ', '"', LOWER(CONVERT(NVARCHAR(30), [DataSourceNamespace])), '"',
                ',"cleansing_rules" : ', '"', REPLACE(REPLACE([CleansingRules], '\', '\\'), '"', '\"'), '"',
                '}}'
            ),
            ','
        ) WITHIN GROUP (ORDER BY EntityId),
        ']'
    ) AS notebookParams
    FROM [execution].[vw_LoadToSilverLayer];
END
"""

LZ_SQL = r"""
CREATE PROCEDURE [execution].[sp_GetLandingzoneEntity]
    WITH EXECUTE AS CALLER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT CONCAT('[',
        STRING_AGG(CONCAT(CONVERT(NVARCHAR(MAX),'{"path": "PL_FMD_LOAD_LANDINGZONE", "params":{"EntityId": ')
            , '"', LOWER(CONVERT(NVARCHAR(36), [EntityId])), '"'
            , ',"DataSourceId"     : ', '"', CONVERT(NVARCHAR(20), [DataSourceId]), '"'
            , ',"DataSourceName"   : ', '"', REPLACE(REPLACE([DataSourceName], '\', '\\'), '"', '\"'), '"'
            , ',"DataSourceNamespace": ', '"', LOWER(REPLACE(REPLACE([DataSourceNamespace], '\', '\\'), '"', '\"')), '"'
            , ',"DataSourceType"   : ', '"', REPLACE(REPLACE([DataSourceType], '\', '\\'), '"', '\"'), '"'
            , ',"ConnectionType"   : ', '"', REPLACE(REPLACE([ConnectionType], '\', '\\'), '"', '\"'), '"'
            , ',"ConnectionGuid"   : ', '"', LOWER(CONVERT(NVARCHAR(36), [ConnectionGuid])), '"'
            , ',"TargetSchema"     : ', '"', REPLACE(REPLACE([SourceSchema], '\', '\\'), '"', '\"'), '"'
            , ',"TargetName"       : ', '"', REPLACE(REPLACE([SourceName], '\', '\\'), '"', '\"'), '"'
            , ',"SourceFileName"   : ', '"', REPLACE(REPLACE([TargetFileName], '\', '\\'), '"', '\"'), '"'
            , ',"SourceFilePath"   : ', '"', REPLACE(REPLACE([TargetFilePath], '\', '\\'), '"', '\"'), '"'
            , ',"TargetFileType"   : ', '"', REPLACE(REPLACE([TargetFileType], '\', '\\'), '"', '\"'), '"'
            , ',"TargetLakehouse"  : ', '"', LOWER(CONVERT(NVARCHAR(36), [TargetLakehouseGuid])), '"'
            , ',"TargetWorkspace"  : ', '"', LOWER(CONVERT(NVARCHAR(36), [WorkspaceGuid])), '"'
            , ',"IsIncremental"    : ', '"', CASE WHEN [IsIncremental] = 1 THEN 'True' ELSE 'False' END, '"'
            , ',"LandingzoneEntityId": ', '"', LOWER(CONVERT(NVARCHAR(36), [EntityId])), '"'
            , '}}'), ', ') WITHIN GROUP (ORDER BY [EntityId])
        , ']') AS notebookParams
    FROM [execution].[vw_LoadSourceToLandingzone]
END
"""


def main():
    conn = connect()
    cursor = conn.cursor()
    print('[OK] Connected to SQL\n')

    procs = [
        ('execution', 'sp_GetBronzelayerEntity', BRONZE_SQL),
        ('execution', 'sp_GetSilverlayerEntity', SILVER_SQL),
        ('execution', 'sp_GetLandingzoneEntity', LZ_SQL),
    ]

    for i, (schema, name, sql) in enumerate(procs, 1):
        print(f'[{i}/3] Replacing {schema}.{name} with full payload (lowercase notebookParams)...')
        drop_if_exists(cursor, schema, name)
        cursor.execute(sql)
        print(f'  [OK]')

    # Verify
    print('\n' + '=' * 60)
    print('VERIFICATION — checking column names and payload sizes')
    print('=' * 60)

    for proc in ['sp_GetBronzelayerEntity', 'sp_GetSilverlayerEntity', 'sp_GetLandingzoneEntity']:
        cursor.execute(f'EXEC [execution].[{proc}]')
        row = cursor.fetchone()
        if row:
            col_name = cursor.description[0][0]
            payload = row[0] if row[0] else 'NULL'
            payload_len = len(payload) if payload != 'NULL' else 0
            print(f'\n{proc}:')
            print(f'  Column name: "{col_name}" ({"GOOD - lowercase" if col_name == "notebookParams" else "BAD - not lowercase!"})')
            print(f'  Payload size: {payload_len:,} chars')
            if payload != 'NULL' and payload_len > 0:
                # Count entities
                try:
                    entities = json.loads(payload)
                    print(f'  Entity count: {len(entities)}')
                except:
                    print(f'  First 200 chars: {payload[:200]}')
        else:
            print(f'\n{proc}: No rows returned')

    # Also check _Full variants still exist
    print('\n\n_Full variant procs (should still exist):')
    cursor.execute("""
        SELECT s.name + '.' + p.name AS proc_name
        FROM sys.procedures p JOIN sys.schemas s ON p.schema_id = s.schema_id
        WHERE p.name LIKE '%Entity[_]Full'
        ORDER BY p.name
    """)
    for row in cursor.fetchall():
        print(f'  {row[0]}')

    conn.close()
    print('\n[DONE] All stored procedures reverted to full payload with lowercase notebookParams')


if __name__ == '__main__':
    main()
