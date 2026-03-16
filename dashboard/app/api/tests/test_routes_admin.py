# dashboard/app/api/tests/test_routes_admin.py
import os
import sys
import json
import importlib
import pytest
import dashboard.app.api.db as db_module
import dashboard.app.api.control_plane_db as cpdb_module
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture
def tmp_db(tmp_path):
    """Redirect db.DB_PATH and cpdb.DB_PATH to a temp file and initialise schema."""
    db_path = tmp_path / "test_admin.db"
    original_db = db_module.DB_PATH
    original_cpdb = cpdb_module.DB_PATH
    db_module.DB_PATH = db_path
    cpdb_module.DB_PATH = db_path
    db_module.init_db()
    yield db_path
    db_module.DB_PATH = original_db
    cpdb_module.DB_PATH = original_cpdb


@pytest.fixture(autouse=True)
def setup_admin_routes(tmp_db):
    _routes.clear()
    # Force reload so @route decorators re-register against the cleared registry.
    # On first import the module is loaded fresh; on subsequent tests we reload.
    mod_name = "dashboard.app.api.routes.admin"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


def test_health_endpoint_returns_ok():
    status, _, body = dispatch("GET", "/api/health", {}, None)
    assert status == 200
    result = json.loads(body)
    assert result["status"] == "ok"


def test_admin_config_rejects_empty_password():
    """Security fix: empty ADMIN_PASSWORD must not match empty input."""
    os.environ.pop("ADMIN_PASSWORD", None)
    status, _, body = dispatch("POST", "/api/admin/config", {}, {"password": "", "key": "x", "value": "y"})
    assert status == 403


def test_admin_config_rejects_wrong_password():
    os.environ["ADMIN_PASSWORD"] = "secret123"
    status, _, body = dispatch("POST", "/api/admin/config", {}, {"password": "wrong"})
    assert status == 403
    os.environ.pop("ADMIN_PASSWORD", None)


def test_admin_config_accepts_correct_password():
    os.environ["ADMIN_PASSWORD"] = "secret123"
    status, _, body = dispatch("POST", "/api/admin/config", {},
                                {"password": "secret123", "key": "test_key", "value": "test_val"})
    # May succeed or fail depending on db state, but should NOT be 403
    assert status != 403
    os.environ.pop("ADMIN_PASSWORD", None)
