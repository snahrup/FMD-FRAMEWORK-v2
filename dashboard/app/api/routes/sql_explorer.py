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
    GET  /api/sql-explorer/tables                  — tables in a schema (enriched with registration status)
    GET  /api/sql-explorer/columns                 — column metadata + row count
    GET  /api/sql-explorer/preview                 — sampled rows
    POST /api/sql-explorer/server-label            — save custom display label
    POST /api/sql-explorer/register-tables         — cascade-register tables into pipeline (LZ→Bronze→Silver)
    GET  /api/sql-explorer/lakehouses              — registered Fabric lakehouses
    GET  /api/sql-explorer/lakehouse-schemas       — schemas in a lakehouse
    GET  /api/sql-explorer/lakehouse-tables        — tables in a lakehouse schema
    GET  /api/sql-explorer/lakehouse-columns       — column metadata for a lakehouse table
    GET  /api/sql-explorer/lakehouse-preview       — sampled rows from a lakehouse table
    GET  /api/sql-explorer/lakehouse-files         — OneLake file listing
    GET  /api/sql-explorer/lakehouse-file-tables   — file-backed delta tables
    GET  /api/sql-explorer/lakehouse-file-detail   — detail for a specific table folder
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import logging
import urllib.request
import urllib.parse
from pathlib import Path

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db
from dashboard.app.api import control_plane_db as cpdb

log = logging.getLogger("fmd.routes.sql_explorer")

# ---------------------------------------------------------------------------
# Config helpers (lazy)
# ---------------------------------------------------------------------------

_CONFIG: dict | None = None


def _get_config() -> dict:
    global _CONFIG
    if _CONFIG is None:
        try:
            import os, re
            cfg_path = Path(__file__).parent.parent / "config.json"
            raw = cfg_path.read_text()
            # Resolve ${VAR} placeholders — .env is already loaded by server.py at startup
            raw = re.sub(
                r"[$][{](\w+)[}]",
                lambda m: json.dumps(os.environ.get(m.group(1), ""))[1:-1],
                raw,
            )
            _CONFIG = json.loads(raw)
        except Exception as e:
            log.warning("Failed to load config.json: %s", e)
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

def _validate_server(server: str, *, allow_when_empty: bool = False) -> None:
    """Reject servers not registered in the FMD connections table.

    Security fix: prevents ODBC injection by ensuring only servers that
    are explicitly registered in the metadata DB can be connected to.
    Unregistered hostnames return HTTP 403.
    """
    # SECURITY: reject empty-after-strip and malformed server names
    stripped = server.strip() if server else ""
    if not stripped:
        raise HttpError("Server name must not be empty", 400)
    import re as _re
    if not _re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9\-.,]*", stripped):
        raise HttpError(
            f"Server name '{server}' contains invalid characters. "
            "Only alphanumeric chars, hyphens, dots, and commas are allowed.",
            400,
        )
    allowed = db.query(
        "SELECT ServerName FROM connections WHERE ServerName IS NOT NULL AND ServerName != '' AND IsActive = 1"
    )
    allowed_servers = {r["ServerName"].strip().lower() for r in allowed if r.get("ServerName")}
    if not allowed_servers and allow_when_empty:
        return
    if stripped.lower() not in allowed_servers:
        raise HttpError(
            f"Server '{server}' is not in registered connections. "
            "Register it in the Source Manager before exploring.",
            403,
        )


def _sanitize(val: str) -> str:
    """Strip characters dangerous in SQL identifiers.

    Alphanumerics, underscores, hyphens, and spaces are allowed (all safe
    inside ``[...]`` bracket-quoting).  Right-brackets and semicolons are
    explicitly stripped to prevent bracket-escape and statement-stacking
    injection.  Raises HttpError if the sanitized result is empty.
    """
    cleaned = "".join(c for c in val if c.isalnum() or c in "-_ ")
    if not cleaned:
        raise HttpError(f"Invalid SQL identifier after sanitization: '{val}'", 400)
    # Escape right-brackets for safe bracket-quoting (defense-in-depth;
    # the filter above already strips them)
    return cleaned.replace("]", "]]")


# ---------------------------------------------------------------------------
# Source server labels (stored in SQLite admin_config)
# ---------------------------------------------------------------------------

def _load_server_labels() -> dict:
    try:
        rows = db.query("SELECT key, value FROM admin_config WHERE key LIKE 'server_label_%'")
        return {r["key"].replace("server_label_", "", 1): r["value"] for r in rows}
    except Exception as e:
        log.warning("Failed to load server labels: %s", e)
        return {}


def _save_server_label(server: str, label: str) -> None:
    db.execute(
        "INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)",
        (f"server_label_{server}", label),
    )


# ---------------------------------------------------------------------------
# Lakehouse query helper
# ---------------------------------------------------------------------------

def _query_lakehouse(lakehouse_name: str, sql: str, params: tuple = ()) -> list[dict]:
    """Execute a query against a Fabric lakehouse SQL Analytics Endpoint."""
    import pyodbc
    import struct
    # Prefer the active DEV workspace; fall back to any match
    ws_id = _get_config().get("fabric", {}).get("workspace_data_id", "")
    if ws_id:
        lh = db.query(
            "SELECT LakehouseGuid, WorkspaceGuid FROM lakehouses "
            "WHERE Name = ? AND LOWER(WorkspaceGuid) = LOWER(?) LIMIT 1",
            (lakehouse_name, ws_id),
        )
    else:
        lh = []
    if not lh:
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
        cursor.execute(sql, params) if params else cursor.execute(sql)
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
        "INNER JOIN datasources ds ON ds.ConnectionId = c.ConnectionId "
        "WHERE c.ServerName IS NOT NULL AND c.ServerName != '' "
        "ORDER BY ds.Name, c.Name"
    )
    labels = _load_server_labels()
    _FRIENDLY_DEFAULTS = {
        "mes": "MES", "etqstagingprd": "ETQ", "m3fdbprd": "M3",
        "di_prd_staging": "M3C", "optivalive": "Optiva",
    }
    driver = _get_sql_driver()
    unique_rows: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        srv = row.get("ServerName", "")
        if not srv or srv in seen:
            continue
        seen.add(srv)
        unique_rows.append(row)

    def _probe(row: dict) -> dict:
        srv = row.get("ServerName", "")
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

        db_name = row.get("DatabaseName") or ""
        ds_name = row.get("DataSourceName") or ""
        if srv in labels:
            display = labels[srv]
        elif db_name and db_name.lower() in _FRIENDLY_DEFAULTS:
            display = _FRIENDLY_DEFAULTS[db_name.lower()]
        else:
            display = ds_name or srv

        return {
            "server": srv,
            "display": display,
            "datasource": ds_name,
            "database": db_name,
            "namespace": row.get("Namespace") or "",
            "description": row.get("Description") or "",
            "status": status,
            "error": error,
        }

    servers: list[dict] = []
    max_workers = min(max(len(unique_rows), 1), 8)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_probe, row): row.get("ServerName", "") for row in unique_rows}
        for future in as_completed(futures):
            try:
                servers.append(future.result())
            except Exception as exc:
                srv = futures[future]
                servers.append(
                    {
                        "server": srv,
                        "display": srv,
                        "datasource": "",
                        "database": "",
                        "namespace": "",
                        "description": "",
                        "status": "offline",
                        "error": str(exc)[:200],
                    }
                )

    servers.sort(key=lambda row: (row["display"].lower(), row["server"].lower()))
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
            db_name_q = _sanitize(row[0])
            cursor.execute(
                # Catalog identifier sanitized above — cannot be parameterized in T-SQL
                "SELECT COUNT(*) FROM [" + db_name_q + "].INFORMATION_SCHEMA.TABLES "
                "WHERE TABLE_TYPE = 'BASE TABLE'"
            )
            entry["table_count"] = str(cursor.fetchone()[0])
        except Exception as e:
            log.debug("Failed to get table count for database %s: %s", row[0], e)
        results.append(entry)
    try:
        conn.close()
    except Exception as e:
        log.debug("Error closing connection: %s", e)
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
            "SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES "
            "WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
            (s_sch,),
        )
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        conn.close()
        result = [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)} for row in rows]

        # Enrich with registration status from control plane
        # NOTE: LOWER() on both sides — sys.databases may return different case
        # than what's stored in connections.DatabaseName (e.g. 'MES' vs 'mes')
        try:
            registered = db.query(
                "SELECT le.LandingzoneEntityId, le.SourceName "
                "FROM lz_entities le "
                "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
                "JOIN connections c ON ds.ConnectionId = c.ConnectionId "
                "WHERE LOWER(c.ServerName) = LOWER(?) AND LOWER(c.DatabaseName) = LOWER(?) "
                "  AND LOWER(le.SourceSchema) = LOWER(?) AND le.IsActive = 1",
                (server, database, schema),
            )
            reg_map = {r["SourceName"].strip(): r["LandingzoneEntityId"] for r in registered}
            for tbl in result:
                name = tbl.get("TABLE_NAME", "")
                tbl["is_registered"] = name in reg_map
                tbl["entity_id"] = reg_map.get(name)
        except Exception:
            pass  # Don't break table listing if enrichment fails

        return result
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
        cursor.execute("""
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
            WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
            ORDER BY c.ORDINAL_POSITION
        """, (s_sch, s_tbl))
        cols_meta = [c[0] for c in cursor.description]
        columns = [{c: (str(v) if v is not None else None) for c, v in zip(cols_meta, row)}
                   for row in cursor.fetchall()]
        row_count = -1
        try:
            cursor.execute("""
                SELECT SUM(p.rows) AS row_count
                FROM sys.partitions p
                JOIN sys.tables t ON p.object_id = t.object_id
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = ? AND t.name = ? AND p.index_id IN (0, 1)
            """, (s_sch, s_tbl))
            r = cursor.fetchone()
            if r and r[0] is not None:
                row_count = int(r[0])
        except Exception as e:
            log.debug("Failed to get row count for %s.%s: %s", s_sch, s_tbl, e)
        conn.close()
        return {"server": server, "database": database, "schema": schema, "table": table,
                "rowCount": row_count, "columns": columns}
    except HttpError:
        raise  # propagate HTTP errors as-is
    except Exception as e:
        log.exception("columns(%s, %s, %s, %s) failed", server, database, schema, table)
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
        # NOTE: schema/table identifiers cannot be parameterized — bracket-quoting
        # sanitized values is the standard SQL Server approach.
        cursor.execute(
            "SELECT TOP (?) * FROM [" + s_sch + "].[" + s_tbl + "]", (limit,)
        )
        col_names = [c[0] for c in cursor.description]
        rows = [{c: (str(v) if v is not None else None) for c, v in zip(col_names, row)}
                for row in cursor.fetchall()]
        row_count = len(rows)
        try:
            cursor.execute("""
                SELECT SUM(p.rows) FROM sys.partitions p
                JOIN sys.tables t ON p.object_id = t.object_id
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = ? AND t.name = ? AND p.index_id IN (0, 1)
            """, (s_sch, s_tbl))
            r = cursor.fetchone()
            if r and r[0] is not None:
                row_count = int(r[0])
        except Exception as e:
            log.debug("Failed to get row count for %s.%s: %s", s_sch, s_tbl, e)
        conn.close()
        return {"server": server, "database": database, "schema": schema, "table": table,
                "limit": limit, "rowCount": row_count, "columns": col_names, "rows": rows}
    except HttpError:
        raise  # propagate HTTP errors as-is
    except Exception as e:
        log.exception("preview(%s, %s, %s, %s) failed", server, database, schema, table)
        raise HttpError(str(e), 502)


@route("POST", "/api/sql-explorer/server-label")
def post_server_label(params: dict) -> dict:
    server = params.get("server", "")
    label = params.get("label", "").strip()
    if not server or not label:
        raise HttpError("server and label are required", 400)
    # SECURITY: validate server is registered before allowing label save
    _validate_server(server, allow_when_empty=True)
    _save_server_label(server, label)
    return {"server": server, "label": label}


# ---------------------------------------------------------------------------
# Table registration — cascade LZ → Bronze → Silver
# ---------------------------------------------------------------------------

@route("POST", "/api/sql-explorer/register-tables")
def post_register_tables(params: dict) -> dict:
    """Register one or more source tables into the FMD pipeline.

    Expects JSON body:
        {
            "tables": [
                {"server": "m3-db1", "database": "mes", "schema": "dbo", "table": "MyTable"},
                ...
            ]
        }

    For each table, creates a cascade: LZ entity → Bronze entity → Silver entity.
    Returns the list of newly created entity IDs.
    """
    tables = params.get("tables")
    if not tables or not isinstance(tables, list):
        raise HttpError("tables array is required", 400)

    if len(tables) > 200:
        raise HttpError("Maximum 200 tables per registration request", 400)

    # ── 1. Resolve lakehouse IDs ──
    lakehouses = cpdb.get_lakehouses()
    lz_lh = [lh for lh in lakehouses if lh.get("Name") == "LH_DATA_LANDINGZONE"]
    bronze_lh = [lh for lh in lakehouses if lh.get("Name") == "LH_BRONZE_LAYER"]
    silver_lh = [lh for lh in lakehouses if lh.get("Name") == "LH_SILVER_LAYER"]
    lz_lh_id = int(lz_lh[0]["LakehouseId"]) if lz_lh else None
    bronze_lh_id = int(bronze_lh[0]["LakehouseId"]) if bronze_lh else None
    silver_lh_id = int(silver_lh[0]["LakehouseId"]) if silver_lh else None

    if lz_lh_id is None:
        raise HttpError("Landing Zone lakehouse not found in control plane", 503)

    # ── 2. Get next available entity IDs ──
    existing_lz = cpdb.get_lz_entities()
    existing_bronze = cpdb.get_bronze_entities()
    existing_silver = cpdb.get_silver_entities()
    next_lz_id = max((int(e["LandingzoneEntityId"]) for e in existing_lz), default=0) + 1
    next_bronze_id = max((int(e["BronzeLayerEntityId"]) for e in existing_bronze), default=0) + 1
    next_silver_id = max((int(e["SilverLayerEntityId"]) for e in existing_silver), default=0) + 1

    # ── 3. Build lookup of already-registered entities ──
    registered_set: dict[int, set[tuple[str, str]]] = {}
    for e in existing_lz:
        ds_id = e.get("DataSourceId")
        if ds_id is None:
            continue
        schema = (e.get("SourceSchema") or "dbo").strip().lower()
        table = (e.get("SourceName") or "").strip().lower()
        registered_set.setdefault(ds_id, set()).add((schema, table))

    # ── 4. Register each table ──
    registered: list[dict] = []
    skipped: list[dict] = []
    errors: list[str] = []

    for tbl in tables:
        server = (tbl.get("server") or "").strip()
        database = (tbl.get("database") or "").strip()
        schema = (tbl.get("schema") or "dbo").strip()
        table = (tbl.get("table") or "").strip()

        if not server or not database or not table:
            errors.append(f"Missing server/database/table in: {tbl}")
            continue

        # Resolve DataSourceId from connections + datasources (case-insensitive)
        ds_rows = db.query(
            "SELECT ds.DataSourceId FROM datasources ds "
            "JOIN connections c ON ds.ConnectionId = c.ConnectionId "
            "WHERE LOWER(c.ServerName) = LOWER(?) AND LOWER(c.DatabaseName) = LOWER(?)",
            (server, database),
        )
        if not ds_rows:
            errors.append(f"No datasource found for {server}/{database}")
            continue

        ds_id = ds_rows[0]["DataSourceId"]

        # Skip if already registered
        known = registered_set.get(ds_id, set())
        if (schema.lower(), table.lower()) in known:
            skipped.append({"server": server, "database": database,
                            "schema": schema, "table": table, "reason": "already_registered"})
            continue

        try:
            lz_id = next_lz_id
            next_lz_id += 1

            cpdb.upsert_lz_entity({
                "LandingzoneEntityId": lz_id,
                "DataSourceId": ds_id,
                "LakehouseId": lz_lh_id,
                "SourceSchema": schema,
                "SourceName": table,
                "SourceCustomSelect": "",
                "FileName": table,
                "FilePath": f"/{schema}/{table}.parquet",
                "FileType": "parquet",
                "IsIncremental": 0,
                "IsIncrementalColumn": "",
                "CustomNotebookName": "",
                "IsActive": 1,
            })

            br_id = None
            sv_id = None

            if bronze_lh_id is not None:
                br_id = next_bronze_id
                next_bronze_id += 1
                cpdb.upsert_bronze_entity({
                    "BronzeLayerEntityId": br_id,
                    "LandingzoneEntityId": lz_id,
                    "LakehouseId": bronze_lh_id,
                    "Schema_": schema,
                    "Name": table,
                    "PrimaryKeys": "N/A",
                    "FileType": "Delta",
                    "IsActive": 1,
                })

                if silver_lh_id is not None:
                    sv_id = next_silver_id
                    next_silver_id += 1
                    cpdb.upsert_silver_entity({
                        "SilverLayerEntityId": sv_id,
                        "BronzeLayerEntityId": br_id,
                        "LakehouseId": silver_lh_id,
                        "Schema_": schema,
                        "Name": table,
                        "FileType": "delta",
                        "IsActive": 1,
                    })

            registered.append({
                "server": server, "database": database, "schema": schema, "table": table,
                "entity_id": lz_id, "bronze_id": br_id, "silver_id": sv_id,
            })
            # Update in-memory set to prevent duplicates within same request
            known.add((schema.lower(), table.lower()))
            registered_set[ds_id] = known

        except Exception as e:
            errors.append(f"{server}/{database}/{schema}.{table}: {str(e)[:150]}")

    return {
        "registered": registered,
        "skipped": skipped,
        "errors": errors,
        "total_registered": len(registered),
        "total_skipped": len(skipped),
        "total_errors": len(errors),
    }


# ---------------------------------------------------------------------------
# Lakehouse explorer routes
# ---------------------------------------------------------------------------

@route("GET", "/api/sql-explorer/lakehouses")
def get_sql_explorer_lakehouses(params: dict) -> list:
    # Filter to the active DEV workspace only — avoids showing duplicate PROD lakehouses
    ws_id = _get_config().get("fabric", {}).get("workspace_data_id", "")
    if ws_id:
        lakehouses = db.query(
            "SELECT DISTINCT Name FROM lakehouses WHERE LOWER(WorkspaceGuid) = LOWER(?)",
            (ws_id,),
        )
    else:
        lakehouses = db.query("SELECT DISTINCT Name FROM lakehouses")

    # Forced order: Landing → Bronze → Silver.  Clean display names.
    _ORDER = {"LH_DATA_LANDINGZONE": 0, "LH_BRONZE_LAYER": 1, "LH_SILVER_LAYER": 2}
    _DISPLAY = {"LH_DATA_LANDINGZONE": "Landing", "LH_BRONZE_LAYER": "Bronze", "LH_SILVER_LAYER": "Silver"}
    sorted_lh = sorted(lakehouses, key=lambda r: _ORDER.get(r["Name"], 99))
    return [
        {
            "name": lh["Name"],
            "display": _DISPLAY.get(lh["Name"], lh["Name"]),
            "layer": "landing" if "LANDINGZONE" in lh["Name"].upper() else (
                "bronze" if "BRONZE" in lh["Name"].upper() else (
                "silver" if "SILVER" in lh["Name"].upper() else "unknown"
            )),
            "status": "online",
            "error": None,
        }
        for lh in sorted_lh
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
        raise  # propagate HTTP errors as-is
    except Exception:
        log.exception("lakehouse-schemas(%s) failed", lakehouse)
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
            "SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES "
            "WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
            (s,),
        )
    except HttpError:
        raise  # propagate HTTP errors as-is
    except Exception:
        log.exception("lakehouse-tables(%s, %s) failed", lakehouse, schema)
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
        import polars as pl
        from dashboard.app.api.routes.data_access import _polars_dtype_to_sql, _scan_onelake_table

        lf = _scan_onelake_table(lakehouse, s, t)
        col_rows = []
        for ordinal, (col_name, dtype) in enumerate(lf.schema.items(), start=1):
            col_rows.append({
                "COLUMN_NAME": col_name,
                "DATA_TYPE": _polars_dtype_to_sql(dtype),
                "IS_NULLABLE": "YES",
                "CHARACTER_MAXIMUM_LENGTH": None,
                "NUMERIC_PRECISION": None,
                "NUMERIC_SCALE": None,
                "ORDINAL_POSITION": str(ordinal),
                "COLUMN_DEFAULT": None,
                "IS_PK": "0",
            })

        try:
            row_count = int(lf.select(pl.len()).collect().item())
        except Exception as e:
            log.debug("Failed to get local lakehouse row count for %s.%s.%s: %s", lakehouse, s, t, e)
            row_count = -1
        return {"server": lakehouse, "database": lakehouse, "schema": schema, "table": table,
                "rowCount": row_count, "columns": col_rows}
    except HttpError:
        raise  # propagate HTTP errors as-is
    except Exception as e:
        log.exception("lakehouse-columns(%s, %s, %s) failed", lakehouse, schema, table)
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
        import polars as pl
        from dashboard.app.api.routes.data_access import _scan_onelake_table

        lf = _scan_onelake_table(lakehouse, s, t)
        frame = lf.head(limit).collect()
        rows = frame.to_dicts()
        col_names = frame.columns
        try:
            row_count = int(lf.select(pl.len()).collect().item())
        except Exception as e:
            log.debug("Failed to get local lakehouse row count for %s.%s.%s: %s", lakehouse, s, t, e)
            row_count = len(rows)
        return {"server": lakehouse, "database": lakehouse, "schema": schema, "table": table,
                "limit": limit, "rowCount": row_count, "columns": col_names, "rows": rows}
    except HttpError:
        raise  # propagate HTTP errors as-is
    except Exception as e:
        log.exception("lakehouse-preview(%s, %s, %s) failed", lakehouse, schema, table)
        raise HttpError(str(e), 502)


@route("GET", "/api/sql-explorer/lakehouse-files")
def get_sql_explorer_lakehouse_files(params: dict) -> list:
    lakehouse = params.get("lakehouse", "")
    if not lakehouse:
        raise HttpError("lakehouse param required", 400)
    # OneLake file listing via Fabric REST API — use active workspace
    try:
        cfg_ws = _get_config().get("fabric", {}).get("workspace_data_id", "")
        if cfg_ws:
            lh_row = db.query(
                "SELECT LakehouseGuid, WorkspaceGuid FROM lakehouses "
                "WHERE Name = ? AND LOWER(WorkspaceGuid) = LOWER(?) LIMIT 1",
                (lakehouse, cfg_ws),
            )
        else:
            lh_row = []
        if not lh_row:
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
    # SECURITY: prevent path traversal in namespace parameter
    if ".." in namespace or "/" in namespace or "\\" in namespace:
        raise HttpError("Invalid namespace value", 400)
    # List delta table folders under Files/<namespace>/ — use active workspace
    try:
        cfg_ws = _get_config().get("fabric", {}).get("workspace_data_id", "")
        if cfg_ws:
            lh_row = db.query(
                "SELECT LakehouseGuid, WorkspaceGuid FROM lakehouses "
                "WHERE Name = ? AND LOWER(WorkspaceGuid) = LOWER(?) LIMIT 1",
                (lakehouse, cfg_ws),
            )
        else:
            lh_row = []
        if not lh_row:
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
    # SECURITY: prevent path traversal
    for val in (namespace, table_folder):
        if ".." in val or "/" in val or "\\" in val:
            raise HttpError("Invalid path parameter", 400)
    return {
        "lakehouse": lakehouse,
        "namespace": namespace,
        "folder": table_folder,
        "note": "Delta table detail not yet implemented in route layer",
    }
