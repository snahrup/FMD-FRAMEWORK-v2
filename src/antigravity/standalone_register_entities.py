import os
import pyodbc
import struct
import json
import urllib.request
import urllib.parse
from urllib.error import HTTPError

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")
SQL_SERVER = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
SQL_DATABASE = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"

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
    print(f"Loading entity_registration.json...")
    with open("../../config/entity_registration.json") as f:
        entity_config = json.load(f)

    # Connect to metadata DB
    print(f"Connecting to Fabric SQL: {SQL_DATABASE} on {SQL_SERVER}")
    sql_token = get_token()
    token_bytes = sql_token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    
    driver = "{ODBC Driver 18 for SQL Server}"
    conn_str = f"DRIVER={driver};SERVER={SQL_SERVER};DATABASE={SQL_DATABASE};"
    
    try:
        conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
    except Exception as e:
        print(f"Connection error: {e}")
        return
        
    cursor = conn.cursor()
    
    # Look up lakehouse IDs
    cursor.execute("SELECT LakehouseId, Name FROM integration.Lakehouse")
    lh_map = {row[1]: row[0] for row in cursor.fetchall()}
    lz_lh = lh_map.get("LH_DATA_LANDINGZONE")
    bronze_lh = lh_map.get("LH_BRONZE_LAYER")
    silver_lh = lh_map.get("LH_SILVER_LAYER")
    
    if not bronze_lh or not silver_lh or not lz_lh:
        print("WARN: Landing/Bronze/Silver lakehouses not found in metadata DB")

    total_lz = 0
    total_bronze = 0
    total_silver = 0

    for ds in entity_config:
        ds_name = ds["dataSource"]
        schema = ds.get("schema", "dbo")
        tables = ds.get("tables", [])

        # Look up DataSourceId
        cursor.execute(f"SELECT DataSourceId FROM integration.DataSource WHERE Name = ?", (ds_name,))
        row = cursor.fetchone()
        if not row:
            print(f"SKIP DataSource '{ds_name}' not found in metadata DB")
            continue
        ds_id = row[0]

        print(f"\n=== {ds_name} (DataSourceId={ds_id}, {len(tables)} tables) ===")

        # Process in chunks to give progress output
        chunk_size = 100
        for i in range(0, len(tables), chunk_size):
            chunk = tables[i:i+chunk_size]
            print(f"  Registering tables {i+1} to {min(i+chunk_size, len(tables))}...")
            
            for table in chunk:
                safe_schema = schema.replace("'", "''")
                safe_table = table.replace("'", "''")
                
                try:
                    # 1. Register LZ entity
                    cursor.execute(
                        f"EXEC [integration].[sp_UpsertLandingzoneEntity] "
                        f"@LandingzoneEntityId = 0, @DataSourceId = {ds_id}, @LakehouseId = {lz_lh}, "
                        f"@SourceSchema = '{safe_schema}', @SourceName = '{safe_table}', "
                        f"@SourceCustomSelect = '', @FileName = '{safe_table}', "
                        f"@FilePath = '{ds_name}/{safe_schema}', @FileType = 'parquet', "
                        f"@IsIncremental = 0, @IsIncrementalColumn = '', "
                        f"@CustomNotebookName = '', @IsActive = 1"
                    )
                    cursor.commit()
                    total_lz += 1

                    # Get the LZ entity ID
                    cursor.execute(
                        "SELECT LandingzoneEntityId FROM integration.LandingzoneEntity "
                        "WHERE SourceSchema = ? AND SourceName = ? AND DataSourceId = ?",
                        (schema, table, ds_id)
                    )
                    lz_row = cursor.fetchone()
                    if not lz_row:
                        continue
                    lz_eid = lz_row[0]

                    # 2. Auto-register Bronze
                    if bronze_lh:
                        cursor.execute(
                            "SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?",
                            (lz_eid,)
                        )
                        if not cursor.fetchone():
                            cursor.execute(
                                f"EXEC [integration].[sp_UpsertBronzeLayerEntity] "
                                f"@BronzeLayerEntityId = 0, @LandingzoneEntityId = {lz_eid}, "
                                f"@LakehouseId = {bronze_lh}, @Schema = '{safe_schema}', "
                                f"@Name = '{safe_table}', @PrimaryKeys = 'N/A', "
                                f"@FileType = 'Delta', @IsActive = 1"
                            )
                            cursor.commit()
                            total_bronze += 1
                        else:
                            total_bronze += 1

                        # 3. Auto-register Silver
                        if silver_lh:
                            cursor.execute(
                                "SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?",
                                (lz_eid,)
                            )
                            b_row = cursor.fetchone()
                            if b_row:
                                b_eid = b_row[0]
                                cursor.execute(
                                    "SELECT SilverLayerEntityId FROM integration.SilverLayerEntity WHERE BronzeLayerEntityId = ?",
                                    (b_eid,)
                                )
                                if not cursor.fetchone():
                                    cursor.execute(
                                        f"EXEC [integration].[sp_UpsertSilverLayerEntity] "
                                        f"@SilverLayerEntityId = 0, @BronzeLayerEntityId = {b_eid}, "
                                        f"@LakehouseId = {silver_lh}, @Schema = '{safe_schema}', "
                                        f"@Name = '{safe_table}', @FileType = 'delta', @IsActive = 1"
                                    )
                                    cursor.commit()
                                    total_silver += 1
                                else:
                                    total_silver += 1
                                    
                except Exception as ex:
                    print(f"Error on {schema}.{table}: {ex}")
                    
    print(f"\nRegistration complete:")
    print(f"  LZ Entities: {total_lz}")
    print(f"  Bronze Entities: {total_bronze}")
    print(f"  Silver Entities: {total_silver}")

if __name__ == "__main__":
    main()
