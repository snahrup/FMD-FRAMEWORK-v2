#!/usr/bin/env python3
"""
fix_pipeline_guids.py — Fix ALL pipeline cross-reference GUIDs in the Fabric workspace.

The deployment created pipelines with template IDs from the repo, but never updated
the internal cross-references (InvokePipeline, Notebook activities, etc.) to point
to the actual workspace item IDs.
"""

import base64
import json
import os
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

# ── Config ──
TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = ""
FABRIC_API = "https://api.fabric.microsoft.com/v1"

CODE_WS = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"
DATA_WS = "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a"

env_path = os.path.join(os.path.dirname(__file__), "dashboard", "app", "api", ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                CLIENT_SECRET = line.split("=", 1)[1].strip()

_token_cache = {"token": None, "expires": 0}

def get_token():
    if _token_cache["token"] and time.time() < _token_cache["expires"] - 60:
        return _token_cache["token"]
    data = urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope": "https://api.fabric.microsoft.com/.default",
    }).encode()
    req = Request(f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
                  data=data, method="POST")
    with urlopen(req) as resp:
        result = json.loads(resp.read())
    _token_cache["token"] = result["access_token"]
    _token_cache["expires"] = time.time() + result.get("expires_in", 3600)
    return _token_cache["token"]


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
        loc = e.headers.get("Location", "") if hasattr(e, "headers") else ""
        return e.code, raw[:500], loc


def wait_op(loc, max_wait=60):
    if not loc:
        return True
    for _ in range(max_wait // 3):
        time.sleep(3)
        req = Request(loc, headers={"Authorization": f"Bearer {get_token()}"})
        try:
            with urlopen(req) as resp:
                result = json.loads(resp.read())
                if result.get("status") == "Succeeded":
                    return True
                if result.get("status") == "Failed":
                    print(f"    FAILED: {result.get('error', {})}")
                    return False
        except HTTPError:
            pass
    return False


def get_definition(ws_id, item_id):
    """Get pipeline definition, handling async."""
    status, data, loc = api("POST", f"workspaces/{ws_id}/items/{item_id}/getDefinition")
    if status == 200 and data:
        return data
    if loc:
        if wait_op(loc, 30):
            # Fetch result
            req = Request(f"{loc}/result",
                          headers={"Authorization": f"Bearer {get_token()}"})
            try:
                with urlopen(req) as resp:
                    return json.loads(resp.read())
            except HTTPError:
                pass
    return None


def main():
    print("=" * 70)
    print("Fix Pipeline Cross-Reference GUIDs")
    print("=" * 70)

    get_token()
    print("[OK] Authenticated\n")

    # ── Step 1: Get all items in both workspaces ──
    print("Step 1: Discovering workspace items...")

    _, code_data, _ = api("GET", f"workspaces/{CODE_WS}/items")
    _, data_data, _ = api("GET", f"workspaces/{DATA_WS}/items")

    ws_items = {}  # name -> actual ID
    for item in code_data.get("value", []):
        ws_items[item["displayName"]] = item["id"]
    for item in data_data.get("value", []):
        ws_items[item["displayName"]] = item["id"]

    print(f"  Found {len(ws_items)} items across both workspaces")

    # ── Step 2: Build old → new GUID mapping ──
    print("\nStep 2: Building GUID mapping...")

    with open(os.path.join(os.path.dirname(__file__), "config", "item_deployment.json")) as f:
        deploy_items = json.load(f)

    guid_map = {}

    # Map deployment template IDs → actual workspace IDs
    for item in deploy_items:
        short_name = item["name"].split(".")[0]
        old_id = item["id"]
        new_id = ws_items.get(short_name, "")
        if new_id and old_id != new_id:
            guid_map[old_id] = new_id

    print(f"  {len(guid_map)} GUID mappings built")
    for old, new in sorted(guid_map.items(), key=lambda x: x[1]):
        # Find the name
        name = next((i["name"].split(".")[0] for i in deploy_items if i["id"] == old), "?")
        print(f"    {name}: {old[:8]}... -> {new[:8]}...")

    # ── Step 3: Get and fix each pipeline definition ──
    print("\nStep 3: Fixing pipeline definitions...")

    pipelines = [(item["displayName"], item["id"])
                 for item in code_data.get("value", [])
                 if item.get("type") == "DataPipeline"]

    fixed = 0
    skipped = 0

    for pl_name, pl_id in sorted(pipelines):
        # Read local definition from repo
        local_path = os.path.join(os.path.dirname(__file__), "src",
                                  f"{pl_name}.DataPipeline", "pipeline-content.json")
        if not os.path.exists(local_path):
            print(f"  [SKIP] {pl_name} — no local definition")
            skipped += 1
            continue

        with open(local_path) as f:
            content = f.read()

        # Count and apply replacements
        total_replacements = 0
        for old_id, new_id in guid_map.items():
            count = content.count(old_id)
            if count > 0:
                content = content.replace(old_id, new_id)
                total_replacements += count

        if total_replacements == 0:
            print(f"  [OK] {pl_name} — no GUIDs to fix")
            skipped += 1
            continue

        # Upload fixed definition
        encoded = base64.b64encode(content.encode()).decode()
        status, data, loc = api("POST",
            f"workspaces/{CODE_WS}/items/{pl_id}/updateDefinition", {
                "definition": {
                    "parts": [{
                        "path": "pipeline-content.json",
                        "payload": encoded,
                        "payloadType": "InlineBase64",
                    }]
                }
            })

        if status in (200, 202):
            if loc:
                wait_op(loc)
            print(f"  [FIXED] {pl_name} — {total_replacements} GUIDs replaced")
            fixed += 1
        else:
            print(f"  [FAIL] {pl_name} — HTTP {status}")

        time.sleep(0.3)  # throttle

    print(f"\n{'=' * 70}")
    print(f"DONE — {fixed} pipelines fixed, {skipped} skipped")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
