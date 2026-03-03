# Engine API — server.py Integration

Three changes are needed in `dashboard/app/api/server.py` to wire in the engine API.
All changes are additive — no existing code is modified.

---

## Change 1: do_GET — Add engine route (before the 404 catch-all)

**Location**: In `do_GET()`, BEFORE the line:
```python
            elif self.path.startswith('/api/'):
                self._error_response('Not found', 404)
```

**Insert this block** (around line 6381):
```python
            # ── FMD v3 Engine endpoints ──
            elif self.path.startswith('/api/engine/'):
                from engine.api import handle_engine_request
                handle_engine_request(self, method='GET', path=self.path,
                                      config=CONFIG, query_sql_fn=query_sql)
                return  # engine API (incl. SSE) manages its own response lifecycle
```

---

## Change 2: do_POST — Add engine route (before the 404 catch-all)

**Location**: In `do_POST()`, BEFORE the line:
```python
            else:
                self._error_response('Not found', 404)
```

But AFTER reading the body. The engine API reads the body itself from `handler.rfile`,
so we need to intercept BEFORE `body` is read. The cleanest approach is to insert
the engine check as the FIRST elif in do_POST, right after the body is parsed.

Actually, since the engine's `handle_engine_request` reads the body itself via
`handler.rfile`, and do_POST already reads it into `body`, we have a conflict.
The solution: insert the engine route check BEFORE the body read.

**Location**: In `do_POST()`, right after `try:`, BEFORE body is read (line 6392):

```python
    def do_POST(self):
        try:
            # ── FMD v3 Engine endpoints (must be before body read) ──
            if self.path.startswith('/api/engine/'):
                from engine.api import handle_engine_request
                handle_engine_request(self, method='POST', path=self.path,
                                      config=CONFIG, query_sql_fn=query_sql)
                return

            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length)) if content_length else {}
            ...
```

---

## Change 3: Startup log — Add engine API endpoints

**Location**: After the existing endpoint log lines (around line 6598), before the
`Snapshot:` line.

**Insert**:
```python
    log.info('  ── FMD v3 Engine ──')
    log.info('  GET  /api/engine/status')
    log.info('  GET  /api/engine/plan')
    log.info('  GET  /api/engine/logs')
    log.info('  GET  /api/engine/logs/stream  (SSE)')
    log.info('  GET  /api/engine/health')
    log.info('  GET  /api/engine/metrics')
    log.info('  GET  /api/engine/runs')
    log.info('  POST /api/engine/start')
    log.info('  POST /api/engine/stop')
    log.info('  POST /api/engine/retry')
    log.info('  POST /api/engine/entity/*/reset')
```

---

## Summary

| # | What | Where | Type |
|---|------|-------|------|
| 1 | GET route delegation | `do_GET()`, before `/api/` 404 catch-all | 4 lines |
| 2 | POST route delegation | `do_POST()`, before body read | 5 lines |
| 3 | Startup log | After existing endpoint logs | 12 lines |

Total: ~21 lines added to server.py. Zero lines modified.
