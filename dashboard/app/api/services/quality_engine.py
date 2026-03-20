"""Quality scoring engine — composite data quality scores per entity.

Pure logic module (no HTTP routes).  Called by quality.py route.

Quality dimensions (weighted composite):
    completeness  40%  — non-nullable ratio from column_metadata (75 default if no metadata)
    freshness     25%  — hours since last load; 100 if <24h, linear decay to 0 at 168h
    consistency   20%  — COUNT(DISTINCT Layer WHERE Status='loaded') / 3 * 100
    volume        15%  — latest engine_task_log row: succeeded+rows>0 → 100,
                         succeeded+rows=0 → 50, failed → 0, no log → 50

Composite: completeness*0.4 + freshness*0.25 + consistency*0.2 + volume*0.15

Tier mapping:
    >= 90  gold
    >= 70  silver
    >= 50  bronze
    <  50  unclassified

CRITICAL column name notes:
    engine_task_log uses  EntityId  (= LandingzoneEntityId from lz_entities)
    Layer values are LOWERCASE ('landing', 'bronze', 'silver')
    Status values: 'succeeded', 'failed', 'skipped'
"""
import logging
from datetime import datetime, timezone

import dashboard.app.api.control_plane_db as cpdb

log = logging.getLogger("fmd.services.quality_engine")

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _compute_freshness(hours: float | None) -> float:
    """Convert hours-since-last-load to a 0–100 freshness score.

    < 24h  → 100
    24–168h → linear decay from 100 → 0
    > 168h  → 0
    None    → 0  (never loaded)
    """
    if hours is None:
        return 0.0
    if hours < 24.0:
        return 100.0
    if hours >= 168.0:
        return 0.0
    # Linear decay: 100 at 24h, 0 at 168h
    return 100.0 * (168.0 - hours) / (168.0 - 24.0)


def _tier_from_score(score: float) -> str:
    """Map composite score to quality tier label."""
    if score >= 90.0:
        return "gold"
    if score >= 70.0:
        return "silver"
    if score >= 50.0:
        return "bronze"
    return "unclassified"


def _parse_dt(dt_str: str | None) -> datetime | None:
    """Parse ISO8601 datetime string to aware UTC datetime.  Returns None on any failure."""
    if not dt_str:
        return None
    try:
        # Handle both Z-suffix and offset-naive strings
        s = dt_str.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# Core computation
# ---------------------------------------------------------------------------

def compute_quality_scores() -> dict:
    """Compute quality scores for all active LandingzoneEntity rows.

    Reads from: lz_entities, column_metadata, engine_task_log
    Writes to:  quality_scores  (UPSERT by entity_id)

    Returns a summary dict: {scored, tiers: {gold, silver, bronze, unclassified}}
    """
    conn = cpdb._get_conn()
    now_utc = datetime.now(timezone.utc)

    try:
        # ── Load active entities ────────────────────────────────────────────
        entities = conn.execute(
            "SELECT LandingzoneEntityId FROM lz_entities WHERE IsActive = 1"
        ).fetchall()
        entity_ids = [int(r["LandingzoneEntityId"]) for r in entities]

        if not entity_ids:
            log.info("No active entities found — quality scoring skipped")
            return {"scored": 0, "tiers": {"gold": 0, "silver": 0, "bronze": 0, "unclassified": 0}}

        # ── Pre-load column_metadata (is_nullable ratio per entity) ─────────
        # SELECT entity_id, COUNT(*) total, SUM(CASE WHEN is_nullable=0 THEN 1 ELSE 0 END) non_null
        cm_rows = conn.execute(
            """
            SELECT entity_id,
                   COUNT(*) AS total_cols,
                   SUM(CASE WHEN is_nullable = 0 THEN 1 ELSE 0 END) AS non_null_cols
            FROM column_metadata
            GROUP BY entity_id
            """
        ).fetchall()
        # Map: entity_id -> (total_cols, non_null_cols)
        col_meta: dict[int, tuple[int, int]] = {}
        for r in cm_rows:
            col_meta[int(r["entity_id"])] = (int(r["total_cols"]), int(r["non_null_cols"]))

        # ── Pre-load entity status from engine_task_log (freshness + consistency)
        # engine_task_log uses EntityId, Layer (lowercase), Status, created_at
        es_rows = conn.execute(
            """
            SELECT EntityId, Layer, Status, created_at AS LoadEndDateTime
            FROM engine_task_log
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY EntityId, Layer
                               ORDER BY created_at DESC,
                                        CASE Status WHEN 'succeeded' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END
                           ) AS rn
                    FROM engine_task_log
                ) WHERE rn = 1
            )
            """
        ).fetchall()
        # Map: entity_id -> {layer -> {Status, LoadEndDateTime}}
        entity_statuses: dict[int, dict[str, dict]] = {}
        for r in es_rows:
            eid = int(r["EntityId"])
            layer = (r["Layer"] or "").lower()
            if eid not in entity_statuses:
                entity_statuses[eid] = {}
            entity_statuses[eid][layer] = {
                "Status": r["Status"] or "",
                "LoadEndDateTime": r["LoadEndDateTime"],
            }

        # ── Pre-load engine_task_log (volume — latest row per entity) ────────
        # engine_task_log uses EntityId (= LandingzoneEntityId)
        etl_rows = conn.execute(
            """
            SELECT EntityId, Status, RowsWritten
            FROM engine_task_log
            WHERE id IN (
                SELECT MAX(id)
                FROM engine_task_log
                GROUP BY EntityId
            )
            """
        ).fetchall()
        # Map: entity_id -> {Status, RowsWritten}
        task_log: dict[int, dict] = {}
        for r in etl_rows:
            eid = int(r["EntityId"])
            task_log[eid] = {
                "Status": r["Status"] or "",
                "RowsWritten": int(r["RowsWritten"] or 0),
            }

        # ── Score each entity ─────────────────────────────────────────────────
        tier_counts: dict[str, int] = {"gold": 0, "silver": 0, "bronze": 0, "unclassified": 0}
        scored = 0
        computed_at = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

        for eid in entity_ids:
            try:
                # 1. Completeness (40%)
                if eid in col_meta:
                    total_cols, non_null_cols = col_meta[eid]
                    if total_cols > 0:
                        ratio = non_null_cols / total_cols  # 0.0–1.0
                        # Cap to 50–100 range
                        completeness = 50.0 + ratio * 50.0
                    else:
                        completeness = 75.0
                else:
                    completeness = 75.0

                # 2. Freshness (25%)
                # Use the most recent LoadEndDateTime across all layers
                est = entity_statuses.get(eid, {})
                most_recent_dt: datetime | None = None
                for layer_data in est.values():
                    dt = _parse_dt(layer_data.get("LoadEndDateTime"))
                    if dt is not None:
                        if most_recent_dt is None or dt > most_recent_dt:
                            most_recent_dt = dt

                if most_recent_dt is not None:
                    hours_since = (now_utc - most_recent_dt).total_seconds() / 3600.0
                    freshness = _compute_freshness(hours_since)
                else:
                    freshness = _compute_freshness(None)

                # 3. Consistency (20%)
                # COUNT(DISTINCT Layer WHERE Status='succeeded') / 3 * 100
                loaded_layers = sum(
                    1 for layer_data in est.values()
                    if layer_data.get("Status", "").lower() in ("loaded", "succeeded", "complete")
                )
                consistency = (loaded_layers / 3.0) * 100.0

                # 4. Volume (15%)
                tl = task_log.get(eid)
                if tl is None:
                    volume = 50.0
                else:
                    status_lower = tl["Status"].lower()
                    rows = tl["RowsWritten"]
                    if status_lower in ("succeeded", "success", "complete") and rows > 0:
                        volume = 100.0
                    elif status_lower in ("succeeded", "success", "complete") and rows == 0:
                        volume = 50.0
                    elif status_lower in ("failed", "error"):
                        volume = 0.0
                    else:
                        volume = 50.0

                # 5. Composite
                composite = (
                    completeness * 0.40
                    + freshness   * 0.25
                    + consistency * 0.20
                    + volume      * 0.15
                )
                tier = _tier_from_score(composite)

                # 6. Upsert into quality_scores
                conn.execute(
                    """
                    INSERT INTO quality_scores
                        (entity_id, completeness_score, freshness_score,
                         consistency_score, volume_score, composite_score,
                         quality_tier, computed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(entity_id) DO UPDATE SET
                        completeness_score = excluded.completeness_score,
                        freshness_score    = excluded.freshness_score,
                        consistency_score  = excluded.consistency_score,
                        volume_score       = excluded.volume_score,
                        composite_score    = excluded.composite_score,
                        quality_tier       = excluded.quality_tier,
                        computed_at        = excluded.computed_at
                    """,
                    (eid, completeness, freshness, consistency, volume, composite, tier, computed_at),
                )

                tier_counts[tier] = tier_counts.get(tier, 0) + 1
                scored += 1

            except Exception as exc:
                log.warning("Quality score failed for entity %d: %s", eid, exc)

        conn.commit()
        log.info("Quality scoring complete: %d entities scored, tiers=%s", scored, tier_counts)
        return {"scored": scored, "tiers": tier_counts}

    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Summary aggregation
# ---------------------------------------------------------------------------

def get_quality_summary() -> dict:
    """Return aggregated quality stats from the quality_scores table.

    Returns:
        {
            total,
            tiers: {gold, silver, bronze, unclassified},
            averageComposite,
            averageCompleteness,
            averageFreshness,
            averageConsistency,
            averageVolume,
            lastComputed,
        }
    """
    conn = cpdb._get_conn()
    try:
        agg = conn.execute(
            """
            SELECT
                COUNT(*)                         AS total,
                AVG(composite_score)             AS avg_composite,
                AVG(completeness_score)          AS avg_completeness,
                AVG(freshness_score)             AS avg_freshness,
                AVG(consistency_score)           AS avg_consistency,
                AVG(volume_score)                AS avg_volume,
                MAX(computed_at)                 AS last_computed,
                SUM(CASE WHEN quality_tier = 'gold'         THEN 1 ELSE 0 END) AS n_gold,
                SUM(CASE WHEN quality_tier = 'silver'       THEN 1 ELSE 0 END) AS n_silver,
                SUM(CASE WHEN quality_tier = 'bronze'       THEN 1 ELSE 0 END) AS n_bronze,
                SUM(CASE WHEN quality_tier = 'unclassified' THEN 1 ELSE 0 END) AS n_unclassified
            FROM quality_scores
            """
        ).fetchone()

        total = int(agg["total"] or 0)
        return {
            "total": total,
            "tiers": {
                "gold":         int(agg["n_gold"] or 0),
                "silver":       int(agg["n_silver"] or 0),
                "bronze":       int(agg["n_bronze"] or 0),
                "unclassified": int(agg["n_unclassified"] or 0),
            },
            "averageComposite":    round(float(agg["avg_composite"] or 0), 2),
            "averageCompleteness": round(float(agg["avg_completeness"] or 0), 2),
            "averageFreshness":    round(float(agg["avg_freshness"] or 0), 2),
            "averageConsistency":  round(float(agg["avg_consistency"] or 0), 2),
            "averageVolume":       round(float(agg["avg_volume"] or 0), 2),
            "lastComputed":        agg["last_computed"] or None,
        }
    finally:
        conn.close()
