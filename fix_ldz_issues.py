#!/usr/bin/env python3
"""
fix_ldz_issues.py — Fix the two root causes of PL_FMD_LOAD_LANDINGZONE failure:

1. Connection table: SqlServer -> SQL (pipeline Switch expects 'SQL', not 'SQLSERVER')
2. Data_WorkspaceGuid default: Update from old template GUID to actual DATA workspace GUID
"""

import base64
import json
import os
import struct
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
CONFIG_WS = "f442f66c-eac6-46d7-80c9-c8b025c86fbe"
DB_ITEM_ID = "501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"
DB_ENDPOINT = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"

# Old default workspace GUID that's in many pipeline definitions
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
    data = urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope": scope,
    }).encode()
    req = Request(f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
                  data=data, method="POST")
    with urlopen(req) as resp:
        result = json.loads(resp.read())
    _token_cache[key] = {
        "token": result["access_token"],
        "expires": time.time() + result.get("expires_in", 3600)
    }
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


def query_sql(query, commit=False):
    import pyodbc
    sql_token = get_token("https://database.windows.net/.default")
    token_bytes = sql_token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    server = DB_ENDPOINT.replace(",1433", "")
    db_name = f"SQL_INTEGRATION_FRAMEWORK-{DB_ITEM_ID}"
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={server},1433;"
        f"DATABASE={db_name};"
        f"Encrypt=Yes;TrustServerCertificate=No;"
    )
    SQL_COPT_SS_ACCESS_TOKEN = 1256
    conn = pyodbc.connect(conn_str, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct},
                          autocommit=commit)
    cursor = conn.cursor()
    cursor.execute(query)
    if cursor.description:
        cols = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        conn.close()
        return cols, rows
    affected = cursor.rowcount
    conn.close()
    return None, affected


def get_definition(ws_id, item_id):
    status, data, loc = api("POST", f"workspaces/{ws_id}/items/{item_id}/getDefinition")
    if status == 200 and data:
        return data
    if loc:
        if wait_op(loc, 30):
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
    print("Fix PL_FMD_LOAD_LANDINGZONE Root Causes")
    print("=" * 70)

    get_token()
    print("[OK] Authenticated\n")

    # ════════════════════════════════════════════════════════════════
    # FIX 1: Connection table - SqlServer -> SQL
    # ════════════════════════════════════════════════════════════════
    print("=" * 70)
    print("FIX 1: Update Connection.Type 'SqlServer' -> 'SQL'")
    print("=" * 70)

    # Show current state
    print("\n  Current Connection table:")
    cols, rows = query_sql("SELECT ConnectionId, Name, Type FROM [integration].[Connection]")
    for row in rows:
        marker = " <-- NEEDS FIX" if row[2] == "SqlServer" else ""
        print(f"    ID={row[0]}, Name={row[1]}, Type={row[2]}{marker}")

    # Update SqlServer -> SQL
    _, affected = query_sql(
        "UPDATE [integration].[Connection] SET Type = 'SQL' WHERE Type = 'SqlServer'",
        commit=True
    )
    print(f"\n  Updated {affected} rows (SqlServer -> SQL)")

    # Verify
    print("\n  Verified Connection table:")
    cols, rows = query_sql("SELECT ConnectionId, Name, Type FROM [integration].[Connection]")
    for row in rows:
        print(f"    ID={row[0]}, Name={row[1]}, Type={row[2]}")

    # Verify the view now returns SQL
    print("\n  View returns:")
    cols, rows = query_sql(
        "SELECT DISTINCT ConnectionType, COUNT(*) as cnt "
        "FROM [execution].[vw_LoadSourceToLandingzone] "
        "GROUP BY ConnectionType"
    )
    for row in rows:
        print(f"    ConnectionType={row[0]}, Count={row[1]}")

    # ════════════════════════════════════════════════════════════════
    # FIX 2: Update Data_WorkspaceGuid defaults in pipeline definitions
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'=' * 70}")
    print(f"FIX 2: Update Data_WorkspaceGuid defaults in pipeline definitions")
    print(f"  OLD: {OLD_WS_GUID}")
    print(f"  NEW: {DATA_WS}")
    print("=" * 70)

    # Get all items in CODE workspace
    _, code_data, _ = api("GET", f"workspaces/{CODE_WS}/items")
    pipelines = [(item["displayName"], item["id"])
                 for item in code_data.get("value", [])
                 if item.get("type") == "DataPipeline"]

    fixed = 0
    skipped = 0
    failed = 0

    for pl_name, pl_id in sorted(pipelines):
        defn = get_definition(CODE_WS, pl_id)
        if not defn:
            print(f"  [SKIP] {pl_name} - could not get definition")
            skipped += 1
            continue

        for part in defn.get("definition", {}).get("parts", []):
            if part["path"] == "pipeline-content.json":
                content = base64.b64decode(part["payload"]).decode()

                # Check if OLD_WS_GUID appears
                if OLD_WS_GUID not in content:
                    skipped += 1
                    continue

                # Count occurrences
                count = content.count(OLD_WS_GUID)

                # Replace
                new_content = content.replace(OLD_WS_GUID, DATA_WS)

                # Upload
                encoded = base64.b64encode(new_content.encode()).decode()
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
                    print(f"  [FIXED] {pl_name} - {count} occurrences replaced")
                    fixed += 1
                else:
                    print(f"  [FAIL] {pl_name} - HTTP {status}: {str(data)[:100]}")
                    failed += 1

                time.sleep(0.3)
                break

    print(f"\n  Summary: {fixed} fixed, {skipped} skipped, {failed} failed")

    # ════════════════════════════════════════════════════════════════
    # VERIFY
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'=' * 70}")
    print("VERIFICATION")
    print("=" * 70)

    # Re-check key pipeline definitions
    for pl_name in ["PL_FMD_LOAD_LANDINGZONE", "PL_FMD_LDZ_COMMAND_ASQL"]:
        item = next((i for i in code_data.get("value", []) if i["displayName"] == pl_name), None)
        if not item:
            continue

        defn = get_definition(CODE_WS, item["id"])
        if not defn:
            continue

        for part in defn.get("definition", {}).get("parts", []):
            if part["path"] == "pipeline-content.json":
                content = base64.b64decode(part["payload"]).decode()
                pipeline_json = json.loads(content)
                params = pipeline_json.get("properties", {}).get("parameters", {})
                for p_name, p_def in params.items():
                    if "workspace" in p_name.lower() or "guid" in p_name.lower():
                        print(f"  {pl_name}: {p_name} = {p_def.get('defaultValue', '(no default)')}")

                # Also check for any remaining old GUID
                if OLD_WS_GUID in content:
                    print(f"  [WARN] {pl_name} still contains old GUID!")
                else:
                    print(f"  [OK] {pl_name} - no old GUIDs remaining")
                break

    print(f"\n{'=' * 70}")
    print("ALL FIXES APPLIED")
    print("=" * 70)


if __name__ == "__main__":
    main()
