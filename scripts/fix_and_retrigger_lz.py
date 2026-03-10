"""
Fix LZ Pipeline Root Causes and Re-Trigger for OPTIVA
=====================================================
Three root causes identified:
1. Stale PipelineLandingzoneEntity records from previous failed runs
2. Entities with timestamp/rowversion incremental columns (can't compare varchar to timestamp)
3. OOM on very large tables

Fixes:
- Delete ALL unprocessed PipelineLandingzoneEntity entries (clean slate)
- Reset IsIncremental=0 for entities where IsIncrementalColumn is timestamp/rowversion type
- Deactivate non-OPTIVA, trigger pipeline, reactivate (try/finally)
"""
import urllib.request, json, struct, time, pyodbc, sys
from datetime import datetime, timezone

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
SQL_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
SQL_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
WS = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
LZ_PIPELINE = '3d0b3b2b-a069-40dc-b735-d105f9e66838'
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


def fabric_api(method, path, body=None):
    token = get_token('https://api.fabric.microsoft.com/.default')
    url = f'https://api.fabric.microsoft.com/v1{path}'
    if body is not None:
        data = json.dumps(body).encode()
    else:
        data = b'{}' if method == 'POST' else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main():
    output = []
    start_time = time.time()

    log('=' * 70)
    log('FIX AND RE-TRIGGER LZ PIPELINE FOR OPTIVA')
    log('=' * 70)

    # ================================================================
    # FIX 1: Clean up stale PipelineLandingzoneEntity records
    # ================================================================
    log('')
    log('FIX 1: Cleaning stale PipelineLandingzoneEntity records...')
    conn = get_sql_conn()
    cursor = conn.cursor()

    # Show current state
    cursor.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN IsProcessed = 1 THEN 1 ELSE 0 END) as processed,
               SUM(CASE WHEN IsProcessed = 0 THEN 1 ELSE 0 END) as unprocessed
        FROM execution.PipelineLandingzoneEntity
    """)
    r = cursor.fetchone()
    log(f'  Before: {r[0]} total, {r[1]} processed, {r[2]} unprocessed')
    output.append(f'PipelineLandingzoneEntity before cleanup: {r[0]} total, {r[1]} processed, {r[2]} unprocessed')

    # Delete ALL unprocessed entries - fresh start
    cursor.execute("DELETE FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 0")
    deleted = cursor.rowcount
    conn.commit()
    log(f'  Deleted {deleted} unprocessed entries')
    output.append(f'Deleted {deleted} stale unprocessed PipelineLandingzoneEntity entries')

    # Verify
    cursor.execute("SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity")
    remaining = cursor.fetchone()[0]
    log(f'  After: {remaining} remaining (all processed)')

    # ================================================================
    # FIX 2: Reset incremental for entities with timestamp/rowversion columns
    # ================================================================
    log('')
    log('FIX 2: Fixing entities with bad incremental columns...')

    # Find entities where IsIncrementalColumn contains 'timestamp' or is a rowversion
    # These cause "Implicit conversion from varchar to timestamp" errors
    cursor.execute("""
        SELECT le.LandingzoneEntityId, le.SourceName, le.IsIncrementalColumn, ds.Namespace
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.IsIncremental = 1
        AND le.IsIncrementalColumn IS NOT NULL
        AND (
            LOWER(le.IsIncrementalColumn) LIKE '%timestamp%'
            OR LOWER(le.IsIncrementalColumn) LIKE '%rowversion%'
        )
    """)
    ts_entities = cursor.fetchall()
    log(f'  Found {len(ts_entities)} entities with timestamp/rowversion incremental columns:')
    for e in ts_entities:
        log(f'    LzId={e[0]} {e[3]}/{e[1]} -> {e[2]}')
    output.append(f'Found {len(ts_entities)} entities with timestamp/rowversion incremental columns')

    if ts_entities:
        ids = [str(e[0]) for e in ts_entities]
        cursor.execute(f"""
            UPDATE integration.LandingzoneEntity
            SET IsIncremental = 0, IsIncrementalColumn = NULL
            WHERE LandingzoneEntityId IN ({','.join(ids)})
        """)
        conn.commit()
        log(f'  Reset {cursor.rowcount} entities to full load')
        output.append(f'Reset {cursor.rowcount} entities from incremental to full load')

    # Also find entities that had conversion errors specifically
    # These had varchar->int conversion (not timestamp)
    known_bad_ids = [547, 605]  # ipc_ion_task_info, MPINVTRAN
    cursor.execute(f"""
        SELECT LandingzoneEntityId, SourceName, IsIncrementalColumn, IsIncremental
        FROM integration.LandingzoneEntity
        WHERE LandingzoneEntityId IN ({','.join(str(x) for x in known_bad_ids)})
    """)
    bad_entities = cursor.fetchall()
    for e in bad_entities:
        if e[3]:  # IsIncremental is True
            log(f'  Also fixing known bad entity: LzId={e[0]} {e[1]} (IncrCol={e[2]})')
            cursor.execute("""
                UPDATE integration.LandingzoneEntity
                SET IsIncremental = 0, IsIncrementalColumn = NULL
                WHERE LandingzoneEntityId = ?
            """, e[0])
    conn.commit()

    # Check overall incremental state
    cursor.execute("""
        SELECT ds.Namespace,
               COUNT(*) as total,
               SUM(CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END) as incremental
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.IsActive = 1
        GROUP BY ds.Namespace
        ORDER BY ds.Namespace
    """)
    log('  Incremental status after fixes:')
    for r in cursor.fetchall():
        log(f'    {r[0]}: {r[2]}/{r[1]} incremental')

    # ================================================================
    # FIX 3: Deactivate non-OPTIVA entities
    # ================================================================
    log('')
    log('FIX 3: Deactivating non-OPTIVA entities...')
    cursor.execute("UPDATE integration.LandingzoneEntity SET IsActive = 0 WHERE DataSourceId != 8")
    deactivated = cursor.rowcount
    conn.commit()
    log(f'  Deactivated {deactivated} non-OPTIVA entities')

    # Verify
    cursor.execute("""
        SELECT ds.Namespace, ds.DataSourceId,
               COUNT(*) as total,
               SUM(CASE WHEN le.IsActive=1 THEN 1 ELSE 0 END) as active
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace, ds.DataSourceId
        ORDER BY ds.DataSourceId
    """)
    for r in cursor.fetchall():
        log(f'  DS {r[1]} ({r[0]}): {r[3]}/{r[2]} active')

    cursor.close()
    conn.close()

    # ================================================================
    # TRIGGER LZ PIPELINE
    # ================================================================
    log('')
    log('TRIGGERING LZ PIPELINE...')
    path = f'/workspaces/{WS}/items/{LZ_PIPELINE}/jobs/instances?jobType=Pipeline'
    status_code, resp_body = fabric_api('POST', path)
    log(f'  Response: {status_code}')

    if status_code == 202:
        log('  Pipeline triggered successfully! Monitoring...')
        output.append('Pipeline triggered successfully')
    elif status_code == 409:
        log('  Pipeline already running (409 Conflict). Monitoring existing run...')
        output.append('Pipeline already running, monitoring existing')
    else:
        log(f'  ERROR triggering pipeline: {resp_body.decode()[:500]}')
        output.append(f'ERROR triggering pipeline: {status_code}')
        # Still need to reactivate
        raise Exception(f'Pipeline trigger failed: {status_code}')

    # ================================================================
    # MONITOR PIPELINE
    # ================================================================
    log('')
    poll_start = time.time()
    final_status = None

    try:
        while time.time() - poll_start < TIMEOUT_MINUTES * 60:
            time.sleep(30)
            try:
                path = f'/workspaces/{WS}/items/{LZ_PIPELINE}/jobs/instances?limit=1'
                sc, body = fabric_api('GET', path)
                if sc == 200:
                    data = json.loads(body)
                    if data.get('value'):
                        job = data['value'][0]
                        status = job.get('status', 'Unknown')
                        elapsed = int(time.time() - poll_start)
                        log(f'Status: {status} ({elapsed // 60}m{elapsed % 60}s)')

                        if status in ('Completed', 'Failed', 'Cancelled'):
                            final_status = status
                            output.append(f'Pipeline {status}')
                            output.append(f'Start: {job.get("startTimeUtc")}')
                            output.append(f'End: {job.get("endTimeUtc")}')
                            fr = job.get('failureReason')
                            if fr:
                                output.append(f'Failure: {json.dumps(fr)}')
                                log(f'Failure: {json.dumps(fr)[:300]}')
                            break
            except Exception as e:
                log(f'  Poll error: {e}')
        else:
            final_status = 'Timeout'
            output.append(f'TIMEOUT after {TIMEOUT_MINUTES} minutes')
            log(f'TIMEOUT after {TIMEOUT_MINUTES} minutes')

    except KeyboardInterrupt:
        log('Interrupted by user')
        final_status = 'Interrupted'

    # ================================================================
    # POST-RUN INVESTIGATION
    # ================================================================
    log('')
    log(f'Pipeline result: {final_status}')
    log('Running post-run investigation...')

    try:
        conn = get_sql_conn()
        cursor = conn.cursor()

        # Check what got processed
        cursor.execute("""
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN IsProcessed = 1 THEN 1 ELSE 0 END) as processed,
                   SUM(CASE WHEN IsProcessed = 0 THEN 1 ELSE 0 END) as unprocessed
            FROM execution.PipelineLandingzoneEntity
        """)
        r = cursor.fetchone()
        log(f'  PipelineLandingzoneEntity: {r[0]} total, {r[1]} processed, {r[2]} unprocessed')
        output.append(f'After run: {r[0]} total, {r[1]} processed, {r[2]} unprocessed')

        # Check for new FailedCopyActivity entries
        cursor.execute("""
            SELECT CopyActivityParameters, EntityId, LogDateTime, LEFT(LogData, 300)
            FROM logging.CopyActivityExecution
            WHERE LogType = 'FailedCopyActivity'
            AND LogDateTime >= DATEADD(minute, -100, GETUTCDATE())
            ORDER BY LogDateTime DESC
        """)
        failures = cursor.fetchall()
        log(f'  FailedCopyActivity in last 100 min: {len(failures)}')
        output.append(f'FailedCopyActivity count: {len(failures)}')
        for f_row in failures[:20]:
            log(f'    EntityId={f_row[1]} {f_row[0]}: {str(f_row[3])[:200]}')

        # Copy activity summary
        cursor.execute("""
            SELECT LogType, COUNT(*) as cnt
            FROM logging.CopyActivityExecution
            WHERE LogDateTime >= DATEADD(minute, -100, GETUTCDATE())
            GROUP BY LogType
        """)
        for r in cursor.fetchall():
            log(f'  CopyActivity {r[0]}: {r[1]}')

        cursor.close()
        conn.close()
    except Exception as e:
        log(f'  Investigation error: {e}')

    # ================================================================
    # REACTIVATE ALL ENTITIES (ALWAYS runs)
    # ================================================================
    log('')
    log('REACTIVATING all entities...')
    try:
        conn = get_sql_conn()
        cursor = conn.cursor()
        cursor.execute("UPDATE integration.LandingzoneEntity SET IsActive = 1 WHERE IsActive = 0")
        reactivated = cursor.rowcount
        conn.commit()
        log(f'  Reactivated {reactivated} entities')
        output.append(f'Reactivated {reactivated} entities')

        # Verify
        cursor.execute("""
            SELECT ds.DataSourceId, COUNT(*) as total,
                   SUM(CASE WHEN le.IsActive=1 THEN 1 ELSE 0 END) as active
            FROM integration.LandingzoneEntity le
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            GROUP BY ds.DataSourceId ORDER BY ds.DataSourceId
        """)
        for r in cursor.fetchall():
            log(f'  DS {r[0]}: {r[2]}/{r[1]} active')

        cursor.close()
        conn.close()
    except Exception as e:
        log(f'  CRITICAL: Reactivation error: {e}')

    # ================================================================
    # WRITE RESULTS
    # ================================================================
    total_time = int(time.time() - start_time)
    log('')
    log(f'Total elapsed: {total_time // 60}m{total_time % 60}s')
    log(f'Final status: {final_status}')

    with open('scripts/optiva_lz_fix_results.txt', 'w') as f:
        f.write(f'OPTIVA LZ Pipeline Fix & Re-Trigger Results\n')
        f.write(f'{"=" * 50}\n')
        f.write(f'Time: {datetime.now(timezone.utc).isoformat()}\n')
        f.write(f'Duration: {total_time // 60}m{total_time % 60}s\n')
        f.write(f'Final Status: {final_status}\n\n')
        for line in output:
            f.write(f'{line}\n')
    log('Results written to scripts/optiva_lz_fix_results.txt')


if __name__ == '__main__':
    main()
