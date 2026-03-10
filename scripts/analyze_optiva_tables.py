"""
Optiva Load Optimization Analysis — Watermark & PK Discovery
Connects to SQLOptivaLive/OptivaLive and discovers:
1. Primary keys for each table (for Delta merge operations)
2. Watermark columns (for incremental loads)
3. Approximate row counts
Then updates entities_to_analyze.json with is_incr/incr_col results.
"""
import json
import pyodbc
import os
import sys
import time
from collections import defaultdict
from datetime import datetime

DRIVER = 'ODBC Driver 18 for SQL Server'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def connect_optiva():
    """Connect to SQLOptivaLive/OptivaLive, trying multiple auth methods."""
    # Method 1: Windows Auth
    try:
        conn = pyodbc.connect(
            f"DRIVER={{{DRIVER}}};"
            f"SERVER=SQLOptivaLive;"
            f"DATABASE=OptivaLive;"
            f"Trusted_Connection=yes;"
            f"TrustServerCertificate=yes;"
            f"Connection Timeout=30;"
            f"Command Timeout=120;"
        )
        print("Connected via Windows Auth")
        return conn, "Windows"
    except Exception as e1:
        print(f"Windows Auth failed: {e1}")

    # Method 2: SQL Auth with Encrypt
    try:
        conn = pyodbc.connect(
            f"DRIVER={{{DRIVER}}};"
            f"SERVER=SQLOptivaLive;"
            f"DATABASE=OptivaLive;"
            f"UID=UsrSQLRead;"
            f"PWD=Ku7T@hoqFDmDPqG4deMgrrxQ9;"
            f"TrustServerCertificate=yes;"
            f"Encrypt=yes;"
            f"Connection Timeout=30;"
            f"Command Timeout=120;"
        )
        print("Connected via SQL Auth (Encrypt=yes)")
        return conn, "SQL (Encrypt=yes)"
    except Exception as e2:
        print(f"SQL Auth (Encrypt=yes) failed: {e2}")

    # Method 3: SQL Auth without Encrypt
    try:
        conn = pyodbc.connect(
            f"DRIVER={{{DRIVER}}};"
            f"SERVER=SQLOptivaLive;"
            f"DATABASE=OptivaLive;"
            f"UID=UsrSQLRead;"
            f"PWD=Ku7T@hoqFDmDPqG4deMgrrxQ9;"
            f"TrustServerCertificate=yes;"
            f"Connection Timeout=30;"
            f"Command Timeout=120;"
        )
        print("Connected via SQL Auth (no Encrypt)")
        return conn, "SQL (no Encrypt)"
    except Exception as e3:
        print(f"SQL Auth (no Encrypt) failed: {e3}")

    # All methods failed
    error_msg = f"All auth methods failed for SQLOptivaLive/OptivaLive"
    bug_path = os.path.join(SCRIPT_DIR, 'overnight_bug_tracker.md')
    with open(bug_path, 'a') as f:
        f.write(f"\n| OPTIVA | {datetime.utcnow().isoformat()} | Cannot connect to SQLOptivaLive | "
                f"Tried Windows Auth, SQL Auth (Encrypt), SQL Auth (no Encrypt) | FAILED |\n")
    raise ConnectionError(error_msg)


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
    except Exception as e:
        return f"ERROR: {str(e)[:80]}"


def analyze_watermark_columns(cursor, schema, table):
    """Detect watermark columns for a table. Returns (col_name, data_type, priority)."""
    try:
        cursor.execute("""
            SELECT
                c.name AS ColumnName,
                t2.name AS DataType,
                COLUMNPROPERTY(OBJECT_ID(QUOTENAME(s.name) + '.' + QUOTENAME(t.name)), c.name, 'IsIdentity') AS IsIdentity,
                CASE
                    WHEN t2.name IN ('timestamp', 'rowversion') THEN 1
                    WHEN (c.name LIKE '%[Mm]odif%' OR c.name LIKE '%[Uu]pdat%')
                         AND t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime') THEN 2
                    WHEN c.name LIKE '%[Cc]hang%'
                         AND t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime') THEN 3
                    WHEN c.name LIKE '%[Cc]reat%'
                         AND t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime') THEN 4
                    WHEN COLUMNPROPERTY(OBJECT_ID(QUOTENAME(s.name) + '.' + QUOTENAME(t.name)), c.name, 'IsIdentity') = 1 THEN 5
                    WHEN t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime') THEN 6
                    ELSE 99
                END AS Priority
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.columns c ON t.object_id = c.object_id
            JOIN sys.types t2 ON c.system_type_id = t2.system_type_id AND c.user_type_id = t2.user_type_id
            WHERE s.name = ? AND t.name = ?
            AND (
                t2.name IN ('timestamp', 'rowversion')
                OR (t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                    AND (c.name LIKE '%[Mm]odif%' OR c.name LIKE '%[Uu]pdat%'
                         OR c.name LIKE '%[Cc]hang%' OR c.name LIKE '%[Tt]imestamp%'
                         OR c.name LIKE '%[Cc]reat%'))
                OR COLUMNPROPERTY(OBJECT_ID(QUOTENAME(s.name) + '.' + QUOTENAME(t.name)), c.name, 'IsIdentity') = 1
                OR t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
            )
            ORDER BY
                CASE
                    WHEN t2.name IN ('timestamp', 'rowversion') THEN 1
                    WHEN (c.name LIKE '%[Mm]odif%' OR c.name LIKE '%[Uu]pdat%')
                         AND t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime') THEN 2
                    WHEN c.name LIKE '%[Cc]hang%'
                         AND t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime') THEN 3
                    WHEN c.name LIKE '%[Cc]reat%'
                         AND t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime') THEN 4
                    WHEN COLUMNPROPERTY(OBJECT_ID(QUOTENAME(s.name) + '.' + QUOTENAME(t.name)), c.name, 'IsIdentity') = 1 THEN 5
                    WHEN t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime') THEN 6
                    ELSE 99
                END
        """, schema, table)
        rows = cursor.fetchall()
        if rows:
            best = rows[0]
            all_candidates = [
                {
                    'column': r.ColumnName,
                    'type': r.DataType,
                    'is_identity': bool(r.IsIdentity),
                    'priority': r.Priority
                }
                for r in rows
            ]
            return best.ColumnName, best.DataType, best.Priority, all_candidates
        return None, None, 99, []
    except Exception as e:
        return None, f"ERROR: {str(e)[:80]}", 99, []


def analyze_row_count(cursor, schema, table):
    """Get approximate row count from sys.partitions."""
    try:
        cursor.execute("""
            SELECT SUM(p.rows) AS row_cnt
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
            WHERE s.name = ? AND t.name = ?
        """, schema, table)
        row = cursor.fetchone()
        return int(row.row_cnt) if row and row.row_cnt else 0
    except Exception:
        return -1


def main():
    start_time = time.time()
    print(f"{'='*60}")
    print(f"OPTIVA Load Optimization Analysis")
    print(f"Started: {datetime.now().isoformat()}")
    print(f"{'='*60}")

    # Step 1: Load entities and filter to OPTIVA
    entities_path = os.path.join(SCRIPT_DIR, 'entities_to_analyze.json')
    with open(entities_path) as f:
        all_entities = json.load(f)

    optiva_entities = [e for e in all_entities if e['ns'] == 'OPTIVA']
    print(f"\nOPTIVA entities to analyze: {len(optiva_entities)}")

    if not optiva_entities:
        print("ERROR: No OPTIVA entities found in entities_to_analyze.json")
        sys.exit(1)

    # Step 2: Connect to SQLOptivaLive
    print(f"\nConnecting to SQLOptivaLive/OptivaLive...")
    try:
        conn, auth_method = connect_optiva()
    except ConnectionError as e:
        print(f"\nFAILED: {e}")
        sys.exit(1)

    cursor = conn.cursor()

    # Step 3: Analyze each entity
    results = []
    errors = []
    incremental_count = 0

    for i, entity in enumerate(optiva_entities):
        schema = entity['schema']
        name = entity['name']

        try:
            # Primary Keys
            pks = analyze_primary_keys(cursor, schema, name)

            # Watermark Columns
            wm_col, wm_type, wm_priority, wm_candidates = analyze_watermark_columns(cursor, schema, name)

            # Row Count
            row_count = analyze_row_count(cursor, schema, name)

            # Determine if incremental (priority <= 5 means a good watermark candidate)
            is_incremental = (wm_col is not None
                              and not str(wm_type).startswith('ERROR')
                              and wm_priority <= 5)

            result = {
                'id': entity['id'],
                'ns': 'OPTIVA',
                'schema': schema,
                'name': name,
                'primary_keys': pks,
                'watermark_col': wm_col,
                'watermark_type': wm_type,
                'watermark_priority': wm_priority,
                'watermark_candidates': wm_candidates,
                'row_count': row_count,
                'is_incremental': is_incremental,
            }
            results.append(result)

            if is_incremental:
                incremental_count += 1

        except Exception as e:
            error_msg = f"Error analyzing {schema}.{name}: {str(e)[:120]}"
            errors.append({'id': entity['id'], 'schema': schema, 'name': name, 'error': error_msg})
            results.append({
                'id': entity['id'],
                'ns': 'OPTIVA',
                'schema': schema,
                'name': name,
                'primary_keys': None,
                'watermark_col': None,
                'watermark_type': None,
                'watermark_priority': 99,
                'watermark_candidates': [],
                'row_count': -1,
                'is_incremental': False,
                'error': error_msg,
            })

        # Progress every 50 entities
        if (i + 1) % 50 == 0 or (i + 1) == len(optiva_entities):
            elapsed = time.time() - start_time
            print(f"  [{i+1}/{len(optiva_entities)}] Analyzed — "
                  f"{incremental_count} incremental so far — "
                  f"{elapsed:.1f}s elapsed")

    cursor.close()
    conn.close()

    # Step 4: Update entities_to_analyze.json
    result_lookup = {r['id']: r for r in results}
    updated_count = 0
    for entity in all_entities:
        if entity['id'] in result_lookup:
            r = result_lookup[entity['id']]
            if r['is_incremental']:
                entity['is_incr'] = True
                entity['incr_col'] = r['watermark_col']
                updated_count += 1
            else:
                entity['is_incr'] = False
                entity['incr_col'] = ''

    with open(entities_path, 'w') as f:
        json.dump(all_entities, f, indent=2)
    print(f"\nUpdated entities_to_analyze.json: {updated_count} entities marked incremental")

    # Step 5: Save detailed results
    output_path = os.path.join(SCRIPT_DIR, 'load_optimization_results_optiva.json')
    output_data = {
        'timestamp': datetime.now().isoformat(),
        'auth_method': auth_method,
        'total_analyzed': len(results),
        'incremental_found': incremental_count,
        'full_load_only': len(results) - incremental_count,
        'errors': errors,
        'results': results,
    }
    with open(output_path, 'w') as f:
        json.dump(output_data, f, indent=2)
    print(f"Detailed results saved to {output_path}")

    # Step 6: Log errors to bug tracker if any
    if errors:
        bug_path = os.path.join(SCRIPT_DIR, 'overnight_bug_tracker.md')
        with open(bug_path, 'a') as f:
            f.write(f"\n### OPTIVA Analysis Errors ({datetime.now().isoformat()})\n")
            for err in errors:
                f.write(f"| {err['id']} | {err['schema']}.{err['name']} | {err['error']} |\n")
        print(f"\n{len(errors)} errors logged to overnight_bug_tracker.md")

    # Summary
    elapsed = time.time() - start_time
    print(f"\n{'='*60}")
    print(f"SUMMARY — OPTIVA Load Analysis")
    print(f"{'='*60}")
    print(f"Total analyzed:          {len(results)}")
    print(f"Incremental candidates:  {incremental_count}")
    print(f"Full load only:          {len(results) - incremental_count}")
    print(f"Errors:                  {len(errors)}")
    print(f"Elapsed time:            {elapsed:.1f}s")
    print(f"Auth method:             {auth_method}")

    # Watermark type distribution
    wm_types = defaultdict(int)
    wm_priorities = defaultdict(int)
    for r in results:
        if r['is_incremental']:
            wm_types[r['watermark_type']] += 1
            wm_priorities[r['watermark_priority']] += 1

    if wm_types:
        print(f"\nWatermark type distribution:")
        for t, c in sorted(wm_types.items(), key=lambda x: -x[1]):
            print(f"  {t}: {c}")

    if wm_priorities:
        priority_labels = {
            1: 'rowversion/timestamp',
            2: 'Modified/Updated datetime',
            3: 'Changed datetime',
            4: 'Created datetime',
            5: 'Identity column',
        }
        print(f"\nWatermark priority distribution:")
        for p, c in sorted(wm_priorities.items()):
            label = priority_labels.get(p, f'priority {p}')
            print(f"  {label}: {c}")

    # Row count stats
    row_counts = [r['row_count'] for r in results if r['row_count'] >= 0]
    if row_counts:
        total_rows = sum(row_counts)
        max_rows = max(row_counts)
        biggest = [r for r in results if r['row_count'] == max_rows][0]
        empty = sum(1 for rc in row_counts if rc == 0)
        print(f"\nRow count stats:")
        print(f"  Total rows across all tables: {total_rows:,}")
        print(f"  Largest table: {biggest['name']} ({max_rows:,} rows)")
        print(f"  Empty tables (0 rows): {empty}")
        print(f"  Tables with data: {len(row_counts) - empty}")

    # PK stats
    has_pk = sum(1 for r in results if r.get('primary_keys') and not str(r['primary_keys']).startswith('ERROR'))
    no_pk = len(results) - has_pk
    print(f"\nPrimary key stats:")
    print(f"  Tables with PKs: {has_pk}")
    print(f"  Tables without PKs: {no_pk}")

    status = "DONE" if not errors else f"DONE (with {len(errors)} errors)"
    print(f"\nStatus: {status}")


if __name__ == '__main__':
    main()
