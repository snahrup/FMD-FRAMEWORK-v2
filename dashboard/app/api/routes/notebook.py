"""Notebook debug and setup routes.

Covers:
    GET  /api/notebook-debug/notebooks   — list available Fabric notebooks
    GET  /api/notebook-debug/entities    — list entities for a given layer
    POST /api/notebook-debug/run         — trigger a notebook run against entities
    GET  /api/notebook-debug/job-status  — poll notebook job run status
    POST /api/notebook/trigger           — trigger the framework setup notebook
    GET  /api/notebook/job-status        — poll setup notebook job status
"""
import json
import logging
import re
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.notebook")

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _is_valid_uuid(value: str) -> bool:
    """Check if a string is a valid UUID format."""
    return bool(_UUID_RE.match(value))


def _normalize_failure_reason(raw) -> dict | None:
    """Normalize failureReason from Fabric API into {message, errorCode} dict.

    The Fabric API may return failureReason as a dict, a string, or None.
    The frontend expects {message: string, errorCode: string} or null.
    """
    if not raw:
        return None
    if isinstance(raw, dict):
        return {
            "message": raw.get("message", json.dumps(raw)),
            "errorCode": raw.get("errorCode", "unknown"),
        }
    return {"message": str(raw), "errorCode": "unknown"}


# ---------------------------------------------------------------------------
# Config helpers (same pattern as pipeline.py)
# ---------------------------------------------------------------------------

_CONFIG: dict | None = None


def _get_config() -> dict:
    global _CONFIG
    if _CONFIG is None:
        try:
            cfg_path = Path(__file__).parent.parent / "config.json"
            _CONFIG = json.loads(cfg_path.read_text())
        except Exception as e:
            log.warning("Failed to load config.json: %s", e)
            _CONFIG = {}
    return _CONFIG


def _get_fabric_token(scope: str = "https://api.fabric.microsoft.com/.default") -> str:
    """Obtain a Fabric/AAD bearer token via service principal credentials."""
    cfg = _get_config()
    tenant = cfg.get("fabric", {}).get("tenant_id", "")
    client_id = cfg.get("fabric", {}).get("client_id", "")
    client_secret = cfg.get("fabric", {}).get("client_secret", "")

    if not tenant or not client_id or not client_secret:
        raise HttpError(
            "Fabric credentials not configured in config.json "
            "(fabric.tenant_id, fabric.client_id, fabric.client_secret)",
            503,
        )

    url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": scope,
    }).encode()
    req = urllib.request.Request(url, data=data)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read())["access_token"]
    except Exception as e:
        raise HttpError(f"Failed to acquire Fabric token: {e}", 503)


def _fabric_get(url: str, token: str, timeout: int = 20) -> dict:
    """GET a Fabric REST API endpoint and return parsed JSON."""
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    resp = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(resp.read())


def _fabric_post(url: str, token: str, body: bytes = b"{}", timeout: int = 30):
    """POST to a Fabric REST API endpoint and return (response, headers)."""
    req = urllib.request.Request(
        url,
        method="POST",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    return urllib.request.urlopen(req, timeout=timeout)


# ---------------------------------------------------------------------------
# Notebook listing helpers
# ---------------------------------------------------------------------------

def _get_workspace_id() -> str:
    """Return the CODE workspace GUID from config."""
    cfg = _get_config()
    return cfg.get("fabric", {}).get("workspace_code_id", "")


def _list_fabric_notebooks(workspace_id: str, token: str) -> list[dict]:
    """List notebooks from Fabric REST API."""
    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/notebooks"
    data = _fabric_get(url, token)
    notebooks = []
    for item in data.get("value", []):
        notebooks.append({
            "id": item.get("id", ""),
            "name": item.get("displayName", item.get("name", "")),
        })
    return notebooks


def _list_notebooks_from_config() -> list[dict]:
    """Fallback: build notebook list from config.json engine section."""
    cfg = _get_config()
    engine = cfg.get("engine", {})
    notebooks = []
    nb_map = {
        "notebook_processing_id": "NB_FMD_PROCESSING_PARALLEL_MAIN",
        "notebook_lz_id": "NB_FMD_PROCESSING_LANDINGZONE_MAIN",
        "notebook_bronze_id": "NB_FMD_LOAD_LANDING_BRONZE",
        "notebook_silver_id": "NB_FMD_LOAD_BRONZE_SILVER",
        "notebook_maintenance_id": "NB_FMD_MAINTENANCE",
    }
    for key, name in nb_map.items():
        nb_id = engine.get(key, "")
        if nb_id:
            notebooks.append({"id": nb_id, "name": name})
    return notebooks


# ---------------------------------------------------------------------------
# GET /api/notebook-debug/notebooks
# ---------------------------------------------------------------------------

@route("GET", "/api/notebook-debug/notebooks")
def get_notebooks(params: dict) -> dict:
    """List available Fabric notebooks for the debug runner."""
    try:
        ws_id = _get_workspace_id()
        if not ws_id:
            return {"notebooks": _list_notebooks_from_config()}
        token = _get_fabric_token()
        notebooks = _list_fabric_notebooks(ws_id, token)
        if not notebooks:
            notebooks = _list_notebooks_from_config()
        return {"notebooks": notebooks}
    except HttpError:
        # Token / config issues — fall back to config-based list
        log.exception("Token/config error listing Fabric notebooks, using config fallback")
        return {"notebooks": _list_notebooks_from_config()}
    except Exception as e:
        log.warning("Failed to list Fabric notebooks, using config fallback: %s", e)
        return {"notebooks": _list_notebooks_from_config()}


# ---------------------------------------------------------------------------
# GET /api/notebook-debug/entities
# ---------------------------------------------------------------------------

@route("GET", "/api/notebook-debug/entities")
def get_debug_entities(params: dict) -> dict:
    """List entities for a given layer that can be tested."""
    layer = params.get("layer", "landing")

    if layer == "landing":
        rows = db.query(
            "SELECT le.LandingzoneEntityId, "
            "  ds.Namespace AS namespace, "
            "  le.SourceSchema AS schema, "
            "  le.SourceName AS [table], "
            "  le.FileName AS fileName "
            "FROM lz_entities le "
            "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            "WHERE le.IsActive = 1 "
            "ORDER BY ds.Namespace, le.SourceSchema, le.SourceName"
        )
    elif layer == "bronze":
        rows = db.query(
            "SELECT be.BronzeLayerEntityId, "
            "  ds.Namespace AS namespace, "
            "  le.SourceSchema AS schema, "
            "  le.SourceName AS [table], "
            "  le.FileName AS fileName "
            "FROM bronze_entities be "
            "JOIN lz_entities le ON be.LandingzoneEntityId = le.LandingzoneEntityId "
            "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            "WHERE be.IsActive = 1 "
            "ORDER BY ds.Namespace, le.SourceSchema, le.SourceName"
        )
    elif layer == "silver":
        rows = db.query(
            "SELECT se.SilverLayerEntityId, "
            "  ds.Namespace AS namespace, "
            "  le.SourceSchema AS schema, "
            "  le.SourceName AS [table], "
            "  le.FileName AS fileName "
            "FROM silver_entities se "
            "JOIN bronze_entities be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId "
            "JOIN lz_entities le ON be.LandingzoneEntityId = le.LandingzoneEntityId "
            "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            "WHERE se.IsActive = 1 "
            "ORDER BY ds.Namespace, le.SourceSchema, le.SourceName"
        )
    else:
        raise HttpError(f"Unknown layer: {layer}. Expected landing, bronze, or silver.", 400)

    entities = []
    for r in rows:
        entities.append({
            "namespace": r.get("namespace") or "",
            "schema": r.get("schema") or "",
            "table": r.get("table") or "",
            "fileName": r.get("fileName") or "",
        })

    return {"entities": entities}


# ---------------------------------------------------------------------------
# POST /api/notebook-debug/run
# ---------------------------------------------------------------------------

@route("POST", "/api/notebook-debug/run")
def post_debug_run(params: dict) -> dict:
    """Trigger a notebook run against selected entities.

    The Fabric Jobs API triggers notebook execution with optional parameters.
    The notebook itself reads which entities to process from the metadata DB,
    filtered by the parameters we pass.
    """
    notebook_id = (params.get("notebookId") or "").strip()
    layer = params.get("layer", "bronze")
    try:
        max_entities = int(params.get("maxEntities", 0))
    except (ValueError, TypeError):
        raise HttpError("maxEntities must be an integer", 400)
    ds_filter = (params.get("dataSourceFilter") or "").strip()
    chunk_mode = (params.get("chunkMode") or "").strip()

    if not notebook_id:
        raise HttpError("notebookId is required", 400)
    if not _is_valid_uuid(notebook_id):
        raise HttpError("notebookId must be a valid UUID", 400)

    if layer not in ("landing", "bronze", "silver"):
        raise HttpError(f"Unknown layer: {layer}. Expected landing, bronze, or silver.", 400)

    ws_id = _get_workspace_id()
    if not ws_id:
        raise HttpError("workspace_code_id not configured in config.json", 503)

    # Count entities that will be processed (for the response)
    if layer == "landing":
        count_sql = (
            "SELECT COUNT(*) as cnt FROM lz_entities le "
            "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            "WHERE le.IsActive = 1"
        )
        count_params: tuple = ()
        if ds_filter:
            count_sql += " AND LOWER(ds.Namespace) = LOWER(?)"
            count_params = (ds_filter,)
    elif layer == "bronze":
        count_sql = (
            "SELECT COUNT(*) as cnt FROM bronze_entities be "
            "JOIN lz_entities le ON be.LandingzoneEntityId = le.LandingzoneEntityId "
            "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            "WHERE be.IsActive = 1"
        )
        count_params = ()
        if ds_filter:
            count_sql += " AND LOWER(ds.Namespace) = LOWER(?)"
            count_params = (ds_filter,)
    elif layer == "silver":
        count_sql = (
            "SELECT COUNT(*) as cnt FROM silver_entities se "
            "JOIN bronze_entities be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId "
            "JOIN lz_entities le ON be.LandingzoneEntityId = le.LandingzoneEntityId "
            "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            "WHERE se.IsActive = 1"
        )
        count_params = ()
        if ds_filter:
            count_sql += " AND LOWER(ds.Namespace) = LOWER(?)"
            count_params = (ds_filter,)

    count_row = db.query(count_sql, count_params)
    original_count = count_row[0]["cnt"] if count_row else 0
    entity_count = min(max_entities, original_count) if max_entities > 0 else original_count

    # Build notebook execution parameters
    execution_data = {
        "executionData": {
            "parameters": {
                "layer": {"value": layer, "type": "string"},
                "max_entities": {"value": str(max_entities), "type": "string"},
                "data_source_filter": {"value": ds_filter, "type": "string"},
                "chunk_mode": {"value": chunk_mode, "type": "string"},
            }
        }
    }

    try:
        token = _get_fabric_token()
        url = (
            f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}"
            f"/items/{notebook_id}/jobs/instances?jobType=RunNotebook"
        )
        resp = _fabric_post(url, token, json.dumps(execution_data).encode())
        location = resp.headers.get("Location", "")
        job_instance_id = location.rstrip("/").split("/")[-1] if location else ""

        return {
            "success": True,
            "jobInstanceId": job_instance_id,
            "notebookId": notebook_id,
            "workspaceId": ws_id,
            "entityCount": entity_count,
            "originalCount": original_count,
            "dataSourceFilter": ds_filter or None,
            "chunkMode": chunk_mode or "auto",
        }
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        log.error("Fabric notebook trigger failed: %s %s", e.code, body)
        raise HttpError(f"Fabric API error {e.code}: {body}", 502)
    except HttpError:
        raise
    except Exception as e:
        raise HttpError(f"Failed to trigger notebook: {e}", 502)


# ---------------------------------------------------------------------------
# GET /api/notebook-debug/job-status
# ---------------------------------------------------------------------------

@route("GET", "/api/notebook-debug/job-status")
def get_debug_job_status(params: dict) -> dict:
    """Poll for notebook job status.

    If jobId is provided, fetches that specific job instance.
    If only notebookId is provided, lists recent job instances for that notebook.
    """
    notebook_id = (params.get("notebookId") or "").strip()
    job_id = (params.get("jobId") or "").strip()

    if not notebook_id:
        raise HttpError("notebookId is required", 400)
    if not _is_valid_uuid(notebook_id):
        raise HttpError("notebookId must be a valid UUID", 400)
    if job_id and not _is_valid_uuid(job_id):
        raise HttpError("jobId must be a valid UUID", 400)

    ws_id = _get_workspace_id()
    if not ws_id:
        raise HttpError("workspace_code_id not configured", 503)

    try:
        token = _get_fabric_token()
    except HttpError:
        log.exception("Failed to acquire Fabric token for job status poll")
        return {"status": "Unknown", "error": "Could not acquire Fabric token"}

    # If a specific job ID was given, get its status directly
    if job_id:
        try:
            url = (
                f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}"
                f"/items/{notebook_id}/jobs/instances/{job_id}"
            )
            data = _fabric_get(url, token, timeout=15)
            return {
                "status": data.get("status", "Unknown"),
                "startTime": data.get("startTimeUtc"),
                "endTime": data.get("endTimeUtc"),
                "failureReason": _normalize_failure_reason(data.get("failureReason")),
            }
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"status": "NotFound", "error": f"Job {job_id} not found"}
            body = e.read().decode("utf-8", errors="replace")
            return {"status": "Error", "error": f"Fabric API {e.code}: {body}"}
        except Exception as e:
            return {"status": "Error", "error": str(e)}

    # No specific job — list recent job instances for the notebook
    try:
        url = (
            f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}"
            f"/items/{notebook_id}/jobs/instances"
        )
        data = _fabric_get(url, token, timeout=15)
        jobs = []
        for j in data.get("value", []):
            jobs.append({
                "id": j.get("id", ""),
                "status": j.get("status", "Unknown"),
                "startTime": j.get("startTimeUtc", ""),
                "endTime": j.get("endTimeUtc", ""),
                "failureReason": _normalize_failure_reason(j.get("failureReason")),
            })
        # Sort by start time descending, most recent first
        jobs.sort(key=lambda x: x.get("startTime") or "", reverse=True)
        # Limit to recent 20
        jobs = jobs[:20]
        return {"jobs": jobs}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"jobs": [], "error": f"Fabric API {e.code}: {body}"}
    except Exception as e:
        return {"jobs": [], "error": str(e)}


# ---------------------------------------------------------------------------
# POST /api/notebook/trigger — Setup notebook deployment
# ---------------------------------------------------------------------------

_SETUP_NOTEBOOK_NAME = "NB_UTILITIES_SETUP_FMD"


def _find_setup_notebook(workspace_id: str, token: str) -> str | None:
    """Find the setup notebook ID by name in the workspace."""
    try:
        notebooks = _list_fabric_notebooks(workspace_id, token)
        for nb in notebooks:
            if nb["name"] == _SETUP_NOTEBOOK_NAME:
                return nb["id"]
    except Exception as e:
        log.debug("Failed to find setup notebook: %s", e)
    return None


@route("POST", "/api/notebook/trigger")
def post_trigger_setup_notebook(params: dict) -> dict:
    """Trigger the framework setup notebook (NB_UTILITIES_SETUP_FMD).

    Looks up the notebook by name in the CODE workspace, then triggers
    execution via the Fabric Jobs API.
    """
    ws_id = _get_workspace_id()
    if not ws_id:
        raise HttpError("workspace_code_id not configured in config.json", 503)

    try:
        token = _get_fabric_token()
    except HttpError as e:
        return {"error": str(e)}

    # Find the setup notebook by name
    notebook_id = _find_setup_notebook(ws_id, token)
    if not notebook_id:
        return {
            "error": (
                f"Setup notebook '{_SETUP_NOTEBOOK_NAME}' not found in workspace {ws_id}. "
                "Make sure it has been deployed to the CODE workspace."
            )
        }

    # Trigger the notebook
    try:
        url = (
            f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}"
            f"/items/{notebook_id}/jobs/instances?jobType=RunNotebook"
        )
        resp = _fabric_post(url, token, b"{}")
        location = resp.headers.get("Location", "")
        job_instance_id = location.rstrip("/").split("/")[-1] if location else ""

        return {
            "success": True,
            "notebookId": notebook_id,
            "workspaceId": ws_id,
            "jobInstanceId": job_instance_id,
        }
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"error": f"Fabric API error {e.code}: {body}"}
    except Exception as e:
        return {"error": f"Failed to trigger setup notebook: {e}"}


# ---------------------------------------------------------------------------
# GET /api/notebook/job-status — Poll setup notebook status
# ---------------------------------------------------------------------------

@route("GET", "/api/notebook/job-status")
def get_setup_job_status(params: dict) -> dict:
    """Poll for setup notebook job status.

    Returns recent job instances for the given notebook in the workspace.
    Used by the NotebookConfig page to track deployment progress.
    """
    workspace_id = (params.get("workspaceId") or "").strip()
    notebook_id = (params.get("notebookId") or "").strip()

    if not workspace_id or not notebook_id:
        raise HttpError("workspaceId and notebookId are required", 400)
    if not _is_valid_uuid(workspace_id):
        raise HttpError("workspaceId must be a valid UUID", 400)
    if not _is_valid_uuid(notebook_id):
        raise HttpError("notebookId must be a valid UUID", 400)

    try:
        token = _get_fabric_token()
    except HttpError:
        log.exception("Failed to acquire Fabric token for setup job status")
        return {"error": "Could not acquire Fabric token", "jobs": []}

    try:
        url = (
            f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}"
            f"/items/{notebook_id}/jobs/instances"
        )
        data = _fabric_get(url, token, timeout=15)
        jobs = []
        for j in data.get("value", []):
            failure = j.get("failureReason")
            # Flatten failureReason to string for NotebookConfig's simpler interface
            failure_str = None
            if failure:
                if isinstance(failure, dict):
                    failure_str = failure.get("message", json.dumps(failure))
                else:
                    failure_str = str(failure)
            jobs.append({
                "id": j.get("id", ""),
                "status": j.get("status", "Unknown"),
                "startTime": j.get("startTimeUtc", ""),
                "endTime": j.get("endTimeUtc", ""),
                "failureReason": failure_str,
            })
        # Most recent first
        jobs.sort(key=lambda x: x.get("startTime") or "", reverse=True)
        jobs = jobs[:10]
        return {"jobs": jobs}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"error": f"Fabric API {e.code}: {body}", "jobs": []}
    except Exception as e:
        return {"error": str(e), "jobs": []}
