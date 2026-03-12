"""
FMD v3 Engine — OneLake I/O helpers for reading/writing parquet and Delta tables.

Uses the same ADLS SDK + credential adapter as loader.py.
Delta read/write via polars (which uses deltalake under the hood).

Path conventions:
    Parquet (LZ):  {lakehouse_id}/Files/{namespace}/{table}.parquet
    Delta (Bronze/Silver): {lakehouse_id}/Tables/{namespace}/{table}/
"""

import io
import logging
import time
from typing import Optional

import polars as pl
from azure.storage.filedatalake import DataLakeServiceClient

from engine.auth import TokenProvider, SCOPE_ONELAKE
from engine.models import EngineConfig

log = logging.getLogger("fmd.onelake_io")


class OneLakeIO:
    """Read and write parquet/Delta files on OneLake via ADLS SDK.

    Usage::

        onio = OneLakeIO(config, token_provider)
        df = onio.read_parquet(workspace_id, "lh_guid/Files/MES/TABLE.parquet")
        onio.write_delta(workspace_id, "lh_guid/Tables/MES/TABLE", df, mode="merge", ...)
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._token_provider = token_provider
        self._credential = token_provider.get_datalake_credential()
        self._service_client: Optional[DataLakeServiceClient] = None

    @property
    def service_client(self) -> DataLakeServiceClient:
        if self._service_client is None:
            self._service_client = DataLakeServiceClient(
                account_url=self._config.onelake_account_url,
                credential=self._credential,
            )
        return self._service_client

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def read_parquet(self, workspace_id: str, path: str) -> Optional[pl.DataFrame]:
        """Read a single parquet file from OneLake into a Polars DataFrame.

        Parameters
        ----------
        workspace_id : str
            Fabric workspace GUID (= ADLS filesystem/container).
        path : str
            Full path within the workspace, e.g. "{lakehouse_id}/Files/MES/TABLE.parquet".
        """
        t0 = time.perf_counter()
        try:
            fs = self.service_client.get_file_system_client(workspace_id)
            file_client = fs.get_file_client(path)
            download = file_client.download_file()
            data = download.readall()
            df = pl.read_parquet(io.BytesIO(data))
            elapsed = time.perf_counter() - t0
            log.info("Read parquet %s: %d rows, %.1f KB in %.1fs",
                     path.split("/")[-1], len(df), len(data) / 1024, elapsed)
            return df
        except Exception as exc:
            log.error("Failed to read parquet %s: %s", path, exc)
            return None

    def read_delta(self, workspace_id: str, table_path: str) -> Optional[pl.DataFrame]:
        """Read a Delta table from OneLake into a Polars DataFrame.

        Uses the abfss:// URI that polars/deltalake understand natively
        with the storage_options for Azure SP auth.

        Parameters
        ----------
        workspace_id : str
            Fabric workspace GUID.
        table_path : str
            Path within workspace, e.g. "{lakehouse_id}/Tables/MES/TABLE".
        """
        t0 = time.perf_counter()
        uri = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{table_path}"
        try:
            token = self._token_provider.get_token(SCOPE_ONELAKE)
            storage_options = {"bearer_token": token, "use_fabric_endpoint": "true"}
            df = pl.read_delta(uri, storage_options=storage_options)
            elapsed = time.perf_counter() - t0
            log.info("Read delta %s: %d rows in %.1fs",
                     table_path.split("/")[-1], len(df), elapsed)
            return df
        except Exception as exc:
            error_msg = str(exc)
            # Table doesn't exist yet — that's fine for first load
            if "not found" in error_msg.lower() or "FileNotFoundError" in error_msg:
                log.info("Delta table %s does not exist yet (first load)", table_path)
                return None
            log.error("Failed to read delta %s: %s", table_path, exc)
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
        """Write a Polars DataFrame as a Delta table to OneLake.

        Parameters
        ----------
        workspace_id : str
            Fabric workspace GUID.
        table_path : str
            Path within workspace, e.g. "{lakehouse_id}/Tables/MES/TABLE".
        df : pl.DataFrame
            Data to write.
        mode : str
            "overwrite" or "append".
        """
        t0 = time.perf_counter()
        uri = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{table_path}"
        try:
            token = self._token_provider.get_token(SCOPE_ONELAKE)
            storage_options = {"bearer_token": token, "use_fabric_endpoint": "true"}
            df.write_delta(uri, mode=mode, storage_options=storage_options)
            elapsed = time.perf_counter() - t0
            log.info("Wrote delta %s: %d rows in %.1fs (mode=%s)",
                     table_path.split("/")[-1], len(df), elapsed, mode)
            return True
        except Exception as exc:
            log.error("Failed to write delta %s: %s", table_path, exc)
            return False

    def delta_table_exists(self, workspace_id: str, table_path: str) -> bool:
        """Check if a Delta table exists on OneLake."""
        uri = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{table_path}"
        try:
            token = self._token_provider.get_token(SCOPE_ONELAKE)
            storage_options = {"bearer_token": token, "use_fabric_endpoint": "true"}
            from deltalake import DeltaTable
            DeltaTable(uri, storage_options=storage_options)
            return True
        except Exception:
            return False
