"""Tests for the orchestration-runtime rewrite contracts."""

from datetime import UTC, datetime

from engine.models import BronzeEntity, SilverEntity
from engine.runtime_v2.api_adapter import build_run_request
from engine.runtime_v2.gating import scope_for_bronze, scope_for_silver, successful_entity_ids
from engine.runtime_v2.lifecycle import can_transition_run, is_terminal_run_status, terminal_status_for_outcomes
from engine.runtime_v2.models import TaskOutcome, from_db_run_status, to_db_run_status
from engine.runtime_v2.repository import InMemoryRuntimeRepository, InvalidRunTransitionError
from engine.runtime_v2.supervisor import RunSupervisor


def _landing(entity_id: int, status: str, attempt: int = 1) -> TaskOutcome:
    return TaskOutcome(entity_id=entity_id, layer="landing", status=status, attempt=attempt)


def _bronze(entity_id: int, status: str, attempt: int = 1) -> TaskOutcome:
    return TaskOutcome(entity_id=entity_id, layer="bronze", status=status, attempt=attempt)


def _make_bronze_entity(bronze_id: int, lz_id: int) -> BronzeEntity:
    return BronzeEntity(
        bronze_entity_id=bronze_id,
        lz_entity_id=lz_id,
        namespace="m3",
        source_schema="dbo",
        source_name=f"T{bronze_id}",
        primary_keys="Id",
        is_incremental=False,
        lakehouse_guid="br",
        workspace_guid="ws",
        lz_file_name=f"T{bronze_id}.parquet",
        lz_namespace="m3",
        lz_lakehouse_guid="lz",
    )


def _make_silver_entity(silver_id: int, bronze_id: int, lz_id: int) -> SilverEntity:
    return SilverEntity(
        silver_entity_id=silver_id,
        bronze_entity_id=bronze_id,
        namespace="m3",
        source_name=f"T{silver_id}",
        primary_keys="Id",
        is_incremental=False,
        lakehouse_guid="sv",
        workspace_guid="ws",
        bronze_lakehouse_guid="br",
        lz_entity_id=lz_id,
    )


def test_terminal_status_marks_failure_when_any_task_failed():
    outcomes = [_landing(1, "succeeded"), _landing(2, "failed")]
    assert terminal_status_for_outcomes(outcomes) == "failed"


def test_terminal_status_honors_aborted_and_interrupted_flags():
    outcomes = [_landing(1, "succeeded")]
    assert terminal_status_for_outcomes(outcomes, aborted=True) == "aborted"
    assert terminal_status_for_outcomes(outcomes, interrupted=True) == "interrupted"


def test_can_transition_run_allows_valid_edges_only():
    assert can_transition_run("queued", "starting") is True
    assert can_transition_run("queued", "interrupted") is True
    assert can_transition_run("running", "failed") is True
    assert can_transition_run("succeeded", "running") is False


def test_is_terminal_run_status():
    assert is_terminal_run_status("succeeded") is True
    assert is_terminal_run_status("aborted") is True
    assert is_terminal_run_status("running") is False


def test_run_status_maps_to_and_from_existing_db_values():
    assert to_db_run_status("running") == "InProgress"
    assert from_db_run_status("InProgress") == "running"
    assert from_db_run_status("Succeeded") == "succeeded"


def test_build_run_request_normalizes_bulk_defaults_and_scope_metadata():
    request = build_run_request(
        {
            "entity_ids": ["10", 11, 11],
            "source_filter": ["m3", "mes", "m3"],
            "resolved_entity_count": 2,
        },
        run_id="run-1",
        mode="bulk",
        parent_run_id="parent-1",
        run_kind="resume",
    )

    assert request.run_id == "run-1"
    assert request.mode == "bulk"
    assert request.layers == ("landing",)
    assert request.entity_ids == (10, 11)
    assert request.parent_run_id == "parent-1"
    assert request.run_kind == "resume"
    assert request.source_filter == ("m3", "mes")
    assert request.resolved_entity_count == 2


def test_build_run_request_rejects_unknown_layers():
    try:
        build_run_request({"layers": ["landing", "gold"]}, run_id="run-2")
    except ValueError as exc:
        assert "Unsupported layer" in str(exc)
    else:
        raise AssertionError("Expected ValueError for unsupported layer")


def test_successful_entity_ids_uses_latest_outcome_per_entity():
    outcomes = [
        _landing(10, "failed", attempt=1),
        _landing(10, "succeeded", attempt=2),
        _landing(11, "succeeded", attempt=1),
        _landing(12, "failed", attempt=1),
    ]
    assert successful_entity_ids(outcomes, layer="landing") == {10, 11}


def test_scope_for_bronze_only_includes_landing_successes():
    bronze_entities = [
        _make_bronze_entity(101, 1),
        _make_bronze_entity(102, 2),
        _make_bronze_entity(103, 3),
    ]
    landing_outcomes = [_landing(1, "succeeded"), _landing(3, "failed")]

    scope = scope_for_bronze(bronze_entities, landing_outcomes)

    assert scope.layer == "bronze"
    assert scope.entity_ids == (101,)
    assert scope.blocked_entity_ids == (102, 103)


def test_scope_for_silver_only_includes_bronze_successes():
    silver_entities = [
        _make_silver_entity(201, 101, 1),
        _make_silver_entity(202, 102, 2),
        _make_silver_entity(203, 103, 3),
    ]
    bronze_outcomes = [_bronze(101, "succeeded"), _bronze(103, "failed")]

    scope = scope_for_silver(silver_entities, bronze_outcomes)

    assert scope.layer == "silver"
    assert scope.entity_ids == (201,)
    assert scope.blocked_entity_ids == (202, 203)


def test_supervisor_start_finalize_and_abort_run():
    repo = InMemoryRuntimeRepository(now_factory=lambda: "2026-04-22T12:00:00Z")
    supervisor = RunSupervisor(
        repo,
        now_factory=lambda: datetime(2026, 4, 22, 12, 0, 0, tzinfo=UTC),
    )
    request = build_run_request({"layers": ["landing", "bronze"]}, run_id="run-3")

    queued = supervisor.queue_run(request)
    running = supervisor.start_run(request.run_id)
    supervisor.begin_layer(request.run_id, "landing")
    finished = supervisor.finalize_run(
        request.run_id,
        [_landing(1, "succeeded"), _landing(2, "failed")],
    )

    assert queued.status == "queued"
    assert running.status == "running"
    assert finished.status == "failed"
    assert finished.failed_units == 1
    assert len(repo.list_task_outcomes(request.run_id)) == 2

    aborted = supervisor.abort_run(request.run_id, reason="ignore")
    assert aborted.status == "failed"


def test_supervisor_abort_from_running_sets_aborted():
    repo = InMemoryRuntimeRepository(now_factory=lambda: "2026-04-22T12:00:00Z")
    supervisor = RunSupervisor(
        repo,
        now_factory=lambda: datetime(2026, 4, 22, 12, 0, 0, tzinfo=UTC),
    )
    request = build_run_request({}, run_id="run-abort")

    supervisor.queue_run(request)
    supervisor.start_run(request.run_id)
    aborted = supervisor.abort_run(request.run_id, reason="Aborted by user")

    assert aborted.status == "aborted"
    assert aborted.error_summary == "Aborted by user"


def test_supervisor_timeout_interrupts_active_run():
    repo = InMemoryRuntimeRepository(now_factory=lambda: "2026-04-22T12:00:00Z")
    supervisor = RunSupervisor(
        repo,
        run_timeout_seconds=60,
        now_factory=lambda: datetime(2026, 4, 22, 12, 2, 0, tzinfo=UTC),
    )
    request = build_run_request({}, run_id="run-4")

    supervisor.queue_run(request)
    supervisor.start_run(request.run_id)
    timed_out = supervisor.enforce_timeout(request.run_id)

    assert timed_out is not None
    assert timed_out.status == "interrupted"
    assert timed_out.error_summary == "Run exceeded 60s timeout"


def test_repository_rejects_invalid_transition():
    repo = InMemoryRuntimeRepository(now_factory=lambda: "2026-04-22T12:00:00Z")
    request = build_run_request({}, run_id="run-5")
    repo.create_run(request)
    repo.transition_run(request.run_id, "starting")
    repo.transition_run(request.run_id, "running")
    repo.transition_run(request.run_id, "succeeded")

    try:
        repo.transition_run(request.run_id, "running")
    except InvalidRunTransitionError:
        pass
    else:
        raise AssertionError("Expected invalid transition to be rejected")
