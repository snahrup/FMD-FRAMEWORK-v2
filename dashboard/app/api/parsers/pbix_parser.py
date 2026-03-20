"""PBIX (Power BI Desktop) ZIP archive parser.

Extracts the DataModelSchema (tabular model JSON) and Report/Layout
metadata from inside a .pbix archive.

ZIP bomb protection:
- Max decompressed size: 500 MB
- Max entries: 10,000
- Max nesting: 3 levels (ZIP inside ZIP)
- Streaming decompression with running size counter
"""

from __future__ import annotations

import io
import json
import logging
import os
import zipfile

from dashboard.app.api.parsers.base import ExtractionResult, ExtractedTable
from dashboard.app.api.parsers.bim_parser import parse_bim_from_dict

logger = logging.getLogger(__name__)

MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024  # 500 MB
MAX_ENTRIES = 10_000
MAX_NESTING = 3
READ_CHUNK = 64 * 1024  # 64 KB streaming chunks


def parse_pbix(file_path: str) -> ExtractionResult:
    """Parse a .pbix file and extract tabular model + report metadata.

    Args:
        file_path: Absolute path to the .pbix file.

    Returns:
        ExtractionResult with tables, columns, measures, relationships
        from the embedded DataModelSchema plus report field references.
    """
    result = ExtractionResult()

    # ── validate ─────────────────────────────────────────────────────────
    if not os.path.isfile(file_path):
        result.errors.append(f"File not found: {file_path}")
        return result

    if not zipfile.is_zipfile(file_path):
        result.errors.append(f"Not a valid ZIP archive: {file_path}")
        return result

    # ── open archive ─────────────────────────────────────────────────────
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            entries = zf.infolist()

            if len(entries) > MAX_ENTRIES:
                result.errors.append(
                    f"ZIP contains {len(entries)} entries (max {MAX_ENTRIES}) — possible zip bomb."
                )
                return result

            # Check total uncompressed size declared in headers
            declared_total = sum(e.file_size for e in entries)
            if declared_total > MAX_DECOMPRESSED_SIZE:
                result.errors.append(
                    f"Declared uncompressed size {declared_total / 1024 / 1024:.0f} MB exceeds "
                    f"{MAX_DECOMPRESSED_SIZE / 1024 / 1024:.0f} MB limit."
                )
                return result

            # ── extract DataModelSchema ──────────────────────────────────
            model_schema = _safe_read_entry(zf, "DataModelSchema", result)
            if model_schema:
                _parse_data_model_schema(model_schema, result)

            # ── extract Report/Layout ────────────────────────────────────
            layout_data = _safe_read_entry(zf, "Report/Layout", result)
            if layout_data:
                _parse_report_layout(layout_data, result)

    except zipfile.BadZipFile as exc:
        result.errors.append(f"Corrupt ZIP file: {exc}")
    except Exception as exc:
        result.errors.append(f"Error reading PBIX archive: {exc}")

    return result


def _safe_read_entry(
    zf: zipfile.ZipFile, entry_name: str, result: ExtractionResult
) -> bytes | None:
    """Read a ZIP entry with streaming decompression and size guard.

    Returns the decompressed bytes or None if the entry is missing or
    exceeds the safety limit.
    """
    # Find the entry (case-insensitive match)
    target = None
    for info in zf.infolist():
        if info.filename.lower() == entry_name.lower():
            target = info
            break

    if target is None:
        result.warnings.append(f"Entry '{entry_name}' not found in PBIX archive.")
        return None

    # Reject nested ZIPs
    if target.filename.lower().endswith(".zip"):
        result.warnings.append(f"Skipping nested ZIP entry: {target.filename}")
        return None

    # Stream-read with running size check
    chunks: list[bytes] = []
    total_read = 0
    try:
        with zf.open(target) as entry_fh:
            while True:
                chunk = entry_fh.read(READ_CHUNK)
                if not chunk:
                    break
                total_read += len(chunk)
                if total_read > MAX_DECOMPRESSED_SIZE:
                    result.errors.append(
                        f"Decompressed size of '{entry_name}' exceeds limit during streaming read."
                    )
                    return None
                chunks.append(chunk)
    except Exception as exc:
        result.errors.append(f"Error decompressing '{entry_name}': {exc}")
        return None

    return b"".join(chunks)


def _parse_data_model_schema(raw: bytes, result: ExtractionResult) -> None:
    """Parse the DataModelSchema JSON into the result."""
    # DataModelSchema often has a UTF-16 LE BOM
    text = None
    for encoding in ("utf-16-le", "utf-8-sig", "utf-8"):
        try:
            text = raw.decode(encoding)
            break
        except (UnicodeDecodeError, ValueError):
            continue

    if text is None:
        result.errors.append("Could not decode DataModelSchema with any known encoding.")
        return

    # Strip null bytes sometimes found at the end
    text = text.rstrip("\x00").strip()
    if not text:
        result.warnings.append("DataModelSchema is empty after decoding.")
        return

    try:
        doc = json.loads(text)
    except json.JSONDecodeError as exc:
        result.errors.append(f"DataModelSchema JSON parse error: {exc}")
        return

    # Delegate to the BIM parser logic
    bim_result = parse_bim_from_dict(doc)
    result.tables.extend(bim_result.tables)
    result.columns.extend(bim_result.columns)
    result.queries.extend(bim_result.queries)
    result.measures.extend(bim_result.measures)
    result.relationships.extend(bim_result.relationships)
    result.warnings.extend(bim_result.warnings)
    result.errors.extend(bim_result.errors)


def _parse_report_layout(raw: bytes, result: ExtractionResult) -> None:
    """Extract field references from Report/Layout JSON.

    The Layout JSON contains visual configurations that reference
    model fields. We extract these as additional column references.
    """
    text = None
    for encoding in ("utf-16-le", "utf-8-sig", "utf-8"):
        try:
            text = raw.decode(encoding)
            break
        except (UnicodeDecodeError, ValueError):
            continue

    if text is None:
        result.warnings.append("Could not decode Report/Layout.")
        return

    text = text.rstrip("\x00").strip()
    if not text:
        return

    try:
        layout = json.loads(text)
    except json.JSONDecodeError:
        result.warnings.append("Report/Layout JSON parse failed — skipping visual references.")
        return

    # Walk the layout to find field references in visual configs
    field_refs = set()
    _walk_layout_for_fields(layout, field_refs)

    if field_refs:
        # Store as a synthetic table entry for report field tracking
        from dashboard.app.api.parsers.base import ExtractedColumn

        report_table = ExtractedTable(
            name="_ReportFieldReferences",
            entity_kind="semantic_output",
            columns=[
                ExtractedColumn(column_name=ref, is_calculated=False)
                for ref in sorted(field_refs)
            ],
        )
        result.tables.append(report_table)


def _walk_layout_for_fields(obj, refs: set, depth: int = 0) -> None:
    """Recursively walk layout JSON to find field references.

    Looks for patterns like:
    - {"Column": {"Expression": {"SourceRef": ...}, "Property": "FieldName"}}
    - {"Measure": {"Expression": {"SourceRef": ...}, "Property": "MeasureName"}}
    """
    if depth > 50:  # prevent infinite recursion on pathological layouts
        return

    if isinstance(obj, dict):
        # Check for Column or Measure property references
        for ref_type in ("Column", "Measure"):
            if ref_type in obj and isinstance(obj[ref_type], dict):
                prop = obj[ref_type].get("Property")
                if prop and isinstance(prop, str):
                    # Try to get the source table alias too
                    expr = obj[ref_type].get("Expression", {})
                    source_ref = expr.get("SourceRef", {}) if isinstance(expr, dict) else {}
                    source = source_ref.get("Entity") or source_ref.get("Source") or ""
                    if source:
                        refs.add(f"{source}.{prop}")
                    else:
                        refs.add(prop)

        for v in obj.values():
            _walk_layout_for_fields(v, refs, depth + 1)

    elif isinstance(obj, list):
        for item in obj:
            _walk_layout_for_fields(item, refs, depth + 1)
