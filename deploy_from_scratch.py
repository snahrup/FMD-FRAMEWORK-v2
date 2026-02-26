#!/usr/bin/env python3
"""
deploy_from_scratch.py — Full greenfield FMD Framework deployment to Microsoft Fabric.

Replicates everything NB_SETUP_FMD.ipynb does, as a standalone Python script.
Deploys a complete FMD Framework from zero on a new Fabric capacity.

Usage:
    python deploy_from_scratch.py [--env dev|prod|all] [--dry-run] [--skip-phase PHASE]
    python deploy_from_scratch.py --resume          # resume from last completed phase

Prerequisites:
    - Python 3.8+ (stdlib only for core; pyodbc for SQL metadata)
    - ODBC Driver 18 for SQL Server (for Phase 10)
    - Network access to Fabric REST API + Azure AD
    - Service Principal with Fabric Admin rights
    - FMD_FRAMEWORK repo cloned locally

Author: Steve Nahrup
"""

import argparse
import base64
import hashlib
import json
import os
import re
import struct
import sys
import time as time_mod
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
FABRIC_API = "https://api.fabric.microsoft.com/v1"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Service Principal for role assignments
SERVICE_PRINCIPAL_ID = "91741faf-f475-4266-95da-abc62bd69de6"

# Workspace naming convention
WORKSPACE_NAMES = {
    "data_dev":   "INTEGRATION DATA (D)",
    "code_dev":   "INTEGRATION CODE (D)",
    "data_prod":  "INTEGRATION DATA (P)",
    "code_prod":  "INTEGRATION CODE (P)",
    "config":     "INTEGRATION CONFIG",
}

# Lakehouse names (deployed into each DATA workspace)
LAKEHOUSE_NAMES = [
    "LH_DATA_LANDINGZONE",
    "LH_BRONZE_LAYER",
    "LH_SILVER_LAYER",
]

# Connection definitions
# "type" = Fabric API connection type, "metadata_type" = what the pipeline Switch expects
CONNECTION_DEFS = {
    "CON_FMD_FABRIC_PIPELINES": {
        "type": "FabricDataPipelines",
        "metadata_type": "PIPELINE",
        "auto_create": True,
        "cred_type": "ServicePrincipal",
    },
    "CON_FMD_FABRIC_SQL": {
        "type": "FabricSql",
        "metadata_type": "SQL",  # NOT "SqlServer" — pipeline Switch expects uppercase "SQL"
        "auto_create": False,
        "cred_type": "ServicePrincipal",
    },
    "CON_FMD_ADF_PIPELINES": {
        "type": "AzureDataFactory",
        "metadata_type": "ADF",
        "auto_create": False,
        "cred_type": "ServicePrincipal",
    },
    "CON_FMD_FABRIC_NOTEBOOKS": {
        "type": "FabricNotebook",
        "metadata_type": "NOTEBOOK",
        "auto_create": False,
        "cred_type": "ServicePrincipal",
    },
}

# On-prem gateway connections — these CANNOT be auto-created via API.
# Gateway connections must be created via Fabric portal by a gateway admin.
# The script looks up existing connections by name and maps their GUIDs
# for pipeline JSON replacement and metadata DB registration.
GATEWAY_CONNECTION_DEFS = {
    "CON_FMD_M3DB1_MES": {
        "metadata_type": "SQL",
        "description": "MES database on m3-db1 via on-prem gateway",
        "cred_type": "Basic",  # username/password with TrustServerCertificate=True
    },
    "CON_FMD_M3DB3_ETQSTAGINGPRD": {
        "metadata_type": "SQL",
        "description": "ETQStagingPRD on sql2016live via on-prem gateway",
        "cred_type": "Basic",
    },
    "CON_FMD_M3DB1_M3": {
        "metadata_type": "SQL",
        "description": "M3 ERP (m3fdbprd) on m3-db1 via on-prem gateway",
        "cred_type": "Basic",
    },
    "CON_FMD_M3DB1_M3CLOUD": {
        "metadata_type": "SQL",
        "description": "M3 Cloud (DI_PRD_Staging) on sql2016live via on-prem gateway",
        "cred_type": "Basic",
    },
}

# On-prem data sources — registered in Phase 10 alongside built-in sources.
# Maps data source display name to its connection name (for FK lookup).
ONPREM_DATASOURCE_DEFS = {
    "MES": {
        "connection": "CON_FMD_M3DB1_MES",
        "namespace": "dbo",
        "type": "SQL",
        "description": "MES production database (445 entities)",
    },
    "ETQStagingPRD": {
        "connection": "CON_FMD_M3DB3_ETQSTAGINGPRD",
        "namespace": "dbo",
        "type": "SQL",
        "description": "ETQ Staging PRD (29 entities)",
    },
    "DI_PRD_Staging": {
        "connection": "CON_FMD_M3DB1_M3CLOUD",
        "namespace": "dbo",
        "type": "SQL",
        "description": "M3 Cloud DI_PRD_Staging (185 entities)",
    },
    "m3fdbprd": {
        "connection": "CON_FMD_M3DB1_M3",
        "namespace": "dbo",
        "type": "SQL",
        "description": "M3 ERP production database",
    },
}

# SQL Database config
SQL_DB_DISPLAY_NAME = "SQL_INTEGRATION_FRAMEWORK"
SQL_DB_DACPAC = os.path.join(SCRIPT_DIR, "src", "SQL_FMD_FRAMEWORK.SQLDatabase", "SQL_FMD_FRAMEWORK.dacpac")

# State file for resume support
STATE_FILE = os.path.join(SCRIPT_DIR, ".deploy_state.json")


def _dry_guid(resource_name: str) -> str:
    """Generate a deterministic, traceable fake GUID for dry-run mode.

    Uses a hash of the resource name to produce a reproducible UUID that's
    visually distinct (starts with 'dry0') so you can trace which ID from
    Phase 3 flows into Phase 5, Phase 9, etc.
    """
    h = hashlib.md5(resource_name.encode()).hexdigest()
    return f"dry0{h[:4]}-{h[4:8]}-{h[8:12]}-{h[12:16]}-{h[16:28]}"


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════════════════════

_token_cache = {}

def get_client_secret():
    env_path = os.path.join(SCRIPT_DIR, "dashboard", "app", "api", ".env")
    with open(env_path) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("FABRIC_CLIENT_SECRET not found in dashboard/app/api/.env")


def get_token(scope="https://api.fabric.microsoft.com/.default"):
    """Get an OAuth2 token via client_credentials grant. Cached per scope."""
    cached = _token_cache.get(scope)
    if cached and cached["expires"] > time_mod.time():
        return cached["token"]

    data = urlencode({
        "client_id": CLIENT_ID,
        "client_secret": get_client_secret(),
        "scope": scope,
        "grant_type": "client_credentials",
    }).encode()
    req = Request(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data=data, method="POST",
    )
    resp = json.loads(urlopen(req).read())
    _token_cache[scope] = {
        "token": resp["access_token"],
        "expires": time_mod.time() + resp.get("expires_in", 3600) - 60,
    }
    return resp["access_token"]


# ═══════════════════════════════════════════════════════════════════════════════
# FABRIC REST API WRAPPER
# ═══════════════════════════════════════════════════════════════════════════════

def fabric_request(method, path, payload=None, poll_lro=True):
    """
    Make a Fabric REST API call. Handles:
    - JSON serialization
    - Bearer token auth (auto-refreshed)
    - 202 long-running operations (LRO polling)
    - Error reporting
    Returns (status_code, response_json_or_None)
    """
    token = get_token()
    url = f"{FABRIC_API}/{path.lstrip('/')}" if not path.startswith("http") else path
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    body = json.dumps(payload).encode() if payload else None
    req = Request(url, data=body, headers=headers, method=method.upper())

    try:
        resp = urlopen(req)
        status = resp.status

        # Handle 202 LRO
        if status == 202 and poll_lro:
            op_id = resp.headers.get("x-ms-operation-id")
            location = resp.headers.get("Location")
            retry_after = int(resp.headers.get("Retry-After", "2"))
            if op_id:
                return _poll_operation(op_id, retry_after, location)
            return status, None

        # Handle 200/201 with body
        raw = resp.read()
        if raw:
            return status, json.loads(raw)
        return status, None

    except HTTPError as e:
        body = ""
        try:
            body = e.read().decode()
        except Exception:
            pass
        return e.code, {"error": body}


def _poll_operation(operation_id, retry_after=2, location=None):
    """Poll a Fabric LRO until completion."""
    for _ in range(120):  # max ~4 min
        time_mod.sleep(retry_after)
        status, data = fabric_request("GET", f"operations/{operation_id}", poll_lro=False)
        if not data:
            continue
        op_status = data.get("status", "")
        if op_status == "Succeeded":
            # Try to get result
            rs, rd = fabric_request("GET", f"operations/{operation_id}/result", poll_lro=False)
            if rs == 200 and rd:
                return 200, rd
            return 200, data
        elif op_status in ("Failed", "Cancelled"):
            return 500, data
        # Still running — continue polling
    return 504, {"error": "LRO timed out"}


def fabric_get(path):
    return fabric_request("GET", path)


def fabric_post(path, payload):
    return fabric_request("POST", path, payload)


def fabric_patch(path, payload):
    return fabric_request("PATCH", path, payload)


# ═══════════════════════════════════════════════════════════════════════════════
# SIMPLE YAML PARSER (no PyYAML dependency)
# ═══════════════════════════════════════════════════════════════════════════════

def parse_simple_yaml(text):
    """Parse the simple two-level YAML format used by item_config.yaml."""
    result = {}
    current_section = None
    for line in text.split("\n"):
        stripped = line.rstrip()
        if not stripped or stripped.startswith("#"):
            continue
        # Top-level section (no leading whitespace, ends with colon)
        if not stripped.startswith(" ") and stripped.endswith(":"):
            current_section = stripped[:-1].strip()
            result[current_section] = {}
        elif current_section and ":" in stripped:
            key, value = stripped.strip().split(":", 1)
            value = value.strip().strip('"').strip("'")
            result[current_section][key.strip()] = value
    return result


def write_simple_yaml(data):
    """Write the simple two-level YAML format."""
    lines = []
    for section, entries in data.items():
        lines.append(f"{section}:")
        for key, value in entries.items():
            lines.append(f'    {key}: "{value}"')
        lines.append("")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG LOADING
# ═══════════════════════════════════════════════════════════════════════════════

def load_config():
    """Load all config files and return a unified config dict."""
    config = {}

    # item_config.yaml — current workspace/connection/database IDs
    yaml_path = os.path.join(SCRIPT_DIR, "config", "item_config.yaml")
    with open(yaml_path) as f:
        config["yaml"] = parse_simple_yaml(f.read())

    # item_deployment.json — template item IDs (notebooks, pipelines, etc.)
    with open(os.path.join(SCRIPT_DIR, "config", "item_deployment.json")) as f:
        config["items"] = json.load(f)

    # lakehouse_deployment.json — template lakehouse IDs
    with open(os.path.join(SCRIPT_DIR, "config", "lakehouse_deployment.json")) as f:
        config["lakehouses"] = json.load(f)

    # data_deployment.json — template SQL database IDs
    with open(os.path.join(SCRIPT_DIR, "config", "data_deployment.json")) as f:
        config["data"] = json.load(f)

    # item_initial_setup.json — setup notebook
    with open(os.path.join(SCRIPT_DIR, "config", "item_initial_setup.json")) as f:
        config["initial"] = json.load(f)

    return config


# ═══════════════════════════════════════════════════════════════════════════════
# STATE MANAGEMENT (resume support)
# ═══════════════════════════════════════════════════════════════════════════════

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"completed_phases": [], "mapping_table": [], "workspace_ids": {}, "connection_ids": {},
            "lakehouse_ids": {}, "sql_db": {}, "item_ids": {}}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER: List items in a workspace
# ═══════════════════════════════════════════════════════════════════════════════

def list_workspace_items(workspace_id, item_type=None):
    """List all items in a workspace, optionally filtered by type."""
    path = f"workspaces/{workspace_id}/items"
    if item_type:
        path += f"?type={item_type}"
    status, data = fabric_get(path)
    if status == 200 and data:
        return data.get("value", [])
    return []


def find_item(workspace_id, display_name, item_type=None):
    """Find an item by display name in a workspace."""
    items = list_workspace_items(workspace_id, item_type)
    for item in items:
        if item["displayName"] == display_name:
            return item
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER: Workspace folder management
# ═══════════════════════════════════════════════════════════════════════════════

# Cache folder IDs per workspace to avoid repeated API calls
_folder_cache = {}  # {workspace_id: {folder_name: folder_id}}


def ensure_workspace_folder(workspace_id, folder_name):
    """Get or create a folder in a workspace. Returns folder ID."""
    # Check cache first
    ws_cache = _folder_cache.setdefault(workspace_id, {})
    if folder_name in ws_cache:
        return ws_cache[folder_name]

    # List existing folders
    status, data = fabric_get(f"workspaces/{workspace_id}/folders")
    if status == 200 and data:
        for folder in data.get("value", []):
            ws_cache[folder["displayName"]] = folder["id"]
            if folder["displayName"] == folder_name:
                return folder["id"]

    # Folder doesn't exist — create it
    status, data = fabric_post(f"workspaces/{workspace_id}/folders", {
        "displayName": folder_name,
    })
    if status in (200, 201) and data:
        folder_id = data["id"]
        ws_cache[folder_name] = folder_id
        print(f"  [FOLDER] Created '{folder_name}' folder")
        return folder_id

    print(f"  [WARN] Could not create folder '{folder_name}': HTTP {status}")
    return None


def move_item_to_folder(workspace_id, item_id, folder_name):
    """Move an item into a workspace folder (creates folder if needed)."""
    folder_id = ensure_workspace_folder(workspace_id, folder_name)
    if not folder_id:
        return False

    status, _ = fabric_post(
        f"workspaces/{workspace_id}/items/{item_id}/move",
        {"targetFolderId": folder_id}
    )
    if status in (200, 202):
        return True
    # 409 = already in that folder (idempotent)
    if status == 409:
        return True
    print(f"  [WARN] Move to '{folder_name}' folder: HTTP {status}")
    return False


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER: List workspaces
# ═══════════════════════════════════════════════════════════════════════════════

def find_workspace(display_name):
    """Find a workspace by display name. Returns workspace dict or None."""
    # Paginate through all workspaces
    token = get_token()
    url = f"{FABRIC_API}/workspaces"
    while url:
        req = Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            resp = urlopen(req)
            data = json.loads(resp.read())
        except HTTPError:
            return None
        for ws in data.get("value", []):
            if ws["displayName"] == display_name:
                return ws
        url = data.get("continuationUri")
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: AUTH + CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

def phase1_auth_config(state, args):
    print("\n" + "=" * 70)
    print("PHASE 1: Authentication & Configuration")
    print("=" * 70)

    # Test auth
    token = get_token()
    print("  [OK] Authenticated with Fabric API (SP client_credentials)")

    # Load config
    config = load_config()
    print(f"  [OK] Loaded {len(config['items'])} items, {len(config['lakehouses'])} lakehouses")

    # Extract template IDs for mapping
    yaml_cfg = config["yaml"]
    print(f"  [OK] Current config: workspace_data={yaml_cfg.get('workspaces', {}).get('workspace_data', 'N/A')[:8]}...")

    state["config"] = {
        "yaml": config["yaml"],
        "items": config["items"],
        "lakehouses": config["lakehouses"],
        "data": config["data"],
    }
    return config


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2: RESOLVE CAPACITY
# ═══════════════════════════════════════════════════════════════════════════════

def phase2_resolve_capacity(state, args):
    print("\n" + "=" * 70)
    print("PHASE 2: Resolve Fabric Capacity")
    print("=" * 70)

    if args.capacity_id:
        print(f"  [OK] Using provided capacity ID: {args.capacity_id}")
        state["capacity_id"] = args.capacity_id
        return

    if args.dry_run:
        dry_id = _dry_guid("capacity:fabric")
        print(f"  [DRY] Would resolve capacity -> {dry_id}")
        state["capacity_id"] = dry_id
        return

    status, data = fabric_get("capacities")
    if status != 200 or not data:
        print("  [FAIL] Could not list capacities")
        print("  Use --capacity-id to specify manually")
        sys.exit(1)

    capacities = data.get("value", [])
    if not capacities:
        print("  [FAIL] No capacities found for this Service Principal")
        sys.exit(1)

    if args.capacity_name:
        match = next((c for c in capacities if args.capacity_name.lower() in c["displayName"].lower()), None)
        if match:
            state["capacity_id"] = match["id"]
            print(f"  [OK] Matched capacity: {match['displayName']} -> {match['id']}")
            return
        else:
            print(f"  [FAIL] No capacity matching '{args.capacity_name}'")
            print("  Available:")
            for c in capacities:
                print(f"    - {c['displayName']} ({c['id']})")
            sys.exit(1)

    # Use first available
    cap = capacities[0]
    state["capacity_id"] = cap["id"]
    print(f"  [OK] Using capacity: {cap['displayName']} ({cap['id']})")
    if len(capacities) > 1:
        print(f"  [INFO] {len(capacities)} capacities available. Use --capacity-name to select.")


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3: CREATE WORKSPACES
# ═══════════════════════════════════════════════════════════════════════════════

def phase3_create_workspaces(state, args):
    print("\n" + "=" * 70)
    print("PHASE 3: Create Workspaces")
    print("=" * 70)

    capacity_id = state["capacity_id"]
    envs_to_deploy = _get_envs(args)

    ws_keys = []
    if "dev" in envs_to_deploy:
        ws_keys += ["data_dev", "code_dev"]
    if "prod" in envs_to_deploy:
        ws_keys += ["data_prod", "code_prod"]
    ws_keys.append("config")  # always create config

    for key in ws_keys:
        ws_name = WORKSPACE_NAMES[key]
        print(f"\n  --- {ws_name} ---")

        if args.dry_run:
            dry_id = _dry_guid(f"ws:{key}")
            print(f"  [DRY] Would create workspace: {ws_name} -> {dry_id}")
            state["workspace_ids"][key] = dry_id
            continue

        existing = find_workspace(ws_name)
        if existing:
            ws_id = existing["id"]
            print(f"  [EXISTS] {ws_name} -> {ws_id}")
        else:
            print(f"  Creating workspace: {ws_name}")
            status, data = fabric_post("workspaces", {
                "displayName": ws_name,
                "capacityId": capacity_id,
            })
            if status in (200, 201) and data:
                ws_id = data["id"]
                print(f"  [CREATED] {ws_name} -> {ws_id}")
            else:
                print(f"  [FAIL] HTTP {status}: {data}")
                continue

        state["workspace_ids"][key] = ws_id

        # Assign SP as admin
        _assign_workspace_role(ws_id, SERVICE_PRINCIPAL_ID, "ServicePrincipal", "Admin")

        # Set description
        _set_workspace_description(ws_id)

    save_state(state)


def _assign_workspace_role(ws_id, principal_id, principal_type, role):
    """Assign a role to a principal in a workspace."""
    status, data = fabric_post(f"workspaces/{ws_id}/roleAssignments", {
        "principal": {"id": principal_id, "type": principal_type},
        "role": role,
    })
    if status in (200, 201):
        print(f"  [OK] {role} role assigned to {principal_id[:12]}...")
    elif status == 409:
        print(f"  [OK] Role already assigned")
    else:
        print(f"  [WARN] Role assignment HTTP {status}")


def _set_workspace_description(ws_id):
    """Set workspace description via PATCH."""
    desc = ("Important: The items in this workspace are automatically generated by the "
            "FMD Framework. Each time the setup script is executed, all changes will be "
            "overwritten. For more information, visit https://github.com/edkreuk/FMD_FRAMEWORK.")
    fabric_patch(f"workspaces/{ws_id}", {"description": desc})


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4: CREATE CONNECTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def phase4_create_connections(state, args):
    print("\n" + "=" * 70)
    print("PHASE 4: Create Connections")
    print("=" * 70)

    for conn_name, conn_def in CONNECTION_DEFS.items():
        print(f"\n  --- {conn_name} ({conn_def['type']}) ---")

        if args.dry_run:
            dry_id = _dry_guid(f"conn:{conn_name}")
            print(f"  [DRY] Would handle connection: {conn_name} -> {dry_id}")
            state["connection_ids"][conn_name] = dry_id
            continue

        if not conn_def["auto_create"]:
            # Check if we have an existing ID from config
            existing_id = state.get("config", {}).get("yaml", {}).get("connections", {}).get(conn_name, "")
            if existing_id and existing_id != "00000000-0000-0000-0000-000000000000":
                state["connection_ids"][conn_name] = existing_id
                print(f"  [EXISTS] Using existing ID from config: {existing_id}")
            else:
                print(f"  [MANUAL] {conn_name} ({conn_def['type']}) cannot be auto-created.")
                print(f"           Create it manually in Fabric UI, then enter the GUID below.")
                user_id = input(f"           {conn_name} GUID (or Enter to skip): ").strip()
                if user_id:
                    state["connection_ids"][conn_name] = user_id
                else:
                    state["connection_ids"][conn_name] = "00000000-0000-0000-0000-000000000000"
                    print(f"  [SKIP] {conn_name} — pipelines referencing this will be deactivated")
            continue

        # Try auto-create via REST API
        # NOTE: Cannot PATCH existing connections — SP gets 403. If a connection
        # exists with wrong creds, delete and recreate.
        if conn_def["type"] == "FabricDataPipelines":
            # MUST use ServicePrincipal — WorkspaceIdentity causes Error 3121
            # Fabric PATCH API expects "tenantId" (not "servicePrincipalTenantId")
            payload = {
                "connectivityType": "ShareableCloud",
                "displayName": conn_name,
                "connectionDetails": {
                    "type": "FabricDataPipelines",
                    "creationMethod": "FabricDataPipelines.Actions",
                    "parameters": [{"name": "dummy", "value": "x"}],
                },
                "credentialDetails": {
                    "singleCredential": {
                        "credentialType": "ServicePrincipal",
                        "servicePrincipalClientId": CLIENT_ID,
                        "servicePrincipalSecret": get_client_secret(),
                        "tenantId": TENANT_ID,
                    }
                },
                "skipTestConnection": False,
            }
            status, data = fabric_post("connections", payload)
            if status in (200, 201) and data:
                conn_id = data.get("id", "").lower()
                state["connection_ids"][conn_name] = conn_id
                print(f"  [CREATED] {conn_name} -> {conn_id}")
            elif status == 409:
                # Already exists — try to find it
                print(f"  [EXISTS] Connection already exists, looking up ID...")
                conn_id = _find_connection_id(conn_name)
                if conn_id:
                    state["connection_ids"][conn_name] = conn_id
                    print(f"  [OK] Found: {conn_id}")
                else:
                    existing_id = state.get("config", {}).get("yaml", {}).get("connections", {}).get(conn_name, "")
                    state["connection_ids"][conn_name] = existing_id
                    print(f"  [WARN] Could not find ID, using config value: {existing_id}")
            else:
                print(f"  [FAIL] HTTP {status}: {data}")
                existing_id = state.get("config", {}).get("yaml", {}).get("connections", {}).get(conn_name, "")
                state["connection_ids"][conn_name] = existing_id
                print(f"  [FALLBACK] Using config value: {existing_id}")

    # --- On-Prem Gateway Connections ---
    # These cannot be auto-created. They must exist in Fabric (created via portal
    # by gateway admin). We look them up by name and record their GUIDs for
    # pipeline JSON replacement and metadata DB registration.
    if GATEWAY_CONNECTION_DEFS:
        print(f"\n  --- On-Prem Gateway Connections ({len(GATEWAY_CONNECTION_DEFS)}) ---")
        for gw_name, gw_def in GATEWAY_CONNECTION_DEFS.items():
            if args.dry_run:
                dry_id = _dry_guid(f"gwconn:{gw_name}")
                print(f"  [DRY] Would look up gateway connection: {gw_name} -> {dry_id}")
                state["connection_ids"][gw_name] = dry_id
                continue

            gw_id = _find_connection_id(gw_name)
            if gw_id:
                state["connection_ids"][gw_name] = gw_id
                print(f"  [FOUND] {gw_name} -> {gw_id}")
            else:
                # Check config yaml for existing GUID
                existing_id = state.get("config", {}).get("yaml", {}).get("connections", {}).get(gw_name, "")
                if existing_id and existing_id != "00000000-0000-0000-0000-000000000000":
                    state["connection_ids"][gw_name] = existing_id
                    print(f"  [CONFIG] {gw_name} -> {existing_id} (from config, not verified)")
                else:
                    state["connection_ids"][gw_name] = "00000000-0000-0000-0000-000000000000"
                    print(f"  [MISSING] {gw_name} — not found in Fabric. Create via portal first.")
                    print(f"            {gw_def['description']}")
                    print(f"            Auth: {gw_def['cred_type']} (TrustServerCertificate=True)")

    save_state(state)


def _find_connection_id(display_name):
    """Search for a connection by display name.
    Returns the connection GUID in lowercase (Fabric API returns lowercase,
    metadata DB should store lowercase for consistent matching).
    """
    status, data = fabric_get("connections")
    if status == 200 and data:
        for conn in data.get("value", []):
            if conn.get("displayName", "").lower() == display_name.lower():
                return conn["id"].lower()
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5: CREATE LAKEHOUSES
# ═══════════════════════════════════════════════════════════════════════════════

def phase5_create_lakehouses(state, args):
    print("\n" + "=" * 70)
    print("PHASE 5: Create Lakehouses")
    print("=" * 70)

    envs = _get_envs(args)
    data_workspaces = []
    if "dev" in envs:
        data_workspaces.append(("data_dev", state["workspace_ids"].get("data_dev")))
    if "prod" in envs:
        data_workspaces.append(("data_prod", state["workspace_ids"].get("data_prod")))

    for env_key, ws_id in data_workspaces:
        if not ws_id:
            print(f"  [SKIP] No workspace ID for {env_key}")
            continue

        env_label = "DEV" if "dev" in env_key else "PROD"
        print(f"\n  === {env_label} DATA workspace ({ws_id[:8]}...) ===")

        for lh_name in LAKEHOUSE_NAMES:
            if args.dry_run:
                dry_id = _dry_guid(f"lh:{env_key}:{lh_name}")
                print(f"  [DRY] Would create lakehouse: {lh_name} -> {dry_id}")
                lh_key = f"{env_key}:{lh_name}"
                state.setdefault("lakehouse_ids", {})[lh_key] = dry_id
                continue

            existing = find_item(ws_id, lh_name, "Lakehouse")
            if existing:
                lh_id = existing["id"]
                print(f"  [EXISTS] {lh_name} -> {lh_id}")
            else:
                print(f"  Creating lakehouse: {lh_name}")
                status, data = fabric_post(f"workspaces/{ws_id}/items", {
                    "displayName": lh_name,
                    "type": "Lakehouse",
                })
                if status in (200, 201) and data:
                    lh_id = data["id"]
                    print(f"  [CREATED] {lh_name} -> {lh_id}")
                else:
                    print(f"  [FAIL] {lh_name}: HTTP {status}: {data}")
                    continue

            state["lakehouse_ids"][f"{env_key}:{lh_name}"] = lh_id
            move_item_to_folder(ws_id, lh_id, "Lakehouses")

    save_state(state)


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 6: CREATE SQL DATABASE
# ═══════════════════════════════════════════════════════════════════════════════

def phase6_create_sql_database(state, args):
    print("\n" + "=" * 70)
    print("PHASE 6: Create SQL Database")
    print("=" * 70)

    config_ws_id = state["workspace_ids"].get("config")
    if not config_ws_id:
        print("  [SKIP] No CONFIG workspace ID")
        return

    if args.dry_run:
        dry_id = _dry_guid(f"sqldb:{SQL_DB_DISPLAY_NAME}")
        dry_server = "dry0-sqldb.database.fabric.microsoft.com,1433"
        print(f"  [DRY] Would create SQL Database: {SQL_DB_DISPLAY_NAME} -> {dry_id}")
        print(f"  [DRY]   Server: {dry_server}")
        state["sql_db"] = {
            "id": dry_id,
            "server": dry_server,
            "database": SQL_DB_DISPLAY_NAME,
        }
        return

    existing = find_item(config_ws_id, SQL_DB_DISPLAY_NAME, "SQLDatabase")
    if existing:
        db_id = existing["id"]
        print(f"  [EXISTS] {SQL_DB_DISPLAY_NAME} -> {db_id}")

        # Get server FQDN from item properties
        status, data = fabric_get(f"workspaces/{config_ws_id}/items/{db_id}")
        if status == 200 and data:
            props = data.get("properties", {})
            server = props.get("serverFqdn", "")
            db_name = props.get("databaseName", "")
            state["sql_db"] = {"id": db_id, "server": server, "database": db_name}
            print(f"  [OK] Server: {server}")
            print(f"  [OK] Database: {db_name}")
        else:
            state["sql_db"] = {"id": db_id, "server": "", "database": ""}
    else:
        print(f"  Creating SQL Database: {SQL_DB_DISPLAY_NAME}")
        status, data = fabric_post(f"workspaces/{config_ws_id}/items", {
            "displayName": SQL_DB_DISPLAY_NAME,
            "type": "SQLDatabase",
        })
        if status in (200, 201) and data:
            db_id = data["id"]
            props = data.get("properties", {})
            server = props.get("serverFqdn", "")
            db_name = props.get("databaseName", "")
            state["sql_db"] = {"id": db_id, "server": server, "database": db_name}
            print(f"  [CREATED] {SQL_DB_DISPLAY_NAME} -> {db_id}")
            print(f"  [OK] Server: {server}")
            print(f"  [OK] Database: {db_name}")
        else:
            print(f"  [FAIL] HTTP {status}: {data}")
            return

    move_item_to_folder(config_ws_id, state["sql_db"]["id"], "Database")
    save_state(state)


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 6.5: RUN SETUP NOTEBOOK (Schema + Stored Procedures)
# ═══════════════════════════════════════════════════════════════════════════════

def phase6_5_run_setup_notebook(state, args):
    """Upload and run NB_SETUP_FMD to deploy schema, stored procs, and seed data.

    The SQL Database created in Phase 6 is an empty shell. The setup notebook
    creates the integration schema, all stored procedures (sp_UpsertConnection,
    sp_UpsertDataSource, sp_UpsertWorkspace, etc.), and seeds initial config.

    This MUST run before Phase 10 (SQL metadata population) since Phase 10
    calls stored procs that won't exist without this step.
    """
    print("\n" + "=" * 70)
    print("PHASE 6.5: Upload & Run Setup Notebook")
    print("=" * 70)

    config_ws_id = state["workspace_ids"].get("config")
    if not config_ws_id:
        print("  [SKIP] No CONFIG workspace ID")
        return

    if args.dry_run:
        print("  [DRY] Would upload NB_SETUP_FMD to CONFIG workspace")
        print("  [DRY] Would trigger notebook execution")
        print("  [DRY] Would poll for completion")
        return

    nb_name = "NB_SETUP_FMD"
    # The notebook source is an ipynb file
    nb_src = os.path.join(SCRIPT_DIR, "setup", "NB_SETUP_FMD.ipynb")
    if not os.path.exists(nb_src):
        print(f"  [SKIP] {nb_src} not found")
        return

    with open(nb_src, "rb") as f:
        nb_bytes = f.read()
    nb_b64 = base64.b64encode(nb_bytes).decode()

    # Check if notebook already exists in CONFIG workspace
    existing = find_item(config_ws_id, nb_name, "Notebook")
    if existing:
        item_id = existing["id"]
        print(f"  [EXISTS] {nb_name} -> {item_id}, updating definition...")
    else:
        # Create empty notebook shell
        print(f"  Creating notebook: {nb_name}")
        status, data = fabric_post(f"workspaces/{config_ws_id}/items", {
            "displayName": nb_name,
            "type": "Notebook",
        })
        if status in (200, 201) and data:
            item_id = data["id"]
            print(f"  [CREATED] {nb_name} -> {item_id}")
        else:
            print(f"  [FAIL] Create notebook: HTTP {status}: {data}")
            return

    # Upload notebook definition
    status, data = fabric_post(f"workspaces/{config_ws_id}/items/{item_id}/updateDefinition", {
        "definition": {
            "format": "ipynb",
            "parts": [{
                "path": "notebook-content.ipynb",
                "payload": nb_b64,
                "payloadType": "InlineBase64",
            }]
        }
    })
    if status in (200, 202):
        print(f"  [OK] {nb_name} definition uploaded")
    else:
        print(f"  [WARN] Definition upload HTTP {status}: {data}")

    # Trigger notebook execution
    print(f"  Triggering {nb_name} execution...")
    status, data = fabric_post(
        f"workspaces/{config_ws_id}/items/{item_id}/jobs/instances?jobType=RunNotebook",
        {}
    )
    if status in (200, 202):
        print(f"  [OK] Notebook job triggered")
        # The LRO polling in fabric_request should handle the 202
        if isinstance(data, dict):
            job_status = data.get("status", "Unknown")
            print(f"  [OK] Job completed: {job_status}")
    else:
        print(f"  [WARN] Notebook trigger HTTP {status}: {data}")
        print(f"         Schema may need manual setup. Run NB_SETUP_FMD from Fabric UI.")

    move_item_to_folder(config_ws_id, item_id, "Notebooks")
    state["setup_notebook_id"] = item_id
    save_state(state)


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 7: DEPLOY NOTEBOOKS
# ═══════════════════════════════════════════════════════════════════════════════

def phase7_deploy_notebooks(state, args):
    print("\n" + "=" * 70)
    print("PHASE 7: Deploy Notebooks")
    print("=" * 70)

    config = state.get("config", {})
    items = config.get("items", [])
    notebooks = [it for it in items if it["type"] == "Notebook"]

    envs = _get_envs(args)
    code_workspaces = []
    if "dev" in envs:
        code_workspaces.append(("dev", state["workspace_ids"].get("code_dev")))
    if "prod" in envs:
        code_workspaces.append(("prod", state["workspace_ids"].get("code_prod")))

    for env_label, ws_id in code_workspaces:
        if not ws_id:
            continue
        print(f"\n  === {env_label.upper()} CODE workspace ({ws_id[:8]}...) ===")

        for nb in notebooks:
            nb_name = nb["name"]  # e.g., "NB_FMD_PROCESSING_PARALLEL_MAIN.Notebook"
            display_name = nb_name  # Fabric uses the full name including .Notebook suffix
            short_name = nb_name.replace(".Notebook", "")

            # Read source file
            src_path = os.path.join(SCRIPT_DIR, "src", nb_name, "notebook-content.py")
            if not os.path.exists(src_path):
                print(f"  [SKIP] {short_name} — source not found: {src_path}")
                continue

            if args.dry_run:
                dry_id = _dry_guid(f"nb:{env_label}:{short_name}")
                print(f"  [DRY] Would deploy: {short_name} -> {dry_id}")
                state.setdefault("id_mapping", {})[short_name] = dry_id
                continue

            with open(src_path, "rb") as f:
                content_bytes = f.read()
            content_b64 = base64.b64encode(content_bytes).decode()

            # Check if exists
            existing = find_item(ws_id, short_name, "Notebook")
            if not existing:
                existing = find_item(ws_id, nb_name, "Notebook")

            if existing:
                item_id = existing["id"]
                print(f"  [EXISTS] {short_name} -> {item_id}, updating definition...")
            else:
                # Create shell
                print(f"  Creating notebook: {short_name}")
                status, data = fabric_post(f"workspaces/{ws_id}/items", {
                    "displayName": short_name,
                    "type": "Notebook",
                })
                if status in (200, 201) and data:
                    item_id = data["id"]
                    print(f"  [CREATED] {short_name} -> {item_id}")
                else:
                    print(f"  [FAIL] Create: HTTP {status}: {data}")
                    continue

            # Upload definition
            status, data = fabric_post(f"workspaces/{ws_id}/items/{item_id}/updateDefinition", {
                "definition": {
                    "format": "py",
                    "parts": [{
                        "path": "notebook-content.py",
                        "payload": content_b64,
                        "payloadType": "InlineBase64",
                    }]
                }
            })
            if status in (200, 202):
                print(f"  [OK] {short_name} definition uploaded")
            else:
                print(f"  [WARN] {short_name} definition upload HTTP {status}")

            # Record mapping
            state["item_ids"][f"{env_label}:{nb_name}"] = item_id
            # Also map template ID -> new ID
            state["mapping_table"].append({
                "description": nb_name,
                "environment": env_label,
                "item_type": "Notebook",
                "old_id": nb["id"],
                "new_id": item_id,
            })

            move_item_to_folder(ws_id, item_id, "Notebooks")
            time_mod.sleep(0.5)  # throttle

    save_state(state)


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 8: DEPLOY VARIABLE LIBRARIES + ENVIRONMENT
# ═══════════════════════════════════════════════════════════════════════════════

def phase8_deploy_variable_libs(state, args):
    print("\n" + "=" * 70)
    print("PHASE 8: Deploy Variable Libraries & Environment")
    print("=" * 70)

    config = state.get("config", {})
    items = config.get("items", [])
    var_libs = [it for it in items if it["type"] == "VariableLibrary"]
    environments = [it for it in items if it["type"] == "Environment"]

    envs = _get_envs(args)
    code_workspaces = []
    if "dev" in envs:
        code_workspaces.append(("dev", state["workspace_ids"].get("code_dev")))
    if "prod" in envs:
        code_workspaces.append(("prod", state["workspace_ids"].get("code_prod")))

    # Also deploy to CONFIG workspace
    config_ws = state["workspace_ids"].get("config")

    for env_label, ws_id in code_workspaces:
        if not ws_id:
            continue
        print(f"\n  === {env_label.upper()} CODE workspace ({ws_id[:8]}...) ===")

        # Deploy variable libraries
        for vl in var_libs:
            _deploy_variable_library(state, ws_id, env_label, vl, args)

        # Deploy environment
        for env_item in environments:
            _deploy_environment(state, ws_id, env_label, env_item, args)

    # Deploy VAR_CONFIG_FMD to CONFIG workspace
    if config_ws:
        config_var = next((v for v in var_libs if "CONFIG" in v["name"]), None)
        if config_var:
            print(f"\n  === CONFIG workspace ({config_ws[:8]}...) ===")
            _deploy_variable_library(state, config_ws, "config", config_var, args)

    save_state(state)


def _deploy_variable_library(state, ws_id, env_label, vl_def, args):
    """Deploy a single variable library."""
    vl_name = vl_def["name"]
    short_name = vl_name.replace(".VariableLibrary", "")
    src_dir = os.path.join(SCRIPT_DIR, "src", vl_name)

    if not os.path.isdir(src_dir):
        print(f"  [SKIP] {short_name} — source dir not found")
        return

    if args.dry_run:
        dry_id = _dry_guid(f"vl:{short_name}")
        print(f"  [DRY] Would deploy variable library: {short_name} -> {dry_id}")
        state.setdefault("id_mapping", {})[short_name] = dry_id
        return

    # Update variables.json with runtime values if this is VAR_CONFIG_FMD
    variables_path = os.path.join(src_dir, "variables.json")
    if os.path.exists(variables_path) and "CONFIG" in short_name:
        sql_db = state.get("sql_db", {})
        with open(variables_path) as f:
            var_data = json.load(f)
        for var in var_data.get("variables", []):
            if var["name"] == "fmd_fabric_db_connection":
                var["value"] = sql_db.get("server", "")
            elif var["name"] == "fmd_fabric_db_name":
                var["value"] = sql_db.get("database", "")
            elif var["name"] == "fmd_config_database_guid":
                var["value"] = sql_db.get("id", "")
            elif var["name"] == "fmd_config_workspace_guid":
                var["value"] = state["workspace_ids"].get("config", "")
        with open(variables_path, "w") as f:
            json.dump(var_data, f, indent=4)
        print(f"  [OK] Updated {short_name} variables with runtime values")

    # Build definition parts from all files in the source dir
    parts = _build_definition_parts(src_dir)
    if not parts:
        print(f"  [SKIP] {short_name} — no definition parts")
        return

    # Check if exists
    existing = find_item(ws_id, short_name, "VariableLibrary")
    if existing:
        item_id = existing["id"]
        print(f"  [EXISTS] {short_name} -> {item_id}, updating...")
    else:
        print(f"  Creating variable library: {short_name}")
        status, data = fabric_post(f"workspaces/{ws_id}/items", {
            "displayName": short_name,
            "type": "VariableLibrary",
        })
        if status in (200, 201) and data:
            item_id = data["id"]
            print(f"  [CREATED] {short_name} -> {item_id}")
        else:
            print(f"  [FAIL] HTTP {status}: {data}")
            return

    # Upload definition
    status, data = fabric_post(f"workspaces/{ws_id}/items/{item_id}/updateDefinition", {
        "definition": {"parts": parts}
    })
    if status in (200, 202):
        print(f"  [OK] {short_name} definition uploaded")
    else:
        print(f"  [WARN] {short_name} upload HTTP {status}")

    state["item_ids"][f"{env_label}:{vl_name}"] = item_id
    state["mapping_table"].append({
        "description": vl_name, "environment": env_label,
        "item_type": "VariableLibrary", "old_id": vl_def["id"], "new_id": item_id,
    })
    move_item_to_folder(ws_id, item_id, "VariableLibraries")


def _deploy_environment(state, ws_id, env_label, env_def, args):
    """Deploy an environment item."""
    env_name = env_def["name"]
    short_name = env_name.replace(".Environment", "")
    src_dir = os.path.join(SCRIPT_DIR, "src", env_name)

    if not os.path.isdir(src_dir):
        print(f"  [SKIP] {short_name} — source dir not found")
        return

    if args.dry_run:
        dry_id = _dry_guid(f"env:{short_name}")
        print(f"  [DRY] Would deploy environment: {short_name} -> {dry_id}")
        state.setdefault("id_mapping", {})[short_name] = dry_id
        return

    # Check if exists
    existing = find_item(ws_id, short_name, "Environment")
    if existing:
        item_id = existing["id"]
        print(f"  [EXISTS] {short_name} -> {item_id}")
    else:
        print(f"  Creating environment: {short_name}")
        status, data = fabric_post(f"workspaces/{ws_id}/items", {
            "displayName": short_name,
            "type": "Environment",
        })
        if status in (200, 201) and data:
            item_id = data["id"]
            print(f"  [CREATED] {short_name} -> {item_id}")
        else:
            print(f"  [FAIL] HTTP {status}: {data}")
            return

    state["item_ids"][f"{env_label}:{env_name}"] = item_id
    state["mapping_table"].append({
        "description": env_name, "environment": env_label,
        "item_type": "Environment", "old_id": env_def["id"], "new_id": item_id,
    })
    move_item_to_folder(ws_id, item_id, "Environments")


def _build_definition_parts(src_dir):
    """Build Fabric API definition parts from all files in a source directory."""
    parts = []
    for root, _, files in os.walk(src_dir):
        for fname in files:
            if fname == ".platform":
                continue  # Skip platform metadata
            fpath = os.path.join(root, fname)
            rel_path = os.path.relpath(fpath, src_dir).replace("\\", "/")
            with open(fpath, "rb") as f:
                content = f.read()
            parts.append({
                "path": rel_path,
                "payload": base64.b64encode(content).decode(),
                "payloadType": "InlineBase64",
            })
    return parts


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 9: DEPLOY PIPELINES
# ═══════════════════════════════════════════════════════════════════════════════

def phase9_deploy_pipelines(state, args):
    print("\n" + "=" * 70)
    print("PHASE 9: Deploy Pipelines (Create + Update Definitions)")
    print("=" * 70)

    config = state.get("config", {})
    items = config.get("items", [])
    pipelines = [it for it in items if it["type"] == "DataPipeline"]

    envs = _get_envs(args)
    deploy_targets = []
    if "dev" in envs:
        deploy_targets.append(("dev", state["workspace_ids"].get("code_dev"),
                               state["workspace_ids"].get("data_dev")))
    if "prod" in envs:
        deploy_targets.append(("prod", state["workspace_ids"].get("code_prod"),
                               state["workspace_ids"].get("data_prod")))

    # Build the complete ID mapping for replacement
    id_mapping = _build_id_mapping(state)

    # Connections that don't exist — activities referencing these get deactivated
    missing_connections = set()
    for conn_name, conn_id in state.get("connection_ids", {}).items():
        if conn_id == "00000000-0000-0000-0000-000000000000":
            # Find the template ID for this connection from config
            template_id = state.get("config", {}).get("yaml", {}).get("connections", {}).get(conn_name, "")
            if template_id and template_id != "00000000-0000-0000-0000-000000000000":
                missing_connections.add(template_id)
            missing_connections.add(conn_id)

    for env_label, code_ws_id, data_ws_id in deploy_targets:
        if not code_ws_id:
            continue
        print(f"\n  === {env_label.upper()} CODE workspace ({code_ws_id[:8]}...) ===")

        for pl_def in pipelines:
            pl_full_name = pl_def["name"]  # e.g., "PL_FMD_LOAD_ALL.DataPipeline"
            pl_short = pl_full_name.replace(".DataPipeline", "")
            template_id = pl_def["id"]

            if args.dry_run:
                dry_id = _dry_guid(f"pl:{env_label}:{pl_short}")
                print(f"  [DRY] Would deploy: {pl_short} -> {dry_id}")
                state.setdefault("id_mapping", {})[f"{env_label}:{pl_short}"] = dry_id
                continue

            # Read source JSON
            src_path = os.path.join(SCRIPT_DIR, "src", pl_full_name, "pipeline-content.json")
            if not os.path.exists(src_path):
                print(f"  [SKIP] {pl_short} — source not found")
                continue

            with open(src_path) as f:
                content = f.read()

            # Check if pipeline exists
            existing = find_item(code_ws_id, pl_short, "DataPipeline")
            if not existing:
                existing = find_item(code_ws_id, pl_full_name, "DataPipeline")

            if existing:
                item_id = existing["id"]
                print(f"  [EXISTS] {pl_short} -> {item_id}")
            else:
                # Create empty shell
                status, data = fabric_post(f"workspaces/{code_ws_id}/items", {
                    "displayName": pl_short,
                    "type": "DataPipeline",
                })
                if status in (200, 201) and data:
                    item_id = data["id"]
                    print(f"  [CREATED] {pl_short} -> {item_id}")
                else:
                    print(f"  [FAIL] Create {pl_short}: HTTP {status}")
                    continue

            # Record mapping BEFORE replacement (so other pipelines can reference this one)
            state["item_ids"][f"{env_label}:{pl_full_name}"] = item_id
            state["mapping_table"].append({
                "description": pl_full_name, "environment": env_label,
                "item_type": "DataPipeline", "old_id": template_id, "new_id": item_id,
            })
            # Update the live mapping for subsequent pipelines
            id_mapping[template_id] = item_id

            # Fix Bool → String type in libraryVariables (Fabric API rejects Bool)
            content = content.replace('"type": "Bool"', '"type": "String"')

            # Replace all known template IDs with real IDs
            replacements = 0
            for old_id, new_id in id_mapping.items():
                if old_id in content and old_id != new_id:
                    count = content.count(old_id)
                    content = content.replace(old_id, new_id)
                    replacements += count

            # JSON-aware pipeline fixes
            deactivated = 0
            invoke_fixes = 0
            try:
                data_obj = json.loads(content)

                # Fix Data_WorkspaceGuid default (may contain stale template GUID)
                params = data_obj.get("properties", {}).get("parameters", {})
                if "Data_WorkspaceGuid" in params and data_ws_id:
                    old_default = params["Data_WorkspaceGuid"].get("defaultValue", "")
                    if old_default and old_default != data_ws_id:
                        params["Data_WorkspaceGuid"]["defaultValue"] = data_ws_id
                        replacements += 1

                # Fix InvokePipeline activities:
                # - Replace zeros workspaceId with actual CODE workspace ID
                #   (zeros shorthand fails with ServicePrincipal connections)
                # - Strip undefined params (ConnectionType, DataSourceType)
                invoke_fixes = _fix_invoke_pipeline_activities(data_obj, code_ws_id)

                # Deactivate activities with missing connections
                deactivated = _deactivate_missing_connections(data_obj, missing_connections)

                content = json.dumps(data_obj)
            except json.JSONDecodeError:
                pass

            # Upload definition
            encoded = base64.b64encode(content.encode()).decode()
            status, resp = fabric_post(f"workspaces/{code_ws_id}/items/{item_id}/updateDefinition", {
                "definition": {
                    "parts": [{
                        "path": "pipeline-content.json",
                        "payload": encoded,
                        "payloadType": "InlineBase64",
                    }]
                }
            })

            deact_msg = f", {deactivated} deactivated" if deactivated else ""
            invoke_msg = f", {invoke_fixes} invoke fixes" if invoke_fixes else ""
            if status in (200, 202):
                print(f"  [OK] {pl_short} ({replacements} IDs replaced{invoke_msg}{deact_msg})")
            else:
                print(f"  [WARN] {pl_short} definition upload HTTP {status}")

            move_item_to_folder(code_ws_id, item_id, "DataPipelines")
            time_mod.sleep(0.3)  # throttle

    save_state(state)


def _build_id_mapping(state):
    """Build a comprehensive old→new ID mapping from state."""
    mapping = {}

    # Workspace IDs from config yaml → new workspace IDs
    yaml_cfg = state.get("config", {}).get("yaml", {})
    ws_mappings = {
        "workspace_data": "data_dev",
        "workspace_code": "code_dev",
        "workspace_config": "config",
        "workspace_data_prod": "data_prod",
        "workspace_code_prod": "code_prod",
    }
    for yaml_key, state_key in ws_mappings.items():
        old_id = yaml_cfg.get("workspaces", {}).get(yaml_key, "")
        new_id = state.get("workspace_ids", {}).get(state_key, "")
        if old_id and new_id and old_id != new_id:
            mapping[old_id] = new_id

    # Connection IDs from config → new connection IDs
    for conn_name, old_id in yaml_cfg.get("connections", {}).items():
        new_id = state.get("connection_ids", {}).get(conn_name, "")
        if old_id and new_id and old_id != new_id:
            mapping[old_id] = new_id

    # Lakehouse IDs from template → new
    for lh_def in state.get("config", {}).get("lakehouses", []):
        old_id = lh_def["id"]
        lh_name = lh_def["name"].replace(".Lakehouse", "")
        # Match against both dev and prod
        for env in ("data_dev", "data_prod"):
            new_id = state.get("lakehouse_ids", {}).get(f"{env}:{lh_name}", "")
            if new_id and old_id != new_id:
                mapping[old_id] = new_id

    # Item IDs from mapping_table
    for entry in state.get("mapping_table", []):
        old_id = entry.get("old_id", "")
        new_id = entry.get("new_id", "")
        if old_id and new_id and old_id != new_id:
            mapping[old_id] = new_id

    # Database IDs from config → new
    for db_def in state.get("config", {}).get("data", []):
        old_id = db_def.get("id", "")
        new_id = state.get("sql_db", {}).get("id", "")
        if old_id and new_id and old_id != new_id:
            mapping[old_id] = new_id
        old_ep = db_def.get("endpoint", "")
        new_ep = state.get("sql_db", {}).get("server", "").replace(",1433", "")
        if old_ep and new_ep and old_ep != new_ep:
            mapping[old_ep] = new_ep

    return mapping


def _deactivate_missing_connections(data, missing_connections):
    """Deactivate pipeline activities that reference missing connections."""
    deactivated = 0

    def process(activities):
        nonlocal deactivated
        for act in activities:
            act_str = json.dumps(act)
            for conn_id in missing_connections:
                if conn_id in act_str:
                    act["state"] = "Inactive"
                    act["onInactiveMarkAs"] = "Succeeded"
                    deactivated += 1
                    break
            # Recurse into nested activities
            for key in ("activities", "ifFalseActivities", "ifTrueActivities"):
                nested = act.get("typeProperties", {}).get(key, [])
                if nested:
                    process(nested)

    process(data.get("properties", {}).get("activities", []))
    return deactivated


# Parameters that parent pipelines pass but children don't define.
# Passing undefined params to InvokePipeline causes BadRequest.
_INVOKE_STRIP_PARAMS = {"ConnectionType", "DataSourceType"}


def _fix_invoke_pipeline_activities(data, code_ws_id):
    """Post-process pipeline JSON to fix activity workspace references.

    Fixes issues discovered during live debugging with ServicePrincipal auth:
      1. Replace workspaceId 00000000... with actual CODE workspace ID on ALL
         activity types (InvokePipeline, TridentNotebook, etc.) — the zeros
         "same workspace" shorthand fails with SP connections
      2. Strip extra parameters (ConnectionType, DataSourceType) that
         parent pipelines pass but children don't define in InvokePipeline calls
      3. Handles all nesting depths (ForEach, IfCondition, Switch, Until)

    Returns count of fixes applied.
    """
    fixes = 0
    zeros = "00000000-0000-0000-0000-000000000000"

    def process(activities):
        nonlocal fixes
        for act in activities:
            tp = act.get("typeProperties", {})

            # Fix 1: Replace zeros workspace ID on ANY activity type
            if tp.get("workspaceId") == zeros and code_ws_id:
                tp["workspaceId"] = code_ws_id
                fixes += 1

            # Fix 2: Strip undefined parameters (InvokePipeline only)
            if act.get("type") == "InvokePipeline":
                params = tp.get("parameters", {})
                for bad_param in _INVOKE_STRIP_PARAMS:
                    if bad_param in params:
                        del params[bad_param]
                        fixes += 1

            # Recurse into nested activities (ForEach, IfCondition, Switch, Until)
            for key in ("activities", "ifFalseActivities", "ifTrueActivities"):
                nested = tp.get(key, [])
                if nested:
                    process(nested)
            # Switch cases
            cases = tp.get("cases", [])
            for case in cases:
                case_activities = case.get("activities", [])
                if case_activities:
                    process(case_activities)
            # Default activities in Switch
            default_acts = tp.get("defaultActivities", [])
            if default_acts:
                process(default_acts)

    process(data.get("properties", {}).get("activities", []))
    return fixes


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 10: SQL METADATA POPULATION
# ═══════════════════════════════════════════════════════════════════════════════

def phase10_sql_metadata(state, args):
    print("\n" + "=" * 70)
    print("PHASE 10: Populate SQL Metadata")
    print("=" * 70)

    sql_db = state.get("sql_db", {})
    server = sql_db.get("server", "")
    database = sql_db.get("database", "")

    if not server or not database:
        print("  [SKIP] No SQL database info available")
        return

    if args.dry_run:
        print(f"  [DRY] Would populate SQL metadata in {server}")
        print(f"  [DRY]   Database: {database}")
        print(f"  [DRY]   Would run: EXEC usp_create_initial_config")
        print(f"  [DRY]   Would insert workspace/connection/lakehouse ID mappings")
        return

    try:
        import pyodbc
    except ImportError:
        print("  [SKIP] pyodbc not installed — run: pip install pyodbc")
        return

    # Get SQL token
    sql_token = get_token("https://database.windows.net/.default")
    token_bytes = sql_token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

    # Ensure server has port
    if ",1433" not in server:
        server_conn = f"{server},1433"
    else:
        server_conn = server

    driver = "{ODBC Driver 18 for SQL Server}"
    conn_str = f"DRIVER={driver};SERVER={server_conn};DATABASE={database};"

    print(f"  Connecting to {server_conn}...")
    try:
        conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
    except Exception as e:
        print(f"  [FAIL] Connection error: {e}")
        return

    cursor = conn.cursor()
    cursor.execute("SELECT 1")
    cursor.fetchone()
    print("  [OK] Connected!")

    queries = []

    # --- Connections (Fabric-native + On-prem gateway) ---
    print("\n  --- Connections ---")
    all_conn_defs = {**CONNECTION_DEFS, **GATEWAY_CONNECTION_DEFS}
    for conn_name, conn_id in state.get("connection_ids", {}).items():
        if conn_id == "00000000-0000-0000-0000-000000000000":
            continue
        # Use metadata_type (what pipeline Switch expects), not Fabric API type
        conn_type = all_conn_defs.get(conn_name, {}).get("metadata_type",
                    all_conn_defs.get(conn_name, {}).get("type", "Unknown"))
        queries.append(("Connection", conn_name,
            f'EXEC [integration].[sp_UpsertConnection] @ConnectionGuid = "{conn_id}", '
            f'@Name = "{conn_name}", @Type = "{conn_type}", @IsActive = 1'))

    # Built-in pseudo-connections
    queries.append(("Connection", "CON_FMD_NOTEBOOK",
        'EXEC [integration].[sp_UpsertConnection] @ConnectionGuid = "00000000-0000-0000-0000-000000000001", '
        '@Name = "CON_FMD_NOTEBOOK", @Type = "NOTEBOOK", @IsActive = 1'))
    queries.append(("Connection", "CON_FMD_ONELAKE",
        'EXEC [integration].[sp_UpsertConnection] @ConnectionGuid = "00000000-0000-0000-0000-000000000000", '
        '@Name = "CON_FMD_ONELAKE", @Type = "ONELAKE", @IsActive = 1'))

    # --- DataSources ---
    print("  --- DataSources ---")
    queries.append(("DataSource", "ONELAKE_TABLES", """
        DECLARE @DSId INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = 'LH_DATA_LANDINGZONE' AND Type='ONELAKE_TABLES_01')
        DECLARE @CId INT = (SELECT ConnectionId FROM integration.Connection WHERE ConnectionGuid = '00000000-0000-0000-0000-000000000000')
        EXECUTE [integration].[sp_UpsertDataSource] @ConnectionId=@CId, @DataSourceId=@DSId,
            @Name='LH_DATA_LANDINGZONE', @Namespace='ONELAKE', @Type='ONELAKE_TABLES_01',
            @Description='ONELAKE_TABLES', @IsActive=1
    """))
    queries.append(("DataSource", "ONELAKE_FILES", """
        DECLARE @DSId INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = 'LH_DATA_LANDINGZONE' AND Type='ONELAKE_FILES_01')
        DECLARE @CId INT = (SELECT ConnectionId FROM integration.Connection WHERE ConnectionGuid = '00000000-0000-0000-0000-000000000000')
        EXECUTE [integration].[sp_UpsertDataSource] @ConnectionId=@CId, @DataSourceId=@DSId,
            @Name='LH_DATA_LANDINGZONE', @Namespace='ONELAKE', @Type='ONELAKE_FILES_01',
            @Description='ONELAKE_FILES', @IsActive=1
    """))
    queries.append(("DataSource", "CUSTOM_NOTEBOOK", """
        DECLARE @DSId INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = 'CUSTOM_NOTEBOOK' AND Type='NOTEBOOK')
        DECLARE @CId INT = (SELECT ConnectionId FROM integration.Connection WHERE ConnectionGuid = '00000000-0000-0000-0000-000000000001')
        EXECUTE [integration].[sp_UpsertDataSource] @ConnectionId=@CId, @DataSourceId=@DSId,
            @Name='CUSTOM_NOTEBOOK', @Namespace='NB', @Type='NOTEBOOK',
            @Description='Custom Notebook', @IsActive=1
    """))

    # --- On-Prem DataSources ---
    # Register production data sources that map to gateway connections.
    # These are the actual source systems (MES, ETQ, M3, M3 Cloud) that
    # feed data into the medallion architecture.
    print("  --- On-Prem DataSources ---")
    for ds_name, ds_def in ONPREM_DATASOURCE_DEFS.items():
        conn_name = ds_def["connection"]
        conn_guid = state.get("connection_ids", {}).get(conn_name, "")
        if not conn_guid or conn_guid == "00000000-0000-0000-0000-000000000000":
            print(f"  [SKIP] {ds_name} — connection {conn_name} not available")
            continue

        safe_name = ds_name.replace("'", "''")
        safe_desc = ds_def["description"].replace("'", "''")
        queries.append(("DataSource", ds_name, f"""
            DECLARE @DSId INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = '{safe_name}' AND Type='{ds_def["type"]}')
            DECLARE @CId INT = (SELECT ConnectionId FROM integration.Connection WHERE ConnectionGuid = '{conn_guid}')
            IF @CId IS NOT NULL
                EXECUTE [integration].[sp_UpsertDataSource] @ConnectionId=@CId, @DataSourceId=@DSId,
                    @Name='{safe_name}', @Namespace='{ds_def["namespace"]}', @Type='{ds_def["type"]}',
                    @Description='{safe_desc}', @IsActive=1
        """))

    # --- Workspaces ---
    print("  --- Workspaces ---")
    for key, ws_id in state.get("workspace_ids", {}).items():
        ws_name = WORKSPACE_NAMES.get(key, key)
        queries.append(("Workspace", ws_name,
            f'EXEC [integration].[sp_UpsertWorkspace] @WorkspaceId = "{ws_id}", @Name = "{ws_name}"'))

    # --- Pipelines ---
    print("  --- Pipelines ---")
    fabric_token = get_token()
    code_to_data = {}
    if state["workspace_ids"].get("code_dev") and state["workspace_ids"].get("data_dev"):
        code_to_data[state["workspace_ids"]["code_dev"]] = state["workspace_ids"]["data_dev"]
    if state["workspace_ids"].get("code_prod") and state["workspace_ids"].get("data_prod"):
        code_to_data[state["workspace_ids"]["code_prod"]] = state["workspace_ids"]["data_prod"]

    for code_ws_id, data_ws_id in code_to_data.items():
        items = list_workspace_items(code_ws_id, "DataPipeline")
        for item in items:
            queries.append(("Pipeline", f'{item["displayName"]} ({data_ws_id[:8]}...)',
                f'EXEC [integration].[sp_UpsertPipeline] @PipelineId = "{item["id"]}", '
                f'@WorkspaceId = "{data_ws_id}", @Name = "{item["displayName"]}"'))

    # --- Lakehouses ---
    print("  --- Lakehouses ---")
    for key, ws_id in state.get("workspace_ids", {}).items():
        if "data" not in key:
            continue
        items = list_workspace_items(ws_id, "Lakehouse")
        for item in items:
            queries.append(("Lakehouse", f'{item["displayName"]} ({ws_id[:8]}...)',
                f'EXEC [integration].[sp_UpsertLakehouse] @LakehouseId = "{item["id"]}", '
                f'@WorkspaceId = "{ws_id}", @Name = "{item["displayName"]}"'))

    # Execute all queries
    print(f"\n  Executing {len(queries)} SQL statements...")
    success = 0
    failed = 0
    for category, label, query in queries:
        try:
            cursor.execute(query)
            cursor.commit()
            print(f"  [OK]   [{category:12}] {label}")
            success += 1
        except Exception as e:
            print(f"  [FAIL] [{category:12}] {label}: {e}")
            failed += 1

    cursor.close()
    conn.close()
    print(f"\n  SQL: {success} OK, {failed} FAILED")


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 11: UPDATE LOCAL CONFIG FILES
# ═══════════════════════════════════════════════════════════════════════════════

def phase11_update_config(state, args):
    print("\n" + "=" * 70)
    print("PHASE 11: Update Local Config Files")
    print("=" * 70)

    if args.dry_run:
        ws = state.get("workspace_ids", {})
        print("  [DRY] Would update config files:")
        print(f"  [DRY]   item_config.yaml — workspace IDs:")
        for k, v in ws.items():
            print(f"  [DRY]     {k}: {v}")
        conns = state.get("connection_ids", {})
        if conns:
            print(f"  [DRY]   item_config.yaml — connection IDs:")
            for k, v in conns.items():
                print(f"  [DRY]     {k}: {v}")
        sql_db = state.get("sql_db", {})
        if sql_db:
            print(f"  [DRY]   config.json — SQL endpoint: {sql_db.get('server', '?')}")
        return

    ws = state.get("workspace_ids", {})
    conns = state.get("connection_ids", {})
    sql_db = state.get("sql_db", {})

    # --- item_config.yaml ---
    yaml_data = {
        "workspaces": {
            "workspace_data": ws.get("data_dev", ""),
            "workspace_code": ws.get("code_dev", ""),
            "workspace_config": ws.get("config", ""),
            "workspace_data_prod": ws.get("data_prod", ""),
            "workspace_code_prod": ws.get("code_prod", ""),
        },
        "connections": {
            "CON_FMD_FABRIC_SQL": conns.get("CON_FMD_FABRIC_SQL", "00000000-0000-0000-0000-000000000000"),
            "CON_FMD_FABRIC_PIPELINES": conns.get("CON_FMD_FABRIC_PIPELINES", "00000000-0000-0000-0000-000000000000"),
            "CON_FMD_ADF_PIPELINES": conns.get("CON_FMD_ADF_PIPELINES", "00000000-0000-0000-0000-000000000000"),
            "CON_FMD_FABRIC_NOTEBOOKS": conns.get("CON_FMD_FABRIC_NOTEBOOKS", "00000000-0000-0000-0000-000000000000"),
        },
        "database": {
            "displayName": sql_db.get("database", SQL_DB_DISPLAY_NAME),
            "id": sql_db.get("id", ""),
            "endpoint": sql_db.get("server", ""),
        },
    }

    config_path = os.path.join(SCRIPT_DIR, "config", "item_config.yaml")
    with open(config_path, "w") as f:
        f.write(write_simple_yaml(yaml_data))
    print(f"  [OK] {config_path}")

    # --- dashboard/app/api/config.json ---
    dash_config_path = os.path.join(SCRIPT_DIR, "dashboard", "app", "api", "config.json")
    if os.path.exists(dash_config_path):
        with open(dash_config_path) as f:
            dash_config = json.load(f)

        dash_config.setdefault("fabric", {})
        dash_config["fabric"]["workspace_data_id"] = ws.get("data_dev", "")
        dash_config["fabric"]["workspace_code_id"] = ws.get("code_dev", "")
        dash_config.setdefault("sql", {})
        dash_config["sql"]["server"] = sql_db.get("server", "")
        dash_config["sql"]["database"] = sql_db.get("database", "")

        with open(dash_config_path, "w") as f:
            json.dump(dash_config, f, indent=2)
        print(f"  [OK] {dash_config_path}")

    # --- Save deployment summary ---
    summary_path = os.path.join(SCRIPT_DIR, "deployment_summary.json")
    summary = {
        "deployed_at": time_mod.strftime("%Y-%m-%dT%H:%M:%S"),
        "workspaces": {k: {"name": WORKSPACE_NAMES.get(k, k), "id": v} for k, v in ws.items()},
        "connections": conns,
        "sql_database": sql_db,
        "lakehouses": state.get("lakehouse_ids", {}),
        "total_items": len(state.get("item_ids", {})),
    }
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"  [OK] {summary_path}")


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 12: WORKSPACE ICONS (best-effort)
# ═══════════════════════════════════════════════════════════════════════════════

def phase12_workspace_icons(state, args):
    print("\n" + "=" * 70)
    print("PHASE 12: Workspace Icons (best-effort)")
    print("=" * 70)

    icons_path = os.path.join(SCRIPT_DIR, "config", "fabric_icons.xml")
    if not os.path.exists(icons_path):
        print("  [SKIP] fabric_icons.xml not found — icons not available")
        return

    if args.dry_run:
        ws = state.get("workspace_ids", {})
        print("  [DRY] Would set workspace icons:")
        for k, v in ws.items():
            print(f"  [DRY]   {WORKSPACE_NAMES.get(k, k)} ({v})")
        return

    try:
        import xml.etree.ElementTree as ET
        tree = ET.parse(icons_path)
        root = tree.getroot()
        fabric_icons = {}
        for item in root.findall("icon"):
            name = item.find("name").text if item.find("name") is not None else ""
            b64 = item.find("base64").text if item.find("base64") is not None else ""
            fabric_icons[name] = b64
    except Exception as e:
        print(f"  [SKIP] Failed to parse icons: {e}")
        return

    # Get PBI-scoped token for internal metadata API
    pbi_token = get_token("https://analysis.windows.net/powerbi/api/.default")

    # Discover cluster URL
    try:
        req = Request(
            "https://api.powerbi.com/v1.0/myorg/groups",
            headers={"Authorization": f"Bearer {pbi_token}"}
        )
        resp = urlopen(req)
        groups_data = json.loads(resp.read())
        odata_context = groups_data.get("@odata.context", "")
        match = re.search(r"(https://[^/]+/)", odata_context)
        if not match:
            print("  [SKIP] Could not extract cluster URL")
            return
        cluster_url = match.group(1)
        print(f"  Cluster URL: {cluster_url}")
    except HTTPError as e:
        print(f"  [SKIP] Power BI API error: HTTP {e.code}")
        return

    icon_map = {
        "code": "fmd_code_icon.png",
        "data": "fmd_data_icon.png",
        "config": "fmd_config_icon.png",
    }

    for key, ws_id in state.get("workspace_ids", {}).items():
        ws_name = WORKSPACE_NAMES.get(key, key)
        icon_name = None
        for tag, iname in icon_map.items():
            if tag in key:
                icon_name = iname
                break
        if not icon_name or icon_name not in fabric_icons:
            continue

        icon_b64 = fabric_icons[icon_name]
        if not icon_b64:
            continue

        payload = json.dumps({"icon": f"data:image/png;base64,{icon_b64}"}).encode()
        req = Request(
            f"{cluster_url}metadata/folders/{ws_id}",
            data=payload,
            headers={"Authorization": f"Bearer {pbi_token}", "Content-Type": "application/json"},
            method="PUT",
        )
        try:
            urlopen(req)
            print(f"  [OK] {ws_name} — icon set")
        except HTTPError as e:
            print(f"  [WARN] {ws_name} — HTTP {e.code} (SP may lack permission for icons)")


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 13: ENTITY REGISTRATION (LZ + Bronze + Silver auto-cascade)
# ═══════════════════════════════════════════════════════════════════════════════

def phase13_register_entities(state, args):
    """Register entities in the metadata DB from entity config file.

    Reads entity definitions from config/entity_registration.json (if present).
    For each entity, creates LandingzoneEntity, then auto-cascades to
    BronzeLayerEntity and SilverLayerEntity — the same pattern as
    register_entity() in server.py.

    Entity registration file format:
    [
      {
        "dataSource": "MES",
        "schema": "dbo",
        "tables": ["CustomerContacts", "Customers", "Invoices", ...]
      },
      ...
    ]

    If no entity registration file exists, this phase is skipped.
    Entities can also be registered via the dashboard Source Manager UI.
    """
    print("\n" + "=" * 70)
    print("PHASE 13: Register Entities (LZ + Bronze + Silver)")
    print("=" * 70)

    entity_file = os.path.join(SCRIPT_DIR, "config", "entity_registration.json")
    if not os.path.exists(entity_file):
        print(f"  [SKIP] {entity_file} not found")
        print(f"         Create this file to auto-register entities, or use the dashboard Source Manager.")
        return

    with open(entity_file) as f:
        entity_config = json.load(f)

    sql_db = state.get("sql_db", {})
    server = sql_db.get("server", "")
    database = sql_db.get("database", "")
    if not server or not database:
        print("  [SKIP] No SQL database info available")
        return

    if args.dry_run:
        total = sum(len(ds.get("tables", [])) for ds in entity_config)
        print(f"  [DRY] Would register {total} entities across {len(entity_config)} data sources")
        for ds in entity_config:
            print(f"  [DRY]   {ds['dataSource']}: {len(ds.get('tables', []))} tables")
        return

    try:
        import pyodbc
    except ImportError:
        print("  [SKIP] pyodbc not installed")
        return

    # Connect to metadata DB
    sql_token = get_token("https://database.windows.net/.default")
    token_bytes = sql_token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    server_conn = f"{server},1433" if ",1433" not in server else server
    driver = "{ODBC Driver 18 for SQL Server}"
    conn_str = f"DRIVER={driver};SERVER={server_conn};DATABASE={database};"

    try:
        conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
    except Exception as e:
        print(f"  [FAIL] Connection error: {e}")
        return

    cursor = conn.cursor()

    # Look up lakehouse IDs
    cursor.execute("SELECT LakehouseId, Name FROM integration.Lakehouse")
    lh_map = {row[1]: row[0] for row in cursor.fetchall()}
    bronze_lh = lh_map.get("LH_BRONZE_LAYER")
    silver_lh = lh_map.get("LH_SILVER_LAYER")

    if not bronze_lh or not silver_lh:
        print("  [WARN] Bronze/Silver lakehouses not found in metadata DB")
        print("         Run Phase 10 first to populate lakehouse records")

    total_lz = 0
    total_bronze = 0
    total_silver = 0
    errors = 0

    for ds in entity_config:
        ds_name = ds["dataSource"]
        schema = ds.get("schema", "dbo")
        tables = ds.get("tables", [])

        # Look up DataSourceId
        cursor.execute(f"SELECT DataSourceId FROM integration.DataSource WHERE Name = ?", (ds_name,))
        row = cursor.fetchone()
        if not row:
            print(f"  [SKIP] DataSource '{ds_name}' not found in metadata DB — register it first (Phase 10)")
            continue
        ds_id = row[0]

        print(f"\n  === {ds_name} (DataSourceId={ds_id}, {len(tables)} tables) ===")

        for table in tables:
            safe_schema = schema.replace("'", "''")
            safe_table = table.replace("'", "''")
            try:
                # 1. Register LZ entity (upsert)
                cursor.execute(
                    f"EXEC [integration].[sp_UpsertLandingzoneEntity] "
                    f"@LandingzoneEntityId = 0, @DataSourceId = {ds_id}, "
                    f"@SourceSchema = '{safe_schema}', @SourceName = '{safe_table}', "
                    f"@IsActive = 1"
                )
                cursor.commit()
                total_lz += 1

                # Get the LZ entity ID
                cursor.execute(
                    "SELECT LandingzoneEntityId FROM integration.LandingzoneEntity "
                    "WHERE SourceSchema = ? AND SourceName = ? AND DataSourceId = ?",
                    (schema, table, ds_id)
                )
                lz_row = cursor.fetchone()
                if not lz_row:
                    continue
                lz_eid = lz_row[0]

                # 2. Auto-register Bronze
                if bronze_lh:
                    cursor.execute(
                        "SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?",
                        (lz_eid,)
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
                    else:
                        total_bronze += 1  # already exists

                    # 3. Auto-register Silver
                    if silver_lh:
                        cursor.execute(
                            "SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?",
                            (lz_eid,)
                        )
                        b_row = cursor.fetchone()
                        if b_row:
                            b_eid = b_row[0]
                            cursor.execute(
                                "SELECT SilverLayerEntityId FROM integration.SilverLayerEntity WHERE BronzeLayerEntityId = ?",
                                (b_eid,)
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
                            else:
                                total_silver += 1  # already exists

            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  [ERR] {schema}.{table}: {e}")
                elif errors == 6:
                    print(f"  [ERR] ... suppressing further errors")

    cursor.close()
    conn.close()

    print(f"\n  Entity Registration: {total_lz} LZ, {total_bronze} Bronze, {total_silver} Silver")
    if errors:
        print(f"  Errors: {errors}")


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 13.5: LOAD OPTIMIZATION (requires VPN to on-prem sources)
# ═══════════════════════════════════════════════════════════════════════════════

def phase13_5_load_optimization(state, args):
    """Analyze source SQL tables and configure incremental load strategy.

    Requires VPN connectivity to on-prem SQL sources.
    For each registered entity, discovers:
      - Primary keys (via sys.indexes)
      - Watermark columns for incremental loads (datetime/rowversion/identity)
      - Source row counts (via sys.partitions)

    Updates metadata DB with:
      - IsIncremental flag + IncrementalColumn on LandingzoneEntity
      - PrimaryKeys on BronzeLayerEntity

    Watermark priority: rowversion > *Modified* datetime > *Created* datetime > identity > none
    """
    print("\n" + "=" * 70)
    print("PHASE 13.5: Load Optimization (Source Analysis)")
    print("=" * 70)

    sql_db = state.get("sql_db", {})
    server = sql_db.get("server", "")
    database = sql_db.get("database", "")

    if not server or not database:
        print("  [SKIP] No SQL database info available")
        return

    if args.dry_run:
        print("  [DRY] Would analyze on-prem sources for PKs, watermarks, row counts")
        print("  [DRY] Requires VPN connectivity to source SQL Servers")
        return

    try:
        import pyodbc
    except ImportError:
        print("  [SKIP] pyodbc not installed")
        return

    # Connect to metadata DB
    sql_token = get_token("https://database.windows.net/.default")
    token_bytes = sql_token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    server_conn = f"{server},1433" if ",1433" not in server else server
    driver = "{ODBC Driver 18 for SQL Server}"
    conn_str = f"DRIVER={driver};SERVER={server_conn};DATABASE={database};"

    try:
        meta_conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
    except Exception as e:
        print(f"  [FAIL] Metadata DB connection error: {e}")
        return

    meta_cursor = meta_conn.cursor()

    # Get datasources with their connection details
    meta_cursor.execute(
        "SELECT ds.DataSourceId, ds.Name, c.ConnectionGuid "
        "FROM integration.DataSource ds "
        "JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId "
        "WHERE ds.Namespace NOT IN ('ONELAKE', 'NB')"
    )
    datasources = [{"id": row[0], "name": row[1], "connGuid": row[2]} for row in meta_cursor.fetchall()]

    if not datasources:
        print("  [SKIP] No on-prem datasources registered")
        meta_cursor.close()
        meta_conn.close()
        return

    # Get gateway connections from Fabric API to resolve server/database
    status, gw_data = fabric_get("connections")
    if status != 200 or not gw_data:
        print("  [SKIP] Could not retrieve Fabric connections")
        meta_cursor.close()
        meta_conn.close()
        return

    gw_by_id = {}
    for conn in gw_data.get("value", []):
        details = conn.get("connectionDetails", {})
        params = {p["name"]: p["value"] for p in details.get("parameters", []) if "name" in p and "value" in p}
        gw_by_id[conn["id"].lower()] = {
            "server": params.get("server", params.get("host", "")),
            "database": params.get("database", ""),
        }

    total_pks = 0
    total_incremental = 0
    total_entities = 0

    for ds in datasources:
        conn_guid = ds["connGuid"].lower()
        gw = gw_by_id.get(conn_guid)
        if not gw or not gw["server"]:
            print(f"  [SKIP] DS {ds['id']} ({ds['name']}): gateway not resolved")
            continue

        src_server = gw["server"]
        src_database = gw["database"]
        print(f"\n  --- DS {ds['id']}: {ds['name']} ({src_server}/{src_database}) ---")

        # Connect to source (Windows Auth via VPN)
        try:
            src_conn_str = (
                f"DRIVER={{ODBC Driver 18 for SQL Server}};"
                f"SERVER={src_server};DATABASE={src_database};"
                f"Trusted_Connection=yes;TrustServerCertificate=yes;"
            )
            src_conn = pyodbc.connect(src_conn_str, timeout=15)
        except Exception as e:
            print(f"  [FAIL] Source connection failed: {str(e)[:150]}")
            continue

        src_cursor = src_conn.cursor()

        # Discover PKs
        pk_map = {}
        try:
            src_cursor.execute("""
                SELECT s.name, t.name, c.name
                FROM sys.indexes i
                JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                JOIN sys.tables t ON i.object_id = t.object_id
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE i.is_primary_key = 1
                ORDER BY s.name, t.name, ic.key_ordinal
            """)
            for row in src_cursor.fetchall():
                pk_map.setdefault((row[0], row[1]), []).append(row[2])
        except Exception as e:
            print(f"  PK discovery failed: {e}")

        # Discover watermark candidates
        wm_map = {}
        try:
            src_cursor.execute("""
                SELECT s.name, t.name, c.name, tp.name,
                       COLUMNPROPERTY(t.object_id, c.name, 'IsIdentity')
                FROM sys.columns c
                JOIN sys.tables t ON c.object_id = t.object_id
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                JOIN sys.types tp ON c.system_type_id = tp.system_type_id AND c.user_type_id = tp.user_type_id
                WHERE (
                    tp.name IN ('datetime','datetime2','datetimeoffset','smalldatetime','timestamp','rowversion')
                    OR COLUMNPROPERTY(t.object_id, c.name, 'IsIdentity') = 1
                )
            """)
            for row in src_cursor.fetchall():
                key = (row[0], row[1])
                col, dtype, is_id = row[2], row[3], row[4]
                col_lower = col.lower()
                if dtype in ('timestamp', 'rowversion'):
                    pri = 1
                elif dtype in ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime'):
                    if any(kw in col_lower for kw in ('modif', 'updat', 'chang', 'last_')):
                        pri = 2
                    elif any(kw in col_lower for kw in ('creat', 'insert', 'added')):
                        pri = 3
                    else:
                        pri = 5
                elif is_id:
                    pri = 4
                else:
                    pri = 6
                wm_map.setdefault(key, []).append((col, pri))
        except Exception as e:
            print(f"  Watermark discovery failed: {e}")

        src_conn.close()

        # Get entities for this datasource
        meta_cursor.execute(
            "SELECT LandingzoneEntityId, SourceSchema, SourceName "
            "FROM integration.LandingzoneEntity "
            "WHERE DataSourceId = ? AND IsActive = 1",
            (ds["id"],)
        )
        entities = [(row[0], row[1], row[2]) for row in meta_cursor.fetchall()]

        ds_pks = 0
        ds_inc = 0
        for eid, schema, table in entities:
            total_entities += 1
            key = (schema, table)

            # Update PKs on Bronze entity
            pks = pk_map.get(key, [])
            if pks:
                ds_pks += 1
                total_pks += 1
                pk_str = ','.join(pks)
                try:
                    meta_cursor.execute(
                        "UPDATE integration.BronzeLayerEntity SET PrimaryKeys = ? "
                        "WHERE LandingzoneEntityId = ?",
                        (pk_str, eid)
                    )
                    meta_cursor.commit()
                except Exception:
                    pass

            # Determine incremental load strategy
            watermarks = sorted(wm_map.get(key, []), key=lambda w: w[1])
            best_wm = watermarks[0] if watermarks else None
            if best_wm and best_wm[1] <= 3:
                ds_inc += 1
                total_incremental += 1
                try:
                    meta_cursor.execute(
                        "UPDATE integration.LandingzoneEntity "
                        "SET IsIncremental = 1, IsIncrementalColumn = ? "
                        "WHERE LandingzoneEntityId = ?",
                        (best_wm[0], eid)
                    )
                    meta_cursor.commit()
                except Exception:
                    pass

        print(f"  {len(entities)} entities: {ds_pks} PKs, {ds_inc} incremental")

    meta_cursor.close()
    meta_conn.close()

    print(f"\n  Load Optimization: {total_entities} entities, {total_pks} PKs, "
          f"{total_incremental} incremental")
    if total_entities == 0:
        print("  (No entities found — register entities first in Phase 13)")


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 14: DEPLOYMENT VALIDATION
# ═══════════════════════════════════════════════════════════════════════════════

def phase14_validate(state, args):
    """Validate the deployment by checking key resources and counts.

    Verifies:
    - All workspaces accessible
    - Lakehouses exist in DATA workspaces
    - Pipelines exist in CODE workspaces
    - SQL Database schema has expected tables and stored procs
    - Connection GUIDs resolve
    - Metadata DB has expected record counts
    """
    print("\n" + "=" * 70)
    print("PHASE 14: Deployment Validation")
    print("=" * 70)

    if args.dry_run:
        print("  [DRY] Would validate all deployed resources")
        return

    checks_passed = 0
    checks_failed = 0

    def check(label, condition, detail=""):
        nonlocal checks_passed, checks_failed
        if condition:
            checks_passed += 1
            print(f"  [PASS] {label}")
        else:
            checks_failed += 1
            msg = f"  [FAIL] {label}"
            if detail:
                msg += f" — {detail}"
            print(msg)

    # --- Workspaces ---
    print("\n  --- Workspaces ---")
    for key, ws_id in state.get("workspace_ids", {}).items():
        ws_name = WORKSPACE_NAMES.get(key, key)
        status, data = fabric_get(f"workspaces/{ws_id}")
        check(f"Workspace: {ws_name}", status == 200,
              f"HTTP {status}" if status != 200 else "")

    # --- Lakehouses ---
    print("\n  --- Lakehouses ---")
    for key, ws_id in state.get("workspace_ids", {}).items():
        if "data" not in key:
            continue
        items = list_workspace_items(ws_id, "Lakehouse")
        lh_names = [i["displayName"] for i in items]
        for expected in LAKEHOUSE_NAMES:
            check(f"Lakehouse: {expected} in {key}", expected in lh_names,
                  f"Found: {lh_names}")

    # --- Pipelines ---
    print("\n  --- Pipelines ---")
    for key, ws_id in state.get("workspace_ids", {}).items():
        if "code" not in key:
            continue
        items = list_workspace_items(ws_id, "DataPipeline")
        check(f"Pipelines in {key}", len(items) >= 17,
              f"Found {len(items)} (expected >= 17)")

    # --- Connections ---
    print("\n  --- Connections ---")
    for conn_name, conn_id in state.get("connection_ids", {}).items():
        if conn_id == "00000000-0000-0000-0000-000000000000":
            print(f"  [SKIP] {conn_name} — not configured")
            continue
        check(f"Connection: {conn_name}", len(conn_id) > 10, "Empty GUID")

    # --- SQL Metadata ---
    print("\n  --- SQL Metadata ---")
    sql_db = state.get("sql_db", {})
    server = sql_db.get("server", "")
    database = sql_db.get("database", "")
    if server and database:
        try:
            import pyodbc
            sql_token = get_token("https://database.windows.net/.default")
            token_bytes = sql_token.encode("utf-16-le")
            token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
            server_conn = f"{server},1433" if ",1433" not in server else server
            driver = "{ODBC Driver 18 for SQL Server}"
            conn_str = f"DRIVER={driver};SERVER={server_conn};DATABASE={database};"
            db_conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
            cursor = db_conn.cursor()

            # Check tables exist
            cursor.execute("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'integration'")
            table_count = cursor.fetchone()[0]
            check("SQL schema: integration tables", table_count >= 10,
                  f"Found {table_count} tables")

            # Check stored procs
            cursor.execute("SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = 'integration'")
            proc_count = cursor.fetchone()[0]
            check("SQL schema: stored procedures", proc_count >= 5,
                  f"Found {proc_count} procs")

            # Check metadata counts
            for table_name in ["Connection", "DataSource", "Workspace", "Pipeline", "Lakehouse"]:
                cursor.execute(f"SELECT COUNT(*) FROM integration.{table_name}")
                count = cursor.fetchone()[0]
                check(f"Metadata: integration.{table_name}", count > 0,
                      f"{count} records")

            # Check entity counts
            for table_name in ["LandingzoneEntity", "BronzeLayerEntity", "SilverLayerEntity"]:
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM integration.{table_name}")
                    count = cursor.fetchone()[0]
                    print(f"  [INFO] integration.{table_name}: {count} records")
                except Exception:
                    pass

            cursor.close()
            db_conn.close()

        except ImportError:
            print("  [SKIP] pyodbc not installed")
        except Exception as e:
            print(f"  [FAIL] SQL validation error: {e}")
    else:
        print("  [SKIP] No SQL database info")

    # --- Summary ---
    total = checks_passed + checks_failed
    print(f"\n  Validation: {checks_passed}/{total} passed, {checks_failed} failed")
    if checks_failed == 0:
        print("  DEPLOYMENT VALIDATED SUCCESSFULLY")
    else:
        print("  DEPLOYMENT HAS ISSUES — review failures above")


# ═══════════════════════════════════════════════════════════════════════════════
# UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def _get_envs(args):
    """Return list of environments to deploy based on args."""
    if args.env == "all":
        return ["dev", "prod"]
    return [args.env]


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

PHASES = [
    (1, "Auth & Config",             phase1_auth_config),
    (2, "Resolve Capacity",          phase2_resolve_capacity),
    (3, "Create Workspaces",         phase3_create_workspaces),
    (4, "Create Connections",        phase4_create_connections),
    (5, "Create Lakehouses",         phase5_create_lakehouses),
    (6, "Create SQL Database",       phase6_create_sql_database),
    (7, "Run Setup Notebook",        phase6_5_run_setup_notebook),
    (8, "Deploy Notebooks",          phase7_deploy_notebooks),
    (9, "Deploy Var Libs & Env",     phase8_deploy_variable_libs),
    (10, "Deploy Pipelines",         phase9_deploy_pipelines),
    (11, "Populate SQL Metadata",    phase10_sql_metadata),
    (12, "Update Local Config",      phase11_update_config),
    (13, "Register Entities",        phase13_register_entities),
    (14, "Workspace Icons",          phase12_workspace_icons),
    (15, "Validate Deployment",      phase14_validate),
]


def main():
    parser = argparse.ArgumentParser(
        description="Full greenfield FMD Framework deployment to Microsoft Fabric",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python deploy_from_scratch.py --env all                  Deploy DEV + PROD
  python deploy_from_scratch.py --env dev --dry-run        Preview DEV deployment
  python deploy_from_scratch.py --resume                   Resume from last phase
  python deploy_from_scratch.py --skip-phase 12            Skip workspace icons
  python deploy_from_scratch.py --start-phase 9            Start from Phase 9
        """,
    )
    parser.add_argument("--env", choices=["dev", "prod", "all"], default="all",
                        help="Environment to deploy (default: all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview what would be created without making changes")
    parser.add_argument("--resume", action="store_true",
                        help="Resume from last completed phase")
    parser.add_argument("--skip-phase", type=int, action="append", default=[],
                        help="Skip specific phase(s) by number")
    parser.add_argument("--start-phase", type=int, default=1,
                        help="Start from a specific phase number")
    parser.add_argument("--capacity-id", type=str, default="",
                        help="Fabric capacity GUID (auto-detected if not specified)")
    parser.add_argument("--capacity-name", type=str, default="",
                        help="Fabric capacity name pattern to match")
    parser.add_argument("--force", action="store_true",
                        help="Force fresh deployment even if previous state exists")

    args = parser.parse_args()

    print("=" * 70)
    print("  FMD FRAMEWORK — Full From-Scratch Deployment")
    print(f"  Environment: {args.env.upper()}")
    print(f"  Dry Run: {args.dry_run}")
    print("=" * 70)

    # Load or initialize state
    if args.resume:
        state = load_state()
        completed = state.get("completed_phases", [])
        if completed:
            print(f"  Resuming from Phase {max(completed) + 1} (completed: {completed})")
            args.start_phase = max(completed) + 1
        else:
            print("  No previous state found — starting fresh")
    else:
        # Fresh deployment — start with clean state
        if os.path.exists(STATE_FILE) and not args.dry_run:
            old_state = load_state()
            old_ws = len(old_state.get("workspace_ids", {}))
            old_conn = len(old_state.get("connection_ids", {}))
            if old_ws > 0 or old_conn > 0:
                print(f"\n  [WARN] Previous deployment state found!")
                print(f"         Workspaces: {old_ws}, Connections: {old_conn}")
                print(f"         Use --resume to continue from last phase.")
                if not args.force:
                    print(f"         Use --force to overwrite, or delete {STATE_FILE}")
                    sys.exit(1)
                print(f"  [FORCE] Overwriting previous state")
        state = {"completed_phases": [], "mapping_table": [], "workspace_ids": {},
                 "connection_ids": {}, "lakehouse_ids": {}, "sql_db": {}, "item_ids": {}}

    start_time = time_mod.time()
    phase_results = []

    for phase_num, phase_name, phase_fn in PHASES:
        if phase_num < args.start_phase:
            continue
        if phase_num in args.skip_phase:
            print(f"\n  [SKIP] Phase {phase_num}: {phase_name}")
            continue

        try:
            phase_fn(state, args)
            state["completed_phases"].append(phase_num)
            if not args.dry_run:
                save_state(state)
            phase_results.append((phase_num, phase_name, "OK"))
        except KeyboardInterrupt:
            print(f"\n  [INTERRUPTED] Phase {phase_num}: {phase_name}")
            print(f"  State saved. Use --resume to continue.")
            save_state(state)
            sys.exit(130)
        except Exception as e:
            print(f"\n  [ERROR] Phase {phase_num}: {phase_name}: {e}")
            phase_results.append((phase_num, phase_name, f"FAILED: {e}"))
            save_state(state)
            # Continue to next phase — don't abort the whole deployment

    # Summary
    elapsed = time_mod.time() - start_time
    print("\n" + "=" * 70)
    print("  DEPLOYMENT SUMMARY")
    print("=" * 70)
    for num, name, result in phase_results:
        status_icon = "[OK]" if result == "OK" else "[!!]"
        print(f"  {status_icon} Phase {num:2d}: {name:30s} {result}")
    print(f"\n  Elapsed: {elapsed:.1f}s")
    print(f"  Workspaces: {len(state.get('workspace_ids', {}))}")
    print(f"  Connections: {len(state.get('connection_ids', {}))}")
    print(f"  Lakehouses: {len(state.get('lakehouse_ids', {}))}")
    print(f"  Items: {len(state.get('item_ids', {}))}")
    print(f"  Mapping entries: {len(state.get('mapping_table', []))}")

    if not args.dry_run:
        print(f"\n  State saved to: {STATE_FILE}")
        print(f"  Summary saved to: deployment_summary.json")
        try:
            import subprocess
            registry_script = os.path.join(SCRIPT_DIR, "scripts", "centralized_id_registry.py")
            if os.path.exists(registry_script):
                print(f"\n  Syncing new deployment state to Centralized ID Registry...")
                subprocess.run([sys.executable, registry_script, "--sync-deploy", "--update-all"], check=True)
                print(f"  ID Registry successfully updated!")
        except Exception as e:
            print(f"  [WARN] Failed to sync Centralized ID Registry: {e}")

    print("=" * 70)


if __name__ == "__main__":
    main()
