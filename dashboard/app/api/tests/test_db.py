# dashboard/app/api/tests/test_db.py
import os
import tempfile
import pytest
from dashboard.app.api import db
import dashboard.app.api.control_plane_db as cpdb


@pytest.fixture
def tmp_db(tmp_path):
    db_path = tmp_path / "test.db"
    original_db = db.DB_PATH
    original_cpdb = cpdb.DB_PATH
    db.DB_PATH = db_path
    cpdb.DB_PATH = db_path
    db.init_db()
    yield db_path
    db.DB_PATH = original_db
    cpdb.DB_PATH = original_cpdb


def test_init_creates_tables(tmp_db):
    conn = db.get_db()
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in cursor.fetchall()}
    assert "connections" in tables
    assert "lz_entities" in tables
    assert "engine_runs" in tables
    conn.close()


def test_query_returns_list_of_dicts(tmp_db):
    conn = db.get_db()
    conn.execute("INSERT INTO connections (ConnectionId, Name) VALUES (1, 'test')")
    conn.commit()
    conn.close()

    rows = db.query("SELECT * FROM connections WHERE ConnectionId = ?", (1,))
    assert len(rows) == 1
    assert rows[0]["Name"] == "test"


def test_execute_runs_statement(tmp_db):
    db.execute("INSERT INTO connections (ConnectionId, Name) VALUES (?, ?)", (99, "exec_test"))
    rows = db.query("SELECT Name FROM connections WHERE ConnectionId = ?", (99,))
    assert rows[0]["Name"] == "exec_test"
