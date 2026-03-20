"""
FMD v3 Engine — Write Parquet files to OneLake Landing Zone.

Two modes (automatic, no config needed):
    1. Filesystem (primary): Write directly to OneLake Explorer local mount.
       No auth needed — OneLake Explorer syncs to Fabric automatically.
    2. ADLS SDK (fallback): Upload via REST API with SP token auth.
       Used when no local mount is available (e.g. cloud VM).

Path convention (see ARCHITECTURE.md):
    {lakehouse_id}/Files/{Namespace}/{Table}.parquet
    NO schema prefix. NO date partitioning. Flat — no subfolder per table.
"""

import logging
import os
import shutil
import time
import uuid
from datetime import datetime
from typing import Optional

from engine.auth import TokenProvider
from engine.models import EngineConfig, Entity, RunResult

log = logging.getLogger("fmd.loader")


def _is_valid_uuid(value: str) -> bool:
    """Check if a string is a valid UUID v4."""
    if not value or not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError):
        return False


class OneLakeLoader:
    """Upload Parquet byte buffers to OneLake Landing Zone.

    Writes to local OneLake mount when available (fast, no auth).
    Falls back to ADLS SDK when mount is not available.

    Usage::

        loader = OneLakeLoader(config, token_provider)
        result = loader.upload(entity, parquet_bytes, run_id)
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._token_provider = token_provider
        self._mount_path = getattr(config, "onelake_mount_path", "") or ""
        self._guid_to_name: dict[str, str] = {}

        # FIXED: CRITICAL BUG #7 — Periodic lakehouse map refresh
        # Rebuild map every N entities to catch new lakehouses created during load
        self._map_refresh_interval = 50
        self._map_refresh_counter = 0

        # Build GUID → lakehouse name mapping for filesystem mode
        if self._mount_path:
            self._guid_to_name = self._build_lakehouse_map()
            log.info("OneLakeLoader: filesystem mode — mount=%s, %d lakehouses",
                     self._mount_path, len(self._guid_to_name))
        else:
            log.info("OneLakeLoader: ADLS SDK mode (no local mount)")

        # Lazy ADLS client (only created if filesystem write fails or mount unavailable)
        self._service_client = None
        self._credential = None

    def _build_lakehouse_map(self) -> dict[str, str]:
        """Build GUID → lakehouse name mapping from SQLite control-plane DB."""
        try:
            from dashboard.app.api import db as fmd_db
            rows = fmd_db.query("SELECT LakehouseGuid, Name FROM lakehouses")
            guid_map = {}
            for row in rows:
                guid = str(row["LakehouseGuid"]).upper()
                guid_map[guid] = row["Name"]
            return guid_map
        except Exception as exc:
            log.warning("Failed to build lakehouse map: %s", exc)
            return {}

    def _resolve_local_dir(self, lakehouse_id: str, namespace: str) -> Optional[str]:
        """Resolve a lakehouse GUID + namespace to a local filesystem directory path."""
        guid = lakehouse_id.upper()
        lakehouse_name = self._guid_to_name.get(guid)
        if not lakehouse_name:
            log.warning("No lakehouse name found for GUID %s", guid)
            return None
        return os.path.normpath(os.path.join(
            self._mount_path, f"{lakehouse_name}.Lakehouse", "Files", namespace
        ))

    def _ensure_adls_client(self):
        """Lazy-init ADLS client (only for SDK fallback)."""
        if self._service_client is None:
            from azure.storage.filedatalake import DataLakeServiceClient
            self._credential = self._token_provider.get_datalake_credential()
            self._service_client = DataLakeServiceClient(
                account_url=self._config.onelake_account_url,
                credential=self._credential,
            )

    def upload(
        self,
        entity: Entity,
        parquet_bytes: bytes,
        run_id: str = "",
        timestamp: Optional[datetime] = None,
    ) -> RunResult:
        """Upload Parquet bytes to OneLake Landing Zone.

        Tries local filesystem first, falls back to ADLS SDK.
        Periodically refreshes lakehouse map to catch new lakehouses.
        """
        # Periodically rebuild lakehouse map (every 50 entities)
        self._map_refresh_counter += 1
        if self._map_refresh_counter >= self._map_refresh_interval and self._mount_path:
            old_count = len(self._guid_to_name)
            self._guid_to_name = self._build_lakehouse_map()
            new_count = len(self._guid_to_name)
            if new_count != old_count:
                log.info("Lakehouse map refreshed: %d → %d lakehouses", old_count, new_count)
            self._map_refresh_counter = 0

        lakehouse_id = entity.lakehouse_guid or self._config.lz_lakehouse_id
        namespace = entity.namespace or entity.source_database
        target_name = entity.source_name.strip()
        file_name = f"{target_name}.parquet"

        # Try filesystem first
        if self._mount_path:
            result = self._upload_filesystem(
                entity, parquet_bytes, run_id,
                lakehouse_id, namespace, file_name,
            )
            if result.status == "succeeded":
                return result
            # Filesystem failed — fall through to ADLS
            log.warning("[%s] Filesystem write failed for entity %d, falling back to ADLS: %s",
                        run_id[:8] if run_id else "?", entity.id, result.error)

        # ADLS SDK fallback
        return self._upload_adls(
            entity, parquet_bytes, run_id,
            lakehouse_id, namespace, file_name,
        )

    def _upload_filesystem(
        self,
        entity: Entity,
        parquet_bytes: bytes,
        run_id: str,
        lakehouse_id: str,
        namespace: str,
        file_name: str,
    ) -> RunResult:
        """Write parquet file directly to local OneLake mount."""
        t0 = time.perf_counter()
        local_dir = self._resolve_local_dir(lakehouse_id, namespace)
        if not local_dir:
            return RunResult(
                entity_id=entity.id, layer="landing", status="failed",
                error=f"Cannot resolve local path for lakehouse {lakehouse_id[:8]}",
            )

        local_path = os.path.join(local_dir, file_name)

        log.info(
            "[%s] Uploading entity %d to OneLake (fs): %s (%d bytes)",
            run_id[:8] if run_id else "?", entity.id, local_path, len(parquet_bytes),
        )

        try:
            os.makedirs(local_dir, exist_ok=True)

            # Pre-check disk space — need at least 2x the file size as buffer
            try:
                disk = shutil.disk_usage(local_dir)
                required = len(parquet_bytes) * 2
                if disk.free < required:
                    elapsed = time.perf_counter() - t0
                    return RunResult(
                        entity_id=entity.id, layer="landing", status="failed",
                        duration_seconds=round(elapsed, 2),
                        error=f"Insufficient disk space: {disk.free // (1024*1024)}MB free, need {required // (1024*1024)}MB",
                        error_suggestion="Free up disk space on the OneLake mount drive, or switch to ADLS SDK mode.",
                    )
            except OSError as e:
                log.debug("Disk space check failed, proceeding anyway: %s", e)

            with open(local_path, "wb") as f:
                f.write(parquet_bytes)

            elapsed = time.perf_counter() - t0
            log.info(
                "[%s] Entity %d written (fs): %.1f KB in %.3fs to %s",
                run_id[:8] if run_id else "?", entity.id,
                len(parquet_bytes) / 1024, elapsed, local_path,
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
            return RunResult(
                entity_id=entity.id,
                layer="landing",
                status="failed",
                duration_seconds=round(elapsed, 2),
                error=str(exc),
            )

    def _upload_adls(
        self,
        entity: Entity,
        parquet_bytes: bytes,
        run_id: str,
        lakehouse_id: str,
        namespace: str,
        file_name: str,
    ) -> RunResult:
        """Upload parquet via ADLS SDK (fallback when filesystem unavailable).

        FIXED: CRITICAL BUG #9 — Validate workspace and lakehouse GUIDs before upload.
        Prevents data being written to wrong workspace.
        """
        t0 = time.perf_counter()
        workspace_id = entity.workspace_guid or self._config.workspace_data_id

        # Validate workspace GUID is valid UUID format
        if not _is_valid_uuid(workspace_id):
            elapsed = time.perf_counter() - t0
            return RunResult(
                entity_id=entity.id,
                layer="landing",
                status="failed",
                duration_seconds=round(elapsed, 2),
                error=f"Invalid workspace_guid: '{workspace_id}' is not a valid UUID",
                error_suggestion="Check workspace_guid in entity metadata or config.workspace_data_id"
            )

        # Validate lakehouse GUID is valid UUID format
        if not _is_valid_uuid(lakehouse_id):
            elapsed = time.perf_counter() - t0
            return RunResult(
                entity_id=entity.id,
                layer="landing",
                status="failed",
                duration_seconds=round(elapsed, 2),
                error=f"Invalid lakehouse_guid: '{lakehouse_id}' is not a valid UUID",
                error_suggestion="Check lakehouse_guid in entity metadata or config.lz_lakehouse_id"
            )

        directory_path = f"{lakehouse_id}/Files/{namespace}"
        file_path = f"{directory_path}/{file_name}"

        log.info(
            "[%s] Uploading entity %d to OneLake (adls): ws=%s lh=%s path=%s (%d bytes)",
            run_id[:8] if run_id else "?", entity.id,
            workspace_id[:8], lakehouse_id[:8], file_path, len(parquet_bytes),
        )

        # Retry loop for transient ADLS failures (429, 503, timeouts)
        max_attempts = 3
        last_error = ""
        for attempt in range(1, max_attempts + 1):
            try:
                self._ensure_adls_client()
                fs_client = self._service_client.get_file_system_client(file_system=workspace_id)
                dir_client = fs_client.get_directory_client(directory_path)

                try:
                    dir_client.create_directory()
                except Exception as e:
                    log.debug("Directory create (may already exist): %s", e)

                file_client = dir_client.get_file_client(file_name)
                file_client.create_file()
                file_client.append_data(parquet_bytes, offset=0, length=len(parquet_bytes))
                file_client.flush_data(len(parquet_bytes))

                elapsed = time.perf_counter() - t0
                log.info(
                    "[%s] Entity %d uploaded (adls): %.1f KB in %.1fs to %s",
                    run_id[:8] if run_id else "?", entity.id,
                    len(parquet_bytes) / 1024, elapsed, file_path,
                )
                return RunResult(
                    entity_id=entity.id,
                    layer="landing",
                    status="succeeded",
                    bytes_transferred=len(parquet_bytes),
                    duration_seconds=round(elapsed, 2),
                )
            except Exception as exc:
                last_error = str(exc)
                error_lower = last_error.lower()
                is_retryable = any(p in error_lower for p in (
                    "429", "503", "throttl", "too many requests",
                    "temporarily unavailable", "timeout", "timed out",
                    "connection reset", "broken pipe",
                ))
                if attempt < max_attempts and is_retryable:
                    wait = attempt * 10  # 10s, 20s backoff
                    log.warning(
                        "[%s] Entity %d ADLS upload retry %d/%d in %ds: %s",
                        run_id[:8] if run_id else "?", entity.id,
                        attempt, max_attempts, wait, last_error[:100],
                    )
                    time.sleep(wait)
                else:
                    break

        elapsed = time.perf_counter() - t0
        log.error(
            "[%s] Entity %d upload failed (adls): %s",
            run_id[:8] if run_id else "?", entity.id, last_error,
        )
        return RunResult(
            entity_id=entity.id,
            layer="landing",
            status="failed",
            duration_seconds=round(elapsed, 2),
            error=last_error,
            error_suggestion=self._diagnose_upload_error(last_error, entity),
        )

    def upload_entity(
        self,
        entity: Entity,
        parquet_bytes: bytes,
        run_id: str = "",
    ) -> tuple[RunResult, str, str]:
        """Upload and return (result, file_path, file_name) for metadata updates."""
        namespace = entity.namespace or entity.source_database
        target_name = entity.source_name.strip()
        file_name = f"{target_name}.parquet"
        file_path = namespace

        result = self.upload(entity, parquet_bytes, run_id)
        return result, file_path, file_name

    def ping(self) -> bool:
        """Test OneLake connectivity."""
        # Filesystem mode: check if mount exists
        if self._mount_path:
            try:
                lz_dir = None
                for guid, name in self._guid_to_name.items():
                    lz_path = os.path.join(self._mount_path, f"{name}.Lakehouse", "Files")
                    if os.path.isdir(lz_path):
                        return True
                # No lakehouse dirs found — try ADLS
            except Exception as e:
                log.debug("Filesystem lakehouse check failed, falling back to ADLS: %s", e)

        # ADLS fallback
        try:
            self._ensure_adls_client()
            fs_client = self._service_client.get_file_system_client(self._config.workspace_data_id)
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
