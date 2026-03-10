"""
FMD v3 Engine — Configuration loader.

Reads from the shared dashboard config.json + .env file, then builds an
EngineConfig object that the rest of the engine consumes.  No globals,
no singletons — call load_config() and pass the result around.
"""

import json
import os
from pathlib import Path
from typing import Any

from engine.models import EngineConfig


# ---------------------------------------------------------------------------
# .env loader (same pattern as dashboard/app/api/server.py)
# ---------------------------------------------------------------------------

def _load_env(env_path: Path) -> int:
    """Parse a .env file and populate os.environ (setdefault — won't clobber)."""
    if not env_path.exists():
        return 0
    count = 0
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())
            count += 1
    return count


# ---------------------------------------------------------------------------
# ${ENV_VAR} resolver (same pattern as dashboard/app/api/server.py)
# ---------------------------------------------------------------------------

def _resolve_env_vars(obj: Any) -> Any:
    """Recursively replace '${VAR}' placeholders with os.environ values."""
    if isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
        var_name = obj[2:-1]
        return os.environ.get(var_name, "")
    if isinstance(obj, dict):
        return {k: _resolve_env_vars(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_resolve_env_vars(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_config(config_path: str | Path | None = None) -> EngineConfig:
    """Load configuration from config.json + .env and return an EngineConfig.

    Resolution order:
      1. dashboard/app/api/.env  → sets env vars (setdefault)
      2. dashboard/app/api/config.json → reads JSON, resolves ${ENV_VAR}
      3. Merge with hardcoded defaults for engine-specific settings

    Parameters
    ----------
    config_path : optional
        Explicit path to config.json.  If None, uses the dashboard default.

    Returns
    -------
    EngineConfig
        Fully populated configuration dataclass.
    """
    # Locate config.json relative to this file  (engine/ is a sibling of dashboard/)
    if config_path is None:
        config_path = Path(__file__).resolve().parent.parent / "dashboard" / "app" / "api" / "config.json"
    else:
        config_path = Path(config_path)

    # Load .env from the same directory as config.json
    env_path = config_path.parent / ".env"
    _load_env(env_path)

    # Parse and resolve
    with open(config_path, encoding="utf-8") as f:
        raw: dict = json.load(f)
    cfg: dict = _resolve_env_vars(raw)

    fabric = cfg.get("fabric", {})
    sql = cfg.get("sql", {})
    engine_section = cfg.get("engine", {})

    return EngineConfig(
        # Fabric SQL metadata DB
        sql_server=sql.get("server", ""),
        sql_database=sql.get("database", ""),
        sql_driver=sql.get("driver", "ODBC Driver 18 for SQL Server"),

        # Service Principal
        tenant_id=fabric.get("tenant_id", ""),
        client_id=fabric.get("client_id", ""),
        client_secret=fabric.get("client_secret", ""),

        # Workspaces
        workspace_data_id=fabric.get("workspace_data_id", ""),
        workspace_code_id=fabric.get("workspace_code_id", ""),

        # Lakehouses — from engine section in config.json (per-entity GUIDs override these)
        lz_lakehouse_id=engine_section.get("lz_lakehouse_id", ""),
        bronze_lakehouse_id=engine_section.get("bronze_lakehouse_id", ""),
        silver_lakehouse_id=engine_section.get("silver_lakehouse_id", ""),

        # Notebook item IDs (for triggering Bronze/Silver)
        notebook_bronze_id=engine_section.get("notebook_bronze_id", ""),
        notebook_silver_id=engine_section.get("notebook_silver_id", ""),
        notebook_processing_id=engine_section.get("notebook_processing_id", ""),
        notebook_maintenance_id=engine_section.get("notebook_maintenance_id", ""),

        # Tunables
        batch_size=int(engine_section.get("batch_size", 15)),
        chunk_rows=int(engine_section.get("chunk_rows", 500_000)),
        copy_timeout_seconds=int(engine_section.get("copy_timeout_seconds", 14_400)),
        notebook_timeout_seconds=int(engine_section.get("notebook_timeout_seconds", 21_600)),
        query_timeout=int(engine_section.get("query_timeout", 120)),
        source_sql_driver=engine_section.get("source_sql_driver", "ODBC Driver 18 for SQL Server"),

        # Execution mode: "notebook" (Fabric notebooks), "pipeline" (Fabric pipelines), "local" (pyodbc)
        load_method=engine_section.get("load_method", "notebook"),
        pipeline_fallback=engine_section.get("pipeline_fallback", True),
        pipeline_copy_sql_id=engine_section.get("pipeline_copy_sql_id", ""),
        pipeline_workspace_id=engine_section.get("pipeline_workspace_id", ""),
    )
