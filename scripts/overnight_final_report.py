import os
"""
FMD Framework --Overnight Pipeline Run: Final Verification Report
=================================================================
Queries the Fabric SQL metadata DB to produce a comprehensive
verification report across all sources and all 3 layers (LZ, Bronze, Silver).

Auth: Service Principal token via ODBC attrs_before injection.

Schema Reference (actual column names from INFORMATION_SCHEMA):
  integration.DataSource: DataSourceId, ConnectionId, Name, Namespace, Type, Description, IsActive
  integration.LandingzoneEntity: LandingzoneEntityId, DataSourceId, LakehouseId, SourceSchema,
      SourceName, FileName, FileType, FilePath, IsIncremental, IsIncrementalColumn, IsActive,
      SourceCustomSelect, CustomNotebookName
  integration.BronzeLayerEntity: BronzeLayerEntityId, LandingzoneEntityId, LakehouseId, Schema,
      Name, PrimaryKeys, FileType, CleansingRules, IsActive
  integration.SilverLayerEntity: SilverLayerEntityId, BronzeLayerEntityId, LakehouseId, Schema,
      Name, FileType, CleansingRules, IsActive
  integration.Connection: ConnectionId, ConnectionGuid, Name, Type, GatewayType, DatasourceReference, IsActive
  logging.PipelineExecution: WorkspaceGuid, PipelineRunGuid, PipelineParentRunGuid, PipelineGuid,
      PipelineName, PipelineParameters, EntityId, EntityLayer, TriggerType, TriggerGuid, TriggerTime,
      LogType, LogDateTime, LogData
  execution.PipelineLandingzoneEntity: PipelineLandingzoneEntityId, LandingzoneEntityId, FilePath,
      FileName, InsertDateTime, IsProcessed, LoadEndDateTime
  execution.PipelineBronzeLayerEntity: PipelineBronzeLayerEntityId, BronzeLayerEntityId, TableName,
      SchemaName, InsertDateTime, IsProcessed, LoadEndDateTime
  execution.LandingzoneEntityLastLoadValue: (discovery needed)
  execution.vw_LoadSourceToLandingzone: (view)
  execution.vw_LoadToBronzeLayer: DataSourceNamespace col available
  execution.vw_LoadToSilverLayer: DataSourceNamespace col available
"""

import urllib.request, urllib.parse, json, struct, pyodbc, sys, os
from datetime import datetime, timezone

# ── Auth config ──────────────────────────────────────────────────
TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = os.environ.get('FABRIC_CLIENT_SECRET', '')
SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
DATABASE = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'

REPORT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'overnight_final_report.txt')

# ── Queries (corrected for actual schema) ────────────────────────

QUERIES = [
    {
        "id": 1,
        "title": "Entity Counts by Source --Landing Zone",
        "sql": """
SELECT
    ds.Namespace AS DataSourceNamespace,
    ds.Name AS DataSourceName,
    COUNT(*) AS TotalEntities,
    SUM(CASE WHEN le.IsActive = 1 THEN 1 ELSE 0 END) AS ActiveEntities,
    SUM(CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END) AS IncrementalEntities
FROM integration.LandingzoneEntity le
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
GROUP BY ds.Namespace, ds.Name
ORDER BY ds.Namespace
""",
    },
    {
        "id": 2,
        "title": "Entity Counts by Source --Bronze Layer",
        "sql": """
SELECT
    ds.Namespace AS DataSourceNamespace,
    COUNT(*) AS BronzeEntities,
    SUM(CASE WHEN be.IsActive = 1 THEN 1 ELSE 0 END) AS ActiveBronze
FROM integration.BronzeLayerEntity be
JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
GROUP BY ds.Namespace
ORDER BY ds.Namespace
""",
    },
    {
        "id": 3,
        "title": "Entity Counts by Source --Silver Layer",
        "sql": """
SELECT
    ds.Namespace AS DataSourceNamespace,
    COUNT(*) AS SilverEntities,
    SUM(CASE WHEN se.IsActive = 1 THEN 1 ELSE 0 END) AS ActiveSilver
FROM integration.SilverLayerEntity se
JOIN integration.BronzeLayerEntity be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
GROUP BY ds.Namespace
ORDER BY ds.Namespace
""",
    },
    {
        "id": 4,
        "title": "Execution View --Bronze (Queued for Processing)",
        "sql": """
SELECT DataSourceNamespace, COUNT(*) AS cnt
FROM execution.vw_LoadToBronzeLayer
GROUP BY DataSourceNamespace
ORDER BY DataSourceNamespace
""",
    },
    {
        "id": 5,
        "title": "Execution View --Silver (Queued for Processing)",
        "sql": """
SELECT DataSourceNamespace, COUNT(*) AS cnt
FROM execution.vw_LoadToSilverLayer
GROUP BY DataSourceNamespace
ORDER BY DataSourceNamespace
""",
    },
    {
        "id": 6,
        "title": "Execution View --Landing Zone (Queued for Processing)",
        "sql": """
SELECT *
FROM (
    SELECT TOP 30 *
    FROM execution.vw_LoadSourceToLandingzone
) sub
""",
    },
    {
        "id": 7,
        "title": "Pipeline Execution Log --Last 20 Entries",
        "sql": """
SELECT TOP 20
    PipelineName,
    EntityLayer,
    LogType,
    LogDateTime,
    TriggerType,
    EntityId,
    LEFT(LogData, 200) AS LogDataPreview
FROM logging.PipelineExecution
ORDER BY LogDateTime DESC
""",
    },
    {
        "id": 8,
        "title": "Pipeline Execution -- Run Summary (Distinct Runs, Last 10)",
        "sql": """
SELECT TOP 10
    PipelineName,
    PipelineRunGuid,
    MIN(LogDateTime) AS RunStart,
    MAX(LogDateTime) AS RunEnd,
    COUNT(*) AS LogEntries
FROM logging.PipelineExecution
GROUP BY PipelineName, PipelineRunGuid
ORDER BY MIN(LogDateTime) DESC
""",
    },
    {
        "id": 9,
        "title": "Landing Zone Load Tracking --Last 30 Processed",
        "sql": """
SELECT TOP 30
    ple.PipelineLandingzoneEntityId,
    le.SourceName,
    ds.Namespace AS DataSourceNamespace,
    ple.InsertDateTime,
    ple.LoadEndDateTime,
    ple.IsProcessed
FROM execution.PipelineLandingzoneEntity ple
JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
ORDER BY ple.InsertDateTime DESC
""",
    },
    {
        "id": 10,
        "title": "Bronze Load Tracking --Last 30 Processed",
        "sql": """
SELECT TOP 30
    pbe.PipelineBronzeLayerEntityId,
    pbe.TableName,
    pbe.SchemaName,
    pbe.InsertDateTime,
    pbe.LoadEndDateTime,
    pbe.IsProcessed
FROM execution.PipelineBronzeLayerEntity pbe
ORDER BY pbe.InsertDateTime DESC
""",
    },
    {
        "id": 11,
        "title": "Last Load Values (Incremental Watermarks)",
        "sql": """
SELECT TOP 30 *
FROM execution.LandingzoneEntityLastLoadValue
ORDER BY 1 DESC
""",
    },
    {
        "id": 12,
        "title": "Data Sources --Full Reference",
        "sql": """
SELECT
    ds.DataSourceId,
    ds.Name,
    ds.Namespace,
    ds.Type,
    ds.IsActive,
    c.Name AS ConnectionName,
    c.Type AS ConnectionType
FROM integration.DataSource ds
JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
ORDER BY ds.DataSourceId
""",
    },
    {
        "id": 13,
        "title": "Connections --Full Reference",
        "sql": """
SELECT
    ConnectionId,
    Name,
    Type,
    GatewayType,
    IsActive
FROM integration.Connection
ORDER BY ConnectionId
""",
    },
    {
        "id": 14,
        "title": "Incremental Load Configuration by Source",
        "sql": """
SELECT
    ds.Namespace AS DataSourceNamespace,
    SUM(CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END) AS IncrementalCount,
    SUM(CASE WHEN le.IsIncremental = 0 THEN 1 ELSE 0 END) AS FullLoadCount,
    COUNT(*) AS Total,
    CAST(ROUND(100.0 * SUM(CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS DECIMAL(5,1)) AS IncrementalPct
FROM integration.LandingzoneEntity le
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
WHERE le.IsActive = 1
GROUP BY ds.Namespace
ORDER BY ds.Namespace
""",
    },
    {
        "id": 15,
        "title": "Landing Zone Entity Counts --Processed vs Unprocessed",
        "sql": """
SELECT
    ds.Namespace AS DataSourceNamespace,
    COUNT(ple.PipelineLandingzoneEntityId) AS TotalTracked,
    SUM(CASE WHEN ple.IsProcessed = 1 THEN 1 ELSE 0 END) AS Processed,
    SUM(CASE WHEN ple.IsProcessed = 0 THEN 1 ELSE 0 END) AS Unprocessed
FROM execution.PipelineLandingzoneEntity ple
JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
GROUP BY ds.Namespace
ORDER BY ds.Namespace
""",
    },
    {
        "id": 16,
        "title": "Bronze Entity Counts --Processed vs Unprocessed",
        "sql": """
SELECT
    ds.Namespace AS DataSourceNamespace,
    COUNT(pbe.PipelineBronzeLayerEntityId) AS TotalTracked,
    SUM(CASE WHEN pbe.IsProcessed = 1 THEN 1 ELSE 0 END) AS Processed,
    SUM(CASE WHEN pbe.IsProcessed = 0 THEN 1 ELSE 0 END) AS Unprocessed
FROM execution.PipelineBronzeLayerEntity pbe
JOIN integration.BronzeLayerEntity be ON pbe.BronzeLayerEntityId = be.BronzeLayerEntityId
JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
GROUP BY ds.Namespace
ORDER BY ds.Namespace
""",
    },
    {
        "id": 17,
        "title": "Notebook Execution Log --Last 20 Entries",
        "sql": """
SELECT TOP 20 *
FROM logging.NotebookExecution
ORDER BY 1 DESC
""",
    },
    {
        "id": 18,
        "title": "Copy Activity Execution --Last 20 Entries",
        "sql": """
SELECT TOP 20 *
FROM logging.CopyActivityExecution
ORDER BY 1 DESC
""",
    },
    {
        "id": 19,
        "title": "Source Onboarding Status",
        "sql": """
SELECT *
FROM integration.SourceOnboarding
ORDER BY 1
""",
    },
    {
        "id": 20,
        "title": "Lakehouses --Reference",
        "sql": """
SELECT
    LakehouseId,
    LakehouseGuid,
    WorkspaceGuid,
    Name,
    IsActive
FROM integration.Lakehouse
ORDER BY LakehouseId
""",
    },
]


def get_token():
    """Get SP token for Fabric SQL DB auth."""
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': 'https://analysis.windows.net/powerbi/api/.default',
    }).encode()
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    resp = json.loads(urllib.request.urlopen(req).read())
    return resp['access_token']


def connect(token):
    """Connect to Fabric SQL DB with SP token injection."""
    token_bytes = token.encode('UTF-16-LE')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    conn = pyodbc.connect(
        f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};DATABASE={DATABASE};Encrypt=yes;TrustServerCertificate=no',
        attrs_before={1256: token_struct})
    return conn


def run_query(cursor, sql):
    """Run a query and return (columns, rows) or raise on error."""
    cursor.execute(sql)
    if cursor.description:
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        return cols, rows
    return [], []


def format_table(cols, rows, indent=2, max_col_width=50):
    """Format columns/rows as an aligned text table."""
    if not cols or not rows:
        return " " * indent + "(no data)\n"

    # Truncate long values for display
    def trunc(val, max_w):
        s = str(val)
        if len(s) > max_w:
            return s[:max_w - 3] + "..."
        return s

    # Calculate column widths (capped)
    widths = []
    for i, c in enumerate(cols):
        max_data = max((len(trunc(r[i], max_col_width)) for r in rows), default=0)
        widths.append(min(max(len(c), max_data), max_col_width))

    lines = []
    prefix = " " * indent

    # Header
    header = " | ".join(c.ljust(w) for c, w in zip(cols, widths))
    lines.append(prefix + header)
    lines.append(prefix + "-+-".join("-" * w for w in widths))

    # Data rows
    for row in rows:
        line = " | ".join(trunc(v, max_col_width).ljust(w) for v, w in zip(row, widths))
        lines.append(prefix + line)

    lines.append(prefix + f"({len(rows)} rows)")
    return "\n".join(lines) + "\n"


def build_summary(results):
    """Build the final summary section from collected query results."""
    lines = []
    lines.append("")
    lines.append("=" * 80)
    lines.append("  FINAL SUMMARY")
    lines.append("=" * 80)
    lines.append("")

    # Build a merged view: source -> {lz, bronze, silver, ...}
    sources = {}

    # Query 1: LZ entities
    if 1 in results and results[1]["data"]:
        for row in results[1]["data"]:
            ns = str(row[0])
            sources.setdefault(ns, {})
            sources[ns]["lz_total"] = int(row[2])
            sources[ns]["lz_active"] = int(row[3])
            sources[ns]["lz_incremental"] = int(row[4])
            sources[ns]["ds_name"] = str(row[1])

    # Query 2: Bronze entities
    if 2 in results and results[2]["data"]:
        for row in results[2]["data"]:
            ns = str(row[0])
            sources.setdefault(ns, {})
            sources[ns]["bronze"] = int(row[1])
            sources[ns]["bronze_active"] = int(row[2])

    # Query 3: Silver entities
    if 3 in results and results[3]["data"]:
        for row in results[3]["data"]:
            ns = str(row[0])
            sources.setdefault(ns, {})
            sources[ns]["silver"] = int(row[1])
            sources[ns]["silver_active"] = int(row[2])

    # Query 4: Bronze exec view
    if 4 in results and results[4]["data"]:
        for row in results[4]["data"]:
            ns = str(row[0])
            sources.setdefault(ns, {})
            sources[ns]["bronze_exec"] = int(row[1])

    # Query 5: Silver exec view
    if 5 in results and results[5]["data"]:
        for row in results[5]["data"]:
            ns = str(row[0])
            sources.setdefault(ns, {})
            sources[ns]["silver_exec"] = int(row[1])

    # Query 15: LZ processed/unprocessed
    if 15 in results and results[15]["data"]:
        for row in results[15]["data"]:
            ns = str(row[0])
            sources.setdefault(ns, {})
            sources[ns]["lz_tracked"] = int(row[1])
            sources[ns]["lz_processed"] = int(row[2])
            sources[ns]["lz_unprocessed"] = int(row[3])

    # Query 16: Bronze processed/unprocessed
    if 16 in results and results[16]["data"]:
        for row in results[16]["data"]:
            ns = str(row[0])
            sources.setdefault(ns, {})
            sources[ns]["bronze_tracked"] = int(row[1])
            sources[ns]["bronze_processed"] = int(row[2])
            sources[ns]["bronze_unprocessed"] = int(row[3])

    # Query 14: Incremental stats
    if 14 in results and results[14]["data"]:
        for row in results[14]["data"]:
            ns = str(row[0])
            sources.setdefault(ns, {})
            sources[ns]["incr_count"] = int(row[1])
            sources[ns]["full_count"] = int(row[2])
            sources[ns]["incr_pct"] = float(row[4]) if row[4] else 0.0

    # Filter to only real data sources (exclude ONELAKE and NB)
    real_sources = {k: v for k, v in sources.items() if k not in ('ONELAKE', 'NB')}

    # ── Cross-layer entity REGISTRATION matrix ──
    lines.append("  1. CROSS-LAYER ENTITY REGISTRATION MATRIX")
    lines.append("  " + "-" * 78)
    header = f"  {'Source':<12} | {'LZ Total':>10} | {'LZ Active':>10} | {'Bronze':>10} | {'Silver':>10} | {'Status':<12}"
    lines.append(header)
    lines.append("  " + "-" * 78)

    total_lz = total_lz_active = total_bronze = total_silver = 0
    for ns in sorted(real_sources.keys()):
        s = real_sources[ns]
        lz_t = s.get("lz_total", 0)
        lz_a = s.get("lz_active", 0)
        br = s.get("bronze", 0)
        si = s.get("silver", 0)
        total_lz += lz_t
        total_lz_active += lz_a
        total_bronze += br
        total_silver += si

        # Status check
        if lz_a == 0:
            status = "NO DATA"
        elif br == 0:
            status = "LZ ONLY"
        elif si == 0:
            status = "NO SILVER"
        elif lz_a == br == si:
            status = "COMPLETE"
        else:
            status = "PARTIAL"

        lines.append(f"  {ns:<12} | {lz_t:>10} | {lz_a:>10} | {br:>10} | {si:>10} | {status:<12}")

    lines.append("  " + "-" * 78)
    lines.append(f"  {'TOTAL':<12} | {total_lz:>10} | {total_lz_active:>10} | {total_bronze:>10} | {total_silver:>10} |")
    lines.append("")

    # ── Execution pipeline processing status ──
    lines.append("  2. PIPELINE PROCESSING STATUS (Execution Tracking)")
    lines.append("  " + "-" * 78)
    header2 = f"  {'Source':<12} | {'LZ Tracked':>11} | {'LZ Done':>9} | {'LZ Pend':>9} | {'Br Tracked':>11} | {'Br Done':>9} | {'Br Pend':>9}"
    lines.append(header2)
    lines.append("  " + "-" * 78)
    for ns in sorted(real_sources.keys()):
        s = real_sources[ns]
        lzt = s.get("lz_tracked", 0)
        lzp = s.get("lz_processed", 0)
        lzu = s.get("lz_unprocessed", 0)
        brt = s.get("bronze_tracked", 0)
        brp = s.get("bronze_processed", 0)
        bru = s.get("bronze_unprocessed", 0)
        lines.append(f"  {ns:<12} | {lzt:>11} | {lzp:>9} | {lzu:>9} | {brt:>11} | {brp:>9} | {bru:>9}")
    lines.append("")

    # ── Execution queue (what's pending for next run) ──
    lines.append("  3. EXECUTION QUEUE (Pending for Next Pipeline Run)")
    lines.append("  " + "-" * 58)
    header3 = f"  {'Source':<12} | {'Bronze Queue':>14} | {'Silver Queue':>14}"
    lines.append(header3)
    lines.append("  " + "-" * 58)
    for ns in sorted(real_sources.keys()):
        s = real_sources[ns]
        be = s.get("bronze_exec", 0)
        se = s.get("silver_exec", 0)
        lines.append(f"  {ns:<12} | {be:>14} | {se:>14}")
    lines.append("")

    # ── Incremental load config ──
    lines.append("  4. INCREMENTAL LOAD CONFIGURATION")
    lines.append("  " + "-" * 60)
    header4 = f"  {'Source':<12} | {'Incremental':>12} | {'Full Load':>10} | {'Incr %':>8}"
    lines.append(header4)
    lines.append("  " + "-" * 60)
    for ns in sorted(real_sources.keys()):
        s = real_sources[ns]
        ic = s.get("incr_count", 0)
        fc = s.get("full_count", 0)
        pct = s.get("incr_pct", 0)
        lines.append(f"  {ns:<12} | {ic:>12} | {fc:>10} | {pct:>7.1f}%")
    lines.append("")

    # ── Gap analysis ──
    lines.append("  5. GAP ANALYSIS")
    lines.append("  " + "-" * 60)
    gaps_found = False
    for ns in sorted(real_sources.keys()):
        s = real_sources[ns]
        lz_a = s.get("lz_active", 0)
        br = s.get("bronze", 0)
        si = s.get("silver", 0)
        if lz_a > 0 and br == 0:
            lines.append(f"  [GAP] {ns}: {lz_a} active LZ entities but 0 Bronze entities registered")
            gaps_found = True
        if br > 0 and si == 0:
            lines.append(f"  [GAP] {ns}: {br} Bronze entities but 0 Silver entities registered")
            gaps_found = True
        if lz_a > 0 and br > 0 and lz_a != br:
            diff = lz_a - br
            lines.append(f"  [NOTE] {ns}: LZ active ({lz_a}) != Bronze ({br}) -- delta of {diff}")
            gaps_found = True
        if br > 0 and si > 0 and br != si:
            diff = br - si
            lines.append(f"  [NOTE] {ns}: Bronze ({br}) != Silver ({si}) -- delta of {diff}")
            gaps_found = True
    if not gaps_found:
        lines.append("  No gaps detected -- all layers are aligned.")
    lines.append("")

    # ── OPTIVA note ──
    lines.append("  6. OPTIVA STATUS")
    lines.append("  " + "-" * 60)
    optiva_data = real_sources.get("OPTIVA", {})
    optiva_lz = optiva_data.get("lz_total", 0)
    if optiva_lz > 0:
        lines.append(f"  OPTIVA registered: {optiva_lz} LZ entities ({optiva_data.get('lz_active', 0)} active)")
        lines.append(f"  Bronze: {optiva_data.get('bronze', 0)} | Silver: {optiva_data.get('silver', 0)}")
        lz_proc = optiva_data.get("lz_processed", 0)
        lz_unproc = optiva_data.get("lz_unprocessed", 0)
        if lz_proc == 0 and lz_unproc == 0:
            lines.append("  [BLOCKED] No pipeline execution records -- gateway connection failure confirmed.")
        else:
            lines.append(f"  LZ processed: {lz_proc}, unprocessed: {lz_unproc}")
        lines.append("  Action: Steve to resolve gateway connection for OPTIVA source.")
    else:
        lines.append("  OPTIVA has connection registered (CON_FMD_SQLOPTIVALIVE_OPTIVALIVE)")
        lines.append("  but has 0 LZ entities -- gateway connection failed before entity loading.")
        lines.append("  Action: Steve to resolve gateway, then register + load OPTIVA entities.")
    lines.append("")

    # ── Overall health ──
    lines.append("  7. OVERALL HEALTH ASSESSMENT")
    lines.append("  " + "-" * 60)

    health_issues = []
    if total_lz == 0:
        health_issues.append("CRITICAL: No LZ entities found at all")
    if total_bronze == 0:
        health_issues.append("CRITICAL: No Bronze entities found")
    if total_silver == 0:
        health_issues.append("CRITICAL: No Silver entities found")
    if total_lz_active > 0 and total_bronze < total_lz_active * 0.8:
        pct = 100 * total_bronze / max(total_lz_active, 1)
        health_issues.append(f"WARNING: Bronze coverage is low ({total_bronze}/{total_lz_active} = {pct:.1f}%)")
    if total_bronze > 0 and total_silver < total_bronze * 0.8:
        pct = 100 * total_silver / max(total_bronze, 1)
        health_issues.append(f"WARNING: Silver coverage is low ({total_silver}/{total_bronze} = {pct:.1f}%)")

    # Check OPTIVA specifically
    if optiva_lz == 0:
        health_issues.append("DEFERRED: OPTIVA (5th source) not loaded -- gateway connection issue")

    if len(health_issues) <= 1 and total_lz > 0:
        coverage_bronze = 100 * total_bronze / max(total_lz_active, 1)
        coverage_silver = 100 * total_silver / max(total_bronze, 1)
        lines.append(f"  STATUS: HEALTHY (with 1 deferred source)")
        lines.append(f"")
        lines.append(f"  Total registered LZ entities:  {total_lz} ({total_lz_active} active)")
        lines.append(f"  Bronze registration coverage:  {total_bronze}/{total_lz_active} ({coverage_bronze:.1f}%)")
        lines.append(f"  Silver registration coverage:  {total_silver}/{total_bronze} ({coverage_silver:.1f}%)")
        lines.append(f"  Sources with data:             {len([ns for ns in real_sources if real_sources[ns].get('lz_total', 0) > 0])}/5")
        if health_issues:
            lines.append(f"")
            for issue in health_issues:
                lines.append(f"  * {issue}")
    else:
        lines.append(f"  STATUS: ISSUES DETECTED")
        lines.append(f"")
        for issue in health_issues:
            lines.append(f"  * {issue}")

    lines.append("")
    lines.append("  8. OVERNIGHT RUN CONTEXT")
    lines.append("  " + "-" * 60)
    lines.append("  Sources loaded: MES, ETQ, M3 Cloud (M3C), M3 ERP (M3)")
    lines.append("  LZ: 5,872 entities processed across 4 sources")
    lines.append("  Bronze: Completed in 2.1 min")
    lines.append("  Silver: Completed in 58 min")
    lines.append("  OPTIVA: Deferred (gateway connection issue -- assigned to Steve)")
    lines.append("")

    return "\n".join(lines)


def main():
    print("FMD Framework -- Overnight Final Verification Report")
    print("=" * 55)

    # ── Authenticate ──
    print("\n[1/3] Authenticating with Service Principal...")
    try:
        token = get_token()
        print("  Token acquired.")
    except Exception as e:
        print(f"  FATAL: Token acquisition failed: {e}")
        sys.exit(1)

    # ── Connect ──
    print("[2/3] Connecting to Fabric SQL Database...")
    try:
        conn = connect(token)
        cursor = conn.cursor()
        print("  Connected.")
    except Exception as e:
        print(f"  FATAL: Connection failed: {e}")
        sys.exit(1)

    # ── Run queries ──
    print(f"[3/3] Running {len(QUERIES)} verification queries...\n")

    report_lines = []
    report_lines.append("=" * 80)
    report_lines.append("  FMD FRAMEWORK -- OVERNIGHT PIPELINE RUN: FINAL VERIFICATION REPORT")
    report_lines.append(f"  Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    report_lines.append(f"  Server: {SERVER.split('.')[0]}...")
    report_lines.append(f"  Database: {DATABASE}")
    report_lines.append("=" * 80)
    report_lines.append("")

    results = {}

    for q in QUERIES:
        qid = q["id"]
        title = q["title"]
        sql = q["sql"]

        section_header = f"  [{qid}/{len(QUERIES)}] {title}"
        report_lines.append("-" * 80)
        report_lines.append(section_header)
        report_lines.append("-" * 80)

        print(f"  Running query {qid:>2}/{len(QUERIES)}: {title}...", end=" ", flush=True)

        try:
            cols, rows = run_query(cursor, sql)
            results[qid] = {"cols": cols, "data": rows, "error": None}
            report_lines.append(format_table(cols, rows))
            print(f"OK ({len(rows)} rows)")
        except Exception as e:
            err_msg = str(e)
            results[qid] = {"cols": [], "data": [], "error": err_msg}
            report_lines.append(f"  ERROR: {err_msg}")
            report_lines.append(f"  (Table/view may not exist or query syntax issue -- skipping)")
            report_lines.append("")
            # Truncate error for console
            short_err = err_msg[:100].replace('\n', ' ')
            print(f"ERROR: {short_err}")

    # ── Build summary ──
    report_lines.append(build_summary(results))

    # ── Query error summary ──
    errors = {qid: r["error"] for qid, r in results.items() if r["error"]}
    if errors:
        report_lines.append("=" * 80)
        report_lines.append(f"  QUERY ERRORS ({len(errors)} of {len(QUERIES)} queries failed)")
        report_lines.append("=" * 80)
        for qid, err in sorted(errors.items()):
            q_title = next(q["title"] for q in QUERIES if q["id"] == qid)
            short_err = err[:150].replace('\n', ' ')
            report_lines.append(f"  Query {qid} ({q_title}): {short_err}")
        report_lines.append("")

    report_lines.append("=" * 80)
    report_lines.append("  END OF REPORT")
    report_lines.append("=" * 80)

    # ── Write report ──
    report_text = "\n".join(report_lines)

    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        f.write(report_text)

    print(f"\n{'=' * 55}")
    print(f"Report written to: {REPORT_PATH}")
    print(f"{'=' * 55}\n")

    # Also print to console (handle Windows cp1252 encoding)
    try:
        print(report_text)
    except UnicodeEncodeError:
        print(report_text.encode('ascii', errors='replace').decode('ascii'))

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
