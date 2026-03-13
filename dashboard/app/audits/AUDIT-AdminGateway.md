# AUDIT: AdminGateway.tsx

**Page**: `dashboard/app/src/pages/AdminGateway.tsx`
**Backend**: `dashboard/app/api/routes/admin.py`, plus all backends for embedded child components
**Audited**: 2026-03-13

---

## Summary

AdminGateway is a password-protected admin hub that hosts 5 sub-tabs: Environment, Page Visibility, General, Deployment, and Governance. It is a thin shell that embeds child components (`SetupSettings`, `PageVisibilityTab`, `GeneralTab`, `DeploymentManager`, `AdminGovernance`). The gateway itself has 2 critical bugs: the admin auth route is missing, and the page visibility write uses a mismatched API contract.

**Verdict**: FAIL -- 2 missing/mismatched backend routes, plus inherited bugs from child components

---

## API Calls Traced

### 1. Password Verification: `POST /api/admin/auth`

**Frontend** (`lib/pageVisibility.ts` line 42): `fetch(\`${API}/admin/auth\`, { method: "POST", body: JSON.stringify({ password }) })`

**Backend**: **MISSING** -- the route `POST /api/admin/auth` does not exist in `routes/admin.py`. It only has `GET /api/admin/config` and `POST /api/admin/config`. The auth route existed in `server.py.bak` (line 9142) but was NOT migrated.

**Impact**: `verifyAdminPassword()` always returns `false`. Users cannot authenticate into the admin panel at all. The PasswordGate component permanently blocks access.

### 2. Page Visibility Read: `GET /api/admin/config`

**Frontend** (`lib/pageVisibility.ts` line 14): `fetch(\`${API}/admin/config\`)`

**Backend** (`admin.py` line 61): `get_admin_config()` returns `{r["key"]: r["value"] for r in rows}` from `admin_config` table.

The frontend then reads `data.hiddenPages` from the response. The backend returns a flat `{key: value}` dict from `admin_config`, so this would only work if there's a row with `key = "hiddenPages"` and `value` is a JSON string of an array.

**Correctness**: PARTIALLY CORRECT -- the read path works IF `hiddenPages` was stored as a single key in `admin_config`. But see the write bug below.

### 3. Page Visibility Write: `POST /api/admin/config`

**Frontend** (`lib/pageVisibility.ts` line 26):
```typescript
fetch(`${API}/admin/config`, {
  method: "POST",
  body: JSON.stringify({ hiddenPages: pages, password }),
});
```

**Backend** (`admin.py` line 47): `post_admin_config(params)` expects:
```python
key = params.get("key", "")   # Frontend sends "hiddenPages" array, not "key" string
value = params.get("value", "")  # Frontend sends nothing for "value"
```

**BUG**: The frontend sends `{ hiddenPages: [...], password: "..." }`. The backend extracts `params.get("key")` which would be `""` (empty string) and raises `HttpError("key is required", 400)`. The page visibility write is completely broken -- it can never save.

### 4. Environment Tab: `GET /api/setup/current-config`

**Frontend** (`AdminGateway.tsx` line 219): `fetch(\`${API}/setup/current-config\`)`

**Backend**: **MISSING** -- no route registered for `/api/setup/current-config` in any `routes/*.py` file. Was in `server.py.bak` (line 8663) but not migrated.

**Impact**: Environment tab shows loading spinner, then falls back to empty configuration with a warning banner.

### 5-9. Inherited Sub-Component API Calls

| Tab | Component | Endpoints | Status |
|---|---|---|---|
| Environment | `SetupSettings` | Various `/api/setup/*` | **All MISSING** (not migrated) |
| Pages | `PageVisibilityTab` | `GET/POST /api/admin/config` | Write path BROKEN (see BUG-GW-2) |
| General | `GeneralTab` (from Settings) | `GET /api/notebook-config`, etc. | See AUDIT-Settings.md |
| Deployment | `DeploymentManager` | `GET/POST /api/deploy/*` | **All MISSING** (not migrated) |
| Governance | `AdminGovernance` | 7 endpoints | See AUDIT-AdminGovernance.md |

---

## Bugs Found

### BUG-GW-1: `POST /api/admin/auth` route missing (CRITICAL / BLOCKER)

**File**: `dashboard/app/api/routes/admin.py` -- route not present
**Was in**: `server.py.bak` line 9142
**Impact**: Admin password verification always fails. The entire admin gateway is inaccessible. No user can reach any of the 5 sub-tabs.
**Fix**: Add a new route:
```python
@route("POST", "/api/admin/auth")
def post_admin_auth(params):
    _check_admin_password(params)
    return {"ok": True}
```

### BUG-GW-2: Page visibility POST sends wrong request shape (CRITICAL)

**File**: `dashboard/app/src/lib/pageVisibility.ts` line 26-29
**Frontend sends**: `{ hiddenPages: ["...", "..."], password: "..." }`
**Backend expects**: `{ key: "...", value: "...", password: "..." }`
**Impact**: Save always fails with 400 ("key is required"). Hidden page preferences cannot be persisted.
**Fix**: Either change the frontend to send `{ key: "hiddenPages", value: JSON.stringify(pages), password }` OR change the backend to accept the `hiddenPages` array directly.

### BUG-GW-3: `GET /api/setup/current-config` route missing (MAJOR)

**File**: Not migrated from `server.py.bak` line 8663
**Impact**: Environment tab cannot load current configuration. Shows empty config.

---

## Data Source Correctness Detail

| Feature | API Endpoint | SQLite Table | Status |
|---|---|---|---|
| Admin password | `POST /api/admin/auth` | env var `ADMIN_PASSWORD` | **MISSING ROUTE** |
| Hidden pages read | `GET /api/admin/config` | `admin_config` | CORRECT (reads all keys) |
| Hidden pages write | `POST /api/admin/config` | `admin_config` | **BROKEN** (schema mismatch) |
| Environment config | `GET /api/setup/current-config` | N/A (file-based) | **MISSING ROUTE** |
| Governance data | multiple (see AdminGovernance) | multiple | See AUDIT-AdminGovernance.md |

---

## Verdict

- The AdminGateway is **completely inaccessible** due to the missing `/api/admin/auth` route
- Even if auth worked, page visibility save would fail due to request shape mismatch
- Environment tab has a missing route
- Deployment tab has 4 missing routes (see AUDIT-Settings.md)
- Governance tab has 1 critical bug (see AUDIT-AdminGovernance.md)
- The page visibility read path is correct IF `hiddenPages` exists as a key in `admin_config`
