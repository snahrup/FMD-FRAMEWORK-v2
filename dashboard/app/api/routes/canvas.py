"""FMD Canvas routes.

The canvas is an authoring layer, not a replacement runtime.  It persists a
small FMD Flow DSL, validates the medallion graph, compiles an engine launch
payload, and delegates execution to the existing /api/engine/start contract.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from dashboard.app.api import db
from dashboard.app.api.router import HttpError, dispatch, route

log = logging.getLogger("fmd.routes.canvas")

FLOW_SCHEMA_VERSION = "fmd.flow/v1alpha1"
EXECUTABLE_NODE_TYPES = {
    "landing_zone",
    "bronze_transform",
    "silver_transform",
    "fabric_pipeline",
    "fabric_notebook",
    "external_adapter",
}
LAYER_NODE_TYPES = {
    "landing_zone": "landing",
    "bronze_transform": "bronze",
    "silver_transform": "silver",
}
MEDALLION_RANK = {
    "sql_source": 0,
    "landing_zone": 1,
    "bronze_transform": 2,
    "silver_transform": 3,
    "quality_gate": 4,
    "approval_gate": 5,
    "fabric_pipeline": 6,
    "fabric_notebook": 6,
    "external_adapter": 6,
}
SECRET_KEY_RE = re.compile(r"(password|secret|token|key|client_secret)", re.I)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _ensure_table() -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS canvas_flows (
            FlowId TEXT PRIMARY KEY,
            Name TEXT NOT NULL,
            Status TEXT NOT NULL DEFAULT 'draft',
            PayloadJson TEXT NOT NULL,
            ValidationJson TEXT,
            CreatedAt TEXT NOT NULL,
            UpdatedAt TEXT NOT NULL
        )
        """
    )


def _json_loads(raw: str | None, fallback: Any) -> Any:
    try:
        return json.loads(raw or "")
    except (TypeError, json.JSONDecodeError):
        return fallback


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    return bool(value)


def _coerce_entity_ids(raw: Any) -> list[int]:
    if raw is None:
        return []
    values = raw if isinstance(raw, list) else str(raw).split(",")
    entity_ids: list[int] = []
    for value in values:
        try:
            entity_id = int(value)
        except (TypeError, ValueError):
            continue
        if entity_id > 0 and entity_id not in entity_ids:
            entity_ids.append(entity_id)
    return entity_ids


def _default_entity() -> dict[str, Any]:
    rows = db.query(
        """
        SELECT le.LandingzoneEntityId AS entityId,
               ds.Name AS source,
               COALESCE(ds.DisplayName, ds.Name) AS sourceDisplay,
               le.SourceSchema AS sourceSchema,
               le.SourceName AS sourceName,
               COALESCE(le.IsIncremental, 0) AS isIncremental,
               le.IsIncrementalColumn AS watermarkColumn
        FROM lz_entities le
        JOIN datasources ds ON ds.DataSourceId = le.DataSourceId
        WHERE le.IsActive = 1
        ORDER BY le.LandingzoneEntityId
        LIMIT 1
        """
    )
    if rows:
        return rows[0]
    return {
        "entityId": 599,
        "source": "MES",
        "sourceDisplay": "MES",
        "sourceSchema": "dbo",
        "sourceName": "alel_lab_batch_hdr_tbl",
        "isIncremental": 0,
        "watermarkColumn": "",
    }


def _default_flow() -> dict[str, Any]:
    entity = _default_entity()
    entity_id = int(entity.get("entityId") or 599)
    source_name = str(entity.get("sourceDisplay") or entity.get("source") or "MES")
    schema = str(entity.get("sourceSchema") or "dbo")
    table = str(entity.get("sourceName") or "alel_lab_batch_hdr_tbl")
    watermark = str(entity.get("watermarkColumn") or "")
    now = _now()
    return {
        "apiVersion": FLOW_SCHEMA_VERSION,
        "id": "default-fmd-medallion",
        "name": "FMD Medallion Load",
        "description": "Governed SQL Server source through Landing Zone, Bronze, and Silver.",
        "status": "draft",
        "metadata": {
            "owner": "FMD Platform",
            "domain": source_name,
            "createdAt": now,
            "updatedAt": now,
        },
        "nodes": [
            {
                "id": "source-sql",
                "type": "sql_source",
                "label": f"{source_name} SQL Source",
                "config": {
                    "sourceSystem": source_name,
                    "schema": schema,
                    "object": table,
                    "entityIds": [entity_id],
                    "loadStrategy": "incremental" if entity.get("isIncremental") else "full",
                    "watermarkColumn": watermark,
                    "connectionRef": f"secret://connections/{source_name.lower()}",
                },
            },
            {
                "id": "landing-zone",
                "type": "landing_zone",
                "label": "Landing Zone",
                "config": {
                    "entityIds": [entity_id],
                    "format": "parquet",
                    "retryPolicy": "standard",
                    "executor": "fmd_framework",
                },
            },
            {
                "id": "bronze",
                "type": "bronze_transform",
                "label": "Bronze Delta",
                "config": {
                    "entityIds": [entity_id],
                    "retryPolicy": "standard",
                    "executor": "fmd_framework",
                    "schemaDriftPolicy": "warn",
                },
            },
            {
                "id": "silver",
                "type": "silver_transform",
                "label": "Silver SCD2",
                "config": {
                    "entityIds": [entity_id],
                    "retryPolicy": "standard",
                    "executor": "fmd_framework",
                    "qualityPolicy": "silver_standard",
                },
            },
            {
                "id": "quality-gate",
                "type": "quality_gate",
                "label": "Quality Gate",
                "config": {
                    "policy": "row_count_schema_and_delta_log",
                    "blocking": True,
                },
            },
        ],
        "edges": [
            {"id": "e-source-landing", "source": "source-sql", "target": "landing-zone"},
            {"id": "e-landing-bronze", "source": "landing-zone", "target": "bronze"},
            {"id": "e-bronze-silver", "source": "bronze", "target": "silver"},
            {"id": "e-silver-quality", "source": "silver", "target": "quality-gate"},
        ],
    }


def _normalise_flow(payload: dict[str, Any]) -> dict[str, Any]:
    flow = dict(payload or {})
    flow.setdefault("apiVersion", FLOW_SCHEMA_VERSION)
    flow.setdefault("id", "flow-" + str(abs(hash(json.dumps(flow, sort_keys=True))) % 1000000))
    flow.setdefault("name", "Untitled FMD Flow")
    flow.setdefault("status", "draft")
    flow.setdefault("metadata", {})
    flow.setdefault("nodes", [])
    flow.setdefault("edges", [])
    metadata = dict(flow.get("metadata") or {})
    metadata.setdefault("owner", "FMD Platform")
    metadata.setdefault("domain", "unassigned")
    metadata.setdefault("createdAt", _now())
    metadata["updatedAt"] = _now()
    flow["metadata"] = metadata
    return flow


def _node_map(flow: dict[str, Any]) -> dict[str, dict[str, Any]]:
    nodes = flow.get("nodes") if isinstance(flow.get("nodes"), list) else []
    return {str(node.get("id")): node for node in nodes if node.get("id")}


def _scan_secret_values(value: Any, path: str, errors: list[dict[str, str]]) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            nested_path = f"{path}.{key}" if path else str(key)
            if SECRET_KEY_RE.search(str(key)):
                if isinstance(nested, str) and nested and not nested.startswith("secret://"):
                    errors.append({
                        "code": "secret_literal",
                        "message": f"{nested_path} must use a secret:// reference, not a literal value.",
                    })
            _scan_secret_values(nested, nested_path, errors)
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _scan_secret_values(nested, f"{path}[{index}]", errors)


def _has_cycle(node_ids: set[str], edges: list[dict[str, Any]]) -> bool:
    graph = {node_id: [] for node_id in node_ids}
    for edge in edges:
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        if source in graph and target in graph:
            graph[source].append(target)

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> bool:
        if node_id in visiting:
            return True
        if node_id in visited:
            return False
        visiting.add(node_id)
        for child in graph.get(node_id, []):
            if visit(child):
                return True
        visiting.remove(node_id)
        visited.add(node_id)
        return False

    return any(visit(node_id) for node_id in node_ids)


def validate_flow(flow: dict[str, Any]) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    nodes = flow.get("nodes") if isinstance(flow.get("nodes"), list) else []
    edges = flow.get("edges") if isinstance(flow.get("edges"), list) else []
    by_id = _node_map(flow)
    node_ids = set(by_id.keys())

    if flow.get("apiVersion") != FLOW_SCHEMA_VERSION:
        errors.append({
            "code": "api_version",
            "message": f"apiVersion must be {FLOW_SCHEMA_VERSION}.",
        })
    if not nodes:
        errors.append({"code": "empty_graph", "message": "Add at least one source and one executable layer."})

    if len(node_ids) != len(nodes):
        errors.append({"code": "duplicate_node_id", "message": "Every canvas node must have a unique id."})

    incoming = {node_id: 0 for node_id in node_ids}
    outgoing = {node_id: 0 for node_id in node_ids}
    for edge in edges:
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        if source not in by_id:
            errors.append({"code": "unknown_edge_source", "message": f"Edge source {source!r} does not exist."})
            continue
        if target not in by_id:
            errors.append({"code": "unknown_edge_target", "message": f"Edge target {target!r} does not exist."})
            continue
        outgoing[source] += 1
        incoming[target] += 1
        source_type = str(by_id[source].get("type") or "")
        target_type = str(by_id[target].get("type") or "")
        if MEDALLION_RANK.get(target_type, 99) < MEDALLION_RANK.get(source_type, 99):
            errors.append({
                "code": "medallion_back_edge",
                "message": f"{by_id[source].get('label', source)} cannot flow backward into {by_id[target].get('label', target)}.",
            })
        if source_type == "sql_source" and target_type not in {"landing_zone", "fabric_pipeline", "external_adapter"}:
            errors.append({
                "code": "source_skip",
                "message": "SQL source nodes must land data before Bronze or Silver processing.",
            })

    if _has_cycle(node_ids, edges):
        errors.append({"code": "cycle", "message": "The canvas contains a cycle. FMD flows must be acyclic."})

    for node in nodes:
        node_id = str(node.get("id") or "")
        node_type = str(node.get("type") or "")
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        label = str(node.get("label") or node_id)
        if node_type not in MEDALLION_RANK:
            errors.append({"code": "unknown_node_type", "message": f"{label} has unsupported type {node_type!r}."})
        if node_type != "sql_source" and incoming.get(node_id, 0) == 0:
            errors.append({"code": "orphan_node", "message": f"{label} has no upstream input."})
        if node_type == "sql_source" and outgoing.get(node_id, 0) == 0:
            errors.append({"code": "orphan_source", "message": f"{label} is not connected to a load step."})
        if node_type in EXECUTABLE_NODE_TYPES and not config.get("retryPolicy"):
            errors.append({"code": "retry_policy", "message": f"{label} needs a retryPolicy before it can run."})
        if node_type in LAYER_NODE_TYPES and not _coerce_entity_ids(config.get("entityIds")):
            errors.append({"code": "entity_scope", "message": f"{label} needs at least one LandingzoneEntityId."})
        if node_type == "external_adapter" and _coerce_bool(config.get("enabled", True)):
            warnings.append({
                "code": "external_adapter_preview",
                "message": f"{label} is modeled for future adapter execution. MVP launch uses FMD/Fabric nodes only.",
            })

    _scan_secret_values(flow, "", errors)

    layer_nodes = {str(node.get("type")) for node in nodes}
    if "landing_zone" not in layer_nodes:
        errors.append({"code": "missing_landing", "message": "A runnable FMD flow needs a Landing Zone node."})
    if "bronze_transform" in layer_nodes and "landing_zone" not in layer_nodes:
        errors.append({"code": "missing_landing_for_bronze", "message": "Bronze requires Landing Zone first."})
    if "silver_transform" in layer_nodes and "bronze_transform" not in layer_nodes:
        errors.append({"code": "missing_bronze_for_silver", "message": "Silver requires Bronze first."})

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "summary": {
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "executableNodeCount": sum(1 for node in nodes if node.get("type") in EXECUTABLE_NODE_TYPES),
        },
        "checkedAt": _now(),
    }


def compile_run_plan(flow: dict[str, Any]) -> dict[str, Any]:
    nodes = flow.get("nodes") if isinstance(flow.get("nodes"), list) else []
    layers: list[str] = []
    entity_ids: list[int] = []
    steps: list[dict[str, Any]] = []
    adapter_steps: list[dict[str, Any]] = []

    for node in nodes:
        node_type = str(node.get("type") or "")
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        layer = LAYER_NODE_TYPES.get(node_type)
        node_entity_ids = _coerce_entity_ids(config.get("entityIds"))
        for entity_id in node_entity_ids:
            if entity_id not in entity_ids:
                entity_ids.append(entity_id)
        if layer and layer not in layers:
            layers.append(layer)
        if node_type in EXECUTABLE_NODE_TYPES:
            step = {
                "nodeId": node.get("id"),
                "label": node.get("label"),
                "type": node_type,
                "layer": layer,
                "executor": config.get("executor") or "fmd_framework",
                "entityIds": node_entity_ids,
                "retryPolicy": config.get("retryPolicy") or "standard",
            }
            steps.append(step)
            if node_type in {"fabric_pipeline", "fabric_notebook", "external_adapter"}:
                adapter_steps.append({
                    **step,
                    "status": "modeled",
                    "note": "Planned Fabric/external mirror only in this build. It does not create, sync, or run a Fabric artifact yet; execution remains routed through FMD/Dagster.",
                })

    if not layers:
        layers = ["landing", "bronze", "silver"]

    launch_payload = {
        "orchestrator": "dagster",
        "mode": "run",
        "dry_run": False,
        "dagster_mode": "framework",
        "layers": layers,
        "entity_ids": entity_ids,
        "triggered_by": "canvas",
        "resolved_entity_count": len(entity_ids),
        "canvas_flow_id": flow.get("id"),
        "canvas_flow_name": flow.get("name"),
    }

    return {
        "flowId": flow.get("id"),
        "flowName": flow.get("name"),
        "layers": layers,
        "entityIds": entity_ids,
        "steps": steps,
        "adapterSteps": adapter_steps,
        "launchPayload": launch_payload,
        "summary": {
            "layerCount": len(layers),
            "entityCount": len(entity_ids),
            "stepCount": len(steps),
            "adapterStepCount": len(adapter_steps),
            "adapterExecutionNote": (
                "Fabric/external mirror nodes are planned only in this build; they do not create or sync Fabric artifacts yet."
                if adapter_steps else None
            ),
        },
        "compiledAt": _now(),
    }


def _row_to_flow(row: dict[str, Any]) -> dict[str, Any]:
    flow = _json_loads(row.get("PayloadJson"), {})
    return {
        **flow,
        "id": row.get("FlowId") or flow.get("id"),
        "name": row.get("Name") or flow.get("name"),
        "status": row.get("Status") or flow.get("status", "draft"),
        "validation": _json_loads(row.get("ValidationJson"), None),
        "createdAt": row.get("CreatedAt"),
        "updatedAt": row.get("UpdatedAt"),
    }


def _load_flow(flow_id: str) -> dict[str, Any] | None:
    _ensure_table()
    rows = db.query("SELECT * FROM canvas_flows WHERE FlowId = ?", (flow_id,))
    if rows:
        return _row_to_flow(rows[0])
    if flow_id == "default-fmd-medallion":
        return _default_flow()
    return None


def _save_flow(flow: dict[str, Any], validation: dict[str, Any] | None = None) -> dict[str, Any]:
    _ensure_table()
    flow = _normalise_flow(flow)
    flow_id = str(flow.get("id"))
    now = _now()
    existing = db.query("SELECT CreatedAt FROM canvas_flows WHERE FlowId = ?", (flow_id,))
    created_at = existing[0]["CreatedAt"] if existing else now
    validation_json = json.dumps(validation) if validation else None
    db.execute(
        """
        INSERT INTO canvas_flows (FlowId, Name, Status, PayloadJson, ValidationJson, CreatedAt, UpdatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(FlowId) DO UPDATE SET
          Name = excluded.Name,
          Status = excluded.Status,
          PayloadJson = excluded.PayloadJson,
          ValidationJson = excluded.ValidationJson,
          UpdatedAt = excluded.UpdatedAt
        """,
        (
            flow_id,
            str(flow.get("name") or "Untitled FMD Flow"),
            str(flow.get("status") or "draft"),
            json.dumps(flow),
            validation_json,
            created_at,
            now,
        ),
    )
    stored = _load_flow(flow_id)
    return stored or flow


def _dispatch_engine_start(payload: dict[str, Any]) -> dict[str, Any]:
    import dashboard.app.api.routes.engine  # noqa: F401, PLC0415

    status, _headers, body = dispatch("POST", "/api/engine/start", {}, payload)
    parsed = _json_loads(body, {})
    if status >= 400:
        message = parsed.get("error") or parsed.get("message") or f"Engine start failed ({status})."
        raise HttpError(message, status)
    return parsed


@route("GET", "/api/canvas/flows")
def get_canvas_flows(params: dict) -> dict:
    _ensure_table()
    rows = db.query("SELECT * FROM canvas_flows ORDER BY UpdatedAt DESC")
    flows = [_row_to_flow(row) for row in rows]
    if not any(flow.get("id") == "default-fmd-medallion" for flow in flows):
        flows.insert(0, _default_flow())
    return {"flows": flows, "count": len(flows), "serverTime": _now()}


@route("POST", "/api/canvas/flows")
def post_canvas_flow(params: dict) -> dict:
    flow = params.get("flow") if isinstance(params.get("flow"), dict) else params
    flow = _normalise_flow(flow)
    validation = validate_flow(flow)
    stored = _save_flow(flow, validation)
    return {"flow": stored, "validation": validation, "serverTime": _now()}


@route("GET", "/api/canvas/flows/{flow_id}")
def get_canvas_flow(params: dict) -> dict:
    flow_id = str(params.get("flow_id") or "")
    flow = _load_flow(flow_id)
    if not flow:
        raise HttpError(f"Flow {flow_id!r} was not found.", 404)
    return {"flow": flow, "serverTime": _now()}


@route("POST", "/api/canvas/flows/{flow_id}/validate")
def post_canvas_validate(params: dict) -> dict:
    flow_id = str(params.get("flow_id") or "")
    flow = params.get("flow") if isinstance(params.get("flow"), dict) else _load_flow(flow_id)
    if not flow:
        raise HttpError(f"Flow {flow_id!r} was not found.", 404)
    flow = _normalise_flow(flow)
    validation = validate_flow(flow)
    _save_flow(flow, validation)
    return {"flowId": flow.get("id"), "validation": validation, "serverTime": _now()}


@route("POST", "/api/canvas/flows/{flow_id}/dry-run")
def post_canvas_dry_run(params: dict) -> dict:
    flow_id = str(params.get("flow_id") or "")
    flow = params.get("flow") if isinstance(params.get("flow"), dict) else _load_flow(flow_id)
    if not flow:
        raise HttpError(f"Flow {flow_id!r} was not found.", 404)
    flow = _normalise_flow(flow)
    validation = validate_flow(flow)
    plan = compile_run_plan(flow)
    _save_flow(flow, validation)
    return {
        "flowId": flow.get("id"),
        "validation": validation,
        "runPlan": plan,
        "serverTime": _now(),
    }


@route("POST", "/api/canvas/flows/{flow_id}/run")
def post_canvas_run(params: dict) -> dict:
    flow_id = str(params.get("flow_id") or "")
    flow = params.get("flow") if isinstance(params.get("flow"), dict) else _load_flow(flow_id)
    if not flow:
        raise HttpError(f"Flow {flow_id!r} was not found.", 404)
    flow = _normalise_flow(flow)
    validation = validate_flow(flow)
    plan = compile_run_plan(flow)
    _save_flow(flow, validation)
    if not validation.get("ok"):
        raise HttpError("Canvas flow has validation errors and cannot launch.", 400)
    if not plan["entityIds"]:
        raise HttpError("Canvas run plan has no explicit entity IDs. Refusing to launch a full-estate run.", 400)

    if _coerce_bool(params.get("previewOnly")):
        return {
            "flowId": flow.get("id"),
            "validation": validation,
            "runPlan": plan,
            "engine": {"previewOnly": True},
            "serverTime": _now(),
        }

    engine_result = _dispatch_engine_start(plan["launchPayload"])
    return {
        "flowId": flow.get("id"),
        "validation": validation,
        "runPlan": plan,
        "engine": engine_result,
        "serverTime": _now(),
    }
