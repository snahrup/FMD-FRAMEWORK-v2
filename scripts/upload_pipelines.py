"""
upload_pipelines.py - Upload updated pipeline definitions to Fabric via API.

Uploads all LDZ pipeline JSON files to the CODE workspace after timeout fixes.
Handles 202 async responses by polling the Location header until complete.
Continues on error so one pipeline failure doesn't block the rest.
"""

import json
import base64
import urllib.request
import urllib.error
import urllib.parse
import os
import sys
import time
import glob

# ── Config ──
TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
TOKEN_URL = f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token'
SCOPE = 'https://api.fabric.microsoft.com/.default'
WS_CODE = 'c0366b24-e6f8-4994-b4df-b765ecb5bbf8'
API_BASE = 'https://api.fabric.microsoft.com/v1'

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
SRC_DIR = os.path.join(REPO_ROOT, 'src')

# Pipeline patterns to upload (all LDZ + LOAD pipelines)
PIPELINE_PATTERNS = [
    os.path.join(SRC_DIR, 'PL_FMD_LDZ_*.DataPipeline', 'pipeline-content.json'),
    os.path.join(SRC_DIR, 'PL_FMD_LOAD_*.DataPipeline', 'pipeline-content.json'),
]

# Max poll attempts for async operations (202 responses)
MAX_POLL_ATTEMPTS = 30
POLL_INTERVAL_SECONDS = 5


def get_token():
    """Authenticate via service principal and return access token."""
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': SCOPE,
    })
    req = urllib.request.Request(
        TOKEN_URL,
        data=body.encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
    )
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())['access_token']


def api_get(token, url):
    """GET request to Fabric API."""
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())


def api_post_raw(token, url, data):
    """POST request returning raw response (for handling 202)."""
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        url, data=body, method='POST',
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
    )
    try:
        resp = urllib.request.urlopen(req)
        return resp.status, resp.headers, resp.read()
    except urllib.error.HTTPError as e:
        # 202 comes through as HTTPError in some urllib versions
        if e.code == 202:
            return 202, e.headers, e.read()
        raise


def poll_async_operation(token, location_url):
    """Poll an async operation until it completes."""
    for attempt in range(MAX_POLL_ATTEMPTS):
        time.sleep(POLL_INTERVAL_SECONDS)
        req = urllib.request.Request(
            location_url,
            headers={'Authorization': f'Bearer {token}'},
        )
        try:
            resp = urllib.request.urlopen(req)
            status_code = resp.status
            body = json.loads(resp.read())

            op_status = body.get('status', '').lower()
            if op_status in ('succeeded', 'completed'):
                return True, f"Completed after {(attempt + 1) * POLL_INTERVAL_SECONDS}s"
            elif op_status in ('failed', 'cancelled'):
                error_msg = body.get('error', {}).get('message', 'Unknown error')
                return False, f"Failed: {error_msg}"
            # Still running, continue polling
        except urllib.error.HTTPError as e:
            if e.code == 202:
                # Still processing
                continue
            return False, f"Poll error: HTTP {e.code}"

    return False, f"Timed out after {MAX_POLL_ATTEMPTS * POLL_INTERVAL_SECONDS}s"


def collect_pipeline_files():
    """Find all pipeline JSON files (excluding worktrees)."""
    all_files = set()
    for pattern in PIPELINE_PATTERNS:
        for filepath in glob.glob(pattern):
            norm = os.path.normpath(filepath)
            if '.claude' in norm or '.ralphy-worktrees' in norm or 'worktrees' in norm.lower():
                continue
            all_files.add(norm)
    return sorted(all_files)


def get_pipeline_name(filepath):
    """Extract display name from pipeline folder path."""
    folder_name = os.path.basename(os.path.dirname(filepath))
    return folder_name.replace('.DataPipeline', '')


def main():
    # ── 1. Collect files ──
    pipeline_files = collect_pipeline_files()
    print(f"Found {len(pipeline_files)} pipeline files to upload\n")

    if not pipeline_files:
        print("ERROR: No pipeline files found!")
        sys.exit(1)

    # ── 2. Authenticate ──
    print("[1/3] Authenticating with Fabric API...")
    try:
        token = get_token()
        print("  OK\n")
    except Exception as e:
        print(f"  FAILED: {e}")
        sys.exit(1)

    # ── 3. List existing pipelines in workspace ──
    print("[2/3] Listing existing pipelines in CODE workspace...")
    try:
        items_resp = api_get(token, f'{API_BASE}/workspaces/{WS_CODE}/items?type=DataPipeline')
        existing = {item['displayName']: item['id'] for item in items_resp.get('value', [])}
        print(f"  Found {len(existing)} existing pipelines\n")
    except Exception as e:
        print(f"  FAILED to list items: {e}")
        sys.exit(1)

    # ── 4. Upload each pipeline ──
    print(f"[3/3] Uploading {len(pipeline_files)} pipelines...\n")

    results = {"success": [], "failed": [], "skipped": []}

    for filepath in pipeline_files:
        pipeline_name = get_pipeline_name(filepath)

        # Check if pipeline exists in workspace — create if missing
        if pipeline_name not in existing:
            print(f"  Creating {pipeline_name}...", end="")
            try:
                create_body = {
                    "displayName": pipeline_name,
                    "type": "DataPipeline",
                }
                create_url = f'{API_BASE}/workspaces/{WS_CODE}/items'
                status_code, headers, body = api_post_raw(token, create_url, create_body)
                if status_code in (200, 201):
                    resp_data = json.loads(body) if body else {}
                    item_id = resp_data.get("id", "")
                    existing[pipeline_name] = item_id
                    print(f" created ({item_id[:8]}...)")
                elif status_code == 202:
                    location = headers.get('Location', '')
                    if location:
                        ok, msg = poll_async_operation(token, location)
                        if ok:
                            # Re-fetch to get ID
                            items_resp = api_get(token, f'{API_BASE}/workspaces/{WS_CODE}/items?type=DataPipeline')
                            for item in items_resp.get('value', []):
                                if item['displayName'] == pipeline_name:
                                    item_id = item['id']
                                    existing[pipeline_name] = item_id
                                    break
                            print(f" created ({item_id[:8]}...)")
                        else:
                            print(f" FAILED to create: {msg}")
                            results["failed"].append((pipeline_name, msg))
                            continue
                    else:
                        print(f" FAILED: 202 with no Location")
                        results["failed"].append((pipeline_name, "202 no Location"))
                        continue
                else:
                    err = body.decode() if isinstance(body, bytes) else str(body)
                    print(f" FAILED: HTTP {status_code} - {err[:200]}")
                    results["failed"].append((pipeline_name, f"HTTP {status_code}"))
                    continue
            except Exception as e:
                print(f" FAILED: {e}")
                results["failed"].append((pipeline_name, str(e)))
                continue
            time.sleep(1)  # throttle after create
        else:
            item_id = existing[pipeline_name]

        print(f"  Uploading {pipeline_name} (ID: {item_id[:12]}...)...", end="")

        # Read and base64 encode the pipeline JSON
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            payload_b64 = base64.b64encode(content.encode('utf-8')).decode('utf-8')
        except Exception as e:
            print(f"    FAILED to read file: {e}")
            results["failed"].append((pipeline_name, str(e)))
            continue

        # Build updateDefinition request
        update_body = {
            "definition": {
                "parts": [{
                    "path": "pipeline-content.json",
                    "payload": payload_b64,
                    "payloadType": "InlineBase64",
                }]
            }
        }

        update_url = f'{API_BASE}/workspaces/{WS_CODE}/items/{item_id}/updateDefinition'

        try:
            status_code, headers, body = api_post_raw(token, update_url, update_body)

            if status_code == 200:
                print(f" OK")
                results["success"].append(pipeline_name)
            elif status_code == 202:
                # Async operation - poll Location header
                location = headers.get('Location', '')
                retry_after = headers.get('Retry-After', str(POLL_INTERVAL_SECONDS))
                print(f" Accepted (202), polling...")

                if location:
                    ok, msg = poll_async_operation(token, location)
                    if ok:
                        print(f"    OK: {msg}")
                        results["success"].append(pipeline_name)
                    else:
                        print(f"    FAILED: {msg}")
                        results["failed"].append((pipeline_name, msg))
                else:
                    # No Location header, treat as success (fire-and-forget)
                    print(f"    OK (202, no Location header)")
                    results["success"].append(pipeline_name)
            else:
                print(f"    FAILED: unexpected HTTP {status_code}")
                results["failed"].append((pipeline_name, f"HTTP {status_code}"))

        except urllib.error.HTTPError as e:
            err_body = e.read().decode()[:500]
            print(f"    FAILED: HTTP {e.code} - {err_body}")
            results["failed"].append((pipeline_name, f"HTTP {e.code}: {err_body}"))
        except Exception as e:
            print(f"    FAILED: {e}")
            results["failed"].append((pipeline_name, str(e)))

    # ── Summary ──
    print(f"\n{'='*60}")
    print(f"UPLOAD SUMMARY")
    print(f"{'='*60}")
    print(f"  Success: {len(results['success'])}")
    for name in results['success']:
        print(f"    + {name}")

    if results['skipped']:
        print(f"  Skipped: {len(results['skipped'])}")
        for name in results['skipped']:
            print(f"    ~ {name}")

    if results['failed']:
        print(f"  Failed:  {len(results['failed'])}")
        for name, err in results['failed']:
            print(f"    ! {name}: {err}")
        print(f"\nSTATUS: PARTIAL FAILURE")
    else:
        print(f"\nSTATUS: {'DONE' if results['success'] else 'NOTHING TO DO'}")


if __name__ == '__main__':
    main()
