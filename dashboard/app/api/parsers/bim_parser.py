"""BIM (Tabular Model JSON) parser.

Parses Analysis Services Tabular model ``model.bim`` files and extracts
tables, columns, measures, relationships, and partition source queries.

All extracted string values are HTML-escaped to prevent injection when
rendered in UI.
"""

from __future__ import annotations

import html
import json
import logging
import os

from dashboard.app.api.parsers.base import (
    ExtractionResult,
    ExtractedColumn,
    ExtractedMeasure,
    ExtractedRelationship,
    ExtractedTable,
)

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_DEPTH = 100


def _esc(value: str | None) -> str | None:
    """HTML-escape a string value, pass through None."""
    return html.escape(value, quote=True) if value else value


def _check_depth(obj, current: int = 0, limit: int = MAX_DEPTH) -> bool:
    """Return True if the JSON nesting depth exceeds *limit*."""
    if current > limit:
        return True
    if isinstance(obj, dict):
        return any(_check_depth(v, current + 1, limit) for v in obj.values())
    if isinstance(obj, list):
        return any(_check_depth(v, current + 1, limit) for v in obj)
    return False


def parse_bim(file_path: str) -> ExtractionResult:
    """Parse a model.bim JSON file and extract tabular model metadata.

    Args:
        file_path: Absolute path to the .bim file.

    Returns:
        ExtractionResult populated with tables, measures, relationships.
    """
    result = ExtractionResult()

    # ── validate file ────────────────────────────────────────────────────
    if not os.path.isfile(file_path):
        result.errors.append(f"File not found: {file_path}")
        return result

    file_size = os.path.getsize(file_path)
    if file_size > MAX_FILE_SIZE:
        result.errors.append(
            f"File exceeds 50 MB limit ({file_size / 1024 / 1024:.1f} MB): {file_path}"
        )
        return result

    if file_size == 0:
        result.warnings.append(f"Empty file: {file_path}")
        return result

    # ── parse JSON ───────────────────────────────────────────────────────
    try:
        with open(file_path, "r", encoding="utf-8-sig") as fh:
            raw = fh.read()
    except Exception as exc:
        result.errors.append(f"Error reading {file_path}: {exc}")
        return result

    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        result.errors.append(f"JSON parse error: {exc}")
        return result

    if _check_depth(doc):
        result.errors.append(
            f"JSON nesting depth exceeds {MAX_DEPTH} levels — possible abuse."
        )
        return result

    # ── navigate to model root ───────────────────────────────────────────
    model = doc.get("model", doc)  # some files wrap in {"model": {...}}

    _extract_tables(model, result)
    _extract_relationships(model, result)

    if not result.tables:
        result.warnings.append("No tables found in BIM file.")

    return result


def parse_bim_from_dict(model: dict) -> ExtractionResult:
    """Parse tabular model metadata from an already-loaded dict.

    Shared entry point used by pbix_parser when it extracts
    DataModelSchema JSON from inside a PBIX archive.
    """
    result = ExtractionResult()
    # Handle both {"model": {...}} wrapper and bare model dict
    if "model" in model and isinstance(model["model"], dict):
        model = model["model"]
    _extract_tables(model, result)
    _extract_relationships(model, result)
    return result


# ── internal helpers ─────────────────────────────────────────────────────


def _extract_tables(model: dict, result: ExtractionResult) -> None:
    """Extract tables, columns, partitions, and measures."""
    tables = model.get("tables", [])
    if not isinstance(tables, list):
        result.warnings.append("model.tables is not a list — skipping.")
        return

    for tbl in tables:
        if not isinstance(tbl, dict):
            continue

        tbl_name = _esc(tbl.get("name", "unknown"))
        if not tbl_name:
            continue

        # Columns
        columns: list[ExtractedColumn] = []
        for idx, col in enumerate(tbl.get("columns", [])):
            if not isinstance(col, dict):
                continue
            col_name = _esc(col.get("name", f"col_{idx}"))
            columns.append(
                ExtractedColumn(
                    column_name=col_name or f"col_{idx}",
                    data_type=_esc(col.get("dataType")),
                    source_expression=_esc(col.get("expression")),
                    is_calculated=bool(col.get("type") == "calculated" or col.get("expression")),
                    ordinal=idx,
                    nullable=not col.get("isKey", False),
                    is_key=col.get("isKey", False),
                )
            )

        # Partitions (source queries / storage mode)
        partitions = tbl.get("partitions", [])
        source_query: str | None = None
        storage_mode: str | None = _esc(tbl.get("mode")) or None
        entity_kind = "physical"
        for part in partitions:
            if not isinstance(part, dict):
                continue
            src = part.get("source", {})
            if isinstance(src, dict):
                expr = src.get("expression")
                if isinstance(expr, list):
                    expr = "\n".join(expr)
                if expr:
                    source_query = _esc(str(expr))
                src_type = src.get("type", "")
                if src_type == "calculated":
                    entity_kind = "calculated"
                elif src_type == "m":
                    entity_kind = "view"
            part_mode = part.get("mode")
            if part_mode:
                storage_mode = _esc(str(part_mode))

        # Measures
        measures: list[ExtractedMeasure] = []
        for m in tbl.get("measures", []):
            if not isinstance(m, dict):
                continue
            m_name = _esc(m.get("name", ""))
            m_expr = m.get("expression", "")
            if isinstance(m_expr, list):
                m_expr = "\n".join(m_expr)
            m_expr = _esc(str(m_expr)) or ""
            if m_name:
                measure = ExtractedMeasure(
                    measure_name=m_name,
                    expression=m_expr,
                    description=_esc(m.get("description")),
                    source_table=tbl_name,
                )
                measures.append(measure)
                result.measures.append(measure)

        table = ExtractedTable(
            name=tbl_name,
            entity_kind=entity_kind,
            columns=columns,
        )
        result.tables.append(table)
        result.columns.extend(columns)

        # Attach source query as a query record
        if source_query:
            from dashboard.app.api.parsers.base import ExtractedQuery

            result.queries.append(
                ExtractedQuery(
                    query_name=f"{tbl_name}_partition",
                    query_text=source_query,
                    query_type="m_query",
                )
            )


def _extract_relationships(model: dict, result: ExtractionResult) -> None:
    """Extract relationships from the model."""
    rels = model.get("relationships", [])
    if not isinstance(rels, list):
        return

    for rel in rels:
        if not isinstance(rel, dict):
            continue

        from_table = _esc(rel.get("fromTable", ""))
        from_col = _esc(rel.get("fromColumn", ""))
        to_table = _esc(rel.get("toTable", ""))
        to_col = _esc(rel.get("toColumn", ""))

        if not (from_table and from_col and to_table and to_col):
            result.warnings.append(
                f"Incomplete relationship: {rel.get('name', 'unnamed')} — skipping."
            )
            continue

        cardinality = _esc(rel.get("fromCardinality", ""))
        to_card = _esc(rel.get("toCardinality", ""))
        if cardinality and to_card:
            cardinality = f"{cardinality}-to-{to_card}"
        cross_filter = _esc(rel.get("crossFilteringBehavior"))
        is_active = rel.get("isActive", True)

        result.relationships.append(
            ExtractedRelationship(
                from_entity=from_table,
                from_column=from_col,
                to_entity=to_table,
                to_column=to_col,
                cardinality=cardinality or None,
                join_type=cross_filter,
                detected_from="model_metadata",
            )
        )
