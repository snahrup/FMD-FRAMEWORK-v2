"""Glossary API — business term search, entity annotations, and re-seed.

Endpoints:
    GET  /api/glossary                    — paginated glossary search
    GET  /api/glossary/entity/{entityId}  — entity annotation + related terms
    POST /api/glossary/seed               — re-run seed_glossary.py via subprocess
    GET  /api/gold/domains                — distinct gold-layer business domains with entity counts

Data sources:
    SQLite: business_glossary, entity_annotations, lz_entities
    (all in fmd_control_plane.db via control_plane_db._get_conn())

JSON columns (related_systems, synonyms, tags) are stored as TEXT and must
be json.loads()'d on the way out.
"""
import json
import logging
import subprocess
import sys
from pathlib import Path

import dashboard.app.api.control_plane_db as db
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.glossary")

# Path to the seed script, relative to this file's repo root
_SCRIPT_PATH = Path(__file__).parent.parent.parent.parent.parent / "scripts" / "seed_glossary.py"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_json_field(val) -> list:
    """Safely decode a TEXT column that holds a JSON array.

    Returns an empty list on any failure (None input, bad JSON, wrong type).
    """
    if not val:
        return []
    if isinstance(val, list):
        return val
    try:
        parsed = json.loads(val)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _row_to_glossary_item(row) -> dict:
    """Convert a sqlite3.Row (or dict) from business_glossary to API shape."""
    return {
        "id": row["id"],
        "term": row["term"],
        "definition": row["definition"],
        "category": row["category"] or "concept",
        "relatedSystems": _parse_json_field(row["related_systems"]),
        "synonyms": _parse_json_field(row["synonyms"]),
        "source": row["source"] or "",
    }


# ---------------------------------------------------------------------------
# GET /api/glossary
# ---------------------------------------------------------------------------

@route("GET", "/api/glossary")
def get_glossary(params: dict) -> dict:
    """Return a paginated, optionally filtered glossary.

    Query params:
        q        — full-text search across term, definition, and synonyms
        category — filter by category (concept | system | identifier | ...)
        limit    — page size (default 50, max 200)
        offset   — pagination offset (default 0)

    Response:
        { items: [...], total, limit, offset }
    """
    q = (params.get("q") or "").strip()
    category = (params.get("category") or "").strip()

    try:
        limit = min(int(params.get("limit") or 50), 200)
    except (TypeError, ValueError):
        limit = 50

    try:
        offset = max(int(params.get("offset") or 0), 0)
    except (TypeError, ValueError):
        offset = 0

    conn = db._get_conn()
    try:
        # Build WHERE clauses
        where_parts: list[str] = []
        bind: list = []

        if category:
            where_parts.append("category = ?")
            bind.append(category)

        if q:
            # Search term, definition, and synonyms (LIKE is case-insensitive in SQLite by default for ASCII)
            like = f"%{q}%"
            where_parts.append("(term LIKE ? OR definition LIKE ? OR synonyms LIKE ?)")
            bind.extend([like, like, like])

        where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

        # Count total matching rows
        count_sql = "SELECT COUNT(*) AS cnt FROM business_glossary " + where_sql
        total_row = conn.execute(count_sql, bind).fetchone()
        total = total_row["cnt"] if total_row else 0

        # Fetch page
        select_sql = (
            "SELECT id, term, definition, category, related_systems, synonyms, source "
            "FROM business_glossary " + where_sql +
            " ORDER BY term COLLATE NOCASE "
            "LIMIT ? OFFSET ?"
        )
        rows = conn.execute(select_sql, bind + [limit, offset]).fetchall()

        return {
            "items": [_row_to_glossary_item(r) for r in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GET /api/glossary/entity/{entityId}
# ---------------------------------------------------------------------------

@route("GET", "/api/glossary/entity/{entityId}")
def get_entity_glossary(params: dict) -> dict:
    """Return annotation and related glossary terms for a single entity.

    Path params:
        entityId — LandingzoneEntityId (integer)

    Response:
        {
          entityId,
          annotation: { businessName, description, domain, tags, source } | null,
          relatedTerms: [{ term, definition, category }]  (up to 10)
        }

    Related terms are found by matching the annotation's domain keyword
    against glossary category, related_systems, and definition fields.
    """
    try:
        entity_id = int(params.get("entityId", ""))
    except (TypeError, ValueError):
        raise HttpError("entityId must be an integer", 400)

    conn = db._get_conn()
    try:
        # 1. Load annotation
        ann_row = conn.execute(
            "SELECT entity_id, business_name, description, domain, tags, source "
            "FROM entity_annotations WHERE entity_id = ?",
            (entity_id,),
        ).fetchone()

        annotation = None
        domain_keyword = None

        if ann_row:
            annotation = {
                "businessName": ann_row["business_name"] or "",
                "description": ann_row["description"] or "",
                "domain": ann_row["domain"] or "",
                "tags": _parse_json_field(ann_row["tags"]),
                "source": ann_row["source"] or "",
            }
            domain_keyword = ann_row["domain"] or None

        # 2. Build related terms
        related_terms: list[dict] = []

        if domain_keyword:
            like = f"%{domain_keyword}%"
            rel_rows = conn.execute(
                "SELECT term, definition, category "
                "FROM business_glossary "
                "WHERE category LIKE ? OR related_systems LIKE ? OR definition LIKE ? "
                "ORDER BY term COLLATE NOCASE "
                "LIMIT 10",
                (like, like, like),
            ).fetchall()
            related_terms = [
                {
                    "term": r["term"],
                    "definition": r["definition"],
                    "category": r["category"] or "concept",
                }
                for r in rel_rows
            ]

        return {
            "entityId": entity_id,
            "annotation": annotation,
            "relatedTerms": related_terms,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# POST /api/glossary/seed
# ---------------------------------------------------------------------------

@route("POST", "/api/glossary/seed")
def seed_glossary(params: dict) -> dict:
    """Re-run the seed_glossary.py script via subprocess.

    Optional body params:
        knowledgePath — override default knowledge base path
        dbPath        — override default DB path

    Response:
        { status: "ok"|"error", output: str, error: str }
    """
    script_path = _SCRIPT_PATH.resolve()
    if not script_path.exists():
        raise HttpError(f"Seed script not found: {script_path}", 500)

    cmd = [sys.executable, str(script_path)]

    # Ignore user-supplied paths — always use defaults to prevent path traversal.
    # The seed script uses sensible defaults (sibling knowledge repo + control plane DB).

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        status = "ok" if result.returncode == 0 else "error"
        log.info("Glossary seed subprocess exited %d", result.returncode)
        return {
            "status": status,
            "output": result.stdout or "",
            "error": result.stderr or "",
        }
    except subprocess.TimeoutExpired:
        log.warning("Glossary seed subprocess timed out after 60s")
        raise HttpError("Seed script timed out after 60 seconds", 504)
    except OSError as exc:
        log.error("Failed to launch seed script: %s", exc)
        raise HttpError(f"Failed to launch seed script: {exc}", 500)


# ---------------------------------------------------------------------------
# GET /api/glossary/annotations/bulk
# ---------------------------------------------------------------------------

@route("GET", "/api/glossary/annotations/bulk")
def get_bulk_annotations(params: dict) -> list:
    """Return all entity annotations (id, business_name, description) in one call.

    Used by the catalog page to show descriptions without N+1 queries.

    Response:
        [
          { "entity_id": 1, "business_name": "...", "description": "..." },
          ...
        ]
    """
    conn = db._get_conn()
    try:
        rows = conn.execute(
            "SELECT entity_id, business_name, description "
            "FROM entity_annotations "
            "WHERE description IS NOT NULL AND description != '' "
            "ORDER BY entity_id",
        ).fetchall()

        return [
            {
                "entity_id": r["entity_id"],
                "business_name": r["business_name"] or "",
                "description": r["description"] or "",
            }
            for r in rows
        ]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GET /api/gold/domains
# ---------------------------------------------------------------------------

@route("GET", "/api/gold/domains")
def get_gold_domains(params: dict) -> list:
    """Return distinct gold-layer business domains with entity counts.

    Response:
        [
          { "name": "Finance", "entityCount": 42 },
          { "name": "Manufacturing", "entityCount": 15 },
          ...
        ]

    Only domains that are non-null and non-empty are returned, sorted
    alphabetically by name.
    """
    conn = db._get_conn()
    try:
        rows = conn.execute(
            "SELECT domain, COUNT(*) AS entity_count "
            "FROM entity_annotations "
            "WHERE domain IS NOT NULL AND domain != '' "
            "GROUP BY domain "
            "ORDER BY domain COLLATE NOCASE",
        ).fetchall()

        return [
            {"name": r["domain"], "entityCount": r["entity_count"]}
            for r in rows
        ]
    finally:
        conn.close()
