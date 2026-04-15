"""Admin, setup, deploy, and health routes.

Security fix: ADMIN_PASSWORD must be set AND non-empty. Empty string
no longer matches empty input (was a bypass vulnerability).
"""
import base64
import hashlib
import hmac
import os
import json
import logging
import secrets
import time

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.admin")
_ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60


def _queue_export(table: str):
    """Best-effort queue a Parquet export. No-op if pyarrow unavailable."""
    try:
        from dashboard.app.api.parquet_sync import queue_export
        queue_export(table)
    except (ImportError, Exception):
        log.debug("Parquet export queue unavailable for table %s", table)

# Ensure admin_config table exists. control_plane_db.init_db() does not create
# it, so we create it here on first import. CREATE IF NOT EXISTS is idempotent.
db.execute("""
    CREATE TABLE IF NOT EXISTS admin_config (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
""")


def _session_signing_key(admin_pw: str) -> bytes:
    extra = os.environ.get("ADMIN_SESSION_SECRET", "")
    material = f"{admin_pw}:{extra}" if extra else admin_pw
    return material.encode("utf-8")


def _sign_admin_session(payload: str, admin_pw: str) -> str:
    digest = hmac.new(
        _session_signing_key(admin_pw),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _issue_admin_session(admin_pw: str) -> tuple[str, int]:
    issued_at = int(time.time())
    expires_at = issued_at + _ADMIN_SESSION_TTL_SECONDS
    nonce = secrets.token_hex(8)
    payload = f"{issued_at}:{expires_at}:{nonce}"
    signature = _sign_admin_session(payload, admin_pw)
    return f"{payload}.{signature}", expires_at


def _validate_admin_session(token: str) -> bool:
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")
    if not admin_pw or not token:
        return False
    try:
        payload, signature = token.rsplit(".", 1)
        _issued_at, expires_at_raw, _nonce = payload.split(":", 2)
        expires_at = int(expires_at_raw)
    except (ValueError, AttributeError):
        return False
    if expires_at < int(time.time()):
        return False
    expected = _sign_admin_session(payload, admin_pw)
    return hmac.compare_digest(signature, expected)


def _check_admin_password(params: dict):
    """Validate admin password or active session. Raises HttpError(403) on failure."""
    session_token = params.get("session_token", "")
    if session_token and _validate_admin_session(session_token):
        return

    password = params.get("password", "")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")
    if not admin_pw or password != admin_pw:
        raise HttpError("Forbidden", 403)


@route("GET", "/api/health")
def get_health(params):
    return {"status": "ok", "db": str(db.DB_PATH)}


@route("POST", "/api/admin/auth")
def post_admin_auth(params):
    """Verify admin password."""
    _check_admin_password(params)
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")
    session_token, expires_at = _issue_admin_session(admin_pw)
    return {
        "ok": True,
        "authenticated": True,
        "sessionToken": session_token,
        "expiresAt": expires_at,
    }


@route("POST", "/api/admin/config")
def post_admin_config(params):
    _check_admin_password(params)
    # Support both {key, value} and {hiddenPages} shapes
    if "hiddenPages" in params:
        db.execute(
            "INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)",
            ("hiddenPages", json.dumps(params["hiddenPages"])),
        )
        return {"ok": True, "key": "hiddenPages"}
    key = params.get("key", "")
    value = params.get("value", "")
    if not key:
        raise HttpError("key is required", 400)
    if len(key) > 128:
        raise HttpError("key must be 128 characters or fewer", 400)
    if len(str(value)) > 65536:
        raise HttpError("value too large", 400)
    db.execute(
        "INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)",
        (key, value),
    )
    return {"ok": True, "key": key}


@route("GET", "/api/admin/config")
def get_admin_config(params):
    rows = db.query("SELECT key, value FROM admin_config")
    result = {}
    for r in rows:
        key, val = r["key"], r["value"]
        # JSON-stored values (e.g. hiddenPages) must be parsed back so the
        # frontend receives an actual array/object, not a JSON string.
        if val and val.startswith(("[", "{")):
            try:
                val = json.loads(val)
            except (json.JSONDecodeError, TypeError):
                pass  # intentionally suppressed: keep raw string if JSON parse fails
        result[key] = val
    return result


# ---------------------------------------------------------------------------
# Fabric entity discovery (read from local SQLite mirror)
# ---------------------------------------------------------------------------

@route("GET", "/api/fabric/workspaces")
def get_fabric_workspaces(params):
    """Return workspaces in the shape FabricDropdown expects: {id, displayName}."""
    rows = db.query("SELECT WorkspaceGuid, Name FROM workspaces ORDER BY Name")
    return {
        "workspaces": [
            {"id": r["WorkspaceGuid"], "displayName": r["Name"]}
            for r in rows
            if r.get("WorkspaceGuid")
        ]
    }


@route("GET", "/api/fabric/connections")
def get_fabric_connections(params):
    """Return connections in the shape FabricDropdown expects: {id, displayName, type}."""
    rows = db.query(
        "SELECT ConnectionGuid, Name, Type FROM connections ORDER BY Name"
    )
    return {
        "connections": [
            {
                "id": r["ConnectionGuid"],
                "displayName": r["Name"],
                "type": r.get("Type", ""),
            }
            for r in rows
            if r.get("ConnectionGuid")
        ]
    }


@route("GET", "/api/fabric/security-groups")
def get_fabric_security_groups(params):
    """Security groups are not stored locally; return empty list.

    The frontend gracefully handles an empty array — dropdowns simply
    show no options and the field can be skipped.
    """
    return {"groups": []}


# ---------------------------------------------------------------------------
# Setup / environment configuration
# ---------------------------------------------------------------------------

@route("GET", "/api/setup/current-config")
def get_setup_current_config(params):
    """Return the current environment config from config.json + DB."""
    config_path = os.path.join(os.path.dirname(__file__), "..", "config.json")
    try:
        with open(config_path, "r") as f:
            raw = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        raw = {}

    fabric = raw.get("fabric", {})
    engine = raw.get("engine", {})
    sql = raw.get("sql", {})

    workspace_rows = db.query("SELECT WorkspaceGuid, Name FROM workspaces")
    workspace_name_by_guid = {
        (row.get("WorkspaceGuid") or "").lower(): row.get("Name", "")
        for row in workspace_rows
        if row.get("WorkspaceGuid")
    }
    connection_rows = db.query("SELECT Name, ConnectionGuid, Type FROM connections")
    connection_by_guid = {
        (row.get("ConnectionGuid") or "").lower(): row
        for row in connection_rows
        if row.get("ConnectionGuid")
    }

    # Map config.json into the EnvironmentConfig shape the frontend expects
    def _ws(ws_id, name=""):
        if not ws_id:
            return None
        display_name = workspace_name_by_guid.get(str(ws_id).lower(), name)
        return {"id": ws_id, "displayName": display_name or name}

    def _lh(lh_id, name="", ws_id=""):
        if not lh_id:
            return None
        return {"id": lh_id, "displayName": name, "workspaceGuid": ws_id}

    data_ws = fabric.get("workspace_data_id", "")
    code_ws = fabric.get("workspace_code_id", "")
    config_ws = fabric.get("workspace_config_id", "")
    data_prod_ws = fabric.get("workspace_data_prod_id", "")
    code_prod_ws = fabric.get("workspace_code_prod_id", "")

    configured_connection_ids = fabric.get("connection_ids", {}) or {}
    connection_keys = (
        "CON_FMD_FABRIC_SQL",
        "CON_FMD_FABRIC_PIPELINES",
        "CON_FMD_ADF_PIPELINES",
        "CON_FMD_FABRIC_NOTEBOOKS",
    )
    connections = {}
    for key in connection_keys:
        guid = configured_connection_ids.get(key, "")
        row = connection_by_guid.get(str(guid).lower())
        if row:
            connections[key] = {
                "id": row.get("ConnectionGuid", ""),
                "displayName": row.get("Name", key),
                "type": row.get("Type", ""),
            }
        else:
            name_match = next((r for r in connection_rows if r.get("Name") == key), None)
            connections[key] = (
                {
                    "id": name_match.get("ConnectionGuid", ""),
                    "displayName": name_match.get("Name", key),
                    "type": name_match.get("Type", ""),
                }
                if name_match and name_match.get("ConnectionGuid")
                else None
            )

    database = None
    if fabric.get("sql_database_id") or sql.get("database"):
        database = {
            "id": fabric.get("sql_database_id", ""),
            "displayName": fabric.get("sql_database_name") or "SQL_INTEGRATION_FRAMEWORK",
            "serverFqdn": sql.get("server", ""),
            "databaseName": sql.get("database", ""),
        }

    config = {
        "capacity": {
            "id": fabric.get("capacity_id", ""),
            "displayName": fabric.get("capacity_name") or "Configured Capacity",
            "sku": "",
            "state": "Active",
        }
        if fabric.get("capacity_id")
        else None,
        "workspaces": {
            "data_dev": _ws(data_ws, "INTEGRATION DATA (D)"),
            "code_dev": _ws(code_ws, "INTEGRATION CODE (D)"),
            "config": _ws(config_ws, "INTEGRATION CONFIG"),
            "data_prod": _ws(data_prod_ws, "INTEGRATION DATA (P)"),
            "code_prod": _ws(code_prod_ws, "INTEGRATION CODE (P)"),
        },
        "lakehouses": {
            "LH_DATA_LANDINGZONE": _lh(engine.get("lz_lakehouse_id"), "LH_DATA_LANDINGZONE", data_ws),
            "LH_BRONZE_LAYER": _lh(engine.get("bronze_lakehouse_id"), "LH_BRONZE_LAYER", data_ws),
            "LH_SILVER_LAYER": _lh(engine.get("silver_lakehouse_id"), "LH_SILVER_LAYER", data_ws),
        },
        "connections": connections,
        "notebooks": {
            "NB_FMD_LOAD_LANDING_BRONZE": _ws(engine.get("notebook_bronze_id"), "NB_FMD_LOAD_LANDING_BRONZE"),
            "NB_FMD_LOAD_BRONZE_SILVER": _ws(engine.get("notebook_silver_id"), "NB_FMD_LOAD_BRONZE_SILVER"),
        },
        "pipelines": {
            "PL_FMD_LDZ_COPY_SQL": _ws(engine.get("pipeline_copy_sql_id"), "PL_FMD_LDZ_COPY_SQL"),
        },
        "database": database,
    }

    return {"config": config}
