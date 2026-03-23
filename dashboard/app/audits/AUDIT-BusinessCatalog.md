# Audit: BusinessCatalog (Portal Catalog)

**Date**: 2026-03-23
**Packet**: AUDIT-PC
**Files audited**:
- `dashboard/app/src/pages/business/BusinessCatalog.tsx`
- `dashboard/app/api/routes/overview.py` (READ-ONLY)
- `dashboard/app/api/routes/glossary.py` (READ-ONLY, owns `/api/gold/domains` + `/api/glossary/annotations/bulk`)
- `dashboard/app/api/routes/quality.py` (READ-ONLY, owns `/api/mdm/quality/scores`)

---

## Verdict: PASS WITH NOTES

All three truth-affecting data-mapping bugs have been fixed in-band. The page now correctly normalises backend responses for gold domains, quality scores, and annotations. Two backend design observations are documented below but are not blockers.

---

## Findings

### [F1] Quality scores response shape mismatch (severity: CRITICAL)
**File**: `BusinessCatalog.tsx:362-363`
**Was**: Frontend fetched `/api/mdm/quality/scores` and expected a flat array of `{entity_id, score}`. The backend returns a paginated envelope `{items: [{entityId, composite, ...}], total, limit, offset, summary}`. Because `Array.isArray(data)` is false on a dict, `setQualityScores([])` was always called. The quality map was permanently empty — no quality tier badges ever rendered on table cards, and tier filter chips had no effect.
**Fixed**: Fetch with `?limit=500`, unwrap `data.items`, and normalise each item from `{entityId, composite}` to `{entity_id, score}`.
**Impact**: Quality tier badges and tier filtering were completely broken (always empty).

### [F2] Gold domains response shape mismatch (severity: HIGH)
**File**: `BusinessCatalog.tsx:349-351`
**Was**: Frontend `GoldDomain` type expects `{id, name, description?, model_count?}`. The backend (`/api/gold/domains` in glossary.py) returns `{name, entityCount}`. Missing `id` (used as React key and in link URL) and `model_count` (displayed as "N datasets"). `entityCount` was silently ignored, so every domain card showed "0 datasets". The `id` field defaulted to `undefined`, creating invalid link targets (`/catalog-portal/domain-undefined`).
**Fixed**: Normalise backend response: synthesise `id` from index when missing, map `entityCount` to `model_count`.
**Impact**: Domain card dataset counts were always 0; domain links pointed to invalid routes.

### [F3] Unused `useNavigate` import and call (severity: LOW)
**File**: `BusinessCatalog.tsx:11,324`
**Was**: `useNavigate` was imported from react-router-dom and `const navigate = useNavigate()` was called, but `navigate` was never used anywhere in the component.
**Fixed**: Removed import and variable declaration.
**Impact**: Dead code only; no runtime effect but adds unnecessary hook overhead.

### [F4] Annotations endpoint: no error-state feedback (severity: LOW)
**File**: `BusinessCatalog.tsx:364`
**Was**: If `/api/glossary/annotations/bulk` fails, the catch returns `[]` silently. No user feedback.
**Fixed**: N/A — consistent with the existing degradation pattern on this page. All three parallel fetches degrade silently. This is acceptable for optional enrichment data.
**Impact**: Cosmetic only; descriptions silently absent.

### [F5] Quality scores pagination ceiling (severity: MEDIUM)
**File**: `BusinessCatalog.tsx:362`
**Was**: The fetch had no `limit` param, defaulting to the backend's 50-row limit. With 1,666 entities, only 50 would ever get quality scores rendered.
**Fixed**: Added `?limit=500` to the fetch URL. This matches the backend's max allowed limit. For >500 scored entities, a pagination loop or dedicated bulk endpoint would be needed.
**Impact**: Only ~3% of entities could show quality badges before fix.

### [F6] Table cards capped at 120 with no pagination (severity: INFO)
**File**: `BusinessCatalog.tsx:755`
**Was**: `entities.slice(0, 120)` hard-caps rendered cards. A message tells users to filter, but there is no "load more" or pagination.
**Fixed**: N/A — intentional UX cap to avoid rendering 1,666 DOM nodes. Documented for future consideration.
**Impact**: Users cannot browse beyond 120 results without filtering.

### [F7] Domain card links may 404 (severity: MEDIUM)
**File**: `BusinessCatalog.tsx:97`
**Was**: `<Link to={/catalog-portal/domain-${domain.id}}>` constructs a route. After fix F2 the `id` is the array index (0, 1, 2...) since the backend has no domain ID. If the domain list order changes, bookmarked links break. Similarly, `entity-${LandingzoneEntityId}` links (`line 157`) point to routes that may not be implemented yet.
**Fixed**: Deferred — requires backend to return a stable domain identifier. The index-based id is a stopgap.
**Impact**: Unstable permalinks for domain detail pages.

---

## Token Inventory (for UP-06 scoping)

### Hardcoded hex/rgba values
- None found. All colors use `var(--bp-*)` CSS custom properties correctly.

### Table/grid headers
- **No traditional table headers on this page.** The page uses a card grid layout, not a table. There are no `<th>`, column headers, or grid headers to target.
- The filter chip bar (source chips + tier chips) and the result count line could be considered header-adjacent but are not table headers.
- **UP-06 verdict**: This page has no table headers to target. Skip for UP-06.

---

## Backend Issues (Documented, Not Fixed)

### [BE-1] `/api/gold/domains` returns no `id` or `description` (glossary.py:326-329)
The endpoint returns only `{name, entityCount}`. The frontend needs a stable `id` for routing and a `description` for the card body. Currently the frontend synthesises an index-based id, and every domain card says "No description". A future backend change should add:
- `id` (row ID or slugified name)
- `description` (from a `domain_descriptions` table or inline in `entity_annotations`)

### [BE-2] `/api/mdm/quality/scores` max limit is 500 (quality.py:48)
The endpoint caps `limit` at 500. With 1,666 entities, the catalog page cannot retrieve all scores in one call. Options:
- Add a dedicated `/api/quality/scores/bulk` endpoint (no pagination, just entity_id + composite)
- Or increase the max limit for the alias route

### [BE-3] `/api/glossary/annotations/bulk` has no error handling (glossary.py:265-295)
The endpoint has no try/except — if the `entity_annotations` table doesn't exist, it will return a raw 500 error rather than a structured error response. Other routes in the same file do have error handling.

---

## Summary of Changes

| # | What | Severity | Status |
|---|------|----------|--------|
| F1 | Quality scores response normalisation | CRITICAL | Fixed |
| F2 | Gold domains response normalisation | HIGH | Fixed |
| F3 | Dead `useNavigate` import | LOW | Fixed |
| F4 | Silent annotation failure | LOW | Accepted |
| F5 | Quality scores 50-row default | MEDIUM | Fixed |
| F6 | 120-card render cap | INFO | Documented |
| F7 | Unstable domain link IDs | MEDIUM | Deferred (needs BE-1) |
