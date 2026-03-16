# dashboard/app/api/tests/test_delta_ingest.py
"""Tests for delta_ingest — OneLake Parquet to SQLite upsert."""
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api import db as fmd_db
from dashboard.app.api import delta_ingest


@pytest.fixture
def setup(tmp_path):
    """Redirect DB and OneLake dir to tmp locations; reset watermark state."""
    original_db = fmd_db.DB_PATH
    original_cpdb = cpdb.DB_PATH

    fmd_db.DB_PATH = tmp_path / "test.db"
    cpdb.DB_PATH = fmd_db.DB_PATH
    fmd_db.init_db()

    original_onelake = delta_ingest.ONELAKE_DIR
    onelake_dir = tmp_path / "onelake"
    onelake_dir.mkdir()
    delta_ingest.ONELAKE_DIR = onelake_dir
    delta_ingest._watermarks.clear()

    yield tmp_path

    # Restore originals
    fmd_db.DB_PATH = original_db
    cpdb.DB_PATH = original_cpdb
    delta_ingest.ONELAKE_DIR = original_onelake
    delta_ingest._watermarks.clear()


def test_ingest_parquet_into_sqlite(setup):
    """A valid engine_runs parquet is read and upserted into SQLite."""
    table = pa.table({
        "RunId": ["run-001"],
        "Mode": ["full"],
        "Status": ["Completed"],
        "TotalEntities": [10],
        "SucceededEntities": [8],
        "FailedEntities": [2],
        "SkippedEntities": [0],
    })
    pq.write_table(table, delta_ingest.ONELAKE_DIR / "engine_runs.parquet")

    delta_ingest.ingest_all()

    rows = fmd_db.query("SELECT * FROM engine_runs WHERE RunId = ?", ("run-001",))
    assert len(rows) == 1
    assert rows[0]["Status"] == "Completed"
    assert rows[0]["Mode"] == "full"


def test_watermark_skips_unchanged_files(setup):
    """Second ingest_all() call on the same (unmodified) file is a no-op."""
    table = pa.table({
        "RunId": ["run-002"],
        "Mode": ["incremental"],
        "Status": ["Running"],
    })
    path = delta_ingest.ONELAKE_DIR / "engine_runs.parquet"
    pq.write_table(table, path)

    delta_ingest.ingest_all()
    count1 = len(fmd_db.query("SELECT * FROM engine_runs"))

    # Second call — file mtime hasn't changed, should be skipped
    delta_ingest.ingest_all()
    count2 = len(fmd_db.query("SELECT * FROM engine_runs"))

    assert count1 == count2


def test_ignores_unknown_parquet_files(setup):
    """Parquet files not in TABLE_MAP are silently ignored without error."""
    table = pa.table({"col1": ["val1"]})
    pq.write_table(table, delta_ingest.ONELAKE_DIR / "unknown_table.parquet")

    delta_ingest.ingest_all()  # should not raise


def test_ingest_multiple_rows(setup):
    """Multiple rows are all inserted."""
    table = pa.table({
        "RunId": ["run-003", "run-004", "run-005"],
        "Mode": ["full", "incremental", "full"],
        "Status": ["Completed", "Failed", "Running"],
    })
    pq.write_table(table, delta_ingest.ONELAKE_DIR / "engine_runs.parquet")

    delta_ingest.ingest_all()

    rows = fmd_db.query("SELECT RunId FROM engine_runs ORDER BY RunId")
    run_ids = [r["RunId"] for r in rows]
    assert "run-003" in run_ids
    assert "run-004" in run_ids
    assert "run-005" in run_ids


def test_watermark_updates_after_file_change(setup):
    """After the file changes (new mtime), ingest_all() re-reads it."""
    path = delta_ingest.ONELAKE_DIR / "engine_runs.parquet"

    # First write
    table1 = pa.table({"RunId": ["run-006"], "Status": ["Running"]})
    pq.write_table(table1, path)
    delta_ingest.ingest_all()

    rows_before = fmd_db.query("SELECT Status FROM engine_runs WHERE RunId = ?", ("run-006",))
    assert rows_before[0]["Status"] == "Running"

    # Force a new mtime by touching the file content again
    import time
    time.sleep(0.05)  # ensure mtime differs
    table2 = pa.table({"RunId": ["run-006"], "Status": ["Completed"]})
    pq.write_table(table2, path)

    delta_ingest.ingest_all()

    rows_after = fmd_db.query("SELECT Status FROM engine_runs WHERE RunId = ?", ("run-006",))
    assert rows_after[0]["Status"] == "Completed"


def test_ingest_entity_status_composite_pk(setup):
    """entity_status table (composite PK) is upserted correctly."""
    table = pa.table({
        "LandingzoneEntityId": [101, 101, 202],
        "Layer": ["LZ", "Bronze", "LZ"],
        "Status": ["Succeeded", "Failed", "Succeeded"],
    })
    pq.write_table(table, delta_ingest.ONELAKE_DIR / "entity_status.parquet")

    delta_ingest.ingest_all()

    rows = fmd_db.query("SELECT * FROM entity_status ORDER BY LandingzoneEntityId, Layer")
    assert len(rows) == 3
    statuses = {(r["LandingzoneEntityId"], r["Layer"]): r["Status"] for r in rows}
    assert statuses[(101, "LZ")] == "Succeeded"
    assert statuses[(101, "Bronze")] == "Failed"


def test_ingest_skips_empty_parquet(setup):
    """An empty parquet file (zero rows) is skipped without inserting anything."""
    empty = pa.table({"RunId": pa.array([], type=pa.string()), "Status": pa.array([], type=pa.string())})
    pq.write_table(empty, delta_ingest.ONELAKE_DIR / "engine_runs.parquet")

    delta_ingest.ingest_all()

    rows = fmd_db.query("SELECT * FROM engine_runs")
    assert len(rows) == 0


def test_onelake_dir_not_set(tmp_path):
    """When ONELAKE_DIR is empty/missing, ingest_all() logs a warning and returns."""
    original = delta_ingest.ONELAKE_DIR
    try:
        delta_ingest.ONELAKE_DIR = tmp_path / "nonexistent_dir"
        delta_ingest.ingest_all()  # should not raise
    finally:
        delta_ingest.ONELAKE_DIR = original
