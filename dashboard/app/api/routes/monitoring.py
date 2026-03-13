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

        # Processed counts from entity_status (universal tracking table).
        # Layer names may be lowercase ('landing','bronze','silver') from seed data
        # or mixed case ('LandingZone','Bronze','Silver') from engine writes.
        # Status may be 'loaded'/'Succeeded'. Handle both conventions.
        status_rows = _safe_query(
            "SELECT LOWER(Layer) AS layer, COUNT(*) AS cnt FROM entity_status "
            "WHERE LOWER(Status) IN ('succeeded', 'loaded') GROUP BY LOWER(Layer)"
        )
        status_map = {r["layer"]: r["cnt"] for r in status_rows} if status_rows else {}

        result["counts"] = {
            "lzRegistered": lz_total[0]["cnt"] if lz_total else 0,
            "brzRegistered": brz_total[0]["cnt"] if brz_total else 0,
            "slvRegistered": slv_total[0]["cnt"] if slv_total else 0,
            "lzProcessed": status_map.get("landing", 0) + status_map.get("landingzone", 0),
            "brzProcessed": status_map.get("bronze", 0),
            "slvProcessed": status_map.get("silver", 0),
        }
    except Exception:
        result["counts"] = {}

    # Recently processed Bronze entities
    result["bronzeEntities"] = _safe_query(
        "SELECT be.BronzeLayerEntityId, be.Schema_ AS SchemaName, be.Name AS TableName, "
        "es.LoadEndDateTime AS InsertDateTime, "
        "CASE WHEN LOWER(COALESCE(es.Status,'')) IN ('loaded','succeeded') THEN 1 ELSE 0 END AS IsProcessed, "
        "es.updated_at AS LoadEndDateTime "
        "FROM entity_status es "
        "JOIN bronze_entities be ON es.LandingzoneEntityId = be.LandingzoneEntityId "
        "WHERE LOWER(es.Layer) = 'bronze' "
        "ORDER BY es.updated_at DESC LIMIT 20"
    )

    # Recently processed LZ entities
    result["lzEntities"] = _safe_query(
        "SELECT le.LandingzoneEntityId, le.FilePath, le.FileName, "
        "es.LoadEndDateTime AS InsertDateTime, "
        "CASE WHEN LOWER(COALESCE(es.Status,'')) IN ('loaded','succeeded') THEN 1 ELSE 0 END AS IsProcessed, "
        "es.updated_at AS LoadEndDateTime "
        "FROM entity_status es "
        "JOIN lz_entities le ON es.LandingzoneEntityId = le.LandingzoneEntityId "
        "WHERE LOWER(es.Layer) IN ('landing','landingzone') "
        "ORDER BY es.updated_at DESC LIMIT 20"
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
        "WHERE etl.Status = 'Failed' OR etl.ErrorType IS NOT NULL "
        "ORDER BY etl.created_at DESC LIMIT 500"
    )
    for row in task_errors:
        raw = row.get("ErrorMessage") or row.get("ErrorStackTrace") or ""
        cat, title, sev, suggestion = _classify_error(
            raw, row.get("ErrorType")
        )
        entity_name = row.get("SourceTable") or ""
        if row.get("SourceSchema"):
            entity_name = row["SourceSchema"] + "." + entity_name
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

    # Entity status errors (entities stuck in failed state)
    es_errors = _safe_query(
        "SELECT es.LandingzoneEntityId, es.Layer, es.Status, es.ErrorMessage, "
        "es.updated_at, le.SourceName, le.SourceSchema "
        "FROM entity_status es "
        "LEFT JOIN lz_entities le ON es.LandingzoneEntityId = le.LandingzoneEntityId "
        "WHERE LOWER(es.Status) = 'failed' AND es.ErrorMessage IS NOT NULL "
        "AND es.ErrorMessage != '' "
        "ORDER BY es.updated_at DESC LIMIT 200"
    )
    for row in es_errors:
        raw = row.get("ErrorMessage") or ""
        cat, title, sev, suggestion = _classify_error(raw)
        entity_name = row.get("SourceName") or ""
        if row.get("SourceSchema"):
            entity_name = row["SourceSchema"] + "." + entity_name
        errors.append({
            "id": f"es-{row.get('LandingzoneEntityId', '')}-{row.get('Layer', '')}",
            "source": "entity_status",
            "pipelineName": f"Entity Status ({row.get('Layer', '')})",
            "workspaceName": "",
            "startTime": row.get("updated_at") or "",
            "endTime": "",
            "rawError": raw,
            "category": cat,
            "jobInstanceId": "",
            "workspaceGuid": "",
            "summary": title,
            "entityName": entity_name,
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
        "SELECT ds.DataSourceId, ds.Name AS dataSourceName, "
        "COUNT(DISTINCT le.LandingzoneEntityId) AS totalEntities, "
        "COUNT(DISTINCT CASE WHEN LOWER(COALESCE(es_lz.Status,'')) IN ('loaded','succeeded') "
        "  THEN le.LandingzoneEntityId END) AS lzLoaded, "
        "COUNT(DISTINCT CASE WHEN LOWER(COALESCE(es_br.Status,'')) IN ('loaded','succeeded') "
        "  THEN le.LandingzoneEntityId END) AS brzLoaded, "
        "COUNT(DISTINCT CASE WHEN LOWER(COALESCE(es_sv.Status,'')) IN ('loaded','succeeded') "
        "  THEN le.LandingzoneEntityId END) AS slvLoaded "
        "FROM lz_entities le "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "LEFT JOIN entity_status es_lz ON le.LandingzoneEntityId = es_lz.LandingzoneEntityId "
        "  AND LOWER(es_lz.Layer) IN ('landing','landingzone') "
        "LEFT JOIN entity_status es_br ON le.LandingzoneEntityId = es_br.LandingzoneEntityId "
        "  AND LOWER(es_br.Layer) = 'bronze' "
        "LEFT JOIN entity_status es_sv ON le.LandingzoneEntityId = es_sv.LandingzoneEntityId "
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
        "SELECT LOWER(Layer) AS layer, COUNT(*) AS cnt FROM entity_status "
        "WHERE LOWER(Status) IN ('succeeded', 'loaded') GROUP BY LOWER(Layer)"
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
# Data Journey (entity lineage)
# ---------------------------------------------------------------------------

@route("GET", "/api/journey")
def get_entity_journey(params: dict) -> dict:
    """Return lineage + load history for a single LZ entity."""
    entity_str = params.get("entity", "")
    if not entity_str or not str(entity_str).isdigit():
        raise HttpError("entity param required (LandingzoneEntityId)", 400)
    entity_id = int(entity_str)

    # LZ entity
    lz = db.query(
        "SELECT le.*, ds.Name AS DataSourceName "
        "FROM lz_entities le "
        "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
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

    # Last load values (watermarks table in SQLite)
    last_load = db.query(
        "SELECT LoadValue, LastLoadDatetime "
        "FROM watermarks "
        "WHERE LandingzoneEntityId = ? "
        "ORDER BY LastLoadDatetime DESC LIMIT 5",
        (entity_id,),
    )

    return {
        "entityId": entity_id,
        "lz": lz_entity,
        "bronze": bronze_entity,
        "silver": silver_entity,
        "lastLoadValues": last_load,
    }
