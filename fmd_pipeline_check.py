"""
FMD Pipeline Status Check
Connects to Fabric SQL metadata DB and runs read-only diagnostic queries.
"""
import struct
import json
import urllib.request
import urllib.parse
import pyodbc
from datetime import datetime

# ── Connection config ──
TENANT = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
SERVER = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
DATABASE = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"
SCOPE = "https://database.windows.net/.default"

def get_token():
    """Get SP token via direct HTTP POST (no azure.identity or msal)."""
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT,
        "client_secret": SECRET,
        "scope": SCOPE,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read().decode())
    return body["access_token"]

def connect(token):
    """Connect to Fabric SQL DB using SP token via attrs_before."""
    token_bytes = token.encode("UTF-16-LE")
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        f"Encrypt=Yes;"
        f"TrustServerCertificate=No;"
    )
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
    return conn

def run_query(cursor, title, sql):
    """Execute a query and print results in a formatted table."""
    sep = "=" * 100
    print(f"\n{sep}")
    print(f"  {title}")
    print(sep)
    try:
        cursor.execute(sql)
        if cursor.description is None:
            print("  (no result set)")
            return
        columns = [col[0] for col in cursor.description]
        rows = cursor.fetchall()

        if not rows:
            print("  (no rows returned)")
            return

        # Calculate column widths
        col_widths = [len(c) for c in columns]
        str_rows = []
        for row in rows:
            str_row = []
            for i, val in enumerate(row):
                s = str(val) if val is not None else "NULL"
                if len(s) > 120:
                    s = s[:117] + "..."
                str_row.append(s)
                col_widths[i] = max(col_widths[i], len(s))
            str_rows.append(str_row)

        # Print header
        header = " | ".join(c.ljust(col_widths[i]) for i, c in enumerate(columns))
        print(f"  {header}")
        print(f"  {'-+-'.join('-' * w for w in col_widths)}")

        # Print rows
        for str_row in str_rows:
            line = " | ".join(str_row[i].ljust(col_widths[i]) for i in range(len(columns)))
            print(f"  {line}")

        print(f"\n  ({len(rows)} row(s))")
    except Exception as e:
        print(f"  ERROR: {e}")

def main():
    print(f"FMD Pipeline Status Check -- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("Connecting to Fabric SQL metadata DB...")

    token = get_token()
    print("Token acquired.")

    conn = connect(token)
    cursor = conn.cursor()
    print("Connected successfully.")

    # 1. Entity count per data source
    run_query(cursor, "1. ENTITY COUNT PER DATA SOURCE", """
        SELECT ds.Namespace, ds.DataSourceId,
          COUNT(DISTINCT le.LandingzoneEntityId) as lz_count,
          COUNT(DISTINCT be.BronzeLayerEntityId) as bronze_count,
          COUNT(DISTINCT se.SilverLayerEntityId) as silver_count
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        LEFT JOIN integration.BronzeLayerEntity be ON le.LandingzoneEntityId = be.LandingzoneEntityId
        LEFT JOIN integration.SilverLayerEntity se ON be.BronzeLayerEntityId = se.BronzeLayerEntityId
        WHERE ds.IsActive = 1
        GROUP BY ds.Namespace, ds.DataSourceId
        ORDER BY ds.DataSourceId
    """)

    # 2. All connections
    run_query(cursor, "2. ALL CONNECTIONS", """
        SELECT ConnectionId, Name, Type, ServerName, DatabaseName, IsActive
        FROM integration.Connection ORDER BY ConnectionId
    """)

    # 3. Pipeline execution status (last 10)
    run_query(cursor, "3. PIPELINE EXECUTION STATUS (LAST 10 RUNS)", """
        SELECT TOP 10 PipelineRunGuid, PipelineName, LogType, LogDateTime,
          SUBSTRING(CAST(LogData AS NVARCHAR(MAX)), 1, 200) as LogDataSnippet
        FROM logging.PipelineExecution
        ORDER BY LogDateTime DESC
    """)

    # 4. LZ processed counts
    run_query(cursor, "4. LANDING ZONE PROCESSED COUNTS", """
        SELECT ds.Namespace,
          COUNT(CASE WHEN ple.IsProcessed = 1 THEN 1 END) as processed,
          COUNT(*) as total
        FROM execution.PipelineLandingzoneEntity ple
        JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace
    """)

    # 5. Bronze processed counts
    run_query(cursor, "5. BRONZE PROCESSED COUNTS", """
        SELECT ds.Namespace,
          COUNT(CASE WHEN pbe.IsProcessed = 1 THEN 1 END) as processed,
          COUNT(*) as total
        FROM execution.PipelineBronzeLayerEntity pbe
        JOIN integration.BronzeLayerEntity be ON pbe.BronzeLayerEntityId = be.BronzeLayerEntityId
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace
    """)

    # 6. Bronze pending view
    run_query(cursor, "6. BRONZE PENDING (vw_LoadToBronzeLayer)", """
        SELECT COUNT(*) as pending FROM execution.vw_LoadToBronzeLayer
    """)

    # 7. Recent errors
    run_query(cursor, "7. RECENT ERRORS (LAST 20)", """
        SELECT TOP 20 PipelineRunGuid, PipelineName, EntityLayer, LogType, LogDateTime,
          SUBSTRING(CAST(LogData AS NVARCHAR(MAX)), 1, 300) as LogDataSnippet
        FROM logging.PipelineExecution
        WHERE LogType LIKE '%Error%' OR LogType LIKE '%Fail%'
        ORDER BY LogDateTime DESC
    """)

    # 8. M3 ERP connection check
    run_query(cursor, "8. M3 ERP CONNECTION CHECK", """
        SELECT c.ConnectionId, c.Name, c.Type, c.ServerName, c.DatabaseName, c.IsActive,
               ds.Namespace, ds.Name as DataSourceName, ds.DataSourceId
        FROM integration.Connection c
        LEFT JOIN integration.DataSource ds ON c.ConnectionId = ds.ConnectionId
        WHERE c.Name LIKE '%M3%' OR c.Name LIKE '%m3fdb%' OR ds.Namespace LIKE '%M3%' OR ds.Namespace LIKE '%m3fdb%'
    """)

    cursor.close()
    conn.close()
    print("\n" + "=" * 100)
    print("  Check complete.")
    print("=" * 100)

if __name__ == "__main__":
    main()
