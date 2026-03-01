"""
Deploy Entity Digest Engine to Fabric SQL DB
=============================================
Creates/updates the stored procedure that powers the dashboard digest engine.
Also enriches the Connection table with ServerName/DatabaseName from the
Fabric Gateway API so the digest can include source connection info without
any REST API calls at query time.

Run this script any time you need to update the digest proc or refresh
connection metadata. Safe to run repeatedly (idempotent).

Usage:
    python scripts/deploy_digest_engine.py
"""

import sys
import os
import json
import struct
import time
import urllib.request
import logging

# ── Bootstrap: Add dashboard API to path for shared auth/query helpers ──
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'app', 'api'))
from server import query_sql, get_fabric_token, get_gateway_connections

# query_sql handles both SELECT and DDL/DML — commits automatically
execute_sql = query_sql

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('digest-deploy')


def step(n, msg):
    log.info(f'[Step {n}] {msg}')


# ============================================================================
# Step 1: ALTER TABLE — Add ServerName, DatabaseName to integration.Connection
# ============================================================================

def add_connection_columns():
    step(1, 'Adding ServerName/DatabaseName columns to integration.Connection...')

    # Check if columns already exist
    cols = query_sql("""
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'Connection'
        AND COLUMN_NAME IN ('ServerName', 'DatabaseName')
    """)
    existing = {c['COLUMN_NAME'] for c in cols}

    if 'ServerName' not in existing:
        execute_sql("ALTER TABLE [integration].[Connection] ADD [ServerName] VARCHAR(200) NULL")
        log.info('  Added ServerName column')
    else:
        log.info('  ServerName column already exists')

    if 'DatabaseName' not in existing:
        execute_sql("ALTER TABLE [integration].[Connection] ADD [DatabaseName] VARCHAR(200) NULL")
        log.info('  Added DatabaseName column')
    else:
        log.info('  DatabaseName column already exists')


# ============================================================================
# Step 2: Update sp_UpsertConnection to accept ServerName/DatabaseName
# ============================================================================

def update_upsert_connection_proc():
    step(2, 'Updating sp_UpsertConnection to include ServerName/DatabaseName...')

    proc_sql = """
    CREATE OR ALTER PROCEDURE [integration].[sp_UpsertConnection](
        @ConnectionGuid UNIQUEIDENTIFIER,
        @Name NVARCHAR(200),
        @Type NVARCHAR(50),
        @IsActive BIT,
        @ServerName VARCHAR(200) = NULL,
        @DatabaseName VARCHAR(200) = NULL
    )
    WITH EXECUTE AS CALLER
    AS
    SET NOCOUNT ON;

    IF NOT EXISTS(
        SELECT 1 FROM [integration].[Connection]
        WHERE [ConnectionGuid] = @ConnectionGuid
    )
    BEGIN
        INSERT INTO [integration].[Connection]
            ([ConnectionGuid], [Name], [Type], [IsActive], [ServerName], [DatabaseName])
        VALUES
            (@ConnectionGuid, @Name, @Type, @IsActive, @ServerName, @DatabaseName);
    END
    ELSE
    BEGIN
        UPDATE [integration].[Connection]
        SET [Name] = @Name,
            [Type] = @Type,
            [IsActive] = @IsActive,
            [ServerName] = COALESCE(@ServerName, [ServerName]),
            [DatabaseName] = COALESCE(@DatabaseName, [DatabaseName])
        WHERE [ConnectionGuid] = @ConnectionGuid;
    END
    """
    execute_sql(proc_sql)
    log.info('  sp_UpsertConnection updated')


# ============================================================================
# Step 3: Populate ServerName/DatabaseName from Fabric Gateway API
# ============================================================================

def sync_gateway_connection_info():
    step(3, 'Syncing gateway connection info (ServerName/DatabaseName)...')

    # Get all gateway connections from Fabric REST API
    gw_conns = get_gateway_connections()
    gw_map = {g['id'].lower(): g for g in gw_conns}

    # Get all SQL-type connections from metadata DB
    connections = query_sql("""
        SELECT ConnectionId, ConnectionGuid, Name, ServerName, DatabaseName
        FROM integration.Connection
        WHERE Type = 'SQL'
        ORDER BY ConnectionId
    """)

    updated = 0
    for conn in connections:
        guid = (conn.get('ConnectionGuid') or '').lower()
        gw = gw_map.get(guid)
        if not gw:
            log.warning(f'  Connection {conn["Name"]} ({guid[:8]}...) not found in gateway API')
            continue

        server = gw.get('server', '')
        database = gw.get('database', '')

        if not server:
            continue

        # Only update if values changed or are missing
        if conn.get('ServerName') == server and conn.get('DatabaseName') == database:
            log.info(f'  {conn["Name"]}: already up to date ({server};{database})')
            continue

        execute_sql(
            f"UPDATE [integration].[Connection] SET "
            f"[ServerName] = '{server.replace(chr(39), chr(39)*2)}', "
            f"[DatabaseName] = '{database.replace(chr(39), chr(39)*2)}' "
            f"WHERE ConnectionId = {conn['ConnectionId']}"
        )
        log.info(f'  {conn["Name"]}: {server};{database}')
        updated += 1

    log.info(f'  Updated {updated} connection(s)')


# ============================================================================
# Step 4: Create execution.sp_BuildEntityDigest
# ============================================================================

def create_digest_proc():
    step(4, 'Creating execution.sp_BuildEntityDigest stored procedure...')

    proc_sql = """
    CREATE OR ALTER PROCEDURE [execution].[sp_BuildEntityDigest]
        @SourceFilter VARCHAR(50) = NULL,
        @LayerFilter VARCHAR(20) = NULL,
        @StatusFilter VARCHAR(20) = NULL
    WITH EXECUTE AS CALLER
    AS
    SET NOCOUNT ON;

    -- ================================================================
    -- Entity Digest Engine — Single source of truth for all entity state
    --
    -- Returns one row per registered entity with:
    --   - Entity metadata (id, name, schema, source, incremental, PKs)
    --   - Source connection info (server, database, connection name)
    --   - Per-layer status (loaded/pending/not_started) + timestamps
    --   - Recent errors (last 7 days)
    --   - Computed overall status
    -- ================================================================

    -- Handle optional PipelineSilverLayerEntity table (may not exist yet)
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

    -- Handle optional Silver pending view (view uses BronzeLayerEntityId, not SilverLayerEntityId)
    CREATE TABLE #SlvPending (BronzeLayerEntityId INT);
    IF OBJECT_ID('execution.vw_LoadToSilverLayer', 'V') IS NOT NULL
    BEGIN
        INSERT INTO #SlvPending
        EXEC sp_executesql N'SELECT DISTINCT BronzeLayerEntityId FROM execution.vw_LoadToSilverLayer';
    END

    -- Main query
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

        -- Bronze status: loaded if processed, else check pending view
        CASE
            WHEN pbe.BronzeLayerEntityId IS NOT NULL THEN 'loaded'
            WHEN bp.BronzeLayerEntityId IS NOT NULL THEN 'pending'
            ELSE 'not_started'
        END AS bronzeStatus,
        pbe.lastBrzLoad,

        -- Silver status: loaded if processed, else check pending view
        CASE
            WHEN pse.SilverLayerEntityId IS NOT NULL THEN 'loaded'
            WHEN spp.BronzeLayerEntityId IS NOT NULL THEN 'pending'
            ELSE 'not_started'
        END AS silverStatus,
        pse.lastSlvLoad,

        -- Recent error (last 7 days, most recent per entity)
        err.LogData                         AS lastErrorMessage,
        err.EntityLayer                     AS lastErrorLayer,
        err.LogDateTime                     AS lastErrorTime,

        -- Overall status (computed)
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

    -- LZ processed status (most recent load)
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

    -- Silver processed status (from temp table — handles missing table)
    LEFT JOIN #SlvProcessed pse
        ON se.SilverLayerEntityId = pse.SilverLayerEntityId

    -- Bronze pending queue (view uses EntityId, not BronzeLayerEntityId)
    LEFT JOIN (
        SELECT DISTINCT EntityId AS BronzeLayerEntityId
        FROM execution.vw_LoadToBronzeLayer
    ) bp ON be.BronzeLayerEntityId = bp.BronzeLayerEntityId

    -- Silver pending queue (from temp table — joins via BronzeLayerEntityId)
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
    """

    execute_sql(proc_sql)
    log.info('  sp_BuildEntityDigest created/updated')


# ============================================================================
# Step 5: Verify
# ============================================================================

def verify():
    step(5, 'Verifying deployment...')

    # Check columns exist
    cols = query_sql("""
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'Connection'
        AND COLUMN_NAME IN ('ServerName', 'DatabaseName')
    """)
    assert len(cols) == 2, f'Expected 2 new columns, found {len(cols)}'
    log.info('  Connection table: ServerName + DatabaseName columns present')

    # Check connection info populated
    populated = query_sql("""
        SELECT COUNT(*) AS cnt FROM integration.Connection
        WHERE ServerName IS NOT NULL AND Type = 'SQL'
    """)
    cnt = int(populated[0].get('cnt', 0)) if populated else 0
    log.info(f'  Connections with server info: {cnt}')

    # Test the digest proc
    t0 = time.time()
    rows = query_sql("EXEC execution.sp_BuildEntityDigest")
    elapsed = time.time() - t0
    log.info(f'  Digest proc returned {len(rows)} entities in {elapsed:.1f}s')

    # Show sample
    if rows:
        r = rows[0]
        log.info(f'  Sample: {r.get("source")}.{r.get("sourceSchema")}.{r.get("tableName")} '
                 f'lz={r.get("lzStatus")} brz={r.get("bronzeStatus")} slv={r.get("silverStatus")} '
                 f'overall={r.get("overall")} server={r.get("serverName")}')

    # Summary by source
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

    log.info('Deployment complete!')


# ============================================================================
# Main
# ============================================================================

def main():
    log.info('=' * 60)
    log.info('Entity Digest Engine — Fabric SQL Deployment')
    log.info('=' * 60)

    add_connection_columns()
    update_upsert_connection_proc()
    sync_gateway_connection_info()
    create_digest_proc()
    verify()


if __name__ == '__main__':
    main()
