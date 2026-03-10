"""
Silver Layer Processing Status & Pipeline Health Check
Connects to Fabric SQL and runs diagnostic queries.
"""

import urllib.request
import urllib.parse
import urllib.error
import json
import struct
import pyodbc
import sys

# ── Config ──────────────────────────────────────────────────────────────
TENANT = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
SERVER = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
DATABASE = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"
TOKEN_URL = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"

# ── Get SP token ────────────────────────────────────────────────────────
def get_token():
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT,
        "client_secret": SECRET,
        "scope": "https://database.windows.net/.default",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
        return data["access_token"]
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        print(f"Token request failed: {e.code} {e.reason}")
        print(f"Response body: {body_text[:500]}")
        raise

# ── Connect to Fabric SQL ───────────────────────────────────────────────
def connect(token):
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
    return conn

# ── Run query and print results ────────────────────────────────────────
def run_query(conn, title, sql, fallback_msg="No rows returned."):
    print(f"\n{'='*80}")
    print(f"  {title}")
    print(f"{'='*80}")
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        columns = [col[0] for col in cursor.description]
        rows = cursor.fetchall()

        if not rows:
            print(f"  {fallback_msg}")
            return rows

        # Calculate column widths
        widths = [len(c) for c in columns]
        str_rows = []
        for row in rows:
            str_row = []
            for i, val in enumerate(row):
                s = str(val) if val is not None else "NULL"
                # Truncate very long values
                if len(s) > 120:
                    s = s[:117] + "..."
                str_row.append(s)
                widths[i] = max(widths[i], len(s))
            str_rows.append(str_row)

        # Print header
        header = " | ".join(c.ljust(widths[i]) for i, c in enumerate(columns))
        print(f"  {header}")
        print(f"  {'-+-'.join('-' * w for w in widths)}")

        # Print rows
        for sr in str_rows:
            line = " | ".join(sr[i].ljust(widths[i]) for i in range(len(columns)))
            print(f"  {line}")

        print(f"\n  ({len(rows)} row(s))")
        return rows

    except pyodbc.Error as e:
        err_msg = str(e)
        if "Invalid object name" in err_msg:
            print(f"  TABLE/VIEW DOES NOT EXIST — {err_msg.split(chr(10))[0]}")
        else:
            print(f"  SQL ERROR: {err_msg[:300]}")
        return None

# ── Main ────────────────────────────────────────────────────────────────
def main():
    print("Authenticating with Service Principal...")
    token = get_token()
    print(f"Token acquired ({len(token)} chars)")

    print("Connecting to Fabric SQL...")
    conn = connect(token)
    print("Connected.\n")

    # ── Q3: Check if Silver table exists first ──────────────────────────
    run_query(conn, "Q3: Check if Silver execution table exists",
        "SELECT OBJECT_ID('execution.PipelineSilverLayerEntity', 'U') as table_exists")

    # ── Q1: Silver processing status by source ──────────────────────────
    run_query(conn, "Q1: Silver Processing Status by Source", """
        SELECT ds.Namespace,
          COUNT(CASE WHEN pse.IsProcessed = 1 THEN 1 END) as processed,
          COUNT(*) as total
        FROM execution.PipelineSilverLayerEntity pse
        JOIN integration.SilverLayerEntity se ON pse.SilverLayerEntityId = se.SilverLayerEntityId
        JOIN integration.BronzeLayerEntity be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace
    """)

    # ── Q2: Silver pending view ─────────────────────────────────────────
    run_query(conn, "Q2: Silver Pending Count (from view)",
        "SELECT COUNT(*) as pending FROM execution.vw_LoadToSilverLayer",
        "View does not exist or returned no rows.")

    # ── Q4: Recent pipeline runs (last 24h) ─────────────────────────────
    run_query(conn, "Q4: Recent Pipeline Runs (last 24 hours)", """
        SELECT TOP 30 PipelineRunGuid, PipelineName, EntityLayer, LogType, LogDateTime,
          SUBSTRING(LogData, 1, 300) as LogDataSnippet
        FROM logging.PipelineExecution
        WHERE LogDateTime > DATEADD(hour, -24, GETUTCDATE())
        ORDER BY LogDateTime DESC
    """, "No pipeline runs in the last 24 hours.")

    # ── Q5: Entities with errors (last 7 days) ──────────────────────────
    run_query(conn, "Q5: Pipeline Errors (last 7 days)", """
        SELECT TOP 20 pe.EntityLayer, pe.LogType, pe.LogDateTime,
          SUBSTRING(pe.LogData, 1, 400) as ErrorDetail
        FROM logging.PipelineExecution pe
        WHERE pe.LogType LIKE '%Error%'
        AND pe.LogDateTime > DATEADD(day, -7, GETUTCDATE())
        ORDER BY pe.LogDateTime DESC
    """, "No errors in the last 7 days.")

    # ── Q6: Unprocessed Bronze entities ──────────────────────────────────
    rows = run_query(conn, "Q6: Unprocessed Bronze Entities (active, never processed)", """
        SELECT ds.Namespace, le.SourceName, be.BronzeLayerEntityId, be.PrimaryKeys
        FROM integration.BronzeLayerEntity be
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE be.BronzeLayerEntityId NOT IN (
          SELECT DISTINCT BronzeLayerEntityId FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 1
        )
        AND be.IsActive = 1
        ORDER BY ds.Namespace, le.SourceName
    """, "All active Bronze entities have been processed!")

    if rows:
        # Summarize unprocessed by namespace
        ns_counts = {}
        for r in rows:
            ns = str(r[0])
            ns_counts[ns] = ns_counts.get(ns, 0) + 1
        print("\n  Summary of unprocessed Bronze by source:")
        for ns, count in sorted(ns_counts.items()):
            print(f"    {ns}: {count} entities")

    # ── Q7: Active pipeline runs (last 30 min) ──────────────────────────
    run_query(conn, "Q7: Active Pipeline Runs (last 30 minutes)", """
        SELECT TOP 5 PipelineRunGuid, PipelineName, LogType, LogDateTime,
          SUBSTRING(LogData, 1, 200) as info
        FROM logging.PipelineExecution
        WHERE LogDateTime > DATEADD(minute, -30, GETUTCDATE())
        ORDER BY LogDateTime DESC
    """, "No pipeline activity in the last 30 minutes.")

    # ── Bonus: Overall entity counts ────────────────────────────────────
    run_query(conn, "BONUS: Overall Entity Registration Counts", """
        SELECT
          (SELECT COUNT(*) FROM integration.LandingzoneEntity WHERE IsActive=1) as LZ_Active,
          (SELECT COUNT(*) FROM integration.BronzeLayerEntity WHERE IsActive=1) as Bronze_Active,
          (SELECT COUNT(*) FROM integration.SilverLayerEntity WHERE IsActive=1) as Silver_Active
    """)

    # ── Bonus: Silver layer entity breakdown ────────────────────────────
    run_query(conn, "BONUS: Silver Entity Count by Source", """
        SELECT ds.Namespace,
          COUNT(*) as silver_entities,
          SUM(CASE WHEN se.IsActive = 1 THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN se.IsActive = 0 THEN 1 ELSE 0 END) as inactive
        FROM integration.SilverLayerEntity se
        JOIN integration.BronzeLayerEntity be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        GROUP BY ds.Namespace
        ORDER BY ds.Namespace
    """)

    conn.close()
    print(f"\n{'='*80}")
    print("  Done. Connection closed.")
    print(f"{'='*80}")

if __name__ == "__main__":
    main()
