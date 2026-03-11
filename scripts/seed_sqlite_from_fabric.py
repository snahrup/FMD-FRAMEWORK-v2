"""One-time migration: Fabric SQL -> SQLite.

Run this ONCE before cutting over to SQLite-only mode.
Requires VPN and valid SP credentials in config.json for Fabric SQL.

Usage:
    python scripts/seed_sqlite_from_fabric.py
    python scripts/seed_sqlite_from_fabric.py --dry-run
    python scripts/seed_sqlite_from_fabric.py --tables connections datasources lz_entities
    python scripts/seed_sqlite_from_fabric.py --skip-tables pipeline_audit copy_activity_audit

The script is idempotent — INSERT OR REPLACE means it's safe to re-run.
Each table is seeded independently; a failure on one table doesn't abort the rest.
"""

import argparse
import sys
import traceback
from pathlib import Path

# ---------------------------------------------------------------------------
# sys.path — must be able to import dashboard.app.api.* and server.py helpers
# ---------------------------------------------------------------------------
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

# ---------------------------------------------------------------------------
# Fabric SQL helpers (query_sql lives in server.py — import it directly)
# ---------------------------------------------------------------------------
try:
    from dashboard.app.api.server import query_sql
except Exception as exc:
    print(f"[ERROR] Could not import query_sql from server.py: {exc}")
    print("        Make sure you're running from the project root with VPN connected.")
    sys.exit(1)

# ---------------------------------------------------------------------------
# SQLite control plane
# ---------------------------------------------------------------------------
try:
    from dashboard.app.api import control_plane_db as cpdb
except Exception as exc:
    print(f"[ERROR] Could not import control_plane_db: {exc}")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Row adapters
# ---------------------------------------------------------------------------
# Each adapter transforms a raw Fabric SQL row dict (string-coerced values
# from query_sql) into the dict shape expected by the cpdb upsert function.
# Where column names match exactly, no adapter is needed — the cpdb function
# uses row.get(col) which handles missing keys gracefully.

def _adapt_engine_run(row: dict) -> dict:
    """Map EngineRun Fabric SQL columns -> SQLite engine_runs columns.

    Fabric SQL:  StartedAtUtc, CompletedAtUtc
    SQLite:      StartedAt,    EndedAt
    """
    out = dict(row)
    out.setdefault('StartedAt', row.get('StartedAtUtc'))
    out.setdefault('EndedAt', row.get('CompletedAtUtc'))
    return out


def _adapt_engine_task_log(row: dict) -> dict:
    """Map EngineTaskLog Fabric SQL columns -> SQLite engine_task_log columns.

    Fabric SQL has TaskId (UUID PK) — SQLite uses autoincrement id.
    We drop TaskId so SQLite assigns its own id; StartedAtUtc becomes created_at.
    """
    out = dict(row)
    # Map timestamp columns
    out.setdefault('created_at', row.get('StartedAtUtc'))
    # Remove Fabric-only columns that don't exist in SQLite schema
    for key in ('TaskId', 'StartedAtUtc', 'CompletedAtUtc', 'RowsPerSecond', 'TargetFormat', 'EngineVersion'):
        out.pop(key, None)
    return out


def _adapt_watermark(row: dict) -> dict:
    """Map LandingzoneEntityLastLoadValue -> watermarks table.

    Fabric SQL: LandingzoneEntityId, LoadValue, LastLoadDatetime
    SQLite:     LandingzoneEntityId, LoadValue, LastLoadDatetime  (same names)
    """
    return row  # columns match directly


def _adapt_pipeline_audit(row: dict) -> dict:
    """Map logging.PipelineExecution -> pipeline_audit.

    Fabric SQL columns should match SQLite shape. Drop any autoincrement PK
    so SQLite assigns its own id.
    """
    out = dict(row)
    # Drop Fabric-side surrogate key if present (SQLite uses autoincrement)
    for key in ('PipelineExecutionId', 'Id'):
        out.pop(key, None)
    return out


def _adapt_copy_activity_audit(row: dict) -> dict:
    """Map logging.CopyActivityExecution -> copy_activity_audit.

    Same pattern as pipeline_audit — drop Fabric surrogate key.
    """
    out = dict(row)
    for key in ('CopyActivityExecutionId', 'Id'):
        out.pop(key, None)
    return out


def _adapt_entity_status(row: dict) -> dict:
    """Map execution.EntityStatusSummary -> entity_status.

    Columns match directly; just pass through.
    """
    return row


def _adapt_pipeline_lz_entity(row: dict) -> dict:
    """Map execution.PipelineLandingzoneEntity -> pipeline_lz_entity.

    Drop Fabric surrogate PK; SQLite assigns its own id.
    """
    out = dict(row)
    for key in ('PipelineLandingzoneEntityId', 'Id'):
        out.pop(key, None)
    return out


def _adapt_pipeline_bronze_entity(row: dict) -> dict:
    """Map execution.PipelineBronzeLayerEntity -> pipeline_bronze_entity.

    Drop Fabric surrogate PK; SQLite assigns its own id.
    """
    out = dict(row)
    for key in ('PipelineBronzeLayerEntityId', 'Id'):
        out.pop(key, None)
    return out


# ---------------------------------------------------------------------------
# Table manifest
# ---------------------------------------------------------------------------
# Each entry: (label, fabric_sql_query, adapter_fn, cpdb_upsert_fn)
# Ordered so FK parents come before children.

TABLES_TO_SEED = [
    # --- integration schema (FK parents first) ---
    (
        "Workspaces",
        "SELECT * FROM integration.Workspace",
        None,
        cpdb.upsert_workspace,
    ),
    (
        "Connections",
        "SELECT * FROM integration.Connection",
        None,
        cpdb.upsert_connection,
    ),
    (
        "Lakehouses",
        "SELECT * FROM integration.Lakehouse",
        None,
        cpdb.upsert_lakehouse,
    ),
    (
        "Pipelines",
        "SELECT * FROM integration.Pipeline",
        None,
        cpdb.upsert_pipeline,
    ),
    (
        "DataSources",
        "SELECT * FROM integration.DataSource",
        None,
        cpdb.upsert_datasource,
    ),
    (
        "LZ Entities",
        "SELECT * FROM integration.LandingzoneEntity",
        None,
        cpdb.upsert_lz_entity,
    ),
    (
        "Bronze Entities",
        "SELECT * FROM integration.BronzeLayerEntity",
        None,
        cpdb.upsert_bronze_entity,
    ),
    (
        "Silver Entities",
        "SELECT * FROM integration.SilverLayerEntity",
        None,
        cpdb.upsert_silver_entity,
    ),

    # --- execution schema ---
    (
        "Watermarks",
        "SELECT * FROM execution.LandingzoneEntityLastLoadValue",
        _adapt_watermark,
        lambda row: cpdb.upsert_watermark(
            int(row['LandingzoneEntityId']),
            row.get('LoadValue'),
            row.get('LastLoadDatetime'),
        ),
    ),
    (
        "Entity Status",
        "SELECT * FROM execution.EntityStatusSummary",
        _adapt_entity_status,
        cpdb.upsert_entity_status,
    ),
    (
        "Engine Runs",
        "SELECT TOP 10000 * FROM execution.EngineRun ORDER BY StartedAtUtc DESC",
        _adapt_engine_run,
        cpdb.upsert_engine_run,
    ),
    (
        "Engine Task Log",
        "SELECT TOP 100000 * FROM execution.EngineTaskLog ORDER BY StartedAtUtc DESC",
        _adapt_engine_task_log,
        cpdb.insert_engine_task_log,
    ),
    (
        "Pipeline LZ Entity",
        "SELECT TOP 50000 * FROM execution.PipelineLandingzoneEntity",
        _adapt_pipeline_lz_entity,
        cpdb.upsert_pipeline_lz_entity,
    ),
    (
        "Pipeline Bronze Entity",
        "SELECT TOP 50000 * FROM execution.PipelineBronzeLayerEntity",
        _adapt_pipeline_bronze_entity,
        cpdb.upsert_pipeline_bronze_entity,
    ),

    # --- logging schema (potentially large — capped) ---
    (
        "Pipeline Audit",
        "SELECT TOP 50000 * FROM logging.PipelineExecution ORDER BY LogDateTime DESC",
        _adapt_pipeline_audit,
        cpdb.insert_pipeline_audit,
    ),
    (
        "Copy Activity Audit",
        "SELECT TOP 50000 * FROM logging.CopyActivityExecution ORDER BY LogDateTime DESC",
        _adapt_copy_activity_audit,
        cpdb.insert_copy_activity_audit,
    ),
]

# Friendly label -> manifest entry (for --tables / --skip-tables filtering)
_LABEL_MAP = {entry[0]: entry for entry in TABLES_TO_SEED}

# Shorthand aliases (lowercase, no spaces) for --tables / --skip-tables flags
_ALIAS_MAP = {label.lower().replace(' ', '_'): label for label, *_ in TABLES_TO_SEED}


def _resolve_label(name: str) -> str:
    """Resolve a user-supplied name to a canonical label."""
    if name in _LABEL_MAP:
        return name
    key = name.lower().replace('-', '_').replace(' ', '_')
    if key in _ALIAS_MAP:
        return _ALIAS_MAP[key]
    raise ValueError(f"Unknown table name: {name!r}. Valid names: {list(_LABEL_MAP)}")


# ---------------------------------------------------------------------------
# Core seed logic
# ---------------------------------------------------------------------------

def seed_table(label: str, sql: str, adapter, upsert_fn, dry_run: bool) -> dict:
    """Pull one Fabric SQL table and upsert into SQLite.

    Returns a result dict with keys: label, fabric_count, sqlite_count, errors.
    """
    result = {'label': label, 'fabric_count': 0, 'sqlite_count': 0, 'errors': []}

    try:
        print(f"  [{label}] Querying Fabric SQL...", end='', flush=True)
        rows = query_sql(sql)
        result['fabric_count'] = len(rows)
        print(f" {len(rows):,} rows", end='')
    except Exception as exc:
        err = f"Fabric SQL query failed: {exc}"
        result['errors'].append(err)
        print(f" FAILED: {exc}")
        return result

    if dry_run:
        print("  (dry-run, skipping write)")
        return result

    if not rows:
        print("  (nothing to write)")
        return result

    print(f"  Writing...", end='', flush=True)
    errors = []
    written = 0
    for i, row in enumerate(rows):
        try:
            adapted = adapter(row) if adapter else row
            upsert_fn(adapted)
            written += 1
        except Exception as exc:
            errors.append(f"Row {i}: {exc}")
            if len(errors) <= 3:
                print(f"\n    [WARN] Row {i} error: {exc}", end='')

    result['sqlite_count'] = written
    result['errors'] = errors

    if errors:
        print(f"\n  [{label}] Done: {written:,}/{len(rows):,} written, {len(errors)} errors")
    else:
        print(f" {written:,} written OK")

    return result


def run_seed(table_filter: list = None, skip_tables: list = None, dry_run: bool = False):
    """Execute the full seed run."""
    print()
    print("=" * 60)
    print("  FMD SQLite Seed — Fabric SQL -> SQLite")
    print(f"  Mode: {'DRY RUN (no writes)' if dry_run else 'LIVE WRITE'}")
    print("=" * 60)

    # Ensure SQLite schema exists
    if not dry_run:
        cpdb.init_db()

    # Determine which tables to seed
    manifest = list(TABLES_TO_SEED)

    if table_filter:
        labels = [_resolve_label(n) for n in table_filter]
        manifest = [e for e in manifest if e[0] in labels]
        print(f"  Seeding {len(manifest)} tables (filtered): {', '.join(e[0] for e in manifest)}")
    elif skip_tables:
        labels_to_skip = {_resolve_label(n) for n in skip_tables}
        manifest = [e for e in manifest if e[0] not in labels_to_skip]
        print(f"  Seeding {len(manifest)} tables (skipping: {', '.join(labels_to_skip)})")
    else:
        print(f"  Seeding all {len(manifest)} tables")

    print()

    results = []
    for label, sql, adapter, upsert_fn in manifest:
        r = seed_table(label, sql, adapter, upsert_fn, dry_run)
        results.append(r)

    # --- Summary ---
    print()
    print("=" * 60)
    print("  SEED SUMMARY")
    print("=" * 60)
    total_fabric = 0
    total_written = 0
    total_errors = 0
    for r in results:
        status = "OK" if not r['errors'] else f"{len(r['errors'])} errors"
        print(f"  {r['label']:<30}  Fabric: {r['fabric_count']:>7,}  SQLite: {r['sqlite_count']:>7,}  [{status}]")
        total_fabric += r['fabric_count']
        total_written += r['sqlite_count']
        total_errors += len(r['errors'])

    print("-" * 60)
    print(f"  {'TOTAL':<30}  Fabric: {total_fabric:>7,}  SQLite: {total_written:>7,}  [{total_errors} errors]")

    if dry_run:
        print()
        print("  DRY RUN complete. No data written to SQLite.")
        return

    # --- Validation: compare SQLite row counts ---
    print()
    print("  VALIDATION (SQLite row counts):")
    try:
        stats = cpdb.get_stats()
        for t, cnt in stats.items():
            if cnt > 0:
                print(f"    {t:<35} {cnt:>7,} rows")
    except Exception as exc:
        print(f"    [WARN] Could not read SQLite stats: {exc}")

    print()
    if total_errors == 0:
        print("  Seed complete. SQLite is ready for SQLite-only mode.")
    else:
        print(f"  Seed complete with {total_errors} row-level errors (see above).")
        print("  The SQLite DB is usable but some rows may be missing.")
        print("  Re-run the script to retry — it's idempotent.")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="One-time seed: pull all data from Fabric SQL and populate SQLite.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Seed everything (requires VPN + valid SP token in config.json)
  python scripts/seed_sqlite_from_fabric.py

  # Count rows without writing
  python scripts/seed_sqlite_from_fabric.py --dry-run

  # Seed only the integration tables
  python scripts/seed_sqlite_from_fabric.py --tables Connections DataSources LZ_Entities Bronze_Entities Silver_Entities

  # Seed everything except the large logging tables
  python scripts/seed_sqlite_from_fabric.py --skip-tables Pipeline_Audit Copy_Activity_Audit

Valid table names (case-insensitive, underscores or spaces):
""" + "\n".join(f"  {label}" for label, *_ in TABLES_TO_SEED),
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help="Count rows from Fabric SQL but do not write to SQLite.",
    )
    parser.add_argument(
        '--tables', nargs='+', metavar='TABLE',
        help="Seed only these tables (space-separated). All others are skipped.",
    )
    parser.add_argument(
        '--skip-tables', nargs='+', metavar='TABLE',
        help="Skip these tables. All others are seeded.",
    )

    args = parser.parse_args()

    if args.tables and args.skip_tables:
        parser.error("Use --tables OR --skip-tables, not both.")

    try:
        run_seed(
            table_filter=args.tables,
            skip_tables=args.skip_tables,
            dry_run=args.dry_run,
        )
    except KeyboardInterrupt:
        print("\n[Interrupted]")
        sys.exit(1)
    except Exception as exc:
        print(f"\n[FATAL] {exc}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
