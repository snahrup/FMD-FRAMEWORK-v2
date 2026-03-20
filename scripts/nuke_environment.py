"""
FMD Environment Nuke — Clean wipe for fresh deployment.

Two modes:
  soft  — Clears run artifacts only (OneLake files, execution tables, audit logs).
          Entity registrations, connections, and Fabric items preserved.
          Use before re-running the engine.

  hard  — Deletes ALL Fabric workspaces (cascade-deletes lakehouses, pipelines,
          notebooks, SQL DB, variable libs). Gateway connections preserved
          (they're tenant-level). Requires full redeploy via deploy_from_scratch.py.

Usage:
  python scripts/nuke_environment.py --mode soft
  python scripts/nuke_environment.py --mode hard
  python scripts/nuke_environment.py --mode hard --yes   # skip confirmation
"""

import argparse
import json
import sys
import time
import struct
from datetime import datetime
from pathlib import Path

import requests

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
CONFIG_JSON = ROOT / "dashboard" / "app" / "api" / "config.json"
ENV_FILE = ROOT / "dashboard" / "app" / "api" / ".env"
ITEM_CONFIG = ROOT / "config" / "item_config.yaml"

# ── Workspace display names (must match deploy_from_scratch.py) ──────────────
WORKSPACE_NAMES = {
    "data_dev":   "INTEGRATION DATA (D)",
    "code_dev":   "INTEGRATION CODE (D)",
    "data_prod":  "INTEGRATION DATA (P)",
    "code_prod":  "INTEGRATION CODE (P)",
    "config":     "INTEGRATION CONFIG",
}

FABRIC_API = "https://api.fabric.microsoft.com/v1"


# ── Helpers ──────────────────────────────────────────────────────────────────

def load_config():
    with open(CONFIG_JSON) as f:
        cfg = json.load(f)
    env = {}
    with open(ENV_FILE) as f:
        for line in f:
            if "=" in line:
                k, v = line.strip().split("=", 1)
                env[k] = v
    return cfg, env


def get_fabric_token(cfg, env):
    resp = requests.post(
        f"https://login.microsoftonline.com/{cfg['fabric']['tenant_id']}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": cfg["fabric"]["client_id"],
            "client_secret": env.get("FABRIC_CLIENT_SECRET", ""),
            "scope": "https://api.fabric.microsoft.com/.default",
        },
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def get_sql_token(cfg, env):
    resp = requests.post(
        f"https://login.microsoftonline.com/{cfg['fabric']['tenant_id']}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": cfg["fabric"]["client_id"],
            "client_secret": env.get("FABRIC_CLIENT_SECRET", ""),
            "scope": "https://analysis.windows.net/powerbi/api/.default",
        },
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def get_storage_token(cfg, env):
    resp = requests.post(
        f"https://login.microsoftonline.com/{cfg['fabric']['tenant_id']}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": cfg["fabric"]["client_id"],
            "client_secret": env.get("FABRIC_CLIENT_SECRET", ""),
            "scope": "https://storage.azure.com/.default",
        },
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def get_sql_connection(cfg, token):
    import pyodbc
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={cfg['sql']['server']};"
        f"DATABASE={cfg['sql']['database']};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


def banner(msg):
    print(f"\n{'='*60}")
    print(f"  {msg}")
    print(f"{'='*60}")


def step(msg, ok=True):
    status = "OK" if ok else "FAIL"
    icon = "  [+]" if ok else "  [!]"
    print(f"{icon} {msg}")


def warn(msg):
    print(f"  [!] {msg}")


# ── Soft Nuke ────────────────────────────────────────────────────────────────

def nuke_soft(cfg, env):
    """Clear run artifacts — OneLake files + execution/logging tables."""

    banner("SOFT NUKE — Clearing Run Artifacts")
    results = {"sql_tables": [], "onelake": []}

    # ── Phase 1: Clear SQL execution + logging tables ──
    print("\n  Phase 1: Clearing SQL execution & logging tables...")
    try:
        sql_token = get_sql_token(cfg, env)
        conn = get_sql_connection(cfg, sql_token)
        cursor = conn.cursor()

        tables_to_clear = [
            "execution.PipelineLandingzoneEntity",
            "execution.PipelineBronzeLayerEntity",
            "execution.EntityStatusSummary",
            "execution.EngineRun",
            "execution.EngineTaskLog",
            "logging.PipelineExecution",
            "logging.CopyActivityExecution",
            "logging.NotebookExecution",
        ]

        # Table names are from a hardcoded allowlist above — safe for string formatting.
        # Cannot use parameterized queries for identifiers (table names).
        import re
        allowed_tables = set(tables_to_clear)
        for table in tables_to_clear:
            if table not in allowed_tables:
                warn(f"Skipping unknown table: {table}")
                continue
            if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$', table):
                raise ValueError(f"Invalid table identifier: {table}")
            try:
                cursor.execute("SELECT COUNT(*) FROM " + table)  # noqa: S608 — validated identifier
                before = cursor.fetchone()[0]
                if before > 0:
                    cursor.execute("DELETE FROM " + table)  # noqa: S608 — validated identifier
                    conn.commit()
                    step(f"{table}: deleted {before} rows")
                    results["sql_tables"].append({"table": table, "deleted": before})
                else:
                    step(f"{table}: already empty")
                    results["sql_tables"].append({"table": table, "deleted": 0})
            except Exception as e:
                warn(f"{table}: {e}")
                results["sql_tables"].append({"table": table, "error": str(e)})

        # Optionally clear watermarks (ask user)
        cursor.execute("SELECT COUNT(*) FROM execution.LandingzoneEntityLastLoadValue")
        wm_count = cursor.fetchone()[0]
        if wm_count > 0:
            print(f"\n  Watermark table has {wm_count} records (seeds from deploy).")
            print("  These are needed for incremental loads after the first full load.")
            step(f"execution.LandingzoneEntityLastLoadValue: preserved ({wm_count} rows)")

        conn.close()
    except Exception as e:
        warn(f"SQL connection failed: {e}")
        results["sql_error"] = str(e)

    # ── Phase 2: Clear OneLake files ──
    print("\n  Phase 2: Clearing OneLake parquet files...")
    try:
        storage_token = get_storage_token(cfg, env)
        engine = cfg.get("engine", {})
        lakehouses = {
            "Landing Zone": engine.get("lz_lakehouse_id"),
            "Bronze": engine.get("bronze_lakehouse_id"),
            "Silver": engine.get("silver_lakehouse_id"),
        }
        ws_id = cfg.get("fabric", {}).get("workspace_data_id", "0596d0e7-e036-451d-a967-41a284302e8d")

        for lh_name, lh_id in lakehouses.items():
            if not lh_id:
                warn(f"{lh_name}: no lakehouse ID configured, skipping")
                continue
            deleted = _clean_onelake_files(storage_token, ws_id, lh_id, lh_name)
            results["onelake"].append({"lakehouse": lh_name, "id": lh_id, "deleted": deleted})

    except Exception as e:
        warn(f"OneLake cleanup failed: {e}")
        results["onelake_error"] = str(e)

    return results


def _clean_onelake_files(token, ws_id, lh_id, label):
    """Delete all files under {lh_id}/Files/ in OneLake."""
    headers = {"Authorization": f"Bearer {token}"}
    base = f"https://onelake.dfs.fabric.microsoft.com/{ws_id}"

    # List top-level directories under Files/
    resp = requests.get(
        base,
        headers=headers,
        params={"resource": "filesystem", "recursive": "false", "directory": f"{lh_id}/Files"},
    )
    if resp.status_code != 200:
        warn(f"{label}: could not list files (HTTP {resp.status_code})")
        return 0

    paths = resp.json().get("paths", [])
    if not paths:
        step(f"{label}: already empty")
        return 0

    # List ALL files recursively for count
    resp_all = requests.get(
        base,
        headers=headers,
        params={"resource": "filesystem", "recursive": "true", "directory": f"{lh_id}/Files"},
    )
    all_paths = resp_all.json().get("paths", []) if resp_all.status_code == 200 else []
    file_count = sum(1 for p in all_paths if p.get("isDirectory") != "true")

    # Delete each top-level directory (recursive delete)
    deleted = 0
    for p in paths:
        path_name = p.get("name", "")
        if not path_name:
            continue
        del_url = f"https://onelake.dfs.fabric.microsoft.com/{ws_id}/{path_name}"
        del_resp = requests.delete(del_url, headers=headers, params={"recursive": "true"})
        if del_resp.status_code in (200, 202, 204):
            folder = path_name.split("/")[-1]
            deleted += 1
            step(f"{label}: deleted /{folder}/ ")
        else:
            warn(f"{label}: failed to delete {path_name} (HTTP {del_resp.status_code})")

    step(f"{label}: cleaned {file_count} files in {deleted} directories")
    return file_count


# ── Hard Nuke ────────────────────────────────────────────────────────────────

def nuke_hard(cfg, env, skip_confirm=False):
    """Delete ALL Fabric workspaces. Full teardown for redeployment."""

    banner("HARD NUKE — Full Fabric Teardown")
    results = {"workspaces_deleted": [], "workspaces_skipped": [], "sql_cleared": False}

    fabric_token = get_fabric_token(cfg, env)
    headers = {"Authorization": f"Bearer {fabric_token}"}

    # ── Phase 1: Discover workspaces ──
    print("\n  Phase 1: Discovering INTEGRATION workspaces...")
    resp = requests.get(f"{FABRIC_API}/workspaces", headers=headers)
    resp.raise_for_status()
    all_ws = resp.json().get("value", [])

    # Find our workspaces by name prefix
    target_ws = [ws for ws in all_ws if ws.get("displayName", "").startswith("INTEGRATION")]
    if not target_ws:
        warn("No INTEGRATION workspaces found!")
        return results

    print(f"\n  Found {len(target_ws)} INTEGRATION workspaces:")
    for ws in target_ws:
        print(f"    - {ws['displayName']} ({ws['id']})")

    # ── Confirmation ──
    if not skip_confirm:
        print("\n  *** WARNING: This will PERMANENTLY DELETE all workspaces above ***")
        print("  *** All lakehouses, pipelines, notebooks, SQL DBs will be destroyed ***")
        print("  *** Gateway connections will be preserved (tenant-level) ***")
        confirm = input("\n  Type 'NUKE' to confirm: ")
        if confirm.strip() != "NUKE":
            print("\n  Aborted.")
            sys.exit(0)

    # ── Phase 2: Delete workspaces ──
    print("\n  Phase 2: Deleting workspaces...")
    for ws in target_ws:
        ws_name = ws["displayName"]
        ws_id = ws["id"]
        try:
            del_resp = requests.delete(f"{FABRIC_API}/workspaces/{ws_id}", headers=headers)
            if del_resp.status_code in (200, 204):
                step(f"Deleted: {ws_name} ({ws_id})")
                results["workspaces_deleted"].append({"name": ws_name, "id": ws_id})
            elif del_resp.status_code == 404:
                step(f"Already gone: {ws_name}")
                results["workspaces_skipped"].append({"name": ws_name, "reason": "not found"})
            else:
                warn(f"Failed to delete {ws_name}: HTTP {del_resp.status_code} — {del_resp.text[:200]}")
                results["workspaces_skipped"].append({"name": ws_name, "reason": f"HTTP {del_resp.status_code}"})
        except Exception as e:
            warn(f"Error deleting {ws_name}: {e}")
            results["workspaces_skipped"].append({"name": ws_name, "reason": str(e)})

    # ── Phase 3: Clear local config ──
    print("\n  Phase 3: Clearing local config references...")
    step("item_config.yaml workspace GUIDs will be re-populated by deploy_from_scratch.py")
    step("config.json SQL endpoint will be re-populated by deploy_from_scratch.py")

    # ── Summary ──
    banner("NUKE COMPLETE")
    print(f"\n  Workspaces deleted: {len(results['workspaces_deleted'])}")
    for ws in results["workspaces_deleted"]:
        print(f"    - {ws['name']}")
    if results["workspaces_skipped"]:
        print(f"\n  Workspaces skipped: {len(results['workspaces_skipped'])}")
        for ws in results["workspaces_skipped"]:
            print(f"    - {ws['name']}: {ws['reason']}")
    print("\n  PRESERVED:")
    print("    - Gateway connections (tenant-level)")
    print("    - Git repository (all code, configs, scripts)")
    print("    - deploy_from_scratch.py (ready to recreate everything)")
    print("\n  NEXT STEP:")
    print("    python deploy_from_scratch.py")
    print()

    return results


# ── Summary Report ───────────────────────────────────────────────────────────

def print_soft_summary(results):
    banner("SOFT NUKE COMPLETE")

    total_sql = sum(t.get("deleted", 0) for t in results.get("sql_tables", []))
    total_files = sum(o.get("deleted", 0) for o in results.get("onelake", []))

    print(f"\n  SQL rows deleted: {total_sql}")
    for t in results.get("sql_tables", []):
        if t.get("deleted", 0) > 0:
            print(f"    - {t['table']}: {t['deleted']} rows")

    print(f"\n  OneLake files deleted: {total_files}")
    for o in results.get("onelake", []):
        if o.get("deleted", 0) > 0:
            print(f"    - {o['lakehouse']}: {o['deleted']} files")

    print("\n  PRESERVED:")
    print("    - Entity registrations (integration.*)")
    print("    - Watermark seeds (execution.LandingzoneEntityLastLoadValue)")
    print("    - Fabric workspaces, lakehouses, pipelines, notebooks")
    print("    - All connections and gateway config")
    print("\n  Ready for clean engine run.")
    print()


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="FMD Environment Nuke")
    parser.add_argument("--mode", choices=["soft", "hard"], required=True,
                        help="soft=clear run data, hard=delete Fabric workspaces")
    parser.add_argument("--yes", action="store_true",
                        help="Skip confirmation prompt (hard mode only)")
    args = parser.parse_args()

    print(f"\n  FMD Environment Nuke — {args.mode.upper()} mode")
    print(f"  Timestamp: {datetime.utcnow().isoformat()}Z")

    cfg, env = load_config()

    if args.mode == "soft":
        results = nuke_soft(cfg, env)
        print_soft_summary(results)
    elif args.mode == "hard":
        results = nuke_hard(cfg, env, skip_confirm=args.yes)

    # Write results to file for dashboard consumption
    results_file = ROOT / "scripts" / "nuke_results.json"
    with open(results_file, "w") as f:
        json.dump({
            "mode": args.mode,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "results": results,
        }, f, indent=2, default=str)
    print(f"  Results saved to: {results_file}")


if __name__ == "__main__":
    main()
