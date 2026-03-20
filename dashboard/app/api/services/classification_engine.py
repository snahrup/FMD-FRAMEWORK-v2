"""Classification engine — column-level sensitivity classification.

Pure logic module (no HTTP routes).  Called by classification.py route.

Functions:
    classify_column_name(column_name) -> sensitivity level string
    classify_by_pattern(entity_id=None) -> result dict
    classify_by_presidio(entity_id=None) -> result dict (skips if not installed)
    get_classification_summary() -> ClassificationSummary-shaped dict
"""
import logging
import re
from datetime import datetime, timezone

import dashboard.app.api.control_plane_db as cpdb

log = logging.getLogger("fmd.services.classification_engine")

# ---------------------------------------------------------------------------
# Pattern rules
# Priority order (high → low): pii > restricted > confidential > internal > public
# ---------------------------------------------------------------------------

COLUMN_PATTERNS: dict[str, list[str]] = {
    "pii": [
        r"ssn", r"social.?security", r"email", r"e.?mail",
        r"phone", r"mobile", r"cell.?num", r"first.?name", r"last.?name",
        r"full.?name", r"given.?name", r"surname", r"dob", r"date.?of.?birth",
        r"birth.?date", r"address", r"street", r"zip.?code", r"postal.?code",
        r"driver.?licen", r"passport",
    ],
    "restricted": [
        r"medical", r"diagnosis", r"health.?record", r"criminal", r"conviction",
        r"arrest",
    ],
    "confidential": [
        r"salary", r"compensation", r"bonus", r"bank.?account", r"account.?num",
        r"credit.?card", r"card.?num", r"password", r"passwd", r"pwd",
        r"price", r"cost", r"margin", r"revenue",
    ],
    "internal": [
        r"employee.?id", r"emp.?id", r"department", r"dept", r"audit",
        r"created.?by", r"modified.?by", r"updated.?by",
    ],
}

_PRIORITY = ["pii", "restricted", "confidential", "internal"]

# Pre-compile patterns once
_COMPILED: dict[str, list[re.Pattern]] = {
    level: [re.compile(p, re.IGNORECASE) for p in patterns]
    for level, patterns in COLUMN_PATTERNS.items()
}

_STRING_TYPES = {"varchar", "nvarchar", "char", "nchar", "text"}

# Regex for safe SQL identifiers (letters, digits, underscores, spaces, hyphens)
_SAFE_IDENT_RE = re.compile(r"^[\w\s\-]+$", re.UNICODE)


def _validate_identifier(name: str, kind: str = "identifier") -> str:
    """Validate that a SQL identifier contains only safe characters.

    Raises ValueError if the name contains characters outside the allow-list.
    """
    if not name or not _SAFE_IDENT_RE.match(name):
        raise ValueError(f"Unsafe SQL {kind}: {name!r}")
    return name


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def classify_column_name(column_name: str) -> str:
    """Return sensitivity level for a column name using regex pattern matching.

    Priority: pii > restricted > confidential > internal > public
    """
    for level in _PRIORITY:
        for pattern in _COMPILED[level]:
            if pattern.search(column_name):
                return level
    return "public"


def classify_by_pattern(entity_id: int | None = None) -> dict:
    """Run pattern-based classification on all (or one entity's) columns.

    Reads column_metadata, writes classified results to column_classifications.
    Returns a summary dict with counts.
    """
    conn = cpdb._get_conn()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    classified = 0
    skipped = 0

    try:
        if entity_id is not None:
            rows = conn.execute(
                "SELECT entity_id, layer, column_name FROM column_metadata WHERE entity_id = ?",
                (entity_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT entity_id, layer, column_name FROM column_metadata"
            ).fetchall()

        for row in rows:
            eid = row["entity_id"]
            layer = row["layer"]
            col = row["column_name"]
            level = classify_column_name(col)

            try:
                conn.execute(
                    """
                    INSERT INTO column_classifications
                        (entity_id, layer, column_name, sensitivity_level,
                         certification_status, classified_by, confidence, classified_at)
                    VALUES (?, ?, ?, ?, 'none', 'auto:pattern', 1.0, ?)
                    ON CONFLICT(entity_id, layer, column_name) DO UPDATE SET
                        sensitivity_level   = excluded.sensitivity_level,
                        classified_by       = excluded.classified_by,
                        confidence          = excluded.confidence,
                        classified_at       = excluded.classified_at
                    """,
                    (eid, layer, col, level, now),
                )
                classified += 1
            except Exception as exc:
                log.warning("classify_by_pattern: write failed for %s.%s: %s", eid, col, exc)
                skipped += 1

        conn.commit()

    except Exception as exc:
        log.error("classify_by_pattern failed: %s", exc)
        return {"classified": 0, "skipped": 0, "error": str(exc)[:300]}
    finally:
        conn.close()

    log.info("classify_by_pattern: %d classified, %d skipped", classified, skipped)
    return {"classified": classified, "skipped": skipped}


def classify_by_presidio(entity_id: int | None = None) -> dict:
    """Run Presidio PII scan on string columns, upgrading classification where needed.

    Gracefully skips if presidio-analyzer is not installed.
    Samples up to 100 rows per entity/layer/table via _query_lakehouse.
    """
    try:
        from presidio_analyzer import AnalyzerEngine  # type: ignore
    except ImportError:
        log.warning("classify_by_presidio: presidio-analyzer not installed — skipping Presidio scan")
        return {"skipped": True, "reason": "presidio-analyzer not installed"}

    # Lazy import to avoid circular dependency at module load
    from dashboard.app.api.routes.data_access import _query_lakehouse, _sanitize

    try:
        analyzer = AnalyzerEngine()
    except Exception as exc:
        log.warning("classify_by_presidio: AnalyzerEngine init failed: %s", exc)
        return {"skipped": True, "reason": str(exc)[:200]}

    conn = cpdb._get_conn()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    upgraded = 0
    scanned = 0
    errors = 0

    try:
        # Get string columns — only from landing layer since source schema/table
        # names only match the landing lakehouse (bronze/silver use different schemas)
        base_query = (
            "SELECT cm.entity_id, cm.layer, cm.column_name, cm.data_type, "
            "       e.SourceSchema, e.SourceName, lh.Name AS lakehouse_name "
            "FROM column_metadata cm "
            "JOIN lz_entities e ON cm.entity_id = e.LandingzoneEntityId "
            "JOIN lakehouses lh ON e.LakehouseId = lh.LakehouseId "
            "WHERE cm.layer = 'landing' AND LOWER(cm.data_type) IN "
            "('varchar','nvarchar','char','nchar','text')"
        )
        if entity_id is not None:
            base_query += " AND cm.entity_id = ?"
            rows = conn.execute(base_query, (entity_id,)).fetchall()
        else:
            rows = conn.execute(base_query).fetchall()

        # Group columns by entity to batch queries per table
        from collections import defaultdict
        by_entity: dict[tuple, list[dict]] = defaultdict(list)
        for row in rows:
            key = (row["entity_id"], row["SourceSchema"], row["SourceName"], row["lakehouse_name"])
            by_entity[key].append(row)

        for (eid, schema, table, lh_name), col_rows in by_entity.items():
            if not lh_name or not table:
                continue

            s_schema = _sanitize(_validate_identifier(schema or "dbo", "schema"))
            s_table = _sanitize(_validate_identifier(table, "table"))

            # Build a single SELECT with all string columns for this table
            col_names = [row["column_name"] for row in col_rows]

            for col in col_names:
                s_col = _sanitize(_validate_identifier(col, "column"))
                try:
                    sample_rows = _query_lakehouse(
                        lh_name,
                        "SELECT TOP 100 [{}] FROM [{}].[{}] "
                        "WHERE [{}] IS NOT NULL".format(s_col, s_schema, s_table, s_col),
                    )
                    scanned += 1
                except Exception as exc:
                    log.debug("presidio sample failed for %s.%s.%s: %s", lh_name, table, col, exc)
                    errors += 1
                    continue

                # Run Presidio on each sampled value
                pii_found = False
                pii_entities: list[str] = []
                for sample in sample_rows:
                    val = list(sample.values())[0] if sample else None
                    if not val or not isinstance(val, str):
                        continue
                    try:
                        results = analyzer.analyze(text=val[:500], language="en")
                        if results:
                            pii_found = True
                            for r in results:
                                if r.entity_type not in pii_entities:
                                    pii_entities.append(r.entity_type)
                    except Exception as e:
                        log.debug("Presidio analysis failed for a sample value: %s", e)

                if pii_found:
                    pii_str = ",".join(pii_entities[:10])
                    layer = col_rows[0]["layer"]  # all rows share same layer (landing)
                    try:
                        conn.execute(
                            """
                            INSERT INTO column_classifications
                                (entity_id, layer, column_name, sensitivity_level,
                                 certification_status, classified_by, confidence,
                                 pii_entities, classified_at)
                            VALUES (?, ?, ?, 'pii', 'none', 'auto:presidio', 0.9, ?, ?)
                            ON CONFLICT(entity_id, layer, column_name) DO UPDATE SET
                                sensitivity_level   = 'pii',
                                classified_by       = 'auto:presidio',
                                confidence          = 0.9,
                                pii_entities        = excluded.pii_entities,
                                classified_at       = excluded.classified_at
                            """,
                            (eid, layer, col, pii_str, now),
                        )
                        upgraded += 1
                    except Exception as exc:
                        log.warning("presidio write failed for %s.%s: %s", eid, col, exc)

        conn.commit()

    except Exception as exc:
        log.error("classify_by_presidio failed: %s", exc)
        return {"skipped": False, "scanned": scanned, "upgraded": upgraded,
                "errors": errors, "error": str(exc)[:300]}
    finally:
        conn.close()

    log.info("classify_by_presidio: %d scanned, %d upgraded, %d errors", scanned, upgraded, errors)
    return {"skipped": False, "scanned": scanned, "upgraded": upgraded, "errors": errors}


def get_classification_summary() -> dict:
    """Return ClassificationSummary shape matching governance.ts.

    Shape:
        {
            totalEntities: int,
            totalColumns: int,
            classifiedColumns: int,   # non-'public'
            coveragePercent: float,
            bySensitivity: {public, internal, confidential, restricted, pii},
            byCertification: {certified, pending, draft, deprecated, none},
            bySource: [
                {source, total, classified, piiCount, confidentialCount}
            ]
        }
    """
    conn = cpdb._get_conn()
    try:
        # Total entities (from lz_entities, active)
        total_entities_row = conn.execute(
            "SELECT COUNT(*) AS n FROM lz_entities WHERE IsActive = 1"
        ).fetchone()
        total_entities = int(total_entities_row["n"]) if total_entities_row else 0

        # Total columns cached
        total_cols_row = conn.execute(
            "SELECT COUNT(*) AS n FROM column_metadata"
        ).fetchone()
        total_cols = int(total_cols_row["n"]) if total_cols_row else 0

        # By sensitivity
        sens_rows = conn.execute(
            "SELECT sensitivity_level, COUNT(*) AS n FROM column_classifications GROUP BY sensitivity_level"
        ).fetchall()
        by_sensitivity: dict[str, int] = {
            "public": 0, "internal": 0, "confidential": 0, "restricted": 0, "pii": 0
        }
        for r in sens_rows:
            lvl = r["sensitivity_level"] or "public"
            if lvl in by_sensitivity:
                by_sensitivity[lvl] = int(r["n"])

        # classifiedColumns = count of columns actually in column_classifications
        # that have a non-public sensitivity level
        total_classified = sum(by_sensitivity.values())
        classified_cols = total_classified - by_sensitivity["public"]
        coverage = round(total_classified / total_cols * 100, 1) if total_cols > 0 else 0.0

        # By certification
        cert_rows = conn.execute(
            "SELECT certification_status, COUNT(*) AS n FROM column_classifications GROUP BY certification_status"
        ).fetchall()
        by_cert: dict[str, int] = {
            "certified": 0, "pending": 0, "draft": 0, "deprecated": 0, "none": total_cols
        }
        # If no classifications yet, "none" = totalColumns
        for r in cert_rows:
            cs = r["certification_status"] or "none"
            if cs in by_cert:
                by_cert[cs] = int(r["n"])
        # Recalculate 'none' as total minus any explicit certification rows
        explicit = sum(by_cert[k] for k in ("certified", "pending", "draft", "deprecated"))
        by_cert["none"] = max(0, total_cols - explicit)

        # By source — join lz_entities → datasources → column_metadata → column_classifications
        by_source_rows = conn.execute(
            """
            SELECT ds.Namespace AS source,
                   COUNT(DISTINCT cm.id) AS total,
                   SUM(CASE WHEN cc.sensitivity_level != 'public' AND cc.sensitivity_level IS NOT NULL THEN 1 ELSE 0 END) AS classified,
                   SUM(CASE WHEN cc.sensitivity_level = 'pii' THEN 1 ELSE 0 END) AS pii_count,
                   SUM(CASE WHEN cc.sensitivity_level = 'confidential' THEN 1 ELSE 0 END) AS conf_count
            FROM column_metadata cm
            JOIN lz_entities e ON cm.entity_id = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            LEFT JOIN column_classifications cc
                   ON cc.entity_id = cm.entity_id
                  AND cc.layer = cm.layer
                  AND cc.column_name = cm.column_name
            GROUP BY ds.Namespace
            ORDER BY ds.Namespace
            """
        ).fetchall()

        by_source = [
            {
                "source": r["source"] or "Unknown",
                "total": int(r["total"]) if r["total"] else 0,
                "classified": int(r["classified"]) if r["classified"] else 0,
                "piiCount": int(r["pii_count"]) if r["pii_count"] else 0,
                "confidentialCount": int(r["conf_count"]) if r["conf_count"] else 0,
            }
            for r in by_source_rows
        ]

    except Exception as exc:
        log.error("get_classification_summary failed: %s", exc)
        return {
            "totalEntities": 0,
            "totalColumns": 0,
            "classifiedColumns": 0,
            "coveragePercent": 0.0,
            "bySensitivity": {"public": 0, "internal": 0, "confidential": 0, "restricted": 0, "pii": 0},
            "byCertification": {"certified": 0, "pending": 0, "draft": 0, "deprecated": 0, "none": 0},
            "bySource": [],
        }
    finally:
        conn.close()

    return {
        "totalEntities": total_entities,
        "totalColumns": total_cols,
        "classifiedColumns": classified_cols,
        "coveragePercent": coverage,
        "bySensitivity": by_sensitivity,
        "byCertification": by_cert,
        "bySource": by_source,
    }
