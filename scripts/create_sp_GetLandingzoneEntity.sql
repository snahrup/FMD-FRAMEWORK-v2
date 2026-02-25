-- ============================================================================
-- Missing stored procedure: [execution].[sp_GetLandingzoneEntity]
--
-- This proc was NEVER included in the framework DACPAC by the original author.
-- The Bronze and Silver equivalents exist, but the Landing Zone one was omitted.
--
-- Created 2026-02-25 to fix dashboard Pipeline Testing and complete the framework.
-- Pattern modeled after [execution].[sp_GetBronzelayerEntity].
-- ============================================================================

IF EXISTS (SELECT 1 FROM sys.procedures p JOIN sys.schemas s ON p.schema_id = s.schema_id
           WHERE s.name = 'execution' AND p.name = 'sp_GetLandingzoneEntity')
BEGIN
    DROP PROCEDURE [execution].[sp_GetLandingzoneEntity];
END
GO

CREATE PROCEDURE [execution].[sp_GetLandingzoneEntity]
    WITH EXECUTE AS CALLER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT CONCAT('[',
        STRING_AGG(CONCAT(CONVERT(NVARCHAR(MAX),'{"path": "PL_FMD_LOAD_LANDINGZONE", "params":{"EntityId": ')
            , '"', LOWER(CONVERT(NVARCHAR(36), [EntityId])), '"'
            , ',"DataSourceId"     : ', '"', CONVERT(NVARCHAR(20), [DataSourceId]), '"'
            , ',"DataSourceName"   : ', '"', REPLACE(REPLACE([DataSourceName], '\', '\\'), '"', '\"'), '"'
            , ',"DataSourceNamespace": ', '"', LOWER(REPLACE(REPLACE([DataSourceNamespace], '\', '\\'), '"', '\"')), '"'
            , ',"DataSourceType"   : ', '"', REPLACE(REPLACE([DataSourceType], '\', '\\'), '"', '\"'), '"'
            , ',"ConnectionType"   : ', '"', REPLACE(REPLACE([ConnectionType], '\', '\\'), '"', '\"'), '"'
            , ',"ConnectionGuid"   : ', '"', LOWER(CONVERT(NVARCHAR(36), [ConnectionGuid])), '"'
            , ',"TargetSchema"     : ', '"', REPLACE(REPLACE([SourceSchema], '\', '\\'), '"', '\"'), '"'
            , ',"TargetName"       : ', '"', REPLACE(REPLACE([SourceName], '\', '\\'), '"', '\"'), '"'
            , ',"SourceFileName"   : ', '"', REPLACE(REPLACE([TargetFileName], '\', '\\'), '"', '\"'), '"'
            , ',"SourceFilePath"   : ', '"', REPLACE(REPLACE([TargetFilePath], '\', '\\'), '"', '\"'), '"'
            , ',"TargetFileType"   : ', '"', REPLACE(REPLACE([TargetFileType], '\', '\\'), '"', '\"'), '"'
            , ',"TargetLakehouse"  : ', '"', LOWER(CONVERT(NVARCHAR(36), [TargetLakehouseGuid])), '"'
            , ',"TargetWorkspace"  : ', '"', LOWER(CONVERT(NVARCHAR(36), [WorkspaceGuid])), '"'
            , ',"IsIncremental"    : ', '"', CASE WHEN [IsIncremental] = 1 THEN 'True' ELSE 'False' END, '"'
            , ',"LandingzoneEntityId": ', '"', LOWER(CONVERT(NVARCHAR(36), [EntityId])), '"'
            , '}}'), ', ') WITHIN GROUP (ORDER BY [EntityId])
        , ']') AS NotebookParams
    FROM [execution].[vw_LoadSourceToLandingzone]
END
GO
