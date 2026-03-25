"""Schema validation routes — view Pandera validation results.

Endpoints:
    GET  /api/schema-validation/summary           — aggregate pass/fail counts
    GET  /api/schema-validation/run/{run_id}      — per-run results
    GET  /api/schema-validation/entity/{entity_id} — entity history
    GET  /api/schema-validation/coverage           — which entities have schemas
    POST /api/schema-validation/result             — engine posts validation results
"""

import json
import logging

from dashboard.app.api.router import route, HttpError
import dashboard.app.api.control_plane_db as cpdb

log = logging.getLogger("fmd.routes.schema_validation")


@route("GET", "/api/schema-validation/summary")
def get_summary(params, body, headers):
    """Aggregate pass/fail/warn counts across all validation runs."""
    conn = cpdb._get_conn()
    rows = conn.execute("""
        SELECT
            COUNT(*)                                    AS total,
            SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS passed,
            SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) AS failed,
            COUNT(DISTINCT entity_id)                    AS entities_validated,
            COUNT(DISTINCT run_id)                       AS runs_validated
        FROM schema_validations
    """).fetchone()

    # Coverage: count entities with registered schemas vs total
    total_entities = conn.execute("SELECT COUNT(*) FROM lz_entities WHERE IsActive = 1").fetchone()[0]

    # Get distinct entities that have at least one validation
    validated_entities = rows[3] if rows else 0

    return {
        "total_validations": rows[0] if rows else 0,
        "passed": rows[1] if rows else 0,
        "failed": rows[2] if rows else 0,
        "entities_validated": validated_entities,
        "runs_validated": rows[4] if rows else 0,
        "total_entities": total_entities,
        "coverage_pct": round((validated_entities / total_entities * 100) if total_entities > 0 else 0, 1),
    }


@route("GET", "/api/schema-validation/run/{run_id}")
def get_run(params, body, headers):
    """Per-run validation results (expandable per entity)."""
    run_id = params.get("run_id")
    if not run_id:
        raise HttpError(400, "run_id is required")

    conn = cpdb._get_conn()
    rows = conn.execute("""
        SELECT sv.id, sv.entity_id, sv.layer, sv.passed, sv.schema_name,
               sv.error_count, sv.errors_json, sv.validated_at,
               lz.SourceName, lz.SourceSchema
        FROM schema_validations sv
        LEFT JOIN lz_entities lz ON sv.entity_id = lz.LandingzoneEntityId
        WHERE sv.run_id = ?
        ORDER BY sv.passed ASC, sv.error_count DESC
    """, (run_id,)).fetchall()

    return {
        "run_id": run_id,
        "results": [
            {
                "id": r[0],
                "entity_id": r[1],
                "layer": r[2],
                "passed": bool(r[3]),
                "schema_name": r[4],
                "error_count": r[5],
                "errors": json.loads(r[6]) if r[6] else [],
                "validated_at": r[7],
                "source_name": r[8],
                "source_schema": r[9],
            }
            for r in rows
        ],
    }


@route("GET", "/api/schema-validation/entity/{entity_id}")
def get_entity_history(params, body, headers):
    """Validation history for a specific entity."""
    entity_id = params.get("entity_id")
    if not entity_id:
        raise HttpError(400, "entity_id is required")

    conn = cpdb._get_conn()
    rows = conn.execute("""
        SELECT id, run_id, layer, passed, schema_name,
               error_count, errors_json, validated_at
        FROM schema_validations
        WHERE entity_id = ?
        ORDER BY validated_at DESC
        LIMIT 50
    """, (entity_id,)).fetchall()

    return {
        "entity_id": int(entity_id),
        "validations": [
            {
                "id": r[0],
                "run_id": r[1],
                "layer": r[2],
                "passed": bool(r[3]),
                "schema_name": r[4],
                "error_count": r[5],
                "errors": json.loads(r[6]) if r[6] else [],
                "validated_at": r[7],
            }
            for r in rows
        ],
    }


@route("GET", "/api/schema-validation/coverage")
def get_coverage(params, body, headers):
    """Which entities have registered schemas (based on validation results)."""
    conn = cpdb._get_conn()

    # Entities that have been validated at least once
    validated = conn.execute("""
        SELECT DISTINCT sv.entity_id, lz.SourceName, lz.SourceSchema, sv.schema_name
        FROM schema_validations sv
        LEFT JOIN lz_entities lz ON sv.entity_id = lz.LandingzoneEntityId
        WHERE sv.schema_name IS NOT NULL
    """).fetchall()

    total_active = conn.execute("SELECT COUNT(*) FROM lz_entities WHERE IsActive = 1").fetchone()[0]

    return {
        "entities_with_schemas": len(validated),
        "total_active_entities": total_active,
        "coverage_pct": round((len(validated) / total_active * 100) if total_active > 0 else 0, 1),
        "covered": [
            {
                "entity_id": r[0],
                "source_name": r[1],
                "source_schema": r[2],
                "schema_name": r[3],
            }
            for r in validated
        ],
    }


@route("POST", "/api/schema-validation/result")
def post_result(params, body, headers):
    """Engine posts validation results after each extraction."""
    required = ["run_id", "entity_id", "passed"]
    for field in required:
        if field not in body:
            raise HttpError(400, f"Missing required field: {field}")

    conn = cpdb._get_conn()
    conn.execute("""
        INSERT INTO schema_validations (run_id, entity_id, layer, passed, schema_name, error_count, errors_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        body["run_id"],
        body["entity_id"],
        body.get("layer", "landing"),
        1 if body["passed"] else 0,
        body.get("schema_name"),
        body.get("error_count", 0),
        json.dumps(body.get("errors", [])),
    ))
    conn.commit()

    return {"status": "ok"}
