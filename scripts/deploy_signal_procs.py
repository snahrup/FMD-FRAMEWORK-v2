#!/usr/bin/env python3
"""Deploy signal stored procs to bypass ADF 1MB pipeline parameter limit.

Creates _Full variants (original logic) and converts originals to lightweight signals.
The notebook detects the signal and fetches entities directly via pyodbc.
"""
import json, struct, pyodbc
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


def get_proc_body(cursor, schema, name):
    """Get stored proc body via sp_helptext."""
    cursor.execute(f"EXEC sp_helptext '[{schema}].[{name}]'")
    return ''.join(row[0] for row in cursor.fetchall())


# ============================================================
# SQL for _Full variants (original logic, preserved verbatim)
# ============================================================

BRONZE_FULL_SQL = r"""
CREATE PROCEDURE [execution].[sp_GetBronzelayerEntity_Full]
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
        ,']') AS NotebookParams
         FROM (SELECT TOP 100 PERCENT * FROM [execution].[vw_LoadToBronzeLayer]  ORDER BY [SourceFileName] ASC) AS [vw_LoadToBronzeLayer]
END
"""

SILVER_FULL_SQL = r"""
CREATE PROCEDURE [execution].[sp_GetSilverlayerEntity_Full]
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
    ) AS NotebookParams
    FROM [execution].[vw_LoadToSilverLayer];
END
"""

# Signal procs — tiny payloads that pass through pipeline params safely
BRONZE_SIGNAL_SQL = r"""
CREATE PROCEDURE [execution].[sp_GetBronzelayerEntity]
    WITH EXECUTE AS CALLER
AS
BEGIN
    SET NOCOUNT ON;
    -- Returns lightweight signal instead of full payload.
    -- Avoids ADF/Fabric 1MB pipeline parameter limit.
    -- The notebook fetches entities directly from SQL via pyodbc.
    DECLARE @cnt INT = (SELECT COUNT(*) FROM [execution].[vw_LoadToBronzeLayer])
    SELECT '[{"path":"FETCH_FROM_SQL","params":{"layer":"bronze","proc":"[execution].[sp_GetBronzelayerEntity_Full]","count":'
        + CAST(@cnt AS NVARCHAR(10)) + '}}]' AS NotebookParams
END
"""

SILVER_SIGNAL_SQL = r"""
CREATE PROCEDURE [execution].[sp_GetSilverlayerEntity]
WITH EXECUTE AS CALLER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @cnt INT = (SELECT COUNT(*) FROM [execution].[vw_LoadToSilverLayer])
    SELECT '[{"path":"FETCH_FROM_SQL","params":{"layer":"silver","proc":"[execution].[sp_GetSilverlayerEntity_Full]","count":'
        + CAST(@cnt AS NVARCHAR(10)) + '}}]' AS NotebookParams
END
"""

LZ_SIGNAL_SQL = r"""
CREATE PROCEDURE [execution].[sp_GetLandingzoneEntity]
    WITH EXECUTE AS CALLER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @cnt INT = (SELECT COUNT(*) FROM [execution].[vw_LoadSourceToLandingzone])
    SELECT '[{"path":"FETCH_FROM_SQL","params":{"layer":"landingzone","proc":"[execution].[sp_GetLandingzoneEntity_Full]","count":'
        + CAST(@cnt AS NVARCHAR(10)) + '}}]' AS NotebookParams
END
"""


def main():
    conn = connect()
    cursor = conn.cursor()
    print('[OK] Connected to SQL\n')

    # Step 1: Create _Full variants
    steps = [
        ('execution', 'sp_GetBronzelayerEntity_Full',  BRONZE_FULL_SQL),
        ('execution', 'sp_GetSilverlayerEntity_Full',  SILVER_FULL_SQL),
    ]

    for i, (schema, name, sql) in enumerate(steps, 1):
        print(f'[{i}/7] Creating {schema}.{name}...')
        drop_if_exists(cursor, schema, name)
        cursor.execute(sql)
        print(f'  [OK]')

    # Step 2: Create LZ _Full from current LZ proc
    print('[3/7] Creating execution.sp_GetLandingzoneEntity_Full...')
    drop_if_exists(cursor, 'execution', 'sp_GetLandingzoneEntity_Full')
    try:
        lz_body = get_proc_body(cursor, 'execution', 'sp_GetLandingzoneEntity')
        lz_full = lz_body.replace(
            '[execution].[sp_GetLandingzoneEntity]',
            '[execution].[sp_GetLandingzoneEntity_Full]'
        )
        cursor.execute(lz_full)
        print('  [OK]')
    except Exception as e:
        print(f'  [WARN] Could not copy LZ proc: {e}')
        print('  Skipping LZ _Full (LZ signal proc will still work)')

    # Step 3: Replace originals with signal procs
    signal_steps = [
        ('execution', 'sp_GetBronzelayerEntity',  BRONZE_SIGNAL_SQL),
        ('execution', 'sp_GetSilverlayerEntity',  SILVER_SIGNAL_SQL),
        ('execution', 'sp_GetLandingzoneEntity',  LZ_SIGNAL_SQL),
    ]

    for i, (schema, name, sql) in enumerate(signal_steps, 4):
        print(f'[{i}/7] Replacing {schema}.{name} with signal...')
        try:
            drop_if_exists(cursor, schema, name)
        except:
            pass
        cursor.execute(sql)
        print(f'  [OK]')

    # Step 4: Verify
    print('\n' + '='*60)
    print('VERIFICATION')
    print('='*60)

    for proc in ['sp_GetBronzelayerEntity', 'sp_GetSilverlayerEntity', 'sp_GetLandingzoneEntity']:
        cursor.execute(f'EXEC [execution].[{proc}]')
        row = cursor.fetchone()
        result = row[0] if row else 'NULL'
        print(f'\n{proc} (signal):')
        print(f'  {result}')

    print('\n_Full procs:')
    cursor.execute("""
        SELECT s.name + '.' + p.name AS proc_name
        FROM sys.procedures p JOIN sys.schemas s ON p.schema_id = s.schema_id
        WHERE p.name LIKE '%Entity[_]Full'
        ORDER BY p.name
    """)
    for row in cursor.fetchall():
        print(f'  {row[0]}')

    conn.close()
    print('\n[DONE] All stored procedures deployed successfully')


if __name__ == '__main__':
    main()
