"""
Replace all DEV GUIDs with PROD GUIDs in every pipeline in INTEGRATION CODE (P).
Reads each pipeline definition, does find-and-replace for all mapped GUIDs,
then updates the definition back.
"""
import json, base64, time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
API = "https://api.fabric.microsoft.com/v1"

PROD_WS = "1284458c-1976-46a6-b9d8-af17c7d11a59"  # CODE (P)


def get_token():
    url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
    data = urlencode({
        "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
        "scope": "https://api.fabric.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode()
    req = Request(url, data=data, method="POST")
    with urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def api_call(token, method, path, body=None):
    url = f"{API}{path}"
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


def poll_operation(token, location_url, max_wait=120):
    if not location_url:
        return True
    for _ in range(max_wait // 3):
        time.sleep(3)
        req = Request(location_url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urlopen(req) as resp:
                data = json.loads(resp.read())
                if data.get("status") == "Succeeded":
                    return True
                if data.get("status") == "Failed":
                    print(f"    FAILED: {data.get('error', {}).get('message', '')}")
                    return False
        except HTTPError:
            pass
    print("    TIMEOUT")
    return False


def main():
    # Load GUID map
    with open("guid_map.json") as f:
        guid_map = json.load(f)

    print(f"Loaded {len(guid_map)} GUID mappings")
    print("=" * 60)

    token = get_token()

    # Get all pipelines in PROD
    status, body, _ = api_call(token, "GET", f"/workspaces/{PROD_WS}/items?type=DataPipeline")
    pipelines = json.loads(body).get("value", []) if body else []
    print(f"Found {len(pipelines)} pipelines in CODE (P)")

    updated = 0
    skipped = 0
    failed = 0

    for pl in sorted(pipelines, key=lambda x: x["displayName"]):
        name = pl["displayName"]
        pl_id = pl["id"]

        # Get current definition
        status, body, location = api_call(token, "POST", f"/workspaces/{PROD_WS}/items/{pl_id}/getDefinition")

        if status == 202:
            # Async - poll
            if not poll_operation(token, location):
                print(f"  FAIL {name} - could not get definition")
                failed += 1
                continue
            req = Request(location, headers={"Authorization": f"Bearer {token}"})
            with urlopen(req) as resp:
                body = resp.read().decode()

        if not body:
            print(f"  FAIL {name} - empty definition response")
            failed += 1
            continue

        defn = json.loads(body).get("definition", {})
        parts = defn.get("parts", [])

        # Find the pipeline-content.json part
        content_part = None
        for part in parts:
            if "pipeline-content" in part.get("path", ""):
                content_part = part
                break

        if not content_part:
            print(f"  SKIP {name} - no pipeline-content part found")
            skipped += 1
            continue

        # Decode the content
        raw_content = base64.b64decode(content_part["payload"]).decode("utf-8")

        # Count replacements
        total_replacements = 0
        new_content = raw_content

        for dev_guid, prod_guid in guid_map.items():
            count = new_content.count(dev_guid)
            if count > 0:
                new_content = new_content.replace(dev_guid, prod_guid)
                total_replacements += count

        if total_replacements == 0:
            print(f"  SKIP {name} - no DEV GUIDs found (already correct or no references)")
            skipped += 1
            continue

        # Re-encode and update
        content_part["payload"] = base64.b64encode(new_content.encode("utf-8")).decode("utf-8")

        # Push updated definition
        update_body = {"definition": defn}
        status2, resp2, loc2 = api_call(
            token, "POST",
            f"/workspaces/{PROD_WS}/items/{pl_id}/updateDefinition",
            update_body
        )

        if status2 == 200:
            print(f"  OK   {name} ({total_replacements} GUIDs replaced)")
            updated += 1
        elif status2 == 202:
            if poll_operation(token, loc2):
                print(f"  OK   {name} ({total_replacements} GUIDs replaced, async)")
                updated += 1
            else:
                print(f"  FAIL {name} - update failed")
                failed += 1
        else:
            print(f"  FAIL {name} - HTTP {status2}: {resp2[:200]}")
            failed += 1

        time.sleep(0.5)  # Rate limit

    print("\n" + "=" * 60)
    print(f"Updated: {updated}, Skipped: {skipped}, Failed: {failed}")
    print("=" * 60)


if __name__ == "__main__":
    main()
