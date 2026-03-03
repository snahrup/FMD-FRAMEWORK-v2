-- ============================================================================
-- FMD v3 Engine Views
-- Dashboard-ready views for run history, task manifests, and entity performance
-- ============================================================================

-- Run Manifest: Single-pane view answering "what happened in this run?"
CREATE OR ALTER VIEW [logging].[vw_RunManifest] AS
SELECT
    r.RunId,
    r.Mode,
    r.Status AS RunStatus,
    r.StartedAtUtc AS RunStarted,
    r.CompletedAtUtc AS RunCompleted,
    r.TotalEntities,
    r.SucceededEntities,
    r.FailedEntities,
    r.SkippedEntities,
    r.TotalRowsRead AS RunTotalRows,
    r.TotalDurationSeconds AS RunDurationSeconds,
    r.TriggeredBy,
    r.EngineVersion,
    -- Task details
    t.TaskId,
    t.EntityId,
    t.Layer,
    t.Status AS TaskStatus,
    t.StartedAtUtc AS TaskStarted,
    t.CompletedAtUtc AS TaskCompleted,
    t.SourceServer,
    t.SourceDatabase,
    t.SourceTable,
    t.RowsRead,
    t.RowsWritten,
    t.BytesTransferred,
    t.DurationSeconds,
    t.RowsPerSecond,
    t.LoadType,
    t.WatermarkColumn,
    t.WatermarkBefore,
    t.WatermarkAfter,
    t.ErrorType,
    t.ErrorMessage,
    t.ErrorSuggestion,
    -- Entity metadata (joined)
    le.SourceSchema,
    le.SourceName,
    le.IsIncremental,
    ds.Name AS DataSourceName,
    c.Name AS ConnectionName,
    c.Type AS ConnectionType
FROM [execution].[EngineRun] r
LEFT JOIN [execution].[EngineTaskLog] t ON r.RunId = t.RunId
LEFT JOIN [integration].[LandingzoneEntity] le ON t.EntityId = le.LandingzoneEntityId
LEFT JOIN [integration].[DataSource] ds ON le.DataSourceId = ds.DataSourceId
LEFT JOIN [integration].[Connection] c ON ds.ConnectionId = c.ConnectionId;
GO

-- Run Summary: Aggregated view for dashboard run history table
CREATE OR ALTER VIEW [logging].[vw_RunSummary] AS
SELECT
    r.RunId,
    r.Mode,
    r.Status,
    r.StartedAtUtc,
    r.CompletedAtUtc,
    r.TotalEntities,
    r.SucceededEntities,
    r.FailedEntities,
    r.SkippedEntities,
    r.TotalRowsRead,
    r.TotalRowsWritten,
    r.TotalBytesTransferred,
    r.TotalDurationSeconds,
    r.Layers,
    r.TriggeredBy,
    r.ErrorSummary,
    r.EngineVersion,
    DATEDIFF(SECOND, r.StartedAtUtc, COALESCE(r.CompletedAtUtc, SYSUTCDATETIME())) AS ElapsedSeconds,
    -- Top 3 errors for quick display
    (SELECT TOP 3
        CONCAT(le2.SourceName, ': ', t2.ErrorMessage) AS ErrorDetail
     FROM [execution].[EngineTaskLog] t2
     LEFT JOIN [integration].[LandingzoneEntity] le2 ON t2.EntityId = le2.LandingzoneEntityId
     WHERE t2.RunId = r.RunId AND t2.Status = 'failed'
     ORDER BY t2.StartedAtUtc
     FOR JSON PATH) AS TopErrors
FROM [execution].[EngineRun] r;
GO

-- Entity Performance: Per-entity metrics over time
CREATE OR ALTER VIEW [logging].[vw_EntityPerformance] AS
SELECT
    t.EntityId,
    le.SourceSchema,
    le.SourceName,
    ds.Name AS DataSourceName,
    t.Layer,
    COUNT(*) AS TotalRuns,
    SUM(CASE WHEN t.Status = 'succeeded' THEN 1 ELSE 0 END) AS SuccessCount,
    SUM(CASE WHEN t.Status = 'failed' THEN 1 ELSE 0 END) AS FailCount,
    AVG(t.RowsRead) AS AvgRowsRead,
    AVG(t.DurationSeconds) AS AvgDurationSeconds,
    AVG(t.RowsPerSecond) AS AvgRowsPerSecond,
    MAX(t.StartedAtUtc) AS LastRunAt,
    MAX(CASE WHEN t.Status = 'succeeded' THEN t.CompletedAtUtc END) AS LastSuccessAt,
    MAX(CASE WHEN t.Status = 'failed' THEN t.ErrorMessage END) AS LastErrorMessage
FROM [execution].[EngineTaskLog] t
LEFT JOIN [integration].[LandingzoneEntity] le ON t.EntityId = le.LandingzoneEntityId
LEFT JOIN [integration].[DataSource] ds ON le.DataSourceId = ds.DataSourceId
GROUP BY t.EntityId, le.SourceSchema, le.SourceName, ds.Name, t.Layer;
GO
