"""
FMD v3 Engine — Write Parquet files to OneLake Landing Zone.

Uses the Azure Data Lake Storage (ADLS) Gen2 API via the
azure-storage-file-datalake SDK.  OneLake exposes a standard ADLS
endpoint at https://onelake.dfs.fabric.microsoft.com.

Path convention (see ARCHITECTURE.md):
    {lakehouse_id}/Files/{Namespace}/{Table}.parquet
    NO schema prefix. NO date partitioning. Flat — no subfolder per table.
"""

import logging
import time
from datetime import datetime
from typing import Optional

from azure.storage.filedatalake import DataLakeServiceClient, FileSystemClient

from engine.auth import TokenProvider
from engine.models import EngineConfig, Entity, RunResult

log = logging.getLogger("fmd.loader")


class OneLakeLoader:
    """Upload Parquet byte buffers to OneLake Landing Zone.

    Usage::

        loader = OneLakeLoader(config, token_provider)
        result = loader.upload(entity, parquet_bytes, run_id)
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._credential = token_provider.get_datalake_credential()
        self._service_client: Optional[DataLakeServiceClient] = None

    @property
    def service_client(self) -> DataLakeServiceClient:
        """Lazily initialise the ADLS service client."""
        if self._service_client is None:
            self._service_client = DataLakeServiceClient(
                account_url=self._config.onelake_account_url,
                credential=self._credential,
            )
        return self._service_client

    def get_filesystem(self, workspace_id: str) -> FileSystemClient:
        """Get a filesystem client for a workspace.

        In OneLake, the workspace ID is the filesystem (container) name.
        """
        return self.service_client.get_file_system_client(file_system=workspace_id)

    def upload(
        self,
        entity: Entity,
        parquet_bytes: bytes,
        run_id: str = "",
        timestamp: Optional[datetime] = None,
    ) -> RunResult:
        """Upload Parquet bytes to OneLake Landing Zone.

        Parameters
        ----------
        entity : Entity
            The entity (determines the target path).
        parquet_bytes : bytes
            The Parquet file content.
        run_id : str
            Current run ID for logging.
        timestamp : optional
            Override the file timestamp (defaults to utcnow).

        Returns
        -------
        RunResult
            Upload outcome with byte count and duration.
        """
        t0 = time.perf_counter()
        ts = timestamp or datetime.utcnow()
        ts_str = ts.strftime("%Y%m%d%H%M%S")

        # Build OneLake path — see ARCHITECTURE.md
        # Format: {lakehouse_id}/Files/{Namespace}/{Table}.parquet  (flat, no subfolder)
        lakehouse_id = entity.lakehouse_guid or self._config.lz_lakehouse_id
        workspace_id = entity.workspace_guid or self._config.workspace_data_id
        namespace = entity.namespace or entity.source_database
        target_name = entity.source_name.strip()
        file_name = f"{target_name}.parquet"
        directory_path = f"{lakehouse_id}/Files/{namespace}"
        file_path = f"{directory_path}/{file_name}"

        log.info(
            "[%s] Uploading entity %d to OneLake: ws=%s lh=%s path=%s (%d bytes)",
            run_id[:8] if run_id else "?",
            entity.id,
            workspace_id[:8],
            lakehouse_id[:8],
            file_path,
            len(parquet_bytes),
        )

        try:
            fs_client = self.get_filesystem(workspace_id)
            dir_client = fs_client.get_directory_client(directory_path)

            # Create directory if it doesn't exist
            try:
                dir_client.create_directory()
            except Exception:
                # Directory may already exist — that's fine
                pass

            file_client = dir_client.get_file_client(file_name)
            file_client.create_file()
            file_client.append_data(parquet_bytes, offset=0, length=len(parquet_bytes))
            file_client.flush_data(len(parquet_bytes))

            elapsed = time.perf_counter() - t0
            log.info(
                "[%s] Entity %d uploaded: %.1f KB in %.1fs to %s",
                run_id[:8] if run_id else "?",
                entity.id,
                len(parquet_bytes) / 1024,
                elapsed,
                file_path,
            )

            return RunResult(
                entity_id=entity.id,
                layer="landing",
                status="succeeded",
                bytes_transferred=len(parquet_bytes),
                duration_seconds=round(elapsed, 2),
            )

        except Exception as exc:
            elapsed = time.perf_counter() - t0
            error_msg = str(exc)
            log.error(
                "[%s] Entity %d upload failed: %s",
                run_id[:8] if run_id else "?",
                entity.id,
                error_msg,
            )
            return RunResult(
                entity_id=entity.id,
                layer="landing",
                status="failed",
                duration_seconds=round(elapsed, 2),
                error=error_msg,
                error_suggestion=self._diagnose_upload_error(error_msg, entity),
            )

    def upload_entity(
        self,
        entity: Entity,
        parquet_bytes: bytes,
        run_id: str = "",
    ) -> tuple[RunResult, str, str]:
        """Upload and return (result, file_path, file_name) for metadata updates.

        This is a convenience wrapper that also returns the path/name values
        needed to update execution.sp_UpsertPipelineLandingzoneEntity.
        """
        ts = datetime.utcnow()
        namespace = entity.namespace or entity.source_database
        target_name = entity.source_name.strip()
        file_name = f"{target_name}.parquet"
        file_path = namespace  # Just the namespace folder — see ARCHITECTURE.md

        result = self.upload(entity, parquet_bytes, run_id, timestamp=ts)
        return result, file_path, file_name

    def ping(self) -> bool:
        """Test OneLake connectivity by listing the workspace filesystem."""
        try:
            fs_client = self.get_filesystem(self._config.workspace_data_id)
            # Just try to get properties — fast and lightweight
            fs_client.get_file_system_properties()
            return True
        except Exception as exc:
            log.warning("OneLake ping failed: %s", exc)
            return False

    @staticmethod
    def _diagnose_upload_error(error_msg: str, entity: Entity) -> str:
        """Translate ADLS errors into actionable suggestions."""
        msg_lower = error_msg.lower()

        if "forbidden" in msg_lower or "403" in error_msg:
            return (
                "OneLake returned 403 Forbidden. Check that the Service Principal has "
                "Contributor role on the DATA workspace."
            )

        if "not found" in msg_lower or "404" in error_msg:
            return (
                "OneLake path not found. Verify the workspace and lakehouse GUIDs in config."
            )

        if "timeout" in msg_lower:
            return (
                "Upload timed out. The file may be too large for a single upload. "
                "Consider reducing chunk_rows to produce smaller Parquet files."
            )

        if "unauthorized" in msg_lower or "401" in error_msg:
            return (
                "OneLake returned 401 Unauthorized. The SP token may have expired. "
                "Check tenant_id/client_id/client_secret in config."
            )

        return f"OneLake upload failed for entity {entity.id}. See error details above."
