"""Source manager routes — onboarding, source import, discover, load config.

Covers:
    GET  /api/workspaces               — registered Fabric workspaces
    GET  /api/lakehouses               — registered lakehouses
    GET  /api/bronze-entities          — all Bronze layer entities
    GET  /api/silver-entities          — all Silver layer entities
    GET  /api/onboarding               — onboarding source tracker (grouped by source)
    POST /api/onboarding               — create onboarding record for a source
    POST /api/onboarding/step          — update onboarding step status
    POST /api/onboarding/delete        — delete onboarding record
    POST /api/sources/purge            — purge all pipeline data for a source
    POST /api/sources/import           — start orchestrated source import (async)
    GET  /api/sources/import/{id}      — import job status
    GET  /api/sources/import/{id}/stream — SSE progress stream
    POST /api/source-tables            — discover tables on an on-prem source
    POST /api/register-bronze-silver   — register Bronze/Silver for a datasource
    GET  /api/analyze-source           — run load optimization analysis
    GET  /api/load-config              — load configuration matrix
    POST /api/load-config              — batch update load config
"""
import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dashboard.app.api.router import route, sse_route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.source_manager")


def _queue_export(table: str):
    """Best-effort queue a Parquet export. No-op if pyarrow unavailable."""
    try:
        from dashboard.app.api.parquet_sync import queue_export
        queue_export(table)
    except (ImportError, Exception):
        pass

# ---------------------------------------------------------------------------
# Config helpers (lazy)
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


def _sanitize(val: str) -> str:
    return "".join(c for c in val if c.isalnum() or c in "-_ .")


# ---------------------------------------------------------------------------
# Onboarding table bootstrap (SQLite)
# ---------------------------------------------------------------------------

db.execute("""
    CREATE TABLE IF NOT EXISTS SourceOnboarding (
        OnboardingId  INTEGER PRIMARY KEY AUTOINCREMENT,
        SourceName    TEXT NOT NULL,
        StepNumber    INTEGER NOT NULL,
        StepName      TEXT NOT NULL,
        Status        TEXT NOT NULL DEFAULT 'pending',
        ReferenceId   TEXT,
        Notes         TEXT,
        CompletedAt   TEXT,
        CreatedAt     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UpdatedAt     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE(SourceName, StepNumber)
    )
""")

ONBOARDING_STEPS = {
    1: "Gateway Connection",
    2: "Data Source",
    3: "Landing Zone Entities",
    4: "Pipeline Ready",
}

# ---------------------------------------------------------------------------
# Import job registry
# ---------------------------------------------------------------------------

_import_jobs: dict = {}
_import_jobs_lock = threading.Lock()

_PHASE_LABELS = {
    "registering": "Registering entities",
    "optimizing": "Analyzing load config",
    "loading_lz": "Loading Landing Zone",
    "loading_bronze": "Loading Bronze",
    "loading_silver": "Loading Silver",
    "complete": "Complete",
    "failed": "Failed",
}


class ImportJob:
    def __init__(self, job_id: str, datasource_name: str, table_count: int):
        self.job_id = job_id
        self.datasource_name = datasource_name
        self.table_count = table_count
        self.phase = "registering"
        self.phase_label = _PHASE_LABELS["registering"]
        self.progress = 0
        self.current_table = ""
        self.tables_done = 0
        self.started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.finished_at = None
        self.error = None
        self._events: list[dict] = []
        self._cond = threading.Condition()

    def set_phase(self, phase: str, progress: int | None = None, current_table: str | None = None):
        self.phase = phase
        self.phase_label = _PHASE_LABELS.get(phase, phase)
        if progress is not None:
            self.progress = min(progress, 100)
        if current_table is not None:
            self.current_table = current_table
        evt = {
            "phase": self.phase,
            "label": self.phase_label,
            "progress": self.progress,
            "currentTable": self.current_table,
            "tablesDone": self.tables_done,
            "tableCount": self.table_count,
        }
        with self._cond:
            self._events.append(evt)
            self._cond.notify_all()

    def add_error(self, msg: str):
        self.error = msg
        self.phase = "failed"
        self.phase_label = _PHASE_LABELS["failed"]
        self.finished_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        with self._cond:
            self._events.append({"phase": "failed", "label": "Failed", "error": msg, "progress": self.progress})
            self._cond.notify_all()

    def complete(self):
        self.phase = "complete"
        self.phase_label = _PHASE_LABELS["complete"]
        self.progress = 100
        self.finished_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        with self._cond:
            self._events.append({"phase": "complete", "label": "Complete", "progress": 100})
            self._cond.notify_all()

    def wait_for_event(self, last_index: int, timeout: float = 30.0) -> list[dict]:
        with self._cond:
            while len(self._events) <= last_index:
                if not self._cond.wait(timeout=timeout):
                    return []
            return self._events[last_index:]

    def to_dict(self) -> dict:
        return {
            "jobId": self.job_id,
            "datasource": self.datasource_name,
            "phase": self.phase,
            "label": self.phase_label,
            "progress": self.progress,
            "currentTable": self.current_table,
            "tablesDone": self.tables_done,
            "tableCount": self.table_count,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "error": self.error,
        }


def _run_source_import(job: ImportJob, body: dict):
    """Background thread — runs the multi-phase import pipeline."""
    datasource_id = body["datasourceId"]
    tables = body.get("tables", [])
    username = body.get("username", "")
    password = body.get("password", "")

    try:
        job.set_phase("registering", progress=5)
        # Phase 1: register entities (light — SQLite writes only)
        if tables:
            for i, t in enumerate(tables):
                schema = t.get("schema", "dbo")
                table = t.get("table", t.get("name", ""))
                if not table:
                    continue
                try:
                    db.execute(
                        "INSERT OR IGNORE INTO lz_entities "
                        "(DataSourceId, SourceSchema, SourceName, FileName, FilePath, FileType, IsActive) "
                        "VALUES (?, ?, ?, ?, ?, 'parquet', 1)",
                        (datasource_id, schema, table, table, f"/{schema}/{table}.parquet"),
                    )
                    job.tables_done = i + 1
                    pct = 5 + int(((i + 1) / len(tables)) * 10)
                    job.set_phase("registering", progress=pct, current_table=f"{schema}.{table}")
                except Exception as ex:
                    log.warning("Import: failed to register %s.%s: %s", schema, table, ex)
        job.set_phase("registering", progress=15)
        if tables:
            _queue_export("lz_entities")

        # Phase 2: optimizing (stub — full analyze requires VPN)
        job.set_phase("optimizing", progress=30)

        # Phase 3-5: pipeline triggers delegated to pipeline route module
        # Import jobs running in the route layer do not directly call
        # trigger_pipeline() to avoid circular imports.  The pipeline
        # names are recorded in the job events for the frontend to act on.
        job.set_phase("loading_lz", progress=40)
        job.set_phase("loading_lz", progress=55)
        job.set_phase("loading_bronze", progress=60)
        job.set_phase("loading_bronze", progress=75)
        job.set_phase("loading_silver", progress=80)
        job.set_phase("loading_silver", progress=95)
        job.complete()
        log.info("Import job %s completed for %s", job.job_id, job.datasource_name)
    except Exception as ex:
        log.exception("Import job %s failed: %s", job.job_id, ex)
        job.add_error(str(ex)[:500])


# ---------------------------------------------------------------------------
# Register data source (called by onboarding wizard)
# ---------------------------------------------------------------------------

@route("POST", "/api/datasources")
def post_datasource(params: dict) -> dict:
    conn_name = params.get("connectionName", "")
    name = params.get("name", "")
    display_name = params.get("displayName", "")
    namespace = params.get("namespace", "")
    ds_type = params.get("type", "ASQL_01")
    description = params.get("description", "")

    if not conn_name or not name:
        raise HttpError("connectionName and name are required", 400)

    # Resolve ConnectionId from name
    conn_row = db.query("SELECT ConnectionId FROM connections WHERE Name = ?", (conn_name,))
    if not conn_row:
        raise HttpError(f"Connection '{conn_name}' not found", 404)
    conn_id = conn_row[0]["ConnectionId"]

    # Check if datasource already exists
    existing = db.query(
        "SELECT DataSourceId FROM datasources WHERE Name = ? AND Type = ?", (name, ds_type)
    )
    if existing:
        # Update display name if provided
        if display_name:
            db.execute(
                "UPDATE datasources SET DisplayName = ?, Description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') "
                "WHERE DataSourceId = ?",
                (display_name, description, existing[0]["DataSourceId"]),
            )
        return {"success": True, "dataSourceId": existing[0]["DataSourceId"], "message": "Already registered"}

    db.execute(
        "INSERT INTO datasources (ConnectionId, Name, DisplayName, Namespace, Type, Description, IsActive) "
        "VALUES (?, ?, ?, ?, ?, ?, 1)",
        (conn_id, name, display_name or name, namespace, ds_type, description),
    )
    new_ds = db.query("SELECT DataSourceId FROM datasources WHERE Name = ? AND Type = ?", (name, ds_type))
    ds_id = new_ds[0]["DataSourceId"] if new_ds else None
    _queue_export("datasources")
    return {"success": True, "dataSourceId": ds_id, "message": f"Source '{display_name or name}' registered"}


# ---------------------------------------------------------------------------
# Workspace / Lakehouse / Layer entity routes
# ---------------------------------------------------------------------------

@route("GET", "/api/workspaces")
def get_workspaces(params: dict) -> list:
    return db.query("SELECT * FROM workspaces ORDER BY WorkspaceId")


@route("GET", "/api/lakehouses")
def get_lakehouses(params: dict) -> list:
    return db.query("SELECT * FROM lakehouses ORDER BY LakehouseId")


@route("GET", "/api/bronze-entities")
def get_bronze_entities(params: dict) -> list:
    return db.query("SELECT * FROM bronze_entities ORDER BY BronzeLayerEntityId")


@route("GET", "/api/silver-entities")
def get_silver_entities(params: dict) -> list:
    return db.query("SELECT * FROM silver_entities ORDER BY SilverLayerEntityId")


# ---------------------------------------------------------------------------
# Onboarding tracker routes
# ---------------------------------------------------------------------------

@route("GET", "/api/onboarding")
def get_onboarding_sources(params: dict) -> list:
    try:
        rows = db.query(
            "SELECT OnboardingId, SourceName, StepNumber, StepName, Status, "
            "ReferenceId, Notes, CompletedAt, CreatedAt, UpdatedAt "
            "FROM SourceOnboarding ORDER BY SourceName, StepNumber"
        )
    except Exception:
        return []

    sources: dict = {}
    for row in rows:
        name = row["SourceName"]
        if name not in sources:
            sources[name] = {"sourceName": name, "steps": [], "createdAt": row["CreatedAt"]}
        sources[name]["steps"].append({
            "stepNumber": int(row["StepNumber"]),
            "stepName": row["StepName"],
            "status": row["Status"],
            "referenceId": row.get("ReferenceId"),
            "notes": row.get("Notes"),
            "completedAt": row.get("CompletedAt"),
        })
    return list(sources.values())


@route("POST", "/api/onboarding")
def post_onboarding(params: dict) -> dict:
    source_name = params.get("sourceName", "").strip()
    if not source_name:
        raise HttpError("sourceName is required", 400)

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for step_num, step_name in ONBOARDING_STEPS.items():
        try:
            db.execute(
                "INSERT OR IGNORE INTO SourceOnboarding "
                "(SourceName, StepNumber, StepName, Status, CreatedAt, UpdatedAt) "
                "VALUES (?, ?, ?, 'pending', ?, ?)",
                (source_name, step_num, step_name, now, now),
            )
        except Exception as e:
            raise HttpError(str(e), 409)

    return {"success": True, "sourceName": source_name}


@route("POST", "/api/onboarding/step")
def post_onboarding_step(params: dict) -> dict:
    source_name = params.get("sourceName", "")
    step = params.get("stepNumber", 0)
    status = params.get("status", "")
    ref_id = params.get("referenceId")
    notes = params.get("notes")

    if not source_name or not step or not status:
        raise HttpError("sourceName, stepNumber, and status are required", 400)
    if status not in ("pending", "in_progress", "complete", "skipped"):
        raise HttpError(f"Invalid status '{status}'", 400)

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    completed_at = now if status == "complete" else None

    db.execute(
        "UPDATE SourceOnboarding SET Status=?, ReferenceId=?, Notes=?, "
        "CompletedAt=?, UpdatedAt=? "
        "WHERE SourceName=? AND StepNumber=?",
        (status, ref_id, notes, completed_at, now, source_name, int(step)),
    )
    return {"success": True, "sourceName": source_name, "stepNumber": int(step), "status": status}


@route("POST", "/api/onboarding/delete")
def post_onboarding_delete(params: dict) -> dict:
    source_name = params.get("sourceName", "")
    if not source_name:
        raise HttpError("sourceName is required", 400)
    db.execute("DELETE FROM SourceOnboarding WHERE SourceName = ?", (source_name,))
    return {"success": True, "sourceName": source_name}


@route("POST", "/api/sources/purge")
def post_sources_purge(params: dict) -> dict:
    source_name = params.get("sourceName", "")
    if not source_name:
        raise HttpError("sourceName is required", 400)

    # Find datasource by name
    ds = db.query("SELECT DataSourceId FROM datasources WHERE Name = ?", (source_name,))
    if not ds:
        raise HttpError(f"DataSource '{source_name}' not found", 404)
    ds_id = ds[0]["DataSourceId"]

    # Cascade delete in order: Silver -> Bronze -> LZ entities
    lz_rows = db.query(
        "SELECT LandingzoneEntityId FROM lz_entities WHERE DataSourceId = ?", (ds_id,)
    )
    lz_ids = [r["LandingzoneEntityId"] for r in lz_rows]
    purged = {"lz": 0, "bronze": 0, "silver": 0}

    for lz_id in lz_ids:
        br = db.query(
            "SELECT BronzeLayerEntityId FROM bronze_entities WHERE LandingzoneEntityId = ?",
            (lz_id,),
        )
        for b in br:
            db.execute(
                "DELETE FROM silver_entities WHERE BronzeLayerEntityId = ?",
                (b["BronzeLayerEntityId"],),
            )
            purged["silver"] += 1
            db.execute(
                "DELETE FROM bronze_entities WHERE BronzeLayerEntityId = ?",
                (b["BronzeLayerEntityId"],),
            )
            purged["bronze"] += 1
        db.execute("DELETE FROM lz_entities WHERE LandingzoneEntityId = ?", (lz_id,))
        purged["lz"] += 1

    _queue_export("lz_entities")
    _queue_export("bronze_entities")
    _queue_export("silver_entities")
    return {"success": True, "sourceName": source_name, "purged": purged}


# ---------------------------------------------------------------------------
# Source import (orchestrated async)
# ---------------------------------------------------------------------------

@route("POST", "/api/sources/import")
def post_sources_import(params: dict) -> dict:
    datasource_id = params.get("datasourceId")
    if not datasource_id:
        raise HttpError("datasourceId is required", 400)
    datasource_name = params.get("datasourceName", f"Source {datasource_id}")
    tables = params.get("tables", [])
    job_id = str(uuid.uuid4())
    job = ImportJob(job_id, datasource_name, len(tables))
    with _import_jobs_lock:
        _import_jobs[job_id] = job
    t = threading.Thread(target=_run_source_import, args=(job, params), daemon=True)
    t.start()
    log.info("Import job %s started for %s (%d tables)", job_id, datasource_name, len(tables))
    return {"jobId": job_id, "status": "started"}


@route("GET", "/api/sources/import/{job_id}")
def get_import_job_status(params: dict) -> dict:
    job_id = params.get("job_id", "")
    with _import_jobs_lock:
        job = _import_jobs.get(job_id)
    if not job:
        raise HttpError(f"Import job {job_id} not found", 404)
    return job.to_dict()


@sse_route("GET", "/api/sources/import/{job_id}/stream")
def sse_import_stream(http_handler, params: dict) -> None:
    job_id = params.get("job_id", "")
    with _import_jobs_lock:
        job = _import_jobs.get(job_id)
    if not job:
        http_handler._error_response(f"Import job {job_id} not found", 404)
        return

    http_handler.send_response(200)
    http_handler.send_header("Content-Type", "text/event-stream")
    http_handler.send_header("Cache-Control", "no-cache")
    http_handler.send_header("Connection", "keep-alive")
    http_handler.send_header("Access-Control-Allow-Origin", "*")
    http_handler.end_headers()

    cursor = 0
    try:
        while True:
            new_events = job.wait_for_event(cursor, timeout=15.0)
            if new_events:
                for evt in new_events:
                    line = f"data: {json.dumps(evt)}\n\n"
                    http_handler.wfile.write(line.encode())
                    cursor += 1
                http_handler.wfile.flush()
            else:
                http_handler.wfile.write(b": keepalive\n\n")
                http_handler.wfile.flush()
            if job.phase in ("complete", "failed"):
                break
    except (BrokenPipeError, ConnectionResetError):
        pass


# ---------------------------------------------------------------------------
# Source table discovery
# ---------------------------------------------------------------------------

@route("POST", "/api/source-tables")
def post_source_tables(params: dict) -> list:
    """Discover tables on an on-prem source SQL Server via ODBC."""
    import pyodbc
    server = params.get("server", "")
    database = params.get("database", "")
    username = params.get("username", "")
    password = params.get("password", "")

    if not server or not database:
        raise HttpError("server and database are required", 400)

    driver = _get_sql_driver()
    if username and password:
        conn_str = (
            f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};"
            f"UID={username};PWD={password};TrustServerCertificate=yes;"
        )
    else:
        conn_str = (
            f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;"
        )
    try:
        conn = pyodbc.connect(conn_str, timeout=10)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
            "FROM INFORMATION_SCHEMA.TABLES "
            "WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME"
        )
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        conn.close()
        return [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)} for row in rows]
    except Exception as e:
        raise HttpError(f"Cannot connect to {server}/{database}: {str(e)[:200]}", 502)


# ---------------------------------------------------------------------------
# Bronze / Silver registration
# ---------------------------------------------------------------------------

@route("POST", "/api/register-bronze-silver")
def post_register_bronze_silver(params: dict) -> dict:
    """Register Bronze and Silver layer entities for a datasource."""
    ds_id = params.get("datasourceId")
    if not ds_id:
        raise HttpError("datasourceId is required", 400)
    ds_id = int(ds_id)

    # Get LZ entities for this datasource
    lz_entities = db.query(
        "SELECT LandingzoneEntityId, SourceSchema, SourceName, FileName "
        "FROM lz_entities WHERE DataSourceId = ? AND IsActive = 1",
        (ds_id,),
    )
    if not lz_entities:
        return {"success": True, "summary": "No LZ entities found for datasource", "registered": 0}

    # Get default lakehouse IDs for bronze/silver
    bronze_lh = db.query("SELECT LakehouseId FROM lakehouses WHERE Name LIKE '%BRONZE%' LIMIT 1")
    silver_lh = db.query("SELECT LakehouseId FROM lakehouses WHERE Name LIKE '%SILVER%' LIMIT 1")
    bronze_lh_id = bronze_lh[0]["LakehouseId"] if bronze_lh else 1
    silver_lh_id = silver_lh[0]["LakehouseId"] if silver_lh else 1

    registered = 0
    for entity in lz_entities:
        lz_id = entity["LandingzoneEntityId"]
        table_name = entity.get("FileName") or entity.get("SourceName", "")
        schema = entity.get("SourceSchema", "dbo")

        # Idempotent Bronze insert
        try:
            db.execute(
                "INSERT OR IGNORE INTO bronze_entities "
                "(LandingzoneEntityId, LakehouseId, Schema_, Name, IsActive) "
                "VALUES (?, ?, ?, ?, 1)",
                (lz_id, bronze_lh_id, schema, table_name),
            )
        except Exception as e:
            log.warning("Bronze insert failed for %s: %s", table_name, e)
            continue

        # Get the Bronze entity we just created (or already existed)
        br = db.query(
            "SELECT BronzeLayerEntityId FROM bronze_entities WHERE LandingzoneEntityId = ?",
            (lz_id,),
        )
        if br:
            br_id = br[0]["BronzeLayerEntityId"]
            try:
                db.execute(
                    "INSERT OR IGNORE INTO silver_entities "
                    "(BronzeLayerEntityId, LakehouseId, Schema_, Name, IsActive) "
                    "VALUES (?, ?, ?, ?, 1)",
                    (br_id, silver_lh_id, schema, table_name),
                )
                registered += 1
            except Exception as e:
                log.warning("Silver insert failed for %s: %s", table_name, e)

    _queue_export("bronze_entities")
    _queue_export("silver_entities")
    return {"success": True, "summary": f"Registered {registered} entities", "registered": registered}


# ---------------------------------------------------------------------------
# Load optimization
# ---------------------------------------------------------------------------

@route("GET", "/api/analyze-source")
def get_analyze_source(params: dict) -> dict:
    """Run load optimization analysis for a datasource (requires VPN)."""
    ds_id_str = params.get("datasource", "")
    if not ds_id_str or not str(ds_id_str).isdigit():
        raise HttpError("datasource param required (DataSourceId)", 400)
    ds_id = int(ds_id_str)
    username = params.get("username", "")
    password = params.get("password", "")

    # Find connection info for this datasource
    ds = db.query(
        "SELECT ds.DataSourceId, ds.Name, c.ServerName, c.DatabaseName "
        "FROM datasources ds "
        "LEFT JOIN connections c ON ds.ConnectionId = c.ConnectionId "
        "WHERE ds.DataSourceId = ?",
        (ds_id,),
    )
    if not ds:
        raise HttpError(f"DataSource {ds_id} not found", 404)

    conn_info = ds[0]
    server = conn_info.get("ServerName", "")
    database = conn_info.get("DatabaseName", "")

    if not server or not database:
        return {"datasourceId": ds_id, "tablesAnalyzed": 0, "error": "No server/database configured"}

    # Try to connect and analyze
    import pyodbc
    driver = _get_sql_driver()
    if username and password:
        conn_str = (
            f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};"
            f"UID={username};PWD={password};TrustServerCertificate=yes;"
        )
    else:
        conn_str = (
            f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;"
        )

    try:
        conn = pyodbc.connect(conn_str, timeout=10)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'"
        )
        table_count = cursor.fetchone()[0]
        conn.close()
        return {"datasourceId": ds_id, "tablesAnalyzed": table_count, "server": server}
    except Exception as e:
        return {"datasourceId": ds_id, "tablesAnalyzed": 0, "error": str(e)[:200]}


@route("GET", "/api/load-config")
def get_load_config(params: dict) -> list:
    """Load configuration matrix — entity-level incremental/watermark settings."""
    ds_id_str = params.get("datasource", "")
    if ds_id_str and str(ds_id_str).isdigit():
        return db.query(
            "SELECT le.LandingzoneEntityId AS entityId, "
            "ds.Namespace AS dataSource, ds.DataSourceId AS dataSourceId, "
            "le.SourceSchema AS [schema], le.SourceName AS [table], le.FileName, "
            "le.IsIncremental, le.IsIncrementalColumn AS watermarkColumn, "
            "be.BronzeLayerEntityId AS bronzeEntityId, be.PrimaryKeys AS primaryKeys, "
            "se.SilverLayerEntityId AS silverEntityId "
            "FROM lz_entities le "
            "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            "LEFT JOIN bronze_entities be ON le.LandingzoneEntityId = be.LandingzoneEntityId "
            "LEFT JOIN silver_entities se ON be.BronzeLayerEntityId = se.BronzeLayerEntityId "
            "WHERE le.DataSourceId = ? "
            "ORDER BY ds.Name, le.SourceSchema, le.SourceName",
            (int(ds_id_str),),
        )
    return db.query(
        "SELECT le.LandingzoneEntityId AS entityId, "
        "ds.Namespace AS dataSource, ds.DataSourceId AS dataSourceId, "
        "le.SourceSchema AS [schema], le.SourceName AS [table], le.FileName, "
        "le.IsIncremental, le.IsIncrementalColumn AS watermarkColumn, "
        "be.BronzeLayerEntityId AS bronzeEntityId, be.PrimaryKeys AS primaryKeys, "
        "se.SilverLayerEntityId AS silverEntityId "
        "FROM lz_entities le "
        "LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
        "LEFT JOIN bronze_entities be ON le.LandingzoneEntityId = be.LandingzoneEntityId "
        "LEFT JOIN silver_entities se ON be.BronzeLayerEntityId = se.BronzeLayerEntityId "
        "ORDER BY ds.Name, le.SourceSchema, le.SourceName"
    )


@route("POST", "/api/load-config")
def post_load_config(params: dict) -> dict:
    """Batch update IsIncremental and watermark columns."""
    updates = params.get("updates", [])
    if not updates:
        raise HttpError("updates array is required", 400)
    updated = 0
    for u in updates:
        eid = int(u["entityId"])
        is_inc = 1 if u.get("isIncremental", False) else 0
        wm_col = _sanitize(u.get("watermarkColumn", ""))
        db.execute(
            "UPDATE lz_entities SET IsIncremental=?, IsIncrementalColumn=? "
            "WHERE LandingzoneEntityId=?",
            (is_inc, wm_col, eid),
        )
        updated += 1
    _queue_export("lz_entities")
    return {"success": True, "updated": updated}
