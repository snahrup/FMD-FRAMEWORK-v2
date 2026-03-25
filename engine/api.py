"""
FMD v3 Engine REST API handlers.

Imported by dashboard/app/api/server.py and wired into the /api/engine/* routes.
Each handler receives the DashboardHandler instance (for writing responses)
plus the dashboard CONFIG dict.  All database access goes through the local
SQLite control-plane DB — no Fabric SQL dependency.

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
import os
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from dataclasses import asdict
from pathlib import Path
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
# SQLite control-plane DB — lazy import (mirrors logging_db.py pattern)
# ---------------------------------------------------------------------------

_cpdb = None
_cpdb_loaded = False


def _get_cpdb():
    """Lazily import control_plane_db.  Returns the module or None."""
    global _cpdb, _cpdb_loaded
    if _cpdb_loaded:
        return _cpdb
    try:
        from dashboard.app.api import control_plane_db
        _cpdb = control_plane_db
    except Exception as exc:
        log.debug("control_plane_db not available: %s", exc)
        _cpdb = None
    _cpdb_loaded = True
    return _cpdb


def _db_query(sql: str, params: tuple = ()) -> list:
    """Run an arbitrary SELECT against the SQLite control-plane DB."""
    try:
        from dashboard.app.api import db as fmd_db
        return fmd_db.query(sql, params)
    except Exception as exc:
        log.warning("SQLite query failed: %s", exc)
        return []


def _db_execute(sql: str, params: tuple = ()) -> None:
    """Run an arbitrary write statement against the SQLite control-plane DB."""
    try:
        from dashboard.app.api import db as fmd_db
        fmd_db.execute(sql, params)
    except Exception as exc:
        log.warning("SQLite execute failed: %s", exc)


# ---------------------------------------------------------------------------
# SSE Broadcaster — mirrors the _deploy_cond pattern in server.py
# ---------------------------------------------------------------------------

_sse_events: list[dict] = []          # append-only list of SSE event dicts
_sse_cond = threading.Condition()     # notifies waiting SSE listeners
_sse_max_events = 10_000              # cap memory; older events silently drop


class _SSEHook:
    """Injects into the engine's AuditLogger to broadcast events in real-time.

    The orchestrator's AuditLogger writes to SQLite.  This hook additionally
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
        except Exception as e:
            # Cannot use logging here (would recurse); write to stderr as last resort
            print(f"SSE log handler error: {e}", file=sys.stderr)


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


def _write_pipeline_audit_terminal(run_id: str, status: str, reason: str) -> None:
    """Write a terminal (Aborted/Failed) row to pipeline_audit.

    This ensures the Live Monitor stops showing phantom "Running..." entries
    for runs that were aborted or failed outside the normal AuditLogger flow.
    """
    try:
        _db_execute(
            "INSERT INTO pipeline_audit "
            "(PipelineRunGuid, PipelineName, EntityLayer, TriggerType, LogType, "
            " LogDateTime, LogData, EntityId) "
            "VALUES (?, 'FMD_ENGINE_V3', 'all', 'Engine', ?, "
            " strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, 0)",
            (run_id, status, f'{{"action":"run_{status.lower()}","reason":"{reason}"}}')
        )
    except Exception as exc:
        log.warning("Failed to write terminal pipeline_audit for %s: %s", run_id[:8], exc)


# ---------------------------------------------------------------------------
# Startup cleanup
# ---------------------------------------------------------------------------

def _cleanup_orphaned_runs() -> None:
    """Mark orphaned InProgress runs as Interrupted (resumable) on startup.

    A run is orphaned if:
    - Status is InProgress AND
    - WorkerPid is set AND the process is no longer alive, OR
    - WorkerPid is NULL (legacy daemon-thread run that died with the server)

    Grace window: runs started within the last 120 seconds are skipped — the
    worker may still be spinning up and hasn't sent its first heartbeat yet.
    """
    try:
        orphaned = _db_query(
            "SELECT RunId, WorkerPid, StartedAt FROM engine_runs "
            "WHERE Status IN ('InProgress', 'running')"
        )
        if not orphaned:
            return

        import datetime
        now = datetime.datetime.utcnow()
        grace_seconds = 120
        cleaned = 0

        for run in orphaned:
            # Grace window: skip recently started runs
            started_at = run.get("StartedAt")
            if started_at:
                try:
                    started = datetime.datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                    started_naive = started.replace(tzinfo=None)
                    if (now - started_naive).total_seconds() < grace_seconds:
                        log.debug("Skipping run %s — within %ds grace window",
                                  run["RunId"][:8], grace_seconds)
                        continue
                except (ValueError, TypeError):
                    pass  # Bad timestamp — proceed with cleanup

            # PID liveness check
            pid = run.get("WorkerPid")
            if pid:
                try:
                    os.kill(int(pid), 0)  # existence check, doesn't kill
                    log.debug("Run %s worker PID %d still alive — not orphaned",
                              run["RunId"][:8], pid)
                    continue  # Process alive — not an orphan
                except (OSError, ProcessLookupError, TypeError, ValueError):
                    pass  # Process dead — orphan

            # Mark as Interrupted (resumable) instead of Aborted (terminal)
            _db_execute(
                "UPDATE engine_runs "
                "SET Status = 'Interrupted', "
                "    EndedAt = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
                "    ErrorSummary = 'Interrupted: worker process died or server restarted' "
                "WHERE RunId = ?",
                (run["RunId"],),
            )
            _write_pipeline_audit_terminal(
                run["RunId"], "Interrupted", "Worker process died or server restarted"
            )
            cleaned += 1

        if cleaned:
            log.info("Marked %d orphaned runs as Interrupted (resumable) on startup", cleaned)
    except Exception as exc:
        log.warning("Failed to clean up orphaned runs: %s", exc)


# ---------------------------------------------------------------------------
# Route dispatcher — called from server.py's do_GET / do_POST
# ---------------------------------------------------------------------------

def handle_engine_request(handler, method: str, path: str, config: dict) -> None:
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
    """
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
            elif sub_path == "/resume":
                _handle_resume(handler, config, body)
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

    cpdb = _get_cpdb()
    rows = None
    if cpdb:
        try:
            rows = cpdb.get_engine_runs(limit=1)
        except Exception as exc:
            log.warning("Failed to query last run from SQLite: %s", exc)

    if rows:
        row = rows[0]
        run_info = {
            "run_id": str(row.get("RunId", "")),
            "status": str(row.get("Status", "")),
            "mode": str(row.get("Mode", "")),
            "started_at": row.get("StartedAt") or None,
            "finished_at": row.get("EndedAt") or None,
            "total": _to_int(row.get("TotalEntities")),
            "succeeded": _to_int(row.get("SucceededEntities")),
            "failed": _to_int(row.get("FailedEntities")),
            "skipped": _to_int(row.get("SkippedEntities")),
            "total_rows": _to_int(row.get("TotalRowsRead")),
            "duration_seconds": _to_float(row.get("TotalDurationSeconds")),
            "layers": str(row.get("Layers", "")),
            "triggered_by": str(row.get("TriggeredBy", "")),
            "elapsed_seconds": _to_int(row.get("TotalDurationSeconds")),
        }

        # Worker liveness check
        worker_pid = row.get("WorkerPid")
        worker_alive = False
        if worker_pid and row.get("Status") in ("InProgress", "running"):
            try:
                os.kill(int(worker_pid), 0)
                worker_alive = True
            except (OSError, ProcessLookupError, TypeError, ValueError):
                pass
        run_info["worker_pid"] = worker_pid
        run_info["worker_alive"] = worker_alive
        run_info["heartbeat_at"] = row.get("HeartbeatAt")
        run_info["current_layer"] = row.get("CurrentLayer")
        run_info["completed_units"] = _to_int(row.get("CompletedUnits"))
        run_info["resumable"] = row.get("Status") in ("Interrupted", "Aborted", "Failed")

        # Scope truth — from the run record, not optimistic frontend state
        run_info["source_filter"] = str(row.get("SourceFilter", ""))
        run_info["entity_filter"] = str(row.get("EntityFilter", ""))
        run_info["resolved_entity_count"] = _to_int(row.get("ResolvedEntityCount"))

        response["last_run"] = run_info

        # If the in-process engine is idle but a worker subprocess is alive
        # and running (spawned via _spawn_worker), reflect that in top-level status
        if response["status"] == "idle" and worker_alive:
            response["status"] = "running"
            response["current_run_id"] = run_info["run_id"]

    handler._json_response(response)


# ---------------------------------------------------------------------------
# POST /api/engine/start
# ---------------------------------------------------------------------------

def _spawn_worker(run_id: str, args: list[str]) -> int:
    """Spawn engine/worker.py as a detached subprocess. Returns worker PID.

    The worker survives dashboard server restarts on Windows via
    CREATE_NEW_PROCESS_GROUP + DETACHED_PROCESS flags.

    Logging: API redirects worker stdout/stderr to a per-run log file.
    Worker logs to console only (StreamHandler) — one owner for the file.
    """
    project_root = str(Path(__file__).resolve().parent.parent)
    log_dir = Path(project_root) / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / f"engine-worker-{run_id[:12]}.log"

    worker_log = open(str(log_file), "w", encoding="utf-8")

    worker_cmd = [sys.executable, "-m", "engine.worker"] + args

    # Windows: fully detach from parent process
    creation_flags = 0
    if sys.platform == "win32":
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS

    proc = subprocess.Popen(
        worker_cmd,
        cwd=project_root,
        creationflags=creation_flags,
        stdout=worker_log,
        stderr=subprocess.STDOUT,
    )

    # Parent releases the file handle — child owns it now
    worker_log.close()

    log.info("Worker spawned: PID=%d, run_id=%s, log=%s", proc.pid, run_id[:8], log_file)
    return proc.pid


def _start_sse_poller(run_id: str) -> None:
    """Poll engine_task_log for new rows and publish as SSE events.

    Runs in a daemon thread inside the dashboard process. NOT durable across
    dashboard restarts — Phase 1 provides durable execution via SQLite,
    with best-effort SSE while the dashboard is up.
    """
    def _poll():
        last_id = 0
        while True:
            try:
                rows = _db_query(
                    "SELECT id, RunId, EntityId, SourceTable, Layer, Status, "
                    "RowsRead, RowsWritten, DurationSeconds, ErrorMessage "
                    "FROM engine_task_log WHERE RunId = ? AND id > ? ORDER BY id LIMIT 50",
                    (run_id, last_id),
                )
                for row in rows:
                    _publish_entity_result(
                        run_id=row.get("RunId", run_id),
                        entity_id=row.get("EntityId", 0),
                        entity_name=row.get("SourceTable", ""),
                        layer=row.get("Layer", ""),
                        status=row.get("Status", ""),
                        rows_read=row.get("RowsRead", 0),
                        rows_written=row.get("RowsWritten", 0),
                        duration_seconds=row.get("DurationSeconds", 0),
                        error=row.get("ErrorMessage"),
                    )
                    last_id = row.get("id", last_id)

                # Check if run completed
                run_rows = _db_query(
                    "SELECT Status FROM engine_runs WHERE RunId = ?", (run_id,)
                )
                if run_rows and run_rows[0].get("Status") not in ("InProgress", "running"):
                    status = run_rows[0].get("Status", "Unknown")
                    _publish_log("info", f"Run {run_id[:8]} finished: {status}")
                    _SSEHook.publish("run_complete", {"status": status, "run_id": run_id})
                    break
            except Exception as exc:
                log.debug("SSE poller error (non-fatal): %s", exc)
            time.sleep(2)

    threading.Thread(target=_poll, daemon=True, name=f"sse-poll-{run_id[:8]}").start()


def _handle_start(handler, config: dict, body: dict) -> None:
    """Start the engine as a detached worker subprocess.

    Pre-generates run_id, pre-creates engine_runs row, spawns worker,
    returns immediately. No race conditions — run_id is known before spawn.
    """
    # Check for already-running worker via heartbeat
    active = _db_query(
        "SELECT RunId, WorkerPid, HeartbeatAt FROM engine_runs "
        "WHERE Status IN ('InProgress', 'running') LIMIT 1"
    )
    if active:
        run = active[0]
        pid = run.get("WorkerPid")
        if pid:
            try:
                os.kill(pid, 0)  # existence check
                handler._json_response({
                    "error": "Engine is already running",
                    "current_run_id": run.get("RunId"),
                }, status=409)
                return
            except (OSError, ProcessLookupError):
                pass  # Dead PID — allow new start

    mode = body.get("mode", "run")
    layers = body.get("layers")       # list or None
    entity_ids = body.get("entity_ids")  # list or None
    triggered_by = body.get("triggered_by", "dashboard")
    source_filter = body.get("source_filter") or []

    # SCOPE GUARD: If a source filter was provided but entity_ids resolved to
    # nothing, hard-reject.  Never let the engine silently widen to "all".
    if source_filter and (not entity_ids or len(entity_ids) == 0):
        handler._error_response(
            f"Source filter specified ({', '.join(source_filter)}) but resolved to 0 entities. "
            "Refusing to launch — this would load everything. "
            "Check that the selected sources have active entities in lz_entities.",
            400,
        )
        return

    # Plan mode still runs in-process (read-only, fast)
    if mode == "plan":
        engine = _get_or_create_engine(config)
        try:
            results = engine.run(mode="plan", entity_ids=entity_ids, layers=layers)
            handler._json_response({
                "plan": results.to_dict() if hasattr(results, 'to_dict') else {},
            })
        except Exception as exc:
            handler._error_response(f"Plan failed: {exc}", 500)
        return

    # Clear SSE events from previous run
    _SSEHook.clear()

    run_id = str(uuid.uuid4())
    layer_str = ",".join(layers) if layers else "landing,bronze,silver"

    # Persist entity filter so resume can recover the original scope
    entity_filter_str = ",".join(str(i) for i in entity_ids) if entity_ids else ""

    # Persist source filter and resolved count for scope transparency
    source_filter = body.get("source_filter") or []
    source_filter_str = ",".join(source_filter) if source_filter else ""
    resolved_entity_count = body.get("resolved_entity_count") or (len(entity_ids) if entity_ids else 0)

    # Pre-create engine_runs row — API owns this, worker will upsert into it
    _db_execute(
        "INSERT INTO engine_runs (RunId, Status, Layers, TriggeredBy, EntityFilter, "
        "SourceFilter, ResolvedEntityCount, StartedAt) "
        "VALUES (?, 'InProgress', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
        (run_id, layer_str, triggered_by, entity_filter_str,
         source_filter_str, resolved_entity_count),
    )

    _publish_log("info", f"Engine starting: run_id={run_id[:8]}, layers={layer_str}, "
                 f"sources={source_filter_str or 'all'}, "
                 f"entities={resolved_entity_count or 'all'}, "
                 f"triggered_by={triggered_by}")

    # Build worker args
    worker_args = ["--run-id", run_id, "--triggered-by", triggered_by]
    if layers:
        worker_args += ["--layers"] + layers
    if entity_ids:
        worker_args += ["--entity-ids"] + [str(i) for i in entity_ids]

    # Spawn detached worker
    worker_pid = _spawn_worker(run_id, worker_args)

    # Record PID
    _db_execute("UPDATE engine_runs SET WorkerPid = ? WHERE RunId = ?", (worker_pid, run_id))

    # Start SSE poller for this run (best-effort, not durable across restarts)
    _start_sse_poller(run_id)

    handler._json_response({
        "run_id": run_id,
        "status": "started",
        "mode": mode,
        "worker_pid": worker_pid,
    })


def _handle_resume(handler, config: dict, body: dict) -> None:
    """Resume an interrupted run as a detached worker subprocess.

    Recovers original layers from engine_runs. Spawns worker with --resume.
    """
    run_id = body.get("run_id")
    if not run_id:
        handler._error_response("run_id required", 400)
        return

    # Verify run exists and is resumable
    rows = _db_query("SELECT Status, Layers FROM engine_runs WHERE RunId = ?", (run_id,))
    if not rows:
        handler._error_response(f"Run {run_id} not found", 404)
        return
    run = rows[0]
    if run.get("Status") not in ("Interrupted", "Aborted", "Failed"):
        handler._error_response(
            f"Run {run_id} status is {run.get('Status')}, not resumable", 409
        )
        return

    _SSEHook.clear()
    _publish_log("info", f"Resuming run {run_id[:8]}")

    # Build worker args with original layers
    worker_args = ["--resume", run_id]
    original_layers = run.get("Layers", "")
    if original_layers:
        worker_args += ["--layers"] + [l.strip() for l in original_layers.split(",") if l.strip()]

    worker_pid = _spawn_worker(run_id, worker_args)
    _db_execute("UPDATE engine_runs SET WorkerPid = ? WHERE RunId = ?", (worker_pid, run_id))
    _start_sse_poller(run_id)

    handler._json_response({
        "run_id": run_id,
        "status": "resuming",
        "worker_pid": worker_pid,
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

    # Abort the active run in SQLite
    run_id = engine.current_run_id
    if run_id:
        try:
            _db_execute(
                "UPDATE engine_runs "
                "SET Status = 'Aborted', "
                "    EndedAt = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
                "    ErrorSummary = 'Stopped by user from dashboard' "
                "WHERE RunId = ? AND Status IN ('InProgress', 'running')",
                (str(run_id),)
            )
            _write_pipeline_audit_terminal(str(run_id), "Aborted", "Stopped by user from dashboard")
        except Exception as exc:
            log.warning("Failed to abort run in SQLite on stop: %s", exc)

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
    Updates the SQLite status to 'Aborted'.
    If the run is currently active, also sends a stop signal to the engine.
    """
    run_id = body.get("run_id")
    abort_all = body.get("all", False)

    if not run_id and not abort_all:
        handler._error_response("run_id or all:true is required", 400)
        return

    try:
        if abort_all:
            # Find runs to abort first (for pipeline_audit writes)
            orphaned = _db_query(
                "SELECT RunId FROM engine_runs WHERE Status IN ('InProgress', 'running')"
            )
            _db_execute(
                "UPDATE engine_runs "
                "SET Status = 'Aborted', "
                "    EndedAt = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
                "    ErrorSummary = CASE WHEN ErrorSummary IS NULL OR ErrorSummary = '' "
                "        THEN 'Aborted by user' ELSE ErrorSummary END "
                "WHERE Status IN ('InProgress', 'running')"
            )
            count = len(orphaned)
            for row in orphaned:
                _write_pipeline_audit_terminal(row["RunId"], "Aborted", "Aborted by user")
        else:
            _db_execute(
                "UPDATE engine_runs "
                "SET Status = 'Aborted', "
                "    EndedAt = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
                "    ErrorSummary = CASE WHEN ErrorSummary IS NULL OR ErrorSummary = '' "
                "        THEN 'Aborted by user' ELSE ErrorSummary END "
                "WHERE RunId = ?",
                (str(run_id),)
            )
            _write_pipeline_audit_terminal(str(run_id), "Aborted", "Aborted by user")
            count = 1

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
    """Query task logs from the SQLite engine_task_log table."""
    run_id = qs.get("run_id", [None])[0]
    entity_id_raw = qs.get("entity_id", [None])[0]
    entity_id = int(entity_id_raw) if entity_id_raw and str(entity_id_raw).isdigit() else None
    layer = qs.get("layer", [None])[0]
    status = qs.get("status", [None])[0]
    limit_raw = qs.get("limit", ["100"])[0]
    limit = int(limit_raw) if str(limit_raw).isdigit() else 100
    offset_raw = qs.get("offset", ["0"])[0]
    offset = int(offset_raw) if str(offset_raw).isdigit() else 0

    try:
        sql = """
            SELECT t.id AS TaskId, t.RunId, t.EntityId, t.Layer, t.Status,
                   t.SourceTable AS SourceName, le.SourceSchema,
                   ds.Name AS DataSourceName,
                   t.RowsRead, t.RowsWritten, t.BytesTransferred, t.DurationSeconds,
                   t.ErrorMessage, t.ErrorSuggestion, t.LoadType,
                   t.created_at
            FROM engine_task_log t
            LEFT JOIN lz_entities le ON t.EntityId = le.LandingzoneEntityId
            LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId
            WHERE 1=1
        """
        params: list = []
        if run_id:
            sql += " AND t.RunId = ?"
            params.append(run_id)
        if entity_id is not None:
            sql += " AND t.EntityId = ?"
            params.append(entity_id)
        if layer:
            sql += " AND t.Layer = ?"
            params.append(layer)
        if status:
            sql += " AND t.Status = ?"
            params.append(status)
        sql += " ORDER BY t.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = _db_query(sql, tuple(params))

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

    # If no explicit entity_ids, query failed ones from the run via SQLite
    if not entity_ids and run_id:
        try:
            rows = _db_query(
                "SELECT DISTINCT EntityId FROM engine_task_log "
                "WHERE RunId = ? AND Status = 'failed' AND EntityId IS NOT NULL",
                (str(run_id),)
            )
            entity_ids = [int(r["EntityId"]) for r in rows if r.get("EntityId")]
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
    """Query aggregated metrics from SQLite engine_task_log and engine_runs."""
    hours = qs.get("hours", ["24"])[0]
    hours_int = int(hours) if str(hours).isdigit() else 24

    try:
        # Run-level metrics (last N hours)
        run_metrics = _db_query(
            "SELECT RunId, Mode, Status, TotalEntities, SucceededEntities, FailedEntities, "
            "       SkippedEntities, TotalRowsRead, TotalRowsWritten, TotalDurationSeconds, "
            "       StartedAt, EndedAt, TriggeredBy, ErrorSummary "
            "FROM engine_runs "
            "WHERE StartedAt >= datetime('now', ? || ' hours') "
            "ORDER BY StartedAt DESC",
            (f"-{hours_int}",)
        )

        # Layer breakdown
        layer_metrics = _db_query(
            "SELECT Layer, "
            "       COUNT(*) AS TotalTasks, "
            "       SUM(CASE WHEN Status = 'succeeded' THEN 1 ELSE 0 END) AS Succeeded, "
            "       SUM(CASE WHEN Status = 'failed' THEN 1 ELSE 0 END) AS Failed, "
            "       SUM(RowsRead) AS TotalRowsRead, "
            "       AVG(DurationSeconds) AS AvgDurationSeconds "
            "FROM engine_task_log "
            "WHERE created_at >= datetime('now', ? || ' hours') "
            "GROUP BY Layer",
            (f"-{hours_int}",)
        )

        # Top 10 slowest
        slowest = _db_query(
            "SELECT t.EntityId, e.SourceName, d.Name AS DataSourceName, "
            "       t.Layer, t.DurationSeconds, t.RowsRead, t.Status "
            "FROM engine_task_log t "
            "LEFT JOIN lz_entities e ON t.EntityId = e.LandingzoneEntityId "
            "LEFT JOIN datasources d ON e.DataSourceId = d.DataSourceId "
            "WHERE t.created_at >= datetime('now', ? || ' hours') AND t.Status = 'succeeded' "
            "ORDER BY t.DurationSeconds DESC "
            "LIMIT 10",
            (f"-{hours_int}",)
        )

        # Top 5 errors
        top_errors = _db_query(
            "SELECT ErrorType, ErrorMessage, COUNT(*) AS Occurrences "
            "FROM engine_task_log "
            "WHERE created_at >= datetime('now', ? || ' hours') AND Status = 'failed' "
            "GROUP BY ErrorType, ErrorMessage "
            "ORDER BY COUNT(*) DESC "
            "LIMIT 5",
            (f"-{hours_int}",)
        )

        # Map run rows to snake_case matching the frontend MetricsData interface
        mapped_runs = []
        if run_metrics:
            for r in run_metrics:
                sr = _safe_row(r)
                mapped_runs.append({
                    "run_id": sr.get("RunId", ""),
                    "status": sr.get("Status", "unknown"),
                    "started_at": sr.get("StartedAt") or None,
                    "duration_seconds": sr.get("TotalDurationSeconds"),
                })

        handler._json_response({
            "hours": hours_int,
            "runs": mapped_runs,
            "layers": [_safe_row(r) for r in layer_metrics] if layer_metrics else [],
            "slowest_entities": [_safe_row(r) for r in slowest] if slowest else [],
            "top_errors": [_safe_row(r) for r in top_errors] if top_errors else [],
        })
    except Exception as exc:
        log.warning("Engine metrics unavailable, returning empty: %s", exc)
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
    """Reset watermark for an entity by deleting its watermark record.

    This forces the next run to do a full load for this entity.
    """
    try:
        _db_execute(
            "DELETE FROM watermarks WHERE LandingzoneEntityId = ?",
            (int(entity_id),)
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
    """Query run history from SQLite engine_runs table."""
    limit_raw = qs.get("limit", ["20"])[0]
    limit_val = int(limit_raw) if str(limit_raw).isdigit() else 20
    status = qs.get("status", [None])[0]

    cpdb = _get_cpdb()
    if cpdb:
        rows = cpdb.get_engine_runs(limit=limit_val)
        if status:
            rows = [r for r in rows if r.get("Status", "").lower() == status.lower()]
    else:
        sql = "SELECT * FROM engine_runs WHERE 1=1"
        params: list = []
        if status:
            sql += " AND Status = ?"
            params.append(status)
        sql += " ORDER BY StartedAt DESC LIMIT ?"
        params.append(limit_val)
        rows = _db_query(sql, tuple(params))

    # Map columns to frontend format
    mapped = []
    for r in rows:
        sr = _safe_row(r)
        mapped.append({
            "run_id": sr.get("RunId", ""),
            "status": sr.get("Status", "unknown"),
            "mode": sr.get("Mode", "run"),
            "started_at": sr.get("StartedAt") or None,
            "finished_at": sr.get("EndedAt") or None,
            "duration_seconds": sr.get("TotalDurationSeconds"),
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

    This powers the Validation Checklist dashboard page.
    """
    try:
        # Overview by source
        overview = _db_query("""
            SELECT
                d.Name AS DataSource,
                COUNT(*) AS TotalEntities,
                SUM(CASE WHEN e.IsActive = 1 THEN 1 ELSE 0 END) AS Active,
                SUM(CASE WHEN e.IsActive = 0 THEN 1 ELSE 0 END) AS Inactive
            FROM lz_entities e
            JOIN datasources d ON e.DataSourceId = d.DataSourceId
            GROUP BY d.Name
            ORDER BY d.Name
        """)

        # All layer status queries use entity_status as the single source of truth.
        # entity_status PK = (LandingzoneEntityId, Layer).
        # Layer names: 'landing'/'landingzone' (LZ), 'bronze', 'silver'.
        # Status: 'loaded'/'succeeded' = done, 'failed' = error, 'not_started'/NULL = pending.
        _LOADED = "LOWER(COALESCE(%s.Status,'')) IN ('loaded','succeeded')"
        _FAILED = "LOWER(COALESCE(%s.Status,'')) IN ('failed','error')"

        # LZ status per source
        lz_status = _db_query("""
            SELECT
                d.Name AS DataSource,
                SUM(CASE WHEN """ + (_LOADED % "es") + """ THEN 1 ELSE 0 END) AS LzLoaded,
                SUM(CASE WHEN """ + (_FAILED % "es") + """ THEN 1 ELSE 0 END) AS LzFailed,
                SUM(CASE WHEN NOT """ + (_LOADED % "es") + """
                          AND NOT """ + (_FAILED % "es") + """ THEN 1 ELSE 0 END) AS LzNeverAttempted
            FROM lz_entities e
            JOIN datasources d ON e.DataSourceId = d.DataSourceId
            LEFT JOIN entity_status es ON e.LandingzoneEntityId = es.LandingzoneEntityId
                AND LOWER(es.Layer) IN ('landing', 'landingzone')
            WHERE e.IsActive = 1
            GROUP BY d.Name
            ORDER BY d.Name
        """)

        # Bronze status per source
        bronze_status = _db_query("""
            SELECT
                d.Name AS DataSource,
                SUM(CASE WHEN """ + (_LOADED % "es") + """ THEN 1 ELSE 0 END) AS BronzeLoaded,
                SUM(CASE WHEN """ + (_FAILED % "es") + """ THEN 1 ELSE 0 END) AS BronzeFailed,
                SUM(CASE WHEN NOT """ + (_LOADED % "es") + """
                          AND NOT """ + (_FAILED % "es") + """ THEN 1 ELSE 0 END) AS BronzeNeverAttempted
            FROM lz_entities e
            JOIN datasources d ON e.DataSourceId = d.DataSourceId
            LEFT JOIN entity_status es ON e.LandingzoneEntityId = es.LandingzoneEntityId
                AND LOWER(es.Layer) = 'bronze'
            WHERE e.IsActive = 1
            GROUP BY d.Name
            ORDER BY d.Name
        """)

        # Silver status per source
        silver_status = _db_query("""
            SELECT
                d.Name AS DataSource,
                SUM(CASE WHEN """ + (_LOADED % "es") + """ THEN 1 ELSE 0 END) AS SilverLoaded,
                SUM(CASE WHEN """ + (_FAILED % "es") + """ THEN 1 ELSE 0 END) AS SilverFailed,
                SUM(CASE WHEN NOT """ + (_LOADED % "es") + """
                          AND NOT """ + (_FAILED % "es") + """ THEN 1 ELSE 0 END) AS SilverNeverAttempted
            FROM lz_entities e
            JOIN datasources d ON e.DataSourceId = d.DataSourceId
            LEFT JOIN entity_status es ON e.LandingzoneEntityId = es.LandingzoneEntityId
                AND LOWER(es.Layer) = 'silver'
            WHERE e.IsActive = 1
            GROUP BY d.Name
            ORDER BY d.Name
        """)

        # Digest: overall per-entity status across all three layers
        digest = _db_query("""
            WITH entity_layers AS (
                SELECT
                    e.LandingzoneEntityId,
                    MAX(CASE WHEN LOWER(es.Layer) IN ('landing','landingzone')
                              AND """ + (_LOADED % "es") + """ THEN 1 ELSE 0 END) AS lz_ok,
                    MAX(CASE WHEN LOWER(es.Layer) = 'bronze'
                              AND """ + (_LOADED % "es") + """ THEN 1 ELSE 0 END) AS brz_ok,
                    MAX(CASE WHEN LOWER(es.Layer) = 'silver'
                              AND """ + (_LOADED % "es") + """ THEN 1 ELSE 0 END) AS slv_ok
                FROM lz_entities e
                LEFT JOIN entity_status es ON e.LandingzoneEntityId = es.LandingzoneEntityId
                WHERE e.IsActive = 1
                GROUP BY e.LandingzoneEntityId
            )
            SELECT
                CASE
                    WHEN lz_ok = 1 AND brz_ok = 1 AND slv_ok = 1 THEN 'complete'
                    WHEN lz_ok = 1 OR brz_ok = 1 OR slv_ok = 1 THEN 'partial'
                    ELSE 'not_started'
                END AS OverallStatus,
                COUNT(*) AS EntityCount
            FROM entity_layers
            GROUP BY OverallStatus
        """)

        # Never-attempted entities (no LZ entity_status row)
        never_attempted = _db_query("""
            SELECT
                e.LandingzoneEntityId AS EntityId,
                d.Name AS DataSource,
                e.SourceSchema,
                e.SourceName
            FROM lz_entities e
            JOIN datasources d ON e.DataSourceId = d.DataSourceId
            LEFT JOIN entity_status es ON e.LandingzoneEntityId = es.LandingzoneEntityId
                AND LOWER(es.Layer) IN ('landing', 'landingzone')
            WHERE e.IsActive = 1 AND es.LandingzoneEntityId IS NULL
            ORDER BY d.Name, e.SourceSchema, e.SourceName
            LIMIT 50
        """)

        # Stuck at LZ (loaded LZ but bronze not loaded)
        stuck_at_lz = _db_query("""
            SELECT
                d.Name AS DataSource,
                COUNT(DISTINCT e.LandingzoneEntityId) AS StuckCount
            FROM lz_entities e
            JOIN datasources d ON e.DataSourceId = d.DataSourceId
            JOIN entity_status es_lz ON e.LandingzoneEntityId = es_lz.LandingzoneEntityId
                AND LOWER(es_lz.Layer) IN ('landing', 'landingzone')
                AND """ + (_LOADED % "es_lz") + """
            LEFT JOIN entity_status es_brz ON e.LandingzoneEntityId = es_brz.LandingzoneEntityId
                AND LOWER(es_brz.Layer) = 'bronze'
                AND """ + (_LOADED % "es_brz") + """
            WHERE e.IsActive = 1 AND es_brz.LandingzoneEntityId IS NULL
            GROUP BY d.Name
            ORDER BY d.Name
        """)

        # Per-entity layer status (entity_status for all three layers)
        entities = _db_query("""
            SELECT
                e.LandingzoneEntityId AS EntityId,
                d.Name AS DataSource,
                e.SourceSchema,
                e.SourceName,
                e.IsIncremental,
                CASE WHEN """ + (_LOADED % "es_lz") + """ THEN 1
                     WHEN """ + (_FAILED % "es_lz") + """ THEN 0
                     ELSE -1 END AS LzStatus,
                CASE WHEN """ + (_LOADED % "es_brz") + """ THEN 1
                     WHEN """ + (_FAILED % "es_brz") + """ THEN 0
                     ELSE -1 END AS BronzeStatus,
                CASE WHEN """ + (_LOADED % "es_slv") + """ THEN 1
                     WHEN """ + (_FAILED % "es_slv") + """ THEN 0
                     ELSE -1 END AS SilverStatus
            FROM lz_entities e
            JOIN datasources d ON e.DataSourceId = d.DataSourceId
            LEFT JOIN entity_status es_lz ON e.LandingzoneEntityId = es_lz.LandingzoneEntityId
                AND LOWER(es_lz.Layer) IN ('landing', 'landingzone')
            LEFT JOIN entity_status es_brz ON e.LandingzoneEntityId = es_brz.LandingzoneEntityId
                AND LOWER(es_brz.Layer) = 'bronze'
            LEFT JOIN entity_status es_slv ON e.LandingzoneEntityId = es_slv.LandingzoneEntityId
                AND LOWER(es_slv.Layer) = 'silver'
            WHERE e.IsActive = 1
            ORDER BY d.Name, e.SourceSchema, e.SourceName
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
        rows = _db_query("""
            SELECT
                e.LandingzoneEntityId AS entity_id,
                e.SourceSchema AS source_schema,
                e.SourceName AS source_name,
                COALESCE(NULLIF(d.Namespace, ''), d.Name) AS namespace,
                d.Name AS datasource,
                c.DatabaseName AS source_database,
                e.IsIncremental AS is_incremental,
                es.LoadEndDateTime AS last_loaded,
                CASE WHEN LOWER(es.Status) IN ('success', 'loaded') THEN 'loaded'
                     WHEN LOWER(es.Status) IN ('failed', 'error') THEN 'failed'
                     ELSE 'never' END AS lz_status
            FROM lz_entities e
            INNER JOIN datasources d ON e.DataSourceId = d.DataSourceId
            INNER JOIN connections c ON d.ConnectionId = c.ConnectionId
            LEFT JOIN entity_status es ON e.LandingzoneEntityId = es.LandingzoneEntityId
                AND LOWER(es.Layer) IN ('landing', 'landingzone')
            WHERE e.IsActive = 1
            ORDER BY d.Name, e.SourceSchema, e.SourceName
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

    SQLite rows may contain datetime strings already; this just handles any
    remaining non-serializable types.
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
