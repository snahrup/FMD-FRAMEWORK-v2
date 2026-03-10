"""
FMD v3 Engine REST API handlers.

Imported by dashboard/app/api/server.py and wired into the /api/engine/* routes.
Each handler receives the DashboardHandler instance (for writing responses),
plus the dashboard CONFIG dict and the query_sql function for DB access.

Architecture:
    - Engine singleton is created lazily on first /api/engine/* request
    - Engine runs in a background thread; the API never blocks
    - SSE log streaming uses a Condition-based broadcaster (same pattern as
      /api/deploy/stream in server.py)

Endpoints:
    GET  /api/engine/status         - Engine state + last run summary
    POST /api/engine/start          - Start a load run (background thread)
    POST /api/engine/stop           - Graceful stop
    GET  /api/engine/plan           - Dry-run plan
    GET  /api/engine/logs           - Task log query
    GET  /api/engine/logs/stream    - SSE real-time log stream
    POST /api/engine/retry          - Retry failed entities from a run
    POST /api/engine/abort-run      - Abort a run by ID (or all InProgress)
    GET  /api/engine/health         - Preflight health checks
    GET  /api/engine/metrics        - Aggregated metrics (last N hours)
    POST /api/engine/entity/*/reset - Reset entity watermark
    GET  /api/engine/runs           - Run history
"""

import json
import logging
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
from dataclasses import asdict
from typing import Optional

log = logging.getLogger("fmd.engine.api")

ENGINE_VERSION = "3.0.0"

# ---------------------------------------------------------------------------
# Engine singleton — thread-safe, lazy init
# ---------------------------------------------------------------------------

_engine = None                        # Optional[LoadOrchestrator]
_engine_lock = threading.Lock()
_engine_start_time: Optional[float] = None  # time.time() epoch
_run_thread: Optional[threading.Thread] = None


def _get_or_create_engine(dashboard_config: dict):
    """Lazy-init the LoadOrchestrator from the shared dashboard config.

    The dashboard CONFIG dict has the same structure that engine/config.py
    reads from config.json, so we build an EngineConfig directly rather
    than re-reading the file.
    """
    global _engine, _engine_start_time

    if _engine is not None:
        return _engine

    with _engine_lock:
        if _engine is not None:
            return _engine

        from engine.config import load_config
        from engine.orchestrator import LoadOrchestrator

        config = load_config()  # reads dashboard/app/api/config.json
        _engine = LoadOrchestrator(config)
        _engine_start_time = time.time()
        _install_sse_logging_hook()
        log.info("Engine singleton created (v%s)", ENGINE_VERSION)

        # Clean up orphaned "InProgress" runs from previous process crashes
        _cleanup_orphaned_runs()

        return _engine


# ---------------------------------------------------------------------------
# SSE Broadcaster — mirrors the _deploy_cond pattern in server.py
# ---------------------------------------------------------------------------

_sse_events: list[dict] = []          # append-only list of SSE event dicts
_sse_cond = threading.Condition()     # notifies waiting SSE listeners
_sse_max_events = 10_000              # cap memory; older events silently drop

# Active Fabric notebook jobs — keyed by job_id, stores info needed for cancel
_active_fabric_jobs: dict[str, dict] = {}   # {job_id: {notebook_id, workspace_id, layer, ...}}


class _SSEHook:
    """Injects into the engine's AuditLogger to broadcast events in real-time.

    The orchestrator's AuditLogger writes to SQL.  This hook additionally
    publishes each log entry as an SSE event so the dashboard can stream them.
    """

    @staticmethod
    def publish(event_type: str, data: dict) -> None:
        """Thread-safe publish of an SSE event."""
        evt = {
            "event": event_type,
            "data": data,
            "id": len(_sse_events),
            "ts": time.time(),
        }
        with _sse_cond:
            _sse_events.append(evt)
            # Trim if we exceed the cap (keep the last 80%)
            if len(_sse_events) > _sse_max_events:
                trim = _sse_max_events // 5
                del _sse_events[:trim]
            _sse_cond.notify_all()

    @staticmethod
    def clear() -> None:
        """Clear all events (called at the start of a new run)."""
        with _sse_cond:
            _sse_events.clear()


def _publish_log(level: str, message: str, **extra) -> None:
    """Convenience: publish a log-type SSE event."""
    _SSEHook.publish("log", {
        "level": level,
        "message": message,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ts": time.time(),
        **extra,
    })


# ---------------------------------------------------------------------------
# Logging handler that pipes Python log records to SSE
# ---------------------------------------------------------------------------

class _SSELoggingHandler(logging.Handler):
    """Captures Python log records from the engine and publishes them as SSE events.

    This bridges the gap between the orchestrator's logging (which uses Python's
    logging module) and the dashboard's SSE stream (which the frontend consumes).
    """

    LEVEL_MAP = {
        logging.DEBUG: "DEBUG",
        logging.INFO: "INFO",
        logging.WARNING: "WARN",
        logging.ERROR: "ERROR",
        logging.CRITICAL: "ERROR",
    }

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = self.LEVEL_MAP.get(record.levelno, "INFO")
            _publish_log(level, record.getMessage())
        except Exception:
            pass  # Never let logging crash the engine


_sse_logging_handler: _SSELoggingHandler | None = None


def _install_sse_logging_hook() -> None:
    """Install the SSE logging handler on all engine loggers.

    Called once when the engine singleton is created. Attaches to the 'fmd'
    root logger so all engine submodules (fmd.orchestrator, fmd.extractor, etc.)
    get their log records piped to the SSE stream automatically.
    """
    global _sse_logging_handler
    if _sse_logging_handler is not None:
        return  # Already installed

    _sse_logging_handler = _SSELoggingHandler()
    _sse_logging_handler.setLevel(logging.INFO)

    fmd_logger = logging.getLogger("fmd")
    fmd_logger.addHandler(_sse_logging_handler)
    # Ensure the root fmd logger doesn't filter out INFO
    if fmd_logger.level > logging.INFO or fmd_logger.level == logging.NOTSET:
        fmd_logger.setLevel(logging.INFO)

    log.info("SSE logging hook installed — engine logs now stream to dashboard")


def _publish_entity_result(run_id: str, entity_id: int, layer: str,
                           status: str, entity_name: str = None, **metrics) -> None:
    """Convenience: publish an entity result SSE event."""
    event = {
        "run_id": run_id,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "layer": layer,
        "status": status,
        **metrics,
    }
    _SSEHook.publish("entity_result", event)


# ---------------------------------------------------------------------------
# SQL helper — use dashboard's query_sql for stored proc calls
# ---------------------------------------------------------------------------

_query_sql = None   # set by handle_engine_request from server.py


def _exec_proc(proc: str, params: dict) -> list[dict]:
    """Call a stored proc via the dashboard's query_sql function.

    Builds EXEC [proc] @Param1=N'val1', @Param2=N'val2' ...
    Uses inline values (not parameterised) because the dashboard's query_sql
    only accepts a raw SQL string.
    """
    parts = []
    for key, val in params.items():
        if val is None:
            parts.append(f"@{key}=NULL")
        elif isinstance(val, (int, float)):
            parts.append(f"@{key}={val}")
        else:
            safe = str(val).replace("'", "''")
            parts.append(f"@{key}=N'{safe}'")
    sql = f"EXEC {proc} {', '.join(parts)}"
    return _query_sql(sql)


def _pipeline_preflight_check(target_layers: list[str]) -> list[str]:
    """Check that queue tables and entity activation are healthy before pipeline run.

    Returns a list of error strings. Empty list = all checks passed.
    """
    errors = []
    if _query_sql is None:
        errors.append("SQL connection not available — cannot verify queue tables")
        return errors

    try:
        if "bronze" in target_layers:
            # Check PipelineLandingzoneEntity has unprocessed rows
            rows = _query_sql(
                "SELECT COUNT(*) AS cnt FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 0"
            )
            lz_queue = rows[0]["cnt"] if rows else 0
            if lz_queue == 0:
                errors.append(
                    "Bronze queue empty: execution.PipelineLandingzoneEntity has 0 rows with IsProcessed=0. "
                    "The bronze notebook will find nothing to process."
                )

            # Check BronzeLayerEntity has active rows
            rows = _query_sql(
                "SELECT COUNT(*) AS cnt FROM integration.BronzeLayerEntity WHERE IsActive = 1"
            )
            active_bronze = rows[0]["cnt"] if rows else 0
            if active_bronze == 0:
                errors.append(
                    "No active Bronze entities: integration.BronzeLayerEntity has 0 rows with IsActive=1."
                )

        if "silver" in target_layers:
            # Check PipelineBronzeLayerEntity has unprocessed rows
            rows = _query_sql(
                "SELECT COUNT(*) AS cnt FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 0"
            )
            bronze_queue = rows[0]["cnt"] if rows else 0
            if bronze_queue == 0:
                errors.append(
                    "Silver queue empty: execution.PipelineBronzeLayerEntity has 0 rows with IsProcessed=0. "
                    "The silver notebook will find nothing to process."
                )

            # Check SilverLayerEntity has active rows
            rows = _query_sql(
                "SELECT COUNT(*) AS cnt FROM integration.SilverLayerEntity WHERE IsActive = 1"
            )
            active_silver = rows[0]["cnt"] if rows else 0
            if active_silver == 0:
                errors.append(
                    "No active Silver entities: integration.SilverLayerEntity has 0 rows with IsActive=1."
                )

    except Exception as exc:
        log.warning("Preflight check SQL error: %s", exc)
        # Don't block the run on preflight query failures — just warn
        _publish_log("warn", f"Preflight check query failed (non-blocking): {exc}")

    return errors


def _publish_run_summary(run_id: str, succeeded: int, failed: int,
                         skipped: int, total_rows: int,
                         duration_seconds: float) -> None:
    """Publish a run_complete SSE event so the dashboard updates live."""
    _SSEHook.publish("run_complete", {
        "run_id": run_id,
        "succeeded": succeeded,
        "failed": failed,
        "skipped": skipped,
        "total_rows": total_rows,
        "duration_seconds": round(duration_seconds, 1),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


def _cleanup_orphaned_runs() -> None:
    """Mark any InProgress runs as Aborted on engine startup.

    When the process crashes or reboots, log_run_end() never fires,
    leaving runs stuck as InProgress forever.  This cleans them up.
    """
    if _query_sql is None:
        return
    try:
        rows = _query_sql(
            "UPDATE execution.EngineRun "
            "SET Status = 'Aborted', "
            "    CompletedAtUtc = SYSUTCDATETIME(), "
            "    ErrorSummary = 'Aborted: engine process restarted before completion' "
            "OUTPUT inserted.RunId "
            "WHERE Status IN ('InProgress', 'running')"
        )
        if rows:
            count = len(rows)
            log.info("Cleaned up %d orphaned InProgress run(s) on startup", count)
            _publish_log("warning", f"Cleaned up {count} orphaned run(s) from previous session")
    except Exception as exc:
        log.warning("Failed to clean up orphaned runs: %s", exc)


# ---------------------------------------------------------------------------
# Route dispatcher — called from server.py's do_GET / do_POST
# ---------------------------------------------------------------------------

def handle_engine_request(handler, method: str, path: str,
                          config: dict, query_sql_fn) -> None:
    """Main entry point called by server.py for any /api/engine/* path.

    Parameters
    ----------
    handler : DashboardHandler
        The HTTP request handler instance (has _json_response, _error_response,
        wfile, headers, rfile, etc.)
    method : str
        'GET' or 'POST'
    path : str
        Full request path, e.g. '/api/engine/status?limit=10'
    config : dict
        Dashboard CONFIG dict (same as server.py's module-level CONFIG)
    query_sql_fn : callable
        Reference to server.py's query_sql() function
    """
    global _query_sql
    _query_sql = query_sql_fn

    # Parse path and query string
    parsed = urllib.parse.urlparse(path)
    sub_path = parsed.path.replace("/api/engine", "").rstrip("/") or "/"
    qs = urllib.parse.parse_qs(parsed.query)

    try:
        # ── GET routes ──
        if method == "GET":
            if sub_path == "/status":
                _handle_status(handler, config)
            elif sub_path == "/plan":
                _handle_plan(handler, config, qs)
            elif sub_path == "/logs/stream":
                _handle_logs_stream(handler)
                return  # SSE manages its own response lifecycle
            elif sub_path == "/logs":
                _handle_logs(handler, qs)
            elif sub_path == "/health":
                _handle_health(handler, config)
            elif sub_path == "/metrics":
                _handle_metrics(handler, qs)
            elif sub_path == "/runs":
                _handle_runs(handler, qs)
            elif sub_path == "/validation":
                _handle_validation(handler)
            elif sub_path == "/settings":
                _handle_settings_get(handler, config)
            elif sub_path == "/entities":
                _handle_entities(handler, config)
            elif sub_path == "/jobs":
                _handle_jobs(handler, config)
            else:
                handler._error_response(f"Unknown engine GET endpoint: {sub_path}", 404)

        # ── POST routes ──
        elif method == "POST":
            # Read body
            content_length = int(handler.headers.get("Content-Length", 0))
            body = json.loads(handler.rfile.read(content_length)) if content_length else {}

            if sub_path == "/start":
                _handle_start(handler, config, body)
            elif sub_path == "/stop":
                _handle_stop(handler, config)
            elif sub_path == "/retry":
                _handle_retry(handler, config, body)
            elif sub_path == "/abort-run":
                _handle_abort_run(handler, config, body)
            elif sub_path == "/settings":
                _handle_settings_post(handler, config, body)
            elif sub_path.startswith("/entity/") and sub_path.endswith("/reset"):
                # /api/engine/entity/123/reset
                entity_id_str = sub_path.split("/entity/")[1].split("/reset")[0]
                try:
                    entity_id = int(entity_id_str)
                except ValueError:
                    handler._error_response(f"Invalid entity ID: {entity_id_str}", 400)
                    return
                _handle_entity_reset(handler, entity_id)
            else:
                handler._error_response(f"Unknown engine POST endpoint: {sub_path}", 404)

        else:
            handler._error_response(f"Method {method} not allowed", 405)

    except Exception as exc:
        log.exception("Engine API error on %s %s", method, path)
        handler._error_response(str(exc), 500)


# ---------------------------------------------------------------------------
# GET /api/engine/status
# ---------------------------------------------------------------------------

def _handle_status(handler, config: dict) -> None:
    """Return engine state, uptime, and last run summary."""
    engine = _get_or_create_engine(config)

    response = {
        "status": engine.status,
        "current_run_id": engine.current_run_id,
        "uptime_seconds": round(time.time() - _engine_start_time, 1) if _engine_start_time else 0,
        "engine_version": ENGINE_VERSION,
        "load_method": engine._load_method,
        "pipeline_fallback": engine._pipeline_fallback,
        "pipeline_configured": bool(engine.config.pipeline_copy_sql_id),
        "last_run": None,
    }

    # Query last run from SQL
    try:
        rows = _exec_proc("[execution].[sp_GetEngineRuns]", {"Limit": 1})
        if rows:
            row = rows[0]
            response["last_run"] = {
                "run_id": str(row.get("RunId", "")),
                "status": str(row.get("Status", "")),
                "mode": str(row.get("Mode", "")),
                "started": str(row.get("StartedAtUtc", "")),
                "completed": str(row.get("CompletedAtUtc", "")),
                "total": _to_int(row.get("TotalEntities")),
                "succeeded": _to_int(row.get("SucceededEntities")),
                "failed": _to_int(row.get("FailedEntities")),
                "skipped": _to_int(row.get("SkippedEntities")),
                "total_rows": _to_int(row.get("TotalRowsRead")),
                "duration_seconds": _to_float(row.get("TotalDurationSeconds")),
                "layers": str(row.get("Layers", "")),
                "triggered_by": str(row.get("TriggeredBy", "")),
                "elapsed_seconds": _to_int(row.get("ElapsedSeconds")),
            }
    except Exception as exc:
        log.warning("Failed to query last run: %s", exc)

    # Fallback: derive last_run from notebook copy-activity data
    if response["last_run"] is None:
        try:
            copy_runs = _query_sql(
                "SELECT TOP 1 "
                "CONVERT(NVARCHAR(36), PipelineRunGuid) AS RunGuid, "
                "CopyActivityName, "
                "MIN(LogDateTime) AS StartTime, "
                "MAX(LogDateTime) AS EndTime, "
                "SUM(CASE WHEN LogType LIKE 'End%' THEN 1 ELSE 0 END) AS Ended, "
                "SUM(CASE WHEN LogType LIKE 'Fail%' THEN 1 ELSE 0 END) AS Failed, "
                "SUM(CASE WHEN LogType LIKE 'Start%' THEN 1 ELSE 0 END) AS Started, "
                "COUNT(DISTINCT EntityId) AS EntityCount "
                "FROM logging.CopyActivityExecution "
                "GROUP BY PipelineRunGuid, CopyActivityName "
                "ORDER BY MIN(LogDateTime) DESC"
            )
            if copy_runs:
                cr = _safe_row(copy_runs[0])
                ended = int(cr.get("Ended", 0) or 0)
                failed = int(cr.get("Failed", 0) or 0)
                started = int(cr.get("Started", 0) or 0)
                total_ent = int(cr.get("EntityCount", 0) or 0)
                if started > ended + failed:
                    run_status = "running"
                elif failed > 0 and ended == 0:
                    run_status = "failed"
                elif failed > 0:
                    run_status = "completed_with_errors"
                else:
                    run_status = "completed"
                dur = None
                st = cr.get("StartTime", "")
                et = cr.get("EndTime", "")
                if st and et:
                    try:
                        from datetime import datetime as dt2
                        t0 = dt2.fromisoformat(str(st).replace('Z', ''))
                        t1 = dt2.fromisoformat(str(et).replace('Z', ''))
                        dur = (t1 - t0).total_seconds()
                    except Exception:
                        pass
                response["last_run"] = {
                    "run_id": cr.get("RunGuid", ""),
                    "status": run_status,
                    "mode": "notebook",
                    "started": str(st) if st else "",
                    "completed": str(et) if et else "",
                    "total": total_ent,
                    "succeeded": ended - failed,
                    "failed": failed,
                    "skipped": 0,
                    "total_rows": 0,
                    "duration_seconds": dur,
                    "layers": "Landingzone",
                    "triggered_by": cr.get("CopyActivityName", "Fabric Notebook"),
                    "elapsed_seconds": int(dur) if dur else 0,
                }
        except Exception as e2:
            log.warning("Fallback copy-activity status query failed: %s", e2)

    handler._json_response(response)


# ---------------------------------------------------------------------------
# Fabric notebook trigger (for Pipeline mode)
# ---------------------------------------------------------------------------

_fabric_token_cache: dict = {}

def _get_fabric_token(config: dict) -> str:
    """Get a Fabric API token using SP credentials from the dashboard config."""
    cached = _fabric_token_cache.get("fabric")
    if cached and cached["expires"] > time.time():
        return cached["token"]

    tenant_id = config["fabric"]["tenant_id"]
    client_id = config["fabric"]["client_id"]
    client_secret = config["fabric"]["client_secret"]
    scope = "https://api.fabric.microsoft.com/.default"

    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": scope,
        "grant_type": "client_credentials",
    }).encode()
    req = urllib.request.Request(
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        data=data, method="POST",
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    _fabric_token_cache["fabric"] = {
        "token": resp["access_token"],
        "expires": time.time() + resp.get("expires_in", 3600) - 60,
    }
    return resp["access_token"]


def _trigger_fabric_notebook(config: dict, notebook_id: str,
                             lakehouse_name: str, lakehouse_id: str,
                             parameters: dict | None = None) -> dict:
    """Trigger a Fabric notebook via REST API.

    Parameters
    ----------
    parameters : dict or None
        Fabric executionData.parameters format for the RunNotebook API:
        {"ParamName": {"value": "...", "type": "string"}}
        If provided, these are passed to the notebook. If None, only the
        lakehouse configuration is sent.

    Returns dict with job_id on success, or raises on failure.
    """
    code_ws = config["fabric"]["workspace_code_id"]
    data_ws = config["fabric"]["workspace_data_id"]

    if not notebook_id:
        raise ValueError(f"Notebook ID not configured for {lakehouse_name}")

    token = _get_fabric_token(config)
    url = (
        f"https://api.fabric.microsoft.com/v1/workspaces/{code_ws}"
        f"/items/{notebook_id}/jobs/instances?jobType=RunNotebook"
    )

    execution_data: dict = {
        "configuration": {
            "defaultLakehouse": {
                "name": lakehouse_name,
                "id": lakehouse_id,
                "workspaceId": data_ws,
            }
        }
    }
    if parameters:
        execution_data["parameters"] = parameters

    payload = json.dumps({"executionData": execution_data}).encode()

    req = urllib.request.Request(url, method="POST", data=payload,
                                headers={"Authorization": f"Bearer {token}",
                                         "Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        location = resp.headers.get("Location", "")
        job_id = location.rstrip("/").split("/")[-1] if location else ""
        log.info("Notebook triggered: %s notebook=%s job=%s",
                 lakehouse_name, notebook_id[:8], job_id[:8])
        return {"job_id": job_id, "notebook_id": notebook_id, "location": location}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        log.error("Notebook trigger failed (%s): %s — %s",
                  lakehouse_name, e.code, body[:300])
        raise ValueError(f"Fabric API error {e.code}: {body[:300]}")


# Layer → lakehouse config key, lakehouse name
_LAYER_LAKEHOUSE_MAP = {
    "landing": ("lz_lakehouse_id",     "LH_DATA_LANDINGZONE"),
    "bronze":  ("bronze_lakehouse_id", "LH_DATA_BRONZE"),
    "silver":  ("silver_lakehouse_id", "LH_DATA_SILVER"),
}

# Display names for dynamic resolution from Fabric API (no hardcoded GUIDs)
_LAYER_NOTEBOOK_DISPLAY_NAME = {
    "landing": "NB_FMD_LOAD_LANDINGZONE_MAIN",
    "bronze":  "NB_FMD_PROCESSING_PARALLEL_MAIN",
    "silver":  "NB_FMD_PROCESSING_PARALLEL_MAIN",
}

# Stored procs for FETCH_FROM_SQL signal (bronze/silver use the processing notebook)
_LAYER_ENTITY_PROC = {
    "bronze": "[execution].[sp_GetBronzelayerEntity]",
    "silver": "[execution].[sp_GetSilverlayerEntity]",
}

# Cache for dynamically resolved notebook IDs: {display_name: fabric_item_id}
_notebook_id_cache: dict[str, str] = {}

def _resolve_notebook_id(config: dict, display_name: str) -> str:
    """Resolve a notebook display name to its Fabric item ID dynamically.

    Uses a module-level cache so we only hit the Fabric API once per name.
    """
    if display_name in _notebook_id_cache:
        return _notebook_id_cache[display_name]

    code_ws = config.get("fabric", {}).get("workspace_code_id", "")
    if not code_ws:
        log.error("Cannot resolve notebook '%s': workspace_code_id not set", display_name)
        return ""

    try:
        token = _get_fabric_token(config)
        url = f"https://api.fabric.microsoft.com/v1/workspaces/{code_ws}/items?type=Notebook"
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        })
        resp = json.loads(urllib.request.urlopen(req, timeout=30).read())

        # Cache ALL notebooks from the response (one API call resolves everything)
        for item in resp.get("value", []):
            _notebook_id_cache[item["displayName"]] = item["id"]

        nb_id = _notebook_id_cache.get(display_name, "")
        if nb_id:
            log.info("Resolved notebook '%s' → %s", display_name, nb_id)
        else:
            log.warning("Notebook '%s' not found in CODE workspace %s", display_name, code_ws[:8])
        return nb_id

    except Exception as exc:
        log.error("Failed to resolve notebook '%s': %s", display_name, exc)
        return ""


# ---------------------------------------------------------------------------
# POST /api/engine/start
# ---------------------------------------------------------------------------

def _handle_start(handler, config: dict, body: dict) -> None:
    """Start the engine in a background thread."""
    global _run_thread

    engine = _get_or_create_engine(config)

    if engine.status == "running":
        handler._json_response({
            "error": "Engine is already running",
            "current_run_id": engine.current_run_id,
        }, status=409)
        return

    mode = body.get("mode", "run")
    layers = body.get("layers")       # list or None
    entity_ids = body.get("entity_ids")  # list or None
    triggered_by = body.get("triggered_by", "dashboard")
    load_method = body.get("load_method")         # "local" | "pipeline" | None
    pipeline_fallback = body.get("pipeline_fallback")  # bool | None

    # Clear SSE events from previous run
    _SSEHook.clear()

    effective_method = load_method or engine.config.load_method
    _publish_log("info", f"Engine starting: mode={mode}, layers={layers}, "
                 f"entity_ids={'all' if not entity_ids else len(entity_ids)}, "
                 f"load_method={effective_method}, "
                 f"triggered_by={triggered_by}")

    # ── Pipeline mode: trigger Fabric notebook(s) based on selected layers ──
    if effective_method == "pipeline" and mode == "run":
        import uuid as _uuid
        run_id = str(_uuid.uuid4())
        target_layers = layers or ["landing", "bronze", "silver"]
        layer_str = ",".join(target_layers)
        triggered = []
        errors = []

        # Pre-flight: check queue tables aren't empty for requested layers
        _preflight_errors = _pipeline_preflight_check(target_layers)
        if _preflight_errors:
            for pfe in _preflight_errors:
                _publish_log("error", pfe)
            handler._json_response({
                "error": "Pre-flight check failed",
                "details": _preflight_errors,
                "suggestion": "Run scripts/fix_bronze_silver_queue.py to populate queue tables and activate entities.",
            }, status=400)
            return

        for layer in target_layers:
            lh_cfg = _LAYER_LAKEHOUSE_MAP.get(layer)
            if not lh_cfg:
                errors.append(f"Unknown layer: {layer}")
                continue
            lh_key, lh_name = lh_cfg
            lakehouse_id = config["engine"].get(lh_key, "")

            # Resolve notebook ID dynamically from Fabric API by display name
            display_name = _LAYER_NOTEBOOK_DISPLAY_NAME.get(layer, "")
            notebook_id = _resolve_notebook_id(config, display_name)
            if not notebook_id:
                _publish_log("warn", f"Skipping {layer}: {display_name} not found in CODE workspace")
                continue

            # Bronze/Silver: pass FETCH_FROM_SQL parameters to the processing notebook
            nb_params = None
            entity_proc = _LAYER_ENTITY_PROC.get(layer)
            if entity_proc:
                fetch_signal = json.dumps([{
                    "path": "FETCH_FROM_SQL",
                    "params": {
                        "proc": entity_proc,
                        "layer": layer,
                        "count": "?",
                    },
                }])
                nb_params = {"Path": {"value": fetch_signal, "type": "string"}}
                _publish_log("info", f"{layer.capitalize()}: FETCH_FROM_SQL -> {entity_proc}")

            try:
                result = _trigger_fabric_notebook(config, notebook_id, lh_name, lakehouse_id, nb_params)
                _publish_log("info", f"{layer.capitalize()} notebook triggered -- "
                             f"job_id={result['job_id'][:12]}...")
                triggered.append({"layer": layer, **result})
                # Track active job so abort can cancel it via Fabric API
                if result.get("job_id"):
                    _active_fabric_jobs[result["job_id"]] = {
                        "notebook_id": notebook_id,
                        "workspace_id": config["fabric"]["workspace_code_id"],
                        "layer": layer,
                        "location": result.get("location", ""),
                    }
            except Exception as exc:
                log.exception("Failed to trigger %s notebook", layer)
                _publish_log("error", f"{layer.capitalize()} notebook trigger failed: {exc}")
                errors.append(f"{layer}: {exc}")

        if not triggered and errors:
            handler._json_response({"error": "; ".join(errors)}, status=500)
            return

        # ── Write SQL run record + set engine status ──
        total_entities = 0
        try:
            for layer in target_layers:
                entity_proc = _LAYER_ENTITY_PROC.get(layer)
                if entity_proc:
                    rows = _query_sql(f"EXEC {entity_proc}")
                    if rows and rows[0].get("NotebookParams"):
                        nb_json = rows[0]["NotebookParams"]
                        if nb_json and nb_json != "[]":
                            total_entities += len(json.loads(nb_json))
        except Exception:
            total_entities = 0

        _exec_proc("[execution].[sp_UpsertEngineRun]", {
            "RunId": run_id,
            "Mode": "run",
            "Status": "InProgress",
            "TotalEntities": total_entities or len(triggered),
            "Layers": layer_str,
            "TriggeredBy": triggered_by,
        })
        _publish_log("info", f"Run record {run_id[:8]} created (InProgress, {total_entities} entities)")

        # Set engine status so dashboard shows 'running'
        engine.status = "running"
        engine.current_run_id = run_id

        # ── Background poller: monitor Fabric jobs and update run record when done ──
        _run_start_time = time.time()

        def _poll_fabric_jobs():
            """Poll Fabric job status until all triggered notebooks complete."""
            poll_interval = 30  # seconds
            max_polls = 720     # 6 hours max
            polls = 0
            job_statuses = {}
            job_start_times = {t.get("job_id", ""): time.time() for t in triggered}

            while polls < max_polls:
                time.sleep(poll_interval)
                polls += 1
                all_done = True

                for t in triggered:
                    job_id = t.get("job_id", "")
                    if not job_id or job_statuses.get(job_id) in ("Completed", "Failed", "Cancelled"):
                        continue

                    location = t.get("location", "")
                    if not location:
                        job_statuses[job_id] = "Unknown"
                        continue

                    try:
                        token = _get_fabric_token(config)
                        req = urllib.request.Request(
                            location, headers={"Authorization": f"Bearer {token}"}
                        )
                        resp = urllib.request.urlopen(req, timeout=30)
                        body = json.loads(resp.read())
                        status = body.get("status", "Unknown")
                        job_statuses[job_id] = status

                        if status in ("Completed", "Failed", "Cancelled"):
                            layer = t.get("layer", "?")
                            elapsed = int(time.time() - job_start_times.get(job_id, _run_start_time))
                            _publish_log(
                                "info" if status == "Completed" else "error",
                                f"{layer.capitalize()} notebook {status.lower()} "
                                f"(job {job_id[:12]}, {elapsed}s)"
                            )
                        else:
                            all_done = False
                    except urllib.error.HTTPError as exc:
                        if exc.code == 202:
                            all_done = False  # still running
                        else:
                            log.warning("Job poll error (HTTP %d) for %s", exc.code, job_id[:8])
                            all_done = False
                    except Exception as exc:
                        log.warning("Job poll error for %s: %s", job_id[:8], exc)
                        all_done = False

                # Publish live job status every poll cycle so dashboard has visibility
                elapsed_total = int(time.time() - _run_start_time)
                job_summary = []
                for t in triggered:
                    jid = t.get("job_id", "")
                    layer = t.get("layer", "?")
                    st = job_statuses.get(jid, "InProgress")
                    elapsed_job = int(time.time() - job_start_times.get(jid, _run_start_time))
                    job_summary.append({
                        "job_id": jid,
                        "layer": layer,
                        "status": st,
                        "elapsed_seconds": elapsed_job,
                    })
                _SSEHook.publish("job_status", {
                    "run_id": run_id,
                    "elapsed_seconds": elapsed_total,
                    "jobs": job_summary,
                    "poll_number": polls,
                })

                if all_done:
                    break

            # ── Update run record with final status ──
            completed = sum(1 for s in job_statuses.values() if s == "Completed")
            failed = sum(1 for s in job_statuses.values() if s in ("Failed", "Cancelled"))
            final_status = "Succeeded" if failed == 0 and completed > 0 else "Failed"

            _exec_proc("[execution].[sp_UpsertEngineRun]", {
                "RunId": run_id,
                "Mode": "",
                "Status": final_status,
                "TotalEntities": total_entities,
                "SucceededEntities": completed,
                "FailedEntities": failed,
                "SkippedEntities": 0,
            })

            _publish_log("info", f"Pipeline run {run_id[:8]} {final_status} "
                         f"({completed} completed, {failed} failed)")

            # Clean up engine status
            engine.status = "idle"
            engine.current_run_id = None
            _active_fabric_jobs.clear()

            # Publish SSE completion event
            _publish_run_summary(
                run_id=run_id,
                succeeded=completed,
                failed=failed,
                skipped=0,
                total_rows=0,
                duration_seconds=polls * poll_interval,
            )

        poll_thread = threading.Thread(target=_poll_fabric_jobs, daemon=True,
                                       name=f"fabric-poll-{run_id[:8]}")
        poll_thread.start()

        handler._json_response({
            "run_id": run_id,
            "status": "started",
            "mode": "notebook",
            "notebooks_triggered": [t["layer"] for t in triggered],
            "errors": errors if errors else None,
        })
        return

    # Wire up live entity result callback BEFORE starting the run
    def _on_entity_result(run_id_str: str, result, entity=None) -> None:
        """Called by orchestrator after each entity finishes — publishes to SSE in real-time."""
        entity_name = None
        if entity:
            schema = entity.namespace or entity.source_schema
            entity_name = f"{schema}.{entity.source_name}"
        _publish_entity_result(
            run_id=run_id_str,
            entity_id=result.entity_id,
            entity_name=entity_name,
            layer=result.layer,
            status=result.status,
            rows_read=result.rows_read,
            rows_written=result.rows_written,
            duration_seconds=result.duration_seconds,
            error=result.error,
        )

    engine.on_entity_result = _on_entity_result

    def _run_wrapper():
        """Runs in a background thread. Catches all exceptions so the
        engine status always gets updated properly."""
        try:
            results = engine.run(
                mode=mode,
                entity_ids=entity_ids,
                layers=layers,
                triggered_by=triggered_by,
                load_method=load_method,
                pipeline_fallback=pipeline_fallback,
            )

            # Publish summary
            if isinstance(results, list):
                succeeded = sum(1 for r in results if r.status == "succeeded")
                failed = sum(1 for r in results if r.status == "failed")
                skipped = sum(1 for r in results if r.status == "skipped")
                total_rows = sum(r.rows_read for r in results)

                _publish_log("info", f"Run completed: {succeeded} succeeded, "
                             f"{failed} failed, {skipped} skipped, "
                             f"{total_rows} rows total")
                _SSEHook.publish("run_complete", {
                    "succeeded": succeeded,
                    "failed": failed,
                    "skipped": skipped,
                    "total_rows": total_rows,
                })
            else:
                # Plan mode returns a LoadPlan
                _publish_log("info", "Plan completed")
                _SSEHook.publish("plan_complete", results.to_dict() if hasattr(results, 'to_dict') else {})

        except Exception as exc:
            log.exception("Engine run failed")
            _publish_log("error", f"Run failed: {exc}")
            _SSEHook.publish("run_error", {"error": str(exc)})

    _run_thread = threading.Thread(target=_run_wrapper, name="fmd-engine-run", daemon=True)
    _run_thread.start()

    # Return immediately — the run proceeds in background
    handler._json_response({
        "run_id": engine.current_run_id,
        "status": "started",
        "mode": mode,
    })


# ---------------------------------------------------------------------------
# POST /api/engine/stop
# ---------------------------------------------------------------------------

def _handle_stop(handler, config: dict) -> None:
    """Hard stop — cancel pending work, abort the run in DB, reset to idle."""
    engine = _get_or_create_engine(config)

    if engine.status not in ("running", "stopping"):
        handler._json_response({
            "status": engine.status,
            "message": "Engine is not running",
        })
        return

    # Force-cancel in-flight futures
    engine.stop(force=True)

    # Abort the active run in DB
    run_id = engine.current_run_id
    if run_id and _query_sql:
        try:
            safe_id = str(run_id).replace("'", "''")
            _query_sql(
                f"UPDATE execution.EngineRun "
                f"SET Status = 'Aborted', "
                f"    CompletedAtUtc = SYSUTCDATETIME(), "
                f"    ErrorSummary = 'Stopped by user from dashboard' "
                f"WHERE RunId = '{safe_id}' AND Status IN ('InProgress', 'running')"
            )
        except Exception as exc:
            log.warning("Failed to abort run in DB on stop: %s", exc)

    # Reset engine state
    engine.status = "idle"
    engine.current_run_id = None

    _publish_log("warning", "Engine force-stopped by user")
    handler._json_response({"status": "stopped", "run_id": run_id})


# ---------------------------------------------------------------------------
# POST /api/engine/abort-run
# ---------------------------------------------------------------------------

def _cancel_fabric_jobs(config: dict) -> int:
    """Cancel all tracked active Fabric notebook jobs. Returns count cancelled."""
    if not _active_fabric_jobs:
        return 0

    cancelled = 0
    to_remove = []
    for job_id, info in _active_fabric_jobs.items():
        ws_id = info["workspace_id"]
        nb_id = info["notebook_id"]
        layer = info.get("layer", "?")
        try:
            token = _get_fabric_token(config)
            cancel_url = (
                f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}"
                f"/items/{nb_id}/jobs/instances/{job_id}/cancel"
            )
            req = urllib.request.Request(
                cancel_url, method="POST",
                headers={"Authorization": f"Bearer {token}"},
                data=b"",
            )
            urllib.request.urlopen(req, timeout=15)
            log.info("Cancelled Fabric %s notebook job %s", layer, job_id[:12])
            _publish_log("info", f"Cancelled {layer} notebook job in Fabric ({job_id[:12]}...)")
            cancelled += 1
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:200]
            if e.code == 404:
                log.info("Fabric job %s already completed (404)", job_id[:12])
            else:
                log.warning("Failed to cancel Fabric job %s: %s %s", job_id[:12], e.code, body)
                _publish_log("warn", f"Could not cancel {layer} notebook job: HTTP {e.code}")
        except Exception as exc:
            log.warning("Failed to cancel Fabric job %s: %s", job_id[:12], exc)
        to_remove.append(job_id)

    for jid in to_remove:
        _active_fabric_jobs.pop(jid, None)
    return cancelled


def _handle_abort_run(handler, config: dict, body: dict) -> None:
    """Abort a specific run by ID (or all InProgress runs).

    Body: {"run_id": "..."} or {"all": true}
    Updates the DB status to 'Aborted' and sets CompletedAtUtc.
    If the run is currently active, also sends a stop signal to the engine.
    Also cancels any active Fabric notebook jobs via the Fabric REST API.
    """
    run_id = body.get("run_id")
    abort_all = body.get("all", False)

    if not run_id and not abort_all:
        handler._error_response("run_id or all:true is required", 400)
        return

    try:
        if abort_all:
            rows = _query_sql(
                "UPDATE execution.EngineRun "
                "SET Status = 'Aborted', "
                "    CompletedAtUtc = SYSUTCDATETIME(), "
                "    ErrorSummary = CASE WHEN ErrorSummary IS NULL OR ErrorSummary = '' "
                "        THEN 'Aborted by user' ELSE ErrorSummary END "
                "OUTPUT inserted.RunId "
                "WHERE Status IN ('InProgress', 'running')"
            )
            count = len(rows) if rows else 0
        else:
            safe_id = str(run_id).replace("'", "''")
            rows = _query_sql(
                f"UPDATE execution.EngineRun "
                f"SET Status = 'Aborted', "
                f"    CompletedAtUtc = SYSUTCDATETIME(), "
                f"    ErrorSummary = CASE WHEN ErrorSummary IS NULL OR ErrorSummary = '' "
                f"        THEN 'Aborted by user' ELSE ErrorSummary END "
                f"OUTPUT inserted.RunId "
                f"WHERE RunId = '{safe_id}'"
            )
            count = len(rows) if rows else 0

        # If the currently active run was aborted, stop the engine too
        if _engine and _engine.status == "running":
            if abort_all or (run_id and _engine.current_run_id and
                           str(_engine.current_run_id).upper() == str(run_id).upper()):
                _engine.stop()
                _publish_log("warning", "Active run aborted by user")

        # Cancel any active Fabric notebook jobs
        fabric_cancelled = _cancel_fabric_jobs(config)

        _publish_log("info", f"Aborted {count} run(s)"
                     + (f", cancelled {fabric_cancelled} Fabric job(s)" if fabric_cancelled else ""))
        handler._json_response({
            "aborted": count,
            "fabric_cancelled": fabric_cancelled,
            "message": f"Aborted {count} run(s)"
                       + (f", cancelled {fabric_cancelled} Fabric notebook(s)" if fabric_cancelled else ""),
        })
    except Exception as exc:
        log.exception("Failed to abort run(s)")
        handler._error_response(str(exc), 500)


# ---------------------------------------------------------------------------
# GET /api/engine/plan
# ---------------------------------------------------------------------------

def _handle_plan(handler, config: dict, qs: dict) -> None:
    """Compute a dry-run plan without executing."""
    engine = _get_or_create_engine(config)

    if engine.status == "running":
        handler._json_response({
            "error": "Cannot plan while engine is running",
        }, status=409)
        return

    entity_ids_str = qs.get("entity_ids", [""])[0]
    entity_ids = None
    if entity_ids_str:
        entity_ids = [int(x) for x in entity_ids_str.split(",") if x.strip().isdigit()]

    layers_str = qs.get("layers", [""])[0]
    layers = [l.strip() for l in layers_str.split(",") if l.strip()] or None

    load_method = qs.get("load_method", [None])[0]
    pipeline_fallback_str = qs.get("pipeline_fallback", [None])[0]
    pipeline_fallback = None
    if pipeline_fallback_str is not None:
        pipeline_fallback = pipeline_fallback_str.lower() == "true"

    try:
        plan = engine.run(mode="plan", entity_ids=entity_ids, layers=layers,
                          load_method=load_method, pipeline_fallback=pipeline_fallback)
        handler._json_response(plan.to_dict() if hasattr(plan, "to_dict") else asdict(plan))
    except Exception as exc:
        log.exception("Plan failed")
        handler._error_response(str(exc), 500)


# ---------------------------------------------------------------------------
# GET /api/engine/logs
# ---------------------------------------------------------------------------

def _handle_logs(handler, qs: dict) -> None:
    """Query task logs from execution.sp_GetEngineTaskLogs."""
    params = {}

    run_id = qs.get("run_id", [None])[0]
    if run_id:
        params["RunId"] = run_id

    entity_id = qs.get("entity_id", [None])[0]
    if entity_id and str(entity_id).isdigit():
        params["EntityId"] = int(entity_id)

    layer = qs.get("layer", [None])[0]
    if layer:
        params["Layer"] = layer

    status = qs.get("status", [None])[0]
    if status:
        params["Status"] = status

    limit = qs.get("limit", ["100"])[0]
    params["Limit"] = int(limit) if str(limit).isdigit() else 100

    offset = qs.get("offset", ["0"])[0]
    params["Offset"] = int(offset) if str(offset).isdigit() else 0

    try:
        rows = _exec_proc("[execution].[sp_GetEngineTaskLogs]", params)
        safe_rows = [_safe_row(r) for r in rows]
    except Exception:
        safe_rows = []

    # Fallback: derive task logs from CopyActivityExecution
    if not safe_rows:
        try:
            lim = int(params.get("Limit", 100))
            conditions = ["1=1"]
            if entity_id and str(entity_id).isdigit():
                conditions.append(f"ca.EntityId = {int(entity_id)}")
            if run_id:
                conditions.append(
                    f"CONVERT(NVARCHAR(36), ca.PipelineRunGuid) = '{run_id}'"
                )
            if layer:
                conditions.append(f"ca.CopyActivityName LIKE '%{layer}%'")
            if status == "failed":
                conditions.append("ca.LogType LIKE 'Fail%'")
            elif status == "succeeded":
                conditions.append("ca.LogType LIKE 'End%'")
            where = " AND ".join(conditions)
            fb_rows = _query_sql(
                f"SELECT TOP {lim} "
                f"ca.EntityId, "
                f"le.SourceName, "
                f"ds.Name AS DataSourceName, "
                f"'Landingzone' AS Layer, "
                f"CASE WHEN ca.LogType LIKE 'End%' THEN 'succeeded' "
                f"     WHEN ca.LogType LIKE 'Fail%' THEN 'failed' "
                f"     ELSE 'running' END AS Status, "
                f"ca.LogDateTime AS StartedAtUtc, "
                f"0 AS DurationSeconds, "
                f"0 AS RowsRead, "
                f"0 AS RowsPerSecond, "
                f"CASE WHEN ca.LogType LIKE 'Fail%' THEN 'CopyFailed' ELSE NULL END AS ErrorType, "
                f"CASE WHEN ca.LogType LIKE 'Fail%' "
                f"     THEN COALESCE(JSON_VALUE(ca.LogData, '$.error'), 'Copy activity failed') "
                f"     ELSE NULL END AS ErrorMessage, "
                f"CONVERT(NVARCHAR(36), ca.PipelineRunGuid) AS RunId "
                f"FROM logging.CopyActivityExecution ca "
                f"LEFT JOIN integration.LandingzoneEntity le ON ca.EntityId = le.LandingzoneEntityId "
                f"LEFT JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId "
                f"WHERE {where} "
                f"ORDER BY ca.LogDateTime DESC"
            )
            safe_rows = [_safe_row(r) for r in fb_rows]
        except Exception as e2:
            log.warning("Fallback copy-activity logs query failed: %s", e2)

    handler._json_response({"logs": safe_rows, "count": len(safe_rows)})


# ---------------------------------------------------------------------------
# GET /api/engine/logs/stream  (SSE)
# ---------------------------------------------------------------------------

def _handle_logs_stream(handler) -> None:
    """Stream engine events via Server-Sent Events.

    Replicates the exact SSE pattern from _sse_deploy_stream in server.py:
      - Replay existing events for late joiners
      - Wait on a Condition with 15s keepalive timeout
      - Terminate on run_complete / run_error events
    """
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Connection", "keep-alive")
    handler._cors()
    handler.end_headers()

    cursor = 0
    try:
        # Replay existing events (late joiner catch-up)
        with _sse_cond:
            for evt in _sse_events[cursor:]:
                line = f"event: {evt['event']}\ndata: {json.dumps(evt['data'])}\nid: {evt['id']}\n\n"
                handler.wfile.write(line.encode())
            cursor = len(_sse_events)
        handler.wfile.flush()

        # Stream new events as they arrive
        while True:
            with _sse_cond:
                while cursor >= len(_sse_events):
                    _sse_cond.wait(timeout=15)
                    if cursor >= len(_sse_events):
                        # Send keepalive comment
                        try:
                            handler.wfile.write(b": keepalive\n\n")
                            handler.wfile.flush()
                        except (BrokenPipeError, ConnectionResetError):
                            return
                new_events = _sse_events[cursor:]
                cursor = len(_sse_events)

            for evt in new_events:
                line = f"event: {evt['event']}\ndata: {json.dumps(evt['data'])}\nid: {evt['id']}\n\n"
                handler.wfile.write(line.encode())
            handler.wfile.flush()

            # Stop streaming on terminal events
            if any(e["event"] in ("run_complete", "run_error", "plan_complete")
                   for e in new_events):
                break

    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        pass  # Client disconnected


# ---------------------------------------------------------------------------
# POST /api/engine/retry
# ---------------------------------------------------------------------------

def _handle_retry(handler, config: dict, body: dict) -> None:
    """Retry failed entities from a previous run.

    Body: {"run_id": "...", "entity_ids": [1,2], "layers": ["landing"]}
    If entity_ids not provided, queries all failed entities from that run.
    """
    global _run_thread

    engine = _get_or_create_engine(config)

    if engine.status == "running":
        handler._json_response({
            "error": "Engine is already running",
            "current_run_id": engine.current_run_id,
        }, status=409)
        return

    run_id = body.get("run_id")
    entity_ids = body.get("entity_ids")
    layers = body.get("layers")

    # If no explicit entity_ids, query failed ones from the run
    if not entity_ids and run_id:
        try:
            rows = _exec_proc("[execution].[sp_GetEngineTaskLogs]", {
                "RunId": run_id,
                "Status": "failed",
                "Limit": 10000,
                "Offset": 0,
            })
            entity_ids = list(set(int(r["EntityId"]) for r in rows if r.get("EntityId")))
        except Exception as exc:
            handler._error_response(f"Failed to query failed entities: {exc}", 500)
            return

    if not entity_ids:
        handler._json_response({
            "error": "No failed entities found to retry",
            "run_id": run_id,
        }, status=404)
        return

    # Clear SSE events and start retry run
    _SSEHook.clear()
    _publish_log("info", f"Retrying {len(entity_ids)} entities from run {run_id}")

    # Wire up live callback for retries too
    def _on_retry_result(run_id_str: str, result, entity=None) -> None:
        entity_name = None
        if entity:
            schema = entity.namespace or entity.source_schema
            entity_name = f"{schema}.{entity.source_name}"
        _publish_entity_result(
            run_id=run_id_str,
            entity_id=result.entity_id,
            entity_name=entity_name,
            layer=result.layer,
            status=result.status,
            rows_read=result.rows_read,
            rows_written=result.rows_written,
            duration_seconds=result.duration_seconds,
            error=result.error,
        )

    engine.on_entity_result = _on_retry_result

    def _retry_wrapper():
        try:
            results = engine.run(
                mode="run",
                entity_ids=entity_ids,
                layers=layers,
                triggered_by="retry",
            )
            if isinstance(results, list):
                succeeded = sum(1 for r in results if r.status == "succeeded")
                failed = sum(1 for r in results if r.status == "failed")
                _publish_log("info", f"Retry completed: {succeeded} succeeded, {failed} failed")
                _SSEHook.publish("run_complete", {
                    "succeeded": succeeded,
                    "failed": failed,
                    "total_rows": sum(r.rows_read for r in results),
                })
        except Exception as exc:
            log.exception("Retry run failed")
            _publish_log("error", f"Retry failed: {exc}")
            _SSEHook.publish("run_error", {"error": str(exc)})

    _run_thread = threading.Thread(target=_retry_wrapper, name="fmd-engine-retry", daemon=True)
    _run_thread.start()

    handler._json_response({
        "run_id": engine.current_run_id,
        "status": "started",
        "retrying": len(entity_ids),
        "entity_ids": entity_ids,
    })


# ---------------------------------------------------------------------------
# GET /api/engine/health
# ---------------------------------------------------------------------------

def _handle_jobs(handler, config: dict) -> None:
    """GET /api/engine/jobs — Live Fabric notebook job status.

    Returns the current state of any active Fabric jobs plus recent history,
    so the dashboard can show real-time progress without waiting for SSE.
    """
    engine = _get_or_create_engine(config)
    active_jobs = []
    run_start = getattr(engine, '_pipeline_run_start', None)

    for job_id, info in _active_fabric_jobs.items():
        elapsed = int(time.time() - run_start) if run_start else 0
        active_jobs.append({
            "job_id": job_id,
            "layer": info.get("layer", "?"),
            "notebook_id": info.get("notebook_id", ""),
            "status": "InProgress",
            "elapsed_seconds": elapsed,
        })

    # Query recent Fabric job history from SQL if available
    recent_runs = []
    try:
        recent_runs = _query_sql("""
            SELECT TOP 5 RunId, Mode, Status, TotalEntities,
                   SucceededEntities, FailedEntities, StartedAtUtc, CompletedAtUtc,
                   Layers, TriggeredBy
            FROM [execution].[EngineRun]
            ORDER BY StartedAtUtc DESC
        """) or []
    except Exception:
        pass

    handler._json_response({
        "engine_status": engine.status,
        "current_run_id": engine.current_run_id,
        "active_fabric_jobs": active_jobs,
        "recent_runs": recent_runs,
    })


def _handle_health(handler, config: dict) -> None:
    """Run preflight health checks and return the report."""
    engine = _get_or_create_engine(config)

    try:
        report = engine.preflight()
        result = report.to_dict()

        # Add pipeline queue health checks
        queue_warnings = _pipeline_preflight_check(["bronze", "silver"])
        if queue_warnings:
            existing = result.get("warnings", [])
            existing.extend(queue_warnings)
            result["warnings"] = existing

        handler._json_response(result)
    except Exception as exc:
        log.exception("Preflight failed")
        handler._error_response(str(exc), 500)


# ---------------------------------------------------------------------------
# GET /api/engine/metrics
# ---------------------------------------------------------------------------

def _handle_metrics(handler, qs: dict) -> None:
    """Query aggregated metrics from execution.sp_GetEngineMetrics.

    The stored proc returns multiple result sets, but query_sql only returns
    the first.  We call it once for run metrics, then do supplementary queries
    for layer breakdown and top errors.
    """
    hours = qs.get("hours", ["24"])[0]
    hours_int = int(hours) if str(hours).isdigit() else 24

    since_sql = f"DATEADD(HOUR, -{hours_int}, SYSUTCDATETIME())"

    # Try v3 engine metrics first
    run_metrics = []
    try:
        run_metrics = _exec_proc("[execution].[sp_GetEngineMetrics]", {"HoursBack": hours_int})
    except Exception:
        pass

    # Layer breakdown — try EngineTaskLog, fallback to notebook execution tables
    layer_metrics = []
    try:
        layer_metrics = _query_sql(f"""
            SELECT Layer,
                   COUNT(*) AS TotalTasks,
                   SUM(CASE WHEN Status = 'succeeded' THEN 1 ELSE 0 END) AS Succeeded,
                   SUM(CASE WHEN Status = 'failed' THEN 1 ELSE 0 END) AS Failed,
                   SUM(RowsRead) AS TotalRowsRead,
                   AVG(DurationSeconds) AS AvgDurationSeconds,
                   AVG(RowsPerSecond) AS AvgRowsPerSecond
            FROM [execution].[EngineTaskLog]
            WHERE StartedAtUtc >= {since_sql}
            GROUP BY Layer
        """)
    except Exception:
        pass
    if not layer_metrics:
        try:
            layer_metrics = _query_sql("""
                SELECT 'Landingzone' AS Layer,
                       COUNT(DISTINCT ple.LandingzoneEntityId) AS TotalTasks,
                       COUNT(DISTINCT ple.LandingzoneEntityId) AS Succeeded,
                       0 AS Failed,
                       0 AS TotalRowsRead,
                       0 AS AvgDurationSeconds,
                       0 AS AvgRowsPerSecond
                FROM execution.PipelineLandingzoneEntity ple
                UNION ALL
                SELECT 'Bronze' AS Layer,
                       COUNT(DISTINCT pbe.BronzeLayerEntityId) AS TotalTasks,
                       COUNT(DISTINCT pbe.BronzeLayerEntityId) AS Succeeded,
                       0 AS Failed,
                       0 AS TotalRowsRead,
                       0 AS AvgDurationSeconds,
                       0 AS AvgRowsPerSecond
                FROM execution.PipelineBronzeLayerEntity pbe
            """)
        except Exception:
            pass

    # Top 10 slowest — try EngineTaskLog, fallback to CopyActivityExecution
    slowest = []
    try:
        slowest = _query_sql(f"""
            SELECT TOP 10
                t.EntityId, le.SourceName, ds.Name AS DataSourceName,
                t.Layer, t.DurationSeconds, t.RowsRead, t.Status
            FROM [execution].[EngineTaskLog] t
            LEFT JOIN [integration].[LandingzoneEntity] le ON t.EntityId = le.LandingzoneEntityId
            LEFT JOIN [integration].[DataSource] ds ON le.DataSourceId = ds.DataSourceId
            WHERE t.StartedAtUtc >= {since_sql} AND t.Status = 'succeeded'
            ORDER BY t.DurationSeconds DESC
        """)
    except Exception:
        pass
    if not slowest:
        try:
            slowest = _query_sql(f"""
                SELECT TOP 10
                    ca.EntityId,
                    le.SourceName,
                    ds.Name AS DataSourceName,
                    'Landingzone' AS Layer,
                    DATEDIFF(SECOND,
                        MIN(CASE WHEN ca.LogType LIKE 'Start%' THEN ca.LogDateTime END),
                        MAX(ca.LogDateTime)
                    ) AS DurationSeconds,
                    0 AS RowsRead,
                    'succeeded' AS Status
                FROM logging.CopyActivityExecution ca
                LEFT JOIN integration.LandingzoneEntity le ON ca.EntityId = le.LandingzoneEntityId
                LEFT JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
                WHERE ca.LogDateTime >= {since_sql}
                  AND ca.LogType LIKE 'End%'
                GROUP BY ca.EntityId, le.SourceName, ds.Name
                ORDER BY DurationSeconds DESC
            """)
        except Exception:
            pass

    # Top 5 errors — try EngineTaskLog, fallback to CopyActivityExecution
    top_errors = []
    try:
        top_errors = _query_sql(f"""
            SELECT TOP 5
                ErrorType, ErrorMessage, COUNT(*) AS Occurrences
            FROM [execution].[EngineTaskLog]
            WHERE StartedAtUtc >= {since_sql} AND Status = 'failed'
            GROUP BY ErrorType, ErrorMessage
            ORDER BY COUNT(*) DESC
        """)
    except Exception:
        pass
    if not top_errors:
        try:
            top_errors = _query_sql(f"""
                SELECT TOP 5
                    'CopyFailed' AS ErrorType,
                    COALESCE(
                        JSON_VALUE(ca.LogData, '$.error'),
                        ca.CopyActivityName + ' failed'
                    ) AS ErrorMessage,
                    COUNT(*) AS Occurrences
                FROM logging.CopyActivityExecution ca
                WHERE ca.LogDateTime >= {since_sql}
                  AND ca.LogType LIKE 'Fail%'
                GROUP BY COALESCE(
                    JSON_VALUE(ca.LogData, '$.error'),
                    ca.CopyActivityName + ' failed'
                )
                ORDER BY COUNT(*) DESC
            """)
        except Exception:
            pass

    handler._json_response({
        "hours": hours_int,
        "runs": [_safe_row(r) for r in run_metrics] if run_metrics else [],
        "layers": [_safe_row(r) for r in layer_metrics] if layer_metrics else [],
        "slowest_entities": [_safe_row(r) for r in slowest] if slowest else [],
        "top_errors": [_safe_row(r) for r in top_errors] if top_errors else [],
    })


# ---------------------------------------------------------------------------
# POST /api/engine/entity/{id}/reset
# ---------------------------------------------------------------------------

def _handle_entity_reset(handler, entity_id: int) -> None:
    """Reset watermark for an entity by deleting its LastLoadValue record.

    This forces the next run to do a full load for this entity.
    """
    try:
        _query_sql(
            f"DELETE FROM [execution].[LandingzoneEntityLastLoadValue] "
            f"WHERE LandingzoneEntityId = {int(entity_id)}"
        )
        handler._json_response({
            "success": True,
            "entity_id": entity_id,
            "message": f"Watermark reset for entity {entity_id}. Next run will be full load.",
        })
    except Exception as exc:
        log.exception("Failed to reset entity %d", entity_id)
        handler._error_response(str(exc), 500)


# ---------------------------------------------------------------------------
# GET /api/engine/runs
# ---------------------------------------------------------------------------

def _handle_runs(handler, qs: dict) -> None:
    """Query run history from execution.sp_GetEngineRuns."""
    params = {}

    limit = qs.get("limit", ["20"])[0]
    params["Limit"] = int(limit) if str(limit).isdigit() else 20

    status = qs.get("status", [None])[0]
    if status:
        params["Status"] = status

    try:
        rows = _exec_proc("[execution].[sp_GetEngineRuns]", params)
        # Map PascalCase DB columns to snake_case frontend expects
        mapped = []
        for r in rows:
            sr = _safe_row(r)
            mapped.append({
                "run_id": sr.get("RunId", ""),
                "status": sr.get("Status", "unknown"),
                "mode": sr.get("Mode", "run"),
                "started_at": sr.get("StartedAtUtc", ""),
                "finished_at": sr.get("CompletedAtUtc"),
                "duration_seconds": sr.get("ElapsedSeconds") or sr.get("TotalDurationSeconds"),
                "entities_succeeded": sr.get("SucceededEntities", 0),
                "entities_failed": sr.get("FailedEntities", 0),
                "entities_skipped": sr.get("SkippedEntities", 0),
                "triggered_by": sr.get("TriggeredBy", ""),
                "total_rows": sr.get("TotalRowsRead", 0),
                "error_summary": sr.get("ErrorSummary"),
            })

        # Fallback: if no engine runs, derive runs from copy activity
        # (notebook runs directly, not via local engine)
        if not mapped:
            try:
                copy_runs = _query_sql(
                    "SELECT CONVERT(NVARCHAR(36), PipelineRunGuid) AS RunGuid, "
                    "CopyActivityName, "
                    "MIN(LogDateTime) AS StartTime, "
                    "MAX(LogDateTime) AS EndTime, "
                    "SUM(CASE WHEN LogType LIKE 'End%' THEN 1 ELSE 0 END) AS Ended, "
                    "SUM(CASE WHEN LogType LIKE 'Fail%' THEN 1 ELSE 0 END) AS Failed, "
                    "SUM(CASE WHEN LogType LIKE 'Start%' THEN 1 ELSE 0 END) AS Started, "
                    "COUNT(DISTINCT EntityId) AS EntityCount "
                    "FROM logging.CopyActivityExecution "
                    "GROUP BY PipelineRunGuid, CopyActivityName "
                    "ORDER BY MIN(LogDateTime) DESC"
                )
                for cr in copy_runs:
                    sr = _safe_row(cr)
                    ended = int(sr.get("Ended", 0) or 0)
                    failed = int(sr.get("Failed", 0) or 0)
                    started = int(sr.get("Started", 0) or 0)
                    total_ent = int(sr.get("EntityCount", 0) or 0)
                    # Determine status
                    if started > ended + failed:
                        run_status = "running"
                    elif failed > 0 and ended == 0:
                        run_status = "failed"
                    elif failed > 0:
                        run_status = "completed_with_errors"
                    else:
                        run_status = "completed"
                    # Duration
                    dur = None
                    st = sr.get("StartTime", "")
                    et = sr.get("EndTime", "")
                    if st and et:
                        try:
                            from datetime import datetime as dt2
                            t0 = dt2.fromisoformat(str(st).replace('Z', ''))
                            t1 = dt2.fromisoformat(str(et).replace('Z', ''))
                            dur = (t1 - t0).total_seconds()
                        except Exception:
                            pass
                    mapped.append({
                        "run_id": sr.get("RunGuid", ""),
                        "status": run_status,
                        "mode": "notebook",
                        "started_at": str(st) if st else "",
                        "finished_at": str(et) if et else None,
                        "duration_seconds": dur,
                        "entities_succeeded": ended - failed,
                        "entities_failed": failed,
                        "entities_skipped": 0,
                        "triggered_by": sr.get("CopyActivityName", "Fabric Notebook"),
                        "total_rows": 0,
                        "error_summary": None,
                    })
            except Exception as e2:
                log.warning(f"Fallback copy-activity run query failed: {e2}")

        handler._json_response({"runs": mapped, "count": len(mapped)})
    except Exception as exc:
        log.exception("Failed to query engine runs")
        handler._error_response(str(exc), 500)


# ---------------------------------------------------------------------------
# GET /api/engine/validation
# ---------------------------------------------------------------------------

def _handle_validation(handler) -> None:
    """Return entity load status across all layers, grouped by source.

    This powers the Validation Checklist dashboard page — the concrete
    before/after proof that v3 fixed everything.
    """
    try:
        # Overview by source
        overview = _query_sql("""
            SELECT
                ds.Name AS DataSource,
                COUNT(*) AS TotalEntities,
                SUM(CASE WHEN le.IsActive = 1 THEN 1 ELSE 0 END) AS Active,
                SUM(CASE WHEN le.IsActive = 0 THEN 1 ELSE 0 END) AS Inactive
            FROM integration.LandingzoneEntity le
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            GROUP BY ds.Name
            ORDER BY ds.Name
        """)

        # Layer status per source (LZ)
        # Use existence of a row (not IsProcessed flag) to determine "loaded"
        # — matches logic in execution.vw_LZ_LoadStatus
        lz_status = _query_sql("""
            SELECT
                ds.Name AS DataSource,
                SUM(CASE WHEN ple.LandingzoneEntityId IS NOT NULL THEN 1 ELSE 0 END) AS LzLoaded,
                0 AS LzFailed,
                SUM(CASE WHEN ple.LandingzoneEntityId IS NULL THEN 1 ELSE 0 END) AS LzNeverAttempted
            FROM integration.LandingzoneEntity le
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            LEFT JOIN (
                SELECT DISTINCT LandingzoneEntityId
                FROM execution.PipelineLandingzoneEntity
            ) ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
            WHERE le.IsActive = 1
            GROUP BY ds.Name
            ORDER BY ds.Name
        """)

        # Bronze status per source
        bronze_status = _query_sql("""
            SELECT
                ds.Name AS DataSource,
                SUM(CASE WHEN pbe.BronzeLayerEntityId IS NOT NULL THEN 1 ELSE 0 END) AS BronzeLoaded,
                0 AS BronzeFailed,
                SUM(CASE WHEN pbe.BronzeLayerEntityId IS NULL THEN 1 ELSE 0 END) AS BronzeNeverAttempted
            FROM integration.LandingzoneEntity le
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            JOIN integration.BronzeLayerEntity ble ON le.LandingzoneEntityId = ble.LandingzoneEntityId
            LEFT JOIN (
                SELECT DISTINCT BronzeLayerEntityId
                FROM execution.PipelineBronzeLayerEntity
            ) pbe ON ble.BronzeLayerEntityId = pbe.BronzeLayerEntityId
            WHERE le.IsActive = 1
            GROUP BY ds.Name
            ORDER BY ds.Name
        """)

        # Silver status per source (table created on first Silver notebook run)
        try:
            silver_status = _query_sql("""
                SELECT
                    ds.Name AS DataSource,
                    SUM(CASE WHEN pse.SilverLayerEntityId IS NOT NULL THEN 1 ELSE 0 END) AS SilverLoaded,
                    0 AS SilverFailed,
                    SUM(CASE WHEN pse.SilverLayerEntityId IS NULL THEN 1 ELSE 0 END) AS SilverNeverAttempted
                FROM integration.LandingzoneEntity le
                JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
                JOIN integration.BronzeLayerEntity ble ON le.LandingzoneEntityId = ble.LandingzoneEntityId
                LEFT JOIN integration.SilverLayerEntity sle ON ble.BronzeLayerEntityId = sle.BronzeLayerEntityId
                LEFT JOIN (
                    SELECT DISTINCT SilverLayerEntityId
                    FROM execution.PipelineSilverLayerEntity
                ) pse ON sle.SilverLayerEntityId = pse.SilverLayerEntityId
                WHERE le.IsActive = 1
                GROUP BY ds.Name
                ORDER BY ds.Name
            """)
        except Exception:
            silver_status = []

        # Digest summary — try EntityStatusSummary first, fall back to computed
        try:
            digest = _query_sql("""
                SELECT OverallStatus, COUNT(*) AS EntityCount
                FROM execution.EntityStatusSummary
                GROUP BY OverallStatus
                ORDER BY EntityCount DESC
            """)
        except Exception:
            digest = []
        # If EntityStatusSummary is empty, compute from LZ + Bronze layer data
        # (Silver execution table may not exist yet)
        if not digest:
            try:
                digest = _query_sql("""
                    SELECT
                        CASE
                            WHEN lz.LandingzoneEntityId IS NOT NULL
                                 AND br.BronzeLayerEntityId IS NOT NULL THEN 'complete'
                            WHEN lz.LandingzoneEntityId IS NOT NULL THEN 'partial'
                            ELSE 'not_started'
                        END AS OverallStatus,
                        COUNT(*) AS EntityCount
                    FROM integration.LandingzoneEntity le
                    LEFT JOIN (
                        SELECT DISTINCT LandingzoneEntityId
                        FROM execution.PipelineLandingzoneEntity
                    ) lz ON le.LandingzoneEntityId = lz.LandingzoneEntityId
                    LEFT JOIN integration.BronzeLayerEntity ble
                        ON le.LandingzoneEntityId = ble.LandingzoneEntityId
                    LEFT JOIN (
                        SELECT DISTINCT BronzeLayerEntityId
                        FROM execution.PipelineBronzeLayerEntity
                    ) br ON ble.BronzeLayerEntityId = br.BronzeLayerEntityId
                    WHERE le.IsActive = 1
                    GROUP BY
                        CASE
                            WHEN lz.LandingzoneEntityId IS NOT NULL
                                 AND br.BronzeLayerEntityId IS NOT NULL THEN 'complete'
                            WHEN lz.LandingzoneEntityId IS NOT NULL THEN 'partial'
                            ELSE 'not_started'
                        END
                    ORDER BY EntityCount DESC
                """)
            except Exception:
                digest = []

        # Never-attempted entities (limited list for display)
        never_attempted = _query_sql("""
            SELECT TOP 50
                le.LandingzoneEntityId AS EntityId,
                ds.Name AS DataSource,
                le.SourceSchema,
                le.SourceName
            FROM integration.LandingzoneEntity le
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            LEFT JOIN execution.PipelineLandingzoneEntity ple
                ON le.LandingzoneEntityId = ple.LandingzoneEntityId
            WHERE le.IsActive = 1 AND ple.LandingzoneEntityId IS NULL
            ORDER BY ds.Name, le.SourceSchema, le.SourceName
        """)

        # Stuck at LZ — entities loaded to LZ but not yet processed through Bronze
        stuck_at_lz = _query_sql("""
            SELECT
                ds.Name AS DataSource,
                COUNT(DISTINCT le.LandingzoneEntityId) AS StuckCount
            FROM integration.LandingzoneEntity le
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            JOIN (
                SELECT DISTINCT LandingzoneEntityId
                FROM execution.PipelineLandingzoneEntity
            ) ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
            JOIN integration.BronzeLayerEntity ble
                ON le.LandingzoneEntityId = ble.LandingzoneEntityId
            LEFT JOIN (
                SELECT DISTINCT BronzeLayerEntityId
                FROM execution.PipelineBronzeLayerEntity
            ) pbe ON ble.BronzeLayerEntityId = pbe.BronzeLayerEntityId
            WHERE le.IsActive = 1
              AND pbe.BronzeLayerEntityId IS NULL
            GROUP BY ds.Name
            ORDER BY ds.Name
        """)

        # Per-entity layer status (the selectable table)
        # Use row existence (not IsProcessed) to determine loaded status
        try:
            entities = _query_sql("""
                SELECT
                    le.LandingzoneEntityId AS EntityId,
                    ds.Name AS DataSource,
                    le.SourceSchema,
                    le.SourceName,
                    le.IsIncremental,
                    CASE WHEN ple.LandingzoneEntityId IS NOT NULL THEN 1
                         ELSE -1 END AS LzStatus,
                    CASE WHEN pbe.BronzeLayerEntityId IS NOT NULL THEN 1
                         ELSE -1 END AS BronzeStatus,
                    CASE WHEN pse.SilverLayerEntityId IS NOT NULL THEN 1
                         ELSE -1 END AS SilverStatus
                FROM integration.LandingzoneEntity le
                JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
                LEFT JOIN (
                    SELECT DISTINCT LandingzoneEntityId
                    FROM execution.PipelineLandingzoneEntity
                ) ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
                LEFT JOIN integration.BronzeLayerEntity ble
                    ON le.LandingzoneEntityId = ble.LandingzoneEntityId
                LEFT JOIN (
                    SELECT DISTINCT BronzeLayerEntityId
                    FROM execution.PipelineBronzeLayerEntity
                ) pbe ON ble.BronzeLayerEntityId = pbe.BronzeLayerEntityId
                LEFT JOIN integration.SilverLayerEntity sle
                    ON ble.BronzeLayerEntityId = sle.BronzeLayerEntityId
                LEFT JOIN (
                    SELECT DISTINCT SilverLayerEntityId
                    FROM execution.PipelineSilverLayerEntity
                ) pse ON sle.SilverLayerEntityId = pse.SilverLayerEntityId
                WHERE le.IsActive = 1
                ORDER BY ds.Name, le.SourceSchema, le.SourceName
            """)
        except Exception:
            # PipelineSilverLayerEntity doesn't exist yet — query without it
            entities = _query_sql("""
                SELECT
                    le.LandingzoneEntityId AS EntityId,
                    ds.Name AS DataSource,
                    le.SourceSchema,
                    le.SourceName,
                    le.IsIncremental,
                    CASE WHEN ple.LandingzoneEntityId IS NOT NULL THEN 1
                         ELSE -1 END AS LzStatus,
                    CASE WHEN pbe.BronzeLayerEntityId IS NOT NULL THEN 1
                         ELSE -1 END AS BronzeStatus,
                    -1 AS SilverStatus
                FROM integration.LandingzoneEntity le
                JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
                LEFT JOIN (
                    SELECT DISTINCT LandingzoneEntityId
                    FROM execution.PipelineLandingzoneEntity
                ) ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
                LEFT JOIN integration.BronzeLayerEntity ble
                    ON le.LandingzoneEntityId = ble.LandingzoneEntityId
                LEFT JOIN (
                    SELECT DISTINCT BronzeLayerEntityId
                    FROM execution.PipelineBronzeLayerEntity
                ) pbe ON ble.BronzeLayerEntityId = pbe.BronzeLayerEntityId
                WHERE le.IsActive = 1
                ORDER BY ds.Name, le.SourceSchema, le.SourceName
            """)

        handler._json_response({
            "_version": "v2",
            "overview": [_safe_row(r) for r in overview],
            "lz_status": [_safe_row(r) for r in lz_status],
            "bronze_status": [_safe_row(r) for r in bronze_status],
            "silver_status": [_safe_row(r) for r in silver_status],
            "digest": [_safe_row(r) for r in digest],
            "never_attempted": [_safe_row(r) for r in never_attempted],
            "stuck_at_lz": [_safe_row(r) for r in stuck_at_lz],
            "entities": [_safe_row(r) for r in entities],
        })
    except Exception as exc:
        log.exception("Validation query failed")
        handler._error_response(str(exc), 500)


# ---------------------------------------------------------------------------
# GET /api/engine/settings
# ---------------------------------------------------------------------------

def _handle_settings_get(handler, config: dict) -> None:
    """Return current engine settings (load method, pipeline config)."""
    engine = _get_or_create_engine(config)
    handler._json_response({
        "load_method": engine._load_method,
        "pipeline_fallback": engine._pipeline_fallback,
        "pipeline_copy_sql_id": engine.config.pipeline_copy_sql_id,
        "pipeline_workspace_id": engine.config.pipeline_workspace_id,
        "pipeline_configured": bool(engine.config.pipeline_copy_sql_id),
        "batch_size": engine.config.batch_size,
    })


# ---------------------------------------------------------------------------
# POST /api/engine/settings
# ---------------------------------------------------------------------------

def _handle_settings_post(handler, config: dict, body: dict) -> None:
    """Update engine settings and persist to config.json."""
    import pathlib

    engine = _get_or_create_engine(config)

    # Update in-memory config
    if "load_method" in body:
        engine._load_method = body["load_method"]
        engine.config.load_method = body["load_method"]
    if "pipeline_fallback" in body:
        engine._pipeline_fallback = bool(body["pipeline_fallback"])
        engine.config.pipeline_fallback = bool(body["pipeline_fallback"])
    if "pipeline_copy_sql_id" in body:
        engine.config.pipeline_copy_sql_id = body["pipeline_copy_sql_id"]
        engine._pipeline_runner._pipeline_id = body["pipeline_copy_sql_id"]
    if "pipeline_workspace_id" in body:
        engine.config.pipeline_workspace_id = body["pipeline_workspace_id"]
        engine._pipeline_runner._workspace_id = (
            body["pipeline_workspace_id"] or engine.config.workspace_code_id
        )
    if "batch_size" in body:
        engine.config.batch_size = int(body["batch_size"])

    # Persist to config.json
    try:
        config_path = pathlib.Path(__file__).resolve().parent.parent / "dashboard" / "app" / "api" / "config.json"
        with open(config_path, encoding="utf-8") as f:
            cfg = json.load(f)

        eng_section = cfg.setdefault("engine", {})
        eng_section["load_method"] = engine._load_method
        eng_section["pipeline_fallback"] = engine._pipeline_fallback
        eng_section["pipeline_copy_sql_id"] = engine.config.pipeline_copy_sql_id
        eng_section["pipeline_workspace_id"] = engine.config.pipeline_workspace_id
        eng_section["batch_size"] = engine.config.batch_size

        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)

        log.info("Engine settings saved: load_method=%s, fallback=%s",
                 engine._load_method, engine._pipeline_fallback)
    except Exception as exc:
        log.warning("Failed to persist settings to config.json: %s", exc)

    handler._json_response({
        "success": True,
        "load_method": engine._load_method,
        "pipeline_fallback": engine._pipeline_fallback,
        "pipeline_configured": bool(engine.config.pipeline_copy_sql_id),
    })


# ---------------------------------------------------------------------------
# GET /api/engine/entities
# ---------------------------------------------------------------------------

def _handle_entities(handler, config: dict) -> None:
    """Return all active LZ entities for the manual reload selector."""
    try:
        rows = _query_sql("""
            SELECT
                le.LandingzoneEntityId AS entity_id,
                le.SourceSchema AS source_schema,
                le.SourceName AS source_name,
                COALESCE(NULLIF(ds.Namespace, ''), ds.Name) AS namespace,
                ds.Name AS datasource,
                c.DatabaseName AS source_database,
                le.IsIncremental AS is_incremental,
                lv.LastLoadDatetime AS last_loaded,
                CASE WHEN ple.IsProcessed = 1 THEN 'loaded'
                     WHEN ple.IsProcessed = 0 THEN 'pending'
                     ELSE 'never' END AS lz_status
            FROM integration.LandingzoneEntity le
            INNER JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            INNER JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
            LEFT JOIN execution.PipelineLandingzoneEntity ple
                ON le.LandingzoneEntityId = ple.LandingzoneEntityId
            LEFT JOIN execution.LandingzoneEntityLastLoadValue lv
                ON le.LandingzoneEntityId = lv.LandingzoneEntityId
            WHERE le.IsActive = 1
            ORDER BY ds.Name, le.SourceSchema, le.SourceName
        """)

        entities = []
        for r in rows:
            entities.append({
                "entity_id": int(r.get("entity_id", 0)),
                "source_schema": str(r.get("source_schema", "")),
                "source_name": str(r.get("source_name", "")),
                "namespace": str(r.get("namespace", "")),
                "datasource": str(r.get("datasource", "")),
                "source_database": str(r.get("source_database", "")),
                "is_incremental": bool(r.get("is_incremental", False)),
                "last_loaded": str(r.get("last_loaded", "")) if r.get("last_loaded") else None,
                "lz_status": str(r.get("lz_status", "never")),
            })

        handler._json_response({"entities": entities, "count": len(entities)})
    except Exception as exc:
        log.exception("Failed to query entities for selector")
        handler._error_response(str(exc), 500)


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------

def _safe_row(row: dict) -> dict:
    """Convert a SQL row dict to JSON-safe types.

    pyodbc returns datetime/Decimal/UUID objects that json.dumps can't handle.
    This converts everything to str/int/float/None.
    """
    safe = {}
    for k, v in row.items():
        if v is None:
            safe[k] = None
        elif isinstance(v, (int, float, bool)):
            safe[k] = v
        else:
            safe[k] = str(v)
    return safe


def _to_int(val) -> int:
    """Safely convert a value to int, defaulting to 0."""
    if val is None:
        return 0
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


def _to_float(val) -> float:
    """Safely convert a value to float, defaulting to 0.0."""
    if val is None:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0
