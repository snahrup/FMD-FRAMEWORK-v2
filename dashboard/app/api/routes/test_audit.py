"""Test Audit routes — Playwright audit run history, status, trigger, artifacts.

Covers:
    GET  /api/audit/history                          — run history index
    GET  /api/audit/status                           — running/idle state
    POST /api/audit/run                              — trigger a new Playwright run
    GET  /api/audit/artifacts/{runId}/{testDir}/{fn}  — serve artifact files
"""
import json
import logging
import mimetypes
import os
import subprocess
import threading
from pathlib import Path

from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.test_audit")

# ── Paths ──
_APP_DIR = Path(__file__).resolve().parent.parent.parent  # dashboard/app
_HISTORY_DIR = _APP_DIR / "audit-history"
_HISTORY_INDEX = _HISTORY_DIR / "run-history.json"

# ── Process tracking ──
# Shared mutable state guarded by a lock so the poll endpoint and the
# background thread that waits on the child process don't race.
_lock = threading.Lock()
_audit_proc: subprocess.Popen | None = None
_last_exit_code: int | None = None


# ---------------------------------------------------------------------------
# GET /api/audit/history — return the run-history.json index
# ---------------------------------------------------------------------------

@route("GET", "/api/audit/history")
def get_audit_history(params: dict) -> list:
    """Return the list of past audit run summaries (newest first)."""
    if not _HISTORY_INDEX.exists():
        return []
    try:
        data = json.loads(_HISTORY_INDEX.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        return []
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("Failed to read run-history.json: %s", exc)
        return []


# ---------------------------------------------------------------------------
# GET /api/audit/status — is an audit currently running?
# ---------------------------------------------------------------------------

@route("GET", "/api/audit/status")
def get_audit_status(params: dict) -> dict:
    """Return whether an audit subprocess is running and the last exit code."""
    with _lock:
        proc = _audit_proc
        last_code = _last_exit_code

    if proc is not None:
        # Check if still alive
        retcode = proc.poll()
        if retcode is None:
            return {"status": "running", "pid": proc.pid}
        else:
            # Process finished between polls — update state
            with _lock:
                globals()["_audit_proc"] = None
                globals()["_last_exit_code"] = retcode
            return {"status": "idle", "lastExitCode": retcode}

    result: dict = {"status": "idle"}
    if last_code is not None:
        result["lastExitCode"] = last_code
    return result


# ---------------------------------------------------------------------------
# POST /api/audit/run — trigger a new Playwright audit
# ---------------------------------------------------------------------------

def _wait_for_proc(proc: subprocess.Popen) -> None:
    """Background thread: wait for the Playwright process to exit."""
    global _audit_proc, _last_exit_code
    try:
        proc.wait()
    except Exception as e:
        log.warning("Error waiting for audit process: %s", e)
    with _lock:
        _last_exit_code = proc.returncode
        _audit_proc = None


@route("POST", "/api/audit/run")
def post_audit_run(params: dict) -> dict:
    """Spawn `npx playwright test` and return immediately."""
    global _audit_proc

    with _lock:
        if _audit_proc is not None and _audit_proc.poll() is None:
            return {"status": "already_running", "pid": _audit_proc.pid}

    # Determine working directory (dashboard/app where playwright.config.ts lives)
    cwd = str(_APP_DIR)

    # Check that playwright.config.ts exists
    if not (_APP_DIR / "playwright.config.ts").exists():
        raise HttpError("playwright.config.ts not found in dashboard/app", 500)

    try:
        # Use npx to run playwright. On Windows, npx.cmd is the executable
        # in Git Bash / MSYS2 environments.
        npx = "npx.cmd" if os.name == "nt" else "npx"
        proc = subprocess.Popen(
            [npx, "playwright", "test"],
            cwd=cwd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            # Detach from parent on Windows so server shutdown doesn't kill it
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
    except FileNotFoundError:
        raise HttpError("npx not found — ensure Node.js is on PATH", 500)
    except Exception as exc:
        raise HttpError(f"Failed to start Playwright: {exc}", 500)

    with _lock:
        _audit_proc = proc

    # Background thread to reap the process
    t = threading.Thread(target=_wait_for_proc, args=(proc,), daemon=True)
    t.start()

    log.info("Audit run started (pid=%d)", proc.pid)
    return {"status": "started", "pid": proc.pid}


# ---------------------------------------------------------------------------
# GET /api/audit/artifacts/{runId}/{testDir}/{fn} — serve artifact files
# ---------------------------------------------------------------------------

# MIME types for common test artifacts
_ARTIFACT_MIMES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".zip": "application/zip",
    ".json": "application/json",
    ".md": "text/markdown",
    ".txt": "text/plain",
}


@route("GET", "/api/audit/artifacts/{runId}/{testDir}/{fn}")
def get_audit_artifact(params: dict) -> dict:
    """Placeholder — binary artifact serving is handled by serve_audit_artifact()
    in server.py do_GET before router dispatch.  This registration ensures the
    route appears in the route table for discoverability."""
    raise HttpError("Artifact route must be served via serve_audit_artifact()", 500)


def serve_audit_artifact(handler, run_id: str, test_dir: str, filename: str) -> bool:
    """Serve a binary artifact file directly to the HTTP handler.

    Called from server.py do_GET for paths matching /api/audit/artifacts/*.
    Returns True if the file was served, False otherwise.
    """
    # Validate path components — no path traversal or encoded traversal
    for component in (run_id, test_dir, filename):
        if not component or ".." in component or "/" in component or "\\" in component:
            return False
        # Reject null bytes and control characters
        if any(ord(c) < 32 for c in component):
            return False

    file_path = _HISTORY_DIR / run_id / test_dir / filename

    # Ensure resolved path is still under HISTORY_DIR (defence in depth)
    try:
        file_path.resolve().relative_to(_HISTORY_DIR.resolve())
    except ValueError:
        log.warning("Artifact path escapes history directory: %s", file_path)
        return False

    if not file_path.is_file():
        return False

    ext = file_path.suffix.lower()
    content_type = _ARTIFACT_MIMES.get(
        ext, mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    )

    try:
        data = file_path.read_bytes()
    except OSError:
        log.exception("Failed to read artifact file: %s", file_path)
        return False

    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    # Cache artifacts permanently — they never change once written
    handler.send_header("Cache-Control", "public, max-age=31536000, immutable")
    if ext == ".zip":
        handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    handler.end_headers()
    handler.wfile.write(data)
    return True
