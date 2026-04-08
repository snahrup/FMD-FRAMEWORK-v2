# Phase 0 Audit: Shared Backend Infrastructure

**Date**: 2026-04-08
**Scope**: server.py, router.py, db.py, control_plane_db.py, parsers/__init__.py, parsers/schema_discovery.py, parsers/sql_parser.py, parsers/base.py
**Auditor**: Claude Code (forensic read-only)

---

## Dependency Map

```
server.py
  +-- router.py (dispatch, dispatch_sse, route decorators)
  +-- control_plane_db.py (init_db at startup)
  +-- parquet_sync.py (background thread)
  +-- delta_ingest.py (background thread)
  +-- routes/test_audit.py (serve_audit_artifact, inline import)
  +-- routes/* (auto-imported via routes/__init__.py)

router.py
  +-- [standalone, no deps on other api modules]
  +-- consumed by ALL 35 route modules via `from dashboard.app.api.router import route, HttpError`

db.py
  +-- control_plane_db.py (init_db delegation)
  +-- consumed by 16 route modules via `from dashboard.app.api import db`

control_plane_db.py
  +-- [standalone SQLite layer]
  +-- consumed by: server.py, db.py, sql_explorer, source_manager, engine, gold_studio (via cpdb._get_conn())

parsers/__init__.py
  +-- base.py, bim_parser.py, pbip_parser.py, pbix_parser.py, rdl_parser.py, schema_discovery.py
  +-- consumed by: gold_studio.py

parsers/schema_discovery.py
  +-- pyodbc (external)
  +-- consumed by: gold_studio.py, parsers/__init__.py

parsers/sql_parser.py
  +-- parsers/base.py
  +-- consumed by: gold_studio.py
```

---

## Findings

| # | ID | Severity | Category | Finding | File:Line |
|---|-----|----------|----------|---------|-----------|
| 1 | SHARED-BE-001 | **CRITICAL** | SQL Injection | `preview_query()` executes raw user-supplied SQL directly on production source databases via `cur.execute(sql)`. No sanitization, no parameterization, no read-only guard. An attacker can execute `DROP TABLE`, `INSERT`, `UPDATE`, or `xp_cmdshell` via the Gold Studio preview endpoint. The `SET ROWCOUNT` guard only limits result rows, not the statement type. | schema_discovery.py:145 |
| 2 | SHARED-BE-002 | **CRITICAL** | SQL Injection | `preview_query()` interpolates `limit` into SQL via f-string: `cur.execute(f"SET ROWCOUNT {limit}")`. Although `limit` has a default of 50, callers can pass arbitrary values. If `limit` comes from user input as a string (not validated to int), this is injectable. | schema_discovery.py:142 |
| 3 | SHARED-BE-003 | **CRITICAL** | SQL Injection | `bulk_seed()` constructs SQL from dict keys of user-supplied data: `f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})"`. The `table` parameter and column names (`col_names`) are interpolated directly. If a route passes user-controlled table names or dict keys, this is full SQL injection. | control_plane_db.py:1918 |
| 4 | SHARED-BE-004 | **HIGH** | CORS | `Access-Control-Allow-Origin: *` is set on all API responses (both in server.py:191 and router.py:67). Any website on the internet can make authenticated cross-origin requests to the dashboard API. Combined with Windows Auth pass-through, this means any malicious page visited by a VPN-connected user can read/write FMD data. | server.py:191, router.py:67 |
| 5 | SHARED-BE-005 | **HIGH** | Auth Bypass | Zero authentication on all API endpoints. No session tokens, no API keys, no auth middleware. The server binds to `HOST` from config (defaulting to `127.0.0.1`) but when deployed behind IIS with Windows Auth, the backend itself has no auth checks -- IIS handles it. If the IIS reverse proxy is misconfigured or bypassed, all endpoints are wide open. | server.py (entire), router.py:73 |
| 6 | SHARED-BE-006 | **HIGH** | Concurrency | `db.py` creates a new connection per call (`get_db()`) with no connection pooling or reuse. Under concurrent load from the threaded server (`ThreadedHTTPServer`), this means N simultaneous requests create N SQLite connections. WAL mode helps but does not eliminate contention on writes. Each write helper in `control_plane_db.py` also creates+closes a connection per call (1228-1572), compounding the issue. | db.py:16-22, control_plane_db.py:24-29 |
| 7 | SHARED-BE-007 | **HIGH** | Data Truthfulness | `auto_detect_source()` executes `sp_describe_first_result_set` with raw user SQL against every source database in sequence (5 source systems, brute-force). This leaks information about which databases a query is valid against and can be used to probe schema across all production sources. | schema_discovery.py:239-284 |
| 8 | SHARED-BE-008 | **HIGH** | Request Handling | `do_POST` and `do_PUT` parse the body with `json.loads(self.rfile.read(content_length))` with no size limit check. A malicious client can send `Content-Length: 999999999` and the server will attempt to read ~1GB into memory, causing OOM. No request body size limit exists anywhere. | server.py:253-254, 259-260 |
| 9 | SHARED-BE-009 | **MODERATE** | Error Handling | `.env` file loading prints a WARNING to stdout if the file doesn't exist (server.py:38) but doesn't fail or log at WARNING level. If `.env` is required for DB credentials or SP auth, the server starts with empty env vars and fails later with confusing errors. The `_resolve_env_vars` function silently returns empty string for missing vars. | server.py:26-38, 43-55 |
| 10 | SHARED-BE-010 | **MODERATE** | Race Condition | `control_plane_db.py` uses a module-level `_db_lock = threading.Lock()` for writes, but ALL read functions (get_connections, get_datasources, etc., lines 1579-1903) have NO locking. In the threaded server, a read can occur mid-write causing SQLite `database is locked` errors despite WAL mode, or reading partially-committed state. | control_plane_db.py:1579-1903 |
| 11 | SHARED-BE-011 | **MODERATE** | Startup Side Effect | `control_plane_db.py` calls `init_db()` at module import time (line 2005). This means merely importing the module triggers schema creation, migrations, and filesystem operations (creating `data/gold-studio/specimens/` directory). During testing or when imported for type checking, this is undesirable and can fail if the DB file is locked. | control_plane_db.py:2005 |
| 12 | SHARED-BE-012 | **MODERATE** | Dual DB Path | `db.py` and `control_plane_db.py` both define `DB_PATH` pointing to the same file (`fmd_control_plane.db`). `db.init_db()` temporarily monkey-patches `cpdb.DB_PATH` to sync them (db.py:55-60). This is fragile -- if any code caches the old path or if the monkey-patch fails, the two modules operate on different files silently. | db.py:13,55-60; control_plane_db.py:16 |
| 13 | SHARED-BE-013 | **MODERATE** | Parameter Confusion | `dispatch()` merges path params, query params, and body into a single flat `params` dict (router.py:91-96). If a body key collides with a path param (e.g., both have `id`), body silently wins. This can cause routing to one entity but operating on another -- a confused deputy vulnerability. | router.py:91-96 |
| 14 | SHARED-BE-014 | **MODERATE** | Static File Cache | Immutable cache headers (`max-age=31536000, immutable`) are set on all `.js`, `.css`, and font files (server.py:167). If the build output doesn't use content hashing in filenames, users get stale cached JS/CSS after deployments with no way to bust the cache. | server.py:166-167 |
| 15 | SHARED-BE-015 | **MODERATE** | Missing Content-Length | `_send()` writes the response body but never sets a `Content-Length` header (server.py:207-212). HTTP/1.1 clients may have trouble determining response boundaries, especially with keep-alive connections. The `serve_static` function also omits Content-Length. | server.py:207-212, 146-182 |
| 16 | SHARED-BE-016 | **MODERATE** | Error Shape Inconsistency | Router's `dispatch()` always returns `{"error": "..."}` on failure (router.py:83,106,109), but `server.py`'s `_error_response()` also returns `{"error": "..."}` (server.py:204-205). However, the artifact serving path (server.py:241) calls `_error_response` directly, bypassing CORS headers from the router. Clients hitting artifact 404s get no CORS headers. | server.py:241 vs router.py:82-83 |
| 17 | SHARED-BE-017 | **MODERATE** | Migration Safety | Table recreation migrations (gs_specimens at line 1083, gs_audit_log at line 1131) use RENAME + CREATE + INSERT + DROP. If the server crashes between RENAME and the final DROP, the original table is gone and only `_gs_specimens_old` exists. There's no transaction wrapping the entire migration. | control_plane_db.py:1083-1128, 1131-1171 |
| 18 | SHARED-BE-018 | **LOW** | Connection Leak | `auto_detect_source()` calls `conn.close()` inline (line 252) but if an exception occurs between `_get_connection()` and `conn.close()`, the connection leaks. Unlike `describe_query()` and `discover_table_schema()` which use try/finally, this function does not. | schema_discovery.py:248-252 |
| 19 | SHARED-BE-019 | **LOW** | Logging Leak | `server.py` prints the full `.env` file path and count of loaded vars to stdout (line 36). In production logs, this reveals the server's filesystem layout. The `_resolve_env_vars` warning (line 49) also prints environment variable names to stdout. | server.py:36, 49 |
| 20 | SHARED-BE-020 | **LOW** | Hardcoded Sources | `schema_discovery.py` hardcodes all 5 source system connections in `SOURCE_MAP` (lines 24-50). Adding or modifying a source requires code changes and redeployment. This should read from the `connections` table in the control plane DB. | schema_discovery.py:24-50 |
| 21 | SHARED-BE-021 | **LOW** | SSE Error Handling | `dispatch_sse()` calls the handler directly (router.py:123) with no try/except. If the SSE handler raises an exception after headers are sent, the client gets a broken stream with no error indication. The non-SSE `dispatch()` properly catches exceptions. | router.py:112-126 |
| 22 | SHARED-BE-022 | **LOW** | SQL Parser Limitations | `_strip_comments()` handles nested `/* */` comments "poorly" (per its own docstring, sql_parser.py:47-48). Non-greedy `.*?` with DOTALL can mis-match nested block comments, causing downstream regex extraction to operate on comment text as if it were SQL. | sql_parser.py:47-48 |
| 23 | SHARED-BE-023 | **LOW** | Route Collision | `_match_route()` iterates all routes for pattern matching (router.py:52-62) but doesn't enforce priority. If two patterns match the same path (e.g., `/api/things/{id}` and `/api/things/{name}`), whichever was registered first wins -- dict iteration order, which is insertion order in Python 3.7+ but not explicitly guaranteed to be stable across restarts if route modules load in different orders. | router.py:44-63 |
| 24 | SHARED-BE-024 | **INFO** | Dead Code | `upsert_entity_status()` is marked DEPRECATED (line 1499) and `entity_status` table is no longer read by any endpoint per the comment. The function and table still exist, consuming write lock time during engine runs. | control_plane_db.py:1498-1518 |
| 25 | SHARED-BE-025 | **INFO** | Config Parsing | `--config` argument parsing uses positional index checking (`sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--config"`) rather than argparse. This is fragile but functional for the current single-option CLI. | server.py:67-69 |
| 26 | SHARED-BE-026 | **INFO** | Import Fallback | `server.py` has a double-import fallback for `control_plane_db` (lines 101-112) and `engine.py` route has the same pattern (line 260-263). This suggests a historical packaging issue that's been worked around rather than fixed. | server.py:101-112 |

---

## Items Verified Correct

1. **Path traversal protection in static file serving** -- `serve_static()` correctly uses `file_path.resolve().relative_to(STATIC_DIR.resolve())` (server.py:155-157). Attempted `../` escapes are blocked and logged.

2. **Path traversal protection in audit artifacts** -- `serve_audit_artifact()` validates each path component for `..`, backslashes, null bytes, and control characters, then does a second `resolve().relative_to()` check (test_audit.py:174-189). Defense in depth is solid.

3. **Parameterized SQL in all write helpers** -- Every `upsert_*` and `insert_*` function in `control_plane_db.py` uses parameterized queries with `?` placeholders (lines 1228-1572). No string interpolation of values.

4. **Parameterized SQL in db.py** -- `query()` and `execute()` accept `params` tuples and pass them to `conn.execute(sql, params)` (db.py:25-43).

5. **Dynamic UPDATE builders use safe patterns** -- `cleansing.py:302` and `gold_studio.py:284` build UPDATE SET clauses from whitelisted column name lists (e.g., `updatable = ("name", "division", ...)`) with values as `?` params. Column names come from hardcoded tuples, not user input. This is safe.

6. **WAL mode + busy_timeout** -- Both `db.py:20-21` and `control_plane_db.py:27-28` set `journal_mode=WAL` and `busy_timeout=5000`. This is the correct configuration for concurrent read/write on SQLite.

7. **`_v()` helper prevents type errors** -- The `_v()` function (control_plane_db.py:32-34) ensures all values are stringified before SQLite insertion, preventing type mismatch errors.

8. **`get_stats()` uses whitelisted table names** -- The diagnostic `get_stats()` function (control_plane_db.py:1960-1987) uses a frozen set whitelist and escapes `]` characters. Table names never come from user input.

9. **Thread-safe server** -- `ThreadedHTTPServer` with `daemon_threads = True` (server.py:274-275) correctly handles concurrent requests.

10. **SQL parser is static-only** -- `sql_parser.py` explicitly states and enforces that SQL is parsed via regex only, never executed (docstring + implementation). No database connections.

11. **`describe_query()` uses parameterized sp call** -- `sp_describe_first_result_set @tsql = ?` with the SQL as a parameter (schema_discovery.py:101). The stored procedure itself only describes, not executes.

12. **`discover_table_schema()` uses parameterized INFORMATION_SCHEMA query** -- Table name and schema name are passed as `?` parameters (schema_discovery.py:205-213).

13. **Comprehensive indexing** -- `control_plane_db.py` creates 26+ indexes covering all common query patterns (lines 438-459, 948-977).

14. **SPA fallback is correct** -- `serve_static()` falls back to `index.html` for unmatched paths (server.py:173-181), which is the standard pattern for React Router SPAs.

15. **`ExtractionResult` contract is clean** -- `base.py` defines pure dataclasses with no logic, no database access, no side effects. Clean separation of concerns.

16. **Connection cleanup in try/finally** -- All `describe_query()`, `preview_query()`, and `discover_table_schema()` use try/finally to close connections (schema_discovery.py:125-126, 167-168, 236).

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH | 5 |
| MODERATE | 9 |
| LOW | 6 |
| INFO | 3 |
| **Total** | **26** |

### Priority Remediation Order

1. **SHARED-BE-001 + SHARED-BE-002** (CRITICAL) -- `preview_query()` raw SQL execution. Add a read-only cursor wrapper (`SET TRANSACTION READ ONLY` or equivalent), validate `limit` as int, and consider restricting to SELECT-only via regex pre-check.
2. **SHARED-BE-003** (CRITICAL) -- `bulk_seed()` table/column injection. Whitelist allowed table names and validate column names against schema.
3. **SHARED-BE-004** (HIGH) -- CORS `*`. Restrict to known origins (localhost dev, vsc-fabric production).
4. **SHARED-BE-008** (HIGH) -- Request body size limit. Add max content-length check (e.g., 10MB) in `do_POST`/`do_PUT`.
5. **SHARED-BE-005** (HIGH) -- Auth. Document the IIS dependency clearly; add a health-check-only bypass and require auth header for all write endpoints at minimum.
