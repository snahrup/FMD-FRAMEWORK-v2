#!/usr/bin/env python3
"""Check actual Variable Library values in the workspace."""

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

    _, code_data, _ = api("GET", f"workspaces/{CODE_WS}/items")

    var_libs = [(item["displayName"], item["id"])
                for item in code_data.get("value", [])
                if item.get("type") == "VariableLibrary"]

    for name, item_id in sorted(var_libs):
        print(f"=== {name} (ID: {item_id}) ===")
        defn = get_definition(CODE_WS, item_id)
        if not defn:
            print("  Could not get definition")
            continue

        for part in defn.get("definition", {}).get("parts", []):
            if part["path"] == "variables.json":
                content = base64.b64decode(part["payload"]).decode()
                variables = json.loads(content)
                for var in variables.get("variables", []):
                    val = var.get("value", "")
                    # Mask secrets
                    display_val = val
                    if "secret" in var["name"].lower() and val:
                        display_val = val[:4] + "***" + val[-4:] if len(val) > 8 else "***"
                    print(f"  {var['name']} ({var['type']}): '{display_val}'")
                    if not val:
                        print(f"    ^^^ WARNING: EMPTY VALUE!")
        print()

    # Also check connections
    print("=== Fabric Connections ===")
    _, conn_data, _ = api("GET", f"workspaces/{CODE_WS}/connections")
    if isinstance(conn_data, dict):
        for conn in conn_data.get("value", []):
            print(f"  {conn.get('displayName', conn.get('id', '?'))}: {conn.get('id', '?')}")
            print(f"    type: {conn.get('connectionDetails', {}).get('type', '?')}")
            print(f"    path: {conn.get('connectionDetails', {}).get('path', '?')}")
    else:
        # Try workspace-level connections
        print(f"  Response: {str(conn_data)[:200]}")

    # Check connections via different API
    print("\n=== Connections via items API ===")
    for item in code_data.get("value", []):
        if "connection" in item.get("type", "").lower() or "CON_" in item.get("displayName", ""):
            print(f"  {item['displayName']}: type={item['type']}, id={item['id']}")

if __name__ == "__main__":
    main()
