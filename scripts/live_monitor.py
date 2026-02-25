#!/usr/bin/env python3
"""FMD Real-Time Pipeline Monitor.

Live-polls SQL metadata DB + Fabric API to show exactly what's happening
during pipeline execution — entity by entity, row by row.

Usage: python scripts/live_monitor.py [--layer bronze|silver|landingzone|all] [--interval 5]
"""

import json, struct, os, sys, time, argparse
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

# ─── Credentials ─────────────────────────────────────────────────
TENANT_ID = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT_ID = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
CLIENT_SECRET = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
SQL_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
SQL_DATABASE = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
CODE_WS = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
FABRIC_API = 'https://api.fabric.microsoft.com/v1'

# Pipeline IDs in Fabric
PIPELINE_IDS = {
    'PL_FMD_LOAD_BRONZE': '8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3',
    'PL_FMD_LOAD_SILVER': '90c0535c-c5dc-43a3-b51e-c44ef1808a60',
}

# ─── ANSI Colors ─────────────────────────────────────────────────
class C:
    RESET   = '\033[0m'
    BOLD    = '\033[1m'
    DIM     = '\033[2m'
    RED     = '\033[91m'
    GREEN   = '\033[92m'
    YELLOW  = '\033[93m'
    BLUE    = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN    = '\033[96m'
    WHITE   = '\033[97m'
    BG_RED  = '\033[41m'
    BG_GREEN = '\033[42m'
    BG_BLUE = '\033[44m'


def clear_screen():
    os.system('cls' if os.name == 'nt' else 'clear')


def progress_bar(current, total, width=40):
    if total == 0:
        return f"{'░' * width}  0/0"
    pct = current / total
    filled = int(width * pct)
    bar = '█' * filled + '░' * (width - filled)
    return f"{bar}  {current}/{total} ({pct*100:.1f}%)"


def fmt_duration(seconds):
    if seconds is None or seconds < 0:
        return '...'
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f'{h}h {m}m {s}s'
    elif m > 0:
        return f'{m}m {s}s'
    return f'{s}s'


def fmt_time(dt):
    if dt is None:
        return '—'
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt.replace('Z', '+00:00'))
    # Convert to Eastern
    eastern = timezone(timedelta(hours=-5))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(eastern)
    return local.strftime('%I:%M:%S %p')


def fmt_bytes(b):
    if b is None:
        return '—'
    if b < 1024:
        return f'{b} B'
    if b < 1024**2:
        return f'{b/1024:.1f} KB'
    if b < 1024**3:
        return f'{b/1024**2:.1f} MB'
    return f'{b/1024**3:.2f} GB'


# ─── Auth & Connection ───────────────────────────────────────────
import pyodbc

_token_cache = {'token': None, 'expires': 0}

def get_sql_token():
    now = time.time()
    if _token_cache['token'] and now < _token_cache['expires'] - 60:
        return _token_cache['token']
    data = urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'scope': 'https://analysis.windows.net/powerbi/api/.default'
    }).encode()
    req = Request(f'https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token',
                  data=data, method='POST')
    resp = json.loads(urlopen(req).read())
    _token_cache['token'] = resp['access_token']
    _token_cache['expires'] = now + resp.get('expires_in', 3600)
    return resp['access_token']


def get_fabric_token():
    data = urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'scope': 'https://api.fabric.microsoft.com/.default'
    }).encode()
    req = Request(f'https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token',
                  data=data, method='POST')
    return json.loads(urlopen(req).read())['access_token']


def get_sql_connection():
    token = get_sql_token()
    tb = token.encode('UTF-16-LE')
    ts = struct.pack(f'<I{len(tb)}s', len(tb), tb)
    return pyodbc.connect(
        f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SQL_SERVER};PORT=1433;DATABASE={SQL_DATABASE};',
        attrs_before={1256: ts}, timeout=30, autocommit=True
    )


def query_sql(conn, sql):
    cursor = conn.cursor()
    cursor.execute(sql)
    cols = [d[0] for d in cursor.description] if cursor.description else []
    rows = cursor.fetchall() if cols else []
    return [dict(zip(cols, r)) for r in rows]


def query_scalar(conn, sql):
    cursor = conn.cursor()
    cursor.execute(sql)
    row = cursor.fetchone()
    return row[0] if row else 0


# ─── Fabric API ──────────────────────────────────────────────────
def get_pipeline_jobs(pipeline_name):
    """Get recent job instances for a pipeline from Fabric API."""
    pid = PIPELINE_IDS.get(pipeline_name)
    if not pid:
        return []
    try:
        token = get_fabric_token()
        req = Request(
            f'{FABRIC_API}/workspaces/{CODE_WS}/items/{pid}/jobs/instances?limit=5',
            headers={'Authorization': f'Bearer {token}'}
        )
        resp = json.loads(urlopen(req).read())
        return resp.get('value', [])
    except Exception:
        return []


# ─── Data Collection ─────────────────────────────────────────────
def collect_pipeline_status(conn, lookback_hours=2):
    """Get recent pipeline execution events."""
    return query_sql(conn, f"""
        SELECT TOP 20 PipelineName, LogType, LogDateTime, LogData,
               PipelineRunGuid, EntityLayer
        FROM [logging].[PipelineExecution]
        WHERE LogDateTime > DATEADD(HOUR, -{lookback_hours}, GETUTCDATE())
        ORDER BY LogDateTime DESC
    """)


def collect_notebook_activity(conn, lookback_hours=2):
    """Get recent notebook execution events (entity-level)."""
    return query_sql(conn, f"""
        SELECT TOP 50 NotebookName, LogType, LogDateTime, LogData,
               EntityId, EntityLayer, PipelineRunGuid
        FROM [logging].[NotebookExecution]
        WHERE LogDateTime > DATEADD(HOUR, -{lookback_hours}, GETUTCDATE())
        ORDER BY LogDateTime DESC
    """)


def collect_copy_activity(conn, lookback_hours=2):
    """Get recent copy activity events (LZ loads with row counts)."""
    return query_sql(conn, f"""
        SELECT TOP 30 CopyActivityName, CopyActivityParameters, LogType, LogDateTime,
               LogData, EntityId, EntityLayer, PipelineRunGuid
        FROM [logging].[CopyActivityExecution]
        WHERE LogDateTime > DATEADD(HOUR, -{lookback_hours}, GETUTCDATE())
        ORDER BY LogDateTime DESC
    """)


def collect_processing_counts(conn):
    """Get entity processing progress."""
    return {
        'lz_total': query_scalar(conn, "SELECT COUNT(*) FROM [integration].[LandingzoneEntity]"),
        'lz_pipeline_total': query_scalar(conn, "SELECT COUNT(*) FROM [execution].[PipelineLandingzoneEntity]"),
        'lz_processed': query_scalar(conn, "SELECT COUNT(*) FROM [execution].[PipelineLandingzoneEntity] WHERE IsProcessed = 1"),
        'brz_total': query_scalar(conn, "SELECT COUNT(*) FROM [integration].[BronzeLayerEntity]"),
        'brz_pipeline_total': query_scalar(conn, "SELECT COUNT(*) FROM [execution].[PipelineBronzeLayerEntity]"),
        'brz_processed': query_scalar(conn, "SELECT COUNT(*) FROM [execution].[PipelineBronzeLayerEntity] WHERE IsProcessed = 1"),
        'slv_total': query_scalar(conn, "SELECT COUNT(*) FROM [integration].[SilverLayerEntity]"),
        'brz_view_pending': query_scalar(conn, "SELECT COUNT(*) FROM [execution].[vw_LoadToBronzeLayer]"),
        'slv_view_pending': query_scalar(conn, "SELECT COUNT(*) FROM [execution].[vw_LoadToSilverLayer]"),
    }


def collect_recent_bronze_entities(conn, limit=15):
    """Get recently processed Bronze entities with details."""
    return query_sql(conn, f"""
        SELECT TOP {limit} pbe.BronzeLayerEntityId, pbe.SchemaName, pbe.TableName,
               pbe.InsertDateTime, pbe.IsProcessed, pbe.LoadEndDateTime
        FROM [execution].[PipelineBronzeLayerEntity] pbe
        ORDER BY pbe.InsertDateTime DESC
    """)


def collect_recent_lz_entities(conn, limit=15):
    """Get recently processed LZ entities."""
    return query_sql(conn, f"""
        SELECT TOP {limit} ple.LandingzoneEntityId, ple.FilePath, ple.FileName,
               ple.InsertDateTime, ple.IsProcessed, ple.LoadEndDateTime
        FROM [execution].[PipelineLandingzoneEntity] ple
        ORDER BY ple.InsertDateTime DESC
    """)


# ─── Display ─────────────────────────────────────────────────────
def render(conn, layer_filter, cycle_count):
    clear_screen()
    now_utc = datetime.now(timezone.utc)
    eastern = timezone(timedelta(hours=-5))
    now_local = now_utc.astimezone(eastern)

    # Header
    print(f"{C.BOLD}{C.CYAN}{'═'*78}{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}  FMD LIVE PIPELINE MONITOR{C.RESET}    {C.DIM}Refresh #{cycle_count}  •  {now_local.strftime('%I:%M:%S %p ET')}{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}{'═'*78}{C.RESET}")

    # ── Pipeline Runs ────────────────────────────────────────────
    pipeline_events = collect_pipeline_status(conn)

    # Group by PipelineRunGuid to build run status
    runs = {}
    for evt in pipeline_events:
        guid = str(evt['PipelineRunGuid'])
        if guid not in runs:
            runs[guid] = {'name': evt['PipelineName'], 'events': [], 'layer': evt['EntityLayer']}
        runs[guid]['events'].append(evt)

    print(f"\n{C.BOLD}{C.WHITE}  PIPELINE RUNS (last 2h){C.RESET}")
    print(f"  {'─'*74}")

    shown = 0
    for guid, run in runs.items():
        if shown >= 8:
            break
        name = run['name']
        events = sorted(run['events'], key=lambda x: x['LogDateTime'])
        start_evt = next((e for e in events if e['LogType'] == 'StartPipeline'), None)
        end_evt = next((e for e in events if e['LogType'] in ('EndPipeline', 'FailPipeline')), None)

        start_time = start_evt['LogDateTime'] if start_evt else None
        end_time = end_evt['LogDateTime'] if end_evt else None

        if end_evt and end_evt['LogType'] == 'FailPipeline':
            status = f"{C.RED}FAILED{C.RESET}"
            icon = f"{C.RED}✗{C.RESET}"
        elif end_evt:
            status = f"{C.GREEN}Completed{C.RESET}"
            icon = f"{C.GREEN}✓{C.RESET}"
        else:
            status = f"{C.YELLOW}Running...{C.RESET}"
            icon = f"{C.YELLOW}●{C.RESET}"

        duration = None
        if start_time and end_time:
            duration = (end_time - start_time).total_seconds()
        elif start_time:
            duration = (now_utc.replace(tzinfo=None) - start_time).total_seconds()

        dur_str = fmt_duration(duration)
        print(f"  {icon} {C.BOLD}{name:40s}{C.RESET} {status:30s} {fmt_time(start_time):>12s}  {C.DIM}{dur_str}{C.RESET}")

        # Show error detail for failures
        if end_evt and end_evt['LogType'] == 'FailPipeline' and end_evt.get('LogData'):
            try:
                err_data = json.loads(end_evt['LogData'])
                msg = err_data.get('Message', str(err_data))[:100]
                print(f"    {C.RED}└─ {msg}{C.RESET}")
            except:
                pass
        shown += 1

    if not runs:
        print(f"  {C.DIM}No pipeline runs in the last 2 hours{C.RESET}")

    # ── Processing Progress ──────────────────────────────────────
    counts = collect_processing_counts(conn)

    print(f"\n{C.BOLD}{C.WHITE}  ENTITY PROCESSING{C.RESET}")
    print(f"  {'─'*74}")

    # Landing Zone
    lz_proc = counts['lz_processed']
    lz_total = counts['lz_pipeline_total']
    print(f"  {C.CYAN}Landing Zone:{C.RESET}  {progress_bar(lz_proc, lz_total)}")
    print(f"                {C.DIM}Registered: {counts['lz_total']} entities  •  Pipeline queue: {lz_total}  •  Processed: {lz_proc}{C.RESET}")

    # Bronze
    brz_proc = counts['brz_processed']
    brz_total = counts['brz_pipeline_total']
    brz_pending = counts['brz_view_pending']
    print(f"  {C.YELLOW}Bronze:{C.RESET}        {progress_bar(brz_proc, brz_total)}")
    print(f"                {C.DIM}Registered: {counts['brz_total']} entities  •  Pipeline queue: {brz_total}  •  View pending: {brz_pending}{C.RESET}")

    # Silver
    slv_pending = counts['slv_view_pending']
    print(f"  {C.MAGENTA}Silver:{C.RESET}        {progress_bar(0, counts['slv_total'])}")
    print(f"                {C.DIM}Registered: {counts['slv_total']} entities  •  View pending: {slv_pending}{C.RESET}")

    # ── Notebook Executions (entity-level detail) ────────────────
    nb_events = collect_notebook_activity(conn)

    print(f"\n{C.BOLD}{C.WHITE}  NOTEBOOK EXECUTIONS (entity-level){C.RESET}")
    print(f"  {'─'*74}")

    if nb_events:
        # Count by status
        starts = sum(1 for e in nb_events if e['LogType'] == 'StartNotebookActivity')
        ends = sum(1 for e in nb_events if e['LogType'] == 'EndNotebookActivity')
        fails = sum(1 for e in nb_events if e['LogType'] == 'FailNotebookActivity')

        print(f"  {C.DIM}Activity: {C.GREEN}{ends} completed{C.RESET}{C.DIM}, {C.YELLOW}{starts - ends} in progress{C.RESET}{C.DIM}, {C.RED}{fails} failed{C.RESET}")
        print()

        for evt in nb_events[:20]:
            log_type = evt['LogType']
            entity_id = evt.get('EntityId', '?')
            layer = evt.get('EntityLayer', '?')
            nb_name = evt.get('NotebookName', '?')
            log_time = evt['LogDateTime']

            # Parse LogData for details
            detail = ''
            if evt.get('LogData'):
                try:
                    ld = json.loads(evt['LogData'])
                    action = ld.get('Action', '')
                    if action == 'End':
                        copy_out = ld.get('CopyOutput', {})
                        if isinstance(copy_out, dict):
                            runtime = copy_out.get('Total Runtime', '')
                            schema = copy_out.get('TargetSchema', '')
                            tname = copy_out.get('TargetName', '')
                            rows = copy_out.get('RowsInserted', copy_out.get('rowsCopied', ''))
                            detail = f"{schema}.{tname}" if schema and tname else ''
                            if rows:
                                detail += f" ({rows:,} rows)" if isinstance(rows, int) else f" ({rows} rows)"
                            if runtime:
                                detail += f" [{runtime}]"
                        elif isinstance(copy_out, str):
                            detail = copy_out[:80]
                    elif action == 'Error':
                        msg = ld.get('Message', str(ld))[:80]
                        detail = msg
                except:
                    detail = str(evt['LogData'])[:60]

            if log_type == 'EndNotebookActivity':
                icon = f"{C.GREEN}✓{C.RESET}"
                status_c = C.GREEN
            elif log_type == 'FailNotebookActivity':
                icon = f"{C.RED}✗{C.RESET}"
                status_c = C.RED
            else:
                icon = f"{C.YELLOW}→{C.RESET}"
                status_c = C.YELLOW

            entity_str = f"Entity {entity_id}" if entity_id else ''
            time_str = fmt_time(log_time)

            line = f"  {icon} {time_str:>12s}  {C.BOLD}{nb_name:36s}{C.RESET} {entity_str:>12s}  {layer:>8s}"
            if detail:
                line += f"\n    {C.DIM}{status_c}{detail}{C.RESET}"
            print(line)
    else:
        print(f"  {C.DIM}No notebook executions in the last 2 hours{C.RESET}")
        print(f"  {C.DIM}(This section populates when Bronze/Silver notebooks process entities){C.RESET}")

    # ── Copy Activity (LZ Loads) ─────────────────────────────────
    copy_events = collect_copy_activity(conn)

    if copy_events:
        print(f"\n{C.BOLD}{C.WHITE}  COPY ACTIVITY (Landing Zone loads){C.RESET}")
        print(f"  {'─'*74}")

        end_copies = [e for e in copy_events if e['LogType'] == 'EndCopyActivity'][:10]
        for evt in end_copies:
            entity_name = evt.get('CopyActivityParameters', '?')
            log_time = evt['LogDateTime']

            rows_copied = 0
            data_written = 0
            if evt.get('LogData'):
                try:
                    ld = json.loads(evt['LogData'])
                    copy_out = ld.get('CopyOutput', {})
                    if isinstance(copy_out, dict):
                        rows_copied = copy_out.get('rowsCopied', 0)
                        data_written = copy_out.get('dataWritten', 0)
                except:
                    pass

            time_str = fmt_time(log_time)
            rows_str = f"{rows_copied:>8,} rows" if rows_copied else "       — rows"
            size_str = fmt_bytes(data_written)
            print(f"  {C.GREEN}✓{C.RESET} {time_str:>12s}  {entity_name:30s}  {rows_str}  {C.DIM}{size_str}{C.RESET}")

    # ── Recently Processed Bronze Entities ───────────────────────
    brz_entities = collect_recent_bronze_entities(conn)

    if brz_entities:
        print(f"\n{C.BOLD}{C.WHITE}  BRONZE LAYER — Recently Processed Entities{C.RESET}")
        print(f"  {'─'*74}")

        for ent in brz_entities[:15]:
            schema = ent.get('SchemaName', '—')
            table = ent.get('TableName', '—')
            processed = ent.get('IsProcessed', False)
            insert_time = ent.get('InsertDateTime')
            load_end = ent.get('LoadEndDateTime')

            if processed:
                icon = f"{C.GREEN}✓{C.RESET}"
            else:
                icon = f"{C.YELLOW}●{C.RESET}"

            duration = ''
            if insert_time and load_end:
                dur_secs = (load_end - insert_time).total_seconds()
                duration = fmt_duration(dur_secs)

            time_str = fmt_time(insert_time)
            print(f"  {icon} {time_str:>12s}  {schema}.{table:40s}  {C.DIM}{duration}{C.RESET}")

    # ── Footer ───────────────────────────────────────────────────
    print(f"\n{C.DIM}  Press Ctrl+C to stop  •  Auto-refreshing every {{interval}}s{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}{'═'*78}{C.RESET}")


def main():
    parser = argparse.ArgumentParser(description='FMD Real-Time Pipeline Monitor')
    parser.add_argument('--layer', default='all', choices=['bronze', 'silver', 'landingzone', 'all'])
    parser.add_argument('--interval', type=int, default=5, help='Refresh interval in seconds')
    args = parser.parse_args()

    print(f"{C.CYAN}Connecting to SQL...{C.RESET}")
    conn = get_sql_connection()
    print(f"{C.GREEN}Connected.{C.RESET} Starting monitor (refresh every {args.interval}s)...\n")
    time.sleep(1)

    cycle = 0
    try:
        while True:
            cycle += 1
            try:
                render(conn, args.layer, cycle)
            except pyodbc.Error as e:
                # Reconnect on connection loss
                print(f"\n{C.RED}SQL connection lost, reconnecting...{C.RESET}")
                try:
                    conn.close()
                except:
                    pass
                time.sleep(2)
                conn = get_sql_connection()
                print(f"{C.GREEN}Reconnected.{C.RESET}")
                continue
            except Exception as e:
                print(f"\n{C.RED}Error: {e}{C.RESET}")
                import traceback
                traceback.print_exc()

            time.sleep(args.interval)
    except KeyboardInterrupt:
        print(f"\n\n{C.CYAN}Monitor stopped.{C.RESET}")
    finally:
        try:
            conn.close()
        except:
            pass


if __name__ == '__main__':
    main()
