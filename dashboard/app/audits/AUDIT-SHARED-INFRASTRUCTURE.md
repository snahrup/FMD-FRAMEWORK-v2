# Phase 0: Shared Infrastructure Audit (Consolidated)

**Date**: 2026-04-08
**Phase**: 0 (pre-requisite for all Phase 1 domain audits)
**Manifest ref**: `docs/AUDIT-SESSION-MANIFEST.md` surfaces SHARED-FE, SHARED-BE, SHARED-ENGINE
**Detailed reports**: See Section 7 for file paths

---

## 1. Executive Summary

| Unit | Files Audited | Findings | CRIT | HIGH | MOD | LOW | INFO | Verified OK |
|------|--------------|----------|------|------|-----|-----|------|------------|
| Frontend Shared | 33 | 32 | 2 | 7 | 9 | 8 | 5 | 19 |
| Backend Shared | 8 | 26 | 3 | 5 | 9 | 6 | 3 | 16 |
| Engine Shared | 9 | 22 | 0 | 6 | 9 | 3 | 2 | 14 |
| **TOTAL** | **50** | **80** | **5** | **18** | **27** | **17** | **10** | **49** |

---

## 2. CRITICAL Findings (5) — Must Fix Before Phase 2

| ID | Unit | Finding | Impact | File:Line |
|----|------|---------|--------|-----------|
| SHARED-FE-001 | FE | **No ErrorBoundary anywhere in app** — zero `componentDidCatch` across entire `src/`. Any uncaught JS error crashes the entire React tree to blank white screen. | All 55 pages unprotected | `App.tsx` (missing) |
| SHARED-FE-002 | FE | **No catch-all 404 route** — `<Route path="*">` absent. Undefined URLs render empty layout shell with no feedback. | User confusion, broken bookmarks | `App.tsx:86-150` |
| SHARED-BE-001 | BE | **SQL injection in `preview_query()`** — executes raw user-supplied SQL via `cur.execute(sql)` on production source DBs. No sanitization, no read-only guard. | Full RCE via `xp_cmdshell` | `schema_discovery.py:145` |
| SHARED-BE-002 | BE | **SQL injection via f-string in `SET ROWCOUNT`** — `limit` param interpolated without int validation. | Statement injection | `schema_discovery.py:142` |
| SHARED-BE-003 | BE | **SQL injection in `bulk_seed()`** — table name and column names from dict keys interpolated directly into SQL. | Full SQLite injection | `control_plane_db.py:1918` |

---

## 3. HIGH Findings (18) — Fix During Phase 2

### Frontend (7)

| ID | Finding | File |
|----|---------|------|
| SHARED-FE-003 | **mockData.ts has fake sources** (Salesforce, SAP, Oracle) — if any page uses as fallback, users see fictitious data | `lib/mockData.ts` |
| SHARED-FE-004 | **~40 pages eagerly imported** — only 9 lazy-loaded, massive initial bundle | `App.tsx:5-74` |
| SHARED-FE-005 | **No AbortController on any fetch hook** — unmount doesn't cancel HTTP requests | All 4 data hooks |
| SHARED-FE-006 | **Admin password sent plaintext** over HTTP via `pageVisibility.ts` | `lib/pageVisibility.ts:25-50` |
| SHARED-FE-007 | **Dark theme toggle non-functional** — `.dark` CSS identical to `:root` | `index.css:209-315` |
| SHARED-FE-008 | **Sidebar nav has no ARIA attributes** — no `aria-current`, no `role` | `AppLayout.tsx:310-488` |
| SHARED-FE-009 | **Mobile overlay no focus trap** — `role="button"` div without keyboard parity | `AppLayout.tsx:579` |

### Backend (5)

| ID | Finding | File |
|----|---------|------|
| SHARED-BE-004 | **CORS `*` on all responses** — any website can make cross-origin requests | `server.py:191`, `router.py:67` |
| SHARED-BE-005 | **Zero authentication on all endpoints** — relies solely on IIS reverse proxy | `server.py`, `router.py:73` |
| SHARED-BE-006 | **No connection pooling** — new SQLite connection per request under threaded server | `db.py:16-22` |
| SHARED-BE-007 | **`auto_detect_source()` brute-forces all 5 DBs** with user SQL — schema probing | `schema_discovery.py:239-284` |
| SHARED-BE-008 | **No request body size limit** — `Content-Length: 999999999` causes OOM | `server.py:253-254` |

### Engine (6)

| ID | Finding | File |
|----|---------|------|
| SHARED-ENG-001 | **Token refresh race** — lock released between check and fetch, redundant AAD calls | `auth.py:64-99` |
| SHARED-ENG-002 | **`_OneLakeCredential` reads cache without lock** — data race with Azure SDK | `auth.py:168-169` |
| SHARED-ENG-003 | **Pipeline mode never advances watermark** — incremental entities re-extract same data forever | `pipeline_runner.py:106-107` |
| SHARED-ENG-004 | **Double audit logging** — successful entities logged twice in `engine_task_log` | `orchestrator.py:1331+1389` |
| SHARED-ENG-005 | **`_validate_config` logs error but never raises** — engine proceeds with empty GUIDs | `orchestrator.py:195-220` |
| SHARED-ENG-006 | **`run_timeout_seconds` declared fixed but never enforced** — timeout computed, never checked | `orchestrator.py:308-333` |

---

## 4. MODERATE Findings (27) — Summary

### Frontend (9)
- SHARED-FE-010: Duplicate `navScrollRef` binding
- SHARED-FE-011: Persona toggle uses `<span>` not `<button>` (inaccessible)
- SHARED-FE-012: Feature flags from localStorage without key validation
- SHARED-FE-013: `useSourceConfig` doesn't validate response shape
- SHARED-FE-014: Focus ring uses `--bp-copper` before it's defined
- SHARED-FE-015: `useEffect` without dep array for scroll restoration
- SHARED-FE-016: Dual color systems (hardcoded `layers.ts` vs API `useSourceConfig`)
- SHARED-FE-017: Hover references undefined `--bp-surface-2` CSS var
- SHARED-FE-018: `formatBytes` truncates at GB (no TB support)
- SHARED-FE-019: `useSourceConfig` silently swallows fetch errors

### Backend (9)
- SHARED-BE-009: `.env` missing = silent empty env vars
- SHARED-BE-010: Read functions have no locking (read-during-write race)
- SHARED-BE-011: `init_db()` runs at import time (side-effect on import)
- SHARED-BE-012: Dual `DB_PATH` with monkey-patch sync
- SHARED-BE-013: `dispatch()` merges path/query/body into flat dict (key collision)
- SHARED-BE-014: Immutable cache headers without content hashing
- SHARED-BE-015: Missing `Content-Length` header on responses
- SHARED-BE-016: Error shape inconsistency (router vs server)
- SHARED-BE-017: Table recreation migrations not wrapped in transaction

### Engine (9)
- SHARED-ENG-007: ConnectorX username not URL-encoded
- SHARED-ENG-008: `_resolve_env_vars` returns empty for missing vars
- SHARED-ENG-009: `_cpdb_query` returns `[]` on any exception (indistinguishable from empty)
- SHARED-ENG-010: `_cpdb_execute` swallows write failures (watermark, status)
- SHARED-ENG-011: `pool.shutdown(wait=False)` orphans threads
- SHARED-ENG-012: Pipeline poll burns 2hrs on 401 errors
- SHARED-ENG-013: `_OneLakeCredential.validate()` is dead duplicate
- SHARED-ENG-014: No error handling on AAD token fetch
- SHARED-ENG-015: All SQLite audit writes silently swallowed on failure

---

## 5. LOW + INFO Findings (27) — Deferred

**LOW (17)**: Badge semantics, KPI accessibility, format edge cases, CSS duplication, font-mono aliasing, FOUT on font load, dialog focus-visible, connection leak in auto_detect, logging filesystem leak, hardcoded sources, SSE error handling, SQL parser nesting, route collision, preflight missing Fabric SQL check, module globals without lock, monolithic worker, deprecated `utcnow()`

**INFO (10)**: Import interleaving, Suspense duplication, color function duplication, BackgroundTask single-type, CSS file size, dead `entity_status` code, positional arg parsing, double-import fallback, display-only SQL string, dataclass vs Pydantic

---

## 6. Cross-Cutting Themes

| Theme | Finding IDs | Pattern |
|-------|------------|---------|
| **SQL Injection** | BE-001, BE-002, BE-003 | Backend has 3 distinct injection vectors — all in shared infrastructure consumed by Gold Studio and admin routes |
| **Silent Failure** | FE-019, ENG-008, ENG-009, ENG-010, ENG-015 | 5 different paths where errors are swallowed, returning empty/success instead of propagating failure |
| **No Auth** | BE-004, BE-005, FE-006 | Zero auth on API, CORS `*`, plaintext passwords — entire security model depends on IIS reverse proxy |
| **Concurrency Gaps** | BE-006, BE-010, ENG-001, ENG-002, ENG-011 | Threading used throughout but locking is inconsistent or absent |
| **Watermark/Dedup Risk** | ENG-003, ENG-004, ENG-010 | Pipeline mode never advances watermarks + double logging + swallowed watermark writes |
| **Accessibility** | FE-008, FE-009, FE-011, FE-014, FE-020, FE-021, FE-026 | 7 findings — no ARIA, no focus traps, non-semantic elements |
| **Mock/Fake Data** | FE-003 | mockData.ts with fictional sources still importable |

---

## 7. Detailed Report Locations

| Unit | Path | Findings | Verified |
|------|------|----------|----------|
| Frontend | `docs/AUDIT-PHASE0-SHARED-FE-INFRASTRUCTURE.md` | 32 | 19 |
| Backend | `docs/audits/AUDIT-PHASE0-SHARED-BACKEND.md` | 26 | 16 |
| Engine | `docs/audits/PHASE0-SHARED-ENGINE-AUDIT.md` | 22 | 14 |

---

## 8. Phase 1 Impact

These shared infrastructure findings affect ALL page audits. Phase 1 sessions should:

1. **Not re-report shared findings** — reference `SHARED-{FE|BE|ENG}-NNN` IDs instead
2. **Check if page-specific code worsens shared issues** — e.g., a page that uses `mockData.ts` imports compounds SHARED-FE-003
3. **Note pages that would benefit most from ErrorBoundary** (SHARED-FE-001) — crash-prone pages with complex state
4. **Flag any additional SQL injection vectors** beyond the 3 in shared backend
5. **Test with `CORS: *`** awareness — any page endpoint is callable cross-origin

---

*Phase 0 complete. Proceed to Phase 1 parallel domain audits.*
