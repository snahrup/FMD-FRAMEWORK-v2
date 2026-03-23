"""Column lineage routes — cross-layer column discovery and caching.

Endpoints:
    GET /api/lineage/columns/{entityId} — per-layer column lists for an entity

Data sources:
    - SQLite: lz_entities, bronze_entities, silver_entities, lakehouses,
              engine_task_log, column_metadata (cache)
    - OneLake local parquet: schema discovery from local delta/parquet files
      (via polars scan_parquet, falls back gracefully if mount unavailable)

Layer values in engine_task_log are LOWERCASE: "landing", "bronze", "silver"
engine_task_log uses EntityId (= LandingzoneEntityId from lz_entities).
"""
import glob
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db
import dashboard.app.api.control_plane_db as cpdb

log = logging.getLogger("fmd.routes.lineage")

# Cache TTL — re-query after 24 hours
_CACHE_TTL_HOURS = 24

# Polars dtype → SQL-like type name mapping
_DTYPE_MAP = {
    "Int8": "tinyint", "Int16": "smallint", "Int32": "int", "Int64": "bigint",
    "UInt8": "tinyint", "UInt16": "smallint", "UInt32": "int", "UInt64": "bigint",
    "Float32": "real", "Float64": "float",
    "Boolean": "bit", "Utf8": "varchar", "String": "varchar",
    "Date": "date", "Datetime": "datetime2", "Time": "time",
    "Duration": "bigint", "Binary": "varbinary", "LargeBinary": "varbinary",
    "Decimal": "decimal", "Null": "null",
}


def _polars_dtype_to_sql(dtype) -> str:
    """Convert a polars dtype to a SQL-like type string."""
    name = str(dtype)
    # Strip parameterized parts: "Decimal(38, 6)" -> "Decimal"
    base = name.split("(")[0].split("[")[0].strip()
    return _DTYPE_MAP.get(base, name.lower())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_onelake_schema(lakehouse_name: str, schema: str, table: str) -> list[dict]:
    """Read column schema from local OneLake parquet/delta files via polars.

    Returns a list of dicts with keys:
        name, dataType, nullable, maxLength, precision, scale, ordinal

    Returns empty list if OneLake mount unavailable or table not found.
    """
    try:
        import polars as pl
    except ImportError:
        log.debug("polars not available — cannot read OneLake schema")
        return []

    # Lazy-import to avoid circular dependency
    from dashboard.app.api.routes.data_access import _get_onelake_mount

    mount = _get_onelake_mount()
    if not mount:
        return []

    # Try delta Tables path first (Bronze/Silver), then Files path (LZ)
    table_dir = mount / f"{lakehouse_name}.Lakehouse" / "Tables" / schema / table
    if not table_dir.is_dir():
        # LZ uses Files/{schema}/{table}.parquet (single file, not a dir)
        lz_file = mount / f"{lakehouse_name}.Lakehouse" / "Files" / schema / f"{table}.parquet"
        if lz_file.is_file():
            try:
                lf = pl.scan_parquet(str(lz_file))
                columns = []
                for i, (col_name, dtype) in enumerate(lf.schema.items()):
                    columns.append({
                        "name": col_name,
                        "dataType": _polars_dtype_to_sql(dtype),
                        "nullable": True,
                        "maxLength": None,
                        "precision": None,
                        "scale": None,
                        "ordinal": i + 1,
                    })
                return columns
            except Exception as e:
                log.warning("Failed to read LZ parquet schema %s: %s", lz_file, e)
                return []
        return []

    # Delta table — find parquet parts
    parts = glob.glob(str(table_dir / "*.parquet"))
    if not parts:
        # Delta lake stores parts in subdirs sometimes
        parts = glob.glob(str(table_dir / "**" / "*.parquet"), recursive=True)
    if not parts:
        return []

    try:
        lf = pl.scan_parquet(parts[0])
        columns = []
        for i, (col_name, dtype) in enumerate(lf.schema.items()):
            columns.append({
                "name": col_name,
                "dataType": _polars_dtype_to_sql(dtype),
                "nullable": True,
                "maxLength": None,
                "precision": None,
                "scale": None,
                "ordinal": i + 1,
            })
        return columns
    except Exception as e:
        log.warning("Failed to read OneLake schema for %s/%s/%s: %s",
                    lakehouse_name, schema, table, e)
        return []


def _cache_columns(entity_id: int, layer: str, columns: list[dict]) -> None:
    """Upsert column list into column_metadata cache table.

    Called after a successful Fabric SQL query so subsequent requests
    within the TTL window skip the remote call.
    """
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = cpdb._get_conn()
    try:
        conn.executemany(
            """
            INSERT INTO column_metadata
                (entity_id, layer, column_name, data_type, ordinal_position,
                 is_nullable, max_length, numeric_precision, numeric_scale, captured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entity_id, layer, column_name) DO UPDATE SET
                data_type          = excluded.data_type,
                ordinal_position   = excluded.ordinal_position,
                is_nullable        = excluded.is_nullable,
                max_length         = excluded.max_length,
                numeric_precision  = excluded.numeric_precision,
                numeric_scale      = excluded.numeric_scale,
                captured_at        = excluded.captured_at
            """,
            [
                (
                    entity_id,
                    layer,
                    col["name"],
                    col["dataType"],
                    col["ordinal"],
                    1 if col["nullable"] else 0,
                    col.get("maxLength"),
                    col.get("precision"),
                    col.get("scale"),
                    now,
                )
                for col in columns
            ],
        )
        conn.commit()
    except Exception as e:
        log.warning("Failed to cache columns for entity %d layer %s: %s", entity_id, layer, e)
    finally:
        conn.close()


def _load_cached_columns(entity_id: int, layer: str) -> list[dict] | None:
    """Return cached columns if still fresh (within TTL), else None.

    A None return means the caller should re-query Fabric SQL.
    """
    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            "SELECT column_name, data_type, ordinal_position, is_nullable, "
            "max_length, numeric_precision, numeric_scale, captured_at "
            "FROM column_metadata "
            "WHERE entity_id = ? AND layer = ? "
            "ORDER BY ordinal_position",
            (entity_id, layer),
        ).fetchall()
    except Exception as e:
        log.debug("column_metadata query failed (table may not exist): %s", e)
        return None
    finally:
        conn.close()

    if not rows:
        return None

    # Check TTL on the first row (all rows share the same capture batch)
    captured_at_str = rows[0]["captured_at"] or ""
    try:
        captured_at = datetime.fromisoformat(captured_at_str.replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - captured_at
        if age > timedelta(hours=_CACHE_TTL_HOURS):
            return None
    except Exception as e:
        log.debug("Failed to parse lineage cache timestamp '%s': %s", captured_at_str, e)
        return None  # unparseable timestamp → treat as stale

    return [
        {
            "name": r["column_name"],
            "dataType": r["data_type"] or "",
            "nullable": bool(r["is_nullable"]),
            "maxLength": r["max_length"],
            "precision": r["numeric_precision"],
            "scale": r["numeric_scale"],
            "ordinal": r["ordinal_position"] or 0,
        }
        for r in rows
    ]


def _get_columns_for_layer(
    entity_id: int,
    layer: str,
    lakehouse_name: str,
    schema: str,
    table: str,
) -> list[dict]:
    """Return columns for one layer, using cache where possible.

    On cache miss or Fabric SQL failure, returns empty list (never raises).
    """
    # Try cache first
    cached = _load_cached_columns(entity_id, layer)
    if cached is not None:
        return cached

    # Cache miss — read schema from local OneLake parquet files
    try:
        cols = _read_onelake_schema(lakehouse_name, schema, table)
        if cols:
            _cache_columns(entity_id, layer, cols)
        return cols
    except Exception as e:
        log.warning(
            "OneLake schema read failed for entity %d layer %s (%s.%s.%s): %s",
            entity_id, layer, lakehouse_name, schema, table, e,
        )
        return []


# ---------------------------------------------------------------------------
# GET /api/lineage/columns/{entityId}
# ---------------------------------------------------------------------------

@route("GET", "/api/lineage/columns/{entityId}")
def get_lineage_columns(params: dict) -> dict:
    """Return column lists across all loaded layers for an entity.

    Response shape:
        {
          "entityId": 42,
          "entityName": "schema.table",
          "source":  { "columns": [...] },
          "landing": { "columns": [...] },
          "bronze":  { "columns": [...] },
          "silver":  { "columns": [...] }
        }

    Each columns element: { name, dataType, nullable, maxLength, precision, scale, ordinal }

    Layers that are not yet loaded return { "columns": [], "status": "not_loaded" }.
    Source columns mirror Landing (same schema, different location).
    """
    entity_id_str = params.get("entityId", "")
    try:
        entity_id = int(entity_id_str)
    except (TypeError, ValueError):
        raise HttpError("entityId must be an integer", 400)

    # 1. Load entity metadata from SQLite
    lz_rows = db.query(
        "SELECT e.*, d.Name AS DataSourceName, "
        "       c.ServerName, c.DatabaseName "
        "FROM lz_entities e "
        "LEFT JOIN datasources d ON d.DataSourceId = e.DataSourceId "
        "LEFT JOIN connections c ON c.ConnectionId = d.ConnectionId "
        "WHERE e.LandingzoneEntityId = ?",
        (entity_id,),
    )
    if not lz_rows:
        raise HttpError(f"Entity {entity_id} not found", 404)
    lz = lz_rows[0]

    schema = lz.get("SourceSchema") or "dbo"
    table = lz.get("SourceName") or ""
    entity_name = f"{schema}.{table}"

    # 2. Load bronze + silver entity records (for lakehouse IDs)
    bronze_rows = db.query(
        "SELECT * FROM bronze_entities WHERE LandingzoneEntityId = ?",
        (entity_id,),
    )
    bronze = bronze_rows[0] if bronze_rows else None

    silver = None
    if bronze:
        silver_rows = db.query(
            "SELECT * FROM silver_entities WHERE BronzeLayerEntityId = ?",
            (bronze.get("BronzeLayerEntityId"),),
        )
        silver = silver_rows[0] if silver_rows else None

    # 3. Resolve which layers are loaded (from engine_task_log)
    status_rows = db.query(
        """
        SELECT Layer, Status FROM (
            SELECT Layer, Status,
                   ROW_NUMBER() OVER (
                       PARTITION BY Layer
                       ORDER BY created_at DESC,
                                CASE Status WHEN 'succeeded' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END
                   ) AS rn
            FROM engine_task_log
            WHERE EntityId = ?
        ) WHERE rn = 1 AND Status = 'succeeded'
        """,
        (entity_id,),
    )
    loaded_layers = {(r.get("Layer") or "").lower() for r in status_rows}

    # 4. Resolve lakehouse names
    def _lh_name(lh_id) -> str:
        if not lh_id:
            return ""
        rows = db.query("SELECT Name FROM lakehouses WHERE LakehouseId = ?", (lh_id,))
        return rows[0]["Name"] if rows else ""

    bronze_lh = _lh_name(bronze.get("LakehouseId")) if bronze else ""
    silver_lh = _lh_name(silver.get("LakehouseId")) if silver else ""

    # Bronze/Silver use their own Schema_/Name which may differ from source
    # (e.g., bronze uses datasource Namespace as schema: "mes.MITMAS" not "dbo.MITMAS")
    bronze_schema = (bronze.get("Schema_") or lz.get("SourceSchema") or "dbo") if bronze else "dbo"
    bronze_table = (bronze.get("Name") or lz.get("SourceName") or table) if bronze else table
    silver_schema = (silver.get("Schema_") or lz.get("SourceSchema") or "dbo") if silver else "dbo"
    silver_table = (silver.get("Name") or lz.get("SourceName") or table) if silver else table

    # 5. Fetch columns per layer
    not_loaded = {"columns": [], "status": "not_loaded"}

    # Landing
    landing_result: dict
    if "landing" in loaded_layers:
        # Landing zone is a flat Parquet copy — same schema as source.
        # We use the LZ lakehouse name (LH_DATA_LANDINGZONE) if available,
        # but the entity's schema/table are the same as source.
        lz_lh_rows = db.query(
            "SELECT l.Name FROM lakehouses l "
            "JOIN lz_entities e ON e.LakehouseId = l.LakehouseId "
            "WHERE e.LandingzoneEntityId = ?",
            (entity_id,),
        )
        lz_lh_name = lz_lh_rows[0]["Name"] if lz_lh_rows else ""
        lz_cols = _get_columns_for_layer(entity_id, "landing", lz_lh_name, schema, table)
        landing_result = {"columns": lz_cols, "status": "loaded"}
    else:
        landing_result = not_loaded.copy()

    # Source mirrors landing
    source_cols = landing_result.get("columns", [])
    source_result = {"columns": source_cols, "status": "loaded" if source_cols else "unavailable"}

    # Bronze
    bronze_result: dict
    if "bronze" in loaded_layers and bronze_lh:
        b_cols = _get_columns_for_layer(entity_id, "bronze", bronze_lh, bronze_schema, bronze_table)
        bronze_result = {"columns": b_cols, "status": "loaded"}
    else:
        bronze_result = not_loaded.copy()

    # Silver
    silver_result: dict
    if "silver" in loaded_layers and silver_lh:
        s_cols = _get_columns_for_layer(entity_id, "silver", silver_lh, silver_schema, silver_table)
        silver_result = {"columns": s_cols, "status": "loaded"}
    else:
        silver_result = not_loaded.copy()

    return {
        "entityId": entity_id,
        "entityName": entity_name,
        "source": source_result,
        "landing": landing_result,
        "bronze": bronze_result,
        "silver": silver_result,
    }
