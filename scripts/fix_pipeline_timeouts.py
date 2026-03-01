"""
fix_pipeline_timeouts.py - Update pipeline activity timeouts for FMD Landing Zone pipelines.

Copy activities via on-prem gateway were timing out at exactly 1 hour.
This script increases timeouts based on activity type:
  - Copy: 0.04:00:00 (4 hours)
  - ExecutePipeline/InvokePipeline: 0.06:00:00 (6 hours)
  - ForEach: 0.12:00:00 (12 hours)
  - StoredProcedure, Lookup, SetVariable, AppendVariable: KEEP at 0.01:00:00
  - Anything already >= 0.12:00:00: KEEP as-is
"""

import json
import glob
import os
import re
import sys

# Resolve repo root (this script lives in scripts/)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
SRC_DIR = os.path.join(REPO_ROOT, "src")

# Timeout values by activity type
TIMEOUT_MAP = {
    "Copy": "0.04:00:00",
    "InvokePipeline": "0.06:00:00",   # Fabric's name for ExecutePipeline
    "ExecutePipeline": "0.06:00:00",   # ADF name, just in case
    "ForEach": "0.12:00:00",
}

# Activity types that should KEEP their current timeout (no change)
KEEP_TYPES = {
    "SqlServerStoredProcedure",
    "Lookup",
    "SetVariable",
    "AppendVariable",
    "Fail",
    "Wait",
    "WebActivity",
    "WebHook",
    "IfCondition",  # IfCondition itself rarely has a policy timeout
    "Switch",       # Switch itself rarely has a policy timeout
}

# Pipeline file patterns to process
PIPELINE_PATTERNS = [
    os.path.join(SRC_DIR, "PL_FMD_LDZ_*.DataPipeline", "pipeline-content.json"),
    os.path.join(SRC_DIR, "PL_FMD_LOAD_LANDINGZONE.DataPipeline", "pipeline-content.json"),
]


def parse_timeout_hours(timeout_str: str) -> float:
    """Parse a timeout string like '0.01:00:00' into total hours."""
    match = re.match(r"(\d+)\.(\d{2}):(\d{2}):(\d{2})", timeout_str)
    if not match:
        return 0.0
    days, hours, minutes, seconds = map(int, match.groups())
    return days * 24 + hours + minutes / 60 + seconds / 3600


def should_update_timeout(activity_type: str, current_timeout: str) -> tuple:
    """
    Determine if an activity's timeout should be updated.
    Returns (should_update: bool, new_timeout: str, description: str)
    """
    current_hours = parse_timeout_hours(current_timeout)

    # Never reduce a timeout that's already >= 12 hours
    if current_hours >= 12.0:
        return False, current_timeout, "already >= 12hr"

    # Keep types: never change
    if activity_type in KEEP_TYPES:
        return False, current_timeout, f"keep ({activity_type})"

    # Mapped types: increase if current is less than target
    if activity_type in TIMEOUT_MAP:
        target = TIMEOUT_MAP[activity_type]
        target_hours = parse_timeout_hours(target)
        if current_hours < target_hours:
            return True, target, f"{activity_type} -> {target}"
        return False, current_timeout, f"already >= target"

    # Unknown type: don't touch
    return False, current_timeout, f"unknown type ({activity_type})"


def process_activity(activity: dict, changes: list, pipeline_name: str):
    """Process a single activity, updating its timeout if needed."""
    activity_type = activity.get("type", "")
    activity_name = activity.get("name", "unknown")
    policy = activity.get("policy")

    # Update timeout in policy if present
    if policy and "timeout" in policy:
        current_timeout = policy["timeout"]
        should_update, new_timeout, desc = should_update_timeout(activity_type, current_timeout)
        if should_update:
            policy["timeout"] = new_timeout
            changes.append({
                "activity": activity_name,
                "type": activity_type,
                "from": current_timeout,
                "to": new_timeout,
            })

    # Recurse into nested activities
    type_props = activity.get("typeProperties", {})

    # ForEach -> typeProperties.activities
    if "activities" in type_props:
        for child in type_props["activities"]:
            process_activity(child, changes, pipeline_name)

    # IfCondition -> typeProperties.ifTrueActivities / ifFalseActivities
    if "ifTrueActivities" in type_props:
        for child in type_props["ifTrueActivities"]:
            process_activity(child, changes, pipeline_name)
    if "ifFalseActivities" in type_props:
        for child in type_props["ifFalseActivities"]:
            process_activity(child, changes, pipeline_name)

    # Switch -> typeProperties.cases[].activities + defaultActivities
    if "cases" in type_props:
        for case in type_props["cases"]:
            for child in case.get("activities", []):
                process_activity(child, changes, pipeline_name)
    if "defaultActivities" in type_props:
        for child in type_props["defaultActivities"]:
            process_activity(child, changes, pipeline_name)


def process_pipeline_file(filepath: str) -> list:
    """Process a single pipeline JSON file. Returns list of changes made."""
    # Extract pipeline name from folder
    folder_name = os.path.basename(os.path.dirname(filepath))
    pipeline_name = folder_name.replace(".DataPipeline", "")

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    changes = []
    activities = data.get("properties", {}).get("activities", [])
    for activity in activities:
        process_activity(activity, changes, pipeline_name)

    if changes:
        # Write back with indent=2, no trailing whitespace
        json_str = json.dumps(data, indent=2, ensure_ascii=False)
        # Remove trailing whitespace from each line
        lines = [line.rstrip() for line in json_str.splitlines()]
        # Ensure file ends with a single newline
        output = "\n".join(lines) + "\n"
        with open(filepath, "w", encoding="utf-8", newline="\n") as f:
            f.write(output)

    return changes


def main():
    # Collect all matching pipeline files (only from src/, not worktrees)
    all_files = set()
    for pattern in PIPELINE_PATTERNS:
        for filepath in glob.glob(pattern):
            # Skip worktree copies
            norm = os.path.normpath(filepath)
            if ".claude" in norm or ".ralphy-worktrees" in norm or "worktrees" in norm.lower():
                continue
            all_files.add(norm)

    all_files = sorted(all_files)
    print(f"Found {len(all_files)} pipeline files to process\n")

    total_changes = 0
    files_changed = 0

    for filepath in all_files:
        folder_name = os.path.basename(os.path.dirname(filepath))
        pipeline_name = folder_name.replace(".DataPipeline", "")

        changes = process_pipeline_file(filepath)

        if changes:
            files_changed += 1
            total_changes += len(changes)

            # Build summary by type
            type_counts = {}
            for c in changes:
                key = f"{c['type']}->{c['to']}"
                type_counts[key] = type_counts.get(key, 0) + 1

            summary_parts = []
            for key, count in type_counts.items():
                atype, target = key.split("->")
                hrs = parse_timeout_hours(target)
                summary_parts.append(f"{count} {atype}->{int(hrs)}hr")

            print(f"  {pipeline_name}: {', '.join(summary_parts)}")
            for c in changes:
                print(f"    - {c['activity']} ({c['type']}): {c['from']} -> {c['to']}")
        else:
            print(f"  {pipeline_name}: no changes needed")

    print(f"\n{'='*60}")
    print(f"SUMMARY: {total_changes} timeout(s) updated across {files_changed} file(s)")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
