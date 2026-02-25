#!/usr/bin/env python3
"""Comprehensive scan of ALL workspace pipeline definitions for issues."""

import base64
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
CODE_WS = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"
OLD_WS_GUID = "1d947c6d-4350-48c5-8b98-9c21d8862fe7"

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

def api(method, path, body=None):
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"{FABRIC_API}/{path}"
    req = Request(url, headers=headers, method=method)
    if body:
        req.data = json.dumps(body).encode()
    try:
        with urlopen(req) as resp:
            raw = resp.read()
            loc = resp.headers.get("Location", "")
            return resp.status, json.loads(raw) if raw and raw != b"null" else None, loc
    except HTTPError as e:
        raw = e.read().decode()
        return e.code, raw[:500], ""

def wait_op(loc, max_wait=30):
    if not loc: return True
    for _ in range(max_wait // 3):
        time.sleep(3)
        req = Request(loc, headers={"Authorization": f"Bearer {get_token()}"})
        try:
            with urlopen(req) as resp:
                result = json.loads(resp.read())
                if result.get("status") in ("Succeeded","Failed"):
                    return result.get("status") == "Succeeded"
        except HTTPError: pass
    return False

def get_definition(ws_id, item_id):
    status, data, loc = api("POST", f"workspaces/{ws_id}/items/{item_id}/getDefinition")
    if status == 200 and data: return data
    if loc:
        if wait_op(loc, 30):
            req = Request(f"{loc}/result", headers={"Authorization": f"Bearer {get_token()}"})
            try:
                with urlopen(req) as resp: return json.loads(resp.read())
            except HTTPError: pass
    return None

def main():
    get_token()
    print("[OK] Authenticated\n")

    # Get all items
    _, code_data, _ = api("GET", f"workspaces/{CODE_WS}/items")
    items_by_id = {}
    for item in code_data.get("value", []):
        items_by_id[item["id"]] = item

    pipelines = [(item["displayName"], item["id"])
                 for item in code_data.get("value", [])
                 if item.get("type") == "DataPipeline"]

    pipeline_ids = {item["id"]: item["displayName"] for item in code_data.get("value", [])
                    if item.get("type") == "DataPipeline"}

    print(f"Scanning {len(pipelines)} pipelines...\n")

    bool_issues = []
    old_guid_issues = []
    bad_pipeline_refs = []

    for pl_name, pl_id in sorted(pipelines):
        defn = get_definition(CODE_WS, pl_id)
        if not defn:
            print(f"  [SKIP] {pl_name} - could not get definition")
            continue

        for part in defn.get("definition", {}).get("parts", []):
            if part["path"] != "pipeline-content.json":
                continue

            content = base64.b64decode(part["payload"]).decode()
            pipeline_json = json.loads(content)
            props = pipeline_json.get("properties", {})

            # Check 1: Bool type in libraryVariables
            lib_vars = props.get("libraryVariables", {})
            for var_name, var_def in lib_vars.items():
                if var_def.get("type") == "Bool":
                    bool_issues.append(f"{pl_name}: {var_name}")

            # Check 2: Old workspace GUID in content
            if OLD_WS_GUID in content:
                count = content.count(OLD_WS_GUID)
                old_guid_issues.append(f"{pl_name}: {count} occurrences")

            # Check 3: InvokePipeline references point to real pipelines
            def check_activities(activities, prefix=""):
                for act in activities:
                    if act.get("type") == "InvokePipeline":
                        pid = act["typeProperties"].get("pipelineId", "")
                        wid = act["typeProperties"].get("workspaceId", "")
                        if wid == "00000000-0000-0000-0000-000000000000":
                            # Same workspace - check if pipeline exists
                            if pid not in pipeline_ids:
                                bad_pipeline_refs.append(
                                    f"{pl_name}/{prefix}{act['name']}: pipelineId={pid} NOT FOUND in workspace")
                    elif act.get("type") == "ForEach":
                        inner = act.get("typeProperties", {}).get("activities", [])
                        check_activities(inner, f"{act['name']}/")
                    elif act.get("type") == "Switch":
                        for case in act.get("typeProperties", {}).get("cases", []):
                            check_activities(case.get("activities", []), f"{act['name']}/{case['value']}/")
                        check_activities(act.get("typeProperties", {}).get("defaultActivities", []), f"{act['name']}/default/")

            check_activities(props.get("activities", []))
            break

        time.sleep(0.2)

    # Report
    print("\n" + "=" * 70)
    print("SCAN RESULTS")
    print("=" * 70)

    print(f"\n--- Bool type issues ({len(bool_issues)}) ---")
    if bool_issues:
        for issue in bool_issues:
            print(f"  [PROBLEM] {issue}")
    else:
        print("  None found!")

    print(f"\n--- Old workspace GUID issues ({len(old_guid_issues)}) ---")
    if old_guid_issues:
        for issue in old_guid_issues:
            print(f"  [PROBLEM] {issue}")
    else:
        print("  None found!")

    print(f"\n--- Bad pipeline references ({len(bad_pipeline_refs)}) ---")
    if bad_pipeline_refs:
        for issue in bad_pipeline_refs:
            print(f"  [PROBLEM] {issue}")
    else:
        print("  None found!")

    print(f"\n{'=' * 70}")
    if bool_issues or old_guid_issues or bad_pipeline_refs:
        print(f"ISSUES FOUND: {len(bool_issues)} Bool, {len(old_guid_issues)} old GUIDs, {len(bad_pipeline_refs)} bad refs")
    else:
        print("ALL CLEAN - no issues found")
    print("=" * 70)

if __name__ == "__main__":
    main()
