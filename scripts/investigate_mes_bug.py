import struct, json, urllib.request, urllib.parse, pyodbc

tenant = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
client = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
secret = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
scope = 'https://analysis.windows.net/powerbi/api/.default'
url = f'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token'
data = urllib.parse.urlencode({'grant_type': 'client_credentials','client_id': client,'client_secret': secret,'scope': scope}).encode()
req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())['access_token']
token_bytes = token.encode('UTF-16-LE')
token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
server = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
database = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
conn_str = f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server};DATABASE={database};Encrypt=yes;TrustServerCertificate=no'
SQL_COPT_SS_ACCESS_TOKEN = 1256
conn = pyodbc.connect(conn_str, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct})
cursor = conn.cursor()

# QUERY: Distinct watermark column names for the other category
print('DISTINCT WATERMARK COLUMNS - Non-datetime, non-_id patterns')
print('='*80)
cursor.execute("""
SELECT LE.IsIncrementalColumn, COUNT(*) as cnt
FROM integration.LandingzoneEntity LE
WHERE LE.DataSourceId = 4 AND LE.IsIncremental = 1
    AND LE.IsIncrementalColumn NOT LIKE '%_id'
    AND LE.IsIncrementalColumn NOT LIKE '%Id'
    AND LE.IsIncrementalColumn NOT LIKE '%ID'
    AND LE.IsIncrementalColumn <> 'id'
    AND LE.IsIncrementalColumn <> 'artid'
    AND LE.IsIncrementalColumn NOT LIKE '%date%'
    AND LE.IsIncrementalColumn NOT LIKE '%time%'
    AND LE.IsIncrementalColumn NOT LIKE '%Date%'
    AND LE.IsIncrementalColumn NOT LIKE '%Time%'
    AND LE.IsIncrementalColumn NOT LIKE '%Modified%'
    AND LE.IsIncrementalColumn NOT LIKE '%Created%'
    AND LE.IsIncrementalColumn NOT LIKE '%modified%'
    AND LE.IsIncrementalColumn NOT LIKE '%created%'
GROUP BY LE.IsIncrementalColumn
ORDER BY cnt DESC
""")
for r in cursor.fetchall():
    print(f'  {r[0]}: {r[1]} entities')

# QUERY: LastLoadValue SQL for broken entity 3
print()
print('='*80)
print('QUERY: LastLoadValue SQL generated for broken entity (EntityId=3)')
print('='*80)
cursor.execute("""
SELECT LastLoadValue
FROM execution.vw_LoadSourceToLandingzone 
WHERE EntityId = 3
""")
r = cursor.fetchone()
if r:
    print(f'  LastLoadValue SQL: {r[0]}')

# QUERY: MES incremental entities with NUMERIC LoadValues
print()
print('='*80)
print('QUERY: MES incremental entities with NUMERIC LoadValues (working correctly)')
print('='*80)
cursor.execute("""
SELECT TOP 10 
    LE.LandingzoneEntityId,
    LE.SourceSchema + '.' + LE.SourceName as Entity,
    LE.IsIncrementalColumn,
    LLV.LoadValue
FROM integration.LandingzoneEntity LE
INNER JOIN execution.LandingzoneEntityLastLoadValue LLV 
    ON LLV.LandingzoneEntityId = LE.LandingzoneEntityId
WHERE LE.DataSourceId = 4 
    AND LE.IsIncremental = 1
    AND ISNUMERIC(LLV.LoadValue) = 1
    AND LLV.LoadValue NOT LIKE '%-%'
ORDER BY LE.LandingzoneEntityId
""")
rows = cursor.fetchall()
print(f'  Found: {len(rows)} with numeric LoadValues')
for r in rows:
    print(f'  ID={r[0]} | {r[1]} | Col={r[2]} | Value={r[3]}')

# QUERY: Datetime watermark entities 
print()
print('='*80)
print('QUERY: MES datetime watermark entities - verify values')
print('='*80)
cursor.execute("""
SELECT TOP 10
    LE.LandingzoneEntityId,
    LE.SourceSchema + '.' + LE.SourceName as Entity,
    LE.IsIncrementalColumn,
    LLV.LoadValue
FROM integration.LandingzoneEntity LE
INNER JOIN execution.LandingzoneEntityLastLoadValue LLV 
    ON LLV.LandingzoneEntityId = LE.LandingzoneEntityId
WHERE LE.DataSourceId = 4 
    AND LE.IsIncremental = 1
    AND (LE.IsIncrementalColumn LIKE '%date%' 
         OR LE.IsIncrementalColumn LIKE '%time%' 
         OR LE.IsIncrementalColumn LIKE '%Date%'
         OR LE.IsIncrementalColumn LIKE '%Time%'
         OR LE.IsIncrementalColumn LIKE '%Modified%'
         OR LE.IsIncrementalColumn LIKE '%modified%')
ORDER BY LE.LandingzoneEntityId
""")
for r in cursor.fetchall():
    print(f'  ID={r[0]} | {r[1]} | Col={r[2]} | Value={r[3]}')

# QUERY: Breakdown of all mismatched by type
print()
print('='*80)
print('FULL BREAKDOWN: All 408 incremental entities by LoadValue type')
print('='*80)
cursor.execute("""
SELECT 
    SUM(CASE WHEN ISNUMERIC(LLV.LoadValue) = 1 AND LLV.LoadValue NOT LIKE '%-%' THEN 1 ELSE 0 END) as numeric_values,
    SUM(CASE WHEN LLV.LoadValue LIKE '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]%' THEN 1 ELSE 0 END) as datetime_values,
    SUM(CASE WHEN LLV.LoadValue LIKE '1900%' THEN 1 ELSE 0 END) as default_1900_values,
    COUNT(*) as total
FROM integration.LandingzoneEntity LE
INNER JOIN execution.LandingzoneEntityLastLoadValue LLV 
    ON LLV.LandingzoneEntityId = LE.LandingzoneEntityId
WHERE LE.DataSourceId = 4 AND LE.IsIncremental = 1
""")
r = cursor.fetchone()
print(f'  Numeric values (likely correct for INT cols): {r[0]}')
print(f'  Datetime-format values: {r[1]}')
print(f'  Default 1900 values: {r[2]}')
print(f'  Total: {r[3]}')

conn.close()
print()
print('Done!')
