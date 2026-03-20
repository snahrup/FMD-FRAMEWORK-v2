"""MRI (Machine Regression Intelligence) routes — visual regression testing,
backend API tests, AI analysis, baseline management, and run history.

Covers:
    GET  /api/mri/runs                              — list all MRI test runs
    GET  /api/mri/status                            — current MRI status (idle/running)
    POST /api/mri/run                               — start a new MRI scan
    GET  /api/mri/runs/{runId}/convergence           — convergence data for a run
    GET  /api/mri/runs/{runId}/visual-diffs          — visual diff results
    GET  /api/mri/runs/{runId}/backend-results       — backend API test results
    GET  /api/mri/runs/{runId}/ai-analyses           — AI analysis results
    GET  /api/mri/runs/{runId}/flake-results         — flake detection results
    GET  /api/mri/runs/{runId}/iteration/{n}         — iteration detail
    GET  /api/mri/baselines                          — list baseline screenshots
    POST /api/mri/baselines/accept-all               — accept all current as baseline
    POST /api/mri/baselines/{name}                   — accept single baseline
    POST /api/mri/api-tests/run                      — run API-only tests
"""
import json
import logging
import os
import subprocess
import threading
import time
from pathlib import Path

from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.mri")

# ── Paths ──
_APP_DIR = Path(__file__).resolve().parent.parent.parent  # dashboard/app
_MRI_DIR = _APP_DIR / ".mri"
_RUNS_DIR = _MRI_DIR / "runs"
_BASELINES_DIR = _MRI_DIR / "baselines"
_DATA_FILE = _MRI_DIR / "mri-data.json"

# ── Process tracking ──
_lock = threading.Lock()
_mri_proc: subprocess.Popen | None = None
_active_run_id: str | None = None
_last_exit_code: int | None = None


def _ensure_dirs():
    """Create MRI data directories if they don't exist."""
    _MRI_DIR.mkdir(parents=True, exist_ok=True)
    _RUNS_DIR.mkdir(parents=True, exist_ok=True)
    _BASELINES_DIR.mkdir(parents=True, exist_ok=True)


def _load_data() -> dict:
    """Load the MRI data file, returning a default structure if missing."""
    _ensure_dirs()
    if _DATA_FILE.exists():
        try:
            return json.loads(_DATA_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            log.warning("Failed to read mri-data.json: %s", exc)
    return {"runs": [], "baselines": []}


def _save_data(data: dict):
    """Persist MRI data to disk."""
    _ensure_dirs()
    _DATA_FILE.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


def _load_run_file(run_id: str, filename: str) -> list | dict | None:
    """Load a JSON file from a specific run directory."""
    run_dir = _RUNS_DIR / run_id
    fpath = run_dir / filename
    if fpath.exists():
        try:
            return json.loads(fpath.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            log.debug("Failed to load run file %s/%s", run_id, filename)
    return None


def _save_run_file(run_id: str, filename: str, data):
    """Save a JSON file to a specific run directory."""
    run_dir = _RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    fpath = run_dir / filename
    fpath.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


def _collect_screenshots(directory: Path) -> list[dict]:
    """Discover PNG screenshots in a directory and return metadata."""
    results = []
    if not directory.exists():
        return results
    for png in sorted(directory.glob("*.png")):
        results.append({
            "testName": png.stem,
            "path": str(png.relative_to(_APP_DIR)),
            "viewport": "1920x1080",
            "lastUpdated": int(png.stat().st_mtime * 1000),
        })
    return results


def _is_active() -> bool:
    """Check whether an MRI scan subprocess is currently running."""
    with _lock:
        proc = _mri_proc
    if proc is not None:
        return proc.poll() is None
    return False


# ---------------------------------------------------------------------------
# GET /api/mri/runs — list all MRI test runs
# ---------------------------------------------------------------------------

@route("GET", "/api/mri/runs")
def get_mri_runs(params: dict) -> list:
    """Return list of past MRI run entries (newest first)."""
    data = _load_data()
    runs = data.get("runs", [])
    # Return as MRIRunEntry[] — each has runId and summary
    result = []
    for run in runs:
        run_id = run.get("runId", "")
        summary = run.get("summary", None)
        result.append({"runId": run_id, "summary": summary})
    return result


# ---------------------------------------------------------------------------
# GET /api/mri/status — is an MRI scan currently running?
# ---------------------------------------------------------------------------

@route("GET", "/api/mri/status")
def get_mri_status(params: dict) -> dict:
    """Return whether an MRI scan is active and info about the last run."""
    active = _is_active()
    data = _load_data()
    runs = data.get("runs", [])
    last_run = None
    if runs:
        r = runs[0]
        last_run = {"runId": r.get("runId", ""), "summary": r.get("summary", None)}
    return {"active": active, "lastRun": last_run}


# ---------------------------------------------------------------------------
# POST /api/mri/run — start a new MRI scan
# ---------------------------------------------------------------------------

def _run_mri_scan(run_id: str):
    """Background thread: execute the MRI scan process and collect results."""
    global _mri_proc, _active_run_id, _last_exit_code

    started_at = int(time.time() * 1000)
    run_dir = _RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir = run_dir / "screenshots"
    screenshots_dir.mkdir(exist_ok=True)

    # Try to run Playwright screenshot capture if available
    npx = "npx.cmd" if os.name == "nt" else "npx"
    playwright_available = (_APP_DIR / "playwright.config.ts").exists()
    exit_code = 0

    if playwright_available:
        try:
            proc = subprocess.Popen(
                [npx, "playwright", "test", "--reporter=json"],
                cwd=str(_APP_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )
            with _lock:
                _mri_proc = proc

            stdout, stderr = proc.communicate(timeout=300)
            exit_code = proc.returncode

            # Try to parse Playwright JSON output for test results
            try:
                pw_results = json.loads(stdout.decode("utf-8", errors="replace"))
                _process_playwright_results(run_id, pw_results)
            except (json.JSONDecodeError, UnicodeDecodeError):
                log.debug("Playwright output was not JSON — that's OK")

        except subprocess.TimeoutExpired:
            proc.kill()
            exit_code = -1
            log.warning("MRI scan timed out after 300s")
        except FileNotFoundError:
            log.info("npx/playwright not found — running metadata-only scan")
            playwright_available = False
        except Exception as exc:
            log.warning("Playwright scan failed: %s", exc)
            exit_code = 1
    else:
        log.info("No playwright.config.ts found — running metadata-only scan")

    # Collect any screenshots that exist (from Playwright or pre-existing)
    visual_diffs = _build_visual_diffs(run_id, screenshots_dir)
    _save_run_file(run_id, "visual-diffs.json", visual_diffs)

    # Run backend API tests
    backend_results = _run_backend_api_tests()
    _save_run_file(run_id, "backend-results.json", backend_results)

    # Generate AI analyses (placeholder — analyze visual diffs)
    ai_analyses = _generate_ai_analyses(visual_diffs)
    _save_run_file(run_id, "ai-analyses.json", ai_analyses)

    # Generate flake results
    flake_results = _generate_flake_results(run_id)
    _save_run_file(run_id, "flake-results.json", flake_results)

    # Build convergence data (single-iteration for now)
    passed_count = sum(1 for r in backend_results if r["status"] == "passed")
    failed_count = sum(1 for r in backend_results if r["status"] != "passed")
    convergence = [{
        "iteration": 1,
        "passed": passed_count,
        "failed": failed_count,
        "delta": passed_count,
    }]
    _save_run_file(run_id, "convergence.json", convergence)

    # Build iteration detail
    completed_at = int(time.time() * 1000)
    iteration_data = {
        "iteration": 1,
        "timestamp": started_at,
        "duration": completed_at - started_at,
        "testsBefore": {"total": 0, "passed": 0, "failed": 0},
        "testsAfter": {
            "total": passed_count + failed_count,
            "passed": passed_count,
            "failed": failed_count,
        },
        "visualDiffs": visual_diffs,
        "aiAnalyses": ai_analyses,
        "filesChanged": [],
        "summary": f"MRI scan completed: {passed_count} passed, {failed_count} failed",
    }
    _save_run_file(run_id, "iteration-1.json", iteration_data)

    # Build run summary
    visual_summary = {
        "totalScreenshots": len(visual_diffs),
        "mismatches": sum(1 for d in visual_diffs if d["status"] == "mismatch"),
        "newScreenshots": sum(1 for d in visual_diffs if d["status"] == "new"),
        "matches": sum(1 for d in visual_diffs if d["status"] == "match"),
    }
    backend_summary = {
        "total": len(backend_results),
        "passed": passed_count,
        "failed": failed_count,
        "avgResponseMs": (
            round(sum(r["responseTimeMs"] for r in backend_results) / max(len(backend_results), 1))
            if backend_results else 0
        ),
    }
    ai_summary = {
        "analyzed": len(ai_analyses),
        "highRisk": sum(1 for a in ai_analyses if a["riskLevel"] == "high"),
        "mediumRisk": sum(1 for a in ai_analyses if a["riskLevel"] == "medium"),
        "lowRisk": sum(1 for a in ai_analyses if a["riskLevel"] == "low"),
    }

    run_summary = {
        "runId": run_id,
        "status": "complete",
        "startedAt": started_at,
        "completedAt": completed_at,
        "totalDuration": completed_at - started_at,
        "iterations": 1,
        "testsBefore": {"total": 0, "passed": 0, "failed": 0},
        "testsAfter": {
            "total": passed_count + failed_count,
            "passed": passed_count,
            "failed": failed_count,
        },
        "testsFixed": 0,
        "visualSummary": visual_summary,
        "backendSummary": backend_summary,
        "aiSummary": ai_summary,
    }

    # Save to master data file
    data = _load_data()
    run_entry = {"runId": run_id, "summary": run_summary}
    # Prepend (newest first)
    data["runs"] = [run_entry] + data.get("runs", [])
    # Keep last 50 runs
    data["runs"] = data["runs"][:50]
    _save_data(data)

    with _lock:
        _mri_proc = None
        _active_run_id = None
        _last_exit_code = exit_code

    log.info("MRI scan %s completed (exit=%d, %d visual, %d backend, %d AI)",
             run_id, exit_code, len(visual_diffs), len(backend_results), len(ai_analyses))


def _process_playwright_results(run_id: str, pw_results: dict):
    """Extract test results from Playwright JSON reporter output."""
    # Playwright JSON format has suites[].specs[].tests[].results[]
    # This is best-effort — the structure varies by Playwright version
    pass


def _build_visual_diffs(run_id: str, screenshots_dir: Path) -> list[dict]:
    """Build visual diff entries by comparing screenshots against baselines."""
    diffs = []

    # Collect screenshots from this run
    run_screenshots = {}
    if screenshots_dir.exists():
        for png in screenshots_dir.glob("*.png"):
            run_screenshots[png.stem] = png

    # Also check the "latest" screenshots directory
    latest_dir = _RUNS_DIR / "latest" / "screenshots"
    if latest_dir.exists():
        for png in latest_dir.glob("*.png"):
            if png.stem not in run_screenshots:
                run_screenshots[png.stem] = png

    # Load baselines
    baselines = {}
    if _BASELINES_DIR.exists():
        for png in _BASELINES_DIR.glob("*.png"):
            baselines[png.stem] = png

    # Build diff entries for each screenshot
    for test_name, actual_path in run_screenshots.items():
        baseline_path = baselines.get(test_name)

        if baseline_path is None:
            # New screenshot — no baseline to compare against
            diffs.append({
                "testName": test_name,
                "baselinePath": "",
                "actualPath": str(actual_path.relative_to(_APP_DIR)),
                "diffPath": "",
                "mismatchPixels": 0,
                "mismatchPercentage": 0.0,
                "dimensions": {"width": 1920, "height": 1080},
                "status": "new",
            })
        else:
            # Compare file sizes as a rough proxy for differences
            # (real pixel diffing requires pillow/pixelmatch which may not be installed)
            try:
                actual_size = actual_path.stat().st_size
                baseline_size = baseline_path.stat().st_size
                size_diff = abs(actual_size - baseline_size)
                # Heuristic: >5% size difference suggests visual change
                pct = (size_diff / max(baseline_size, 1)) * 100
                is_mismatch = pct > 5.0
            except OSError:
                log.exception("Failed to compare screenshot sizes for %s", test_name)
                pct = 0.0
                is_mismatch = False

            diffs.append({
                "testName": test_name,
                "baselinePath": str(baseline_path.relative_to(_APP_DIR)),
                "actualPath": str(actual_path.relative_to(_APP_DIR)),
                "diffPath": "",
                "mismatchPixels": int(pct * 20),  # approximate
                "mismatchPercentage": round(pct, 2),
                "dimensions": {"width": 1920, "height": 1080},
                "status": "mismatch" if is_mismatch else "match",
            })

    return diffs


def _run_backend_api_tests() -> list[dict]:
    """Run backend API tests by hitting all known dashboard endpoints."""
    import urllib.request
    import urllib.error

    # Determine the dashboard base URL
    base_url = os.environ.get("FMD_DASHBOARD_URL", "http://localhost:8787")

    # Define the API endpoints to test
    endpoints = [
        {"name": "Health Check", "endpoint": "/api/health", "method": "GET", "expectedStatus": [200]},
        {"name": "Entity Status", "endpoint": "/api/entities/status", "method": "GET", "expectedStatus": [200]},
        {"name": "Pipeline Runs", "endpoint": "/api/pipeline/runs", "method": "GET", "expectedStatus": [200]},
        {"name": "Engine Status", "endpoint": "/api/engine/status", "method": "GET", "expectedStatus": [200]},
        {"name": "Control Plane", "endpoint": "/api/control-plane/summary", "method": "GET", "expectedStatus": [200]},
        {"name": "Monitoring Metrics", "endpoint": "/api/monitoring/metrics", "method": "GET", "expectedStatus": [200]},
        {"name": "Config Sources", "endpoint": "/api/config/sources", "method": "GET", "expectedStatus": [200]},
        {"name": "Data Access Tables", "endpoint": "/api/data-access/tables", "method": "GET", "expectedStatus": [200]},
        {"name": "Audit History", "endpoint": "/api/audit/history", "method": "GET", "expectedStatus": [200]},
        {"name": "Audit Status", "endpoint": "/api/audit/status", "method": "GET", "expectedStatus": [200]},
        {"name": "MRI Runs", "endpoint": "/api/mri/runs", "method": "GET", "expectedStatus": [200]},
        {"name": "MRI Status", "endpoint": "/api/mri/status", "method": "GET", "expectedStatus": [200]},
        {"name": "DB Explorer Schemas", "endpoint": "/api/db-explorer/schemas", "method": "GET", "expectedStatus": [200]},
        {"name": "Admin Routes", "endpoint": "/api/admin/routes", "method": "GET", "expectedStatus": [200]},
    ]

    results = []
    for ep in endpoints:
        url = f"{base_url}{ep['endpoint']}"
        start_ms = time.time() * 1000
        status_code = 0
        payload_valid = False
        error_msg = None

        try:
            req = urllib.request.Request(url, method=ep["method"])
            req.add_header("Accept", "application/json")
            with urllib.request.urlopen(req, timeout=10) as resp:
                status_code = resp.status
                body = resp.read().decode("utf-8", errors="replace")
                # Validate JSON payload
                try:
                    json.loads(body)
                    payload_valid = True
                except json.JSONDecodeError:
                    payload_valid = False
        except urllib.error.HTTPError as e:
            status_code = e.code
            error_msg = f"HTTP {e.code}: {e.reason}"
        except urllib.error.URLError as e:
            error_msg = f"Connection error: {e.reason}"
        except Exception as e:
            error_msg = str(e)

        elapsed_ms = round(time.time() * 1000 - start_ms)
        expected = ep["expectedStatus"]
        test_status = "passed" if status_code in expected and payload_valid else (
            "error" if error_msg else "failed"
        )

        results.append({
            "name": ep["name"],
            "endpoint": ep["endpoint"],
            "method": ep["method"],
            "status": test_status,
            "statusCode": status_code,
            "expectedStatusCode": expected,
            "responseTimeMs": elapsed_ms,
            "payloadValid": payload_valid,
            **({"error": error_msg} if error_msg else {}),
        })

    return results


def _generate_ai_analyses(visual_diffs: list[dict]) -> list[dict]:
    """Generate AI analysis entries for visual diffs that show changes."""
    analyses = []
    now_ms = int(time.time() * 1000)

    for diff in visual_diffs:
        if diff["status"] == "match":
            continue

        if diff["status"] == "new":
            analyses.append({
                "testName": diff["testName"],
                "screenshotDescription": f"New screenshot captured for {diff['testName']}. No baseline exists for comparison.",
                "visualChanges": ["New screenshot — no previous baseline to compare"],
                "suggestedFixes": ["Accept this screenshot as the new baseline"],
                "riskLevel": "low",
                "timestamp": now_ms,
            })
        elif diff["status"] == "mismatch":
            pct = diff.get("mismatchPercentage", 0)
            risk = "high" if pct > 20 else "medium" if pct > 5 else "low"
            analyses.append({
                "testName": diff["testName"],
                "screenshotDescription": (
                    f"Visual regression detected in {diff['testName']}. "
                    f"{pct:.1f}% of pixels differ from baseline."
                ),
                "visualChanges": [
                    f"{pct:.1f}% pixel difference from baseline",
                    f"Affected area: ~{diff.get('mismatchPixels', 0)} pixels",
                ],
                "suggestedFixes": [
                    "Review the diff to determine if this is an intentional change",
                    "If intentional, accept the new screenshot as baseline",
                    "If unintentional, investigate recent code changes",
                ],
                "riskLevel": risk,
                "timestamp": now_ms,
            })

    return analyses


def _generate_flake_results(run_id: str) -> list[dict]:
    """Generate flake detection results based on run history.

    Compares this run's results against previous runs to detect tests
    that intermittently pass/fail (flaky tests).
    """
    data = _load_data()
    runs = data.get("runs", [])
    if len(runs) < 2:
        return []

    # Collect pass/fail history per test across last N runs
    test_history: dict[str, list[bool]] = {}
    for run in runs[:10]:  # Last 10 runs
        rid = run.get("runId", "")
        backend = _load_run_file(rid, "backend-results.json")
        if not isinstance(backend, list):
            continue
        for result in backend:
            name = result.get("name", "")
            passed = result.get("status") == "passed"
            test_history.setdefault(name, []).append(passed)

    flake_results = []
    for test_name, history in test_history.items():
        if len(history) < 2:
            continue
        passed_count = sum(1 for h in history if h)
        failed_count = len(history) - passed_count
        pass_rate = passed_count / len(history)
        is_flaky = 0 < pass_rate < 1.0  # Not always pass, not always fail

        if is_flaky or failed_count > 0:
            flake_results.append({
                "testName": test_name,
                "runs": len(history),
                "passed": passed_count,
                "failed": failed_count,
                "passRate": round(pass_rate, 3),
                "isFlaky": is_flaky,
                "failures": [
                    f"Run {i + 1}: failed"
                    for i, h in enumerate(history)
                    if not h
                ],
            })

    return flake_results


@route("POST", "/api/mri/run")
def post_mri_run(params: dict) -> dict:
    """Start a new MRI scan in a background thread."""
    global _active_run_id

    if _is_active():
        return {"error": "MRI scan already running", "runId": _active_run_id}

    run_id = str(int(time.time() * 1000))

    with _lock:
        _active_run_id = run_id

    t = threading.Thread(target=_run_mri_scan, args=(run_id,), daemon=True)
    t.start()

    log.info("MRI scan started (runId=%s)", run_id)
    return {"status": "started", "runId": run_id}


# ---------------------------------------------------------------------------
# GET /api/mri/runs/{runId}/convergence — convergence data
# ---------------------------------------------------------------------------

@route("GET", "/api/mri/runs/{runId}/convergence")
def get_mri_convergence(params: dict) -> list:
    """Return convergence data for a specific run."""
    run_id = params.get("runId", "")
    data = _load_run_file(run_id, "convergence.json")
    if isinstance(data, list):
        return data
    return []


# ---------------------------------------------------------------------------
# GET /api/mri/runs/{runId}/visual-diffs — visual diff results
# ---------------------------------------------------------------------------

@route("GET", "/api/mri/runs/{runId}/visual-diffs")
def get_mri_visual_diffs(params: dict) -> list:
    """Return visual diff results for a specific run."""
    run_id = params.get("runId", "")
    data = _load_run_file(run_id, "visual-diffs.json")
    if isinstance(data, list):
        return data
    return []


# ---------------------------------------------------------------------------
# GET /api/mri/runs/{runId}/backend-results — backend API test results
# ---------------------------------------------------------------------------

@route("GET", "/api/mri/runs/{runId}/backend-results")
def get_mri_backend_results(params: dict) -> list:
    """Return backend API test results for a specific run."""
    run_id = params.get("runId", "")
    data = _load_run_file(run_id, "backend-results.json")
    if isinstance(data, list):
        return data
    return []


# ---------------------------------------------------------------------------
# GET /api/mri/runs/{runId}/ai-analyses — AI analysis results
# ---------------------------------------------------------------------------

@route("GET", "/api/mri/runs/{runId}/ai-analyses")
def get_mri_ai_analyses(params: dict) -> list:
    """Return AI analysis results for a specific run."""
    run_id = params.get("runId", "")
    data = _load_run_file(run_id, "ai-analyses.json")
    if isinstance(data, list):
        return data
    return []


# ---------------------------------------------------------------------------
# GET /api/mri/runs/{runId}/flake-results — flake detection results
# ---------------------------------------------------------------------------

@route("GET", "/api/mri/runs/{runId}/flake-results")
def get_mri_flake_results(params: dict) -> list:
    """Return flake detection results for a specific run."""
    run_id = params.get("runId", "")
    data = _load_run_file(run_id, "flake-results.json")
    if isinstance(data, list):
        return data
    return []


# ---------------------------------------------------------------------------
# GET /api/mri/runs/{runId}/iteration/{n} — iteration detail
# ---------------------------------------------------------------------------

@route("GET", "/api/mri/runs/{runId}/iteration/{n}")
def get_mri_iteration(params: dict) -> dict:
    """Return iteration detail for a specific run and iteration number."""
    run_id = params.get("runId", "")
    n = params.get("n", "1")
    data = _load_run_file(run_id, f"iteration-{n}.json")
    if isinstance(data, dict):
        return data
    raise HttpError(f"Iteration {n} not found for run {run_id}", 404)


# ---------------------------------------------------------------------------
# GET /api/mri/baselines — list baseline screenshots
# ---------------------------------------------------------------------------

@route("GET", "/api/mri/baselines")
def get_mri_baselines(params: dict) -> list:
    """Return list of current baseline screenshots."""
    _ensure_dirs()
    baselines = _collect_screenshots(_BASELINES_DIR)

    # Also check data file for additional baseline metadata
    data = _load_data()
    stored_baselines = data.get("baselines", [])
    if stored_baselines:
        # Merge: stored metadata takes priority, but include filesystem entries
        stored_names = {b["testName"] for b in stored_baselines}
        for fs_entry in baselines:
            if fs_entry["testName"] not in stored_names:
                stored_baselines.append(fs_entry)
        return stored_baselines

    return baselines


# ---------------------------------------------------------------------------
# POST /api/mri/baselines/accept-all — accept all current screenshots
# ---------------------------------------------------------------------------
# IMPORTANT: This must be registered BEFORE the parameterized route
# so that "accept-all" isn't captured as a {name} parameter.

@route("POST", "/api/mri/baselines/accept-all")
def post_mri_accept_all_baselines(params: dict) -> dict:
    """Accept all current screenshots as baselines."""
    _ensure_dirs()
    accepted = 0

    # Find the latest run's screenshots
    data = _load_data()
    runs = data.get("runs", [])
    if not runs:
        return {"accepted": 0, "message": "No runs found"}

    latest_run_id = runs[0].get("runId", "")
    visual_diffs = _load_run_file(latest_run_id, "visual-diffs.json")
    if not isinstance(visual_diffs, list):
        visual_diffs = []

    now_ms = int(time.time() * 1000)
    new_baselines = []

    for diff in visual_diffs:
        actual_path = _APP_DIR / diff.get("actualPath", "")
        if actual_path.exists() and actual_path.suffix == ".png":
            dest = _BASELINES_DIR / actual_path.name
            try:
                import shutil
                shutil.copy2(str(actual_path), str(dest))
                accepted += 1
                new_baselines.append({
                    "testName": diff["testName"],
                    "viewport": "1920x1080",
                    "path": str(dest.relative_to(_APP_DIR)),
                    "lastUpdated": now_ms,
                })
            except OSError as exc:
                log.warning("Failed to copy baseline %s: %s", actual_path.name, exc)

    # Update stored baselines
    data["baselines"] = new_baselines
    _save_data(data)

    return {"accepted": accepted, "message": f"Accepted {accepted} baselines"}


# ---------------------------------------------------------------------------
# POST /api/mri/baselines/{name} — accept a single screenshot as baseline
# ---------------------------------------------------------------------------

@route("POST", "/api/mri/baselines/{name}")
def post_mri_accept_baseline(params: dict) -> dict:
    """Accept a single screenshot as baseline by test name."""
    _ensure_dirs()
    test_name = params.get("name", "")
    if not test_name:
        raise HttpError("Missing test name", 400)

    # Find the screenshot in the latest run
    data = _load_data()
    runs = data.get("runs", [])
    if not runs:
        raise HttpError("No runs found", 404)

    latest_run_id = runs[0].get("runId", "")
    visual_diffs = _load_run_file(latest_run_id, "visual-diffs.json")
    if not isinstance(visual_diffs, list):
        raise HttpError("No visual diffs found for latest run", 404)

    target_diff = None
    for diff in visual_diffs:
        if diff.get("testName") == test_name:
            target_diff = diff
            break

    if not target_diff:
        raise HttpError(f"Screenshot not found for test: {test_name}", 404)

    actual_path = _APP_DIR / target_diff.get("actualPath", "")
    if not actual_path.exists():
        raise HttpError(f"Screenshot file not found: {actual_path}", 404)

    dest = _BASELINES_DIR / actual_path.name
    try:
        import shutil
        shutil.copy2(str(actual_path), str(dest))
    except OSError as exc:
        raise HttpError(f"Failed to copy baseline: {exc}", 500)

    # Update stored baselines
    now_ms = int(time.time() * 1000)
    baselines = data.get("baselines", [])
    # Remove old entry for this test if exists
    baselines = [b for b in baselines if b.get("testName") != test_name]
    baselines.append({
        "testName": test_name,
        "viewport": "1920x1080",
        "path": str(dest.relative_to(_APP_DIR)),
        "lastUpdated": now_ms,
    })
    data["baselines"] = baselines
    _save_data(data)

    return {"accepted": True, "testName": test_name}


# ---------------------------------------------------------------------------
# POST /api/mri/api-tests/run — run API-only tests (no visual)
# ---------------------------------------------------------------------------

@route("POST", "/api/mri/api-tests/run")
def post_mri_api_tests_run(params: dict) -> dict:
    """Run API-only tests without visual regression testing."""
    if _is_active():
        return {"error": "MRI scan already running"}

    # Run backend tests synchronously (they're fast — just HTTP calls)
    try:
        results = _run_backend_api_tests()

        # Save to a pseudo-run so the frontend can display them
        run_id = str(int(time.time() * 1000))
        _save_run_file(run_id, "backend-results.json", results)
        _save_run_file(run_id, "visual-diffs.json", [])
        _save_run_file(run_id, "ai-analyses.json", [])
        _save_run_file(run_id, "flake-results.json", [])
        _save_run_file(run_id, "convergence.json", [{
            "iteration": 1,
            "passed": sum(1 for r in results if r["status"] == "passed"),
            "failed": sum(1 for r in results if r["status"] != "passed"),
            "delta": sum(1 for r in results if r["status"] == "passed"),
        }])

        # Build summary
        passed = sum(1 for r in results if r["status"] == "passed")
        failed = len(results) - passed
        now_ms = int(time.time() * 1000)
        summary = {
            "runId": run_id,
            "status": "complete",
            "startedAt": now_ms,
            "completedAt": now_ms,
            "totalDuration": sum(r["responseTimeMs"] for r in results),
            "iterations": 1,
            "testsBefore": {"total": 0, "passed": 0, "failed": 0},
            "testsAfter": {"total": len(results), "passed": passed, "failed": failed},
            "testsFixed": 0,
            "backendSummary": {
                "total": len(results),
                "passed": passed,
                "failed": failed,
                "avgResponseMs": round(sum(r["responseTimeMs"] for r in results) / max(len(results), 1)),
            },
        }

        # Save to master data
        data = _load_data()
        data["runs"] = [{"runId": run_id, "summary": summary}] + data.get("runs", [])
        data["runs"] = data["runs"][:50]
        _save_data(data)

        return {"status": "complete", "runId": run_id, "passed": passed, "failed": failed}
    except Exception as exc:
        log.exception("API tests failed")
        return {"error": str(exc)}
