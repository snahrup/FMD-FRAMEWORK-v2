"""Unit tests for engine/api.py — no network required.

Tests the route dispatcher logic and helper functions without
starting an HTTP server or connecting to any databases.
"""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import engine.api as api_module
import pytest
from engine.api import (
    _safe_row,
    _to_int,
    _to_float,
    _SSEHook,
    _sse_events,
    _sse_cond,
)


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------

def test_safe_row_basic():
    row = {"name": "test", "count": 42, "rate": 3.14, "empty": None, "active": True}
    safe = _safe_row(row)
    assert safe["name"] == "test"
    assert safe["count"] == 42
    assert safe["rate"] == 3.14
    assert safe["empty"] is None
    assert safe["active"] is True


def test_safe_row_datetime():
    """datetime objects should be stringified."""
    from datetime import datetime
    row = {"ts": datetime(2024, 1, 15, 10, 30, 0)}
    safe = _safe_row(row)
    assert isinstance(safe["ts"], str)
    assert "2024" in safe["ts"]


def test_safe_row_uuid():
    """UUID objects should be stringified."""
    import uuid
    row = {"id": uuid.UUID("12345678-1234-5678-1234-567812345678")}
    safe = _safe_row(row)
    assert safe["id"] == "12345678-1234-5678-1234-567812345678"


def test_to_int():
    assert _to_int(42) == 42
    assert _to_int("100") == 100
    assert _to_int(None) == 0
    assert _to_int("not a number") == 0
    assert _to_int(3.7) == 3


def test_to_float():
    assert _to_float(3.14) == 3.14
    assert _to_float("2.5") == 2.5
    assert _to_float(None) == 0.0
    assert _to_float("bad") == 0.0


# ---------------------------------------------------------------------------
# SSEHook
# ---------------------------------------------------------------------------

def test_sse_hook_publish():
    _SSEHook.clear()
    _SSEHook.publish("test_event", {"key": "value"})
    assert len(_sse_events) == 1
    assert _sse_events[0]["event"] == "test_event"
    assert _sse_events[0]["data"]["key"] == "value"
    _SSEHook.clear()


def test_sse_hook_clear():
    _SSEHook.publish("a", {})
    _SSEHook.publish("b", {})
    assert len(_sse_events) >= 2
    _SSEHook.clear()
    assert len(_sse_events) == 0


def test_sse_hook_trim():
    """Events should be trimmed when exceeding max capacity."""
    _SSEHook.clear()
    # Temporarily lower the cap
    import engine.api as api_module
    old_max = api_module._sse_max_events
    api_module._sse_max_events = 100
    try:
        for i in range(120):
            _SSEHook.publish("bulk", {"i": i})
        # Should have trimmed to ~80-100
        assert len(_sse_events) <= 100
    finally:
        api_module._sse_max_events = old_max
        _SSEHook.clear()


# ---------------------------------------------------------------------------
# Route dispatcher (basic path parsing)
# ---------------------------------------------------------------------------

def test_handle_engine_request_unknown_get():
    """Unknown GET subpath should return 404."""
    handler = _make_handler(path="/api/engine/nonexistent")
    from engine.api import handle_engine_request
    handle_engine_request(handler, method="GET", path="/api/engine/nonexistent",
                          config={})
    handler._error_response.assert_called_once()
    args = handler._error_response.call_args
    assert args[0][1] == 404


def test_handle_engine_request_unknown_post():
    """Unknown POST subpath should return 404."""
    handler = _make_handler(path="/api/engine/nonexistent", body=b"{}")
    from engine.api import handle_engine_request
    handle_engine_request(handler, method="POST", path="/api/engine/nonexistent",
                          config={})
    handler._error_response.assert_called_once()
    args = handler._error_response.call_args
    assert args[0][1] == 404


def test_handle_engine_request_method_not_allowed():
    handler = _make_handler(path="/api/engine/status")
    from engine.api import handle_engine_request
    handle_engine_request(handler, method="DELETE", path="/api/engine/status",
                          config={})
    handler._error_response.assert_called_once()
    args = handler._error_response.call_args
    assert args[0][1] == 405


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_handler(path="/api/engine/status", body=b"{}"):
    """Create a mock HTTP handler for testing."""
    handler = MagicMock()
    handler.path = path
    handler.headers = {"Content-Length": str(len(body))}
    handler.rfile.read.return_value = body
    handler._json_response = MagicMock()
    handler._error_response = MagicMock()
    handler._cors = MagicMock()
    return handler


def test_handle_retry_requires_run_id():
    handler = _make_handler(path="/api/engine/retry", body=b"{}")

    api_module._handle_retry(handler, config={}, body={"entity_ids": [101]})

    handler._error_response.assert_called_once_with("run_id required for scoped retry", 400)


def test_handle_retry_blocks_when_another_run_is_active():
    handler = _make_handler(path="/api/engine/retry", body=b"{}")

    with patch("engine.api._db_query", return_value=[{"RunId": "live-run", "WorkerPid": 4321}]), \
         patch("engine.api._is_pid_alive", return_value=True):
        api_module._handle_retry(
            handler,
            config={},
            body={"run_id": "parent-run", "entity_ids": [101]},
        )

    handler._json_response.assert_called_once()
    payload = handler._json_response.call_args.args[0]
    assert payload["error"] == "Retry is blocked while another run is active"
    assert payload["current_run_id"] == "live-run"
    assert handler._json_response.call_args.kwargs["status"] == 409


def test_handle_retry_scopes_to_parent_run_and_returns_retry_run_id():
    handler = _make_handler(path="/api/engine/retry", body=b"{}")
    engine = MagicMock()
    thread = MagicMock()

    with patch("engine.api._db_query", return_value=[]), \
         patch("engine.api._get_failed_run_entity_ids", return_value=[7, 9]), \
         patch("engine.api._get_or_create_engine", return_value=engine), \
         patch("engine.api._SSEHook.clear"), \
         patch("engine.api._publish_log"), \
         patch("engine.api.threading.Thread", return_value=thread), \
         patch("engine.api.uuid.uuid4", return_value="retry-run-1234"):
        api_module._handle_retry(
            handler,
            config={},
            body={"run_id": "parent-run"},
        )

    handler._json_response.assert_called_once()
    payload = handler._json_response.call_args.args[0]
    assert payload["run_id"] == "retry-run-1234"
    assert payload["parent_run_id"] == "parent-run"
    assert payload["status"] == "started"
    assert payload["retrying"] == 2
    assert payload["entity_ids"] == [7, 9]
    assert callable(engine.on_entity_result)
    thread.start.assert_called_once()


def test_cleanup_stale_runs_marks_dead_workers_failed_and_reconciles_extracting():
    stale_time = (datetime.now(UTC) - timedelta(minutes=20)).strftime("%Y-%m-%dT%H:%M:%SZ")

    with patch("engine.api._db_query", return_value=[{
        "RunId": "dead-run",
        "WorkerPid": 4321,
        "StartedAt": stale_time,
        "HeartbeatAt": stale_time,
    }]), \
         patch("engine.api._is_pid_alive", return_value=False), \
         patch("engine.api._db_execute") as mock_exec, \
         patch("engine.api._write_pipeline_audit_terminal") as mock_audit:
        cleaned = api_module._cleanup_stale_runs()

    assert cleaned == 1
    executed_sql = [call.args[0] for call in mock_exec.call_args_list]
    assert any("UPDATE engine_runs" in sql for sql in executed_sql)
    assert any("UPDATE engine_task_log" in sql for sql in executed_sql)
    mock_audit.assert_called_once_with("dead-run", "Failed", "Worker process died or server restarted")


def test_cleanup_stale_runs_skips_recently_heartbeating_dead_worker():
    now_str = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    with patch("engine.api._db_query", return_value=[{
        "RunId": "warm-run",
        "WorkerPid": 4321,
        "StartedAt": now_str,
        "HeartbeatAt": now_str,
    }]), \
         patch("engine.api._is_pid_alive", return_value=False), \
         patch("engine.api._db_execute") as mock_exec, \
         patch("engine.api._write_pipeline_audit_terminal") as mock_audit:
        cleaned = api_module._cleanup_stale_runs()

    assert cleaned == 0
    mock_exec.assert_not_called()
    mock_audit.assert_not_called()
