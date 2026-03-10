"""Unit tests for engine/orchestrator.py — no network, no VPN, no database required.

Tests cover:
  - AdaptiveThrottle AIMD-style concurrency control
  - _interleave_sources round-robin entity ordering
  - _is_transient error classification
  - LoadOrchestrator.build_plan execution plan generation
  - LoadOrchestrator.get_worklist with mock metadata DB
  - LoadOrchestrator.stop() state transitions
"""

import threading
import time
from unittest.mock import MagicMock, patch, PropertyMock
import pytest

from engine.models import Entity, EngineConfig, RunResult, LoadPlan
from engine.orchestrator import AdaptiveThrottle, LoadOrchestrator


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
# AdaptiveThrottle
# ---------------------------------------------------------------------------

class TestAdaptiveThrottle:
    def test_starts_at_max(self):
        t = AdaptiveThrottle(max_workers=10, min_workers=2)
        assert t.current == 10

    def test_acquire_release_cycle(self):
        t = AdaptiveThrottle(max_workers=3, min_workers=1)
        t.acquire()
        t.release(succeeded=True)
        # Should not crash or deadlock

    def test_does_not_adjust_with_few_results(self):
        t = AdaptiveThrottle(max_workers=10, min_workers=2)
        for _ in range(4):
            t.acquire()
            t.release(succeeded=False)
        # With only 4 results (< 5 threshold), no adjustment should happen
        assert t.current == 10

    def test_reduces_on_high_failure_rate(self):
        t = AdaptiveThrottle(max_workers=10, min_workers=2)
        # All 10 fail -> failure_rate = 1.0 > 0.20
        for _ in range(10):
            t.acquire()
            t.release(succeeded=False)
        assert t.current < 10

    def test_does_not_go_below_min(self):
        t = AdaptiveThrottle(max_workers=10, min_workers=3)
        for _ in range(50):
            t.acquire()
            t.release(succeeded=False)
        assert t.current >= 3

    def test_stays_at_max_on_all_success(self):
        t = AdaptiveThrottle(max_workers=10, min_workers=2)
        for _ in range(20):
            t.acquire()
            t.release(succeeded=True)
        assert t.current == 10

    def test_min_workers_default(self):
        t = AdaptiveThrottle(max_workers=8)
        assert t._min == 2


# ---------------------------------------------------------------------------
# _interleave_sources
# ---------------------------------------------------------------------------

class TestInterleaveSources:
    def test_round_robin_basic(self):
        """Given {A: [1,2,3], B: [4,5]}, expect [1,4,2,5,3]."""
        a = [_make_entity(id=1), _make_entity(id=2), _make_entity(id=3)]
        b = [_make_entity(id=4), _make_entity(id=5)]
        source_map = {
            ("srvA", "dbA"): a,
            ("srvB", "dbB"): b,
        }
        result = LoadOrchestrator._interleave_sources(source_map)
        ids = [e.id for e in result]
        assert ids == [1, 4, 2, 5, 3]

    def test_single_source(self):
        entities = [_make_entity(id=i) for i in range(4)]
        source_map = {("srv", "db"): entities}
        result = LoadOrchestrator._interleave_sources(source_map)
        assert [e.id for e in result] == [0, 1, 2, 3]

    def test_empty_sources(self):
        result = LoadOrchestrator._interleave_sources({})
        assert result == []

    def test_equal_length_sources(self):
        a = [_make_entity(id=1), _make_entity(id=2)]
        b = [_make_entity(id=3), _make_entity(id=4)]
        source_map = {
            ("srvA", "dbA"): a,
            ("srvB", "dbB"): b,
        }
        result = LoadOrchestrator._interleave_sources(source_map)
        ids = [e.id for e in result]
        assert len(ids) == 4
        # First entity from each source should alternate
        assert ids[0] == 1
        assert ids[1] == 3

    def test_preserves_total_count(self):
        a = [_make_entity(id=i) for i in range(10)]
        b = [_make_entity(id=i + 10) for i in range(7)]
        c = [_make_entity(id=i + 20) for i in range(3)]
        source_map = {
            ("A", "a"): a,
            ("B", "b"): b,
            ("C", "c"): c,
        }
        result = LoadOrchestrator._interleave_sources(source_map)
        assert len(result) == 20


# ---------------------------------------------------------------------------
# _is_transient
# ---------------------------------------------------------------------------

class TestIsTransient:
    @pytest.fixture
    def orchestrator(self):
        """Create a LoadOrchestrator with all dependencies mocked."""
        config = _make_config()
        with patch("engine.orchestrator.TokenProvider"), \
             patch("engine.orchestrator.MetadataDB"), \
             patch("engine.orchestrator.SourceConnection"), \
             patch("engine.orchestrator.DataExtractor"), \
             patch("engine.orchestrator.OneLakeLoader"), \
             patch("engine.orchestrator.AuditLogger"), \
             patch("engine.orchestrator.NotebookTrigger"), \
             patch("engine.orchestrator.FabricPipelineRunner"), \
             patch("engine.orchestrator.PreflightChecker"):
            orch = LoadOrchestrator(config)
        return orch

    def test_transient_error_codes(self, orchestrator):
        assert orchestrator._is_transient("08S01 Communication link failure") is True
        assert orchestrator._is_transient("08001 connection refused") is True
        assert orchestrator._is_transient("Error 10054 from SQL") is True
        assert orchestrator._is_transient("Error 10053 from SQL") is True
        assert orchestrator._is_transient("HYT00 timeout expired") is True

    def test_transient_message_patterns(self, orchestrator):
        assert orchestrator._is_transient("Connection forcibly closed by remote host") is True
        assert orchestrator._is_transient("Communication link failure during copy") is True

    def test_non_transient_errors(self, orchestrator):
        assert orchestrator._is_transient("Invalid object name 'dbo.FakeTable'") is False
        assert orchestrator._is_transient("Login failed for user") is False
        assert orchestrator._is_transient("Primary key violation") is False

    def test_empty_error(self, orchestrator):
        assert orchestrator._is_transient("") is False
        assert orchestrator._is_transient(None) is False


# ---------------------------------------------------------------------------
# build_plan
# ---------------------------------------------------------------------------

class TestBuildPlan:
    @pytest.fixture
    def orchestrator(self):
        config = _make_config(
            batch_size=12, chunk_rows=500_000,
            notebook_bronze_id="bronze-nb-id",
            notebook_silver_id="silver-nb-id",
        )
        with patch("engine.orchestrator.TokenProvider"), \
             patch("engine.orchestrator.MetadataDB"), \
             patch("engine.orchestrator.SourceConnection"), \
             patch("engine.orchestrator.DataExtractor"), \
             patch("engine.orchestrator.OneLakeLoader"), \
             patch("engine.orchestrator.AuditLogger"), \
             patch("engine.orchestrator.NotebookTrigger"), \
             patch("engine.orchestrator.FabricPipelineRunner"), \
             patch("engine.orchestrator.PreflightChecker"):
            orch = LoadOrchestrator(config)
        return orch

    def test_plan_returns_load_plan(self, orchestrator):
        entities = [
            _make_entity(id=1, is_incremental=True, watermark_column="ModDate", last_load_value="2024-01-01"),
            _make_entity(id=2, is_incremental=False),
            _make_entity(id=3, is_incremental=False),
        ]
        plan = orchestrator.build_plan("run-1", entities, None)
        assert isinstance(plan, LoadPlan)
        assert plan.entity_count == 3
        assert plan.incremental_count == 1
        assert plan.full_load_count == 2
        assert plan.run_id == "run-1"

    def test_plan_detects_blank_source_names(self, orchestrator):
        entities = [
            _make_entity(id=1, source_name="Good"),
            _make_entity(id=2, source_name=""),
            _make_entity(id=3, source_name="   "),
        ]
        plan = orchestrator.build_plan("run-1", entities, None)
        blank_warnings = [w for w in plan.warnings if "blank SourceName" in w]
        assert len(blank_warnings) == 1
        assert "2" in blank_warnings[0]  # 2 blank entities

    def test_plan_detects_missing_watermark(self, orchestrator):
        entities = [
            _make_entity(id=1, is_incremental=True, watermark_column=None),
        ]
        plan = orchestrator.build_plan("run-1", entities, None)
        wm_warnings = [w for w in plan.warnings if "no watermark" in w]
        assert len(wm_warnings) == 1

    def test_plan_detects_missing_pks(self, orchestrator):
        entities = [
            _make_entity(id=1, primary_keys=None),
        ]
        plan = orchestrator.build_plan("run-1", entities, None)
        pk_warnings = [w for w in plan.warnings if "no primary keys" in w]
        assert len(pk_warnings) == 1

    def test_plan_layer_filtering(self, orchestrator):
        entities = [_make_entity()]
        plan = orchestrator.build_plan("run-1", entities, ["landing"])
        layer_names = [lp["layer"] for lp in plan.layer_plan]
        assert "landing" in layer_names
        assert "bronze" not in layer_names
        assert "silver" not in layer_names

    def test_plan_all_layers_default(self, orchestrator):
        entities = [_make_entity()]
        plan = orchestrator.build_plan("run-1", entities, None)
        layer_names = [lp["layer"] for lp in plan.layer_plan]
        assert "landing" in layer_names
        assert "bronze" in layer_names
        assert "silver" in layer_names

    def test_plan_sources_breakdown(self, orchestrator):
        entities = [
            _make_entity(id=1, source_server="srv1", source_database="db1", namespace="MES"),
            _make_entity(id=2, source_server="srv1", source_database="db1", namespace="MES"),
            _make_entity(id=3, source_server="srv2", source_database="db2", namespace="ETQ"),
        ]
        plan = orchestrator.build_plan("run-1", entities, None)
        assert len(plan.sources) == 2  # 2 unique server/database pairs
        total_entities = sum(s["entity_count"] for s in plan.sources)
        assert total_entities == 3

    def test_plan_config_snapshot(self, orchestrator):
        entities = [_make_entity()]
        plan = orchestrator.build_plan("run-1", entities, None)
        assert plan.config_snapshot["batch_size"] == 12
        assert plan.config_snapshot["chunk_rows"] == 500_000
        assert "lz_lakehouse" in plan.config_snapshot

    def test_plan_entities_list(self, orchestrator):
        entities = [
            _make_entity(id=1, source_name="Orders", namespace="MES"),
            _make_entity(id=2, source_name="Products", namespace="ETQ", is_incremental=True, watermark_column="ModDate"),
        ]
        plan = orchestrator.build_plan("run-1", entities, None)
        assert len(plan.entities) == 2
        e1 = plan.entities[0]
        assert e1["id"] == 1
        assert e1["name"] == "[dbo].[Orders]"
        assert e1["namespace"] == "MES"
        assert e1["load_type"] == "full"

        e2 = plan.entities[1]
        assert e2["load_type"] == "incremental"


# ---------------------------------------------------------------------------
# LoadOrchestrator state management
# ---------------------------------------------------------------------------

class TestOrchestratorState:
    @pytest.fixture
    def orchestrator(self):
        config = _make_config()
        with patch("engine.orchestrator.TokenProvider"), \
             patch("engine.orchestrator.MetadataDB"), \
             patch("engine.orchestrator.SourceConnection"), \
             patch("engine.orchestrator.DataExtractor"), \
             patch("engine.orchestrator.OneLakeLoader"), \
             patch("engine.orchestrator.AuditLogger"), \
             patch("engine.orchestrator.NotebookTrigger"), \
             patch("engine.orchestrator.FabricPipelineRunner"), \
             patch("engine.orchestrator.PreflightChecker"):
            orch = LoadOrchestrator(config)
        return orch

    def test_initial_state_is_idle(self, orchestrator):
        assert orchestrator.status == "idle"
        assert orchestrator.current_run_id is None

    def test_stop_sets_stopping_state(self, orchestrator):
        orchestrator.stop()
        assert orchestrator.status == "stopping"
        assert orchestrator._stop_requested is True

    def test_stop_force_flag(self, orchestrator):
        mock_pool = MagicMock()
        orchestrator._current_pool = mock_pool
        orchestrator.stop(force=True)
        assert orchestrator.status == "stopping"
        mock_pool.shutdown.assert_called_once()
        assert orchestrator._current_pool is None

    def test_validate_config_reports_missing_fields(self):
        config = _make_config(workspace_data_id="", client_secret="")
        with patch("engine.orchestrator.log") as mock_log:
            LoadOrchestrator._validate_config(config)
            mock_log.error.assert_called_once()
            error_msg = mock_log.error.call_args[0][0]
            assert "CONFIGURATION ERROR" in error_msg

    def test_validate_config_passes_with_all_fields(self):
        config = _make_config()
        with patch("engine.orchestrator.log") as mock_log:
            LoadOrchestrator._validate_config(config)
            mock_log.error.assert_not_called()


# ---------------------------------------------------------------------------
# _TRANSIENT_ERRORS constant validation
# ---------------------------------------------------------------------------

class TestTransientErrors:
    def test_known_codes_present(self):
        from engine.orchestrator import _THROTTLE_PATTERNS
        assert "429" in _THROTTLE_PATTERNS
        assert "too many connections" in _THROTTLE_PATTERNS
        assert "rate limit exceeded" in _THROTTLE_PATTERNS
