"""
Centralized credentials loader for FMD Framework scripts.

Reads secrets from environment variables, falling back to .env files.
NEVER import secrets directly — always use this module.

Usage:
    from _credentials import get_fabric_secret, get_jira_token, get_miro_token
    # or for full SP config:
    from _credentials import TENANT_ID, CLIENT_ID, get_fabric_secret
"""

import os

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_SCRIPT_DIR)


def _load_env_file():
    """Load .env from repo root and dashboard/app/api/.env into a dict."""
    env_vals = {}
    for env_path in [
        os.path.join(_REPO_ROOT, ".env"),
        os.path.join(_REPO_ROOT, "dashboard", "app", "api", ".env"),
    ]:
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, val = line.split("=", 1)
                        env_vals[key.strip()] = val.strip()
    return env_vals


_env_cache = None


def _get_env(key):
    """Get a value from env vars, falling back to .env files."""
    val = os.environ.get(key)
    if val:
        return val
    global _env_cache
    if _env_cache is None:
        _env_cache = _load_env_file()
    return _env_cache.get(key)


# ── Azure AD / Fabric Service Principal ──────────────────────────────────────
# Tenant and Client IDs are NOT secrets (they're project configuration GUIDs).
TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"


def get_fabric_secret():
    """Get the Azure AD client secret for the Fabric service principal."""
    val = _get_env("FABRIC_CLIENT_SECRET")
    if not val:
        raise RuntimeError(
            "FABRIC_CLIENT_SECRET not found. Set it as an environment variable "
            "or add it to .env in the repo root."
        )
    return val


# ── Jira ─────────────────────────────────────────────────────────────────────
JIRA_USER = "snahrup@ip-corporation.com"


def get_jira_token():
    """Get the Jira API token."""
    val = _get_env("JIRA_API_TOKEN")
    if not val:
        raise RuntimeError(
            "JIRA_API_TOKEN not found. Set it as an environment variable "
            "or add it to .env in the repo root."
        )
    return val


# ── Miro ─────────────────────────────────────────────────────────────────────
def get_miro_token():
    """Get the Miro API token."""
    val = _get_env("MIRO_API_TOKEN")
    if not val:
        raise RuntimeError(
            "MIRO_API_TOKEN not found. Set it as an environment variable "
            "or add it to .env in the repo root."
        )
    return val
