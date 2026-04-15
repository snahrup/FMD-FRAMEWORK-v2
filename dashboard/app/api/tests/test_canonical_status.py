"""Tests for get_canonical_entity_status() — derives entity status from engine_task_log."""
import os
import sys
import pytest

# Match existing import pattern from test_control_plane_db.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import control_plane_db as cpdb


@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    """Override DB_PATH with a fresh temp file, init schema, restore afterwards."""
    db_path = tmp_path / 'test_canonical.db'
    original_path = cpdb.DB_PATH
    cpdb.DB_PATH = db_path
    cpdb.init_db()
    yield db_path
    cpdb.DB_PATH = original_path


def _seed_task_log(db_path):
    """Seed engine_task_log with test data."""
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        INSERT INTO connections (ConnectionId, Name, Type, IsActive)
        VALUES (1, 'CON_TEST', 'SQL', 1);

        INSERT INTO datasources (DataSourceId, ConnectionId, Name, Namespace, IsActive)
        VALUES (1, 1, 'MES', 'MES', 1);

        INSERT INTO lz_entities (
            LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, IsActive
        ) VALUES
            (1, 1, 'dbo', 'orders', 1),
            (2, 1, 'dbo', 'customers', 1),
            (3, 1, 'dbo', 'inventory', 1),
            (10, 1, 'dbo', 'repairs', 1);

        INSERT INTO bronze_entities (
            BronzeLayerEntityId, LandingzoneEntityId, Schema_, Name, IsActive
        ) VALUES
            (101, 1, 'dbo', 'orders', 1),
            (102, 2, 'dbo', 'customers', 1);

        INSERT INTO silver_entities (
            SilverLayerEntityId, BronzeLayerEntityId, Schema_, Name, IsActive
        ) VALUES
            (201, 101, 'dbo', 'orders', 1);

        -- Entity 1: succeeded in all 3 layers, but bronze/silver use their own IDs
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-1', 1, 'landing', 'succeeded', 100, '2026-03-19T10:00:00Z');
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-1', 101, 'bronze', 'succeeded', 100, '2026-03-19T10:01:00Z');
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-1', 201, 'silver', 'succeeded', 100, '2026-03-19T10:02:00Z');

        -- Entity 2: landing succeeded, bronze failed, silver never ran
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-1', 2, 'landing', 'succeeded', 50, '2026-03-19T10:00:00Z');
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at, ErrorMessage)
        VALUES ('run-1', 102, 'bronze', 'failed', 0, '2026-03-19T10:01:00Z', 'timeout');

        -- Entity 3: skipped in landing (e.g. incremental with no changes)
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-2', 3, 'landing', 'skipped', 0, '2026-03-19T11:00:00Z');

        -- Entity 1: second run — succeeded again (should pick latest)
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-2', 1, 'landing', 'succeeded', 20, '2026-03-19T12:00:00Z');
    """)
    conn.close()


def test_canonical_status_returns_latest_per_entity_per_layer(temp_db):
    """Latest succeeded status should win over older entries."""
    _seed_task_log(temp_db)
    result = cpdb.get_canonical_entity_status()

    # Build lookup: (EntityId, Layer) -> row
    lookup = {(r["LandingzoneEntityId"], r["Layer"]): r for r in result}

    # Entity 1 landing: latest is run-2 (12:00)
    e1_lz = lookup[(1, "landing")]
    assert e1_lz["Status"] == "succeeded"
    assert e1_lz["LoadEndDateTime"] == "2026-03-19T12:00:00Z"

    # Entity 1 bronze: from run-1
    assert lookup[(1, "bronze")]["Status"] == "succeeded"

    # Entity 1 silver: from run-1
    assert lookup[(1, "silver")]["Status"] == "succeeded"

    # Entity 2 landing: succeeded
    assert lookup[(2, "landing")]["Status"] == "succeeded"

    # Entity 2 bronze: failed
    assert lookup[(2, "bronze")]["Status"] == "failed"
    assert lookup[(2, "bronze")]["ErrorMessage"] == "timeout"

    # Entity 2 silver: should NOT exist (never ran)
    assert (2, "silver") not in lookup

    # Entity 3 landing: skipped
    assert lookup[(3, "landing")]["Status"] == "skipped"


def test_canonical_status_prefers_success_over_old_failure(temp_db):
    """If entity failed then succeeded later, status should be succeeded."""
    import sqlite3
    conn = sqlite3.connect(str(temp_db))
    conn.executescript("""
        INSERT INTO connections (ConnectionId, Name, Type, IsActive)
        VALUES (1, 'CON_TEST', 'SQL', 1);
        INSERT INTO datasources (DataSourceId, ConnectionId, Name, Namespace, IsActive)
        VALUES (1, 1, 'MES', 'MES', 1);
        INSERT INTO lz_entities (
            LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, IsActive
        ) VALUES (10, 1, 'dbo', 'repairs', 1);
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, created_at, ErrorMessage)
        VALUES ('run-1', 10, 'landing', 'failed', '2026-03-18T08:00:00Z', 'connection refused');
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-2', 10, 'landing', 'succeeded', 500, '2026-03-19T08:00:00Z');
    """)
    conn.close()

    result = cpdb.get_canonical_entity_status()
    lookup = {(r["LandingzoneEntityId"], r["Layer"]): r for r in result}
    assert lookup[(10, "landing")]["Status"] == "succeeded"
    assert lookup[(10, "landing")]["ErrorMessage"] is None  # success clears error


def test_mapped_engine_task_log_normalizes_bronze_and_silver_ids(temp_db):
    """Bronze/silver task rows should resolve back to the owning LZ entity."""
    _seed_task_log(temp_db)
    rows = cpdb.get_mapped_engine_task_log(latest_only=True)
    lookup = {(r["LandingzoneEntityId"], r["Layer"]): r for r in rows}

    assert lookup[(1, "bronze")]["SourceName"] == "orders"
    assert lookup[(1, "silver")]["SourceName"] == "orders"
    assert lookup[(2, "bronze")]["SourceName"] == "customers"
    assert (101, "bronze") not in lookup
    assert (201, "silver") not in lookup
