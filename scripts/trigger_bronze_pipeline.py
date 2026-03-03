"""
Trigger and monitor the FMD Bronze pipeline via Fabric REST API.
Overnight autonomous run - 2026-02-26
"""
import urllib.request
import urllib.parse
import json
import time
import sys
import os
from datetime import datetime, timezone

# --- Config ---
TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = os.environ.get('FABRIC_CLIENT_SECRET', '')
CODE_WS = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
BRONZE_PIPELINE = '8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3'

BASE_URL = 'https://api.fabric.microsoft.com/v1'
POLL_INTERVAL = 60        # seconds between polls
TOKEN_REFRESH_EVERY = 40  # refresh token every N polls (~40 min)
MAX_ITERATIONS = 240      # 4 hours max
LOG_EVERY = 5             # log progress every N polls (5 min)

RESULTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'overnight_bronze_results.txt')

# --- Globals ---
token = None
token_acquired_at = None
start_time = None

def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    return line

def get_fabric_token():
    global token, token_acquired_at
    log("Acquiring Fabric API token...")
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': 'https://api.fabric.microsoft.com/.default',
    }).encode()
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=body,
        headers={'Content-Type': 'application/x-www-form-urlencoded'}
    )
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    token = data['access_token']
    token_acquired_at = time.time()
    log("Token acquired successfully.")
    return token

def api_get(url):
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    try:
        resp = urllib.request.urlopen(req)
        body = resp.read().decode()
        return resp.status, json.loads(body) if body else {}, dict(resp.headers)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ''
        return e.code, body, {}

def api_post(url, data=None):
    body = json.dumps(data).encode() if data else b''
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    try:
        resp = urllib.request.urlopen(req)
        resp_body = resp.read().decode()
        return resp.status, json.loads(resp_body) if resp_body else {}, dict(resp.headers)
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode() if e.fp else ''
        # 202 Accepted is normal for async operations - urllib treats it as success
        # but some versions might raise. Handle both.
        if e.code == 202:
            return 202, {}, dict(e.headers) if hasattr(e, 'headers') else {}
        return e.code, resp_body, dict(e.headers) if hasattr(e, 'headers') else {}

def check_active_runs():
    """Check if there's already an active Bronze pipeline run."""
    log("Checking for active Bronze pipeline runs...")
    url = f"{BASE_URL}/workspaces/{CODE_WS}/items/{BRONZE_PIPELINE}/jobs/instances?jobType=Pipeline"
    status, data, headers = api_get(url)

    if status != 200:
        log(f"WARNING: Failed to check active runs (HTTP {status}): {data}")
        return None

    # Look for InProgress runs
    if isinstance(data, dict) and 'value' in data:
        for run in data['value']:
            run_status = run.get('status', '')
            if run_status in ('InProgress', 'NotStarted', 'Running'):
                run_id = run.get('id', 'unknown')
                log(f"Found active run: {run_id} (status: {run_status})")
                return run

    log("No active runs found.")
    return None

def trigger_pipeline():
    """Trigger the Bronze pipeline and return the job monitoring URL."""
    log("Triggering Bronze pipeline (PL_FMD_LOAD_BRONZE)...")
    url = f"{BASE_URL}/workspaces/{CODE_WS}/items/{BRONZE_PIPELINE}/jobs/instances?jobType=Pipeline"
    status, data, headers = api_post(url)

    log(f"Trigger response: HTTP {status}")

    if status in (200, 201, 202):
        location = headers.get('Location', '')
        if location:
            log(f"Job location URL: {location}")
            return location
        # Try to find the job URL in response body
        if isinstance(data, dict) and 'id' in data:
            job_id = data['id']
            location = f"{BASE_URL}/workspaces/{CODE_WS}/items/{BRONZE_PIPELINE}/jobs/instances/{job_id}"
            log(f"Constructed job URL from response: {location}")
            return location
        # If no location, try to find the latest run
        log("No Location header in response. Will poll for latest run...")
        time.sleep(5)
        active = check_active_runs()
        if active and 'id' in active:
            job_id = active['id']
            location = f"{BASE_URL}/workspaces/{CODE_WS}/items/{BRONZE_PIPELINE}/jobs/instances/{job_id}"
            log(f"Found triggered run: {location}")
            return location
        log("WARNING: Could not determine job URL. Will still try to monitor.")
        return None
    else:
        log(f"ERROR: Failed to trigger pipeline. HTTP {status}: {data}")
        return None

def poll_job(job_url):
    """Poll a specific job URL until completion."""
    iteration = 0
    last_status = None

    while iteration < MAX_ITERATIONS:
        # Token refresh
        if iteration > 0 and iteration % TOKEN_REFRESH_EVERY == 0:
            try:
                get_fabric_token()
            except Exception as e:
                log(f"WARNING: Token refresh failed: {e}. Will retry next cycle.")

        # Poll
        status_code, data, headers = api_get(job_url)

        if status_code == 200 and isinstance(data, dict):
            job_status = data.get('status', 'Unknown')

            if job_status != last_status:
                log(f"Status changed: {last_status} -> {job_status}")
                last_status = job_status

            # Log progress periodically
            if iteration > 0 and iteration % LOG_EVERY == 0:
                elapsed = time.time() - start_time
                elapsed_min = elapsed / 60
                log(f"Progress: iteration {iteration}, elapsed {elapsed_min:.1f} min, status: {job_status}")

            # Terminal states
            if job_status in ('Completed', 'Failed', 'Cancelled'):
                return job_status, data
        elif status_code == 200:
            if iteration % LOG_EVERY == 0:
                log(f"Poll returned 200 but unexpected body: {str(data)[:200]}")
        else:
            log(f"WARNING: Poll returned HTTP {status_code}: {str(data)[:200]}")
            # Don't exit on transient errors

        iteration += 1
        time.sleep(POLL_INTERVAL)

    return 'TIMEOUT', {'message': f'Timed out after {MAX_ITERATIONS} iterations ({MAX_ITERATIONS * POLL_INTERVAL / 3600:.1f} hours)'}

def poll_by_instances():
    """Fallback: poll by checking the instances list instead of a specific job URL."""
    iteration = 0
    last_status = None

    url = f"{BASE_URL}/workspaces/{CODE_WS}/items/{BRONZE_PIPELINE}/jobs/instances?jobType=Pipeline"

    while iteration < MAX_ITERATIONS:
        if iteration > 0 and iteration % TOKEN_REFRESH_EVERY == 0:
            try:
                get_fabric_token()
            except Exception as e:
                log(f"WARNING: Token refresh failed: {e}")

        status_code, data, headers = api_get(url)

        if status_code == 200 and isinstance(data, dict) and 'value' in data:
            # Find the most recent run
            runs = data['value']
            if runs:
                latest = runs[0]  # Usually sorted by start time desc
                job_status = latest.get('status', 'Unknown')
                job_id = latest.get('id', 'unknown')

                if job_status != last_status:
                    log(f"[Job {job_id}] Status: {last_status} -> {job_status}")
                    last_status = job_status

                if iteration > 0 and iteration % LOG_EVERY == 0:
                    elapsed = time.time() - start_time
                    log(f"Progress: iteration {iteration}, elapsed {elapsed / 60:.1f} min, status: {job_status}")

                if job_status in ('Completed', 'Failed', 'Cancelled'):
                    return job_status, latest
        else:
            if iteration % LOG_EVERY == 0:
                log(f"WARNING: Instances poll HTTP {status_code}: {str(data)[:200]}")

        iteration += 1
        time.sleep(POLL_INTERVAL)

    return 'TIMEOUT', {'message': f'Timed out after {MAX_ITERATIONS} iterations'}

def write_results(final_status, details, duration_sec):
    """Write results to file."""
    duration_min = duration_sec / 60

    lines = [
        "=" * 60,
        "FMD Bronze Pipeline Run Results",
        f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "=" * 60,
        f"Pipeline: PL_FMD_LOAD_BRONZE",
        f"Pipeline GUID: {BRONZE_PIPELINE}",
        f"Workspace: {CODE_WS}",
        "",
        f"Final Status: {final_status}",
        f"Duration: {duration_min:.1f} minutes ({duration_sec:.0f} seconds)",
        "",
    ]

    if isinstance(details, dict):
        for key in ['id', 'status', 'startTimeUtc', 'endTimeUtc', 'failureReason']:
            if key in details:
                lines.append(f"  {key}: {details[key]}")

    lines.append("")
    lines.append("Context: Overnight autonomous run processing 5,872 entities")
    lines.append("Sources: MES, ETQ, M3 Cloud, M3 ERP (OPTIVA deferred - 0 LZ files)")
    lines.append("")

    if final_status == 'Completed':
        lines.append("RESULT: SUCCESS - Bronze pipeline completed successfully.")
    elif final_status == 'Failed':
        reason = details.get('failureReason', 'Unknown') if isinstance(details, dict) else str(details)
        lines.append(f"RESULT: FAILED - {reason}")
    elif final_status == 'Cancelled':
        lines.append("RESULT: CANCELLED - Pipeline was cancelled.")
    elif final_status == 'TIMEOUT':
        lines.append("RESULT: TIMEOUT - Pipeline did not complete within 4 hours.")
    else:
        lines.append(f"RESULT: UNKNOWN STATUS - {final_status}")

    lines.append("=" * 60)

    content = "\n".join(lines)
    with open(RESULTS_FILE, 'w') as f:
        f.write(content)

    log(f"Results written to {RESULTS_FILE}")
    return content

def main():
    global start_time
    start_time = time.time()

    log("=" * 60)
    log("FMD Bronze Pipeline - Overnight Autonomous Run")
    log(f"Pipeline: PL_FMD_LOAD_BRONZE ({BRONZE_PIPELINE})")
    log(f"Workspace: {CODE_WS}")
    log("=" * 60)

    # Step 1: Get token
    try:
        get_fabric_token()
    except Exception as e:
        log(f"FATAL: Cannot acquire token: {e}")
        write_results('FAILED', {'failureReason': f'Token acquisition failed: {e}'}, time.time() - start_time)
        sys.exit(1)

    # Step 2: Check for active runs
    active_run = check_active_runs()
    job_url = None

    if active_run:
        run_id = active_run.get('id', '')
        run_status = active_run.get('status', '')
        log(f"Active run found: {run_id} (status: {run_status})")
        if run_id:
            job_url = f"{BASE_URL}/workspaces/{CODE_WS}/items/{BRONZE_PIPELINE}/jobs/instances/{run_id}"
            log(f"Will monitor existing run at: {job_url}")

    # Step 3: Trigger if no active run
    if not active_run:
        try:
            job_url = trigger_pipeline()
        except Exception as e:
            log(f"ERROR: Failed to trigger pipeline: {e}")
            write_results('FAILED', {'failureReason': f'Trigger failed: {e}'}, time.time() - start_time)
            sys.exit(1)

    # Step 4: Monitor
    log("Starting monitoring loop...")
    if job_url:
        final_status, details = poll_job(job_url)
    else:
        log("No specific job URL available. Polling instances list...")
        final_status, details = poll_by_instances()

    duration = time.time() - start_time

    # Step 5: Results
    log(f"Pipeline finished with status: {final_status}")
    log(f"Total duration: {duration / 60:.1f} minutes")

    result_content = write_results(final_status, details, duration)
    print("\n" + result_content)

    if final_status == 'Completed':
        log("DONE - Bronze pipeline completed successfully.")
        sys.exit(0)
    else:
        log(f"FAILED - Bronze pipeline ended with status: {final_status}")
        sys.exit(1)

if __name__ == '__main__':
    main()
