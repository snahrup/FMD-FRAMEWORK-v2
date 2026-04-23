"""Run-state lifecycle rules for runtime v2."""

from __future__ import annotations

from collections.abc import Iterable

from .models import RunStatus, TaskOutcome

TERMINAL_RUN_STATUSES = {"succeeded", "failed", "aborted", "interrupted"}

_ALLOWED_RUN_TRANSITIONS: dict[str, set[str]] = {
    "queued": {"starting", "failed", "aborted", "interrupted"},
    "starting": {"running", "failed", "aborted", "interrupted"},
    "running": {"stopping", "succeeded", "failed", "aborted", "interrupted"},
    "stopping": {"succeeded", "failed", "aborted", "interrupted"},
    "succeeded": set(),
    "failed": set(),
    "aborted": set(),
    "interrupted": set(),
}


def is_terminal_run_status(status: str) -> bool:
    return str(status).lower() in TERMINAL_RUN_STATUSES


def can_transition_run(current: RunStatus, next_status: RunStatus) -> bool:
    return next_status in _ALLOWED_RUN_TRANSITIONS[current]


def terminal_status_for_outcomes(
    outcomes: Iterable[TaskOutcome],
    *,
    aborted: bool = False,
    interrupted: bool = False,
) -> RunStatus:
    """Collapse task outcomes into a single terminal run status."""
    if aborted:
        return "aborted"
    if interrupted:
        return "interrupted"
    if any(outcome.status == "failed" for outcome in outcomes):
        return "failed"
    return "succeeded"
