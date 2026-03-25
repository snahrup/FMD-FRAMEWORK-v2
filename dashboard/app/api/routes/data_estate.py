"""Data Estate aggregation route — single endpoint for the estate overview page.

Combines source stats, layer progress, classification coverage, schema validation,
and Purview status into one response to avoid 7+ separate frontend calls.

Endpoints:
    GET /api/estate/overview — aggregated estate overview
"""

import logging
from datetime import datetime, timezone

from dashboard.app.api.router import route, HttpError
import dashboard.app.api.control_plane_db as cpdb

log = logging.getLogger("fmd.routes.data_estate")

_SYSTEM_SOURCES = ("CUSTOM_NOTEBOOK", "LH_DATA_LANDINGZONE")


@route("GET", "/api/estate/overview")
def get_estate_overview(params, body=None, headers=None):
    """Single aggregated response for the Data Estate page."""
    conn = cpdb.get_connection()

    try:
        # ── Sources ─────────────────────────────────────────────────────
        placeholders = ",".join("?" for _ in _SYSTEM_SOURCES)
        source_rows = conn.execute(f"""
            WITH latest_status AS (
                SELECT EntityId, Status, created_at,
                       ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
                FROM engine_task_log
            )
            SELECT
                ds.DataSourceId, ds.Name, ds.DisplayName, ds.IsActive,
                COUNT(e.LandingzoneEntityId) AS entity_count,
                SUM(CASE WHEN ls.Status = 'succeeded' THEN 1 ELSE 0 END) AS loaded_count,
                SUM(CASE WHEN ls.Status = 'failed' THEN 1 ELSE 0 END) AS error_count,
                MAX(CASE WHEN ls.Status = 'succeeded' THEN ls.created_at ELSE NULL END) AS last_refreshed
            FROM datasources ds
            LEFT JOIN lz_entities e ON e.DataSourceId = ds.DataSourceId AND e.IsActive = 1
            LEFT JOIN latest_status ls ON ls.EntityId = e.LandingzoneEntityId AND ls.rn = 1
            WHERE ds.Name NOT IN ({placeholders})
            GROUP BY ds.DataSourceId
            HAVING entity_count > 0
            ORDER BY ds.DisplayName
        """, tuple(_SYSTEM_SOURCES)).fetchall()

        sources = []
        for r in source_rows:
            is_active = int(r[3] or 0) == 1
            error_count = int(r[6] or 0)
            loaded_count = int(r[5] or 0)
            entity_count = int(r[4] or 0)
            if not is_active:
                status = "offline"
            elif error_count > 0:
                status = "degraded"
            elif loaded_count == 0:
                status = "offline"
            else:
                status = "operational"
            sources.append({
                "name": r[1],
                "displayName": r[2] or r[1],
                "status": status,
                "entityCount": entity_count,
                "loadedCount": loaded_count,
                "errorCount": error_count,
                "lastRefreshed": str(r[7]) if r[7] else None,
            })

        # ── Layer Stats ─────────────────────────────────────────────────
        total_lz = conn.execute("SELECT COUNT(*) FROM lz_entities WHERE IsActive = 1").fetchone()[0] or 0
        total_bronze = conn.execute("SELECT COUNT(*) FROM bronze_entities WHERE IsActive = 1").fetchone()[0] or 0
        total_silver = conn.execute("SELECT COUNT(*) FROM silver_entities WHERE IsActive = 1").fetchone()[0] or 0

        # Loaded counts per layer (from engine_task_log)
        layer_stats_rows = conn.execute("""
            WITH latest AS (
                SELECT EntityId, Layer, Status,
                       ROW_NUMBER() OVER (PARTITION BY EntityId, Layer ORDER BY created_at DESC) AS rn
                FROM engine_task_log
            )
            SELECT Layer,
                   SUM(CASE WHEN Status = 'succeeded' THEN 1 ELSE 0 END) AS loaded,
                   SUM(CASE WHEN Status = 'failed' THEN 1 ELSE 0 END) AS failed,
                   MAX(created_at) AS last_load
            FROM latest WHERE rn = 1
            GROUP BY Layer
        """).fetchall()

        layer_map = {}
        for r in layer_stats_rows:
            layer_map[r[0]] = {"loaded": r[1] or 0, "failed": r[2] or 0, "lastLoad": r[3]}

        layers = [
            {
                "name": "Landing Zone",
                "key": "landing",
                "color": "var(--bp-lz)",
                "registered": total_lz,
                "loaded": layer_map.get("landing", {}).get("loaded", 0),
                "failed": layer_map.get("landing", {}).get("failed", 0),
                "lastLoad": layer_map.get("landing", {}).get("lastLoad"),
                "coveragePct": round(layer_map.get("landing", {}).get("loaded", 0) / max(total_lz, 1) * 100, 1),
            },
            {
                "name": "Bronze",
                "key": "bronze",
                "color": "var(--bp-bronze)",
                "registered": total_bronze,
                "loaded": layer_map.get("bronze", {}).get("loaded", 0),
                "failed": layer_map.get("bronze", {}).get("failed", 0),
                "lastLoad": layer_map.get("bronze", {}).get("lastLoad"),
                "coveragePct": round(layer_map.get("bronze", {}).get("loaded", 0) / max(total_bronze, 1) * 100, 1),
            },
            {
                "name": "Silver",
                "key": "silver",
                "color": "var(--bp-silver)",
                "registered": total_silver,
                "loaded": layer_map.get("silver", {}).get("loaded", 0),
                "failed": layer_map.get("silver", {}).get("failed", 0),
                "lastLoad": layer_map.get("silver", {}).get("lastLoad"),
                "coveragePct": round(layer_map.get("silver", {}).get("loaded", 0) / max(total_silver, 1) * 100, 1),
            },
            {
                "name": "Gold",
                "key": "gold",
                "color": "var(--bp-gold)",
                "registered": 0,
                "loaded": layer_map.get("gold", {}).get("loaded", 0),
                "failed": layer_map.get("gold", {}).get("failed", 0),
                "lastLoad": layer_map.get("gold", {}).get("lastLoad"),
                "coveragePct": 0,
            },
        ]

        # ── Classification ──────────────────────────────────────────────
        classified_count = conn.execute(
            "SELECT COUNT(*) FROM column_classifications WHERE sensitivity_level != 'public'"
        ).fetchone()[0] or 0
        total_columns = conn.execute("SELECT COUNT(*) FROM column_metadata").fetchone()[0] or 0
        pii_count = conn.execute(
            "SELECT COUNT(*) FROM column_classifications WHERE sensitivity_level = 'pii'"
        ).fetchone()[0] or 0

        classification = {
            "classifiedColumns": classified_count,
            "totalColumns": total_columns,
            "coveragePct": round(classified_count / max(total_columns, 1) * 100, 1),
            "piiCount": pii_count,
        }

        # ── Schema Validation ───────────────────────────────────────────
        sv_row = conn.execute("""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS passed,
                   SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) AS failed
            FROM schema_validations
        """).fetchone()

        schema_validation = {
            "total": sv_row[0] or 0,
            "passed": sv_row[1] or 0,
            "failed": sv_row[2] or 0,
        }

        # ── Purview Status ──────────────────────────────────────────────
        mapping_count = conn.execute(
            "SELECT COUNT(*) FROM classification_type_mappings WHERE is_active = 1"
        ).fetchone()[0] or 0

        last_sync = conn.execute(
            "SELECT status, started_at FROM purview_sync_log ORDER BY started_at DESC LIMIT 1"
        ).fetchone()

        purview = {
            "mappingCount": mapping_count,
            "lastSyncStatus": last_sync[0] if last_sync else None,
            "lastSyncAt": last_sync[1] if last_sync else None,
            "status": "synced" if (last_sync and last_sync[0] == "completed") else "ready",
        }

        # ── Freshness ──────────────────────────────────────────────────
        last_activity = conn.execute("""
            SELECT MAX(created_at) FROM engine_task_log WHERE Status = 'succeeded'
        """).fetchone()

        last_run = conn.execute("""
            SELECT RunId, Status, StartedAt, CompletedAt
            FROM engine_runs ORDER BY StartedAt DESC LIMIT 1
        """).fetchone()

        freshness = {
            "lastSuccessfulLoad": last_activity[0] if last_activity else None,
            "lastRun": {
                "runId": last_run[0],
                "status": last_run[1],
                "startedAt": last_run[2],
                "completedAt": last_run[3],
            } if last_run else None,
        }

        return {
            "sources": sources,
            "layers": layers,
            "classification": classification,
            "schemaValidation": schema_validation,
            "purview": purview,
            "freshness": freshness,
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }

    except Exception as exc:
        log.exception("Estate overview failed: %s", exc)
        raise HttpError(f"Estate overview failed: {exc!s:.200}", 500)
