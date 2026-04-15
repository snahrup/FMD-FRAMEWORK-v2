#!/usr/bin/env python3
"""Verify current pipeline integrity from the SQLite control plane.

Usage:
    python scripts/verify_pipeline_integrity.py
    python scripts/verify_pipeline_integrity.py --include-entities --limit 50
    python scripts/verify_pipeline_integrity.py --write-json artifacts/pipeline-integrity.json

Exit code:
    0 = latest state is fully clean for all in-scope entities
    1 = integrity violations exist
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from dashboard.app.api.routes.pipeline_integrity import get_pipeline_integrity  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify pipeline integrity from SQLite truth.")
    parser.add_argument("--include-entities", action="store_true", help="Include entity rows in the report output.")
    parser.add_argument("--limit", type=int, default=200, help="Entity row limit when --include-entities is used.")
    parser.add_argument("--source", help="Optional source filter (e.g. MES, M3 ERP, Optiva).")
    parser.add_argument("--write-json", help="Optional path to write the full JSON report.")
    args = parser.parse_args()

    params = {
        "includeEntities": "1" if args.include_entities else "0",
        "limit": str(max(args.limit, 1)),
    }
    if args.source:
        params["source"] = args.source

    report = get_pipeline_integrity(params)
    summary = report["summary"]
    last_run = report.get("lastRun") or {}

    latest_full_chain = int(summary.get("latestFullChain") or 0)
    in_scope = int(summary.get("inScope") or 0)
    historical_only = int(summary.get("historicalOnly") or 0)

    run_status = str(last_run.get("status") or "")
    run_clean = run_status.lower() not in {"interrupted", "aborted", "failed"}
    pipeline_clean = latest_full_chain == in_scope and historical_only == 0
    passed = run_clean and pipeline_clean

    print("Pipeline Integrity")
    print(f"  In scope: {in_scope}")
    print(f"  Latest full chain: {latest_full_chain}")
    print(f"  Historical only: {historical_only}")
    print(
        "  Latest layer success:"
        f" LZ={summary.get('latestLandingSuccess', 0)}"
        f" Bronze={summary.get('latestBronzeSuccess', 0)}"
        f" Silver={summary.get('latestSilverSuccess', 0)}"
    )
    if last_run:
        print(
            "  Last run:"
            f" {last_run.get('runId', '')} status={run_status}"
            f" completedUnits={last_run.get('completedUnits', 0)}"
            f" heartbeat={last_run.get('heartbeatAt')}"
        )

    if args.write_json:
        output_path = Path(args.write_json)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"  Report written: {output_path}")

    if passed:
        print("RESULT: PASS")
        return 0

    print("RESULT: FAIL")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
