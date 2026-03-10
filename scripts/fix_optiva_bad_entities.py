"""
Fix OPTIVA Bad Entities: Deactivate 168 entities with UserErrorInvalidTableName
================================================================================
These entities exist in OPTIVA's schema catalog but the Fabric gateway can't
reach them at the LK_GET_LASTLOADDATE step. Deactivate them, clean stale entries,
and re-trigger the full LZ -> Bronze -> Silver pipeline.
"""
import urllib.request, json, struct, time, pyodbc
from datetime import datetime, timezone

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
SQL_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
SQL_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
WS = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
LZ_PIPELINE = '3d0b3b2b-a069-40dc-b735-d105f9e66838'
BRONZE_PIPELINE = '8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3'
SILVER_PIPELINE = '90c0535c-c5dc-43a3-b51e-c44ef1808a60'
OOM_ENTITIES = [1386, 1389, 1451]
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


def investigate(conn, layer_name):
    cursor = conn.cursor()
    log(f'=== {layer_name} Post-Run Investigation ===')
    cursor.execute("""
        SELECT LogType, COUNT(*) FROM logging.CopyActivityExecution
        WHERE LogDateTime >= DATEADD(minute, -70, GETUTCDATE())
        GROUP BY LogType ORDER BY LogType
    """)
    for r in cursor.fetchall():
        log(f'  {r[0]}: {r[1]}')

    cursor.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN IsProcessed = 1 THEN 1 ELSE 0 END) as processed,
               SUM(CASE WHEN IsProcessed = 0 THEN 1 ELSE 0 END) as unprocessed
        FROM execution.PipelineLandingzoneEntity
    """)
    r = cursor.fetchone()
    log(f'  PipelineLandingzoneEntity: {r[0]} total, {r[1]} processed, {r[2]} unprocessed')

    # Check for any NEW failures
    cursor.execute("""
        SELECT cae.EntityId, le.SourceName,
               LEFT(CAST(cae.LogData AS NVARCHAR(MAX)), 200)
        FROM logging.CopyActivityExecution cae
        LEFT JOIN integration.LandingzoneEntity le ON cae.EntityId = le.LandingzoneEntityId
        WHERE cae.LogType = 'FailedCopyActivity'
        AND cae.LogDateTime >= DATEADD(minute, -70, GETUTCDATE())
        ORDER BY cae.LogDateTime DESC
    """)
    failures = cursor.fetchall()
    if failures:
        log(f'  FailedCopyActivity: {len(failures)}')
        for f in failures[:10]:
            log(f'    EntityId={f[0]} {f[1]}: {str(f[2])[:150]}')
    else:
        log('  No FailedCopyActivity entries!')

    cursor.close()
    return len(failures) if failures else 0


def main():
    output = []
    start_time = time.time()

    log('=' * 70)
    log('FIX OPTIVA BAD ENTITIES + RE-RUN FULL PIPELINE')
    log('=' * 70)

    # ================================================================
    # STEP 1: Find and deactivate entities that failed with InvalidTableName
    # ================================================================
    log('')
    log('STEP 1: Finding entities that failed with UserErrorInvalidTableName...')
    conn = get_sql_conn()
    cursor = conn.cursor()

    # Get all OPTIVA entities that failed with InvalidTableName in recent runs
    cursor.execute("""
        SELECT DISTINCT cae.EntityId
        FROM logging.CopyActivityExecution cae
        JOIN integration.LandingzoneEntity le ON cae.EntityId = le.LandingzoneEntityId
        WHERE cae.LogType = 'FailedCopyActivity'
        AND le.DataSourceId = 8
        AND CAST(cae.LogData AS NVARCHAR(MAX)) LIKE '%UserErrorInvalidTableName%'
        AND cae.LogDateTime >= DATEADD(hour, -6, GETUTCDATE())
    """)
    bad_entity_ids = [row[0] for row in cursor.fetchall()]
    log(f'  Found {len(bad_entity_ids)} OPTIVA entities with InvalidTableName errors')

    # Also get OOM entities
    cursor.execute("""
        SELECT DISTINCT cae.EntityId
        FROM logging.CopyActivityExecution cae
        JOIN integration.LandingzoneEntity le ON cae.EntityId = le.LandingzoneEntityId
        WHERE cae.LogType = 'FailedCopyActivity'
        AND le.DataSourceId = 8
        AND CAST(cae.LogData AS NVARCHAR(MAX)) LIKE '%OutOfMemory%'
        AND cae.LogDateTime >= DATEADD(hour, -6, GETUTCDATE())
    """)
    oom_ids = [row[0] for row in cursor.fetchall()]
    log(f'  Found {len(oom_ids)} OPTIVA entities with OOM errors')

    # Combine all bad entities
    all_bad = list(set(bad_entity_ids + oom_ids + OOM_ENTITIES))
    log(f'  Total entities to deactivate: {len(all_bad)}')

    if all_bad:
        ids_str = ','.join(str(x) for x in all_bad)
        # Show some of the bad entities
        cursor.execute(f"""
            SELECT LandingzoneEntityId, SourceName, SourceSchema
            FROM integration.LandingzoneEntity
            WHERE LandingzoneEntityId IN ({ids_str})
            ORDER BY SourceName
        """)
        for r in cursor.fetchall():
            log(f'    LzId={r[0]} {r[2]}.{r[1]}')

        # Deactivate them
        cursor.execute(f"""
            UPDATE integration.LandingzoneEntity
            SET IsActive = 0
            WHERE LandingzoneEntityId IN ({ids_str})
        """)
        deactivated = cursor.rowcount
        conn.commit()
        log(f'  Deactivated {deactivated} bad OPTIVA entities')
        output.append(f'Deactivated {deactivated} bad OPTIVA entities (InvalidTableName + OOM)')

    # ================================================================
    # STEP 2: Deactivate non-OPTIVA entities
    # ================================================================
    log('')
    log('STEP 2: Deactivating non-OPTIVA entities...')
    cursor.execute(f"UPDATE integration.LandingzoneEntity SET IsActive = 0 WHERE DataSourceId != {OPTIVA_DS}")
    non_optiva = cursor.rowcount
    conn.commit()
    log(f'  Deactivated {non_optiva} non-OPTIVA entities')

    # Show what's left active
    cursor.execute("""
        SELECT COUNT(*) as active FROM integration.LandingzoneEntity WHERE IsActive = 1
    """)
    active_count = cursor.fetchone()[0]
    log(f'  Remaining active OPTIVA entities: {active_count}')
    output.append(f'Active OPTIVA entities for this run: {active_count}')

    # Verify via view
    cursor.execute("SELECT COUNT(*) FROM execution.vw_LoadSourceToLandingzone")
    view_count = cursor.fetchone()[0]
    log(f'  View returns: {view_count} entities')

    # ================================================================
    # STEP 3: Clean stale PipelineLandingzoneEntity
    # ================================================================
    log('')
    log('STEP 3: Cleaning stale PipelineLandingzoneEntity...')
    cursor.execute("DELETE FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 0")
    deleted = cursor.rowcount
    conn.commit()
    log(f'  Deleted {deleted} unprocessed entries')
    output.append(f'Cleaned {deleted} stale entries')

    cursor.close()
    conn.close()

    # ================================================================
    # STEP 4: Trigger and monitor LZ -> Bronze -> Silver
    # ================================================================
    all_bad_ids_str = ','.join(str(x) for x in all_bad) if all_bad else ''

    try:
        log('')
        log('=' * 60)
        log(f'TRIGGERING LZ PIPELINE ({active_count} OPTIVA entities)')
        log('=' * 60)

        sc, resp = trigger_pipeline(LZ_PIPELINE)
        log(f'  Trigger: {sc}')
        output.append(f'LZ triggered: {sc}')

        if sc not in (202, 409):
            raise Exception(f'LZ trigger failed: {sc}')

        lz_status, _ = monitor_pipeline(LZ_PIPELINE, 'LZ', TIMEOUT_MINUTES)
        output.append(f'LZ Pipeline: {lz_status}')

        conn2 = get_sql_conn()
        fail_count = investigate(conn2, 'LZ')

        if lz_status != 'Completed':
            conn2.close()
            raise Exception(f'LZ pipeline {lz_status} ({fail_count} failures)')

        log('LZ PIPELINE COMPLETED!')

        # ---- BRONZE ----
        log('')
        log('=' * 60)
        log('TRIGGERING BRONZE PIPELINE')
        log('=' * 60)

        cursor2 = conn2.cursor()
        cursor2.execute("SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 0")
        unprocessed = cursor2.fetchone()[0]
        log(f'  Bronze input: {unprocessed} unprocessed PipelineLandingzoneEntity entries')
        cursor2.close()
        conn2.close()

        sc, resp = trigger_pipeline(BRONZE_PIPELINE)
        log(f'  Trigger: {sc}')
        output.append(f'Bronze triggered: {sc}')

        if sc not in (202, 409):
            raise Exception(f'Bronze trigger failed: {sc}')

        brz_status, _ = monitor_pipeline(BRONZE_PIPELINE, 'Bronze', 60)
        output.append(f'Bronze Pipeline: {brz_status}')

        conn3 = get_sql_conn()
        investigate(conn3, 'Bronze')

        if brz_status != 'Completed':
            conn3.close()
            raise Exception(f'Bronze pipeline {brz_status}')

        log('BRONZE PIPELINE COMPLETED!')

        # ---- SILVER ----
        log('')
        log('=' * 60)
        log('TRIGGERING SILVER PIPELINE')
        log('=' * 60)

        cursor3 = conn3.cursor()
        cursor3.execute("""
            SELECT COUNT(*) FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 0
        """)
        unprocessed = cursor3.fetchone()[0]
        log(f'  Silver input: {unprocessed} unprocessed PipelineBronzeLayerEntity entries')
        cursor3.close()
        conn3.close()

        sc, resp = trigger_pipeline(SILVER_PIPELINE)
        log(f'  Trigger: {sc}')
        output.append(f'Silver triggered: {sc}')

        if sc not in (202, 409):
            raise Exception(f'Silver trigger failed: {sc}')

        slv_status, _ = monitor_pipeline(SILVER_PIPELINE, 'Silver', TIMEOUT_MINUTES)
        output.append(f'Silver Pipeline: {slv_status}')

        conn4 = get_sql_conn()
        investigate(conn4, 'Silver')
        conn4.close()

        if slv_status == 'Completed':
            log('')
            log('*' * 60)
            log('ALL THREE LAYERS LOADED SUCCESSFULLY!')
            log(f'OPTIVA entities loaded: {active_count}')
            log('*' * 60)
        else:
            log(f'Silver pipeline: {slv_status}')

    except Exception as e:
        log(f'Pipeline error: {e}')
        output.append(f'Error: {e}')

    finally:
        # ALWAYS reactivate
        log('')
        log('REACTIVATING all entities (except bad OPTIVA)...')
        try:
            conn = get_sql_conn()
            cursor = conn.cursor()
            if all_bad_ids_str:
                cursor.execute(f"""
                    UPDATE integration.LandingzoneEntity
                    SET IsActive = 1
                    WHERE IsActive = 0 AND LandingzoneEntityId NOT IN ({all_bad_ids_str})
                """)
            else:
                cursor.execute("UPDATE integration.LandingzoneEntity SET IsActive = 1 WHERE IsActive = 0")
            reactivated = cursor.rowcount
            conn.commit()
            log(f'  Reactivated {reactivated} entities')
            output.append(f'Reactivated {reactivated} entities')

            cursor.execute("""
                SELECT ds.DataSourceId, ds.Namespace,
                       SUM(CASE WHEN le.IsActive=1 THEN 1 ELSE 0 END) as active,
                       COUNT(*) as total
                FROM integration.LandingzoneEntity le
                JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
                GROUP BY ds.DataSourceId, ds.Namespace ORDER BY ds.DataSourceId
            """)
            for r in cursor.fetchall():
                log(f'  DS {r[0]} ({r[1]}): {r[2]}/{r[3]} active')
            cursor.close()
            conn.close()
        except Exception as e:
            log(f'  CRITICAL: Reactivation error: {e}')

    total_time = int(time.time() - start_time)
    log(f'\nTotal elapsed: {total_time // 60}m{total_time % 60}s')

    with open('scripts/optiva_fix_bad_entities_results.txt', 'w') as f:
        f.write(f'OPTIVA Fix Bad Entities + Full Pipeline Results\n{"=" * 50}\n')
        f.write(f'Time: {datetime.now(timezone.utc).isoformat()}\n')
        f.write(f'Duration: {total_time // 60}m{total_time % 60}s\n\n')
        for line in output:
            f.write(f'{line}\n')
    log('Results written to scripts/optiva_fix_bad_entities_results.txt')


if __name__ == '__main__':
    main()
