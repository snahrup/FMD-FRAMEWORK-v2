"""Control plane, execution matrix, record counts, and entity listing routes.

Single data source: SQLite via control_plane_db.  All dual data path / Fabric
SQL fallback logic has been removed.  If the DB is missing or empty the
endpoints return empty structures (zero counts, empty lists) rather than
raising a 503.
"""
import logging
import time
from datetime import datetime, timezone

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.control_plane")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_active(val) -> bool:
    return str(val).lower() in ("true", "1")


def _build_control_plane() -> dict:
    """Assemble the /api/control-plane JSON from SQLite reads.

    Mirrors the shape of the old _sqlite_control_plane() in server.py.
    """
    now_utc = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    t0 = time.time()

    connections = cpdb.get_connections()
    datasources = cpdb.get_datasources()
    lz_entities = cpdb.get_lz_entities()
    bronze_entities = cpdb.get_bronze_entities()
    silver_entities = cpdb.get_silver_entities()
    lakehouses = cpdb.get_lakehouses()
    workspaces = cpdb.get_workspaces()
    pipelines = cpdb.get_pipelines()
    pipeline_runs_raw = cpdb.get_pipeline_runs_grouped()

    log.info("Control plane (SQLite): 9 reads in %.2fs", time.time() - t0)

    # Derive pipeline run statuses from log events
    pipeline_runs = []
    for run in pipeline_runs_raw:
        start_time = run.get("StartTime")
        end_time = run.get("EndTime")
        error_data = run.get("ErrorData") or ""
        end_data = run.get("EndLogData") or ""
        if error_data:
            status = "Failed"
        elif end_time and ("Error" in str(end_data) or "Fail" in str(end_data)):
            status = "Failed"
        elif end_time:
            status = "Succeeded"
        elif start_time:
            status = "InProgress"
        else:
            status = "Unknown"

        duration = None
        duration_sec = None
        if start_time and end_time:
            try:
                t_start = datetime.fromisoformat(str(start_time).replace("Z", ""))
                t_end = datetime.fromisoformat(str(end_time).replace("Z", ""))
                dur_sec = (t_end - t_start).total_seconds()
                duration_sec = dur_sec
                if dur_sec < 60:
                    duration = f"{int(dur_sec)}s"
                elif dur_sec < 3600:
                    duration = f"{int(dur_sec // 60)}m {int(dur_sec % 60)}s"
                else:
                    duration = f"{int(dur_sec // 3600)}h {int((dur_sec % 3600) // 60)}m"
            except Exception as e:
                log.debug("Failed to parse pipeline run duration: %s", e)

        pipeline_runs.append({
            "RunGuid": run.get("PipelineRunGuid", ""),
            "PipelineName": run.get("PipelineName", ""),
            "EntityLayer": run.get("EntityLayer", ""),
            "TriggerType": run.get("TriggerType", ""),
            "StartTime": str(start_time) if start_time else None,
            "EndTime": str(end_time) if end_time else None,
            "Status": status,
            "Duration": duration,
            "DurationSec": duration_sec,
        })

    # Aggregate by namespace (source system)
    source_systems: dict = {}
    for ds in datasources:
        ns = ds.get("Namespace", "Unknown") or "Unknown"
        if ns not in source_systems:
            source_systems[ns] = {
                "namespace": ns,
                "connections": [],
                "dataSources": [],
                "entities": {"landing": 0, "bronze": 0, "silver": 0},
                "activeEntities": {"landing": 0, "bronze": 0, "silver": 0},
            }
        source_systems[ns]["dataSources"].append({
            "name": ds.get("Name", ""),
            "type": ds.get("Type", ""),
            "isActive": ds.get("IsActive", 0),
            "connectionName": ds.get("ConnectionName", ""),
        })

    # Link connections to source systems
    conn_to_ns: dict = {}
    for ds in datasources:
        conn_to_ns[ds.get("ConnectionName", "")] = ds.get("Namespace", "Unknown") or "Unknown"
    for conn in connections:
        ns = conn_to_ns.get(conn.get("Name", ""), "Unlinked")
        if ns not in source_systems:
            source_systems[ns] = {
                "namespace": ns, "connections": [], "dataSources": [],
                "entities": {"landing": 0, "bronze": 0, "silver": 0},
                "activeEntities": {"landing": 0, "bronze": 0, "silver": 0},
            }
        source_systems[ns]["connections"].append({
            "name": conn.get("Name", ""),
            "type": conn.get("Type", ""),
            "isActive": conn.get("IsActive", 0),
        })

    for ent in lz_entities:
        ns = ent.get("Namespace", "Unknown") or "Unknown"
        if ns in source_systems:
            source_systems[ns]["entities"]["landing"] += 1
            if _is_active(ent.get("IsActive", "")):
                source_systems[ns]["activeEntities"]["landing"] += 1
    for ent in bronze_entities:
        ns = ent.get("Namespace", "Unknown") or "Unknown"
        if ns in source_systems:
            source_systems[ns]["entities"]["bronze"] += 1
            if _is_active(ent.get("IsActive", "")):
                source_systems[ns]["activeEntities"]["bronze"] += 1
    for ent in silver_entities:
        ns = ent.get("Namespace", "Unknown") or "Unknown"
        if ns in source_systems:
            source_systems[ns]["entities"]["silver"] += 1
            if _is_active(ent.get("IsActive", "")):
                source_systems[ns]["activeEntities"]["silver"] += 1

    active_conn = sum(1 for c in connections if _is_active(c.get("IsActive", "")))
    active_ds = sum(1 for d in datasources if _is_active(d.get("IsActive", "")))
    active_lz = sum(1 for e in lz_entities if _is_active(e.get("IsActive", "")))
    active_br = sum(1 for e in bronze_entities if _is_active(e.get("IsActive", "")))
    active_sv = sum(1 for e in silver_entities if _is_active(e.get("IsActive", "")))
    active_pl = sum(1 for p in pipelines if _is_active(p.get("IsActive", "")))

    succeeded_runs = sum(1 for r in pipeline_runs if r["Status"] == "Succeeded")
    failed_runs = sum(1 for r in pipeline_runs if r["Status"] == "Failed")
    running_now = sum(1 for r in pipeline_runs if r["Status"] == "InProgress")
    total_distinct_runs = len(pipeline_runs)

    if failed_runs > 0 and succeeded_runs == 0:
        health = "critical"
    elif failed_runs > 0:
        health = "warning"
    elif total_distinct_runs == 0 and active_conn > 0:
        health = "healthy"
    elif active_conn == 0:
        health = "setup"
    else:
        health = "healthy"

    lh_deduped = []
    lh_seen: set = set()
    for lh in lakehouses:
        lh_id = int(lh.get("LakehouseId", 0))
        env = "DEV" if lh_id <= 3 else "PROD"
        name = lh.get("Name", "")
        entry_key = f"{name}_{env}"
        if entry_key not in lh_seen:
            lh_seen.add(entry_key)
            lh_deduped.append({
                "LakehouseId": str(lh_id),
                "Name": name,
                "Environment": env,
            })

    return {
        "health": health,
        "lastRefreshed": now_utc,
        "_fromSnapshot": False,
        "_source": "sqlite",
        "summary": {
            "connections": {"total": len(connections), "active": active_conn},
            "dataSources": {"total": len(datasources), "active": active_ds},
            "entities": {
                "landing": {"total": len(lz_entities), "active": active_lz},
                "bronze": {"total": len(bronze_entities), "active": active_br},
                "silver": {"total": len(silver_entities), "active": active_sv},
            },
            "pipelines": {"total": len(pipelines), "active": active_pl},
            "lakehouses": len(set(lh.get("Name", "") for lh in lakehouses)),
            "workspaces": len(workspaces),
        },
        "pipelineHealth": {
            "recentRuns": total_distinct_runs,
            "succeeded": succeeded_runs,
            "failed": failed_runs,
            "running": running_now,
        },
        "sourceSystems": list(source_systems.values()),
        "lakehouses": lh_deduped,
        "workspaces": [
            {"WorkspaceId": w.get("WorkspaceId", ""), "Name": w.get("Name", "")}
            for w in workspaces
        ],
        "recentRuns": pipeline_runs[:15],
    }


def _build_execution_matrix() -> list[dict]:
    """Assemble /api/execution-matrix rows from SQLite.

    Mirrors the old _sqlite_execution_matrix() in server.py.
    """
    lz = cpdb.get_lz_entities()
    statuses = cpdb.get_canonical_entity_status()
    bronze_view = cpdb.get_bronze_view()
    silver_view = cpdb.get_silver_view()

    # Build status lookup: (LandingzoneEntityId, normalized_layer) -> status row
    # Layer values may be lowercase ('landing','bronze','silver') from resync/seed
    # or PascalCase ('LandingZone','Bronze','Silver') from engine writes.
    # Normalize to lowercase for consistent lookups.
    status_map: dict = {}
    for s in statuses:
        lz_id = s.get("LandingzoneEntityId")
        layer = (s.get("Layer") or "").lower()
        # Normalize 'landingzone' -> 'landing' for consistency
        if layer == "landingzone":
            layer = "landing"
        key = (lz_id, layer)
        # Keep the most recent / most useful status (loaded/succeeded beats not_started)
        existing = status_map.get(key)
        if existing:
            existing_status = (existing.get("Status") or "").lower()
            new_status = (s.get("Status") or "").lower()
            if existing_status in ("loaded", "succeeded") and new_status not in ("loaded", "succeeded"):
                continue  # keep the existing good status
        status_map[key] = s

    bronze_by_lz: dict = {}
    for b in bronze_view:
        lz_id = b.get("LandingzoneEntityId")
        if lz_id is not None:
            bronze_by_lz[int(lz_id)] = b

    silver_by_bronze: dict = {}
    for s in silver_view:
        br_id = s.get("BronzeLayerEntityId")
        if br_id is not None:
            silver_by_bronze[int(br_id)] = s

    results = []
    for entity in lz:
        lz_id = entity.get("LandingzoneEntityId")
        if lz_id is None:
            continue
        lz_id = int(lz_id)

        lz_status = status_map.get((lz_id, "landing"), {})
        bronze_status = status_map.get((lz_id, "bronze"), {})
        silver_status = status_map.get((lz_id, "silver"), {})

        br = bronze_by_lz.get(lz_id, {})
        br_id = br.get("BronzeLayerEntityId")
        sv = silver_by_bronze.get(int(br_id), {}) if br_id is not None else {}

        results.append({
            "LandingzoneEntityId": str(lz_id),
            "SourceSchema": entity.get("SourceSchema", ""),
            "SourceName": entity.get("SourceName", ""),
            "DataSourceName": entity.get("DataSourceName", ""),
            "Namespace": entity.get("Namespace", ""),
            "IsActive": entity.get("IsActive", 0),
            "IsIncremental": entity.get("IsIncremental", 0),
            "LZ_Status": lz_status.get("Status", "not_started"),
            "LZ_LastLoad": lz_status.get("LoadEndDateTime", ""),
            "Bronze_Status": bronze_status.get("Status", "not_started"),
            "Bronze_LastLoad": bronze_status.get("LoadEndDateTime", ""),
            "Silver_Status": silver_status.get("Status", "not_started"),
            "Silver_LastLoad": silver_status.get("LoadEndDateTime", ""),
            "BronzeLayerEntityId": str(br_id) if br_id else None,
            "SilverLayerEntityId": str(sv.get("SilverLayerEntityId", "")) if sv else None,
        })
    return results


def _build_record_counts() -> dict:
    """Assemble /api/record-counts grouped by namespace from SQLite.

    Mirrors the old _sqlite_record_counts() in server.py.
    """
    lz = cpdb.get_lz_entities()
    bronze = cpdb.get_bronze_entities()
    silver = cpdb.get_silver_entities()

    by_source: dict = {}

    for e in lz:
        ns = e.get("Namespace", "Unknown") or "Unknown"
        if ns not in by_source:
            by_source[ns] = {
                "source": ns, "landing": 0, "bronze": 0, "silver": 0,
                "activeLanding": 0, "activeBronze": 0, "activeSilver": 0,
            }
        by_source[ns]["landing"] += 1
        if _is_active(e.get("IsActive", "")):
            by_source[ns]["activeLanding"] += 1

    for e in bronze:
        ns = e.get("Namespace", "Unknown") or "Unknown"
        if ns not in by_source:
            by_source[ns] = {
                "source": ns, "landing": 0, "bronze": 0, "silver": 0,
                "activeLanding": 0, "activeBronze": 0, "activeSilver": 0,
            }
        by_source[ns]["bronze"] += 1
        if _is_active(e.get("IsActive", "")):
            by_source[ns]["activeBronze"] += 1

    for e in silver:
        ns = e.get("Namespace", "Unknown") or "Unknown"
        if ns not in by_source:
            by_source[ns] = {
                "source": ns, "landing": 0, "bronze": 0, "silver": 0,
                "activeLanding": 0, "activeBronze": 0, "activeSilver": 0,
            }
        by_source[ns]["silver"] += 1
        if _is_active(e.get("IsActive", "")):
            by_source[ns]["activeSilver"] += 1

    sources_list = sorted(by_source.values(), key=lambda x: x["source"])
    total = {
        "landing": sum(s["landing"] for s in sources_list),
        "bronze": sum(s["bronze"] for s in sources_list),
        "silver": sum(s["silver"] for s in sources_list),
    }

    return {
        "sources": sources_list,
        "total": total,
        "_source": "sqlite",
    }


def _build_sources() -> list[dict]:
    """Assemble /api/sources source-system list with entity counts from SQLite.

    Mirrors the old _sqlite_sources() in server.py.
    """
    datasources = cpdb.get_datasources()
    lz = cpdb.get_lz_entities()
    bronze = cpdb.get_bronze_entities()
    silver = cpdb.get_silver_entities()

    lz_by_ns: dict = {}
    for e in lz:
        ns = e.get("Namespace", "Unknown") or "Unknown"
        lz_by_ns[ns] = lz_by_ns.get(ns, 0) + 1

    br_by_ns: dict = {}
    for e in bronze:
        ns = e.get("Namespace", "Unknown") or "Unknown"
        br_by_ns[ns] = br_by_ns.get(ns, 0) + 1

    sv_by_ns: dict = {}
    for e in silver:
        ns = e.get("Namespace", "Unknown") or "Unknown"
        sv_by_ns[ns] = sv_by_ns.get(ns, 0) + 1

    seen: set = set()
    results = []
    for ds in datasources:
        ns = ds.get("Namespace", "Unknown") or "Unknown"
        if ns in seen:
            continue
        seen.add(ns)
        results.append({
            "namespace": ns,
            "name": ds.get("Name", ""),
            "connectionName": ds.get("ConnectionName", ""),
            "isActive": ds.get("IsActive", 0),
            "entityCounts": {
                "landing": lz_by_ns.get(ns, 0),
                "bronze": br_by_ns.get(ns, 0),
                "silver": sv_by_ns.get(ns, 0),
            },
        })
    return results


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@route("GET", "/api/control-plane")
def get_control_plane(params):
    """Aggregate read-only view of the entire data platform."""
    return _build_control_plane()


@route("GET", "/api/connections")
def get_connections(params):
    """All registered source connections."""
    return cpdb.get_connections()


@route("GET", "/api/datasources")
def get_datasources(params):
    """All registered data sources."""
    return cpdb.get_datasources()


# ── Palette for source color assignment (stable by index) ──
_SOURCE_COLORS = [
    {"key": "blue",    "bg": "bg-blue-500/10",    "text": "text-blue-400",    "ring": "ring-blue-500/30",    "bar": "bg-blue-500",    "hex": "#3b82f6"},
    {"key": "emerald", "bg": "bg-emerald-500/10", "text": "text-emerald-400", "ring": "ring-emerald-500/30", "bar": "bg-emerald-500", "hex": "#10b981"},
    {"key": "amber",   "bg": "bg-amber-500/10",   "text": "text-amber-400",   "ring": "ring-amber-500/30",   "bar": "bg-amber-500",   "hex": "#f59e0b"},
    {"key": "violet",  "bg": "bg-violet-500/10",  "text": "text-violet-400",  "ring": "ring-violet-500/30",  "bar": "bg-violet-500",  "hex": "#8b5cf6"},
    {"key": "rose",    "bg": "bg-rose-500/10",    "text": "text-rose-400",    "ring": "ring-rose-500/30",    "bar": "bg-rose-500",    "hex": "#f43f5e"},
    {"key": "cyan",    "bg": "bg-cyan-500/10",    "text": "text-cyan-400",    "ring": "ring-cyan-500/30",    "bar": "bg-cyan-500",    "hex": "#06b6d4"},
    {"key": "orange",  "bg": "bg-orange-500/10",  "text": "text-orange-400",  "ring": "ring-orange-500/30",  "bar": "bg-orange-500",  "hex": "#f97316"},
    {"key": "teal",    "bg": "bg-teal-500/10",    "text": "text-teal-400",    "ring": "ring-teal-500/30",    "bar": "bg-teal-500",    "hex": "#14b8a6"},
]
_DEFAULT_COLOR = {"key": "slate", "bg": "bg-slate-500/10", "text": "text-slate-400", "ring": "ring-slate-500/30", "bar": "bg-slate-500", "hex": "#64748b"}


@route("GET", "/api/source-config")
def get_source_config(params):
    """Source config — builds labelMap + colorMap for the frontend useSourceConfig hook."""
    rows = cpdb.get_source_config()
    sources = []
    label_map: dict[str, str] = {}
    color_map: dict[str, dict] = {}

    for i, r in enumerate(rows):
        display = r.get("DisplayName") or r.get("Namespace") or r.get("Name") or "Unknown"
        color = _SOURCE_COLORS[i % len(_SOURCE_COLORS)]
        info = {
            "id": r["DataSourceId"],
            "name": r["Name"],
            "namespace": r.get("Namespace") or "",
            "label": display,
            "type": r.get("Type") or "",
            "description": r.get("Description") or "",
            "connectionName": r.get("ConnectionName") or "",
            "serverName": r.get("ServerName") or "",
            "databaseName": r.get("DatabaseName") or "",
            "isActive": bool(r.get("IsActive")),
            "color": color,
        }
        sources.append(info)

        # Map every possible raw identifier to the display name
        for key in [r["Name"], r.get("Namespace"), r.get("DatabaseName"),
                     r.get("ServerName"), r.get("ConnectionName")]:
            if key:
                label_map[key] = display
                label_map[key.lower()] = display
        # Also map the display name to itself
        label_map[display] = display
        label_map[display.lower()] = display

        for key in [r["Name"], r.get("Namespace"), r.get("DatabaseName"),
                     r.get("ServerName"), r.get("ConnectionName"), display]:
            if key:
                color_map[key] = color
                color_map[key.lower()] = color

    return {"sources": sources, "labelMap": label_map, "colorMap": color_map}


@route("GET", "/api/entities")
def get_entities(params):
    """All registered LZ entities (full join including connection/datasource info)."""
    return cpdb.get_registered_entities_full()


@route("GET", "/api/execution-matrix")
def get_execution_matrix(params):
    """Per-entity load status across LZ/Bronze/Silver layers."""
    return _build_execution_matrix()


@route("GET", "/api/record-counts")
def get_record_counts(params):
    """Entity counts grouped by source system namespace."""
    return _build_record_counts()


@route("GET", "/api/sources")
def get_sources(params):
    """Source system list with entity counts per layer."""
    return _build_sources()
