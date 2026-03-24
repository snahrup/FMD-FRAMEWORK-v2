# AUDIT: TestAudit.tsx (Wave 4)

**Page**: `dashboard/app/src/pages/TestAudit.tsx` (1082 lines)
**Backend**: `dashboard/app/api/routes/test_audit.py` (213 lines)
**Audited**: 2026-03-23
**Previous audit**: 2026-03-13 (all 4 routes were missing; since resolved)

---

## Summary

TestAudit is a hidden dev page that runs Playwright test suites and displays results with pass/fail charts, screenshots, videos, and Playwright trace viewer. All 4 backend routes now exist and function. This audit found **12 findings**: 1 security, 1 truth bug, 4 design-system, 3 accessibility, 2 dead code, 1 error handling.

**Verdict**: PASS after fixes applied in this audit.

---

## Findings

### TA-1: Path traversal via multi-segment testDir in server.py (SECURITY / FIXED)

**Severity**: HIGH
**File**: `dashboard/app/api/server.py` line 236

The server dispatcher used `"/".join(parts[5:-1])` to reconstruct `testDir`, allowing arbitrary multi-segment paths like `/api/audit/artifacts/runId/../../etc/passwd/fn`. While `serve_audit_artifact()` has a `"/" in component` check that would reject this, the inconsistency between the server (allowing multi-segment) and the validator (rejecting "/") meant behavior was ambiguous and relied entirely on the defense-in-depth `resolve().relative_to()` check.

**Fix**: Changed server.py to require exactly 7 URL segments (`["", "api", "audit", "artifacts", runId, testDir, fn]`), rejecting any multi-segment paths.

### TA-2: Undefined CSS token `--bp-surface-2` (TRUTH BUG / FIXED)

**Severity**: MEDIUM
**File**: `TestAudit.tsx` line 694

The expanded test card detail panel used `background: 'var(--bp-surface-2)'` which does not exist in the design system (`index.css`). The only surface tokens are `--bp-surface-1` and `--bp-surface-inset`. This caused the background to fall through to `transparent`, making text hard to read against the grid background.

**Fix**: Changed to `var(--bp-surface-inset)`.

### TA-3: Hardcoded hex `#0a0a1a` for trace overlay background (DESIGN SYSTEM / FIXED)

**Severity**: LOW
**File**: `TestAudit.tsx` line 610

The trace activation overlay used a Tailwind arbitrary value `bg-[#0a0a1a]` instead of a design token.

**Fix**: Changed to `style={{ background: 'var(--bp-code-block)' }}` (maps to `#2B2A27`).

### TA-4: Hardcoded hex values in Recharts chart components (DESIGN SYSTEM / DOCUMENTED)

**Severity**: LOW
**Files**: `TestAudit.tsx` lines 432-434, 466-467, 548-551, 559

Recharts SVG attributes (`fill`, `stroke`) do not resolve CSS custom properties. The hex values `#3D7C4F`, `#B93A2A`, `#C27A1A`, `#78716C`, `rgba(0,0,0,0.04)`, and `#666` are used directly in SVG.

**Fix**: Extracted into named constants (`CHART_COLORS`, `CHART_AXIS_COLOR`, `CHART_GRID_COLOR`) with comments mapping each to its BP token. The `#666` fallback was replaced with `CHART_AXIS_COLOR`. This is the best practice for Recharts — raw hex is required, but centralized constants make updates easy.

### TA-5: Unused imports — `BarChart3`, `ChevronLeft`, `X`, `Legend` (DEAD CODE / FIXED)

**Severity**: LOW
**File**: `TestAudit.tsx` lines 12, 17

Four Lucide icons and one Recharts component were imported but never used in the file body.

**Fix**: Removed from imports.

### TA-6: Missing accessibility attributes on interactive elements (A11Y / FIXED)

**Severity**: MEDIUM
**File**: `TestAudit.tsx` lines 659, 862, 610

Three clickable `<div>` elements lacked `role="button"`, `tabIndex`, `aria-label`, and keyboard event handlers:
- TestCard header row (expand/collapse)
- RunHistoryRow (select a run)
- Trace activation overlay (load trace)

**Fix**: Added `role="button"`, `tabIndex={0}`, `aria-label`, `aria-expanded`/`aria-current` where appropriate, and `onKeyDown` handlers for Enter/Space.

### TA-7: Silently swallowed fetch errors in loadHistory and checkStatus (ERROR HANDLING / FIXED)

**Severity**: LOW
**File**: `TestAudit.tsx` lines 911, 924

Both `catch` blocks contained only comments (`/* no history */`, `/* ignore */`), making it impossible to diagnose network failures or backend errors during development.

**Fix**: Added `console.warn` calls with descriptive prefixes.

### TA-8: `log.exception` called without active exception (BACKEND BUG / FIXED)

**Severity**: LOW
**File**: `test_audit.py` line 185

`log.exception()` was used in a `except ValueError` block, but the intent was to log a warning about path escapes, not an unexpected exception trace. The traceback it would emit is the `ValueError` from `relative_to()` which is expected behavior, not an error.

**Fix**: Changed to `log.warning()`.

### TA-9: Missing null-byte and control-character check in artifact path validation (SECURITY / FIXED)

**Severity**: MEDIUM
**File**: `test_audit.py` line 175

The path component validation checked for `..`, `/`, and `\` but did not reject null bytes (`\x00`) or other control characters that could cause unexpected behavior in filesystem operations.

**Fix**: Added empty-string check and control-character rejection (`ord(c) < 32`).

### TA-10: No `aria-live` region for running status indicator (A11Y / DEFERRED)

**Severity**: LOW
**File**: `TestAudit.tsx` line 969-973

The "Running..." pill with the spinner animation has no `aria-live="polite"` to announce status changes to screen readers.

**Status**: DEFERRED — low-traffic dev page.

### TA-11: Error displayed via `alert()` on trigger failure (UX / DEFERRED)

**Severity**: LOW
**File**: `TestAudit.tsx` lines 942, 945

Failed audit triggers show a browser `alert()` instead of an inline error banner. Acceptable for a dev-only page.

**Status**: DEFERRED.

### TA-12: TestCard key uses array index (MINOR / DEFERRED)

**Severity**: LOW
**File**: `TestAudit.tsx` line 1074

`<TestCard key={i} .../>` uses array index as React key. Since the sort order is stable per render and the list is not mutated, this is functionally fine but not ideal.

**Status**: DEFERRED.

---

## Files Changed

| File | Changes |
|------|---------|
| `dashboard/app/src/pages/TestAudit.tsx` | TA-2, TA-3, TA-4, TA-5, TA-6, TA-7 |
| `dashboard/app/api/routes/test_audit.py` | TA-8, TA-9 |
| `dashboard/app/api/server.py` | TA-1 |

## Score

- **Findings**: 12 total
- **Fixed**: 9 (TA-1 through TA-9)
- **Deferred**: 3 (TA-10, TA-11, TA-12)
- **Verdict**: PASS — no remaining truth bugs, security issues resolved, design system aligned
