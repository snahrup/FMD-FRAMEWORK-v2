# AUDIT: TestAudit.tsx

**Page**: `dashboard/app/src/pages/TestAudit.tsx`
**Backend**: None migrated -- all 4 endpoints missing
**Audited**: 2026-03-13

---

## Summary

TestAudit is a Playwright test runner dashboard. It displays test run history with pass/fail rates, duration charts, screenshots, videos, and trace files. It calls 4 API endpoints and serves static artifacts. **All 4 endpoints are missing** from the refactored route registry -- none were migrated from `server.py.bak`.

**Verdict**: FAIL -- 4 missing backend routes, page is non-functional

---

## API Calls Traced

### 1. `GET /api/audit/history`

**Frontend** (line 904): `fetchJson<RunSummary[]>("/api/audit/history")`

**Expected return**: Array of `RunSummary` objects with `runId`, `timestamp`, `durationMs`, `total`, `passed`, `failed`, `skipped`, `tests[]`.

**Backend**: **MISSING** -- no route registered for `/api/audit/history` in any `routes/*.py` file.

**Impact**: Test run history never loads. The page shows a permanent loading state, then falls through to an empty view.

**Data source**: This endpoint would read from the filesystem -- Playwright generates JSON result files, not from SQLite. No SQLite tables are involved.

### 2. `GET /api/audit/status`

**Frontend** (line 917): `fetchJson<AuditStatus>("/api/audit/status")`

**Expected return**: `{ status: "running" | "idle", pid?: number, lastExitCode?: number }`

**Backend**: **MISSING** -- no route registered.

**Impact**: Cannot determine if a test run is in progress. The status indicator is always stale.

**Data source**: This would check if a Playwright process is running (OS-level check, not SQLite).

### 3. `POST /api/audit/run`

**Frontend** (line 938): `postJson<...>("/api/audit/run")`

**Expected return**: `{ status: string, error?: string, pid?: number }`

**Backend**: **MISSING** -- no route registered.

**Impact**: "Run Tests" button does nothing (returns 404). Cannot trigger Playwright runs from the dashboard.

**Data source**: This would spawn a Playwright subprocess. No SQLite involvement.

### 4. `GET /api/audit/artifacts/{runId}/{testDir}/{fileName}`

**Frontend** (line 365): URL constructed for screenshots, videos, and trace files:
```typescript
`${API}/api/audit/artifacts/${runId}/${testDir}/${fileName}`
```

Also referenced at line 842 for trace URLs.

**Backend**: **MISSING** -- no route registered for artifact serving.

**Impact**: Screenshots, videos, and trace files cannot be loaded. All media panels show broken images or failed downloads.

**Data source**: Static file serving from the Playwright output directory. No SQLite.

---

## Bugs Found

### BUG-TA-1: All 4 audit API routes missing (CRITICAL / PAGE-BREAKING)

| Route | Method | Purpose | Status |
|---|---|---|---|
| `/api/audit/history` | GET | Load test run history | **MISSING** |
| `/api/audit/status` | GET | Check if tests are running | **MISSING** |
| `/api/audit/run` | POST | Trigger a Playwright test run | **MISSING** |
| `/api/audit/artifacts/{...}` | GET | Serve screenshots/videos/traces | **MISSING** |

**Was in**: `server.py.bak` (the old monolithic server, these were likely inline handlers)
**Impact**: The entire TestAudit page is non-functional. No test data can be loaded, no tests can be triggered, no artifacts can be viewed.

### BUG-TA-2: Double `/api/` prefix in artifact URLs (MINOR)

**File**: `TestAudit.tsx` line 365
**Code**: `return \`${API}/api/audit/artifacts/...\``

The `API` constant is set to `import.meta.env.VITE_API_URL || ""` (line 20). If `VITE_API_URL` is empty (the default), the URL becomes `/api/audit/artifacts/...` which is correct. But if `VITE_API_URL` is set to something like `http://localhost:8787/api`, the URL would be `http://localhost:8787/api/api/audit/artifacts/...` -- a double `/api/` prefix.

**Note**: In the other pages, `API` is set to `"/api"` and paths are relative (e.g., `fetchJson("/connections")` becomes `/api/connections`). But TestAudit sets `API = import.meta.env.VITE_API_URL || ""` and then uses `/api/audit/...` paths, so the path already includes the `/api` prefix.

The `fetchJson` and `postJson` helpers (lines 328-340) do `fetch(\`${API}${path}\`)` where `path` already starts with `/api/`, so when `API` is empty, it becomes `/api/audit/history` -- which is correct for the router that matches on `/api/audit/history`.

This is inconsistent with other pages but functionally correct when `VITE_API_URL` is unset.

---

## SQLite Impact Assessment

**None**. The TestAudit page has zero SQLite dependencies. All its data comes from:
- Playwright JSON output files (test results)
- Playwright artifact files (screenshots, videos, traces)
- OS process management (spawning and monitoring Playwright)

This page is entirely file-system and process-based.

---

## Verdict

- **0 of 4** backend routes exist in the refactored route registry
- The page is 100% non-functional in the current server architecture
- No SQLite correctness issues (the page doesn't use SQLite at all)
- All 4 routes need to be created in a new `routes/audit.py` file
- Artifact serving requires a static file handler or a new route that reads from the Playwright output directory
