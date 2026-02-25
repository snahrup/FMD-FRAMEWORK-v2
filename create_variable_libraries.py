#!/usr/bin/env python3
"""
create_variable_libraries.py — Deploy VAR_FMD and VAR_CONFIG_FMD to Fabric workspace.

Creates the missing Variable Libraries that PL_FMD_LOAD_ALL references at runtime.
"""

import base64
import json
import os
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

# ── Config ──
TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")
FABRIC_API = "https://api.fabric.microsoft.com/v1"

# CODE workspace where pipelines live
CODE_WORKSPACE_ID = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"

# Config workspace (where SQL DB lives)
CONFIG_WORKSPACE_ID = "f442f66c-eac6-46d7-80c9-c8b025c86fbe"

# SQL Database info
SQL_DB_ENDPOINT = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
SQL_DB_NAME = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"
SQL_DB_GUID = "501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"

# Load client secret from .env if not in environment
if not CLIENT_SECRET:
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
    req = Request(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data=data,
        method="POST",
    )
    with urlopen(req) as resp:
        result = json.loads(resp.read())
    _token_cache["token"] = result["access_token"]
    _token_cache["expires"] = time.time() + result.get("expires_in", 3600)
    return _token_cache["token"]


def fabric_request(method, path, body=None):
    token = get_token()
    url = f"{FABRIC_API}/{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    req = Request(url, headers=headers, method=method)
    if body:
        req.data = json.dumps(body).encode()
    try:
        with urlopen(req) as resp:
            status = resp.status
            raw = resp.read()
            data = json.loads(raw) if raw else {}
            return status, data
    except HTTPError as e:
        body_text = e.read().decode() if e.fp else ""
        print(f"  HTTP {e.code}: {body_text[:500]}")
        return e.code, body_text


def find_item(ws_id, name, item_type=None):
    """Find item by name in workspace."""
    path = f"workspaces/{ws_id}/items"
    if item_type:
        path += f"?type={item_type}"
    status, data = fabric_request("GET", path)
    if status == 200 and isinstance(data, dict):
        for item in data.get("value", []):
            if item.get("displayName") == name:
                return item
    return None


def build_definition_parts(src_dir):
    """Build Fabric API definition parts from source files."""
    parts = []
    for root, _, files in os.walk(src_dir):
        for fname in files:
            if fname == ".platform":
                continue
            fpath = os.path.join(root, fname)
            rel_path = os.path.relpath(fpath, src_dir).replace("\\", "/")
            with open(fpath, "rb") as f:
                content = f.read()
            parts.append({
                "path": rel_path,
                "payload": base64.b64encode(content).decode(),
                "payloadType": "InlineBase64",
            })
    return parts


def deploy_variable_library(ws_id, name, src_dir, variable_overrides=None):
    """Create or update a variable library in a workspace."""
    print(f"\n  Deploying {name} to workspace {ws_id[:8]}...")

    # Apply variable overrides to the local variables.json before uploading
    if variable_overrides:
        var_file = os.path.join(src_dir, "variables.json")
        with open(var_file) as f:
            var_data = json.load(f)
        for var in var_data.get("variables", []):
            if var["name"] in variable_overrides:
                var["value"] = variable_overrides[var["name"]]
        with open(var_file, "w") as f:
            json.dump(var_data, f, indent=2)
        print(f"  [OK] Updated variables.json with runtime values")

    # Check if already exists
    existing = find_item(ws_id, name, "VariableLibrary")
    if existing:
        item_id = existing["id"]
        print(f"  [EXISTS] {name} -> {item_id}")
    else:
        print(f"  [CREATE] {name}...")
        status, data = fabric_request("POST", f"workspaces/{ws_id}/items", {
            "displayName": name,
            "type": "VariableLibrary",
        })
        if status in (200, 201, 202) and isinstance(data, dict):
            item_id = data.get("id")
            print(f"  [CREATED] {name} -> {item_id}")
        else:
            print(f"  [FAIL] Could not create {name}: HTTP {status}")
            return False

    # Build and upload definition
    parts = build_definition_parts(src_dir)
    if not parts:
        print(f"  [SKIP] No definition parts for {name}")
        return False

    print(f"  [UPLOAD] {len(parts)} definition parts...")
    status, data = fabric_request("POST",
        f"workspaces/{ws_id}/items/{item_id}/updateDefinition",
        {"definition": {"parts": parts}}
    )
    if status in (200, 202):
        print(f"  [OK] {name} definition uploaded successfully")
        return True
    else:
        print(f"  [WARN] {name} upload returned HTTP {status}")
        return False


def main():
    if not CLIENT_SECRET:
        print("ERROR: FABRIC_CLIENT_SECRET not set")
        sys.exit(1)

    print("=" * 60)
    print("Deploy Variable Libraries to Fabric")
    print("=" * 60)

    # Test auth
    print("\nAuthenticating...")
    try:
        get_token()
        print("[OK] Authentication successful")
    except Exception as e:
        print(f"[FAIL] Auth failed: {e}")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))

    # ── VAR_FMD ──
    var_fmd_dir = os.path.join(script_dir, "src", "VAR_FMD.VariableLibrary")
    var_fmd_overrides = {
        "key_vault_uri_name": "",  # No Key Vault configured yet
        "key_vault_tenant_id": TENANT_ID,
        "key_vault_client_id": CLIENT_ID,
        "key_vault_client_secret": CLIENT_SECRET,
        "lakehouse_schema_enabled": "True",
    }
    deploy_variable_library(CODE_WORKSPACE_ID, "VAR_FMD", var_fmd_dir, var_fmd_overrides)

    time.sleep(1)

    # ── VAR_CONFIG_FMD ──
    var_config_dir = os.path.join(script_dir, "src", "VAR_CONFIG_FMD.VariableLibrary")
    var_config_overrides = {
        "fmd_fabric_db_connection": SQL_DB_ENDPOINT,
        "fmd_fabric_db_name": SQL_DB_NAME,
        "fmd_config_workspace_guid": CONFIG_WORKSPACE_ID,
        "fmd_config_database_guid": SQL_DB_GUID,
    }
    deploy_variable_library(CODE_WORKSPACE_ID, "VAR_CONFIG_FMD", var_config_dir, var_config_overrides)

    print("\n" + "=" * 60)
    print("DONE — Variable libraries deployed.")
    print("You can now re-run PL_FMD_LOAD_ALL.")
    print("=" * 60)


if __name__ == "__main__":
    main()
