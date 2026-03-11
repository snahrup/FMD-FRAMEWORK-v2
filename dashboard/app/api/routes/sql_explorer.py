"""SQL Object Explorer routes.

Security fix applied:
    All ODBC connections are validated against registered connections in
    the SQLite database before connecting.  Unregistered servers are
    rejected with HTTP 403 — this closes the ODBC injection vector
    identified in the Batch 6 audit.

Covers:
    GET  /api/sql-explorer/servers                 — registered source servers + reachability
    GET  /api/sql-explorer/databases               — databases on a source server
    GET  /api/sql-explorer/schemas                 — schemas in a database
    GET  /api/sql-explorer/tables                  — tables in a schema
    GET  /api/sql-explorer/columns                 — column metadata + row count
    GET  /api/sql-explorer/preview                 — sampled rows
    POST /api/sql-explorer/server-label            — save custom display label
    GET  /api/sql-explorer/lakehouses              — registered Fabric lakehouses
    GET  /api/sql-explorer/lakehouse-schemas       — schemas in a lakehouse
    GET  /api/sql-explorer/lakehouse-tables        — tables in a lakehouse schema
    GET  /api/sql-explorer/lakehouse-columns       — column metadata for a lakehouse table
    GET  /api/sql-explorer/lakehouse-preview       — sampled rows from a lakehouse table
    GET  /api/sql-explorer/lakehouse-files         — OneLake file listing
    GET  /api/sql-explorer/lakehouse-file-tables   — file-backed delta tables
    GET  /api/sql-explorer/lakehouse-file-detail   — detail for a specific table folder
"""
import json
import logging
import urllib.request
import urllib.parse
from pathlib import Path

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.sql_explorer")

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


def _get_sql_driver() -> str:
    return _get_config().get("sql", {}).get("driver", "ODBC Driver 18 for SQL Server")


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


# ---------------------------------------------------------------------------
# ODBC injection fix — server allowlist
# ---------------------------------------------------------------------------

def _validate_server(server: str) -> None:
    """Reject servers not registered in the FMD connections table.

    Security fix: prevents ODBC injection by ensuring only servers that
    are explicitly registered in the metadata DB can be connected to.
    Unregistered hostnames return HTTP 403.
    """
    allowed = db.query(
        "SELECT ServerName FROM connections WHERE ServerName IS NOT NULL AND ServerName != '' AND IsActive = 1"
    )
    allowed_servers = {r["ServerName"].strip().lower() for r in allowed if r.get("ServerName")}
    if server.strip().lower() not in allowed_servers:
        raise HttpError(
            f"Server '{server}' is not in registered connections. "
            "Register it in the Source Manager before exploring.",
            403,
        )


def _sanitize(val: str) -> str:
    """Strip characters dangerous in SQL identifiers."""
    return "".join(c for c in val if c.isalnum() or c in "-_ ")


# ---------------------------------------------------------------------------
# Source server labels (stored in SQLite admin_config)
# ---------------------------------------------------------------------------

def _load_server_labels() -> dict:
    try:
        rows = db.query("SELECT key, value FROM admin_config WHERE key LIKE 'server_label_%'")
        return {r["key"].replace("server_label_", "", 1): r["value"] for r in rows}
    except Exception:
        return {}


def _save_server_label(server: str, label: str) -> None:
    db.execute(
        "INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)",
        (f"server_label_{server}", label),
    )


# ---------------------------------------------------------------------------
# Lakehouse query helper
# ---------------------------------------------------------------------------

def _query_lakehouse(lakehouse_name: str, sql: str) -> list[dict]:
    """Execute a query against a Fabric lakehouse SQL Analytics Endpoint."""
    import pyodbc
    import struct
    lh = db.query(
        "SELECT LakehouseGuid, WorkspaceGuid FROM lakehouses WHERE Name = ? LIMIT 1",
        (lakehouse_name,),
    )
    if not lh:
        raise HttpError(f"Lakehouse '{lakehouse_name}' not found", 404)

    cfg = _get_config()
    server = cfg.get("sql", {}).get("server", "")
    database = cfg.get("sql", {}).get("database", "")
    if not server:
        raise HttpError("SQL Analytics Endpoint not configured", 503)

    token = _get_fabric_token("https://analysis.windows.net/powerbi/api/.default")
    token_bytes = token.encode("utf-16-le")
    attrs_before = {1256: struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)}
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={server};DATABASE={database};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    conn = pyodbc.connect(conn_str, attrs_before=attrs_before, timeout=30)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        cols = [c[0] for c in cursor.description] if cursor.description else []
        return [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)}
                for row in cursor.fetchall()]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Source SQL Server routes
# ---------------------------------------------------------------------------

@route("GET", "/api/sql-explorer/servers")
def get_sql_explorer_servers(params: dict) -> list:
    """Return all registered connections with reachability status.

    Connections without a ServerName are excluded (e.g. Fabric lakehouse
    connections that don't expose an ODBC endpoint).
    """
    import pyodbc
    rows = db.query(
        "SELECT c.ConnectionId, c.Name AS ConnName, c.ServerName, c.DatabaseName, c.Type, "
        "ds.Name AS DataSourceName, ds.Namespace, ds.Description "
        "FROM connections c "
        "LEFT JOIN datasources ds ON ds.ConnectionId = c.ConnectionId "
        "WHERE c.ServerName IS NOT NULL AND c.ServerName != '' "
        "ORDER BY ds.Name, c.Name"
    )
    labels = _load_server_labels()
    _FRIENDLY_DEFAULTS = {
        "mes": "MES", "etqstagingprd": "ETQ", "m3fdbprd": "M3",
        "di_prd_staging": "M3C", "optivalive": "Optiva",
    }
    seen: set = set()
    servers: list = []
    driver = _get_sql_driver()
    for r in rows:
        srv = r.get("ServerName", "")
        if not srv or srv in seen:
            continue
        seen.add(srv)
        status = "unknown"
        error = None
        try:
            conn = pyodbc.connect(
                f"DRIVER={{{driver}}};SERVER={srv};DATABASE=master;"
                f"Trusted_Connection=yes;TrustServerCertificate=yes;",
                timeout=5,
            )
            conn.close()
            status = "online"
        except Exception as e:
            status = "offline"
            error = str(e)[:200]

        db_name = r.get("DatabaseName") or ""
        ds_name = r.get("DataSourceName") or ""
        if srv in labels:
            display = labels[srv]
        elif db_name and db_name.lower() in _FRIENDLY_DEFAULTS:
            display = _FRIENDLY_DEFAULTS[db_name.lower()]
        else:
            display = ds_name or srv

        servers.append({
            "server": srv,
            "display": display,
            "datasource": ds_name,
            "database": db_name,
            "namespace": r.get("Namespace") or "",
            "description": r.get("Description") or "",
            "status": status,
            "error": error,
        })
    return servers


@route("GET", "/api/sql-explorer/databases")
def get_sql_explorer_databases(params: dict) -> list:
    """List USER databases on a registered source SQL Server."""
    import pyodbc
    server = params.get("server", "")
    if not server:
        raise HttpError("server param required", 400)
    # SECURITY: validate server is registered
    _validate_server(server)
    driver = _get_sql_driver()
    try:
        conn = pyodbc.connect(
            f"DRIVER={{{driver}}};SERVER={server};DATABASE=master;"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;",
            timeout=10,
        )
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name, state_desc, compatibility_level, create_date, collation_name "
            "FROM sys.databases WHERE state_desc = 'ONLINE' "
            "AND name NOT IN ('master','tempdb','model','msdb') ORDER BY name"
        )
        db_rows = cursor.fetchall()
    except pyodbc.Error as e:
        log.warning("sql_explorer_databases(%s): %s", server, e)
        return []

    results = []
    for row in db_rows:
        entry = {
            "name": row[0],
            "state_desc": str(row[1] or "ONLINE"),
            "compatibility_level": str(row[2]) if row[2] else None,
            "create_date": str(row[3]) if row[3] else None,
            "collation_name": str(row[4]) if row[4] else None,
            "table_count": "0",
        }
        try:
            db_name_q = row[0]
            cursor.execute(
                f"SELECT COUNT(*) FROM [{db_name_q}].INFORMATION_SCHEMA.TABLES "
                f"WHERE TABLE_TYPE = 'BASE TABLE'"
            )
            entry["table_count"] = str(cursor.fetchone()[0])
        except Exception:
            pass
        results.append(entry)
    try:
        conn.close()
    except Exception:
        pass
    return results


@route("GET", "/api/sql-explorer/schemas")
def get_sql_explorer_schemas(params: dict) -> list:
    import pyodbc
    server = params.get("server", "")
    database = params.get("database", "")
    if not server or not database:
        raise HttpError("server and database params required", 400)
    # SECURITY: validate server
    _validate_server(server)
    s_db = _sanitize(database)
    driver = _get_sql_driver()
    try:
        conn = pyodbc.connect(
            f"DRIVER={{{driver}}};SERVER={server};DATABASE={s_db};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;",
            timeout=10,
        )
        cursor = conn.cursor()
        cursor.execute(
            "SELECT TABLE_SCHEMA AS schema_name, CAST(COUNT(*) AS VARCHAR) AS table_count "
            "FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' "
            "GROUP BY TABLE_SCHEMA ORDER BY TABLE_SCHEMA"
        )
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        conn.close()
        return [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)} for row in rows]
    except Exception as e:
        raise HttpError(str(e), 502)


@route("GET", "/api/sql-explorer/tables")
def get_sql_explorer_tables(params: dict) -> list:
    import pyodbc
    server = params.get("server", "")
    database = params.get("database", "")
    schema = params.get("schema", "")
    if not server or not database or not schema:
        raise HttpError("server, database, and schema params required", 400)
    # SECURITY: validate server
    _validate_server(server)
    s_db = _sanitize(database)
    s_sch = _sanitize(schema)
    driver = _get_sql_driver()
    try:
        conn = pyodbc.connect(
            f"DRIVER={{{driver}}};SERVER={server};DATABASE={s_db};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;",
            timeout=10,
        )
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES "
            f"WHERE TABLE_SCHEMA = '{s_sch}' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
        )
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        conn.close()
        return [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)} for row in rows]
    except Exception as e:
        raise HttpError(str(e), 502)


@route("GET", "/api/sql-explorer/columns")
def get_sql_explorer_columns(params: dict) -> dict:
    import pyodbc
    server = params.get("server", "")
    database = params.get("database", "")
    schema = params.get("schema", "")
    table = params.get("table", "")
    if not server or not database or not schema or not table:
        raise HttpError("server, database, schema, and table params required", 400)
    # SECURITY: validate server
    _validate_server(server)
    s_db = _sanitize(database)
    s_sch = _sanitize(schema)
    s_tbl = _sanitize(table)
    driver = _get_sql_driver()
    try:
        conn = pyodbc.connect(
            f"DRIVER={{{driver}}};SERVER={server};DATABASE={s_db};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;",
            timeout=15,
        )
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT
                c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE,
                CAST(c.CHARACTER_MAXIMUM_LENGTH AS VARCHAR) AS CHARACTER_MAXIMUM_LENGTH,
                CAST(c.NUMERIC_PRECISION AS VARCHAR) AS NUMERIC_PRECISION,
                CAST(c.NUMERIC_SCALE AS VARCHAR) AS NUMERIC_SCALE,
                CAST(c.ORDINAL_POSITION AS VARCHAR) AS ORDINAL_POSITION,
                c.COLUMN_DEFAULT,
                CASE WHEN kcu.COLUMN_NAME IS NOT NULL THEN '1' ELSE '0' END AS IS_PK
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                ON tc.TABLE_SCHEMA = c.TABLE_SCHEMA AND tc.TABLE_NAME = c.TABLE_NAME
                AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
                AND kcu.COLUMN_NAME = c.COLUMN_NAME
            WHERE c.TABLE_SCHEMA = '{s_sch}' AND c.TABLE_NAME = '{s_tbl}'
            ORDER BY c.ORDINAL_POSITION
        """)
        cols_meta = [c[0] for c in cursor.description]
        columns = [{c: (str(v) if v is not None else None) for c, v in zip(cols_meta, row)}
                   for row in cursor.fetchall()]
        row_count = -1
        try:
            cursor.execute(f"""
                SELECT SUM(p.rows) AS row_count
                FROM sys.partitions p
                JOIN sys.tables t ON p.object_id = t.object_id
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = '{s_sch}' AND t.name = '{s_tbl}' AND p.index_id IN (0, 1)
            """)
            r = cursor.fetchone()
            if r and r[0] is not None:
                row_count = int(r[0])
        except Exception:
            pass
        conn.close()
        return {"server": server, "database": database, "schema": schema, "table": table,
                "rowCount": row_count, "columns": columns}
    except HttpError:
        raise
    except Exception as e:
        raise HttpError(str(e), 502)


@route("GET", "/api/sql-explorer/preview")
def get_sql_explorer_preview(params: dict) -> dict:
    import pyodbc
    server = params.get("server", "")
    database = params.get("database", "")
    schema = params.get("schema", "")
    table = params.get("table", "")
    try:
        limit = max(1, min(int(params.get("limit", 500)), 1000))
    except (TypeError, ValueError):
        limit = 500
    if not server or not database or not schema or not table:
        raise HttpError("server, database, schema, and table params required", 400)
    # SECURITY: validate server
    _validate_server(server)
    s_db = _sanitize(database)
    s_sch = _sanitize(schema)
    s_tbl = _sanitize(table)
    driver = _get_sql_driver()
    try:
        conn = pyodbc.connect(
            f"DRIVER={{{driver}}};SERVER={server};DATABASE={s_db};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;",
            timeout=30,
        )
        cursor = conn.cursor()
        cursor.execute(f"SELECT TOP {limit} * FROM [{s_sch}].[{s_tbl}]")
        col_names = [c[0] for c in cursor.description]
        rows = [{c: (str(v) if v is not None else None) for c, v in zip(col_names, row)}
                for row in cursor.fetchall()]
        row_count = len(rows)
        try:
            cursor.execute(f"""
                SELECT SUM(p.rows) FROM sys.partitions p
                JOIN sys.tables t ON p.object_id = t.object_id
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = '{s_sch}' AND t.name = '{s_tbl}' AND p.index_id IN (0, 1)
            """)
            r = cursor.fetchone()
            if r and r[0] is not None:
                row_count = int(r[0])
        except Exception:
            pass
        conn.close()
        return {"server": server, "database": database, "schema": schema, "table": table,
                "limit": limit, "rowCount": row_count, "columns": col_names, "rows": rows}
    except HttpError:
        raise
    except Exception as e:
        raise HttpError(str(e), 502)


@route("POST", "/api/sql-explorer/server-label")
def post_server_label(params: dict) -> dict:
    server = params.get("server", "")
    label = params.get("label", "").strip()
    if not server or not label:
        raise HttpError("server and label are required", 400)
    _save_server_label(server, label)
    return {"server": server, "label": label}


# ---------------------------------------------------------------------------
# Lakehouse explorer routes
# ---------------------------------------------------------------------------

@route("GET", "/api/sql-explorer/lakehouses")
def get_sql_explorer_lakehouses(params: dict) -> list:
    lakehouses = db.query("SELECT Name FROM lakehouses ORDER BY Name")
    return [
        {
            "name": lh["Name"],
            "display": lh["Name"].replace("LH_", "").replace("_", " ").title(),
            "status": "online",
            "error": None,
        }
        for lh in lakehouses
    ]


@route("GET", "/api/sql-explorer/lakehouse-schemas")
def get_sql_explorer_lakehouse_schemas(params: dict) -> list:
    lakehouse = params.get("lakehouse", "")
    if not lakehouse:
        raise HttpError("lakehouse param required", 400)
    try:
        return _query_lakehouse(
            lakehouse,
            "SELECT TABLE_SCHEMA AS schema_name, CAST(COUNT(*) AS VARCHAR) AS table_count "
            "FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' "
            "GROUP BY TABLE_SCHEMA ORDER BY TABLE_SCHEMA",
        )
    except HttpError:
        raise
    except Exception as e:
        log.warning("lakehouse-schemas(%s): %s", lakehouse, e)
        return []


@route("GET", "/api/sql-explorer/lakehouse-tables")
def get_sql_explorer_lakehouse_tables(params: dict) -> list:
    lakehouse = params.get("lakehouse", "")
    schema = params.get("schema", "")
    if not lakehouse or not schema:
        raise HttpError("lakehouse and schema params required", 400)
    s = _sanitize(schema)
    try:
        return _query_lakehouse(
            lakehouse,
            f"SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES "
            f"WHERE TABLE_SCHEMA = '{s}' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
        )
    except HttpError:
        raise
    except Exception as e:
        log.warning("lakehouse-tables(%s, %s): %s", lakehouse, schema, e)
        return []


@route("GET", "/api/sql-explorer/lakehouse-columns")
def get_sql_explorer_lakehouse_columns(params: dict) -> dict:
    lakehouse = params.get("lakehouse", "")
    schema = params.get("schema", "")
    table = params.get("table", "")
    if not lakehouse or not schema or not table:
        raise HttpError("lakehouse, schema, and table params required", 400)
    s = _sanitize(schema)
    t = _sanitize(table)
    try:
        col_rows = _query_lakehouse(
            lakehouse,
            f"SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, "
            f"CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR) AS CHARACTER_MAXIMUM_LENGTH, "
            f"CAST(NUMERIC_PRECISION AS VARCHAR) AS NUMERIC_PRECISION, "
            f"CAST(NUMERIC_SCALE AS VARCHAR) AS NUMERIC_SCALE, "
            f"CAST(ORDINAL_POSITION AS VARCHAR) AS ORDINAL_POSITION, "
            f"COLUMN_DEFAULT, '0' AS IS_PK "
            f"FROM INFORMATION_SCHEMA.COLUMNS "
            f"WHERE TABLE_SCHEMA = '{s}' AND TABLE_NAME = '{t}' ORDER BY ORDINAL_POSITION",
        )
        row_count = -1
        try:
            rc = _query_lakehouse(lakehouse, f"SELECT COUNT(*) AS cnt FROM [{s}].[{t}]")
            if rc:
                row_count = int(rc[0].get("cnt", -1))
        except Exception:
            pass
        return {"server": lakehouse, "database": lakehouse, "schema": schema, "table": table,
                "rowCount": row_count, "columns": col_rows}
    except HttpError:
        raise
    except Exception as e:
        raise HttpError(str(e), 502)


@route("GET", "/api/sql-explorer/lakehouse-preview")
def get_sql_explorer_lakehouse_preview(params: dict) -> dict:
    lakehouse = params.get("lakehouse", "")
    schema = params.get("schema", "")
    table = params.get("table", "")
    try:
        limit = max(1, min(int(params.get("limit", 500)), 1000))
    except (TypeError, ValueError):
        limit = 500
    if not lakehouse or not schema or not table:
        raise HttpError("lakehouse, schema, and table params required", 400)
    s = _sanitize(schema)
    t = _sanitize(table)
    try:
        rows = _query_lakehouse(lakehouse, f"SELECT TOP {limit} * FROM [{s}].[{t}]")
        col_names = list(rows[0].keys()) if rows else []
        row_count = len(rows)
        try:
            rc = _query_lakehouse(lakehouse, f"SELECT COUNT(*) AS cnt FROM [{s}].[{t}]")
            if rc:
                row_count = int(rc[0].get("cnt", len(rows)))
        except Exception:
            pass
        return {"server": lakehouse, "database": lakehouse, "schema": schema, "table": table,
                "limit": limit, "rowCount": row_count, "columns": col_names, "rows": rows}
    except HttpError:
        raise
    except Exception as e:
        raise HttpError(str(e), 502)


@route("GET", "/api/sql-explorer/lakehouse-files")
def get_sql_explorer_lakehouse_files(params: dict) -> list:
    lakehouse = params.get("lakehouse", "")
    if not lakehouse:
        raise HttpError("lakehouse param required", 400)
    # OneLake file listing via Fabric REST API
    try:
        lh_row = db.query(
            "SELECT LakehouseGuid, WorkspaceGuid FROM lakehouses WHERE Name = ? LIMIT 1",
            (lakehouse,),
        )
        if not lh_row:
            return []
        ws_id = lh_row[0]["WorkspaceGuid"]
        lh_id = lh_row[0]["LakehouseGuid"]
        token = _get_fabric_token("https://storage.azure.com/.default")
        url = (
            f"https://onelake.dfs.fabric.microsoft.com/{ws_id}/{lh_id}/Files"
            f"?resource=filesystem&recursive=false"
        )
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        resp = urllib.request.urlopen(req, timeout=20)
        data = json.loads(resp.read())
        return data.get("paths", [])
    except Exception as e:
        log.warning("lakehouse-files(%s): %s", lakehouse, e)
        return []


@route("GET", "/api/sql-explorer/lakehouse-file-tables")
def get_sql_explorer_lakehouse_file_tables(params: dict) -> list:
    lakehouse = params.get("lakehouse", "")
    namespace = params.get("namespace", "")
    if not lakehouse or not namespace:
        raise HttpError("lakehouse and namespace params required", 400)
    # List delta table folders under Files/<namespace>/
    try:
        lh_row = db.query(
            "SELECT LakehouseGuid, WorkspaceGuid FROM lakehouses WHERE Name = ? LIMIT 1",
            (lakehouse,),
        )
        if not lh_row:
            return []
        ws_id = lh_row[0]["WorkspaceGuid"]
        lh_id = lh_row[0]["LakehouseGuid"]
        token = _get_fabric_token("https://storage.azure.com/.default")
        url = (
            f"https://onelake.dfs.fabric.microsoft.com/{ws_id}/{lh_id}/Files/{namespace}"
            f"?resource=filesystem&recursive=false"
        )
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        resp = urllib.request.urlopen(req, timeout=20)
        data = json.loads(resp.read())
        return [p for p in data.get("paths", []) if p.get("isDirectory", False)]
    except Exception as e:
        log.warning("lakehouse-file-tables(%s, %s): %s", lakehouse, namespace, e)
        return []


@route("GET", "/api/sql-explorer/lakehouse-file-detail")
def get_sql_explorer_lakehouse_file_detail(params: dict) -> dict:
    lakehouse = params.get("lakehouse", "")
    namespace = params.get("namespace", "")
    table_folder = params.get("folder", "")
    if not lakehouse or not namespace or not table_folder:
        raise HttpError("lakehouse, namespace, and folder params required", 400)
    return {
        "lakehouse": lakehouse,
        "namespace": namespace,
        "folder": table_folder,
        "note": "Delta table detail not yet implemented in route layer",
    }
