"""
Fix ForEach parallelism in Fabric pipeline JSON files.

Problem: All 659 entities run in parallel inside ForEach activities,
overwhelming the Fabric SQL metadata DB with concurrent stored procedure
calls (causing HTTP 429 throttling).

Solution: Add batchCount=15 to all ForEach activities where isSequential=false
and batchCount is not already set.
"""

import json
import os
import glob


def add_batch_count(obj, batch_count=15):
    """
    Recursively walk a JSON object tree. For any ForEach activity with
    isSequential=false and no batchCount, add batchCount.
    Returns the number of modifications made.
    """
    modifications = 0

    if isinstance(obj, dict):
        # Check if this is a ForEach activity
        if obj.get("type") == "ForEach":
            tp = obj.get("typeProperties", {})
            if tp.get("isSequential") is False and "batchCount" not in tp:
                tp["batchCount"] = batch_count
                activity_name = obj.get("name", "<unnamed>")
                print(f"  + Added batchCount={batch_count} to ForEach '{activity_name}'")
                modifications += 1

        # Recurse into all dict values
        for value in obj.values():
            modifications += add_batch_count(value, batch_count)

    elif isinstance(obj, list):
        for item in obj:
            modifications += add_batch_count(item, batch_count)

    return modifications


def process_pipeline_file(filepath, batch_count=15):
    """Read a pipeline JSON file, add batchCount where needed, write back."""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    modifications = add_batch_count(data, batch_count)

    if modifications > 0:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")  # trailing newline
        print(f"  => {modifications} ForEach activit{'y' if modifications == 1 else 'ies'} updated")
    else:
        print(f"  => No changes needed")

    return modifications


def main():
    # Only process files in src/ directory (not worktrees)
    src_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
    pattern = os.path.join(src_dir, "PL_FMD_*.DataPipeline", "pipeline-content.json")
    files = sorted(glob.glob(pattern))

    print(f"Scanning {len(files)} pipeline files in {src_dir}\n")

    total_modifications = 0
    files_modified = 0

    for filepath in files:
        # Get the pipeline name from the directory
        pipeline_dir = os.path.basename(os.path.dirname(filepath))
        pipeline_name = pipeline_dir.replace(".DataPipeline", "")
        print(f"[{pipeline_name}]")

        mods = process_pipeline_file(filepath)
        total_modifications += mods
        if mods > 0:
            files_modified += 1

    print(f"\n{'='*60}")
    print(f"Done. {total_modifications} ForEach activities updated across {files_modified} files.")
    print(f"Total pipeline files scanned: {len(files)}")


if __name__ == "__main__":
    main()
