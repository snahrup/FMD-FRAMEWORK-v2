"""
Follow-up queries:
  1. Fix reserved word 'Schema' errors from first run
  2. Investigate why 310, 426, 1048 don't appear in Bronze pending after zombie deletion
  3. Check LZ status for those 3 entities — they may not have LZ data yet
"""

import struct
import json
import urllib.request
import urllib.parse
import urllib.error
import pyodbc

TENANT   = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT   = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET   = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
SERVER   = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
DATABASE = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"


def get_token():
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials", "client_id": CLIENT,
        "client_secret": SECRET, "scope": "https://database.windows.net/.default",
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def get_connection(token_str):
    token_bytes = token_str.encode("UTF-16-LE")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    conn_str = (f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};"
                f"DATABASE={DATABASE};Encrypt=yes;TrustServerCertificate=no;")
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


def run_query(cursor, sql, label=None, commit=False):
    if label:
        print(f"\n{'='*80}")
        print(f"  {label}")
        print(f"{'='*80}")
    try:
        cursor.execute(sql)
    except Exception as e:
        print(f"  SQL ERROR: {e}")
        return []
    if commit:
        cursor.connection.commit()
    if cursor.description:
        cols = [d[0] for d in cursor.description]
        rows = cursor.fetchall()
        col_widths = []
        for i, c in enumerate(cols):
            max_w = len(c)
            for r in rows:
                val = str(r[i]) if r[i] is not None else "NULL"
                max_w = max(max_w, len(val))
            col_widths.append(min(max_w, 60))
        header = " | ".join(c.ljust(col_widths[i]) for i, c in enumerate(cols))
        print(header)
        print("-" * len(header))
        for r in rows:
            vals = []
            for i, v in enumerate(r):
                s = str(v) if v is not None else "NULL"
                if len(s) > 60: s = s[:57] + "..."
                vals.append(s.ljust(col_widths[i]))
            print(" | ".join(vals))
        print(f"\n({len(rows)} row(s))")
        return rows
    else:
        rc = cursor.rowcount
        print(f"  -> {rc} row(s) affected")
        return rc


def main():
    print("Connecting...")
    conn = get_connection(get_token())
    cursor = conn.cursor()
    print("Connected.\n")

    # ── Fix query 1a: Bronze entity details for the 6 M3 IDs ──
    run_query(cursor, """
        SELECT be.BronzeLayerEntityId, be.LandingzoneEntityId, be.[Schema], be.Name, be.IsActive
        FROM integration.BronzeLayerEntity be
        WHERE be.BronzeLayerEntityId IN (1565, 1569, 1570, 1571, 1575, 1657)
    """, "FIXED 1a: BronzeLayerEntity rows for 6 M3 target IDs (quoting [Schema])")

    # ── Fix query 2d: Entity details for the 3 zombie Bronze IDs ──
    run_query(cursor, """
        SELECT be.BronzeLayerEntityId, be.LandingzoneEntityId, be.[Schema], be.Name,
          le.SourceName, ds.Namespace
        FROM integration.BronzeLayerEntity be
        JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        WHERE be.BronzeLayerEntityId IN (310, 426, 1048)
    """, "FIXED 2d: Entity details for the 3 zombie Bronze IDs")

    # ── Why don't 310, 426, 1048 appear in Bronze pending? ──
    # The Bronze pending view requires LZ data to exist first (IsProcessed=1 in PipelineLandingzoneEntity)
    # Check if the LZ entities for these 3 have been processed
    run_query(cursor, """
        SELECT be.BronzeLayerEntityId, be.LandingzoneEntityId, be.Name,
          ple.PipelineLandingzoneEntityId, ple.IsProcessed, ple.LoadEndDateTime, ple.InsertDateTime
        FROM integration.BronzeLayerEntity be
        LEFT JOIN execution.PipelineLandingzoneEntity ple ON be.LandingzoneEntityId = ple.LandingzoneEntityId
        WHERE be.BronzeLayerEntityId IN (310, 426, 1048)
    """, "WHY NOT IN BRONZE PENDING: Check LZ pipeline status for these 3 entities")

    # Check what the Bronze pending view's WHERE clause looks like
    run_query(cursor, """
        SELECT ROUTINE_DEFINITION
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_NAME = 'vw_LoadToBronzeLayer'
    """, "Bronze pending view definition (check via ROUTINES)")

    # The view might be in INFORMATION_SCHEMA.VIEWS instead
    run_query(cursor, """
        SELECT VIEW_DEFINITION FROM INFORMATION_SCHEMA.VIEWS
        WHERE TABLE_NAME = 'vw_LoadToBronzeLayer'
    """, "Bronze pending view definition (via VIEWS)")

    # Also check DataSource + Connection for the 6 M3 entities (fixing column names)
    run_query(cursor, """
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'DataSource'
        ORDER BY ORDINAL_POSITION
    """, "DataSource table columns")

    run_query(cursor, """
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'Connection'
        ORDER BY ORDINAL_POSITION
    """, "Connection table columns")

    # Now query with correct column names
    run_query(cursor, """
        SELECT DISTINCT ds.DataSourceId, ds.Namespace, ds.Name as DSName,
          c.ConnectionId, c.ConnectionGuid
        FROM integration.DataSource ds
        JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
        JOIN integration.LandingzoneEntity le ON le.DataSourceId = ds.DataSourceId
        WHERE le.LandingzoneEntityId IN (1005, 1009, 1010, 1011, 1015, 1097)
    """, "DataSource + Connection for the 6 M3 entities")

    # Verify the zombie deletion stuck (confirm PipelineBronzeLayerEntity is clean)
    run_query(cursor, """
        SELECT COUNT(*) as remaining_rows
        FROM execution.PipelineBronzeLayerEntity
        WHERE BronzeLayerEntityId IN (310, 426, 1048)
    """, "Verify zombie deletion: remaining PipelineBronzeLayerEntity rows for 310, 426, 1048")

    # Check the Silver view definition
    run_query(cursor, """
        SELECT VIEW_DEFINITION FROM INFORMATION_SCHEMA.VIEWS
        WHERE TABLE_NAME = 'vw_LoadToSilverLayer'
    """, "Silver pending view definition")

    # Check sp_BuildEntityDigest for PipelineSilverLayerEntity usage
    run_query(cursor, """
        SELECT ROUTINE_DEFINITION FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_NAME = 'sp_BuildEntityDigest'
    """, "sp_BuildEntityDigest full definition (references PipelineSilverLayerEntity)")

    cursor.close()
    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
