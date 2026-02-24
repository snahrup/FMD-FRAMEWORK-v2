-- ============================================================================
-- Source Onboarding Tracker — Dashboard-Only Table
-- ============================================================================
-- This table is NOT part of the core FMD framework. It is used exclusively
-- by the FMD Operations Dashboard to track the onboarding progress of new
-- data sources through the 4-step registration process.
--
-- No stored procedures — the dashboard API uses direct INSERT/UPDATE.
-- No pipelines reference this table.
--
-- Run against: SQL_FMD_FRAMEWORK (INTEGRATION CONFIG workspace)
-- ============================================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SourceOnboarding' AND schema_id = SCHEMA_ID('integration'))
BEGIN

    CREATE TABLE [integration].[SourceOnboarding] (
        OnboardingId        INT IDENTITY(1,1) PRIMARY KEY,
        SourceName          NVARCHAR(255)   NOT NULL,           -- Logical source name (e.g. 'M3CLOUD', 'SAP', 'MES')
        StepNumber          INT             NOT NULL,           -- 1=Connection, 2=DataSource, 3=Entities, 4=Ready
        StepName            NVARCHAR(100)   NOT NULL,           -- Human-readable step label
        Status              NVARCHAR(50)    NOT NULL DEFAULT 'pending',  -- pending | in_progress | complete | skipped
        ReferenceId         NVARCHAR(255)   NULL,               -- Step 1: ConnectionName, Step 2: DataSourceName, Step 3: entity count
        Notes               NVARCHAR(MAX)   NULL,               -- Optional notes/context
        CompletedAt         DATETIME2       NULL,               -- When this step was completed
        CreatedAt           DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt           DATETIME2       NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT UQ_SourceOnboarding UNIQUE (SourceName, StepNumber),
        CONSTRAINT CK_StepNumber CHECK (StepNumber BETWEEN 1 AND 4),
        CONSTRAINT CK_Status CHECK (Status IN ('pending', 'in_progress', 'complete', 'skipped'))
    );

    PRINT 'Created [integration].[SourceOnboarding] table';
END
ELSE
BEGIN
    PRINT '[integration].[SourceOnboarding] already exists — skipping';
END
GO

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT
    TABLE_SCHEMA,
    TABLE_NAME,
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'SourceOnboarding'
ORDER BY ORDINAL_POSITION;
