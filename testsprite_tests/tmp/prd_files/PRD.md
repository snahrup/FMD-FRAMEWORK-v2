# FMD Framework — Complete All 4 Sources Across LZ/Bronze/Silver

## Context
Read `memory/bronze-pipeline-debugging.md` FIRST for full context on auth patterns, root causes, and current state.

**Auth pattern (ALWAYS use this — NEVER azure.identity):**
```python
import urllib.request, urllib.parse, json, struct, pyodbc
TENANT = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
def get_token(scope):
    data = urllib.parse.urlencode({"grant_type":"client_credentials","client_id":CLIENT,"client_secret":SECRET,"scope":scope}).encode()
    req = urllib.request.Request(f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token", data=data)
    return json.loads(urllib.request.urlopen(req).read())["access_token"]
# SQL: scope = "https://analysis.windows.net/powerbi/api/.default"
# Fabric API: scope = "https://api.fabric.microsoft.com/.default"
SQL_SERVER = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
SQL_DB = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"
CODE_WS = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"
DATA_WS = "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a"
```

**Pipeline trigger pattern:**
```python
token = get_token("https://api.fabric.microsoft.com/.default")
url = f"https://api.fabric.microsoft.com/v1/workspaces/{CODE_WS}/items/{PIPELINE_ID}/jobs/instances?jobType=Pipeline"
req = urllib.request.Request(url, data=b'{}', method="POST", headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
resp = urllib.request.urlopen(req)
job_url = resp.headers.get("Location")  # poll this URL for status
```

**Pipeline poll pattern:**
```python
# Poll job_url every 30s until status != "InProgress"
req = urllib.request.Request(job_url, headers={"Authorization": f"Bearer {token}"})
status = json.loads(urllib.request.urlopen(req).read()).get("status")
# "Completed" = success, "Failed" = check failureReason
```

## Tasks

- [ ] **TASK 1: Check M3 ERP LZ Pipeline Status and Complete Loading.** Query the Fabric API to check if the M3 ERP LZ pipeline (job bcb5d0c6-a77c-41a3-8644-457b60e51cd2 in workspace 146fe38c) has completed. Also query SQL: `SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity PLE INNER JOIN integration.LandingzoneEntity LE ON PLE.LandingzoneEntityId = LE.LandingzoneEntityId WHERE LE.DataSourceId = 6`. If less than 596: trigger a new LZ pipeline run (pipeline ID 3d0b3b2b) and poll every 60 seconds until it completes or you reach 596/596. Use OneLake Files API to verify files exist in the LZ lakehouse (2aef4ede) under Files/m3fdbprd/. DONE when SQL count = 596 AND pipeline status = Completed. Save all findings to memory/bronze-pipeline-debugging.md.

- [ ] **TASK 2: Reactivate ALL deactivated LZ entities.** Run SQL: `UPDATE integration.LandingzoneEntity SET IsActive = 1 WHERE IsActive = 0`. Verify with: `SELECT DataSourceId, COUNT(*), SUM(CASE WHEN IsActive=1 THEN 1 ELSE 0 END) as Active FROM integration.LandingzoneEntity GROUP BY DataSourceId`. ALL 1255 entities (DS4=445, DS5=29, DS6=596, DS7=185) must show IsActive=1. DONE when all entities active.

- [ ] **TASK 3: Fix MES incremental load type mismatch (Root Cause 12).** Query: `SELECT LE.LandingzoneEntityId, LE.Name, LLV.LoadValue, LE.IncrementalLoadColumn FROM integration.LandingzoneEntity LE JOIN integration.LastLoadValue LLV ON LE.LandingzoneEntityId = LLV.LandingzoneEntityId WHERE LE.DataSourceId = 4 AND LE.IncrementalLoadType = 'Incremental' AND LLV.LoadValue LIKE '202%-%-%'` to find MES entities with datetime LoadValues on INT columns. Fix: `UPDATE LLV SET LoadValue = '0' FROM integration.LastLoadValue LLV JOIN integration.LandingzoneEntity LE ON LLV.LandingzoneEntityId = LE.LandingzoneEntityId WHERE LE.DataSourceId = 4 AND LLV.LoadValue LIKE '202%-%-%'`. Verify zero rows returned by the diagnostic query after fix. DONE when all broken LoadValues reset to '0'.

- [ ] **TASK 4: Run Bronze pipeline for ALL sources including M3 ERP.** Trigger Bronze pipeline (8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3) in workspace 146fe38c. Poll every 60 seconds until completed. Monitor via SQL: `SELECT ds.Name, COUNT(*) as Total, SUM(CASE WHEN PBLE.IsProcessed=1 THEN 1 ELSE 0 END) as Processed FROM execution.PipelineBronzeLayerEntity PBLE JOIN integration.BronzeLayerEntity BLE ON PBLE.BronzeLayerEntityId = BLE.BronzeLayerEntityId JOIN integration.LandingzoneEntity LE ON BLE.LandingzoneEntityId = LE.LandingzoneEntityId JOIN integration.DataSource ds ON LE.DataSourceId = ds.DataSourceId GROUP BY ds.Name`. After pipeline completes, verify M3 ERP has Bronze tables via OneLake Tables API on Bronze lakehouse (cf57e8bf). DONE when pipeline Completed and M3 ERP shows 590+ Bronze tables (some may be empty source tables). Save timing and counts to memory/bronze-pipeline-debugging.md.

- [ ] **TASK 5: Run Silver pipeline for ALL sources including M3 ERP.** Trigger Silver pipeline (90c0535c-c5dc-43a3-b51e-c44ef1808a60) in workspace 146fe38c. Poll every 60 seconds until completed. Monitor via SQL similar to Task 4 but for Silver entities. After pipeline completes, verify M3 ERP has Silver tables via OneLake Tables API on Silver lakehouse (44a0993f). DONE when pipeline Completed and M3 ERP shows 590+ Silver tables. Save timing and counts to memory/bronze-pipeline-debugging.md.

- [ ] **TASK 6: Fix 3 missing MES Bronze/Silver entities.** The 3 stuck MES entities (BLE IDs 310, 426, 1048) need IsProcessed reset. Run: `UPDATE execution.PipelineBronzeLayerEntity SET IsProcessed = 0, LoadEndDateTime = NULL WHERE BronzeLayerEntityId IN (310, 426, 1048)`. Verify the entities are now in `vw_LoadToBronzeLayer` view. Then re-trigger Bronze pipeline (8b7008ac) and poll until complete. After Bronze, re-trigger Silver pipeline (90c0535c) and poll until complete. DONE when all 3 entities have IsProcessed=1 in both Bronze and Silver execution tables.

- [ ] **TASK 7: Fix Silver dashboard display bug.** The view `vw_LoadToSilverLayer` returns 0 rows because it filters `WHERE PBLE.IsProcessed = 0` which excludes all completed entities. Either: (A) Create `execution.PipelineSilverLayerEntity` table mirroring the Bronze pattern and populate it from Silver execution data, OR (B) Modify the dashboard API (dashboard/app/api/server.py) to query Silver table counts directly from OneLake or from a new view that doesn't filter on IsProcessed. Choose whichever approach is simpler. DONE when the dashboard Silver layer shows accurate non-zero counts for all 4 sources.

- [ ] **TASK 8: Final verification — all 4 sources × 3 layers.** Write and run a comprehensive verification script that checks: (1) SQL metadata counts for all LZ/Bronze/Silver entities per source, (2) OneLake file/table counts in each lakehouse for each source namespace, (3) IsActive=1 for all entities, (4) No orphaned or stuck entities (IsProcessed=0 with no active pipeline). Output a final summary table. Expected final state: MES=445, ETQ=29, M3_ERP=596, M3_Cloud=185 = 1255 total across all 3 layers. DONE when verification passes with all counts matching or with documented explanations for any gaps (e.g., empty source tables). Update memory/bronze-pipeline-debugging.md with FINAL STATUS.
