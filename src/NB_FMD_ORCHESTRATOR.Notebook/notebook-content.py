"""
NB_FMD_ORCHESTRATOR - Fabric notebook to orchestrate the LOAD_ALL pipeline chain.

This notebook replaces PL_FMD_LOAD_ALL's InvokePipeline activities because
Fabric InvokePipeline does NOT support Service Principal authentication for
pipeline-to-pipeline execution (known limitation by design).

Instead, this notebook triggers each child pipeline directly via the
Fabric REST API using notebookutils.credentials.getToken() for auth.

Pipeline chain: LOAD_LANDINGZONE → LOAD_BRONZE → LOAD_SILVER

Schedule this notebook via Fabric's built-in scheduler to replace
PL_FMD_LOAD_ALL on a recurring basis.
"""

# %% [markdown]
# # FMD Pipeline Orchestrator
# Triggers LZ → Bronze → Silver sequentially via REST API

# %% Cell 1 - Config
import json
import time
from datetime import datetime

# Pipeline IDs in CODE workspace
WS_CODE = "c0366b24-e6f8-4994-b4df-b765ecb5bbf8"
API_BASE = "https://api.fabric.microsoft.com/v1"

PIPELINES = {
    "LOAD_LANDINGZONE": "3d0b3b2b-a069-40dc-b735-d105f9e66838",
    "LOAD_BRONZE":      "8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3",
    "LOAD_SILVER":      "90c0535c-c5dc-43a3-b51e-c44ef1808a60",
}

POLL_INTERVAL = 15  # seconds
MAX_POLL_TIME = 7200  # 2 hours max per pipeline

def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}')

# %% Cell 2 - Helper functions
import urllib.request
import urllib.error

def get_token():
    """Get Fabric API token using notebook's built-in auth."""
    return notebookutils.credentials.getToken("https://api.fabric.microsoft.com")

def api_call(token, url, method="GET", data=None):
    """Make authenticated API call."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        resp = urllib.request.urlopen(req)
        return resp.status, resp.headers, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()

def trigger_pipeline(token, name):
    """Trigger a pipeline and return run ID."""
    pid = PIPELINES[name]
    url = f"{API_BASE}/workspaces/{WS_CODE}/items/{pid}/jobs/instances?jobType=Pipeline"
    status, headers, body = api_call(token, url, method="POST", data={})

    if status in (200, 202):
        loc = headers.get("Location", "")
        run_id = loc.split("/")[-1] if loc else None
        return run_id
    else:
        log(f"  TRIGGER FAILED: HTTP {status}: {body.decode()[:300]}")
        return None

def poll_pipeline(token, name, run_id):
    """Poll until completion. Returns (status, duration_secs, failure)."""
    pid = PIPELINES[name]
    start = time.time()

    while True:
        elapsed = time.time() - start
        if elapsed > MAX_POLL_TIME:
            return "Timeout", elapsed, "Exceeded max poll time"

        time.sleep(POLL_INTERVAL)

        url = f"{API_BASE}/workspaces/{WS_CODE}/items/{pid}/jobs/instances/{run_id}"
        status_code, _, body = api_call(token, url)

        if status_code == 200:
            data = json.loads(body)
            run_status = data.get("status", "Unknown")
            failure = data.get("failureReason")

            if run_status in ("Completed", "Failed", "Cancelled"):
                failure_msg = failure.get("message", "")[:500] if failure else None
                return run_status, time.time() - start, failure_msg

            mins = int(elapsed // 60)
            secs = int(elapsed % 60)
            log(f"  [{mins}m{secs:02d}s] {name}: {run_status}")
        else:
            log(f"  Poll error: HTTP {status_code}")

# %% Cell 3 - Run orchestration
log("=" * 60)
log("FMD LOAD_ALL Orchestrator (Notebook)")
log("Chain: LOAD_LANDINGZONE → LOAD_BRONZE → LOAD_SILVER")
log("=" * 60)

token = get_token()
results = {}
total_start = time.time()

for name in ["LOAD_LANDINGZONE", "LOAD_BRONZE", "LOAD_SILVER"]:
    log(f"\n▶ Triggering PL_FMD_{name}...")
    run_id = trigger_pipeline(token, name)

    if not run_id:
        results[name] = {"status": "Failed", "duration": 0, "failure": "Could not trigger"}
        continue

    log(f"  Run ID: {run_id}")
    status, duration, failure = poll_pipeline(token, name, run_id)
    results[name] = {"status": status, "duration": duration, "failure": failure}

    mins = int(duration // 60)
    secs = int(duration % 60)

    if status == "Completed":
        log(f"  ✓ {name} completed in {mins}m{secs:02d}s")
    else:
        log(f"  ✗ {name} {status} after {mins}m{secs:02d}s")
        if failure:
            log(f"  Reason: {failure[:300]}")

    # Refresh token between long pipelines
    try:
        token = get_token()
    except:
        pass

# Summary
total_duration = time.time() - total_start
log(f"\n{'=' * 60}")
log(f"SUMMARY (total: {int(total_duration // 60)}m{int(total_duration % 60):02d}s)")
log("=" * 60)

all_ok = True
for name, r in results.items():
    icon = "✓" if r["status"] == "Completed" else "✗"
    log(f"  {icon} {name}: {r['status']} ({int(r['duration'] // 60)}m{int(r['duration'] % 60):02d}s)")
    if r["status"] != "Completed":
        all_ok = False

if all_ok:
    log("\nAll pipelines completed successfully!")
    mssparkutils.notebook.exit("SUCCESS")
else:
    log("\nSome pipelines failed. Check Fabric Monitoring Hub for details.")
    mssparkutils.notebook.exit("PARTIAL_FAILURE")
