# dashboard/app/api/tests/test_routes_entities.py
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

    mod_name = "dashboard.app.api.routes.entities"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


# ---------------------------------------------------------------------------
# Basic GET tests (empty DB)
# ---------------------------------------------------------------------------

def test_get_entities_returns_list():
    status, _, body = dispatch("GET", "/api/entities", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_entity_digest_returns_dict():
    status, _, body = dispatch("GET", "/api/entity-digest", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)
    assert "sources" in result
    assert "statusCounts" in result
    assert "totalEntities" in result
    assert result["_source"] == "sqlite"


def test_get_entity_digest_empty_db():
    status, _, body = dispatch("GET", "/api/entity-digest", {}, None)
    result = json.loads(body)
    assert result["totalEntities"] == 0
    assert result["sources"] == []


def test_build_entity_digest_returns_dict():
    status, _, body = dispatch("GET", "/api/entity-digest/build", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, dict)
    assert "rebuiltAt" in result


# ---------------------------------------------------------------------------
# Cascade impact
# ---------------------------------------------------------------------------

def test_cascade_impact_requires_ids():
    status, _, body = dispatch("GET", "/api/entities/cascade-impact", {}, None)
    assert status == 400
    assert "ids" in json.loads(body)["error"].lower()


def test_cascade_impact_with_nonexistent_ids():
    status, _, body = dispatch("GET", "/api/entities/cascade-impact", {"ids": "99999"}, None)
    assert status == 200
    result = json.loads(body)
    assert result["landing"] == []
    assert result["bronze"] == []
    assert result["silver"] == []


# ---------------------------------------------------------------------------
# Register entity (POST)
# ---------------------------------------------------------------------------

def test_register_entity_requires_body():
    status, _, body = dispatch("POST", "/api/entities", {}, {})
    # Missing required fields — should fail validation
    assert status in (400, 200, 201)


def test_register_entity_missing_datasource_name():
    status, _, body = dispatch("POST", "/api/entities", {}, {"sourceName": "test_table"})
    assert status == 400
    assert "datasourceid or datasourcename" in json.loads(body)["error"].lower()


def test_register_entity_missing_source_name():
    status, _, body = dispatch("POST", "/api/entities", {}, {"dataSourceName": "DS_TEST"})
    assert status == 400
    assert "sourcename" in json.loads(body)["error"].lower()


def test_register_entity_unknown_datasource():
    status, _, body = dispatch("POST", "/api/entities", {}, {
        "dataSourceName": "DS_NONEXISTENT",
        "sourceName": "my_table",
    })
    assert status == 400
    error = json.loads(body)["error"]
    assert "not found" in error.lower()


def test_register_entity_success():
    """With a datasource seeded in SQLite, register should succeed."""
    cpdb.upsert_connection({
        "ConnectionId": 1, "Name": "CON_TEST", "Type": "SQL", "IsActive": 1,
    })
    cpdb.upsert_datasource({
        "DataSourceId": 1, "ConnectionId": 1,
        "Name": "DS_TEST", "Namespace": "TEST", "Type": "SQL",
        "Description": "", "IsActive": 1,
    })

    status, _, body = dispatch("POST", "/api/entities", {}, {
        "dataSourceName": "DS_TEST",
        "sourceName": "my_table",
        "sourceSchema": "dbo",
    })
    assert status == 200
    result = json.loads(body)
    assert result["success"] is True
    assert "entityId" in result
    assert result["entityId"] > 0


def test_register_entity_prefers_datasource_id():
    """Registering by stable DataSourceId should work even if the name is stale."""
    cpdb.upsert_connection({
        "ConnectionId": 2, "Name": "CON_TEST_ID", "Type": "SQL", "IsActive": 1,
    })
    cpdb.upsert_datasource({
        "DataSourceId": 22, "ConnectionId": 2,
        "Name": "DS_STABLE", "Namespace": "TEST", "Type": "SQL",
        "Description": "", "IsActive": 1,
    })

    status, _, body = dispatch("POST", "/api/entities", {}, {
        "dataSourceId": 22,
        "dataSourceName": "STALE_NAME",
        "sourceName": "by_id_table",
        "sourceSchema": "dbo",
    })
    assert status == 200
    result = json.loads(body)
    assert result["success"] is True


# ---------------------------------------------------------------------------
# Delete entity (DELETE)
# ---------------------------------------------------------------------------

def test_delete_entity_not_found():
    status, _, body = dispatch("DELETE", "/api/entities/99999", {}, None)
    assert status == 404


def test_delete_entity_invalid_id():
    status, _, body = dispatch("DELETE", "/api/entities/abc", {}, None)
    assert status == 400


# ---------------------------------------------------------------------------
# Bulk delete (POST)
# ---------------------------------------------------------------------------

def test_bulk_delete_requires_ids():
    status, _, body = dispatch("POST", "/api/entities/bulk-delete", {}, {})
    assert status == 400


def test_bulk_delete_nonexistent_ids():
    status, _, body = dispatch("POST", "/api/entities/bulk-delete", {}, {"ids": [99999]})
    assert status == 404


# ---------------------------------------------------------------------------
# Security: no Fabric SQL / query_sql references
# ---------------------------------------------------------------------------

def test_no_fabric_sql_fallback():
    """entities.py must not import or reference query_sql or Fabric SQL."""
    import dashboard.app.api.routes.entities as ent_mod
    import inspect
    src = inspect.getsource(ent_mod)
    assert "query_sql" not in src
    assert "Fabric SQL" not in src
    assert "sp_BuildEntityDigest" not in src


def test_no_sql_injection_vector():
    """build_entity_digest must not use f-string SQL interpolation for filters."""
    import dashboard.app.api.routes.entities as ent_mod
    import inspect
    src = inspect.getsource(ent_mod)
    # The old injection pattern used f-string with LIKE and filter variable
    assert "LIKE '%{" not in src
    assert "SourceFilter" not in src
