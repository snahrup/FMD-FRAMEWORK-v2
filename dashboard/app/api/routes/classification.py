"""Classification routes — column-level PII/sensitivity scanning and results.

Endpoints:
    POST /api/classification/scan    — trigger background scan
    GET  /api/classification/status  — current scan job state
    GET  /api/classification/summary — ClassificationSummary
    GET  /api/classification/data    — paginated classified column results
"""
import logging
import threading
import uuid
from datetime import datetime, timezone

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db
import dashboard.app.api.control_plane_db as cpdb

log = logging.getLogger("fmd.routes.classification")

# ---------------------------------------------------------------------------
# Scan job state — single global job (last one wins)
# ---------------------------------------------------------------------------

_scan_job: dict = {
    "jobId": None,
    "phase": "idle",
    "progress": 0,
    "detail": "",
    "started_at": None,
    "finished_at": None,
    "error": None,
    "result": None,
}
_scan_lock = threading.Lock()


def _update_job(**kwargs) -> None:
    with _scan_lock:
        _scan_job.update(kwargs)


# ---------------------------------------------------------------------------
# Background scan worker
# ---------------------------------------------------------------------------

def _run_scan(job_id: str) -> None:
    """Multi-phase classification scan — runs in a daemon thread."""
    from dashboard.app.api.services.classification_engine import (
        classify_by_pattern,
        classify_by_presidio,
    )
    from dashboard.app.api.routes.lineage import _query_lakehouse_columns, _cache_columns

    try:
        # ── Phase 1: capture schemas ──────────────────────────────────────────
        _update_job(phase="capturing_schemas", progress=5,
                    detail="Querying entity list from SQLite")

        # Load all active entities that have been loaded to at least one layer
        # entity_status uses LandingzoneEntityId + LOWERCASE layer values
        loaded_rows = db.query(
            """
            SELECT DISTINCT e.LandingzoneEntityId AS entity_id,
                   e.SourceSchema, e.SourceName,
                   lh.Name AS lz_lakehouse,
                   es.Layer
            FROM lz_entities e
            JOIN entity_status es ON es.LandingzoneEntityId = e.LandingzoneEntityId
            LEFT JOIN lakehouses lh ON e.LakehouseId = lh.LakehouseId
            WHERE e.IsActive = 1
              AND es.Status = 'loaded'
              AND es.Layer = 'landing'
            ORDER BY e.LandingzoneEntityId
            """
        )

        total = len(loaded_rows)
        _update_job(detail=f"Found {total} loaded entities")

        for i, row in enumerate(loaded_rows):
            entity_id = int(row["entity_id"])
            schema = row["SourceSchema"] or "dbo"
            table = row["SourceName"] or ""
            lh_name = row["lz_lakehouse"] or ""

            if not table or not lh_name:
                continue

            pct = 5 + int((i / max(total, 1)) * 25)
            _update_job(progress=pct, detail=f"Capturing schema: {schema}.{table}")

            try:
                cols = _query_lakehouse_columns(lh_name, schema, table)
                if cols:
                    _cache_columns(entity_id, "landing", cols)
            except Exception as exc:
                log.debug("Schema capture failed for entity %d (%s.%s): %s",
                          entity_id, schema, table, exc)

        _update_job(progress=30, detail="Schema capture complete")

        # ── Phase 2: pattern classification ───────────────────────────────────
        _update_job(phase="classifying_patterns", progress=35,
                    detail="Running pattern-based classification")

        pattern_result = classify_by_pattern()
        classified = pattern_result.get("classified", 0)
        _update_job(progress=65, detail=f"Pattern classified {classified} columns")

        # ── Phase 3: Presidio scan ────────────────────────────────────────────
        _update_job(phase="presidio_scan", progress=70,
                    detail="Running Presidio PII scan (skips if not installed)")

        presidio_result = classify_by_presidio()
        if presidio_result.get("skipped"):
            _update_job(detail="Presidio not installed — skipped")
        else:
            upgraded = presidio_result.get("upgraded", 0)
            _update_job(detail=f"Presidio upgraded {upgraded} columns to PII")

        # ── Complete ──────────────────────────────────────────────────────────
        _update_job(
            phase="complete",
            progress=100,
            detail="Classification scan complete",
            finished_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            result={
                "patternResult": pattern_result,
                "presidioResult": presidio_result,
            },
        )
        log.info("Classification scan %s complete", job_id)

    except Exception as exc:
        log.exception("Classification scan %s failed: %s", job_id, exc)
        _update_job(
            phase="failed",
            detail=str(exc)[:300],
            error=str(exc)[:300],
            finished_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        )


# ---------------------------------------------------------------------------
# POST /api/classification/scan
# ---------------------------------------------------------------------------

@route("POST", "/api/classification/scan")
def post_classification_scan(params: dict) -> dict:
    """Trigger a background classification scan.  Returns the job ID immediately."""
    with _scan_lock:
        current_phase = _scan_job.get("phase", "idle")

    if current_phase not in ("idle", "complete", "failed"):
        return {"jobId": _scan_job.get("jobId"), "status": "already_running",
                "phase": current_phase}

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    _update_job(
        jobId=job_id,
        phase="starting",
        progress=0,
        detail="Scan queued",
        started_at=now,
        finished_at=None,
        error=None,
        result=None,
    )

    t = threading.Thread(target=_run_scan, args=(job_id,), daemon=True)
    t.start()
    log.info("Classification scan %s started", job_id)
    return {"jobId": job_id, "status": "started"}


# ---------------------------------------------------------------------------
# GET /api/classification/status
# ---------------------------------------------------------------------------

@route("GET", "/api/classification/status")
def get_classification_status(params: dict) -> dict:
    """Return current scan job state."""
    with _scan_lock:
        return dict(_scan_job)


# ---------------------------------------------------------------------------
# GET /api/classification/summary
# ---------------------------------------------------------------------------

@route("GET", "/api/classification/summary")
def get_classification_summary_route(params: dict) -> dict:
    """Delegate to classification engine summary function."""
    from dashboard.app.api.services.classification_engine import get_classification_summary
    return get_classification_summary()


# ---------------------------------------------------------------------------
# GET /api/classification/data
# ---------------------------------------------------------------------------

@route("GET", "/api/classification/data")
def get_classification_data(params: dict) -> dict:
    """Paginated classified column results.

    Query params:
        page    int  (default 1)
        size    int  (default 50)
        source  str  (filter by datasource Namespace)
        level   str  (filter by sensitivity_level)
    """
    try:
        page = max(1, int(params.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        size = min(200, max(1, int(params.get("size", 50))))
    except (TypeError, ValueError):
        size = 50

    source_filter = params.get("source", "").strip()
    level_filter = params.get("level", "").strip()

    offset = (page - 1) * size

    conn = cpdb._get_conn()
    try:
        # Build WHERE clauses
        where_clauses = []
        bind: list = []

        if source_filter:
            where_clauses.append("ds.Namespace = ?")
            bind.append(source_filter)
        if level_filter:
            where_clauses.append("cc.sensitivity_level = ?")
            bind.append(level_filter)

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        count_row = conn.execute(
            f"""
            SELECT COUNT(*) AS n
            FROM column_classifications cc
            JOIN column_metadata cm
                ON cc.entity_id = cm.entity_id
               AND cc.layer     = cm.layer
               AND cc.column_name = cm.column_name
            JOIN lz_entities e ON cc.entity_id = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            {where_sql}
            """,
            bind,
        ).fetchone()
        total = int(count_row["n"]) if count_row else 0

        rows = conn.execute(
            f"""
            SELECT cc.entity_id, cc.layer, cc.column_name,
                   cc.sensitivity_level, cc.certification_status,
                   cc.classified_by, cc.confidence, cc.pii_entities, cc.classified_at,
                   cm.data_type, cm.ordinal_position,
                   e.SourceSchema, e.SourceName,
                   ds.Namespace AS source
            FROM column_classifications cc
            JOIN column_metadata cm
                ON cc.entity_id = cm.entity_id
               AND cc.layer     = cm.layer
               AND cc.column_name = cm.column_name
            JOIN lz_entities e ON cc.entity_id = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            {where_sql}
            ORDER BY cc.sensitivity_level DESC, ds.Namespace, e.SourceName, cc.column_name
            LIMIT ? OFFSET ?
            """,
            bind + [size, offset],
        ).fetchall()

    except Exception as exc:
        log.error("get_classification_data failed: %s", exc)
        raise HttpError(f"Classification data query failed: {exc!s:.200}", 500)
    finally:
        conn.close()

    items = [
        {
            "entityId": r["entity_id"],
            "layer": r["layer"],
            "columnName": r["column_name"],
            "dataType": r["data_type"] or "",
            "sensitivityLevel": r["sensitivity_level"],
            "certificationStatus": r["certification_status"] or "none",
            "classifiedBy": r["classified_by"],
            "confidence": r["confidence"],
            "piiEntities": r["pii_entities"],
            "classifiedAt": r["classified_at"],
            "sourceSchema": r["SourceSchema"],
            "sourceName": r["SourceName"],
            "source": r["source"],
        }
        for r in rows
    ]

    return {
        "total": total,
        "page": page,
        "size": size,
        "pages": max(1, (total + size - 1) // size),
        "items": items,
    }
