"""Data Estate aggregation route — single endpoint for the estate overview page.

Combines source stats, layer progress, classification coverage, schema validation,
and Purview status into one response to avoid 7+ separate frontend calls.

Each section is independently wrapped so a missing table doesn't break the whole page.

Endpoints:
    GET /api/estate/overview — aggregated estate overview
"""

import logging
from datetime import datetime, timezone

from dashboard.app.api.router import route, HttpError
import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.routes.metrics_contract import build_metric_contract

log = logging.getLogger("fmd.routes.data_estate")

_SYSTEM_SOURCES = ("CUSTOM_NOTEBOOK", "LH_DATA_LANDINGZONE")


def _safe(fn, default, label: str):
    """Run fn(), return default on any error, log the failure."""
    try:
        return fn()
    except Exception as exc:
        log.warning("Estate overview — %s section failed: %s", label, exc)
        return default


@route("GET", "/api/estate/overview")
def get_estate_overview(params, body=None, headers=None):
    """Single aggregated response for the Data Estate page."""
    conn = cpdb._get_conn()
    contract = _safe(build_metric_contract, {
        "tables": {
            "inScope": {"value": 0},
            "landingLoaded": {"value": 0},
            "bronzeLoaded": {"value": 0},
            "silverLoaded": {"value": 0},
            "toolReady": {"value": 0},
            "blocked": {"value": 0},
        },
        "sources": {"bySource": [], "total": 0, "operational": 0},
        "lastSuccess": {"landing": None, "bronze": None, "silver": None},
    }, "metric_contract")

    # ── Sources ─────────────────────────────────────────────────────
    def _sources():
        result = []
        for source in sorted(contract["sources"]["bySource"], key=lambda item: item.get("displayName") or item["source"]):
            entity_count = int(source.get("tablesInScope") or 0)
            complete_count = int(source.get("silverLoaded") or 0)
            blocked_count = int(source.get("blocked") or 0)
            if entity_count == 0:
                status = "offline"
            elif blocked_count > 0:
                status = "degraded"
            else:
                status = "operational"
            result.append({
                "name": source["source"],
                "displayName": source.get("displayName") or source["source"],
                "status": status,
                "entityCount": entity_count,
                "loadedCount": complete_count,
                "errorCount": blocked_count,
                "lastRefreshed": None,
            })
        return result

    # ── Layer Stats ─────────────────────────────────────────────────
    def _layers():
        in_scope = int(contract["tables"]["inScope"]["value"] or 0)

        def _layer(name, key, metric_key, last_success_key, color):
            loaded = int(contract["tables"][metric_key]["value"] or 0)
            missing = max(in_scope - loaded, 0)
            return {
                "name": name, "key": key, "color": color,
                "inScope": in_scope,
                "loaded": loaded,
                "missing": missing,
                "lastLoad": contract["lastSuccess"][last_success_key],
                "coveragePct": round(loaded / max(in_scope, 1) * 100, 1),
            }

        return [
            _layer("Landing Zone", "landing", "landingLoaded", "landing", "var(--bp-lz)"),
            _layer("Bronze", "bronze", "bronzeLoaded", "bronze", "var(--bp-bronze)"),
            _layer("Silver", "silver", "silverLoaded", "silver", "var(--bp-silver)"),
        ]

    # ── Classification ──────────────────────────────────────────────
    def _classification():
        classified = conn.execute(
            "SELECT COUNT(*) FROM column_classifications WHERE sensitivity_level != 'public'"
        ).fetchone()[0] or 0
        total = conn.execute("SELECT COUNT(*) FROM column_metadata").fetchone()[0] or 0
        pii = conn.execute(
            "SELECT COUNT(*) FROM column_classifications WHERE sensitivity_level = 'pii'"
        ).fetchone()[0] or 0
        breakdown_rows = conn.execute("""
            SELECT sensitivity_level, COUNT(*) AS cnt
            FROM column_classifications
            GROUP BY sensitivity_level
        """).fetchall()
        total_classified = sum(r[1] for r in breakdown_rows) or 1
        breakdown = {r[0]: round(r[1] / total_classified * 100, 1) for r in breakdown_rows}
        return {
            "classifiedColumns": classified,
            "totalColumns": total,
            "coveragePct": round(classified / max(total, 1) * 100, 1),
            "piiCount": pii,
            "breakdown": breakdown,
        }

    # ── Schema Validation ───────────────────────────────────────────
    def _schema_validation():
        row = conn.execute("""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS passed,
                   SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) AS failed
            FROM schema_validations
        """).fetchone()
        return {"total": row[0] or 0, "passed": row[1] or 0, "failed": row[2] or 0}

    # ── Purview Status ──────────────────────────────────────────────
    def _purview():
        mapping_count = conn.execute(
            "SELECT COUNT(*) FROM classification_type_mappings WHERE is_active = 1"
        ).fetchone()[0] or 0
        last_sync = conn.execute(
            "SELECT status, started_at FROM purview_sync_log ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
        return {
            "mappingCount": mapping_count,
            "lastSyncStatus": last_sync[0] if last_sync else None,
            "lastSyncAt": last_sync[1] if last_sync else None,
            "status": "synced" if (last_sync and last_sync[0] == "completed") else "ready",
        }

    # ── Freshness ──────────────────────────────────────────────────
    def _freshness():
        last_activity = conn.execute(
            "SELECT MAX(created_at) FROM engine_task_log WHERE Status = 'succeeded'"
        ).fetchone()
        last_run = conn.execute(
            "SELECT RunId, Status, StartedAt, EndedAt FROM engine_runs ORDER BY StartedAt DESC LIMIT 1"
        ).fetchone()
        return {
            "lastSuccessfulLoad": last_activity[0] if last_activity else None,
            "lastRun": {
                "runId": last_run[0], "status": last_run[1],
                "startedAt": last_run[2], "completedAt": last_run[3],
            } if last_run else None,
        }

    # ── Assemble ───────────────────────────────────────────────────
    empty_classification = {"classifiedColumns": 0, "totalColumns": 0, "coveragePct": 0, "piiCount": 0, "breakdown": {}}
    empty_sv = {"total": 0, "passed": 0, "failed": 0}
    empty_purview = {"mappingCount": 0, "lastSyncStatus": None, "lastSyncAt": None, "status": "pending"}
    empty_freshness = {"lastSuccessfulLoad": None, "lastRun": None}

    return {
        "sources": _safe(_sources, [], "sources"),
        "layers": _safe(_layers, [], "layers"),
        "classification": _safe(_classification, empty_classification, "classification"),
        "schemaValidation": _safe(_schema_validation, empty_sv, "schema_validation"),
        "purview": _safe(_purview, empty_purview, "purview"),
        "freshness": _safe(_freshness, empty_freshness, "freshness"),
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
