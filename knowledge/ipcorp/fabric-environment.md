# IP Corp Fabric Environment

> **Purpose**: Microsoft Fabric workspace IDs, lakehouse IDs, SQL DB connection, service principal details, and deployment configuration
> **Last Updated**: March 2026

---

## Workspace IDs

**CRITICAL**: Only workspaces prefixed `INTEGRATION` are current. Anything prefixed `DEV_` or `OLD_` is deprecated.

### Development Environment

| Workspace | Name | ID |
|-----------|------|----|
| **DATA** | INTEGRATION DATA (D) | `0596d0e7-e036-451d-a967-41a284302e8d` |
| **CODE** | INTEGRATION CODE (D) | `c0366b24-e6f8-4994-b4df-b765ecb5bbf8` |
| **CONFIG** | INTEGRATION CONFIG | `e1f70591-6780-4d93-84bc-ba4572513e5c` |

### Production Environment

| Workspace | Name | ID |
|-----------|------|----|
| **DATA** | INTEGRATION DATA (P) | `5a54d6ec-bafb-4193-a1c3-00a3097c3660` |
| **CODE** | INTEGRATION CODE (P) | `f825b6f5-1c3d-4b5d-be8a-12e3c2523d38` |

### Deprecated Workspaces (DO NOT USE)

| Old ID | Notes |
|--------|-------|
| `a3a180ff-fbc2-48fd-a65f-27ae7bb6709a` | OLD DEV_INTEGRATION DATA (D) |
| `146fe38c-f6c3-4e9d-a18c-5c01cad5941e` | OLD CODE workspace |
| `f442f66c-eac6-46d7-80c9-c8b025c86fbe` | OLD CONFIG workspace |

---

## Lakehouse IDs (DATA Workspace)

| Lakehouse | Purpose | ID |
|-----------|---------|----|
| **LH_DATA_LANDINGZONE** | Raw data landing from sources | `2aef4ede-2918-4a6b-8ec6-a42108c67806` |
| **LH_BRONZE_LAYER** | First transformation layer | `cf57e8bf-7b34-471b-adea-ed80d05a4fdb` |
| **LH_SILVER_LAYER** | Cleansed & conformed layer | `44a0993f-9633-4403-8f6a-011903c25792` |

### Engine Default GUIDs (config.py)

| Layer | GUID |
|-------|------|
| Landing Zone | `3b9a7e79-...` |
| Bronze | `f06393ca-...` |
| Silver | `f85e1ba0-...` |

**Note**: All 596 entities are on DEV lakehouses (LH 1/2/3), not PROD (LH 4/5/6).

---

## SQL Metadata Database

| Property | Value |
|----------|-------|
| **Display Name** | `SQL_INTEGRATION_FRAMEWORK` |
| **Item ID** | `ed567507-5ec0-48fd-8b46-0782241219d5` |
| **Full DB Name** | `SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0` |
| **Endpoint** | `7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433` |
| **Auth** | Service Principal token via `https://analysis.windows.net/powerbi/api/.default` scope |
| **Consistency** | **ACID / Strongly consistent** -- reads always current |

### Token Construction
```python
# CORRECT token struct for pyodbc attrs_before
struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
```
**WARNING**: Do NOT use the `<IH...` variant -- it will fail silently.

### Auth Scope
Use `https://analysis.windows.net/powerbi/api/.default` -- NOT `https://database.windows.net/.default`.

### Dead Endpoints
The old endpoint `x6eps4powstuxhgxdjmpmo3fsa-...datawarehouse.fabric.microsoft.com` is DEAD. To get a fresh endpoint:
```
GET /v1/workspaces/{CONFIG_WS}/sqlDatabases/{DB_ID} --> .properties.connectionString
```

---

## Service Principal

| Property | Value |
|----------|-------|
| **Name** | Fabric-PowerBI-API |
| **Tenant ID** | `91741faf-f475-4266-95da-abc62bd69de6` |
| **App ID** | `ac937c5d-...` |
| **SP Object ID** | `6baf0291-1868-4867-82d2-eb8d077438ba` |
| **Workspace Role** | Contributor on `INTEGRATION CODE (D)` only |
| **Scope** | Operates via tenant-level admin (not per-workspace membership) |

---

## Connection IDs

| Connection | ID | Purpose |
|------------|----|---------|
| **CON_FMD_FABRIC_SQL** | `0f86f6a1-9f84-44d1-b977-105b5179c678` | Fabric SQL Database |
| **CON_FMD_FABRIC_PIPELINES** (V1) | `6b2e33a1-b441-4137-b41d-260ffa8258cf` | Pipeline orchestration (privacyLevel=None) |
| **CON_FMD_FABRIC_PIPELINES_V2** | `365d6ac6-...` | Pipeline orchestration (privacyLevel=Organizational) |
| **CON_FMD_FABRIC_NOTEBOOKS** | `f4d3220c-0cd3-4f76-9641-b4154e192645` | Notebook execution |
| **CON_FMD_ADF_PIPELINES** | `00000000-0000-0000-0000-000000000000` | Placeholder (not used) |

---

## Variable Libraries (CODE Workspace)

### VAR_FMD (`10118d5d-e1df-497b-87f3-d7dd420ff75b`)

| Variable | Type | Value |
|----------|------|-------|
| `key_vault_uri_name` | String | `""` |
| `lakehouse_schema_enabled` | String | `"true"` |

**Note**: Fabric API rejects Boolean type -- must use String with "true"/"false".

### VAR_CONFIG_FMD (`0eeeef3f-7ba6-4f5c-b9ce-f688718c31e4`)

| Variable | Value |
|----------|-------|
| `fmd_fabric_db_connection` | SQL endpoint URL |
| `fmd_fabric_db_name` | Full DB name with GUID suffix |
| `fmd_config_workspace_guid` | CONFIG workspace GUID |
| `fmd_config_database_guid` | DB item GUID |

---

## Pipeline IDs

| Pipeline | ID |
|----------|----|
| **PL_FMD_LOAD_ALL** | `e45418a4-148f-49d2-a30f-071a1c477ba9` |
| **PL_FMD_LOAD_LANDINGZONE** | `3d0b3b2b-...` |
| **PL_FMD_LOAD_BRONZE** | `8b7008ac-...` |
| **PL_FMD_LOAD_SILVER** | `90c0535c-...` |

### InvokePipeline Limitation
**Fabric limitation BY DESIGN**: `InvokePipeline` activity ignores Service Principal connection and uses "Pipeline Default Identity" (user token). When triggered via SP API, InvokePipeline chains fail with `BadRequest`.

**Workaround**: Use `scripts/run_load_all.py` -- a REST API orchestrator that triggers each pipeline directly via SP token instead of chaining via InvokePipeline.

---

## Deployment

### Method
Deployed via `deploy_from_scratch.py` (17-phase Python script), NOT via `NB_SETUP_FMD` notebook.

### Key Phases
| Phase | Action |
|-------|--------|
| 1 | Auth (SP token) |
| 2 | Capacity check |
| 3-4 | Workspaces + Connections |
| 5 | Lakehouses |
| 6 | SQL Database |
| 7 | Setup Notebook (schema/stored procs) |
| 8 | Variable Libraries |
| 9 | Pipelines (with GUID remapping) |
| 10-11 | SQL Metadata + Local Config |
| 13 | Entity Registration |
| 14 | Load Optimization (VPN required) |
| 15 | Workspace Icons |
| 16 | Entity Digest Engine |
| 17 | Validation |

### Post-Deployment Requirement
If pipelines are ever re-deployed from the repo, `fix_pipeline_guids.py` MUST be run again to remap cross-reference GUIDs.

---

## Remote Server (VSC-Fabric)

| Property | Value |
|----------|-------|
| **Dashboard URL (from server)** | `http://localhost:8787` |
| **Dashboard URL (from laptop)** | `http://vsc-fabric/` (requires VPN) |
| **Windows Auth** | `INTERPLASTIC\sasnahrup` |
| **RDP** | `vsc-fabric` with domain creds |
| **Project Path** | `C:\Projects\FMD_FRAMEWORK` |
| **Nexus** | `C:\Projects\nexus` (port 3777) |
| **Services** | `nssm status Nexus` / `nssm status FMD-Dashboard` |
| **IIS** | Reverse proxy port 80 --> localhost:8787 with Windows Auth |
| **Node Version** | Must be v22 LTS (v24 breaks better-sqlite3) |

---

## Related Files

- [fabric-migration-strategy.md](fabric-migration-strategy.md) -- Target architecture and medallion layers
- [systems/landscape.md](systems/landscape.md) -- Full system inventory with MCP connection mapping
