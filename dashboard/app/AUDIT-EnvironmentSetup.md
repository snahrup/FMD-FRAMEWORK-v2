# Audit: EnvironmentSetup.tsx

**File**: `dashboard/app/src/pages/EnvironmentSetup.tsx`
**Lines**: 115 -> 141 (after fixes)
**Auditor**: Agent
**Date**: 2026-03-11

---

## Bugs Fixed (Frontend)

### 1. Memory leak on unmount during fetch
**Severity**: Medium
**Lines affected**: 18-52 (useEffect / loadConfig)

The original code used an async IIFE inside `useEffect` with no cleanup. If the component unmounted while the fetch was in-flight, `setConfig`, `setLoadError`, and `setLoading` would fire on an unmounted component, causing a React warning and potential state corruption.

**Fix**: Extracted fetch logic into a `useCallback`-wrapped `loadConfig(signal)` function that accepts an `AbortSignal`. The `useEffect` creates an `AbortController` and returns a cleanup function that calls `ac.abort()`. All setState calls are guarded by `signal.aborted` checks.

### 2. Non-JSON response causes confusing SyntaxError
**Severity**: Low
**Lines affected**: 24-27

If the server returns a non-JSON response (e.g., an HTML error page from a reverse proxy, a 502 gateway page), `resp.json()` throws an opaque `SyntaxError: Unexpected token '<'`. The user would see a cryptic message with no indication of the actual problem.

**Fix**: Added a `content-type` header check before calling `resp.json()`. If the response is not `application/json`, a descriptive error is thrown: `"Expected JSON response but got text/html"`.

### 3. No error recovery (retry)
**Severity**: Low
**Lines affected**: 105-119

If the initial config load failed, the error banner was purely informational with no way to retry. The user had to reload the entire page.

**Fix**: Added a Retry button inside the error banner. It calls `loadConfig()` with a fresh `AbortController`, which clears the error and re-fetches.

### 4. Response shape mismatch silently swallows config
**Severity**: High
**Lines affected**: 33

The original code checked `if (data.config)` but the backend (`setup_get_current_config()` in `server.py` line 5974) returns `{ workspaces, connections_yaml, connections_db, lakehouses, database, fabric }` at the top level -- there is no `config` wrapper. This means `data.config` is always `undefined`, and the loaded configuration was silently discarded every time. The component always started with `EMPTY_CONFIG`.

**Fix**: Changed to `const cfg = data.config ?? (data.workspaces ? data : null)`, which handles both a `config`-wrapped response (forward-compatible) and the current top-level response shape.

---

## Not a Bug

### 5. Mode toggle re-mounts child components
The three mode panels (`ProvisionAll`, `SetupWizard`, `SetupSettings`) use conditional rendering (`mode === "x" && <Component />`), which unmounts/remounts on tab switch. A CSS-hidden pattern would preserve state across tab switches but would also cause all three children to mount eagerly (triggering unnecessary network requests in ProvisionAll). For a low-frequency setup page, the current behavior is acceptable. **No change made.**

### 6. Unused imports
All imports were verified against usage. Every import from `react`, `lucide-react`, `@/lib/utils`, and `./setup/*` is consumed in the component. `RefreshCw` was added for the retry button. **No unused imports found.**

---

## Backend Issues (Documented Only -- Not Fixed)

### B1. Response shape contract mismatch
**File**: `dashboard/app/api/server.py`, line 5974-6036
**Endpoint**: `GET /api/setup/current-config`

`setup_get_current_config()` returns a flat dict with keys `workspaces`, `connections_yaml`, `connections_db`, `lakehouses`, `database`, `fabric`. The frontend originally expected `{ config: EnvironmentConfig }`. Although the frontend fix now handles the top-level shape, the response still does not match the `EnvironmentConfig` TypeScript type:

- Backend returns `connections_yaml` + `connections_db` (two separate dicts); frontend type expects `connections: Record<string, FabricConnection | null>`
- Backend `lakehouses` is keyed by DB name (dynamic); frontend type expects fixed keys `LH_DATA_LANDINGZONE`, `LH_BRONZE_LAYER`, `LH_SILVER_LAYER`
- Backend has no `capacity`, `notebooks`, or `pipelines` fields; frontend type requires all three
- Backend `database` has `endpoint` field; frontend type has `serverFqdn` + `databaseName`

**Recommendation**: Either (a) wrap the backend response in `{ config: ... }` and map to the `EnvironmentConfig` shape server-side, or (b) add a client-side mapping function that transforms the backend response into `EnvironmentConfig`. Option (a) is preferable since it keeps the frontend thin.

### B2. No error wrapping on `setup_get_current_config`
**File**: `dashboard/app/api/server.py`, line 8638-8639

The route handler calls `self._json_response(setup_get_current_config())` with no try/except. If `setup_get_current_config()` raises (e.g., YAML parse error, SQL connection failure beyond the inner try/except blocks), the server will return a 500 with a generic Python traceback rather than a structured JSON error via `_error_response()`.

---

## Summary

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Memory leak on unmount | Medium | Fixed |
| 2 | Non-JSON SyntaxError | Low | Fixed |
| 3 | No retry on load failure | Low | Fixed |
| 4 | `data.config` always undefined | High | Fixed (frontend) |
| 5 | Mode toggle re-mount | N/A | Not a bug |
| 6 | Unused imports | N/A | None found |
| B1 | Response shape mismatch | High | Backend -- not fixed |
| B2 | No error wrapping on route | Low | Backend -- not fixed |
