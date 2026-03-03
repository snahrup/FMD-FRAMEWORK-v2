"""
FMD v3 Engine — Trigger Bronze/Silver Fabric notebooks via REST API.

Uses the Fabric Items API to run notebooks in the CODE workspace:
  POST /v1/workspaces/{ws}/items/{notebookId}/jobs/instances?jobType=RunNotebook

Then polls the job status until completion or timeout.
"""

import json
import logging
import time
import urllib.parse
import urllib.request
from typing import Optional

from engine.auth import TokenProvider
from engine.models import EngineConfig, RunResult

log = logging.getLogger("fmd.notebook_trigger")

# Fabric API base
_API_BASE = "https://api.fabric.microsoft.com/v1"


class NotebookTrigger:
    """Trigger and monitor Fabric notebooks for Bronze/Silver processing.

    Usage::

        trigger = NotebookTrigger(config, token_provider)
        result = trigger.run_bronze(run_id)
        result = trigger.run_silver(run_id)
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._token_provider = token_provider

    def run_bronze(self, run_id: str = "") -> RunResult:
        """Trigger the Bronze notebook and wait for completion."""
        if not self._config.notebook_bronze_id:
            log.warning("notebook_bronze_id not configured — skipping Bronze")
            return RunResult(
                entity_id=0,
                layer="bronze",
                status="skipped",
                error="notebook_bronze_id not set in config",
                error_suggestion="Add engine.notebook_bronze_id to config.json with the notebook item ID.",
            )
        return self._trigger_and_wait(
            notebook_id=self._config.notebook_bronze_id,
            layer="bronze",
            run_id=run_id,
        )

    def run_silver(self, run_id: str = "") -> RunResult:
        """Trigger the Silver notebook and wait for completion."""
        if not self._config.notebook_silver_id:
            log.warning("notebook_silver_id not configured — skipping Silver")
            return RunResult(
                entity_id=0,
                layer="silver",
                status="skipped",
                error="notebook_silver_id not set in config",
                error_suggestion="Add engine.notebook_silver_id to config.json with the notebook item ID.",
            )
        return self._trigger_and_wait(
            notebook_id=self._config.notebook_silver_id,
            layer="silver",
            run_id=run_id,
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _trigger_and_wait(
        self,
        notebook_id: str,
        layer: str,
        run_id: str = "",
    ) -> RunResult:
        """Trigger a notebook job and poll until completion or timeout.

        Parameters
        ----------
        notebook_id : str
            The Fabric item ID of the notebook.
        layer : str
            'bronze' or 'silver' — used for logging/result.
        run_id : str
            Current run ID for correlation.

        Returns
        -------
        RunResult
            Outcome with duration and any error details.
        """
        t0 = time.perf_counter()
        ws = self._config.workspace_code_id

        log.info(
            "[%s] Triggering %s notebook %s in workspace %s",
            run_id[:8] if run_id else "?",
            layer,
            notebook_id,
            ws,
        )

        try:
            # Step 1: Trigger the notebook job
            location = self._trigger_notebook(ws, notebook_id)
            if not location:
                elapsed = time.perf_counter() - t0
                return RunResult(
                    entity_id=0,
                    layer=layer,
                    status="failed",
                    duration_seconds=round(elapsed, 2),
                    error="No Location header in trigger response",
                    error_suggestion="The Fabric API did not return a job URL. Check notebook permissions.",
                )

            # Step 2: Poll until done
            final_status = self._poll_job(location, layer, run_id)
            elapsed = time.perf_counter() - t0

            if final_status == "Completed":
                log.info(
                    "[%s] %s notebook completed in %.1fs",
                    run_id[:8] if run_id else "?", layer, elapsed,
                )
                return RunResult(
                    entity_id=0,
                    layer=layer,
                    status="succeeded",
                    duration_seconds=round(elapsed, 2),
                )
            else:
                log.error(
                    "[%s] %s notebook ended with status: %s",
                    run_id[:8] if run_id else "?", layer, final_status,
                )
                return RunResult(
                    entity_id=0,
                    layer=layer,
                    status="failed",
                    duration_seconds=round(elapsed, 2),
                    error=f"Notebook job ended with status: {final_status}",
                    error_suggestion=f"Check the {layer} notebook logs in the Fabric portal.",
                )

        except Exception as exc:
            elapsed = time.perf_counter() - t0
            log.error(
                "[%s] %s notebook trigger failed: %s",
                run_id[:8] if run_id else "?", layer, exc,
            )
            return RunResult(
                entity_id=0,
                layer=layer,
                status="failed",
                duration_seconds=round(elapsed, 2),
                error=str(exc),
                error_suggestion=f"Failed to trigger the {layer} notebook. Check SP permissions and notebook ID.",
            )

    def _trigger_notebook(self, workspace_id: str, notebook_id: str) -> Optional[str]:
        """POST to trigger the notebook job.  Returns the Location URL for polling."""
        url = f"{_API_BASE}/workspaces/{workspace_id}/items/{notebook_id}/jobs/instances?jobType=RunNotebook"
        headers = self._token_provider.get_api_headers()

        req = urllib.request.Request(url, data=b"{}", headers=headers, method="POST")

        try:
            resp = urllib.request.urlopen(req, timeout=60)
            # 202 Accepted — Location header has the job URL
            location = resp.headers.get("Location")
            return location
        except urllib.error.HTTPError as exc:
            if exc.code == 202:
                # urllib treats 202 as success in some versions, check headers
                return exc.headers.get("Location")
            raise

    def _poll_job(
        self,
        location_url: str,
        layer: str,
        run_id: str = "",
        poll_interval: int = 15,
    ) -> str:
        """Poll a Fabric job until terminal status or timeout.

        Returns the final status string: 'Completed', 'Failed', 'Cancelled', 'Timeout'.
        """
        timeout = self._config.notebook_timeout_seconds
        deadline = time.time() + timeout

        while time.time() < deadline:
            try:
                headers = self._token_provider.get_api_headers()
                req = urllib.request.Request(location_url, headers=headers)
                resp = urllib.request.urlopen(req, timeout=30)
                body = json.loads(resp.read())

                status = body.get("status", "Unknown")
                log.debug(
                    "[%s] %s notebook poll: %s",
                    run_id[:8] if run_id else "?", layer, status,
                )

                if status in ("Completed", "Failed", "Cancelled"):
                    return status

            except urllib.error.HTTPError as exc:
                if exc.code == 202:
                    # Still running
                    pass
                else:
                    log.warning("Poll error (HTTP %d), retrying...", exc.code)

            except Exception as exc:
                log.warning("Poll error: %s, retrying...", exc)

            time.sleep(poll_interval)

        log.error(
            "[%s] %s notebook timed out after %ds",
            run_id[:8] if run_id else "?", layer, timeout,
        )
        return "Timeout"

    def list_notebooks(self) -> list[dict]:
        """List all notebooks in the CODE workspace (for config discovery).

        Uses: GET /v1/workspaces/{ws}/items?type=Notebook
        """
        ws = self._config.workspace_code_id
        url = f"{_API_BASE}/workspaces/{ws}/items?type=Notebook"
        headers = self._token_provider.get_api_headers()

        req = urllib.request.Request(url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=30)
        data = json.loads(resp.read())

        return [
            {"id": item["id"], "displayName": item["displayName"]}
            for item in data.get("value", [])
        ]

    def discover_notebook_ids(self) -> dict[str, str]:
        """Auto-discover Bronze and Silver notebook IDs from the CODE workspace.

        Queries the Fabric REST API (GET /v1/workspaces/{ws}/items?type=Notebook)
        and matches known notebook display names to their Fabric item IDs.

        Known notebook names:
          - Bronze: NB_FMD_LOAD_LANDING_BRONZE
          - Silver: NB_FMD_LOAD_BRONZE_SILVER

        Returns
        -------
        dict[str, str]
            Keys: 'bronze', 'silver'.  Values: Fabric item IDs (or '' if not found).
        """
        result = {"bronze": "", "silver": ""}

        # Mapping of layer -> expected notebook display names (in priority order)
        _BRONZE_NAMES = ["NB_FMD_LOAD_LANDING_BRONZE"]
        _SILVER_NAMES = ["NB_FMD_LOAD_BRONZE_SILVER"]

        try:
            notebooks = self.list_notebooks()
            name_to_id = {nb["displayName"]: nb["id"] for nb in notebooks}

            for name in _BRONZE_NAMES:
                if name in name_to_id:
                    result["bronze"] = name_to_id[name]
                    log.info("Discovered Bronze notebook: %s -> %s", name, result["bronze"])
                    break

            for name in _SILVER_NAMES:
                if name in name_to_id:
                    result["silver"] = name_to_id[name]
                    log.info("Discovered Silver notebook: %s -> %s", name, result["silver"])
                    break

            if not result["bronze"]:
                log.warning(
                    "Bronze notebook not found in workspace %s. Available: %s",
                    self._config.workspace_code_id,
                    [nb["displayName"] for nb in notebooks],
                )
            if not result["silver"]:
                log.warning(
                    "Silver notebook not found in workspace %s. Available: %s",
                    self._config.workspace_code_id,
                    [nb["displayName"] for nb in notebooks],
                )

        except Exception as exc:
            log.error("Failed to discover notebook IDs: %s", exc)

        return result
