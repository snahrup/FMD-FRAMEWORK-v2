"""
Register entities for MES, ETQ, and M3 Cloud sources.

Connects to each on-prem SQL server (VPN required), discovers all user tables,
then registers them in the Fabric metadata DB as LZ + Bronze + Silver entities.

Usage:
    python scripts/register_missing_sources.py              # live run
    python scripts/register_missing_sources.py --dry-run    # preview only
"""

import json
import os
import struct
import sys
import urllib.parse
import urllib.request
import pyodbc

# Sources to register — matches integration.DataSource records
SOURCES = [
    {
        "ds_name": "MES",           # integration.DataSource.Name
        "server": "m3-db1",
        "database": "mes",
    },
    {
        "ds_name": "ETQStagingPRD", # integration.DataSource.Name
        "server": "M3-DB3",
        "database": "ETQStagingPRD",
    },
    {
        "ds_name": "DI_PRD_Staging", # integration.DataSource.Name
        "server": "sql2016live",
        "database": "DI_PRD_Staging",
    },
]

# Fabric metadata DB connection
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)


def get_fabric_token():
    """Get SP token for Fabric SQL."""
    config_path = os.path.join(ROOT, "dashboard", "app", "api", "config.json")
    env_path = os.path.join(ROOT, "dashboard", "app", "api", ".env")

    with open(config_path) as f:
        cfg = json.load(f)

    # Read secret from .env
    secret = ""
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("FABRIC_CLIENT_SECRET="):
                    secret = line.split("=", 1)[1].strip()

    tenant = cfg["fabric"]["tenant_id"]
    client = cfg["fabric"]["client_id"]

    data = (
        f"grant_type=client_credentials"
        f"&client_id={client}"
        f"&client_secret={urllib.parse.quote(secret)}"
        f"&scope=https://analysis.windows.net/powerbi/api/.default"
    )
    req = urllib.request.Request(
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        data=data.encode(),
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    resp = json.loads(urllib.request.urlopen(req, timeout=15).read())
    return resp["access_token"], cfg


def connect_fabric(token, cfg):
    """Connect to Fabric SQL metadata DB."""
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    server = cfg["sql"]["server"]
    database = cfg["sql"]["database"]
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={server};DATABASE={database};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)


def connect_source(server, database):
    """Connect to an on-prem SQL server (VPN required)."""
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={server};DATABASE={database};"
        f"Trusted_Connection=yes;TrustServerCertificate=yes;"
        f"Connect Timeout=10;"
    )
    return pyodbc.connect(conn_str, timeout=10)


def discover_tables(server, database):
    """Get all user tables from a source database."""
    conn = connect_source(server, database)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
          AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
        ORDER BY TABLE_SCHEMA, TABLE_NAME
    """)
    tables = [(row[0], row[1]) for row in cursor.fetchall()]
    conn.close()
    return tables


def register_entities(fabric_conn, ds_name, tables, lz_lh, bronze_lh, silver_lh, dry_run=False):
    """Register all tables for a data source in Fabric metadata DB."""
    cursor = fabric_conn.cursor()

    # Look up DataSourceId
    cursor.execute(
        "SELECT DataSourceId FROM integration.DataSource WHERE Name = ?",
        (ds_name,),
    )
    row = cursor.fetchone()
    if not row:
        print(f"  [SKIP] DataSource '{ds_name}' not found in metadata DB")
        return 0, 0, 0

    ds_id = row[0]
    total_lz = 0
    total_bronze = 0
    total_silver = 0
    errors = 0

    for schema, table in tables:
        safe_schema = schema.strip().replace("'", "''")
        safe_table = table.strip().replace("'", "''")
        if not safe_table:
            continue

        if dry_run:
            total_lz += 1
            continue

        try:
            # 1. Register LZ entity
            cursor.execute(
                f"EXEC [integration].[sp_UpsertLandingzoneEntity] "
                f"@LandingzoneEntityId = 0, @DataSourceId = {ds_id}, "
                f"@LakehouseId = {lz_lh}, "
                f"@SourceSchema = '{safe_schema}', @SourceName = '{safe_table}', "
                f"@SourceCustomSelect = '', "
                f"@FileName = '{safe_table}', @FilePath = '', "
                f"@FileType = 'parquet', @IsIncremental = 0, "
                f"@IsIncrementalColumn = '', @CustomNotebookName = '', "
                f"@IsActive = 1"
            )
            cursor.commit()
            total_lz += 1

            # Get the LZ entity ID
            cursor.execute(
                "SELECT LandingzoneEntityId FROM integration.LandingzoneEntity "
                "WHERE SourceSchema = ? AND SourceName = ? AND DataSourceId = ?",
                (schema, table, ds_id),
            )
            lz_row = cursor.fetchone()
            if not lz_row:
                continue
            lz_eid = lz_row[0]

            # 2. Auto-register Bronze
            if bronze_lh:
                cursor.execute(
                    "SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?",
                    (lz_eid,),
                )
                if not cursor.fetchone():
                    cursor.execute(
                        f"EXEC [integration].[sp_UpsertBronzeLayerEntity] "
                        f"@BronzeLayerEntityId = 0, @LandingzoneEntityId = {lz_eid}, "
                        f"@LakehouseId = {bronze_lh}, @Schema = '{safe_schema}', "
                        f"@Name = '{safe_table}', @PrimaryKeys = 'N/A', "
                        f"@FileType = 'Delta', @IsActive = 1"
                    )
                    cursor.commit()
                total_bronze += 1

                # 3. Auto-register Silver
                if silver_lh:
                    cursor.execute(
                        "SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?",
                        (lz_eid,),
                    )
                    b_row = cursor.fetchone()
                    if b_row:
                        b_eid = b_row[0]
                        cursor.execute(
                            "SELECT SilverLayerEntityId FROM integration.SilverLayerEntity WHERE BronzeLayerEntityId = ?",
                            (b_eid,),
                        )
                        if not cursor.fetchone():
                            cursor.execute(
                                f"EXEC [integration].[sp_UpsertSilverLayerEntity] "
                                f"@SilverLayerEntityId = 0, @BronzeLayerEntityId = {b_eid}, "
                                f"@LakehouseId = {silver_lh}, @Schema = '{safe_schema}', "
                                f"@Name = '{safe_table}', @FileType = 'delta', @IsActive = 1"
                            )
                            cursor.commit()
                        total_silver += 1

        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"    [ERR] {schema}.{table}: {e}")
            elif errors == 6:
                print(f"    [ERR] ... suppressing further errors")

    return total_lz, total_bronze, total_silver


def main():
    dry_run = "--dry-run" in sys.argv

    print("=" * 70)
    print("Register Missing Source Entities (MES, ETQ, M3 Cloud)")
    print("=" * 70)
    if dry_run:
        print("[DRY RUN — no changes will be made]\n")

    # Connect to Fabric metadata DB
    print("Connecting to Fabric SQL metadata DB...")
    token, cfg = get_fabric_token()
    fabric_conn = connect_fabric(token, cfg)
    cursor = fabric_conn.cursor()

    # Look up lakehouse IDs
    cursor.execute("SELECT LakehouseId, Name FROM integration.Lakehouse ORDER BY LakehouseId ASC")
    lh_map = {}
    for row in cursor.fetchall():
        if row[1] not in lh_map:
            lh_map[row[1]] = row[0]
    lz_lh = lh_map.get("LH_DATA_LANDINGZONE")
    bronze_lh = lh_map.get("LH_BRONZE_LAYER")
    silver_lh = lh_map.get("LH_SILVER_LAYER")
    print(f"  Lakehouses: LZ={lz_lh}, Bronze={bronze_lh}, Silver={silver_lh}")

    grand_lz = 0
    grand_bronze = 0
    grand_silver = 0

    for src in SOURCES:
        ds_name = src["ds_name"]
        server = src["server"]
        database = src["database"]

        print(f"\n--- {ds_name} ({server}/{database}) ---")

        # Step 1: Discover tables from source
        try:
            tables = discover_tables(server, database)
            print(f"  Discovered {len(tables)} tables")
        except Exception as e:
            print(f"  [FAIL] Cannot connect to {server}/{database}: {e}")
            print(f"         Is VPN connected?")
            continue

        # Step 2: Register in metadata DB
        lz, bronze, silver = register_entities(
            fabric_conn, ds_name, tables, lz_lh, bronze_lh, silver_lh, dry_run=dry_run
        )
        print(f"  Registered: LZ={lz}, Bronze={bronze}, Silver={silver}")
        grand_lz += lz
        grand_bronze += bronze
        grand_silver += silver

    fabric_conn.close()

    print(f"\n{'=' * 70}")
    print(f"TOTAL: LZ={grand_lz}, Bronze={grand_bronze}, Silver={grand_silver}")
    print(f"{'=' * 70}")

    # Also update entity_registration.json for future deploys
    if not dry_run and grand_lz > 0:
        reg_file = os.path.join(ROOT, "config", "entity_registration.json")
        with open(reg_file) as f:
            existing = json.load(f)

        # Check which sources are already in the file
        existing_ds = {ds["dataSource"] for ds in existing}

        for src in SOURCES:
            if src["ds_name"] not in existing_ds:
                try:
                    tables = discover_tables(src["server"], src["database"])
                    # Group by schema
                    schema_tables = {}
                    for schema, table in tables:
                        schema_tables.setdefault(schema, []).append(table)
                    for schema, tbl_list in schema_tables.items():
                        existing.append({
                            "dataSource": src["ds_name"],
                            "schema": schema,
                            "tables": sorted(tbl_list),
                        })
                    print(f"  Added {src['ds_name']} to entity_registration.json")
                except Exception:
                    pass

        with open(reg_file, "w") as f:
            json.dump(existing, f, indent=2)
        print(f"  Updated {reg_file}")


if __name__ == "__main__":
    main()
