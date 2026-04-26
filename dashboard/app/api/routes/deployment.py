"""One-click Fabric deployment routes."""

from __future__ import annotations

import json
import logging
from typing import Any

from dashboard.app.api import control_plane_db as cpdb
from dashboard.app.api.deployment_auth import (
    DelegatedOAuthFabricTokenProvider,
    FabricAuthError,
    get_auth_status,
    get_deployment_token_provider,
)
from dashboard.app.api.deployment_profiles import (
    activate_deployment_profile,
    build_preview_plan,
    deployment_result_to_environment_config,
    execute_resource_plan,
    get_profile_api,
    list_profiles_api,
    normalize_deployment_spec,
    persist_profile,
    persist_steps,
)
from dashboard.app.api.deployment_validation import validate_deployment_profile
from dashboard.app.api.fabric_deployment import FabricDeploymentClient, FabricDeploymentError
from dashboard.app.api.router import HttpError, route


log = logging.getLogger("fmd.routes.deployment")
_OAUTH_FLOWS: dict[str, dict[str, Any]] = {}


def _client_for(auth_mode: str) -> tuple[Any, FabricDeploymentClient]:
    provider = get_deployment_token_provider(auth_mode)
    return provider, FabricDeploymentClient(provider)


def _http_error_from_exc(exc: Exception, status: int = 400) -> HttpError:
    if isinstance(exc, FabricDeploymentError):
        return HttpError(str(exc), 502 if (exc.status or 500) >= 500 else 400)
    if isinstance(exc, FabricAuthError):
        return HttpError(str(exc), 503)
    return HttpError(str(exc), status)


def _step_summary(steps: list[dict[str, Any]]) -> dict[str, int]:
    result: dict[str, int] = {}
    for step in steps:
        status = str(step.get("status") or "pending")
        result[status] = result.get(status, 0) + 1
    return result


@route("GET", "/api/deployments/auth/status")
def get_deployment_auth_status(params: dict) -> dict:
    return get_auth_status()


@route("POST", "/api/deployments/oauth/start")
def post_deployment_oauth_start(params: dict) -> dict:
    provider = DelegatedOAuthFabricTokenProvider()
    try:
        flow = provider.start_device_flow()
    except Exception as exc:
        raise _http_error_from_exc(exc, 503) from exc
    flow_key = str(flow.get("userCode") or flow.get("deviceCode") or "default")
    _OAUTH_FLOWS[flow_key] = flow
    return {
        "deviceCode": flow.get("deviceCode", ""),
        "userCode": flow.get("userCode", ""),
        "verificationUri": flow.get("verificationUri", ""),
        "message": flow.get("message", ""),
        "expiresIn": flow.get("expiresIn"),
        "interval": flow.get("interval"),
    }


@route("POST", "/api/deployments/oauth/poll")
def post_deployment_oauth_poll(params: dict) -> dict:
    flow_key = str(params.get("userCode") or params.get("deviceCode") or "default")
    flow = _OAUTH_FLOWS.get(flow_key)
    if not flow:
        raise HttpError("OAuth device flow was not found or has expired. Start sign-in again.", 400)
    provider = DelegatedOAuthFabricTokenProvider()
    try:
        result = provider.poll_device_flow(flow)
    except Exception as exc:
        raise _http_error_from_exc(exc, 503) from exc
    if result.get("ok"):
        _OAUTH_FLOWS.pop(flow_key, None)
    return result


@route("GET", "/api/deployments")
def get_deployments(params: dict) -> dict:
    return list_profiles_api()


@route("GET", "/api/deployments/capacities")
def get_deployment_capacities(params: dict) -> dict:
    auth_mode = str(params.get("authMode") or "service_principal")
    try:
        _provider, client = _client_for(auth_mode)
        capacities = [
            {
                "id": item.get("id", ""),
                "displayName": item.get("displayName") or item.get("name", ""),
                "sku": item.get("sku", ""),
                "state": item.get("state", ""),
            }
            for item in client.list_capacities()
        ]
    except Exception as exc:
        raise _http_error_from_exc(exc, 502) from exc
    return {"capacities": sorted(capacities, key=lambda item: str(item["displayName"]).lower())}


@route("GET", "/api/deployments/{profileKey}")
def get_deployment(params: dict) -> dict:
    profile_key = str(params.get("profileKey", "")).strip()
    if not profile_key:
        raise HttpError("profileKey is required", 400)
    profile = get_profile_api(profile_key)
    if not profile:
        raise HttpError(f"Deployment profile '{profile_key}' was not found", 404)
    return profile


@route("POST", "/api/deployments/preview")
def post_deployment_preview(params: dict) -> dict:
    try:
        spec = normalize_deployment_spec(params)
        _provider, client = _client_for(spec["authMode"])
        steps = build_preview_plan(spec, client)
        persist_profile(spec, status="planned", resource_plan=steps)
        persist_steps(spec["profileKey"], steps)
    except ValueError as exc:
        raise HttpError(str(exc), 400) from exc
    except Exception as exc:
        raise _http_error_from_exc(exc, 502) from exc

    blocked = [step for step in steps if step.get("action") == "blocked" or (step.get("required", True) and step.get("status") == "failed")]
    warnings = [
        str((step.get("details") or {}).get("message"))
        for step in steps
        if step.get("action") == "warning" and isinstance(step.get("details"), dict) and (step.get("details") or {}).get("message")
    ]
    return {
        "profileKey": spec["profileKey"],
        "displayName": spec["displayName"],
        "status": "planned",
        "plan": {"steps": steps, "summary": _step_summary(steps)},
        "steps": steps,
        "blocked": blocked,
        "warnings": warnings,
    }


@route("POST", "/api/deployments/execute")
def post_deployment_execute(params: dict) -> dict:
    try:
        spec = normalize_deployment_spec(params)
        persist_profile(spec, status="deploying")
        _provider, client = _client_for(spec["authMode"])
        execution = execute_resource_plan(spec, client)
        result = execution["result"]
        steps = execution["steps"]
        persist_steps(spec["profileKey"], steps)
        persist_profile(
            spec,
            status=execution["status"],
            resource_plan=steps,
            result_snapshot=result,
        )
    except ValueError as exc:
        raise HttpError(str(exc), 400) from exc
    except Exception as exc:
        raise _http_error_from_exc(exc, 502) from exc

    return {
        "profileKey": spec["profileKey"],
        "displayName": spec["displayName"],
        "status": execution["status"],
        "steps": steps,
        "result": result,
        "config": deployment_result_to_environment_config(result),
        "warnings": [
            step.get("errorMessage") or (step.get("details") or {}).get("message")
            for step in steps
            if step.get("status") == "warning"
        ],
    }


@route("POST", "/api/deployments/{profileKey}/activate")
def post_deployment_activate(params: dict) -> dict:
    profile_key = str(params.get("profileKey", "")).strip()
    if not profile_key:
        raise HttpError("profileKey is required", 400)
    try:
        return activate_deployment_profile(profile_key)
    except Exception as exc:
        raise HttpError(str(exc), 400) from exc


@route("POST", "/api/deployments/{profileKey}/validate")
def post_deployment_validate(params: dict) -> dict:
    profile_key = str(params.get("profileKey", "")).strip()
    if not profile_key:
        raise HttpError("profileKey is required", 400)
    profile = get_profile_api(profile_key)
    if not profile:
        raise HttpError(f"Deployment profile '{profile_key}' was not found", 404)
    try:
        provider, client = _client_for(str(profile.get("authMode") or "service_principal"))
        proof = validate_deployment_profile(profile_key, client=client, token_provider=provider)
    except Exception as exc:
        raise _http_error_from_exc(exc, 502) from exc

    row = cpdb.get_deployment_profile(profile_key)
    if row:
        cpdb.upsert_deployment_profile(
            {
                "ProfileKey": row["ProfileKey"],
                "DisplayName": row["DisplayName"],
                "Status": "validated" if proof.get("ok") and row["Status"] != "active" else row["Status"],
                "AuthMode": row["AuthMode"],
                "CapacityId": row.get("CapacityId") or "",
                "CapacityName": row.get("CapacityName") or "",
                "ConfigSnapshot": row.get("ConfigSnapshot") or "{}",
                "ResourcePlan": row.get("ResourcePlan") or "{}",
                "ResultSnapshot": row.get("ResultSnapshot") or "{}",
                "ValidationSnapshot": json.dumps(proof),
                "ActivatedAt": row.get("ActivatedAt"),
            }
        )
    return proof


@route("POST", "/api/deployments/{profileKey}/resume")
def post_deployment_resume(params: dict) -> dict:
    profile_key = str(params.get("profileKey", "")).strip()
    profile = get_profile_api(profile_key)
    if not profile:
        raise HttpError(f"Deployment profile '{profile_key}' was not found", 404)
    resource_plan = profile.get("resourcePlan") or {}
    if not isinstance(resource_plan, dict):
        raise HttpError("This deployment profile does not contain a resumable resource plan", 400)
    spec = resource_plan.get("spec")
    if not isinstance(spec, dict):
        raise HttpError("This deployment profile does not contain a resumable resource spec", 400)
    spec["profileKey"] = profile_key
    return post_deployment_execute(spec)
