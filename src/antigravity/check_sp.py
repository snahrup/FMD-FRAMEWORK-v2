import pyodbc
import struct
import json
import urllib.request
import urllib.parse
from urllib.error import HTTPError

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
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
    print(f"Connecting to Fabric SQL: {SQL_DATABASE} on {SQL_SERVER}")
    sql_token = get_token()
    token_bytes = sql_token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    
    driver = "{ODBC Driver 18 for SQL Server}"
    conn_str = f"DRIVER={driver};SERVER={SQL_SERVER};DATABASE={SQL_DATABASE};TrustServerCertificate=yes;"
    
    try:
        conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
    except Exception as e:
        print(f"Connection error: {e}")
        return
        
    cursor = conn.cursor()
    
    query = "SELECT LakehouseId, Name FROM integration.Lakehouse"
    cursor.execute(query)
    for row in cursor.fetchall():
        print(f"{row.Name}: {row.LakehouseId}")
        
if __name__ == "__main__":
    main()
