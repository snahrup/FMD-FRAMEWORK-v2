-- ============================================================================
-- sp_ActivateEntitiesForSilver
-- Activates a batch of Silver layer entities after validating they have
-- successfully loaded Bronze data.
--
-- Phase 1 validation: 100-entity stratified sample across all 5 sources.
-- Called by: scripts/activate_silver_entities_phase1.py
--
-- Author: Steve Nahrup
-- Created: 2026-03-10
-- ============================================================================

CREATE OR ALTER PROCEDURE [execution].[sp_ActivateEntitiesForSilver]
    @EntityIds NVARCHAR(MAX),          -- Comma-separated LandingzoneEntityId list
    @DryRun BIT = 1,                   -- 1 = plan mode (no writes), 0 = execute
    @ActivatedBy NVARCHAR(100) = 'phase1_activation'
AS
BEGIN
    SET NOCOUNT ON;

    -- -----------------------------------------------------------------------
    -- 1. Parse comma-separated IDs into a temp table
    -- -----------------------------------------------------------------------
    CREATE TABLE #RequestedIds (LandingzoneEntityId INT NOT NULL PRIMARY KEY);

    INSERT INTO #RequestedIds (LandingzoneEntityId)
    SELECT CAST(value AS INT)
    FROM STRING_SPLIT(@EntityIds, ',')
    WHERE RTRIM(LTRIM(value)) <> '';

    DECLARE @RequestedCount INT = (SELECT COUNT(*) FROM #RequestedIds);

    -- -----------------------------------------------------------------------
    -- 2. Validate: every requested entity must have Bronze data
    --    Bronze data = BronzeLayerEntity exists AND PipelineBronzeLayerEntity
    --    has at least one IsProcessed=1 record (meaning Bronze load succeeded)
    -- -----------------------------------------------------------------------
    CREATE TABLE #Validated (
        LandingzoneEntityId INT NOT NULL PRIMARY KEY,
        BronzeLayerEntityId INT NOT NULL,
        SilverLayerEntityId INT NULL,
        SourceNamespace NVARCHAR(100),
        SourceSchema NVARCHAR(100),
        SourceName NVARCHAR(200),
        BronzeIsActive BIT,
        SilverIsActive BIT,
        HasBronzeData BIT
    );

    INSERT INTO #Validated (
        LandingzoneEntityId, BronzeLayerEntityId, SilverLayerEntityId,
        SourceNamespace, SourceSchema, SourceName,
        BronzeIsActive, SilverIsActive, HasBronzeData
    )
    SELECT
        le.LandingzoneEntityId,
        be.BronzeLayerEntityId,
        se.SilverLayerEntityId,
        ds.Namespace,
        le.SourceSchema,
        le.SourceName,
        be.IsActive,
        COALESCE(se.IsActive, 0),
        CASE
            -- Check if Bronze pipeline has processed this entity
            WHEN EXISTS (
                SELECT 1 FROM execution.PipelineBronzeLayerEntity pbe
                WHERE pbe.BronzeLayerEntityId = be.BronzeLayerEntityId
                  AND pbe.IsProcessed = 1
            ) THEN 1
            -- Also accept if EntityStatusSummary shows bronze loaded
            WHEN EXISTS (
                SELECT 1 FROM execution.EntityStatusSummary ess
                WHERE ess.LandingzoneEntityId = le.LandingzoneEntityId
                  AND ess.BronzeStatus IN ('loaded', 'Succeeded', 'succeeded')
            ) THEN 1
            ELSE 0
        END
    FROM #RequestedIds r
    INNER JOIN integration.LandingzoneEntity le
        ON r.LandingzoneEntityId = le.LandingzoneEntityId
    INNER JOIN integration.BronzeLayerEntity be
        ON le.LandingzoneEntityId = be.LandingzoneEntityId
    LEFT JOIN integration.SilverLayerEntity se
        ON be.BronzeLayerEntityId = se.BronzeLayerEntityId
    LEFT JOIN integration.DataSource ds
        ON le.DataSourceId = ds.DataSourceId;

    -- -----------------------------------------------------------------------
    -- 3. Identify entities that CANNOT be activated (no Bronze data)
    -- -----------------------------------------------------------------------
    DECLARE @ValidCount INT = (SELECT COUNT(*) FROM #Validated WHERE HasBronzeData = 1);
    DECLARE @InvalidCount INT = (SELECT COUNT(*) FROM #Validated WHERE HasBronzeData = 0);
    DECLARE @MissingCount INT = @RequestedCount - (SELECT COUNT(*) FROM #Validated);

    -- -----------------------------------------------------------------------
    -- 4. Execute activation (only if not dry run)
    -- -----------------------------------------------------------------------
    IF @DryRun = 0 AND @ValidCount > 0
    BEGIN
        -- Activate Silver entities that have Bronze data
        UPDATE se
        SET se.IsActive = 1
        FROM integration.SilverLayerEntity se
        INNER JOIN #Validated v ON se.SilverLayerEntityId = v.SilverLayerEntityId
        WHERE v.HasBronzeData = 1
          AND v.SilverLayerEntityId IS NOT NULL;

        -- Also ensure Bronze entities are active
        UPDATE be
        SET be.IsActive = 1
        FROM integration.BronzeLayerEntity be
        INNER JOIN #Validated v ON be.BronzeLayerEntityId = v.BronzeLayerEntityId
        WHERE v.HasBronzeData = 1;

        -- Update EntityStatusSummary to reflect activation
        UPDATE ess
        SET ess.SilverStatus = CASE
                WHEN ess.SilverStatus = 'not_started' THEN 'pending'
                ELSE ess.SilverStatus
            END,
            ess.LastUpdated = GETUTCDATE(),
            ess.LastUpdatedBy = @ActivatedBy
        FROM execution.EntityStatusSummary ess
        INNER JOIN #Validated v ON ess.LandingzoneEntityId = v.LandingzoneEntityId
        WHERE v.HasBronzeData = 1;
    END

    -- -----------------------------------------------------------------------
    -- 5. Return results
    -- -----------------------------------------------------------------------

    -- Result set 1: Summary
    SELECT
        @RequestedCount AS RequestedCount,
        @ValidCount AS ValidCount,
        @InvalidCount AS InvalidCount,
        @MissingCount AS MissingCount,
        @DryRun AS DryRun,
        CASE WHEN @DryRun = 1 THEN 'PLAN' ELSE 'EXECUTED' END AS Mode;

    -- Result set 2: Per-source breakdown
    SELECT
        v.SourceNamespace,
        COUNT(*) AS TotalEntities,
        SUM(CAST(v.HasBronzeData AS INT)) AS WithBronzeData,
        SUM(CASE WHEN v.HasBronzeData = 0 THEN 1 ELSE 0 END) AS WithoutBronzeData,
        SUM(CASE WHEN v.SilverIsActive = 1 THEN 1 ELSE 0 END) AS AlreadyActive,
        SUM(CASE WHEN v.HasBronzeData = 1 AND COALESCE(v.SilverIsActive, 0) = 0 THEN 1 ELSE 0 END) AS NewlyActivated
    FROM #Validated v
    GROUP BY v.SourceNamespace
    ORDER BY v.SourceNamespace;

    -- Result set 3: Entity details (for logging/audit)
    SELECT
        v.LandingzoneEntityId,
        v.BronzeLayerEntityId,
        v.SilverLayerEntityId,
        v.SourceNamespace,
        v.SourceSchema,
        v.SourceName,
        v.BronzeIsActive,
        v.SilverIsActive AS SilverWasActive,
        v.HasBronzeData,
        CASE
            WHEN v.HasBronzeData = 0 THEN 'SKIPPED_NO_BRONZE_DATA'
            WHEN v.SilverLayerEntityId IS NULL THEN 'SKIPPED_NO_SILVER_ENTITY'
            WHEN @DryRun = 1 THEN 'WOULD_ACTIVATE'
            ELSE 'ACTIVATED'
        END AS ActivationResult
    FROM #Validated v
    ORDER BY v.SourceNamespace, v.SourceName;

    -- Result set 4: Entities that were requested but not found in metadata
    SELECT r.LandingzoneEntityId AS MissingEntityId
    FROM #RequestedIds r
    WHERE r.LandingzoneEntityId NOT IN (SELECT LandingzoneEntityId FROM #Validated);

    -- Cleanup
    DROP TABLE #RequestedIds;
    DROP TABLE #Validated;
END;
GO
