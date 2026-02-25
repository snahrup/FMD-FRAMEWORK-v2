-- Extracted stored-procedure SQL executions from NB_SETUP_FMD (1).ipynb
-- Notes:
-- 1) Some statements are templates. Values are populated at runtime in the notebook.
-- 2) Placeholders are shown as {{like_this}}.


-- ------------------------------
-- From notebook cell 61
-- ------------------------------

-- Upsert Connection (template)
EXEC [integration].[sp_UpsertConnection] @ConnectionGuid = "{{connection_id}}", @Name = "{{display_name}}", @Type = "{{connection_type}}", @IsActive = 1
GO


-- Upsert Connection: CON_FMD_NOTEBOOK
EXEC [integration].[sp_UpsertConnection] @ConnectionGuid = "00000000-0000-0000-0000-000000000001", @Name = "CON_FMD_NOTEBOOK", @Type = "NOTEBOOK", @IsActive = 1
GO


-- Upsert Connection: CON_FMD_ONELAKE
EXEC [integration].[sp_UpsertConnection] @ConnectionGuid = "00000000-0000-0000-0000-000000000000", @Name = "CON_FMD_ONELAKE", @Type = "ONELAKE", @IsActive = 1
GO


-- ------------------------------
-- From notebook cell 63
-- ------------------------------

-- Upsert DataSource (block)
DECLARE @DataSourceIdInternal INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = 'LH_DATA_LANDINGZONE' and Type='ONELAKE_TABLES_01')
    DECLARE @ConnectionIdInternal INT = (SELECT ConnectionId FROM integration.Connection WHERE ConnectionGuid = '00000000-0000-0000-0000-000000000000')
    EXECUTE [integration].[sp_UpsertDataSource] 
        @ConnectionId = @ConnectionIdInternal
        ,@DataSourceId = @DataSourceIdInternal
        ,@Name = 'LH_DATA_LANDINGZONE'
        ,@Namespace = 'ONELAKE'
        ,@Type = 'ONELAKE_TABLES_01'
        ,@Description = 'ONELAKE_TABLES'
        ,@IsActive = 1
GO


-- Upsert DataSource (block)
DECLARE @DataSourceIdInternal INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = 'LH_DATA_LANDINGZONE' and Type ='ONELAKE_FILES_01')
    DECLARE @ConnectionIdInternal INT = (SELECT ConnectionId FROM integration.Connection WHERE ConnectionGuid = '00000000-0000-0000-0000-000000000000')
    EXECUTE [integration].[sp_UpsertDataSource] 
        @ConnectionId = @ConnectionIdInternal
        ,@DataSourceId = @DataSourceIdInternal
        ,@Name = 'LH_DATA_LANDINGZONE'
        ,@Namespace = 'ONELAKE'
        ,@Type = 'ONELAKE_FILES_01'
        ,@Description = 'ONELAKE_FILES'
        ,@IsActive = 1
GO


-- Upsert DataSource (block)
DECLARE @DataSourceIdInternal INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = 'CUSTOM_NOTEBOOK' and Type='NOTEBOOK')
        DECLARE @ConnectionIdInternal INT = (SELECT ConnectionId FROM integration.Connection WHERE ConnectionGuid = '00000000-0000-0000-0000-000000000001')
        EXECUTE [integration].[sp_UpsertDataSource] 
            @ConnectionId = @ConnectionIdInternal
            ,@DataSourceId = @DataSourceIdInternal
            ,@Name = 'CUSTOM_NOTEBOOK'
            ,@Namespace = 'NB'
            ,@Type = 'NOTEBOOK'
            ,@Description = 'Custom Notebook'
            ,@IsActive = 1
GO


-- ------------------------------
-- From notebook cell 65
-- ------------------------------

-- Upsert Workspace (template)
EXEC [integration].[sp_UpsertWorkspace] @WorkspaceId = "{{workspace_id}}", @Name = "{{workspace_name}}"
GO


-- ------------------------------
-- From notebook cell 67
-- ------------------------------

-- Upsert Pipeline (template)
EXEC [integration].[sp_UpsertPipeline] @PipelineId = "{{pipeline_id}}", @WorkspaceId = "{{workspace_data_id}}", @Name = "{{pipeline_name}}"
GO


-- ------------------------------
-- From notebook cell 69
-- ------------------------------

-- Upsert Lakehouse (template)
EXEC [integration].[sp_UpsertLakehouse] @LakehouseId = "{{lakehouse_id}}", @WorkspaceId = "{{workspace_data_id}}", @Name = "{{lakehouse_name}}"
GO


-- ------------------------------
-- From notebook cell 71
-- ------------------------------

-- Upsert LandingzoneEntity (demo)
DECLARE @LandingzoneEntityIdInternal INT = (SELECT LandingzoneEntityId FROM integration.LandingzoneEntity WHERE SourceSchema = 'in' and SourceName = 'customer')
        DECLARE @DataSourceIdInternal INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = 'LH_DATA_LANDINGZONE' and Type='ONELAKE_TABLES_01')
        DECLARE @LakehouseIdInternal INT = (SELECT top 1 LakehouseId FROM integration.Lakehouse WHERE Name = 'LH_DATA_LANDINGZONE')
        EXECUTE [integration].[sp_UpsertLandingzoneEntity] 
            @LandingzoneEntityId = @LandingzoneEntityIdInternal
            ,@DataSourceId = @DataSourceIdInternal
            ,@LakehouseId = @LakehouseIdInternal
            ,@SourceSchema = 'in'
            ,@SourceName = 'customer'
            ,@SourceCustomSelect = ''
            ,@FileName = 'customer'
            ,@FilePath = 'fmd'
            ,@FileType = 'parquet'
            ,@IsIncremental = 0
            ,@IsIncrementalColumn = ''
            ,@IsActive = 1
            ,@CustomNotebookName = ''
GO


-- Upsert BronzeLayerEntity (demo)
DECLARE @LandingzoneEntityIdInternal INT = (SELECT LandingzoneEntityId FROM integration.LandingzoneEntity WHERE SourceSchema = 'in' and SourceName = 'customer')
        DECLARE @BronzeLayerEntityIdInternal INT = (SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE [Schema] = 'in' and [Name] = 'customer')
        DECLARE @LakehouseIdInternal INT = (SELECT top 1 LakehouseId FROM integration.Lakehouse WHERE Name = 'LH_BRONZE_LAYER')
        EXECUTE [integration].[sp_UpsertBronzeLayerEntity] 
            @BronzeLayerEntityId = @BronzeLayerEntityIdInternal
            ,@LandingzoneEntityId = @LandingzoneEntityIdInternal
            ,@Schema = 'in'
            ,@Name = 'customer'
            ,@FileType = 'Delta'
            ,@LakehouseId = @LakehouseIdInternal
            ,@PrimaryKeys = 'CustomerId'
            ,@IsActive = 1
GO


-- Upsert SilverLayerEntity (demo)
DECLARE @BronzeLayerEntityIdInternal INT = (SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE [Schema] = 'in' and [Name] = 'customer')
        DECLARE @SilverLayerEntityIdInternal INT = (SELECT SilverLayerEntityId FROM integration.SilverLayerEntity WHERE [Schema] = 'in' and [Name] = 'customer')
        DECLARE @LakehouseIdInternal INT = (SELECT top 1 LakehouseId FROM integration.Lakehouse WHERE Name = 'LH_SILVER_LAYER')
        EXECUTE [integration].[sp_UpsertSilverLayerEntity] 
            @SilverLayerEntityId = @SilverLayerEntityIdInternal
            ,@BronzeLayerEntityId = @BronzeLayerEntityIdInternal
            ,@LakehouseId = @LakehouseIdInternal
            ,@Name = 'customer'
            ,@Schema = 'in'
            ,@FileType = 'delta'
            ,@IsActive = 1
GO
