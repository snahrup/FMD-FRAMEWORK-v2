#!/usr/bin/env python3
"""FMD load watchdog for scoped starts, live monitoring, and artifact snapshots.

This is the app-specific operational loop for FMD_FRAMEWORK. It does not try to
be a resident desktop agent. It gives the repo a deterministic control surface
that can:

1. Start or resume a scoped engine run
2. Attach to the active run and monitor it in real time
3. Tail the per-run worker log file
4. Refresh pipeline-integrity truth while the run is active
5. Persist fresh artifacts for Codex/Claude slash commands to inspect

Examples:
    python scripts/load_watchdog.py status
    python scripts/load_watchdog.py start --watch
    python scripts/load_watchdog.py start --sources "MES,M3 ERP" --layers landing,bronze,silver --detach-watch
    python scripts/load_watchdog.py watch
    python scripts/load_watchdog.py resume --run-id 1234 --watch
    python scripts/load_watchdog.py retry-failed --run-id 1234 --watch
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_DIR = PROJECT_ROOT / "artifacts" / "load-watchdog"
STATUS_JSON_PATH = ARTIFACT_DIR / "status.json"
STATUS_MD_PATH = ARTIFACT_DIR / "status.md"
WORKER_TAIL_PATH = ARTIFACT_DIR / "worker-tail.log"
WATCH_STATE_PATH = ARTIFACT_DIR / "watch-state.json"
DEFAULT_API_BASE = os.environ.get("FMD_API_BASE", "http://127.0.0.1:8787").rstrip("/")
RUNNING_STATUSES = {"inprogress", "running", "queued", "notstarted"}
TERMINAL_FAILURE_STATUSES = {"failed", "aborted", "interrupted"}


class ApiError(RuntimeError):
    """HTTP/API failure."""


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_artifact_dir() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


def parse_csv_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def normalize_run_status(status: str | None) -> str:
    return str(status or "").strip().lower()


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_artifact_dir()
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    ensure_artifact_dir()
    path.write_text(text, encoding="utf-8")


def tail_file_lines(path: Path, max_lines: int = 80) -> list[str]:
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            return list(deque((line.rstrip("\n") for line in handle), maxlen=max_lines))
    except OSError:
        return []


class ApiClient:
    def __init__(self, base_url: str, timeout_seconds: int = 30, retries: int = 3, retry_delay_seconds: float = 1.5):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.retries = max(retries, 1)
        self.retry_delay_seconds = max(retry_delay_seconds, 0.1)

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self.base_url}{path if path.startswith('/') else '/' + path}"
        body: bytes | None = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=headers, method=method.upper())
        last_error: Exception | None = None
        for attempt in range(1, self.retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_seconds) as response:
                    raw = response.read().decode("utf-8")
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", errors="replace")
                try:
                    data = json.loads(raw) if raw else {}
                except json.JSONDecodeError:
                    data = {"error": raw or f"HTTP {exc.code}"}
                raise ApiError(f"{method.upper()} {path} failed ({exc.code}): {data}") from exc
            except (urllib.error.URLError, TimeoutError) as exc:
                last_error = exc
                if attempt >= self.retries:
                    break
                time.sleep(self.retry_delay_seconds)
        raise ApiError(f"{method.upper()} {path} failed: {last_error}") from last_error

    def get(self, path: str) -> dict[str, Any]:
        return self.request("GET", path)

    def post(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.request("POST", path, payload or {})


def resolve_entity_ids_for_sources(api: ApiClient, sources: list[str]) -> list[int]:
    if not sources:
        return []
    encoded = urllib.parse.quote(",".join(sources))
    data = api.get(f"/api/lmc/entity-ids-by-source?sources={encoded}")
    return [safe_int(v) for v in data.get("entity_ids", []) if safe_int(v) > 0]


def resolve_target_run_id(api: ApiClient, explicit_run_id: str | None = None) -> str | None:
    if explicit_run_id:
        return explicit_run_id
    status = api.get("/api/engine/status")
    current_run_id = status.get("current_run_id")
    if current_run_id:
        return str(current_run_id)
    last_run = status.get("last_run") or {}
    run_id = last_run.get("run_id")
    return str(run_id) if run_id else None


def build_snapshot(api: ApiClient, explicit_run_id: str | None = None) -> dict[str, Any]:
    engine_status = api.get("/api/engine/status")
    try:
        integrity = api.get("/api/pipeline-integrity")
    except ApiError as exc:
        # Non-fatal while watching; the engine/run status is still the primary signal.
        integrity = {"summary": {}, "lastRun": {}, "error": str(exc)}
    run_id = resolve_target_run_id(api, explicit_run_id)

    run_detail: dict[str, Any] = {}
    recent_logs: dict[str, Any] = {"logs": [], "count": 0}
    failed_logs: dict[str, Any] = {"logs": [], "count": 0}
    worker_log_tail: list[str] = []
    worker_log_path = None

    if run_id:
        encoded_run_id = urllib.parse.quote(str(run_id))
        try:
            run_detail = api.get(f"/api/lmc/run/{encoded_run_id}")
        except ApiError:
            run_detail = {}
        try:
            recent_logs = api.get(f"/api/engine/logs?run_id={encoded_run_id}&limit=30")
        except ApiError:
            recent_logs = {"logs": [], "count": 0}
        try:
            failed_logs = api.get(f"/api/engine/logs?run_id={encoded_run_id}&status=failed&limit=20")
        except ApiError:
            failed_logs = {"logs": [], "count": 0}

        worker_log_path = PROJECT_ROOT / "logs" / f"engine-worker-{str(run_id)[:12]}.log"
        worker_log_tail = tail_file_lines(worker_log_path, max_lines=80)

    last_run = engine_status.get("last_run") or {}
    run_meta = run_detail.get("run") or {}
    summary = integrity.get("summary") or {}
    recent_failures = run_detail.get("failures") or []

    return {
        "generatedAt": utcnow_iso(),
        "apiBase": api.base_url,
        "runId": run_id,
        "engineStatus": engine_status.get("status"),
        "currentRunId": engine_status.get("current_run_id"),
        "lastRun": last_run,
        "run": run_meta,
        "integritySummary": summary,
        "integrityLastRun": integrity.get("lastRun") or {},
        "recentFailures": recent_failures[:10],
        "recentTaskLogs": recent_logs.get("logs", [])[:20],
        "recentFailedTaskLogs": failed_logs.get("logs", [])[:20],
        "workerLogPath": str(worker_log_path) if worker_log_path else None,
        "workerLogExists": bool(worker_log_path and worker_log_path.exists()),
        "workerLogTail": worker_log_tail,
    }


def render_snapshot_markdown(snapshot: dict[str, Any]) -> str:
    run = snapshot.get("run") or {}
    last_run = snapshot.get("lastRun") or {}
    integrity = snapshot.get("integritySummary") or {}
    failures = snapshot.get("recentFailures") or []
    recent_logs = snapshot.get("recentTaskLogs") or []
    worker_tail = snapshot.get("workerLogTail") or []

    lines: list[str] = []
    lines.append("# Load Watchdog")
    lines.append("")
    lines.append(f"- Updated: {snapshot.get('generatedAt')}")
    lines.append(f"- API: `{snapshot.get('apiBase')}`")
    lines.append(f"- Engine status: `{snapshot.get('engineStatus')}`")
    lines.append(f"- Target run: `{snapshot.get('runId') or 'none'}`")
    lines.append("")
    lines.append("## Run")
    lines.append("")
    lines.append(f"- Status: `{run.get('status') or last_run.get('status') or 'unknown'}`")
    lines.append(f"- Mode: `{run.get('mode') or last_run.get('mode') or 'unknown'}`")
    lines.append(f"- Triggered by: `{run.get('triggeredBy') or last_run.get('triggered_by') or 'unknown'}`")
    lines.append(f"- Layers: `{run.get('layers') or last_run.get('layers') or 'unknown'}`")
    lines.append(f"- Started: `{run.get('startedAt') or last_run.get('started_at') or 'unknown'}`")
    lines.append(f"- Finished: `{run.get('endedAt') or last_run.get('finished_at') or 'not finished'}`")
    lines.append(f"- Current layer: `{last_run.get('current_layer') or 'unknown'}`")
    lines.append(f"- Completed units: `{last_run.get('completed_units', 0)}`")
    lines.append(f"- Worker alive: `{last_run.get('worker_alive')}`")
    lines.append(f"- Heartbeat: `{last_run.get('heartbeat_at') or 'none'}`")
    lines.append(f"- Source filter: `{last_run.get('source_filter') or 'all'}`")
    lines.append(f"- Resolved entity count: `{last_run.get('resolved_entity_count', 0)}`")
    lines.append("")
    lines.append("## Integrity")
    lines.append("")
    lines.append(f"- In scope: `{integrity.get('inScope', 0)}`")
    lines.append(f"- Latest full chain: `{integrity.get('latestFullChain', 0)}`")
    lines.append(f"- Historical only: `{integrity.get('historicalOnly', 0)}`")
    lines.append(
        f"- Latest layer success: `LZ={integrity.get('latestLandingSuccess', 0)}` "
        f"`Bronze={integrity.get('latestBronzeSuccess', 0)}` "
        f"`Silver={integrity.get('latestSilverSuccess', 0)}`"
    )
    lines.append(f"- Gap count: `{integrity.get('gapCount', 0)}`")
    lines.append("")
    lines.append("## Recent Failures")
    lines.append("")
    if failures:
        for failure in failures[:10]:
            lines.append(
                f"- `{failure.get('Layer', failure.get('layer', '?'))}` "
                f"`{failure.get('SourceTable', failure.get('sourceTable', '?'))}` "
                f"— {failure.get('ErrorType', failure.get('errorType', 'unknown'))}: "
                f"{failure.get('ErrorMessage', failure.get('errorMessage', 'no message'))}"
            )
    else:
        lines.append("- No failed task rows in the latest snapshot.")
    lines.append("")
    lines.append("## Recent Task Logs")
    lines.append("")
    if recent_logs:
        for row in recent_logs[:12]:
            lines.append(
                f"- `{row.get('Layer', '?')}` `{row.get('Status', '?')}` "
                f"`{row.get('DataSourceName') or row.get('SourceName') or '?'}` "
                f"`{row.get('SourceName') or '?'}` "
                f"rows=`{row.get('RowsRead', 0)}` "
                f"written=`{row.get('RowsWritten', 0)}`"
            )
    else:
        lines.append("- No recent structured task rows available.")
    lines.append("")
    lines.append("## Worker Log Tail")
    lines.append("")
    lines.append(f"- Path: `{snapshot.get('workerLogPath') or 'none'}`")
    lines.append("")
    lines.append("```text")
    if worker_tail:
        lines.extend(worker_tail[-40:])
    else:
        lines.append("(no worker log lines available)")
    lines.append("```")
    lines.append("")
    return "\n".join(lines)


def persist_snapshot(snapshot: dict[str, Any], watch_pid: int | None = None) -> None:
    write_json(STATUS_JSON_PATH, snapshot)
    write_text(STATUS_MD_PATH, render_snapshot_markdown(snapshot))
    write_text(WORKER_TAIL_PATH, "\n".join(snapshot.get("workerLogTail") or []))
    write_json(
        WATCH_STATE_PATH,
        {
            "updatedAt": snapshot.get("generatedAt"),
            "runId": snapshot.get("runId"),
            "engineStatus": snapshot.get("engineStatus"),
            "watchPid": watch_pid,
            "workerLogPath": snapshot.get("workerLogPath"),
        },
    )


def evaluate_snapshot(snapshot: dict[str, Any], require_integrity: bool = True) -> int:
    run = snapshot.get("run") or {}
    last_run = snapshot.get("lastRun") or {}
    integrity = snapshot.get("integritySummary") or {}
    run_status = normalize_run_status(run.get("status") or last_run.get("status"))
    run_clean = run_status not in TERMINAL_FAILURE_STATUSES
    if not require_integrity:
        return 0 if run_clean else 1

    latest_full_chain = safe_int(integrity.get("latestFullChain"))
    in_scope = safe_int(integrity.get("inScope"))
    historical_only = safe_int(integrity.get("historicalOnly"))
    pipeline_clean = latest_full_chain == in_scope and historical_only == 0
    return 0 if run_clean and pipeline_clean else 1


def print_snapshot_summary(snapshot: dict[str, Any]) -> None:
    run = snapshot.get("run") or {}
    last_run = snapshot.get("lastRun") or {}
    integrity = snapshot.get("integritySummary") or {}
    print(f"Updated: {snapshot.get('generatedAt')}")
    print(f"Engine: {snapshot.get('engineStatus')}")
    print(f"Run: {snapshot.get('runId') or 'none'}")
    print(f"Run status: {run.get('status') or last_run.get('status') or 'unknown'}")
    print(f"Current layer: {last_run.get('current_layer') or 'unknown'}")
    print(f"Completed units: {last_run.get('completed_units', 0)}")
    print(
        "Integrity:"
        f" inScope={integrity.get('inScope', 0)}"
        f" latestFullChain={integrity.get('latestFullChain', 0)}"
        f" historicalOnly={integrity.get('historicalOnly', 0)}"
        f" gaps={integrity.get('gapCount', 0)}"
    )
    failures = snapshot.get("recentFailures") or []
    if failures:
        top = failures[0]
        print(
            "Top failure:"
            f" layer={top.get('Layer', top.get('layer', '?'))}"
            f" table={top.get('SourceTable', top.get('sourceTable', '?'))}"
            f" error={top.get('ErrorMessage', top.get('errorMessage', 'unknown'))}"
        )
    else:
        print("Top failure: none")
    print(f"Artifacts: {STATUS_MD_PATH}")


def start_run(api: ApiClient, mode: str, layers: list[str], sources: list[str], triggered_by: str) -> dict[str, Any]:
    entity_ids = resolve_entity_ids_for_sources(api, sources)
    payload: dict[str, Any] = {"mode": mode, "triggered_by": triggered_by}
    if layers:
        payload["layers"] = layers
    if sources:
        payload["source_filter"] = sources
        payload["entity_ids"] = entity_ids
        payload["resolved_entity_count"] = len(entity_ids)
    return api.post("/api/engine/start", payload)


def resume_run(api: ApiClient, run_id: str) -> dict[str, Any]:
    return api.post("/api/engine/resume", {"run_id": run_id})


def retry_failed(api: ApiClient, run_id: str, layers: list[str]) -> dict[str, Any]:
    payload: dict[str, Any] = {"run_id": run_id}
    if layers:
        payload["layers"] = layers
    return api.post("/api/engine/retry", payload)


def cleanup_runs(api: ApiClient) -> dict[str, Any]:
    return api.post("/api/engine/cleanup-runs", {})


def spawn_detached_watch(run_id: str, args: argparse.Namespace) -> int:
    cmd = [
        sys.executable,
        str(Path(__file__).resolve()),
        "watch",
        "--run-id",
        run_id,
        "--api-base",
        args.api_base,
        "--poll-seconds",
        str(args.poll_seconds),
        "--timeout-minutes",
        str(args.timeout_minutes),
    ]
    if args.no_integrity_gate:
        cmd.append("--no-integrity-gate")

    kwargs: dict[str, Any] = {
        "cwd": str(PROJECT_ROOT),
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "stdin": subprocess.DEVNULL,
        "close_fds": True,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS

    proc = subprocess.Popen(cmd, **kwargs)
    return proc.pid


def watch_run(api: ApiClient, run_id: str | None, poll_seconds: int, timeout_minutes: int, require_integrity: bool) -> int:
    started_at = time.time()
    last_signature = None
    watch_pid = os.getpid()

    while True:
        try:
            snapshot = build_snapshot(api, run_id)
        except ApiError as exc:
            print(f"Watchdog poll failed: {exc}")
            if (time.time() - started_at) > (timeout_minutes * 60):
                print(f"Watch timed out after {timeout_minutes} minutes")
                return 124
            time.sleep(max(poll_seconds, 1))
            continue
        persist_snapshot(snapshot, watch_pid=watch_pid)

        run = snapshot.get("run") or {}
        last_run = snapshot.get("lastRun") or {}
        signature = (
            snapshot.get("engineStatus"),
            snapshot.get("runId"),
            run.get("status") or last_run.get("status"),
            last_run.get("current_layer"),
            last_run.get("completed_units"),
            last_run.get("heartbeat_at"),
        )
        if signature != last_signature:
            print_snapshot_summary(snapshot)
            print("")
            last_signature = signature

        run_status = normalize_run_status(run.get("status") or last_run.get("status"))
        if run_status and run_status not in RUNNING_STATUSES:
            exit_code = evaluate_snapshot(snapshot, require_integrity=require_integrity)
            print(f"Watch finished for run {snapshot.get('runId')}: status={run_status} exit={exit_code}")
            return exit_code

        if (time.time() - started_at) > (timeout_minutes * 60):
            print(f"Watch timed out after {timeout_minutes} minutes")
            return 124

        time.sleep(max(poll_seconds, 1))


def add_common_runtime_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="Dashboard/API base URL.")
    parser.add_argument("--poll-seconds", type=int, default=10, help="Polling interval for watch mode.")
    parser.add_argument("--timeout-minutes", type=int, default=240, help="Watch timeout in minutes.")
    parser.add_argument(
        "--no-integrity-gate",
        action="store_true",
        help="Do not require full pipeline-integrity PASS for watch exit code 0.",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="FMD load watchdog.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status", help="Refresh current load watchdog snapshot.")
    status_parser.add_argument("--run-id", help="Optional explicit run ID.")
    add_common_runtime_args(status_parser)

    cleanup_parser = subparsers.add_parser("cleanup", help="Cleanup stale engine runs.")
    add_common_runtime_args(cleanup_parser)

    start_parser = subparsers.add_parser("start", help="Start a new engine run.")
    start_parser.add_argument("--mode", default="run", choices=["run", "bulk"], help="Engine run mode.")
    start_parser.add_argument("--layers", default="landing,bronze,silver", help="Comma-separated layer list.")
    start_parser.add_argument("--sources", default="", help="Comma-separated source filter. Empty means all active sources.")
    start_parser.add_argument("--triggered-by", default="load-watchdog", help="TriggeredBy marker stored on engine_runs.")
    start_parser.add_argument("--watch", action="store_true", help="Watch the run in the foreground.")
    start_parser.add_argument("--detach-watch", action="store_true", help="Launch the watch loop as a detached process.")
    add_common_runtime_args(start_parser)

    resume_parser = subparsers.add_parser("resume", help="Resume an interrupted/failed run.")
    resume_parser.add_argument("--run-id", help="Run ID to resume. Defaults to the last known run.")
    resume_parser.add_argument("--watch", action="store_true", help="Watch the resumed run in the foreground.")
    resume_parser.add_argument("--detach-watch", action="store_true", help="Launch the watch loop as a detached process.")
    add_common_runtime_args(resume_parser)

    retry_parser = subparsers.add_parser("retry-failed", help="Retry failed entities from a run.")
    retry_parser.add_argument("--run-id", help="Run ID to retry from. Defaults to the last known run.")
    retry_parser.add_argument("--layers", default="", help="Optional comma-separated layer filter for retry.")
    retry_parser.add_argument("--watch", action="store_true", help="Watch the retry run in the foreground.")
    retry_parser.add_argument("--detach-watch", action="store_true", help="Launch the watch loop as a detached process.")
    add_common_runtime_args(retry_parser)

    watch_parser = subparsers.add_parser("watch", help="Attach to an existing run and monitor it.")
    watch_parser.add_argument("--run-id", help="Optional explicit run ID. Defaults to active or latest run.")
    add_common_runtime_args(watch_parser)

    return parser


def main() -> int:
    if len(sys.argv) == 1:
        sys.argv.append("status")
    parser = build_parser()
    args = parser.parse_args()
    api = ApiClient(args.api_base)

    if args.command == "cleanup":
        print(json.dumps(cleanup_runs(api), indent=2))
        return 0

    if args.command == "status":
        snapshot = build_snapshot(api, args.run_id)
        persist_snapshot(snapshot)
        print_snapshot_summary(snapshot)
        return 0

    if args.command == "watch":
        run_id = resolve_target_run_id(api, args.run_id)
        if not run_id:
            raise SystemExit("No active or historical run found to watch.")
        return watch_run(api, run_id, args.poll_seconds, args.timeout_minutes, not args.no_integrity_gate)

    if args.command == "start":
        result = start_run(api, args.mode, parse_csv_list(args.layers), parse_csv_list(args.sources), args.triggered_by)
        run_id = str(result.get("run_id") or "")
        if not run_id:
            raise SystemExit(f"Engine start returned no run_id: {result}")
        print(json.dumps(result, indent=2))
        if args.detach_watch:
            watch_pid = spawn_detached_watch(run_id, args)
            print(f"Detached watch started: pid={watch_pid} run_id={run_id}")
            persist_snapshot(build_snapshot(api, run_id), watch_pid=watch_pid)
            return 0
        if args.watch:
            return watch_run(api, run_id, args.poll_seconds, args.timeout_minutes, not args.no_integrity_gate)
        persist_snapshot(build_snapshot(api, run_id))
        return 0

    if args.command == "resume":
        run_id = resolve_target_run_id(api, args.run_id)
        if not run_id:
            raise SystemExit("No run available to resume.")
        result = resume_run(api, run_id)
        print(json.dumps(result, indent=2))
        if args.detach_watch:
            watch_pid = spawn_detached_watch(run_id, args)
            print(f"Detached watch started: pid={watch_pid} run_id={run_id}")
            persist_snapshot(build_snapshot(api, run_id), watch_pid=watch_pid)
            return 0
        if args.watch:
            return watch_run(api, run_id, args.poll_seconds, args.timeout_minutes, not args.no_integrity_gate)
        persist_snapshot(build_snapshot(api, run_id))
        return 0

    if args.command == "retry-failed":
        run_id = resolve_target_run_id(api, args.run_id)
        if not run_id:
            raise SystemExit("No run available to retry.")
        result = retry_failed(api, run_id, parse_csv_list(args.layers))
        retry_run_id = str(result.get("run_id") or run_id)
        print(json.dumps(result, indent=2))
        if args.detach_watch:
            watch_pid = spawn_detached_watch(retry_run_id, args)
            print(f"Detached watch started: pid={watch_pid} run_id={retry_run_id}")
            persist_snapshot(build_snapshot(api, retry_run_id), watch_pid=watch_pid)
            return 0
        if args.watch:
            return watch_run(api, retry_run_id, args.poll_seconds, args.timeout_minutes, not args.no_integrity_gate)
        persist_snapshot(build_snapshot(api, retry_run_id))
        return 0

    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
