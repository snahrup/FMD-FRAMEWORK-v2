"""Live schema discovery for Gold Studio.

Connects to source databases via pyodbc (Windows Auth) and uses
sp_describe_first_result_set to get accurate column metadata for
pasted SQL queries.  Also supports data preview (TOP N rows).

Requires VPN connectivity to source databases.
"""

from __future__ import annotations

import logging
from typing import Any

import pyodbc

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT_S = 10
QUERY_TIMEOUT_S = 30

# ── SQL injection guard ──
# Reject any query containing DDL/DML keywords.  This is a preview-only tool;
# only SELECT statements are allowed.
import re

_FORBIDDEN_SQL_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|xp_|sp_addrolemember|GRANT|REVOKE|MERGE)\b",
    re.IGNORECASE,
)


def _validate_select_only(sql: str) -> None:
    """Raise ValueError if the SQL contains DDL/DML keywords.

    Security guard: preview_query() and auto_detect_source() execute user-supplied
    SQL on production source databases.  Only SELECT-like reads are permitted.
    """
    stripped = sql.strip().rstrip(";").strip()
    if not stripped:
        raise ValueError("Empty SQL query")
    # Strip leading comments (-- and /* */) to prevent bypass
    cleaned = re.sub(r"--[^\n]*", " ", stripped)
    cleaned = re.sub(r"/\*.*?\*/", " ", cleaned, flags=re.DOTALL)
    cleaned = cleaned.strip()
    if _FORBIDDEN_SQL_RE.search(cleaned):
        raise ValueError(
            "Query rejected: only SELECT statements are allowed. "
            "DDL/DML keywords (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, "
            "TRUNCATE, EXEC, xp_) are not permitted."
        )

# ── Source connection map ──
# source_system → { server, databases: { db_name: display_name } }
SOURCE_MAP: dict[str, dict[str, Any]] = {
    "MES": {
        "server": "m3-db1",
        "default_db": "mes",
        "databases": {"mes": "MES Production"},
    },
    "ETQ": {
        "server": "M3-DB3",
        "default_db": "ETQStagingPRD",
        "databases": {"ETQStagingPRD": "ETQ Staging PRD"},
    },
    "M3 ERP": {
        "server": "sqllogshipprd",
        "default_db": "m3fdbprd",
        "databases": {"m3fdbprd": "M3 ERP Production"},
    },
    "M3 Cloud": {
        "server": "sql2016live",
        "default_db": "DI_PRD_Staging",
        "databases": {"DI_PRD_Staging": "M3 Cloud Staging"},
    },
    "OPTIVA": {
        "server": "sqllogshipprd",
        "default_db": "m3fdbprd",
        "databases": {"m3fdbprd": "OPTIVA (via M3 ERP)"},
    },
}


def _get_connection(source_system: str, database: str | None = None) -> pyodbc.Connection:
    """Get a pyodbc connection for a source system."""
    src = SOURCE_MAP.get(source_system)
    if not src:
        raise ValueError(f"Unknown source system: {source_system}. Known: {list(SOURCE_MAP.keys())}")

    db = database or src["default_db"]
    server = src["server"]

    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={server};"
        f"DATABASE={db};"
        f"Trusted_Connection=yes;"
        f"TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str, timeout=CONNECT_TIMEOUT_S)


def is_available(source_system: str | None = None) -> bool:
    """Check if a source system is reachable."""
    if source_system and source_system not in SOURCE_MAP:
        return False
    targets = [source_system] if source_system else list(SOURCE_MAP.keys())
    for sys_name in targets:
        try:
            conn = _get_connection(sys_name)
            conn.close()
            return True
        except Exception:
            continue
    return False


def describe_query(
    sql: str,
    source_system: str,
    database: str | None = None,
) -> list[dict[str, Any]]:
    """Use sp_describe_first_result_set to get column metadata for a SQL query.

    Returns list of column dicts:
    [{"name", "type", "nullable", "is_identity", "is_key", "ordinal",
      "max_length", "precision", "scale", "source_table", "source_column"}, ...]
    """
    conn = _get_connection(source_system, database)
    try:
        cur = conn.cursor()
        cur.execute("EXEC sp_describe_first_result_set @tsql = ?", sql)
        rows = cur.fetchall()

        columns = []
        for r in rows:
            columns.append({
                "name": r[2],                    # name
                "type": r[5],                    # system_type_name (e.g. "varchar(50)")
                "nullable": bool(r[3]),          # is_nullable
                "is_identity": bool(r[27]),      # is_identity_column
                "is_key": bool(r[28]) if r[28] is not None else False,  # is_part_of_unique_key
                "ordinal": r[1],                 # column_ordinal
                "max_length": r[6],              # max_length
                "precision": r[7],               # precision
                "scale": r[8],                   # scale
                "source_table": r[25],           # source_table
                "source_column": r[26],          # source_column
                "source_schema": r[24],          # source_schema
                "source_database": r[23],        # source_database
            })
        return columns
    except pyodbc.Error as e:
        logger.warning("sp_describe_first_result_set failed: %s", e)
        raise
    finally:
        conn.close()


def preview_query(
    sql: str,
    source_system: str,
    database: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Execute the query with TOP N and return preview rows.

    Returns {"columns": [...], "rows": [[...], ...], "row_count": int, "truncated": bool}
    """
    # SHARED-BE-001: Reject DDL/DML — only SELECT allowed on source DBs
    _validate_select_only(sql)

    # SHARED-BE-002: Validate limit is a safe integer to prevent SQL injection
    # via f-string interpolation in SET ROWCOUNT
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 100
    if limit < 1:
        limit = 1
    if limit > 10000:
        limit = 10000

    conn = _get_connection(source_system, database)
    try:
        cur = conn.cursor()
        cur.execute(f"SET ROWCOUNT {limit}")

        # Execute the actual query (with row limit safety)
        cur.execute(sql)
        meta = cur.description
        if not meta:
            return {"columns": [], "rows": [], "row_count": 0, "truncated": False}

        col_names = [d[0] for d in meta]
        col_types = [d[1].__name__ if d[1] else "str" for d in meta]

        rows_raw = cur.fetchall()
        rows = []
        for row in rows_raw:
            rows.append([_safe_serialize(v) for v in row])

        return {
            "columns": [{"name": n, "python_type": t} for n, t in zip(col_names, col_types)],
            "rows": rows,
            "row_count": len(rows),
            "truncated": len(rows) >= limit,
        }
    except pyodbc.Error as e:
        logger.warning("Preview query failed: %s", e)
        raise
    finally:
        conn.close()


def _safe_serialize(val: Any) -> Any:
    """Make a value JSON-safe."""
    if val is None:
        return None
    if isinstance(val, (int, float, bool)):
        return val
    if isinstance(val, bytes):
        return f"<{len(val)} bytes>"
    if isinstance(val, memoryview):
        return f"<{len(val)} bytes>"
    # datetime, date, time, Decimal → str
    return str(val)


def discover_table_schema(
    source_database: str,
    table_name: str,
    schema_name: str | None = None,
    source_system: str | None = None,
) -> list[dict[str, Any]]:
    """Discover columns for a single table using INFORMATION_SCHEMA."""
    if not source_system:
        logger.warning("source_system required for live discovery — returning empty for %s", table_name)
        return []

    try:
        conn = _get_connection(source_system, source_database)
    except Exception as e:
        logger.warning("Connection failed for %s/%s: %s", source_system, source_database, e)
        return []

    try:
        cur = conn.cursor()
        schema = schema_name or "dbo"
        cur.execute(
            """SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
                      IS_NULLABLE, ORDINAL_POSITION, COLUMN_DEFAULT,
                      NUMERIC_PRECISION, NUMERIC_SCALE
               FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
               ORDER BY ORDINAL_POSITION""",
            (schema, table_name),
        )
        rows = cur.fetchall()
        columns = []
        for r in rows:
            type_str = r[1]
            if r[2] and r[2] > 0:
                type_str = f"{r[1]}({r[2]})"
            elif r[6] is not None and r[1] in ("decimal", "numeric"):
                type_str = f"{r[1]}({r[6]},{r[7]})"

            columns.append({
                "name": r[0],
                "type": type_str,
                "nullable": r[3] == "YES",
                "ordinal": r[4],
                "is_key": False,  # Would need separate PK query
                "is_identity": False,
            })
        return columns
    except Exception as e:
        logger.warning("Table schema discovery failed for %s.%s: %s", schema_name, table_name, e)
        return []
    finally:
        conn.close()


def auto_detect_source(sql: str) -> dict[str, Any] | None:
    """Try sp_describe_first_result_set on each source system until one works.

    Returns {"source_system": str, "database": str, "server": str, "columns": [...]}
    or None if no source matches.
    """
    for sys_name, info in SOURCE_MAP.items():
        for db_name in info["databases"]:
            try:
                conn = _get_connection(sys_name, db_name)
                cur = conn.cursor()
                cur.execute("EXEC sp_describe_first_result_set @tsql = ?", sql)
                rows = cur.fetchall()
                conn.close()

                if rows:
                    columns = []
                    for r in rows:
                        columns.append({
                            "name": r[2],
                            "type": r[5],
                            "nullable": bool(r[3]),
                            "is_identity": bool(r[27]),
                            "is_key": bool(r[28]) if r[28] is not None else False,
                            "ordinal": r[1],
                            "max_length": r[6],
                            "precision": r[7],
                            "scale": r[8],
                            "source_table": r[25],
                            "source_column": r[26],
                            "source_schema": r[24],
                            "source_database": r[23],
                        })
                    logger.info("Auto-detected source: %s/%s for query (%d columns)",
                                sys_name, db_name, len(columns))
                    return {
                        "source_system": sys_name,
                        "database": db_name,
                        "server": info["server"],
                        "columns": columns,
                    }
            except Exception as e:
                logger.debug("Auto-detect: %s/%s failed: %s", sys_name, db_name, e)
                continue
    logger.warning("Auto-detect: no source matched the query")
    return None


def get_source_systems() -> list[dict[str, Any]]:
    """Return the list of known source systems for the UI dropdown."""
    result = []
    for name, info in SOURCE_MAP.items():
        result.append({
            "name": name,
            "server": info["server"],
            "default_database": info["default_db"],
            "databases": [
                {"name": db, "label": label}
                for db, label in info["databases"].items()
            ],
        })
    return result
