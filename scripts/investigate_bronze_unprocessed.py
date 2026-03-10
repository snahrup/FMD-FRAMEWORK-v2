"""
Investigate 174 unprocessed Bronze entities:
- Detail the 9 non-OPTIVA ones (6 M3, 3 MES)
- Check OneLake file existence
- Check Silver execution tracking table situation
"""
import urllib.request
import urllib.parse
import json
import struct
import pyodbc
import sys

# ── Config ──────────────────────────────────────────────────────────────
TENANT = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"

SQL_SERVER = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
SQL_DB = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"

WORKSPACE_DATA = "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a"
LZ_LAKEHOUSE = "2aef4ede-2918-4a6b-8ec6-a42108c67806"
BRONZE_LAKEHOUSE = "cf57e8bf-7b34-471b-adea-ed80d05a4fdb"


def get_token(scope):
    """Get an AAD token for the given scope."""
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT,
        "client_secret": SECRET,
        "scope": scope,
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
        return data["access_token"]
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        print(f"  Token error for scope={scope}: HTTP {e.code}")
        print(f"  Response: {err_body[:1000]}")
        raise


def get_sql_connection():
    """Get a pyodbc connection to the Fabric SQL DB."""
    token = get_token("https://database.windows.net/.default")
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={SQL_SERVER};"
        f"DATABASE={SQL_DB};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
    return conn


def run_query(conn, sql, description):
    """Run a query and return rows + column names."""
    print(f"\n{'='*100}")
    print(f"  {description}")
    print(f"{'='*100}")
    cursor = conn.cursor()
    try:
        cursor.execute(sql)
        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall()
        return columns, rows
    except Exception as e:
        print(f"  ERROR: {e}")
        return [], []


def print_table(columns, rows, max_col_width=45):
    """Pretty-print query results as a table."""
    if not columns:
        print("  (no columns)")
        return
    if not rows:
        print("  (no rows returned)")
        return

    # Convert to strings
    str_rows = []
    for row in rows:
        str_row = []
        for val in row:
            s = str(val) if val is not None else "NULL"
            if len(s) > max_col_width:
                s = s[:max_col_width-3] + "..."
            str_row.append(s)
        str_rows.append(str_row)

    # Calculate column widths
    widths = [len(c) for c in columns]
    for row in str_rows:
        for i, val in enumerate(row):
            widths[i] = max(widths[i], len(val))

    # Print header
    header = " | ".join(c.ljust(widths[i]) for i, c in enumerate(columns))
    print(f"  {header}")
    print(f"  {'-+-'.join('-' * w for w in widths)}")

    # Print rows
    for row in str_rows:
        line = " | ".join(row[i].ljust(widths[i]) for i in range(len(columns)))
        print(f"  {line}")

    print(f"\n  ({len(rows)} row(s))")


def fabric_api_get(token, url):
    """Make a GET request to the Fabric/OneLake API."""
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        return {"error": str(e), "body": body[:500]}, e.code


# ════════════════════════════════════════════════════════════════════════
#  MAIN
# ════════════════════════════════════════════════════════════════════════
def main():
    print("Connecting to Fabric SQL DB...")
    conn = get_sql_connection()
    print("Connected.\n")

    # ── First discover BronzeLayerEntity columns ───────────────────
    q_cols = """
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'integration' AND TABLE_NAME = 'BronzeLayerEntity'
    ORDER BY ORDINAL_POSITION
    """
    cols, rows = run_query(conn, q_cols, "SCHEMA: BronzeLayerEntity columns")
    print_table(cols, rows)
    brz_columns = [str(r[0]) for r in rows] if rows else []

    # ── Query 1: Non-OPTIVA unprocessed Bronze entities ─────────────
    # Build SELECT based on available columns
    brz_select_cols = ["be.BronzeLayerEntityId", "be.PrimaryKeys"]
    if "TargetName" in brz_columns:
        brz_select_cols.append("be.TargetName as BronzeTargetName")
    if "SourceName" in brz_columns:
        brz_select_cols.append("be.SourceName as BrzSourceName")
    brz_cols_str = ", ".join(brz_select_cols)

    q1 = f"""
    SELECT ds.Namespace, le.SourceName, le.SourceSchema, le.FileName,
      {brz_cols_str},
      le.LandingzoneEntityId, le.IsActive as LzActive, be.IsActive as BrzActive,
      ds.DataSourceId
    FROM integration.BronzeLayerEntity be
    JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    WHERE be.BronzeLayerEntityId NOT IN (
      SELECT DISTINCT BronzeLayerEntityId FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 1
    )
    AND be.IsActive = 1
    AND ds.Namespace != 'OPTIVA'
    ORDER BY ds.Namespace, le.SourceName
    """
    cols1, rows1 = run_query(conn, q1, "QUERY 1: Non-OPTIVA Unprocessed Bronze Entities (the 9)")
    print_table(cols1, rows1)

    # Save entity IDs for OneLake checks — parse by column name
    non_optiva_entities = []
    if rows1 and cols1:
        col_idx = {c: i for i, c in enumerate(cols1)}
        for row in rows1:
            non_optiva_entities.append({
                "namespace": str(row[col_idx["Namespace"]]),
                "source_name": str(row[col_idx["SourceName"]]),
                "source_schema": str(row[col_idx["SourceSchema"]]),
                "file_name": str(row[col_idx["FileName"]]) if row[col_idx["FileName"]] else None,
                "bronze_entity_id": row[col_idx["BronzeLayerEntityId"]],
                "lz_entity_id": row[col_idx["LandingzoneEntityId"]],
            })

    # ── Query 2: Pipeline Bronze rows for these 9 ──────────────────
    q2 = """
    SELECT pbe.BronzeLayerEntityId, pbe.TableName, pbe.IsProcessed, pbe.LoadEndDateTime
    FROM execution.PipelineBronzeLayerEntity pbe
    WHERE pbe.BronzeLayerEntityId IN (
      SELECT be.BronzeLayerEntityId
      FROM integration.BronzeLayerEntity be
      JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
      JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
      WHERE be.BronzeLayerEntityId NOT IN (
        SELECT DISTINCT BronzeLayerEntityId FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 1
      )
      AND be.IsActive = 1
      AND ds.Namespace != 'OPTIVA'
    )
    ORDER BY pbe.BronzeLayerEntityId
    """
    cols, rows = run_query(conn, q2, "QUERY 2: Pipeline Bronze execution rows for those 9 entities")
    print_table(cols, rows)

    # ── Query 3: LZ processed status for those entities ─────────────
    q3 = """
    SELECT le.LandingzoneEntityId, le.SourceName, le.SourceSchema, ds.Namespace,
      ple.IsProcessed, ple.LoadEndDateTime, ple.InsertDateTime
    FROM integration.LandingzoneEntity le
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    JOIN integration.BronzeLayerEntity be ON le.LandingzoneEntityId = be.LandingzoneEntityId
    LEFT JOIN execution.PipelineLandingzoneEntity ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
    WHERE be.BronzeLayerEntityId NOT IN (
      SELECT DISTINCT BronzeLayerEntityId FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 1
    )
    AND be.IsActive = 1
    AND ds.Namespace != 'OPTIVA'
    ORDER BY ds.Namespace, le.SourceName
    """
    cols, rows = run_query(conn, q3, "QUERY 3: LZ processed status for those 9 entities")
    print_table(cols, rows)

    # ── Query 4: Bronze pending view ────────────────────────────────
    q4 = """
    SELECT v.* FROM execution.vw_LoadToBronzeLayer v
    WHERE v.EntityId IN (
      SELECT be.BronzeLayerEntityId
      FROM integration.BronzeLayerEntity be
      JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
      JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
      WHERE be.BronzeLayerEntityId NOT IN (
        SELECT DISTINCT BronzeLayerEntityId FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 1
      )
      AND be.IsActive = 1
      AND ds.Namespace != 'OPTIVA'
    )
    """
    cols, rows = run_query(conn, q4, "QUERY 4: Bronze pending view (vw_LoadToBronzeLayer) for those 9")
    print_table(cols, rows, max_col_width=60)

    # ── Query 5: Silver tables ──────────────────────────────────────
    q5 = """
    SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%Silver%' OR TABLE_NAME LIKE '%silver%'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
    """
    cols, rows = run_query(conn, q5, "QUERY 5: Silver-related tables")
    print_table(cols, rows)

    # ── Query 5b: Silver execution tracking table ───────────────────
    q5b = """
    SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'execution'
    ORDER BY TABLE_NAME
    """
    cols, rows = run_query(conn, q5b, "QUERY 5b: All execution schema tables")
    print_table(cols, rows)

    # ── Query 5c: Check for PipelineSilverLayerEntity ───────────────
    q5c = """
    SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%Pipeline%'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
    """
    cols, rows = run_query(conn, q5c, "QUERY 5c: All Pipeline* tables")
    print_table(cols, rows)

    # ── Query 6: Silver stored procs ────────────────────────────────
    q6 = """
    SELECT ROUTINE_SCHEMA, ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES
    WHERE ROUTINE_NAME LIKE '%Silver%' OR ROUTINE_NAME LIKE '%silver%'
    ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
    """
    cols, rows = run_query(conn, q6, "QUERY 6: Silver-related stored procedures")
    print_table(cols, rows)

    # ── Query 7: Silver view content ────────────────────────────────
    q7 = """SELECT TOP 10 * FROM execution.vw_LoadToSilverLayer"""
    cols, rows = run_query(conn, q7, "QUERY 7: vw_LoadToSilverLayer (TOP 10)")
    print_table(cols, rows, max_col_width=60)

    # ── Query 8: OPTIVA LZ processed status ─────────────────────────
    q8 = """
    SELECT
      COUNT(*) as total_lz_entities,
      COUNT(CASE WHEN ple.LandingzoneEntityId IS NOT NULL THEN 1 END) as has_lz_run,
      COUNT(CASE WHEN ple.IsProcessed = 1 THEN 1 END) as lz_processed
    FROM integration.LandingzoneEntity le
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    LEFT JOIN execution.PipelineLandingzoneEntity ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
    WHERE ds.Namespace = 'OPTIVA'
    """
    cols, rows = run_query(conn, q8, "QUERY 8: OPTIVA LZ processed status summary")
    print_table(cols, rows)

    # ── Query 9: M3 LZ entity file info for unprocessed Bronze ──────
    q9 = """
    SELECT le.SourceName, le.SourceSchema, le.FileName,
      ds.Namespace, ds.Name as DataSourceName,
      le.LandingzoneEntityId
    FROM integration.LandingzoneEntity le
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    WHERE ds.Namespace = 'M3'
    AND le.LandingzoneEntityId IN (
      SELECT be.LandingzoneEntityId FROM integration.BronzeLayerEntity be
      WHERE be.BronzeLayerEntityId NOT IN (
        SELECT DISTINCT BronzeLayerEntityId FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 1
      ) AND be.IsActive = 1
    )
    """
    cols, rows = run_query(conn, q9, "QUERY 9: M3 LZ entity file info for unprocessed Bronze")
    print_table(cols, rows)

    # ── Extra: Total unprocessed Bronze count breakdown ──────────────
    q_extra = """
    SELECT ds.Namespace, COUNT(*) as unprocessed_count
    FROM integration.BronzeLayerEntity be
    JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    WHERE be.BronzeLayerEntityId NOT IN (
      SELECT DISTINCT BronzeLayerEntityId FROM execution.PipelineBronzeLayerEntity WHERE IsProcessed = 1
    )
    AND be.IsActive = 1
    GROUP BY ds.Namespace
    ORDER BY unprocessed_count DESC
    """
    cols, rows = run_query(conn, q_extra, "EXTRA: Unprocessed Bronze count by Namespace")
    print_table(cols, rows)

    # ── Extra: Total Bronze entity counts (using CTE to avoid nested aggregate) ──
    q_extra2 = """
    ;WITH processed AS (
      SELECT DISTINCT BronzeLayerEntityId
      FROM execution.PipelineBronzeLayerEntity
      WHERE IsProcessed = 1
    )
    SELECT ds.Namespace,
      COUNT(*) as total_active_bronze,
      SUM(CASE WHEN p.BronzeLayerEntityId IS NOT NULL THEN 1 ELSE 0 END) as processed,
      SUM(CASE WHEN p.BronzeLayerEntityId IS NULL THEN 1 ELSE 0 END) as unprocessed
    FROM integration.BronzeLayerEntity be
    JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    LEFT JOIN processed p ON be.BronzeLayerEntityId = p.BronzeLayerEntityId
    WHERE be.IsActive = 1
    GROUP BY ds.Namespace
    ORDER BY ds.Namespace
    """
    cols, rows = run_query(conn, q_extra2, "EXTRA: Bronze entity status by Namespace (active only)")
    print_table(cols, rows)

    # ── Extra: OPTIVA Bronze unprocessed breakdown ──────────────────
    q_extra3 = """
    ;WITH processed AS (
      SELECT DISTINCT BronzeLayerEntityId
      FROM execution.PipelineBronzeLayerEntity
      WHERE IsProcessed = 1
    )
    SELECT
      COUNT(*) as total_optiva_bronze_active,
      SUM(CASE WHEN p.BronzeLayerEntityId IS NOT NULL THEN 1 ELSE 0 END) as bronze_processed,
      SUM(CASE WHEN p.BronzeLayerEntityId IS NULL THEN 1 ELSE 0 END) as bronze_unprocessed
    FROM integration.BronzeLayerEntity be
    JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
    JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
    LEFT JOIN processed p ON be.BronzeLayerEntityId = p.BronzeLayerEntityId
    WHERE be.IsActive = 1 AND ds.Namespace = 'OPTIVA'
    """
    cols, rows = run_query(conn, q_extra3, "EXTRA: OPTIVA Bronze processed breakdown")
    print_table(cols, rows)

    # ── Extra: Check if PipelineSilverLayerEntity exists ────────────
    q_extra4 = """
    SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%PipelineSilver%'
    """
    cols, rows = run_query(conn, q_extra4, "EXTRA: Does PipelineSilverLayerEntity table exist?")
    print_table(cols, rows)

    conn.close()
    print("\n\nSQL queries complete. Now checking OneLake file existence...\n")

    # ════════════════════════════════════════════════════════════════════
    #  OneLake File Checks
    # ════════════════════════════════════════════════════════════════════
    print("="*100)
    print("  OneLake File Existence Checks")
    print("="*100)

    # OneLake DFS uses storage.azure.com scope
    onelake_token = get_token("https://storage.azure.com/.default")
    print("  Got OneLake DFS token (storage.azure.com scope).\n")

    def dfs_list(lakehouse_id, directory, recursive=False):
        """List a directory in OneLake via DFS."""
        url = (
            f"https://onelake.dfs.fabric.microsoft.com/"
            f"{WORKSPACE_DATA}/{lakehouse_id}"
            f"?resource=filesystem&directory={directory}&recursive={str(recursive).lower()}"
        )
        return fabric_api_get(onelake_token, url)

    # ── LZ Lakehouse top-level Files ────────────────────────────────
    print("  --- LZ Lakehouse: Top-level Files directory ---")
    data, status = dfs_list(LZ_LAKEHOUSE, "Files")
    if status == 200:
        paths = data.get("paths", [])
        print(f"  Found {len(paths)} top-level entries in LZ/Files:")
        for p in paths:
            name = p.get("name", "?")
            is_dir = p.get("isDirectory", "false")
            size = p.get("contentLength", "?")
            print(f"    {'[DIR]' if is_dir == 'true' else '[FILE]'} {name}  (size: {size})")
    else:
        print(f"  HTTP {status}: {json.dumps(data, indent=2)[:500]}")

    # ── Bronze Lakehouse top-level ──────────────────────────────────
    print("\n  --- Bronze Lakehouse: Top-level Tables directory ---")
    data, status = dfs_list(BRONZE_LAKEHOUSE, "Tables")
    if status == 200:
        paths = data.get("paths", [])
        print(f"  Found {len(paths)} entries in Bronze/Tables:")
        for p in paths[:40]:
            name = p.get("name", "?")
            is_dir = p.get("isDirectory", "false")
            print(f"    {'[DIR]' if is_dir == 'true' else '[FILE]'} {name}")
        if len(paths) > 40:
            print(f"    ... and {len(paths) - 40} more")
    else:
        print(f"  HTTP {status}: {json.dumps(data, indent=2)[:500]}")

    # ── Check the 9 non-OPTIVA entities ─────────────────────────────
    if non_optiva_entities:
        print(f"\n  --- Checking LZ directories for {len(non_optiva_entities)} non-OPTIVA entities ---")

        # Group by namespace
        by_ns = {}
        for ent in non_optiva_entities:
            ns = ent["namespace"]
            if ns not in by_ns:
                by_ns[ns] = []
            by_ns[ns].append(ent)

        for ns, entities in by_ns.items():
            print(f"\n  Namespace: {ns}")

            # Try to list the namespace folder in LZ
            for ns_try in [ns, ns.lower(), ns.upper()]:
                data, status = dfs_list(LZ_LAKEHOUSE, f"Files/{ns_try}")
                if status == 200:
                    paths = data.get("paths", [])
                    print(f"    LZ/Files/{ns_try}/ has {len(paths)} entries:")
                    for p in paths[:15]:
                        name = p.get("name", "?")
                        is_dir = p.get("isDirectory", "false")
                        print(f"      {'[DIR]' if is_dir == 'true' else '[FILE]'} {name}")
                    if len(paths) > 15:
                        print(f"      ... and {len(paths) - 15} more")
                    break
            else:
                print(f"    LZ/Files/{ns}/ not found (tried upper/lower variants)")

            # Check each entity
            for ent in entities:
                src = ent["source_name"]
                schema = ent["source_schema"]
                fname = ent["file_name"]
                print(f"\n    Entity: {schema}.{src} (file_name: {fname})")

                # Try common path patterns
                patterns = []
                if fname:
                    patterns.extend([
                        f"Files/{ns}/{schema}/{fname}",
                        f"Files/{ns.lower()}/{schema}/{fname}",
                        f"Files/{ns}/{fname}",
                    ])
                patterns.extend([
                    f"Files/{ns}/{schema}/{src}",
                    f"Files/{ns}/{src}",
                    f"Files/{ns.lower()}/{schema}/{src}",
                    f"Files/{ns.lower()}/{src}",
                ])

                found = False
                for pattern in patterns:
                    check_data, check_status = dfs_list(LZ_LAKEHOUSE, pattern)
                    if check_status == 200:
                        check_paths = check_data.get("paths", [])
                        print(f"      FOUND at {pattern} ({len(check_paths)} entries)")
                        for p in check_paths[:5]:
                            name = p.get("name", "?")
                            is_dir = p.get("isDirectory", "false")
                            size = p.get("contentLength", "?")
                            mod = p.get("lastModified", "?")
                            print(f"        {'[DIR]' if is_dir == 'true' else '[FILE]'} {name} (size: {size}, mod: {mod})")
                        found = True
                        break

                if not found:
                    print(f"      NOT FOUND in LZ (checked {len(patterns)} path patterns)")

                # Also check Bronze Tables for this entity
                brz_tname = f"{ns}_{schema}_{src}"
                brz_data, brz_status = dfs_list(BRONZE_LAKEHOUSE, f"Tables/{brz_tname}")
                if brz_status == 200:
                    brz_paths = brz_data.get("paths", [])
                    print(f"      Bronze Table '{brz_tname}': FOUND ({len(brz_paths)} entries)")
                else:
                    # Try the pattern from PipelineBronzeLayerEntity.TableName: MES_sourcename
                    brz_tname2 = f"{ns}_{src}"
                    brz_data2, brz_status2 = dfs_list(BRONZE_LAKEHOUSE, f"Tables/{brz_tname2}")
                    if brz_status2 == 200:
                        brz_paths2 = brz_data2.get("paths", [])
                        print(f"      Bronze Table '{brz_tname2}': FOUND ({len(brz_paths2)} entries)")
                    else:
                        print(f"      Bronze Table: NOT FOUND (tried '{brz_tname}' and '{brz_tname2}')")

    print("\n" + "="*100)
    print("  INVESTIGATION COMPLETE")
    print("="*100)


if __name__ == "__main__":
    main()
