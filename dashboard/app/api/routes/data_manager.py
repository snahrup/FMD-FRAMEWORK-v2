"""Data Manager — business-friendly database explorer with inline editing.

Exposes a curated subset of SQLite tables with human-readable names,
FK resolution, value formatting, and row-level editing for config tables.
"""
import logging
import re
from datetime import datetime

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.data_manager")


def _queue_export(table: str):
    """Best-effort queue a Parquet export after writes."""
    try:
        from dashboard.app.api.parquet_sync import queue_export
        queue_export(table)
    except (ImportError, Exception):
        log.debug("Parquet export queue unavailable for table %s", table)


# ---------------------------------------------------------------------------
# Table Registry — defines everything the frontend needs
# ---------------------------------------------------------------------------
# Column spec keys:
#   key       — raw SQLite column name
#   label     — human-readable display name
#   type      — text | boolean | number | datetime | fk
#   editable  — can business users edit this cell?
#   hidden    — omit from the grid entirely (but still used for _pk)
#   fk_table  — for type=fk: which table to resolve from
#   fk_display — for type=fk: which column in fk_table to display
#   fk_pk     — for type=fk: PK column in fk_table (default: first PK)

def _col(key, label, typ="text", editable=False, hidden=False,
         fk_table=None, fk_display=None, fk_pk=None):
    c = {"key": key, "label": label, "type": typ, "editable": editable, "hidden": hidden}
    if fk_table:
        c["fk_table"] = fk_table
        c["fk_display"] = fk_display or "Name"
        c["fk_pk"] = fk_pk
    return c


TABLE_REGISTRY = {
    # ── Source Systems ──
    "connections": {
        "displayName": "Connections",
        "category": "Source Systems",
        "editable": True,
        "pk": ["ConnectionId"],
        "columns": [
            _col("ConnectionId", "ID", hidden=True),
            _col("DisplayName", "Display Name", editable=True),
            _col("Name", "Internal Name"),
            _col("Type", "Type", editable=True),
            _col("ServerName", "Server", editable=True),
            _col("DatabaseName", "Database", editable=True),
            _col("IsActive", "Active", "boolean", editable=True),
            _col("updated_at", "Last Modified", "datetime"),
        ],
    },
    "datasources": {
        "displayName": "Data Sources",
        "category": "Source Systems",
        "editable": True,
        "pk": ["DataSourceId"],
        "columns": [
            _col("DataSourceId", "ID", hidden=True),
            _col("DisplayName", "Display Name", editable=True),
            _col("Name", "Internal Name"),
            _col("ConnectionId", "Connection", "fk", editable=True,
                 fk_table="connections", fk_display="Name", fk_pk="ConnectionId"),
            _col("Namespace", "Namespace"),
            _col("Type", "Type"),
            _col("Description", "Description", editable=True),
            _col("IsActive", "Active", "boolean", editable=True),
            _col("updated_at", "Last Modified", "datetime"),
        ],
    },
    # ── Data Entities ──
    "lz_entities": {
        "displayName": "Landing Zone Entities",
        "category": "Data Entities",
        "editable": True,
        "pk": ["LandingzoneEntityId"],
        "columns": [
            _col("LandingzoneEntityId", "ID", hidden=True),
            _col("DataSourceId", "Data Source", "fk",
                 fk_table="datasources", fk_display="Name", fk_pk="DataSourceId"),
            _col("SourceSchema", "Source Schema"),
            _col("SourceName", "Source Table"),
            _col("FileName", "File Name"),
            _col("FilePath", "File Path"),
            _col("FileType", "Format"),
            _col("IsIncremental", "Incremental Load", "boolean", editable=True),
            _col("IsIncrementalColumn", "Watermark Column", editable=True),
            _col("SourceCustomSelect", "Custom SQL Query", editable=True),
            _col("CustomNotebookName", "Custom Notebook", editable=True),
            _col("IsActive", "Active", "boolean", editable=True),
            _col("updated_at", "Last Modified", "datetime"),
        ],
    },
    "bronze_entities": {
        "displayName": "Bronze Layer Entities",
        "category": "Data Entities",
        "editable": True,
        "pk": ["BronzeLayerEntityId"],
        "columns": [
            _col("BronzeLayerEntityId", "ID", hidden=True),
            _col("LandingzoneEntityId", "Landing Zone Entity", "fk",
                 fk_table="lz_entities", fk_display="SourceName", fk_pk="LandingzoneEntityId"),
            _col("Schema_", "Schema"),
            _col("Name", "Table Name"),
            _col("PrimaryKeys", "Primary Keys", editable=True),
            _col("FileType", "Format"),
            _col("IsActive", "Active", "boolean", editable=True),
            _col("updated_at", "Last Modified", "datetime"),
        ],
    },
    "silver_entities": {
        "displayName": "Silver Layer Entities",
        "category": "Data Entities",
        "editable": True,
        "pk": ["SilverLayerEntityId"],
        "columns": [
            _col("SilverLayerEntityId", "ID", hidden=True),
            _col("BronzeLayerEntityId", "Bronze Entity", "fk",
                 fk_table="bronze_entities", fk_display="Name", fk_pk="BronzeLayerEntityId"),
            _col("Schema_", "Schema"),
            _col("Name", "Table Name"),
            _col("FileType", "Format"),
            _col("IsActive", "Active", "boolean", editable=True),
            _col("updated_at", "Last Modified", "datetime"),
        ],
    },
    # ── Load Status ──
    "entity_status": {
        "displayName": "Entity Load Status",
        "category": "Load Status",
        "editable": False,
        "pk": ["LandingzoneEntityId", "Layer"],
        "columns": [
            _col("LandingzoneEntityId", "Entity", "fk",
                 fk_table="lz_entities", fk_display="SourceName", fk_pk="LandingzoneEntityId"),
            _col("Layer", "Layer"),
            _col("Status", "Status"),
            _col("LoadEndDateTime", "Last Loaded", "datetime"),
            _col("ErrorMessage", "Error"),
            _col("UpdatedBy", "Updated By"),
        ],
    },
    "watermarks": {
        "displayName": "Incremental Watermarks",
        "category": "Load Status",
        "editable": False,
        "pk": ["LandingzoneEntityId"],
        "columns": [
            _col("LandingzoneEntityId", "Entity", "fk",
                 fk_table="lz_entities", fk_display="SourceName", fk_pk="LandingzoneEntityId"),
            _col("LoadValue", "Last Load Value"),
            _col("LastLoadDatetime", "Last Load Time", "datetime"),
        ],
    },
    # ── Run History ──
    "engine_runs": {
        "displayName": "Engine Runs",
        "category": "Run History",
        "editable": False,
        "pk": ["RunId"],
        "columns": [
            _col("RunId", "Run ID"),
            _col("Mode", "Mode"),
            _col("Status", "Status"),
            _col("TotalEntities", "Total Entities", "number"),
            _col("SucceededEntities", "Succeeded", "number"),
            _col("FailedEntities", "Failed", "number"),
            _col("SkippedEntities", "Skipped", "number"),
            _col("TotalRowsRead", "Rows Read", "number"),
            _col("TotalRowsWritten", "Rows Written", "number"),
            _col("TotalDurationSeconds", "Duration", "number"),
            _col("Layers", "Layers"),
            _col("TriggeredBy", "Triggered By"),
            _col("StartedAt", "Started", "datetime"),
            _col("EndedAt", "Ended", "datetime"),
        ],
    },
    "engine_task_log": {
        "displayName": "Task Execution Log",
        "category": "Run History",
        "editable": False,
        "pk": ["id"],
        "columns": [
            _col("id", "ID", hidden=True),
            _col("RunId", "Run ID"),
            _col("EntityId", "Entity ID", "number"),
            _col("Layer", "Layer"),
            _col("Status", "Status"),
            _col("SourceTable", "Source Table"),
            _col("RowsRead", "Rows Read", "number"),
            _col("RowsWritten", "Rows Written", "number"),
            _col("DurationSeconds", "Duration", "number"),
            _col("LoadType", "Load Type"),
            _col("ErrorType", "Error Type"),
            _col("ErrorMessage", "Error"),
        ],
    },
    # ── Pipeline Queues ──
    "pipeline_lz_entity": {
        "displayName": "Landing Zone Queue",
        "category": "Pipeline Queues",
        "editable": False,
        "pk": ["id"],
        "columns": [
            _col("id", "ID", hidden=True),
            _col("LandingzoneEntityId", "Entity", "fk",
                 fk_table="lz_entities", fk_display="SourceName", fk_pk="LandingzoneEntityId"),
            _col("FileName", "File Name"),
            _col("FilePath", "File Path"),
            _col("InsertDateTime", "Queued At", "datetime"),
            _col("IsProcessed", "Processed", "boolean"),
        ],
    },
    "pipeline_bronze_entity": {
        "displayName": "Bronze Queue",
        "category": "Pipeline Queues",
        "editable": False,
        "pk": ["id"],
        "columns": [
            _col("id", "ID", hidden=True),
            _col("BronzeLayerEntityId", "Entity", "fk",
                 fk_table="bronze_entities", fk_display="Name", fk_pk="BronzeLayerEntityId"),
            _col("TableName", "Table"),
            _col("SchemaName", "Schema"),
            _col("InsertDateTime", "Queued At", "datetime"),
            _col("IsProcessed", "Processed", "boolean"),
        ],
    },
    # ── Audit Trail ──
    "pipeline_audit": {
        "displayName": "Pipeline Audit Log",
        "category": "Audit Trail",
        "editable": False,
        "pk": ["id"],
        "columns": [
            _col("id", "ID", hidden=True),
            _col("PipelineRunGuid", "Pipeline Run"),
            _col("PipelineName", "Pipeline"),
            _col("EntityLayer", "Layer"),
            _col("TriggerType", "Trigger"),
            _col("LogType", "Log Type"),
            _col("LogDateTime", "Timestamp", "datetime"),
            _col("EntityId", "Entity ID", "number"),
        ],
    },
    "notebook_executions": {
        "displayName": "Notebook Executions",
        "category": "Audit Trail",
        "editable": False,
        "pk": ["id"],
        "columns": [
            _col("id", "ID", hidden=True),
            _col("NotebookName", "Notebook"),
            _col("PipelineRunGuid", "Pipeline Run"),
            _col("EntityId", "Entity ID", "number"),
            _col("EntityLayer", "Layer"),
            _col("Status", "Status"),
            _col("LogType", "Log Type"),
            _col("StartedAt", "Started", "datetime"),
            _col("EndedAt", "Ended", "datetime"),
        ],
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _visible_columns(table_name: str) -> list[dict]:
    """Return column specs for a table, excluding hidden columns."""
    cfg = TABLE_REGISTRY[table_name]
    return [c for c in cfg["columns"] if not c.get("hidden")]


def _all_select_keys(table_name: str) -> list[str]:
    """All raw column keys to SELECT (including hidden, for PK/_pk)."""
    return [c["key"] for c in TABLE_REGISTRY[table_name]["columns"]]


def _build_pk(row: dict, pk_cols: list[str]) -> str:
    """Build a string _pk value from row data and PK column(s)."""
    if len(pk_cols) == 1:
        return str(row.get(pk_cols[0], ""))
    return "|".join(str(row.get(c, "")) for c in pk_cols)


def _parse_pk(pk_str: str, pk_cols: list[str]) -> dict:
    """Parse a _pk string back into column->value pairs."""
    parts = pk_str.split("|") if len(pk_cols) > 1 else [pk_str]
    if len(parts) != len(pk_cols):
        raise HttpError(f"Invalid primary key: {pk_str}", 400)
    return dict(zip(pk_cols, parts))


def _format_value(val, col_type: str):
    """Format a raw SQLite value for display."""
    if val is None:
        return None
    if col_type == "boolean":
        if isinstance(val, str):
            return val.lower() in ("1", "true", "yes")
        return bool(val)
    if col_type == "datetime":
        if isinstance(val, str) and val:
            for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ",
                        "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    dt = datetime.strptime(val, fmt)
                    return dt.strftime("%b %d, %Y %I:%M %p").replace(" 0", " ")
                except ValueError:
                    log.debug("Datetime parse failed for value %r with format %s", val, fmt)
                    continue
        return str(val)
    if col_type == "number":
        try:
            n = float(val)
            return int(n) if n == int(n) else round(n, 2)
        except (ValueError, TypeError, OverflowError):
            return val
    return val


def _safe_ident(name: str) -> str:
    """Validate and bracket-quote a SQL identifier.

    Table and column names cannot use ``?`` parameter placeholders — only
    values can be parameterized.  This helper guards against injection by
    rejecting any name that contains characters outside the safe set
    (alphanumeric, underscore, space) and wrapping the result in brackets.
    """
    if not name or not re.fullmatch(r"[\w ]+", name):
        raise HttpError(f"Invalid SQL identifier: {name!r}", 400)
    # Escape embedded right-brackets to prevent bracket-escape injection
    escaped = name.replace("]", "]]")
    return f"[{escaped}]"


def _resolve_fk_cache() -> dict:
    """Build a cache of FK lookups: {table_name: {pk_value: display_value}}."""
    cache = {}
    fk_tables = set()
    for cfg in TABLE_REGISTRY.values():
        for col in cfg["columns"]:
            if col.get("fk_table"):
                fk_tables.add((col["fk_table"], col.get("fk_display", "Name"),
                               col.get("fk_pk")))

    for fk_table, fk_display, fk_pk in fk_tables:
        if fk_table not in TABLE_REGISTRY:
            continue
        pk_col = fk_pk or TABLE_REGISTRY[fk_table]["pk"][0]
        try:
            rows = db.query("SELECT " + _safe_ident(pk_col) + ", " + _safe_ident(fk_display) + " FROM " + _safe_ident(fk_table))
            cache_key = f"{fk_table}.{fk_display}"
            cache[cache_key] = {str(r[pk_col]): r[fk_display] for r in rows}
        except Exception as e:
            log.debug("Failed to build FK cache for %s: %s", fk_table, e)
    return cache


def _resolve_fk_value(col: dict, raw_val, fk_cache: dict):
    """Resolve a FK column value to its display string."""
    if raw_val is None:
        return None
    fk_table = col.get("fk_table")
    fk_display = col.get("fk_display", "Name")
    cache_key = f"{fk_table}.{fk_display}"
    lookup = fk_cache.get(cache_key, {})
    return lookup.get(str(raw_val), str(raw_val))


def _get_fk_options(table_name: str) -> dict:
    """Get dropdown options for all FK columns in a table."""
    cfg = TABLE_REGISTRY[table_name]
    options = {}
    for col in cfg["columns"]:
        if col["type"] != "fk" or not col.get("editable"):
            continue
        fk_table = col["fk_table"]
        fk_display = col.get("fk_display", "Name")
        fk_pk = col.get("fk_pk") or TABLE_REGISTRY.get(fk_table, {}).get("pk", ["id"])[0]
        try:
            rows = db.query("SELECT " + _safe_ident(fk_pk) + ", " + _safe_ident(fk_display) + " FROM " + _safe_ident(fk_table) + " ORDER BY " + _safe_ident(fk_display))
            options[col["key"]] = [{"value": r[fk_pk], "label": r[fk_display]} for r in rows]
        except Exception as e:
            log.debug("Failed to get FK options for %s.%s: %s", fk_table, col["key"], e)
            options[col["key"]] = []
    return options


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------

@route("GET", "/api/data-manager/tables")
def list_tables(params):
    """Return visible table list with metadata."""
    result = []
    for table_name, cfg in TABLE_REGISTRY.items():
        try:
            count_rows = db.query("SELECT COUNT(*) as cnt FROM " + _safe_ident(table_name))
            row_count = count_rows[0]["cnt"]
        except Exception as e:
            log.debug("Failed to get row count for table %s: %s", table_name, e)
            row_count = 0
        result.append({
            "name": table_name,
            "displayName": cfg["displayName"],
            "category": cfg["category"],
            "rowCount": row_count,
            "editable": cfg["editable"],
        })
    return result


@route("GET", "/api/data-manager/table/{name}")
def get_table_data(params):
    """Return paginated, formatted data with column metadata."""
    table_name = params["name"]
    if table_name not in TABLE_REGISTRY:
        raise HttpError("Table not found", 404)

    cfg = TABLE_REGISTRY[table_name]
    try:
        page = max(1, int(params.get("page", 1)))
    except (ValueError, TypeError):
        page = 1
    try:
        per_page = min(max(1, int(params.get("per_page", 50))), 500)
    except (ValueError, TypeError):
        per_page = 50
    offset = (page - 1) * per_page
    search = params.get("search", "").strip()
    sort_col = params.get("sort", "")
    sort_order = params.get("order", "asc").lower()
    if sort_order not in ("asc", "desc"):
        sort_order = "asc"

    select_keys = _all_select_keys(table_name)
    select_clause = ", ".join(_safe_ident(k) for k in select_keys)

    # Build WHERE for search
    where_clause = ""
    where_params = []
    if search:
        visible = _visible_columns(table_name)
        text_cols = [c["key"] for c in visible if c["type"] in ("text", "fk")]
        if text_cols:
            conditions = " OR ".join("CAST(" + _safe_ident(c) + " AS TEXT) LIKE ?" for c in text_cols)
            where_clause = "WHERE (" + conditions + ")"
            where_params = [f"%{search}%"] * len(text_cols)

    # Build ORDER BY
    order_clause = ""
    valid_sort_keys = {c["key"] for c in cfg["columns"]}
    if sort_col and sort_col in valid_sort_keys:
        order_clause = "ORDER BY " + _safe_ident(sort_col) + " " + sort_order.upper()

    # Count
    count_sql = "SELECT COUNT(*) as cnt FROM " + _safe_ident(table_name) + " " + where_clause
    total = db.query(count_sql, tuple(where_params))[0]["cnt"]

    # Fetch
    data_sql = "SELECT " + select_clause + " FROM " + _safe_ident(table_name) + " " + where_clause + " " + order_clause + " LIMIT ? OFFSET ?"
    raw_rows = db.query(data_sql, tuple(where_params) + (per_page, offset))

    # FK resolution
    fk_cache = _resolve_fk_cache()

    # Format rows
    visible_cols = _visible_columns(table_name)
    formatted_rows = []
    for raw in raw_rows:
        row = {"_pk": _build_pk(raw, cfg["pk"])}
        for col in visible_cols:
            raw_val = raw.get(col["key"])
            if col["type"] == "fk":
                row[col["key"]] = _resolve_fk_value(col, raw_val, fk_cache)
                # Also include raw value for FK dropdowns
                row[f"_raw_{col['key']}"] = raw_val
            else:
                row[col["key"]] = _format_value(raw_val, col["type"])
        formatted_rows.append(row)

    # Column metadata (exclude hidden)
    col_meta = []
    for col in visible_cols:
        meta = {"key": col["key"], "label": col["label"], "type": col["type"],
                "editable": col.get("editable", False)}
        col_meta.append(meta)

    result = {
        "table": table_name,
        "displayName": cfg["displayName"],
        "category": cfg["category"],
        "editable": cfg["editable"],
        "total": total,
        "page": page,
        "perPage": per_page,
        "columns": col_meta,
        "rows": formatted_rows,
    }

    # Include FK options for editable tables
    fk_opts = _get_fk_options(table_name)
    if fk_opts:
        result["fkOptions"] = fk_opts

    return result


@route("PUT", "/api/data-manager/table/{name}/{pk}")
def update_row(params):
    """Update a single row in an editable table."""
    table_name = params.get("name", "")
    pk_str = params.get("pk", "")

    if table_name not in TABLE_REGISTRY:
        raise HttpError("Table not found", 404)

    cfg = TABLE_REGISTRY[table_name]
    if not cfg["editable"]:
        raise HttpError("This table is read-only", 403)

    pk_vals = _parse_pk(pk_str, cfg["pk"])

    # Extract editable columns from body
    editable_keys = {c["key"] for c in cfg["columns"] if c.get("editable")}
    # Filter body: only keys that are in params but NOT path/query params
    reserved = {"name", "pk", "page", "per_page", "search", "sort", "order"}
    updates = {}
    for key, val in params.items():
        if key in reserved or key.startswith("_"):
            continue
        if key in editable_keys:
            updates[key] = val

    if not updates:
        raise HttpError("No editable fields provided", 400)

    # Validate types
    col_lookup = {c["key"]: c for c in cfg["columns"]}
    for key, val in updates.items():
        col = col_lookup.get(key)
        if not col:
            continue
        if col["type"] == "boolean":
            if isinstance(val, bool):
                updates[key] = 1 if val else 0
            elif isinstance(val, (int, float)):
                updates[key] = 1 if val else 0
            elif isinstance(val, str):
                updates[key] = 1 if val.lower() in ("true", "1", "yes") else 0
        elif col["type"] == "fk" and val is not None:
            # Validate FK reference exists
            fk_table = col.get("fk_table")
            fk_pk = col.get("fk_pk") or TABLE_REGISTRY.get(fk_table, {}).get("pk", ["id"])[0]
            exists = db.query("SELECT 1 FROM " + _safe_ident(fk_table) + " WHERE " + _safe_ident(fk_pk) + " = ?", (val,))
            if not exists:
                raise HttpError(f"Invalid reference: {col['label']} value {val} not found", 400)

    # Build UPDATE
    set_parts = []
    set_params = []
    for key, val in updates.items():
        set_parts.append(_safe_ident(key) + " = ?")
        set_params.append(val)

    where_parts = []
    where_params = []
    for pk_col, pk_val in pk_vals.items():
        where_parts.append(_safe_ident(pk_col) + " = ?")
        where_params.append(pk_val)

    sql = "UPDATE " + _safe_ident(table_name) + " SET " + ", ".join(set_parts) + " WHERE " + " AND ".join(where_parts)
    db.execute(sql, tuple(set_params + where_params))

    # Trigger parquet sync
    _queue_export(table_name)

    log.info("Updated %s pk=%s fields=%s", table_name, pk_str, list(updates.keys()))

    return {"ok": True, "table": table_name, "pk": pk_str, "updated": list(updates.keys())}
