"""Unit tests for engine/auth.py — no network required.

Tests cover:
  - Token caching and expiry logic
  - SQL token struct format
  - API headers format
  - validate() success and failure paths
  - _OneLakeCredential adapter
  - Scope constants
"""

import struct
import time
from unittest.mock import MagicMock, patch
import pytest

from engine.auth import (
    TokenProvider,
    _OneLakeCredential,
    AccessToken,
    SCOPE_FABRIC_SQL,
    SCOPE_FABRIC_API,
    SCOPE_ONELAKE,
)
from engine.models import EngineConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_config() -> EngineConfig:
    return EngineConfig(
        sql_server="test-server", sql_database="test-db",
        sql_driver="ODBC Driver 18", tenant_id="test-tenant",
        client_id="test-client", client_secret="test-secret",
        workspace_data_id="wd", workspace_code_id="wc",
        lz_lakehouse_id="lz", bronze_lakehouse_id="br", silver_lakehouse_id="sv",
    )


def _mock_token_response(token="fake-token", expires_in=3600):
    """Create a mock urllib response for token acquisition."""
    import json
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps({
        "access_token": token,
        "expires_in": expires_in,
        "token_type": "Bearer",
    }).encode()
    return mock_resp


# ---------------------------------------------------------------------------
# Scope constants
# ---------------------------------------------------------------------------

class TestScopeConstants:
    def test_fabric_sql_scope(self):
        assert "analysis.windows.net" in SCOPE_FABRIC_SQL
        assert "powerbi" in SCOPE_FABRIC_SQL
        # CRITICAL: Must NOT be database.windows.net
        assert "database.windows.net" not in SCOPE_FABRIC_SQL

    def test_fabric_api_scope(self):
        assert "api.fabric.microsoft.com" in SCOPE_FABRIC_API

    def test_onelake_scope(self):
        assert "storage.azure.com" in SCOPE_ONELAKE


# ---------------------------------------------------------------------------
# AccessToken namedtuple
# ---------------------------------------------------------------------------

class TestAccessToken:
    def test_has_required_fields(self):
        at = AccessToken(token="abc", expires_on=12345)
        assert at.token == "abc"
        assert at.expires_on == 12345

    def test_is_named_tuple(self):
        at = AccessToken("tok", 999)
        assert at[0] == "tok"
        assert at[1] == 999


# ---------------------------------------------------------------------------
# TokenProvider
# ---------------------------------------------------------------------------

class TestTokenProvider:
    def test_get_token_fetches_from_api(self):
        config = _make_config()
        tp = TokenProvider(config)
        with patch("engine.auth.urllib.request.urlopen", return_value=_mock_token_response("my-token")):
            token = tp.get_token(SCOPE_FABRIC_SQL)
        assert token == "my-token"

    def test_get_token_caches_result(self):
        config = _make_config()
        tp = TokenProvider(config)
        mock_urlopen = MagicMock(return_value=_mock_token_response("cached-token"))
        with patch("engine.auth.urllib.request.urlopen", mock_urlopen):
            t1 = tp.get_token(SCOPE_FABRIC_SQL)
            t2 = tp.get_token(SCOPE_FABRIC_SQL)
        # Should only call the API once
        assert mock_urlopen.call_count == 1
        assert t1 == t2 == "cached-token"

    def test_get_token_different_scopes_are_independent(self):
        config = _make_config()
        tp = TokenProvider(config)
        call_count = 0

        def mock_urlopen(req, **kwargs):
            nonlocal call_count
            call_count += 1
            return _mock_token_response(f"token-{call_count}")

        with patch("engine.auth.urllib.request.urlopen", side_effect=mock_urlopen):
            sql_token = tp.get_token(SCOPE_FABRIC_SQL)
            api_token = tp.get_token(SCOPE_FABRIC_API)
        assert sql_token != api_token
        assert call_count == 2

    def test_get_sql_token_struct_format(self):
        config = _make_config()
        tp = TokenProvider(config)
        with patch("engine.auth.urllib.request.urlopen", return_value=_mock_token_response("test")):
            result = tp.get_sql_token_struct()

        # Verify it's bytes
        assert isinstance(result, bytes)
        # Verify struct format: <I{n}s  (4-byte length prefix + UTF-16-LE token)
        token_bytes = "test".encode("UTF-16-LE")
        expected = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
        assert result == expected

    def test_get_api_headers(self):
        config = _make_config()
        tp = TokenProvider(config)
        with patch("engine.auth.urllib.request.urlopen", return_value=_mock_token_response("bearer-tok")):
            headers = tp.get_api_headers()
        assert headers["Authorization"] == "Bearer bearer-tok"
        assert headers["Content-Type"] == "application/json"

    def test_validate_all_scopes_pass(self):
        config = _make_config()
        tp = TokenProvider(config)
        with patch("engine.auth.urllib.request.urlopen", return_value=_mock_token_response()):
            result = tp.validate()
        assert result == {"fabric_sql": True, "fabric_api": True, "onelake": True}

    def test_validate_some_scopes_fail(self):
        config = _make_config()
        tp = TokenProvider(config)

        call_count = 0
        def mock_urlopen(req, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise RuntimeError("API scope failed")
            return _mock_token_response()

        with patch("engine.auth.urllib.request.urlopen", side_effect=mock_urlopen):
            result = tp.validate()
        assert result["fabric_sql"] is True
        assert result["fabric_api"] is False
        assert result["onelake"] is True

    def test_validate_all_fail(self):
        config = _make_config()
        tp = TokenProvider(config)
        with patch("engine.auth.urllib.request.urlopen", side_effect=RuntimeError("no network")):
            result = tp.validate()
        assert result == {"fabric_sql": False, "fabric_api": False, "onelake": False}


# ---------------------------------------------------------------------------
# _OneLakeCredential
# ---------------------------------------------------------------------------

class TestOneLakeCredential:
    def test_get_token_returns_access_token(self):
        config = _make_config()
        tp = TokenProvider(config)
        with patch("engine.auth.urllib.request.urlopen", return_value=_mock_token_response("onelake-tok")):
            cred = _OneLakeCredential(tp)
            at = cred.get_token(SCOPE_ONELAKE)
        assert isinstance(at, AccessToken)
        assert at.token == "onelake-tok"
        assert at.expires_on > 0

    def test_get_token_default_scope(self):
        config = _make_config()
        tp = TokenProvider(config)
        with patch("engine.auth.urllib.request.urlopen", return_value=_mock_token_response("default-tok")):
            cred = _OneLakeCredential(tp)
            at = cred.get_token()  # no scope = default to ONELAKE
        assert at.token == "default-tok"

    def test_validate_method_exists(self):
        config = _make_config()
        tp = TokenProvider(config)
        cred = _OneLakeCredential(tp)
        with patch("engine.auth.urllib.request.urlopen", return_value=_mock_token_response()):
            result = cred.validate()
        assert "fabric_sql" in result
        assert "fabric_api" in result
        assert "onelake" in result
