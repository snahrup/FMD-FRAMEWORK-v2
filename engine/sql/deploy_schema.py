"""
FMD v3 Engine Schema Deployment
Deploys engine tables, views, and stored procedures to Fabric SQL DB.

Usage:
    python engine/sql/deploy_schema.py          # deploy all SQL files
    python engine/sql/deploy_schema.py --dry-run # show SQL without executing

Auth: Service Principal token via client_credentials grant.
Reads credentials from dashboard/app/api/config.json + .env (same as server.py).
"""
import json
import os
import re
import struct
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode

# ── Resolve paths ──

SCRIPT_DIR = Path(__file__).resolve().parent            # engine/sql/
ENGINE_DIR = SCRIPT_DIR.parent                          # engine/
REPO_ROOT = ENGINE_DIR.parent                           # repo root
DASHBOARD_API = REPO_ROOT / "dashboard" / "app" / "api"

PREFIX = "[deploy_schema]"


# ── Configuration ──

def load_config() -> dict:
    """Load config.json and resolve ${ENV_VAR} placeholders."""
    config_path = DASHBOARD_API / "config.json"
    if not config_path.exists():
        print(f"{PREFIX} ERROR: config.json not found at {config_path}")
        sys.exit(1)

    with open(config_path) as f:
        raw = json.load(f)

    # Load .env into os.environ (manual — no dependency on python-dotenv)
    env_file = DASHBOARD_API / ".env"
    if env_file.exists():
        with open(env_file) as ef:
            for line in ef:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ.setdefault(key.strip(), val.strip())
    else:
        print(f"{PREFIX} WARNING: .env not found at {env_file}")

    def resolve(obj):
        if isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
            var = obj[2:-1]
            val = os.environ.get(var, "")
            if not val:
                print(f"{PREFIX} WARNING: {var} not set in environment")
            return val
        elif isinstance(obj, dict):
            return {k: resolve(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [resolve(v) for v in obj]
        return obj

    return resolve(raw)


# ── Auth ──

_token_cache: dict = {}


def get_token(config: dict, scope: str = "https://analysis.windows.net/powerbi/api/.default") -> str:
    """Get an OAuth2 token via client_credentials grant. Cached per scope."""
    cached = _token_cache.get(scope)
    if cached and cached["expires"] > time.time():
        return cached["token"]

    tenant_id = config["fabric"]["tenant_id"]
    client_id = config["fabric"]["client_id"]
    client_secret = config["fabric"]["client_secret"]

    if not client_secret:
        print(f"{PREFIX} ERROR: FABRIC_CLIENT_SECRET is empty — check .env file")
        sys.exit(1)

    data = urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": scope,
        "grant_type": "client_credentials",
    }).encode()

    req = Request(
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        data=data,
        method="POST",
    )
    resp = json.loads(urlopen(req).read())

    _token_cache[scope] = {
        "token": resp["access_token"],
        "expires": time.time() + resp.get("expires_in", 3600) - 60,
    }
    return resp["access_token"]


# ── SQL Connection ──

def get_connection(config: dict):
    """Connect to Fabric SQL Database using SP token (pyodbc + attrs_before)."""
    import pyodbc

    token = get_token(config, "https://analysis.windows.net/powerbi/api/.default")
    token_bytes = token.encode("UTF-16-LE")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

    server = config["sql"]["server"]
    database = config["sql"]["database"]
    driver = config["sql"].get("driver", "ODBC Driver 18 for SQL Server")

    conn_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


# ── SQL Execution ──

def split_on_go(sql_text: str) -> list[str]:
    """Split SQL text on GO batch separators.

    GO must appear on its own line (optionally with whitespace).
    Returns list of non-empty batches.
    """
    batches = re.split(r"^\s*GO\s*$", sql_text, flags=re.MULTILINE | re.IGNORECASE)
    return [b.strip() for b in batches if b.strip()]


def execute_sql_file(conn, filepath: Path, dry_run: bool = False) -> dict:
    """Execute a single SQL file, splitting on GO separators.

    Returns dict with counts of operations detected.
    """
    sql_text = filepath.read_text(encoding="utf-8")
    batches = split_on_go(sql_text)

    stats = {"batches": 0, "tables": 0, "views": 0, "procs": 0, "indexes": 0}

    for batch in batches:
        if dry_run:
            print(f"  -- Batch ({len(batch)} chars):")
            # Show first 120 chars of each batch
            preview = batch[:120].replace("\n", " ")
            print(f"     {preview}...")
            stats["batches"] += 1
            continue

        cursor = conn.cursor()
        try:
            cursor.execute(batch)
            conn.commit()
            stats["batches"] += 1
        except Exception as e:
            conn.rollback()
            raise RuntimeError(f"Batch failed in {filepath.name}:\n{str(e)}\n\nSQL:\n{batch[:500]}") from e
        finally:
            cursor.close()

        # Count what we created
        batch_upper = batch.upper()
        if "CREATE TABLE" in batch_upper:
            stats["tables"] += 1
        if "CREATE OR ALTER VIEW" in batch_upper:
            stats["views"] += 1
        if "CREATE OR ALTER PROCEDURE" in batch_upper:
            stats["procs"] += 1
        if "CREATE INDEX" in batch_upper:
            stats["indexes"] += 1

    return stats


def describe_stats(stats: dict) -> str:
    """Build a human-readable summary of what was deployed."""
    parts = []
    if stats["tables"]:
        parts.append(f"{stats['tables']} table(s) created")
    if stats["views"]:
        parts.append(f"{stats['views']} view(s) created")
    if stats["procs"]:
        parts.append(f"{stats['procs']} proc(s) created")
    if stats["indexes"]:
        parts.append(f"{stats['indexes']} index(es) created")
    if not parts:
        parts.append(f"{stats['batches']} batch(es) executed")
    return ", ".join(parts)


# ── Main ──

def main():
    dry_run = "--dry-run" in sys.argv

    if dry_run:
        print(f"{PREFIX} DRY RUN — SQL will be parsed but not executed")
        print()

    # Discover SQL files in order
    sql_dir = SCRIPT_DIR
    sql_files = sorted(sql_dir.glob("*.sql"))

    if not sql_files:
        print(f"{PREFIX} ERROR: No .sql files found in {sql_dir}")
        sys.exit(1)

    print(f"{PREFIX} Found {len(sql_files)} SQL file(s) to deploy:")
    for f in sql_files:
        print(f"  - {f.name}")
    print()

    # Load config
    config = load_config()
    print(f"{PREFIX} Config loaded from {DASHBOARD_API / 'config.json'}")

    # Connect
    conn = None
    if not dry_run:
        print(f"{PREFIX} Connecting to Fabric SQL DB...")
        try:
            conn = get_connection(config)
        except Exception as e:
            print(f"{PREFIX} ERROR: Failed to connect: {e}")
            sys.exit(1)
        print(f"{PREFIX} Token acquired successfully")
        print(f"{PREFIX} Connected to {config['sql']['database']}")
        print()

    # Execute each SQL file in order
    total_stats = {"batches": 0, "tables": 0, "views": 0, "procs": 0, "indexes": 0}
    failed = False

    for sql_file in sql_files:
        label = f"Executing {sql_file.name}..."
        try:
            stats = execute_sql_file(conn, sql_file, dry_run=dry_run)
            summary = describe_stats(stats)
            print(f"{PREFIX} {label} OK ({summary})")
            for k in total_stats:
                total_stats[k] += stats[k]
        except Exception as e:
            print(f"{PREFIX} {label} FAILED")
            print(f"{PREFIX} ERROR: {e}")
            failed = True
            break

    # Cleanup
    if conn:
        conn.close()

    print()
    if failed:
        print(f"{PREFIX} Schema deployment FAILED — fix the error above and re-run.")
        sys.exit(1)
    else:
        summary = describe_stats(total_stats)
        if dry_run:
            print(f"{PREFIX} Dry run complete — {total_stats['batches']} batches parsed across {len(sql_files)} files.")
        else:
            print(f"{PREFIX} Schema deployment complete! ({summary})")


if __name__ == "__main__":
    main()
