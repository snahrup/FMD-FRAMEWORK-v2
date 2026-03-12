"""Unit tests for engine/models.py — no network or VPN required."""

import json
import pytest
from engine.models import Entity, RunResult, LogEnvelope, EngineConfig, LoadPlan, BronzeEntity, SilverEntity


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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# BronzeEntity
# ---------------------------------------------------------------------------

def test_bronze_entity_onelake_table_path():
    e = BronzeEntity(
        bronze_entity_id=1,
        lz_entity_id=10,
        namespace="MES",
        source_schema="dbo",
        source_name="CUSCONGB",
        primary_keys="COMSID,COLANC",
        is_incremental=False,
        lakehouse_guid="F06393CA-C024-435F-8D7F-9F5AA3BB4CB3",
        workspace_guid="0596d0e7-e036-451d-a967-41a284302e8d",
        lz_file_name="CUSCONGB.parquet",
        lz_namespace="m3",
        lz_lakehouse_guid="3B9A7E79-1615-4EC2-9E93-0BDEBE985D5A",
    )
    assert e.delta_table_path == "F06393CA-C024-435F-8D7F-9F5AA3BB4CB3/Tables/MES/CUSCONGB"
    assert e.lz_parquet_path == "3B9A7E79-1615-4EC2-9E93-0BDEBE985D5A/Files/m3/CUSCONGB.parquet"
    assert e.pk_columns == ["COMSID", "COLANC"]


# ---------------------------------------------------------------------------
# SilverEntity
# ---------------------------------------------------------------------------

def test_silver_entity_onelake_table_path():
    e = SilverEntity(
        silver_entity_id=1,
        bronze_entity_id=10,
        namespace="MES",
        source_name="CUSCONGB",
        primary_keys="COMSID,COLANC",
        is_incremental=False,
        lakehouse_guid="F85E1BA0-2E40-4DE5-BE1E-F8AD3DDBC652",
        workspace_guid="0596d0e7-e036-451d-a967-41a284302e8d",
        bronze_lakehouse_guid="F06393CA-C024-435F-8D7F-9F5AA3BB4CB3",
    )
    assert e.delta_table_path == "F85E1BA0-2E40-4DE5-BE1E-F8AD3DDBC652/Tables/MES/CUSCONGB"
    assert e.bronze_delta_path == "F06393CA-C024-435F-8D7F-9F5AA3BB4CB3/Tables/MES/CUSCONGB"


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
        file_path="MES/dbo_TestTable",
        file_name="dbo_TestTable_20240101.parquet",
        is_incremental=False,
    )
    defaults.update(overrides)
    return Entity(**defaults)
