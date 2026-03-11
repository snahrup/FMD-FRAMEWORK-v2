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
                _handle_abort_run(handler, body)
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

    # Query last run — SQLite first, Fabric SQL fallback
    rows = None
    try:
        import control_plane_db as cpdb
        sqlite_runs = cpdb.get_engine_runs(limit=1)
        if sqlite_runs:
            rows = sqlite_runs
    except Exception:
        pass

    if rows is None:
        try:
            rows = _exec_proc("[execution].[sp_GetEngineRuns]", {"Limit": 1})
        except Exception as exc:
            log.warning("Failed to query last run: %s", exc)
            response["last_run"] = {"error": str(exc)}
            rows = None

    if rows:
        row = rows[0]
        response["last_run"] = {
            "run_id": str(row.get("RunId", "")),
            "status": str(row.get("Status", "")),
            "mode": str(row.get("Mode", "")),
            "started": str(row.get("StartedAtUtc") or row.get("StartedAt", "")),
            "completed": str(row.get("CompletedAtUtc") or row.get("EndedAt", "")),
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

    handler._json_response(response)


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

def _handle_abort_run(handler, body: dict) -> None:
    """Abort a specific run by ID (or all InProgress runs).

    Body: {"run_id": "..."} or {"all": true}
    Updates the DB status to 'Aborted' and sets CompletedAtUtc.
    If the run is currently active, also sends a stop signal to the engine.
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

        _publish_log("info", f"Aborted {count} run(s)")
        handler._json_response({
            "aborted": count,
            "message": f"Aborted {count} run(s)",
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

    try:
        plan = engine.run(mode="plan", entity_ids=entity_ids)
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
        # Convert all values to JSON-safe types
        safe_rows = [_safe_row(r) for r in rows]
        handler._json_response({"logs": safe_rows, "count": len(safe_rows)})
    except Exception as exc:
        log.exception("Failed to query task logs")
        handler._error_response(str(exc), 500)


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

def _handle_health(handler, config: dict) -> None:
    """Run preflight health checks and return the report."""
    try:
        engine = _get_or_create_engine(config)
        report = engine.preflight()
        handler._json_response(report.to_dict())
    except Exception as exc:
        log.warning("Preflight health check failed: %s", exc)
        handler._json_response({
            "checks": [{"name": "API Connectivity", "passed": False, "message": str(exc)}],
            "all_passed": False,
            "_error": str(exc),
        })


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

    try:
        # sp_GetEngineMetrics returns 4 result sets but query_sql gets the first
        # So we call it and also do follow-up queries for the other data
        run_metrics = _exec_proc("[execution].[sp_GetEngineMetrics]", {"HoursBack": hours_int})

        # Layer breakdown
        since_sql = f"DATEADD(HOUR, -{hours_int}, SYSUTCDATETIME())"
        layer_sql = f"""
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
        """
        layer_metrics = _query_sql(layer_sql)

        # Top 10 slowest
        slow_sql = f"""
            SELECT TOP 10
                t.EntityId, le.SourceName, ds.Name AS DataSourceName,
                t.Layer, t.DurationSeconds, t.RowsRead, t.Status
            FROM [execution].[EngineTaskLog] t
            LEFT JOIN [integration].[LandingzoneEntity] le ON t.EntityId = le.LandingzoneEntityId
            LEFT JOIN [integration].[DataSource] ds ON le.DataSourceId = ds.DataSourceId
            WHERE t.StartedAtUtc >= {since_sql} AND t.Status = 'succeeded'
            ORDER BY t.DurationSeconds DESC
        """
        slowest = _query_sql(slow_sql)

        # Top 5 errors
        errors_sql = f"""
            SELECT TOP 5
                ErrorType, ErrorMessage, COUNT(*) AS Occurrences
            FROM [execution].[EngineTaskLog]
            WHERE StartedAtUtc >= {since_sql} AND Status = 'failed'
            GROUP BY ErrorType, ErrorMessage
            ORDER BY COUNT(*) DESC
        """
        top_errors = _query_sql(errors_sql)

        handler._json_response({
            "hours": hours_int,
            "runs": [_safe_row(r) for r in run_metrics] if run_metrics else [],
            "layers": [_safe_row(r) for r in layer_metrics] if layer_metrics else [],
            "slowest_entities": [_safe_row(r) for r in slowest] if slowest else [],
            "top_errors": [_safe_row(r) for r in top_errors] if top_errors else [],
        })
    except Exception as exc:
        log.warning("Engine metrics unavailable (SQL connection error), returning empty: %s", exc)
        handler._json_response({
            "hours": hours_int,
            "runs": [],
            "layers": [],
            "slowest_entities": [],
            "top_errors": [],
            "_error": str(exc),
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
    """Query run history. SQLite first, falls back to execution.sp_GetEngineRuns."""
    params = {}

    limit = qs.get("limit", ["20"])[0]
    limit_val = int(limit) if str(limit).isdigit() else 20
    params["Limit"] = limit_val

    status = qs.get("status", [None])[0]
    if status:
        params["Status"] = status

    rows = None

    # Try local SQLite first
    try:
        import control_plane_db as cpdb
        sqlite_runs = cpdb.get_engine_runs(limit=limit_val)
        if sqlite_runs:
            if status:
                sqlite_runs = [r for r in sqlite_runs if r.get('Status', '').lower() == status.lower()]
            rows = sqlite_runs
            log.debug("Engine runs served from SQLite (%d rows)", len(rows))
    except Exception:
        pass

    if rows is None:
        try:
            rows = _exec_proc("[execution].[sp_GetEngineRuns]", params)
        except Exception as exc:
            log.exception("Failed to query engine runs")
            handler._error_response(str(exc), 500)
            return

    # Map columns to frontend format
    mapped = []
    for r in rows:
        sr = _safe_row(r)
        mapped.append({
            "run_id": sr.get("RunId", ""),
            "status": sr.get("Status", "unknown"),
            "mode": sr.get("Mode", "run"),
            "started_at": sr.get("StartedAtUtc") or sr.get("StartedAt", ""),
            "finished_at": sr.get("CompletedAtUtc") or sr.get("EndedAt"),
            "duration_seconds": sr.get("ElapsedSeconds") or sr.get("TotalDurationSeconds"),
            "entities_succeeded": sr.get("SucceededEntities", 0),
            "entities_failed": sr.get("FailedEntities", 0),
            "entities_skipped": sr.get("SkippedEntities", 0),
            "triggered_by": sr.get("TriggeredBy", ""),
            "total_rows": sr.get("TotalRowsRead", 0),
            "error_summary": sr.get("ErrorSummary"),
        })
    handler._json_response({"runs": mapped, "count": len(mapped)})


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
        lz_status = _query_sql("""
            SELECT
                ds.Name AS DataSource,
                SUM(CASE WHEN ple.IsProcessed = 1 THEN 1 ELSE 0 END) AS LzLoaded,
                SUM(CASE WHEN ple.IsProcessed = 0 THEN 1 ELSE 0 END) AS LzFailed,
                SUM(CASE WHEN ple.LandingzoneEntityId IS NULL THEN 1 ELSE 0 END) AS LzNeverAttempted
            FROM integration.LandingzoneEntity le
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            LEFT JOIN execution.PipelineLandingzoneEntity ple
                ON le.LandingzoneEntityId = ple.LandingzoneEntityId
            WHERE le.IsActive = 1
            GROUP BY ds.Name
            ORDER BY ds.Name
        """)

        # Bronze status per source
        bronze_status = _query_sql("""
            SELECT
                ds.Name AS DataSource,
                SUM(CASE WHEN pbe.IsProcessed = 1 THEN 1 ELSE 0 END) AS BronzeLoaded,
                SUM(CASE WHEN pbe.IsProcessed = 0 THEN 1 ELSE 0 END) AS BronzeFailed,
                SUM(CASE WHEN pbe.BronzeLayerEntityId IS NULL THEN 1 ELSE 0 END) AS BronzeNeverAttempted
            FROM integration.LandingzoneEntity le
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            JOIN integration.BronzeLayerEntity ble ON le.LandingzoneEntityId = ble.LandingzoneEntityId
            LEFT JOIN execution.PipelineBronzeLayerEntity pbe
                ON ble.BronzeLayerEntityId = pbe.BronzeLayerEntityId
            WHERE le.IsActive = 1
            GROUP BY ds.Name
            ORDER BY ds.Name
        """)

        # Silver status per source (table created on first Silver notebook run)
        try:
            silver_status = _query_sql("""
                SELECT
                    ds.Name AS DataSource,
                    SUM(CASE WHEN pse.IsProcessed = 1 THEN 1 ELSE 0 END) AS SilverLoaded,
                    SUM(CASE WHEN pse.IsProcessed = 0 THEN 1 ELSE 0 END) AS SilverFailed,
                    SUM(CASE WHEN pse.SilverLayerEntityId IS NULL THEN 1 ELSE 0 END) AS SilverNeverAttempted
                FROM integration.LandingzoneEntity le
                JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
                JOIN integration.BronzeLayerEntity ble ON le.LandingzoneEntityId = ble.LandingzoneEntityId
                LEFT JOIN integration.SilverLayerEntity sle ON ble.BronzeLayerEntityId = sle.BronzeLayerEntityId
                LEFT JOIN execution.PipelineSilverLayerEntity pse
                    ON sle.SilverLayerEntityId = pse.SilverLayerEntityId
                WHERE le.IsActive = 1
                GROUP BY ds.Name
                ORDER BY ds.Name
            """)
        except Exception:
            silver_status = []

        # Digest summary
        try:
            digest = _query_sql("""
                SELECT OverallStatus, COUNT(*) AS EntityCount
                FROM execution.EntityStatusSummary
                GROUP BY OverallStatus
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

        # Stuck at LZ (distinct entities only, not per-run duplicates)
        stuck_at_lz = _query_sql("""
            SELECT
                ds.Name AS DataSource,
                COUNT(DISTINCT le.LandingzoneEntityId) AS StuckCount
            FROM integration.LandingzoneEntity le
            JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            JOIN execution.PipelineLandingzoneEntity ple
                ON le.LandingzoneEntityId = ple.LandingzoneEntityId
            JOIN integration.BronzeLayerEntity ble
                ON le.LandingzoneEntityId = ble.LandingzoneEntityId
            LEFT JOIN execution.PipelineBronzeLayerEntity pbe
                ON ble.BronzeLayerEntityId = pbe.BronzeLayerEntityId
            WHERE le.IsActive = 1
              AND ple.IsProcessed = 1
              AND (pbe.BronzeLayerEntityId IS NULL OR pbe.IsProcessed = 0)
            GROUP BY ds.Name
            ORDER BY ds.Name
        """)

        # Per-entity layer status (the selectable table)
        # Try with PipelineSilverLayerEntity; fall back without if table doesn't exist yet
        try:
            entities = _query_sql("""
                SELECT
                    le.LandingzoneEntityId AS EntityId,
                    ds.Name AS DataSource,
                    le.SourceSchema,
                    le.SourceName,
                    le.IsIncremental,
                    CASE WHEN ple.IsProcessed = 1 THEN 1
                         WHEN ple.IsProcessed = 0 THEN 0
                         ELSE -1 END AS LzStatus,
                    CASE WHEN pbe.IsProcessed = 1 THEN 1
                         WHEN pbe.IsProcessed = 0 THEN 0
                         ELSE -1 END AS BronzeStatus,
                    CASE WHEN pse.IsProcessed = 1 THEN 1
                         WHEN pse.IsProcessed = 0 THEN 0
                         ELSE -1 END AS SilverStatus
                FROM integration.LandingzoneEntity le
                JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
                LEFT JOIN execution.PipelineLandingzoneEntity ple
                    ON le.LandingzoneEntityId = ple.LandingzoneEntityId
                LEFT JOIN integration.BronzeLayerEntity ble
                    ON le.LandingzoneEntityId = ble.LandingzoneEntityId
                LEFT JOIN execution.PipelineBronzeLayerEntity pbe
                    ON ble.BronzeLayerEntityId = pbe.BronzeLayerEntityId
                LEFT JOIN integration.SilverLayerEntity sle
                    ON ble.BronzeLayerEntityId = sle.BronzeLayerEntityId
                LEFT JOIN execution.PipelineSilverLayerEntity pse
                    ON sle.SilverLayerEntityId = pse.SilverLayerEntityId
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
                    CASE WHEN ple.IsProcessed = 1 THEN 1
                         WHEN ple.IsProcessed = 0 THEN 0
                         ELSE -1 END AS LzStatus,
                    CASE WHEN pbe.IsProcessed = 1 THEN 1
                         WHEN pbe.IsProcessed = 0 THEN 0
                         ELSE -1 END AS BronzeStatus,
                    -1 AS SilverStatus
                FROM integration.LandingzoneEntity le
                JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
                LEFT JOIN execution.PipelineLandingzoneEntity ple
                    ON le.LandingzoneEntityId = ple.LandingzoneEntityId
                LEFT JOIN integration.BronzeLayerEntity ble
                    ON le.LandingzoneEntityId = ble.LandingzoneEntityId
                LEFT JOIN execution.PipelineBronzeLayerEntity pbe
                    ON ble.BronzeLayerEntityId = pbe.BronzeLayerEntityId
                WHERE le.IsActive = 1
                ORDER BY ds.Name, le.SourceSchema, le.SourceName
            """)

        handler._json_response({
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
                ple.ProcessedDatetime AS last_loaded,
                CASE WHEN ple.IsProcessed = 1 THEN 'loaded'
                     WHEN ple.IsProcessed = 0 THEN 'failed'
                     ELSE 'never' END AS lz_status
            FROM integration.LandingzoneEntity le
            INNER JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            INNER JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
            LEFT JOIN execution.PipelineLandingzoneEntity ple
                ON le.LandingzoneEntityId = ple.LandingzoneEntityId
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
