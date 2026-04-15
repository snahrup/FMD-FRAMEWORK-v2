"""Bounded self-heal queue backed by the local control-plane SQLite DB."""

from __future__ import annotations

import ctypes
import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import textwrap
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("fmd.self_heal")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_ROOT = PROJECT_ROOT / "artifacts" / "self-heal"
LOG_ROOT = PROJECT_ROOT / "logs"
RUNTIME_KEY = "daemon"
FINAL_CASE_STATUSES = {"succeeded", "exhausted", "disabled"}
ACTIVE_CASE_STATUSES = {"collecting_context", "invoking_agent", "validating_patch", "retrying"}
PREFERRED_FILE_HINTS = {
    "landing": [
        "engine/orchestrator.py",
        "engine/extractor.py",
        "engine/connections.py",
        "engine/loader.py",
        "engine/onelake_io.py",
    ],
    "bronze": [
        "engine/orchestrator.py",
        "engine/bronze_processor.py",
        "engine/onelake_io.py",
    ],
    "silver": [
        "engine/orchestrator.py",
        "engine/silver_processor.py",
        "engine/onelake_io.py",
    ],
}
AGENT_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "status": {"type": "string", "enum": ["patched", "no_change", "blocked"]},
        "summary": {"type": "string"},
        "filesChanged": {"type": "array", "items": {"type": "string"}},
        "validation": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["status", "summary", "filesChanged", "validation", "notes"],
}

_db_initialized = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ensure_db() -> None:
    global _db_initialized
    if _db_initialized:
        return
    from dashboard.app.api import db

    db.init_db()
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    LOG_ROOT.mkdir(parents=True, exist_ok=True)
    _db_initialized = True


def _query(sql: str, params: tuple = ()) -> list[dict]:
    _ensure_db()
    from dashboard.app.api import db

    return db.query(sql, params)


def _execute(sql: str, params: tuple = ()) -> None:
    _ensure_db()
    from dashboard.app.api import db

    db.execute(sql, params)


def _with_conn():
    _ensure_db()
    from dashboard.app.api import db

    return db.get_db()


def _is_pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        if sys.platform == "win32":
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(0x1000, False, int(pid))
            if handle:
                kernel32.CloseHandle(handle)
                return True
            return False
        os.kill(int(pid), 0)
        return True
    except Exception:
        return False


def _which_all(candidates: list[str]) -> list[str]:
    found: list[str] = []
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            found.append(candidate)
    return found


def _tail_file(path: Path, max_chars: int = 6000) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""
    return text[-max_chars:]


def _try_parse_json_blob(raw: str) -> dict[str, Any]:
    raw = (raw or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(raw[start:end + 1])
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


@dataclass(slots=True)
class SelfHealSettings:
    enabled: bool
    agent_order: list[str]
    max_attempts: int
    poll_seconds: int
    agent_timeout_seconds: int
    retry_timeout_seconds: int
    engine_idle_grace_seconds: int

    @classmethod
    def from_env(cls) -> "SelfHealSettings":
        enabled_raw = os.getenv("FMD_SELF_HEAL_ENABLED", "1").strip().lower()
        enabled = enabled_raw not in {"0", "false", "no", "off"}
        raw_order = os.getenv("FMD_SELF_HEAL_AGENT_ORDER", "claude,codex")
        agent_order = [part.strip() for part in raw_order.split(",") if part.strip()]
        return cls(
            enabled=enabled,
            agent_order=agent_order or ["claude", "codex"],
            max_attempts=max(1, int(os.getenv("FMD_SELF_HEAL_MAX_ATTEMPTS", "3"))),
            poll_seconds=max(5, int(os.getenv("FMD_SELF_HEAL_POLL_SECONDS", "10"))),
            agent_timeout_seconds=max(60, int(os.getenv("FMD_SELF_HEAL_AGENT_TIMEOUT_SECONDS", "1800"))),
            retry_timeout_seconds=max(60, int(os.getenv("FMD_SELF_HEAL_RETRY_TIMEOUT_SECONDS", "3600"))),
            engine_idle_grace_seconds=max(5, int(os.getenv("FMD_SELF_HEAL_ENGINE_IDLE_GRACE_SECONDS", "20"))),
        )

    @property
    def available_agents(self) -> list[str]:
        return _which_all(self.agent_order)

    @property
    def selected_agent(self) -> str | None:
        available = self.available_agents
        return available[0] if available else None


def _upsert_runtime(
    *,
    status: str,
    current_case_id: int | None = None,
    worker_pid: int | None = None,
    agent_name: str | None = None,
    last_message: str | None = None,
) -> None:
    _execute(
        "INSERT INTO self_heal_runtime "
        "(RuntimeKey, Status, CurrentCaseId, WorkerPid, AgentName, HeartbeatAt, LastMessage, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(RuntimeKey) DO UPDATE SET "
        "Status = excluded.Status, "
        "CurrentCaseId = excluded.CurrentCaseId, "
        "WorkerPid = COALESCE(excluded.WorkerPid, self_heal_runtime.WorkerPid), "
        "AgentName = COALESCE(excluded.AgentName, self_heal_runtime.AgentName), "
        "HeartbeatAt = excluded.HeartbeatAt, "
        "LastMessage = COALESCE(excluded.LastMessage, self_heal_runtime.LastMessage), "
        "updated_at = excluded.updated_at",
        (
            RUNTIME_KEY,
            status,
            current_case_id,
            worker_pid,
            agent_name,
            _now_iso(),
            last_message,
            _now_iso(),
        ),
    )


def _insert_event(
    case_id: int,
    *,
    attempt_number: int,
    step: str,
    status: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> None:
    _execute(
        "INSERT INTO self_heal_events (CaseId, AttemptNumber, Step, Status, Message, DetailsJson, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            case_id,
            attempt_number,
            step,
            status,
            message[:2000],
            _json_dumps(details or {}),
            _now_iso(),
        ),
    )


def _update_case(case_id: int, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = _now_iso()
    assignments = ", ".join(f"{column} = ?" for column in fields)
    params = tuple(fields.values()) + (case_id,)
    _execute(f"UPDATE self_heal_cases SET {assignments} WHERE id = ?", params)


def _lookup_open_case(parent_run_id: str, layer: str, target_entity_id: int) -> dict[str, Any] | None:
    rows = _query(
        "SELECT * FROM self_heal_cases "
        "WHERE ParentRunId = ? AND Layer = ? AND TargetEntityId = ? "
        "  AND Status NOT IN ('succeeded', 'exhausted', 'disabled') "
        "ORDER BY id DESC LIMIT 1",
        (parent_run_id, layer, target_entity_id),
    )
    return rows[0] if rows else None


def ensure_daemon_started(settings: SelfHealSettings | None = None) -> int | None:
    settings = settings or SelfHealSettings.from_env()
    agent_name = settings.selected_agent
    if not settings.enabled or not agent_name:
        _upsert_runtime(
            status="disabled",
            current_case_id=None,
            worker_pid=None,
            agent_name=agent_name,
            last_message="No supported CLI agent is available for self-heal.",
        )
        return None

    runtime_rows = _query("SELECT * FROM self_heal_runtime WHERE RuntimeKey = ?", (RUNTIME_KEY,))
    runtime = runtime_rows[0] if runtime_rows else {}
    heartbeat_at = runtime.get("HeartbeatAt")
    pid = runtime.get("WorkerPid")
    recent_heartbeat = False
    if heartbeat_at:
        try:
            delta = datetime.now(timezone.utc) - datetime.fromisoformat(str(heartbeat_at).replace("Z", "+00:00"))
            recent_heartbeat = delta <= timedelta(seconds=max(settings.poll_seconds * 4, 30))
        except Exception:
            recent_heartbeat = False
    if _is_pid_alive(pid) and recent_heartbeat:
        return int(pid)

    daemon_log = LOG_ROOT / "self-heal-daemon.log"
    worker_log = open(str(daemon_log), "a", encoding="utf-8")
    cmd = [sys.executable, "-m", "engine.self_heal_worker", "--loop"]
    creation_flags = 0
    if sys.platform == "win32":
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS

    proc = subprocess.Popen(
        cmd,
        cwd=str(PROJECT_ROOT),
        stdout=worker_log,
        stderr=subprocess.STDOUT,
        creationflags=creation_flags,
    )
    worker_log.close()
    _upsert_runtime(
        status="starting",
        current_case_id=None,
        worker_pid=proc.pid,
        agent_name=agent_name,
        last_message="Self-heal daemon starting.",
    )
    log.info("Self-heal daemon spawned: pid=%s", proc.pid)
    return int(proc.pid)


def queue_failure_case(
    *,
    parent_run_id: str,
    layer: str,
    landing_entity_id: int,
    target_entity_id: int,
    latest_error: str,
    error_suggestion: str | None = None,
    context: dict[str, Any] | None = None,
) -> int | None:
    settings = SelfHealSettings.from_env()
    open_case = _lookup_open_case(parent_run_id, layer, target_entity_id)
    if open_case:
        _update_case(
            int(open_case["id"]),
            LatestError=latest_error[:4000],
            ErrorSuggestion=(error_suggestion or "")[:2000],
            ContextJson=_json_dumps(context or {}),
        )
        return int(open_case["id"])

    failure_fingerprint = hashlib.sha1(
        f"{parent_run_id}|{layer}|{target_entity_id}|{latest_error}".encode("utf-8", errors="ignore")
    ).hexdigest()
    status = "queued" if settings.enabled and settings.selected_agent else "disabled"
    current_step = "queued_for_self_heal" if status == "queued" else "disabled"

    conn = _with_conn()
    try:
        cursor = conn.execute(
            "INSERT INTO self_heal_cases "
            "(ParentRunId, LandingzoneEntityId, TargetEntityId, Layer, Status, CurrentStep, "
            " AttemptCount, MaxAttempts, AgentName, FailureFingerprint, LatestError, ErrorSuggestion, "
            " ContextJson, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                parent_run_id,
                landing_entity_id,
                target_entity_id,
                layer,
                status,
                current_step,
                settings.max_attempts,
                settings.selected_agent or "",
                failure_fingerprint,
                latest_error[:4000],
                (error_suggestion or "")[:2000],
                _json_dumps(context or {}),
                _now_iso(),
                _now_iso(),
            ),
        )
        conn.commit()
        case_id = int(cursor.lastrowid)
    finally:
        conn.close()

    _insert_event(
        case_id,
        attempt_number=0,
        step="queued",
        status=status,
        message=(
            "Failure queued for self-heal and will wait for the active engine run to go idle."
            if status == "queued"
            else "Self-heal is disabled because no supported local CLI agent was detected."
        ),
        details=context or {},
    )

    if status == "queued":
        ensure_daemon_started(settings)
    else:
        _upsert_runtime(
            status="disabled",
            current_case_id=None,
            worker_pid=None,
            agent_name=settings.selected_agent,
            last_message="No supported CLI agent is available for self-heal.",
        )
    return case_id


def get_self_heal_status_payload(
    *,
    run_id: str | None = None,
    limit_cases: int = 12,
    limit_events: int = 8,
) -> dict[str, Any]:
    settings = SelfHealSettings.from_env()
    runtime_rows = _query("SELECT * FROM self_heal_runtime WHERE RuntimeKey = ?", (RUNTIME_KEY,))
    runtime = runtime_rows[0] if runtime_rows else {}
    available_agents = settings.available_agents
    selected_agent = settings.selected_agent

    where = ""
    params: list[Any] = []
    if run_id:
        where = "WHERE shc.ParentRunId = ? OR shc.RetryRunId = ?"
        params.extend([run_id, run_id])

    summary_rows = _query(
        "SELECT Status, COUNT(*) AS cnt "
        "FROM self_heal_cases shc "
        f"{where} "
        "GROUP BY Status",
        tuple(params),
    )
    status_counts = {str(row["Status"]): int(row["cnt"]) for row in summary_rows}

    cases = _query(
        "SELECT shc.*, "
        "       le.SourceSchema AS schema_name, "
        "       le.SourceName AS table_name, "
        "       COALESCE(ds.DisplayName, ds.Name, '') AS source_display, "
        "       COALESCE(ds.Name, '') AS source_name "
        "FROM self_heal_cases shc "
        "LEFT JOIN lz_entities le ON le.LandingzoneEntityId = shc.LandingzoneEntityId "
        "LEFT JOIN datasources ds ON ds.DataSourceId = le.DataSourceId "
        f"{where} "
        "ORDER BY "
        "  CASE "
        "    WHEN shc.Status IN ('collecting_context','invoking_agent','validating_patch','retrying') THEN 0 "
        "    WHEN shc.Status IN ('queued','waiting_for_engine_idle') THEN 1 "
        "    ELSE 2 "
        "  END, "
        "  shc.updated_at DESC "
        "LIMIT ?",
        tuple(params + [limit_cases]),
    )

    case_ids = [int(case["id"]) for case in cases]
    events_by_case: dict[int, list[dict[str, Any]]] = {}
    if case_ids:
        placeholders = ",".join("?" for _ in case_ids)
        event_rows = _query(
            f"SELECT * FROM self_heal_events WHERE CaseId IN ({placeholders}) ORDER BY created_at DESC",
            tuple(case_ids),
        )
        for row in event_rows:
            bucket = events_by_case.setdefault(int(row["CaseId"]), [])
            if len(bucket) < limit_events:
                bucket.append({
                    "id": int(row["id"]),
                    "attemptNumber": int(row.get("AttemptNumber") or 0),
                    "step": row.get("Step"),
                    "status": row.get("Status"),
                    "message": row.get("Message"),
                    "details": _try_parse_json_blob(str(row.get("DetailsJson") or "")),
                    "createdAt": row.get("created_at"),
                })

    mapped_cases: list[dict[str, Any]] = []
    for case in cases:
        try:
            patch_files = json.loads(case.get("PatchFilesJson") or "[]")
            if not isinstance(patch_files, list):
                patch_files = []
        except json.JSONDecodeError:
            patch_files = []
        mapped_cases.append({
            "id": int(case["id"]),
            "parentRunId": case.get("ParentRunId"),
            "retryRunId": case.get("RetryRunId"),
            "landingEntityId": int(case.get("LandingzoneEntityId") or 0),
            "targetEntityId": int(case.get("TargetEntityId") or 0),
            "layer": case.get("Layer"),
            "status": case.get("Status"),
            "currentStep": case.get("CurrentStep"),
            "attemptCount": int(case.get("AttemptCount") or 0),
            "maxAttempts": int(case.get("MaxAttempts") or 0),
            "agentName": case.get("AgentName"),
            "latestError": case.get("LatestError"),
            "errorSuggestion": case.get("ErrorSuggestion"),
            "resolutionSummary": case.get("ResolutionSummary"),
            "source": case.get("source_display") or case.get("source_name") or "",
            "schema": case.get("schema_name") or "",
            "table": case.get("table_name") or "",
            "patchFiles": patch_files,
            "createdAt": case.get("created_at"),
            "updatedAt": case.get("updated_at"),
            "completedAt": case.get("completed_at"),
            "events": events_by_case.get(int(case["id"]), []),
        })

    runtime_heartbeat = runtime.get("HeartbeatAt")
    runtime_healthy = bool(runtime.get("WorkerPid")) and _is_pid_alive(runtime.get("WorkerPid"))
    if runtime_healthy and runtime_heartbeat:
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(str(runtime_heartbeat).replace("Z", "+00:00"))
            runtime_healthy = age <= timedelta(seconds=max(settings.poll_seconds * 4, 30))
        except Exception:
            runtime_healthy = False

    return {
        "enabled": settings.enabled and bool(selected_agent),
        "configured": settings.enabled,
        "availableAgents": available_agents,
        "selectedAgent": selected_agent,
        "note": "Failed entities are queued immediately. The daemon only mutates code and launches retries when the engine is idle.",
        "runtime": {
            "status": runtime.get("Status") or ("disabled" if not selected_agent else "idle"),
            "currentCaseId": int(runtime.get("CurrentCaseId") or 0) or None,
            "workerPid": int(runtime.get("WorkerPid") or 0) or None,
            "agentName": runtime.get("AgentName") or selected_agent,
            "heartbeatAt": runtime_heartbeat,
            "lastMessage": runtime.get("LastMessage"),
            "healthy": runtime_healthy,
        },
        "summary": {
            "queuedCount": sum(status_counts.get(status, 0) for status in ("queued", "waiting_for_engine_idle")),
            "activeCount": sum(status_counts.get(status, 0) for status in ACTIVE_CASE_STATUSES),
            "succeededCount": status_counts.get("succeeded", 0),
            "exhaustedCount": status_counts.get("exhausted", 0),
            "disabledCount": status_counts.get("disabled", 0),
            "totalCount": sum(status_counts.values()),
        },
        "cases": mapped_cases,
    }


class SelfHealDaemon:
    """Serial self-heal worker. One case at a time, one retry run at a time."""

    def __init__(self, settings: SelfHealSettings | None = None):
        self.settings = settings or SelfHealSettings.from_env()
        self.agent_name = self.settings.selected_agent
        self.pid = os.getpid()

    def run_forever(self) -> None:
        if not self.settings.enabled or not self.agent_name:
            _upsert_runtime(
                status="disabled",
                current_case_id=None,
                worker_pid=self.pid,
                agent_name=self.agent_name,
                last_message="Self-heal daemon disabled — no supported CLI agent detected.",
            )
            return

        while True:
            if self._engine_is_active():
                _upsert_runtime(
                    status="waiting_for_engine_idle",
                    current_case_id=None,
                    worker_pid=self.pid,
                    agent_name=self.agent_name,
                    last_message="Waiting for the active engine run to go idle before mutating code or launching retries.",
                )
                time.sleep(self.settings.poll_seconds)
                continue

            case = self._next_case()
            if not case:
                _upsert_runtime(
                    status="idle",
                    current_case_id=None,
                    worker_pid=self.pid,
                    agent_name=self.agent_name,
                    last_message="Self-heal queue is empty.",
                )
                time.sleep(self.settings.poll_seconds)
                continue

            self._process_case(case)

    def run_once(self) -> None:
        if self._engine_is_active():
            _upsert_runtime(
                status="waiting_for_engine_idle",
                current_case_id=None,
                worker_pid=self.pid,
                agent_name=self.agent_name,
                last_message="Waiting for engine idle.",
            )
            return
        case = self._next_case()
        if not case:
            _upsert_runtime(
                status="idle",
                current_case_id=None,
                worker_pid=self.pid,
                agent_name=self.agent_name,
                last_message="Self-heal queue is empty.",
            )
            return
        self._process_case(case)

    def _engine_is_active(self) -> bool:
        rows = _query(
            "SELECT RunId, WorkerPid, StartedAt FROM engine_runs WHERE Status IN ('InProgress', 'running')"
        )
        now = datetime.now(timezone.utc)
        for row in rows:
            started_at = row.get("StartedAt")
            if started_at:
                try:
                    started = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
                    if (now - started).total_seconds() < self.settings.engine_idle_grace_seconds:
                        return True
                except Exception:
                    pass
            if _is_pid_alive(row.get("WorkerPid")):
                return True
        return False

    def _next_case(self) -> dict[str, Any] | None:
        rows = _query(
            "SELECT * FROM self_heal_cases "
            "WHERE Status = 'queued' "
            "  AND AttemptCount < MaxAttempts "
            "ORDER BY created_at ASC LIMIT 1"
        )
        return rows[0] if rows else None

    def _process_case(self, case: dict[str, Any]) -> None:
        case_id = int(case["id"])
        _upsert_runtime(
            status="processing",
            current_case_id=case_id,
            worker_pid=self.pid,
            agent_name=self.agent_name,
            last_message=f"Processing self-heal case {case_id}.",
        )

        while True:
            case = _query("SELECT * FROM self_heal_cases WHERE id = ?", (case_id,))[0]
            attempt_number = int(case.get("AttemptCount") or 0) + 1
            if attempt_number > int(case.get("MaxAttempts") or self.settings.max_attempts):
                _update_case(
                    case_id,
                    Status="exhausted",
                    CurrentStep="exhausted",
                    completed_at=_now_iso(),
                )
                _insert_event(
                    case_id,
                    attempt_number=attempt_number - 1,
                    step="complete",
                    status="error",
                    message="Self-heal exhausted all attempts.",
                )
                return

            artifact_dir = ARTIFACT_ROOT / f"case-{case_id}" / f"attempt-{attempt_number}"
            artifact_dir.mkdir(parents=True, exist_ok=True)

            _update_case(case_id, Status="collecting_context", CurrentStep="collecting_context")
            context_bundle = self._build_case_bundle(case, artifact_dir)
            _insert_event(
                case_id,
                attempt_number=attempt_number,
                step="collect_context",
                status="info",
                message="Collected failure context and worker-log excerpts.",
                details={"artifactDir": str(artifact_dir)},
            )

            _update_case(case_id, Status="invoking_agent", CurrentStep="invoking_agent", AttemptCount=attempt_number)
            agent_result = self._invoke_agent(case, context_bundle, artifact_dir)
            _update_case(
                case_id,
                LastAgentOutput=_json_dumps(agent_result),
                PatchFilesJson=_json_dumps(agent_result.get("filesChanged", [])),
                ResolutionSummary=agent_result.get("summary", ""),
            )
            _insert_event(
                case_id,
                attempt_number=attempt_number,
                step="invoke_agent",
                status="ok" if agent_result.get("ok") else "error",
                message=agent_result.get("summary", "Agent invocation completed."),
                details={
                    "status": agent_result.get("status"),
                    "filesChanged": agent_result.get("filesChanged", []),
                    "validation": agent_result.get("validation", []),
                },
            )

            if not agent_result.get("ok") or agent_result.get("status") == "blocked":
                if attempt_number >= int(case.get("MaxAttempts") or self.settings.max_attempts):
                    _update_case(
                        case_id,
                        Status="exhausted",
                        CurrentStep="blocked",
                        LatestError=(agent_result.get("summary") or case.get("LatestError") or "")[:4000],
                        completed_at=_now_iso(),
                    )
                    _insert_event(
                        case_id,
                        attempt_number=attempt_number,
                        step="complete",
                        status="error",
                        message="Agent could not produce a safe self-heal patch before the attempt budget was exhausted.",
                    )
                    return
                _update_case(
                    case_id,
                    Status="queued",
                    CurrentStep="awaiting_next_attempt",
                    LatestError=(agent_result.get("summary") or case.get("LatestError") or "")[:4000],
                )
                time.sleep(2)
                continue

            _update_case(case_id, Status="validating_patch", CurrentStep="validating_patch")
            validation = self._run_local_validation(agent_result.get("filesChanged", []), artifact_dir)
            _insert_event(
                case_id,
                attempt_number=attempt_number,
                step="validate_patch",
                status="ok" if validation["ok"] else "error",
                message=validation["summary"],
                details={"commands": validation["commands"]},
            )
            if not validation["ok"]:
                if attempt_number >= int(case.get("MaxAttempts") or self.settings.max_attempts):
                    _update_case(
                        case_id,
                        Status="exhausted",
                        CurrentStep="validation_failed",
                        LatestError=validation["summary"][:4000],
                        completed_at=_now_iso(),
                    )
                    return
                _update_case(
                    case_id,
                    Status="queued",
                    CurrentStep="awaiting_next_attempt",
                    LatestError=validation["summary"][:4000],
                )
                time.sleep(2)
                continue

            _update_case(case_id, Status="retrying", CurrentStep="retrying_entity")
            retry = self._run_retry(case, attempt_number, artifact_dir)
            _insert_event(
                case_id,
                attempt_number=attempt_number,
                step="retry_entity",
                status="ok" if retry["ok"] else "error",
                message=retry["summary"],
                details={"retryRunId": retry.get("retryRunId")},
            )
            if retry["ok"]:
                _update_case(
                    case_id,
                    Status="succeeded",
                    CurrentStep="resolved",
                    RetryRunId=retry.get("retryRunId"),
                    LatestError="",
                    ResolutionSummary=retry["summary"][:4000],
                    completed_at=_now_iso(),
                )
                _insert_event(
                    case_id,
                    attempt_number=attempt_number,
                    step="complete",
                    status="ok",
                    message="Self-heal succeeded and the targeted retry run passed.",
                )
                return

            latest_error = retry.get("summary") or case.get("LatestError") or "Retry failed."
            if attempt_number >= int(case.get("MaxAttempts") or self.settings.max_attempts):
                _update_case(
                    case_id,
                    Status="exhausted",
                    CurrentStep="retry_failed",
                    RetryRunId=retry.get("retryRunId"),
                    LatestError=latest_error[:4000],
                    completed_at=_now_iso(),
                )
                _insert_event(
                    case_id,
                    attempt_number=attempt_number,
                    step="complete",
                    status="error",
                    message="Self-heal retry failed and the attempt budget is exhausted.",
                )
                return

            _update_case(
                case_id,
                Status="queued",
                CurrentStep="awaiting_next_attempt",
                RetryRunId=retry.get("retryRunId"),
                LatestError=latest_error[:4000],
            )
            time.sleep(2)

    def _build_case_bundle(self, case: dict[str, Any], artifact_dir: Path) -> dict[str, Any]:
        layer = str(case.get("Layer") or "landing")
        parent_run_id = str(case.get("ParentRunId") or "")
        landing_entity_id = int(case.get("LandingzoneEntityId") or 0)
        latest_logs = _query(
            "SELECT RunId, Layer, Status, ErrorType, ErrorMessage, ErrorSuggestion, SourceTable, SourceQuery, created_at "
            "FROM engine_task_log "
            "WHERE (EntityId = ? OR (RunId = ? AND Layer = ?)) "
            "ORDER BY id DESC LIMIT 12",
            (landing_entity_id, parent_run_id, layer),
        )
        worker_log = LOG_ROOT / f"engine-worker-{parent_run_id[:12]}.log"
        bundle = {
            "case": {
                "id": int(case["id"]),
                "parentRunId": parent_run_id,
                "landingEntityId": landing_entity_id,
                "targetEntityId": int(case.get("TargetEntityId") or 0),
                "layer": layer,
                "latestError": case.get("LatestError"),
                "errorSuggestion": case.get("ErrorSuggestion"),
                "attemptCount": int(case.get("AttemptCount") or 0),
                "maxAttempts": int(case.get("MaxAttempts") or 0),
            },
            "metadata": _query(
                "SELECT le.SourceSchema, le.SourceName, COALESCE(ds.DisplayName, ds.Name, '') AS source_display, COALESCE(ds.Name, '') AS source_name "
                "FROM lz_entities le "
                "LEFT JOIN datasources ds ON ds.DataSourceId = le.DataSourceId "
                "WHERE le.LandingzoneEntityId = ?",
                (landing_entity_id,),
            ),
            "recentTaskLogs": latest_logs,
            "workerLogTail": _tail_file(worker_log),
            "fileHints": PREFERRED_FILE_HINTS.get(layer, []),
        }
        (artifact_dir / "context.json").write_text(_json_dumps(bundle), encoding="utf-8")
        return bundle

    def _invoke_agent(self, case: dict[str, Any], bundle: dict[str, Any], artifact_dir: Path) -> dict[str, Any]:
        prompt = self._build_agent_prompt(case, bundle)
        prompt_path = artifact_dir / "prompt.txt"
        prompt_path.write_text(prompt, encoding="utf-8")
        schema_path = artifact_dir / "response.schema.json"
        schema_path.write_text(_json_dumps(AGENT_OUTPUT_SCHEMA), encoding="utf-8")

        stdout_path = artifact_dir / "agent.stdout.txt"
        stderr_path = artifact_dir / "agent.stderr.txt"
        response_path = artifact_dir / "agent.response.json"

        if self.agent_name == "claude":
            cmd = [
                shutil.which("claude") or "claude",
                "--print",
                "--output-format",
                "json",
                "--json-schema",
                _json_dumps(AGENT_OUTPUT_SCHEMA),
                "--permission-mode",
                "bypassPermissions",
                "--add-dir",
                str(PROJECT_ROOT),
                prompt,
            ]
        else:
            cmd = [
                shutil.which("codex") or "codex",
                "exec",
                "--cd",
                str(PROJECT_ROOT),
                "--dangerously-bypass-approvals-and-sandbox",
                "--output-schema",
                str(schema_path),
                "--output-last-message",
                str(response_path),
                prompt,
            ]

        try:
            completed = subprocess.run(
                cmd,
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                timeout=self.settings.agent_timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            stdout_path.write_text("", encoding="utf-8")
            stderr_path.write_text("Agent invocation timed out.", encoding="utf-8")
            return {
                "ok": False,
                "status": "blocked",
                "summary": f"Self-heal agent timed out after {self.settings.agent_timeout_seconds}s.",
                "filesChanged": [],
                "validation": [],
                "notes": [],
            }

        stdout_path.write_text(completed.stdout or "", encoding="utf-8")
        stderr_path.write_text(completed.stderr or "", encoding="utf-8")

        raw_payload = (response_path.read_text(encoding="utf-8", errors="ignore")
                       if response_path.exists() else (completed.stdout or ""))
        parsed = _try_parse_json_blob(raw_payload)
        parsed.setdefault("status", "blocked" if completed.returncode else "patched")
        parsed.setdefault("summary", "Agent invocation completed.")
        parsed.setdefault("filesChanged", [])
        parsed.setdefault("validation", [])
        parsed.setdefault("notes", [])
        parsed["ok"] = completed.returncode == 0
        return parsed

    def _build_agent_prompt(self, case: dict[str, Any], bundle: dict[str, Any]) -> str:
        metadata = (bundle.get("metadata") or [{}])[0] if bundle.get("metadata") else {}
        file_hints = "\n".join(f"- `{path}`" for path in bundle.get("fileHints", []))
        recent_task_logs = _json_dumps(bundle.get("recentTaskLogs", []))[:5000]
        worker_log_tail = str(bundle.get("workerLogTail") or "")[:6000]
        return textwrap.dedent(
            f"""
            You are the bounded self-heal worker for the `FMD_FRAMEWORK` repository.

            Objective:
            - Fix the root cause of a single pipeline failure.
            - Apply the smallest defensible patch.
            - Validate the patch locally.
            - Stop after the patch + validation; do not start long-running services.

            Hard constraints:
            - Never use API keys. You are already running inside the local CLI environment.
            - Do not restart the dashboard API or interfere with any active pipeline run.
            - Do not run destructive git commands.
            - Keep edits focused on the failing entity/layer below.
            - Return only JSON matching the provided schema.

            Failure case:
            - Case ID: {case["id"]}
            - Parent run: {case.get("ParentRunId")}
            - Layer: {case.get("Layer")}
            - Landing entity ID: {case.get("LandingzoneEntityId")}
            - Target entity ID: {case.get("TargetEntityId")}
            - Source: {metadata.get("source_display") or metadata.get("source_name") or ""}
            - Schema.table: {metadata.get("SourceSchema") or ""}.{metadata.get("SourceName") or ""}
            - Latest error: {case.get("LatestError") or ""}
            - Error suggestion: {case.get("ErrorSuggestion") or ""}

            Preferred file hints:
            {file_hints or "- No file hints available."}

            Recent structured task-log context:
            {recent_task_logs}

            Worker log tail:
            {worker_log_tail}

            Required local validation:
            - Run `python -m py_compile ...` for any changed Python files.
            - If you touch frontend or dashboard files under `dashboard/app`, run `npm run build` from `dashboard/app`.
            - Include every validation command you ran in the JSON response.

            JSON response rules:
            - `status = "patched"` if you changed code and the patch validates locally.
            - `status = "no_change"` if no code change was needed and you explain why.
            - `status = "blocked"` if you cannot make a safe fix within the repo.
            - `filesChanged` must list every modified file path.
            - `summary` must be concise and factual.
            """
        ).strip()

    def _run_local_validation(self, files_changed: list[str], artifact_dir: Path) -> dict[str, Any]:
        commands: list[str] = []
        failures: list[str] = []

        py_files = [path for path in files_changed if path.lower().endswith(".py")]
        if py_files:
            cmd = [sys.executable, "-m", "py_compile", *py_files]
            commands.append(" ".join(cmd))
            result = subprocess.run(cmd, cwd=str(PROJECT_ROOT), capture_output=True, text=True)
            (artifact_dir / "validate-py.stdout.txt").write_text(result.stdout or "", encoding="utf-8")
            (artifact_dir / "validate-py.stderr.txt").write_text(result.stderr or "", encoding="utf-8")
            if result.returncode != 0:
                failures.append("Python validation failed.")

        touches_dashboard = any(
            path.replace("\\", "/").startswith("dashboard/app/")
            or path.lower().endswith((".ts", ".tsx", ".js", ".jsx", ".css", ".html"))
            for path in files_changed
        )
        if touches_dashboard:
            cmd = ["npm", "run", "build"]
            commands.append("npm run build")
            result = subprocess.run(
                cmd,
                cwd=str(PROJECT_ROOT / "dashboard" / "app"),
                capture_output=True,
                text=True,
            )
            (artifact_dir / "validate-web.stdout.txt").write_text(result.stdout or "", encoding="utf-8")
            (artifact_dir / "validate-web.stderr.txt").write_text(result.stderr or "", encoding="utf-8")
            if result.returncode != 0:
                failures.append("Dashboard build failed.")

        if failures:
            return {"ok": False, "summary": " ".join(failures), "commands": commands}
        if not commands:
            return {
                "ok": True,
                "summary": "No local validation command was required because no tracked file was changed.",
                "commands": [],
            }
        return {"ok": True, "summary": "Local validation completed successfully.", "commands": commands}

    def _run_retry(self, case: dict[str, Any], attempt_number: int, artifact_dir: Path) -> dict[str, Any]:
        retry_run_id = str(uuid.uuid4())
        layer = str(case.get("Layer") or "landing")
        target_entity_id = int(case.get("TargetEntityId") or 0)
        log_path = LOG_ROOT / f"self-heal-retry-{retry_run_id[:12]}.log"
        worker_log = open(str(log_path), "w", encoding="utf-8")
        cmd = [
            sys.executable,
            "-m",
            "engine.worker",
            "--run-id",
            retry_run_id,
            "--layers",
            layer,
            "--entity-ids",
            str(target_entity_id),
            "--triggered-by",
            f"self_heal_case_{case['id']}",
        ]
        proc = subprocess.Popen(
            cmd,
            cwd=str(PROJECT_ROOT),
            stdout=worker_log,
            stderr=subprocess.STDOUT,
        )
        worker_log.close()
        _update_case(int(case["id"]), RetryRunId=retry_run_id)

        deadline = time.time() + self.settings.retry_timeout_seconds
        last_status = "InProgress"
        while time.time() < deadline:
            rows = _query("SELECT Status, ErrorSummary FROM engine_runs WHERE RunId = ?", (retry_run_id,))
            if rows:
                last_status = str(rows[0].get("Status") or "Unknown")
                if last_status not in {"InProgress", "running"}:
                    break
            time.sleep(5)

        if time.time() >= deadline and last_status in {"InProgress", "running"}:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    proc.kill()
            return {
                "ok": False,
                "retryRunId": retry_run_id,
                "summary": f"Retry run {retry_run_id[:8]} timed out after {self.settings.retry_timeout_seconds}s.",
            }

        run_rows = _query("SELECT Status, ErrorSummary FROM engine_runs WHERE RunId = ?", (retry_run_id,))
        run_row = run_rows[0] if run_rows else {}
        status = str(run_row.get("Status") or last_status)
        if status == "Succeeded":
            return {
                "ok": True,
                "retryRunId": retry_run_id,
                "summary": f"Retry run {retry_run_id[:8]} succeeded for layer {layer}.",
            }

        latest_task_log = _query(
            "SELECT ErrorMessage FROM engine_task_log WHERE RunId = ? ORDER BY id DESC LIMIT 1",
            (retry_run_id,),
        )
        latest_error = run_row.get("ErrorSummary") or ""
        if latest_task_log:
            latest_error = latest_task_log[0].get("ErrorMessage") or latest_error

        return {
            "ok": False,
            "retryRunId": retry_run_id,
            "summary": f"Retry run {retry_run_id[:8]} ended with status {status}: {latest_error or 'no error summary recorded.'}",
        }
