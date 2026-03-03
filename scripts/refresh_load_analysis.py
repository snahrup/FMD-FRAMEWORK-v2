"""
Refresh Load Analysis — Re-analyze source SQL tables for incremental load candidates.
Targets entities in entities_to_analyze.json where is_incr is NOT True.
Connects to 4 source SQL servers (MES, ETQ, M3 ERP, M3 Cloud) via Windows auth.
Updates entities_to_analyze.json and saves detailed results to load_optimization_results_refresh.json.
"""
import json
import pyodbc
import os
import sys
import traceback
from collections import defaultdict
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

SOURCE_MAP = {
    'MES': ('m3-db1', 'mes'),
    'ETQ': ('M3-DB3', 'ETQStagingPRD'),
    'M3':  ('sqllogshipprd', 'm3fdbprd'),
    'M3C': ('sql2016live', 'DI_PRD_Staging'),
}

# Display names for summary
SOURCE_DISPLAY = {
    'MES': 'MES',
    'ETQ': 'ETQ',
    'M3C': 'M3C',
    'M3':  'M3 ERP',
}

DRIVER = 'ODBC Driver 18 for SQL Server'
TARGET_NAMESPACES = {'MES', 'ETQ', 'M3', 'M3C'}


def connect_source(server, database):
    """Connect to on-prem source SQL server via Windows auth."""
    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"Trusted_Connection=yes;"
        f"TrustServerCertificate=yes;"
        f"Connection Timeout=30;"
        f"Command Timeout=60;"
    )
    return pyodbc.connect(conn_str)


def analyze_watermark_columns(cursor, schema, table):
    """Detect watermark columns for a table.
    Priority: rowversion > Modified datetime > Created datetime > identity > any datetime.
    """
    try:
        cursor.execute("""
            SELECT
                c.name AS ColumnName,
                t2.name AS DataType,
                COLUMNPROPERTY(OBJECT_ID(QUOTENAME(s.name) + '.' + QUOTENAME(t.name)), c.name, 'IsIdentity') AS IsIdentity
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.columns c ON t.object_id = c.object_id
            JOIN sys.types t2 ON c.system_type_id = t2.system_type_id AND c.user_type_id = t2.user_type_id
            WHERE s.name = ? AND t.name = ?
            AND (
                t2.name IN ('timestamp', 'rowversion')
                OR (t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                    AND (c.name LIKE '%[Mm]odif%' OR c.name LIKE '%[Uu]pdat%'
                         OR c.name LIKE '%[Cc]hang%' OR c.name LIKE '%[Tt]imestamp%'))
                OR (t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                    AND (c.name LIKE '%[Cc]reat%'))
                OR COLUMNPROPERTY(OBJECT_ID(QUOTENAME(s.name) + '.' + QUOTENAME(t.name)), c.name, 'IsIdentity') = 1
            )
            ORDER BY
                CASE
                    WHEN t2.name IN ('timestamp', 'rowversion') THEN 1
                    WHEN t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                         AND (c.name LIKE '%[Mm]odif%' OR c.name LIKE '%[Uu]pdat%') THEN 2
                    WHEN t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                         AND c.name LIKE '%[Cc]hang%' THEN 3
                    WHEN t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                         AND c.name LIKE '%[Cc]reat%' THEN 4
                    WHEN COLUMNPROPERTY(OBJECT_ID(QUOTENAME(s.name) + '.' + QUOTENAME(t.name)), c.name, 'IsIdentity') = 1 THEN 5
                    ELSE 6
                END
        """, schema, table)
        rows = cursor.fetchall()
        if rows:
            return rows[0].ColumnName, rows[0].DataType
        return None, None
    except Exception as e:
        return None, f"ERROR: {str(e)[:80]}"


def analyze_primary_keys(cursor, schema, table):
    """Discover primary keys for a table."""
    try:
        cursor.execute("""
            SELECT c.name AS ColumnName
            FROM sys.indexes i
            JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            JOIN sys.tables t ON i.object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE i.is_primary_key = 1
                AND s.name = ? AND t.name = ?
            ORDER BY ic.key_ordinal
        """, schema, table)
        rows = cursor.fetchall()
        return ','.join(r.ColumnName for r in rows) if rows else None
    except Exception:
        return None


def analyze_row_count(cursor, schema, table):
    """Get approximate row count via sys.partitions."""
    try:
        cursor.execute("""
            SELECT SUM(p.rows) AS RowCount
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
            WHERE s.name = ? AND t.name = ?
        """, schema, table)
        row = cursor.fetchone()
        return int(row.RowCount) if row and row.RowCount else 0
    except Exception:
        return -1


def log_connection_failure(ns, server, database, error_msg):
    """Append a row to scripts/overnight_bug_tracker.md for connection failures."""
    bug_tracker_path = os.path.join(SCRIPT_DIR, 'overnight_bug_tracker.md')
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    desc = f"refresh_load_analysis: {ns} connection failed ({server}/{database})"
    attempted = "Will retry on next run; continuing with other sources"
    result = f"SKIPPED — {error_msg[:80]}"
    row = f"| ? | {timestamp} | {desc} | {attempted} | {result} |\n"

    try:
        # Read existing content to determine row number
        if os.path.exists(bug_tracker_path):
            with open(bug_tracker_path, 'r') as f:
                content = f.read()
            # Count existing data rows (lines starting with | that aren't header/separator)
            lines = content.strip().split('\n')
            data_rows = sum(1 for l in lines if l.startswith('|') and not l.startswith('| #') and not l.startswith('|---'))
            row_num = data_rows + 1
            row = row.replace('| ? |', f'| {row_num} |')
            with open(bug_tracker_path, 'a') as f:
                f.write(row)
        else:
            # Create the file with header
            row = row.replace('| ? |', '| 1 |')
            with open(bug_tracker_path, 'w') as f:
                f.write("# Overnight Bug Tracker\n\n")
                f.write("| # | Timestamp | Bug Description | Attempted Fix | Result |\n")
                f.write("|---|-----------|-----------------|---------------|--------|\n")
                f.write(row)
    except Exception as e:
        print(f"  WARNING: Could not write to bug tracker: {e}")


def main():
    start_time = datetime.now(timezone.utc)
    print(f"Refresh Load Analysis — {start_time.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print(f"{'='*70}")

    # ── STEP 1: Load and filter entities ──────────────────────────────────
    entities_path = os.path.join(SCRIPT_DIR, 'entities_to_analyze.json')
    with open(entities_path) as f:
        all_entities = json.load(f)

    print(f"Loaded {len(all_entities)} total entities from entities_to_analyze.json")

    # Filter: target namespaces only, is_incr is NOT True
    need_analysis = [
        e for e in all_entities
        if e.get('ns') in TARGET_NAMESPACES and e.get('is_incr') is not True
    ]

    # Also count already-done per namespace for the summary
    already_done = defaultdict(int)
    total_per_ns = defaultdict(int)
    for e in all_entities:
        if e.get('ns') in TARGET_NAMESPACES:
            total_per_ns[e['ns']] += 1
            if e.get('is_incr') is True:
                already_done[e['ns']] += 1

    print(f"Entities needing analysis (is_incr != True): {len(need_analysis)}")

    if len(need_analysis) == 0:
        print("\nAll target entities already have is_incr=True. Nothing to do.")
        print("DONE — no analysis needed.")
        return

    # Group by namespace
    by_ns = defaultdict(list)
    for e in need_analysis:
        by_ns[e['ns']].append(e)

    for ns in ['ETQ', 'M3C', 'MES', 'M3']:
        count = len(by_ns.get(ns, []))
        done = already_done.get(ns, 0)
        total = total_per_ns.get(ns, 0)
        print(f"  {SOURCE_DISPLAY.get(ns, ns):>6}: {count} to analyze ({done}/{total} already incremental)")

    # ── STEP 2: Analyze each source ──────────────────────────────────────
    results = []          # Detailed results for each analyzed entity
    errors = []           # Connection-level errors
    new_discoveries = defaultdict(int)  # Count of newly discovered incremental per ns

    # Build a lookup for quick entity updates: (ns, schema, name) -> index in all_entities
    entity_index = {}
    for idx, e in enumerate(all_entities):
        key = (e['ns'], e['schema'], e['name'])
        entity_index[key] = idx

    for ns in ['ETQ', 'M3C', 'MES', 'M3']:
        if ns not in by_ns:
            continue

        server, database = SOURCE_MAP[ns]
        entities = by_ns[ns]
        display_name = SOURCE_DISPLAY.get(ns, ns)

        print(f"\n{'='*70}")
        print(f"Analyzing {display_name} ({server}/{database}): {len(entities)} tables")
        print(f"{'='*70}")

        try:
            conn = connect_source(server, database)
            cursor = conn.cursor()
            print(f"  Connected to {server}/{database}")
        except Exception as e:
            error_msg = str(e)
            print(f"  FAILED to connect to {display_name}: {error_msg[:120]}")
            errors.append({'ns': ns, 'server': server, 'database': database, 'error': error_msg})
            log_connection_failure(ns, server, database, error_msg)
            continue

        found_count = 0
        for i, entity in enumerate(entities):
            schema = entity['schema']
            name = entity['name']

            # Watermark discovery
            wm_col, wm_type = analyze_watermark_columns(cursor, schema, name)

            # Primary key discovery
            pks = analyze_primary_keys(cursor, schema, name)

            # Row count
            row_count = analyze_row_count(cursor, schema, name)

            is_incremental = wm_col is not None and not str(wm_type).startswith('ERROR')

            result = {
                'id': entity['id'],
                'ns': ns,
                'schema': schema,
                'name': name,
                'watermark_col': wm_col,
                'watermark_type': wm_type,
                'primary_keys': pks,
                'row_count': row_count,
                'is_incremental': is_incremental,
            }
            results.append(result)

            if is_incremental:
                found_count += 1
                new_discoveries[ns] += 1

            # Progress every 50 entities
            if (i + 1) % 50 == 0 or (i + 1) == len(entities):
                print(f"  [{i+1}/{len(entities)}] Analyzed — {found_count} incremental so far")

        cursor.close()
        conn.close()
        print(f"  Done: {found_count}/{len(entities)} have watermark columns")

    # ── STEP 3: Update entities_to_analyze.json with results ─────────────
    print(f"\n{'='*70}")
    print("Updating entities_to_analyze.json...")

    updates_applied = 0
    for r in results:
        key = (r['ns'], r['schema'], r['name'])
        idx = entity_index.get(key)
        if idx is not None and r['is_incremental']:
            all_entities[idx]['is_incr'] = True
            all_entities[idx]['incr_col'] = r['watermark_col']
            updates_applied += 1

    with open(entities_path, 'w') as f:
        json.dump(all_entities, f, indent=2)
    print(f"  Updated {updates_applied} entities to is_incr=True")

    # Save detailed results
    refresh_results_path = os.path.join(SCRIPT_DIR, 'load_optimization_results_refresh.json')
    with open(refresh_results_path, 'w') as f:
        json.dump({
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'total_analyzed': len(results),
            'incremental_found': sum(1 for r in results if r['is_incremental']),
            'new_discoveries_by_ns': dict(new_discoveries),
            'connection_errors': errors,
            'results': results,
        }, f, indent=2)
    print(f"  Detailed results saved to {refresh_results_path}")

    # ── STEP 4: Summary ─────────────────────────────────────────────────
    end_time = datetime.now(timezone.utc)
    elapsed = (end_time - start_time).total_seconds()

    print(f"\n{'='*70}")
    print(f"SUMMARY — Refresh Load Analysis")
    print(f"{'='*70}")
    print(f"Duration: {elapsed:.1f}s")
    print(f"Entities analyzed this run: {len(results)}")
    print(f"New incremental discoveries: {sum(new_discoveries.values())}")
    if errors:
        print(f"Connection failures: {len(errors)} ({', '.join(e['ns'] for e in errors)})")
    print()

    # Per-source summary
    for ns in ['MES', 'ETQ', 'M3C', 'M3']:
        display = SOURCE_DISPLAY.get(ns, ns)
        total = total_per_ns.get(ns, 0)
        if total == 0:
            continue

        # Count total incremental now (previously done + new discoveries)
        prev_incr = already_done.get(ns, 0)
        new_incr = new_discoveries.get(ns, 0)
        total_incr = prev_incr + new_incr

        # Check if this source had a connection error
        had_error = any(e['ns'] == ns for e in errors)
        error_note = " [CONNECTION FAILED]" if had_error else ""

        print(f"  {display:>6}: {total_incr}/{total} incremental ({new_incr} new discoveries){error_note}")

    # Watermark type distribution for new discoveries
    wm_types = defaultdict(int)
    for r in results:
        if r['is_incremental']:
            wm_types[r['watermark_type']] += 1
    if wm_types:
        print(f"\nWatermark type distribution (new discoveries):")
        for t, c in sorted(wm_types.items(), key=lambda x: -x[1]):
            print(f"  {t}: {c}")

    # Final status
    if errors:
        print(f"\nFAILED — {len(errors)} source(s) could not be reached. Partial results saved.")
    else:
        print(f"\nDONE — all sources analyzed successfully.")


if __name__ == '__main__':
    main()
