"""
Unit tests for control_plane_db.py — Local SQLite control plane.

Test Categories:
- Schema: Database initialization, idempotency, table/index verification
- Entity CRUD: Upsert insert, upsert update, reads, joins, activation
- Run Tracking: Engine runs, task logs, history, ordering
- Metrics & Stats: get_stats, sync watermark, entity status
- Concurrency: Thread-safe writes, concurrent run tracking
- Edge Cases: NULL values, cleanup old data, bulk_seed edge cases
- Performance: Bulk insert speed, query speed on large datasets

Coverage Target: 60-80%
Run Time Target: < 5 seconds (excluding @pytest.mark.slow)
"""

import pytest
import sqlite3
import os
import sys
import tempfile
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

# Ensure the parent package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import control_plane_db as cpdb


# ============================================================================
# FIXTURES
# ============================================================================

@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    """Create a temporary SQLite database for every test, auto-applied.

    Overrides cpdb.DB_PATH with a fresh temp file before each test,
    initialises the schema, and restores the original path afterwards.
    """
    db_path = tmp_path / 'test_control_plane.db'
    original_path = cpdb.DB_PATH

    cpdb.DB_PATH = db_path
    cpdb.init_db()

    yield db_path

    cpdb.DB_PATH = original_path
    # tmp_path cleanup is handled by pytest automatically


@pytest.fixture
def seeded_db(temp_db):
    """A database pre-seeded with connections, datasources, and entities."""
    # Connection
    cpdb.upsert_connection({
        'ConnectionId': 1, 'ConnectionGuid': 'conn-guid-1',
        'Name': 'CON_MES', 'Type': 'SQL', 'ServerName': 'm3-db1',
        'DatabaseName': 'mes', 'IsActive': 1,
    })
    cpdb.upsert_connection({
        'ConnectionId': 2, 'ConnectionGuid': 'conn-guid-2',
        'Name': 'CON_ETQ', 'Type': 'SQL', 'ServerName': 'M3-DB3',
        'DatabaseName': 'ETQStagingPRD', 'IsActive': 1,
    })

    # Datasources
    cpdb.upsert_datasource({
        'DataSourceId': 1, 'ConnectionId': 1,
        'Name': 'MES', 'Namespace': 'MES', 'Type': 'Database',
        'Description': 'Manufacturing Execution System', 'IsActive': 1,
    })
    cpdb.upsert_datasource({
        'DataSourceId': 2, 'ConnectionId': 2,
        'Name': 'ETQ', 'Namespace': 'ETQ', 'Type': 'Database',
        'Description': 'Quality Management', 'IsActive': 1,
    })

    # Lakehouses
    cpdb.upsert_lakehouse({
        'LakehouseId': 1, 'Name': 'LH_LANDINGZONE',
        'WorkspaceGuid': 'ws-guid', 'LakehouseGuid': 'lh-lz-guid',
    })
    cpdb.upsert_lakehouse({
        'LakehouseId': 2, 'Name': 'LH_BRONZE',
        'WorkspaceGuid': 'ws-guid', 'LakehouseGuid': 'lh-br-guid',
    })

    # LZ entities (10 MES + 5 ETQ)
    for i in range(1, 16):
        ds_id = 1 if i <= 10 else 2
        cpdb.upsert_lz_entity({
            'LandingzoneEntityId': i, 'DataSourceId': ds_id,
            'LakehouseId': 1, 'SourceSchema': 'dbo',
            'SourceName': f'Table_{i}', 'FileName': f'Table_{i}.parquet',
            'FilePath': 'MES' if ds_id == 1 else 'ETQ',
            'IsActive': 1,
        })

    # Bronze entities
    for i in range(1, 16):
        cpdb.upsert_bronze_entity({
            'BronzeLayerEntityId': i, 'LandingzoneEntityId': i,
            'LakehouseId': 2, 'Schema_': 'dbo',
            'Name': f'Table_{i}', 'PrimaryKeys': 'Id',
            'IsActive': 1,
        })

    # Silver entities
    for i in range(1, 16):
        cpdb.upsert_silver_entity({
            'SilverLayerEntityId': i, 'BronzeLayerEntityId': i,
            'LakehouseId': 2, 'Schema_': 'dbo',
            'Name': f'Table_{i}', 'IsActive': 1,
        })

    return temp_db


# ============================================================================
# 1. SCHEMA TESTS
# ============================================================================

class TestSchema:
    """T-CPDB-001 through T-CPDB-003: Schema creation and verification."""

    EXPECTED_TABLES = [
        'connections', 'datasources', 'lakehouses', 'workspaces', 'pipelines',
        'lz_entities', 'bronze_entities', 'silver_entities',
        'engine_runs', 'engine_task_log',
        'self_heal_cases', 'self_heal_events', 'self_heal_runtime',
        'pipeline_lz_entity', 'pipeline_bronze_entity',
        'entity_status', 'watermarks',
        'pipeline_audit', 'copy_activity_audit',
        'sync_metadata',
    ]

    EXPECTED_INDEXES = [
        'idx_lz_datasource', 'idx_lz_active',
        'idx_bronze_lz', 'idx_silver_bronze',
        'idx_runs_status', 'idx_tasklog_run', 'idx_tasklog_entity',
        'idx_shc_status', 'idx_shc_run', 'idx_shc_entity', 'idx_she_case',
        'idx_plz_entity', 'idx_pbronze_entity', 'idx_estatus_layer',
        'idx_paudit_run', 'idx_caudit_run', 'idx_caudit_entity',
    ]

    def test_init_db_creates_all_tables(self):
        """T-CPDB-001: init_db() creates all 17 required tables."""
        conn = sqlite3.connect(str(cpdb.DB_PATH))
        try:
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            tables = [row[0] for row in cursor.fetchall()]
            for expected in self.EXPECTED_TABLES:
                assert expected in tables, f"Table '{expected}' not created by init_db()"
        finally:
            conn.close()

    def test_init_db_idempotent(self):
        """T-CPDB-002: Calling init_db() multiple times does not error or duplicate."""
        cpdb.init_db()

        conn = sqlite3.connect(str(cpdb.DB_PATH))
        try:
            cursor = conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
            )
            count_first = cursor.fetchone()[0]
        finally:
            conn.close()

        # Call again — table count must not change
        cpdb.init_db()
        cpdb.init_db()

        conn = sqlite3.connect(str(cpdb.DB_PATH))
        try:
            cursor = conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
            )
            count_after = cursor.fetchone()[0]
            assert count_after == count_first, (
                f"Table count changed after multiple init_db calls: "
                f"{count_first} -> {count_after}"
            )
        finally:
            conn.close()

    def test_init_db_creates_indexes(self):
        """T-CPDB-003: init_db() creates all required indexes."""
        conn = sqlite3.connect(str(cpdb.DB_PATH))
        try:
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
            )
            indexes = [row[0] for row in cursor.fetchall()]
            for expected in self.EXPECTED_INDEXES:
                assert expected in indexes, f"Index '{expected}' not created by init_db()"
        finally:
            conn.close()

    def test_wal_mode_enabled(self):
        """init_db sets WAL journal mode via _get_conn."""
        conn = cpdb._get_conn()
        try:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            assert mode == 'wal', f"Expected WAL mode, got '{mode}'"
        finally:
            conn.close()


# ============================================================================
# 2. ENTITY CRUD TESTS
# ============================================================================

class TestConnectionCRUD:
    """Connection upsert and read tests."""

    def test_upsert_connection_insert(self):
        """T-CPDB-004: upsert_connection inserts a new connection."""
        cpdb.upsert_connection({
            'ConnectionId': 1, 'ConnectionGuid': 'abc-123',
            'Name': 'CON_TEST', 'Type': 'SQL',
            'ServerName': 'test-server', 'DatabaseName': 'test_db',
            'IsActive': 1,
        })
        conns = cpdb.get_connections()
        assert len(conns) == 1
        assert conns[0]['Name'] == 'CON_TEST'
        assert conns[0]['Type'] == 'SQL'
        assert conns[0]['IsActive'] == 1

    def test_upsert_connection_update(self):
        """T-CPDB-005: upsert_connection updates existing connection by PK."""
        cpdb.upsert_connection({
            'ConnectionId': 1, 'Name': 'CON_V1', 'Type': 'SQL',
        })
        cpdb.upsert_connection({
            'ConnectionId': 1, 'Name': 'CON_V2', 'Type': 'REST',
        })
        conns = cpdb.get_connections()
        assert len(conns) == 1
        assert conns[0]['Name'] == 'CON_V2'
        assert conns[0]['Type'] == 'REST'

    def test_get_connections_empty(self):
        """T-CPDB-006: get_connections returns empty list when no data."""
        assert cpdb.get_connections() == []


class TestLZEntityCRUD:
    """Landing Zone entity upsert and read tests."""

    def test_upsert_lz_entity_insert(self):
        """T-CPDB-007: upsert_lz_entity inserts a new LZ entity."""
        cpdb.upsert_datasource({'DataSourceId': 1, 'ConnectionId': 1, 'Name': 'MES'})
        cpdb.upsert_lz_entity({
            'LandingzoneEntityId': 100, 'DataSourceId': 1,
            'SourceSchema': 'dbo', 'SourceName': 'Orders',
            'IsActive': 1, 'IsIncremental': 0,
        })
        entities = cpdb.get_lz_entities()
        assert len(entities) == 1
        assert entities[0]['SourceName'] == 'Orders'
        assert entities[0]['IsActive'] == 1

    def test_upsert_lz_entity_update(self):
        """T-CPDB-008: upsert_lz_entity updates existing entity by PK."""
        cpdb.upsert_lz_entity({
            'LandingzoneEntityId': 1, 'DataSourceId': 1,
            'SourceName': 'OldName', 'IsActive': 1,
        })
        cpdb.upsert_lz_entity({
            'LandingzoneEntityId': 1, 'DataSourceId': 1,
            'SourceName': 'NewName', 'IsActive': 0,
        })
        entities = cpdb.get_lz_entities()
        assert len(entities) == 1
        assert entities[0]['SourceName'] == 'NewName'
        assert entities[0]['IsActive'] == 0

    def test_get_lz_entities_with_datasource_join(self, seeded_db):
        """T-CPDB-009: get_lz_entities joins with datasources table."""
        entities = cpdb.get_lz_entities()
        assert len(entities) == 15
        # Check that the join populated DataSourceName
        mes_entities = [e for e in entities if e.get('DataSourceName') == 'MES']
        etq_entities = [e for e in entities if e.get('DataSourceName') == 'ETQ']
        assert len(mes_entities) == 10
        assert len(etq_entities) == 5


class TestBronzeSilverCRUD:
    """Bronze and Silver entity upsert and read tests."""

    def test_upsert_bronze_entity(self):
        """T-CPDB-010: upsert_bronze_entity creates bronze entity."""
        cpdb.upsert_bronze_entity({
            'BronzeLayerEntityId': 1, 'LandingzoneEntityId': 1,
            'Schema_': 'dbo', 'Name': 'Orders', 'PrimaryKeys': 'OrderId',
            'IsActive': 1,
        })
        entities = cpdb.get_bronze_entities()
        assert len(entities) == 1
        assert entities[0]['Name'] == 'Orders'

    def test_upsert_bronze_entity_schema_key_fallback(self):
        """Bronze entity accepts 'Schema' key as fallback for 'Schema_'."""
        cpdb.upsert_bronze_entity({
            'BronzeLayerEntityId': 2, 'LandingzoneEntityId': 1,
            'Schema': 'staging', 'Name': 'Events',
            'IsActive': 1,
        })
        entities = cpdb.get_bronze_entities()
        assert len(entities) == 1
        assert entities[0]['Schema'] == 'staging'

    def test_upsert_silver_entity(self):
        """T-CPDB-011: upsert_silver_entity creates silver entity."""
        cpdb.upsert_silver_entity({
            'SilverLayerEntityId': 1, 'BronzeLayerEntityId': 1,
            'Schema_': 'dbo', 'Name': 'Orders', 'IsActive': 1,
        })
        entities = cpdb.get_silver_entities()
        assert len(entities) == 1
        assert entities[0]['Name'] == 'Orders'

    def test_get_bronze_view(self, seeded_db):
        """get_bronze_view returns active bronze entities with join data."""
        rows = cpdb.get_bronze_view()
        assert len(rows) == 15
        assert all(r['IsActive'] == 1 for r in rows)
        # Should have joined SourceName from lz_entities
        assert all(r['SourceName'] is not None for r in rows)

    def test_get_silver_view(self, seeded_db):
        """get_silver_view returns active silver entities with join data."""
        rows = cpdb.get_silver_view()
        assert len(rows) == 15
        assert all(r['IsActive'] == 1 for r in rows)


# ============================================================================
# 3. RUN TRACKING TESTS
# ============================================================================

class TestRunTracking:
    """Engine run and task log tests."""

    def test_upsert_engine_run_insert(self):
        """T-CPDB-012: upsert_engine_run creates a new run record."""
        cpdb.upsert_engine_run({
            'RunId': 'run-001', 'Mode': 'execute',
            'Status': 'InProgress', 'TotalEntities': 100,
            'Layers': 'landing,bronze', 'TriggeredBy': 'pytest',
            'StartedAt': '2026-03-10T10:00:00Z',
        })
        runs = cpdb.get_engine_runs(limit=10)
        assert len(runs) == 1
        assert runs[0]['RunId'] == 'run-001'
        assert runs[0]['Status'] == 'InProgress'
        assert runs[0]['TotalEntities'] == 100

    def test_upsert_engine_run_update(self):
        """T-CPDB-013: upsert_engine_run updates existing run (e.g. on completion)."""
        cpdb.upsert_engine_run({
            'RunId': 'run-002', 'Status': 'InProgress',
            'TotalEntities': 50, 'StartedAt': '2026-03-10T10:00:00Z',
        })
        cpdb.upsert_engine_run({
            'RunId': 'run-002', 'Status': 'Succeeded',
            'TotalEntities': 50, 'SucceededEntities': 48,
            'FailedEntities': 2, 'TotalRowsRead': 100000,
            'TotalDurationSeconds': 600.0,
            'StartedAt': '2026-03-10T10:00:00Z',
            'EndedAt': '2026-03-10T10:10:00Z',
        })
        runs = cpdb.get_engine_runs(limit=10)
        assert len(runs) == 1
        assert runs[0]['Status'] == 'Succeeded'
        assert runs[0]['SucceededEntities'] == 48
        assert runs[0]['FailedEntities'] == 2

    def test_insert_engine_task_log(self):
        """T-CPDB-014: insert_engine_task_log creates task log entries."""
        cpdb.insert_engine_task_log({
            'RunId': 'run-001', 'EntityId': 42,
            'Layer': 'landing', 'Status': 'succeeded',
            'RowsRead': 5000, 'RowsWritten': 5000,
            'DurationSeconds': 12.5,
        })
        logs = cpdb.get_engine_task_log(run_id='run-001')
        assert len(logs) == 1
        assert logs[0]['EntityId'] == 42
        assert logs[0]['RowsRead'] == 5000

    def test_get_engine_runs_limit(self):
        """T-CPDB-015: get_engine_runs respects limit parameter."""
        for i in range(10):
            cpdb.upsert_engine_run({
                'RunId': f'run-{i:03d}', 'Status': 'Succeeded',
                'StartedAt': f'2026-03-10T{10+i:02d}:00:00Z',
            })
        runs = cpdb.get_engine_runs(limit=5)
        assert len(runs) == 5

    def test_get_engine_runs_order(self):
        """T-CPDB-016: get_engine_runs returns most recent first (DESC)."""
        cpdb.upsert_engine_run({
            'RunId': 'old', 'Status': 'Succeeded',
            'StartedAt': '2026-03-10T08:00:00Z',
        })
        cpdb.upsert_engine_run({
            'RunId': 'new', 'Status': 'Succeeded',
            'StartedAt': '2026-03-10T12:00:00Z',
        })
        runs = cpdb.get_engine_runs(limit=10)
        assert runs[0]['RunId'] == 'new'
        assert runs[1]['RunId'] == 'old'

    def test_get_engine_task_log_filter_by_entity(self):
        """Task log can be filtered by entity_id."""
        cpdb.insert_engine_task_log({'RunId': 'r1', 'EntityId': 1, 'Status': 'succeeded'})
        cpdb.insert_engine_task_log({'RunId': 'r1', 'EntityId': 2, 'Status': 'failed'})
        cpdb.insert_engine_task_log({'RunId': 'r2', 'EntityId': 1, 'Status': 'succeeded'})

        logs = cpdb.get_engine_task_log(entity_id=1)
        assert len(logs) == 2
        assert all(l['EntityId'] == 1 for l in logs)

    def test_get_engine_task_log_no_filters(self):
        """Task log with no filters returns all rows."""
        cpdb.insert_engine_task_log({'RunId': 'r1', 'EntityId': 1, 'Status': 'ok'})
        cpdb.insert_engine_task_log({'RunId': 'r2', 'EntityId': 2, 'Status': 'ok'})

        logs = cpdb.get_engine_task_log()
        assert len(logs) == 2


# ============================================================================
# 4. METRICS & STATS TESTS
# ============================================================================

class TestMetricsAndStats:
    """Stats, sync watermark, and entity status tests."""

    def test_get_stats_empty_db(self):
        """T-CPDB-017: get_stats returns all zeroes for empty database."""
        stats = cpdb.get_stats()
        assert isinstance(stats, dict)
        assert stats['connections'] == 0
        assert stats['lz_entities'] == 0
        assert stats['engine_runs'] == 0
        assert stats['sync_metadata'] == 0
        # Includes the load_center_runs mirror added after Task 10.
        assert len(stats) == 22

    def test_get_stats_with_data(self, seeded_db):
        """T-CPDB-018: get_stats returns correct counts for populated database."""
        stats = cpdb.get_stats()
        assert stats['connections'] == 2
        assert stats['datasources'] == 2
        assert stats['lakehouses'] == 2
        assert stats['lz_entities'] == 15
        assert stats['bronze_entities'] == 15
        assert stats['silver_entities'] == 15

    def test_sync_watermark_roundtrip(self):
        """T-CPDB-019: set_sync_watermark and get_sync_watermark round-trip."""
        assert cpdb.get_sync_watermark() is None  # empty initially

        ts = '2026-03-10T12:00:00Z'
        cpdb.set_sync_watermark(ts)
        assert cpdb.get_sync_watermark() == ts

    def test_sync_watermark_update(self):
        """Sync watermark can be updated (overwrites previous)."""
        cpdb.set_sync_watermark('2026-03-10T10:00:00Z')
        cpdb.set_sync_watermark('2026-03-10T14:00:00Z')
        assert cpdb.get_sync_watermark() == '2026-03-10T14:00:00Z'

    def test_upsert_entity_status_insert(self):
        """T-CPDB-020: upsert_entity_status creates entity status record."""
        cpdb.upsert_entity_status({
            'LandingzoneEntityId': 1, 'Layer': 'landing',
            'Status': 'Succeeded', 'LoadEndDateTime': '2026-03-10T10:00:00Z',
        })
        statuses = cpdb.get_entity_status_all()
        assert len(statuses) == 1
        assert statuses[0]['Status'] == 'Succeeded'
        assert statuses[0]['Layer'] == 'landing'

    def test_upsert_entity_status_update(self):
        """Entity status is updated via composite PK (entity_id + layer)."""
        cpdb.upsert_entity_status({
            'LandingzoneEntityId': 1, 'Layer': 'bronze',
            'Status': 'InProgress',
        })
        cpdb.upsert_entity_status({
            'LandingzoneEntityId': 1, 'Layer': 'bronze',
            'Status': 'Succeeded', 'LoadEndDateTime': '2026-03-10T10:05:00Z',
        })
        statuses = cpdb.get_entity_status_all()
        assert len(statuses) == 1
        assert statuses[0]['Status'] == 'Succeeded'

    def test_upsert_entity_status_multiple_layers(self):
        """Entity can have separate statuses per layer."""
        cpdb.upsert_entity_status({
            'LandingzoneEntityId': 1, 'Layer': 'landing', 'Status': 'Succeeded',
        })
        cpdb.upsert_entity_status({
            'LandingzoneEntityId': 1, 'Layer': 'bronze', 'Status': 'Failed',
        })
        cpdb.upsert_entity_status({
            'LandingzoneEntityId': 1, 'Layer': 'silver', 'Status': 'Pending',
        })
        statuses = cpdb.get_entity_status_all()
        assert len(statuses) == 3
        status_map = {s['Layer']: s['Status'] for s in statuses}
        assert status_map['landing'] == 'Succeeded'
        assert status_map['bronze'] == 'Failed'
        assert status_map['silver'] == 'Pending'


# ============================================================================
# 5. WATERMARK TESTS
# ============================================================================

class TestWatermarks:
    """Watermark upsert and read tests."""

    def test_upsert_watermark(self):
        """upsert_watermark stores load value for an entity."""
        cpdb.upsert_watermark(1, '2026-03-10T00:00:00Z', '2026-03-10T01:00:00Z')
        conn = cpdb._get_conn()
        try:
            row = conn.execute(
                "SELECT * FROM watermarks WHERE LandingzoneEntityId = 1"
            ).fetchone()
            assert row is not None
            assert dict(row)['LoadValue'] == '2026-03-10T00:00:00Z'
        finally:
            conn.close()

    def test_upsert_watermark_update(self):
        """Watermark updates on re-insert for same entity."""
        cpdb.upsert_watermark(1, 'old-value')
        cpdb.upsert_watermark(1, 'new-value')
        conn = cpdb._get_conn()
        try:
            row = conn.execute(
                "SELECT LoadValue FROM watermarks WHERE LandingzoneEntityId = 1"
            ).fetchone()
            assert row['LoadValue'] == 'new-value'
        finally:
            conn.close()


# ============================================================================
# 6. PIPELINE QUEUE TESTS
# ============================================================================

class TestPipelineQueues:
    """Pipeline LZ entity and Bronze entity queue tests."""

    def test_upsert_pipeline_lz_entity(self):
        """Pipeline LZ queue entity can be inserted and read."""
        cpdb.upsert_pipeline_lz_entity({
            'id': 1, 'LandingzoneEntityId': 42,
            'FileName': 'Orders.parquet', 'FilePath': 'MES',
            'InsertDateTime': '2026-03-10T10:00:00Z', 'IsProcessed': 0,
        })
        stats = cpdb.get_stats()
        assert stats['pipeline_lz_entity'] == 1

    def test_upsert_pipeline_bronze_entity(self):
        """Pipeline Bronze queue entity can be inserted and read."""
        cpdb.upsert_pipeline_bronze_entity({
            'id': 1, 'BronzeLayerEntityId': 42,
            'TableName': 'Orders', 'SchemaName': 'dbo',
            'InsertDateTime': '2026-03-10T10:00:00Z', 'IsProcessed': 0,
        })
        stats = cpdb.get_stats()
        assert stats['pipeline_bronze_entity'] == 1


# ============================================================================
# 7. AUDIT LOG TESTS
# ============================================================================

class TestAuditLogs:
    """Pipeline audit and copy activity audit tests."""

    def test_insert_pipeline_audit(self):
        """insert_pipeline_audit creates audit record."""
        cpdb.insert_pipeline_audit({
            'PipelineRunGuid': 'guid-001', 'PipelineName': 'PL_FMD_LDZ_COPY_SQL',
            'EntityLayer': 'Landing', 'TriggerType': 'Manual',
            'LogType': 'StartExecution', 'LogDateTime': '2026-03-10T10:00:00Z',
            'EntityId': 1,
        })
        execs = cpdb.get_pipeline_executions(limit=10)
        assert len(execs) == 1
        assert execs[0]['PipelineName'] == 'PL_FMD_LDZ_COPY_SQL'

    def test_insert_copy_activity_audit(self):
        """insert_copy_activity_audit creates audit record."""
        cpdb.insert_copy_activity_audit({
            'PipelineRunGuid': 'guid-001', 'CopyActivityName': 'Copy_Orders',
            'EntityLayer': 'Landing', 'TriggerType': 'Manual',
            'LogType': 'EndExecution', 'LogDateTime': '2026-03-10T10:01:00Z',
            'EntityId': 1, 'CopyActivityParameters': '{"rows": 5000}',
        })
        execs = cpdb.get_copy_executions(limit=10)
        assert len(execs) == 1
        assert execs[0]['CopyActivityName'] == 'Copy_Orders'

    def test_get_pipeline_executions_limit(self):
        """get_pipeline_executions respects limit."""
        for i in range(10):
            cpdb.insert_pipeline_audit({
                'PipelineRunGuid': f'guid-{i}', 'PipelineName': 'PL',
                'LogType': 'Start', 'LogDateTime': f'2026-03-10T10:{i:02d}:00Z',
                'EntityId': i,
            })
        execs = cpdb.get_pipeline_executions(limit=5)
        assert len(execs) == 5

    def test_get_pipeline_executions_order(self):
        """get_pipeline_executions returns most recent first."""
        cpdb.insert_pipeline_audit({
            'PipelineRunGuid': 'old', 'PipelineName': 'PL',
            'LogType': 'Start', 'LogDateTime': '2026-03-10T08:00:00Z',
            'EntityId': 1,
        })
        cpdb.insert_pipeline_audit({
            'PipelineRunGuid': 'new', 'PipelineName': 'PL',
            'LogType': 'Start', 'LogDateTime': '2026-03-10T12:00:00Z',
            'EntityId': 2,
        })
        execs = cpdb.get_pipeline_executions(limit=10)
        assert execs[0]['PipelineRunGuid'] == 'new'

    def test_get_pipeline_runs_grouped(self):
        """get_pipeline_runs_grouped aggregates by PipelineRunGuid."""
        # Start event
        cpdb.insert_pipeline_audit({
            'PipelineRunGuid': 'run-A', 'PipelineName': 'PL_COPY',
            'EntityLayer': 'Landing', 'TriggerType': 'Manual',
            'LogType': 'StartExecution', 'LogDateTime': '2026-03-10T10:00:00Z',
            'EntityId': 1,
        })
        # End event
        cpdb.insert_pipeline_audit({
            'PipelineRunGuid': 'run-A', 'PipelineName': 'PL_COPY',
            'EntityLayer': 'Landing', 'TriggerType': 'Manual',
            'LogType': 'EndExecution', 'LogDateTime': '2026-03-10T10:05:00Z',
            'LogData': '{"rows": 5000}', 'EntityId': 1,
        })
        grouped = cpdb.get_pipeline_runs_grouped()
        assert len(grouped) == 1
        assert grouped[0]['PipelineRunGuid'] == 'run-A'
        assert grouped[0]['LogCount'] == 2
        assert grouped[0]['StartTime'] is not None
        assert grouped[0]['EndTime'] is not None


# ============================================================================
# 8. MISC READ FUNCTIONS
# ============================================================================

class TestMiscReads:
    """Tests for auxiliary read functions."""

    def test_get_workspaces_empty(self):
        """get_workspaces returns empty list on empty DB."""
        assert cpdb.get_workspaces() == []

    def test_get_workspaces_with_data(self):
        """get_workspaces returns inserted workspace data."""
        cpdb.upsert_workspace({
            'WorkspaceId': 1, 'WorkspaceGuid': 'ws-guid-1',
            'Name': 'INTEGRATION DATA (D)',
        })
        ws = cpdb.get_workspaces()
        assert len(ws) == 1
        assert ws[0]['Name'] == 'INTEGRATION DATA (D)'

    def test_get_pipelines_empty(self):
        """get_pipelines returns empty list on empty DB."""
        assert cpdb.get_pipelines() == []

    def test_get_pipelines_with_data(self):
        """get_pipelines returns inserted pipeline data."""
        cpdb.upsert_pipeline({
            'PipelineId': 1, 'Name': 'PL_FMD_LOAD_ALL', 'IsActive': 1,
        })
        cpdb.upsert_pipeline({
            'PipelineId': 2, 'Name': 'PL_FMD_LDZ_COPY_SQL', 'IsActive': 0,
        })
        pipes = cpdb.get_pipelines()
        assert len(pipes) == 2

    def test_get_lakehouses(self, seeded_db):
        """get_lakehouses returns lakehouse data."""
        lakehouses = cpdb.get_lakehouses()
        assert len(lakehouses) == 2

    def test_get_datasources_with_connection_join(self, seeded_db):
        """get_datasources joins with connections table."""
        ds = cpdb.get_datasources()
        assert len(ds) == 2
        assert all('ConnectionName' in d for d in ds)

    def test_get_registered_entities_full(self, seeded_db):
        """get_registered_entities_full returns enriched LZ entity data."""
        entities = cpdb.get_registered_entities_full()
        assert len(entities) == 15
        # Should include connection join fields
        assert all('ConnectionName' in e for e in entities)
        assert all('ServerName' in e for e in entities)

    def test_get_source_config(self, seeded_db):
        """get_source_config returns datasource+connection joined data."""
        config = cpdb.get_source_config()
        assert len(config) == 2
        assert all('ConnectionName' in c for c in config)
        assert all('ServerName' in c for c in config)


# ============================================================================
# 9. BULK SEED TESTS
# ============================================================================

class TestBulkSeed:
    """bulk_seed utility function tests."""

    def test_bulk_seed_connections(self):
        """bulk_seed inserts multiple rows and returns count."""
        rows = [
            {'ConnectionId': i, 'Name': f'CON_{i}', 'Type': 'SQL', 'IsActive': 1}
            for i in range(1, 6)
        ]
        count = cpdb.bulk_seed('connections', rows)
        assert count == 5
        assert len(cpdb.get_connections()) == 5

    def test_bulk_seed_empty_list(self):
        """bulk_seed with empty list returns 0."""
        count = cpdb.bulk_seed('connections', [])
        assert count == 0

    def test_bulk_seed_replaces_existing(self):
        """bulk_seed uses INSERT OR REPLACE, updating existing rows."""
        cpdb.bulk_seed('connections', [
            {'ConnectionId': 1, 'Name': 'V1', 'Type': 'SQL', 'IsActive': 1},
        ])
        cpdb.bulk_seed('connections', [
            {'ConnectionId': 1, 'Name': 'V2', 'Type': 'REST', 'IsActive': 0},
        ])
        conns = cpdb.get_connections()
        assert len(conns) == 1
        assert conns[0]['Name'] == 'V2'


# ============================================================================
# 10. CONCURRENCY TESTS
# ============================================================================

class TestConcurrency:
    """Thread-safe write tests."""

    def test_concurrent_upsert_entity_status(self):
        """T-CPDB-021: Concurrent writes to entity_status don't corrupt data."""
        errors = []

        def writer(entity_id):
            try:
                for i in range(20):
                    cpdb.upsert_entity_status({
                        'LandingzoneEntityId': entity_id,
                        'Layer': 'bronze',
                        'Status': f'iteration-{i}',
                    })
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(eid,)) for eid in range(1, 6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == [], f"Concurrent write errors: {errors}"
        statuses = cpdb.get_entity_status_all()
        # 5 entities, each with 1 layer = 5 rows (upsert, not insert)
        assert len(statuses) == 5

    def test_concurrent_engine_runs(self):
        """T-CPDB-022: Multiple engine runs can be tracked concurrently."""
        errors = []

        def run_tracker(run_id):
            try:
                cpdb.upsert_engine_run({
                    'RunId': run_id, 'Status': 'InProgress',
                    'TotalEntities': 50,
                    'StartedAt': '2026-03-10T10:00:00Z',
                })
                cpdb.upsert_engine_run({
                    'RunId': run_id, 'Status': 'Succeeded',
                    'TotalEntities': 50, 'SucceededEntities': 50,
                    'EndedAt': '2026-03-10T10:05:00Z',
                })
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=run_tracker, args=(f'conc-run-{i}',))
            for i in range(5)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == [], f"Concurrent run errors: {errors}"
        runs = cpdb.get_engine_runs(limit=50)
        assert len(runs) == 5


# ============================================================================
# 11. EDGE CASE TESTS
# ============================================================================

class TestEdgeCases:
    """NULL handling, cleanup, and boundary conditions."""

    def test_upsert_with_null_optional_fields(self):
        """T-CPDB-023: Upsert handles NULL values for optional fields."""
        cpdb.upsert_lz_entity({
            'LandingzoneEntityId': 1, 'DataSourceId': 1,
            'SourceName': 'TestTable',
            # These are all optional/nullable:
            'SourceSchema': None, 'SourceCustomSelect': None,
            'FileName': None, 'FilePath': None,
            'IsIncrementalColumn': None, 'CustomNotebookName': None,
        })
        entities = cpdb.get_lz_entities()
        assert len(entities) == 1
        assert entities[0]['SourceSchema'] is None

    def test_cleanup_old_data_removes_old_records(self):
        """T-CPDB-024: cleanup_old_data removes records older than N days."""
        # Insert a "fake old" record by directly writing to the DB
        conn = cpdb._get_conn()
        try:
            old_ts = (datetime.now(UTC) - timedelta(days=100)).strftime('%Y-%m-%dT%H:%M:%SZ')
            conn.execute(
                "INSERT INTO engine_task_log (RunId, EntityId, Status, created_at) "
                "VALUES (?, ?, ?, ?)",
                ('old-run', 1, 'succeeded', old_ts)
            )
            conn.execute(
                "INSERT INTO pipeline_audit (PipelineRunGuid, LogType, created_at) "
                "VALUES (?, ?, ?)",
                ('old-guid', 'Start', old_ts)
            )
            conn.execute(
                "INSERT INTO copy_activity_audit (PipelineRunGuid, LogType, created_at) "
                "VALUES (?, ?, ?)",
                ('old-guid', 'Start', old_ts)
            )
            # Also insert recent records that should NOT be deleted
            conn.execute(
                "INSERT INTO engine_task_log (RunId, EntityId, Status, created_at) "
                "VALUES (?, ?, ?, ?)",
                ('new-run', 2, 'succeeded', datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ'))
            )
            conn.commit()
        finally:
            conn.close()

        cpdb.cleanup_old_data(days=90)

        # Old records should be gone
        logs = cpdb.get_engine_task_log(run_id='old-run')
        assert len(logs) == 0

        # Recent records should remain
        logs = cpdb.get_engine_task_log(run_id='new-run')
        assert len(logs) == 1

    def test_cleanup_old_data_preserves_recent(self):
        """cleanup_old_data preserves records newer than the threshold."""
        # Insert a record with a recent timestamp
        cpdb.insert_engine_task_log({
            'RunId': 'recent', 'EntityId': 1, 'Status': 'ok',
        })
        # Cleanup records older than 30 days — our recent record should survive
        cpdb.cleanup_old_data(days=30)

        logs = cpdb.get_engine_task_log()
        assert len(logs) == 1
        assert logs[0]['RunId'] == 'recent'

    def test_v_helper_stringifies_values(self):
        """_v() converts non-None values to strings, None stays None."""
        assert cpdb._v(42) == '42'
        assert cpdb._v(3.14) == '3.14'
        assert cpdb._v('hello') == 'hello'
        assert cpdb._v(None) is None

    def test_engine_run_with_error_summary(self):
        """Engine run can store error summary."""
        cpdb.upsert_engine_run({
            'RunId': 'fail-run', 'Status': 'Failed',
            'ErrorSummary': 'Network timeout after 30s',
            'StartedAt': '2026-03-10T10:00:00Z',
        })
        runs = cpdb.get_engine_runs(limit=1)
        assert runs[0]['ErrorSummary'] == 'Network timeout after 30s'
        assert runs[0]['Status'] == 'Failed'

    def test_task_log_with_error_fields(self):
        """Task log can store error details."""
        cpdb.insert_engine_task_log({
            'RunId': 'r1', 'EntityId': 1, 'Status': 'failed',
            'Layer': 'landing',
            'ErrorType': 'ConnectionError',
            'ErrorMessage': 'Connection refused',
            'ErrorStackTrace': 'Traceback ...',
            'ErrorSuggestion': 'Check VPN connection',
        })
        logs = cpdb.get_engine_task_log(run_id='r1')
        assert logs[0]['ErrorType'] == 'ConnectionError'
        assert logs[0]['ErrorMessage'] == 'Connection refused'

    def test_upsert_connection_default_isactive(self):
        """IsActive defaults to 1 when not provided."""
        cpdb.upsert_connection({
            'ConnectionId': 1, 'Name': 'Test',
        })
        conns = cpdb.get_connections()
        assert conns[0]['IsActive'] == 1


# ============================================================================
# 12. PERFORMANCE TESTS
# ============================================================================

class TestPerformance:
    """Performance benchmarks (marked slow)."""

    @pytest.mark.slow
    def test_bulk_insert_1666_entities(self):
        """T-CPDB-025: Bulk inserting 1,666 LZ entities completes in < 2 seconds."""
        rows = [
            {
                'LandingzoneEntityId': i, 'DataSourceId': (i % 5) + 1,
                'SourceSchema': 'dbo', 'SourceName': f'Table_{i}',
                'IsActive': 1,
            }
            for i in range(1, 1667)
        ]
        start = time.time()
        count = cpdb.bulk_seed('lz_entities', rows)
        duration = time.time() - start

        assert count == 1666
        assert duration < 2.0, f"Bulk insert took {duration:.2f}s (expected < 2s)"

    @pytest.mark.slow
    def test_query_performance_large_dataset(self):
        """T-CPDB-026: Querying 1,666 entities completes in < 0.5s."""
        rows = [
            {
                'LandingzoneEntityId': i, 'DataSourceId': 1,
                'SourceSchema': 'dbo', 'SourceName': f'Table_{i}',
                'IsActive': 1,
            }
            for i in range(1, 1667)
        ]
        cpdb.bulk_seed('lz_entities', rows)

        start = time.time()
        entities = cpdb.get_lz_entities()
        duration = time.time() - start

        assert len(entities) == 1666
        assert duration < 0.5, f"Query took {duration:.2f}s (expected < 0.5s)"

    @pytest.mark.slow
    def test_get_stats_performance(self):
        """get_stats scanning 21 tables completes in < 0.5s even with data."""
        # Seed some data across multiple tables
        cpdb.bulk_seed('connections', [
            {'ConnectionId': i, 'Name': f'C{i}', 'Type': 'SQL'} for i in range(1, 51)
        ])
        cpdb.bulk_seed('lz_entities', [
            {'LandingzoneEntityId': i, 'DataSourceId': 1, 'SourceName': f'T{i}'}
            for i in range(1, 501)
        ])

        start = time.time()
        stats = cpdb.get_stats()
        duration = time.time() - start

        assert stats['connections'] == 50
        assert stats['lz_entities'] == 500
        assert duration < 0.5, f"get_stats took {duration:.2f}s (expected < 0.5s)"


# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
