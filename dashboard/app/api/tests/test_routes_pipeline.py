# dashboard/app/api/tests/test_routes_pipeline.py
"""Tests for routes/pipeline.py"""
import json
import importlib
import sys
import pytest

import dashboard.app.api.db as db_module
import dashboard.app.api.control_plane_db as cpdb_module
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture
def tmp_db(tmp_path):
    db_path = tmp_path / "test_pipeline.db"
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
    mod_name = "dashboard.app.api.routes.pipeline"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


def test_get_pipelines_returns_list(tmp_db):
    # Seed a pipeline row
    db_module.execute(
        "INSERT OR IGNORE INTO pipelines (PipelineId, Name, IsActive) "
        "VALUES (1, 'PL_TEST', 1)"
    )
    status, _, body = dispatch("GET", "/api/pipelines", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, list)


def test_get_runner_state_returns_dict():
    status, _, body = dispatch("GET", "/api/runner/state", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)


def test_get_runner_sources_returns_list():
    status, _, body = dispatch("GET", "/api/runner/sources", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, list)


def test_get_runner_entities_requires_datasource_id():
    status, _, body = dispatch("GET", "/api/runner/entities", {}, None)
    assert status == 400


def test_get_runner_entities_with_id():
    status, _, body = dispatch("GET", "/api/runner/entities", {"dataSourceId": "1"}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, list)


def test_post_pipeline_trigger_requires_name():
    status, _, body = dispatch("POST", "/api/pipeline/trigger", {}, {"pipelineName": ""})
    assert status == 400


def test_post_runner_prepare_requires_datasource_ids():
    status, _, body = dispatch("POST", "/api/runner/prepare", {}, {"dataSourceIds": []})
    assert status == 400


def test_post_runner_restore_when_no_scope():
    # Reset state to inactive first
    import dashboard.app.api.routes.pipeline as pm
    pm._runner_state = {"active": False}
    status, _, body = dispatch("POST", "/api/runner/restore", {}, {})
    assert status == 200
    result = json.loads(body)
    assert result["success"] is True


def test_run_snapshot_requires_params():
    status, _, body = dispatch("GET", "/api/pipeline/run-snapshot",
                                {"workspaceGuid": "ws", "pipelineGuid": ""}, None)
    assert status == 400


def test_failure_trace_requires_params():
    status, _, body = dispatch("GET", "/api/pipeline/failure-trace",
                                {"workspaceGuid": ""}, None)
    assert status == 400


def test_get_bronze_view_returns_list():
    status, _, body = dispatch("GET", "/api/bronze-view", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_silver_view_returns_list():
    status, _, body = dispatch("GET", "/api/silver-view", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)
