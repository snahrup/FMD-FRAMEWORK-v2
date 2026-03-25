"""
FMD v3 Engine — Structured JSON logging to SQLite audit tables.

Every operation produces a LogEnvelope that gets:
  1. Written to the Python logger (for local troubleshooting)
  2. Persisted to SQLite via control_plane_db (for the dashboard)

SQLite tables written:
  Run-level:
    - engine_run         — engine-specific run tracking
    - pipeline_audit     — generic pipeline audit (backward compat)

  Entity-level:
    - engine_task_log    — engine-specific task log (rich detail)
    - copy_activity_audit — generic copy audit (backward compat)
    - pipeline_lz_entity — mark entity as loaded
    - entity_status      — update entity digest for dashboard
    - watermark          — incremental load watermark tracking
"""

import logging
import traceback
from datetime import datetime
from typing import Optional, List

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
        log.debug("control_plane_db not available (SQLite writes disabled): %s", exc)
        _cpdb = None
    _cpdb_loaded = True
    return _cpdb


class AuditLogger:
    """Writes structured audit records to Python logger and SQLite.

    Usage::

        audit = AuditLogger()
        audit.log_run_start(run_id, mode, entity_count, layers, triggered_by)
        audit.log_entity_result(run_id, entity, result)
        audit.log_run_end(run_id, results)
    """

    def __init__(self):
        pass

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

        Writes to SQLite only via control_plane_db.
        """
        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

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

    def mark_bronze_entity_processed(self, entity, result) -> None:
        """Write Bronze entity processing status to SQLite tracking tables."""
        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        cpdb = _get_cpdb()
        if not cpdb:
            return
        try:
            cpdb.upsert_entity_status({
                "LandingzoneEntityId": entity.lz_entity_id,
                "Layer": "bronze",
                "Status": "loaded" if result.status == "succeeded" else "failed",
                "LoadEndDateTime": now_str,
                "ErrorMessage": result.error or "",
                "UpdatedBy": "FMD_ENGINE_V3",
            })
        except Exception as exc:
            log.warning("SQLite: Failed to upsert entity_status (Bronze) for entity %d: %s",
                        entity.bronze_entity_id, exc)
        try:
            cpdb.upsert_pipeline_bronze_entity({
                "BronzeLayerEntityId": entity.bronze_entity_id,
                "TableName": entity.source_name,
                "SchemaName": entity.namespace,
                "InsertDateTime": now_str,
                "IsProcessed": 1 if result.status == "succeeded" else 0,
            })
        except Exception as exc:
            log.warning("SQLite: Failed to upsert pipeline_bronze_entity for entity %d: %s",
                        entity.bronze_entity_id, exc)

    def mark_silver_entity_processed(self, entity, result) -> None:
        """Write Silver entity processing status to SQLite tracking tables."""
        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        cpdb = _get_cpdb()
        if not cpdb:
            return
        lz_id = getattr(entity, 'lz_entity_id', 0)
        if not lz_id:
            log.debug("Silver entity %d has no lz_entity_id, skipping entity_status", entity.silver_entity_id)
            return
        try:
            cpdb.upsert_entity_status({
                "LandingzoneEntityId": lz_id,
                "Layer": "silver",
                "Status": "loaded" if result.status == "succeeded" else "failed",
                "LoadEndDateTime": now_str,
                "ErrorMessage": result.error or "",
                "UpdatedBy": "FMD_ENGINE_V3",
            })
        except Exception as exc:
            log.warning("SQLite: Failed to upsert entity_status (Silver) for entity %d: %s",
                        entity.silver_entity_id, exc)

    def update_watermark(
        self,
        entity: Entity,
        new_value: str,
    ) -> None:
        """Update the watermark tracking table for incremental loads.

        Writes to SQLite only via control_plane_db.
        """
        if not new_value or new_value == entity.last_load_value:
            return

        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        cpdb = _get_cpdb()
        if cpdb:
            try:
                cpdb.upsert_watermark(entity.id, new_value, now_str)
            except Exception as exc:
                log.warning(
                    "SQLite: Failed to update watermark for entity %d: %s", entity.id, exc,
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
        """Write pipeline audit record to SQLite."""
        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

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
        """Write copy activity audit record to SQLite."""
        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        params_str = f"rows={rows_read},bytes={bytes_transferred},dur={duration_seconds}s"

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
        """Write engine run record to SQLite."""
        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

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
        """Write engine task log record to SQLite."""
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
            "SourceQuery": entity.build_source_query_display()[:4000],
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
            "ExtractionMethod": result.extraction_method or "unknown",
        }

        cpdb = _get_cpdb()
        if cpdb:
            try:
                cpdb.insert_engine_task_log(task_row)
            except Exception as exc:
                log.warning("SQLite: Failed to write engine task log for entity %d: %s", entity.id, exc)
