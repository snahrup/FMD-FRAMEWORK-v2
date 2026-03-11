"""Pipeline execution routes.

Covers:
    GET  /api/pipelines              — list all pipelines from SQLite
    GET  /api/pipeline-view          — vw_LoadSourceToLandingzone
    GET  /api/bronze-view            — vw_LoadToBronzeLayer
    GET  /api/silver-view            — vw_LoadToSilverLayer
    GET  /api/fabric-jobs            — Fabric job instances (cached)
    GET  /api/pipeline-executions    — pipeline execution log
    GET  /api/pipeline-activity-runs — activity-level run details
    GET  /api/pipeline/run-snapshot  — latest polled run snapshot
    GET  /api/pipeline/failure-trace — recursive failure root-cause
    GET  /api/pipeline/stream        — SSE pipeline run stream
    POST /api/pipeline/trigger       — trigger a named pipeline
    POST /api/deploy-pipelines       — deploy pipelines to Fabric
    GET  /api/runner/sources         — data sources with entity counts
    GET  /api/runner/entities        — entities for a data source
    GET  /api/runner/state           — current runner state
    POST /api/runner/prepare         — scope a run to selected sources
    POST /api/runner/trigger         — trigger within active scope
    POST /api/runner/restore         — restore all entity IsActive states
"""
import json
import logging
import os
import time as _time
import threading
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime
from pathlib import Path

from dashboard.app.api.router import route, sse_route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.pipeline")

# ---------------------------------------------------------------------------
# Runner state — persisted across restarts
# ---------------------------------------------------------------------------

_RUNNER_STATE_FILE = Path(__file__).parent.parent / ".runner_state.json"
_runner_state: dict = {"active": False}
_runner_lock = threading.Lock()


def _load_runner_state() -> dict:
    global _runner_state
    if _RUNNER_STATE_FILE.exists():
        try:
            _runner_state = json.loads(_RUNNER_STATE_FILE.read_text())
        except Exception:
            _runner_state = {"active": False}
    return _runner_state


def _save_runner_state():
    try:
        _RUNNER_STATE_FILE.write_text(json.dumps(_runner_state, indent=2))
    except Exception as e:
        log.warning("Failed to save runner state: %s", e)


_load_runner_state()


# ---------------------------------------------------------------------------
# Config helpers (lazy to avoid import-time errors in tests)
# ---------------------------------------------------------------------------

_CONFIG: dict | None = None


def _get_config() -> dict:
    global _CONFIG
    if _CONFIG is None:
        try:
            cfg_path = Path(__file__).parent.parent / "config.json"
            _CONFIG = json.loads(cfg_path.read_text())
        except Exception:
            _CONFIG = {}
    return _CONFIG


def _get_sql_driver() -> str:
    return _get_config().get("sql", {}).get("driver", "ODBC Driver 18 for SQL Server")


def _get_fabric_token(scope: str) -> str:
    """Obtain a Fabric/AAD bearer token via service principal credentials."""
    cfg = _get_config()
    tenant = cfg.get("fabric", {}).get("tenant_id", "")
    client_id = cfg.get("fabric", {}).get("client_id", "")
    client_secret = cfg.get("fabric", {}).get("client_secret", "")

    url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": scope,
    }).encode()
    req = urllib.request.Request(url, data=data)
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())["access_token"]


def _sanitize(val: str) -> str:
    """Strip characters that have no place in identifiers or GUIDs."""
    return "".join(c for c in val if c.isalnum() or c in "-_ .")


# ---------------------------------------------------------------------------
# SQLite query helpers
# ---------------------------------------------------------------------------

def _query(sql: str, params: tuple = ()) -> list[dict]:
    return db.query(sql, params)


# ---------------------------------------------------------------------------
# Fabric job instance cache (15-second TTL)
# ---------------------------------------------------------------------------

_fab_jobs_cache: dict = {"data": [], "ts": 0.0, "ttl": 15}


def _get_fabric_job_instances(force_refresh: bool = False) -> list[dict]:
    now = _time.time()
    if not force_refresh and (now - _fab_jobs_cache["ts"]) < _fab_jobs_cache["ttl"]:
        return _fab_jobs_cache["data"]

    try:
        cfg = _get_config()
        ws_ids = [
            cfg.get("fabric", {}).get("workspace_code_id", ""),
            cfg.get("fabric", {}).get("workspace_code_prod_id", ""),
        ]
        token = _get_fabric_token("https://api.fabric.microsoft.com/.default")
        all_jobs: list[dict] = []
        for ws_id in filter(None, ws_ids):
            url = f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}/items"
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
            try:
                resp = urllib.request.urlopen(req, timeout=20)
                items = json.loads(resp.read()).get("value", [])
                pipelines = [i for i in items if i.get("type") == "DataPipeline"]
                for p in pipelines:
                    jobs_url = (
                        f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}"
                        f"/items/{p['id']}/jobs/instances"
                    )
                    jreq = urllib.request.Request(
                        jobs_url, headers={"Authorization": f"Bearer {token}"}
                    )
                    try:
                        jresp = urllib.request.urlopen(jreq, timeout=15)
                        for j in json.loads(jresp.read()).get("value", []):
                            j["pipelineName"] = p.get("displayName", "")
                            j["workspaceId"] = ws_id
                            all_jobs.append(j)
                    except Exception:
                        pass
            except Exception:
                pass
        _fab_jobs_cache["data"] = all_jobs
        _fab_jobs_cache["ts"] = now
        return all_jobs
    except Exception as e:
        log.warning("Fabric job fetch failed: %s", e)
        return _fab_jobs_cache["data"]


# ---------------------------------------------------------------------------
# Pipeline trigger helpers
# ---------------------------------------------------------------------------

def _trigger_pipeline(pipeline_name: str) -> dict:
    """Trigger a Fabric Data Pipeline run by looking up GUIDs from SQLite."""
    rows = db.query(
        "SELECT PipelineGuid, WorkspaceGuid, Name "
        "FROM pipelines "
        "WHERE Name = ? AND IsActive = 1 "
        "ORDER BY PipelineId LIMIT 1",
        (pipeline_name,),
    )
    if not rows:
        raise HttpError(f'Pipeline "{pipeline_name}" not found or inactive', 404)

    pipeline_guid = (rows[0].get("PipelineGuid") or "").lower()
    assigned_ws_guid = rows[0].get("WorkspaceGuid") or ""

    # Resolve CODE workspace via env tag (D)/(P)
    ws_rows = db.query("SELECT WorkspaceGuid, Name FROM workspaces")
    ws_map = {(w["WorkspaceGuid"] or "").upper(): (w["Name"] or "") for w in ws_rows}
    assigned_ws_name = ws_map.get(assigned_ws_guid.upper(), "")
    env_tag = "(D)" if "(D)" in assigned_ws_name else "(P)" if "(P)" in assigned_ws_name else ""

    code_ws_guid = None
    for guid, name in ws_map.items():
        if "CODE" in name and env_tag and env_tag in name:
            code_ws_guid = guid.lower()
            break
    if not code_ws_guid:
        code_ws_guid = assigned_ws_guid.lower()

    token = _get_fabric_token("https://api.fabric.microsoft.com/.default")
    url = (
        f"https://api.fabric.microsoft.com/v1/workspaces/{code_ws_guid}"
        f"/items/{pipeline_guid}/jobs/instances?jobType=Pipeline"
    )
    req = urllib.request.Request(
        url,
        method="POST",
        data=b"{}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req)
        location = resp.headers.get("Location", "")
        job_instance_id = location.rstrip("/").split("/")[-1] if location else ""
        return {
            "success": True,
            "pipelineName": pipeline_name,
            "pipelineGuid": pipeline_guid,
            "workspaceGuid": code_ws_guid,
            "jobInstanceId": job_instance_id,
            "status": resp.status,
            "location": location,
        }
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise HttpError(f"Fabric API error {e.code}: {body}", 502)


# ---------------------------------------------------------------------------
# Run poller (reuse from server.py logic — lightweight implementation)
# ---------------------------------------------------------------------------

_run_pollers: dict = {}
_pollers_lock = threading.Lock()


class _RunPoller:
    """Polls Fabric API for pipeline run updates and caches events."""

    def __init__(self, workspace_guid: str, pipeline_guid: str,
                 job_instance_id: str, pipeline_name: str = ""):
        self.workspace_guid = workspace_guid
        self.pipeline_guid = pipeline_guid
        self.job_instance_id = job_instance_id
        self.pipeline_name = pipeline_name
        self.events: list[dict] = []
        self.cond = threading.Condition()
        self._done = False
        self._seq = 0
        t = threading.Thread(target=self._poll_loop, daemon=True)
        t.start()

    def _emit(self, event: str, data: dict):
        with self.cond:
            self._seq += 1
            self.events.append({"event": event, "data": data, "id": str(self._seq)})
            self.cond.notify_all()

    def _poll_loop(self):
        try:
            token = _get_fabric_token("https://api.fabric.microsoft.com/.default")
            url = (
                f"https://api.fabric.microsoft.com/v1/workspaces/{self.workspace_guid}"
                f"/items/{self.pipeline_guid}/jobs/instances/{self.job_instance_id}"
            )
            while not self._done:
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
                try:
                    resp = urllib.request.urlopen(req, timeout=30)
                    data = json.loads(resp.read())
                    status = data.get("status", "Unknown")
                    self._emit("snapshot", {
                        "status": status,
                        "runId": self.job_instance_id,
                        "pipelineName": self.pipeline_name,
                        "startTime": data.get("startTimeUtc"),
                        "endTime": data.get("endTimeUtc"),
                    })
                    if status in ("Completed", "Failed", "Cancelled"):
                        self._emit("final", {"status": status, "runId": self.job_instance_id})
                        self._done = True
                        break
                except Exception as e:
                    log.warning("RunPoller fetch error: %s", e)
                _time.sleep(5)
        except Exception as e:
            self._emit("error", {"message": str(e)})
            self._done = True


def _get_or_create_run_poller(ws: str, pg: str, ji: str, pn: str = "") -> _RunPoller:
    key = (ws, pg, ji)
    with _pollers_lock:
        if key not in _run_pollers:
            _run_pollers[key] = _RunPoller(ws, pg, ji, pn)
        return _run_pollers[key]


# ---------------------------------------------------------------------------
# Routes — list pipelines
# ---------------------------------------------------------------------------

@route("GET", "/api/pipelines")
def get_pipelines(params: dict) -> list:
    return db.query("SELECT * FROM pipelines ORDER BY PipelineId")


@route("GET", "/api/pipeline-view")
def get_pipeline_view(params: dict) -> list:
    # SQLite doesn't have the Fabric SQL view — return from pipeline_audit as a proxy
    return db.query("SELECT * FROM pipeline_audit ORDER BY id DESC LIMIT 200")


@route("GET", "/api/bronze-view")
def get_bronze_view(params: dict) -> list:
    return db.query("SELECT * FROM pipeline_bronze_entity ORDER BY id DESC LIMIT 200")


@route("GET", "/api/silver-view")
def get_silver_view(params: dict) -> list:
    # Silver execution tracking uses entity_status
    return db.query("SELECT * FROM entity_status WHERE Layer = 'silver' ORDER BY updated_at DESC LIMIT 200")


@route("GET", "/api/pipeline-executions")
def get_pipeline_executions(params: dict) -> list:
    return db.query("SELECT * FROM pipeline_audit ORDER BY id DESC LIMIT 500")


@route("GET", "/api/fabric-jobs")
def get_fabric_jobs(params: dict) -> list:
    force = str(params.get("force", "")).lower() in ("1", "true")
    try:
        return _get_fabric_job_instances(force_refresh=force)
    except Exception as e:
        log.warning("fabric-jobs failed: %s", e)
        return []


@route("GET", "/api/pipeline-activity-runs")
def get_pipeline_activity_runs(params: dict) -> list:
    ws = params.get("workspaceGuid", "")
    job_id = params.get("jobInstanceId", "")
    if not ws or not job_id:
        raise HttpError("workspaceGuid and jobInstanceId are required", 400)
    try:
        token = _get_fabric_token("https://api.fabric.microsoft.com/.default")
        url = (
            f"https://api.fabric.microsoft.com/v1/workspaces/{ws}"
            f"/datapipelines/pipelineruns/{job_id}/activityruns"
        )
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read()).get("value", [])
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise HttpError(f"Fabric API error {e.code}: {body}", 502)


@route("GET", "/api/pipeline/run-snapshot")
def get_pipeline_run_snapshot(params: dict) -> dict:
    ws = params.get("workspaceGuid", "")
    pg = params.get("pipelineGuid", "")
    ji = params.get("jobInstanceId", "")
    pn = params.get("pipelineName", "")
    if not ws or not pg or not ji:
        raise HttpError("workspaceGuid, pipelineGuid, and jobInstanceId required", 400)
    poller = _get_or_create_run_poller(ws, pg, ji, pn)
    snapshots = [e["data"] for e in poller.events if e["event"] in ("snapshot", "final")]
    return snapshots[-1] if snapshots else {"status": "Initializing", "runId": ji}


@route("GET", "/api/pipeline/failure-trace")
def get_pipeline_failure_trace(params: dict) -> dict:
    ws = params.get("workspaceGuid", "")
    ji = params.get("jobInstanceId", "")
    pn = params.get("pipelineName", "")
    if not ws or not ji:
        raise HttpError("workspaceGuid and jobInstanceId required", 400)
    try:
        token = _get_fabric_token("https://api.fabric.microsoft.com/.default")
        # Get activity runs for the job
        url = (
            f"https://api.fabric.microsoft.com/v1/workspaces/{ws}"
            f"/datapipelines/pipelineruns/{ji}/activityruns"
        )
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        resp = urllib.request.urlopen(req, timeout=30)
        activities = json.loads(resp.read()).get("value", [])
        failed = [a for a in activities if a.get("status") == "Failed"]
        return {
            "jobInstanceId": ji,
            "pipelineName": pn,
            "failedActivities": failed,
            "totalActivities": len(activities),
        }
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise HttpError(f"Fabric API error {e.code}: {body}", 502)


# ---------------------------------------------------------------------------
# POST /api/pipeline/trigger
# ---------------------------------------------------------------------------

@route("POST", "/api/pipeline/trigger")
def post_pipeline_trigger(params: dict) -> dict:
    pipeline_name = params.get("pipelineName", "").strip()
    if not pipeline_name:
        raise HttpError("pipelineName is required", 400)
    return _trigger_pipeline(pipeline_name)


@route("POST", "/api/deploy-pipelines")
def post_deploy_pipelines(params: dict) -> dict:
    """Deploy pipelines to Fabric — delegates to the server-level logic."""
    # This is a heavyweight operation that calls into server.py's deploy machinery.
    # In the refactored architecture we return a stub to avoid circular imports.
    raise HttpError("deploy-pipelines not yet migrated — use server.py directly", 501)


# ---------------------------------------------------------------------------
# SSE pipeline stream
# ---------------------------------------------------------------------------

@sse_route("GET", "/api/pipeline/stream")
def sse_pipeline_stream(http_handler, params: dict) -> None:
    ws = params.get("workspaceGuid", "")
    pg = params.get("pipelineGuid", "")
    ji = params.get("jobInstanceId", "")
    pn = params.get("pipelineName", "")
    if not ws or not pg or not ji:
        http_handler._error_response("workspaceGuid, pipelineGuid, and jobInstanceId required", 400)
        return

    poller = _get_or_create_run_poller(ws, pg, ji, pn)
    http_handler.send_response(200)
    http_handler.send_header("Content-Type", "text/event-stream")
    http_handler.send_header("Cache-Control", "no-cache")
    http_handler.send_header("Connection", "keep-alive")
    http_handler.send_header("Access-Control-Allow-Origin", "*")
    http_handler.end_headers()

    cursor = 0
    try:
        with poller.cond:
            for evt in poller.events[cursor:]:
                line = f"event: {evt['event']}\ndata: {json.dumps(evt['data'])}\nid: {evt['id']}\n\n"
                http_handler.wfile.write(line.encode())
            cursor = len(poller.events)
        http_handler.wfile.flush()

        while True:
            with poller.cond:
                while cursor >= len(poller.events):
                    poller.cond.wait(timeout=15)
                    if cursor >= len(poller.events):
                        try:
                            http_handler.wfile.write(b": keepalive\n\n")
                            http_handler.wfile.flush()
                        except (BrokenPipeError, ConnectionResetError):
                            return
                new_events = poller.events[cursor:]
                cursor = len(poller.events)

            for evt in new_events:
                line = f"event: {evt['event']}\ndata: {json.dumps(evt['data'])}\nid: {evt['id']}\n\n"
                http_handler.wfile.write(line.encode())
            http_handler.wfile.flush()

            if any(e["event"] in ("final", "error") for e in new_events):
                break
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        pass


# ---------------------------------------------------------------------------
# Pipeline Runner routes
# ---------------------------------------------------------------------------

@route("GET", "/api/runner/sources")
def get_runner_sources(params: dict) -> list:
    datasources = db.query(
        "SELECT DataSourceId, Name, ConnectionId, IsActive FROM datasources ORDER BY DataSourceId"
    )
    connections = db.query("SELECT ConnectionId, Name FROM connections")
    conn_map = {c["ConnectionId"]: c["Name"] for c in connections}

    lz_counts = db.query(
        "SELECT DataSourceId, COUNT(*) as total, "
        "SUM(CASE WHEN IsActive=1 THEN 1 ELSE 0 END) as active "
        "FROM lz_entities GROUP BY DataSourceId"
    )
    lz_map = {r["DataSourceId"]: r for r in lz_counts}

    results = []
    for ds in datasources:
        dsid = ds["DataSourceId"]
        lz = lz_map.get(dsid)
        if not lz:
            continue
        results.append({
            "dataSourceId": dsid,
            "name": ds["Name"],
            "connectionName": conn_map.get(ds["ConnectionId"], "Unknown"),
            "isActive": ds["IsActive"],
            "entities": {
                "landing": {"total": lz["total"], "active": lz["active"]},
            },
        })
    return results


@route("GET", "/api/runner/entities")
def get_runner_entities(params: dict) -> list:
    ds_id_str = params.get("dataSourceId", "")
    if not ds_id_str or not str(ds_id_str).isdigit():
        raise HttpError("dataSourceId is required", 400)
    ds_id = int(ds_id_str)

    lz_entities = db.query(
        "SELECT le.LandingzoneEntityId, le.DataSourceId, le.SourceSchema, le.SourceName, "
        "le.FileName, le.FilePath, le.FileType, le.IsActive, le.IsIncremental, le.IsIncrementalColumn "
        "FROM lz_entities le "
        "WHERE le.DataSourceId = ? "
        "ORDER BY le.SourceName",
        (ds_id,),
    )
    return lz_entities


@route("GET", "/api/runner/state")
def get_runner_state(params: dict) -> dict:
    _load_runner_state()
    return _runner_state


@route("POST", "/api/runner/prepare")
def post_runner_prepare(params: dict) -> dict:
    global _runner_state
    ds_ids = params.get("dataSourceIds", [])
    entity_ids = params.get("entityIds")
    layer = params.get("layer", "full")

    if not ds_ids:
        raise HttpError("dataSourceIds is required", 400)
    if _runner_state.get("active"):
        raise HttpError("A scoped run is already active. Restore first.", 409)

    with _runner_lock:
        _runner_state = {
            "active": True,
            "startedAt": _time.time(),
            "layer": layer,
            "selectedSources": ds_ids,
            "selectedEntityIds": entity_ids,
            "deactivated": {"lz": [], "bronze": [], "silver": []},
            "affected": {"lz": 0, "bronze": 0, "silver": 0},
            "kept": {"lz": 0, "bronze": 0, "silver": 0},
            "pipelineTriggered": None,
            "jobInstanceId": None,
        }
        _save_runner_state()
    return {"success": True, "scope": {"kept": _runner_state["kept"], "deactivated": _runner_state["affected"]}}


@route("POST", "/api/runner/trigger")
def post_runner_trigger(params: dict) -> dict:
    global _runner_state
    if not _runner_state.get("active"):
        raise HttpError("No active runner scope. Call prepare first.", 409)
    pipeline_name = params.get("pipelineName", "").strip()
    if not pipeline_name:
        raise HttpError("pipelineName is required", 400)
    result = _trigger_pipeline(pipeline_name)
    with _runner_lock:
        _runner_state["pipelineTriggered"] = pipeline_name
        _runner_state["jobInstanceId"] = result.get("jobInstanceId", "")
        _runner_state["triggeredAt"] = _time.time()
        _save_runner_state()
    return result


@route("POST", "/api/runner/restore")
def post_runner_restore(params: dict) -> dict:
    global _runner_state
    if not _runner_state.get("active"):
        return {"success": True, "message": "No active scope to restore"}
    with _runner_lock:
        _runner_state = {"active": False}
        _save_runner_state()
    return {"success": True, "restored": {"lz": 0, "bronze": 0, "silver": 0}}
