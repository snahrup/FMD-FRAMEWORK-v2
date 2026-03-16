"""Remove SqlServerStoredProcedure activities from all pipeline JSON files.

Task 20 of the server refactor: stored proc activities are now redundant because:
- sp_AuditPipeline: pipeline audit now handled by Fabric's built-in monitoring
- sp_UpsertPipelineLandingzoneEntity: notebooks write to Delta tables (Task 19)
- sp_UpsertLandingZoneEntityLastLoadValue: notebooks write to Delta tables (Task 19)

Algorithm:
1. Find all SqlServerStoredProcedure activities
2. Remove them
3. Repair dependency chains: if activity B depended on removed SP A,
   B inherits A's own dependencies (so the pipeline flow is preserved)
4. Recurse into ForEach/Switch/IfCondition inner activities
"""

import json
import sys
from pathlib import Path


def _collect_sp_names(activities: list) -> set:
    """Return set of names of all SqlServerStoredProcedure activities."""
    return {
        act["name"]
        for act in activities
        if act.get("type") == "SqlServerStoredProcedure"
    }


def _build_dep_map(activities: list) -> dict:
    """Map activity name → list of dependsOn entries."""
    return {
        act["name"]: act.get("dependsOn", [])
        for act in activities
    }


def _repair_dependencies(activities: list, removed_names: set, dep_map: dict) -> None:
    """Fix dependsOn for remaining activities after SP removal.

    If activity B depended on removed activity A:
    - Replace that dependency with A's own dependencies (chain repair)
    - Preserve the original dependencyConditions from B's reference to A
    """
    for act in activities:
        if "dependsOn" not in act:
            continue
        new_deps = []
        for dep in act["dependsOn"]:
            dep_name = dep.get("activity")
            if dep_name in removed_names:
                # Inherit the removed SP's own dependencies
                sp_deps = dep_map.get(dep_name, [])
                for sp_dep in sp_deps:
                    # Avoid duplicates
                    if not any(d.get("activity") == sp_dep.get("activity") for d in new_deps):
                        new_deps.append(sp_dep)
            else:
                new_deps.append(dep)
        act["dependsOn"] = new_deps


def _process_activities(activities: list) -> tuple:
    """Remove SP activities and repair deps. Returns (cleaned, removed_count)."""
    removed_count = 0

    # First, recurse into nested activity containers
    for act in activities:
        tp = act.get("typeProperties", {})

        # ForEach → typeProperties.activities
        if act.get("type") == "ForEach" and "activities" in tp:
            _, inner_removed = _process_activities(tp["activities"])
            removed_count += inner_removed

        # Switch → typeProperties.cases[].activities + defaultActivities
        if act.get("type") == "Switch":
            for case in tp.get("cases", []):
                if "activities" in case:
                    _, inner_removed = _process_activities(case["activities"])
                    removed_count += inner_removed
            if "defaultActivities" in tp:
                _, inner_removed = _process_activities(tp["defaultActivities"])
                removed_count += inner_removed

        # IfCondition → typeProperties.ifTrueActivities / ifFalseActivities
        if act.get("type") == "IfCondition":
            for key in ("ifTrueActivities", "ifFalseActivities"):
                if key in tp:
                    _, inner_removed = _process_activities(tp[key])
                    removed_count += inner_removed

    # Now process this level
    sp_names = _collect_sp_names(activities)
    if not sp_names:
        return activities, removed_count

    dep_map = _build_dep_map(activities)
    removed_count += len(sp_names)

    # Remove SP activities
    cleaned = [act for act in activities if act.get("type") != "SqlServerStoredProcedure"]

    # Repair dependencies
    _repair_dependencies(cleaned, sp_names, dep_map)

    # Replace the list in-place
    activities[:] = cleaned

    return activities, removed_count


def process_pipeline(path: Path) -> int:
    """Process a single pipeline JSON. Returns number of SP activities removed."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    activities = data.get("properties", {}).get("activities", [])
    if not activities:
        return 0

    _, removed = _process_activities(activities)

    if removed > 0:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")

    return removed


def main():
    src_dir = Path(__file__).resolve().parent.parent / "src"
    pipeline_dirs = sorted(src_dir.glob("PL_FMD_*.DataPipeline"))

    total_removed = 0
    modified_files = 0

    for pdir in pipeline_dirs:
        json_path = pdir / "pipeline-content.json"
        if not json_path.exists():
            continue

        removed = process_pipeline(json_path)
        if removed > 0:
            print(f"  {pdir.name}: removed {removed} stored proc activities")
            total_removed += removed
            modified_files += 1
        else:
            print(f"  {pdir.name}: no stored proc activities (skipped)")

    print(f"\nDone. Removed {total_removed} stored proc activities from {modified_files} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
