"""Environment setup routes backed by live Fabric REST APIs."""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from dashboard.app.api import db
from dashboard.app.api.router import HttpError, route

log = logging.getLogger("fmd.routes.setup")

_CONFIG_PATH = Path(__file__).parent.parent / "config.json"
_ENV_PATH = _CONFIG_PATH.parent / ".env"
_FABRIC_API = "https://api.fabric.microsoft.com/v1"

_WORKSPACE_NAMES = {
    "data_dev": "INTEGRATION DATA (D)",
    "code_dev": "INTEGRATION CODE (D)",
    "config": "INTEGRATION CONFIG",
    "data_prod": "INTEGRATION DATA (P)",
    "code_prod": "INTEGRATION CODE (P)",
}

_LAKEHOUSE_NAMES = {
    "LH_DATA_LANDINGZONE": "LH_DATA_LANDINGZONE",
    "LH_BRONZE_LAYER": "LH_BRONZE_LAYER",
    "LH_SILVER_LAYER": "LH_SILVER_LAYER",
}

_NOTEBOOK_NAMES = {
    "NB_FMD_LOAD_LANDING_BRONZE": "NB_FMD_LOAD_LANDING_BRONZE",
    "NB_FMD_LOAD_BRONZE_SILVER": "NB_FMD_LOAD_BRONZE_SILVER",
}

_PIPELINE_NAMES = {
    "PL_FMD_LDZ_COPY_SQL": "PL_FMD_LDZ_COPY_SQL",
}

_CONNECTION_KEYS = (
    "CON_FMD_FABRIC_SQL",
    "CON_FMD_FABRIC_PIPELINES",
    "CON_FMD_ADF_PIPELINES",
    "CON_FMD_FABRIC_NOTEBOOKS",
)


def _load_env() -> None:
    if not _ENV_PATH.exists():
        return
    for line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
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


def _load_raw_config() -> dict[str, Any]:
    if not _CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HttpError(f"config.json is invalid JSON: {exc}", 500) from exc


def _load_resolved_config() -> dict[str, Any]:
    _load_env()
    return _resolve_env_vars(_load_raw_config())


def _write_raw_config(config: dict[str, Any]) -> None:
    _CONFIG_PATH.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def _error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        if isinstance(payload.get("message"), str) and payload["message"]:
            return payload["message"]
        if isinstance(payload.get("error"), str) and payload["error"]:
            return payload["error"]
        if isinstance(payload.get("errorCode"), str) and payload["errorCode"]:
            return payload["errorCode"]
        if isinstance(payload.get("message"), dict):
            return json.dumps(payload["message"])
    if isinstance(payload, str) and payload:
        return payload
    return fallback


def _fabric_request(
    method: str,
    url: str,
    *,
    token: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 30,
) -> tuple[int, Any, dict[str, str]]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Authorization": f"Bearer {token}"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            parsed = json.loads(raw) if raw else {}
            return resp.status, parsed, dict(resp.headers.items())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed: Any = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = raw
        return exc.code, parsed, dict(exc.headers.items())


def _get_fabric_token() -> str:
    cfg = _load_resolved_config()
    fabric = cfg.get("fabric", {})
    tenant = fabric.get("tenant_id", "")
    client_id = fabric.get("client_id", "")
    client_secret = fabric.get("client_secret", "")
    if not tenant or not client_id or not client_secret:
        raise HttpError("Fabric service principal credentials are incomplete", 503)
    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://api.fabric.microsoft.com/.default",
        }
    ).encode()
    req = urllib.request.Request(
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())["access_token"]
    except Exception as exc:
        raise HttpError(f"Failed to acquire Fabric token: {exc}", 503) from exc


def _poll_operation(location: str, *, token: str, timeout_seconds: int = 300) -> None:
    deadline = time.time() + timeout_seconds
    sleep_seconds = 5
    while time.time() < deadline:
        status, payload, headers = _fabric_request("GET", location, token=token, timeout=30)
        if status == 202:
            sleep_seconds = int(headers.get("Retry-After") or sleep_seconds)
            time.sleep(max(1, min(sleep_seconds, 30)))
            continue
        if status >= 400:
            raise HttpError(_error_message(payload, "Fabric operation failed"), 502)
        op_status = str((payload or {}).get("status", "")).lower()
        if not op_status or op_status in {"succeeded", "completed"}:
            return
        if op_status in {"failed", "cancelled", "canceled"}:
            raise HttpError(_error_message(payload, "Fabric operation failed"), 502)
        sleep_seconds = int(headers.get("Retry-After") or sleep_seconds)
        time.sleep(max(1, min(sleep_seconds, 30)))
    raise HttpError("Timed out waiting for Fabric operation to complete", 504)


def _list_workspaces_live(token: str) -> list[dict[str, Any]]:
    status, payload, _ = _fabric_request("GET", f"{_FABRIC_API}/workspaces", token=token, timeout=30)
    if status >= 400:
        raise HttpError(_error_message(payload, "Failed to list Fabric workspaces"), 502)
    return list((payload or {}).get("value", []))


def _list_capacities_live(token: str) -> list[dict[str, Any]]:
    status, payload, _ = _fabric_request("GET", f"{_FABRIC_API}/capacities", token=token, timeout=30)
    if status >= 400:
        raise HttpError(_error_message(payload, "Failed to list Fabric capacities"), 502)
    return list((payload or {}).get("value", []))


def _list_lakehouses_live(workspace_id: str, token: str) -> list[dict[str, Any]]:
    status, payload, _ = _fabric_request(
        "GET",
        f"{_FABRIC_API}/workspaces/{workspace_id}/lakehouses",
        token=token,
        timeout=30,
    )
    if status >= 400:
        raise HttpError(_error_message(payload, "Failed to list lakehouses"), 502)
    return list((payload or {}).get("value", []))


def _list_notebooks_live(workspace_id: str, token: str) -> list[dict[str, Any]]:
    status, payload, _ = _fabric_request(
        "GET",
        f"{_FABRIC_API}/workspaces/{workspace_id}/notebooks",
        token=token,
        timeout=30,
    )
    if status >= 400:
        raise HttpError(_error_message(payload, "Failed to list notebooks"), 502)
    return list((payload or {}).get("value", []))


def _list_pipelines_live(workspace_id: str, token: str) -> list[dict[str, Any]]:
    status, payload, _ = _fabric_request(
        "GET",
        f"{_FABRIC_API}/workspaces/{workspace_id}/items?type=DataPipeline",
        token=token,
        timeout=30,
    )
    if status >= 400:
        raise HttpError(_error_message(payload, "Failed to list pipelines"), 502)
    return list((payload or {}).get("value", []))


def _list_sql_databases_live(workspace_id: str, token: str) -> list[dict[str, Any]]:
    status, payload, _ = _fabric_request(
        "GET",
        f"{_FABRIC_API}/workspaces/{workspace_id}/sqlDatabases",
        token=token,
        timeout=30,
    )
    if status >= 400:
        raise HttpError(_error_message(payload, "Failed to list SQL databases"), 502)
    return list((payload or {}).get("value", []))


def _normalize_capacity(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id", ""),
        "displayName": item.get("displayName", item.get("name", "")),
        "sku": item.get("sku", ""),
        "state": item.get("state", ""),
    }


def _normalize_entity(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id", ""),
        "displayName": item.get("displayName", item.get("name", "")),
    }


def _normalize_lakehouse(item: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_entity(item)
    normalized["workspaceGuid"] = item.get("workspaceId", "")
    return normalized


def _normalize_sql_database(item: dict[str, Any]) -> dict[str, Any]:
    props = item.get("properties", {}) if isinstance(item.get("properties"), dict) else {}
    normalized = _normalize_entity(item)
    normalized["serverFqdn"] = props.get("serverFqdn", "")
    normalized["databaseName"] = props.get("databaseName", "")
    return normalized


def _find_by_name(items: list[dict[str, Any]], display_name: str) -> dict[str, Any] | None:
    target = display_name.strip().lower()
    for item in items:
        if str(item.get("displayName", item.get("name", ""))).strip().lower() == target:
            return item
    return None


def _wait_for_named_workspace(display_name: str, token: str, timeout_seconds: int = 300) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        match = _find_by_name(_list_workspaces_live(token), display_name)
        if match:
            return match
        time.sleep(5)
    raise HttpError(f"Workspace '{display_name}' did not appear after creation", 504)


def _wait_for_named_item(
    workspace_id: str,
    display_name: str,
    *,
    token: str,
    list_fn,
    timeout_seconds: int = 300,
) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        match = _find_by_name(list_fn(workspace_id, token), display_name)
        if match:
            return match
        time.sleep(5)
    raise HttpError(f"Item '{display_name}' did not appear after creation", 504)


def _upsert_workspace_row(item: dict[str, Any]) -> None:
    workspace_guid = item.get("id", "")
    display_name = item.get("displayName", "")
    if not workspace_guid or not display_name:
        return
    existing = db.query(
        "SELECT WorkspaceId FROM workspaces WHERE LOWER(WorkspaceGuid) = LOWER(?) LIMIT 1",
        (workspace_guid,),
    )
    if existing:
        db.execute(
            "UPDATE workspaces SET Name = ?, WorkspaceGuid = ? WHERE WorkspaceId = ?",
            (display_name, workspace_guid, existing[0]["WorkspaceId"]),
        )
        return
    row = db.query("SELECT COALESCE(MAX(WorkspaceId), 0) + 1 AS next_id FROM workspaces")
    next_id = int(row[0]["next_id"]) if row else 1
    db.execute(
        "INSERT INTO workspaces (WorkspaceId, WorkspaceGuid, Name) VALUES (?, ?, ?)",
        (next_id, workspace_guid, display_name),
    )


def _upsert_lakehouse_row(item: dict[str, Any], workspace_id: str) -> None:
    lakehouse_guid = item.get("id", "")
    display_name = item.get("displayName", "")
    if not lakehouse_guid or not display_name:
        return
    existing = db.query(
        "SELECT LakehouseId FROM lakehouses WHERE LOWER(LakehouseGuid) = LOWER(?) LIMIT 1",
        (lakehouse_guid,),
    )
    if existing:
        db.execute(
            "UPDATE lakehouses SET Name = ?, WorkspaceGuid = ?, LakehouseGuid = ? WHERE LakehouseId = ?",
            (display_name, workspace_id, lakehouse_guid, existing[0]["LakehouseId"]),
        )
        return
    row = db.query("SELECT COALESCE(MAX(LakehouseId), 0) + 1 AS next_id FROM lakehouses")
    next_id = int(row[0]["next_id"]) if row else 1
    db.execute(
        "INSERT INTO lakehouses (LakehouseId, Name, WorkspaceGuid, LakehouseGuid) VALUES (?, ?, ?, ?)",
        (next_id, display_name, workspace_id, lakehouse_guid),
    )


def _upsert_pipeline_row(item: dict[str, Any], workspace_id: str) -> None:
    pipeline_guid = item.get("id", "")
    display_name = item.get("displayName", "")
    if not pipeline_guid or not display_name:
        return
    existing = db.query(
        "SELECT PipelineId FROM pipelines WHERE LOWER(PipelineGuid) = LOWER(?) LIMIT 1",
        (pipeline_guid,),
    )
    if existing:
        db.execute(
            "UPDATE pipelines SET Name = ?, WorkspaceGuid = ?, PipelineGuid = ?, IsActive = 1 WHERE PipelineId = ?",
            (display_name, workspace_id, pipeline_guid, existing[0]["PipelineId"]),
        )
        return
    row = db.query("SELECT COALESCE(MAX(PipelineId), 0) + 1 AS next_id FROM pipelines")
    next_id = int(row[0]["next_id"]) if row else 1
    db.execute(
        "INSERT INTO pipelines (PipelineId, Name, PipelineGuid, WorkspaceGuid, IsActive) VALUES (?, ?, ?, ?, 1)",
        (next_id, display_name, pipeline_guid, workspace_id),
    )


def _default_connections() -> dict[str, Any]:
    rows = db.query("SELECT ConnectionGuid, Name, Type FROM connections WHERE IsActive = 1")
    by_name = {row.get("Name", ""): row for row in rows}
    result: dict[str, Any] = {}
    for key in _CONNECTION_KEYS:
        row = by_name.get(key)
        if row and row.get("ConnectionGuid"):
            result[key] = {
                "id": row["ConnectionGuid"],
                "displayName": row["Name"],
                "type": row.get("Type", ""),
            }
        else:
            result[key] = None
    return result


def _assign_workspace_to_capacity(workspace_id: str, capacity_id: str, token: str) -> None:
    status, payload, headers = _fabric_request(
        "POST",
        f"{_FABRIC_API}/workspaces/{workspace_id}/assignToCapacity",
        token=token,
        payload={"capacityId": capacity_id},
        timeout=30,
    )
    if status >= 400:
        raise HttpError(_error_message(payload, "Failed to assign workspace to capacity"), 502)
    location = headers.get("Location")
    if status == 202 and location:
        _poll_operation(location, token=token, timeout_seconds=300)


def _create_workspace(display_name: str, capacity_id: str | None = None) -> tuple[dict[str, Any], bool]:
    token = _get_fabric_token()
    existing = _find_by_name(_list_workspaces_live(token), display_name)
    if existing:
        if capacity_id and existing.get("capacityId") != capacity_id:
            _assign_workspace_to_capacity(existing["id"], capacity_id, token)
            existing["capacityId"] = capacity_id
        _upsert_workspace_row(existing)
        return existing, False

    payload: dict[str, Any] = {
        "displayName": display_name,
        "description": (
            "Provisioned by the FMD Framework. Changes here may be overwritten "
            "during future setup runs."
        ),
    }
    status, response, headers = _fabric_request(
        "POST",
        f"{_FABRIC_API}/workspaces",
        token=token,
        payload=payload,
        timeout=30,
    )
    if status >= 400:
        raise HttpError(_error_message(response, f"Failed to create workspace '{display_name}'"), 502)

    workspace = response if status == 201 and isinstance(response, dict) and response.get("id") else None
    location = headers.get("Location")
    if location:
        _poll_operation(location, token=token, timeout_seconds=300)
    if workspace is None:
        workspace = _wait_for_named_workspace(display_name, token, timeout_seconds=300)
    if capacity_id:
        _assign_workspace_to_capacity(workspace["id"], capacity_id, token)
        workspace["capacityId"] = capacity_id
    _upsert_workspace_row(workspace)
    return workspace, True


def _create_lakehouse(workspace_id: str, display_name: str) -> tuple[dict[str, Any], bool]:
    token = _get_fabric_token()
    existing = _find_by_name(_list_lakehouses_live(workspace_id, token), display_name)
    if existing:
        _upsert_lakehouse_row(existing, workspace_id)
        return existing, False

    payload = {
        "displayName": display_name,
        "description": "Provisioned by the FMD Framework.",
        "creationPayload": {"enableSchemas": True},
    }
    status, response, headers = _fabric_request(
        "POST",
        f"{_FABRIC_API}/workspaces/{workspace_id}/lakehouses",
        token=token,
        payload=payload,
        timeout=30,
    )
    if status >= 400:
        raise HttpError(_error_message(response, f"Failed to create lakehouse '{display_name}'"), 502)

    item = response if status == 201 and isinstance(response, dict) and response.get("id") else None
    location = headers.get("Location")
    if location:
        _poll_operation(location, token=token, timeout_seconds=300)
    if item is None:
        item = _wait_for_named_item(
            workspace_id,
            display_name,
            token=token,
            list_fn=_list_lakehouses_live,
            timeout_seconds=300,
        )
    _upsert_lakehouse_row(item, workspace_id)
    return item, True


def _create_sql_database(workspace_id: str, display_name: str) -> tuple[dict[str, Any], bool]:
    token = _get_fabric_token()
    existing = _find_by_name(_list_sql_databases_live(workspace_id, token), display_name)
    if existing:
        return existing, False

    payload = {
        "displayName": display_name,
        "description": "Provisioned by the FMD Framework.",
    }
    status, response, headers = _fabric_request(
        "POST",
        f"{_FABRIC_API}/workspaces/{workspace_id}/sqlDatabases",
        token=token,
        payload=payload,
        timeout=30,
    )
    if status >= 400:
        raise HttpError(_error_message(response, f"Failed to create SQL database '{display_name}'"), 502)

    item = response if status == 201 and isinstance(response, dict) and response.get("id") else None
    location = headers.get("Location")
    if location:
        _poll_operation(location, token=token, timeout_seconds=600)
    if item is None:
        item = _wait_for_named_item(
            workspace_id,
            display_name,
            token=token,
            list_fn=_list_sql_databases_live,
            timeout_seconds=600,
        )
    return item, True


def _build_environment_config(params: dict[str, Any]) -> dict[str, Any]:
    workspaces = params.get("workspaces") or {}
    lakehouses = params.get("lakehouses") or {}
    connections = params.get("connections") or {}
    notebooks = params.get("notebooks") or {}
    pipelines = params.get("pipelines") or {}
    database = params.get("database")
    return {
        "capacity": params.get("capacity"),
        "workspaces": {key: workspaces.get(key) for key in _WORKSPACE_NAMES},
        "connections": {key: connections.get(key) for key in _CONNECTION_KEYS},
        "lakehouses": {key: lakehouses.get(key) for key in _LAKEHOUSE_NAMES},
        "notebooks": {key: notebooks.get(key) for key in _NOTEBOOK_NAMES},
        "pipelines": {key: pipelines.get(key) for key in _PIPELINE_NAMES},
        "database": database,
    }


def _sync_selected_items_to_db(config: dict[str, Any]) -> None:
    for workspace in (config.get("workspaces") or {}).values():
        if workspace:
            _upsert_workspace_row(workspace)
    data_workspace_id = ((config.get("workspaces") or {}).get("data_dev") or {}).get("id", "")
    for lakehouse in (config.get("lakehouses") or {}).values():
        if lakehouse:
            _upsert_lakehouse_row(
                {
                    "id": lakehouse.get("id", ""),
                    "displayName": lakehouse.get("displayName", ""),
                },
                lakehouse.get("workspaceGuid") or data_workspace_id,
            )
    code_workspace_id = ((config.get("workspaces") or {}).get("code_dev") or {}).get("id", "")
    for pipeline in (config.get("pipelines") or {}).values():
        if pipeline:
            _upsert_pipeline_row(
                {
                    "id": pipeline.get("id", ""),
                    "displayName": pipeline.get("displayName", ""),
                },
                code_workspace_id,
            )


def _save_environment_config(config: dict[str, Any]) -> list[dict[str, Any]]:
    raw = _load_raw_config()
    fabric = raw.setdefault("fabric", {})
    sql = raw.setdefault("sql", {})
    engine = raw.setdefault("engine", {})

    workspaces = config.get("workspaces") or {}
    lakehouses = config.get("lakehouses") or {}
    notebooks = config.get("notebooks") or {}
    pipelines = config.get("pipelines") or {}
    database = config.get("database") or {}
    capacity = config.get("capacity") or {}
    connections = config.get("connections") or {}

    fabric["capacity_id"] = capacity.get("id", "")
    fabric["capacity_name"] = capacity.get("displayName", "")
    fabric["workspace_data_id"] = (workspaces.get("data_dev") or {}).get("id", "")
    fabric["workspace_code_id"] = (workspaces.get("code_dev") or {}).get("id", "")
    fabric["workspace_config_id"] = (workspaces.get("config") or {}).get("id", "")
    fabric["workspace_data_prod_id"] = (workspaces.get("data_prod") or {}).get("id", "")
    fabric["workspace_code_prod_id"] = (workspaces.get("code_prod") or {}).get("id", "")
    fabric["sql_database_id"] = database.get("id", "")
    fabric["sql_database_name"] = database.get("displayName", "")
    fabric["connection_ids"] = {
        key: (connections.get(key) or {}).get("id", "")
        for key in _CONNECTION_KEYS
    }

    if database:
        sql["server"] = database.get("serverFqdn", sql.get("server", ""))
        sql["database"] = database.get("databaseName", sql.get("database", ""))

    engine["lz_lakehouse_id"] = (lakehouses.get("LH_DATA_LANDINGZONE") or {}).get("id", "")
    engine["bronze_lakehouse_id"] = (lakehouses.get("LH_BRONZE_LAYER") or {}).get("id", "")
    engine["silver_lakehouse_id"] = (lakehouses.get("LH_SILVER_LAYER") or {}).get("id", "")
    engine["notebook_bronze_id"] = (notebooks.get("NB_FMD_LOAD_LANDING_BRONZE") or {}).get("id", "")
    engine["notebook_silver_id"] = (notebooks.get("NB_FMD_LOAD_BRONZE_SILVER") or {}).get("id", "")
    engine["pipeline_copy_sql_id"] = (pipelines.get("PL_FMD_LDZ_COPY_SQL") or {}).get("id", "")
    engine["pipeline_workspace_id"] = (workspaces.get("code_dev") or {}).get("id", "")

    _write_raw_config(raw)
    _sync_selected_items_to_db(config)

    return [
        {"target": "config.json", "status": "ok", "details": str(_CONFIG_PATH)},
        {"target": "sqlite mirror", "status": "ok", "details": str(db.DB_PATH)},
    ]


@route("GET", "/api/setup/capacities")
def get_setup_capacities(params: dict) -> dict:
    token = _get_fabric_token()
    capacities = sorted(
        (_normalize_capacity(item) for item in _list_capacities_live(token)),
        key=lambda item: item["displayName"].lower(),
    )
    return {"capacities": capacities}


@route("GET", "/api/setup/workspaces/{workspaceId}/lakehouses")
def get_setup_lakehouses(params: dict) -> dict:
    workspace_id = params.get("workspaceId", "")
    if not workspace_id:
        raise HttpError("workspaceId is required", 400)
    token = _get_fabric_token()
    items = sorted(
        (_normalize_lakehouse(item) for item in _list_lakehouses_live(workspace_id, token)),
        key=lambda item: item["displayName"].lower(),
    )
    return {"items": items}


@route("GET", "/api/setup/workspaces/{workspaceId}/notebooks")
def get_setup_notebooks(params: dict) -> dict:
    workspace_id = params.get("workspaceId", "")
    if not workspace_id:
        raise HttpError("workspaceId is required", 400)
    token = _get_fabric_token()
    items = sorted(
        (_normalize_entity(item) for item in _list_notebooks_live(workspace_id, token)),
        key=lambda item: item["displayName"].lower(),
    )
    return {"items": items}


@route("GET", "/api/setup/workspaces/{workspaceId}/pipelines")
def get_setup_pipelines(params: dict) -> dict:
    workspace_id = params.get("workspaceId", "")
    if not workspace_id:
        raise HttpError("workspaceId is required", 400)
    token = _get_fabric_token()
    items = sorted(
        (_normalize_entity(item) for item in _list_pipelines_live(workspace_id, token)),
        key=lambda item: item["displayName"].lower(),
    )
    return {"items": items}


@route("GET", "/api/setup/workspaces/{workspaceId}/sql-databases")
def get_setup_sql_databases(params: dict) -> dict:
    workspace_id = params.get("workspaceId", "")
    if not workspace_id:
        raise HttpError("workspaceId is required", 400)
    token = _get_fabric_token()
    items = sorted(
        (_normalize_sql_database(item) for item in _list_sql_databases_live(workspace_id, token)),
        key=lambda item: item["displayName"].lower(),
    )
    return {"items": items}


@route("POST", "/api/setup/create-workspace")
def post_setup_create_workspace(params: dict) -> dict:
    display_name = str(params.get("displayName", "")).strip()
    capacity_id = str(params.get("capacityId", "")).strip() or None
    if not display_name:
        raise HttpError("displayName is required", 400)
    item, created = _create_workspace(display_name, capacity_id=capacity_id)
    return {
        **_normalize_entity(item),
        "created": created,
        "capacityId": item.get("capacityId", capacity_id or ""),
    }


@route("POST", "/api/setup/create-lakehouse")
def post_setup_create_lakehouse(params: dict) -> dict:
    workspace_id = str(params.get("workspaceId", "")).strip()
    display_name = str(params.get("displayName", "")).strip()
    if not workspace_id or not display_name:
        raise HttpError("workspaceId and displayName are required", 400)
    item, created = _create_lakehouse(workspace_id, display_name)
    return {**_normalize_lakehouse(item), "created": created}


@route("POST", "/api/setup/create-sql-database")
def post_setup_create_sql_database(params: dict) -> dict:
    workspace_id = str(params.get("workspaceId", "")).strip()
    display_name = str(params.get("displayName", "")).strip()
    if not workspace_id or not display_name:
        raise HttpError("workspaceId and displayName are required", 400)
    item, created = _create_sql_database(workspace_id, display_name)
    return {**_normalize_sql_database(item), "created": created}


@route("POST", "/api/setup/save-config")
def post_setup_save_config(params: dict) -> dict:
    config = _build_environment_config(params)
    results = _save_environment_config(config)
    return {"ok": True, "results": results}


@route("GET", "/api/setup/validate")
def get_setup_validate(params: dict) -> dict:
    resolved = _load_resolved_config()
    fabric = resolved.get("fabric", {})
    engine = resolved.get("engine", {})
    sql = resolved.get("sql", {})

    checks: list[dict[str, Any]] = []
    checks.append(
        {
            "check": "Fabric credentials",
            "status": "ok" if fabric.get("client_secret") else "error",
            "details": "Service principal secret present" if fabric.get("client_secret") else "FABRIC_CLIENT_SECRET is missing",
        }
    )
    checks.append(
        {
            "check": "Workspaces",
            "status": "ok" if fabric.get("workspace_data_id") and fabric.get("workspace_code_id") else "error",
            "details": "Core dev workspaces configured" if fabric.get("workspace_data_id") and fabric.get("workspace_code_id") else "Data or code workspace missing",
        }
    )
    checks.append(
        {
            "check": "Lakehouses",
            "status": "ok"
            if engine.get("lz_lakehouse_id") and engine.get("bronze_lakehouse_id") and engine.get("silver_lakehouse_id")
            else "warning",
            "details": "Landing, bronze, and silver lakehouses configured"
            if engine.get("lz_lakehouse_id") and engine.get("bronze_lakehouse_id") and engine.get("silver_lakehouse_id")
            else "One or more lakehouse IDs are missing",
        }
    )
    checks.append(
        {
            "check": "SQL metadata database",
            "status": "ok" if sql.get("server") and sql.get("database") else "warning",
            "details": "SQL endpoint configured" if sql.get("server") and sql.get("database") else "SQL server or database missing",
        }
    )
    checks.append(
        {
            "check": "Notebook bindings",
            "status": "ok" if engine.get("notebook_bronze_id") and engine.get("notebook_silver_id") else "warning",
            "details": "Load notebooks configured" if engine.get("notebook_bronze_id") and engine.get("notebook_silver_id") else "Notebook IDs not fully configured",
        }
    )
    checks.append(
        {
            "check": "Pipeline binding",
            "status": "ok" if engine.get("pipeline_copy_sql_id") else "warning",
            "details": "Copy pipeline configured" if engine.get("pipeline_copy_sql_id") else "Pipeline ID missing",
        }
    )
    return {"checks": checks}


@route("POST", "/api/setup/provision-all")
def post_setup_provision_all(params: dict) -> dict:
    capacity_id = str(params.get("capacityId", "")).strip()
    capacity_display_name = str(params.get("capacityDisplayName", "")).strip()
    if not capacity_id:
        raise HttpError("capacityId is required", 400)

    steps: list[dict[str, Any]] = []

    def record_step(name: str, status: str, *, item_id: str = "", details: str = "") -> None:
        step: dict[str, Any] = {"name": name, "status": status}
        if item_id:
            step["id"] = item_id
        if details:
            step["details"] = details
        steps.append(step)

    try:
        workspaces: dict[str, Any] = {}
        for key, display_name in _WORKSPACE_NAMES.items():
            item, created = _create_workspace(display_name, capacity_id=capacity_id)
            normalized = _normalize_entity(item)
            workspaces[key] = normalized
            record_step(
                f"Workspace: {display_name}",
                "ok",
                item_id=normalized["id"],
                details="Created" if created else "Reused existing workspace",
            )

        lakehouses: dict[str, Any] = {}
        data_workspace_id = workspaces["data_dev"]["id"]
        for key, display_name in _LAKEHOUSE_NAMES.items():
            item, created = _create_lakehouse(data_workspace_id, display_name)
            normalized = _normalize_lakehouse(item)
            lakehouses[key] = normalized
            record_step(
                f"Lakehouse: {display_name}",
                "ok",
                item_id=normalized["id"],
                details="Created" if created else "Reused existing lakehouse",
            )

        sql_db_item, sql_db_created = _create_sql_database(workspaces["config"]["id"], "SQL_INTEGRATION_FRAMEWORK")
        database = _normalize_sql_database(sql_db_item)
        record_step(
            "SQL Database: SQL_INTEGRATION_FRAMEWORK",
            "ok",
            item_id=database["id"],
            details="Created" if sql_db_created else "Reused existing SQL database",
        )

        token = _get_fabric_token()
        notebooks_live = _list_notebooks_live(workspaces["code_dev"]["id"], token)
        notebooks = {
            key: (
                _normalize_entity(found)
                if (found := _find_by_name(notebooks_live, name))
                else None
            )
            for key, name in _NOTEBOOK_NAMES.items()
        }
        pipelines_live = _list_pipelines_live(workspaces["code_dev"]["id"], token)
        pipelines = {
            key: (
                _normalize_entity(found)
                if (found := _find_by_name(pipelines_live, name))
                else None
            )
            for key, name in _PIPELINE_NAMES.items()
        }
        for pipeline in pipelines.values():
            if pipeline:
                _upsert_pipeline_row(pipeline, workspaces["code_dev"]["id"])

        config = {
            "capacity": {
                "id": capacity_id,
                "displayName": capacity_display_name or capacity_id,
                "sku": "",
                "state": "Active",
            },
            "workspaces": workspaces,
            "connections": _default_connections(),
            "lakehouses": lakehouses,
            "notebooks": notebooks,
            "pipelines": pipelines,
            "database": database,
        }

        results = _save_environment_config(config)
        record_step("Save & propagate config", "ok", details=", ".join(result["target"] for result in results))

        return {"steps": steps, "config": config, "results": results}
    except HttpError as exc:
        record_step("Provisioning failed", "error", details=str(exc))
        return {"error": str(exc), "steps": steps}
