"""Unit tests for engine/logging_db.py — no network, no VPN, no database required.

Tests the AuditLogger dual-write pattern:
  - Local SQLite (primary) + Fabric SQL (secondary/best-effort)
  - All 6 write methods
  - Error handling: local failure logged but not fatal, Fabric failure swallowed
  - mark_entity_loaded and update_watermark flows
"""

from datetime import datetime
from unittest.mock import MagicMock, patch, call
import pytest

from engine.logging_db import AuditLogger
from engine.models import Entity, RunResult


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
    )
    defaults.update(overrides)
    return Entity(**defaults)


def _make_result(**overrides) -> RunResult:
    defaults = dict(
        entity_id=42, layer="landing", status="succeeded",
        rows_read=100, rows_written=100, bytes_transferred=4096,
        duration_seconds=1.5,
    )
    defaults.update(overrides)
    return RunResult(**defaults)


def _make_logger(local_db=None):
    """Create an AuditLogger with a mock MetadataDB and optional local_db."""
    mock_db = MagicMock()
    return AuditLogger(mock_db, local_db=local_db), mock_db


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------

class TestAuditLoggerInit:
    def test_creates_with_no_local_db(self):
        audit, _ = _make_logger(local_db=None)
        assert audit._local is None

    def test_creates_with_local_db(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)
        assert audit._local is local


# ---------------------------------------------------------------------------
# log_run_start
# ---------------------------------------------------------------------------

class TestLogRunStart:
    def test_writes_to_fabric_sql(self):
        audit, db = _make_logger()
        audit.log_run_start("run-1", "run", 10, ["landing"], "dashboard")
        assert db.execute_proc.call_count == 2  # sp_AuditPipeline + sp_UpsertEngineRun

    def test_writes_to_local_sqlite(self):
        local = MagicMock()
        audit, db = _make_logger(local_db=local)
        audit.log_run_start("run-1", "run", 10, ["landing", "bronze"], "dashboard")
        local.insert_pipeline_audit.assert_called_once()
        local.upsert_engine_run.assert_called_once()
        run_data = local.upsert_engine_run.call_args[0][0]
        assert run_data["RunId"] == "run-1"
        assert run_data["Status"] == "InProgress"
        assert run_data["TotalEntities"] == 10

    def test_layers_default_to_all(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)
        audit.log_run_start("run-1", "run", 5, None, "schedule")
        audit_call = local.insert_pipeline_audit.call_args[0][0]
        assert audit_call["EntityLayer"] == "all"

    def test_local_failure_does_not_crash(self):
        local = MagicMock()
        local.insert_pipeline_audit.side_effect = RuntimeError("disk full")
        audit, _ = _make_logger(local_db=local)
        # Should not raise
        audit.log_run_start("run-1", "run", 5, None, "test")

    def test_fabric_failure_does_not_crash(self):
        audit, db = _make_logger()
        db.execute_proc.side_effect = RuntimeError("network error")
        # Should not raise
        audit.log_run_start("run-1", "run", 5, None, "test")


# ---------------------------------------------------------------------------
# log_run_end
# ---------------------------------------------------------------------------

class TestLogRunEnd:
    def test_computes_correct_summary(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)
        results = [
            _make_result(status="succeeded", rows_read=100, bytes_transferred=1000, duration_seconds=1.0),
            _make_result(status="succeeded", rows_read=200, bytes_transferred=2000, duration_seconds=2.0),
            _make_result(status="failed", rows_read=0, bytes_transferred=0, duration_seconds=0.5),
            _make_result(status="skipped", rows_read=0, bytes_transferred=0, duration_seconds=0.0),
        ]
        audit.log_run_end("run-1", results)

        run_data = local.upsert_engine_run.call_args[0][0]
        assert run_data["Status"] == "Failed"  # has failures
        assert run_data["TotalEntities"] == 4

    def test_all_succeeded_status(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)
        results = [
            _make_result(status="succeeded"),
            _make_result(status="succeeded"),
        ]
        audit.log_run_end("run-1", results)

        run_data = local.upsert_engine_run.call_args[0][0]
        assert run_data["Status"] == "Succeeded"


# ---------------------------------------------------------------------------
# log_run_error
# ---------------------------------------------------------------------------

class TestLogRunError:
    def test_writes_error_to_both_targets(self):
        local = MagicMock()
        audit, db = _make_logger(local_db=local)
        err = ValueError("something broke")
        audit.log_run_error("run-1", err)

        local.insert_pipeline_audit.assert_called_once()
        audit_data = local.insert_pipeline_audit.call_args[0][0]
        assert audit_data["LogType"] == "Failed"

        local.upsert_engine_run.assert_called_once()
        run_data = local.upsert_engine_run.call_args[0][0]
        assert run_data["Status"] == "Failed"
        assert "ValueError" in run_data["ErrorSummary"]


# ---------------------------------------------------------------------------
# log_entity_result
# ---------------------------------------------------------------------------

class TestLogEntityResult:
    def test_writes_copy_audit_and_task_log(self):
        local = MagicMock()
        audit, db = _make_logger(local_db=local)
        entity = _make_entity()
        result = _make_result()

        audit.log_entity_result("run-1", entity, result)

        local.insert_copy_activity_audit.assert_called_once()
        local.insert_engine_task_log.assert_called_once()
        db.execute_proc.call_count >= 2

    def test_classifies_error_types(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)
        entity = _make_entity()

        test_cases = [
            ("Connection timed out", "connection"),
            ("Connection refused by server", "connection"),
            ("Network unreachable", "connection"),
            ("Out of memory exception", "memory"),
            ("OOM killed", "memory"),
            ("Permission denied", "permission"),
            ("Access denied to resource", "permission"),
            ("Table not found", "not_found"),
            ("HTTP 404 error", "not_found"),
            ("Something else entirely", "other"),
        ]

        for error_msg, expected_type in test_cases:
            local.reset_mock()
            result = _make_result(status="failed", error=error_msg)
            audit.log_entity_result("run-1", entity, result)
            task_log = local.insert_engine_task_log.call_args[0][0]
            assert task_log["ErrorType"] == expected_type, f"Expected '{expected_type}' for '{error_msg}', got '{task_log['ErrorType']}'"

    def test_no_error_gives_empty_error_type(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)
        entity = _make_entity()
        result = _make_result(status="succeeded", error=None)

        audit.log_entity_result("run-1", entity, result)
        task_log = local.insert_engine_task_log.call_args[0][0]
        assert task_log["ErrorType"] == ""

    def test_load_type_classification(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)

        # Full load entity
        entity_full = _make_entity(is_incremental=False)
        audit.log_entity_result("run-1", entity_full, _make_result())
        task_log = local.insert_engine_task_log.call_args[0][0]
        assert task_log["LoadType"] == "full"

        # Incremental entity with watermark
        local.reset_mock()
        entity_incr = _make_entity(
            is_incremental=True, watermark_column="ModifiedDate",
            last_load_value="2024-01-01",
        )
        audit.log_entity_result("run-1", entity_incr, _make_result())
        task_log = local.insert_engine_task_log.call_args[0][0]
        assert task_log["LoadType"] == "incremental"

        # Incremental entity without watermark value → full
        local.reset_mock()
        entity_incr_no_val = _make_entity(
            is_incremental=True, watermark_column="ModifiedDate",
            last_load_value=None,
        )
        audit.log_entity_result("run-1", entity_incr_no_val, _make_result())
        task_log = local.insert_engine_task_log.call_args[0][0]
        assert task_log["LoadType"] == "full"


# ---------------------------------------------------------------------------
# mark_entity_loaded
# ---------------------------------------------------------------------------

class TestMarkEntityLoaded:
    def test_writes_to_both_targets(self):
        local = MagicMock()
        audit, db = _make_logger(local_db=local)
        entity = _make_entity()

        audit.mark_entity_loaded(entity, "MES", "Orders.parquet")

        local.upsert_pipeline_lz_entity.assert_called_once()
        local.upsert_entity_status.assert_called_once()
        assert db.execute_proc.call_count == 2

    def test_local_writes_correct_data(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)
        entity = _make_entity(id=99)

        audit.mark_entity_loaded(entity, "ETQ", "Invoices.parquet")

        lz_data = local.upsert_pipeline_lz_entity.call_args[0][0]
        assert lz_data["LandingzoneEntityId"] == 99
        assert lz_data["FileName"] == "Invoices.parquet"
        assert lz_data["FilePath"] == "ETQ"
        assert lz_data["IsProcessed"] == 0

        status_data = local.upsert_entity_status.call_args[0][0]
        assert status_data["LandingzoneEntityId"] == 99
        assert status_data["Layer"] == "LandingZone"
        assert status_data["Status"] == "Succeeded"

    def test_local_failure_does_not_block_fabric(self):
        local = MagicMock()
        local.upsert_pipeline_lz_entity.side_effect = RuntimeError("sqlite locked")
        audit, db = _make_logger(local_db=local)
        entity = _make_entity()

        audit.mark_entity_loaded(entity, "MES", "Orders.parquet")
        # Fabric SQL should still be called
        assert db.execute_proc.call_count == 2

    def test_no_local_db_only_writes_fabric(self):
        audit, db = _make_logger(local_db=None)
        entity = _make_entity()
        audit.mark_entity_loaded(entity, "MES", "Orders.parquet")
        assert db.execute_proc.call_count == 2


# ---------------------------------------------------------------------------
# update_watermark
# ---------------------------------------------------------------------------

class TestUpdateWatermark:
    def test_writes_to_both_targets(self):
        local = MagicMock()
        audit, db = _make_logger(local_db=local)
        entity = _make_entity(last_load_value="2024-01-01")

        audit.update_watermark(entity, "2024-06-01")

        local.upsert_watermark.assert_called_once_with(42, "2024-06-01")
        db.execute.assert_called_once()

    def test_skips_when_value_unchanged(self):
        local = MagicMock()
        audit, db = _make_logger(local_db=local)
        entity = _make_entity(last_load_value="2024-01-01")

        audit.update_watermark(entity, "2024-01-01")

        local.upsert_watermark.assert_not_called()
        db.execute.assert_not_called()

    def test_skips_when_value_is_none(self):
        local = MagicMock()
        audit, db = _make_logger(local_db=local)
        entity = _make_entity(last_load_value="2024-01-01")

        audit.update_watermark(entity, None)

        local.upsert_watermark.assert_not_called()
        db.execute.assert_not_called()

    def test_skips_when_value_is_empty(self):
        local = MagicMock()
        audit, db = _make_logger(local_db=local)
        entity = _make_entity(last_load_value="2024-01-01")

        audit.update_watermark(entity, "")

        local.upsert_watermark.assert_not_called()
        db.execute.assert_not_called()

    def test_local_failure_does_not_block_fabric(self):
        local = MagicMock()
        local.upsert_watermark.side_effect = RuntimeError("oops")
        audit, db = _make_logger(local_db=local)
        entity = _make_entity(last_load_value="2024-01-01")

        audit.update_watermark(entity, "2024-06-01")

        # Fabric SQL should still be called
        db.execute.assert_called_once()


# ---------------------------------------------------------------------------
# _write_pipeline_audit
# ---------------------------------------------------------------------------

class TestWritePipelineAudit:
    def test_truncates_message_to_8000(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)
        # Trigger via log_run_start which calls _write_pipeline_audit
        audit.log_run_start("run-1", "run", 1, None, "test")
        audit_data = local.insert_pipeline_audit.call_args[0][0]
        assert len(audit_data["LogData"]) <= 8000


# ---------------------------------------------------------------------------
# _write_engine_run — StartedAt / EndedAt logic
# ---------------------------------------------------------------------------

class TestWriteEngineRun:
    def test_in_progress_sets_started_at(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)
        audit.log_run_start("run-1", "run", 1, None, "test")
        run_data = local.upsert_engine_run.call_args[0][0]
        assert run_data["StartedAt"] is not None
        assert run_data["EndedAt"] is None

    def test_completed_sets_ended_at(self):
        local = MagicMock()
        audit, _ = _make_logger(local_db=local)
        audit.log_run_end("run-1", [_make_result()])
        run_data = local.upsert_engine_run.call_args[0][0]
        assert run_data["EndedAt"] is not None
