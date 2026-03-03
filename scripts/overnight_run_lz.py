import os
#!/usr/bin/env python3
"""
Overnight LZ Pipeline Runner
Triggers PL_FMD_LOAD_LANDINGZONE and monitors to completion.
Copies data from ALL 5 source SQL servers (MES, ETQ, M3C, M3 ERP, OPTIVA) to OneLake.
"""
import urllib.request, urllib.parse, json, struct, pyodbc, time, sys
from datetime import datetime, timezone

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = os.environ.get('FABRIC_CLIENT_SECRET', '')
CODE_WS = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
SQL_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
SQL_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'

# Known pipeline GUIDs (from integration.Pipeline)
LZ_PIPELINE_GUID = '3d0b3b2b-a069-40dc-b735-d105f9e66838'

def get_token(scope='https://api.fabric.microsoft.com/.default'):
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials', 'client_id': CLIENT, 'client_secret': SECRET,
        'scope': scope,
    }).encode()
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    return json.loads(urllib.request.urlopen(req).read())['access_token']

def connect_sql():
    token = get_token('https://analysis.windows.net/powerbi/api/.default')
    tb = token.encode('UTF-16-LE')
    ts = struct.pack(f'<I{len(tb)}s', len(tb), tb)
    return pyodbc.connect(
        f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SQL_SERVER};DATABASE={SQL_DB};Encrypt=yes;TrustServerCertificate=no',
        attrs_before={1256: ts})

def log(msg):
    ts = datetime.now(timezone.utc).strftime('%H:%M:%S UTC')
    print(f'[{ts}] {msg}', flush=True)

def write_results(job_id, status, elapsed_min, extra=''):
    results_file = 'scripts/overnight_lz_results.txt'
    with open(results_file, 'w') as f:
        f.write(f'LZ Pipeline Run Results\n')
        f.write(f'=======================\n')
        f.write(f'Job ID: {job_id}\n')
        f.write(f'Final Status: {status}\n')
        f.write(f'Duration: {elapsed_min} minutes\n')
        f.write(f'Timestamp: {datetime.now(timezone.utc).isoformat()}\n')
        if extra:
            f.write(f'\n{extra}\n')
    log(f'Results written to {results_file}')

# ── STEP 1: Check if pipeline is already running ──
log('Checking for active LZ pipeline runs...')
token = get_token()
job_id = ''
status = 'Unknown'
elapsed_min = 0

try:
    url = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{LZ_PIPELINE_GUID}/jobs/instances?jobType=Pipeline'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    resp = json.loads(urllib.request.urlopen(req).read())
    active = [r for r in resp.get('value', []) if r.get('status','').lower() in ('notstarted','inprogress')]
    if active:
        log(f'Pipeline already running: {active[0]["id"]} (status: {active[0]["status"]})')
        log('Waiting for existing run to complete...')
        job_id = active[0]['id']
        # Poll existing run
        while True:
            try:
                surl = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{LZ_PIPELINE_GUID}/jobs/instances/{job_id}'
                req = urllib.request.Request(surl, headers={'Authorization': f'Bearer {token}'})
                r = json.loads(urllib.request.urlopen(req).read())
                status = r.get('status', 'Unknown')
                log(f'Existing run {job_id[:8]}: {status}')
                if status.lower() in ('completed', 'failed', 'cancelled'):
                    break
            except Exception as e:
                log(f'Poll error: {e}')
            time.sleep(60)
            token = get_token()  # refresh token
        log(f'Existing run finished: {status}')
    else:
        log('No active runs found.')
except Exception as e:
    log(f'Could not check for active runs: {e}')

# ── STEP 2: Trigger new LZ pipeline run ──
if not job_id or status.lower() in ('completed', 'failed', 'cancelled'):
    log('Triggering LZ pipeline (PL_FMD_LOAD_LANDINGZONE)...')
    token = get_token()
    url = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{LZ_PIPELINE_GUID}/jobs/instances?jobType=Pipeline'
    req = urllib.request.Request(url, method='POST',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        data=b'{}')
    try:
        resp = urllib.request.urlopen(req)
        location = resp.headers.get('Location', '')
        job_id = location.rstrip('/').split('/')[-1] if location else ''
        log(f'LZ Pipeline triggered! Job ID: {job_id}')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        log(f'TRIGGER FAILED: HTTP {e.code} — {body}')
        # If 409 Conflict (already running), extract job ID from response and poll
        if e.code == 409:
            log('Pipeline already running (409 Conflict). Will try to poll...')
            # Try to get active runs again
            token = get_token()
            url2 = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{LZ_PIPELINE_GUID}/jobs/instances?jobType=Pipeline'
            req2 = urllib.request.Request(url2, headers={'Authorization': f'Bearer {token}'})
            resp2 = json.loads(urllib.request.urlopen(req2).read())
            active = [r for r in resp2.get('value', []) if r.get('status','').lower() in ('notstarted','inprogress')]
            if active:
                job_id = active[0]['id']
                log(f'Found active run: {job_id}')
            else:
                log('No active run found either. Exiting.')
                write_results('N/A', 'TRIGGER_FAILED_409', 0)
                sys.exit(1)
        else:
            write_results('N/A', f'TRIGGER_FAILED_{e.code}', 0, body)
            sys.exit(1)

# ── STEP 3: Monitor pipeline ──
log(f'Monitoring LZ pipeline run {job_id}...')
start_time = time.time()
iteration = 0
last_status = ''

while True:
    iteration += 1
    elapsed_min = int((time.time() - start_time) / 60)

    # Re-acquire token every 40 minutes
    if iteration % 40 == 0 or iteration == 1:
        token = get_token()

    try:
        status_url = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{LZ_PIPELINE_GUID}/jobs/instances/{job_id}'
        req = urllib.request.Request(status_url, headers={'Authorization': f'Bearer {token}'})
        resp = json.loads(urllib.request.urlopen(req).read())
        status = resp.get('status', 'Unknown')
    except Exception as e:
        status = f'PollError({e})'

    if status != last_status:
        log(f'LZ Pipeline [{elapsed_min}min]: {status}')
        last_status = status
    elif elapsed_min % 5 == 0:  # Log every 5 minutes even if unchanged
        log(f'LZ Pipeline [{elapsed_min}min]: {status} (no change)')

    if status.lower() in ('completed', 'failed', 'cancelled'):
        log(f'LZ Pipeline FINISHED: {status} after {elapsed_min} minutes')
        break

    if elapsed_min > 240:  # 4 hour max
        log(f'MAX WAIT EXCEEDED ({elapsed_min}min). Pipeline still running in Fabric.')
        status = f'TIMEOUT_STILL_RUNNING (last: {status})'
        break

    time.sleep(60)

# ── STEP 4: Query LZ processing status from SQL ──
log('Querying LZ processing status...')
sql_summary = ''
try:
    conn = connect_sql()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ds.Namespace,
               SUM(CASE WHEN ple.IsProcessed = 1 THEN 1 ELSE 0 END) as processed,
               SUM(CASE WHEN ple.IsProcessed = 0 THEN 1 ELSE 0 END) as pending,
               COUNT(*) as total
        FROM execution.PipelineLandingzoneEntity ple
        JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace
        ORDER BY ds.Namespace
    """)
    rows = cursor.fetchall()
    header = f'{"Namespace":<12} {"Processed":<12} {"Pending":<10} {"Total":<8}'
    divider = '-' * 42
    log('LZ Processing Status:')
    log(header)
    log(divider)
    sql_summary = f'LZ Processing Status:\n{header}\n{divider}\n'
    for r in rows:
        line = f'{r[0]:<12} {r[1]:<12} {r[2]:<10} {r[3]:<8}'
        log(line)
        sql_summary += line + '\n'
    conn.close()
except Exception as e:
    log(f'SQL query failed: {e}')
    sql_summary = f'SQL query failed: {e}'

# ── STEP 5: Write results ──
write_results(job_id, status, elapsed_min, sql_summary)
log('DONE')
