"""
run_load_all.py - REST API orchestrator for the FMD LOAD_ALL pipeline chain.

Replaces InvokePipeline activities which have a known Fabric limitation:
InvokePipeline does NOT support Service Principal authentication for
pipeline-to-pipeline execution. Instead, this script triggers each
child pipeline directly via the Fabric REST API using SP token auth.

Pipeline chain: LOAD_LANDINGZONE → LOAD_BRONZE → LOAD_SILVER
Each pipeline is triggered, polled to completion, then the next starts.
Bronze runs after LZ regardless of LZ result (Completed = Succeeded|Failed).
Silver runs after Bronze regardless of Bronze result.

Usage:
    python scripts/run_load_all.py              # Run full chain
    python scripts/run_load_all.py --skip-lz    # Skip LZ, run Bronze+Silver
    python scripts/run_load_all.py --only bronze # Run only Bronze
"""

import json
import urllib.request
import urllib.parse
import urllib.error
import time
import sys
import os
from datetime import datetime, timezone

# ── Config ──
TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'

def get_client_secret():
    env_path = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'app', 'api', '.env')
    with open(env_path) as f:
        for line in f:
            if line.startswith('FABRIC_CLIENT_SECRET='):
                return line.strip().split('=', 1)[1]
    raise RuntimeError('FABRIC_CLIENT_SECRET not found in .env')

SECRET = None  # Loaded lazily
TOKEN_URL = f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token'
SCOPE = 'https://api.fabric.microsoft.com/.default'
API = 'https://api.fabric.microsoft.com/v1'

# Workspace and pipeline IDs
WS_CODE = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'

PIPELINES = {
    'LOAD_LANDINGZONE': '3d0b3b2b-a069-40dc-b735-d105f9e66838',
    'LOAD_BRONZE':      '8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3',
    'LOAD_SILVER':      '90c0535c-c5dc-43a3-b51e-c44ef1808a60',
}

# Poll config
POLL_INTERVAL = 15  # seconds
MAX_POLL_TIME = 7200  # 2 hours max per pipeline


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}')


def get_token():
    global SECRET
    if SECRET is None:
        SECRET = get_client_secret()
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


def trigger_pipeline(token, name):
    """Trigger a pipeline and return the run ID."""
    pipeline_id = PIPELINES[name]
    url = f'{API}/workspaces/{WS_CODE}/items/{pipeline_id}/jobs/instances?jobType=Pipeline'
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
        return run_id
    except urllib.error.HTTPError as e:
        if e.code == 202:
            loc = e.headers.get('Location', '')
            run_id = loc.split('/')[-1] if loc else None
            return run_id
        else:
            err = e.read().decode()[:500]
            log(f'  TRIGGER FAILED: HTTP {e.code}: {err}')
            return None


def poll_pipeline(token, name, run_id):
    """Poll pipeline until completion. Returns (status, duration_seconds, failure_reason)."""
    pipeline_id = PIPELINES[name]
    start = time.time()

    while True:
        elapsed = time.time() - start
        if elapsed > MAX_POLL_TIME:
            return 'Timeout', elapsed, 'Exceeded max poll time'

        time.sleep(POLL_INTERVAL)

        url = f'{API}/workspaces/{WS_CODE}/items/{pipeline_id}/jobs/instances/{run_id}'
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})

        try:
            resp = urllib.request.urlopen(req)
            data = json.loads(resp.read())
            status = data.get('status', 'Unknown')
            failure = data.get('failureReason')

            elapsed = time.time() - start
            mins = int(elapsed // 60)
            secs = int(elapsed % 60)

            if status in ('Completed', 'Failed', 'Cancelled'):
                failure_msg = None
                if failure:
                    failure_msg = failure.get('message', str(failure))[:500]
                return status, elapsed, failure_msg

            log(f'  [{mins}m{secs:02d}s] {name}: {status}')

        except Exception as e:
            log(f'  Poll error: {e}')


def run_pipeline(token, name):
    """Trigger and poll a single pipeline to completion."""
    log(f'>> Triggering PL_FMD_{name}...')
    run_id = trigger_pipeline(token, name)

    if not run_id:
        return 'Failed', 0, 'Could not trigger pipeline'

    log(f'  Run ID: {run_id}')
    status, duration, failure = poll_pipeline(token, name, run_id)

    mins = int(duration // 60)
    secs = int(duration % 60)

    if status == 'Completed':
        log(f'  OK {name} completed in {mins}m{secs:02d}s')
    elif status == 'Failed':
        log(f'  FAIL {name} failed after {mins}m{secs:02d}s')
        if failure:
            # Truncate for readability
            log(f'  Reason: {failure[:300]}')
    else:
        log(f'  ? {name} ended with status: {status} after {mins}m{secs:02d}s')

    return status, duration, failure


def main():
    args = sys.argv[1:]
    skip_lz = '--skip-lz' in args
    only = None
    if '--only' in args:
        idx = args.index('--only')
        if idx + 1 < len(args):
            only = args[idx + 1].upper()

    # Determine which pipelines to run
    if only:
        chain = [only]
    elif skip_lz:
        chain = ['LOAD_BRONZE', 'LOAD_SILVER']
    else:
        chain = ['LOAD_LANDINGZONE', 'LOAD_BRONZE', 'LOAD_SILVER']

    log('=' * 60)
    log('FMD LOAD_ALL Orchestrator (REST API)')
    log(f'Chain: {" → ".join(chain)}')
    log('=' * 60)

    # Authenticate
    log('Authenticating...')
    token = get_token()
    log('  OK')

    # Run each pipeline in sequence
    results = {}
    total_start = time.time()

    for name in chain:
        if name not in PIPELINES:
            log(f'Unknown pipeline: {name}')
            continue

        status, duration, failure = run_pipeline(token, name)
        results[name] = {'status': status, 'duration': duration, 'failure': failure}

        # Refresh token between pipelines (they can be long-running)
        if name != chain[-1]:
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
    for name, result in results.items():
        mins = int(result['duration'] // 60)
        secs = int(result['duration'] % 60)
        icon = 'OK' if result['status'] == 'Completed' else 'FAIL'
        log(f'  {icon} {name}: {result["status"]} ({mins}m{secs:02d}s)')
        if result['status'] != 'Completed':
            all_ok = False

    if all_ok:
        log('\nAll pipelines completed successfully!')
    else:
        log('\nSome pipelines failed. Check Fabric Monitoring Hub for details.')

    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main())
