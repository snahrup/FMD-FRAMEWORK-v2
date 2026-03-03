import os
"""
OPTIVA Full Medallion Load: LZ → Bronze → Silver
===================================================
Comprehensive script that:
1. Deactivates ALL non-OPTIVA entities (DataSourceId != 8)
2. Deactivates 3 OOM OPTIVA entities
3. Cleans stale PipelineLandingzoneEntity entries
4. Verifies timestamp/rowversion incremental fix
5. Triggers LZ pipeline, monitors until completion
6. If LZ succeeds: triggers Bronze, monitors
7. If Bronze succeeds: triggers Silver, monitors
8. ALWAYS reactivates all entities (except OOM) in finally block

Root causes addressed:
- Stale PipelineLandingzoneEntity records from previous failed runs
- Entities with timestamp/rowversion incremental columns (varchar→timestamp error)
- 3 OPTIVA OOM entities (FSACTIONWIPRESULTS, FSDESCRIPTION, FSACTIONWEVENTPARAM)
- Non-OPTIVA entities failing and killing the entire ForEach
"""
import urllib.request, json, struct, time, pyodbc, sys
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
OOM_ENTITIES = [1386, 1389, 1451]  # FSACTIONWEVENTPARAM, FSACTIONWIPRESULTS, FSDESCRIPTION
OPTIVA_DS = 8
TIMEOUT_MINUTES = 90
POLL_INTERVAL = 30


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


def trigger_pipeline(pipeline_id):
    path = f'/workspaces/{WS}/items/{pipeline_id}/jobs/instances?jobType=Pipeline'
    return fabric_api('POST', path)


def monitor_pipeline(pipeline_id, name, timeout_min):
    log(f'Monitoring {name}...')
    start = time.time()
    while time.time() - start < timeout_min * 60:
        time.sleep(POLL_INTERVAL)
        try:
            path = f'/workspaces/{WS}/items/{pipeline_id}/jobs/instances?limit=1'
            sc, body = fabric_api('GET', path)
            if sc == 200:
                data = json.loads(body)
                if data.get('value'):
                    job = data['value'][0]
                    status = job.get('status', 'Unknown')
                    elapsed = int(time.time() - start)
                    log(f'{name}: {status} ({elapsed // 60}m{elapsed % 60}s)')
                    if status in ('Completed', 'Failed', 'Cancelled'):
                        fr = job.get('failureReason')
                        if fr:
                            log(f'  Failure: {json.dumps(fr)[:300]}')
                        return status, job
        except Exception as e:
            log(f'  Poll error: {e}')
    return 'Timeout', None


def investigate(conn, layer_name, minutes_back=100):
    """Post-run investigation of copy activity results."""
    cursor = conn.cursor()
    log(f'=== {layer_name} Investigation ===')

    # FailedCopyActivity
    cursor.execute(f"""
        SELECT cae.CopyActivityParameters, cae.EntityId, cae.LogDateTime,
               LEFT(CAST(cae.LogData AS NVARCHAR(MAX)), 300) as LogSnippet,
               le.SourceName, le.DataSourceId
        FROM logging.CopyActivityExecution cae
        LEFT JOIN integration.LandingzoneEntity le ON cae.EntityId = le.LandingzoneEntityId
        WHERE cae.LogType = 'FailedCopyActivity'
        AND cae.LogDateTime >= DATEADD(minute, -{minutes_back}, GETUTCDATE())
        ORDER BY cae.LogDateTime DESC
    """)
    failures = cursor.fetchall()
    log(f'  FailedCopyActivity (last {minutes_back} min): {len(failures)}')
    for f in failures[:20]:
        ds_info = f'DS{f[5]}' if f[5] else '?'
        log(f'    EntityId={f[1]} {f[4] or f[0]} ({ds_info}): {str(f[3])[:150]}')

    # Copy activity summary
    cursor.execute(f"""
        SELECT LogType, COUNT(*) as cnt
        FROM logging.CopyActivityExecution
        WHERE LogDateTime >= DATEADD(minute, -{minutes_back}, GETUTCDATE())
        GROUP BY LogType
    """)
    for r in cursor.fetchall():
        log(f'  CopyActivity {r[0]}: {r[1]}')

    # PipelineLandingzoneEntity status
    cursor.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN IsProcessed = 1 THEN 1 ELSE 0 END) as processed,
               SUM(CASE WHEN IsProcessed = 0 THEN 1 ELSE 0 END) as unprocessed
        FROM execution.PipelineLandingzoneEntity
    """)
    r = cursor.fetchone()
    log(f'  PipelineLandingzoneEntity: {r[0]} total, {r[1]} processed, {r[2]} unprocessed')

    cursor.close()
    return len(failures)


def show_entity_counts(conn, label):
    """Show entity counts per datasource."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ds.DataSourceId, ds.Namespace,
               COUNT(*) as total,
               SUM(CASE WHEN le.IsActive=1 THEN 1 ELSE 0 END) as active
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.DataSourceId, ds.Namespace
        ORDER BY ds.DataSourceId
    """)
    log(f'  Entity counts ({label}):')
    for r in cursor.fetchall():
        log(f'    DS {r[0]} ({r[1]}): {r[3]}/{r[2]} active')
    cursor.close()


def main():
    output = []
    start_time = time.time()

    log('=' * 70)
    log('OPTIVA FULL MEDALLION LOAD: LZ -> Bronze -> Silver')
    log('=' * 70)

    # ================================================================
    # STEP 1: Deactivate non-OPTIVA + OOM entities
    # ================================================================
    log('')
    log('STEP 1: Isolating OPTIVA entities...')
    conn = get_sql_conn()
    cursor = conn.cursor()

    # Show current state
    show_entity_counts(conn, 'before isolation')

    # Count what's active in OPTIVA view currently
    cursor.execute("""
        SELECT COUNT(*) FROM execution.vw_LoadSourceToLandingzone
    """)
    view_count = cursor.fetchone()[0]
    log(f'  View vw_LoadSourceToLandingzone currently returns: {view_count} entities')

    # Deactivate non-OPTIVA
    cursor.execute(f"UPDATE integration.LandingzoneEntity SET IsActive = 0 WHERE DataSourceId != {OPTIVA_DS}")
    non_optiva_deactivated = cursor.rowcount
    conn.commit()
    log(f'  Deactivated {non_optiva_deactivated} non-OPTIVA entities')

    # Deactivate OOM OPTIVA entities
    oom_ids = ','.join(str(x) for x in OOM_ENTITIES)
    cursor.execute(f"UPDATE integration.LandingzoneEntity SET IsActive = 0 WHERE LandingzoneEntityId IN ({oom_ids})")
    oom_deactivated = cursor.rowcount
    conn.commit()
    log(f'  Deactivated {oom_deactivated} OOM OPTIVA entities')

    # Verify view now only shows OPTIVA
    cursor.execute("SELECT COUNT(*) FROM execution.vw_LoadSourceToLandingzone")
    view_count_after = cursor.fetchone()[0]
    log(f'  View now returns: {view_count_after} entities (should be ~477)')

    # Double-check by datasource
    cursor.execute("""
        SELECT DataSourceId, COUNT(*) as cnt
        FROM execution.vw_LoadSourceToLandingzone
        GROUP BY DataSourceId
    """)
    for r in cursor.fetchall():
        log(f'    DS {r[0]}: {r[1]} entities in view')

    show_entity_counts(conn, 'after isolation')
    output.append(f'Deactivated {non_optiva_deactivated} non-OPTIVA + {oom_deactivated} OOM entities')
    output.append(f'View entity count: {view_count} -> {view_count_after}')

    # ================================================================
    # STEP 2: Clean stale PipelineLandingzoneEntity
    # ================================================================
    log('')
    log('STEP 2: Cleaning stale PipelineLandingzoneEntity records...')

    cursor.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN IsProcessed = 1 THEN 1 ELSE 0 END) as processed,
               SUM(CASE WHEN IsProcessed = 0 THEN 1 ELSE 0 END) as unprocessed
        FROM execution.PipelineLandingzoneEntity
    """)
    r = cursor.fetchone()
    log(f'  Before: {r[0]} total, {r[1]} processed, {r[2]} unprocessed')

    cursor.execute("DELETE FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 0")
    deleted = cursor.rowcount
    conn.commit()
    log(f'  Deleted {deleted} stale unprocessed entries')
    output.append(f'Cleaned {deleted} stale PipelineLandingzoneEntity entries')

    # ================================================================
    # STEP 3: Verify timestamp/rowversion incremental fix
    # ================================================================
    log('')
    log('STEP 3: Verifying incremental column fixes...')

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
    bad_incr = cursor.fetchall()
    if bad_incr:
        log(f'  WARNING: Found {len(bad_incr)} entities still with timestamp/rowversion incremental columns!')
        for e in bad_incr:
            log(f'    LzId={e[0]} {e[3]}/{e[1]} -> {e[2]}')
        ids = ','.join(str(e[0]) for e in bad_incr)
        cursor.execute(f"""
            UPDATE integration.LandingzoneEntity
            SET IsIncremental = 0, IsIncrementalColumn = NULL
            WHERE LandingzoneEntityId IN ({ids})
        """)
        conn.commit()
        log(f'  Fixed {cursor.rowcount} entities')
        output.append(f'Fixed {cursor.rowcount} remaining timestamp/rowversion incremental columns')
    else:
        log('  All clear - no timestamp/rowversion incremental columns found')
        output.append('Timestamp/rowversion incremental columns: already fixed')

    # Show OPTIVA incremental status
    cursor.execute(f"""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN IsIncremental = 1 THEN 1 ELSE 0 END) as incremental,
               SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) as active
        FROM integration.LandingzoneEntity
        WHERE DataSourceId = {OPTIVA_DS}
    """)
    r = cursor.fetchone()
    log(f'  OPTIVA: {r[0]} total, {r[2]} active, {r[1]} incremental')

    cursor.close()
    conn.close()

    # ================================================================
    # STEP 4: Trigger and monitor LZ pipeline
    # ================================================================
    try:
        log('')
        log('=' * 60)
        log('TRIGGERING LZ PIPELINE (OPTIVA only)')
        log('=' * 60)

        sc, resp = trigger_pipeline(LZ_PIPELINE)
        log(f'  Trigger response: {sc}')

        if sc == 202:
            log('  Pipeline triggered successfully!')
            output.append('LZ pipeline triggered: 202')
        elif sc == 409:
            log('  Pipeline already running (409). Monitoring existing run...')
            output.append('LZ pipeline already running: 409')
        else:
            log(f'  ERROR: {resp.decode()[:500]}')
            output.append(f'LZ trigger ERROR: {sc}')
            raise Exception(f'LZ trigger failed: {sc}')

        lz_status, lz_job = monitor_pipeline(LZ_PIPELINE, 'LZ', TIMEOUT_MINUTES)
        output.append(f'LZ Pipeline: {lz_status}')

        conn2 = get_sql_conn()
        fail_count = investigate(conn2, 'LZ')

        if lz_status != 'Completed':
            log(f'LZ pipeline: {lz_status}')
            if fail_count == 0:
                log('  No FailedCopyActivity entries - might be a timeout or transient issue')
            conn2.close()
            raise Exception(f'LZ pipeline {lz_status}')

        log('LZ PIPELINE COMPLETED SUCCESSFULLY!')

        # ================================================================
        # STEP 5: Clean for Bronze, then trigger
        # ================================================================
        log('')
        log('=' * 60)
        log('TRIGGERING BRONZE PIPELINE')
        log('=' * 60)

        # Bronze view filters on PipelineLandingzoneEntity.IsProcessed = 0
        # The LZ pipeline should have created new entries. Verify:
        cursor2 = conn2.cursor()
        cursor2.execute("""
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN IsProcessed = 0 THEN 1 ELSE 0 END) as unprocessed
            FROM execution.PipelineLandingzoneEntity
        """)
        r = cursor2.fetchone()
        log(f'  PipelineLandingzoneEntity: {r[0]} total, {r[1]} unprocessed (Bronze input)')
        cursor2.close()
        conn2.close()

        sc, resp = trigger_pipeline(BRONZE_PIPELINE)
        log(f'  Trigger response: {sc}')
        output.append(f'Bronze triggered: {sc}')

        if sc not in (202, 409):
            log(f'  ERROR: {resp.decode()[:500]}')
            raise Exception(f'Bronze trigger failed: {sc}')

        brz_status, brz_job = monitor_pipeline(BRONZE_PIPELINE, 'Bronze', 60)
        output.append(f'Bronze Pipeline: {brz_status}')

        conn3 = get_sql_conn()
        investigate(conn3, 'Bronze')

        if brz_status != 'Completed':
            log(f'Bronze pipeline: {brz_status}')
            conn3.close()
            raise Exception(f'Bronze pipeline {brz_status}')

        log('BRONZE PIPELINE COMPLETED SUCCESSFULLY!')

        # ================================================================
        # STEP 6: Trigger Silver
        # ================================================================
        log('')
        log('=' * 60)
        log('TRIGGERING SILVER PIPELINE')
        log('=' * 60)

        # Verify Bronze created entries for Silver
        cursor3 = conn3.cursor()
        cursor3.execute("""
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN IsProcessed = 0 THEN 1 ELSE 0 END) as unprocessed
            FROM execution.PipelineBronzeLayerEntity
        """)
        r = cursor3.fetchone()
        log(f'  PipelineBronzeLayerEntity: {r[0]} total, {r[1]} unprocessed (Silver input)')
        cursor3.close()
        conn3.close()

        sc, resp = trigger_pipeline(SILVER_PIPELINE)
        log(f'  Trigger response: {sc}')
        output.append(f'Silver triggered: {sc}')

        if sc not in (202, 409):
            log(f'  ERROR: {resp.decode()[:500]}')
            raise Exception(f'Silver trigger failed: {sc}')

        slv_status, slv_job = monitor_pipeline(SILVER_PIPELINE, 'Silver', TIMEOUT_MINUTES)
        output.append(f'Silver Pipeline: {slv_status}')

        conn4 = get_sql_conn()
        investigate(conn4, 'Silver')
        conn4.close()

        if slv_status == 'Completed':
            log('')
            log('*' * 60)
            log('ALL THREE LAYERS LOADED SUCCESSFULLY!')
            log('*' * 60)
        else:
            log(f'Silver pipeline: {slv_status}')

    except Exception as e:
        log(f'Pipeline error: {e}')
        output.append(f'Error: {e}')

    finally:
        # ================================================================
        # ALWAYS: Reactivate entities (except OOM)
        # ================================================================
        log('')
        log('REACTIVATING all entities (except 3 OOM)...')
        try:
            conn = get_sql_conn()
            cursor = conn.cursor()
            cursor.execute(f"""
                UPDATE integration.LandingzoneEntity
                SET IsActive = 1
                WHERE IsActive = 0 AND LandingzoneEntityId NOT IN ({oom_ids})
            """)
            reactivated = cursor.rowcount
            conn.commit()
            log(f'  Reactivated {reactivated} entities')
            output.append(f'Reactivated {reactivated} entities')

            show_entity_counts(conn, 'after reactivation')
            cursor.close()
            conn.close()
        except Exception as e:
            log(f'  CRITICAL: Reactivation error: {e}')
            output.append(f'CRITICAL: Reactivation error: {e}')

    # ================================================================
    # Write results
    # ================================================================
    total_time = int(time.time() - start_time)
    log(f'\nTotal elapsed: {total_time // 60}m{total_time % 60}s')

    with open('scripts/optiva_full_load_results.txt', 'w') as f:
        f.write(f'OPTIVA Full Medallion Load Results\n{"=" * 50}\n')
        f.write(f'Time: {datetime.now(timezone.utc).isoformat()}\n')
        f.write(f'Duration: {total_time // 60}m{total_time % 60}s\n\n')
        for line in output:
            f.write(f'{line}\n')
    log('Results written to scripts/optiva_full_load_results.txt')


if __name__ == '__main__':
    main()
