#!/usr/bin/env python3
"""Static lint for Fabric pipeline JSON assets."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

PIPELINE_GLOB = "src/*.DataPipeline/pipeline-content.json"
GUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
RETRY_POLICY = {
    "Lookup": 2,
    "SqlServerStoredProcedure": 2,
    "Copy": 3,
    "InvokePipeline": 1,
    "TridentNotebook": 1,
}


def iter_activities(activities: list[dict], parent: str = ""):
    for activity in activities:
        name = f"{parent}/{activity.get('name', '<unnamed>')}" if parent else activity.get("name", "<unnamed>")
        yield name, activity
        if activity.get("type") == "ForEach":
            nested = activity.get("typeProperties", {}).get("activities", [])
            yield from iter_activities(nested, name)
        if activity.get("type") == "Switch":
            for case in activity.get("typeProperties", {}).get("cases", []):
                yield from iter_activities(case.get("activities", []), f"{name}/case:{case.get('value','<value>')}")
            yield from iter_activities(activity.get("typeProperties", {}).get("defaultActivities", []), f"{name}/default")


def lint_pipeline(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        payload = json.loads(path.read_text())
    except Exception as exc:
        return [f"{path}: invalid json ({exc})"]

    props = payload.get("properties", {})
    params = props.get("parameters", {})
    for param_name, param in params.items():
        default = param.get("defaultValue")
        if isinstance(default, str):
            for marker in ("00000000-0000-0000-0000-000000000000", "REPLACE_ME", "TODO"):
                if marker in default:
                    errors.append(f"{path}: parameter '{param_name}' contains placeholder marker '{marker}'")
                    break
        if "workspace" in param_name.lower() and isinstance(default, str) and GUID_RE.match(default):
            errors.append(f"{path}: parameter '{param_name}' has default workspace GUID '{default}'")

    for activity_name, activity in iter_activities(props.get("activities", [])):
        atype = activity.get("type")
        policy = activity.get("policy", {})
        retry = policy.get("retry")
        timeout = policy.get("timeout")
        expected_retry = RETRY_POLICY.get(atype)
        if expected_retry is not None and (not isinstance(retry, int) or retry < expected_retry):
            errors.append(
                f"{path}: activity '{activity_name}' ({atype}) retry={retry!r} expected>={expected_retry}"
            )
        if expected_retry is not None and not timeout:
            errors.append(f"{path}: activity '{activity_name}' ({atype}) missing timeout")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Lint Fabric pipeline JSON files for reliability policies.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when violations are found.")
    parser.add_argument("--paths", nargs="*", help="Optional explicit pipeline-content.json paths.")
    args = parser.parse_args()

    paths = [Path(p) for p in (args.paths or sorted(str(p) for p in Path('.').glob(PIPELINE_GLOB)))]
    violations: list[str] = []
    for path in paths:
        violations.extend(lint_pipeline(path))

    if violations:
        print("Pipeline lint violations:")
        for issue in violations:
            print(f" - {issue}")
        return 1 if args.strict else 0

    print(f"All {len(paths)} pipeline definitions passed lint.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
