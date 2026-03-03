"""
Overnight Pre-flight: Poll Optiva registration, export entity inventory,
get pipeline GUIDs, initialize bug tracker.

Uses urllib for token auth (never azure.identity — it hangs on Windows).
"""
import urllib.request
import urllib.parse
import json
import struct
import pyodbc
import time
import os
import sys
from datetime import datetime, timezone

# ── Fabric SQL DB credentials ──────────────────────────────────────────────
TENANT   = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT   = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = os.environ.get('FABRIC_CLIENT_SECRET', '')
SERVER   = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
DATABASE = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENTITIES_JSON    = os.path.join(SCRIPT_DIR, 'entities_to_analyze.json')
PREFLIGHT_REPORT = os.path.join(SCRIPT_DIR, 'overnight_preflight_report.txt')
BUG_TRACKER      = os.path.join(SCRIPT_DIR, 'overnight_bug_tracker.md')

POLL_INTERVAL   = 60   # seconds
POLL_MAX_WAIT   = 900  # 15 minutes
STABLE_READINGS = 2    # consecutive unchanged readings to call it stable


def get_token(scope='https://analysis.windows.net/powerbi/api/.default'):
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': scope,
    }).encode()
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=body,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
    )
    return json.loads(urllib.request.urlopen(req).read())['access_token']


def connect_sql():
    token = get_token('https://analysis.windows.net/powerbi/api/.default')
    token_bytes = token.encode('UTF-16-LE')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    conn_str = (
        f'DRIVER={{ODBC Driver 18 for SQL Server}};'
        f'SERVER={SERVER};'
        f'DATABASE={DATABASE};'
        f'Encrypt=yes;TrustServerCertificate=no'
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


def query(conn, sql):
    """Execute SQL and return list of dicts."""
    cur = conn.cursor()
    cur.execute(sql)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fmt_ts():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')


# ── STEP 1: Poll entity counts until Optiva stabilizes ────────────────────
COUNTS_SQL = """\
SELECT ds.DataSourceId, ds.Name, ds.Namespace,
       COUNT(DISTINCT le.LandingzoneEntityId) AS lz_count,
       COUNT(DISTINCT ble.BronzeLayerEntityId) AS bronze_count,
       COUNT(DISTINCT sle.SilverLayerEntityId) AS silver_count
FROM integration.DataSource ds
LEFT JOIN integration.LandingzoneEntity le ON ds.DataSourceId = le.DataSourceId
LEFT JOIN integration.BronzeLayerEntity ble ON le.LandingzoneEntityId = ble.LandingzoneEntityId
LEFT JOIN integration.SilverLayerEntity sle ON ble.BronzeLayerEntityId = sle.BronzeLayerEntityId
GROUP BY ds.DataSourceId, ds.Name, ds.Namespace
ORDER BY ds.DataSourceId
"""


def poll_registration():
    """Poll until entity counts stabilize (2 consecutive identical readings)."""
    print(f'\n{"="*70}')
    print(f'  STEP 1: Polling entity registration counts')
    print(f'  Started: {fmt_ts()}')
    print(f'  Poll interval: {POLL_INTERVAL}s | Max wait: {POLL_MAX_WAIT}s')
    print(f'{"="*70}\n')

    prev_snapshot = None
    stable_count = 0
    elapsed = 0
    poll_log = []

    while elapsed < POLL_MAX_WAIT:
        conn = connect_sql()
        rows = query(conn, COUNTS_SQL)
        conn.close()

        # Build a hashable snapshot (just the counts per DataSourceId)
        snapshot = tuple(
            (r['DataSourceId'], r['Name'], r['Namespace'],
             r['lz_count'], r['bronze_count'], r['silver_count'])
            for r in rows
        )

        ts = fmt_ts()
        total_lz = sum(r['lz_count'] for r in rows)
        total_br = sum(r['bronze_count'] for r in rows)
        total_sv = sum(r['silver_count'] for r in rows)

        print(f'  [{ts}]  Total LZ={total_lz}  Bronze={total_br}  Silver={total_sv}')
        for r in rows:
            print(f'    {r["Namespace"]:12s}  LZ={r["lz_count"]:>5d}  B={r["bronze_count"]:>5d}  S={r["silver_count"]:>5d}')

        poll_log.append({'ts': ts, 'rows': rows, 'total_lz': total_lz,
                         'total_br': total_br, 'total_sv': total_sv})

        if snapshot == prev_snapshot:
            stable_count += 1
            print(f'  --> Unchanged ({stable_count}/{STABLE_READINGS})')
            if stable_count >= STABLE_READINGS:
                print(f'\n  STABLE after {elapsed}s. Proceeding.\n')
                return rows, poll_log
        else:
            stable_count = 1 if prev_snapshot is not None else 0
            if prev_snapshot is not None:
                print(f'  --> Changed! Reset stability counter.')

        prev_snapshot = snapshot
        if elapsed + POLL_INTERVAL >= POLL_MAX_WAIT and stable_count < STABLE_READINGS:
            break

        print(f'  Sleeping {POLL_INTERVAL}s...\n')
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

    print(f'\n  WARNING: Max wait ({POLL_MAX_WAIT}s) reached without full stability.')
    print(f'  Proceeding with latest readings.\n')
    return rows, poll_log


# ── STEP 2: Get Optiva DataSource info ─────────────────────────────────────
OPTIVA_DS_SQL = """\
SELECT DataSourceId, ConnectionId, Name, Namespace
FROM integration.DataSource
WHERE Namespace = 'OPTIVA' OR Name = 'OptivaLive'
"""


def get_optiva_ds(conn):
    print(f'\n{"="*70}')
    print(f'  STEP 2: Optiva DataSource lookup')
    print(f'{"="*70}\n')
    rows = query(conn, OPTIVA_DS_SQL)
    if rows:
        for r in rows:
            print(f'  DataSourceId={r["DataSourceId"]}  ConnectionId={r["ConnectionId"]}  '
                  f'Name={r["Name"]}  Namespace={r["Namespace"]}')
    else:
        print('  WARNING: No Optiva DataSource found!')
    return rows


# ── STEP 3: Export ALL active entities ─────────────────────────────────────
ENTITIES_SQL = """\
SELECT le.LandingzoneEntityId AS id,
       ds.Namespace AS ns,
       le.SourceSchema AS [schema],
       le.SourceName AS name,
       CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END AS is_incr,
       le.IsIncrementalColumn AS incr_col,
       le.IsActive,
       ds.DataSourceId
FROM integration.LandingzoneEntity le
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
WHERE le.IsActive = 1
ORDER BY ds.Namespace, le.SourceSchema, le.SourceName
"""


def export_entities(conn):
    print(f'\n{"="*70}')
    print(f'  STEP 3: Export active entities for load analysis')
    print(f'{"="*70}\n')
    rows = query(conn, ENTITIES_SQL)

    # Convert is_incr: 1→True, 0→False; incr_col: None stays None
    for r in rows:
        r['is_incr'] = bool(r['is_incr'])
        r['incr_col'] = r['incr_col'] if r['incr_col'] is not None else None

    with open(ENTITIES_JSON, 'w') as f:
        json.dump(rows, f, indent=2, default=str)

    print(f'  Exported {len(rows)} active entities to {ENTITIES_JSON}')

    # Summary by namespace
    ns_counts = {}
    for r in rows:
        ns = r['ns']
        if ns not in ns_counts:
            ns_counts[ns] = {'total': 0, 'incr': 0}
        ns_counts[ns]['total'] += 1
        if r['is_incr']:
            ns_counts[ns]['incr'] += 1

    print(f'\n  {"Namespace":15s}  {"Total":>6s}  {"Incremental":>12s}')
    print(f'  {"-"*15}  {"-"*6}  {"-"*12}')
    for ns in sorted(ns_counts):
        c = ns_counts[ns]
        print(f'  {ns:15s}  {c["total"]:>6d}  {c["incr"]:>12d}')
    print(f'  {"TOTAL":15s}  {len(rows):>6d}  {sum(c["incr"] for c in ns_counts.values()):>12d}')

    return rows, ns_counts


# ── STEP 4: Activation status ──────────────────────────────────────────────
ACTIVATION_SQL = """\
SELECT ds.Namespace, le.IsActive, COUNT(*) as cnt
FROM integration.LandingzoneEntity le
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
GROUP BY ds.Namespace, le.IsActive
ORDER BY ds.Namespace, le.IsActive
"""


def check_activation(conn):
    print(f'\n{"="*70}')
    print(f'  STEP 4: Activation status')
    print(f'{"="*70}\n')
    rows = query(conn, ACTIVATION_SQL)
    print(f'  {"Namespace":15s}  {"IsActive":>8s}  {"Count":>6s}')
    print(f'  {"-"*15}  {"-"*8}  {"-"*6}')
    for r in rows:
        print(f'  {r["Namespace"]:15s}  {str(r["IsActive"]):>8s}  {r["cnt"]:>6d}')
    return rows


# ── STEP 5: Pipeline info ─────────────────────────────────────────────────
PIPELINE_SQL = """\
SELECT PipelineId, Name, PipelineGuid, IsActive
FROM integration.Pipeline
ORDER BY PipelineId
"""


def get_pipelines(conn):
    print(f'\n{"="*70}')
    print(f'  STEP 5: Pipeline inventory')
    print(f'{"="*70}\n')
    rows = query(conn, PIPELINE_SQL)
    print(f'  {"ID":>4s}  {"Name":40s}  {"GUID":38s}  {"Active":>6s}')
    print(f'  {"-"*4}  {"-"*40}  {"-"*38}  {"-"*6}')
    for r in rows:
        guid = str(r['PipelineGuid']) if r['PipelineGuid'] else '(none)'
        active = str(r['IsActive'])
        print(f'  {r["PipelineId"]:>4d}  {r["Name"]:40s}  {guid:38s}  {active:>6s}')
    return rows


# ── STEP 6: Write preflight report ────────────────────────────────────────
def write_report(counts_rows, poll_log, optiva_ds, entities, ns_counts,
                 activation, pipelines):
    print(f'\n{"="*70}')
    print(f'  STEP 6: Writing preflight report')
    print(f'{"="*70}\n')

    lines = []
    lines.append(f'OVERNIGHT PRE-FLIGHT REPORT')
    lines.append(f'Generated: {fmt_ts()}')
    lines.append(f'{"="*70}\n')

    # Registration counts
    lines.append('1. ENTITY REGISTRATION COUNTS (final stable reading)')
    lines.append(f'   {"Source":15s}  {"DSID":>4s}  {"LZ":>6s}  {"Bronze":>6s}  {"Silver":>6s}')
    lines.append(f'   {"-"*15}  {"-"*4}  {"-"*6}  {"-"*6}  {"-"*6}')
    total_lz = total_br = total_sv = 0
    for r in counts_rows:
        lines.append(f'   {r["Namespace"]:15s}  {r["DataSourceId"]:>4d}  '
                      f'{r["lz_count"]:>6d}  {r["bronze_count"]:>6d}  {r["silver_count"]:>6d}')
        total_lz += r['lz_count']
        total_br += r['bronze_count']
        total_sv += r['silver_count']
    lines.append(f'   {"TOTAL":15s}       {total_lz:>6d}  {total_br:>6d}  {total_sv:>6d}')
    lines.append('')

    # Optiva DS
    lines.append('2. OPTIVA DATASOURCE')
    if optiva_ds:
        for r in optiva_ds:
            lines.append(f'   DataSourceId={r["DataSourceId"]}  ConnectionId={r["ConnectionId"]}  '
                          f'Name={r["Name"]}  Namespace={r["Namespace"]}')
    else:
        lines.append('   NOT FOUND')
    lines.append('')

    # Active entities by namespace
    lines.append('3. ACTIVE ENTITIES FOR LOAD ANALYSIS')
    lines.append(f'   Exported {len(entities)} entities to {ENTITIES_JSON}')
    lines.append(f'   {"Namespace":15s}  {"Total":>6s}  {"Incremental":>12s}')
    lines.append(f'   {"-"*15}  {"-"*6}  {"-"*12}')
    for ns in sorted(ns_counts):
        c = ns_counts[ns]
        lines.append(f'   {ns:15s}  {c["total"]:>6d}  {c["incr"]:>12d}')
    lines.append(f'   {"TOTAL":15s}  {len(entities):>6d}  '
                  f'{sum(c["incr"] for c in ns_counts.values()):>12d}')
    lines.append('')

    # Activation status
    lines.append('4. ACTIVATION STATUS')
    lines.append(f'   {"Namespace":15s}  {"IsActive":>8s}  {"Count":>6s}')
    lines.append(f'   {"-"*15}  {"-"*8}  {"-"*6}')
    for r in activation:
        lines.append(f'   {r["Namespace"]:15s}  {str(r["IsActive"]):>8s}  {r["cnt"]:>6d}')
    lines.append('')

    # Pipelines
    lines.append('5. PIPELINE INVENTORY')
    lines.append(f'   {"ID":>4s}  {"Name":40s}  {"GUID":38s}  {"Active":>6s}')
    lines.append(f'   {"-"*4}  {"-"*40}  {"-"*38}  {"-"*6}')
    for r in pipelines:
        guid = str(r['PipelineGuid']) if r['PipelineGuid'] else '(none)'
        active = str(r['IsActive'])
        lines.append(f'   {r["PipelineId"]:>4d}  {r["Name"]:40s}  {guid:38s}  {active:>6s}')
    lines.append('')

    # Poll log
    lines.append('6. POLL LOG')
    for p in poll_log:
        lines.append(f'   [{p["ts"]}]  LZ={p["total_lz"]}  B={p["total_br"]}  S={p["total_sv"]}')
    lines.append('')

    report = '\n'.join(lines)
    with open(PREFLIGHT_REPORT, 'w') as f:
        f.write(report)
    print(f'  Written to {PREFLIGHT_REPORT}')
    return report


# ── STEP 7: Initialize bug tracker ────────────────────────────────────────
def init_bug_tracker():
    print(f'\n{"="*70}')
    print(f'  STEP 7: Initializing bug tracker')
    print(f'{"="*70}\n')

    content = f"""# Overnight Load Run -- Bug Tracker (true-falcon)
## Started: {fmt_ts()}
## Purpose: Track bugs and resolution attempts to avoid infinite loops

| # | Timestamp | Bug Description | Attempted Fix | Result |
|---|-----------|-----------------|---------------|--------|
"""
    with open(BUG_TRACKER, 'w') as f:
        f.write(content)
    print(f'  Initialized at {BUG_TRACKER}')


# ── Main ───────────────────────────────────────────────────────────────────
def main():
    start = fmt_ts()
    print(f'\n{"#"*70}')
    print(f'  OVERNIGHT PRE-FLIGHT — {start}')
    print(f'{"#"*70}')

    # Step 1: Poll
    counts_rows, poll_log = poll_registration()

    # Steps 2-5 reuse a single connection
    print(f'\n  Connecting for Steps 2-5...')
    conn = connect_sql()

    optiva_ds = get_optiva_ds(conn)
    entities, ns_counts = export_entities(conn)
    activation = check_activation(conn)
    pipelines = get_pipelines(conn)

    conn.close()

    # Step 6: Report
    write_report(counts_rows, poll_log, optiva_ds, entities, ns_counts,
                 activation, pipelines)

    # Step 7: Bug tracker
    init_bug_tracker()

    print(f'\n{"#"*70}')
    print(f'  ALL STEPS COMPLETE — {fmt_ts()}')
    print(f'{"#"*70}\n')


if __name__ == '__main__':
    main()
