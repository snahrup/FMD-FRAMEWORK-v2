"""Unit tests for engine/loader.py — no network required.

Tests cover:
  - OneLake path construction (namespace, lakehouse_guid, workspace_guid)
  - _diagnose_upload_error error classification
  - upload_entity convenience wrapper
  - ping failure handling
"""

from unittest.mock import MagicMock, patch
import pytest

from engine.loader import OneLakeLoader
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
        namespace="MES",
    )
    defaults.update(overrides)
    return Entity(**defaults)


def _make_config(**overrides) -> EngineConfig:
    defaults = dict(
        sql_server="test-server", sql_database="test-db",
        sql_driver="ODBC Driver 18", tenant_id="t", client_id="c",
        client_secret="s", workspace_data_id="wd", workspace_code_id="wc",
        lz_lakehouse_id="lz-default", bronze_lakehouse_id="br",
        silver_lakehouse_id="sv",
    )
    defaults.update(overrides)
    return EngineConfig(**defaults)


def _make_loader():
    """Create a loader with mocked token provider."""
    config = _make_config()
    tp = MagicMock()
    tp.get_datalake_credential.return_value = MagicMock()
    return OneLakeLoader(config, tp), config


# ---------------------------------------------------------------------------
# _diagnose_upload_error
# ---------------------------------------------------------------------------

class TestDiagnoseUploadError:
    def test_forbidden_403(self):
        entity = _make_entity()
        msg = OneLakeLoader._diagnose_upload_error("403 Forbidden", entity)
        assert "Contributor" in msg

    def test_forbidden_lowercase(self):
        entity = _make_entity()
        msg = OneLakeLoader._diagnose_upload_error("The server returned forbidden", entity)
        assert "Contributor" in msg

    def test_not_found_404(self):
        entity = _make_entity()
        msg = OneLakeLoader._diagnose_upload_error("404 resource not found", entity)
        assert "lakehouse GUIDs" in msg

    def test_timeout(self):
        entity = _make_entity()
        msg = OneLakeLoader._diagnose_upload_error("Connection timeout occurred", entity)
        assert "chunk_rows" in msg

    def test_unauthorized_401(self):
        entity = _make_entity()
        msg = OneLakeLoader._diagnose_upload_error("401 Unauthorized", entity)
        assert "SP token" in msg

    def test_unknown_error(self):
        entity = _make_entity(id=99)
        msg = OneLakeLoader._diagnose_upload_error("Something weird happened", entity)
        assert "99" in msg  # entity ID in message


# ---------------------------------------------------------------------------
# upload — path construction
# ---------------------------------------------------------------------------

class TestUploadPathConstruction:
    def test_uses_entity_lakehouse_guid(self):
        loader, config = _make_loader()
        entity = _make_entity(lakehouse_guid="entity-lh", workspace_guid="entity-ws")

        # Mock the filesystem client chain
        mock_fs = MagicMock()
        mock_dir = MagicMock()
        mock_file = MagicMock()
        mock_fs.get_directory_client.return_value = mock_dir
        mock_dir.get_file_client.return_value = mock_file

        with patch.object(loader, "get_filesystem", return_value=mock_fs) as mock_get_fs:
            result = loader.upload(entity, b"parquet-bytes", "run-1")
            # Verify workspace (must assert inside context manager)
            mock_get_fs.assert_called_with("entity-ws")

        assert result.succeeded
        # Verify directory path includes entity's lakehouse GUID
        dir_path = mock_fs.get_directory_client.call_args[0][0]
        assert "entity-lh" in dir_path
        assert "MES" in dir_path  # namespace

    def test_falls_back_to_config_lakehouse(self):
        loader, config = _make_loader()
        entity = _make_entity(lakehouse_guid="", workspace_guid="")

        mock_fs = MagicMock()
        mock_dir = MagicMock()
        mock_file = MagicMock()
        mock_fs.get_directory_client.return_value = mock_dir
        mock_dir.get_file_client.return_value = mock_file

        with patch.object(loader, "get_filesystem", return_value=mock_fs) as mock_get_fs:
            result = loader.upload(entity, b"data", "run-1")
            mock_get_fs.assert_called_with("wd")  # workspace_data_id

        assert result.succeeded
        dir_path = mock_fs.get_directory_client.call_args[0][0]
        assert "lz-default" in dir_path

    def test_namespace_from_entity(self):
        loader, _ = _make_loader()
        entity = _make_entity(namespace="ETQ")

        mock_fs = MagicMock()
        mock_dir = MagicMock()
        mock_file = MagicMock()
        mock_fs.get_directory_client.return_value = mock_dir
        mock_dir.get_file_client.return_value = mock_file

        with patch.object(loader, "get_filesystem", return_value=mock_fs):
            loader.upload(entity, b"data", "run-1")

        dir_path = mock_fs.get_directory_client.call_args[0][0]
        assert "ETQ" in dir_path

    def test_namespace_falls_back_to_database(self):
        loader, _ = _make_loader()
        entity = _make_entity(namespace=None, source_database="mydb")

        mock_fs = MagicMock()
        mock_dir = MagicMock()
        mock_file = MagicMock()
        mock_fs.get_directory_client.return_value = mock_dir
        mock_dir.get_file_client.return_value = mock_file

        with patch.object(loader, "get_filesystem", return_value=mock_fs):
            loader.upload(entity, b"data", "run-1")

        dir_path = mock_fs.get_directory_client.call_args[0][0]
        assert "mydb" in dir_path


# ---------------------------------------------------------------------------
# upload — success and failure
# ---------------------------------------------------------------------------

class TestUploadResult:
    def test_success_returns_byte_count(self):
        loader, _ = _make_loader()
        entity = _make_entity()
        data = b"x" * 1024

        mock_fs = MagicMock()
        mock_dir = MagicMock()
        mock_file = MagicMock()
        mock_fs.get_directory_client.return_value = mock_dir
        mock_dir.get_file_client.return_value = mock_file

        with patch.object(loader, "get_filesystem", return_value=mock_fs):
            result = loader.upload(entity, data, "run-1")

        assert result.succeeded
        assert result.bytes_transferred == 1024
        assert result.layer == "landing"

    def test_failure_returns_error(self):
        loader, _ = _make_loader()
        entity = _make_entity()

        with patch.object(loader, "get_filesystem", side_effect=RuntimeError("ADLS down")):
            result = loader.upload(entity, b"data", "run-1")

        assert not result.succeeded
        assert "ADLS down" in result.error


# ---------------------------------------------------------------------------
# upload_entity convenience wrapper
# ---------------------------------------------------------------------------

class TestUploadEntity:
    def test_returns_tuple_of_three(self):
        loader, _ = _make_loader()
        entity = _make_entity(namespace="MES", source_name="Orders")

        mock_fs = MagicMock()
        mock_dir = MagicMock()
        mock_file = MagicMock()
        mock_fs.get_directory_client.return_value = mock_dir
        mock_dir.get_file_client.return_value = mock_file

        with patch.object(loader, "get_filesystem", return_value=mock_fs):
            result, file_path, file_name = loader.upload_entity(entity, b"data", "run-1")

        assert isinstance(result, RunResult)
        assert file_path == "MES"
        assert file_name == "Orders.parquet"

    def test_strips_source_name_in_filename(self):
        loader, _ = _make_loader()
        entity = _make_entity(source_name="  MyTable  ")

        mock_fs = MagicMock()
        mock_dir = MagicMock()
        mock_file = MagicMock()
        mock_fs.get_directory_client.return_value = mock_dir
        mock_dir.get_file_client.return_value = mock_file

        with patch.object(loader, "get_filesystem", return_value=mock_fs):
            _, _, file_name = loader.upload_entity(entity, b"data", "run-1")

        assert file_name == "MyTable.parquet"


# ---------------------------------------------------------------------------
# ping
# ---------------------------------------------------------------------------

class TestPing:
    def test_ping_failure_returns_false(self):
        loader, _ = _make_loader()

        mock_fs = MagicMock()
        mock_fs.get_file_system_properties.side_effect = RuntimeError("unreachable")

        with patch.object(loader, "get_filesystem", return_value=mock_fs):
            assert loader.ping() is False
