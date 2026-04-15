"""Canonical user-facing metric contract for Fabric pipeline truth.

The app should answer one question consistently: which tables are in scope for
the managed pipeline, and how far have they actually made it through Landing,
Bronze, and Silver. Internal registration mechanics stay out of the UI.
"""
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from time import monotonic

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route
from dashboard.app.api.routes.entities import _build_sqlite_entity_digest
from dashboard.app.api.routes.load_center import _build_canonical_pipeline_truth


_SUCCESS_STATUSES = {"loaded", "succeeded", "success", "completed", "complete", "idle"}
_FAILURE_STATUSES = {"failed", "error", "aborted", "interrupted"}
_CACHE_TTL_SECONDS = 15.0
_metric_contract_cache: dict | None = None
_metric_contract_cached_at = 0.0
_metric_contract_lock = Lock()


def _is_success(status: str | None) -> bool:
    return str(status or "").strip().lower() in _SUCCESS_STATUSES


def _is_failure(status: str | None) -> bool:
    return str(status or "").strip().lower() in _FAILURE_STATUSES


def _flatten_digest_entities(digest: dict) -> list[dict]:
    entities: list[dict] = []
    for source in digest.get("sources", []):
        entities.extend(source.get("entities", []))
    return entities


def _present_in_layer(layer_key: str, entity: dict, log_lookup: dict[tuple, dict]) -> bool:
    data_source_id = int(entity.get("dataSourceId") or entity.get("DataSourceId") or 0)
    schema = str(entity.get("sourceSchema") or entity.get("schema") or "").strip().lower()
    table = str(entity.get("tableName") or entity.get("table_name") or "").strip().lower()
    if not data_source_id or not schema or not table:
        return False
    return (layer_key, data_source_id, schema, table) in log_lookup


def _is_tool_ready(entity: dict, log_lookup: dict[tuple, dict]) -> bool:
    return bool(entity.get("isActive")) and all([
        _present_in_layer("lz", entity, log_lookup),
        _present_in_layer("bronze", entity, log_lookup),
        _present_in_layer("silver", entity, log_lookup),
        not entity.get("lastError"),
    ])


def _quality_average() -> float:
    conn = cpdb._get_conn()
    try:
        row = conn.execute(
            """
            SELECT AVG(composite_score) AS avg_score
            FROM quality_scores
            WHERE composite_score IS NOT NULL
            """
        ).fetchone()
        if not row or row["avg_score"] is None:
            return 0.0
        return round(float(row["avg_score"]), 1)
    finally:
        conn.close()


def _metric(value: int, label: str, definition: str) -> dict:
    return {"value": value, "label": label, "definition": definition}


def _get_cached_metric_contract(force_refresh: bool) -> dict | None:
    if force_refresh:
        return None
    with _metric_contract_lock:
        if _metric_contract_cache and (monotonic() - _metric_contract_cached_at) < _CACHE_TTL_SECONDS:
            return deepcopy(_metric_contract_cache)
    return None


def _set_cached_metric_contract(contract: dict) -> None:
    with _metric_contract_lock:
        global _metric_contract_cache, _metric_contract_cached_at
        _metric_contract_cache = deepcopy(contract)
        _metric_contract_cached_at = monotonic()


def build_metric_contract(force_refresh: bool = False) -> dict:
    """Return the single metric contract all user-facing pages should follow."""
    cached = _get_cached_metric_contract(force_refresh)
    if cached is not None:
        return cached

    digest = _build_sqlite_entity_digest()
    entities = _flatten_digest_entities(digest)
    active_entities = [entity for entity in entities if entity.get("isActive")]

    truth = _build_canonical_pipeline_truth()
    source_stats = list(truth.get("sourceStats", {}).values())
    log_lookup = truth.get("logLookup", {})
    tool_ready_entities = [entity for entity in active_entities if _is_tool_ready(entity, log_lookup)]
    blocked_entities = [entity for entity in active_entities if not _is_tool_ready(entity, log_lookup)]
    digest_sources = {
        str(source.get("name") or ""): source
        for source in digest.get("sources", [])
        if source.get("name")
    }

    by_source: list[dict] = []
    source_keys = sorted(digest_sources.keys() or truth.get("sourceStats", {}).keys())
    for source_key in source_keys:
        digest_source = digest_sources.get(source_key, {})
        source_entities = [
            entity for entity in digest_source.get("entities", [])
            if entity.get("isActive")
        ]
        source_display = str(
            digest_source.get("displayName")
            or truth.get("sourceStats", {}).get(source_key, {}).get("displayName")
            or source_key
        )
        source_tool_ready = [entity for entity in source_entities if _is_tool_ready(entity, log_lookup)]
        source_blocked = [
            entity for entity in source_entities
            if any([
                _is_failure(entity.get("lzStatus")),
                _is_failure(entity.get("bronzeStatus")),
                _is_failure(entity.get("silverStatus")),
                bool(entity.get("lastError")),
            ])
        ]

        by_source.append({
            "source": source_key,
            "displayName": source_display,
            "tablesInScope": len(source_entities),
            "landingLoaded": sum(1 for entity in source_entities if _present_in_layer("lz", entity, log_lookup)),
            "bronzeLoaded": sum(1 for entity in source_entities if _present_in_layer("bronze", entity, log_lookup)),
            "silverLoaded": sum(1 for entity in source_entities if _present_in_layer("silver", entity, log_lookup)),
            "toolReady": len(source_tool_ready),
            "blocked": max(len(source_blocked), len(source_entities) - len(source_tool_ready)),
        })

    last_success = truth.get("layerLastSuccess", {})

    contract = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "tables": {
            "inScope": _metric(
                len(active_entities),
                "Tables in scope",
                "Active tables the pipeline is expected to carry from source into Fabric.",
            ),
            "landingLoaded": _metric(
                int(truth.get("layerLoaded", {}).get("lz") or 0),
                "Landing loaded",
                "Tables with a successful landing load recorded in the managed Fabric path.",
            ),
            "bronzeLoaded": _metric(
                int(truth.get("layerLoaded", {}).get("bronze") or 0),
                "Bronze loaded",
                "Tables with a successful bronze load recorded in the managed Fabric path.",
            ),
            "silverLoaded": _metric(
                int(truth.get("layerLoaded", {}).get("silver") or 0),
                "Silver loaded",
                "Tables with a successful silver load recorded in the managed Fabric path.",
            ),
            "toolReady": _metric(
                len(tool_ready_entities),
                "Tool-ready",
                "Tables with landing, bronze, and silver loaded and no active pipeline error.",
            ),
            "blocked": _metric(
                len(blocked_entities),
                "Blocked",
                "In-scope tables that have not completed a clean path through the managed layers.",
            ),
        },
        "sources": {
            "total": len(by_source) or len(source_stats),
            "operational": sum(
                1
                for source in by_source
                if int(source.get("tablesInScope") or 0) > 0 and int(source.get("blocked") or 0) == 0
            ),
            "bySource": by_source,
        },
        "quality": {
            "averageScore": _quality_average(),
        },
        "blockers": {
            "open": len(blocked_entities),
        },
        "lastSuccess": {
            "landing": last_success.get("lz"),
            "bronze": last_success.get("bronze"),
            "silver": last_success.get("silver"),
        },
    }
    _set_cached_metric_contract(contract)
    return deepcopy(contract)


@route("GET", "/api/metric-contract")
def get_metric_contract(params: dict) -> dict:
    refresh = str(params.get("refresh") or "").strip().lower() in {"1", "true", "yes", "force"}
    return build_metric_contract(force_refresh=refresh)
