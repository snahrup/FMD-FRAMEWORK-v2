"""
FMD Framework -- Comprehensive Gap Report
==========================================
Queries the Fabric SQL metadata DB and reports the complete registration and
execution status across ALL data sources and ALL layers (LZ, Bronze, Silver).

Auth: Service Principal token via urllib (no azure.identity, no msal).
      Uses pyodbc attrs_before={1256: token_struct} for Fabric SQL AAD auth.

Usage:
    python scripts/gap_report.py
"""

import urllib.request
import urllib.parse
import json
import struct
import sys
import os
from datetime import datetime, timezone

# ── Auth / Connection config ──────────────────────────────────────────────────
TENANT  = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT  = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET  = 'Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu'
SERVER  = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
DATABASE = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
DRIVER  = 'ODBC Driver 18 for SQL Server'

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
REPORT_PATH  = os.path.join(SCRIPT_DIR, 'gap_report_results.txt')

# Canonical source display names keyed by Namespace
SOURCE_DISPLAY = {
    'MES':    'MES (DS4)',
    'ETQ':    'ETQ (DS5)',
    'M3':     'M3 ERP (DS6)',
    'M3C':    'M3 Cloud (DS7)',
    'OPTIVA': 'OPTIVA (DS8)',
}
INTERNAL_NS = {'NB', 'ONELAKE', 'NOTEBOOK', ''}


# ── Token acquisition (urllib only, no azure.identity) ───────────────────────

def get_token():
    """Acquire a Service Principal token for Fabric SQL auth via urllib."""
    body = urllib.parse.urlencode({
        'grant_type':    'client_credentials',
        'client_id':     CLIENT,
        'client_secret': SECRET,
        'scope':         'https://analysis.windows.net/powerbi/api/.default',
    }).encode()
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=body,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    if 'access_token' not in resp:
        raise RuntimeError(f"Token acquisition failed: {resp.get('error_description', resp)}")
    return resp['access_token']


# ── Database connection ───────────────────────────────────────────────────────

def connect():
    """Connect to Fabric SQL Database using SP token injection."""
    import pyodbc
    token        = get_token()
    token_bytes  = token.encode('UTF-16-LE')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    conn_str = (
        f'DRIVER={{{DRIVER}}};'
        f'SERVER={SERVER};'
        f'DATABASE={DATABASE};'
        f'Encrypt=yes;TrustServerCertificate=no;'
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


# ── Query helpers ─────────────────────────────────────────────────────────────

def qry(cursor, sql, label=''):
    """Execute a query, return (cols, rows). On error return ([], []) with a print."""
    try:
        cursor.execute(sql)
        if cursor.description:
            cols = [c[0] for c in cursor.description]
            return cols, cursor.fetchall()
        return [], []
    except Exception as ex:
        err = str(ex).replace('\n', ' ')[:200]
        print(f'  [WARN] Query "{label}" failed: {err}')
        return [], []


# ── Formatting helpers ────────────────────────────────────────────────────────

def sep(char='=', width=90):
    return char * width


def fmt_table(cols, rows, indent=2, max_col=60):
    """Render (cols, rows) as an aligned ASCII table. Returns a list of lines."""
    if not cols or not rows:
        return [' ' * indent + '(no rows)']

    def trunc(v, w):
        s = str(v) if v is not None else 'NULL'
        return (s[:w - 3] + '...') if len(s) > w else s

    widths = [
        min(max(len(c), max(len(trunc(r[i], max_col)) for r in rows)), max_col)
        for i, c in enumerate(cols)
    ]
    px = ' ' * indent
    border = px + '+' + '+'.join('-' * (w + 2) for w in widths) + '+'
    header = px + '|' + '|'.join(f' {c.ljust(w)} ' for c, w in zip(cols, widths)) + '|'
    lines  = [border, header, border]
    for row in rows:
        line = px + '|' + '|'.join(f' {trunc(v, w).ljust(w)} ' for v, w in zip(row, widths)) + '|'
        lines.append(line)
    lines.append(border)
    lines.append(px + f'  ({len(rows)} row{"s" if len(rows) != 1 else ""})')
    return lines


def pct(num, denom):
    if not denom:
        return '   N/A'
    return f'{100 * num / denom:5.1f}%'


# ── Data collection ───────────────────────────────────────────────────────────

def collect_all(cursor):
    """Run every query needed for the gap report. Returns a big dict."""
    data = {}

    # ─────────────────────────────────────────────────────────────────────────
    # 1. Data Sources catalog
    # ─────────────────────────────────────────────────────────────────────────
    data['sources_cols'], data['sources_rows'] = qry(cursor, """
        SELECT
            ds.DataSourceId,
            ds.Namespace,
            ds.Name        AS DataSourceName,
            ds.Type        AS SourceType,
            ds.IsActive,
            c.Name         AS ConnectionName,
            c.GatewayType,
            c.IsActive     AS ConnectionActive
        FROM integration.DataSource ds
        JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
        ORDER BY ds.DataSourceId
    """, 'Data Sources')

    # ─────────────────────────────────────────────────────────────────────────
    # 2. LZ entity counts per source (registration)
    # ─────────────────────────────────────────────────────────────────────────
    data['lz_reg_cols'], data['lz_reg_rows'] = qry(cursor, """
        SELECT
            ds.DataSourceId,
            ds.Namespace,
            COUNT(*)                                                        AS TotalEntities,
            SUM(CASE WHEN le.IsActive = 1 THEN 1 ELSE 0 END)               AS ActiveEntities,
            SUM(CASE WHEN le.IsActive = 0 THEN 1 ELSE 0 END)               AS InactiveEntities,
            SUM(CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END)          AS IncrementalEntities,
            SUM(CASE WHEN le.IsIncremental = 0 AND le.IsActive = 1
                     THEN 1 ELSE 0 END)                                     AS FullLoadEntities
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.DataSourceId, ds.Namespace
        ORDER BY ds.DataSourceId
    """, 'LZ Registration')

    # ─────────────────────────────────────────────────────────────────────────
    # 3. Bronze entity counts per source (registration)
    # ─────────────────────────────────────────────────────────────────────────
    data['bronze_reg_cols'], data['bronze_reg_rows'] = qry(cursor, """
        SELECT
            ds.DataSourceId,
            ds.Namespace,
            COUNT(*)                                                  AS TotalBronze,
            SUM(CASE WHEN be.IsActive = 1 THEN 1 ELSE 0 END)         AS ActiveBronze,
            SUM(CASE WHEN be.IsActive = 0 THEN 1 ELSE 0 END)         AS InactiveBronze
        FROM integration.BronzeLayerEntity be
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.DataSourceId, ds.Namespace
        ORDER BY ds.DataSourceId
    """, 'Bronze Registration')

    # ─────────────────────────────────────────────────────────────────────────
    # 4. Silver entity counts per source (registration)
    # ─────────────────────────────────────────────────────────────────────────
    data['silver_reg_cols'], data['silver_reg_rows'] = qry(cursor, """
        SELECT
            ds.DataSourceId,
            ds.Namespace,
            COUNT(*)                                                  AS TotalSilver,
            SUM(CASE WHEN se.IsActive = 1 THEN 1 ELSE 0 END)         AS ActiveSilver,
            SUM(CASE WHEN se.IsActive = 0 THEN 1 ELSE 0 END)         AS InactiveSilver
        FROM integration.SilverLayerEntity se
        JOIN integration.BronzeLayerEntity be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.DataSourceId, ds.Namespace
        ORDER BY ds.DataSourceId
    """, 'Silver Registration')

    # ─────────────────────────────────────────────────────────────────────────
    # 5. LZ entities NOT yet in Bronze (gap detail)
    # ─────────────────────────────────────────────────────────────────────────
    data['lz_no_bronze_cols'], data['lz_no_bronze_rows'] = qry(cursor, """
        SELECT
            ds.Namespace,
            le.LandingzoneEntityId,
            le.SourceSchema + '.' + le.SourceName AS EntityName,
            le.IsActive,
            le.IsIncremental
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.LandingzoneEntityId NOT IN (
            SELECT DISTINCT LandingzoneEntityId FROM integration.BronzeLayerEntity
        )
        AND ds.Namespace NOT IN ('NB', 'ONELAKE', 'NOTEBOOK')
        ORDER BY ds.Namespace, le.SourceSchema, le.SourceName
    """, 'LZ entities missing Bronze')

    # ─────────────────────────────────────────────────────────────────────────
    # 6. Bronze entities NOT yet in Silver (gap detail)
    # ─────────────────────────────────────────────────────────────────────────
    data['bronze_no_silver_cols'], data['bronze_no_silver_rows'] = qry(cursor, """
        SELECT
            ds.Namespace,
            be.BronzeLayerEntityId,
            le.SourceSchema + '.' + le.SourceName AS EntityName,
            be.IsActive
        FROM integration.BronzeLayerEntity be
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE be.BronzeLayerEntityId NOT IN (
            SELECT DISTINCT BronzeLayerEntityId FROM integration.SilverLayerEntity
        )
        AND ds.Namespace NOT IN ('NB', 'ONELAKE', 'NOTEBOOK')
        ORDER BY ds.Namespace, le.SourceSchema, le.SourceName
    """, 'Bronze entities missing Silver')

    # ─────────────────────────────────────────────────────────────────────────
    # 7. LZ execution status (PipelineLandingzoneEntity processed/unprocessed)
    # ─────────────────────────────────────────────────────────────────────────
    data['lz_exec_cols'], data['lz_exec_rows'] = qry(cursor, """
        SELECT
            ds.Namespace,
            COUNT(*)                                                         AS TotalTracked,
            SUM(CASE WHEN ple.IsProcessed = 1 THEN 1 ELSE 0 END)            AS Processed,
            SUM(CASE WHEN ple.IsProcessed = 0 THEN 1 ELSE 0 END)            AS Pending,
            MAX(ple.LoadEndDateTime)                                         AS LastLoadEnd
        FROM execution.PipelineLandingzoneEntity ple
        JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace
        ORDER BY ds.Namespace
    """, 'LZ Execution')

    # ─────────────────────────────────────────────────────────────────────────
    # 8. Active LZ entities that have NEVER been loaded (zero execution records)
    # ─────────────────────────────────────────────────────────────────────────
    data['lz_never_loaded_cols'], data['lz_never_loaded_rows'] = qry(cursor, """
        SELECT
            ds.Namespace,
            COUNT(*) AS NeverLoadedCount
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.IsActive = 1
        AND ds.Namespace NOT IN ('NB', 'ONELAKE', 'NOTEBOOK')
        AND le.LandingzoneEntityId NOT IN (
            SELECT DISTINCT LandingzoneEntityId FROM execution.PipelineLandingzoneEntity
        )
        GROUP BY ds.Namespace
        ORDER BY ds.Namespace
    """, 'LZ Never Loaded')

    # ─────────────────────────────────────────────────────────────────────────
    # 9. Bronze execution status
    # ─────────────────────────────────────────────────────────────────────────
    data['bronze_exec_cols'], data['bronze_exec_rows'] = qry(cursor, """
        SELECT
            ds.Namespace,
            COUNT(*)                                                          AS TotalTracked,
            SUM(CASE WHEN pbe.IsProcessed = 1 THEN 1 ELSE 0 END)             AS Processed,
            SUM(CASE WHEN pbe.IsProcessed = 0 THEN 1 ELSE 0 END)             AS Pending,
            MAX(pbe.LoadEndDateTime)                                          AS LastLoadEnd
        FROM execution.PipelineBronzeLayerEntity pbe
        JOIN integration.BronzeLayerEntity be ON pbe.BronzeLayerEntityId = be.BronzeLayerEntityId
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace
        ORDER BY ds.Namespace
    """, 'Bronze Execution')

    # ─────────────────────────────────────────────────────────────────────────
    # 10. Silver execution status (via view)
    # ─────────────────────────────────────────────────────────────────────────
    data['silver_exec_cols'], data['silver_exec_rows'] = qry(cursor, """
        SELECT
            DataSourceNamespace,
            COUNT(*) AS QueuedForSilver
        FROM execution.vw_LoadToSilverLayer
        GROUP BY DataSourceNamespace
        ORDER BY DataSourceNamespace
    """, 'Silver Queue View')

    # ─────────────────────────────────────────────────────────────────────────
    # 11. Recent failed copy activities
    # ─────────────────────────────────────────────────────────────────────────
    data['failed_copy_cols'], data['failed_copy_rows'] = qry(cursor, """
        SELECT TOP 50 *
        FROM logging.CopyActivityExecution
        ORDER BY 1 DESC
    """, 'CopyActivityExecution')

    # ─────────────────────────────────────────────────────────────────────────
    # 12. Recent pipeline execution errors
    # ─────────────────────────────────────────────────────────────────────────
    data['pipeline_errors_cols'], data['pipeline_errors_rows'] = qry(cursor, """
        SELECT TOP 30
            PipelineName,
            EntityLayer,
            EntityId,
            LogType,
            LogDateTime,
            LEFT(LogData, 300) AS LogDataPreview
        FROM logging.PipelineExecution
        WHERE LogData LIKE '%Failed%'
           OR LogData LIKE '%Error%'
           OR LogData LIKE '%error%'
           OR LogType LIKE '%Failed%'
        ORDER BY LogDateTime DESC
    """, 'Pipeline Errors')

    # ─────────────────────────────────────────────────────────────────────────
    # 13. Incremental load watermarks (LandingzoneEntityLastLoadValue)
    # ─────────────────────────────────────────────────────────────────────────
    data['watermarks_cols'], data['watermarks_rows'] = qry(cursor, """
        SELECT
            ds.Namespace,
            le.SourceSchema + '.' + le.SourceName AS EntityName,
            le.IsIncrementalColumn                AS WatermarkColumn,
            llv.LoadValue                          AS LastLoadValue,
            llv.LandingzoneEntityId
        FROM execution.LandingzoneEntityLastLoadValue llv
        JOIN integration.LandingzoneEntity le ON llv.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        ORDER BY ds.Namespace, le.SourceSchema, le.SourceName
    """, 'Watermarks')

    # ─────────────────────────────────────────────────────────────────────────
    # 14. Incremental load config summary per source
    # ─────────────────────────────────────────────────────────────────────────
    data['incr_summary_cols'], data['incr_summary_rows'] = qry(cursor, """
        SELECT
            ds.Namespace,
            COUNT(*)                                                          AS TotalActive,
            SUM(CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END)            AS Incremental,
            SUM(CASE WHEN le.IsIncremental = 0 THEN 1 ELSE 0 END)            AS FullLoad,
            CAST(
                ROUND(
                    100.0 * SUM(CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END)
                    / NULLIF(COUNT(*), 0),
                    1
                ) AS DECIMAL(5,1)
            )                                                                 AS IncrPct,
            COUNT(CASE WHEN le.IsIncremental = 1
                        AND llv.LandingzoneEntityId IS NOT NULL THEN 1 END)  AS WithWatermark,
            COUNT(CASE WHEN le.IsIncremental = 1
                        AND llv.LandingzoneEntityId IS NULL THEN 1 END)      AS MissingWatermark
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        LEFT JOIN execution.LandingzoneEntityLastLoadValue llv
               ON llv.LandingzoneEntityId = le.LandingzoneEntityId
        WHERE le.IsActive = 1
        AND ds.Namespace NOT IN ('NB', 'ONELAKE', 'NOTEBOOK')
        GROUP BY ds.Namespace
        ORDER BY ds.Namespace
    """, 'Incremental Summary')

    # ─────────────────────────────────────────────────────────────────────────
    # 15. Recent pipeline run summary (last 30 runs)
    # ─────────────────────────────────────────────────────────────────────────
    data['runs_cols'], data['runs_rows'] = qry(cursor, """
        SELECT TOP 30
            PipelineName,
            EntityLayer,
            MIN(LogDateTime)                  AS RunStart,
            MAX(LogDateTime)                  AS RunEnd,
            COUNT(*)                          AS LogEntries,
            MAX(CASE WHEN LogType LIKE 'End%' THEN
                CASE WHEN LogData LIKE '%Succeeded%' THEN 'Succeeded'
                     WHEN LogData LIKE '%Failed%'    THEN 'Failed'
                     ELSE 'EndUnknown' END
            END)                              AS FinalStatus
        FROM logging.PipelineExecution
        GROUP BY PipelineRunGuid, PipelineName, EntityLayer
        ORDER BY MIN(LogDateTime) DESC
    """, 'Recent Pipeline Runs')

    # ─────────────────────────────────────────────────────────────────────────
    # 16. Active LZ entities with zero LZ execution records broken down by source
    #     (distinguishes: never had an execution row vs pending row exists)
    # ─────────────────────────────────────────────────────────────────────────
    data['lz_status_cols'], data['lz_status_rows'] = qry(cursor, """
        SELECT
            ds.Namespace,
            le.SourceSchema + '.' + le.SourceName AS EntityName,
            le.LandingzoneEntityId,
            le.IsIncremental,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM execution.PipelineLandingzoneEntity ple2
                    WHERE ple2.LandingzoneEntityId = le.LandingzoneEntityId
                    AND ple2.IsProcessed = 1
                ) THEN 'LOADED'
                WHEN EXISTS (
                    SELECT 1 FROM execution.PipelineLandingzoneEntity ple2
                    WHERE ple2.LandingzoneEntityId = le.LandingzoneEntityId
                ) THEN 'PENDING'
                ELSE 'NEVER LOADED'
            END AS LoadStatus
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE le.IsActive = 1
        AND ds.Namespace NOT IN ('NB', 'ONELAKE', 'NOTEBOOK')
        ORDER BY ds.Namespace, LoadStatus, le.SourceSchema, le.SourceName
    """, 'LZ Load Status per Entity')

    return data


# ── Build summary structures from raw data ────────────────────────────────────

def build_source_map(data):
    """Index all query results by Namespace for summary building."""
    sm = {}

    for row in (data.get('lz_reg_rows') or []):
        ns = str(row[1])
        if ns in INTERNAL_NS:
            continue
        sm.setdefault(ns, {})
        sm[ns]['ds_id']       = row[0]
        sm[ns]['lz_total']    = int(row[2])
        sm[ns]['lz_active']   = int(row[3])
        sm[ns]['lz_inactive'] = int(row[4])
        sm[ns]['lz_incr']     = int(row[5])
        sm[ns]['lz_full']     = int(row[6])

    for row in (data.get('bronze_reg_rows') or []):
        ns = str(row[1])
        if ns in INTERNAL_NS:
            continue
        sm.setdefault(ns, {})
        sm[ns]['bronze_total']    = int(row[2])
        sm[ns]['bronze_active']   = int(row[3])
        sm[ns]['bronze_inactive'] = int(row[4])

    for row in (data.get('silver_reg_rows') or []):
        ns = str(row[1])
        if ns in INTERNAL_NS:
            continue
        sm.setdefault(ns, {})
        sm[ns]['silver_total']    = int(row[2])
        sm[ns]['silver_active']   = int(row[3])
        sm[ns]['silver_inactive'] = int(row[4])

    for row in (data.get('lz_exec_rows') or []):
        ns = str(row[0])
        sm.setdefault(ns, {})
        sm[ns]['lz_exec_tracked']  = int(row[1])
        sm[ns]['lz_exec_done']     = int(row[2])
        sm[ns]['lz_exec_pending']  = int(row[3])
        sm[ns]['lz_last_load']     = str(row[4]) if row[4] else 'never'

    for row in (data.get('bronze_exec_rows') or []):
        ns = str(row[0])
        sm.setdefault(ns, {})
        sm[ns]['bronze_exec_tracked'] = int(row[1])
        sm[ns]['bronze_exec_done']    = int(row[2])
        sm[ns]['bronze_exec_pending'] = int(row[3])
        sm[ns]['bronze_last_load']    = str(row[4]) if row[4] else 'never'

    for row in (data.get('silver_exec_rows') or []):
        ns = str(row[0])
        sm.setdefault(ns, {})
        sm[ns]['silver_queue'] = int(row[1])

    for row in (data.get('lz_never_loaded_rows') or []):
        ns = str(row[0])
        sm.setdefault(ns, {})
        sm[ns]['lz_never_loaded'] = int(row[1])

    for row in (data.get('incr_summary_rows') or []):
        ns = str(row[0])
        sm.setdefault(ns, {})
        sm[ns]['incr_active']          = int(row[1])
        sm[ns]['incr_count']           = int(row[2])
        sm[ns]['full_count']           = int(row[3])
        sm[ns]['incr_pct']             = float(row[4]) if row[4] else 0.0
        sm[ns]['incr_with_watermark']  = int(row[5])
        sm[ns]['incr_missing_wm']      = int(row[6])

    return sm


def _g(d, key, default=0):
    """Safe get from dict with numeric default."""
    return d.get(key, default)


# ── Report builder ────────────────────────────────────────────────────────────

def build_report(data, generated_at):
    lines = []

    def ln(s=''):
        lines.append(s)

    def h1(title):
        ln()
        ln(sep('='))
        ln(f'  {title}')
        ln(sep('='))

    def h2(title):
        ln()
        ln(f'  {title}')
        ln('  ' + sep('-', 76))

    def table(cols, rows, indent=4):
        for tl in fmt_table(cols, rows, indent=indent):
            ln(tl)

    # ── Header ────────────────────────────────────────────────────────────────
    ln(sep())
    ln('  FMD FRAMEWORK -- COMPREHENSIVE GAP REPORT')
    ln(f'  Generated : {generated_at}')
    ln(f'  Server    : {SERVER.split(".")[0]}...')
    ln(f'  Database  : {DATABASE}')
    ln(sep())

    sm = build_source_map(data)
    real_sources = {k: v for k, v in sm.items() if k not in INTERNAL_NS}
    ordered_ns   = sorted(real_sources.keys())

    # =========================================================================
    # SECTION 1 -- SOURCE SUMMARY
    # =========================================================================
    h1('SECTION 1 -- SOURCE SUMMARY')
    ln()
    ln('  Data Sources registered in the framework:')
    ln()
    table(data['sources_cols'], data['sources_rows'])

    # =========================================================================
    # SECTION 2 -- CROSS-LAYER REGISTRATION MATRIX
    # =========================================================================
    h1('SECTION 2 -- CROSS-LAYER REGISTRATION MATRIX')
    ln()
    ln('  Columns: LZ Total | LZ Active | LZ Inactive | Bronze | Silver | Incr | Gap-Br | Gap-Si')
    ln()

    col_h = (f"  {'Source':<14} | {'LZ Tot':>7} | {'LZ Act':>7} | {'LZ Inact':>8} |"
             f" {'Bronze':>7} | {'Silver':>7} | {'Incr':>5} | {'Brz Gap':>8} | {'Sil Gap':>8} | Status")
    ln(col_h)
    ln('  ' + sep('-', len(col_h) - 2))

    tot_lz_t = tot_lz_a = tot_br = tot_si = tot_incr = 0

    for ns in ordered_ns:
        s     = real_sources[ns]
        lz_t  = _g(s, 'lz_total')
        lz_a  = _g(s, 'lz_active')
        lz_i  = _g(s, 'lz_inactive')
        br    = _g(s, 'bronze_total')
        si    = _g(s, 'silver_total')
        incr  = _g(s, 'lz_incr')
        br_g  = lz_a - br
        si_g  = br - si
        disp  = SOURCE_DISPLAY.get(ns, ns)

        tot_lz_t += lz_t
        tot_lz_a += lz_a
        tot_br   += br
        tot_si   += si
        tot_incr += incr

        if lz_a == 0:
            status = 'NO ENTITIES'
        elif br == 0:
            status = 'LZ ONLY -- BRONZE GAP'
        elif si == 0:
            status = 'NO SILVER'
        elif lz_a == br == si:
            status = 'FULLY REGISTERED'
        elif br_g > 0 or si_g > 0:
            status = f'PARTIAL GAPS (br+{br_g}, si+{si_g})'
        else:
            status = 'REGISTERED'

        ln(f"  {disp:<14} | {lz_t:>7} | {lz_a:>7} | {lz_i:>8} |"
           f" {br:>7} | {si:>7} | {incr:>5} | {br_g:>8} | {si_g:>8} | {status}")

    ln('  ' + sep('-', len(col_h) - 2))
    tot_br_g = tot_lz_a - tot_br
    tot_si_g = tot_br   - tot_si
    ln(f"  {'TOTAL':<14} | {tot_lz_t:>7} | {tot_lz_a:>7} | {tot_lz_t-tot_lz_a:>8} |"
       f" {tot_br:>7} | {tot_si:>7} | {tot_incr:>5} | {tot_br_g:>8} | {tot_si_g:>8} |")

    ln()
    ln(f"  Bronze coverage : {pct(tot_br, tot_lz_a)} ({tot_br}/{tot_lz_a})")
    ln(f"  Silver coverage : {pct(tot_si, tot_br)}  ({tot_si}/{tot_br})")
    ln(f"  Incremental pct : {pct(tot_incr, tot_lz_a)} of active LZ entities")

    # =========================================================================
    # SECTION 3 -- LZ LAYER STATUS
    # =========================================================================
    h1('SECTION 3 -- LANDING ZONE LAYER STATUS')

    h2('3a. LZ Execution Tracking (PipelineLandingzoneEntity)')
    col_h3 = (f"  {'Source':<14} | {'Tracked':>8} | {'Processed':>10} | {'Pending':>8} |"
              f" {'Never Loaded':>13} | Last Load End")
    ln(col_h3)
    ln('  ' + sep('-', 78))

    for ns in ordered_ns:
        s     = real_sources[ns]
        disp  = SOURCE_DISPLAY.get(ns, ns)
        tr    = _g(s, 'lz_exec_tracked')
        done  = _g(s, 'lz_exec_done')
        pend  = _g(s, 'lz_exec_pending')
        never = _g(s, 'lz_never_loaded')
        last  = s.get('lz_last_load', 'never')
        ln(f"  {disp:<14} | {tr:>8} | {done:>10} | {pend:>8} | {never:>13} | {last}")

    h2('3b. Active LZ Entities -- Load Status Breakdown (per entity)')
    if data.get('lz_status_rows'):
        # Summarize counts per (Namespace, LoadStatus) from the big query
        summary = {}
        for row in data['lz_status_rows']:
            ns_r   = str(row[0])
            status = str(row[4])
            if ns_r in INTERNAL_NS:
                continue
            summary.setdefault(ns_r, {})
            summary[ns_r][status] = summary[ns_r].get(status, 0) + 1

        statuses = ['LOADED', 'PENDING', 'NEVER LOADED']
        h_line   = f"  {'Source':<14} | {'LOADED':>8} | {'PENDING':>8} | {'NEVER LOADED':>13}"
        ln(h_line)
        ln('  ' + sep('-', 50))
        for ns in ordered_ns:
            disp = SOURCE_DISPLAY.get(ns, ns)
            sc   = summary.get(ns, {})
            loaded  = sc.get('LOADED',       0)
            pending = sc.get('PENDING',       0)
            never   = sc.get('NEVER LOADED',  0)
            ln(f"  {disp:<14} | {loaded:>8} | {pending:>8} | {never:>13}")
    else:
        ln('  (no entity-level load status data available)')

    h2('3c. Entities NOT yet loaded to LZ (registered but zero LZ runs)')
    if data.get('lz_never_loaded_rows'):
        table(data['lz_never_loaded_cols'], data['lz_never_loaded_rows'])
    else:
        ln('  All active LZ entities have at least one pipeline execution record.')

    # =========================================================================
    # SECTION 4 -- BRONZE LAYER STATUS
    # =========================================================================
    h1('SECTION 4 -- BRONZE LAYER STATUS')

    h2('4a. Bronze Execution Tracking (PipelineBronzeLayerEntity)')
    col_h4 = (f"  {'Source':<14} | {'Tracked':>8} | {'Processed':>10} | {'Pending':>8} | Last Load End")
    ln(col_h4)
    ln('  ' + sep('-', 72))
    for ns in ordered_ns:
        s    = real_sources[ns]
        disp = SOURCE_DISPLAY.get(ns, ns)
        tr   = _g(s, 'bronze_exec_tracked')
        done = _g(s, 'bronze_exec_done')
        pend = _g(s, 'bronze_exec_pending')
        last = s.get('bronze_last_load', 'never')
        ln(f"  {disp:<14} | {tr:>8} | {done:>10} | {pend:>8} | {last}")

    h2('4b. Entities Missing Bronze Registration')
    no_bronze = [
        r for r in (data.get('lz_no_bronze_rows') or [])
        if str(r[0]) not in INTERNAL_NS
    ]
    if no_bronze:
        ln(f'  Total LZ entities without a Bronze record: {len(no_bronze)}')
        ln()
        # Summarize by namespace
        ns_counts = {}
        for r in no_bronze:
            ns_counts[str(r[0])] = ns_counts.get(str(r[0]), 0) + 1
        for ns, cnt in sorted(ns_counts.items()):
            disp = SOURCE_DISPLAY.get(ns, ns)
            ln(f"  - {disp}: {cnt} entities")
        ln()
        ln('  Sample (up to 20):')
        table(data['lz_no_bronze_cols'], no_bronze[:20], indent=4)
    else:
        ln('  No gaps -- all active LZ entities have Bronze registrations.')

    # =========================================================================
    # SECTION 5 -- SILVER LAYER STATUS
    # =========================================================================
    h1('SECTION 5 -- SILVER LAYER STATUS')

    h2('5a. Silver Execution Queue (vw_LoadToSilverLayer)')
    if data.get('silver_exec_rows'):
        table(data['silver_exec_cols'], data['silver_exec_rows'])
        ln()
        total_silver_queue = sum(int(r[1]) for r in data['silver_exec_rows'])
        ln(f'  Total entities queued for Silver processing: {total_silver_queue}')
    else:
        ln('  Silver execution queue is empty (0 entities awaiting Silver load).')

    h2('5b. Entities Missing Silver Registration')
    no_silver = [
        r for r in (data.get('bronze_no_silver_rows') or [])
        if str(r[0]) not in INTERNAL_NS
    ]
    if no_silver:
        ln(f'  Total Bronze entities without a Silver record: {len(no_silver)}')
        ln()
        ns_counts = {}
        for r in no_silver:
            ns_counts[str(r[0])] = ns_counts.get(str(r[0]), 0) + 1
        for ns, cnt in sorted(ns_counts.items()):
            disp = SOURCE_DISPLAY.get(ns, ns)
            ln(f"  - {disp}: {cnt} entities")
        ln()
        ln('  Sample (up to 20):')
        table(data['bronze_no_silver_cols'], no_silver[:20], indent=4)
    else:
        ln('  No gaps -- all Bronze entities have Silver registrations.')

    # =========================================================================
    # SECTION 6 -- FAILED ENTITIES & ERRORS
    # =========================================================================
    h1('SECTION 6 -- FAILED ENTITIES AND ERRORS')

    h2('6a. Recent CopyActivityExecution Entries (last 50)')
    if data.get('failed_copy_rows'):
        table(data['failed_copy_cols'], data['failed_copy_rows'])
    else:
        ln('  No CopyActivityExecution records found (table may be empty or does not exist).')

    h2('6b. Pipeline Execution Error Log (last 30 error-flagged entries)')
    if data.get('pipeline_errors_rows'):
        table(data['pipeline_errors_cols'], data['pipeline_errors_rows'])
    else:
        ln('  No error-flagged pipeline execution entries found in the last 30 rows.')

    h2('6c. Recent Pipeline Run Summary (last 30 runs)')
    if data.get('runs_rows'):
        table(data['runs_cols'], data['runs_rows'])
    else:
        ln('  No recent pipeline run records found.')

    # =========================================================================
    # SECTION 7 -- INCREMENTAL LOAD STATUS
    # =========================================================================
    h1('SECTION 7 -- INCREMENTAL LOAD STATUS')

    h2('7a. Incremental Configuration Summary per Source')
    if data.get('incr_summary_rows'):
        table(data['incr_summary_cols'], data['incr_summary_rows'])
    ln()

    # Detailed table per source
    col_h7 = (f"  {'Source':<14} | {'Total Act':>9} | {'Incremental':>12} | {'Full Load':>10} |"
              f" {'Incr %':>7} | {'With WM':>8} | {'No WM':>6}")
    ln(col_h7)
    ln('  ' + sep('-', 72))
    for ns in ordered_ns:
        s    = real_sources[ns]
        disp = SOURCE_DISPLAY.get(ns, ns)
        ta   = _g(s, 'incr_active')
        ic   = _g(s, 'incr_count')
        fc   = _g(s, 'full_count')
        ip   = s.get('incr_pct', 0.0)
        wm   = _g(s, 'incr_with_watermark')
        nwm  = _g(s, 'incr_missing_wm')
        ln(f"  {disp:<14} | {ta:>9} | {ic:>12} | {fc:>10} | {ip:>6.1f}% | {wm:>8} | {nwm:>6}")

    h2('7b. Incremental Watermark Values (LandingzoneEntityLastLoadValue)')
    if data.get('watermarks_rows'):
        ln(f'  Total entities with watermark records: {len(data["watermarks_rows"])}')
        ln()
        ln('  Sample (up to 30):')
        table(data['watermarks_cols'], data['watermarks_rows'][:30], indent=4)
    else:
        ln('  No watermark records found (LandingzoneEntityLastLoadValue is empty).')

    # =========================================================================
    # SECTION 8 -- GAP ANALYSIS SUMMARY
    # =========================================================================
    h1('SECTION 8 -- GAP ANALYSIS SUMMARY')
    ln()

    gaps = []

    for ns in ordered_ns:
        s    = real_sources[ns]
        disp = SOURCE_DISPLAY.get(ns, ns)
        lz_a = _g(s, 'lz_active')
        br   = _g(s, 'bronze_total')
        si   = _g(s, 'silver_total')
        lz_t = _g(s, 'lz_total')
        never = _g(s, 'lz_never_loaded')
        bronze_exec = _g(s, 'bronze_exec_tracked')
        silver_queue = _g(s, 'silver_queue')
        incr = _g(s, 'incr_count')
        nwm  = _g(s, 'incr_missing_wm')

        if lz_t == 0:
            gaps.append(f'[CRITICAL] {disp}: No LZ entities registered at all')
        if lz_a > 0 and br == 0:
            gaps.append(f'[CRITICAL] {disp}: {lz_a} active LZ entities but 0 Bronze registrations')
        if br > 0 and si == 0:
            gaps.append(f'[CRITICAL] {disp}: {br} Bronze entities but 0 Silver registrations')
        if lz_a > 0 and lz_a != br:
            diff = lz_a - br
            if diff > 0:
                gaps.append(f'[WARNING ] {disp}: Bronze registration gap -- {diff} LZ entities lack Bronze ({br}/{lz_a})')
        if br > 0 and br != si:
            diff = br - si
            if diff > 0:
                gaps.append(f'[WARNING ] {disp}: Silver registration gap -- {diff} Bronze entities lack Silver ({si}/{br})')
        if never > 0:
            gaps.append(f'[INFO    ] {disp}: {never} active entities have never been loaded to LZ')
        if incr > 0 and nwm > 0:
            gaps.append(f'[INFO    ] {disp}: {nwm} incremental entities are missing a watermark value')
        if silver_queue and silver_queue > 0:
            gaps.append(f'[INFO    ] {disp}: {silver_queue} entities currently queued for Silver processing')

    if gaps:
        for g in gaps:
            ln(f'  {g}')
    else:
        ln('  No gaps detected -- all layers are aligned across all sources.')

    ln()

    # =========================================================================
    # SECTION 9 -- OVERALL HEALTH ASSESSMENT
    # =========================================================================
    h1('SECTION 9 -- OVERALL HEALTH ASSESSMENT')
    ln()

    criticals = [g for g in gaps if '[CRITICAL]' in g]
    warnings  = [g for g in gaps if '[WARNING ]' in g]
    infos     = [g for g in gaps if '[INFO    ]' in g]

    ln(f'  Total entities (LZ):    {tot_lz_t}')
    ln(f'  Active entities (LZ):   {tot_lz_a}')
    ln(f'  Bronze registrations:   {tot_br}  ({pct(tot_br, tot_lz_a)} of active LZ)')
    ln(f'  Silver registrations:   {tot_si}  ({pct(tot_si, tot_br)} of Bronze)')
    ln(f'  Incremental configured: {tot_incr} ({pct(tot_incr, tot_lz_a)} of active LZ)')
    ln()
    ln(f'  Critical gaps:  {len(criticals)}')
    ln(f'  Warnings:       {len(warnings)}')
    ln(f'  Info items:     {len(infos)}')
    ln()

    if len(criticals) == 0 and len(warnings) == 0:
        ln('  STATUS: HEALTHY')
    elif len(criticals) == 0:
        ln('  STATUS: MOSTLY HEALTHY (warnings only)')
    else:
        ln('  STATUS: ACTION REQUIRED (critical gaps present)')

    ln()
    for ns in ordered_ns:
        s    = real_sources[ns]
        disp = SOURCE_DISPLAY.get(ns, ns)
        lz_a = _g(s, 'lz_active')
        br   = _g(s, 'bronze_total')
        si   = _g(s, 'silver_total')
        lz_exec_done   = _g(s, 'lz_exec_done')
        bronze_exec_done = _g(s, 'bronze_exec_done')
        last_lz = s.get('lz_last_load', 'never')

        # Compute overall status per source
        if lz_a == 0:
            overall = 'NOT STARTED'
        elif br == 0:
            overall = 'LZ ONLY'
        elif si == 0:
            overall = 'LZ+BRONZE ONLY'
        elif lz_a == br == si:
            overall = 'COMPLETE (all layers)'
        else:
            overall = 'PARTIAL'

        ln(f"  {disp:<14} : LZ={lz_a} | Bronze={br} | Silver={si} | "
           f"LZ Runs={lz_exec_done} | Br Runs={bronze_exec_done} | "
           f"Last LZ Load: {last_lz} | {overall}")

    ln()
    ln(sep())
    ln('  END OF REPORT')
    ln(sep())
    ln()

    return '\n'.join(lines)


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    generated_at = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')

    print(sep())
    print('  FMD Framework -- Comprehensive Gap Report')
    print(f'  {generated_at}')
    print(sep())
    print()

    # ── Auth ──────────────────────────────────────────────────────────────────
    print('[1/3] Acquiring Service Principal token (urllib)...')
    try:
        token = get_token()
        print('  Token OK.')
    except Exception as ex:
        print(f'  FATAL: Token acquisition failed: {ex}')
        sys.exit(1)

    # ── Connect ───────────────────────────────────────────────────────────────
    print('[2/3] Connecting to Fabric SQL Database...')
    try:
        import pyodbc
        token_bytes  = token.encode('UTF-16-LE')
        token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
        conn_str = (
            f'DRIVER={{{DRIVER}}};'
            f'SERVER={SERVER};'
            f'DATABASE={DATABASE};'
            f'Encrypt=yes;TrustServerCertificate=no;'
        )
        conn   = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
        cursor = conn.cursor()
        print('  Connected.')
    except Exception as ex:
        print(f'  FATAL: Connection failed: {ex}')
        sys.exit(1)

    # ── Collect data ──────────────────────────────────────────────────────────
    print('[3/3] Running gap report queries...')
    try:
        data = collect_all(cursor)
        print('  Queries complete.')
    except Exception as ex:
        print(f'  FATAL: Query execution failed: {ex}')
        conn.close()
        sys.exit(1)

    conn.close()

    # ── Build & output report ─────────────────────────────────────────────────
    report = build_report(data, generated_at)

    # Write to file
    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        f.write(report)
    print()
    print(f'Report saved to: {REPORT_PATH}')
    print()

    # Print to stdout (handle Windows cp1252 console encoding gracefully)
    try:
        print(report)
    except UnicodeEncodeError:
        print(report.encode('ascii', errors='replace').decode('ascii'))


if __name__ == '__main__':
    main()
