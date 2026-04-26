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
    GET  /api/engine/runtime        - Runtime/orchestrator mode summary
    POST /api/engine/preflight      - Real-load readiness checks
    POST /api/engine/start          - Start a load run (background thread)
    POST /api/engine/stop           - Graceful stop
    GET  /api/engine/plan           - Dry-run plan
    GET  /api/engine/logs           - Task log query
    GET  /api/engine/logs/stream    - SSE real-time log stream
    POST /api/engine/retry          - Retry failed entities from a run
    POST /api/engine/abort-run      - Abort a run by ID (or all InProgress)
    POST /api/engine/cleanup-runs   - Clean up stale/zombie runs
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
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

from engine.dagster_bridge import DagsterBridgeError, launch_dagster_run

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

        # Start periodic orphan cleanup (every 5 minutes)
        _start_periodic_cleanup()

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


_RUN_LAYER_SET = {"landing", "bronze", "silver"}
_FAILURE_STATUSES = {"failed", "cancelled", "aborted", "interrupted"}
_PENDING_STATUSES = {"queued", "extracting", "schema_discovery", "extracted", "running", "in_progress"}


def _parse_run_layers(raw) -> list[str]:
    """Normalize persisted run layer CSV values to landing/bronze/silver."""
    layers: list[str] = []
    for part in str(raw or "").split(","):
        token = part.strip().lower()
        if token in ("lz", "landingzone"):
            token = "landing"
        if token in _RUN_LAYER_SET and token not in layers:
            layers.append(token)
    return layers or ["landing", "bronze", "silver"]


def _coerce_int_list(raw) -> list[int]:
    """Normalize JSON/list/CSV entity id inputs."""
    if raw is None or raw == "":
        return []
    values = raw if isinstance(raw, list) else str(raw).split(",")
    ids: list[int] = []
    for value in values:
        try:
            entity_id = int(value)
        except (TypeError, ValueError):
            continue
        if entity_id > 0 and entity_id not in ids:
            ids.append(entity_id)
    return ids


def _query_mapped_task_log_rows(
    *,
    run_id: str | None = None,
    entity_id: int | None = None,
    layer: str | None = None,
    status: str | None = None,
    min_task_id: int | None = None,
    hours_back: int | None = None,
    limit: int = 100,
    offset: int = 0,
    ascending: bool = False,
) -> list[dict]:
    """Return task-log rows normalized back to LandingzoneEntityId when possible."""
    cpdb = _get_cpdb()
    if not cpdb or not hasattr(cpdb, "_MAPPED_ENGINE_TASK_LOG_CTE"):
        return []

    where = ["mapped.LandingzoneEntityId IS NOT NULL"]
    params: list = []
    if run_id:
        where.append("mapped.RunId = ?")
        params.append(str(run_id))
    if entity_id is not None:
        where.append("mapped.LandingzoneEntityId = ?")
        params.append(int(entity_id))
    if layer:
        where.append("LOWER(mapped.Layer) = LOWER(?)")
        params.append(str(layer))
    if status:
        where.append("LOWER(mapped.Status) = LOWER(?)")
        params.append(str(status))
    if min_task_id is not None:
        where.append("t.id > ?")
        params.append(int(min_task_id))
    if hours_back is not None:
        where.append("COALESCE(mapped.LoadEndDateTime, t.created_at) >= datetime('now', ? || ' hours')")
        params.append(f"-{int(hours_back)}")

    order_clause = "t.id ASC" if ascending else "COALESCE(mapped.LoadEndDateTime, t.created_at) DESC, t.id DESC"
    sql = f"""
        {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
        SELECT
            t.id AS TaskId,
            mapped.RunId,
            mapped.LandingzoneEntityId AS EntityId,
            mapped.DataSourceId,
            mapped.Layer,
            mapped.Status,
            mapped.SourceTable AS SourceName,
            mapped.SourceSchema,
            mapped.SourceTable,
            mapped.SourceName,
            ds.Name AS DataSourceName,
            mapped.RowsRead,
            mapped.RowsWritten,
            t.BytesTransferred,
            t.DurationSeconds,
            t.ErrorType,
            t.ErrorMessage,
            t.ErrorSuggestion,
            t.LoadType,
            t.ExtractionMethod,
            COALESCE(mapped.LoadEndDateTime, t.created_at) AS created_at
        FROM mapped
        JOIN engine_task_log t ON t.id = mapped.id
        LEFT JOIN datasources ds ON ds.DataSourceId = mapped.DataSourceId
        WHERE {" AND ".join(where)}
        ORDER BY {order_clause}
        LIMIT ? OFFSET ?
    """
    params.extend([int(limit), int(offset)])
    return _db_query(sql, tuple(params))


def _get_run_latest_mapped_rows(run_id: str) -> list[dict]:
    """Return the latest mapped task row for each entity+layer in a run."""
    cpdb = _get_cpdb()
    if not cpdb or not hasattr(cpdb, "_MAPPED_ENGINE_TASK_LOG_CTE"):
        return []

    sql = f"""
        {cpdb._MAPPED_ENGINE_TASK_LOG_CTE},
        enriched AS (
            SELECT
                mapped.LandingzoneEntityId,
                mapped.DataSourceId,
                mapped.Layer,
                mapped.Status,
                mapped.LoadEndDateTime,
                mapped.RunId,
                mapped.RowsRead,
                mapped.RowsWritten,
                mapped.SourceTable,
                mapped.SourceSchema,
                mapped.SourceName,
                t.BytesTransferred,
                t.DurationSeconds,
                t.ErrorType,
                t.ErrorMessage,
                t.ErrorSuggestion,
                t.LoadType,
                t.ExtractionMethod,
                t.id
            FROM mapped
            JOIN engine_task_log t ON t.id = mapped.id
            WHERE mapped.RunId = ?
              AND mapped.LandingzoneEntityId IS NOT NULL
        ),
        ranked AS (
            SELECT
                *,
                ROW_NUMBER() OVER (
                    PARTITION BY LandingzoneEntityId, Layer
                    ORDER BY
                        LoadEndDateTime DESC,
                        CASE LOWER(COALESCE(Status, ''))
                            WHEN 'succeeded' THEN 1
                            WHEN 'failed' THEN 2
                            WHEN 'skipped' THEN 3
                            ELSE 4
                        END,
                        id DESC
                ) AS rn
            FROM enriched
        )
        SELECT
            LandingzoneEntityId,
            DataSourceId,
            Layer,
            Status,
            LoadEndDateTime,
            RunId,
            RowsRead,
            RowsWritten,
            SourceTable,
            SourceSchema,
            SourceName,
            BytesTransferred,
            DurationSeconds,
            ErrorType,
            ErrorMessage,
            ErrorSuggestion,
            LoadType,
            ExtractionMethod,
            id
        FROM ranked
        WHERE rn = 1
    """
    return _db_query(sql, (str(run_id),))


def _summarize_run_truth(run_id: str, layers_raw=None) -> dict:
    """Compute truthful per-run entity counts from mapped task-log rows."""
    run_layers = _parse_run_layers(layers_raw)
    latest_rows = _get_run_latest_mapped_rows(run_id)
    by_entity: dict[int, dict[str, str]] = {}
    total_rows = 0
    total_bytes = 0

    for row in latest_rows:
        entity_id = _to_int(row.get("LandingzoneEntityId"))
        layer = str(row.get("Layer") or "").lower()
        status = str(row.get("Status") or "").lower()
        if not entity_id or layer not in _RUN_LAYER_SET:
            continue
        by_entity.setdefault(entity_id, {})[layer] = status
        if status == "succeeded":
            total_rows += _to_int(row.get("RowsRead"))
            total_bytes += _to_int(row.get("BytesTransferred"))

    succeeded = 0
    failed = 0
    skipped = 0
    pending = 0

    for layer_statuses in by_entity.values():
        statuses = [layer_statuses.get(layer, "not_started") for layer in run_layers]
        attempted = [status for status in statuses if status != "not_started"]
        if not attempted:
            continue
        if any(status in _FAILURE_STATUSES for status in attempted):
            failed += 1
        elif any(status in _PENDING_STATUSES for status in attempted):
            pending += 1
        elif all(status in ("succeeded", "skipped") for status in statuses):
            if any(status == "skipped" for status in statuses):
                skipped += 1
            else:
                succeeded += 1
        else:
            pending += 1

    return {
        "run_layers": run_layers,
        "latest_rows": latest_rows,
        "succeeded": succeeded,
        "failed": failed,
        "skipped": skipped,
        "pending": pending,
        "completed": succeeded + failed + skipped,
        "total_rows": total_rows,
        "total_bytes": total_bytes,
    }


def _get_failed_run_entity_ids(run_id: str, layers_raw=None) -> list[int]:
    """Return scoped LandingzoneEntityIds that are currently failed in a run."""
    truth = _summarize_run_truth(run_id, layers_raw)
    failed_entity_ids: list[int] = []
    by_entity: dict[int, dict[str, str]] = {}

    for row in truth["latest_rows"]:
        entity_id = _to_int(row.get("LandingzoneEntityId"))
        layer = str(row.get("Layer") or "").lower()
        status = str(row.get("Status") or "").lower()
        if entity_id and layer in _RUN_LAYER_SET:
            by_entity.setdefault(entity_id, {})[layer] = status

    for entity_id, layer_statuses in by_entity.items():
        statuses = [layer_statuses.get(layer, "not_started") for layer in truth["run_layers"]]
        attempted = [status for status in statuses if status != "not_started"]
        if attempted and any(status in _FAILURE_STATUSES for status in attempted):
            failed_entity_ids.append(entity_id)

    return failed_entity_ids


def _selector_landing_status(status: str | None) -> str:
    normalized = str(status or "").strip().lower()
    if normalized == "succeeded":
        return "loaded"
    if normalized in _FAILURE_STATUSES:
        return "failed"
    if normalized in _PENDING_STATUSES:
        return "pending"
    return "never"


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
# PID liveness — cross-platform
# ---------------------------------------------------------------------------

def _is_pid_alive(pid: int) -> bool:
    """Check if a process with the given PID is alive. Works on Windows + POSIX."""
    if sys.platform == "win32":
        import ctypes
        kernel32 = ctypes.windll.kernel32
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if handle:
            kernel32.CloseHandle(handle)
            return True
        return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except (OSError, ProcessLookupError):
            return False


def _parse_utc(value: str | None) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _should_launch_with_dagster(body: dict, config: dict | None = None) -> bool:
    raw = (
        body.get("orchestrator")
        or os.getenv("FMD_ENGINE_ORCHESTRATOR")
        or ((config or {}).get("engine", {}) if isinstance(config, dict) else {}).get("orchestrator")
        or "legacy"
    )
    return str(raw).strip().lower() == "dagster"


def _dagster_runtime_mode(body: dict | None, config: dict | None = None) -> str:
    dagster_cfg = (config or {}).get("dagster", {}) if isinstance(config, dict) else {}
    raw = (
        (body or {}).get("dagster_mode")
        or (body or {}).get("runtime_mode")
        or os.getenv("FMD_DAGSTER_RUNTIME_MODE")
        or dagster_cfg.get("runtime_mode")
        or "dry_run"
    )
    if bool((body or {}).get("dry_run")):
        return "dry_run"
    return str(raw).strip().lower() or "dry_run"


def _is_real_framework_mode(body: dict | None, config: dict | None = None) -> bool:
    return _should_launch_with_dagster(body or {}, config) and _dagster_runtime_mode(body, config) == "framework"


def _windows_socket_stack_error() -> str | None:
    if os.name != "nt":
        return None
    try:
        import _overlapped  # noqa: F401, PLC0415
    except Exception as exc:
        return f"Python cannot import _overlapped: {exc}. Run an elevated Winsock reset/repair and reboot."
    return None


def _dagster_event_log_dir(config: dict | None, body: dict | None = None) -> Path:
    dagster_cfg = (config or {}).get("dagster", {}) if isinstance(config, dict) else {}
    raw = (
        (body or {}).get("event_log_dir")
        or os.getenv("FMD_DAGSTER_EVENT_LOG_DIR")
        or dagster_cfg.get("event_log_dir")
        or r"C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.runs"
    )
    return Path(str(raw)).resolve()


def _launch_dagster_request(
    *,
    run_id: str,
    mode: str,
    layers: list[str],
    entity_ids: list[int],
    triggered_by: str,
    body: dict,
    config: dict,
) -> dict:
    request = SimpleNamespace(
        run_id=run_id,
        mode=mode,
        layers=list(layers or ["landing", "bronze", "silver"]),
        entity_ids=list(entity_ids or []),
        triggered_by=triggered_by,
    )
    launch = launch_dagster_run(request=request, body=body, config=config)
    dagster_cfg = config.get("dagster", {}) if isinstance(config, dict) else {}
    _start_dagster_event_poller(
        run_id=run_id,
        layers=request.layers,
        entity_ids=request.entity_ids,
        event_log_dir=_dagster_event_log_dir(config, body),
        timeout_seconds=int(dagster_cfg.get("event_sync_timeout_seconds") or 180),
    )
    return launch.to_api_payload(mode=mode)


def _start_dagster_event_poller(
    *,
    run_id: str,
    layers: list[str],
    entity_ids: list[int],
    event_log_dir: Path,
    timeout_seconds: int,
) -> None:
    thread = threading.Thread(
        target=_poll_dagster_event_log,
        args=(run_id, list(layers or []), list(entity_ids or []), event_log_dir, timeout_seconds),
        name=f"dagster-event-sync-{run_id[:8]}",
        daemon=True,
    )
    thread.start()


def _poll_dagster_event_log(
    run_id: str,
    layers: list[str],
    entity_ids: list[int],
    event_log_dir: Path,
    timeout_seconds: int,
) -> None:
    event_path = event_log_dir / f"{run_id}.jsonl"
    expected_layers = _parse_run_layers(",".join(layers or []))
    seen_layers: dict[str, str] = {}
    inserted = {"succeeded": 0, "failed": 0, "skipped": 0}
    entity_layer_statuses: dict[int, dict[str, str]] = {}
    framework_seen = False
    offset = 0
    deadline = time.time() + max(timeout_seconds, 15)

    while time.time() < deadline:
        if event_path.exists():
            try:
                with event_path.open("r", encoding="utf-8") as handle:
                    handle.seek(offset)
                    lines = handle.readlines()
                    offset = handle.tell()
            except OSError as exc:
                log.warning("Failed to read Dagster event log %s: %s", event_path, exc)
                lines = []

            for line in lines:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                status = _sync_dagster_event_to_task_log(run_id, event, entity_ids)
                if str(event.get("mode") or "").strip().lower() == "framework":
                    framework_seen = True
                layer = str(event.get("layer") or "").strip().lower()
                if layer:
                    seen_layers[layer] = status
                    for entity_id in _event_entity_ids(event, entity_ids):
                        entity_layer_statuses.setdefault(entity_id, {})[layer] = status
                if status in inserted:
                    inserted[status] += max(1, len(_event_entity_ids(event, entity_ids)))

            if seen_layers and all(layer in seen_layers for layer in expected_layers):
                succeeded_entities = 0
                failed_entities = 0
                skipped_entities = 0

                for layer_statuses in entity_layer_statuses.values():
                    statuses = [layer_statuses.get(layer, "not_started") for layer in expected_layers]
                    attempted = [status for status in statuses if status != "not_started"]
                    if not attempted:
                        continue
                    if any(status in _FAILURE_STATUSES for status in attempted):
                        failed_entities += 1
                    elif all(status in ("succeeded", "skipped") for status in statuses):
                        if any(status == "skipped" for status in statuses):
                            skipped_entities += 1
                        else:
                            succeeded_entities += 1

                total_entities = len(entity_layer_statuses) or max(len(entity_ids), 1)
                failed = failed_entities
                final_status = "Failed" if failed else "Succeeded"
                error_summary = "Dagster run failed. Review Dagster logs." if failed else ""
                aggregate = _aggregate_run_from_task_log(run_id) if framework_seen else None
                if aggregate:
                    succeeded_entities = aggregate["succeeded"]
                    failed_entities = aggregate["failed"]
                    skipped_entities = aggregate["skipped"]
                    failed = failed_entities
                    final_status = "Failed" if failed else "Succeeded"
                    total_entities = max(total_entities, succeeded_entities + failed_entities + skipped_entities)
                _db_execute(
                    "UPDATE engine_runs "
                    "SET Status = ?, "
                    "    SucceededEntities = ?, "
                    "    FailedEntities = ?, "
                    "    SkippedEntities = ?, "
                    "    TotalEntities = ?, "
                    "    CompletedUnits = ?, "
                    "    TotalRowsRead = ?, "
                    "    TotalRowsWritten = ?, "
                    "    TotalBytesTransferred = ?, "
                    "    TotalDurationSeconds = ?, "
                    "    CurrentLayer = ?, "
                    "    ErrorSummary = ?, "
                    "    EndedAt = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
                    "    HeartbeatAt = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
                    "    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') "
                    "WHERE RunId = ?",
                    (
                        final_status,
                        succeeded_entities,
                        failed_entities,
                        skipped_entities,
                        total_entities,
                        sum(inserted.values()),
                        aggregate["rows_read"] if aggregate else 0,
                        aggregate["rows_written"] if aggregate else 0,
                        aggregate["bytes_transferred"] if aggregate else 0,
                        aggregate["duration_seconds"] if aggregate else 0,
                        next(reversed(seen_layers.keys()), ""),
                        error_summary,
                        run_id,
                    ),
                )
                _write_pipeline_audit_terminal(run_id, final_status, error_summary or "Dagster run completed")
                return

        time.sleep(0.5)

    _db_execute(
        "UPDATE engine_runs "
        "SET Status = 'Failed', "
        "    ErrorSummary = ?, "
        "    EndedAt = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
        "    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') "
        "WHERE RunId = ? AND Status IN ('InProgress', 'running', 'Starting', 'starting')",
        (f"Dagster event log did not complete before timeout: {event_path}", run_id),
    )
    _write_pipeline_audit_terminal(run_id, "Failed", "Dagster event log sync timed out")


def _event_entity_ids(event: dict, fallback_entity_ids: list[int]) -> list[int]:
    details = event.get("details") if isinstance(event.get("details"), dict) else {}
    results = details.get("results") if isinstance(details.get("results"), list) else []
    raw_ids = details.get("entity_ids") or fallback_entity_ids or [0]
    if results:
        raw_ids = [item.get("entity_id") for item in results if isinstance(item, dict)]
    ids: list[int] = []
    for raw in raw_ids:
        try:
            ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    return ids or [0]


def _event_result_rows(event: dict, fallback_entity_ids: list[int]) -> list[dict]:
    details = event.get("details") if isinstance(event.get("details"), dict) else {}
    results = details.get("results") if isinstance(details.get("results"), list) else []
    rows = [item for item in results if isinstance(item, dict) and item.get("entity_id") is not None]
    if rows:
        return rows
    layer = str(event.get("layer") or "").strip().lower()
    status = str(event.get("status") or "unknown").strip().lower()
    return [
        {
            "entity_id": entity_id,
            "layer": layer,
            "status": status,
            "rows_read": 0,
            "rows_written": 0,
            "bytes_transferred": 0,
            "duration_seconds": 0,
            "load_type": str(event.get("mode") or "dagster"),
            "error": event.get("error") or "",
        }
        for entity_id in _event_entity_ids(event, fallback_entity_ids)
    ]


def _terminal_task_row_exists(run_id: str, entity_id: int, layer: str) -> bool:
    rows = _db_query(
        "SELECT 1 FROM engine_task_log "
        "WHERE RunId = ? AND EntityId = ? AND LOWER(COALESCE(Layer, '')) = LOWER(?) "
        "AND LOWER(COALESCE(Status, '')) IN ('succeeded', 'failed', 'skipped', 'cancelled', 'aborted', 'interrupted') "
        "LIMIT 1",
        (run_id, entity_id, layer),
    )
    return bool(rows)


def _aggregate_run_from_task_log(run_id: str, layers: list[str] | None = None) -> dict:
    layer_filter = ""
    params: list = [run_id]
    normalized_layers = _parse_run_layers(",".join(layers or [])) if layers else []
    if normalized_layers:
        placeholders = ",".join("?" for _ in normalized_layers)
        layer_filter = f" AND LOWER(COALESCE(Layer, '')) IN ({placeholders})"
        params.extend(normalized_layers)
    rows = _db_query(
        "SELECT "
        "SUM(CASE WHEN LOWER(COALESCE(Status, '')) = 'succeeded' THEN 1 ELSE 0 END) AS succeeded, "
        "SUM(CASE WHEN LOWER(COALESCE(Status, '')) = 'failed' THEN 1 ELSE 0 END) AS failed, "
        "SUM(CASE WHEN LOWER(COALESCE(Status, '')) = 'skipped' THEN 1 ELSE 0 END) AS skipped, "
        "SUM(COALESCE(RowsRead, 0)) AS rows_read, "
        "SUM(COALESCE(RowsWritten, 0)) AS rows_written, "
        "SUM(COALESCE(BytesTransferred, 0)) AS bytes_transferred, "
        "SUM(COALESCE(DurationSeconds, 0)) AS duration_seconds "
        "FROM engine_task_log "
        "WHERE RunId = ? "
        "AND LOWER(COALESCE(Status, '')) IN ('succeeded', 'failed', 'skipped')"
        f"{layer_filter}",
        tuple(params),
    )
    row = rows[0] if rows else {}
    return {
        "succeeded": _to_int(row.get("succeeded")),
        "failed": _to_int(row.get("failed")),
        "skipped": _to_int(row.get("skipped")),
        "rows_read": _to_int(row.get("rows_read")),
        "rows_written": _to_int(row.get("rows_written")),
        "bytes_transferred": _to_int(row.get("bytes_transferred")),
        "duration_seconds": _to_float(row.get("duration_seconds")),
    }


def _sync_framework_event_to_task_log(run_id: str, event: dict, fallback_entity_ids: list[int]) -> str:
    layer = str(event.get("layer") or "").strip().lower()
    raw_status = str(event.get("status") or "").strip().lower()
    status = {
        "success": "succeeded",
        "succeeded": "succeeded",
        "failed": "failed",
        "failure": "failed",
        "skipped": "skipped",
    }.get(raw_status, raw_status or "unknown")
    now = str(event.get("timestamp") or "")
    log_data = json.dumps(event, sort_keys=True)

    inserted_fallback = 0
    for item in _event_result_rows(event, fallback_entity_ids):
        entity_id = _to_int(item.get("entity_id"))
        item_layer = str(item.get("layer") or layer).strip().lower()
        if entity_id <= 0 or not item_layer:
            continue
        if _terminal_task_row_exists(run_id, entity_id, item_layer):
            continue
        item_status = {
            "success": "succeeded",
            "succeeded": "succeeded",
            "failed": "failed",
            "failure": "failed",
            "skipped": "skipped",
        }.get(str(item.get("status") or status).strip().lower(), status)
        _db_execute(
            "INSERT INTO engine_task_log "
            "(RunId, EntityId, Layer, Status, SourceServer, SourceDatabase, SourceTable, "
            "RowsRead, RowsWritten, BytesTransferred, DurationSeconds, TargetLakehouse, "
            "TargetPath, LoadType, ErrorType, ErrorMessage, ErrorSuggestion, LogData, "
            "ExtractionMethod, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
            "COALESCE(NULLIF(?, ''), strftime('%Y-%m-%dT%H:%M:%SZ','now')))",
            (
                run_id,
                entity_id,
                item_layer,
                item_status,
                "Dagster",
                "FMD_FRAMEWORK",
                f"Framework {item_layer}",
                _to_int(item.get("rows_read")),
                _to_int(item.get("rows_written")),
                _to_int(item.get("bytes_transferred")),
                _to_float(item.get("duration_seconds")),
                item_layer,
                str(item.get("target_path") or f"dagster://{run_id}/{item_layer}"),
                str(item.get("load_type") or "framework_event_fallback"),
                "dagster" if item_status == "failed" else "",
                str(item.get("error") or ""),
                str(item.get("error_suggestion") or ("Open the embedded Dagster run logs for this run." if item_status == "failed" else "")),
                log_data,
                str(item.get("extraction_method") or "framework_event_fallback"),
                now,
            ),
        )
        inserted_fallback += 1

    aggregate = _aggregate_run_from_task_log(run_id)
    _db_execute(
        "UPDATE engine_runs "
        "SET CurrentLayer = ?, "
        "    SucceededEntities = ?, "
        "    FailedEntities = ?, "
        "    SkippedEntities = ?, "
        "    CompletedUnits = ?, "
        "    TotalRowsRead = ?, "
        "    TotalRowsWritten = ?, "
        "    TotalBytesTransferred = ?, "
        "    TotalDurationSeconds = ?, "
        "    HeartbeatAt = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
        "    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') "
        "WHERE RunId = ?",
        (
            layer,
            aggregate["succeeded"],
            aggregate["failed"],
            aggregate["skipped"],
            aggregate["succeeded"] + aggregate["failed"] + aggregate["skipped"],
            aggregate["rows_read"],
            aggregate["rows_written"],
            aggregate["bytes_transferred"],
            aggregate["duration_seconds"],
            run_id,
        ),
    )
    if inserted_fallback:
        log.info("Inserted %d framework fallback task rows for Dagster run %s", inserted_fallback, run_id[:8])
    return status


def _sync_dagster_event_to_task_log(run_id: str, event: dict, fallback_entity_ids: list[int]) -> str:
    layer = str(event.get("layer") or "").strip().lower()
    raw_status = str(event.get("status") or "").strip().lower()
    status = {
        "success": "succeeded",
        "succeeded": "succeeded",
        "failed": "failed",
        "failure": "failed",
        "skipped": "skipped",
    }.get(raw_status, raw_status or "unknown")
    now = str(event.get("timestamp") or "")
    log_data = json.dumps(event, sort_keys=True)
    error = event.get("error") or ""
    mode = str(event.get("mode") or "dagster")

    if mode == "framework":
        return _sync_framework_event_to_task_log(run_id, event, fallback_entity_ids)

    for entity_id in _event_entity_ids(event, fallback_entity_ids):
        _db_execute(
            "INSERT INTO engine_task_log "
            "(RunId, EntityId, Layer, Status, SourceServer, SourceDatabase, SourceTable, "
            "RowsRead, RowsWritten, BytesTransferred, DurationSeconds, TargetLakehouse, "
            "TargetPath, LoadType, ErrorType, ErrorMessage, ErrorSuggestion, LogData, "
            "ExtractionMethod, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, 'dagster', "
            "COALESCE(NULLIF(?, ''), strftime('%Y-%m-%dT%H:%M:%SZ','now')))",
            (
                run_id,
                entity_id,
                layer,
                status,
                "Dagster",
                "FMD_ORCHESTRATOR",
                f"Dagster {layer}",
                layer,
                f"dagster://{run_id}/{layer}",
                mode,
                "dagster" if status == "failed" else "",
                str(error),
                "Open the embedded Dagster run logs for this run." if status == "failed" else "",
                log_data,
                now,
            ),
        )
    _db_execute(
        "UPDATE engine_runs "
        "SET CurrentLayer = ?, "
        "    HeartbeatAt = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
        "    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') "
        "WHERE RunId = ?",
        (layer, run_id),
    )
    return status


def _reconcile_open_extracting_rows(run_id: str, reason: str) -> None:
    """Convert stranded extracting rows into terminal failures for a dead run."""
    _db_execute(
        """
        UPDATE engine_task_log
        SET Status = 'failed',
            ErrorType = CASE
                WHEN COALESCE(ErrorType, '') = '' THEN 'worker_exit'
                ELSE ErrorType
            END,
            ErrorMessage = CASE
                WHEN COALESCE(ErrorMessage, '') = ''
                     OR ErrorMessage LIKE 'Extracting (%'
                THEN ?
                ELSE ErrorMessage
            END,
            ErrorSuggestion = CASE
                WHEN COALESCE(ErrorSuggestion, '') = ''
                THEN 'Inspect the worker log, fix the underlying issue, and rerun the table.'
                ELSE ErrorSuggestion
            END
        WHERE id IN (
            SELECT start.id
            FROM engine_task_log start
            LEFT JOIN engine_task_log terminal
              ON terminal.RunId = start.RunId
             AND terminal.EntityId = start.EntityId
             AND COALESCE(terminal.Layer, '') = COALESCE(start.Layer, '')
             AND terminal.id > start.id
             AND LOWER(COALESCE(terminal.Status, '')) IN ('succeeded', 'failed', 'skipped', 'cancelled')
            WHERE start.RunId = ?
              AND LOWER(COALESCE(start.Status, '')) = 'extracting'
              AND terminal.id IS NULL
        )
        """,
        (reason, run_id),
    )


def _mark_dead_run_failed(run_id: str, reason: str) -> None:
    _db_execute(
        "UPDATE engine_runs "
        "SET Status = 'Failed', "
        "    EndedAt = COALESCE(EndedAt, strftime('%Y-%m-%dT%H:%M:%SZ','now')), "
        "    ErrorSummary = ? "
        "WHERE RunId = ?",
        (f"Failed: {reason}", run_id),
    )
    _reconcile_open_extracting_rows(run_id, reason)
    _write_pipeline_audit_terminal(run_id, "Failed", reason)


# ---------------------------------------------------------------------------
# Startup cleanup
# ---------------------------------------------------------------------------

def _cleanup_orphaned_runs() -> None:
    """Mark orphaned InProgress runs as Failed on startup.

    A run is orphaned if:
    - Status is InProgress AND
    - WorkerPid is set AND the process is no longer alive, OR
    - WorkerPid is NULL (legacy daemon-thread run that died with the server)

    Grace window: runs started within the last 120 seconds are skipped — the
    worker may still be spinning up and hasn't sent its first heartbeat yet.
    """
    try:
        orphaned = _db_query(
            "SELECT RunId, WorkerPid, StartedAt, HeartbeatAt FROM engine_runs "
            "WHERE Status IN ('InProgress', 'running')"
        )
        if not orphaned:
            return

        now = datetime.now(UTC)
        cleaned = 0

        for run in orphaned:
            # Grace window: skip recently started runs
            started = _parse_utc(run.get("StartedAt"))
            if started and (now - started).total_seconds() < _STARTUP_GRACE_SECONDS:
                log.debug(
                    "Skipping run %s — within %ds grace window",
                    run["RunId"][:8], _STARTUP_GRACE_SECONDS,
                )
                continue

            # PID liveness check (Windows-safe)
            pid = run.get("WorkerPid")
            if pid:
                try:
                    if _is_pid_alive(int(pid)):
                        log.debug("Run %s worker PID %d still alive — not orphaned",
                                  run["RunId"][:8], pid)
                        continue  # Process alive — not an orphan
                except (TypeError, ValueError):
                    pass  # Bad PID value — treat as orphan

            heartbeat = _parse_utc(run.get("HeartbeatAt"))
            last_touch = heartbeat or started
            if last_touch and (now - last_touch).total_seconds() < _STARTUP_GRACE_SECONDS:
                continue

            _mark_dead_run_failed(run["RunId"], "Worker process died or server restarted")
            cleaned += 1

        if cleaned:
            log.info("Marked %d orphaned runs as Failed on startup", cleaned)
    except Exception as exc:
        log.warning("Failed to clean up orphaned runs: %s", exc)


# ---------------------------------------------------------------------------
# Periodic orphan cleanup — runs every 5 minutes in a daemon thread
# ---------------------------------------------------------------------------

_cleanup_thread: Optional[threading.Thread] = None
_CLEANUP_INTERVAL_SECONDS = 300  # 5 minutes
_MAX_RUN_AGE_HOURS = 24  # runs older than this with dead PIDs → auto-interrupt
_STARTUP_GRACE_SECONDS = 120
_STALE_HEARTBEAT_SECONDS = 300


def _periodic_cleanup_loop() -> None:
    """Background loop: clean up orphaned runs every 5 minutes."""
    while True:
        time.sleep(_CLEANUP_INTERVAL_SECONDS)
        try:
            cleaned = _cleanup_stale_runs()
            if cleaned:
                log.info("Periodic cleanup: marked %d stale runs as Failed", cleaned)
        except Exception as exc:
            log.warning("Periodic cleanup failed: %s", exc)


def _cleanup_stale_runs() -> int:
    """Find and mark runs that are stale (dead PID or exceeded max age).

    Returns the number of runs cleaned up.
    """
    orphaned = _db_query(
        "SELECT RunId, WorkerPid, StartedAt, HeartbeatAt FROM engine_runs "
        "WHERE Status IN ('InProgress', 'running')"
    )
    if not orphaned:
        return 0

    now = datetime.now(UTC)
    cleaned = 0

    for run in orphaned:
        run_id = run["RunId"]
        pid = run.get("WorkerPid")
        started = _parse_utc(run.get("StartedAt"))
        if started and (now - started).total_seconds() < _STARTUP_GRACE_SECONDS:
            continue

        # Check 1: PID is dead → orphaned (Windows-safe)
        pid_dead = False
        if pid:
            try:
                pid_dead = not _is_pid_alive(int(pid))
            except (TypeError, ValueError):
                pid_dead = True
        else:
            pid_dead = True  # No PID recorded → legacy or lost

        # Only interrupt runs whose worker PID is confirmed dead.
        # A live PID means the worker is still running — never kill it.
        if not pid_dead:
            continue

        heartbeat = _parse_utc(run.get("HeartbeatAt"))
        last_touch = heartbeat or started
        if last_touch and (now - last_touch).total_seconds() < _STALE_HEARTBEAT_SECONDS:
            continue

        reason = "Worker process died or server restarted"
        _mark_dead_run_failed(run_id, reason)
        cleaned += 1

    return cleaned


def _start_periodic_cleanup() -> None:
    """Start the background cleanup thread (idempotent)."""
    global _cleanup_thread
    if _cleanup_thread is not None and _cleanup_thread.is_alive():
        return
    _cleanup_thread = threading.Thread(
        target=_periodic_cleanup_loop,
        daemon=True,
        name="orphan-cleanup",
    )
    _cleanup_thread.start()
    log.info("Started periodic orphan cleanup thread (every %ds)", _CLEANUP_INTERVAL_SECONDS)


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
            elif sub_path == "/runtime":
                _handle_runtime(handler, config)
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
            elif sub_path == "/smoke-entity":
                _handle_smoke_entity(handler)
            else:
                handler._error_response(f"Unknown engine GET endpoint: {sub_path}", 404)

        # ── POST routes ──
        elif method == "POST":
            # Read body
            content_length = int(handler.headers.get("Content-Length", 0))
            body = json.loads(handler.rfile.read(content_length)) if content_length else {}

            if sub_path == "/start":
                _handle_start(handler, config, body)
            elif sub_path == "/preflight":
                _handle_preflight(handler, config, body)
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
            elif sub_path == "/cleanup-runs":
                _handle_cleanup_runs(handler)
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
    if _should_launch_with_dagster({}, config):
        engine_cfg = config.get("engine", {}) if isinstance(config, dict) else {}
        response = {
            "status": "idle",
            "current_run_id": None,
            "uptime_seconds": 0,
            "engine_version": ENGINE_VERSION,
            "orchestrator": "dagster",
            "load_method": engine_cfg.get("load_method", "local"),
            "pipeline_fallback": bool(engine_cfg.get("pipeline_fallback", False)),
            "pipeline_configured": bool(engine_cfg.get("pipeline_copy_sql_id")),
            "last_run": None,
        }
    else:
        engine = _get_or_create_engine(config)
        response = {
            "status": engine.status,
            "current_run_id": engine.current_run_id,
            "uptime_seconds": round(time.time() - _engine_start_time, 1) if _engine_start_time else 0,
            "engine_version": ENGINE_VERSION,
            "orchestrator": "legacy",
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
        truth = _summarize_run_truth(
            str(row.get("RunId", "")),
            row.get("Layers", ""),
        )
        run_info = {
            "run_id": str(row.get("RunId", "")),
            "status": str(row.get("Status", "")),
            "mode": str(row.get("Mode", "")),
            "started_at": row.get("StartedAt") or None,
            "finished_at": row.get("EndedAt") or None,
            "total": _to_int(row.get("TotalEntities")),
            "succeeded": truth["succeeded"] if truth["latest_rows"] else _to_int(row.get("SucceededEntities")),
            "failed": truth["failed"] if truth["latest_rows"] else _to_int(row.get("FailedEntities")),
            "skipped": truth["skipped"] if truth["latest_rows"] else _to_int(row.get("SkippedEntities")),
            "pending": truth["pending"] if truth["latest_rows"] else 0,
            "total_rows": truth["total_rows"] if truth["latest_rows"] else _to_int(row.get("TotalRowsRead")),
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
                worker_alive = _is_pid_alive(int(worker_pid))
            except (TypeError, ValueError):
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

        if response["status"] == "idle" and row.get("Status") in ("InProgress", "running"):
            response["status"] = "running"
            response["current_run_id"] = run_info["run_id"]

        # If the in-process engine is idle but a worker subprocess is alive
        # and running (spawned via _spawn_worker), reflect that in top-level status
        if response["status"] == "idle" and worker_alive:
            response["status"] = "running"
            response["current_run_id"] = run_info["run_id"]

    handler._json_response(response)


# ---------------------------------------------------------------------------
# GET /api/engine/runtime
# ---------------------------------------------------------------------------

def _handle_runtime(handler, config: dict) -> None:
    """Return the current orchestration/runtime mode without exposing secrets."""
    engine_cfg = config.get("engine", {}) if isinstance(config, dict) else {}
    dagster_cfg = config.get("dagster", {}) if isinstance(config, dict) else {}
    orchestrator = str(
        os.getenv("FMD_ENGINE_ORCHESTRATOR")
        or engine_cfg.get("orchestrator")
        or "legacy"
    ).strip().lower()
    runtime_mode = _dagster_runtime_mode({}, config)
    load_method = str(engine_cfg.get("load_method") or "local").strip().lower()
    framework_path = str(
        os.getenv("FMD_FRAMEWORK_PATH")
        or dagster_cfg.get("framework_path")
        or Path(__file__).resolve().parent.parent
    )
    dagster_url = str(
        os.getenv("FMD_DAGSTER_UI_URL")
        or dagster_cfg.get("ui_url")
        or "http://127.0.0.1:3006"
    ).rstrip("/")
    real_load_enabled = orchestrator == "dagster" and runtime_mode == "framework"

    warnings: list[str] = []
    if orchestrator == "dagster" and runtime_mode == "dry_run":
        warnings.append(
            "Dry-run mode validates orchestration only. It does not extract source rows or write lakehouse data."
        )
    if load_method == "local":
        warnings.append("Local load method requires VPN/source DB reachability and OneLake write access.")
    if real_load_enabled and not framework_path:
        warnings.append("Framework mode is enabled but the FMD framework path is empty.")
    socket_error = _windows_socket_stack_error()
    if socket_error:
        warnings.append(socket_error)

    handler._json_response({
        "orchestrator": orchestrator,
        "dagsterRuntimeMode": runtime_mode,
        "loadMethod": load_method,
        "frameworkPath": framework_path,
        "dagsterUrl": dagster_url,
        "realLoadEnabled": real_load_enabled,
        "dryRun": runtime_mode == "dry_run",
        "warnings": warnings,
        "socketStackOk": socket_error is None,
    })


# ---------------------------------------------------------------------------
# POST /api/engine/preflight
# ---------------------------------------------------------------------------

def _preflight_check(check_id: str, label: str, status: str, message: str) -> dict:
    return {
        "id": check_id,
        "label": label,
        "status": status,
        "passed": status == "passed",
        "message": message,
    }


def _handle_preflight(handler, config: dict, body: dict) -> None:
    """Run real-load readiness checks without extracting or writing data."""
    checks: list[dict] = []
    runtime_mode = _dagster_runtime_mode(body, config)
    engine_cfg = config.get("engine", {}) if isinstance(config, dict) else {}
    load_method = str(engine_cfg.get("load_method") or "local").strip().lower()
    entity_ids = _coerce_int_list(body.get("entity_ids"))
    layers = _parse_run_layers(",".join(body.get("layers") or []))
    wants_framework = runtime_mode == "framework"

    checks.append(_preflight_check(
        "runtime_mode",
        "Dagster runtime mode",
        "passed" if wants_framework else "failed",
        (
            "Dagster is configured for framework mode; real data movement is allowed."
            if wants_framework
            else "Configured mode is dry_run. This validates orchestration only and will not move data."
        ),
    ))
    checks.append(_preflight_check(
        "load_method",
        "Engine load method",
        "passed" if load_method in {"local", "pipeline", "notebook"} else "failed",
        f"Configured load method: {load_method or 'unknown'}.",
    ))
    socket_error = _windows_socket_stack_error()
    checks.append(_preflight_check(
        "windows_socket_stack",
        "Windows Python socket stack",
        "passed" if socket_error is None else "failed",
        "Python asyncio/socket imports are healthy." if socket_error is None else socket_error,
    ))

    if wants_framework and not entity_ids and not body.get("confirm_full_estate_real_load"):
        checks.append(_preflight_check(
            "scope_guard",
            "Real-load scope guard",
            "failed",
            "Framework mode requires explicit entity_ids unless confirm_full_estate_real_load=true is supplied.",
        ))
        handler._json_response({
            "ok": False,
            "runtimeMode": runtime_mode,
            "loadMethod": load_method,
            "entityIds": entity_ids,
            "layers": layers,
            "checks": checks,
        })
        return

    try:
        engine = _get_or_create_engine(config)
    except Exception as exc:
        checks.append(_preflight_check(
            "engine_init",
            "Engine initialization",
            "failed",
            f"Engine could not initialize: {exc}",
        ))
        handler._json_response({
            "ok": False,
            "runtimeMode": runtime_mode,
            "loadMethod": load_method,
            "entityIds": entity_ids,
            "layers": layers,
            "checks": checks,
        })
        return

    try:
        entities = engine.get_worklist(entity_ids) if entity_ids else None
        report = engine.preflight(entity_ids=entity_ids if entity_ids else None)
        for item in report.to_dict().get("checks", []):
            name = str(item.get("name") or "check")
            passed = bool(item.get("passed"))
            checks.append(_preflight_check(
                name.lower().replace(" ", "_").replace("/", "_"),
                name,
                "passed" if passed else "failed",
                str(item.get("message") or ""),
            ))
        if entity_ids:
            resolved_ids = {int(getattr(entity, "id", 0)) for entity in entities or []}
            missing = [entity_id for entity_id in entity_ids if entity_id not in resolved_ids]
            checks.append(_preflight_check(
                "entity_scope",
                "Selected entity scope",
                "passed" if not missing else "failed",
                (
                    f"{len(resolved_ids)} selected active entities resolved."
                    if not missing
                    else f"These selected entity IDs are not active/resolvable: {', '.join(str(i) for i in missing)}"
                ),
            ))
    except Exception as exc:
        checks.append(_preflight_check(
            "preflight_exception",
            "Preflight execution",
            "failed",
            f"Preflight failed before any data movement: {exc}",
        ))

    ok = all(check.get("status") in {"passed", "warning"} for check in checks)
    handler._json_response({
        "ok": ok,
        "runtimeMode": runtime_mode,
        "loadMethod": load_method,
        "entityIds": entity_ids,
        "layers": layers,
        "checks": checks,
    })


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
                rows = _query_mapped_task_log_rows(
                    run_id=run_id,
                    min_task_id=last_id,
                    limit=50,
                    ascending=True,
                )
                if not rows:
                    rows = _db_query(
                        "SELECT id AS TaskId, RunId, EntityId, SourceTable AS SourceName, Layer, Status, "
                        "RowsRead, RowsWritten, DurationSeconds, ErrorMessage "
                        "FROM engine_task_log WHERE RunId = ? AND id > ? ORDER BY id LIMIT 50",
                        (run_id, last_id),
                    )
                for row in rows:
                    _publish_entity_result(
                        run_id=row.get("RunId", run_id),
                        entity_id=row.get("EntityId", 0),
                        entity_name=row.get("SourceName", ""),
                        layer=row.get("Layer", ""),
                        status=row.get("Status", ""),
                        rows_read=row.get("RowsRead", 0),
                        rows_written=row.get("RowsWritten", 0),
                        duration_seconds=row.get("DurationSeconds", 0),
                        error=row.get("ErrorMessage"),
                    )
                    last_id = row.get("TaskId", last_id)

                # Emit bulk progress — use task_log as source of truth
                # (engine_runs heartbeat counter resets on resume, task_log doesn't)
                run_rows = _db_query(
                    "SELECT Status, TotalEntities, ActiveWorkers, EtaSeconds, Layers "
                    "FROM engine_runs WHERE RunId = ?", (run_id,)
                )
                if run_rows:
                    run = run_rows[0]
                    truth = _summarize_run_truth(run_id, run.get("Layers"))
                    total_ent = run.get("TotalEntities", 0) or 0
                    succeeded = truth["succeeded"]
                    failed = truth["failed"]
                    skipped = truth["skipped"]
                    done = truth["completed"]
                    if done > 0 and total_ent > 0:
                        _SSEHook.publish("bulk_progress", {
                            "run_id": run_id,
                            "completed": done,
                            "total": total_ent,
                            "succeeded": succeeded,
                            "failed": failed,
                            "skipped": skipped,
                            "pending": truth["pending"],
                            "total_rows": truth["total_rows"],
                            "total_bytes": truth["total_bytes"],
                            "pct": round(done / total_ent * 100, 1),
                            "active_workers": run.get("ActiveWorkers", 0) or 0,
                            "eta_seconds": run.get("EtaSeconds", 0) or 0,
                        })

                    # Check if run completed
                    if run.get("Status") not in ("InProgress", "running"):
                        status = run.get("Status", "Unknown")
                        _publish_log("info", f"Run {run_id[:8]} finished: {status}")
                        _SSEHook.publish("run_complete", {"status": status, "run_id": run_id})
                        break
            except Exception as exc:
                log.debug("SSE poller error (non-fatal): %s", exc)
            time.sleep(2)

    threading.Thread(target=_poll, daemon=True, name=f"sse-poll-{run_id[:8]}").start()


def _get_live_active_run() -> Optional[dict]:
    """Return the active run whose worker PID is still alive, if any."""
    active_runs = _db_query(
        "SELECT RunId, WorkerPid, HeartbeatAt FROM engine_runs "
        "WHERE Status IN ('InProgress', 'running')"
    )
    for run in active_runs:
        pid = run.get("WorkerPid")
        if not pid:
            continue
        try:
            if _is_pid_alive(int(pid)):
                return run
        except (TypeError, ValueError):
            continue
    return None


def _handle_start(handler, config: dict, body: dict) -> None:
    """Start the engine as a detached worker subprocess.

    Pre-generates run_id, pre-creates engine_runs row, spawns worker,
    returns immediately. No race conditions — run_id is known before spawn.
    """
    active_run = _get_live_active_run()
    if active_run:
        handler._json_response({
            "error": "Engine is already running",
            "current_run_id": active_run.get("RunId"),
        }, status=409)
        return

    mode = body.get("mode", "run")
    layers = body.get("layers")       # list or None
    entity_ids = _coerce_int_list(body.get("entity_ids")) or None
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

    if _is_real_framework_mode(body, config) and not entity_ids and not body.get("confirm_full_estate_real_load"):
        handler._error_response(
            "Real framework mode requires explicit entity_ids or confirm_full_estate_real_load=true.",
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
    # Bulk mode defaults to landing-only (fast extract and land)
    if mode == "bulk" and not layers:
        layers = ["landing"]
    layer_str = ",".join(layers) if layers else "landing,bronze,silver"

    # Persist entity filter so resume can recover the original scope
    entity_filter_str = ",".join(str(i) for i in entity_ids) if entity_ids else ""

    # Persist source filter and resolved count for scope transparency
    source_filter = body.get("source_filter") or []
    source_filter_str = ",".join(source_filter) if source_filter else ""
    resolved_entity_count = body.get("resolved_entity_count") or (len(entity_ids) if entity_ids else 0)

    # Pre-create engine_runs row — API owns this, worker will upsert into it
    _db_execute(
        "INSERT INTO engine_runs (RunId, Mode, Status, Layers, TriggeredBy, EntityFilter, "
        "SourceFilter, ResolvedEntityCount, StartedAt) "
        "VALUES (?, ?, 'InProgress', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
        (run_id, mode, layer_str, triggered_by, entity_filter_str,
         source_filter_str, resolved_entity_count),
    )

    _publish_log("info", f"Engine starting: run_id={run_id[:8]}, layers={layer_str}, "
                 f"sources={source_filter_str or 'all'}, "
                 f"entities={resolved_entity_count or 'all'}, "
                 f"triggered_by={triggered_by}")

    if _should_launch_with_dagster(body, config):
        try:
            payload = _launch_dagster_request(
                run_id=run_id,
                mode=mode,
                layers=layers,
                entity_ids=entity_ids,
                triggered_by=triggered_by,
                body=body,
                config=config,
            )
            handler._json_response(payload)
        except DagsterBridgeError as exc:
            _db_execute(
                "UPDATE engine_runs "
                "SET Status = 'Failed', "
                "    ErrorSummary = ?, "
                "    EndedAt = strftime('%Y-%m-%dT%H:%M:%SZ','now') "
                "WHERE RunId = ?",
                (f"Dagster launch failed: {exc}", run_id),
            )
            handler._error_response(f"Dagster launch failed: {exc}", 502)
        return

    # Build worker args
    worker_args = ["--run-id", run_id, "--triggered-by", triggered_by]
    if mode == "bulk":
        worker_args.append("--bulk")
        bulk_workers = body.get("bulk_workers", 8)
        worker_args += ["--workers", str(bulk_workers)]
    if layers:
        worker_args += ["--layers"] + layers
    if entity_ids:
        worker_args += ["--entity-ids"] + [str(i) for i in entity_ids]
    if bool(body.get("force_full_refresh")):
        worker_args.append("--force-full-refresh")

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
    rows = _db_query("SELECT Status, Layers, Mode FROM engine_runs WHERE RunId = ?", (run_id,))
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
    original_mode = (run.get("Mode") or "").lower()
    _publish_log("info", f"Resuming run {run_id[:8]} (mode={original_mode})")

    # Build worker args with original layers
    worker_args = ["--resume", run_id]
    original_layers = run.get("Layers", "")
    if original_layers:
        worker_args += ["--layers"] + [l.strip() for l in original_layers.split(",") if l.strip()]

    # Pass bulk workers if resuming a bulk run
    if original_mode == "bulk":
        bulk_workers = body.get("bulk_workers", 16)
        worker_args += ["--workers", str(bulk_workers)]

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
# POST /api/engine/cleanup-runs
# ---------------------------------------------------------------------------

def _handle_cleanup_runs(handler) -> None:
    """Clean up stale/zombie runs immediately.

    Marks InProgress runs as Interrupted if the worker PID is dead
    or the run exceeds the max age threshold.
    """
    try:
        cleaned = _cleanup_stale_runs()
        handler._json_response({
            "cleaned": cleaned,
            "message": f"Cleaned up {cleaned} stale run(s)" if cleaned else "No stale runs found",
        })
    except Exception as exc:
        log.exception("Failed to clean up stale runs")
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
        rows = _query_mapped_task_log_rows(
            run_id=run_id,
            entity_id=entity_id,
            layer=layer,
            status=status,
            limit=limit,
            offset=offset,
        )
        if not rows:
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
    Requires run_id so the retry stays scoped to a known parent run.
    If entity_ids not provided, queries all failed entities from that run.
    """
    global _run_thread

    run_id = body.get("run_id")
    if not run_id:
        handler._error_response("run_id required for scoped retry", 400)
        return

    active_run = _get_live_active_run()
    if active_run:
        handler._json_response({
            "error": "Retry is blocked while another run is active",
            "current_run_id": active_run.get("RunId"),
        }, status=409)
        return

    engine = _get_or_create_engine(config)

    entity_ids = body.get("entity_ids")
    layers = body.get("layers")

    # If no explicit entity_ids, query failed ones from the run via SQLite
    if not entity_ids and run_id:
        try:
            run_meta_rows = _db_query(
                "SELECT Layers FROM engine_runs WHERE RunId = ?",
                (str(run_id),),
            )
            layers_raw = run_meta_rows[0].get("Layers") if run_meta_rows else None
            entity_ids = _get_failed_run_entity_ids(str(run_id), layers_raw)
            if not entity_ids:
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
    retry_run_id = str(uuid.uuid4())
    _publish_log(
        "info",
        f"Retrying {len(entity_ids)} entities from run {run_id} as run {retry_run_id[:8]}",
    )

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
                run_id=retry_run_id,
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
        "run_id": retry_run_id,
        "parent_run_id": run_id,
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
        slowest = _query_mapped_task_log_rows(
            status="succeeded",
            hours_back=hours_int,
            limit=1000,
        )
        if slowest:
            slowest = sorted(
                slowest,
                key=lambda row: _to_float(row.get("DurationSeconds")),
                reverse=True,
            )[:10]
            slowest = [
                {
                    "EntityId": row.get("EntityId"),
                    "SourceName": row.get("SourceName") or row.get("SourceTable"),
                    "DataSourceName": row.get("DataSourceName"),
                    "Layer": row.get("Layer"),
                    "DurationSeconds": row.get("DurationSeconds"),
                    "RowsRead": row.get("RowsRead"),
                    "Status": row.get("Status"),
                }
                for row in slowest
            ]
        else:
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
        truth = _summarize_run_truth(
            str(sr.get("RunId", "")),
            sr.get("Layers", ""),
        )
        mapped.append({
            "run_id": sr.get("RunId", ""),
            "status": sr.get("Status", "unknown"),
            "mode": sr.get("Mode", "run"),
            "started_at": sr.get("StartedAt") or None,
            "finished_at": sr.get("EndedAt") or None,
            "duration_seconds": sr.get("TotalDurationSeconds"),
            "entities_succeeded": truth["succeeded"] if truth["latest_rows"] else sr.get("SucceededEntities", 0),
            "entities_failed": truth["failed"] if truth["latest_rows"] else sr.get("FailedEntities", 0),
            "entities_skipped": truth["skipped"] if truth["latest_rows"] else sr.get("SkippedEntities", 0),
            "triggered_by": sr.get("TriggeredBy", ""),
            "total_rows": truth["total_rows"] if truth["latest_rows"] else sr.get("TotalRowsRead", 0),
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
        from dashboard.app.api.routes.entities import _build_sqlite_entity_digest
        from dashboard.app.api.routes.load_center import _build_canonical_pipeline_truth

        digest = _build_sqlite_entity_digest()
        truth = _build_canonical_pipeline_truth()
        log_lookup = truth.get("logLookup", {})

        def _present(layer_key: str, entity: dict) -> bool:
            data_source_id = int(entity.get("dataSourceId") or entity.get("DataSourceId") or 0)
            schema = str(entity.get("sourceSchema") or "").strip().lower()
            table = str(entity.get("tableName") or "").strip().lower()
            return bool(data_source_id and schema and table and (layer_key, data_source_id, schema, table) in log_lookup)

        def _status_code(entity: dict, layer_key: str, status_key: str) -> int:
            if _present(layer_key, entity):
                return 1
            status = str(entity.get(status_key) or "").strip().lower()
            if status in ("failed", "error", "aborted", "interrupted"):
                return 0
            return -1

        overview: list[dict] = []
        lz_status: list[dict] = []
        bronze_status: list[dict] = []
        silver_status: list[dict] = []
        digest_counts = {"complete": 0, "partial": 0, "not_started": 0}
        never_attempted: list[dict] = []
        stuck_map: dict[str, int] = {}
        entities: list[dict] = []

        for source in digest.get("sources", []):
            source_name = str(source.get("displayName") or source.get("name") or "")
            source_entities = list(source.get("entities", []))
            active_entities = [entity for entity in source_entities if entity.get("isActive")]

            overview.append({
                "DataSource": source_name,
                "TotalEntities": len(source_entities),
                "Active": len(active_entities),
                "Inactive": max(len(source_entities) - len(active_entities), 0),
            })

            layer_buckets = {
                "lz": {"loaded": 0, "failed": 0, "never": 0},
                "bronze": {"loaded": 0, "failed": 0, "never": 0},
                "silver": {"loaded": 0, "failed": 0, "never": 0},
            }

            for entity in active_entities:
                lz_code = _status_code(entity, "lz", "lzStatus")
                bronze_code = _status_code(entity, "bronze", "bronzeStatus")
                silver_code = _status_code(entity, "silver", "silverStatus")

                for layer_key, code in (("lz", lz_code), ("bronze", bronze_code), ("silver", silver_code)):
                    bucket = layer_buckets[layer_key]
                    if code == 1:
                        bucket["loaded"] += 1
                    elif code == 0:
                        bucket["failed"] += 1
                    else:
                        bucket["never"] += 1

                if lz_code == -1:
                    never_attempted.append({
                        "EntityId": int(entity.get("id") or 0),
                        "DataSource": source_name,
                        "SourceSchema": entity.get("sourceSchema") or "",
                        "SourceName": entity.get("tableName") or "",
                    })

                if lz_code == 1 and bronze_code != 1:
                    stuck_map[source_name] = stuck_map.get(source_name, 0) + 1

                if lz_code == 1 and bronze_code == 1 and silver_code == 1:
                    overall = "complete"
                elif lz_code == 1 or bronze_code == 1 or silver_code == 1:
                    overall = "partial"
                else:
                    overall = "not_started"
                digest_counts[overall] += 1

                entities.append({
                    "EntityId": int(entity.get("id") or 0),
                    "DataSource": source_name,
                    "SourceSchema": entity.get("sourceSchema") or "",
                    "SourceName": entity.get("tableName") or "",
                    "IsIncremental": bool(entity.get("isIncremental")),
                    "LzStatus": lz_code,
                    "BronzeStatus": bronze_code,
                    "SilverStatus": silver_code,
                })

            lz_status.append({
                "DataSource": source_name,
                "LzLoaded": layer_buckets["lz"]["loaded"],
                "LzFailed": layer_buckets["lz"]["failed"],
                "LzNeverAttempted": layer_buckets["lz"]["never"],
            })
            bronze_status.append({
                "DataSource": source_name,
                "BronzeLoaded": layer_buckets["bronze"]["loaded"],
                "BronzeFailed": layer_buckets["bronze"]["failed"],
                "BronzeNeverAttempted": layer_buckets["bronze"]["never"],
            })
            silver_status.append({
                "DataSource": source_name,
                "SilverLoaded": layer_buckets["silver"]["loaded"],
                "SilverFailed": layer_buckets["silver"]["failed"],
                "SilverNeverAttempted": layer_buckets["silver"]["never"],
            })

        stuck_at_lz = [
            {"DataSource": data_source, "StuckCount": count}
            for data_source, count in sorted(stuck_map.items())
        ]
        digest_rows = [
            {"OverallStatus": status, "EntityCount": count}
            for status, count in digest_counts.items()
        ]
        entities.sort(key=lambda row: (row["DataSource"], row["SourceSchema"], row["SourceName"]))
        never_attempted = sorted(
            never_attempted,
            key=lambda row: (row["DataSource"], row["SourceSchema"], row["SourceName"]),
        )[:50]

        handler._json_response({
            "overview": [_safe_row(r) for r in overview],
            "lz_status": [_safe_row(r) for r in lz_status],
            "bronze_status": [_safe_row(r) for r in bronze_status],
            "silver_status": [_safe_row(r) for r in silver_status],
            "digest": [_safe_row(r) for r in digest_rows],
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

def _handle_smoke_entity(handler) -> None:
    """Return a safe single entity candidate for real-loader smoke tests."""
    rows = _db_query(
        """
        SELECT
            e.LandingzoneEntityId AS entity_id,
            COALESCE(NULLIF(d.DisplayName, ''), d.Name) AS source,
            COALESCE(NULLIF(d.Namespace, ''), d.Name) AS namespace,
            e.SourceSchema AS schema,
            e.SourceName AS table_name,
            e.IsIncremental AS is_incremental,
            COALESCE(MAX(CASE WHEN LOWER(t.Status) = 'failed' THEN 1 ELSE 0 END), 0) AS recent_failures,
            COALESCE(MIN(CASE WHEN LOWER(t.Status) = 'succeeded' AND COALESCE(t.RowsRead, 0) > 0 THEN t.RowsRead END), 0) AS historical_rows,
            MAX(CASE WHEN LOWER(t.Status) = 'succeeded' THEN t.created_at ELSE NULL END) AS last_success_at
        FROM lz_entities e
        LEFT JOIN datasources d ON d.DataSourceId = e.DataSourceId
        LEFT JOIN engine_task_log t
          ON t.EntityId = e.LandingzoneEntityId
         AND LOWER(COALESCE(t.Layer, '')) = 'landing'
         AND t.created_at >= datetime('now', '-30 days')
        WHERE e.IsActive = 1
          AND TRIM(COALESCE(e.SourceName, '')) <> ''
          AND TRIM(COALESCE(e.SourceSchema, '')) <> ''
        GROUP BY
            e.LandingzoneEntityId,
            d.DisplayName,
            d.Name,
            d.Namespace,
            e.SourceSchema,
            e.SourceName,
            e.IsIncremental
        """
    )
    if not rows:
        handler._json_response({"entity": None, "message": "No active entities found."})
        return

    monster_hints = ("history", "archive", "audit", "transaction", "ledger", "detail", "log")

    def score(row: dict) -> tuple:
        source_name = str(row.get("table_name") or "").lower()
        historical_rows = _to_int(row.get("historical_rows"))
        return (
            1 if _to_int(row.get("recent_failures")) > 0 else 0,
            1 if any(hint in source_name for hint in monster_hints) else 0,
            0 if historical_rows > 0 else 1,
            historical_rows if historical_rows > 0 else 999_999_999,
            str(row.get("source") or ""),
            str(row.get("schema") or ""),
            str(row.get("table_name") or ""),
        )

    chosen = sorted(rows, key=score)[0]
    historical_rows = _to_int(chosen.get("historical_rows"))
    handler._json_response({
        "entity": {
            "entity_id": _to_int(chosen.get("entity_id")),
            "source": str(chosen.get("source") or ""),
            "namespace": str(chosen.get("namespace") or ""),
            "schema": str(chosen.get("schema") or ""),
            "table": str(chosen.get("table_name") or ""),
            "is_incremental": bool(chosen.get("is_incremental")),
            "historical_rows": historical_rows,
            "last_success_at": chosen.get("last_success_at"),
            "reason": (
                "Active entity with no recent landing failures and the smallest known historical row count."
                if historical_rows > 0
                else "Active entity with complete metadata; no historical row-count signal was available."
            ),
        }
    })


def _handle_entities(handler, config: dict) -> None:
    """Return all active LZ entities for the manual reload selector."""
    try:
        entities = []
        cpdb = _get_cpdb()
        if cpdb and hasattr(cpdb, "get_registered_entities_full") and hasattr(cpdb, "get_canonical_entity_status"):
            landing_status = {
                int(row.get("LandingzoneEntityId") or 0): row
                for row in cpdb.get_canonical_entity_status()
                if str(row.get("Layer") or "").lower() == "landing"
            }
            for row in cpdb.get_registered_entities_full():
                if _to_int(row.get("IsActive")) != 1:
                    continue
                entity_id = _to_int(row.get("LandingzoneEntityId"))
                status_row = landing_status.get(entity_id, {})
                entities.append({
                    "entity_id": entity_id,
                    "source_schema": str(row.get("SourceSchema", "")),
                    "source_name": str(row.get("SourceName", "")),
                    "namespace": str(row.get("Namespace") or row.get("DataSourceName") or ""),
                    "datasource": str(row.get("DataSourceName", "")),
                    "source_database": str(row.get("DatabaseName", "")),
                    "is_incremental": bool(row.get("IsIncremental", False)),
                    "last_loaded": str(status_row.get("LoadEndDateTime", "")) if status_row.get("LoadEndDateTime") else None,
                    "lz_status": _selector_landing_status(status_row.get("Status")),
                })
        else:
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
