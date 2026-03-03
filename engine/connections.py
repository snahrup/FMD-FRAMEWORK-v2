"""
FMD v3 Engine — Source SQL Server connection management.

Manages connections to both:
  - Fabric SQL metadata DB (via SP token)
  - On-prem source SQL servers (via Windows auth over VPN)

All connections go through pyodbc.  The metadata DB connection uses the
attrs_before token struct; source connections use Trusted_Connection.
"""

import logging
from contextlib import contextmanager
from typing import Generator, Optional

import pyodbc

from engine.auth import TokenProvider
from engine.models import EngineConfig, Entity

log = logging.getLogger("fmd.connections")


class MetadataDB:
    """Connection manager for the Fabric SQL metadata database.

    Every call gets a fresh connection (they're lightweight and pooled by
    the ODBC driver).  Callers should use the context manager::

        with db.connect() as conn:
            cursor = conn.cursor()
            ...
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._token_provider = token_provider

    @contextmanager
    def connect(self) -> Generator[pyodbc.Connection, None, None]:
        """Yield a pyodbc connection to the Fabric SQL DB.

        Commits on clean exit, rolls back on exception.
        """
        token_struct = self._token_provider.get_sql_token_struct()
        conn_str = (
            f"DRIVER={{{self._config.sql_driver}}};"
            f"SERVER={self._config.sql_server};"
            f"DATABASE={self._config.sql_database};"
            f"Encrypt=yes;TrustServerCertificate=no;"
        )
        conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Execute a query and return list of dicts.

        Handles stored procs that return result sets correctly — always
        commits after fetch (the silent-rollback bug from v2).
        """
        with self.connect() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params) if params else cursor.execute(sql)
            if not cursor.description:
                return []
            cols = [c[0] for c in cursor.description]
            rows = cursor.fetchall()
            return [
                {c: (v if v is not None else None) for c, v in zip(cols, row)}
                for row in rows
            ]

    def execute(self, sql: str, params: tuple = ()) -> None:
        """Execute a statement that does not return rows (INSERT/UPDATE/EXEC)."""
        with self.connect() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params) if params else cursor.execute(sql)

    def execute_proc(self, proc: str, params: dict) -> list[dict]:
        """Execute a stored procedure with named parameters and return results.

        Builds an EXEC statement like:
            EXEC [schema].[proc] @Param1=?, @Param2=?
        """
        param_clause = ", ".join(f"@{k}=?" for k in params)
        sql = f"EXEC {proc} {param_clause}"
        values = tuple(params.values())
        with self.connect() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, values)
            if not cursor.description:
                return []
            cols = [c[0] for c in cursor.description]
            rows = cursor.fetchall()
            return [
                {c: (v if v is not None else None) for c, v in zip(cols, row)}
                for row in rows
            ]

    def ping(self) -> bool:
        """Test connectivity — returns True if a trivial query succeeds."""
        try:
            result = self.query("SELECT 1 AS ok")
            return len(result) == 1
        except Exception as exc:
            log.warning("Metadata DB ping failed: %s", exc)
            return False


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
        """Test connectivity to a source server."""
        try:
            with self.connect(server, database, timeout=10) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT 1 AS ok")
                return True
        except Exception as exc:
            log.warning("Source ping failed (%s/%s): %s", server, database, exc)
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
