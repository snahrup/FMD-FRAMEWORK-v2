#!/usr/bin/env python3
"""
diag_ldz_failure.py — Diagnose PL_FMD_LOAD_LANDINGZONE failure.

Checks:
1. Workspace pipeline definition for Bool/String type issue
2. Metadata DB for registered entities and their WorkspaceGuid
3. Actual pipeline GUIDs in workspace vs what fix_pipeline_guids mapped
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


def wait_op(loc, max_wait=30):
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
                    return False
        except HTTPError:
            pass
    return False


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


def query_sql(query):
    """Query the Fabric SQL DB via pyodbc with SP token auth."""
    try:
        import pyodbc
    except ImportError:
        print("  [SKIP] pyodbc not installed")
        return None

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
    conn = pyodbc.connect(conn_str, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct})
    cursor = conn.cursor()
    cursor.execute(query)
    cols = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    conn.close()
    return cols, rows


def main():
    print("=" * 70)
    print("DIAGNOSTIC: PL_FMD_LOAD_LANDINGZONE Failure")
    print("=" * 70)

    get_token()
    print("[OK] Authenticated\n")

    # ── 1. Find PL_FMD_LOAD_LANDINGZONE in workspace ──
    print("=" * 70)
    print("1. Checking workspace pipeline definitions for Bool/String issue")
    print("=" * 70)

    _, code_data, _ = api("GET", f"workspaces/{CODE_WS}/items")
    items_by_name = {}
    for item in code_data.get("value", []):
        items_by_name[item["displayName"]] = item

    pipelines_to_check = [
        "PL_FMD_LOAD_LANDINGZONE",
        "PL_FMD_LOAD_ALL",
        "PL_FMD_LDZ_COMMAND_ASQL",
    ]

    for pl_name in pipelines_to_check:
        item = items_by_name.get(pl_name)
        if not item:
            print(f"  [MISS] {pl_name} not found in workspace")
            continue

        defn = get_definition(CODE_WS, item["id"])
        if not defn:
            print(f"  [FAIL] Could not get definition for {pl_name}")
            continue

        for part in defn.get("definition", {}).get("parts", []):
            if part["path"] == "pipeline-content.json":
                content = base64.b64decode(part["payload"]).decode()
                pipeline_json = json.loads(content)

                # Check libraryVariables for Bool type
                lib_vars = pipeline_json.get("properties", {}).get("libraryVariables", {})
                for var_name, var_def in lib_vars.items():
                    vtype = var_def.get("type", "")
                    if vtype == "Bool":
                        print(f"  [PROBLEM] {pl_name}: {var_name} has type 'Bool' (should be 'String')")
                    elif vtype == "String" and "lakehouse_schema" in var_name:
                        print(f"  [OK] {pl_name}: {var_name} has type 'String'")

                # Check default parameters
                params = pipeline_json.get("properties", {}).get("parameters", {})
                for p_name, p_def in params.items():
                    if "workspace" in p_name.lower() or "guid" in p_name.lower():
                        print(f"  [PARAM] {pl_name}: {p_name} = {p_def.get('defaultValue', '(no default)')}")

                # Check InvokePipeline references
                activities = pipeline_json.get("properties", {}).get("activities", [])
                for act in activities:
                    if act.get("type") == "InvokePipeline":
                        pid = act["typeProperties"].get("pipelineId", "")
                        wid = act["typeProperties"].get("workspaceId", "")
                        act_params = act["typeProperties"].get("parameters", {})
                        print(f"  [INVOKE] {pl_name} -> {act['name']}: pipelineId={pid[:12]}..., params={list(act_params.keys())}")
                    elif act.get("type") == "ForEach":
                        for inner in act.get("typeProperties", {}).get("activities", []):
                            if inner.get("type") == "Switch":
                                cases = inner.get("typeProperties", {}).get("cases", [])
                                print(f"  [SWITCH] {pl_name}/{inner['name']}: {len(cases)} cases: {[c['value'] for c in cases]}")
                            elif inner.get("type") == "InvokePipeline":
                                pid = inner["typeProperties"].get("pipelineId", "")
                                print(f"  [INVOKE] {pl_name}/ForEach -> {inner['name']}: pipelineId={pid[:12]}...")
                break

    # ── 2. Query metadata DB ──
    print(f"\n{'=' * 70}")
    print("2. Querying metadata DB for entity workspace GUIDs and connection types")
    print("=" * 70)

    try:
        # Check what's in vw_LoadSourceToLandingzone
        result = query_sql(
            "SELECT TOP 10 ConnectionType, WorkspaceGuid, COUNT(*) as cnt "
            "FROM [execution].[vw_LoadSourceToLandingzone] "
            "GROUP BY ConnectionType, WorkspaceGuid"
        )
        if result:
            cols, rows = result
            print(f"\n  vw_LoadSourceToLandingzone summary:")
            print(f"  {'ConnectionType':<20} {'WorkspaceGuid':<40} {'Count':<5}")
            print(f"  {'-'*20} {'-'*40} {'-'*5}")
            for row in rows:
                print(f"  {str(row[0]):<20} {str(row[1]):<40} {str(row[2]):<5}")
        else:
            print("  [SKIP] Could not query view")

        # Check what workspace GUIDs exist in entities
        result2 = query_sql(
            "SELECT TOP 5 e.LandingzoneEntityId, e.FileName, ds.Name as DataSourceName, "
            "ds.ConnectionType, e.WorkspaceGuid "
            "FROM [integration].[LandingzoneEntity] e "
            "JOIN [integration].[DataSource] ds ON e.DataSourceId = ds.DataSourceId "
            "ORDER BY e.LandingzoneEntityId"
        )
        if result2:
            cols2, rows2 = result2
            print(f"\n  Sample LandingzoneEntity records:")
            for row in rows2:
                print(f"  ID={row[0]}, File={row[1]}, DS={row[2]}, ConnType={row[3]}, WS={row[4]}")

        # Check DataSource table
        result3 = query_sql(
            "SELECT DataSourceId, Name, ConnectionType "
            "FROM [integration].[DataSource] "
            "ORDER BY DataSourceId"
        )
        if result3:
            cols3, rows3 = result3
            print(f"\n  DataSource table:")
            for row in rows3:
                print(f"  ID={row[0]}, Name={row[1]}, ConnType={row[2]}")

    except Exception as ex:
        print(f"  [ERROR] SQL query failed: {ex}")

    # ── 3. Check pipeline GUIDs match ──
    print(f"\n{'=' * 70}")
    print("3. Verifying pipeline GUIDs match workspace items")
    print("=" * 70)

    # Get all pipelines in CODE workspace
    code_pipelines = {item["displayName"]: item["id"]
                      for item in code_data.get("value", [])
                      if item.get("type") == "DataPipeline"}

    key_pipelines = [
        "PL_FMD_LDZ_COMMAND_ASQL",
        "PL_FMD_LDZ_COPY_FROM_ASQL_01",
        "PL_FMD_LOAD_LANDINGZONE",
        "PL_FMD_LOAD_BRONZE",
        "PL_FMD_LOAD_SILVER",
        "PL_FMD_LOAD_ALL",
    ]
    for name in key_pipelines:
        actual_id = code_pipelines.get(name, "NOT FOUND")
        print(f"  {name}: {actual_id}")

    print(f"\n{'=' * 70}")
    print("DIAGNOSTIC COMPLETE")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
