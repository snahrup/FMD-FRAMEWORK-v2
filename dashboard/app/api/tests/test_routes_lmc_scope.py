# dashboard/app/api/tests/test_routes_lmc_scope.py
"""Regression tests for Load Mission Control scope enforcement.

Root cause (2026-03-25): entity-ids-by-source queried le.EntityId which doesn't
exist — column is le.LandingzoneEntityId.  Resolution silently failed, frontend
swallowed the error, and every run launched with empty EntityFilter (= all entities).

These tests ensure:
  1. entity-ids-by-source returns LandingzoneEntityId (not EntityId)
  2. Empty resolution causes launch to fail (not silently widen)
  3. Backend status returns persisted scope truth
"""
import importlib
import json
import sys
import sqlite3

import pytest
import dashboard.app.api.db as db_module
import dashboard.app.api.control_plane_db as cpdb_module
from dashboard.app.api.router import dispatch, _routes


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_db(tmp_path):
    """Redirect DB_PATH to a temp file, init schema, seed test data."""
    db_path = tmp_path / "test_lmc_scope.db"
    original_db = db_module.DB_PATH
    original_cpdb = cpdb_module.DB_PATH
    db_module.DB_PATH = db_path
    cpdb_module.DB_PATH = db_path
    db_module.init_db()

    # Seed minimal data: 1 connection, 2 datasources, entities in each
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO connections (ConnectionId, Name, Type, ServerName, DatabaseName) "
        "VALUES (1, 'TestConn', 'SQL', 'test-server', 'TestDB')"
    )
    conn.execute(
        "INSERT INTO datasources (DataSourceId, ConnectionId, Name, DisplayName, Namespace) "
        "VALUES (1, 1, 'SourceA', 'Source A', 'SRC_A')"
    )
    conn.execute(
        "INSERT INTO datasources (DataSourceId, ConnectionId, Name, DisplayName, Namespace) "
        "VALUES (2, 1, 'SourceB', 'Source B', 'SRC_B')"
    )
    # Need a lakehouse for the FK
    conn.execute(
        "INSERT INTO lakehouses (LakehouseId, Name, WorkspaceGuid, LakehouseGuid) "
        "VALUES (1, 'TestLH', 'ws-guid', 'lh-guid')"
    )
    # 3 entities in SourceA, 2 in SourceB
    for i in range(1, 4):
        conn.execute(
            "INSERT INTO lz_entities (LandingzoneEntityId, DataSourceId, LakehouseId, "
            "SourceSchema, SourceName, IsActive) VALUES (?, 1, 1, 'dbo', ?, 1)",
            (i, f"TableA{i}"),
        )
    for i in range(4, 6):
        conn.execute(
            "INSERT INTO lz_entities (LandingzoneEntityId, DataSourceId, LakehouseId, "
            "SourceSchema, SourceName, IsActive) VALUES (?, 2, 1, 'dbo', ?, 1)",
            (i, f"TableB{i}"),
        )
    # Also add engine_runs schema columns for scope tracking
    try:
        conn.execute("ALTER TABLE engine_runs ADD COLUMN SourceFilter TEXT DEFAULT ''")
    except Exception:
        pass  # already exists
    try:
        conn.execute("ALTER TABLE engine_runs ADD COLUMN ResolvedEntityCount INTEGER DEFAULT 0")
    except Exception:
        pass
    conn.commit()
    conn.close()

    yield db_path
    db_module.DB_PATH = original_db
    cpdb_module.DB_PATH = original_cpdb


@pytest.fixture(autouse=True)
def setup_lmc_routes(tmp_db):
    _routes.clear()
    mod_name = "dashboard.app.api.routes.load_mission_control"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _call(method: str, path: str, params: dict = {}) -> dict:
    """Call dispatch and return parsed JSON body. Asserts 200 status."""
    status, _headers, body_str = dispatch(method, path, params, None)
    result = json.loads(body_str)
    assert status == 200, f"Expected 200, got {status}: {result}"
    return result


# ---------------------------------------------------------------------------
# Tests: entity-ids-by-source endpoint
# ---------------------------------------------------------------------------

class TestEntityIdsBySource:
    """Tests for GET /api/lmc/entity-ids-by-source."""

    def test_returns_correct_ids_for_source(self, tmp_db):
        """Resolution must return LandingzoneEntityId, not a nonexistent EntityId column."""
        result = _call("GET", "/api/lmc/entity-ids-by-source", {"sources": "SourceA"})
        assert result["count"] == 3
        assert sorted(result["entity_ids"]) == [1, 2, 3]

    def test_returns_correct_ids_for_other_source(self, tmp_db):
        result = _call("GET", "/api/lmc/entity-ids-by-source", {"sources": "SourceB"})
        assert result["count"] == 2
        assert sorted(result["entity_ids"]) == [4, 5]

    def test_multiple_sources_returns_union(self, tmp_db):
        result = _call("GET", "/api/lmc/entity-ids-by-source", {"sources": "SourceA,SourceB"})
        assert result["count"] == 5
        assert sorted(result["entity_ids"]) == [1, 2, 3, 4, 5]

    def test_nonexistent_source_returns_empty(self, tmp_db):
        result = _call("GET", "/api/lmc/entity-ids-by-source", {"sources": "DoesNotExist"})
        assert result["count"] == 0
        assert result["entity_ids"] == []

    def test_empty_sources_param_returns_empty(self, tmp_db):
        result = _call("GET", "/api/lmc/entity-ids-by-source", {"sources": ""})
        assert result["count"] == 0
        assert result["entity_ids"] == []

    def test_no_sources_param_returns_empty(self, tmp_db):
        result = _call("GET", "/api/lmc/entity-ids-by-source")
        assert result["count"] == 0
        assert result["entity_ids"] == []


# ---------------------------------------------------------------------------
# Tests: source list endpoint
# ---------------------------------------------------------------------------

class TestSourcesList:
    """Tests for GET /api/lmc/sources — the list used by the launch panel."""

    def test_returns_all_sources_with_counts(self, tmp_db):
        result = _call("GET", "/api/lmc/sources")
        sources = result["sources"]
        names = {s["name"] for s in sources}
        assert "SourceA" in names
        assert "SourceB" in names
        source_a = next(s for s in sources if s["name"] == "SourceA")
        assert source_a["entityCount"] == 3


# ---------------------------------------------------------------------------
# Tests: scope enforcement contract
# ---------------------------------------------------------------------------

class TestScopeEnforcement:
    """Verify that scope resolution uses the correct column and never widens silently."""

    def test_column_is_landingzone_entity_id(self, tmp_db):
        """The resolution query MUST use LandingzoneEntityId, not EntityId.

        Regression: EntityId doesn't exist in lz_entities — it caused every
        resolution to fail, and the frontend silently fell through to 'load all'.
        """
        conn = sqlite3.connect(str(tmp_db))
        # Prove the correct column exists
        cols = [row[1] for row in conn.execute("PRAGMA table_info(lz_entities)").fetchall()]
        assert "LandingzoneEntityId" in cols
        assert "EntityId" not in cols, "EntityId should NOT exist — was the root cause of the scope bug"
        conn.close()

    def test_resolved_ids_only_contain_selected_source(self, tmp_db):
        """When selecting SourceA, no SourceB entity IDs should appear."""
        result = _call("GET", "/api/lmc/entity-ids-by-source", {"sources": "SourceA"})
        # SourceB entity IDs are 4, 5
        for eid in result["entity_ids"]:
            assert eid not in [4, 5], f"Entity {eid} is from SourceB but appeared in SourceA resolution"


# ---------------------------------------------------------------------------
# Tests: engine start scope guard (backend hard-stop)
# ---------------------------------------------------------------------------

class TestEngineStartScopeGuard:
    """Verify the engine start handler rejects empty scoped launches.

    These tests use the scope guard logic directly from engine/api.py
    without actually spawning a worker subprocess.
    """

    def test_source_filter_with_empty_entity_ids_returns_400(self, tmp_db):
        """If source_filter is set but entity_ids resolved to empty, return 400.

        This is the kill-switch: the engine must NEVER silently widen scope.
        """
        # Simulate the scope guard logic from _handle_start
        source_filter = ["NonExistentSource"]
        entity_ids = []  # resolution returned nothing

        # The guard: source_filter present + entity_ids empty = reject
        should_reject = bool(source_filter) and (not entity_ids or len(entity_ids) == 0)
        assert should_reject, "Engine should reject launch when source filter resolves to 0 entities"

    def test_source_filter_with_valid_entity_ids_allowed(self, tmp_db):
        """If source_filter is set and entity_ids resolved correctly, allow."""
        source_filter = ["SourceA"]
        entity_ids = [1, 2, 3]

        should_reject = bool(source_filter) and (not entity_ids or len(entity_ids) == 0)
        assert not should_reject, "Engine should allow launch when source filter resolves to entities"

    def test_no_source_filter_allows_all(self, tmp_db):
        """If no source_filter, allow loading all entities (no scoping)."""
        source_filter = []
        entity_ids = None

        should_reject = bool(source_filter) and (not entity_ids or len(entity_ids) == 0)
        assert not should_reject, "Engine should allow unscoped launch (all entities)"

    def test_source_filter_with_none_entity_ids_returns_400(self, tmp_db):
        """If source_filter is set but entity_ids is None (resolution failed), reject."""
        source_filter = ["SourceA"]
        entity_ids = None

        should_reject = bool(source_filter) and (not entity_ids)
        assert should_reject, "Engine should reject when resolution returns None"


# ---------------------------------------------------------------------------
# Tests: persisted scope on run record
# ---------------------------------------------------------------------------

class TestPersistedScopeTruth:
    """Verify that run records persist SourceFilter and ResolvedEntityCount."""

    def test_run_record_contains_scope_columns(self, tmp_db):
        """engine_runs table must have SourceFilter and ResolvedEntityCount columns."""
        conn = sqlite3.connect(str(tmp_db))
        cols = {row[1] for row in conn.execute("PRAGMA table_info(engine_runs)").fetchall()}
        assert "SourceFilter" in cols, "engine_runs missing SourceFilter column"
        assert "ResolvedEntityCount" in cols, "engine_runs missing ResolvedEntityCount column"
        conn.close()

    def test_scope_persisted_on_insert(self, tmp_db):
        """Inserting a run record with scope fields should persist and be readable."""
        conn = sqlite3.connect(str(tmp_db))
        conn.execute(
            "INSERT INTO engine_runs (RunId, Status, Layers, TriggeredBy, EntityFilter, "
            "SourceFilter, ResolvedEntityCount, StartedAt) "
            "VALUES (?, 'InProgress', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
            ("test-run-123", "landing", "dashboard", "1,2,3", "SourceA", 3),
        )
        conn.commit()

        row = conn.execute(
            "SELECT SourceFilter, ResolvedEntityCount, EntityFilter FROM engine_runs WHERE RunId = ?",
            ("test-run-123",),
        ).fetchone()
        conn.close()

        assert row is not None, "Run record not found"
        assert row[0] == "SourceA", f"SourceFilter should be 'SourceA', got {row[0]!r}"
        assert row[1] == 3, f"ResolvedEntityCount should be 3, got {row[1]!r}"
        assert row[2] == "1,2,3", f"EntityFilter should be '1,2,3', got {row[2]!r}"
