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
    return _safe_query(
        "SELECT * FROM copy_activity_audit ORDER BY id DESC"
    )


@route("GET", "/api/notebook-executions")
def get_notebook_executions(params: dict) -> list:
    return _safe_query(
        "SELECT * FROM notebook_executions ORDER BY id DESC"
    )


# ---------------------------------------------------------------------------
# Error Intelligence
# ---------------------------------------------------------------------------

@route("GET", "/api/error-intelligence")
def get_error_intelligence(params: dict) -> dict:
    """Aggregate error patterns from execution log tables.

    Returns top error messages, failure counts by pipeline, and a
    recent error timeline — all sourced from SQLite.
    """
    result: dict = {}

    # Recent pipeline failures
    result["pipelineFailures"] = _safe_query(
        "SELECT PipelineName, LogType, LogDateTime, LogData "
        "FROM pipeline_audit "
        "WHERE LogType = 'Error' "
        "ORDER BY LogDateTime DESC LIMIT 100"
    )

    # Failure counts by pipeline
    result["failuresByPipeline"] = _safe_query(
        "SELECT PipelineName, COUNT(*) as failureCount "
        "FROM pipeline_audit "
        "WHERE LogType = 'Error' "
        "GROUP BY PipelineName "
        "ORDER BY failureCount DESC"
    )

    # Notebook failures
    result["notebookFailures"] = _safe_query(
        "SELECT NotebookName, LogType, LogDateTime, LogData, EntityId, EntityLayer "
        "FROM notebook_executions "
        "WHERE LogType = 'Error' "
        "ORDER BY LogDateTime DESC LIMIT 100"
    )

    # Copy activity failures
    result["copyFailures"] = _safe_query(
        "SELECT CopyActivityName, CopyActivityName AS EntityName, LogType, LogDateTime, LogData "
        "FROM copy_activity_audit "
        "WHERE LogType = 'Error' "
        "ORDER BY LogDateTime DESC LIMIT 100"
    )

    result["serverTime"] = _utcnow_iso()
    return result


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
