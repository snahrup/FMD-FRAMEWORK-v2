import os
"""
Monitor LZ pipeline until completion, then investigate failure details.
Reactivates all entities in finally block.
"""
import urllib.request, json, struct, time, pyodbc, sys
from datetime import datetime, timezone

TENANT = 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303'
CLIENT = 'ac937c5d-4bdd-438f-be8b-84a850021d2d'
SECRET = os.environ.get('FABRIC_CLIENT_SECRET', '')
SQL_SERVER = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
SQL_DB = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'
WS = '146fe38c-f6c3-4e9d-a18c-5c01cad5941e'
PIPELINE = '3d0b3b2b-a069-40dc-b735-d105f9e66838'


def get_token(scope):
    data = f'grant_type=client_credentials&client_id={CLIENT}&client_secret={SECRET}&scope={scope}'.encode()
    req = urllib.request.Request(
        f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
        data=data, method='POST'
    )
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())['access_token']


def get_sql_conn():
    token = get_token('https://database.windows.net/.default')
    tb = token.encode('utf-16-le')
    ts = struct.pack(f'<I{len(tb)}s', len(tb), tb)
    return pyodbc.connect(
        f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SQL_SERVER};DATABASE={SQL_DB};"
        f"Encrypt=yes;TrustServerCertificate=no;",
        attrs_before={1256: ts}
    )


def check_pipeline_status():
    token = get_token('https://api.fabric.microsoft.com/.default')
    url = (
        f'https://api.fabric.microsoft.com/v1/workspaces/{WS}'
        f'/items/{PIPELINE}/jobs/instances?limit=1'
    )
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {token}')
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
        if data.get('value'):
            return data['value'][0]
    return None


def reactivate_all(conn):
    cursor = conn.cursor()
    cursor.execute("UPDATE integration.LandingzoneEntity SET IsActive = 1 WHERE IsActive = 0")
    count = cursor.rowcount
    conn.commit()
    cursor.close()
    return count


def investigate(conn, output_lines):
    cursor = conn.cursor()

    output_lines.append("\n=== DEEP INVESTIGATION ===\n")

    # 1. Execution entity status
    output_lines.append("--- PipelineLandingzoneEntity Status (OPTIVA) ---")
    try:
        cursor.execute("""
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN ple.IsProcessed = 1 THEN 1 ELSE 0 END) as processed,
                SUM(CASE WHEN ple.IsProcessed = 0 THEN 1 ELSE 0 END) as unprocessed
            FROM execution.PipelineLandingzoneEntity ple
            JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
            WHERE le.DataSourceId = 8
        """)
        row = cursor.fetchone()
        if row:
            output_lines.append(f"  Total: {row[0]}, Processed: {row[1]}, Unprocessed: {row[2]}")
    except Exception as e:
        output_lines.append(f"  Error: {e}")

    # 2. CopyActivity execution - last 100 OPTIVA entries
    output_lines.append("\n--- CopyActivityExecution (OPTIVA, last 100) ---")
    try:
        cursor.execute("""
            SELECT TOP 100
                cae.LogType, cae.LogData, cae.CreatedDate,
                le.SourceName, le.SourceSchema
            FROM logging.CopyActivityExecution cae
            JOIN integration.LandingzoneEntity le ON cae.LandingzoneEntityId = le.LandingzoneEntityId
            WHERE le.DataSourceId = 8
            ORDER BY cae.CreatedDate DESC
        """)
        rows = cursor.fetchall()
        output_lines.append(f"  Found {len(rows)} records")

        type_counts = {}
        for r in rows:
            lt = r[0] or 'NULL'
            type_counts[lt] = type_counts.get(lt, 0) + 1
        output_lines.append(f"  By LogType: {type_counts}")

        for r in rows:
            log_data = r[1] or ''
            if 'error' in log_data.lower() or 'fail' in log_data.lower():
                output_lines.append(f"  ERROR: {r[3]} ({r[4]}): {log_data[:500]}")
    except Exception as e:
        output_lines.append(f"  Error querying: {e}")

    # 3. PipelineExecution errors from today
    output_lines.append("\n--- PipelineExecution (errors, last 12h) ---")
    try:
        cursor.execute("""
            SELECT TOP 50 LogType, LogData, PipelineName, CreatedDate
            FROM logging.PipelineExecution
            WHERE CreatedDate >= DATEADD(hour, -12, GETUTCDATE())
            AND (LogType LIKE '%Error%' OR LogType LIKE '%Fail%'
                 OR LogData LIKE '%error%' OR LogData LIKE '%fail%')
            ORDER BY CreatedDate DESC
        """)
        rows = cursor.fetchall()
        output_lines.append(f"  Found {len(rows)} error records")
        for r in rows:
            output_lines.append(f"  [{r[3]}] {r[2]} - {r[0]}: {(r[1] or '')[:300]}")
    except Exception as e:
        output_lines.append(f"  Error: {e}")

    # 4. ALL PipelineExecution last 2 hours
    output_lines.append("\n--- ALL PipelineExecution (last 2 hours) ---")
    try:
        cursor.execute("""
            SELECT TOP 100 LogType, PipelineName, CreatedDate,
                   LEFT(LogData, 300) as LogDataShort
            FROM logging.PipelineExecution
            WHERE CreatedDate >= DATEADD(hour, -2, GETUTCDATE())
            ORDER BY CreatedDate DESC
        """)
        rows = cursor.fetchall()
        output_lines.append(f"  Found {len(rows)} records in last 2 hours")
        for r in rows:
            output_lines.append(f"  [{r[2]}] {r[1]} - {r[0]}: {r[3] or 'N/A'}")
    except Exception as e:
        output_lines.append(f"  Error: {e}")

    # 5. Sample OPTIVA entities from execution view
    output_lines.append("\n--- execution.vw_LoadSourceToLandingzone (OPTIVA sample) ---")
    try:
        cursor.execute("""
            SELECT TOP 10
                ConnectionType, ConnectionGuid, SourceSchema, SourceName,
                LandingzoneEntityId, IsIncremental, IsIncrementalColumn,
                LEFT(SourceDataRetrieval, 200) as Query
            FROM execution.vw_LoadSourceToLandingzone
            WHERE DataSourceId = 8
            ORDER BY SourceName
        """)
        rows = cursor.fetchall()
        cols = [d[0] for d in cursor.description]
        output_lines.append(f"  {len(rows)} sample rows, columns: {cols}")
        for r in rows:
            output_lines.append(f"  {r[3]}: ConnType={r[0]}, IsIncr={r[5]}, IncrCol={r[6]}")
            output_lines.append(f"    Query: {r[7]}")
    except Exception as e:
        output_lines.append(f"  Error: {e}")

    # 6. Entities with NULL SourceDataRetrieval
    output_lines.append("\n--- Entities with NULL/empty SourceDataRetrieval ---")
    try:
        cursor.execute("""
            SELECT SourceName, SourceSchema
            FROM integration.LandingzoneEntity
            WHERE DataSourceId = 8 AND IsActive = 1
            AND (SourceDataRetrieval IS NULL OR SourceDataRetrieval = '')
        """)
        rows = cursor.fetchall()
        output_lines.append(f"  Count: {len(rows)}")
        for r in rows:
            output_lines.append(f"  {r[1]}.{r[0]}")
    except Exception as e:
        output_lines.append(f"  Error: {e}")

    # 7. OPTIVA schemas
    output_lines.append("\n--- OPTIVA schemas ---")
    try:
        cursor.execute("""
            SELECT SourceSchema, COUNT(*) as cnt
            FROM integration.LandingzoneEntity
            WHERE DataSourceId = 8 AND IsActive = 1
            GROUP BY SourceSchema
            ORDER BY cnt DESC
        """)
        schemas = cursor.fetchall()
        for s in schemas:
            output_lines.append(f"  {s[0]}: {s[1]} entities")
    except Exception as e:
        output_lines.append(f"  Error: {e}")

    cursor.close()
    return output_lines


# === MAIN ===
print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')} UTC] Starting pipeline monitor...")
print("Polling every 30s. Will investigate and reactivate on completion.\n")

start = time.time()
timeout = 60 * 70  # 70 minutes
final_status = None
output = []

try:
    while time.time() - start < timeout:
        try:
            job = check_pipeline_status()
            if not job:
                print("No job found!")
                break

            status = job.get('status', 'Unknown')
            elapsed = int(time.time() - start)
            print(
                f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')} UTC] "
                f"Status: {status} (monitoring for {elapsed // 60}m{elapsed % 60}s)"
            )

            if status in ('Completed', 'Failed', 'Cancelled'):
                final_status = status
                output.append(f"Pipeline finished: {status}")
                output.append(f"Start: {job.get('startTimeUtc')}")
                output.append(f"End: {job.get('endTimeUtc')}")

                fr = job.get('failureReason')
                if fr:
                    output.append(f"Failure reason: {json.dumps(fr, indent=2)}")
                    print(f"\nFailure reason: {json.dumps(fr, indent=2)[:500]}")
                break
        except Exception as e:
            print(f"  Poll error: {e}")

        time.sleep(30)
    else:
        output.append("TIMEOUT: Pipeline still running after 70 minutes of monitoring")
        final_status = "Timeout"

    # Investigate
    print(f"\n{'=' * 60}")
    print(f"Pipeline status: {final_status}")
    print(f"{'=' * 60}")
    print("Connecting to SQL DB for investigation...")

    conn = get_sql_conn()
    investigate(conn, output)

    for line in output:
        print(line)

    # Reactivate
    print("\n--- Reactivating all entities ---")
    reactivated = reactivate_all(conn)
    print(f"Reactivated {reactivated} entities")
    output.append(f"\nReactivated {reactivated} entities")

    # Verify
    cursor = conn.cursor()
    cursor.execute("""
        SELECT DataSourceId, COUNT(*) as total,
               SUM(CASE WHEN IsActive=1 THEN 1 ELSE 0 END) as active
        FROM integration.LandingzoneEntity GROUP BY DataSourceId ORDER BY DataSourceId
    """)
    rows = cursor.fetchall()
    print("\nEntity status after reactivation:")
    for r in rows:
        print(f"  DS {r[0]}: {r[2]}/{r[1]} active")
    cursor.close()
    conn.close()

    with open('scripts/optiva_lz_monitor_results.txt', 'w') as f:
        f.write('\n'.join(output))
    print(f"\nResults written to scripts/optiva_lz_monitor_results.txt")

except Exception as e:
    print(f"FATAL ERROR: {e}")
    import traceback
    traceback.print_exc()
    try:
        conn = get_sql_conn()
        reactivated = reactivate_all(conn)
        print(f"Emergency reactivation: {reactivated} entities restored")
        conn.close()
    except Exception as e2:
        print(f"CRITICAL: Could not reactivate entities! {e2}")
