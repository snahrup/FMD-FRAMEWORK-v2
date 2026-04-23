"""Core contracts for the orchestration-runtime rewrite."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal

LayerName = Literal["landing", "bronze", "silver"]
RunKind = Literal["run", "resume", "retry"]
RunStatus = Literal[
    "queued",
    "starting",
    "running",
    "stopping",
    "succeeded",
    "failed",
    "aborted",
    "interrupted",
]
TaskStatus = Literal["queued", "running", "succeeded", "failed", "skipped", "cancelled"]

_RUN_STATUS_TO_DB = {
    "queued": "Queued",
    "starting": "Starting",
    "running": "InProgress",
    "stopping": "Stopping",
    "succeeded": "Succeeded",
    "failed": "Failed",
    "aborted": "Aborted",
    "interrupted": "Interrupted",
}
_RUN_STATUS_FROM_DB = {
    "queued": "queued",
    "starting": "starting",
    "inprogress": "running",
    "running": "running",
    "stopping": "stopping",
    "succeeded": "succeeded",
    "success": "succeeded",
    "failed": "failed",
    "error": "failed",
    "aborted": "aborted",
    "interrupted": "interrupted",
}


@dataclass(frozen=True)
class RunRequest:
    """Immutable normalized request handed from API to the supervisor."""

    run_id: str
    layers: tuple[LayerName, ...]
    entity_ids: tuple[int, ...] = ()
    triggered_by: str = "dashboard"
    mode: str = "run"
    parent_run_id: str | None = None
    run_kind: RunKind = "run"
    source_filter: tuple[str, ...] = ()
    resolved_entity_count: int = 0


@dataclass(frozen=True)
class TaskOutcome:
    """Normalized task outcome used by the new runtime contracts."""

    entity_id: int
    layer: LayerName
    status: TaskStatus
    error: str | None = None
    attempt: int = 1

    @property
    def succeeded(self) -> bool:
        return self.status == "succeeded"


@dataclass(frozen=True)
class RunRecord:
    """Durable run state as seen by the runtime supervisor."""

    run_id: str
    status: RunStatus
    layers: tuple[LayerName, ...]
    entity_ids: tuple[int, ...] = ()
    triggered_by: str = "dashboard"
    mode: str = "run"
    parent_run_id: str | None = None
    run_kind: RunKind = "run"
    source_filter: tuple[str, ...] = ()
    resolved_entity_count: int = 0
    current_layer: str | None = None
    error_summary: str | None = None
    started_at: str | None = None
    ended_at: str | None = None
    heartbeat_at: str | None = None
    completed_units: int = 0
    succeeded_units: int = 0
    failed_units: int = 0
    skipped_units: int = 0

    @classmethod
    def from_request(
        cls,
        request: RunRequest,
        *,
        status: RunStatus,
        started_at: str | None = None,
    ) -> "RunRecord":
        return cls(
            run_id=request.run_id,
            status=status,
            layers=request.layers,
            entity_ids=request.entity_ids,
            triggered_by=request.triggered_by,
            mode=request.mode,
            parent_run_id=request.parent_run_id,
            run_kind=request.run_kind,
            source_filter=request.source_filter,
            resolved_entity_count=request.resolved_entity_count,
            started_at=started_at,
        )

    def with_updates(self, **changes) -> "RunRecord":
        return replace(self, **changes)


@dataclass(frozen=True)
class LayerScope:
    """Which entities a layer is allowed to process in a given run."""

    layer: LayerName
    entity_ids: tuple[int, ...]
    blocked_entity_ids: tuple[int, ...] = ()

    @classmethod
    def build(
        cls,
        layer: LayerName,
        entity_ids: list[int] | tuple[int, ...],
        blocked_entity_ids: list[int] | tuple[int, ...] = (),
    ) -> "LayerScope":
        unique_entities = tuple(sorted(dict.fromkeys(int(x) for x in entity_ids)))
        unique_blocked = tuple(sorted(dict.fromkeys(int(x) for x in blocked_entity_ids)))
        return cls(
            layer=layer,
            entity_ids=unique_entities,
            blocked_entity_ids=unique_blocked,
        )


def to_db_run_status(status: RunStatus) -> str:
    return _RUN_STATUS_TO_DB[status]


def from_db_run_status(value: str | None) -> RunStatus:
    raw = "".join(ch for ch in str(value or "").strip().lower() if ch.isalpha())
    return _RUN_STATUS_FROM_DB.get(raw, "queued")
