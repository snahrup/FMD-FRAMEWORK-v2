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
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional

from engine.auth import TokenProvider
from engine.connections import MetadataDB, SourceConnection, build_source_map
from engine.extractor import DataExtractor
from engine.loader import OneLakeLoader
from engine.logging_db import AuditLogger
from engine.models import EngineConfig, Entity, RunResult, LoadPlan
from engine.notebook_trigger import NotebookTrigger
from engine.pipeline_runner import FabricPipelineRunner
from engine.preflight import PreflightChecker, PreflightReport

log = logging.getLogger("fmd.orchestrator")


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

        # Build the dependency graph — one instance of each module
        self._tokens = TokenProvider(config)
        self._metadata_db = MetadataDB(config, self._tokens)
        self._source_conn = SourceConnection(config)
        self._extractor = DataExtractor(config, self._source_conn)
        self._loader = OneLakeLoader(config, self._tokens)
        self._audit = AuditLogger(self._metadata_db)
        self._notebooks = NotebookTrigger(config, self._tokens)
        self._pipeline_runner = FabricPipelineRunner(config, self._tokens)
        self._load_method = config.load_method          # "local" | "pipeline"
        self._pipeline_fallback = config.pipeline_fallback

        # Auto-discover notebook IDs if not hardcoded in config
        if not config.notebook_bronze_id or not config.notebook_silver_id:
            self._auto_discover_notebooks()

    def _auto_discover_notebooks(self) -> None:
        """Discover notebook IDs from the Fabric REST API if not in config.

        Queries GET /v1/workspaces/{ws}/items?type=Notebook and matches
        known display names (NB_FMD_LOAD_LANDING_BRONZE, NB_FMD_LOAD_BRONZE_SILVER)
        to their Fabric item IDs.  Updates config in place.
        """
        try:
            discovered = self._notebooks.discover_notebook_ids()
            if discovered.get("bronze") and not self.config.notebook_bronze_id:
                self.config.notebook_bronze_id = discovered["bronze"]
                log.info("Auto-discovered Bronze notebook ID: %s", discovered["bronze"])
            if discovered.get("silver") and not self.config.notebook_silver_id:
                self.config.notebook_silver_id = discovered["silver"]
                log.info("Auto-discovered Silver notebook ID: %s", discovered["silver"])
        except Exception as exc:
            log.warning(
                "Notebook auto-discovery failed (Bronze/Silver will be skipped): %s", exc
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
    ) -> list | LoadPlan:
        """Main entry point.  Called by the REST API.

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
            Who kicked this off — 'dashboard', 'schedule', 'manual'.
        load_method : optional
            Override config load_method: 'local' or 'pipeline'.
        pipeline_fallback : optional
            Override config pipeline_fallback.

        Returns
        -------
        list[RunResult] | LoadPlan
            Results (run mode) or plan (plan mode).
        """
        self.status = "running"
        self._stop_requested = False
        run_id = str(uuid.uuid4())
        self.current_run_id = run_id

        # Per-run overrides for load method
        if load_method is not None:
            self._load_method = load_method
        if pipeline_fallback is not None:
            self._pipeline_fallback = pipeline_fallback

        effective_method = self._load_method
        log.info("Load method: %s (fallback=%s)", effective_method, self._pipeline_fallback)

        try:
            entities = self.get_worklist(entity_ids)
            self._audit.log_run_start(run_id, mode, len(entities), layers, triggered_by)

            if mode == "plan":
                plan = self.build_plan(run_id, entities, layers)
                self.status = "idle"
                return plan

            results: list[RunResult] = []

            # Landing Zone — extract from source, upload Parquet to OneLake
            if not layers or "landing" in layers:
                lz_results = self._run_landing_zone(run_id, entities)
                results.extend(lz_results)

            # Bronze — trigger Fabric notebook
            if not layers or "bronze" in layers:
                bronze_result = self._notebooks.run_bronze(run_id)
                results.append(bronze_result)

            # Silver — trigger Fabric notebook
            if not layers or "silver" in layers:
                silver_result = self._notebooks.run_silver(run_id)
                results.append(silver_result)

            self._audit.log_run_end(run_id, results)
            self.status = "idle"
            return results

        except Exception as exc:
            self._audit.log_run_error(run_id, exc)
            self.status = "error"
            raise

        finally:
            self.current_run_id = None

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
            self._metadata_db,
            self._source_conn,
            self._loader,
        )
        return checker.run(entities)

    # ------------------------------------------------------------------
    # Worklist
    # ------------------------------------------------------------------

    def get_worklist(self, entity_ids: Optional[List[int]] = None) -> List[Entity]:
        """Fetch active entities from the metadata DB.

        Reads from execution.vw_LoadSourceToLandingzone — the same view
        the old Fabric pipelines used, so the worklist is identical.
        """
        sql = """
            SELECT
                le.LandingzoneEntityId,
                le.SourceName,
                le.SourceSchema,
                c.ServerName AS SourceServer,
                c.DatabaseName AS SourceDatabase,
                le.DataSourceId,
                c.Type AS ConnectionType,
                lh.WorkspaceGuid,
                lh.LakehouseGuid,
                le.IsIncremental,
                le.IsIncrementalColumn AS WatermarkColumn,
                llv.LoadValue AS LastLoadValue,
                ble.PrimaryKeys,
                le.IsActive,
                COALESCE(NULLIF(ds.Namespace, ''), ds.Name) AS Namespace,
                c.ConnectionGuid
            FROM integration.LandingzoneEntity le
            INNER JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
            INNER JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
            INNER JOIN integration.Lakehouse lh ON le.LakehouseId = lh.LakehouseId
            LEFT JOIN execution.LandingzoneEntityLastLoadValue llv
                ON le.LandingzoneEntityId = llv.LandingzoneEntityId
            LEFT JOIN integration.BronzeLayerEntity ble
                ON le.LandingzoneEntityId = ble.LandingzoneEntityId
            WHERE le.IsActive = 1
        """

        if entity_ids:
            id_list = ",".join(str(i) for i in entity_ids)
            sql += f" AND le.LandingzoneEntityId IN ({id_list})"

        rows = self._metadata_db.query(sql)

        entities: list[Entity] = []
        for row in rows:
            source_name = str(row.get("SourceName", "") or "").strip()
            if not source_name:
                log.warning(
                    "Skipping entity %s — blank SourceName",
                    row.get("LandingzoneEntityId"),
                )
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

        log.info("Worklist: %d entities from metadata DB", len(entities))
        return entities

    # ------------------------------------------------------------------
    # Plan mode
    # ------------------------------------------------------------------

    def build_plan(
        self,
        run_id: str,
        entities: List[Entity],
        layers: Optional[List[str]],
    ) -> LoadPlan:
        """Compute what would happen without executing anything."""
        active_layers = layers or ["landing", "bronze", "silver"]
        incremental = [e for e in entities if e.is_incremental]
        full_load = [e for e in entities if not e.is_incremental]

        return LoadPlan(
            run_id=run_id,
            entity_count=len(entities),
            incremental_count=len(incremental),
            full_load_count=len(full_load),
            layers=active_layers,
            entities=[
                {
                    "id": e.id,
                    "name": e.qualified_name,
                    "server": e.source_server,
                    "database": e.source_database,
                    "incremental": e.is_incremental,
                    "watermark_column": e.watermark_column,
                    "last_value": e.last_load_value,
                }
                for e in entities
            ],
        )

    # ------------------------------------------------------------------
    # Landing Zone processing
    # ------------------------------------------------------------------

    def _run_landing_zone(
        self, run_id: str, entities: List[Entity]
    ) -> List[RunResult]:
        """Extract all entities and upload to OneLake with round-robin source interleaving.

        Instead of processing all entities from one source before moving to the next
        (which lets a slow/broken source block everything), this interleaves entities
        across sources so all sources get fair throughput in the shared thread pool.
        """
        results: list[RunResult] = []

        # Round-robin interleave: take one entity from each source in turn
        source_map = build_source_map(entities)
        for (server, database), group in source_map.items():
            log.info(
                "[%s] Source %s/%s: %d entities queued",
                run_id[:8], server, database, len(group),
            )

        interleaved = self._interleave_sources(source_map)
        log.info(
            "[%s] Processing %d entities across %d sources (round-robin)",
            run_id[:8], len(interleaved), len(source_map),
        )

        pool = ThreadPoolExecutor(max_workers=self.config.batch_size)
        self._current_pool = pool
        try:
            futures = {}
            for entity in interleaved:
                if self._stop_requested:
                    results.append(RunResult(
                        entity_id=entity.id, layer="landing", status="skipped",
                    ))
                    continue
                future = pool.submit(
                    self._process_single_entity, run_id, entity
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

                # Fire callback for real-time SSE streaming
                if self.on_entity_result:
                    try:
                        self.on_entity_result(run_id, result, entity)
                    except Exception:
                        pass  # Never let callback crash the engine
        finally:
            self._current_pool = None
            pool.shutdown(wait=False)

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

    def _is_transient(self, error_msg: str) -> bool:
        """Check if an error is a transient network issue worth retrying."""
        if not error_msg:
            return False
        for code in self._TRANSIENT_ERRORS:
            if code in error_msg:
                return True
        return "forcibly closed" in error_msg or "Communication link failure" in error_msg

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

        # All retries exhausted or non-transient error
        self._audit.log_entity_result(run_id, entity, last_result)
        return last_result

    def _try_entity(self, run_id: str, entity: Entity) -> RunResult:
        """Single attempt — dispatches to pipeline or local based on load method."""
        if self._stop_requested:
            return RunResult(entity_id=entity.id, layer="landing", status="skipped")

        if self._load_method == "pipeline":
            result = self._pipeline_runner.trigger_copy(
                entity, run_id,
                stop_check=lambda: self._stop_requested,
            )
            if result.succeeded:
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

    def _try_entity_local(self, run_id: str, entity: Entity) -> RunResult:
        """Local mode: extract via pyodbc + upload parquet to OneLake."""
        if self._stop_requested:
            return RunResult(entity_id=entity.id, layer="landing", status="skipped")

        # Step 1: Extract
        parquet_bytes, extract_result = self._extractor.extract(entity, run_id)

        if not extract_result.succeeded or parquet_bytes is None:
            return extract_result

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
