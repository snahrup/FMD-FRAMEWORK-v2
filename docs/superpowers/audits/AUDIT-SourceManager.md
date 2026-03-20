# Page Truth Audit: SourceManager

**Date:** 2026-03-19
**Auditor:** bright-falcon
**Route:** `/sources`
**Health:** 🟡 Fragile

---

## 1. Purpose

> Central hub for data source lifecycle: view registered entities, onboard new sources via 3-step wizard, optimize load strategy, delete entities.

**Primary user jobs:**
1. See what's registered — entities grouped by data source, active/inactive, incremental/full
2. Onboard a new source — 3-step wizard (Configure → Select Tables → Import)
3. Optimize load strategy — discover PKs, watermarks, switch full-to-incremental
4. Delete entities — single or bulk with cascade impact preview

---

## 2. File Map

| Role | File | Lines |
|------|------|-------|
| Page component | `dashboard/app/src/pages/SourceManager.tsx` | 1,642 |
| Wizard component | `dashboard/app/src/components/sources/SourceOnboardingWizard.tsx` | 1,700 |
| API route | `dashboard/app/api/routes/source_manager.py` | 982 |
| Cross-deps | `routes/entities.py`, `routes/control_plane.py`, `routes/engine.py`, `routes/pipeline.py` | — |

---

## 3. Backend Dependencies

| Endpoint | Method | Data Source | Status |
|----------|--------|-------------|--------|
| `/api/gateway-connections` | GET | — | ❌ **MISSING — no backend route** |
| `/api/connections` | GET | SQLite `connections` | ✅ Real |
| `/api/connections` | POST | — | ❌ **MISSING — no backend route** |
| `/api/datasources` | GET | SQLite `datasources` | ✅ Real |
| `/api/datasources` | POST | SQLite `datasources` | ✅ Real |
| `/api/onboarding` | GET/POST | SQLite `SourceOnboarding` | ✅ Real |
| `/api/onboarding/step` | POST | SQLite `SourceOnboarding` | ✅ Real |
| `/api/sources/purge` | POST | SQLite cascade delete | ✅ Real |
| `/api/sources/import` | POST | Background thread | ⚠️ Partial — phases 2-5 are stubs |
| `/api/sources/import/{id}` | GET | In-memory `_import_jobs` | ✅ Real |
| `/api/sources/import/{id}/stream` | GET (SSE) | In-memory events | ✅ Real |
| `/api/source-tables` | POST | On-prem SQL (VPN) | ✅ Real |
| `/api/register-bronze-silver` | POST | SQLite | ✅ Real |
| `/api/source-manager/discover-all` | POST | On-prem SQL + SQLite | ⚠️ Type filter bug |
| `/api/analyze-source` | GET | On-prem SQL | ⚠️ **Response shape mismatch** |
| `/api/load-config` | GET/POST | SQLite | ✅ Real |
| `/api/entities/cascade-impact` | GET | SQLite | ✅ Real |
| `/api/entities/{id}` | DELETE | SQLite cascade | ✅ Real |
| `/api/entities/bulk-delete` | POST | SQLite cascade | ✅ Real |
| `/api/engine/optimize-all` | POST | On-prem SQL + SQLite | ✅ Real |

### External Dependencies
- [x] Requires VPN (on-prem ODBC) — for source-tables, discover-all, analyze-source, optimize-all
- [x] Requires Fabric token — for pipeline trigger
- [ ] Requires engine running
- [ ] Requires OneLake mount
- Partially SQLite only (entity CRUD, load config)

---

## 4. Data Contracts

### `/api/gateway-connections` — MISSING
Frontend calls this at line 381. No route exists. `gatewayConnections` is always `[]`.

### `/api/analyze-source` — SHAPE MISMATCH
**Frontend expects:**
```json
{
  "summary": { "total": N, "incrementalRecommended": N, "hasPrimaryKeys": N, ... },
  "entities": [{ "entityId": N, "primaryKeys": [...], "recommendedLoad": "..." }]
}
```
**Backend returns:**
```json
{ "datasourceId": N, "tablesAnalyzed": N, "server": "..." }
```
Frontend reads `result.summary.total` → `undefined`.

---

## 5. State Matrix

| State | Trigger | Handled? | What renders |
|-------|---------|----------|-------------|
| Loading | Initial fetch | ✅ | Full-page spinner |
| Error | API failure | ✅ | Error page with retry + "start API server" instructions |
| Empty | No entities | ✅ | "No entities registered yet" with onboard prompt |
| Success | Data loaded | ✅ | Normal render |
| Partial | Gateway fails | ⚠️ | Silent — gateway section just empty, no error |
| Stale | 30s digest TTL | ✅ | Auto-refresh with subtle spinner |
| Offline (VPN) | ODBC fails | ⚠️ | Connection error messages on specific actions only |

---

## 6. Real vs Stubbed Behavior

| Feature | Classification | Evidence |
|---------|---------------|----------|
| Entity Registry (view/search/expand) | 🟢 Real and working | Uses digest hook, entities grouped by source |
| Entity delete (single + bulk) | 🟢 Real and working | Cascade impact preview, backend DELETE |
| Load Config (view + edit) | 🟢 Real and working | SQLite CRUD, inline dropdowns |
| Analyze Source | 🟠 Stub / simulated | Backend returns minimal stub, frontend shows `undefined` values |
| Optimize All | 🟢 Real and working | Engine PK/watermark discovery |
| Discover & Register | 🟢 Real and working | But has Type filter bug (`SQL` vs `SqlServer`) |
| Gateway Connections | 🔴 Broken | No backend endpoint |
| Register Connection | 🔴 Broken | No POST endpoint |
| Wizard Step 1 | 🔴 Broken | Depends on missing gateway/connection endpoints |
| Wizard Step 2 | 🟢 Real and working | Live SQL connection, bulk registration |
| Wizard Step 3 (Import) | 🟠 Stub / simulated | Phases 2-5 fake progress, no pipelines triggered |
| Source purge | 🟢 Real and working | Cascade delete |

### Misleading UI

1. **Connections KPI card** — Always shows 0 (endpoint missing)
2. **"Register" button** — 404s silently
3. **Analyze Source status** — Shows `undefined` values
4. **Import progress bar** — Advances to 100% in ~1s with no data movement
5. **"Source Rows" column** — Always shows `--`
6. **Import complete message** — Says processing started but nothing happened
7. **"View Import Progress" link** — Goes to `/` (root) not a monitoring page
8. **Wizard "Setup Required" fallback** — References deleted script

---

## 7. Mutation Flows

| Action | Endpoint | Method | Validation | Risk |
|--------|----------|--------|------------|------|
| Register connection | POST /api/connections | POST | N/A | **404 — endpoint missing** |
| Register datasource | POST /api/datasources | POST | Idempotent | Low |
| Bulk register entities | BackgroundTaskContext | POST | Per-entity try/catch | Medium |
| Start import | POST /api/sources/import | POST | Background thread | **HIGH — phases 2-5 stub** |
| Purge source | POST /api/sources/purge | POST | `window.confirm` only | **HIGH — irreversible** |
| Delete entity | DELETE /api/entities/{id} | DELETE | Cascade preview | Medium |
| Save load config | POST /api/load-config | POST | Sanitized | Low |

---

## 8. Root-Cause Bug Clusters

### Cluster A: Missing Gateway/Connection Infrastructure
Backend routes for `/api/gateway-connections` and `POST /api/connections` were never built.
- **Impact:** 4 features broken (gateway display, connection register, wizard Step 1 database picker, wizard Step 1 auto-registration)
- **Fix:** Implement 2 endpoints or create SQLite seed

### Cluster B: Import Pipeline is a Stub
`_run_source_import` cycles through phase labels without triggering pipelines.
- **Impact:** Step 3 Import fakes completion, no data moves
- **Fix:** Wire phases 2-5 to actual pipeline triggers

### Cluster C: Analyze Source Response Mismatch
Backend returns minimal stub, frontend expects rich analysis.
- **Impact:** `undefined` values in status messages
- **Fix:** Implement full analysis or strip frontend expectations

### Cluster D: discover-all Type Filter Bug
Queries `WHERE c.Type = 'SQL'` but wizard registers `type: 'SqlServer'`.
- **Impact:** discover-all may find no connections
- **Fix:** `IN ('SQL', 'SqlServer')`

### Cluster E: Import Job Memory Leak
`_import_jobs` dict grows forever, no TTL.
- **Impact:** Low now, unbounded growth long-term
- **Fix:** TTL-based eviction

---

## 9. Minimal Repair Order

| Priority | Fix | Cluster | Effort | Impact |
|----------|-----|---------|--------|--------|
| 1 | Add `GET /api/gateway-connections` + `POST /api/connections` | A | M | Critical |
| 2 | Wire import phases 2-5 to actual pipeline triggers | B | L | Critical |
| 3 | Fix analyze-source response shape | C | S | High |
| 4 | Fix discover-all Type filter | D | S | Medium |
| 5 | Fix "View Import Progress" link → `/load-center` | B | S | Low |
| 6 | Remove deleted script reference | B | S | Low |
| 7 | Add import job TTL cleanup | E | S | Low |

---

## 10. Proposed Packet Sequence

### Packet A: Truth & Alignment
- [ ] Implement `GET /api/gateway-connections` (Fabric REST API or SQLite seed)
- [ ] Implement `POST /api/connections` (SQLite INSERT)
- [ ] Fix analyze-source response to match frontend expectations
- [ ] Fix discover-all Type filter (`IN ('SQL', 'SqlServer')`)

### Packet B: Page Shell
- [ ] Wire import phases 2-5 to real pipeline triggers
- [ ] Add pipeline completion polling in import thread
- [ ] Fix "View Import Progress" link → `/load-center`
- [ ] Remove deleted script reference

### Packet C: Core Workflows
- [ ] Populate "Source Rows" in Load Config
- [ ] Fix Incremental KPI to load on mount
- [ ] Add import job TTL cleanup

### Packet D: Hardening & Polish
- [ ] Rate-limit source-tables/discover-all (prevent concurrent VPN hammering)
- [ ] Better purge confirmation (show entity counts, not just `window.confirm`)
- [ ] SSE reconnect logic for import streaming
- [ ] Persist import jobs to SQLite (survive server restart)

---

## 11. Verification Checklist

- [ ] All API endpoints return real data (not mock/stub)
- [ ] Loading, error, and empty states render correctly
- [ ] Page works with 0 entities, 1 entity, and 1000+ entities
- [ ] No console errors or unhandled promise rejections
- [ ] Navigation to/from page works correctly
- [ ] Data matches API response (no transformation bugs)
- [ ] Mutations have confirmation dialogs where appropriate
- [ ] Page purpose matches what census says it should do
- [ ] No misleading UI elements remain
