#!/usr/bin/env python3
"""Fix Bronze and Silver entity names to include datasource prefix.

Uses direct pyodbc connection (not server.py) to avoid import overhead.
"""
import os, struct, json
from urllib.request import Request, urlopen
from urllib.parse import urlencode

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def get_secret():
    env_path = os.path.join(SCRIPT_DIR, "dashboard", "app", "api", ".env")
    with open(env_path) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("Secret not found")

def get_token():
    data = urlencode({
        "client_id": CLIENT_ID,
        "client_secret": get_secret(),
        "scope": "https://database.windows.net/.default",
        "grant_type": "client_credentials",
    }).encode()
    req = Request(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data=data, method="POST",
    )
    resp = json.loads(urlopen(req).read())
    return resp["access_token"]

def main():
    import pyodbc

    # Read config for SQL server/database
    cfg_path = os.path.join(SCRIPT_DIR, "config", "item_config.yaml")
    server = database = ""
    with open(cfg_path) as f:
        for line in f:
            s = line.strip()
            if s.startswith("endpoint:"):
                server = s.split(":", 1)[1].strip().strip('"').strip("'")
            elif s.startswith("displayName:") and not database:
                database = s.split(":", 1)[1].strip().strip('"').strip("'")

    if not server or not database:
        print(f"Config issue: server='{server}', database='{database}'")
        return

    print(f"Connecting to {server}/{database}...")
    token = get_token()
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

    server_conn = server if ",1433" in server else f"{server},1433"
    conn = pyodbc.connect(
        f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server_conn};DATABASE={database};",
        attrs_before={1256: token_struct},
        timeout=30,
    )
    conn.autocommit = True
    cursor = conn.cursor()
    print("Connected!")

    # Fix Bronze names: set Name = LZ FileName (which has the prefix)
    cursor.execute("""
        UPDATE be
        SET be.Name = le.FileName
        FROM integration.BronzeLayerEntity be
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        WHERE be.Name != le.FileName
    """)
    bronze_fixed = cursor.rowcount
    print(f"Bronze: {bronze_fixed} rows updated")

    # Fix Silver names: set Name = LZ FileName
    cursor.execute("""
        UPDATE se
        SET se.Name = le.FileName
        FROM integration.SilverLayerEntity se
        JOIN integration.BronzeLayerEntity be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        WHERE se.Name != le.FileName
    """)
    silver_fixed = cursor.rowcount
    print(f"Silver: {silver_fixed} rows updated")

    # Verify
    cursor.execute("""
        SELECT TOP 10
            ds.Name AS DS, le.FileName AS LZ, be.Name AS Bronze, se.Name AS Silver
        FROM integration.BronzeLayerEntity be
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        LEFT JOIN integration.SilverLayerEntity se ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        ORDER BY ds.Name, be.Name
    """)
    print("\nVerification (first 10):")
    for row in cursor.fetchall():
        print(f"  DS:{row[0]:15} LZ:{row[1]:30} Bronze:{row[2]:30} Silver:{row[3] or 'N/A'}")

    cursor.close()
    conn.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
