#!/usr/bin/env python3
"""
upload_notebooks_to_fabric.py — Push local notebook source files to Fabric.

Reads workspace IDs from .deploy_state.json, authenticates via SP,
and uploads each notebook with GUID remapping so the correct
workspace IDs are stamped into the notebook metadata.

Usage:
    python scripts/upload_notebooks_to_fabric.py              # upload all to DEV
    python scripts/upload_notebooks_to_fabric.py --env prod   # upload all to PROD
    python scripts/upload_notebooks_to_fabric.py --dry-run    # preview only
    python scripts/upload_notebooks_to_fabric.py NB_FMD_LOAD_LANDING_BRONZE  # single notebook
"""

import argparse
import base64
import json
import os
import re
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


def find_notebook(ws_id, name):
    """Find an existing notebook by display name in workspace."""
    status, data = fabric_api("GET", f"workspaces/{ws_id}/items?type=Notebook")
    if status == 200 and "value" in data:
        for item in data["value"]:
            if item["displayName"] in (name, f"{name}.Notebook"):
                return item
    return None


def remap_guids(content_text, data_ws_id, code_ws_id, lakehouse_ids=None):
    """Replace workspace and lakehouse GUIDs in notebook source with correct values."""
    changed = False

    # Replace default_lakehouse_workspace_id (DATA workspace)
    if data_ws_id:
        new_text = re.sub(
            r'("default_lakehouse_workspace_id"\s*:\s*")[0-9a-f-]+"',
            rf'\g<1>{data_ws_id}"',
            content_text,
        )
        if new_text != content_text:
            changed = True
            content_text = new_text

    # Replace CodeWorkspaceGuid (CODE workspace)
    if code_ws_id:
        new_text = re.sub(
            r'(CodeWorkspaceGuid\s*=\s*")[0-9a-f-]+"',
            rf'\g<1>{code_ws_id}"',
            content_text,
        )
        if new_text != content_text:
            changed = True
            content_text = new_text

    # Remap default_lakehouse based on default_lakehouse_name
    if lakehouse_ids:
        name_match = re.search(r'"default_lakehouse_name"\s*:\s*"([^"]+)"', content_text)
        if name_match:
            lh_name = name_match.group(1)
            correct_id = lakehouse_ids.get(lh_name)
            if correct_id:
                new_text = re.sub(
                    r'("default_lakehouse"\s*:\s*")[0-9a-f-]+"',
                    rf'\g<1>{correct_id}"',
                    content_text,
                )
                if new_text != content_text:
                    changed = True
                    content_text = new_text

    return content_text, changed


def discover_notebooks(filter_name=None):
    """Find all notebook source files in src/."""
    src_dir = os.path.join(PROJECT_ROOT, "src")
    notebooks = []
    for entry in sorted(os.listdir(src_dir)):
        if not entry.endswith(".Notebook"):
            continue
        short_name = entry.replace(".Notebook", "")
        if filter_name and short_name != filter_name:
            continue
        src_path = os.path.join(src_dir, entry, "notebook-content.py")
        if not os.path.exists(src_path):
            # Try .sql format
            src_path = os.path.join(src_dir, entry, "notebook-content.sql")
        if os.path.exists(src_path):
            fmt = "py" if src_path.endswith(".py") else "sql"
            notebooks.append((short_name, entry, src_path, fmt))

    # Also check business_domain subdirectory
    bd_dir = os.path.join(src_dir, "business_domain")
    if os.path.isdir(bd_dir):
        for entry in sorted(os.listdir(bd_dir)):
            if not entry.endswith(".Notebook"):
                continue
            short_name = entry.replace(".Notebook", "")
            if filter_name and short_name != filter_name:
                continue
            src_path = os.path.join(bd_dir, entry, "notebook-content.py")
            if not os.path.exists(src_path):
                src_path = os.path.join(bd_dir, entry, "notebook-content.sql")
            if os.path.exists(src_path):
                fmt = "py" if src_path.endswith(".py") else "sql"
                notebooks.append((short_name, entry, src_path, fmt))

    return notebooks


def main():
    parser = argparse.ArgumentParser(description="Upload notebook sources to Fabric")
    parser.add_argument("--env", choices=["dev", "prod"], default="dev",
                        help="Target environment (default: dev)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview what would be uploaded")
    parser.add_argument("notebook", nargs="?", default=None,
                        help="Optional: upload only this notebook (short name)")
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
    data_ws_id = ws_ids.get(f"data_{args.env}")

    if not code_ws_id:
        print(f"ERROR: No code_{args.env} workspace ID in deploy state.")
        sys.exit(1)

    # Build lakehouse name -> ID mapping from deploy state
    lh_raw = state.get("lakehouse_ids", {})
    lakehouse_ids = {}
    for key, val in lh_raw.items():
        # Keys like "dev:LH_DATA_LANDINGZONE" -> extract name for matching env
        if key.startswith(f"{args.env}:"):
            lh_name = key.split(":", 1)[1]
            lakehouse_ids[lh_name] = val

    print("=" * 70)
    print("  NOTEBOOK UPLOAD TO FABRIC")
    print(f"  Environment : {args.env.upper()}")
    print(f"  CODE workspace: {code_ws_id}")
    print(f"  DATA workspace: {data_ws_id}")
    print(f"  Dry run     : {args.dry_run}")
    print("=" * 70)

    notebooks = discover_notebooks(args.notebook)
    if not notebooks:
        print("No notebooks found to upload.")
        sys.exit(0)

    print(f"\nFound {len(notebooks)} notebook(s) to upload:\n")

    succeeded = 0
    failed = 0

    for short_name, folder_name, src_path, fmt in notebooks:
        # Read source
        with open(src_path, "rb") as f:
            content_bytes = f.read()

        # GUID remapping
        content_text = content_bytes.decode("utf-8")
        content_text, guid_changed = remap_guids(content_text, data_ws_id, code_ws_id, lakehouse_ids)
        content_bytes = content_text.encode("utf-8")

        remap_tag = " [REMAP]" if guid_changed else ""

        if args.dry_run:
            print(f"  [DRY] {short_name} ({fmt}){remap_tag}")
            succeeded += 1
            continue

        content_b64 = base64.b64encode(content_bytes).decode()

        # Find or create notebook in Fabric
        existing = find_notebook(code_ws_id, short_name)
        if existing:
            item_id = existing["id"]
            print(f"  [EXISTS] {short_name} -> {item_id[:8]}...", end="")
        else:
            status, data = fabric_api("POST", f"workspaces/{code_ws_id}/items", {
                "displayName": short_name,
                "type": "Notebook",
            })
            if status in (200, 201) and data:
                item_id = data["id"]
                print(f"  [CREATE] {short_name} -> {item_id[:8]}...", end="")
            else:
                print(f"  [FAIL] {short_name} — create failed: HTTP {status}")
                failed += 1
                continue

        # Upload definition — omit "format" for .py/.sql (FabricGitSource mode)
        defn = {"parts": [{
            "path": f"notebook-content.{fmt}",
            "payload": content_b64,
            "payloadType": "InlineBase64",
        }]}
        if fmt == "ipynb":
            defn["format"] = "ipynb"

        status, data = fabric_api("POST",
            f"workspaces/{code_ws_id}/items/{item_id}/updateDefinition",
            {"definition": defn}
        )
        if status in (200, 202):
            print(f" OK{remap_tag}")
            succeeded += 1
        else:
            print(f" UPLOAD FAILED (HTTP {status}){remap_tag}")
            failed += 1

        time.sleep(0.5)  # throttle

    print(f"\n{'=' * 70}")
    print(f"  Done: {succeeded} succeeded, {failed} failed")
    print("=" * 70)


if __name__ == "__main__":
    main()
