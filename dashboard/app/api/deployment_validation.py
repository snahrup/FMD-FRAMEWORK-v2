"""Deployment proof checks for handoff readiness."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from dashboard.app.api.deployment_profiles import CONFIG_PATH, get_profile_api, json_loads


def _check(check_id: str, label: str, status: str, details: str, evidence: Any = None) -> dict[str, Any]:
    item = {"id": check_id, "label": label, "status": status, "details": details}
    if evidence is not None:
        item["evidence"] = evidence
    return item


def _load_config(config_path: Path = CONFIG_PATH) -> dict[str, Any]:
    if not config_path.exists():
        return {}
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _resolve_env_value(value: Any) -> Any:
    if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
        return os.environ.get(value[2:-1], "")
    if isinstance(value, dict):
        return {key: _resolve_env_value(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_resolve_env_value(val) for val in value]
    return value


def _configured_mount(config: dict[str, Any]) -> str:
    explicit = os.environ.get("ONELAKE_MOUNT_PATH")
    if explicit:
        return explicit
    engine = config.get("engine", {}) if isinstance(config.get("engine"), dict) else {}
    configured = engine.get("onelake_mount_path", "")
    if configured:
        return str(configured)
    default = Path.home() / "OneLake - Microsoft"
    return str(default) if default.exists() else ""


def _find_lakehouse_dir(mount: Path, lakehouse_name: str) -> Path | None:
    direct = mount / f"{lakehouse_name}.Lakehouse"
    if direct.exists():
        return direct
    try:
        for candidate in mount.glob(f"*/{lakehouse_name}.Lakehouse"):
            if candidate.exists():
                return candidate
    except Exception:
        return None
    return None


def _one_lake_probe(profile_key: str, profile: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
    mount_raw = _configured_mount(config)
    if not mount_raw:
        return [
            _check(
                "onelake_mount",
                "OneLake mount",
                "warning",
                "No local OneLake mount is configured. Set engine.onelake_mount_path or ONELAKE_MOUNT_PATH to enable physical probe checks.",
            )
        ]
    mount = Path(mount_raw)
    if not mount.exists():
        return [_check("onelake_mount", "OneLake mount", "failed", f"Configured OneLake mount does not exist: {mount}")]

    result = profile.get("result") or {}
    lakehouses = result.get("lakehouses") if isinstance(result.get("lakehouses"), dict) else {}
    landing = lakehouses.get("landing") or {}
    bronze = lakehouses.get("bronze") or {}
    landing_name = str(landing.get("displayName") or "LH_FMD_LANDING")
    bronze_name = str(bronze.get("displayName") or "LH_FMD_BRONZE")
    landing_dir = _find_lakehouse_dir(mount, landing_name)
    bronze_dir = _find_lakehouse_dir(mount, bronze_name)

    checks: list[dict[str, Any]] = []
    if not landing_dir:
        checks.append(_check("onelake_landing", "OneLake landing lakehouse", "warning", f"Could not locate {landing_name}.Lakehouse under {mount}"))
    else:
        checks.append(_check("onelake_landing", "OneLake landing lakehouse", "passed", f"Found {landing_dir}"))

    if not bronze_dir:
        checks.append(_check("onelake_bronze", "OneLake bronze lakehouse", "warning", f"Could not locate {bronze_name}.Lakehouse under {mount}"))
        return checks

    try:
        import pyarrow as pa  # type: ignore
        import pyarrow.parquet as pq  # type: ignore
    except Exception as exc:
        checks.append(_check("onelake_parquet", "OneLake parquet probe", "warning", f"pyarrow is unavailable in this runtime: {exc}"))
    else:
        try:
            probe_dir = bronze_dir / "Files" / "_fmd_probe" / profile_key
            probe_dir.mkdir(parents=True, exist_ok=True)
            probe_file = probe_dir / "deployment_probe.parquet"
            table = pa.table({"profile_key": [profile_key], "probe": ["deployment"]})
            pq.write_table(table, probe_file)
            read_back = pq.read_table(probe_file)
            status = "passed" if read_back.num_rows == 1 else "failed"
            checks.append(_check("onelake_parquet", "OneLake parquet probe", status, f"Wrote and read {probe_file}", {"rows": read_back.num_rows}))
        except Exception as exc:
            checks.append(_check("onelake_parquet", "OneLake parquet probe", "failed", str(exc)))

    try:
        import pyarrow as pa  # type: ignore
        from deltalake.writer import write_deltalake  # type: ignore
    except Exception as exc:
        checks.append(_check("onelake_delta", "OneLake Delta probe", "warning", f"deltalake/pyarrow is unavailable in this runtime: {exc}"))
    else:
        try:
            delta_dir = bronze_dir / "Tables" / "_fmd_probe" / f"{profile_key}_deployment_probe"
            delta_dir.mkdir(parents=True, exist_ok=True)
            table = pa.table({"profile_key": [profile_key], "probe": ["deployment"]})
            write_deltalake(str(delta_dir), table, mode="overwrite")
            status = "passed" if (delta_dir / "_delta_log").exists() else "failed"
            checks.append(_check("onelake_delta", "OneLake Delta probe", status, f"Wrote Delta probe to {delta_dir}"))
        except Exception as exc:
            checks.append(_check("onelake_delta", "OneLake Delta probe", "failed", str(exc)))

    return checks


def _dagster_graphql_url(config: dict[str, Any]) -> str:
    dagster = config.get("dagster", {}) if isinstance(config.get("dagster"), dict) else {}
    base = os.environ.get("FMD_DAGSTER_UI_URL") or dagster.get("ui_url") or "http://127.0.0.1:3006"
    return str(os.environ.get("FMD_DAGSTER_GRAPHQL_URL") or dagster.get("graphql_url") or f"{base.rstrip('/')}/graphql")


def _probe_dagster(config: dict[str, Any]) -> dict[str, Any]:
    graphql_url = _dagster_graphql_url(config)
    payload = json.dumps({"query": "{__typename}"}).encode("utf-8")
    req = urllib.request.Request(
        graphql_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return _check("dagster_graphql", "Dagster GraphQL", "passed", f"Dagster reachable at {graphql_url}", {"status": resp.status})
    except urllib.error.URLError as exc:
        return _check("dagster_graphql", "Dagster GraphQL", "warning", f"Dagster is not reachable at {graphql_url}: {exc.reason}")
    except Exception as exc:
        return _check("dagster_graphql", "Dagster GraphQL", "warning", f"Dagster probe failed at {graphql_url}: {exc}")


def validate_deployment_profile(profile_key: str, client=None, token_provider=None, config_path: Path = CONFIG_PATH) -> dict[str, Any]:
    profile = get_profile_api(profile_key)
    if not profile:
        raise ValueError(f"Deployment profile '{profile_key}' was not found")

    config = _resolve_env_value(_load_config(config_path))
    result = profile.get("result") or {}
    checks: list[dict[str, Any]] = []

    if token_provider is not None:
        try:
            token_provider.get_token()
            checks.append(_check("fabric_token", "Fabric token", "passed", "Fabric token acquired."))
        except Exception as exc:
            checks.append(_check("fabric_token", "Fabric token", "failed", str(exc)))
    else:
        checks.append(_check("fabric_token", "Fabric token", "skipped", "No token provider supplied to validator."))

    if client is not None:
        try:
            capacity_id = profile.get("capacityId", "")
            capacities = client.list_capacities()
            visible = any(str(item.get("id", "")).lower() == str(capacity_id).lower() for item in capacities)
            checks.append(
                _check(
                    "capacity",
                    "Fabric capacity",
                    "passed" if visible else "warning",
                    "Target capacity is visible." if visible else "Target capacity was not returned by Fabric list-capacities.",
                    {"capacityId": capacity_id},
                )
            )
        except Exception as exc:
            checks.append(_check("capacity", "Fabric capacity", "warning", str(exc)))

        try:
            workspace_ids = {
                key: item.get("id")
                for key, item in (result.get("workspaces") or {}).items()
                if isinstance(item, dict) and item.get("id")
            }
            workspaces = client.list_workspaces()
            seen = {str(item.get("id", "")).lower() for item in workspaces}
            missing = [key for key, item_id in workspace_ids.items() if str(item_id).lower() not in seen]
            checks.append(
                _check(
                    "workspaces",
                    "Fabric workspaces",
                    "passed" if not missing else "failed",
                    "All configured workspaces are visible." if not missing else f"Missing workspaces: {', '.join(missing)}",
                    workspace_ids,
                )
            )
        except Exception as exc:
            checks.append(_check("workspaces", "Fabric workspaces", "warning", str(exc)))

        try:
            data_workspace_id = ((result.get("workspaces") or {}).get("data_dev") or {}).get("id", "")
            lakehouse_ids = {
                key: item.get("id")
                for key, item in (result.get("lakehouses") or {}).items()
                if isinstance(item, dict) and item.get("id")
            }
            lakehouses = client.list_lakehouses(data_workspace_id) if data_workspace_id else []
            seen = {str(item.get("id", "")).lower() for item in lakehouses}
            missing = [key for key, item_id in lakehouse_ids.items() if str(item_id).lower() not in seen]
            checks.append(
                _check(
                    "lakehouses",
                    "Fabric lakehouses",
                    "passed" if not missing else "failed",
                    "Landing, bronze, and silver lakehouses are visible." if not missing else f"Missing lakehouses: {', '.join(missing)}",
                    lakehouse_ids,
                )
            )
        except Exception as exc:
            checks.append(_check("lakehouses", "Fabric lakehouses", "warning", str(exc)))
    else:
        checks.append(_check("capacity", "Fabric capacity", "skipped", "No Fabric client supplied."))
        checks.append(_check("workspaces", "Fabric workspaces", "skipped", "No Fabric client supplied."))
        checks.append(_check("lakehouses", "Fabric lakehouses", "skipped", "No Fabric client supplied."))

    sql = config.get("sql", {}) if isinstance(config.get("sql"), dict) else {}
    db_result = result.get("database") if isinstance(result.get("database"), dict) else {}
    if sql.get("server") and sql.get("database"):
        checks.append(_check("sql_metadata", "SQL metadata", "passed", "SQL metadata endpoint is configured.", {"server": sql.get("server"), "database": sql.get("database")}))
    elif db_result and db_result.get("id"):
        checks.append(_check("sql_metadata", "SQL metadata", "warning", "SQL database item exists, but server/database endpoint fields are not populated yet.", db_result))
    else:
        checks.append(_check("sql_metadata", "SQL metadata", "failed", "No SQL metadata database binding is configured."))

    checks.extend(_one_lake_probe(profile_key, profile, config))
    checks.append(_probe_dagster(config))
    checks.append(_check("real_smoke", "Real smoke load", "not_run", "Run scripts/run_real_smoke_load.ps1 after activation to attach a real smoke receipt."))

    failed = [item for item in checks if item["status"] == "failed"]
    warnings = [item for item in checks if item["status"] in {"warning", "not_run", "skipped"}]
    return {
        "ok": not failed,
        "checks": checks,
        "warnings": [item["details"] for item in warnings],
    }
