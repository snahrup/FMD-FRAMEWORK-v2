"""SQL parser for Gold Studio.

Statically parses SQL text to extract table references, columns, joins,
and CTEs.  Uses regex — not a full grammar parser — tuned for real-world
T-SQL / ANSI SQL encountered in Fabric pipelines and semantic models.

SECURITY: SQL is parsed statically only.  Pasted SQL is NEVER forwarded
to any execution context.
"""
from __future__ import annotations

import re
from pathlib import Path

from .base import (
    DataSourceRef,
    ExtractedColumn,
    ExtractedQuery,
    ExtractedRelationship,
    ExtractedTable,
    ExtractionResult,
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# Matches bracketed identifiers, double-quoted identifiers, or bare words
_IDENT = r"""(?:\[([^\]]+)\]|"([^"]+)"|(\w+))"""
# Schema-qualified: schema.table  (each part may be bracket/quote/bare)
_SCHEMA_TABLE = rf"{_IDENT}\s*\.\s*{_IDENT}"
# Unqualified table name
_BARE_TABLE = _IDENT


def _ident_value(m: re.Match, *group_indices: int) -> str | None:
    """Return the first non-None group among the given indices."""
    for idx in group_indices:
        val = m.group(idx)
        if val is not None:
            return val
    return None


def _strip_comments(sql: str) -> str:
    """Remove -- line comments and /* ... */ block comments."""
    # Block comments (non-greedy, handles nested poorly but good enough)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    # Line comments
    sql = re.sub(r"--[^\r\n]*", " ", sql)
    return sql


def _mask_string_literals(sql: str) -> str:
    """Replace content inside single-quoted strings with spaces so regexes
    don't match identifiers embedded in string literals."""
    def _replacer(m: re.Match) -> str:
        return "'" + " " * (len(m.group(0)) - 2) + "'"
    return re.sub(r"'(?:''|[^'])*'", _replacer, sql)


def _split_statements(sql: str) -> list[str]:
    """Split on GO (T-SQL batch separator) or semicolons."""
    # GO on its own line (case insensitive)
    parts = re.split(r"(?m)^\s*GO\s*$", sql, flags=re.IGNORECASE)
    statements: list[str] = []
    for part in parts:
        for stmt in re.split(r";", part):
            stmt = stmt.strip()
            if stmt:
                statements.append(stmt)
    return statements


def _parse_table_ref(text: str) -> tuple[str | None, str]:
    """Parse a possibly schema-qualified table reference.

    Returns (schema_name | None, table_name).
    Handles: [schema].[table], schema.table, "schema"."table", [table], table
    """
    m = re.match(rf"^\s*{_SCHEMA_TABLE}\s*$", text)
    if m:
        schema = _ident_value(m, 1, 2, 3)
        table = _ident_value(m, 4, 5, 6)
        if table:
            return schema, table

    m = re.match(rf"^\s*{_BARE_TABLE}\s*$", text)
    if m:
        table = _ident_value(m, 1, 2, 3)
        if table:
            return None, table

    return None, text.strip()


# ---------------------------------------------------------------------------
# Extraction routines
# ---------------------------------------------------------------------------

_FROM_JOIN_RE = re.compile(
    r"""
    (?:
        \bFROM\b
      | \b(?:INNER|LEFT|RIGHT|FULL|CROSS)?\s*(?:OUTER\s+)?JOIN\b
    )
    \s+
    (
        (?:\[?[\w]+\]?\s*\.\s*)?   # optional schema.
        \[?[\w]+\]?                 # table name
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

_JOIN_TYPE_RE = re.compile(
    r"\b((?:INNER|LEFT|RIGHT|FULL|CROSS)\s*(?:OUTER\s+)?)?JOIN\b",
    re.IGNORECASE,
)

_JOIN_ON_RE = re.compile(
    r"""
    \b(?:(?:INNER|LEFT|RIGHT|FULL|CROSS)\s*(?:OUTER\s+)?)?JOIN\b
    \s+
    ((?:\[?[\w]+\]?\s*\.\s*)?\[?[\w]+\]?)   # table ref
    (?:\s+(?:AS\s+)?(\[?[\w]+\]?))?          # optional alias
    \s+ON\s+
    ((?:\[?[\w]+\]?\s*\.\s*)?\[?[\w]+\]?)   # left side: table_or_alias.column
    \s*\.\s*
    (\[?[\w]+\]?)                             # left column
    \s*=\s*
    ((?:\[?[\w]+\]?\s*\.\s*)?\[?[\w]+\]?)   # right side: table_or_alias.column
    \s*\.\s*
    (\[?[\w]+\]?)                             # right column
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _extract_cte_names(sql: str) -> list[str]:
    """Return CTE names from WITH ... AS (...) patterns."""
    cte_names: list[str] = []
    # Match the WITH block — each CTE is  name AS (
    cte_re = re.compile(
        r"\bWITH\b\s+(.*?)(?=\bSELECT\b)",
        re.IGNORECASE | re.DOTALL,
    )
    m = cte_re.search(sql)
    if not m:
        return cte_names
    cte_block = m.group(1)
    # Each CTE:  name AS (
    for cm in re.finditer(
        rf"({_IDENT})\s+AS\s*\(",
        cte_block,
        re.IGNORECASE,
    ):
        name = cm.group(2) or cm.group(3) or cm.group(4)
        if name:
            cte_names.append(name)
    return cte_names


def _clean_ident(raw: str) -> str:
    """Strip brackets / double quotes from a single identifier."""
    raw = raw.strip()
    if raw.startswith("[") and raw.endswith("]"):
        return raw[1:-1]
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1]
    return raw


def _extract_tables(sql_masked: str, cte_names: set[str]) -> list[ExtractedTable]:
    """Extract table references from FROM / JOIN clauses."""
    seen: dict[tuple[str | None, str], ExtractedTable] = {}
    for m in _FROM_JOIN_RE.finditer(sql_masked):
        raw_ref = m.group(1).strip()
        schema, table = _parse_table_ref(raw_ref)
        schema = _clean_ident(schema) if schema else None
        table = _clean_ident(table)
        # Skip CTE self-references
        if table.upper() in cte_names:
            continue
        key = (schema, table)
        if key not in seen:
            seen[key] = ExtractedTable(name=table, schema_name=schema)
    return list(seen.values())


def _extract_select_columns(sql_masked: str) -> list[ExtractedColumn]:
    """Best-effort extraction of column names from SELECT clauses."""
    columns: list[ExtractedColumn] = []
    seen: set[str] = set()
    # Find SELECT ... FROM blocks
    select_re = re.compile(
        r"\bSELECT\b\s+(?:DISTINCT\s+|TOP\s+\d+\s+)?(.*?)\bFROM\b",
        re.IGNORECASE | re.DOTALL,
    )
    for sm in select_re.finditer(sql_masked):
        col_text = sm.group(1)
        if col_text.strip() == "*":
            continue
        # Split on commas (not inside parentheses)
        depth = 0
        parts: list[str] = []
        current: list[str] = []
        for ch in col_text:
            if ch == "(":
                depth += 1
                current.append(ch)
            elif ch == ")":
                depth -= 1
                current.append(ch)
            elif ch == "," and depth == 0:
                parts.append("".join(current))
                current = []
            else:
                current.append(ch)
        if current:
            parts.append("".join(current))

        for ordinal, part in enumerate(parts, 1):
            part = part.strip()
            if not part:
                continue
            # Check for AS alias
            alias_m = re.search(r"\bAS\s+(\[?[\w]+\]?)\s*$", part, re.IGNORECASE)
            if alias_m:
                col_name = _clean_ident(alias_m.group(1))
            else:
                # Take the last dotted part (table.column → column)
                # or the whole thing if no dots
                tokens = re.split(r"\s+", part)
                # If last token looks like an alias (no dots, no parens)
                last = tokens[-1].strip()
                if len(tokens) > 1 and re.match(r"^\[?[\w]+\]?$", last) and not re.match(
                    r"(?i)^(CASE|WHEN|THEN|ELSE|END|AND|OR|NOT|NULL|IS)$", last
                ):
                    col_name = _clean_ident(last)
                else:
                    # grab rightmost dotted segment
                    dot_parts = last.rsplit(".", 1)
                    col_name = _clean_ident(dot_parts[-1])

            if col_name == "*" or not col_name:
                continue
            is_calc = bool(re.search(r"[()+=\-*/]|\bCASE\b|\bCAST\b|\bCONVERT\b", part, re.IGNORECASE))
            key = col_name.upper()
            if key not in seen:
                seen.add(key)
                columns.append(
                    ExtractedColumn(
                        column_name=col_name,
                        is_calculated=is_calc,
                        ordinal=ordinal,
                        source_expression=part.strip() if is_calc else None,
                    )
                )
    return columns


def _extract_relationships(
    sql_masked: str, cte_names: set[str], alias_map: dict[str, str]
) -> list[ExtractedRelationship]:
    """Extract JOIN ON relationships."""
    rels: list[ExtractedRelationship] = []
    for m in _JOIN_ON_RE.finditer(sql_masked):
        join_table_raw = m.group(1).strip()
        join_alias = _clean_ident(m.group(2)) if m.group(2) else None
        left_ref = _clean_ident(m.group(3))
        left_col = _clean_ident(m.group(4))
        right_ref = _clean_ident(m.group(5))
        right_col = _clean_ident(m.group(6))

        # Resolve aliases
        left_entity = alias_map.get(left_ref.upper(), left_ref)
        right_entity = alias_map.get(right_ref.upper(), right_ref)

        # Determine join type from the keyword preceding JOIN
        # Search backward from the match to find the join type
        prefix = sql_masked[max(0, m.start() - 30): m.start() + 10]
        jt_m = _JOIN_TYPE_RE.search(prefix + sql_masked[m.start(): m.start() + 40])
        join_type = None
        if jt_m and jt_m.group(1):
            join_type = jt_m.group(1).strip().upper()
            # Normalise: "LEFT OUTER" → "LEFT OUTER"
            join_type = re.sub(r"\s+", " ", join_type)
        else:
            join_type = "INNER"

        # Skip if both sides point to CTEs
        if left_entity.upper() in cte_names and right_entity.upper() in cte_names:
            continue

        rels.append(
            ExtractedRelationship(
                from_entity=left_entity,
                from_column=left_col,
                to_entity=right_entity,
                to_column=right_col,
                join_type=join_type,
                detected_from="query_parse",
            )
        )
    return rels


def _build_alias_map(sql_masked: str) -> dict[str, str]:
    """Build alias → real table name mapping from FROM/JOIN clauses."""
    alias_map: dict[str, str] = {}
    alias_re = re.compile(
        r"""
        (?:\bFROM\b|\bJOIN\b)
        \s+
        ((?:\[?[\w]+\]?\s*\.\s*)?\[?[\w]+\]?)  # table ref
        \s+
        (?:AS\s+)?
        (\[?[\w]+\]?)                             # alias
        \b
        """,
        re.IGNORECASE | re.VERBOSE,
    )
    for m in alias_re.finditer(sql_masked):
        raw_table = m.group(1).strip()
        alias = _clean_ident(m.group(2))
        # Don't treat SQL keywords as aliases
        if alias.upper() in {
            "ON", "WHERE", "SET", "INTO", "VALUES", "INNER", "LEFT", "RIGHT",
            "FULL", "CROSS", "OUTER", "JOIN", "GROUP", "ORDER", "HAVING",
            "UNION", "EXCEPT", "INTERSECT", "WITH", "AS", "SELECT",
        }:
            continue
        _, table = _parse_table_ref(raw_table)
        table = _clean_ident(table)
        alias_map[alias.upper()] = table
    return alias_map


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_sql(
    sql_text: str,
    query_name: str | None = None,
    source_database: str | None = None,
) -> ExtractionResult:
    """Parse a SQL string and extract structural metadata.

    Args:
        sql_text: Raw SQL text (one or more statements).
        query_name: Optional label for the query.
        source_database: Optional source database name to tag on tables.

    Returns:
        ExtractionResult with tables, columns, queries, and relationships.
    """
    result = ExtractionResult()

    if not sql_text or not sql_text.strip():
        result.warnings.append("Empty SQL text provided")
        return result

    try:
        cleaned = _strip_comments(sql_text)
        masked = _mask_string_literals(cleaned)
        statements = _split_statements(cleaned)
        masked_full = _mask_string_literals(cleaned)

        # CTE detection
        cte_names_list = _extract_cte_names(masked_full)
        cte_names_upper: set[str] = {n.upper() for n in cte_names_list}

        # Add CTE names as calculated tables
        for cte_name in cte_names_list:
            result.tables.append(
                ExtractedTable(
                    name=cte_name,
                    entity_kind="calculated",
                    source_database=source_database,
                )
            )

        # Alias resolution
        alias_map = _build_alias_map(masked_full)

        # Tables
        physical_tables = _extract_tables(masked_full, cte_names_upper)
        for t in physical_tables:
            if source_database:
                t.source_database = source_database
            result.tables.append(t)

        # Columns
        result.columns = _extract_select_columns(masked_full)

        # Relationships from JOINs
        result.relationships = _extract_relationships(
            masked_full, cte_names_upper, alias_map
        )

        # Record each statement as a query
        for i, stmt in enumerate(statements):
            stmt_stripped = stmt.strip()
            if not stmt_stripped:
                continue
            qname = query_name if len(statements) == 1 else f"{query_name or 'stmt'}_{i + 1}"
            result.queries.append(
                ExtractedQuery(
                    query_name=qname,
                    query_text=stmt_stripped,
                    query_type="native_sql",
                    source_database=source_database,
                )
            )

        # Data source ref if database is known
        if source_database:
            schemas = {t.schema_name for t in result.tables if t.schema_name}
            if schemas:
                for s in schemas:
                    result.data_source_refs.append(
                        DataSourceRef(
                            source_name=source_database,
                            source_type="sql_db",
                            database_name=source_database,
                            schema_name=s,
                        )
                    )
            else:
                result.data_source_refs.append(
                    DataSourceRef(
                        source_name=source_database,
                        source_type="sql_db",
                        database_name=source_database,
                    )
                )

    except Exception as exc:
        result.errors.append(f"SQL parse error: {exc}")

    return result


def parse_sql_file(
    file_path: str,
    query_name: str | None = None,
    source_database: str | None = None,
) -> ExtractionResult:
    """Read a .sql file and parse its contents.

    Args:
        file_path: Path to the .sql file.
        query_name: Optional label (defaults to the file stem).
        source_database: Optional source database tag.

    Returns:
        ExtractionResult from the parsed file contents.
    """
    path = Path(file_path)
    if not path.exists():
        result = ExtractionResult()
        result.errors.append(f"File not found: {file_path}")
        return result

    sql_text = path.read_text(encoding="utf-8-sig")
    name = query_name or path.stem
    return parse_sql(sql_text, query_name=name, source_database=source_database)
