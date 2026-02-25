#!/usr/bin/env python3
"""Get detailed pipeline run activity results to find the REAL error."""

import json
import os
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = ""
FABRIC_API = "https://api.fabric.microsoft.com/v1"

# Correct workspace IDs
CODE_WS_DEV = "0bd63996-3a38-493b-825e-b6f26a04ae99"
DATA_WS_DEV = "1d947c6d-4350-48c5-8b98-9c21d8862fe7"

env_path = os.path.join(os.path.dirname(__file__), "dashboard", "app", "api", ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                CLIENT_SECRET = line.split("=", 1)[1].strip()

_token_cache = {}
def get_token(scope="https://api.fabric.microsoft.com/.default"):
    key = scope
    if key in _token_cache and time.time() < _token_cache[key]["expires"] - 60:
        return _token_cache[key]["token"]
    data = urlencode({"grant_type":"client_credentials","client_id":CLIENT_ID,
        "client_secret":CLIENT_SECRET,"scope":scope}).encode()
    req = Request(f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
                  data=data, method="POST")
    with urlopen(req) as resp:
        result = json.loads(resp.read())
    _token_cache[key] = {"token":result["access_token"],"expires":time.time()+result.get("expires_in",3600)}
    return _token_cache[key]["token"]

def api_get(path):
    token = get_token()
    req = Request(f"{FABRIC_API}/{path}", headers={"Authorization": f"Bearer {token}"})
    try:
        with urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except HTTPError as e:
        raw = e.read().decode()
        return e.code, raw[:1000]

def main():
    get_token()
    print("[OK] Authenticated\n")

    # Get all items in CODE workspace to find pipeline IDs
    print("=== Finding pipeline items ===")
    status, data = api_get(f"workspaces/{CODE_WS_DEV}/items")
    if status != 200:
        print(f"ERROR getting items: {status} {data}")
        return
    
    pipelines = {}
    for item in data.get("value", []):
        if item.get("type") == "DataPipeline":
            pipelines[item["displayName"]] = item["id"]
    
    # Focus on PL_FMD_LOAD_ALL and PL_FMD_LOAD_LANDINGZONE
    targets = ["PL_FMD_LOAD_ALL", "PL_FMD_LOAD_LANDINGZONE", "PL_FMD_LDZ_COMMAND_ASQL"]
    for name in targets:
        pid = pipelines.get(name)
        if not pid:
            print(f"  {name}: NOT FOUND")
            continue
        print(f"  {name}: {pid}")

    # Try getting job instances for each target pipeline
    print("\n=== Recent pipeline runs (job instances) ===")
    for name in targets:
        pid = pipelines.get(name)
        if not pid:
            continue
        
        print(f"\n--- {name} ---")
        status, data = api_get(f"workspaces/{CODE_WS_DEV}/items/{pid}/jobs/instances?limit=3")
        if status == 200:
            instances = data.get("value", [])
            if not instances:
                print("  No recent runs")
                continue
            for inst in instances:
                print(f"  Run ID: {inst.get('id', '?')}")
                print(f"  Status: {inst.get('status', '?')}")
                print(f"  Start: {inst.get('startTimeUtc', '?')}")
                print(f"  End: {inst.get('endTimeUtc', '?')}")
                print(f"  Invoker: {inst.get('invokeType', '?')}")
                # Check for failure details
                fail = inst.get("failureReason", {})
                if fail:
                    print(f"  Failure: {json.dumps(fail)[:500]}")
                # Check for rootActivityRunId or other details
                for k, v in inst.items():
                    if k not in ("id", "status", "startTimeUtc", "endTimeUtc", "invokeType", "failureReason", "itemId"):
                        print(f"  {k}: {str(v)[:200]}")
                print()
        else:
            print(f"  Error: {status} - {str(data)[:300]}")

    # Also try the monitoring API endpoint (different from items API)
    print("\n=== Trying monitoring/activity endpoint ===")
    for name in targets:
        pid = pipelines.get(name)
        if not pid:
            continue
        
        # Try the /getItemJobInstances endpoint
        status, data = api_get(f"workspaces/{CODE_WS_DEV}/items/{pid}/jobs/instances")
        if status == 200:
            for inst in data.get("value", [])[:1]:
                run_id = inst.get("id")
                if not run_id:
                    continue
                # Try to get detailed run info
                print(f"\n--- Activity details for {name} run {run_id} ---")
                
                # Try querying activity runs within this pipeline run
                detail_status, detail_data = api_get(
                    f"workspaces/{CODE_WS_DEV}/items/{pid}/jobs/instances/{run_id}"
                )
                if detail_status == 200:
                    print(f"  Full detail: {json.dumps(detail_data)[:1000]}")
                else:
                    print(f"  Detail error: {detail_status} - {str(detail_data)[:300]}")

    # Also check: what parameters does PL_FMD_LOAD_ALL actually pass?
    print("\n=== PL_FMD_LOAD_ALL parameter check ===")
    import base64
    pid = pipelines.get("PL_FMD_LOAD_ALL")
    if pid:
        status, data = api_get(f"workspaces/{CODE_WS_DEV}/items/{pid}/getDefinition")
        if status == 200 and data:
            for part in data.get("definition", {}).get("parts", []):
                if part["path"] == "pipeline-content.json":
                    content = json.loads(base64.b64decode(part["payload"]).decode())
                    
                    # Show pipeline parameters
                    params = content.get("properties", {}).get("parameters", {})
                    print(f"  Pipeline parameters: {json.dumps(params, indent=2)[:500]}")
                    
                    # Find InvokePipeline activities and show their parameter bindings
                    for act in content.get("properties", {}).get("activities", []):
                        if act.get("type") == "InvokePipeline":
                            tp = act.get("typeProperties", {})
                            print(f"\n  Activity: {act['name']}")
                            print(f"    Pipeline ref: {tp.get('pipeline', {}).get('referenceName', '?')}")
                            print(f"    Parameters: {json.dumps(tp.get('parameters', {}))[:300]}")
                            print(f"    WaitOnCompletion: {tp.get('waitOnCompletion', '?')}")

    # Check PL_FMD_LOAD_LANDINGZONE parameters and their defaults
    print("\n=== PL_FMD_LOAD_LANDINGZONE parameter defaults ===")
    pid = pipelines.get("PL_FMD_LOAD_LANDINGZONE")
    if pid:
        status, data = api_get(f"workspaces/{CODE_WS_DEV}/items/{pid}/getDefinition")
        if status == 200 and data:
            for part in data.get("definition", {}).get("parts", []):
                if part["path"] == "pipeline-content.json":
                    content = json.loads(base64.b64decode(part["payload"]).decode())
                    params = content.get("properties", {}).get("parameters", {})
                    for pname, pdef in sorted(params.items()):
                        print(f"  {pname}: type={pdef.get('type', '?')}, default={pdef.get('defaultValue', '(none)')}")


if __name__ == "__main__":
    main()
