"""
RP-06B: One-time remediation — delete corrupted watermark entries.

The seed_watermark_values() function in configure_incremental_loads.py wrote
pipeline execution timestamps as watermark values for ALL incremental entities,
regardless of column type. This causes:
- Integer watermark columns: SQL type conversion error (fatal)
- Datetime watermark columns: wrong watermark value (incorrect incremental window)

Fix: delete all 255 entries with the bad seed value '2026-03-17T04:25:48Z'.
This forces the engine to treat them as full loads on next run, which correctly
re-seeds the watermark via _compute_watermark() (MAX of actual source column).

Also deactivates phantom entity registrations for non-existent table
'ipc_CSS_INVT_LOT_MASTER_2'.

Usage:
    python scripts/remediate_watermarks.py              # run for real
    python scripts/remediate_watermarks.py --dry-run    # preview only

Author: Steve Nahrup
"""

import argparse
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "dashboard" / "app" / "api" / "fmd_control_plane.db"
BAD_SEED_VALUE = "2026-03-17T04:25:48Z"
PHANTOM_TABLE = "ipc_CSS_INVT_LOT_MASTER_2"


def remediate_watermarks(db_path: Path, dry_run: bool = False) -> dict:
    """Delete watermark entries with the bad seed value."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Find all bad entries
    cur.execute(
        "SELECT w.LandingzoneEntityId, w.LoadValue, le.IsIncrementalColumn, le.SourceName "
        "FROM watermarks w "
        "JOIN lz_entities le ON le.LandingzoneEntityId = w.LandingzoneEntityId "
        "WHERE w.LoadValue = ?",
        (BAD_SEED_VALUE,),
    )
    bad_rows = cur.fetchall()
    count = len(bad_rows)

    print(f"\nFound {count} watermark entries with bad seed value '{BAD_SEED_VALUE}'")

    if count == 0:
        print("  Nothing to remediate.")
        conn.close()
        return {"deleted": 0, "total_bad": 0}

    # Show sample
    for row in bad_rows[:10]:
        print(f"  Entity {row['LandingzoneEntityId']}: {row['SourceName']} (wm col: {row['IsIncrementalColumn']})")
    if count > 10:
        print(f"  ... and {count - 10} more")

    if dry_run:
        print(f"\n  [DRY RUN] Would delete {count} watermark entries.")
        conn.close()
        return {"deleted": 0, "total_bad": count}

    # Delete
    cur.execute("DELETE FROM watermarks WHERE LoadValue = ?", (BAD_SEED_VALUE,))
    deleted = cur.rowcount
    conn.commit()
    print(f"\n  Deleted {deleted} watermark entries.")
    print("  These entities will do a full load on next run, then _compute_watermark() re-seeds correctly.")

    conn.close()
    return {"deleted": deleted, "total_bad": count}


def deactivate_phantom_entities(db_path: Path, dry_run: bool = False) -> dict:
    """Deactivate entities referencing non-existent source table."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Find active phantom entities (exact match and typo variant with space)
    cur.execute(
        "SELECT LandingzoneEntityId, SourceSchema, SourceName, IsActive "
        "FROM lz_entities "
        "WHERE REPLACE(SourceName, ' ', '') LIKE ? AND IsActive = 1",
        (f"%{PHANTOM_TABLE}%",),
    )
    phantoms = cur.fetchall()
    count = len(phantoms)

    print(f"\nFound {count} active phantom entity registration(s) for '{PHANTOM_TABLE}'")

    for row in phantoms:
        print(f"  Entity {row['LandingzoneEntityId']}: {row['SourceSchema']}.{row['SourceName']} (IsActive={row['IsActive']})")

    if count == 0:
        conn.close()
        return {"deactivated": 0}

    if dry_run:
        print(f"\n  [DRY RUN] Would deactivate {count} entities.")
        conn.close()
        return {"deactivated": 0, "total_phantom": count}

    ids = [row["LandingzoneEntityId"] for row in phantoms]
    placeholders = ",".join("?" * len(ids))
    cur.execute(f"UPDATE lz_entities SET IsActive = 0 WHERE LandingzoneEntityId IN ({placeholders})", ids)
    deactivated = cur.rowcount
    conn.commit()
    print(f"\n  Deactivated {deactivated} phantom entities.")

    conn.close()
    return {"deactivated": deactivated}


def main():
    parser = argparse.ArgumentParser(description="RP-06B: Remediate corrupted watermarks and phantom entities")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no DB writes")
    args = parser.parse_args()

    print("=" * 70)
    print("RP-06B: Watermark Remediation + Phantom Entity Cleanup")
    print(f"Database: {DB_PATH}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    if not DB_PATH.exists():
        print(f"\nERROR: Database not found at {DB_PATH}")
        return

    # Step 1: Delete bad watermarks
    print("\n--- Step 1: Delete corrupted watermark entries ---")
    wm_results = remediate_watermarks(DB_PATH, dry_run=args.dry_run)

    # Step 2: Deactivate phantom entities
    print("\n--- Step 2: Deactivate phantom entities ---")
    phantom_results = deactivate_phantom_entities(DB_PATH, dry_run=args.dry_run)

    # Summary
    print("\n" + "=" * 70)
    print("Summary:")
    print(f"  Watermarks deleted: {wm_results['deleted']}")
    print(f"  Phantoms deactivated: {phantom_results['deactivated']}")
    if args.dry_run:
        print("\n  This was a dry run. Re-run without --dry-run to apply changes.")
    else:
        print("\n  Next steps:")
        print("  1. Verify VPN connectivity")
        print("  2. Run test extraction: 1 entity per source")
        print("  3. Full engine run — remediated entities will full-load and re-seed watermarks")
    print("=" * 70)


if __name__ == "__main__":
    main()
