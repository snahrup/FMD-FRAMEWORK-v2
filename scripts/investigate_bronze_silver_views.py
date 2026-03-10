"""Get full view/proc definitions to understand Bronze pending logic."""
import struct, json, urllib.request, urllib.parse, pyodbc

TENANT   = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT   = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET   = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
SERVER   = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
DATABASE = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"

def connect():
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    body = urllib.parse.urlencode({"grant_type":"client_credentials","client_id":CLIENT,
        "client_secret":SECRET,"scope":"https://database.windows.net/.default"}).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                headers={"Content-Type":"application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        token = json.loads(resp.read())["access_token"]
    tb = token.encode("UTF-16-LE")
    ts = struct.pack(f"<I{len(tb)}s", len(tb), tb)
    return pyodbc.connect(
        f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};DATABASE={DATABASE};"
        f"Encrypt=yes;TrustServerCertificate=no;", attrs_before={1256: ts})

conn = connect()
cursor = conn.cursor()

# Get full view definitions using sp_helptext (avoids truncation)
for obj in ['execution.vw_LoadToBronzeLayer', 'execution.vw_LoadToSilverLayer']:
    print(f"\n{'='*80}")
    print(f"  FULL DEFINITION: {obj}")
    print(f"{'='*80}")
    try:
        cursor.execute(f"EXEC sp_helptext '{obj}'")
        for row in cursor.fetchall():
            print(row[0], end='')
    except Exception as e:
        print(f"  sp_helptext failed: {e}")
        # Fallback: use OBJECT_DEFINITION
        cursor.execute(f"SELECT OBJECT_DEFINITION(OBJECT_ID('{obj}'))")
        row = cursor.fetchone()
        if row and row[0]:
            print(row[0])
        else:
            print("  Could not retrieve definition")

# Also get sp_BuildEntityDigest
print(f"\n{'='*80}")
print(f"  FULL DEFINITION: execution.sp_BuildEntityDigest")
print(f"{'='*80}")
try:
    cursor.execute("EXEC sp_helptext 'execution.sp_BuildEntityDigest'")
    for row in cursor.fetchall():
        print(row[0], end='')
except Exception as e:
    print(f"  sp_helptext failed: {e}")
    cursor.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('execution.sp_BuildEntityDigest'))")
    row = cursor.fetchone()
    if row and row[0]: print(row[0])

cursor.close()
conn.close()
print("\n\nDone.")
