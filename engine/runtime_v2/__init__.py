"""Runtime-v2 contracts for the orchestration rewrite."""

from .api_adapter import build_run_request, normalize_layers
from .gating import scope_for_bronze, scope_for_silver, successful_entity_ids
from .lifecycle import can_transition_run, is_terminal_run_status, terminal_status_for_outcomes
from .models import LayerScope, RunRecord, RunRequest, TaskOutcome, from_db_run_status, to_db_run_status
from .repository import InMemoryRuntimeRepository, SQLiteRuntimeRepository
from .supervisor import RunSupervisor

__all__ = [
    "LayerScope",
    "RunRecord",
    "RunRequest",
    "TaskOutcome",
    "RunSupervisor",
    "SQLiteRuntimeRepository",
    "InMemoryRuntimeRepository",
    "build_run_request",
    "can_transition_run",
    "from_db_run_status",
    "is_terminal_run_status",
    "normalize_layers",
    "scope_for_bronze",
    "scope_for_silver",
    "successful_entity_ids",
    "terminal_status_for_outcomes",
    "to_db_run_status",
]
