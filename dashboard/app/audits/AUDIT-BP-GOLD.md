# AUDIT-BP-GOLD: Business Portal + Gold Studio Forensic Audit

**Phase**: V2 Whole-App Forensic Audit, Phase 1
**Session**: BP-GOLD
**Date**: 2026-04-08
**Scope**: 11 pages + shared Gold Studio infrastructure
**Protocol**: READ-ONLY truth audit -- no code changes

---

## Surface Inventory

| ID | Page | Route | Disposition | Backend | Lines |
|----|------|-------|------------|---------|-------|
| BP-002 | BusinessAlerts | `/alerts` | SUPERSEDE_AND_REPLACE | `alerts.py` | 637 |
| BP-003 | BusinessSources | `/sources-portal` | AUDIT_NORMALLY | `source_manager.py`, `overview.py` | ~630 |
| BP-004 | BusinessCatalog | `/catalog-portal` | VERIFY_AND_EXTEND | `glossary.py`, `quality.py`, `overview.py` | ~730 |
| BP-005 | DatasetDetail | `/catalog-portal/:id` | AUDIT_NORMALLY | `glossary.py`, `quality.py`, `overview.py` | ~680 |
| BP-006 | BusinessRequests | `/requests` | VERIFY_AND_EXTEND | `requests.py` | ~596 |
| BP-007 | BusinessHelp | `/help` | AUDIT_NORMALLY | none (static) | ~370 |
| GS-001 | GoldLedger | `/gold/ledger` | VERIFY_AND_EXTEND | `gold_studio.py` | ~1300 |
| GS-002 | GoldClusters | `/gold/clusters` | AUDIT_NORMALLY | `gold_studio.py` | ~790 |
| GS-003 | GoldCanonical | `/gold/canonical` | VERIFY_AND_EXTEND | `gold_studio.py` | ~760 |
| GS-004 | GoldSpecs | `/gold/specs` | VERIFY_AND_EXTEND | `gold_studio.py` | ~479 |
| GS-005 | GoldValidation | `/gold/validation` | AUDIT_NORMALLY | `gold_studio.py` | ~1400 |
| SHARED | GoldStudioLayout | (wrapper) | AUDIT_NORMALLY | `gold_studio.py` | ~290 |
| SHARED | SpecimenCard | (component) | AUDIT_NORMALLY | `gold_studio.py` | ~830 |

---

## Gold Studio Backend Endpoint Map (71 `@route` decorators)

### Complete Endpoint Inventory

| # | Method | Path | Group | Used By |
|---|--------|------|-------|---------|
| 1 | POST | `/api/gold-studio/specimens` | Specimens | GoldLedger |
| 2 | GET | `/api/gold-studio/specimens` | Specimens | GoldLedger |
| 3 | GET | `/api/gold-studio/specimens/{id}` | Specimens | GoldLedger |
| 4 | PUT | `/api/gold-studio/specimens/{id}` | Specimens | **ORPHAN** |
| 5 | DELETE | `/api/gold-studio/specimens/{id}` | Specimens | GoldLedger |
| 6 | POST | `/api/gold-studio/specimens/{id}/extract` | Specimens | GoldLedger |
| 7 | GET | `/api/gold-studio/specimens/{id}/queries` | Specimens | SpecimenCard |
| 8 | POST | `/api/gold-studio/specimens/bulk` | Specimens | GoldLedger |
| 9 | GET | `/api/gold-studio/entities` | Entities | GoldLedger |
| 10 | GET | `/api/gold-studio/entities/{id}` | Entities | GoldClusters |
| 11 | GET | `/api/gold-studio/entities/{id}/columns` | Entities | SpecimenCard |
| 12 | GET | `/api/gold-studio/entities/{id}/schema` | Entities | **ORPHAN** |
| 13 | POST | `/api/gold-studio/entities/{id}/discover-schema` | Entities | **ORPHAN** |
| 14 | GET | `/api/gold-studio/clusters` | Clusters | GoldClusters |
| 15 | GET | `/api/gold-studio/clusters/{id}` | Clusters | GoldClusters |
| 16 | PUT | `/api/gold-studio/clusters/{id}` | Clusters | GoldClusters |
| 17 | POST | `/api/gold-studio/clusters/{id}/resolve` | Clusters | GoldClusters |
| 18 | GET | `/api/gold-studio/clusters/{id}/column-decisions` | Clusters | **MISMATCH** (GoldClusters calls `/columns` not `/column-decisions`) |
| 19 | PUT | `/api/gold-studio/clusters/{id}/column-decisions` | Clusters | **MISMATCH** |
| 20 | POST | `/api/gold-studio/clusters/detect` | Clusters | **ORPHAN** |
| 21 | GET | `/api/gold-studio/clusters/unclustered` | Clusters | GoldClusters |
| 22 | GET | `/api/gold-studio/canonical` | Canonical | GoldCanonical |
| 23 | GET | `/api/gold-studio/canonical/{id}` | Canonical | GoldCanonical |
| 24 | POST | `/api/gold-studio/canonical` | Canonical | **ORPHAN** |
| 25 | PUT | `/api/gold-studio/canonical/{id}` | Canonical | **ORPHAN** |
| 26 | POST | `/api/gold-studio/canonical/{id}/approve` | Canonical | GoldCanonical |
| 27 | POST | `/api/gold-studio/canonical/{id}/generate-spec` | Canonical | GoldCanonical |
| 28 | GET | `/api/gold-studio/canonical/{id}/versions` | Canonical | **ORPHAN** |
| 29 | GET | `/api/gold-studio/canonical/domains` | Canonical | GoldCanonical |
| 30 | GET | `/api/gold-studio/canonical/relationships` | Canonical | GoldCanonical |
| 31 | GET | `/api/gold-studio/semantic` | Semantic | GoldCanonical |
| 32 | POST | `/api/gold-studio/semantic` | Semantic | **ORPHAN** |
| 33 | PUT | `/api/gold-studio/semantic/{id}` | Semantic | **ORPHAN** |
| 34 | DELETE | `/api/gold-studio/semantic/{id}` | Semantic | **ORPHAN** |
| 35 | GET | `/api/gold-studio/specs` | Specs | GoldSpecs, GoldValidation |
| 36 | GET | `/api/gold-studio/specs/{id}` | Specs | GoldSpecs |
| 37 | PUT | `/api/gold-studio/specs/{id}` | Specs | **ORPHAN** |
| 38 | PUT | `/api/gold-studio/specs/{id}/sql` | Specs | **ORPHAN** |
| 39 | GET | `/api/gold-studio/specs/{id}/versions` | Specs | GoldSpecs |
| 40 | GET | `/api/gold-studio/specs/{id}/impact` | Specs | GoldSpecs |
| 41 | POST | `/api/gold-studio/validation/specs/{id}/validate` | Validation | GoldValidation |
| 42 | GET | `/api/gold-studio/validation/specs/{id}/runs` | Validation | GoldSpecs, GoldValidation |
| 43 | GET | `/api/gold-studio/validation/runs/{id}` | Validation | **ORPHAN** |
| 44 | POST | `/api/gold-studio/validation/runs/{id}/waiver` | Validation | GoldValidation |
| 45 | GET | `/api/gold-studio/validation/specs/{id}/reconciliation` | Validation | **ORPHAN** |
| 46 | POST | `/api/gold-studio/catalog/specs/{id}/publish` | Catalog | GoldValidation |
| 47 | GET | `/api/gold-studio/catalog` | Catalog | GoldValidation |
| 48 | GET | `/api/gold-studio/catalog/{id}` | Catalog | GoldValidation |
| 49 | PUT | `/api/gold-studio/catalog/{id}` | Catalog | GoldValidation |
| 50 | GET | `/api/gold-studio/catalog/{id}/versions` | Catalog | GoldValidation |
| 51 | GET | `/api/gold-studio/jobs/{id}` | Jobs | **ORPHAN** |
| 52 | GET | `/api/gold-studio/jobs` | Jobs | **ORPHAN** |
| 53 | GET | `/api/gold-studio/audit/log` | Audit | GoldCanonical |
| 54 | GET | `/api/gold-studio/stats` | Stats | GoldLedger, GoldClusters, GoldCanonical, GoldSpecs, GoldValidation |
| 55 | GET | `/api/gold-studio/field-usage` | Field Usage | **ORPHAN** |
| 56 | GET | `/api/gold-studio/domains` | Domains | GoldStudioLayout |
| 57 | POST | `/api/gold-studio/domains` | Domains | **ORPHAN** |
| 58 | PUT | `/api/gold-studio/domains/{id}` | Domains | **ORPHAN** |
| 59 | GET | `/api/gold-studio/domains/{id}` | Domains | GoldStudioLayout |
| 60 | GET | `/api/gold-studio/report-coverage/summary` | Coverage | **ORPHAN** |
| 61 | GET | `/api/gold-studio/report-coverage` | Coverage | GoldValidation |
| 62 | POST | `/api/gold-studio/report-coverage` | Coverage | GoldValidation |
| 63 | GET | `/api/gold-studio/report-coverage/{id}` | Coverage | GoldValidation |
| 64 | PUT | `/api/gold-studio/report-coverage/{id}` | Coverage | GoldValidation |
| 65 | DELETE | `/api/gold-studio/report-coverage/{id}` | Coverage | **ORPHAN** |
| 66 | GET | `/api/gold-studio/source-systems` | Misc | **ORPHAN** |
| 67 | POST | `/api/gold-studio/specimens/{id}/preview` | Specimens | SpecimenCard |
| 68 | POST | `/api/gold-studio/specimens/{id}/live-describe` | Specimens | **ORPHAN** |
| 69 | POST | `/api/gold-studio/auto-detect` | Misc | GoldLedger |

### Endpoint Summary

- **Total endpoints**: 71 (69 unique paths, 2 with GET+PUT dual registration)
- **Used by frontend**: 44 endpoints
- **ORPHANED (no frontend caller)**: 25 endpoints
- **MISMATCHED (wrong path called)**: 2 endpoints (column-decisions)

### Orphaned Endpoints (25)

These backend endpoints have no frontend caller in any audited Gold or Business page:

1. `PUT /api/gold-studio/specimens/{id}` -- update specimen metadata
2. `GET /api/gold-studio/entities/{id}/schema` -- entity schema
3. `POST /api/gold-studio/entities/{id}/discover-schema` -- schema discovery
4. `POST /api/gold-studio/clusters/detect` -- auto-detect clusters
5. `POST /api/gold-studio/canonical` -- create canonical entity
6. `PUT /api/gold-studio/canonical/{id}` -- update canonical entity
7. `GET /api/gold-studio/canonical/{id}/versions` -- canonical version history
8. `POST /api/gold-studio/semantic` -- create semantic definition
9. `PUT /api/gold-studio/semantic/{id}` -- update semantic definition
10. `DELETE /api/gold-studio/semantic/{id}` -- delete semantic definition
11. `PUT /api/gold-studio/specs/{id}` -- update spec
12. `PUT /api/gold-studio/specs/{id}/sql` -- update spec SQL
13. `GET /api/gold-studio/validation/runs/{id}` -- single validation run detail
14. `GET /api/gold-studio/validation/specs/{id}/reconciliation` -- reconciliation data
15. `GET /api/gold-studio/jobs/{id}` -- job status
16. `GET /api/gold-studio/jobs` -- job list
17. `GET /api/gold-studio/field-usage` -- field usage report
18. `POST /api/gold-studio/domains` -- create domain workspace
19. `PUT /api/gold-studio/domains/{id}` -- update domain workspace
20. `GET /api/gold-studio/report-coverage/summary` -- coverage summary
21. `DELETE /api/gold-studio/report-coverage/{id}` -- delete coverage
22. `GET /api/gold-studio/source-systems` -- list source systems
23. `POST /api/gold-studio/specimens/{id}/live-describe` -- live describe
24. `GET /api/gold-studio/clusters/{id}/column-decisions` -- MISMATCH: FE calls `/columns`
25. `PUT /api/gold-studio/clusters/{id}/column-decisions` -- MISMATCH: never called correctly

---

## Findings by Surface

---

### BP-002: BusinessAlerts (`/alerts`) -- SUPERSEDE_AND_REPLACE

**Legacy audit**: `dashboard/app/AUDIT-BusinessAlerts.md` (2026-03-23)
**Files**: `BusinessAlerts.tsx` (637 lines), `alerts.py` (~300 lines)
**Endpoint**: `GET /api/alerts`

#### BPG-ALERT-001 -- Freshness SLA threshold not configurable from UI (MEDIUM)
**Status**: OPEN (confirmed from legacy audit Issue 4)
Backend accepts `?freshness_hours=N` query param (default 24). Frontend hardcodes `fetch(\`${API}/api/alerts\`)` with no query params. Users cannot adjust SLA threshold.

#### BPG-ALERT-002 -- No failure-type alerts (MEDIUM)
**Status**: OPEN (confirmed from legacy audit residual risk #2)
Legacy audit removed `"failure"` type from the Alert union. The page has no mechanism to surface recently-failed entities. Failed loads are invisible to business users.

#### BPG-ALERT-003 -- Connection/pending overlap produces duplicate alerts (LOW)
**Status**: OPEN (confirmed from legacy audit residual risk #1)
Sources that have never been loaded get both a `connection` alert (inactive datasource) and `pending` alerts (never-loaded entities). Not a crash risk but produces noise.

#### BPG-ALERT-004 -- firstSeen semantics misleading (LOW)
**Status**: OPEN (confirmed from legacy audit Issue 5)
`firstSeen` is populated from `LoadEndDateTime` -- the timestamp of the last successful load, not when the alert condition began. Label reads as "alert duration" but means "last-load age."

#### BPG-ALERT-005 -- No ARIA roles on filter controls (LOW)
**Status**: NEW
The severity filter chips and type filter chips have no `role="group"` or `aria-label`. The `<select>` for source filter has no associated `<label>` or `aria-label`.

#### BPG-ALERT-006 -- 30-second auto-refresh with no backoff (INFO)
**Status**: NEW
`setInterval(() => fetchAlerts(true), 30_000)` fires unconditionally. If the server is down, this produces a steady stream of failed requests with no exponential backoff or circuit breaker.

#### BPG-ALERT-007 -- Alert type `"info"` not in Severity union (INFO)
**Status**: NEW
The `Severity` type imported from `@/components/business` includes `"critical" | "warning"`. The backend can emit `severity: "info"` for low-priority alerts, but the `severityToRail()` function falls through to the default `"operational"` return. Functional but undocumented.

---

### BP-003: BusinessSources (`/sources-portal`) -- AUDIT_NORMALLY

**Existing audit**: `AUDIT-BusinessSources.md` (2026-03-23) -- PASS WITH NOTES
**Files**: `BusinessSources.tsx` (~630 lines), `overview.py`, `source_manager.py`
**Endpoints**: `GET /api/overview/kpis`, `GET /api/overview/sources`, `GET /api/overview/entities`

#### BPG-SRC-001 -- Prior audit findings verified (CONFIRMED)
All 6 findings from AUDIT-BusinessSources.md verified:
- F1 (LastLoadDate layer precedence): Fixed in overview.py
- F2 (unused imports): Fixed
- F3 (unused destructured vars): Fixed
- F4 (Link with preventDefault): Deferred -- still present, semantic issue only
- F5 (conflicting border styles): Deferred -- still present, visual only
- F6 (source status "degraded" on any failure): Deferred -- still present

#### BPG-SRC-002 -- No loading error differentiation (LOW)
**Status**: NEW
If any of the three parallel fetches (`kpis`, `sources`, `entities`) fails, the page shows a generic error banner. It does not indicate which endpoint failed, making debugging harder.

#### BPG-SRC-003 -- Hardcoded rgba color in error banner border (INFO)
**Status**: CONFIRMED from prior audit F5
`borderColor: "rgba(185, 58, 42, 0.2)"` overrides the `var(--bp-fault)` in the border shorthand. Should use a BP token.

---

### BP-004: BusinessCatalog (`/catalog-portal`) -- VERIFY_AND_EXTEND

**Existing audit**: `AUDIT-BusinessCatalog.md` (2026-03-23)
**Files**: `BusinessCatalog.tsx` (~730 lines), `glossary.py`, `quality.py`, `overview.py`
**Endpoints**: `GET /api/gold/domains`, `GET /api/overview/entities`, `GET /api/mdm/quality/scores`, `GET /api/glossary/annotations/bulk`

#### BPG-CAT-001 -- Prior audit findings verified (CONFIRMED)
All 7 findings from AUDIT-BusinessCatalog.md verified:
- F1 (quality scores shape mismatch): Fixed
- F2 (gold domains shape mismatch): Fixed
- F3 (unused useNavigate): Fixed
- F4 (silent annotation failure): Accepted
- F5 (quality scores 50-row ceiling): Fixed (now uses `?limit=500`)
- F6 (120-card render cap): Documented/accepted
- F7 (domain cards non-navigable): Fixed

#### BPG-CAT-002 -- Backend BE-1 still open: /api/gold/domains returns no `id` or `description` (MEDIUM)
**Status**: CONFIRMED OPEN
`glossary.py` endpoint returns `{name, entityCount}` only. Frontend synthesizes index-based IDs. Domain cards show "No description." Needs backend enhancement.

#### BPG-CAT-003 -- Backend BE-2 still open: quality scores max 500 (MEDIUM)
**Status**: CONFIRMED OPEN
With 1,666 entities, only 500 can be scored in a single call. ~70% of entities may show no quality badge.

#### BPG-CAT-004 -- Backend BE-3 still open: annotations/bulk no error handling (LOW)
**Status**: CONFIRMED OPEN
`glossary.py:265` -- the `get_bulk_annotations` function has no try/except. A missing `entity_annotations` table returns a raw 500.

#### BPG-CAT-005 -- Domain cards render "0 datasets" when entityCount is 0 (INFO)
**Status**: NEW
If a domain has no entities, the card shows "0 datasets" with no visual differentiation from populated domains. Consider suppressing empty domains or adding a visual indicator.

---

### BP-005: DatasetDetail (`/catalog-portal/:id`) -- AUDIT_NORMALLY

**Files**: `DatasetDetail.tsx` (~680 lines), `glossary.py`, `quality.py`, `overview.py`
**Endpoints**: `GET /api/overview/entities`, `GET /api/glossary/entity/{entityId}`, `GET /api/mdm/quality/scores`, `GET /api/gold/models/{goldModelId}`

#### BPG-DET-001 -- Ghost endpoint: `/api/gold/models/{id}` does not exist (CRITICAL)
**Status**: NEW
`DatasetDetail.tsx:230` calls `fetch(\`${API}/api/gold/models/${goldModelId}\`)`. This endpoint does not exist anywhere in the backend (`grep -rn 'gold/models' dashboard/app/api/routes/` returns nothing). The fetch silently fails (caught error returns null), but the Gold Model panel shows empty/loading state indefinitely for any entity that has a gold model reference.

#### BPG-DET-002 -- Quality scores fetched without entity filter (HIGH)
**Status**: NEW
`DatasetDetail.tsx:202` calls `GET /api/mdm/quality/scores` with NO query params. This fetches ALL quality scores (up to default 50), then the frontend searches for the matching entity. For a single entity detail page, this is wasteful and may not find the entity if it falls outside the first 50 rows. Should use `GET /api/quality/score/{entityId}` (the single-entity endpoint in `quality.py`).

#### BPG-DET-003 -- Entity lookup by scanning full entity list (HIGH)
**Status**: NEW
`DatasetDetail.tsx:161` calls `GET /api/overview/entities` (which returns ALL 1,666 entities) to find a single entity by ID. Should use a dedicated single-entity endpoint or pass `?entity_id=N` filter.

#### BPG-DET-004 -- No loading skeleton (LOW)
**Status**: NEW
The page shows a simple "Loading..." text during data fetch. No skeleton UI matches the BP design system's shimmer pattern used on every other Business Portal page.

#### BPG-DET-005 -- Quality score section renders even when no score found (LOW)
**Status**: NEW
If the entity is not in the quality scores response (likely per BPG-DET-002), the quality section renders with all zeros/undefined rather than showing "No quality data available."

---

### BP-006: BusinessRequests (`/requests`) -- VERIFY_AND_EXTEND

**Existing audit**: `AUDIT-BusinessRequests.md` (2026-03-23)
**Files**: `BusinessRequests.tsx` (~596 lines), `requests.py` (~227 lines)
**Endpoints**: `GET /api/requests`, `POST /api/requests`, `GET /api/overview/sources`

#### BPG-REQ-001 -- Prior audit findings verified (CONFIRMED)
All findings from AUDIT-BusinessRequests.md verified:
- #1 (hardcoded `#fff`): Fixed
- #2 (dead SearchIcon import): Fixed
- #3 (accessibility -- no htmlFor/id pairing): Noted, partially addressed
- Items 4-18: Pass or documented as expected

#### BPG-REQ-002 -- PATCH endpoint exists but is never called from frontend (MEDIUM)
**Status**: NEW
`requests.py` defines `PATCH /api/requests/{id}` for updating request status and admin response. No frontend code calls this endpoint. There is no admin workflow to review/approve/decline requests. The status column in the table is display-only.

#### BPG-REQ-003 -- No request detail view (LOW)
**Status**: NEW
Clicking a request row does nothing. The table shows a summary but there is no slide-over or detail panel to view the full description/justification of a submitted request.

#### BPG-REQ-004 -- Form validation is client-side only (LOW)
**Status**: NEW
The POST endpoint in `requests.py` validates required fields server-side (`title` required), but the frontend form allows submission of requests with empty descriptions and justifications. Server accepts them but they provide little value.

---

### BP-007: BusinessHelp (`/help`) -- AUDIT_NORMALLY

**Files**: `BusinessHelp.tsx` (~370 lines)
**Endpoints**: None (static content page)

#### BPG-HELP-001 -- Fully static, no API calls (PASS)
**Status**: CONFIRMED
Line 6 explicitly documents: `// Static content -- no API calls`. The page renders an accordion FAQ with hardcoded content. No fetch calls, no useEffect, no API dependencies.

#### BPG-HELP-002 -- FAQ content may be stale (INFO)
**Status**: NEW
FAQ answers reference specific features and workflows. As the app evolves, these answers may become inaccurate. No mechanism to flag or auto-update stale content.

#### BPG-HELP-003 -- No search within help content (INFO)
**Status**: NEW
With multiple FAQ categories and items, there is no search/filter capability. Users must manually browse categories.

---

### GS-001: GoldLedger (`/gold/ledger`) -- VERIFY_AND_EXTEND

**Existing audit**: `AUDIT-GoldLedger.md` (2026-03-23)
**Files**: `GoldLedger.tsx` (~1300 lines), `gold_studio.py`
**Endpoints used**: `GET /api/gold-studio/stats`, `GET /api/gold-studio/specimens`, `POST /api/gold-studio/specimens`, `POST /api/gold-studio/specimens/{id}/extract`, `DELETE /api/gold-studio/specimens/{id}`, `GET /api/gold-studio/specimens/{id}`, `POST /api/gold-studio/specimens/bulk`, `GET /api/gold-studio/entities`, `POST /api/gold-studio/auto-detect`

#### BPG-LED-001 -- Prior audit findings verified (CONFIRMED)
All findings from AUDIT-GoldLedger.md verified:
- GL-01 through GL-05 (hardcoded colors): Fixed
- GL-07 (silent error swallowing): Fixed
- GL-10 through GL-17 (accessibility): Fixed
- GL-31 (FormField label association): Deferred -- still present
- GL-32 (SpecimenCard deferred): Addressed below in SHARED section
- GL-33 (shared components deferred): Addressed below in SHARED section

#### BPG-LED-002 -- API base inconsistent with other Gold pages (MEDIUM)
**Status**: NEW
GoldLedger uses `const API = import.meta.env.VITE_API_URL || ""` and builds full paths like `${API}/api/gold-studio/specimens`. All other Gold pages (Clusters, Canonical, Specs, Validation) use `const API = "/api/gold-studio"` and build relative paths like `${API}/specimens`. Both patterns work, but the inconsistency means:
- If `VITE_API_URL` is set to a non-empty value (e.g., a staging server), GoldLedger would use it but all other Gold pages would ignore it.
- Maintenance burden: developers must remember which pattern each page uses.

#### BPG-LED-003 -- Fire-and-forget extract after create (LOW)
**Status**: NEW
After creating a specimen (`POST /specimens`), the code immediately fires `POST /specimens/{id}/extract` with `.catch(() => {})`. If extraction fails, the user sees the new specimen but with a stale `job_state`. No toast or error notification for extraction failure.

#### BPG-LED-004 -- Bulk upload error handling shows raw HTTP status (LOW)
**Status**: NEW
`GoldLedger.tsx:562` -- bulk upload catch shows `err.message` which is typically `"HTTP 500"` with no useful detail. Should parse the response body for a `detail` field.

---

### GS-002: GoldClusters (`/gold/clusters`) -- AUDIT_NORMALLY

**Files**: `GoldClusters.tsx` (~790 lines), `gold_studio.py`
**Endpoints used**: `GET /api/gold-studio/stats`, `GET /api/gold-studio/clusters`, `GET /api/gold-studio/clusters/{id}`, `PUT /api/gold-studio/clusters/{id}`, `POST /api/gold-studio/clusters/{id}/resolve`, `GET /api/gold-studio/clusters/unclustered`, `GET /api/gold-studio/entities/{id}`

#### BPG-CLUST-001 -- Column reconciliation calls wrong endpoint (CRITICAL)
**Status**: NEW
`GoldClusters.tsx:285` calls `fetch(\`${API}/clusters/${reconClusterId}/columns\`)` which resolves to `GET /api/gold-studio/clusters/{id}/columns`. This endpoint **does not exist**. The correct endpoint is `GET /api/gold-studio/clusters/{id}/column-decisions` (line 1203 of gold_studio.py). The reconciliation slide-over will always fail to load column data, showing `GoldEmpty noun="column data"` indefinitely.

#### BPG-CLUST-002 -- N+1 query pattern for cluster hydration (HIGH)
**Status**: NEW
`GoldClusters.tsx:117-132` -- after fetching the cluster list, the code iterates over every cluster and makes an individual `GET /clusters/{id}` call to hydrate members. With 200 clusters, this fires 200+ sequential HTTP requests on every load. Should use a bulk endpoint or embed members in the list response.

#### BPG-CLUST-003 -- Unclustered entity "canonicalize" uses wrong HTTP method (MEDIUM)
**Status**: NEW
`GoldClusters.tsx:310-329` -- marks an unclustered entity as standalone by calling `PUT /api/gold-studio/entities/{id}` with `{ provenance: "canonicalized" }`. This uses the entities endpoint to write cluster-like state. The entity endpoint (`PUT /api/gold-studio/entities/{id}`) does not exist in the backend -- there is only `GET`. This call will return 404/405.

#### BPG-CLUST-004 -- No useDomainContext integration (LOW)
**Status**: NEW
Unlike GoldCanonical and GoldSpecs, GoldClusters does not consume `useDomainContext()` to filter clusters by the selected domain. Domain selection in the shared layout header has no effect on the clusters view.

#### BPG-CLUST-005 -- Abort controller not cleaned up in all paths (LOW)
**Status**: NEW
`clusterAbortRef` is set but the old controller is only aborted before a new fetch. If the component unmounts during a fetch, the in-flight request is not aborted, potentially causing state updates on an unmounted component.

---

### GS-003: GoldCanonical (`/gold/canonical`) -- VERIFY_AND_EXTEND

**Existing audit**: `AUDIT-GoldCanonical.md` (2026-03-23)
**Files**: `GoldCanonical.tsx` (~760 lines), `gold_studio.py`
**Endpoints used**: `GET /api/gold-studio/canonical`, `GET /api/gold-studio/canonical/{id}`, `POST /api/gold-studio/canonical/{id}/approve`, `POST /api/gold-studio/canonical/{id}/generate-spec`, `GET /api/gold-studio/canonical/domains`, `GET /api/gold-studio/canonical/relationships`, `GET /api/gold-studio/semantic`, `GET /api/gold-studio/audit/log`, `GET /api/gold-studio/stats`

#### BPG-CANON-001 -- Prior audit findings verified (CONFIRMED)
All findings from AUDIT-GoldCanonical.md verified:
- GC-01 (stats interface mismatch): Fixed
- GC-02 through GC-04 (hardcoded colors): Fixed
- GC-06 (silent error in detail fetch): Fixed
- GC-07 (missing error state for main load): Fixed
- GC-08 through GC-15 (accessibility): Fixed
- GC-16 (unused domainFilter prop): Fixed

#### BPG-CANON-002 -- fetchJson returns null on error, no user feedback for some paths (LOW)
**Status**: NEW
`fetchJson<T>` helper (line 108) returns `null` on any error. Most callers check for null, but some chains (e.g., semantic measures fetch at line 162) silently show empty arrays. User cannot distinguish "no data" from "API error."

#### BPG-CANON-003 -- Relationship map fetches all relationships unfiltered (LOW)
**Status**: NEW
`GET /api/gold-studio/canonical/relationships` returns ALL relationships across all domains. The ReactFlow graph may become unwieldy with large canonical entity counts. No pagination or domain filter is passed.

#### BPG-CANON-004 -- Approve and generate-spec have no optimistic concurrency (MEDIUM)
**Status**: NEW
`POST /canonical/{id}/approve` and `POST /canonical/{id}/generate-spec` are called without passing an `expected_version` parameter. While the backend supports optimistic concurrency via `_check_expected_version`, the frontend does not send version info, bypassing the safety check. Concurrent edits could silently overwrite each other.

---

### GS-004: GoldSpecs (`/gold/specs`) -- VERIFY_AND_EXTEND

**Existing audit**: `AUDIT-GoldSpecs.md` (2026-03-23)
**Files**: `GoldSpecs.tsx` (~479 lines), `gold_studio.py`
**Endpoints used**: `GET /api/gold-studio/specs`, `GET /api/gold-studio/specs/{id}`, `GET /api/gold-studio/specs/{id}/versions`, `GET /api/gold-studio/specs/{id}/impact`, `GET /api/gold-studio/validation/specs/{id}/runs`, `GET /api/gold-studio/stats`

#### BPG-SPEC-001 -- Prior audit findings verified (CONFIRMED)
All findings from AUDIT-GoldSpecs.md verified:
- GS-01 (stats strip all zeros): Fixed via `mapStats()` translation
- Deferred GS-27 (shared components): Still deferred, addressed in SHARED section
- Deferred GS-28 (SlideOver dialog semantics): Still deferred
- Deferred GS-01 partial (backend doesn't return per-status breakdowns): Still open
- Deferred GS-02 partial (backend doesn't return columns/transforms): Still open

#### BPG-SPEC-002 -- FALLBACK_DOMAINS hardcoded (MEDIUM)
**Status**: NEW
`GoldSpecs.tsx` line ~100 defines `const FALLBACK_DOMAINS = ["All", "Finance", "Operations", "Supply Chain", "Quality", "Production"]`. When the domain list from `useDomainContext()` is empty (on first render or error), the dropdown shows these 5 hardcoded domains. If the actual domains differ, users see ghost filter options that return no results.

#### BPG-SPEC-003 -- Backend doesn't return columns or transforms arrays (MEDIUM)
**Status**: CONFIRMED OPEN (from prior audit GS-02 partial)
`GET /api/gold-studio/specs/{id}` returns the spec row but does not join/embed columns or transforms. The Columns and Transforms tabs in the detail slide-over are permanently empty.

#### BPG-SPEC-004 -- Error swallowing on stats and spec list fetches (LOW)
**Status**: NEW
`GoldSpecs.tsx:154` -- stats fetch ends with `.catch(() => {})`. If the stats endpoint fails, the strip shows all zeros indistinguishable from "no data yet."

---

### GS-005: GoldValidation (`/gold/validation`) -- AUDIT_NORMALLY

**Files**: `GoldValidation.tsx` (~1400 lines), `gold_studio.py`
**Endpoints used**: `GET /api/gold-studio/stats`, `GET /api/gold-studio/specs`, `GET /api/gold-studio/catalog`, `GET /api/gold-studio/report-coverage`, `GET /api/gold-studio/validation/specs/{id}/runs`, `POST /api/gold-studio/validation/specs/{id}/validate`, `POST /api/gold-studio/validation/runs/{id}/waiver`, `POST /api/gold-studio/catalog/specs/{id}/publish`, `GET /api/gold-studio/catalog/{id}`, `PUT /api/gold-studio/catalog/{id}`, `GET /api/gold-studio/catalog/{id}/versions`, `GET /api/gold-studio/report-coverage/{id}`, `POST /api/gold-studio/report-coverage`, `PUT /api/gold-studio/report-coverage/{id}`

#### BPG-VALID-001 -- Most complex page in Gold Studio -- 14 distinct endpoint calls (HIGH)
**Status**: NEW (architectural observation)
GoldValidation is the heaviest consumer of gold_studio.py endpoints (14 unique endpoint calls). It combines validation, catalog, and report coverage into one page. This creates a brittle coupling: changes to any of 14 endpoints can break this page. Consider splitting into sub-pages or dedicated tabs with lazy loading.

#### BPG-VALID-002 -- Validation run results stored as JSON string, parsed client-side (MEDIUM)
**Status**: NEW
`ValidationRunRow.results` and `.reconciliation` are typed as `string | RuleResult[] | null`. The backend stores them as JSON strings in SQLite. The frontend must check and parse both cases. If the JSON is malformed, the entire validation detail view may crash (no try/catch around JSON.parse in the type-narrowing code).

#### BPG-VALID-003 -- Publish-to-catalog has no confirmation dialog (MEDIUM)
**Status**: NEW
`GoldValidation.tsx:314` -- clicking "Publish" immediately fires `POST /catalog/specs/{id}/publish`. For an action that makes a spec publicly visible in the catalog, there is no confirmation dialog. Accidental clicks cannot be undone without backend intervention.

#### BPG-VALID-004 -- Report coverage create/edit has no form validation (LOW)
**Status**: NEW
The report coverage creation form (`POST /report-coverage`) and edit form (`PUT /report-coverage/{id}`) accept whatever the user types. No validation on required fields (report_name, domain, coverage_status) before submission.

#### BPG-VALID-005 -- No loading indicator for individual validation triggers (LOW)
**Status**: NEW
When `POST /validation/specs/{id}/validate` is called, there is no per-row loading spinner. The user may click multiple times, queuing duplicate validation runs.

---

### SHARED: GoldStudioLayout + Components

**Files**: `GoldStudioLayout.tsx` (~290 lines), `SpecimenCard.tsx` (~830 lines), `GoldStates.tsx`, `index.ts`, `SlideOver.tsx`, `StatsStrip.tsx`, `ProvenanceThread.tsx`, `ClusterCard.tsx`, `ColumnReconciliation.tsx`

#### BPG-SHARED-001 -- GoldStudioLayout domain fetch error silently swallowed (LOW)
**Status**: NEW
`GoldStudioLayout.tsx:74` -- `fetch(\`${API}/domains\`).then(...).catch(() => {})` silently swallows errors. If the domains endpoint fails, the domain selector simply doesn't appear. No error feedback.

#### BPG-SHARED-002 -- SpecimenCard makes live API calls (specimen preview, entity columns) (INFO)
**Status**: NEW (documentation)
SpecimenCard is not a pure display component. It makes two types of API calls:
- `GET /api/gold-studio/entities/{id}/columns` -- loads column data when expanding an entity
- `POST /api/gold-studio/specimens/{id}/preview` -- executes a live query against the source database

Both are user-triggered (click to expand / click "Run Preview"). The preview endpoint hits the actual source database, which means SpecimenCard can cause production database load.

#### BPG-SHARED-003 -- GoldStudioLayout uses relative API path `/api/gold-studio` (INFO)
**Status**: NEW
`const API = "/api/gold-studio"` -- consistent with Clusters, Canonical, Specs, Validation but inconsistent with GoldLedger (see BPG-LED-002).

#### BPG-SHARED-004 -- GoldStates components have no ARIA roles (LOW)
**Status**: NEW
`GoldLoading`, `GoldEmpty`, `GoldNoResults`, and `GoldError` are semantic state components but have no `role="status"` or `aria-live="polite"` attributes. Screen readers may not announce state changes.

#### BPG-SHARED-005 -- SlideOver deferred audit items still open (INFO)
**Status**: CONFIRMED OPEN
From prior audits (GS-28, GL-31): SlideOver needs `role="dialog"`, `aria-modal`, and Escape key dismissal verification. These were deferred in page-level audits and remain unverified at the shared component level.

---

## Cross-Cutting Findings

### BPG-XCUT-001 -- API base path inconsistency across Gold pages (MEDIUM)

| Page | API const | Pattern | Example URL |
|------|-----------|---------|-------------|
| GoldLedger | `import.meta.env.VITE_API_URL \|\| ""` | Full path in fetch | `/api/gold-studio/specimens` |
| GoldClusters | `"/api/gold-studio"` | Relative path in fetch | `/clusters` |
| GoldCanonical | `"/api/gold-studio"` | Relative path in fetch | `/canonical` |
| GoldSpecs | `"/api/gold-studio"` | Relative path in fetch | `/specs` |
| GoldValidation | `"/api/gold-studio"` | Relative path in fetch | `/specs` |
| GoldStudioLayout | `"/api/gold-studio"` | Relative path in fetch | `/domains` |
| SpecimenCard | `import.meta.env.VITE_API_URL \|\| ""` | Full path in fetch | `/api/gold-studio/entities/{id}/columns` |

GoldLedger and SpecimenCard use the env-var pattern; everything else hardcodes the prefix. This means `VITE_API_URL` only affects 2 of 7 Gold surfaces.

### BPG-XCUT-002 -- No CSRF protection on mutation endpoints (HIGH)

All POST/PUT/DELETE calls across all 11 pages send no CSRF token. The backend router does not validate any anti-forgery mechanism. While this is common in internal tools, it is a security gap if the app is ever exposed beyond the intranet.

### BPG-XCUT-003 -- No auth/session management on any page (HIGH)

No page checks for authentication. No token is sent with API calls. The backend relies entirely on network-level security (VPN/Windows Auth via IIS). If the IIS reverse proxy is misconfigured, all endpoints are publicly accessible.

### BPG-XCUT-004 -- Optimistic concurrency underutilized (MEDIUM)

The backend supports `expected_version` on update/approve endpoints via `_check_expected_version()`. Frontend pages rarely pass this parameter. Only the `PUT /clusters/{id}` call in GoldClusters appears to track versions. GoldCanonical approve/generate-spec and all spec updates skip version checks.

---

## Severity Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 2 | BPG-DET-001, BPG-CLUST-001 |
| HIGH | 5 | BPG-DET-002, BPG-DET-003, BPG-CLUST-002, BPG-VALID-001, BPG-XCUT-002, BPG-XCUT-003 |
| MEDIUM | 11 | BPG-ALERT-001, BPG-ALERT-002, BPG-CAT-002, BPG-CAT-003, BPG-CLUST-003, BPG-CANON-004, BPG-SPEC-002, BPG-SPEC-003, BPG-VALID-002, BPG-VALID-003, BPG-XCUT-001, BPG-XCUT-004 |
| LOW | 17 | BPG-ALERT-003, BPG-ALERT-004, BPG-ALERT-005, BPG-SRC-002, BPG-CAT-004, BPG-DET-004, BPG-DET-005, BPG-REQ-002, BPG-REQ-003, BPG-REQ-004, BPG-LED-003, BPG-LED-004, BPG-CLUST-004, BPG-CLUST-005, BPG-CANON-002, BPG-CANON-003, BPG-SPEC-004, BPG-VALID-004, BPG-VALID-005, BPG-SHARED-001, BPG-SHARED-004, BPG-SHARED-005 |
| INFO | 6 | BPG-ALERT-006, BPG-ALERT-007, BPG-SRC-003, BPG-CAT-005, BPG-HELP-002, BPG-HELP-003, BPG-SHARED-002, BPG-SHARED-003 |

**Total findings: 41** (2 CRITICAL, 5 HIGH, 11 MEDIUM, 17 LOW, 6 INFO)

---

## Critical Path Items (Repair Priority)

1. **BPG-CLUST-001** -- GoldClusters column reconciliation calls `/columns` instead of `/column-decisions`. Entire reconciliation feature is broken. **Fix: rename fetch path.**
2. **BPG-DET-001** -- DatasetDetail calls ghost endpoint `/api/gold/models/{id}`. **Fix: either create the endpoint or remove the Gold Model panel.**
3. **BPG-DET-002 + BPG-DET-003** -- DatasetDetail fetches all entities and all quality scores to find one. **Fix: use single-entity endpoints.**
4. **BPG-CLUST-003** -- GoldClusters calls `PUT /entities/{id}` which doesn't exist. **Fix: use correct endpoint or add PUT route.**

---

## Orphaned Endpoint Disposition Recommendation

| Endpoint | Recommendation |
|----------|---------------|
| `PUT /specimens/{id}` | Wire into SpecimenCard edit |
| `GET /entities/{id}/schema` | Wire into SpecimenCard or remove |
| `POST /entities/{id}/discover-schema` | Wire into SpecimenCard or remove |
| `POST /clusters/detect` | Wire into GoldClusters toolbar |
| `POST /canonical` | Wire into GoldCanonical create flow |
| `PUT /canonical/{id}` | Wire into GoldCanonical edit |
| `GET /canonical/{id}/versions` | Wire into GoldCanonical detail |
| `POST /semantic`, `PUT /semantic/{id}`, `DELETE /semantic/{id}` | Wire into GoldCanonical detail or separate semantic page |
| `PUT /specs/{id}`, `PUT /specs/{id}/sql` | Wire into GoldSpecs edit |
| `GET /validation/runs/{id}` | Wire into GoldValidation run detail |
| `GET /validation/specs/{id}/reconciliation` | Wire into GoldValidation |
| `GET /jobs/{id}`, `GET /jobs` | Wire into a jobs dashboard or remove |
| `GET /field-usage` | Wire into analytics or remove |
| `POST /domains`, `PUT /domains/{id}` | Wire into domain management UI |
| `GET /report-coverage/summary` | Wire into GoldValidation stats |
| `DELETE /report-coverage/{id}` | Wire into GoldValidation coverage table |
| `GET /source-systems` | Wire into filter dropdowns or remove |
| `POST /specimens/{id}/live-describe` | Wire into SpecimenCard or remove |
