"""Data access routes — blender, schema, lakehouse counts.

Security fix applied:
    POST /api/blender/query — SELECT-only enforcement prevents arbitrary DML.

Covers:
    GET  /api/blender/tables     — all tables across all layers (metadata + discovery)
    GET  /api/blender/endpoints  — lakehouse SQL endpoint discovery
    GET  /api/blender/profile    — column + row-count profile for a lakehouse table
    GET  /api/blender/sample     — sampled rows from a lakehouse table
    POST /api/blender/query      — execute a SELECT-only query against a lakehouse
    GET  /api/lakehouse-counts   — row counts across all lakehouses
    GET  /api/schema             — schema info from SQLite
"""
import json
import logging
import urllib.request
import urllib.parse
from pathlib import Path

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.data_access")

# ---------------------------------------------------------------------------
# Config helpers (lazy)
# ---------------------------------------------------------------------------

_CONFIG: dict | None = None


def _get_config() -> dict:
    global _CONFIG
    if _CONFIG is None:
        try:
            cfg_path = Path(__file__).parent.parent / "config.json"
            _CONFIG = json.loads(cfg_path.read_text())
        except Exception:
            _CONFIG = {}
    return _CONFIG


def _get_fabric_token(scope: str) -> str:
    cfg = _get_config()
    tenant = cfg.get("fabric", {}).get("tenant_id", "")
    client_id = cfg.get("fabric", {}).get("client_id", "")
    client_secret = cfg.get("fabric", {}).get("client_secret", "")
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


def _get_lakehouse_connection(lakehouse_name: str):
    """Return a pyodbc connection to a lakehouse SQL endpoint."""
    import pyodbc
    lh = db.query(
        "SELECT LakehouseGuid, WorkspaceGuid FROM lakehouses WHERE Name = ? LIMIT 1",
        (lakehouse_name,),
    )
    if not lh:
        raise HttpError(f"Lakehouse '{lakehouse_name}' not found", 404)

    lh_guid = lh[0]["LakehouseGuid"]
    ws_guid = lh[0]["WorkspaceGuid"]

    # Use the SQL Analytics Endpoint pattern
    cfg = _get_config()
    server = cfg.get("sql", {}).get("server", "")
    database = cfg.get("sql", {}).get("database", "")

    if not server:
        raise HttpError("SQL endpoint not configured", 503)

    import struct
    token = _get_fabric_token("https://analysis.windows.net/powerbi/api/.default")
    token_bytes = token.encode("utf-16-le")
    attrs_before = {1256: struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)}
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    return pyodbc.connect(conn_str, attrs_before=attrs_before, timeout=30)


def _query_lakehouse(lakehouse_name: str, sql: str) -> list[dict]:
    conn = _get_lakehouse_connection(lakehouse_name)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        cols = [c[0] for c in cursor.description] if cursor.description else []
        return [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)}
                for row in cursor.fetchall()]
    finally:
        conn.close()


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


@route("GET", "/api/lakehouse-counts")
def get_lakehouse_counts(params: dict) -> dict:
    """Cached row counts per lakehouse table — read from SQLite metrics store."""
    # In the refactored architecture this returns whatever is in the metrics store.
    # The background sync populates it; here we just return what's cached.
    try:
        import json as _json
        counts_file = Path(__file__).parent.parent / "lakehouse_counts_cache.json"
        if counts_file.is_file():
            raw = _json.loads(counts_file.read_text())
            return raw.get("counts", raw)
    except Exception:
        pass
    return {}


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
