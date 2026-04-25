"""Verify that a real FMD smoke load wrote actual layer artifacts.

This script is intentionally independent from the running dashboard API. It
reads the local control-plane SQLite database, resolves the run's audited target
paths, and checks the physical OneLake mount when one is configured.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = PROJECT_ROOT / "dashboard" / "app" / "api" / "fmd_control_plane.db"
DEFAULT_CONFIG = PROJECT_ROOT / "dashboard" / "app" / "api" / "config.json"
LAYER_ORDER = ("landing", "bronze", "silver")
TERMINAL_RUN_STATUSES = {"succeeded", "failed", "interrupted", "aborted", "cancelled", "canceled", "stopped"}
SUCCESS_STATUSES = {"succeeded"}
SCD_COLUMNS = {"IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "IsDeleted"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    return value


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _load_dotenv(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not env_path.exists():
        return values
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _resolve_config_value(value: Any, env_values: dict[str, str]) -> Any:
    if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
        key = value[2:-1]
        return os.environ.get(key) or env_values.get(key, "")
    if isinstance(value, dict):
        return {key: _resolve_config_value(val, env_values) for key, val in value.items()}
    if isinstance(value, list):
        return [_resolve_config_value(item, env_values) for item in value]
    return value


def _configured_onelake_mount(config_path: Path) -> str:
    env_values = _load_dotenv(config_path.parent / ".env")
    explicit = os.environ.get("ONELAKE_MOUNT_PATH") or env_values.get("ONELAKE_MOUNT_PATH")
    if explicit:
        return explicit
    if not config_path.exists():
        return ""
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return ""
    resolved = _resolve_config_value(raw, env_values)
    engine_cfg = resolved.get("engine", {}) if isinstance(resolved, dict) else {}
    return str(engine_cfg.get("onelake_mount_path") or "")


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def _normalize_status(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_layer(value: str) -> str:
    layer = value.strip().lower()
    if layer == "landingzone":
        return "landing"
    if layer in {"lz", "landing_zone"}:
        return "landing"
    return layer


def _query_one(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...]) -> dict[str, Any] | None:
    return _row_to_dict(conn.execute(sql, params).fetchone())


def _query_all(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    return [_row_to_dict(row) or {} for row in conn.execute(sql, params).fetchall()]


def _load_entity_scope(conn: sqlite3.Connection, entity_id: int | None) -> list[dict[str, Any]]:
    sql = """
        SELECT
            le.LandingzoneEntityId AS landing_entity_id,
            le.SourceSchema AS source_schema,
            le.SourceName AS source_name,
            le.IsActive AS landing_active,
            COALESCE(NULLIF(ds.DisplayName, ''), ds.Name) AS source_display_name,
            COALESCE(NULLIF(ds.Namespace, ''), ds.Name) AS namespace,
            be.BronzeLayerEntityId AS bronze_entity_id,
            be.IsActive AS bronze_active,
            se.SilverLayerEntityId AS silver_entity_id,
            se.IsActive AS silver_active
        FROM lz_entities le
        LEFT JOIN datasources ds ON ds.DataSourceId = le.DataSourceId
        LEFT JOIN bronze_entities be ON be.LandingzoneEntityId = le.LandingzoneEntityId
        LEFT JOIN silver_entities se ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        WHERE (? IS NULL OR le.LandingzoneEntityId = ?)
        ORDER BY le.LandingzoneEntityId
    """
    return _query_all(conn, sql, (entity_id, entity_id))


def _layer_entity_id(entity: dict[str, Any], layer: str) -> int | None:
    if layer == "landing":
        return _coerce_int(entity.get("landing_entity_id"))
    if layer == "bronze":
        return _coerce_int(entity.get("bronze_entity_id"))
    if layer == "silver":
        return _coerce_int(entity.get("silver_entity_id"))
    return None


def _coerce_int(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _load_lakehouse_map(conn: sqlite3.Connection) -> dict[str, str]:
    rows = _query_all(conn, "SELECT LakehouseGuid, Name FROM lakehouses WHERE COALESCE(LakehouseGuid, '') <> ''")
    mapping: dict[str, str] = {}
    for row in rows:
        guid = str(row.get("LakehouseGuid") or "").strip().upper()
        name = str(row.get("Name") or "").strip()
        if guid and name:
            mapping[guid] = name
    return mapping


def _resolve_local_path(target_path: str, mount_path: str, lakehouse_map: dict[str, str]) -> tuple[str | None, str]:
    if not target_path:
        return None, "no_target_path"

    normalized = target_path.replace("\\", "/")
    if normalized.startswith("dagster://"):
        return None, "not_a_real_artifact_path"
    if normalized.startswith("abfss://") or normalized.startswith("https://"):
        return None, "remote_path"

    raw_path = Path(target_path)
    if raw_path.is_absolute():
        return str(raw_path), "absolute_path"

    if not mount_path:
        return None, "no_onelake_mount"

    parts = normalized.split("/", 1)
    if len(parts) < 2:
        return None, "unresolved_guid_path"

    guid = parts[0].upper()
    rest = parts[1]
    lakehouse_name = lakehouse_map.get(guid)
    if not lakehouse_name:
        return None, f"lakehouse_guid_not_mapped:{guid}"

    local_path = Path(mount_path) / f"{lakehouse_name}.Lakehouse" / Path(*rest.split("/"))
    return str(local_path), "resolved_from_lakehouse_guid"


def _delta_schema_columns(delta_path: Path) -> set[str]:
    log_dir = delta_path / "_delta_log"
    if not log_dir.exists():
        return set()

    latest_columns: set[str] = set()
    for log_file in sorted(log_dir.glob("*.json")):
        try:
            with log_file.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    entry = json.loads(line)
                    metadata = entry.get("metaData")
                    if not metadata:
                        continue
                    schema_string = metadata.get("schemaString")
                    if not schema_string:
                        continue
                    schema = json.loads(schema_string)
                    latest_columns = {
                        str(field.get("name"))
                        for field in schema.get("fields", [])
                        if field.get("name")
                    }
        except Exception:
            continue
    return latest_columns


def _artifact_check(
    *,
    layer: str,
    task: dict[str, Any],
    mount_path: str,
    lakehouse_map: dict[str, str],
) -> dict[str, Any]:
    target_path = str(task.get("TargetPath") or "")
    local_path, resolution = _resolve_local_path(target_path, mount_path, lakehouse_map)
    check: dict[str, Any] = {
        "targetPath": target_path,
        "localPath": local_path,
        "resolution": resolution,
        "status": "not_checked",
        "message": "No local OneLake mount is available for physical verification.",
    }

    if not local_path:
        if resolution == "remote_path":
            check["message"] = "Remote OneLake/ADLS path recorded; local verifier cannot physically inspect it."
        elif resolution.startswith("lakehouse_guid_not_mapped"):
            check["message"] = "Target lakehouse GUID is not present in the local lakehouses map."
        elif resolution == "not_a_real_artifact_path":
            check["message"] = "Task path is a Dagster orchestration receipt, not a lakehouse artifact."
        elif resolution == "no_target_path":
            check["message"] = "Task log did not record a target path."
        return check

    path = Path(local_path)
    if layer == "landing":
        exists = path.is_file()
        check["status"] = "passed" if exists else "failed"
        check["message"] = "Landing parquet exists." if exists else "Landing parquet is missing."
        check["sizeBytes"] = path.stat().st_size if exists else 0
        return check

    delta_log = path / "_delta_log"
    exists = path.is_dir() and delta_log.is_dir()
    check["status"] = "passed" if exists else "failed"
    check["message"] = f"{layer.title()} Delta table exists." if exists else f"{layer.title()} Delta _delta_log is missing."
    if exists and layer == "silver":
        columns = _delta_schema_columns(path)
        check["schemaColumns"] = sorted(columns)
        missing_scd = sorted(SCD_COLUMNS - columns)
        if missing_scd:
            check["status"] = "failed"
            check["message"] = "Silver Delta exists, but SCD Type 2 columns are missing: " + ", ".join(missing_scd)
        else:
            check["message"] = "Silver Delta exists and includes SCD Type 2 columns."
    return check


def _task_check(layer: str, task: dict[str, Any] | None) -> tuple[str, str]:
    if not task:
        return "failed", f"No engine_task_log row found for {layer}."
    status = _normalize_status(task.get("Status"))
    if status not in SUCCESS_STATUSES:
        return "failed", f"{layer} task status is {task.get('Status') or 'unknown'}."
    rows_read = int(task.get("RowsRead") or 0)
    rows_written = int(task.get("RowsWritten") or 0)
    bytes_transferred = int(task.get("BytesTransferred") or 0)
    if layer == "landing":
        if rows_read <= 0:
            return "failed", "Landing succeeded but RowsRead is zero."
        if rows_written <= 0:
            return "failed", "Landing succeeded but RowsWritten is zero."
        if bytes_transferred <= 0:
            return "failed", "Landing succeeded but BytesTransferred is zero."
    else:
        if rows_read <= 0:
            return "failed", f"{layer.title()} succeeded but RowsRead is zero."
        if rows_written < 0:
            return "failed", f"{layer.title()} RowsWritten is negative."
        if layer == "bronze" and rows_written <= 0:
            return "failed", "Bronze succeeded but RowsWritten is zero."
    if layer == "silver" and rows_written == 0:
        return "warning", "Silver wrote zero rows; this can be valid on a repeat SCD run, but review the target Delta table."
    return "passed", f"{layer.title()} task log row is internally consistent."


def _severity_rank(status: str) -> int:
    return {"failed": 3, "warning": 2, "not_checked": 1, "passed": 0}.get(status, 0)


def verify(args: argparse.Namespace) -> dict[str, Any]:
    db_path = Path(args.db_path).resolve()
    config_path = Path(args.config_path).resolve()
    layers = [_normalize_layer(layer) for layer in args.layers]
    mount_path = args.onelake_mount or _configured_onelake_mount(config_path)

    receipt: dict[str, Any] = {
        "ok": False,
        "generatedAt": _utc_now(),
        "runId": args.run_id,
        "entityId": args.entity_id,
        "dbPath": str(db_path),
        "onelakeMountPath": mount_path,
        "missionControlUrl": f"http://127.0.0.1:5288/mission-control?run={args.run_id}",
        "checks": [],
        "entities": [],
    }

    if not db_path.exists():
        receipt["checks"].append({
            "id": "control_plane_db",
            "status": "failed",
            "message": f"Control-plane DB not found: {db_path}",
        })
        return receipt

    conn = _connect(db_path)
    try:
        lakehouse_map = _load_lakehouse_map(conn)
        run = _query_one(conn, "SELECT * FROM engine_runs WHERE RunId = ?", (args.run_id,))
        run_status = _normalize_status(run.get("Status") if run else None)
        receipt["run"] = run

        if not run:
            receipt["checks"].append({"id": "engine_run", "status": "failed", "message": "engine_runs row is missing."})
        elif run_status not in TERMINAL_RUN_STATUSES:
            receipt["checks"].append({
                "id": "engine_run_terminal",
                "status": "failed",
                "message": f"Run is not terminal yet: {run.get('Status')}.",
            })
        elif run_status != "succeeded":
            receipt["checks"].append({
                "id": "engine_run_succeeded",
                "status": "failed",
                "message": f"Run ended as {run.get('Status')}.",
            })
        else:
            receipt["checks"].append({"id": "engine_run_succeeded", "status": "passed", "message": "engine_runs row is terminal and succeeded."})

        entity_rows = _load_entity_scope(conn, args.entity_id)
        if args.entity_id and not entity_rows:
            receipt["checks"].append({
                "id": "entity_scope",
                "status": "failed",
                "message": f"Landing entity {args.entity_id} was not found in lz_entities.",
            })

        for entity in entity_rows:
            landing_entity_id = _coerce_int(entity.get("landing_entity_id"))
            entity_result: dict[str, Any] = {
                "landingEntityId": landing_entity_id,
                "source": entity.get("source_display_name"),
                "qualifiedName": f"{entity.get('source_schema')}.{entity.get('source_name')}",
                "namespace": entity.get("namespace"),
                "layers": {},
            }
            for layer in layers:
                layer_entity_id = _layer_entity_id(entity, layer)
                if layer_entity_id is None:
                    layer_result = {
                        "status": "failed",
                        "entityId": None,
                        "message": f"No active {layer} metadata mapping exists for this landing entity.",
                    }
                    entity_result["layers"][layer] = layer_result
                    receipt["checks"].append({
                        "id": f"{layer}_metadata_{entity.get('landing_entity_id')}",
                        "status": "failed",
                        "message": layer_result["message"],
                    })
                    continue

                candidate_ids = [
                    entity_id
                    for entity_id in (landing_entity_id, layer_entity_id)
                    if entity_id is not None
                ]
                candidate_ids = list(dict.fromkeys(candidate_ids))
                placeholders = ",".join("?" for _ in candidate_ids)
                task = _query_one(
                    conn,
                    f"""
                    SELECT *
                    FROM engine_task_log
                    WHERE RunId = ?
                      AND LOWER(COALESCE(Layer, '')) = ?
                      AND EntityId IN ({placeholders})
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (args.run_id, layer, *candidate_ids),
                )
                task_status, task_message = _task_check(layer, task)
                artifact = _artifact_check(
                    layer=layer,
                    task=task or {},
                    mount_path=mount_path,
                    lakehouse_map=lakehouse_map,
                )
                artifact_status = str(artifact.get("status") or "not_checked")
                if artifact_status == "not_checked" and args.allow_unverified_artifacts:
                    artifact_status_for_rollup = "warning"
                else:
                    artifact_status_for_rollup = artifact_status

                layer_status = max(
                    (task_status, artifact_status_for_rollup),
                    key=_severity_rank,
                )
                layer_result = {
                    "status": layer_status,
                    "entityId": layer_entity_id,
                    "task": task,
                    "taskCheck": {"status": task_status, "message": task_message},
                    "artifactCheck": artifact,
                }
                entity_result["layers"][layer] = layer_result
                receipt["checks"].append({
                    "id": f"{layer}_{layer_entity_id}",
                    "status": layer_status,
                    "message": f"{task_message} Artifact: {artifact.get('message')}",
                })

            receipt["entities"].append(entity_result)
    finally:
        conn.close()

    failures = [check for check in receipt["checks"] if check.get("status") == "failed"]
    hard_unverified = [
        check
        for check in receipt["checks"]
        if check.get("status") == "not_checked" and not args.allow_unverified_artifacts
    ]
    receipt["ok"] = not failures and not hard_unverified
    receipt["summary"] = {
        "passed": sum(1 for check in receipt["checks"] if check.get("status") == "passed"),
        "warnings": sum(1 for check in receipt["checks"] if check.get("status") == "warning"),
        "notChecked": sum(1 for check in receipt["checks"] if check.get("status") == "not_checked"),
        "failed": len(failures),
    }
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a real FMD smoke load receipt.")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--entity-id", type=int)
    parser.add_argument("--layers", nargs="+", default=list(LAYER_ORDER))
    parser.add_argument("--db-path", default=str(DEFAULT_DB))
    parser.add_argument("--config-path", default=str(DEFAULT_CONFIG))
    parser.add_argument("--onelake-mount", default="")
    parser.add_argument("--output", default="")
    parser.add_argument(
        "--allow-unverified-artifacts",
        action="store_true",
        help="Do not hard-fail when TargetPath is remote or ONELAKE_MOUNT_PATH is unavailable.",
    )
    args = parser.parse_args()

    receipt = verify(args)
    output = json.dumps(receipt, indent=2, default=_json_default)
    if args.output:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output + "\n", encoding="utf-8")
    print(output)
    return 0 if receipt.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
