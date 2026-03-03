-- ============================================================================
-- FMD v3 Engine Schema Extensions
-- Adds run tracking and rich task logging for the Python load engine
-- ============================================================================

-- Engine Run tracking (replaces pipeline run tracking)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'EngineRun' AND schema_id = SCHEMA_ID('execution'))
CREATE TABLE [execution].[EngineRun] (
    RunId UNIQUEIDENTIFIER PRIMARY KEY,
    Mode NVARCHAR(10) NOT NULL DEFAULT 'run',           -- plan | run
    Status NVARCHAR(20) NOT NULL DEFAULT 'running',     -- running | completed | failed | cancelled
    StartedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CompletedAtUtc DATETIME2 NULL,
    TotalEntities INT NULL,
    SucceededEntities INT NULL,
    FailedEntities INT NULL,
    SkippedEntities INT NULL,
    TotalRowsRead BIGINT NULL,
    TotalRowsWritten BIGINT NULL,
    TotalBytesTransferred BIGINT NULL,
    TotalDurationSeconds DECIMAL(10,2) NULL,
    Layers NVARCHAR(100) NULL,                          -- 'landing,bronze,silver'
    EntityFilter NVARCHAR(MAX) NULL,                    -- JSON array of entity IDs if filtered
    TriggeredBy NVARCHAR(100) NOT NULL DEFAULT 'dashboard',
    ErrorSummary NVARCHAR(MAX) NULL,
    EngineVersion NVARCHAR(20) NULL DEFAULT '3.0.0'
);
GO

-- Per-entity, per-layer task log with rich metrics
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'EngineTaskLog' AND schema_id = SCHEMA_ID('execution'))
CREATE TABLE [execution].[EngineTaskLog] (
    TaskId UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    RunId UNIQUEIDENTIFIER NOT NULL,
    EntityId INT NOT NULL,
    Layer NVARCHAR(20) NOT NULL,                        -- landing | bronze | silver
    Status NVARCHAR(20) NOT NULL DEFAULT 'running',     -- running | succeeded | failed | skipped
    StartedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CompletedAtUtc DATETIME2 NULL,
    -- Source details
    SourceServer NVARCHAR(200) NULL,
    SourceDatabase NVARCHAR(200) NULL,
    SourceTable NVARCHAR(500) NULL,
    SourceQuery NVARCHAR(MAX) NULL,                     -- actual SQL that was executed
    -- Metrics
    RowsRead BIGINT NULL,
    RowsWritten BIGINT NULL,
    BytesTransferred BIGINT NULL,
    DurationSeconds DECIMAL(10,2) NULL,
    RowsPerSecond DECIMAL(10,2) NULL,
    -- Target details
    TargetLakehouse NVARCHAR(200) NULL,
    TargetPath NVARCHAR(500) NULL,
    TargetFormat NVARCHAR(20) NULL DEFAULT 'parquet',
    -- Watermark tracking
    WatermarkColumn NVARCHAR(200) NULL,
    WatermarkBefore NVARCHAR(500) NULL,
    WatermarkAfter NVARCHAR(500) NULL,
    LoadType NVARCHAR(20) NULL,                         -- full | incremental
    -- Error details (structured, not generic)
    ErrorType NVARCHAR(200) NULL,
    ErrorMessage NVARCHAR(MAX) NULL,
    ErrorStackTrace NVARCHAR(MAX) NULL,
    ErrorSuggestion NVARCHAR(500) NULL,
    -- Full structured JSON log envelope
    LogData NVARCHAR(MAX) NULL,
    -- FK
    CONSTRAINT FK_EngineTaskLog_Run FOREIGN KEY (RunId)
        REFERENCES [execution].[EngineRun](RunId)
);
GO

-- Indexes for common query patterns
-- Use IF NOT EXISTS to make idempotent
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_EngineTaskLog_RunId' AND object_id = OBJECT_ID('execution.EngineTaskLog'))
    CREATE INDEX IX_EngineTaskLog_RunId ON [execution].[EngineTaskLog](RunId)
        INCLUDE (EntityId, Layer, Status);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_EngineTaskLog_EntityLayer' AND object_id = OBJECT_ID('execution.EngineTaskLog'))
    CREATE INDEX IX_EngineTaskLog_EntityLayer ON [execution].[EngineTaskLog](EntityId, Layer, StartedAtUtc DESC);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_EngineTaskLog_Status' AND object_id = OBJECT_ID('execution.EngineTaskLog'))
    CREATE INDEX IX_EngineTaskLog_Status ON [execution].[EngineTaskLog](Status)
        INCLUDE (RunId, EntityId, Layer, ErrorMessage);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_EngineTaskLog_StartedAt' AND object_id = OBJECT_ID('execution.EngineTaskLog'))
    CREATE INDEX IX_EngineTaskLog_StartedAt ON [execution].[EngineTaskLog](StartedAtUtc DESC);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_EngineRun_Status' AND object_id = OBJECT_ID('execution.EngineRun'))
    CREATE INDEX IX_EngineRun_Status ON [execution].[EngineRun](Status, StartedAtUtc DESC);
GO
