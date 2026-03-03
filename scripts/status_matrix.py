"""
FMD Framework — Automated Status Matrix
========================================
Queries the Fabric SQL metadata DB + control plane snapshot to produce
a complete status matrix by Source System x Layer, matching the format
Steve uses for pipeline assessments.

Usage:
    python scripts/status_matrix.py              # Full matrix to stdout
    python scripts/status_matrix.py --json       # JSON output
    python scripts/status_matrix.py --markdown   # Markdown table output
"""
import json
import os
import sys
import struct
from datetime import datetime
from collections import defaultdict
from datetime import timezone

DRIVER = 'ODBC Driver 18 for SQL Server'
FABRIC_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
FABRIC_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'

# Canonical display names
DISPLAY_NAMES = {
    'MES': 'MES', 'ETQ': 'ETQ', 'M3': 'M3', 'M3C': 'M3 Cloud',
    'M3CLOUD': 'M3 Cloud', 'OPTIVA': 'OPTIVA',
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT_PATH = os.path.join(SCRIPT_DIR, '..', 'dashboard', 'app', 'api', 'control_plane_snapshot.json')
METRICS_DB_PATH = os.path.join(SCRIPT_DIR, '..', 'dashboard', 'app', 'api', 'fmd_metrics.db')


def _display(ns: str) -> str:
    return DISPLAY_NAMES.get(ns, DISPLAY_NAMES.get(ns.upper(), ns))


def get_fabric_token():
    from msal import ConfidentialClientApplication
    env_path = os.path.join(SCRIPT_DIR, '..', 'dashboard', 'app', 'api', '.env')
    env_vars = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env_vars[k.strip()] = v.strip().strip('"').strip("'")
    app = ConfidentialClientApplication(
        env_vars.get('FABRIC_CLIENT_ID', 'ac937c5d-4bdd-438f-be8b-84a850021d2d'),
        authority=f"https://login.microsoftonline.com/{env_vars.get('FABRIC_TENANT_ID', 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303')}",
        client_credential=env_vars.get('FABRIC_CLIENT_SECRET', ''),
    )
    result = app.acquire_token_for_client(scopes=["https://analysis.windows.net/powerbi/api/.default"])
    if 'access_token' not in result:
        raise Exception(f"Token failed: {result.get('error_description', result)}")
    return result['access_token']


def connect_fabric():
    token = get_fabric_token()
    token_bytes = token.encode('utf-16-le')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={FABRIC_SERVER};"
        f"DATABASE={FABRIC_DB};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    return __import__('pyodbc').connect(conn_str, attrs_before={1256: token_struct})


def query_live():
    """Query Fabric SQL DB directly for entity counts by namespace and layer."""
    conn = connect_fabric()
    cursor = conn.cursor()

    # LZ entities by namespace
    cursor.execute("""
        SELECT ds.Namespace, COUNT(*) AS Total,
               SUM(CASE WHEN le.IsActive = 1 THEN 1 ELSE 0 END) AS Active,
               SUM(CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END) AS Incremental
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace ORDER BY ds.Namespace
    """)
    lz = {row[0]: {'total': row[1], 'active': row[2], 'incremental': row[3]} for row in cursor.fetchall()}

    # Bronze entities by namespace
    cursor.execute("""
        SELECT ds.Namespace, COUNT(*) AS Total,
               SUM(CASE WHEN be.IsActive = 1 THEN 1 ELSE 0 END) AS Active
        FROM integration.BronzeLayerEntity be
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace ORDER BY ds.Namespace
    """)
    bronze = {row[0]: {'total': row[1], 'active': row[2]} for row in cursor.fetchall()}

    # Silver entities by namespace
    cursor.execute("""
        SELECT ds.Namespace, COUNT(*) AS Total,
               SUM(CASE WHEN se.IsActive = 1 THEN 1 ELSE 0 END) AS Active
        FROM integration.SilverLayerEntity se
        JOIN integration.BronzeLayerEntity be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace ORDER BY ds.Namespace
    """)
    silver = {row[0]: {'total': row[1], 'active': row[2]} for row in cursor.fetchall()}

    # Connections
    cursor.execute("SELECT COUNT(*), SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) FROM integration.Connection")
    conn_row = cursor.fetchone()
    connections = {'total': conn_row[0], 'active': conn_row[1]}

    # Pipelines
    cursor.execute("SELECT COUNT(*), SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) FROM integration.Pipeline")
    pl_row = cursor.fetchone()
    pipelines = {'total': pl_row[0], 'active': pl_row[1]}

    # Recent pipeline runs
    cursor.execute("""
        SELECT
            MAX(CASE WHEN LogType LIKE 'End%' THEN
                CASE WHEN LogData LIKE '%Succeeded%' THEN 'Succeeded'
                     WHEN LogData LIKE '%Failed%' THEN 'Failed'
                     ELSE 'Unknown' END
            END) AS Status,
            PipelineName, EntityLayer,
            MIN(CASE WHEN LogType LIKE 'Start%' THEN LogDateTime END) AS StartTime,
            MAX(CASE WHEN LogType LIKE 'End%' THEN LogDateTime END) AS EndTime
        FROM logging.PipelineExecution
        WHERE LogDateTime >= DATEADD(day, -7, GETUTCDATE())
        GROUP BY PipelineRunGuid, PipelineName, EntityLayer
        ORDER BY MIN(LogDateTime) DESC
    """)
    runs = []
    for row in cursor.fetchall():
        status = row[0] or ('InProgress' if row[4] is None else 'Unknown')
        runs.append({
            'status': status, 'pipeline': row[1], 'layer': row[2],
            'start': str(row[3]) if row[3] else None, 'end': str(row[4]) if row[4] else None,
        })

    # Stuck MES entities (Bronze created but never completed loading)
    cursor.execute("""
        SELECT le.SourceName, be.BronzeLayerEntityId
        FROM integration.BronzeLayerEntity be
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE ds.Namespace = 'MES'
        AND be.BronzeLayerEntityId NOT IN (
            SELECT DISTINCT BronzeLayerEntityId FROM execution.PipelineBronzeLayerEntity
            WHERE IsProcessed = 1
        )
        AND be.IsActive = 1
    """)
    stuck_mes = [{'name': row[0], 'bronzeId': row[1]} for row in cursor.fetchall()]

    cursor.close()
    conn.close()

    return {
        'timestamp': datetime.now(timezone.utc).isoformat() + 'Z',
        'source': 'live_fabric_sql',
        'lz': lz, 'bronze': bronze, 'silver': silver,
        'connections': connections, 'pipelines': pipelines,
        'recent_runs': runs[:20], 'stuck_entities': stuck_mes,
    }


def query_snapshot():
    """Fall back to control_plane_snapshot.json if Fabric SQL is unreachable."""
    with open(SNAPSHOT_PATH) as f:
        snap = json.load(f)

    lz, bronze, silver = {}, {}, {}
    for ss in snap.get('sourceSystems', []):
        ns = ss['namespace']
        lz[ns] = {'total': ss['entities']['landing'], 'active': ss['activeEntities']['landing'], 'incremental': 0}
        bronze[ns] = {'total': ss['entities']['bronze'], 'active': ss['activeEntities']['bronze']}
        silver[ns] = {'total': ss['entities']['silver'], 'active': ss['activeEntities']['silver']}

    runs = []
    for r in snap.get('recentRuns', []):
        runs.append({
            'status': r.get('Status', 'Unknown'), 'pipeline': r.get('PipelineName', ''),
            'layer': r.get('EntityLayer', ''), 'start': r.get('StartTime'), 'end': r.get('EndTime'),
        })

    return {
        'timestamp': snap.get('lastRefreshed', datetime.now(timezone.utc).isoformat() + 'Z'),
        'source': 'snapshot',
        'lz': lz, 'bronze': bronze, 'silver': silver,
        'connections': snap.get('summary', {}).get('connections', {}),
        'pipelines': snap.get('summary', {}).get('pipelines', {}),
        'recent_runs': runs, 'stuck_entities': [],
    }


INTERNAL_NAMESPACES = {'NB', 'ONELAKE', 'Unlinked', 'NOTEBOOK', ''}


def build_matrix(data: dict) -> dict:
    """Build the status matrix from query results."""
    all_ns = sorted(set(list(data['lz'].keys()) + list(data['bronze'].keys()) + list(data['silver'].keys())))
    all_ns = [ns for ns in all_ns if ns not in INTERNAL_NAMESPACES]

    sources = []
    totals = {'lz': 0, 'lz_active': 0, 'bronze': 0, 'bronze_active': 0,
              'silver': 0, 'silver_active': 0, 'incremental': 0, 'gold': 0}

    for ns in all_ns:
        lz = data['lz'].get(ns, {'total': 0, 'active': 0, 'incremental': 0})
        br = data['bronze'].get(ns, {'total': 0, 'active': 0})
        sv = data['silver'].get(ns, {'total': 0, 'active': 0})
        incr = lz.get('incremental', 0)

        # Determine status per layer
        lz_status = 'DONE' if lz['active'] > 0 and lz['active'] == lz['total'] else ('PARTIAL' if lz['active'] > 0 else 'NOT STARTED')
        br_gap = lz['total'] - br['total']
        br_status = 'DONE' if br['total'] == lz['total'] and lz['total'] > 0 else (f'{br["total"]}/{lz["total"]}' if br['total'] > 0 else 'NOT STARTED')
        sv_gap = lz['total'] - sv['total']
        sv_status = 'DONE' if sv['total'] == lz['total'] and lz['total'] > 0 else (f'{sv["total"]}/{lz["total"]}' if sv['total'] > 0 else 'NOT STARTED')

        sources.append({
            'namespace': ns,
            'displayName': _display(ns),
            'lz': {'total': lz['total'], 'active': lz['active'], 'status': lz_status},
            'bronze': {'total': br['total'], 'active': br['active'], 'status': br_status, 'gap': br_gap},
            'silver': {'total': sv['total'], 'active': sv['active'], 'status': sv_status, 'gap': sv_gap},
            'gold': {'total': 0, 'status': 'NOT STARTED'},
            'incremental': incr,
            'fullLoad': lz['total'] - incr,
        })

        totals['lz'] += lz['total']
        totals['lz_active'] += lz['active']
        totals['bronze'] += br['total']
        totals['bronze_active'] += br['active']
        totals['silver'] += sv['total']
        totals['silver_active'] += sv['active']
        totals['incremental'] += incr

    # Pipeline health
    succeeded = sum(1 for r in data['recent_runs'] if r['status'] == 'Succeeded')
    failed = sum(1 for r in data['recent_runs'] if r['status'] == 'Failed')
    running = sum(1 for r in data['recent_runs'] if r['status'] == 'InProgress')

    return {
        'timestamp': data['timestamp'],
        'dataSource': data['source'],
        'sources': sources,
        'totals': totals,
        'infrastructure': {
            'connections': data['connections'],
            'pipelines': data['pipelines'],
        },
        'pipelineHealth': {
            'recentRuns': len(data['recent_runs']),
            'succeeded': succeeded, 'failed': failed, 'running': running,
            'successRate': f"{succeeded/(succeeded+failed)*100:.0f}%" if (succeeded+failed) > 0 else 'N/A',
        },
        'stuckEntities': data.get('stuck_entities', []),
    }


def print_matrix(matrix: dict):
    """Print the status matrix as a formatted table."""
    ts = matrix['timestamp']
    src = matrix['dataSource']
    print(f"\n{'='*90}")
    print(f"  FMD FRAMEWORK — STATUS MATRIX")
    print(f"  Generated: {ts}  (source: {src})")
    print(f"{'='*90}\n")

    # Source x Layer table
    header = f"{'Source':<14} {'LZ':>8} {'Bronze':>10} {'Silver':>10} {'Gold':>10} {'Incr':>6} {'Full':>6}"
    print(header)
    print('-' * len(header))
    for s in matrix['sources']:
        dn = s['displayName']
        lz_str = f"{s['lz']['active']}/{s['lz']['total']}"
        br_str = s['bronze']['status'] if s['bronze']['status'] in ('DONE', 'NOT STARTED') else f"{s['bronze']['total']}/{s['lz']['total']}"
        sv_str = s['silver']['status'] if s['silver']['status'] in ('DONE', 'NOT STARTED') else f"{s['silver']['total']}/{s['lz']['total']}"
        gold_str = s['gold']['status']
        incr = str(s['incremental'])
        full = str(s['fullLoad'])
        print(f"{dn:<14} {lz_str:>8} {br_str:>10} {sv_str:>10} {gold_str:>10} {incr:>6} {full:>6}")

    t = matrix['totals']
    print('-' * len(header))
    print(f"{'TOTAL':<14} {t['lz_active']}/{t['lz']:>5} {t['bronze']:>10} {t['silver']:>10} {'0':>10} {t['incremental']:>6} {t['lz']-t['incremental']:>6}")

    # Layer summary
    lz_pct = t['lz_active'] / t['lz'] * 100 if t['lz'] else 0
    br_pct = t['bronze'] / t['lz'] * 100 if t['lz'] else 0
    sv_pct = t['silver'] / t['lz'] * 100 if t['lz'] else 0
    print(f"\n{'Layer Summary':}")
    print(f"  Landing Zone:  {t['lz_active']}/{t['lz']} ({lz_pct:.1f}%)")
    print(f"  Bronze:        {t['bronze']}/{t['lz']} ({br_pct:.1f}%)")
    print(f"  Silver:        {t['silver']}/{t['lz']} ({sv_pct:.1f}%)")
    print(f"  Gold (MLV):    0 — NOT STARTED")

    # Pipeline health
    ph = matrix['pipelineHealth']
    infra = matrix['infrastructure']
    print(f"\nInfrastructure:")
    print(f"  Connections: {infra['connections'].get('active', '?')}/{infra['connections'].get('total', '?')} active")
    print(f"  Pipelines:   {infra['pipelines'].get('active', '?')}/{infra['pipelines'].get('total', '?')} active")
    print(f"\nPipeline Health (last 7 days):")
    print(f"  Runs: {ph['recentRuns']} | Succeeded: {ph['succeeded']} | Failed: {ph['failed']} | Running: {ph['running']}")
    print(f"  Success Rate: {ph['successRate']}")

    # Stuck entities
    stuck = matrix.get('stuckEntities', [])
    if stuck:
        print(f"\nStuck Entities ({len(stuck)}):")
        for e in stuck:
            print(f"  - {e['name']} (Bronze ID: {e['bronzeId']})")

    print(f"\n{'='*90}\n")


def print_markdown(matrix: dict):
    """Print the status matrix as a markdown table."""
    print(f"## FMD Framework — Status Matrix")
    print(f"*Generated: {matrix['timestamp']} (source: {matrix['dataSource']})*\n")

    print(f"| Source | LZ | Bronze | Silver | Gold | Incr | Full |")
    print(f"|---|---|---|---|---|---|---|")
    for s in matrix['sources']:
        dn = s['displayName']
        lz_str = f"{s['lz']['active']}/{s['lz']['total']}"
        br_str = s['bronze']['status'] if s['bronze']['status'] in ('DONE', 'NOT STARTED') else f"{s['bronze']['total']}/{s['lz']['total']}"
        sv_str = s['silver']['status'] if s['silver']['status'] in ('DONE', 'NOT STARTED') else f"{s['silver']['total']}/{s['lz']['total']}"
        gold_str = s['gold']['status']
        print(f"| **{dn}** | {lz_str} | {br_str} | {sv_str} | {gold_str} | {s['incremental']} | {s['fullLoad']} |")

    t = matrix['totals']
    print(f"| **TOTAL** | **{t['lz_active']}/{t['lz']}** | **{t['bronze']}** | **{t['silver']}** | **0** | **{t['incremental']}** | **{t['lz']-t['incremental']}** |")

    ph = matrix['pipelineHealth']
    print(f"\n**Pipeline Health**: {ph['succeeded']} succeeded / {ph['failed']} failed / {ph['running']} running ({ph['successRate']} success rate)")

    stuck = matrix.get('stuckEntities', [])
    if stuck:
        print(f"\n**Stuck Entities** ({len(stuck)}):")
        for e in stuck:
            print(f"- `{e['name']}` (Bronze ID: {e['bronzeId']})")


def main():
    output_json = '--json' in sys.argv
    output_md = '--markdown' in sys.argv
    use_snapshot = '--snapshot' in sys.argv

    # Try live DB first, fall back to snapshot
    if use_snapshot:
        print("Using snapshot (--snapshot flag)...", file=sys.stderr)
        data = query_snapshot()
    else:
        try:
            data = query_live()
        except Exception as e:
            print(f"Live DB unavailable ({e}), falling back to snapshot...", file=sys.stderr)
            data = query_snapshot()

    matrix = build_matrix(data)

    if output_json:
        print(json.dumps(matrix, indent=2))
    elif output_md:
        print_markdown(matrix)
    else:
        print_matrix(matrix)


if __name__ == '__main__':
    main()
