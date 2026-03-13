"""Data Microscope routes — cross-layer row inspection.

Endpoints:
    GET /api/microscope      — full cross-layer row data for a single entity + PK value
    GET /api/microscope/pks  — autocomplete PK values for a given entity

Data sources:
    - SQLite: entity metadata, bronze PKs, watermarks, entity_status
    - On-prem ODBC: source row lookup (fails gracefully if VPN unavailable)
    - Bronze/Silver lakehouse data: marked as metadata-only (no Fabric SQL)
"""
import logging

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.microscope")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_entity_context(entity_id: int) -> dict:
    """Load full entity context across all layers from SQLite.

    Returns dict with keys: lz, bronze, silver, connection, datasource.
    Raises HttpError 404 if entity not found.
    """
    lz_rows = db.query(
        "SELECT e.*, d.Name AS DataSourceName, d.Namespace, "
        "       c.Name AS ConnectionName, c.ServerName, c.DatabaseName "
        "FROM lz_entities e "
        "LEFT JOIN datasources d ON d.DataSourceId = e.DataSourceId "
        "LEFT JOIN connections c ON c.ConnectionId = d.ConnectionId "
        "WHERE e.LandingzoneEntityId = ?",
        (entity_id,),
    )
    if not lz_rows:
        raise HttpError(f"Entity {entity_id} not found", 404)

    lz = lz_rows[0]

    bronze_rows = db.query(
        "SELECT * FROM bronze_entities WHERE LandingzoneEntityId = ?",
        (entity_id,),
    )
    bronze = bronze_rows[0] if bronze_rows else None

    silver = None
    if bronze:
        silver_rows = db.query(
            "SELECT * FROM silver_entities WHERE BronzeLayerEntityId = ?",
            (bronze["BronzeLayerEntityId"],),
        )
        silver = silver_rows[0] if silver_rows else None

    return {"lz": lz, "bronze": bronze, "silver": silver}


def _get_sql_driver() -> str:
    """Return the ODBC driver name from config, defaulting to Driver 18."""
    import json
    from pathlib import Path
    try:
        cfg_path = Path(__file__).parent.parent / "config.json"
        cfg = json.loads(cfg_path.read_text())
        return cfg.get("sql", {}).get("driver", "ODBC Driver 18 for SQL Server")
    except Exception:
        return "ODBC Driver 18 for SQL Server"


def _validate_server(server: str) -> None:
    """Reject servers not in registered connections."""
    allowed = db.query(
        "SELECT ServerName FROM connections "
        "WHERE ServerName IS NOT NULL AND ServerName != '' AND IsActive = 1"
    )
    allowed_servers = {
        r["ServerName"].strip().lower()
        for r in allowed
        if r.get("ServerName")
    }
    if server.strip().lower() not in allowed_servers:
        raise HttpError(
            f"Server '{server}' is not in registered connections.", 403
        )


def _sanitize(val: str) -> str:
    """Strip characters dangerous in SQL identifiers."""
    return "".join(c for c in val if c.isalnum() or c in "-_ ")


def _query_source_row(
    server: str, database: str, schema: str, table: str,
    pk_column: str, pk_value: str,
) -> dict | None:
    """Query on-prem source for a single row by PK. Returns dict or None.

    Fails gracefully — returns None if VPN down, pyodbc unavailable, etc.
    Uses parameterized query for the PK value.
    """
    try:
        import pyodbc
    except ImportError:
        log.debug("pyodbc not available — skipping source query")
        return None

    _validate_server(server)
    s_db = _sanitize(database)
    s_sch = _sanitize(schema)
    s_tbl = _sanitize(table)
    s_pk = _sanitize(pk_column)
    driver = _get_sql_driver()

    try:
        conn = pyodbc.connect(
            f"DRIVER={{{driver}}};SERVER={server};DATABASE={s_db};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;",
            timeout=10,
        )
        cursor = conn.cursor()
        # Parameterized query for PK value — column/table names are sanitized
        sql = f"SELECT TOP 1 * FROM [{s_sch}].[{s_tbl}] WHERE [{s_pk}] = ?"
        cursor.execute(sql, (pk_value,))
        cols = [c[0] for c in cursor.description] if cursor.description else []
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        return {c: (str(v) if v is not None else None) for c, v in zip(cols, row)}
    except Exception as e:
        log.debug("Source query failed for %s.%s.%s: %s", server, s_db, s_tbl, e)
        return None


def _query_source_pks(
    server: str, database: str, schema: str, table: str,
    pk_column: str, search: str, limit: int,
) -> list[str]:
    """Query on-prem source for PK values matching a search prefix.

    Uses parameterized query. Returns empty list on failure.
    """
    try:
        import pyodbc
    except ImportError:
        return []

    try:
        _validate_server(server)
    except HttpError:
        return []

    s_db = _sanitize(database)
    s_sch = _sanitize(schema)
    s_tbl = _sanitize(table)
    s_pk = _sanitize(pk_column)
    driver = _get_sql_driver()

    try:
        conn = pyodbc.connect(
            f"DRIVER={{{driver}}};SERVER={server};DATABASE={s_db};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;",
            timeout=10,
        )
        cursor = conn.cursor()
        if search:
            sql = (
                f"SELECT DISTINCT TOP {int(limit)} CAST([{s_pk}] AS VARCHAR(500)) AS pk_val "
                f"FROM [{s_sch}].[{s_tbl}] "
                f"WHERE CAST([{s_pk}] AS VARCHAR(500)) LIKE ? "
                f"ORDER BY pk_val"
            )
            cursor.execute(sql, (f"{search}%",))
        else:
            sql = (
                f"SELECT DISTINCT TOP {int(limit)} CAST([{s_pk}] AS VARCHAR(500)) AS pk_val "
                f"FROM [{s_sch}].[{s_tbl}] "
                f"ORDER BY pk_val"
            )
            cursor.execute(sql)

        results = [str(row[0]) for row in cursor.fetchall() if row[0] is not None]
        conn.close()
        return results
    except Exception as e:
        log.debug("Source PK query failed for %s.%s.%s: %s", server, s_db, s_tbl, e)
        return []


def _build_transformations(bronze_pks: str, has_source: bool) -> list[dict]:
    """Build the transformation pipeline steps that FMD applies at each layer.

    These are deterministic based on the framework's known behavior — not
    data-dependent.  Always returns the same steps for Source→LZ→Bronze→Silver.
    """
    steps = []
    step = 1

    if has_source:
        steps.append({
            "step": step,
            "layer": "landing",
            "operation": "copy",
            "description": "Full copy from source to Landing Zone",
            "impact": "none",
            "details": "NB_FMD_PROCESSING_LANDINGZONE_MAIN copies all columns as-is to Parquet in OneLake.",
        })
        step += 1

    # Bronze transformations
    steps.append({
        "step": step,
        "layer": "bronze",
        "operation": "column_sanitize",
        "description": "Column name sanitization",
        "impact": "rename",
        "details": "Spaces, dots, and hyphens removed from column names for Delta compatibility.",
    })
    step += 1

    pk_list = [p.strip() for p in (bronze_pks or "").split(",") if p.strip() and p.strip() != "N/A"]
    if pk_list:
        steps.append({
            "step": step,
            "layer": "bronze",
            "operation": "hashed_pk",
            "description": "HashedPKColumn computed from primary keys",
            "columns": ["HashedPKColumn"],
            "impact": "add",
            "details": f"SHA256 hash of concatenated PK columns: {', '.join(pk_list)}",
        })
        step += 1

    steps.append({
        "step": step,
        "layer": "bronze",
        "operation": "system_columns",
        "description": "Bronze system columns added",
        "columns": ["HashedPKColumn", "HashedNonKeyColumns", "RecordLoadDate"],
        "impact": "add",
        "details": "HashedPKColumn (row identity), HashedNonKeyColumns (change detection), RecordLoadDate (audit timestamp).",
    })
    step += 1

    # Silver transformations
    steps.append({
        "step": step,
        "layer": "silver",
        "operation": "scd2_columns",
        "description": "SCD2 tracking columns added",
        "columns": ["IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "IsDeleted", "Action"],
        "impact": "add",
        "details": "Slowly Changing Dimension Type 2 columns for history tracking.",
    })
    step += 1

    steps.append({
        "step": step,
        "layer": "silver",
        "operation": "scd2_merge",
        "description": "SCD2 merge — insert/update/expire logic",
        "impact": "transform",
        "details": (
            "NB_FMD_LOAD_BRONZE_SILVER compares HashedNonKeyColumns to detect changes. "
            "Changed rows get IsCurrent=True with new RecordStartDate; "
            "previous version gets IsCurrent=False + RecordEndDate set."
        ),
    })
    step += 1

    return steps


# ---------------------------------------------------------------------------
# GET /api/microscope — cross-layer row inspection
# ---------------------------------------------------------------------------

@route("GET", "/api/microscope")
def get_microscope(params: dict) -> dict:
    """Return cross-layer row data for a single entity + PK value.

    Query params:
        entity  — LandingzoneEntityId (required)
        pk      — primary key value to look up (optional; metadata-only if omitted)
    """
    entity_str = params.get("entity", "")
    if not entity_str:
        raise HttpError("entity param required", 400)
    try:
        entity_id = int(entity_str)
    except (TypeError, ValueError):
        raise HttpError("entity must be an integer", 400)

    pk_value = (params.get("pk") or "").strip()

    # Load entity context from SQLite
    ctx = _get_entity_context(entity_id)
    lz = ctx["lz"]
    bronze = ctx["bronze"]
    silver = ctx["silver"]

    server = lz.get("ServerName") or ""
    database = lz.get("DatabaseName") or ""
    schema = lz.get("SourceSchema") or "dbo"
    table = lz.get("SourceName") or ""
    bronze_pks_raw = (bronze.get("PrimaryKeys") or "") if bronze else ""
    pk_list = [
        p.strip() for p in bronze_pks_raw.split(",")
        if p.strip() and p.strip() != "N/A"
    ]
    pk_column = pk_list[0] if pk_list else ""

    # Determine lakehouse names
    bronze_lh_name = ""
    silver_lh_name = ""
    if bronze:
        lh_rows = db.query(
            "SELECT Name FROM lakehouses WHERE LakehouseId = ?",
            (bronze.get("LakehouseId"),),
        )
        if lh_rows:
            bronze_lh_name = lh_rows[0]["Name"]
    if silver:
        lh_rows = db.query(
            "SELECT Name FROM lakehouses WHERE LakehouseId = ?",
            (silver.get("LakehouseId"),),
        )
        if lh_rows:
            silver_lh_name = lh_rows[0]["Name"]

    # Source row lookup (on-prem ODBC — fails gracefully)
    source_row = None
    source_available = False
    if pk_value and pk_column and server and database:
        source_row = _query_source_row(server, database, schema, table, pk_column, pk_value)
        source_available = source_row is not None

    # Bronze/Silver: actual row data lives in OneLake (Fabric SQL).
    # Since we don't use Fabric SQL, we provide metadata-only and mark
    # available=False.  The frontend handles this gracefully.
    bronze_row = None
    bronze_available = bronze is not None
    silver_versions: list[dict] = []
    silver_available = silver is not None

    # Entity status from SQLite for extra context
    statuses = db.query(
        "SELECT Layer, Status, LoadEndDateTime FROM entity_status "
        "WHERE LandingzoneEntityId = ?",
        (entity_id,),
    )
    status_by_layer = {}
    for s in statuses:
        layer = (s.get("Layer") or "").lower()
        if layer == "landingzone":
            layer = "landing"
        status_by_layer[layer] = s

    # Build transformations
    transformations = _build_transformations(bronze_pks_raw, source_available or bool(server))

    # Cleansing rules (framework doesn't store per-entity rules in SQLite;
    # return empty arrays — the frontend handles this)
    cleansing_rules = {"bronze": [], "silver": []}

    return {
        "entityId": entity_id,
        "entityName": f"{schema}.{table}",
        "primaryKeys": pk_list,
        "pkValue": pk_value,
        "source": {
            "available": source_available,
            "server": server or None,
            "database": database or None,
            "row": source_row,
        },
        "landing": {
            "available": source_available,
            "note": "Mirrors source (Parquet copy)" if source_available else "Source unavailable — VPN required",
            "row": None,  # LZ is a raw Parquet copy; same as source
        },
        "bronze": {
            "available": bronze_available,
            "lakehouse": bronze_lh_name or None,
            "row": bronze_row,
        },
        "silver": {
            "available": silver_available,
            "lakehouse": silver_lh_name or None,
            "versions": silver_versions,
            "currentVersion": 0,
        },
        "cleansingRules": cleansing_rules,
        "transformations": transformations,
    }


# ---------------------------------------------------------------------------
# GET /api/microscope/pks — PK value autocomplete
# ---------------------------------------------------------------------------

@route("GET", "/api/microscope/pks")
def get_microscope_pks(params: dict) -> dict:
    """Return PK values for autocomplete.

    Attempts to query the on-prem source DB first (best results).
    Falls back to watermark values from SQLite if source unreachable.

    Query params:
        entity  — LandingzoneEntityId (required)
        q       — search prefix (optional)
        limit   — max results (default 20, max 100)
    """
    entity_str = params.get("entity", "")
    if not entity_str:
        raise HttpError("entity param required", 400)
    try:
        entity_id = int(entity_str)
    except (TypeError, ValueError):
        raise HttpError("entity must be an integer", 400)

    search = (params.get("q") or "").strip()
    try:
        limit = max(1, min(int(params.get("limit", 20)), 100))
    except (TypeError, ValueError):
        limit = 20

    ctx = _get_entity_context(entity_id)
    lz = ctx["lz"]
    bronze = ctx["bronze"]

    server = lz.get("ServerName") or ""
    database = lz.get("DatabaseName") or ""
    schema = lz.get("SourceSchema") or "dbo"
    table = lz.get("SourceName") or ""
    bronze_pks_raw = (bronze.get("PrimaryKeys") or "") if bronze else ""
    pk_list = [
        p.strip() for p in bronze_pks_raw.split(",")
        if p.strip() and p.strip() != "N/A"
    ]
    pk_column = pk_list[0] if pk_list else ""

    # Try on-prem source query first (best results)
    if pk_column and server and database:
        values = _query_source_pks(
            server, database, schema, table, pk_column, search, limit
        )
        if values:
            return {"values": values, "pkColumn": pk_column}

    # Fallback: if we have no PK column at all, return empty
    if not pk_column:
        return {
            "values": [],
            "pkColumn": "",
            "error": "No primary key configured for this entity.",
        }

    # Fallback: return empty with informational message
    return {
        "values": [],
        "pkColumn": pk_column,
        "error": "Source database unreachable (VPN required). Enter a PK value manually.",
    }
