# AUDIT-EM: Execution Matrix Page Audit

**Files audited**:
- `dashboard/app/src/pages/ExecutionMatrix.tsx` (716 lines)
- `dashboard/app/api/routes/entities.py` (705 lines)
- `dashboard/app/api/routes/engine.py` (416 lines)

**Shared hooks (read-only, not modified)**:
- `dashboard/app/src/hooks/useEntityDigest.ts`
- `dashboard/app/src/hooks/useEngineStatus.ts`

**Audited**: 2026-03-23

---

## Summary

6 findings across 3 files. 4 fixed in-band, 2 deferred (shared hook/component or out-of-scope engine code).

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| EM-01 | MEDIUM | `DONUT_COLORS` computed at module load; CSS vars may not be ready | FIXED |
| EM-02 | LOW | Unused `DigestEntity` type import | FIXED |
| EM-03 | MEDIUM | Missing aria-labels on all interactive controls (2 selects, 1 input, 3 buttons) | FIXED |
| EM-04 | LOW | `_DS_DISPLAY_NAMES` missing OPTIVA (5th of 5 sources) | FIXED |
| EM-05 | LOW | Entity logs missing `entity_name` — `engine/api.py` `_handle_logs()` returns raw `engine_task_log` rows without joining `lz_entities` for name | DEFERRED |
| EM-06 | LOW | `useEngineStatus` hook `fetchJson` calls `.json()` without checking `Content-Type` header — could crash on HTML error pages | DEFERRED |

---

## Findings Detail

### EM-01 — DONUT_COLORS race condition (MEDIUM) — FIXED

**Location**: `ExecutionMatrix.tsx` line 57 (original)
**Problem**: `DONUT_COLORS` was a module-level const calling `cssVar()` which reads `getComputedStyle(document.documentElement)`. At module import time, CSS custom properties may not be loaded yet, producing empty strings and invisible donut chart segments.
**Fix**: Moved `DONUT_COLORS` into the component body as a `useMemo` with empty deps, so it evaluates after the component mounts (when stylesheets are applied).

### EM-02 — Unused DigestEntity import (LOW) — FIXED

**Location**: `ExecutionMatrix.tsx` line 13
**Problem**: `type DigestEntity` was imported but never referenced in the component body.
**Fix**: Removed the unused type import.

### EM-03 — Missing aria-labels (MEDIUM) — FIXED

**Location**: `ExecutionMatrix.tsx` lines 330-396
**Problem**: Six interactive controls had no `aria-label` or associated `<label>`:
- Source filter `<select>`
- Status filter `<select>`
- Search `<input>`
- Auto-refresh `<Button>`
- Refresh `<Button>`
- Error filter clear `<button>`

**Fix**: Added `aria-label` attributes to all six controls.

### EM-04 — Missing OPTIVA display name (LOW) — FIXED

**Location**: `entities.py` line 34-39
**Problem**: `_DS_DISPLAY_NAMES` mapped 4 of 5 source databases but omitted OPTIVA. The fallback returns the raw database name, so it works but is inconsistent with other sources having friendly display names.
**Fix**: Added `"OPTIVA": "Optiva"` to the mapping.

### EM-05 — Entity logs missing entity_name (LOW) — DEFERRED

**Location**: `engine/api.py` `_handle_logs()` (out of scope — in `engine/` not `dashboard/app/api/routes/engine.py`)
**Problem**: The engine logs endpoint returns raw rows from `engine_task_log` which lacks a `SourceName` column. The frontend normalizer in `useEngineStatus.ts` tries `r.entity_name ?? r.SourceName ?? r.EntityName`, all undefined, so entity names in log detail show as empty string.
**Reason for deferral**: The fix requires editing `engine/api.py` (not in scope) to join `lz_entities` on `EntityId = LandingzoneEntityId`.

### EM-06 — fetchJson lacks Content-Type guard (LOW) — DEFERRED

**Location**: `useEngineStatus.ts` line 94-98
**Problem**: `fetchJson` calls `res.json()` after checking `res.ok`, but doesn't verify the response is actually JSON. If a reverse proxy returns an HTML error page with status 200, this would throw an unhandled JSON parse error.
**Reason for deferral**: This is in the shared `useEngineStatus` hook which is out of scope for in-band fixes.

---

## Checklist Results

| Check | Result |
|-------|--------|
| Truth bugs (fake data, Math.random, hardcoded counts) | CLEAN — no fabricated data found |
| Dead code (unused imports, commented blocks) | EM-02 fixed |
| Error handling (unguarded .json, crash-on-404) | EM-06 deferred (shared hook) |
| Backend validation (SQL injection, input sanitization) | CLEAN — entities.py uses parameterized queries; engine.py validates entity_id as int |
| Hardcoded hex colors | CLEAN — all colors use `var(--bp-*)` design tokens |
| Accessibility (aria-labels, roles, keyboard nav) | EM-03 fixed |
| Input validation | CLEAN — search is client-side only; backend filters use Python equality checks |
| Loading states | CLEAN — initial loading spinner present (line 440-445) |
| Empty states | CLEAN — handled via conditional rendering (charts/panels hidden when no data) |
| API response shape mismatch | EM-05 deferred (entity_name in logs) |
| DONUT_COLORS timing | EM-01 fixed |
