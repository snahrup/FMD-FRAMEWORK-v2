"""Monitoring routes — live-monitor, load-progress, error-intelligence.

Covers:
    GET /api/live-monitor          — real-time pipeline activity (from SQLite cpdb)
    GET /api/copy-executions       — CopyActivityExecution log
    GET /api/notebook-executions   — NotebookExecution log
    GET /api/error-intelligence    — aggregated error analysis
    GET /api/load-progress         — entity load progress (alias of live-monitor counts)
    GET /api/stats                 — dashboard KPI stats
    GET /api/journey               — data journey for a single entity
"""
import logging
from datetime import datetime, timezone

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.monitoring")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_query(sql: str, params: tuple = (), default=None):
    """Execute a query returning a default on failure."""
    if default is None:
        default = []
    try:
        return db.query(sql, params)
    except Exception as e:
        log.warning("Query failed: %s — %s", sql[:60], e)
        return default


# ---------------------------------------------------------------------------
# Live Monitor
# ---------------------------------------------------------------------------

@route("GET", "/api/live-monitor")
def get_live_monitor(params: dict) -> dict:
    """Real-time pipeline monitoring from SQLite control plane DB.

    The original implementation queried the live Fabric SQL DB.
    The refactored version queries the local SQLite replica which is
    kept in sync by the background sync thread.
    """
    minutes_str = params.get("minutes", "240")
    try:
        minutes = int(minutes_str)
    except (TypeError, ValueError):
        minutes = 240

    result: dict = {}
    minutes_param = str(minutes)

    # Pipeline execution events (from pipeline_audit)
    result["pipelineEvents"] = _safe_query(
        "SELECT PipelineName, LogType, LogDateTime, LogData, PipelineRunGuid, EntityLayer "
        "FROM pipeline_audit "
        "WHERE LogDateTime >= datetime('now', '-' || ? || ' minutes') "
        "ORDER BY LogDateTime DESC LIMIT 50",
        (minutes_param,)
    )

    # Notebook execution events
    result["notebookEvents"] = _safe_query(
        "SELECT NotebookName, LogType, LogDateTime, LogData, EntityId, EntityLayer, PipelineRunGuid "
        "FROM notebook_executions "
        "WHERE LogDateTime >= datetime('now', '-' || ? || ' minutes') "
        "ORDER BY LogDateTime DESC LIMIT 200",
        (minutes_param,)
    )

    # Copy activity events
    result["copyEvents"] = _safe_query(
        "SELECT CopyActivityName, CopyActivityName AS EntityName, LogType, LogDateTime, "
        "LogData, EntityId, EntityLayer, PipelineRunGuid "
        "FROM copy_activity_audit "
        "WHERE LogDateTime >= datetime('now', '-' || ? || ' minutes') "
        "ORDER BY LogDateTime DESC LIMIT 100",
        (minutes_param,)
    )

    # Processing counts from entity tables
    try:
        lz_total = db.query("SELECT COUNT(*) AS cnt FROM lz_entities")
        brz_total = db.query("SELECT COUNT(*) AS cnt FROM bronze_entities")
        slv_total = db.query("SELECT COUNT(*) AS cnt FROM silver_entities")

        # Processed counts from engine_task_log (the ONLY trustworthy source)
        status_rows = _safe_query(
            "SELECT Layer, COUNT(DISTINCT EntityId) AS cnt FROM engine_task_log "
            "WHERE Status = 'succeeded' GROUP BY Layer"
        )
        status_map = {r["Layer"]: r["cnt"] for r in status_rows} if status_rows else {}

        result["counts"] = {
            "lzRegistered": lz_total[0]["cnt"] if lz_total else 0,
            "brzRegistered": brz_total[0]["cnt"] if brz_total else 0,
            "slvRegistered": slv_total[0]["cnt"] if slv_total else 0,
            "lzProcessed": status_map.get("landing", 0),
            "brzProcessed": status_map.get("bronze", 0),
            "slvProcessed": status_map.get("silver", 0),
        }
    except Exception as e:
        log.warning("Failed to load monitoring counts: %s", e)
        result["counts"] = {}

    # Recently processed Bronze entities
    result["bronzeEntities"] = _safe_query(
        "SELECT t.EntityId AS BronzeLayerEntityId, "
        "e.SourceSchema AS SchemaName, e.SourceName AS TableName, "
        "t.created_at AS InsertDateTime, "
        "CASE WHEN t.Status = 'succeeded' THEN 1 ELSE 0 END AS IsProcessed, "
        "t.created_at AS LoadEndDateTime "
        "FROM engine_task_log t "
        "JOIN lz_entities e ON e.LandingzoneEntityId = t.EntityId "
        "WHERE t.Layer = 'bronze' "
        "ORDER BY t.created_at DESC LIMIT 20"
    )

    # Recently processed LZ entities
    result["lzEntities"] = _safe_query(
        "SELECT t.EntityId AS LandingzoneEntityId, "
        "e.FilePath, e.FileName, "
        "t.created_at AS InsertDateTime, "
        "CASE WHEN t.Status = 'succeeded' THEN 1 ELSE 0 END AS IsProcessed, "
        "t.created_at AS LoadEndDateTime "
        "FROM engine_task_log t "
        "JOIN lz_entities e ON e.LandingzoneEntityId = t.EntityId "
        "WHERE t.Layer = 'landing' "
        "ORDER BY t.created_at DESC LIMIT 20"
    )

    result["serverTime"] = _utcnow_iso()
    return result


# ---------------------------------------------------------------------------
# Execution logs
# ---------------------------------------------------------------------------

@route("GET", "/api/copy-executions")
def get_copy_executions(params: dict) -> list:
    """Return copy activity execution records from copy_activity_audit.

    Extracts structured metrics from LogData JSON so the frontend gets
    proper Name, Status, StartTime, EndTime, duration, rows, and bytes
    as top-level columns.  Falls back to column-level values when the
    JSON payload is missing or malformed.
    """
    return _safe_query(
        "SELECT id, "
        "  CopyActivityName AS Name, "
        "  CASE "
        "    WHEN LOWER(LogType) = 'succeeded' THEN 'Succeeded' "
        "    WHEN LOWER(LogType) = 'failed' THEN 'Failed' "
        "    ELSE LogType "
        "  END AS Status, "
        "  EntityId, "
        "  EntityLayer, "
        "  PipelineRunGuid, "
        "  LogDateTime AS StartTime, "
        "  CASE "
        "    WHEN json_valid(LogData) AND json_extract(LogData, '$.metrics.duration_seconds') IS NOT NULL "
        "      THEN datetime(LogDateTime, '+' || CAST(CAST(json_extract(LogData, '$.metrics.duration_seconds') AS INTEGER) AS TEXT) || ' seconds') "
        "    ELSE NULL "
        "  END AS EndTime, "
        "  CASE "
        "    WHEN json_valid(LogData) THEN json_extract(LogData, '$.metrics.duration_seconds') "
        "    ELSE NULL "
        "  END AS DurationSeconds, "
        "  CASE "
        "    WHEN json_valid(LogData) THEN json_extract(LogData, '$.metrics.rows_read') "
        "    ELSE NULL "
        "  END AS RowsRead, "
        "  CASE "
        "    WHEN json_valid(LogData) THEN json_extract(LogData, '$.metrics.rows_written') "
        "    ELSE NULL "
        "  END AS RowsWritten, "
        "  CASE "
        "    WHEN json_valid(LogData) THEN json_extract(LogData, '$.metrics.bytes_transferred') "
        "    ELSE NULL "
        "  END AS BytesTransferred, "
        "  CASE "
        "    WHEN json_valid(LogData) THEN json_extract(LogData, '$.source.server') "
        "    ELSE NULL "
        "  END AS SourceServer, "
        "  CASE "
        "    WHEN json_valid(LogData) THEN json_extract(LogData, '$.source.database') "
        "    ELSE NULL "
        "  END AS SourceDatabase, "
        "  CASE "
        "    WHEN json_valid(LogData) THEN json_extract(LogData, '$.source.table') "
        "    ELSE NULL "
        "  END AS SourceTable, "
        "  CASE "
        "    WHEN json_valid(LogData) AND json_extract(LogData, '$.error') IS NOT NULL "
        "      THEN json_extract(LogData, '$.error') "
        "    ELSE NULL "
        "  END AS ErrorMessage "
        "FROM copy_activity_audit "
        "ORDER BY id DESC "
        "LIMIT 500"
    )


@route("GET", "/api/notebook-executions")
def get_notebook_executions(params: dict) -> list:
    """Return notebook/processing execution records from engine_task_log.

    engine_task_log stores per-entity processing tasks for bronze and
    silver layers (the notebook equivalent in Engine v3).  The
    notebook_executions table exists but is empty — engine_task_log is
    the actual source of truth.
    """
    return _safe_query(
        "SELECT id, "
        "  RunId, "
        "  EntityId, "
        "  Layer || '_Entity_' || EntityId AS Name, "
        "  CASE "
        "    WHEN LOWER(Status) = 'succeeded' THEN 'Succeeded' "
        "    WHEN LOWER(Status) = 'failed' THEN 'Failed' "
        "    ELSE Status "
        "  END AS Status, "
        "  Layer, "
        "  SourceServer, "
        "  SourceDatabase, "
        "  SourceTable, "
        "  RowsRead, "
        "  RowsWritten, "
        "  BytesTransferred, "
        "  DurationSeconds, "
        "  created_at AS StartTime, "
        "  CASE "
        "    WHEN DurationSeconds IS NOT NULL AND DurationSeconds > 0 "
        "      THEN datetime(created_at, '+' || CAST(CAST(DurationSeconds AS INTEGER) AS TEXT) || ' seconds') "
        "    ELSE NULL "
        "  END AS EndTime, "
        "  LoadType, "
        "  ErrorType, "
        "  ErrorMessage, "
        "  TargetLakehouse "
        "FROM engine_task_log "
        "ORDER BY id DESC "
        "LIMIT 500"
    )


# ---------------------------------------------------------------------------
# Error Intelligence
# ---------------------------------------------------------------------------

# -- Classification helpers --------------------------------------------------

_ERROR_CATEGORIES: list[tuple[str, str, str, str]] = [
    # (pattern_substring, category, title, severity)
    ("timeout",       "TIMEOUT",       "Timeout / Long-Running Query",    "critical"),
    ("deadlock",      "DEADLOCK",      "Deadlock Detected",               "critical"),
    ("out of memory", "OOM",           "Out of Memory",                   "critical"),
    ("outofmemory",   "OOM",           "Out of Memory",                   "critical"),
    ("memory",        "OOM",           "Memory Pressure",                 "warning"),
    ("connection",    "CONNECTION",     "Connection Failure",              "critical"),
    ("login failed",  "AUTH",          "Authentication Failure",          "critical"),
    ("permission",    "AUTH",          "Permission Denied",               "critical"),
    ("access denied", "AUTH",          "Access Denied",                   "critical"),
    ("unauthorized",  "AUTH",          "Unauthorized Access",             "critical"),
    ("throttl",       "THROTTLE",      "API Throttling / Rate Limit",     "warning"),
    ("429",           "THROTTLE",      "API Throttling (HTTP 429)",       "warning"),
    ("not found",     "NOT_FOUND",     "Resource Not Found",              "warning"),
    ("404",           "NOT_FOUND",     "Resource Not Found (HTTP 404)",   "warning"),
    ("schema",        "SCHEMA",        "Schema Mismatch",                 "warning"),
    ("column",        "SCHEMA",        "Column Issue",                    "warning"),
    ("type mismatch", "SCHEMA",        "Data Type Mismatch",             "warning"),
    ("truncat",       "DATA_QUALITY",  "Data Truncation",                 "warning"),
    ("duplicate",     "DATA_QUALITY",  "Duplicate Key Violation",         "warning"),
    ("constraint",    "DATA_QUALITY",  "Constraint Violation",            "warning"),
    ("null",          "DATA_QUALITY",  "Null Value Error",                "info"),
    ("watermark",     "WATERMARK",     "Watermark / Incremental Issue",   "info"),
    ("skip",          "SKIPPED",       "Entity Skipped",                  "info"),
]

_CATEGORY_SUGGESTIONS: dict[str, str] = {
    "TIMEOUT":      "Check query complexity and consider increasing timeouts or adding indexes on source tables.",
    "DEADLOCK":     "Review concurrent pipeline scheduling — stagger overlapping entity batches.",
    "OOM":          "Reduce ForEach batch size or split large tables into partitioned loads.",
    "CONNECTION":   "Verify VPN connectivity and that the source SQL Server is reachable.",
    "AUTH":         "Check service principal credentials and database permissions.",
    "THROTTLE":     "Reduce parallelism (ForEach batchCount) or add retry-with-backoff logic.",
    "NOT_FOUND":    "Verify the target resource (lakehouse, table, file path) still exists.",
    "SCHEMA":       "Compare source and target schemas — a column may have been added or renamed.",
    "DATA_QUALITY": "Inspect the failing rows for constraint violations, truncation, or duplicate keys.",
    "WATERMARK":    "Check the watermark column value and type — it may need a manual reset.",
    "SKIPPED":      "Entity was skipped (no new data or inactive). Usually safe to ignore.",
    "UNKNOWN":      "Review the raw error message for details.",
}


def _classify_error(error_text: str, error_type: str | None = None) -> tuple[str, str, str, str]:
    """Return (category, title, severity, suggestion) for an error message.

    Checks the explicit ErrorType column first, then falls back to
    substring matching against the error message body.
    """
    combined = ((error_type or "") + " " + (error_text or "")).lower()
    for pattern, category, title, severity in _ERROR_CATEGORIES:
        if pattern in combined:
            return category, title, severity, _CATEGORY_SUGGESTIONS.get(category, "")
    return "UNKNOWN", "Unclassified Error", "warning", _CATEGORY_SUGGESTIONS["UNKNOWN"]


@route("GET", "/api/error-intelligence")
def get_error_intelligence(params: dict) -> dict:
    """Aggregate error patterns from SQLite execution/logging tables.

    Merges errors from engine_task_log, pipeline_audit, and
    copy_activity_audit, classifies them, and returns the shape
    expected by the ErrorIntelligence frontend page.
    """

    # -- 1. Collect raw errors from all sources ---------------------------

    errors: list[dict] = []

    # Engine task log — richest error data (has ErrorType, ErrorMessage, etc.)
    task_errors = _safe_query(
        "SELECT etl.id, etl.RunId, etl.EntityId, etl.Layer, etl.Status, "
        "etl.SourceTable, etl.SourceServer, etl.SourceDatabase, "
        "etl.ErrorType, etl.ErrorMessage, etl.ErrorStackTrace, etl.ErrorSuggestion, "
        "etl.DurationSeconds, etl.created_at, "
        "er.StartedAt AS run_started, er.EndedAt AS run_ended "
        "FROM engine_task_log etl "
        "LEFT JOIN engine_runs er ON etl.RunId = er.RunId "
        "WHERE LOWER(etl.Status) = 'failed' OR etl.ErrorType IS NOT NULL "
        "ORDER BY etl.created_at DESC LIMIT 500"
    )
    for row in task_errors:
        raw = row.get("ErrorMessage") or row.get("ErrorStackTrace") or ""
        cat, title, sev, suggestion = _classify_error(
            raw, row.get("ErrorType")
        )
        entity_name = row.get("SourceTable") or ""
        errors.append({
            "id": f"etl-{row.get('id', '')}",
            "source": "engine",
            "pipelineName": f"Engine ({row.get('Layer', 'unknown')})",
            "workspaceName": "",
            "startTime": row.get("run_started") or row.get("created_at") or "",
            "endTime": row.get("run_ended") or "",
            "rawError": raw,
            "category": cat,
            "jobInstanceId": row.get("RunId") or "",
            "workspaceGuid": "",
            "summary": row.get("ErrorSuggestion") or title,
            "entityName": entity_name,
            "errorType": row.get("ErrorType") or cat,
        })

    # Pipeline audit errors
    pa_errors = _safe_query(
        "SELECT id, PipelineRunGuid, PipelineName, EntityLayer, LogType, "
        "LogDateTime, LogData, EntityId "
        "FROM pipeline_audit "
        "WHERE LOWER(LogType) = 'error' "
        "ORDER BY LogDateTime DESC LIMIT 500"
    )
    for row in pa_errors:
        raw = row.get("LogData") or ""
        cat, title, sev, suggestion = _classify_error(raw)
        errors.append({
            "id": f"pa-{row.get('id', '')}",
            "source": "pipeline",
            "pipelineName": row.get("PipelineName") or "Unknown Pipeline",
            "workspaceName": "",
            "startTime": row.get("LogDateTime") or "",
            "endTime": "",
            "rawError": raw,
            "category": cat,
            "jobInstanceId": row.get("PipelineRunGuid") or "",
            "workspaceGuid": "",
            "summary": title,
            "entityName": "",
            "errorType": cat,
        })

    # Copy activity audit errors
    ca_errors = _safe_query(
        "SELECT id, PipelineRunGuid, CopyActivityName, EntityLayer, LogType, "
        "LogDateTime, LogData, EntityId "
        "FROM copy_activity_audit "
        "WHERE LOWER(LogType) = 'error' "
        "ORDER BY LogDateTime DESC LIMIT 500"
    )
    for row in ca_errors:
        raw = row.get("LogData") or ""
        cat, title, sev, suggestion = _classify_error(raw)
        errors.append({
            "id": f"ca-{row.get('id', '')}",
            "source": "copy",
            "pipelineName": row.get("CopyActivityName") or "Copy Activity",
            "workspaceName": "",
            "startTime": row.get("LogDateTime") or "",
            "endTime": "",
            "rawError": raw,
            "category": cat,
            "jobInstanceId": row.get("PipelineRunGuid") or "",
            "workspaceGuid": "",
            "summary": title,
            "entityName": row.get("CopyActivityName") or "",
            "errorType": cat,
        })

    # -- 2. Build summaries grouped by category ---------------------------

    category_map: dict[str, list[dict]] = {}
    for err in errors:
        cat = err["category"]
        if cat not in category_map:
            category_map[cat] = []
        category_map[cat].append(err)

    summaries: list[dict] = []
    pattern_counts: dict[str, int] = {}
    severity_counts: dict[str, int] = {"critical": 0, "warning": 0, "info": 0}

    for cat, cat_errors_list in category_map.items():
        # Determine category-level severity (worst wins)
        _, cat_title, cat_severity, cat_suggestion = _classify_error(
            cat_errors_list[0]["rawError"],
            cat_errors_list[0].get("errorType"),
        )

        count = len(cat_errors_list)
        pattern_counts[cat] = count
        severity_counts[cat_severity] = severity_counts.get(cat_severity, 0) + count

        # Affected pipelines (unique)
        affected = list({e["pipelineName"] for e in cat_errors_list if e["pipelineName"]})

        # Latest occurrence
        latest = max(cat_errors_list, key=lambda e: e.get("startTime") or "")

        summaries.append({
            "id": cat,
            "category": cat,
            "title": cat_title,
            "severity": cat_severity,
            "suggestion": cat_suggestion,
            "occurrenceCount": count,
            "affectedPipelines": affected[:10],
            "latestError": latest.get("rawError", "")[:500],
            "latestTime": latest.get("startTime") or "",
            "latestPipeline": latest.get("pipelineName") or "",
        })

    # Sort summaries: critical first, then by occurrence count desc
    severity_order = {"critical": 0, "warning": 1, "info": 2}
    summaries.sort(key=lambda s: (severity_order.get(s["severity"], 9), -s["occurrenceCount"]))

    # -- 3. Compute top issue ---------------------------------------------

    total_errors = len(errors)
    top_issue = None
    if summaries:
        top = summaries[0]
        top_issue = {
            "errorType": top["category"],
            "label": top["title"],
            "count": top["occurrenceCount"],
            "totalErrors": total_errors,
            "suggestion": top["suggestion"],
        }

    return {
        "summaries": summaries,
        "errors": errors,
        "patternCounts": pattern_counts,
        "severityCounts": severity_counts,
        "totalErrors": total_errors,
        "topIssue": top_issue,
        "serverTime": _utcnow_iso(),
    }


# ---------------------------------------------------------------------------
# Dashboard stats
# ---------------------------------------------------------------------------

@route("GET", "/api/stats")
def get_dashboard_stats(params: dict) -> dict:
    """KPI summary for the dashboard overview cards."""
    try:
        lz = db.query("SELECT COUNT(*) AS cnt FROM lz_entities WHERE IsActive=1")
        brz = db.query("SELECT COUNT(*) AS cnt FROM bronze_entities WHERE IsActive=1")
        slv = db.query("SELECT COUNT(*) AS cnt FROM silver_entities WHERE IsActive=1")
        conn = db.query("SELECT COUNT(*) AS cnt FROM connections WHERE IsActive=1")
        ds = db.query("SELECT COUNT(*) AS cnt FROM datasources WHERE IsActive=1")
        lh = db.query("SELECT COUNT(*) AS cnt FROM lakehouses")

        lz_count = lz[0]["cnt"] if lz else 0
        brz_count = brz[0]["cnt"] if brz else 0
        slv_count = slv[0]["cnt"] if slv else 0
        conn_count = conn[0]["cnt"] if conn else 0
        ds_count = ds[0]["cnt"] if ds else 0
        lh_count = lh[0]["cnt"] if lh else 0

        return {
            "activeConnections": conn_count,
            "activeDataSources": ds_count,
            "activeEntities": lz_count + brz_count + slv_count,
            "lakehouses": lh_count,
            "entityBreakdown": {
                "landing": lz_count,
                "bronze": brz_count,
                "silver": slv_count,
            },
            # Legacy fields for backward compat
            "lzActiveEntities": lz_count,
            "bronzeActiveEntities": brz_count,
            "silverActiveEntities": slv_count,
        }
    except Exception as e:
        log.warning("get_dashboard_stats failed: %s", e)
        return {}


# ---------------------------------------------------------------------------
# Load Progress
# ---------------------------------------------------------------------------

@route("GET", "/api/load-progress")
def get_load_progress(params: dict) -> dict:
    """Entity load progress across all layers."""
    # Per-source progress
    sources = _safe_query(
        "WITH latest_task AS ("
        "  SELECT EntityId, Layer, Status, "
        "  ROW_NUMBER() OVER (PARTITION BY EntityId, Layer ORDER BY created_at DESC) AS rn "
        "  FROM engine_task_log"
        "), latest AS ("
        "  SELECT EntityId, Layer, Status FROM latest_task WHERE rn = 1"
        ") "
        "SELECT ds.DataSourceId, ds.Name AS dataSourceName, "
        "COUNT(DISTINCT le.LandingzoneEntityId) AS totalEntities, "
        "COUNT(DISTINCT CASE WHEN LOWER(COALESCE(es_lz.Status,'')) = 'succeeded' "
        "  THEN le.LandingzoneEntityId END) AS lzLoaded, "
        "COUNT(DISTINCT CASE WHEN LOWER(COALESCE(es_br.Status,'')) = 'succeeded' "
        "  THEN le.LandingzoneEntityId END) AS brzLoaded, "
        "COUNT(DISTINCT CASE WHEN LOWER(COALESCE(es_sv.Status,'')) = 'succeeded' "
        "  THEN le.LandingzoneEntityId END) AS slvLoaded "
        "FROM lz_entities le "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "LEFT JOIN latest es_lz ON le.LandingzoneEntityId = es_lz.EntityId "
        "  AND LOWER(es_lz.Layer) IN ('landing','landingzone') "
        "LEFT JOIN latest es_br ON le.LandingzoneEntityId = es_br.EntityId "
        "  AND LOWER(es_br.Layer) = 'bronze' "
        "LEFT JOIN latest es_sv ON le.LandingzoneEntityId = es_sv.EntityId "
        "  AND LOWER(es_sv.Layer) = 'silver' "
        "WHERE le.IsActive = 1 "
        "GROUP BY ds.DataSourceId, ds.Name "
        "ORDER BY ds.Name"
    )

    # Recent engine runs
    runs = _safe_query(
        "SELECT RunId, Mode, Status, TotalEntities, SucceededEntities, FailedEntities, "
        "TotalDurationSeconds, StartedAt, EndedAt "
        "FROM engine_runs ORDER BY StartedAt DESC LIMIT 10"
    )

    # Overall counts
    status_rows = _safe_query(
        "SELECT LOWER(Layer) AS layer, COUNT(DISTINCT EntityId) AS cnt FROM engine_task_log "
        "WHERE Status = 'succeeded' GROUP BY LOWER(Layer)"
    )
    status_map = {r["layer"]: r["cnt"] for r in status_rows} if status_rows else {}

    total_lz = _safe_query("SELECT COUNT(*) AS cnt FROM lz_entities WHERE IsActive=1")

    return {
        "sources": sources,
        "recentRuns": runs,
        "overall": {
            "totalEntities": total_lz[0]["cnt"] if total_lz else 0,
            "lzLoaded": status_map.get("landing", 0) + status_map.get("landingzone", 0),
            "brzLoaded": status_map.get("bronze", 0),
            "slvLoaded": status_map.get("silver", 0),
        },
        "serverTime": _utcnow_iso(),
    }


# ---------------------------------------------------------------------------
# Executive Dashboard
# ---------------------------------------------------------------------------

@route("GET", "/api/executive")
def get_executive_dashboard(params: dict) -> dict:
    """Aggregate executive dashboard — all data from SQLite.

    Returns the ExecData shape expected by ExecutiveDashboard.tsx:
    health, overview, sources, pipelineHealth, recentActivity, issues, trends.
    """
    now = _utcnow_iso()

    # --- Entity totals per layer ---
    lz_total = _safe_query("SELECT COUNT(*) AS cnt FROM lz_entities WHERE IsActive=1")
    brz_total = _safe_query("SELECT COUNT(*) AS cnt FROM bronze_entities WHERE IsActive=1")
    slv_total = _safe_query("SELECT COUNT(*) AS cnt FROM silver_entities WHERE IsActive=1")
    lz_count = lz_total[0]["cnt"] if lz_total else 0
    brz_count = brz_total[0]["cnt"] if brz_total else 0
    slv_count = slv_total[0]["cnt"] if slv_total else 0

    # --- Loaded counts from engine_task_log ---
    status_rows = _safe_query(
        "SELECT LOWER(Layer) AS layer, COUNT(DISTINCT EntityId) AS cnt FROM engine_task_log "
        "WHERE Status = 'succeeded' GROUP BY LOWER(Layer)"
    )
    sm = {r["layer"]: r["cnt"] for r in status_rows} if status_rows else {}
    lz_loaded = sm.get("landing", 0) + sm.get("landingzone", 0)
    brz_loaded = sm.get("bronze", 0)
    slv_loaded = sm.get("silver", 0)

    # --- Row counts from lakehouse_row_counts cache ---
    rc_rows = _safe_query(
        "SELECT lakehouse, SUM(row_count) AS total_rows FROM lakehouse_row_counts "
        "WHERE row_count > 0 GROUP BY lakehouse"
    )
    rc_map = {r["lakehouse"]: int(r["total_rows"]) for r in rc_rows} if rc_rows else {}
    # Sum row counts by layer name pattern
    bronze_rows = sum(v for k, v in rc_map.items() if "bronze" in k.lower())
    silver_rows = sum(v for k, v in rc_map.items() if "silver" in k.lower())
    landing_rows = sum(v for k, v in rc_map.items() if "landing" in k.lower() or "lz" in k.lower())

    # --- Data source count ---
    ds_count_row = _safe_query("SELECT COUNT(*) AS cnt FROM datasources WHERE IsActive=1")
    ds_count = ds_count_row[0]["cnt"] if ds_count_row else 0

    # --- Per-source breakdown ---
    source_rows = _safe_query(
        "WITH latest_task AS ("
        "  SELECT EntityId, Layer, Status, "
        "  ROW_NUMBER() OVER (PARTITION BY EntityId, Layer ORDER BY created_at DESC) AS rn "
        "  FROM engine_task_log"
        "), latest AS ("
        "  SELECT EntityId, Layer, Status FROM latest_task WHERE rn = 1"
        ") "
        "SELECT ds.Name AS name, ds.Namespace AS namespace, "
        "COUNT(DISTINCT le.LandingzoneEntityId) AS entityCount, "
        "COUNT(DISTINCT CASE WHEN le.IsActive=1 THEN le.LandingzoneEntityId END) AS activeLz, "
        "COUNT(DISTINCT CASE WHEN LOWER(COALESCE(es_lz.Status,'')) = 'succeeded' "
        "  THEN le.LandingzoneEntityId END) AS lzLoaded, "
        "COUNT(DISTINCT CASE WHEN LOWER(COALESCE(es_br.Status,'')) = 'succeeded' "
        "  THEN le.LandingzoneEntityId END) AS brzLoaded, "
        "COUNT(DISTINCT CASE WHEN LOWER(COALESCE(es_sv.Status,'')) = 'succeeded' "
        "  THEN le.LandingzoneEntityId END) AS slvLoaded "
        "FROM datasources ds "
        "LEFT JOIN lz_entities le ON le.DataSourceId = ds.DataSourceId AND le.IsActive=1 "
        "LEFT JOIN latest es_lz ON le.LandingzoneEntityId = es_lz.EntityId "
        "  AND LOWER(es_lz.Layer) IN ('landing','landingzone') "
        "LEFT JOIN latest es_br ON le.LandingzoneEntityId = es_br.EntityId "
        "  AND LOWER(es_br.Layer) = 'bronze' "
        "LEFT JOIN latest es_sv ON le.LandingzoneEntityId = es_sv.EntityId "
        "  AND LOWER(es_sv.Layer) = 'silver' "
        "WHERE ds.IsActive=1 "
        "GROUP BY ds.DataSourceId, ds.Name, ds.Namespace "
        "ORDER BY ds.Name"
    )
    sources = []
    for s in source_rows:
        ec = int(s.get("entityCount") or 0)
        alz = int(s.get("activeLz") or 0)
        ll = int(s.get("lzLoaded") or 0)
        bl = int(s.get("brzLoaded") or 0)
        sl = int(s.get("slvLoaded") or 0)
        sources.append({
            "name": s.get("name") or "",
            "namespace": s.get("namespace") or "",
            "entityCount": ec,
            "layers": {
                "landing": {"count": alz, "active": alz, "total": alz, "loaded": ll,
                            "completion": round(ll / alz * 100, 1) if alz else 0},
                "bronze":  {"count": alz, "active": alz, "total": alz, "loaded": bl,
                            "completion": round(bl / alz * 100, 1) if alz else 0},
                "silver":  {"count": alz, "active": alz, "total": alz, "loaded": sl,
                            "completion": round(sl / alz * 100, 1) if alz else 0},
            },
            "rowCounts": {"bronze": 0, "silver": 0},
        })

    # --- Pipeline health ---
    run_rows = _safe_query(
        "SELECT Status, COUNT(*) AS cnt FROM engine_runs GROUP BY Status"
    )
    run_map = {r["Status"]: int(r["cnt"]) for r in run_rows} if run_rows else {}
    succeeded = run_map.get("Completed", 0) + run_map.get("Succeeded", 0)
    failed = run_map.get("Failed", 0)
    running = run_map.get("Running", 0) + run_map.get("InProgress", 0)
    total_runs = sum(run_map.values())
    success_rate = round(succeeded / total_runs * 100, 1) if total_runs else 0

    # --- Recent activity (last 20 pipeline events) ---
    recent_raw = _safe_query(
        "SELECT PipelineName, EntityLayer, LogType, LogDateTime, LogData, PipelineRunGuid "
        "FROM pipeline_audit ORDER BY LogDateTime DESC LIMIT 20"
    )
    recent_activity = []
    for r in recent_raw:
        recent_activity.append({
            "description": f"{r.get('PipelineName', '')} — {r.get('LogType', '')}",
            "pipeline": r.get("PipelineName") or "",
            "layer": r.get("EntityLayer") or "",
            "status": r.get("LogType") or "",
            "duration": "",
            "startTime": r.get("LogDateTime"),
            "endTime": None,
        })

    # --- Issues (failed pipelines) ---
    issue_raw = _safe_query(
        "SELECT PipelineName, EntityLayer, LogData, LogDateTime "
        "FROM pipeline_audit WHERE LOWER(LogType) = 'error' "
        "ORDER BY LogDateTime DESC LIMIT 10"
    )
    issues = []
    for r in issue_raw:
        issues.append({
            "pipeline": r.get("PipelineName") or "",
            "layer": r.get("EntityLayer") or "",
            "message": (r.get("LogData") or "")[:200],
            "time": r.get("LogDateTime") or "",
        })

    # --- Health determination ---
    if total_runs == 0 and ds_count > 0:
        health = "setup"
    elif failed > 0 and succeeded == 0:
        health = "critical"
    elif failed > 0:
        health = "warning"
    else:
        health = "healthy"

    # --- Trends from health_trend_snapshots ---
    trend_rows = _safe_query(
        "SELECT snapshot_time AS captured_at, lz_loaded AS lz_count, "
        "bronze_loaded AS bronze_count, silver_loaded AS silver_count, "
        "pipeline_success_rate "
        "FROM health_trend_snapshots "
        "ORDER BY snapshot_time DESC LIMIT 48"
    )
    trends_health = []
    for t in reversed(trend_rows):
        trends_health.append({
            "captured_at": t.get("captured_at") or "",
            "health": "healthy",
            "lz_count": int(t.get("lz_count") or 0),
            "bronze_count": int(t.get("bronze_count") or 0),
            "silver_count": int(t.get("silver_count") or 0),
            "bronze_rows": 0,
            "silver_rows": 0,
            "pipeline_success_rate": float(t.get("pipeline_success_rate") or 0),
        })

    # --- Snapshot current state for trend tracking ---
    try:
        db.execute(
            "INSERT INTO health_trend_snapshots "
            "(snapshot_time, lz_loaded, bronze_loaded, silver_loaded, total_entities, pipeline_success_rate) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (now, lz_loaded, brz_loaded, slv_loaded, lz_count, success_rate),
        )
    except Exception as e:
        log.debug("Failed to save health trend snapshot: %s", e)

    return {
        "timestamp": now,
        "health": health,
        "dataSources": ds_count,
        "overview": {
            "totalEntities": lz_count,
            "layers": {
                "landing": {"total": lz_count, "loaded": lz_loaded,
                            "pending": lz_count - lz_loaded,
                            "completion": round(lz_loaded / lz_count * 100, 1) if lz_count else 0},
                "bronze":  {"total": brz_count, "loaded": brz_loaded,
                            "pending": brz_count - brz_loaded,
                            "completion": round(brz_loaded / brz_count * 100, 1) if brz_count else 0},
                "silver":  {"total": slv_count, "loaded": slv_loaded,
                            "pending": slv_count - slv_loaded,
                            "completion": round(slv_loaded / slv_count * 100, 1) if slv_count else 0},
            },
            "rowCounts": {"bronze": bronze_rows, "silver": silver_rows, "landing": landing_rows},
        },
        "sources": sources,
        "pipelineHealth": {
            "totalRuns": total_runs,
            "succeeded": succeeded,
            "failed": failed,
            "running": running,
            "successRate": success_rate,
        },
        "recentActivity": recent_activity,
        "issues": issues,
        "trends": {
            "health": trends_health,
            "layers": [],
            "pipelineRate": {
                "total": total_runs, "succeeded": succeeded,
                "failed": failed, "running": running,
                "successRate": success_rate,
            },
        },
    }


# ---------------------------------------------------------------------------
# Data Journey (entity lineage)
# ---------------------------------------------------------------------------

@route("GET", "/api/journey")
def get_entity_journey(params: dict) -> dict:
    """Return lineage + load history for a single LZ entity.

    Returns a structured response matching the frontend's JourneyData shape
    with source, landing, bronze (with columns), silver (with columns),
    gold (placeholder), and schemaDiff.
    """
    # Import lineage helpers at function level to avoid circular imports
    from dashboard.app.api.routes.lineage import (
        _load_cached_columns,
        _get_columns_for_layer,
    )

    entity_str = params.get("entity", "")
    if not entity_str or not str(entity_str).isdigit():
        raise HttpError("entity param required (LandingzoneEntityId)", 400)
    entity_id = int(entity_str)

    # LZ entity — join datasources AND connections for full source info
    lz = db.query(
        "SELECT le.*, ds.Name AS DataSourceName, ds.Namespace, ds.Type AS DataSourceType, "
        "c.Name AS ConnectionName, c.Type AS ConnectionType "
        "FROM lz_entities le "
        "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "LEFT JOIN connections c ON ds.ConnectionId = c.ConnectionId "
        "WHERE le.LandingzoneEntityId = ?",
        (entity_id,),
    )
    if not lz:
        raise HttpError(f"Entity {entity_id} not found", 404)

    lz_entity = lz[0]

    # Bronze entity
    bronze = db.query(
        "SELECT * FROM bronze_entities WHERE LandingzoneEntityId = ?",
        (entity_id,),
    )
    bronze_entity = bronze[0] if bronze else None

    # Silver entity
    silver_entity = None
    if bronze_entity:
        silver = db.query(
            "SELECT * FROM silver_entities WHERE BronzeLayerEntityId = ?",
            (bronze_entity["BronzeLayerEntityId"],),
        )
        silver_entity = silver[0] if silver else None

    # --- Resolve lakehouse names ---
    def _lh_name(lh_id) -> str:
        if not lh_id:
            return ""
        rows = db.query("SELECT Name FROM lakehouses WHERE LakehouseId = ?", (lh_id,))
        return rows[0]["Name"] if rows else ""

    lz_lh_name = _lh_name(lz_entity.get("LakehouseId"))
    bronze_lh_name = _lh_name(bronze_entity.get("LakehouseId")) if bronze_entity else ""
    silver_lh_name = _lh_name(silver_entity.get("LakehouseId")) if silver_entity else ""

    # --- Fetch columns for bronze and silver ---
    def _convert_columns(cols: list[dict]) -> list[dict]:
        """Convert lineage internal format to frontend ColumnInfo shape."""
        return [
            {
                "COLUMN_NAME": c["name"],
                "DATA_TYPE": c["dataType"],
                "IS_NULLABLE": "YES" if c.get("nullable") else "NO",
                "CHARACTER_MAXIMUM_LENGTH": str(c["maxLength"]) if c.get("maxLength") is not None else None,
                "NUMERIC_PRECISION": str(c["precision"]) if c.get("precision") is not None else None,
                "NUMERIC_SCALE": str(c["scale"]) if c.get("scale") is not None else None,
                "ORDINAL_POSITION": str(c.get("ordinal", 0)),
            }
            for c in cols
        ]

    bronze_columns_formatted: list[dict] = []
    silver_columns_formatted: list[dict] = []

    if bronze_entity:
        b_schema = bronze_entity.get("Schema_") or lz_entity.get("SourceSchema") or "dbo"
        b_table = bronze_entity.get("Name") or lz_entity.get("SourceName") or ""
        b_cols_raw = _get_columns_for_layer(
            entity_id, "bronze", bronze_lh_name, b_schema, b_table
        )
        bronze_columns_formatted = _convert_columns(b_cols_raw)

    if silver_entity:
        s_schema = silver_entity.get("Schema_") or lz_entity.get("SourceSchema") or "dbo"
        s_table = silver_entity.get("Name") or lz_entity.get("SourceName") or ""
        s_cols_raw = _get_columns_for_layer(
            entity_id, "silver", silver_lh_name, s_schema, s_table
        )
        silver_columns_formatted = _convert_columns(s_cols_raw)

    # --- Row counts from SQLite cache ---
    def _get_row_count(lakehouse: str, schema: str, table_name: str):
        if not lakehouse or not table_name:
            return None
        rows = db.query(
            "SELECT row_count FROM lakehouse_row_counts "
            "WHERE lakehouse = ? AND schema_name = ? AND table_name = ?",
            (lakehouse, schema, table_name),
        )
        if rows and rows[0].get("row_count") is not None:
            rc = rows[0]["row_count"]
            return rc if rc >= 0 else None
        return None

    bronze_row_count = None
    silver_row_count = None
    if bronze_entity:
        b_schema = bronze_entity.get("Schema_") or lz_entity.get("SourceSchema") or "dbo"
        b_table = bronze_entity.get("Name") or lz_entity.get("SourceName") or ""
        bronze_row_count = _get_row_count(bronze_lh_name, b_schema, b_table)
    if silver_entity:
        s_schema = silver_entity.get("Schema_") or lz_entity.get("SourceSchema") or "dbo"
        s_table = silver_entity.get("Name") or lz_entity.get("SourceName") or ""
        silver_row_count = _get_row_count(silver_lh_name, s_schema, s_table)

    # --- Compute schemaDiff ---
    schema_diff: list[dict] = []
    if bronze_columns_formatted or silver_columns_formatted:
        bronze_by_name = {c["COLUMN_NAME"]: c for c in bronze_columns_formatted}
        silver_by_name = {c["COLUMN_NAME"]: c for c in silver_columns_formatted}
        all_col_names = list(dict.fromkeys(
            [c["COLUMN_NAME"] for c in bronze_columns_formatted]
            + [c["COLUMN_NAME"] for c in silver_columns_formatted]
        ))
        for col_name in all_col_names:
            in_bronze = col_name in bronze_by_name
            in_silver = col_name in silver_by_name
            b_col = bronze_by_name.get(col_name)
            s_col = silver_by_name.get(col_name)

            if in_bronze and in_silver:
                type_changed = (b_col["DATA_TYPE"] != s_col["DATA_TYPE"])
                status = "type_changed" if type_changed else "unchanged"
            elif in_bronze and not in_silver:
                status = "bronze_only"
            else:
                status = "added_in_silver"

            schema_diff.append({
                "columnName": col_name,
                "inBronze": in_bronze,
                "inSilver": in_silver,
                "bronzeType": b_col["DATA_TYPE"] if b_col else None,
                "silverType": s_col["DATA_TYPE"] if s_col else None,
                "bronzeNullable": b_col["IS_NULLABLE"] if b_col else None,
                "silverNullable": s_col["IS_NULLABLE"] if s_col else None,
                "status": status,
            })

    # --- Build structured response matching frontend JourneyData shape ---
    return {
        "entityId": entity_id,
        "source": {
            "schema": lz_entity.get("SourceSchema") or "dbo",
            "name": lz_entity.get("SourceName") or "",
            "dataSourceName": lz_entity.get("DataSourceName") or "",
            "dataSourceType": lz_entity.get("DataSourceType") or "SQL Server",
            "namespace": lz_entity.get("Namespace") or "",
            "connectionName": lz_entity.get("ConnectionName") or "",
            "connectionType": lz_entity.get("ConnectionType") or "ODBC",
        },
        "landing": {
            "entityId": entity_id,
            "fileName": lz_entity.get("FileName") or "",
            "filePath": lz_entity.get("FilePath") or "",
            "onelakeSchema": lz_entity.get("FilePath") or lz_entity.get("SourceSchema") or "dbo",
            "fileType": lz_entity.get("FileType") or "Parquet",
            "lakehouse": lz_lh_name or "LH_DATA_LANDINGZONE",
            "isIncremental": bool(lz_entity.get("IsIncremental") or lz_entity.get("IsIncrementalColumn")),
            "incrementalColumn": lz_entity.get("IsIncrementalColumn"),
            "customSelect": lz_entity.get("SourceCustomSelect"),
            "customNotebook": lz_entity.get("CustomNotebookName"),
        },
        "bronze": {
            "entityId": bronze_entity["BronzeLayerEntityId"],
            "schema": bronze_entity.get("Schema_") or "",
            "onelakeSchema": lz_entity.get("FilePath") or bronze_entity.get("Schema_") or "dbo",
            "name": bronze_entity.get("Name") or "",
            "primaryKeys": bronze_entity.get("PrimaryKeys"),
            "fileType": bronze_entity.get("FileType") or "Delta",
            "lakehouse": bronze_lh_name,
            "rowCount": bronze_row_count,
            "columns": bronze_columns_formatted,
            "columnCount": len(bronze_columns_formatted),
        } if bronze_entity else None,
        "silver": {
            "entityId": silver_entity["SilverLayerEntityId"],
            "schema": silver_entity.get("Schema_") or "",
            "onelakeSchema": lz_entity.get("FilePath") or silver_entity.get("Schema_") or "dbo",
            "name": silver_entity.get("Name") or "",
            "fileType": silver_entity.get("FileType") or "delta",
            "lakehouse": silver_lh_name,
            "rowCount": silver_row_count,
            "columns": silver_columns_formatted,
            "columnCount": len(silver_columns_formatted),
        } if silver_entity else None,
        "gold": None,
        "schemaDiff": schema_diff,
        # Preserve lastLoadValues for backward compat
        "lastLoadValues": db.query(
            "SELECT LoadValue, LastLoadDatetime "
            "FROM watermarks "
            "WHERE LandingzoneEntityId = ? "
            "ORDER BY LastLoadDatetime DESC LIMIT 5",
            (entity_id,),
        ),
    }
