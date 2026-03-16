# dashboard/app/api/tests/test_routes_data_access.py
"""Tests for routes/data_access.py — SELECT-only enforcement is the critical security test."""
import json
import importlib
import sys
import pytest

import dashboard.app.api.db as db_module
import dashboard.app.api.control_plane_db as cpdb_module
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture
def tmp_db(tmp_path):
    db_path = tmp_path / "test_data_access.db"
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
    mod_name = "dashboard.app.api.routes.data_access"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


# ---------------------------------------------------------------------------
# Security: SELECT-only enforcement
# ---------------------------------------------------------------------------

def test_blender_rejects_delete():
    """DELETE must be rejected before any connection is opened."""
    status, _, body = dispatch(
        "POST", "/api/blender/query", {},
        {"lakehouse": "LH_DATA_LANDINGZONE", "sql": "DELETE FROM table1"}
    )
    assert status == 400
    result = json.loads(body)
    assert "error" in result


def test_blender_rejects_drop():
    status, _, body = dispatch(
        "POST", "/api/blender/query", {},
        {"lakehouse": "LH_DATA_LANDINGZONE", "sql": "DROP TABLE table1"}
    )
    assert status == 400


def test_blender_rejects_insert():
    status, _, body = dispatch(
        "POST", "/api/blender/query", {},
        {"lakehouse": "test", "sql": "INSERT INTO t VALUES (1)"}
    )
    assert status == 400


def test_blender_rejects_update():
    status, _, body = dispatch(
        "POST", "/api/blender/query", {},
        {"lakehouse": "test", "sql": "UPDATE t SET col=1"}
    )
    assert status == 400


def test_blender_rejects_truncate():
    status, _, body = dispatch(
        "POST", "/api/blender/query", {},
        {"lakehouse": "test", "sql": "TRUNCATE TABLE t"}
    )
    assert status == 400


def test_blender_rejects_exec():
    status, _, body = dispatch(
        "POST", "/api/blender/query", {},
        {"lakehouse": "test", "sql": "EXEC sp_evil"}
    )
    assert status == 400


def test_blender_accepts_select_structure():
    """A SELECT query should pass validation (may fail on actual lakehouse connection,
    but must NOT be rejected by the security check with status 400)."""
    status, _, body = dispatch(
        "POST", "/api/blender/query", {},
        {"lakehouse": "test", "sql": "SELECT 1"}
    )
    # 400 = security rejection. 200/502/404 are acceptable (lakehouse may not be available).
    assert status != 400, f"SELECT was incorrectly rejected: {body}"


# ---------------------------------------------------------------------------
# Missing required params
# ---------------------------------------------------------------------------

def test_blender_query_requires_lakehouse():
    status, _, body = dispatch("POST", "/api/blender/query", {}, {"sql": "SELECT 1"})
    assert status == 400


def test_blender_query_requires_sql():
    status, _, body = dispatch("POST", "/api/blender/query", {}, {"lakehouse": "test"})
    assert status == 400


def test_blender_profile_requires_lakehouse():
    status, _, body = dispatch("GET", "/api/blender/profile", {"table": "t"}, None)
    assert status == 400


def test_blender_profile_requires_table():
    status, _, body = dispatch("GET", "/api/blender/profile", {"lakehouse": "lh"}, None)
    assert status == 400


def test_blender_sample_requires_params():
    status, _, body = dispatch("GET", "/api/blender/sample", {}, None)
    assert status == 400


# ---------------------------------------------------------------------------
# GET endpoints that should return gracefully from SQLite
# ---------------------------------------------------------------------------

def test_blender_tables_returns_list():
    status, _, body = dispatch("GET", "/api/blender/tables", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_blender_endpoints_returns_dict():
    status, _, body = dispatch("GET", "/api/blender/endpoints", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), dict)


def test_lakehouse_counts_returns_dict():
    status, _, body = dispatch("GET", "/api/lakehouse-counts", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), dict)


def test_schema_returns_list():
    status, _, body = dispatch("GET", "/api/schema", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)
