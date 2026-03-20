"""Business Portal overview routes — KPIs, source health, and activity feed.

Endpoints:
    GET  /api/overview/kpis      — freshness, open alerts, source counts, quality avg
    GET  /api/overview/sources   — per-source health with entity counts and last refresh
    GET  /api/overview/activity  — last 20 pipeline activity events

Data source: SQLite via control_plane_db._get_conn()

Schema (actual column names):
    engine_task_log — (EntityId, Layer['landing'|'bronze'|'silver'],
                       Status['succeeded'|'failed'|'skipped'], created_at, ...)
    lz_entities    — (LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, IsActive, ...)
    datasources    — (DataSourceId, Name, DisplayName, Namespace, IsActive, ...)
    quality_scores — (entity_id, composite_score, quality_tier, computed_at, ...)

System datasources (CUSTOM_NOTEBOOK, LH_DATA_LANDINGZONE) are excluded from
business-facing endpoints — they have 0 user entities and shouldn't appear.
"""
import logging

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.overview")

# Datasource names that are internal / system — never show in Business Portal
_SYSTEM_SOURCES = {"CUSTOM_NOTEBOOK", "LH_DATA_LANDINGZONE"}


# ---------------------------------------------------------------------------
# GET /api/overview/kpis
# ---------------------------------------------------------------------------

@route("GET", "/api/overview/kpis")
def get_overview_kpis(params: dict) -> dict:
    """Return top-level KPI figures for the Business Portal overview page."""
    conn = cpdb._get_conn()
    try:
        # ------------------------------------------------------------------
        # Freshness: across ALL layers, how many active entities were loaded
        # within the last 24 hours?  This is a time-based metric — "ever loaded"
        # would always converge to 100% and hide stale data.
        # ------------------------------------------------------------------
        freshness_row = conn.execute(
            """
            SELECT
                COUNT(DISTINCT e.LandingzoneEntityId) AS total,
                COUNT(DISTINCT CASE
                    WHEN t.Status = 'succeeded'
                         AND t.created_at >= datetime('now', '-24 hours')
                    THEN e.LandingzoneEntityId END) AS fresh
            FROM lz_entities e
            LEFT JOIN engine_task_log t ON t.EntityId = e.LandingzoneEntityId
            LEFT JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE e.IsActive = 1
              AND ds.Name NOT IN ({placeholders})
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchone()

        freshness_total   = freshness_row[0] if freshness_row else 0
        freshness_on_time = freshness_row[1] if freshness_row else 0
        freshness_pct = (
            round(freshness_on_time / freshness_total * 100, 1)
            if freshness_total > 0
            else 0.0
        )

        # ------------------------------------------------------------------
        # Open alerts: entities with error status on any layer (real operational failures)
        # Falls back to quality_scores if entity_status has no errors.
        # ------------------------------------------------------------------
        error_row = conn.execute(
            """
            WITH latest AS (
                SELECT EntityId, Status,
                       ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
                FROM engine_task_log
            )
            SELECT COALESCE(COUNT(DISTINCT l.EntityId), 0) AS error_count
            FROM latest l
            JOIN lz_entities e ON l.EntityId = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE l.rn = 1
              AND l.Status = 'failed'
              AND e.IsActive = 1
              AND ds.Name NOT IN ({placeholders})
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchone()
        open_alerts = error_row[0] if error_row else 0

        # Add quality-tier alerts if quality engine has been run
        quality_alerts_row = conn.execute(
            "SELECT COALESCE(COUNT(*), 0) FROM quality_scores WHERE quality_tier IN ('bronze', 'unclassified')"
        ).fetchone()
        if quality_alerts_row and quality_alerts_row[0] > 0:
            open_alerts += quality_alerts_row[0]

        # ------------------------------------------------------------------
        # Source counts — exclude system sources
        # ------------------------------------------------------------------
        sources_row = conn.execute(
            """
            SELECT
                COALESCE(COUNT(*), 0) AS total,
                COALESCE(SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END), 0) AS online
            FROM datasources
            WHERE Name NOT IN ({placeholders})
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchone()
        sources_total  = sources_row[0] if sources_row else 0
        sources_online = sources_row[1] if sources_row else 0

        # ------------------------------------------------------------------
        # Total active entities — exclude system sources
        # ------------------------------------------------------------------
        entities_row = conn.execute(
            """
            SELECT COALESCE(COUNT(*), 0)
            FROM lz_entities e
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE e.IsActive = 1
              AND ds.Name NOT IN ({placeholders})
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchone()
        total_entities = entities_row[0] if entities_row else 0

        # ------------------------------------------------------------------
        # Quality average (composite_score across all scored entities)
        # ------------------------------------------------------------------
        quality_row = conn.execute(
            """
            SELECT AVG(composite_score) AS avg_score
            FROM quality_scores
            WHERE composite_score IS NOT NULL
            """
        ).fetchone()
        quality_avg = (
            round(float(quality_row["avg_score"]), 1)
            if quality_row and quality_row["avg_score"] is not None
            else 0.0
        )

        return {
            "freshness_pct":     freshness_pct,
            "freshness_on_time": freshness_on_time,
            "freshness_total":   freshness_total,
            "open_alerts":       open_alerts,
            "sources_online":    sources_online,
            "sources_total":     sources_total,
            "total_entities":    total_entities,
            "quality_avg":       quality_avg,
        }

    except Exception as exc:
        log.error("KPI failure detail: %s at %s", exc, exc.__traceback__.tb_lineno if exc.__traceback__ else "?")
        log.exception("Failed to compute overview KPIs")
        raise HttpError("Failed to compute overview KPIs", 500)

    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GET /api/overview/sources
# ---------------------------------------------------------------------------

@route("GET", "/api/overview/sources")
def get_overview_sources(params: dict) -> list:
    """Return health summary for each registered data source.

    Excludes system sources (CUSTOM_NOTEBOOK, LH_DATA_LANDINGZONE).

    Status logic:
        - 'degraded'    if any entity has Status = 'error' (not currently in data)
        - 'offline'     if source is inactive OR no entities have ever loaded
        - 'operational' otherwise (has at least one loaded entity)
    """
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            """
            WITH latest_status AS (
                SELECT EntityId, Status, created_at,
                       ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
                FROM engine_task_log
            )
            SELECT
                ds.DataSourceId,
                ds.Name,
                ds.DisplayName,
                ds.IsActive,
                COUNT(e.LandingzoneEntityId)                                          AS entity_count,
                SUM(CASE WHEN ls.Status = 'succeeded' THEN 1 ELSE 0 END)             AS loaded_count,
                SUM(CASE WHEN ls.Status = 'failed' THEN 1 ELSE 0 END)                AS error_count,
                MAX(CASE WHEN ls.Status = 'succeeded' THEN ls.created_at ELSE NULL END)
                                                                                       AS last_refreshed
            FROM datasources ds
            LEFT JOIN lz_entities  e  ON e.DataSourceId = ds.DataSourceId
                                       AND e.IsActive = 1
            LEFT JOIN latest_status ls ON ls.EntityId = e.LandingzoneEntityId AND ls.rn = 1
            WHERE ds.Name NOT IN ({placeholders})
            GROUP BY ds.DataSourceId
            HAVING entity_count > 0
            ORDER BY ds.DisplayName
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchall()

        result = []
        for r in rows:
            is_active     = int(r["IsActive"] or 0) == 1
            error_count   = int(r["error_count"]  or 0)
            loaded_count  = int(r["loaded_count"] or 0)
            entity_count  = int(r["entity_count"] or 0)
            last_refreshed = r["last_refreshed"]

            if not is_active:
                status = "offline"
            elif error_count > 0:
                status = "degraded"
            elif loaded_count == 0:
                status = "offline"
            else:
                status = "operational"

            result.append({
                "name":          r["Name"],
                "displayName":   r["DisplayName"] or r["Name"],
                "status":        status,
                "entityCount":   entity_count,
                "lastRefreshed": str(last_refreshed) if last_refreshed else None,
            })

        return result

    except Exception:
        log.exception("Failed to load overview sources")
        raise HttpError("Failed to load overview sources", 500)

    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GET /api/overview/activity
# ---------------------------------------------------------------------------

@route("GET", "/api/overview/activity")
def get_overview_activity(params: dict) -> list:
    """Return the 20 most recent pipeline activity events.

    Uses actual column names: SourceSchema, SourceName (= table name).
    Excludes system sources.
    """
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            """
            SELECT
                CASE
                    WHEN e.SourceSchema IS NOT NULL AND e.SourceSchema != ''
                    THEN e.SourceSchema || '.' || e.SourceName
                    ELSE e.SourceName
                END AS entity_name,
                ds.Name             AS source,
                t.Layer             AS layer,
                t.Status            AS status,
                t.created_at        AS last_load_date
            FROM engine_task_log t
            JOIN lz_entities  e  ON t.EntityId = e.LandingzoneEntityId
            JOIN datasources  ds ON e.DataSourceId = ds.DataSourceId
            WHERE t.created_at IS NOT NULL
              AND ds.Name NOT IN ({placeholders})
            ORDER BY t.created_at DESC
            LIMIT 20
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchall()

        # Map raw entity_status.Status values to frontend-expected enum.
        # DB stores: 'loaded', 'not_started', 'error', '' etc.
        # Frontend expects: 'success', 'error', 'warning', 'running', 'pending'
        _STATUS_MAP = {
            "loaded": "success",
            "succeeded": "success",
            "not_started": "pending",
            "skipped": "pending",
            "error": "error",
            "failed": "error",
            "running": "running",
            "in_progress": "running",
            "": "pending",
        }

        return [
            {
                "entityName":   r["entity_name"],
                "source":       r["source"],
                "layer":        r["layer"],
                "status":       _STATUS_MAP.get((r["status"] or "").lower(), r["status"] or "pending"),
                "lastLoadDate": r["last_load_date"],
            }
            for r in rows
        ]

    except Exception:
        log.exception("Failed to load overview activity")
        raise HttpError("Failed to load overview activity", 500)

    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GET /api/overview/entities
# ---------------------------------------------------------------------------

@route("GET", "/api/overview/entities")
def get_overview_entities(params: dict) -> list:
    """Return enriched entity list for Business Portal sources/catalog pages.

    Each entity includes:
        - LandingzoneEntityId, SchemaName, TableName, SourceName (= source system)
        - DataSourceId, IsActive
        - LastLoadDate (most recent LoadEndDateTime across all layers)
        - BronzeStatus, SilverStatus (from entity_status per layer)

    Excludes system sources. Maps raw column names to what the frontend expects.
    """
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            """
            SELECT
                e.LandingzoneEntityId,
                e.SourceSchema,
                e.SourceName AS TableName,
                ds.Name       AS SourceName,
                ds.DisplayName AS SourceDisplayName,
                e.DataSourceId,
                e.IsActive,
                MAX(CASE WHEN es.Status = 'loaded' THEN es.LoadEndDateTime END) AS LastLoadDate,
                MAX(CASE WHEN es.Layer = 'bronze' AND es.Status = 'loaded'
                         THEN 'loaded' END) AS BronzeStatus,
                MAX(CASE WHEN es.Layer = 'silver' AND es.Status = 'loaded'
                         THEN 'loaded' END) AS SilverStatus
            FROM lz_entities e
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            LEFT JOIN entity_status es ON es.LandingzoneEntityId = e.LandingzoneEntityId
            WHERE e.IsActive = 1
              AND ds.Name NOT IN ({placeholders})
            GROUP BY e.LandingzoneEntityId
            ORDER BY ds.Name, e.SourceSchema, e.SourceName
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchall()

        return [
            {
                "LandingzoneEntityId": r["LandingzoneEntityId"],
                "SchemaName": r["SourceSchema"] or "",
                "TableName": r["TableName"] or "",
                "SourceName": r["SourceName"] or "",
                "SourceDisplayName": r["SourceDisplayName"] or r["SourceName"] or "",
                "DataSourceId": r["DataSourceId"],
                "IsActive": bool(r["IsActive"]),
                "LastLoadDate": r["LastLoadDate"],
                "BronzeStatus": r["BronzeStatus"],
                "SilverStatus": r["SilverStatus"],
            }
            for r in rows
        ]

    except Exception:
        log.exception("Failed to load overview entities")
        raise HttpError("Failed to load overview entities", 500)

    finally:
        conn.close()
