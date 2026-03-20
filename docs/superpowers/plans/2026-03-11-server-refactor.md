# Server Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 9,267-line server.py monolith with a route-registry architecture, eliminate Fabric SQL entirely, and make SQLite the single source of truth.

**Architecture:** Decorator-based route registry (`@route("GET", "/api/...")`) dispatching to domain-specific route modules. Middleware handles CORS, JSON serialization, error catching. SQLite writes queue Parquet export via background thread; OneLake sync pushes to lakehouse. Notebooks write to Delta tables; `delta_ingest.py` reads them back into SQLite.

**Tech Stack:** Python stdlib (http.server, sqlite3, json, threading), pyodbc (on-prem ODBC only), pyarrow (Parquet read/write), React/TypeScript (frontend, no changes planned)

**Spec:** `docs/superpowers/specs/2026-03-11-server-refactor-design.md`

---

## Chunk 1: Route Registry Foundation

### Task 1: Create `router.py` — Route Registry + Middleware

**Files:**
- Create: `dashboard/app/api/router.py`
- Create: `dashboard/app/api/tests/test_router.py`

- [ ] **Step 1: Write the failing test for route registration and dispatch**

```python
# dashboard/app/api/tests/test_router.py
import json
import pytest
from dashboard.app.api.router import route, sse_route, dispatch, HttpError, _routes

@pytest.fixture(autouse=True)
def clear_routes():
    _routes.clear()
    yield
    _routes.clear()

def test_register_and_dispatch_get():
    @route("GET", "/api/test")
    def handler(params):
        return {"ok": True}

    status, headers, body = dispatch("GET", "/api/test", query_params={}, body=None)
    assert status == 200
    result = json.loads(body)
    assert result == {"ok": True}

def test_dispatch_404_for_unknown_path():
    status, headers, body = dispatch("GET", "/api/nonexistent", query_params={}, body=None)
    assert status == 404

def test_http_error_returns_custom_status():
    @route("POST", "/api/fail")
    def handler(params):
        raise HttpError("bad input", 400)

    status, headers, body = dispatch("POST", "/api/fail", query_params={}, body={})
    assert status == 400
    result = json.loads(body)
    assert "bad input" in result["error"]

def test_unhandled_exception_returns_500():
    @route("GET", "/api/crash")
    def handler(params):
        raise RuntimeError("boom")

    status, headers, body = dispatch("GET", "/api/crash", query_params={}, body=None)
    assert status == 500
    result = json.loads(body)
    assert "error" in result

def test_path_params_extracted():
    @route("GET", "/api/entities/{id}")
    def handler(params):
        return {"id": params["id"]}

    status, _, body = dispatch("GET", "/api/entities/42", query_params={}, body=None)
    assert status == 200
    assert json.loads(body)["id"] == "42"

def test_query_params_merged_into_params():
    @route("GET", "/api/search")
    def handler(params):
        return {"q": params.get("q")}

    status, _, body = dispatch("GET", "/api/search", query_params={"q": "hello"}, body=None)
    assert json.loads(body)["q"] == "hello"

def test_post_body_merged_into_params():
    @route("POST", "/api/create")
    def handler(params):
        return {"name": params.get("name")}

    status, _, body = dispatch("POST", "/api/create", query_params={}, body={"name": "test"})
    assert json.loads(body)["name"] == "test"

def test_sse_route_flagged():
    @sse_route("GET", "/api/stream")
    def handler(http_handler, params):
        pass

    entry = _routes[("GET", "/api/stream")]
    assert isinstance(entry, dict) and entry["sse"] is True

def test_cors_headers_present():
    @route("GET", "/api/cors-test")
    def handler(params):
        return {}

    _, headers, _ = dispatch("GET", "/api/cors-test", query_params={}, body=None)
    assert headers["Access-Control-Allow-Origin"] == "*"

def test_delete_method():
    @route("DELETE", "/api/items/{id}")
    def handler(params):
        return {"deleted": params["id"]}

    status, _, body = dispatch("DELETE", "/api/items/7", query_params={}, body=None)
    assert status == 200
    assert json.loads(body)["deleted"] == "7"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_router.py -v`
Expected: FAIL — `router` module does not exist

- [ ] **Step 3: Implement router.py**

```python
# dashboard/app/api/router.py
"""Route registry with decorator-based registration and middleware pipeline.

Usage:
    from dashboard.app.api.router import route, sse_route, dispatch, HttpError

    @route("GET", "/api/things")
    def get_things(params):
        return {"items": [...]}

    # In server.py do_GET/do_POST:
    status, headers, body = dispatch(method, path, query_params, body)
"""
import json
import logging
import re

log = logging.getLogger("fmd.router")

_routes: dict = {}


class HttpError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def route(method: str, path: str):
    """Register a handler. Supports exact match and {param} placeholders."""
    def decorator(fn):
        _routes[(method, path)] = fn
        return fn
    return decorator


def sse_route(method: str, path: str):
    """Register an SSE streaming handler. Bypasses JSON middleware."""
    def decorator(fn):
        _routes[(method, path)] = {"handler": fn, "sse": True}
        return fn
    return decorator


def _match_route(method: str, path: str):
    """Find a matching route. Exact match first, then pattern match with {params}."""
    # Exact match
    key = (method, path)
    if key in _routes:
        return _routes[key], {}

    # Pattern match with path params
    for (m, pattern), handler in _routes.items():
        if m != method:
            continue
        if "{" not in pattern:
            continue
        # Convert /api/entities/{id} to regex /api/entities/(?P<id>[^/]+)
        regex = re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern)
        match = re.fullmatch(regex, path)
        if match:
            return handler, match.groupdict()

    return None, {}


_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


def dispatch(method: str, path: str, query_params: dict, body: dict | None):
    """Middleware pipeline: match -> execute -> catch -> serialize.

    Returns (status_code, headers_dict, body_string).
    SSE routes are NOT dispatched through here — use dispatch_sse().
    """
    handler, path_params = _match_route(method, path)

    if handler is None:
        headers = {"Content-Type": "application/json", **_CORS_HEADERS}
        return 404, headers, json.dumps({"error": "Not found"})

    # SSE routes should not go through JSON dispatch
    if isinstance(handler, dict) and handler.get("sse"):
        headers = {"Content-Type": "application/json", **_CORS_HEADERS}
        return 400, headers, json.dumps({"error": "SSE route — use dispatch_sse()"})

    # Merge params: path params + query params + body
    params = {}
    params.update(path_params)
    if query_params:
        params.update(query_params)
    if body:
        params.update(body)

    headers = {"Content-Type": "application/json", **_CORS_HEADERS}

    try:
        log.info("%s %s", method, path)
        result = handler(params)
        return 200, headers, json.dumps(result, default=str)
    except HttpError as e:
        log.warning("%s %s -> %d: %s", method, path, e.status, e)
        return e.status, headers, json.dumps({"error": str(e)})
    except Exception:
        log.exception("Unhandled error in %s %s", method, path)
        return 500, headers, json.dumps({"error": "Internal server error"})


def dispatch_sse(method: str, path: str, http_handler, query_params: dict):
    """Dispatch an SSE route. Returns True if handled, False if no match."""
    handler, path_params = _match_route(method, path)
    if handler is None:
        return False

    if isinstance(handler, dict) and handler.get("sse"):
        params = {}
        params.update(path_params)
        if query_params:
            params.update(query_params)
        handler["handler"](http_handler, params)
        return True

    return False


def get_all_routes() -> list[tuple[str, str, bool]]:
    """Return all registered routes as (method, path, is_sse) tuples."""
    result = []
    for (method, path), handler in _routes.items():
        is_sse = isinstance(handler, dict) and handler.get("sse", False)
        result.append((method, path, is_sse))
    return sorted(result)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard/app/api && python -m pytest tests/test_router.py -v`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/router.py dashboard/app/api/tests/test_router.py
git commit -m "feat: add route registry with decorator, dispatch, middleware, and HttpError"
```

---

### Task 2: Create `db.py` — SQLite Connection Wrapper

**Files:**
- Create: `dashboard/app/api/db.py`
- Create: `dashboard/app/api/tests/test_db.py`
- Reference: `dashboard/app/api/control_plane_db.py` (existing — this is the CRUD layer)

**Relationship:** `db.py` is a thin connection wrapper that exports `get_db()`, `init_db()`, `query()`, and `execute()`. Route modules call `db.py` for raw SQLite access. `control_plane_db.py` is the existing domain-specific CRUD module (upsert_connection, upsert_entity, etc.) — it keeps its own `_get_conn()` internally. Eventually `control_plane_db.py` should import from `db.py`, but that refactor is deferred — both work fine with their own connections to the same WAL-mode SQLite file.

- [ ] **Step 1: Write the failing test**

```python
# dashboard/app/api/tests/test_db.py
import os
import tempfile
import pytest
from dashboard.app.api import db


@pytest.fixture
def tmp_db(tmp_path):
    db_path = tmp_path / "test.db"
    original = db.DB_PATH
    db.DB_PATH = db_path
    db.init_db()
    yield db_path
    db.DB_PATH = original


def test_init_creates_tables(tmp_db):
    conn = db.get_db()
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in cursor.fetchall()}
    assert "connections" in tables
    assert "lz_entities" in tables
    assert "engine_runs" in tables
    conn.close()


def test_query_returns_list_of_dicts(tmp_db):
    conn = db.get_db()
    conn.execute("INSERT INTO connections (ConnectionId, Name) VALUES (1, 'test')")
    conn.commit()
    conn.close()

    rows = db.query("SELECT * FROM connections WHERE ConnectionId = ?", (1,))
    assert len(rows) == 1
    assert rows[0]["Name"] == "test"


def test_execute_runs_statement(tmp_db):
    db.execute("INSERT INTO connections (ConnectionId, Name) VALUES (?, ?)", (99, "exec_test"))
    rows = db.query("SELECT Name FROM connections WHERE ConnectionId = ?", (99,))
    assert rows[0]["Name"] == "exec_test"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_db.py -v`
Expected: FAIL — `db` module does not exist

- [ ] **Step 3: Implement db.py**

```python
# dashboard/app/api/db.py
"""SQLite connection helpers for the FMD dashboard.

Thin wrapper providing get_db(), query(), execute(), and init_db().
The schema mirrors control_plane_db.py's init_db() — both create the
same tables (IF NOT EXISTS), so they're compatible.
"""
import sqlite3
import logging
from pathlib import Path

log = logging.getLogger("fmd.db")

DB_PATH = Path(__file__).parent / "fmd_control_plane.db"


def get_db() -> sqlite3.Connection:
    """Return a new SQLite connection with WAL mode and row_factory."""
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def query(sql: str, params: tuple = ()) -> list[dict]:
    """Execute a SELECT and return list of dicts."""
    conn = get_db()
    try:
        cursor = conn.execute(sql, params)
        cols = [d[0] for d in cursor.description] if cursor.description else []
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
    finally:
        conn.close()


def execute(sql: str, params: tuple = ()) -> None:
    """Execute a write statement (INSERT/UPDATE/DELETE)."""
    conn = get_db()
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Create all tables if they don't exist.

    Uses the same schema as control_plane_db.init_db() — both use
    IF NOT EXISTS so they're safe to call in any order.
    """
    from dashboard.app.api.control_plane_db import init_db as cpdb_init
    cpdb_init()
    log.info("SQLite DB initialized at %s", DB_PATH)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard/app/api && python -m pytest tests/test_db.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/db.py dashboard/app/api/tests/test_db.py
git commit -m "feat: add db.py SQLite connection wrapper"
```

---

### Task 3: Create Route Module Skeleton — `routes/__init__.py` + `routes/admin.py`

**Files:**
- Create: `dashboard/app/api/routes/__init__.py`
- Create: `dashboard/app/api/routes/admin.py`
- Create: `dashboard/app/api/tests/test_routes_admin.py`
- Reference: `dashboard/app/api/server.py` lines 9151-9155 (admin auth bypass — `pw != expected` when both empty)

The `routes/__init__.py` auto-imports all route modules so registering them with the router is automatic. `admin.py` is first because it contains the auth bypass security fix.

- [ ] **Step 1: Write the failing test for admin routes**

```python
# dashboard/app/api/tests/test_routes_admin.py
import os
import json
import pytest
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture(autouse=True)
def setup_admin_routes():
    _routes.clear()
    # Import triggers @route decorators
    import dashboard.app.api.routes.admin
    yield
    _routes.clear()


def test_health_endpoint_returns_ok():
    status, _, body = dispatch("GET", "/api/health", {}, None)
    assert status == 200
    result = json.loads(body)
    assert result["status"] == "ok"


def test_admin_config_rejects_empty_password():
    """Security fix: empty ADMIN_PASSWORD must not match empty input."""
    os.environ.pop("ADMIN_PASSWORD", None)
    status, _, body = dispatch("POST", "/api/admin/config", {}, {"password": "", "key": "x", "value": "y"})
    assert status == 403


def test_admin_config_rejects_wrong_password():
    os.environ["ADMIN_PASSWORD"] = "secret123"
    status, _, body = dispatch("POST", "/api/admin/config", {}, {"password": "wrong"})
    assert status == 403
    os.environ.pop("ADMIN_PASSWORD", None)


def test_admin_config_accepts_correct_password():
    os.environ["ADMIN_PASSWORD"] = "secret123"
    status, _, body = dispatch("POST", "/api/admin/config", {},
                                {"password": "secret123", "key": "test_key", "value": "test_val"})
    # May succeed or fail depending on db state, but should NOT be 403
    assert status != 403
    os.environ.pop("ADMIN_PASSWORD", None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_admin.py -v`
Expected: FAIL — routes module doesn't exist

- [ ] **Step 3: Create routes/__init__.py and routes/admin.py**

```python
# dashboard/app/api/routes/__init__.py
"""Auto-import all route modules to trigger @route decorator registration."""
import importlib
import pkgutil
from pathlib import Path

_pkg_dir = Path(__file__).parent

for _, module_name, _ in pkgutil.iter_modules([str(_pkg_dir)]):
    importlib.import_module(f".{module_name}", __package__)
```

```python
# dashboard/app/api/routes/admin.py
"""Admin, setup, deploy, and health routes.

Security fix: ADMIN_PASSWORD must be set AND non-empty. Empty string
no longer matches empty input (was a bypass vulnerability).
"""
import os
import logging

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db

log = logging.getLogger("fmd.routes.admin")


def _check_admin_password(params: dict):
    """Validate admin password. Raises HttpError(403) on failure."""
    password = params.get("password", "")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")
    if not admin_pw or password != admin_pw:
        raise HttpError("Forbidden", 403)


@route("GET", "/api/health")
def get_health(params):
    return {"status": "ok", "db": str(db.DB_PATH)}


@route("POST", "/api/admin/config")
def post_admin_config(params):
    _check_admin_password(params)
    key = params.get("key", "")
    value = params.get("value", "")
    if not key:
        raise HttpError("key is required", 400)
    db.execute(
        "INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)",
        (key, value),
    )
    return {"ok": True, "key": key}


@route("GET", "/api/admin/config")
def get_admin_config(params):
    rows = db.query("SELECT key, value FROM admin_config")
    return {r["key"]: r["value"] for r in rows}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_admin.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/routes/__init__.py dashboard/app/api/routes/admin.py dashboard/app/api/tests/test_routes_admin.py
git commit -m "feat: add routes/admin.py with admin auth bypass fix (security)"
```

---

### Task 4: Extract `routes/control_plane.py` — Control Plane + Execution Matrix + Record Counts

**Files:**
- Create: `dashboard/app/api/routes/control_plane.py`
- Create: `dashboard/app/api/tests/test_routes_control_plane.py`
- Reference: `dashboard/app/api/server.py` — `get_control_plane()`, `get_execution_matrix()`, `get_record_counts()`, `get_registered_connections()`, `get_registered_datasources()`, etc.
- Reference: `dashboard/app/api/control_plane_db.py` — existing CRUD functions

These handlers currently have dual data paths (SQLite + Fabric SQL). The new version reads ONLY from SQLite via `control_plane_db.py`.

- [ ] **Step 1: Write the failing test**

```python
# dashboard/app/api/tests/test_routes_control_plane.py
import json
import pytest
from dashboard.app.api.router import dispatch, _routes
from dashboard.app.api import db as fmd_db


@pytest.fixture(autouse=True)
def setup(tmp_path):
    _routes.clear()
    fmd_db.DB_PATH = tmp_path / "test.db"
    fmd_db.init_db()
    import dashboard.app.api.routes.control_plane
    yield
    _routes.clear()


def test_get_connections_returns_list():
    status, _, body = dispatch("GET", "/api/connections", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_datasources_returns_list():
    status, _, body = dispatch("GET", "/api/datasources", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_entities_returns_list():
    status, _, body = dispatch("GET", "/api/entities", {}, None)
    assert status == 200
    assert isinstance(json.loads(body), list)


def test_get_control_plane_returns_dict():
    status, _, body = dispatch("GET", "/api/control-plane", {}, None)
    assert status == 200
    result = json.loads(body)
    assert "sources" in result or isinstance(result, dict)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_control_plane.py -v`
Expected: FAIL — routes.control_plane does not exist

- [ ] **Step 3: Extract handlers from server.py into routes/control_plane.py**

Read `server.py` to find each handler function (`get_control_plane`, `get_registered_connections`, `get_registered_datasources`, `get_registered_entities`, `get_execution_matrix`, `get_record_counts`, `get_sources_summary`). Copy each function body, replacing `query_sql()` calls with `control_plane_db` calls (most already have SQLite paths — delete the Fabric SQL fallback branch). Add `@route` decorators.

Key pattern for each handler extraction:

```python
# dashboard/app/api/routes/control_plane.py
from dashboard.app.api.router import route, HttpError
from dashboard.app.api import control_plane_db as cpdb

@route("GET", "/api/connections")
def get_connections(params):
    return cpdb.get_connections()  # Already exists in cpdb

@route("GET", "/api/datasources")
def get_datasources(params):
    return cpdb.get_datasources()

@route("GET", "/api/entities")
def get_entities(params):
    return cpdb.get_all_entities()

# ... etc for each endpoint
```

**CRITICAL:** Delete ALL dual data path logic. Each handler has exactly ONE data source: SQLite via `cpdb`. No `if _cpdb_available()` / `else query_sql()` branches.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_control_plane.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/routes/control_plane.py dashboard/app/api/tests/test_routes_control_plane.py
git commit -m "feat: extract routes/control_plane.py — SQLite only, no dual data paths"
```

---

### Task 5: Extract `routes/entities.py` — Entity CRUD + Digest + Journey

**Files:**
- Create: `dashboard/app/api/routes/entities.py`
- Create: `dashboard/app/api/tests/test_routes_entities.py`
- Reference: `dashboard/app/api/server.py` — `register_entity()`, `get_entity_digest()`, `get_cascade_impact()`, `build_entity_digest()` (SQL injection fix)

- [ ] **Step 1: Write the failing test**

```python
# dashboard/app/api/tests/test_routes_entities.py
import json
import pytest
from dashboard.app.api.router import dispatch, _routes
from dashboard.app.api import db as fmd_db


@pytest.fixture(autouse=True)
def setup(tmp_path):
    _routes.clear()
    fmd_db.DB_PATH = tmp_path / "test.db"
    fmd_db.init_db()
    import dashboard.app.api.routes.entities
    yield
    _routes.clear()


def test_get_entity_digest():
    status, _, body = dispatch("GET", "/api/entity-digest", {}, None)
    assert status == 200

def test_cascade_impact_requires_ids():
    status, _, body = dispatch("GET", "/api/entities/cascade-impact", {}, None)
    assert status == 400

def test_register_entity_requires_body():
    status, _, body = dispatch("POST", "/api/entities", {}, {})
    # Should fail validation, not crash
    assert status in (400, 200, 201)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_entities.py -v`
Expected: FAIL

- [ ] **Step 3: Extract entity handlers — fix SQL injection in build_entity_digest**

Copy entity-related handlers from `server.py`. In `build_entity_digest`, replace the f-string source filter with parameterized query:

```python
# BEFORE (SQL injection):
# f"WHERE SourceName LIKE '%{source_filter}%'"
# AFTER (parameterized):
# "WHERE SourceName LIKE ?", (f"%{source_filter}%",)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_entities.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/routes/entities.py dashboard/app/api/tests/test_routes_entities.py
git commit -m "feat: extract routes/entities.py — fix SQL injection in build_entity_digest"
```

---

### Task 6: Extract `routes/engine.py` — Engine API Delegation

**Files:**
- Create: `dashboard/app/api/routes/engine.py`
- Reference: `engine/api.py` (1,379 lines) — this module stays as-is for now; routes/engine.py delegates to it
- Reference: `dashboard/app/api/server.py` lines 8973-8977 (current engine dispatch)

`routes/engine.py` is a thin delegation layer. It registers `/api/engine/*` routes and delegates to `engine/api.py`'s existing handlers. The heavy migration of `engine/api.py` from Fabric SQL to SQLite happens in Task 11 (Phase 2).

- [ ] **Step 1: Write the failing test**

```python
# dashboard/app/api/tests/test_routes_engine.py
import json
import pytest
from dashboard.app.api.router import _routes


@pytest.fixture(autouse=True)
def setup():
    _routes.clear()
    import dashboard.app.api.routes.engine
    yield
    _routes.clear()


def test_engine_routes_registered():
    methods_paths = [(m, p) for (m, p) in _routes.keys()]
    # At minimum, status and start should be registered
    assert ("GET", "/api/engine/status") in methods_paths
    assert ("POST", "/api/engine/start") in methods_paths
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_engine.py -v`
Expected: FAIL

- [ ] **Step 3: Implement routes/engine.py as delegation layer**

```python
# dashboard/app/api/routes/engine.py
"""Engine routes — thin delegation to engine/api.py.

engine/api.py contains all business logic (1,379 lines). This module
just registers routes and delegates. engine/api.py's Fabric SQL calls
get migrated to SQLite in Phase 2 (Task 11).
"""
from dashboard.app.api.router import route, sse_route

@route("GET", "/api/engine/status")
def engine_status(params):
    from engine.api import handle_get_status
    return handle_get_status(params)

@route("POST", "/api/engine/start")
def engine_start(params):
    from engine.api import handle_post_start
    return handle_post_start(params)

# ... register all 12 engine endpoints with lazy imports
```

**NOTE:** `engine/api.py` currently uses `handle_engine_request(handler, method, path, config, query_sql_fn)` — a monolithic dispatcher. Each endpoint needs to be extracted into its own function that takes `params` and returns a dict. This is a refactor of `engine/api.py` internals, done as part of this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_engine.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/routes/engine.py dashboard/app/api/tests/test_routes_engine.py
git commit -m "feat: add routes/engine.py delegation layer to engine/api.py"
```

---

### Task 7: Extract Remaining Route Modules

**Files:**
- Create: `dashboard/app/api/routes/pipeline.py`
- Create: `dashboard/app/api/routes/monitoring.py`
- Create: `dashboard/app/api/routes/data_access.py`
- Create: `dashboard/app/api/routes/sql_explorer.py` (ODBC injection fix)
- Create: `dashboard/app/api/routes/source_manager.py`
- Create: `dashboard/app/api/routes/config_manager.py` (SQL injection fix in update_config_value)

This is the bulk extraction. Each module follows the same pattern:
1. Copy handler functions from server.py
2. Add `@route` decorator
3. Replace `query_sql()` with SQLite (`cpdb.*` or `db.query()`)
4. Delete dual data path branches
5. Apply security fixes during extraction

**Security fix #6 (hardcoded credentials in SourceManager):** Already fixed in the frontend audit batch. Verify during `routes/source_manager.py` extraction that no credentials are hardcoded — the frontend no longer sends them, and the backend should not store them.

- [ ] **Step 1: Write tests for each route module**

Create one test file per module. Each test imports the module (triggering route registration) and verifies the key endpoints return valid responses from an empty SQLite database.

Pattern per test file:
```python
# dashboard/app/api/tests/test_routes_<module>.py
import json, pytest
from dashboard.app.api.router import dispatch, _routes
from dashboard.app.api import db as fmd_db

@pytest.fixture(autouse=True)
def setup(tmp_path):
    _routes.clear()
    fmd_db.DB_PATH = tmp_path / "test.db"
    fmd_db.init_db()
    import dashboard.app.api.routes.<module>
    yield
    _routes.clear()

def test_<endpoint>_returns_valid():
    status, _, body = dispatch("GET", "/api/<path>", {}, None)
    assert status == 200
```

**IMPORTANT: Security-specific tests to include:**

```python
# test_routes_sql_explorer.py — ODBC injection prevention
def test_rejects_unregistered_server():
    """Server param must be in registered connections allowlist."""
    status, _, body = dispatch("POST", "/api/sql-explorer/query", {},
                                {"server": "evil-server.example.com", "database": "master", "sql": "SELECT 1"})
    assert status == 403

# test_routes_config_manager.py — SQL injection prevention
def test_config_update_parameterized():
    """Verify SQL injection attempt doesn't corrupt the database."""
    status, _, body = dispatch("POST", "/api/config/update", {},
                                {"key": "'; DROP TABLE config; --", "value": "test"})
    # Should succeed (key is just a string value, parameterized), not crash
    assert status in (200, 400)

# test_routes_data_access.py — blender query validation
def test_blender_rejects_non_select():
    status, _, body = dispatch("POST", "/api/blender/query", {},
                                {"lakehouse": "test", "sql": "DELETE FROM table1"})
    assert status == 400
```

- [ ] **Step 2: Run all tests to verify they fail**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_*.py -v`
Expected: FAIL for all new tests

- [ ] **Step 3: Implement each route module**

**Security fixes baked into extraction:**

`routes/sql_explorer.py` — ODBC injection fix:
```python
@route("POST", "/api/sql-explorer/query")
def sql_explorer_query(params):
    server = params.get("server", "")
    # Validate against registered connections
    allowed = db.query("SELECT ServerName FROM connections WHERE IsActive = 1")
    allowed_servers = {r["ServerName"].lower() for r in allowed if r["ServerName"]}
    if server.lower() not in allowed_servers:
        raise HttpError(f"Server '{server}' not in registered connections", 403)
    # ... safe ODBC connection ...
```

`routes/config_manager.py` — SQL injection fix:
```python
@route("POST", "/api/config/update")
def update_config_value(params):
    key = params.get("key", "")
    value = params.get("value", "")
    # Parameterized — no f-string interpolation
    db.execute("UPDATE config SET value = ? WHERE key = ?", (value, key))
    return {"ok": True}
```

`routes/data_access.py` — SQL injection fix in blender query:
```python
@route("POST", "/api/blender/query")
def blender_query(params):
    # Validate lakehouse param against registered lakehouses
    lh = params.get("lakehouse", "")
    sql = params.get("sql", "")
    # Only allow SELECT statements
    if not sql.strip().upper().startswith("SELECT"):
        raise HttpError("Only SELECT queries allowed", 400)
    # ... execute against lakehouse SQL endpoint (remains — see spec) ...
```

- [ ] **Step 4: Run all route tests**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_*.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/routes/*.py dashboard/app/api/tests/test_routes_*.py
git commit -m "feat: extract 6 remaining route modules — SQL injection + ODBC injection fixed"
```

---

### Task 8: Rewrite `server.py` to Use Router Dispatch

**Files:**
- Modify: `dashboard/app/api/server.py` (9,267 lines → ~200 lines)
- Create: `dashboard/app/api/tests/test_server_dispatch.py`

This is the big rewrite. The 125 elif clauses in `do_GET`/`do_POST`/`do_DELETE` are replaced with calls to `router.dispatch()` and `router.dispatch_sse()`.

- [ ] **Step 1: Write the failing test**

```python
# dashboard/app/api/tests/test_server_dispatch.py
"""Verify server.py delegates to router instead of monolithic elif."""
import pytest

def test_server_do_get_uses_dispatch():
    """After rewrite, server.py's do_GET should call router.dispatch()."""
    import dashboard.app.api.server as srv
    source = open(srv.__file__).read()
    assert "dispatch(" in source
    # The old pattern should be gone
    assert source.count("elif self.path") < 5  # Allow a few for static files
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_server_dispatch.py -v`
Expected: FAIL — server.py still has 125 elif clauses

- [ ] **Step 3: Rewrite server.py**

The new `server.py` should be ~200 lines:

```python
# dashboard/app/api/server.py (rewritten)
"""FMD Operations Dashboard — HTTP Server.

Serves React static files and delegates all /api/* to the route registry.
~200 lines. All handler logic lives in routes/*.py modules.
"""
import json
import logging
import socketserver
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import sys
import threading

# Project root on sys.path
_project_root = str(Path(__file__).resolve().parent.parent.parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from dashboard.app.api import db
from dashboard.app.api.router import dispatch, dispatch_sse
import dashboard.app.api.routes  # triggers auto-import of all route modules

log = logging.getLogger("fmd.server")

# ... config loading (~20 lines) ...
# ... static file serving (~30 lines) ...

class DashboardHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        query_params = {k: v[0] if len(v) == 1 else v for k, v in qs.items()}

        if path.startswith("/api/"):
            # Try SSE first
            if dispatch_sse("GET", path, self, query_params):
                return
            # Regular JSON dispatch
            status, headers, body = dispatch("GET", path, query_params, None)
            self._send(status, headers, body)
        else:
            serve_static(self, path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        query_params = {k: v[0] if len(v) == 1 else v for k, v in qs.items()}

        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length)) if content_length else {}

        status, headers, response_body = dispatch("POST", path, query_params, body)
        self._send(status, headers, response_body)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        query_params = {k: v[0] if len(v) == 1 else v for k, v in qs.items()}

        status, headers, body = dispatch("DELETE", path, query_params, None)
        self._send(status, headers, body)

    def _send(self, status, headers, body):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

# ... main() with config loading, db.init_db(), background threads, HTTPServer ...
```

**CRITICAL:** Keep the old server.py as `server.py.bak` until Phase 1 deployment validates. Do NOT delete handler functions yet — they serve as reference for the route module implementations. The backup is temporary and gets deleted in Phase 4 scorched earth.

- [ ] **Step 4: Run ALL tests**

Run: `cd dashboard/app/api && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 5: Manual smoke test**

Run: `cd dashboard/app/api && python server.py`
- Open `http://localhost:8787/api/health` — should return `{"status": "ok"}`
- Open `http://localhost:8787/api/connections` — should return data from SQLite
- Open the full dashboard UI and click through 3-4 pages

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/api/server.py dashboard/app/api/tests/test_server_dispatch.py
git commit -m "refactor: rewrite server.py to use route registry dispatch (~200 lines)"
```

---

### Task 9: Deploy Phase 1 to vsc-fabric

**Files:**
- No code changes — deployment validation only

- [ ] **Step 1: Push to git**

```bash
git push origin main
```

- [ ] **Step 2: Pull on vsc-fabric and restart**

```bash
# On vsc-fabric (RDP or remote):
cd C:\Projects\FMD_FRAMEWORK
git pull origin main
nssm restart FMD-Dashboard
```

- [ ] **Step 3: Validate on vsc-fabric**

- Open `http://vsc-fabric/api/health`
- Open `http://vsc-fabric/` — full dashboard
- Click through ControlPlane, ExecutionMatrix, RecordCounts, EngineControl pages
- Verify no console errors, no blank pages, data matches laptop

- [ ] **Step 4: Commit deploy validation note**

No commit needed — just verify it works.

---

## Chunk 2: Full SQLite Migration

### Task 10: Expand SQLite Schema for Execution Data

**Files:**
- Modify: `dashboard/app/api/control_plane_db.py` — add missing execution tables
- Create: `dashboard/app/api/tests/test_cpdb_schema.py`

The current SQLite schema in `control_plane_db.py` already has `engine_runs`, `engine_task_log`, `pipeline_audit`, `copy_activity_audit`, and `entity_status`. Verify all columns match what `engine/logging_db.py` writes, and add any missing tables (e.g., `notebook_executions`).

**IMPORTANT: Actual SQLite table names (from `control_plane_db.py`):**
- `pipeline_audit` (NOT `pipeline_executions`)
- `copy_activity_audit` (NOT `copy_activity_executions`)
- `entity_status` (NOT `entity_status_summary`)
- `sync_metadata` (NOT `sync_status`)

- [ ] **Step 1: Write the test**

```python
# dashboard/app/api/tests/test_cpdb_schema.py
import pytest
from dashboard.app.api import db as fmd_db

@pytest.fixture(autouse=True)
def setup(tmp_path):
    fmd_db.DB_PATH = tmp_path / "test.db"
    fmd_db.init_db()

def test_all_required_tables_exist():
    rows = fmd_db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = {r["name"] for r in rows}
    required = {
        "connections", "datasources", "lakehouses", "workspaces", "pipelines",
        "lz_entities", "bronze_entities", "silver_entities",
        "engine_runs", "engine_task_log",
        "pipeline_audit", "copy_activity_audit",
        "entity_status", "notebook_executions",
        "sync_metadata", "server_labels", "admin_config", "import_jobs",
    }
    missing = required - tables
    assert not missing, f"Missing tables: {missing}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_cpdb_schema.py -v`
Expected: May FAIL if `notebook_executions` or other tables are missing

- [ ] **Step 3: Add missing tables to control_plane_db.py's init_db()**

Add any missing CREATE TABLE statements. Match column names to what `engine/logging_db.py` writes.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard/app/api && python -m pytest tests/test_cpdb_schema.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/control_plane_db.py dashboard/app/api/tests/test_cpdb_schema.py
git commit -m "feat: expand SQLite schema for all execution tables"
```

---

### Task 11: Migrate `engine/logging_db.py` from Fabric SQL to SQLite-Only

**Files:**
- Modify: `engine/logging_db.py` (647 lines)
- Modify: `engine/tests/test_logging_db.py`
- Reference: `engine/connections.py` — `MetadataDB` class gets deleted after this

This is the critical migration. `AuditLogger` currently dual-writes: SQLite (primary) + Fabric SQL stored procs (secondary). We delete the Fabric SQL writes entirely.

- [ ] **Step 1: Write the test**

```python
# engine/tests/test_logging_db_sqlite.py
"""Verify logging_db writes ONLY to SQLite, no Fabric SQL references."""
import ast
import inspect

def test_no_fabric_sql_references():
    import engine.logging_db as ldb
    source = inspect.getsource(ldb)
    # No stored procedure calls
    assert "sp_Upsert" not in source
    assert "sp_Audit" not in source
    assert "sp_Insert" not in source
    # No MetadataDB usage
    assert "MetadataDB" not in source
    assert "self._db.execute_proc" not in source
    assert "self._db.execute(" not in source  # MetadataDB.execute

def test_audit_logger_takes_no_metadata_db():
    from engine.logging_db import AuditLogger
    sig = inspect.signature(AuditLogger.__init__)
    params = list(sig.parameters.keys())
    assert "metadata_db" not in params
    assert "db" not in params or len(params) == 1  # only self
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_logging_db_sqlite.py -v`
Expected: FAIL — logging_db still has Fabric SQL references

- [ ] **Step 3: Rewrite AuditLogger to SQLite-only**

Current pattern (dual-write):
```python
class AuditLogger:
    def __init__(self, metadata_db: MetadataDB):
        self._db = metadata_db

    def log_run_start(self, ...):
        # 1. Write to SQLite (primary)
        cpdb = _get_cpdb()
        if cpdb:
            cpdb.upsert_engine_run(...)
        # 2. Write to Fabric SQL (secondary)
        self._db.execute_proc("[execution].[sp_UpsertEngineRun]", {...})
```

New pattern (SQLite-only):
```python
class AuditLogger:
    def __init__(self):
        pass  # No MetadataDB dependency

    def log_run_start(self, ...):
        cpdb = _get_cpdb()
        if cpdb:
            cpdb.upsert_engine_run(...)
        # That's it. No Fabric SQL.
```

Apply this pattern to ALL 6 audit methods:
- `log_run_start` / `log_run_end` — remove `sp_UpsertEngineRun`
- `log_pipeline_audit` — remove `sp_AuditPipeline`
- `log_copy_activity` — remove `sp_AuditCopyActivity`
- `log_task` — remove `sp_InsertEngineTaskLog`
- `log_entity_loaded` — remove `sp_UpsertPipelineLandingzoneEntity` and `sp_UpsertEntityStatus`

Also remove the `MetadataDB` import and the `self._db` instance variable.

- [ ] **Step 4: Update all callers of AuditLogger**

Search for `AuditLogger(` in `engine/` — it's constructed in `engine/orchestrator.py`. Update to `AuditLogger()` (no `metadata_db` arg).

- [ ] **Step 5: Run tests**

Run: `cd engine && python -m pytest tests/test_logging_db_sqlite.py tests/test_logging_db.py -v`
Expected: New test PASSES. Old test may need updates (remove Fabric SQL mock expectations).

- [ ] **Step 6: Commit**

```bash
git add engine/logging_db.py engine/orchestrator.py engine/tests/
git commit -m "refactor: logging_db.py writes SQLite only — all Fabric SQL stored proc calls removed"
```

---

### Task 12: Migrate `engine/api.py` from Fabric SQL to SQLite

**Files:**
- Modify: `engine/api.py` (1,379 lines) — replace 33 `query_sql()` calls
- Modify: `engine/tests/test_api.py`

`engine/api.py` receives `query_sql_fn` from server.py and uses it for Fabric SQL queries. Replace ALL 33 calls with SQLite queries via `control_plane_db`.

- [ ] **Step 1: Write the test**

```python
# engine/tests/test_api_sqlite.py
import inspect

def test_no_query_sql_references():
    import engine.api as api
    source = inspect.getsource(api)
    assert "query_sql" not in source
    assert "query_sql_fn" not in source
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_api_sqlite.py -v`
Expected: FAIL — 33 query_sql references

- [ ] **Step 3: Replace all query_sql calls with cpdb/db.query calls**

For each `query_sql()` call in `engine/api.py`:
1. Find the SQL query being executed
2. Write an equivalent SQLite query (table names may differ — e.g., `integration.Connection` → `connections`)
3. Replace the call with `cpdb.get_connections()` or `db.query("SELECT ...")` as appropriate

Also remove the `query_sql_fn` parameter from all function signatures and the `handle_engine_request` dispatcher.

- [ ] **Step 4: Run tests**

Run: `cd engine && python -m pytest tests/ -v`
Expected: All PASS (some existing tests may need mock updates)

- [ ] **Step 5: Commit**

```bash
git add engine/api.py engine/tests/
git commit -m "refactor: engine/api.py reads from SQLite only — 33 query_sql calls replaced"
```

---

### Task 13: Delete `MetadataDB` from `engine/connections.py`

**Files:**
- Modify: `engine/connections.py` — delete MetadataDB class (lines 24-115), keep SourceConnection (lines 117-157) and build_source_map (lines 170-181)
- Modify: `engine/tests/test_connections.py` — remove MetadataDB tests
- Modify: `engine/tests/conftest.py` — remove MetadataDB fixtures

**CRITICAL:** Do NOT delete the entire file. `SourceConnection` is used by `engine/extractor.py`, `engine/orchestrator.py`, and `engine/preflight.py` for on-prem SQL Server connections over VPN. Only `MetadataDB` (Fabric SQL connector) gets deleted.

- [ ] **Step 1: Write the test**

```python
# engine/tests/test_connections_no_metadata.py
import inspect

def test_no_metadata_db_class():
    import engine.connections as conn
    assert not hasattr(conn, "MetadataDB")

def test_source_connection_still_exists():
    from engine.connections import SourceConnection
    assert SourceConnection is not None

def test_build_source_map_still_exists():
    from engine.connections import build_source_map
    assert build_source_map is not None

def test_no_fabric_token_reference():
    source = inspect.getsource(inspect.getmodule(SourceConnection))
    assert "token" not in source.lower() or "token" in "TrustServerCertificate"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_connections_no_metadata.py -v`
Expected: FAIL — MetadataDB still exists

- [ ] **Step 3: Delete MetadataDB class, keep SourceConnection**

Edit `engine/connections.py`:
- Delete lines 24-115 (MetadataDB class)
- Delete `from engine.auth import TokenProvider` import (only used by MetadataDB)
- Keep `SourceConnection` (lines 117-167 inclusive — includes `ping()` method), `build_source_map` (lines 170-181)
- Keep `from engine.models import EngineConfig, Entity` (used by both remaining items)

- [ ] **Step 4: Fix ALL MetadataDB import sites**

Search for `from engine.connections import MetadataDB` across the codebase. Full list of files that import MetadataDB:
- `engine/logging_db.py` — already removed in Task 11
- `engine/orchestrator.py` — already removed in Task 11 Step 4
- `engine/preflight.py` (line 20) — remove MetadataDB parameter from preflight functions, rewrite Fabric SQL connectivity check as a no-op or remove it
- `engine/smoke_test.py` (lines 71, 86) — remove MetadataDB test sections entirely
- `engine/tests/conftest.py` — remove MetadataDB fixtures
- `engine/tests/test_connections.py` — remove MetadataDB tests

- [ ] **Step 5: Run tests**

Run: `cd engine && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add engine/connections.py engine/preflight.py engine/smoke_test.py engine/tests/
git commit -m "refactor: delete MetadataDB class — keep SourceConnection for on-prem ODBC"
```

---

### Task 14: Build `parquet_sync.py` — SQLite to Parquet Export

**Files:**
- Create: `dashboard/app/api/parquet_sync.py`
- Create: `dashboard/app/api/tests/test_parquet_sync.py`

Background thread that exports dirty SQLite tables to Parquet files in the local OneLake directory.

- [ ] **Step 1: Write the failing test**

```python
# dashboard/app/api/tests/test_parquet_sync.py
import time
import pytest
from pathlib import Path
from dashboard.app.api import db as fmd_db
from dashboard.app.api import parquet_sync


@pytest.fixture
def setup(tmp_path):
    fmd_db.DB_PATH = tmp_path / "test.db"
    fmd_db.init_db()
    parquet_sync.ONELAKE_DIR = tmp_path / "onelake"
    parquet_sync.ONELAKE_DIR.mkdir()
    # Seed test data
    fmd_db.execute("INSERT INTO connections (ConnectionId, Name) VALUES (1, 'test')")
    yield tmp_path


def test_queue_and_export(setup):
    parquet_sync.queue_export("connections")
    parquet_sync._export_once()  # Synchronous export for testing
    pq_file = parquet_sync.ONELAKE_DIR / "connections.parquet"
    assert pq_file.exists()


def test_queue_rejects_unknown_table():
    with pytest.raises(ValueError):
        parquet_sync.queue_export("nonexistent_table")


def test_export_recovers_from_error(setup):
    """If export fails, table stays in dirty set for retry."""
    parquet_sync.queue_export("connections")
    # Corrupt the output dir
    import shutil
    shutil.rmtree(parquet_sync.ONELAKE_DIR)
    parquet_sync._export_once()
    # Should be re-queued
    assert "connections" in parquet_sync._dirty_tables
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_parquet_sync.py -v`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement parquet_sync.py**

Follow the spec's design (see spec lines 237-277). Key functions to implement:
- `queue_export(table_name)` — validates against `EXPORTABLE_TABLES` whitelist, adds to `_dirty_tables`
- `_export_once()` — synchronous single-pass export of all dirty tables (for testability)
- `_export_loop()` — calls `_export_once()` in a `while True` loop with 10s sleep
- `start_export_thread()` — creates and starts a daemon thread running `_export_loop()`

**IMPORTANT:** The `EXPORTABLE_TABLES` whitelist must use actual SQLite table names from `control_plane_db.py`:
```python
EXPORTABLE_TABLES = {
    "connections", "datasources", "lz_entities", "bronze_entities", "silver_entities",
    "lakehouses", "workspaces", "pipelines", "entity_status",
    "pipeline_audit", "copy_activity_audit", "engine_runs", "engine_task_log",
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard/app/api && python -m pytest tests/test_parquet_sync.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/parquet_sync.py dashboard/app/api/tests/test_parquet_sync.py
git commit -m "feat: add parquet_sync.py — SQLite to Parquet export with retry"
```

---

### Task 15: Build `delta_ingest.py` — OneLake to SQLite Ingest

**Files:**
- Create: `dashboard/app/api/delta_ingest.py`
- Create: `dashboard/app/api/tests/test_delta_ingest.py`

Replaces `_sync_fabric_to_sqlite()` (server.py lines 225-397). Reads Parquet files from the local OneLake directory and upserts into SQLite execution tables.

- [ ] **Step 1: Write the failing test**

```python
# dashboard/app/api/tests/test_delta_ingest.py
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from dashboard.app.api import db as fmd_db
from dashboard.app.api import delta_ingest


@pytest.fixture
def setup(tmp_path):
    fmd_db.DB_PATH = tmp_path / "test.db"
    fmd_db.init_db()
    delta_ingest.ONELAKE_DIR = tmp_path / "onelake"
    delta_ingest.ONELAKE_DIR.mkdir()
    yield tmp_path


def test_ingest_parquet_into_sqlite(setup):
    # Write a test parquet file
    table = pa.table({
        "RunId": ["run-001"],
        "Mode": ["full"],
        "Status": ["Completed"],
        "TotalEntities": [10],
        "SucceededEntities": [8],
        "FailedEntities": [2],
        "SkippedEntities": [0],
    })
    pq.write_table(table, delta_ingest.ONELAKE_DIR / "engine_runs.parquet")

    delta_ingest.ingest_all()

    rows = fmd_db.query("SELECT * FROM engine_runs WHERE RunId = ?", ("run-001",))
    assert len(rows) == 1
    assert rows[0]["Status"] == "Completed"


def test_watermark_skips_unchanged_files(setup):
    table = pa.table({"RunId": ["run-002"], "Mode": ["incremental"], "Status": ["Running"]})
    path = delta_ingest.ONELAKE_DIR / "engine_runs.parquet"
    pq.write_table(table, path)

    delta_ingest.ingest_all()
    count1 = len(fmd_db.query("SELECT * FROM engine_runs"))

    # Second ingest without file change — should skip
    delta_ingest.ingest_all()
    count2 = len(fmd_db.query("SELECT * FROM engine_runs"))
    assert count1 == count2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_delta_ingest.py -v`
Expected: FAIL

- [ ] **Step 3: Implement delta_ingest.py**

```python
# dashboard/app/api/delta_ingest.py
"""OneLake Parquet/Delta -> SQLite ingest.

Replaces _sync_fabric_to_sqlite(). Reads local Parquet files written by
Fabric notebooks (via OneLake sync agent) and upserts into SQLite.
"""
import logging
import os
from pathlib import Path

import pyarrow.parquet as pq

from dashboard.app.api import db

log = logging.getLogger("fmd.delta_ingest")

ONELAKE_DIR = Path(os.environ.get("ONELAKE_LOCAL_DIR", ""))

# Map of parquet filename (without extension) -> (SQLite table, primary key column)
# IMPORTANT: Use actual control_plane_db.py table names, NOT spec conceptual names
TABLE_MAP = {
    "engine_runs": ("engine_runs", "RunId"),
    "engine_task_log": ("engine_task_log", "id"),
    "pipeline_audit": ("pipeline_audit", "ExecutionId"),
    "copy_activity_audit": ("copy_activity_audit", "ActivityId"),
    "entity_status": ("entity_status", "EntityId"),
    "notebook_executions": ("notebook_executions", "ExecutionId"),
}

# Watermarks: filename -> last modified timestamp
_watermarks: dict[str, float] = {}


def ingest_all():
    """Scan ONELAKE_DIR for Parquet files and upsert into SQLite."""
    if not ONELAKE_DIR or not ONELAKE_DIR.exists():
        log.warning("OneLake dir not set or doesn't exist: %s", ONELAKE_DIR)
        return

    for pq_file in ONELAKE_DIR.glob("*.parquet"):
        stem = pq_file.stem
        if stem not in TABLE_MAP:
            continue

        # Watermark check
        mtime = pq_file.stat().st_mtime
        if _watermarks.get(stem) == mtime:
            log.debug("Skipping %s — unchanged", stem)
            continue

        table_name, pk = TABLE_MAP[stem]
        try:
            table = pq.read_table(pq_file)
            df = table.to_pandas()
            conn = db.get_db()
            try:
                for _, row in df.iterrows():
                    cols = list(row.index)
                    placeholders = ", ".join(["?"] * len(cols))
                    col_names = ", ".join(f"[{c}]" for c in cols)
                    values = tuple(
                        None if (hasattr(v, '__class__') and v.__class__.__name__ == 'NaTType')
                        else str(v) if v is not None else None
                        for v in row.values
                    )
                    conn.execute(
                        f"INSERT OR REPLACE INTO [{table_name}] ({col_names}) VALUES ({placeholders})",
                        values,
                    )
                conn.commit()
                _watermarks[stem] = mtime
                log.info("Ingested %s: %d rows into %s", pq_file.name, len(df), table_name)
            finally:
                conn.close()
        except Exception:
            log.exception("Failed to ingest %s", pq_file.name)


def start_ingest_thread(interval_seconds: int = 1800):
    """Start background thread that runs ingest_all() on a schedule."""
    import threading
    import time

    def _loop():
        while True:
            try:
                ingest_all()
            except Exception:
                log.exception("Delta ingest cycle failed")
            time.sleep(interval_seconds)

    t = threading.Thread(target=_loop, daemon=True, name="delta-ingest")
    t.start()
    log.info("Delta ingest thread started (interval=%ds)", interval_seconds)
```

**Performance note:** For large tables (50,000+ rows like `engine_task_log`), replace the `df.iterrows()` loop with `conn.executemany()` for batch inserts. The row-by-row approach works correctly but is slow for initial bulk ingestion.

- [ ] **Step 4: Run test**

Run: `cd dashboard/app/api && python -m pytest tests/test_delta_ingest.py -v`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/delta_ingest.py dashboard/app/api/tests/test_delta_ingest.py
git commit -m "feat: add delta_ingest.py — OneLake Parquet to SQLite ingest with watermarks"
```

---

### Task 16: One-Time SQLite Seed from Fabric SQL

**Files:**
- Create: `scripts/seed_sqlite_from_fabric.py`

One-time migration script. Pulls ALL data from Fabric SQL and populates SQLite. This bridges Phase 2 → Phase 3: until notebooks start writing Delta tables, SQLite has the historical execution data.

- [ ] **Step 1: Write the seed script**

```python
# scripts/seed_sqlite_from_fabric.py
"""One-time migration: Fabric SQL -> SQLite.

Run this ONCE before cutting over to SQLite-only mode.
Requires VPN and valid SP token for Fabric SQL.

Usage: python scripts/seed_sqlite_from_fabric.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dashboard.app.api.server import query_sql  # Uses existing Fabric SQL connection
from dashboard.app.api import control_plane_db as cpdb

TABLES_TO_SEED = [
    ("SELECT * FROM integration.Connection", cpdb.upsert_connection),
    ("SELECT * FROM integration.DataSource ds", cpdb.upsert_datasource),
    ("SELECT * FROM integration.Lakehouse", cpdb.upsert_lakehouse),
    ("SELECT * FROM integration.Workspace", cpdb.upsert_workspace),
    ("SELECT * FROM integration.Pipeline", cpdb.upsert_pipeline),
    # LZ/Bronze/Silver entities
    ("SELECT * FROM integration.LandingzoneEntity", cpdb.upsert_lz_entity),
    ("SELECT * FROM integration.BronzeLayerEntity", cpdb.upsert_bronze_entity),
    ("SELECT * FROM integration.SilverLayerEntity", cpdb.upsert_silver_entity),
    # Execution data
    ("SELECT TOP 10000 * FROM execution.EngineRun ORDER BY StartedAt DESC", cpdb.upsert_engine_run),
    ("SELECT TOP 50000 * FROM execution.EngineTaskLog ORDER BY StartedAt DESC", cpdb.upsert_engine_task_log),
    ("SELECT TOP 10000 * FROM logging.PipelineExecution ORDER BY StartedAt DESC", cpdb.upsert_pipeline_execution),
    ("SELECT TOP 50000 * FROM logging.CopyActivityExecution ORDER BY StartedAt DESC", cpdb.upsert_copy_activity),
    ("SELECT * FROM execution.EntityStatusSummary", cpdb.upsert_entity_status),
]

def main():
    cpdb.init_db()
    for sql, upsert_fn in TABLES_TO_SEED:
        table_name = sql.split("FROM")[1].strip().split()[0]
        print(f"Seeding {table_name}...")
        try:
            rows = query_sql(sql)
            for row in rows:
                upsert_fn(row)
            print(f"  -> {len(rows)} rows")
        except Exception as e:
            print(f"  -> FAILED: {e}")

    # Validation
    print("\n--- Validation ---")
    # Compare counts
    for sql, _ in TABLES_TO_SEED:
        table_name = sql.split("FROM")[1].strip().split()[0]
        # NOTE: Identifier (table_name) can't be parameterized — comes from hardcoded TABLES_TO_SEED, not user input
        result = query_sql(f"SELECT COUNT(*) as cnt FROM {table_name}")
        fabric_count = int(result[0]["cnt"]) if result else 0
        print(f"  {table_name}: {fabric_count} rows in Fabric SQL")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run on laptop (VPN required)**

Run: `python scripts/seed_sqlite_from_fabric.py`
Expected: All tables seeded, counts printed

- [ ] **Step 3: Validate row counts match**

Spot-check 3-4 tables: compare Fabric SQL count vs SQLite count. They should match.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed_sqlite_from_fabric.py
git commit -m "feat: add one-time SQLite seed script from Fabric SQL"
```

---

### Task 17: Wire Parquet Export + Delta Ingest into Server Bootstrap

**Files:**
- Modify: `dashboard/app/api/server.py` — start background threads
- Modify: `dashboard/app/api/routes/` — add `queue_export()` calls after writes

- [ ] **Step 1: Add background threads to server.py main()**

In server.py's startup, after `db.init_db()`:

```python
# Start parquet export background thread
from dashboard.app.api.parquet_sync import start_export_thread
start_export_thread()

# Start delta ingest background thread (every 30 minutes)
from dashboard.app.api.delta_ingest import start_ingest_thread
start_ingest_thread(interval_seconds=1800)
```

- [ ] **Step 2: Add queue_export() calls to write routes**

In route modules that write data (e.g., `routes/entities.py`'s `register_entity`, `routes/control_plane.py`'s `register_connection`), add:

```python
from dashboard.app.api.parquet_sync import queue_export

@route("POST", "/api/entities")
def register_entity(params):
    # ... insert into SQLite ...
    queue_export("lz_entities")
    queue_export("bronze_entities")
    queue_export("silver_entities")
    return {"ok": True}
```

- [ ] **Step 3: Delete _sync_fabric_to_sqlite() from server.py**

Remove the old sync function (lines 225-397 in the original server.py) and its background thread. Replace with delta_ingest thread.

- [ ] **Step 4: Test end-to-end**

Run: `python dashboard/app/api/server.py`
- Register an entity via the UI
- Verify Parquet file appears in ONELAKE_DIR
- Verify no errors in server logs

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/server.py dashboard/app/api/routes/
git commit -m "feat: wire parquet export + delta ingest into server bootstrap"
```

---

### Task 18: Deploy Phase 2 to vsc-fabric

- [ ] **Step 1: Run seed script on vsc-fabric**

```bash
# On vsc-fabric:
cd C:\Projects\FMD_FRAMEWORK
python scripts/seed_sqlite_from_fabric.py
```

- [ ] **Step 2: Pull and restart**

```bash
git pull origin main
nssm restart FMD-Dashboard
```

- [ ] **Step 3: Validate**

- Check all dashboard pages show data
- Verify parquet files appear in OneLake directory
- Check server logs for any errors

- [ ] **Step 4: Commit validation note if needed**

---

## Chunk 3: Notebook + Pipeline Migration

### Task 19: Update Notebooks to Write Delta Instead of Stored Procs

**Files:**
- Modify: `src/NB_FMD_LOAD_LANDINGZONE_MAIN.Notebook/notebook-content.py` (heaviest)
- Modify: `src/NB_FMD_PROCESSING_LANDINGZONE_MAIN.Notebook/notebook-content.py`
- Modify: `src/NB_FMD_LOAD_LANDING_BRONZE.Notebook/notebook-content.py`
- Modify: `src/NB_FMD_LOAD_BRONZE_SILVER.Notebook/notebook-content.py`
- Inventory: `src/NB_FMD_CUSTOM_NOTEBOOK_TEMPLATE.Notebook/notebook-content.py`
- Inventory: `src/NB_FMD_DQ_CLEANSING.Notebook/notebook-content.py`

Each notebook currently calls stored procs like `sp_AuditCopyActivity`, `sp_UpsertPipelineLandingzoneEntity`, etc. Replace with Delta table writes to the lakehouse.

- [ ] **Step 1: Read all 4 notebook files to find stored proc calls**

Read each notebook's `notebook-content.py` and catalog every stored proc call with line numbers.

- [ ] **Step 2: Create a Delta write helper function for notebooks**

```python
# Add to NB_FMD_UTILITY_FUNCTIONS or inline in each notebook
def write_audit_to_delta(table_name: str, data: dict, lakehouse_path: str):
    """Write audit data to a Delta table in the lakehouse instead of stored procs."""
    from pyspark.sql import SparkSession
    spark = SparkSession.builder.getOrCreate()
    df = spark.createDataFrame([data])
    df.write.mode("append").format("delta").save(f"{lakehouse_path}/Tables/{table_name}")
```

- [ ] **Step 3: Replace stored proc calls in NB_FMD_LOAD_LANDINGZONE_MAIN**

This notebook has the most stored proc calls:
- `sp_AuditCopyActivity` x3 → `write_audit_to_delta("copy_activity_executions", {...})`
- `sp_UpsertPipelineLandingzoneEntity` → `write_audit_to_delta("entity_status", {...})`
- `sp_UpsertLandingZoneEntityLastLoadValue` → `write_audit_to_delta("entity_watermarks", {...})`

- [ ] **Step 4: Replace stored proc calls in remaining 3 notebooks**

Same pattern for each notebook.

- [ ] **Step 5: Inventory NB_FMD_CUSTOM_NOTEBOOK_TEMPLATE and NB_FMD_DQ_CLEANSING**

Check if they have stored proc calls. If so, document but defer migration (they're lower priority).

- [ ] **Step 6: Commit**

```bash
git add src/NB_FMD_*.Notebook/
git commit -m "refactor: notebooks write Delta tables instead of Fabric SQL stored procs"
```

---

### Task 20: Update Pipeline JSON Files

**Files:**
- Modify: 21 `src/PL_FMD_*.DataPipeline/pipeline-content.json` files

Pipeline JSONs contain stored procedure activities. These need to be replaced with notebook activities or removed if the corresponding notebooks already handle the same logging.

- [ ] **Step 1: Catalog all stored proc references in pipeline JSONs**

```bash
grep -r "storedProcedureName" src/PL_FMD_*.DataPipeline/ --include="*.json" -l
```

- [ ] **Step 2: For each pipeline, determine if stored proc activity is redundant**

If the notebook that the pipeline triggers already writes the same audit data to Delta (from Task 19), the stored proc activity in the pipeline JSON can be deleted. If it's the sole source of audit logging, replace with a notebook call.

- [ ] **Step 3: Remove or replace stored proc activities**

Edit each pipeline JSON. Remove stored procedure activities that are now redundant. Replace remaining ones with notebook references.

- [ ] **Step 4: Commit**

```bash
git add src/PL_FMD_*.DataPipeline/
git commit -m "refactor: remove stored proc activities from pipeline JSONs"
```

---

### Task 21: Upload Updated Notebooks + Pipelines to Fabric

**Files:**
- No code changes — deployment to Fabric workspace

- [ ] **Step 1: Upload notebooks**

```bash
python scripts/upload_notebooks.py
```

Or use the Fabric REST API to upload each notebook.

- [ ] **Step 2: Upload pipelines**

```bash
python scripts/upload_pipelines.py
```

Then run `fix_pipeline_guids.py` to remap any GUIDs.

- [ ] **Step 3: Test end-to-end pipeline execution**

Trigger a small test run (1-2 entities) through each pipeline:
- Landing Zone → verify Delta audit table written
- Bronze → verify Delta audit table written
- Silver → verify Delta audit table written

- [ ] **Step 4: Verify delta_ingest picks up the new data**

On the dashboard server:
- Wait for OneLake sync to mirror the Delta files locally
- Trigger delta_ingest manually or wait for the 30-minute cycle
- Verify new execution data appears in SQLite and on the dashboard

- [ ] **Step 5: Commit any fixes**

```bash
git add .
git commit -m "fix: pipeline/notebook deployment fixes for Delta table writes"
```

---

## Chunk 4: Database Explorer + Scorched Earth

### Task 22: Build `routes/db_explorer.py` — Database Explorer Backend

**Files:**
- Create: `dashboard/app/api/routes/db_explorer.py`
- Create: `dashboard/app/api/tests/test_routes_db_explorer.py`

New dashboard page for Patrick to browse the SQLite database directly.

- [ ] **Step 1: Write the failing test**

```python
# dashboard/app/api/tests/test_routes_db_explorer.py
import json
import pytest
from dashboard.app.api.router import dispatch, _routes
from dashboard.app.api import db as fmd_db


@pytest.fixture(autouse=True)
def setup(tmp_path):
    _routes.clear()
    fmd_db.DB_PATH = tmp_path / "test.db"
    fmd_db.init_db()
    import dashboard.app.api.routes.db_explorer
    yield
    _routes.clear()


def test_list_tables():
    status, _, body = dispatch("GET", "/api/db-explorer/tables", {}, None)
    assert status == 200
    tables = json.loads(body)
    assert isinstance(tables, list)
    assert any(t["name"] == "connections" for t in tables)


def test_get_table_data():
    fmd_db.execute("INSERT INTO connections (ConnectionId, Name) VALUES (1, 'test')")
    status, _, body = dispatch("GET", "/api/db-explorer/table/connections", {"page": "1", "per_page": "10"}, None)
    assert status == 200
    result = json.loads(body)
    assert "rows" in result
    assert len(result["rows"]) == 1


def test_get_table_schema():
    status, _, body = dispatch("GET", "/api/db-explorer/table/connections/schema", {}, None)
    assert status == 200
    result = json.loads(body)
    assert isinstance(result, list)
    assert any(c["name"] == "ConnectionId" for c in result)


def test_read_only_query():
    status, _, body = dispatch("POST", "/api/db-explorer/query", {},
                                {"sql": "SELECT COUNT(*) as cnt FROM connections"})
    assert status == 200


def test_rejects_write_query():
    status, _, body = dispatch("POST", "/api/db-explorer/query", {},
                                {"sql": "DELETE FROM connections"})
    assert status == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_db_explorer.py -v`
Expected: FAIL

- [ ] **Step 3: Implement routes/db_explorer.py**

```python
# dashboard/app/api/routes/db_explorer.py
"""Database Explorer — browse SQLite tables, schemas, and run read-only queries.

SECURITY NOTES:
- Table names in FROM/PRAGMA use f-string interpolation because SQLite doesn't
  support parameterized table names. All table names are validated against
  sqlite_master before use, preventing arbitrary table injection.
- The read-only SQL console allows only SELECT/PRAGMA statements. SQLite's
  cursor.execute() runs only one statement (no stacked queries), which prevents
  "SELECT 1; DROP TABLE x" attacks. load_extension() is disabled by default in
  Python's sqlite3 module unless explicitly enabled.
"""
from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db


def _validate_table_name(table: str) -> bool:
    """Verify table exists in sqlite_master. Prevents f-string SQL injection."""
    exists = db.query(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    )
    return bool(exists)


@route("GET", "/api/db-explorer/tables")
def list_tables(params):
    rows = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    result = []
    for r in rows:
        # NOTE: Identifier (table name) can't be parameterized — comes from sqlite_master, not user input
        count = db.query(f"SELECT COUNT(*) as cnt FROM [{r['name']}]")
        result.append({"name": r["name"], "row_count": count[0]["cnt"]})
    return result


@route("GET", "/api/db-explorer/table/{name}")
def get_table_data(params):
    table = params["name"]
    page = int(params.get("page", 1))
    per_page = min(int(params.get("per_page", 50)), 500)  # Cap at 500
    offset = (page - 1) * per_page

    if not _validate_table_name(table):
        raise HttpError(f"Table not found", 404)

    # NOTE: Identifier (table) can't be parameterized — validated against sqlite_master above; values use ? placeholders
    rows = db.query(f"SELECT * FROM [{table}] LIMIT ? OFFSET ?", (per_page, offset))
    total = db.query(f"SELECT COUNT(*) as cnt FROM [{table}]")
    return {"rows": rows, "total": total[0]["cnt"], "page": page, "per_page": per_page}


@route("GET", "/api/db-explorer/table/{name}/schema")
def get_table_schema(params):
    table = params["name"]
    if not _validate_table_name(table):
        raise HttpError(f"Table not found", 404)
    # Safe: table validated against sqlite_master above
    rows = db.query(f"PRAGMA table_info([{table}])")
    return [{"name": r["name"], "type": r["type"], "notnull": r["notnull"], "pk": r["pk"]} for r in rows]


@route("POST", "/api/db-explorer/query")
def execute_query(params):
    """Read-only SQL console. Only SELECT and PRAGMA allowed.

    SQLite's cursor.execute() prevents stacked queries (semicolons).
    Python's sqlite3 disables load_extension() by default.
    """
    sql = params.get("sql", "").strip()
    if not sql:
        raise HttpError("sql is required", 400)
    normalized = sql.upper().lstrip()
    if not normalized.startswith("SELECT") and not normalized.startswith("PRAGMA"):
        raise HttpError("Only SELECT and PRAGMA queries allowed", 400)
    rows = db.query(sql)
    return {"rows": rows, "count": len(rows)}


@route("GET", "/api/db-explorer/sync-status")
def get_sync_status(params):
    rows = db.query("SELECT * FROM sync_metadata")  # actual cpdb table name
    return rows
```

- [ ] **Step 4: Run tests**

Run: `cd dashboard/app/api && python -m pytest tests/test_routes_db_explorer.py -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/routes/db_explorer.py dashboard/app/api/tests/test_routes_db_explorer.py
git commit -m "feat: add Database Explorer API — browse SQLite tables + read-only queries"
```

---

### Task 23: Build Database Explorer React Page

**Files:**
- Create: `dashboard/app/src/pages/DatabaseExplorer.tsx`
- Modify: `dashboard/app/src/App.tsx` — add route
- Modify: `dashboard/app/src/components/Sidebar.tsx` — add nav link

- [ ] **Step 1: Create DatabaseExplorer.tsx**

Build a React page with:
- Table list sidebar with row counts
- Data grid with sorting and pagination
- Schema viewer (columns + types)
- Read-only SQL console
- Sync status banner

Use the same patterns as existing dashboard pages (useEffect for data fetch, loading states, error handling).

- [ ] **Step 2: Add route in App.tsx**

```tsx
<Route path="/db-explorer" element={<DatabaseExplorer />} />
```

- [ ] **Step 3: Add nav link in Sidebar**

Add "Database Explorer" link in the sidebar navigation.

- [ ] **Step 4: Build and test**

```bash
cd dashboard/app && npm run build
```
Open in browser, verify the page loads and shows tables.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/src/pages/DatabaseExplorer.tsx dashboard/app/src/App.tsx dashboard/app/src/components/Sidebar.tsx
git commit -m "feat: add Database Explorer page — browse SQLite from dashboard"
```

---

### Task 24: Scorched Earth — Purge All Fabric SQL References

**Files:**
- Modify: `dashboard/app/api/server.py` — remove `query_sql()`, `get_sql_connection()`, Fabric SQL imports
- Modify: `dashboard/app/api/config.json` — remove `sql` section
- Modify: `config/item_config.yaml` — remove SQL DB item ID
- Modify: `deploy_from_scratch.py` — remove Phases 6, 6.5, 10, 16
- Modify: `knowledge/` — purge SQL DB references
- Modify: `CLAUDE.md`, memory files — purge SQL references
- Delete: `dashboard/app/api/server.py.bak` (if created in Task 8)

- [ ] **Step 1: Run the grep sweep**

```bash
grep -r "SQL_INTEGRATION_FRAMEWORK\|query_sql\|get_sql_connection\|get_fabric_token.*database\|sp_Upsert\|sp_Audit\|sp_Insert\|sp_Build" --include="*.py" --include="*.md" --include="*.json" --include="*.yaml" -l
```

- [ ] **Step 2: Fix every file in the grep results**

For each file:
- `.py` files: Delete Fabric SQL imports, functions, variables, fallback branches
- `.json`/`.yaml` files: Delete SQL sections (including `config/item_config.yaml` SQL DB item ID)
- `.md` files: Remove or update SQL references
- `deploy_from_scratch.py`: Delete phases 6 (SQL DB creation), 6.5 (setup notebook/stored procs), 10 (SQL metadata population), 16 (entity digest SQL deployment). Add new phases for SQLite init, Parquet sync config, delta_ingest config. Renumber remaining phases.

- [ ] **Step 3: Remove Fabric SQL environment variables from server.py**

Delete: `SQL_SERVER`, `SQL_DATABASE`, `SQL_DRIVER` config reads.

- [ ] **Step 4: Re-run grep to verify zero hits**

```bash
grep -r "SQL_INTEGRATION_FRAMEWORK\|query_sql\|get_sql_connection\|get_fabric_token.*database" --include="*.py" --include="*.md" --include="*.json" --include="*.yaml"
```
Expected: Zero results.

- [ ] **Step 5: Run all tests**

```bash
cd dashboard/app/api && python -m pytest tests/ -v
cd engine && python -m pytest tests/ -v
```
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: scorched earth — purge all Fabric SQL references from codebase"
```

---

### Task 25: Final Validation + Deploy

- [ ] **Step 1: Run full test suite**

```bash
cd dashboard/app/api && python -m pytest tests/ -v
cd engine && python -m pytest tests/ -v
```

- [ ] **Step 2: Local smoke test**

Run `python dashboard/app/api/server.py` and verify:
- All 42 dashboard pages load correctly
- Data is consistent across pages
- Engine can start/stop runs
- Parquet files appear in OneLake dir after writes
- No Fabric SQL errors in logs

- [ ] **Step 3: Deploy to vsc-fabric**

```bash
git push origin main
# On vsc-fabric:
cd C:\Projects\FMD_FRAMEWORK && git pull origin main
python scripts/seed_sqlite_from_fabric.py  # if not already done
nssm restart FMD-Dashboard
```

- [ ] **Step 4: Validate on vsc-fabric**

Same smoke test as Step 2 but on `http://vsc-fabric/`.

- [ ] **Step 5: Start parallel operation period**

Keep Fabric SQL DB alive (read-only) for 1 week as rollback safety net.

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "milestone: server refactor complete — SQLite is single source of truth"
```

---

## Spec Discrepancy Corrections

The following corrections were identified during plan review and are incorporated above:

1. **`engine/connections.py`** — Only delete `MetadataDB` class (lines 24-115). `SourceConnection` (lines 117-167 inclusive, NOT 157) MUST survive — it's used by `engine/extractor.py`, `engine/orchestrator.py`, `engine/preflight.py` for on-prem SQL connections. See Task 13.

2. **`antigravity/fabric_notebook_runner.py`** — This file does NOT exist in the codebase. The spec reference is incorrect. No action needed.

3. **Phase 2/3 ordering** — `delta_ingest.py` (Phase 2) reads from OneLake, but notebooks won't write Delta until Phase 3. Bridge strategy: Task 16 seeds SQLite from existing Fabric SQL data. Until Phase 3 notebooks are deployed, execution data comes from the seed + engine's direct SQLite writes (via the migrated `logging_db.py`). After Phase 3, `delta_ingest.py` picks up notebook-written Delta tables.

4. **`db.py` vs `control_plane_db.py`** — `db.py` is a thin connection wrapper (`get_db()`, `query()`, `execute()`, `init_db()`). `control_plane_db.py` is the domain CRUD layer (`upsert_connection()`, `get_all_entities()`, etc.) that keeps its own internal `_get_conn()`. Both connect to the same WAL-mode SQLite file. See Task 2.

5. **Timeline** — The spec's 5-day estimate is aggressive. Realistic estimate is 8-10 working days given the 9,267-line monolith decomposition + notebook migration + pipeline JSON updates. The plan is structured so each phase produces a working, deployable system.

6. **SQLite table name mismatch** — The spec uses conceptual PascalCase names (`PipelineExecution`, `CopyActivityExecution`, `EntityStatusSummary`, `SyncStatus`). Actual `control_plane_db.py` table names are lowercase: `pipeline_audit`, `copy_activity_audit`, `entity_status`, `sync_metadata`. All code in this plan uses the ACTUAL table names.

7. **`deploy_from_scratch.py` path** — The spec doesn't specify a full path. The file lives at the project root (`deploy_from_scratch.py`), NOT in `scripts/`.

8. **`engine/preflight.py` and `engine/smoke_test.py`** — Both import `MetadataDB` but are not mentioned in the spec's scorched earth section. Added to Task 13 Step 4.

9. **Security fix #6 (hardcoded credentials)** — Already fixed in the frontend audit. Verified during Task 7 `routes/source_manager.py` extraction.
