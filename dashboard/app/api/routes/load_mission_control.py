"""Load Mission Control routes — the single source of truth for load monitoring.

Replaces the thin /api/load-progress endpoint with rich, task_log-backed data.

Endpoints:
    GET /api/lmc/progress              — Enhanced overall progress (real counts from task_log)
    GET /api/lmc/runs                  — Run history with real entity counts
    GET /api/lmc/run/{run_id}          — Per-run detail (layers, sources, errors, optimization)
    GET /api/lmc/run/{run_id}/receipt  — Real-load receipt / physical artifact evidence
    GET /api/lmc/run/{run_id}/entities — Filterable per-entity list for a run
    GET /api/lmc/entity/{entity_id}/history — Entity across all runs (retries, watermarks)
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db
import dashboard.app.api.control_plane_db as cpdb

log = logging.getLogger("fmd.routes.lmc")

_SUPPORTED_LAYERS = ("landing", "bronze", "silver")
_LAYER_LAKEHOUSE = {
    "landing": "LH_DATA_LANDINGZONE",
    "bronze": "LH_BRONZE_LAYER",
    "silver": "LH_SILVER_LAYER",
}
_RUNNING_STATUSES = {"inprogress", "in-progress", "running", "started", "starting", "queued"}
_STOPPING_STATUSES = {"stopping", "cancelling", "canceling"}
_SUCCEEDED_STATUSES = {"succeeded", "success", "completed", "complete", "done"}
_FAILED_STATUSES = {"failed", "error", "errored"}
_STOPPED_STATUSES = {"cancelled", "canceled", "stopped", "aborted", "interrupted"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_query(sql: str, params: tuple = (), default=None):
    if default is None:
        default = []
    try:
        return db.query(sql, params)
    except Exception as e:
        log.warning("Query failed: %s — %s", sql[:80], e)
        return default


def _safe_scalar(sql: str, params: tuple = (), default=0):
    """Return the first column of the first row, or default."""
    rows = _safe_query(sql, params, default=[])
    if rows and len(rows) > 0:
        first = rows[0]
        if isinstance(first, dict):
            return list(first.values())[0]
        return first
    return default


def _project_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _receipt_path_for_run(run_id: str) -> Path:
    return _project_root() / ".runs" / "real-smoke" / run_id / "receipt.json"


def _flatten_receipt_artifacts(receipt: dict) -> list[dict]:
    artifacts: list[dict] = []
    for entity in receipt.get("entities") or []:
        qualified_name = entity.get("qualifiedName") or ""
        for layer, payload in (entity.get("layers") or {}).items():
            task = payload.get("task") or {}
            artifact = payload.get("artifactCheck") or {}
            task_check = payload.get("taskCheck") or {}
            artifacts.append({
                "entityId": payload.get("entityId") or entity.get("landingEntityId"),
                "qualifiedName": qualified_name,
                "layer": layer,
                "status": payload.get("status") or artifact.get("status") or task_check.get("status") or "unknown",
                "taskStatus": task.get("Status"),
                "rowsRead": _int(task.get("RowsRead")),
                "rowsWritten": _int(task.get("RowsWritten")),
                "bytesTransferred": _int(task.get("BytesTransferred")),
                "targetPath": artifact.get("targetPath") or task.get("TargetPath") or "",
                "localPath": artifact.get("localPath"),
                "artifactStatus": artifact.get("status") or "not_checked",
                "artifactMessage": artifact.get("message") or "",
                "completedAt": task.get("created_at"),
            })
    return artifacts


def _task_log_receipt_artifacts(run_id: str) -> list[dict]:
    rows = _safe_query(
        "SELECT EntityId, Layer, Status, SourceTable, RowsRead, RowsWritten, BytesTransferred, "
        "TargetPath, LoadType, ExtractionMethod, ErrorMessage, created_at "
        "FROM engine_task_log WHERE RunId = ? ORDER BY id",
        (run_id,),
    )
    artifacts = []
    for row in rows:
        layer = str(row.get("Layer") or "").lower()
        artifacts.append({
            "entityId": _int(row.get("EntityId")),
            "qualifiedName": row.get("SourceTable") or "",
            "layer": layer,
            "status": str(row.get("Status") or "unknown").lower(),
            "taskStatus": row.get("Status"),
            "rowsRead": _int(row.get("RowsRead")),
            "rowsWritten": _int(row.get("RowsWritten")),
            "bytesTransferred": _int(row.get("BytesTransferred")),
            "targetPath": row.get("TargetPath") or "",
            "localPath": None,
            "artifactStatus": "not_checked",
            "artifactMessage": "No machine receipt was found for this run; physical artifact status has not been verified.",
            "completedAt": row.get("created_at"),
        })
    return artifacts


def _int(v) -> int:
    try:
        return int(v) if v is not None else 0
    except (TypeError, ValueError):
        return 0


def _split_csv(raw: str | None) -> list[str]:
    return [part.strip() for part in str(raw or "").split(",") if part and part.strip()]


def _parse_entity_filter(raw: str | None) -> list[int]:
    entity_ids: list[int] = []
    for part in _split_csv(raw):
        try:
            entity_ids.append(int(part))
        except (TypeError, ValueError):
            continue
    return entity_ids


def _parse_run_layers(raw: str | None) -> list[str]:
    layers = [layer.lower() for layer in _split_csv(raw)]
    return [layer for layer in layers if layer in _SUPPORTED_LAYERS] or list(_SUPPORTED_LAYERS)


def _normalize_run_status(raw: str | None) -> str:
    status = str(raw or "").strip().lower().replace(" ", "")
    if status in _SUCCEEDED_STATUSES:
        return "succeeded"
    if status in _FAILED_STATUSES:
        return "failed"
    if status in _STOPPED_STATUSES:
        return "stopped"
    if status in _STOPPING_STATUSES:
        return "stopping"
    if status in _RUNNING_STATUSES:
        return "running"
    return status or "unknown"


def _human_status(status: str) -> str:
    return {
        "succeeded": "Succeeded",
        "failed": "Failed",
        "stopped": "Stopped",
        "stopping": "Stopping",
        "running": "In Progress",
        "unknown": "Unknown",
    }.get(status, status.replace("_", " ").replace("-", " ").title())


def _build_mission_truth(
    *,
    run_meta: dict,
    run_truth: dict,
    total_active: int,
    runtime_mode: str,
    is_dry_run: bool,
) -> dict:
    """Canonical presentation contract for Mission Control.

    The UI intentionally consumes this object instead of recomputing status,
    scope, rows, and remaining work from several partially-overlapping sources.
    """
    run_status = _normalize_run_status(run_meta.get("Status"))
    is_active = run_status in {"running", "stopping"}
    is_terminal = run_status in {"succeeded", "failed", "stopped"}
    run_layers = _parse_run_layers(run_meta.get("Layers"))
    layer_count = len(run_layers)
    source_filter = _split_csv(run_meta.get("SourceFilter"))
    by_source = run_truth.get("bySource") or []
    source_names = source_filter or [str(row.get("source") or "") for row in by_source if row.get("source")]
    entity_count = (
        _int(run_meta.get("ResolvedEntityCount"))
        or len(run_truth.get("scopeEntities") or [])
        or _int(run_meta.get("TotalEntities"))
        or _int(total_active)
    )
    layer_step_total = entity_count * max(layer_count, 1)
    by_source_by_layer = [
        row for row in (run_truth.get("bySourceByLayer") or [])
        if str(row.get("layer") or "").lower() in run_layers
    ]

    if by_source_by_layer:
        layer_steps_succeeded = sum(_int(row.get("succeeded")) for row in by_source_by_layer)
        layer_steps_failed = sum(_int(row.get("failed")) for row in by_source_by_layer)
        layer_steps_skipped = sum(_int(row.get("skipped")) for row in by_source_by_layer)
    else:
        layers_by_key = run_truth.get("layers") or {}
        layer_steps_succeeded = sum(_int(layers_by_key.get(layer, {}).get("succeeded")) for layer in run_layers)
        layer_steps_failed = sum(_int(layers_by_key.get(layer, {}).get("failed")) for layer in run_layers)
        layer_steps_skipped = sum(_int(layers_by_key.get(layer, {}).get("skipped")) for layer in run_layers)

    remaining = max(
        layer_step_total - layer_steps_succeeded - layer_steps_failed - layer_steps_skipped,
        0,
    )
    if run_status == "succeeded":
        remaining = 0

    layers_payload = []
    for layer in run_layers:
        layer_rows = [row for row in by_source_by_layer if str(row.get("layer") or "").lower() == layer]
        if layer_rows:
            succeeded = sum(_int(row.get("succeeded")) for row in layer_rows)
            failed = sum(_int(row.get("failed")) for row in layer_rows)
            skipped = sum(_int(row.get("skipped")) for row in layer_rows)
        else:
            layer_stats = (run_truth.get("layers") or {}).get(layer, {})
            succeeded = _int(layer_stats.get("succeeded"))
            failed = _int(layer_stats.get("failed"))
            skipped = _int(layer_stats.get("skipped"))
        layer_remaining = max(entity_count - succeeded - failed - skipped, 0)
        if run_status == "succeeded":
            layer_remaining = 0
        layers_payload.append({
            "key": layer,
            "label": {
                "landing": "Landing Zone",
                "bronze": "Bronze",
                "silver": "Silver",
            }.get(layer, layer.title()),
            "total": entity_count,
            "succeeded": succeeded,
            "failed": failed,
            "skipped": skipped,
            "remaining": layer_remaining,
        })

    rows_read = sum(_int(row.get("RowsRead")) for row in run_truth.get("latestRows") or [])
    rows_written = _int(run_truth.get("rowsWritten"))
    files_written = _int(run_truth.get("filesWritten"))
    throughput_rows = float((run_truth.get("throughput") or {}).get("rows_per_sec") or 0)
    throughput_bytes = float((run_truth.get("throughput") or {}).get("bytes_per_sec") or 0)
    if is_dry_run:
        rows_read = 0
        rows_written = 0
        files_written = 0
        throughput_rows = 0
        throughput_bytes = 0

    if is_dry_run:
        row_count_trust = "No data written"
    elif files_written > 0 or rows_written > 0:
        row_count_trust = "Control-plane counts"
    else:
        row_count_trust = "No physical writes recorded"

    operator_state = "waiting"
    if run_status == "running":
        operator_state = "running"
    elif run_status == "stopping":
        operator_state = "stopping"
    elif run_status == "succeeded":
        operator_state = "complete"
    elif run_status == "failed":
        operator_state = "failed"
    elif run_status == "stopped":
        operator_state = "stopped"

    source_count = len(source_names) if source_names else len(by_source)
    if source_filter:
        scope_label = f"{source_count} selected source{'s' if source_count != 1 else ''}"
    elif entity_count == _int(total_active) or not source_names:
        scope_label = "All active sources"
    else:
        scope_label = f"{entity_count:,} scoped entities"

    return {
        "runId": run_meta.get("RunId"),
        "runStatus": run_status,
        "statusLabel": _human_status(run_status),
        "isTerminal": is_terminal,
        "isActive": is_active,
        "isDryRun": is_dry_run,
        "modeLabel": "Dry run" if is_dry_run else "Load",
        "runtimeLabel": "Dagster dry run" if is_dry_run else "Dagster framework",
        "runtimeMode": runtime_mode,
        "sourceNames": source_names,
        "sourceCount": source_count,
        "scopeLabel": scope_label,
        "entityCount": entity_count,
        "layers": layers_payload,
        "layerKeys": run_layers,
        "layerCount": layer_count,
        "layerStepTotal": layer_step_total,
        "layerStepsSucceeded": layer_steps_succeeded,
        "layerStepsFailed": layer_steps_failed,
        "layerStepsSkipped": layer_steps_skipped,
        "layerStepsRemaining": remaining,
        "rowsRead": rows_read,
        "rowsWritten": rows_written,
        "filesWritten": files_written,
        "throughputRowsPerSecond": throughput_rows,
        "throughputBytesPerSecond": throughput_bytes,
        "operatorState": operator_state,
        "unitLabel": "orchestration check" if is_dry_run else "layer load step",
        "rowCountTrustLabel": row_count_trust,
    }


def _classify_load_strategy(entity: dict) -> dict:
    is_incremental = bool(entity.get("isIncremental"))
    watermark_column = entity.get("watermarkColumn")
    last_watermark = entity.get("lastWatermark")

    if is_incremental and watermark_column and last_watermark:
        return {
            "nextAction": "incremental",
            "nextActionLabel": "Incremental load",
            "reason": "Watermark history exists, so the next run can advance without reseeding.",
        }
    if is_incremental and watermark_column and not last_watermark:
        return {
            "nextAction": "full_load",
            "nextActionLabel": "First full load",
            "reason": "Incremental configuration exists, but there is no watermark history yet.",
        }
    if not is_incremental and not watermark_column:
        return {
            "nextAction": "full_load",
            "nextActionLabel": "Full load",
            "reason": "No watermark strategy is configured for this table.",
        }
    return {
        "nextAction": "full_load",
        "nextActionLabel": "Full load",
        "reason": "This table is currently configured to reload in full.",
    }


def _resolve_run_scope_entities(run_meta: dict) -> list[dict]:
    """Resolve the exact entity scope for a run from persisted engine_runs metadata."""
    entity_ids = _parse_entity_filter(run_meta.get("EntityFilter"))
    source_filter = _split_csv(run_meta.get("SourceFilter"))
    run_id = str(run_meta.get("RunId") or "")

    if not entity_ids and not source_filter and run_id:
        inferred_rows = _safe_query(
            f"""
            {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
            SELECT DISTINCT LandingzoneEntityId
            FROM mapped
            WHERE RunId = ?
              AND LandingzoneEntityId IS NOT NULL
            ORDER BY LandingzoneEntityId
            """,
            (run_id,),
        )
        entity_ids = [_int(row.get("LandingzoneEntityId")) for row in inferred_rows]
        entity_ids = [entity_id for entity_id in entity_ids if entity_id]

    query = (
        "SELECT le.LandingzoneEntityId AS entityId, "
        "  le.DataSourceId AS dataSourceId, "
        "  ds.Name AS source, "
        "  COALESCE(ds.DisplayName, ds.Name) AS sourceDisplay, "
        "  le.SourceSchema AS schema, "
        "  le.SourceName AS tableName, "
        "  le.FilePath AS filePath, "
        "  COALESCE(le.IsIncremental, 0) AS isIncremental, "
        "  le.IsIncrementalColumn AS watermarkColumn, "
        "  w.LoadValue AS lastWatermark, "
        "  be.BronzeLayerEntityId AS bronzeEntityId, "
        "  se.SilverLayerEntityId AS silverEntityId "
        "FROM lz_entities le "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "LEFT JOIN bronze_entities be ON be.LandingzoneEntityId = le.LandingzoneEntityId "
        "LEFT JOIN silver_entities se ON se.BronzeLayerEntityId = be.BronzeLayerEntityId "
        "LEFT JOIN watermarks w ON w.LandingzoneEntityId = le.LandingzoneEntityId "
        "WHERE le.IsActive = 1"
    )
    params: list = []

    if entity_ids:
        placeholders = ",".join("?" for _ in entity_ids)
        query += f" AND le.LandingzoneEntityId IN ({placeholders})"
        params.extend(entity_ids)
    elif source_filter:
        placeholders = ",".join("?" for _ in source_filter)
        query += f" AND ds.Name IN ({placeholders})"
        params.extend(source_filter)

    query += " ORDER BY COALESCE(ds.DisplayName, ds.Name), le.SourceSchema, le.SourceName"
    return _safe_query(query, tuple(params))


def _get_run_scope_inventory_rows(run_id: str, scoped_entity_ids: list[int]) -> dict[tuple[int, str], dict]:
    if not scoped_entity_ids:
        return {}

    placeholders = ",".join("?" for _ in scoped_entity_ids)
    params = (run_id, *scoped_entity_ids)
    sql = f"""
        {cpdb._MAPPED_ENGINE_TASK_LOG_CTE},
        ranked AS (
            SELECT
                LandingzoneEntityId,
                Layer,
                Status,
                LoadEndDateTime,
                ErrorMessage,
                RunId,
                RowsRead,
                RowsWritten,
                SourceTable,
                ROW_NUMBER() OVER (
                    PARTITION BY LandingzoneEntityId, Layer
                    ORDER BY
                        LoadEndDateTime DESC,
                        CASE Status
                          WHEN 'succeeded' THEN 1
                          WHEN 'failed' THEN 2
                          WHEN 'skipped' THEN 3
                          ELSE 4
                        END,
                        id DESC
                ) AS rn
            FROM mapped
            WHERE LandingzoneEntityId IS NOT NULL
              AND RunId = ?
              AND LandingzoneEntityId IN ({placeholders})
        )
        SELECT
            LandingzoneEntityId,
            Layer,
            Status,
            LoadEndDateTime,
            ErrorMessage,
            RunId,
            RowsRead,
            RowsWritten,
            SourceTable
        FROM ranked
        WHERE rn = 1
    """
    rows = _safe_query(sql, params)
    return {
        (_int(row.get("LandingzoneEntityId")), str(row.get("Layer") or "").lower()): row
        for row in rows
    }


def _get_run_latest_task_rows(run_id: str, scoped_entity_ids: list[int] | None = None) -> list[dict]:
    if scoped_entity_ids is not None and not scoped_entity_ids:
        return []

    params: list = [run_id]
    entity_filter = ""
    if scoped_entity_ids:
        placeholders = ",".join("?" for _ in scoped_entity_ids)
        entity_filter = f" AND mapped.LandingzoneEntityId IN ({placeholders})"
        params.extend(scoped_entity_ids)

    sql = f"""
        {cpdb._MAPPED_ENGINE_TASK_LOG_CTE},
        enriched AS (
            SELECT
                mapped.LandingzoneEntityId,
                mapped.DataSourceId,
                mapped.Layer,
                mapped.Status,
                mapped.LoadEndDateTime,
                mapped.ErrorMessage,
                mapped.RunId,
                mapped.RowsRead,
                mapped.RowsWritten,
                mapped.SourceTable,
                mapped.SourceSchema,
                mapped.SourceName,
                mapped.IsIncremental,
                mapped.id,
                t.BytesTransferred,
                t.DurationSeconds,
                t.LoadType,
                t.ExtractionMethod,
                t.ErrorType,
                t.ErrorSuggestion,
                t.WatermarkColumn,
                t.WatermarkBefore,
                t.WatermarkAfter
            FROM mapped
            JOIN engine_task_log t ON t.id = mapped.id
            WHERE mapped.RunId = ?
              AND mapped.LandingzoneEntityId IS NOT NULL
              {entity_filter}
        ),
        ranked AS (
            SELECT *,
                   ROW_NUMBER() OVER (
                       PARTITION BY LandingzoneEntityId, Layer
                       ORDER BY
                           LoadEndDateTime DESC,
                           CASE Status
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
            ErrorMessage,
            RunId,
            RowsRead,
            RowsWritten,
            BytesTransferred,
            DurationSeconds,
            SourceTable,
            SourceSchema,
            SourceName,
            IsIncremental,
            LoadType,
            ExtractionMethod,
            ErrorType,
            ErrorSuggestion,
            WatermarkColumn,
            WatermarkBefore,
            WatermarkAfter,
            id
        FROM ranked
        WHERE rn = 1
        ORDER BY LoadEndDateTime DESC, id DESC
    """
    return _safe_query(sql, tuple(params))


def _get_run_task_rows(run_id: str, scoped_entity_ids: list[int] | None = None) -> list[dict]:
    """Return all mapped task rows for a run, preserving retry attempts."""
    if scoped_entity_ids is not None and not scoped_entity_ids:
        return []

    params: list = [run_id]
    entity_filter = ""
    if scoped_entity_ids:
        placeholders = ",".join("?" for _ in scoped_entity_ids)
        entity_filter = f" AND mapped.LandingzoneEntityId IN ({placeholders})"
        params.extend(scoped_entity_ids)

    sql = f"""
        {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
        SELECT
            mapped.LandingzoneEntityId,
            mapped.DataSourceId,
            mapped.Layer,
            mapped.Status,
            mapped.LoadEndDateTime,
            mapped.ErrorMessage,
            mapped.RunId,
            mapped.RowsRead,
            mapped.RowsWritten,
            mapped.SourceTable,
            mapped.SourceSchema,
            mapped.SourceName,
            mapped.IsIncremental,
            t.BytesTransferred,
            t.DurationSeconds,
            t.LoadType,
            t.ExtractionMethod,
            t.ErrorType,
            t.ErrorSuggestion,
            t.WatermarkColumn,
            t.WatermarkBefore,
            t.WatermarkAfter,
            t.SourceServer,
            t.SourceDatabase,
            t.SourceQuery,
            t.id
        FROM mapped
        JOIN engine_task_log t ON t.id = mapped.id
        WHERE mapped.RunId = ?
          AND mapped.LandingzoneEntityId IS NOT NULL
          {entity_filter}
        ORDER BY COALESCE(mapped.LoadEndDateTime, t.created_at) DESC, t.id DESC
    """
    return _safe_query(sql, tuple(params))


def _summarize_run_truth(run_meta: dict) -> dict:
    scope_entities = _resolve_run_scope_entities(run_meta)
    scoped_entity_ids = [_int(entity.get("entityId")) for entity in scope_entities if entity.get("entityId") is not None]
    latest_rows = _get_run_latest_task_rows(run_meta.get("RunId", ""), scoped_entity_ids)
    run_layers = _parse_run_layers(run_meta.get("Layers"))
    row_lookup = {
        (_int(row.get("LandingzoneEntityId")), str(row.get("Layer") or "").lower()): row
        for row in latest_rows
    }

    layer_entity_sets: dict[str, dict[str, set[int]]] = {
        layer: {"succeeded": set(), "failed": set(), "skipped": set()}
        for layer in _SUPPORTED_LAYERS
    }
    layer_metrics = {
        layer: {
            "total_rows_read": 0,
            "total_rows_written": 0,
            "total_bytes": 0,
            "total_duration": 0.0,
            "success_durations": [],
        }
        for layer in _SUPPORTED_LAYERS
    }

    by_source_totals: dict[str, dict] = {}
    by_source_layer_map: dict[tuple[str, str], dict] = {}
    entity_summary = {"succeeded": 0, "failed": 0, "skipped": 0, "pending": 0}

    for row in latest_rows:
        layer = str(row.get("Layer") or "").lower()
        status = str(row.get("Status") or "").lower()
        entity_id = _int(row.get("LandingzoneEntityId"))
        if layer in layer_entity_sets and status in layer_entity_sets[layer]:
            layer_entity_sets[layer][status].add(entity_id)
        if layer in layer_metrics:
            layer_metrics[layer]["total_rows_read"] += _int(row.get("RowsRead"))
            layer_metrics[layer]["total_rows_written"] += _int(row.get("RowsWritten"))
            layer_metrics[layer]["total_bytes"] += _int(row.get("BytesTransferred"))
            layer_metrics[layer]["total_duration"] += float(row.get("DurationSeconds") or 0)
            if status == "succeeded":
                layer_metrics[layer]["success_durations"].append(float(row.get("DurationSeconds") or 0))

    for entity in scope_entities:
        source = str(entity.get("source") or "")
        entity_id = _int(entity.get("entityId"))
        source_bucket = by_source_totals.setdefault(source, {
            "source": source,
            "total_entities": 0,
            "succeeded": 0,
            "failed": 0,
            "skipped": 0,
            "rows_read": 0,
            "bytes": 0,
        })
        source_bucket["total_entities"] += 1

        layer_statuses: list[str] = []
        for layer in run_layers:
            row = row_lookup.get((entity_id, layer))
            status = str(row.get("Status") or "not_started").lower() if row else "not_started"
            layer_statuses.append(status)
            layer_bucket = by_source_layer_map.setdefault((source, layer), {
                "source": source,
                "layer": layer,
                "succeeded": 0,
                "failed": 0,
                "skipped": 0,
                "rows_read": 0,
                "bytes": 0,
            })
            if status in ("succeeded", "failed", "skipped"):
                layer_bucket[status] += 1
            if row and status == "succeeded":
                layer_bucket["rows_read"] += _int(row.get("RowsRead"))
                layer_bucket["bytes"] += _int(row.get("BytesTransferred"))
                source_bucket["rows_read"] += _int(row.get("RowsRead"))
                source_bucket["bytes"] += _int(row.get("BytesTransferred"))

        attempted = [status for status in layer_statuses if status != "not_started"]
        if not attempted:
            entity_summary["pending"] += 1
            continue
        if any(status == "failed" for status in attempted):
            source_bucket["failed"] += 1
            entity_summary["failed"] += 1
        elif all(status == "succeeded" for status in layer_statuses):
            source_bucket["succeeded"] += 1
            entity_summary["succeeded"] += 1
        elif all(status in ("succeeded", "skipped") for status in layer_statuses) and any(status == "skipped" for status in layer_statuses):
            source_bucket["skipped"] += 1
            entity_summary["skipped"] += 1
        else:
            entity_summary["pending"] += 1

    layers = {}
    for layer in _SUPPORTED_LAYERS:
        metrics = layer_metrics[layer]
        success_durations = metrics["success_durations"]
        layers[layer] = {
            "succeeded": len(layer_entity_sets[layer]["succeeded"]),
            "failed": len(layer_entity_sets[layer]["failed"]),
            "skipped": len(layer_entity_sets[layer]["skipped"]),
            "total_rows_read": metrics["total_rows_read"],
            "total_rows_written": metrics["total_rows_written"],
            "total_bytes": metrics["total_bytes"],
            "total_duration": round(metrics["total_duration"], 2),
            "avg_duration": round(sum(success_durations) / len(success_durations), 2) if success_durations else 0,
            "unique_entities": len(layer_entity_sets[layer]["succeeded"] | layer_entity_sets[layer]["failed"] | layer_entity_sets[layer]["skipped"]),
        }

    throughput_rows = [row for row in latest_rows if str(row.get("Status") or "").lower() == "succeeded"]
    total_rows = sum(_int(row.get("RowsRead")) for row in throughput_rows)
    total_bytes = sum(_int(row.get("BytesTransferred")) for row in throughput_rows)
    total_duration = sum(float(row.get("DurationSeconds") or 0) for row in throughput_rows)
    throughput = {
        "rows_per_sec": round(total_rows / total_duration, 1) if total_duration else 0,
        "bytes_per_sec": round(total_bytes / total_duration, 1) if total_duration else 0,
    }

    total_rows_written = sum(_int(row.get("RowsWritten")) for row in throughput_rows)
    total_files_written = len({
        str(row.get("TargetPath") or row.get("SourceTable") or row.get("id"))
        for row in throughput_rows
        if _int(row.get("RowsWritten")) > 0 or _int(row.get("BytesTransferred")) > 0
    })

    error_counts: dict[str, int] = {}
    load_type_counts: dict[str, dict] = {}
    extraction_method_counts: dict[str, dict] = {}
    for row in latest_rows:
        status = str(row.get("Status") or "").lower()
        if status == "failed":
            error_type = str(row.get("ErrorType") or "other")
            error_counts[error_type] = error_counts.get(error_type, 0) + 1
        if status == "succeeded":
            load_type = str(row.get("LoadType") or "unknown")
            lt = load_type_counts.setdefault(load_type, {"LoadType": load_type, "cnt": 0, "total_rows": 0})
            lt["cnt"] += 1
            lt["total_rows"] += _int(row.get("RowsRead"))
            method = str(row.get("ExtractionMethod") or "unknown")
            em = extraction_method_counts.setdefault(method, {"method": method, "count": 0, "totalRows": 0})
            em["count"] += 1
            em["totalRows"] += _int(row.get("RowsRead"))

    error_breakdown = [
        {"ErrorType": key, "cnt": value}
        for key, value in sorted(error_counts.items(), key=lambda item: (-item[1], item[0]))
    ]
    load_type_breakdown = list(load_type_counts.values())
    extraction_methods = sorted(
        extraction_method_counts.values(),
        key=lambda row: (-row["count"], row["method"]),
    )
    dominant_method = extraction_methods[0]["method"] if extraction_methods else "unknown"

    return {
        "scopeEntities": scope_entities,
        "scopedEntityIds": scoped_entity_ids,
        "latestRows": latest_rows,
        "rowLookup": row_lookup,
        "layers": layers,
        "bySource": sorted(by_source_totals.values(), key=lambda row: row["source"]),
        "bySourceByLayer": sorted(by_source_layer_map.values(), key=lambda row: (row["source"], row["layer"])),
        "entitySummary": entity_summary,
        "throughput": throughput,
        "rowsWritten": total_rows_written,
        "filesWritten": total_files_written,
        "errorBreakdown": error_breakdown,
        "loadTypeBreakdown": load_type_breakdown,
        "extractionMethods": extraction_methods,
        "dominantExtractionMethod": dominant_method,
    }


# ---------------------------------------------------------------------------
# GET /api/lmc/sources — Fast source list for launch panel
# ---------------------------------------------------------------------------

@route("GET", "/api/lmc/sources")
def get_lmc_sources(params: dict) -> dict:
    """Return active sources with entity counts and display names. Fast (~3ms)."""
    rows = _safe_query(
        "SELECT ds.Name AS source, ds.DisplayName AS display_name, COUNT(*) AS entity_count "
        "FROM lz_entities le "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "WHERE le.IsActive = 1 "
        "GROUP BY ds.Name, ds.DisplayName ORDER BY ds.DisplayName, ds.Name"
    )
    return {
        "sources": [{
            "name": r["source"],
            "displayName": r["display_name"] or r["source"],
            "entityCount": _int(r["entity_count"]),
        } for r in rows],
    }


# ---------------------------------------------------------------------------
# GET /api/lmc/entity-ids-by-source — Resolve source names → entity IDs
# ---------------------------------------------------------------------------

@route("GET", "/api/lmc/entity-ids-by-source")
def get_entity_ids_by_source(params: dict) -> dict:
    """Return active LZ entity IDs for the given source names (comma-separated).

    Query params:
        sources — comma-separated source names (e.g. "M3C,MES")
    """
    sources_raw = params.get("sources", "")
    if not sources_raw:
        return {"entity_ids": [], "count": 0}

    source_names = [s.strip() for s in sources_raw.split(",") if s.strip()]
    if not source_names:
        return {"entity_ids": [], "count": 0}

    placeholders = ",".join("?" for _ in source_names)
    rows = _safe_query(
        f"SELECT le.LandingzoneEntityId "
        f"FROM lz_entities le "
        f"JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        f"WHERE le.IsActive = 1 AND ds.Name IN ({placeholders})",
        tuple(source_names),
    )
    ids = [_int(r["LandingzoneEntityId"]) for r in rows]
    return {"entity_ids": ids, "count": len(ids)}


# ---------------------------------------------------------------------------
# GET /api/lmc/progress — Enhanced overall progress
# ---------------------------------------------------------------------------

@route("GET", "/api/lmc/progress")
def get_lmc_progress(params: dict) -> dict:
    """Overall load progress with REAL counts derived from engine_task_log.

    Query params:
        run_id  — optional; scope to a specific run (default: latest)
    """
    run_id = params.get("run_id")

    # Find run to report on
    if not run_id:
        latest = _safe_query(
            "SELECT RunId FROM engine_runs ORDER BY StartedAt DESC LIMIT 1"
        )
        run_id = latest[0]["RunId"] if latest else None

    if not run_id:
        return {
            "run": None,
            "layers": {},
            "bySource": [],
            "errorBreakdown": [],
            "loadTypeBreakdown": [],
            "selfHeal": {
                "enabled": False,
                "configured": False,
                "availableAgents": [],
                "selectedAgent": None,
                "note": "Self-heal status is unavailable.",
                "runtime": {"status": "unknown", "currentCaseId": None, "workerPid": None, "agentName": None, "heartbeatAt": None, "lastMessage": None, "healthy": False},
                "summary": {"queuedCount": 0, "activeCount": 0, "succeededCount": 0, "exhaustedCount": 0, "disabledCount": 0, "totalCount": 0},
                "cases": [],
            },
            "serverTime": _utcnow_iso(),
        }

    # Run metadata
    run_rows = _safe_query(
        "SELECT * FROM engine_runs WHERE RunId = ?", (run_id,)
    )
    run_meta = run_rows[0] if run_rows else {}

    # Total active entities
    total_active = _safe_scalar(
        "SELECT COUNT(*) FROM lz_entities WHERE IsActive = 1"
    )

    run_truth = _summarize_run_truth(run_meta)
    layers = run_truth["layers"]
    by_source = run_truth["bySource"]
    by_source_layer = run_truth["bySourceByLayer"]

    # Error type breakdown
    error_breakdown = run_truth["errorBreakdown"]
    load_type_breakdown = run_truth["loadTypeBreakdown"]
    throughput = run_truth["throughput"]
    runtime_mode = "dry_run" if any(
        str(row.get("LoadType") or "").lower() == "dry_run"
        for row in load_type_breakdown
    ) else str(run_meta.get("Mode") or "").lower() or "unknown"
    is_dry_run = runtime_mode == "dry_run"
    mission_truth = _build_mission_truth(
        run_meta=run_meta,
        run_truth=run_truth,
        total_active=_int(total_active),
        runtime_mode=runtime_mode,
        is_dry_run=is_dry_run,
    )

    # Physical verification — LAZY: only when ?include_physical=1 is passed.
    # These LOWER() joins on lakehouse_row_counts are expensive (~3.5s each)
    # and not needed for the real-time progress view.
    include_physical = params.get("include_physical") == "1"

    if include_physical:
        verification = _safe_query(
            "SELECT "
            "  COUNT(DISTINCT le.LandingzoneEntityId) AS total_active, "
            "  COUNT(DISTINCT CASE WHEN lrc_lz.row_count > 0 THEN le.LandingzoneEntityId END) AS lz_verified, "
            "  COUNT(DISTINCT CASE WHEN lrc_br.row_count > 0 THEN le.LandingzoneEntityId END) AS brz_verified, "
            "  COUNT(DISTINCT CASE WHEN lrc_sv.row_count > 0 THEN le.LandingzoneEntityId END) AS slv_verified, "
            "  MAX(lrc_lz.scanned_at) AS lz_last_scan, "
            "  MAX(lrc_br.scanned_at) AS brz_last_scan "
            "FROM lz_entities le "
            "LEFT JOIN lakehouse_row_counts lrc_lz "
            "  ON lrc_lz.schema_name = le.FilePath "
            "  AND lrc_lz.table_name = le.SourceName "
            "  AND lrc_lz.lakehouse = 'LH_DATA_LANDINGZONE' "
            "LEFT JOIN lakehouse_row_counts lrc_br "
            "  ON lrc_br.schema_name = le.FilePath "
            "  AND lrc_br.table_name = le.SourceName "
            "  AND lrc_br.lakehouse = 'LH_BRONZE_LAYER' "
            "LEFT JOIN lakehouse_row_counts lrc_sv "
            "  ON lrc_sv.schema_name = le.FilePath "
            "  AND lrc_sv.table_name = le.SourceName "
            "  AND lrc_sv.lakehouse = 'LH_SILVER_LAYER' "
            "WHERE le.IsActive = 1"
        )

        lakehouse_state = _safe_query(
            "SELECT lakehouse, "
            "  COUNT(CASE WHEN row_count > 0 THEN 1 END) AS tables_with_data, "
            "  COUNT(CASE WHEN row_count = 0 THEN 1 END) AS empty_tables, "
            "  COUNT(CASE WHEN row_count = -1 THEN 1 END) AS scan_failed, "
            "  SUM(CASE WHEN row_count > 0 THEN row_count ELSE 0 END) AS total_rows, "
            "  SUM(CASE WHEN row_count > 0 THEN size_bytes ELSE 0 END) AS total_bytes, "
            "  MAX(scanned_at) AS last_scan "
            "FROM lakehouse_row_counts "
            "GROUP BY lakehouse"
        )
        lh_state = {}
        for lh in lakehouse_state:
            key = lh["lakehouse"]
            lh_state[key] = {
                "tablesWithData": _int(lh["tables_with_data"]),
                "emptyTables": _int(lh["empty_tables"]),
                "scanFailed": _int(lh["scan_failed"]),
                "totalRows": _int(lh["total_rows"]),
                "totalBytes": _int(lh["total_bytes"]),
                "lastScan": lh["last_scan"],
            }

        lh_by_source = _safe_query(
            "SELECT lrc.lakehouse, ds.Name AS source, "
            "  COUNT(CASE WHEN lrc.row_count > 0 THEN 1 END) AS tables_loaded, "
            "  SUM(CASE WHEN lrc.row_count > 0 THEN lrc.row_count ELSE 0 END) AS total_rows "
            "FROM lz_entities le "
            "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            "JOIN lakehouse_row_counts lrc "
            "  ON lrc.schema_name = le.FilePath "
            "  AND lrc.table_name = le.SourceName "
            "WHERE le.IsActive = 1 "
            "GROUP BY lrc.lakehouse, ds.Name "
            "ORDER BY lrc.lakehouse, ds.Name"
        )
    else:
        verification = []
        lh_state = {}
        lh_by_source = []

    try:
        from engine.self_heal import get_self_heal_status_payload
        self_heal = get_self_heal_status_payload(run_id=run_id, limit_cases=12, limit_events=6)
    except Exception as exc:
        log.warning("Self-heal status unavailable for LMC progress: %s", exc)
        self_heal = {
            "enabled": False,
            "configured": False,
            "availableAgents": [],
            "selectedAgent": None,
            "note": "Self-heal status is unavailable.",
            "runtime": {"status": "unknown", "currentCaseId": None, "workerPid": None, "agentName": None, "heartbeatAt": None, "lastMessage": str(exc), "healthy": False},
            "summary": {"queuedCount": 0, "activeCount": 0, "succeededCount": 0, "exhaustedCount": 0, "disabledCount": 0, "totalCount": 0},
            "cases": [],
        }

    return {
        "run": {
            "runId": run_meta.get("RunId", run_id),
            "mode": run_meta.get("Mode", ""),
            "status": run_meta.get("Status", "Unknown"),
            "totalEntities": _int(run_meta.get("TotalEntities", total_active)),
            "layers": run_meta.get("Layers", ""),
            "triggeredBy": run_meta.get("TriggeredBy", ""),
            "startedAt": run_meta.get("StartedAt"),
            "endedAt": run_meta.get("EndedAt"),
            "errorSummary": run_meta.get("ErrorSummary", ""),
            "sourceFilter": _split_csv(run_meta.get("SourceFilter")),
            "entityFilter": _parse_entity_filter(run_meta.get("EntityFilter")),
            "resolvedEntityCount": _int(run_meta.get("ResolvedEntityCount", run_meta.get("TotalEntities", total_active))),
        },
        "totalActiveEntities": _int(total_active),
        "layers": layers,
        "bySource": by_source,
        "bySourceByLayer": by_source_layer,
        "errorBreakdown": error_breakdown,
        "loadTypeBreakdown": load_type_breakdown,
        "runtimeMode": runtime_mode,
        "isDryRun": is_dry_run,
        "missionTruth": mission_truth,
        "rowsWritten": mission_truth["rowsWritten"],
        "filesWritten": mission_truth["filesWritten"],
        "throughput": {
            **throughput,
            "rows_per_sec": mission_truth["throughputRowsPerSecond"],
            "bytes_per_sec": mission_truth["throughputBytesPerSecond"],
        },
        "verification": verification[0] if verification else {
            "total_active": 0, "lz_verified": 0, "brz_verified": 0,
            "slv_verified": 0, "lz_last_scan": None, "brz_last_scan": None,
        },
        "selfHeal": self_heal,
        "lakehouseState": lh_state,
        "lakehouseBySource": lh_by_source,
        "serverTime": _utcnow_iso(),
    }


# ---------------------------------------------------------------------------
# GET /api/lmc/runs — Run history with real entity counts
# ---------------------------------------------------------------------------

@route("GET", "/api/lmc/runs")
def get_lmc_runs(params: dict) -> dict:
    """All engine runs with REAL succeeded/failed counts from task_log."""
    limit = min(_int(params.get("limit", 20)), 100)

    runs = _safe_query(
        "SELECT er.RunId, er.Mode, er.Status, er.TotalEntities, "
        "  er.Layers, er.TriggeredBy, er.ErrorSummary, "
        "  er.StartedAt, er.EndedAt, er.TotalDurationSeconds, "
        "  er.SourceFilter, er.EntityFilter, er.ResolvedEntityCount "
        "FROM engine_runs er "
        "ORDER BY er.StartedAt DESC LIMIT ?",
        (str(limit),),
    )

    mapped_runs = []
    for r in runs:
        run_truth = _summarize_run_truth(r)
        entity_summary = run_truth["entitySummary"]
        latest_rows = run_truth["latestRows"]
        has_task_truth = bool(latest_rows)
        succeeded = entity_summary["succeeded"] if has_task_truth or "succeeded" not in r else _int(r.get("succeeded"))
        failed = entity_summary["failed"] if has_task_truth or "failed" not in r else _int(r.get("failed"))
        skipped = entity_summary["skipped"] if has_task_truth or "skipped" not in r else _int(r.get("skipped"))
        mapped_runs.append({
            **r,
            "runId": r.get("RunId", ""),
            "mode": r.get("Mode", ""),
            "status": r.get("Status", "Unknown"),
            "totalEntities": _int(r.get("TotalEntities")),
            "layers": r.get("Layers", ""),
            "triggeredBy": r.get("TriggeredBy", ""),
            "errorSummary": r.get("ErrorSummary", ""),
            "startedAt": r.get("StartedAt"),
            "endedAt": r.get("EndedAt"),
            "totalDurationSeconds": float(r.get("TotalDurationSeconds") or 0),
            "succeeded": succeeded,
            "failed": failed,
            "skipped": skipped,
            "totalRowsRead": sum(_int(row.get("RowsRead")) for row in latest_rows if str(row.get("Status") or "").lower() == "succeeded"),
            "totalBytes": sum(_int(row.get("BytesTransferred")) for row in latest_rows if str(row.get("Status") or "").lower() == "succeeded"),
            "totalTaskLogs": len(latest_rows),
            "extractionMethod": run_truth["dominantExtractionMethod"],
            "sourceFilter": _split_csv(r.get("SourceFilter")),
            "entityFilter": _parse_entity_filter(r.get("EntityFilter")),
            "resolvedEntityCount": _int(r.get("ResolvedEntityCount", r.get("TotalEntities"))),
        })

    return {
        "runs": mapped_runs,
        "serverTime": _utcnow_iso(),
    }


# ---------------------------------------------------------------------------
# GET /api/lmc/run/{run_id} — Per-run detail
# ---------------------------------------------------------------------------

@route("GET", "/api/lmc/run/{run_id}")
def get_lmc_run_detail(params: dict) -> dict:
    """Full detail for a single run: per-layer, per-source, errors, optimization."""
    run_id = params.get("run_id", "")
    if not run_id:
        raise HttpError("run_id is required", 400)

    # Run metadata
    run_rows = _safe_query("SELECT * FROM engine_runs WHERE RunId = ?", (run_id,))
    if not run_rows:
        raise HttpError(f"Run {run_id} not found", 404)
    run_meta = run_rows[0]

    run_truth = _summarize_run_truth(run_meta)
    latest_rows = run_truth["latestRows"]
    source_name_by_id = {
        int(row.get("DataSourceId") or 0): row.get("Name") or ""
        for row in cpdb.get_source_config()
        if row.get("DataSourceId") is not None
    }
    layer_source = []
    for row in run_truth["bySourceByLayer"]:
        rows_written = 0
        duration = 0.0
        for task in latest_rows:
            if str(task.get("Layer") or "").lower() != row["layer"]:
                continue
            if str(task.get("Status") or "").lower() != "succeeded":
                continue
            if source_name_by_id.get(_int(task.get("DataSourceId"))) != row["source"]:
                continue
            rows_written += _int(task.get("RowsWritten"))
            duration += float(task.get("DurationSeconds") or 0)
        layer_source.append({
            **row,
            "rows_written": rows_written,
            "duration": round(duration, 2),
        })
    layer_source.sort(key=lambda entry: (entry["layer"], entry["source"]))

    failures = [
        {
            "EntityId": _int(row.get("LandingzoneEntityId")),
            "Layer": row.get("Layer"),
            "SourceTable": row.get("SourceTable"),
            "ErrorType": row.get("ErrorType"),
            "ErrorMessage": row.get("ErrorMessage"),
            "ErrorSuggestion": row.get("ErrorSuggestion"),
            "DurationSeconds": row.get("DurationSeconds"),
            "LoadType": row.get("LoadType"),
            "ExtractionMethod": row.get("ExtractionMethod"),
            "created_at": row.get("LoadEndDateTime"),
        }
        for row in latest_rows
        if str(row.get("Status") or "").lower() == "failed"
    ]

    load_types = [
        {"load_type": row["LoadType"], "count": _int(row["cnt"])}
        for row in run_truth["loadTypeBreakdown"]
    ]
    watermark_updates = [
        {
            "EntityId": _int(row.get("LandingzoneEntityId")),
            "SourceTable": row.get("SourceTable"),
            "WatermarkColumn": row.get("WatermarkColumn"),
            "WatermarkBefore": row.get("WatermarkBefore"),
            "WatermarkAfter": row.get("WatermarkAfter"),
            "Layer": row.get("Layer"),
        }
        for row in latest_rows
        if row.get("WatermarkAfter")
    ]

    entity_results_mapped = [{
        "entityId": _int(r.get("LandingzoneEntityId")),
        "layer": r.get("Layer"),
        "status": r.get("Status"),
        "sourceTable": r.get("SourceTable"),
        "rowsRead": _int(r.get("RowsRead")),
        "rowsWritten": _int(r.get("RowsWritten")),
        "bytesTransferred": _int(r.get("BytesTransferred")),
        "durationSeconds": float(r.get("DurationSeconds") or 0),
        "loadType": r.get("LoadType"),
        "extractionMethod": r.get("ExtractionMethod") or "unknown",
        "completedAt": r.get("LoadEndDateTime"),
    } for r in latest_rows]

    extraction_methods = run_truth["extractionMethods"]

    # Timeline: entity completions over time (for progress chart)
    timeline = _safe_query(
        "SELECT "
        "  strftime('%Y-%m-%dT%H:%M:00Z', created_at) AS minute, "
        "  Layer, Status, "
        "  COUNT(*) AS cnt, "
        "  SUM(RowsRead) AS rows_read "
        "FROM engine_task_log "
        "WHERE RunId = ? "
        "GROUP BY minute, Layer, Status "
        "ORDER BY minute",
        (run_id,),
    )

    try:
        from engine.self_heal import get_self_heal_status_payload
        self_heal = get_self_heal_status_payload(run_id=run_id, limit_cases=20, limit_events=8)
    except Exception as exc:
        log.warning("Self-heal status unavailable for run detail %s: %s", run_id, exc)
        self_heal = {
            "enabled": False,
            "configured": False,
            "availableAgents": [],
            "selectedAgent": None,
            "note": "Self-heal status is unavailable.",
            "runtime": {"status": "unknown", "currentCaseId": None, "workerPid": None, "agentName": None, "heartbeatAt": None, "lastMessage": str(exc), "healthy": False},
            "summary": {"queuedCount": 0, "activeCount": 0, "succeededCount": 0, "exhaustedCount": 0, "disabledCount": 0, "totalCount": 0},
            "cases": [],
        }

    return {
        "run": {
            "runId": run_meta.get("RunId"),
            "mode": run_meta.get("Mode"),
            "status": run_meta.get("Status"),
            "totalEntities": _int(run_meta.get("TotalEntities")),
            "layers": run_meta.get("Layers", ""),
            "triggeredBy": run_meta.get("TriggeredBy", ""),
            "startedAt": run_meta.get("StartedAt"),
            "endedAt": run_meta.get("EndedAt"),
            "errorSummary": run_meta.get("ErrorSummary", ""),
            "sourceFilter": _split_csv(run_meta.get("SourceFilter")),
            "entityFilter": _parse_entity_filter(run_meta.get("EntityFilter")),
            "resolvedEntityCount": _int(run_meta.get("ResolvedEntityCount", run_meta.get("TotalEntities"))),
        },
        "layerSource": layer_source,
        "failures": [{
            **f,
            "extractionMethod": f.get("ExtractionMethod") or "unknown",
            "completedAt": f.get("created_at"),
        } for f in failures],
        "entityResults": entity_results_mapped,
        "extractionMethods": extraction_methods,
        "selfHeal": self_heal,
        "loadTypes": load_types,
        "watermarkUpdates": len(watermark_updates),
        "timeline": [{
            "ts": row["minute"],
            "event": f"{row['Layer']}:{row['Status']}",
            "detail": f"{_int(row['cnt'])} entries, {_int(row['rows_read'])} rows",
        } for row in timeline],
        "serverTime": _utcnow_iso(),
    }


# ---------------------------------------------------------------------------
# GET /api/lmc/run/{run_id}/receipt — Real smoke receipt / artifact evidence
# ---------------------------------------------------------------------------

@route("GET", "/api/lmc/run/{run_id}/receipt")
def get_lmc_run_receipt(params: dict) -> dict:
    """Return machine-readable real-load receipt evidence for a selected run."""
    run_id = params.get("run_id", "")
    if not run_id:
        raise HttpError("run_id is required", 400)

    run_rows = _safe_query("SELECT * FROM engine_runs WHERE RunId = ?", (run_id,))
    if not run_rows:
        raise HttpError(f"Run {run_id} not found", 404)

    receipt_path = _receipt_path_for_run(run_id)
    task_artifacts = _task_log_receipt_artifacts(run_id)
    if not receipt_path.exists():
        return {
            "runId": run_id,
            "available": False,
            "ok": False,
            "generatedAt": None,
            "receiptPath": str(receipt_path),
            "summary": {
                "passed": 0,
                "warnings": 0,
                "notChecked": len(task_artifacts),
                "failed": 0,
            },
            "checks": [],
            "artifacts": task_artifacts,
            "message": "No real-load receipt file has been generated for this run yet.",
            "serverTime": _utcnow_iso(),
        }

    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("Failed to read real-load receipt %s: %s", receipt_path, exc)
        return {
            "runId": run_id,
            "available": False,
            "ok": False,
            "generatedAt": None,
            "receiptPath": str(receipt_path),
            "summary": {"passed": 0, "warnings": 0, "notChecked": 0, "failed": 1},
            "checks": [{
                "id": "receipt_parse",
                "status": "failed",
                "message": f"Receipt exists but could not be parsed: {exc}",
            }],
            "artifacts": task_artifacts,
            "message": "Receipt exists but is not readable JSON.",
            "serverTime": _utcnow_iso(),
        }

    return {
        "runId": run_id,
        "available": True,
        "ok": bool(receipt.get("ok")),
        "generatedAt": receipt.get("generatedAt"),
        "receiptPath": str(receipt_path),
        "missionControlUrl": receipt.get("missionControlUrl"),
        "summary": receipt.get("summary") or {},
        "checks": receipt.get("checks") or [],
        "artifacts": _flatten_receipt_artifacts(receipt) or task_artifacts,
        "message": "Real-load receipt loaded.",
        "serverTime": _utcnow_iso(),
    }


# ---------------------------------------------------------------------------
# GET /api/lmc/run/{run_id}/scope-inventory — Truthful scope inventory
# ---------------------------------------------------------------------------

@route("GET", "/api/lmc/run/{run_id}/scope-inventory")
def get_lmc_run_scope_inventory(params: dict) -> dict:
    """Return run-scoped table inventory with run status, history, and lakehouse presence."""
    run_id = params.get("run_id", "")
    if not run_id:
        raise HttpError("run_id is required", 400)

    run_rows = _safe_query("SELECT * FROM engine_runs WHERE RunId = ?", (run_id,))
    if not run_rows:
        raise HttpError(f"Run {run_id} not found", 404)
    run_meta = run_rows[0]
    run_layers = _parse_run_layers(run_meta.get("Layers"))

    scope_entities = _resolve_run_scope_entities(run_meta)
    scoped_entity_ids = [_int(entity.get("entityId")) for entity in scope_entities if entity.get("entityId") is not None]

    run_lookup = _get_run_scope_inventory_rows(run_id, scoped_entity_ids)
    latest_any_lookup = {
        (_int(row.get("LandingzoneEntityId")), str(row.get("Layer") or "").lower()): row
        for row in cpdb.get_mapped_engine_task_log(latest_only=True)
        if _int(row.get("LandingzoneEntityId")) in scoped_entity_ids
    }
    latest_success_lookup = {
        (_int(row.get("LandingzoneEntityId")), str(row.get("Layer") or "").lower()): row
        for row in cpdb.get_mapped_engine_task_log(latest_only=True, success_only=True)
        if _int(row.get("LandingzoneEntityId")) in scoped_entity_ids
    }

    physical_rows = _safe_query(
        "SELECT lakehouse, LOWER(schema_name) AS schema_name, LOWER(table_name) AS table_name, row_count, scanned_at "
        "FROM lakehouse_row_counts"
    )
    physical_lookup = {
        (str(row.get("lakehouse") or ""), str(row.get("schema_name") or ""), str(row.get("table_name") or "")): row
        for row in physical_rows
    }

    entities_payload: list[dict] = []
    summary = {
        "scopeEntityCount": len(scope_entities),
        "attemptedInRunCount": 0,
        "runGapCount": 0,
        "runMissingByLayer": {layer: 0 for layer in _SUPPORTED_LAYERS},
        "historicalMissingByLayer": {layer: 0 for layer in _SUPPORTED_LAYERS},
        "physicalMissingByLayer": {layer: 0 for layer in _SUPPORTED_LAYERS},
    }

    for entity in scope_entities:
        entity_id = _int(entity.get("entityId"))
        schema = str(entity.get("schema") or "").lower()
        table_name = str(entity.get("tableName") or "").lower()
        strategy = _classify_load_strategy(entity)

        run_layer_status: dict[str, dict] = {}
        history_layer_status: dict[str, dict] = {}
        physical_layer_status: dict[str, dict] = {}
        run_missing_layers: list[str] = []
        never_succeeded_layers: list[str] = []
        missing_physical_layers: list[str] = []

        for layer in _SUPPORTED_LAYERS:
            run_row = run_lookup.get((entity_id, layer))
            latest_any = latest_any_lookup.get((entity_id, layer))
            latest_success = latest_success_lookup.get((entity_id, layer))
            physical_row = physical_lookup.get((_LAYER_LAKEHOUSE[layer], schema, table_name))

            run_status = str(run_row.get("Status") or "not_started").lower() if run_row else "not_started"
            run_layer_status[layer] = {
                "status": run_status,
                "at": run_row.get("LoadEndDateTime") if run_row else None,
                "runId": run_row.get("RunId") if run_row else None,
                "errorMessage": run_row.get("ErrorMessage") if run_row else None,
                "rowsRead": _int(run_row.get("RowsRead")) if run_row else 0,
                "rowsWritten": _int(run_row.get("RowsWritten")) if run_row else 0,
            }
            if layer in run_layers and run_status != "succeeded":
                run_missing_layers.append(layer)
                summary["runMissingByLayer"][layer] += 1

            history_layer_status[layer] = {
                "latestStatus": str(latest_any.get("Status") or "").lower() if latest_any else None,
                "latestAt": latest_any.get("LoadEndDateTime") if latest_any else None,
                "latestRunId": latest_any.get("RunId") if latest_any else None,
                "everSucceeded": latest_success is not None,
                "lastSuccessAt": latest_success.get("LoadEndDateTime") if latest_success else None,
                "lastSuccessRunId": latest_success.get("RunId") if latest_success else None,
            }
            if latest_success is None:
                never_succeeded_layers.append(layer)
                summary["historicalMissingByLayer"][layer] += 1

            row_count = None
            scan_failed = False
            exists = False
            scanned_at = None
            if physical_row:
                scanned_at = physical_row.get("scanned_at")
                raw_row_count = physical_row.get("row_count")
                row_count = _int(raw_row_count)
                scan_failed = row_count < 0
                exists = row_count >= 0
                if scan_failed:
                    row_count = None
            physical_layer_status[layer] = {
                "exists": exists,
                "rowCount": row_count,
                "scannedAt": scanned_at,
                "scanFailed": scan_failed,
            }
            if not exists:
                missing_physical_layers.append(layer)
                summary["physicalMissingByLayer"][layer] += 1

        run_attempted = any(run_layer_status[layer]["status"] != "not_started" for layer in _SUPPORTED_LAYERS)
        if run_attempted:
            summary["attemptedInRunCount"] += 1
        if run_missing_layers:
            summary["runGapCount"] += 1

        entities_payload.append({
            "entityId": entity_id,
            "source": entity.get("source"),
            "sourceDisplay": entity.get("sourceDisplay") or entity.get("source"),
            "schema": entity.get("schema"),
            "table": entity.get("tableName"),
            "isIncremental": bool(entity.get("isIncremental")),
            "watermarkColumn": entity.get("watermarkColumn"),
            "lastWatermark": entity.get("lastWatermark"),
            "runAttempted": run_attempted,
            "runMissingLayers": run_missing_layers,
            "neverSucceededLayers": never_succeeded_layers,
            "missingPhysicalLayers": missing_physical_layers,
            "nextAction": strategy["nextAction"],
            "nextActionLabel": strategy["nextActionLabel"],
            "nextActionReason": strategy["reason"],
            "runLayerStatus": run_layer_status,
            "historyLayerStatus": history_layer_status,
            "physicalLayerStatus": physical_layer_status,
        })

    return {
        "run": {
            "runId": run_meta.get("RunId"),
            "status": run_meta.get("Status"),
            "layersInScope": run_layers,
            "sourceFilter": _split_csv(run_meta.get("SourceFilter")),
            "entityFilter": _parse_entity_filter(run_meta.get("EntityFilter")),
            "resolvedEntityCount": _int(run_meta.get("ResolvedEntityCount", len(scope_entities))),
        },
        "summary": summary,
        "entities": entities_payload,
        "serverTime": _utcnow_iso(),
    }


# ---------------------------------------------------------------------------
# GET /api/lmc/run/{run_id}/entities — Filterable entity list
# ---------------------------------------------------------------------------

@route("GET", "/api/lmc/run/{run_id}/entities")
def get_lmc_run_entities(params: dict) -> dict:
    """Per-entity detail for a run with filtering.

    Query params:
        source  — filter by datasource name
        layer   — filter by layer (landing, bronze, silver)
        status  — filter by status (succeeded, failed, skipped)
        search  — search by table name (LIKE)
        sort    — sort column (default: created_at)
        order   — asc or desc (default: desc)
        limit   — max results (default: 200, max: 1000)
        offset  — pagination offset (default: 0)
    """
    run_id = params.get("run_id", "")
    if not run_id:
        return {
            "entities": [],
            "total": 0,
            "limit": min(_int(params.get("limit", 200)), 1000),
            "offset": _int(params.get("offset", 0)),
            "serverTime": _utcnow_iso(),
        }

    source_filter = str(params.get("source") or "").strip()
    layer_filter = str(params.get("layer") or "").strip().lower()
    status_filter = str(params.get("status") or "").strip().lower()
    search = str(params.get("search") or "").strip().lower()

    limit = min(_int(params.get("limit", 200)), 1000)
    offset = _int(params.get("offset", 0))
    order = "asc" if str(params.get("order", "desc")).lower() == "asc" else "desc"
    sort_key = str(params.get("sort", "created_at"))

    source_lookup = {
        int(row.get("DataSourceId") or 0): row
        for row in cpdb.get_source_config()
        if row.get("DataSourceId") is not None
    }
    registered_lookup = {
        _int(row.get("LandingzoneEntityId")): row
        for row in cpdb.get_registered_entities_full()
        if row.get("LandingzoneEntityId") is not None
    }
    physical_rows = _safe_query(
        "SELECT lakehouse, LOWER(schema_name) AS schema_name, LOWER(table_name) AS table_name, row_count, scanned_at "
        "FROM lakehouse_row_counts"
    )
    physical_lookup = {
        (str(row.get("lakehouse") or ""), str(row.get("schema_name") or ""), str(row.get("table_name") or "")): row
        for row in physical_rows
    }

    entities = []
    for row in _get_run_task_rows(run_id):
        entity_id = _int(row.get("LandingzoneEntityId") or row.get("EntityId"))
        ds = source_lookup.get(_int(row.get("DataSourceId")), {})
        source_name = str(ds.get("Name") or "")
        if source_filter and source_name != source_filter:
            continue

        layer_name = str(row.get("Layer") or "").lower()
        if layer_filter and layer_name != layer_filter:
            continue

        status_name = str(row.get("Status") or "").lower()
        if status_filter and status_name != status_filter:
            continue

        schema_name = str(row.get("SourceSchema") or "").strip()
        table_name = str(row.get("SourceName") or row.get("SourceTable") or "").strip()
        search_target = f"{schema_name}.{table_name}".lower()
        if search and search not in search_target:
            continue

        entity_meta = registered_lookup.get(entity_id, {})
        namespace = str(entity_meta.get("FilePath") or schema_name or "").lower()
        physical_table_name = str(entity_meta.get("SourceName") or table_name or "").lower()
        lz_physical = physical_lookup.get(("LH_DATA_LANDINGZONE", namespace, physical_table_name), {})
        brz_physical = physical_lookup.get(("LH_BRONZE_LAYER", namespace, physical_table_name), {})
        slv_physical = physical_lookup.get(("LH_SILVER_LAYER", namespace, physical_table_name), {})

        entities.append({
            "id": _int(row.get("id")),
            "EntityId": entity_id,
            "Layer": row.get("Layer"),
            "Status": row.get("Status"),
            "SourceServer": row.get("SourceServer") or entity_meta.get("ServerName"),
            "SourceDatabase": row.get("SourceDatabase") or entity_meta.get("DatabaseName"),
            "SourceTable": table_name,
            "RowsRead": _int(row.get("RowsRead")),
            "RowsWritten": _int(row.get("RowsWritten")),
            "BytesTransferred": _int(row.get("BytesTransferred")),
            "DurationSeconds": float(row.get("DurationSeconds") or 0),
            "LoadType": row.get("LoadType"),
            "WatermarkColumn": row.get("WatermarkColumn"),
            "WatermarkBefore": row.get("WatermarkBefore"),
            "WatermarkAfter": row.get("WatermarkAfter"),
            "ErrorType": row.get("ErrorType"),
            "ErrorMessage": row.get("ErrorMessage"),
            "ErrorSuggestion": row.get("ErrorSuggestion"),
            "SourceQuery": row.get("SourceQuery"),
            "created_at": row.get("LoadEndDateTime"),
            "source": source_name,
            "lz_physical_rows": lz_physical.get("row_count"),
            "lz_scanned_at": lz_physical.get("scanned_at"),
            "brz_physical_rows": brz_physical.get("row_count"),
            "brz_scanned_at": brz_physical.get("scanned_at"),
            "slv_physical_rows": slv_physical.get("row_count"),
            "slv_scanned_at": slv_physical.get("scanned_at"),
        })

    sort_value_by_key = {
        "created_at": lambda row: str(row.get("created_at") or ""),
        "rows": lambda row: _int(row.get("RowsRead")),
        "duration": lambda row: float(row.get("DurationSeconds") or 0),
        "table": lambda row: str(row.get("SourceTable") or ""),
        "bytes": lambda row: _int(row.get("BytesTransferred")),
        "status": lambda row: str(row.get("Status") or ""),
        "layer": lambda row: str(row.get("Layer") or ""),
    }
    key_fn = sort_value_by_key.get(sort_key, sort_value_by_key["created_at"])
    entities.sort(key=key_fn, reverse=(order != "asc"))
    total = len(entities)
    entities = entities[offset: offset + limit]

    return {
        "entities": entities,
        "total": total,
        "limit": limit,
        "offset": offset,
        "serverTime": _utcnow_iso(),
    }


# ---------------------------------------------------------------------------
# GET /api/lmc/entity/{entity_id}/history — Entity across all runs
# ---------------------------------------------------------------------------

@route("GET", "/api/lmc/entity/{entity_id}/history")
def get_lmc_entity_history(params: dict) -> dict:
    """Full history for a single entity across all runs.

    Shows retries (multiple entries per run), watermark progression,
    and error patterns.
    """
    entity_id = params.get("entity_id", "")
    try:
        eid = int(entity_id)
    except (TypeError, ValueError):
        raise HttpError(f"Invalid entity_id: {entity_id!r}", 400)

    # Entity metadata
    entity_meta = _safe_query(
        "SELECT le.*, ds.Name AS source "
        "FROM lz_entities le "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "WHERE le.LandingzoneEntityId = ?",
        (str(eid),),
    )
    if not entity_meta:
        return {
            "entity": None,
            "watermark": None,
            "history": [],
            "retries": [],
            "serverTime": _utcnow_iso(),
        }

    # Current watermark
    watermark = _safe_query(
        "SELECT * FROM watermarks WHERE LandingzoneEntityId = ?",
        (str(eid),),
    )

    limit = min(_int(params.get("limit", 50)), 200)
    history = _safe_query(
        f"""
        {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
        SELECT
            t.id,
            mapped.RunId,
            mapped.Layer,
            mapped.Status,
            mapped.SourceTable,
            mapped.RowsRead,
            mapped.RowsWritten,
            t.BytesTransferred,
            t.DurationSeconds,
            t.LoadType,
            t.WatermarkColumn,
            t.WatermarkBefore,
            t.WatermarkAfter,
            t.ErrorType,
            t.ErrorMessage,
            t.ErrorSuggestion,
            t.SourceQuery,
            COALESCE(mapped.LoadEndDateTime, t.created_at) AS created_at,
            er.Status AS runStatus,
            er.StartedAt AS runStartedAt
        FROM mapped
        JOIN engine_task_log t ON t.id = mapped.id
        LEFT JOIN engine_runs er ON mapped.RunId = er.RunId
        WHERE mapped.LandingzoneEntityId = ?
        ORDER BY COALESCE(mapped.LoadEndDateTime, t.created_at) DESC, t.id DESC
        LIMIT ?
        """,
        (str(eid), str(limit)),
    )

    retries = _safe_query(
        f"""
        {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
        SELECT mapped.RunId, mapped.Layer, COUNT(*) AS attempts
        FROM mapped
        WHERE mapped.LandingzoneEntityId = ?
        GROUP BY mapped.RunId, mapped.Layer
        HAVING COUNT(*) > 1
        ORDER BY mapped.RunId DESC, mapped.Layer
        """,
        (str(eid),),
    )

    return {
        "entity": entity_meta[0],
        "watermark": watermark[0] if watermark else None,
        "history": history,
        "retries": retries,
        "serverTime": _utcnow_iso(),
    }


# ---------------------------------------------------------------------------
# GET /api/lmc/compare — Side-by-side run comparison
# ---------------------------------------------------------------------------

@route("GET", "/api/lmc/compare")
def compare_runs(params, body=None, headers=None):
    """Compare two runs side-by-side for performance benchmarking."""
    run_a = params.get("run_a", "").strip()
    run_b = params.get("run_b", "").strip()
    if not run_a or not run_b:
        raise HttpError("run_a and run_b query params required", 400)

    conn = cpdb._get_conn()

    def _run_stats(rid):
        # Wall-clock duration from engine_runs
        run_row = conn.execute("""
            SELECT StartedAt, EndedAt,
                   ROUND((julianday(EndedAt) - julianday(StartedAt)) * 86400, 2) AS wall_clock_secs
            FROM engine_runs WHERE RunId = ?
        """, (rid,)).fetchone()
        wall_clock = run_row[2] if run_row and run_row[2] else None

        # Deduplicated entity stats (latest succeeded landing per entity)
        row = conn.execute("""
            WITH deduped AS (
                SELECT EntityId, RowsRead, BytesTransferred, DurationSeconds, ExtractionMethod,
                       ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
                FROM engine_task_log
                WHERE RunId = ? AND Status = 'succeeded' AND Layer = 'landing'
            )
            SELECT COUNT(*) AS entity_count,
                   SUM(RowsRead) AS total_rows,
                   ROUND(SUM(DurationSeconds), 2) AS entity_duration_sum,
                   ROUND(SUM(RowsRead) * 1.0 / NULLIF(SUM(DurationSeconds), 0), 1) AS rows_per_sec,
                   ROUND(SUM(BytesTransferred) * 1.0 / NULLIF(SUM(DurationSeconds), 0), 1) AS bytes_per_sec,
                   (SELECT ExtractionMethod FROM engine_task_log
                    WHERE RunId = ? AND ExtractionMethod != 'unknown'
                    GROUP BY ExtractionMethod ORDER BY COUNT(*) DESC LIMIT 1) AS extraction_method
            FROM deduped WHERE rn = 1
        """, (rid, rid)).fetchone()
        if not row or not row[0]:
            return None

        # Median and p95 entity duration
        durations = conn.execute("""
            WITH deduped AS (
                SELECT DurationSeconds,
                       ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
                FROM engine_task_log
                WHERE RunId = ? AND Status = 'succeeded' AND Layer = 'landing'
            )
            SELECT DurationSeconds FROM deduped WHERE rn = 1 ORDER BY DurationSeconds
        """, (rid,)).fetchall()
        dur_list = [d[0] for d in durations if d[0]]
        median_dur = dur_list[len(dur_list) // 2] if dur_list else 0
        p95_dur = dur_list[int(len(dur_list) * 0.95)] if dur_list else 0

        return {
            "run_id": rid,
            "entity_count": row[0] or 0,
            "total_rows": row[1] or 0,
            "entity_duration_sum": row[2] or 0,
            "wall_clock_duration": wall_clock,
            "rows_per_sec": row[3] or 0,
            "bytes_per_sec": row[4] or 0,
            "extraction_method": row[5] or "unknown",
            "median_entity_duration": round(median_dur, 2),
            "p95_entity_duration": round(p95_dur, 2),
        }

    stats_a = _run_stats(run_a)
    stats_b = _run_stats(run_b)
    if not stats_a or not stats_b:
        raise HttpError("One or both runs not found or have no succeeded entities", 404)

    # Matched entities — deduplicated (latest succeeded landing per entity per run)
    matched = conn.execute("""
        WITH deduped_a AS (
            SELECT EntityId, SourceTable, RowsRead, DurationSeconds,
                   ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
            FROM engine_task_log
            WHERE RunId = ? AND Status = 'succeeded' AND Layer = 'landing'
        ),
        deduped_b AS (
            SELECT EntityId, RowsRead, DurationSeconds,
                   ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
            FROM engine_task_log
            WHERE RunId = ? AND Status = 'succeeded' AND Layer = 'landing'
        )
        SELECT a.EntityId, a.SourceTable,
               a.RowsRead AS rows,
               a.DurationSeconds AS dur_a,
               b.DurationSeconds AS dur_b,
               ROUND(a.DurationSeconds / NULLIF(b.DurationSeconds, 0), 2) AS speedup
        FROM deduped_a a
        INNER JOIN deduped_b b ON a.EntityId = b.EntityId
        WHERE a.rn = 1 AND b.rn = 1
        ORDER BY speedup DESC
    """, (run_a, run_b)).fetchall()

    # Use wall-clock for headline speedup when available, fall back to entity sum
    dur_a = stats_a.get("wall_clock_duration") or stats_a["entity_duration_sum"]
    dur_b = stats_b.get("wall_clock_duration") or stats_b["entity_duration_sum"]
    speedup = round(dur_a / max(dur_b, 0.01), 1)

    return {
        "run_a": stats_a,
        "run_b": stats_b,
        "speedup": speedup,
        "speedup_basis": "wall_clock" if stats_a.get("wall_clock_duration") else "entity_sum",
        "matched_entities": [
            {
                "entity_id": r[0],
                "source_name": r[1] or "",
                "rows": r[2] or 0,
                "run_a_duration": r[3] or 0,
                "run_b_duration": r[4] or 0,
                "speedup": r[5] or 0,
            }
            for r in matched
        ],
    }
