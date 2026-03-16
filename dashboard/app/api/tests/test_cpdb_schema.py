"""
Schema completeness tests for control_plane_db.py — Task 10.

Verifies ALL required tables exist after init_db(), including the
three new tables added for execution tracking:
    - notebook_executions
    - import_jobs
    - server_labels

Run with:
    cd dashboard/app/api && python -m pytest tests/test_cpdb_schema.py -v
"""

import sqlite3
import os
import sys
import pytest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import control_plane_db as cpdb


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    """Fresh temporary database for every test."""
    db_path = tmp_path / 'test_schema_check.db'
    original_path = cpdb.DB_PATH

    cpdb.DB_PATH = db_path
    cpdb.init_db()

    yield db_path

    cpdb.DB_PATH = original_path


def _get_tables(db_path) -> set:
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        return {r[0] for r in rows}
    finally:
        conn.close()


def _get_columns(db_path, table: str) -> list[str]:
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return [r[1] for r in rows]  # column name is index 1
    finally:
        conn.close()


def _get_indexes(db_path) -> set:
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
        ).fetchall()
        return {r[0] for r in rows}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSchemaCompleteness:
    """Verify all 21 required tables are created by init_db()."""

    ALL_REQUIRED_TABLES = [
        # integration mirrors (existing)
        'connections',
        'datasources',
        'lakehouses',
        'workspaces',
        'pipelines',
        'lz_entities',
        'bronze_entities',
        'silver_entities',
        # execution mirrors (existing)
        'engine_runs',
        'engine_task_log',
        'pipeline_lz_entity',
        'pipeline_bronze_entity',
        'entity_status',
        'watermarks',
        # logging mirrors (existing)
        'pipeline_audit',
        'copy_activity_audit',
        # system tables (existing)
        'sync_metadata',
        'admin_config',
        # NEW tables (Task 10)
        'notebook_executions',
        'import_jobs',
        'server_labels',
    ]

    def test_all_required_tables_exist(self, tmp_path):
        """All 21 required tables must exist after init_db()."""
        tables = _get_tables(cpdb.DB_PATH)
        missing = [t for t in self.ALL_REQUIRED_TABLES if t not in tables]
        assert missing == [], (
            f"Missing tables after init_db(): {missing}\n"
            f"Tables present: {sorted(tables)}"
        )

    def test_table_count_at_least_21(self, tmp_path):
        """init_db() must create at least 21 tables (18 original + 3 new)."""
        tables = _get_tables(cpdb.DB_PATH)
        # Exclude internal sqlite_ system tables
        user_tables = {t for t in tables if not t.startswith('sqlite_')}
        assert len(user_tables) >= 21, (
            f"Expected at least 21 tables, found {len(user_tables)}: {sorted(user_tables)}"
        )


class TestNotebookExecutionsTable:
    """Verify notebook_executions table has the correct schema."""

    def test_notebook_executions_table_exists(self):
        """notebook_executions table must exist."""
        tables = _get_tables(cpdb.DB_PATH)
        assert 'notebook_executions' in tables, (
            "notebook_executions table not created by init_db()"
        )

    def test_notebook_executions_required_columns(self):
        """notebook_executions must have all required columns."""
        required = [
            'id',
            'NotebookName',
            'PipelineRunGuid',
            'EntityId',
            'EntityLayer',
            'LogType',
            'LogDateTime',
            'LogData',
            'Status',
            'StartedAt',
            'EndedAt',
            'created_at',
        ]
        cols = _get_columns(cpdb.DB_PATH, 'notebook_executions')
        missing = [c for c in required if c not in cols]
        assert missing == [], (
            f"notebook_executions missing columns: {missing}\n"
            f"Columns present: {cols}"
        )

    def test_notebook_executions_accepts_insert(self):
        """notebook_executions accepts a standard insert."""
        conn = sqlite3.connect(str(cpdb.DB_PATH))
        try:
            conn.execute(
                "INSERT INTO notebook_executions "
                "(NotebookName, PipelineRunGuid, EntityId, EntityLayer, "
                "LogType, LogDateTime, LogData, Status) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ('NB_FMD_PROCESSING_LANDINGZONE_MAIN', 'guid-001', 42,
                 'Landing', 'EndExecution', '2026-03-11T10:00:00Z',
                 '{"rows": 5000}', 'Succeeded')
            )
            conn.commit()
            row = conn.execute(
                "SELECT COUNT(*) FROM notebook_executions"
            ).fetchone()
            assert row[0] == 1
        finally:
            conn.close()

    def test_notebook_executions_index_exists(self):
        """idx_nb_exec_run index must exist on notebook_executions."""
        indexes = _get_indexes(cpdb.DB_PATH)
        assert 'idx_nb_exec_run' in indexes, (
            f"Index idx_nb_exec_run not found. Indexes present: {sorted(indexes)}"
        )


class TestImportJobsTable:
    """Verify import_jobs table has the correct schema."""

    def test_import_jobs_table_exists(self):
        """import_jobs table must exist."""
        tables = _get_tables(cpdb.DB_PATH)
        assert 'import_jobs' in tables, (
            "import_jobs table not created by init_db()"
        )

    def test_import_jobs_required_columns(self):
        """import_jobs must have all required columns."""
        required = [
            'job_id',
            'datasource_name',
            'datasource_id',
            'table_count',
            'tables_done',
            'phase',
            'progress',
            'current_table',
            'status',
            'started_at',
            'finished_at',
            'error',
            'created_at',
            'updated_at',
        ]
        cols = _get_columns(cpdb.DB_PATH, 'import_jobs')
        missing = [c for c in required if c not in cols]
        assert missing == [], (
            f"import_jobs missing columns: {missing}\n"
            f"Columns present: {cols}"
        )

    def test_import_jobs_accepts_insert(self):
        """import_jobs accepts a standard insert."""
        conn = sqlite3.connect(str(cpdb.DB_PATH))
        try:
            conn.execute(
                "INSERT INTO import_jobs "
                "(job_id, datasource_name, datasource_id, table_count, "
                "tables_done, phase, progress, status, started_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ('job-abc-123', 'MES', 1, 445, 0,
                 'registering', 5, 'running', '2026-03-11T10:00:00Z')
            )
            conn.commit()
            row = conn.execute(
                "SELECT COUNT(*) FROM import_jobs"
            ).fetchone()
            assert row[0] == 1
        finally:
            conn.close()

    def test_import_jobs_job_id_is_pk(self):
        """import_jobs rejects duplicate job_id (PK constraint)."""
        conn = sqlite3.connect(str(cpdb.DB_PATH))
        try:
            conn.execute(
                "INSERT INTO import_jobs (job_id, datasource_name, table_count, phase, status) "
                "VALUES ('dup-id', 'MES', 10, 'registering', 'running')"
            )
            conn.commit()
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO import_jobs (job_id, datasource_name, table_count, phase, status) "
                    "VALUES ('dup-id', 'ETQ', 5, 'registering', 'running')"
                )
                conn.commit()
        finally:
            conn.close()

    def test_import_jobs_index_exists(self):
        """idx_import_jobs_status index must exist on import_jobs."""
        indexes = _get_indexes(cpdb.DB_PATH)
        assert 'idx_import_jobs_status' in indexes, (
            f"Index idx_import_jobs_status not found. Indexes present: {sorted(indexes)}"
        )


class TestServerLabelsTable:
    """Verify server_labels table has the correct schema."""

    def test_server_labels_table_exists(self):
        """server_labels table must exist."""
        tables = _get_tables(cpdb.DB_PATH)
        assert 'server_labels' in tables, (
            "server_labels table not created by init_db()"
        )

    def test_server_labels_required_columns(self):
        """server_labels must have all required columns."""
        required = [
            'server',
            'label',
            'updated_at',
        ]
        cols = _get_columns(cpdb.DB_PATH, 'server_labels')
        missing = [c for c in required if c not in cols]
        assert missing == [], (
            f"server_labels missing columns: {missing}\n"
            f"Columns present: {cols}"
        )

    def test_server_labels_accepts_insert(self):
        """server_labels accepts a standard insert."""
        conn = sqlite3.connect(str(cpdb.DB_PATH))
        try:
            conn.execute(
                "INSERT INTO server_labels (server, label) VALUES (?, ?)",
                ('m3-db1', 'MES')
            )
            conn.commit()
            row = conn.execute(
                "SELECT label FROM server_labels WHERE server = 'm3-db1'"
            ).fetchone()
            assert row is not None
            assert row[0] == 'MES'
        finally:
            conn.close()

    def test_server_labels_server_is_pk(self):
        """server_labels rejects duplicate server name (PK constraint)."""
        conn = sqlite3.connect(str(cpdb.DB_PATH))
        try:
            conn.execute(
                "INSERT INTO server_labels (server, label) VALUES ('m3-db1', 'MES')"
            )
            conn.commit()
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO server_labels (server, label) VALUES ('m3-db1', 'Duplicate')"
                )
                conn.commit()
        finally:
            conn.close()

    def test_server_labels_upsert_updates_label(self):
        """server_labels supports INSERT OR REPLACE to update a label."""
        conn = sqlite3.connect(str(cpdb.DB_PATH))
        try:
            conn.execute(
                "INSERT OR REPLACE INTO server_labels (server, label) VALUES ('m3-db1', 'OldLabel')"
            )
            conn.execute(
                "INSERT OR REPLACE INTO server_labels (server, label) VALUES ('m3-db1', 'NewLabel')"
            )
            conn.commit()
            row = conn.execute(
                "SELECT label FROM server_labels WHERE server = 'm3-db1'"
            ).fetchone()
            assert row[0] == 'NewLabel'
        finally:
            conn.close()


class TestInitDbIdempotency:
    """Verify that init_db() remains idempotent after adding new tables."""

    def test_init_db_idempotent_with_new_tables(self):
        """Calling init_db() 3 times does not change table count."""
        def count_tables():
            conn = sqlite3.connect(str(cpdb.DB_PATH))
            try:
                row = conn.execute(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
                ).fetchone()
                return row[0]
            finally:
                conn.close()

        count_first = count_tables()
        cpdb.init_db()
        cpdb.init_db()
        count_after = count_tables()

        assert count_after == count_first, (
            f"Table count changed after repeated init_db(): "
            f"{count_first} -> {count_after}"
        )


class TestGetStatsIncludesNewTables:
    """get_stats() must include the 3 new tables."""

    def test_get_stats_has_notebook_executions(self):
        """get_stats() must include notebook_executions count."""
        stats = cpdb.get_stats()
        assert 'notebook_executions' in stats, (
            f"notebook_executions missing from get_stats(). Keys: {list(stats.keys())}"
        )

    def test_get_stats_has_import_jobs(self):
        """get_stats() must include import_jobs count."""
        stats = cpdb.get_stats()
        assert 'import_jobs' in stats, (
            f"import_jobs missing from get_stats(). Keys: {list(stats.keys())}"
        )

    def test_get_stats_has_server_labels(self):
        """get_stats() must include server_labels count."""
        stats = cpdb.get_stats()
        assert 'server_labels' in stats, (
            f"server_labels missing from get_stats(). Keys: {list(stats.keys())}"
        )

    def test_get_stats_total_count(self):
        """get_stats() must report counts for all 21 tables."""
        stats = cpdb.get_stats()
        assert len(stats) == 21, (
            f"Expected 21 table counts in get_stats(), got {len(stats)}: {list(stats.keys())}"
        )


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
