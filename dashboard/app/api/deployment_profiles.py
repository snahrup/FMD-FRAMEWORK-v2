"""Deployment profile normalization, execution, and config propagation."""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dashboard.app.api import control_plane_db as cpdb
from dashboard.app.api import db
from dashboard.app.api.fabric_deployment import FabricDeploymentError, find_by_display_name


CONFIG_PATH = Path(__file__).parent / "config.json"

WORKSPACE_KEYS = ("data_dev", "code_dev", "config", "data_prod", "code_prod")
LAKEHOUSE_KEYS = ("landing", "bronze", "silver")
ITEM_KEYS = ("landingBronzeNotebook", "bronzeSilverNotebook", "copySqlPipeline")

OLD_LAKEHOUSE_KEYS = {
    "landing": "LH_DATA_LANDINGZONE",
    "bronze": "LH_BRONZE_LAYER",
    "silver": "LH_SILVER_LAYER",
}
OLD_NOTEBOOK_KEYS = {
    "landingBronzeNotebook": "NB_FMD_LOAD_LANDING_BRONZE",
    "bronzeSilverNotebook": "NB_FMD_LOAD_BRONZE_SILVER",
}
OLD_PIPELINE_KEYS = {
    "copySqlPipeline": "PL_FMD_LDZ_COPY_SQL",
}
ITEM_TYPES = {
    "landingBronzeNotebook": "Notebook",
    "bronzeSilverNotebook": "Notebook",
    "copySqlPipeline": "DataPipeline",
}

DEFAULT_RESOURCE_NAMES = {
    "profileKey": "ipcorp-dev",
    "displayName": "IP Corp Dev",
    "authMode": "service_principal",
    "capacityId": "",
    "capacityDisplayName": "",
    "workspaces": {
        "data_dev": "IPCorp FMD Data Dev",
        "code_dev": "IPCorp FMD Code Dev",
        "config": "IPCorp FMD Config",
        "data_prod": "IPCorp FMD Data Prod",
        "code_prod": "IPCorp FMD Code Prod",
    },
    "lakehouses": {
        "landing": "LH_FMD_LANDING",
        "bronze": "LH_FMD_BRONZE",
        "silver": "LH_FMD_SILVER",
    },
    "database": {"metadata": "SQL_FMD_CONTROL_PLANE"},
    "items": {
        "landingBronzeNotebook": "NB_FMD_LOAD_LANDING_BRONZE",
        "bronzeSilverNotebook": "NB_FMD_LOAD_BRONZE_SILVER",
        "copySqlPipeline": "PL_FMD_LDZ_COPY_SQL",
    },
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def json_dumps(obj: Any) -> str:
    return json.dumps(obj or {}, sort_keys=True, separators=(",", ":"))


def json_loads(value: Any, default: Any = None) -> Any:
    if not value:
        return default if default is not None else {}
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except json.JSONDecodeError:
        return default if default is not None else {}


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "fmd-deployment"


def _display_name(item: dict[str, Any] | None) -> str:
    if not item:
        return ""
    return str(item.get("displayName") or item.get("name") or "")


def normalize_deployment_spec(params: dict[str, Any]) -> dict[str, Any]:
    merged = json.loads(json.dumps(DEFAULT_RESOURCE_NAMES))
    source = params.get("resourceNames") if isinstance(params.get("resourceNames"), dict) else params

    display_name = str(source.get("displayName") or merged["displayName"]).strip()
    profile_key = slugify(str(source.get("profileKey") or display_name or merged["profileKey"]))
    auth_mode = str(source.get("authMode") or merged["authMode"]).strip() or "service_principal"

    capacity = source.get("capacity") if isinstance(source.get("capacity"), dict) else {}
    capacity_id = str(source.get("capacityId") or capacity.get("id") or "").strip()
    capacity_name = str(source.get("capacityDisplayName") or capacity.get("displayName") or capacity_id).strip()

    for group in ("workspaces", "lakehouses", "items"):
        if isinstance(source.get(group), dict):
            for key, value in source[group].items():
                if key in merged[group] and str(value).strip():
                    merged[group][key] = str(value).strip()
    if isinstance(source.get("database"), dict) and str(source["database"].get("metadata", "")).strip():
        merged["database"]["metadata"] = str(source["database"]["metadata"]).strip()

    if not capacity_id:
        raise ValueError("capacityId is required")
    if auth_mode not in {"service_principal", "delegated_oauth"}:
        raise ValueError(f"Unsupported authMode: {auth_mode}")

    merged.update(
        {
            "profileKey": profile_key,
            "displayName": display_name,
            "authMode": auth_mode,
            "capacityId": capacity_id,
            "capacityDisplayName": capacity_name,
        }
    )
    return merged


def make_step(
    *,
    profile_key: str,
    step_key: str,
    step_type: str,
    display_name: str,
    action: str,
    status: str = "pending",
    required: bool = True,
    fabric_resource_id: str = "",
    fabric_workspace_id: str = "",
    error_message: str = "",
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "profileKey": profile_key,
        "stepKey": step_key,
        "stepType": step_type,
        "displayName": display_name,
        "status": status,
        "action": action,
        "required": required,
        "fabricResourceId": fabric_resource_id,
        "fabricWorkspaceId": fabric_workspace_id,
        "errorMessage": error_message,
        "details": details or {},
    }


def _db_step(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "stepKey": row.get("StepKey", ""),
        "stepType": row.get("StepType", ""),
        "displayName": row.get("DisplayName", ""),
        "status": row.get("Status", "pending"),
        "action": row.get("Action", "create"),
        "required": bool(row.get("Required", 1)),
        "fabricResourceId": row.get("FabricResourceId") or "",
        "fabricWorkspaceId": row.get("FabricWorkspaceId") or "",
        "errorMessage": row.get("ErrorMessage") or "",
        "details": json_loads(row.get("Details"), {}),
        "startedAt": row.get("StartedAt"),
        "endedAt": row.get("EndedAt"),
    }


def build_preview_plan(spec: dict[str, Any], client) -> list[dict[str, Any]]:
    profile_key = spec["profileKey"]
    steps: list[dict[str, Any]] = []

    workspaces = client.list_workspaces()
    workspace_matches: dict[str, dict[str, Any] | None] = {}
    for key in WORKSPACE_KEYS:
        name = spec["workspaces"][key]
        match = find_by_display_name(workspaces, name)
        workspace_matches[key] = match
        steps.append(
            make_step(
                profile_key=profile_key,
                step_key=f"workspace.{key}",
                step_type="workspace",
                display_name=name,
                action="reuse" if match else "create",
                status="pending",
                fabric_resource_id=str((match or {}).get("id", "")),
                details={"capacityId": spec["capacityId"]},
            )
        )

    data_workspace_id = str((workspace_matches.get("data_dev") or {}).get("id", ""))
    if data_workspace_id:
        lakehouses = client.list_lakehouses(data_workspace_id)
    else:
        lakehouses = []
    for key in LAKEHOUSE_KEYS:
        name = spec["lakehouses"][key]
        match = find_by_display_name(lakehouses, name)
        steps.append(
            make_step(
                profile_key=profile_key,
                step_key=f"lakehouse.{key}",
                step_type="lakehouse",
                display_name=name,
                action="reuse" if match else "create",
                status="pending",
                fabric_resource_id=str((match or {}).get("id", "")),
                fabric_workspace_id=data_workspace_id,
                details={"workspaceKey": "data_dev"},
            )
        )

    config_workspace_id = str((workspace_matches.get("config") or {}).get("id", ""))
    sql_databases = client.list_sql_databases(config_workspace_id) if config_workspace_id else []
    database_name = spec["database"]["metadata"]
    database_match = find_by_display_name(sql_databases, database_name)
    steps.append(
        make_step(
            profile_key=profile_key,
            step_key="database.metadata",
            step_type="sql_database",
            display_name=database_name,
            action="reuse" if database_match else "create",
            status="pending",
            fabric_resource_id=str((database_match or {}).get("id", "")),
            fabric_workspace_id=config_workspace_id,
            details={"workspaceKey": "config"},
        )
    )

    code_workspace_id = str((workspace_matches.get("code_dev") or {}).get("id", ""))
    for key in ITEM_KEYS:
        name = spec["items"][key]
        item_type = ITEM_TYPES[key]
        items = client.list_items(code_workspace_id, item_type) if code_workspace_id else []
        match = find_by_display_name(items, name)
        action = "reuse" if match else "create"
        steps.append(
            make_step(
                profile_key=profile_key,
                step_key=f"item.{key}",
                step_type=item_type,
                display_name=name,
                action=action,
                status="pending",
                required=True,
                fabric_resource_id=str((match or {}).get("id", "")),
                fabric_workspace_id=code_workspace_id,
                details={
                    "workspaceKey": "code_dev",
                    "message": "Creates or reuses the Fabric item. Definition upload is tracked separately.",
                },
            )
        )
    return steps


def execute_resource_plan(spec: dict[str, Any], client) -> dict[str, Any]:
    profile_key = spec["profileKey"]
    result = {
        "capacity": {"id": spec["capacityId"], "displayName": spec["capacityDisplayName"]},
        "workspaces": {},
        "lakehouses": {},
        "database": {},
        "items": {},
    }
    steps: list[dict[str, Any]] = []
    failed = False

    def add_failed(step_key: str, step_type: str, display_name: str, action: str, exc: Exception) -> None:
        nonlocal failed
        failed = True
        steps.append(
            make_step(
                profile_key=profile_key,
                step_key=step_key,
                step_type=step_type,
                display_name=display_name,
                action=action,
                status="failed",
                required=True,
                error_message=str(exc),
                details={"recovery": "Fix the Fabric permission/API error and rerun this deployment profile."},
            )
        )

    for key in WORKSPACE_KEYS:
        name = spec["workspaces"][key]
        try:
            item, action = client.create_or_reuse_workspace(name, spec["capacityId"])
            result["workspaces"][key] = {"id": item.get("id", ""), "displayName": _display_name(item)}
            steps.append(
                make_step(
                    profile_key=profile_key,
                    step_key=f"workspace.{key}",
                    step_type="workspace",
                    display_name=name,
                    action=action,
                    status="succeeded",
                    fabric_resource_id=str(item.get("id", "")),
                    details={"capacityId": spec["capacityId"]},
                )
            )
        except Exception as exc:
            add_failed(f"workspace.{key}", "workspace", name, "create", exc)
            return {"status": "failed", "result": result, "steps": steps}

    data_workspace_id = result["workspaces"]["data_dev"]["id"]
    for key in LAKEHOUSE_KEYS:
        name = spec["lakehouses"][key]
        try:
            item, action = client.create_or_reuse_lakehouse(data_workspace_id, name)
            result["lakehouses"][key] = {
                "id": item.get("id", ""),
                "displayName": _display_name(item),
                "workspaceGuid": data_workspace_id,
            }
            steps.append(
                make_step(
                    profile_key=profile_key,
                    step_key=f"lakehouse.{key}",
                    step_type="lakehouse",
                    display_name=name,
                    action=action,
                    status="succeeded",
                    fabric_resource_id=str(item.get("id", "")),
                    fabric_workspace_id=data_workspace_id,
                    details={"workspaceKey": "data_dev"},
                )
            )
        except Exception as exc:
            add_failed(f"lakehouse.{key}", "lakehouse", name, "create", exc)
            return {"status": "failed", "result": result, "steps": steps}

    config_workspace_id = result["workspaces"]["config"]["id"]
    database_name = spec["database"]["metadata"]
    try:
        item, action = client.create_or_reuse_sql_database(config_workspace_id, database_name)
        props = item.get("properties", {}) if isinstance(item.get("properties"), dict) else {}
        result["database"] = {
            "id": item.get("id", ""),
            "displayName": _display_name(item),
            "workspaceGuid": config_workspace_id,
            "serverFqdn": props.get("serverFqdn", item.get("serverFqdn", "")),
            "databaseName": props.get("databaseName", item.get("databaseName", "")),
        }
        steps.append(
            make_step(
                profile_key=profile_key,
                step_key="database.metadata",
                step_type="sql_database",
                display_name=database_name,
                action=action,
                status="succeeded",
                fabric_resource_id=str(item.get("id", "")),
                fabric_workspace_id=config_workspace_id,
                details={"workspaceKey": "config"},
            )
        )
    except Exception as exc:
        add_failed("database.metadata", "sql_database", database_name, "create", exc)
        return {"status": "failed", "result": result, "steps": steps}

    code_workspace_id = result["workspaces"]["code_dev"]["id"]
    for key in ITEM_KEYS:
        name = spec["items"][key]
        item_type = ITEM_TYPES[key]
        try:
            item, action = client.create_or_reuse_item(code_workspace_id, name, item_type)
            if item:
                result["items"][key] = {"id": item.get("id", ""), "displayName": _display_name(item)}
                status = "succeeded"
                resource_id = str(item.get("id", ""))
                message = "Existing Fabric item reused." if action == "reuse" else "Fabric item created."
            else:
                result["items"][key] = None
                status = "warning"
                resource_id = ""
                message = "No definition payload is configured; bind/create this Fabric item manually or add definitions later."
            steps.append(
                make_step(
                    profile_key=profile_key,
                    step_key=f"item.{key}",
                    step_type=item_type,
                    display_name=name,
                    action=action,
                    status=status,
                    required=False,
                    fabric_resource_id=resource_id,
                    fabric_workspace_id=code_workspace_id,
                    details={"workspaceKey": "code_dev", "message": message},
                )
            )
        except FabricDeploymentError as exc:
            add_failed(f"item.{key}", item_type, name, "create", exc)
            return {"status": "failed", "result": result, "steps": steps}

    return {"status": "deployed" if not failed else "failed", "result": result, "steps": steps}


def persist_profile(
    spec: dict[str, Any],
    *,
    status: str,
    resource_plan: list[dict[str, Any]] | None = None,
    result_snapshot: dict[str, Any] | None = None,
    validation_snapshot: dict[str, Any] | None = None,
) -> None:
    cpdb.upsert_deployment_profile(
        {
            "ProfileKey": spec["profileKey"],
            "DisplayName": spec["displayName"],
            "Status": status,
            "AuthMode": spec["authMode"],
            "CapacityId": spec["capacityId"],
            "CapacityName": spec["capacityDisplayName"],
            "ConfigSnapshot": "{}",
            "ResourcePlan": json_dumps({"spec": spec, "steps": resource_plan or []}),
            "ResultSnapshot": json_dumps(result_snapshot or {}),
            "ValidationSnapshot": json_dumps(validation_snapshot or {}),
        }
    )


def persist_steps(profile_key: str, steps: list[dict[str, Any]]) -> None:
    for step in steps:
        ended_at = step.get("endedAt")
        if not ended_at and step.get("status") in {"succeeded", "warning", "failed", "skipped"}:
            ended_at = utc_now()
        cpdb.upsert_deployment_step(
            {
                "ProfileKey": profile_key,
                "StepKey": step["stepKey"],
                "StepType": step.get("stepType", ""),
                "DisplayName": step.get("displayName", ""),
                "Status": step.get("status", "pending"),
                "FabricResourceId": step.get("fabricResourceId", ""),
                "FabricWorkspaceId": step.get("fabricWorkspaceId", ""),
                "Action": step.get("action", "create"),
                "Required": step.get("required", True),
                "StartedAt": step.get("startedAt"),
                "EndedAt": ended_at,
                "ErrorMessage": step.get("errorMessage", ""),
                "Details": json_dumps(step.get("details", {})),
            }
        )


def profile_row_to_api(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "profileKey": row.get("ProfileKey", ""),
        "displayName": row.get("DisplayName", ""),
        "status": row.get("Status", "draft"),
        "authMode": row.get("AuthMode", "service_principal"),
        "capacityId": row.get("CapacityId") or "",
        "capacityName": row.get("CapacityName") or "",
        "resourcePlan": json_loads(row.get("ResourcePlan"), []),
        "result": json_loads(row.get("ResultSnapshot"), {}),
        "validation": json_loads(row.get("ValidationSnapshot"), {}),
        "activatedAt": row.get("ActivatedAt"),
        "createdAt": row.get("CreatedAt"),
        "updatedAt": row.get("UpdatedAt"),
    }


def list_profiles_api() -> dict[str, Any]:
    rows = cpdb.list_deployment_profiles()
    profiles = [profile_row_to_api(row) for row in rows]
    active = next((profile["profileKey"] for profile in profiles if profile["status"] == "active"), None)
    return {"activeProfileKey": active, "profiles": profiles}


def get_profile_api(profile_key: str) -> dict[str, Any] | None:
    row = cpdb.get_deployment_profile(profile_key)
    if not row:
        return None
    profile = profile_row_to_api(row)
    profile["steps"] = [_db_step(step) for step in cpdb.list_deployment_steps(profile_key)]
    profile["proof"] = profile.get("validation") or None
    profile["validationProof"] = profile.get("validation") or None
    return profile


def _read_raw_config(config_path: Path = CONFIG_PATH) -> dict[str, Any]:
    if not config_path.exists():
        return {}
    return json.loads(config_path.read_text(encoding="utf-8"))


def _write_raw_config(config: dict[str, Any], config_path: Path = CONFIG_PATH) -> None:
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def backup_config(profile_key: str, config_path: Path = CONFIG_PATH) -> Path | None:
    if not config_path.exists():
        return None
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = config_path.with_name(f"config.backup.{slugify(profile_key)}.{timestamp}.json")
    shutil.copy2(config_path, backup_path)
    return backup_path


def deployment_result_to_environment_config(result: dict[str, Any]) -> dict[str, Any]:
    workspaces = result.get("workspaces") or {}
    lakehouses = result.get("lakehouses") or {}
    items = result.get("items") or {}
    notebooks = {
        old_key: items.get(new_key)
        for new_key, old_key in OLD_NOTEBOOK_KEYS.items()
    }
    pipelines = {
        old_key: items.get(new_key)
        for new_key, old_key in OLD_PIPELINE_KEYS.items()
    }
    return {
        "capacity": result.get("capacity") or {},
        "workspaces": workspaces,
        "connections": {},
        "lakehouses": {
            old_key: lakehouses.get(new_key)
            for new_key, old_key in OLD_LAKEHOUSE_KEYS.items()
        },
        "notebooks": notebooks,
        "pipelines": pipelines,
        "database": result.get("database") or {},
    }


def _next_id(table: str, column: str) -> int:
    rows = db.query(f"SELECT COALESCE(MAX({column}), 0) + 1 AS next_id FROM {table}")
    return int(rows[0]["next_id"]) if rows else 1


def _upsert_workspace_row(item: dict[str, Any]) -> None:
    guid = str(item.get("id") or item.get("WorkspaceGuid") or "")
    name = str(item.get("displayName") or item.get("Name") or "")
    if not guid or not name:
        return
    existing = db.query("SELECT WorkspaceId FROM workspaces WHERE LOWER(WorkspaceGuid) = LOWER(?)", (guid,))
    cpdb.upsert_workspace(
        {
            "WorkspaceId": existing[0]["WorkspaceId"] if existing else _next_id("workspaces", "WorkspaceId"),
            "WorkspaceGuid": guid,
            "Name": name,
        }
    )


def _upsert_lakehouse_row(item: dict[str, Any], workspace_guid: str) -> None:
    guid = str(item.get("id") or item.get("LakehouseGuid") or "")
    name = str(item.get("displayName") or item.get("Name") or "")
    if not guid or not name:
        return
    existing = db.query("SELECT LakehouseId FROM lakehouses WHERE LOWER(LakehouseGuid) = LOWER(?)", (guid,))
    cpdb.upsert_lakehouse(
        {
            "LakehouseId": existing[0]["LakehouseId"] if existing else _next_id("lakehouses", "LakehouseId"),
            "Name": name,
            "WorkspaceGuid": workspace_guid,
            "LakehouseGuid": guid,
        }
    )


def _upsert_pipeline_row(item: dict[str, Any], workspace_guid: str) -> None:
    guid = str(item.get("id") or item.get("PipelineGuid") or "")
    name = str(item.get("displayName") or item.get("Name") or "")
    if not guid or not name:
        return
    existing = db.query("SELECT PipelineId FROM pipelines WHERE LOWER(PipelineGuid) = LOWER(?)", (guid,))
    cpdb.upsert_pipeline(
        {
            "PipelineId": existing[0]["PipelineId"] if existing else _next_id("pipelines", "PipelineId"),
            "Name": name,
            "PipelineGuid": guid,
            "WorkspaceGuid": workspace_guid,
            "IsActive": 1,
        }
    )


def sync_config_to_sqlite(config: dict[str, Any]) -> None:
    for workspace in (config.get("workspaces") or {}).values():
        if workspace:
            _upsert_workspace_row(workspace)
    data_workspace_id = ((config.get("workspaces") or {}).get("data_dev") or {}).get("id", "")
    for lakehouse in (config.get("lakehouses") or {}).values():
        if lakehouse:
            _upsert_lakehouse_row(lakehouse, lakehouse.get("workspaceGuid") or data_workspace_id)
    code_workspace_id = ((config.get("workspaces") or {}).get("code_dev") or {}).get("id", "")
    for pipeline in (config.get("pipelines") or {}).values():
        if pipeline:
            _upsert_pipeline_row(pipeline, code_workspace_id)


def save_environment_config(
    config: dict[str, Any],
    *,
    profile_key: str | None = None,
    config_path: Path = CONFIG_PATH,
) -> list[dict[str, Any]]:
    raw = _read_raw_config(config_path)
    backup_path = backup_config(profile_key, config_path) if profile_key else None

    fabric = raw.setdefault("fabric", {})
    sql = raw.setdefault("sql", {})
    engine = raw.setdefault("engine", {})

    workspaces = config.get("workspaces") or {}
    lakehouses = config.get("lakehouses") or {}
    notebooks = config.get("notebooks") or {}
    pipelines = config.get("pipelines") or {}
    database = config.get("database") or {}
    capacity = config.get("capacity") or {}

    fabric["capacity_id"] = capacity.get("id", "")
    fabric["capacity_name"] = capacity.get("displayName", "")
    fabric["workspace_data_id"] = (workspaces.get("data_dev") or {}).get("id", "")
    fabric["workspace_code_id"] = (workspaces.get("code_dev") or {}).get("id", "")
    fabric["workspace_config_id"] = (workspaces.get("config") or {}).get("id", "")
    fabric["workspace_data_prod_id"] = (workspaces.get("data_prod") or {}).get("id", "")
    fabric["workspace_code_prod_id"] = (workspaces.get("code_prod") or {}).get("id", "")
    fabric["sql_database_id"] = database.get("id", "")
    fabric["sql_database_name"] = database.get("displayName", "")

    if database:
        sql["server"] = database.get("serverFqdn", sql.get("server", ""))
        sql["database"] = database.get("databaseName", sql.get("database", "")) or database.get("displayName", "")

    engine["lz_lakehouse_id"] = (lakehouses.get("LH_DATA_LANDINGZONE") or {}).get("id", "")
    engine["bronze_lakehouse_id"] = (lakehouses.get("LH_BRONZE_LAYER") or {}).get("id", "")
    engine["silver_lakehouse_id"] = (lakehouses.get("LH_SILVER_LAYER") or {}).get("id", "")
    engine["notebook_bronze_id"] = (notebooks.get("NB_FMD_LOAD_LANDING_BRONZE") or {}).get("id", "")
    engine["notebook_silver_id"] = (notebooks.get("NB_FMD_LOAD_BRONZE_SILVER") or {}).get("id", "")
    engine["pipeline_copy_sql_id"] = (pipelines.get("PL_FMD_LDZ_COPY_SQL") or {}).get("id", "")
    engine["pipeline_workspace_id"] = (workspaces.get("code_dev") or {}).get("id", "")

    _write_raw_config(raw, config_path)
    sync_config_to_sqlite(config)

    results = [
        {"target": "config.json", "status": "ok", "details": str(config_path)},
        {"target": "sqlite mirror", "status": "ok", "details": str(db.DB_PATH)},
        {
            "target": "config backup",
            "status": "ok" if backup_path else "warning",
            "details": str(backup_path) if backup_path else "No previous config existed to back up",
        },
        {
            "target": "item_config.yaml",
            "status": "warning",
            "details": "Not written by one-click deployment yet; config.json is the runtime source of truth.",
        },
        {
            "target": "Fabric variable libraries",
            "status": "warning",
            "details": "Not written by this build; no Fabric variable-library writer is implemented.",
        },
    ]
    return results


def activate_deployment_profile(profile_key: str, *, config_path: Path = CONFIG_PATH) -> dict[str, Any]:
    profile = get_profile_api(profile_key)
    if not profile:
        raise ValueError(f"Deployment profile '{profile_key}' was not found")
    result = profile.get("result") or {}
    if not result:
        raise ValueError(f"Deployment profile '{profile_key}' has no deployment result to activate")
    required_failed = [
        step for step in profile.get("steps", [])
        if step.get("required", True) and step.get("status") not in {"succeeded"}
    ]
    if required_failed:
        raise ValueError("Cannot activate profile until all required deployment steps succeed")

    env_config = deployment_result_to_environment_config(result)
    propagation = save_environment_config(env_config, profile_key=profile_key, config_path=config_path)
    db.execute(
        "UPDATE deployment_profiles SET Status = 'deployed', UpdatedAt = ? "
        "WHERE Status = 'active' AND ProfileKey <> ?",
        (utc_now(), profile_key),
    )
    cpdb.upsert_deployment_profile(
        {
            "ProfileKey": profile_key,
            "DisplayName": profile["displayName"],
            "Status": "active",
            "AuthMode": profile.get("authMode", "service_principal"),
            "CapacityId": profile.get("capacityId", ""),
            "CapacityName": profile.get("capacityName", ""),
            "ConfigSnapshot": json_dumps(env_config),
            "ResourcePlan": json_dumps(profile.get("resourcePlan", [])),
            "ResultSnapshot": json_dumps(result),
            "ValidationSnapshot": json_dumps(profile.get("validation", {})),
            "ActivatedAt": utc_now(),
        }
    )
    return {"profileKey": profile_key, "status": "active", "config": env_config, "propagation": propagation}
