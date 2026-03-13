"""FMD Control Plane DB — SQLite single source of truth for FMD metadata.

Stores integration.*, execution.*, and logging.* schemas in a single
WAL-mode SQLite file.  Data is ingested from OneLake Parquet via
delta_ingest.py.
"""

import sqlite3
import threading
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger('fmd-control-plane')

DB_PATH = Path(__file__).parent / 'fmd_control_plane.db'
_db_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _v(val):
    """Stringify non-None values so all columns are TEXT (consistent dict rows)."""
    return str(val) if val is not None else None


# ---------------------------------------------------------------------------
# Schema initialisation
# ---------------------------------------------------------------------------

def init_db():
    """Create all tables and indexes if they don't exist."""
    conn = _get_conn()
    try:
        conn.executescript("""
            -- integration mirrors ------------------------------------------------

            CREATE TABLE IF NOT EXISTS connections (
                ConnectionId    INTEGER PRIMARY KEY,
                ConnectionGuid  TEXT,
                Name            TEXT NOT NULL,
                DisplayName     TEXT,
                Type            TEXT,
                ServerName      TEXT,
                DatabaseName    TEXT,
                IsActive        INTEGER DEFAULT 1,
                updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS datasources (
                DataSourceId    INTEGER PRIMARY KEY,
                ConnectionId    INTEGER NOT NULL,
                Name            TEXT NOT NULL,
                DisplayName     TEXT,
                Namespace       TEXT,
                Type            TEXT,
                Description     TEXT,
                IsActive        INTEGER DEFAULT 1,
                updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS lakehouses (
                LakehouseId     INTEGER PRIMARY KEY,
                Name            TEXT NOT NULL,
                WorkspaceGuid   TEXT,
                LakehouseGuid   TEXT,
                updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS workspaces (
                WorkspaceId     INTEGER PRIMARY KEY,
                WorkspaceGuid   TEXT,
                Name            TEXT NOT NULL,
                updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS pipelines (
                PipelineId      INTEGER PRIMARY KEY,
                Name            TEXT NOT NULL,
                PipelineGuid    TEXT,
                WorkspaceGuid   TEXT,
                IsActive        INTEGER DEFAULT 1,
                updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS lz_entities (
                LandingzoneEntityId INTEGER PRIMARY KEY,
                DataSourceId        INTEGER NOT NULL,
                LakehouseId         INTEGER,
                SourceSchema        TEXT,
                SourceName          TEXT NOT NULL,
                SourceCustomSelect  TEXT,
                FileName            TEXT,
                FilePath            TEXT,
                FileType            TEXT DEFAULT 'parquet',
                IsIncremental       INTEGER DEFAULT 0,
                IsIncrementalColumn TEXT,
                CustomNotebookName  TEXT,
                IsActive            INTEGER DEFAULT 1,
                updated_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS bronze_entities (
                BronzeLayerEntityId     INTEGER PRIMARY KEY,
                LandingzoneEntityId     INTEGER NOT NULL,
                LakehouseId             INTEGER,
                Schema_                 TEXT,
                Name                    TEXT NOT NULL,
                PrimaryKeys             TEXT,
                FileType                TEXT DEFAULT 'Delta',
                IsActive                INTEGER DEFAULT 1,
                updated_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS silver_entities (
                SilverLayerEntityId     INTEGER PRIMARY KEY,
                BronzeLayerEntityId     INTEGER NOT NULL,
                LakehouseId             INTEGER,
                Schema_                 TEXT,
                Name                    TEXT NOT NULL,
                FileType                TEXT DEFAULT 'delta',
                IsActive                INTEGER DEFAULT 1,
                updated_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            -- execution mirrors --------------------------------------------------

            CREATE TABLE IF NOT EXISTS engine_runs (
                RunId                   TEXT PRIMARY KEY,
                Mode                    TEXT,
                Status                  TEXT NOT NULL,
                TotalEntities           INTEGER DEFAULT 0,
                SucceededEntities       INTEGER DEFAULT 0,
                FailedEntities          INTEGER DEFAULT 0,
                SkippedEntities         INTEGER DEFAULT 0,
                TotalRowsRead           INTEGER DEFAULT 0,
                TotalRowsWritten        INTEGER DEFAULT 0,
                TotalBytesTransferred   INTEGER DEFAULT 0,
                TotalDurationSeconds    REAL DEFAULT 0,
                Layers                  TEXT,
                EntityFilter            TEXT,
                TriggeredBy             TEXT,
                ErrorSummary            TEXT,
                StartedAt              TEXT,
                EndedAt                TEXT,
                updated_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS engine_task_log (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                RunId               TEXT NOT NULL,
                EntityId            INTEGER NOT NULL,
                Layer               TEXT,
                Status              TEXT NOT NULL,
                SourceServer        TEXT,
                SourceDatabase      TEXT,
                SourceTable         TEXT,
                SourceQuery         TEXT,
                RowsRead            INTEGER DEFAULT 0,
                RowsWritten         INTEGER DEFAULT 0,
                BytesTransferred    INTEGER DEFAULT 0,
                DurationSeconds     REAL DEFAULT 0,
                TargetLakehouse     TEXT,
                TargetPath          TEXT,
                WatermarkColumn     TEXT,
                WatermarkBefore     TEXT,
                WatermarkAfter      TEXT,
                LoadType            TEXT,
                ErrorType           TEXT,
                ErrorMessage        TEXT,
                ErrorStackTrace     TEXT,
                ErrorSuggestion     TEXT,
                LogData             TEXT,
                created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS pipeline_lz_entity (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                LandingzoneEntityId     INTEGER NOT NULL,
                FileName                TEXT,
                FilePath                TEXT,
                InsertDateTime          TEXT,
                IsProcessed             INTEGER DEFAULT 0,
                updated_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS pipeline_bronze_entity (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                BronzeLayerEntityId     INTEGER NOT NULL,
                TableName               TEXT,
                SchemaName              TEXT,
                InsertDateTime          TEXT,
                IsProcessed             INTEGER DEFAULT 0,
                updated_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS entity_status (
                LandingzoneEntityId     INTEGER NOT NULL,
                Layer                   TEXT NOT NULL,
                Status                  TEXT,
                LoadEndDateTime         TEXT,
                ErrorMessage            TEXT,
                UpdatedBy               TEXT,
                updated_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                PRIMARY KEY (LandingzoneEntityId, Layer)
            );

            CREATE TABLE IF NOT EXISTS watermarks (
                LandingzoneEntityId     INTEGER PRIMARY KEY,
                LoadValue               TEXT,
                LastLoadDatetime        TEXT,
                updated_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            -- logging mirrors ----------------------------------------------------

            CREATE TABLE IF NOT EXISTS pipeline_audit (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                PipelineRunGuid     TEXT,
                PipelineName        TEXT,
                EntityLayer         TEXT,
                TriggerType         TEXT,
                LogType             TEXT,
                LogDateTime         TEXT,
                LogData             TEXT,
                EntityId            INTEGER,
                created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS copy_activity_audit (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                PipelineRunGuid         TEXT,
                CopyActivityName        TEXT,
                EntityLayer             TEXT,
                TriggerType             TEXT,
                LogType                 TEXT,
                LogDateTime             TEXT,
                LogData                 TEXT,
                EntityId                INTEGER,
                CopyActivityParameters  TEXT,
                created_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            -- sync metadata ------------------------------------------------------

            CREATE TABLE IF NOT EXISTS sync_metadata (
                key         TEXT PRIMARY KEY,
                value       TEXT,
                updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            -- admin config (dashboard settings stored locally) -------------------

            CREATE TABLE IF NOT EXISTS admin_config (
                key        TEXT PRIMARY KEY,
                value      TEXT,
                updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            -- notebook execution log ---------------------------------------------
            -- Notebook execution log.
            -- Written by pipeline notebooks (NB_FMD_PROCESSING_*, NB_FMD_LOAD_*).

            CREATE TABLE IF NOT EXISTS notebook_executions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                NotebookName    TEXT,
                PipelineRunGuid TEXT,
                EntityId        INTEGER,
                EntityLayer     TEXT,
                LogType         TEXT,
                LogDateTime     TEXT,
                LogData         TEXT,
                Status          TEXT,
                StartedAt       TEXT,
                EndedAt         TEXT,
                created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            -- import job tracking ------------------------------------------------
            -- Persists the state of source import jobs started via
            -- POST /api/sources/import so they survive server restarts.

            CREATE TABLE IF NOT EXISTS import_jobs (
                job_id          TEXT PRIMARY KEY,
                datasource_name TEXT NOT NULL,
                datasource_id   INTEGER,
                table_count     INTEGER DEFAULT 0,
                tables_done     INTEGER DEFAULT 0,
                phase           TEXT NOT NULL DEFAULT 'registering',
                progress        INTEGER DEFAULT 0,
                current_table   TEXT,
                status          TEXT NOT NULL DEFAULT 'running',
                started_at      TEXT,
                finished_at     TEXT,
                error           TEXT,
                created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            -- server display labels ----------------------------------------------
            -- User-defined friendly names for SQL Server hostnames shown in the
            -- SQL Explorer (e.g. "m3-db1" -> "MES").  Complements the
            -- admin_config approach already used by sql_explorer.py.

            CREATE TABLE IF NOT EXISTS server_labels (
                server      TEXT PRIMARY KEY,
                label       TEXT NOT NULL,
                updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            -- indexes ------------------------------------------------------------

            CREATE INDEX IF NOT EXISTS idx_lz_datasource   ON lz_entities(DataSourceId);
            CREATE INDEX IF NOT EXISTS idx_lz_active        ON lz_entities(IsActive);
            CREATE INDEX IF NOT EXISTS idx_bronze_lz        ON bronze_entities(LandingzoneEntityId);
            CREATE INDEX IF NOT EXISTS idx_silver_bronze     ON silver_entities(BronzeLayerEntityId);
            CREATE INDEX IF NOT EXISTS idx_runs_status       ON engine_runs(Status);
            CREATE INDEX IF NOT EXISTS idx_tasklog_run       ON engine_task_log(RunId);
            CREATE INDEX IF NOT EXISTS idx_tasklog_entity    ON engine_task_log(EntityId);
            CREATE INDEX IF NOT EXISTS idx_plz_entity        ON pipeline_lz_entity(LandingzoneEntityId);
            CREATE INDEX IF NOT EXISTS idx_pbronze_entity    ON pipeline_bronze_entity(BronzeLayerEntityId);
            CREATE INDEX IF NOT EXISTS idx_estatus_layer     ON entity_status(Layer);
            CREATE INDEX IF NOT EXISTS idx_paudit_run        ON pipeline_audit(PipelineRunGuid);
            CREATE INDEX IF NOT EXISTS idx_caudit_run        ON copy_activity_audit(PipelineRunGuid);
            CREATE INDEX IF NOT EXISTS idx_caudit_entity     ON copy_activity_audit(EntityId);
            CREATE INDEX IF NOT EXISTS idx_nb_exec_run       ON notebook_executions(PipelineRunGuid);
            CREATE INDEX IF NOT EXISTS idx_nb_exec_entity    ON notebook_executions(EntityId);
            CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
        """)
        conn.commit()

        # ── Migrations (idempotent) ──
        # Add DisplayName column to datasources if missing
        cols = {r[1] for r in conn.execute("PRAGMA table_info(datasources)").fetchall()}
        if "DisplayName" not in cols:
            conn.execute("ALTER TABLE datasources ADD COLUMN DisplayName TEXT")
            conn.commit()
            log.info("Migration: added DisplayName column to datasources")

        # Seed DisplayName for existing rows that don't have one yet
        needs_seed = conn.execute(
            "SELECT DataSourceId, Name, Namespace, Description FROM datasources "
            "WHERE DisplayName IS NULL OR DisplayName = ''"
        ).fetchall()
        if needs_seed:
            _DISPLAY_SEEDS = {
                "MES": "MES",
                "ETQStagingPRD": "ETQ",
                "m3fdbprd": "M3 ERP",
                "DI_PRD_Staging": "M3 Cloud",
                "optivalive": "Optiva",
                "LH_DATA_LANDINGZONE": "OneLake Landing Zone",
                "CUSTOM_NOTEBOOK": "Custom Notebook",
            }
            for row in needs_seed:
                display = _DISPLAY_SEEDS.get(row[1])
                if not display and row[3]:
                    # Try to extract label from Description like "M3 Cloud (DI_PRD_Staging on sql2016live)"
                    desc = row[3]
                    paren = desc.find("(")
                    display = desc[:paren].strip() if paren > 0 else desc
                if not display:
                    display = row[2] or row[1]  # Namespace or Name fallback
                conn.execute("UPDATE datasources SET DisplayName = ? WHERE DataSourceId = ?",
                             (display, row[0]))
            conn.commit()
            log.info("Migration: seeded DisplayName for %d datasources", len(needs_seed))

        # Add DisplayName column to connections if missing
        conn_cols = {r[1] for r in conn.execute("PRAGMA table_info(connections)").fetchall()}
        if "DisplayName" not in conn_cols:
            conn.execute("ALTER TABLE connections ADD COLUMN DisplayName TEXT")
            conn.commit()
            log.info("Migration: added DisplayName column to connections")

        # Seed DisplayName for connections that don't have one yet
        conn_needs_seed = conn.execute(
            "SELECT ConnectionId, Name, ServerName, DatabaseName FROM connections "
            "WHERE DisplayName IS NULL OR DisplayName = ''"
        ).fetchall()
        if conn_needs_seed:
            _CONN_SEEDS = {
                "CON_FMD_FABRIC_SQL": "Fabric SQL",
                "CON_FMD_FABRIC_PIPELINES": "Fabric Pipelines",
                "CON_FMD_FABRIC_NOTEBOOKS": "Fabric Notebooks",
                "CON_FMD_NOTEBOOK": "Custom Notebook",
                "CON_FMD_ONELAKE": "OneLake",
                "CON_FMD_M3DB1_MES": "MES (m3-db1)",
                "CON_FMD_M3DB3_ETQSTAGINGPRD": "ETQ (M3-DB3)",
                "CON_FMD_M3DB1_M3": "M3 ERP (sqllogshipprd)",
                "CON_FMD_M3DB1_M3CLOUD": "M3 Cloud (sql2016live)",
                "CON_FMD_SQLOPTIVALIVE_OPTIVALIVE": "Optiva (SQLOptivaLive)",
            }
            for row in conn_needs_seed:
                display = _CONN_SEEDS.get(row[1])
                if not display:
                    # Build from server → database
                    parts = []
                    if row[2]: parts.append(row[2])
                    if row[3]: parts.append(row[3])
                    display = " → ".join(parts) if parts else row[1]
                conn.execute("UPDATE connections SET DisplayName = ? WHERE ConnectionId = ?",
                             (display, row[0]))
            conn.commit()
            log.info("Migration: seeded DisplayName for %d connections", len(conn_needs_seed))
    finally:
        conn.close()
    log.info(f'Control-plane DB initialized at {DB_PATH}')


# ---------------------------------------------------------------------------
# Write helpers (all use _db_lock)
# ---------------------------------------------------------------------------

def _now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def upsert_connection(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO connections "
                "(ConnectionId, ConnectionGuid, Name, DisplayName, Type, ServerName, DatabaseName, IsActive, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row.get('ConnectionId'), _v(row.get('ConnectionGuid')),
                 _v(row.get('Name')), _v(row.get('DisplayName')),
                 _v(row.get('Type')), _v(row.get('ServerName')),
                 _v(row.get('DatabaseName')),
                 row.get('IsActive', 1), _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_datasource(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO datasources "
                "(DataSourceId, ConnectionId, Name, DisplayName, Namespace, Type, Description, IsActive, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row.get('DataSourceId'), row.get('ConnectionId'),
                 _v(row.get('Name')), _v(row.get('DisplayName')),
                 _v(row.get('Namespace')), _v(row.get('Type')),
                 _v(row.get('Description')),
                 row.get('IsActive', 1), _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_lakehouse(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO lakehouses "
                "(LakehouseId, Name, WorkspaceGuid, LakehouseGuid, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (row.get('LakehouseId'), _v(row.get('Name')),
                 _v(row.get('WorkspaceGuid')), _v(row.get('LakehouseGuid')),
                 _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_workspace(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO workspaces "
                "(WorkspaceId, WorkspaceGuid, Name, updated_at) "
                "VALUES (?, ?, ?, ?)",
                (row.get('WorkspaceId'), _v(row.get('WorkspaceGuid')),
                 _v(row.get('Name')), _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_pipeline(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO pipelines "
                "(PipelineId, Name, IsActive, updated_at) "
                "VALUES (?, ?, ?, ?)",
                (row.get('PipelineId'), _v(row.get('Name')),
                 row.get('IsActive', 1), _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_lz_entity(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO lz_entities "
                "(LandingzoneEntityId, DataSourceId, LakehouseId, SourceSchema, "
                "SourceName, SourceCustomSelect, FileName, FilePath, FileType, "
                "IsIncremental, IsIncrementalColumn, CustomNotebookName, IsActive, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row.get('LandingzoneEntityId'), row.get('DataSourceId'),
                 row.get('LakehouseId'), _v(row.get('SourceSchema')),
                 _v(row.get('SourceName')), _v(row.get('SourceCustomSelect')),
                 _v(row.get('FileName')), _v(row.get('FilePath')),
                 _v(row.get('FileType', 'parquet')),
                 row.get('IsIncremental', 0), _v(row.get('IsIncrementalColumn')),
                 _v(row.get('CustomNotebookName')),
                 row.get('IsActive', 1), _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_bronze_entity(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO bronze_entities "
                "(BronzeLayerEntityId, LandingzoneEntityId, LakehouseId, Schema_, "
                "Name, PrimaryKeys, FileType, IsActive, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row.get('BronzeLayerEntityId'), row.get('LandingzoneEntityId'),
                 row.get('LakehouseId'), _v(row.get('Schema_') or row.get('Schema')),
                 _v(row.get('Name')), _v(row.get('PrimaryKeys')),
                 _v(row.get('FileType', 'Delta')),
                 row.get('IsActive', 1), _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_silver_entity(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO silver_entities "
                "(SilverLayerEntityId, BronzeLayerEntityId, LakehouseId, Schema_, "
                "Name, FileType, IsActive, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (row.get('SilverLayerEntityId'), row.get('BronzeLayerEntityId'),
                 row.get('LakehouseId'), _v(row.get('Schema_') or row.get('Schema')),
                 _v(row.get('Name')), _v(row.get('FileType', 'delta')),
                 row.get('IsActive', 1), _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_engine_run(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT INTO engine_runs "
                "(RunId, Mode, Status, TotalEntities, SucceededEntities, FailedEntities, "
                "SkippedEntities, TotalRowsRead, TotalRowsWritten, TotalBytesTransferred, "
                "TotalDurationSeconds, Layers, EntityFilter, TriggeredBy, ErrorSummary, "
                "StartedAt, EndedAt, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(RunId) DO UPDATE SET "
                "Mode              = COALESCE(excluded.Mode, Mode), "
                "Status            = excluded.Status, "
                "TotalEntities     = CASE WHEN excluded.TotalEntities > 0 THEN excluded.TotalEntities ELSE TotalEntities END, "
                "SucceededEntities = CASE WHEN excluded.SucceededEntities > 0 THEN excluded.SucceededEntities ELSE SucceededEntities END, "
                "FailedEntities    = CASE WHEN excluded.FailedEntities > 0 THEN excluded.FailedEntities ELSE FailedEntities END, "
                "SkippedEntities   = CASE WHEN excluded.SkippedEntities > 0 THEN excluded.SkippedEntities ELSE SkippedEntities END, "
                "TotalRowsRead     = CASE WHEN excluded.TotalRowsRead > 0 THEN excluded.TotalRowsRead ELSE TotalRowsRead END, "
                "TotalRowsWritten  = CASE WHEN excluded.TotalRowsWritten > 0 THEN excluded.TotalRowsWritten ELSE TotalRowsWritten END, "
                "TotalBytesTransferred = CASE WHEN excluded.TotalBytesTransferred > 0 THEN excluded.TotalBytesTransferred ELSE TotalBytesTransferred END, "
                "TotalDurationSeconds  = CASE WHEN excluded.TotalDurationSeconds > 0 THEN excluded.TotalDurationSeconds ELSE TotalDurationSeconds END, "
                "Layers            = COALESCE(excluded.Layers, Layers), "
                "EntityFilter      = COALESCE(excluded.EntityFilter, EntityFilter), "
                "TriggeredBy       = COALESCE(excluded.TriggeredBy, TriggeredBy), "
                "ErrorSummary      = COALESCE(excluded.ErrorSummary, ErrorSummary), "
                "StartedAt         = COALESCE(excluded.StartedAt, StartedAt), "
                "EndedAt           = COALESCE(excluded.EndedAt, EndedAt), "
                "updated_at        = excluded.updated_at",
                (row.get('RunId'), _v(row.get('Mode')),
                 _v(row.get('Status', 'Unknown')),
                 row.get('TotalEntities', 0), row.get('SucceededEntities', 0),
                 row.get('FailedEntities', 0), row.get('SkippedEntities', 0),
                 row.get('TotalRowsRead', 0), row.get('TotalRowsWritten', 0),
                 row.get('TotalBytesTransferred', 0),
                 row.get('TotalDurationSeconds', 0),
                 _v(row.get('Layers')), _v(row.get('EntityFilter')),
                 _v(row.get('TriggeredBy')), _v(row.get('ErrorSummary')),
                 _v(row.get('StartedAt')), _v(row.get('EndedAt')),
                 _now())
            )
            conn.commit()
        finally:
            conn.close()


def insert_engine_task_log(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT INTO engine_task_log "
                "(RunId, EntityId, Layer, Status, SourceServer, SourceDatabase, "
                "SourceTable, SourceQuery, RowsRead, RowsWritten, BytesTransferred, "
                "DurationSeconds, TargetLakehouse, TargetPath, WatermarkColumn, "
                "WatermarkBefore, WatermarkAfter, LoadType, ErrorType, ErrorMessage, "
                "ErrorStackTrace, ErrorSuggestion, LogData, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (_v(row.get('RunId')), row.get('EntityId'),
                 _v(row.get('Layer')), _v(row.get('Status', 'Unknown')),
                 _v(row.get('SourceServer')), _v(row.get('SourceDatabase')),
                 _v(row.get('SourceTable')), _v(row.get('SourceQuery')),
                 row.get('RowsRead', 0), row.get('RowsWritten', 0),
                 row.get('BytesTransferred', 0), row.get('DurationSeconds', 0),
                 _v(row.get('TargetLakehouse')), _v(row.get('TargetPath')),
                 _v(row.get('WatermarkColumn')), _v(row.get('WatermarkBefore')),
                 _v(row.get('WatermarkAfter')), _v(row.get('LoadType')),
                 _v(row.get('ErrorType')), _v(row.get('ErrorMessage')),
                 _v(row.get('ErrorStackTrace')), _v(row.get('ErrorSuggestion')),
                 _v(row.get('LogData')), _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_pipeline_lz_entity(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO pipeline_lz_entity "
                "(id, LandingzoneEntityId, FileName, FilePath, InsertDateTime, IsProcessed, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (row.get('id'), row.get('LandingzoneEntityId'),
                 _v(row.get('FileName')), _v(row.get('FilePath')),
                 _v(row.get('InsertDateTime')),
                 row.get('IsProcessed', 0), _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_pipeline_bronze_entity(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO pipeline_bronze_entity "
                "(id, BronzeLayerEntityId, TableName, SchemaName, InsertDateTime, IsProcessed, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (row.get('id'), row.get('BronzeLayerEntityId'),
                 _v(row.get('TableName')), _v(row.get('SchemaName')),
                 _v(row.get('InsertDateTime')),
                 row.get('IsProcessed', 0), _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_entity_status(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO entity_status "
                "(LandingzoneEntityId, Layer, Status, LoadEndDateTime, "
                "ErrorMessage, UpdatedBy, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (row.get('LandingzoneEntityId'), _v(row.get('Layer')),
                 _v(row.get('Status')), _v(row.get('LoadEndDateTime')),
                 _v(row.get('ErrorMessage')), _v(row.get('UpdatedBy')),
                 _now())
            )
            conn.commit()
        finally:
            conn.close()


def upsert_watermark(entity_id: int, load_value: str, load_datetime: str = None) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO watermarks "
                "(LandingzoneEntityId, LoadValue, LastLoadDatetime, updated_at) "
                "VALUES (?, ?, ?, ?)",
                (entity_id, _v(load_value), _v(load_datetime), _now())
            )
            conn.commit()
        finally:
            conn.close()


def insert_pipeline_audit(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT INTO pipeline_audit "
                "(PipelineRunGuid, PipelineName, EntityLayer, TriggerType, "
                "LogType, LogDateTime, LogData, EntityId, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (_v(row.get('PipelineRunGuid')), _v(row.get('PipelineName')),
                 _v(row.get('EntityLayer')), _v(row.get('TriggerType')),
                 _v(row.get('LogType')), _v(row.get('LogDateTime')),
                 _v(row.get('LogData')), row.get('EntityId'), _now())
            )
            conn.commit()
        finally:
            conn.close()


def insert_copy_activity_audit(row: dict) -> None:
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT INTO copy_activity_audit "
                "(PipelineRunGuid, CopyActivityName, EntityLayer, TriggerType, "
                "LogType, LogDateTime, LogData, EntityId, CopyActivityParameters, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (_v(row.get('PipelineRunGuid')), _v(row.get('CopyActivityName')),
                 _v(row.get('EntityLayer')), _v(row.get('TriggerType')),
                 _v(row.get('LogType')), _v(row.get('LogDateTime')),
                 _v(row.get('LogData')), row.get('EntityId'),
                 _v(row.get('CopyActivityParameters')), _now())
            )
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Read functions — return list[dict] consumed by route handlers
# ---------------------------------------------------------------------------

def get_connections() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT ConnectionId, ConnectionGuid, Name, Type, ServerName, DatabaseName, IsActive "
            "FROM connections ORDER BY Name"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_datasources() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT d.DataSourceId, d.Name, d.Namespace, d.Type, d.Description, "
            "       d.IsActive, c.Name AS ConnectionName "
            "FROM datasources d "
            "LEFT JOIN connections c ON c.ConnectionId = d.ConnectionId "
            "ORDER BY d.Namespace, d.Name"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_lz_entities() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT e.LandingzoneEntityId, e.SourceSchema, e.SourceName, "
            "       e.IsActive, e.IsIncremental, d.Name AS DataSourceName, d.Namespace "
            "FROM lz_entities e "
            "LEFT JOIN datasources d ON d.DataSourceId = e.DataSourceId "
            "ORDER BY d.Namespace, e.SourceName"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_bronze_entities() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT b.BronzeLayerEntityId, b.Schema_ AS Schema, b.Name, "
            "       b.IsActive, d.Namespace "
            "FROM bronze_entities b "
            "LEFT JOIN lz_entities e ON e.LandingzoneEntityId = b.LandingzoneEntityId "
            "LEFT JOIN datasources d ON d.DataSourceId = e.DataSourceId "
            "ORDER BY b.Name"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_silver_entities() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT s.SilverLayerEntityId, s.Schema_ AS Schema, s.Name, "
            "       s.IsActive, d.Namespace "
            "FROM silver_entities s "
            "LEFT JOIN bronze_entities b ON b.BronzeLayerEntityId = s.BronzeLayerEntityId "
            "LEFT JOIN lz_entities e ON e.LandingzoneEntityId = b.LandingzoneEntityId "
            "LEFT JOIN datasources d ON d.DataSourceId = e.DataSourceId "
            "ORDER BY s.Name"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_bronze_view() -> list[dict]:
    """Bronze queue view — active bronze entities with queue/processing state.
    Mirrors execution.vw_LoadToBronzeLayer."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT b.BronzeLayerEntityId, b.LandingzoneEntityId, b.Schema_ AS [Schema], "
            "       b.Name, b.PrimaryKeys, b.FileType, b.IsActive, "
            "       e.SourceSchema, e.SourceName, e.FileName, e.FilePath, "
            "       d.Name AS DataSourceName, d.Namespace, "
            "       pb.IsProcessed, pb.InsertDateTime "
            "FROM bronze_entities b "
            "LEFT JOIN lz_entities e ON e.LandingzoneEntityId = b.LandingzoneEntityId "
            "LEFT JOIN datasources d ON d.DataSourceId = e.DataSourceId "
            "LEFT JOIN pipeline_bronze_entity pb ON pb.BronzeLayerEntityId = b.BronzeLayerEntityId "
            "WHERE b.IsActive = 1 "
            "ORDER BY d.Namespace, b.Name"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_silver_view() -> list[dict]:
    """Silver queue view — active silver entities with queue/processing state.
    Mirrors execution.vw_LoadToSilverLayer."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT s.SilverLayerEntityId, s.BronzeLayerEntityId, s.Schema_ AS [Schema], "
            "       s.Name, s.FileType, s.IsActive, "
            "       b.PrimaryKeys, b.LandingzoneEntityId, "
            "       e.SourceSchema, e.SourceName, "
            "       d.Name AS DataSourceName, d.Namespace "
            "FROM silver_entities s "
            "LEFT JOIN bronze_entities b ON b.BronzeLayerEntityId = s.BronzeLayerEntityId "
            "LEFT JOIN lz_entities e ON e.LandingzoneEntityId = b.LandingzoneEntityId "
            "LEFT JOIN datasources d ON d.DataSourceId = e.DataSourceId "
            "WHERE s.IsActive = 1 "
            "ORDER BY d.Namespace, s.Name"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_lakehouses() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT LakehouseId, Name FROM lakehouses ORDER BY Name"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_workspaces() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT WorkspaceId, Name FROM workspaces ORDER BY Name"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_pipelines() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT PipelineId, Name, IsActive FROM pipelines ORDER BY Name"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_pipeline_executions(limit: int = 500) -> list[dict]:
    """Return raw pipeline execution events (individual log rows), most recent first.
    Mirrors logging.PipelineExecution shape for the Execution Log page."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT PipelineRunGuid, PipelineName, EntityLayer, TriggerType, "
            "LogType, LogDateTime, LogData, EntityId "
            "FROM pipeline_audit ORDER BY LogDateTime DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_copy_executions(limit: int = 500) -> list[dict]:
    """Return raw copy activity execution events, most recent first.
    Mirrors logging.CopyActivityExecution shape."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT PipelineRunGuid, CopyActivityName, EntityLayer, TriggerType, "
            "LogType, LogDateTime, LogData, EntityId, CopyActivityParameters "
            "FROM copy_activity_audit ORDER BY LogDateTime DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_pipeline_runs_grouped() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute("""
            SELECT
                PipelineRunGuid,
                PipelineName,
                EntityLayer,
                TriggerType,
                MIN(CASE WHEN LogType LIKE 'Start%' OR LogType = 'InProgress' THEN LogDateTime END) AS StartTime,
                MAX(CASE WHEN LogType LIKE 'End%' OR LogType = 'Succeeded' OR LogType = 'Failed' OR LogType = 'Aborted' THEN LogDateTime END) AS EndTime,
                MAX(CASE WHEN LogType LIKE 'End%' OR LogType = 'Succeeded' OR LogType = 'Failed' OR LogType = 'Aborted' THEN LogData     END) AS EndLogData,
                MAX(CASE WHEN LogType LIKE 'Error%' OR LogType = 'PipelineError' OR LogType = 'Failed' THEN LogData END) AS ErrorData,
                COUNT(*) AS LogCount
            FROM pipeline_audit
            GROUP BY PipelineRunGuid, PipelineName, EntityLayer, TriggerType
            ORDER BY StartTime DESC
        """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_engine_runs(limit: int = 50) -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM engine_runs ORDER BY StartedAt DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_engine_task_log(run_id: str = None, entity_id: int = None) -> list[dict]:
    conn = _get_conn()
    try:
        sql = "SELECT * FROM engine_task_log WHERE 1=1"
        params = []
        if run_id is not None:
            sql += " AND RunId = ?"
            params.append(run_id)
        if entity_id is not None:
            sql += " AND EntityId = ?"
            params.append(entity_id)
        sql += " ORDER BY created_at DESC"
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_entity_status_all() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute("SELECT * FROM entity_status").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_registered_entities_full() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT e.*, d.Name AS DataSourceName, d.Namespace, "
            "       c.Name AS ConnectionName, c.ServerName, c.DatabaseName "
            "FROM lz_entities e "
            "LEFT JOIN datasources d ON d.DataSourceId = e.DataSourceId "
            "LEFT JOIN connections c ON c.ConnectionId = d.ConnectionId "
            "ORDER BY d.Namespace, e.SourceName"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_source_config() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT d.DataSourceId, d.Name, d.DisplayName, d.Namespace, d.Type, d.Description, "
            "       d.IsActive, c.ConnectionId, c.Name AS ConnectionName, "
            "       c.ServerName, c.DatabaseName "
            "FROM datasources d "
            "LEFT JOIN connections c ON c.ConnectionId = d.ConnectionId "
            "ORDER BY d.Namespace, d.Name"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Bulk / utility operations
# ---------------------------------------------------------------------------

def bulk_seed(table: str, rows: list[dict]) -> int:
    """Bulk INSERT OR REPLACE for deploy-script seeding. Returns row count."""
    if not rows:
        return 0
    # Use the keys from the first row as the column set
    cols = list(rows[0].keys())
    placeholders = ', '.join(['?'] * len(cols))
    col_names = ', '.join(cols)
    sql = f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})"
    count = 0
    with _db_lock:
        conn = _get_conn()
        try:
            for row in rows:
                vals = tuple(row.get(c) for c in cols)
                conn.execute(sql, vals)
                count += 1
            conn.commit()
        finally:
            conn.close()
    return count


def get_sync_watermark() -> str:
    """Read last_sync timestamp from sync_metadata."""
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT value FROM sync_metadata WHERE key = 'last_sync'"
        ).fetchone()
        return row['value'] if row else None
    finally:
        conn.close()


def set_sync_watermark(ts: str) -> None:
    """Write last_sync timestamp to sync_metadata."""
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) "
                "VALUES ('last_sync', ?, ?)",
                (ts, _now())
            )
            conn.commit()
        finally:
            conn.close()


def get_stats() -> dict:
    """Return row counts for all tables (diagnostics)."""
    tables = [
        'connections', 'datasources', 'lakehouses', 'workspaces', 'pipelines',
        'lz_entities', 'bronze_entities', 'silver_entities',
        'engine_runs', 'engine_task_log',
        'pipeline_lz_entity', 'pipeline_bronze_entity',
        'entity_status', 'watermarks',
        'pipeline_audit', 'copy_activity_audit',
        'sync_metadata', 'admin_config',
        'notebook_executions', 'import_jobs', 'server_labels',
    ]
    conn = _get_conn()
    try:
        result = {}
        for t in tables:
            row = conn.execute(f"SELECT COUNT(*) AS cnt FROM {t}").fetchone()
            result[t] = row['cnt']
        return result
    finally:
        conn.close()


def cleanup_old_data(days: int = 90) -> None:
    """Purge engine_task_log, pipeline_audit, copy_activity_audit older than N days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute("DELETE FROM engine_task_log WHERE created_at < ?", (cutoff,))
            conn.execute("DELETE FROM pipeline_audit WHERE created_at < ?", (cutoff,))
            conn.execute("DELETE FROM copy_activity_audit WHERE created_at < ?", (cutoff,))
            conn.commit()
        finally:
            conn.close()


# Auto-init on import
init_db()
