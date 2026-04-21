"""Entity CRUD, digest, cascade impact, and data journey routes.

Single data source: SQLite via control_plane_db.  All legacy fallback logic
has been removed.  If the DB is missing or empty the endpoints return empty
structures (zero counts, empty lists) rather than raising a 503.

Security fix: build_entity_digest previously allowed SQL injection via an
f-string source filter.  The filter is now applied in Python after loading
all entities from SQLite — no SQL string interpolation at all.
"""
import json
import logging
import time
from datetime import datetime, timezone

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.entities")


def _queue_export(table: str):
    """Best-effort queue a Parquet export. No-op if pyarrow unavailable."""
    try:
        from dashboard.app.api.parquet_sync import queue_export
        queue_export(table)
    except (ImportError, Exception):
        log.debug("Parquet export queue unavailable for table %s", table)

# ---------------------------------------------------------------------------
# Constants / helpers
# ---------------------------------------------------------------------------

_DIGEST_CACHE: dict = {}   # {cache_key: {"data": ..., "expires": float}}
_DIGEST_TTL = 120          # seconds


def _ds_display_name(raw: str) -> str:
    return cpdb._normalize_display_namespace(raw) or raw


def _is_active(val) -> bool:
    return str(val).lower() in ("true", "1")


# ---------------------------------------------------------------------------
# GET /api/entities — list registered LZ entities
# ---------------------------------------------------------------------------

@route("GET", "/api/entities")
def get_entities(params):
    """Return all registered LandingzoneEntity rows from SQLite."""
    return cpdb.get_lz_entities()


# ---------------------------------------------------------------------------
# GET /api/entity-digest — full per-entity status digest grouped by source
# ---------------------------------------------------------------------------

def _build_sqlite_entity_digest(
    source_filter: str | None = None,
    layer_filter: str | None = None,
    status_filter: str | None = None,
) -> dict:
    """Build the entity digest entirely from SQLite.  No SQL string interpolation.

    Security note: source_filter is applied as a Python equality check against
    the Namespace value after rows are loaded — no f-string / SQL injection risk.
    """
    lz = cpdb.get_registered_entities_full()
    statuses = cpdb.get_canonical_entity_status()
    bronze_view = cpdb.get_bronze_view()
    silver_view = cpdb.get_silver_view()

    # Build status lookup: (LandingzoneEntityId, normalized_layer) -> status row
    # Layer values may be lowercase ('landing','bronze','silver') from resync/seed
    # or PascalCase ('LandingZone','Bronze','Silver') from engine writes.
    status_map: dict = {}
    for s in statuses:
        lz_id = s.get("LandingzoneEntityId")
        layer = (s.get("Layer") or "").lower()
        if layer == "landingzone":
            layer = "landing"
        key = (lz_id, layer)
        existing = status_map.get(key)
        if existing:
            existing_status = (existing.get("Status") or "").lower()
            new_status = (s.get("Status") or "").lower()
            if existing_status in ("loaded", "succeeded") and new_status not in ("loaded", "succeeded"):
                continue
        status_map[key] = s

    # Build bronze lookup by LZ ID
    bronze_by_lz: dict = {}
    for b in bronze_view:
        lz_id = b.get("LandingzoneEntityId")
        if lz_id is not None:
            bronze_by_lz[int(lz_id)] = b

    # Build silver lookup by Bronze ID
    silver_by_bronze: dict = {}
    for s in silver_view:
        br_id = s.get("BronzeLayerEntityId")
        if br_id is not None:
            silver_by_bronze[int(br_id)] = s

    sources: dict = {}
    status_counts = {"complete": 0, "partial": 0, "error": 0, "pending": 0, "not_started": 0}

    for entity in lz:
        lz_id = entity.get("LandingzoneEntityId")
        if lz_id is None:
            continue
        lz_id = int(lz_id)
        ns = entity.get("Namespace", "Unknown") or "Unknown"

        # Apply source filter (Python check — no SQL interpolation)
        if source_filter and (cpdb._normalize_display_namespace(ns) or ns).lower() != (
            cpdb._normalize_display_namespace(source_filter) or source_filter
        ).lower():
            continue

        lz_s = status_map.get((lz_id, "landing"), {})
        bronze_s = status_map.get((lz_id, "bronze"), {})
        silver_s = status_map.get((lz_id, "silver"), {})

        lz_status = (lz_s.get("Status") or "not_started").lower()
        bronze_status = (bronze_s.get("Status") or "not_started").lower()
        silver_status = (silver_s.get("Status") or "not_started").lower()

        statuses_list = [lz_status, bronze_status, silver_status]
        if all(s in ("loaded", "complete", "succeeded") for s in statuses_list):
            overall = "complete"
        elif any(s in ("error", "failed") for s in statuses_list):
            overall = "error"
        elif any(s in ("loaded", "complete", "succeeded") for s in statuses_list):
            overall = "partial"
        elif any(s in ("pending", "inprogress", "running", "extracting", "queued", "schema_discovery") for s in statuses_list):
            overall = "pending"
        else:
            overall = "not_started"

        # Apply layer / status filters
        if layer_filter:
            if layer_filter == "landing" and lz_status == "not_started":
                continue
            elif layer_filter == "bronze" and bronze_status == "not_started":
                continue
            elif layer_filter == "silver" and silver_status == "not_started":
                continue
        if status_filter and overall != status_filter:
            continue

        status_counts[overall] = status_counts.get(overall, 0) + 1

        br = bronze_by_lz.get(lz_id, {})
        br_id = br.get("BronzeLayerEntityId")
        sv = silver_by_bronze.get(int(br_id), {}) if br_id is not None else {}

        # Build error info (most recent layer error wins)
        last_error = None
        for layer_key, layer_name in [("silver", "silver"), ("bronze", "bronze"), ("landing", "landing")]:
            st = status_map.get((lz_id, layer_key), {})
            if st.get("ErrorMessage"):
                last_error = {
                    "message": st["ErrorMessage"],
                    "layer": layer_name,
                    "time": st.get("LoadEndDateTime", ""),
                }
                break

        if overall == "complete":
            diagnosis = "All layers loaded"
        elif overall == "error":
            err_layer = last_error.get("layer", "unknown") if last_error else "unknown"
            diagnosis = f"Error in {err_layer} layer"
        elif overall == "pending":
            diagnosis = "Pending processing"
        elif overall == "partial":
            loaded = []
            if lz_status in ("loaded", "complete", "succeeded"):
                loaded.append("LZ")
            if bronze_status in ("loaded", "complete", "succeeded"):
                loaded.append("Bronze")
            if silver_status in ("loaded", "complete", "succeeded"):
                loaded.append("Silver")
            diagnosis = f"Partial: {', '.join(loaded)} loaded"
        else:
            diagnosis = "Not started"

        is_active_flag = str(entity.get("IsActive", "")).lower() in ("true", "1")
        is_incremental = str(entity.get("IsIncremental", "")).lower() in ("true", "1")

        ent_data = {
            "id": lz_id,
            "dataSourceId": int(entity.get("DataSourceId") or 0),
            "tableName": entity.get("SourceName", ""),
            "sourceSchema": entity.get("SourceSchema", ""),
            "onelakeSchema": entity.get("FilePath") or entity.get("SourceSchema") or "dbo",
            "source": ns,
            "targetSchema": ns,
            "dataSourceName": entity.get("DataSourceName", ns),
            "isActive": is_active_flag,
            "isIncremental": is_incremental,
            "watermarkColumn": entity.get("IsIncrementalColumn", "") or "",
            "bronzeId": int(br_id) if br_id else None,
            "bronzePKs": br.get("PrimaryKeys", "") or "",
            "silverId": int(sv.get("SilverLayerEntityId", 0)) if sv.get("SilverLayerEntityId") else None,
            "lzStatus": lz_status,
            "lzLastLoad": lz_s.get("LoadEndDateTime", ""),
            "bronzeStatus": bronze_status,
            "bronzeLastLoad": bronze_s.get("LoadEndDateTime", ""),
            "silverStatus": silver_status,
            "silverLastLoad": silver_s.get("LoadEndDateTime", ""),
            "lastError": last_error,
            "diagnosis": diagnosis,
            "overall": overall,
            "connection": {
                "server": entity.get("ServerName", ""),
                "database": entity.get("DatabaseName", ""),
                "connectionName": entity.get("ConnectionName", ""),
            },
        }

        if ns not in sources:
            sources[ns] = {
                "name": ns,
                "displayName": _ds_display_name(ns),
                "entities": [],
                "statusCounts": {"complete": 0, "partial": 0, "error": 0, "pending": 0, "not_started": 0},
            }
        sources[ns]["entities"].append(ent_data)
        sources[ns]["statusCounts"][overall] = sources[ns]["statusCounts"].get(overall, 0) + 1

    # ── Enrich with glossary annotations + quality scores ─────────────────
    # Both tables may be empty (e.g. on fresh deploy) — any failure is silent.
    try:
        enrich_conn = cpdb._get_conn()
        try:
            annotations: dict = {}
            for r in enrich_conn.execute(
                "SELECT entity_id, business_name, description, domain, tags "
                "FROM entity_annotations"
            ).fetchall():
                annotations[int(r["entity_id"])] = r

            quality: dict = {}
            for r in enrich_conn.execute(
                "SELECT entity_id, composite_score, quality_tier FROM quality_scores"
            ).fetchall():
                quality[int(r["entity_id"])] = r
        finally:
            enrich_conn.close()

        for src in sources.values():
            for entity in src["entities"]:
                eid = entity.get("id")
                if eid is None:
                    continue
                try:
                    eid_int = int(eid)
                except (TypeError, ValueError):
                    continue

                ann = annotations.get(eid_int)
                if ann:
                    entity["businessName"] = ann["business_name"] or ""
                    entity["description"]  = ann["description"] or ""
                    entity["domain"]       = ann["domain"] or ""
                    raw_tags = ann["tags"]
                    try:
                        entity["tags"] = json.loads(raw_tags) if raw_tags else []
                    except (json.JSONDecodeError, TypeError):
                        entity["tags"] = []

                qs = quality.get(eid_int)
                if qs:
                    entity["qualityScore"] = round(float(qs["composite_score"] or 0), 2)
                    entity["qualityTier"]  = qs["quality_tier"] or "unclassified"

    except Exception as enrich_exc:
        log.warning("Failed to enrich entity digest: %s", enrich_exc)

    return {
        "sources": list(sources.values()),
        "statusCounts": status_counts,
        "totalEntities": sum(status_counts.values()),
        "_source": "sqlite",
        "lastSync": cpdb.get_sync_watermark(),
    }


@route("GET", "/api/entity-digest")
def get_entity_digest(params):
    """Return the entity digest with optional source/layer/status filters.

    Query params:
        source  — filter to a single Namespace (e.g. "MES")
        layer   — filter to entities active in landing|bronze|silver
        status  — filter to overall status (complete|partial|error|pending|not_started)
    """
    source = params.get("source") or None
    layer = params.get("layer") or None
    status = params.get("status") or None

    cache_key = f"{source}|{layer}|{status}"
    cached = _DIGEST_CACHE.get(cache_key)
    if cached and time.time() < cached["expires"]:
        return cached["data"]

    result = _build_sqlite_entity_digest(source, layer, status)
    _DIGEST_CACHE[cache_key] = {"data": result, "expires": time.time() + _DIGEST_TTL}
    return result


# ---------------------------------------------------------------------------
# GET /api/entity-digest/build — force-rebuild digest (clears cache first)
# ---------------------------------------------------------------------------

@route("GET", "/api/entity-digest/build")
def build_entity_digest(params):
    """Force-rebuild the entity digest, bypassing and refreshing the cache.

    Security fix: source filter is applied in Python after loading all entities
    from SQLite — previously this used an f-string in a SQL EXEC call which
    allowed SQL injection.  That legacy code path is eliminated entirely.

    Query params: same as /api/entity-digest (source, layer, status)
    """
    source = params.get("source") or None
    layer = params.get("layer") or None
    status = params.get("status") or None

    # Clear cache for this key so _build_sqlite_entity_digest runs fresh
    cache_key = f"{source}|{layer}|{status}"
    _DIGEST_CACHE.pop(cache_key, None)

    result = _build_sqlite_entity_digest(source, layer, status)
    result["rebuiltAt"] = datetime.now(timezone.utc).isoformat()
    _DIGEST_CACHE[cache_key] = {"data": result, "expires": time.time() + _DIGEST_TTL}
    return result


# ---------------------------------------------------------------------------
# GET /api/entities/cascade-impact — preview delete impact
# ---------------------------------------------------------------------------

@route("GET", "/api/entities/cascade-impact")
def get_cascade_impact(params):
    """Return what bronze/silver entities would be affected by deleting LZ entity IDs.

    Query params:
        ids  — comma-separated LandingzoneEntityId integers (required)
    """
    ids_str = params.get("ids", "")
    if not ids_str:
        raise HttpError("ids param required (comma-separated)", 400)

    try:
        entity_ids = [int(x) for x in str(ids_str).split(",") if x.strip().isdigit()]
    except (ValueError, AttributeError):
        raise HttpError("ids must be comma-separated integers", 400)

    if not entity_ids:
        raise HttpError("ids param required (comma-separated)", 400)

    return _cascade_impact_sqlite(entity_ids)


def _cascade_impact_sqlite(entity_ids: list[int]) -> dict:
    """Look up cascade impact entirely from SQLite.

    For each LZ entity, finds matching bronze/silver rows by name.
    Returns {landing: [...], bronze: [...], silver: [...]}.
    """
    lz_rows = cpdb.get_registered_entities_full()
    safe_ids = set(int(eid) for eid in entity_ids)

    landing = [
        {
            "LandingzoneEntityId": r["LandingzoneEntityId"],
            "SourceSchema": r.get("SourceSchema", ""),
            "SourceName": r.get("SourceName", ""),
            "DataSourceName": r.get("DataSourceName", ""),
        }
        for r in lz_rows
        if int(r["LandingzoneEntityId"]) in safe_ids
    ]

    if not landing:
        return {"landing": [], "bronze": [], "silver": []}

    # Match by schema+name
    bronze_all = cpdb.get_bronze_view()
    silver_all = cpdb.get_silver_view()

    match_keys = {(r["SourceSchema"], r["SourceName"]) for r in landing}

    bronze = [
        {
            "BronzeLayerEntityId": b["BronzeLayerEntityId"],
            "SourceSchema": b.get("SourceSchema", ""),
            "SourceName": b.get("SourceName", ""),
        }
        for b in bronze_all
        if (b.get("SourceSchema", ""), b.get("SourceName", "")) in match_keys
    ]

    silver = [
        {
            "SilverLayerEntityId": s["SilverLayerEntityId"],
            "SourceSchema": s.get("SourceSchema", ""),
            "SourceName": s.get("SourceName", ""),
        }
        for s in silver_all
        if (s.get("SourceSchema", ""), s.get("SourceName", "")) in match_keys
    ]

    return {"landing": landing, "bronze": bronze, "silver": silver}


# ---------------------------------------------------------------------------
# POST /api/entities — register a new entity (SQLite write-through)
# ---------------------------------------------------------------------------

@route("POST", "/api/entities")
def register_entity(params):
    """Register a new LandingzoneEntity in SQLite.

    Required body fields: dataSourceName, sourceName
    Optional: dataSourceType, sourceSchema, fileName, filePath,
              isIncremental, incrementalColumn, customNotebookName
    """
    ds_name = (params.get("dataSourceName") or "").strip()
    source_name = (params.get("sourceName") or "").strip()

    if not ds_name or not source_name:
        raise HttpError("dataSourceName and sourceName are required", 400)

    schema = (params.get("sourceSchema") or "dbo").strip()
    file_name = (params.get("fileName") or source_name).strip()
    file_path = (params.get("filePath") or "").strip()
    is_incremental = 1 if params.get("isIncremental") else 0
    inc_col = (params.get("incrementalColumn") or "").strip()
    custom_nb = (params.get("customNotebookName") or "").strip()

    # Look up DataSourceId from SQLite
    datasources = cpdb.get_datasources()
    ds_match = [d for d in datasources if d.get("Name") == ds_name]
    if not ds_match:
        available = [d.get("Name", "") for d in datasources]
        raise HttpError(
            f'DataSource "{ds_name}" not found. Available: {", ".join(available)}', 400
        )
    ds_id = int(ds_match[0]["DataSourceId"])

    # Look up LakehouseId for LH_DATA_LANDINGZONE
    lakehouses = cpdb.get_lakehouses()
    lh_match = [lh for lh in lakehouses if lh.get("Name") == "LH_DATA_LANDINGZONE"]
    lh_id = int(lh_match[0]["LakehouseId"]) if lh_match else None

    # Generate a new LandingzoneEntityId (max + 1)
    existing = cpdb.get_lz_entities()
    new_id = max((int(e["LandingzoneEntityId"]) for e in existing), default=0) + 1

    cpdb.upsert_lz_entity({
        "LandingzoneEntityId": new_id,
        "DataSourceId": ds_id,
        "LakehouseId": lh_id,
        "SourceSchema": schema,
        "SourceName": source_name,
        "SourceCustomSelect": "",
        "FileName": file_name,
        "FilePath": file_path,
        "FileType": "parquet",
        "IsIncremental": is_incremental,
        "IsIncrementalColumn": inc_col,
        "CustomNotebookName": custom_nb,
        "IsActive": 1,
    })
    log.info("Entity registered in SQLite: %s.%s (lz_id=%d)", schema, source_name, new_id)

    # Auto-cascade to Bronze + Silver
    bronze_msg = ""
    silver_msg = ""
    try:
        bronze_lh = [lh for lh in lakehouses if lh.get("Name") == "LH_BRONZE_LAYER"]
        silver_lh = [lh for lh in lakehouses if lh.get("Name") == "LH_SILVER_LAYER"]

        if bronze_lh:
            bronze_id = max(
                (int(b["BronzeLayerEntityId"]) for b in cpdb.get_bronze_entities()),
                default=0,
            ) + 1
            cpdb.upsert_bronze_entity({
                "BronzeLayerEntityId": bronze_id,
                "LandingzoneEntityId": new_id,
                "LakehouseId": int(bronze_lh[0]["LakehouseId"]),
                "Schema_": schema,
                "Name": file_name,
                "PrimaryKeys": "N/A",
                "FileType": "Delta",
                "IsActive": 1,
            })
            bronze_msg = " + Bronze"
            log.info("Bronze entity auto-registered for %s.%s", schema, source_name)

            if silver_lh:
                silver_id = max(
                    (int(s["SilverLayerEntityId"]) for s in cpdb.get_silver_entities()),
                    default=0,
                ) + 1
                cpdb.upsert_silver_entity({
                    "SilverLayerEntityId": silver_id,
                    "BronzeLayerEntityId": bronze_id,
                    "LakehouseId": int(silver_lh[0]["LakehouseId"]),
                    "Schema_": schema,
                    "Name": file_name,
                    "FileType": "delta",
                    "IsActive": 1,
                })
                silver_msg = " + Silver"
                log.info("Silver entity auto-registered for %s.%s", schema, source_name)
    except Exception as ex:
        log.warning("Auto Bronze/Silver registration failed for %s.%s: %s", schema, source_name, ex)

    # Invalidate entity digest cache
    _DIGEST_CACHE.clear()

    _queue_export("lz_entities")
    if bronze_msg:
        _queue_export("bronze_entities")
    if silver_msg:
        _queue_export("silver_entities")

    return {
        "success": True,
        "message": f"Entity {schema}.{source_name} registered (LZ{bronze_msg}{silver_msg})",
        "entityId": new_id,
    }


# ---------------------------------------------------------------------------
# DELETE /api/entities/{id} — delete a single entity with cascade
# ---------------------------------------------------------------------------

@route("DELETE", "/api/entities/{entity_id}")
def delete_entity(params):
    """Hard-delete a LandingzoneEntity and cascade to Bronze/Silver in SQLite."""
    try:
        entity_id = int(params.get("entity_id", 0))
    except (TypeError, ValueError):
        raise HttpError("Invalid entity ID", 400)

    if entity_id <= 0:
        raise HttpError("Invalid entity ID", 400)

    # Check existence
    impact = _cascade_impact_sqlite([entity_id])
    if not impact["landing"]:
        raise HttpError(f"Entity {entity_id} not found", 404)

    entity = impact["landing"][0]
    drop_stats = _cascade_delete_sqlite([entity_id])

    bronze_count = len(impact["bronze"])
    silver_count = len(impact["silver"])
    msg = f"Deleted {entity['SourceSchema']}.{entity['SourceName']} from {entity['DataSourceName']}"
    if bronze_count or silver_count:
        parts = []
        if bronze_count:
            parts.append(f"{bronze_count} bronze")
        if silver_count:
            parts.append(f"{silver_count} silver")
        msg += f" (+ {', '.join(parts)} cascade)"

    _DIGEST_CACHE.clear()
    _queue_export("lz_entities")
    if bronze_count:
        _queue_export("bronze_entities")
    if silver_count:
        _queue_export("silver_entities")

    return {
        "success": True,
        "message": msg,
        "deletedId": entity_id,
        "cascade": {"bronze": bronze_count, "silver": silver_count, **drop_stats},
    }


# ---------------------------------------------------------------------------
# POST /api/entities/bulk-delete — delete multiple entities
# ---------------------------------------------------------------------------

@route("POST", "/api/entities/bulk-delete")
def bulk_delete_entities(params):
    """Hard-delete multiple LandingzoneEntity rows + cascade to Bronze/Silver.

    Body:
        ids  — list of LandingzoneEntityId integers
    """
    ids = params.get("ids", [])
    if not ids or not isinstance(ids, list):
        raise HttpError("ids array is required", 400)

    try:
        safe_ids = [int(eid) for eid in ids]
    except (TypeError, ValueError):
        raise HttpError("ids must be a list of integers", 400)

    impact = _cascade_impact_sqlite(safe_ids)
    if not impact["landing"]:
        raise HttpError("None of the provided entity IDs were found", 404)

    found_ids = [r["LandingzoneEntityId"] for r in impact["landing"]]
    missing = [eid for eid in safe_ids if eid not in found_ids]
    drop_stats = _cascade_delete_sqlite(found_ids)

    deleted_names = [
        f"{r['SourceSchema']}.{r['SourceName']}" for r in impact["landing"]
    ]
    bronze_count = len(impact["bronze"])
    silver_count = len(impact["silver"])

    _DIGEST_CACHE.clear()
    _queue_export("lz_entities")
    if bronze_count:
        _queue_export("bronze_entities")
    if silver_count:
        _queue_export("silver_entities")

    return {
        "success": True,
        "message": (
            f"Deleted {len(found_ids)} entities"
            + (f" (+ {bronze_count} bronze, {silver_count} silver cascade)"
               if bronze_count or silver_count else "")
        ),
        "deletedIds": found_ids,
        "deletedNames": deleted_names,
        "missingIds": missing,
        "cascade": {"bronze": bronze_count, "silver": silver_count, **drop_stats},
    }


def _cascade_delete_sqlite(entity_ids: list[int]) -> dict:
    """Delete entities from SQLite in reverse layer order (Silver → Bronze → LZ).

    Uses get_bronze_view() which includes LandingzoneEntityId, and
    get_silver_view() which includes BronzeLayerEntityId — both fields are
    needed for cascade matching but absent from the lean get_*_entities() calls.
    """
    if not entity_ids:
        return {"bronze_dropped": 0, "silver_dropped": 0, "lz_files_dropped": 0}

    safe_ids = set(int(eid) for eid in entity_ids)

    # get_bronze_view() includes LandingzoneEntityId
    bronze_view = cpdb.get_bronze_view()
    bronze_ids = [
        int(b["BronzeLayerEntityId"])
        for b in bronze_view
        if b.get("LandingzoneEntityId") is not None
        and int(b["LandingzoneEntityId"]) in safe_ids
    ]

    # get_silver_view() includes BronzeLayerEntityId
    silver_view = cpdb.get_silver_view()
    bronze_id_set = set(bronze_ids)
    silver_ids = [
        int(s["SilverLayerEntityId"])
        for s in silver_view
        if s.get("BronzeLayerEntityId") is not None
        and int(s["BronzeLayerEntityId"]) in bronze_id_set
    ]

    import dashboard.app.api.db as fmd_db

    # Delete Silver → Bronze → LZ (reverse order preserves FK integrity)
    for sid in silver_ids:
        fmd_db.execute(
            "DELETE FROM silver_entities WHERE SilverLayerEntityId = ?", (sid,)
        )

    for bid in bronze_ids:
        fmd_db.execute(
            "DELETE FROM bronze_entities WHERE BronzeLayerEntityId = ?", (bid,)
        )

    for eid in safe_ids:
        fmd_db.execute(
            "DELETE FROM lz_entities WHERE LandingzoneEntityId = ?", (eid,)
        )

    return {
        "bronze_dropped": len(bronze_ids),
        "silver_dropped": len(silver_ids),
        "lz_files_dropped": 0,
    }
