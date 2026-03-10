"""Comprehensive gap analysis across all sources and medallion layers."""
import struct, json, urllib.request

TENANT = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"

def get_token(scope):
    data = f"grant_type=client_credentials&client_id={CLIENT}&client_secret={SECRET}&scope={scope}".encode()
    req = urllib.request.Request(
        f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token",
        data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    return json.loads(urllib.request.urlopen(req).read())["access_token"]

def query_sql(token, sql):
    import pyodbc
    tok_bytes = token.encode("utf-16-le")
    tok_struct = struct.pack(f"<I{len(tok_bytes)}s", len(tok_bytes), tok_bytes)
    server = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
    db = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"
    conn = pyodbc.connect(
        f"Driver={{ODBC Driver 18 for SQL Server}};Server={server};Database={db};Encrypt=yes;TrustServerCertificate=no",
        attrs_before={1256: tok_struct}
    )
    cursor = conn.cursor()
    cursor.execute(sql)
    cols = [c[0] for c in cursor.description]
    rows = [dict(zip(cols, r)) for r in cursor.fetchall()]
    conn.close()
    return rows

print("Getting SQL token...")
token = get_token("https://analysis.windows.net/powerbi/api/.default")

# 1. All DataSources
print("\n" + "="*80)
print("1. ALL REGISTERED DATASOURCES")
print("="*80)
rows = query_sql(token, """
    SELECT ds.DataSourceId, ds.Name, ds.Namespace, ds.Type, ds.IsActive,
           c.Name as ConnName, c.ServerName, c.DatabaseName, c.IsActive as ConnActive
    FROM integration.DataSource ds
    LEFT JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
    ORDER BY ds.DataSourceId
""")
for r in rows:
    active = "ACTIVE" if r['IsActive'] else "INACTIVE"
    conn_active = "ACTIVE" if r.get('ConnActive') else "INACTIVE"
    print(f"  DS {r['DataSourceId']:3} | {r['Name']:25} | {r['Type'] or '':10} | {active:8} | Conn: {r.get('ConnName',''):35} ({conn_active})")
    if r.get('ServerName'):
        print(f"  {'':5} | Server: {r['ServerName']}  DB: {r.get('DatabaseName','')}")

# 2. Entity counts by source - LZ + Bronze + Silver registration
print("\n" + "="*80)
print("2. ENTITY REGISTRATION BY SOURCE (LZ -> Bronze -> Silver)")
print("="*80)
rows = query_sql(token, """
    SELECT
        ds.Name as Source,
        COUNT(DISTINCT le.LandingzoneEntityId) as LZ,
        COUNT(DISTINCT ble.BronzeLayerEntityId) as Bronze,
        COUNT(DISTINCT sle.SilverLayerEntityId) as Silver,
        SUM(CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END) as Incremental,
        SUM(CASE WHEN le.IsIncremental = 0 THEN 1 ELSE 0 END) as FullLoad
    FROM integration.LandingzoneEntity le
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    LEFT JOIN integration.BronzeLayerEntity ble ON le.LandingzoneEntityId = ble.LandingzoneEntityId
    LEFT JOIN integration.SilverLayerEntity sle ON ble.BronzeLayerEntityId = sle.BronzeLayerEntityId
    WHERE le.IsActive = 1
    GROUP BY ds.Name
    ORDER BY ds.Name
""")
total_lz = total_br = total_sv = 0
for r in rows:
    total_lz += r['LZ']; total_br += r['Bronze']; total_sv += r['Silver']
    gap_br = r['LZ'] - r['Bronze']
    gap_sv = r['Bronze'] - r['Silver']
    print(f"  {r['Source']:25} | LZ: {r['LZ']:5} | Bronze: {r['Bronze']:5} (gap: {gap_br:3}) | Silver: {r['Silver']:5} (gap: {gap_sv:3}) | Inc: {r['Incremental']:4} Full: {r['FullLoad']:4}")
print(f"  {'TOTAL':25} | LZ: {total_lz:5} | Bronze: {total_br:5} (gap: {total_lz-total_br:3}) | Silver: {total_sv:5} (gap: {total_br-total_sv:3})")

# 3. LZ Load Status - entities with/without load values
print("\n" + "="*80)
print("3. LZ LOAD STATUS (LastLoadValue records)")
print("="*80)
rows = query_sql(token, """
    SELECT
        ds.Name as Source,
        COUNT(*) as TotalActive,
        SUM(CASE WHEN lv.LandingzoneEntityValueId IS NOT NULL THEN 1 ELSE 0 END) as HasRecord,
        SUM(CASE WHEN lv.LandingzoneEntityValueId IS NULL THEN 1 ELSE 0 END) as MissingRecord,
        SUM(CASE WHEN lv.LoadValue IS NOT NULL AND lv.LoadValue != '' THEN 1 ELSE 0 END) as HasLoadValue,
        SUM(CASE WHEN lv.LoadValue IS NULL OR lv.LoadValue = '' THEN 1 ELSE 0 END) as EmptyLoadValue
    FROM integration.LandingzoneEntity le
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    LEFT JOIN execution.LandingzoneEntityLastLoadValue lv ON le.LandingzoneEntityId = lv.LandingzoneEntityId
    WHERE le.IsActive = 1
    GROUP BY ds.Name
    ORDER BY ds.Name
""")
for r in rows:
    print(f"  {r['Source']:25} | Active: {r['TotalActive']:5} | HasRecord: {r['HasRecord']:5} | MissingRecord: {r['MissingRecord']:3} | HasValue: {r['HasLoadValue']:5} | EmptyValue: {r['EmptyLoadValue']:5}")

# 4. Null/empty SourceName check
print("\n" + "="*80)
print("4. DATA QUALITY CHECKS")
print("="*80)
rows = query_sql(token, """
    SELECT COUNT(*) as cnt FROM integration.LandingzoneEntity
    WHERE IsActive = 1 AND (SourceName IS NULL OR LTRIM(RTRIM(SourceName)) = '')
""")
print(f"  Active entities with null/empty SourceName: {rows[0]['cnt']}")

rows = query_sql(token, """
    SELECT COUNT(*) as cnt FROM integration.LandingzoneEntity le
    WHERE le.IsActive = 1
      AND NOT EXISTS (
        SELECT 1 FROM execution.LandingzoneEntityLastLoadValue lv
        WHERE lv.LandingzoneEntityId = le.LandingzoneEntityId
      )
""")
print(f"  Active entities missing LastLoadValue record: {rows[0]['cnt']}")

# Check for rowversion/timestamp in IsIncrementalColumn
rows = query_sql(token, """
    SELECT COUNT(*) as cnt FROM integration.LandingzoneEntity
    WHERE IsActive = 1 AND IsIncremental = 1
      AND IsIncrementalColumn LIKE '%timestamp%'
""")
print(f"  Incremental entities with 'timestamp' in watermark col: {rows[0]['cnt']}")

rows = query_sql(token, """
    SELECT COUNT(*) as cnt FROM integration.LandingzoneEntity
    WHERE IsActive = 1 AND IsIncremental = 1
      AND IsIncrementalColumn LIKE '%rowversion%'
""")
print(f"  Incremental entities with 'rowversion' in watermark col: {rows[0]['cnt']}")

# 5. EntityStatusSummary overview
print("\n" + "="*80)
print("5. ENTITY STATUS SUMMARY (execution.EntityStatusSummary)")
print("="*80)
rows = query_sql(token, """
    SELECT
        SourceNamespace,
        COUNT(*) as Total,
        SUM(CASE WHEN LzStatus = 'loaded' THEN 1 ELSE 0 END) as LzLoaded,
        SUM(CASE WHEN LzStatus = 'not_started' OR LzStatus IS NULL THEN 1 ELSE 0 END) as LzNotStarted,
        SUM(CASE WHEN LzStatus = 'error' THEN 1 ELSE 0 END) as LzError,
        SUM(CASE WHEN BronzeStatus = 'loaded' THEN 1 ELSE 0 END) as BrLoaded,
        SUM(CASE WHEN BronzeStatus = 'not_started' OR BronzeStatus IS NULL THEN 1 ELSE 0 END) as BrNotStarted,
        SUM(CASE WHEN BronzeStatus = 'error' THEN 1 ELSE 0 END) as BrError,
        SUM(CASE WHEN SilverStatus = 'loaded' THEN 1 ELSE 0 END) as SvLoaded,
        SUM(CASE WHEN SilverStatus = 'not_started' OR SilverStatus IS NULL THEN 1 ELSE 0 END) as SvNotStarted,
        SUM(CASE WHEN SilverStatus = 'error' THEN 1 ELSE 0 END) as SvError,
        SUM(CASE WHEN OverallStatus = 'loaded' THEN 1 ELSE 0 END) as OverallLoaded,
        SUM(CASE WHEN OverallStatus = 'partial' THEN 1 ELSE 0 END) as OverallPartial,
        SUM(CASE WHEN OverallStatus = 'not_started' OR OverallStatus IS NULL THEN 1 ELSE 0 END) as OverallNotStarted,
        SUM(CASE WHEN OverallStatus = 'error' THEN 1 ELSE 0 END) as OverallError
    FROM execution.EntityStatusSummary
    WHERE IsActive = 1
    GROUP BY SourceNamespace
    ORDER BY SourceNamespace
""")
for r in rows:
    ns = r['SourceNamespace'] or '(null)'
    print(f"\n  Source: {ns} ({r['Total']} entities)")
    print(f"    LZ:      loaded={r['LzLoaded']:5}  not_started={r['LzNotStarted']:5}  error={r['LzError']:5}")
    print(f"    Bronze:  loaded={r['BrLoaded']:5}  not_started={r['BrNotStarted']:5}  error={r['BrError']:5}")
    print(f"    Silver:  loaded={r['SvLoaded']:5}  not_started={r['SvNotStarted']:5}  error={r['SvError']:5}")
    print(f"    Overall: loaded={r['OverallLoaded']:5}  partial={r['OverallPartial']:5}  not_started={r['OverallNotStarted']:5}  error={r['OverallError']:5}")

# 6. Entities with errors
print("\n" + "="*80)
print("6. ENTITIES WITH ERRORS (from EntityStatusSummary)")
print("="*80)
rows = query_sql(token, """
    SELECT TOP 30
        SourceNamespace, SourceSchema, SourceName,
        LzStatus, BronzeStatus, SilverStatus, OverallStatus,
        LastErrorLayer,
        SUBSTRING(CAST(LastErrorMessage AS NVARCHAR(200)), 1, 100) as ErrMsg,
        LastErrorTime
    FROM execution.EntityStatusSummary
    WHERE IsActive = 1
      AND (LzStatus = 'error' OR BronzeStatus = 'error' OR SilverStatus = 'error' OR OverallStatus = 'error'
           OR LastErrorMessage IS NOT NULL)
    ORDER BY LastErrorTime DESC
""")
if not rows:
    print("  No entities with error status!")
else:
    for r in rows:
        print(f"  {r['SourceNamespace'] or '':15}.{r['SourceSchema'] or '':5}.{r['SourceName'] or '':30} | LZ={r['LzStatus'] or '?':12} Br={r['BronzeStatus'] or '?':12} Sv={r['SilverStatus'] or '?':12}")
        if r.get('ErrMsg'):
            print(f"    Error ({r.get('LastErrorLayer','')}): {r['ErrMsg']}")

# 7. LZ entities that loaded but Bronze didn't process
print("\n" + "="*80)
print("7. PIPELINE PROCESSING STATUS (PipelineLandingzoneEntity)")
print("="*80)
rows = query_sql(token, """
    SELECT
        ds.Name as Source,
        COUNT(DISTINCT ple.PipelineLandingzoneEntityId) as TotalLoads,
        SUM(CASE WHEN ple.IsProcessed = 1 THEN 1 ELSE 0 END) as Processed,
        SUM(CASE WHEN ple.IsProcessed = 0 THEN 1 ELSE 0 END) as Unprocessed,
        MAX(ple.InsertDateTime) as LastInsert,
        MAX(ple.LoadEndDateTime) as LastLoadEnd
    FROM execution.PipelineLandingzoneEntity ple
    JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    GROUP BY ds.Name
    ORDER BY ds.Name
""")
for r in rows:
    print(f"  {r['Source']:25} | Total: {r['TotalLoads']:6} | Processed: {r['Processed']:6} | Unprocessed: {r['Unprocessed']:5} | LastInsert: {str(r.get('LastInsert',''))[:19]}")

# 8. Bronze processing status
print("\n" + "="*80)
print("8. BRONZE PROCESSING STATUS (PipelineBronzeLayerEntity)")
print("="*80)
rows = query_sql(token, """
    SELECT
        ds.Name as Source,
        COUNT(DISTINCT pble.PipelineBronzeLayerEntityId) as TotalLoads,
        SUM(CASE WHEN pble.IsProcessed = 1 THEN 1 ELSE 0 END) as Processed,
        SUM(CASE WHEN pble.IsProcessed = 0 THEN 1 ELSE 0 END) as Unprocessed,
        MAX(pble.InsertDateTime) as LastInsert
    FROM execution.PipelineBronzeLayerEntity pble
    JOIN integration.BronzeLayerEntity ble ON pble.BronzeLayerEntityId = ble.BronzeLayerEntityId
    JOIN integration.LandingzoneEntity le ON ble.LandingzoneEntityId = le.LandingzoneEntityId
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    GROUP BY ds.Name
    ORDER BY ds.Name
""")
for r in rows:
    print(f"  {r['Source']:25} | Total: {r['TotalLoads']:6} | Processed: {r['Processed']:6} | Unprocessed: {r['Unprocessed']:5} | LastInsert: {str(r.get('LastInsert',''))[:19]}")

# 9. Silver processing status
print("\n" + "="*80)
print("9. SILVER PROCESSING STATUS (PipelineSilverLayerEntity)")
print("="*80)
rows = query_sql(token, """
    SELECT
        ds.Name as Source,
        COUNT(DISTINCT psle.PipelineSilverLayerEntityId) as TotalLoads,
        SUM(CASE WHEN psle.IsProcessed = 1 THEN 1 ELSE 0 END) as Processed,
        SUM(CASE WHEN psle.IsProcessed = 0 THEN 1 ELSE 0 END) as Unprocessed,
        MAX(psle.InsertDateTime) as LastInsert
    FROM execution.PipelineSilverLayerEntity psle
    JOIN integration.SilverLayerEntity sle ON psle.SilverLayerEntityId = sle.SilverLayerEntityId
    JOIN integration.BronzeLayerEntity ble ON sle.BronzeLayerEntityId = ble.BronzeLayerEntityId
    JOIN integration.LandingzoneEntity le ON ble.LandingzoneEntityId = le.LandingzoneEntityId
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    GROUP BY ds.Name
    ORDER BY ds.Name
""")
for r in rows:
    print(f"  {r['Source']:25} | Total: {r['TotalLoads']:6} | Processed: {r['Processed']:6} | Unprocessed: {r['Unprocessed']:5} | LastInsert: {str(r.get('LastInsert',''))[:19]}")

# 10. Fabric API - recent pipeline runs
print("\n" + "="*80)
print("10. RECENT FABRIC PIPELINE RUNS (via API)")
print("="*80)
try:
    fab_token = get_token("https://api.fabric.microsoft.com/.default")
    code_ws = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"
    req = urllib.request.Request(
        f"https://api.fabric.microsoft.com/v1/workspaces/{code_ws}/items?type=DataPipeline",
        headers={"Authorization": f"Bearer {fab_token}"}
    )
    items = json.loads(urllib.request.urlopen(req).read())

    key_pipelines = ["PL_FMD_LOAD_ALL", "PL_FMD_LOAD_LANDINGZONE", "PL_FMD_LOAD_BRONZE", "PL_FMD_LOAD_SILVER",
                     "PL_FMD_LDZ_COMMAND_ASQL", "PL_FMD_LDZ_COPY_FROM_ASQL_01", "PL_FMD_LDZ_COPY_SQL"]
    for name in key_pipelines:
        pid = None
        for item in items.get("value", []):
            if item["displayName"] == name:
                pid = item["id"]
                break
        if not pid:
            print(f"\n  {name}: NOT FOUND in workspace")
            continue
        req = urllib.request.Request(
            f"https://api.fabric.microsoft.com/v1/workspaces/{code_ws}/items/{pid}/jobs/instances?limit=5",
            headers={"Authorization": f"Bearer {fab_token}"}
        )
        try:
            runs = json.loads(urllib.request.urlopen(req).read())
            vals = runs.get("value", [])
            if not vals:
                print(f"\n  {name}: No recent runs")
                continue
            print(f"\n  {name}:")
            for run in vals:
                status = run.get("status", "?")
                start = str(run.get("startTimeUtc", ""))[:19]
                end = str(run.get("endTimeUtc", ""))[:19]
                fail = run.get("failureReason", {})
                err_msg = str(fail.get("message", ""))[:80] if fail else ""
                print(f"    {start} -> {end} | {status:12} | {err_msg}")
        except Exception as e:
            print(f"\n  {name}: Error - {e}")
except Exception as e:
    print(f"  Error accessing Fabric API: {e}")

# 11. Connection health
print("\n" + "="*80)
print("11. CONNECTIONS")
print("="*80)
rows = query_sql(token, """
    SELECT ConnectionId, Name, Type, GatewayType, IsActive, ServerName, DatabaseName
    FROM integration.Connection
    ORDER BY ConnectionId
""")
for r in rows:
    active = "ACTIVE" if r['IsActive'] else "INACTIVE"
    print(f"  Conn {r['ConnectionId']:3} | {r['Name']:40} | {r.get('Type',''):10} | {r.get('GatewayType',''):15} | {active}")
    if r.get('ServerName'):
        print(f"  {'':8} | Server: {r['ServerName']}  DB: {r.get('DatabaseName','')}")

print("\n" + "="*80)
print("DONE - Gap analysis complete")
print("="*80)
