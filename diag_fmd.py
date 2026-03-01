import os
import urllib.request
import urllib.parse
import json
import pyodbc
import sys
import struct

# ---- Auth Config ----
TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")
SQL_SERVER = "7xuydsw5a3hutnnj5z2ed72tam-mhwnfrrtsrmuhgfc2b5tety7li.database.fabric.microsoft.com"
DATABASE = "SQL_INTEGRATION_FRAMEWORK-027d772b-cfc0-472f-a3a6-fafd3f584f4f"

def get_aad_token():
    url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope": "https://database.windows.net/.default",
    }).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read())
    token = body["access_token"]
    print(f"Got AAD token ({len(token)} chars)")
    return token

def connect_sql(token):
    # Build the access token struct for pyodbc
    token_bytes = token.encode("UTF-16-LE")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={SQL_SERVER},1433;"
        f"DATABASE={DATABASE};"
        "Encrypt=yes;"
        "TrustServerCertificate=no;"
    )
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
    print("Connected to SQL successfully!")
    return conn

def run_query(conn, title, sql):
    print(f"\n{'='*80}")
    print(f"QUERY: {title}")
    print(f"SQL: {sql}")
    print(f"{'='*80}")
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        print(f"Columns: {columns}")
        print(f"Row count: {len(rows)}")
        for i, row in enumerate(rows):
            print(f"\n  Row {i+1}:")
            for col, val in zip(columns, row):
                print(f"    {col}: {val}")
        if not rows:
            print("  *** NO ROWS RETURNED ***")
        cursor.close()
    except Exception as e:
        print(f"ERROR: {e}")

def main():
    print("=== FMD Pipeline Diagnostic Script ===")
    print("Using urllib for OAuth, pyodbc for SQL")
    print()

    # Get token via urllib
    token = get_aad_token()

    # Connect via pyodbc with token
    conn = connect_sql(token)

    # Query 1: Check view with WorkspaceGuid filter
    run_query(conn,
        "1. vw_LoadSourceToLandingzone WHERE WorkspaceGuid='40e27fdc-775a-4ee2-84d5-48893c92d7cc'",
        """SELECT TOP 5 WorkspaceGuid, ConnectionType, DatasourceName, DataSourceType, SourceName, ConnectionGuid, TargetLakehouseGuid, TargetFileName 
           FROM [execution].[vw_LoadSourceToLandingzone] 
           WHERE WorkspaceGuid='40e27fdc-775a-4ee2-84d5-48893c92d7cc'""")

    # Query 2: Distinct WorkspaceGuids in the view
    run_query(conn,
        "2. Distinct WorkspaceGuids in vw_LoadSourceToLandingzone",
        "SELECT DISTINCT WorkspaceGuid FROM [execution].[vw_LoadSourceToLandingzone]")

    # Query 3: Lakehouse table
    run_query(conn,
        "3. integration.Lakehouse table",
        "SELECT LakehouseId, LakehouseName, WsGUID, LakehouseGUID FROM integration.Lakehouse")

    # Query 4: PipelineAudit
    run_query(conn,
        "4. logging.PipelineAudit (all entries)",
        """SELECT PipelineAuditId, PipelineName, LogType, LogData, CreatedDate 
           FROM logging.PipelineAudit 
           ORDER BY PipelineAuditId DESC""")

    # Query 5: CopyActivityExecution
    run_query(conn,
        "5. logging.CopyActivityExecution (all entries)",
        "SELECT * FROM logging.CopyActivityExecution ORDER BY CopyActivityExecutionId DESC")

    # Query 6: DataSource table
    run_query(conn,
        "6. integration.DataSource (all rows)",
        "SELECT * FROM integration.DataSource")

    # ---- Analysis ----
    print(f"\n\n{'#'*80}")
    print("ANALYSIS")
    print(f"{'#'*80}")

    # Check if workspace GUID matches
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT WorkspaceGuid FROM [execution].[vw_LoadSourceToLandingzone]")
    view_guids = [row[0] for row in cursor.fetchall()]
    cursor.close()

    target_guid = "40e27fdc-775a-4ee2-84d5-48893c92d7cc"

    if not view_guids:
        print("WARNING: The view returns NO rows at all!")
        print("This means there are no enabled sources with valid config.")
    elif target_guid in [none]:
        pass
    else:
        guid_strs = [str(g) for g in view_guids]
        if target_guid in guid_strs:
            print(f"OK: '{40e27fdc-775a-4ee2-84d5-48893c92d7cc}' FOUND in the view!")
        elif target_guid.lower() in [str(g).lower() for g in guid_strs]:
            print(f"WARNING: Guid found but with different casing!")
            print(f"Expected: {target_guid}")
            print(f"Found: {guid_strs}")
        else:
            print(f"MISMATCH: '{target_guid}' NOT FOUND in the view!")
            print(f"View contains these WorkspaceGuids: {guid_strs}")
            print("THIS IS THE ROOT CAUSE: The pipeline passes '40e27fdc-775a-4ee2-84d5-48893c92d7cc'")
            print("but the view has a different GUID registered for the workspace.")

    conn.close()
    print("\nDone.")

if __name__ == "__main__":
    main()
