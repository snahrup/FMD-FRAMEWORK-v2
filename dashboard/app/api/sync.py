"""Fabric SQL → SQLite background sync.

Pulled out of server.py so the server stays under 300 lines.
Called by _start_background_sync() every 30 minutes.
"""
import logging
import time
from datetime import datetime

log = logging.getLogger("fmd.sync")


def sync_fabric_to_sqlite(query_sql_fn, cpdb) -> None:
    """Pull latest data from Fabric SQL into local SQLite control plane DB.

    Args:
        query_sql_fn: callable(sql) → list[dict]  (server.query_sql)
        cpdb:         the control_plane_db module
    """
    sync_start = time.time()
    log.info("Background sync: Fabric SQL → SQLite starting...")
    synced: dict = {}

    _tables = [
        (
            "connections",
            "SELECT ConnectionId, ConnectionGuid, Name, Type, ServerName, "
            "DatabaseName, IsActive FROM integration.Connection",
            cpdb.upsert_connection,
        ),
        (
            "datasources",
            "SELECT ds.DataSourceId, ds.ConnectionId, ds.Name, ds.Namespace, "
            "ds.Type, ds.Description, ds.IsActive FROM integration.DataSource ds",
            cpdb.upsert_datasource,
        ),
        (
            "lakehouses",
            "SELECT LakehouseId, Name, WorkspaceGuid, LakehouseGuid FROM integration.Lakehouse",
            cpdb.upsert_lakehouse,
        ),
        (
            "workspaces",
            "SELECT WorkspaceId, WorkspaceGuid, Name FROM integration.Workspace",
            cpdb.upsert_workspace,
        ),
        (
            "pipelines",
            "SELECT PipelineId, Name, IsActive FROM integration.Pipeline",
            cpdb.upsert_pipeline,
        ),
        (
            "lz_entities",
            "SELECT LandingzoneEntityId, DataSourceId, LakehouseId, SourceSchema, "
            "SourceName, SourceCustomSelect, FileName, FilePath, FileType, "
            "IsIncremental, IsIncrementalColumn, CustomNotebookName, IsActive "
            "FROM integration.LandingzoneEntity",
            cpdb.upsert_lz_entity,
        ),
        (
            "bronze_entities",
            "SELECT BronzeLayerEntityId, LandingzoneEntityId, LakehouseId, "
            "[Schema] AS Schema_, Name, PrimaryKeys, FileType, IsActive "
            "FROM integration.BronzeLayerEntity",
            cpdb.upsert_bronze_entity,
        ),
        (
            "silver_entities",
            "SELECT SilverLayerEntityId, BronzeLayerEntityId, LakehouseId, "
            "[Schema] AS Schema_, Name, FileType, IsActive "
            "FROM integration.SilverLayerEntity",
            cpdb.upsert_silver_entity,
        ),
        (
            "engine_runs",
            "SELECT RunId, Mode, Status, TotalEntities, SucceededEntities, FailedEntities, "
            "SkippedEntities, TotalRowsRead, TotalRowsWritten, TotalBytesTransferred, "
            "TotalDurationSeconds, Layers, EntityFilter, TriggeredBy, ErrorSummary, "
            "StartedAtUtc AS StartedAt, CompletedAtUtc AS EndedAt "
            "FROM execution.EngineRun ORDER BY StartedAtUtc DESC",
            cpdb.upsert_engine_run,
        ),
        (
            "pipeline_audit",
            "SELECT TOP 2000 "
            "CONVERT(NVARCHAR(36), PipelineRunGuid) AS PipelineRunGuid, "
            "PipelineName, EntityLayer, TriggerType, LogType, LogDateTime, LogData, EntityId "
            "FROM logging.PipelineExecution ORDER BY LogDateTime DESC",
            cpdb.insert_pipeline_audit,
        ),
    ]

    for key, sql, fn in _tables:
        try:
            rows = query_sql_fn(sql)
            for r in rows:
                fn(r)
            synced[key] = len(rows)
        except Exception as exc:
            log.warning("Sync %s failed: %s", key, exc)

    # Entity status — unpivot LzStatus/BronzeStatus/SilverStatus per row
    try:
        rows = query_sql_fn(
            "SELECT LandingzoneEntityId, "
            "LzStatus, LzLastLoad, "
            "BronzeStatus, BronzeLastLoad, "
            "SilverStatus, SilverLastLoad, "
            "LastErrorMessage, LastErrorLayer, LastUpdatedBy "
            "FROM execution.EntityStatusSummary"
        )
        status_count = 0
        for r in rows:
            eid = r.get("LandingzoneEntityId")
            err_layer = (r.get("LastErrorLayer") or "").lower()
            for layer, sk, lk in [
                ("landing", "LzStatus", "LzLastLoad"),
                ("bronze", "BronzeStatus", "BronzeLastLoad"),
                ("silver", "SilverStatus", "SilverLastLoad"),
            ]:
                status = r.get(sk)
                if status:
                    err = r.get("LastErrorMessage") if err_layer == layer else None
                    cpdb.upsert_entity_status({
                        "LandingzoneEntityId": eid,
                        "Layer": layer,
                        "Status": status,
                        "LoadEndDateTime": r.get(lk),
                        "ErrorMessage": err,
                        "UpdatedBy": r.get("LastUpdatedBy"),
                    })
                    status_count += 1
        synced["entity_status"] = status_count
    except Exception as exc:
        log.warning("Sync entity status failed: %s", exc)

    try:
        cpdb.set_sync_watermark(datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"))
    except Exception:
        pass

    log.info("Background sync complete in %.1fs: %s", time.time() - sync_start, synced)
