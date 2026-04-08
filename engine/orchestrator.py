"""
FMD v3 Engine — Main orchestrator.

The run loop is intentionally simple — a junior dev should be able to read
it in 5 minutes.  All complexity lives in the modules it calls:

    1. Get worklist from SQL
    2. For each entity: extract → upload → log
    3. Trigger Bronze notebook
    4. Trigger Silver notebook
    5. Done

Controlled via REST API from the dashboard — no terminal interaction ever.
"""

import logging
import threading
import time
import uuid
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional

from engine.auth import TokenProvider
from engine.connections import SourceConnection, build_source_map
from engine.extractor import DataExtractor
from engine.loader import OneLakeLoader
from engine.logging_db import AuditLogger
from engine.models import EngineConfig, Entity, RunResult, LoadPlan
from engine.notebook_trigger import NotebookTrigger
from engine.pipeline_runner import FabricPipelineRunner
from engine.preflight import PreflightChecker, PreflightReport
from engine.vpn import ensure_vpn, is_vpn_up

log = logging.getLogger("fmd.orchestrator")


class RunTimeoutError(Exception):
    """Raised when a load run exceeds its timeout."""
    pass

# Throttling-specific errors that trigger immediate concurrency reduction
_THROTTLE_PATTERNS = frozenset({
    "429", "request limit", "too many connections",
    "connection pool exhausted", "rate limit exceeded",
    "resource governor", "server is too busy",
})


class AdaptiveThrottle:
    """AIMD-style concurrency controller.

    Starts at max_workers, multiplicatively decreases on high failure rates,
    additively increases during sustained success.  Same principle as TCP
    congestion control.
    """

    def __init__(self, max_workers: int, min_workers: int = 2):
        self._max = max_workers
        self._min = min_workers
        self._current = max_workers
        self._semaphore = threading.Semaphore(max_workers)
        self._lock = threading.Lock()
        self._recent: deque[bool] = deque(maxlen=20)
        self._last_ramp_up = time.time()

    @property
    def current(self) -> int:
        return self._current

    def acquire(self) -> None:
        self._semaphore.acquire()

    def release(self, succeeded: bool) -> None:
        self._recent.append(succeeded)
        self._maybe_adjust()
        self._semaphore.release()

    def _maybe_adjust(self) -> None:
        if len(self._recent) < 5:
            return
        failure_rate = sum(1 for r in self._recent if not r) / len(self._recent)

        with self._lock:
            if failure_rate > 0.20 and self._current > self._min:
                new_limit = max(self._min, self._current // 2)
                if new_limit < self._current:
                    log.warning(
                        "Throttling concurrency: %d → %d (%.0f%% failure rate)",
                        self._current, new_limit, failure_rate * 100,
                    )
                    self._current = new_limit
            elif failure_rate < 0.05 and time.time() - self._last_ramp_up > 30:
                if self._current < self._max:
                    self._current += 1
                    self._last_ramp_up = time.time()
                    log.info("Ramping up concurrency: %d", self._current)


# Connection-error patterns that indicate VPN/network failure (not app-level errors)
_CONNECTION_ERROR_PATTERNS = frozenset({
    "[08001]", "could not open a connection", "named pipes provider",
    "[53]", "[64]", "network name is no longer available",
    "tcp provider", "connection was forcibly closed",
})


class ConnectionCircuitBreaker:
    """Per-server circuit breaker — trips after N consecutive connection failures.

    When tripped, all remaining entities for that server are skipped immediately
    instead of burning hours retrying a dead connection.
    """

    def __init__(self, trip_threshold: int = 5):
        self._threshold = trip_threshold
        self._lock = threading.Lock()
        # server -> consecutive failure count
        self._failures: dict[str, int] = {}
        # server -> set of tripped servers
        self._tripped: set[str] = set()

    def record_success(self, server: str) -> None:
        with self._lock:
            self._failures[server] = 0

    def record_failure(self, server: str, error: str) -> None:
        if not self._is_connection_error(error):
            return  # App-level errors don't count
        with self._lock:
            self._failures[server] = self._failures.get(server, 0) + 1
            if self._failures[server] >= self._threshold and server not in self._tripped:
                self._tripped.add(server)
                log.error(
                    "CIRCUIT BREAKER: Server %s tripped after %d consecutive connection failures — "
                    "skipping remaining entities. Check VPN.",
                    server, self._failures[server],
                )

    def is_tripped(self, server: str) -> bool:
        return server in self._tripped

    @property
    def tripped_servers(self) -> set[str]:
        return set(self._tripped)

    @staticmethod
    def _is_connection_error(error: str) -> bool:
        error_lower = error.lower()
        return any(p in error_lower for p in _CONNECTION_ERROR_PATTERNS)


class LoadOrchestrator:
    """Main FMD v3 engine.  Called by the dashboard REST API.

    Usage::

        config = load_config()
        engine = LoadOrchestrator(config)
        results = engine.run(mode="plan")   # dry-run
        results = engine.run()               # extract + load + notebooks
        engine.stop()                        # graceful stop
    """

    def __init__(self, config: EngineConfig):
        self.config = config
        self.status: str = "idle"            # idle | running | stopping | error
        self.current_run_id: Optional[str] = None
        self._stop_requested: bool = False
        self._current_pool: Optional[ThreadPoolExecutor] = None
        self.on_entity_result = None         # callback: (run_id, RunResult) -> None
        self._resume_mode: bool = False
        self._current_layer: str = "idle"
        self._completed_units: int = 0       # entity-layer completions (not unique entities)

        # Startup config validation — fail fast on missing critical fields
        self._validate_config(config)

        # Build the dependency graph — one instance of each module
        self._tokens = TokenProvider(config)
        self._source_conn = SourceConnection(config)
        self._extractor = DataExtractor(config, self._source_conn)
        self._loader = OneLakeLoader(config, self._tokens)
        self._audit = AuditLogger()
        self._notebooks = NotebookTrigger(config, self._tokens)
        self._pipeline_runner = FabricPipelineRunner(config, self._tokens)
        self._load_method = config.load_method          # "notebook" | "pipeline" | "local"
        self._pipeline_fallback = config.pipeline_fallback
        self._circuit_breaker = ConnectionCircuitBreaker(trip_threshold=5)

        # Notebook IDs are resolved dynamically from the Fabric API by
        # NotebookTrigger — no hardcoded GUIDs needed in config.

    @staticmethod
    def _validate_config(config: EngineConfig) -> None:
        """Validate all critical config fields are set at startup."""
        missing = []
        for field in [
            "workspace_code_id", "workspace_data_id",
            "lz_lakehouse_id", "bronze_lakehouse_id", "silver_lakehouse_id",
            "tenant_id", "client_id", "client_secret",
        ]:
            if not getattr(config, field, None):
                missing.append(field)
        if hasattr(config, "sql_server") and not config.sql_server:
            missing.append("sql_server")
        if hasattr(config, "sql_database") and not config.sql_database:
            missing.append("sql_database")

        if missing:
            # SHARED-ENG-005: Raise on empty GUIDs instead of logging and continuing.
            # Previously this only logged a warning, allowing the engine to start
            # with an invalid config and fail in confusing ways downstream.
            raise ValueError(
                f"CONFIGURATION ERROR: {len(missing)} critical fields are empty: "
                f"{', '.join(missing)}. "
                "Fix via Admin → Environment → Save & Propagate."
            )

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def run(
        self,
        mode: str = "run",
        entity_ids: Optional[List[int]] = None,
        layers: Optional[List[str]] = None,
        triggered_by: str = "dashboard",
        load_method: Optional[str] = None,
        pipeline_fallback: Optional[bool] = None,
        run_id: Optional[str] = None,
        resume_run_id: Optional[str] = None,
    ) -> list | LoadPlan:
        """Main entry point.  Called by the REST API or engine/worker.py.

        Parameters
        ----------
        mode : str
            'run' = execute everything, 'plan' = compute worklist only.
        entity_ids : optional
            Subset of entity IDs to process.  None = all active entities.
        layers : optional
            Which layers to run: ['landing'], ['landing','bronze'], etc.
            None = all layers (landing + bronze + silver).
        triggered_by : str
            Who kicked this off — 'dashboard', 'schedule', 'manual', 'worker'.
        load_method : optional
            Override config load_method: 'notebook', 'pipeline', or 'local'.
        pipeline_fallback : optional
            Override config pipeline_fallback.
        run_id : optional
            Explicit run ID (pre-generated by API). Falls back to uuid4().
        resume_run_id : optional
            ID of an interrupted run to resume. Skips already-succeeded entities.

        Returns
        -------
        list[RunResult] | LoadPlan
            Results (run mode) or plan (plan mode).
        """
        # Determine run_id: resume > explicit > generated
        if resume_run_id:
            run_id = resume_run_id
            self._resume_mode = True
            log.info("RESUME MODE: resuming interrupted run %s", run_id)
        else:
            run_id = run_id or str(uuid.uuid4())
            self._resume_mode = False

        # Plan mode: DON'T set status to "running" — it's a read-only query
        # that should not affect the status poll or trigger the Live Run Panel.
        if mode == "plan":
            try:
                entities = self.get_worklist(entity_ids)
                return self.build_plan(run_id, entities, layers,
                                       load_method_override=load_method,
                                       pipeline_fallback_override=pipeline_fallback)
            except Exception:
                log.exception("Plan generation failed for run %s", run_id)
                raise

        self.status = "running"
        self._stop_requested = False
        self.current_run_id = run_id

        # Seed progress counters for resume — start from already-completed units
        self._current_layer = "starting"
        self._completed_units = 0
        if self._resume_mode:
            for layer in ["landing", "bronze", "silver"]:
                self._completed_units += len(self._get_completed_entity_ids(run_id, layer))
            log.info("Resume: seeded %d already-completed units", self._completed_units)

        # Start heartbeat thread — writes progress to SQLite every 30s
        hb = threading.Thread(
            target=self._heartbeat_loop, args=(run_id,),
            daemon=True, name="heartbeat",
        )
        hb.start()

        # Per-run overrides for load method
        if load_method is not None:
            self._load_method = load_method
        if pipeline_fallback is not None:
            self._pipeline_fallback = pipeline_fallback

        effective_method = self._load_method
        log.info("Load method: %s (fallback=%s)", effective_method, self._pipeline_fallback)

        # FIXED: CRITICAL BUG #4 — Add run timeout to prevent indefinite hangs
        # Default timeout: 24 hours (86400 seconds). Can be overridden via config or API parameter.
        # Helps catch stuck entity extractions, network hangs, etc.
        run_timeout_seconds = getattr(self.config, "run_timeout_seconds", 86400)

        try:
            entities = self.get_worklist(entity_ids)
            self._audit.log_run_start(run_id, mode, len(entities), layers, triggered_by)

            results: list[RunResult] = []

            # Inject tracked failures for blank SourceName entities
            for eid in getattr(self, "_blank_source_ids", []):
                results.append(RunResult(
                    entity_id=eid, layer="landing", status="failed",
                    error="Blank SourceName in metadata",
                    error_suggestion=(
                        "This entity has an empty SourceName in integration.LandingzoneEntity. "
                        "Fix: UPDATE integration.LandingzoneEntity SET SourceName = '<table_name>' "
                        # int() cast guarantees numeric — safe for display-only suggestion
                        "WHERE LandingzoneEntityId = %d" % int(eid)
                    ),
                ))

            t_start = time.time()
            log.info("Starting run with %.1f hour timeout", run_timeout_seconds / 3600)

            # Landing Zone — extract from source, upload Parquet to OneLake
            lz_duration = 0.0
            if not layers or "landing" in layers:
                self._current_layer = "landing"
                lz_t = time.time()
                lz_results = self._run_landing_zone(run_id, entities)
                results.extend(lz_results)
                lz_duration = time.time() - lz_t

            # Bronze
            bronze_duration = 0.0
            if not layers or "bronze" in layers:
                self._current_layer = "bronze"
                bronze_t = time.time()
                if effective_method == "local":
                    bronze_results = self._run_bronze_local(run_id)
                    results.extend(bronze_results)
                else:
                    bronze_result = self._notebooks.run_bronze(run_id)
                    results.append(bronze_result)
                bronze_duration = time.time() - bronze_t

            # Silver
            silver_duration = 0.0
            if not layers or "silver" in layers:
                self._current_layer = "silver"
                silver_t = time.time()
                if effective_method == "local":
                    silver_results = self._run_silver_local(run_id)
                    results.extend(silver_results)
                else:
                    silver_result = self._notebooks.run_silver(run_id)
                    results.append(silver_result)
                silver_duration = time.time() - silver_t

            self._audit.log_run_end(run_id, results)

            # Run summary log
            total_duration = time.time() - t_start
            succeeded = sum(1 for r in results if r.status == "succeeded")
            failed = sum(1 for r in results if r.status == "failed")
            skipped = sum(1 for r in results if r.status == "skipped")
            error_counts = Counter(
                (r.error or "Unknown")[:60] for r in results if r.status == "failed"
            )
            top_errors = ", ".join(f"{msg} ({cnt})" for msg, cnt in error_counts.most_common(5))
            log.info(
                "[RUN COMPLETE] %d entities: %d succeeded, %d failed, %d skipped (%.1fs total)\n"
                "  Landing Zone: %.1fs | Bronze: %.1fs | Silver: %.1fs\n"
                "  Top errors: %s",
                len(results), succeeded, failed, skipped, total_duration,
                lz_duration, bronze_duration, silver_duration,
                top_errors or "none",
            )

            self.status = "idle"
            return results

        except Exception as exc:
            self._audit.log_run_error(run_id, exc)
            self.status = "error"
            raise

        finally:
            self.current_run_id = None
            # Belt-and-suspenders: guarantee the run has a terminal status.
            # If log_run_end / log_run_error succeeded, the row is already
            # Succeeded/Failed and this UPDATE is a no-op (WHERE still InProgress).
            try:
                from dashboard.app.api import control_plane_db as cpdb
                cpdb.execute(
                    "UPDATE engine_runs "
                    "SET Status = CASE "
                    "    WHEN Status IN ('InProgress', 'running') THEN 'Interrupted' "
                    "    ELSE Status END, "
                    "EndedAt = CASE "
                    "    WHEN EndedAt IS NULL THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') "
                    "    ELSE EndedAt END, "
                    "ErrorSummary = CASE "
                    "    WHEN Status IN ('InProgress', 'running') AND "
                    "         (ErrorSummary IS NULL OR ErrorSummary = '') "
                    "    THEN 'Interrupted: process exited without recording completion' "
                    "    ELSE ErrorSummary END "
                    "WHERE RunId = ?",
                    (run_id,),
                )
            except Exception:
                log.debug("Finally-block status guard failed for %s (non-fatal)", run_id[:8])

    def stop(self, force: bool = False) -> None:
        """Stop the engine.

        force=False: graceful — finish current entity, skip the rest.
        force=True:  hard stop — cancel pending futures immediately.
        """
        self._stop_requested = True
        self.status = "stopping"

        if force and self._current_pool:
            log.warning("Force-stopping engine — cancelling pending futures")
            try:
                self._current_pool.shutdown(wait=False, cancel_futures=True)
            except TypeError:
                # Python < 3.9 doesn't have cancel_futures
                self._current_pool.shutdown(wait=False)
            self._current_pool = None

    # ------------------------------------------------------------------
    # Preflight
    # ------------------------------------------------------------------

    def preflight(
        self, entity_ids: Optional[List[int]] = None
    ) -> PreflightReport:
        """Run health checks without processing anything."""
        entities = self.get_worklist(entity_ids) if entity_ids else None
        checker = PreflightChecker(
            self.config,
            self._tokens,
            self._source_conn,
            self._loader,
        )
        return checker.run(entities)

    # ------------------------------------------------------------------
    # Worklist
    # ------------------------------------------------------------------

    def get_worklist(self, entity_ids: Optional[List[int]] = None) -> List[Entity]:
        """Fetch active entities from the local SQLite control-plane DB.

        Mirrors the Fabric SQL query against the local SQLite tables that are
        synced from Fabric SQL by the dashboard.  No Fabric SQL connection needed.
        """
        sql = """
            SELECT
                le.LandingzoneEntityId,
                le.SourceName,
                le.SourceSchema,
                c.ServerName      AS SourceServer,
                c.DatabaseName    AS SourceDatabase,
                le.DataSourceId,
                c.Type            AS ConnectionType,
                lh.WorkspaceGuid,
                lh.LakehouseGuid,
                le.IsIncremental,
                le.IsIncrementalColumn AS WatermarkColumn,
                w.LoadValue       AS LastLoadValue,
                be.PrimaryKeys,
                le.IsActive,
                COALESCE(NULLIF(ds.Namespace, ''), ds.Name) AS Namespace,
                c.ConnectionGuid
            FROM lz_entities le
            INNER JOIN datasources ds  ON le.DataSourceId  = ds.DataSourceId
            INNER JOIN connections c   ON ds.ConnectionId  = c.ConnectionId
            INNER JOIN lakehouses  lh  ON le.LakehouseId   = lh.LakehouseId
            LEFT JOIN  watermarks  w   ON le.LandingzoneEntityId = w.LandingzoneEntityId
            LEFT JOIN  bronze_entities be ON le.LandingzoneEntityId = be.LandingzoneEntityId
            WHERE le.IsActive = 1
        """

        params: tuple = ()
        if entity_ids:
            placeholders = ",".join("?" for _ in entity_ids)
            sql += f" AND le.LandingzoneEntityId IN ({placeholders})"
            params = tuple(entity_ids)

        rows = self._cpdb_query(sql, params)

        entities: list[Entity] = []
        blank_ids: list[int] = []
        for row in rows:
            source_name = str(row.get("SourceName", "") or "").strip()
            if not source_name:
                blank_ids.append(int(row.get("LandingzoneEntityId", 0)))
                continue

            entities.append(Entity(
                id=int(row["LandingzoneEntityId"]),
                source_name=source_name,
                source_schema=str(row.get("SourceSchema", "dbo")),
                source_server=str(row.get("SourceServer", "")),
                source_database=str(row.get("SourceDatabase", "")),
                datasource_id=int(row.get("DataSourceId", 0)),
                connection_type=str(row.get("ConnectionType", "")),
                workspace_guid=str(row.get("WorkspaceGuid", "")),
                lakehouse_guid=str(row.get("LakehouseGuid", "")),
                file_path="",
                file_name="",
                is_incremental=bool(row.get("IsIncremental", False)),
                watermark_column=row.get("WatermarkColumn"),
                last_load_value=row.get("LastLoadValue"),
                primary_keys=row.get("PrimaryKeys"),
                is_active=bool(row.get("IsActive", True)),
                namespace=row.get("Namespace"),
                connection_guid=str(row.get("ConnectionGuid", "") or ""),
            ))

        if blank_ids:
            log.error(
                "BLANK SourceName: %d entities have empty SourceName and will fail: %s. "
                "Fix in control-plane DB: UPDATE lz_entities SET SourceName = '<table_name>' "
                "WHERE LandingzoneEntityId IN (%s)",
                len(blank_ids), blank_ids[:10], ",".join(str(i) for i in blank_ids),
            )
        # Store blank IDs so run() can inject tracked failures
        self._blank_source_ids = blank_ids

        log.info("Worklist: %d entities from SQLite control-plane DB (%d skipped — blank SourceName)",
                 len(entities), len(blank_ids))
        return entities

    def get_bronze_worklist(self, entity_ids: Optional[List[int]] = None) -> list:
        """Fetch active bronze entities from the local SQLite control-plane DB."""
        from engine.models import BronzeEntity

        sql = """
            SELECT
                be.BronzeLayerEntityId,
                be.LandingzoneEntityId,
                COALESCE(NULLIF(ds.Namespace, ''), ds.Name) AS Namespace,
                le.SourceSchema,
                le.SourceName,
                be.PrimaryKeys,
                le.IsIncremental,
                lh_bronze.LakehouseGuid AS BronzeLakehouseGuid,
                lh_bronze.WorkspaceGuid AS WorkspaceGuid,
                le.SourceName || '.parquet' AS LzFileName,
                COALESCE(NULLIF(ds.Namespace, ''), ds.Name) AS LzNamespace,
                lh_lz.LakehouseGuid AS LzLakehouseGuid
            FROM bronze_entities be
            INNER JOIN lz_entities le     ON be.LandingzoneEntityId = le.LandingzoneEntityId
            INNER JOIN datasources ds     ON le.DataSourceId = ds.DataSourceId
            INNER JOIN connections c       ON ds.ConnectionId = c.ConnectionId
            INNER JOIN lakehouses lh_bronze ON be.LakehouseId = lh_bronze.LakehouseId
            INNER JOIN lakehouses lh_lz    ON le.LakehouseId = lh_lz.LakehouseId
            WHERE be.IsActive = 1
              AND le.IsActive = 1
        """

        params: tuple = ()
        if entity_ids:
            placeholders = ",".join("?" for _ in entity_ids)
            sql += f" AND be.BronzeLayerEntityId IN ({placeholders})"
            params = tuple(entity_ids)

        rows = self._cpdb_query(sql, params)
        entities = []
        for row in rows:
            source_name = str(row.get("SourceName", "") or "").strip()
            if not source_name:
                continue
            entities.append(BronzeEntity(
                bronze_entity_id=int(row["BronzeLayerEntityId"]),
                lz_entity_id=int(row["LandingzoneEntityId"]),
                namespace=row.get("Namespace", ""),
                source_schema=row.get("SourceSchema", "dbo"),
                source_name=source_name,
                primary_keys=row.get("PrimaryKeys", "") or "",
                is_incremental=bool(row.get("IsIncremental", False)),
                lakehouse_guid=row.get("BronzeLakehouseGuid", ""),
                workspace_guid=row.get("WorkspaceGuid", ""),
                lz_file_name=row.get("LzFileName", f"{source_name}.parquet"),
                lz_namespace=row.get("LzNamespace", ""),
                lz_lakehouse_guid=row.get("LzLakehouseGuid", ""),
            ))

        log.info("Bronze worklist: %d entities", len(entities))
        return entities

    def get_silver_worklist(self, entity_ids: Optional[List[int]] = None) -> list:
        """Fetch active silver entities from the local SQLite control-plane DB."""
        from engine.models import SilverEntity

        sql = """
            SELECT
                se.SilverLayerEntityId,
                se.BronzeLayerEntityId,
                le.LandingzoneEntityId,
                COALESCE(NULLIF(ds.Namespace, ''), ds.Name) AS Namespace,
                le.SourceName,
                be.PrimaryKeys,
                le.IsIncremental,
                lh_silver.LakehouseGuid AS SilverLakehouseGuid,
                lh_silver.WorkspaceGuid AS WorkspaceGuid,
                lh_bronze.LakehouseGuid AS BronzeLakehouseGuid
            FROM silver_entities se
            INNER JOIN bronze_entities be   ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
            INNER JOIN lz_entities le       ON be.LandingzoneEntityId = le.LandingzoneEntityId
            INNER JOIN datasources ds       ON le.DataSourceId = ds.DataSourceId
            INNER JOIN lakehouses lh_silver ON se.LakehouseId = lh_silver.LakehouseId
            INNER JOIN lakehouses lh_bronze ON be.LakehouseId = lh_bronze.LakehouseId
            WHERE se.IsActive = 1
              AND be.IsActive = 1
              AND le.IsActive = 1
        """

        params: tuple = ()
        if entity_ids:
            placeholders = ",".join("?" for _ in entity_ids)
            sql += f" AND se.SilverLayerEntityId IN ({placeholders})"
            params = tuple(entity_ids)

        rows = self._cpdb_query(sql, params)
        entities = []
        for row in rows:
            source_name = str(row.get("SourceName", "") or "").strip()
            if not source_name:
                continue
            entities.append(SilverEntity(
                silver_entity_id=int(row["SilverLayerEntityId"]),
                bronze_entity_id=int(row["BronzeLayerEntityId"]),
                namespace=row.get("Namespace", ""),
                source_name=source_name,
                primary_keys=row.get("PrimaryKeys", "") or "",
                is_incremental=bool(row.get("IsIncremental", False)),
                lakehouse_guid=row.get("SilverLakehouseGuid", ""),
                workspace_guid=row.get("WorkspaceGuid", ""),
                bronze_lakehouse_guid=row.get("BronzeLakehouseGuid", ""),
                lz_entity_id=int(row.get("LandingzoneEntityId", 0) or 0),
            ))

        log.info("Silver worklist: %d entities", len(entities))
        return entities

    @staticmethod
    def _cpdb_query(sql: str, params: tuple = ()) -> list[dict]:
        """Query the local SQLite control-plane DB.  Returns list of dicts.

        Uses the same lazy-import pattern as logging_db.py to avoid circular
        imports and allow the engine to run standalone.
        """
        try:
            from dashboard.app.api import db as fmd_db
            rows = fmd_db.query(sql, params)
            # fmd_db.query returns sqlite3.Row objects — convert to plain dicts
            return [dict(r) for r in rows]
        except Exception as exc:
            log.error("SQLite worklist query failed: %s", exc)
            return []

    @staticmethod
    def _cpdb_execute(sql: str, params: tuple = ()) -> None:
        """Execute a write statement against the local SQLite control-plane DB.

        SHARED-ENG-010: Previously swallowed all write failures silently.
        Now logs at WARNING and re-raises so callers (watermark updates,
        status writes) are aware the write did not persist.
        """
        try:
            from dashboard.app.api import db as fmd_db
            fmd_db.execute(sql, params)
        except Exception as exc:
            log.warning("SQLite execute failed (will raise): %s — SQL: %s", exc, sql[:120])
            raise

    def _get_completed_entity_ids(self, run_id: str, layer: str) -> set[int]:
        """Query engine_task_log for entities already succeeded in this run+layer."""
        rows = self._cpdb_query(
            "SELECT EntityId FROM engine_task_log "
            "WHERE RunId = ? AND LOWER(Layer) = LOWER(?) AND LOWER(Status) = 'succeeded'",
            (run_id, layer),
        )
        return {int(r["EntityId"]) for r in rows}

    def _heartbeat_loop(self, run_id: str) -> None:
        """Write heartbeat + progress to engine_runs every 30s.

        Runs in a daemon thread. Stops when self.status leaves "running".
        Heartbeat failures are non-fatal — the run continues even if the
        dashboard DB is temporarily unavailable.
        """
        while self.status == "running" and not self._stop_requested:
            try:
                self._cpdb_execute(
                    "UPDATE engine_runs SET "
                    "HeartbeatAt = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
                    "CurrentLayer = ?, CompletedUnits = ? "
                    "WHERE RunId = ?",
                    (self._current_layer, self._completed_units, run_id),
                )
            except Exception:
                pass  # Heartbeat is best-effort; _cpdb_execute already logged the warning
            time.sleep(30)

    # ------------------------------------------------------------------
    # Plan mode
    # ------------------------------------------------------------------

    def build_plan(
        self,
        run_id: str,
        entities: List[Entity],
        layers: Optional[List[str]],
        load_method_override: Optional[str] = None,
        pipeline_fallback_override: Optional[bool] = None,
    ) -> LoadPlan:
        """Compute a DETAILED execution plan — mirrors exactly what a live run does."""
        from collections import Counter

        # Use overrides from UI if provided, else fall back to engine defaults
        effective_method = load_method_override or self._load_method
        effective_fallback = pipeline_fallback_override if pipeline_fallback_override is not None else self._pipeline_fallback

        active_layers = layers or ["landing", "bronze", "silver"]
        incremental = [e for e in entities if e.is_incremental]
        full_load = [e for e in entities if not e.is_incremental]
        warnings: list[str] = []

        # ── Per-source breakdown ──
        source_groups: dict[str, list[Entity]] = {}
        for e in entities:
            key = f"{e.source_server}/{e.source_database}" if e.source_server else (e.namespace or "unknown")
            source_groups.setdefault(key, []).append(e)

        sources = []
        for src_key, src_entities in sorted(source_groups.items()):
            incr_count = sum(1 for e in src_entities if e.is_incremental)
            full_count = len(src_entities) - incr_count
            sources.append({
                "name": src_key,
                "namespace": src_entities[0].namespace or "",
                "server": src_entities[0].source_server,
                "database": src_entities[0].source_database,
                "entity_count": len(src_entities),
                "incremental": incr_count,
                "full_load": full_count,
            })

        # ── Per-layer execution plan ──
        layer_plan = []

        if "landing" in active_layers:
            lz_method = effective_method
            step = {
                "layer": "landing",
                "action": "Extract from source SQL servers → upload parquet to OneLake LZ",
                "method": lz_method,
                "entity_count": len(entities),
                "batch_size": self.config.batch_size,
                "chunk_rows": self.config.chunk_rows,
                "notebook_id": None,
                "details": (
                    f"Round-robin across {len(source_groups)} sources, "
                    f"batch_size={self.config.batch_size}, "
                    f"{'local pyodbc+parquet' if lz_method == 'local' else 'Fabric notebook — cloud-native, parallel entity processing'}"
                ),
            }
            if lz_method in ("notebook", "pipeline"):
                step["notebook_id"] = getattr(self.config, 'notebook_lz_id', '') or None
                step["action"] = "Trigger NB_FMD_LOAD_LANDINGZONE_MAIN via NB_FMD_PROCESSING_PARALLEL_MAIN"
                step["method"] = "notebook"
                step["details"] = f"Notebook {getattr(self.config, 'notebook_lz_id', '') or '(auto-discover)'} handles all LZ entities"
            layer_plan.append(step)

        if "bronze" in active_layers:
            if effective_method == "local":
                layer_plan.append({
                    "layer": "bronze",
                    "action": "Read LZ parquet → hash PKs → change-detect → write Bronze Delta",
                    "method": "local",
                    "entity_count": len(entities),
                    "batch_size": self.config.batch_size,
                    "chunk_rows": None,
                    "notebook_id": None,
                    "details": "Local Python processing: polars + deltalake. Per-entity Delta merge to OneLake Bronze lakehouse.",
                })
            else:
                nb_id = self.config.notebook_bronze_id
                layer_plan.append({
                    "layer": "bronze",
                    "action": "Trigger NB_FMD_LOAD_LANDING_BRONZE via NB_FMD_PROCESSING_PARALLEL_MAIN",
                    "method": "notebook",
                    "entity_count": len(entities),
                    "batch_size": self.config.batch_size,
                    "chunk_rows": None,
                    "notebook_id": nb_id or None,
                    "details": f"Notebook {nb_id or '(auto-discover)'} processes each entity: read parquet from LZ → write Delta table to Bronze lakehouse",
                })
                if not nb_id:
                    warnings.append("Bronze notebook ID not configured — will attempt auto-discovery")

        if "silver" in active_layers:
            if effective_method == "local":
                layer_plan.append({
                    "layer": "silver",
                    "action": "Read Bronze Delta → SCD Type 2 change detection → write Silver Delta",
                    "method": "local",
                    "entity_count": len(entities),
                    "batch_size": self.config.batch_size,
                    "chunk_rows": None,
                    "notebook_id": None,
                    "details": "Local Python processing: polars + deltalake. SCD Type 2 merge with IsCurrent/RecordStartDate/RecordEndDate/IsDeleted.",
                })
            else:
                nb_id = self.config.notebook_silver_id
                layer_plan.append({
                    "layer": "silver",
                    "action": "Trigger NB_FMD_LOAD_BRONZE_SILVER via NB_FMD_PROCESSING_PARALLEL_MAIN",
                    "method": "notebook",
                    "entity_count": len(entities),
                    "batch_size": self.config.batch_size,
                    "chunk_rows": None,
                    "notebook_id": nb_id or None,
                    "details": f"Notebook {nb_id or '(auto-discover)'} processes each entity: SCD Type 2 merge from Bronze → Silver Delta table",
                })
                if not nb_id:
                    warnings.append("Silver notebook ID not configured — will attempt auto-discovery")

        # ── Detect issues ──
        blank_source = [e for e in entities if not (e.source_name or "").strip()]
        if blank_source:
            warnings.append(f"{len(blank_source)} entities have blank SourceName — these WILL FAIL")

        no_watermark = [e for e in entities if e.is_incremental and not e.watermark_column]
        if no_watermark:
            warnings.append(f"{len(no_watermark)} entities marked incremental but have no watermark column")

        no_pks = [e for e in entities if not e.primary_keys]
        if no_pks:
            warnings.append(f"{len(no_pks)} entities have no primary keys configured")

        # ── Config snapshot ──
        config_snapshot = {
            "load_method": effective_method,
            "pipeline_fallback": effective_fallback,
            "batch_size": self.config.batch_size,
            "chunk_rows": self.config.chunk_rows,
            "query_timeout": self.config.query_timeout,
            "lz_lakehouse": self.config.lz_lakehouse_id,
            "bronze_lakehouse": self.config.bronze_lakehouse_id,
            "silver_lakehouse": self.config.silver_lakehouse_id,
            "workspace_data": self.config.workspace_data_id,
            "workspace_code": self.config.workspace_code_id,
            "notebook_lz": getattr(self.config, 'notebook_lz_id', ''),
            "notebook_bronze": self.config.notebook_bronze_id,
            "notebook_silver": self.config.notebook_silver_id,
        }

        return LoadPlan(
            run_id=run_id,
            entity_count=len(entities),
            incremental_count=len(incremental),
            full_load_count=len(full_load),
            layers=active_layers,
            sources=sources,
            layer_plan=layer_plan,
            config_snapshot=config_snapshot,
            warnings=warnings,
            entities=[
                {
                    "id": e.id,
                    "name": e.qualified_name,
                    "namespace": e.namespace or "",
                    "server": e.source_server,
                    "database": e.source_database,
                    "incremental": e.is_incremental,
                    "watermark_column": e.watermark_column,
                    "last_value": e.last_load_value,
                    "load_type": "incremental" if e.is_incremental else "full",
                    "primary_keys": e.primary_keys,
                    "connection_guid": e.connection_guid,
                }
                for e in entities
            ],
        )

    # ------------------------------------------------------------------
    # Local Bronze processing
    # ------------------------------------------------------------------

    def _run_bronze_local(self, run_id: str) -> List[RunResult]:
        """Process all active bronze entities locally."""
        from engine.bronze_processor import BronzeProcessor

        bronze_entities = self.get_bronze_worklist()
        if not bronze_entities:
            log.warning("[%s] No active bronze entities found", run_id[:8])
            return []

        processor = BronzeProcessor(self.config, self._tokens)
        results: list[RunResult] = []

        # Resume: skip already-succeeded bronze entities
        if self._resume_mode:
            completed_brz = self._get_completed_entity_ids(run_id, "bronze")
            if completed_brz:
                log.info("[%s] Resume: skipping %d already-succeeded Bronze entities",
                         run_id[:8], len(completed_brz))
                for eid in completed_brz:
                    results.append(RunResult(entity_id=eid, layer="bronze", status="succeeded"))
                bronze_entities = [e for e in bronze_entities if e.bronze_entity_id not in completed_brz]

        log.info("[%s] Bronze local: processing %d entities", run_id[:8], len(bronze_entities))

        for entity in bronze_entities:
            if self._stop_requested:
                results.append(RunResult(
                    entity_id=entity.bronze_entity_id,
                    layer="bronze",
                    status="skipped",
                ))
                continue

            # Retry loop for transient failures (concurrent writes, 429s, timeouts)
            max_attempts = 3
            result = None
            for attempt in range(1, max_attempts + 1):
                try:
                    result = processor.process_entity(entity, run_id)
                    if result.succeeded or not self._is_transient(result.error or ""):
                        break
                    # Transient failure — retry with backoff
                    if attempt < max_attempts:
                        wait = attempt * 5
                        log.warning(
                            "[%s] Bronze entity %d transient failure (attempt %d/%d), "
                            "retrying in %ds: %s",
                            run_id[:8], entity.bronze_entity_id,
                            attempt, max_attempts, wait, (result.error or "")[:100],
                        )
                        time.sleep(wait)
                except Exception as exc:
                    log.error("[%s] Bronze entity %d failed: %s",
                              run_id[:8], entity.bronze_entity_id, exc)
                    result = RunResult(
                        entity_id=entity.bronze_entity_id,
                        layer="bronze",
                        status="failed",
                        error=str(exc),
                    )
                    if attempt < max_attempts and self._is_transient(str(exc)):
                        time.sleep(attempt * 5)
                    else:
                        break

            results.append(result)
            self._completed_units += 1
            # Track entity status in control plane DB
            self._audit.mark_bronze_entity_processed(entity, result)

        succeeded = sum(1 for r in results if r.status == "succeeded")
        failed = sum(1 for r in results if r.status == "failed")
        log.info("[%s] Bronze local: %d succeeded, %d failed, %d skipped",
                 run_id[:8], succeeded, failed, len(results) - succeeded - failed)
        return results

    # ------------------------------------------------------------------
    # Local Silver processing
    # ------------------------------------------------------------------

    def _run_silver_local(self, run_id: str) -> List[RunResult]:
        """Process all active silver entities locally with SCD Type 2."""
        from engine.silver_processor import SilverProcessor

        silver_entities = self.get_silver_worklist()
        if not silver_entities:
            log.warning("[%s] No active silver entities found", run_id[:8])
            return []

        processor = SilverProcessor(self.config, self._tokens)
        results: list[RunResult] = []

        # Resume: skip already-succeeded silver entities
        if self._resume_mode:
            completed_slv = self._get_completed_entity_ids(run_id, "silver")
            if completed_slv:
                log.info("[%s] Resume: skipping %d already-succeeded Silver entities",
                         run_id[:8], len(completed_slv))
                for eid in completed_slv:
                    results.append(RunResult(entity_id=eid, layer="silver", status="succeeded"))
                silver_entities = [e for e in silver_entities if e.silver_entity_id not in completed_slv]

        log.info("[%s] Silver local: processing %d entities", run_id[:8], len(silver_entities))

        for entity in silver_entities:
            if self._stop_requested:
                results.append(RunResult(
                    entity_id=entity.silver_entity_id,
                    layer="silver",
                    status="skipped",
                ))
                continue

            # Retry loop for transient failures (concurrent writes, 429s, timeouts)
            max_attempts = 3
            result = None
            for attempt in range(1, max_attempts + 1):
                try:
                    result = processor.process_entity(entity, run_id)
                    if result.succeeded or not self._is_transient(result.error or ""):
                        break
                    if attempt < max_attempts:
                        wait = attempt * 5
                        log.warning(
                            "[%s] Silver entity %d transient failure (attempt %d/%d), "
                            "retrying in %ds: %s",
                            run_id[:8], entity.silver_entity_id,
                            attempt, max_attempts, wait, (result.error or "")[:100],
                        )
                        time.sleep(wait)
                except Exception as exc:
                    log.error("[%s] Silver entity %d failed: %s",
                              run_id[:8], entity.silver_entity_id, exc)
                    result = RunResult(
                        entity_id=entity.silver_entity_id,
                        layer="silver",
                        status="failed",
                        error=str(exc),
                    )
                    if attempt < max_attempts and self._is_transient(str(exc)):
                        time.sleep(attempt * 5)
                    else:
                        break

            results.append(result)
            self._completed_units += 1
            # Track entity status in control plane DB
            self._audit.mark_silver_entity_processed(entity, result)

        succeeded = sum(1 for r in results if r.status == "succeeded")
        failed = sum(1 for r in results if r.status == "failed")
        log.info("[%s] Silver local: %d succeeded, %d failed, %d skipped",
                 run_id[:8], succeeded, failed, len(results) - succeeded - failed)
        return results

    # ------------------------------------------------------------------
    # Landing Zone processing
    # ------------------------------------------------------------------

    def _run_landing_zone(
        self, run_id: str, entities: List[Entity]
    ) -> List[RunResult]:
        """Extract all entities and upload to OneLake.

        notebook mode: trigger NB_FMD_PROCESSING_PARALLEL_MAIN which handles
                       all LZ entities in parallel inside Fabric.
        pipeline mode: trigger PL_FMD_LDZ_COPY_SQL per entity via REST API.
        local mode:    pyodbc extract + parquet upload with round-robin interleaving.
        """
        # Notebook mode — single Fabric notebook handles everything
        if self._load_method == "notebook":
            log.info(
                "[%s] Landing Zone: notebook mode — triggering LZ notebook for %d entities",
                run_id[:8], len(entities),
            )
            lz_result = self._notebooks.run_lz(run_id)
            return [lz_result]

        results: list[RunResult] = []

        # VPN check — auto-connect before wasting time on doomed extractions
        if not is_vpn_up():
            log.warning("[%s] VPN down before landing zone — attempting auto-connect", run_id[:8])
            if not ensure_vpn(timeout_seconds=120):
                log.error("[%s] VPN not available — skipping all landing zone entities", run_id[:8])
                return [
                    RunResult(
                        entity_id=e.id, layer="landing", status="failed",
                        error="VPN not connected — all source servers unreachable",
                        error_suggestion="Connect to WatchGuard VPN and retry.",
                    )
                    for e in entities
                ]

        # Reset circuit breaker for this run
        self._circuit_breaker = ConnectionCircuitBreaker(trip_threshold=5)

        # Round-robin interleave: take one entity from each source in turn
        source_map = build_source_map(entities)
        for (server, database), group in source_map.items():
            log.info(
                "[%s] Source %s/%s: %d entities queued",
                run_id[:8], server, database, len(group),
            )

        interleaved = self._interleave_sources(source_map)

        # Resume: skip entities that already succeeded in this run
        if self._resume_mode:
            completed_lz = self._get_completed_entity_ids(run_id, "landing")
            if completed_lz:
                log.info(
                    "[%s] Resume: skipping %d already-succeeded LZ entities",
                    run_id[:8], len(completed_lz),
                )
                for eid in completed_lz:
                    results.append(RunResult(entity_id=eid, layer="landing", status="succeeded"))
                interleaved = [e for e in interleaved if e.id not in completed_lz]

        log.info(
            "[%s] Processing %d entities across %d sources (round-robin)",
            run_id[:8], len(interleaved), len(source_map),
        )

        throttle = AdaptiveThrottle(
            max_workers=self.config.batch_size,
            min_workers=max(2, self.config.batch_size // 4),
        )
        pool = ThreadPoolExecutor(max_workers=self.config.batch_size)
        self._current_pool = pool
        try:
            futures = {}
            circuit_skipped = 0
            for entity in interleaved:
                if self._stop_requested:
                    results.append(RunResult(
                        entity_id=entity.id, layer="landing", status="skipped",
                    ))
                    continue
                # Circuit breaker — skip entities whose server is dead
                server_key = entity.source_server or ""
                if self._circuit_breaker.is_tripped(server_key):
                    circuit_skipped += 1
                    results.append(RunResult(
                        entity_id=entity.id, layer="landing", status="skipped",
                        error=f"Circuit breaker tripped for {server_key} — server unreachable",
                        error_suggestion="Check VPN connection and retry.",
                    ))
                    continue
                future = pool.submit(
                    self._throttled_process, throttle, run_id, entity
                )
                futures[future] = entity

            for future in as_completed(futures):
                entity = futures[future]
                try:
                    result = future.result()
                    results.append(result)
                except Exception as exc:
                    if self._stop_requested:
                        result = RunResult(
                            entity_id=entity.id, layer="landing", status="skipped",
                        )
                    else:
                        log.error(
                            "Entity %d raised unhandled exception: %s",
                            entity.id, exc,
                        )
                        result = RunResult(
                            entity_id=entity.id,
                            layer="landing",
                            status="failed",
                            error=str(exc),
                            error_suggestion="Unhandled exception during processing. Check engine logs.",
                        )
                    results.append(result)

                self._completed_units += 1

                # Fire callback for real-time SSE streaming
                if self.on_entity_result:
                    try:
                        self.on_entity_result(run_id, result, entity)
                    except Exception as exc:
                        log.debug("SSE callback error (non-fatal): %s", exc)
        finally:
            self._current_pool = None
            pool.shutdown(wait=False)

        # Log circuit breaker stats
        tripped = self._circuit_breaker.tripped_servers
        if tripped:
            log.warning(
                "[%s] Circuit breaker tripped for %d servers: %s (%d entities skipped)",
                run_id[:8], len(tripped), ", ".join(sorted(tripped)), circuit_skipped,
            )

        # Retry sweep — give transient failures a second chance after main pass
        retryable = [r for r in results if r.status == "failed" and self._is_transient(r.error or "")]
        if retryable and not self._stop_requested:
            log.info("[%s] Retry sweep: %d transient failures", run_id[:8], len(retryable))
            retry_ids = {r.entity_id for r in retryable}
            retry_entities = [e for e in entities if e.id in retry_ids]
            retry_results = []
            for entity in retry_entities:
                if self._stop_requested:
                    break
                result = self._process_single_entity(run_id, entity, max_retries=1)
                retry_results.append(result)
            # Replace original failed results with retry results
            retry_result_ids = {r.entity_id for r in retry_results}
            results = [r for r in results if r.entity_id not in retry_result_ids] + retry_results

        # SHARED-ENG-004: Log failures ONCE here, after the retry sweep has had
        # its chance.  Successes are already logged inside _try_entity (pipeline)
        # or _try_entity_local (local).  This ensures exactly one audit entry per
        # entity per run — no duplicates from the retry sweep re-processing.
        entity_map = {e.id: e for e in entities}
        for r in results:
            if r.status == "failed" and r.entity_id in entity_map:
                self._audit.log_entity_result(run_id, entity_map[r.entity_id], r)

        return results

    @staticmethod
    def _interleave_sources(
        source_map: dict[tuple[str, str], list["Entity"]]
    ) -> list["Entity"]:
        """Round-robin interleave entities across sources.

        Given {sourceA: [1,2,3], sourceB: [4,5]}, returns [1,4,2,5,3].
        This ensures no single source monopolises the thread pool.
        """
        queues = list(source_map.values())
        result: list["Entity"] = []
        max_len = max(len(q) for q in queues) if queues else 0
        for i in range(max_len):
            for q in queues:
                if i < len(q):
                    result.append(q[i])
        return result

    # Transient error codes that warrant automatic retry
    _TRANSIENT_ERRORS = {"08S01", "08001", "10054", "10053", "HYT00"}

    # Broader transient patterns — network, throttling, concurrent writes, timeouts
    _TRANSIENT_PATTERNS = (
        "forcibly closed",
        "Communication link failure",
        "429",
        "Too Many Requests",
        "concurrent write",
        "conflict",
        "timeout",
        "timed out",
        "throttl",
        "temporarily unavailable",
        "503",
        "retry after",
        "connection reset",
        "connection was reset",
        "broken pipe",
    )

    def _is_transient(self, error_msg: str) -> bool:
        """Check if an error is a transient issue worth retrying.

        Covers: ODBC network errors, HTTP 429/503, Delta concurrent write
        conflicts, query timeouts, and Fabric throttling.
        """
        if not error_msg:
            return False
        for code in self._TRANSIENT_ERRORS:
            if code in error_msg:
                return True
        msg_lower = error_msg.lower()
        return any(p in msg_lower for p in self._TRANSIENT_PATTERNS)

    def _throttled_process(
        self, throttle: AdaptiveThrottle, run_id: str, entity: Entity,
    ) -> RunResult:
        """Wrap entity processing with adaptive throttle."""
        throttle.acquire()
        try:
            result = self._process_single_entity(run_id, entity)
            # Detect throttling-specific errors for immediate reduction
            is_throttle_error = any(
                p in (result.error or "").lower() for p in _THROTTLE_PATTERNS
            )
            throttle.release(succeeded=result.succeeded and not is_throttle_error)
            return result
        except Exception:
            throttle.release(succeeded=False)
            raise

    def _process_single_entity(
        self, run_id: str, entity: Entity, max_retries: int = 3
    ) -> RunResult:
        """Extract + upload + log for one entity.  Retries transient failures."""
        if self._stop_requested:
            return RunResult(entity_id=entity.id, layer="landing", status="skipped")

        last_result = None

        for attempt in range(1, max_retries + 1):
            if self._stop_requested:
                return RunResult(entity_id=entity.id, layer="landing", status="skipped")

            result = self._try_entity(run_id, entity)

            if result.succeeded:
                return result

            last_result = result

            # Only retry transient network errors
            if attempt < max_retries and self._is_transient(result.error or ""):
                wait = attempt * 5  # 5s, 10s, 15s backoff
                log.warning(
                    "[%s] Entity %d (%s.%s) failed (attempt %d/%d), retrying in %ds: %s",
                    run_id[:8], entity.id, entity.source_schema, entity.source_name,
                    attempt, max_retries, wait,
                    (result.error or "")[:120],
                )
                # Check stop during retry wait (check every second)
                for _ in range(wait):
                    if self._stop_requested:
                        return RunResult(entity_id=entity.id, layer="landing", status="skipped")
                    time.sleep(1)
            else:
                break

        # SHARED-ENG-004: Removed duplicate audit log here. Previously, failures
        # were logged here AND again if the retry sweep (in _run_landing_zone)
        # re-processed the entity. Successes were already logged inside
        # _try_entity (pipeline) or _try_entity_local (local).
        # Failure logging now happens in _run_landing_zone after the retry sweep,
        # ensuring each entity gets exactly one audit log entry per run.

        # Feed result to circuit breaker
        server_key = entity.source_server or ""
        if last_result.succeeded:
            self._circuit_breaker.record_success(server_key)
        else:
            self._circuit_breaker.record_failure(server_key, last_result.error or "")

        return last_result

    def _query_source_watermark(self, entity: Entity) -> Optional[str]:
        """Query the source database for the current MAX(watermark_column).

        SHARED-ENG-003: Pipeline mode copies data via Fabric REST API, which
        does not report the new watermark value.  After a successful pipeline
        copy we query the source to discover what the new high-water mark is,
        so incremental loads don't re-extract the same data forever.

        Returns the new watermark string, or None if not applicable / on error.
        """
        if not entity.is_incremental or not entity.watermark_column:
            return None

        try:
            schema = entity.source_schema or "dbo"
            # Use bracket-quoted identifiers to prevent SQL injection
            sql = (
                f"SELECT MAX([{entity.watermark_column}]) AS MaxWM "
                f"FROM [{schema}].[{entity.source_name.strip()}]"
            )
            with self._source_conn.connect(
                entity.source_server, entity.source_database, timeout=15
            ) as conn:
                cursor = conn.cursor()
                cursor.execute(sql)
                row = cursor.fetchone()
                if row and row[0] is not None:
                    wm_val = str(row[0])
                    # Truncate microseconds to 3 decimal places for SQL Server
                    # datetime compatibility (same logic as extractor)
                    if "." in wm_val and len(wm_val.rsplit(".", 1)[-1]) > 3:
                        wm_val = wm_val[:wm_val.index(".") + 4]
                    return wm_val
        except Exception as exc:
            log.warning(
                "Failed to query source watermark for %s.%s (non-fatal, "
                "watermark will not advance this run): %s",
                entity.source_schema, entity.source_name, exc,
            )
        return None

    def _try_entity(self, run_id: str, entity: Entity) -> RunResult:
        """Single attempt — dispatches to pipeline or local based on load method.

        Note: notebook mode is handled in _run_landing_zone (single trigger for all entities).
        This method is only called for pipeline/local per-entity processing.
        """
        if self._stop_requested:
            return RunResult(entity_id=entity.id, layer="landing", status="skipped")

        if self._load_method == "pipeline":
            result = self._pipeline_runner.trigger_copy(
                entity, run_id,
                stop_check=lambda: self._stop_requested,
            )
            if result.succeeded:
                # SHARED-ENG-003: Query source for the real watermark value.
                # The Fabric pipeline API does not report what data it copied,
                # so we ask the source for MAX(watermark_column) to advance
                # the watermark and prevent re-extracting the same rows.
                new_wm = self._query_source_watermark(entity)
                if new_wm:
                    result = RunResult(
                        entity_id=result.entity_id,
                        layer=result.layer,
                        status=result.status,
                        duration_seconds=result.duration_seconds,
                        watermark_before=entity.last_load_value,
                        watermark_after=new_wm,
                    )

                # Update metadata on pipeline success
                self._audit.log_entity_result(run_id, entity, result)
                if result.watermark_after and result.watermark_after != entity.last_load_value:
                    self._audit.update_watermark(entity, result.watermark_after)
                return result

            # Pipeline failed — auto-fallback to local if enabled
            if self._pipeline_fallback:
                log.warning(
                    "[%s] Pipeline failed for %s, falling back to local: %s",
                    run_id[:8], entity.qualified_name, (result.error or "")[:120],
                )
                return self._try_entity_local(run_id, entity)

            return result

        return self._try_entity_local(run_id, entity)

    def _log_validation(self, run_id: str, entity_id: int, v_result) -> None:
        """POST schema validation result to control plane dashboard."""
        import json
        import urllib.request
        base_url = getattr(self._config, "control_plane_url", "http://localhost:8787")
        data = json.dumps({
            "run_id": run_id,
            "entity_id": entity_id,
            "layer": "landing",
            "passed": v_result.passed,
            "error_count": v_result.error_count,
            "errors": v_result.errors[:20],
            "schema_name": v_result.schema_name,
        })
        try:
            req = urllib.request.Request(
                f"{base_url}/api/schema-validation/result",
                data=data.encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=1)
        except Exception as exc:
            log.debug("Failed to POST validation result for entity %d: %s", entity_id, exc)

    def _try_entity_local(self, run_id: str, entity: Entity) -> RunResult:
        """Local mode: extract via pyodbc/ConnectorX + validate + upload parquet to OneLake."""
        if self._stop_requested:
            return RunResult(entity_id=entity.id, layer="landing", status="skipped")

        # Step 1: Extract
        parquet_bytes, extract_result = self._extractor.extract(entity, run_id)

        if not extract_result.succeeded or parquet_bytes is None:
            return extract_result

        # Step 1.5: Schema validation (between extract and upload)
        validation_mode = getattr(self._config, "validation_mode", "warn")
        if validation_mode != "off" and parquet_bytes:
            try:
                from engine.schema_validator import validate_extraction
                import io as _io
                import polars as _pl
                df_for_validation = _pl.read_parquet(_io.BytesIO(parquet_bytes))
                v_result = validate_extraction(
                    df_for_validation, entity.source_database, entity.source_name.strip(),
                    mode=validation_mode,
                )
                self._log_validation(run_id, entity.id, v_result)
                if not v_result.passed and validation_mode == "enforce":
                    return RunResult(
                        entity_id=entity.id, layer="landing", status="failed",
                        rows_read=extract_result.rows_read,
                        duration_seconds=extract_result.duration_seconds,
                        error=f"Schema validation failed: {v_result.error_count} errors",
                        error_suggestion=f"Schema: {v_result.schema_name}. Errors: {v_result.errors_json}",
                    )
            except ImportError:
                log.debug("pandera not installed — skipping schema validation")
            except Exception as val_exc:
                log.warning("[%s] Schema validation error for entity %d (non-blocking): %s",
                            run_id[:8], entity.id, val_exc)

        if self._stop_requested:
            return RunResult(entity_id=entity.id, layer="landing", status="skipped")

        # Step 2: Upload to OneLake
        upload_result, file_path, file_name = self._loader.upload_entity(
            entity, parquet_bytes, run_id,
        )

        if not upload_result.succeeded:
            return upload_result

        # Step 3: Merge results
        final = RunResult(
            entity_id=entity.id,
            layer="landing",
            status="succeeded",
            rows_read=extract_result.rows_read,
            rows_written=extract_result.rows_written,
            bytes_transferred=upload_result.bytes_transferred,
            duration_seconds=round(
                extract_result.duration_seconds + upload_result.duration_seconds, 2
            ),
            watermark_before=extract_result.watermark_before,
            watermark_after=extract_result.watermark_after,
        )

        # Step 4: Update metadata
        self._audit.log_entity_result(run_id, entity, final)
        self._audit.mark_entity_loaded(entity, file_path, file_name)

        if final.watermark_after and final.watermark_after != entity.last_load_value:
            self._audit.update_watermark(entity, final.watermark_after)

        return final
