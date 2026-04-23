"""Repository layer for runtime-v2 run and task state."""

from __future__ import annotations

import sqlite3
from dataclasses import replace
from pathlib import Path
from typing import Protocol

from dashboard.app.api import control_plane_db as cpdb

from .lifecycle import can_transition_run, is_terminal_run_status
from .models import RunRecord, RunRequest, RunStatus, TaskOutcome, from_db_run_status, to_db_run_status


class InvalidRunTransitionError(RuntimeError):
    """Raised when a run transition violates the runtime-v2 state machine."""


class RunNotFoundError(KeyError):
    """Raised when a run cannot be loaded from the backing store."""


class RuntimeRepository(Protocol):
    def create_run(self, request: RunRequest) -> RunRecord:
        ...

    def get_run(self, run_id: str) -> RunRecord | None:
        ...

    def transition_run(
        self,
        run_id: str,
        next_status: RunStatus,
        *,
        current_layer: str | None = None,
        error_summary: str | None = None,
        heartbeat_at: str | None = None,
        completed_units: int | None = None,
        succeeded_units: int | None = None,
        failed_units: int | None = None,
        skipped_units: int | None = None,
    ) -> RunRecord:
        ...

    def record_task_outcomes(self, run_id: str, outcomes: list[TaskOutcome]) -> None:
        ...


def _utcnow_iso_z() -> str:
    return cpdb._now()


def _serialize_layers(layers: tuple[str, ...]) -> str:
    return ",".join(layers)


def _serialize_entity_filter(entity_ids: tuple[int, ...]) -> str:
    return ",".join(str(entity_id) for entity_id in entity_ids)


def _serialize_source_filter(source_filter: tuple[str, ...]) -> str:
    return ",".join(source_filter)


def _row_value(row: sqlite3.Row, key: str, default=None):
    return row[key] if key in row.keys() else default


class InMemoryRuntimeRepository:
    """Pure-Python repository used by runtime-v2 unit tests."""

    def __init__(self, *, now_factory=_utcnow_iso_z):
        self._runs: dict[str, RunRecord] = {}
        self._task_outcomes: dict[str, list[TaskOutcome]] = {}
        self._now = now_factory

    def create_run(self, request: RunRequest) -> RunRecord:
        record = RunRecord.from_request(request, status="queued", started_at=self._now())
        self._runs[request.run_id] = record
        self._task_outcomes.setdefault(request.run_id, [])
        return record

    def get_run(self, run_id: str) -> RunRecord | None:
        return self._runs.get(run_id)

    def transition_run(
        self,
        run_id: str,
        next_status: RunStatus,
        *,
        current_layer: str | None = None,
        error_summary: str | None = None,
        heartbeat_at: str | None = None,
        completed_units: int | None = None,
        succeeded_units: int | None = None,
        failed_units: int | None = None,
        skipped_units: int | None = None,
    ) -> RunRecord:
        current = self.get_run(run_id)
        if current is None:
            raise RunNotFoundError(run_id)
        if current.status != next_status and not can_transition_run(current.status, next_status):
            raise InvalidRunTransitionError(f"{current.status} -> {next_status} is not allowed")

        updates = {
            "status": next_status,
            "current_layer": current_layer if current_layer is not None else current.current_layer,
            "error_summary": error_summary if error_summary is not None else current.error_summary,
            "heartbeat_at": heartbeat_at if heartbeat_at is not None else current.heartbeat_at,
            "completed_units": completed_units if completed_units is not None else current.completed_units,
            "succeeded_units": succeeded_units if succeeded_units is not None else current.succeeded_units,
            "failed_units": failed_units if failed_units is not None else current.failed_units,
            "skipped_units": skipped_units if skipped_units is not None else current.skipped_units,
        }
        if is_terminal_run_status(next_status):
            updates["ended_at"] = self._now()
            updates["current_layer"] = None
        updated = replace(current, **updates)
        self._runs[run_id] = updated
        return updated

    def record_task_outcomes(self, run_id: str, outcomes: list[TaskOutcome]) -> None:
        if run_id not in self._task_outcomes:
            self._task_outcomes[run_id] = []
        self._task_outcomes[run_id].extend(outcomes)

    def list_task_outcomes(self, run_id: str) -> list[TaskOutcome]:
        return list(self._task_outcomes.get(run_id, []))


class SQLiteRuntimeRepository:
    """Writes runtime-v2 state into the existing control-plane SQLite tables."""

    def __init__(self, db_path: str | Path | None = None, *, now_factory=_utcnow_iso_z):
        self._db_path = Path(db_path) if db_path else Path(cpdb.DB_PATH)
        self._now = now_factory

    def create_run(self, request: RunRequest) -> RunRecord:
        started_at = self._now()
        cpdb.upsert_engine_run({
            "RunId": request.run_id,
            "ParentRunId": request.parent_run_id,
            "RunKind": request.run_kind,
            "Mode": request.mode,
            "Status": to_db_run_status("queued"),
            "TotalEntities": request.resolved_entity_count or len(request.entity_ids),
            "Layers": _serialize_layers(request.layers),
            "EntityFilter": _serialize_entity_filter(request.entity_ids),
            "TriggeredBy": request.triggered_by,
            "StartedAt": started_at,
        })
        self._execute_optional_update(
            "UPDATE engine_runs "
            "SET SourceFilter = ?, ResolvedEntityCount = ?, CurrentLayer = ?, CompletedUnits = 0 "
            "WHERE RunId = ?",
            (
                _serialize_source_filter(request.source_filter),
                request.resolved_entity_count or len(request.entity_ids),
                "",
                request.run_id,
            ),
        )
        return RunRecord.from_request(request, status="queued", started_at=started_at)

    def get_run(self, run_id: str) -> RunRecord | None:
        row = self._query_one("SELECT * FROM engine_runs WHERE RunId = ?", (run_id,))
        if row is None:
            return None
        return RunRecord(
            run_id=str(row["RunId"]),
            status=from_db_run_status(row["Status"]),
            layers=tuple(
                part.strip()
                for part in str(row["Layers"] or "").split(",")
                if part and part.strip()
            ) or ("landing", "bronze", "silver"),
            entity_ids=tuple(
                int(part)
                for part in str(row["EntityFilter"] or "").split(",")
                if part and part.strip()
            ),
            triggered_by=str(row["TriggeredBy"] or "dashboard"),
            mode=str(row["Mode"] or "run"),
            parent_run_id=str(_row_value(row, "ParentRunId") or "") or None,
            run_kind=str(_row_value(row, "RunKind") or "run").strip().lower() or "run",
            source_filter=tuple(
                part.strip()
                for part in str(_row_value(row, "SourceFilter") or "").split(",")
                if part and part.strip()
            ),
            resolved_entity_count=int(_row_value(row, "ResolvedEntityCount") or _row_value(row, "TotalEntities") or 0),
            current_layer=str(_row_value(row, "CurrentLayer") or "") or None,
            error_summary=str(_row_value(row, "ErrorSummary") or "") or None,
            started_at=str(_row_value(row, "StartedAt") or "") or None,
            ended_at=str(_row_value(row, "EndedAt") or "") or None,
            heartbeat_at=str(_row_value(row, "HeartbeatAt") or "") or None,
            completed_units=int(_row_value(row, "CompletedUnits") or 0),
            succeeded_units=int(_row_value(row, "SucceededEntities") or 0),
            failed_units=int(_row_value(row, "FailedEntities") or 0),
            skipped_units=int(_row_value(row, "SkippedEntities") or 0),
        )

    def transition_run(
        self,
        run_id: str,
        next_status: RunStatus,
        *,
        current_layer: str | None = None,
        error_summary: str | None = None,
        heartbeat_at: str | None = None,
        completed_units: int | None = None,
        succeeded_units: int | None = None,
        failed_units: int | None = None,
        skipped_units: int | None = None,
    ) -> RunRecord:
        current = self.get_run(run_id)
        if current is None:
            raise RunNotFoundError(run_id)
        if current.status != next_status and not can_transition_run(current.status, next_status):
            raise InvalidRunTransitionError(f"{current.status} -> {next_status} is not allowed")

        ended_at = self._now() if is_terminal_run_status(next_status) else None
        cpdb.upsert_engine_run({
            "RunId": run_id,
            "ParentRunId": current.parent_run_id,
            "RunKind": current.run_kind,
            "Mode": current.mode,
            "Status": to_db_run_status(next_status),
            "TotalEntities": current.resolved_entity_count or len(current.entity_ids),
            "SucceededEntities": succeeded_units if succeeded_units is not None else current.succeeded_units,
            "FailedEntities": failed_units if failed_units is not None else current.failed_units,
            "SkippedEntities": skipped_units if skipped_units is not None else current.skipped_units,
            "Layers": _serialize_layers(current.layers),
            "EntityFilter": _serialize_entity_filter(current.entity_ids),
            "TriggeredBy": current.triggered_by,
            "ErrorSummary": error_summary if error_summary is not None else current.error_summary,
            "StartedAt": current.started_at,
            "EndedAt": ended_at if ended_at is not None else current.ended_at,
            "HeartbeatAt": heartbeat_at if heartbeat_at is not None else current.heartbeat_at,
            "CompletedUnits": completed_units if completed_units is not None else current.completed_units,
        })
        self._execute_optional_update(
            "UPDATE engine_runs SET CurrentLayer = ? WHERE RunId = ?",
            (
                "" if is_terminal_run_status(next_status) else (current_layer if current_layer is not None else current.current_layer or ""),
                run_id,
            ),
        )
        updated = self.get_run(run_id)
        if updated is None:
            raise RunNotFoundError(run_id)
        return updated

    def record_task_outcomes(self, run_id: str, outcomes: list[TaskOutcome]) -> None:
        for outcome in outcomes:
            cpdb.insert_engine_task_log({
                "RunId": run_id,
                "EntityId": outcome.entity_id,
                "Layer": outcome.layer,
                "Status": outcome.status,
                "RowsRead": 0,
                "RowsWritten": 0,
                "BytesTransferred": 0,
                "DurationSeconds": 0,
                "LoadType": "runtime_v2",
                "ErrorType": "runtime_v2" if outcome.error else "",
                "ErrorMessage": outcome.error or "",
                "ErrorStackTrace": "",
                "ErrorSuggestion": "",
                "LogData": "",
                "ExtractionMethod": "runtime_v2",
            })

    def _query_one(self, sql: str, params: tuple[object, ...]) -> sqlite3.Row | None:
        with sqlite3.connect(str(self._db_path), timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(sql, params).fetchone()
            return row

    def _execute_optional_update(self, sql: str, params: tuple[object, ...]) -> None:
        try:
            with sqlite3.connect(str(self._db_path), timeout=10) as conn:
                conn.execute(sql, params)
                conn.commit()
        except sqlite3.OperationalError:
            return
