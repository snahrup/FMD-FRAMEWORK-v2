CREATE OR ALTER VIEW [reporting].[vw_FmdExecutionStatus]
AS
SELECT
    p.PipelineRunGuid,
    p.PipelineName,
    p.Status AS PipelineStatus,
    p.EventTimeUtc AS PipelineEventTimeUtc,
    c.EntityId,
    c.EntityName,
    c.Status AS CopyStatus,
    c.EventTimeUtc AS CopyEventTimeUtc,
    n.NotebookName,
    n.Status AS NotebookStatus,
    n.EventTimeUtc AS NotebookEventTimeUtc,
    COALESCE(n.ErrorMessage, c.ErrorMessage, p.ErrorMessage) AS ErrorSummary
FROM logging.AuditPipeline p
LEFT JOIN logging.AuditCopyActivity c
    ON c.PipelineRunGuid = p.PipelineRunGuid
LEFT JOIN logging.AuditNotebook n
    ON n.PipelineRunGuid = p.PipelineRunGuid;
GO

-- Example queries
-- SELECT * FROM [reporting].[vw_FmdExecutionStatus] WHERE PipelineRunGuid = '<run-guid>';
-- SELECT TOP 100 * FROM [reporting].[vw_FmdExecutionStatus] WHERE EntityId = '<entity-id>' ORDER BY PipelineEventTimeUtc DESC;
