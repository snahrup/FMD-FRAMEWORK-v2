# dashboard/app/api/tests/test_routes_control_plane.py
import json
import sys
import importlib
import pytest
from dashboard.app.api.router import dispatch, _routes
from dashboard.app.api import db as fmd_db
import dashboard.app.api.control_plane_db as cpdb


@pytest.fixture(autouse=True)
def setup(tmp_path):
    _routes.clear()
    fmd_db.DB_PATH = tmp_path / "test.db"
    cpdb.DB_PATH = tmp_path / "test.db"
    fmd_db.init_db()
    cpdb.init_db()

    mod_name = "dashboard.app.api.routes.control_plane"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


def test_get_connections_returns_list():
    status, _, body = dispatch("GET", "/api/connections", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_datasources_returns_list():
    status, _, body = dispatch("GET", "/api/datasources", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_entities_returns_list():
    status, _, body = dispatch("GET", "/api/entities", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_control_plane_returns_dict():
    status, _, body = dispatch("GET", "/api/control-plane", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)


def test_get_control_plane_has_required_keys():
    status, _, body = dispatch("GET", "/api/control-plane", {}, None)
    assert status == 200
    result = json.loads(body)
    assert "health" in result
    assert "summary" in result
    assert "sourceSystems" in result
    assert "pipelineHealth" in result
    assert "_source" in result
    assert result["_source"] == "sqlite"


def test_get_control_plane_summary_shape():
    status, _, body = dispatch("GET", "/api/control-plane", {}, None)
    result = json.loads(body)
    summary = result["summary"]
    assert "connections" in summary
    assert "dataSources" in summary
    assert "entities" in summary
    assert "landing" in summary["entities"]
    assert "bronze" in summary["entities"]
    assert "silver" in summary["entities"]


def test_get_execution_matrix_returns_list():
    status, _, body = dispatch("GET", "/api/execution-matrix", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_record_counts_returns_dict():
    status, _, body = dispatch("GET", "/api/record-counts", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)
    assert "sources" in result
    assert "total" in result
    assert result["_source"] == "sqlite"


def test_get_sources_returns_list():
    status, _, body = dispatch("GET", "/api/sources", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_empty_db_returns_zero_counts():
    """With an empty DB, record-counts total should be all zeros."""
    status, _, body = dispatch("GET", "/api/record-counts", {}, None)
    result = json.loads(body)
    assert result["total"]["landing"] == 0
    assert result["total"]["bronze"] == 0
    assert result["total"]["silver"] == 0


def test_connections_with_data():
    """Insert a connection row and verify it appears in /api/connections."""
    cpdb.upsert_connection({
        "ConnectionId": 1,
        "ConnectionGuid": "abc-123",
        "Name": "CON_TEST",
        "Type": "SQL",
        "ServerName": "test-server",
        "DatabaseName": "test-db",
        "IsActive": 1,
    })
    status, _, body = dispatch("GET", "/api/connections", {}, None)
    assert status == 200
    rows = json.loads(body)
    assert len(rows) == 1
    assert rows[0]["Name"] == "CON_TEST"


def test_datasources_with_data():
    """Insert a datasource and verify it appears in /api/datasources."""
    cpdb.upsert_connection({
        "ConnectionId": 1, "Name": "CON_TEST", "Type": "SQL", "IsActive": 1,
    })
    cpdb.upsert_datasource({
        "DataSourceId": 1, "ConnectionId": 1,
        "Name": "DS_MES", "Namespace": "MES", "Type": "SQL",
        "Description": "MES source", "IsActive": 1,
    })
    status, _, body = dispatch("GET", "/api/datasources", {}, None)
    assert status == 200
    rows = json.loads(body)
    assert len(rows) == 1
    assert rows[0]["Name"] == "DS_MES"
    assert rows[0]["Namespace"] == "MES"


def test_control_plane_health_setup_when_no_connections():
    """Empty DB should yield health='setup'."""
    status, _, body = dispatch("GET", "/api/control-plane", {}, None)
    result = json.loads(body)
    assert result["health"] == "setup"


def test_no_fabric_sql_fallback():
    """Routes must not import or reference query_sql."""
    import dashboard.app.api.routes.control_plane as cp_mod
    import inspect
    src = inspect.getsource(cp_mod)
    assert "query_sql" not in src
    assert "Fabric SQL" not in src
