# TransformationReplay Page Audit

Audited: 2026-03-11

## Overview

TransformationReplay.tsx (~860 lines) renders a 13-step visual walkthrough of the FMD medallion pipeline transformation flow (Landing Zone -> Bronze -> Silver). Each step is rendered as a timeline card with GSAP ScrollTrigger animations. Optionally loads per-entity/per-PK "microscope" data to enrich steps with real before/after column diffs.

**API calls:**
- `GET /api/entity-digest` (via `useEntityDigest` hook) -- entity list for selector
- `GET /api/microscope?entity={id}&pk={pk}` -- per-entity transformation microscope data (inline fetch, line 496)

---

## Frontend Bugs Fixed

### 1. MEDIUM -- Anti-flash loading pattern missing for digest data

**Problem:** The `digestLoading` flag from `useEntityDigest` was passed directly to `EntitySelector`'s `loading` prop. On silent background refreshes (after the first load), the entity selector would briefly show a loading state, causing visible flicker.

**Fix:** Added `hasLoadedOnce` ref + `showDigestLoading` derived flag (lines 480-483). The loading skeleton is only shown on the true first load; subsequent refreshes update data silently.

### 2. MEDIUM -- GSAP ScrollTrigger cleanup killed all global triggers

**Problem:** The cleanup function (line 576 original) called `ScrollTrigger.getAll().forEach(t => t.kill())`, which destroys ALL ScrollTrigger instances in the app -- including those from other mounted components. If TransformationReplay unmounts while another page's ScrollTriggers are active, they get wiped.

**Fix:** Track only the ScrollTrigger instances created by this component in a `localTriggers` array. Cleanup now calls `localTriggers.forEach(t => t.kill())` instead of the global nuke (lines 539, 560, 579, 585).

### 3. LOW -- PK input uses `defaultValue` without re-mount key

**Problem:** The primary key text input (line 697 original) used `defaultValue={pkParam || ""}`. Since `defaultValue` only sets the initial value on mount, if `pkParam` changes via browser back/forward navigation or URL manipulation, the input displays stale text while the URL has a different PK value.

**Fix:** Added `key={pkParam || ""}` to force React to re-mount the input when the PK param changes, ensuring the displayed value always matches the URL.

---

## Backend Issues

### 1. CRITICAL -- `/api/microscope` endpoint does not exist in server.py

**File:** `dashboard/app/api/server.py`
**Line:** Not present (searched all `do_GET` routes, lines 8402-8960)

**Problem:** TransformationReplay.tsx fetches `GET /api/microscope?entity={id}&pk={pk}` on line 496. This endpoint is not registered in `server.py`'s `do_GET` handler. The request will fall through to the catch-all `elif self.path.startswith('/api/'): self._error_response('Not found', 404)` on line 8960-8961. The microscope feature will always show an error banner.

A `useMicroscope` hook exists at `dashboard/app/src/hooks/useMicroscope.ts` (also calls `/api/microscope`), and a `DataMicroscope.tsx` page exists, but the backend endpoint was never implemented.

**Fix needed:** Implement the `/api/microscope` GET route in `server.py` that:
1. Accepts `entity` (LandingzoneEntityId) and `pk` (primary key value) query params
2. Looks up the entity's PK columns, source connection, bronze/silver lakehouse
3. Queries each layer for the row matching the PK
4. Returns a `MicroscopeResponse` with `transformations[]` showing before/after at each step

**Note:** The frontend gracefully handles the 404 (shows error banner, falls back to static step data), so this is a missing feature rather than a crash. But it renders the microscope feature entirely non-functional.

### 2. LOW -- No `/api/microscope/pks` endpoint either

**File:** `dashboard/app/api/server.py`

**Problem:** The `useMicroscope.ts` hook (line 212) also calls `GET /api/microscope/pks?entity={id}&q={query}&limit={n}` for PK autocomplete. This endpoint is also missing from `server.py`. TransformationReplay.tsx does not use this endpoint directly, but the shared hook does.

**Fix needed:** Implement alongside the main microscope endpoint.
