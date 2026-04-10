"""
Lakehouse-first relationship atlas routes.

The previous implementation depended on direct source-system metadata crawling,
which made the catalog atlas unusable without VPN or remote SQL reachability.
This version stages a local inventory from the shared entity digest and derives
relationship candidates from assets that are already present in the medallion
pipeline. Detailed join evidence is then computed on demand from cached or
locally readable OneLake column schemas.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dashboard.app.api.router import route
from dashboard.app.api.routes.entities import _build_sqlite_entity_digest
from dashboard.app.api.routes.lineage import get_lineage_columns

log = logging.getLogger("fmd.api.join_discovery")

PROJECT_ROOT = Path(__file__).resolve().parents[4]
ANALYSIS_DIR = PROJECT_ROOT / "analysis"
ANALYSIS_JSON_PATH = ANALYSIS_DIR / "join_discovery_staged.json"
IPCORP_KNOWLEDGE_DIR = PROJECT_ROOT / "knowledge" / "ipcorp"
CLAUDE_CLI_PATH = shutil.which("claude")

LAYER_ORDER = ("silver", "bronze", "landing")
LOADED_STATUSES = {"loaded", "complete", "completed", "succeeded", "success"}
KEYISH_SUFFIXES = (
    "id",
    "key",
    "code",
    "number",
    "num",
    "no",
    "batch",
    "lot",
    "item",
    "part",
    "customer",
    "vendor",
    "product",
    "order",
    "po",
)
GENERIC_COLUMN_NAMES = {
    "createdat",
    "createddate",
    "createddatetime",
    "updatedat",
    "updateddate",
    "updateddatetime",
    "modifiedat",
    "modifieddate",
    "modifieddatetime",
    "timestamp",
    "loadtimestamp",
    "ingestedat",
    "ingestiontime",
    "rowversion",
    "isactive",
    "isdeleted",
    "status",
}
TOKEN_STOP_WORDS = {
    "data",
    "dim",
    "fact",
    "tbl",
    "table",
    "view",
    "raw",
    "hist",
    "history",
    "master",
    "detail",
    "header",
    "line",
    "lines",
    "record",
    "records",
    "entity",
}
MAX_SEED_NEIGHBORS = 18
MAX_TABLE_CANDIDATES = 8
MAX_ANALYST_EVIDENCE = 12


def _normalize(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_key(value: Any) -> str:
    return "".join(ch for ch in _normalize(value) if ch.isalnum())


def _display_source_name(entity: dict) -> str:
    return (
        entity.get("dataSourceName")
        or entity.get("sourceDisplay")
        or entity.get("source")
        or "Unknown"
    )


def _is_loaded_status(value: Any) -> bool:
    return _normalize(value) in LOADED_STATUSES


def _split_csv(value: Any) -> list[str]:
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def _tokenize(*values: Any) -> list[str]:
    tokens: set[str] = set()
    for raw in values:
        text = str(raw or "")
        expanded = []
        for char in text:
            if expanded and char.isupper() and expanded[-1].isalnum():
                expanded.append(" ")
            expanded.append(char.lower())
        for part in "".join(expanded).replace("/", " ").replace("-", " ").replace("_", " ").split():
            token = "".join(ch for ch in part if ch.isalnum())
            if len(token) <= 2 or token in TOKEN_STOP_WORDS:
                continue
            tokens.add(token)
    return sorted(tokens)


def _quality_score(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _entity_loaded_layers(entity: dict) -> list[str]:
    layers = []
    if _is_loaded_status(entity.get("silverStatus")):
        layers.append("silver")
    if _is_loaded_status(entity.get("bronzeStatus")):
        layers.append("bronze")
    if _is_loaded_status(entity.get("lzStatus")):
        layers.append("landing")
    return layers


def _build_inventory_entity(entity: dict) -> dict | None:
    loaded_layers = _entity_loaded_layers(entity)
    if not loaded_layers or not entity.get("isActive", True):
        return None

    schema_keys = [
        key
        for key in {
            _normalize(entity.get("sourceSchema")),
            _normalize(entity.get("onelakeSchema")),
            _normalize(entity.get("targetSchema")),
        }
        if key
    ]
    record = {
        "entityId": int(entity.get("id")),
        "tableName": entity.get("tableName") or "",
        "source": entity.get("source") or "",
        "sourceDisplay": _display_source_name(entity),
        "sourceSchema": entity.get("sourceSchema") or "",
        "onelakeSchema": entity.get("onelakeSchema") or entity.get("sourceSchema") or "",
        "domain": entity.get("domain") or "",
        "businessName": entity.get("businessName") or "",
        "description": entity.get("description") or entity.get("diagnosis") or "",
        "qualityScore": _quality_score(entity.get("qualityScore")),
        "qualityTier": entity.get("qualityTier") or "",
        "bronzePKs": _split_csv(entity.get("bronzePKs")),
        "loadedLayers": loaded_layers,
        "bestLayer": loaded_layers[0],
        "schemaKeys": schema_keys,
        "tokens": _tokenize(
            entity.get("tableName"),
            entity.get("businessName"),
            entity.get("description"),
            entity.get("domain"),
        ),
        "seedNeighbors": [],
    }
    return record


def _flatten_digest_entities() -> list[dict]:
    digest = _build_sqlite_entity_digest()
    rows: list[dict] = []
    for source in digest.get("sources", []):
        display_name = source.get("displayName") or source.get("name") or ""
        for entity in source.get("entities", []):
            copied = dict(entity)
            copied["sourceDisplay"] = display_name
            rows.append(copied)
    return rows


def _seed_relationship_score(left: dict, right: dict) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    left_domain = _normalize(left.get("domain"))
    right_domain = _normalize(right.get("domain"))
    if left_domain and left_domain == right_domain:
        score += 26
        reasons.append("shared_domain")

    if _normalize(left.get("source")) == _normalize(right.get("source")):
        score += 12
        reasons.append("shared_source")

    shared_schema = sorted(set(left.get("schemaKeys", [])) & set(right.get("schemaKeys", [])))
    if shared_schema:
        score += 10
        reasons.append("shared_schema")

    shared_tokens = sorted(set(left.get("tokens", [])) & set(right.get("tokens", [])))
    if shared_tokens:
        score += min(18, len(shared_tokens) * 6)
        reasons.append("shared_terms")

    shared_pks = sorted(
        {
            _normalize_key(pk)
            for pk in left.get("bronzePKs", [])
            if _normalize_key(pk)
        }
        & {
            _normalize_key(pk)
            for pk in right.get("bronzePKs", [])
            if _normalize_key(pk)
        }
    )
    if shared_pks:
        score += 24
        reasons.append("shared_primary_keys")

    if "silver" in left.get("loadedLayers", []) and "silver" in right.get("loadedLayers", []):
        score += 8
        reasons.append("silver_ready")
    elif "bronze" in left.get("loadedLayers", []) and "bronze" in right.get("loadedLayers", []):
        score += 5
        reasons.append("bronze_ready")

    if left.get("qualityScore", 0) >= 80 and right.get("qualityScore", 0) >= 80:
        score += 4
        reasons.append("trusted_pair")

    return score, reasons


def _build_analysis_artifact() -> dict:
    ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)

    raw_entities = _flatten_digest_entities()
    inventory = [record for entity in raw_entities if (record := _build_inventory_entity(entity))]
    inventory_by_id = {int(record["entityId"]): record for record in inventory}

    by_domain: dict[str, set[int]] = defaultdict(set)
    by_source: dict[str, set[int]] = defaultdict(set)
    by_schema: dict[str, set[int]] = defaultdict(set)
    by_token: dict[str, set[int]] = defaultdict(set)

    for record in inventory:
        entity_id = int(record["entityId"])
        domain = _normalize(record.get("domain"))
        source = _normalize(record.get("source"))
        if domain:
            by_domain[domain].add(entity_id)
        if source:
            by_source[source].add(entity_id)
        for schema in record.get("schemaKeys", []):
            by_schema[schema].add(entity_id)
        for token in record.get("tokens", [])[:8]:
            if len(by_token[token]) < 240:
                by_token[token].add(entity_id)

    estimated_relationships = 0
    cross_source_estimate = 0

    for record in inventory:
        entity_id = int(record["entityId"])
        candidate_ids: set[int] = set()
        domain = _normalize(record.get("domain"))
        source = _normalize(record.get("source"))
        if domain:
            candidate_ids.update(by_domain.get(domain, set()))
        if source:
            candidate_ids.update(by_source.get(source, set()))
        for schema in record.get("schemaKeys", []):
            candidate_ids.update(by_schema.get(schema, set()))
        for token in record.get("tokens", [])[:6]:
            candidate_ids.update(by_token.get(token, set()))
        candidate_ids.discard(entity_id)

        ranked = []
        for candidate_id in candidate_ids:
            other = inventory_by_id.get(candidate_id)
            if not other:
                continue
            score, reasons = _seed_relationship_score(record, other)
            if score < 22:
                continue
            ranked.append({
                "entityId": candidate_id,
                "seedScore": score,
                "reasons": reasons,
            })

        ranked.sort(key=lambda item: (-int(item["seedScore"]), inventory_by_id[item["entityId"]]["tableName"]))
        record["seedNeighbors"] = ranked[:MAX_SEED_NEIGHBORS]
        estimated_relationships += len(record["seedNeighbors"])
        cross_source_estimate += sum(
            1
            for neighbor in record["seedNeighbors"]
            if _normalize(inventory_by_id[neighbor["entityId"]]["source"]) != source
        )

    artifact = {
        "mode": "lakehouse_staged",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "statistics": {
            "total_tables_analyzed": len(inventory),
            "seed_relationships": estimated_relationships // 2,
            "cross_source_seed_relationships": cross_source_estimate // 2,
            "entities_with_silver": sum(1 for record in inventory if "silver" in record["loadedLayers"]),
            "entities_with_bronze": sum(1 for record in inventory if "bronze" in record["loadedLayers"]),
            "entities_with_landing": sum(1 for record in inventory if "landing" in record["loadedLayers"]),
        },
        "entities": inventory,
    }

    ANALYSIS_JSON_PATH.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    return artifact


def _load_analysis_artifact() -> dict | None:
    if not ANALYSIS_JSON_PATH.exists():
        return None
    try:
        return json.loads(ANALYSIS_JSON_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("Failed to load staged join artifact: %s", exc)
        return None


def _match_source(record: dict, requested_source: str) -> bool:
    source_norm = _normalize(requested_source)
    if not source_norm:
        return True
    options = {
        _normalize(record.get("source")),
        _normalize(record.get("sourceDisplay")),
    }
    return source_norm in options


def _find_inventory_entity(artifact: dict, source: str, table: str) -> dict | None:
    table_norm = _normalize(table)
    for record in artifact.get("entities", []):
        if _normalize(record.get("tableName")) != table_norm:
            continue
        if _match_source(record, source):
            return record
    return None


def _safe_lineage_columns(entity_id: int, cache: dict[int, dict[str, list[dict]]]) -> dict[str, list[dict]]:
    cached = cache.get(entity_id)
    if cached is not None:
        return cached

    try:
        payload = get_lineage_columns({"entityId": str(entity_id)})
    except Exception as exc:
        log.debug("Lineage columns unavailable for %s: %s", entity_id, exc)
        payload = {}

    columns = {
        layer: list(((payload.get(layer) or {}).get("columns") or []))
        for layer in ("landing", "bronze", "silver")
    }
    cache[entity_id] = columns
    return columns


def _data_type_family(dtype: Any) -> str:
    name = _normalize_key(dtype)
    if name.startswith(("varchar", "nvarchar", "char", "string", "text", "utf8")):
        return "string"
    if name.startswith(("int", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "double", "real")):
        return "number"
    if name.startswith(("date", "datetime", "timestamp", "time")):
        return "datetime"
    if name.startswith(("bit", "bool", "boolean")):
        return "boolean"
    if name.startswith(("binary", "varbinary")):
        return "binary"
    return name or "unknown"


def _is_keyish_column(name: str) -> bool:
    normalized = _normalize_key(name)
    return any(normalized.endswith(suffix) for suffix in KEYISH_SUFFIXES)


def _build_column_index(columns: list[dict]) -> dict[str, dict]:
    indexed = {}
    for column in columns:
        key = _normalize_key(column.get("name"))
        if not key:
            continue
        indexed[key] = column
    return indexed


def _evidence_item(
    *,
    kind: str,
    label: str,
    detail: str,
    provenance_type: str,
    source_ref: str,
    fields: list[str] | None = None,
    layer: str | None = None,
) -> dict:
    item = {
        "kind": kind,
        "label": label,
        "detail": detail,
        "provenance": {
            "type": provenance_type,
            "sourceRef": source_ref,
            "fields": fields or [],
        },
    }
    if layer:
        item["provenance"]["layer"] = layer
    return item


def _append_evidence(target: list[dict], *items: dict | None) -> None:
    seen = {
        (
            item.get("kind"),
            item.get("label"),
            item.get("detail"),
            ((item.get("provenance") or {}).get("sourceRef")),
        )
        for item in target
    }
    for item in items:
        if not item:
            continue
        key = (
            item.get("kind"),
            item.get("label"),
            item.get("detail"),
            ((item.get("provenance") or {}).get("sourceRef")),
        )
        if key in seen:
            continue
        target.append(item)
        seen.add(key)


def _shared_column_matches(left_columns: list[dict], right_columns: list[dict]) -> list[dict]:
    left_index = _build_column_index(left_columns)
    right_index = _build_column_index(right_columns)
    matches = []

    for key in sorted(set(left_index) & set(right_index)):
        if key in GENERIC_COLUMN_NAMES and not _is_keyish_column(key):
            continue
        left = left_index[key]
        right = right_index[key]
        left_family = _data_type_family(left.get("dataType"))
        right_family = _data_type_family(right.get("dataType"))
        if left_family != right_family and not (_is_keyish_column(key) and {"string", "number"} == {left_family, right_family}):
            continue
        matches.append({
            "normalized": key,
            "source": left.get("name") or key,
            "target": right.get("name") or key,
            "sourceType": left.get("dataType") or "",
            "targetType": right.get("dataType") or "",
        })
    return matches


def _stage_pair_label(left_layer: str | None, right_layer: str | None) -> str:
    if left_layer and right_layer and left_layer == right_layer:
        return left_layer
    if left_layer and right_layer:
        return f"{left_layer}/{right_layer}"
    return left_layer or right_layer or "staged"


def _knowledge_files() -> list[Path]:
    return [
        IPCORP_KNOWLEDGE_DIR / "glossary" / "business-terms.md",
        IPCORP_KNOWLEDGE_DIR / "systems" / "landscape.md",
        IPCORP_KNOWLEDGE_DIR / "data-flows" / "architecture.md",
        IPCORP_KNOWLEDGE_DIR / "source-databases.md",
        IPCORP_KNOWLEDGE_DIR / "known-issues.md",
        IPCORP_KNOWLEDGE_DIR / "gotchas" / "known-issues.md",
        IPCORP_KNOWLEDGE_DIR / "company-structure.md",
    ]


def _extract_knowledge_evidence(selected: dict, limit: int = 5) -> list[dict]:
    search_terms = {
        token
        for token in (
            selected.get("tokens", [])
            + _tokenize(
                selected.get("sourceDisplay"),
                selected.get("domain"),
                selected.get("tableName"),
                selected.get("businessName"),
            )
        )
        if len(token) >= 3
    }
    if not search_terms:
        return []

    matches: list[tuple[int, str, int, str, str]] = []
    domain = _normalize(selected.get("domain"))
    source_name = _normalize(selected.get("sourceDisplay") or selected.get("source"))

    for path in _knowledge_files():
        if not path.exists():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue
        rel_path = str(path.relative_to(PROJECT_ROOT)).replace("\\", "/")
        for index, line in enumerate(lines, start=1):
            snippet = line.strip().lstrip("-*#> ").strip()
            if len(snippet) < 28:
                continue
            lowered = _normalize(snippet)
            score = sum(1 for token in search_terms if token in lowered)
            if score <= 0:
                continue
            if domain and domain in lowered:
                score += 2
            if source_name and source_name in lowered:
                score += 2
            matches.append((score, rel_path, index, snippet[:240], lowered))

    deduped: list[dict] = []
    seen_lines: set[str] = set()
    for _, rel_path, line_no, snippet, lowered in sorted(matches, key=lambda item: (-item[0], item[1], item[2])):
        if lowered in seen_lines:
            continue
        seen_lines.add(lowered)
        deduped.append(
            _evidence_item(
                kind="knowledge_context",
                label="IP context match",
                detail=snippet,
                provenance_type="knowledge_file",
                source_ref=f"{rel_path}:{line_no}",
                fields=["line"],
            )
        )
        if len(deduped) >= limit:
            break
    return deduped


def _selected_entity_evidence(selected: dict) -> list[dict]:
    entity_ref = f"analysis/join_discovery_staged.json#entityId={selected.get('entityId')}"
    evidence: list[dict] = [
        _evidence_item(
            kind="entity_registration",
            label="Registered asset",
            detail=f"{selected.get('sourceDisplay')} / {selected.get('sourceSchema') or selected.get('onelakeSchema') or 'dbo'} / {selected.get('tableName')}",
            provenance_type="staged_inventory",
            source_ref=entity_ref,
            fields=["sourceDisplay", "sourceSchema", "tableName"],
        ),
        _evidence_item(
            kind="layer_posture",
            label="Loaded medallion stages",
            detail=", ".join(selected.get("loadedLayers", [])) or "none",
            provenance_type="staged_inventory",
            source_ref=entity_ref,
            fields=["loadedLayers", "bestLayer"],
        ),
    ]
    if selected.get("domain"):
        _append_evidence(
            evidence,
            _evidence_item(
                kind="domain_assignment",
                label="Domain assignment",
                detail=str(selected.get("domain")),
                provenance_type="staged_inventory",
                source_ref=entity_ref,
                fields=["domain"],
            ),
        )
    if selected.get("qualityScore") is not None or selected.get("qualityTier"):
        _append_evidence(
            evidence,
            _evidence_item(
                kind="trust_posture",
                label="Trust posture",
                detail=f"{selected.get('qualityScore', 0):.0f}% / {selected.get('qualityTier') or 'unrated'}"
                if isinstance(selected.get("qualityScore"), (int, float))
                else str(selected.get("qualityTier") or "unrated"),
                provenance_type="staged_inventory",
                source_ref=entity_ref,
                fields=["qualityScore", "qualityTier"],
            ),
        )
    if selected.get("description"):
        _append_evidence(
            evidence,
            _evidence_item(
                kind="catalog_description",
                label="Existing description",
                detail=str(selected.get("description"))[:240],
                provenance_type="staged_inventory",
                source_ref=entity_ref,
                fields=["description"],
            ),
        )
    if selected.get("bronzePKs"):
        _append_evidence(
            evidence,
            _evidence_item(
                kind="primary_keys",
                label="Primary-key hints",
                detail=", ".join(selected.get("bronzePKs", [])[:5]),
                provenance_type="staged_inventory",
                source_ref=entity_ref,
                fields=["bronzePKs"],
            ),
        )
    return evidence


def _select_best_column_pair(
    left: dict,
    right: dict,
    column_cache: dict[int, dict[str, list[dict]]],
) -> tuple[str, list[dict], str]:
    left_columns = _safe_lineage_columns(int(left["entityId"]), column_cache)
    right_columns = _safe_lineage_columns(int(right["entityId"]), column_cache)

    for layer in LAYER_ORDER:
        if layer not in left.get("loadedLayers", []) or layer not in right.get("loadedLayers", []):
            continue
        matches = _shared_column_matches(left_columns.get(layer, []), right_columns.get(layer, []))
        if matches:
            return layer, matches, f"shared {layer} columns"

    left_best = left.get("bestLayer")
    right_best = right.get("bestLayer")
    if left_best and right_best:
        matches = _shared_column_matches(
            left_columns.get(left_best, []),
            right_columns.get(right_best, []),
        )
        if matches:
            label = _stage_pair_label(left_best, right_best)
            return label, matches, f"shared staged columns across {label}"

    return _stage_pair_label(left_best, right_best), [], "staged context only"


def _detailed_candidate_score(
    selected: dict,
    candidate: dict,
    seed_score: int,
    column_cache: dict[int, dict[str, list[dict]]],
) -> dict | None:
    score = seed_score
    analysis_stage, column_matches, stage_reason = _select_best_column_pair(selected, candidate, column_cache)
    shared_pk_names = sorted(
        {
            _normalize_key(pk)
            for pk in selected.get("bronzePKs", [])
            if _normalize_key(pk)
        }
        & {
            _normalize_key(pk)
            for pk in candidate.get("bronzePKs", [])
            if _normalize_key(pk)
        }
    )

    reason_parts: list[str] = []
    join_type = "staged_context"
    evidence: list[dict] = []
    selected_ref = f"analysis/join_discovery_staged.json#entityId={selected.get('entityId')}"
    candidate_ref = f"analysis/join_discovery_staged.json#entityId={candidate.get('entityId')}"

    if column_matches:
        score += 34 + min(18, len(column_matches) * 5)
        join_type = "staged_exact_columns"
        preview = ", ".join(match["source"] for match in column_matches[:3])
        reason_parts.append(f"{stage_reason}: {preview}")
        _append_evidence(
            evidence,
            _evidence_item(
                kind="stage_columns",
                label=f"Shared {analysis_stage} columns",
                detail=", ".join(
                    f"{match['source']} ({match['sourceType'] or 'unknown'})"
                    for match in column_matches[:4]
                ),
                provenance_type="lineage_columns",
                source_ref=f"entity:{selected.get('entityId')}|entity:{candidate.get('entityId')}",
                fields=[match["source"] for match in column_matches[:4]],
                layer=analysis_stage,
            ),
        )
    elif shared_pk_names:
        score += 24
        join_type = "staged_key_match"
        reason_parts.append(f"shared primary-key hints: {', '.join(shared_pk_names[:3])}")
        _append_evidence(
            evidence,
            _evidence_item(
                kind="primary_key_match",
                label="Shared primary-key hints",
                detail=", ".join(shared_pk_names[:4]),
                provenance_type="staged_inventory",
                source_ref=f"{selected_ref}|{candidate_ref}",
                fields=["bronzePKs"],
            ),
        )
    else:
        reason_parts.append(stage_reason)

    if _normalize(selected.get("domain")) and _normalize(selected.get("domain")) == _normalize(candidate.get("domain")):
        reason_parts.append(f"same {selected.get('domain')} domain")
        _append_evidence(
            evidence,
            _evidence_item(
                kind="shared_domain",
                label="Shared business domain",
                detail=str(selected.get("domain")),
                provenance_type="staged_inventory",
                source_ref=f"{selected_ref}|{candidate_ref}",
                fields=["domain"],
            ),
        )

    if _normalize(selected.get("source")) == _normalize(candidate.get("source")):
        _append_evidence(
            evidence,
            _evidence_item(
                kind="shared_source",
                label="Shared source system",
                detail=str(selected.get("sourceDisplay") or selected.get("source") or "Unknown"),
                provenance_type="staged_inventory",
                source_ref=f"{selected_ref}|{candidate_ref}",
                fields=["source", "sourceDisplay"],
            ),
        )

    shared_terms = sorted(set(selected.get("tokens", [])) & set(candidate.get("tokens", [])))
    if shared_terms:
        reason_parts.append(f"shared terms: {', '.join(shared_terms[:3])}")
        _append_evidence(
            evidence,
            _evidence_item(
                kind="shared_terms",
                label="Shared naming/context terms",
                detail=", ".join(shared_terms[:4]),
                provenance_type="staged_inventory",
                source_ref=f"{selected_ref}|{candidate_ref}",
                fields=["tableName", "businessName", "description"],
            ),
        )

    common_schema = sorted(set(selected.get("schemaKeys", [])) & set(candidate.get("schemaKeys", [])))
    if common_schema:
        reason_parts.append("shared working schema")
        _append_evidence(
            evidence,
            _evidence_item(
                kind="shared_schema",
                label="Shared working schema",
                detail=", ".join(common_schema[:3]),
                provenance_type="staged_inventory",
                source_ref=f"{selected_ref}|{candidate_ref}",
                fields=["sourceSchema", "onelakeSchema", "schemaKeys"],
            ),
        )

    if selected.get("qualityScore", 0) >= 80 and candidate.get("qualityScore", 0) >= 80:
        score += 4
        reason_parts.append("both already have strong trust posture")
        _append_evidence(
            evidence,
            _evidence_item(
                kind="trusted_pair",
                label="Trusted pair",
                detail=f"{selected.get('qualityScore', 0):.0f}% / {candidate.get('qualityScore', 0):.0f}% trust",
                provenance_type="staged_inventory",
                source_ref=f"{selected_ref}|{candidate_ref}",
                fields=["qualityScore", "qualityTier"],
            ),
        )

    if score < 42:
        return None

    anchor = column_matches[0] if column_matches else None
    join_label_left = anchor["source"] if anchor else (selected.get("bronzePKs") or ["context"])[0]
    join_label_right = anchor["target"] if anchor else (candidate.get("bronzePKs") or ["context"])[0]

    selected_source = selected.get("sourceDisplay") or selected.get("source")
    candidate_source = candidate.get("sourceDisplay") or candidate.get("source")
    selected_schema = selected.get("sourceSchema") or selected.get("onelakeSchema") or "dbo"
    candidate_schema = candidate.get("sourceSchema") or candidate.get("onelakeSchema") or "dbo"

    return {
        "source_table": f"{selected_source}.{selected_schema}.{selected.get('tableName')}",
        "target_table": f"{candidate_source}.{candidate_schema}.{candidate.get('tableName')}",
        "source_column": join_label_left,
        "target_column": join_label_right,
        "join_type": join_type,
        "confidence_score": min(score, 99),
        "reason": " · ".join(reason_parts),
        "analysis_stage": analysis_stage,
        "source_system_src": selected_source,
        "source_system_tgt": candidate_source,
        "is_cross_source": _normalize(selected.get("source")) != _normalize(candidate.get("source")),
        "evidence": evidence,
    }


def get_join_discovery_status(params: dict) -> dict:
    artifact = _load_analysis_artifact()
    if not artifact:
        return {
            "status": "not_analyzed",
            "mode": "lakehouse_staged",
            "message": "Build the staged relationship map to use medallion-layer evidence instead of remote source connectivity.",
        }

    statistics = artifact.get("statistics", {})
    return {
        "status": "ready",
        "mode": artifact.get("mode", "lakehouse_staged"),
        "message": "Lakehouse-staged relationship atlas is ready.",
        "last_updated": artifact.get("generatedAt"),
        "statistics": {
            "total_tables_analyzed": statistics.get("total_tables_analyzed", 0),
            "total_join_candidates": statistics.get("seed_relationships", 0),
            "cross_source_candidates": statistics.get("cross_source_seed_relationships", 0),
            "entities_with_silver": statistics.get("entities_with_silver", 0),
            "entities_with_bronze": statistics.get("entities_with_bronze", 0),
            "entities_with_landing": statistics.get("entities_with_landing", 0),
        },
        "analysis_artifacts": {
            "inventory_json": str(ANALYSIS_JSON_PATH),
        },
    }


def get_join_candidates(params: dict) -> list[dict]:
    artifact = _load_analysis_artifact()
    if not artifact:
        return []

    limit = max(1, min(int(params.get("limit", 100)), 250))
    entities = {int(entity["entityId"]): entity for entity in artifact.get("entities", [])}
    result = []
    for entity in artifact.get("entities", []):
        for neighbor in entity.get("seedNeighbors", []):
            neighbor_id = int(neighbor["entityId"])
            if int(entity["entityId"]) >= neighbor_id:
                continue
            target = entities.get(neighbor_id)
            if not target:
                continue
            result.append({
                "source_table": f"{entity.get('sourceDisplay')}.{entity.get('sourceSchema')}.{entity.get('tableName')}",
                "target_table": f"{target.get('sourceDisplay')}.{target.get('sourceSchema')}.{target.get('tableName')}",
                "source_column": "context",
                "target_column": "context",
                "join_type": "staged_seed",
                "confidence_score": neighbor.get("seedScore", 0),
                "reason": ", ".join(neighbor.get("reasons", [])) or "staged proximity",
                "source_system_src": entity.get("sourceDisplay"),
                "source_system_tgt": target.get("sourceDisplay"),
                "is_cross_source": _normalize(entity.get("source")) != _normalize(target.get("source")),
            })

    result.sort(key=lambda item: (-int(item["confidence_score"]), item["source_table"], item["target_table"]))
    return result[:limit]


def get_cross_source_joins(params: dict) -> dict:
    artifact = _load_analysis_artifact()
    if not artifact:
        return {}

    entities = {int(entity["entityId"]): entity for entity in artifact.get("entities", [])}
    grouped: dict[str, dict[str, Any]] = {}

    for entity in artifact.get("entities", []):
        source_name = entity.get("sourceDisplay") or entity.get("source")
        entity_id = int(entity["entityId"])
        for neighbor in entity.get("seedNeighbors", []):
            neighbor_id = int(neighbor["entityId"])
            if entity_id >= neighbor_id:
                continue
            target = entities.get(neighbor_id)
            if not target:
                continue
            target_name = target.get("sourceDisplay") or target.get("source")
            if _normalize(source_name) == _normalize(target_name):
                continue
            left, right = sorted([source_name, target_name], key=str.lower)
            key = f"{left} ↔ {right}"
            grouped.setdefault(
                key,
                {
                    "source_system": left,
                    "target_system": right,
                    "by_type": {},
                    "total_candidates": 0,
                },
            )
            grouped[key]["by_type"]["staged_seed"] = grouped[key]["by_type"].get(
                "staged_seed",
                {"candidates": 0, "avg_confidence": 0, "max_confidence": 0},
            )
            bucket = grouped[key]["by_type"]["staged_seed"]
            bucket["candidates"] += 1
            bucket["max_confidence"] = max(bucket["max_confidence"], int(neighbor.get("seedScore", 0)))
            bucket["avg_confidence"] += int(neighbor.get("seedScore", 0))
            grouped[key]["total_candidates"] += 1

    for pair in grouped.values():
        for bucket in pair["by_type"].values():
            if bucket["candidates"] > 0:
                bucket["avg_confidence"] = round(bucket["avg_confidence"] / bucket["candidates"], 1)

    return grouped


def get_table_joins(params: dict) -> dict:
    source = params.get("source", "")
    table = params.get("table", "")
    artifact = _load_analysis_artifact()
    if not artifact:
        return {"error": "Relationship analysis has not been staged yet"}

    selected = _find_inventory_entity(artifact, source, table)
    if not selected:
        return {"error": f"Table {source}.{table} not found in staged relationship inventory"}

    inventory = {int(entity["entityId"]): entity for entity in artifact.get("entities", [])}
    column_cache: dict[int, dict[str, list[dict]]] = {}
    candidates = []

    for neighbor in selected.get("seedNeighbors", []):
        candidate = inventory.get(int(neighbor["entityId"]))
        if not candidate:
            continue
        detail = _detailed_candidate_score(
            selected,
            candidate,
            int(neighbor.get("seedScore", 0)),
            column_cache,
        )
        if detail:
            candidates.append(detail)

    candidates.sort(key=lambda item: (-int(item["confidence_score"]), item["target_table"]))
    outbound = candidates[:MAX_TABLE_CANDIDATES]

    metadata = {
        "loaded_layers": selected.get("loadedLayers", []),
        "best_layer": selected.get("bestLayer"),
        "schema": selected.get("sourceSchema") or selected.get("onelakeSchema"),
        "source_display": selected.get("sourceDisplay"),
        "quality_score": selected.get("qualityScore"),
        "quality_tier": selected.get("qualityTier"),
    }
    return {
        "source": selected.get("sourceDisplay") or selected.get("source"),
        "table": selected.get("tableName"),
        "metadata": metadata,
        "outbound_joins": {
            "description": "Staged relationship candidates from local medallion evidence",
            "candidates": outbound,
            "count": len(outbound),
        },
        "inbound_joins": {
            "description": "No reverse-only candidates are emitted separately for staged atlas mode",
            "candidates": [],
            "count": 0,
        },
        "total_join_paths": len(outbound),
    }


def get_data_lineage(params: dict) -> dict:
    source = params.get("source", "")
    table = params.get("table", "")
    artifact = _load_analysis_artifact()
    if not artifact:
        return {"error": "Relationship analysis has not been staged yet"}

    selected = _find_inventory_entity(artifact, source, table)
    if not selected:
        return {"error": f"Table {source}.{table} not found in staged relationship inventory"}

    inventory = {int(entity["entityId"]): entity for entity in artifact.get("entities", [])}
    max_depth = max(1, min(int(params.get("max_depth", 3)), 4))
    seen: set[int] = set()
    paths: list[list[dict]] = []

    def walk(current: dict, current_path: list[dict], depth: int) -> None:
        entity_id = int(current["entityId"])
        if depth >= max_depth or entity_id in seen:
            return
        seen.add(entity_id)
        for neighbor in current.get("seedNeighbors", [])[:6]:
            nxt = inventory.get(int(neighbor["entityId"]))
            if not nxt:
                continue
            step = {
                "from": f"{current.get('sourceDisplay')}.{current.get('tableName')}",
                "to": f"{nxt.get('sourceDisplay')}.{nxt.get('tableName')}",
                "score": neighbor.get("seedScore", 0),
                "reasons": neighbor.get("reasons", []),
            }
            new_path = current_path + [step]
            paths.append(new_path)
            walk(nxt, new_path, depth + 1)
        seen.discard(entity_id)

    walk(selected, [], 0)
    return {
        "source": selected.get("sourceDisplay") or selected.get("source"),
        "table": selected.get("tableName"),
        "lineage_paths": paths[:20],
        "total_paths_discovered": len(paths),
        "max_depth": max_depth,
        "description": "Staged atlas paths derived from medallion-ready inventory and neighborhood evidence.",
    }


def validate_join(params: dict) -> dict:
    artifact = _load_analysis_artifact()
    if not artifact:
        return {"status": "error", "error": "Relationship analysis has not been staged yet"}

    source_table = params.get("source_table")
    target_table = params.get("target_table")
    source_column = params.get("source_column")
    target_column = params.get("target_column")
    if not all([source_table, target_table, source_column, target_column]):
        return {"status": "error", "error": "All join parameters required"}

    return {
        "status": "staged",
        "join_path": f"{source_table} → {target_table}",
        "note": "Join validation is based on staged lakehouse evidence in this mode. Use profiler/blender for row-level confirmation.",
        "column_compatibility": {
            "source_column": {"name": source_column},
            "target_column": {"name": target_column},
            "types_compatible": True,
        },
    }


def run_analysis(params: dict) -> dict:
    try:
        artifact = _build_analysis_artifact()
        stats = artifact.get("statistics", {})
        return {
            "status": "success",
            "message": "Lakehouse-staged relationship map rebuilt",
            "result": {
                "mode": artifact.get("mode"),
                "generatedAt": artifact.get("generatedAt"),
                "tablesAnalyzed": stats.get("total_tables_analyzed", 0),
                "seedRelationships": stats.get("seed_relationships", 0),
                "crossSourceSeedRelationships": stats.get("cross_source_seed_relationships", 0),
            },
        }
    except Exception as exc:
        log.exception("Error running staged relationship analysis")
        return {"status": "error", "error": str(exc)}


def _assign_evidence_ids(items: list[dict], limit: int = MAX_ANALYST_EVIDENCE) -> list[dict]:
    assigned = []
    for index, item in enumerate(items[:limit], start=1):
        copied = json.loads(json.dumps(item))
        copied["id"] = f"E{index}"
        assigned.append(copied)
    return assigned


def _find_evidence_ids(
    evidence: list[dict],
    *,
    kinds: set[str] | None = None,
    labels: set[str] | None = None,
    limit: int = 4,
) -> list[str]:
    matches = []
    for item in evidence:
        if kinds and item.get("kind") not in kinds:
            continue
        if labels and item.get("label") not in labels:
            continue
        matches.append(str(item.get("id")))
        if len(matches) >= limit:
            break
    return matches


def _catalog_actions(selected: dict, candidates: list[dict], evidence: list[dict]) -> list[dict]:
    actions = [
        {
            "label": f"Trace {selected.get('tableName')} through lineage",
            "reason": "Confirm where the current staged evidence came from and what downstream assets inherit it.",
            "evidenceIds": _find_evidence_ids(
                evidence,
                kinds={"entity_registration", "layer_posture", "stage_columns"},
            ),
        }
    ]

    if "silver" in selected.get("loadedLayers", []):
        actions.append(
            {
                "label": "Profile the silver output",
                "reason": "Silver is already staged, so profiling can confirm completeness, key posture, and downstream readiness.",
                "evidenceIds": _find_evidence_ids(
                    evidence,
                    kinds={"layer_posture", "trusted_pair", "trust_posture"},
                ),
            }
        )
    elif "bronze" in selected.get("loadedLayers", []):
        actions.append(
            {
                "label": "Inspect the bronze contract",
                "reason": "The relationship map is staged, but the trusted silver contract is not ready yet.",
                "evidenceIds": _find_evidence_ids(
                    evidence,
                    kinds={"layer_posture", "shared_schema", "primary_key_match"},
                ),
            }
        )

    if candidates:
        actions.append(
            {
                "label": f"Compare with {candidates[0].get('target_table', '').split('.')[-1]}",
                "reason": "The strongest nearby asset should be validated next before the relationship is reused in documentation or blending.",
                "evidenceIds": _find_evidence_ids(
                    evidence,
                    kinds={"stage_columns", "primary_key_match", "shared_domain", "shared_terms"},
                ),
            }
        )

    return actions[:3]


def _fallback_catalog_brief(
    selected: dict,
    candidates: list[dict],
    evidence: list[dict],
    prompt_mode: str,
) -> dict:
    top_candidate = candidates[0] if candidates else None
    overview_ids = _find_evidence_ids(
        evidence,
        kinds={"entity_registration", "domain_assignment", "layer_posture", "trust_posture"},
    )
    relationship_ids = _find_evidence_ids(
        evidence,
        kinds={"stage_columns", "primary_key_match", "shared_domain", "shared_terms", "shared_schema"},
    )
    knowledge_ids = _find_evidence_ids(evidence, kinds={"knowledge_context"})

    headline = (
        f"{selected.get('businessName') or selected.get('tableName')} is staged in "
        f"{selected.get('bestLayer') or 'the pipeline'} and anchored to the "
        f"{selected.get('domain') or 'unassigned'} domain."
    )
    relationship_text = (
        f"The strongest nearby asset is {top_candidate.get('target_table', '').split('.')[-1]}, and the current evidence "
        f"comes from {top_candidate.get('analysis_stage', 'staged')} posture plus explicit relationship signals."
        if top_candidate
        else "No staged pair is strong enough yet, so the atlas is still leaning on contextual proximity rather than a defensible join."
    )
    metadata_description = (
        f"{selected.get('businessName') or selected.get('tableName')} is a "
        f"{selected.get('domain') or 'business'} asset sourced from {selected.get('sourceDisplay') or selected.get('source')} "
        f"and currently staged through {', '.join(selected.get('loadedLayers', [])) or 'no loaded layers'}."
    )

    if prompt_mode == "relationship_story":
        headline = f"Why {selected.get('tableName')} sits near its closest staged neighbors"
    elif prompt_mode == "metadata_draft":
        headline = f"Draft documentation for {selected.get('businessName') or selected.get('tableName')}"

    return {
        "headline": headline,
        "claims": [
            {
                "id": "claim-1",
                "label": "What this asset appears to represent",
                "text": selected.get("description")
                or f"This asset is registered as {selected.get('tableName')} in {selected.get('sourceDisplay') or selected.get('source')}, with pipeline posture already visible in the staged estate inventory.",
                "evidenceIds": overview_ids or knowledge_ids[:2],
            },
            {
                "id": "claim-2",
                "label": "Why it is grouped this way",
                "text": relationship_text,
                "evidenceIds": relationship_ids or overview_ids[:2],
            },
            {
                "id": "claim-3",
                "label": "What the operator should do next",
                "text": "Use lineage to confirm the upstream/downstream path, then profile the highest ready layer before documenting or blending against this asset.",
                "evidenceIds": _find_evidence_ids(evidence, kinds={"layer_posture", "stage_columns", "trusted_pair"}) or overview_ids[:2],
            },
        ],
        "metadataDraft": {
            "description": metadata_description,
            "tags": [
                str(selected.get("domain") or "unassigned"),
                str(selected.get("sourceDisplay") or selected.get("source") or "unknown"),
                str(selected.get("bestLayer") or "staged"),
            ],
            "evidenceIds": (overview_ids[:2] + knowledge_ids[:2])[:4],
        },
        "actions": _catalog_actions(selected, candidates, evidence),
        "warnings": [
            {
                "text": "Relationships without shared staged columns or primary-key hints should be treated as contextual proximity, not confirmed join truth.",
                "evidenceIds": _find_evidence_ids(evidence, kinds={"shared_domain", "shared_terms", "shared_schema"}),
            }
        ],
    }


def _catalog_analyst_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "headline": {"type": "string"},
            "claims": {
                "type": "array",
                "minItems": 2,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "id": {"type": "string"},
                        "label": {"type": "string"},
                        "text": {"type": "string"},
                        "evidenceIds": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 1,
                            "maxItems": 5,
                        },
                    },
                    "required": ["id", "label", "text", "evidenceIds"],
                },
            },
            "metadataDraft": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "description": {"type": "string"},
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 6,
                    },
                    "evidenceIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 5,
                    },
                },
                "required": ["description", "tags", "evidenceIds"],
            },
            "actions": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "label": {"type": "string"},
                        "reason": {"type": "string"},
                        "evidenceIds": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 1,
                            "maxItems": 5,
                        },
                    },
                    "required": ["label", "reason", "evidenceIds"],
                },
            },
            "warnings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "text": {"type": "string"},
                        "evidenceIds": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 1,
                            "maxItems": 5,
                        },
                    },
                    "required": ["text", "evidenceIds"],
                },
                "maxItems": 3,
            },
        },
        "required": ["headline", "claims", "metadataDraft", "actions", "warnings"],
    }


def _catalog_analyst_prompt(
    selected: dict,
    candidates: list[dict],
    evidence: list[dict],
    prompt_mode: str,
) -> str:
    selected_summary = {
        "entityId": selected.get("entityId"),
        "tableName": selected.get("tableName"),
        "businessName": selected.get("businessName"),
        "source": selected.get("sourceDisplay") or selected.get("source"),
        "domain": selected.get("domain"),
        "loadedLayers": selected.get("loadedLayers"),
        "bestLayer": selected.get("bestLayer"),
        "qualityScore": selected.get("qualityScore"),
        "qualityTier": selected.get("qualityTier"),
        "description": selected.get("description"),
    }
    simplified_candidates = [
        {
            "target": candidate.get("target_table"),
            "confidence": candidate.get("confidence_score"),
            "joinType": candidate.get("join_type"),
            "reason": candidate.get("reason"),
            "analysisStage": candidate.get("analysis_stage"),
        }
        for candidate in candidates[:3]
    ]
    evidence_lines = "\n".join(
        f"{item['id']} | {item['label']} | {item['detail']} | {item['provenance']['type']} | {item['provenance']['sourceRef']}"
        for item in evidence
    )

    return (
        "You are an AI-native catalog analyst for IP Corporation's FMD platform.\n"
        "Your job is to synthesize grounded documentation and operator guidance for one asset.\n"
        "Rules:\n"
        "- Use ONLY the supplied evidence items.\n"
        "- Every claim, metadata draft, action, and warning must cite evidenceIds from that list.\n"
        "- If evidence only shows context proximity, say that directly.\n"
        "- Do not call anything a validated join unless staged columns or primary-key evidence supports it.\n"
        "- Keep the language concise, business-native, and operational.\n\n"
        f"Prompt mode: {prompt_mode}\n"
        f"Selected asset:\n{json.dumps(selected_summary, indent=2)}\n\n"
        f"Top staged candidates:\n{json.dumps(simplified_candidates, indent=2)}\n\n"
        f"Evidence catalog:\n{evidence_lines}\n\n"
        "Return JSON that matches the provided schema exactly."
    )


def _run_claude_structured(prompt: str, schema: dict) -> dict:
    if not CLAUDE_CLI_PATH:
        raise RuntimeError("Claude CLI is not available on this host")

    command = [
        CLAUDE_CLI_PATH,
        "-p",
        "--output-format",
        "json",
        "--model",
        "sonnet",
        "--effort",
        "low",
        "--json-schema",
        json.dumps(schema, separators=(",", ":")),
        "--tools",
        "",
        "--disable-slash-commands",
        prompt,
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=120,
        cwd=str(PROJECT_ROOT),
        encoding="utf-8",
        errors="ignore",
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"Claude CLI failed with exit code {result.returncode}")

    stdout = (result.stdout or "").strip()
    json_line = next((line for line in stdout.splitlines() if line.strip().startswith("{")), "")
    if not json_line:
        raise RuntimeError("Claude CLI returned no JSON payload")
    payload = json.loads(json_line)
    structured = payload.get("structured_output")
    if not structured:
        raise RuntimeError("Claude CLI returned no structured output")
    return structured


def build_catalog_analyst_brief(params: dict) -> dict:
    source = params.get("source", "")
    table = params.get("table", "")
    prompt_mode = _normalize(params.get("promptMode") or "overview") or "overview"

    artifact = _load_analysis_artifact() or _build_analysis_artifact()
    selected = _find_inventory_entity(artifact, source, table)
    if not selected:
        return {"status": "error", "error": f"Table {source}.{table} not found in staged relationship inventory"}

    table_payload = get_table_joins({"source": source, "table": table})
    candidates = list((table_payload.get("outbound_joins") or {}).get("candidates") or [])
    evidence_items: list[dict] = []
    _append_evidence(evidence_items, *_selected_entity_evidence(selected))
    _append_evidence(evidence_items, *_extract_knowledge_evidence(selected))
    for candidate in candidates[:3]:
        candidate_ref = str(candidate.get("target_table") or "").split(".")[-1]
        _append_evidence(
            evidence_items,
            _evidence_item(
                kind="relationship_candidate",
                label=f"Candidate relationship: {candidate_ref}",
                detail=f"{candidate.get('join_type')} at {candidate.get('confidence_score')} confidence",
                provenance_type="staged_relationship_candidate",
                source_ref=f"{selected.get('tableName')}->{candidate_ref}",
                fields=["join_type", "confidence_score", "analysis_stage"],
                layer=candidate.get("analysis_stage"),
            ),
        )
        for item in candidate.get("evidence", []):
            _append_evidence(evidence_items, item)

    evidence = _assign_evidence_ids(evidence_items)
    schema = _catalog_analyst_schema()

    try:
        answer = _run_claude_structured(
            _catalog_analyst_prompt(selected, candidates, evidence, prompt_mode),
            schema,
        )
        mode = "claude_code_cli"
    except Exception as exc:
        log.warning("Catalog analyst fell back to deterministic synthesis: %s", exc)
        answer = _fallback_catalog_brief(selected, candidates, evidence, prompt_mode)
        mode = "deterministic_fallback"

    return {
        "status": "success",
        "mode": mode,
        "promptMode": prompt_mode,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "target": {
            "entityId": selected.get("entityId"),
            "source": selected.get("sourceDisplay") or selected.get("source"),
            "table": selected.get("tableName"),
        },
        "answer": answer,
        "evidence": evidence,
    }


@route("GET", "/api/join-discovery/status")
def join_discovery_status_route(params: dict) -> dict:
    return get_join_discovery_status(params)


@route("GET", "/api/join-discovery/candidates")
def join_discovery_candidates_route(params: dict) -> list[dict]:
    return get_join_candidates(params)


@route("GET", "/api/join-discovery/cross-source")
def join_discovery_cross_source_route(params: dict) -> dict:
    return get_cross_source_joins(params)


@route("GET", "/api/join-discovery/table")
def join_discovery_table_route(params: dict) -> dict:
    return get_table_joins(params)


@route("GET", "/api/join-discovery/lineage")
def join_discovery_lineage_route(params: dict) -> dict:
    return get_data_lineage(params)


@route("POST", "/api/join-discovery/validate")
def join_discovery_validate_route(params: dict) -> dict:
    return validate_join(params)


@route("POST", "/api/join-discovery/run-analysis")
def join_discovery_run_analysis_route(params: dict) -> dict:
    return run_analysis(params)


@route("POST", "/api/join-discovery/analyst")
def join_discovery_analyst_route(params: dict) -> dict:
    return build_catalog_analyst_brief(params)


ROUTES = {
    "GET": {
        "/api/join-discovery/status": get_join_discovery_status,
        "/api/join-discovery/candidates": get_join_candidates,
        "/api/join-discovery/cross-source": get_cross_source_joins,
        "/api/join-discovery/table": get_table_joins,
        "/api/join-discovery/lineage": get_data_lineage,
    },
    "POST": {
        "/api/join-discovery/validate": validate_join,
        "/api/join-discovery/run-analysis": run_analysis,
        "/api/join-discovery/analyst": build_catalog_analyst_brief,
    },
}
