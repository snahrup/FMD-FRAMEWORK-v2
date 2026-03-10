"""Unit tests for engine/pipeline_runner.py — no network required.

Tests cover:
  - _build_pipeline_params entity-to-parameter mapping
  - _extract_job_id from Location header
  - trigger_copy when pipeline ID not configured
  - Constants and configuration
"""

from unittest.mock import MagicMock, patch
import pytest

from engine.pipeline_runner import (
    FabricPipelineRunner,
    API_BASE,
    POLL_INTERVAL,
    MAX_POLL_TIME,
    MAX_TRIGGER_RETRIES,
)
from engine.models import Entity, EngineConfig, RunResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_entity(**overrides) -> Entity:
    defaults = dict(
        id=42, source_name="Orders", source_schema="dbo",
        source_server="m3-db1", source_database="mes", datasource_id=4,
        connection_type="SQL", workspace_guid="ws-guid",
        lakehouse_guid="lh-guid", file_path="MES",
        file_name="Orders.parquet", is_incremental=False,
        namespace="MES", connection_guid="conn-guid-123",
    )
    defaults.update(overrides)
    return Entity(**defaults)


def _make_config(**overrides) -> EngineConfig:
    defaults = dict(
        sql_server="test-server", sql_database="test-db",
        sql_driver="ODBC Driver 18", tenant_id="t", client_id="c",
        client_secret="s", workspace_data_id="wd", workspace_code_id="wc",
        lz_lakehouse_id="lz", bronze_lakehouse_id="br", silver_lakehouse_id="sv",
        pipeline_copy_sql_id="pipeline-id-123",
        pipeline_workspace_id="ws-pipeline",
    )
    defaults.update(overrides)
    return EngineConfig(**defaults)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

class TestConstants:
    def test_api_base(self):
        assert API_BASE == "https://api.fabric.microsoft.com/v1"

    def test_poll_interval_reasonable(self):
        assert 5 <= POLL_INTERVAL <= 30

    def test_max_poll_time_is_2_hours(self):
        assert MAX_POLL_TIME == 7200

    def test_max_retries(self):
        assert MAX_TRIGGER_RETRIES == 3


# ---------------------------------------------------------------------------
# _build_pipeline_params
# ---------------------------------------------------------------------------

class TestBuildPipelineParams:
    def test_maps_entity_fields(self):
        config = _make_config()
        tp = MagicMock()
        runner = FabricPipelineRunner(config, tp)
        entity = _make_entity()

        params = runner._build_pipeline_params(entity, "run-123")

        assert params["ConnectionGuid"] == "conn-guid-123"
        assert params["SourceSchema"] == "dbo"
        assert params["SourceName"] == "Orders"
        assert params["DatasourceName"] == "mes"
        assert params["WorkspaceGuid"] == "ws-guid"
        assert params["TargetLakehouseGuid"] == "lh-guid"
        assert params["TargetFilePath"] == "MES"
        assert params["TargetFileName"] == "Orders.parquet"

    def test_source_data_retrieval_full_load(self):
        config = _make_config()
        tp = MagicMock()
        runner = FabricPipelineRunner(config, tp)
        entity = _make_entity(is_incremental=False)

        params = runner._build_pipeline_params(entity, "run-1")
        assert params["SourceDataRetrieval"] == "SELECT * FROM [dbo].[Orders]"

    def test_source_data_retrieval_incremental(self):
        config = _make_config()
        tp = MagicMock()
        runner = FabricPipelineRunner(config, tp)
        entity = _make_entity(
            is_incremental=True,
            watermark_column="ModifiedDate",
            last_load_value="2024-01-01",
        )

        params = runner._build_pipeline_params(entity, "run-1")
        assert "WHERE" in params["SourceDataRetrieval"]
        assert "ModifiedDate" in params["SourceDataRetrieval"]

    def test_target_file_path_uses_namespace(self):
        config = _make_config()
        tp = MagicMock()
        runner = FabricPipelineRunner(config, tp)
        entity = _make_entity(namespace="ETQ")

        params = runner._build_pipeline_params(entity, "run-1")
        assert params["TargetFilePath"] == "ETQ"

    def test_target_file_path_falls_back_to_database(self):
        config = _make_config()
        tp = MagicMock()
        runner = FabricPipelineRunner(config, tp)
        entity = _make_entity(namespace=None, source_database="etqdb")

        params = runner._build_pipeline_params(entity, "run-1")
        assert params["TargetFilePath"] == "etqdb"

    def test_strips_source_name_in_filename(self):
        config = _make_config()
        tp = MagicMock()
        runner = FabricPipelineRunner(config, tp)
        entity = _make_entity(source_name="  Orders  ")

        params = runner._build_pipeline_params(entity, "run-1")
        assert params["TargetFileName"] == "Orders.parquet"


# ---------------------------------------------------------------------------
# _extract_job_id
# ---------------------------------------------------------------------------

class TestExtractJobId:
    def test_extracts_from_location_header(self):
        mock_resp = MagicMock()
        mock_resp.headers = {
            "Location": "https://api.fabric.microsoft.com/v1/workspaces/ws/items/pipe/jobs/instances/job-abc-123"
        }
        result = FabricPipelineRunner._extract_job_id(mock_resp)
        assert result == "job-abc-123"

    def test_handles_trailing_slash(self):
        mock_resp = MagicMock()
        mock_resp.headers = {
            "Location": "https://api.fabric.microsoft.com/v1/workspaces/ws/items/pipe/jobs/instances/job-id/"
        }
        result = FabricPipelineRunner._extract_job_id(mock_resp)
        assert result == "job-id"

    def test_returns_none_when_no_location(self):
        mock_resp = MagicMock()
        mock_resp.headers = {}
        mock_resp.headers.get = MagicMock(return_value="")
        result = FabricPipelineRunner._extract_job_id(mock_resp)
        assert result is None


# ---------------------------------------------------------------------------
# trigger_copy — no pipeline configured
# ---------------------------------------------------------------------------

class TestTriggerCopyNoPipeline:
    def test_returns_failed_when_no_pipeline_id(self):
        config = _make_config(pipeline_copy_sql_id="")
        tp = MagicMock()
        runner = FabricPipelineRunner(config, tp)
        entity = _make_entity()

        result = runner.trigger_copy(entity, "run-1")
        assert result.status == "failed"
        assert "not configured" in result.error


# ---------------------------------------------------------------------------
# Constructor configuration
# ---------------------------------------------------------------------------

class TestRunnerConfig:
    def test_uses_pipeline_workspace_id(self):
        config = _make_config(pipeline_workspace_id="custom-ws")
        tp = MagicMock()
        runner = FabricPipelineRunner(config, tp)
        assert runner._workspace_id == "custom-ws"

    def test_falls_back_to_code_workspace(self):
        config = _make_config(pipeline_workspace_id="")
        tp = MagicMock()
        runner = FabricPipelineRunner(config, tp)
        assert runner._workspace_id == "wc"  # workspace_code_id
