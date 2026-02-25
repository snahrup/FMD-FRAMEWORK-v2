#!/usr/bin/env python3
"""Get the latest pipeline run details and activity errors."""

import json
import os
import struct
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = ""
FABRIC_API = "https://api.fabric.microsoft.com/v1"
CODE_WS = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"
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


def query_sql(query):
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
    conn = pyodbc.connect(conn_str, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct})
    cursor = conn.cursor()
    cursor.execute(query)
    cols = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    conn.close()
    return cols, rows


def main():
    print("=" * 70)
    print("Querying metadata DB for connection types and workspace GUIDs")
    print("=" * 70)

    get_token()
    print("[OK] Authenticated\n")

    # Check the view definition
    print("--- View columns ---")
    try:
        cols, rows = query_sql(
            "SELECT COLUMN_NAME, DATA_TYPE "
            "FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'vw_LoadSourceToLandingzone' "
            "ORDER BY ORDINAL_POSITION"
        )
        for row in rows:
            print(f"  {row[0]}: {row[1]}")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check Connection table
    print("\n--- Connection table ---")
    try:
        cols, rows = query_sql(
            "SELECT ConnectionId, Name, ConnectionType, ConnectionGuid "
            "FROM [integration].[Connection] "
            "ORDER BY ConnectionId"
        )
        for row in rows:
            print(f"  ID={row[0]}, Name={row[1]}, Type={row[2]}, Guid={row[3]}")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check what the view returns for ALL workspace GUIDs
    print("\n--- All workspace GUIDs in vw_LoadSourceToLandingzone ---")
    try:
        cols, rows = query_sql(
            "SELECT DISTINCT WorkspaceGuid FROM [execution].[vw_LoadSourceToLandingzone]"
        )
        for row in rows:
            print(f"  {row[0]}")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check if there are entities for the OLD workspace GUID
    print("\n--- Entities with OLD workspace GUID (1d947c6d...) ---")
    try:
        cols, rows = query_sql(
            "SELECT COUNT(*) FROM [execution].[vw_LoadSourceToLandingzone] "
            "WHERE WorkspaceGuid = '1d947c6d-4350-48c5-8b98-9c21d8862fe7'"
        )
        print(f"  Count: {rows[0][0]}")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check audit pipeline logs for recent failures
    print("\n--- Recent pipeline audit logs ---")
    try:
        cols, rows = query_sql(
            "SELECT TOP 10 PipelineName, LogType, LogData, TriggerTime "
            "FROM [logging].[PipelineAuditLog] "
            "ORDER BY TriggerTime DESC"
        )
        for row in rows:
            print(f"  {row[3]} | {row[0]} | {row[1]} | {str(row[2])[:80]}")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check LandingzoneEntity workspace guid column
    print("\n--- LandingzoneEntity.WorkspaceGuid values ---")
    try:
        cols, rows = query_sql(
            "SELECT DISTINCT WorkspaceGuid FROM [integration].[LandingzoneEntity]"
        )
        for row in rows:
            print(f"  {row[0]}")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    print(f"\n{'=' * 70}")
    print("DONE")


if __name__ == "__main__":
    main()
