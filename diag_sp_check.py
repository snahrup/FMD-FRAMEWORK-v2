#!/usr/bin/env python3
"""Check if stored procedures and logging tables exist."""

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
    if cursor.description:
        cols = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        return cols, rows
    return None, None

def main():
    get_token()
    print("[OK] Authenticated\n")

    # Check schemas
    print("--- Schemas ---")
    try:
        cols, rows = query_sql("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA ORDER BY SCHEMA_NAME")
        for row in rows:
            print(f"  {row[0]}")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check stored procedures in logging schema
    print("\n--- Stored procedures ---")
    try:
        cols, rows = query_sql(
            "SELECT ROUTINE_SCHEMA, ROUTINE_NAME "
            "FROM INFORMATION_SCHEMA.ROUTINES "
            "WHERE ROUTINE_TYPE = 'PROCEDURE' "
            "ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME"
        )
        for row in rows:
            print(f"  [{row[0]}].[{row[1]}]")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check tables in logging schema
    print("\n--- Tables in logging schema ---")
    try:
        cols, rows = query_sql(
            "SELECT TABLE_SCHEMA, TABLE_NAME "
            "FROM INFORMATION_SCHEMA.TABLES "
            "WHERE TABLE_SCHEMA = 'logging' "
            "ORDER BY TABLE_NAME"
        )
        if rows:
            for row in rows:
                print(f"  [{row[0]}].[{row[1]}]")
        else:
            print("  (no tables in logging schema)")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check all tables
    print("\n--- All tables ---")
    try:
        cols, rows = query_sql(
            "SELECT TABLE_SCHEMA, TABLE_NAME "
            "FROM INFORMATION_SCHEMA.TABLES "
            "WHERE TABLE_TYPE = 'BASE TABLE' "
            "ORDER BY TABLE_SCHEMA, TABLE_NAME"
        )
        for row in rows:
            print(f"  [{row[0]}].[{row[1]}]")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check Connection table columns
    print("\n--- Connection table columns ---")
    try:
        cols, rows = query_sql(
            "SELECT COLUMN_NAME, DATA_TYPE "
            "FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'Connection' "
            "ORDER BY ORDINAL_POSITION"
        )
        for row in rows:
            print(f"  {row[0]}: {row[1]}")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check Connection table data
    print("\n--- Connection table data ---")
    try:
        cols, rows = query_sql("SELECT * FROM [integration].[Connection]")
        print(f"  Columns: {cols}")
        for row in rows:
            print(f"  {list(row)}")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Check DataSource table
    print("\n--- DataSource table data ---")
    try:
        cols, rows = query_sql("SELECT * FROM [integration].[DataSource]")
        print(f"  Columns: {cols}")
        for row in rows[:5]:
            print(f"  {list(row)}")
        if len(rows) > 5:
            print(f"  ... and {len(rows)-5} more")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    # Try to run the audit SP
    print("\n--- Test sp_AuditPipeline ---")
    try:
        cols, rows = query_sql(
            "SELECT OBJECT_ID('[logging].[sp_AuditPipeline]') as obj_id"
        )
        if rows and rows[0][0]:
            print(f"  SP exists, object_id = {rows[0][0]}")
        else:
            print("  SP does NOT exist!")
    except Exception as ex:
        print(f"  ERROR: {ex}")

    print("\nDONE")

if __name__ == "__main__":
    main()
