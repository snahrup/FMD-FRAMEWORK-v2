#!/usr/bin/env python3
"""
OPTIVA LZ Pipeline Retry — Error Investigation + Selective Deactivation + Retry
================================================================================
Phase 0: Investigate ALL errors from most recent OPTIVA LZ run
Phase 1: Deactivate consistently failing entities
Phase 2: Deactivate non-OPTIVA sources
Phase 3: Trigger & monitor LZ pipeline (OPTIVA only)
Phase 4: Reactivate all sources (ALWAYS runs via try/finally)

Results written to scripts/optiva_lz_retry_results.txt
"""
import urllib.request, urllib.parse, urllib.error, json, struct, pyodbc, time, sys, os
from datetime import datetime, timezone

# ── Configuration ──────────────────────────────────────────────────────────────
TENANT   = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT   = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET   = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
CODE_WS  = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
SQL_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
SQL_DB   = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'

LZ_PIPELINE_GUID = '3d0b3b2b-a069-40dc-b735-d105f9e66838'
OPTIVA_DS_ID = 8

POLL_INTERVAL_SECS = 30
MAX_WAIT_MINS = 90

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_FILE = os.path.join(SCRIPT_DIR, 'optiva_lz_retry_results.txt')

# Known problematic entities (from user report)
KNOWN_BAD = {'alel_product_target_tbl', 'x_archiveOptiva'}

# ── Logging ────────────────────────────────────────────────────────────────────
results_log = []

def log(msg):
    ts = datetime.now(timezone.utc).strftime('%H:%M:%S UTC')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    results_log.append(line)

def log_section(title):
    log('')
    log('=' * 70)
    log(f'  {title}')
    log('=' * 70)

# ── Auth Helpers ───────────────────────────────────────────────────────────────
def get_token(scope='https://api.fabric.microsoft.com/.default'):
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials', 'client_id': CLIENT,
        'client_secret': SECRET, 'scope': scope,
    }).encode()
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    return json.loads(urllib.request.urlopen(req).read())['access_token']

def connect_sql():
    """Connect to Fabric SQL DB with SP token."""
    token = get_token('https://database.windows.net/.default')
    tb = token.encode('UTF-16-LE')
    ts = struct.pack(f'<I{len(tb)}s', len(tb), tb)
    return pyodbc.connect(
        f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SQL_SERVER};DATABASE={SQL_DB};'
        f'Encrypt=yes;TrustServerCertificate=no',
        attrs_before={1256: ts})

def fabric_api(token, method, url, data=None):
    """Call Fabric REST API. Returns (status_code, response_dict, headers)."""
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    req = urllib.request.Request(url, method=method, headers=headers)
    if data is not None:
        req.data = json.dumps(data).encode() if isinstance(data, dict) else data
    elif method == 'POST':
        req.data = b'{}'
    try:
        resp = urllib.request.urlopen(req)
        body = resp.read().decode('utf-8', errors='replace')
        return resp.status, json.loads(body) if body.strip() else {}, resp.headers
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {'raw': body[:1000]}
        return e.code, parsed, e.headers

# ── Query Helpers ──────────────────────────────────────────────────────────────
def run_query(cursor, sql, params=None):
    """Execute query and return (columns, rows)."""
    if params:
        cursor.execute(sql, params)
    else:
        cursor.execute(sql)
    if cursor.description:
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        return cols, rows
    return [], []

def print_table(cols, rows, max_col=60):
    """Print a formatted table."""
    if not cols or not rows:
        log('  (no data)')
        return
    def trunc(v, m):
        s = str(v) if v is not None else 'NULL'
        return s[:m-3]+'...' if len(s) > m else s
    widths = [min(max(len(c), max((len(trunc(r[i], max_col)) for r in rows), default=0)), max_col) for i, c in enumerate(cols)]
    hdr = ' | '.join(c.ljust(w) for c, w in zip(cols, widths))
    div = '-+-'.join('-'*w for w in widths)
    log(f'  {hdr}')
    log(f'  {div}')
    for row in rows:
        line = ' | '.join(trunc(v, max_col).ljust(w) for v, w in zip(row, widths))
        log(f'  {line}')
    log(f'  ({len(rows)} rows)')

def write_results():
    """Write accumulated log to results file."""
    with open(RESULTS_FILE, 'w', encoding='utf-8') as f:
        f.write('OPTIVA LZ Pipeline Retry — Full Results\n')
        f.write('=' * 60 + '\n')
        f.write(f'Generated: {datetime.now(timezone.utc).isoformat()}\n\n')
        for line in results_log:
            f.write(line + '\n')
    log(f'Results written to {RESULTS_FILE}')


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN EXECUTION
# ══════════════════════════════════════════════════════════════════════════════
overall_start = time.time()
final_status = 'UNKNOWN'
bad_entity_ids = []  # LandingzoneEntityIds to keep deactivated
non_optiva_deactivated = False

log_section('OPTIVA LZ PIPELINE RETRY')
log(f'Start time: {datetime.now(timezone.utc).isoformat()}')
log(f'Known bad entities: {KNOWN_BAD}')

# ── Connect to SQL ─────────────────────────────────────────────────────────
log('\nConnecting to Fabric SQL DB...')
conn = connect_sql()
conn.autocommit = False
cursor = conn.cursor()
log('Connected.')

try:
    # ══════════════════════════════════════════════════════════════════════════
    #  PHASE 0: INVESTIGATE ERRORS
    # ══════════════════════════════════════════════════════════════════════════
    log_section('PHASE 0: ERROR INVESTIGATION')

    # 0a. Check logging.CopyActivityExecution for OPTIVA errors
    log('\n--- 0a. CopyActivityExecution — All OPTIVA entries (most recent first) ---')
    try:
        cols, rows = run_query(cursor, """
            SELECT TOP 50 *
            FROM logging.CopyActivityExecution
            ORDER BY 1 DESC
        """)
        if rows:
            log(f'  Found {len(rows)} CopyActivityExecution records.')
            log(f'  Columns: {cols}')
            print_table(cols, rows)
        else:
            log('  No CopyActivityExecution records found.')
    except Exception as e:
        log(f'  CopyActivityExecution query failed: {e}')

    # 0b. Check logging.PipelineExecution for LZ errors
    log('\n--- 0b. PipelineExecution — Recent LZ entries with errors ---')
    try:
        cols, rows = run_query(cursor, """
            SELECT TOP 50
                PipelineName, EntityId, EntityLayer, LogType, LogDateTime,
                LEFT(LogData, 500) AS LogData
            FROM logging.PipelineExecution
            WHERE PipelineName LIKE '%Landing%' OR PipelineName LIKE '%LZ%'
            ORDER BY LogDateTime DESC
        """)
        if rows:
            print_table(cols, rows)
        else:
            log('  No LZ pipeline execution logs found.')
    except Exception as e:
        log(f'  PipelineExecution query failed: {e}')

    # 0c. Check execution.PipelineLandingzoneEntity for OPTIVA processing status
    log('\n--- 0c. PipelineLandingzoneEntity — OPTIVA entities status ---')
    try:
        cols, rows = run_query(cursor, """
            SELECT ple.PipelineLandingzoneEntityId, ple.LandingzoneEntityId,
                   le.SourceSchema, le.SourceName,
                   ple.FileName, ple.FilePath,
                   ple.InsertDateTime, ple.LoadEndDateTime,
                   ple.IsProcessed
            FROM execution.PipelineLandingzoneEntity ple
            JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
            WHERE le.DataSourceId = 8
            ORDER BY ple.InsertDateTime DESC
        """)
        if rows:
            total = len(rows)
            processed = sum(1 for r in rows if r[8] == 1 or r[8] == True)
            unprocessed = total - processed
            log(f'  OPTIVA LZ entities tracked: {total} (processed={processed}, unprocessed={unprocessed})')
            print_table(cols, rows[:30])  # Show first 30
        else:
            log('  No OPTIVA PipelineLandingzoneEntity records found.')
    except Exception as e:
        log(f'  PipelineLandingzoneEntity query failed: {e}')

    # 0d. Check for entities that have errors in LogData
    log('\n--- 0d. PipelineExecution — ALL error-type logs for recent LZ runs ---')
    try:
        cols, rows = run_query(cursor, """
            SELECT TOP 100
                EntityId, EntityLayer, LogType, PipelineName, LogDateTime,
                LEFT(LogData, 800) AS LogData
            FROM logging.PipelineExecution
            WHERE LogType IN ('Error', 'error', 'Failed', 'failed', 'Failure', 'Warning')
               OR LogData LIKE '%error%'
               OR LogData LIKE '%fail%'
            ORDER BY LogDateTime DESC
        """)
        if rows:
            log(f'  Found {len(rows)} error-related pipeline log entries.')
            print_table(cols, rows)
        else:
            log('  No error-type pipeline log entries found.')
    except Exception as e:
        log(f'  Error log query failed: {e}')

    # 0e. Check ALL LogType values to understand what's available
    log('\n--- 0e. PipelineExecution — Distinct LogType values ---')
    try:
        cols, rows = run_query(cursor, """
            SELECT LogType, COUNT(*) as cnt
            FROM logging.PipelineExecution
            GROUP BY LogType
            ORDER BY cnt DESC
        """)
        if rows:
            print_table(cols, rows)
        else:
            log('  No PipelineExecution records at all.')
    except Exception as e:
        log(f'  LogType query failed: {e}')

    # 0f. Get FULL PipelineExecution logs for OPTIVA entities specifically
    log('\n--- 0f. PipelineExecution — ALL logs referencing OPTIVA entity IDs ---')
    try:
        # First get all OPTIVA LZ entity IDs
        cursor.execute("""
            SELECT LandingzoneEntityId, SourceName
            FROM integration.LandingzoneEntity
            WHERE DataSourceId = 8
        """)
        optiva_entities = cursor.fetchall()
        optiva_entity_ids = [r[0] for r in optiva_entities]
        log(f'  Total OPTIVA LZ entities registered: {len(optiva_entity_ids)}')

        if optiva_entity_ids:
            # Query pipeline logs for these entity IDs
            placeholders = ','.join(['?' for _ in optiva_entity_ids])
            cols, rows = run_query(cursor, f"""
                SELECT TOP 200
                    EntityId, EntityLayer, LogType, PipelineName, LogDateTime,
                    LEFT(LogData, 800) AS LogData
                FROM logging.PipelineExecution
                WHERE EntityId IN ({placeholders})
                ORDER BY LogDateTime DESC
            """, optiva_entity_ids)
            if rows:
                log(f'  Found {len(rows)} pipeline logs for OPTIVA entities.')
                print_table(cols, rows)
            else:
                log('  No pipeline execution logs found for any OPTIVA entity IDs.')
    except Exception as e:
        log(f'  OPTIVA entity log query failed: {e}')

    # 0g. Check the source queries for the two known-bad entities
    log('\n--- 0g. Source config for known-bad entities ---')
    try:
        cols, rows = run_query(cursor, """
            SELECT LandingzoneEntityId, DataSourceId, SourceSchema, SourceName,
                   FileName, FilePath, FileType,
                   IsIncremental, IsIncrementalColumn, IsActive,
                   LEFT(SourceCustomSelect, 300) AS SourceCustomSelect,
                   CustomNotebookName
            FROM integration.LandingzoneEntity
            WHERE DataSourceId = 8
              AND SourceName IN ('alel_product_target_tbl', 'x_archiveOptiva')
        """)
        if rows:
            print_table(cols, rows)
            for row in rows:
                bad_entity_ids.append(row[0])  # LandingzoneEntityId
                log(f'  -> Entity ID {row[0]}: {row[2]}.{row[3]} (IsActive={row[9]})')
        else:
            log('  Known-bad entities NOT found in LandingzoneEntity table!')
    except Exception as e:
        log(f'  Source config query failed: {e}')

    # 0h. Look at ALL OPTIVA entities to check for other potential failures
    log('\n--- 0h. Full OPTIVA entity listing (integration.LandingzoneEntity) ---')
    try:
        cols, rows = run_query(cursor, """
            SELECT LandingzoneEntityId, SourceSchema, SourceName, FileName,
                   IsIncremental, IsActive
            FROM integration.LandingzoneEntity
            WHERE DataSourceId = 8
            ORDER BY SourceName
        """)
        if rows:
            active = sum(1 for r in rows if r[5] == 1 or r[5] == True)
            log(f'  Total OPTIVA entities: {len(rows)} (active={active})')
            print_table(cols, rows)
        else:
            log('  No OPTIVA entities found!')
    except Exception as e:
        log(f'  Full listing query failed: {e}')

    # 0i. Cross-check: Are there ANY CopyActivity error records with entity names?
    log('\n--- 0i. CopyActivityExecution — Schema exploration ---')
    try:
        cursor.execute("""
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'logging' AND TABLE_NAME = 'CopyActivityExecution'
            ORDER BY ORDINAL_POSITION
        """)
        schema_rows = cursor.fetchall()
        if schema_rows:
            log('  CopyActivityExecution columns:')
            for r in schema_rows:
                log(f'    {r[0]} ({r[1]})')
        else:
            log('  CopyActivityExecution table not found in INFORMATION_SCHEMA.')
    except Exception as e:
        log(f'  Schema query failed: {e}')

    # 0j. Check execution.PipelineLandingzoneEntity schema
    log('\n--- 0j. PipelineLandingzoneEntity — Schema exploration ---')
    try:
        cursor.execute("""
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'PipelineLandingzoneEntity'
            ORDER BY ORDINAL_POSITION
        """)
        schema_rows = cursor.fetchall()
        if schema_rows:
            log('  PipelineLandingzoneEntity columns:')
            for r in schema_rows:
                log(f'    {r[0]} ({r[1]})')
        else:
            log('  PipelineLandingzoneEntity not found in INFORMATION_SCHEMA.')
    except Exception as e:
        log(f'  Schema query failed: {e}')

    # 0k. Check PipelineExecution schema
    log('\n--- 0k. PipelineExecution — Schema exploration ---')
    try:
        cursor.execute("""
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'logging' AND TABLE_NAME = 'PipelineExecution'
            ORDER BY ORDINAL_POSITION
        """)
        schema_rows = cursor.fetchall()
        if schema_rows:
            log('  PipelineExecution columns:')
            for r in schema_rows:
                log(f'    {r[0]} ({r[1]})')
    except Exception as e:
        log(f'  Schema query failed: {e}')

    # 0l. Overall success/fail summary from latest LZ run
    log('\n--- 0l. Overall LZ processing summary (all sources) ---')
    try:
        cols, rows = run_query(cursor, """
            SELECT ds.Namespace,
                   COUNT(*) as Total,
                   SUM(CASE WHEN ple.IsProcessed = 1 THEN 1 ELSE 0 END) as Processed,
                   SUM(CASE WHEN ple.IsProcessed = 0 THEN 1 ELSE 0 END) as Unprocessed
            FROM execution.PipelineLandingzoneEntity ple
            JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            GROUP BY ds.Namespace
            ORDER BY ds.Namespace
        """)
        if rows:
            print_table(cols, rows)
    except Exception as e:
        log(f'  Summary query failed: {e}')

    # 0m. Try to find error details from CopyActivityExecution with all columns
    log('\n--- 0m. CopyActivityExecution — FULL content (last 20) ---')
    try:
        cols, rows = run_query(cursor, """
            SELECT TOP 20 *
            FROM logging.CopyActivityExecution
            ORDER BY 1 DESC
        """)
        if rows:
            # Show each row fully
            for i, row in enumerate(rows):
                log(f'  --- Record {i+1} ---')
                for j, col in enumerate(cols):
                    val = str(row[j]) if row[j] is not None else 'NULL'
                    if len(val) > 300:
                        val = val[:300] + '...'
                    log(f'    {col}: {val}')
        else:
            log('  No CopyActivityExecution records.')
    except Exception as e:
        log(f'  Full CopyActivityExecution query failed: {e}')

    # ── Determine bad entity IDs ──
    # If we didn't find them via the name lookup, try harder
    if not bad_entity_ids:
        log('\n  WARNING: Could not find known-bad entities by name. Trying broader search...')
        try:
            cursor.execute("""
                SELECT LandingzoneEntityId, SourceName
                FROM integration.LandingzoneEntity
                WHERE DataSourceId = 8
                  AND (SourceName LIKE '%archiveOptiva%' OR SourceName LIKE '%product_target%')
            """)
            found = cursor.fetchall()
            for r in found:
                bad_entity_ids.append(r[0])
                log(f'  Found via LIKE: ID={r[0]}, Name={r[1]}')
        except Exception as e:
            log(f'  Broader search failed: {e}')

    log(f'\n  BAD ENTITY IDS TO DEACTIVATE: {bad_entity_ids}')

    # ══════════════════════════════════════════════════════════════════════════
    #  PHASE 1: DEACTIVATE PROBLEMATIC ENTITIES
    # ══════════════════════════════════════════════════════════════════════════
    log_section('PHASE 1: DEACTIVATE PROBLEMATIC ENTITIES')

    if bad_entity_ids:
        placeholders = ','.join(['?' for _ in bad_entity_ids])
        cursor.execute(f"""
            UPDATE integration.LandingzoneEntity
            SET IsActive = 0
            WHERE LandingzoneEntityId IN ({placeholders})
        """, bad_entity_ids)
        affected = cursor.rowcount
        conn.commit()
        log(f'  Deactivated {affected} problematic entities: IDs={bad_entity_ids}')

        # Verify
        cursor.execute(f"""
            SELECT LandingzoneEntityId, SourceName, IsActive
            FROM integration.LandingzoneEntity
            WHERE LandingzoneEntityId IN ({placeholders})
        """, bad_entity_ids)
        for r in cursor.fetchall():
            log(f'    -> ID={r[0]}, Name={r[1]}, IsActive={r[2]}')
    else:
        log('  No bad entity IDs identified. Skipping deactivation.')
        log('  NOTE: The two known-bad entities (alel_product_target_tbl, x_archiveOptiva)')
        log('  may not exist in the metadata DB or were already deactivated/removed.')

    # ══════════════════════════════════════════════════════════════════════════
    #  PHASE 2: DEACTIVATE NON-OPTIVA SOURCES
    # ══════════════════════════════════════════════════════════════════════════
    log_section('PHASE 2: DEACTIVATE NON-OPTIVA SOURCES')

    # First: show current state
    log('  Before deactivation:')
    cursor.execute("""
        SELECT ds.DataSourceId, ds.Namespace,
               COUNT(*) as Total,
               SUM(CASE WHEN le.IsActive = 1 THEN 1 ELSE 0 END) as Active
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.DataSourceId, ds.Namespace
        ORDER BY ds.DataSourceId
    """)
    for r in cursor.fetchall():
        log(f'    DS {r[0]} ({r[1]}): {r[2]} total, {r[3]} active')

    # Deactivate non-OPTIVA
    cursor.execute("""
        UPDATE integration.LandingzoneEntity
        SET IsActive = 0
        WHERE DataSourceId != ?
          AND IsActive = 1
    """, (OPTIVA_DS_ID,))
    deactivated_count = cursor.rowcount
    conn.commit()
    non_optiva_deactivated = True
    log(f'  Deactivated {deactivated_count} non-OPTIVA entities.')

    # Verify: only OPTIVA should be active
    log('  After deactivation:')
    cursor.execute("""
        SELECT ds.DataSourceId, ds.Namespace,
               COUNT(*) as Total,
               SUM(CASE WHEN le.IsActive = 1 THEN 1 ELSE 0 END) as Active
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.DataSourceId, ds.Namespace
        ORDER BY ds.DataSourceId
    """)
    for r in cursor.fetchall():
        log(f'    DS {r[0]} ({r[1]}): {r[2]} total, {r[3]} active')

    # Count active OPTIVA entities
    cursor.execute("""
        SELECT COUNT(*) FROM integration.LandingzoneEntity
        WHERE DataSourceId = ? AND IsActive = 1
    """, (OPTIVA_DS_ID,))
    optiva_active = cursor.fetchone()[0]
    log(f'  OPTIVA active entities ready for pipeline: {optiva_active}')

    if optiva_active == 0:
        log('  ERROR: No active OPTIVA entities! Cannot run pipeline.')
        final_status = 'ABORTED_NO_ACTIVE_ENTITIES'
        raise RuntimeError('No active OPTIVA entities')

    # ══════════════════════════════════════════════════════════════════════════
    #  PHASE 3: TRIGGER & MONITOR LZ PIPELINE
    # ══════════════════════════════════════════════════════════════════════════
    log_section('PHASE 3: TRIGGER & MONITOR LZ PIPELINE')

    api_token = get_token('https://api.fabric.microsoft.com/.default')
    base_url = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{LZ_PIPELINE_GUID}'

    # Check for already-running pipeline
    log('  Checking for active pipeline runs...')
    status_code, resp, _ = fabric_api(api_token, 'GET', f'{base_url}/jobs/instances?limit=5')
    active_runs = [r for r in resp.get('value', [])
                   if r.get('status', '').lower() in ('notstarted', 'inprogress')]

    job_id = ''
    if active_runs:
        job_id = active_runs[0]['id']
        log(f'  Pipeline already running: {job_id} (status: {active_runs[0]["status"]})')
    else:
        log('  No active runs. Triggering new LZ pipeline...')
        status_code, resp, headers = fabric_api(api_token, 'POST',
            f'{base_url}/jobs/instances?jobType=Pipeline')

        if status_code == 202:
            location = headers.get('Location', '') if headers else ''
            job_id = location.rstrip('/').split('/')[-1] if location else ''
            log(f'  Pipeline triggered! Status=202, Job ID: {job_id}')
        elif status_code == 409:
            log(f'  409 Conflict — pipeline already running. Fetching active run...')
            api_token = get_token('https://api.fabric.microsoft.com/.default')
            _, resp2, _ = fabric_api(api_token, 'GET', f'{base_url}/jobs/instances?limit=5')
            active2 = [r for r in resp2.get('value', [])
                       if r.get('status', '').lower() in ('notstarted', 'inprogress')]
            if active2:
                job_id = active2[0]['id']
                log(f'  Found active run: {job_id}')
            else:
                log(f'  ERROR: 409 but no active run found. Response: {resp}')
                final_status = 'TRIGGER_FAILED_409'
                raise RuntimeError('Pipeline trigger 409 but no active run')
        else:
            log(f'  ERROR: Trigger returned HTTP {status_code}: {resp}')
            final_status = f'TRIGGER_FAILED_{status_code}'
            raise RuntimeError(f'Pipeline trigger failed: HTTP {status_code}')

    # Monitor pipeline
    log(f'  Monitoring pipeline run {job_id}...')
    pipeline_start = time.time()
    iteration = 0
    last_status = ''
    token_refresh_time = time.time()

    while True:
        iteration += 1
        elapsed_min = (time.time() - pipeline_start) / 60

        # Refresh API token every 30 minutes
        if time.time() - token_refresh_time > 1800:
            api_token = get_token('https://api.fabric.microsoft.com/.default')
            token_refresh_time = time.time()
            log(f'  (API token refreshed)')

        try:
            status_url = f'{base_url}/jobs/instances/{job_id}'
            _, resp, _ = fabric_api(api_token, 'GET', status_url)
            status = resp.get('status', 'Unknown')
        except Exception as e:
            status = f'PollError({e})'

        if status != last_status:
            log(f'  Pipeline [{elapsed_min:.1f}min]: {status}')
            last_status = status
        elif int(elapsed_min) % 5 == 0 and iteration > 1:
            log(f'  Pipeline [{elapsed_min:.1f}min]: {status} (unchanged)')

        if status.lower() in ('completed', 'failed', 'cancelled'):
            final_status = status
            log(f'  Pipeline FINISHED: {status} after {elapsed_min:.1f} minutes')

            # Get failure reason if failed
            if status.lower() == 'failed':
                fail_reason = resp.get('failureReason', {})
                if fail_reason:
                    log(f'  Failure reason: {json.dumps(fail_reason, indent=2)[:500]}')
            break

        if elapsed_min > MAX_WAIT_MINS:
            log(f'  TIMEOUT after {elapsed_min:.1f} minutes. Pipeline still running in Fabric.')
            final_status = f'TIMEOUT_{status}'
            break

        time.sleep(POLL_INTERVAL_SECS)

    # Post-pipeline: query OPTIVA processing results
    log('\n  --- Post-Pipeline: OPTIVA Processing Results ---')
    try:
        # Reconnect to SQL (token may have expired)
        conn.close()
        conn = connect_sql()
        conn.autocommit = False
        cursor = conn.cursor()

        cols, rows = run_query(cursor, """
            SELECT ple.LandingzoneEntityId, le.SourceName,
                   ple.IsProcessed, ple.InsertDateTime, ple.LoadEndDateTime
            FROM execution.PipelineLandingzoneEntity ple
            JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
            WHERE le.DataSourceId = 8
            ORDER BY ple.InsertDateTime DESC
        """)
        if rows:
            processed = sum(1 for r in rows if r[2] == 1 or r[2] == True)
            total = len(rows)
            log(f'  OPTIVA: {processed}/{total} entities processed successfully')
            # Show unprocessed ones
            unproc = [r for r in rows if r[2] == 0 or r[2] == False]
            if unproc:
                log(f'  Unprocessed entities ({len(unproc)}):')
                for r in unproc:
                    log(f'    ID={r[0]}, Name={r[1]}, IsProcessed={r[2]}')
        else:
            log('  No OPTIVA PipelineLandingzoneEntity records found after run.')
    except Exception as e:
        log(f'  Post-pipeline SQL query failed: {e}')

    # Check for new errors
    log('\n  --- Post-Pipeline: Recent error logs ---')
    try:
        cols, rows = run_query(cursor, """
            SELECT TOP 20 EntityId, LogType, LogDateTime,
                   LEFT(LogData, 500) AS LogData
            FROM logging.PipelineExecution
            WHERE LogDateTime > DATEADD(HOUR, -2, GETUTCDATE())
              AND (LogType LIKE '%Error%' OR LogType LIKE '%Fail%'
                   OR LogData LIKE '%error%' OR LogData LIKE '%fail%')
            ORDER BY LogDateTime DESC
        """)
        if rows:
            log(f'  Found {len(rows)} error log entries from last 2 hours:')
            print_table(cols, rows)
        else:
            log('  No error logs in last 2 hours.')
    except Exception as e:
        log(f'  Post-pipeline error query failed: {e}')

except Exception as e:
    log(f'\n  EXCEPTION: {e}')
    import traceback
    log(traceback.format_exc())
    if final_status == 'UNKNOWN':
        final_status = f'ERROR: {e}'

finally:
    # ══════════════════════════════════════════════════════════════════════════
    #  PHASE 4: REACTIVATE ALL SOURCES (ALWAYS RUNS)
    # ══════════════════════════════════════════════════════════════════════════
    log_section('PHASE 4: REACTIVATE ALL SOURCES')
    try:
        # Reconnect if needed
        try:
            cursor.execute("SELECT 1")
        except Exception:
            log('  Reconnecting to SQL for cleanup...')
            conn = connect_sql()
            conn.autocommit = False
            cursor = conn.cursor()

        # Reactivate all EXCEPT the known-bad entities
        if bad_entity_ids:
            placeholders = ','.join(['?' for _ in bad_entity_ids])
            cursor.execute(f"""
                UPDATE integration.LandingzoneEntity
                SET IsActive = 1
                WHERE IsActive = 0
                  AND LandingzoneEntityId NOT IN ({placeholders})
            """, bad_entity_ids)
        else:
            cursor.execute("""
                UPDATE integration.LandingzoneEntity
                SET IsActive = 1
                WHERE IsActive = 0
            """)
        reactivated = cursor.rowcount
        conn.commit()
        log(f'  Reactivated {reactivated} entities.')

        if bad_entity_ids:
            log(f'  Kept deactivated: {len(bad_entity_ids)} bad entities (IDs={bad_entity_ids})')

        # Final verification
        log('  Final entity state:')
        cursor.execute("""
            SELECT ds.DataSourceId, ds.Namespace,
                   COUNT(*) as Total,
                   SUM(CASE WHEN le.IsActive = 1 THEN 1 ELSE 0 END) as Active,
                   SUM(CASE WHEN le.IsActive = 0 THEN 1 ELSE 0 END) as Inactive
            FROM integration.LandingzoneEntity le
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            GROUP BY ds.DataSourceId, ds.Namespace
            ORDER BY ds.DataSourceId
        """)
        for r in cursor.fetchall():
            log(f'    DS {r[0]} ({r[1]}): Total={r[2]}, Active={r[3]}, Inactive={r[4]}')

        # Show deactivated entities specifically
        if bad_entity_ids:
            placeholders = ','.join(['?' for _ in bad_entity_ids])
            cursor.execute(f"""
                SELECT LandingzoneEntityId, SourceName, IsActive
                FROM integration.LandingzoneEntity
                WHERE LandingzoneEntityId IN ({placeholders})
            """, bad_entity_ids)
            log('  Permanently deactivated entities:')
            for r in cursor.fetchall():
                log(f'    ID={r[0]}, Name={r[1]}, IsActive={r[2]}')

        conn.close()
    except Exception as e:
        log(f'  REACTIVATION FAILED: {e}')
        import traceback
        log(traceback.format_exc())

    # ── Final Summary ──────────────────────────────────────────────────────
    total_elapsed = (time.time() - overall_start) / 60
    log_section('FINAL SUMMARY')
    log(f'  Final status: {final_status}')
    log(f'  Total elapsed: {total_elapsed:.1f} minutes')
    log(f'  Bad entities deactivated: {len(bad_entity_ids)} (IDs={bad_entity_ids})')
    log(f'  Results file: {RESULTS_FILE}')

    write_results()
    log('DONE.')
