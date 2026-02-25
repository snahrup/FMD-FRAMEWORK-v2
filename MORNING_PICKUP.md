# FMD Framework — Morning Pickup Summary
**Date:** 2026-02-25 (Tuesday)
**Previous session:** frost-raven (Feb 24 evening)

---

## Where We Left Off

Dashboard polish round completed. Full pipeline load triggered by Steve at end of session. Waiting for results.

---

## What Was Accomplished (Evening of Feb 24)

### Entity Name Prefix Fix
- All 659 Bronze + Silver entities updated to use prefixed FileNames (e.g., `ETQ_Customers` not `Customers`)
- Registration code patched in both `register_entity()` and `register_bronze_silver()` so new entities always get the prefix
- Data Blender LZ display now shows FileName (prefixed) instead of raw SourceName
- Sort order across all three Blender layers now sorts by original table name for consistency

### Control Plane Overhaul
- **Backend**: Rewrote `_get_control_plane_live()` — pipeline runs now properly GROUP BY PipelineRunGuid with derived status from LogType patterns. Bronze/Silver entity counts join through LZ to DataSource for per-namespace totals. Lakehouses tagged DEV/PROD.
- **Frontend**: Complete rewrite of ControlPlane.tsx. Four tabs: Entity Metadata (default), Execution Log, Connections & Sources, Infrastructure. Entity Metadata shows all 659 entities with load type, watermark, PKs, Bronze/Silver registration, last load time. Search + source filter built in.
- **Source labels**: ALL dashboard source labels now use Namespace (ETQ, MES, M3C) instead of raw DB names (ETQ_STAGING_PRD, mes, DI_PRD_Staging). Fixed in `/api/entities` and `/api/load-config`.

### Data Journey Fixes
- Rewrote entity selector — was completely broken. CSS stacking context from `backdrop-blur-sm` trapped the dropdown z-index inside the header. Click-away overlay at z-40 was eating all clicks.
- New selector: proper combobox, ref-based click-outside detection, `max-h-[60vh]` scrollable, grouped by Namespace, shows prefixed FileNames.
- Profile Columns button now shows error message instead of blank screen when data hasn't loaded yet.

### Jira Updates
- MT-73 (Dashboard) → **Done** (all 6 subtasks closed)
- MT-78 (Production Bundling) → **Done** with 7h worklog
- MT-17 (Pipeline Testing) → Comment added about upcoming full pipeline test
- MT-82 (Load Optimization) was already Done

---

## What to Do First

### 1. Check Pipeline Results
Steve kicked off a full load last night. First thing to check:
- Open Dashboard → Control Plane → Execution Log tab
- Look for PL_FMD_LOAD_ALL / PL_FMD_LOAD_LANDINGZONE / PL_FMD_LOAD_BRONZE runs
- Check Fabric portal directly if no runs show in the dashboard

```bash
# Start dashboard if not running
cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python dashboard/app/api/server.py &
# Open http://localhost:8787
```

### 2. Validate Data in Lakehouses
If pipelines ran:
- Record Counts page should show table counts in LZ, Bronze, Silver
- Data Journey — select an ETQ entity, should show row counts at Bronze/Silver layers
- Profile Columns should work now with actual table data

### 3. Investigate "Last Load" Timestamps
The `execution.LandingzoneEntityLastLoadValue` table had timestamps from the Load Optimization Engine analysis (Feb 24 ~10:49 PM), NOT from actual pipeline runs. If the pipeline ran overnight, those timestamps should now reflect actual load times. If they still show the old values, the pipeline may not have completed successfully.

---

## Known Issues

1. **ETQ "last load" confusion**: The Load Optimization Engine wrote watermark analysis timestamps to `execution.LandingzoneEntityLastLoadValue` during source table analysis. This made it look like ETQ had already been loaded through the pipeline when it hadn't. Real pipeline execution will overwrite these values.

2. **M3 ERP (m3fdbprd)**: Not yet registered. Depends on gateway connection MT-31 (on-prem data gateway).

3. **CON_FMD_FABRIC_PIPELINES**: Uses WorkspaceIdentity (broken). Needs update to ServicePrincipal auth. See dashboard-debugging.md.

4. **Profile Columns**: Returns error for tables that don't exist yet in the lakehouse (expected until pipelines complete).

5. **Gold Layer**: Not implemented. Will come with MLV architecture (MT-19).

---

## Jira Board State

| Ticket | Status | Summary |
|--------|--------|---------|
| MT-12 | In Progress | Epic — Fabric Data Migration |
| MT-16 | In Progress | Source Registration (3/4 subtasks Done, M3 ERP pending) |
| MT-17 | **In Progress** | **ACTIVE** — LZ + Bronze Pipeline Testing |
| MT-73 | **Done** | Dashboard — all 6 subtasks closed |
| MT-82 | Done | Load Optimization Engine + Data Journey |
| MT-31 | Backlog | M3 ERP registration (last source) |
| MT-50 | Backlog | DQ & Cleansing Rules (parallel with pipeline testing) |
| MT-55 | Backlog | Production Cutover (deploy script ready) |

---

## Key Commands

```bash
# Start dashboard
cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python dashboard/app/api/server.py &

# Quick health check
curl http://localhost:8787/api/health

# Check pipeline execution history
curl http://localhost:8787/api/control-plane | python -c "import sys,json; d=json.load(sys.stdin); runs=d.get('recent_runs',[]); print(f'{len(runs)} pipeline runs'); [print(f'  {r[\"PipelineName\"]:40s} {r[\"status\"]:12s} {str(r.get(\"StartTime\",\"\")):25s}') for r in runs[:10]]"

# Check entity load status
curl "http://localhost:8787/api/load-config" | python -c "import sys,json; d=json.load(sys.stdin); loaded=[r for r in d if r.get('lastLoadTime')]; print(f'{len(loaded)}/{len(d)} entities have load timestamps')"

# Rebuild frontend after changes
cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app && npm run build
```

---

## Key Files Modified This Session

| File | What Changed |
|------|-------------|
| `dashboard/app/api/server.py` | Entity registration prefix fix, blender queries, control plane rewrite, load-config namespace |
| `dashboard/app/src/pages/ControlPlane.tsx` | Complete rewrite — Entity Metadata, Execution Log, Connections, Infrastructure tabs |
| `dashboard/app/src/pages/DataJourney.tsx` | Entity selector rewrite, profile error handling |
| `fix_entity_names.py` | One-time batch script that fixed 659 Bronze + Silver entity names (already ran) |
