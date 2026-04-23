"""Normalize legacy API payloads into runtime-v2 contracts."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from .models import LayerName, RunKind, RunRequest

_DEFAULT_LAYERS: tuple[LayerName, ...] = ("landing", "bronze", "silver")
_VALID_LAYERS = set(_DEFAULT_LAYERS)


def _normalize_ints(values: object) -> tuple[int, ...]:
    if values is None:
        return ()
    if isinstance(values, str):
        raw_values = [part.strip() for part in values.split(",") if part.strip()]
    elif isinstance(values, Iterable):
        raw_values = [value for value in values]
    else:
        raw_values = [values]
    return tuple(dict.fromkeys(int(value) for value in raw_values))


def _normalize_strings(values: object) -> tuple[str, ...]:
    if values is None:
        return ()
    if isinstance(values, str):
        raw_values = [part.strip() for part in values.split(",") if part.strip()]
    elif isinstance(values, Iterable):
        raw_values = [str(value).strip() for value in values if str(value).strip()]
    else:
        raw_values = [str(values).strip()]
    return tuple(dict.fromkeys(value for value in raw_values if value))


def normalize_layers(layers: object, *, mode: str) -> tuple[LayerName, ...]:
    if layers is None:
        return ("landing",) if mode == "bulk" else _DEFAULT_LAYERS

    normalized = tuple(str(part).strip().lower() for part in _normalize_strings(layers))
    invalid = tuple(layer for layer in normalized if layer not in _VALID_LAYERS)
    if invalid:
        raise ValueError(f"Unsupported layer(s): {', '.join(invalid)}")
    return normalized or (("landing",) if mode == "bulk" else _DEFAULT_LAYERS)


def build_run_request(
    body: Mapping[str, object],
    *,
    run_id: str,
    mode: str | None = None,
    parent_run_id: str | None = None,
    run_kind: RunKind | None = None,
) -> RunRequest:
    normalized_mode = str(mode or body.get("mode") or "run").strip().lower() or "run"
    entity_ids = _normalize_ints(body.get("entity_ids"))
    source_filter = _normalize_strings(body.get("source_filter"))
    resolved_count = int(body.get("resolved_entity_count") or (len(entity_ids) if entity_ids else 0))
    triggered_by = str(body.get("triggered_by") or "dashboard").strip() or "dashboard"
    normalized_kind = str(run_kind or body.get("run_kind") or "run").strip().lower() or "run"

    return RunRequest(
        run_id=run_id,
        layers=normalize_layers(body.get("layers"), mode=normalized_mode),
        entity_ids=entity_ids,
        triggered_by=triggered_by,
        mode=normalized_mode,
        parent_run_id=parent_run_id or (str(body.get("parent_run_id")).strip() if body.get("parent_run_id") else None),
        run_kind=normalized_kind,
        source_filter=source_filter,
        resolved_entity_count=resolved_count,
    )
