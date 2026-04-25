"""Local bridge from the FMD dashboard API to Dagster OSS."""

from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


class DagsterBridgeError(RuntimeError):
    """Raised when Dagster cannot accept or launch a run."""


@dataclass(frozen=True)
class DagsterLaunchResult:
    fmd_run_id: str
    dagster_run_id: str
    job_name: str
    ui_url: str
    log_path: str

    def to_api_payload(self, *, mode: str) -> dict[str, Any]:
        return {
            "run_id": self.fmd_run_id,
            "status": "started",
            "mode": mode,
            "orchestrator": "dagster",
            "dagster_run_id": self.dagster_run_id,
            "dagster_job": self.job_name,
            "dagster_url": self.ui_url,
            "launcher_log": self.log_path,
        }


def launch_dagster_run(
    *,
    request,
    body: dict[str, Any],
    config: dict[str, Any] | None = None,
) -> DagsterLaunchResult:
    """Launch the configured FMD Dagster job as a detached local subprocess."""

    launch_mode = _launch_mode(config, body)
    if launch_mode != "local_subprocess":
        raise DagsterBridgeError(
            f"Unsupported Dagster launch_mode {launch_mode!r}; use local_subprocess for local dashboard tests"
        )

    dagster_cfg = (config or {}).get("dagster", {}) if isinstance(config, dict) else {}
    orchestrator_path = Path(
        body.get("orchestrator_path")
        or os.getenv("FMD_ORCHESTRATOR_PATH")
        or dagster_cfg.get("orchestrator_path")
        or r"C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR"
    ).resolve()
    if not orchestrator_path.exists():
        raise DagsterBridgeError(f"FMD_ORCHESTRATOR path does not exist: {orchestrator_path}")

    python_exe = (
        body.get("dagster_python")
        or os.getenv("FMD_DAGSTER_PYTHON")
        or dagster_cfg.get("python")
        or sys.executable
    )
    if not Path(str(python_exe)).exists():
        raise DagsterBridgeError(f"Dagster Python executable does not exist: {python_exe}")

    dagster_home = (
        body.get("dagster_home")
        or os.getenv("FMD_DAGSTER_HOME")
        or dagster_cfg.get("dagster_home")
        or str(orchestrator_path)
    )
    event_log_dir = (
        body.get("event_log_dir")
        or os.getenv("FMD_DAGSTER_EVENT_LOG_DIR")
        or dagster_cfg.get("event_log_dir")
        or str(orchestrator_path / ".runs")
    )
    framework_path = (
        body.get("framework_path")
        or os.getenv("FMD_FRAMEWORK_PATH")
        or dagster_cfg.get("framework_path")
        or str(Path(__file__).resolve().parents[1])
    )
    runtime_mode = (
        body.get("dagster_mode")
        or os.getenv("FMD_DAGSTER_RUNTIME_MODE")
        or dagster_cfg.get("runtime_mode")
        or "dry_run"
    )
    if bool(body.get("dry_run")):
        runtime_mode = "dry_run"

    log_dir = orchestrator_path / ".launcher_logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{request.run_id}.log"

    cmd = [
        str(python_exe),
        "-m",
        "fmd_orchestrator.cli",
        "launch",
        "--mode",
        str(runtime_mode),
        "--framework-path",
        str(framework_path),
        "--run-id",
        str(request.run_id),
        "--triggered-by",
        str(request.triggered_by),
        "--event-log-dir",
        str(event_log_dir),
        "--dagster-home",
        str(dagster_home),
    ]
    if request.layers:
        cmd.extend(["--layers", *[str(layer) for layer in request.layers]])
    if request.entity_ids:
        cmd.extend(["--entity-ids", *[str(entity_id) for entity_id in request.entity_ids]])
    if body.get("fail_layers"):
        cmd.extend(["--fail-layers", *[str(layer) for layer in body.get("fail_layers") or []]])

    env = os.environ.copy()
    env.setdefault("PYTHONNOUSERSITE", "1")
    env.setdefault("PYTHONLEGACYWINDOWSSTDIO", "1")
    env["DAGSTER_HOME"] = str(dagster_home)

    if os.name == "nt":
        _launch_windows_scheduled_task(
            run_id=str(request.run_id),
            cmd=cmd,
            cwd=orchestrator_path,
            log_path=log_path,
            env=env,
        )
    else:
        with log_path.open("ab") as log_handle:
            subprocess.Popen(
                cmd,
                cwd=str(orchestrator_path),
                env=env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
            )

    return DagsterLaunchResult(
        fmd_run_id=str(request.run_id),
        dagster_run_id=str(request.run_id),
        job_name=str(os.getenv("FMD_DAGSTER_JOB") or dagster_cfg.get("job_name") or "fmd_pipeline_job"),
        ui_url=_ui_url(config),
        log_path=str(log_path),
    )


def _launch_mode(config: dict[str, Any] | None, body: dict[str, Any]) -> str:
    dagster_cfg = (config or {}).get("dagster", {}) if isinstance(config, dict) else {}
    return (
        str(body.get("dagster_launch_mode") or "")
        or str(os.getenv("FMD_DAGSTER_LAUNCH_MODE") or "")
        or str(dagster_cfg.get("launch_mode") or "")
        or "local_subprocess"
    ).strip().lower()


def _launch_windows_scheduled_task(
    *,
    run_id: str,
    cmd: list[str],
    cwd: Path,
    log_path: Path,
    env: dict[str, str],
) -> None:
    """Launch through Task Scheduler so Python gets a clean Windows socket stack."""

    task_name = f"FMD_Dagster_{run_id[:8]}"
    cmd_path = log_path.with_suffix(".cmd")
    cmdline = subprocess.list2cmdline(cmd)
    cmd_path.write_text(
        "\n".join(
            [
                "@echo off",
                f'cd /d "{cwd}"',
                f'set "DAGSTER_HOME={env.get("DAGSTER_HOME", "")}"',
                f'set "PYTHONNOUSERSITE={env.get("PYTHONNOUSERSITE", "1")}"',
                f'set "PYTHONLEGACYWINDOWSSTDIO={env.get("PYTHONLEGACYWINDOWSSTDIO", "1")}"',
                f'echo === FMD Dagster scheduled launch {run_id} === >> "{log_path}"',
                f"{cmdline} >> \"{log_path}\" 2>&1",
                f'schtasks /Delete /TN "{task_name}" /F >nul 2>&1',
            ]
        )
        + "\n",
        encoding="ascii",
    )
    start_time = (datetime.now() + timedelta(minutes=5)).strftime("%H:%M")
    task_command = f'cmd.exe /c "{cmd_path}"'
    create = subprocess.run(
        [
            "schtasks",
            "/Create",
            "/TN",
            task_name,
            "/SC",
            "ONCE",
            "/ST",
            start_time,
            "/TR",
            task_command,
            "/F",
        ],
        capture_output=True,
        text=True,
    )
    if create.returncode != 0:
        raise DagsterBridgeError(f"Failed to create Dagster scheduled task: {create.stderr or create.stdout}")
    run = subprocess.run(
        ["schtasks", "/Run", "/TN", task_name],
        capture_output=True,
        text=True,
    )
    if run.returncode != 0:
        raise DagsterBridgeError(f"Failed to run Dagster scheduled task: {run.stderr or run.stdout}")


def _ui_url(config: dict[str, Any] | None) -> str:
    dagster_cfg = (config or {}).get("dagster", {}) if isinstance(config, dict) else {}
    return (
        os.getenv("FMD_DAGSTER_UI_URL")
        or dagster_cfg.get("ui_url")
        or "http://127.0.0.1:3006"
    ).rstrip("/")
