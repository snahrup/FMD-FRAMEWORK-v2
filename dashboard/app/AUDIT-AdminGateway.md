# AdminGateway Page Audit
Audited: 2026-03-11

## Frontend Bugs Fixed

### 1. MEDIUM — Anti-flash loading on tab re-visit (EnvironmentTab + PageVisibilityTab)
**Problem:** Both `EnvironmentTab` and `PageVisibilityTab` were conditionally rendered with `{activeTab === "x" && <Component />}`, which unmounts the component when the user switches tabs. Returning to the tab remounts the component, re-triggers the fetch, and shows the loading spinner again — even though the data was already loaded moments ago.
**Fix:** Changed to `<div className={activeTab === "x" ? "" : "hidden"}>` wrapper so both data-fetching tabs stay mounted across tab switches. Only `GeneralTab`, `DeploymentManager`, and `AdminGovernance` remain conditionally mounted (they don't have the same fetch-on-mount pattern).

### 2. MEDIUM — Memory leak in EnvironmentTab useEffect (no unmount cleanup)
**Problem:** The async IIFE inside `useEffect` had no cancellation mechanism. If the component unmounted before the fetch completed, `setConfig`, `setLoadError`, and `setLoading` would be called on an unmounted component.
**Fix:** Added a `cancelled` flag set to `true` in the cleanup return. All state setters are guarded by `if (cancelled) return` / `if (!cancelled)`.

### 3. MEDIUM — Memory leak in PageVisibilityTab (unmount during save + dangling setTimeout)
**Problem:** Two issues: (a) `save()` calls `setSaving`, `setSaved`, `setError` without checking if the component is still mounted. (b) `setTimeout(() => setSaved(false), 3000)` fires even after unmount, calling `setSaved` on an unmounted component and leaking the timer.
**Fix:** Added `mountedRef` and `savedTimerRef`. All state setters in async callbacks are guarded by `mountedRef.current`. The `savedTimerRef` is cleared in the useEffect cleanup.

### 4. LOW — Race condition in PageVisibilityTab save (double-submit possible via keyboard)
**Problem:** While the save button has `disabled={saving}`, the `save` callback itself did not guard against re-entry. If invoked programmatically or via rapid interaction before React re-renders the disabled state, two concurrent saves could overlap.
**Fix:** Added `if (saving) return` guard at the top of `save()` and added `saving` to the `useCallback` dependency array.

### 5. LOW — EnvironmentTab does not handle non-JSON responses
**Problem:** If the `/api/setup/current-config` endpoint returns a 200 with non-JSON body (e.g., an HTML proxy error page), `resp.json()` throws a `SyntaxError` with an opaque message like "Unexpected token < in JSON at position 0".
**Fix:** Wrapped `resp.json()` in its own try/catch that throws a clearer `"Server returned non-JSON response"` error message.

### 6. LOW — PageVisibilityTab getHiddenPages has no .catch() handler
**Problem:** The `useEffect` called `getHiddenPages().then(...)` with no `.catch()`. While `getHiddenPages` in `pageVisibility.ts` internally catches errors and returns a fallback, a defensive `.catch()` prevents the loading spinner from spinning indefinitely if the contract changes.
**Fix:** Added `.catch(() => { if (mountedRef.current) setLoading(false); })` to the promise chain.

## Backend Issues (documented, not fixed)

### 1. HIGH — Admin password stored in plaintext in React state and sent on every save
**Problem:** After the user authenticates via `PasswordGate`, the plaintext password is stored in `AdminGateway`'s `password` state and passed as a prop to `PageVisibilityTab`. It is sent in the POST body on every save to `/api/admin/config`. This password is visible in React DevTools and browser memory. On the server side (server.py line 9119), the password is compared with `os.environ.get('ADMIN_PASSWORD', '')` using a simple `==` (not constant-time comparison), making it vulnerable to timing attacks.
**Fix needed:** Server should issue a session token or cookie on successful `/api/admin/auth` and validate that token on subsequent requests instead of re-sending the password. Password comparison should use `hmac.compare_digest()` for constant-time comparison.

### 2. HIGH — ADMIN_PASSWORD env var unset returns 500 instead of graceful fallback
**Problem:** If `ADMIN_PASSWORD` is not set in the environment, `/api/admin/auth` returns a 500 error (`"ADMIN_PASSWORD not configured on server"`). However, `/api/admin/config` POST (line 9128-9129) compares against an empty string — meaning an empty password POST would succeed when `ADMIN_PASSWORD` is unset, bypassing auth entirely.
**Fix needed:** `/api/admin/config` POST should also check if `expected` is empty and return 500 if so, matching the behavior of `/api/admin/auth`.

### 3. MEDIUM — verifyAdminPassword swallows network errors as auth failures
**Problem:** `verifyAdminPassword` in `pageVisibility.ts` catches all exceptions (including network errors, timeouts, DNS failures) and returns `false`. The `PasswordGate` component then shows "Invalid password" — misleading when the actual cause is a connectivity issue. The user has no way to distinguish between wrong password and server unreachable.
**Fix needed:** `verifyAdminPassword` should distinguish between auth failure (`res.ok === false`) and network/fetch errors, either by throwing on network errors or returning a discriminated union (e.g., `{ ok: boolean; networkError?: boolean }`).

### 4. LOW — Admin config file written without atomic replacement
**Problem:** `_save_admin_config` in server.py (line 1126-1130) opens the config file with `open(..., 'w')` and writes directly. If the process crashes mid-write, the file is corrupted. No file locking is used for concurrent requests.
**Fix needed:** Write to a temp file and atomically rename, or use file locking.
