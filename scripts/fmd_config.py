"""
Shared config reader for FMD deployment scripts.

Reads IDs from config/item_config.yaml and dashboard/app/api/config.json
so scripts never hardcode workspace/lakehouse/notebook GUIDs.

Usage:
    from fmd_config import load_fmd_config
    cfg = load_fmd_config()
    ws_code = cfg['workspaces']['workspace_code']
"""

import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)


def _read_yaml_simple(path: str) -> dict:
    """Read a simple YAML file without pyyaml (handles flat key: value pairs)."""
    result = {}
    current_section = None
    with open(path, encoding='utf-8') as f:
        for line in f:
            stripped = line.rstrip()
            if not stripped or stripped.startswith('#'):
                continue
            if not stripped.startswith(' ') and stripped.endswith(':'):
                current_section = stripped[:-1]
                result[current_section] = {}
            elif current_section and ':' in stripped:
                k, v = stripped.strip().split(':', 1)
                v = v.strip().strip('"').strip("'")
                result[current_section][k.strip()] = v
    return result


def load_fmd_config() -> dict:
    """Load the full FMD config from both YAML and JSON sources.

    Returns dict with keys:
        tenant_id, client_id, client_secret,
        workspaces: {workspace_data, workspace_code, workspace_config, ...},
        engine: {lz_lakehouse_id, bronze_lakehouse_id, ...},
        sql: {server, database},
    """
    # Load .env secrets
    env_path = os.path.join(PROJECT_ROOT, 'dashboard', 'app', 'api', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if '=' in line and not line.startswith('#'):
                    k, v = line.strip().split('=', 1)
                    os.environ[k] = v

    # Read item_config.yaml for workspace + connection GUIDs
    yaml_path = os.path.join(PROJECT_ROOT, 'config', 'item_config.yaml')
    yaml_cfg = _read_yaml_simple(yaml_path) if os.path.exists(yaml_path) else {}

    # Read config.json for engine + sql + fabric sections
    json_path = os.path.join(PROJECT_ROOT, 'dashboard', 'app', 'api', 'config.json')
    json_cfg = {}
    if os.path.exists(json_path):
        with open(json_path, encoding='utf-8') as f:
            json_cfg = json.load(f)

    fabric = json_cfg.get('fabric', {})
    return {
        'tenant_id': fabric.get('tenant_id', ''),
        'client_id': fabric.get('client_id', ''),
        'client_secret': os.environ.get('FABRIC_CLIENT_SECRET', ''),
        'workspaces': yaml_cfg.get('workspaces', {}),
        'connections': yaml_cfg.get('connections', {}),
        'database': yaml_cfg.get('database', {}),
        'engine': json_cfg.get('engine', {}),
        'sql': json_cfg.get('sql', {}),
    }
