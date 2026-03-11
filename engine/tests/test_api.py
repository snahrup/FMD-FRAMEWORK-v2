"""Unit tests for engine/api.py — no network required.

Tests the route dispatcher logic and helper functions without
starting an HTTP server or connecting to any databases.
"""

import json
from unittest.mock import MagicMock, patch

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
