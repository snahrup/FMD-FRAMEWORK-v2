"""
FMD v3 Engine — OneLake I/O helpers for reading/writing parquet and Delta tables.

Two modes:
    1. Filesystem (default): Read/write via OneLake Explorer local mount.
       No auth needed — OneLake Explorer syncs to Fabric automatically.
    2. ADLS SDK: Read/write via REST API with SP token auth.
       Used when no local mount is available (e.g. cloud VM).

Path conventions:
    Parquet (LZ):  {lakehouse_id}/Files/{namespace}/{table}.parquet
    Delta (Bronze/Silver): {lakehouse_id}/Tables/{namespace}/{table}/

Filesystem paths:
    {mount_path}/{lakehouse_name}.Lakehouse/Files/{namespace}/{table}.parquet
    {mount_path}/{lakehouse_name}.Lakehouse/Tables/{namespace}/{table}/
"""

import io
import logging
import os
import time
from pathlib import Path
from typing import Optional

import polars as pl

from engine.models import EngineConfig

log = logging.getLogger("fmd.onelake_io")


def _strip_tz(df: pl.DataFrame) -> pl.DataFrame:
    """Cast timezone-aware datetimes to naive UTC.

    Delta protocol requires the timestampNtz feature for tz-aware columns,
    and OneLake/Fabric handles UTC implicitly.
    """
    cast_cols = []
    for col_name, dtype in zip(df.columns, df.dtypes):
        if isinstance(dtype, pl.Datetime) and dtype.time_zone is not None:
            cast_cols.append(pl.col(col_name).dt.replace_time_zone(None))
    if cast_cols:
        df = df.with_columns(cast_cols)
    return df


class OneLakeIO:
    """Read and write parquet/Delta files on OneLake.

    When onelake_mount_path is configured, uses local filesystem I/O
    through OneLake Explorer — no auth tokens needed, dramatically faster.

    Falls back to ADLS SDK when no mount path is set.

    Usage::

        onio = OneLakeIO(config, token_provider)
        df = onio.read_parquet(workspace_id, "lh_guid/Files/MES/TABLE.parquet")
        onio.write_delta(workspace_id, "lh_guid/Tables/MES/TABLE", df)
    """

    def __init__(self, config: EngineConfig, token_provider=None):
        self._config = config
        self._token_provider = token_provider
        self._mount_path = getattr(config, "onelake_mount_path", "") or ""
        self._guid_to_name: dict[str, str] = {}

        if self._mount_path:
            self._guid_to_name = self._build_lakehouse_map()
            log.info("OneLakeIO: filesystem mode — mount=%s, %d lakehouses mapped",
                     self._mount_path, len(self._guid_to_name))
        else:
            log.info("OneLakeIO: ADLS SDK mode")

        # Lazy ADLS client (only created if needed)
        self._service_client = None
        self._credential = None

    @property
    def _filesystem_mode(self) -> bool:
        return bool(self._mount_path)

    def _build_lakehouse_map(self) -> dict[str, str]:
        """Build GUID → lakehouse name mapping from SQLite control-plane DB."""
        try:
            from dashboard.app.api import db as fmd_db
            rows = fmd_db.query("SELECT LakehouseGuid, Name FROM lakehouses")
            guid_map = {}
            for row in rows:
                guid = str(row["LakehouseGuid"]).upper()
                name = row["Name"]
                guid_map[guid] = name
            return guid_map
        except Exception as exc:
            log.warning("Failed to build lakehouse map from SQLite: %s", exc)
            return {}

    def _resolve_local_path(self, path: str) -> Optional[str]:
        """Resolve a GUID-based path to a local filesystem path.

        Input:  "F06393CA-C024-435F-8D7F-9F5AA3BB4CB3/Tables/MES/CUSCONGB"
        Output: "C:/Users/.../OneLake - Microsoft/INTEGRATION DATA (D)/LH_BRONZE_LAYER.Lakehouse/Tables/MES/CUSCONGB"
        """
        # Extract lakehouse GUID (first path segment)
        parts = path.replace("\\", "/").split("/", 1)
        if len(parts) < 2:
            return None

        guid = parts[0].upper()
        rest = parts[1]

        lakehouse_name = self._guid_to_name.get(guid)
        if not lakehouse_name:
            log.error("No lakehouse name found for GUID %s", guid)
            return None

        local_path = os.path.normpath(os.path.join(
            self._mount_path, f"{lakehouse_name}.Lakehouse", rest
        ))
        return local_path

    def _ensure_adls_client(self):
        """Lazy-init ADLS client (only for SDK mode)."""
        if self._service_client is None:
            from azure.storage.filedatalake import DataLakeServiceClient
            from engine.auth import SCOPE_ONELAKE
            self._credential = self._token_provider.get_datalake_credential()
            self._service_client = DataLakeServiceClient(
                account_url=self._config.onelake_account_url,
                credential=self._credential,
            )

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def read_parquet(self, workspace_id: str, path: str) -> Optional[pl.DataFrame]:
        """Read a single parquet file from OneLake into a Polars DataFrame."""
        if self._filesystem_mode:
            return self._read_parquet_fs(path)
        return self._read_parquet_adls(workspace_id, path)

    def _read_parquet_fs(self, path: str) -> Optional[pl.DataFrame]:
        """Read parquet from local OneLake Explorer mount."""
        t0 = time.perf_counter()
        local_path = self._resolve_local_path(path)
        if not local_path:
            return None
        try:
            if not os.path.exists(local_path):
                log.info("Parquet file does not exist: %s", local_path)
                return None
            df = pl.read_parquet(local_path)
            elapsed = time.perf_counter() - t0
            size_kb = os.path.getsize(local_path) / 1024
            log.info("Read parquet (fs) %s: %d rows, %.1f KB in %.3fs",
                     os.path.basename(local_path), len(df), size_kb, elapsed)
            return df
        except Exception as exc:
            log.error("Failed to read parquet (fs) %s: %s", local_path, exc)
            return None

    def _read_parquet_adls(self, workspace_id: str, path: str) -> Optional[pl.DataFrame]:
        """Read parquet via ADLS SDK."""
        t0 = time.perf_counter()
        try:
            self._ensure_adls_client()
            fs = self._service_client.get_file_system_client(workspace_id)
            file_client = fs.get_file_client(path)
            download = file_client.download_file()
            data = download.readall()
            df = pl.read_parquet(io.BytesIO(data))
            elapsed = time.perf_counter() - t0
            log.info("Read parquet (adls) %s: %d rows, %.1f KB in %.1fs",
                     path.split("/")[-1], len(df), len(data) / 1024, elapsed)
            return df
        except Exception as exc:
            log.error("Failed to read parquet (adls) %s: %s", path, exc)
            return None

    def read_delta(self, workspace_id: str, table_path: str) -> Optional[pl.DataFrame]:
        """Read a Delta table from OneLake into a Polars DataFrame."""
        if self._filesystem_mode:
            return self._read_delta_fs(table_path)
        return self._read_delta_adls(workspace_id, table_path)

    def _read_delta_fs(self, table_path: str) -> Optional[pl.DataFrame]:
        """Read Delta table from local OneLake Explorer mount.

        Uses a custom reader that parses _delta_log and reads parquet files
        directly, because delta-rs has issues with Windows paths containing
        spaces (e.g. 'OneLake - Microsoft').
        """
        t0 = time.perf_counter()
        local_path = self._resolve_local_path(table_path)
        if not local_path:
            return None
        try:
            if not os.path.exists(local_path):
                log.info("Delta table does not exist yet (first load): %s", local_path)
                return None
            delta_log = os.path.join(local_path, "_delta_log")
            if not os.path.exists(delta_log):
                log.info("Delta table %s has no _delta_log (first load)", local_path)
                return None

            # Parse delta log to find active parquet files
            active_files = self._parse_delta_log(delta_log)
            if not active_files:
                log.info("Delta table %s has no active files", local_path)
                return None

            # Read each parquet file and concat
            dfs = []
            for rel_path in active_files:
                full_path = os.path.join(local_path, rel_path)
                if os.path.exists(full_path):
                    dfs.append(pl.read_parquet(full_path))
                else:
                    log.warning("Parquet file not synced yet: %s", rel_path)

            if not dfs:
                log.info("Delta table %s: no readable parquet files", local_path)
                return None

            df = pl.concat(dfs, how="diagonal_relaxed") if len(dfs) > 1 else dfs[0]
            elapsed = time.perf_counter() - t0
            log.info("Read delta (fs) %s: %d rows from %d files in %.3fs",
                     os.path.basename(local_path), len(df), len(dfs), elapsed)
            return df
        except Exception as exc:
            log.error("Failed to read delta (fs) %s: %s", local_path, exc)
            return None

    @staticmethod
    def _parse_delta_log(delta_log_path: str) -> list[str]:
        """Parse Delta transaction log to find currently active parquet files.

        Reads all JSON log files in order, tracking adds and removes
        to determine which parquet files are currently active.
        """
        import json as _json

        log_files = sorted(
            f for f in os.listdir(delta_log_path) if f.endswith(".json")
        )
        if not log_files:
            return []

        active: set[str] = set()
        for log_file in log_files:
            with open(os.path.join(delta_log_path, log_file), encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    entry = _json.loads(line)
                    if "add" in entry:
                        active.add(entry["add"]["path"])
                    if "remove" in entry:
                        active.discard(entry["remove"]["path"])

        return sorted(active)

    def _read_delta_adls(self, workspace_id: str, table_path: str) -> Optional[pl.DataFrame]:
        """Read Delta table via ADLS SDK."""
        t0 = time.perf_counter()
        uri = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{table_path}"
        try:
            from engine.auth import SCOPE_ONELAKE
            token = self._token_provider.get_token(SCOPE_ONELAKE)
            storage_options = {"bearer_token": token, "use_fabric_endpoint": "true"}
            df = pl.read_delta(uri, storage_options=storage_options)
            elapsed = time.perf_counter() - t0
            log.info("Read delta (adls) %s: %d rows in %.1fs",
                     table_path.split("/")[-1], len(df), elapsed)
            return df
        except Exception as exc:
            error_msg = str(exc)
            if "not found" in error_msg.lower() or "FileNotFoundError" in error_msg:
                log.info("Delta table %s does not exist yet (first load)", table_path)
                return None
            log.error("Failed to read delta (adls) %s: %s", table_path, exc)
            return None

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def write_delta(
        self,
        workspace_id: str,
        table_path: str,
        df: pl.DataFrame,
        mode: str = "overwrite",
    ) -> bool:
        """Write a Polars DataFrame as a Delta table to OneLake."""
        if self._filesystem_mode:
            return self._write_delta_fs(table_path, df, mode)
        return self._write_delta_adls(workspace_id, table_path, df, mode)

    def _write_delta_fs(self, table_path: str, df: pl.DataFrame, mode: str) -> bool:
        """Write Delta table to local OneLake Explorer mount."""
        t0 = time.perf_counter()
        local_path = self._resolve_local_path(table_path)
        if not local_path:
            return False
        try:
            # Ensure parent directories exist
            os.makedirs(local_path, exist_ok=True)

            # Cast timezone-aware datetimes to naive UTC (Delta protocol
            # requires the timestampNtz feature for tz-aware columns, and
            # OneLake/Fabric handles UTC implicitly).
            df = _strip_tz(df)

            expected_rows = len(df)

            # schema_mode="overwrite" replaces the existing table schema
            # entirely, which handles tables created by Fabric notebooks
            # with different protocol versions.
            df.write_delta(
                local_path, mode=mode,
                delta_write_options={"schema_mode": "overwrite"},
            )

            # Write verification — read back row count
            verified = self._verify_write(local_path, expected_rows, "fs")

            elapsed = time.perf_counter() - t0
            log.info("Wrote delta (fs) %s: %d rows in %.3fs (mode=%s, verified=%s)",
                     os.path.basename(local_path), expected_rows, elapsed, mode, verified)
            return True
        except Exception as exc:
            log.error("Failed to write delta (fs) %s: %s", local_path, exc)
            return False

    def _write_delta_adls(
        self, workspace_id: str, table_path: str, df: pl.DataFrame, mode: str
    ) -> bool:
        """Write Delta table via ADLS SDK."""
        t0 = time.perf_counter()
        uri = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{table_path}"
        try:
            df = _strip_tz(df)
            expected_rows = len(df)

            from engine.auth import SCOPE_ONELAKE
            token = self._token_provider.get_token(SCOPE_ONELAKE)
            storage_options = {"bearer_token": token, "use_fabric_endpoint": "true"}
            df.write_delta(
                uri, mode=mode, storage_options=storage_options,
                delta_write_options={"schema_mode": "overwrite"},
            )

            # Write verification — read back row count from ADLS
            verified = self._verify_write_adls(uri, expected_rows, storage_options)

            elapsed = time.perf_counter() - t0
            log.info("Wrote delta (adls) %s: %d rows in %.1fs (mode=%s, verified=%s)",
                     table_path.split("/")[-1], expected_rows, elapsed, mode, verified)
            return True
        except Exception as exc:
            log.error("Failed to write delta (adls) %s: %s", table_path, exc)
            return False

    def delta_table_exists(self, workspace_id: str, table_path: str) -> bool:
        """Check if a Delta table exists on OneLake."""
        if self._filesystem_mode:
            local_path = self._resolve_local_path(table_path)
            if not local_path:
                return False
            return os.path.exists(os.path.join(local_path, "_delta_log"))

        uri = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{table_path}"
        try:
            from engine.auth import SCOPE_ONELAKE
            token = self._token_provider.get_token(SCOPE_ONELAKE)
            storage_options = {"bearer_token": token, "use_fabric_endpoint": "true"}
            from deltalake import DeltaTable
            DeltaTable(uri, storage_options=storage_options)
            return True
        except Exception as e:
            log.debug("Delta table check failed for %s: %s", table_path, e)
            return False

    # ------------------------------------------------------------------
    # Write Verification & Compaction
    # ------------------------------------------------------------------

    def _verify_write(self, local_path: str, expected_rows: int, label: str) -> bool:
        """Read back a local Delta table and verify row count matches expected."""
        try:
            from deltalake import DeltaTable
            dt = DeltaTable(local_path)
            actual = len(dt.to_pyarrow_table())
            if actual != expected_rows:
                log.warning("Write verification MISMATCH (%s) %s: expected %d, got %d",
                            label, os.path.basename(local_path), expected_rows, actual)
                return False
            return True
        except Exception as exc:
            log.warning("Write verification FAILED (%s) %s: %s", label, local_path, exc)
            return False

    def _verify_write_adls(self, uri: str, expected_rows: int, storage_options: dict) -> bool:
        """Read back an ADLS Delta table and verify row count matches expected."""
        try:
            from deltalake import DeltaTable
            dt = DeltaTable(uri, storage_options=storage_options)
            actual = len(dt.to_pyarrow_table())
            if actual != expected_rows:
                log.warning("Write verification MISMATCH (adls) %s: expected %d, got %d",
                            uri.split("/")[-1], expected_rows, actual)
                return False
            return True
        except Exception as exc:
            log.warning("Write verification FAILED (adls): %s", exc)
            return False

    def compact_delta(self, workspace_id: str, table_path: str) -> bool:
        """Run Delta compaction (optimize + vacuum) on a table.

        Called periodically (every N writes) to merge small files and
        remove old versions. Interval controlled by config.delta_compact_interval.
        """
        try:
            from deltalake import DeltaTable
            from datetime import timedelta

            retention = timedelta(days=self._config.delta_vacuum_retention_days)

            if self._filesystem_mode:
                local_path = self._resolve_local_path(table_path)
                if not local_path or not os.path.exists(os.path.join(local_path, "_delta_log")):
                    return False
                dt = DeltaTable(local_path)
            else:
                uri = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{table_path}"
                from engine.auth import SCOPE_ONELAKE
                token = self._token_provider.get_token(SCOPE_ONELAKE)
                storage_options = {"bearer_token": token, "use_fabric_endpoint": "true"}
                dt = DeltaTable(uri, storage_options=storage_options)

            # Optimize: merge small parquet files into larger ones
            dt.optimize.compact()

            # Vacuum: remove files older than retention period
            dt.vacuum(retention_hours=int(retention.total_seconds() / 3600),
                      enforce_retention_duration=False)

            table_name = table_path.split("/")[-1]
            log.info("Delta compaction complete: %s (vacuum retention=%dd)",
                     table_name, self._config.delta_vacuum_retention_days)
            return True
        except Exception as exc:
            log.warning("Delta compaction failed for %s: %s", table_path, exc)
            return False
