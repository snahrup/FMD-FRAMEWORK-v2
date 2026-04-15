"""Unit tests for engine/connections.py — no network, no VPN, no database required.

Tests cover:
  - build_source_map entity grouping
  - SourceConnection timeout configuration
"""

from unittest.mock import MagicMock, patch
import pytest

from engine.connections import build_source_map, SourceConnection
from engine.models import Entity, EngineConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_entity(**overrides) -> Entity:
    defaults = dict(
        id=1, source_name="TestTable", source_schema="dbo",
        source_server="m3-db1", source_database="mes", datasource_id=4,
        connection_type="SQL", workspace_guid="ws-guid",
        lakehouse_guid="lh-guid", file_path="MES",
        file_name="TestTable.parquet", is_incremental=False,
    )
    defaults.update(overrides)
    return Entity(**defaults)


def _make_config(**overrides) -> EngineConfig:
    defaults = dict(
        sql_server="test-server", sql_database="test-db",
        sql_driver="ODBC Driver 18", tenant_id="t", client_id="c",
        client_secret="s", workspace_data_id="wd", workspace_code_id="wc",
        lz_lakehouse_id="lz", bronze_lakehouse_id="br", silver_lakehouse_id="sv",
    )
    defaults.update(overrides)
    return EngineConfig(**defaults)


# ---------------------------------------------------------------------------
# build_source_map
# ---------------------------------------------------------------------------

class TestBuildSourceMap:
    def test_groups_by_server_and_database(self):
        entities = [
            _make_entity(id=1, source_server="srv1", source_database="db1"),
            _make_entity(id=2, source_server="srv1", source_database="db1"),
            _make_entity(id=3, source_server="srv2", source_database="db2"),
        ]
        result = build_source_map(entities)
        assert len(result) == 2
        assert len(result[("srv1", "db1")]) == 2
        assert len(result[("srv2", "db2")]) == 1

    def test_empty_list(self):
        result = build_source_map([])
        assert result == {}

    def test_single_entity(self):
        entities = [_make_entity(id=1)]
        result = build_source_map(entities)
        assert len(result) == 1
        assert len(result[("m3-db1", "mes")]) == 1

    def test_preserves_entity_order_within_group(self):
        entities = [
            _make_entity(id=1, source_server="srv", source_database="db"),
            _make_entity(id=2, source_server="srv", source_database="db"),
            _make_entity(id=3, source_server="srv", source_database="db"),
        ]
        result = build_source_map(entities)
        ids = [e.id for e in result[("srv", "db")]]
        assert ids == [1, 2, 3]

    def test_many_sources(self):
        entities = [
            _make_entity(id=i, source_server=f"srv{i}", source_database=f"db{i}")
            for i in range(100)
        ]
        result = build_source_map(entities)
        assert len(result) == 100  # All unique

    def test_same_server_different_databases(self):
        entities = [
            _make_entity(id=1, source_server="srv", source_database="db1"),
            _make_entity(id=2, source_server="srv", source_database="db2"),
        ]
        result = build_source_map(entities)
        assert len(result) == 2
        assert ("srv", "db1") in result
        assert ("srv", "db2") in result


# ---------------------------------------------------------------------------
# SourceConnection configuration
# ---------------------------------------------------------------------------

class TestSourceConnection:
    def test_uses_config_timeout(self):
        config = _make_config(query_timeout=300)
        sc = SourceConnection(config)
        assert sc._query_timeout == 300

    def test_default_timeout(self):
        config = _make_config()
        sc = SourceConnection(config)
        assert sc._query_timeout == 300  # EngineConfig default

    def test_uses_config_driver(self):
        config = _make_config(source_sql_driver="MyDriver")
        sc = SourceConnection(config)
        assert sc._driver == "MyDriver"
