"""
FMD v3 Engine — Pandera schema validation step.

Validates extracted DataFrames against registered Pandera schemas.
Tables without schemas pass with a warning (no blocking).

Validation modes:
- "enforce": Fail the entity if validation fails (block upload)
- "warn": Log warnings but allow upload to proceed
- "off": Skip validation entirely
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Optional

import polars as pl

from engine.schemas import get_schema

log = logging.getLogger("fmd.schema_validator")


@dataclass
class ValidationResult:
    """Result of a schema validation run."""
    passed: bool
    error_count: int = 0
    errors: list[dict] = field(default_factory=list)
    schema_name: Optional[str] = None
    has_schema: bool = False

    @property
    def errors_json(self) -> str:
        return json.dumps(self.errors) if self.errors else "[]"


def validate_extraction(
    df: pl.DataFrame,
    database: str,
    table: str,
    mode: str = "warn",
) -> ValidationResult:
    """Validate an extracted DataFrame against its registered Pandera schema.

    Parameters
    ----------
    df : pl.DataFrame
        The extracted data.
    database : str
        Source database name (e.g., "m3fdbprd").
    table : str
        Source table name (e.g., "MITMAS").
    mode : str
        Validation mode: "enforce", "warn", or "off".

    Returns
    -------
    ValidationResult
        Contains pass/fail status and error details.
    """
    if mode == "off":
        return ValidationResult(passed=True)

    schema_cls = get_schema(database, table)

    if schema_cls is None:
        log.debug("No schema registered for %s.%s — skipping validation", database, table)
        return ValidationResult(passed=True, has_schema=False)

    schema_name = schema_cls.__name__

    try:
        schema_cls.validate(df, lazy=True)
        log.info("Schema validation PASSED: %s.%s (%s)", database, table, schema_name)
        return ValidationResult(passed=True, has_schema=True, schema_name=schema_name)

    except Exception as exc:
        # Pandera raises SchemaErrors with per-column failure details
        errors = _parse_validation_errors(exc)
        error_count = len(errors)

        if mode == "enforce":
            log.error(
                "Schema validation FAILED (enforce): %s.%s (%s) — %d errors",
                database, table, schema_name, error_count,
            )
        else:
            log.warning(
                "Schema validation FAILED (warn): %s.%s (%s) — %d errors (proceeding)",
                database, table, schema_name, error_count,
            )

        return ValidationResult(
            passed=False,
            error_count=error_count,
            errors=errors,
            schema_name=schema_name,
            has_schema=True,
        )


def _parse_validation_errors(exc: Exception) -> list[dict]:
    """Extract structured error details from a Pandera exception."""
    errors = []
    try:
        # Pandera SchemaErrors have a .schema_errors attribute
        if hasattr(exc, "schema_errors"):
            for err in exc.schema_errors:
                errors.append({
                    "column": str(getattr(err, "column", "unknown")),
                    "check": str(getattr(err, "check", "unknown")),
                    "message": str(err),
                })
        elif hasattr(exc, "failure_cases"):
            # Alternative: failure_cases DataFrame
            fc = exc.failure_cases
            if hasattr(fc, "to_dicts"):
                for row in fc.to_dicts():
                    errors.append({
                        "column": str(row.get("column", "unknown")),
                        "check": str(row.get("check", "unknown")),
                        "message": str(row.get("failure_case", "")),
                    })
        if not errors:
            errors.append({"column": "unknown", "check": "unknown", "message": str(exc)})
    except Exception:
        errors.append({"column": "unknown", "check": "parse_error", "message": str(exc)})
    return errors
