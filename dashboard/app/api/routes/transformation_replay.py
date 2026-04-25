"""Transformation Replay routes.

These endpoints intentionally use only local control-plane state and the
local OneLake mount. They should not require VPN unless the caller explicitly
asks for source-system rows through Data Microscope.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from dashboard.app.api import db
import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import HttpError, route

log = logging.getLogger("fmd.routes.transformation_replay")

SUCCESS_STATUSES = {"succeeded", "loaded", "complete", "completed", "success"}
LAYER_ORDER = ("landing", "bronze", "silver")
SYSTEM_COLUMNS = {
    "hashedpkcolumn",
    "hashednonkeycolumns",
    "recordloaddate",
    "recordstartdate",
    "recordenddate",
    "recordmodifieddate",
    "iscurrent",
    "isdeleted",
    "action",
}


def _norm(value: Any) -> str:
    return str(value or "").strip()


def _layer_key(value: Any) -> str:
    raw = _norm(value).lower()
    return "landing" if raw == "landingzone" else raw


def _is_success(value: Any) -> bool:
    return _norm(value).lower() in SUCCESS_STATUSES


def _row_value(value: Any) -> str:
    if value is None:
        return "NULL"
    text = str(value)
    return text if len(text) <= 120 else f"{text[:117]}..."


def _display_table(row: dict, layer: str) -> str:
    tables = _resolve_physical_tables(row)
    table = tables.get(layer) or {}
    return f"{table.get('lakehouse')}.{table.get('schema')}.{table.get('table')}"


def _candidate_tables(row: dict, layer: str) -> tuple[list[str], list[str], str]:
    namespace = _norm(row.get("FilePath")) or _norm(row.get("Namespace")) or _norm(row.get("SourceSchema")) or "dbo"
    source_schema = _norm(row.get("SourceSchema")) or "dbo"
    source_name = _norm(row.get("SourceName"))
    bronze_name = _norm(row.get("BronzeName")) or source_name
    silver_name = _norm(row.get("SilverName")) or bronze_name or source_name
    prefixed_source = f"{source_schema}_{source_name}" if source_schema and source_schema.lower() != "dbo" else source_name
    prefixed_bronze = f"{source_schema}_{bronze_name}" if source_schema and source_schema.lower() != "dbo" else bronze_name
    prefixed_silver = f"{source_schema}_{silver_name}" if source_schema and source_schema.lower() != "dbo" else silver_name

    if layer == "landing":
        return [namespace, _norm(row.get("Namespace")), source_schema], [source_name, f"{source_name}.parquet"], "LH_DATA_LANDINGZONE"
    if layer == "bronze":
        return [namespace, _norm(row.get("Namespace")), _norm(row.get("BronzeSchema")), source_schema], [bronze_name, prefixed_bronze, source_name, prefixed_source], "LH_BRONZE_LAYER"
    return [namespace, _norm(row.get("Namespace")), _norm(row.get("SilverSchema")), _norm(row.get("BronzeSchema")), source_schema], [silver_name, prefixed_silver, bronze_name, prefixed_bronze, source_name, prefixed_source], "LH_SILVER_LAYER"


def _dedupe(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        text = _norm(value).strip("/")
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def _count_cache() -> dict[tuple[str, str, str], dict]:
    rows = db.query(
        "SELECT lakehouse, schema_name, table_name, row_count, file_count, size_bytes, scanned_at "
        "FROM lakehouse_row_counts"
    )
    return {
        (
            _norm(row.get("lakehouse")).lower(),
            _norm(row.get("schema_name")).lower(),
            _norm(row.get("table_name")).lower(),
        ): row
        for row in rows
    }


def _match_physical_table(row: dict, layer: str, cache: dict | None = None) -> dict:
    cache = cache if cache is not None else _count_cache()
    schema_candidates, table_candidates, lakehouse = _candidate_tables(row, layer)
    schemas = _dedupe(schema_candidates)
    tables = _dedupe(table_candidates)

    for schema in schemas:
        for table in tables:
            cached = cache.get((lakehouse.lower(), schema.lower(), table.lower()))
            if cached:
                return {
                    "lakehouse": lakehouse,
                    "schema": _norm(cached.get("schema_name")) or schema,
                    "table": _norm(cached.get("table_name")) or table,
                    "rowCount": int(cached.get("row_count") or 0),
                    "fileCount": int(cached.get("file_count") or 0),
                    "sizeBytes": int(cached.get("size_bytes") or 0),
                    "scannedAt": cached.get("scanned_at"),
                    "matched": True,
                }

    return {
        "lakehouse": lakehouse,
        "schema": schemas[0] if schemas else "dbo",
        "table": tables[0] if tables else _norm(row.get("SourceName")),
        "rowCount": None,
        "fileCount": None,
        "sizeBytes": None,
        "scannedAt": None,
        "matched": False,
    }


def _resolve_physical_tables(row: dict, cache: dict | None = None) -> dict[str, dict]:
    cache = cache if cache is not None else _count_cache()
    return {layer: _match_physical_table(row, layer, cache) for layer in LAYER_ORDER}


def _status_map() -> dict[int, dict[str, dict]]:
    result: dict[int, dict[str, dict]] = {}
    for row in cpdb.get_canonical_entity_status():
        entity_id = row.get("LandingzoneEntityId")
        if entity_id is None:
            continue
        result.setdefault(int(entity_id), {})[_layer_key(row.get("Layer"))] = row
    return result


def _entity_rows() -> list[dict]:
    return db.query(
        """
        SELECT
            le.LandingzoneEntityId,
            le.DataSourceId,
            le.SourceSchema,
            le.SourceName,
            le.FilePath,
            le.IsActive,
            ds.Name AS DataSourceName,
            ds.Namespace,
            c.ServerName,
            c.DatabaseName,
            be.BronzeLayerEntityId,
            be.Schema_ AS BronzeSchema,
            be.Name AS BronzeName,
            be.PrimaryKeys,
            se.SilverLayerEntityId,
            se.Schema_ AS SilverSchema,
            se.Name AS SilverName
        FROM lz_entities le
        LEFT JOIN datasources ds ON ds.DataSourceId = le.DataSourceId
        LEFT JOIN connections c ON c.ConnectionId = ds.ConnectionId
        LEFT JOIN bronze_entities be ON be.LandingzoneEntityId = le.LandingzoneEntityId
        LEFT JOIN silver_entities se ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        WHERE le.IsActive = 1
        ORDER BY ds.Namespace, le.SourceName
        """
    )


def _ready_entity_rows() -> list[dict]:
    statuses = _status_map()
    cache = _count_cache()
    ready = []

    for row in _entity_rows():
        entity_id = int(row["LandingzoneEntityId"])
        layer_statuses = statuses.get(entity_id, {})
        if not all(_is_success(layer_statuses.get(layer, {}).get("Status")) for layer in LAYER_ORDER):
            continue

        tables = _resolve_physical_tables(row, cache)
        row = dict(row)
        row["_statuses"] = layer_statuses
        row["_tables"] = tables
        row["_row_score"] = sum(int((tables[layer].get("rowCount") or 0) > 0) for layer in LAYER_ORDER)
        row["_silver_rows"] = int(tables["silver"].get("rowCount") or 0)
        ready.append(row)

    ready.sort(
        key=lambda r: (
            -int(r.get("_row_score") or 0),
            -int(r.get("_silver_rows") or 0),
            _norm(r.get("Namespace")).lower(),
            _norm(r.get("SourceName")).lower(),
        )
    )
    return ready


def _pk_columns(row: dict) -> list[str]:
    raw = _norm(row.get("PrimaryKeys"))
    return [part.strip() for part in raw.split(",") if part.strip() and part.strip().upper() != "N/A"]


def _sample_lakehouse_row(table: dict, pk_columns: list[str], pk_value: str | None = None) -> dict | None:
    try:
        import polars as pl
        from dashboard.app.api.routes.data_access import _scan_onelake_table

        lf = _scan_onelake_table(table["lakehouse"], table["schema"], table["table"])
        schema = lf.schema
        filter_col = next((col for col in pk_columns if col in schema), None)
        if pk_value and filter_col:
            lf = lf.filter(pl.col(filter_col).cast(pl.Utf8) == str(pk_value))
        df = lf.head(1).collect()
        if len(df) == 0:
            return None
        return {col: _row_value(value) for col, value in zip(df.columns, df.row(0))}
    except Exception as exc:
        log.debug(
            "Replay sample failed for %s.%s.%s: %s",
            table.get("lakehouse"),
            table.get("schema"),
            table.get("table"),
            exc,
        )
        return None


def _metadata_row(row: dict, layer: str, pk_columns: list[str], pk_value: str | None = None) -> dict:
    pk = pk_value or "sample-row"
    source_name = _norm(row.get("SourceName")) or "Entity"
    base = {
        (pk_columns[0] if pk_columns else "PrimaryKey"): pk,
        "SourceName": source_name,
        "SourceSystem": _norm(row.get("Namespace")) or _norm(row.get("DataSourceName")),
    }
    if layer in {"bronze", "silver"}:
        base["HashedPKColumn"] = hashlib.sha256(str(pk).encode()).hexdigest()[:16]
        base["HashedNonKeyColumns"] = hashlib.md5(source_name.encode()).hexdigest()[:16]
        base["RecordLoadDate"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if layer == "silver":
        base.update({
            "IsCurrent": "true",
            "IsDeleted": "false",
            "Action": "UPSERT",
            "RecordStartDate": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "RecordEndDate": "9999-12-31T00:00:00Z",
        })
    return base


def _sample_rows(row: dict, pk_value: str | None = None) -> tuple[dict[str, dict], str | None, list[str], dict[str, str]]:
    warnings: list[str] = []
    tables = row["_tables"]
    pk_columns = _pk_columns(row)

    # Prefer silver first so replay opens on a row that completed the whole chain.
    silver_row = _sample_lakehouse_row(tables["silver"], pk_columns, pk_value)
    actual_pk = pk_value
    if not actual_pk and silver_row and pk_columns:
        actual_pk = next((_norm(silver_row.get(pk)) for pk in pk_columns if silver_row.get(pk) is not None), None)

    bronze_row = _sample_lakehouse_row(tables["bronze"], pk_columns, actual_pk) if tables["bronze"].get("matched") else None
    landing_row = _sample_lakehouse_row(tables["landing"], pk_columns, actual_pk) if tables["landing"].get("matched") else None

    if not actual_pk and bronze_row and pk_columns:
        actual_pk = next((_norm(bronze_row.get(pk)) for pk in pk_columns if bronze_row.get(pk) is not None), None)
    if not actual_pk and landing_row and pk_columns:
        actual_pk = next((_norm(landing_row.get(pk)) for pk in pk_columns if landing_row.get(pk) is not None), None)
    actual_pk = actual_pk or "metadata-sample"

    source_row = dict(landing_row) if landing_row else None
    rows = {
        "source": source_row or _metadata_row(row, "source", pk_columns, actual_pk),
        "landing": landing_row or _metadata_row(row, "landing", pk_columns, actual_pk),
        "bronze": bronze_row or _metadata_row(row, "bronze", pk_columns, actual_pk),
        "silver": silver_row or _metadata_row(row, "silver", pk_columns, actual_pk),
    }
    row_sources = {
        "source": "landing-cache" if source_row else "metadata",
        "landing": "onelake" if landing_row else "metadata",
        "bronze": "onelake" if bronze_row else "metadata",
        "silver": "onelake" if silver_row else "metadata",
    }

    if not any([landing_row, bronze_row, silver_row]):
        warnings.append(
            "Local OneLake row sampling is unavailable for this entity. Showing metadata-derived replay values."
        )
    elif not silver_row:
        warnings.append(
            "Silver row sample was not readable locally. Replay is using the best available upstream sample."
        )

    return rows, actual_pk, warnings, row_sources


def _interesting_columns(row: dict, limit: int = 6) -> list[str]:
    columns = []
    for key in row:
        normalized = key.lower()
        if normalized in SYSTEM_COLUMNS:
            continue
        columns.append(key)
        if len(columns) >= limit:
            break
    return columns


def _compare_rows(before: dict, after: dict, limit: int = 5) -> dict[str, tuple[str, str]]:
    comparisons: dict[str, tuple[str, str]] = {}
    for key in _interesting_columns(after, limit=20):
        before_key = key if key in before else next((b for b in before if b.replace(" ", "").lower() == key.lower()), None)
        before_value = _row_value(before.get(before_key)) if before_key else ""
        after_value = _row_value(after.get(key))
        if before_value != after_value:
            comparisons[key] = (before_value, after_value)
        if len(comparisons) >= limit:
            break
    if not comparisons:
        for key in _interesting_columns(after, limit=limit):
            comparisons[key] = (_row_value(before.get(key, "")), _row_value(after.get(key)))
    return comparisons


def _step(before: dict[str, str], after: dict[str, str], rules: list[str]) -> dict:
    return {"before": before, "after": after, "rulesRun": rules}


def _build_steps(row: dict, rows: dict[str, dict], pk_value: str) -> list[dict]:
    tables = row["_tables"]
    pk_columns = _pk_columns(row)
    first_pk = pk_columns[0] if pk_columns else "PrimaryKey"
    landing = rows["landing"]
    bronze = rows["bronze"]
    silver = rows["silver"]

    bronze_diffs = _compare_rows(landing, bronze, limit=4)
    silver_diffs = _compare_rows(bronze, silver, limit=4)
    sample_cols = _interesting_columns(landing, limit=3)

    steps: dict[int, dict] = {
        1: _step(
            {col: _row_value(landing.get(col)) for col in sample_cols},
            {col: _row_value(landing.get(col)) for col in sample_cols},
            ["Read completed local layer history", "Use Landing parquet/cache evidence", "No VPN or source query required"],
        ),
        2: _step(
            {col: col for col in sample_cols},
            {col.replace(" ", ""): col.replace(" ", "") for col in sample_cols},
            ["Remove spaces and unsafe characters from column names", "Preserve source column meaning"],
        ),
        3: _step(
            {"PK input": _row_value(landing.get(first_pk, pk_value))},
            {"HashedPKColumn": _row_value(bronze.get("HashedPKColumn", hashlib.sha256(pk_value.encode()).hexdigest()[:16]))},
            ["Hash primary key columns with SHA-256", f"Primary keys: {', '.join(pk_columns) or 'metadata fallback'}"],
        ),
        4: _step(
            {"Landing rows": _row_value(tables["landing"].get("rowCount"))},
            {"Bronze rows": _row_value(tables["bronze"].get("rowCount"))},
            ["Deduplicate by HashedPKColumn", "Keep one canonical row per primary key"],
        ),
        5: _step(
            {key: before for key, (before, _) in bronze_diffs.items()},
            {key: after for key, (_, after) in bronze_diffs.items()},
            ["Apply Bronze cleansing rules", "Normalize values before change hashing"],
        ),
        6: _step(
            {"HashedNonKeyColumns": _row_value(landing.get("HashedNonKeyColumns", "missing"))},
            {"HashedNonKeyColumns": _row_value(bronze.get("HashedNonKeyColumns", "computed"))},
            ["Hash non-key columns after Bronze cleansing", "Use the hash as the change detector"],
        ),
        7: _step(
            {"RecordLoadDate": "missing"},
            {"RecordLoadDate": _row_value(bronze.get("RecordLoadDate", "recorded"))},
            ["Stamp Bronze load time", "Keep run-level write receipt"],
        ),
        8: _step(
            {"Staged Bronze row": _row_value(pk_value)},
            {"Bronze Delta table": f"{_row_value(tables['bronze'].get('rowCount'))} rows"},
            ["Insert new rows", "Update changed rows", "Delete missing rows on full loads"],
        ),
        9: _step(
            {key: before for key, (before, _) in silver_diffs.items()},
            {key: after for key, (_, after) in silver_diffs.items()},
            ["Apply Silver business cleansing", "Convert operational values into consumable values"],
        ),
        10: _step(
            {"Bronze hash": _row_value(bronze.get("HashedNonKeyColumns", "computed"))},
            {"Silver hash": _row_value(silver.get("HashedNonKeyColumns", "computed"))},
            ["Recompute non-key hash after Silver rules"],
        ),
        11: _step(
            {"SCD2 columns": "missing"},
            {
                "IsCurrent": _row_value(silver.get("IsCurrent", "true")),
                "RecordStartDate": _row_value(silver.get("RecordStartDate", "recorded")),
                "RecordEndDate": _row_value(silver.get("RecordEndDate", "9999-12-31T00:00:00Z")),
                "IsDeleted": _row_value(silver.get("IsDeleted", "false")),
            },
            ["Add SCD2 validity columns", "Mark current and historical versions"],
        ),
        12: _step(
            {"Previous hash": _row_value(bronze.get("HashedNonKeyColumns", "prior or none"))},
            {"Action": _row_value(silver.get("Action", "UPSERT"))},
            ["Compare PK hash and non-key hash", "Classify insert/update/delete/no-change"],
        ),
        13: _step(
            {"Silver staged row": _row_value(pk_value)},
            {"Current Silver table": f"{_row_value(tables['silver'].get('rowCount'))} rows"},
            ["Close old versions", "Insert new current versions", "Soft-delete removed rows"],
        ),
    }

    return [{"step": step_id, **payload} for step_id, payload in steps.items()]


def _snapshots(row: dict, rows: dict[str, dict], row_sources: dict[str, str]) -> list[dict]:
    return [
        {
            "layer": "source",
            "title": "Source system",
            "table": f"{_norm(row.get('ServerName')) or 'source'}.{_norm(row.get('SourceSchema'))}.{_norm(row.get('SourceName'))}",
            "receipt": "Source shape inferred from the completed Landing copy. No VPN query is performed.",
            "row": {key: rows["source"][key] for key in _interesting_columns(rows["source"], limit=6)},
            "rules": ["No source query required", "Use loaded Landing evidence"],
            "rowSource": row_sources.get("source", "metadata"),
        },
        {
            "layer": "landing",
            "title": "Landing",
            "table": _display_table(row, "landing"),
            "receipt": "Raw parquet/file copy before Bronze transformations.",
            "row": {key: rows["landing"][key] for key in _interesting_columns(rows["landing"], limit=6)},
            "rules": ["Raw copy", "Preserve source values", "Capture rows and bytes"],
            "rowSource": row_sources.get("landing", "metadata"),
        },
        {
            "layer": "bronze",
            "title": "Bronze",
            "table": _display_table(row, "bronze"),
            "receipt": "Lakehouse-safe table with normalized names, hashes, and load receipt fields.",
            "row": {key: rows["bronze"][key] for key in list(rows["bronze"].keys())[:8]},
            "rules": ["Sanitize columns", "Hash keys", "Deduplicate", "Delta merge"],
            "rowSource": row_sources.get("bronze", "metadata"),
        },
        {
            "layer": "silver",
            "title": "Silver",
            "table": _display_table(row, "silver"),
            "receipt": "Business-consumable, versioned record ready for downstream consumers.",
            "row": {key: rows["silver"][key] for key in list(rows["silver"].keys())[:8]},
            "rules": ["Apply Silver rules", "Recompute hash", "Classify change", "Write SCD2 version"],
            "rowSource": row_sources.get("silver", "metadata"),
        },
    ]


def _entity_payload(row: dict, pk_value: str | None = None) -> dict:
    statuses = row["_statuses"]
    tables = row["_tables"]
    return {
        "id": int(row["LandingzoneEntityId"]),
        "source": _norm(row.get("Namespace")) or _norm(row.get("DataSourceName")),
        "dataSourceName": _norm(row.get("DataSourceName")),
        "tableName": _norm(row.get("SourceName")),
        "sourceSchema": _norm(row.get("SourceSchema")),
        "primaryKeys": _pk_columns(row),
        "pkValue": pk_value,
        "overall": "complete",
        "layers": {
            layer: {
                "status": _norm(statuses.get(layer, {}).get("Status")),
                "lastLoad": statuses.get(layer, {}).get("LoadEndDateTime"),
                "rowCount": tables[layer].get("rowCount"),
                "physicalTableMatched": bool(tables[layer].get("matched")),
            }
            for layer in LAYER_ORDER
        },
        "tables": tables,
    }


@route("GET", "/api/transformation-replay/entities")
def get_transformation_replay_entities(params: dict) -> dict:
    limit = max(1, min(int(params.get("limit", 500) or 500), 2000))
    rows = _ready_entity_rows()
    entities = [_entity_payload(row) for row in rows[:limit]]
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "totalReady": len(rows),
        "entities": entities,
        "note": "Ready means latest canonical engine status succeeded for Landing, Bronze, and Silver.",
    }


@route("GET", "/api/transformation-replay")
def get_transformation_replay(params: dict) -> dict:
    entity_param = _norm(params.get("entity"))
    pk_param = _norm(params.get("pk"))
    rows = _ready_entity_rows()
    if not rows:
        raise HttpError("No replay-ready entities found. Run a successful Landing/Bronze/Silver load first.", 404)

    selected = None
    if entity_param:
        try:
            entity_id = int(entity_param)
        except ValueError:
            raise HttpError("entity must be an integer", 400)
        selected = next((row for row in rows if int(row["LandingzoneEntityId"]) == entity_id), None)
        if not selected:
            raise HttpError(f"Entity {entity_id} is not replay-ready. It must have successful Landing, Bronze, and Silver status.", 404)
    else:
        selected = rows[0]

    sampled_rows, actual_pk, warnings, row_sources = _sample_rows(selected, pk_param or None)
    transformations = _build_steps(selected, sampled_rows, actual_pk or "metadata-sample")
    snapshots = _snapshots(selected, sampled_rows, row_sources)
    used_actual_rows = any(snapshot["rowSource"] == "onelake" for snapshot in snapshots)

    return {
        "mode": "onelake" if used_actual_rows else "metadata",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "entity": _entity_payload(selected, actual_pk),
        "snapshots": snapshots,
        "transformations": transformations,
        "warnings": warnings,
    }
