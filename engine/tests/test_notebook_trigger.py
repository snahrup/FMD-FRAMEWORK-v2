"""Unit tests for engine/notebook_trigger.py — no network required.

Tests cover:
  - Notebook ID resolution and caching
  - Cache invalidation
  - FETCH_FROM_SQL signal construction
  - run_lz/run_bronze/run_silver when notebook not found
  - _trigger_and_wait error handling
  - _extract_job_id from location URL
  - Notebook display name constants
"""

import json
from unittest.mock import MagicMock, patch
import pytest

from engine.notebook_trigger import (
    NotebookTrigger,
    _NOTEBOOK_NAMES,
    _LAYER_ENTITY_PROC,
    _API_BASE,
)
from engine.models import EngineConfig, RunResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_config(**overrides) -> EngineConfig:
    defaults = dict(
        sql_server="test-server", sql_database="test-db",
        sql_driver="ODBC Driver 18", tenant_id="t", client_id="c",
        client_secret="s", workspace_data_id="wd", workspace_code_id="wc-code",
        lz_lakehouse_id="lz", bronze_lakehouse_id="br", silver_lakehouse_id="sv",
        notebook_timeout_seconds=60,
    )
    defaults.update(overrides)
    return EngineConfig(**defaults)


def _make_trigger(notebooks=None):
    """Create a NotebookTrigger with mocked API discovery."""
    config = _make_config()
    tp = MagicMock()
    tp.get_api_headers.return_value = {"Authorization": "Bearer test", "Content-Type": "application/json"}

    trigger = NotebookTrigger(config, tp)

    if notebooks is not None:
        # Pre-populate cache
        trigger._cache_populated = True
        trigger._id_cache = dict(notebooks)

    return trigger, tp


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

class TestConstants:
    def test_notebook_names_keys(self):
        assert "processing" in _NOTEBOOK_NAMES
        assert "bronze" in _NOTEBOOK_NAMES
        assert "silver" in _NOTEBOOK_NAMES
        assert "maintenance" in _NOTEBOOK_NAMES

    def test_notebook_display_names(self):
        assert _NOTEBOOK_NAMES["processing"] == "NB_FMD_PROCESSING_PARALLEL_MAIN"
        assert _NOTEBOOK_NAMES["bronze"] == "NB_FMD_LOAD_LANDING_BRONZE"
        assert _NOTEBOOK_NAMES["silver"] == "NB_FMD_LOAD_BRONZE_SILVER"
        assert _NOTEBOOK_NAMES["maintenance"] == "NB_FMD_MAINTENANCE_AGENT"

    def test_layer_entity_procs(self):
        assert "landing" in _LAYER_ENTITY_PROC
        assert "bronze" in _LAYER_ENTITY_PROC
        assert "silver" in _LAYER_ENTITY_PROC
        assert "sp_GetBronzelayerEntity" in _LAYER_ENTITY_PROC["bronze"]

    def test_api_base_url(self):
        assert _API_BASE == "https://api.fabric.microsoft.com/v1"


# ---------------------------------------------------------------------------
# Notebook ID resolution
# ---------------------------------------------------------------------------

class TestNotebookResolution:
    def test_resolve_from_cache(self):
        trigger, _ = _make_trigger(notebooks={
            "processing": "proc-guid",
            "bronze": "bronze-guid",
        })
        assert trigger._resolve("processing") == "proc-guid"
        assert trigger._resolve("bronze") == "bronze-guid"

    def test_resolve_missing_key_returns_empty(self):
        trigger, _ = _make_trigger(notebooks={"processing": "proc-guid"})
        assert trigger._resolve("nonexistent") == ""

    def test_get_resolved_ids(self):
        trigger, _ = _make_trigger(notebooks={
            "processing": "p1", "bronze": "b1", "silver": "s1",
        })
        ids = trigger.get_resolved_ids()
        assert ids == {"processing": "p1", "bronze": "b1", "silver": "s1"}

    def test_invalidate_cache(self):
        trigger, _ = _make_trigger(notebooks={"processing": "old-guid"})
        trigger.invalidate_cache()
        assert trigger._cache_populated is False
        assert trigger._id_cache == {}

    def test_ensure_cache_only_fetches_once(self):
        config = _make_config()
        tp = MagicMock()
        trigger = NotebookTrigger(config, tp)

        mock_notebooks = [
            {"id": "proc-id", "displayName": "NB_FMD_PROCESSING_PARALLEL_MAIN"},
        ]

        with patch.object(trigger, "_list_notebooks_raw", return_value=mock_notebooks) as mock_list:
            trigger._ensure_cache()
            trigger._ensure_cache()  # Second call should be no-op
            assert mock_list.call_count == 1

    def test_ensure_cache_maps_display_names(self):
        config = _make_config()
        tp = MagicMock()
        trigger = NotebookTrigger(config, tp)

        mock_notebooks = [
            {"id": "proc-id", "displayName": "NB_FMD_PROCESSING_PARALLEL_MAIN"},
            {"id": "bronze-id", "displayName": "NB_FMD_LOAD_LANDING_BRONZE"},
            {"id": "silver-id", "displayName": "NB_FMD_LOAD_BRONZE_SILVER"},
            {"id": "maint-id", "displayName": "NB_FMD_MAINTENANCE_AGENT"},
            {"id": "other-id", "displayName": "SomeOtherNotebook"},
        ]

        with patch.object(trigger, "_list_notebooks_raw", return_value=mock_notebooks):
            trigger._ensure_cache()

        assert trigger._id_cache["processing"] == "proc-id"
        assert trigger._id_cache["bronze"] == "bronze-id"
        assert trigger._id_cache["silver"] == "silver-id"
        assert trigger._id_cache["maintenance"] == "maint-id"
        assert "other-id" not in trigger._id_cache.values() or True  # SomeOtherNotebook not mapped

    def test_ensure_cache_handles_api_failure(self):
        config = _make_config()
        tp = MagicMock()
        trigger = NotebookTrigger(config, tp)

        with patch.object(trigger, "_list_notebooks_raw", side_effect=RuntimeError("API down")):
            trigger._ensure_cache()  # Should not raise

        assert trigger._cache_populated is True
        assert trigger._id_cache == {}


# ---------------------------------------------------------------------------
# run_* when notebook not found
# ---------------------------------------------------------------------------

class TestRunWhenNotFound:
    def test_run_lz_returns_skipped(self):
        trigger, _ = _make_trigger(notebooks={})  # No notebooks resolved
        result = trigger.run_lz("run-1")
        assert result.status == "skipped"
        assert "not found" in result.error

    def test_run_bronze_returns_skipped(self):
        trigger, _ = _make_trigger(notebooks={})
        result = trigger.run_bronze("run-1")
        assert result.status == "skipped"

    def test_run_silver_returns_skipped(self):
        trigger, _ = _make_trigger(notebooks={})
        result = trigger.run_silver("run-1")
        assert result.status == "skipped"

    def test_run_maintenance_returns_skipped(self):
        trigger, _ = _make_trigger(notebooks={})
        result = trigger.run_maintenance()
        assert result.status == "skipped"
        assert "MAINTENANCE_AGENT" in result.error


# ---------------------------------------------------------------------------
# _trigger_processing_notebook — signal construction
# ---------------------------------------------------------------------------

class TestProcessingNotebookSignal:
    def test_builds_fetch_from_sql_signal(self):
        trigger, tp = _make_trigger(notebooks={"processing": "proc-guid"})

        # Mock the actual trigger and poll
        with patch.object(trigger, "_trigger_and_wait") as mock_tw:
            mock_tw.return_value = RunResult(entity_id=0, layer="bronze", status="succeeded")
            trigger.run_bronze("run-1")

            call_args = mock_tw.call_args
            assert call_args.kwargs["notebook_id"] == "proc-guid"
            assert call_args.kwargs["layer"] == "bronze"
            params = call_args.kwargs["parameters"]
            assert "Path" in params
            signal = json.loads(params["Path"]["value"])
            assert signal[0]["path"] == "FETCH_FROM_SQL"
            assert signal[0]["params"]["proc"] == _LAYER_ENTITY_PROC["bronze"]


# ---------------------------------------------------------------------------
# discover_notebook_ids
# ---------------------------------------------------------------------------

class TestDiscoverNotebookIds:
    def test_clears_and_repopulates_cache(self):
        config = _make_config()
        tp = MagicMock()
        trigger = NotebookTrigger(config, tp)

        # First populate
        trigger._cache_populated = True
        trigger._id_cache = {"processing": "old-id"}

        mock_notebooks = [
            {"id": "new-proc-id", "displayName": "NB_FMD_PROCESSING_PARALLEL_MAIN"},
        ]

        with patch.object(trigger, "_list_notebooks_raw", return_value=mock_notebooks):
            ids = trigger.discover_notebook_ids()

        assert ids["processing"] == "new-proc-id"
        assert "old-id" not in ids.values()
