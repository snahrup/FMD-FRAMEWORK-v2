"""
Diagnose and fix Bronze/Silver pipeline queue state.

Checks ALL prerequisites for the processing notebooks:
1. Entity activation (IsActive)
2. Queue tables (PipelineLandingzoneEntity, PipelineBronzeLayerEntity)
3. LastLoadValue records
4. What the stored procs actually return

Usage:
    python scripts/diagnose_and_fix_queues.py          # diagnose only
    python scripts/diagnose_and_fix_queues.py --fix     # diagnose + fix
"""
import sys, os, json, struct

# --Load config ──
config_path = os.path.join(os.path.dirname(__file__), "..", "dashboard", "app", "api", "config.json")
with open(config_path) as f:
    cfg = json.load(f)

SQL_SERVER = cfg["sql"]["server"]
SQL_DB = cfg["sql"]["database"]
TENANT = cfg["fabric"]["tenant_id"]
CLIENT_ID = cfg["fabric"]["client_id"]
CLIENT_SECRET = os.environ.get("FABRIC_CLIENT_SECRET", cfg["fabric"].get("client_secret", ""))

FIX_MODE = "--fix" in sys.argv

# --Get token ──
import urllib.request, urllib.parse
token_url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
token_data = urllib.parse.urlencode({
    "grant_type": "client_credentials",
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "scope": "https://database.windows.net/.default",
}).encode()
resp = json.loads(urllib.request.urlopen(urllib.request.Request(token_url, data=token_data), timeout=30).read())
token = resp["access_token"]
token_bytes = token.encode("UTF-16-LE")
token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)

# --Connect ──
import pyodbc
conn = pyodbc.connect(
    f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SQL_SERVER};PORT=1433;DATABASE={SQL_DB};",
    attrs_before={1256: token_struct},
    timeout=60,
)
cursor = conn.cursor()

def q(sql):
    cursor.execute(sql)
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]

def qval(sql):
    cursor.execute(sql)
    return cursor.fetchone()[0]

print("=" * 70)
print("FMD QUEUE DIAGNOSTIC")
print("=" * 70)

# --1. Entity counts ──
print("\n-- 1. Entity Activation --")
lz_total = qval("SELECT COUNT(*) FROM integration.LandingzoneEntity")
lz_active = qval("SELECT COUNT(*) FROM integration.LandingzoneEntity WHERE IsActive=1")
br_total = qval("SELECT COUNT(*) FROM integration.BronzeLayerEntity")
br_active = qval("SELECT COUNT(*) FROM integration.BronzeLayerEntity WHERE IsActive=1")
sv_total = qval("SELECT COUNT(*) FROM integration.SilverLayerEntity")
sv_active = qval("SELECT COUNT(*) FROM integration.SilverLayerEntity WHERE IsActive=1")
print(f"  LZ:     {lz_active}/{lz_total} active")
print(f"  Bronze: {br_active}/{br_total} active")
print(f"  Silver: {sv_active}/{sv_total} active")

if br_active == 0 and br_total > 0:
    print("  *** PROBLEM: All Bronze entities INACTIVE ***")
    if FIX_MODE:
        cursor.execute("""
            UPDATE b SET b.IsActive = 1
            FROM integration.BronzeLayerEntity b
            INNER JOIN integration.LandingzoneEntity lz ON b.LandingzoneEntityId = lz.LandingzoneEntityId
            WHERE lz.IsActive = 1
        """)
        conn.commit()
        br_active = qval("SELECT COUNT(*) FROM integration.BronzeLayerEntity WHERE IsActive=1")
        print(f"  FIXED: {br_active} Bronze entities activated")

if sv_active == 0 and sv_total > 0:
    print("  *** PROBLEM: All Silver entities INACTIVE ***")
    if FIX_MODE:
        cursor.execute("""
            UPDATE s SET s.IsActive = 1
            FROM integration.SilverLayerEntity s
            INNER JOIN integration.BronzeLayerEntity b ON s.BronzeLayerEntityId = b.BronzeLayerEntityId
            INNER JOIN integration.LandingzoneEntity lz ON b.LandingzoneEntityId = lz.LandingzoneEntityId
            WHERE lz.IsActive = 1 AND b.IsActive = 1
        """)
        conn.commit()
        sv_active = qval("SELECT COUNT(*) FROM integration.SilverLayerEntity WHERE IsActive=1")
        print(f"  FIXED: {sv_active} Silver entities activated")

# --2. Queue tables ──
print("\n--2. Queue Tables --")
plze_total = qval("SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity")
plze_unprocessed = qval("SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity WHERE IsProcessed=0")
plze_processed = qval("SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity WHERE IsProcessed=1")
print(f"  PipelineLandingzoneEntity:  {plze_total} total | {plze_unprocessed} unprocessed | {plze_processed} processed")

pble_total = qval("SELECT COUNT(*) FROM execution.PipelineBronzeLayerEntity")
pble_unprocessed = qval("SELECT COUNT(*) FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed=0")
pble_processed = qval("SELECT COUNT(*) FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed=1")
print(f"  PipelineBronzeLayerEntity:  {pble_total} total | {pble_unprocessed} unprocessed | {pble_processed} processed")

if plze_total == 0:
    print("  *** PROBLEM: PipelineLandingzoneEntity is EMPTY ***")
    if FIX_MODE:
        cursor.execute("""
            INSERT INTO execution.PipelineLandingzoneEntity (LandingzoneEntityId, IsProcessed)
            SELECT LandingzoneEntityId, 0
            FROM integration.LandingzoneEntity
            WHERE IsActive = 1
        """)
        conn.commit()
        new_count = qval("SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity")
        print(f"  FIXED: Inserted {new_count} queue entries")
elif plze_unprocessed == 0 and plze_processed > 0:
    print("  *** PROBLEM: All LZ queue entries are PROCESSED (nothing for bronze to do) ***")
    if FIX_MODE:
        cursor.execute("UPDATE execution.PipelineLandingzoneEntity SET IsProcessed = 0")
        conn.commit()
        print(f"  FIXED: Reset {plze_processed} entries to IsProcessed=0")

if pble_total == 0:
    print("  *** PROBLEM: PipelineBronzeLayerEntity is EMPTY ***")
    if FIX_MODE:
        cursor.execute("""
            INSERT INTO execution.PipelineBronzeLayerEntity (BronzeLayerEntityId, IsProcessed)
            SELECT BronzeLayerEntityId, 0
            FROM integration.BronzeLayerEntity
            WHERE IsActive = 1
        """)
        conn.commit()
        new_count = qval("SELECT COUNT(*) FROM execution.PipelineBronzeLayerEntity")
        print(f"  FIXED: Inserted {new_count} queue entries")
elif pble_unprocessed == 0 and pble_processed > 0:
    print("  *** PROBLEM: All Bronze queue entries are PROCESSED (nothing for silver to do) ***")
    if FIX_MODE:
        cursor.execute("UPDATE execution.PipelineBronzeLayerEntity SET IsProcessed = 0")
        conn.commit()
        print(f"  FIXED: Reset {pble_processed} entries to IsProcessed=0")

# --3. LastLoadValue records ──
print("\n--3. LastLoadValue Records --")
llv_count = qval("SELECT COUNT(*) FROM execution.LandingzoneEntityLastLoadValue")
lz_missing_llv = qval("""
    SELECT COUNT(*)
    FROM integration.LandingzoneEntity lz
    WHERE lz.IsActive = 1
      AND NOT EXISTS (
          SELECT 1 FROM execution.LandingzoneEntityLastLoadValue lv
          WHERE lv.LandingzoneEntityId = lz.LandingzoneEntityId
      )
""")
print(f"  LastLoadValue records: {llv_count}")
print(f"  Active LZ entities WITHOUT LastLoadValue: {lz_missing_llv}")

if lz_missing_llv > 0:
    print(f"  *** PROBLEM: {lz_missing_llv} entities have no LastLoadValue (bronze view will exclude them) ***")
    if FIX_MODE:
        cursor.execute("""
            INSERT INTO execution.LandingzoneEntityLastLoadValue (LandingzoneEntityId, LoadValue)
            SELECT lz.LandingzoneEntityId, ''
            FROM integration.LandingzoneEntity lz
            WHERE lz.IsActive = 1
              AND NOT EXISTS (
                  SELECT 1 FROM execution.LandingzoneEntityLastLoadValue lv
                  WHERE lv.LandingzoneEntityId = lz.LandingzoneEntityId
              )
        """)
        conn.commit()
        print(f"  FIXED: Seeded {lz_missing_llv} missing LastLoadValue records")

# --4. View results ──
print("\n--4. View Results (what stored procs see) --")
try:
    bronze_view_count = qval("SELECT COUNT(*) FROM execution.vw_LoadToBronzeLayer")
    print(f"  vw_LoadToBronzeLayer:  {bronze_view_count} rows")
except Exception as e:
    print(f"  vw_LoadToBronzeLayer:  ERROR - {str(e)[:100]}")

try:
    silver_view_count = qval("SELECT COUNT(*) FROM execution.vw_LoadToSilverLayer")
    print(f"  vw_LoadToSilverLayer:  {silver_view_count} rows")
except Exception as e:
    print(f"  vw_LoadToSilverLayer:  ERROR - {str(e)[:100]}")

# --5. Stored proc test ──
print("\n--5. Stored Proc Output --")
try:
    cursor.execute("EXEC [execution].[sp_GetBronzelayerEntity]")
    cols = [d[0] for d in cursor.description]
    rows = cursor.fetchall()
    if rows and 'NotebookParams' in cols:
        idx = cols.index('NotebookParams')
        nb_json = rows[0][idx]
        if nb_json:
            entities = json.loads(nb_json)
            print(f"  sp_GetBronzelayerEntity: {len(entities)} entities")
            if entities:
                print(f"    First entity path: {entities[0].get('path', 'N/A')}")
                print(f"    First entity target: {entities[0].get('params', {}).get('TargetName', 'N/A')}")
        else:
            print(f"  sp_GetBronzelayerEntity: NotebookParams is NULL/empty")
    else:
        print(f"  sp_GetBronzelayerEntity: {len(rows)} rows, columns: {cols}")
except Exception as e:
    print(f"  sp_GetBronzelayerEntity: ERROR - {str(e)[:200]}")

try:
    cursor.execute("EXEC [execution].[sp_GetSilverlayerEntity]")
    cols = [d[0] for d in cursor.description]
    rows = cursor.fetchall()
    if rows and 'NotebookParams' in cols:
        idx = cols.index('NotebookParams')
        nb_json = rows[0][idx]
        if nb_json:
            entities = json.loads(nb_json)
            print(f"  sp_GetSilverlayerEntity: {len(entities)} entities")
            if entities:
                print(f"    First entity path: {entities[0].get('path', 'N/A')}")
        else:
            print(f"  sp_GetSilverlayerEntity: NotebookParams is NULL/empty")
    else:
        print(f"  sp_GetSilverlayerEntity: {len(rows)} rows, columns: {cols}")
except Exception as e:
    print(f"  sp_GetSilverlayerEntity: ERROR - {str(e)[:200]}")

# --Summary ──
print("\n" + "=" * 70)
problems = []
if br_active == 0: problems.append("Bronze entities inactive")
if sv_active == 0: problems.append("Silver entities inactive")
if plze_unprocessed == 0: problems.append("LZ queue empty/all processed")
if pble_unprocessed == 0: problems.append("Bronze queue empty/all processed")
if lz_missing_llv > 0: problems.append(f"{lz_missing_llv} missing LastLoadValue records")

if problems:
    print(f"PROBLEMS FOUND ({len(problems)}):")
    for p in problems:
        print(f"  - {p}")
    if not FIX_MODE:
        print("\nRun with --fix to auto-repair:")
        print("  python scripts/diagnose_and_fix_queues.py --fix")
    else:
        print("\nAll fixes applied. Trigger runs from the dashboard now.")
else:
    print("ALL CLEAR — queue state looks good. Trigger runs from dashboard.")

print("=" * 70)

cursor.close()
conn.close()
