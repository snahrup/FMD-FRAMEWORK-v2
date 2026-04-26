"""Fabric authentication providers for one-click deployment.

The deployment API supports unattended service-principal auth today and exposes
delegated device-code auth when an Entra public-client app is configured.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


CONFIG_PATH = Path(__file__).parent / "config.json"
ENV_PATH = CONFIG_PATH.parent / ".env"
TOKEN_CACHE_PATH = CONFIG_PATH.parent / ".fabric_token_cache.json"

FABRIC_APP_SCOPE = "https://api.fabric.microsoft.com/.default"
FABRIC_DELEGATED_SCOPES = [
    "https://api.fabric.microsoft.com/Workspace.ReadWrite.All",
    "https://api.fabric.microsoft.com/Capacity.ReadWrite.All",
    "https://api.fabric.microsoft.com/Lakehouse.ReadWrite.All",
    "https://api.fabric.microsoft.com/Item.ReadWrite.All",
]
DISPLAY_SCOPES = [
    "Workspace.ReadWrite.All",
    "Capacity.ReadWrite.All",
    "Lakehouse.ReadWrite.All",
    "Item.ReadWrite.All",
]


class FabricAuthError(RuntimeError):
    pass


def _load_env(env_path: Path = ENV_PATH) -> None:
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def _resolve_env_vars(obj: Any) -> Any:
    if isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
        return os.environ.get(obj[2:-1], "")
    if isinstance(obj, dict):
        return {key: _resolve_env_vars(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [_resolve_env_vars(value) for value in obj]
    return obj


def load_config(config_path: Path = CONFIG_PATH) -> dict[str, Any]:
    _load_env(config_path.parent / ".env")
    if not config_path.exists():
        return {}
    try:
        return _resolve_env_vars(json.loads(config_path.read_text(encoding="utf-8")))
    except json.JSONDecodeError as exc:
        raise FabricAuthError(f"config.json is invalid JSON: {exc}") from exc


def _fabric_config(config_path: Path = CONFIG_PATH) -> dict[str, Any]:
    cfg = load_config(config_path)
    fabric = cfg.get("fabric", {}) if isinstance(cfg.get("fabric"), dict) else {}
    oauth = cfg.get("oauth", {}) if isinstance(cfg.get("oauth"), dict) else {}
    return {
        "tenant_id": os.environ.get("FABRIC_TENANT_ID") or fabric.get("tenant_id", ""),
        "client_id": os.environ.get("FABRIC_CLIENT_ID") or fabric.get("client_id", ""),
        "client_secret": os.environ.get("FABRIC_CLIENT_SECRET") or fabric.get("client_secret", ""),
        "oauth_client_id": os.environ.get("FABRIC_OAUTH_CLIENT_ID")
        or fabric.get("oauth_client_id", "")
        or oauth.get("fabric_client_id", ""),
    }


class ServicePrincipalFabricTokenProvider:
    mode = "service_principal"

    def __init__(self, config_path: Path = CONFIG_PATH) -> None:
        self.config_path = config_path

    def status(self) -> dict[str, Any]:
        cfg = _fabric_config(self.config_path)
        missing = [
            name
            for name, value in (
                ("tenant_id", cfg["tenant_id"]),
                ("client_id", cfg["client_id"]),
                ("client_secret", cfg["client_secret"]),
            )
            if not value
        ]
        if missing:
            return {
                "available": False,
                "reason": f"Missing Fabric service-principal setting(s): {', '.join(missing)}",
            }
        return {"available": True, "reason": "Fabric service-principal credentials configured"}

    def get_token(self) -> str:
        cfg = _fabric_config(self.config_path)
        status = self.status()
        if not status["available"]:
            raise FabricAuthError(status["reason"])
        body = urllib.parse.urlencode(
            {
                "grant_type": "client_credentials",
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "scope": FABRIC_APP_SCOPE,
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            f"https://login.microsoftonline.com/{cfg['tenant_id']}/oauth2/v2.0/token",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read())
                token = payload.get("access_token")
                if not token:
                    raise FabricAuthError("Fabric token response did not include an access token")
                return str(token)
        except FabricAuthError:
            raise
        except Exception as exc:
            raise FabricAuthError(f"Failed to acquire Fabric service-principal token: {exc}") from exc


class DelegatedOAuthFabricTokenProvider:
    mode = "delegated_oauth"

    def __init__(
        self,
        config_path: Path = CONFIG_PATH,
        cache_path: Path = TOKEN_CACHE_PATH,
        scopes: list[str] | None = None,
    ) -> None:
        self.config_path = config_path
        self.cache_path = cache_path
        self.scopes = scopes or FABRIC_DELEGATED_SCOPES

    def _config(self) -> dict[str, Any]:
        return _fabric_config(self.config_path)

    def _msal(self):
        try:
            import msal  # type: ignore
        except Exception as exc:
            raise FabricAuthError(f"MSAL is not installed in this dashboard runtime: {exc}") from exc
        return msal

    def status(self) -> dict[str, Any]:
        cfg = self._config()
        if not cfg["tenant_id"] or not cfg["oauth_client_id"]:
            return {
                "available": False,
                "reason": "Set FABRIC_TENANT_ID and FABRIC_OAUTH_CLIENT_ID to enable delegated OAuth",
            }
        try:
            self._msal()
        except FabricAuthError as exc:
            return {"available": False, "reason": str(exc)}
        return {"available": True, "reason": "Delegated Fabric OAuth client configured"}

    def _load_cache(self):
        msal = self._msal()
        cache = msal.SerializableTokenCache()
        if self.cache_path.exists():
            cache.deserialize(self.cache_path.read_text(encoding="utf-8"))
        return cache

    def _save_cache(self, cache) -> None:
        if getattr(cache, "has_state_changed", False):
            self.cache_path.write_text(cache.serialize(), encoding="utf-8")

    def _app(self):
        msal = self._msal()
        cfg = self._config()
        cache = self._load_cache()
        authority = f"https://login.microsoftonline.com/{cfg['tenant_id']}"
        app = msal.PublicClientApplication(
            cfg["oauth_client_id"],
            authority=authority,
            token_cache=cache,
        )
        return app, cache

    def start_device_flow(self) -> dict[str, Any]:
        status = self.status()
        if not status["available"]:
            raise FabricAuthError(status["reason"])
        app, _cache = self._app()
        flow = app.initiate_device_flow(scopes=self.scopes)
        if "user_code" not in flow:
            raise FabricAuthError(flow.get("error_description") or "Could not start Fabric OAuth device flow")
        return {
            "deviceCode": flow.get("device_code", ""),
            "userCode": flow.get("user_code", ""),
            "verificationUri": flow.get("verification_uri", ""),
            "message": flow.get("message", ""),
            "expiresIn": flow.get("expires_in"),
            "interval": flow.get("interval"),
            "_raw": flow,
        }

    def poll_device_flow(self, flow: dict[str, Any]) -> dict[str, Any]:
        app, cache = self._app()
        raw_flow = flow.get("_raw") if isinstance(flow.get("_raw"), dict) else flow
        result = app.acquire_token_by_device_flow(raw_flow)
        self._save_cache(cache)
        if "access_token" in result:
            return {"ok": True, "message": "Fabric delegated OAuth token acquired"}
        error = result.get("error") or "authorization_pending"
        return {"ok": False, "error": error, "message": result.get("error_description", error)}

    def get_token(self) -> str:
        status = self.status()
        if not status["available"]:
            raise FabricAuthError(status["reason"])
        app, cache = self._app()
        accounts = app.get_accounts()
        result = app.acquire_token_silent(self.scopes, account=accounts[0] if accounts else None)
        self._save_cache(cache)
        if not result or "access_token" not in result:
            raise FabricAuthError("Delegated Fabric token is not available; complete device-code sign-in first")
        return str(result["access_token"])


def get_auth_status(config_path: Path = CONFIG_PATH) -> dict[str, Any]:
    sp = ServicePrincipalFabricTokenProvider(config_path)
    delegated = DelegatedOAuthFabricTokenProvider(config_path)
    auth_modes = {
        "service_principal": sp.status(),
        "delegated_oauth": delegated.status(),
    }
    active = "service_principal" if auth_modes["service_principal"]["available"] else "delegated_oauth"
    if not auth_modes.get(active, {}).get("available"):
        active = "service_principal"
    return {
        "authModes": auth_modes,
        "activeMode": active,
        "scopes": DISPLAY_SCOPES,
    }


def get_deployment_token_provider(auth_mode: str, config_path: Path = CONFIG_PATH):
    if auth_mode == "delegated_oauth":
        return DelegatedOAuthFabricTokenProvider(config_path)
    if auth_mode == "service_principal":
        return ServicePrincipalFabricTokenProvider(config_path)
    raise FabricAuthError(f"Unsupported deployment auth mode: {auth_mode}")
