# dashboard/app/api/tests/test_routes_config_manager.py
"""Tests for routes/config_manager.py — parameterized SQL injection fix is the critical test."""
import json
import importlib
import sys
import pytest

import dashboard.app.api.db as db_module
import dashboard.app.api.control_plane_db as cpdb_module
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture
def tmp_db(tmp_path):
    db_path = tmp_path / "test_config_manager.db"
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
    mod_name = "dashboard.app.api.routes.config_manager"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


# ---------------------------------------------------------------------------
# Security: SQL injection fix — parameterized updates must not corrupt DB
# ---------------------------------------------------------------------------

def test_config_update_workspace_parameterized(tmp_db):
    """SQL injection attempt in workspace update must not corrupt the database.

    The fix: all UPDATE statements use ? placeholders.  A malicious value
    like the payload below must be treated as a literal string, not SQL.
    """
    db_module.execute(
        "INSERT OR IGNORE INTO workspaces (WorkspaceId, WorkspaceGuid, Name) "
        "VALUES (1, 'aaaa-bbbb-cccc', 'Dev Workspace')"
    )
    # Injection attempt in newGuid
    injection_payload = "'; UPDATE workspaces SET Name='HACKED'; --"
    status, _, body = dispatch(
        "POST", "/api/config-manager/update", {},
        {"target": "workspace", "workspaceId": 1, "newGuid": injection_payload}
    )
    # Should be 200 (parameterized) or 400 (validation), but never corrupt the DB
    assert status in (200, 400), f"Unexpected status: {status}, body: {body}"

    # Verify workspace name was not changed by the injection
    rows = db_module.query("SELECT Name FROM workspaces WHERE WorkspaceId = 1")
    if rows:
        assert rows[0]["Name"] != "HACKED", "SQL injection succeeded — parameterization is broken!"


def test_config_update_unknown_target_returns_400():
    status, _, body = dispatch(
        "POST", "/api/config-manager/update", {},
        {"target": "totally_unknown_target"}
    )
    assert status == 400


def test_config_update_workspace_requires_workspace_id():
    """Missing workspaceId should raise an error, not silently do nothing."""
    status, _, body = dispatch(
        "POST", "/api/config-manager/update", {},
        {"target": "workspace", "newGuid": "some-guid"}
    )
    # Should fail with 400 or 500 (KeyError on 'workspaceId'), not 200
    assert status in (400, 500)


def test_config_update_lakehouse_parameterized(tmp_db):
    db_module.execute(
        "INSERT OR IGNORE INTO lakehouses (LakehouseId, LakehouseGuid, WorkspaceGuid, Name) "
        "VALUES (1, 'lh-guid', 'ws-guid', 'TestLakehouse')"
    )
    # Injection attempt in newName
    injection = "'; DROP TABLE lakehouses; --"
    status, _, body = dispatch(
        "POST", "/api/config-manager/update", {},
        {"target": "lakehouse", "lakehouseId": 1, "newName": injection}
    )
    # DB must still exist and have the table
    rows = db_module.query("SELECT name FROM sqlite_master WHERE type='table' AND name='lakehouses'")
    assert rows, "lakehouses table was dropped — SQL injection succeeded!"


def test_config_update_connection_parameterized(tmp_db):
    db_module.execute(
        "INSERT OR IGNORE INTO connections (ConnectionId, ConnectionGuid, Name, Type, IsActive) "
        "VALUES (1, 'conn-guid', 'TestConn', 'SQL', 1)"
    )
    injection = "' OR 1=1; --"
    status, _, body = dispatch(
        "POST", "/api/config-manager/update", {},
        {"target": "connection", "connectionId": 1, "newName": injection}
    )
    assert status in (200, 400)
    # Verify only the intended row was modified, not all rows
    rows = db_module.query("SELECT Name FROM connections WHERE ConnectionId = 1")
    if rows and status == 200:
        assert rows[0]["Name"] == injection  # Stored as literal string, not interpreted as SQL


def test_config_update_datasource_parameterized(tmp_db):
    db_module.execute(
        "INSERT OR IGNORE INTO connections (ConnectionId, Name, Type, IsActive) VALUES (1, 'C', 'SQL', 1)"
    )
    db_module.execute(
        "INSERT OR IGNORE INTO datasources (DataSourceId, ConnectionId, Name, Namespace, Type, IsActive) "
        "VALUES (1, 1, 'TestDS', 'NS', 'SQL', 1)"
    )
    status, _, body = dispatch(
        "POST", "/api/config-manager/update", {},
        {"target": "datasource", "dataSourceId": 1, "newName": "'; DROP TABLE datasources; --"}
    )
    # Verify datasources table still exists
    rows = db_module.query("SELECT name FROM sqlite_master WHERE type='table' AND name='datasources'")
    assert rows, "datasources table was dropped — SQL injection succeeded!"


def test_config_update_pipeline_db_parameterized(tmp_db):
    db_module.execute(
        "INSERT OR IGNORE INTO pipelines (PipelineId, Name, IsActive) "
        "VALUES (1, 'PL_TEST', 1)"
    )
    status, _, body = dispatch(
        "POST", "/api/config-manager/update", {},
        {"target": "pipeline_db", "pipelineId": 1, "newName": "'; DELETE FROM pipelines; --"}
    )
    # pipelines table must still have the row
    rows = db_module.query("SELECT * FROM pipelines WHERE PipelineId = 1")
    assert rows, "Pipeline row was deleted — SQL injection succeeded!"


# ---------------------------------------------------------------------------
# GET config-manager
# ---------------------------------------------------------------------------

def test_get_config_manager_returns_dict():
    status, _, body = dispatch("GET", "/api/config-manager", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)
    assert "database" in result
    assert "mismatches" in result


def test_get_config_manager_database_section(tmp_db):
    status, _, body = dispatch("GET", "/api/config-manager", {}, None)
    result = json.loads(body)
    db_section = result["database"]
    assert "workspaces" in db_section
    assert "lakehouses" in db_section
    assert "connections" in db_section
    assert "datasources" in db_section
    assert "pipelines" in db_section


# ---------------------------------------------------------------------------
# GUID references
# ---------------------------------------------------------------------------

def test_references_requires_guid():
    status, _, body = dispatch("GET", "/api/config-manager/references", {}, None)
    assert status == 400


def test_references_rejects_short_guid():
    status, _, body = dispatch(
        "GET", "/api/config-manager/references", {"guid": "abc"}, None
    )
    assert status == 400


def test_references_returns_empty_for_unknown_guid():
    status, _, body = dispatch(
        "GET", "/api/config-manager/references",
        {"guid": "00000000-0000-0000-0000-000000000099"}, None
    )
    assert status == 200
    result = json.loads(body)
    assert "references" in result
    assert isinstance(result["references"], list)


def test_references_finds_workspace_guid(tmp_db):
    test_guid = "aabbccdd-1122-3344-5566-778899001122"
    db_module.execute(
        "INSERT OR IGNORE INTO workspaces (WorkspaceId, WorkspaceGuid, Name) "
        f"VALUES (50, '{test_guid}', 'RefTestWS')"
    )
    status, _, body = dispatch(
        "GET", "/api/config-manager/references",
        {"guid": test_guid}, None
    )
    assert status == 200
    result = json.loads(body)
    assert len(result["references"]) >= 1
    found = any(r.get("target") == "workspace" for r in result["references"])
    assert found, "Expected to find workspace reference"


# ---------------------------------------------------------------------------
# Notebook config
# ---------------------------------------------------------------------------

def test_get_notebook_config_returns_dict():
    status, _, body = dispatch("GET", "/api/notebook-config", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)
    assert "itemConfig" in result
    assert "varConfigFmd" in result
    assert "varFmd" in result


def test_post_notebook_config_update_rejects_unknown_target():
    status, _, body = dispatch(
        "POST", "/api/notebook-config/update", {},
        {"target": "unknown_target"}
    )
    assert status == 400
