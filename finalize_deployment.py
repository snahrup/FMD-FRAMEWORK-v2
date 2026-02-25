"""
Finalize FMD Framework Deployment — Post-Pipeline Setup
Handles everything the notebook does AFTER deploying pipelines/notebooks:
1. Workspace icons (via internal Power BI metadata API)
2. SQL metadata population (connections, data sources, workspaces, pipelines, lakehouses)
3. Local config file updates (item_config.yaml, config.json)
"""
import json, struct, time, re, sys, os
import xml.etree.ElementTree as ET
import pyodbc
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

# ─── Auth ───────────────────────────────────────────────────────────────
TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"

# ─── Workspace IDs (current deployment) ─────────────────────────────────
WORKSPACES = {
    "INTEGRATION CODE (D)": "146fe38c-f6c3-4e9d-a18c-5c01cad5941e",
    "INTEGRATION CODE (P)": "1284458c-1976-46a6-b9d8-af17c7d11a59",
    "INTEGRATION DATA (D)": "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a",
    "INTEGRATION DATA (P)": "4c4b6bf5-8728-4aac-a132-b008a11b96d7",
    "INTEGRATION CONFIG":   "f442f66c-eac6-46d7-80c9-c8b025c86fbe",
}

# ─── SQL Database ────────────────────────────────────────────────────────
SQL_DB_ID = "501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"
SQL_SERVER = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
SQL_DATABASE = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"

# ─── Connections (tenant-level, survive redeployment) ────────────────────
CONNECTIONS = {
    "CON_FMD_FABRIC_PIPELINES": {"id": "6b2e33a1-b441-4137-b41d-260ffa8258cf", "type": "FabricDataPipelines"},
    "CON_FMD_FABRIC_SQL":       {"id": "0f86f6a1-9f84-44d1-b977-105b5179c678", "type": "FabricSql"},
    # NOTE: These two were never created — need Fabric UI manual creation
    # "CON_FMD_ADF_PIPELINES":  {"id": "TBD", "type": "AzureDataFactory"},
    # "CON_FMD_FABRIC_NOTEBOOKS": {"id": "TBD", "type": "Notebook"},
}

FABRIC_API = "https://api.fabric.microsoft.com/v1"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Icon mapping ───────────────────────────────────────────────────────
ICON_MAP = {
    "code": "fmd_code_icon.png",
    "data": "fmd_data_icon.png",
    "config": "fmd_config_icon.png",
}


def get_token(scope="https://api.fabric.microsoft.com/.default"):
    url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
    data = urlencode({
        "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
        "scope": scope, "grant_type": "client_credentials",
    }).encode()
    req = Request(url, data=data, method="POST")
    with urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def fabric_get(token, path):
    req = Request(f"{FABRIC_API}{path}", headers={"Authorization": f"Bearer {token}"})
    try:
        with urlopen(req) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        body = e.read().decode() if e.read else ""
        print(f"  HTTP {e.code}: {body[:200]}")
        return {}


# ═══════════════════════════════════════════════════════════════════════
# PART 1: WORKSPACE ICONS
# ═══════════════════════════════════════════════════════════════════════
def deploy_icons():
    print("\n" + "=" * 60)
    print("PART 1: WORKSPACE ICONS")
    print("=" * 60)

    # Load icons from XML
    icons_path = os.path.join(SCRIPT_DIR, "config", "fabric_icons.xml")
    if not os.path.exists(icons_path):
        print("  SKIP — fabric_icons.xml not found")
        return

    tree = ET.parse(icons_path)
    root = tree.getroot()
    fabric_icons = {}
    for item in root.findall("icon"):
        name = item.find("name").text if item.find("name") is not None else ""
        b64 = item.find("base64").text if item.find("base64") is not None else ""
        fabric_icons[name] = b64

    # Get PBI-scoped token for the internal metadata API
    pbi_token = get_token("https://analysis.windows.net/powerbi/api/.default")

    # Discover cluster URL from Power BI groups API
    req = Request(
        "https://api.powerbi.com/v1.0/myorg/groups",
        headers={"Authorization": f"Bearer {pbi_token}"}
    )
    try:
        with urlopen(req) as resp:
            groups_data = json.loads(resp.read())
            odata_context = groups_data.get("@odata.context", "")
            match = re.search(r"(https://[^/]+/)", odata_context)
            if match:
                cluster_url = match.group(1)
                print(f"  Cluster URL: {cluster_url}")
            else:
                print("  FAIL — Could not extract cluster URL from @odata.context")
                print(f"  @odata.context: {odata_context}")
                return
    except HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        print(f"  FAIL — Power BI groups API HTTP {e.code}: {body[:300]}")
        return

    # The icon SVGs in the XML need to be converted to PNG first.
    # Since we don't have cairosvg locally, we'll send the SVG base64 directly
    # and let the API handle it. The notebook converts SVG→PNG first, but
    # the API also accepts SVG icons.

    for ws_name, ws_id in WORKSPACES.items():
        # Determine icon
        display_lower = ws_name.lower()
        icon_name = None
        for key, value in ICON_MAP.items():
            if key in display_lower:
                icon_name = value
                break

        if not icon_name or icon_name not in fabric_icons:
            print(f"  SKIP {ws_name} — no matching icon")
            continue

        icon_b64 = fabric_icons[icon_name]
        if not icon_b64:
            print(f"  SKIP {ws_name} — empty icon data")
            continue

        # The icons in fabric_icons.xml are SVG base64. Try sending as PNG first,
        # then as SVG if that fails. The notebook uses cairosvg to convert.
        # Try as PNG (the metadata API expects PNG)
        payload = json.dumps({"icon": f"data:image/png;base64,{icon_b64}"}).encode()
        icon_url = f"{cluster_url}metadata/folders/{ws_id}"
        req = Request(
            icon_url,
            data=payload,
            headers={
                "Authorization": f"Bearer {pbi_token}",
                "Content-Type": "application/json"
            },
            method="PUT"
        )
        try:
            with urlopen(req) as resp:
                print(f"  OK   {ws_name} — icon set ({icon_name})")
        except HTTPError as e:
            body = e.read().decode("utf-8") if e.fp else ""
            # Try SVG format
            payload2 = json.dumps({"icon": f"data:image/svg+xml;base64,{icon_b64}"}).encode()
            req2 = Request(
                icon_url,
                data=payload2,
                headers={
                    "Authorization": f"Bearer {pbi_token}",
                    "Content-Type": "application/json"
                },
                method="PUT"
            )
            try:
                with urlopen(req2) as resp2:
                    print(f"  OK   {ws_name} — icon set as SVG ({icon_name})")
            except HTTPError as e2:
                body2 = e2.read().decode("utf-8") if e2.fp else ""
                print(f"  FAIL {ws_name} — HTTP {e2.code}: {body2[:200]}")


# ═══════════════════════════════════════════════════════════════════════
# PART 2: SQL METADATA POPULATION
# ═══════════════════════════════════════════════════════════════════════
def populate_sql_metadata():
    print("\n" + "=" * 60)
    print("PART 2: SQL METADATA POPULATION")
    print("=" * 60)

    # Get token for SQL
    token = get_token("https://database.windows.net/.default")
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)

    driver = "{ODBC Driver 18 for SQL Server}"
    conn_str = f"DRIVER={driver};SERVER={SQL_SERVER};DATABASE={SQL_DATABASE};"

    print(f"  Connecting to {SQL_SERVER}...")
    try:
        conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct}, timeout=30)
    except Exception as e:
        print(f"  FAIL — Connection error: {e}")
        return

    cursor = conn.cursor()
    # Warm up
    cursor.execute("SELECT 1")
    cursor.fetchone()
    print("  Connected!")

    queries = []

    # --- Connections ---
    print("\n  --- Connections ---")
    for name, info in CONNECTIONS.items():
        q = (f'EXEC [integration].[sp_UpsertConnection] '
             f'@ConnectionGuid = "{info["id"]}", '
             f'@Name = "{name}", '
             f'@Type = "{info["type"]}", '
             f'@IsActive = 1')
        queries.append(("Connection", name, q))

    # Built-in pseudo-connections
    queries.append(("Connection", "CON_FMD_NOTEBOOK",
        'EXEC [integration].[sp_UpsertConnection] @ConnectionGuid = "00000000-0000-0000-0000-000000000001", @Name = "CON_FMD_NOTEBOOK", @Type = "NOTEBOOK", @IsActive = 1'))
    queries.append(("Connection", "CON_FMD_ONELAKE",
        'EXEC [integration].[sp_UpsertConnection] @ConnectionGuid = "00000000-0000-0000-0000-000000000000", @Name = "CON_FMD_ONELAKE", @Type = "ONELAKE", @IsActive = 1'))

    # --- DataSources ---
    print("  --- DataSources ---")
    queries.append(("DataSource", "LH_DATA_LANDINGZONE (ONELAKE_TABLES)", """
        DECLARE @DataSourceIdInternal INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = 'LH_DATA_LANDINGZONE' and Type='ONELAKE_TABLES_01')
        DECLARE @ConnectionIdInternal INT = (SELECT ConnectionId FROM integration.Connection WHERE ConnectionGuid = '00000000-0000-0000-0000-000000000000')
        EXECUTE [integration].[sp_UpsertDataSource]
            @ConnectionId = @ConnectionIdInternal
            ,@DataSourceId = @DataSourceIdInternal
            ,@Name = 'LH_DATA_LANDINGZONE'
            ,@Namespace = 'ONELAKE'
            ,@Type = 'ONELAKE_TABLES_01'
            ,@Description = 'ONELAKE_TABLES'
            ,@IsActive = 1
    """))
    queries.append(("DataSource", "LH_DATA_LANDINGZONE (ONELAKE_FILES)", """
        DECLARE @DataSourceIdInternal INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = 'LH_DATA_LANDINGZONE' and Type='ONELAKE_FILES_01')
        DECLARE @ConnectionIdInternal INT = (SELECT ConnectionId FROM integration.Connection WHERE ConnectionGuid = '00000000-0000-0000-0000-000000000000')
        EXECUTE [integration].[sp_UpsertDataSource]
            @ConnectionId = @ConnectionIdInternal
            ,@DataSourceId = @DataSourceIdInternal
            ,@Name = 'LH_DATA_LANDINGZONE'
            ,@Namespace = 'ONELAKE'
            ,@Type = 'ONELAKE_FILES_01'
            ,@Description = 'ONELAKE_FILES'
            ,@IsActive = 1
    """))
    queries.append(("DataSource", "CUSTOM_NOTEBOOK", """
        DECLARE @DataSourceIdInternal INT = (SELECT DataSourceId FROM integration.DataSource WHERE Name = 'CUSTOM_NOTEBOOK' and Type='NOTEBOOK')
        DECLARE @ConnectionIdInternal INT = (SELECT ConnectionId FROM integration.Connection WHERE ConnectionGuid = '00000000-0000-0000-0000-000000000001')
        EXECUTE [integration].[sp_UpsertDataSource]
            @ConnectionId = @ConnectionIdInternal
            ,@DataSourceId = @DataSourceIdInternal
            ,@Name = 'CUSTOM_NOTEBOOK'
            ,@Namespace = 'NB'
            ,@Type = 'NOTEBOOK'
            ,@Description = 'Custom Notebook'
            ,@IsActive = 1
    """))

    # --- Workspaces ---
    print("  --- Workspaces ---")
    for ws_name, ws_id in WORKSPACES.items():
        q = f'EXEC [integration].[sp_UpsertWorkspace] @WorkspaceId = "{ws_id}", @Name = "{ws_name}"'
        queries.append(("Workspace", ws_name, q))

    # --- Pipelines (from CODE workspaces → registered against DATA workspaces) ---
    print("  --- Pipelines ---")
    fabric_token = get_token()

    # Map CODE workspace → DATA workspace (pipelines registered against DATA ws)
    code_to_data = {
        WORKSPACES["INTEGRATION CODE (D)"]: WORKSPACES["INTEGRATION DATA (D)"],
        WORKSPACES["INTEGRATION CODE (P)"]: WORKSPACES["INTEGRATION DATA (P)"],
    }

    for code_ws_id, data_ws_id in code_to_data.items():
        items = fabric_get(fabric_token, f"/workspaces/{code_ws_id}/items?type=DataPipeline")
        for item in items.get("value", []):
            q = (f'EXEC [integration].[sp_UpsertPipeline] '
                 f'@PipelineId = "{item["id"]}", '
                 f'@WorkspaceId = "{data_ws_id}", '
                 f'@Name = "{item["displayName"]}"')
            queries.append(("Pipeline", f'{item["displayName"]} ({data_ws_id[:8]}...)', q))

    # --- Lakehouses (from DATA workspaces) ---
    print("  --- Lakehouses ---")
    for ws_name, ws_id in WORKSPACES.items():
        if "DATA" not in ws_name:
            continue
        items = fabric_get(fabric_token, f"/workspaces/{ws_id}/items?type=Lakehouse")
        for item in items.get("value", []):
            q = (f'EXEC [integration].[sp_UpsertLakehouse] '
                 f'@LakehouseId = "{item["id"]}", '
                 f'@WorkspaceId = "{ws_id}", '
                 f'@Name = "{item["displayName"]}"')
            queries.append(("Lakehouse", f'{item["displayName"]} ({ws_id[:8]}...)', q))

    # Execute all queries
    print(f"\n  Executing {len(queries)} SQL statements...")
    success = 0
    failed = 0
    for category, label, query in queries:
        try:
            cursor.execute(query)
            cursor.commit()
            print(f"  OK   [{category:12}] {label}")
            success += 1
        except Exception as e:
            print(f"  FAIL [{category:12}] {label}: {e}")
            failed += 1

    cursor.close()
    conn.close()
    print(f"\n  SQL: {success} OK, {failed} FAILED")


# ═══════════════════════════════════════════════════════════════════════
# PART 3: LOCAL CONFIG FILES
# ═══════════════════════════════════════════════════════════════════════
def update_config_files():
    print("\n" + "=" * 60)
    print("PART 3: LOCAL CONFIG FILES")
    print("=" * 60)

    # --- item_config.yaml ---
    config_path = os.path.join(SCRIPT_DIR, "config", "item_config.yaml")
    yaml_content = f"""workspaces:
    workspace_data: "{WORKSPACES["INTEGRATION DATA (D)"]}"
    workspace_code: "{WORKSPACES["INTEGRATION CODE (D)"]}"
    workspace_config: "{WORKSPACES["INTEGRATION CONFIG"]}"
    workspace_data_prod: "{WORKSPACES["INTEGRATION DATA (P)"]}"
    workspace_code_prod: "{WORKSPACES["INTEGRATION CODE (P)"]}"

connections:
    CON_FMD_FABRIC_SQL: "{CONNECTIONS["CON_FMD_FABRIC_SQL"]["id"]}"
    CON_FMD_FABRIC_PIPELINES: "{CONNECTIONS["CON_FMD_FABRIC_PIPELINES"]["id"]}"
    CON_FMD_ADF_PIPELINES: "00000000-0000-0000-0000-000000000000"
    CON_FMD_FABRIC_NOTEBOOKS: "00000000-0000-0000-0000-000000000000"

database:
    displayName: "{SQL_DATABASE}"
    id: "{SQL_DB_ID}"
    endpoint: "{SQL_SERVER}"
"""
    with open(config_path, "w") as f:
        f.write(yaml_content)
    print(f"  OK   {config_path}")

    # --- dashboard/app/api/config.json ---
    dashboard_config_path = os.path.join(SCRIPT_DIR, "dashboard", "app", "api", "config.json")
    if os.path.exists(dashboard_config_path):
        with open(dashboard_config_path, "r") as f:
            dash_config = json.load(f)

        dash_config["fabric"]["workspace_data_id"] = WORKSPACES["INTEGRATION DATA (D)"]
        dash_config["fabric"]["workspace_code_id"] = WORKSPACES["INTEGRATION CODE (D)"]
        dash_config["sql"]["server"] = SQL_SERVER
        dash_config["sql"]["database"] = SQL_DATABASE

        with open(dashboard_config_path, "w") as f:
            json.dump(dash_config, f, indent=2)
        print(f"  OK   {dashboard_config_path}")
    else:
        print(f"  SKIP {dashboard_config_path} — not found")


# ═══════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════
def main():
    print("=" * 60)
    print("FMD DEPLOYMENT FINALIZATION")
    print("=" * 60)

    # Run each part, don't let one failure block the others
    try:
        deploy_icons()
    except Exception as e:
        print(f"\n  ICON ERROR: {e}")

    try:
        populate_sql_metadata()
    except Exception as e:
        print(f"\n  SQL ERROR: {e}")

    try:
        update_config_files()
    except Exception as e:
        print(f"\n  CONFIG ERROR: {e}")

    print("\n" + "=" * 60)
    print("FINALIZATION COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    main()
