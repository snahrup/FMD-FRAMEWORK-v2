# AUDIT-AG: AdminGateway Page Audit

**Date**: 2026-03-23 (re-audit; original 2026-03-13)
**Frontend**: `dashboard/app/src/pages/AdminGateway.tsx` (391 lines)
**Backend**: `dashboard/app/api/routes/admin.py` (211 lines)
**Scope**: AdminGateway password gate, tab shell, Page Visibility tab, Environment tab; admin.py routes

---

## Summary

AdminGateway is a password-protected admin hub with 5 sub-tabs (Environment, Page Visibility, General, Deployment, Governance). The previous audit (2026-03-13) found 2 critical bugs (missing `POST /api/admin/auth` route, mismatched `hiddenPages` POST contract) -- both have since been fixed. The `GET /api/setup/current-config` route has also been added. This re-audit found no critical or high-severity bugs. Remaining findings are dead code cleanup, backend input validation hardening, and accessibility gaps.

**Verdict**: PASS -- no truth bugs, no crash paths, no fabricated data. All fixes are hardening and a11y.

---

## Previous Critical Bugs -- Status

| Original ID | Finding | Previous Status | Current Status |
|---|---|---|---|
| BUG-GW-1 | `POST /api/admin/auth` route missing | CRITICAL | RESOLVED -- route exists at line 48 |
| BUG-GW-2 | Page visibility POST shape mismatch | CRITICAL | RESOLVED -- backend now handles `hiddenPages` key directly (line 59) |
| BUG-GW-3 | `GET /api/setup/current-config` missing | MAJOR | RESOLVED -- route exists at line 144 |

---

## Summary Table

| # | Category | Finding | Severity | Status |
|---|----------|---------|----------|--------|
| 1 | Dead code | Redundant `import json as _json` inside `post_admin_config` -- top-level `json` already imported | LOW | FIXED |
| 2 | Backend validation | `POST /api/admin/config` generic key/value path has no length limits on key or value | MEDIUM | FIXED |
| 3 | Accessibility | Password input missing `aria-label` and `autocomplete` attribute | LOW | FIXED |
| 4 | Accessibility | Page toggle buttons missing `aria-pressed` and `aria-label` | LOW | FIXED |
| 5 | Accessibility | Tab navigation missing `role="tablist"`, `role="tab"`, `aria-selected` | LOW | FIXED |
| 6 | Accessibility | Tab content area missing `role="tabpanel"` | LOW | FIXED |
| 7 | Security | `GET /api/admin/config` returns all config without auth -- POST requires auth but GET does not | LOW | DEFERRED |
| 8 | Hardcoded colors | `text-emerald-500`, `text-red-400`, `text-amber-400` etc. are raw Tailwind colors, not semantic tokens | LOW | DEFERRED |
| 9 | Backend | `GET /api/fabric/security-groups` always returns empty array | LOW | DEFERRED |

---

## Detailed Findings

### F1: Redundant `import json as _json` (FIXED)

**Line 60** of `admin.py`: `import json as _json` inside the `post_admin_config` function body. The top-level `import json` (line 8) is already available. The inline import shadows it unnecessarily.

**Fix**: Removed the inline import; changed `_json.dumps` to `json.dumps`.

### F2: Missing key/value length validation (FIXED)

**Lines 66-68** of `admin.py`: The generic `{key, value}` path in `POST /api/admin/config` validates that `key` is non-empty but does not limit length. An authenticated admin could store arbitrarily large keys or values in the SQLite database.

**Fix**: Added `key` max length of 128 characters and `value` max size of 64KB.

### F3: Password input missing `aria-label` (FIXED)

**Line 306** of `AdminGateway.tsx`: The password `<input>` had a `placeholder="Password"` but no `aria-label`. Screen readers may not announce the field purpose. Also missing `autoComplete="current-password"` which causes browser console warnings.

**Fix**: Added `aria-label="Admin password"` and `autoComplete="current-password"`.

### F4: Page toggle buttons missing ARIA state (FIXED)

**Lines 150-169** of `AdminGateway.tsx`: The page visibility toggle buttons visually indicate hidden/visible state but lack `aria-pressed` for screen readers. Also no `aria-label` describing the action.

**Fix**: Added `aria-pressed={!isHidden}` and `aria-label` with contextual text (e.g., "Show Execution Matrix" / "Hide Execution Matrix").

### F5-6: Tab navigation missing ARIA semantics (FIXED)

**Lines 360-389** of `AdminGateway.tsx`: The admin sub-nav uses `<button>` elements styled as tabs but without proper ARIA tab roles. Screen readers cannot navigate them as a tab interface.

**Fix**: Added `role="tablist"` with `aria-label="Admin sections"` on the `<nav>`, `role="tab"` and `aria-selected` on each button, and `role="tabpanel"` on the content container.

---

## Deferred Items

### D1: GET /api/admin/config unauthenticated (LOW)

The read endpoint returns all admin_config rows (currently just `hiddenPages`) without requiring the admin password. The POST route requires auth. This asymmetry is intentional -- `getHiddenPages()` is called by `AppLayout` to filter the sidebar for all users, not just admins. Requiring auth on GET would break the sidebar for non-admin users. No action needed.

### D2: Hardcoded Tailwind color classes (LOW)

`text-emerald-500`, `text-red-400`, `text-amber-400`, `border-red-400`, `bg-amber-500/10`, `border-amber-500/30` are used for success/error/warning states. These are consistent with every other non-Gold dashboard page. Converting to `var(--bp-*)` tokens is a project-wide effort, not scoped to this audit.

### D3: Security groups endpoint returns empty (LOW)

`GET /api/fabric/security-groups` always returns `{"groups": []}`. This is documented in the code as intentional -- security groups are not stored locally. The frontend handles empty arrays gracefully. No action needed unless the feature is implemented.
