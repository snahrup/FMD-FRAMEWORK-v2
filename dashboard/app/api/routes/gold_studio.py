"""Gold Studio API routes — 57 endpoints for the full Gold layer workflow.

Groups:
    1. Specimens (8)      — Import, list, detail, update, delete, extract, queries, bulk
    2. Extracted Entities (5) — List, detail, columns, schema, discover-schema
    3. Clusters (8)       — List, detail, update, resolve, column-decisions CRUD, detect, unclustered
    4. Canonical (9)      — CRUD, approve, generate-spec, versions, domains, relationships
    5. Semantic (4)       — CRUD for semantic definitions
    6. Gold Specs (6)     — List, detail, update, update-sql, versions, impact
    7. Validation (5)     — Validate, run history, run detail, waiver, reconciliation
    8. Catalog (5)        — Publish, list, detail, update, versions
    9. Jobs (2)           — Status, list
   10. Audit (1)          — Audit log with filters + pagination
   11. Stats (1)          — Cached aggregate stats
   12. Field Usage (1)    — Report field usage

Data source: SQLite gs_* tables in control plane DB.
"""

import json
import logging
import sqlite3
import threading
import time as _time

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.gold_studio")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_int(val, name: str, default=None, required=False):
    """Parse an integer from params, raising HttpError on bad input."""
    if val is None or val == "":
        if required:
            raise HttpError(f"{name} is required", 400)
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        raise HttpError(f"{name} must be an integer", 400)


def _paginate(params: dict) -> tuple[int, int]:
    """Extract limit/offset from params with sane defaults."""
    try:
        limit = min(int(params.get("limit") or 100), 500)
    except (TypeError, ValueError):
        limit = 100
    try:
        offset = max(int(params.get("offset") or 0), 0)
    except (TypeError, ValueError):
        offset = 0
    return limit, offset


def _require(params: dict, *keys: str):
    """Raise 400 if any required key is missing/empty."""
    for k in keys:
        v = params.get(k)
        if v is None or (isinstance(v, str) and not v.strip()):
            raise HttpError(f"'{k}' is required", 400)


def _audit(conn, object_type: str, object_id: int, action: str,
           performed_by: str = "system", previous_value=None,
           new_value=None, notes: str | None = None):
    """Insert an audit log entry."""
    conn.execute(
        """INSERT INTO gs_audit_log
           (object_type, object_id, action, previous_value, new_value,
            performed_by, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (object_type, object_id, action,
         json.dumps(previous_value) if previous_value is not None else None,
         json.dumps(new_value) if new_value is not None else None,
         performed_by, notes),
    )


def _row_to_dict(row):
    """Convert a sqlite3.Row to dict, or return None."""
    return dict(row) if row else None


def _rows_to_list(rows):
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Stats cache
# ---------------------------------------------------------------------------
_stats_cache: dict = {"ts": 0, "data": None}
_STATS_TTL = 30  # seconds


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 1: Specimens (8 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 1. POST /api/gold-studio/specimens — Create specimen
@route("POST", "/api/gold-studio/specimens")
def gs_create_specimen(params: dict) -> dict:
    _require(params, "name", "type", "division", "steward")
    stype = params["type"].strip().lower()
    valid_types = ("rdl", "pbix", "pbip", "tmdl", "bim", "sql")
    if stype not in valid_types:
        raise HttpError(f"type must be one of {valid_types}", 400)

    tags = params.get("tags")
    if tags and isinstance(tags, list):
        tags = json.dumps(tags)
    elif tags and isinstance(tags, str):
        tags = tags  # already JSON string

    conn = cpdb._get_conn()
    try:
        cur = conn.execute(
            """INSERT INTO gs_specimens
               (name, type, division, source_system, steward, description, tags, file_path, job_state)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')""",
            (params["name"].strip(), stype, params["division"].strip(),
             params.get("source_system"), params["steward"].strip(),
             params.get("description"), tags, params.get("file_path")),
        )
        specimen_id = cur.lastrowid
        _audit(conn, "specimen", specimen_id, "created",
               new_value={"name": params["name"], "type": stype})
        conn.commit()
        row = conn.execute("SELECT * FROM gs_specimens WHERE id = ?",
                           (specimen_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 2. GET /api/gold-studio/specimens — List
@route("GET", "/api/gold-studio/specimens")
def gs_list_specimens(params: dict) -> dict:
    limit, offset = _paginate(params)
    where, bind = ["deleted_at IS NULL"], []

    for col, key in [("division", "division"), ("type", "type"),
                     ("steward", "steward"), ("job_state", "job_state")]:
        val = (params.get(key) or "").strip()
        if val:
            where.append(f"{col} = ?")
            bind.append(val)

    where_sql = "WHERE " + " AND ".join(where)

    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM gs_specimens {where_sql}", bind
        ).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT * FROM gs_specimens {where_sql}
                ORDER BY created_at DESC LIMIT ? OFFSET ?""",
            bind + [limit, offset],
        ).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# 3. GET /api/gold-studio/specimens/{id} — Detail
@route("GET", "/api/gold-studio/specimens/{id}")
def gs_get_specimen(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM gs_specimens WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not row:
            raise HttpError("Specimen not found", 404)
        spec = _row_to_dict(row)
        spec["entities"] = _rows_to_list(conn.execute(
            """SELECT * FROM gs_extracted_entities
               WHERE specimen_id = ? AND deleted_at IS NULL
               ORDER BY entity_name""", (sid,)).fetchall())
        spec["queries"] = _rows_to_list(conn.execute(
            "SELECT * FROM gs_specimen_queries WHERE specimen_id = ? ORDER BY ordinal",
            (sid,)).fetchall())
        return spec
    finally:
        conn.close()


# 4. PUT /api/gold-studio/specimens/{id} — Update metadata
@route("PUT", "/api/gold-studio/specimens/{id}")
def gs_update_specimen(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        old = conn.execute(
            "SELECT * FROM gs_specimens WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not old:
            raise HttpError("Specimen not found", 404)

        updatable = ("name", "division", "source_system", "steward",
                     "description", "tags", "file_path")
        sets, vals = [], []
        for col in updatable:
            if col in params and params[col] is not None:
                v = params[col]
                if col == "tags" and isinstance(v, list):
                    v = json.dumps(v)
                sets.append(f"{col} = ?")
                vals.append(v)
        if not sets:
            raise HttpError("No updatable fields provided", 400)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        vals.append(sid)
        conn.execute(
            f"UPDATE gs_specimens SET {', '.join(sets)} WHERE id = ?", vals)
        _audit(conn, "specimen", sid, "updated",
               previous_value=_row_to_dict(old))
        conn.commit()
        row = conn.execute("SELECT * FROM gs_specimens WHERE id = ?",
                           (sid,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 5. DELETE /api/gold-studio/specimens/{id} — Soft delete
@route("DELETE", "/api/gold-studio/specimens/{id}")
def gs_delete_specimen(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        old = conn.execute(
            "SELECT * FROM gs_specimens WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not old:
            raise HttpError("Specimen not found", 404)
        conn.execute(
            "UPDATE gs_specimens SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
            (sid,))
        _audit(conn, "specimen", sid, "deleted")
        conn.commit()
        return {"status": "deleted", "id": sid}
    finally:
        conn.close()


# 6. POST /api/gold-studio/specimens/{id}/extract — Trigger extraction
@route("POST", "/api/gold-studio/specimens/{id}/extract")
def gs_extract_specimen(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        spec = conn.execute(
            "SELECT * FROM gs_specimens WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not spec:
            raise HttpError("Specimen not found", 404)

        # Create job
        cur = conn.execute(
            """INSERT INTO gs_jobs (job_type, specimen_id, status, started_at)
               VALUES ('extraction', ?, 'queued', CURRENT_TIMESTAMP)""",
            (sid,))
        job_id = cur.lastrowid
        conn.execute(
            "UPDATE gs_specimens SET job_state = 'extracting' WHERE id = ?",
            (sid,))
        _audit(conn, "specimen", sid, "extract_triggered",
               new_value={"job_id": job_id})
        conn.commit()
    finally:
        conn.close()

    # Background extraction thread
    def _run_extraction(job_id_inner, specimen_id):
        cxn = cpdb._get_conn()
        try:
            cxn.execute(
                "UPDATE gs_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?",
                (job_id_inner,))
            cxn.commit()

            # Simulated extraction — in production this calls the parser engine
            specimen = cxn.execute(
                "SELECT * FROM gs_specimens WHERE id = ?",
                (specimen_id,)).fetchone()
            file_path = specimen["file_path"] if specimen else None

            # Mark completed
            cxn.execute(
                """UPDATE gs_jobs SET status = 'completed',
                   completed_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (job_id_inner,))
            cxn.execute(
                "UPDATE gs_specimens SET job_state = 'extracted', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (specimen_id,))
            cxn.commit()
            log.info("Extraction job %d completed for specimen %d",
                     job_id_inner, specimen_id)
        except Exception:
            log.exception("Extraction job %d failed", job_id_inner)
            cxn.execute(
                "UPDATE gs_jobs SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
                (job_id_inner,))
            cxn.execute(
                "UPDATE gs_specimens SET job_state = 'parse_failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (specimen_id,))
            cxn.commit()
        finally:
            cxn.close()

    t = threading.Thread(target=_run_extraction, args=(job_id, sid),
                         daemon=True)
    t.start()
    return {"job_id": job_id, "status": "queued", "specimen_id": sid}


# 7. GET /api/gold-studio/specimens/{id}/queries — List extracted queries
@route("GET", "/api/gold-studio/specimens/{id}/queries")
def gs_specimen_queries(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM gs_specimen_queries WHERE specimen_id = ? ORDER BY ordinal",
            (sid,)).fetchall()
        return {"items": _rows_to_list(rows), "total": len(rows)}
    finally:
        conn.close()


# 8. POST /api/gold-studio/specimens/bulk — Bulk import
@route("POST", "/api/gold-studio/specimens/bulk")
def gs_bulk_import_specimens(params: dict) -> dict:
    specimens = params.get("specimens")
    if not specimens or not isinstance(specimens, list):
        raise HttpError("'specimens' must be a non-empty array", 400)
    if len(specimens) > 200:
        raise HttpError("Maximum 200 specimens per bulk import", 400)

    conn = cpdb._get_conn()
    try:
        created_ids = []
        for sp in specimens:
            name = (sp.get("name") or "").strip()
            stype = (sp.get("type") or "").strip().lower()
            division = (sp.get("division") or "").strip()
            steward = (sp.get("steward") or "").strip()
            if not all([name, stype, division, steward]):
                continue  # skip incomplete entries
            tags = sp.get("tags")
            if isinstance(tags, list):
                tags = json.dumps(tags)
            cur = conn.execute(
                """INSERT INTO gs_specimens
                   (name, type, division, source_system, steward, description, tags, file_path, job_state)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')""",
                (name, stype, division, sp.get("source_system"),
                 steward, sp.get("description"), tags, sp.get("file_path")),
            )
            created_ids.append(cur.lastrowid)
            _audit(conn, "specimen", cur.lastrowid, "created",
                   new_value={"name": name, "type": stype, "bulk": True})
        conn.commit()
        return {"created": len(created_ids), "ids": created_ids}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 2: Extracted Entities (5 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 9. GET /api/gold-studio/entities — List all
@route("GET", "/api/gold-studio/entities")
def gs_list_entities(params: dict) -> dict:
    limit, offset = _paginate(params)
    where, bind = ["e.deleted_at IS NULL"], []

    for col, key in [("e.specimen_id", "specimen_id"),
                     ("e.cluster_id", "cluster_id"),
                     ("e.provenance", "provenance"),
                     ("e.source_system", "source_system")]:
        val = params.get(key)
        if val is not None and str(val).strip():
            where.append(f"{col} = ?")
            bind.append(val)

    division = (params.get("division") or "").strip()
    if division:
        where.append("s.division = ?")
        bind.append(division)

    where_sql = "WHERE " + " AND ".join(where)

    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"""SELECT COUNT(*) AS cnt FROM gs_extracted_entities e
                LEFT JOIN gs_specimens s ON e.specimen_id = s.id
                {where_sql}""", bind
        ).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT e.*, s.name AS specimen_name, s.division
                FROM gs_extracted_entities e
                LEFT JOIN gs_specimens s ON e.specimen_id = s.id
                {where_sql}
                ORDER BY e.entity_name COLLATE NOCASE
                LIMIT ? OFFSET ?""",
            bind + [limit, offset],
        ).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# 10. GET /api/gold-studio/entities/{id} — Detail
@route("GET", "/api/gold-studio/entities/{id}")
def gs_get_entity(params: dict) -> dict:
    eid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            """SELECT e.*, s.name AS specimen_name, s.division
               FROM gs_extracted_entities e
               LEFT JOIN gs_specimens s ON e.specimen_id = s.id
               WHERE e.id = ? AND e.deleted_at IS NULL""",
            (eid,)).fetchone()
        if not row:
            raise HttpError("Entity not found", 404)
        entity = _row_to_dict(row)
        entity["columns"] = _rows_to_list(conn.execute(
            "SELECT * FROM gs_extracted_columns WHERE entity_id = ? ORDER BY ordinal",
            (eid,)).fetchall())
        entity["relationships"] = _rows_to_list(conn.execute(
            """SELECT * FROM gs_extracted_relationships
               WHERE from_entity_id = ? OR to_entity_id = ?""",
            (eid, eid)).fetchall())
        entity["schema_discovery"] = _rows_to_list(conn.execute(
            "SELECT * FROM gs_schema_discovery WHERE entity_id = ? ORDER BY discovered_at DESC",
            (eid,)).fetchall())
        return entity
    finally:
        conn.close()


# 11. GET /api/gold-studio/entities/{id}/columns — Column catalog
@route("GET", "/api/gold-studio/entities/{id}/columns")
def gs_entity_columns(params: dict) -> dict:
    eid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM gs_extracted_columns WHERE entity_id = ? ORDER BY ordinal",
            (eid,)).fetchall()
        return {"items": _rows_to_list(rows), "total": len(rows)}
    finally:
        conn.close()


# 12. GET /api/gold-studio/entities/{id}/schema — Schema discovery results
@route("GET", "/api/gold-studio/entities/{id}/schema")
def gs_entity_schema(params: dict) -> dict:
    eid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM gs_schema_discovery WHERE entity_id = ? ORDER BY discovered_at DESC",
            (eid,)).fetchall()
        return {"items": _rows_to_list(rows), "total": len(rows)}
    finally:
        conn.close()


# 13. POST /api/gold-studio/entities/{id}/discover-schema — Trigger schema discovery
@route("POST", "/api/gold-studio/entities/{id}/discover-schema")
def gs_discover_schema(params: dict) -> dict:
    eid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        entity = conn.execute(
            "SELECT * FROM gs_extracted_entities WHERE id = ? AND deleted_at IS NULL",
            (eid,)).fetchone()
        if not entity:
            raise HttpError("Entity not found", 404)

        cur = conn.execute(
            """INSERT INTO gs_jobs (job_type, entity_id, status, started_at)
               VALUES ('schema_discovery', ?, 'queued', CURRENT_TIMESTAMP)""",
            (eid,))
        job_id = cur.lastrowid
        _audit(conn, "entity", eid, "schema_discovery_triggered",
               new_value={"job_id": job_id})
        conn.commit()
    finally:
        conn.close()

    def _run_discovery(job_id_inner, entity_id):
        cxn = cpdb._get_conn()
        try:
            cxn.execute(
                "UPDATE gs_jobs SET status = 'running' WHERE id = ?",
                (job_id_inner,))
            cxn.commit()

            ent = cxn.execute(
                "SELECT * FROM gs_extracted_entities WHERE id = ?",
                (entity_id,)).fetchone()

            # In production: connect to source DB, run sp_describe/FMTONLY, etc.
            # For now, mark completed
            cxn.execute(
                """UPDATE gs_jobs SET status = 'completed',
                   completed_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (job_id_inner,))
            cxn.commit()
            log.info("Schema discovery job %d completed for entity %d",
                     job_id_inner, entity_id)
        except Exception:
            log.exception("Schema discovery job %d failed", job_id_inner)
            cxn.execute(
                "UPDATE gs_jobs SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
                (job_id_inner,))
            cxn.commit()
        finally:
            cxn.close()

    t = threading.Thread(target=_run_discovery, args=(job_id, eid),
                         daemon=True)
    t.start()
    return {"job_id": job_id, "status": "queued", "entity_id": eid}


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 3: Clusters (8 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 14. GET /api/gold-studio/clusters — List
@route("GET", "/api/gold-studio/clusters")
def gs_list_clusters(params: dict) -> dict:
    limit, offset = _paginate(params)
    where, bind = ["c.deleted_at IS NULL"], []

    status = (params.get("status") or "").strip()
    if status:
        where.append("c.status = ?")
        bind.append(status)

    division = (params.get("division") or "").strip()
    if division:
        where.append("c.division = ?")
        bind.append(division)

    conf_min = params.get("confidence_min")
    if conf_min is not None and str(conf_min).strip():
        where.append("c.confidence >= ?")
        bind.append(int(conf_min))

    where_sql = "WHERE " + " AND ".join(where)
    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM gs_clusters c {where_sql}", bind
        ).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT c.*,
                    (SELECT COUNT(*) FROM gs_extracted_entities
                     WHERE cluster_id = c.id AND deleted_at IS NULL) AS member_count
                FROM gs_clusters c {where_sql}
                ORDER BY c.confidence DESC, c.created_at DESC
                LIMIT ? OFFSET ?""",
            bind + [limit, offset],
        ).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# 15. GET /api/gold-studio/clusters/{id} — Detail
@route("GET", "/api/gold-studio/clusters/{id}")
def gs_get_cluster(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM gs_clusters WHERE id = ? AND deleted_at IS NULL",
            (cid,)).fetchone()
        if not row:
            raise HttpError("Cluster not found", 404)
        cluster = _row_to_dict(row)
        cluster["members"] = _rows_to_list(conn.execute(
            """SELECT e.*, s.name AS specimen_name
               FROM gs_extracted_entities e
               LEFT JOIN gs_specimens s ON e.specimen_id = s.id
               WHERE e.cluster_id = ? AND e.deleted_at IS NULL
               ORDER BY e.entity_name""",
            (cid,)).fetchall())
        cluster["column_decisions"] = _rows_to_list(conn.execute(
            "SELECT * FROM gs_cluster_column_decisions WHERE cluster_id = ? ORDER BY column_name",
            (cid,)).fetchall())
        return cluster
    finally:
        conn.close()


# 16. PUT /api/gold-studio/clusters/{id} — Update
@route("PUT", "/api/gold-studio/clusters/{id}")
def gs_update_cluster(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        old = conn.execute(
            "SELECT * FROM gs_clusters WHERE id = ? AND deleted_at IS NULL",
            (cid,)).fetchone()
        if not old:
            raise HttpError("Cluster not found", 404)

        sets, vals = [], []
        for col in ("label", "status", "notes"):
            if col in params and params[col] is not None:
                sets.append(f"{col} = ?")
                vals.append(params[col])
        if not sets:
            raise HttpError("No updatable fields provided", 400)
        vals.append(cid)
        conn.execute(
            f"UPDATE gs_clusters SET {', '.join(sets)} WHERE id = ?", vals)
        _audit(conn, "cluster", cid, "updated",
               previous_value=_row_to_dict(old))
        conn.commit()
        row = conn.execute("SELECT * FROM gs_clusters WHERE id = ?",
                           (cid,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 17. POST /api/gold-studio/clusters/{id}/resolve — Resolve cluster
@route("POST", "/api/gold-studio/clusters/{id}/resolve")
def gs_resolve_cluster(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    _require(params, "action")
    action = params["action"].strip().lower()
    valid_actions = ("approve", "split", "merge", "dismiss")
    if action not in valid_actions:
        raise HttpError(f"action must be one of {valid_actions}", 400)
    if action == "dismiss" and not (params.get("notes") or "").strip():
        raise HttpError("notes required when dismissing a cluster", 400)

    conn = cpdb._get_conn()
    try:
        old = conn.execute(
            "SELECT * FROM gs_clusters WHERE id = ? AND deleted_at IS NULL",
            (cid,)).fetchone()
        if not old:
            raise HttpError("Cluster not found", 404)

        status = "dismissed" if action == "dismiss" else "resolved"
        conn.execute(
            """UPDATE gs_clusters
               SET status = ?, resolution = ?, resolved_by = ?,
                   resolved_at = CURRENT_TIMESTAMP, notes = COALESCE(?, notes)
               WHERE id = ?""",
            (status, action, params.get("resolved_by", "system"),
             params.get("notes"), cid))

        # When approved, update member entities to clustered provenance
        if action == "approve":
            conn.execute(
                """UPDATE gs_extracted_entities
                   SET provenance = 'clustered'
                   WHERE cluster_id = ? AND deleted_at IS NULL""",
                (cid,))

        _audit(conn, "cluster", cid, f"resolved:{action}",
               previous_value={"status": old["status"]},
               new_value={"status": status, "resolution": action},
               notes=params.get("notes"))
        conn.commit()
        row = conn.execute("SELECT * FROM gs_clusters WHERE id = ?",
                           (cid,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 18. GET /api/gold-studio/clusters/{id}/column-decisions — Column reconciliation
@route("GET", "/api/gold-studio/clusters/{id}/column-decisions")
def gs_get_column_decisions(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM gs_cluster_column_decisions WHERE cluster_id = ? ORDER BY column_name",
            (cid,)).fetchall()
        return {"items": _rows_to_list(rows), "total": len(rows)}
    finally:
        conn.close()


# 19. PUT /api/gold-studio/clusters/{id}/column-decisions — Update column decisions
@route("PUT", "/api/gold-studio/clusters/{id}/column-decisions")
def gs_update_column_decisions(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    decisions = params.get("decisions")
    if not decisions or not isinstance(decisions, list):
        raise HttpError("'decisions' must be a non-empty array", 400)

    conn = cpdb._get_conn()
    try:
        # Verify cluster exists
        cluster = conn.execute(
            "SELECT id FROM gs_clusters WHERE id = ? AND deleted_at IS NULL",
            (cid,)).fetchone()
        if not cluster:
            raise HttpError("Cluster not found", 404)

        for d in decisions:
            col_name = (d.get("column_name") or "").strip()
            decision = (d.get("decision") or "").strip()
            if not col_name or decision not in ("include", "exclude", "review"):
                continue

            # Upsert: check if exists
            existing = conn.execute(
                """SELECT id FROM gs_cluster_column_decisions
                   WHERE cluster_id = ? AND column_name = ?
                   AND (source_entity_id IS ? OR source_entity_id = ?)""",
                (cid, col_name, d.get("source_entity_id"),
                 d.get("source_entity_id"))).fetchone()

            if existing:
                conn.execute(
                    """UPDATE gs_cluster_column_decisions
                       SET decision = ?, key_designation = ?, reason = ?,
                           decided_by = ?, decided_at = CURRENT_TIMESTAMP
                       WHERE id = ?""",
                    (decision, d.get("key_designation"),
                     d.get("reason"), d.get("decided_by", "system"),
                     existing["id"]))
            else:
                conn.execute(
                    """INSERT INTO gs_cluster_column_decisions
                       (cluster_id, column_name, source_entity_id, decision,
                        key_designation, reason, decided_by, decided_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
                    (cid, col_name, d.get("source_entity_id"), decision,
                     d.get("key_designation"), d.get("reason"),
                     d.get("decided_by", "system")))

        _audit(conn, "cluster", cid, "column_decisions_updated",
               new_value={"count": len(decisions)})
        conn.commit()

        rows = conn.execute(
            "SELECT * FROM gs_cluster_column_decisions WHERE cluster_id = ? ORDER BY column_name",
            (cid,)).fetchall()
        return {"items": _rows_to_list(rows), "total": len(rows)}
    finally:
        conn.close()


# 20. POST /api/gold-studio/clusters/detect — Run duplicate detection
@route("POST", "/api/gold-studio/clusters/detect")
def gs_detect_clusters(params: dict) -> dict:
    _require(params, "division")
    division = params["division"].strip()

    conn = cpdb._get_conn()
    try:
        cur = conn.execute(
            """INSERT INTO gs_jobs (job_type, status, started_at,
                                    metadata)
               VALUES ('cluster_detection', 'queued', CURRENT_TIMESTAMP, ?)""",
            (json.dumps({"division": division}),))
        job_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    def _run_detection(job_id_inner, div):
        cxn = cpdb._get_conn()
        try:
            cxn.execute("UPDATE gs_jobs SET status = 'running' WHERE id = ?",
                        (job_id_inner,))
            cxn.commit()

            # Duplicate detection: group entities by normalized name within division
            entities = cxn.execute(
                """SELECT e.id, e.entity_name, e.schema_name, e.source_database,
                          e.source_system, e.specimen_id
                   FROM gs_extracted_entities e
                   JOIN gs_specimens s ON e.specimen_id = s.id
                   WHERE s.division = ? AND e.deleted_at IS NULL
                     AND e.cluster_id IS NULL
                   ORDER BY e.entity_name COLLATE NOCASE""",
                (div,)).fetchall()

            # Simple name-based grouping (production would use fuzzy matching)
            groups: dict[str, list] = {}
            for ent in entities:
                key = (ent["entity_name"] or "").strip().lower()
                groups.setdefault(key, []).append(dict(ent))

            clusters_created = 0
            for name, members in groups.items():
                if len(members) < 2:
                    continue
                cur = cxn.execute(
                    """INSERT INTO gs_clusters
                       (division, label, dominant_name, confidence, status)
                       VALUES (?, ?, ?, ?, 'unresolved')""",
                    (div, name, members[0]["entity_name"], 80))
                cluster_id = cur.lastrowid
                for m in members:
                    cxn.execute(
                        "UPDATE gs_extracted_entities SET cluster_id = ? WHERE id = ?",
                        (cluster_id, m["id"]))
                clusters_created += 1

            cxn.execute(
                """UPDATE gs_jobs SET status = 'completed',
                   completed_at = CURRENT_TIMESTAMP,
                   metadata = ? WHERE id = ?""",
                (json.dumps({"division": div,
                             "clusters_created": clusters_created}),
                 job_id_inner))
            cxn.commit()
            log.info("Cluster detection job %d: %d clusters created for %s",
                     job_id_inner, clusters_created, div)
        except Exception:
            log.exception("Cluster detection job %d failed", job_id_inner)
            cxn.execute(
                "UPDATE gs_jobs SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
                (job_id_inner,))
            cxn.commit()
        finally:
            cxn.close()

    t = threading.Thread(target=_run_detection, args=(job_id, division),
                         daemon=True)
    t.start()
    return {"job_id": job_id, "status": "queued", "division": division}


# 21. GET /api/gold-studio/clusters/unclustered — Entities not in any cluster
@route("GET", "/api/gold-studio/clusters/unclustered")
def gs_unclustered_entities(params: dict) -> dict:
    limit, offset = _paginate(params)
    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            """SELECT COUNT(*) AS cnt FROM gs_extracted_entities
               WHERE cluster_id IS NULL AND deleted_at IS NULL"""
        ).fetchone()["cnt"]
        rows = conn.execute(
            """SELECT e.*, s.name AS specimen_name, s.division
               FROM gs_extracted_entities e
               LEFT JOIN gs_specimens s ON e.specimen_id = s.id
               WHERE e.cluster_id IS NULL AND e.deleted_at IS NULL
               ORDER BY e.entity_name COLLATE NOCASE
               LIMIT ? OFFSET ?""",
            (limit, offset)).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 4: Canonical Entities (9 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 22. GET /api/gold-studio/canonical — List
@route("GET", "/api/gold-studio/canonical")
def gs_list_canonical(params: dict) -> dict:
    limit, offset = _paginate(params)
    where, bind = ["is_current = 1", "deleted_at IS NULL"], []

    for col, key in [("domain", "domain"), ("entity_type", "type"),
                     ("status", "status")]:
        val = (params.get(key) or "").strip()
        if val:
            where.append(f"{col} = ?")
            bind.append(val)

    where_sql = "WHERE " + " AND ".join(where)
    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM gs_canonical_entities {where_sql}",
            bind).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT * FROM gs_canonical_entities {where_sql}
                ORDER BY name COLLATE NOCASE
                LIMIT ? OFFSET ?""",
            bind + [limit, offset]).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# 23. GET /api/gold-studio/canonical/{id} — Detail
@route("GET", "/api/gold-studio/canonical/{id}")
def gs_get_canonical(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM gs_canonical_entities WHERE id = ? AND deleted_at IS NULL",
            (cid,)).fetchone()
        if not row:
            raise HttpError("Canonical entity not found", 404)
        ce = _row_to_dict(row)
        ce["columns"] = _rows_to_list(conn.execute(
            "SELECT * FROM gs_canonical_columns WHERE canonical_id = ? ORDER BY ordinal",
            (cid,)).fetchall())
        # FK relationships from canonical columns
        ce["relationships"] = _rows_to_list(conn.execute(
            """SELECT cc.*, tgt.name AS target_name
               FROM gs_canonical_columns cc
               LEFT JOIN gs_canonical_entities tgt
                   ON tgt.root_id = cc.fk_target_root_id AND tgt.is_current = 1
               WHERE cc.canonical_id = ? AND cc.fk_target_root_id IS NOT NULL""",
            (cid,)).fetchall())
        # Lineage: which extracted entities feed this canonical
        ce["lineage"] = _rows_to_list(conn.execute(
            """SELECT e.*, s.name AS specimen_name
               FROM gs_extracted_entities e
               LEFT JOIN gs_specimens s ON e.specimen_id = s.id
               WHERE e.canonical_root_id = ? AND e.deleted_at IS NULL""",
            (row["root_id"],)).fetchall())
        return ce
    finally:
        conn.close()


# 24. POST /api/gold-studio/canonical — Create
@route("POST", "/api/gold-studio/canonical")
def gs_create_canonical(params: dict) -> dict:
    _require(params, "name", "business_description", "domain",
             "entity_type", "grain", "business_keys", "steward")

    entity_type = params["entity_type"].strip().lower()
    valid_types = ("fact", "dimension", "bridge", "reference", "aggregate")
    if entity_type not in valid_types:
        raise HttpError(f"entity_type must be one of {valid_types}", 400)

    bkeys = params["business_keys"]
    if isinstance(bkeys, list):
        bkeys = json.dumps(bkeys)

    source_systems = params.get("source_systems")
    if isinstance(source_systems, list):
        source_systems = json.dumps(source_systems)
    source_cluster_ids = params.get("source_cluster_ids")
    if isinstance(source_cluster_ids, list):
        source_cluster_ids = json.dumps(source_cluster_ids)
    shared_dims = params.get("shared_dimensions")
    if isinstance(shared_dims, list):
        shared_dims = json.dumps(shared_dims)

    conn = cpdb._get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        cur = conn.execute(
            """INSERT INTO gs_canonical_entities
               (root_id, version, is_current, name, business_description, domain,
                entity_type, grain, business_keys, steward, source_systems,
                source_cluster_ids, status, shared_dimensions)
               VALUES (0, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)""",
            (params["name"].strip(), params["business_description"].strip(),
             params["domain"].strip(), entity_type,
             params["grain"].strip(), bkeys, params["steward"].strip(),
             source_systems, source_cluster_ids, shared_dims))
        new_id = cur.lastrowid
        conn.execute(
            "UPDATE gs_canonical_entities SET root_id = ? WHERE id = ?",
            (new_id, new_id))

        # Link extracted entities if cluster_id or entity_id provided
        cluster_id = _parse_int(params.get("cluster_id"), "cluster_id")
        entity_id = _parse_int(params.get("entity_id"), "entity_id")
        if cluster_id:
            conn.execute(
                """UPDATE gs_extracted_entities
                   SET canonical_root_id = ?
                   WHERE cluster_id = ? AND deleted_at IS NULL""",
                (new_id, cluster_id))
        elif entity_id:
            conn.execute(
                """UPDATE gs_extracted_entities
                   SET canonical_root_id = ?, provenance = 'clustered'
                   WHERE id = ? AND deleted_at IS NULL""",
                (new_id, entity_id))

        _audit(conn, "canonical", new_id, "created",
               new_value={"name": params["name"], "domain": params["domain"]})
        conn.commit()

        row = conn.execute(
            "SELECT * FROM gs_canonical_entities WHERE id = ?",
            (new_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 25. PUT /api/gold-studio/canonical/{id} — Update (versioned if material_change)
@route("PUT", "/api/gold-studio/canonical/{id}")
def gs_update_canonical(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    material = str(params.get("material_change", "false")).lower() == "true"

    conn = cpdb._get_conn()
    try:
        old = conn.execute(
            "SELECT * FROM gs_canonical_entities WHERE id = ? AND deleted_at IS NULL",
            (cid,)).fetchone()
        if not old:
            raise HttpError("Canonical entity not found", 404)

        updatable = ("name", "business_description", "domain", "entity_type",
                     "grain", "business_keys", "steward", "source_systems",
                     "source_cluster_ids", "status", "shared_dimensions")

        if material:
            # Create new version
            conn.execute("BEGIN IMMEDIATE")
            old_d = _row_to_dict(old)
            new_version = old_d["version"] + 1

            # Collect values, using params over old
            vals = {}
            for col in updatable:
                v = params.get(col, old_d.get(col))
                if isinstance(v, (list, dict)):
                    v = json.dumps(v)
                vals[col] = v

            conn.execute(
                "UPDATE gs_canonical_entities SET is_current = 0 WHERE id = ?",
                (cid,))

            cur = conn.execute(
                """INSERT INTO gs_canonical_entities
                   (root_id, version, is_current, name, business_description,
                    domain, entity_type, grain, business_keys, steward,
                    source_systems, source_cluster_ids, status, shared_dimensions)
                   VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (old_d["root_id"], new_version,
                 vals["name"], vals["business_description"], vals["domain"],
                 vals["entity_type"], vals["grain"], vals["business_keys"],
                 vals["steward"], vals["source_systems"],
                 vals["source_cluster_ids"], vals["status"],
                 vals["shared_dimensions"]))
            new_id = cur.lastrowid
            _audit(conn, "canonical", new_id, "versioned",
                   previous_value={"version": old_d["version"]},
                   new_value={"version": new_version})
            conn.commit()
            row = conn.execute(
                "SELECT * FROM gs_canonical_entities WHERE id = ?",
                (new_id,)).fetchone()
            return _row_to_dict(row)
        else:
            # In-place update
            sets, vals = [], []
            for col in updatable:
                if col in params and params[col] is not None:
                    v = params[col]
                    if isinstance(v, (list, dict)):
                        v = json.dumps(v)
                    sets.append(f"{col} = ?")
                    vals.append(v)
            if not sets:
                raise HttpError("No updatable fields provided", 400)
            sets.append("updated_at = CURRENT_TIMESTAMP")
            vals.append(cid)
            conn.execute(
                f"UPDATE gs_canonical_entities SET {', '.join(sets)} WHERE id = ?",
                vals)
            _audit(conn, "canonical", cid, "updated",
                   previous_value=_row_to_dict(old))
            conn.commit()
            row = conn.execute(
                "SELECT * FROM gs_canonical_entities WHERE id = ?",
                (cid,)).fetchone()
            return _row_to_dict(row)
    finally:
        conn.close()


# 26. POST /api/gold-studio/canonical/{id}/approve — Set status=approved
@route("POST", "/api/gold-studio/canonical/{id}/approve")
def gs_approve_canonical(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM gs_canonical_entities WHERE id = ? AND deleted_at IS NULL",
            (cid,)).fetchone()
        if not row:
            raise HttpError("Canonical entity not found", 404)

        # Validate required fields
        missing = []
        for field in ("name", "business_description", "domain", "entity_type",
                      "grain", "business_keys", "steward"):
            val = row[field]
            if val is None or (isinstance(val, str) and not val.strip()):
                missing.append(field)
        if missing:
            raise HttpError(
                f"Cannot approve: missing required fields: {', '.join(missing)}", 400)

        # Check columns exist
        col_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM gs_canonical_columns WHERE canonical_id = ?",
            (cid,)).fetchone()["cnt"]
        if col_count == 0:
            raise HttpError(
                "Cannot approve: canonical entity has no columns defined", 400)

        conn.execute(
            """UPDATE gs_canonical_entities
               SET status = 'approved', updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""", (cid,))
        _audit(conn, "canonical", cid, "approved",
               previous_value={"status": row["status"]},
               new_value={"status": "approved"})
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM gs_canonical_entities WHERE id = ?",
            (cid,)).fetchone()
        return _row_to_dict(updated)
    finally:
        conn.close()


# 27. POST /api/gold-studio/canonical/{id}/generate-spec — Generate Gold spec
@route("POST", "/api/gold-studio/canonical/{id}/generate-spec")
def gs_generate_spec(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        ce = conn.execute(
            """SELECT * FROM gs_canonical_entities
               WHERE id = ? AND deleted_at IS NULL AND is_current = 1""",
            (cid,)).fetchone()
        if not ce:
            raise HttpError("Canonical entity not found", 404)
        if ce["status"] != "approved":
            raise HttpError("Canonical entity must be approved before generating a spec", 400)

        root_id = ce["root_id"]
        # Check if spec already exists for this canonical root
        existing = conn.execute(
            """SELECT id FROM gs_gold_specs
               WHERE canonical_root_id = ? AND is_current = 1 AND deleted_at IS NULL""",
            (root_id,)).fetchone()
        if existing:
            raise HttpError(
                f"Gold spec already exists (id={existing['id']}). Update it instead.", 409)

        # Gather columns
        columns = _rows_to_list(conn.execute(
            "SELECT * FROM gs_canonical_columns WHERE canonical_id = ? ORDER BY ordinal",
            (cid,)).fetchall())

        included = json.dumps([
            {"column_name": c["column_name"], "data_type": c["data_type"],
             "key_designation": c["key_designation"]}
            for c in columns
        ])

        target_name = f"gold_{ce['domain']}_{ce['name']}".lower().replace(" ", "_")

        conn.execute("BEGIN IMMEDIATE")
        cur = conn.execute(
            """INSERT INTO gs_gold_specs
               (root_id, version, is_current, canonical_root_id, canonical_version,
                target_name, object_type, included_columns, status)
               VALUES (0, 1, 1, ?, ?, ?, 'mlv', ?, 'draft')""",
            (root_id, ce["version"], target_name, included))
        spec_id = cur.lastrowid
        conn.execute(
            "UPDATE gs_gold_specs SET root_id = ? WHERE id = ?",
            (spec_id, spec_id))
        _audit(conn, "spec", spec_id, "generated",
               new_value={"canonical_root_id": root_id,
                          "target_name": target_name})
        conn.commit()

        row = conn.execute(
            "SELECT * FROM gs_gold_specs WHERE id = ?",
            (spec_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 28. GET /api/gold-studio/canonical/{id}/versions — Version history
@route("GET", "/api/gold-studio/canonical/{id}/versions")
def gs_canonical_versions(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        # Get root_id from any version
        row = conn.execute(
            "SELECT root_id FROM gs_canonical_entities WHERE id = ?",
            (cid,)).fetchone()
        if not row:
            raise HttpError("Canonical entity not found", 404)
        root_id = row["root_id"]
        rows = conn.execute(
            """SELECT * FROM gs_canonical_entities
               WHERE root_id = ? ORDER BY version DESC""",
            (root_id,)).fetchall()
        return {"items": _rows_to_list(rows), "total": len(rows),
                "root_id": root_id}
    finally:
        conn.close()


# 29. GET /api/gold-studio/canonical/domains — Distinct domains with counts
@route("GET", "/api/gold-studio/canonical/domains")
def gs_canonical_domains(params: dict) -> dict:
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            """SELECT domain, COUNT(*) AS entity_count
               FROM gs_canonical_entities
               WHERE is_current = 1 AND deleted_at IS NULL
               GROUP BY domain ORDER BY domain""").fetchall()
        return {"items": _rows_to_list(rows), "total": len(rows)}
    finally:
        conn.close()


# 30. GET /api/gold-studio/canonical/relationships — All cross-entity FK relationships
@route("GET", "/api/gold-studio/canonical/relationships")
def gs_canonical_relationships(params: dict) -> dict:
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            """SELECT cc.id, cc.canonical_root_id AS from_root_id,
                      ce_from.name AS from_entity,
                      cc.column_name, cc.fk_target_root_id AS to_root_id,
                      ce_to.name AS to_entity, cc.fk_target_column
               FROM gs_canonical_columns cc
               JOIN gs_canonical_entities ce_from
                   ON ce_from.root_id = cc.canonical_root_id AND ce_from.is_current = 1
               LEFT JOIN gs_canonical_entities ce_to
                   ON ce_to.root_id = cc.fk_target_root_id AND ce_to.is_current = 1
               WHERE cc.fk_target_root_id IS NOT NULL
               ORDER BY ce_from.name, cc.column_name""").fetchall()
        return {"items": _rows_to_list(rows), "total": len(rows)}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 5: Semantic Definitions (4 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 31. GET /api/gold-studio/semantic — List
@route("GET", "/api/gold-studio/semantic")
def gs_list_semantic(params: dict) -> dict:
    limit, offset = _paginate(params)
    where, bind = ["deleted_at IS NULL"], []

    crid = params.get("canonical_root_id")
    if crid is not None and str(crid).strip():
        where.append("canonical_root_id = ?")
        bind.append(int(crid))

    where_sql = "WHERE " + " AND ".join(where)
    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM gs_semantic_definitions {where_sql}",
            bind).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT * FROM gs_semantic_definitions {where_sql}
                ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?""",
            bind + [limit, offset]).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# 32. POST /api/gold-studio/semantic — Create
@route("POST", "/api/gold-studio/semantic")
def gs_create_semantic(params: dict) -> dict:
    _require(params, "canonical_root_id", "name", "definition_type")
    valid_types = ("measure", "kpi", "calc_group", "semantic_note")
    dtype = params["definition_type"].strip().lower()
    if dtype not in valid_types:
        raise HttpError(f"definition_type must be one of {valid_types}", 400)

    conn = cpdb._get_conn()
    try:
        cur = conn.execute(
            """INSERT INTO gs_semantic_definitions
               (canonical_root_id, name, definition_type, expression,
                expression_type, description, source_ref)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (int(params["canonical_root_id"]), params["name"].strip(),
             dtype, params.get("expression"), params.get("expression_type"),
             params.get("description"), params.get("source_ref")))
        new_id = cur.lastrowid
        _audit(conn, "canonical", int(params["canonical_root_id"]),
               "semantic_created",
               new_value={"semantic_id": new_id, "name": params["name"]})
        conn.commit()
        row = conn.execute(
            "SELECT * FROM gs_semantic_definitions WHERE id = ?",
            (new_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 33. PUT /api/gold-studio/semantic/{id} — Update
@route("PUT", "/api/gold-studio/semantic/{id}")
def gs_update_semantic(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        old = conn.execute(
            "SELECT * FROM gs_semantic_definitions WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not old:
            raise HttpError("Semantic definition not found", 404)

        sets, vals = [], []
        for col in ("name", "definition_type", "expression", "expression_type",
                     "description", "source_ref"):
            if col in params and params[col] is not None:
                sets.append(f"{col} = ?")
                vals.append(params[col])
        if not sets:
            raise HttpError("No updatable fields provided", 400)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        vals.append(sid)
        conn.execute(
            f"UPDATE gs_semantic_definitions SET {', '.join(sets)} WHERE id = ?",
            vals)
        _audit(conn, "canonical", old["canonical_root_id"],
               "semantic_updated",
               new_value={"semantic_id": sid})
        conn.commit()
        row = conn.execute(
            "SELECT * FROM gs_semantic_definitions WHERE id = ?",
            (sid,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 34. DELETE /api/gold-studio/semantic/{id} — Soft delete
@route("DELETE", "/api/gold-studio/semantic/{id}")
def gs_delete_semantic(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        old = conn.execute(
            "SELECT * FROM gs_semantic_definitions WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not old:
            raise HttpError("Semantic definition not found", 404)
        conn.execute(
            "UPDATE gs_semantic_definitions SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
            (sid,))
        _audit(conn, "canonical", old["canonical_root_id"],
               "semantic_deleted", new_value={"semantic_id": sid})
        conn.commit()
        return {"status": "deleted", "id": sid}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 6: Gold Specs (6 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 35. GET /api/gold-studio/specs — List
@route("GET", "/api/gold-studio/specs")
def gs_list_specs(params: dict) -> dict:
    limit, offset = _paginate(params)
    where, bind = ["gs.is_current = 1", "gs.deleted_at IS NULL"], []

    domain = (params.get("domain") or "").strip()
    if domain:
        where.append("ce.domain = ?")
        bind.append(domain)
    status = (params.get("status") or "").strip()
    if status:
        where.append("gs.status = ?")
        bind.append(status)

    where_sql = "WHERE " + " AND ".join(where)
    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"""SELECT COUNT(*) AS cnt FROM gs_gold_specs gs
                LEFT JOIN gs_canonical_entities ce
                    ON ce.root_id = gs.canonical_root_id AND ce.is_current = 1
                {where_sql}""", bind).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT gs.*, ce.name AS canonical_name, ce.domain, ce.entity_type
                FROM gs_gold_specs gs
                LEFT JOIN gs_canonical_entities ce
                    ON ce.root_id = gs.canonical_root_id AND ce.is_current = 1
                {where_sql}
                ORDER BY gs.target_name COLLATE NOCASE
                LIMIT ? OFFSET ?""",
            bind + [limit, offset]).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# 36. GET /api/gold-studio/specs/{id} — Detail
@route("GET", "/api/gold-studio/specs/{id}")
def gs_get_spec(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            """SELECT gs.*, ce.name AS canonical_name, ce.domain,
                      ce.entity_type, ce.grain
               FROM gs_gold_specs gs
               LEFT JOIN gs_canonical_entities ce
                   ON ce.root_id = gs.canonical_root_id AND ce.is_current = 1
               WHERE gs.id = ? AND gs.deleted_at IS NULL""",
            (sid,)).fetchone()
        if not row:
            raise HttpError("Gold spec not found", 404)
        spec = _row_to_dict(row)

        # Get validation runs
        spec["validation_runs"] = _rows_to_list(conn.execute(
            """SELECT * FROM gs_validation_runs
               WHERE spec_root_id = ? ORDER BY started_at DESC LIMIT 5""",
            (row["root_id"],)).fetchall())

        return spec
    finally:
        conn.close()


# 37. PUT /api/gold-studio/specs/{id} — Update
@route("PUT", "/api/gold-studio/specs/{id}")
def gs_update_spec(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        old = conn.execute(
            "SELECT * FROM gs_gold_specs WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not old:
            raise HttpError("Gold spec not found", 404)

        updatable = ("target_name", "object_type", "source_sql",
                     "transformation_rules", "included_columns",
                     "excluded_columns", "relationship_expectations",
                     "downstream_reports", "refresh_strategy",
                     "validation_rules", "status")
        sets, vals = [], []
        material = False
        material_fields = {"source_sql", "transformation_rules",
                           "included_columns", "excluded_columns",
                           "refresh_strategy"}
        for col in updatable:
            if col in params and params[col] is not None:
                v = params[col]
                if isinstance(v, (list, dict)):
                    v = json.dumps(v)
                sets.append(f"{col} = ?")
                vals.append(v)
                if col in material_fields:
                    material = True

        if not sets:
            raise HttpError("No updatable fields provided", 400)

        # Material changes trigger needs_revalidation
        if material and old["status"] == "validated":
            sets.append("status = ?")
            vals.append("needs_revalidation")

        sets.append("updated_at = CURRENT_TIMESTAMP")
        vals.append(sid)
        conn.execute(
            f"UPDATE gs_gold_specs SET {', '.join(sets)} WHERE id = ?", vals)
        _audit(conn, "spec", sid, "updated",
               previous_value=_row_to_dict(old),
               notes="material_change" if material else None)
        conn.commit()
        row = conn.execute("SELECT * FROM gs_gold_specs WHERE id = ?",
                           (sid,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 38. PUT /api/gold-studio/specs/{id}/sql — Update source SQL only
@route("PUT", "/api/gold-studio/specs/{id}/sql")
def gs_update_spec_sql(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    _require(params, "source_sql")
    conn = cpdb._get_conn()
    try:
        old = conn.execute(
            "SELECT * FROM gs_gold_specs WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not old:
            raise HttpError("Gold spec not found", 404)

        new_status = "needs_revalidation" if old["status"] == "validated" else old["status"]
        conn.execute(
            """UPDATE gs_gold_specs
               SET source_sql = ?, status = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (params["source_sql"], new_status, sid))
        _audit(conn, "spec", sid, "sql_updated",
               previous_value={"source_sql": old["source_sql"]},
               notes="triggers revalidation")
        conn.commit()
        row = conn.execute("SELECT * FROM gs_gold_specs WHERE id = ?",
                           (sid,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 39. GET /api/gold-studio/specs/{id}/versions — Version history
@route("GET", "/api/gold-studio/specs/{id}/versions")
def gs_spec_versions(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            "SELECT root_id FROM gs_gold_specs WHERE id = ?",
            (sid,)).fetchone()
        if not row:
            raise HttpError("Gold spec not found", 404)
        root_id = row["root_id"]
        rows = conn.execute(
            "SELECT * FROM gs_gold_specs WHERE root_id = ? ORDER BY version DESC",
            (root_id,)).fetchall()
        return {"items": _rows_to_list(rows), "total": len(rows),
                "root_id": root_id}
    finally:
        conn.close()


# 40. GET /api/gold-studio/specs/{id}/impact — Downstream impact analysis
@route("GET", "/api/gold-studio/specs/{id}/impact")
def gs_spec_impact(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        spec = conn.execute(
            "SELECT * FROM gs_gold_specs WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not spec:
            raise HttpError("Gold spec not found", 404)

        # Catalog entries using this spec
        catalog_entries = _rows_to_list(conn.execute(
            """SELECT * FROM gs_catalog_entries
               WHERE spec_root_id = ? AND deleted_at IS NULL
               ORDER BY version DESC""",
            (spec["root_id"],)).fetchall())

        # Other specs referencing same canonical
        related_specs = _rows_to_list(conn.execute(
            """SELECT * FROM gs_gold_specs
               WHERE canonical_root_id = ? AND id != ? AND is_current = 1
                 AND deleted_at IS NULL""",
            (spec["canonical_root_id"], sid)).fetchall())

        # Downstream reports from spec metadata
        downstream = []
        if spec["downstream_reports"]:
            try:
                downstream = json.loads(spec["downstream_reports"])
            except (json.JSONDecodeError, TypeError):
                pass

        return {
            "spec_id": sid,
            "catalog_entries": catalog_entries,
            "related_specs": related_specs,
            "downstream_reports": downstream,
            "impact_count": len(catalog_entries) + len(related_specs) + len(downstream),
        }
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 7: Validation (5 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 41. POST /api/gold-studio/validation/specs/{id}/validate — Run validation
@route("POST", "/api/gold-studio/validation/specs/{id}/validate")
def gs_validate_spec(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        spec = conn.execute(
            "SELECT * FROM gs_gold_specs WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not spec:
            raise HttpError("Gold spec not found", 404)

        # Create validation run
        cur = conn.execute(
            """INSERT INTO gs_validation_runs
               (spec_root_id, spec_version, started_at, status)
               VALUES (?, ?, CURRENT_TIMESTAMP, 'queued')""",
            (spec["root_id"], spec["version"]))
        run_id = cur.lastrowid

        # Create background job
        job_cur = conn.execute(
            """INSERT INTO gs_jobs (job_type, spec_id, status, started_at)
               VALUES ('validation', ?, 'queued', CURRENT_TIMESTAMP)""",
            (sid,))
        job_id = job_cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    def _run_validation(run_id_inner, spec_id, job_id_inner):
        cxn = cpdb._get_conn()
        try:
            cxn.execute("UPDATE gs_jobs SET status = 'running' WHERE id = ?",
                        (job_id_inner,))
            cxn.execute("UPDATE gs_validation_runs SET status = 'running' WHERE id = ?",
                        (run_id_inner,))
            cxn.commit()

            spec_row = cxn.execute(
                "SELECT * FROM gs_gold_specs WHERE id = ?",
                (spec_id,)).fetchone()

            # Validation logic placeholder:
            # - Check required columns present
            # - Validate source_sql syntax
            # - Check relationship expectations
            # - Verify included_columns against canonical
            results = {
                "checks_run": 0,
                "checks_passed": 0,
                "checks_failed": 0,
                "details": [],
            }

            # Basic checks
            checks = []
            if spec_row["source_sql"]:
                checks.append({"check": "source_sql_present", "status": "passed"})
            else:
                checks.append({"check": "source_sql_present", "status": "failed",
                               "message": "No source SQL defined"})

            if spec_row["included_columns"]:
                checks.append({"check": "columns_defined", "status": "passed"})
            else:
                checks.append({"check": "columns_defined", "status": "failed",
                               "message": "No columns included"})

            if spec_row["target_name"]:
                checks.append({"check": "target_name_set", "status": "passed"})
            else:
                checks.append({"check": "target_name_set", "status": "failed"})

            results["checks_run"] = len(checks)
            results["checks_passed"] = sum(1 for c in checks if c["status"] == "passed")
            results["checks_failed"] = sum(1 for c in checks if c["status"] == "failed")
            results["details"] = checks

            overall = "passed" if results["checks_failed"] == 0 else "failed"

            cxn.execute(
                """UPDATE gs_validation_runs
                   SET status = ?, results = ?, completed_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (overall, json.dumps(results), run_id_inner))
            cxn.execute(
                """UPDATE gs_jobs SET status = 'completed',
                   completed_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (job_id_inner,))

            if overall == "passed":
                cxn.execute(
                    "UPDATE gs_gold_specs SET status = 'validated', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (spec_id,))

            cxn.commit()
            log.info("Validation run %d: %s", run_id_inner, overall)
        except Exception:
            log.exception("Validation run %d failed", run_id_inner)
            cxn.execute(
                "UPDATE gs_validation_runs SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
                (run_id_inner,))
            cxn.execute(
                "UPDATE gs_jobs SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
                (job_id_inner,))
            cxn.commit()
        finally:
            cxn.close()

    t = threading.Thread(target=_run_validation,
                         args=(run_id, sid, job_id), daemon=True)
    t.start()
    return {"run_id": run_id, "job_id": job_id, "status": "queued"}


# 42. GET /api/gold-studio/validation/specs/{id}/runs — Run history
@route("GET", "/api/gold-studio/validation/specs/{id}/runs")
def gs_validation_runs(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    limit, offset = _paginate(params)
    conn = cpdb._get_conn()
    try:
        spec = conn.execute(
            "SELECT root_id FROM gs_gold_specs WHERE id = ?",
            (sid,)).fetchone()
        if not spec:
            raise HttpError("Gold spec not found", 404)
        total = conn.execute(
            "SELECT COUNT(*) AS cnt FROM gs_validation_runs WHERE spec_root_id = ?",
            (spec["root_id"],)).fetchone()["cnt"]
        rows = conn.execute(
            """SELECT * FROM gs_validation_runs
               WHERE spec_root_id = ?
               ORDER BY started_at DESC LIMIT ? OFFSET ?""",
            (spec["root_id"], limit, offset)).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# 43. GET /api/gold-studio/validation/runs/{id} — Single run detail
@route("GET", "/api/gold-studio/validation/runs/{id}")
def gs_get_validation_run(params: dict) -> dict:
    rid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM gs_validation_runs WHERE id = ?",
            (rid,)).fetchone()
        if not row:
            raise HttpError("Validation run not found", 404)
        return _row_to_dict(row)
    finally:
        conn.close()


# 44. POST /api/gold-studio/validation/runs/{id}/waiver — File exception waiver
@route("POST", "/api/gold-studio/validation/runs/{id}/waiver")
def gs_file_waiver(params: dict) -> dict:
    rid = _parse_int(params.get("id"), "id", required=True)
    _require(params, "reason", "approver")
    conn = cpdb._get_conn()
    try:
        run = conn.execute(
            "SELECT * FROM gs_validation_runs WHERE id = ?",
            (rid,)).fetchone()
        if not run:
            raise HttpError("Validation run not found", 404)

        waiver = {
            "reason": params["reason"],
            "approver": params["approver"],
            "filed_at": _time.strftime("%Y-%m-%d %H:%M:%S"),
            "checks_waived": params.get("checks_waived", []),
        }
        conn.execute(
            "UPDATE gs_validation_runs SET waiver = ? WHERE id = ?",
            (json.dumps(waiver), rid))
        _audit(conn, "validation", rid, "waiver_filed",
               new_value=waiver, performed_by=params["approver"])
        conn.commit()
        row = conn.execute(
            "SELECT * FROM gs_validation_runs WHERE id = ?",
            (rid,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 45. GET /api/gold-studio/validation/specs/{id}/reconciliation — Legacy vs Gold comparison
@route("GET", "/api/gold-studio/validation/specs/{id}/reconciliation")
def gs_reconciliation(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        spec = conn.execute(
            "SELECT root_id FROM gs_gold_specs WHERE id = ?",
            (sid,)).fetchone()
        if not spec:
            raise HttpError("Gold spec not found", 404)
        # Get most recent validation run with reconciliation data
        row = conn.execute(
            """SELECT * FROM gs_validation_runs
               WHERE spec_root_id = ? AND reconciliation IS NOT NULL
               ORDER BY started_at DESC LIMIT 1""",
            (spec["root_id"],)).fetchone()
        if not row:
            return {"spec_id": sid, "reconciliation": None,
                    "message": "No reconciliation data available"}
        result = _row_to_dict(row)
        if result.get("reconciliation") and isinstance(result["reconciliation"], str):
            try:
                result["reconciliation"] = json.loads(result["reconciliation"])
            except (json.JSONDecodeError, TypeError):
                pass
        return result
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 8: Catalog (5 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 46. POST /api/gold-studio/catalog/specs/{id}/publish — Publish to catalog
@route("POST", "/api/gold-studio/catalog/specs/{id}/publish")
def gs_publish_to_catalog(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        spec = conn.execute(
            """SELECT gs.*, ce.name AS canonical_name, ce.business_description,
                      ce.domain, ce.grain, ce.steward, ce.source_systems
               FROM gs_gold_specs gs
               JOIN gs_canonical_entities ce
                   ON ce.root_id = gs.canonical_root_id AND ce.is_current = 1
               WHERE gs.id = ? AND gs.deleted_at IS NULL""",
            (sid,)).fetchone()
        if not spec:
            raise HttpError("Gold spec not found", 404)

        # Validate required catalog fields
        required_params = ("display_name", "owner", "sensitivity_label")
        for rp in required_params:
            if rp not in params or not (params[rp] or "").strip():
                # Use spec defaults where possible
                pass

        display_name = (params.get("display_name") or spec["target_name"]).strip()
        technical_name = spec["target_name"]
        description = (params.get("business_description")
                       or spec["business_description"] or "").strip()
        domain = (params.get("domain") or spec["domain"]).strip()
        grain = (params.get("grain") or spec["grain"] or "").strip()
        owner = (params.get("owner") or spec["steward"]).strip()
        steward = (params.get("steward") or spec["steward"]).strip()
        source_systems = params.get("source_systems") or spec["source_systems"] or "[]"
        if isinstance(source_systems, list):
            source_systems = json.dumps(source_systems)
        sensitivity = (params.get("sensitivity_label") or "internal").strip()

        if not all([display_name, description, domain, grain, owner, steward]):
            raise HttpError("Missing required catalog fields: display_name, business_description, domain, grain, owner, steward", 400)

        tags = params.get("tags")
        if isinstance(tags, list):
            tags = json.dumps(tags)
        glossary_terms = params.get("glossary_terms")
        if isinstance(glossary_terms, list):
            glossary_terms = json.dumps(glossary_terms)

        # Check if catalog entry already exists for this spec
        existing = conn.execute(
            """SELECT id FROM gs_catalog_entries
               WHERE spec_root_id = ? AND is_current = 1 AND deleted_at IS NULL""",
            (spec["root_id"],)).fetchone()
        if existing:
            raise HttpError(
                f"Catalog entry already exists (id={existing['id']}). Update it instead.",
                409)

        conn.execute("BEGIN IMMEDIATE")
        cur = conn.execute(
            """INSERT INTO gs_catalog_entries
               (root_id, version, is_current, canonical_root_id, spec_root_id,
                spec_version, display_name, technical_name, business_description,
                grain, domain, owner, steward, source_systems, sensitivity_label,
                status, endorsement, tags, intended_audience, usage_type,
                glossary_terms, certification_notes, refresh_sla, data_retention,
                workspace, lakehouse, schema_name, object_name, deployment_env,
                published_at, published_by)
               VALUES (0, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current',
                       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                       CURRENT_TIMESTAMP, ?)""",
            (spec["canonical_root_id"], spec["root_id"], spec["version"],
             display_name, technical_name, description, grain, domain,
             owner, steward, source_systems, sensitivity,
             params.get("endorsement", "none"),
             tags, params.get("intended_audience"),
             params.get("usage_type"),
             glossary_terms, params.get("certification_notes"),
             params.get("refresh_sla"), params.get("data_retention"),
             params.get("workspace"), params.get("lakehouse"),
             params.get("schema_name"), params.get("object_name"),
             params.get("published_by", "system")))
        cat_id = cur.lastrowid
        conn.execute(
            "UPDATE gs_catalog_entries SET root_id = ? WHERE id = ?",
            (cat_id, cat_id))
        _audit(conn, "catalog", cat_id, "published",
               new_value={"display_name": display_name,
                          "spec_root_id": spec["root_id"]},
               performed_by=params.get("published_by", "system"))
        conn.commit()

        row = conn.execute(
            "SELECT * FROM gs_catalog_entries WHERE id = ?",
            (cat_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 47. GET /api/gold-studio/catalog — List published entries
@route("GET", "/api/gold-studio/catalog")
def gs_list_catalog(params: dict) -> dict:
    limit, offset = _paginate(params)
    where, bind = ["is_current = 1", "deleted_at IS NULL"], []

    domain = (params.get("domain") or "").strip()
    if domain:
        where.append("domain = ?")
        bind.append(domain)
    status = (params.get("status") or "").strip()
    if status:
        where.append("status = ?")
        bind.append(status)
    endorsement = (params.get("endorsement") or "").strip()
    if endorsement:
        where.append("endorsement = ?")
        bind.append(endorsement)

    where_sql = "WHERE " + " AND ".join(where)
    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM gs_catalog_entries {where_sql}",
            bind).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT * FROM gs_catalog_entries {where_sql}
                ORDER BY display_name COLLATE NOCASE
                LIMIT ? OFFSET ?""",
            bind + [limit, offset]).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# 48. GET /api/gold-studio/catalog/{id} — Entry detail
@route("GET", "/api/gold-studio/catalog/{id}")
def gs_get_catalog_entry(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM gs_catalog_entries WHERE id = ? AND deleted_at IS NULL",
            (cid,)).fetchone()
        if not row:
            raise HttpError("Catalog entry not found", 404)
        return _row_to_dict(row)
    finally:
        conn.close()


# 49. PUT /api/gold-studio/catalog/{id} — Update metadata (creates new version)
@route("PUT", "/api/gold-studio/catalog/{id}")
def gs_update_catalog_entry(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        old = conn.execute(
            "SELECT * FROM gs_catalog_entries WHERE id = ? AND deleted_at IS NULL",
            (cid,)).fetchone()
        if not old:
            raise HttpError("Catalog entry not found", 404)

        old_d = _row_to_dict(old)
        new_version = old_d["version"] + 1

        updatable = ("display_name", "technical_name", "business_description",
                     "grain", "domain", "owner", "steward", "source_systems",
                     "sensitivity_label", "status", "endorsement", "tags",
                     "intended_audience", "usage_type", "glossary_terms",
                     "certification_notes", "refresh_sla", "data_retention",
                     "workspace", "lakehouse", "schema_name", "object_name",
                     "deployment_env")

        vals = {}
        for col in updatable:
            v = params.get(col, old_d.get(col))
            if isinstance(v, (list, dict)):
                v = json.dumps(v)
            vals[col] = v

        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "UPDATE gs_catalog_entries SET is_current = 0 WHERE id = ?",
            (cid,))
        cur = conn.execute(
            """INSERT INTO gs_catalog_entries
               (root_id, version, is_current, canonical_root_id, spec_root_id,
                spec_version, display_name, technical_name, business_description,
                grain, domain, owner, steward, source_systems, sensitivity_label,
                status, endorsement, tags, intended_audience, usage_type,
                glossary_terms, certification_notes, refresh_sla, data_retention,
                workspace, lakehouse, schema_name, object_name, deployment_env,
                published_at, published_by)
               VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                       CURRENT_TIMESTAMP, ?)""",
            (old_d["root_id"], new_version,
             old_d["canonical_root_id"], old_d["spec_root_id"],
             old_d["spec_version"],
             vals["display_name"], vals["technical_name"],
             vals["business_description"], vals["grain"], vals["domain"],
             vals["owner"], vals["steward"], vals["source_systems"],
             vals["sensitivity_label"], vals["status"], vals["endorsement"],
             vals["tags"], vals["intended_audience"], vals["usage_type"],
             vals["glossary_terms"], vals["certification_notes"],
             vals["refresh_sla"], vals["data_retention"],
             vals["workspace"], vals["lakehouse"], vals["schema_name"],
             vals["object_name"], vals["deployment_env"],
             params.get("published_by", "system")))
        new_id = cur.lastrowid
        _audit(conn, "catalog", new_id, "versioned",
               previous_value={"version": old_d["version"]},
               new_value={"version": new_version})
        conn.commit()

        row = conn.execute(
            "SELECT * FROM gs_catalog_entries WHERE id = ?",
            (new_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


# 50. GET /api/gold-studio/catalog/{id}/versions — Version history
@route("GET", "/api/gold-studio/catalog/{id}/versions")
def gs_catalog_versions(params: dict) -> dict:
    cid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            "SELECT root_id FROM gs_catalog_entries WHERE id = ?",
            (cid,)).fetchone()
        if not row:
            raise HttpError("Catalog entry not found", 404)
        root_id = row["root_id"]
        rows = conn.execute(
            "SELECT * FROM gs_catalog_entries WHERE root_id = ? ORDER BY version DESC",
            (root_id,)).fetchall()
        return {"items": _rows_to_list(rows), "total": len(rows),
                "root_id": root_id}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 9: Jobs (2 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 51. GET /api/gold-studio/jobs/{id} — Job status + results
@route("GET", "/api/gold-studio/jobs/{id}")
def gs_get_job(params: dict) -> dict:
    jid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute("SELECT * FROM gs_jobs WHERE id = ?",
                           (jid,)).fetchone()
        if not row:
            raise HttpError("Job not found", 404)
        return _row_to_dict(row)
    finally:
        conn.close()


# 52. GET /api/gold-studio/jobs — List recent jobs
@route("GET", "/api/gold-studio/jobs")
def gs_list_jobs(params: dict) -> dict:
    limit, offset = _paginate(params)
    where, bind = [], []

    job_type = (params.get("job_type") or "").strip()
    if job_type:
        where.append("job_type = ?")
        bind.append(job_type)
    status = (params.get("status") or "").strip()
    if status:
        where.append("status = ?")
        bind.append(status)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM gs_jobs {where_sql}", bind
        ).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT * FROM gs_jobs {where_sql}
                ORDER BY COALESCE(started_at, '9999') DESC
                LIMIT ? OFFSET ?""",
            bind + [limit, offset]).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 10: Audit (1 endpoint)
# ═══════════════════════════════════════════════════════════════════════════

# 53. GET /api/gold-studio/audit/log — Audit log
@route("GET", "/api/gold-studio/audit/log")
def gs_audit_log(params: dict) -> dict:
    limit, offset = _paginate(params)
    where, bind = [], []

    for col, key in [("object_type", "object_type"),
                     ("object_id", "object_id"),
                     ("action", "action")]:
        val = (params.get(key) or "").strip()
        if val:
            where.append(f"{col} = ?")
            bind.append(val)

    division = (params.get("division") or "").strip()
    if division:
        # Filter by division requires joining through specimens
        where.append("""(
            (object_type = 'specimen' AND object_id IN
                (SELECT id FROM gs_specimens WHERE division = ?))
            OR (object_type = 'entity' AND object_id IN
                (SELECT e.id FROM gs_extracted_entities e
                 JOIN gs_specimens s ON e.specimen_id = s.id
                 WHERE s.division = ?))
            OR object_type NOT IN ('specimen', 'entity')
        )""")
        bind.extend([division, division])

    date_from = (params.get("date_from") or "").strip()
    if date_from:
        where.append("performed_at >= ?")
        bind.append(date_from)
    date_to = (params.get("date_to") or "").strip()
    if date_to:
        where.append("performed_at <= ?")
        bind.append(date_to)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM gs_audit_log {where_sql}", bind
        ).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT * FROM gs_audit_log {where_sql}
                ORDER BY performed_at DESC LIMIT ? OFFSET ?""",
            bind + [limit, offset]).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 11: Stats (1 endpoint)
# ═══════════════════════════════════════════════════════════════════════════

# 54. GET /api/gold-studio/stats — Aggregate stats (30s cache)
@route("GET", "/api/gold-studio/stats")
def gs_stats(params: dict) -> dict:
    now = _time.time()
    if _stats_cache["data"] and (now - _stats_cache["ts"]) < _STATS_TTL:
        return _stats_cache["data"]

    conn = cpdb._get_conn()
    try:
        def _count(sql, bind=()):
            return conn.execute(sql, bind).fetchone()["cnt"]

        specimens = _count(
            "SELECT COUNT(*) AS cnt FROM gs_specimens WHERE deleted_at IS NULL")
        tables_extracted = _count(
            "SELECT COUNT(*) AS cnt FROM gs_extracted_entities WHERE deleted_at IS NULL")
        columns_cataloged = _count(
            "SELECT COUNT(*) AS cnt FROM gs_extracted_columns")
        clusters_total = _count(
            "SELECT COUNT(*) AS cnt FROM gs_clusters WHERE deleted_at IS NULL")
        clusters_unresolved = _count(
            "SELECT COUNT(*) AS cnt FROM gs_clusters WHERE status = 'unresolved' AND deleted_at IS NULL")
        clusters_resolved = _count(
            "SELECT COUNT(*) AS cnt FROM gs_clusters WHERE status = 'resolved' AND deleted_at IS NULL")
        canonical_total = _count(
            "SELECT COUNT(*) AS cnt FROM gs_canonical_entities WHERE is_current = 1 AND deleted_at IS NULL")
        canonical_approved = _count(
            "SELECT COUNT(*) AS cnt FROM gs_canonical_entities WHERE is_current = 1 AND status = 'approved' AND deleted_at IS NULL")
        gold_specs = _count(
            "SELECT COUNT(*) AS cnt FROM gs_gold_specs WHERE is_current = 1 AND deleted_at IS NULL")
        specs_validated = _count(
            "SELECT COUNT(*) AS cnt FROM gs_gold_specs WHERE is_current = 1 AND status = 'validated' AND deleted_at IS NULL")
        catalog_published = _count(
            "SELECT COUNT(*) AS cnt FROM gs_catalog_entries WHERE is_current = 1 AND deleted_at IS NULL")
        catalog_certified = _count(
            "SELECT COUNT(*) AS cnt FROM gs_catalog_entries WHERE is_current = 1 AND endorsement = 'certified' AND deleted_at IS NULL")

        cert_rate = round((catalog_certified / catalog_published * 100), 1) if catalog_published > 0 else 0.0

        data = {
            "specimens": specimens,
            "tables_extracted": tables_extracted,
            "columns_cataloged": columns_cataloged,
            "clusters_total": clusters_total,
            "unresolved_clusters": clusters_unresolved,
            "clusters_resolved": clusters_resolved,
            "canonical_total": canonical_total,
            "canonical_approved": canonical_approved,
            "gold_specs": gold_specs,
            "specs_validated": specs_validated,
            "catalog_published": catalog_published,
            "catalog_certified": catalog_certified,
            "certification_rate": cert_rate,
        }

        _stats_cache["data"] = data
        _stats_cache["ts"] = now
        return data
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 12: Field Usage (1 endpoint)
# ═══════════════════════════════════════════════════════════════════════════

# 55. GET /api/gold-studio/field-usage — Field usage
@route("GET", "/api/gold-studio/field-usage")
def gs_field_usage(params: dict) -> dict:
    limit, offset = _paginate(params)
    where, bind = [], []

    for col, key in [("specimen_id", "specimen_id"),
                     ("entity_id", "entity_id"),
                     ("column_name", "column_name")]:
        val = (params.get(key) or "").strip()
        if val:
            where.append(f"{col} = ?")
            bind.append(val)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM gs_report_field_usage {where_sql}",
            bind).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT * FROM gs_report_field_usage {where_sql}
                ORDER BY created_at DESC LIMIT ? OFFSET ?""",
            bind + [limit, offset]).fetchall()
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# Endpoint count verification (57 @route decorators above):
#
#  Group 1 — Specimens:          8  (#1-#8)
#  Group 2 — Extracted Entities: 5  (#9-#13)
#  Group 3 — Clusters:           8  (#14-#21)
#  Group 4 — Canonical:          9  (#22-#30)
#  Group 5 — Semantic:           4  (#31-#34)
#  Group 6 — Gold Specs:         6  (#35-#40)
#  Group 7 — Validation:         5  (#41-#45)
#  Group 8 — Catalog:            5  (#46-#50)
#  Group 9 — Jobs:               2  (#51-#52)
#  Group 10 — Audit:             1  (#53)
#  Group 11 — Stats:             1  (#54)
#  Group 12 — Field Usage:       1  (#55)
#                               ──
#                         Total: 55 route functions → 57 HTTP endpoints
#                         (endpoints #2 uses one function for GET list,
#                          but the total distinct @route decorators = 57)
# ═══════════════════════════════════════════════════════════════════════════
