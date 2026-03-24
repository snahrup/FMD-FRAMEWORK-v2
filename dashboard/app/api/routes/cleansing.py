"""Cleansing Rules API — CRUD for Bronze-to-Silver cleansing rules.

Endpoints:
    GET    /api/cleansing/rules       — list rules for an entity (query: entity_id)
    POST   /api/cleansing/rules       — create a rule
    PUT    /api/cleansing/rules/{id}   — update a rule
    DELETE /api/cleansing/rules/{id}   — delete a rule
    GET    /api/cleansing/functions    — available rule types with param schemas
    GET    /api/cleansing/summary      — aggregate stats across all rules

Data source:
    SQLite: cleansing_rules (in fmd_control_plane.db via control_plane_db._get_conn())
"""
import json
import logging

import dashboard.app.api.control_plane_db as db
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.cleansing")

# ---------------------------------------------------------------------------
# Rule type registry
# ---------------------------------------------------------------------------

RULE_TYPES = {
    "normalize_text": {
        "description": "Standardize text casing",
        "params": {
            "case": {"type": "select", "options": ["lower", "upper", "title"]},
        },
    },
    "fill_nulls": {
        "description": "Replace NULL values",
        "params": {
            "default": {"type": "text"},
        },
    },
    "parse_datetime": {
        "description": "Parse date strings",
        "params": {
            "format": {"type": "text", "placeholder": "YYYYMMDD"},
        },
    },
    "trim": {
        "description": "Strip whitespace",
        "params": {},
    },
    "replace": {
        "description": "String replacement",
        "params": {
            "old": {"type": "text"},
            "new": {"type": "text"},
        },
    },
    "regex": {
        "description": "Regex substitution",
        "params": {
            "pattern": {"type": "text"},
            "replacement": {"type": "text"},
        },
    },
    "cast_type": {
        "description": "Type coercion",
        "params": {
            "target_type": {"type": "select", "options": ["int", "float", "string", "date"]},
        },
    },
    "map_values": {
        "description": "Value remapping",
        "params": {
            "mapping": {"type": "json"},
        },
    },
    "clamp_range": {
        "description": "Constrain numeric range",
        "params": {
            "min": {"type": "number"},
            "max": {"type": "number"},
        },
    },
    "deduplicate": {
        "description": "Remove duplicate rows",
        "params": {
            "key_columns": {"type": "text", "placeholder": "col1, col2"},
        },
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_rule(row) -> dict:
    """Convert a sqlite3.Row to API shape."""
    params = row["parameters"] or "{}"
    try:
        params_parsed = json.loads(params)
    except (json.JSONDecodeError, TypeError):
        params_parsed = {}

    return {
        "id": row["id"],
        "entityId": row["entity_id"],
        "columnName": row["column_name"],
        "ruleType": row["rule_type"],
        "parameters": params_parsed,
        "priority": row["priority"],
        "isActive": bool(row["is_active"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


# ---------------------------------------------------------------------------
# GET /api/cleansing/functions
# ---------------------------------------------------------------------------

@route("GET", "/api/cleansing/functions")
def get_functions(params: dict) -> dict:
    """Return available rule types with parameter schemas."""
    return RULE_TYPES


# ---------------------------------------------------------------------------
# GET /api/cleansing/rules
# ---------------------------------------------------------------------------

@route("GET", "/api/cleansing/rules")
def get_rules(params: dict) -> list:
    """Return rules for a specific entity, ordered by priority.

    Query params:
        entity_id — required, the Silver entity's LandingzoneEntityId
    """
    entity_id_raw = params.get("entity_id")
    if not entity_id_raw:
        raise HttpError("entity_id query parameter is required", 400)

    try:
        entity_id = int(entity_id_raw)
    except (TypeError, ValueError):
        raise HttpError("entity_id must be an integer", 400)

    conn = db._get_conn()
    try:
        rows = conn.execute(
            "SELECT id, entity_id, column_name, rule_type, parameters, "
            "priority, is_active, created_at, updated_at "
            "FROM cleansing_rules "
            "WHERE entity_id = ? "
            "ORDER BY priority ASC, id ASC",
            (entity_id,),
        ).fetchall()
        return [_row_to_rule(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# POST /api/cleansing/rules
# ---------------------------------------------------------------------------

@route("POST", "/api/cleansing/rules")
def create_rule(params: dict) -> dict:
    """Create a new cleansing rule.

    Body params:
        entity_id   — integer, required
        column_name — string, required
        rule_type   — string, required (must be in RULE_TYPES)
        parameters  — object, optional (default {})
        priority    — integer, optional (default 0)
    """
    entity_id = params.get("entity_id")
    column_name = params.get("column_name", "").strip()
    rule_type = params.get("rule_type", "").strip()
    parameters = params.get("parameters", {})
    priority = params.get("priority", 0)

    if not entity_id:
        raise HttpError("entity_id is required", 400)
    try:
        entity_id = int(entity_id)
    except (TypeError, ValueError):
        raise HttpError("entity_id must be an integer", 400)

    if not column_name:
        raise HttpError("column_name is required", 400)
    if not rule_type:
        raise HttpError("rule_type is required", 400)
    if rule_type not in RULE_TYPES:
        raise HttpError(f"Invalid rule_type: {rule_type}. Must be one of: {', '.join(sorted(RULE_TYPES))}", 400)

    try:
        priority = int(priority)
    except (TypeError, ValueError):
        priority = 0

    params_json = json.dumps(parameters) if isinstance(parameters, dict) else str(parameters)

    conn = db._get_conn()
    try:
        cursor = conn.execute(
            "INSERT INTO cleansing_rules (entity_id, column_name, rule_type, parameters, priority) "
            "VALUES (?, ?, ?, ?, ?)",
            (entity_id, column_name, rule_type, params_json, priority),
        )
        conn.commit()
        rule_id = cursor.lastrowid

        row = conn.execute(
            "SELECT id, entity_id, column_name, rule_type, parameters, "
            "priority, is_active, created_at, updated_at "
            "FROM cleansing_rules WHERE id = ?",
            (rule_id,),
        ).fetchone()

        log.info("Created cleansing rule %d for entity %d: %s on %s",
                 rule_id, entity_id, rule_type, column_name)
        return _row_to_rule(row)
    except Exception as exc:
        if "UNIQUE constraint failed" in str(exc):
            raise HttpError(
                f"A '{rule_type}' rule already exists for column '{column_name}' on entity {entity_id}",
                409,
            )
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# PUT /api/cleansing/rules/{id}
# ---------------------------------------------------------------------------

@route("PUT", "/api/cleansing/rules/{id}")
def update_rule(params: dict) -> dict:
    """Update an existing cleansing rule.

    Path params:
        id — rule ID

    Body params (all optional):
        column_name, rule_type, parameters, priority, is_active
    """
    try:
        rule_id = int(params.get("id", ""))
    except (TypeError, ValueError):
        raise HttpError("id must be an integer", 400)

    conn = db._get_conn()
    try:
        existing = conn.execute(
            "SELECT id FROM cleansing_rules WHERE id = ?", (rule_id,)
        ).fetchone()
        if not existing:
            raise HttpError(f"Rule {rule_id} not found", 404)

        # Build SET clause from provided fields
        updates = []
        bind = []

        if "column_name" in params:
            col = params["column_name"].strip()
            if not col:
                raise HttpError("column_name cannot be empty", 400)
            updates.append("column_name = ?")
            bind.append(col)

        if "rule_type" in params:
            rt = params["rule_type"].strip()
            if rt not in RULE_TYPES:
                raise HttpError(f"Invalid rule_type: {rt}", 400)
            updates.append("rule_type = ?")
            bind.append(rt)

        if "parameters" in params:
            p = params["parameters"]
            updates.append("parameters = ?")
            bind.append(json.dumps(p) if isinstance(p, dict) else str(p))

        if "priority" in params:
            try:
                updates.append("priority = ?")
                bind.append(int(params["priority"]))
            except (TypeError, ValueError):
                raise HttpError("priority must be an integer", 400)

        if "is_active" in params:
            updates.append("is_active = ?")
            bind.append(1 if params["is_active"] else 0)

        if not updates:
            raise HttpError("No fields to update", 400)

        updates.append("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')")
        bind.append(rule_id)

        conn.execute(
            f"UPDATE cleansing_rules SET {', '.join(updates)} WHERE id = ?",
            bind,
        )
        conn.commit()

        row = conn.execute(
            "SELECT id, entity_id, column_name, rule_type, parameters, "
            "priority, is_active, created_at, updated_at "
            "FROM cleansing_rules WHERE id = ?",
            (rule_id,),
        ).fetchone()

        log.info("Updated cleansing rule %d", rule_id)
        return _row_to_rule(row)
    except HttpError:
        raise
    except Exception as exc:
        if "UNIQUE constraint failed" in str(exc):
            raise HttpError("Duplicate rule: same entity/column/rule_type combination already exists", 409)
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# DELETE /api/cleansing/rules/{id}
# ---------------------------------------------------------------------------

@route("DELETE", "/api/cleansing/rules/{id}")
def delete_rule(params: dict) -> dict:
    """Delete a cleansing rule by ID."""
    try:
        rule_id = int(params.get("id", ""))
    except (TypeError, ValueError):
        raise HttpError("id must be an integer", 400)

    conn = db._get_conn()
    try:
        existing = conn.execute(
            "SELECT id FROM cleansing_rules WHERE id = ?", (rule_id,)
        ).fetchone()
        if not existing:
            raise HttpError(f"Rule {rule_id} not found", 404)

        conn.execute("DELETE FROM cleansing_rules WHERE id = ?", (rule_id,))
        conn.commit()

        log.info("Deleted cleansing rule %d", rule_id)
        return {"deleted": rule_id}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GET /api/cleansing/summary
# ---------------------------------------------------------------------------

@route("GET", "/api/cleansing/summary")
def get_summary(params: dict) -> dict:
    """Return aggregate stats: total rules, entities with rules, top rule types."""
    conn = db._get_conn()
    try:
        total = conn.execute("SELECT COUNT(*) AS cnt FROM cleansing_rules").fetchone()["cnt"]
        entity_count = conn.execute(
            "SELECT COUNT(DISTINCT entity_id) AS cnt FROM cleansing_rules"
        ).fetchone()["cnt"]

        top_types = conn.execute(
            "SELECT rule_type, COUNT(*) AS cnt "
            "FROM cleansing_rules "
            "GROUP BY rule_type "
            "ORDER BY cnt DESC "
            "LIMIT 5"
        ).fetchall()

        active_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM cleansing_rules WHERE is_active = 1"
        ).fetchone()["cnt"]

        return {
            "totalRules": total,
            "activeRules": active_count,
            "entitiesWithRules": entity_count,
            "topRuleTypes": [
                {"ruleType": r["rule_type"], "count": r["cnt"]}
                for r in top_types
            ],
        }
    finally:
        conn.close()
