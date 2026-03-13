"""Data access routes — blender, schema, lakehouse counts, entity status sync, Purview.

Security fix applied:
    POST /api/blender/query — SELECT-only enforcement prevents arbitrary DML.

Covers:
    GET  /api/blender/tables     — all tables across all layers (metadata + discovery)
    GET  /api/blender/endpoints  — lakehouse SQL endpoint discovery
    GET  /api/blender/profile    — column + row-count profile for a lakehouse table
    GET  /api/blender/sample     — sampled rows from a lakehouse table
    POST /api/blender/query      — execute a SELECT-only query against a lakehouse
    GET  /api/lakehouse-counts   — table/file counts from local OneLake mount
    POST /api/lakehouse-counts/refresh — force-refresh (re-scan filesystem)
    POST /api/entity-status/sync — derive entity status from OneLake filesystem
    GET  /api/purview/status     — Purview integration status (graceful when not configured)
    GET  /api/purview/search     — search Purview catalog (empty results when unavailable)
    GET  /api/schema             — schema info from SQLite
"""
import json
import logging
import os
import struct
import threading
import time
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.data_access")

# ---------------------------------------------------------------------------
# OneLake local mount — the filesystem IS the source of truth
# ---------------------------------------------------------------------------

_ONELAKE_MOUNT = os.environ.get("ONELAKE_MOUNT_PATH", "")


def _get_onelake_mount() -> Path | None:
    """Return the OneLake mount root or None if not available."""
    if not _ONELAKE_MOUNT:
        return None
    p = Path(_ONELAKE_MOUNT)
    return p if p.is_dir() else None


def _count_from_filesystem() -> dict:
    """Count tables/files in each lakehouse directly from the local OneLake mount.
    Uses os.listdir() for speed — no stat() calls, no recursing into table dirs."""
    mount = _get_onelake_mount()
    if not mount:
        return {}

    results: dict = {}

    # LZ: Files/{schema}/{table}.parquet (flat files, no Delta)
    lz_files_dir = str(mount / "LH_DATA_LANDINGZONE.Lakehouse" / "Files")
    try:
        lz_tables = []
        for schema in os.listdir(lz_files_dir):
            schema_path = os.path.join(lz_files_dir, schema)
            if not os.path.isdir(schema_path):
                continue
            for fname in os.listdir(schema_path):
                if fname.endswith(".parquet") and not fname.startswith("X_"):
                    lz_tables.append({
                        "schema": schema, "table": fname[:-8], "rowCount": -1,
                    })
        results["LH_DATA_LANDINGZONE"] = lz_tables
    except OSError as e:
        log.warning("Failed to scan LZ files: %s", e)

    # Bronze + Silver: Tables/{schema}/{table}/ — just list directory names
    for lh_name in ("LH_BRONZE_LAYER", "LH_SILVER_LAYER"):
        tables_dir = str(mount / f"{lh_name}.Lakehouse" / "Tables")
        try:
            lh_tables = []
            for schema in os.listdir(tables_dir):
                schema_path = os.path.join(tables_dir, schema)
                if not os.path.isdir(schema_path):
                    continue
                for table_name in os.listdir(schema_path):
                    if not table_name.startswith("_"):
                        lh_tables.append({
                            "schema": schema, "table": table_name, "rowCount": -1,
                        })
            results[lh_name] = lh_tables
        except OSError as e:
            log.warning("Failed to scan %s: %s", lh_name, e)

    return results


def _build_onelake_table_index() -> dict[str, set[str]]:
    """Build {layer: set of (namespace, table_name)} from OneLake mount.
    Uses os.listdir() for speed — avoids stat() and pathlib overhead on virtual FS."""
    mount = _get_onelake_mount()
    if not mount:
        return {}

    index: dict[str, set] = {"landing": set(), "bronze": set(), "silver": set()}

    # LZ: Files/{namespace}/{table}.parquet
    lz_dir = str(mount / "LH_DATA_LANDINGZONE.Lakehouse" / "Files")
    try:
        for ns in os.listdir(lz_dir):
            ns_path = os.path.join(lz_dir, ns)
            if not os.path.isdir(ns_path):
                continue
            for fname in os.listdir(ns_path):
                if fname.endswith(".parquet") and not fname.startswith("X_"):
                    index["landing"].add((ns, fname[:-8]))  # strip .parquet
    except OSError:
        pass

    # Bronze/Silver: Tables/{namespace}/{table}/
    for layer, lh in [("bronze", "LH_BRONZE_LAYER"), ("silver", "LH_SILVER_LAYER")]:
        tables_dir = str(mount / f"{lh}.Lakehouse" / "Tables")
        try:
            for ns in os.listdir(tables_dir):
                ns_path = os.path.join(tables_dir, ns)
                if not os.path.isdir(ns_path):
                    continue
                for table_name in os.listdir(ns_path):
                    if not table_name.startswith("_"):
                        index[layer].add((ns, table_name))
        except OSError:
            pass

    return index


def sync_entity_status_from_filesystem() -> dict:
    """Derive entity status from what actually exists on disk in OneLake.
    If a table/file exists → status = 'loaded'. No Fabric SQL, no sync lag.
    Uses batch inserts for speed (~1s instead of ~80s)."""
    file_index = _build_onelake_table_index()
    if not file_index:
        return {"error": "OneLake mount not available", "synced": 0}

    # Build datasource namespace mapping: DataSourceId → namespace (e.g., 6 → 'm3')
    ds_rows = db.query("SELECT DataSourceId, Namespace FROM datasources")
    ds_namespace = {r["DataSourceId"]: (r.get("Namespace") or "").lower() for r in ds_rows}

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    batch: list[tuple] = []  # collect all upserts for batch write

    # LZ entities: check Files/{namespace}/{FileName}
    lz_entities = db.query(
        "SELECT LandingzoneEntityId, DataSourceId, SourceName, FileName FROM lz_entities"
    )
    for ent in lz_entities:
        eid = ent["LandingzoneEntityId"]
        ns = ds_namespace.get(ent["DataSourceId"], "")
        file_name = ent.get("FileName") or ent.get("SourceName", "")
        table_name = file_name.replace(".parquet", "") if file_name.endswith(".parquet") else file_name
        exists = (ns, table_name) in file_index.get("landing", set())
        batch.append((
            eid, "landing",
            "loaded" if exists else "not_started",
            now_str if exists else None,
            None, "onelake-filesystem-sync", now_str,
        ))

    # Bronze entities: check Tables/{namespace}/{Name}/
    bronze_entities = db.query(
        "SELECT be.BronzeLayerEntityId, be.LandingzoneEntityId, be.Name, "
        "le.DataSourceId "
        "FROM bronze_entities be "
        "LEFT JOIN lz_entities le ON be.LandingzoneEntityId = le.LandingzoneEntityId"
    )
    for ent in bronze_entities:
        eid = ent["LandingzoneEntityId"]
        ns = ds_namespace.get(ent.get("DataSourceId"), "")
        table_name = ent.get("Name", "")
        exists = (ns, table_name) in file_index.get("bronze", set())
        batch.append((
            eid, "bronze",
            "loaded" if exists else "not_started",
            now_str if exists else None,
            None, "onelake-filesystem-sync", now_str,
        ))

    # Silver entities: check Tables/{namespace}/{Name}/
    silver_entities = db.query(
        "SELECT se.SilverLayerEntityId, se.BronzeLayerEntityId, se.Name, "
        "be.LandingzoneEntityId, le.DataSourceId "
        "FROM silver_entities se "
        "LEFT JOIN bronze_entities be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId "
        "LEFT JOIN lz_entities le ON be.LandingzoneEntityId = le.LandingzoneEntityId"
    )
    for ent in silver_entities:
        eid = ent.get("LandingzoneEntityId")
        if not eid:
            continue
        ns = ds_namespace.get(ent.get("DataSourceId"), "")
        table_name = ent.get("Name", "")
        exists = (ns, table_name) in file_index.get("silver", set())
        batch.append((
            eid, "silver",
            "loaded" if exists else "not_started",
            now_str if exists else None,
            None, "onelake-filesystem-sync", now_str,
        ))

    # Batch write to SQLite — one transaction, ~1s
    import sqlite3
    try:
        from dashboard.app.api import control_plane_db as cpdb
    except ImportError:
        import control_plane_db as cpdb  # type: ignore

    conn = sqlite3.connect(str(cpdb.DB_PATH))
    try:
        conn.execute("BEGIN")
        # Clean out stale PascalCase rows from old engine writes
        conn.execute(
            "DELETE FROM entity_status WHERE Layer IN ('LandingZone', 'Bronze', 'Silver')"
        )
        conn.executemany(
            "INSERT OR REPLACE INTO entity_status "
            "(LandingzoneEntityId, Layer, Status, LoadEndDateTime, "
            "ErrorMessage, UpdatedBy, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            batch,
        )
        conn.execute(
            "INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) "
            "VALUES ('last_sync', ?, ?)",
            (now_str, now_str),
        )
        conn.commit()
    finally:
        conn.close()

    summary = {
        "synced": len(batch),
        "onDisk": {
            "landing": len(file_index.get("landing", set())),
            "bronze": len(file_index.get("bronze", set())),
            "silver": len(file_index.get("silver", set())),
        },
        "syncedAt": now_str,
    }
    log.info("Entity status synced from OneLake filesystem: %s", summary)
    return summary

# ---------------------------------------------------------------------------
# Config helpers (lazy)
# ---------------------------------------------------------------------------

_CONFIG: dict | None = None


def _get_config() -> dict:
    global _CONFIG
    if _CONFIG is None:
        try:
            cfg_path = Path(__file__).parent.parent / "config.json"
            raw = json.loads(cfg_path.read_text())
            # Resolve ${ENV_VAR} placeholders
            def _resolve(obj):
                if isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
                    return os.environ.get(obj[2:-1], "")
                elif isinstance(obj, dict):
                    return {k: _resolve(v) for k, v in obj.items()}
                elif isinstance(obj, list):
                    return [_resolve(v) for v in obj]
                return obj
            _CONFIG = _resolve(raw)
        except Exception:
            _CONFIG = {}
    return _CONFIG


def _get_fabric_token(scope: str) -> str:
    cfg = _get_config()
    tenant = cfg.get("fabric", {}).get("tenant_id", "")
    client_id = cfg.get("fabric", {}).get("client_id", "")
    client_secret = cfg.get("fabric", {}).get("client_secret", "")
    if not tenant or not client_id or not client_secret:
        raise HttpError("Fabric credentials not configured (check .env)", 503)
    url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": scope,
    }).encode()
    req = urllib.request.Request(url, data=data)
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())["access_token"]


# ---------------------------------------------------------------------------
# Lakehouse SQL Analytics Endpoint discovery + connection
# ---------------------------------------------------------------------------

_lakehouse_endpoints: dict = {}   # lakehouse_name → {connectionString, ...}
_lakehouse_lock = threading.Lock()
SQL_DRIVER = "ODBC Driver 18 for SQL Server"


def _discover_lakehouse_endpoints() -> dict:
    """Discover SQL analytics endpoints for all lakehouses via Fabric REST API."""
    global _lakehouse_endpoints
    with _lakehouse_lock:
        if _lakehouse_endpoints:
            return _lakehouse_endpoints

    cfg = _get_config()
    ws_id = cfg.get("fabric", {}).get("workspace_data_id", "")
    if not ws_id:
        log.warning("No workspace_data_id configured — cannot discover lakehouse endpoints")
        return {}

    try:
        token = _get_fabric_token("https://api.fabric.microsoft.com/.default")
    except Exception as e:
        log.warning("Cannot get Fabric token for endpoint discovery: %s", e)
        return {}
    headers = {"Authorization": f"Bearer {token}"}
    url = f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}/lakehouses"
    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        for lh in data.get("value", []):
            name = lh.get("displayName", "")
            props = lh.get("properties", {})
            sql_props = props.get("sqlEndpointProperties", {})
            conn_str = sql_props.get("connectionString", "")
            if conn_str and sql_props.get("provisioningStatus") == "Success":
                _lakehouse_endpoints[name] = {
                    "connectionString": conn_str,
                    "sqlEndpointId": sql_props.get("id", ""),
                    "lakehouseId": lh.get("id", ""),
                    "workspaceId": ws_id,
                }
                log.info("  Lakehouse SQL endpoint: %s -> %s...", name, conn_str[:50])
    except urllib.error.HTTPError as e:
        log.error("Failed to discover lakehouses: %s %s", e.code, e.read().decode()[:200])
    except Exception as e:
        log.error("Failed to discover lakehouses: %s", e)

    return _lakehouse_endpoints


def _get_lakehouse_connection(lakehouse_name: str):
    """Connect to a lakehouse SQL analytics endpoint via pyodbc."""
    import pyodbc
    endpoints = _discover_lakehouse_endpoints()
    ep = endpoints.get(lakehouse_name)
    if not ep:
        raise HttpError(
            f"Lakehouse '{lakehouse_name}' not found. Available: {list(endpoints.keys())}",
            404,
        )

    token = _get_fabric_token("https://database.windows.net/.default")
    token_bytes = token.encode("UTF-16-LE")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    conn_str = (
        f"DRIVER={{{SQL_DRIVER}}};"
        f"SERVER={ep['connectionString']};"
        f"DATABASE={lakehouse_name};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)


def _query_lakehouse(lakehouse_name: str, sql: str) -> list[dict]:
    """Execute read-only SQL against a lakehouse SQL analytics endpoint."""
    conn = _get_lakehouse_connection(lakehouse_name)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        if not cursor.description:
            return []
        cols = [c[0] for c in cursor.description]
        return [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)}
                for row in cursor.fetchall()]
    finally:
        conn.close()


def invalidate_lakehouse_endpoints():
    """Force re-discovery on next request (e.g. after workspace changes)."""
    global _lakehouse_endpoints
    with _lakehouse_lock:
        _lakehouse_endpoints = {}


def _sanitize(val: str) -> str:
    """Strip characters dangerous in SQL identifiers."""
    return "".join(c for c in val if c.isalnum() or c in "-_ ")


# ---------------------------------------------------------------------------
# SELECT-only validation (security fix)
# ---------------------------------------------------------------------------

_FORBIDDEN_DML = ("INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "EXEC", "EXECUTE")


def _validate_select_only(sql: str) -> None:
    """Raise HttpError if sql contains any DML / DDL statement.

    Security fix: prevents blender endpoint from being used as an
    arbitrary write channel into Fabric lakehouses.
    """
    stripped = sql.strip().upper()
    if not stripped.startswith("SELECT"):
        raise HttpError("Only SELECT queries are allowed", 400)
    for keyword in _FORBIDDEN_DML:
        if f" {keyword} " in f" {stripped} " or stripped.startswith(keyword):
            raise HttpError(f"{keyword} statements are not allowed", 400)


# ---------------------------------------------------------------------------
# Blender routes
# ---------------------------------------------------------------------------

@route("GET", "/api/blender/tables")
def get_blender_tables(params: dict) -> list:
    """All registered entities across LZ / Bronze / Silver layers."""
    tables = []

    lz = db.query(
        "SELECT le.LandingzoneEntityId AS Id, le.SourceSchema, le.SourceName, "
        "le.FileName, le.IsActive, ds.Name AS DataSourceName, lh.Name AS LakehouseName "
        "FROM lz_entities le "
        "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "LEFT JOIN lakehouses lh ON le.LakehouseId = lh.LakehouseId "
        "WHERE le.IsActive = 1 ORDER BY le.SourceName"
    )
    for row in lz:
        display = row.get("FileName") or row.get("SourceName", "")
        tables.append({
            "id": f"lz-{row['Id']}",
            "name": display,
            "layer": "landing",
            "lakehouse": row.get("LakehouseName") or "LH_DATA_LANDINGZONE",
            "schema": row.get("SourceSchema") or "dbo",
            "source": "metadata",
            "dataSource": row.get("DataSourceName") or "",
        })

    br = db.query(
        "SELECT be.BronzeLayerEntityId AS Id, be.Schema_ AS SourceSchema, be.Name AS SourceName, "
        "be.IsActive, lh.Name AS LakehouseName "
        "FROM bronze_entities be "
        "LEFT JOIN lakehouses lh ON be.LakehouseId = lh.LakehouseId "
        "WHERE be.IsActive = 1 ORDER BY be.Name"
    )
    for row in br:
        tables.append({
            "id": f"br-{row['Id']}",
            "name": row.get("SourceName", ""),
            "layer": "bronze",
            "lakehouse": row.get("LakehouseName") or "LH_BRONZE_LAYER",
            "schema": row.get("SourceSchema") or "dbo",
            "source": "metadata",
        })

    sv = db.query(
        "SELECT se.SilverLayerEntityId AS Id, se.Schema_ AS SourceSchema, se.Name AS SourceName, "
        "se.IsActive, lh.Name AS LakehouseName "
        "FROM silver_entities se "
        "LEFT JOIN lakehouses lh ON se.LakehouseId = lh.LakehouseId "
        "WHERE se.IsActive = 1 ORDER BY se.Name"
    )
    for row in sv:
        tables.append({
            "id": f"sv-{row['Id']}",
            "name": row.get("SourceName", ""),
            "layer": "silver",
            "lakehouse": row.get("LakehouseName") or "LH_SILVER_LAYER",
            "schema": row.get("SourceSchema") or "dbo",
            "source": "metadata",
        })

    return tables


@route("GET", "/api/blender/endpoints")
def get_blender_endpoints(params: dict) -> dict:
    """Return known lakehouse SQL endpoint mappings."""
    lakehouses = db.query("SELECT Name, LakehouseGuid, WorkspaceGuid FROM lakehouses")
    return {lh["Name"]: lh for lh in lakehouses}


# ---------------------------------------------------------------------------
# Lakehouse row counts — live query with in-memory + file cache
# ---------------------------------------------------------------------------

_lakehouse_counts_cache: dict | None = None
_lakehouse_counts_cache_ts: float = 0
_LAKEHOUSE_COUNTS_TTL = 300  # 5 minutes


def _count_lakehouse_fabric(lh_name: str) -> tuple[str, list[dict]]:
    """Query row counts for a single lakehouse via Fabric SQL Analytics Endpoint.
    Used as FALLBACK when OneLake mount is not available."""
    try:
        rows = _query_lakehouse(
            lh_name,
            "SELECT s.name AS [schema], t.name AS [table], "
            "CAST(SUM(p.rows) AS BIGINT) AS row_count "
            "FROM sys.tables t "
            "INNER JOIN sys.schemas s ON t.schema_id = s.schema_id "
            "INNER JOIN sys.partitions p ON t.object_id = p.object_id "
            "WHERE p.index_id IN (0, 1) "
            "GROUP BY s.name, t.name "
            "ORDER BY s.name, t.name",
        )
        return lh_name, [
            {"schema": r["schema"], "table": r["table"], "rowCount": int(r["row_count"] or 0)}
            for r in rows
        ]
    except Exception as e:
        log.warning("Fabric row count query failed for %s: %s", lh_name, e)
        return lh_name, []


def _get_lakehouse_counts_inner(force_refresh: bool = False) -> dict:
    """Get table counts. PRIMARY source: local OneLake filesystem.
    FALLBACK: Fabric SQL Analytics Endpoints (only if mount unavailable)."""
    global _lakehouse_counts_cache, _lakehouse_counts_cache_ts

    if (
        not force_refresh
        and _lakehouse_counts_cache
        and (time.time() - _lakehouse_counts_cache_ts) < _LAKEHOUSE_COUNTS_TTL
    ):
        return {
            **_lakehouse_counts_cache,
            "_meta": {
                "cachedAt": datetime.now(timezone.utc).isoformat(),
                "fromCache": True,
                "cacheAgeSec": int(time.time() - _lakehouse_counts_cache_ts),
            },
        }

    t_start = time.time()

    # PRIMARY: read from local OneLake mount (instant, always accurate)
    local_counts = _count_from_filesystem()
    if local_counts:
        now_utc = datetime.now(timezone.utc).isoformat()
        local_counts["_meta"] = {
            "source": "onelake-filesystem",
            "cachedAt": now_utc,
            "fromCache": False,
            "cacheAgeSec": 0,
            "queryTimeSec": round(time.time() - t_start, 3),
            "mountPath": _ONELAKE_MOUNT,
        }
        _lakehouse_counts_cache = {k: v for k, v in local_counts.items() if k != "_meta"}
        _lakehouse_counts_cache_ts = time.time()
        log.info(
            "Lakehouse counts from filesystem: LZ=%d, Bronze=%d, Silver=%d in %.3fs",
            len(local_counts.get("LH_DATA_LANDINGZONE", [])),
            len(local_counts.get("LH_BRONZE_LAYER", [])),
            len(local_counts.get("LH_SILVER_LAYER", [])),
            time.time() - t_start,
        )
        return local_counts

    # FALLBACK: Fabric SQL Analytics Endpoints (remote server without OneLake mount)
    log.info("OneLake mount not available — falling back to Fabric SQL endpoints")
    try:
        endpoints = _discover_lakehouse_endpoints()
    except Exception as e:
        log.warning("Lakehouse endpoint discovery failed: %s", e)
        endpoints = {}

    if not endpoints:
        return {"_meta": {"error": "No OneLake mount and no Fabric endpoints available"}}

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(_count_lakehouse_fabric, lh) for lh in endpoints]
        results: dict = {}
        for future in futures:
            try:
                name, counts = future.result(timeout=120)
                results[name] = counts
            except Exception as e:
                log.error("Row count future failed: %s", e)

    now_utc = datetime.now(timezone.utc).isoformat()
    results["_meta"] = {
        "source": "fabric-sql-endpoint",
        "cachedAt": now_utc,
        "fromCache": False,
        "queryTimeSec": round(time.time() - t_start, 1),
    }
    _lakehouse_counts_cache = {k: v for k, v in results.items() if k != "_meta"}
    _lakehouse_counts_cache_ts = time.time()
    return results


@route("GET", "/api/lakehouse-counts")
def get_lakehouse_counts(params: dict) -> dict:
    """Table counts from local OneLake mount (primary) or Fabric endpoints (fallback).
    Cached 5 min. Pass ?force=true to bypass cache."""
    force = str(params.get("force", "")).lower() in ("true", "1", "yes")
    return _get_lakehouse_counts_inner(force_refresh=force)


@route("POST", "/api/lakehouse-counts/refresh")
def post_lakehouse_counts_refresh(params: dict) -> dict:
    """Force-refresh lakehouse counts from filesystem."""
    return _get_lakehouse_counts_inner(force_refresh=True)


@route("POST", "/api/entity-status/sync")
def post_entity_status_sync(params: dict) -> dict:
    """Derive entity status from OneLake filesystem and write to SQLite.
    If a table/file exists on disk → loaded. No Fabric SQL, no sync lag."""
    return sync_entity_status_from_filesystem()


# ---------------------------------------------------------------------------
# Purview integration — graceful degradation when not configured
# ---------------------------------------------------------------------------

def _get_purview_account() -> str | None:
    """Return the Purview account name from config, or None if not configured."""
    cfg = _get_config()
    account = cfg.get("purview", {}).get("account_name", "")
    return account if account else None


def _purview_search(account_name: str, query: str) -> list[dict]:
    """Search Purview catalog via REST API. Returns list of matching entities."""
    try:
        token = _get_fabric_token("https://purview.azure.net/.default")
    except Exception as e:
        log.warning("Cannot get Purview token: %s", e)
        return []

    url = f"https://{account_name}.purview.azure.com/catalog/api/search/query?api-version=2022-03-01-preview"
    body = json.dumps({"keywords": query, "limit": 10}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        results = []
        for item in data.get("value", []):
            results.append({
                "name": item.get("name", ""),
                "qualifiedName": item.get("qualifiedName", ""),
                "entityType": item.get("entityType", ""),
                "description": item.get("description", ""),
                "id": item.get("id", ""),
            })
        return results
    except urllib.error.HTTPError as e:
        log.warning("Purview search failed: %s %s", e.code, e.read().decode()[:200])
        return []
    except Exception as e:
        log.warning("Purview search failed: %s", e)
        return []


@route("GET", "/api/purview/status")
def get_purview_status(params: dict) -> dict:
    """Return Purview integration status. Gracefully returns not_configured
    when no account name is set."""
    account = _get_purview_account()
    if not account:
        return {"connected": False, "status": "not_configured"}

    # Attempt a lightweight catalog call to verify connectivity
    try:
        token = _get_fabric_token("https://purview.azure.net/.default")
        url = f"https://{account}.purview.azure.com/catalog/api/atlas/v2/types/typedefs/headers?api-version=2022-03-01-preview"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        resp = urllib.request.urlopen(req, timeout=10)
        resp.read()
        return {"connected": True, "status": "connected", "account": account}
    except Exception as e:
        log.warning("Purview connectivity check failed: %s", e)
        return {"connected": False, "status": "unreachable", "account": account, "error": str(e)}


@route("GET", "/api/purview/search")
def get_purview_search(params: dict) -> list:
    """Search Purview catalog for entities matching query. Returns empty list
    when Purview is not configured or unavailable."""
    query = params.get("q", "").strip()
    if not query:
        return []

    account = _get_purview_account()
    if not account:
        return []

    return _purview_search(account, query)


@route("GET", "/api/blender/profile")
def get_blender_profile(params: dict) -> dict:
    lakehouse = params.get("lakehouse", "")
    schema = params.get("schema", "dbo")
    table = params.get("table", "")
    if not lakehouse or not table:
        raise HttpError("lakehouse and table params required", 400)
    s = _sanitize(schema)
    t = _sanitize(table)
    try:
        raw_cols = _query_lakehouse(
            lakehouse,
            f"SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE "
            f"FROM INFORMATION_SCHEMA.COLUMNS "
            f"WHERE TABLE_SCHEMA = '{s}' AND TABLE_NAME = '{t}' "
            f"ORDER BY ORDINAL_POSITION",
        )
        cols = [
            {
                "name": c.get("COLUMN_NAME", ""),
                "dataType": c.get("DATA_TYPE", ""),
                "nullable": c.get("IS_NULLABLE", "YES") == "YES",
            }
            for c in raw_cols
        ]
        try:
            rc = _query_lakehouse(lakehouse, f"SELECT COUNT(*) AS cnt FROM [{s}].[{t}]")
            row_count = int(rc[0]["cnt"]) if rc else -1
        except Exception:
            row_count = -1
        return {"lakehouse": lakehouse, "schema": schema, "table": table,
                "rowCount": row_count, "columnCount": len(cols), "columns": cols}
    except HttpError:
        raise
    except Exception as e:
        raise HttpError(str(e), 502)


@route("GET", "/api/blender/sample")
def get_blender_sample(params: dict) -> dict:
    lakehouse = params.get("lakehouse", "")
    schema = params.get("schema", "dbo")
    table = params.get("table", "")
    try:
        limit = max(1, min(int(params.get("limit", 25)), 1000))
    except (TypeError, ValueError):
        limit = 25
    if not lakehouse or not table:
        raise HttpError("lakehouse and table params required", 400)
    s = _sanitize(schema)
    t = _sanitize(table)
    try:
        rows = _query_lakehouse(lakehouse, f"SELECT TOP {limit} * FROM [{s}].[{t}]")
        return {"lakehouse": lakehouse, "schema": schema, "table": table,
                "limit": limit, "rowCount": len(rows), "rows": rows}
    except HttpError:
        raise
    except Exception as e:
        raise HttpError(str(e), 502)


@route("POST", "/api/blender/query")
def post_blender_query(params: dict) -> dict:
    """Execute a SELECT-only query against a lakehouse.

    Security fix: SELECT-only validation is enforced before any
    connection is opened. DML/DDL raises HTTP 400 without touching
    the lakehouse.
    """
    lakehouse = params.get("lakehouse", "")
    sql = params.get("sql", "")
    if not lakehouse:
        raise HttpError("lakehouse param required", 400)
    if not sql:
        raise HttpError("sql param required", 400)

    # SECURITY: SELECT-only enforcement
    _validate_select_only(sql)

    # Enforce TOP 100 if not present
    stripped_upper = sql.strip().upper()
    if "TOP " not in stripped_upper:
        select_idx = sql.upper().find("SELECT")
        if select_idx >= 0:
            after = select_idx + 6
            rest = sql[after:].lstrip()
            if rest.upper().startswith("DISTINCT"):
                after = select_idx + 6 + (len(sql[after:]) - len(rest)) + 8
            sql = sql[:after] + " TOP 100 " + sql[after:]

    try:
        rows = _query_lakehouse(lakehouse, sql)
        return {"success": True, "rowCount": len(rows), "rows": rows, "sql": sql}
    except HttpError:
        raise
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

@route("GET", "/api/schema")
def get_schema_info(params: dict) -> list:
    """Return schema info for all registered entities from SQLite."""
    return db.query(
        "SELECT le.LandingzoneEntityId, le.SourceSchema, le.SourceName, "
        "le.FileName, le.IsActive, ds.Name AS DataSourceName "
        "FROM lz_entities le "
        "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "ORDER BY ds.Name, le.SourceSchema, le.SourceName"
    )
