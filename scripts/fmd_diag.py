#!/usr/bin/env python3
"""Canonical diagnostics wrapper for FMD operations."""
from __future__ import annotations

import argparse
import subprocess
import sys


def run_subprocess(cmd: list[str]) -> int:
    print(f"[fmd_diag] Running: {' '.join(cmd)}")
    return subprocess.call(cmd)


def main() -> int:
    parser = argparse.ArgumentParser(description="FMD diagnostics entrypoint")
    parser.add_argument("--workspace", help="Workspace GUID")
    parser.add_argument("--run-id", help="Pipeline run ID")
    parser.add_argument("--since", help="Relative time window, e.g. 24h")

    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("preflight")
    sub.add_parser("run-summary")
    sub.add_parser("entity-failures")
    sub.add_parser("connections")
    sub.add_parser("onelake-check")

    args = parser.parse_args()

    if args.command == "preflight":
        return run_subprocess([sys.executable, "scripts/preflight_fmd.py"])
    if args.command == "run-summary":
        cmd = [sys.executable, "diag_pipeline_run.py"]
        return run_subprocess(cmd)
    if args.command == "entity-failures":
        return run_subprocess([sys.executable, "diag_ldz_failure.py"])
    if args.command == "connections":
        return run_subprocess([sys.executable, "diag_connections.py"])
    if args.command == "onelake-check":
        return run_subprocess([sys.executable, "scripts/check_onelake_files.py"])

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
