"""
FMD v3 Engine — Structured JSON logging to SQL audit tables.

Every operation produces a LogEnvelope that gets:
  1. Written to the Python logger (for local troubleshooting)
  2. Persisted to SQL via stored procedures (for the dashboard)

SQL procs used:
  Run-level:
    - execution.sp_UpsertEngineRun        — engine-specific run tracking
    - logging.sp_AuditPipeline            — generic pipeline audit (backward compat)

  Entity-level:
    - execution.sp_InsertEngineTaskLog    — engine-specific task log (rich detail)
    - logging.sp_AuditCopyActivity        — generic copy audit (backward compat)
    - execution.sp_UpsertPipelineLandingzoneEntity — mark entity as loaded
    - execution.sp_UpsertEntityStatus     — update entity digest for dashboard
"""

import logging
import traceback
from datetime import datetime
from typing import Optional, List

from engine.connections import MetadataDB
from engine.models import Entity, RunResult, LogEnvelope

log = logging.getLogger("fmd.logging_db")

# ---------------------------------------------------------------------------
# Local SQLite dual-write support
# ---------------------------------------------------------------------------
# Import control_plane_db lazily to avoid circular imports and allow the
# engine to run even if the dashboard package isn't available.
_cpdb = None
_cpdb_loaded = False


def _get_cpdb():
    """Lazily import control_plane_db. Returns the module or None."""
    global _cpdb, _cpdb_loaded
    if _cpdb_loaded:
        return _cpdb
    try:
        from dashboard.app.api import control_plane_db
        _cpdb = control_plane_db
    except Exception as exc:
        log.debug("control_plane_db not available (SQLite dual-write disabled): %s", exc)
        _cpdb = None
    _cpdb_loaded = True
    return _cpdb


class AuditLogger:
    """Writes structured audit records to both Python logger and SQL.

    Usage::

        audit = AuditLogger(metadata_db)
        audit.log_run_start(run_id, mode, entity_count, layers, triggered_by)
        audit.log_entity_result(run_id, entity, result)
        audit.log_run_end(run_id, results)
    """

    def __init__(self, db: MetadataDB, local_db=None):
        self._db = db
        self._local_db = local_db

    # ------------------------------------------------------------------
    # Run-level logging
    # ------------------------------------------------------------------

    def log_run_start(
        self,
        run_id: str,
        mode: str,
        entity_count: int,
        layers: Optional[List[str]],
        triggered_by: str,
    ) -> None:
        """Record the start of an engine run in the audit table."""
        layer_str = ",".join(layers) if layers else "landing,bronze,silver"
        envelope = LogEnvelope(
            v=1,
            run_id=run_id,
            entity_id=0,
            layer=layer_str,
            action="run_start",
            metrics={
                "entity_count": entity_count,
                "mode": mode,
                "triggered_by": triggered_by,
            },
            timestamps={
                "started": datetime.utcnow().isoformat() + "Z",
                "ended": None,
            },
        )
        log.info(
            "Run %s started: mode=%s, entities=%d, layers=%s, triggered_by=%s",
            run_id[:8], mode, entity_count, layer_str, triggered_by,
        )

        self._write_pipeline_audit(
            run_id=run_id,
            pipeline_name="FMD_ENGINE_V3",
            status="InProgress",
            message=envelope.to_json(),
        )
        self._write_engine_run(
            run_id=run_id,
            mode=mode,
            status="InProgress",
            total_entities=entity_count,
            layers=layer_str,
            triggered_by=triggered_by,
        )

    def log_run_end(self, run_id: str, results: List[RunResult]) -> None:
        """Record the end of an engine run."""
        succeeded = sum(1 for r in results if r.status == "succeeded")
        failed = sum(1 for r in results if r.status == "failed")
        skipped = sum(1 for r in results if r.status == "skipped")
        total_rows = sum(r.rows_read for r in results)
        total_bytes = sum(r.bytes_transferred for r in results)
        total_duration = sum(r.duration_seconds for r in results)

        envelope = LogEnvelope(
            v=1,
            run_id=run_id,
            entity_id=0,
            layer="all",
            action="run_end",
            metrics={
                "succeeded": succeeded,
                "failed": failed,
                "skipped": skipped,
                "total_rows": total_rows,
                "total_bytes": total_bytes,
                "total_duration_seconds": round(total_duration, 2),
            },
            timestamps={
                "started": None,
                "ended": datetime.utcnow().isoformat() + "Z",
            },
        )

        status = "Succeeded" if failed == 0 else "Failed"
        log.info(
            "Run %s ended: %s (succeeded=%d, failed=%d, skipped=%d, rows=%d, %.1fs)",
            run_id[:8], status, succeeded, failed, skipped, total_rows, total_duration,
        )

        self._write_pipeline_audit(
            run_id=run_id,
            pipeline_name="FMD_ENGINE_V3",
            status=status,
            message=envelope.to_json(),
        )
        self._write_engine_run(
            run_id=run_id,
            mode="",
            status=status,
            total_entities=len(results),
            succeeded_entities=succeeded,
            failed_entities=failed,
            skipped_entities=skipped,
            total_rows_read=total_rows,
            total_rows_written=sum(r.rows_written for r in results),
            total_bytes=total_bytes,
            total_duration=round(total_duration, 2),
            error_summary=None,
        )

    def log_run_error(self, run_id: str, error: Exception) -> None:
        """Record a fatal run error."""
        tb = traceback.format_exception(type(error), error, error.__traceback__)
        envelope = LogEnvelope(
            v=1,
            run_id=run_id,
            entity_id=0,
            layer="all",
            action="run_error",
            error={
                "type": type(error).__name__,
                "message": str(error),
                "traceback": "".join(tb),
            },
            timestamps={
                "started": None,
                "ended": datetime.utcnow().isoformat() + "Z",
            },
        )
        log.error("Run %s fatal error: %s", run_id[:8], error, exc_info=True)

        self._write_pipeline_audit(
            run_id=run_id,
            pipeline_name="FMD_ENGINE_V3",
            status="Failed",
            message=envelope.to_json(),
        )
        self._write_engine_run(
            run_id=run_id,
            mode="",
            status="Failed",
            error_summary=f"{type(error).__name__}: {str(error)[:500]}",
        )

    # ------------------------------------------------------------------
    # Entity-level logging
    # ------------------------------------------------------------------

    def log_entity_result(
        self,
        run_id: str,
        entity: Entity,
        result: RunResult,
    ) -> None:
        """Record the result of a single entity extraction + upload."""
        envelope = LogEnvelope.for_entity(run_id, entity, result.layer, "copy")
        envelope.metrics = {
            "rows_read": result.rows_read,
            "rows_written": result.rows_written,
            "bytes_transferred": result.bytes_transferred,
            "duration_seconds": result.duration_seconds,
        }
        envelope.timestamps["ended"] = datetime.utcnow().isoformat() + "Z"

        if result.error:
            envelope.error = {
                "message": result.error,
                "suggestion": result.error_suggestion,
            }

        envelope.watermark["after"] = result.watermark_after

        log.info(
            "[%s] Entity %d %s: %s (%d rows, %.1fs)",
            run_id[:8], entity.id, result.layer, result.status,
            result.rows_read, result.duration_seconds,
        )

        self._write_copy_audit(
            run_id=run_id,
            entity_id=entity.id,
            status=result.status,
            rows_read=result.rows_read,
            rows_written=result.rows_written,
            bytes_transferred=result.bytes_transferred,
            duration_seconds=result.duration_seconds,
            message=envelope.to_json(),
        )
        self._write_engine_task_log(
            run_id=run_id,
            entity=entity,
            result=result,
            log_data=envelope.to_json(),
        )

    def mark_entity_loaded(
        self,
        entity: Entity,
        file_path: str,
        file_name: str,
    ) -> None:
        """Mark an entity as loaded in the execution tracking tables.

        Dual-write: SQLite (primary) then Fabric SQL (secondary/best-effort).

        Calls:
          - execution.sp_UpsertPipelineLandingzoneEntity (marks as loaded, IsProcessed=False)
          - execution.sp_UpsertEntityStatus (updates digest for dashboard)
        """
        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        # --- SQLite (PRIMARY) ---
        cpdb = _get_cpdb()
        if cpdb:
            try:
                cpdb.upsert_pipeline_lz_entity({
                    "LandingzoneEntityId": entity.id,
                    "FileName": file_name,
                    "FilePath": file_path,
                    "InsertDateTime": now_str,
                    "IsProcessed": 0,
                })
            except Exception as exc:
                log.warning(
                    "SQLite: Failed to upsert pipeline_lz_entity for entity %d: %s",
                    entity.id, exc,
                )

            try:
                cpdb.upsert_entity_status({
                    "LandingzoneEntityId": entity.id,
                    "Layer": "LandingZone",
                    "Status": "Succeeded",
                    "LoadEndDateTime": now_str,
                    "ErrorMessage": "",
                    "UpdatedBy": "FMD_ENGINE_V3",
                })
            except Exception as exc:
                log.warning(
                    "SQLite: Failed to upsert entity_status for entity %d: %s",
                    entity.id, exc,
                )

        # --- Fabric SQL (SECONDARY — best-effort) ---
        try:
            self._db.execute_proc(
                "[execution].[sp_UpsertPipelineLandingzoneEntity]",
                {
                    "LandingzoneEntityId": entity.id,
                    "Filename": file_name,
                    "FilePath": file_path,
                    "IsProcessed": 0,
                },
            )
        except Exception as exc:
            log.warning(
                "Fabric SQL: Failed to mark entity %d as loaded (sp_UpsertPipelineLandingzoneEntity): %s",
                entity.id, exc,
            )

        try:
            self._db.execute_proc(
                "[execution].[sp_UpsertEntityStatus]",
                {
                    "LandingzoneEntityId": entity.id,
                    "Layer": "LandingZone",
                    "Status": "Succeeded",
                    "LoadEndDateTime": datetime.utcnow(),
                    "ErrorMessage": "",
                    "UpdatedBy": "FMD_ENGINE_V3",
                },
            )
        except Exception as exc:
            log.warning(
                "Fabric SQL: Failed to update entity digest for entity %d: %s",
                entity.id, exc,
            )

    def update_watermark(
        self,
        entity: Entity,
        new_value: str,
    ) -> None:
        """Update the watermark tracking table for incremental loads.

        Dual-write: SQLite (primary) then Fabric SQL (secondary).
        Writes to execution.LandingzoneEntityLastLoadValue.
        """
        if not new_value or new_value == entity.last_load_value:
            return

        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        # --- SQLite (PRIMARY) ---
        cpdb = _get_cpdb()
        if cpdb:
            try:
                cpdb.upsert_watermark(entity.id, new_value, now_str)
            except Exception as exc:
                log.warning(
                    "SQLite: Failed to update watermark for entity %d: %s", entity.id, exc,
                )

        # --- Fabric SQL (SECONDARY — best-effort) ---
        try:
            sql = """
                MERGE [execution].[LandingzoneEntityLastLoadValue] AS target
                USING (SELECT ? AS LandingzoneEntityId, ? AS LoadValue) AS source
                ON target.LandingzoneEntityId = source.LandingzoneEntityId
                WHEN MATCHED THEN
                    UPDATE SET LoadValue = source.LoadValue, LastLoadDatetime = GETUTCDATE()
                WHEN NOT MATCHED THEN
                    INSERT (LandingzoneEntityId, LoadValue, LastLoadDatetime)
                    VALUES (source.LandingzoneEntityId, source.LoadValue, GETUTCDATE());
            """
            self._db.execute(sql, (entity.id, new_value))
            log.debug(
                "Watermark updated for entity %d: %s -> %s",
                entity.id, entity.last_load_value, new_value,
            )
        except Exception as exc:
            log.warning(
                "Fabric SQL: Failed to update watermark for entity %d: %s", entity.id, exc,
            )

    # ------------------------------------------------------------------
    # SQL writers
    # ------------------------------------------------------------------

    def _write_pipeline_audit(
        self,
        run_id: str,
        pipeline_name: str,
        status: str,
        message: str,
    ) -> None:
        """Dual-write to SQLite (primary) + logging.sp_AuditPipeline (secondary)."""
        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        # --- SQLite (PRIMARY) ---
        cpdb = _get_cpdb()
        if cpdb:
            try:
                cpdb.insert_pipeline_audit({
                    "PipelineRunGuid": run_id,
                    "PipelineName": pipeline_name,
                    "EntityLayer": "all",
                    "TriggerType": "Engine",
                    "LogType": status,
                    "LogDateTime": now_str,
                    "LogData": message[:8000],
                    "EntityId": 0,
                })
            except Exception as exc:
                log.warning("SQLite: Failed to write pipeline audit: %s", exc)

        # --- Fabric SQL (SECONDARY — best-effort) ---
        try:
            self._db.execute_proc(
                "[logging].[sp_AuditPipeline]",
                {
                    "PipelineGuid": "00000000-0000-0000-0000-000000000000",
                    "PipelineName": pipeline_name,
                    "PipelineRunGuid": run_id,
                    "PipelineParentRunGuid": run_id,
                    "PipelineParameters": "",
                    "TriggerType": "Engine",
                    "TriggerGuid": "00000000-0000-0000-0000-000000000000",
                    "TriggerTime": datetime.utcnow(),
                    "LogData": message[:8000],
                    "LogType": status,
                    "WorkspaceGuid": "00000000-0000-0000-0000-000000000000",
                    "EntityId": 0,
                    "EntityLayer": "all",
                },
            )
        except Exception as exc:
            log.warning("Fabric SQL: Failed to write pipeline audit: %s", exc)

    def _write_copy_audit(
        self,
        run_id: str,
        entity_id: int,
        status: str,
        rows_read: int,
        rows_written: int,
        bytes_transferred: int,
        duration_seconds: float,
        message: str,
    ) -> None:
        """Dual-write to SQLite (primary) + logging.sp_AuditCopyActivity (secondary)."""
        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        params_str = f"rows={rows_read},bytes={bytes_transferred},dur={duration_seconds}s"

        # --- SQLite (PRIMARY) ---
        cpdb = _get_cpdb()
        if cpdb:
            try:
                cpdb.insert_copy_activity_audit({
                    "PipelineRunGuid": run_id,
                    "CopyActivityName": f"Engine_Entity_{entity_id}",
                    "EntityLayer": "LandingZone",
                    "TriggerType": "Engine",
                    "LogType": status,
                    "LogDateTime": now_str,
                    "LogData": message[:8000],
                    "EntityId": entity_id,
                    "CopyActivityParameters": params_str,
                })
            except Exception as exc:
                log.warning("SQLite: Failed to write copy audit for entity %d: %s", entity_id, exc)

        # --- Fabric SQL (SECONDARY — best-effort) ---
        try:
            self._db.execute_proc(
                "[logging].[sp_AuditCopyActivity]",
                {
                    "PipelineGuid": "00000000-0000-0000-0000-000000000000",
                    "CopyActivityName": f"Engine_Entity_{entity_id}",
                    "PipelineRunGuid": run_id,
                    "PipelineParentRunGuid": run_id,
                    "CopyActivityParameters": params_str,
                    "TriggerType": "Engine",
                    "TriggerGuid": "00000000-0000-0000-0000-000000000000",
                    "TriggerTime": datetime.utcnow(),
                    "LogData": message[:8000],
                    "LogType": status,
                    "WorkspaceGuid": "00000000-0000-0000-0000-000000000000",
                    "EntityId": entity_id,
                    "EntityLayer": "LandingZone",
                },
            )
        except Exception as exc:
            log.warning("Fabric SQL: Failed to write copy audit for entity %d: %s", entity_id, exc)

    def _write_engine_run(
        self,
        run_id: str,
        mode: str,
        status: str,
        total_entities: int = 0,
        succeeded_entities: int = 0,
        failed_entities: int = 0,
        skipped_entities: int = 0,
        total_rows_read: int = 0,
        total_rows_written: int = 0,
        total_bytes: int = 0,
        total_duration: float = 0.0,
        layers: str = "",
        entity_filter: str = "",
        triggered_by: str = "",
        error_summary: Optional[str] = None,
    ) -> None:
        """Dual-write to SQLite (primary) + execution.sp_UpsertEngineRun (secondary)."""
        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        # --- SQLite (PRIMARY) ---
        cpdb = _get_cpdb()
        if cpdb:
            try:
                row = {
                    "RunId": run_id,
                    "Mode": mode or "",
                    "Status": status,
                    "TotalEntities": total_entities,
                    "SucceededEntities": succeeded_entities,
                    "FailedEntities": failed_entities,
                    "SkippedEntities": skipped_entities,
                    "TotalRowsRead": total_rows_read,
                    "TotalRowsWritten": total_rows_written,
                    "TotalBytesTransferred": total_bytes,
                    "TotalDurationSeconds": total_duration,
                    "Layers": layers or "",
                    "EntityFilter": entity_filter or "",
                    "TriggeredBy": triggered_by or "",
                    "ErrorSummary": error_summary or "",
                }
                # Set timestamp fields based on status
                if status == "InProgress":
                    row["StartedAt"] = now_str
                elif status in ("Succeeded", "Failed"):
                    row["EndedAt"] = now_str
                cpdb.upsert_engine_run(row)
            except Exception as exc:
                log.warning("SQLite: Failed to write engine run: %s", exc)

        # --- Fabric SQL (SECONDARY — best-effort) ---
        try:
            self._db.execute_proc(
                "[execution].[sp_UpsertEngineRun]",
                {
                    "RunId": run_id,
                    "Mode": mode or "",
                    "Status": status,
                    "TotalEntities": total_entities,
                    "SucceededEntities": succeeded_entities,
                    "FailedEntities": failed_entities,
                    "SkippedEntities": skipped_entities,
                    "TotalRowsRead": total_rows_read,
                    "TotalRowsWritten": total_rows_written,
                    "TotalBytesTransferred": total_bytes,
                    "TotalDurationSeconds": total_duration,
                    "Layers": layers or "",
                    "EntityFilter": entity_filter or "",
                    "TriggeredBy": triggered_by or "",
                    "ErrorSummary": error_summary or "",
                },
            )
        except Exception as exc:
            log.warning("Fabric SQL: Failed to write engine run: %s", exc)

    @staticmethod
    def _classify_error(error: Optional[str]) -> str:
        """Classify an error message into a category."""
        if not error:
            return ""
        err_lower = error.lower()
        if "timeout" in err_lower:
            return "timeout"
        if "connection" in err_lower or "network" in err_lower:
            return "connection"
        if "memory" in err_lower or "oom" in err_lower:
            return "memory"
        if "permission" in err_lower or "denied" in err_lower:
            return "permission"
        if "not found" in err_lower or "404" in err_lower:
            return "not_found"
        return "other"

    def _write_engine_task_log(
        self,
        run_id: str,
        entity: Entity,
        result: RunResult,
        log_data: str = "",
    ) -> None:
        """Dual-write to SQLite (primary) + execution.sp_InsertEngineTaskLog (secondary)."""
        load_type = "incremental" if entity.is_incremental and entity.last_load_value else "full"
        error_type = self._classify_error(result.error)

        task_row = {
            "RunId": run_id,
            "EntityId": entity.id,
            "Layer": result.layer,
            "Status": result.status,
            "SourceServer": entity.source_server or "",
            "SourceDatabase": entity.source_database or "",
            "SourceTable": f"{entity.source_schema}.{entity.source_name}",
            "SourceQuery": entity.build_source_query()[:4000],
            "RowsRead": result.rows_read,
            "RowsWritten": result.rows_written,
            "BytesTransferred": result.bytes_transferred,
            "DurationSeconds": round(result.duration_seconds, 2),
            "TargetLakehouse": entity.lakehouse_guid or "",
            "TargetPath": entity.file_path or "",
            "WatermarkColumn": entity.watermark_column or "",
            "WatermarkBefore": result.watermark_before or entity.last_load_value or "",
            "WatermarkAfter": result.watermark_after or "",
            "LoadType": load_type,
            "ErrorType": error_type,
            "ErrorMessage": (result.error or "")[:4000],
            "ErrorStackTrace": "",
            "ErrorSuggestion": (result.error_suggestion or "")[:2000],
            "LogData": log_data[:8000],
        }

        # --- SQLite (PRIMARY) ---
        cpdb = _get_cpdb()
        if cpdb:
            try:
                cpdb.insert_engine_task_log(task_row)
            except Exception as exc:
                log.warning("SQLite: Failed to write engine task log for entity %d: %s", entity.id, exc)

        # --- Fabric SQL (SECONDARY — best-effort) ---
        try:
            self._db.execute_proc(
                "[execution].[sp_InsertEngineTaskLog]",
                task_row,
            )
        except Exception as exc:
            log.warning("Fabric SQL: Failed to write engine task log for entity %d: %s", entity.id, exc)
