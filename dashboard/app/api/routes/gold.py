"""Gold MLV Manager API — endpoints for the Gold layer MLV management page.

Endpoints:
    GET /api/gold/mlvs          — list Gold specs (MLVs, views, tables) with filters
    GET /api/gold/mlvs/summary  — aggregate summary counts
    GET /api/gold/mlvs/{id}     — detail for a single Gold spec

Data source: SQLite gs_gold_specs + gs_canonical_entities in control plane DB.
"""

import logging

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.gold")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _paginate(params: dict) -> tuple[int, int]:
    """Extract limit/offset with sane defaults."""
    try:
        limit = min(int(params.get("limit") or 100), 500)
    except (TypeError, ValueError):
        limit = 100
    try:
        offset = max(int(params.get("offset") or 0), 0)
    except (TypeError, ValueError):
        offset = 0
    return limit, offset


def _row_to_dict(row):
    return dict(row) if row else None


def _rows_to_list(rows):
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# GET /api/gold/mlvs/summary — must be registered BEFORE /api/gold/mlvs/{id}
# ---------------------------------------------------------------------------

@route("GET", "/api/gold/mlvs/summary")
def gold_mlvs_summary(params: dict) -> dict:
    """Aggregate summary: totals by object_type, domain, and status."""
    conn = cpdb._get_conn()
    try:
        # Total current, non-deleted specs
        total = conn.execute(
            "SELECT COUNT(*) AS cnt FROM gs_gold_specs "
            "WHERE is_current = 1 AND deleted_at IS NULL"
        ).fetchone()["cnt"]

        # By object_type
        by_type_rows = conn.execute(
            "SELECT COALESCE(object_type, 'mlv') AS object_type, COUNT(*) AS cnt "
            "FROM gs_gold_specs "
            "WHERE is_current = 1 AND deleted_at IS NULL "
            "GROUP BY COALESCE(object_type, 'mlv') "
            "ORDER BY object_type"
        ).fetchall()
        by_type = {r["object_type"]: r["cnt"] for r in by_type_rows}

        # By status
        by_status_rows = conn.execute(
            "SELECT COALESCE(status, 'draft') AS status, COUNT(*) AS cnt "
            "FROM gs_gold_specs "
            "WHERE is_current = 1 AND deleted_at IS NULL "
            "GROUP BY COALESCE(status, 'draft') "
            "ORDER BY status"
        ).fetchall()
        by_status = {r["status"]: r["cnt"] for r in by_status_rows}

        # By domain (via canonical entity join)
        by_domain_rows = conn.execute(
            "SELECT COALESCE(ce.domain, 'Unassigned') AS domain, "
            "       COUNT(*) AS cnt, "
            "       SUM(CASE WHEN ce.entity_type = 'fact' THEN 1 ELSE 0 END) AS facts, "
            "       SUM(CASE WHEN ce.entity_type = 'dimension' THEN 1 ELSE 0 END) AS dimensions "
            "FROM gs_gold_specs gs "
            "LEFT JOIN gs_canonical_entities ce "
            "    ON ce.root_id = gs.canonical_root_id AND ce.is_current = 1 "
            "WHERE gs.is_current = 1 AND gs.deleted_at IS NULL "
            "GROUP BY COALESCE(ce.domain, 'Unassigned') "
            "ORDER BY domain COLLATE NOCASE"
        ).fetchall()
        by_domain = [
            {
                "domain": r["domain"],
                "count": r["cnt"],
                "facts": r["facts"],
                "dimensions": r["dimensions"],
            }
            for r in by_domain_rows
        ]

        return {
            "total": total,
            "by_type": by_type,
            "by_status": by_status,
            "by_domain": by_domain,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GET /api/gold/mlvs — paginated list with domain/status/type filters
# ---------------------------------------------------------------------------

@route("GET", "/api/gold/mlvs")
def gold_mlvs_list(params: dict) -> dict:
    """List Gold specs with optional filters and pagination.

    Query params:
        domain   — filter by canonical entity domain
        status   — filter by spec status (draft, validated, approved, published, etc.)
        type     — filter by object_type (mlv, view, table)
        q        — text search across target_name and canonical_name
        limit    — page size (default 100, max 500)
        offset   — pagination offset
    """
    limit, offset = _paginate(params)

    where = ["gs.is_current = 1", "gs.deleted_at IS NULL"]
    bind: list = []

    domain = (params.get("domain") or "").strip()
    if domain:
        where.append("ce.domain = ?")
        bind.append(domain)

    status = (params.get("status") or "").strip()
    if status:
        where.append("gs.status = ?")
        bind.append(status)

    obj_type = (params.get("type") or "").strip()
    if obj_type:
        where.append("gs.object_type = ?")
        bind.append(obj_type)

    q = (params.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        where.append("(gs.target_name LIKE ? OR ce.name LIKE ?)")
        bind.extend([like, like])

    where_sql = "WHERE " + " AND ".join(where)

    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"""SELECT COUNT(*) AS cnt
                FROM gs_gold_specs gs
                LEFT JOIN gs_canonical_entities ce
                    ON ce.root_id = gs.canonical_root_id AND ce.is_current = 1
                {where_sql}""",
            bind,
        ).fetchone()["cnt"]

        rows = conn.execute(
            f"""SELECT gs.id, gs.root_id, gs.target_name,
                       SUBSTR(gs.source_sql, 1, 200) AS source_sql_preview,
                       gs.source_sql,
                       gs.status, gs.object_type, gs.version,
                       ce.name AS canonical_name, ce.domain,
                       ce.entity_type, ce.grain,
                       gs.created_at, gs.updated_at
                FROM gs_gold_specs gs
                LEFT JOIN gs_canonical_entities ce
                    ON ce.root_id = gs.canonical_root_id AND ce.is_current = 1
                {where_sql}
                ORDER BY gs.target_name COLLATE NOCASE
                LIMIT ? OFFSET ?""",
            bind + [limit, offset],
        ).fetchall()

        return {
            "items": _rows_to_list(rows),
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GET /api/gold/mlvs/{id} — single spec detail
# ---------------------------------------------------------------------------

@route("GET", "/api/gold/mlvs/{id}")
def gold_mlvs_detail(params: dict) -> dict:
    """Return full detail for a single Gold spec, including validation runs."""
    try:
        spec_id = int(params.get("id", ""))
    except (TypeError, ValueError):
        raise HttpError("id must be an integer", 400)

    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            """SELECT gs.*, ce.name AS canonical_name, ce.domain,
                      ce.entity_type, ce.grain
               FROM gs_gold_specs gs
               LEFT JOIN gs_canonical_entities ce
                   ON ce.root_id = gs.canonical_root_id AND ce.is_current = 1
               WHERE gs.id = ? AND gs.deleted_at IS NULL""",
            (spec_id,),
        ).fetchone()

        if not row:
            raise HttpError("Gold spec not found", 404)

        spec = _row_to_dict(row)

        # Attach recent validation runs if available
        try:
            spec["validation_runs"] = _rows_to_list(
                conn.execute(
                    """SELECT * FROM gs_validation_runs
                       WHERE spec_root_id = ?
                       ORDER BY started_at DESC LIMIT 5""",
                    (row["root_id"],),
                ).fetchall()
            )
        except Exception:
            spec["validation_runs"] = []

        return spec
    finally:
        conn.close()
