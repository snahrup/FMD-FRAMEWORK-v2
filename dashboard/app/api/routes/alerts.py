"""Business Portal alerts routes — compute alerts from existing SQLite data.

Endpoints:
    GET  /api/alerts  — on-the-fly alert computation from engine_task_log, lz_entities, datasources

Alert types:
    1. freshness  — entities whose last load exceeds freshness SLA, grouped by source
    2. connection — datasources that are inactive or have never loaded

Data source: SQLite via control_plane_db._get_conn()

Schema (actual column names):
    engine_task_log — (EntityId, Layer['landing'|'bronze'|'silver'],
                       Status['succeeded'|'failed'|'skipped'], created_at, ...)
    lz_entities     — (LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, IsActive, ...)
    datasources     — (DataSourceId, Name, DisplayName, Namespace, IsActive, ...)

System datasources (CUSTOM_NOTEBOOK, LH_DATA_LANDINGZONE) are excluded.
"""
import logging
from datetime import datetime, timezone, timedelta

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.alerts")

# Datasource names that are internal / system — never show in Business Portal
_SYSTEM_SOURCES = {"CUSTOM_NOTEBOOK", "LH_DATA_LANDINGZONE"}


def _today_tag() -> str:
    """Return ISO date string for deterministic alert IDs."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _placeholders() -> str:
    return ",".join("?" for _ in _SYSTEM_SOURCES)


def _system_tuple() -> tuple:
    return tuple(_SYSTEM_SOURCES)


# ---------------------------------------------------------------------------
# GET /api/alerts
# ---------------------------------------------------------------------------

@route("GET", "/api/alerts")
def get_alerts(params: dict) -> list:
    """Compute alerts on-the-fly from existing SQLite data.

    Query params:
        freshness_hours — SLA threshold in hours (default 24)

    Returns a sorted list of alert objects (critical first, then warning,
    then by tablesAffected descending).
    """
    freshness_hours = int(params.get("freshness_hours", "24"))
    today = _today_tag()
    now_utc = datetime.now(timezone.utc)

    conn = cpdb._get_conn()
    try:
        alerts: list[dict] = []

        # ==================================================================
        # 1. Freshness SLA breach — entities that loaded but are now stale
        #    (LoadEndDateTime older than threshold)
        # ==================================================================
        threshold_24 = (now_utc - timedelta(hours=freshness_hours)).isoformat()
        threshold_48 = (now_utc - timedelta(hours=48)).isoformat()

        freshness_rows = conn.execute(
            """
            WITH latest_status AS (
                SELECT EntityId, Layer, Status, created_at,
                       ROW_NUMBER() OVER (
                           PARTITION BY EntityId, Layer
                           ORDER BY created_at DESC,
                                    CASE Status WHEN 'succeeded' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END
                       ) AS rn
                FROM engine_task_log
            )
            SELECT
                ds.Name           AS source,
                ds.DisplayName    AS source_display,
                COUNT(*)          AS stale_count,
                MIN(ls.created_at) AS first_seen,
                SUM(CASE WHEN ls.created_at < ? THEN 1 ELSE 0 END) AS critical_count,
                GROUP_CONCAT(
                    CASE WHEN e.SourceSchema IS NOT NULL AND e.SourceSchema != ''
                         THEN e.SourceSchema || '.' || e.SourceName
                         ELSE e.SourceName END,
                    '||') AS entity_names
            FROM latest_status ls
            JOIN lz_entities  e  ON ls.EntityId = e.LandingzoneEntityId
            JOIN datasources  ds ON e.DataSourceId = ds.DataSourceId
            WHERE ls.rn = 1
              AND ls.Layer IN ('landing', 'bronze', 'silver')
              AND ls.Status = 'succeeded'
              AND ls.created_at IS NOT NULL
              AND ls.created_at < ?
              AND e.IsActive = 1
              AND ds.Name NOT IN ({ph})
            GROUP BY ds.DataSourceId
            ORDER BY COUNT(*) DESC
            """.format(ph=_placeholders()),
            (threshold_48,) + (threshold_24,) + _system_tuple(),
        ).fetchall()

        for r in freshness_rows:
            count = int(r["stale_count"])
            critical_count = int(r["critical_count"] or 0)
            source = r["source"]
            source_display = r["source_display"] or source
            severity = "critical" if critical_count > 0 else "warning"
            entity_list = (r["entity_names"] or "").split("||")
            first_five = [n for n in entity_list[:5] if n]

            alerts.append({
                "id": f"freshness-{source}-{today}",
                "type": "freshness",
                "severity": severity,
                "source": source,
                "sourceDisplay": source_display,
                "title": f"{source_display} \u2014 {count} tables past freshness SLA",
                "detail": (
                    f"{count} tables in {source_display} have not refreshed "
                    f"within the {freshness_hours}-hour SLA window."
                ),
                "tablesAffected": count,
                "firstSeen": r["first_seen"],
                "entities": first_five,
            })

        # ==================================================================
        # 2. Entities never loaded — active entities that are still
        #    'not_started' across all layers (never got data)
        # ==================================================================
        never_loaded_rows = conn.execute(
            """
            WITH latest_status AS (
                SELECT EntityId, Layer, Status,
                       ROW_NUMBER() OVER (
                           PARTITION BY EntityId, Layer
                           ORDER BY created_at DESC,
                                    CASE Status WHEN 'succeeded' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END
                       ) AS rn
                FROM engine_task_log
            )
            SELECT
                ds.Name           AS source,
                ds.DisplayName    AS source_display,
                COUNT(*)          AS pending_count,
                GROUP_CONCAT(
                    CASE WHEN e.SourceSchema IS NOT NULL AND e.SourceSchema != ''
                         THEN e.SourceSchema || '.' || e.SourceName
                         ELSE e.SourceName END,
                    '||') AS entity_names
            FROM lz_entities e
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            LEFT JOIN latest_status ls ON ls.EntityId = e.LandingzoneEntityId
                                        AND ls.rn = 1
                                        AND ls.Status = 'succeeded'
            WHERE e.IsActive = 1
              AND ls.EntityId IS NULL
              AND ds.Name NOT IN ({ph})
            GROUP BY ds.DataSourceId
            HAVING pending_count > 0
            ORDER BY pending_count DESC
            """.format(ph=_placeholders()),
            _system_tuple(),
        ).fetchall()

        for r in never_loaded_rows:
            count = int(r["pending_count"])
            source = r["source"]
            source_display = r["source_display"] or source
            severity = "warning" if count < 50 else "critical"
            entity_list = (r["entity_names"] or "").split("||")
            first_five = [n for n in entity_list[:5] if n]

            alerts.append({
                "id": f"pending-{source}-{today}",
                "type": "pending",
                "severity": severity,
                "source": source,
                "sourceDisplay": source_display,
                "title": f"{source_display} \u2014 {count} tables awaiting initial load",
                "detail": (
                    f"{count} active tables in {source_display} have never been loaded. "
                    f"These need an initial full load to become available."
                ),
                "tablesAffected": count,
                "firstSeen": None,
                "entities": first_five,
            })

        # ==================================================================
        # 3. Source offline — IsActive=0 OR no entities have ever loaded
        # ==================================================================
        offline_rows = conn.execute(
            """
            WITH latest_status AS (
                SELECT EntityId, Layer, Status, created_at,
                       ROW_NUMBER() OVER (
                           PARTITION BY EntityId, Layer
                           ORDER BY created_at DESC,
                                    CASE Status WHEN 'succeeded' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END
                       ) AS rn
                FROM engine_task_log
            )
            SELECT
                ds.Name          AS source,
                ds.DisplayName   AS source_display,
                ds.IsActive      AS is_active,
                COUNT(e.LandingzoneEntityId) AS entity_count,
                SUM(CASE WHEN ls.created_at IS NOT NULL THEN 1 ELSE 0 END) AS loaded_count
            FROM datasources ds
            LEFT JOIN lz_entities  e  ON e.DataSourceId = ds.DataSourceId
                                       AND e.IsActive = 1
            LEFT JOIN latest_status ls ON ls.EntityId = e.LandingzoneEntityId
                                        AND ls.Layer = 'landing'
                                        AND ls.rn = 1
                                        AND ls.Status = 'succeeded'
            WHERE ds.Name NOT IN ({ph})
            GROUP BY ds.DataSourceId
            HAVING entity_count > 0 AND (ds.IsActive = 0 OR loaded_count = 0)
            ORDER BY ds.Name
            """.format(ph=_placeholders()),
            _system_tuple(),
        ).fetchall()

        for r in offline_rows:
            source = r["source"]
            source_display = r["source_display"] or source

            alerts.append({
                "id": f"connection-{source}-{today}",
                "type": "connection",
                "severity": "critical",
                "source": source,
                "sourceDisplay": source_display,
                "title": f"{source_display} \u2014 source offline",
                "detail": (
                    f"{source_display} is either deactivated or has no entities "
                    f"that have completed an initial load."
                ),
                "tablesAffected": int(r["entity_count"] or 0),
                "firstSeen": None,
                "entities": [],
            })

        # ==================================================================
        # Sort: critical first, then warning, then by tablesAffected desc
        # ==================================================================
        severity_order = {"critical": 0, "warning": 1, "info": 2}
        alerts.sort(
            key=lambda a: (severity_order.get(a["severity"], 9), -a["tablesAffected"])
        )

        return alerts

    except Exception:
        log.exception("Failed to compute alerts")
        raise HttpError("Failed to compute alerts", 500)

    finally:
        conn.close()
