"""
Check status of running Fabric notebook jobs for FMD Framework.
Lists all notebooks in CODE workspace and their recent job instances.
"""
import requests
import json
from datetime import datetime, timezone

# Config
TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
CODE_WORKSPACE = "c0366b24-e6f8-4994-b4df-b765ecb5bbf8"
DATA_WORKSPACE = "0596d0e7-e036-451d-a967-41a284302e8d"
FABRIC_API = "https://api.fabric.microsoft.com/v1"

# Step 1: Get SP token
def get_token():
    url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
    data = {
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope": "https://api.fabric.microsoft.com/.default"
    }
    r = requests.post(url, data=data)
    r.raise_for_status()
    return r.json()["access_token"]

def api_get(token, path, params=None):
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{FABRIC_API}{path}"
    r = requests.get(url, headers=headers, params=params)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()

def format_duration(start_str):
    """Return human-readable duration from ISO start time to now."""
    if not start_str:
        return "unknown"
    try:
        # Handle both Z and +00:00 suffix
        start_str = start_str.replace("Z", "+00:00")
        start = datetime.fromisoformat(start_str)
        now = datetime.now(timezone.utc)
        delta = now - start
        total_seconds = int(delta.total_seconds())
        if total_seconds < 0:
            return "0s"
        hours, rem = divmod(total_seconds, 3600)
        minutes, seconds = divmod(rem, 60)
        if hours:
            return f"{hours}h {minutes}m {seconds}s"
        elif minutes:
            return f"{minutes}m {seconds}s"
        else:
            return f"{seconds}s"
    except Exception as e:
        return f"parse-err({e})"

def main():
    print("=" * 70)
    print("FMD FRAMEWORK - FABRIC NOTEBOOK JOB STATUS CHECK")
    print(f"Run time (UTC): {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    print("\n[1] Authenticating via Service Principal...")
    token = get_token()
    print("    Token acquired.")

    # Check both workspaces for notebooks
    workspaces = {
        "CODE (Dev)": CODE_WORKSPACE,
        "DATA (Dev)": DATA_WORKSPACE,
    }

    all_notebooks = []

    for ws_label, ws_id in workspaces.items():
        print(f"\n[2] Listing Notebooks in workspace: {ws_label} ({ws_id})")
        result = api_get(token, f"/workspaces/{ws_id}/items", params={"type": "Notebook"})
        if not result:
            print(f"    No result / 404 for workspace {ws_id}")
            continue
        items = result.get("value", [])
        print(f"    Found {len(items)} notebooks.")
        for item in items:
            all_notebooks.append({
                "ws_label": ws_label,
                "ws_id": ws_id,
                "id": item.get("id"),
                "displayName": item.get("displayName", "(no name)"),
            })

    if not all_notebooks:
        print("\nNo notebooks found in either workspace.")
        return

    print(f"\n[3] Checking job instances for {len(all_notebooks)} notebooks...")
    print("-" * 70)

    # Track notebooks with active/recent jobs
    active_jobs = []
    recent_jobs = []

    for nb in all_notebooks:
        nb_name = nb["displayName"]
        nb_id = nb["id"]
        ws_id = nb["ws_id"]
        ws_label = nb["ws_label"]

        jobs_result = api_get(token, f"/workspaces/{ws_id}/items/{nb_id}/jobs/instances")
        if jobs_result is None:
            # 404 or no jobs endpoint
            continue

        job_list = jobs_result.get("value", [])
        if not job_list:
            continue

        # Sort by start time descending
        def sort_key(j):
            return j.get("startTimeUtc") or j.get("endTimeUtc") or ""
        job_list.sort(key=sort_key, reverse=True)

        # Take the most recent job
        latest = job_list[0]
        status = latest.get("status", "Unknown")
        job_id = latest.get("id", "?")
        start_time = latest.get("startTimeUtc", "")
        end_time = latest.get("endTimeUtc", "")
        job_type = latest.get("jobType", "")
        failure_reason = latest.get("failureReason", None)

        # Calculate duration
        if status in ("Running", "InProgress", "NotStarted", "Queued"):
            duration = format_duration(start_time) + " (still running)"
        elif end_time and start_time:
            # Parse both and get diff
            start_str = start_time.replace("Z", "+00:00")
            end_str = end_time.replace("Z", "+00:00")
            try:
                s = datetime.fromisoformat(start_str)
                e = datetime.fromisoformat(end_str)
                delta = e - s
                total_seconds = int(delta.total_seconds())
                hours, rem = divmod(total_seconds, 3600)
                minutes, seconds = divmod(rem, 60)
                if hours:
                    duration = f"{hours}h {minutes}m {seconds}s (completed)"
                elif minutes:
                    duration = f"{minutes}m {seconds}s (completed)"
                else:
                    duration = f"{seconds}s (completed)"
            except:
                duration = "?"
        else:
            duration = "?"

        # Format start time nicely
        start_display = start_time.replace("T", " ").replace("Z", " UTC")[:22] if start_time else "?"

        entry = {
            "ws_label": ws_label,
            "name": nb_name,
            "id": nb_id,
            "job_id": job_id,
            "job_type": job_type,
            "status": status,
            "start_time": start_display,
            "duration": duration,
            "failure_reason": failure_reason,
            "all_jobs_count": len(job_list),
        }

        if status in ("Running", "InProgress", "NotStarted", "Queued"):
            active_jobs.append(entry)
        else:
            recent_jobs.append(entry)

    # Print active jobs first
    print("\n*** ACTIVE / IN-PROGRESS JOBS ***")
    if not active_jobs:
        print("  (none currently running)")
    else:
        for j in active_jobs:
            print(f"\n  Notebook : {j['name']}")
            print(f"  WS       : {j['ws_label']}")
            print(f"  Item ID  : {j['id']}")
            print(f"  Job ID   : {j['job_id']}")
            print(f"  Type     : {j['job_type']}")
            print(f"  Status   : {j['status']}")
            print(f"  Started  : {j['start_time']}")
            print(f"  Duration : {j['duration']}")
            if j["failure_reason"]:
                print(f"  Failure  : {j['failure_reason']}")

    print("\n*** RECENT COMPLETED/FAILED JOBS (last run per notebook) ***")
    if not recent_jobs:
        print("  (none)")
    else:
        # Sort by status: Failed first, then Succeeded
        recent_jobs.sort(key=lambda x: (0 if "fail" in x["status"].lower() else 1, x["name"]))
        for j in recent_jobs:
            status_label = j["status"]
            print(f"\n  Notebook : {j['name']}")
            print(f"  WS       : {j['ws_label']}")
            print(f"  Status   : {status_label}")
            print(f"  Job ID   : {j['job_id']}")
            print(f"  Started  : {j['start_time']}")
            print(f"  Duration : {j['duration']}")
            if j["failure_reason"]:
                print(f"  Failure  : {j['failure_reason']}")

    print("\n" + "=" * 70)
    print(f"SUMMARY: {len(active_jobs)} active job(s), {len(recent_jobs)} notebook(s) with recent completed/failed runs")
    print("=" * 70)

    # Also dump raw job data for active jobs for debugging
    if active_jobs:
        print("\n[DEBUG] Full job payloads for active jobs:")
        for j in active_jobs:
            ws_id = CODE_WORKSPACE if "CODE" in j["ws_label"] else DATA_WORKSPACE
            jobs_result = api_get(token, f"/workspaces/{ws_id}/items/{j['id']}/jobs/instances")
            if jobs_result:
                job_list = jobs_result.get("value", [])
                for jj in job_list[:3]:  # show up to 3 most recent per notebook
                    print(json.dumps(jj, indent=2))

if __name__ == "__main__":
    main()
