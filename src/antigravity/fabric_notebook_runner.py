import json
import base64
import urllib.request
import urllib.parse
from urllib.error import HTTPError
import time

# --- CONFIG ---
TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
WORKSPACE_ID = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e" # Code workspace where Notebooks live

def get_token(scope="https://api.fabric.microsoft.com/.default"):
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "client_secret": SECRET,
        "scope": scope,
        "grant_type": "client_credentials",
    }).encode()
    req = urllib.request.Request(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data=data, method="POST",
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    return resp["access_token"]


def fabric_request(method, path, token, payload=None):
    url = f"https://api.fabric.microsoft.com/v1/{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    body = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req)
        
        # Check if 202 Async Operation
        if resp.status == 202:
            op_id = resp.headers.get("x-ms-operation-id")
            print(f"  [Async] Operation ID: {op_id}")
            while True:
                time.sleep(2)
                check_req = urllib.request.Request(f"{url}/operations/{op_id}", headers=headers, method="GET")
                try:
                    check_resp = urllib.request.urlopen(check_req)
                    check_data = json.loads(check_resp.read())
                    status = check_data.get("status", "")
                    if status in ("Succeeded", "Failed"):
                        return check_data
                except HTTPError as e:
                    if e.code != 404: # sometimes takes a second to show up
                        raise
                        
        raw = resp.read()
        return json.loads(raw) if raw else None
    except HTTPError as e:
        body = e.read().decode()
        print(f"HTTP ERROR {e.code} on {method} {url}")
        print(body)
        raise

if __name__ == "__main__":
    token = get_token()
    print("Token acquired.")
    
    # 1. Read the JSON tables config
    with open("../../config/entity_registration.json") as f:
        config = json.load(f)
        
    # Serialize it safely for a Python script
    config_json_str = json.dumps(config).replace('"', '\\"')
    
    # 2. Generate Python code for the Notebook
    py_code = """
import pyodbc
import struct
import json
import urllib.request
import urllib.parse

from notebookutils import mssparkutils

print("Starting registration from within Fabric...")

# Get SQL Token using Spark utils or request
# Fabric Spark can connect directly without ip restrictions if using the system principal
TOKEN = mssparkutils.credentials.getToken("https://database.windows.net/")
token_bytes = TOKEN.encode("utf-16-le")
token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

SQL_SERVER = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com"
SQL_DATABASE = "SQL_INTEGRATION_FRAMEWORK"
conn_str = f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SQL_SERVER};DATABASE={SQL_DATABASE};TrustServerCertificate=yes;"

print("Connecting...")
conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
cursor = conn.cursor()

# Get Lakehouse IDs
cursor.execute("SELECT LakehouseId, Name FROM integration.Lakehouse")
lh_map = {row[1]: row[0] for row in cursor.fetchall()}
bronze_lh = lh_map.get("LH_BRONZE_LAYER")
silver_lh = lh_map.get("LH_SILVER_LAYER")

# Config from script
config_str = "%s"
config = json.loads(config_str)

total_lz = 0
total_bronze = 0
total_silver = 0

for ds in config:
    ds_name = ds["dataSource"]
    schema = ds.get("schema", "dbo")
    
    cursor.execute(f"SELECT DataSourceId FROM integration.DataSource WHERE Name = ?", (ds_name,))
    row = cursor.fetchone()
    if not row:
        print(f"SKIP {ds_name} - not found")
        continue
    ds_id = row[0]
    
    print(f"Processing {ds_name} (ID: {ds_id})...")
    
    for table in ds.get("tables", []):
        safe_schema = schema.replace("'", "''")
        safe_table = table.replace("'", "''")
        
        # LZ
        cursor.execute(
            f"EXEC [integration].[sp_UpsertLandingzoneEntity] "
            f"@LandingzoneEntityId = 0, @DataSourceId = {ds_id}, "
            f"@SourceSchema = '{safe_schema}', @SourceName = '{safe_table}', @IsActive = 1"
        )
        cursor.commit()
        total_lz += 1
        
        # Get LZ ID
        cursor.execute("SELECT LandingzoneEntityId FROM integration.LandingzoneEntity WHERE SourceSchema = ? AND SourceName = ? AND DataSourceId = ?", (schema, table, ds_id))
        lz_eid = cursor.fetchone()[0]
        
        # Bronze
        if bronze_lh:
            cursor.execute("SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?", (lz_eid,))
            b_row = cursor.fetchone()
            if not b_row:
                cursor.execute(f"EXEC [integration].[sp_UpsertBronzeLayerEntity] @BronzeLayerEntityId = 0, @LandingzoneEntityId = {lz_eid}, @LakehouseId = {bronze_lh}, @Schema = '{safe_schema}', @Name = '{safe_table}', @PrimaryKeys = 'N/A', @FileType = 'Delta', @IsActive = 1")
                cursor.commit()
            
            # Silver
            if silver_lh:
                cursor.execute("SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?", (lz_eid,))
                b_eid = cursor.fetchone()[0]
                cursor.execute("SELECT SilverLayerEntityId FROM integration.SilverLayerEntity WHERE BronzeLayerEntityId = ?", (b_eid,))
                if not cursor.fetchone():
                    cursor.execute(f"EXEC [integration].[sp_UpsertSilverLayerEntity] @SilverLayerEntityId = 0, @BronzeLayerEntityId = {b_eid}, @LakehouseId = {silver_lh}, @Schema = '{safe_schema}', @Name = '{safe_table}', @FileType = 'delta', @IsActive = 1")
                    cursor.commit()

print("Done! Registered LZ/Bronze/Silver entities.")
""" % config_json_str

    py_b64 = base64.b64encode(py_code.encode()).decode()
    
    nb_content = {
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
        "cells": [
            {
                "cell_type": "code",
                "source": [py_code],
                "execution_count": None,
                "outputs": [],
                "metadata": {}
            }
        ]
    }
    nb_b64 = base64.b64encode(json.dumps(nb_content).encode()).decode()

    # 3. Create the item in the workspace
    # Check if exists
    items = fabric_request("GET", f"workspaces/{WORKSPACE_ID}/items", token)
    item_id = None
    for item in items.get("value", []):
        if item["type"] == "Notebook" and item["displayName"] == "NB_M3_TEMP_REGISTRATION":
            item_id = item["id"]
            print(f"Found existing notebook: {item_id}")
            break
            
    if not item_id:
        print("Creating new Notebook NB_M3_TEMP_REGISTRATION...")
        payload = {
            "displayName": "NB_M3_TEMP_REGISTRATION",
            "type": "Notebook",
            "definition": {
                "format": "ipynb",
                "parts": [
                    {
                        "path": "notebook-content.py",
                        "payload": py_b64,
                        "payloadType": "InlineBase64"
                    }
                ]
            }
        }
        res = fabric_request("POST", f"workspaces/{WORKSPACE_ID}/items", token, payload)
        # item create is async
        print(f"Create response: {res}")
        item_id = res.get("id")
        
        # Get items again to find newest item if id missing
        items = fabric_request("GET", f"workspaces/{WORKSPACE_ID}/items", token)
        for item in items.get("value", []):
             if item["displayName"] == "NB_M3_TEMP_REGISTRATION":
                 item_id = item["id"]
                 print(f"Found created notebook: {item_id}")

    print(f"Triggering Notebook Job for {item_id}...")
    run_payload = {
        "executionData": {
            "parameters": {}
        }
    }
    
    job_res = fabric_request("POST", f"workspaces/{WORKSPACE_ID}/items/{item_id}/jobs/instances?jobType=RunNotebook", token, run_payload)
    print("Job Response:")
    print(json.dumps(job_res, indent=2))
    print("Please view the notebook run in the Fabric UI.")
