"""
FMD v3 Engine — Trigger LZ/Bronze/Silver/Maintenance Fabric notebooks via REST API.

ALL notebook IDs are resolved dynamically from the Fabric API by display name.
Nothing is hardcoded. The CODE workspace is queried once and cached.

Bronze and Silver are triggered via NB_FMD_PROCESSING_PARALLEL_MAIN which:
  1. Receives a FETCH_FROM_SQL signal with the stored proc name
  2. Connects to the metadata DB and fetches the full entity list
  3. Runs up to 50 per-entity notebooks in parallel via runMultiple()

Maintenance Agent is triggered directly (no parameters needed — reads from
Variable Libraries and scans OneLake).
"""

import json
import logging
import time
import urllib.request
from typing import Optional

from engine.auth import TokenProvider
from engine.models import EngineConfig, RunResult

log = logging.getLogger("fmd.notebook_trigger")

# Fabric API base
_API_BASE = "https://api.fabric.microsoft.com/v1"

# Display names → lookup keys (single source of truth)
_NOTEBOOK_NAMES = {
    "processing":  "NB_FMD_PROCESSING_PARALLEL_MAIN",
    "bronze":      "NB_FMD_LOAD_LANDING_BRONZE",
    "silver":      "NB_FMD_LOAD_BRONZE_SILVER",
    "maintenance": "NB_FMD_MAINTENANCE_AGENT",
}

# Stored procs that build entity payloads for the processing notebook
_LAYER_ENTITY_PROC = {
    "landing": "[execution].[sp_GetLandingzoneEntity]",
    "bronze": "[execution].[sp_GetBronzelayerEntity]",
    "silver": "[execution].[sp_GetSilverlayerEntity]",
}


class NotebookTrigger:
    """Trigger and monitor Fabric notebooks for LZ/Bronze/Silver/Maintenance processing.

    Notebook IDs are resolved dynamically from the Fabric REST API by display
    name — no hardcoded GUIDs anywhere.

    Usage::

        trigger = NotebookTrigger(config, token_provider)
        result = trigger.run_lz(run_id)
        result = trigger.run_bronze(run_id)
        result = trigger.run_silver(run_id)
        result = trigger.run_maintenance()
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._token_provider = token_provider
        # Lazily populated cache: {"processing": "guid", "bronze": "guid", ...}
        self._id_cache: dict[str, str] = {}
        self._cache_populated = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run_lz(self, run_id: str = "") -> RunResult:
        """Trigger the Landing Zone processing notebook and wait for completion."""
        notebook_id = self._resolve("processing")
        if not notebook_id:
            return RunResult(
                entity_id=0, layer="landing", status="skipped",
                error=f"{_NOTEBOOK_NAMES['processing']} not found in CODE workspace",
                error_suggestion="Deploy the processing notebook to the CODE workspace.",
            )
        return self._trigger_processing_notebook(
            notebook_id=notebook_id, layer="landing",
            stored_proc=_LAYER_ENTITY_PROC["landing"], run_id=run_id,
        )

    def run_bronze(self, run_id: str = "") -> RunResult:
        """Trigger the Bronze processing notebook and wait for completion."""
        notebook_id = self._resolve("processing")
        if not notebook_id:
            return RunResult(
                entity_id=0, layer="bronze", status="skipped",
                error=f"{_NOTEBOOK_NAMES['processing']} not found in CODE workspace",
                error_suggestion="Deploy the processing notebook to the CODE workspace.",
            )
        return self._trigger_processing_notebook(
            notebook_id=notebook_id, layer="bronze",
            stored_proc=_LAYER_ENTITY_PROC["bronze"], run_id=run_id,
        )

    def run_silver(self, run_id: str = "") -> RunResult:
        """Trigger the Silver processing notebook and wait for completion."""
        notebook_id = self._resolve("processing")
        if not notebook_id:
            return RunResult(
                entity_id=0, layer="silver", status="skipped",
                error=f"{_NOTEBOOK_NAMES['processing']} not found in CODE workspace",
                error_suggestion="Deploy the processing notebook to the CODE workspace.",
            )
        return self._trigger_processing_notebook(
            notebook_id=notebook_id, layer="silver",
            stored_proc=_LAYER_ENTITY_PROC["silver"], run_id=run_id,
        )

    def run_maintenance(self) -> RunResult:
        """Trigger the Maintenance Agent notebook and wait for completion."""
        notebook_id = self._resolve("maintenance")
        if not notebook_id:
            return RunResult(
                entity_id=0, layer="maintenance", status="skipped",
                error=f"{_NOTEBOOK_NAMES['maintenance']} not found in CODE workspace",
                error_suggestion="Deploy the maintenance agent notebook to the CODE workspace.",
            )
        return self._trigger_and_wait(
            notebook_id=notebook_id, layer="maintenance",
            parameters=None, run_id="maintenance",
        )

    def get_resolved_ids(self) -> dict[str, str]:
        """Return the current resolved notebook IDs (for API/status responses)."""
        self._ensure_cache()
        return dict(self._id_cache)

    # ------------------------------------------------------------------
    # Dynamic ID resolution
    # ------------------------------------------------------------------

    def _resolve(self, key: str) -> str:
        """Resolve a notebook key to its Fabric item ID.

        Queries the CODE workspace once, caches all results.
        """
        self._ensure_cache()
        nb_id = self._id_cache.get(key, "")
        if not nb_id:
            log.warning(
                "Notebook '%s' (%s) not found in CODE workspace %s",
                key, _NOTEBOOK_NAMES.get(key, "?"), self._config.workspace_code_id,
            )
        return nb_id

    def _ensure_cache(self) -> None:
        """Populate the ID cache from the Fabric API (once per instance)."""
        if self._cache_populated:
            return
        self._cache_populated = True

        try:
            notebooks = self._list_notebooks_raw()
            name_to_id = {nb["displayName"]: nb["id"] for nb in notebooks}

            for key, display_name in _NOTEBOOK_NAMES.items():
                if display_name in name_to_id:
                    self._id_cache[key] = name_to_id[display_name]
                    log.info("Resolved %s → %s (%s)", key, name_to_id[display_name], display_name)
                else:
                    log.warning(
                        "%s (%s) not found. Available: %s",
                        key, display_name,
                        [nb["displayName"] for nb in notebooks],
                    )
        except Exception as exc:
            log.error("Failed to resolve notebook IDs from Fabric API: %s", exc)

    def invalidate_cache(self) -> None:
        """Force re-resolution on next use (e.g. after deployment)."""
        self._id_cache.clear()
        self._cache_populated = False

    # ------------------------------------------------------------------
    # Internal — Processing notebook (Bronze/Silver via FETCH_FROM_SQL)
    # ------------------------------------------------------------------

    def _trigger_processing_notebook(
        self,
        notebook_id: str,
        layer: str,
        stored_proc: str,
        run_id: str = "",
    ) -> RunResult:
        """Build a FETCH_FROM_SQL signal and trigger the processing notebook."""
        fetch_signal = json.dumps([{
            "path": "FETCH_FROM_SQL",
            "params": {
                "proc": stored_proc,
                "layer": layer,
                "count": "?",
            },
        }])

        parameters = {
            "Path": {"value": fetch_signal, "type": "string"},
        }

        log.info(
            "[%s] Triggering %s via FETCH_FROM_SQL (proc=%s, notebook=%s)",
            run_id[:8] if run_id else "?",
            layer, stored_proc, notebook_id,
        )

        return self._trigger_and_wait(
            notebook_id=notebook_id, layer=layer,
            parameters=parameters, run_id=run_id,
        )

    # ------------------------------------------------------------------
    # Internal — Generic trigger + poll
    # ------------------------------------------------------------------

    def _trigger_and_wait(
        self,
        notebook_id: str,
        layer: str,
        parameters: Optional[dict] = None,
        run_id: str = "",
    ) -> RunResult:
        """Trigger a notebook job and poll until completion or timeout."""
        t0 = time.perf_counter()
        ws = self._config.workspace_code_id

        log.info(
            "[%s] Triggering %s notebook %s in workspace %s",
            run_id[:8] if run_id else "?", layer, notebook_id, ws,
        )

        try:
            location = self._trigger_notebook(ws, notebook_id, parameters)
            if not location:
                elapsed = time.perf_counter() - t0
                return RunResult(
                    entity_id=0, layer=layer, status="failed",
                    duration_seconds=round(elapsed, 2),
                    error="No Location header in trigger response",
                    error_suggestion="The Fabric API did not return a job URL. Check notebook permissions.",
                )

            final_status = self._poll_job(location, layer, run_id)
            elapsed = time.perf_counter() - t0

            if final_status == "Completed":
                log.info("[%s] %s notebook completed in %.1fs",
                         run_id[:8] if run_id else "?", layer, elapsed)
                return RunResult(
                    entity_id=0, layer=layer, status="succeeded",
                    duration_seconds=round(elapsed, 2),
                )
            else:
                log.error("[%s] %s notebook ended with status: %s",
                          run_id[:8] if run_id else "?", layer, final_status)
                return RunResult(
                    entity_id=0, layer=layer, status="failed",
                    duration_seconds=round(elapsed, 2),
                    error=f"Notebook job ended with status: {final_status}",
                    error_suggestion=f"Check the {layer} notebook logs in the Fabric portal.",
                )

        except Exception as exc:
            elapsed = time.perf_counter() - t0
            log.error("[%s] %s notebook trigger failed: %s",
                      run_id[:8] if run_id else "?", layer, exc)
            return RunResult(
                entity_id=0, layer=layer, status="failed",
                duration_seconds=round(elapsed, 2),
                error=str(exc),
                error_suggestion=f"Failed to trigger the {layer} notebook. Check SP permissions.",
            )

    def _trigger_notebook(
        self,
        workspace_id: str,
        notebook_id: str,
        parameters: Optional[dict] = None,
    ) -> Optional[str]:
        """POST to trigger the notebook job.  Returns the Location URL for polling."""
        url = f"{_API_BASE}/workspaces/{workspace_id}/items/{notebook_id}/jobs/instances?jobType=RunNotebook"
        headers = self._token_provider.get_api_headers()

        if parameters:
            body = json.dumps({"executionData": {"parameters": parameters}}).encode("utf-8")
        else:
            body = b"{}"

        req = urllib.request.Request(url, data=body, headers=headers, method="POST")

        try:
            resp = urllib.request.urlopen(req, timeout=60)
            return resp.headers.get("Location")
        except urllib.error.HTTPError as exc:
            if exc.code == 202:
                return exc.headers.get("Location")
            raise

    def _poll_job(
        self,
        location_url: str,
        layer: str,
        run_id: str = "",
        poll_interval: int = 15,
    ) -> str:
        """Poll a Fabric job until terminal status or timeout."""
        timeout = self._config.notebook_timeout_seconds
        deadline = time.time() + timeout

        while time.time() < deadline:
            try:
                headers = self._token_provider.get_api_headers()
                req = urllib.request.Request(location_url, headers=headers)
                resp = urllib.request.urlopen(req, timeout=30)
                body = json.loads(resp.read())

                status = body.get("status", "Unknown")
                log.debug("[%s] %s notebook poll: %s",
                          run_id[:8] if run_id else "?", layer, status)

                if status in ("Completed", "Failed", "Cancelled"):
                    return status

            except urllib.error.HTTPError as exc:
                if exc.code == 202:
                    pass
                else:
                    log.warning("Poll error (HTTP %d), retrying...", exc.code)
            except Exception as exc:
                log.warning("Poll error: %s, retrying...", exc)

            time.sleep(poll_interval)

        log.error("[%s] %s notebook timed out after %ds",
                  run_id[:8] if run_id else "?", layer, timeout)
        return "Timeout"

    # ------------------------------------------------------------------
    # Discovery (public — for status endpoints)
    # ------------------------------------------------------------------

    def _list_notebooks_raw(self) -> list[dict]:
        """GET all notebooks from the CODE workspace."""
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

    def list_notebooks(self) -> list[dict]:
        """List all notebooks in the CODE workspace (for config discovery)."""
        return self._list_notebooks_raw()

    def discover_notebook_ids(self) -> dict[str, str]:
        """Auto-discover notebook IDs from the CODE workspace.

        Returns dict with keys: 'processing', 'bronze', 'silver', 'maintenance'.
        """
        self._cache_populated = False
        self._id_cache.clear()
        self._ensure_cache()
        return dict(self._id_cache)
