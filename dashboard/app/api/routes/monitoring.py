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
import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.routes.load_center import _build_canonical_pipeline_truth
from dashboard.app.api.routes.metrics_contract import build_metric_contract

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


def _recent_mapped_entities(layer: str, limit: int = 20) -> list[dict]:
    """Return recent task rows mapped back to the owning landing entity."""
    sql = f"""
        {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
        SELECT
            t.EntityId AS LayerEntityId,
            mapped.LandingzoneEntityId,
            mapped.Layer,
            mapped.Status,
            mapped.SourceSchema,
            mapped.SourceName,
            COALESCE(mapped.LoadEndDateTime, t.created_at) AS EventTime,
            le.FilePath,
            le.FileName
        FROM mapped
        JOIN engine_task_log t ON t.id = mapped.id
        LEFT JOIN lz_entities le ON mapped.LandingzoneEntityId = le.LandingzoneEntityId
        WHERE LOWER(mapped.Layer) = LOWER(?)
          AND mapped.LandingzoneEntityId IS NOT NULL
        ORDER BY EventTime DESC, t.id DESC
        LIMIT ?
    """
    return _safe_query(sql, (layer, str(limit)))


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
    contract = build_metric_contract()
    tables = contract["tables"]
    total_in_scope = int(tables["inScope"]["value"] or 0)
    landing_loaded = int(tables["landingLoaded"]["value"] or 0)
    bronze_loaded = int(tables["bronzeLoaded"]["value"] or 0)
    silver_loaded = int(tables["silverLoaded"]["value"] or 0)

    # minutes=0 means "all time" — skip the WHERE time filter entirely
    time_filter = ""
    time_params: tuple = ()
    if minutes > 0:
        time_filter = "WHERE LogDateTime >= datetime('now', '-' || ? || ' minutes') "
        time_params = (str(minutes),)

    # Pipeline execution events (from pipeline_audit)
    result["pipelineEvents"] = _safe_query(
        "SELECT PipelineName, LogType, LogDateTime, LogData, PipelineRunGuid, EntityLayer "
        "FROM pipeline_audit "
        + time_filter +
        "ORDER BY LogDateTime DESC LIMIT 50",
        time_params,
    )

    # Notebook execution events
    result["notebookEvents"] = _safe_query(
        "SELECT NotebookName, LogType, LogDateTime, LogData, EntityId, EntityLayer, PipelineRunGuid "
        "FROM notebook_executions "
        + time_filter +
        "ORDER BY LogDateTime DESC LIMIT 200",
        time_params,
    )

    # Copy activity events
    result["copyEvents"] = _safe_query(
        "SELECT CopyActivityName, CopyActivityName AS EntityName, LogType, LogDateTime, "
        "LogData, EntityId, EntityLayer, PipelineRunGuid "
        "FROM copy_activity_audit "
        + time_filter +
        "ORDER BY LogDateTime DESC LIMIT 100",
        time_params,
    )

    result["counts"] = {
        "lzTotal": total_in_scope,
        "brzTotal": total_in_scope,
        "slvTotal": total_in_scope,
        "lzLoaded": landing_loaded,
        "brzLoaded": bronze_loaded,
        "slvLoaded": silver_loaded,
        "lzPending": max(total_in_scope - landing_loaded, 0),
        "brzPending": max(total_in_scope - bronze_loaded, 0),
        "slvPending": max(total_in_scope - silver_loaded, 0),
        "toolReady": int(tables["toolReady"]["value"] or 0),
        "blocked": int(tables["blocked"]["value"] or 0),
        # Legacy keys kept until all consumers are migrated.
        "lzRegistered": total_in_scope,
        "brzRegistered": total_in_scope,
        "slvRegistered": total_in_scope,
        "lzProcessed": landing_loaded,
        "brzProcessed": bronze_loaded,
        "slvProcessed": silver_loaded,
    }

    # Recently processed Bronze entities
    result["bronzeEntities"] = [
        {
            "BronzeLayerEntityId": row.get("LayerEntityId"),
            "SchemaName": row.get("SourceSchema") or "",
            "TableName": row.get("SourceName") or "",
            "InsertDateTime": row.get("EventTime"),
            "IsProcessed": 1 if str(row.get("Status") or "").lower() == "succeeded" else 0,
            "LoadEndDateTime": row.get("EventTime"),
        }
        for row in _recent_mapped_entities("bronze", 20)
    ]

    # Recently processed LZ entities
    result["lzEntities"] = [
        {
            "LandingzoneEntityId": row.get("LandingzoneEntityId"),
            "FilePath": row.get("FilePath") or "",
            "FileName": row.get("FileName") or "",
            "InsertDateTime": row.get("EventTime"),
            "IsProcessed": 1 if str(row.get("Status") or "").lower() == "succeeded" else 0,
            "LoadEndDateTime": row.get("EventTime"),
        }
        for row in _recent_mapped_entities("landing", 20)
    ]

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
        pipeline_truth = _build_canonical_pipeline_truth()
        lz = db.query("SELECT COUNT(*) AS cnt FROM lz_entities WHERE IsActive=1")
        brz = db.query("SELECT COUNT(*) AS cnt FROM bronze_entities WHERE IsActive=1")
        slv = db.query("SELECT COUNT(*) AS cnt FROM silver_entities WHERE IsActive=1")
        conn = db.query("SELECT COUNT(*) AS cnt FROM connections WHERE IsActive=1")
        lh = db.query("SELECT COUNT(*) AS cnt FROM lakehouses")

        lz_count = lz[0]["cnt"] if lz else 0
        brz_count = brz[0]["cnt"] if brz else 0
        slv_count = slv[0]["cnt"] if slv else 0
        conn_count = conn[0]["cnt"] if conn else 0
        ds_count = len(pipeline_truth.get("sourceStats", {}))
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


@route("GET", "/api/dashboard-stats")
def get_dashboard_stats_alias(params: dict) -> dict:
    """Backward-compatible alias for older dashboard consumers."""
    return get_dashboard_stats(params)


# ---------------------------------------------------------------------------
# Load Progress
# ---------------------------------------------------------------------------

@route("GET", "/api/load-progress")
def get_load_progress(params: dict) -> dict:
    """Truthful load progress payload backed by canonical status + mapped task log."""
    registered = [
        row for row in cpdb.get_registered_entities_full()
        if int(row.get("IsActive") or 0) == 1
    ]
    canonical_status = {
        (int(row.get("LandingzoneEntityId") or 0), str(row.get("Layer") or "").lower()): row
        for row in cpdb.get_canonical_entity_status()
    }
    mapped_rows = cpdb.get_mapped_engine_task_log(latest_only=True)
    source_cfg = {
        int(row.get("DataSourceId") or 0): row
        for row in cpdb.get_source_config()
        if row.get("DataSourceId") is not None
    }

    by_source: list[dict] = []
    pending_by_source: list[dict] = []
    source_names = sorted({str(row.get("DataSourceName") or "") for row in registered if row.get("DataSourceName")})
    for source_name in source_names:
        source_entities = [row for row in registered if str(row.get("DataSourceName") or "") == source_name]
        total_entities = len(source_entities)
        loaded_count = sum(
            1 for row in source_entities
            if str(canonical_status.get((int(row.get("LandingzoneEntityId") or 0), "landing"), {}).get("Status") or "").lower() == "succeeded"
        )
        bronze_loaded = sum(
            1 for row in source_entities
            if str(canonical_status.get((int(row.get("LandingzoneEntityId") or 0), "bronze"), {}).get("Status") or "").lower() == "succeeded"
        )
        silver_loaded = sum(
            1 for row in source_entities
            if str(canonical_status.get((int(row.get("LandingzoneEntityId") or 0), "silver"), {}).get("Status") or "").lower() == "succeeded"
        )
        pending_count = max(total_entities - loaded_count, 0)
        source_row = {
            "Source": source_name,
            "TotalEntities": total_entities,
            "LoadedCount": loaded_count,
            "PendingCount": pending_count,
            "PctComplete": round((loaded_count / total_entities) * 100, 1) if total_entities else 0,
            "FirstLoaded": None,
            "LastLoaded": None,
            "BronzeLoaded": bronze_loaded,
            "SilverLoaded": silver_loaded,
        }
        by_source.append(source_row)
        if pending_count > 0:
            pending_by_source.append({"Source": source_name, "cnt": pending_count})

    runs = _safe_query(
        "SELECT RunId, Mode, Status, TotalEntities, SucceededEntities, FailedEntities, "
        "TotalDurationSeconds, StartedAt, EndedAt "
        "FROM engine_runs ORDER BY StartedAt DESC LIMIT 10"
    )

    latest_landing_success = []
    recent_activity = []
    for row in mapped_rows:
        layer = str(row.get("Layer") or "").lower()
        entity_id = int(row.get("LandingzoneEntityId") or 0)
        ds = source_cfg.get(int(row.get("DataSourceId") or 0), {})
        source_name = str(ds.get("Name") or "")
        if str(row.get("Status") or "").lower() == "succeeded" and layer == "landing":
            latest_landing_success.append({
                "Source": source_name,
                "Schema": row.get("SourceSchema") or "",
                "TableName": row.get("SourceName") or "",
                "LoadedAt": row.get("LoadEndDateTime"),
                "TargetFile": row.get("SourceTable") or "",
                "IsIncremental": bool(row.get("IsIncremental")),
                "EntityId": entity_id,
                "RowsCopied": int(row.get("RowsWritten") or row.get("RowsRead") or 0),
                "Duration": None,
                "Status": "Loaded",
            })

        recent_activity.append({
            "TableName": row.get("SourceName") or "",
            "Source": source_name,
            "LogType": row.get("Status") or "",
            "LogTime": row.get("LoadEndDateTime"),
            "Layer": layer,
            "LogData": None,
            "EntityId": entity_id,
        })

    latest_landing_success.sort(key=lambda row: str(row.get("LoadedAt") or ""), reverse=True)
    recent_activity.sort(key=lambda row: str(row.get("LogTime") or ""), reverse=True)

    total_entities = len(registered)
    loaded_entities = sum(
        1
        for row in registered
        if str(canonical_status.get((int(row.get("LandingzoneEntityId") or 0), "landing"), {}).get("Status") or "").lower() == "succeeded"
    )
    pending_entities = max(total_entities - loaded_entities, 0)
    latest_run = runs[0] if runs else {}
    last_activity = recent_activity[0]["LogTime"] if recent_activity else latest_run.get("EndedAt") or latest_run.get("StartedAt")

    return {
        "overall": {
            "TotalEntities": total_entities,
            "LoadedEntities": loaded_entities,
            "PendingEntities": pending_entities,
            "PctComplete": round((loaded_entities / total_entities) * 100, 1) if total_entities else 0,
            "RunStarted": latest_run.get("StartedAt"),
            "LastActivity": last_activity,
            "ElapsedSeconds": latest_run.get("TotalDurationSeconds"),
        },
        "bySource": by_source,
        "recentActivity": recent_activity[:50],
        "loadedEntities": latest_landing_success[:200],
        "pendingBySource": pending_by_source,
        "concurrencyTimeline": [],
        "recentRuns": runs,
        "sources": [
            {
                "dataSourceName": row["Source"],
                "totalEntities": row["TotalEntities"],
                "lzLoaded": row["LoadedCount"],
                "brzLoaded": row.get("BronzeLoaded", 0),
                "slvLoaded": row.get("SilverLoaded", 0),
            }
            for row in by_source
        ],
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
    pipeline_truth = _build_canonical_pipeline_truth()
    contract = build_metric_contract()
    tables = contract["tables"]
    in_scope = int(tables["inScope"]["value"] or 0)
    lz_loaded = int(tables["landingLoaded"]["value"] or 0)
    brz_loaded = int(tables["bronzeLoaded"]["value"] or 0)
    slv_loaded = int(tables["silverLoaded"]["value"] or 0)

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
    ds_count = int(contract["sources"]["total"] or 0)

    # --- Per-source breakdown ---
    sources = []
    for source in contract["sources"]["bySource"]:
        ec = int(source.get("tablesInScope") or 0)
        ll = int(source.get("landingLoaded") or 0)
        bl = int(source.get("bronzeLoaded") or 0)
        sl = int(source.get("silverLoaded") or 0)
        sources.append({
            "name": source.get("displayName") or source.get("source") or "",
            "namespace": source.get("source") or "",
            "entityCount": ec,
            "layers": {
                "landing": {"count": ec, "active": ec, "total": ec, "loaded": ll,
                            "completion": round(ll / ec * 100, 1) if ec else 0},
                "bronze":  {"count": ec, "active": ec, "total": ec, "loaded": bl,
                            "completion": round(bl / ec * 100, 1) if ec else 0},
                "silver":  {"count": ec, "active": ec, "total": ec, "loaded": sl,
                            "completion": round(sl / ec * 100, 1) if ec else 0},
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
    elif failed > 0 or int(contract["blockers"]["open"] or 0) > 0:
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
            (now, lz_loaded, brz_loaded, slv_loaded, in_scope, success_rate),
        )
    except Exception as e:
        log.debug("Failed to save health trend snapshot: %s", e)

    return {
        "timestamp": now,
        "health": health,
        "dataSources": ds_count,
        "overview": {
            "totalEntities": in_scope,
            "layers": {
                "landing": {"total": in_scope, "loaded": lz_loaded,
                            "pending": max(in_scope - lz_loaded, 0),
                            "completion": round(lz_loaded / in_scope * 100, 1) if in_scope else 0},
                "bronze":  {"total": in_scope, "loaded": brz_loaded,
                            "pending": max(in_scope - brz_loaded, 0),
                            "completion": round(brz_loaded / in_scope * 100, 1) if in_scope else 0},
                "silver":  {"total": in_scope, "loaded": slv_loaded,
                            "pending": max(in_scope - slv_loaded, 0),
                            "completion": round(slv_loaded / in_scope * 100, 1) if in_scope else 0},
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
