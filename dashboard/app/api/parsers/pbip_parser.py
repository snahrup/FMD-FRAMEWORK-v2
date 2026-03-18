"""PBIP / TMDL (Power BI Project) parser.

Reads the directory-based Power BI project format where each table,
measure, and relationship is stored in separate .tmdl files.  Falls back
to ``model.bim`` when TMDL files are not present.

Path traversal protection:
- All paths resolved and validated to stay within the project boundary.
- Symlinks are rejected.
- Paths are normalized before reading.
"""

from __future__ import annotations

import logging
import os
import re

from dashboard.app.api.parsers.base import (
    ExtractionResult,
    ExtractedColumn,
    ExtractedMeasure,
    ExtractedRelationship,
    ExtractedTable,
)

logger = logging.getLogger(__name__)

# Max total bytes we'll read from a TMDL project (100 MB safety net)
MAX_TOTAL_READ = 100 * 1024 * 1024
# Max single file size
MAX_FILE_SIZE = 10 * 1024 * 1024


def _safe_path(base: str, relative: str) -> str | None:
    """Resolve *relative* under *base* and verify it stays within boundary.

    Returns the resolved absolute path, or None if the path escapes *base*
    or is a symlink.
    """
    resolved = os.path.normpath(os.path.join(base, relative))
    # Must be under base directory
    if not resolved.startswith(os.path.normpath(base) + os.sep) and resolved != os.path.normpath(base):
        return None
    # Reject symlinks
    if os.path.islink(resolved):
        return None
    return resolved


def _read_safe(path: str, running_total: list[int]) -> str | None:
    """Read a file with size and running-total guards."""
    if os.path.islink(path):
        return None
    try:
        size = os.path.getsize(path)
    except OSError:
        return None
    if size > MAX_FILE_SIZE:
        return None
    if running_total[0] + size > MAX_TOTAL_READ:
        return None
    running_total[0] += size
    try:
        with open(path, "r", encoding="utf-8-sig") as fh:
            return fh.read()
    except Exception:
        return None


def parse_pbip(project_dir: str) -> ExtractionResult:
    """Parse a Power BI Project (PBIP) directory.

    Looks for TMDL files first.  If none are found, falls back to
    ``model.bim`` inside the project directory.

    Args:
        project_dir: Absolute path to the PBIP project root directory.

    Returns:
        ExtractionResult with tables, columns, measures, and relationships.
    """
    result = ExtractionResult()

    # ── validate directory ───────────────────────────────────────────────
    if not os.path.isdir(project_dir):
        result.errors.append(f"Directory not found: {project_dir}")
        return result

    if os.path.islink(project_dir):
        result.errors.append(f"Symlink project directories are not allowed: {project_dir}")
        return result

    base = os.path.normpath(project_dir)

    # ── find TMDL files ──────────────────────────────────────────────────
    tmdl_files = _collect_tmdl_files(base)

    if tmdl_files:
        _parse_tmdl_project(base, tmdl_files, result)
    else:
        # Fallback to model.bim
        bim_path = _safe_path(base, "model.bim")
        if bim_path is None:
            # Also try common nested paths
            for candidate in (
                os.path.join("definition", "model.bim"),
                os.path.join(".Dataset", "model.bim"),
                "model.bim",
            ):
                bim_path = _safe_path(base, candidate)
                if bim_path and os.path.isfile(bim_path):
                    break
                bim_path = None

        if bim_path and os.path.isfile(bim_path):
            result.warnings.append("No TMDL files found — falling back to model.bim.")
            from dashboard.app.api.parsers.bim_parser import parse_bim

            bim_result = parse_bim(bim_path)
            result.tables.extend(bim_result.tables)
            result.columns.extend(bim_result.columns)
            result.queries.extend(bim_result.queries)
            result.measures.extend(bim_result.measures)
            result.relationships.extend(bim_result.relationships)
            result.warnings.extend(bim_result.warnings)
            result.errors.extend(bim_result.errors)
        else:
            result.errors.append(
                f"No TMDL files or model.bim found in project directory: {project_dir}"
            )

    return result


def _collect_tmdl_files(base: str) -> list[str]:
    """Collect all .tmdl files under *base*, respecting path safety."""
    tmdl_files: list[str] = []
    for root, dirs, files in os.walk(base):
        # Skip hidden directories
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in files:
            if f.lower().endswith(".tmdl"):
                full = os.path.normpath(os.path.join(root, f))
                if full.startswith(base) and not os.path.islink(full):
                    tmdl_files.append(full)
    return tmdl_files


def _parse_tmdl_project(
    base: str, tmdl_files: list[str], result: ExtractionResult
) -> None:
    """Parse TMDL files from a Power BI project directory.

    TMDL format is a simplified DSL — one file per object with
    indentation-based blocks:

        table MyTable
            column MyColumn
                dataType: string
                lineageTag: ...
            measure MyMeasure = SUM('MyTable'[Amount])
                formatString: #,##0.00
    """
    running_total = [0]

    for fpath in sorted(tmdl_files):
        content = _read_safe(fpath, running_total)
        if content is None:
            result.warnings.append(f"Skipped unreadable file: {fpath}")
            continue

        rel_path = os.path.relpath(fpath, base).replace("\\", "/")

        # Determine what this file defines based on path/content
        fname = os.path.basename(fpath).lower()

        if "/tables/" in rel_path.lower() or fname.endswith(".tmdl"):
            _parse_tmdl_table_file(content, rel_path, result)
        elif "relationships" in rel_path.lower():
            _parse_tmdl_relationships(content, result)

    if running_total[0] >= MAX_TOTAL_READ:
        result.warnings.append(
            f"Stopped reading TMDL files at {MAX_TOTAL_READ / 1024 / 1024:.0f} MB safety limit."
        )


# ── TMDL text parsing ───────────────────────────────────────────────────

_TABLE_RE = re.compile(r"^table\s+'?([^'\n]+)'?\s*$", re.MULTILINE)
_COLUMN_RE = re.compile(
    r"^\t+column\s+'?([^'\n]+)'?\s*$", re.MULTILINE
)
_DATATYPE_RE = re.compile(r"^\t+dataType\s*:\s*(\S+)", re.MULTILINE)
_MEASURE_RE = re.compile(
    r"^\t+measure\s+'?([^'=\n]+)'?\s*=\s*(.*?)$", re.MULTILINE
)
_EXPRESSION_CONT_RE = re.compile(r"^\t{2,}(.+)$", re.MULTILINE)
_REL_RE = re.compile(
    r"relationship\s+\S+.*?"
    r"fromColumn\s*:\s*'?([^'\n]+)'?.*?"
    r"toColumn\s*:\s*'?([^'\n]+)'?",
    re.DOTALL | re.IGNORECASE,
)


def _parse_tmdl_table_file(content: str, rel_path: str, result: ExtractionResult) -> None:
    """Parse a single TMDL file that likely defines a table."""
    lines = content.split("\n")

    # Find table declaration
    table_name: str | None = None
    columns: list[ExtractedColumn] = []
    measures: list[ExtractedMeasure] = []

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Table declaration
        if stripped.startswith("table ") and table_name is None:
            table_name = _unquote(stripped[6:].strip())
            i += 1
            continue

        # Column declaration
        if stripped.startswith("column "):
            col_name = _unquote(stripped[7:].strip())
            data_type = None
            is_key = False
            source_expr = None
            i += 1
            # Read column properties (indented further)
            while i < len(lines) and lines[i].startswith("\t\t"):
                prop_line = lines[i].strip()
                if prop_line.startswith("dataType"):
                    data_type = prop_line.split(":", 1)[1].strip() if ":" in prop_line else None
                elif prop_line.startswith("isKey"):
                    is_key = "true" in prop_line.lower()
                elif prop_line.startswith("sourceColumn"):
                    source_expr = prop_line.split(":", 1)[1].strip() if ":" in prop_line else None
                i += 1
            columns.append(
                ExtractedColumn(
                    column_name=col_name,
                    data_type=data_type,
                    is_key=is_key,
                    source_expression=source_expr,
                    ordinal=len(columns),
                )
            )
            continue

        # Measure declaration
        if stripped.startswith("measure "):
            rest = stripped[8:].strip()
            # Format: measure 'Name' = EXPRESSION
            parts = rest.split("=", 1)
            m_name = _unquote(parts[0].strip())
            m_expr = parts[1].strip() if len(parts) > 1 else ""
            i += 1
            # Multi-line expression (continuation lines indented with 2+ tabs)
            while i < len(lines) and lines[i].startswith("\t\t"):
                prop_line = lines[i].strip()
                # Stop if it looks like a property (key: value) vs expression continuation
                if re.match(r"^(formatString|description|lineageTag|displayFolder)\s*:", prop_line):
                    i += 1
                    continue
                m_expr += "\n" + prop_line
                i += 1
            measure = ExtractedMeasure(
                measure_name=m_name,
                expression=m_expr.strip(),
                source_table=table_name,
            )
            measures.append(measure)
            result.measures.append(measure)
            continue

        i += 1

    if table_name:
        result.tables.append(
            ExtractedTable(
                name=table_name,
                entity_kind="physical",
                columns=columns,
            )
        )
        result.columns.extend(columns)
    elif columns or measures:
        # Infer table name from file path
        inferred = os.path.splitext(os.path.basename(rel_path))[0]
        result.tables.append(
            ExtractedTable(
                name=inferred,
                entity_kind="unknown",
                columns=columns,
            )
        )
        result.columns.extend(columns)


def _parse_tmdl_relationships(content: str, result: ExtractionResult) -> None:
    """Parse TMDL relationship definitions."""
    lines = content.split("\n")
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped.startswith("relationship "):
            from_table = from_col = to_table = to_col = None
            cardinality = None
            i += 1
            while i < len(lines) and (lines[i].startswith("\t") or lines[i].startswith(" ")):
                prop = lines[i].strip()
                if prop.startswith("fromColumn:"):
                    ref = prop.split(":", 1)[1].strip()
                    from_table, from_col = _parse_tmdl_col_ref(ref)
                elif prop.startswith("toColumn:"):
                    ref = prop.split(":", 1)[1].strip()
                    to_table, to_col = _parse_tmdl_col_ref(ref)
                elif prop.startswith("fromCardinality:"):
                    cardinality = prop.split(":", 1)[1].strip()
                elif prop.startswith("toCardinality:"):
                    to_card = prop.split(":", 1)[1].strip()
                    if cardinality:
                        cardinality = f"{cardinality}-to-{to_card}"
                    else:
                        cardinality = to_card
                i += 1
            if from_table and from_col and to_table and to_col:
                result.relationships.append(
                    ExtractedRelationship(
                        from_entity=from_table,
                        from_column=from_col,
                        to_entity=to_table,
                        to_column=to_col,
                        cardinality=cardinality,
                        detected_from="model_metadata",
                    )
                )
            continue
        i += 1


def _parse_tmdl_col_ref(ref: str) -> tuple[str | None, str | None]:
    """Parse a TMDL column reference like 'TableName'[ColumnName]."""
    m = re.match(r"'?([^'\[\]]+)'?\s*\[([^\]]+)\]", ref)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    # Fallback: dot notation
    parts = ref.split(".", 1)
    if len(parts) == 2:
        return _unquote(parts[0]), _unquote(parts[1])
    return None, None


def _unquote(s: str) -> str:
    """Remove surrounding single quotes from a TMDL identifier."""
    s = s.strip()
    if s.startswith("'") and s.endswith("'") and len(s) >= 2:
        return s[1:-1]
    return s
