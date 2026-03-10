# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "",
# META       "default_lakehouse_name": "LH_DATA_LANDINGZONE",
# META       "default_lakehouse_workspace_id": "0596d0e7-e036-451d-a967-41a284302e8d",
# META       "known_lakehouses": [
# META         {
# META           "id": "3b9a7e79-1615-4ec2-9e93-0bdebe985d5a"
# META         },
# META         {
# META           "id": "f06393ca-c024-435f-8d7f-9f5aa3bb4cb3"
# META         },
# META         {
# META           "id": "f85e1ba0-2e40-4de5-be1e-f8ad3ddbc652"
# META         }
# META       ]
# META     },
# META     "environment": {}
# META   }
# META }

# MARKDOWN ********************

# # FMD Maintenance Agent Notebook
#
# ## Purpose
# A background "maintenance agent" that reconciles entity status metadata with
# what actually exists in OneLake. Designed to run on a schedule (e.g., every
# 30 minutes) to prevent status drift and stale data.
#
# ## What It Does
# 1. **Scans OneLake** — enumerates actual parquet files (LZ) and Delta tables
#    (Bronze/Silver) across all three lakehouses
# 2. **Queries metadata DB** — reads registered entities from integration tables
#    and current status from EntityStatusSummary
# 3. **Detects drift** — compares OneLake reality vs. metadata DB status
# 4. **Auto-fixes** — updates EntityStatusSummary to match reality:
#    - Marks entities as 'loaded' if their files/tables exist but status says 'not_started'
#    - Marks entities as 'not_started' if status says 'loaded' but no files/tables exist
#    - Inserts missing entities into EntityStatusSummary
#    - Removes orphan rows that reference non-existent entities
# 5. **Reports** — prints a structured summary of findings and fixes
#
# ## Schedule
# Attach this notebook to a Fabric schedule (e.g., every 30 min or hourly).
# It is safe to run repeatedly — all operations are idempotent.

# CELL ********************

# ── Configuration ──

config_settings = notebookutils.variableLibrary.getLibrary("VAR_CONFIG_FMD")

DB_SERVER = config_settings.fmd_fabric_db_connection
DB_NAME   = config_settings.fmd_fabric_db_name

DATA_WORKSPACE = "0596d0e7-e036-451d-a967-41a284302e8d"
LZ_LAKEHOUSE     = "3b9a7e79-1615-4ec2-9e93-0bdebe985d5a"
BRONZE_LAKEHOUSE = "f06393ca-c024-435f-8d7f-9f5aa3bb4cb3"
SILVER_LAKEHOUSE = "f85e1ba0-2e40-4de5-be1e-f8ad3ddbc652"

ONELAKE_BASE = "abfss://{}@onelake.dfs.fabric.microsoft.com/{}"

from datetime import datetime, timezone

print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S UTC')}] FMD Maintenance Agent starting...")
print(f"  DB: {DB_SERVER}")
print(f"  Workspace: {DATA_WORKSPACE[:8]}...")
print(f"  Lakehouses: LZ={LZ_LAKEHOUSE[:8]}, Bronze={BRONZE_LAKEHOUSE[:8]}, Silver={SILVER_LAKEHOUSE[:8]}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# ── Step 1: Connect to Fabric SQL metadata DB ──

import struct
import pyodbc

def get_db_connection():
    """Connect to Fabric SQL DB using SP token auth.

    CRITICAL: Token must be encoded as UTF-16-LE for Fabric SQL pyodbc connections.
    UTF-8 encoding causes 'Login failed for user <token-identified principal>'.
    This matches the pattern used by all other working FMD notebooks.
    """
    token = notebookutils.credentials.getToken(
        'https://analysis.windows.net/powerbi/api'
    )
    token_bytes = token.encode('UTF-16-LE')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)

    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={DB_SERVER};PORT=1433;"
        f"DATABASE={DB_NAME};"
    )
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=60)
    return conn


def run_query(conn, sql):
    """Execute a query and return rows as list of dicts."""
    cursor = conn.cursor()
    cursor.execute(sql)
    columns = [col[0] for col in cursor.description]
    rows = []
    for row in cursor.fetchall():
        rows.append(dict(zip(columns, row)))
    return rows


def run_exec(conn, sql):
    """Execute a statement (INSERT/UPDATE/DELETE) and return rowcount."""
    cursor = conn.cursor()
    cursor.execute(sql)
    rc = cursor.rowcount
    conn.commit()
    return rc


conn = get_db_connection()
print("[OK] Connected to Fabric SQL metadata DB")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# ── Step 2: Load registered entities from integration tables ──

entities = run_query(conn, """
    SELECT
        le.LandingzoneEntityId,
        le.TableName,
        le.SourceSchema,
        le.DataSourceId,
        ds.DataSourceName,
        ds.DataSourceNamespace,
        be.BronzeLayerEntityId,
        se.SilverLayerEntityId
    FROM integration.LandingzoneEntity le
    INNER JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    LEFT JOIN integration.BronzeLayerEntity be ON le.LandingzoneEntityId = be.LandingzoneEntityId
    LEFT JOIN integration.SilverLayerEntity se ON be.BronzeLayerEntityId = se.BronzeLayerEntityId
    WHERE le.IsActive = 1
      AND ds.IsActive = 1
    ORDER BY ds.DataSourceName, le.TableName
""")

print(f"[OK] Loaded {len(entities)} active registered entities")

# Count by layer registration
lz_count = len(entities)
bronze_count = sum(1 for e in entities if e['BronzeLayerEntityId'])
silver_count = sum(1 for e in entities if e['SilverLayerEntityId'])
print(f"  Registered: LZ={lz_count}, Bronze={bronze_count}, Silver={silver_count}")

# Build lookup maps
entity_by_id = {e['LandingzoneEntityId']: e for e in entities}
entity_ids = set(entity_by_id.keys())

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# ── Step 3: Scan OneLake for actual files and tables ──

def scan_lz_files():
    """Scan LZ lakehouse Files/ folder for parquet files. Returns set of (namespace, table)."""
    found = set()
    lz_base = ONELAKE_BASE.format(DATA_WORKSPACE, LZ_LAKEHOUSE) + "/Files"

    try:
        namespaces = notebookutils.fs.ls(lz_base)
    except Exception as e:
        print(f"  [WARN] Cannot list LZ Files/: {e}")
        return found

    for ns_info in namespaces:
        ns_name = ns_info.name.rstrip('/')
        try:
            files = notebookutils.fs.ls(f"{lz_base}/{ns_name}")
            for f_info in files:
                fname = f_info.name.rstrip('/')
                if fname.endswith('.parquet'):
                    table = fname.replace('.parquet', '')
                    found.add((ns_name, table))
        except Exception:
            pass

    return found


def scan_lakehouse_tables(lakehouse_id):
    """Scan a lakehouse's Tables/ folder for Delta tables. Returns set of (namespace, table)."""
    found = set()
    tables_base = ONELAKE_BASE.format(DATA_WORKSPACE, lakehouse_id) + "/Tables"

    try:
        top_items = notebookutils.fs.ls(tables_base)
    except Exception as e:
        print(f"  [WARN] Cannot list Tables/ for {lakehouse_id[:8]}: {e}")
        return found

    for item in top_items:
        item_name = item.name.rstrip('/')

        # Check if this is a namespace folder (contains subfolders that are tables)
        sub_path = f"{tables_base}/{item_name}"
        try:
            sub_items = notebookutils.fs.ls(sub_path)
            # If sub-items contain _delta_log, this IS a table (not a namespace)
            has_delta_log = any(s.name.rstrip('/') == '_delta_log' for s in sub_items)

            if has_delta_log:
                # Top-level table (no namespace)
                found.add(('', item_name))
            else:
                # Namespace folder — enumerate tables inside
                for sub in sub_items:
                    table_name = sub.name.rstrip('/')
                    if table_name.startswith('_'):
                        continue
                    # Verify it's actually a Delta table
                    try:
                        delta_check = notebookutils.fs.ls(f"{sub_path}/{table_name}")
                        if any(d.name.rstrip('/') == '_delta_log' for d in delta_check):
                            found.add((item_name, table_name))
                    except Exception:
                        pass
        except Exception:
            pass

    return found


print("Scanning OneLake lakehouses...")

lz_actual = scan_lz_files()
print(f"  LZ Files:     {len(lz_actual)} parquet files found")

bronze_actual = scan_lakehouse_tables(BRONZE_LAKEHOUSE)
print(f"  Bronze Tables: {len(bronze_actual)} Delta tables found")

silver_actual = scan_lakehouse_tables(SILVER_LAKEHOUSE)
print(f"  Silver Tables: {len(silver_actual)} Delta tables found")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# ── Step 4: Match entities to OneLake reality ──
# Build a reconciliation map: for each entity, determine what SHOULD be its status
# based on whether the file/table actually exists in OneLake.

def normalize_name(name):
    """Normalize table/schema names for comparison (case-insensitive, strip whitespace)."""
    return (name or '').strip().lower()


def build_expected_status(entities, lz_actual, bronze_actual, silver_actual):
    """
    For each entity, determine expected status per layer based on OneLake scan.
    Returns dict: {LandingzoneEntityId: {lz: status, bronze: status, silver: status}}
    """
    # Build lookup sets with normalized names
    lz_norm = {(normalize_name(ns), normalize_name(t)) for ns, t in lz_actual}
    bronze_norm = {(normalize_name(ns), normalize_name(t)) for ns, t in bronze_actual}
    silver_norm = {(normalize_name(ns), normalize_name(t)) for ns, t in silver_actual}

    expected = {}
    for e in entities:
        eid = e['LandingzoneEntityId']
        ns = normalize_name(e.get('DataSourceNamespace') or e.get('DataSourceName', ''))
        table = normalize_name(e['TableName'])

        # LZ check: Files/{namespace}/{table}.parquet
        lz_exists = (ns, table) in lz_norm

        # Bronze/Silver check: Tables/{namespace}/{table}
        bronze_exists = (ns, table) in bronze_norm
        silver_exists = (ns, table) in silver_norm

        expected[eid] = {
            'lz': 'loaded' if lz_exists else 'not_started',
            'bronze': 'loaded' if bronze_exists else 'not_started',
            'silver': 'loaded' if silver_exists else 'not_started',
        }

    return expected


expected_status = build_expected_status(entities, lz_actual, bronze_actual, silver_actual)

# Summary of expected
lz_loaded = sum(1 for v in expected_status.values() if v['lz'] == 'loaded')
bronze_loaded = sum(1 for v in expected_status.values() if v['bronze'] == 'loaded')
silver_loaded = sum(1 for v in expected_status.values() if v['silver'] == 'loaded')

print(f"\n[EXPECTED STATUS based on OneLake scan]")
print(f"  LZ loaded:     {lz_loaded} / {len(entities)}")
print(f"  Bronze loaded:  {bronze_loaded} / {bronze_count}")
print(f"  Silver loaded:  {silver_loaded} / {silver_count}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# ── Step 5: Compare expected vs. actual EntityStatusSummary ──

current_status = run_query(conn, """
    SELECT
        LandingzoneEntityId,
        LzStatus,
        BronzeStatus,
        SilverStatus
    FROM execution.EntityStatusSummary
""")

current_map = {
    r['LandingzoneEntityId']: {
        'lz': (r['LzStatus'] or 'not_started').strip(),
        'bronze': (r['BronzeStatus'] or 'not_started').strip(),
        'silver': (r['SilverStatus'] or 'not_started').strip(),
    }
    for r in current_status
}

print(f"[OK] EntityStatusSummary has {len(current_status)} rows")

# ── Detect drift ──

fixes = []        # (entity_id, layer, old_status, new_status)
missing = []      # entity_ids not in summary table
orphans = []      # entity_ids in summary but not in integration tables

# Find orphan rows (in summary but entity no longer registered/active)
summary_ids = set(current_map.keys())
orphan_ids = summary_ids - entity_ids
if orphan_ids:
    orphans = list(orphan_ids)

# Find missing rows (registered but not in summary)
missing_ids = entity_ids - summary_ids

# Find mismatches
for eid, exp in expected_status.items():
    if eid in current_map:
        cur = current_map[eid]
        for layer in ('lz', 'bronze', 'silver'):
            # Only fix clear mismatches: loaded <-> not_started
            # Don't override 'pending' or 'error' states — those are transient
            if cur[layer] in ('loaded', 'not_started') and exp[layer] != cur[layer]:
                fixes.append((eid, layer, cur[layer], exp[layer]))
    else:
        missing_ids.add(eid)

missing = list(missing_ids)

print(f"\n[DRIFT REPORT]")
print(f"  Orphan rows (in summary, not registered):  {len(orphans)}")
print(f"  Missing rows (registered, not in summary): {len(missing)}")
print(f"  Status mismatches to fix:                  {len(fixes)}")

if fixes:
    # Summarize by layer and direction
    from collections import Counter
    fix_summary = Counter()
    for _, layer, old, new in fixes:
        fix_summary[f"{layer}: {old} -> {new}"] += 1
    for desc, count in fix_summary.most_common():
        print(f"    {desc}: {count}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# ── Step 6: Apply fixes ──

total_fixed = 0

# 6a. Delete orphan rows
if orphans:
    id_list = ','.join(str(oid) for oid in orphans)
    rc = run_exec(conn, f"""
        DELETE FROM execution.EntityStatusSummary
        WHERE LandingzoneEntityId IN ({id_list})
    """)
    total_fixed += rc
    print(f"[FIX] Deleted {rc} orphan rows from EntityStatusSummary")

# 6b. Insert missing entities
if missing:
    # Build batch INSERT
    values = []
    for eid in missing:
        exp = expected_status.get(eid, {'lz': 'not_started', 'bronze': 'not_started', 'silver': 'not_started'})
        values.append(
            f"({eid}, '{exp['lz']}', "
            f"{'NULL' if exp['lz'] == 'not_started' else 'GETUTCDATE()'}, "
            f"'{exp['bronze']}', "
            f"{'NULL' if exp['bronze'] == 'not_started' else 'GETUTCDATE()'}, "
            f"'{exp['silver']}', "
            f"{'NULL' if exp['silver'] == 'not_started' else 'GETUTCDATE()'})"
        )
    # Insert in batches of 500
    for i in range(0, len(values), 500):
        batch = values[i:i+500]
        sql = (
            "INSERT INTO execution.EntityStatusSummary "
            "(LandingzoneEntityId, LzStatus, LzLastLoad, BronzeStatus, BronzeLastLoad, "
            "SilverStatus, SilverLastLoad) VALUES\n" + ",\n".join(batch)
        )
        rc = run_exec(conn, sql)
        total_fixed += rc
    print(f"[FIX] Inserted {len(missing)} missing entity rows")

# 6c. Fix status mismatches
LAYER_COL_MAP = {
    'lz': ('LzStatus', 'LzLastLoad'),
    'bronze': ('BronzeStatus', 'BronzeLastLoad'),
    'silver': ('SilverStatus', 'SilverLastLoad'),
}

for eid, layer, old_status, new_status in fixes:
    status_col, load_col = LAYER_COL_MAP[layer]
    if new_status == 'loaded':
        sql = (
            f"UPDATE execution.EntityStatusSummary "
            f"SET {status_col} = 'loaded', {load_col} = GETUTCDATE() "
            f"WHERE LandingzoneEntityId = {eid}"
        )
    else:
        sql = (
            f"UPDATE execution.EntityStatusSummary "
            f"SET {status_col} = 'not_started', {load_col} = NULL "
            f"WHERE LandingzoneEntityId = {eid}"
        )
    run_exec(conn, sql)
    total_fixed += 1

if fixes:
    print(f"[FIX] Updated {len(fixes)} status mismatches")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# ── Step 7: Final verification and summary ──

final_status = run_query(conn, """
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN LzStatus = 'loaded' THEN 1 ELSE 0 END) as lz_loaded,
        SUM(CASE WHEN BronzeStatus = 'loaded' THEN 1 ELSE 0 END) as bronze_loaded,
        SUM(CASE WHEN SilverStatus = 'loaded' THEN 1 ELSE 0 END) as silver_loaded,
        SUM(CASE WHEN LzStatus = 'error' THEN 1 ELSE 0 END) as lz_error,
        SUM(CASE WHEN BronzeStatus = 'error' THEN 1 ELSE 0 END) as bronze_error,
        SUM(CASE WHEN SilverStatus = 'error' THEN 1 ELSE 0 END) as silver_error
    FROM execution.EntityStatusSummary ess
    INNER JOIN integration.LandingzoneEntity le
        ON ess.LandingzoneEntityId = le.LandingzoneEntityId
    INNER JOIN integration.DataSource ds
        ON le.DataSourceId = ds.DataSourceId
    WHERE le.IsActive = 1 AND ds.IsActive = 1
""")

r = final_status[0] if final_status else {}
ts = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')

conn.close()

print(f"\n{'=' * 60}")
print(f"  FMD MAINTENANCE AGENT — RUN COMPLETE")
print(f"  {ts}")
print(f"{'=' * 60}")
print(f"  Registered entities:     {len(entities)}")
print(f"  Summary table rows:      {r.get('total', '?')}")
print(f"  ────────────────────────────────────")
print(f"  LZ loaded:               {r.get('lz_loaded', '?')} / {lz_count}")
print(f"  Bronze loaded:           {r.get('bronze_loaded', '?')} / {bronze_count}")
print(f"  Silver loaded:           {r.get('silver_loaded', '?')} / {silver_count}")
print(f"  ────────────────────────────────────")
print(f"  LZ errors:               {r.get('lz_error', 0)}")
print(f"  Bronze errors:           {r.get('bronze_error', 0)}")
print(f"  Silver errors:           {r.get('silver_error', 0)}")
print(f"  ────────────────────────────────────")
print(f"  Fixes applied:           {total_fixed}")
print(f"    Orphans removed:       {len(orphans)}")
print(f"    Missing inserted:      {len(missing)}")
print(f"    Mismatches corrected:  {len(fixes)}")
print(f"{'=' * 60}")

if total_fixed == 0:
    print("\n  STATUS: CLEAN — No drift detected.")
else:
    print(f"\n  STATUS: RECONCILED — {total_fixed} fixes applied.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
