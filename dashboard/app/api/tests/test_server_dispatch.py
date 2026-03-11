"""Verify server.py delegates to router instead of monolithic elif."""
import pytest


def test_server_do_get_uses_dispatch():
    """New server.py must call dispatch() not implement its own if/elif chain."""
    import dashboard.app.api.server as srv
    source = open(srv.__file__).read()
    assert "dispatch(" in source, "server.py must call dispatch() from router"
    # Old monolithic pattern should be largely gone
    assert source.count("elif self.path") < 5, (
        f"server.py still has {source.count('elif self.path')} `elif self.path` branches "
        "(expected < 5 after refactor)"
    )


def test_server_under_420_lines():
    """New server.py must be under 420 lines (down from 9,267).

    After the Fabric SQL purge, the Fabric auth helpers, background sync
    thread, and SQL connection code have been removed.  server.py is now
    a thin HTTP shell that delegates to routes/*.py.
    """
    import dashboard.app.api.server as srv
    source = open(srv.__file__).read()
    line_count = len(source.strip().splitlines())
    assert line_count < 420, (
        f"server.py is {line_count} lines, should be under 420"
    )


def test_server_imports_routes_package():
    """server.py must import routes package to trigger auto-registration."""
    import dashboard.app.api.server as srv
    source = open(srv.__file__).read()
    assert "dashboard.app.api.routes" in source, (
        "server.py must import dashboard.app.api.routes to auto-register all route modules"
    )


def test_server_imports_dispatch_sse():
    """server.py must import dispatch_sse for SSE route delegation."""
    import dashboard.app.api.server as srv
    source = open(srv.__file__).read()
    assert "dispatch_sse" in source, (
        "server.py must use dispatch_sse() for SSE route delegation"
    )


def test_server_has_static_file_serving():
    """server.py must retain static file serving for the React app."""
    import dashboard.app.api.server as srv
    source = open(srv.__file__).read()
    assert "serve_static" in source or "STATIC_DIR" in source, (
        "server.py must retain static file serving"
    )


def test_server_has_threaded_server():
    """ThreadedHTTPServer must still be defined for concurrent request handling."""
    import dashboard.app.api.server as srv
    assert hasattr(srv, "ThreadedHTTPServer"), (
        "server.py must define ThreadedHTTPServer"
    )


def test_server_has_dashboard_handler():
    """DashboardHandler class must be present."""
    import dashboard.app.api.server as srv
    assert hasattr(srv, "DashboardHandler"), (
        "server.py must define DashboardHandler"
    )


def test_server_preserves_config_loading():
    """CONFIG dict must be present (config.json loading preserved)."""
    import dashboard.app.api.server as srv
    assert hasattr(srv, "CONFIG"), "server.py must expose CONFIG dict"
    assert isinstance(srv.CONFIG, dict), "CONFIG must be a dict"


def test_server_no_fabric_sql_remnants():
    """server.py must not contain Fabric SQL references after the purge."""
    import dashboard.app.api.server as srv
    source = open(srv.__file__).read()
    assert "get_sql_connection" not in source, "get_sql_connection still in server.py"
    assert "query_sql" not in source, "query_sql still in server.py"
    assert "get_fabric_token" not in source, "get_fabric_token still in server.py"
    assert "SQL_SERVER" not in source, "SQL_SERVER still in server.py"
    assert "SQL_DATABASE" not in source, "SQL_DATABASE still in server.py"
    assert "_start_background_sync" not in source, "_start_background_sync still in server.py"
