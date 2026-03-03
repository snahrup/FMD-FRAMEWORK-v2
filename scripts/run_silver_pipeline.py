import os
"""
Trigger and monitor PL_FMD_LOAD_SILVER via Fabric REST API.
- Checks for existing active run first
- Triggers if none active
- Polls every 60s until completion
- Refreshes token every 40 iterations
- Max wait: 4 hours
- Writes results to scripts/overnight_silver_results.txt
"""

import urllib.request, urllib.parse, json, time, sys, os
from datetime import datetime, timezone

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = os.environ.get('FABRIC_CLIENT_SECRET', '')
CODE_WS = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
SILVER_PIPELINE = '90c0535c-c5dc-43a3-b51e-c44ef1808a60'

BASE_URL = f'https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{SILVER_PIPELINE}'
POLL_INTERVAL = 60       # seconds
TOKEN_REFRESH = 40       # iterations
MAX_ITERATIONS = 240     # 4 hours
PROGRESS_LOG = 5 * 60    # 5 minutes in seconds

RESULTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'overnight_silver_results.txt')


def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    return line


def get_fabric_token():
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': 'https://api.fabric.microsoft.com/.default',
    }).encode()
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    resp = json.loads(urllib.request.urlopen(req).read())
    return resp['access_token']


def api_get(url, token):
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    try:
        resp = urllib.request.urlopen(req)
        return resp.getcode(), json.loads(resp.read()), dict(resp.headers)
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        return e.code, body, dict(e.headers)


def api_post(url, token, body=None):
    data = json.dumps(body).encode() if body else b''
    req = urllib.request.Request(url, data=data, method='POST', headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    try:
        resp = urllib.request.urlopen(req)
        resp_body = resp.read()
        return resp.getcode(), json.loads(resp_body) if resp_body else {}, dict(resp.headers)
    except urllib.error.HTTPError as e:
        body_text = e.read().decode('utf-8', errors='replace')
        # 202 Accepted comes as HTTPError in some urllib versions
        if e.code == 202:
            return 202, {}, dict(e.headers)
        return e.code, body_text, dict(e.headers)


def write_results(lines):
    with open(RESULTS_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    log(f"Results written to {RESULTS_FILE}")


def main():
    results = []
    results.append(f"Silver Pipeline Run - Started {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    results.append(f"Pipeline: PL_FMD_LOAD_SILVER ({SILVER_PIPELINE})")
    results.append(f"Workspace: {CODE_WS}")
    results.append("")

    # --- Authenticate ---
    log("Authenticating with Fabric API...")
    try:
        token = get_fabric_token()
        log("Authentication successful.")
    except Exception as e:
        msg = f"FAILED: Authentication error: {e}"
        log(msg)
        results.append(msg)
        write_results(results)
        sys.exit(1)

    # --- Check for existing active run ---
    log("Checking for existing active Silver pipeline runs...")
    instances_url = f'{BASE_URL}/jobs/instances?jobType=Pipeline'
    code, data, headers = api_get(instances_url, token)

    job_url = None
    already_running = False

    if code == 200 and isinstance(data, dict):
        instances = data.get('value', [])
        active = [i for i in instances if i.get('status') in ('InProgress', 'NotStarted', 'Running')]
        if active:
            already_running = True
            run = active[0]
            run_id = run.get('id', 'unknown')
            run_status = run.get('status', 'unknown')
            log(f"Found existing active run: {run_id} (status: {run_status})")
            results.append(f"Existing active run found: {run_id} (status: {run_status})")
            # Build the job URL from the run id
            job_url = f'{BASE_URL}/jobs/instances/{run_id}'
        else:
            log(f"No active runs found ({len(instances)} total instances).")
    elif code == 200 and isinstance(data, list):
        active = [i for i in data if i.get('status') in ('InProgress', 'NotStarted', 'Running')]
        if active:
            already_running = True
            run = active[0]
            run_id = run.get('id', 'unknown')
            log(f"Found existing active run: {run_id}")
            results.append(f"Existing active run found: {run_id}")
            job_url = f'{BASE_URL}/jobs/instances/{run_id}'
        else:
            log(f"No active runs found.")
    else:
        log(f"Job instances check returned {code}: {str(data)[:200]}")
        # Not fatal, proceed to trigger

    # --- Trigger if no active run ---
    if not already_running:
        log("Triggering Silver pipeline...")
        trigger_url = f'{BASE_URL}/jobs/instances?jobType=Pipeline'
        code, data, headers = api_post(trigger_url, token)

        if code == 202:
            location = headers.get('Location', headers.get('location', ''))
            retry_after = headers.get('Retry-After', headers.get('retry-after', '60'))
            log(f"Pipeline triggered successfully (202 Accepted)")
            log(f"Location: {location}")
            log(f"Retry-After: {retry_after}s")
            results.append(f"Pipeline triggered at {datetime.now().strftime('%H:%M:%S')}")
            if location:
                job_url = location
            else:
                log("WARNING: No Location header in 202 response. Will try to find run via instances endpoint.")
                # Wait a moment then check instances
                time.sleep(5)
                code2, data2, _ = api_get(instances_url, token)
                if code2 == 200 and isinstance(data2, dict):
                    active = [i for i in data2.get('value', []) if i.get('status') in ('InProgress', 'NotStarted', 'Running')]
                    if active:
                        run_id = active[0].get('id', 'unknown')
                        job_url = f'{BASE_URL}/jobs/instances/{run_id}'
                        log(f"Found triggered run: {run_id}")
        elif code == 409:
            log(f"409 Conflict - pipeline may already be running. Checking instances...")
            results.append("409 Conflict on trigger - checking for active run")
            code2, data2, _ = api_get(instances_url, token)
            if code2 == 200:
                items = data2.get('value', []) if isinstance(data2, dict) else data2 if isinstance(data2, list) else []
                active = [i for i in items if i.get('status') in ('InProgress', 'NotStarted', 'Running')]
                if active:
                    run_id = active[0].get('id', 'unknown')
                    job_url = f'{BASE_URL}/jobs/instances/{run_id}'
                    already_running = True
                    log(f"Found active run after 409: {run_id}")
        else:
            msg = f"FAILED: Trigger returned HTTP {code}: {str(data)[:500]}"
            log(msg)
            results.append(msg)
            write_results(results)
            sys.exit(1)

    if not job_url:
        msg = "FAILED: Could not determine job URL to monitor."
        log(msg)
        results.append(msg)
        write_results(results)
        sys.exit(1)

    # --- Poll for completion ---
    start_time = time.time()
    last_progress_log = start_time
    iteration = 0
    final_status = "Unknown"
    final_data = {}

    log(f"Monitoring job: {job_url}")
    log(f"Polling every {POLL_INTERVAL}s, token refresh every {TOKEN_REFRESH} iterations, max {MAX_ITERATIONS} iterations")
    results.append(f"Monitoring started at {datetime.now().strftime('%H:%M:%S')}")
    results.append("")

    while iteration < MAX_ITERATIONS:
        # Refresh token periodically
        if iteration > 0 and iteration % TOKEN_REFRESH == 0:
            log("Refreshing authentication token...")
            try:
                token = get_fabric_token()
                log("Token refreshed successfully.")
            except Exception as e:
                log(f"WARNING: Token refresh failed: {e}. Will retry next cycle.")

        # Poll status
        code, data, headers = api_get(job_url, token)

        if code == 200 and isinstance(data, dict):
            status = data.get('status', 'Unknown')
            elapsed = time.time() - start_time
            elapsed_min = elapsed / 60

            # Log progress every 5 minutes or on status change
            now = time.time()
            if now - last_progress_log >= PROGRESS_LOG or status != final_status:
                log(f"Status: {status} | Elapsed: {elapsed_min:.1f} min | Iteration: {iteration}")
                last_progress_log = now

            final_status = status
            final_data = data

            if status in ('Completed', 'Failed', 'Cancelled'):
                elapsed_total = time.time() - start_time
                elapsed_str = f"{elapsed_total/60:.1f} minutes"
                log(f"Pipeline finished with status: {status} after {elapsed_str}")
                results.append(f"Final Status: {status}")
                results.append(f"Duration: {elapsed_str}")
                results.append(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

                # Capture any error details
                if status == 'Failed':
                    fail_reason = data.get('failureReason', data.get('error', 'No error details available'))
                    log(f"Failure reason: {fail_reason}")
                    results.append(f"Failure Reason: {fail_reason}")
                    # Dump full response for debugging
                    results.append(f"Full response: {json.dumps(data, indent=2)}")

                if status == 'Completed':
                    results.append("")
                    results.append("DONE - Silver pipeline completed successfully.")
                elif status == 'Failed':
                    results.append("")
                    results.append("FAILED - Silver pipeline failed. See failure reason above.")
                elif status == 'Cancelled':
                    results.append("")
                    results.append("CANCELLED - Silver pipeline was cancelled.")

                write_results(results)
                sys.exit(0 if status == 'Completed' else 1)

        elif code == 202:
            # Still processing (some APIs return 202 while in progress)
            elapsed = (time.time() - start_time) / 60
            now = time.time()
            if now - last_progress_log >= PROGRESS_LOG:
                log(f"Status: InProgress (202) | Elapsed: {elapsed:.1f} min | Iteration: {iteration}")
                last_progress_log = now
        elif code == 401:
            log("Got 401 Unauthorized, refreshing token immediately...")
            try:
                token = get_fabric_token()
                log("Token refreshed after 401.")
                iteration += 1
                continue  # retry immediately
            except Exception as e:
                log(f"Token refresh failed after 401: {e}")
        else:
            log(f"Unexpected response: HTTP {code}: {str(data)[:300]}")

        iteration += 1
        time.sleep(POLL_INTERVAL)

    # Timeout
    elapsed_total = (time.time() - start_time) / 60
    msg = f"TIMEOUT after {elapsed_total:.1f} minutes ({MAX_ITERATIONS} iterations). Last status: {final_status}"
    log(msg)
    results.append(msg)
    results.append(f"Last known data: {json.dumps(final_data, indent=2)[:500]}")
    results.append("")
    results.append("TIMEOUT - Pipeline did not complete within 4 hours.")
    write_results(results)
    sys.exit(1)


if __name__ == '__main__':
    main()
