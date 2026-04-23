"""Run-supervisor skeleton for the orchestration-runtime rewrite."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta

from .lifecycle import is_terminal_run_status, terminal_status_for_outcomes
from .models import RunRecord, RunRequest, TaskOutcome
from .repository import RuntimeRepository, RunNotFoundError


class RunSupervisor:
    """Owns run lifecycle transitions independently of the legacy worker."""

    def __init__(
        self,
        repository: RuntimeRepository,
        *,
        run_timeout_seconds: int = 86_400,
        now_factory: Callable[[], datetime] | None = None,
    ):
        self._repository = repository
        self._run_timeout_seconds = int(run_timeout_seconds)
        self._now = now_factory or (lambda: datetime.now(UTC))

    def queue_run(self, request: RunRequest) -> RunRecord:
        return self._repository.create_run(request)

    def start_run(self, run_id: str) -> RunRecord:
        self._repository.transition_run(run_id, "starting")
        return self._repository.transition_run(run_id, "running", heartbeat_at=self._now_iso())

    def begin_layer(self, run_id: str, layer: str) -> RunRecord:
        return self._repository.transition_run(
            run_id,
            "running",
            current_layer=layer,
            heartbeat_at=self._now_iso(),
        )

    def record_heartbeat(
        self,
        run_id: str,
        *,
        current_layer: str | None = None,
        completed_units: int | None = None,
        succeeded_units: int | None = None,
        failed_units: int | None = None,
        skipped_units: int | None = None,
    ) -> RunRecord:
        return self._repository.transition_run(
            run_id,
            "running",
            current_layer=current_layer,
            heartbeat_at=self._now_iso(),
            completed_units=completed_units,
            succeeded_units=succeeded_units,
            failed_units=failed_units,
            skipped_units=skipped_units,
        )

    def abort_run(self, run_id: str, *, reason: str = "Aborted by user") -> RunRecord:
        run = self._require_run(run_id)
        if is_terminal_run_status(run.status):
            return run
        if run.status == "running":
            self._repository.transition_run(
                run_id,
                "stopping",
                current_layer=run.current_layer,
                error_summary=reason,
                heartbeat_at=self._now_iso(),
            )
        return self._repository.transition_run(
            run_id,
            "aborted",
            error_summary=reason,
            heartbeat_at=self._now_iso(),
        )

    def finalize_run(
        self,
        run_id: str,
        outcomes: Iterable[TaskOutcome],
        *,
        aborted: bool = False,
        interrupted: bool = False,
        error_summary: str | None = None,
    ) -> RunRecord:
        outcome_list = list(outcomes)
        if outcome_list:
            self._repository.record_task_outcomes(run_id, outcome_list)

        succeeded = sum(1 for outcome in outcome_list if outcome.status == "succeeded")
        failed = sum(1 for outcome in outcome_list if outcome.status == "failed")
        skipped = sum(1 for outcome in outcome_list if outcome.status == "skipped")
        terminal_status = terminal_status_for_outcomes(
            outcome_list,
            aborted=aborted,
            interrupted=interrupted,
        )
        summary = error_summary
        if summary is None and terminal_status == "aborted":
            summary = "Aborted by user"
        elif summary is None and terminal_status == "interrupted":
            summary = "Interrupted: run timeout or worker loss"

        return self._repository.transition_run(
            run_id,
            terminal_status,
            error_summary=summary,
            heartbeat_at=self._now_iso(),
            completed_units=len(outcome_list),
            succeeded_units=succeeded,
            failed_units=failed,
            skipped_units=skipped,
        )

    def enforce_timeout(self, run_id: str) -> RunRecord | None:
        run = self._require_run(run_id)
        if is_terminal_run_status(run.status) or not run.started_at:
            return None
        started_at = _parse_iso_z(run.started_at)
        if self._now() < started_at + timedelta(seconds=self._run_timeout_seconds):
            return None
        return self.finalize_run(
            run_id,
            [],
            interrupted=True,
            error_summary=f"Run exceeded {self._run_timeout_seconds}s timeout",
        )

    def _require_run(self, run_id: str) -> RunRecord:
        run = self._repository.get_run(run_id)
        if run is None:
            raise RunNotFoundError(run_id)
        return run

    def _now_iso(self) -> str:
        return self._now().strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso_z(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized).astimezone(UTC)
