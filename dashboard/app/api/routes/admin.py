"""Admin, setup, deploy, and health routes.

Security fix: ADMIN_PASSWORD must be set AND non-empty. Empty string
no longer matches empty input (was a bypass vulnerability).
"""
import os
import json
import logging

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.admin")


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


def _check_admin_password(params: dict):
    """Validate admin password. Raises HttpError(403) on failure."""
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
    return {"ok": True, "authenticated": True}


@route("POST", "/api/admin/config")
def post_admin_config(params):
    _check_admin_password(params)
    # Support both {key, value} and {hiddenPages} shapes
    if "hiddenPages" in params:
        import json as _json
        db.execute(
            "INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)",
            ("hiddenPages", _json.dumps(params["hiddenPages"])),
        )
        return {"ok": True, "key": "hiddenPages"}
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

    # Map config.json into the EnvironmentConfig shape the frontend expects
    def _ws(ws_id, name=""):
        return {"id": ws_id, "displayName": name} if ws_id else None

    def _lh(lh_id, name="", ws_id=""):
        if not lh_id:
            return None
        return {"id": lh_id, "displayName": name, "workspaceGuid": ws_id}

    data_ws = fabric.get("workspace_data_id", "")
    code_ws = fabric.get("workspace_code_id", "")

    # Try to get connection info from DB
    # The connections table uses "Name" (not "ConnectionName") per the schema.
    connections = {}
    try:
        rows = db.query("SELECT Name, ConnectionGuid FROM connections")
        for r in rows:
            name = r.get("Name", "")
            guid = r.get("ConnectionGuid", "")
            if name and guid:
                connections[name] = {"id": guid, "displayName": name}
    except Exception as e:
        log.warning("Failed to load connections for admin gateway: %s", e)

    config = {
        "workspaces": {
            "data_dev": _ws(data_ws, "INTEGRATION DATA (D)"),
            "code_dev": _ws(code_ws, "INTEGRATION CODE (D)"),
            "config": None,
            "data_prod": None,
            "code_prod": None,
        },
        "lakehouses": {
            "LH_DATA_LANDINGZONE": _lh(engine.get("lz_lakehouse_id"), "LH_DATA_LANDINGZONE", data_ws),
            "LH_BRONZE_LAYER": _lh(engine.get("bronze_lakehouse_id"), "LH_BRONZE_LAYER", data_ws),
            "LH_SILVER_LAYER": _lh(engine.get("silver_lakehouse_id"), "LH_SILVER_LAYER", data_ws),
        },
        "connections": connections or {
            "CON_FMD_FABRIC_SQL": None,
            "CON_FMD_FABRIC_PIPELINES": None,
            "CON_FMD_ADF_PIPELINES": None,
            "CON_FMD_FABRIC_NOTEBOOKS": None,
        },
        "notebooks": {
            "NB_FMD_LOAD_LANDING_BRONZE": _ws(engine.get("notebook_bronze_id"), "NB_FMD_LOAD_LANDING_BRONZE"),
            "NB_FMD_LOAD_BRONZE_SILVER": _ws(engine.get("notebook_silver_id"), "NB_FMD_LOAD_BRONZE_SILVER"),
        },
        "pipelines": {
            "PL_FMD_LDZ_COPY_SQL": _ws(engine.get("pipeline_copy_sql_id"), "PL_FMD_LDZ_COPY_SQL"),
        },
        "database": None,
    }

    return {"config": config}
