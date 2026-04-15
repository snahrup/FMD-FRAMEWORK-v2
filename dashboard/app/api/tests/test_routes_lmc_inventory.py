import importlib
import json
import sqlite3
import sys

import pytest

import dashboard.app.api.control_plane_db as cpdb_module
import dashboard.app.api.db as db_module
from dashboard.app.api.router import _routes, dispatch


@pytest.fixture
def tmp_db(tmp_path):
    db_path = tmp_path / "test_lmc_inventory.db"
    original_db = db_module.DB_PATH
    original_cpdb = cpdb_module.DB_PATH
    db_module.DB_PATH = db_path
    cpdb_module.DB_PATH = db_path
    db_module.init_db()

    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO connections (ConnectionId, Name, Type, ServerName, DatabaseName) "
        "VALUES (1, 'TestConn', 'SQL', 'server', 'db')"
    )
    conn.execute(
        "INSERT INTO datasources (DataSourceId, ConnectionId, Name, DisplayName, Namespace) "
        "VALUES (1, 1, 'SourceA', 'Source A', 'SRC_A')"
    )
    conn.execute(
        "INSERT INTO lakehouses (LakehouseId, Name, WorkspaceGuid, LakehouseGuid) "
        "VALUES (1, 'TestLH', 'ws-guid', 'lh-guid')"
    )
    conn.execute(
        "INSERT INTO lz_entities (LandingzoneEntityId, DataSourceId, LakehouseId, SourceSchema, SourceName, FilePath, IsActive, IsIncremental, IsIncrementalColumn) "
        "VALUES (1, 1, 1, 'dbo', 'Orders', 'dbo', 1, 1, 'ModifiedAt')"
    )
    conn.execute(
        "INSERT INTO lz_entities (LandingzoneEntityId, DataSourceId, LakehouseId, SourceSchema, SourceName, FilePath, IsActive, IsIncremental, IsIncrementalColumn) "
        "VALUES (2, 1, 1, 'dbo', 'Customers', 'dbo', 1, 0, NULL)"
    )
    conn.execute(
        "INSERT INTO bronze_entities (BronzeLayerEntityId, LandingzoneEntityId, LakehouseId, IsActive, Schema_, Name) "
        "VALUES (101, 1, 1, 1, 'dbo', 'Orders')"
    )
    conn.execute(
        "INSERT INTO bronze_entities (BronzeLayerEntityId, LandingzoneEntityId, LakehouseId, IsActive, Schema_, Name) "
        "VALUES (102, 2, 1, 1, 'dbo', 'Customers')"
    )
    conn.execute(
        "INSERT INTO silver_entities (SilverLayerEntityId, BronzeLayerEntityId, LakehouseId, IsActive, Schema_, Name) "
        "VALUES (201, 101, 1, 1, 'dbo', 'Orders')"
    )
    conn.execute(
        "INSERT INTO silver_entities (SilverLayerEntityId, BronzeLayerEntityId, LakehouseId, IsActive, Schema_, Name) "
        "VALUES (202, 102, 1, 1, 'dbo', 'Customers')"
    )
    conn.execute(
        "INSERT INTO watermarks (LandingzoneEntityId, LoadValue) VALUES (1, '2026-04-13T10:00:00Z')"
    )
    conn.execute(
        "INSERT INTO engine_runs (RunId, Status, Layers, TriggeredBy, EntityFilter, SourceFilter, ResolvedEntityCount, TotalEntities, StartedAt) "
        "VALUES ('run-1', 'Interrupted', 'landing,bronze,silver', 'dashboard', '1,2', 'SourceA', 2, 2, '2026-04-14T10:00:00Z')"
    )

    # Historical success for entity 2 landing only.
    conn.execute(
        "INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, SourceTable, RowsRead, RowsWritten, created_at) "
        "VALUES ('run-old', 2, 'landing', 'succeeded', 'dbo.Customers', 25, 25, '2026-04-13T08:00:00Z')"
    )

    # In run-1 entity 1 completed all layers, entity 2 never started.
    conn.execute(
        "INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, SourceTable, RowsRead, RowsWritten, created_at) "
        "VALUES ('run-1', 1, 'landing', 'succeeded', 'dbo.Orders', 100, 100, '2026-04-14T10:01:00Z')"
    )
    conn.execute(
        "INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, SourceTable, RowsRead, RowsWritten, created_at) "
        "VALUES ('run-1', 101, 'bronze', 'succeeded', 'dbo.Orders', 100, 100, '2026-04-14T10:02:00Z')"
    )
    conn.execute(
        "INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, SourceTable, RowsRead, RowsWritten, created_at) "
        "VALUES ('run-1', 201, 'silver', 'succeeded', 'dbo.Orders', 100, 100, '2026-04-14T10:03:00Z')"
    )

    # Physical lakehouse presence: Orders exists everywhere, Customers only in landing.
    conn.execute(
        "INSERT INTO lakehouse_row_counts (lakehouse, schema_name, table_name, row_count, scanned_at) "
        "VALUES ('LH_DATA_LANDINGZONE', 'dbo', 'orders', 100, '2026-04-14T11:00:00Z')"
    )
    conn.execute(
        "INSERT INTO lakehouse_row_counts (lakehouse, schema_name, table_name, row_count, scanned_at) "
        "VALUES ('LH_BRONZE_LAYER', 'dbo', 'orders', 100, '2026-04-14T11:00:00Z')"
    )
    conn.execute(
        "INSERT INTO lakehouse_row_counts (lakehouse, schema_name, table_name, row_count, scanned_at) "
        "VALUES ('LH_SILVER_LAYER', 'dbo', 'orders', 100, '2026-04-14T11:00:00Z')"
    )
    conn.execute(
        "INSERT INTO lakehouse_row_counts (lakehouse, schema_name, table_name, row_count, scanned_at) "
        "VALUES ('LH_DATA_LANDINGZONE', 'dbo', 'customers', 25, '2026-04-14T11:00:00Z')"
    )

    conn.commit()
    conn.close()

    yield db_path

    db_module.DB_PATH = original_db
    cpdb_module.DB_PATH = original_cpdb


@pytest.fixture(autouse=True)
def setup_routes(tmp_db):
    _routes.clear()
    mod_name = "dashboard.app.api.routes.load_mission_control"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


def _call(path: str) -> dict:
    status, _headers, body = dispatch("GET", path, {}, None)
    payload = json.loads(body)
    assert status == 200, payload
    return payload


def test_scope_inventory_returns_run_truth_with_history_and_physical_presence(tmp_db):
    payload = _call("/api/lmc/run/run-1/scope-inventory")

    assert payload["run"]["resolvedEntityCount"] == 2
    assert payload["run"]["layersInScope"] == ["landing", "bronze", "silver"]
    assert payload["summary"]["scopeEntityCount"] == 2
    assert payload["summary"]["runGapCount"] == 1
    assert payload["summary"]["historicalMissingByLayer"]["bronze"] == 1
    assert payload["summary"]["physicalMissingByLayer"]["silver"] == 1

    orders = next(row for row in payload["entities"] if row["entityId"] == 1)
    customers = next(row for row in payload["entities"] if row["entityId"] == 2)

    assert orders["runMissingLayers"] == []
    assert orders["physicalLayerStatus"]["silver"]["exists"] is True
    assert orders["historyLayerStatus"]["bronze"]["everSucceeded"] is True
    assert orders["nextAction"] == "incremental"

    assert customers["runAttempted"] is False
    assert customers["runMissingLayers"] == ["landing", "bronze", "silver"]
    assert customers["historyLayerStatus"]["landing"]["everSucceeded"] is True
    assert customers["historyLayerStatus"]["bronze"]["everSucceeded"] is False
    assert customers["physicalLayerStatus"]["landing"]["exists"] is True
    assert customers["physicalLayerStatus"]["bronze"]["exists"] is False
    assert customers["physicalLayerStatus"]["silver"]["exists"] is False
    assert customers["nextAction"] == "full_load"
