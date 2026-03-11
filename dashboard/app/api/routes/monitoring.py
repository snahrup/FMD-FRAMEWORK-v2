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

    # Pipeline execution events (from pipeline_audit)
    result["pipelineEvents"] = _safe_query(
        "SELECT PipelineName, LogType, LogDateTime, LogData, PipelineRunGuid, EntityLayer "
        "FROM pipeline_audit "
        "ORDER BY LogDateTime DESC LIMIT 50"
    )

    # Notebook execution events (engine_task_log is the closest proxy)
    result["notebookEvents"] = _safe_query(
        "SELECT '' AS NotebookName, Status AS LogType, created_at AS LogDateTime, "
        "ErrorMessage AS LogData, EntityId, Layer AS EntityLayer, RunId AS PipelineRunGuid "
        "FROM engine_task_log "
        "ORDER BY created_at DESC LIMIT 200"
    )

    # Copy activity events
    result["copyEvents"] = _safe_query(
        "SELECT CopyActivityName, CopyActivityParameters AS EntityName, LogType, LogDateTime, "
        "LogData, EntityId, EntityLayer, PipelineRunGuid "
        "FROM copy_activity_audit "
        "ORDER BY LogDateTime DESC LIMIT 100"
    )

    # Processing counts from entity tables
    try:
        lz_total = db.query("SELECT COUNT(*) AS cnt FROM lz_entities")
        brz_total = db.query("SELECT COUNT(*) AS cnt FROM bronze_entities")
        slv_total = db.query("SELECT COUNT(*) AS cnt FROM silver_entities")
        result["counts"] = {
            "lzRegistered": lz_total[0]["cnt"] if lz_total else 0,
            "brzRegistered": brz_total[0]["cnt"] if brz_total else 0,
            "slvRegistered": slv_total[0]["cnt"] if slv_total else 0,
        }
    except Exception:
        result["counts"] = {}

    # Recently processed Bronze entities
    result["bronzeEntities"] = _safe_query(
        "SELECT BronzeLayerEntityId, SchemaName, TableName, "
        "InsertDateTime, IsProcessed, updated_at AS LoadEndDateTime "
        "FROM pipeline_bronze_entity "
        "ORDER BY InsertDateTime DESC LIMIT 20"
    )

    # Recently processed LZ entities
    result["lzEntities"] = _safe_query(
        "SELECT LandingzoneEntityId, FilePath, FileName, "
        "InsertDateTime, IsProcessed, updated_at AS LoadEndDateTime "
        "FROM pipeline_lz_entity "
        "ORDER BY InsertDateTime DESC LIMIT 20"
    )

    result["serverTime"] = _utcnow_iso()
    return result


# ---------------------------------------------------------------------------
# Execution logs
# ---------------------------------------------------------------------------

@route("GET", "/api/copy-executions")
def get_copy_executions(params: dict) -> list:
    return _safe_query(
        "SELECT * FROM CopyActivityExecution ORDER BY CopyActivityExecutionId DESC"
    )


@route("GET", "/api/notebook-executions")
def get_notebook_executions(params: dict) -> list:
    return _safe_query(
        "SELECT * FROM NotebookExecution ORDER BY NotebookExecutionId DESC"
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
        "FROM PipelineExecution "
        "WHERE LogType = 'Error' "
        "ORDER BY LogDateTime DESC LIMIT 100"
    )

    # Failure counts by pipeline
    result["failuresByPipeline"] = _safe_query(
        "SELECT PipelineName, COUNT(*) as failureCount "
        "FROM PipelineExecution "
        "WHERE LogType = 'Error' "
        "GROUP BY PipelineName "
        "ORDER BY failureCount DESC"
    )

    # Notebook failures
    result["notebookFailures"] = _safe_query(
        "SELECT NotebookName, LogType, LogDateTime, LogData, EntityId, EntityLayer "
        "FROM NotebookExecution "
        "WHERE LogType = 'Error' "
        "ORDER BY LogDateTime DESC LIMIT 100"
    )

    # Copy activity failures
    result["copyFailures"] = _safe_query(
        "SELECT CopyActivityName, EntityName, LogType, LogDateTime, LogData "
        "FROM CopyActivityExecution "
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
        lz = db.query("SELECT COUNT(*) AS cnt FROM LandingzoneEntity WHERE IsActive=1")
        brz = db.query("SELECT COUNT(*) AS cnt FROM BronzeLayerEntity WHERE IsActive=1")
        slv = db.query("SELECT COUNT(*) AS cnt FROM SilverLayerEntity WHERE IsActive=1")
        return {
            "lzActiveEntities": lz[0]["cnt"] if lz else 0,
            "bronzeActiveEntities": brz[0]["cnt"] if brz else 0,
            "silverActiveEntities": slv[0]["cnt"] if slv else 0,
        }
    except Exception as e:
        log.warning("get_dashboard_stats failed: %s", e)
        return {}


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
