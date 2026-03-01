import pyodbc
import struct
import json
import os
import urllib.request
import urllib.parse
from urllib.error import HTTPError

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")

def get_token(scope="https://database.windows.net/.default"):
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

def main():
    # Connection string for M3 ERP database
    server = 'm3-db1'
    database = 'm3fdbprd'
    username = 'UsrSQLRead'
    password = 'Ku7T@hoqFDmDPqG4deMgrrxQ9'
    
    # Needs TrustServerCertificate=yes since it's an internal server
    conn_str = f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server};DATABASE={database};UID={username};PWD={password};TrustServerCertificate=yes'
    
    print(f"Attempting to connect to M3 ERP database {database} on {server}...")
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        # Querying information_schema.tables to get all base tables, but only those with rows
        query = """
        SELECT s.name AS TABLE_SCHEMA, t.name AS TABLE_NAME
        FROM sys.tables t
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        INNER JOIN sys.partitions p ON t.object_id = p.object_id
        WHERE p.index_id IN (0, 1) AND p.rows > 0
        GROUP BY s.name, t.name
        ORDER BY s.name, t.name
        """
        
        cursor.execute(query)
        tables = cursor.fetchall()
        
        print(f"Successfully retrieved {len(tables)} tables from M3 ERP (filtered by rows > 0).")
        
        # Group tables by schema
        schema_dict = {}
        for row in tables:
            schema = row.TABLE_SCHEMA
            table = row.TABLE_NAME
            if schema not in schema_dict:
                schema_dict[schema] = []
            schema_dict[schema].append(table)
            
        print(f"\nFound tables with data in {len(schema_dict)} schemas:")
        for schema, table_list in schema_dict.items():
            print(f"  - Schema '{schema}': {len(table_list)} tables")
            
        # Write to config/entity_registration.json
        config_path = "../../config/entity_registration.json"
        
        entity_config = []
        for schema, table_list in schema_dict.items():
            config_entry = {
                "dataSource": "m3fdbprd", # As per DS definition
                "schema": schema,
                "tables": table_list
            }
            entity_config.append(config_entry)
            
        with open(config_path, "w") as f:
            json.dump(entity_config, f, indent=4)
            
        print(f"\nSuccessfully wrote entity configuration to {config_path}")
        
    except Exception as e:
        print(f"Error connecting or querying data: {e}")

if __name__ == "__main__":
    main()
