"""
Overnight Deploy & Load Orchestrator
=====================================
Fire and forget. This script:
1. Waits for NB_SETUP_FMD notebook to finish (deploys SQL schema)
2. Re-runs deploy_from_scratch.py phases 11, 13, 16 (SQL metadata, entities, digest)
3. Starts the v3 engine to load all sources: LZ → Bronze → Silver

Usage:
  python scripts/overnight_deploy_and_load.py
"""

import json
import os
import sys
import time
import struct
import subprocess
import urllib.request
import urllib.parse
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Load secrets
env_path = os.path.join(PROJECT_ROOT, "dashboard", "app", "api", ".env")
with open(env_path) as f:
    for line in f:
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1)
            os.environ[k] = v

# IDs
TENANT = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = os.environ["FABRIC_CLIENT_SECRET"]
CONFIG_WS = "e1f70591-6780-4d93-84bc-ba4572513e5c"
NB_SETUP_ID = "52258262-5448-4c49-a708-2a3d7f470c7e"

ENGINE_URL = "http://localhost:8787/api"


def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def get_fabric_token():
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT,
        "client_secret": SECRET,
        "scope": "https://api.fabric.microsoft.com/.default",
    }).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def get_sql_token():
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT,
        "client_secret": SECRET,
        "scope": "https://database.windows.net/.default",
    }).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


# ── Step 1: Wait for NB_SETUP_FMD ──────────────────────────────────────────

def wait_for_notebook():
    log("=" * 60)
    log("STEP 1: Waiting for NB_SETUP_FMD to finish...")
    log("=" * 60)

    token = get_fabric_token()
    url = f"https://api.fabric.microsoft.com/v1/workspaces/{CONFIG_WS}/items/{NB_SETUP_ID}/jobs/instances?limit=1"

    for i in range(360):  # up to 2 hours (360 * 20s)
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(req) as resp:
                jobs = json.loads(resp.read())

            if not jobs.get("value"):
                log("  No job instances found. Notebook may not have been triggered.")
                return "NoJob"

            job = jobs["value"][0]
            status = job["status"]
            started = job.get("startTimeUtc", "?")

            if status in ("Completed", "Failed", "Cancelled"):
                log(f"  Notebook finished: {status} (started: {started})")
                if job.get("failureReason"):
                    log(f"  Failure reason: {job['failureReason']}")
                return status

            elapsed_min = i * 20 / 60
            log(f"  [{elapsed_min:.0f}min] Status: {status}")

        except Exception as e:
            log(f"  Poll error: {e}")
            # Refresh token if expired
            try:
                token = get_fabric_token()
            except Exception:
                pass

        time.sleep(20)

    log("  Timed out after 2 hours. Proceeding anyway...")
    return "Timeout"


# ── Step 2: Re-run failed deploy phases ─────────────────────────────────────

def run_deploy_phases():
    log("")
    log("=" * 60)
    log("STEP 2: Re-running deploy phases 11, 13, 16...")
    log("=" * 60)

    # Reset state to allow re-running these phases
    state_path = os.path.join(PROJECT_ROOT, ".deploy_state.json")
    with open(state_path) as f:
        state = json.load(f)

    # Remove 11, 13, 16 from completed so they'll run again
    state["completed_phases"] = [p for p in state["completed_phases"] if p not in (11, 13, 16)]
    with open(state_path, "w") as f:
        json.dump(state, f, indent=2)

    # Run deploy script for just those phases, skipping everything else
    skip_phases = [7, 8, 9, 10, 12, 14, 15, 17]
    cmd = [
        sys.executable, os.path.join(PROJECT_ROOT, "deploy_from_scratch.py"),
        "--resume", "--env", "dev",
    ]
    for p in skip_phases:
        cmd.extend(["--skip-phase", str(p)])

    log(f"  Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=PROJECT_ROOT)
    print(result.stdout)
    if result.stderr:
        print(result.stderr)

    if result.returncode != 0:
        log(f"  Deploy exited with code {result.returncode}")
        return False

    log("  Deploy phases complete!")
    return True


# ── Step 3: Verify SQL schema exists ────────────────────────────────────────

def verify_sql_schema():
    log("")
    log("=" * 60)
    log("STEP 3: Verifying SQL schema...")
    log("=" * 60)

    import pyodbc

    config_path = os.path.join(PROJECT_ROOT, "dashboard", "app", "api", "config.json")
    with open(config_path) as f:
        cfg = json.load(f)

    server = cfg["sql"]["server"]
    database = cfg["sql"]["database"]

    token = get_sql_token()
    token_bytes = token.encode("UTF-16-LE")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

    conn = pyodbc.connect(
        f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server};DATABASE={database};"
        "Encrypt=yes;TrustServerCertificate=no;",
        attrs_before={1256: token_struct},
    )
    cursor = conn.cursor()

    # Check tables
    cursor.execute("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA IN ('integration','execution','logging')")
    table_count = cursor.fetchone()[0]

    # Check stored procs
    cursor.execute("SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA IN ('integration','execution','logging')")
    proc_count = cursor.fetchone()[0]

    # Check entities
    entity_count = 0
    try:
        cursor.execute("SELECT COUNT(*) FROM integration.LandingzoneEntity")
        entity_count = cursor.fetchone()[0]
    except Exception:
        pass

    conn.close()

    log(f"  Tables: {table_count}")
    log(f"  Stored Procs: {proc_count}")
    log(f"  Entities registered: {entity_count}")

    if table_count == 0:
        log("  ERROR: No tables found! NB_SETUP_FMD may have failed.")
        return False

    return True


# ── Step 4: Start v3 engine load ────────────────────────────────────────────

def start_engine_load():
    log("")
    log("=" * 60)
    log("STEP 4: Starting v3 engine overnight load...")
    log("=" * 60)

    try:
        # Check engine status
        req = urllib.request.Request(f"{ENGINE_URL}/engine/status")
        with urllib.request.urlopen(req) as resp:
            status = json.loads(resp.read())
        log(f"  Engine status: {status.get('state', 'unknown')}")

        # Start full load - all layers
        payload = json.dumps({
            "mode": "run",
            "layers": ["landing", "bronze", "silver"],
            "triggered_by": "overnight_script",
        }).encode()
        req = urllib.request.Request(
            f"{ENGINE_URL}/engine/start",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())

        run_id = result.get("run_id", "unknown")
        log(f"  Load started! Run ID: {run_id}")
        log(f"  Monitor at: http://localhost:8787 → Engine Control")
        return True

    except Exception as e:
        log(f"  Failed to start engine: {e}")
        log("  The dashboard server may not be running.")
        log("  Start it with: cd dashboard/app/api && python server.py")
        return False


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    start = time.time()
    log("=" * 60)
    log("  OVERNIGHT DEPLOY & LOAD ORCHESTRATOR")
    log(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log("=" * 60)

    # Step 1: Wait for notebook
    nb_status = wait_for_notebook()
    if nb_status == "Failed":
        log("\nNB_SETUP_FMD FAILED. Cannot proceed without SQL schema.")
        log("Check the notebook in Fabric portal for error details.")
        sys.exit(1)

    # Step 2: Verify schema
    schema_ok = verify_sql_schema()
    if not schema_ok:
        log("\nSQL schema not ready. Waiting 2 more minutes and retrying...")
        time.sleep(120)
        schema_ok = verify_sql_schema()
        if not schema_ok:
            log("\nSQL schema still not ready. Exiting.")
            sys.exit(1)

    # Step 3: Re-run deploy phases
    deploy_ok = run_deploy_phases()
    if not deploy_ok:
        log("\nDeploy phases had errors. Check output above.")
        log("Attempting engine load anyway...")

    # Step 4: Start engine
    engine_ok = start_engine_load()

    elapsed = time.time() - start
    log("")
    log("=" * 60)
    log(f"  ORCHESTRATOR COMPLETE — {elapsed/60:.1f} minutes")
    log(f"  Notebook: {nb_status}")
    log(f"  Schema: {'OK' if schema_ok else 'FAILED'}")
    log(f"  Deploy: {'OK' if deploy_ok else 'FAILED'}")
    log(f"  Engine: {'STARTED' if engine_ok else 'FAILED'}")
    log("=" * 60)


if __name__ == "__main__":
    main()
