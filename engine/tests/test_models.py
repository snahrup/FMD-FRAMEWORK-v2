"""Unit tests for engine/models.py — no network or VPN required."""

import json
import pytest
from engine.models import Entity, RunResult, LogEnvelope, EngineConfig, LoadPlan


# ---------------------------------------------------------------------------
# Entity
# ---------------------------------------------------------------------------

def test_entity_qualified_name():
    e = _make_entity(source_schema="dbo", source_name="Orders")
    assert e.qualified_name == "[dbo].[Orders]"


def test_entity_onelake_folder_with_namespace():
    e = _make_entity(namespace="MES", source_schema="dbo", source_name="WorkOrders")
    assert e.onelake_folder == "MES"


def test_entity_onelake_folder_without_namespace():
    e = _make_entity(namespace=None, source_database="mes", source_schema="dbo", source_name="Parts")
    assert e.onelake_folder == "mes"


def test_entity_build_source_query_full():
    e = _make_entity(is_incremental=False)
    assert e.build_source_query() == "SELECT * FROM [dbo].[TestTable]"


def test_entity_build_source_query_incremental():
    e = _make_entity(
        is_incremental=True,
        watermark_column="ModifiedDate",
        last_load_value="2024-01-01T00:00:00Z",
    )
    q = e.build_source_query()
    assert "WHERE [ModifiedDate] >" in q
    assert "2024-01-01T00:00:00Z" in q


def test_entity_build_source_query_incremental_no_watermark():
    """Incremental entity without a last_load_value should do a full load."""
    e = _make_entity(is_incremental=True, watermark_column="ModifiedDate", last_load_value=None)
    assert "WHERE" not in e.build_source_query()


# ---------------------------------------------------------------------------
# RunResult
# ---------------------------------------------------------------------------

def test_run_result_succeeded():
    r = RunResult(entity_id=1, layer="landing", status="succeeded", rows_read=100)
    assert r.succeeded is True


def test_run_result_failed():
    r = RunResult(entity_id=1, layer="landing", status="failed", error="timeout")
    assert r.succeeded is False


# ---------------------------------------------------------------------------
# LogEnvelope
# ---------------------------------------------------------------------------

def test_log_envelope_to_json():
    env = LogEnvelope(v=1, run_id="abc", entity_id=42, layer="landing", action="extract")
    j = env.to_json()
    parsed = json.loads(j)
    assert parsed["v"] == 1
    assert parsed["run_id"] == "abc"
    assert parsed["entity_id"] == 42


def test_log_envelope_for_entity():
    e = _make_entity()
    env = LogEnvelope.for_entity("run-123", e, "landing", "extract")
    assert env.source["server"] == "m3-db1"
    assert env.source["table"] == "TestTable"
    assert env.watermark["column"] is None
    j = json.loads(env.to_json())
    assert j["run_id"] == "run-123"


# ---------------------------------------------------------------------------
# LoadPlan
# ---------------------------------------------------------------------------

def test_load_plan_to_dict():
    plan = LoadPlan(
        run_id="r1",
        entity_count=10,
        incremental_count=7,
        full_load_count=3,
        layers=["landing", "bronze"],
    )
    d = plan.to_dict()
    assert d["entity_count"] == 10
    assert d["layers"] == ["landing", "bronze"]
    assert isinstance(d["entities"], list)


# ---------------------------------------------------------------------------
# EngineConfig
# ---------------------------------------------------------------------------

def test_engine_config_defaults():
    cfg = EngineConfig(
        sql_server="s", sql_database="d", sql_driver="drv",
        tenant_id="t", client_id="c", client_secret="x",
        workspace_data_id="wd", workspace_code_id="wc",
        lz_lakehouse_id="lz", bronze_lakehouse_id="br", silver_lakehouse_id="sv",
    )
    assert cfg.batch_size == 12
    assert cfg.onelake_account_url == "https://onelake.dfs.fabric.microsoft.com"
    assert cfg.notebook_bronze_id == ""


def test_engine_config_custom_batch_size():
    cfg = EngineConfig(
        sql_server="s", sql_database="d", sql_driver="drv",
        tenant_id="t", client_id="c", client_secret="x",
        workspace_data_id="wd", workspace_code_id="wc",
        lz_lakehouse_id="lz", bronze_lakehouse_id="br", silver_lakehouse_id="sv",
        batch_size=20,
    )
    assert cfg.batch_size == 20


def test_engine_config_load_method_default():
    cfg = EngineConfig(
        sql_server="s", sql_database="d", sql_driver="drv",
        tenant_id="t", client_id="c", client_secret="x",
        workspace_data_id="wd", workspace_code_id="wc",
        lz_lakehouse_id="lz", bronze_lakehouse_id="br", silver_lakehouse_id="sv",
    )
    assert cfg.load_method == "local"
    assert cfg.pipeline_fallback is True
    assert cfg.query_timeout == 120


# ---------------------------------------------------------------------------
# Entity edge cases
# ---------------------------------------------------------------------------

def test_entity_build_source_query_special_chars_in_name():
    """Table names with spaces or special chars are bracket-quoted."""
    e = _make_entity(source_schema="dbo", source_name="Order Details")
    assert e.build_source_query() == "SELECT * FROM [dbo].[Order Details]"


def test_entity_onelake_folder_namespace_priority():
    """namespace takes priority over source_database."""
    e = _make_entity(namespace="ETQ", source_database="etqdb")
    assert e.onelake_folder == "ETQ"


def test_entity_default_is_active():
    e = _make_entity()
    assert e.is_active is True


def test_entity_default_connection_guid():
    e = _make_entity()
    assert e.connection_guid == ""


# ---------------------------------------------------------------------------
# RunResult edge cases
# ---------------------------------------------------------------------------

def test_run_result_skipped():
    r = RunResult(entity_id=1, layer="bronze", status="skipped")
    assert r.succeeded is False


def test_run_result_error_suggestion():
    r = RunResult(entity_id=1, layer="landing", status="failed",
                  error="timeout", error_suggestion="Check VPN connection")
    assert r.error_suggestion == "Check VPN connection"


def test_run_result_rows_default_zero():
    r = RunResult(entity_id=1, layer="landing", status="succeeded")
    assert r.rows_read == 0
    assert r.rows_written == 0
    assert r.bytes_transferred == 0


def test_run_result_watermark_fields():
    r = RunResult(entity_id=1, layer="landing", status="succeeded",
                  watermark_before="2024-01-01", watermark_after="2024-06-01")
    assert r.watermark_before == "2024-01-01"
    assert r.watermark_after == "2024-06-01"


# ---------------------------------------------------------------------------
# LogEnvelope edge cases
# ---------------------------------------------------------------------------

def test_log_envelope_to_json_default_str():
    """Default serializer should handle datetime objects."""
    env = LogEnvelope(v=1, run_id="r", entity_id=1, layer="landing", action="extract")
    j = json.loads(env.to_json())
    assert j["v"] == 1
    assert j["error"] is None


def test_log_envelope_for_entity_with_watermark():
    e = _make_entity(watermark_column="ModifiedDate", last_load_value="2024-01-01")
    env = LogEnvelope.for_entity("run-456", e, "landing", "extract")
    assert env.watermark["column"] == "ModifiedDate"
    assert env.watermark["before"] == "2024-01-01"
    assert env.watermark["after"] is None


def test_log_envelope_timestamps_populated():
    e = _make_entity()
    env = LogEnvelope.for_entity("run-789", e, "bronze", "load")
    assert env.timestamps["started"] is not None
    assert "T" in env.timestamps["started"]  # ISO format


# ---------------------------------------------------------------------------
# LoadPlan edge cases
# ---------------------------------------------------------------------------

def test_load_plan_to_dict_full():
    plan = LoadPlan(
        run_id="r1", entity_count=100, incremental_count=70,
        full_load_count=30, layers=["landing", "bronze", "silver"],
        estimated_rows=5_000_000,
        warnings=["3 entities have no watermark"],
    )
    d = plan.to_dict()
    assert d["entity_count"] == 100
    assert d["estimated_rows"] == 5_000_000
    assert len(d["warnings"]) == 1
    assert d["layers"] == ["landing", "bronze", "silver"]


def test_load_plan_empty_warnings():
    plan = LoadPlan(run_id="r1", entity_count=0, incremental_count=0,
                    full_load_count=0, layers=[])
    d = plan.to_dict()
    assert d["warnings"] == []
    assert d["entities"] == []
    assert d["sources"] == []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_entity(**overrides) -> Entity:
    defaults = dict(
        id=1,
        source_name="TestTable",
        source_schema="dbo",
        source_server="m3-db1",
        source_database="mes",
        datasource_id=4,
        connection_type="SQL",
        workspace_guid="ws-guid",
        lakehouse_guid="lh-guid",
        file_path="MES",
        file_name="TestTable.parquet",
        is_incremental=False,
    )
    defaults.update(overrides)
    return Entity(**defaults)
