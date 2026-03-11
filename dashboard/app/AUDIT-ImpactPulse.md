# ImpactPulse Page Audit

**Audited**: 2026-03-11

**File**: `dashboard/app/src/pages/ImpactPulse.tsx` (~845 lines)

**Purpose**: Full-bleed React Flow canvas showing data movement through the FMD medallion layers. Source systems fan into Landing Zone, then cascade through Bronze, Silver, and Gold. Animated edges pulse with activity, nodes glow when pipelines are running, and a slide-out drawer shows layer details on click.

**Dependencies**: `useEntityDigest` hook, `/api/entity-digest`, `/api/live-monitor`, `LayerNode` + `AnimatedEdge` custom React Flow components, `@/lib/layers` (getSourceColor).

---

## Frontend Bugs Fixed

### 1. CRITICAL — `isSourceActive` only checked `EntityName` which is actually `CopyActivityParameters`

**Problem**: The `isSourceActive` function (line ~470) checked `(e as CopyEvent).EntityName` to match against source system names. However, the backend aliases `CopyActivityParameters AS EntityName` in the `/api/live-monitor` endpoint — this field contains copy activity parameters (often JSON or file paths), not a source system name like "MES" or "OPTIVA". Result: source nodes were almost never highlighted as active during live loads.

**Fix**: Expanded field matching to check `EntityName`, `CopyActivityName`, `NotebookName`, `PipelineName`, and `EntityLayer` — any of which may contain the source system name. Also restructured to short-circuit the timestamp check before iterating fields.

### 2. CRITICAL — `onClose` callback recreated on every render causing stale closure / event listener churn

**Problem**: The `LayerDrawer` received `onClose={() => setSelectedNode(null)}` as an inline arrow function (line ~803). This created a new function reference every render, causing the `useEffect` hooks inside `LayerDrawer` (click-outside handler at line ~216 and Escape handler at line ~230) to tear down and re-register event listeners on every parent re-render. This could cause:
- Click-outside handler firing unexpectedly during the cleanup/re-add window
- Memory churn from rapid effect cycle
- Potential drawer closing itself when switching between nodes

**Fix**: Added a `closeDrawer` callback wrapped in `useCallback` with empty deps, passed as `onClose` prop.

### 3. MEDIUM — Unstable `key={i}` on recent activity event list items

**Problem**: The recent events list in `LayerDrawer` (line ~354) used array index as the React key: `key={i}`. When the live events list changes (new events arriving, order shifting), React may incorrectly reuse DOM elements, causing stale text or flickering.

**Fix**: Changed to composite key: `key={\`${runGuid}-${logType}-${time}-${i}\`}` using `PipelineRunGuid`, `LogType`, and `LogDateTime` fields for stability with index fallback for uniqueness.

### 4. LOW — Unused imports (`XCircle`, `LAYERS`, `SOURCE_COLORS`)

**Problem**: Three imports were unused: `XCircle` from lucide-react, `LAYERS` and `SOURCE_COLORS` from `@/lib/layers`. These add dead code to the bundle and trigger linter warnings.

**Fix**: Removed all three unused imports.

---

## Backend Issues

### 1. `CopyActivityParameters AS EntityName` — misleading alias

- **File**: `dashboard/app/api/server.py:2086`
- **Problem**: The `/api/live-monitor` endpoint aliases `CopyActivityParameters AS EntityName` in the copy events query. The field name `EntityName` implies it contains the entity/table name, but `CopyActivityParameters` typically contains JSON parameters or file paths. This misled the frontend `isSourceActive` function into comparing source names against parameter strings.
- **Fix needed**: Either alias the correct column (if one exists with actual entity name) or rename the alias to `CopyActivityParameters` so frontends don't misinterpret it. The frontend fix (Bug #1 above) works around this by checking multiple fields, but the backend alias is still semantically misleading.

### 2. No SQLite fallback for `/api/live-monitor`

- **File**: `dashboard/app/api/server.py:2051`
- **Problem**: `get_live_monitor()` calls `query_sql()` which hits the Fabric SQL Analytics Endpoint. Unlike `/api/entity-digest` which has a SQLite primary path, the live monitor has no local fallback. If the Fabric SQL endpoint is down or has sync lag, the live monitor returns empty arrays silently. The page handles this gracefully (supplementary data), but it means activity indicators never light up when Fabric SQL is unavailable.
- **Fix needed**: Consider adding a SQLite fallback path using the local `fmd_control_plane.db` logging tables, or at minimum return a `"fallback": true` flag so the frontend can show a "live data unavailable" indicator.

---

## No Issues Found

- **Anti-flash loading**: Correctly handled. The `useEntityDigest` hook implements `hasLoadedOnce` internally, and the page checks `loading && !data` which evaluates false after first load since `data` persists.
- **`.toLocaleString()` safety**: All `.toLocaleString()` calls operate on guaranteed numeric values from the hook's `reduce` initializer or from `LayerStats` objects.
- **PascalCase/camelCase alignment**: The `LiveData` interface matches the backend's PascalCase response keys (`PipelineName`, `LogType`, etc.). The `DigestEntity` uses camelCase which is normalized by the `useEntityDigest` hook.
- **React Flow integration**: Node/edge types properly registered, `fitView` enabled, `proOptions.hideAttribution` set.
- **Drawer cleanup**: Click-outside and Escape handlers both properly clean up in effect return functions.
