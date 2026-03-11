"""Tests for the Database Explorer API routes."""
import sys
import json
import importlib
import pytest
from dashboard.app.api.router import dispatch, _routes
from dashboard.app.api import db as fmd_db


@pytest.fixture(autouse=True)
def setup(tmp_path):
    _routes.clear()
    original_db_path = fmd_db.DB_PATH
    fmd_db.DB_PATH = tmp_path / "test.db"
    fmd_db.init_db()
    mod_name = "dashboard.app.api.routes.db_explorer"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()
    fmd_db.DB_PATH = original_db_path


def test_list_tables():
    status, _, body = dispatch("GET", "/api/db-explorer/tables", {}, None)
    assert status == 200
    tables = json.loads(body)
    assert isinstance(tables, list)
    assert any(t["name"] == "connections" for t in tables)


def test_get_table_data():
    fmd_db.execute("INSERT INTO connections (ConnectionId, Name) VALUES (1, 'test')")
    status, _, body = dispatch("GET", "/api/db-explorer/table/connections", {"page": "1", "per_page": "10"}, None)
    assert status == 200
    result = json.loads(body)
    assert "rows" in result
    assert len(result["rows"]) == 1


def test_get_table_schema():
    status, _, body = dispatch("GET", "/api/db-explorer/table/connections/schema", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, list)
    assert any(c["name"] == "ConnectionId" for c in result)


def test_read_only_query():
    status, _, body = dispatch("POST", "/api/db-explorer/query", {},
                                {"sql": "SELECT COUNT(*) as cnt FROM connections"})
    assert status == 200
    result = json.loads(body)
    assert "rows" in result


def test_rejects_write_query():
    status, _, body = dispatch("POST", "/api/db-explorer/query", {},
                                {"sql": "DELETE FROM connections"})
    assert status == 400


def test_table_not_found():
    status, _, body = dispatch("GET", "/api/db-explorer/table/nonexistent_table", {}, None)
    assert status == 404


def test_pagination():
    for i in range(20):
        fmd_db.execute(f"INSERT INTO connections (ConnectionId, Name) VALUES ({i+1}, 'conn_{i}')")
    status, _, body = dispatch("GET", "/api/db-explorer/table/connections", {"page": "2", "per_page": "5"}, None)
    assert status == 200
    result = json.loads(body)
    assert len(result["rows"]) == 5
    assert result["total"] == 20
    assert result["page"] == 2
