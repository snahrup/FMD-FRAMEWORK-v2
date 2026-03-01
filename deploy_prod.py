"""
Deploy PROD by cloning all items from INTEGRATION CODE (D) to INTEGRATION CODE (P).
Gets the exact definition from DEV (post-GUID-replacement) and creates it in PROD.
"""
import os
import json, base64, time, os, sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")
FABRIC_API = "https://api.fabric.microsoft.com/v1"

# Source: INTEGRATION CODE (D) — already deployed
SRC_WS = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"
# Target: INTEGRATION CODE (P) — needs items
DST_WS = "1284458c-1976-46a6-b9d8-af17c7d11a59"

# GUID replacements: DEV workspace/lakehouse IDs → PROD equivalents
# These are used to swap references in pipeline definitions
GUID_REPLACEMENTS = {
    # DATA workspaces
    "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a": "4c4b6bf5-8728-4aac-a132-b008a11b96d7",  # DATA (D) → DATA (P)
    # CODE workspaces
    "146fe38c-f6c3-4e9d-a18c-5c01cad5941e": "1284458c-1976-46a6-b9d8-af17c7d11a59",  # CODE (D) → CODE (P)
}


def get_token():
    url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
    data = urlencode({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope": "https://api.fabric.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode()
    req = Request(url, data=data, method="POST")
    with urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def api_call(token, method, url_path, body=None):
    url = f"{FABRIC_API}{url_path}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    data = json.dumps(body).encode() if body else None
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req) as resp:
            raw = resp.read()
            return resp.status, raw.decode("utf-8") if raw else "", resp.headers.get("Location", "")
    except HTTPError as e:
        raw = e.read()
        return e.code, raw.decode("utf-8") if raw else "", ""


def poll_operation(token, location_url, max_wait=180):
    if not location_url:
        return True
    for _ in range(max_wait // 3):
        time.sleep(3)
        req = Request(location_url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urlopen(req) as resp:
                data = json.loads(resp.read())
                status = data.get("status", "")
                if status == "Succeeded":
                    return True
                if status == "Failed":
                    err = data.get("error", {}).get("message", "unknown")
                    print(f"    FAILED: {err}")
                    return False
        except HTTPError:
            pass
    print("    TIMEOUT")
    return False


def get_workspace_items(token, ws_id):
    status, body, _ = api_call(token, "GET", f"/workspaces/{ws_id}/items")
    if status == 200 and body:
        return json.loads(body).get("value", [])
    return []


def get_item_definition(token, ws_id, item_id, item_type):
    """Get item definition from source workspace."""
    # For notebooks, request ipynb format
    if item_type == "Notebook":
        body = {"format": "ipynb"}
        status, resp, location = api_call(token, "POST", f"/workspaces/{ws_id}/items/{item_id}/getDefinition", body)
    else:
        status, resp, location = api_call(token, "POST", f"/workspaces/{ws_id}/items/{item_id}/getDefinition")

    if status == 200 and resp:
        return json.loads(resp).get("definition", {})
    elif status == 202:
        # Long-running — poll then fetch
        if poll_operation(token, location):
            # Re-fetch after operation completes
            if location:
                req = Request(location, headers={"Authorization": f"Bearer {token}"})
                try:
                    with urlopen(req) as r:
                        data = json.loads(r.read())
                        return data.get("definition", {})
                except:
                    pass
        return None
    else:
        print(f"    getDefinition HTTP {status}: {resp[:200]}")
        return None


def replace_guids_in_definition(definition):
    """Replace DEV GUIDs with PROD GUIDs in all definition parts."""
    if not definition or "parts" not in definition:
        return definition

    for part in definition["parts"]:
        if "payload" in part:
            # Decode base64
            try:
                content = base64.b64decode(part["payload"]).decode("utf-8")
                # Replace all DEV GUIDs with PROD equivalents
                for dev_guid, prod_guid in GUID_REPLACEMENTS.items():
                    content = content.replace(dev_guid, prod_guid)
                # Re-encode
                part["payload"] = base64.b64encode(content.encode("utf-8")).decode("utf-8")
            except Exception as e:
                print(f"    GUID replacement error: {e}")

    return definition


def create_item_with_definition(token, ws_id, name, item_type, definition):
    """Create item in target workspace with the given definition."""
    body = {
        "displayName": name,
        "type": item_type,
        "definition": definition,
    }

    status, resp, location = api_call(token, "POST", f"/workspaces/{ws_id}/items", body)

    if status == 201:
        item_id = json.loads(resp).get("id", "???")
        return True, item_id
    elif status == 202:
        ok = poll_operation(token, location)
        if ok:
            # Find the new item
            items = get_workspace_items(token, ws_id)
            for item in items:
                if item["displayName"] == name:
                    return True, item["id"]
            return True, "???"
        return False, ""
    elif status == 409:
        return True, "exists"
    else:
        print(f"    Create failed HTTP {status}: {resp[:300]}")
        return False, ""


def create_empty_then_update(token, ws_id, name, item_type, definition):
    """Two-step: create empty item, then update definition."""
    # Step 1: create empty
    body = {"displayName": name, "type": item_type}
    status, resp, location = api_call(token, "POST", f"/workspaces/{ws_id}/items", body)

    if status == 201:
        item_id = json.loads(resp).get("id", "")
    elif status == 409:
        # Already exists — find its ID
        items = get_workspace_items(token, ws_id)
        item_id = next((i["id"] for i in items if i["displayName"] == name), None)
        if not item_id:
            print(f"    409 but can't find item")
            return False, ""
    elif status == 202:
        ok = poll_operation(token, location)
        if not ok:
            return False, ""
        items = get_workspace_items(token, ws_id)
        item_id = next((i["id"] for i in items if i["displayName"] == name), None)
        if not item_id:
            return False, ""
    else:
        print(f"    Create empty HTTP {status}: {resp[:200]}")
        return False, ""

    # Step 2: update definition
    status2, resp2, location2 = api_call(
        token, "POST",
        f"/workspaces/{ws_id}/items/{item_id}/updateDefinition",
        {"definition": definition}
    )

    if status2 in (200, 202):
        if status2 == 202:
            poll_operation(token, location2)
        return True, item_id
    else:
        print(f"    updateDefinition HTTP {status2}: {resp2[:200]}")
        # Item created but definition failed — still partial success
        return False, item_id


def main():
    print("=" * 60)
    print("FMD PROD Deployment — Clone from DEV to PROD")
    print(f"Source: CODE (D) = {SRC_WS}")
    print(f"Target: CODE (P) = {DST_WS}")
    print("=" * 60)

    token = get_token()
    print("Token acquired")

    # Get all items from DEV
    src_items = get_workspace_items(token, SRC_WS)
    print(f"\nSource (DEV) items: {len(src_items)}")

    # Get existing items in PROD
    dst_items = get_workspace_items(token, DST_WS)
    dst_names = {i["displayName"] for i in dst_items}
    print(f"Target (PROD) existing items: {len(dst_items)}")

    # Sort: deploy notebooks first (pipelines may reference them), then pipelines
    notebooks = [i for i in src_items if i["type"] == "Notebook"]
    pipelines = [i for i in src_items if i["type"] == "DataPipeline"]
    deploy_order = notebooks + pipelines

    print(f"\nDeploying {len(notebooks)} notebooks + {len(pipelines)} pipelines")
    print("-" * 60)

    success = 0
    failed = 0

    for item in deploy_order:
        name = item["displayName"]
        itype = item["type"]
        src_id = item["id"]

        if name in dst_names:
            print(f"  SKIP {itype:15} {name} (already exists)")
            success += 1
            continue

        # Get definition from DEV
        print(f"  ...  {itype:15} {name}")
        defn = get_item_definition(token, SRC_WS, src_id, itype)
        if not defn:
            print(f"  FAIL {itype:15} {name} — could not get definition")
            failed += 1
            continue

        # Replace DEV GUIDs with PROD GUIDs
        defn = replace_guids_in_definition(defn)

        # Try single-step create first
        ok, new_id = create_item_with_definition(token, DST_WS, name, itype, defn)

        if not ok:
            # Fallback: two-step (create empty + updateDefinition)
            print(f"  ...  retrying two-step for {name}")
            ok, new_id = create_empty_then_update(token, DST_WS, name, itype, defn)

        if ok:
            id_str = new_id[:8] + "..." if new_id and len(new_id) > 8 else new_id
            print(f"  OK   {itype:15} {name} ({id_str})")
            success += 1
        else:
            print(f"  FAIL {itype:15} {name}")
            failed += 1

        # Brief pause to avoid rate limiting
        time.sleep(0.5)

    # Final verification
    print("\n" + "=" * 60)
    print(f"Results: {success} OK, {failed} FAILED out of {len(deploy_order)}")
    print("-" * 60)

    token2 = get_token()
    final_items = get_workspace_items(token2, DST_WS)
    types = {}
    for i in final_items:
        t = i["type"]
        types[t] = types.get(t, 0) + 1
    print(f"\nFinal CODE (P) inventory: {len(final_items)} items")
    for t, c in sorted(types.items()):
        print(f"  {t}: {c}")

    if len(final_items) >= len(deploy_order):
        print("\nPROD DEPLOYMENT COMPLETE")
    else:
        print(f"\nPROD DEPLOYMENT PARTIAL — {len(final_items)}/{len(deploy_order)} items")
    print("=" * 60)


if __name__ == "__main__":
    main()
