"""Layer gating helpers for runtime v2."""

from __future__ import annotations

from collections.abc import Iterable

from engine.models import BronzeEntity, SilverEntity

from .models import LayerScope, TaskOutcome


def _latest_outcomes(
    outcomes: Iterable[TaskOutcome],
    *,
    layer: str | None = None,
) -> dict[int, TaskOutcome]:
    latest: dict[int, TaskOutcome] = {}
    for outcome in outcomes:
        if layer and outcome.layer != layer:
            continue
        latest[outcome.entity_id] = outcome
    return latest


def successful_entity_ids(
    outcomes: Iterable[TaskOutcome],
    *,
    layer: str | None = None,
) -> set[int]:
    latest = _latest_outcomes(outcomes, layer=layer)
    return {
        entity_id
        for entity_id, outcome in latest.items()
        if outcome.status == "succeeded"
    }


def scope_for_bronze(
    bronze_entities: Iterable[BronzeEntity],
    landing_outcomes: Iterable[TaskOutcome],
) -> LayerScope:
    """Only Bronze entities with current-run landing success may proceed."""
    landing_successes = successful_entity_ids(landing_outcomes, layer="landing")
    allowed: list[int] = []
    blocked: list[int] = []

    for entity in bronze_entities:
        if entity.lz_entity_id in landing_successes:
            allowed.append(entity.bronze_entity_id)
        else:
            blocked.append(entity.bronze_entity_id)

    return LayerScope.build("bronze", allowed, blocked)


def scope_for_silver(
    silver_entities: Iterable[SilverEntity],
    bronze_outcomes: Iterable[TaskOutcome],
) -> LayerScope:
    """Only Silver entities with current-run bronze success may proceed."""
    bronze_successes = successful_entity_ids(bronze_outcomes, layer="bronze")
    allowed: list[int] = []
    blocked: list[int] = []

    for entity in silver_entities:
        if entity.bronze_entity_id in bronze_successes:
            allowed.append(entity.silver_entity_id)
        else:
            blocked.append(entity.silver_entity_id)

    return LayerScope.build("silver", allowed, blocked)
