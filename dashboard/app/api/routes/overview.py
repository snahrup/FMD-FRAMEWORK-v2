"""Business Portal overview routes — KPIs, source health, and activity feed.

Endpoints:
    GET  /api/overview/kpis      — freshness, open alerts, source counts, quality avg
    GET  /api/overview/sources   — per-source health with entity counts and last refresh
    GET  /api/overview/activity  — last 20 pipeline activity events

Data source: SQLite via control_plane_db._get_conn()

Schema notes:
    entity_status  — (LandingzoneEntityId, Layer, Status, LoadEndDateTime, ...)
    lz_entities    — (LandingzoneEntityId, DataSourceId, SourceName, IsActive, ...)
    datasources    — (DataSourceId, Name, DisplayName, Namespace, IsActive, ...)
    quality_scores — (entity_id, composite_score, quality_tier, computed_at, ...)
"""
import logging

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.overview")


# ---------------------------------------------------------------------------
# GET /api/overview/kpis
# ---------------------------------------------------------------------------

@route("GET", "/api/overview/kpis")
def get_overview_kpis(params: dict) -> dict:
    """Return top-level KPI figures for the Business Portal overview page.

    Response shape:
        {
          freshness_pct:      float   -- % of active LZ entities with Status='success'
          freshness_on_time:  int     -- count of loaded active LZ entities
          freshness_total:    int     -- total active LZ entities
          open_alerts:        int     -- entities with quality_tier in ('bronze','unclassified')
          sources_online:     int     -- datasources where IsActive=1
          sources_total:      int     -- all datasources
          total_entities:     int     -- distinct entities in entity_status
          quality_avg:        float   -- mean composite_score across all scored entities
        }
    """
    conn = cpdb._get_conn()
    try:
        # ------------------------------------------------------------------
        # Freshness: LZ layer entities — count where Status = 'success'
        # ------------------------------------------------------------------
        freshness_row = conn.execute(
            """
            SELECT
                COALESCE(COUNT(*), 0)                                          AS total,
                COALESCE(SUM(CASE WHEN es.Status = 'success' THEN 1 ELSE 0 END), 0) AS loaded
            FROM entity_status es
            JOIN lz_entities   e  ON es.LandingzoneEntityId = e.LandingzoneEntityId
            WHERE es.Layer = 'LandingZone'
              AND e.IsActive = 1
            """
        ).fetchone()

        freshness_total   = freshness_row[0] if freshness_row else 0
        freshness_on_time = freshness_row[1] if freshness_row else 0
        freshness_pct = (
            round(freshness_on_time / freshness_total * 100, 1)
            if freshness_total > 0
            else 0.0
        )

        # ------------------------------------------------------------------
        # Open alerts: entities with lower-tier quality scores
        # ------------------------------------------------------------------
        alerts_row = conn.execute(
            "SELECT COALESCE(COUNT(*), 0) FROM quality_scores WHERE quality_tier IN ('bronze', 'unclassified')"
        ).fetchone()
        open_alerts = alerts_row[0] if alerts_row else 0

        # ------------------------------------------------------------------
        # Source counts
        # ------------------------------------------------------------------
        sources_row = conn.execute(
            "SELECT COALESCE(COUNT(*),0), COALESCE(SUM(CASE WHEN IsActive=1 THEN 1 ELSE 0 END),0) FROM datasources"
        ).fetchone()
        sources_total  = sources_row[0] if sources_row else 0
        sources_online = sources_row[1] if sources_row else 0

        # ------------------------------------------------------------------
        # Total distinct entities tracked in entity_status
        # ------------------------------------------------------------------
        entities_row = conn.execute(
            "SELECT COALESCE(COUNT(DISTINCT LandingzoneEntityId), 0) FROM entity_status"
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

    Response is a list of SourceHealth objects:
        [
          {
            name:          str   -- datasource.Name (internal key)
            displayName:   str   -- datasource.DisplayName or Name fallback
            status:        str   -- 'operational' | 'degraded' | 'offline'
            entityCount:   int   -- active LZ entities for this source
            lastRefreshed: str   -- ISO timestamp of most recent successful load
          },
          ...
        ]

    Status logic:
        - 'degraded'    if any entity has Status = 'error'
        - 'offline'     if source is inactive OR no entities have ever loaded
        - 'operational' otherwise
    """
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            """
            SELECT
                ds.DataSourceId,
                ds.Name,
                ds.DisplayName,
                ds.IsActive,
                COUNT(e.LandingzoneEntityId)                             AS entity_count,
                SUM(CASE WHEN es.Status = 'success' THEN 1 ELSE 0 END)  AS loaded_count,
                SUM(CASE WHEN es.Status = 'error'   THEN 1 ELSE 0 END)  AS error_count,
                MAX(CASE WHEN es.Status = 'success' THEN es.LoadEndDateTime ELSE NULL END)
                                                                         AS last_refreshed
            FROM datasources ds
            LEFT JOIN lz_entities  e  ON e.DataSourceId = ds.DataSourceId
                                      AND e.IsActive = 1
            LEFT JOIN entity_status es ON es.LandingzoneEntityId = e.LandingzoneEntityId
                                       AND es.Layer = 'LandingZone'
            GROUP BY ds.DataSourceId
            ORDER BY ds.Name
            """
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

    Each event represents a single entity-layer load record, ordered most
    recent first.

    Response is a list of ActivityEvent objects:
        [
          {
            entityName:   str   -- lz_entities.SourceName
            source:       str   -- datasources.Name
            layer:        str   -- entity_status.Layer
            status:       str   -- entity_status.Status
            lastLoadDate: str   -- entity_status.LoadEndDateTime (ISO)
          },
          ...
        ]
    """
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            """
            SELECT
                e.SourceName        AS entity_name,
                ds.Name             AS source,
                es.Layer            AS layer,
                es.Status           AS status,
                es.LoadEndDateTime  AS last_load_date
            FROM entity_status es
            JOIN lz_entities  e  ON es.LandingzoneEntityId = e.LandingzoneEntityId
            JOIN datasources  ds ON e.DataSourceId = ds.DataSourceId
            WHERE es.LoadEndDateTime IS NOT NULL
            ORDER BY es.LoadEndDateTime DESC
            LIMIT 20
            """
        ).fetchall()

        return [
            {
                "entityName":   r["entity_name"],
                "source":       r["source"],
                "layer":        r["layer"],
                "status":       r["status"],
                "lastLoadDate": r["last_load_date"],
            }
            for r in rows
        ]

    except Exception:
        log.exception("Failed to load overview activity")
        raise HttpError("Failed to load overview activity", 500)

    finally:
        conn.close()
