# AUDIT: NotebookDebug (AUDIT-ND)

**Date**: 2026-03-23
**Frontend**: `dashboard/app/src/pages/NotebookDebug.tsx`
**Backend**: `dashboard/app/api/routes/notebook.py`

---

## Summary

The NotebookDebug page ("Pipeline Testing") is functionally sound. The backend routes have been migrated from the old `server.py.bak` into `routes/notebook.py`. The primary issues found are: (1) a response shape mismatch where the backend passes raw Fabric `failureReason` but the frontend expects `{message, errorCode}`, (2) missing `res.ok` guards on all four fetch calls causing silent failures on non-200 responses, (3) missing UUID validation on user-supplied IDs that get interpolated into Fabric API URLs, (4) missing layer validation on the run endpoint allowing invalid layers to fall through to an else clause, and (5) missing input type validation on `maxEntities`.

---

## Findings

### ND-01 | CRITICAL | failureReason shape mismatch between backend and frontend
**Description**: The frontend `JobStatus` and `JobEntry` interfaces expect `failureReason` to be `{ message: string; errorCode: string }` and access `.message` / `.errorCode` directly. The backend `/api/notebook-debug/job-status` endpoint passes the raw Fabric API `failureReason` through unchanged — which can be a dict with different keys, a plain string, or null. When it's a string, `failureReason.message` is `undefined` and the error display silently shows nothing.
**Fix**: Added `_normalize_failure_reason()` helper in `notebook.py` that normalizes any shape into `{message, errorCode}` or `None`. Applied to both single-job and job-list responses.
**Status**: FIXED

### ND-02 | HIGH | Unguarded .json() on non-ok responses (4 fetch calls)
**Description**: All four fetch calls in the frontend call `.json()` without checking `res.ok`. On 4xx/5xx responses, `res.json()` may throw a parse error (if body is not JSON) or silently process an error body as if it were valid data.
**Locations**: Lines 138 (notebooks), 154 (entities), 184 (job-status polling), 231 (run trigger).
**Fix**: Added `if (!res.ok) throw new Error(...)` before each `.json()` call.
**Status**: FIXED

### ND-03 | HIGH | Missing UUID validation on user-supplied IDs in URL interpolation
**Description**: `notebookId`, `jobId`, and `workspaceId` from user input are interpolated directly into Fabric API URLs without format validation. A crafted value could alter the URL path (e.g., `../` sequences). While Fabric's API would likely reject it, defense-in-depth requires validation.
**Locations**: `post_debug_run`, `get_debug_job_status`, `get_setup_job_status`.
**Fix**: Added `_is_valid_uuid()` check. All user-supplied IDs are now validated as UUID format before use. Returns 400 on invalid format.
**Status**: FIXED

### ND-04 | MEDIUM | Missing layer validation on run endpoint
**Description**: `post_debug_run` validates layer for the entity-list endpoint (`get_debug_entities` raises HttpError for unknown layers) but the run endpoint's count query uses `else: # silver` as a catch-all. Any layer value other than "landing" or "bronze" silently runs as silver.
**Fix**: Added explicit layer validation at the top of `post_debug_run` — raises 400 for unknown layers. Changed `else` to `elif layer == "silver"`.
**Status**: FIXED

### ND-05 | MEDIUM | int() crash on non-numeric maxEntities
**Description**: `int(params.get("maxEntities", 0))` throws `ValueError` if the user sends a non-numeric string, crashing the request handler with an unhandled exception.
**Fix**: Wrapped in try/except, returns 400 with a clear message.
**Status**: FIXED

### ND-06 | LOW | Dead fields in LAYER_INFO constant
**Description**: `LAYER_INFO` objects each have 5 unused fields (`activeBg`, `activeBorder`, `badgeBg`, `badgeText`, `dotColor`) all set to empty strings. These are never read anywhere in the component.
**Fix**: Removed the unused fields and simplified the type definition.
**Status**: FIXED

### ND-07 | LOW | Hardcoded `#FFFFFF` hex color
**Description**: Line 316 uses `#FFFFFF` for white text on the active step number badge. The design system has no `--bp-*` token for white/inverse text (only `--text-inverse` from an older system).
**Fix**: N/A — no suitable bp-token exists.
**Status**: DEFERRED (needs design-system-level token addition first)

---

## Deferred Items

| ID | Severity | Reason |
|----|----------|--------|
| ND-07 | LOW | No `--bp-*` design token for white/inverse text exists in the design system. Fixing requires adding one to `index.css` first, which is outside the scope of this two-file audit. |

---

## Files Modified

- `dashboard/app/src/pages/NotebookDebug.tsx` — ND-02 (4x res.ok guards), ND-06 (dead fields removed)
- `dashboard/app/api/routes/notebook.py` — ND-01 (failureReason normalization), ND-03 (UUID validation), ND-04 (layer validation), ND-05 (maxEntities type safety)
