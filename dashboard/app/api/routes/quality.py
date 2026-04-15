"""Quality API routes — entity quality scores, tier breakdowns, and recomputation.

Endpoints:
    GET  /api/quality/scores             — paginated quality scores with optional tier filter
    GET  /api/mdm/quality/scores         — alias (used by Business Portal pages)
    GET  /api/quality/score/{entityId}   — single entity quality breakdown
    POST /api/quality/refresh            — trigger full recomputation

Data source: SQLite quality_scores table (populated by quality_engine.py)
"""
import logging

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.quality")


# ---------------------------------------------------------------------------
# GET /api/quality/scores  +  /api/mdm/quality/scores (alias)
# ---------------------------------------------------------------------------

@route("GET", "/api/quality/scores")
@route("GET", "/api/mdm/quality/scores")
def get_quality_scores(params: dict) -> dict:
    """Return paginated quality scores with an optional tier filter.

    Query params:
        tier    — filter by quality_tier (gold|silver|bronze|unclassified)
        limit   — page size (default 50, max 500)
        offset  — pagination offset (default 0)

    Response:
        {
          items: [{entityId, entityName, source, completeness, freshness,
                   consistency, volume, composite, tier, computedAt}],
          total,
          limit,
          offset,
          summary: { ... }  -- aggregated stats from get_quality_summary()
        }
    """
    from dashboard.app.api.services.quality_engine import get_quality_summary

    tier_filter = (params.get("tier") or "").strip().lower()

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
        where_parts: list[str] = []
        bind: list = []

        if tier_filter:
            where_parts.append("qs.quality_tier = ?")
            bind.append(tier_filter)

        where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

        total_row = conn.execute(
            f"""
            SELECT COUNT(*) AS cnt
            FROM quality_scores qs
            JOIN lz_entities e  ON qs.entity_id = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            {where_sql}
            """,
            bind,
        ).fetchone()
        total = int(total_row["cnt"]) if total_row else 0

        rows = conn.execute(
            f"""
            SELECT
                qs.entity_id,
                e.SourceName       AS entity_name,
                ds.Namespace       AS source,
                qs.completeness_score,
                qs.freshness_score,
                qs.consistency_score,
                qs.volume_score,
                qs.composite_score,
                qs.quality_tier,
                qs.computed_at
            FROM quality_scores qs
            JOIN lz_entities e  ON qs.entity_id = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            {where_sql}
            ORDER BY qs.composite_score DESC, e.SourceName COLLATE NOCASE
            LIMIT ? OFFSET ?
            """,
            bind + [limit, offset],
        ).fetchall()

    finally:
        conn.close()

    items = [
        {
            "entityId":    int(r["entity_id"]),
            "entityName":  r["entity_name"] or "",
            "source":      r["source"] or "",
            "completeness": round(float(r["completeness_score"] or 0), 2),
            "freshness":    round(float(r["freshness_score"] or 0), 2),
            "consistency":  round(float(r["consistency_score"] or 0), 2),
            "volume":       round(float(r["volume_score"] or 0), 2),
            "composite":    round(float(r["composite_score"] or 0), 2),
            "tier":         r["quality_tier"] or "unclassified",
            "computedAt":   r["computed_at"] or "",
        }
        for r in rows
    ]

    summary = get_quality_summary()

    return {
        "items":   items,
        "total":   total,
        "limit":   limit,
        "offset":  offset,
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# GET /api/quality/score/{entityId}
# ---------------------------------------------------------------------------

@route("GET", "/api/quality/score/{entityId}")
def get_quality_score(params: dict) -> dict:
    """Return quality score breakdown for a single entity.

    Path params:
        entityId — LandingzoneEntityId (integer)

    Response:
        {
          entityId, scored: true|false,
          completeness, freshness, consistency, volume, composite, tier, computedAt
        }
        (all score fields are 0.0 / "unclassified" when scored=false)
    """
    try:
        entity_id = int(params.get("entityId", ""))
    except (TypeError, ValueError):
        raise HttpError("entityId must be an integer", 400)

    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            """
            SELECT completeness_score, freshness_score, consistency_score,
                   volume_score, composite_score, quality_tier, computed_at
            FROM quality_scores
            WHERE entity_id = ?
            """,
            (entity_id,),
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        return {
            "entityId":    entity_id,
            "scored":      False,
            "completeness": 0.0,
            "freshness":    0.0,
            "consistency":  0.0,
            "volume":       0.0,
            "composite":    0.0,
            "tier":         "unclassified",
            "computedAt":   None,
        }

    return {
        "entityId":    entity_id,
        "scored":      True,
        "completeness": round(float(row["completeness_score"] or 0), 2),
        "freshness":    round(float(row["freshness_score"] or 0), 2),
        "consistency":  round(float(row["consistency_score"] or 0), 2),
        "volume":       round(float(row["volume_score"] or 0), 2),
        "composite":    round(float(row["composite_score"] or 0), 2),
        "tier":         row["quality_tier"] or "unclassified",
        "computedAt":   row["computed_at"] or None,
    }


# ---------------------------------------------------------------------------
# POST /api/quality/refresh
# ---------------------------------------------------------------------------

@route("POST", "/api/quality/refresh")
def refresh_quality_scores(params: dict) -> dict:
    """Trigger a full recomputation of quality scores for all active entities.

    Response:
        { status: "refreshed", scored: N, tiers: {gold, silver, bronze, unclassified} }
    """
    from dashboard.app.api.services.quality_engine import compute_quality_scores

    log.info("Quality score refresh requested")
    result = compute_quality_scores()

    return {
        "status": "refreshed",
        "scored": result.get("scored", 0),
        "tiers":  result.get("tiers", {}),
    }


# ---------------------------------------------------------------------------
# GET /api/labs/dq-trends
# ---------------------------------------------------------------------------

@route("GET", "/api/labs/dq-trends")
def get_dq_trends(params: dict) -> dict:
    """Return 7-day DQ trend points and persist the current snapshot."""
    from datetime import datetime

    from dashboard.app.api import metrics_store

    try:
        hours = max(1, min(int(params.get("hours") or 168), 24 * 30))
    except (TypeError, ValueError):
        hours = 168

    metrics_store.init_db()

    conn = cpdb._get_conn()
    try:
        entity_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM lz_entities WHERE IsActive = 1"
        ).fetchone()
        entity_count = int(entity_row["cnt"]) if entity_row else 0

        latest_rows = conn.execute(
            """
            WITH latest AS (
                SELECT
                    EntityId,
                    RowsWritten,
                    ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY id DESC) AS rn
                FROM engine_task_log
            )
            SELECT
                SUM(CASE WHEN COALESCE(RowsWritten, 0) > 0 THEN 1 ELSE 0 END) AS with_data,
                SUM(CASE WHEN COALESCE(RowsWritten, 0) <= 0 THEN 1 ELSE 0 END) AS empty_count,
                SUM(CASE WHEN COALESCE(RowsWritten, 0) > 0 THEN RowsWritten ELSE 0 END) AS total_rows
            FROM latest
            WHERE rn = 1
            """
        ).fetchone()

        with_data = int(latest_rows["with_data"]) if latest_rows and latest_rows["with_data"] is not None else 0
        empty = (
            int(latest_rows["empty_count"])
            if latest_rows and latest_rows["empty_count"] is not None
            else max(entity_count - with_data, 0)
        )
        total_rows = int(latest_rows["total_rows"]) if latest_rows and latest_rows["total_rows"] is not None else 0
    finally:
        conn.close()

    coverage = round((with_data / entity_count * 100) if entity_count > 0 else 0, 1)
    metrics_store.record_dq_snapshot(
        entity_count=entity_count,
        with_data=with_data,
        empty=empty,
        total_rows=total_rows,
        coverage=coverage,
    )

    snapshots = metrics_store.get_dq_snapshots(hours=hours)
    points = []
    for snap in snapshots:
        captured = snap.get("captured_at") or ""
        try:
            dt = datetime.fromisoformat(str(captured).replace("Z", "+00:00"))
            label = dt.strftime("%m/%d")
        except ValueError:
            label = str(captured)
        points.append(
            {
                "time": label,
                "coverage": round(float(snap.get("coverage") or 0), 1),
                "entityCount": int(snap.get("entity_count") or 0),
                "withData": int(snap.get("with_data") or 0),
                "totalRows": int(snap.get("total_rows") or 0),
            }
        )

    return {"points": points}
