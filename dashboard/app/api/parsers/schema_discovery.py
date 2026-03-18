"""Schema discovery stub for Gold Studio.

Defines the interface for discovering table schemas from live database
connections.  Currently returns empty results with a warning — actual
discovery requires VPN connectivity to source databases.

Method hierarchy (when implemented):
1. sp_describe_first_result_set — most accurate, works for queries + tables
2. INFORMATION_SCHEMA / catalog queries — reliable for physical tables
3. SELECT TOP 0 * FROM ... — last resort fallback
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Timeouts for future implementation
CONNECT_TIMEOUT_S = 10
QUERY_TIMEOUT_S = 30


def discover_table_schema(
    source_database: str,
    table_name: str,
    schema_name: str | None = None,
    connection_id: str | None = None,
) -> list[dict[str, Any]]:
    """Discover columns for a single table.

    Returns a list of column definitions:
    ``[{"name": str, "type": str, "nullable": bool, "is_pk": bool}, ...]``

    Args:
        source_database: Name of the source database (e.g., "mes", "m3fdbprd").
        table_name: Name of the table to describe.
        schema_name: Optional schema name (defaults to "dbo" in SQL Server).
        connection_id: Optional connection ID from FMD metadata if available.

    Returns:
        List of column dicts, or empty list if discovery is unavailable.
    """
    logger.warning(
        "Schema discovery requires VPN connection — returning empty result for %s.%s.%s",
        source_database,
        schema_name or "dbo",
        table_name,
    )
    return []


def discover_batch(
    tables: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Discover schemas for multiple tables in one call.

    Each entry in *tables* should have:
    - ``table_name`` (required)
    - ``schema_name`` (optional)
    - ``source_database`` (required)
    - ``connection_id`` (optional)

    Returns a dict keyed by ``"{source_database}.{schema_name}.{table_name}"``
    mapping to column lists.

    Args:
        tables: List of table descriptors.

    Returns:
        Dict mapping qualified table name to column definitions.
        Empty dicts for tables that couldn't be discovered.
    """
    results: dict[str, list[dict[str, Any]]] = {}

    for tbl in tables:
        t_name = tbl.get("table_name", "")
        s_name = tbl.get("schema_name") or "dbo"
        db_name = tbl.get("source_database", "")
        conn_id = tbl.get("connection_id")

        if not t_name or not db_name:
            logger.warning("Skipping table with missing name or database: %s", tbl)
            continue

        key = f"{db_name}.{s_name}.{t_name}"
        results[key] = discover_table_schema(
            source_database=db_name,
            table_name=t_name,
            schema_name=s_name,
            connection_id=conn_id,
        )

    if tables:
        logger.info(
            "Schema discovery batch: %d tables requested, all returning empty "
            "(VPN connection required).",
            len(tables),
        )

    return results


def is_available() -> bool:
    """Check if schema discovery is currently available.

    Returns False until live database connectivity is implemented.
    """
    return False
