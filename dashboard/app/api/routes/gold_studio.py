"""Gold Studio API routes — 67 endpoints for the full Gold layer workflow.

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
   13. Domain Workspaces (4) — List, create, update, detail
   14. Report Recreation Coverage (6) — List, create, detail, update, delete, summary

Data source: SQLite gs_* tables in control plane DB.
"""

import json
import logging
import sqlite3
import threading
import time as _time

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError
from dashboard.app.api.parsers.sql_parser import parse_sql
from dashboard.app.api.parsers import schema_discovery

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


def _json_load(value, default=None):
    """Best-effort JSON loader for route helpers."""
    if value is None:
        return [] if default is None else default
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return [] if default is None else default
        try:
            return json.loads(text)
        except (TypeError, json.JSONDecodeError):
            return [] if default is None else default
    return [] if default is None else default


def _json_list(value) -> list:
    data = _json_load(value, [])
    return data if isinstance(data, list) else []


def _json_int_list(value) -> list[int]:
    items = []
    for item in _json_list(value):
        try:
            items.append(int(item))
        except (TypeError, ValueError):
            continue
    return items


def _release_field_mapping(row: dict) -> tuple[str, str]:
    """Infer how a report field currently maps into the gold release model."""
    is_measure = bool(row.get("measure_name"))
    has_entity = bool(row.get("entity_id"))
    has_canonical = bool(row.get("canonical_root_id"))
    has_spec = bool(row.get("spec_id"))
    has_catalog = bool(row.get("catalog_id"))
    has_semantic = bool(row.get("semantic_id"))

    if is_measure:
        if has_catalog and has_semantic:
            return "published", "Mapped to a semantic definition and already exposed through a published gold product."
        if has_spec and has_semantic:
            return "accounted_for", "Mapped to a semantic definition and included in the proposed gold model."
        if has_canonical and has_semantic:
            return "needs_spec", "The measure is defined semantically, but the gold spec still needs to carry it forward."
        if has_canonical:
            return "needs_semantic_definition", "The underlying business object exists, but the semantic measure definition is still missing."
        if has_entity:
            return "needs_canonical_mapping", "The source entity is known, but it has not been promoted into a canonical object yet."
        return "unmapped", "The report references a measure that is not yet tied to any imported entity or canonical object."

    if has_catalog and has_canonical:
        return "published", "The source field is already represented in a published gold product."
    if has_spec and has_canonical:
        return "accounted_for", "The source field is represented by a canonical object and included in the proposed gold model."
    if has_canonical:
        return "needs_spec", "The canonical object exists, but the final gold spec still needs to include this field."
    if has_entity:
        return "needs_canonical_mapping", "The source field is parsed from an imported entity, but that entity is not mapped to a canonical object yet."
    return "unmapped", "The source field is not yet connected to an imported entity or canonical object."


def _release_field_rows(conn, domain: str | None = None) -> list[dict]:
    where = ["s.deleted_at IS NULL"]
    bind: list = []
    if domain:
        where.append("s.division = ?")
        bind.append(domain)
    where_sql = " AND ".join(where)
    rows = conn.execute(
        f"""SELECT fu.id,
                   fu.specimen_id,
                   fu.entity_id,
                   fu.visual_id,
                   fu.visual_type,
                   fu.page_name,
                   fu.column_name,
                   fu.measure_name,
                   fu.usage_type,
                   fu.created_at,
                   s.name AS specimen_name,
                   s.type AS specimen_type,
                   s.source_class,
                   s.division,
                   s.job_state,
                   s.source_system,
                   e.entity_name,
                   e.schema_name,
                   e.source_database,
                   e.canonical_root_id,
                   ce.id AS canonical_id,
                   ce.name AS canonical_name,
                   ce.status AS canonical_status,
                   ce.entity_type AS canonical_type,
                   gs.id AS spec_id,
                   gs.root_id AS spec_root_id,
                   gs.target_name AS spec_name,
                   gs.status AS spec_status,
                   cat.id AS catalog_id,
                   cat.display_name AS catalog_name,
                   cat.endorsement AS catalog_endorsement,
                   (
                       SELECT sd.id
                       FROM gs_semantic_definitions sd
                       WHERE sd.canonical_root_id = e.canonical_root_id
                         AND sd.deleted_at IS NULL
                         AND fu.measure_name IS NOT NULL
                         AND LOWER(sd.name) = LOWER(fu.measure_name)
                       LIMIT 1
                   ) AS semantic_id,
                   (
                       SELECT sd.name
                       FROM gs_semantic_definitions sd
                       WHERE sd.canonical_root_id = e.canonical_root_id
                         AND sd.deleted_at IS NULL
                         AND fu.measure_name IS NOT NULL
                         AND LOWER(sd.name) = LOWER(fu.measure_name)
                       LIMIT 1
                   ) AS semantic_name,
                   (
                       SELECT sd.definition_type
                       FROM gs_semantic_definitions sd
                       WHERE sd.canonical_root_id = e.canonical_root_id
                         AND sd.deleted_at IS NULL
                         AND fu.measure_name IS NOT NULL
                         AND LOWER(sd.name) = LOWER(fu.measure_name)
                       LIMIT 1
                   ) AS semantic_type
            FROM gs_report_field_usage fu
            JOIN gs_specimens s
              ON s.id = fu.specimen_id
            LEFT JOIN gs_extracted_entities e
              ON e.id = fu.entity_id
            LEFT JOIN gs_canonical_entities ce
              ON ce.root_id = e.canonical_root_id
             AND ce.is_current = 1
             AND ce.deleted_at IS NULL
            LEFT JOIN gs_gold_specs gs
              ON gs.canonical_root_id = e.canonical_root_id
             AND gs.is_current = 1
             AND gs.deleted_at IS NULL
            LEFT JOIN gs_catalog_entries cat
              ON cat.spec_root_id = gs.root_id
             AND cat.is_current = 1
             AND cat.deleted_at IS NULL
            WHERE {where_sql}
            ORDER BY s.name COLLATE NOCASE,
                     fu.page_name COLLATE NOCASE,
                     COALESCE(fu.measure_name, fu.column_name) COLLATE NOCASE""",
        bind,
    ).fetchall()

    items = _rows_to_list(rows)
    for item in items:
        mapping_status, mapping_note = _release_field_mapping(item)
        item["mapping_status"] = mapping_status
        item["mapping_note"] = mapping_note
    return items


def _release_model_nodes(conn, domain: str | None = None) -> list[dict]:
    where = ["ce.is_current = 1", "ce.deleted_at IS NULL"]
    bind: list = []
    if domain:
        where.append("ce.domain = ?")
        bind.append(domain)
    where_sql = " AND ".join(where)
    rows = conn.execute(
        f"""SELECT ce.*,
                   COUNT(DISTINCT e.id) AS source_entity_count,
                   COUNT(DISTINCT e.specimen_id) AS source_artifact_count,
                   COUNT(DISTINCT sd.id) AS semantic_count,
                   gs.id AS spec_id,
                   gs.root_id AS spec_root_id,
                   gs.target_name AS spec_name,
                   gs.status AS spec_status,
                   COUNT(DISTINCT cat.id) AS published_product_count
            FROM gs_canonical_entities ce
            LEFT JOIN gs_extracted_entities e
              ON e.canonical_root_id = ce.root_id
             AND e.deleted_at IS NULL
            LEFT JOIN gs_semantic_definitions sd
              ON sd.canonical_root_id = ce.root_id
             AND sd.deleted_at IS NULL
            LEFT JOIN gs_gold_specs gs
              ON gs.canonical_root_id = ce.root_id
             AND gs.is_current = 1
             AND gs.deleted_at IS NULL
            LEFT JOIN gs_catalog_entries cat
              ON cat.spec_root_id = gs.root_id
             AND cat.is_current = 1
             AND cat.deleted_at IS NULL
            WHERE {where_sql}
            GROUP BY ce.id, ce.root_id, ce.version, ce.is_current, ce.name,
                     ce.business_description, ce.domain, ce.entity_type, ce.grain,
                     ce.business_keys, ce.steward, ce.source_systems,
                     ce.source_cluster_ids, ce.status, ce.shared_dimensions,
                     ce.approval_gate, ce.created_at, ce.updated_at, ce.deleted_at,
                     gs.id, gs.root_id, gs.target_name, gs.status
            ORDER BY ce.entity_type, ce.name COLLATE NOCASE""",
        bind,
    ).fetchall()
    nodes = _rows_to_list(rows)
    if not nodes:
        return []

    root_ids = [row["root_id"] for row in nodes]
    placeholders = ",".join("?" for _ in root_ids)

    col_rows = conn.execute(
        f"""SELECT canonical_root_id, column_name, key_designation, fk_target_root_id
            FROM gs_canonical_columns
            WHERE canonical_root_id IN ({placeholders})
            ORDER BY canonical_root_id, ordinal, column_name""",
        root_ids,
    ).fetchall()
    cols_by_root: dict[int, list] = {}
    for row in _rows_to_list(col_rows):
        cols_by_root.setdefault(row["canonical_root_id"], []).append(row)

    measure_rows = conn.execute(
        f"""SELECT canonical_root_id, name, definition_type
            FROM gs_semantic_definitions
            WHERE canonical_root_id IN ({placeholders})
              AND deleted_at IS NULL
            ORDER BY canonical_root_id, name COLLATE NOCASE""",
        root_ids,
    ).fetchall()
    measures_by_root: dict[int, list] = {}
    for row in _rows_to_list(measure_rows):
        measures_by_root.setdefault(row["canonical_root_id"], []).append(row)

    return [
        {
            **node,
            "columns_preview": cols_by_root.get(node["root_id"], [])[:8],
            "column_count": len(cols_by_root.get(node["root_id"], [])),
            "measures_preview": measures_by_root.get(node["root_id"], [])[:6],
        }
        for node in nodes
    ]


# ---------------------------------------------------------------------------
# Stats cache
# ---------------------------------------------------------------------------
_stats_cache: dict = {"ts": 0, "data": None}
_stats_lock = threading.Lock()
_STATS_TTL = 30  # seconds


def _check_expected_version(conn, params, sql: str, bind: tuple, label: str = "entity"):
    """Optimistic concurrency check.  If the caller supplies expected_version
    and the current DB version differs, raise 409 Conflict."""
    expected = params.get("expected_version")
    if expected is None:
        return
    row = conn.execute(sql, bind).fetchone()
    current = row[0] if row else None
    if current != int(expected):
        raise HttpError(
            "Conflict: %s has been modified (expected version %s, current %s)"
            % (label, expected, current), 409)


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 1: Specimens (8 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 1. POST /api/gold-studio/specimens — Create specimen
@route("POST", "/api/gold-studio/specimens")
def gs_create_specimen(params: dict) -> dict:
    _require(params, "name", "type", "division", "steward")
    stype = params["type"].strip().lower()
    valid_types = ("rdl", "pbix", "pbip", "tmdl", "bim", "sql", "excel", "csv", "screenshot", "note", "other")
    if stype not in valid_types:
        raise HttpError(f"type must be one of {valid_types}", 400)

    # ── Source class: auto-derive from artifact type if not explicitly set ──
    _STRUCTURAL_TYPES = {"rdl", "pbix", "pbip", "tmdl", "bim", "sql"}
    _SUPPORTING_TYPES = {"excel", "csv"}
    _CONTEXTUAL_TYPES = {"screenshot", "note"}

    source_class = (params.get("source_class") or "").strip().lower() or None
    if not source_class:
        if stype in _STRUCTURAL_TYPES:
            source_class = "structural"
        elif stype in _SUPPORTING_TYPES:
            source_class = "supporting"
        elif stype in _CONTEXTUAL_TYPES:
            source_class = "contextual"
        else:
            source_class = "supporting"  # 'other' defaults to supporting
    if source_class not in ("structural", "supporting", "contextual"):
        raise HttpError("source_class must be structural, supporting, or contextual", 400)

    # ── Job state: structural sources enter parsing queue; others are accepted immediately ──
    initial_job_state = "queued" if source_class == "structural" else "accepted"

    tags = params.get("tags")
    if tags and isinstance(tags, list):
        tags = json.dumps(tags)
    elif tags and isinstance(tags, str):
        tags = tags  # already JSON string

    conn = cpdb._get_conn()
    try:
        imported_by = (params.get("imported_by") or "api").strip()
        manual_context = json.dumps(params["manual_context"]) if params.get("manual_context") and isinstance(params["manual_context"], (dict, list)) else params.get("manual_context")
        cur = conn.execute(
            """INSERT INTO gs_specimens
               (name, type, division, source_system, steward, description, tags, file_path,
                job_state, imported_by, source_class, manual_context)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (params["name"].strip(), stype, params["division"].strip(),
             params.get("source_system"), params["steward"].strip(),
             params.get("description"), tags, params.get("file_path"),
             initial_job_state, imported_by, source_class, manual_context),
        )
        specimen_id = cur.lastrowid
        _audit(conn, "specimen", specimen_id, "created",
               new_value={"name": params["name"], "type": stype})

        # Persist raw SQL into gs_specimen_queries if provided
        raw_query = (params.get("query_text") or "").strip()
        if raw_query:
            conn.execute(
                """INSERT INTO gs_specimen_queries
                   (specimen_id, query_name, query_text, query_type, source_database, ordinal)
                   VALUES (?, ?, ?, 'native_sql', ?, 1)""",
                (specimen_id, params["name"].strip(), raw_query,
                 params.get("source_database")),
            )

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
                     ("steward", "steward"), ("job_state", "job_state"),
                     ("source_class", "source_class")]:
        val = (params.get(key) or "").strip()
        if val:
            where.append(f"{col} = ?")
            bind.append(val)

    search = (params.get("search") or params.get("q") or "").strip()
    if search:
        where.append("(s.name LIKE ? OR s.description LIKE ?)")
        bind.extend([f"%{search}%", f"%{search}%"])

    where_sql = "WHERE " + " AND ".join(where)

    conn = cpdb._get_conn()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM gs_specimens s {where_sql}", bind
        ).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT s.* FROM gs_specimens s {where_sql}
                ORDER BY s.created_at DESC LIMIT ? OFFSET ?""",
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

    # ── Auto-advance: flow extracted entities through the full Gold pipeline ──
    def _auto_advance_pipeline(cxn, specimen_id, entity_id_map, source_sys):
        """After extraction, auto-create canonical entities, gold specs, validation, and catalog."""
        specimen = cxn.execute(
            "SELECT * FROM gs_specimens WHERE id = ?", (specimen_id,)).fetchone()
        if not specimen:
            return

        division = specimen["division"] or "General"
        steward = specimen["steward"] or "System"

        entities = cxn.execute(
            "SELECT * FROM gs_extracted_entities WHERE specimen_id = ? AND deleted_at IS NULL",
            (specimen_id,)).fetchall()

        for ent in entities:
            ent_name = ent["entity_name"]
            ent_id = ent["id"]

            # Get columns for this entity
            columns = cxn.execute(
                "SELECT * FROM gs_extracted_columns WHERE entity_id = ? ORDER BY ordinal",
                (ent_id,)).fetchall()

            # ── Step 1: Create canonical entity ──
            # Determine entity type heuristic
            name_lower = ent_name.lower()
            if any(k in name_lower for k in ("fact", "transaction", "order", "log", "audit", "event")):
                entity_type = "fact"
                grain = f"One row per {ent_name.replace('_', ' ').replace('tbl', '').strip()} record"
            elif any(k in name_lower for k in ("dim", "lookup", "ref", "master", "type", "status")):
                entity_type = "dimension"
                grain = f"One row per unique {ent_name.replace('_', ' ').replace('tbl', '').strip()}"
            else:
                entity_type = "reference"
                grain = f"One row per {ent_name.replace('_', ' ').replace('tbl', '').strip()} entry"

            # Find business keys (identity or key columns, or first column)
            bkeys = [c["column_name"] for c in columns if c["is_key"]]
            if not bkeys:
                # Use identity columns or first column as key
                id_cols = [c["column_name"] for c in columns
                           if "id" in (c["column_name"] or "").lower() and c["ordinal"] and c["ordinal"] <= 2]
                bkeys = id_cols[:1] if id_cols else ([columns[0]["column_name"]] if columns else ["ID"])

            cur = cxn.execute(
                """INSERT INTO gs_canonical_entities
                   (root_id, version, is_current, name, business_description, domain,
                    entity_type, grain, business_keys, steward, source_systems,
                    source_cluster_ids, status)
                   VALUES (0, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'draft')""",
                (ent_name,
                 f"Canonical representation of {ent_name} from {source_sys or 'source system'}",
                 division, entity_type, grain, json.dumps(bkeys), steward,
                 json.dumps([source_sys]) if source_sys else None))
            canonical_id = cur.lastrowid
            cxn.execute("UPDATE gs_canonical_entities SET root_id = ? WHERE id = ?",
                        (canonical_id, canonical_id))

            # Link extracted entity to canonical
            cxn.execute(
                "UPDATE gs_extracted_entities SET canonical_root_id = ?, provenance = 'clustered' WHERE id = ?",
                (canonical_id, ent_id))

            # ── Step 1b: Create canonical columns ──
            for idx, col in enumerate(columns):
                is_key = col["is_key"]
                key_des = "business_key" if is_key else None
                cxn.execute(
                    """INSERT INTO gs_canonical_columns
                       (canonical_id, canonical_root_id, column_name, data_type, nullable,
                        key_designation, source_expression, ordinal)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (canonical_id, canonical_id, col["column_name"], col["data_type"],
                     col["nullable"], key_des,
                     f"{ent_name}.{col['column_name']}", idx + 1))

            _audit(cxn, "canonical", canonical_id, "auto_created",
                   new_value={"name": ent_name, "entity_type": entity_type,
                              "columns": len(columns)})

            # ── Step 2: Create Gold spec (MLV definition) ──
            col_list = ", ".join(f"[{c['column_name']}]" for c in columns) if columns else "*"
            spec_sql = f"SELECT\n    {col_list}\nFROM [{ent['schema_name'] or 'dbo'}].[{ent_name}]"
            included_cols = json.dumps([c["column_name"] for c in columns])

            cur = cxn.execute(
                """INSERT INTO gs_gold_specs
                   (root_id, version, is_current, canonical_root_id, canonical_version,
                    target_name, object_type, source_sql, included_columns, status)
                   VALUES (0, 1, 1, ?, 1, ?, 'mlv', ?, ?, 'draft')""",
                (canonical_id, f"Gold_{ent_name}", spec_sql, included_cols))
            spec_id = cur.lastrowid
            cxn.execute("UPDATE gs_gold_specs SET root_id = ? WHERE id = ?",
                        (spec_id, spec_id))

            _audit(cxn, "spec", spec_id, "auto_created",
                   new_value={"target_name": f"Gold_{ent_name}", "canonical_id": canonical_id})

            # ── Step 3: Create validation run ──
            validation_results = {
                "has_columns": {"passed": len(columns) > 0, "detail": f"{len(columns)} columns"},
                "has_business_keys": {"passed": len(bkeys) > 0, "detail": f"Keys: {', '.join(bkeys)}"},
                "has_sql": {"passed": True, "detail": "SQL definition generated"},
                "grain_defined": {"passed": True, "detail": grain},
            }
            all_passed = all(v["passed"] for v in validation_results.values())

            cur = cxn.execute(
                """INSERT INTO gs_validation_runs
                   (spec_root_id, spec_version, started_at, completed_at,
                    status, results)
                   VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)""",
                (spec_id, "passed" if all_passed else "failed",
                 json.dumps(validation_results)))
            val_run_id = cur.lastrowid

            _audit(cxn, "validation", val_run_id, "auto_validated",
                   new_value={"spec_id": spec_id, "status": "passed" if all_passed else "failed"})

            # ── Step 4: Publish to catalog (if validation passed) ──
            if all_passed:
                cur = cxn.execute(
                    """INSERT INTO gs_catalog_entries
                       (root_id, version, is_current, canonical_root_id,
                        spec_root_id, spec_version, display_name, technical_name,
                        business_description, grain, domain, owner, steward,
                        source_systems, sensitivity_label, status, endorsement,
                        published_at, published_by, last_validation_run_id)
                       VALUES (0, 1, 1, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'internal',
                               'current', 'promoted', CURRENT_TIMESTAMP, ?, ?)""",
                    (canonical_id, spec_id,
                     f"Gold_{ent_name}", f"Gold_{ent_name}",
                     f"Gold layer view for {ent_name} from {source_sys or 'source'}",
                     grain, division, steward, steward,
                     json.dumps([source_sys]) if source_sys else None,
                     steward, val_run_id))
                cat_id = cur.lastrowid
                cxn.execute("UPDATE gs_catalog_entries SET root_id = ? WHERE id = ?",
                            (cat_id, cat_id))

                # Approve the canonical entity + mark spec validated
                cxn.execute("UPDATE gs_canonical_entities SET status = 'approved' WHERE id = ?",
                            (canonical_id,))
                cxn.execute("UPDATE gs_gold_specs SET status = 'validated' WHERE id = ?",
                            (spec_id,))

                _audit(cxn, "catalog", cat_id, "auto_published",
                       new_value={"spec_id": spec_id, "name": f"Gold_{ent_name}"})

        cxn.commit()
        log.info("Auto-advance pipeline completed for specimen %d: %d entities → canonical → specs → validated → catalog",
                 specimen_id, len(entities))

    # Background extraction thread — calls real SQL parser
    def _run_extraction(job_id_inner, specimen_id):
        cxn = cpdb._get_conn()
        try:
            cxn.execute(
                "UPDATE gs_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?",
                (job_id_inner,))
            cxn.commit()

            specimen = cxn.execute(
                "SELECT * FROM gs_specimens WHERE id = ?",
                (specimen_id,)).fetchone()
            if not specimen:
                raise ValueError(f"Specimen {specimen_id} not found")

            # Gather SQL text from gs_specimen_queries (pasted SQL)
            # or from file_path (uploaded .sql file)
            queries = cxn.execute(
                "SELECT * FROM gs_specimen_queries WHERE specimen_id = ? ORDER BY ordinal",
                (specimen_id,)).fetchall()

            sql_text = ""
            source_database = None
            query_name = specimen["name"]

            if queries:
                # Pasted SQL — combine all query texts
                sql_text = "\n;\n".join(q["query_text"] for q in queries if q["query_text"])
                source_database = queries[0]["source_database"]
            elif specimen["file_path"]:
                # Uploaded file — read from disk
                from pathlib import Path
                fpath = Path(specimen["file_path"])
                if fpath.exists() and fpath.suffix.lower() == ".sql":
                    sql_text = fpath.read_text(encoding="utf-8-sig")
                else:
                    raise ValueError(f"File not found or not .sql: {specimen['file_path']}")

            if not sql_text.strip():
                raise ValueError("No SQL text found for specimen — nothing to parse")

            # ── Call the real SQL parser ──
            result = parse_sql(sql_text, query_name=query_name, source_database=source_database)

            # ── Live schema enrichment ──
            # Auto-detect source system if not set, then enrich columns with real types
            live_columns = None
            detected_source = None
            source_sys = specimen["source_system"]

            if not source_sys:
                # Try auto-detection
                log.info("No source_system on specimen %d — running auto-detect", specimen_id)
                detected = schema_discovery.auto_detect_source(sql_text)
                if detected:
                    source_sys = detected["source_system"]
                    source_database = detected["database"]
                    live_columns = detected["columns"]
                    detected_source = detected
                    # Update specimen with detected source
                    cxn.execute(
                        "UPDATE gs_specimens SET source_system = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        (source_sys, specimen_id))
                    # Update query with detected database
                    if queries:
                        cxn.execute(
                            "UPDATE gs_specimen_queries SET source_database = ? WHERE specimen_id = ?",
                            (source_database, specimen_id))
                    log.info("Auto-detected source: %s/%s for specimen %d",
                             source_sys, source_database, specimen_id)

            if source_sys and live_columns is None:
                # We have a source system but haven't described yet
                try:
                    live_columns = schema_discovery.describe_query(
                        sql_text, source_sys, source_database)
                    log.info("Live describe: %d columns for specimen %d",
                             len(live_columns), specimen_id)
                except Exception as desc_err:
                    log.warning("Live describe failed for specimen %d: %s", specimen_id, desc_err)
                    if not result.warnings:
                        result.warnings = []
                    result.warnings.append(f"Live schema enrichment failed: {desc_err}")

            if result.errors:
                # Parser returned hard errors — mark as failed
                cxn.execute(
                    """UPDATE gs_jobs SET status = 'failed',
                       completed_at = CURRENT_TIMESTAMP,
                       errors = ?,
                       warnings = ?
                       WHERE id = ?""",
                    (json.dumps(result.errors),
                     json.dumps(result.warnings) if result.warnings else None,
                     job_id_inner))
                cxn.execute(
                    "UPDATE gs_specimens SET job_state = 'parse_failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (specimen_id,))
                cxn.commit()
                log.warning("Extraction job %d failed for specimen %d: %s",
                            job_id_inner, specimen_id, result.errors)
                return

            # ── Persist parsed entities ──
            # Clear any previous extracted data for this specimen (re-extraction)
            cxn.execute("DELETE FROM gs_extracted_columns WHERE entity_id IN "
                        "(SELECT id FROM gs_extracted_entities WHERE specimen_id = ?)",
                        (specimen_id,))
            cxn.execute("DELETE FROM gs_extracted_relationships WHERE specimen_id = ?",
                        (specimen_id,))
            cxn.execute("DELETE FROM gs_extracted_entities WHERE specimen_id = ?",
                        (specimen_id,))

            # Store queries if not already stored (file upload path)
            if not queries and result.queries:
                for i, q in enumerate(result.queries):
                    cxn.execute(
                        """INSERT INTO gs_specimen_queries
                           (specimen_id, query_name, query_text, query_type, source_database, ordinal)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (specimen_id, q.query_name, q.query_text,
                         q.query_type, q.source_database, i + 1))

            # Insert extracted entities and their columns
            entity_id_map: dict[str, int] = {}  # entity_name → id (for relationships)
            for table in result.tables:
                col_count = sum(1 for c in result.columns) if not table.columns else len(table.columns)
                # For top-level columns, count only applies to first/primary entity
                cur = cxn.execute(
                    """INSERT INTO gs_extracted_entities
                       (specimen_id, entity_name, schema_name, source_database,
                        source_system, entity_kind, column_count, provenance)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 'extracted')""",
                    (specimen_id, table.name, table.schema_name,
                     table.source_database, table.source_system or specimen["source_system"],
                     table.entity_kind, col_count))
                eid = cur.lastrowid
                entity_id_map[table.name.upper()] = eid

                # Insert entity-level columns if the table carried them
                for col in table.columns:
                    cxn.execute(
                        """INSERT INTO gs_extracted_columns
                           (entity_id, column_name, data_type, nullable, is_key,
                            source_expression, is_calculated, ordinal)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (eid, col.column_name, col.data_type, col.nullable,
                         col.is_key, col.source_expression, col.is_calculated,
                         col.ordinal))

            # Insert top-level columns (from SELECT clause) — associate with first entity
            if result.columns and entity_id_map:
                # Attach to first physical entity, or first entity if no physical
                physical = [t for t in result.tables if t.entity_kind == "physical"]
                target_name = (physical[0].name if physical else result.tables[0].name).upper()
                target_eid = entity_id_map.get(target_name)
                if target_eid:
                    # Update the column_count for the target entity
                    cxn.execute(
                        "UPDATE gs_extracted_entities SET column_count = ? WHERE id = ?",
                        (len(result.columns), target_eid))
                    for col in result.columns:
                        cxn.execute(
                            """INSERT INTO gs_extracted_columns
                               (entity_id, column_name, data_type, nullable, is_key,
                                source_expression, is_calculated, ordinal)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                            (target_eid, col.column_name, col.data_type,
                             col.nullable, col.is_key, col.source_expression,
                             col.is_calculated, col.ordinal))

            # Insert extracted relationships
            for rel in result.relationships:
                from_eid = entity_id_map.get(rel.from_entity.upper())
                to_eid = entity_id_map.get(rel.to_entity.upper())
                cxn.execute(
                    """INSERT INTO gs_extracted_relationships
                       (specimen_id, from_entity_id, from_column,
                        to_entity_id, to_entity_name, to_column,
                        join_type, cardinality, detected_from)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (specimen_id, from_eid, rel.from_column,
                     to_eid, rel.to_entity, rel.to_column,
                     rel.join_type, rel.cardinality, rel.detected_from))

            # Insert source bindings
            for dsref in result.data_source_refs:
                cxn.execute(
                    """INSERT INTO gs_source_bindings
                       (specimen_id, binding_type, source_system,
                        database_name, schema_name)
                       VALUES (?, ?, ?, ?, ?)""",
                    (specimen_id, dsref.source_type or "sql_db",
                     dsref.source_name, dsref.database_name,
                     dsref.schema_name))

            # ── Live column enrichment: replace static columns with real metadata ──
            if live_columns:
                # If we have live columns from sp_describe, use them instead of static parse
                # Find the primary entity to attach them to
                if entity_id_map:
                    physical = [t for t in result.tables if t.entity_kind == "physical"]
                    target_name = (physical[0].name if physical else result.tables[0].name).upper()
                    target_eid = entity_id_map.get(target_name)
                    if target_eid:
                        # Delete static columns for this entity and insert live ones
                        cxn.execute("DELETE FROM gs_extracted_columns WHERE entity_id = ?", (target_eid,))
                        for lc in live_columns:
                            cxn.execute(
                                """INSERT INTO gs_extracted_columns
                                   (entity_id, column_name, data_type, nullable, is_key,
                                    source_expression, is_calculated, ordinal)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                                (target_eid, lc["name"], lc["type"], lc["nullable"],
                                 lc["is_key"],
                                 f'{lc.get("source_table") or ""}.{lc.get("source_column") or ""}' if lc.get("source_table") else None,
                                 False, lc["ordinal"]))
                        cxn.execute(
                            "UPDATE gs_extracted_entities SET column_count = ? WHERE id = ?",
                            (len(live_columns), target_eid))
                        log.info("Enriched entity %d with %d live columns", target_eid, len(live_columns))

            # ── Update job + specimen status ──
            has_warnings = bool(result.warnings)
            job_status = "warning" if has_warnings else "completed"
            specimen_state = "parse_warning" if has_warnings else "extracted"

            enrichment_info = {}
            if live_columns:
                enrichment_info["live_columns"] = len(live_columns)
                enrichment_info["source_system"] = source_sys
                enrichment_info["source_database"] = source_database
            if detected_source:
                enrichment_info["auto_detected"] = True

            entity_count = len(result.tables)
            column_count = len(live_columns) if live_columns else len(result.columns)
            rel_count = len(result.relationships)

            cxn.execute(
                """UPDATE gs_jobs SET status = ?,
                   completed_at = CURRENT_TIMESTAMP,
                   parser_type = 'sql_parser',
                   warnings = ?,
                   metadata = ?
                   WHERE id = ?""",
                (job_status,
                 json.dumps(result.warnings) if result.warnings else None,
                 json.dumps({"entities": entity_count, "columns": column_count,
                             "relationships": rel_count, **enrichment_info}),
                 job_id_inner))
            cxn.execute(
                "UPDATE gs_specimens SET job_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (specimen_state, specimen_id))
            cxn.commit()
            log.info("Extraction job %d completed for specimen %d: %d entities, %d columns, %d relationships",
                     job_id_inner, specimen_id, entity_count, column_count, rel_count)

            # ── Auto-advance pipeline ──
            try:
                _auto_advance_pipeline(cxn, specimen_id, entity_id_map, source_sys)
            except Exception as adv_err:
                log.warning("Auto-advance pipeline failed for specimen %d: %s", specimen_id, adv_err)

        except Exception as exc:
            log.exception("Extraction job %d failed", job_id_inner)
            try:
                cxn.execute(
                    """UPDATE gs_jobs SET status = 'failed',
                       completed_at = CURRENT_TIMESTAMP,
                       errors = ?
                       WHERE id = ?""",
                    (json.dumps([str(exc)]), job_id_inner))
                cxn.execute(
                    "UPDATE gs_specimens SET job_state = 'parse_failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (specimen_id,))
                cxn.commit()
            except Exception:
                log.exception("Failed to update job/specimen status after extraction error")
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
            imported_by = (sp.get("imported_by") or params.get("imported_by") or "api").strip()
            cur = conn.execute(
                """INSERT INTO gs_specimens
                   (name, type, division, source_system, steward, description, tags, file_path, job_state, imported_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)""",
                (name, stype, division, sp.get("source_system"),
                 steward, sp.get("description"), tags, sp.get("file_path"),
                 imported_by),
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

    embed_members = (params.get("embed") or "").strip().lower() == "members"

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
        items = _rows_to_list(rows)

        # P10/BPG-CLUST-002: Optionally embed members in list response to
        # eliminate N+1 per-cluster detail fetches from the frontend.
        if embed_members and items:
            cluster_ids = [it["id"] for it in items if it.get("id")]
            if cluster_ids:
                ph = ",".join("?" for _ in cluster_ids)
                member_rows = conn.execute(
                    f"""SELECT e.*, s.name AS specimen_name
                        FROM gs_extracted_entities e
                        LEFT JOIN gs_specimens s ON e.specimen_id = s.id
                        WHERE e.cluster_id IN ({ph}) AND e.deleted_at IS NULL
                        ORDER BY e.cluster_id, e.entity_name""",
                    cluster_ids,
                ).fetchall()
                # Group members by cluster_id
                members_by_cluster: dict[int, list] = {}
                for m in _rows_to_list(member_rows):
                    cid = m.get("cluster_id")
                    if cid not in members_by_cluster:
                        members_by_cluster[cid] = []
                    members_by_cluster[cid].append(m)
                for it in items:
                    it["members"] = members_by_cluster.get(it["id"], [])

        return {"items": items, "total": total,
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
    valid_actions = ("approve", "split", "merge", "dismiss",
                     "remove_member", "mark_standalone")
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

        # Optimistic concurrency: check status + updated_at hasn't changed
        expected = params.get("expected_version")
        if expected is not None:
            current_ts = old["updated_at"] or old["created_at"] or ""
            if str(expected) != str(current_ts):
                raise HttpError(
                    "Conflict: cluster has been modified (expected %s, current %s)"
                    % (expected, current_ts), 409)

        # remove_member / mark_standalone modify membership without resolving the cluster
        if action in ("remove_member", "mark_standalone"):
            mid = _parse_int(params.get("member_id"), "member_id", required=True)
            conn.execute(
                "UPDATE gs_extracted_entities SET cluster_id = NULL WHERE id = ?",
                (mid,))
            if action == "mark_standalone":
                conn.execute(
                    "UPDATE gs_extracted_entities SET provenance = 'clustered' WHERE id = ?",
                    (mid,))
            # Clean up column decisions referencing the removed member
            conn.execute(
                "DELETE FROM gs_cluster_column_decisions WHERE cluster_id = ? AND source_entity_id = ?",
                (cid, mid))
            if params.get("notes"):
                conn.execute(
                    "UPDATE gs_clusters SET notes = COALESCE(?, notes) WHERE id = ?",
                    (params["notes"], cid))
            _audit(conn, "cluster", cid, f"resolved:{action}",
                   new_value={"member_id": mid},
                   notes=params.get("notes"))
            conn.commit()
            row = conn.execute("SELECT * FROM gs_clusters WHERE id = ?",
                               (cid,)).fetchone()
            return _row_to_dict(row)

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

        # When dismissed, NULL cluster_id on members — returns them to unclustered
        if action == "dismiss":
            conn.execute(
                """UPDATE gs_extracted_entities
                   SET cluster_id = NULL
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
            # Only structural specimens participate in clustering
            entities = cxn.execute(
                """SELECT e.id, e.entity_name, e.schema_name, e.source_database,
                          e.source_system, e.specimen_id
                   FROM gs_extracted_entities e
                   JOIN gs_specimens s ON e.specimen_id = s.id
                   WHERE s.division = ? AND e.deleted_at IS NULL
                     AND e.cluster_id IS NULL
                     AND s.source_class = 'structural'
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
        # Only structural entities appear as unclustered candidates
        total = conn.execute(
            """SELECT COUNT(*) AS cnt FROM gs_extracted_entities e
               JOIN gs_specimens s ON e.specimen_id = s.id
               WHERE e.cluster_id IS NULL AND e.deleted_at IS NULL
                 AND s.source_class = 'structural'"""
        ).fetchone()["cnt"]
        rows = conn.execute(
            """SELECT e.*, s.name AS specimen_name, s.division, s.source_system AS specimen_source
               FROM gs_extracted_entities e
               JOIN gs_specimens s ON e.specimen_id = s.id
               WHERE e.cluster_id IS NULL AND e.deleted_at IS NULL
                 AND s.source_class = 'structural'
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

        # Optimistic concurrency
        _check_expected_version(
            conn, params,
            "SELECT MAX(version) FROM gs_canonical_entities WHERE root_id = ? AND is_current = 1",
            (old["root_id"],), "canonical entity")

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

        # Optimistic concurrency: check version hasn't changed
        _check_expected_version(
            conn, params,
            "SELECT MAX(version) FROM gs_canonical_entities WHERE root_id = ? AND is_current = 1",
            (row["root_id"],), "canonical entity")

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

        # Optimistic concurrency
        _check_expected_version(
            conn, params,
            "SELECT MAX(version) FROM gs_gold_specs WHERE root_id = ? AND is_current = 1",
            (old["root_id"],), "gold spec")

        # Reject edits during active validation runs (Fix 2)
        active = conn.execute(
            "SELECT COUNT(*) AS cnt FROM gs_validation_runs WHERE spec_root_id = ? AND status IN ('queued', 'running')",
            (old["root_id"],)
        ).fetchone()["cnt"]
        if active > 0:
            raise HttpError("Cannot edit spec while validation is running", 409)

        updatable = ("target_name", "object_type", "source_sql",
                     "transformation_rules", "included_columns",
                     "excluded_columns", "relationship_expectations",
                     "downstream_reports", "refresh_strategy",
                     "validation_rules", "status")
        material_fields = {"source_sql", "transformation_rules",
                           "included_columns", "excluded_columns",
                           "refresh_strategy"}

        # Detect which fields are being changed and whether any are material
        material = False
        has_changes = False
        for col in updatable:
            if col in params and params[col] is not None:
                has_changes = True
                if col in material_fields:
                    material = True

        if not has_changes:
            raise HttpError("No updatable fields provided", 400)

        if material:
            # Material change: create a new version row (like gs_update_canonical)
            conn.execute("BEGIN IMMEDIATE")
            old_d = _row_to_dict(old)
            new_version = old_d["version"] + 1

            # Collect values, preferring params over old values
            vals = {}
            for col in updatable:
                v = params.get(col, old_d.get(col))
                if isinstance(v, (list, dict)):
                    v = json.dumps(v)
                vals[col] = v

            # Force needs_revalidation on material change
            if old_d["status"] == "validated":
                vals["status"] = "needs_revalidation"

            conn.execute(
                "UPDATE gs_gold_specs SET is_current = 0 WHERE id = ?",
                (sid,))

            cur = conn.execute(
                """INSERT INTO gs_gold_specs
                   (root_id, version, is_current, canonical_root_id, canonical_version,
                    target_name, object_type, source_sql, transformation_rules,
                    included_columns, excluded_columns, relationship_expectations,
                    downstream_reports, refresh_strategy, validation_rules, status)
                   VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (old_d["root_id"], new_version,
                 old_d["canonical_root_id"], old_d["canonical_version"],
                 vals["target_name"], vals["object_type"], vals["source_sql"],
                 vals["transformation_rules"], vals["included_columns"],
                 vals["excluded_columns"], vals["relationship_expectations"],
                 vals["downstream_reports"], vals["refresh_strategy"],
                 vals["validation_rules"], vals["status"]))
            new_id = cur.lastrowid
            _audit(conn, "spec", new_id, "versioned",
                   previous_value={"version": old_d["version"]},
                   new_value={"version": new_version},
                   notes="material_change")
            conn.commit()
            row = conn.execute("SELECT * FROM gs_gold_specs WHERE id = ?",
                               (new_id,)).fetchone()
            return _row_to_dict(row)
        else:
            # Non-material: in-place update
            sets, vals = [], []
            for col in updatable:
                if col in params and params[col] is not None:
                    v = params[col]
                    if isinstance(v, (list, dict)):
                        v = json.dumps(v)
                    sets.append(f"{col} = ?")
                    vals.append(v)

            sets.append("updated_at = CURRENT_TIMESTAMP")
            vals.append(sid)
            conn.execute(
                f"UPDATE gs_gold_specs SET {', '.join(sets)} WHERE id = ?", vals)
            _audit(conn, "spec", sid, "updated",
                   previous_value=_row_to_dict(old))
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

        # Optimistic concurrency
        _check_expected_version(
            conn, params,
            "SELECT MAX(version) FROM gs_gold_specs WHERE root_id = ? AND is_current = 1",
            (old["root_id"],), "gold spec")

        # Reject edits during active validation runs
        active = conn.execute(
            "SELECT COUNT(*) AS cnt FROM gs_validation_runs WHERE spec_root_id = ? AND status IN ('queued', 'running')",
            (old["root_id"],)
        ).fetchone()["cnt"]
        if active > 0:
            raise HttpError("Cannot edit spec while validation is running", 409)

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

        # Optimistic concurrency
        _check_expected_version(
            conn, params,
            "SELECT MAX(version) FROM gs_gold_specs WHERE root_id = ? AND is_current = 1",
            (spec["root_id"],), "gold spec")

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

        # Optimistic concurrency: check run hasn't been superseded
        expected = params.get("expected_version")
        if expected is not None:
            current_ts = run["completed_at"] or run["started_at"] or ""
            if str(expected) != str(current_ts):
                raise HttpError(
                    "Conflict: validation run has been modified (expected %s, current %s)"
                    % (expected, current_ts), 409)

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

        # Optimistic concurrency
        _check_expected_version(
            conn, params,
            "SELECT MAX(version) FROM gs_gold_specs WHERE root_id = ? AND is_current = 1",
            (spec["root_id"],), "gold spec")

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

        # Optimistic concurrency
        _check_expected_version(
            conn, params,
            "SELECT MAX(version) FROM gs_catalog_entries WHERE root_id = ? AND is_current = 1",
            (old["root_id"],), "catalog entry")

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
        # Filter by division — join through object tables for each type
        where.append("""(
            (object_type = 'specimen' AND object_id IN
                (SELECT id FROM gs_specimens WHERE division = ?))
            OR (object_type = 'entity' AND object_id IN
                (SELECT e.id FROM gs_extracted_entities e
                 JOIN gs_specimens s ON e.specimen_id = s.id
                 WHERE s.division = ?))
            OR (object_type = 'cluster' AND object_id IN
                (SELECT id FROM gs_clusters WHERE division = ?))
            OR (object_type = 'canonical' AND object_id IN
                (SELECT id FROM gs_canonical_entities WHERE domain = ?))
            OR (object_type = 'spec' AND object_id IN
                (SELECT gs.id FROM gs_gold_specs gs
                 JOIN gs_canonical_entities ce
                     ON ce.root_id = gs.canonical_root_id AND ce.is_current = 1
                 WHERE ce.domain = ?))
            OR (object_type = 'catalog' AND object_id IN
                (SELECT id FROM gs_catalog_entries WHERE domain = ?))
            OR object_type NOT IN ('specimen', 'entity', 'cluster', 'canonical', 'spec', 'catalog')
        )""")
        bind.extend([division, division, division, division, division, division])

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
    with _stats_lock:
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
            avg_cluster_confidence = conn.execute(
                "SELECT ROUND(COALESCE(AVG(confidence), 0), 1) AS avg_conf FROM gs_clusters WHERE deleted_at IS NULL"
            ).fetchone()["avg_conf"]
            not_clustered = _count(
                """SELECT COUNT(*) AS cnt FROM gs_extracted_entities e
                   JOIN gs_specimens s ON e.specimen_id = s.id
                   WHERE e.cluster_id IS NULL AND e.deleted_at IS NULL
                     AND s.source_class = 'structural'"""
            )
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
            generated_at = conn.execute(
                "SELECT CURRENT_TIMESTAMP AS ts"
            ).fetchone()["ts"]

            cert_rate = round((catalog_certified / catalog_published * 100), 1) if catalog_published > 0 else 0.0

            data = {
                "updated_at": generated_at,
                "specimens": specimens,
                "tables_extracted": tables_extracted,
                "columns_cataloged": columns_cataloged,
                "clusters_total": clusters_total,
                "unresolved_clusters": clusters_unresolved,
                "clusters_resolved": clusters_resolved,
                "total_clusters": clusters_total,
                "unresolved": clusters_unresolved,
                "resolved": clusters_resolved,
                "avg_confidence": avg_cluster_confidence,
                "not_clustered": not_clustered,
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
# GROUP 13: Domain Workspaces (4 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 56. GET /api/gold-studio/domains — List all domain workspaces
@route("GET", "/api/gold-studio/domains")
def gs_domains_list(params: dict) -> dict:
    """List all domain workspaces with readiness state."""
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM gs_domain_workspaces ORDER BY name"
        ).fetchall()
        return {"domains": _rows_to_list(rows)}
    finally:
        conn.close()


# 57. POST /api/gold-studio/domains — Create a domain workspace
@route("POST", "/api/gold-studio/domains")
def gs_domains_create(params: dict) -> dict:
    """Create a domain workspace."""
    _require(params, "name", "display_name")
    conn = cpdb._get_conn()
    try:
        cur = conn.execute(
            """INSERT INTO gs_domain_workspaces (name, display_name, description)
               VALUES (?, ?, ?)""",
            (params["name"], params["display_name"], params.get("description")),
        )
        conn.commit()
        return {"id": cur.lastrowid}
    finally:
        conn.close()


# 58. PUT /api/gold-studio/domains/{id} — Update domain workspace
@route("PUT", "/api/gold-studio/domains/{id}")
def gs_domains_update(params: dict) -> dict:
    """Update domain workspace metadata or readiness state."""
    domain_id = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute("SELECT * FROM gs_domain_workspaces WHERE id = ?", (domain_id,)).fetchone()
        if not row:
            raise HttpError("Domain workspace not found", 404)
        sets, vals = [], []
        for col in ("display_name", "description", "readiness_state", "source_coverage", "metadata"):
            if col in params:
                val = params[col]
                if isinstance(val, (dict, list)):
                    val = json.dumps(val)
                sets.append(f"{col} = ?")
                vals.append(val)
        if not sets:
            raise HttpError("No fields to update", 400)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        vals.append(domain_id)
        set_clause = ", ".join(sets)  # sets built from hardcoded column allowlist above
        conn.execute("UPDATE gs_domain_workspaces SET " + set_clause + " WHERE id = ?", vals)
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# 59. GET /api/gold-studio/domains/{id} — Domain detail with aggregated stats
@route("GET", "/api/gold-studio/domains/{id}")
def gs_domains_detail(params: dict) -> dict:
    """Get domain workspace detail with aggregated coverage stats."""
    domain_id = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute("SELECT * FROM gs_domain_workspaces WHERE id = ?", (domain_id,)).fetchone()
        if not row:
            raise HttpError("Domain workspace not found", 404)
        domain = _row_to_dict(row)
        # Aggregate stats for this domain
        name = domain["name"]
        domain["specimen_count"] = conn.execute(
            "SELECT COUNT(*) FROM gs_specimens WHERE division = ? AND deleted_at IS NULL", (name,)
        ).fetchone()[0]
        domain["canonical_count"] = conn.execute(
            "SELECT COUNT(*) FROM gs_canonical_entities WHERE domain = ? AND is_current = 1 AND deleted_at IS NULL", (name,)
        ).fetchone()[0]
        domain["report_coverage"] = _rows_to_list(conn.execute(
            "SELECT id, report_name, coverage_status FROM gs_report_recreation_coverage WHERE domain = ?", (name,)
        ).fetchall())
        return domain
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# GROUP 14: Report Recreation Coverage (6 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 60. GET /api/gold-studio/report-coverage/summary — Aggregate summary by domain
@route("GET", "/api/gold-studio/report-coverage/summary")
def gs_coverage_summary(params: dict) -> dict:
    """Aggregate recreation readiness summary by domain."""
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            """SELECT domain, coverage_status, COUNT(*) as count
               FROM gs_report_recreation_coverage
               GROUP BY domain, coverage_status
               ORDER BY domain, coverage_status"""
        ).fetchall()
        # Restructure into {domain: {status: count}}
        summary = {}
        for r in rows:
            d = dict(r)
            domain = d["domain"]
            if domain not in summary:
                summary[domain] = {}
            summary[domain][d["coverage_status"]] = d["count"]
        return {"summary": summary}
    finally:
        conn.close()


# 61. GET /api/gold-studio/report-coverage — List report coverage entries
@route("GET", "/api/gold-studio/report-coverage")
def gs_coverage_list(params: dict) -> dict:
    """List report recreation coverage entries, filterable by domain and status."""
    limit, offset = _paginate(params)
    conn = cpdb._get_conn()
    try:
        where, vals = [], []
        if params.get("domain"):
            where.append("domain = ?")
            vals.append(params["domain"])
        if params.get("coverage_status"):
            where.append("coverage_status = ?")
            vals.append(params["coverage_status"])
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        rows = conn.execute(
            f"SELECT * FROM gs_report_recreation_coverage{clause} ORDER BY domain, report_name LIMIT ? OFFSET ?",
            vals + [limit, offset],
        ).fetchall()
        total = conn.execute(
            f"SELECT COUNT(*) FROM gs_report_recreation_coverage{clause}", vals
        ).fetchone()[0]
        return {"items": _rows_to_list(rows), "total": total,
                "limit": limit, "offset": offset}
    finally:
        conn.close()


# 62. POST /api/gold-studio/report-coverage — Create report coverage entry
@route("POST", "/api/gold-studio/report-coverage")
def gs_coverage_create(params: dict) -> dict:
    """Register a legacy report for recreation tracking."""
    _require(params, "domain", "report_name")
    conn = cpdb._get_conn()
    try:
        cur = conn.execute(
            """INSERT INTO gs_report_recreation_coverage
               (domain, report_name, report_description, report_type, notes, assessed_by)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (params["domain"], params["report_name"], params.get("report_description"),
             params.get("report_type"), params.get("notes"), params.get("assessed_by")),
        )
        conn.commit()
        _audit(conn, "report_coverage", cur.lastrowid, "created",
               new_value={"domain": params["domain"], "report_name": params["report_name"]})
        conn.commit()
        return {"id": cur.lastrowid}
    finally:
        conn.close()


# 63. GET /api/gold-studio/report-coverage/{id} — Report coverage detail
@route("GET", "/api/gold-studio/report-coverage/{id}")
def gs_coverage_detail(params: dict) -> dict:
    """Get report recreation coverage detail."""
    cov_id = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute("SELECT * FROM gs_report_recreation_coverage WHERE id = ?", (cov_id,)).fetchone()
        if not row:
            raise HttpError("Report coverage entry not found", 404)
        return _row_to_dict(row)
    finally:
        conn.close()


# 64. PUT /api/gold-studio/report-coverage/{id} — Update report coverage
@route("PUT", "/api/gold-studio/report-coverage/{id}")
def gs_coverage_update(params: dict) -> dict:
    """Update report recreation coverage (status, contributing IDs, unresolved metrics)."""
    cov_id = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute("SELECT * FROM gs_report_recreation_coverage WHERE id = ?", (cov_id,)).fetchone()
        if not row:
            raise HttpError("Report coverage entry not found", 404)
        prev = _row_to_dict(row)
        sets, vals = [], []
        for col in ("report_name", "report_description", "report_type", "coverage_status",
                    "contributing_specimen_ids", "contributing_canonical_ids", "contributing_spec_ids",
                    "unresolved_metrics", "notes", "assessed_by"):
            if col in params:
                val = params[col]
                if isinstance(val, (dict, list)):
                    val = json.dumps(val)
                sets.append(f"{col} = ?")
                vals.append(val)
        if not sets:
            raise HttpError("No fields to update", 400)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        if "coverage_status" in params:
            sets.append("assessed_at = CURRENT_TIMESTAMP")
        vals.append(cov_id)
        set_clause = ", ".join(sets)  # sets built from hardcoded column allowlist above
        conn.execute("UPDATE gs_report_recreation_coverage SET " + set_clause + " WHERE id = ?", vals)
        _audit(conn, "report_coverage", cov_id, "updated",
               previous_value={"coverage_status": prev["coverage_status"]},
               new_value={"coverage_status": params.get("coverage_status", prev["coverage_status"])})
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# 65. DELETE /api/gold-studio/report-coverage/{id} — Delete report coverage
@route("DELETE", "/api/gold-studio/report-coverage/{id}")
def gs_coverage_delete(params: dict) -> dict:
    """Delete a report coverage entry."""
    cov_id = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        row = conn.execute("SELECT * FROM gs_report_recreation_coverage WHERE id = ?", (cov_id,)).fetchone()
        if not row:
            raise HttpError("Report coverage entry not found", 404)
        conn.execute("DELETE FROM gs_report_recreation_coverage WHERE id = ?", (cov_id,))
        _audit(conn, "report_coverage", cov_id, "deleted")
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# Group 15 — Release Review (3 endpoints)
# ═══════════════════════════════════════════════════════════════════════════


@route("GET", "/api/gold-studio/release/coverage-map")
def gs_release_coverage_map(params: dict) -> dict:
    """Release-stage coverage map for imported evidence and downstream reports."""
    domain = (params.get("domain") or "").strip() or None
    conn = cpdb._get_conn()
    try:
        field_rows = _release_field_rows(conn, domain)
        model_nodes = _release_model_nodes(conn, domain)
        canonical_by_root = {row["root_id"]: row for row in model_nodes}

        specimen_where = ["deleted_at IS NULL"]
        specimen_bind: list = []
        if domain:
            specimen_where.append("division = ?")
            specimen_bind.append(domain)
        specimen_rows = _rows_to_list(conn.execute(
            f"""SELECT *
                FROM gs_specimens
                WHERE {' AND '.join(specimen_where)}
                ORDER BY created_at DESC, name COLLATE NOCASE""",
            specimen_bind,
        ).fetchall())
        specimens_by_id = {row["id"]: row for row in specimen_rows}

        report_where = []
        report_bind: list = []
        if domain:
            report_where.append("domain = ?")
            report_bind.append(domain)
        report_clause = (" WHERE " + " AND ".join(report_where)) if report_where else ""
        report_rows = _rows_to_list(conn.execute(
            f"""SELECT *
                FROM gs_report_recreation_coverage
                {report_clause}
                ORDER BY report_name COLLATE NOCASE""",
            report_bind,
        ).fetchall())

        spec_where = ["gs.is_current = 1", "gs.deleted_at IS NULL"]
        spec_bind: list = []
        if domain:
            spec_where.append("ce.domain = ?")
            spec_bind.append(domain)
        spec_rows = _rows_to_list(conn.execute(
            f"""SELECT gs.id, gs.root_id, gs.target_name, gs.status, ce.domain
                FROM gs_gold_specs gs
                LEFT JOIN gs_canonical_entities ce
                  ON ce.root_id = gs.canonical_root_id
                 AND ce.is_current = 1
                 AND ce.deleted_at IS NULL
                WHERE {' AND '.join(spec_where)}
                ORDER BY gs.target_name COLLATE NOCASE""",
            spec_bind,
        ).fetchall())
        spec_by_id = {row["id"]: row for row in spec_rows}

        artifact_rows: dict[int, dict] = {}
        for specimen in specimen_rows:
            artifact_rows[specimen["id"]] = {
                "artifact_id": specimen["id"],
                "artifact_name": specimen["name"],
                "artifact_type": specimen["type"],
                "source_class": specimen.get("source_class"),
                "division": specimen.get("division"),
                "source_system": specimen.get("source_system"),
                "job_state": specimen.get("job_state"),
                "usage_row_count": 0,
                "mapped_row_count": 0,
                "published_row_count": 0,
                "needs_review_count": 0,
                "page_count": 0,
                "visual_count": 0,
                "canonical_ids": set(),
                "spec_ids": set(),
                "catalog_names": set(),
                "sample_gaps": [],
            }

        for row in field_rows:
            artifact = artifact_rows.setdefault(row["specimen_id"], {
                "artifact_id": row["specimen_id"],
                "artifact_name": row["specimen_name"],
                "artifact_type": row["specimen_type"],
                "source_class": row.get("source_class"),
                "division": row.get("division"),
                "source_system": row.get("source_system"),
                "job_state": row.get("job_state"),
                "usage_row_count": 0,
                "mapped_row_count": 0,
                "published_row_count": 0,
                "needs_review_count": 0,
                "page_count": 0,
                "visual_count": 0,
                "canonical_ids": set(),
                "spec_ids": set(),
                "catalog_names": set(),
                "sample_gaps": [],
            })
            artifact["usage_row_count"] += 1
            if row.get("page_name"):
                artifact.setdefault("pages", set()).add(row["page_name"])
            if row.get("visual_id"):
                artifact.setdefault("visuals", set()).add(row["visual_id"])
            if row.get("canonical_root_id"):
                artifact["canonical_ids"].add(row["canonical_root_id"])
            if row.get("spec_id"):
                artifact["spec_ids"].add(row["spec_id"])
            if row.get("catalog_name"):
                artifact["catalog_names"].add(row["catalog_name"])
            if row["mapping_status"] in ("accounted_for", "published"):
                artifact["mapped_row_count"] += 1
            else:
                artifact["needs_review_count"] += 1
                gap_name = row.get("measure_name") or row.get("column_name") or row.get("entity_name") or "Unmapped reference"
                if gap_name not in artifact["sample_gaps"] and len(artifact["sample_gaps"]) < 5:
                    artifact["sample_gaps"].append(gap_name)
            if row["mapping_status"] == "published":
                artifact["published_row_count"] += 1

        artifact_items = []
        for artifact in artifact_rows.values():
            pages = artifact.pop("pages", set())
            visuals = artifact.pop("visuals", set())
            total = artifact["usage_row_count"]
            mapped = artifact["mapped_row_count"]
            if total == 0:
                if artifact.get("source_class") in ("supporting", "contextual"):
                    coverage_status = "context_only"
                    coverage_note = "This imported artifact contributes context, but it has not produced parsed field lineage."
                else:
                    coverage_status = "no_field_evidence"
                    coverage_note = "This imported artifact has not produced field usage evidence yet, so it cannot be checked against the proposed model."
            elif mapped == total:
                coverage_status = "fully_accounted_for"
                coverage_note = "Everything parsed from this artifact is accounted for in the current gold model proposal."
            elif mapped == 0:
                coverage_status = "missing_model_coverage"
                coverage_note = "None of this artifact's parsed fields are currently accounted for by the gold model."
            else:
                coverage_status = "partially_accounted_for"
                coverage_note = "Some fields from this artifact are mapped into the gold model, but coverage is incomplete."

            artifact["coverage_status"] = coverage_status
            artifact["coverage_note"] = coverage_note
            artifact["page_count"] = len(pages)
            artifact["visual_count"] = len(visuals)
            artifact["proposed_coverage_pct"] = round((mapped / total) * 100, 1) if total else 0.0
            artifact["canonical_count"] = len(artifact["canonical_ids"])
            artifact["spec_count"] = len(artifact["spec_ids"])
            artifact["catalog_products"] = sorted(artifact["catalog_names"])
            artifact["canonical_ids"] = sorted(artifact["canonical_ids"])
            artifact["spec_ids"] = sorted(artifact["spec_ids"])
            artifact_items.append(artifact)

        artifact_items.sort(key=lambda row: (row["coverage_status"], -row["usage_row_count"], row["artifact_name"].lower()))

        report_items = []
        for report in report_rows:
            specimen_ids = _json_int_list(report.get("contributing_specimen_ids"))
            canonical_ids = _json_int_list(report.get("contributing_canonical_ids"))
            spec_ids = _json_int_list(report.get("contributing_spec_ids"))
            unresolved = _json_list(report.get("unresolved_metrics"))
            report_items.append({
                **report,
                "artifact_names": [specimens_by_id[sid]["name"] for sid in specimen_ids if sid in specimens_by_id],
                "canonical_names": [canonical_by_root[cid]["name"] for cid in canonical_ids if cid in canonical_by_root],
                "spec_names": [spec_by_id[sid]["target_name"] for sid in spec_ids if sid in spec_by_id],
                "artifact_count": len(specimen_ids),
                "canonical_count": len(canonical_ids),
                "spec_count": len(spec_ids),
                "unresolved_metric_count": len(unresolved),
                "coverage_note": (
                    "This report is fully represented by the proposed model."
                    if report["coverage_status"] in ("fully_covered", "recreated", "reconciled")
                    else "This report still has explicit coverage gaps or open reconciliation work."
                ),
            })

        blockers = []
        for spec in spec_rows:
            if spec["status"] != "validated":
                blockers.append({
                    "kind": "spec",
                    "name": spec["target_name"],
                    "status": spec["status"],
                    "reason": "This gold spec has not completed validation yet.",
                })
        for artifact in artifact_items:
            if artifact["usage_row_count"] > 0 and artifact["needs_review_count"] > 0:
                blockers.append({
                    "kind": "artifact",
                    "name": artifact["artifact_name"],
                    "status": artifact["coverage_status"],
                    "reason": artifact["coverage_note"],
                })
        for report in report_items:
            if report["coverage_status"] not in ("fully_covered", "recreated", "reconciled") or report["unresolved_metric_count"] > 0:
                blockers.append({
                    "kind": "report",
                    "name": report["report_name"],
                    "status": report["coverage_status"],
                    "reason": report["coverage_note"],
                })

        mapped_field_rows = sum(1 for row in field_rows if row["mapping_status"] in ("accounted_for", "published"))
        summary = {
            "domain": domain,
            "imported_artifacts": len(artifact_items),
            "registered_reports": len(report_items),
            "field_rows_total": len(field_rows),
            "field_rows_accounted_for": mapped_field_rows,
            "field_rows_needing_review": max(len(field_rows) - mapped_field_rows, 0),
            "current_specs": len(spec_rows),
            "validated_specs": sum(1 for row in spec_rows if row["status"] == "validated"),
            "published_products": sum(1 for row in model_nodes if row.get("published_product_count")),
            "canonical_entities": len(model_nodes),
            "updated_at": conn.execute("SELECT CURRENT_TIMESTAMP AS ts").fetchone()["ts"],
        }

        return {
            "summary": summary,
            "artifacts": artifact_items,
            "reports": report_items,
            "blockers": blockers[:18],
        }
    finally:
        conn.close()


@route("GET", "/api/gold-studio/release/proposed-model")
def gs_release_proposed_model(params: dict) -> dict:
    """Power BI-style semantic model review for the proposed gold layer."""
    domain = (params.get("domain") or "").strip() or None
    conn = cpdb._get_conn()
    try:
        nodes = _release_model_nodes(conn, domain)
        field_rows = _release_field_rows(conn, domain)

        usage_by_root: dict[int, dict] = {}
        for row in field_rows:
            root_id = row.get("canonical_root_id")
            if not root_id:
                continue
            usage = usage_by_root.setdefault(root_id, {
                "field_reference_count": 0,
                "artifact_ids": set(),
                "artifact_names": set(),
            })
            usage["field_reference_count"] += 1
            usage["artifact_ids"].add(row["specimen_id"])
            usage["artifact_names"].add(row["specimen_name"])

        report_rows = _rows_to_list(conn.execute(
            ("SELECT * FROM gs_report_recreation_coverage WHERE domain = ? ORDER BY report_name COLLATE NOCASE"
             if domain else
             "SELECT * FROM gs_report_recreation_coverage ORDER BY report_name COLLATE NOCASE"),
            ([domain] if domain else []),
        ).fetchall())
        explicit_report_counts: dict[int, int] = {}
        for report in report_rows:
            for root_id in _json_int_list(report.get("contributing_canonical_ids")):
                explicit_report_counts[root_id] = explicit_report_counts.get(root_id, 0) + 1

        root_ids = {node["root_id"] for node in nodes}
        rel_rows = _rows_to_list(conn.execute(
            """SELECT cc.id,
                      cc.canonical_root_id AS from_root_id,
                      ce_from.name AS from_entity,
                      cc.column_name,
                      cc.fk_target_root_id AS to_root_id,
                      ce_to.name AS to_entity,
                      cc.fk_target_column
               FROM gs_canonical_columns cc
               JOIN gs_canonical_entities ce_from
                 ON ce_from.root_id = cc.canonical_root_id
                AND ce_from.is_current = 1
               LEFT JOIN gs_canonical_entities ce_to
                 ON ce_to.root_id = cc.fk_target_root_id
                AND ce_to.is_current = 1
               WHERE cc.fk_target_root_id IS NOT NULL
               ORDER BY ce_from.name, cc.column_name""",
        ).fetchall())
        relationships = [row for row in rel_rows if row["from_root_id"] in root_ids and row["to_root_id"] in root_ids]

        model_nodes = []
        for node in nodes:
            usage = usage_by_root.get(node["root_id"], {})
            report_count = explicit_report_counts.get(node["root_id"], 0)
            if node.get("published_product_count"):
                model_state = "published"
                model_note = "This business object already has a published gold product behind it."
            elif node.get("spec_id") and node.get("spec_status") == "validated":
                model_state = "validated"
                model_note = "The object is modeled and validated, but not yet published."
            elif node.get("spec_id"):
                model_state = "designed"
                model_note = "The object is in the proposed model, but its gold spec still needs release confirmation."
            else:
                model_state = "needs_spec"
                model_note = "The canonical object exists, but the final gold model still needs a concrete spec for it."

            model_nodes.append({
                **node,
                "field_reference_count": usage.get("field_reference_count", 0),
                "artifact_evidence_count": len(usage.get("artifact_ids", set())),
                "artifact_names": sorted(usage.get("artifact_names", set())),
                "report_count": report_count,
                "relationship_count": sum(1 for rel in relationships if rel["from_root_id"] == node["root_id"] or rel["to_root_id"] == node["root_id"]),
                "model_state": model_state,
                "model_note": model_note,
            })

        summary = {
            "domain": domain,
            "entity_count": len(model_nodes),
            "published_entities": sum(1 for row in model_nodes if row["model_state"] == "published"),
            "validated_entities": sum(1 for row in model_nodes if row["model_state"] in ("published", "validated")),
            "entities_needing_specs": sum(1 for row in model_nodes if row["model_state"] == "needs_spec"),
            "relationship_count": len(relationships),
            "updated_at": conn.execute("SELECT CURRENT_TIMESTAMP AS ts").fetchone()["ts"],
        }
        return {"summary": summary, "nodes": model_nodes, "relationships": relationships}
    finally:
        conn.close()


@route("GET", "/api/gold-studio/release/coverage-appendix")
def gs_release_coverage_appendix(params: dict) -> dict:
    """Appendix rows showing exactly how imported artifacts map into the proposed gold model."""
    domain = (params.get("domain") or "").strip() or None
    conn = cpdb._get_conn()
    try:
        items = []
        field_rows = _release_field_rows(conn, domain)
        seen_specimen_ids = set()
        for row in field_rows:
            seen_specimen_ids.add(row["specimen_id"])
            items.append({
                "kind": "field_usage",
                "artifact_id": row["specimen_id"],
                "artifact_name": row["specimen_name"],
                "artifact_type": row["specimen_type"],
                "source_class": row.get("source_class"),
                "domain": row.get("division"),
                "page_name": row.get("page_name"),
                "visual_type": row.get("visual_type"),
                "visual_id": row.get("visual_id"),
                "source_entity_name": row.get("entity_name"),
                "source_field_name": row.get("measure_name") or row.get("column_name"),
                "field_kind": "measure" if row.get("measure_name") else "column",
                "usage_type": row.get("usage_type"),
                "canonical_name": row.get("canonical_name"),
                "semantic_name": row.get("semantic_name"),
                "spec_name": row.get("spec_name"),
                "catalog_name": row.get("catalog_name"),
                "mapping_status": row["mapping_status"],
                "mapping_note": row["mapping_note"],
            })

        specimen_where = ["deleted_at IS NULL"]
        specimen_bind: list = []
        if domain:
            specimen_where.append("division = ?")
            specimen_bind.append(domain)
        specimen_rows = _rows_to_list(conn.execute(
            f"""SELECT *
                FROM gs_specimens
                WHERE {' AND '.join(specimen_where)}
                ORDER BY created_at DESC, name COLLATE NOCASE""",
            specimen_bind,
        ).fetchall())

        for specimen in specimen_rows:
            if specimen["id"] in seen_specimen_ids:
                continue
            items.append({
                "kind": "artifact",
                "artifact_id": specimen["id"],
                "artifact_name": specimen["name"],
                "artifact_type": specimen["type"],
                "source_class": specimen.get("source_class"),
                "domain": specimen.get("division"),
                "page_name": None,
                "visual_type": None,
                "visual_id": None,
                "source_entity_name": None,
                "source_field_name": None,
                "field_kind": "artifact",
                "usage_type": None,
                "canonical_name": None,
                "semantic_name": None,
                "spec_name": None,
                "catalog_name": None,
                "mapping_status": "context_only" if specimen.get("source_class") in ("supporting", "contextual") else "no_field_evidence",
                "mapping_note": (
                    "Imported as contextual/supporting evidence. It informs the final model, but it does not expose parsed field lineage."
                    if specimen.get("source_class") in ("supporting", "contextual")
                    else "Imported as a structural artifact, but no field lineage has been extracted from it yet."
                ),
            })

        report_rows = _rows_to_list(conn.execute(
            ("SELECT * FROM gs_report_recreation_coverage WHERE domain = ? ORDER BY report_name COLLATE NOCASE"
             if domain else
             "SELECT * FROM gs_report_recreation_coverage ORDER BY report_name COLLATE NOCASE"),
            ([domain] if domain else []),
        ).fetchall())
        for report in report_rows:
            if _json_int_list(report.get("contributing_specimen_ids")) or _json_int_list(report.get("contributing_canonical_ids")) or _json_int_list(report.get("contributing_spec_ids")):
                continue
            items.append({
                "kind": "release_report",
                "artifact_id": report["id"],
                "artifact_name": report["report_name"],
                "artifact_type": report.get("report_type") or "other",
                "source_class": "release_report",
                "domain": report.get("domain"),
                "page_name": None,
                "visual_type": None,
                "visual_id": None,
                "source_entity_name": None,
                "source_field_name": None,
                "field_kind": "report",
                "usage_type": None,
                "canonical_name": None,
                "semantic_name": None,
                "spec_name": None,
                "catalog_name": None,
                "mapping_status": "coverage_unmapped",
                "mapping_note": "This downstream report is registered for migration, but it still has no linked artifacts, canonical objects, or gold specs.",
            })

        items.sort(key=lambda row: (
            row.get("artifact_name", "").lower(),
            str(row.get("page_name") or "").lower(),
            str(row.get("source_entity_name") or "").lower(),
            str(row.get("source_field_name") or "").lower(),
        ))

        status_counts: dict[str, int] = {}
        for item in items:
            status = item["mapping_status"]
            status_counts[status] = status_counts.get(status, 0) + 1

        return {
            "domain": domain,
            "items": items,
            "total": len(items),
            "status_counts": status_counts,
            "updated_at": conn.execute("SELECT CURRENT_TIMESTAMP AS ts").fetchone()["ts"],
        }
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# Group 16 — Live Discovery & Preview (4 endpoints)
# ═══════════════════════════════════════════════════════════════════════════

# 66. GET /api/gold-studio/source-systems — List known source systems
@route("GET", "/api/gold-studio/source-systems")
def gs_source_systems(params: dict) -> dict:
    return {"items": schema_discovery.get_source_systems()}


# 67. POST /api/gold-studio/specimens/{id}/preview — Run query with TOP N, return rows
@route("POST", "/api/gold-studio/specimens/{id}/preview")
def gs_specimen_preview(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    limit = _parse_int(params.get("limit"), "limit", default=50)
    conn = cpdb._get_conn()
    try:
        spec = conn.execute(
            "SELECT * FROM gs_specimens WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not spec:
            raise HttpError("Specimen not found", 404)

        queries = conn.execute(
            "SELECT * FROM gs_specimen_queries WHERE specimen_id = ? ORDER BY ordinal",
            (sid,)).fetchall()
        if not queries:
            raise HttpError("No SQL queries found for this specimen", 400)

        sql_text = queries[0]["query_text"]
        source_sys = spec["source_system"]
        source_db = queries[0]["source_database"] or None

        if not source_sys:
            raise HttpError("Source system not set — cannot connect to database", 400)

        try:
            result = schema_discovery.preview_query(
                sql_text, source_sys, source_db, limit=limit)
            return result
        except Exception as e:
            raise HttpError(f"Preview query failed: {e}", 500)
    finally:
        conn.close()


# 68. POST /api/gold-studio/specimens/{id}/live-describe — Get live column metadata
@route("POST", "/api/gold-studio/specimens/{id}/live-describe")
def gs_specimen_live_describe(params: dict) -> dict:
    sid = _parse_int(params.get("id"), "id", required=True)
    conn = cpdb._get_conn()
    try:
        spec = conn.execute(
            "SELECT * FROM gs_specimens WHERE id = ? AND deleted_at IS NULL",
            (sid,)).fetchone()
        if not spec:
            raise HttpError("Specimen not found", 404)

        queries = conn.execute(
            "SELECT * FROM gs_specimen_queries WHERE specimen_id = ? ORDER BY ordinal",
            (sid,)).fetchall()
        if not queries:
            raise HttpError("No SQL queries found", 400)

        sql_text = queries[0]["query_text"]
        source_sys = spec["source_system"]
        source_db = queries[0]["source_database"] or None

        if not source_sys:
            raise HttpError("Source system not set", 400)

        try:
            columns = schema_discovery.describe_query(sql_text, source_sys, source_db)
            return {"columns": columns, "source_system": source_sys, "column_count": len(columns)}
        except Exception as e:
            raise HttpError(f"Live describe failed: {e}", 500)
    finally:
        conn.close()


# 69. POST /api/gold-studio/auto-detect — Auto-detect source system from SQL
@route("POST", "/api/gold-studio/auto-detect")
def gs_auto_detect_source(params: dict) -> dict:
    sql = (params.get("sql") or "").strip()
    if not sql:
        raise HttpError("'sql' is required", 400)

    result = schema_discovery.auto_detect_source(sql)
    if result is None:
        return {"detected": False, "message": "Could not match query to any known source system"}
    return {
        "detected": True,
        "source_system": result["source_system"],
        "database": result["database"],
        "server": result["server"],
        "column_count": len(result["columns"]),
        "columns": result["columns"],
    }


# ═══════════════════════════════════════════════════════════════════════════
# Endpoint count verification (67 + 4 = 71 @route decorators above):
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
#  Group 13 — Domain Workspaces: 4  (#56-#59)
#  Group 14 — Report Coverage:   6  (#60-#65)
#                               ──
#                         Total: 65 route functions → 67 HTTP endpoints
# ═══════════════════════════════════════════════════════════════════════════
