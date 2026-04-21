"""
run_load_all.py - REST API orchestrator for the FMD pipeline chain.

Triggers Fabric notebooks directly via the REST API using SP token auth.
The old pipeline-based approach is dead — InvokePipeline doesn't work with
Service Principal auth, and the LOAD_* pipelines were never deployed.

Notebook chain:
  LZ:     NB_FMD_PROCESSING_LANDINGZONE_MAIN  (copies from source → LZ parquet)
  Bronze: NB_FMD_LOAD_LANDING_BRONZE           (LZ parquet → Bronze delta)
  Silver: NB_FMD_LOAD_BRONZE_SILVER            (Bronze delta → Silver SCD2)

Each notebook is triggered, polled to completion, then the next starts.
Each step runs regardless of the previous step's result so partial loads
still propagate.

Usage:
    python scripts/run_load_all.py                # Run full chain (LZ → Bronze → Silver)
    python scripts/run_load_all.py --skip-lz      # Skip LZ, run Bronze + Silver
    python scripts/run_load_all.py --only bronze   # Run only Bronze
    python scripts/run_load_all.py --only silver   # Run only Silver
    python scripts/run_load_all.py --only lz       # Run only LZ
"""

import json
import urllib.request
import urllib.parse
import urllib.error
import time
import sys
from datetime import datetime, timezone

from engine.config import load_config

# ── Config ──
CONFIG = load_config()
TENANT = CONFIG.tenant_id
CLIENT = CONFIG.client_id
SECRET = CONFIG.client_secret
TOKEN_URL = f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token'
SCOPE = 'https://api.fabric.microsoft.com/.default'
API = 'https://api.fabric.microsoft.com/v1'

# Workspace
WS_CODE = CONFIG.workspace_code_id

# Notebook IDs are sourced from dashboard/app/api/config.json via engine.config.
NOTEBOOKS = {
    'LZ':     CONFIG.notebook_processing_id,
    'BRONZE': CONFIG.notebook_bronze_id,
    'SILVER': CONFIG.notebook_silver_id,
}

NOTEBOOK_NAMES = {
    'LZ':     'NB_FMD_PROCESSING_LANDINGZONE_MAIN',
    'BRONZE': 'NB_FMD_LOAD_LANDING_BRONZE',
    'SILVER': 'NB_FMD_LOAD_BRONZE_SILVER',
}

# Poll config
POLL_INTERVAL = 20  # seconds
MAX_POLL_TIME = 14400  # 4 hours max per notebook


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}')


def get_token():
    if not SECRET:
        raise RuntimeError('FABRIC_CLIENT_SECRET not configured in dashboard/app/api/.env')
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': SCOPE,
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=body,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
    )
    return json.loads(urllib.request.urlopen(req).read())['access_token']


def trigger_notebook(token, stage):
    """Trigger a notebook job and return the run ID."""
    nb_id = NOTEBOOKS[stage]
    nb_name = NOTEBOOK_NAMES[stage]
    url = f'{API}/workspaces/{WS_CODE}/items/{nb_id}/jobs/instances?jobType=RunNotebook'
    req = urllib.request.Request(
        url, data=b'{}', method='POST',
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
    )
    try:
        resp = urllib.request.urlopen(req)
        loc = resp.headers.get('Location', '')
        run_id = loc.split('/')[-1] if loc else None
        log(f'  Triggered {nb_name} (HTTP {resp.status})')
        return run_id
    except urllib.error.HTTPError as e:
        if e.code == 202:
            loc = e.headers.get('Location', '')
            run_id = loc.split('/')[-1] if loc else None
            log(f'  Triggered {nb_name} (HTTP 202 Accepted)')
            return run_id
        else:
            err = e.read().decode()[:500]
            log(f'  TRIGGER FAILED: HTTP {e.code}: {err}')
            return None


def poll_notebook(token, stage, run_id):
    """Poll notebook until completion. Returns (status, duration_seconds, failure_reason)."""
    nb_id = NOTEBOOKS[stage]
    start = time.time()

    while True:
        elapsed = time.time() - start
        if elapsed > MAX_POLL_TIME:
            return 'Timeout', elapsed, 'Exceeded max poll time'

        time.sleep(POLL_INTERVAL)

        url = f'{API}/workspaces/{WS_CODE}/items/{nb_id}/jobs/instances/{run_id}'
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})

        try:
            resp = urllib.request.urlopen(req)
            data = json.loads(resp.read())
            status = data.get('status', 'Unknown')
            failure = data.get('failureReason')

            elapsed = time.time() - start
            mins = int(elapsed // 60)
            secs = int(elapsed % 60)

            if status in ('Completed', 'Failed', 'Cancelled', 'Deduped'):
                failure_msg = None
                if failure:
                    failure_msg = failure.get('message', str(failure))[:500] if isinstance(failure, dict) else str(failure)[:500]
                return status, elapsed, failure_msg

            log(f'  [{mins}m{secs:02d}s] {stage}: {status}')

        except urllib.error.HTTPError as e:
            if e.code == 401:
                # Token expired, try to refresh
                log(f'  Token expired during poll, refreshing...')
                try:
                    token = get_token()
                except Exception:
                    log(f'  Token refresh failed')
            else:
                log(f'  Poll error: HTTP {e.code}')
        except Exception as e:
            log(f'  Poll error: {e}')

    return token  # Return potentially refreshed token


def run_stage(token, stage):
    """Trigger and poll a single notebook to completion."""
    nb_name = NOTEBOOK_NAMES[stage]
    log(f'>> Starting {stage}: {nb_name}')
    run_id = trigger_notebook(token, stage)

    if not run_id:
        return token, 'Failed', 0, 'Could not trigger notebook'

    log(f'  Run ID: {run_id}')
    status, duration, failure = poll_notebook(token, stage, run_id)

    mins = int(duration // 60)
    secs = int(duration % 60)

    if status == 'Completed':
        log(f'  OK {stage} completed in {mins}m{secs:02d}s')
    elif status == 'Failed':
        log(f'  FAIL {stage} failed after {mins}m{secs:02d}s')
        if failure:
            log(f'  Reason: {failure[:300]}')
    else:
        log(f'  ? {stage} ended with status: {status} after {mins}m{secs:02d}s')

    return token, status, duration, failure


def main():
    args = [a.lower() for a in sys.argv[1:]]
    skip_lz = '--skip-lz' in args
    only = None
    if '--only' in args:
        idx = args.index('--only')
        if idx + 1 < len(args):
            only = args[idx + 1].upper()

    # Determine which stages to run
    if only:
        chain = [only]
    elif skip_lz:
        chain = ['BRONZE', 'SILVER']
    else:
        chain = ['LZ', 'BRONZE', 'SILVER']

    # Validate
    for stage in chain:
        if stage not in NOTEBOOKS:
            log(f'Unknown stage: {stage}. Valid: LZ, BRONZE, SILVER')
            return 1
        if not NOTEBOOKS.get(stage):
            log(f'Missing configured notebook ID for stage {stage}. Check dashboard/app/api/config.json')
            return 1

    if not TENANT or not CLIENT or not WS_CODE:
        log('Missing Fabric tenant/client/workspace configuration. Check dashboard/app/api/config.json')
        return 1

    log('=' * 60)
    log('FMD LOAD_ALL Orchestrator (Notebook-based)')
    log(f'Chain: {" -> ".join(chain)}')
    for stage in chain:
        log(f'  {stage}: {NOTEBOOK_NAMES[stage]}')
    log('=' * 60)

    # Authenticate
    log('Authenticating...')
    token = get_token()
    log('  OK — SP token acquired')

    # Run each notebook in sequence
    results = {}
    total_start = time.time()

    for stage in chain:
        token, status, duration, failure = run_stage(token, stage)
        results[stage] = {'status': status, 'duration': duration, 'failure': failure}

        # Refresh token between stages (notebooks can be long-running)
        if stage != chain[-1]:
            try:
                token = get_token()
            except Exception:
                log('  Warning: token refresh failed, continuing with existing token')

    # Summary
    total_duration = time.time() - total_start
    total_mins = int(total_duration // 60)
    total_secs = int(total_duration % 60)

    log('')
    log('=' * 60)
    log(f'SUMMARY (total: {total_mins}m{total_secs:02d}s)')
    log('=' * 60)

    all_ok = True
    for stage, result in results.items():
        mins = int(result['duration'] // 60)
        secs = int(result['duration'] % 60)
        icon = 'OK' if result['status'] == 'Completed' else 'FAIL'
        log(f'  {icon} {stage} ({NOTEBOOK_NAMES[stage]}): {result["status"]} ({mins}m{secs:02d}s)')
        if result['status'] != 'Completed':
            all_ok = False

    if all_ok:
        log('\nAll notebooks completed successfully!')
    else:
        log('\nSome notebooks failed. Check Fabric Monitoring Hub for details.')

    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main())
