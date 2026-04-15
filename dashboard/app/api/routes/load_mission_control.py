"""Load Mission Control routes — the single source of truth for load monitoring.

Replaces the thin /api/load-progress endpoint with rich, task_log-backed data.

Endpoints:
    GET /api/lmc/progress              — Enhanced overall progress (real counts from task_log)
    GET /api/lmc/runs                  — Run history with real entity counts
    GET /api/lmc/run/{run_id}          — Per-run detail (layers, sources, errors, optimization)
    GET /api/lmc/run/{run_id}/entities — Filterable per-entity list for a run
    GET /api/lmc/entity/{entity_id}/history — Entity across all runs (retries, watermarks)
"""

import logging
from datetime import datetime, timezone

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

    # Per-layer counts from task_log (THE source of truth)
    layer_stats = _safe_query(
        "SELECT Layer, Status, "
        "  COUNT(*) AS cnt, "
        "  COUNT(DISTINCT EntityId) AS unique_entities, "
        "  SUM(RowsRead) AS total_rows_read, "
        "  SUM(RowsWritten) AS total_rows_written, "
        "  SUM(BytesTransferred) AS total_bytes, "
        "  ROUND(SUM(DurationSeconds), 2) AS total_duration, "
        "  ROUND(AVG(DurationSeconds), 2) AS avg_duration "
        "FROM engine_task_log WHERE RunId = ? "
        "GROUP BY Layer, Status ORDER BY Layer, Status",
        (run_id,),
    )

    # Build per-layer summary
    layers = {}
    for row in layer_stats:
        layer = row["Layer"]
        if layer not in layers:
            layers[layer] = {
                "succeeded": 0, "failed": 0, "skipped": 0,
                "total_rows_read": 0, "total_rows_written": 0,
                "total_bytes": 0, "total_duration": 0,
                "avg_duration": 0, "unique_entities": 0,
            }
        status_key = row["Status"]
        if status_key in ("succeeded", "failed", "skipped"):
            layers[layer][status_key] = _int(row["unique_entities"])
        layers[layer]["total_rows_read"] += _int(row["total_rows_read"])
        layers[layer]["total_rows_written"] += _int(row["total_rows_written"])
        layers[layer]["total_bytes"] += _int(row["total_bytes"])
        layers[layer]["total_duration"] += float(row["total_duration"] or 0)
        if status_key == "succeeded":
            layers[layer]["avg_duration"] = float(row["avg_duration"] or 0)
            layers[layer]["unique_entities"] = _int(row["unique_entities"])

    # Per-source progress for this run (aggregated across layers for backward compat)
    by_source = _safe_query(
        "SELECT ds.Name AS source, "
        "  COUNT(DISTINCT le.LandingzoneEntityId) AS total_entities, "
        "  COUNT(DISTINCT CASE WHEN etl.Status = 'succeeded' THEN etl.EntityId END) AS succeeded, "
        "  COUNT(DISTINCT CASE WHEN etl.Status = 'failed' THEN etl.EntityId END) AS failed, "
        "  COUNT(DISTINCT CASE WHEN etl.Status = 'skipped' THEN etl.EntityId END) AS skipped, "
        "  SUM(CASE WHEN etl.Status = 'succeeded' THEN etl.RowsRead ELSE 0 END) AS rows_read, "
        "  SUM(CASE WHEN etl.Status = 'succeeded' THEN etl.BytesTransferred ELSE 0 END) AS bytes "
        "FROM lz_entities le "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "LEFT JOIN engine_task_log etl ON le.LandingzoneEntityId = etl.EntityId "
        "  AND etl.RunId = ? "
        "WHERE le.IsActive = 1 "
        "GROUP BY ds.Name ORDER BY ds.Name",
        (run_id,),
    )

    # Per-source PER-LAYER progress — the matrix truth source
    by_source_layer = _safe_query(
        "SELECT ds.Name AS source, etl.Layer AS layer, "
        "  COUNT(DISTINCT CASE WHEN etl.Status = 'succeeded' THEN etl.EntityId END) AS succeeded, "
        "  COUNT(DISTINCT CASE WHEN etl.Status = 'failed' THEN etl.EntityId END) AS failed, "
        "  COUNT(DISTINCT CASE WHEN etl.Status = 'skipped' THEN etl.EntityId END) AS skipped, "
        "  SUM(CASE WHEN etl.Status = 'succeeded' THEN etl.RowsRead ELSE 0 END) AS rows_read, "
        "  SUM(CASE WHEN etl.Status = 'succeeded' THEN etl.BytesTransferred ELSE 0 END) AS bytes "
        "FROM engine_task_log etl "
        "JOIN lz_entities le ON le.LandingzoneEntityId = etl.EntityId "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "WHERE etl.RunId = ? AND etl.Layer IS NOT NULL "
        "GROUP BY ds.Name, etl.Layer ORDER BY ds.Name, etl.Layer",
        (run_id,),
    )

    # Error type breakdown
    error_breakdown = _safe_query(
        "SELECT ErrorType, COUNT(*) AS cnt "
        "FROM engine_task_log "
        "WHERE RunId = ? AND Status = 'failed' AND ErrorType != '' "
        "GROUP BY ErrorType ORDER BY cnt DESC",
        (run_id,),
    )

    # Load type breakdown (incremental vs full)
    load_type_breakdown = _safe_query(
        "SELECT LoadType, COUNT(*) AS cnt, "
        "  SUM(RowsRead) AS total_rows "
        "FROM engine_task_log "
        "WHERE RunId = ? AND Status = 'succeeded' "
        "GROUP BY LoadType",
        (run_id,),
    )

    # Throughput: rows per second for succeeded entities
    throughput = _safe_query(
        "SELECT ROUND(SUM(RowsRead) * 1.0 / NULLIF(SUM(DurationSeconds), 0), 1) AS rows_per_sec, "
        "  ROUND(SUM(BytesTransferred) * 1.0 / NULLIF(SUM(DurationSeconds), 0), 1) AS bytes_per_sec "
        "FROM engine_task_log WHERE RunId = ? AND Status = 'succeeded'",
        (run_id,),
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
        "throughput": throughput[0] if throughput else {"rows_per_sec": 0, "bytes_per_sec": 0},
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

    run_ids = [r.get("RunId") for r in runs if r.get("RunId")]
    tasklog_agg: dict[str, dict] = {}
    extraction_method_by_run: dict[str, str] = {}

    if run_ids:
        placeholders = ",".join("?" for _ in run_ids)
        agg_rows = _safe_query(
            f"SELECT etl.RunId, "
            f"  COUNT(DISTINCT CASE WHEN etl.Status = 'succeeded' THEN etl.EntityId END) AS actualSucceeded, "
            f"  COUNT(DISTINCT CASE WHEN etl.Status = 'failed' THEN etl.EntityId END) AS actualFailed, "
            f"  COUNT(DISTINCT CASE WHEN etl.Status = 'skipped' THEN etl.EntityId END) AS actualSkipped, "
            f"  SUM(CASE WHEN etl.Status = 'succeeded' THEN etl.RowsRead ELSE 0 END) AS totalRowsRead, "
            f"  SUM(CASE WHEN etl.Status = 'succeeded' THEN etl.BytesTransferred ELSE 0 END) AS totalBytes, "
            f"  COUNT(*) AS totalTaskLogs "
            f"FROM engine_task_log etl "
            f"WHERE etl.RunId IN ({placeholders}) "
            f"GROUP BY etl.RunId",
            tuple(run_ids),
        )
        tasklog_agg = {r["RunId"]: r for r in agg_rows}

        method_rows = _safe_query(
            f"WITH method_counts AS ("
            f"  SELECT RunId, COALESCE(NULLIF(ExtractionMethod, ''), 'unknown') AS extraction_method, "
            f"         COUNT(*) AS cnt "
            f"  FROM engine_task_log "
            f"  WHERE RunId IN ({placeholders}) "
            f"    AND COALESCE(NULLIF(ExtractionMethod, ''), 'unknown') != 'unknown' "
            f"  GROUP BY RunId, COALESCE(NULLIF(ExtractionMethod, ''), 'unknown')"
            f"), ranked AS ("
            f"  SELECT RunId, extraction_method, "
            f"         ROW_NUMBER() OVER (PARTITION BY RunId ORDER BY cnt DESC, extraction_method ASC) AS rn "
            f"  FROM method_counts"
            f") "
            f"SELECT RunId, extraction_method FROM ranked WHERE rn = 1",
            tuple(run_ids),
        )
        extraction_method_by_run = {
            r["RunId"]: r.get("extraction_method") or "unknown"
            for r in method_rows
        }

    mapped_runs = []
    for r in runs:
        agg = tasklog_agg.get(r.get("RunId"), {})
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
            "succeeded": _int(agg.get("actualSucceeded", r.get("SucceededEntities"))),
            "failed": _int(agg.get("actualFailed", r.get("FailedEntities"))),
            "skipped": _int(agg.get("actualSkipped", r.get("SkippedEntities"))),
            "totalRowsRead": _int(agg.get("totalRowsRead", r.get("TotalRowsRead"))),
            "totalBytes": _int(agg.get("totalBytes", r.get("TotalBytesTransferred"))),
            "totalTaskLogs": _int(agg.get("totalTaskLogs")),
            "extractionMethod": extraction_method_by_run.get(r.get("RunId"), "unknown"),
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

    # Per-layer per-source breakdown
    layer_source = _safe_query(
        "SELECT etl.Layer, ds.Name AS source, "
        "  COUNT(DISTINCT CASE WHEN etl.Status = 'succeeded' THEN etl.EntityId END) AS succeeded, "
        "  COUNT(DISTINCT CASE WHEN etl.Status = 'failed' THEN etl.EntityId END) AS failed, "
        "  COUNT(DISTINCT CASE WHEN etl.Status = 'skipped' THEN etl.EntityId END) AS skipped, "
        "  SUM(CASE WHEN etl.Status = 'succeeded' THEN etl.RowsRead ELSE 0 END) AS rows_read, "
        "  SUM(CASE WHEN etl.Status = 'succeeded' THEN etl.RowsWritten ELSE 0 END) AS rows_written, "
        "  SUM(CASE WHEN etl.Status = 'succeeded' THEN etl.BytesTransferred ELSE 0 END) AS bytes, "
        "  ROUND(SUM(CASE WHEN etl.Status = 'succeeded' THEN etl.DurationSeconds ELSE 0 END), 2) AS duration "
        "FROM engine_task_log etl "
        "JOIN lz_entities le ON etl.EntityId = le.LandingzoneEntityId "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "WHERE etl.RunId = ? "
        "GROUP BY etl.Layer, ds.Name "
        "ORDER BY etl.Layer, ds.Name",
        (run_id,),
    )

    # Failed entities with error detail
    failures = _safe_query(
        "SELECT etl.EntityId, etl.Layer, etl.SourceTable, etl.ErrorType, "
        "  etl.ErrorMessage, etl.ErrorSuggestion, etl.DurationSeconds, "
        "  etl.LoadType, etl.ExtractionMethod, etl.created_at "
        "FROM engine_task_log etl "
        "WHERE etl.RunId = ? AND etl.Status = 'failed' "
        "ORDER BY etl.created_at DESC",
        (run_id,),
    )

    # Load type breakdown
    load_types = _safe_query(
        "SELECT LoadType, Layer, COUNT(*) AS cnt, "
        "  SUM(RowsRead) AS total_rows, "
        "  SUM(BytesTransferred) AS total_bytes "
        "FROM engine_task_log "
        "WHERE RunId = ? AND Status = 'succeeded' "
        "GROUP BY LoadType, Layer",
        (run_id,),
    )

    # Watermark changes in this run
    watermark_updates = _safe_query(
        "SELECT EntityId, SourceTable, WatermarkColumn, "
        "  WatermarkBefore, WatermarkAfter, Layer "
        "FROM engine_task_log "
        "WHERE RunId = ? AND WatermarkAfter IS NOT NULL AND WatermarkAfter != '' "
        "ORDER BY created_at DESC",
        (run_id,),
    )

    # Per-entity results with extraction method and completion time
    entity_results = _safe_query(
        "SELECT etl.EntityId, etl.Layer, etl.Status, etl.SourceTable, "
        "  etl.RowsRead, etl.RowsWritten, etl.BytesTransferred, "
        "  etl.DurationSeconds, etl.LoadType, "
        "  etl.ExtractionMethod, etl.created_at "
        "FROM engine_task_log etl "
        "WHERE etl.RunId = ? "
        "ORDER BY etl.created_at DESC",
        (run_id,),
    )
    entity_results_mapped = [{
        "entityId": r["EntityId"],
        "layer": r["Layer"],
        "status": r["Status"],
        "sourceTable": r["SourceTable"],
        "rowsRead": _int(r["RowsRead"]),
        "rowsWritten": _int(r["RowsWritten"]),
        "bytesTransferred": _int(r["BytesTransferred"]),
        "durationSeconds": float(r["DurationSeconds"] or 0),
        "loadType": r["LoadType"],
        "extractionMethod": r["ExtractionMethod"] or "unknown",
        "completedAt": r["created_at"],
    } for r in entity_results]

    # Extraction method breakdown for this run
    extraction_methods = _safe_query(
        "SELECT ExtractionMethod, COUNT(*) AS cnt, "
        "  SUM(RowsRead) AS total_rows "
        "FROM engine_task_log "
        "WHERE RunId = ? AND Status = 'succeeded' "
        "GROUP BY ExtractionMethod ORDER BY cnt DESC",
        (run_id,),
    )

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
        "extractionMethods": [{
            "method": r["ExtractionMethod"] or "unknown",
            "count": _int(r["cnt"]),
            "totalRows": _int(r["total_rows"]),
        } for r in extraction_methods],
        "selfHeal": self_heal,
        "loadTypes": load_types,
        "watermarkUpdates": watermark_updates,
        "timeline": timeline,
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

    # Build WHERE clauses
    wheres = ["etl.RunId = ?"]
    query_params: list = [run_id]

    source = params.get("source")
    if source:
        wheres.append("ds.Name = ?")
        query_params.append(source)

    layer = params.get("layer")
    if layer:
        wheres.append("LOWER(etl.Layer) = LOWER(?)")
        query_params.append(layer)

    status = params.get("status")
    if status:
        wheres.append("etl.Status = ?")
        query_params.append(status)

    search = params.get("search")
    if search:
        wheres.append("etl.SourceTable LIKE ?")
        query_params.append(f"%{search}%")

    where_clause = " AND ".join(wheres)

    # Sort
    allowed_sorts = {
        "created_at": "etl.created_at",
        "rows": "etl.RowsRead",
        "duration": "etl.DurationSeconds",
        "table": "etl.SourceTable",
        "bytes": "etl.BytesTransferred",
        "status": "etl.Status",
        "layer": "etl.Layer",
    }
    sort_col = allowed_sorts.get(params.get("sort", "created_at"), "etl.created_at")
    order = "ASC" if params.get("order", "desc").lower() == "asc" else "DESC"

    limit = min(_int(params.get("limit", 200)), 1000)
    offset = _int(params.get("offset", 0))

    # Count total matching
    count_sql = (
        "SELECT COUNT(*) AS cnt "
        "FROM engine_task_log etl "
        "JOIN lz_entities le ON etl.EntityId = le.LandingzoneEntityId "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        f"WHERE {where_clause}"
    )
    total = _safe_scalar(count_sql, tuple(query_params))

    # Fetch entities with physical verification from lakehouse_row_counts
    query_params_with_limit = query_params + [str(limit), str(offset)]
    entities = _safe_query(
        "SELECT etl.id, etl.EntityId, etl.Layer, etl.Status, "
        "  etl.SourceServer, etl.SourceDatabase, etl.SourceTable, "
        "  etl.RowsRead, etl.RowsWritten, etl.BytesTransferred, "
        "  etl.DurationSeconds, etl.LoadType, "
        "  etl.WatermarkColumn, etl.WatermarkBefore, etl.WatermarkAfter, "
        "  etl.ErrorType, etl.ErrorMessage, etl.ErrorSuggestion, "
        "  etl.SourceQuery, etl.created_at, "
        "  ds.Name AS source, "
        "  lrc_lz.row_count AS lz_physical_rows, "
        "  lrc_lz.scanned_at AS lz_scanned_at, "
        "  lrc_br.row_count AS brz_physical_rows, "
        "  lrc_br.scanned_at AS brz_scanned_at, "
        "  lrc_sv.row_count AS slv_physical_rows, "
        "  lrc_sv.scanned_at AS slv_scanned_at "
        "FROM engine_task_log etl "
        "JOIN lz_entities le ON etl.EntityId = le.LandingzoneEntityId "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "LEFT JOIN lakehouse_row_counts lrc_lz "
        "  ON LOWER(lrc_lz.schema_name) = LOWER(le.FilePath) "
        "  AND LOWER(lrc_lz.table_name) = LOWER(le.SourceName) "
        "  AND lrc_lz.lakehouse = 'LH_DATA_LANDINGZONE' "
        "LEFT JOIN lakehouse_row_counts lrc_br "
        "  ON LOWER(lrc_br.schema_name) = LOWER(le.FilePath) "
        "  AND LOWER(lrc_br.table_name) = LOWER(le.SourceName) "
        "  AND lrc_br.lakehouse = 'LH_BRONZE_LAYER' "
        "LEFT JOIN lakehouse_row_counts lrc_sv "
        "  ON LOWER(lrc_sv.schema_name) = LOWER(le.FilePath) "
        "  AND LOWER(lrc_sv.table_name) = LOWER(le.SourceName) "
        "  AND lrc_sv.lakehouse = 'LH_SILVER_LAYER' "
        f"WHERE {where_clause} "
        f"ORDER BY {sort_col} {order} "
        "LIMIT ? OFFSET ?",
        tuple(query_params_with_limit),
    )

    return {
        "entities": entities,
        "total": _int(total),
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

    # All task_log entries for this entity (across all runs)
    limit = min(_int(params.get("limit", 50)), 200)
    history = _safe_query(
        "SELECT etl.id, etl.RunId, etl.Layer, etl.Status, "
        "  etl.SourceTable, etl.RowsRead, etl.RowsWritten, "
        "  etl.BytesTransferred, etl.DurationSeconds, etl.LoadType, "
        "  etl.WatermarkColumn, etl.WatermarkBefore, etl.WatermarkAfter, "
        "  etl.ErrorType, etl.ErrorMessage, etl.ErrorSuggestion, "
        "  etl.SourceQuery, etl.created_at, "
        "  er.Status AS runStatus, er.StartedAt AS runStartedAt "
        "FROM engine_task_log etl "
        "LEFT JOIN engine_runs er ON etl.RunId = er.RunId "
        "WHERE etl.EntityId = ? "
        "ORDER BY etl.created_at DESC LIMIT ?",
        (str(eid), str(limit)),
    )

    # Retry detection: runs where this entity has >1 entry per layer
    retries = _safe_query(
        "SELECT RunId, Layer, COUNT(*) AS attempts "
        "FROM engine_task_log "
        "WHERE EntityId = ? "
        "GROUP BY RunId, Layer HAVING COUNT(*) > 1",
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
