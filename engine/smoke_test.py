"""
FMD v3 Engine — Smoke Test.

Validates the full engine stack end-to-end.  Run this from the project root:

    python -m engine.smoke_test

Requires:
  - VPN connected (for on-prem SQL sources)
  - FABRIC_CLIENT_SECRET set in dashboard/app/api/.env
  - Fabric SQL DB accessible
"""

import json
import sys
import time
import logging
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger("fmd.smoke_test")


def main():
    results = []

    def check(name: str, fn):
        log.info("── %s ──", name)
        try:
            fn()
            log.info("  ✓ PASS")
            results.append((name, True, None))
        except Exception as exc:
            log.error("  ✗ FAIL: %s", exc)
            results.append((name, False, str(exc)))

    # ── 1. Config ──
    def test_config():
        from engine.config import load_config
        cfg = load_config()
        assert cfg.tenant_id, "tenant_id is empty"
        assert cfg.client_secret, "client_secret is empty — check .env"
        assert cfg.sql_server, "sql_server is empty"
        log.info("  tenant=%s, client=%s, sql=%s", cfg.tenant_id[:8], cfg.client_id[:8], cfg.sql_server[:30])

    check("1. Configuration", test_config)

    # ── 2. Auth ──
    def test_auth():
        from engine.config import load_config
        from engine.auth import TokenProvider
        cfg = load_config()
        tp = TokenProvider(cfg)
        token = tp.get_fabric_sql_token()
        assert len(token) > 100, f"Token too short ({len(token)} chars)"
        log.info("  SQL token: %d chars", len(token))

        api_token = tp.get_fabric_api_token()
        assert len(api_token) > 100, f"API token too short"
        log.info("  API token: %d chars", len(api_token))

    check("2. SP Authentication", test_auth)

    # ── 3. Fabric SQL ──
    def test_fabric_sql():
        from engine.config import load_config
        from engine.auth import TokenProvider
        from engine.connections import MetadataDB
        cfg = load_config()
        tp = TokenProvider(cfg)
        db = MetadataDB(cfg, tp)
        rows = db.query("SELECT COUNT(*) AS cnt FROM integration.LandingzoneEntity WHERE IsActive = 1")
        cnt = rows[0]["cnt"]
        assert cnt > 0, f"No active entities found (got {cnt})"
        log.info("  Active entities: %d", cnt)

    check("3. Fabric SQL Connection", test_fabric_sql)

    # ── 4. Worklist ──
    def test_worklist():
        from engine.config import load_config
        from engine.auth import TokenProvider
        from engine.connections import MetadataDB
        from engine.orchestrator import LoadOrchestrator
        cfg = load_config()
        engine = LoadOrchestrator(cfg)
        entities = engine.get_worklist()
        assert len(entities) > 0, "No entities in worklist"
        log.info("  Worklist: %d entities", len(entities))
        # Check first entity is well-formed
        e = entities[0]
        assert e.source_name, f"Entity {e.id} has empty source_name"
        assert e.source_server, f"Entity {e.id} has empty source_server"

    check("4. Worklist Query", test_worklist)

    # ── 5. Plan Mode ──
    def test_plan():
        from engine.config import load_config
        from engine.orchestrator import LoadOrchestrator
        cfg = load_config()
        engine = LoadOrchestrator(cfg)
        plan = engine.run(mode="plan")
        assert plan.entity_count > 0, "Plan shows 0 entities"
        log.info("  Plan: %d entities (%d incremental, %d full)",
                 plan.entity_count, plan.incremental_count, plan.full_load_count)

    check("5. Plan Mode", test_plan)

    # ── 6. Preflight ──
    def test_preflight():
        from engine.config import load_config
        from engine.orchestrator import LoadOrchestrator
        cfg = load_config()
        engine = LoadOrchestrator(cfg)
        report = engine.preflight()
        d = report.to_dict()
        log.info("  Checks: %d total, all_passed=%s", len(d["checks"]), d["all_passed"])
        for c in d["checks"]:
            status = "✓" if c["passed"] else "✗"
            log.info("    %s %s: %s", status, c["name"], c.get("message", ""))

    check("6. Preflight Health", test_preflight)

    # ── Summary ──
    print("\n" + "=" * 60)
    print("SMOKE TEST RESULTS")
    print("=" * 60)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    for name, ok, err in results:
        status = "PASS" if ok else "FAIL"
        line = f"  [{status}] {name}"
        if err:
            line += f" — {err[:80]}"
        print(line)
    print(f"\n  {passed} passed, {failed} failed")
    print("=" * 60)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
