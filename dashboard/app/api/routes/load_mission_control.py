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

log = logging.getLogger("fmd.routes.lmc")


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
        f"SELECT le.EntityId "
        f"FROM lz_entities le "
        f"JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        f"WHERE le.IsActive = 1 AND ds.Name IN ({placeholders})",
        tuple(source_names),
    )
    ids = [_int(r["EntityId"]) for r in rows]
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

    # Per-source progress for this run
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

    # Physical verification — cross-reference lakehouse_row_counts
    # Join key: lrc.schema_name = le.FilePath AND lrc.table_name = le.SourceName
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
        "WHERE le.IsActive = 1"
    )

    # Actual lakehouse state — what's PHYSICALLY in each layer RIGHT NOW
    # This is independent of any engine run — it's the ground truth from scans
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

    # Per-source physical counts from lakehouse_row_counts
    lh_by_source = _safe_query(
        "SELECT lrc.lakehouse, ds.Name AS source, "
        "  COUNT(CASE WHEN lrc.row_count > 0 THEN 1 END) AS tables_loaded, "
        "  SUM(CASE WHEN lrc.row_count > 0 THEN lrc.row_count ELSE 0 END) AS total_rows "
        "FROM lz_entities le "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "JOIN lakehouse_row_counts lrc "
        "  ON LOWER(lrc.schema_name) = LOWER(le.FilePath) "
        "  AND LOWER(lrc.table_name) = LOWER(le.SourceName) "
        "WHERE le.IsActive = 1 "
        "GROUP BY lrc.lakehouse, ds.Name "
        "ORDER BY lrc.lakehouse, ds.Name"
    )

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
        },
        "totalActiveEntities": _int(total_active),
        "layers": layers,
        "bySource": by_source,
        "errorBreakdown": error_breakdown,
        "loadTypeBreakdown": load_type_breakdown,
        "throughput": throughput[0] if throughput else {"rows_per_sec": 0, "bytes_per_sec": 0},
        "verification": verification[0] if verification else {
            "total_active": 0, "lz_verified": 0, "brz_verified": 0,
            "slv_verified": 0, "lz_last_scan": None, "brz_last_scan": None,
        },
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
        "  (SELECT COUNT(DISTINCT EntityId) FROM engine_task_log etl "
        "    WHERE etl.RunId = er.RunId AND etl.Status = 'succeeded') AS actualSucceeded, "
        "  (SELECT COUNT(DISTINCT EntityId) FROM engine_task_log etl "
        "    WHERE etl.RunId = er.RunId AND etl.Status = 'failed') AS actualFailed, "
        "  (SELECT COUNT(DISTINCT EntityId) FROM engine_task_log etl "
        "    WHERE etl.RunId = er.RunId AND etl.Status = 'skipped') AS actualSkipped, "
        "  (SELECT SUM(RowsRead) FROM engine_task_log etl "
        "    WHERE etl.RunId = er.RunId AND etl.Status = 'succeeded') AS totalRowsRead, "
        "  (SELECT SUM(BytesTransferred) FROM engine_task_log etl "
        "    WHERE etl.RunId = er.RunId AND etl.Status = 'succeeded') AS totalBytes, "
        "  (SELECT COUNT(*) FROM engine_task_log etl WHERE etl.RunId = er.RunId) AS totalTaskLogs, "
        "  (SELECT ExtractionMethod FROM engine_task_log "
        "    WHERE RunId = er.RunId AND ExtractionMethod != 'unknown' "
        "    GROUP BY ExtractionMethod ORDER BY COUNT(*) DESC LIMIT 1"
        "  ) AS extraction_method "
        "FROM engine_runs er "
        "ORDER BY er.StartedAt DESC LIMIT ?",
        (str(limit),),
    )

    return {
        "runs": [{
            **r,
            "extractionMethod": r.get("extraction_method") or "unknown",
        } for r in runs],
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
        "loadTypes": load_types,
        "watermarkUpdates": watermark_updates,
        "timeline": timeline,
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
        raise HttpError("run_id is required", 400)

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
        raise HttpError(f"Entity {eid} not found", 404)

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
