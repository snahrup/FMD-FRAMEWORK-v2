# dashboard/app/api/tests/test_routes_monitoring.py
"""Tests for routes/monitoring.py"""
import json
import importlib
import sys
import pytest

import dashboard.app.api.db as db_module
import dashboard.app.api.control_plane_db as cpdb_module
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture
def tmp_db(tmp_path):
    db_path = tmp_path / "test_monitoring.db"
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
    mod_name = "dashboard.app.api.routes.monitoring"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


def test_live_monitor_returns_dict():
    status, _, body = dispatch("GET", "/api/live-monitor", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)
    assert "serverTime" in result
    assert "pipelineEvents" in result
    assert "notebookEvents" in result
    assert "copyEvents" in result


def test_live_monitor_with_minutes_param():
    status, _, body = dispatch("GET", "/api/live-monitor", {"minutes": "60"}, None)
    assert status == 200


def test_live_monitor_invalid_minutes_defaults():
    status, _, body = dispatch("GET", "/api/live-monitor", {"minutes": "notanumber"}, None)
    assert status == 200  # Falls back to 240


def test_copy_executions_returns_list():
    status, _, body = dispatch("GET", "/api/copy-executions", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_notebook_executions_returns_list():
    status, _, body = dispatch("GET", "/api/notebook-executions", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_error_intelligence_returns_dict():
    status, _, body = dispatch("GET", "/api/error-intelligence", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)
    assert "summaries" in result
    assert "errors" in result
    assert "totalErrors" in result
    assert "patternCounts" in result
    assert "severityCounts" in result


def test_dashboard_stats_returns_dict():
    status, _, body = dispatch("GET", "/api/stats", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)


def test_dashboard_stats_alias_returns_dict():
    status, _, body = dispatch("GET", "/api/dashboard-stats", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)


def test_journey_requires_entity_param():
    status, _, body = dispatch("GET", "/api/journey", {}, None)
    assert status == 400


def test_journey_requires_numeric_entity():
    status, _, body = dispatch("GET", "/api/journey", {"entity": "notanumber"}, None)
    assert status == 400


def test_journey_returns_404_for_missing_entity():
    status, _, body = dispatch("GET", "/api/journey", {"entity": "99999"}, None)
    assert status == 404
