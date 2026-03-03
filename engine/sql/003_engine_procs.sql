-- ============================================================================
-- FMD v3 Engine Stored Procedures
-- CRUD + query procs for the Python load engine run/task tracking
-- ============================================================================

-- Upsert Engine Run
CREATE OR ALTER PROCEDURE [execution].[sp_UpsertEngineRun]
    @RunId UNIQUEIDENTIFIER,
    @Mode NVARCHAR(10) = 'run',
    @Status NVARCHAR(20) = 'running',
    @TotalEntities INT = NULL,
    @SucceededEntities INT = NULL,
    @FailedEntities INT = NULL,
    @SkippedEntities INT = NULL,
    @TotalRowsRead BIGINT = NULL,
    @TotalRowsWritten BIGINT = NULL,
    @TotalBytesTransferred BIGINT = NULL,
    @TotalDurationSeconds DECIMAL(10,2) = NULL,
    @Layers NVARCHAR(100) = NULL,
    @EntityFilter NVARCHAR(MAX) = NULL,
    @TriggeredBy NVARCHAR(100) = 'dashboard',
    @ErrorSummary NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM [execution].[EngineRun] WHERE RunId = @RunId)
    BEGIN
        UPDATE [execution].[EngineRun] SET
            Status = @Status,
            CompletedAtUtc = CASE
                WHEN @Status IN ('completed','failed','cancelled') THEN SYSUTCDATETIME()
                ELSE CompletedAtUtc
            END,
            TotalEntities = COALESCE(@TotalEntities, TotalEntities),
            SucceededEntities = COALESCE(@SucceededEntities, SucceededEntities),
            FailedEntities = COALESCE(@FailedEntities, FailedEntities),
            SkippedEntities = COALESCE(@SkippedEntities, SkippedEntities),
            TotalRowsRead = COALESCE(@TotalRowsRead, TotalRowsRead),
            TotalRowsWritten = COALESCE(@TotalRowsWritten, TotalRowsWritten),
            TotalBytesTransferred = COALESCE(@TotalBytesTransferred, TotalBytesTransferred),
            TotalDurationSeconds = COALESCE(@TotalDurationSeconds, TotalDurationSeconds),
            ErrorSummary = COALESCE(@ErrorSummary, ErrorSummary)
        WHERE RunId = @RunId;
    END
    ELSE
    BEGIN
        INSERT INTO [execution].[EngineRun] (
            RunId, Mode, Status, TotalEntities, Layers, EntityFilter, TriggeredBy
        ) VALUES (
            @RunId, @Mode, @Status, @TotalEntities, @Layers, @EntityFilter, @TriggeredBy
        );
    END
END;
GO

-- Insert Engine Task Log
CREATE OR ALTER PROCEDURE [execution].[sp_InsertEngineTaskLog]
    @RunId UNIQUEIDENTIFIER,
    @EntityId INT,
    @Layer NVARCHAR(20),
    @Status NVARCHAR(20),
    @SourceServer NVARCHAR(200) = NULL,
    @SourceDatabase NVARCHAR(200) = NULL,
    @SourceTable NVARCHAR(500) = NULL,
    @SourceQuery NVARCHAR(MAX) = NULL,
    @RowsRead BIGINT = NULL,
    @RowsWritten BIGINT = NULL,
    @BytesTransferred BIGINT = NULL,
    @DurationSeconds DECIMAL(10,2) = NULL,
    @TargetLakehouse NVARCHAR(200) = NULL,
    @TargetPath NVARCHAR(500) = NULL,
    @WatermarkColumn NVARCHAR(200) = NULL,
    @WatermarkBefore NVARCHAR(500) = NULL,
    @WatermarkAfter NVARCHAR(500) = NULL,
    @LoadType NVARCHAR(20) = NULL,
    @ErrorType NVARCHAR(200) = NULL,
    @ErrorMessage NVARCHAR(MAX) = NULL,
    @ErrorStackTrace NVARCHAR(MAX) = NULL,
    @ErrorSuggestion NVARCHAR(500) = NULL,
    @LogData NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @RowsPerSecond DECIMAL(10,2) = NULL;
    IF @DurationSeconds > 0 AND @RowsRead > 0
        SET @RowsPerSecond = CAST(@RowsRead AS DECIMAL(10,2)) / @DurationSeconds;

    INSERT INTO [execution].[EngineTaskLog] (
        RunId, EntityId, Layer, Status,
        SourceServer, SourceDatabase, SourceTable, SourceQuery,
        RowsRead, RowsWritten, BytesTransferred, DurationSeconds, RowsPerSecond,
        TargetLakehouse, TargetPath,
        WatermarkColumn, WatermarkBefore, WatermarkAfter, LoadType,
        ErrorType, ErrorMessage, ErrorStackTrace, ErrorSuggestion,
        LogData
    ) VALUES (
        @RunId, @EntityId, @Layer, @Status,
        @SourceServer, @SourceDatabase, @SourceTable, @SourceQuery,
        @RowsRead, @RowsWritten, @BytesTransferred, @DurationSeconds, @RowsPerSecond,
        @TargetLakehouse, @TargetPath,
        @WatermarkColumn, @WatermarkBefore, @WatermarkAfter, @LoadType,
        @ErrorType, @ErrorMessage, @ErrorStackTrace, @ErrorSuggestion,
        @LogData
    );

    -- Also update entity digest so dashboard status updates immediately
    -- sp_UpsertEntityStatus auto-resolves BronzeLayerEntityId -> LandingzoneEntityId
    IF @Status IN ('succeeded', 'failed')
    BEGIN
        EXEC [execution].[sp_UpsertEntityStatus]
            @LandingzoneEntityId = @EntityId,
            @Layer = @Layer,
            @Status = @Status,
            @ErrorMessage = @ErrorMessage;
    END
END;
GO

-- Get recent runs for dashboard
CREATE OR ALTER PROCEDURE [execution].[sp_GetEngineRuns]
    @Limit INT = 20,
    @Status NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@Limit)
        RunId, Mode, Status, StartedAtUtc, CompletedAtUtc,
        TotalEntities, SucceededEntities, FailedEntities, SkippedEntities,
        TotalRowsRead, TotalRowsWritten, TotalBytesTransferred,
        TotalDurationSeconds, Layers, TriggeredBy, ErrorSummary, EngineVersion,
        DATEDIFF(SECOND, StartedAtUtc, COALESCE(CompletedAtUtc, SYSUTCDATETIME())) AS ElapsedSeconds
    FROM [execution].[EngineRun]
    WHERE @Status IS NULL OR Status = @Status
    ORDER BY StartedAtUtc DESC;
END;
GO

-- Get task logs for a specific run
CREATE OR ALTER PROCEDURE [execution].[sp_GetEngineTaskLogs]
    @RunId UNIQUEIDENTIFIER = NULL,
    @EntityId INT = NULL,
    @Layer NVARCHAR(20) = NULL,
    @Status NVARCHAR(20) = NULL,
    @Limit INT = 100,
    @Offset INT = 0
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        t.TaskId, t.RunId, t.EntityId, t.Layer, t.Status,
        t.StartedAtUtc, t.CompletedAtUtc,
        t.SourceServer, t.SourceDatabase, t.SourceTable,
        t.RowsRead, t.RowsWritten, t.BytesTransferred,
        t.DurationSeconds, t.RowsPerSecond,
        t.LoadType, t.WatermarkColumn, t.WatermarkBefore, t.WatermarkAfter,
        t.ErrorType, t.ErrorMessage, t.ErrorSuggestion,
        le.SourceSchema, le.SourceName,
        ds.Name AS DataSourceName
    FROM [execution].[EngineTaskLog] t
    LEFT JOIN [integration].[LandingzoneEntity] le ON t.EntityId = le.LandingzoneEntityId
    LEFT JOIN [integration].[DataSource] ds ON le.DataSourceId = ds.DataSourceId
    WHERE (@RunId IS NULL OR t.RunId = @RunId)
      AND (@EntityId IS NULL OR t.EntityId = @EntityId)
      AND (@Layer IS NULL OR t.Layer = @Layer)
      AND (@Status IS NULL OR t.Status = @Status)
    ORDER BY t.StartedAtUtc DESC
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
END;
GO

-- Get engine metrics for dashboard
CREATE OR ALTER PROCEDURE [execution].[sp_GetEngineMetrics]
    @HoursBack INT = 24
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Since DATETIME2 = DATEADD(HOUR, -@HoursBack, SYSUTCDATETIME());

    -- Run-level metrics
    SELECT
        COUNT(*) AS TotalRuns,
        SUM(CASE WHEN Status = 'completed' THEN 1 ELSE 0 END) AS CompletedRuns,
        SUM(CASE WHEN Status = 'failed' THEN 1 ELSE 0 END) AS FailedRuns,
        SUM(TotalRowsRead) AS TotalRowsRead,
        SUM(TotalRowsWritten) AS TotalRowsWritten,
        SUM(TotalBytesTransferred) AS TotalBytesTransferred,
        AVG(TotalDurationSeconds) AS AvgDurationSeconds
    FROM [execution].[EngineRun]
    WHERE StartedAtUtc >= @Since;

    -- Task-level metrics by layer
    SELECT
        Layer,
        COUNT(*) AS TotalTasks,
        SUM(CASE WHEN Status = 'succeeded' THEN 1 ELSE 0 END) AS Succeeded,
        SUM(CASE WHEN Status = 'failed' THEN 1 ELSE 0 END) AS Failed,
        SUM(RowsRead) AS TotalRowsRead,
        AVG(DurationSeconds) AS AvgDurationSeconds,
        AVG(RowsPerSecond) AS AvgRowsPerSecond
    FROM [execution].[EngineTaskLog]
    WHERE StartedAtUtc >= @Since
    GROUP BY Layer;

    -- Top 10 slowest entities
    SELECT TOP 10
        t.EntityId, le.SourceName, ds.Name AS DataSourceName,
        t.Layer, t.DurationSeconds, t.RowsRead, t.Status
    FROM [execution].[EngineTaskLog] t
    LEFT JOIN [integration].[LandingzoneEntity] le ON t.EntityId = le.LandingzoneEntityId
    LEFT JOIN [integration].[DataSource] ds ON le.DataSourceId = ds.DataSourceId
    WHERE t.StartedAtUtc >= @Since AND t.Status = 'succeeded'
    ORDER BY t.DurationSeconds DESC;

    -- Top 5 most common errors
    SELECT TOP 5
        ErrorType, ErrorMessage, COUNT(*) AS Occurrences
    FROM [execution].[EngineTaskLog]
    WHERE StartedAtUtc >= @Since AND Status = 'failed'
    GROUP BY ErrorType, ErrorMessage
    ORDER BY COUNT(*) DESC;
END;
GO
