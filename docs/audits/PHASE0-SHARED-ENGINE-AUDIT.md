# Phase 0: Shared Engine Infrastructure Audit

**Date**: 2026-04-08
**Scope**: 9 core engine modules (auth, connections, config, models, logging_db, preflight, orchestrator, pipeline_runner, worker)
**Type**: READ-ONLY forensic audit -- no code changes

---

## Findings

| # | ID | Severity | Category | Finding | File:Line |
|---|-----|----------|----------|---------|-----------|
| 1 | SHARED-ENG-001 | HIGH | Concurrency / Security | **Token refresh race window**: `get_token()` checks cache under lock (L66-69), then releases the lock to fetch a new token (L72-88), then re-acquires the lock to cache it (L93-97). Two threads hitting an expired token simultaneously will both fetch fresh tokens from AAD, wasting API calls and creating a brief window where the second thread's token overwrites the first. Under high concurrency (15 workers), this can cause a burst of redundant AAD token requests. Should use a single lock held for the entire check-fetch-cache cycle, or a per-scope lock with double-check. | `engine/auth.py:64-99` |
| 2 | SHARED-ENG-002 | HIGH | Encapsulation / Correctness | **`_OneLakeCredential` accesses private `_cache` dict directly**: `self._provider._cache.get(scope, {})` at L168 reads the internal cache without holding the lock. This is a data race -- the main `TokenProvider` mutates `_cache` under `_lock`, but `_OneLakeCredential.get_token()` reads it without synchronization. Could return stale/corrupt `expires_on` value to the Azure SDK. | `engine/auth.py:168-169` |
| 3 | SHARED-ENG-003 | HIGH | Data Truthfulness | **Pipeline mode never captures new watermark**: `FabricPipelineRunner.trigger_copy()` sets `watermark_after=entity.last_load_value` (i.e., the OLD value) on success at L107. Comment confirms: "pipeline doesn't report new watermark." This means incremental entities loaded via pipeline mode will re-extract the same data on every subsequent run because the watermark never advances. Silently produces duplicate rows in Landing Zone. | `engine/pipeline_runner.py:106-107` |
| 4 | SHARED-ENG-004 | HIGH | Data Truthfulness | **Double audit logging on successful entities**: In `_process_single_entity()`, when all retries exhaust, `log_entity_result()` is called at the bottom of the method (after the retry loop). But in `_try_entity()` for pipeline mode, `log_entity_result()` is ALSO called on success at L1351 (`self._audit.log_entity_result(run_id, entity, result)`). For local mode, `_try_entity_local()` calls it again at L1445 (`self._audit.log_entity_result(run_id, entity, final)`). This means successful entities get logged TWICE -- once inside `_try_entity*` and once in `_process_single_entity`. Failed entities only get logged once (at the bottom of `_process_single_entity`). Duplicate `engine_task_log` / `copy_activity_audit` rows result. | `engine/orchestrator.py:1331-1345 + 1389-1460` |
| 5 | SHARED-ENG-005 | HIGH | Configuration | **`_validate_config` logs error but does not raise**: The orchestrator's `_validate_config()` (L195-220) detects missing critical fields but only calls `log.error()` -- it does NOT raise an exception or return False. The engine proceeds with empty GUIDs/credentials, causing cryptic downstream failures. The `EngineConfig.__post_init__` DOES raise, but `_validate_config` duplicates the check with a weaker response. Either it should raise or be removed to avoid false confidence. | `engine/orchestrator.py:195-220` |
| 6 | SHARED-ENG-006 | HIGH | Resilience | **`run_timeout_seconds` not actually enforced**: At L311, `run_timeout_seconds` is read via `getattr(self.config, "run_timeout_seconds", 86400)`, but `EngineConfig` has NO `run_timeout_seconds` field (L333-435). So it always falls back to 86400. More critically, while the timeout value is logged at L333, there is NO code that actually checks elapsed time against it during the run. The `try` block (L313-391) runs landing/bronze/silver sequentially with no timeout enforcement. The comment says "FIXED: CRITICAL BUG #4" but the fix is incomplete -- the timeout is computed but never enforced. | `engine/orchestrator.py:308-333` |
| 7 | SHARED-ENG-007 | MODERATE | Security | **ConnectorX username not URL-encoded**: In `build_connectorx_uri()`, the password is `quote_plus()`-encoded but the username is interpolated raw into the URI at L76. A username containing `@`, `:`, `/`, or other URI-special characters would corrupt the connection string or be misinterpreted. | `engine/connections.py:75-76` |
| 8 | SHARED-ENG-008 | MODERATE | Silent Failure | **Config `_resolve_env_vars` returns empty string for missing env vars**: When a `${VAR}` placeholder references an undefined environment variable, `os.environ.get(var_name, "")` at L43 silently returns `""`. This empty string passes through to `EngineConfig` where `__post_init__` catches it for required fields, but optional fields (notebook IDs, OneLake mount path, etc.) silently become empty with no warning logged. The operator gets no signal that their .env file is incomplete. | `engine/config.py:43` |
| 9 | SHARED-ENG-009 | MODERATE | Error Handling | **`_cpdb_query` returns empty list on ANY exception**: At L661-675, if the SQLite query fails (import error, SQL syntax error, disk full, etc.), it returns `[]` and logs an error. Callers like `get_worklist()` treat `[]` as "zero entities" and the run completes with zero work done, reporting success. There is no way for the caller to distinguish "no entities match" from "database is broken." | `engine/orchestrator.py:661-675` |
| 10 | SHARED-ENG-010 | MODERATE | Error Handling | **`_cpdb_execute` swallows write failures**: At L677-683, if a SQLite write fails, it logs a warning but does not raise. Callers include `update_watermark`, `mark_entity_loaded`, and `heartbeat_progress`. A failed watermark write means the next run will re-extract data (duplicates). A failed `mark_entity_loaded` means the dashboard shows the entity as unloaded. | `engine/orchestrator.py:677-683` |
| 11 | SHARED-ENG-011 | MODERATE | Concurrency | **`pool.shutdown(wait=False)` in LZ finally block**: At L1181 (in `_run_landing_zone`'s finally block), `pool.shutdown(wait=False)` returns immediately without waiting for running futures to complete. Any threads still executing `_process_single_entity` will continue running in the background after the pool reference is cleared. These orphaned threads may write to SQLite, update watermarks, or interact with OneLake after the run has been declared complete/interrupted. | `engine/orchestrator.py:~1181` |
| 12 | SHARED-ENG-012 | MODERATE | Error Handling | **Pipeline poll loop silently continues on non-429 HTTP errors**: In `_poll()`, HTTP errors other than 429 (e.g., 401 Unauthorized, 403 Forbidden, 500 Internal Server Error) are logged as warnings but the loop continues polling forever until `MAX_POLL_TIME` (2 hours). A 401 due to token expiry would burn 2 hours of polling with `log.warning("Poll error: HTTP %d", e.code)` every 10 seconds before timing out. Should break on 4xx errors. | `engine/pipeline_runner.py:228-234` |
| 13 | SHARED-ENG-013 | MODERATE | Data Truthfulness | **`_OneLakeCredential.validate()` is a dead duplicate**: `_OneLakeCredential` (L172-191) has its own `validate()` method that is identical to `TokenProvider.validate()` (L120-139). This duplicated code can drift. More importantly, `_OneLakeCredential.validate()` calls `self.get_token(scope)` which calls `self._provider.get_token(scope)` -- it validates the provider, not the credential adapter itself. Misleading. | `engine/auth.py:172-191` |
| 14 | SHARED-ENG-014 | MODERATE | Resilience | **No error handling on AAD token fetch**: `get_token()` calls `urllib.request.urlopen(req, timeout=30)` at L87 with no try/except. If AAD is unreachable, returns a non-JSON response, or the SP credentials are wrong, the raw `urllib` exception propagates up through every caller. Since token fetch happens under concurrent entity processing, one AAD outage can cascade to all 15 threads simultaneously, each throwing unhandled exceptions. | `engine/auth.py:87-88` |
| 15 | SHARED-ENG-015 | MODERATE | Silent Failure | **`logging_db` all SQLite writes wrapped in try/except with warning-only**: Every SQLite write in `AuditLogger` (mark_entity_loaded, update_watermark, mark_bronze_entity_processed, mark_silver_entity_processed, heartbeat_progress, _write_pipeline_audit, _write_copy_audit) catches all exceptions and only logs a warning. If the SQLite database is locked, full, or corrupted, the engine silently loses ALL audit data while reporting success. No circuit breaker, no accumulating failure count, no eventual abort. | `engine/logging_db.py:325-334, 340-350, etc.` |
| 16 | SHARED-ENG-016 | MODERATE | Configuration | **`config.py` defaults `query_timeout` to 120 but `EngineConfig` defaults it to 300**: `load_config()` at L123 uses `int(engine_section.get("query_timeout", 120))`, but `EngineConfig` (L373) has `query_timeout: int = 300`. If the config.json has no `engine.query_timeout` key, `load_config` passes 120 to the constructor, overriding the dataclass default of 300. The comment on L373 says "raised from 120" but the loader still defaults to 120. | `engine/config.py:123` vs `engine/models.py:373` |
| 17 | SHARED-ENG-017 | LOW | Correctness | **Preflight does not check Fabric SQL DB connectivity**: The `PreflightChecker` validates tokens, SQLite, OneLake, and source servers -- but never tests the Fabric SQL metadata database connection. If the SQL endpoint is down or the token struct format is wrong, this is only discovered mid-run. | `engine/preflight.py:96-140` |
| 18 | SHARED-ENG-018 | LOW | Error Handling | **`_get_cpdb()` uses module-level globals without thread safety**: `_cpdb` and `_cpdb_loaded` are module-level globals (L36-37) accessed by `_get_cpdb()` without any locking. Under concurrent entity processing (15 threads), multiple threads could enter the `if not _cpdb_loaded` branch simultaneously, causing redundant imports. While practically harmless due to Python's GIL and import lock, it violates the principle of explicit thread safety. | `engine/logging_db.py:36-51` |
| 19 | SHARED-ENG-019 | LOW | Maintainability | **Worker `main()` is one monolithic function**: `worker.py`'s `main()` function handles three distinct modes (new run, bulk mode, resume) in a single 120+ line function with deep nesting. Resume mode has two sub-paths (bulk resume vs standard resume). Makes it hard to test or modify individual code paths. | `engine/worker.py:35-170` |
| 20 | SHARED-ENG-020 | LOW | Data Truthfulness | **`log_run_end` uses `datetime.utcnow()` (deprecated in Python 3.12+)**: All timestamp generation uses `datetime.utcnow()` which is deprecated. Should use `datetime.now(timezone.utc)`. Not a correctness issue today but will emit deprecation warnings on newer Python versions. | `engine/logging_db.py` (throughout) |
| 21 | SHARED-ENG-021 | INFO | Security | **`build_source_query_display` inlines watermark value in SQL string**: The display method at L152-153 concatenates the escaped watermark value directly into a SQL string. The comment correctly states "NOT for execution" and the value is single-quote escaped. This is acceptable for display/logging but should never be used for query execution. Currently verified: only `build_source_query()` (with `?` params) is used for execution. | `engine/models.py:139-153` |
| 22 | SHARED-ENG-022 | INFO | Design | **`EngineConfig` is a plain dataclass, not Pydantic**: Despite the task description mentioning "Pydantic data models," `Entity`, `EngineConfig`, `RunResult`, etc. are all `@dataclass` with manual `__post_init__` validation. This is fine but means no automatic type coercion, no JSON schema generation, and validation is hand-rolled. | `engine/models.py:333` |

---

## Items Verified Correct

1. **SQL injection prevention in `build_source_query()`**: Watermark values use parameterized `?` placeholders (L134). Table/column identifiers are validated with `_SAFE_IDENT` regex and bracket-escaped. This is properly implemented.

2. **Token struct format**: `get_sql_token_struct()` correctly uses `struct.pack(f"<I{len(token_bytes)}s", ...)` with UTF-16-LE encoding. Matches the pyodbc `attrs_before` requirement for AAD token auth.

3. **Scope enforcement**: `get_worklist()` correctly uses `le.LandingzoneEntityId` (not `le.EntityId`) for scope filtering with parameterized placeholders. This was a previous critical fix and remains correct.

4. **Source connection cleanup**: `SourceConnection.connect()` uses a proper `@contextmanager` with `finally: conn.close()`. No connection leak possible through this path.

5. **Entity identifier validation**: `qualified_name` property validates both `source_schema` and `source_name` against `_SAFE_IDENT` regex before constructing SQL identifiers. Bracket injection via `]` is properly escaped to `]]`.

6. **EngineConfig required field validation**: `__post_init__` checks all 10 critical fields for empty/whitespace values and raises `ValueError` with a clear message listing all missing fields.

7. **Adaptive throttle**: `AdaptiveThrottle` uses proper AIMD-style congestion control with `threading.Lock` and `threading.Semaphore`. Thread-safe acquire/release pattern.

8. **Circuit breaker**: `ConnectionCircuitBreaker` properly isolates failing source servers. Uses `threading.Lock` for all state mutations. Trips after 5 consecutive connection errors per server.

9. **Resume mode**: Both orchestrator and worker correctly query `engine_task_log` for already-succeeded entities and filter them out before processing. Entity IDs and layers are recovered from the original run record.

10. **Graceful stop**: `_stop_requested` flag is checked at multiple points: before each entity, during retry waits (per-second polling), and in the pipeline poll loop. The `stop()` method can force-cancel futures via `pool.shutdown(cancel_futures=True)`.

11. **Retry logic**: `_process_single_entity` has 3-attempt retry with linear backoff (5s, 10s, 15s) for transient errors only. Non-transient errors fail immediately. Transient detection via `_is_transient()` checks a comprehensive pattern list.

12. **Finally-block status guard**: The `run()` method's finally block (L398-422) catches the edge case where the process crashes between layers, marking the run as "Interrupted" in SQLite. This prevents orphaned "InProgress" runs.

13. **Worklist parameterization**: `get_worklist()`, `get_bronze_worklist()`, and `get_silver_worklist()` all use `?` placeholders for entity ID filtering. No SQL injection vector.

14. **Pipeline poll timeout**: `_poll()` has `MAX_POLL_TIME = 7200` (2 hours) with proper timeout check at the top of each iteration. Attempts to cancel the pipeline on timeout.

---

## Summary

- **Total findings**: 22
- **CRITICAL**: 0
- **HIGH**: 6 (token race, cache data race, pipeline watermark stale, double audit logging, validate_config no-raise, run_timeout not enforced)
- **MODERATE**: 9
- **LOW**: 3
- **INFO**: 2

### Top Priorities (HIGH)

1. **SHARED-ENG-006**: Run timeout is computed but never checked -- the "FIXED: BUG #4" is incomplete
2. **SHARED-ENG-003**: Pipeline mode produces stale watermarks, causing incremental loads to re-extract
3. **SHARED-ENG-004**: Successful entities get double-logged due to audit calls in both `_try_entity*` and `_process_single_entity`
4. **SHARED-ENG-005**: `_validate_config` gives false confidence -- logs error but allows engine to proceed
5. **SHARED-ENG-001 + 002**: Token cache has race conditions under concurrent access
