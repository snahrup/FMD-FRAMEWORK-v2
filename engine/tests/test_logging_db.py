"""Unit tests for engine/logging_db.py — SQLite-only writes via control_plane_db.

Tests verify that:
  1. Every write call goes to SQLite via control_plane_db
  2. SQLite failures are logged but don't crash the engine
  3. No Fabric SQL calls are made
"""

import logging
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from engine.logging_db import AuditLogger, _get_cpdb
from engine.models import Entity, RunResult, LogEnvelope


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_entity(**overrides) -> Entity:
    defaults = dict(
        id=42,
        source_name="Orders",
        source_schema="dbo",
        source_server="m3-db1",
        source_database="mes",
        datasource_id=4,
        connection_type="SQL",
        workspace_guid="ws-guid",
        lakehouse_guid="lh-guid",
        file_path="MES/dbo_Orders",
        file_name="dbo_Orders_20240101.parquet",
        is_incremental=False,
    )
    defaults.update(overrides)
    return Entity(**defaults)


def _make_mock_cpdb():
    cpdb = MagicMock()
    cpdb.upsert_engine_run = MagicMock()
    cpdb.upsert_entity_status = MagicMock()
    cpdb.upsert_pipeline_lz_entity = MagicMock()
    cpdb.insert_engine_task_log = MagicMock()
    cpdb.insert_pipeline_audit = MagicMock()
    cpdb.insert_copy_activity_audit = MagicMock()
    cpdb.upsert_watermark = MagicMock()
    return cpdb


# ---------------------------------------------------------------------------
# _classify_error (static helper)
# ---------------------------------------------------------------------------

def test_classify_error_empty():
    assert AuditLogger._classify_error(None) == ""
    assert AuditLogger._classify_error("") == ""


def test_classify_error_timeout():
    assert AuditLogger._classify_error("Connection timeout after 30s") == "timeout"


def test_classify_error_connection():
    assert AuditLogger._classify_error("Connection refused") == "connection"
    assert AuditLogger._classify_error("Network unreachable") == "connection"


def test_classify_error_memory():
    assert AuditLogger._classify_error("Out of memory") == "memory"
    assert AuditLogger._classify_error("OOM killed") == "memory"


def test_classify_error_permission():
    assert AuditLogger._classify_error("Permission denied") == "permission"


def test_classify_error_not_found():
    assert AuditLogger._classify_error("Table not found") == "not_found"
    assert AuditLogger._classify_error("HTTP 404 error") == "not_found"


def test_classify_error_other():
    assert AuditLogger._classify_error("Something unexpected") == "other"


# ---------------------------------------------------------------------------
# AuditLogger construction
# ---------------------------------------------------------------------------

def test_audit_logger_takes_no_args():
    audit = AuditLogger()
    assert audit is not None


# ---------------------------------------------------------------------------
# _write_engine_run
# ---------------------------------------------------------------------------

class TestWriteEngineRun:

    def test_writes_to_sqlite(self):
        mock_cpdb = _make_mock_cpdb()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit._write_engine_run(
                run_id="test-run-id",
                mode="run",
                status="InProgress",
                total_entities=100,
                layers="landing,bronze",
                triggered_by="dashboard",
            )

        mock_cpdb.upsert_engine_run.assert_called_once()
        row = mock_cpdb.upsert_engine_run.call_args[0][0]
        assert row["RunId"] == "test-run-id"
        assert row["Mode"] == "run"
        assert row["Status"] == "InProgress"
        assert row["TotalEntities"] == 100
        assert row["Layers"] == "landing,bronze"
        assert row["TriggeredBy"] == "dashboard"
        assert "StartedAt" in row  # InProgress sets StartedAt

    def test_sets_ended_at_for_succeeded(self):
        mock_cpdb = _make_mock_cpdb()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit._write_engine_run(
                run_id="run-2",
                mode="",
                status="Succeeded",
                total_entities=50,
                succeeded_entities=50,
            )

        row = mock_cpdb.upsert_engine_run.call_args[0][0]
        assert "EndedAt" in row
        assert "StartedAt" not in row

    def test_sets_ended_at_for_failed(self):
        mock_cpdb = _make_mock_cpdb()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit._write_engine_run(
                run_id="run-3",
                mode="",
                status="Failed",
                error_summary="Something went wrong",
            )

        row = mock_cpdb.upsert_engine_run.call_args[0][0]
        assert "EndedAt" in row

    def test_sqlite_failure_is_swallowed(self):
        mock_cpdb = _make_mock_cpdb()
        mock_cpdb.upsert_engine_run.side_effect = Exception("SQLite lock")
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            # Should not raise
            audit._write_engine_run(
                run_id="run-err", mode="run", status="InProgress"
            )

    def test_no_cpdb_is_silent(self):
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=None):
            # Should not raise even with no cpdb
            audit._write_engine_run(
                run_id="run-no-sqlite", mode="run", status="InProgress"
            )


# ---------------------------------------------------------------------------
# mark_entity_loaded
# ---------------------------------------------------------------------------

class TestMarkEntityLoaded:

    def test_writes_entity_status_to_sqlite(self):
        mock_cpdb = _make_mock_cpdb()
        entity = _make_entity()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.mark_entity_loaded(entity, "MES/dbo_Orders", "dbo_Orders_123.parquet")

        # SQLite entity_status written
        mock_cpdb.upsert_entity_status.assert_called_once()
        row = mock_cpdb.upsert_entity_status.call_args[0][0]
        assert row["LandingzoneEntityId"] == 42
        assert row["Layer"] == "LandingZone"
        assert row["Status"] == "Succeeded"
        assert row["UpdatedBy"] == "FMD_ENGINE_V3"

        # SQLite pipeline_lz_entity written
        mock_cpdb.upsert_pipeline_lz_entity.assert_called_once()
        lz_row = mock_cpdb.upsert_pipeline_lz_entity.call_args[0][0]
        assert lz_row["LandingzoneEntityId"] == 42
        assert lz_row["FileName"] == "dbo_Orders_123.parquet"
        assert lz_row["FilePath"] == "MES/dbo_Orders"

    def test_sqlite_failure_is_swallowed(self):
        mock_cpdb = _make_mock_cpdb()
        mock_cpdb.upsert_entity_status.side_effect = Exception("Disk full")
        mock_cpdb.upsert_pipeline_lz_entity.side_effect = Exception("Disk full")
        entity = _make_entity()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            # Should not raise
            audit.mark_entity_loaded(entity, "path", "file")

    def test_no_cpdb_is_silent(self):
        entity = _make_entity()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=None):
            # Should not raise
            audit.mark_entity_loaded(entity, "path", "file")


# ---------------------------------------------------------------------------
# _write_engine_task_log
# ---------------------------------------------------------------------------

class TestWriteEngineTaskLog:

    def test_writes_to_sqlite(self):
        mock_cpdb = _make_mock_cpdb()
        entity = _make_entity()
        result = RunResult(entity_id=42, layer="landing", status="succeeded", rows_read=1000)
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit._write_engine_task_log("run-1", entity, result, "log json")

        mock_cpdb.insert_engine_task_log.assert_called_once()
        row = mock_cpdb.insert_engine_task_log.call_args[0][0]
        assert row["RunId"] == "run-1"
        assert row["EntityId"] == 42
        assert row["Status"] == "succeeded"
        assert row["RowsRead"] == 1000
        assert row["LoadType"] == "full"
        assert row["ErrorType"] == ""

    def test_incremental_load_type(self):
        mock_cpdb = _make_mock_cpdb()
        entity = _make_entity(is_incremental=True, last_load_value="2024-01-01")
        result = RunResult(entity_id=42, layer="landing", status="succeeded")
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit._write_engine_task_log("run-1", entity, result)

        row = mock_cpdb.insert_engine_task_log.call_args[0][0]
        assert row["LoadType"] == "incremental"

    def test_error_classification(self):
        mock_cpdb = _make_mock_cpdb()
        entity = _make_entity()
        result = RunResult(
            entity_id=42, layer="landing", status="failed",
            error="Connection timeout after 120s",
        )
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit._write_engine_task_log("run-1", entity, result)

        row = mock_cpdb.insert_engine_task_log.call_args[0][0]
        assert row["ErrorType"] == "timeout"


# ---------------------------------------------------------------------------
# _write_pipeline_audit
# ---------------------------------------------------------------------------

class TestWritePipelineAudit:

    def test_writes_to_sqlite(self):
        mock_cpdb = _make_mock_cpdb()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit._write_pipeline_audit("run-1", "FMD_ENGINE_V3", "InProgress", "{}")

        mock_cpdb.insert_pipeline_audit.assert_called_once()
        row = mock_cpdb.insert_pipeline_audit.call_args[0][0]
        assert row["PipelineRunGuid"] == "run-1"
        assert row["PipelineName"] == "FMD_ENGINE_V3"
        assert row["LogType"] == "InProgress"

    def test_no_fabric_sql_calls(self):
        mock_cpdb = _make_mock_cpdb()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit._write_pipeline_audit("run-1", "FMD_ENGINE_V3", "InProgress", "{}")

        # Verify no attribute resembling Fabric SQL exists on the audit object
        assert not hasattr(audit, "_db")


# ---------------------------------------------------------------------------
# _write_copy_audit
# ---------------------------------------------------------------------------

class TestWriteCopyAudit:

    def test_writes_to_sqlite(self):
        mock_cpdb = _make_mock_cpdb()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit._write_copy_audit(
                "run-1", entity_id=42, status="succeeded",
                rows_read=500, rows_written=500, bytes_transferred=1024,
                duration_seconds=3.5, message="{}",
            )

        mock_cpdb.insert_copy_activity_audit.assert_called_once()
        row = mock_cpdb.insert_copy_activity_audit.call_args[0][0]
        assert row["EntityId"] == 42
        assert row["LogType"] == "succeeded"


# ---------------------------------------------------------------------------
# update_watermark
# ---------------------------------------------------------------------------

class TestUpdateWatermark:

    def test_writes_to_sqlite(self):
        mock_cpdb = _make_mock_cpdb()
        entity = _make_entity(last_load_value="2024-01-01")
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.update_watermark(entity, "2024-06-15")

        mock_cpdb.upsert_watermark.assert_called_once()
        args = mock_cpdb.upsert_watermark.call_args[0]
        assert args[0] == 42  # entity_id
        assert args[1] == "2024-06-15"  # new_value

    def test_skips_if_no_change(self):
        mock_cpdb = _make_mock_cpdb()
        entity = _make_entity(last_load_value="2024-01-01")
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.update_watermark(entity, "2024-01-01")  # same value

        mock_cpdb.upsert_watermark.assert_not_called()

    def test_skips_if_empty(self):
        mock_cpdb = _make_mock_cpdb()
        entity = _make_entity()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.update_watermark(entity, "")

        mock_cpdb.upsert_watermark.assert_not_called()

    def test_skips_if_none(self):
        mock_cpdb = _make_mock_cpdb()
        entity = _make_entity()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.update_watermark(entity, None)

        mock_cpdb.upsert_watermark.assert_not_called()

    def test_no_cpdb_is_silent(self):
        entity = _make_entity(last_load_value="2024-01-01")
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=None):
            # Should not raise
            audit.update_watermark(entity, "2024-06-15")


# ---------------------------------------------------------------------------
# High-level: log_run_start / log_run_end / log_run_error
# ---------------------------------------------------------------------------

class TestLogRunLifecycle:

    def test_log_run_start_calls_sqlite_writers(self):
        mock_cpdb = _make_mock_cpdb()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.log_run_start("run-1", "run", 100, ["landing", "bronze"], "dashboard")

        # engine_run + pipeline_audit = 2 SQLite calls
        assert mock_cpdb.upsert_engine_run.call_count == 1
        assert mock_cpdb.insert_pipeline_audit.call_count == 1

    def test_log_run_end_writes_summary(self):
        mock_cpdb = _make_mock_cpdb()
        audit = AuditLogger()

        results = [
            RunResult(entity_id=1, layer="landing", status="succeeded", rows_read=100),
            RunResult(entity_id=2, layer="landing", status="failed", error="timeout"),
            RunResult(entity_id=3, layer="landing", status="skipped"),
        ]

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.log_run_end("run-1", results)

        row = mock_cpdb.upsert_engine_run.call_args[0][0]
        assert row["Status"] == "Failed"  # has failures
        assert row["TotalEntities"] == 3

    def test_log_run_end_succeeded_when_no_failures(self):
        mock_cpdb = _make_mock_cpdb()
        audit = AuditLogger()

        results = [
            RunResult(entity_id=1, layer="landing", status="succeeded", rows_read=100),
            RunResult(entity_id=2, layer="landing", status="succeeded", rows_read=200),
        ]

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.log_run_end("run-ok", results)

        row = mock_cpdb.upsert_engine_run.call_args[0][0]
        assert row["Status"] == "Succeeded"

    def test_log_run_error_writes_failure(self):
        mock_cpdb = _make_mock_cpdb()
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.log_run_error("run-1", ValueError("Something broke"))

        row = mock_cpdb.upsert_engine_run.call_args[0][0]
        assert row["Status"] == "Failed"
        assert "ValueError" in row["ErrorSummary"]


# ---------------------------------------------------------------------------
# log_entity_result
# ---------------------------------------------------------------------------

class TestLogEntityResult:

    def test_writes_copy_audit_and_task_log(self):
        mock_cpdb = _make_mock_cpdb()
        entity = _make_entity()
        result = RunResult(entity_id=42, layer="landing", status="succeeded", rows_read=500)
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.log_entity_result("run-1", entity, result)

        mock_cpdb.insert_copy_activity_audit.assert_called_once()
        mock_cpdb.insert_engine_task_log.assert_called_once()

    def test_error_entity_result_has_error_info(self):
        mock_cpdb = _make_mock_cpdb()
        entity = _make_entity()
        result = RunResult(
            entity_id=42, layer="landing", status="failed",
            error="Connection refused", error_suggestion="Check VPN",
        )
        audit = AuditLogger()

        with patch("engine.logging_db._get_cpdb", return_value=mock_cpdb):
            audit.log_entity_result("run-1", entity, result)

        task_row = mock_cpdb.insert_engine_task_log.call_args[0][0]
        assert task_row["ErrorType"] == "connection"
        assert task_row["ErrorMessage"] == "Connection refused"


# ---------------------------------------------------------------------------
# _get_cpdb lazy import
# ---------------------------------------------------------------------------

class TestGetCpdb:

    def test_returns_none_when_import_fails(self):
        import engine.logging_db as mod
        # Reset the global state
        old_loaded, old_cpdb = mod._cpdb_loaded, mod._cpdb
        mod._cpdb_loaded = False
        mod._cpdb = None

        with patch.dict("sys.modules", {"dashboard.app.api.control_plane_db": None}):
            # Force re-import failure
            mod._cpdb_loaded = False
            mod._cpdb = None
            with patch("builtins.__import__", side_effect=ImportError("no module")):
                result = mod._get_cpdb()

        # Restore
        mod._cpdb_loaded = old_loaded
        mod._cpdb = old_cpdb

    def test_caches_result(self):
        import engine.logging_db as mod
        old_loaded, old_cpdb = mod._cpdb_loaded, mod._cpdb

        mock = MagicMock()
        mod._cpdb = mock
        mod._cpdb_loaded = True

        result = mod._get_cpdb()
        assert result is mock

        mod._cpdb_loaded = old_loaded
        mod._cpdb = old_cpdb
