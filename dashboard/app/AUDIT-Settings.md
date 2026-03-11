# Settings Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/Settings.tsx` (~1114 lines)
Backend: `dashboard/app/api/server.py`

---

## Page Structure

The Settings page has two tabs controlled by a left sub-nav:
1. **General** (`GeneralTab`) -- Contains the legacy DeployWizard (notebook-based deployment) and Labs feature toggles
2. **Deployment** -- Renders `DeploymentManager` from `./settings/DeploymentManager.tsx` (separate component, not part of this audit)

### Components
- `DeployWizard` (internal, ~770 lines) -- Multi-step deployment wizard: idle -> config -> preflight -> confirm -> running -> done/failed
- `GeneralTab` (exported) -- Wraps DeployWizard + Labs toggles
- `Settings` (default export) -- Tab navigation shell

### API Endpoints Used
| Endpoint | Method | Handler (server.py) | Used In |
|----------|--------|---------------------|---------|
| `/api/notebook-config` | GET | `get_notebook_config()` L5755 | Config step, prefill fields |
| `/api/fabric/workspaces` | GET | Inline handler L8668 | Config step, workspace dropdown |
| `/api/fabric/connections` | GET | Inline handler L8678 | Config step, connection dropdown |
| `/api/fabric/security-groups` | GET | Inline handler L8694 | Config step (fetched but only decorative) |
| `/api/notebook-config/update` | POST | `update_notebook_config()` L5814 | Preflight + Deploy, saves config |
| `/api/deploy/preflight` | GET | `deploy_preflight()` L6655 | Preflight step |
| `/api/deploy/wipe-and-trigger` | POST | `deploy_wipe_and_trigger()` L7007 | Deploy step |
| `/api/notebook/job-status` | GET | `get_notebook_job_status()` L7107 | Polling during running step |

### Shared Hooks/Libs
- `@/lib/featureFlags` -- `getLabsFlags`, `setLabsFlag`, `LabsFlags` type. Pure localStorage, no API calls. No issues found.

---

## Frontend Bugs Fixed

### 1. Config update errors silently ignored (MEDIUM)
**Problem:** `postJson("/notebook-config/update", ...)` was called in two places (the preflight button handler at ~L537 and `handleDeploy` at ~L308) without checking the response body for `error`. The backend `update_notebook_config()` can return `{error: "Section X not found"}` with HTTP 200, which `postJson` doesn't throw on. Config could silently fail, leading to preflight/deploy using stale values.
**Fix:** Added `const cfgRes = await postJson<{ error?: string }>(...)` and `if (cfgRes.error) throw new Error(cfgRes.error)` after each config update call. Both the preflight button and `handleDeploy` now surface config save errors to the user.

### 2. Potential crash on displayName.startsWith() in connection filter (MEDIUM)
**Problem:** Line ~402: `c.displayName.startsWith('CON_FMD')` inside `fabricConnections.filter()`. If any connection item has a null/undefined `displayName` at runtime (despite the TypeScript type declaring `string`), this crashes the entire config step.
**Fix:** Changed to `(c.displayName ?? '').startsWith('CON_FMD')` for defensive null coalescing.

### 3. Log timestamp shows wrong values for manually-injected messages (LOW)
**Problem:** Line ~837: `formatElapsed(DEPLOY_PHASES[i]?.after ?? 0)` uses the message array index `i` to look up `DEPLOY_PHASES[i]`. But `logMessages` contains both manually-injected entries (config saved, delete log, notebook triggered) and phase-emitted entries. After ~6 manual messages, message index 6 maps to `DEPLOY_PHASES[6]` (45s) when the actual phase message comes from `DEPLOY_PHASES[2]` (8s). Timestamps were misaligned for all messages after the manual ones.
**Fix:** Changed to `DEPLOY_PHASES[i] != null ? formatElapsed(DEPLOY_PHASES[i].after) : '\u00A0\u00A0\u00A0'` -- messages that don't correspond to a phase entry show a blank timestamp instead of a wrong one.

### 4. Invalid Date rendered for empty endTime (LOW)
**Problem:** Line ~879: `new Date(jobStatus.endTime).toLocaleTimeString()` -- if `endTime` is an empty string (backend returns `''` when `endTimeUtc` is missing), `new Date('')` creates an Invalid Date and `toLocaleTimeString()` renders the literal text "Invalid Date".
**Fix:** Added `!isNaN(new Date(jobStatus.endTime).getTime())` guard so the "Finished at" text only renders when the date is valid.

---

## Backend Issues (Not Fixed -- Requires server.py Changes)

### B1. notebook-config/update returns 200 with error body (LOW)
**File:** `server.py` line ~5814 (`update_notebook_config`)
**Problem:** When the YAML section is not found or is not a dict, the function returns `{error: '...'}` with HTTP 200. The frontend now checks for this (see Fix #1), but ideally the server should return 4xx for client errors.
**Fix needed:** Return a non-200 status code (e.g., 400) when `update_notebook_config` encounters an error, so `postJson`'s `r.ok` check catches it naturally.

### B2. deploy/wipe-and-trigger has no error checking after workspace deletion (LOW)
**File:** `server.py` line ~7014-7042 (`deploy_wipe_and_trigger`)
**Problem:** If workspace deletion fails (e.g., permission denied), the function logs "Failed to delete..." in the `deleteLog` but continues to trigger the notebook anyway. A partial delete could leave the environment in an inconsistent state.
**Fix needed:** Consider making workspace deletion failures fatal (return early with error) or at minimum surface a warning in the response that the frontend can display.

### B3. No rate limiting on deploy/wipe-and-trigger (LOW)
**File:** `server.py` line ~9116
**Problem:** The endpoint has no guard against being called multiple times concurrently. Two rapid clicks could trigger two notebook runs and two workspace deletions.
**Fix needed:** Add a server-side lock or "deployment in progress" flag.

---

## Shape Verification Summary

All API response shapes match frontend expectations:
- `/api/notebook-config` returns `{itemConfig: {workspaces: {...}, connections: {...}}}` -- matches destructuring at L211-221
- `/api/fabric/workspaces` returns `{workspaces: [{id, displayName}]}` -- matches L203
- `/api/fabric/connections` returns `{connections: [{id, displayName, type}]}` -- matches L204
- `/api/fabric/security-groups` returns `{groups: [{id, displayName, description}]}` -- matches L205
- `/api/deploy/preflight` returns `{workspaces: [...], connections: [...], notebook: {...}, ready: bool}` -- matches `PreflightResult` interface
- `/api/deploy/wipe-and-trigger` returns `{success?, notebookId?, workspaceId?, error?, deleteLog?}` -- matches destructuring at L324-330
- `/api/notebook/job-status` returns `{jobs?: [{id, status, startTime, endTime, failureReason}], error?}` -- matches `JobStatus` interface

No PascalCase/camelCase mismatches found. Backend uses camelCase consistently for these endpoints.

---

## No Issues Found

- **Anti-flash loading:** Not applicable. The `fabricLoading` state is only set once when entering the config step (not in a polling loop).
- **Labs toggles:** Pure localStorage operations via `featureFlags.ts`. No API calls, no async, no crash risks.
- **Tab URL sync:** Correctly uses `replaceState` to sync `?tab=` param. No issues.
- **Cleanup on unmount:** `stopPolling` is called via useEffect cleanup (L237). Intervals/timeouts are properly cleared.
- **Error boundaries:** All fetch calls are wrapped in try/catch. Failed state shows error message and retry/cancel buttons.
