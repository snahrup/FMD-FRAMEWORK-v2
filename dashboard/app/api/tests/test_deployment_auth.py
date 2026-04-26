from __future__ import annotations

import json

from dashboard.app.api.deployment_auth import (
    DelegatedOAuthFabricTokenProvider,
    ServicePrincipalFabricTokenProvider,
    get_auth_status,
)


def _write_config(path, fabric):
    path.write_text(json.dumps({"fabric": fabric}), encoding="utf-8")


def test_service_principal_unavailable_without_secret(tmp_path, monkeypatch):
    monkeypatch.delenv("FABRIC_CLIENT_SECRET", raising=False)
    config_path = tmp_path / "config.json"
    _write_config(config_path, {"tenant_id": "tenant", "client_id": "client", "client_secret": ""})

    status = ServicePrincipalFabricTokenProvider(config_path).status()

    assert status["available"] is False
    assert "client_secret" in status["reason"]


def test_service_principal_available_with_secret(tmp_path, monkeypatch):
    monkeypatch.delenv("FABRIC_CLIENT_SECRET", raising=False)
    config_path = tmp_path / "config.json"
    _write_config(config_path, {"tenant_id": "tenant", "client_id": "client", "client_secret": "secret"})

    status = ServicePrincipalFabricTokenProvider(config_path).status()

    assert status["available"] is True


def test_delegated_oauth_unavailable_without_client_id(tmp_path, monkeypatch):
    monkeypatch.delenv("FABRIC_OAUTH_CLIENT_ID", raising=False)
    config_path = tmp_path / "config.json"
    _write_config(config_path, {"tenant_id": "tenant"})

    status = DelegatedOAuthFabricTokenProvider(config_path).status()

    assert status["available"] is False
    assert "FABRIC_OAUTH_CLIENT_ID" in status["reason"]


def test_auth_status_never_returns_token_material(tmp_path, monkeypatch):
    monkeypatch.delenv("FABRIC_CLIENT_SECRET", raising=False)
    config_path = tmp_path / "config.json"
    _write_config(config_path, {"tenant_id": "tenant", "client_id": "client", "client_secret": "secret"})

    status = get_auth_status(config_path)

    serialized = json.dumps(status)
    assert "secret" not in serialized
    assert "access_token" not in serialized
