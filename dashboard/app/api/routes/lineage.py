"""Column lineage routes — cross-layer column discovery and caching.

Endpoints:
    GET /api/lineage/columns/{entityId} — per-layer column lists for an entity

Data sources:
    - SQLite: lz_entities, bronze_entities, silver_entities, lakehouses,
              entity_status, column_metadata (cache)
    - Fabric SQL Analytics Endpoint: INFORMATION_SCHEMA.COLUMNS queries
      (via _query_lakehouse, lazy-imported to avoid circular dependency)

Layer values in entity_status are LOWERCASE: "landing", "bronze", "silver"
entity_status uses LandingzoneEntityId (NOT EntityId).
"""
import logging
from datetime import datetime, timezone, timedelta

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db
import dashboard.app.api.control_plane_db as cpdb

log = logging.getLogger("fmd.routes.lineage")

# Cache TTL — re-query Fabric SQL after 24 hours
_CACHE_TTL_HOURS = 24


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _query_lakehouse_columns(lakehouse_name: str, schema: str, table: str) -> list[dict]:
    """Query INFORMATION_SCHEMA.COLUMNS for a lakehouse table.

    Returns a list of dicts with keys:
        name, dataType, nullable, maxLength, precision, scale, ordinal

    Raises HttpError on failure (caller decides whether to swallow).
    Lazy-imports _query_lakehouse and _sanitize from data_access to avoid
    circular import at module load time.
    """
    from dashboard.app.api.routes.data_access import _query_lakehouse, _sanitize

    s = _sanitize(schema)
    t = _sanitize(table)

    raw = _query_lakehouse(
        lakehouse_name,
        f"SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, "
        f"CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, "
        f"ORDINAL_POSITION "
        f"FROM INFORMATION_SCHEMA.COLUMNS "
        f"WHERE TABLE_SCHEMA = '{s}' AND TABLE_NAME = '{t}' "
        f"ORDER BY ORDINAL_POSITION",
    )

    columns = []
    for r in raw:
        try:
            ordinal = int(r.get("ORDINAL_POSITION") or 0)
        except (TypeError, ValueError):
            ordinal = 0
        try:
            max_len = int(r["CHARACTER_MAXIMUM_LENGTH"]) if r.get("CHARACTER_MAXIMUM_LENGTH") is not None else None
        except (TypeError, ValueError):
            max_len = None
        try:
            precision = int(r["NUMERIC_PRECISION"]) if r.get("NUMERIC_PRECISION") is not None else None
        except (TypeError, ValueError):
            precision = None
        try:
            scale = int(r["NUMERIC_SCALE"]) if r.get("NUMERIC_SCALE") is not None else None
        except (TypeError, ValueError):
            scale = None

        columns.append({
            "name": r.get("COLUMN_NAME", ""),
            "dataType": r.get("DATA_TYPE", ""),
            "nullable": (r.get("IS_NULLABLE", "YES") or "YES") == "YES",
            "maxLength": max_len,
            "precision": precision,
            "scale": scale,
            "ordinal": ordinal,
        })

    return columns


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
    except Exception:
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

    # Cache miss — query Fabric SQL
    try:
        cols = _query_lakehouse_columns(lakehouse_name, schema, table)
        if cols:
            _cache_columns(entity_id, layer, cols)
        return cols
    except Exception as e:
        log.warning(
            "Column query failed for entity %d layer %s (%s.%s.%s): %s",
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

    # 3. Resolve which layers are loaded
    status_rows = db.query(
        "SELECT Layer, Status FROM entity_status "
        "WHERE LandingzoneEntityId = ? AND Status = 'loaded'",
        (entity_id,),
    )
    loaded_layers = {(r.get("Layer") or "").lower() for r in status_rows}
    # Normalise "landingzone" → "landing" if present
    if "landingzone" in loaded_layers:
        loaded_layers.discard("landingzone")
        loaded_layers.add("landing")

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
