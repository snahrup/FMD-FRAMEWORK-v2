#!/usr/bin/env python3
"""
activate_silver_entities_phase1.py -- Phase 1 Silver Activation (100-entity batch).

Activates a stratified sample of 100 entities for Silver layer processing.
Only entities with confirmed Bronze data are eligible.

Stratified sampling targets (proportional to total entity count):
    ETQ:     6  (29 total,  ~3.5%)
    MES:    27  (445 total, ~26.7%)
    M3 ERP: 36  (596 total, ~35.8%)
    M3C:    11  (187 total, ~11.2%)
    OPTIVA: 20  (409 total, ~24.6%)
    TOTAL: 100

Usage:
    python scripts/activate_silver_entities_phase1.py --mode plan
    python scripts/activate_silver_entities_phase1.py --mode execute
    python scripts/activate_silver_entities_phase1.py --mode verify

Author: Steve Nahrup
"""

import argparse
import json
import logging
import os
import struct
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("silver_activation")

# ---------------------------------------------------------------------------
# Configuration (matches engine/config.py + deploy_from_scratch.py patterns)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
CONFIG_PATH = PROJECT_ROOT / "dashboard" / "app" / "api" / "config.json"
ENV_PATH = CONFIG_PATH.parent / ".env"

# Stratified sampling targets
SAMPLING_TARGETS = {
    "ETQ": 6,
    "MES": 27,
    "M3_ERP": 36,    # Namespace for m3fdbprd
    "M3C": 11,       # Namespace for DI_PRD_Staging
    "OPTIVA": 20,
}
TOTAL_TARGET = sum(SAMPLING_TARGETS.values())  # 100

# Namespace aliases -- the DataSource.Namespace values may vary,
# these map from what we might see to the canonical key in SAMPLING_TARGETS.
NAMESPACE_ALIASES = {
    "ETQ": "ETQ",
    "etq": "ETQ",
    "ETQStagingPRD": "ETQ",
    "MES": "MES",
    "mes": "MES",
    "M3_ERP": "M3_ERP",
    "m3": "M3_ERP",
    "M3": "M3_ERP",
    "m3fdbprd": "M3_ERP",
    "MVXJDTA": "M3_ERP",
    "M3C": "M3C",
    "m3c": "M3C",
    "DI_PRD_Staging": "M3C",
    "OPTIVA": "OPTIVA",
    "optiva": "OPTIVA",
    "Optiva": "OPTIVA",
}


# ---------------------------------------------------------------------------
# Auth (matches engine/auth.py -- SP token via urllib, no dependencies)
# ---------------------------------------------------------------------------

_token_cache: dict = {}

SCOPE_FABRIC_SQL = "https://analysis.windows.net/powerbi/api/.default"


def _load_env() -> None:
    """Load .env file into os.environ (setdefault, won't clobber)."""
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())


def _load_config() -> dict:
    """Load config.json and resolve env vars."""
    _load_env()
    with open(CONFIG_PATH, encoding="utf-8") as f:
        raw = json.load(f)

    def resolve(obj):
        if isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
            return os.environ.get(obj[2:-1], "")
        if isinstance(obj, dict):
            return {k: resolve(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [resolve(v) for v in obj]
        return obj

    return resolve(raw)


def _get_sql_token(cfg: dict) -> bytes:
    """Get SP token for Fabric SQL DB, formatted as pyodbc attrs_before struct.

    CRITICAL: Uses analysis.windows.net/powerbi/api scope, NOT database.windows.net.
    CRITICAL: Token struct is '<I{n}s' format, NOT '<IH...'.
    """
    fabric = cfg["fabric"]
    tenant_id = fabric["tenant_id"]
    client_id = fabric["client_id"]
    client_secret = fabric["client_secret"]

    cached = _token_cache.get(SCOPE_FABRIC_SQL)
    if cached and cached["expires"] > datetime.now().timestamp():
        token = cached["token"]
    else:
        token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        data = urllib.parse.urlencode({
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": SCOPE_FABRIC_SQL,
            "grant_type": "client_credentials",
        }).encode()

        req = urllib.request.Request(
            token_url,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())
        token = result["access_token"]
        expires_in = result.get("expires_in", 3600)
        _token_cache[SCOPE_FABRIC_SQL] = {
            "token": token,
            "expires": datetime.now().timestamp() + expires_in - 60,
        }

    token_bytes = token.encode("UTF-16-LE")
    return struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)


def _get_connection(cfg: dict):
    """Get a pyodbc connection to the Fabric SQL metadata DB."""
    import pyodbc

    sql_cfg = cfg["sql"]
    token_struct = _get_sql_token(cfg)
    conn_str = (
        f"DRIVER={{{sql_cfg['driver']}}};"
        f"SERVER={sql_cfg['server']};"
        f"DATABASE={sql_cfg['database']};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

def _normalize_namespace(raw: Optional[str]) -> Optional[str]:
    """Map a raw DataSource.Namespace to our canonical source key."""
    if not raw:
        return None
    return NAMESPACE_ALIASES.get(raw.strip(), raw.strip())


def get_eligible_entities(conn) -> list[dict]:
    """Query all entities that have Bronze data and are eligible for Silver activation.

    Returns entities with:
      - Active LandingzoneEntity
      - BronzeLayerEntity exists and is active
      - SilverLayerEntity exists (may or may not be active)
      - Bronze data confirmed (PipelineBronzeLayerEntity.IsProcessed=1
        OR EntityStatusSummary.BronzeStatus = loaded/succeeded)
    """
    sql = """
    SELECT
        le.LandingzoneEntityId,
        be.BronzeLayerEntityId,
        se.SilverLayerEntityId,
        ds.Namespace AS SourceNamespace,
        le.SourceSchema,
        le.SourceName,
        le.IsActive AS LzIsActive,
        be.IsActive AS BronzeIsActive,
        se.IsActive AS SilverIsActive,
        CASE
            WHEN EXISTS (
                SELECT 1 FROM execution.PipelineBronzeLayerEntity pbe
                WHERE pbe.BronzeLayerEntityId = be.BronzeLayerEntityId
                  AND pbe.IsProcessed = 1
            ) THEN 1
            WHEN EXISTS (
                SELECT 1 FROM execution.EntityStatusSummary ess
                WHERE ess.LandingzoneEntityId = le.LandingzoneEntityId
                  AND ess.BronzeStatus IN ('loaded', 'Succeeded', 'succeeded')
            ) THEN 1
            ELSE 0
        END AS HasBronzeData
    FROM integration.LandingzoneEntity le
    INNER JOIN integration.BronzeLayerEntity be
        ON le.LandingzoneEntityId = be.LandingzoneEntityId
    INNER JOIN integration.SilverLayerEntity se
        ON be.BronzeLayerEntityId = se.BronzeLayerEntityId
    INNER JOIN integration.DataSource ds
        ON le.DataSourceId = ds.DataSourceId
    WHERE le.IsActive = 1
      AND be.IsActive = 1
      AND ds.IsActive = 1
    ORDER BY ds.Namespace, le.SourceName
    """
    cursor = conn.cursor()
    cursor.execute(sql)
    cols = [c[0] for c in cursor.description]
    rows = cursor.fetchall()
    return [{c: v for c, v in zip(cols, row)} for row in rows]


def stratified_sample(entities: list[dict]) -> list[dict]:
    """Select a stratified sample of entities across all 5 sources.

    Prioritizes entities that:
      1. Have confirmed Bronze data (HasBronzeData = 1)
      2. Are not already Silver-active (SilverIsActive = 0)
      3. Spread evenly across source systems
    """
    # Group by canonical source
    by_source: dict[str, list[dict]] = {}
    for e in entities:
        ns = _normalize_namespace(e.get("SourceNamespace"))
        if ns and ns in SAMPLING_TARGETS:
            by_source.setdefault(ns, []).append(e)

    selected: list[dict] = []
    overflow: list[dict] = []

    for source, target_count in SAMPLING_TARGETS.items():
        available = by_source.get(source, [])

        # Prioritize: Bronze data confirmed + not yet Silver-active
        with_bronze = [e for e in available if e.get("HasBronzeData")]
        not_active = [e for e in with_bronze if not e.get("SilverIsActive")]
        already_active = [e for e in with_bronze if e.get("SilverIsActive")]

        # Pick from not-active first, then already-active as fallback
        pool = not_active + already_active
        picked = pool[:target_count]
        selected.extend(picked)

        # Track overflow for rebalancing if a source is short
        if len(picked) < target_count:
            deficit = target_count - len(picked)
            log.warning(
                "Source %s: only %d eligible entities (needed %d, deficit %d)",
                source, len(picked), target_count, deficit,
            )

    # If we're short of 100, try to fill from sources with extras
    if len(selected) < TOTAL_TARGET:
        selected_ids = {e["LandingzoneEntityId"] for e in selected}
        for source, available_list in by_source.items():
            if len(selected) >= TOTAL_TARGET:
                break
            extras = [
                e for e in available_list
                if e.get("HasBronzeData")
                and e["LandingzoneEntityId"] not in selected_ids
            ]
            for e in extras:
                if len(selected) >= TOTAL_TARGET:
                    break
                selected.append(e)
                selected_ids.add(e["LandingzoneEntityId"])

    return selected[:TOTAL_TARGET]


def mode_plan(conn) -> dict:
    """Dry-run: show what would be activated without making changes."""
    log.info("=" * 70)
    log.info("PHASE 1 SILVER ACTIVATION -- PLAN MODE")
    log.info("=" * 70)

    entities = get_eligible_entities(conn)
    log.info("Total eligible entities (Bronze data confirmed): %d", len(entities))

    # Show per-source breakdown of all eligible
    by_source: dict[str, int] = {}
    with_bronze: dict[str, int] = {}
    for e in entities:
        ns = _normalize_namespace(e.get("SourceNamespace")) or "UNKNOWN"
        by_source[ns] = by_source.get(ns, 0) + 1
        if e.get("HasBronzeData"):
            with_bronze[ns] = with_bronze.get(ns, 0) + 1

    log.info("\nEligible entities per source:")
    log.info("  %-12s  %8s  %8s  %8s", "Source", "Total", "w/Bronze", "Target")
    log.info("  " + "-" * 44)
    for source in sorted(SAMPLING_TARGETS.keys()):
        log.info(
            "  %-12s  %8d  %8d  %8d",
            source,
            by_source.get(source, 0),
            with_bronze.get(source, 0),
            SAMPLING_TARGETS[source],
        )
    log.info("  " + "-" * 44)
    log.info(
        "  %-12s  %8d  %8d  %8d",
        "TOTAL",
        sum(by_source.values()),
        sum(with_bronze.values()),
        TOTAL_TARGET,
    )

    # Stratified sample
    sample = stratified_sample(entities)
    log.info("\nStratified sample: %d entities selected", len(sample))

    # Per-source breakdown of sample
    sample_by_source: dict[str, list[dict]] = {}
    for e in sample:
        ns = _normalize_namespace(e.get("SourceNamespace")) or "UNKNOWN"
        sample_by_source.setdefault(ns, []).append(e)

    log.info("\nSample breakdown:")
    log.info("  %-12s  %8s  %12s  %12s", "Source", "Count", "New Activate", "Already Active")
    log.info("  " + "-" * 50)
    total_new = 0
    total_existing = 0
    for source in sorted(SAMPLING_TARGETS.keys()):
        items = sample_by_source.get(source, [])
        new_count = sum(1 for e in items if not e.get("SilverIsActive"))
        existing_count = sum(1 for e in items if e.get("SilverIsActive"))
        total_new += new_count
        total_existing += existing_count
        log.info("  %-12s  %8d  %12d  %12d", source, len(items), new_count, existing_count)
    log.info("  " + "-" * 50)
    log.info("  %-12s  %8d  %12d  %12d", "TOTAL", len(sample), total_new, total_existing)

    # Entity list
    log.info("\nEntity list (first 20):")
    log.info("  %-6s  %-10s  %-15s  %s", "LZ ID", "Source", "Schema", "Table")
    log.info("  " + "-" * 60)
    for e in sample[:20]:
        ns = _normalize_namespace(e.get("SourceNamespace")) or "?"
        log.info(
            "  %-6d  %-10s  %-15s  %s",
            e["LandingzoneEntityId"], ns, e["SourceSchema"], e["SourceName"],
        )
    if len(sample) > 20:
        log.info("  ... and %d more", len(sample) - 20)

    return {
        "mode": "plan",
        "total_eligible": len(entities),
        "sample_size": len(sample),
        "new_activations": total_new,
        "already_active": total_existing,
        "by_source": {
            s: len(sample_by_source.get(s, []))
            for s in SAMPLING_TARGETS
        },
        "entity_ids": [e["LandingzoneEntityId"] for e in sample],
    }


def mode_execute(conn) -> dict:
    """Execute activation: set IsActive=1 on SilverLayerEntity for sampled entities."""
    log.info("=" * 70)
    log.info("PHASE 1 SILVER ACTIVATION -- EXECUTE MODE")
    log.info("=" * 70)

    # First run plan to get the sample
    entities = get_eligible_entities(conn)
    sample = stratified_sample(entities)

    if not sample:
        log.error("No eligible entities found. Cannot activate.")
        return {"mode": "execute", "status": "failed", "reason": "no_eligible_entities"}

    entity_ids = [e["LandingzoneEntityId"] for e in sample]
    id_str = ",".join(str(eid) for eid in entity_ids)

    log.info("Activating %d entities...", len(entity_ids))

    # Deploy the stored procedure first (idempotent CREATE OR ALTER)
    sp_path = PROJECT_ROOT / "src" / "sql" / "stored_procedures" / "sp_ActivateEntitiesForSilver.sql"
    if sp_path.exists():
        log.info("Deploying stored procedure from %s", sp_path)
        sp_sql = sp_path.read_text(encoding="utf-8")
        # Split on GO statements for batch execution
        batches = [b.strip() for b in sp_sql.split("\nGO") if b.strip()]
        cursor = conn.cursor()
        for batch in batches:
            if batch:
                try:
                    cursor.execute(batch)
                    conn.commit()
                except Exception as exc:
                    log.warning("SP deploy batch warning: %s", exc)
                    conn.rollback()

    # Execute the stored procedure
    cursor = conn.cursor()
    try:
        cursor.execute(
            "EXEC [execution].[sp_ActivateEntitiesForSilver] @EntityIds=?, @DryRun=0, @ActivatedBy=?",
            (id_str, "phase1_activation_script"),
        )

        # Read result set 1: Summary
        if cursor.description:
            cols = [c[0] for c in cursor.description]
            row = cursor.fetchone()
            if row:
                summary = dict(zip(cols, row))
                log.info("Activation summary: %s", json.dumps(summary, default=str))

        # Read result set 2: Per-source breakdown
        if cursor.nextset() and cursor.description:
            cols = [c[0] for c in cursor.description]
            rows = cursor.fetchall()
            log.info("\nPer-source results:")
            for row in rows:
                data = dict(zip(cols, row))
                log.info("  %s: %s", data.get("SourceNamespace", "?"), json.dumps(data, default=str))

        conn.commit()
        log.info("Activation committed successfully.")

    except Exception as exc:
        conn.rollback()
        log.error("Activation failed: %s", exc)
        return {"mode": "execute", "status": "failed", "error": str(exc)}

    # Verification step
    log.info("\nRunning post-activation verification...")
    return mode_verify(conn, expected_ids=entity_ids)


def mode_verify(conn, expected_ids: Optional[list[int]] = None) -> dict:
    """Verify activation: check that Silver entities are active and have Bronze data."""
    log.info("=" * 70)
    log.info("PHASE 1 SILVER ACTIVATION -- VERIFY MODE")
    log.info("=" * 70)

    cursor = conn.cursor()

    # Count active Silver entities
    cursor.execute("""
        SELECT COUNT(*)
        FROM integration.SilverLayerEntity se
        WHERE se.IsActive = 1
    """)
    total_active_silver = cursor.fetchone()[0]
    log.info("Total active Silver entities: %d", total_active_silver)

    # Count active Silver entities with Bronze data
    cursor.execute("""
        WITH bronze_confirmed AS (
            SELECT DISTINCT be2.BronzeLayerEntityId
            FROM integration.BronzeLayerEntity be2
            INNER JOIN execution.PipelineBronzeLayerEntity pbe
                ON pbe.BronzeLayerEntityId = be2.BronzeLayerEntityId
            WHERE pbe.IsProcessed = 1
            UNION
            SELECT DISTINCT be3.BronzeLayerEntityId
            FROM integration.BronzeLayerEntity be3
            INNER JOIN integration.LandingzoneEntity le3
                ON be3.LandingzoneEntityId = le3.LandingzoneEntityId
            INNER JOIN execution.EntityStatusSummary ess
                ON ess.LandingzoneEntityId = le3.LandingzoneEntityId
            WHERE ess.BronzeStatus IN ('loaded', 'Succeeded', 'succeeded')
        )
        SELECT
            ds.Namespace AS SourceNamespace,
            COUNT(*) AS ActiveCount,
            SUM(CASE WHEN bc.BronzeLayerEntityId IS NOT NULL THEN 1 ELSE 0 END) AS WithBronzeData
        FROM integration.SilverLayerEntity se
        INNER JOIN integration.BronzeLayerEntity be
            ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        INNER JOIN integration.LandingzoneEntity le
            ON be.LandingzoneEntityId = le.LandingzoneEntityId
        INNER JOIN integration.DataSource ds
            ON le.DataSourceId = ds.DataSourceId
        LEFT JOIN bronze_confirmed bc
            ON bc.BronzeLayerEntityId = be.BronzeLayerEntityId
        WHERE se.IsActive = 1
        GROUP BY ds.Namespace
        ORDER BY ds.Namespace
    """)

    cols = [c[0] for c in cursor.description]
    rows = cursor.fetchall()
    source_breakdown = [dict(zip(cols, row)) for row in rows]

    log.info("\nActive Silver entities per source:")
    log.info("  %-12s  %8s  %12s", "Source", "Active", "w/Bronze")
    log.info("  " + "-" * 36)
    total_with_bronze = 0
    sources_present = set()
    for row in source_breakdown:
        ns = _normalize_namespace(row.get("SourceNamespace")) or "?"
        sources_present.add(ns)
        total_with_bronze += row.get("WithBronzeData", 0)
        log.info(
            "  %-12s  %8d  %12d",
            ns, row["ActiveCount"], row.get("WithBronzeData", 0),
        )

    # Check for invalid activations (active Silver without Bronze data)
    cursor.execute("""
        SELECT COUNT(*) AS InvalidCount
        FROM integration.SilverLayerEntity se
        INNER JOIN integration.BronzeLayerEntity be
            ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        INNER JOIN integration.LandingzoneEntity le
            ON be.LandingzoneEntityId = le.LandingzoneEntityId
        WHERE se.IsActive = 1
          AND NOT EXISTS (
              SELECT 1 FROM execution.PipelineBronzeLayerEntity pbe
              WHERE pbe.BronzeLayerEntityId = be.BronzeLayerEntityId
                AND pbe.IsProcessed = 1
          )
          AND NOT EXISTS (
              SELECT 1 FROM execution.EntityStatusSummary ess
              WHERE ess.LandingzoneEntityId = le.LandingzoneEntityId
                AND ess.BronzeStatus IN ('loaded', 'Succeeded', 'succeeded')
          )
    """)
    invalid_count = cursor.fetchone()[0]

    # Verification results
    checks = {
        "total_active_silver": total_active_silver,
        "total_with_bronze_data": total_with_bronze,
        "invalid_activations": invalid_count,
        "sources_present": sorted(sources_present),
        "all_5_sources": len(sources_present & set(SAMPLING_TARGETS.keys())) == 5,
        "source_breakdown": source_breakdown,
    }

    log.info("\nVerification results:")
    log.info("  Total active Silver: %d", total_active_silver)
    log.info("  With Bronze data:    %d", total_with_bronze)
    log.info("  Invalid activations: %d", invalid_count)
    log.info("  All 5 sources:       %s", checks["all_5_sources"])

    if expected_ids:
        # Check that all expected entities are active
        id_str = ",".join(str(eid) for eid in expected_ids)
        cursor.execute(f"""
            SELECT COUNT(*) FROM integration.SilverLayerEntity se
            INNER JOIN integration.BronzeLayerEntity be
                ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
            WHERE be.LandingzoneEntityId IN ({id_str})
              AND se.IsActive = 1
        """)
        confirmed = cursor.fetchone()[0]
        checks["expected_count"] = len(expected_ids)
        checks["confirmed_active"] = confirmed
        checks["all_confirmed"] = confirmed == len(expected_ids)
        log.info("  Expected active:     %d / %d", confirmed, len(expected_ids))

    status = "PASS" if invalid_count == 0 and checks.get("all_5_sources") else "FAIL"
    checks["status"] = status
    checks["mode"] = "verify"
    log.info("\nOverall status: %s", status)

    return checks


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Phase 1 Silver Activation -- 100-entity stratified sample",
    )
    parser.add_argument(
        "--mode",
        choices=["plan", "execute", "verify"],
        default="plan",
        help="plan = dry-run, execute = activate, verify = check results",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Write results JSON to this file",
    )
    args = parser.parse_args()

    log.info("Loading configuration from %s", CONFIG_PATH)
    cfg = _load_config()
    log.info(
        "SQL target: %s / %s",
        cfg["sql"]["server"][:30] + "...",
        cfg["sql"]["database"][:40] + "...",
    )

    try:
        conn = _get_connection(cfg)
    except Exception as exc:
        log.error("Failed to connect to Fabric SQL DB: %s", exc)
        log.error(
            "Ensure VPN is connected and ODBC Driver 18 is installed. "
            "Files have been created; run manually when connectivity is available."
        )
        sys.exit(1)

    try:
        if args.mode == "plan":
            result = mode_plan(conn)
        elif args.mode == "execute":
            result = mode_execute(conn)
        elif args.mode == "verify":
            result = mode_verify(conn)
        else:
            log.error("Unknown mode: %s", args.mode)
            sys.exit(1)
    finally:
        conn.close()

    # Output results
    if args.output:
        output_path = Path(args.output)
        output_path.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
        log.info("Results written to %s", output_path)

    # Print summary JSON to stdout
    print(json.dumps(result, indent=2, default=str))

    return 0


if __name__ == "__main__":
    sys.exit(main())
