#!/usr/bin/env python3
"""Preflight checks for FMD execution prerequisites."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REQUIRED_ENV = ["FABRIC_TENANT_ID", "FABRIC_CLIENT_ID", "FABRIC_CLIENT_SECRET"]
REQUIRED_CONFIG_FILES = [
    Path("config/item_config.yaml"),
    Path("config/id_registry.json"),
    Path("src/VAR_FMD.VariableLibrary/variables.json"),
]
REQUIRED_PIPELINES = [
    Path("src/PL_FMD_LOAD_ALL.DataPipeline/pipeline-content.json"),
    Path("src/PL_FMD_LOAD_LANDINGZONE.DataPipeline/pipeline-content.json"),
    Path("src/PL_FMD_LOAD_BRONZE.DataPipeline/pipeline-content.json"),
    Path("src/PL_FMD_LOAD_SILVER.DataPipeline/pipeline-content.json"),
]


def check_files(paths: list[Path]) -> list[str]:
    errors: list[str] = []
    for path in paths:
        if not path.exists():
            errors.append(f"Missing required file: {path}")
    return errors


def check_variable_library(path: Path) -> list[str]:
    errors: list[str] = []
    if not path.exists():
        return [f"Missing variable library: {path}"]
    payload = json.loads(path.read_text())
    vars_payload = payload.get("properties", {}).get("variables", {})
    for name, node in vars_payload.items():
        value = str(node.get("value", ""))
        if any(marker in value.upper() for marker in ["TODO", "REPLACE", "<", "CHANGEME"]):
            errors.append(f"Variable '{name}' appears to contain placeholder value")
    return errors


def check_sql_contract_references(path: Path) -> list[str]:
    errors: list[str] = []
    text = path.read_text()
    required_refs = [
        "vw_LoadSourceToLandingzone",
        "sp_AuditPipeline",
        "sp_AuditCopyActivity",
    ]
    for ref in required_refs:
        if ref not in text:
            errors.append(f"Expected SQL contract reference '{ref}' missing from repo search baseline")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local preflight validations before load execution.")
    parser.add_argument("--strict", action="store_true", help="Fail if required env vars are not set.")
    args = parser.parse_args()

    errors: list[str] = []
    errors.extend(check_files(REQUIRED_CONFIG_FILES + REQUIRED_PIPELINES))
    errors.extend(check_variable_library(Path("src/VAR_FMD.VariableLibrary/variables.json")))
    errors.extend(check_sql_contract_references(Path("docs/MAINTAINABILITY_RELIABILITY_BACKLOG.md")))

    if args.strict:
        import os

        for key in REQUIRED_ENV:
            if not os.environ.get(key):
                errors.append(f"Missing required environment variable: {key}")

    if errors:
        print("FMD preflight failed:")
        for err in errors:
            print(f" - {err}")
        return 1

    print("FMD preflight passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
