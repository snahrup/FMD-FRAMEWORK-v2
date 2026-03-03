import os
"""
Monitor the final LZ pipeline run.
Reactivates all entities (except 3 OOM) when pipeline completes.
If successful, triggers Bronze pipeline next.
"""
import urllib.request, json, struct, time, pyodbc
from datetime import datetime, timezone

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = os.environ.get('FABRIC_CLIENT_SECRET', '')
SQL_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
SQL_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
WS = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
LZ_PIPELINE = '3d0b3b2b-a069-40dc-b735-d105f9e66838'
BRONZE_PIPELINE = '8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3'
SILVER_PIPELINE = '90c0535c-c5dc-43a3-b51e-c44ef1808a60'
OOM_ENTITIES = [1386, 1389, 1451]
TIMEOUT_MINUTES = 90


def log(msg):
    ts = datetime.now(timezone.utc).strftime('%H:%M:%S')
    print(f'[{ts} UTC] {msg}', flush=True)


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


def check_pipeline_status(pipeline_id):
    token = get_token('https://api.fabric.microsoft.com/.default')
    url = (
        f'https://api.fabric.microsoft.com/v1/workspaces/{WS}'
        f'/items/{pipeline_id}/jobs/instances?limit=1'
    )
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {token}')
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
        if data.get('value'):
            return data['value'][0]
    return None


def trigger_pipeline(pipeline_id):
    token = get_token('https://api.fabric.microsoft.com/.default')
    url = (
        f'https://api.fabric.microsoft.com/v1/workspaces/{WS}'
        f'/items/{pipeline_id}/jobs/instances?jobType=Pipeline'
    )
    req = urllib.request.Request(url, data=b'{}', method='POST')
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def monitor_pipeline(pipeline_id, pipeline_name, timeout_min):
    log(f'Monitoring {pipeline_name}...')
    start = time.time()
    while time.time() - start < timeout_min * 60:
        time.sleep(30)
        try:
            job = check_pipeline_status(pipeline_id)
            if not job:
                continue
            status = job.get('status', 'Unknown')
            elapsed = int(time.time() - start)
            log(f'{pipeline_name}: {status} ({elapsed // 60}m{elapsed % 60}s)')
            if status in ('Completed', 'Failed', 'Cancelled'):
                fr = job.get('failureReason')
                if fr:
                    log(f'  Failure: {json.dumps(fr)[:300]}')
                return status, job
        except Exception as e:
            log(f'  Poll error: {e}')
    return 'Timeout', None


def reactivate_entities(conn, keep_deactivated=None):
    """Reactivate all entities except specified IDs."""
    cursor = conn.cursor()
    if keep_deactivated:
        ids = ','.join(str(x) for x in keep_deactivated)
        cursor.execute(f"""
            UPDATE integration.LandingzoneEntity
            SET IsActive = 1
            WHERE IsActive = 0 AND LandingzoneEntityId NOT IN ({ids})
        """)
    else:
        cursor.execute("UPDATE integration.LandingzoneEntity SET IsActive = 1 WHERE IsActive = 0")
    count = cursor.rowcount
    conn.commit()
    cursor.close()
    return count


def investigate(conn, pipeline_name):
    cursor = conn.cursor()
    log(f'=== {pipeline_name} Investigation ===')

    # PipelineLandingzoneEntity status
    cursor.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN IsProcessed = 1 THEN 1 ELSE 0 END) as processed,
               SUM(CASE WHEN IsProcessed = 0 THEN 1 ELSE 0 END) as unprocessed
        FROM execution.PipelineLandingzoneEntity
    """)
    r = cursor.fetchone()
    log(f'  PipelineLandingzoneEntity: {r[0]} total, {r[1]} processed, {r[2]} unprocessed')

    # FailedCopyActivity
    cursor.execute("""
        SELECT CopyActivityParameters, EntityId, LEFT(LogData, 200)
        FROM logging.CopyActivityExecution
        WHERE LogType = 'FailedCopyActivity'
        AND LogDateTime >= DATEADD(minute, -100, GETUTCDATE())
        ORDER BY LogDateTime DESC
    """)
    failures = cursor.fetchall()
    log(f'  FailedCopyActivity (last 100 min): {len(failures)}')
    for f in failures[:10]:
        log(f'    EntityId={f[1]} {f[0]}')

    # CopyActivity summary
    cursor.execute("""
        SELECT LogType, COUNT(*) as cnt
        FROM logging.CopyActivityExecution
        WHERE LogDateTime >= DATEADD(minute, -100, GETUTCDATE())
        GROUP BY LogType
    """)
    for r in cursor.fetchall():
        log(f'  CopyActivity {r[0]}: {r[1]}')

    cursor.close()


def main():
    output = []
    start_time = time.time()

    try:
        # ================= LZ PIPELINE =================
        log('=' * 60)
        log('MONITORING LZ PIPELINE (477 OPTIVA entities)')
        log('=' * 60)

        lz_status, lz_job = monitor_pipeline(LZ_PIPELINE, 'LZ', TIMEOUT_MINUTES)
        output.append(f'LZ Pipeline: {lz_status}')

        conn = get_sql_conn()
        investigate(conn, 'LZ')

        if lz_status == 'Completed':
            log('LZ PIPELINE COMPLETED SUCCESSFULLY!')

            # Clean stale entries before Bronze
            cursor = conn.cursor()
            cursor.execute('DELETE FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 0')
            conn.commit()
            cursor.close()
            log('Cleaned stale PipelineLandingzoneEntity entries')

            # ================= BRONZE PIPELINE =================
            log('')
            log('=' * 60)
            log('TRIGGERING BRONZE PIPELINE')
            log('=' * 60)
            sc = trigger_pipeline(BRONZE_PIPELINE)
            log(f'Bronze trigger: {sc}')
            output.append(f'Bronze triggered: {sc}')

            if sc in (202, 409):
                brz_status, brz_job = monitor_pipeline(BRONZE_PIPELINE, 'Bronze', 60)
                output.append(f'Bronze Pipeline: {brz_status}')

                conn2 = get_sql_conn()
                investigate(conn2, 'Bronze')

                if brz_status == 'Completed':
                    log('BRONZE PIPELINE COMPLETED SUCCESSFULLY!')

                    # ================= SILVER PIPELINE =================
                    log('')
                    log('=' * 60)
                    log('TRIGGERING SILVER PIPELINE')
                    log('=' * 60)
                    sc = trigger_pipeline(SILVER_PIPELINE)
                    log(f'Silver trigger: {sc}')
                    output.append(f'Silver triggered: {sc}')

                    if sc in (202, 409):
                        slv_status, slv_job = monitor_pipeline(SILVER_PIPELINE, 'Silver', TIMEOUT_MINUTES)
                        output.append(f'Silver Pipeline: {slv_status}')

                        conn3 = get_sql_conn()
                        investigate(conn3, 'Silver')
                        conn3.close()

                        if slv_status == 'Completed':
                            log('SILVER PIPELINE COMPLETED SUCCESSFULLY!')
                            log('ALL THREE LAYERS LOADED!')
                        else:
                            log(f'Silver pipeline: {slv_status}')
                else:
                    log(f'Bronze pipeline: {brz_status}')
                conn2.close()
        else:
            log(f'LZ pipeline: {lz_status}')

        conn.close()

    finally:
        # ALWAYS reactivate (except OOM entities)
        log('')
        log('REACTIVATING all entities (except 3 OOM)...')
        try:
            conn = get_sql_conn()
            reactivated = reactivate_entities(conn, keep_deactivated=OOM_ENTITIES)
            log(f'Reactivated {reactivated} entities')

            cursor = conn.cursor()
            cursor.execute("""
                SELECT ds.DataSourceId,
                       SUM(CASE WHEN le.IsActive=1 THEN 1 ELSE 0 END) as active,
                       COUNT(*) as total
                FROM integration.LandingzoneEntity le
                JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
                GROUP BY ds.DataSourceId ORDER BY ds.DataSourceId
            """)
            for r in cursor.fetchall():
                log(f'  DS {r[0]}: {r[1]}/{r[2]} active')
            cursor.close()
            conn.close()
        except Exception as e:
            log(f'CRITICAL: Reactivation error: {e}')

    total = int(time.time() - start_time)
    log(f'\nTotal elapsed: {total // 60}m{total % 60}s')

    with open('scripts/optiva_full_pipeline_results.txt', 'w') as f:
        f.write(f'OPTIVA Full Pipeline Results\n{"=" * 40}\n')
        f.write(f'Time: {datetime.now(timezone.utc).isoformat()}\n')
        f.write(f'Duration: {total // 60}m{total % 60}s\n\n')
        for line in output:
            f.write(f'{line}\n')
    log('Results written to scripts/optiva_full_pipeline_results.txt')


if __name__ == '__main__':
    main()
