# dashboard/app/api/tests/test_routes_sql_explorer.py
"""Tests for routes/sql_explorer.py — ODBC injection fix is the critical security test."""
import json
import importlib
import sys
import pytest

import dashboard.app.api.db as db_module
import dashboard.app.api.control_plane_db as cpdb_module
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture
def tmp_db(tmp_path):
    db_path = tmp_path / "test_sql_explorer.db"
    original_db = db_module.DB_PATH
    original_cpdb = cpdb_module.DB_PATH
    db_module.DB_PATH = db_path
    cpdb_module.DB_PATH = db_path
    db_module.init_db()
    yield db_path
    db_module.DB_PATH = original_db
    cpdb_module.DB_PATH = original_cpdb


@pytest.fixture(autouse=True)
def setup(tmp_db):
    _routes.clear()
    mod_name = "dashboard.app.api.routes.sql_explorer"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


# ---------------------------------------------------------------------------
# SECURITY: ODBC injection fix — unregistered servers must be rejected
# ---------------------------------------------------------------------------

def test_rejects_unregistered_server_in_databases():
    """Unregistered server must return 403 before any ODBC connection is opened."""
    status, _, body = dispatch(
        "GET", "/api/sql-explorer/databases",
        {"server": "evil-server.example.com"}, None
    )
    assert status == 403
    result = json.loads(body)
    assert "error" in result


def test_rejects_unregistered_server_in_schemas():
    status, _, body = dispatch(
        "GET", "/api/sql-explorer/schemas",
        {"server": "evil-server.example.com", "database": "master"}, None
    )
    assert status == 403


def test_rejects_unregistered_server_in_tables():
    status, _, body = dispatch(
        "GET", "/api/sql-explorer/tables",
        {"server": "evil-server.example.com", "database": "master", "schema": "dbo"}, None
    )
    assert status == 403


def test_rejects_unregistered_server_in_columns():
    status, _, body = dispatch(
        "GET", "/api/sql-explorer/columns",
        {"server": "evil-server.example.com", "database": "db", "schema": "dbo", "table": "t"},
        None
    )
    assert status == 403


def test_rejects_unregistered_server_in_preview():
    status, _, body = dispatch(
        "GET", "/api/sql-explorer/preview",
        {"server": "evil-server.example.com", "database": "db", "schema": "dbo", "table": "t"},
        None
    )
    assert status == 403


def test_registered_server_passes_validation(tmp_db):
    """A server in the connections table should pass the allowlist check.
    The ODBC connection will likely fail (no real server), but the security
    check must pass (no 403).
    """
    db_module.execute(
        "INSERT OR IGNORE INTO connections (ConnectionId, Name, ServerName, DatabaseName, Type, IsActive) "
        "VALUES (99, 'TEST_CONN', 'legitimate-server.corp', 'testdb', 'SQL', 1)"
    )
    # Reload module so admin_config table exists in test db
    mod_name = "dashboard.app.api.routes.sql_explorer"
    importlib.reload(sys.modules[mod_name])

    status, _, body = dispatch(
        "GET", "/api/sql-explorer/databases",
        {"server": "legitimate-server.corp"}, None
    )
    # 200 (worked) or 502 (ODBC failed) or [] (no pyodbc) — but NOT 403 (security block)
    assert status != 403, f"Registered server was incorrectly blocked: {body}"


# ---------------------------------------------------------------------------
# Missing required params
# ---------------------------------------------------------------------------

def test_databases_requires_server():
    status, _, body = dispatch("GET", "/api/sql-explorer/databases", {}, None)
    assert status == 400


def test_schemas_requires_server_and_database():
    status, _, body = dispatch("GET", "/api/sql-explorer/schemas", {"server": "s"}, None)
    assert status == 400


def test_tables_requires_schema():
    status, _, body = dispatch(
        "GET", "/api/sql-explorer/tables",
        {"server": "s", "database": "d"}, None
    )
    assert status == 400


def test_columns_requires_all_params():
    status, _, body = dispatch(
        "GET", "/api/sql-explorer/columns",
        {"server": "s", "database": "d"}, None
    )
    assert status == 400


def test_preview_requires_all_params():
    status, _, body = dispatch(
        "GET", "/api/sql-explorer/preview",
        {"server": "s"}, None
    )
    assert status == 400


# ---------------------------------------------------------------------------
# Lakehouse routes — from SQLite, no ODBC needed
# ---------------------------------------------------------------------------

def test_lakehouses_returns_list():
    status, _, body = dispatch("GET", "/api/sql-explorer/lakehouses", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_lakehouse_schemas_requires_lakehouse():
    status, _, body = dispatch("GET", "/api/sql-explorer/lakehouse-schemas", {}, None)
    assert status == 400


def test_lakehouse_tables_requires_params():
    status, _, body = dispatch("GET", "/api/sql-explorer/lakehouse-tables",
                                {"lakehouse": "lh"}, None)
    assert status == 400


def test_lakehouse_columns_requires_params():
    status, _, body = dispatch("GET", "/api/sql-explorer/lakehouse-columns",
                                {"lakehouse": "lh", "schema": "dbo"}, None)
    assert status == 400


def test_lakehouse_files_requires_lakehouse():
    status, _, body = dispatch("GET", "/api/sql-explorer/lakehouse-files", {}, None)
    assert status == 400


def test_lakehouse_file_tables_requires_params():
    status, _, body = dispatch("GET", "/api/sql-explorer/lakehouse-file-tables",
                                {"lakehouse": "lh"}, None)
    assert status == 400


def test_lakehouse_file_detail_requires_params():
    status, _, body = dispatch("GET", "/api/sql-explorer/lakehouse-file-detail",
                                {"lakehouse": "lh", "namespace": "ns"}, None)
    assert status == 400


# ---------------------------------------------------------------------------
# Server label
# ---------------------------------------------------------------------------

def test_server_label_requires_both_params():
    status, _, body = dispatch("POST", "/api/sql-explorer/server-label", {}, {"server": "s"})
    assert status == 400


def test_server_label_saves_and_returns():
    # Ensure admin_config table exists (created by admin module on import)
    db_module.execute("""
        CREATE TABLE IF NOT EXISTS admin_config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    """)
    mod_name = "dashboard.app.api.routes.sql_explorer"
    importlib.reload(sys.modules[mod_name])

    status, _, body = dispatch(
        "POST", "/api/sql-explorer/server-label", {},
        {"server": "some-server", "label": "My Friendly Label"}
    )
    assert status == 200
    result = json.loads(body)
    assert result["label"] == "My Friendly Label"
    assert result["server"] == "some-server"
