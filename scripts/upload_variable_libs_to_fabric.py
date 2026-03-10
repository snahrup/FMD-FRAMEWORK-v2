#!/usr/bin/env python3
"""
upload_variable_libs_to_fabric.py — Push Variable Libraries to Fabric.

Reads workspace IDs from .deploy_state.json, authenticates via SP,
and uploads each variable library definition to the CODE workspace.
VAR_CONFIG_FMD is also deployed to the CONFIG workspace.

Usage:
    python scripts/upload_variable_libs_to_fabric.py              # upload all to DEV
    python scripts/upload_variable_libs_to_fabric.py --env prod   # upload all to PROD
    python scripts/upload_variable_libs_to_fabric.py --dry-run    # preview only
"""

import argparse
import base64
import json
import os
import sys
import time
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
FABRIC_API = "https://api.fabric.microsoft.com/v1"

_token_cache = {}


def get_client_secret():
    env_path = os.path.join(PROJECT_ROOT, "dashboard", "app", "api", ".env")
    with open(env_path) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("FABRIC_CLIENT_SECRET not found in dashboard/app/api/.env")


def get_token():
    cached = _token_cache.get("fabric")
    if cached and cached["expires"] > time.time():
        return cached["token"]
    data = urlencode({
        "client_id": CLIENT_ID,
        "client_secret": get_client_secret(),
        "scope": "https://api.fabric.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode()
    req = Request(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data=data, method="POST",
    )
    resp = json.loads(urlopen(req).read())
    _token_cache["fabric"] = {
        "token": resp["access_token"],
        "expires": time.time() + resp.get("expires_in", 3600) - 60,
    }
    return resp["access_token"]


def fabric_api(method, path, payload=None):
    """Call Fabric REST API. Returns (status_code, response_data)."""
    url = f"{FABRIC_API}/{path}"
    body = json.dumps(payload).encode() if payload else None
    headers = {
        "Authorization": f"Bearer {get_token()}",
        "Content-Type": "application/json",
    }
    req = Request(url, data=body, method=method, headers=headers)
    try:
        resp = urlopen(req)
        status = resp.status
        raw = resp.read().decode()
        data = json.loads(raw) if raw.strip() else {}
    except HTTPError as e:
        status = e.code
        raw = e.read().decode()
        try:
            data = json.loads(raw)
        except Exception:
            data = {"error": raw[:500]}
    return status, data


def find_item(ws_id, name, item_type):
    """Find an existing item by display name in workspace."""
    status, data = fabric_api("GET", f"workspaces/{ws_id}/items?type={item_type}")
    if status == 200 and "value" in data:
        for item in data["value"]:
            if item["displayName"] == name:
                return item
    return None


def build_definition_parts(src_dir):
    """Build Fabric API definition parts from all files in a source directory."""
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


def deploy_variable_library(ws_id, ws_label, short_name, src_dir, dry_run=False):
    """Deploy a single variable library to a workspace."""
    if dry_run:
        print(f"  [DRY] {short_name} -> {ws_label}")
        return True

    parts = build_definition_parts(src_dir)
    if not parts:
        print(f"  [SKIP] {short_name} — no definition parts")
        return False

    # Check if exists
    existing = find_item(ws_id, short_name, "VariableLibrary")
    if existing:
        item_id = existing["id"]
        print(f"  [EXISTS] {short_name} -> {item_id[:8]}...", end="")
    else:
        status, data = fabric_api("POST", f"workspaces/{ws_id}/items", {
            "displayName": short_name,
            "type": "VariableLibrary",
        })
        if status in (200, 201) and data:
            item_id = data["id"]
            print(f"  [CREATE] {short_name} -> {item_id[:8]}...", end="")
        else:
            print(f"  [FAIL] {short_name} — create failed: HTTP {status}")
            return False

    # Upload definition
    status, data = fabric_api("POST",
        f"workspaces/{ws_id}/items/{item_id}/updateDefinition",
        {"definition": {"parts": parts}}
    )
    if status in (200, 202):
        print(f" OK ({len(parts)} parts)")
        return True
    else:
        print(f" UPLOAD FAILED (HTTP {status})")
        return False


def discover_variable_libs():
    """Find all variable library source directories in src/."""
    src_dir = os.path.join(PROJECT_ROOT, "src")
    libs = []
    for entry in sorted(os.listdir(src_dir)):
        if not entry.endswith(".VariableLibrary"):
            continue
        short_name = entry.replace(".VariableLibrary", "")
        lib_path = os.path.join(src_dir, entry)
        if os.path.isdir(lib_path):
            libs.append((short_name, lib_path))

    # Also check business_domain subdirectory
    bd_dir = os.path.join(src_dir, "business_domain")
    if os.path.isdir(bd_dir):
        for entry in sorted(os.listdir(bd_dir)):
            if not entry.endswith(".VariableLibrary"):
                continue
            short_name = entry.replace(".VariableLibrary", "")
            lib_path = os.path.join(bd_dir, entry)
            if os.path.isdir(lib_path):
                libs.append((short_name, lib_path))
    return libs


def main():
    parser = argparse.ArgumentParser(description="Upload Variable Libraries to Fabric")
    parser.add_argument("--env", choices=["dev", "prod"], default="dev",
                        help="Target environment (default: dev)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview what would be uploaded")
    args = parser.parse_args()

    # Load deploy state for workspace IDs
    state_path = os.path.join(PROJECT_ROOT, ".deploy_state.json")
    if not os.path.exists(state_path):
        print("ERROR: .deploy_state.json not found. Run deploy_from_scratch.py first.")
        sys.exit(1)
    with open(state_path) as f:
        state = json.load(f)

    ws_ids = state.get("workspace_ids", {})
    code_ws_id = ws_ids.get(f"code_{args.env}")
    config_ws_id = ws_ids.get("config")

    if not code_ws_id:
        print(f"ERROR: No code_{args.env} workspace ID in deploy state.")
        sys.exit(1)

    print("=" * 70)
    print("  VARIABLE LIBRARY UPLOAD TO FABRIC")
    print(f"  Environment : {args.env.upper()}")
    print(f"  CODE workspace: {code_ws_id}")
    print(f"  CONFIG workspace: {config_ws_id}")
    print(f"  Dry run     : {args.dry_run}")
    print("=" * 70)

    libs = discover_variable_libs()
    if not libs:
        print("No variable libraries found to upload.")
        sys.exit(0)

    print(f"\nFound {len(libs)} variable library/libraries to upload:\n")

    succeeded = 0
    failed = 0

    for short_name, lib_path in libs:
        # Deploy to CODE workspace
        print(f"\n  --- {short_name} ---")
        ok = deploy_variable_library(code_ws_id, f"CODE ({args.env})", short_name, lib_path, args.dry_run)
        if ok:
            succeeded += 1
        else:
            failed += 1

        # VAR_CONFIG_FMD also goes to CONFIG workspace
        if "CONFIG" in short_name and config_ws_id:
            ok2 = deploy_variable_library(config_ws_id, "CONFIG", short_name, lib_path, args.dry_run)
            if ok2:
                print(f"    Also deployed to CONFIG workspace")

        time.sleep(0.5)  # throttle

    print(f"\n{'=' * 70}")
    print(f"  Done: {succeeded} succeeded, {failed} failed")
    print("=" * 70)


if __name__ == "__main__":
    main()
