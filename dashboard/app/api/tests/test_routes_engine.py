# dashboard/app/api/tests/test_routes_engine.py
import json
import pytest
from dashboard.app.api.router import _routes


@pytest.fixture(autouse=True)
def setup():
    _routes.clear()
    import importlib
    import dashboard.app.api.routes.engine
    importlib.reload(dashboard.app.api.routes.engine)
    yield
    _routes.clear()


def test_engine_routes_registered():
    methods_paths = [(m, p) for (m, p) in _routes.keys()]
    # At minimum, status and start should be registered
    assert ("GET", "/api/engine/status") in methods_paths
    assert ("POST", "/api/engine/start") in methods_paths


def test_all_get_routes_registered():
    methods_paths = [(m, p) for (m, p) in _routes.keys()]
    expected_get = [
        ("GET", "/api/engine/status"),
        ("GET", "/api/engine/plan"),
        ("GET", "/api/engine/logs"),
        ("GET", "/api/engine/health"),
        ("GET", "/api/engine/metrics"),
        ("GET", "/api/engine/runs"),
        ("GET", "/api/engine/validation"),
        ("GET", "/api/engine/settings"),
        ("GET", "/api/engine/entities"),
    ]
    for item in expected_get:
        assert item in methods_paths, f"Missing route: {item}"


def test_all_post_routes_registered():
    methods_paths = [(m, p) for (m, p) in _routes.keys()]
    expected_post = [
        ("POST", "/api/engine/start"),
        ("POST", "/api/engine/stop"),
        ("POST", "/api/engine/retry"),
        ("POST", "/api/engine/abort-run"),
        ("POST", "/api/engine/settings"),
        ("POST", "/api/engine/entity/{entity_id}/reset"),
    ]
    for item in expected_post:
        assert item in methods_paths, f"Missing route: {item}"


def test_sse_route_registered():
    """SSE route should be registered as a dict with sse=True."""
    key = ("GET", "/api/engine/logs/stream")
    assert key in _routes
    handler = _routes[key]
    assert isinstance(handler, dict)
    assert handler.get("sse") is True


def test_route_count():
    """Sanity check: at least 15 engine routes should be registered."""
    engine_routes = [(m, p) for (m, p) in _routes.keys() if "/api/engine" in p]
    assert len(engine_routes) >= 15
