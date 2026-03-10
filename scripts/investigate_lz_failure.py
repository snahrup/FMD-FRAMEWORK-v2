"""Investigate the latest LZ pipeline failure - OPTIVA only run."""
import urllib.request, json, struct, pyodbc
from datetime import datetime, timezone

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
SQL_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
SQL_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
WS = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
LZ_PIPELINE = '3d0b3b2b-a069-40dc-b735-d105f9e66838'


def get_token(scope):
    data = f'grant_type=client_credentials&client_id={CLIENT}&client_secret={SECRET}&scope={scope}'.encode()
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=data, method='POST'
    )
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())['access_token']


def get_sql_conn():
    token = get_token('https://database.windows.net/.default')
    tb = token.encode('utf-16-le')
    ts = struct.pack(f'<I{len(tb)}s', len(tb), tb)
    return pyodbc.connect(
        f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SQL_SERVER};DATABASE={SQL_DB};"
        f"Encrypt=yes;TrustServerCertificate=no;",
        attrs_before={1256: ts}
    )


def fabric_api(method, path):
    token = get_token('https://api.fabric.microsoft.com/.default')
    url = f'https://api.fabric.microsoft.com/v1{path}'
    req = urllib.request.Request(url, method=method)
    req.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def main():
    print('=' * 70)
    print('LZ PIPELINE FAILURE INVESTIGATION')
    print(f'Time: {datetime.now(timezone.utc).isoformat()}')
    print('=' * 70)

    # Get latest pipeline run info
    print('\n--- Latest Pipeline Run ---')
    sc, data = fabric_api('GET', f'/workspaces/{WS}/items/{LZ_PIPELINE}/jobs/instances?limit=3')
    if sc == 200 and data.get('value'):
        for job in data['value']:
            print(f"  Status: {job.get('status')}")
            print(f"  Start: {job.get('startTimeUtc')}")
            print(f"  End: {job.get('endTimeUtc')}")
            fr = job.get('failureReason')
            if fr:
                print(f"  Failure: {json.dumps(fr)}")
            print()

    conn = get_sql_conn()
    cursor = conn.cursor()

    # FailedCopyActivity - last 90 minutes (covers our run)
    print('\n--- FailedCopyActivity (last 90 min) ---')
    cursor.execute("""
        SELECT cae.EntityId, cae.CopyActivityParameters,
               LEFT(CAST(cae.LogData AS NVARCHAR(MAX)), 500) as LogSnippet,
               cae.LogDateTime,
               le.SourceName, le.DataSourceId, le.SourceSchema,
               ds.Namespace
        FROM logging.CopyActivityExecution cae
        LEFT JOIN integration.LandingzoneEntity le ON cae.EntityId = le.LandingzoneEntityId
        LEFT JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE cae.LogType = 'FailedCopyActivity'
        AND cae.LogDateTime >= DATEADD(minute, -90, GETUTCDATE())
        ORDER BY cae.LogDateTime DESC
    """)
    failures = cursor.fetchall()
    print(f'  Total failures: {len(failures)}')
    for f in failures:
        print(f'\n  EntityId={f[0]} | DS{f[5]} ({f[7]}) | {f[6]}.{f[4]} | {f[1]}')
        print(f'  Time: {f[3]}')
        print(f'  Error: {f[2]}')

    # Copy activity summary
    print('\n--- Copy Activity Summary (last 90 min) ---')
    cursor.execute("""
        SELECT LogType, COUNT(*) as cnt
        FROM logging.CopyActivityExecution
        WHERE LogDateTime >= DATEADD(minute, -90, GETUTCDATE())
        GROUP BY LogType
        ORDER BY LogType
    """)
    for r in cursor.fetchall():
        print(f'  {r[0]}: {r[1]}')

    # Start vs End comparison for this run window
    print('\n--- Start vs End Entity Matching (last 90 min) ---')
    cursor.execute("""
        SELECT
            (SELECT COUNT(DISTINCT EntityId) FROM logging.CopyActivityExecution
             WHERE LogType='StartCopyActivity' AND LogDateTime >= DATEADD(minute, -90, GETUTCDATE())) as started,
            (SELECT COUNT(DISTINCT EntityId) FROM logging.CopyActivityExecution
             WHERE LogType='EndCopyActivity' AND LogDateTime >= DATEADD(minute, -90, GETUTCDATE())) as ended,
            (SELECT COUNT(DISTINCT EntityId) FROM logging.CopyActivityExecution
             WHERE LogType='FailedCopyActivity' AND LogDateTime >= DATEADD(minute, -90, GETUTCDATE())) as failed
    """)
    r = cursor.fetchone()
    print(f'  Distinct entities started: {r[0]}')
    print(f'  Distinct entities ended: {r[1]}')
    print(f'  Distinct entities failed: {r[2]}')

    # Check which DataSources were actually processed
    print('\n--- DataSources in StartCopyActivity (last 90 min) ---')
    cursor.execute("""
        SELECT ds.DataSourceId, ds.Namespace, COUNT(*) as cnt
        FROM logging.CopyActivityExecution cae
        JOIN integration.LandingzoneEntity le ON cae.EntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE cae.LogType = 'StartCopyActivity'
        AND cae.LogDateTime >= DATEADD(minute, -90, GETUTCDATE())
        GROUP BY ds.DataSourceId, ds.Namespace
        ORDER BY ds.DataSourceId
    """)
    for r in cursor.fetchall():
        print(f'  DS {r[0]} ({r[1]}): {r[2]} started')

    # PipelineLandingzoneEntity status
    print('\n--- PipelineLandingzoneEntity ---')
    cursor.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN IsProcessed = 1 THEN 1 ELSE 0 END) as processed,
               SUM(CASE WHEN IsProcessed = 0 THEN 1 ELSE 0 END) as unprocessed
        FROM execution.PipelineLandingzoneEntity
    """)
    r = cursor.fetchone()
    print(f'  Total: {r[0]}, Processed: {r[1]}, Unprocessed: {r[2]}')

    # Check current entity activation state
    print('\n--- Current Entity Activation State ---')
    cursor.execute("""
        SELECT ds.DataSourceId, ds.Namespace,
               COUNT(*) as total,
               SUM(CASE WHEN le.IsActive=1 THEN 1 ELSE 0 END) as active
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.DataSourceId, ds.Namespace
        ORDER BY ds.DataSourceId
    """)
    for r in cursor.fetchall():
        print(f'  DS {r[0]} ({r[1]}): {r[3]}/{r[2]} active')

    # Check pipeline execution log for error details
    print('\n--- Pipeline Execution Log (last 90 min) ---')
    cursor.execute("""
        SELECT LogType, LogDateTime, LEFT(CAST(LogData AS NVARCHAR(MAX)), 300)
        FROM logging.PipelineExecution
        WHERE LogDateTime >= DATEADD(minute, -90, GETUTCDATE())
        ORDER BY LogDateTime DESC
    """)
    for r in cursor.fetchall():
        print(f'  {r[0]} | {r[1]} | {r[2]}')

    cursor.close()
    conn.close()


if __name__ == '__main__':
    main()
