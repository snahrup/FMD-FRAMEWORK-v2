"""
Overnight Push: Incremental Flags + Reactivate Entities + Fix MES LoadValues
=============================================================================
Single script that does ALL of the following:
  A) Push incremental flags from entities_to_analyze.json to Fabric SQL DB
  B) Ensure ALL entities are active (reactivate any deactivated)
  C) Fix MES incremental load type mismatch (datetime LoadValues on INT columns)
  D) Final verification summary

Auth: urllib-based SP token (no azure.identity — it hangs on Windows)
"""

import urllib.request
import urllib.parse
import json
import struct
import pyodbc
import os
import sys
from datetime import datetime, timezone

# ─── Auth Constants ──────────────────────────────────────────────────────────
TENANT   = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT   = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = os.environ.get('FABRIC_CLIENT_SECRET', '')
SERVER   = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
DATABASE = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENTITIES_FILE = os.path.join(SCRIPT_DIR, 'entities_to_analyze.json')
TRACKER_FILE = os.path.join(SCRIPT_DIR, 'overnight_bug_tracker.md')

# ─── Helpers ─────────────────────────────────────────────────────────────────

def get_token():
    """Get SP token via urllib (no azure.identity)."""
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': CLIENT,
        'client_secret': SECRET,
        'scope': 'https://analysis.windows.net/powerbi/api/.default',
    }).encode()
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=body,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    return resp['access_token']


def get_connection(token):
    """Connect to Fabric SQL DB with SP token."""
    token_bytes = token.encode('UTF-16-LE')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    conn = pyodbc.connect(
        f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};DATABASE={DATABASE};'
        f'Encrypt=yes;TrustServerCertificate=no',
        attrs_before={1256: token_struct},
    )
    return conn


def print_table(headers, rows):
    """Print a nicely formatted table."""
    widths = [len(h) for h in headers]
    for row in rows:
        for i, val in enumerate(row):
            widths[i] = max(widths[i], len(str(val)))
    fmt = '  '.join(f'{{:<{w}}}' for w in widths)
    print(fmt.format(*headers))
    print('  '.join('-' * w for w in widths))
    for row in rows:
        print(fmt.format(*[str(v) for v in row]))


# ─── MAIN ────────────────────────────────────────────────────────────────────

def main():
    run_ts = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    results = {'timestamp': run_ts}

    # ── Auth ─────────────────────────────────────────────────────────────
    print('=' * 70)
    print(f'OVERNIGHT PUSH FLAGS — {run_ts}')
    print('=' * 70)

    print('\n[AUTH] Getting SP token via urllib...')
    token = get_token()
    print('[AUTH] Token acquired.')

    print('[AUTH] Connecting to Fabric SQL DB...')
    conn = get_connection(token)
    cursor = conn.cursor()
    print('[AUTH] Connected.\n')

    # ══════════════════════════════════════════════════════════════════════
    # PART A — Push incremental flags
    # ══════════════════════════════════════════════════════════════════════
    print('=' * 70)
    print('PART A: Push Incremental Flags')
    print('=' * 70)

    if not os.path.exists(ENTITIES_FILE):
        print(f'  ERROR: {ENTITIES_FILE} not found!')
        results['part_a'] = 'FAILED — file not found'
    else:
        with open(ENTITIES_FILE) as f:
            entities = json.load(f)

        # Filter to incremental entities with a column
        incr_entities = [
            e for e in entities
            if e.get('is_incr') is True and e.get('incr_col')
        ]
        print(f'  Loaded {len(entities)} entities, {len(incr_entities)} are incremental with column.')

        # Count by namespace
        ns_counts = {}
        for e in incr_entities:
            ns = e.get('ns', '?')
            ns_counts[ns] = ns_counts.get(ns, 0) + 1
        for ns in sorted(ns_counts):
            print(f'    {ns}: {ns_counts[ns]} incremental')

        updated = 0
        skipped = 0
        errors = 0
        batch = 0

        for e in incr_entities:
            eid = e['id']
            col = e['incr_col']
            try:
                cursor.execute(
                    "UPDATE integration.LandingzoneEntity "
                    "SET IsIncremental = 1, IsIncrementalColumn = ? "
                    "WHERE LandingzoneEntityId = ?",
                    col, eid
                )
                if cursor.rowcount > 0:
                    updated += 1
                else:
                    skipped += 1
                batch += 1
                if batch >= 100:
                    conn.commit()
                    batch = 0
            except Exception as ex:
                errors += 1
                print(f'    ERROR on entity {eid}: {ex}')

        # Final commit
        if batch > 0:
            conn.commit()

        print(f'\n  PART A RESULTS: Updated={updated}, Skipped(no match)={skipped}, Errors={errors}')
        results['part_a'] = {
            'updated': updated,
            'skipped': skipped,
            'errors': errors,
            'by_namespace': ns_counts,
        }

    # ══════════════════════════════════════════════════════════════════════
    # PART B — Ensure ALL entities are active
    # ══════════════════════════════════════════════════════════════════════
    print('\n' + '=' * 70)
    print('PART B: Ensure All Entities Active')
    print('=' * 70)

    cursor.execute("""
        SELECT ds.Namespace, le.IsActive, COUNT(*) as cnt
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace, le.IsActive
        ORDER BY ds.Namespace, le.IsActive
    """)
    rows = cursor.fetchall()
    print('\n  Current state:')
    print_table(['Namespace', 'IsActive', 'Count'], [(r[0], r[1], r[2]) for r in rows])

    # Count inactive
    inactive_count = sum(r[2] for r in rows if r[1] == 0 or r[1] is False)

    if inactive_count > 0:
        print(f'\n  Found {inactive_count} inactive entities. Reactivating...')
        cursor.execute(
            "UPDATE integration.LandingzoneEntity SET IsActive = 1 WHERE IsActive = 0"
        )
        reactivated = cursor.rowcount
        conn.commit()
        print(f'  Reactivated {reactivated} entities.')
        results['part_b'] = {'reactivated': reactivated}
    else:
        print('\n  All entities already active. Nothing to do.')
        results['part_b'] = {'reactivated': 0}

    # ══════════════════════════════════════════════════════════════════════
    # PART C — Fix MES incremental load type mismatch
    # ══════════════════════════════════════════════════════════════════════
    print('\n' + '=' * 70)
    print('PART C: Fix MES Incremental LoadValue Mismatch')
    print('=' * 70)

    # Check if LandingzoneEntityLastLoadValue table exists
    cursor.execute("""
        SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'LandingzoneEntityLastLoadValue'
    """)
    table_exists = cursor.fetchone()[0] > 0

    if not table_exists:
        print('  Table integration.LandingzoneEntityLastLoadValue does NOT exist. Skipping.')
        results['part_c'] = {'status': 'table_not_found', 'fixed': 0}
    else:
        print('  Table exists. Checking for datetime-formatted LoadValues on incremental entities...')

        cursor.execute("""
            SELECT COUNT(*) FROM integration.LandingzoneEntityLastLoadValue llv
            JOIN integration.LandingzoneEntity le ON llv.LandingzoneEntityId = le.LandingzoneEntityId
            WHERE llv.LoadValue LIKE '202[0-9]-%-%'
              AND le.IsIncremental = 1
        """)
        broken_count = cursor.fetchone()[0]

        if broken_count > 0:
            print(f'  Found {broken_count} broken LoadValues (datetime on INT cols). Resetting to "0"...')
            cursor.execute("""
                UPDATE llv SET llv.LoadValue = '0'
                FROM integration.LandingzoneEntityLastLoadValue llv
                JOIN integration.LandingzoneEntity le ON llv.LandingzoneEntityId = le.LandingzoneEntityId
                WHERE llv.LoadValue LIKE '202[0-9]-%-%'
                  AND le.IsIncremental = 1
            """)
            fixed = cursor.rowcount
            conn.commit()
            print(f'  Fixed {fixed} LoadValues (reset to "0").')
            results['part_c'] = {'status': 'fixed', 'fixed': fixed}
        else:
            print('  No broken LoadValues found. Nothing to fix.')
            results['part_c'] = {'status': 'clean', 'fixed': 0}

    # ══════════════════════════════════════════════════════════════════════
    # PART D — Final verification
    # ══════════════════════════════════════════════════════════════════════
    print('\n' + '=' * 70)
    print('PART D: Final Verification')
    print('=' * 70)

    cursor.execute("""
        SELECT ds.Namespace,
               SUM(CASE WHEN le.IsActive = 1 THEN 1 ELSE 0 END) as active,
               SUM(CASE WHEN le.IsIncremental = 1 THEN 1 ELSE 0 END) as incremental,
               COUNT(*) as total
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace
        ORDER BY ds.Namespace
    """)
    verify_rows = cursor.fetchall()
    headers = ['Namespace', 'Active', 'Incremental', 'Total']
    table_data = [(r[0], r[1], r[2], r[3]) for r in verify_rows]

    print()
    print_table(headers, table_data)
    results['part_d'] = table_data

    # ── Close connection ─────────────────────────────────────────────────
    cursor.close()
    conn.close()

    # ══════════════════════════════════════════════════════════════════════
    # Write to bug tracker
    # ══════════════════════════════════════════════════════════════════════
    print('\n' + '=' * 70)
    print('Writing results to overnight_bug_tracker.md...')
    print('=' * 70)

    md_lines = []
    md_lines.append(f'\n## Overnight Push Flags Run — {run_ts}\n')

    # Part A summary
    pa = results.get('part_a', {})
    if isinstance(pa, str):
        md_lines.append(f'### Part A: Incremental Flags\n- **{pa}**\n')
    else:
        md_lines.append('### Part A: Incremental Flags\n')
        md_lines.append(f'- Updated: **{pa.get("updated", 0)}**\n')
        md_lines.append(f'- Skipped (no DB match): **{pa.get("skipped", 0)}**\n')
        md_lines.append(f'- Errors: **{pa.get("errors", 0)}**\n')
        by_ns = pa.get('by_namespace', {})
        if by_ns:
            md_lines.append('- By namespace:\n')
            for ns in sorted(by_ns):
                md_lines.append(f'  - {ns}: {by_ns[ns]}\n')

    # Part B summary
    pb = results.get('part_b', {})
    md_lines.append(f'\n### Part B: Entity Reactivation\n')
    md_lines.append(f'- Reactivated: **{pb.get("reactivated", 0)}**\n')

    # Part C summary
    pc = results.get('part_c', {})
    md_lines.append(f'\n### Part C: MES LoadValue Fix\n')
    md_lines.append(f'- Status: **{pc.get("status", "unknown")}**\n')
    md_lines.append(f'- Fixed: **{pc.get("fixed", 0)}**\n')

    # Part D verification table
    pd_data = results.get('part_d', [])
    md_lines.append(f'\n### Part D: Final Verification\n')
    md_lines.append('| Namespace | Active | Incremental | Total |\n')
    md_lines.append('|-----------|--------|-------------|-------|\n')
    for row in pd_data:
        md_lines.append(f'| {row[0]} | {row[1]} | {row[2]} | {row[3]} |\n')

    md_lines.append('\n---\n')

    # Append to tracker file
    with open(TRACKER_FILE, 'a', encoding='utf-8') as f:
        f.writelines(md_lines)

    print(f'  Results appended to {TRACKER_FILE}')

    # ── Final Summary ────────────────────────────────────────────────────
    print('\n' + '=' * 70)
    all_ok = True
    if isinstance(pa, dict) and pa.get('errors', 0) > 0:
        all_ok = False

    if all_ok:
        print('DONE - All parts completed successfully.')
    else:
        print('FAILED - See errors above.')

    print('=' * 70)
    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main())
