"""Test Swarm routes — serve test-swarm run history, convergence, and iteration data.

test-swarm is a Claude Code skill that runs iterative test-fix loops.  Each run
produces a directory of JSON files under ``dashboard/app/.test-swarm-runs/<runId>/``:

    run.json             — run-level summary (status, timing, test counts)
    convergence.json     — array of {iteration, passed, failed, delta}
    iteration-<N>.json   — per-iteration detail (files changed, diffs, agent log)

Covers:
    GET /api/test-swarm/runs                         — list all runs
    GET /api/test-swarm/runs/{runId}/convergence      — convergence series for a run
    GET /api/test-swarm/runs/{runId}/iteration/{n}    — single iteration detail
"""
import json
import logging
from pathlib import Path

from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.test_swarm")

# ── Paths ──
_APP_DIR = Path(__file__).resolve().parent.parent.parent   # dashboard/app
_RUNS_DIR = _APP_DIR / ".test-swarm-runs"


def _safe_component(value: str) -> str:
    """Validate a path component — no traversal, no slashes, no empty."""
    if not value or not value.strip():
        raise HttpError("Path component must not be empty", 400)
    if ".." in value or "/" in value or "\\" in value:
        raise HttpError("Invalid path component", 400)
    return value


def _read_json(path: Path):
    """Read and parse a JSON file.  Returns None on any failure."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.debug("Failed to read %s: %s", path, exc)
        return None


# ---------------------------------------------------------------------------
# GET /api/test-swarm/runs — list all runs, newest first
# ---------------------------------------------------------------------------

@route("GET", "/api/test-swarm/runs")
def get_runs(params: dict) -> list:
    """Return a list of ``{runId, summary}`` objects for every run on disk.

    If no runs directory exists yet, returns an empty list so the page renders
    the "no runs" empty state cleanly.
    """
    if not _RUNS_DIR.is_dir():
        return []

    runs: list[dict] = []

    for entry in _RUNS_DIR.iterdir():
        if not entry.is_dir():
            continue

        run_id = entry.name
        summary = _read_json(entry / "run.json")

        runs.append({
            "runId": run_id,
            "summary": summary,
        })

    # Sort by startedAt descending (newest first), runs without a summary go last
    runs.sort(
        key=lambda r: r["summary"].get("startedAt", 0) if r["summary"] else 0,
        reverse=True,
    )

    return runs


# ---------------------------------------------------------------------------
# GET /api/test-swarm/runs/{runId}/convergence — convergence series
# ---------------------------------------------------------------------------

@route("GET", "/api/test-swarm/runs/{runId}/convergence")
def get_convergence(params: dict) -> list:
    """Return the convergence data points for a single run.

    Each point: ``{iteration, passed, failed, delta}``.
    """
    run_id = _safe_component(params.get("runId", ""))
    run_dir = _RUNS_DIR / run_id

    if not run_dir.is_dir():
        raise HttpError(f"Run {run_id!r} not found", 404)

    data = _read_json(run_dir / "convergence.json")
    if data is None:
        return []

    if not isinstance(data, list):
        log.warning("convergence.json for run %s is not a list", run_id)
        return []

    return data


# ---------------------------------------------------------------------------
# GET /api/test-swarm/runs/{runId}/iteration/{n} — single iteration detail
# ---------------------------------------------------------------------------

@route("GET", "/api/test-swarm/runs/{runId}/iteration/{n}")
def get_iteration(params: dict) -> dict:
    """Return detail for iteration *n* of a run.

    Expected fields (all optional except ``iteration``):
        iteration, timestamp, duration, testsBefore, testsAfter,
        filesChanged, summary, agentLog, diff, persistentFailures, tests
    """
    run_id = _safe_component(params.get("runId", ""))
    try:
        n = int(params.get("n", ""))
    except (ValueError, TypeError):
        raise HttpError("Iteration number must be an integer", 400)

    if n < 0 or n > 10_000:
        raise HttpError("Iteration number must be between 0 and 10000", 400)

    run_dir = _RUNS_DIR / run_id

    if not run_dir.is_dir():
        raise HttpError(f"Run {run_id!r} not found", 404)

    data = _read_json(run_dir / f"iteration-{n}.json")

    if data is None:
        raise HttpError(f"Iteration {n} not found for run {run_id!r}", 404)

    if not isinstance(data, dict):
        raise HttpError(f"Iteration {n} data is malformed", 500)

    return data
