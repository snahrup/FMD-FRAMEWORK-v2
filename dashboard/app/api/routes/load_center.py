"""Load Center routes — the single source of truth for what's loaded and how to run loads.

Covers:
    GET  /api/load-center/status       — table counts + row counts per source per layer
    POST /api/load-center/run          — smart one-click load (full/incremental/gap-fill/optimize)
    GET  /api/load-center/run-status   — current run progress
    POST /api/load-center/refresh      — force-refresh counts from SQL endpoint (background)
"""
import json
import logging
import os
import threading
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db
from dashboard.app.api.routes.data_access import (
    _get_config,
    _get_fabric_token,
    _query_lakehouse,
    _get_onelake_mount,
)

log = logging.getLogger("fmd.routes.load_center")

# Background run state — in-memory hot cache for the active run.
# Persisted to load_center_runs table at key transitions (start, phase change, complete, fail).
# On restart, _run_state resets to {"active": False} and we read from SQLite.
_run_state: dict = {"active": False}
_run_lock = threading.Lock()

# Background refresh state
_refresh_running = False
_refresh_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Run state persistence (RP-05)
# ---------------------------------------------------------------------------

def _persist_run(state: dict, run_id: int | None = None) -> int:
    """Write run state to SQLite. Returns the run ID (insert or update)."""
    if run_id is None:
        # INSERT new run
        row = db.query(
            "INSERT INTO load_center_runs (started_at, phase, active, plan_json, progress_json, triggered_by) "
            "VALUES (?, ?, 1, ?, ?, ?) RETURNING id",
            (
                state.get("startedAt", datetime.now(timezone.utc).isoformat()),
                state.get("phase", "starting"),
                json.dumps(state.get("plan")),
                json.dumps(state.get("progress", {})),
                state.get("triggeredBy", "load_center"),
            ),
        )
        return row[0]["id"] if row else 0
    else:
        # UPDATE existing run
        db.execute(
            "UPDATE load_center_runs SET "
            "  phase = ?, active = ?, progress_json = ?, error = ?, completed_at = ? "
            "WHERE id = ?",
            (
                state.get("phase", "unknown"),
                1 if state.get("active") else 0,
                json.dumps(state.get("progress", {})),
                state.get("error"),
                state.get("completedAt"),
                run_id,
            ),
        )
        return run_id


def _load_latest_run() -> dict:
    """Load the most recent run from SQLite. Returns run state dict."""
    rows = db.query(
        "SELECT * FROM load_center_runs ORDER BY id DESC LIMIT 1"
    )
    if not rows:
        return {"active": False}
    r = rows[0]
    result = {
        "active": bool(r.get("active")),
        "startedAt": r.get("started_at"),
        "completedAt": r.get("completed_at"),
        "phase": r.get("phase"),
        "error": r.get("error"),
        "runId": r.get("id"),
    }
    try:
        result["plan"] = json.loads(r.get("plan_json") or "{}")
    except (json.JSONDecodeError, TypeError):
        result["plan"] = {}
    try:
        result["progress"] = json.loads(r.get("progress_json") or "{}")
    except (json.JSONDecodeError, TypeError):
        result["progress"] = {}
    return result


def _mark_interrupted_runs():
    """On startup, mark any 'active' runs as interrupted (server crashed mid-run)."""
    db.execute(
        "UPDATE load_center_runs SET active = 0, phase = 'interrupted', "
        "  completed_at = ? WHERE active = 1",
        (datetime.now(timezone.utc).isoformat(),),
    )


# Mark interrupted runs on module load (handles restart case)
try:
    _mark_interrupted_runs()
except Exception:
    log.debug("_mark_interrupted_runs skipped — table may not exist yet on first run")


# ---------------------------------------------------------------------------
# PRIMARY: Read row counts from engine_task_log (instant, no Fabric calls)
# ---------------------------------------------------------------------------

def _get_counts_from_log() -> dict:
    """Get the latest successful row counts per entity per layer from engine_task_log.

    This is the primary data source. The engine already records RowsWritten
    for every entity on every load. We just read the most recent successful
    entry per entity per layer — one SQLite query, instant.
    """
    rows = db.query("""
        SELECT
            t.EntityId,
            t.Layer,
            t.SourceTable,
            t.RowsWritten,
            t.TargetLakehouse,
            t.created_at,
            t.LoadType,
            le.SourceSchema,
            le.SourceName,
            le.IsIncremental,
            le.IsIncrementalColumn,
            le.IsActive,
            ds.Name AS source_name,
            ds.DisplayName AS source_display,
            ds.Namespace AS namespace,
            be.BronzeLayerEntityId,
            se.SilverLayerEntityId
        FROM engine_task_log t
        INNER JOIN (
            SELECT EntityId, Layer, MAX(id) AS max_id
            FROM engine_task_log
            WHERE LOWER(Status) = 'succeeded'
            GROUP BY EntityId, Layer
        ) latest ON t.id = latest.max_id
        JOIN lz_entities le ON t.EntityId = le.LandingzoneEntityId
        JOIN datasources ds ON le.DataSourceId = ds.DataSourceId
        LEFT JOIN bronze_entities be ON be.LandingzoneEntityId = le.LandingzoneEntityId
        LEFT JOIN silver_entities se ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        ORDER BY ds.Name, le.SourceSchema, le.SourceName
    """)
    return rows


def _get_all_registered() -> list[dict]:
    """Get ALL registered entities with their layer registrations.
    Used to detect gaps (registered but never loaded)."""
    return db.query("""
        SELECT
            le.LandingzoneEntityId AS entity_id,
            le.SourceSchema AS schema,
            le.SourceName AS table_name,
            le.IsIncremental,
            le.IsIncrementalColumn,
            le.IsActive,
            ds.Name AS source_name,
            ds.DisplayName AS source_display,
            ds.Namespace AS namespace,
            be.BronzeLayerEntityId,
            se.SilverLayerEntityId,
            w.LoadValue AS last_watermark
        FROM lz_entities le
        JOIN datasources ds ON le.DataSourceId = ds.DataSourceId
        LEFT JOIN bronze_entities be ON be.LandingzoneEntityId = le.LandingzoneEntityId
        LEFT JOIN silver_entities se ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        LEFT JOIN watermarks w ON le.LandingzoneEntityId = w.LandingzoneEntityId
        WHERE le.IsActive = 1
        ORDER BY ds.Name, le.SourceSchema, le.SourceName
    """)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@route("GET", "/api/load-center/status")
def get_load_center_status(params: dict) -> dict:
    """What has been successfully loaded, by source and layer.

    PRIMARY source: engine_task_log (authoritative — written by engine on every load).
    OPTIONAL enrichment: lakehouse_row_counts (physical scan cache — used when populated).

    See docs/architecture/FMD_DATA_BIBLE.md for classification details.
    """
    t_start = time.time()

    # 1. PRIMARY: engine_task_log — latest successful load per entity per layer
    log_rows = _get_counts_from_log()

    # 2. OPTIONAL: physical scan cache (may be empty — that's OK)
    physical = db.query(
        "SELECT lakehouse, schema_name, table_name, row_count, scanned_at "
        "FROM lakehouse_row_counts"
    )
    scan_meta = db.query(
        "SELECT MIN(scanned_at) AS oldest, MAX(scanned_at) AS newest "
        "FROM lakehouse_row_counts"
    )
    has_physical = len(physical) > 0

    # Index physical scan by (layer_key, schema, table)
    phys_lookup: dict[tuple, int] = {}
    for p in physical:
        lh = p.get("lakehouse", "")
        schema = p.get("schema_name", "").lower()
        table = p.get("table_name", "").lower()
        if "LANDING" in lh.upper():
            lk = "lz"
        elif "BRONZE" in lh.upper():
            lk = "bronze"
        elif "SILVER" in lh.upper():
            lk = "silver"
        else:
            continue
        phys_lookup[(lk, schema, table)] = int(p.get("row_count", -1))

    # 3. Index engine log by (layer_key, schema, table)
    #    Layer values in engine_task_log: "landing", "bronze", "silver"
    log_lookup: dict[tuple, dict] = {}
    for r in log_rows:
        raw_layer = (r.get("Layer") or "landing").lower()
        layer_key = "lz" if raw_layer == "landing" else raw_layer
        schema = (r.get("SourceSchema") or "").lower()
        table = (r.get("SourceName") or r.get("SourceTable") or "").lower()
        if "." in table:
            table = table.split(".")[-1]
        log_lookup[(layer_key, schema, table)] = r

    # 4. Registration lookup
    registered = _get_all_registered()
    reg_lookup: dict[tuple, dict] = {}
    for e in registered:
        schema = (e.get("schema") or "").lower()
        table = (e.get("table_name") or "").lower()
        reg_lookup[(schema, table)] = e

    # 5. Build source-level summary from REGISTERED entities,
    #    using engine log as primary, physical scan as enrichment.
    sources_map: dict[str, dict] = {}

    for e in registered:
        source = e.get("source_display") or e.get("source_name") or ""
        schema = (e.get("schema") or "").lower()
        table = (e.get("table_name") or "").lower()

        if source not in sources_map:
            sources_map[source] = {
                "name": source,
                "displayName": source,
                "lz": {"tables": 0, "rows": 0, "fullLoadTables": 0, "fullLoadRows": 0, "incrementalTables": 0, "incrementalDeltaRows": 0},
                "bronze": {"tables": 0, "rows": 0, "fullLoadTables": 0, "fullLoadRows": 0, "incrementalTables": 0, "incrementalDeltaRows": 0},
                "silver": {"tables": 0, "rows": 0, "fullLoadTables": 0, "fullLoadRows": 0, "incrementalTables": 0, "incrementalDeltaRows": 0},
            }

        src = sources_map[source]

        for layer_key in ("lz", "bronze", "silver"):
            log_entry = log_lookup.get((layer_key, schema, table))
            phys_rows = phys_lookup.get((layer_key, schema, table))

            # An entity counts as "loaded" if it has a successful engine log entry
            if log_entry is not None:
                src[layer_key]["tables"] += 1
                is_incr = bool(log_entry.get("IsIncremental"))
                row_val = int(log_entry.get("RowsWritten") or 0)

                # Prefer physical scan for row count (true total).
                # Fall back to engine log RowsWritten (latest run's written rows).
                if phys_rows is not None and phys_rows >= 0:
                    src[layer_key]["rows"] += phys_rows
                    # Physical scan is always the true total, regardless of load type
                    src[layer_key]["fullLoadRows"] += phys_rows
                    src[layer_key]["fullLoadTables"] += 1
                else:
                    src[layer_key]["rows"] += row_val
                    if is_incr:
                        src[layer_key]["incrementalTables"] += 1
                        src[layer_key]["incrementalDeltaRows"] += row_val
                    else:
                        src[layer_key]["fullLoadTables"] += 1
                        src[layer_key]["fullLoadRows"] += row_val

    # 6. Gap detection: entities with LZ success but missing Bronze/Silver success
    gaps: list[dict] = []
    for e in registered:
        schema = (e.get("schema") or "").lower()
        table = (e.get("table_name") or "").lower()
        source = e.get("source_display") or e.get("source_name") or schema

        in_lz = ("lz", schema, table) in log_lookup
        in_bronze = ("bronze", schema, table) in log_lookup
        in_silver = ("silver", schema, table) in log_lookup

        if in_lz and (not in_bronze or not in_silver):
            missing = []
            if not in_bronze:
                missing.append("bronze")
            if not in_silver:
                missing.append("silver")
            gaps.append({"source": source, "schema": schema, "table": table, "missingIn": missing})

    # 7. Detect orphan physical tables (in lakehouse but not registered)
    unmatched: list[dict] = []
    for p in physical:
        lh = p.get("lakehouse", "")
        schema = p.get("schema_name", "").lower()
        table = p.get("table_name", "").lower()
        if (schema, table) not in reg_lookup:
            lk = "lz" if "LANDING" in lh.upper() else "bronze" if "BRONZE" in lh.upper() else "silver"
            unmatched.append({"layer": lk, "schema": schema, "table": table})

    # 8. Build response
    sources_summary = sorted(sources_map.values(), key=lambda s: s["name"])

    totals = {}
    for layer_key in ("lz", "bronze", "silver"):
        totals[layer_key] = {
            "tables": sum(s[layer_key]["tables"] for s in sources_summary),
            "rows": sum(s[layer_key]["rows"] for s in sources_summary),
            "fullLoadTables": sum(s[layer_key]["fullLoadTables"] for s in sources_summary),
            "fullLoadRows": sum(s[layer_key]["fullLoadRows"] for s in sources_summary),
            "incrementalTables": sum(s[layer_key]["incrementalTables"] for s in sources_summary),
            "incrementalDeltaRows": sum(s[layer_key]["incrementalDeltaRows"] for s in sources_summary),
        }

    meta = scan_meta[0] if scan_meta else {}

    # Describe what data source is powering the numbers
    if has_physical:
        data_source = "engine_task_log (primary) + lakehouse_row_counts (row count enrichment)"
    else:
        data_source = "engine_task_log (latest successful run per entity per layer)"

    return {
        "sources": sources_summary,
        "totals": totals,
        "gaps": gaps[:100],
        "gapCount": len(gaps),
        "totalRegistered": len(registered),
        "unmatchedCount": len(unmatched),
        "orphanPhysicalTables": len(unmatched),
        "dataSource": data_source,
        "scannedAt": meta.get("newest"),
        "refreshRunning": _refresh_running,
        "runState": _run_state if _run_state.get("active") else _load_latest_run(),
        "queryTimeSec": round(time.time() - t_start, 3),
    }


@route("GET", "/api/load-center/source-detail")
def get_load_center_source_detail(params: dict) -> dict:
    """Drill into a specific source — every table with row counts per layer.
    Uses physical scan + engine log, same as status endpoint."""
    source_name = params.get("source", "")
    if not source_name:
        raise HttpError("source parameter required", 400)

    registered = _get_all_registered()
    log_rows = _get_counts_from_log()

    # Index engine log by (layer, schema, table)
    log_lookup: dict[tuple, dict] = {}
    for r in log_rows:
        layer = (r.get("Layer") or "landing").lower()
        schema = (r.get("SourceSchema") or "").lower()
        table = (r.get("SourceName") or r.get("SourceTable") or "").lower()
        if "." in table:
            table = table.split(".")[-1]
        log_lookup[(layer, schema, table)] = r

    # Index physical scan by (layer_key, schema, table)
    physical = db.query(
        "SELECT lakehouse, schema_name, table_name, row_count "
        "FROM lakehouse_row_counts"
    )
    phys_lookup: dict[tuple, int] = {}
    for p in physical:
        lh = p.get("lakehouse", "")
        lk = "lz" if "LANDING" in lh.upper() else "bronze" if "BRONZE" in lh.upper() else "silver"
        phys_lookup[(lk, p.get("schema_name", "").lower(), p.get("table_name", "").lower())] = int(p.get("row_count", -1))

    # Build table list
    tables_map: dict[tuple, dict] = {}

    for e in registered:
        src = e.get("source_display") or e.get("source_name") or ""
        if src.lower() != source_name.lower():
            continue

        schema = e.get("schema") or ""
        table = e.get("table_name") or ""
        key = (schema.lower(), table.lower())

        entry = {
            "schema": schema,
            "table": table,
            "lz": None,
            "bronze": None,
            "silver": None,
            "isIncremental": bool(e.get("IsIncremental")),
            "registered": True,
            "lastLoaded": None,
        }

        for layer_key, layer_name in [("lz", "landing"), ("bronze", "bronze"), ("silver", "silver")]:
            phys_rows = phys_lookup.get((layer_key, key[0], key[1]))
            log_entry = log_lookup.get((layer_name, key[0], key[1]))

            if phys_rows is not None and phys_rows >= 0:
                # Physical scan available — this is the true total row count
                entry[layer_key] = phys_rows
                entry[f"{layer_key}RowSource"] = "physical_scan"
            elif log_entry is not None:
                # Fall back to engine log RowsWritten (latest successful run).
                # For full loads this IS the total. For incremental loads this
                # is the delta from the most recent run — label accordingly.
                rows = int(log_entry.get("RowsWritten") or 0)
                entry[layer_key] = rows
                is_incr = bool(log_entry.get("IsIncremental"))
                entry[f"{layer_key}RowSource"] = "engine_log_incremental" if is_incr else "engine_log"
            # else: leave as None — entity never loaded for this layer

            if log_entry:
                if layer_key == "lz":
                    entry["lastLoaded"] = log_entry.get("created_at")
                    entry["lastLoadRows"] = int(log_entry.get("RowsWritten") or 0)
                    entry["lastLoadType"] = log_entry.get("LoadType")

        tables_map[key] = entry

    tables = sorted(tables_map.values(), key=lambda r: (r["schema"], r["table"]))

    has_any_physical = any(t.get("lzRowSource") == "physical_scan"
                           or t.get("bronzeRowSource") == "physical_scan"
                           or t.get("silverRowSource") == "physical_scan"
                           for t in tables)

    return {
        "source": source_name,
        "tables": tables,
        "tableCount": len(tables),
        "summary": {
            "lz": sum(1 for t in tables if t["lz"] is not None),
            "bronze": sum(1 for t in tables if t["bronze"] is not None),
            "silver": sum(1 for t in tables if t["silver"] is not None),
            "gaps": sum(1 for t in tables if t["lz"] is not None and (t["bronze"] is None or t["silver"] is None)),
        },
        "rowSource": "physical_scan + engine_log" if has_any_physical else "engine_log",
    }


@route("POST", "/api/load-center/refresh")
def post_load_center_refresh(params: dict) -> dict:
    """Force-refresh: update lakehouse_row_counts cache from SQL Analytics Endpoint.
    This is the OPTIONAL heavy path — only needed to cross-check against Fabric.
    Normal use just reads from engine_task_log (instant)."""
    global _refresh_running
    with _refresh_lock:
        if _refresh_running:
            return {"status": "already_running"}
        _refresh_running = True

    def _worker():
        global _refresh_running
        try:
            for lh_name in ("LH_DATA_LANDINGZONE", "LH_BRONZE_LAYER", "LH_SILVER_LAYER"):
                try:
                    rows = _query_lakehouse(
                        lh_name,
                        "SELECT s.name AS schema_name, t.name AS table_name, "
                        "       SUM(p.rows) AS row_count "
                        "FROM sys.tables t "
                        "JOIN sys.schemas s ON t.schema_id = s.schema_id "
                        "JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1) "
                        "GROUP BY s.name, t.name"
                    )
                    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    for r in rows:
                        db.execute(
                            "INSERT INTO lakehouse_row_counts "
                            "(lakehouse, schema_name, table_name, row_count, scanned_at) "
                            "VALUES (?, ?, ?, ?, ?) "
                            "ON CONFLICT(lakehouse, schema_name, table_name) DO UPDATE SET "
                            "row_count=excluded.row_count, scanned_at=excluded.scanned_at",
                            (lh_name, r.get("schema_name", ""), r.get("table_name", ""),
                             int(r.get("row_count", -1)), now),
                        )
                    log.info("Refreshed %s: %d tables from SQL endpoint", lh_name, len(rows))
                except Exception as e:
                    log.warning("SQL refresh failed for %s: %s", lh_name, e)
        finally:
            _refresh_running = False

    t = threading.Thread(target=_worker, daemon=True, name="load-center-refresh")
    t.start()
    return {"status": "started", "message": "Refreshing from SQL endpoint in background."}


@route("POST", "/api/load-center/run")
def post_load_center_run(params: dict) -> dict:
    """Smart one-click load. Handles:
    - Full loads for tables never loaded before
    - Incremental loads for tables with watermarks
    - Gap-filling: ensures Bronze/Silver exist for every LZ table
    - Auto-optimization: discovers watermarks for new tables, switches to incremental

    Body: { "sources": ["MES", "ETQ"] | null (all), "dryRun": bool }
    """
    with _run_lock:
        if _run_state.get("active"):
            return {"error": "A load is already running", "runState": _run_state}

    dry_run = params.get("dryRun", False)
    requested_sources = params.get("sources")  # null = all

    # Get all registered entities with their state
    entities = db.query(
        "SELECT le.LandingzoneEntityId, le.DataSourceId, le.SourceSchema, le.SourceName, "
        "       le.IsIncremental, le.IsIncrementalColumn, le.IsActive, "
        "       ds.Name AS source_name, ds.DisplayName AS source_display, "
        "       be.BronzeLayerEntityId, be.IsActive AS bronze_active, "
        "       se.SilverLayerEntityId, se.IsActive AS silver_active, "
        "       w.LoadValue AS last_watermark "
        "FROM lz_entities le "
        "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "LEFT JOIN bronze_entities be ON be.LandingzoneEntityId = le.LandingzoneEntityId "
        "LEFT JOIN silver_entities se ON se.BronzeLayerEntityId = be.BronzeLayerEntityId "
        "LEFT JOIN watermarks w ON le.LandingzoneEntityId = w.LandingzoneEntityId "
        "WHERE le.IsActive = 1 "
        "ORDER BY ds.Name, le.SourceSchema, le.SourceName"
    )

    # Filter by requested sources
    if requested_sources:
        req_lower = [s.lower() for s in requested_sources]
        entities = [e for e in entities if
                    (e.get("source_name") or "").lower() in req_lower or
                    (e.get("source_display") or "").lower() in req_lower]

    # Categorize each entity
    plan = {
        "fullLoad": [],       # Never loaded or no watermark
        "incremental": [],    # Has watermark + last value
        "gapFill": [],        # Exists in LZ but missing Bronze/Silver registration
        "needsOptimize": [],  # Not yet analyzed for watermark capability
        "totalEntities": len(entities),
    }

    for e in entities:
        entity_id = e["LandingzoneEntityId"]
        is_incr = bool(e.get("IsIncremental"))
        has_watermark_col = bool(e.get("IsIncrementalColumn"))
        has_last_value = bool(e.get("last_watermark"))
        has_bronze = bool(e.get("BronzeLayerEntityId"))
        has_silver = bool(e.get("SilverLayerEntityId"))

        entry = {
            "entityId": entity_id,
            "source": e.get("source_display") or e.get("source_name"),
            "schema": e.get("SourceSchema"),
            "table": e.get("SourceName"),
        }

        # Gap: missing Bronze or Silver registration
        if not has_bronze or not has_silver:
            plan["gapFill"].append({**entry, "missingBronze": not has_bronze, "missingSilver": not has_silver})

        # Determine load type
        if is_incr and has_watermark_col and has_last_value:
            plan["incremental"].append({**entry, "watermarkColumn": e.get("IsIncrementalColumn")})
        elif is_incr and has_watermark_col and not has_last_value:
            # Marked incremental but never loaded — needs full first
            plan["fullLoad"].append({**entry, "reason": "first_load_for_incremental"})
        elif not is_incr and not has_watermark_col:
            # Never analyzed for watermark capability
            plan["needsOptimize"].append(entry)
            plan["fullLoad"].append({**entry, "reason": "no_watermark_analysis"})
        else:
            plan["fullLoad"].append({**entry, "reason": "full_load_entity"})

    plan["summary"] = {
        "fullLoadCount": len(plan["fullLoad"]),
        "incrementalCount": len(plan["incremental"]),
        "gapFillCount": len(plan["gapFill"]),
        "needsOptimizeCount": len(plan["needsOptimize"]),
    }

    if dry_run:
        return {"dryRun": True, "plan": plan}

    # Actually trigger the load — mutate in-place to avoid reassigning the global dict
    with _run_lock:
        _run_state.clear()
        _run_state.update({
            "active": True,
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "plan": plan["summary"],
            "phase": "starting",
            "progress": {},
        })
        # Persist to SQLite (durable across restart/navigation)
        try:
            run_id = _persist_run(_run_state)
            _run_state["runId"] = run_id
        except Exception as e:
            log.warning("Failed to persist run start: %s", e)

    def _run_worker():
        run_id = _run_state.get("runId")
        try:
            _execute_smart_load(plan, _run_state)
        except Exception as e:
            log.error("Smart load failed: %s", e)
            _run_state["error"] = str(e)
            _run_state["phase"] = "failed"
        finally:
            _run_state["active"] = False
            _run_state["completedAt"] = datetime.now(timezone.utc).isoformat()
            # Persist final state to SQLite
            try:
                _persist_run(_run_state, run_id)
            except Exception as e:
                log.warning("Failed to persist run completion: %s", e)

    t = threading.Thread(target=_run_worker, daemon=True, name="smart-load")
    t.start()

    return {"status": "started", "plan": plan["summary"], "runState": _run_state}


def _execute_smart_load(plan: dict, state: dict):
    """Execute the smart load plan. Updates state dict in-place for progress tracking."""
    run_id = state.get("runId")

    def _persist_phase():
        """Persist state to SQLite at phase transitions."""
        try:
            if run_id:
                _persist_run(state, run_id)
        except Exception as e:
            log.debug("Phase persist failed: %s", e)

    # Phase 1: Gap-fill — ensure Bronze/Silver registrations exist
    if plan["gapFill"]:
        state["phase"] = "gap_fill"
        state["progress"]["gapFill"] = {"total": len(plan["gapFill"]), "done": 0}
        _persist_phase()
        for gap in plan["gapFill"]:
            entity_id = gap["entityId"]
            try:
                if gap.get("missingBronze"):
                    _ensure_bronze_registration(entity_id)
                if gap.get("missingSilver"):
                    _ensure_silver_registration(entity_id)
                state["progress"]["gapFill"]["done"] += 1
            except Exception as e:
                log.error("Gap-fill failed for entity %s: %s", entity_id, e)

    # Phase 2: Trigger the engine for all entities
    # Collect all entity IDs that need loading
    all_entity_ids = list(set(
        [e["entityId"] for e in plan["fullLoad"]] +
        [e["entityId"] for e in plan["incremental"]]
    ))

    if not all_entity_ids:
        state["phase"] = "complete"
        state["progress"]["message"] = "No entities to load"
        _persist_phase()
        return

    state["phase"] = "loading"
    state["progress"]["load"] = {
        "totalEntities": len(all_entity_ids),
        "fullLoad": len(plan["fullLoad"]),
        "incremental": len(plan["incremental"]),
    }
    _persist_phase()

    # Trigger the engine via internal HTTP call to /api/engine/start
    try:
        import urllib.request
        body = json.dumps({
            "mode": "run",
            "layers": ["landing", "bronze", "silver"],
            "entity_ids": all_entity_ids,
            "triggered_by": "load_center",
        }).encode()
        req = urllib.request.Request(
            "http://127.0.0.1:8787/api/engine/start",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())
        state["progress"]["load"]["engineResult"] = result
        state["phase"] = "engine_running"
        _persist_phase()

        # The engine runs async — we just report that it started
        # The frontend will poll /api/engine/status for detailed progress

    except Exception as e:
        # Engine not available — fall back to notebook trigger via REST API
        log.info("Engine start failed (%s), triggering via Fabric notebooks", e)
        state["phase"] = "notebook_trigger"
        _persist_phase()
        _trigger_notebooks_direct(state)


def _ensure_bronze_registration(lz_entity_id: int):
    """Auto-register a Bronze entity for a LZ entity that's missing one."""
    lz = db.query(
        "SELECT * FROM lz_entities WHERE LandingzoneEntityId = ?",
        (lz_entity_id,)
    )
    if not lz:
        return
    lz = lz[0]

    # Check if Bronze already exists
    existing = db.query(
        "SELECT BronzeLayerEntityId FROM bronze_entities WHERE LandingzoneEntityId = ?",
        (lz_entity_id,)
    )
    if existing:
        return

    db.execute(
        "INSERT INTO bronze_entities (LandingzoneEntityId, LakehouseId, IsActive) "
        "VALUES (?, ?, 1)",
        (lz_entity_id, lz.get("LakehouseId")),
    )
    log.info("Auto-registered Bronze entity for LZ %s", lz_entity_id)


def _ensure_silver_registration(lz_entity_id: int):
    """Auto-register a Silver entity for a LZ entity that's missing one."""
    bronze = db.query(
        "SELECT BronzeLayerEntityId, LakehouseId FROM bronze_entities WHERE LandingzoneEntityId = ?",
        (lz_entity_id,)
    )
    if not bronze:
        _ensure_bronze_registration(lz_entity_id)
        bronze = db.query(
            "SELECT BronzeLayerEntityId, LakehouseId FROM bronze_entities WHERE LandingzoneEntityId = ?",
            (lz_entity_id,)
        )
    if not bronze:
        return

    bronze = bronze[0]
    existing = db.query(
        "SELECT SilverLayerEntityId FROM silver_entities WHERE BronzeLayerEntityId = ?",
        (bronze["BronzeLayerEntityId"],)
    )
    if existing:
        return

    db.execute(
        "INSERT INTO silver_entities (BronzeLayerEntityId, LakehouseId, IsActive) "
        "VALUES (?, ?, 1)",
        (bronze["BronzeLayerEntityId"], bronze.get("LakehouseId")),
    )
    log.info("Auto-registered Silver entity for Bronze %s", bronze["BronzeLayerEntityId"])


def _trigger_notebooks_direct(state: dict):
    """Trigger load notebooks via Fabric REST API (fallback when engine module unavailable)."""
    cfg = _get_config()
    ws_id = cfg.get("fabric", {}).get("workspace_code_id", "")
    if not ws_id:
        state["error"] = "workspace_code_id not configured"
        state["phase"] = "failed"
        return

    notebooks = [
        ("NB_FMD_PROCESSING_LANDINGZONE_MAIN", "lz"),
        ("NB_FMD_LOAD_LANDING_BRONZE", "bronze"),
        ("NB_FMD_LOAD_BRONZE_SILVER", "silver"),
    ]

    try:
        token = _get_fabric_token("https://api.fabric.microsoft.com/.default")
    except Exception as e:
        state["error"] = f"Token acquisition failed: {e}"
        state["phase"] = "failed"
        return

    # Discover notebook IDs
    headers = {"Authorization": f"Bearer {token}"}
    url = f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}/notebooks"
    try:
        req = urllib.request.Request(url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=15)
        all_notebooks = json.loads(resp.read()).get("value", [])
    except Exception as e:
        state["error"] = f"Notebook discovery failed: {e}"
        state["phase"] = "failed"
        return

    nb_map = {nb["displayName"]: nb["id"] for nb in all_notebooks}

    for nb_name, layer in notebooks:
        nb_id = nb_map.get(nb_name)
        if not nb_id:
            log.warning("Notebook %s not found in workspace", nb_name)
            continue

        state["phase"] = f"running_{layer}"

        # Refresh token for each stage (notebooks can be long-running)
        try:
            token = _get_fabric_token("https://api.fabric.microsoft.com/.default")
        except Exception as e:
            state["error"] = f"Token refresh failed before {layer}: {e}"
            state["phase"] = "failed"
            return

        trigger_url = (
            f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}"
            f"/items/{nb_id}/jobs/instances?jobType=RunNotebook"
        )

        try:
            req = urllib.request.Request(
                trigger_url,
                data=b"{}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            resp = urllib.request.urlopen(req, timeout=30)
            log.info("Triggered notebook %s (%s), status: %s", nb_name, layer, resp.status)
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:300]
            log.error("Failed to trigger %s: %s %s", nb_name, e.code, body)
            state["progress"][layer] = {"error": f"HTTP {e.code}: {body}"}
            continue

        # Poll until complete
        _poll_notebook_completion(ws_id, nb_id, nb_name, layer, state)

    state["phase"] = "complete"


def _poll_notebook_completion(ws_id: str, nb_id: str, nb_name: str, layer: str, state: dict):
    """Poll a notebook job until completion. Max 4 hours."""
    max_poll_sec = 4 * 3600
    poll_interval = 20
    start = time.time()

    while time.time() - start < max_poll_sec:
        time.sleep(poll_interval)

        try:
            token = _get_fabric_token("https://api.fabric.microsoft.com/.default")
            url = (
                f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}"
                f"/items/{nb_id}/jobs/instances?orderBy=startTimeUtc desc&top=1"
            )
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
            resp = urllib.request.urlopen(req, timeout=15)
            data = json.loads(resp.read())
            jobs = data.get("value", [])

            if jobs:
                job = jobs[0]
                status = job.get("status", "Unknown")
                state["progress"][layer] = {
                    "status": status,
                    "elapsed": round(time.time() - start),
                }

                if status in ("Completed", "Failed", "Cancelled", "Deduped"):
                    log.info("Notebook %s finished: %s (%.0fs)", nb_name, status, time.time() - start)
                    return

        except Exception as e:
            log.warning("Poll error for %s: %s", nb_name, e)

    state["progress"][layer] = {"status": "timeout", "elapsed": round(time.time() - start)}
    log.error("Notebook %s timed out after %ds", nb_name, max_poll_sec)


@route("GET", "/api/load-center/run-status")
def get_load_center_run_status(params: dict) -> dict:
    """Get current run progress.

    Precedence:
    - If in-memory _run_state says active → return it (hot cache, most current)
    - Otherwise → read from SQLite (durable, survives restart/navigation)
    """
    if _run_state.get("active"):
        return _run_state
    # In-memory says not active — check SQLite for the most recent run
    try:
        persisted = _load_latest_run()
        if persisted.get("active") or persisted.get("phase"):
            return persisted
    except Exception:
        log.debug("Could not load persisted run state — falling back to in-memory state")
    return _run_state
