"""
FMD v3 Engine — Fabric Pipeline Runner.

Triggers PL_FMD_LDZ_COPY_SQL per entity via Fabric REST API instead of
extracting locally.  Each entity gets its own pipeline run with parameters
mapped from metadata.  The engine's ThreadPoolExecutor handles concurrency.

API reference:
  Trigger: POST /v1/workspaces/{ws}/items/{pipelineId}/jobs/instances?jobType=Pipeline
  Poll:    GET  /v1/workspaces/{ws}/items/{pipelineId}/jobs/instances/{jobId}
  Cancel:  POST /v1/workspaces/{ws}/items/{pipelineId}/jobs/instances/{jobId}/cancel

Token scope: https://api.fabric.microsoft.com/.default
"""

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from engine.auth import TokenProvider, SCOPE_FABRIC_API
from engine.models import EngineConfig, Entity, RunResult

log = logging.getLogger("fmd.pipeline_runner")

API_BASE = "https://api.fabric.microsoft.com/v1"
POLL_INTERVAL = 10       # seconds between status checks
MAX_POLL_TIME = 7200     # 2 hours max per entity pipeline run
MAX_TRIGGER_RETRIES = 3  # retries on 429 / transient errors


class FabricPipelineRunner:
    """Trigger and poll Fabric Data Pipelines for entity loading."""

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self.config = config
        self._tokens = token_provider
        self._pipeline_id = config.pipeline_copy_sql_id
        self._workspace_id = config.pipeline_workspace_id or config.workspace_code_id

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def trigger_copy(
        self,
        entity: Entity,
        run_id: str,
        stop_check=None,
    ) -> RunResult:
        """Trigger PL_FMD_LDZ_COPY_SQL for one entity and poll to completion.

        Parameters
        ----------
        entity : Entity
            The entity to load.
        run_id : str
            Current engine run ID (for file naming).
        stop_check : callable, optional
            Returns True if the engine has been asked to stop.

        Returns
        -------
        RunResult
            With status succeeded/failed and duration.
        """
        if not self._pipeline_id:
            return RunResult(
                entity_id=entity.id, layer="landing", status="failed",
                error="pipeline_copy_sql_id not configured",
                error_suggestion="Deploy PL_FMD_LDZ_COPY_SQL and set its ID in engine config.",
            )

        start = time.time()
        params = self._build_pipeline_params(entity, run_id)

        # Trigger
        job_id = self._trigger(params)
        if not job_id:
            return RunResult(
                entity_id=entity.id, layer="landing", status="failed",
                duration_seconds=round(time.time() - start, 2),
                error="Failed to trigger pipeline",
                error_suggestion="Check Fabric API connectivity and pipeline_copy_sql_id.",
            )

        log.info(
            "Pipeline triggered for %s → job %s",
            entity.qualified_name, job_id[:8],
        )

        # Poll
        status, failure_reason = self._poll(job_id, stop_check)
        elapsed = round(time.time() - start, 2)

        if status == "Completed":
            return RunResult(
                entity_id=entity.id,
                layer="landing",
                status="succeeded",
                duration_seconds=elapsed,
                watermark_before=entity.last_load_value,
                watermark_after=entity.last_load_value,  # pipeline doesn't report new watermark
            )

        # Cancelled (engine stop requested)
        if status == "Cancelled":
            return RunResult(
                entity_id=entity.id, layer="landing", status="skipped",
                duration_seconds=elapsed,
            )

        # Failed or timeout
        return RunResult(
            entity_id=entity.id, layer="landing", status="failed",
            duration_seconds=elapsed,
            error=f"Pipeline {status}: {failure_reason or 'unknown'}",
            error_suggestion="Check Fabric Monitor for pipeline run details.",
        )

    # ------------------------------------------------------------------
    # Private
    # ------------------------------------------------------------------

    def _build_pipeline_params(self, entity: Entity, run_id: str) -> dict:
        """Map Entity fields to PL_FMD_LDZ_COPY_SQL parameters."""
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        return {
            "ConnectionGuid": entity.connection_guid,
            "SourceSchema": entity.source_schema,
            "SourceName": entity.source_name,
            "SourceDataRetrieval": entity.build_source_query(),
            "DatasourceName": entity.source_database,
            "WorkspaceGuid": entity.workspace_guid,
            "TargetLakehouseGuid": entity.lakehouse_guid,
            "TargetFilePath": f"{entity.namespace}/{entity.source_schema}_{entity.source_name}",
            "TargetFileName": f"{entity.source_schema}_{entity.source_name}_{ts}.parquet",
        }

    def _trigger(self, params: dict) -> Optional[str]:
        """POST to Fabric API, return job ID from Location header."""
        url = (
            f"{API_BASE}/workspaces/{self._workspace_id}"
            f"/items/{self._pipeline_id}/jobs/instances?jobType=Pipeline"
        )
        body = json.dumps({"executionData": {"parameters": params}}).encode()
        token = self._tokens.get_token(SCOPE_FABRIC_API)

        for attempt in range(MAX_TRIGGER_RETRIES):
            req = urllib.request.Request(
                url, data=body, method="POST",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            try:
                resp = urllib.request.urlopen(req, timeout=30)
                # 200 OK — extract job ID from Location header
                return self._extract_job_id(resp)
            except urllib.error.HTTPError as e:
                if e.code == 202:
                    # 202 Accepted — normal success response
                    return self._extract_job_id(e)
                if e.code == 429:
                    retry_after = int(e.headers.get("Retry-After", 2 ** (attempt + 1)))
                    log.warning(
                        "Pipeline trigger throttled (429), retrying in %ds",
                        retry_after,
                    )
                    time.sleep(retry_after)
                    continue
                err_body = e.read().decode()[:500]
                log.error("Pipeline trigger failed: HTTP %d: %s", e.code, err_body)
                return None
            except Exception as e:
                log.error("Pipeline trigger error: %s", e)
                if attempt < MAX_TRIGGER_RETRIES - 1:
                    time.sleep(2 ** (attempt + 1))
                    continue
                return None

        return None

    def _poll(
        self,
        job_id: str,
        stop_check=None,
    ) -> tuple[str, Optional[str]]:
        """Poll until Completed/Failed/Cancelled.

        Returns (status, failure_reason).
        """
        start = time.time()
        url = (
            f"{API_BASE}/workspaces/{self._workspace_id}"
            f"/items/{self._pipeline_id}/jobs/instances/{job_id}"
        )

        while True:
            elapsed = time.time() - start
            if elapsed > MAX_POLL_TIME:
                # Try to cancel the pipeline before giving up
                self._cancel(job_id)
                return "Timeout", f"Exceeded {MAX_POLL_TIME}s max poll time"

            # Check if engine stop was requested
            if stop_check and stop_check():
                self._cancel(job_id)
                return "Cancelled", "Engine stop requested"

            time.sleep(POLL_INTERVAL)

            token = self._tokens.get_token(SCOPE_FABRIC_API)
            req = urllib.request.Request(
                url, headers={"Authorization": f"Bearer {token}"},
            )

            try:
                resp = urllib.request.urlopen(req, timeout=15)
                data = json.loads(resp.read())
                status = data.get("status", "Unknown")

                if status in ("Completed", "Failed", "Cancelled"):
                    failure = data.get("failureReason")
                    failure_msg = None
                    if failure:
                        failure_msg = (
                            failure.get("message", str(failure))[:500]
                            if isinstance(failure, dict) else str(failure)[:500]
                        )
                    return status, failure_msg

            except urllib.error.HTTPError as e:
                if e.code == 429:
                    retry_after = int(e.headers.get("Retry-After", POLL_INTERVAL))
                    time.sleep(retry_after)
                    continue
                log.warning("Poll error: HTTP %d", e.code)
            except Exception as e:
                log.warning("Poll error: %s", e)

    def _cancel(self, job_id: str) -> None:
        """Best-effort cancel of a pipeline run."""
        url = (
            f"{API_BASE}/workspaces/{self._workspace_id}"
            f"/items/{self._pipeline_id}/jobs/instances/{job_id}/cancel"
        )
        token = self._tokens.get_token(SCOPE_FABRIC_API)
        req = urllib.request.Request(
            url, data=b"", method="POST",
            headers={"Authorization": f"Bearer {token}"},
        )
        try:
            urllib.request.urlopen(req, timeout=10)
            log.info("Pipeline run %s cancelled", job_id[:8])
        except Exception:
            pass  # Best-effort

    @staticmethod
    def _extract_job_id(resp) -> Optional[str]:
        """Extract job ID from the Location header of a trigger response."""
        location = resp.headers.get("Location", "")
        if location:
            return location.rstrip("/").split("/")[-1]
        return None
