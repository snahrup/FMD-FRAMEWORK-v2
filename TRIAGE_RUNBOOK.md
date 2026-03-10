# FMD Triage Runbook — Systematic Load Execution

> **Stop playing whack-a-mole. Follow this exact sequence.**

---

## Phase 0: Pre-Flight (Before ANY load)

### 0.1 Verify metadata paths are correct
```bash
python scripts/fix_entity_paths.py          # dry-run — see what's wrong
python scripts/fix_entity_paths.py --apply  # fix it
```

### 0.2 Verify OneLake files are in correct locations
```bash
python scripts/migrate_onelake_paths.py          # scan only
python scripts/migrate_onelake_paths.py --apply  # move files
```

### 0.3 Upload notebooks to Fabric
Every time you change a notebook locally, re-upload:
```bash
python scripts/upload_notebooks_to_fabric.py
```

### 0.4 Check dashboard is running
Open `http://localhost:8787` (local) or `http://vsc-fabric/` (remote).
Control Plane should show entity counts and active runs.

---

## Phase 1: Landing Zone Load

### 1.1 Trigger LZ load
Via engine API:
```bash
curl -X POST http://localhost:8787/api/engine/start -H "Content-Type: application/json" -d '{"layer": "landing"}'
```
Or via notebook (in Fabric portal):
- Run `NB_FMD_LOAD_LANDINGZONE_MAIN` with `DataSourceFilter = ""` (all sources)

### 1.2 Monitor
- Dashboard: Execution Log page shows per-entity status
- Engine API: `GET /api/engine/status`
- Engine logs: `GET /api/engine/logs/stream` (SSE)

### 1.3 Verify completeness
```sql
-- How many entities loaded successfully?
SELECT ds.Namespace, COUNT(*) AS Total,
       SUM(CASE WHEN ple.IsProcessed = 0 THEN 1 ELSE 0 END) AS Unprocessed,
       SUM(CASE WHEN ple.IsProcessed = 1 THEN 1 ELSE 0 END) AS Processed
FROM execution.PipelineLandingzoneEntity ple
JOIN integration.LandingzoneEntity le ON ple.LandingzoneEntityId = le.LandingzoneEntityId
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
GROUP BY ds.Namespace
```

### 1.4 Handle failures
- Check dashboard Execution Log for specific errors
- Common issues: VPN down, source server unreachable, table schema changed
- Fix the issue, then re-run. The framework is idempotent — re-running is safe.

### 1.5 Gate: DO NOT proceed to Bronze until LZ is >95% complete

---

## Phase 2: Bronze Load

### 2.1 Pre-check: LZ files exist at correct paths
```sql
-- Which entities have unprocessed LZ files ready for Bronze?
SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity WHERE IsProcessed = 0
```

### 2.2 Trigger Bronze
Via Fabric pipeline:
```bash
python scripts/run_load_all.py --layer bronze
```
Or trigger `PL_FMD_LOAD_BRONZE` via Fabric REST API.

### 2.3 Monitor
- Dashboard: Execution Matrix shows Bronze status per entity
- Look for FILE_NOT_FOUND errors = path mismatch between LZ and Bronze

### 2.4 Verify
```sql
-- Check Bronze Delta tables exist
SELECT ds.Namespace, COUNT(*) AS BronzeEntities
FROM execution.PipelineBronzeLayerEntity pbe
JOIN integration.BronzeLayerEntity be ON pbe.BronzeLayerEntityId = be.BronzeLayerEntityId
JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId
JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
GROUP BY ds.Namespace
```

### 2.5 Gate: DO NOT proceed to Silver until Bronze is >95% complete

---

## Phase 3: Silver Load

### 3.1 Trigger Silver
```bash
python scripts/run_load_all.py --layer silver
```

### 3.2 Monitor + Verify
Same pattern as Bronze. Check dashboard Silver columns.

---

## Debugging Checklist

When something fails, check IN THIS ORDER:

1. **VPN connected?** (source servers need VPN)
2. **Metadata paths correct?** Run `fix_entity_paths.py` dry-run
3. **Files actually exist on OneLake?** Check dashboard Data Journey or OneLake browser
4. **Notebook uploaded?** After local changes, must re-upload to Fabric
5. **GUIDs match?** Check `config/item_config.yaml` against actual Fabric workspace
6. **SP token valid?** Token expires hourly — engine refreshes automatically but check if stuck
7. **Throttling?** Fabric SQL 429 errors mean too many concurrent requests. Reduce batch_size.

---

## Key Dashboard Pages for Monitoring

| Page | What it shows | When to use |
|------|--------------|-------------|
| **Control Plane** | Entity counts by layer, active runs | Overall health check |
| **Execution Log** | Per-entity status with errors | Debugging specific failures |
| **Execution Matrix** | Grid view: entity x layer status | Spot patterns (e.g., all MES failed) |
| **Engine Control** | Engine v3 status, start/stop | Managing engine runs |
| **Live Monitor** | Real-time SSE feed | Watching a run in progress |
| **Data Journey** | Single entity's path through layers | Deep-dive on one entity |
| **Source Manager** | Entity registration and config | Verifying metadata |

---

## The #1 Rule

**If you change a notebook locally, you MUST upload it to Fabric before it takes effect.**

Local files are the source of truth for version control.
Fabric has the runtime copy. They can diverge if you forget to upload.

---

*Created: 2026-03-05*
