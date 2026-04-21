"""
FMD v3 Engine — Source SQL Server connection management.

Manages connections to on-prem source SQL servers.
Fabric SQL metadata is now served from the local SQLite control-plane DB.

Supports either Windows Integrated Auth or SQL username/password auth,
depending on engine config.
"""

import logging
from contextlib import contextmanager
from typing import Generator

import pyodbc

from engine.models import EngineConfig, Entity

log = logging.getLogger("fmd.connections")


class SourceConnection:
    """Connection manager for on-prem source SQL servers.

    Default mode is Windows auth over VPN. SQL auth is also supported for
    service-account deployments. Short hostnames only — do NOT append
    .ipaper.com.
    """

    def __init__(self, config: EngineConfig):
        self._config = config
        self._driver = config.source_sql_driver
        self._query_timeout = config.query_timeout

    @contextmanager
    def connect(
        self, server: str, database: str, timeout: int = 30
    ) -> Generator[pyodbc.Connection, None, None]:
        """Yield a pyodbc connection to an on-prem SQL server.

        Parameters
        ----------
        server : str
            Short hostname (e.g. 'm3-db1', 'M3-DB3').
        database : str
            Database name (e.g. 'mes', 'ETQStagingPRD').
        timeout : int
            Connection timeout in seconds.
        """
        if self._config.connectorx_auth_mode == "sql":
            if not self._config.sql_username or not self._config.sql_password:
                raise ValueError(
                    "connectorx_auth_mode=sql requires sql_username and sql_password"
                )
            conn_str = (
                f"DRIVER={{{self._driver}}};"
                f"SERVER={server};"
                f"DATABASE={database};"
                f"UID={self._config.sql_username};"
                f"PWD={self._config.sql_password};"
                f"TrustServerCertificate=yes;"
                f"Connection Timeout={timeout};"
            )
        else:
            conn_str = (
                f"DRIVER={{{self._driver}}};"
                f"SERVER={server};"
                f"DATABASE={database};"
                f"Trusted_Connection=yes;"
                f"TrustServerCertificate=yes;"
                f"Connection Timeout={timeout};"
            )
        conn = pyodbc.connect(conn_str)
        conn.timeout = self._query_timeout
        try:
            yield conn
        finally:
            conn.close()

    def build_connectorx_uri(self, server: str, database: str) -> str:
        """Build a ConnectorX-compatible mssql:// connection URI.

        Supports two auth modes:
        - "windows" (default): Uses Windows Integrated Auth (SSPI/Trusted_Connection).
          ConnectorX's tiberius driver supports this natively on Windows.
        - "sql": Uses SQL Server username/password (Basic credentials).
        """
        port = 1433
        if self._config.connectorx_auth_mode == "sql":
            from urllib.parse import quote_plus
            username = self._config.sql_username
            password = quote_plus(self._config.sql_password)
            return f"mssql://{username}:{password}@{server}:{port}/{database}?TrustServerCertificate=true"
        else:
            # Windows Auth — same auth the engine already uses via SSPI
            return f"mssql://{server}:{port}/{database}?trusted_connection=true&TrustServerCertificate=true"

    def ping(self, server: str, database: str) -> bool:
        """Test connectivity to a source server.

        Returns True/False for backward compatibility. Logs structured
        diagnostic info on failure (VPN, auth, driver, timeout).
        """
        try:
            with self.connect(server, database, timeout=10) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT 1 AS ok")
                return True
        except pyodbc.Error as exc:
            error_msg = str(exc).lower()
            if "could not open a connection" in error_msg or "[53]" in str(exc):
                log.warning("Source ping FAILED (%s/%s): NETWORK — server unreachable. Check VPN.", server, database)
            elif "login failed" in error_msg:
                log.warning("Source ping FAILED (%s/%s): AUTH — login failed. Check Windows auth / domain trust.", server, database)
            elif "driver" in error_msg:
                log.warning("Source ping FAILED (%s/%s): DRIVER — ODBC driver '%s' not found or misconfigured.", server, database, self._driver)
            elif "timeout" in error_msg:
                log.warning("Source ping FAILED (%s/%s): TIMEOUT — server did not respond within 10s.", server, database)
            else:
                log.warning("Source ping FAILED (%s/%s): %s", server, database, exc)
            return False
        except Exception as exc:
            log.warning("Source ping FAILED (%s/%s): UNEXPECTED — %s", server, database, exc)
            return False


def build_source_map(entities: list[Entity]) -> dict[tuple[str, str], list[Entity]]:
    """Group entities by (server, database) for connection reuse.

    Instead of opening 659 connections, we open one per unique
    server+database pair and extract all entities from it sequentially.
    """
    source_map: dict[tuple[str, str], list[Entity]] = {}
    for entity in entities:
        key = (entity.source_server, entity.source_database)
        source_map.setdefault(key, []).append(entity)
    return source_map
