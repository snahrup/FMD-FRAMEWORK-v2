"""Config manager routes — CRUD for framework configuration.

Security fix applied:
    All DB update operations use SQLite parameterized queries.
    The original server.py used f-string interpolation for the Fabric SQL
    updates (e.g. "UPDATE ... WHERE WorkspaceId = {ws_id}").  While integer
    IDs aren't typically injectable, the pattern is incorrect.  All updates
    here use ? placeholders.

Covers:
    GET  /api/config-manager                — aggregate config view (DB + YAML + pipeline JSON)
    POST /api/config-manager/update         — update config value (parameterized)
    GET  /api/config-manager/references     — find all locations referencing a GUID
    GET  /api/notebook-config               — notebook setup configuration
    POST /api/notebook-config/update        — update notebook config value
"""
import json
import logging
import re
from pathlib import Path

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.config_manager")


def _queue_export(table: str):
    """Best-effort queue a Parquet export. No-op if pyarrow unavailable."""
    try:
        from dashboard.app.api.parquet_sync import queue_export
        queue_export(table)
    except (ImportError, Exception):
        pass

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent  # routes -> api -> app -> dashboard -> repo
_API_DIR = Path(__file__).resolve().parent.parent  # dashboard/app/api/


def _repo_root() -> Path:
    return _REPO_ROOT


def _read_yaml(path: Path) -> dict:
    """Minimal YAML-subset reader (no PyYAML dependency)."""
    result: dict = {}
    stack: list[tuple[int, dict]] = [(-1, result)]
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        stripped = raw_line.split("#")[0].rstrip()
        if not stripped or stripped.isspace():
            continue
        indent = len(raw_line) - len(raw_line.lstrip())
        while stack and stack[-1][0] >= indent:
            stack.pop()
        parent = stack[-1][1] if stack else result
        if ":" in stripped:
            key, _, val = stripped.partition(":")
            key = key.strip().strip('"').strip("'")
            val = val.strip().strip('"').strip("'")
            if val:
                parent[key] = val
            else:
                child: dict = {}
                parent[key] = child
                stack.append((indent, child))
    return result


# ---------------------------------------------------------------------------
# Config manager GET
# ---------------------------------------------------------------------------

@route("GET", "/api/config-manager")
def get_config_manager(params: dict) -> dict:
    """Aggregate configuration view from SQLite + repo files."""

    # SQLite records
    db_workspaces = db.query("SELECT WorkspaceId, WorkspaceGuid, Name FROM workspaces ORDER BY WorkspaceId")
    db_lakehouses = db.query(
        "SELECT LakehouseId, LakehouseGuid, WorkspaceGuid, Name FROM lakehouses ORDER BY LakehouseId"
    )
    db_connections = db.query(
        "SELECT ConnectionId, ConnectionGuid, Name, Type, IsActive FROM connections ORDER BY ConnectionId"
    )
    db_datasources = db.query(
        "SELECT DataSourceId, ConnectionId, Name, Namespace, Type, Description, IsActive "
        "FROM datasources ORDER BY DataSourceId"
    )
    db_pipelines = db.query(
        "SELECT PipelineId, Name, IsActive FROM pipelines ORDER BY PipelineId"
    )

    # item_config.yaml
    yaml_path = _repo_root() / "config" / "item_config.yaml"
    yaml_config: dict = _read_yaml(yaml_path) if yaml_path.is_file() else {}

    # Pipeline JSON configs
    pipeline_configs: list[dict] = []
    src_dir = _repo_root() / "src"
    if src_dir.is_dir():
        for pdir in sorted(src_dir.glob("*.DataPipeline")):
            pfile = pdir / "pipeline-content.json"
            if not pfile.is_file():
                continue
            try:
                pdata = json.loads(pfile.read_text(encoding="utf-8"))
                props = pdata.get("properties", {})
                params_dict = props.get("parameters", {})
                ws_param = params_dict.get("Data_WorkspaceGuid", {})
                ws_default = ws_param.get("defaultValue") if isinstance(ws_param, dict) else None
                raw = pfile.read_text(encoding="utf-8")
                conn_refs = set()
                for m in re.finditer(r'"connection"\s*:\s*"([0-9a-fA-F-]{36})"', raw):
                    conn_refs.add(m.group(1))
                pipeline_configs.append({
                    "name": pdir.name.replace(".DataPipeline", ""),
                    "wsParamDefault": ws_default,
                    "connectionRefs": sorted(conn_refs),
                    "allParams": {
                        k: v.get("defaultValue", "") if isinstance(v, dict) else v
                        for k, v in params_dict.items()
                    },
                })
            except Exception as ex:
                pipeline_configs.append({"name": pdir.name, "error": str(ex)})

    # Variable Library
    var_lib: dict = {"variables": [], "valueSets": {}}
    vl_dir = src_dir / "VAR_CONFIG_FMD.VariableLibrary" if src_dir.is_dir() else Path("nonexistent")
    vl_vars = vl_dir / "variables.json"
    if vl_vars.is_file():
        var_lib["variables"] = json.loads(vl_vars.read_text()).get("variables", [])
    vs_dir = vl_dir / "valueSets"
    if vs_dir.is_dir():
        for vs_file in sorted(vs_dir.glob("*.json")):
            vs_data = json.loads(vs_file.read_text())
            var_lib["valueSets"][vs_data.get("name", vs_file.stem)] = vs_data.get("variableOverrides", [])

    # dashboard config.json
    cfg_path = _API_DIR / "config.json"
    dash_config: dict = {}
    if cfg_path.is_file():
        try:
            dash_config = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Mismatch detection
    mismatches: list[dict] = []
    yaml_ws = yaml_config.get("workspaces", {})
    correct_data_dev = yaml_ws.get("workspace_data", "").lower()
    yaml_ws_guids = {v.lower() for v in yaml_ws.values() if v and v != "TBD"}
    for pc in pipeline_configs:
        ws_def = pc.get("wsParamDefault")
        if ws_def and correct_data_dev and ws_def.lower() != correct_data_dev:
            mismatches.append({
                "severity": "critical",
                "category": "pipeline_param",
                "pipeline": pc["name"],
                "field": "Data_WorkspaceGuid default",
                "current": ws_def,
                "expected": yaml_ws.get("workspace_data", ""),
                "message": f"Pipeline {pc['name']} has stale workspace GUID as default parameter",
            })
    for ws in db_workspaces:
        if ws.get("WorkspaceGuid", "").lower() not in yaml_ws_guids:
            mismatches.append({
                "severity": "warning",
                "category": "db_workspace",
                "field": ws.get("Name", ""),
                "current": ws.get("WorkspaceGuid", ""),
                "expected": "(not in item_config.yaml)",
                "message": f"DB workspace '{ws.get('Name')}' GUID not found in item_config.yaml",
            })

    return {
        "database": {
            "workspaces": db_workspaces,
            "lakehouses": db_lakehouses,
            "connections": db_connections,
            "datasources": db_datasources,
            "pipelines": db_pipelines,
        },
        "itemConfig": yaml_config,
        "pipelineConfigs": pipeline_configs,
        "variableLibrary": var_lib,
        "dashboardConfig": dash_config,
        "mismatches": mismatches,
        "fabricEntities": {"workspaces": {}, "items": {}},
        "fabricConnections": [],
    }


# ---------------------------------------------------------------------------
# Config update — PARAMETERIZED (security fix)
# ---------------------------------------------------------------------------

@route("POST", "/api/config-manager/update")
def post_config_update(params: dict) -> dict:
    """Update a config value.

    Security fix: all DB updates use SQLite parameterized queries (?),
    not f-string interpolation.  String values from the request body
    are never interpolated directly into SQL.
    """
    target = params.get("target", "")

    if target == "workspace":
        ws_id = int(params["workspaceId"])
        new_guid = params.get("newGuid", "").strip()
        new_name = params.get("newName", "").strip()
        if new_guid:
            db.execute("UPDATE workspaces SET WorkspaceGuid = ? WHERE WorkspaceId = ?", (new_guid, ws_id))
        if new_name:
            db.execute("UPDATE workspaces SET Name = ? WHERE WorkspaceId = ?", (new_name, ws_id))
        _queue_export("workspaces")
        return {"success": True, "updated": "workspace", "workspaceId": ws_id}

    elif target == "lakehouse":
        lh_id = int(params["lakehouseId"])
        if params.get("newGuid"):
            db.execute("UPDATE lakehouses SET LakehouseGuid = ? WHERE LakehouseId = ?",
                       (params["newGuid"].strip(), lh_id))
        if params.get("newWorkspaceGuid"):
            db.execute("UPDATE lakehouses SET WorkspaceGuid = ? WHERE LakehouseId = ?",
                       (params["newWorkspaceGuid"].strip(), lh_id))
        if params.get("newName"):
            db.execute("UPDATE lakehouses SET Name = ? WHERE LakehouseId = ?",
                       (params["newName"].strip(), lh_id))
        _queue_export("lakehouses")
        return {"success": True, "updated": "lakehouse", "lakehouseId": lh_id}

    elif target == "connection":
        conn_id = int(params["connectionId"])
        if params.get("newGuid"):
            db.execute("UPDATE connections SET ConnectionGuid = ? WHERE ConnectionId = ?",
                       (params["newGuid"].strip(), conn_id))
        if params.get("newType"):
            db.execute("UPDATE connections SET Type = ? WHERE ConnectionId = ?",
                       (params["newType"].strip(), conn_id))
        if params.get("newName"):
            db.execute("UPDATE connections SET Name = ? WHERE ConnectionId = ?",
                       (params["newName"].strip(), conn_id))
        _queue_export("connections")
        return {"success": True, "updated": "connection", "connectionId": conn_id}

    elif target == "datasource":
        ds_id = int(params["dataSourceId"])
        if params.get("newName"):
            db.execute("UPDATE datasources SET Name = ? WHERE DataSourceId = ?",
                       (params["newName"].strip(), ds_id))
        if params.get("newNamespace"):
            db.execute("UPDATE datasources SET Namespace = ? WHERE DataSourceId = ?",
                       (params["newNamespace"].strip(), ds_id))
        if params.get("newType"):
            db.execute("UPDATE datasources SET Type = ? WHERE DataSourceId = ?",
                       (params["newType"].strip(), ds_id))
        if params.get("newConnectionId"):
            db.execute("UPDATE datasources SET ConnectionId = ? WHERE DataSourceId = ?",
                       (int(params["newConnectionId"]), ds_id))
        if params.get("newIsActive") is not None:
            db.execute("UPDATE datasources SET IsActive = ? WHERE DataSourceId = ?",
                       (1 if params["newIsActive"] else 0, ds_id))
        _queue_export("datasources")
        return {"success": True, "updated": "datasource", "dataSourceId": ds_id}

    elif target == "pipeline_db":
        p_id = int(params["pipelineId"])
        if params.get("newGuid"):
            db.execute("UPDATE pipelines SET PipelineId = ? WHERE PipelineId = ?",
                       (params["newGuid"].strip(), p_id))
        if params.get("newName"):
            db.execute("UPDATE pipelines SET Name = ? WHERE PipelineId = ?",
                       (params["newName"].strip(), p_id))
        if params.get("newIsActive") is not None:
            db.execute("UPDATE pipelines SET IsActive = ? WHERE PipelineId = ?",
                       (1 if params["newIsActive"] else 0, p_id))
        _queue_export("pipelines")
        return {"success": True, "updated": "pipeline_db", "pipelineId": p_id}

    elif target == "pipeline_param":
        pipeline_name = params["pipelineName"]
        param_name = params["paramName"]
        new_value = params["newValue"].strip()
        pfile = _repo_root() / "src" / f"{pipeline_name}.DataPipeline" / "pipeline-content.json"
        if not pfile.is_file():
            raise HttpError(f"Pipeline file not found: {pfile}", 404)
        pdata = json.loads(pfile.read_text(encoding="utf-8"))
        param_entry = pdata.get("properties", {}).get("parameters", {}).get(param_name)
        if param_entry is None:
            raise HttpError(f"Parameter {param_name} not found in {pipeline_name}", 404)
        param_entry["defaultValue"] = new_value
        pfile.write_text(json.dumps(pdata, indent=2), encoding="utf-8")
        return {"success": True, "updated": "pipeline_param",
                "pipeline": pipeline_name, "param": param_name, "newValue": new_value}

    elif target == "pipeline_guid_replace":
        old_guid = params["oldGuid"].strip().lower()
        new_guid = params["newGuid"].strip()
        affected: list[str] = []
        src_dir = _repo_root() / "src"
        if src_dir.is_dir():
            for pdir in src_dir.glob("*.DataPipeline"):
                pfile = pdir / "pipeline-content.json"
                if not pfile.is_file():
                    continue
                content = pfile.read_text(encoding="utf-8")
                if old_guid in content.lower():
                    new_content = re.sub(re.escape(old_guid), new_guid, content, flags=re.IGNORECASE)
                    pfile.write_text(new_content, encoding="utf-8")
                    affected.append(pdir.name.replace(".DataPipeline", ""))
        return {"success": True, "updated": "pipeline_guid_replace",
                "oldGuid": old_guid, "newGuid": new_guid, "affected": affected}

    elif target == "dashboard_config":
        section = params["section"]
        key = params["key"]
        new_val = params["newValue"].strip()
        cfg_path = _API_DIR / "config.json"
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        if section not in cfg:
            raise HttpError(f"Unknown config section: {section}", 400)
        if key not in cfg[section]:
            raise HttpError(f"Unknown key {key} in section {section}", 400)
        cfg[section][key] = new_val
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
            f.write("\n")
        return {"success": True, "updated": "dashboard_config", "section": section,
                "key": key, "newValue": new_val}

    else:
        raise HttpError(f"Unknown target: {target}", 400)


# ---------------------------------------------------------------------------
# GUID reference finder
# ---------------------------------------------------------------------------

@route("GET", "/api/config-manager/references")
def get_config_references(params: dict) -> dict:
    """Find every location where a GUID appears across SQLite records."""
    guid = params.get("guid", "")
    if not guid:
        raise HttpError("guid parameter is required", 400)
    if len(guid) < 8:
        raise HttpError("GUID too short for reference search", 400)
    guid_lower = guid.strip().lower()
    refs: list[dict] = []

    ws_rows = db.query("SELECT WorkspaceId, WorkspaceGuid, Name FROM workspaces")
    for r in ws_rows:
        if (r.get("WorkspaceGuid") or "").lower() == guid_lower:
            refs.append({
                "location": f"Workspace #{r['WorkspaceId']} \"{r['Name']}\" → WorkspaceGuid",
                "target": "workspace",
                "params": {"workspaceId": r["WorkspaceId"]},
                "field": "newGuid",
            })

    lh_rows = db.query("SELECT LakehouseId, LakehouseGuid, WorkspaceGuid, Name FROM lakehouses")
    for r in lh_rows:
        if (r.get("LakehouseGuid") or "").lower() == guid_lower:
            refs.append({
                "location": f"Lakehouse #{r['LakehouseId']} \"{r['Name']}\" → LakehouseGuid",
                "target": "lakehouse",
                "params": {"lakehouseId": r["LakehouseId"]},
                "field": "newGuid",
            })
        if (r.get("WorkspaceGuid") or "").lower() == guid_lower:
            refs.append({
                "location": f"Lakehouse #{r['LakehouseId']} \"{r['Name']}\" → WorkspaceGuid",
                "target": "lakehouse",
                "params": {"lakehouseId": r["LakehouseId"]},
                "field": "newWorkspaceGuid",
            })

    conn_rows = db.query("SELECT ConnectionId, ConnectionGuid, Name FROM connections")
    for r in conn_rows:
        if (r.get("ConnectionGuid") or "").lower() == guid_lower:
            refs.append({
                "location": f"Connection #{r['ConnectionId']} \"{r['Name']}\" → ConnectionGuid",
                "target": "connection",
                "params": {"connectionId": r["ConnectionId"]},
                "field": "newGuid",
            })

    p_rows = db.query("SELECT PipelineId, Name FROM pipelines")
    for r in p_rows:
        refs_append = False
        # pipelines table has no GUIDs in SQLite schema; skip GUID match for pipelines
        _ = refs_append  # nothing to match on pipelines table in SQLite

    # Scan pipeline JSON files
    src_dir = _repo_root() / "src"
    if src_dir.is_dir():
        for pdir in src_dir.glob("*.DataPipeline"):
            pfile = pdir / "pipeline-content.json"
            if pfile.is_file():
                try:
                    content = pfile.read_text(encoding="utf-8")
                    if guid_lower in content.lower():
                        pipeline_name = pdir.name.replace(".DataPipeline", "")
                        refs.append({
                            "location": f"Pipeline JSON: {pipeline_name}",
                            "target": "pipeline_guid_replace",
                            "params": {"pipelineName": pipeline_name},
                            "field": "newGuid",
                        })
                except Exception:
                    pass

    return {"guid": guid, "references": refs}


# ---------------------------------------------------------------------------
# Notebook config
# ---------------------------------------------------------------------------

@route("GET", "/api/notebook-config")
def get_notebook_config(params: dict) -> dict:
    """Notebook setup configuration from repo files."""
    src_dir = _repo_root() / "src"
    yaml_path = _repo_root() / "config" / "item_config.yaml"
    yaml_config = _read_yaml(yaml_path) if yaml_path.is_file() else {}

    def _read_var_lib(dir_path: Path) -> dict:
        result: dict = {"variables": [], "valueSets": {}}
        vf = dir_path / "variables.json"
        if vf.is_file():
            result["variables"] = json.loads(vf.read_text(encoding="utf-8")).get("variables", [])
        vs_dir = dir_path / "valueSets"
        if vs_dir.is_dir():
            for vs_file in sorted(vs_dir.glob("*.json")):
                vs_data = json.loads(vs_file.read_text(encoding="utf-8"))
                result["valueSets"][vs_data.get("name", vs_file.stem)] = vs_data.get("variableOverrides", [])
        return result

    var_config = _read_var_lib(src_dir / "VAR_CONFIG_FMD.VariableLibrary") if src_dir.is_dir() else {}
    var_fmd = _read_var_lib(src_dir / "VAR_FMD.VariableLibrary") if src_dir.is_dir() else {}

    return {
        "itemConfig": yaml_config,
        "varConfigFmd": var_config,
        "varFmd": var_fmd,
        "templateMapping": {},
        "missingConnections": [],
    }


@route("POST", "/api/notebook-config/update")
def post_notebook_config_update(params: dict) -> dict:
    """Update a notebook configuration value (item_config.yaml or variable library)."""
    target = params.get("target", "")

    if target == "item_config":
        section = params["section"]
        key = params["key"]
        new_val = params["newValue"].strip()
        yaml_path = _repo_root() / "config" / "item_config.yaml"
        yaml_data = _read_yaml(yaml_path) if yaml_path.is_file() else {}
        if section not in yaml_data:
            raise HttpError(f"Section {section} not found in item_config.yaml", 404)
        sec = yaml_data[section]
        if not isinstance(sec, dict):
            raise HttpError(f"Section {section} is not a dict", 400)
        sec[key] = new_val
        # Write back simple YAML structure
        lines = []
        for sec_name, sec_val in yaml_data.items():
            lines.append(f"{sec_name}:")
            if isinstance(sec_val, dict):
                for k, v in sec_val.items():
                    lines.append(f'    {k}: "{v}"')
            lines.append("")
        yaml_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return {"success": True, "updated": "item_config", "section": section, "key": key, "newValue": new_val}

    elif target in ("var_config_fmd", "var_fmd"):
        dir_name = "VAR_CONFIG_FMD.VariableLibrary" if target == "var_config_fmd" else "VAR_FMD.VariableLibrary"
        var_name = params["variableName"]
        new_val = params["newValue"].strip()
        var_path = _repo_root() / "src" / dir_name / "variables.json"
        if not var_path.is_file():
            raise HttpError(f"Variable library not found: {var_path}", 404)
        data = json.loads(var_path.read_text(encoding="utf-8"))
        for v in data.get("variables", []):
            if v["name"] == var_name:
                v["value"] = new_val
                break
        else:
            raise HttpError(f"Variable {var_name} not found", 404)
        var_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        return {"success": True, "updated": target, "variable": var_name, "newValue": new_val}

    else:
        raise HttpError(f"Unknown target: {target}", 400)
