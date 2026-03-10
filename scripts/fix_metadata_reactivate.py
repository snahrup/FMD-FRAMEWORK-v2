"""Fix SQL metadata: reactivate entities and check Bronze/Silver views."""
import urllib.request, urllib.parse, json, struct, pyodbc

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
DATABASE = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'

# --- Auth ---
print("=== Authenticating ===")
body = urllib.parse.urlencode({
    'grant_type': 'client_credentials',
    'client_id': CLIENT,
    'client_secret': SECRET,
    'scope': 'https://analysis.windows.net/powerbi/api/.default',
}).encode()
req = urllib.request.Request(
    f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
    data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'}
)
token = json.loads(urllib.request.urlopen(req).read())['access_token']
print(f"Token obtained: {token[:20]}...")

token_bytes = token.encode('UTF-16-LE')
token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
conn_str = (
    f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};'
    f'DATABASE={DATABASE};Encrypt=yes;TrustServerCertificate=no'
)
conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
cursor = conn.cursor()
print("Connected to Fabric SQL DB\n")

# --- Step 1: Reactivate ETQ/MES/M3C entities ---
print("=== Step 1: Reactivate ETQ/MES/M3C entities (DataSourceId IN 4, 5, 7) ===")
cursor.execute("UPDATE integration.LandingzoneEntity SET IsActive = 1 WHERE DataSourceId IN (4, 5, 7)")
print(f"Rows affected: {cursor.rowcount}")
conn.commit()
print("Committed.\n")

# Verify
print("=== Step 1 Verification ===")
cursor.execute("""
    SELECT DataSourceId, IsActive, COUNT(*) as cnt
    FROM integration.LandingzoneEntity
    GROUP BY DataSourceId, IsActive
    ORDER BY DataSourceId, IsActive
""")
rows = cursor.fetchall()
print(f"{'DataSourceId':<14} {'IsActive':<10} {'Count':<8}")
print("-" * 32)
for r in rows:
    print(f"{r[0]:<14} {r[1]:<10} {r[2]:<8}")
print()

# --- Step 2: Bronze view count by DataSourceNamespace ---
print("=== Step 2: Bronze view (execution.vw_LoadToBronzeLayer) count by DataSourceNamespace ===")
try:
    cursor.execute("""
        SELECT DataSourceNamespace, COUNT(*) as cnt
        FROM execution.vw_LoadToBronzeLayer
        GROUP BY DataSourceNamespace
        ORDER BY DataSourceNamespace
    """)
    rows = cursor.fetchall()
    total = 0
    print(f"{'DataSourceNamespace':<30} {'Count':<8}")
    print("-" * 38)
    for r in rows:
        print(f"{r[0]:<30} {r[1]:<8}")
        total += r[1]
    print(f"{'TOTAL':<30} {total:<8}")
except Exception as e:
    print(f"Error querying Bronze view: {e}")
print()

# --- Step 3: Silver view definition + count ---
print("=== Step 3: Silver view (execution.vw_LoadToSilverLayer) ===")

# Get view definition
try:
    cursor.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('execution.vw_LoadToSilverLayer'))")
    defn = cursor.fetchone()
    if defn and defn[0]:
        print("View definition:")
        print(defn[0])
    else:
        print("View definition returned NULL (view may not exist)")
except Exception as e:
    print(f"Error getting Silver view definition: {e}")

print()

# Count rows in Silver view
try:
    cursor.execute("""
        SELECT COUNT(*) FROM execution.vw_LoadToSilverLayer
    """)
    silver_count = cursor.fetchone()[0]
    print(f"Silver view total rows: {silver_count}")
except Exception as e:
    print(f"Error counting Silver view rows: {e}")

# Also get Silver breakdown if possible
try:
    cursor.execute("""
        SELECT DataSourceNamespace, COUNT(*) as cnt
        FROM execution.vw_LoadToSilverLayer
        GROUP BY DataSourceNamespace
        ORDER BY DataSourceNamespace
    """)
    rows = cursor.fetchall()
    if rows:
        print(f"\n{'DataSourceNamespace':<30} {'Count':<8}")
        print("-" * 38)
        for r in rows:
            print(f"{r[0]:<30} {r[1]:<8}")
except Exception as e:
    # Column might not exist in Silver view
    pass

print()
print("=== Done ===")
conn.close()
