"""
FMD v3 Engine — Authentication.

Three token scopes, one Service Principal:
  1. Fabric SQL DB   — scope: https://analysis.windows.net/powerbi/api/.default
     CRITICAL: Fabric SQL endpoints require the Power BI API scope, NOT
     the generic database.windows.net scope.  This was a hard-won lesson.
  2. Fabric REST API — scope: https://api.fabric.microsoft.com/.default
  3. OneLake (ADLS)  — scope: https://storage.azure.com/.default

All tokens acquired via stdlib urllib (no azure-identity dependency).
The ADLS SDK just needs an object with get_token(scopes) — we provide a
lightweight wrapper that uses our existing SP token acquisition.

Tokens are cached per scope with thread-safe refresh.
"""

import json
import logging
import struct
import threading

log = logging.getLogger("fmd.auth")
import urllib.parse
import urllib.request
from collections import namedtuple
from datetime import datetime
from typing import Optional

from engine.models import EngineConfig

# azure-storage-file-datalake expects get_token() to return a named tuple
# with .token and .expires_on fields — this matches azure.core.credentials.AccessToken
AccessToken = namedtuple("AccessToken", ["token", "expires_on"])

# Token scope constants
# CRITICAL: Fabric SQL DB requires the Power BI API scope — NOT database.windows.net
# See: MEMORY.md "Fabric SQL Metadata DB" section
SCOPE_FABRIC_SQL = "https://analysis.windows.net/powerbi/api/.default"
SCOPE_FABRIC_API = "https://api.fabric.microsoft.com/.default"
SCOPE_ONELAKE = "https://storage.azure.com/.default"


class TokenProvider:
    """Thread-safe OAuth2 token cache for a single Service Principal.

    Usage:
        tp = TokenProvider(config)
        token = tp.get_token(SCOPE_FABRIC_SQL)
        struct_bytes = tp.get_sql_token_struct()   # for pyodbc attrs_before
    """

    def __init__(self, config: EngineConfig):
        self._tenant_id = config.tenant_id
        self._client_id = config.client_id
        self._client_secret = config.client_secret
        self._cache: dict[str, dict] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def get_token(self, scope: str) -> str:
        """Return a valid access token for the given scope (cached)."""
        with self._lock:
            cached = self._cache.get(scope)
            if cached and cached["expires"] > datetime.now().timestamp():
                return cached["token"]

        # Token expired or not cached — fetch fresh
        token_url = (
            f"https://login.microsoftonline.com/{self._tenant_id}/oauth2/v2.0/token"
        )
        data = urllib.parse.urlencode({
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "scope": scope,
            "grant_type": "client_credentials",
        }).encode()

        req = urllib.request.Request(
            token_url,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())

        access_token: str = result["access_token"]
        expires_in: int = result.get("expires_in", 3600)

        with self._lock:
            self._cache[scope] = {
                "token": access_token,
                "expires": datetime.now().timestamp() + expires_in - 60,
            }

        return access_token

    def get_sql_token_struct(self) -> bytes:
        """Return the pyodbc attrs_before token struct for Fabric SQL DB.

        This is the specific binary format that pyodbc needs:
            struct.pack('<I{n}s', len(token_bytes), token_bytes)
        where token_bytes is the access token encoded as UTF-16-LE.
        """
        token = self.get_token(SCOPE_FABRIC_SQL)
        token_bytes = token.encode("UTF-16-LE")
        return struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

    def get_api_headers(self) -> dict[str, str]:
        """Return Authorization headers for Fabric REST API calls."""
        token = self.get_token(SCOPE_FABRIC_API)
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def validate(self) -> dict[str, bool]:
        """Quick check — can we get tokens for all three scopes?

        Returns a dict like:
            {"fabric_sql": True, "fabric_api": True, "onelake": True}
        Failures return False with the error swallowed (logged elsewhere).
        """
        results: dict[str, bool] = {}
        for label, scope in [
            ("fabric_sql", SCOPE_FABRIC_SQL),
            ("fabric_api", SCOPE_FABRIC_API),
            ("onelake", SCOPE_ONELAKE),
        ]:
            try:
                self.get_token(scope)
                results[label] = True
            except Exception as e:
                log.warning("Token validation failed for %s: %s", label, e)
                results[label] = False
        return results

    def get_datalake_credential(self) -> "_OneLakeCredential":
        """Return a credential object for azure-storage-file-datalake.

        The ADLS SDK expects any object with a get_token(*scopes) method
        that returns an AccessToken(token, expires_on).  We implement this
        using our existing SP token acquisition — no azure-identity needed.
        """
        return _OneLakeCredential(self)


class _OneLakeCredential:
    """Lightweight credential adapter for azure-storage-file-datalake.

    Implements the TokenCredential protocol expected by the Azure SDK:
        credential.get_token(*scopes) -> AccessToken(token, expires_on)

    Uses TokenProvider's cached SP token under the hood — zero extra deps.
    """

    def __init__(self, provider: TokenProvider):
        self._provider = provider

    def get_token(self, *scopes, **kwargs):
        """Return an AccessToken for the requested scope."""
        scope = scopes[0] if scopes else SCOPE_ONELAKE
        token = self._provider.get_token(scope)
        # expires_on: the SDK wants a Unix timestamp
        cached = self._provider._cache.get(scope, {})
        expires_on = int(cached.get("expires", datetime.now().timestamp() + 3500))
        return AccessToken(token=token, expires_on=expires_on)

    def validate(self) -> dict[str, bool]:
        """Quick check — can we get tokens for all three scopes?

        Returns a dict like:
            {"fabric_sql": True, "fabric_api": True, "onelake": True}
        Failures return False with the error swallowed (logged elsewhere).
        """
        results: dict[str, bool] = {}
        for label, scope in [
            ("fabric_sql", SCOPE_FABRIC_SQL),
            ("fabric_api", SCOPE_FABRIC_API),
            ("onelake", SCOPE_ONELAKE),
        ]:
            try:
                self.get_token(scope)
                results[label] = True
            except Exception as e:
                log.warning("Token validation failed for %s: %s", label, e)
                results[label] = False
        return results
