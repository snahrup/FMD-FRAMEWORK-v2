"""
Deploy Entity Digest Engine — Phase 2: Pre-computed Status Summary
==================================================================
Deploys the EntityStatusSummary table, the sp_UpsertEntityStatus proc,
seeds the summary from existing execution data, and refactors
sp_BuildEntityDigest to read from the summary table first (with
fallback to the original 6-table join if the summary is empty).

Phase 2 turns the digest from O(n-join) per request into O(1) reads.
Pipeline notebooks will call sp_UpsertEntityStatus after each entity
load, keeping the summary current without any join overhead.

Safe to run repeatedly (all operations are idempotent).

Usage:
    python scripts/deploy_digest_phase2.py
"""

import sys
import os
import time
import logging

# ── Bootstrap: Add dashboard API to path for shared auth/query helpers ──
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'app', 'api'))
from server import query_sql
execute_sql = query_sql

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('digest-phase2')


def step(n, msg):
    log.info(f'[Step {n}] {msg}')


# ============================================================================
# Step 1: CREATE TABLE execution.EntityStatusSummary
# ============================================================================

def create_status_summary_table():
    step(1, 'Creating execution.EntityStatusSummary table...')

    table_sql = """
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'EntityStatusSummary'
    )
    CREATE TABLE [execution].[EntityStatusSummary] (
        LandingzoneEntityId INT NOT NULL PRIMARY KEY,
        SourceNamespace VARCHAR(100),
        SourceSchema VARCHAR(100),
        SourceName VARCHAR(200),

        -- Connection info (denormalized for fast reads)
        ConnectionName VARCHAR(200),
        ServerName VARCHAR(200),
        DatabaseName VARCHAR(200),

        -- Entity metadata
        IsActive BIT DEFAULT 1,
        IsIncremental BIT DEFAULT 0,
        WatermarkColumn VARCHAR(200),
        BronzeLayerEntityId INT NULL,
        BronzePKs VARCHAR(500),
        SilverLayerEntityId INT NULL,

        -- Per-layer status
        LzStatus VARCHAR(20) DEFAULT 'not_started',
        LzLastLoad DATETIME2 NULL,
        BronzeStatus VARCHAR(20) DEFAULT 'not_started',
        BronzeLastLoad DATETIME2 NULL,
        SilverStatus VARCHAR(20) DEFAULT 'not_started',
        SilverLastLoad DATETIME2 NULL,

        -- Error tracking
        LastErrorMessage NVARCHAR(MAX) NULL,
        LastErrorLayer VARCHAR(20) NULL,
        LastErrorTime DATETIME2 NULL,

        -- Computed
        OverallStatus VARCHAR(20) DEFAULT 'not_started',

        -- Audit
        LastUpdated DATETIME2 DEFAULT GETUTCDATE(),
        LastUpdatedBy VARCHAR(50)
    );
    """

    execute_sql(table_sql)

    # Verify table exists
    check = query_sql("""
        SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'EntityStatusSummary'
    """)
    if check:
        log.info('  EntityStatusSummary table ready')
    else:
        raise RuntimeError('Failed to create EntityStatusSummary table')


# ============================================================================
# Step 2: CREATE PROC execution.sp_UpsertEntityStatus
# ============================================================================

def create_upsert_entity_status_proc():
    step(2, 'Creating execution.sp_UpsertEntityStatus stored procedure...')

    proc_sql = """
    CREATE OR ALTER PROCEDURE [execution].[sp_UpsertEntityStatus]
        @LandingzoneEntityId INT,
        @Layer VARCHAR(20),
        @Status VARCHAR(20),
        @LoadEndDateTime DATETIME2 = NULL,
        @ErrorMessage NVARCHAR(MAX) = NULL,
        @UpdatedBy VARCHAR(50) = 'notebook'
    WITH EXECUTE AS CALLER
    AS
    SET NOCOUNT ON;

    -- Auto-resolve BronzeLayerEntityId -> LandingzoneEntityId
    -- The Silver notebook only has BronzeLayerEntityId, so it passes that value.
    -- If @LandingzoneEntityId doesn't exist in LandingzoneEntity, try resolving
    -- it as a BronzeLayerEntityId.
    IF NOT EXISTS (SELECT 1 FROM integration.LandingzoneEntity WHERE LandingzoneEntityId = @LandingzoneEntityId)
    BEGIN
        DECLARE @resolvedLzId INT;
        SELECT @resolvedLzId = LandingzoneEntityId
        FROM integration.BronzeLayerEntity
        WHERE BronzeLayerEntityId = @LandingzoneEntityId;

        IF @resolvedLzId IS NOT NULL
            SET @LandingzoneEntityId = @resolvedLzId;
    END

    -- If row doesn't exist, seed it from integration tables
    IF NOT EXISTS (SELECT 1 FROM [execution].[EntityStatusSummary] WHERE LandingzoneEntityId = @LandingzoneEntityId)
    BEGIN
        INSERT INTO [execution].[EntityStatusSummary] (
            LandingzoneEntityId, SourceNamespace, SourceSchema, SourceName,
            ConnectionName, ServerName, DatabaseName,
            IsActive, IsIncremental, WatermarkColumn,
            BronzeLayerEntityId, BronzePKs, SilverLayerEntityId,
            LastUpdated, LastUpdatedBy
        )
        SELECT
            le.LandingzoneEntityId, ds.Namespace, le.SourceSchema, le.SourceName,
            c.Name, c.ServerName, c.DatabaseName,
            le.IsActive, le.IsIncremental, le.IsIncrementalColumn,
            be.BronzeLayerEntityId, be.PrimaryKeys, se.SilverLayerEntityId,
            GETUTCDATE(), @UpdatedBy
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        LEFT JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
        LEFT JOIN integration.BronzeLayerEntity be ON le.LandingzoneEntityId = be.LandingzoneEntityId
        LEFT JOIN integration.SilverLayerEntity se ON be.BronzeLayerEntityId = se.BronzeLayerEntityId
        WHERE le.LandingzoneEntityId = @LandingzoneEntityId;
    END

    -- Update the specific layer's status
    IF @Layer = 'landingzone'
    BEGIN
        UPDATE [execution].[EntityStatusSummary]
        SET LzStatus = @Status,
            LzLastLoad = COALESCE(@LoadEndDateTime, GETUTCDATE()),
            LastErrorMessage = CASE WHEN @ErrorMessage IS NOT NULL THEN @ErrorMessage ELSE LastErrorMessage END,
            LastErrorLayer = CASE WHEN @ErrorMessage IS NOT NULL THEN 'Landingzone' ELSE LastErrorLayer END,
            LastErrorTime = CASE WHEN @ErrorMessage IS NOT NULL THEN GETUTCDATE() ELSE LastErrorTime END,
            LastUpdated = GETUTCDATE(),
            LastUpdatedBy = @UpdatedBy
        WHERE LandingzoneEntityId = @LandingzoneEntityId;
    END
    ELSE IF @Layer = 'bronze'
    BEGIN
        UPDATE [execution].[EntityStatusSummary]
        SET BronzeStatus = @Status,
            BronzeLastLoad = COALESCE(@LoadEndDateTime, GETUTCDATE()),
            LastErrorMessage = CASE WHEN @ErrorMessage IS NOT NULL THEN @ErrorMessage ELSE LastErrorMessage END,
            LastErrorLayer = CASE WHEN @ErrorMessage IS NOT NULL THEN 'Bronze' ELSE LastErrorLayer END,
            LastErrorTime = CASE WHEN @ErrorMessage IS NOT NULL THEN GETUTCDATE() ELSE LastErrorTime END,
            LastUpdated = GETUTCDATE(),
            LastUpdatedBy = @UpdatedBy
        WHERE LandingzoneEntityId = @LandingzoneEntityId;
    END
    ELSE IF @Layer = 'silver'
    BEGIN
        UPDATE [execution].[EntityStatusSummary]
        SET SilverStatus = @Status,
            SilverLastLoad = COALESCE(@LoadEndDateTime, GETUTCDATE()),
            LastErrorMessage = CASE WHEN @ErrorMessage IS NOT NULL THEN @ErrorMessage ELSE LastErrorMessage END,
            LastErrorLayer = CASE WHEN @ErrorMessage IS NOT NULL THEN 'Silver' ELSE LastErrorLayer END,
            LastErrorTime = CASE WHEN @ErrorMessage IS NOT NULL THEN GETUTCDATE() ELSE LastErrorTime END,
            LastUpdated = GETUTCDATE(),
            LastUpdatedBy = @UpdatedBy
        WHERE LandingzoneEntityId = @LandingzoneEntityId;
    END

    -- Recompute overall status
    UPDATE [execution].[EntityStatusSummary]
    SET OverallStatus = CASE
        WHEN LzStatus = 'loaded' AND BronzeStatus = 'loaded' AND SilverStatus = 'loaded' THEN 'complete'
        WHEN LastErrorMessage IS NOT NULL AND LastErrorTime > DATEADD(day, -7, GETUTCDATE()) THEN 'error'
        WHEN BronzeStatus = 'pending' OR SilverStatus = 'pending' THEN 'pending'
        WHEN LzStatus = 'loaded' THEN 'partial'
        ELSE 'not_started'
    END
    WHERE LandingzoneEntityId = @LandingzoneEntityId;
    """

    execute_sql(proc_sql)
    log.info('  sp_UpsertEntityStatus created/updated')


# ============================================================================
# Step 3: Seed EntityStatusSummary from existing execution data
# ============================================================================

def seed_status_summary():
    step(3, 'Seeding EntityStatusSummary from existing execution data...')

    # Count rows before seed
    before = query_sql("SELECT COUNT(*) AS cnt FROM [execution].[EntityStatusSummary]")
    before_cnt = int(before[0].get('cnt', 0)) if before else 0
    log.info(f'  Rows before seed: {before_cnt}')

    seed_sql = """
    INSERT INTO [execution].[EntityStatusSummary] (
        LandingzoneEntityId, SourceNamespace, SourceSchema, SourceName,
        ConnectionName, ServerName, DatabaseName,
        IsActive, IsIncremental, WatermarkColumn,
        BronzeLayerEntityId, BronzePKs, SilverLayerEntityId,
        LzStatus, LzLastLoad, BronzeStatus, BronzeLastLoad,
        SilverStatus, SilverLastLoad,
        OverallStatus, LastUpdated, LastUpdatedBy
    )
    SELECT
        le.LandingzoneEntityId,
        ds.Namespace,
        le.SourceSchema,
        le.SourceName,
        c.Name,
        c.ServerName,
        c.DatabaseName,
        le.IsActive,
        le.IsIncremental,
        le.IsIncrementalColumn,
        be.BronzeLayerEntityId,
        be.PrimaryKeys,
        se.SilverLayerEntityId,
        -- LZ status
        CASE WHEN ple.LandingzoneEntityId IS NOT NULL THEN 'loaded' ELSE 'not_started' END,
        ple.lastLzLoad,
        -- Bronze status
        CASE
            WHEN pbe.BronzeLayerEntityId IS NOT NULL THEN 'loaded'
            ELSE 'not_started'
        END,
        pbe.lastBrzLoad,
        -- Silver status
        CASE
            WHEN pse.SilverLayerEntityId IS NOT NULL THEN 'loaded'
            ELSE 'not_started'
        END,
        pse.lastSlvLoad,
        -- Overall
        CASE
            WHEN ple.LandingzoneEntityId IS NOT NULL AND pbe.BronzeLayerEntityId IS NOT NULL AND pse.SilverLayerEntityId IS NOT NULL THEN 'complete'
            WHEN ple.LandingzoneEntityId IS NOT NULL THEN 'partial'
            ELSE 'not_started'
        END,
        GETUTCDATE(),
        'seed'
    FROM integration.LandingzoneEntity le
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    LEFT JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
    LEFT JOIN integration.BronzeLayerEntity be ON le.LandingzoneEntityId = be.LandingzoneEntityId
    LEFT JOIN integration.SilverLayerEntity se ON be.BronzeLayerEntityId = se.BronzeLayerEntityId
    LEFT JOIN (
        SELECT LandingzoneEntityId, MAX(LoadEndDateTime) AS lastLzLoad
        FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 1
        GROUP BY LandingzoneEntityId
    ) ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
    LEFT JOIN (
        SELECT BronzeLayerEntityId, MAX(LoadEndDateTime) AS lastBrzLoad
        FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 1
        GROUP BY BronzeLayerEntityId
    ) pbe ON be.BronzeLayerEntityId = pbe.BronzeLayerEntityId
    LEFT JOIN (
        SELECT SilverLayerEntityId, MAX(LoadEndDateTime) AS lastSlvLoad
        FROM execution.PipelineSilverLayerEntity WHERE IsProcessed = 1
        GROUP BY SilverLayerEntityId
    ) pse ON se.SilverLayerEntityId = pse.SilverLayerEntityId
    WHERE ds.IsActive = 1
    AND le.LandingzoneEntityId NOT IN (SELECT LandingzoneEntityId FROM execution.EntityStatusSummary);
    """

    execute_sql(seed_sql)

    # Count rows after seed
    after = query_sql("SELECT COUNT(*) AS cnt FROM [execution].[EntityStatusSummary]")
    after_cnt = int(after[0].get('cnt', 0)) if after else 0
    inserted = after_cnt - before_cnt
    log.info(f'  Rows after seed: {after_cnt} ({inserted} new rows inserted)')


# ============================================================================
# Step 4: Refactor sp_BuildEntityDigest (summary-first with join fallback)
# ============================================================================

def refactor_digest_proc():
    step(4, 'Refactoring execution.sp_BuildEntityDigest (Phase 2: summary-first)...')

    proc_sql = """
    CREATE OR ALTER PROCEDURE [execution].[sp_BuildEntityDigest]
        @SourceFilter VARCHAR(50) = NULL,
        @LayerFilter VARCHAR(20) = NULL,
        @StatusFilter VARCHAR(20) = NULL
    WITH EXECUTE AS CALLER
    AS
    SET NOCOUNT ON;

    -- ================================================================
    -- Entity Digest Engine — Phase 2
    --
    -- Reads from pre-computed EntityStatusSummary for O(1) performance.
    -- Falls back to the original 6-table join if the summary table is
    -- empty (backward compatibility during rollout).
    -- ================================================================

    -- Check if summary table has data
    DECLARE @summaryCount INT;
    SELECT @summaryCount = COUNT(*) FROM [execution].[EntityStatusSummary];

    IF @summaryCount > 0
    BEGIN
        -- ============================================================
        -- Phase 2: Read from pre-computed summary table (fast path)
        -- ============================================================
        SELECT
            ess.SourceNamespace             AS source,
            ess.DatabaseName                AS dbName,
            ess.ConnectionName              AS connectionName,
            ess.ServerName                  AS serverName,
            ess.DatabaseName                AS databaseName,
            ess.LandingzoneEntityId         AS id,
            ess.SourceSchema                AS sourceSchema,
            ess.SourceName                  AS tableName,
            ess.IsIncremental,
            ess.WatermarkColumn             AS watermarkColumn,
            ess.IsActive,
            ess.BronzeLayerEntityId         AS bronzeId,
            ess.BronzePKs                   AS bronzePKs,
            ess.SilverLayerEntityId         AS silverId,
            ess.LzStatus                    AS lzStatus,
            ess.LzLastLoad                  AS lastLzLoad,
            ess.BronzeStatus                AS bronzeStatus,
            ess.BronzeLastLoad              AS lastBrzLoad,
            ess.SilverStatus                AS silverStatus,
            ess.SilverLastLoad              AS lastSlvLoad,
            ess.LastErrorMessage            AS lastErrorMessage,
            ess.LastErrorLayer              AS lastErrorLayer,
            ess.LastErrorTime               AS lastErrorTime,
            ess.OverallStatus               AS overall
        FROM [execution].[EntityStatusSummary] ess
        WHERE ess.IsActive = 1
            AND (@SourceFilter IS NULL OR ess.SourceNamespace = @SourceFilter)
        ORDER BY ess.SourceNamespace, ess.SourceName;
    END
    ELSE
    BEGIN
        -- ============================================================
        -- Phase 1 fallback: Original 6-table join (backward compat)
        -- ============================================================

        -- Handle optional PipelineSilverLayerEntity table
        CREATE TABLE #SlvProcessed (SilverLayerEntityId INT, lastSlvLoad DATETIME2);
        IF OBJECT_ID('execution.PipelineSilverLayerEntity', 'U') IS NOT NULL
        BEGIN
            INSERT INTO #SlvProcessed
            EXEC sp_executesql N'
                SELECT SilverLayerEntityId, MAX(LoadEndDateTime) AS lastSlvLoad
                FROM execution.PipelineSilverLayerEntity
                WHERE IsProcessed = 1
                GROUP BY SilverLayerEntityId
            ';
        END

        -- Handle optional Silver pending view
        CREATE TABLE #SlvPending (BronzeLayerEntityId INT);
        IF OBJECT_ID('execution.vw_LoadToSilverLayer', 'V') IS NOT NULL
        BEGIN
            INSERT INTO #SlvPending
            EXEC sp_executesql N'SELECT DISTINCT BronzeLayerEntityId FROM execution.vw_LoadToSilverLayer';
        END

        SELECT
            ds.Namespace                        AS source,
            ds.Name                             AS dbName,
            c.Name                              AS connectionName,
            c.ServerName                        AS serverName,
            c.DatabaseName                      AS databaseName,
            le.LandingzoneEntityId              AS id,
            le.SourceSchema                     AS sourceSchema,
            le.SourceName                       AS tableName,
            le.FileName,
            le.IsIncremental,
            le.IsIncrementalColumn              AS watermarkColumn,
            le.IsActive,
            be.BronzeLayerEntityId              AS bronzeId,
            be.PrimaryKeys                      AS bronzePKs,
            be.IsActive                         AS bronzeActive,
            se.SilverLayerEntityId              AS silverId,
            se.IsActive                         AS silverActive,

            -- LZ status
            CASE WHEN ple.LandingzoneEntityId IS NOT NULL THEN 'loaded' ELSE 'not_started' END AS lzStatus,
            ple.lastLzLoad,

            -- Bronze status
            CASE
                WHEN pbe.BronzeLayerEntityId IS NOT NULL THEN 'loaded'
                WHEN bp.BronzeLayerEntityId IS NOT NULL THEN 'pending'
                ELSE 'not_started'
            END AS bronzeStatus,
            pbe.lastBrzLoad,

            -- Silver status
            CASE
                WHEN pse.SilverLayerEntityId IS NOT NULL THEN 'loaded'
                WHEN spp.BronzeLayerEntityId IS NOT NULL THEN 'pending'
                ELSE 'not_started'
            END AS silverStatus,
            pse.lastSlvLoad,

            -- Recent error (last 7 days)
            err.LogData                         AS lastErrorMessage,
            err.EntityLayer                     AS lastErrorLayer,
            err.LogDateTime                     AS lastErrorTime,

            -- Overall status
            CASE
                WHEN ple.LandingzoneEntityId IS NOT NULL
                     AND pbe.BronzeLayerEntityId IS NOT NULL
                     AND pse.SilverLayerEntityId IS NOT NULL
                    THEN 'complete'
                WHEN err.LogData IS NOT NULL THEN 'error'
                WHEN bp.BronzeLayerEntityId IS NOT NULL
                     OR spp.BronzeLayerEntityId IS NOT NULL
                    THEN 'pending'
                WHEN ple.LandingzoneEntityId IS NOT NULL THEN 'partial'
                ELSE 'not_started'
            END AS overall

        FROM integration.LandingzoneEntity le

        JOIN integration.DataSource ds
            ON le.DataSourceId = ds.DataSourceId

        LEFT JOIN integration.Connection c
            ON ds.ConnectionId = c.ConnectionId

        LEFT JOIN integration.BronzeLayerEntity be
            ON le.LandingzoneEntityId = be.LandingzoneEntityId

        LEFT JOIN integration.SilverLayerEntity se
            ON be.BronzeLayerEntityId = se.BronzeLayerEntityId

        -- LZ processed status
        LEFT JOIN (
            SELECT LandingzoneEntityId, MAX(LoadEndDateTime) AS lastLzLoad
            FROM execution.PipelineLandingzoneEntity
            WHERE IsProcessed = 1
            GROUP BY LandingzoneEntityId
        ) ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId

        -- Bronze processed status
        LEFT JOIN (
            SELECT BronzeLayerEntityId, MAX(LoadEndDateTime) AS lastBrzLoad
            FROM execution.PipelineBronzeLayerEntity
            WHERE IsProcessed = 1
            GROUP BY BronzeLayerEntityId
        ) pbe ON be.BronzeLayerEntityId = pbe.BronzeLayerEntityId

        -- Silver processed status
        LEFT JOIN #SlvProcessed pse
            ON se.SilverLayerEntityId = pse.SilverLayerEntityId

        -- Bronze pending queue
        LEFT JOIN (
            SELECT DISTINCT EntityId AS BronzeLayerEntityId
            FROM execution.vw_LoadToBronzeLayer
        ) bp ON be.BronzeLayerEntityId = bp.BronzeLayerEntityId

        -- Silver pending queue
        LEFT JOIN #SlvPending spp
            ON be.BronzeLayerEntityId = spp.BronzeLayerEntityId

        -- Most recent error per entity (last 7 days)
        OUTER APPLY (
            SELECT TOP 1 pe.LogData, pe.EntityLayer, pe.LogDateTime
            FROM logging.PipelineExecution pe
            WHERE pe.LogType LIKE '%Error%'
              AND pe.LogDateTime > DATEADD(day, -7, GETUTCDATE())
              AND pe.LogData LIKE '%' + le.SourceName + '%'
            ORDER BY pe.LogDateTime DESC
        ) err

        WHERE ds.IsActive = 1
            AND (@SourceFilter IS NULL OR ds.Namespace = @SourceFilter)

        ORDER BY ds.Namespace, le.SourceName;

        DROP TABLE #SlvProcessed;
        DROP TABLE #SlvPending;
    END
    """

    execute_sql(proc_sql)
    log.info('  sp_BuildEntityDigest refactored (Phase 2: summary-first with join fallback)')


# ============================================================================
# Step 5: Verify
# ============================================================================

def verify():
    step(5, 'Verifying Phase 2 deployment...')

    # 1. Check EntityStatusSummary table exists
    table_check = query_sql("""
        SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'execution' AND TABLE_NAME = 'EntityStatusSummary'
    """)
    assert table_check, 'EntityStatusSummary table does not exist!'
    log.info('  EntityStatusSummary table: EXISTS')

    # 2. Check row count
    row_count = query_sql("SELECT COUNT(*) AS cnt FROM [execution].[EntityStatusSummary]")
    cnt = int(row_count[0].get('cnt', 0)) if row_count else 0
    log.info(f'  EntityStatusSummary rows: {cnt}')

    # 3. Check sp_UpsertEntityStatus exists
    proc_check = query_sql("""
        SELECT 1 AS ok FROM sys.procedures
        WHERE schema_id = SCHEMA_ID('execution') AND name = 'sp_UpsertEntityStatus'
    """)
    assert proc_check, 'sp_UpsertEntityStatus proc does not exist!'
    log.info('  sp_UpsertEntityStatus proc: EXISTS')

    # 4. Test the refactored digest proc and measure timing
    log.info('  Testing sp_BuildEntityDigest (should use summary path)...')
    t0 = time.time()
    rows = query_sql("EXEC execution.sp_BuildEntityDigest")
    elapsed_summary = time.time() - t0
    log.info(f'  Digest proc returned {len(rows)} entities in {elapsed_summary:.2f}s')

    # 5. Show sample entity
    if rows:
        r = rows[0]
        log.info(f'  Sample: {r.get("source")}.{r.get("sourceSchema")}.{r.get("tableName")} '
                 f'lz={r.get("lzStatus")} brz={r.get("bronzeStatus")} slv={r.get("silverStatus")} '
                 f'overall={r.get("overall")} server={r.get("serverName")}')

    # 6. Summary by source
    sources = {}
    for r in rows:
        src = r.get('source', 'UNKNOWN')
        if src not in sources:
            sources[src] = {'total': 0, 'complete': 0, 'partial': 0, 'pending': 0, 'error': 0, 'not_started': 0}
        sources[src]['total'] += 1
        overall = r.get('overall', 'not_started')
        if overall in sources[src]:
            sources[src][overall] += 1

    for src, stats in sorted(sources.items()):
        log.info(f'  {src}: {stats["total"]} entities — '
                 f'{stats["complete"]} complete, {stats["partial"]} partial, '
                 f'{stats["pending"]} pending, {stats["error"]} error, '
                 f'{stats["not_started"]} not started')

    # 7. Summary path confirmation
    if cnt > 0:
        log.info(f'  Digest is using Phase 2 SUMMARY PATH ({cnt} rows in summary table)')
    else:
        log.info('  WARNING: Summary table is empty — digest is using Phase 1 JOIN FALLBACK')

    log.info('Phase 2 deployment complete!')


# ============================================================================
# Main
# ============================================================================

def main():
    log.info('=' * 60)
    log.info('Entity Digest Engine — Phase 2 Deployment')
    log.info('Pre-computed EntityStatusSummary + sp_UpsertEntityStatus')
    log.info('=' * 60)

    create_status_summary_table()
    create_upsert_entity_status_proc()
    seed_status_summary()
    refactor_digest_proc()
    verify()


if __name__ == '__main__':
    main()
