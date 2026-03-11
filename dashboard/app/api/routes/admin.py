"""Admin, setup, deploy, and health routes.

Security fix: ADMIN_PASSWORD must be set AND non-empty. Empty string
no longer matches empty input (was a bypass vulnerability).
"""
import os
import logging

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.admin")

# Ensure admin_config table exists. control_plane_db.init_db() does not create
# it, so we create it here on first import. CREATE IF NOT EXISTS is idempotent.
db.execute("""
    CREATE TABLE IF NOT EXISTS admin_config (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
""")


def _check_admin_password(params: dict):
    """Validate admin password. Raises HttpError(403) on failure."""
    password = params.get("password", "")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")
    if not admin_pw or password != admin_pw:
        raise HttpError("Forbidden", 403)


@route("GET", "/api/health")
def get_health(params):
    return {"status": "ok", "db": str(db.DB_PATH)}


@route("POST", "/api/admin/config")
def post_admin_config(params):
    _check_admin_password(params)
    key = params.get("key", "")
    value = params.get("value", "")
    if not key:
        raise HttpError("key is required", 400)
    db.execute(
        "INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)",
        (key, value),
    )
    return {"ok": True, "key": key}


@route("GET", "/api/admin/config")
def get_admin_config(params):
    rows = db.query("SELECT key, value FROM admin_config")
    return {r["key"]: r["value"] for r in rows}
