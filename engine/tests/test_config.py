"""Unit tests for engine/config.py — no network required."""

import json
import os
import tempfile
from pathlib import Path

import pytest
from engine.config import load_config, _resolve_env_vars, _load_env


# ---------------------------------------------------------------------------
# _resolve_env_vars
# ---------------------------------------------------------------------------

def test_resolve_env_vars_simple(monkeypatch):
    monkeypatch.setenv("TEST_VAR", "hello")
    assert _resolve_env_vars("${TEST_VAR}") == "hello"


def test_resolve_env_vars_missing(monkeypatch):
    monkeypatch.delenv("NONEXISTENT_VAR", raising=False)
    assert _resolve_env_vars("${NONEXISTENT_VAR}") == ""


def test_resolve_env_vars_dict(monkeypatch):
    monkeypatch.setenv("MY_SECRET", "s3cret")
    result = _resolve_env_vars({"key": "${MY_SECRET}", "other": "plain"})
    assert result == {"key": "s3cret", "other": "plain"}


def test_resolve_env_vars_nested(monkeypatch):
    monkeypatch.setenv("V1", "a")
    result = _resolve_env_vars({"top": {"nested": "${V1}"}})
    assert result["top"]["nested"] == "a"


def test_resolve_env_vars_passthrough():
    """Non-placeholder strings should pass through unchanged."""
    assert _resolve_env_vars("just a string") == "just a string"
    assert _resolve_env_vars(42) == 42
    assert _resolve_env_vars(None) is None


# ---------------------------------------------------------------------------
# _load_env
# ---------------------------------------------------------------------------

def test_load_env():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".env", delete=False) as f:
        f.write("TEST_ENV_LOAD=works\n")
        f.write("# comment\n")
        f.write("ANOTHER=value\n")
        f.flush()
        path = Path(f.name)

    try:
        os.environ.pop("TEST_ENV_LOAD", None)
        os.environ.pop("ANOTHER", None)
        count = _load_env(path)
        assert count == 2
        assert os.environ.get("TEST_ENV_LOAD") == "works"
        assert os.environ.get("ANOTHER") == "value"
    finally:
        os.environ.pop("TEST_ENV_LOAD", None)
        os.environ.pop("ANOTHER", None)
        path.unlink()


def test_load_env_missing_file():
    count = _load_env(Path("/nonexistent/.env"))
    assert count == 0


# ---------------------------------------------------------------------------
# load_config
# ---------------------------------------------------------------------------

def test_load_config_from_file(monkeypatch):
    """Create a minimal config.json and verify load_config parses it."""
    monkeypatch.setenv("FABRIC_CLIENT_SECRET", "test-secret")

    cfg_data = {
        "fabric": {
            "tenant_id": "t-id",
            "client_id": "c-id",
            "client_secret": "${FABRIC_CLIENT_SECRET}",
            "workspace_data_id": "ws-data",
            "workspace_code_id": "ws-code",
        },
        "sql": {
            "server": "test-server,1433",
            "database": "test-db",
            "driver": "ODBC Driver 18 for SQL Server",
        },
        "engine": {
            "lz_lakehouse_id": "lz-id",
            "bronze_lakehouse_id": "br-id",
            "silver_lakehouse_id": "sv-id",
            "batch_size": "10",
        },
    }

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(cfg_data, f)
        f.flush()
        path = f.name

    try:
        cfg = load_config(path)
        assert cfg.tenant_id == "t-id"
        assert cfg.client_secret == "test-secret"
        assert cfg.sql_server == "test-server,1433"
        assert cfg.lz_lakehouse_id == "lz-id"
        assert cfg.batch_size == 10
    finally:
        Path(path).unlink()
