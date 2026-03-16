# dashboard/app/api/tests/test_parquet_sync.py
"""Tests for the parquet_sync background export module."""

import shutil
import pytest
import pyarrow.parquet as pq

from dashboard.app.api import db as fmd_db
from dashboard.app.api import parquet_sync
import dashboard.app.api.control_plane_db as cpdb


@pytest.fixture
def setup(tmp_path):
    """Wire a fresh temp SQLite DB and an empty OneLake output directory."""
    # Redirect both db module paths to the same temp file
    original_db_path = fmd_db.DB_PATH
    original_cpdb_path = cpdb.DB_PATH

    fmd_db.DB_PATH = tmp_path / "test.db"
    cpdb.DB_PATH = fmd_db.DB_PATH
    fmd_db.init_db()

    # Point parquet_sync at a temp onelake dir
    original_onelake = parquet_sync.ONELAKE_DIR
    parquet_sync.ONELAKE_DIR = tmp_path / "onelake"
    parquet_sync.ONELAKE_DIR.mkdir()

    # Clean up any dirty state left over from a previous test
    parquet_sync._dirty_tables.clear()

    # Seed one connection row so exports aren't trivially empty
    fmd_db.execute("INSERT INTO connections (ConnectionId, Name) VALUES (1, 'test')")

    yield tmp_path

    # Restore module-level state
    fmd_db.DB_PATH = original_db_path
    cpdb.DB_PATH = original_cpdb_path
    parquet_sync.ONELAKE_DIR = original_onelake
    parquet_sync._dirty_tables.clear()


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------


def test_queue_and_export(setup):
    """queue_export + _export_once should produce a valid Parquet file."""
    parquet_sync.queue_export("connections")
    parquet_sync._export_once()

    pq_file = parquet_sync.ONELAKE_DIR / "connections.parquet"
    assert pq_file.exists(), "Parquet file was not created"

    table = pq.read_table(str(pq_file))
    assert table.num_rows == 1
    names = table.column("Name").to_pylist()
    assert names == ["test"]


def test_export_clears_dirty_set(setup):
    """After a successful export the table should no longer be in _dirty_tables."""
    parquet_sync.queue_export("connections")
    assert "connections" in parquet_sync._dirty_tables

    parquet_sync._export_once()

    assert "connections" not in parquet_sync._dirty_tables


def test_multiple_tables_exported(setup):
    """Queuing two tables exports both in a single _export_once() pass."""
    fmd_db.execute("INSERT INTO lakehouses (LakehouseId, Name) VALUES (1, 'LH1')")

    parquet_sync.queue_export("connections")
    parquet_sync.queue_export("lakehouses")
    parquet_sync._export_once()

    assert (parquet_sync.ONELAKE_DIR / "connections.parquet").exists()
    assert (parquet_sync.ONELAKE_DIR / "lakehouses.parquet").exists()


def test_empty_table_skipped(setup):
    """An empty table should not produce a Parquet file (nothing to export)."""
    # lakehouses has no rows in this fixture
    parquet_sync.queue_export("lakehouses")
    parquet_sync._export_once()

    assert not (parquet_sync.ONELAKE_DIR / "lakehouses.parquet").exists()


# ---------------------------------------------------------------------------
# Validation / guard tests
# ---------------------------------------------------------------------------


def test_queue_rejects_unknown_table():
    """queue_export must raise ValueError for tables not in EXPORTABLE_TABLES."""
    with pytest.raises(ValueError, match="nonexistent_table"):
        parquet_sync.queue_export("nonexistent_table")


def test_queue_rejects_sql_injection_attempt():
    """A crafted name that is not in the whitelist must be rejected."""
    with pytest.raises(ValueError):
        parquet_sync.queue_export("connections; DROP TABLE connections--")


# ---------------------------------------------------------------------------
# Error-recovery tests
# ---------------------------------------------------------------------------


def test_export_recovers_from_error(setup):
    """If the destination directory disappears, the table is re-queued."""
    parquet_sync.queue_export("connections")

    # Nuke the output directory to force a write failure
    shutil.rmtree(parquet_sync.ONELAKE_DIR)

    parquet_sync._export_once()

    # Table must be back in the dirty set so it will be retried
    assert "connections" in parquet_sync._dirty_tables


def test_export_retry_succeeds_after_dir_restored(setup):
    """After a failed export and directory restoration, the retry should succeed."""
    parquet_sync.queue_export("connections")
    shutil.rmtree(parquet_sync.ONELAKE_DIR)
    parquet_sync._export_once()  # fails, re-queues

    # Restore the directory
    parquet_sync.ONELAKE_DIR.mkdir()
    parquet_sync._export_once()  # should now succeed

    assert (parquet_sync.ONELAKE_DIR / "connections.parquet").exists()
    assert "connections" not in parquet_sync._dirty_tables


# ---------------------------------------------------------------------------
# Thread smoke test
# ---------------------------------------------------------------------------


def test_start_export_thread_returns_daemon_thread(setup):
    """start_export_thread() should return a live daemon thread."""
    import threading

    t = parquet_sync.start_export_thread()
    assert isinstance(t, threading.Thread)
    assert t.daemon is True
    assert t.is_alive()
