"""
FMD v3 Engine — Source SQL Server connection management.

Manages connections to on-prem source SQL servers (via Windows auth over VPN).
Fabric SQL metadata is now served from the local SQLite control-plane DB.

All connections go through pyodbc with Trusted_Connection.
"""

import logging
from contextlib import contextmanager
from typing import Generator

import pyodbc

from engine.models import EngineConfig, Entity

log = logging.getLogger("fmd.connections")


class SourceConnection:
    """Connection manager for on-prem source SQL servers.

    All sources use Windows auth (Trusted_Connection) over VPN.
    Short hostnames only — do NOT append .ipaper.com.
    """

    def __init__(self, config: EngineConfig):
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
