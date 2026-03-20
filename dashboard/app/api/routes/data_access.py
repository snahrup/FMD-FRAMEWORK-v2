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


def _try_launch_onelake_explorer():
    """Attempt to auto-launch OneLake File Explorer (Windows Store app)."""
    import subprocess
    try:
        # Windows Store app — launch via shell protocol
        subprocess.Popen(
            ["cmd", "/c", "start", "onelake-explorer:"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        log.info("Attempted to launch OneLake File Explorer")
    except Exception as e:
        log.warning("Failed to launch OneLake File Explorer: %s", e)


# ---------------------------------------------------------------------------
# OneLake local mount — the filesystem IS the source of truth
# ---------------------------------------------------------------------------

_ONELAKE_MOUNT = os.environ.get("ONELAKE_MOUNT_PATH", "")


def _get_onelake_mount() -> Path | None:
    """Return the OneLake mount root (workspace dir) or None if not available.
    Auto-discovers from common locations if env var not set."""
    mount = _ONELAKE_MOUNT
    if mount:
        p = Path(mount)
        return p if p.is_dir() else None

    # Auto-discover: look for OneLake sync folder + INTEGRATION DATA workspace
    # OneLake may sync under a different Windows profile than the running process
    # (e.g. snahrup runs the server but sasnahrup has OneLake synced)
    home = Path.home()
    candidates = [
        home / "OneLake - Microsoft" / "INTEGRATION DATA (D)",
        home / "Microsoft" / "OneLake" / "INTEGRATION DATA (D)",
    ]
    # Also scan sibling user profiles for OneLake mounts
    users_dir = home.parent
    if users_dir.is_dir():
        try:
            for sibling in users_dir.iterdir():
                if sibling == home or not sibling.is_dir():
                    continue
                ol = sibling / "OneLake - Microsoft" / "INTEGRATION DATA (D)"
                if ol.is_dir():
                    candidates.append(ol)
        except PermissionError as e:
            log.debug("Permission denied scanning sibling OneLake dirs: %s", e)
    for candidate in candidates:
        if candidate.is_dir():
            log.info("Auto-discovered OneLake mount: %s", candidate)
            return candidate

    return None


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
    except OSError as e:
        log.debug("Failed to scan LZ directory %s: %s", lz_dir, e)

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
        except OSError as e:
            log.debug("Failed to scan %s directory %s: %s", layer, tables_dir, e)

    return index


def sync_entity_status_from_filesystem() -> dict:
    """DEPRECATED: entity_status is no longer the source of truth.
    Status is now derived from engine_task_log via get_canonical_entity_status().
    This function is a no-op to prevent re-populating stale data.
    """
    return {
        "status": "deprecated",
        "message": "Entity status is now derived from engine_task_log. Filesystem sync disabled.",
        "synced": 0,
    }

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
        except Exception as e:
            log.warning("Failed to load config.json: %s", e)
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

    token = _get_fabric_token("https://analysis.windows.net/powerbi/api/.default")
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
    """Strip characters dangerous in SQL identifiers.

    Allows: alphanumeric, dash, underscore, space, period.
    Strips: brackets, quotes, semicolons, comment markers, etc.
    """
    return "".join(c for c in val if c.isalnum() or c in "-_. ")


# ---------------------------------------------------------------------------
# OneLake + polars helpers for blender endpoints
# ---------------------------------------------------------------------------

def _resolve_onelake_table_path(lakehouse_name: str, schema: str, table: str) -> Path | None:
    """Return the local path to a lakehouse table's parquet files, or None."""
    mount = _get_onelake_mount()
    if not mount:
        return None

    # Delta Tables path (Bronze/Silver)
    table_dir = mount / f"{lakehouse_name}.Lakehouse" / "Tables" / schema / table
    if table_dir.is_dir():
        return table_dir

    # LZ uses Files/{schema}/{table}.parquet (single file)
    lz_file = mount / f"{lakehouse_name}.Lakehouse" / "Files" / schema / f"{table}.parquet"
    if lz_file.is_file():
        return lz_file

    return None


def _scan_onelake_table(lakehouse_name: str, schema: str, table: str):
    """Return a polars LazyFrame for a lakehouse table from local OneLake.

    Raises HttpError if table not found or polars unavailable.
    """
    import glob as globmod
    try:
        import polars as pl
    except ImportError:
        raise HttpError("polars not installed — required for local data access", 503)

    path = _resolve_onelake_table_path(lakehouse_name, schema, table)
    if path is None:
        raise HttpError(
            f"Table '{schema}.{table}' not found in lakehouse '{lakehouse_name}' on local OneLake mount",
            404,
        )

    # OneLake cloud files don't support memory-mapped IO (scan_parquet fails
    # with OS error 362). Try scan first, fall back to eager read_parquet.
    try:
        if path.is_file():
            return pl.scan_parquet(str(path))
        parts = globmod.glob(str(path / "*.parquet"))
        if not parts:
            parts = globmod.glob(str(path / "**" / "*.parquet"), recursive=True)
        if not parts:
            raise HttpError(f"No parquet files found in {path}", 404)
        return pl.scan_parquet(parts)
    except OSError as e:
        if "cloud file provider" not in str(e).lower() and "362" not in str(e):
            raise
        # Fall back to eager read for OneLake cloud-synced files
        log.info("scan_parquet failed (cloud provider), falling back to read_parquet for %s", path)
        try:
            if path.is_file():
                return pl.read_parquet(str(path)).lazy()
            return pl.read_parquet(parts).lazy()
        except OSError:
            # Auto-launch OneLake File Explorer if it's not running
            _try_launch_onelake_explorer()
            raise HttpError(
                "OneLake File Explorer is not running. Attempting to launch it — please retry in a few seconds.",
                503,
            )


# Polars dtype → SQL-like type name (shared with lineage)
_POLARS_DTYPE_MAP = {
    "Int8": "tinyint", "Int16": "smallint", "Int32": "int", "Int64": "bigint",
    "UInt8": "tinyint", "UInt16": "smallint", "UInt32": "int", "UInt64": "bigint",
    "Float32": "real", "Float64": "float",
    "Boolean": "bit", "Utf8": "varchar", "String": "varchar",
    "Date": "date", "Datetime": "datetime2", "Time": "time",
    "Duration": "bigint", "Binary": "varbinary", "LargeBinary": "varbinary",
    "Decimal": "decimal", "Null": "null",
}


def _polars_dtype_to_sql(dtype) -> str:
    name = str(dtype)
    base = name.split("(")[0].split("[")[0].strip()
    return _POLARS_DTYPE_MAP.get(base, name.lower())


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
        "le.FileName, le.FilePath, le.IsActive, ds.Name AS DataSourceName, lh.Name AS LakehouseName "
        "FROM lz_entities le "
        "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "LEFT JOIN lakehouses lh ON le.LakehouseId = lh.LakehouseId "
        "WHERE le.IsActive = 1 ORDER BY le.SourceName"
    )
    for row in lz:
        display = row.get("FileName") or row.get("SourceName", "")
        # LZ parquet files live under Files/{FilePath}/ on OneLake, not Files/{SourceSchema}/
        raw_fp = row.get("FilePath") or row.get("SourceSchema") or "dbo"
        # Some records store full paths like "/dbo/table.parquet" — extract just the folder
        file_path = raw_fp.strip("/").split("/")[0] if "/" in raw_fp else raw_fp
        tables.append({
            "id": f"lz-{row['Id']}",
            "name": display,
            "layer": "landing",
            "lakehouse": row.get("LakehouseName") or "LH_DATA_LANDINGZONE",
            "schema": file_path,
            "source": "metadata",
            "dataSource": row.get("DataSourceName") or "",
        })

    br = db.query(
        "SELECT be.BronzeLayerEntityId AS Id, be.Schema_ AS SourceSchema, be.Name AS SourceName, "
        "be.IsActive, lh.Name AS LakehouseName, le.FilePath AS LzFilePath "
        "FROM bronze_entities be "
        "LEFT JOIN lakehouses lh ON be.LakehouseId = lh.LakehouseId "
        "LEFT JOIN lz_entities le ON le.LandingzoneEntityId = be.LandingzoneEntityId "
        "WHERE be.IsActive = 1 ORDER BY be.Name"
    )
    for row in br:
        # OneLake Delta tables live under Tables/{FilePath}/, not Tables/{Schema_}/
        onelake_schema = row.get("LzFilePath") or row.get("SourceSchema") or "dbo"
        tables.append({
            "id": f"br-{row['Id']}",
            "name": row.get("SourceName", ""),
            "layer": "bronze",
            "lakehouse": row.get("LakehouseName") or "LH_BRONZE_LAYER",
            "schema": onelake_schema,
            "source": "metadata",
        })

    sv = db.query(
        "SELECT se.SilverLayerEntityId AS Id, se.Schema_ AS SourceSchema, se.Name AS SourceName, "
        "se.IsActive, lh.Name AS LakehouseName, le.FilePath AS LzFilePath "
        "FROM silver_entities se "
        "LEFT JOIN lakehouses lh ON se.LakehouseId = lh.LakehouseId "
        "LEFT JOIN bronze_entities be ON be.BronzeLayerEntityId = se.BronzeLayerEntityId "
        "LEFT JOIN lz_entities le ON le.LandingzoneEntityId = be.LandingzoneEntityId "
        "WHERE se.IsActive = 1 ORDER BY se.Name"
    )
    for row in sv:
        onelake_schema = row.get("LzFilePath") or row.get("SourceSchema") or "dbo"
        tables.append({
            "id": f"sv-{row['Id']}",
            "name": row.get("SourceName", ""),
            "layer": "silver",
            "lakehouse": row.get("LakehouseName") or "LH_SILVER_LAYER",
            "schema": onelake_schema,
            "source": "metadata",
        })

    return tables


@route("GET", "/api/blender/endpoints")
def get_blender_endpoints(params: dict) -> dict:
    """Return known lakehouse SQL endpoint mappings."""
    lakehouses = db.query("SELECT Name, LakehouseGuid, WorkspaceGuid FROM lakehouses")
    return {lh["Name"]: lh for lh in lakehouses}


# ---------------------------------------------------------------------------
# Lakehouse row counts — local OneLake parquet scanning + SQLite cache
# ---------------------------------------------------------------------------

_scan_lock = threading.Lock()
_scan_running = False
_scan_progress: dict = {"scanned": 0, "total": 0, "layer": "", "started": 0.0}


def _count_parquet_rows(path: str) -> int:
    """Count rows in a single parquet file using polars (metadata only, fast)."""
    try:
        import polars as pl
        return pl.scan_parquet(path).select(pl.len()).collect().item()
    except Exception as e:
        log.debug("Failed to count parquet rows for %s: %s", path, e)
        return -1


def _count_delta_table_rows(table_dir: str) -> tuple[int, int, int]:
    """Count rows in a Delta table by reading all parquet parts.
    Returns (row_count, file_count, size_bytes)."""
    import glob as globmod
    parts = globmod.glob(os.path.join(table_dir, "*.parquet"))
    if not parts:
        return (0, 0, 0)
    try:
        import polars as pl
        row_count = pl.scan_parquet(parts).select(pl.len()).collect().item()
        size = sum(os.path.getsize(p) for p in parts)
        return (row_count, len(parts), size)
    except Exception as e:
        log.debug("Failed to count delta table rows for %s: %s", table_dir, e)
        return (-1, len(parts), 0)


def _scan_single_table(args: tuple) -> tuple:
    """Scan a single table/file and return (lakehouse, schema, name, row_count, file_count, size_bytes)."""
    lakehouse, schema, entry, base_path, is_lz = args
    if is_lz:
        table_name = entry[:-8]  # strip .parquet
        fpath = os.path.join(base_path, entry)
        row_count = _count_parquet_rows(fpath)
        file_count = 1
        try:
            size_bytes = os.path.getsize(fpath) if row_count >= 0 else 0
        except OSError:
            log.exception("Failed to get file size for %s", fpath)
            size_bytes = 0
    else:
        table_name = entry
        table_path = os.path.join(base_path, entry)
        row_count, file_count, size_bytes = _count_delta_table_rows(table_path)
    return (lakehouse, schema, table_name, row_count, file_count, size_bytes)


def _scan_layer_to_cache(lakehouse: str, base_dir: str, is_lz: bool = False) -> int:
    """Scan a lakehouse layer from local OneLake files, cache row counts to SQLite.
    LZ: reads single parquet files.  Bronze/Silver: reads Delta table dirs.
    Uses thread pool for parallelism. Returns number of tables scanned."""
    global _scan_progress

    # Build work items
    work: list[tuple] = []
    for schema in os.listdir(base_dir):
        schema_path = os.path.join(base_dir, schema)
        if not os.path.isdir(schema_path):
            continue
        for entry in os.listdir(schema_path):
            if is_lz:
                if not entry.endswith(".parquet") or entry.startswith("X_"):
                    continue
                work.append((lakehouse, schema, entry, schema_path, True))
            else:
                table_path = os.path.join(schema_path, entry)
                if entry.startswith("_") or not os.path.isdir(table_path):
                    continue
                work.append((lakehouse, schema, entry, schema_path, False))

    _scan_progress["total"] += len(work)
    scanned = 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Parallel scan with 12 threads (IO-bound, more threads = more concurrent Azure requests)
    with ThreadPoolExecutor(max_workers=12) as pool:
        for result in pool.map(_scan_single_table, work):
            lh, schema, table_name, row_count, file_count, size_bytes = result
            db.execute(
                "INSERT INTO lakehouse_row_counts "
                "(lakehouse, schema_name, table_name, row_count, file_count, size_bytes, scanned_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(lakehouse, schema_name, table_name) DO UPDATE SET "
                "row_count=excluded.row_count, file_count=excluded.file_count, "
                "size_bytes=excluded.size_bytes, scanned_at=excluded.scanned_at",
                (lh, schema, table_name, row_count, file_count, size_bytes, now),
            )
            scanned += 1
            _scan_progress["scanned"] += 1

    return scanned


def _run_full_scan():
    """Background worker: scan all 3 lakehouse layers from OneLake mount."""
    global _scan_running, _scan_progress
    mount = _get_onelake_mount()
    if not mount:
        log.warning("Cannot scan: ONELAKE_MOUNT_PATH not set or not a directory")
        _scan_running = False
        return

    _scan_progress = {"scanned": 0, "total": 0, "layer": "discovering", "started": time.time()}

    layers = [
        ("LH_DATA_LANDINGZONE", str(mount / "LH_DATA_LANDINGZONE.Lakehouse" / "Files"), True),
        ("LH_BRONZE_LAYER", str(mount / "LH_BRONZE_LAYER.Lakehouse" / "Tables"), False),
        ("LH_SILVER_LAYER", str(mount / "LH_SILVER_LAYER.Lakehouse" / "Tables"), False),
    ]

    total_scanned = 0
    for lh_name, base_dir, is_lz in layers:
        if not os.path.isdir(base_dir):
            log.warning("Layer dir not found: %s", base_dir)
            continue
        _scan_progress["layer"] = lh_name
        try:
            n = _scan_layer_to_cache(lh_name, base_dir, is_lz=is_lz)
            total_scanned += n
            log.info("Scanned %s: %d tables", lh_name, n)
        except Exception as e:
            log.error("Scan failed for %s: %s", lh_name, e)

    elapsed = time.time() - _scan_progress["started"]
    log.info("Full lakehouse scan complete: %d tables in %.1fs", total_scanned, elapsed)
    _scan_progress["layer"] = "done"
    _scan_running = False


def _get_counts_from_cache() -> dict:
    """Read cached row counts from SQLite, merged with filesystem discovery.
    Cached tables get real row counts; uncached tables get -1 (exists but not yet scanned)."""
    # Start with filesystem discovery (all tables, -1 counts)
    results = _count_from_filesystem()

    # Overlay cached row counts
    cached = db.query(
        "SELECT lakehouse, schema_name, table_name, row_count, file_count, size_bytes "
        "FROM lakehouse_row_counts"
    )
    if not cached:
        return results

    # Build lookup: (lakehouse, schema, table) -> cached data
    cache_map: dict[tuple, dict] = {}
    for r in cached:
        key = (r["lakehouse"], r["schema_name"].lower(), r["table_name"].lower())
        cache_map[key] = {
            "rowCount": int(r["row_count"]),
            "fileCount": int(r["file_count"]),
            "sizeBytes": int(r["size_bytes"]),
        }

    # Merge cached counts into filesystem-discovered tables
    for lh_name, tables in results.items():
        if not isinstance(tables, list):
            continue
        for t in tables:
            key = (lh_name, t["schema"].lower(), t["table"].lower())
            if key in cache_map:
                t["rowCount"] = cache_map[key]["rowCount"]
                t["fileCount"] = cache_map[key]["fileCount"]
                t["sizeBytes"] = cache_map[key]["sizeBytes"]

    return results


@route("GET", "/api/lakehouse-counts")
def get_lakehouse_counts(params: dict) -> dict:
    """Table counts from SQLite cache (populated by scanning OneLake parquet files).
    Returns cached data instantly.  Use POST /api/lakehouse-counts/scan to refresh."""
    t_start = time.time()
    results = _get_counts_from_cache()

    # If cache is empty and filesystem is available, populate from directory listing
    # (with -1 row counts) so user at least sees table names
    if not results:
        local_counts = _count_from_filesystem()
        if local_counts:
            results = local_counts

    # Scan metadata
    scan_meta = db.query(
        "SELECT MIN(scanned_at) AS oldest, MAX(scanned_at) AS newest, COUNT(*) AS total "
        "FROM lakehouse_row_counts"
    )
    meta_row = scan_meta[0] if scan_meta else {}

    results["_meta"] = {
        "source": "sqlite-cache" if meta_row.get("total", 0) else "filesystem-listing",
        "cachedAt": meta_row.get("newest") or datetime.now(timezone.utc).isoformat(),
        "fromCache": True,
        "cacheAgeSec": 0,
        "queryTimeSec": round(time.time() - t_start, 3),
        "cachedTables": int(meta_row.get("total", 0)),
        "oldestScan": meta_row.get("oldest"),
        "newestScan": meta_row.get("newest"),
        "scanRunning": _scan_running,
        "scanProgress": _scan_progress if _scan_running else None,
    }
    return results


@route("POST", "/api/lakehouse-counts/scan")
def post_lakehouse_counts_scan(params: dict) -> dict:
    """Trigger a background scan of all OneLake parquet files to refresh row counts.
    Scans run in background — poll GET /api/lakehouse-counts for progress."""
    global _scan_running
    if _scan_running:
        return {
            "status": "already_running",
            "progress": _scan_progress,
        }

    with _scan_lock:
        if _scan_running:
            return {"status": "already_running", "progress": _scan_progress}
        _scan_running = True

    # Run in background thread
    t = threading.Thread(target=_run_full_scan, daemon=True, name="lakehouse-scan")
    t.start()
    return {"status": "started", "message": "Background scan started. Poll GET /api/lakehouse-counts for progress."}


@route("POST", "/api/lakehouse-counts/refresh")
def post_lakehouse_counts_refresh(params: dict) -> dict:
    """Alias for scan — triggers background parquet file scan."""
    return post_lakehouse_counts_scan(params)


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
    """Profile a lakehouse table: row count + per-column null/distinct/min/max.

    Uses local OneLake parquet files via polars (no Fabric SQL dependency).
    """
    import polars as pl

    lakehouse = params.get("lakehouse", "")
    schema = params.get("schema", "dbo")
    table = params.get("table", "")
    if not lakehouse or not table:
        raise HttpError("lakehouse and table params required", 400)
    s = _sanitize(schema)
    t = _sanitize(table)

    try:
        lf = _scan_onelake_table(lakehouse, s, t)
    except HttpError:
        raise  # re-raise known HTTP errors as-is
    except Exception as e:
        raise HttpError(str(e), 502)

    # Schema from parquet metadata (instant, no data read)
    col_names = list(lf.schema.keys())
    col_dtypes = list(lf.schema.values())

    if not col_names:
        return {"lakehouse": lakehouse, "schema": schema, "table": table,
                "rowCount": 0, "columnCount": 0, "profiledColumns": 0, "columns": []}

    # Profile: sample up to 100k rows for statistics
    profiled_names = col_names[:50]
    try:
        sample = lf.head(100_000).collect()
        row_count = len(sample)
    except Exception as e:
        log.error("Profile data read failed for %s.%s.%s: %s", lakehouse, s, t, e)
        cols_meta = []
        for i, name in enumerate(col_names):
            cols_meta.append({
                "name": name, "dataType": _polars_dtype_to_sql(col_dtypes[i]),
                "nullable": True, "maxLength": None, "precision": None, "scale": None,
                "ordinal": i + 1, "distinctCount": 0, "nullCount": 0, "nullPercentage": 0,
                "minValue": None, "maxValue": None, "uniqueness": 0, "completeness": 0,
            })
        return {"lakehouse": lakehouse, "schema": schema, "table": table,
                "rowCount": -1, "columnCount": len(col_names),
                "profiledColumns": 0, "columns": cols_meta, "error": str(e)}

    column_profiles = []
    for i, name in enumerate(profiled_names):
        dtype = col_dtypes[i]
        sql_type = _polars_dtype_to_sql(dtype)
        col_series = sample[name]
        nulls = int(col_series.null_count())
        distinct = int(col_series.n_unique())
        null_pct = round(nulls / row_count * 100, 2) if row_count > 0 else 0.0

        min_val = None
        max_val = None
        try:
            if col_series.dtype.is_numeric() or col_series.dtype.is_temporal():
                mn = col_series.drop_nulls().min()
                mx = col_series.drop_nulls().max()
                min_val = str(mn) if mn is not None else None
                max_val = str(mx) if mx is not None else None
            elif col_series.dtype in (pl.Utf8, pl.String):
                mn = col_series.drop_nulls().min()
                mx = col_series.drop_nulls().max()
                min_val = str(mn)[:200] if mn is not None else None
                max_val = str(mx)[:200] if mx is not None else None
        except Exception as e:
            log.debug("Failed to compute min/max for column %s: %s", name, e)

        column_profiles.append({
            "name": name,
            "dataType": sql_type,
            "nullable": True,
            "maxLength": None,
            "precision": None,
            "scale": None,
            "ordinal": i + 1,
            "distinctCount": distinct,
            "nullCount": nulls,
            "nullPercentage": null_pct,
            "minValue": min_val,
            "maxValue": max_val,
            "uniqueness": round(distinct / row_count * 100, 2) if row_count > 0 else 0.0,
            "completeness": round(100 - null_pct, 2),
        })

    return {
        "lakehouse": lakehouse,
        "schema": schema,
        "table": table,
        "rowCount": row_count,
        "columnCount": len(col_names),
        "profiledColumns": len(profiled_names),
        "columns": column_profiles,
    }


def _safe_int(val) -> int | None:
    """Convert a value to int, returning None if not possible."""
    if val is None:
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


@route("GET", "/api/blender/sample")
def get_blender_sample(params: dict) -> dict:
    """Sample rows from a lakehouse table via local OneLake parquet files."""
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
        lf = _scan_onelake_table(lakehouse, s, t)
        df = lf.head(limit).collect()
        rows = []
        for row_dict in df.to_dicts():
            rows.append({k: (str(v) if v is not None else None) for k, v in row_dict.items()})
        return {"lakehouse": lakehouse, "schema": schema, "table": table,
                "limit": limit, "rowCount": len(rows), "rows": rows}
    except HttpError:
        raise  # re-raise known HTTP errors as-is
    except Exception as e:
        raise HttpError(str(e), 502)


@route("POST", "/api/blender/query")
def post_blender_query(params: dict) -> dict:
    """Execute a SELECT-only query against lakehouse data via polars SQLContext.

    Security fix: SELECT-only validation is enforced before any
    data access. DML/DDL raises HTTP 400.
    """
    import polars as pl

    lakehouse = params.get("lakehouse", "")
    sql = params.get("sql", "")
    if not lakehouse:
        raise HttpError("lakehouse param required", 400)
    if not sql:
        raise HttpError("sql param required", 400)

    # SECURITY: SELECT-only enforcement
    _validate_select_only(sql)

    # Enforce LIMIT 100 if not present (polars SQL uses LIMIT not TOP)
    stripped_upper = sql.strip().upper()
    if "LIMIT " not in stripped_upper:
        # Strip trailing semicolons and add LIMIT
        sql = sql.rstrip().rstrip(";") + " LIMIT 100"

    # Convert T-SQL TOP syntax to LIMIT for polars SQL
    import re
    sql = re.sub(r'\bTOP\s+(\d+)\b', '', sql, flags=re.IGNORECASE)
    top_match = re.search(r'TOP\s+(\d+)', params.get("sql", ""), re.IGNORECASE)
    top_n = int(top_match.group(1)) if top_match else None

    # Discover all tables in this lakehouse and register them with SQLContext
    mount = _get_onelake_mount()
    if not mount:
        raise HttpError("OneLake mount not available — cannot run queries locally", 503)

    ctx = pl.SQLContext()

    # Register delta tables (Bronze/Silver)
    tables_dir = mount / f"{lakehouse}.Lakehouse" / "Tables"
    if tables_dir.is_dir():
        for schema_dir in tables_dir.iterdir():
            if not schema_dir.is_dir():
                continue
            for table_dir in schema_dir.iterdir():
                if not table_dir.is_dir() or table_dir.name.startswith("_"):
                    continue
                import glob as globmod
                parts = globmod.glob(str(table_dir / "*.parquet"))
                if parts:
                    try:
                        lf = pl.scan_parquet(parts)
                        # Register as both schema.table and just table
                        ctx.register(f"{schema_dir.name}.{table_dir.name}", lf)
                        ctx.register(table_dir.name, lf)
                    except Exception as e:
                        log.debug("Failed to register table %s.%s in SQL context: %s", schema_dir.name, table_dir.name, e)

    # Register LZ files
    files_dir = mount / f"{lakehouse}.Lakehouse" / "Files"
    if files_dir.is_dir():
        for schema_dir in files_dir.iterdir():
            if not schema_dir.is_dir():
                continue
            for fname in schema_dir.iterdir():
                if fname.suffix == ".parquet" and not fname.name.startswith("X_"):
                    try:
                        lf = pl.scan_parquet(str(fname))
                        tname = fname.stem
                        ctx.register(f"{schema_dir.name}.{tname}", lf)
                        ctx.register(tname, lf)
                    except Exception as e:
                        log.debug("Failed to register LZ file %s in SQL context: %s", fname.name, e)

    # Strip bracket-style identifiers [schema].[table] → schema.table
    clean_sql = sql.replace("[", "").replace("]", "")

    try:
        result_lf = ctx.execute(clean_sql)
        df = result_lf.collect()
        if top_n and len(df) > top_n:
            df = df.head(top_n)
        rows = []
        for row_dict in df.to_dicts():
            rows.append({k: (str(v) if v is not None else None) for k, v in row_dict.items()})
        return {"success": True, "rowCount": len(rows), "rows": rows, "sql": clean_sql}
    except HttpError:
        raise  # re-raise known HTTP errors as-is
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
