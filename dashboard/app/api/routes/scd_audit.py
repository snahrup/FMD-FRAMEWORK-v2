"""SCD Audit API routes — Silver layer SCD2 merge statistics and entity history.

Endpoints:
    GET  /api/scd/summary            — aggregate Silver stats per entity (latest run)
    GET  /api/scd/entity/{entityId}  — all Silver runs for one entity
    GET  /api/scd/runs               — Silver task log entries, optional run_id filter

Data source: SQLite engine_task_log table (Silver layer entries)
"""
import logging

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.scd_audit")


_SILVER_LATEST_IDS_SQL = """
    SELECT MAX(id) AS max_id
    FROM mapped
    WHERE Layer = 'silver'
      AND LandingzoneEntityId IS NOT NULL
    GROUP BY LandingzoneEntityId
"""


# ---------------------------------------------------------------------------
# GET /api/scd/summary
# ---------------------------------------------------------------------------

@route("GET", "/api/scd/summary")
def get_scd_summary(params: dict) -> dict:
    """Return latest Silver layer run stats per entity with source info.

    Query params:
        source  — filter by source system namespace (optional)
        limit   — page size (default 100, max 500)
        offset  — pagination offset (default 0)

    Response:
        {
          items: [{entityId, entityName, source, rowsRead, rowsWritten,
                   delta, status, loadType, durationSeconds, lastRun}],
          total, limit, offset,
          kpis: {totalEntities, lastRunTimestamp, totalRowsWritten, successRate}
        }
    """
    source_filter = (params.get("source") or "").strip()

    try:
        limit = min(int(params.get("limit") or 100), 500)
    except (TypeError, ValueError):
        limit = 100

    try:
        offset = max(int(params.get("offset") or 0), 0)
    except (TypeError, ValueError):
        offset = 0

    conn = cpdb._get_conn()
    try:
        where_parts: list[str] = []
        bind: list = []

        if source_filter:
            where_parts.append(
                "(LOWER(ds.Namespace) = LOWER(?) OR LOWER(ds.Name) = LOWER(?) OR LOWER(COALESCE(ds.DisplayName, '')) = LOWER(?))"
            )
            bind.extend([source_filter, source_filter, source_filter])

        where_sql = ("AND " + " AND ".join(where_parts)) if where_parts else ""

        # Total count
        total_row = conn.execute(
            f"""
            {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
            SELECT COUNT(*) AS cnt
            FROM mapped etl
            JOIN lz_entities e ON etl.LandingzoneEntityId = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE etl.id IN ({_SILVER_LATEST_IDS_SQL})
            {where_sql}
            """,
            bind,
        ).fetchone()
        total = int(total_row["cnt"]) if total_row else 0

        # Paginated items
        rows = conn.execute(
            f"""
            {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
            SELECT etl.LandingzoneEntityId AS EntityId,
                   e.SourceName       AS entity_name,
                   ds.Namespace       AS source,
                   etl.RowsRead,
                   etl.RowsWritten,
                   etl.Status,
                   etl.LoadType,
                   etl.DurationSeconds,
                   etl.LoadEndDateTime AS created_at
            FROM mapped etl
            JOIN lz_entities e ON etl.LandingzoneEntityId = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE etl.id IN ({_SILVER_LATEST_IDS_SQL})
            {where_sql}
            ORDER BY etl.LoadEndDateTime DESC, etl.id DESC
            LIMIT ? OFFSET ?
            """,
            bind + [limit, offset],
        ).fetchall()

        # KPIs: computed from ALL latest runs (not just current page)
        kpi_row = conn.execute(
            f"""
            {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
            SELECT COUNT(*)                     AS total_entities,
                   MAX(etl.LoadEndDateTime)      AS last_run_ts,
                   SUM(COALESCE(etl.RowsWritten, 0)) AS total_rows_written,
                   SUM(CASE WHEN etl.Status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded_count
            FROM mapped etl
            JOIN lz_entities e ON etl.LandingzoneEntityId = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE etl.id IN ({_SILVER_LATEST_IDS_SQL})
            {where_sql}
            """,
            bind,
        ).fetchone()

        # Source list for filter dropdown
        sources = conn.execute(
            f"""
            {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
            SELECT DISTINCT ds.Namespace AS source
            FROM mapped etl
            JOIN lz_entities e ON etl.LandingzoneEntityId = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE etl.Layer = 'silver'
            ORDER BY ds.Namespace
            """,
        ).fetchall()

    finally:
        conn.close()

    total_entities = int(kpi_row["total_entities"]) if kpi_row else 0
    succeeded = int(kpi_row["succeeded_count"]) if kpi_row else 0

    items = []
    for r in rows:
        reads = int(r["RowsRead"] or 0)
        written = int(r["RowsWritten"] or 0)
        items.append({
            "entityId":        int(r["EntityId"]),
            "entityName":      r["entity_name"] or "",
            "source":          cpdb._normalize_display_namespace(r["source"]) or "",
            "rowsRead":        reads,
            "rowsWritten":     written,
            "delta":           written - reads,
            "status":          r["Status"] or "unknown",
            "loadType":        r["LoadType"] or "",
            "durationSeconds": round(float(r["DurationSeconds"] or 0), 2),
            "lastRun":         r["created_at"] or "",
        })

    return {
        "items":   items,
        "total":   total,
        "limit":   limit,
        "offset":  offset,
        "sources": [cpdb._normalize_display_namespace(s["source"]) or s["source"] for s in sources],
        "kpis": {
            "totalEntities":    total_entities,
            "lastRunTimestamp":  kpi_row["last_run_ts"] if kpi_row else None,
            "totalRowsWritten": int(kpi_row["total_rows_written"]) if kpi_row else 0,
            "successRate":      round(succeeded / total_entities * 100, 1) if total_entities > 0 else 0,
        },
    }


# ---------------------------------------------------------------------------
# GET /api/scd/entity/{entityId}
# ---------------------------------------------------------------------------

@route("GET", "/api/scd/entity/{entityId}")
def get_scd_entity_history(params: dict) -> dict:
    """Return all Silver layer runs for a single entity.

    Path params:
        entityId — LandingzoneEntityId (integer)

    Query params:
        limit — max runs to return (default 20, max 100)

    Response:
        {
          entityId, entityName, source,
          runs: [{runId, rowsRead, rowsWritten, delta, loadType, status,
                  durationSeconds, timestamp}]
        }
    """
    try:
        entity_id = int(params.get("entityId", ""))
    except (TypeError, ValueError):
        raise HttpError("entityId must be an integer", 400)

    try:
        limit = min(int(params.get("limit") or 20), 100)
    except (TypeError, ValueError):
        limit = 20

    conn = cpdb._get_conn()
    try:
        # Entity metadata
        meta = conn.execute(
            """
            SELECT e.SourceName, ds.Namespace AS source
            FROM lz_entities e
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE e.LandingzoneEntityId = ?
            """,
            (entity_id,),
        ).fetchone()

        # Run history
        rows = conn.execute(
            f"""
            {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
            SELECT RunId, RowsRead, RowsWritten, LoadType, Status,
                   DurationSeconds, LoadEndDateTime AS created_at
            FROM mapped
            WHERE LandingzoneEntityId = ? AND Layer = 'silver'
            ORDER BY LoadEndDateTime DESC, id DESC
            LIMIT ?
            """,
            (entity_id, limit),
        ).fetchall()

    finally:
        conn.close()

    runs = []
    for r in rows:
        reads = int(r["RowsRead"] or 0)
        written = int(r["RowsWritten"] or 0)
        runs.append({
            "runId":           r["RunId"] or "",
            "rowsRead":        reads,
            "rowsWritten":     written,
            "delta":           written - reads,
            "loadType":        r["LoadType"] or "",
            "status":          r["Status"] or "unknown",
            "durationSeconds": round(float(r["DurationSeconds"] or 0), 2),
            "timestamp":       r["created_at"] or "",
        })

    return {
        "entityId":   entity_id,
        "entityName": meta["SourceName"] if meta else "",
        "source":     (cpdb._normalize_display_namespace(meta["source"]) if meta else "") or "",
        "runs":       runs,
    }


# ---------------------------------------------------------------------------
# GET /api/scd/runs
# ---------------------------------------------------------------------------

@route("GET", "/api/scd/runs")
def get_scd_runs(params: dict) -> dict:
    """Return Silver layer task log entries, optionally filtered by run_id.

    Query params:
        run_id — filter to a specific RunId (optional)
        limit  — page size (default 50, max 500)
        offset — pagination offset (default 0)

    Response:
        {
          items: [{entityId, entityName, source, runId, rowsRead, rowsWritten,
                   delta, loadType, status, durationSeconds, timestamp}],
          total, limit, offset
        }
    """
    run_id = (params.get("run_id") or "").strip()

    try:
        limit = min(int(params.get("limit") or 50), 500)
    except (TypeError, ValueError):
        limit = 50

    try:
        offset = max(int(params.get("offset") or 0), 0)
    except (TypeError, ValueError):
        offset = 0

    conn = cpdb._get_conn()
    try:
        where_parts = ["etl.Layer = 'silver'"]
        bind: list = []

        if run_id:
            where_parts.append("etl.RunId = ?")
            bind.append(run_id)

        where_sql = "WHERE " + " AND ".join(where_parts)

        total_row = conn.execute(
            f"""
            {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
            SELECT COUNT(*) AS cnt
            FROM mapped etl
            {where_sql}
            """,
            bind,
        ).fetchone()
        total = int(total_row["cnt"]) if total_row else 0

        rows = conn.execute(
            f"""
            {cpdb._MAPPED_ENGINE_TASK_LOG_CTE}
            SELECT etl.LandingzoneEntityId AS EntityId,
                   e.SourceName       AS entity_name,
                   ds.Namespace       AS source,
                   etl.RunId,
                   etl.RowsRead,
                   etl.RowsWritten,
                   etl.LoadType,
                   etl.Status,
                   etl.DurationSeconds,
                   etl.LoadEndDateTime AS created_at
            FROM mapped etl
            JOIN lz_entities e ON etl.LandingzoneEntityId = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            {where_sql}
            ORDER BY etl.LoadEndDateTime DESC, etl.id DESC
            LIMIT ? OFFSET ?
            """,
            bind + [limit, offset],
        ).fetchall()

    finally:
        conn.close()

    items = []
    for r in rows:
        reads = int(r["RowsRead"] or 0)
        written = int(r["RowsWritten"] or 0)
        items.append({
            "entityId":        int(r["EntityId"]),
            "entityName":      r["entity_name"] or "",
            "source":          cpdb._normalize_display_namespace(r["source"]) or "",
            "runId":           r["RunId"] or "",
            "rowsRead":        reads,
            "rowsWritten":     written,
            "delta":           written - reads,
            "loadType":        r["LoadType"] or "",
            "status":          r["Status"] or "unknown",
            "durationSeconds": round(float(r["DurationSeconds"] or 0), 2),
            "timestamp":       r["created_at"] or "",
        })

    return {
        "items":  items,
        "total":  total,
        "limit":  limit,
        "offset": offset,
    }
