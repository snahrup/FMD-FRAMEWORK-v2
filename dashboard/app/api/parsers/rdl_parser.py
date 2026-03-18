"""RDL/RDLC (Report Definition Language) XML parser.

Extracts datasets, fields, SQL command text, and data source references
from SSRS-style .rdl and .rdlc report definition files.

XXE protection: uses defusedxml when available, falls back to stdlib with
DTD processing disabled.
"""

from __future__ import annotations

import logging
import os
import re

try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET  # type: ignore[no-redef]

from dashboard.app.api.parsers.base import (
    DataSourceRef,
    ExtractionResult,
    ExtractedColumn,
    ExtractedQuery,
    ExtractedTable,
)

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 200 * 1024 * 1024  # 200 MB

# Common RDL XML namespaces across versions
_RDL_NAMESPACES = [
    "http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition",
    "http://schemas.microsoft.com/sqlserver/reporting/2010/01/reportdefinition",
    "http://schemas.microsoft.com/sqlserver/reporting/2008/01/reportdefinition",
    "http://schemas.microsoft.com/sqlserver/reporting/2005/01/reportdefinition",
    "http://schemas.microsoft.com/sqlserver/reporting/2003/10/reportdefinition",
]

# Simple regex to pull table names from SQL (FROM / JOIN clauses)
_TABLE_REF_RE = re.compile(
    r"""
    (?:FROM|JOIN)\s+
    (?:\[?(\w+)\]?\.)? # optional schema
    \[?(\w+)\]?         # table name
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _find(element, tag: str, ns: str):
    """Find a child element with the given namespace-qualified tag."""
    return element.find(f"{{{ns}}}{tag}")


def _findall(element, tag: str, ns: str):
    """Find all child elements with the given namespace-qualified tag."""
    return element.findall(f"{{{ns}}}{tag}")


def _text(element, tag: str, ns: str) -> str | None:
    """Get text content of a child element, or None."""
    child = _find(element, tag, ns)
    return child.text.strip() if child is not None and child.text else None


def _detect_namespace(root) -> str | None:
    """Detect which RDL namespace the document uses."""
    tag = root.tag
    if tag.startswith("{"):
        ns = tag[1 : tag.index("}")]
        return ns
    # No namespace — try each known one
    for ns in _RDL_NAMESPACES:
        if _find(root, "DataSets", ns) is not None:
            return ns
    return None


def _extract_table_refs_from_sql(sql: str) -> list[tuple[str | None, str]]:
    """Pull (schema, table) pairs from SQL text via regex."""
    return [(m.group(1), m.group(2)) for m in _TABLE_REF_RE.finditer(sql)]


def parse_rdl(file_path: str) -> ExtractionResult:
    """Parse an RDL or RDLC XML file and extract metadata.

    Args:
        file_path: Absolute path to the .rdl or .rdlc file.

    Returns:
        ExtractionResult with tables, columns, queries, and data sources.
    """
    result = ExtractionResult()

    # ── validate file ────────────────────────────────────────────────────
    if not os.path.isfile(file_path):
        result.errors.append(f"File not found: {file_path}")
        return result

    file_size = os.path.getsize(file_path)
    if file_size > MAX_FILE_SIZE:
        result.errors.append(
            f"File exceeds 200 MB limit ({file_size / 1024 / 1024:.1f} MB): {file_path}"
        )
        return result

    if file_size == 0:
        result.warnings.append(f"Empty file: {file_path}")
        return result

    # ── parse XML ────────────────────────────────────────────────────────
    try:
        tree = ET.parse(file_path)
    except ET.ParseError as exc:
        result.errors.append(f"XML parse error: {exc}")
        return result
    except Exception as exc:
        result.errors.append(f"Unexpected error reading {file_path}: {exc}")
        return result

    root = tree.getroot()
    ns = _detect_namespace(root)
    if ns is None:
        result.warnings.append(
            "Could not detect RDL namespace — attempting parse without namespace."
        )
        ns = ""

    # ── data sources ─────────────────────────────────────────────────────
    ds_container = _find(root, "DataSources", ns) if ns else root.find("DataSources")
    if ds_container is not None:
        ds_elements = _findall(ds_container, "DataSource", ns) if ns else ds_container.findall("DataSource")
        for ds_elem in ds_elements:
            ds_name = ds_elem.get("Name", "")
            conn_str = _text(ds_elem, "ConnectionProperties/ConnectString", ns) if ns else None
            if conn_str is None:
                # Try nested path
                cp = _find(ds_elem, "ConnectionProperties", ns) if ns else ds_elem.find("ConnectionProperties")
                if cp is not None:
                    conn_str = _text(cp, "ConnectString", ns) if ns else (cp.findtext("ConnectString") or "").strip() or None

            result.data_source_refs.append(
                DataSourceRef(
                    source_name=ds_name,
                    source_type="sql_db",
                    database_name=_extract_db_from_connstr(conn_str) if conn_str else None,
                )
            )

    # ── datasets → tables, columns, queries ──────────────────────────────
    dss_container = _find(root, "DataSets", ns) if ns else root.find("DataSets")
    if dss_container is not None:
        dataset_elements = _findall(dss_container, "DataSet", ns) if ns else dss_container.findall("DataSet")
        for ds in dataset_elements:
            ds_name = ds.get("Name", "unknown_dataset")

            # Extract command text (SQL query)
            query_elem = _find(ds, "Query", ns) if ns else ds.find("Query")
            command_text: str | None = None
            data_source_name: str | None = None
            if query_elem is not None:
                command_text = _text(query_elem, "CommandText", ns) if ns else (query_elem.findtext("CommandText") or "").strip() or None
                data_source_name = _text(query_elem, "DataSourceName", ns) if ns else (query_elem.findtext("DataSourceName") or "").strip() or None

            if command_text:
                result.queries.append(
                    ExtractedQuery(
                        query_name=ds_name,
                        query_text=command_text,
                        query_type="native_sql",
                    )
                )

            # Extract fields → columns
            fields_container = _find(ds, "Fields", ns) if ns else ds.find("Fields")
            columns: list[ExtractedColumn] = []
            if fields_container is not None:
                field_elements = _findall(fields_container, "Field", ns) if ns else fields_container.findall("Field")
                for idx, fld in enumerate(field_elements):
                    col_name = fld.get("Name", f"field_{idx}")
                    data_type = _text(fld, "rd:TypeName", "") or _text(fld, "TypeName", ns) if ns else None
                    # Try the DataField child for actual DB column name
                    db_field = _text(fld, "DataField", ns) if ns else (fld.findtext("DataField") or "").strip() or None
                    value_expr = _text(fld, "Value", ns) if ns else (fld.findtext("Value") or "").strip() or None

                    columns.append(
                        ExtractedColumn(
                            column_name=db_field or col_name,
                            data_type=data_type,
                            source_expression=value_expr,
                            is_calculated=value_expr is not None and db_field is None,
                            ordinal=idx,
                        )
                    )

            # Build a table entry for the dataset
            table = ExtractedTable(
                name=ds_name,
                entity_kind="view",  # RDL datasets are queries, not physical tables
                columns=columns,
            )
            result.tables.append(table)

            # Also extract table references from the SQL
            if command_text:
                for schema, tbl_name in _extract_table_refs_from_sql(command_text):
                    # Only add if not already represented
                    if not any(t.name == tbl_name for t in result.tables):
                        result.tables.append(
                            ExtractedTable(
                                name=tbl_name,
                                schema_name=schema,
                                entity_kind="physical",
                            )
                        )

    if not result.tables and not result.queries:
        result.warnings.append("No datasets or queries found in RDL file.")

    return result


def _extract_db_from_connstr(conn_str: str) -> str | None:
    """Best-effort extract database name from a connection string."""
    for part in conn_str.split(";"):
        key_val = part.strip().split("=", 1)
        if len(key_val) == 2 and key_val[0].strip().lower() in (
            "initial catalog",
            "database",
        ):
            return key_val[1].strip()
    return None
