# AUDIT: TransformationReplay.tsx

**File**: `dashboard/app/src/pages/TransformationReplay.tsx` (857 lines)
**Audited**: 2026-03-13
**Verdict**: PASS — correct data source usage with two caveats

---

## Page Overview

Transformation Replay is a visual walkthrough of the 13 transformation steps data undergoes as it moves through Landing Zone, Bronze, and Silver layers. It displays a static step list enriched with optional per-entity "microscope" data.

---

## Data Sources

### 1. Entity Digest (via `useEntityDigest` hook)

| What | Detail |
|------|--------|
| **Hook** | `useEntityDigest()` from `@/hooks/useEntityDigest` |
| **API call** | `GET /api/entity-digest` |
| **Backend handler** | `routes/entities.py → get_entity_digest()` |
| **SQLite queries** | `get_registered_entities_full()` — JOINs `lz_entities`, `datasources`, `connections` |
| | `get_entity_status_all()` — `SELECT * FROM entity_status` |
| | `get_bronze_view()` — JOINs `bronze_entities`, `lz_entities`, `datasources`, `pipeline_bronze_entity` |
| | `get_silver_view()` — JOINs `silver_entities`, `bronze_entities`, `lz_entities`, `datasources` |
| | `get_sync_watermark()` — `SELECT value FROM sync_metadata WHERE key = 'last_sync'` |
| **Used for** | Entity selector dropdown (`allEntities`), selected entity display |
| **Fields consumed** | `id`, `tableName`, `sourceSchema`, `source` |
| **Correctness** | PASS — all fields map correctly to SQLite columns |

### 2. Microscope API (optional, per-entity+PK)

| What | Detail |
|------|--------|
| **Frontend call** | `fetch(\`${API}/api/microscope?entity=${entityId}&pk=${pk}\`)` (line 496) |
| **Backend route** | **DOES NOT EXIST** — no `/api/microscope` route registered in any route module |
| **Impact** | When a user selects an entity AND enters a primary key value, this fetch fires and will return HTTP 404 |
| **Severity** | LOW — the page catches the error gracefully (`microscopeError` state), displays an error banner, and the 13-step replay still renders fully with static data |

### 3. Static Step Data (hardcoded)

| What | Detail |
|------|--------|
| **Source** | `REPLAY_STEPS` constant (lines 87-222) — 13 hardcoded step objects |
| **Contains** | Step ID, layer, title, notebook name, operation, icon, description, technical detail, columns added, impact type |
| **Accuracy** | The steps accurately describe the actual Bronze/Silver notebook logic (column sanitization, PK hash, dedup, cleansing, change detection, SCD2 merge, etc.) |
| **Correctness** | PASS — no database dependency, purely descriptive |

---

## KPIs and Metrics

| Metric | Source | Correct? |
|--------|--------|----------|
| Step counter (`currentStep` / 13) | Computed from scroll position via GSAP ScrollTrigger | PASS — purely UI |
| Layer summary counts | Computed from `REPLAY_STEPS` constant | PASS |
| Progress bar | Scroll position percentage | PASS — purely UI |

---

## Issues Found

### BUG: `/api/microscope` endpoint does not exist

- **Location**: Line 496 — `fetch(\`${API}/api/microscope?entity=${entityId}&pk=${pk}\`)`
- **Status**: The route `/api/microscope` is not registered in any route module under `dashboard/app/api/routes/`. It existed in the old monolithic `server.py.bak` but was never migrated to the new router.
- **Impact**: Attempting to use the microscope feature (select entity + enter PK) will always fail with 404. The page handles this gracefully with an error banner.
- **Recommendation**: Either migrate the microscope handler from `server.py.bak` or add a stub route that returns `{"error": "Microscope not yet available"}` with a 501 status.

---

## Summary

The page is primarily a visual/educational tool. Its only real data dependency is the entity digest (for the entity selector), which is correctly wired. The microscope feature is broken due to a missing backend route, but failure is handled gracefully. No data correctness issues with displayed metrics.
