# dashboard/app/api/tests/test_routes_source_manager.py
"""Tests for routes/source_manager.py"""
import json
import importlib
import sys
import pytest

import dashboard.app.api.db as db_module
import dashboard.app.api.control_plane_db as cpdb_module
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture
def tmp_db(tmp_path):
    db_path = tmp_path / "test_source_manager.db"
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
    mod_name = "dashboard.app.api.routes.source_manager"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


# ---------------------------------------------------------------------------
# Workspace / Lakehouse / Entity listing
# ---------------------------------------------------------------------------

def test_get_workspaces_returns_list():
    status, _, body = dispatch("GET", "/api/workspaces", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_lakehouses_returns_list():
    status, _, body = dispatch("GET", "/api/lakehouses", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_bronze_entities_returns_list():
    status, _, body = dispatch("GET", "/api/bronze-entities", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_silver_entities_returns_list():
    status, _, body = dispatch("GET", "/api/silver-entities", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


# ---------------------------------------------------------------------------
# Onboarding tracker
# ---------------------------------------------------------------------------

def test_get_onboarding_returns_list():
    status, _, body = dispatch("GET", "/api/onboarding", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_post_onboarding_requires_source_name():
    status, _, body = dispatch("POST", "/api/onboarding", {}, {"sourceName": ""})
    assert status == 400


def test_post_onboarding_creates_record():
    status, _, body = dispatch("POST", "/api/onboarding", {}, {"sourceName": "TEST_SOURCE"})
    assert status == 200
    result = json.loads(body)
    assert result["success"] is True
    assert result["sourceName"] == "TEST_SOURCE"


def test_post_onboarding_step_requires_fields():
    status, _, body = dispatch(
        "POST", "/api/onboarding/step", {},
        {"sourceName": "", "stepNumber": 1, "status": "complete"}
    )
    assert status == 400


def test_post_onboarding_step_rejects_invalid_status():
    status, _, body = dispatch(
        "POST", "/api/onboarding/step", {},
        {"sourceName": "TEST", "stepNumber": 1, "status": "invalid_status"}
    )
    assert status == 400


def test_post_onboarding_step_updates_correctly():
    # Create source first
    dispatch("POST", "/api/onboarding", {}, {"sourceName": "UPDATE_TEST"})
    # Update a step
    status, _, body = dispatch(
        "POST", "/api/onboarding/step", {},
        {"sourceName": "UPDATE_TEST", "stepNumber": 1, "status": "complete"}
    )
    assert status == 200
    result = json.loads(body)
    assert result["success"] is True


def test_post_onboarding_delete_requires_source_name():
    status, _, body = dispatch("POST", "/api/onboarding/delete", {}, {"sourceName": ""})
    assert status == 400


def test_post_onboarding_delete_works():
    dispatch("POST", "/api/onboarding", {}, {"sourceName": "DELETE_ME"})
    status, _, body = dispatch("POST", "/api/onboarding/delete", {}, {"sourceName": "DELETE_ME"})
    assert status == 200
    result = json.loads(body)
    assert result["success"] is True


# ---------------------------------------------------------------------------
# Source import (async)
# ---------------------------------------------------------------------------

def test_post_sources_import_requires_datasource_id():
    status, _, body = dispatch("POST", "/api/sources/import", {}, {})
    assert status == 400


def test_post_sources_import_starts_job():
    status, _, body = dispatch(
        "POST", "/api/sources/import", {},
        {"datasourceId": 1, "datasourceName": "TEST_DS", "tables": []}
    )
    assert status == 200
    result = json.loads(body)
    assert "jobId" in result
    assert result["status"] == "started"


def test_get_import_job_status_returns_404_for_unknown():
    status, _, body = dispatch(
        "GET", "/api/sources/import/nonexistent-job-id", {}, None
    )
    assert status == 404


# ---------------------------------------------------------------------------
# Source tables discovery
# ---------------------------------------------------------------------------

def test_post_source_tables_requires_server():
    status, _, body = dispatch("POST", "/api/source-tables", {}, {"database": "db"})
    assert status == 400


def test_post_source_tables_requires_database():
    status, _, body = dispatch("POST", "/api/source-tables", {}, {"server": "srv"})
    assert status == 400


# ---------------------------------------------------------------------------
# Bronze/Silver registration
# ---------------------------------------------------------------------------

def test_post_register_bronze_silver_requires_datasource():
    status, _, body = dispatch("POST", "/api/register-bronze-silver", {}, {})
    assert status == 400


def test_post_register_bronze_silver_handles_empty_datasource():
    status, _, body = dispatch(
        "POST", "/api/register-bronze-silver", {}, {"datasourceId": 9999}
    )
    assert status == 200
    result = json.loads(body)
    assert result["success"] is True


# ---------------------------------------------------------------------------
# Analyze source
# ---------------------------------------------------------------------------

def test_get_analyze_source_requires_datasource():
    status, _, body = dispatch("GET", "/api/analyze-source", {}, None)
    assert status == 400


def test_get_analyze_source_returns_error_for_missing_datasource():
    status, _, body = dispatch("GET", "/api/analyze-source", {"datasource": "9999"}, None)
    assert status == 404


# ---------------------------------------------------------------------------
# Load config
# ---------------------------------------------------------------------------

def test_get_load_config_returns_list():
    status, _, body = dispatch("GET", "/api/load-config", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_post_load_config_requires_updates():
    status, _, body = dispatch("POST", "/api/load-config", {}, {"updates": []})
    assert status == 400


def test_post_load_config_updates_entity(tmp_db):
    # Seed a datasource + LZ entity
    db_module.execute(
        "INSERT OR IGNORE INTO connections (ConnectionId, Name, Type, IsActive) VALUES (1, 'C1', 'SQL', 1)"
    )
    db_module.execute(
        "INSERT OR IGNORE INTO datasources (DataSourceId, ConnectionId, Name, Namespace, Type, IsActive) "
        "VALUES (1, 1, 'DS1', 'DS1', 'SQL', 1)"
    )
    db_module.execute(
        "INSERT OR IGNORE INTO lz_entities "
        "(LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, FileName, FilePath, FileType, IsActive) "
        "VALUES (1, 1, 'dbo', 'MyTable', 'MyTable', '/dbo/MyTable.parquet', 'parquet', 1)"
    )
    status, _, body = dispatch(
        "POST", "/api/load-config", {},
        {"updates": [{"entityId": 1, "isIncremental": True, "watermarkColumn": "UpdatedAt"}]}
    )
    assert status == 200
    result = json.loads(body)
    assert result["success"] is True
    assert result["updated"] == 1

    # Verify the update was persisted
    rows = db_module.query(
        "SELECT IsIncremental, IsIncrementalColumn FROM lz_entities WHERE LandingzoneEntityId = 1"
    )
    assert rows[0]["IsIncremental"] == 1
    assert rows[0]["IsIncrementalColumn"] == "UpdatedAt"


# ---------------------------------------------------------------------------
# Sources purge
# ---------------------------------------------------------------------------

def test_post_sources_purge_requires_source_name():
    status, _, body = dispatch("POST", "/api/sources/purge", {}, {"sourceName": ""})
    assert status == 400


def test_post_sources_purge_returns_404_for_unknown_source():
    status, _, body = dispatch("POST", "/api/sources/purge", {}, {"sourceName": "NONEXISTENT_SOURCE_XYZ"})
    assert status == 404
