#!/usr/bin/env python3
"""
deploy_monitoring_views.py — Create real-time monitoring views in the SQL metadata DB.

These views join integration + execution + logging tables to give a live picture
of LZ/Bronze/Silver load progress during notebook or engine runs.

Usage:
    python scripts/deploy_monitoring_views.py          # deploy all views
    python scripts/deploy_monitoring_views.py --test   # deploy + run sample queries
"""

import argparse
import json
import os
import struct
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
CONFIG_PATH = PROJECT_ROOT / "dashboard" / "app" / "api" / "config.json"
ENV_PATH = PROJECT_ROOT / "dashboard" / "app" / "api" / ".env"

# ── Config ──────────────────────────────────────────────────────────────────

def load_config():
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    # Resolve client secret from .env
    secret = cfg["fabric"].get("client_secret", "")
    if secret.startswith("${"):
        with open(ENV_PATH) as f:
            for line in f:
                if line.startswith("FABRIC_CLIENT_SECRET="):
                    secret = line.strip().split("=", 1)[1]
                    break
    cfg["fabric"]["client_secret"] = secret
    return cfg


def get_sql_token(cfg):
    data = urlencode({
        "client_id": cfg["fabric"]["client_id"],
        "client_secret": cfg["fabric"]["client_secret"],
        "scope": "https://database.windows.net/.default",
        "grant_type": "client_credentials",
    }).encode()
    req = Request(
        f"https://login.microsoftonline.com/{cfg['fabric']['tenant_id']}/oauth2/v2.0/token",
        data=data, method="POST",
    )
    resp = json.loads(urlopen(req).read())
    return resp["access_token"]


def get_connection(cfg):
    import pyodbc
    token = get_sql_token(cfg)
    token_bytes = token.encode("UTF-16-LE")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    driver = cfg["sql"].get("driver", "ODBC Driver 18 for SQL Server")
    conn_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={cfg['sql']['server']};"
        f"DATABASE={cfg['sql']['database']};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)


# ── Views ───────────────────────────────────────────────────────────────────

VIEWS = [
    # ── 1. Per-entity load status (real-time) ──
    (
        "execution.vw_LZ_LoadStatus",
        """
CREATE OR ALTER VIEW [execution].[vw_LZ_LoadStatus] AS
/*
    Real-time LZ load status per entity.
    Shows: source, table name, whether loaded, timestamp, file path.
    Use this to see exactly which entities have been loaded and which are pending.
*/
SELECT
    ds.Namespace                                        AS Source,
    le.SourceSchema                                     AS [Schema],
    le.SourceName                                       AS TableName,
    CASE WHEN ple.LandingzoneEntityId IS NOT NULL
         THEN 'Loaded' ELSE 'Pending' END               AS Status,
    ple.LoadDateTime                                    AS LoadedAt,
    ple.FileName                                        AS TargetFile,
    ple.FilePath                                        AS TargetPath,
    le.IsIncremental                                    AS IsIncremental,
    le.IsIncrementalColumn                              AS WatermarkColumn,
    llv.LoadValue                                       AS LastWatermark,
    c.ServerName                                        AS SourceServer,
    c.DatabaseName                                      AS SourceDatabase,
    le.LandingzoneEntityId                              AS EntityId
FROM integration.LandingzoneEntity le
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
LEFT JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
LEFT JOIN (
    SELECT LandingzoneEntityId,
           MAX(COALESCE(LoadEndDateTime, InsertDateTime)) AS LoadDateTime,
           MAX(FileName) AS FileName, MAX(FilePath) AS FilePath
    FROM execution.PipelineLandingzoneEntity
    GROUP BY LandingzoneEntityId
) ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
LEFT JOIN execution.LandingzoneEntityLastLoadValue llv
    ON le.LandingzoneEntityId = llv.LandingzoneEntityId
WHERE le.IsActive = 1 AND ds.IsActive = 1;
"""
    ),

    # ── 2. Progress summary by source ──
    (
        "execution.vw_LZ_ProgressBySource",
        """
CREATE OR ALTER VIEW [execution].[vw_LZ_ProgressBySource] AS
/*
    Aggregated LZ load progress per data source.
    Shows: total entities, loaded count, pending count, % complete.
    Use this for a high-level progress bar per source system.
*/
SELECT
    ds.Namespace                                        AS Source,
    c.ServerName                                        AS SourceServer,
    c.DatabaseName                                      AS SourceDatabase,
    COUNT(*)                                            AS TotalEntities,
    SUM(CASE WHEN ple.LandingzoneEntityId IS NOT NULL
             THEN 1 ELSE 0 END)                         AS LoadedCount,
    COUNT(*) - SUM(CASE WHEN ple.LandingzoneEntityId IS NOT NULL
                        THEN 1 ELSE 0 END)              AS PendingCount,
    CAST(
        100.0 * SUM(CASE WHEN ple.LandingzoneEntityId IS NOT NULL
                         THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)
    )                                                   AS PctComplete,
    MIN(ple.LoadDateTime)                               AS FirstLoaded,
    MAX(ple.LoadDateTime)                               AS LastLoaded
FROM integration.LandingzoneEntity le
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
LEFT JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
LEFT JOIN (
    SELECT LandingzoneEntityId,
           MAX(COALESCE(LoadEndDateTime, InsertDateTime)) AS LoadDateTime
    FROM execution.PipelineLandingzoneEntity
    GROUP BY LandingzoneEntityId
) ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
WHERE le.IsActive = 1 AND ds.IsActive = 1
GROUP BY ds.Namespace, c.ServerName, c.DatabaseName;
"""
    ),

    # ── 3. Recent copy activity feed (real-time tail) ──
    (
        "execution.vw_LZ_RecentActivity",
        """
CREATE OR ALTER VIEW [execution].[vw_LZ_RecentActivity] AS
/*
    Last 200 copy activities — real-time feed during a run.
    Shows entity name, start/end, duration, row count, errors.
    Query with: SELECT TOP 50 * FROM execution.vw_LZ_RecentActivity ORDER BY LogTime DESC
*/
SELECT TOP 200
    le.SourceName                                       AS TableName,
    ds.Namespace                                        AS Source,
    ca.LogType,
    ca.LogDateTime                                      AS LogTime,
    ca.EntityLayer                                      AS Layer,
    ca.LogData,
    ca.CopyActivityParameters                           AS ActivityParams,
    ca.PipelineRunGuid                                  AS RunId,
    le.LandingzoneEntityId                              AS EntityId
FROM logging.CopyActivityExecution ca
LEFT JOIN integration.LandingzoneEntity le ON ca.EntityId = le.LandingzoneEntityId
LEFT JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
ORDER BY ca.LogDateTime DESC;
"""
    ),

    # ── 4. Entity pipeline status (what the notebook spawned) ──
    (
        "execution.vw_LZ_PipelineRuns",
        """
CREATE OR ALTER VIEW [execution].[vw_LZ_PipelineRuns] AS
/*
    All LZ pipeline execution records with entity details.
    Shows every file written to the Landing Zone lakehouse.
*/
SELECT
    ple.PipelineLandingzoneEntityId,
    ds.Namespace                                        AS Source,
    le.SourceSchema                                     AS [Schema],
    le.SourceName                                       AS TableName,
    ple.FileName,
    ple.FilePath,
    ple.IsProcessed                                     AS BronzePickedUp,
    ple.LoadEndDateTime                                 AS LoadedAt,
    le.LandingzoneEntityId                              AS EntityId
FROM execution.PipelineLandingzoneEntity ple
JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId;
"""
    ),

    # ── 5. Full entity inventory with watermark info ──
    (
        "execution.vw_EntityInventory",
        """
CREATE OR ALTER VIEW [execution].[vw_EntityInventory] AS
/*
    Complete entity inventory — every registered entity with its
    load optimization settings, watermark values, and current status.
*/
SELECT
    le.LandingzoneEntityId                              AS EntityId,
    ds.Namespace                                        AS Source,
    le.SourceSchema                                     AS [Schema],
    le.SourceName                                       AS TableName,
    c.ServerName                                        AS SourceServer,
    c.DatabaseName                                      AS SourceDatabase,
    le.IsActive,
    le.IsIncremental,
    le.IsIncrementalColumn                              AS WatermarkColumn,
    llv.LoadValue                                       AS LastWatermark,
    llv.LastLoadDatetime                                AS WatermarkUpdatedAt,
    be.BronzeLayerEntityId,
    be.PrimaryKeys                                      AS BronzePKs,
    se.SilverLayerEntityId,
    CASE WHEN ple.cnt > 0 THEN 'Loaded' ELSE 'Not Loaded' END AS LzStatus,
    ple.cnt                                             AS LzLoadCount,
    ple.lastLoad                                        AS LzLastLoad
FROM integration.LandingzoneEntity le
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
LEFT JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId
LEFT JOIN integration.BronzeLayerEntity be ON le.LandingzoneEntityId = be.LandingzoneEntityId
LEFT JOIN integration.SilverLayerEntity se ON be.BronzeLayerEntityId = se.BronzeLayerEntityId
LEFT JOIN execution.LandingzoneEntityLastLoadValue llv
    ON le.LandingzoneEntityId = llv.LandingzoneEntityId
LEFT JOIN (
    SELECT LandingzoneEntityId, COUNT(*) AS cnt, MAX(LoadEndDateTime) AS lastLoad
    FROM execution.PipelineLandingzoneEntity
    GROUP BY LandingzoneEntityId
) ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
WHERE le.IsActive = 1;
"""
    ),

    # ── 6. Overall progress dashboard (single row) ──
    (
        "execution.vw_LZ_OverallProgress",
        """
CREATE OR ALTER VIEW [execution].[vw_LZ_OverallProgress] AS
/*
    Single-row overall progress.
    Use this for a dashboard header: "247 / 1666 entities loaded (14.8%)"
*/
SELECT
    COUNT(*)                                            AS TotalEntities,
    SUM(CASE WHEN ple.LandingzoneEntityId IS NOT NULL
             THEN 1 ELSE 0 END)                         AS LoadedEntities,
    COUNT(*) - SUM(CASE WHEN ple.LandingzoneEntityId IS NOT NULL
                        THEN 1 ELSE 0 END)              AS PendingEntities,
    CAST(
        100.0 * SUM(CASE WHEN ple.LandingzoneEntityId IS NOT NULL
                         THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)
    )                                                   AS PctComplete,
    MIN(ple.LoadDateTime)                               AS RunStarted,
    MAX(ple.LoadDateTime)                               AS LastActivity,
    DATEDIFF(SECOND,
        MIN(ple.LoadDateTime),
        MAX(ple.LoadDateTime)
    )                                                   AS ElapsedSeconds
FROM integration.LandingzoneEntity le
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
LEFT JOIN (
    SELECT LandingzoneEntityId,
           MAX(COALESCE(LoadEndDateTime, InsertDateTime)) AS LoadDateTime
    FROM execution.PipelineLandingzoneEntity
    GROUP BY LandingzoneEntityId
) ple ON le.LandingzoneEntityId = ple.LandingzoneEntityId
WHERE le.IsActive = 1 AND ds.IsActive = 1;
"""
    ),
]


# ── Deploy ──────────────────────────────────────────────────────────────────

def deploy_views(conn):
    cursor = conn.cursor()
    succeeded = 0
    failed = 0

    for view_name, ddl in VIEWS:
        try:
            cursor.execute(ddl)
            conn.commit()
            print(f"  [OK] {view_name}")
            succeeded += 1
        except Exception as e:
            print(f"  [FAIL] {view_name}: {str(e)[:200]}")
            conn.rollback()
            failed += 1

    return succeeded, failed


def run_tests(conn):
    """Run sample queries against each view to verify they work."""
    cursor = conn.cursor()
    tests = [
        ("Overall Progress", "SELECT * FROM execution.vw_LZ_OverallProgress"),
        ("Progress by Source", "SELECT * FROM execution.vw_LZ_ProgressBySource"),
        ("Loaded Entities (top 10)", "SELECT TOP 10 Source, TableName, Status, LoadedAt FROM execution.vw_LZ_LoadStatus WHERE Status = 'Loaded' ORDER BY LoadedAt DESC"),
        ("Pending Entities (top 10)", "SELECT TOP 10 Source, TableName, Status FROM execution.vw_LZ_LoadStatus WHERE Status = 'Pending' ORDER BY Source, TableName"),
        ("Recent Activity (top 10)", "SELECT TOP 10 * FROM execution.vw_LZ_RecentActivity ORDER BY LogTime DESC"),
        ("Entity Inventory (count)", "SELECT Source, COUNT(*) AS Cnt, SUM(CAST(IsIncremental AS INT)) AS IncrementalCount FROM execution.vw_EntityInventory GROUP BY Source"),
    ]

    for label, sql in tests:
        print(f"\n  --- {label} ---")
        try:
            cursor.execute(sql)
            if cursor.description:
                cols = [c[0] for c in cursor.description]
                rows = cursor.fetchall()
                if not rows:
                    print("    (no rows)")
                    continue
                # Print header
                widths = [max(len(str(c)), max(len(str(r[i] if r[i] is not None else "")) for r in rows)) for i, c in enumerate(cols)]
                widths = [min(w, 40) for w in widths]  # cap width
                header = "  ".join(str(c).ljust(w) for c, w in zip(cols, widths))
                print(f"    {header}")
                print(f"    {'  '.join('-' * w for w in widths)}")
                for row in rows[:10]:
                    vals = [str(v if v is not None else "").ljust(w)[:w] for v, w in zip(row, widths)]
                    print(f"    {'  '.join(vals)}")
                if len(rows) > 10:
                    print(f"    ... and {len(rows) - 10} more rows")
        except Exception as e:
            print(f"    ERROR: {str(e)[:200]}")


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Deploy monitoring views to Fabric SQL DB")
    parser.add_argument("--test", action="store_true", help="Run sample queries after deploying")
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("  FMD Monitoring Views — Deploy")
    print("=" * 60)

    cfg = load_config()
    conn = get_connection(cfg)

    print(f"\n  Deploying {len(VIEWS)} views...\n")
    succeeded, failed = deploy_views(conn)

    print(f"\n  Done: {succeeded} OK, {failed} failed")

    if args.test or True:  # always run tests
        print("\n" + "=" * 60)
        print("  Running verification queries...")
        print("=" * 60)
        run_tests(conn)

    conn.close()
    print("\n" + "=" * 60)
    print("  Complete")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
