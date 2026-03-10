"""Shared fixtures for engine tests.

All fixtures here are available to every test file in engine/tests/.
No network, no VPN, no Fabric connection required.
"""

import pytest
from unittest.mock import MagicMock

from engine.models import Entity, EngineConfig


@pytest.fixture
def sample_entity():
    """A minimal valid Entity for testing."""
    return Entity(
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


@pytest.fixture
def sample_entity_incremental():
    """An incremental Entity with watermark configured."""
    return Entity(
        id=2,
        source_name="AuditLog",
        source_schema="dbo",
        source_server="m3-db1",
        source_database="mes",
        datasource_id=4,
        connection_type="SQL",
        workspace_guid="ws-guid",
        lakehouse_guid="lh-guid",
        file_path="MES",
        file_name="AuditLog.parquet",
        is_incremental=True,
        watermark_column="ModifiedDate",
        last_load_value="2024-06-01T00:00:00Z",
    )


@pytest.fixture
def sample_config():
    """A minimal valid EngineConfig for testing."""
    return EngineConfig(
        sql_server="test-server,1433",
        sql_database="test-db",
        sql_driver="ODBC Driver 18 for SQL Server",
        tenant_id="tenant-id",
        client_id="client-id",
        client_secret="client-secret",
        workspace_data_id="ws-data",
        workspace_code_id="ws-code",
        lz_lakehouse_id="lz-id",
        bronze_lakehouse_id="br-id",
        silver_lakehouse_id="sv-id",
    )


@pytest.fixture
def mock_token_provider():
    """Mock TokenProvider that validates successfully."""
    tp = MagicMock()
    tp.validate.return_value = {"fabric_sql": True, "fabric_api": True, "onelake": True}
    return tp


@pytest.fixture
def mock_metadata_db():
    """Mock MetadataDB that pings successfully."""
    db = MagicMock()
    db.ping.return_value = True
    return db


@pytest.fixture
def mock_source_conn():
    """Mock SourceConnection that pings successfully."""
    sc = MagicMock()
    sc.ping.return_value = True
    return sc


@pytest.fixture
def mock_loader():
    """Mock OneLakeLoader that pings successfully."""
    loader = MagicMock()
    loader.ping.return_value = True
    return loader
