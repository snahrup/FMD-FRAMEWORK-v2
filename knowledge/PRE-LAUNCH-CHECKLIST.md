# PRE-LAUNCH CHECKLIST — Monday Demo Readiness

> **Status**: READY FOR MONDAY DEMO
> **Validated on**: 2026-04-11
> **Purpose**: Current go/no-go checklist for the FMD dashboard demo environment

---

## 1. Release Gates

- [x] Frontend production build succeeds: `cd dashboard/app && npm run build`
- [x] Frontend lint gate is green: `cd dashboard/app && npm run lint`
- [x] API test suite is green: `python -m pytest dashboard/app/api/tests -q`
- [x] Engine test suite is green: `python -m pytest engine/tests -q`
- [x] Root URL serves the built SPA from `dashboard/app/dist`
- [x] Engine status endpoint is healthy: `GET /api/engine/status`

### Current validation results

| Gate | Result |
|------|--------|
| Frontend build | PASS |
| Frontend lint | PASS (`0` errors, warnings remain non-blocking) |
| API tests | PASS (`288 passed`) |
| Engine tests | PASS (`329 passed, 6 skipped`) |
| Browser smoke sweep | PASS |

---

## 2. Demo-Critical User Paths

- [x] `/overview` loads cleanly
- [x] `/catalog-portal` loads cleanly with no duplicate-key console errors
- [x] `/labs/dq-scorecard` loads cleanly and `/api/labs/dq-trends` returns data
- [x] `/load-mission-control` loads cleanly and engine health is visible
- [x] `/setup` loads cleanly and the workspace/lakehouse/notebook/pipeline discovery APIs respond
- [x] `/sql-explorer` loads cleanly and server discovery completes quickly enough for a demo
- [x] `/admin` gate loads cleanly
- [x] Admin auth issues a session token and protected admin writes accept `session_token`
- [x] `/journey` and `/lineage` load cleanly

---

## 3. Runtime Prerequisites

- [x] `dashboard/app/api/.env` is present on the demo machine
- [x] `FABRIC_CLIENT_SECRET` is configured
- [x] `ADMIN_PASSWORD` is configured
- [x] `dashboard/app/dist/` exists
- [x] ODBC Driver 18 for SQL Server is installed
- [x] Outbound access to Azure/Fabric endpoints is available

### Environment variables expected at runtime

```env
FABRIC_CLIENT_SECRET=<service-principal-secret>
ADMIN_PASSWORD=<demo-admin-password>
ONELAKE_MOUNT_PATH=<optional-local-mount>
PURVIEW_ACCOUNT_NAME=<optional>
```

---

## 4. Architecture Reality Check

- [x] Backend runtime is Python `http.server` plus the route registry in `dashboard/app/api/server.py`
- [x] Static frontend is served from `dashboard/app/dist`
- [x] Control-plane state is stored locally in `dashboard/app/api/fmd_control_plane.db`
- [x] Background helpers run in-process for control-plane sync tasks
- [x] Fabric/SQL/OneLake access depends on the configured service principal and network reachability

---

## 5. Non-Blocking Follow-Up

- [ ] Reduce frontend lint warnings over time; they no longer block release
- [ ] Clean up test-only deprecation warnings in `dashboard/app/api/tests/test_control_plane_db.py`
- [ ] Split or lazy-load the largest frontend bundle chunks if startup size becomes an issue
- [ ] Add a repeatable browser smoke script for the final pre-demo check

---

## Launch Decision

| Criteria | Status | Notes |
|----------|--------|-------|
| Buildable | GREEN | Production bundle generates successfully |
| Testable | GREEN | API and engine suites are passing |
| Runnable | GREEN | Server serves SPA and API on port `8787` |
| Demo flows | GREEN | Critical paths validated in-browser |
| Secrets/config | GREEN | Runtime secret and admin auth are configured |

**Verdict**: **READY FOR MONDAY DEMO.** The previously blocking issues in build, engine health, setup wiring, SQL explorer responsiveness, DQ trend loading, business catalog identity handling, and admin session handling have been resolved and revalidated.
