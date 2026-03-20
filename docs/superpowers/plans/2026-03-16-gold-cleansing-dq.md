# Gold Layer, Cleansing Rules & DQ Scorecard — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gold layer management, cleansing rule editing, and a DQ scorecard to the FMD dashboard — completing the medallion architecture in the Engineering UI.

**Architecture:** Three new Python route modules (`gold.py`, `cleansing.py`, quality extensions) backed by new SQLite tables in `control_plane_db.py`. Three React pages replace existing stubs. Gold Model Manager gets a `@xyflow/react` relationship diagram; DQ Scorecard uses Recharts for trends. All follow existing patterns (route decorator, `_get_conn()`, `cn()` + Tailwind styling).

**Tech Stack:** Python/Flask (backend), SQLite WAL (DB), React 19 + TypeScript (frontend), `@xyflow/react` 12.x (diagrams), Recharts 3.x (charts), Tailwind 4.x (styling), lucide-react (icons)

**Spec:** `docs/superpowers/specs/2026-03-16-gold-layer-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `dashboard/app/api/routes/gold.py` | Gold domain/model/relationship CRUD + lakehouse sync |
| `dashboard/app/api/routes/cleansing.py` | Cleansing rule CRUD + preview + batch-copy |
| `dashboard/app/api/tests/test_routes_gold.py` | Tests for gold.py |
| `dashboard/app/api/tests/test_routes_cleansing.py` | Tests for cleansing.py |
| `dashboard/app/api/tests/test_routes_quality_ext.py` | Tests for quality.py extensions |
| `dashboard/app/src/pages/GoldModelManager.tsx` | Full Gold Model Manager page (replaces stub) |
| `dashboard/app/src/pages/CleansingRuleEditor.tsx` | Full Cleansing Rule Editor (replaces stub) |
| `dashboard/app/src/pages/DqScorecard.tsx` | Full DQ Scorecard (replaces stub) |
| `dashboard/app/src/components/gold/RelationshipDiagram.tsx` | @xyflow/react star schema diagram |
| `dashboard/app/src/components/gold/DomainCard.tsx` | Domain card for grid view |
| `dashboard/app/src/components/gold/ModelDetailPanel.tsx` | Slide-out model detail |
| `dashboard/app/src/components/cleansing/RuleCard.tsx` | Rule card in rule list |
| `dashboard/app/src/components/cleansing/RuleEditorForm.tsx` | Adaptive rule parameter form |
| `dashboard/app/src/components/quality/TierDistribution.tsx` | Recharts donut/bar for tiers |
| `dashboard/app/src/components/quality/ScoreTrend.tsx` | Recharts area chart for trends |
| `dashboard/app/src/hooks/useGoldDomains.ts` | Gold domain/model data hook |
| `dashboard/app/src/hooks/useCleansingRules.ts` | Cleansing rules data hook |
| `dashboard/app/src/hooks/useQualityScorecard.ts` | Scorecard data hook |

### Modified Files

| File | Change |
|------|--------|
| `dashboard/app/api/control_plane_db.py:408` | Add Gold, cleansing, quality_history tables + indexes after existing executescript block |
| `dashboard/app/api/services/quality_engine.py:257` | Extend `compute_quality_scores()` to write quality_history + compute trend_7d |
| `dashboard/app/api/routes/quality.py:214` | Add 3 new endpoints: scorecard, history, aggregate history |
| `dashboard/app/src/App.tsx:1-137` | Add routes for `/gold`, `/cleansing`, `/quality` + redirects from `/labs/*` |
| `dashboard/app/src/components/layout/AppLayout.tsx:75-146` | Create "Modeling" nav group, move Gold out of Quality group, update routes |

---

## Chunk 1: Schema + Backend Routes

### Task 1: Add Gold + Cleansing + Quality History Tables to Schema

**Files:**
- Modify: `dashboard/app/api/control_plane_db.py:408` (after the `""")` closing the executescript block)
- Test: `dashboard/app/api/tests/test_cpdb_schema.py` (extend existing)

- [ ] **Step 1: Write failing test — Gold tables exist after init_db()**

Add to `dashboard/app/api/tests/test_cpdb_schema.py`. Note: this file uses a relative import (`import control_plane_db as cpdb` via `sys.path.insert`) and an autouse `temp_db` fixture. New tests should use the already-imported `cpdb` module and rely on the existing fixture — do NOT re-import:

```python
# Uses existing `temp_db` autouse fixture (sets cpdb.DB_PATH + calls init_db())

def test_gold_tables_exist():
    """Gold layer tables created by init_db()."""
    conn = cpdb._get_conn()
    try:
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        assert "gold_domains" in tables
        assert "gold_models" in tables
        assert "gold_model_columns" in tables
        assert "gold_relationships" in tables
        assert "cleansing_rules" in tables
        assert "quality_history" in tables
    finally:
        conn.close()


def test_quality_scores_has_trend_columns():
    """quality_scores table has trend_7d and dimension_details columns."""
    conn = cpdb._get_conn()
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(quality_scores)").fetchall()}
        assert "trend_7d" in cols
        assert "dimension_details" in cols
    finally:
        conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest dashboard/app/api/tests/test_cpdb_schema.py::test_gold_tables_exist dashboard/app/api/tests/test_cpdb_schema.py::test_quality_scores_has_trend_columns -v`
Expected: FAIL — tables don't exist yet

- [ ] **Step 3: Add Gold + Cleansing + Quality tables to init_db()**

In `dashboard/app/api/control_plane_db.py`, find the line `conn.commit()` at ~line 409 (immediately after the `""")` closing the executescript block). Add a NEW executescript block BEFORE `conn.commit()`:

```python
        # ── Gold layer + Cleansing + Quality History ──────────────────────
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS gold_domains (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT NOT NULL UNIQUE,
                description     TEXT,
                workspace_id    TEXT,
                lakehouse_name  TEXT,
                lakehouse_id    TEXT,
                owner           TEXT,
                status          TEXT DEFAULT 'active' CHECK(status IN ('active','draft','deprecated')),
                created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS gold_models (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                domain_id           INTEGER NOT NULL REFERENCES gold_domains(id),
                model_name          TEXT NOT NULL,
                model_type          TEXT CHECK(model_type IN ('fact','dimension','bridge','aggregate')),
                business_name       TEXT,
                description         TEXT,
                source_sql          TEXT,
                silver_dependencies TEXT,
                column_count        INTEGER DEFAULT 0,
                row_count_approx    INTEGER DEFAULT 0,
                last_refreshed      TEXT,
                status              TEXT DEFAULT 'draft' CHECK(status IN ('active','draft','deprecated')),
                created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                updated_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                UNIQUE(domain_id, model_name)
            );

            CREATE TABLE IF NOT EXISTS gold_model_columns (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                model_id        INTEGER NOT NULL REFERENCES gold_models(id),
                column_name     TEXT NOT NULL,
                data_type       TEXT,
                business_name   TEXT,
                description     TEXT,
                is_key          INTEGER DEFAULT 0,
                is_nullable     INTEGER DEFAULT 1,
                source_column   TEXT,
                created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                UNIQUE(model_id, column_name)
            );

            CREATE TABLE IF NOT EXISTS gold_relationships (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                domain_id           INTEGER NOT NULL REFERENCES gold_domains(id),
                from_model_id       INTEGER NOT NULL REFERENCES gold_models(id),
                from_column         TEXT NOT NULL,
                to_model_id         INTEGER NOT NULL REFERENCES gold_models(id),
                to_column           TEXT NOT NULL,
                relationship_type   TEXT CHECK(relationship_type IN ('one-to-many','many-to-one','one-to-one','many-to-many')),
                created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS cleansing_rules (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id       INTEGER NOT NULL,
                column_name     TEXT NOT NULL,
                rule_type       TEXT NOT NULL CHECK(rule_type IN (
                    'normalize_text','fill_nulls','parse_datetime','trim',
                    'replace','regex','cast_type','map_values','clamp_range','deduplicate'
                )),
                parameters      TEXT DEFAULT '{}',
                priority        INTEGER DEFAULT 0,
                is_active       INTEGER DEFAULT 1,
                created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS quality_history (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id           INTEGER NOT NULL,
                composite_score     REAL,
                completeness_score  REAL,
                freshness_score     REAL,
                consistency_score   REAL,
                volume_score        REAL,
                quality_tier        TEXT,
                recorded_at         TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            -- Gold layer indexes
            CREATE INDEX IF NOT EXISTS idx_gold_models_domain ON gold_models(domain_id);
            CREATE INDEX IF NOT EXISTS idx_gold_model_columns_model ON gold_model_columns(model_id);
            CREATE INDEX IF NOT EXISTS idx_gold_relationships_domain ON gold_relationships(domain_id);
            CREATE INDEX IF NOT EXISTS idx_gold_relationships_from ON gold_relationships(from_model_id);
            CREATE INDEX IF NOT EXISTS idx_gold_relationships_to ON gold_relationships(to_model_id);

            -- Cleansing indexes
            CREATE INDEX IF NOT EXISTS idx_cleansing_rules_entity ON cleansing_rules(entity_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_cleansing_rules_dedup ON cleansing_rules(entity_id, column_name, rule_type);

            -- Quality history indexes
            CREATE INDEX IF NOT EXISTS idx_quality_history_entity_date ON quality_history(entity_id, recorded_at);
            CREATE INDEX IF NOT EXISTS idx_quality_history_recorded ON quality_history(recorded_at);
        """)
```

Also add `trend_7d` and `dimension_details` to the existing `quality_scores` CREATE TABLE block (~line 378). Change it from:

```sql
CREATE TABLE IF NOT EXISTS quality_scores (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id           INTEGER NOT NULL UNIQUE,
    completeness_score  REAL,
    freshness_score     REAL,
    consistency_score   REAL,
    volume_score        REAL,
    composite_score     REAL,
    quality_tier        TEXT,
    computed_at         TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

To:

```sql
CREATE TABLE IF NOT EXISTS quality_scores (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id           INTEGER NOT NULL UNIQUE,
    completeness_score  REAL,
    freshness_score     REAL,
    consistency_score   REAL,
    volume_score        REAL,
    composite_score     REAL,
    quality_tier        TEXT,
    trend_7d            REAL DEFAULT 0.0,
    dimension_details   TEXT DEFAULT '{}',
    computed_at         TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

For existing databases that already have the table without these columns, add an idempotent migration in the `-- Migrations (idempotent) --` section (~line 411):

```python
        # Add trend_7d and dimension_details to quality_scores if missing
        qs_cols = {r[1] for r in conn.execute("PRAGMA table_info(quality_scores)").fetchall()}
        if "trend_7d" not in qs_cols:
            conn.execute("ALTER TABLE quality_scores ADD COLUMN trend_7d REAL DEFAULT 0.0")
            conn.execute("ALTER TABLE quality_scores ADD COLUMN dimension_details TEXT DEFAULT '{}'")
            conn.commit()
            log.info("Migration: added trend_7d and dimension_details to quality_scores")
```

- [ ] **Step 4: Update get_stats() and existing schema test assertions**

In `dashboard/app/api/control_plane_db.py`, find `get_stats()` (~line 1171). Add the 6 new tables to the `tables` list:

```python
    tables = [
        'connections', 'datasources', 'lakehouses', 'workspaces', 'pipelines',
        'lz_entities', 'bronze_entities', 'silver_entities',
        'engine_runs', 'engine_task_log',
        'pipeline_lz_entity', 'pipeline_bronze_entity',
        'entity_status', 'watermarks',
        'pipeline_audit', 'copy_activity_audit',
        'sync_metadata', 'admin_config',
        'notebook_executions', 'import_jobs', 'server_labels',
        'gold_domains', 'gold_models', 'gold_model_columns',
        'gold_relationships', 'cleansing_rules', 'quality_history',
    ]
```

In `dashboard/app/api/tests/test_cpdb_schema.py`, update the two hardcoded count assertions:
- `test_tables_created`: Change "at least 21 tables" → "at least 27 tables" (line ~119-124)
- `test_get_stats_total_count`: Change "Expected 21 table counts" → "Expected 27 table counts" (line ~397-401)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest dashboard/app/api/tests/test_cpdb_schema.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/api/control_plane_db.py dashboard/app/api/tests/test_cpdb_schema.py
git commit -m "feat(schema): add Gold layer, cleansing rules, quality history tables"
```

---

### Task 2: Gold Layer API Routes

**Files:**
- Create: `dashboard/app/api/routes/gold.py`
- Test: `dashboard/app/api/tests/test_routes_gold.py`

- [ ] **Step 1: Write failing tests for Gold domain CRUD**

Create `dashboard/app/api/tests/test_routes_gold.py`:

```python
"""Tests for Gold layer API routes."""
import json
import sys
import importlib
import pytest

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture(autouse=True)
def setup(tmp_path):
    """Isolate each test with a fresh temp DB."""
    _routes.clear()
    cpdb.DB_PATH = tmp_path / "test.db"
    cpdb.init_db()

    mod_name = "dashboard.app.api.routes.gold"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


# ── Domain CRUD ──────────────────────────────────────────────────────────────

def test_list_domains_empty():
    status, _, body = dispatch("GET", "/api/gold/domains", {}, None)
    assert status == 200
    data = json.loads(body)
    assert isinstance(data, list)
    assert len(data) == 0


def test_create_domain():
    payload = {"name": "Sales Analytics", "description": "Orders and shipments"}
    status, _, body = dispatch("POST", "/api/gold/domains", payload, None)
    assert status == 200
    data = json.loads(body)
    assert data["name"] == "Sales Analytics"
    assert data["id"] >= 1


def test_create_domain_duplicate_fails():
    dispatch("POST", "/api/gold/domains", {"name": "Sales"}, None)
    status, _, body = dispatch("POST", "/api/gold/domains", {"name": "Sales"}, None)
    assert status == 409


def test_get_domain_detail():
    _, _, body = dispatch("POST", "/api/gold/domains", {"name": "Prod"}, None)
    domain_id = json.loads(body)["id"]
    status, _, body = dispatch("GET", f"/api/gold/domains/{domain_id}", {}, None)
    assert status == 200
    data = json.loads(body)
    assert data["name"] == "Prod"
    assert "models" in data


def test_update_domain():
    _, _, body = dispatch("POST", "/api/gold/domains", {"name": "Old"}, None)
    domain_id = json.loads(body)["id"]
    status, _, body = dispatch("PUT", f"/api/gold/domains/{domain_id}",
                               {"description": "Updated"}, None)
    assert status == 200
    assert json.loads(body)["description"] == "Updated"


def test_delete_domain_soft_deletes():
    _, _, body = dispatch("POST", "/api/gold/domains", {"name": "Del"}, None)
    domain_id = json.loads(body)["id"]
    status, _, _ = dispatch("DELETE", f"/api/gold/domains/{domain_id}", {}, None)
    assert status == 200
    # Verify soft-delete: status = deprecated
    _, _, body = dispatch("GET", f"/api/gold/domains/{domain_id}", {}, None)
    assert json.loads(body)["status"] == "deprecated"


# ── Model CRUD ───────────────────────────────────────────────────────────────

def test_create_model():
    _, _, body = dispatch("POST", "/api/gold/domains", {"name": "Sales"}, None)
    did = json.loads(body)["id"]
    payload = {"domain_id": did, "model_name": "FactOrderLines",
               "model_type": "fact", "business_name": "Order Lines"}
    status, _, body = dispatch("POST", "/api/gold/models", payload, None)
    assert status == 200
    data = json.loads(body)
    assert data["model_name"] == "FactOrderLines"


def test_list_models_by_domain():
    _, _, body = dispatch("POST", "/api/gold/domains", {"name": "Sales"}, None)
    did = json.loads(body)["id"]
    dispatch("POST", "/api/gold/models",
             {"domain_id": did, "model_name": "Fact1", "model_type": "fact"}, None)
    dispatch("POST", "/api/gold/models",
             {"domain_id": did, "model_name": "Dim1", "model_type": "dimension"}, None)
    status, _, body = dispatch("GET", "/api/gold/models", {"domain_id": str(did)}, None)
    assert status == 200
    assert len(json.loads(body)) == 2


def test_get_model_detail():
    _, _, body = dispatch("POST", "/api/gold/domains", {"name": "S"}, None)
    did = json.loads(body)["id"]
    _, _, body = dispatch("POST", "/api/gold/models",
                          {"domain_id": did, "model_name": "F1", "model_type": "fact"}, None)
    mid = json.loads(body)["id"]
    status, _, body = dispatch("GET", f"/api/gold/models/{mid}", {}, None)
    assert status == 200
    data = json.loads(body)
    assert data["model_name"] == "F1"
    assert "columns" in data


# ── Relationships ────────────────────────────────────────────────────────────

def test_create_and_list_relationship():
    _, _, body = dispatch("POST", "/api/gold/domains", {"name": "S"}, None)
    did = json.loads(body)["id"]
    _, _, b1 = dispatch("POST", "/api/gold/models",
                        {"domain_id": did, "model_name": "Fact", "model_type": "fact"}, None)
    _, _, b2 = dispatch("POST", "/api/gold/models",
                        {"domain_id": did, "model_name": "Dim", "model_type": "dimension"}, None)
    fid, tid = json.loads(b1)["id"], json.loads(b2)["id"]
    payload = {"domain_id": did, "from_model_id": fid, "from_column": "customer_id",
               "to_model_id": tid, "to_column": "id", "relationship_type": "many-to-one"}
    status, _, body = dispatch("POST", "/api/gold/relationships", payload, None)
    assert status == 200

    status, _, body = dispatch("GET", f"/api/gold/relationships?domain_id={did}", {}, None)
    assert status == 200
    assert len(json.loads(body)) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest dashboard/app/api/tests/test_routes_gold.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement gold.py**

Create `dashboard/app/api/routes/gold.py`:

```python
"""Gold layer API routes — domain, model, column, and relationship management.

Endpoints:
    GET    /api/gold/domains            — list all domains with model counts
    POST   /api/gold/domains            — create a domain
    GET    /api/gold/domains/:id        — domain detail with models
    PUT    /api/gold/domains/:id        — update domain metadata
    DELETE /api/gold/domains/:id        — soft-delete (status → deprecated)
    GET    /api/gold/models             — list models (filterable by domain_id)
    POST   /api/gold/models             — register a model
    GET    /api/gold/models/:id         — model detail with columns
    PUT    /api/gold/models/:id         — update model metadata
    DELETE /api/gold/models/:id         — deprecate model
    GET    /api/gold/relationships      — relationships for a domain
    POST   /api/gold/relationships      — define a relationship
    DELETE /api/gold/relationships/:id  — remove a relationship
    POST   /api/gold/domains/:id/sync   — discover tables from Gold lakehouse
"""
import json
import logging

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.gold")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now():
    """ISO 8601 UTC timestamp."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _require_int(params: dict, key: str) -> int:
    try:
        return int(params.get(key, ""))
    except (TypeError, ValueError):
        raise HttpError(f"{key} must be an integer", 400)


# ── Domain CRUD ──────────────────────────────────────────────────────────────

@route("GET", "/api/gold/domains")
def list_domains(params: dict) -> list:
    conn = cpdb._get_conn()
    try:
        rows = conn.execute("""
            SELECT d.*,
                   COUNT(m.id)          AS model_count,
                   MAX(m.last_refreshed) AS last_refreshed
            FROM gold_domains d
            LEFT JOIN gold_models m ON m.domain_id = d.id AND m.status != 'deprecated'
            WHERE d.status != 'deprecated'
            GROUP BY d.id
            ORDER BY d.name
        """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@route("POST", "/api/gold/domains")
def create_domain(params: dict) -> dict:
    name = (params.get("name") or "").strip()
    if not name:
        raise HttpError("name is required", 400)

    conn = cpdb._get_conn()
    try:
        try:
            cur = conn.execute("""
                INSERT INTO gold_domains (name, description, workspace_id, lakehouse_name,
                                          lakehouse_id, owner, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (name,
                  params.get("description"),
                  params.get("workspace_id"),
                  params.get("lakehouse_name"),
                  params.get("lakehouse_id"),
                  params.get("owner"),
                  params.get("status", "active")))
            conn.commit()
        except Exception as e:
            if "UNIQUE" in str(e):
                raise HttpError(f"Domain '{name}' already exists", 409)
            raise

        row = conn.execute("SELECT * FROM gold_domains WHERE id = ?",
                           (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@route("GET", "/api/gold/domains/{id}")
def get_domain(params: dict) -> dict:
    domain_id = _require_int(params, "id")
    conn = cpdb._get_conn()
    try:
        domain = conn.execute("SELECT * FROM gold_domains WHERE id = ?",
                              (domain_id,)).fetchone()
        if not domain:
            raise HttpError("Domain not found", 404)

        models = conn.execute("""
            SELECT id, model_name, model_type, business_name, description,
                   column_count, row_count_approx, last_refreshed, status
            FROM gold_models WHERE domain_id = ? AND status != 'deprecated'
            ORDER BY model_type, model_name
        """, (domain_id,)).fetchall()

        result = dict(domain)
        result["models"] = [dict(m) for m in models]
        return result
    finally:
        conn.close()


@route("PUT", "/api/gold/domains/{id}")
def update_domain(params: dict) -> dict:
    domain_id = _require_int(params, "id")
    conn = cpdb._get_conn()
    try:
        existing = conn.execute("SELECT * FROM gold_domains WHERE id = ?",
                                (domain_id,)).fetchone()
        if not existing:
            raise HttpError("Domain not found", 404)

        conn.execute("""
            UPDATE gold_domains SET
                name = ?, description = ?, workspace_id = ?, lakehouse_name = ?,
                lakehouse_id = ?, owner = ?, status = ?, updated_at = ?
            WHERE id = ?
        """, (
            params.get("name", existing["name"]),
            params.get("description", existing["description"]),
            params.get("workspace_id", existing["workspace_id"]),
            params.get("lakehouse_name", existing["lakehouse_name"]),
            params.get("lakehouse_id", existing["lakehouse_id"]),
            params.get("owner", existing["owner"]),
            params.get("status", existing["status"]),
            _now(),
            domain_id,
        ))
        conn.commit()
        row = conn.execute("SELECT * FROM gold_domains WHERE id = ?",
                           (domain_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@route("DELETE", "/api/gold/domains/{id}")
def delete_domain(params: dict) -> dict:
    domain_id = _require_int(params, "id")
    conn = cpdb._get_conn()
    try:
        if not conn.execute("SELECT 1 FROM gold_domains WHERE id = ?", (domain_id,)).fetchone():
            raise HttpError("Domain not found", 404)
        conn.execute("UPDATE gold_domains SET status = 'deprecated', updated_at = ? WHERE id = ?",
                     (_now(), domain_id))
        conn.commit()
        return {"status": "deprecated", "id": domain_id}
    finally:
        conn.close()


# ── Model CRUD ───────────────────────────────────────────────────────────────

@route("GET", "/api/gold/models")
def list_models(params: dict) -> list:
    conn = cpdb._get_conn()
    try:
        sql = """SELECT * FROM gold_models WHERE status != 'deprecated'"""
        bind = []
        domain_id = params.get("domain_id")
        if domain_id:
            sql += " AND domain_id = ?"
            bind.append(int(domain_id))
        sql += " ORDER BY model_type, model_name"
        rows = conn.execute(sql, bind).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@route("POST", "/api/gold/models")
def create_model(params: dict) -> dict:
    domain_id = _require_int(params, "domain_id")
    model_name = (params.get("model_name") or "").strip()
    if not model_name:
        raise HttpError("model_name is required", 400)

    conn = cpdb._get_conn()
    try:
        # Verify domain exists
        if not conn.execute("SELECT 1 FROM gold_domains WHERE id = ?", (domain_id,)).fetchone():
            raise HttpError("Domain not found", 404)

        columns_data = params.get("columns", [])
        silver_deps = params.get("silver_dependencies")
        if isinstance(silver_deps, list):
            silver_deps = json.dumps(silver_deps)

        try:
            cur = conn.execute("""
                INSERT INTO gold_models (domain_id, model_name, model_type, business_name,
                                         description, source_sql, silver_dependencies,
                                         column_count, row_count_approx, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (domain_id, model_name,
                  params.get("model_type"),
                  params.get("business_name"),
                  params.get("description"),
                  params.get("source_sql"),
                  silver_deps,
                  len(columns_data) if columns_data else int(params.get("column_count", 0)),
                  int(params.get("row_count_approx", 0)),
                  params.get("status", "draft")))
        except Exception as e:
            if "UNIQUE" in str(e):
                raise HttpError(f"Model '{model_name}' already exists in this domain", 409)
            raise

        model_id = cur.lastrowid

        # Insert columns if provided
        for col in columns_data:
            conn.execute("""
                INSERT OR IGNORE INTO gold_model_columns
                    (model_id, column_name, data_type, business_name, description,
                     is_key, is_nullable, source_column)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (model_id, col.get("column_name"), col.get("data_type"),
                  col.get("business_name"), col.get("description"),
                  int(col.get("is_key", 0)), int(col.get("is_nullable", 1)),
                  col.get("source_column")))

        conn.commit()
        row = conn.execute("SELECT * FROM gold_models WHERE id = ?",
                           (model_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@route("GET", "/api/gold/models/{id}")
def get_model(params: dict) -> dict:
    model_id = _require_int(params, "id")
    conn = cpdb._get_conn()
    try:
        model = conn.execute("SELECT * FROM gold_models WHERE id = ?",
                             (model_id,)).fetchone()
        if not model:
            raise HttpError("Model not found", 404)

        columns = conn.execute("""
            SELECT * FROM gold_model_columns WHERE model_id = ?
            ORDER BY is_key DESC, column_name
        """, (model_id,)).fetchall()

        rels = conn.execute("""
            SELECT * FROM gold_relationships
            WHERE from_model_id = ? OR to_model_id = ?
        """, (model_id, model_id)).fetchall()

        result = dict(model)
        result["columns"] = [dict(c) for c in columns]
        result["relationships"] = [dict(r) for r in rels]
        return result
    finally:
        conn.close()


@route("PUT", "/api/gold/models/{id}")
def update_model(params: dict) -> dict:
    model_id = _require_int(params, "id")
    conn = cpdb._get_conn()
    try:
        existing = conn.execute("SELECT * FROM gold_models WHERE id = ?",
                                (model_id,)).fetchone()
        if not existing:
            raise HttpError("Model not found", 404)

        silver_deps = params.get("silver_dependencies", existing["silver_dependencies"])
        if isinstance(silver_deps, list):
            silver_deps = json.dumps(silver_deps)

        conn.execute("""
            UPDATE gold_models SET
                model_name = ?, model_type = ?, business_name = ?, description = ?,
                source_sql = ?, silver_dependencies = ?, column_count = ?,
                row_count_approx = ?, status = ?, updated_at = ?
            WHERE id = ?
        """, (
            params.get("model_name", existing["model_name"]),
            params.get("model_type", existing["model_type"]),
            params.get("business_name", existing["business_name"]),
            params.get("description", existing["description"]),
            params.get("source_sql", existing["source_sql"]),
            silver_deps,
            int(params.get("column_count", existing["column_count"])),
            int(params.get("row_count_approx", existing["row_count_approx"])),
            params.get("status", existing["status"]),
            _now(),
            model_id,
        ))
        conn.commit()
        row = conn.execute("SELECT * FROM gold_models WHERE id = ?",
                           (model_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@route("DELETE", "/api/gold/models/{id}")
def delete_model(params: dict) -> dict:
    model_id = _require_int(params, "id")
    conn = cpdb._get_conn()
    try:
        if not conn.execute("SELECT 1 FROM gold_models WHERE id = ?", (model_id,)).fetchone():
            raise HttpError("Model not found", 404)
        conn.execute("UPDATE gold_models SET status = 'deprecated', updated_at = ? WHERE id = ?",
                     (_now(), model_id))
        conn.commit()
        return {"status": "deprecated", "id": model_id}
    finally:
        conn.close()


# ── Relationships ────────────────────────────────────────────────────────────

@route("GET", "/api/gold/relationships")
def list_relationships(params: dict) -> list:
    conn = cpdb._get_conn()
    try:
        sql = "SELECT * FROM gold_relationships"
        bind = []
        domain_id = params.get("domain_id")
        if domain_id:
            sql += " WHERE domain_id = ?"
            bind.append(int(domain_id))
        rows = conn.execute(sql, bind).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@route("POST", "/api/gold/relationships")
def create_relationship(params: dict) -> dict:
    domain_id = _require_int(params, "domain_id")
    from_model_id = _require_int(params, "from_model_id")
    to_model_id = _require_int(params, "to_model_id")
    from_column = (params.get("from_column") or "").strip()
    to_column = (params.get("to_column") or "").strip()
    if not from_column or not to_column:
        raise HttpError("from_column and to_column are required", 400)

    conn = cpdb._get_conn()
    try:
        cur = conn.execute("""
            INSERT INTO gold_relationships
                (domain_id, from_model_id, from_column, to_model_id, to_column, relationship_type)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (domain_id, from_model_id, from_column, to_model_id, to_column,
              params.get("relationship_type")))
        conn.commit()
        row = conn.execute("SELECT * FROM gold_relationships WHERE id = ?",
                           (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@route("DELETE", "/api/gold/relationships/{id}")
def delete_relationship(params: dict) -> dict:
    rel_id = _require_int(params, "id")
    conn = cpdb._get_conn()
    try:
        conn.execute("DELETE FROM gold_relationships WHERE id = ?", (rel_id,))
        conn.commit()
        return {"deleted": True, "id": rel_id}
    finally:
        conn.close()


# ── Sync ─────────────────────────────────────────────────────────────────────

@route("POST", "/api/gold/domains/{id}/sync")
def sync_domain(params: dict) -> dict:
    """Discover tables from Gold lakehouse via SQL Analytics Endpoint.

    Requires Fabric SQL Analytics Endpoint access (VPN + SP token).
    Falls back to manual registration if unavailable.
    """
    domain_id = _require_int(params, "id")
    conn = cpdb._get_conn()
    try:
        domain = conn.execute("SELECT * FROM gold_domains WHERE id = ?",
                              (domain_id,)).fetchone()
        if not domain:
            raise HttpError("Domain not found", 404)

        ws_id = domain["workspace_id"]
        lh_id = domain["lakehouse_id"]
        if not ws_id or not lh_id:
            raise HttpError("Domain has no workspace_id or lakehouse_id configured — "
                            "set these first via PUT /api/gold/domains/:id", 400)

        # Attempt Fabric SQL Analytics Endpoint query
        # This is a placeholder — full Fabric integration requires pyodbc + SP token
        # For now, return 503 with guidance
        raise HttpError(
            "Lakehouse sync requires Fabric SQL Analytics Endpoint access. "
            "Use manual model registration via POST /api/gold/models as a fallback.",
            503
        )
    finally:
        conn.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest dashboard/app/api/tests/test_routes_gold.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/routes/gold.py dashboard/app/api/tests/test_routes_gold.py
git commit -m "feat(gold): add Gold layer domain/model/relationship API routes with tests"
```

---

### Task 3: Cleansing Rules API Routes

**Files:**
- Create: `dashboard/app/api/routes/cleansing.py`
- Test: `dashboard/app/api/tests/test_routes_cleansing.py`

- [ ] **Step 1: Write failing tests**

Create `dashboard/app/api/tests/test_routes_cleansing.py`:

```python
"""Tests for Cleansing Rules API routes."""
import json
import sys
import importlib
import pytest

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture(autouse=True)
def setup(tmp_path):
    _routes.clear()
    cpdb.DB_PATH = tmp_path / "test.db"
    cpdb.init_db()

    # Seed a test entity (needed for cleansing rules)
    conn = cpdb._get_conn()
    conn.execute("""
        INSERT INTO datasources (DataSourceId, Name, Namespace, Type, IsActive)
        VALUES (1, 'test_db', 'TestSource', 'SQL', 1)
    """)
    conn.execute("""
        INSERT INTO lz_entities (LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, IsActive)
        VALUES (100, 1, 'dbo', 'TestTable', 1)
    """)
    conn.execute("""
        INSERT INTO lz_entities (LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, IsActive)
        VALUES (101, 1, 'dbo', 'TestTable2', 1)
    """)
    conn.commit()
    conn.close()

    mod_name = "dashboard.app.api.routes.cleansing"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


def test_list_rules_empty():
    status, _, body = dispatch("GET", "/api/cleansing/rules", {"entity_id": "100"}, None)
    assert status == 200
    assert json.loads(body) == []


def test_create_rule():
    payload = {
        "entity_id": 100,
        "column_name": "MMITDS",
        "rule_type": "normalize_text",
        "parameters": json.dumps({"case": "title"}),
    }
    status, _, body = dispatch("POST", "/api/cleansing/rules", payload, None)
    assert status == 200
    data = json.loads(body)
    assert data["rule_type"] == "normalize_text"
    assert data["entity_id"] == 100


def test_create_duplicate_rule_fails():
    payload = {
        "entity_id": 100, "column_name": "COL1",
        "rule_type": "trim", "parameters": "{}",
    }
    dispatch("POST", "/api/cleansing/rules", payload, None)
    status, _, _ = dispatch("POST", "/api/cleansing/rules", payload, None)
    assert status == 409


def test_update_rule():
    payload = {
        "entity_id": 100, "column_name": "COL1",
        "rule_type": "trim", "parameters": "{}",
    }
    _, _, body = dispatch("POST", "/api/cleansing/rules", payload, None)
    rule_id = json.loads(body)["id"]
    status, _, body = dispatch("PUT", f"/api/cleansing/rules/{rule_id}",
                               {"is_active": 0}, None)
    assert status == 200
    assert json.loads(body)["is_active"] == 0


def test_delete_rule():
    payload = {
        "entity_id": 100, "column_name": "COL1",
        "rule_type": "fill_nulls", "parameters": "{}",
    }
    _, _, body = dispatch("POST", "/api/cleansing/rules", payload, None)
    rule_id = json.loads(body)["id"]
    status, _, _ = dispatch("DELETE", f"/api/cleansing/rules/{rule_id}", {}, None)
    assert status == 200


def test_list_functions():
    status, _, body = dispatch("GET", "/api/cleansing/functions", {}, None)
    assert status == 200
    funcs = json.loads(body)
    names = [f["name"] for f in funcs]
    assert "normalize_text" in names
    assert "trim" in names
    assert len(funcs) == 10


def test_batch_copy_dry_run():
    # Create a rule on entity 100
    dispatch("POST", "/api/cleansing/rules", {
        "entity_id": 100, "column_name": "COL1",
        "rule_type": "trim", "parameters": "{}",
    }, None)
    # Dry run batch copy to same source
    status, _, body = dispatch(
        "POST", "/api/cleansing/rules/batch-copy",
        {"dry_run": "true", "source_entity_id": 100}, None)
    assert status == 200
    data = json.loads(body)
    assert "affected_count" in data
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest dashboard/app/api/tests/test_routes_cleansing.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement cleansing.py**

Create `dashboard/app/api/routes/cleansing.py`:

```python
"""Cleansing rules API routes — CRUD, functions catalog, preview, and batch-copy.

Endpoints:
    GET    /api/cleansing/rules          — rules for an entity (entity_id required)
    POST   /api/cleansing/rules          — create a rule
    PUT    /api/cleansing/rules/:id      — update a rule
    DELETE /api/cleansing/rules/:id      — delete a rule
    GET    /api/cleansing/functions       — available rule types + parameter schemas
    POST   /api/cleansing/rules/preview  — dry-run before/after on sample data
    POST   /api/cleansing/rules/batch-copy — copy rules to all entities in same source
"""
import json
import logging

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.cleansing")


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _require_int(params: dict, key: str) -> int:
    try:
        return int(params.get(key, ""))
    except (TypeError, ValueError):
        raise HttpError(f"{key} must be an integer", 400)


# ── Rule type catalog ────────────────────────────────────────────────────────

RULE_TYPES = [
    {"name": "normalize_text", "description": "Standardize text casing",
     "parameters": {"case": {"type": "enum", "values": ["lower", "upper", "title"], "required": True}},
     "scope": "column"},
    {"name": "fill_nulls", "description": "Replace NULL values with a default",
     "parameters": {"default": {"type": "any", "required": True}},
     "scope": "column"},
    {"name": "parse_datetime", "description": "Parse date strings into ISO format",
     "parameters": {"format": {"type": "string", "required": True, "example": "YYYYMMDD"}},
     "scope": "column"},
    {"name": "trim", "description": "Strip leading/trailing whitespace",
     "parameters": {},
     "scope": "column"},
    {"name": "replace", "description": "Replace exact string matches",
     "parameters": {"old": {"type": "string", "required": True},
                    "new": {"type": "string", "required": True}},
     "scope": "column"},
    {"name": "regex", "description": "Regex pattern substitution",
     "parameters": {"pattern": {"type": "string", "required": True},
                    "replacement": {"type": "string", "required": True}},
     "scope": "column"},
    {"name": "cast_type", "description": "Cast column to a different data type",
     "parameters": {"target_type": {"type": "enum", "values": ["int", "float", "string", "date"],
                                     "required": True}},
     "scope": "column"},
    {"name": "map_values", "description": "Remap discrete values",
     "parameters": {"mapping": {"type": "object", "required": True,
                                "example": {"old_val": "new_val"}}},
     "scope": "column"},
    {"name": "clamp_range", "description": "Clamp numeric values to a range",
     "parameters": {"min": {"type": "number", "required": False},
                    "max": {"type": "number", "required": False}},
     "scope": "column"},
    {"name": "deduplicate", "description": "Remove duplicate rows by key columns",
     "parameters": {"key_columns": {"type": "array", "items": "string", "required": True}},
     "scope": "entity"},
]


# ── CRUD ─────────────────────────────────────────────────────────────────────

@route("GET", "/api/cleansing/rules")
def list_rules(params: dict) -> list:
    entity_id = params.get("entity_id")
    if not entity_id:
        raise HttpError("entity_id query parameter is required", 400)

    conn = cpdb._get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM cleansing_rules WHERE entity_id = ? ORDER BY priority, id",
            (int(entity_id),)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@route("POST", "/api/cleansing/rules")
def create_rule(params: dict) -> dict:
    entity_id = _require_int(params, "entity_id")
    column_name = (params.get("column_name") or "").strip()
    rule_type = (params.get("rule_type") or "").strip()

    if not column_name or not rule_type:
        raise HttpError("column_name and rule_type are required", 400)

    valid_types = {rt["name"] for rt in RULE_TYPES}
    if rule_type not in valid_types:
        raise HttpError(f"Invalid rule_type. Must be one of: {', '.join(sorted(valid_types))}", 400)

    parameters = params.get("parameters", "{}")
    if isinstance(parameters, dict):
        parameters = json.dumps(parameters)

    conn = cpdb._get_conn()
    try:
        try:
            cur = conn.execute("""
                INSERT INTO cleansing_rules (entity_id, column_name, rule_type, parameters,
                                             priority, is_active)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (entity_id, column_name, rule_type, parameters,
                  int(params.get("priority", 0)),
                  int(params.get("is_active", 1))))
            conn.commit()
        except Exception as e:
            if "UNIQUE" in str(e):
                raise HttpError(f"Rule '{rule_type}' for column '{column_name}' already exists on this entity", 409)
            raise

        row = conn.execute("SELECT * FROM cleansing_rules WHERE id = ?",
                           (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@route("PUT", "/api/cleansing/rules/{id}")
def update_rule(params: dict) -> dict:
    rule_id = _require_int(params, "id")
    conn = cpdb._get_conn()
    try:
        existing = conn.execute("SELECT * FROM cleansing_rules WHERE id = ?",
                                (rule_id,)).fetchone()
        if not existing:
            raise HttpError("Rule not found", 404)

        parameters = params.get("parameters", existing["parameters"])
        if isinstance(parameters, dict):
            parameters = json.dumps(parameters)

        conn.execute("""
            UPDATE cleansing_rules SET
                column_name = ?, rule_type = ?, parameters = ?,
                priority = ?, is_active = ?, updated_at = ?
            WHERE id = ?
        """, (
            params.get("column_name", existing["column_name"]),
            params.get("rule_type", existing["rule_type"]),
            parameters,
            int(params.get("priority", existing["priority"])),
            int(params.get("is_active", existing["is_active"])),
            _now(),
            rule_id,
        ))
        conn.commit()
        row = conn.execute("SELECT * FROM cleansing_rules WHERE id = ?",
                           (rule_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@route("DELETE", "/api/cleansing/rules/{id}")
def delete_rule(params: dict) -> dict:
    rule_id = _require_int(params, "id")
    conn = cpdb._get_conn()
    try:
        conn.execute("DELETE FROM cleansing_rules WHERE id = ?", (rule_id,))
        conn.commit()
        return {"deleted": True, "id": rule_id}
    finally:
        conn.close()


# ── Functions catalog ────────────────────────────────────────────────────────

@route("GET", "/api/cleansing/functions")
def list_functions(params: dict) -> list:
    return RULE_TYPES


# ── Preview ──────────────────────────────────────────────────────────────────

@route("POST", "/api/cleansing/rules/preview")
def preview_rule(params: dict) -> dict:
    """Dry-run a rule against sample data from the source database.

    Requires VPN access to the source database. Returns 503 if unreachable.
    """
    entity_id = _require_int(params, "entity_id")
    column_name = (params.get("column_name") or "").strip()
    rule_type = (params.get("rule_type") or "").strip()

    if not column_name or not rule_type:
        raise HttpError("column_name and rule_type are required", 400)

    # For now, return a placeholder — full preview requires ODBC source access
    raise HttpError(
        "Preview requires source database access (VPN). "
        "This endpoint will be wired once data_access.py column profile integration is complete.",
        503
    )


# ── Batch copy ───────────────────────────────────────────────────────────────

@route("POST", "/api/cleansing/rules/batch-copy")
def batch_copy_rules(params: dict) -> dict:
    """Copy rules from one entity to all entities in the same source.

    Query params:
        dry_run — if 'true', return affected_count without writing

    Body:
        source_entity_id — entity to copy rules FROM
    """
    source_entity_id = _require_int(params, "source_entity_id")
    dry_run = (params.get("dry_run") or "").lower() == "true"

    conn = cpdb._get_conn()
    try:
        # Find the DataSourceId for this entity
        src = conn.execute("""
            SELECT DataSourceId FROM lz_entities WHERE LandingzoneEntityId = ?
        """, (source_entity_id,)).fetchone()
        if not src:
            raise HttpError("Source entity not found", 404)

        ds_id = src["DataSourceId"]

        # Get target entities in the same source (excluding the source itself)
        targets = conn.execute("""
            SELECT LandingzoneEntityId FROM lz_entities
            WHERE DataSourceId = ? AND LandingzoneEntityId != ? AND IsActive = 1
        """, (ds_id, source_entity_id)).fetchall()
        target_ids = [int(r["LandingzoneEntityId"]) for r in targets]

        if dry_run:
            return {"affected_count": len(target_ids), "source_entity_id": source_entity_id}

        # Get rules to copy
        rules = conn.execute(
            "SELECT * FROM cleansing_rules WHERE entity_id = ? ORDER BY priority",
            (source_entity_id,)
        ).fetchall()

        copied = 0
        for tid in target_ids:
            for rule in rules:
                try:
                    cur = conn.execute("""
                        INSERT OR IGNORE INTO cleansing_rules
                            (entity_id, column_name, rule_type, parameters, priority, is_active)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (tid, rule["column_name"], rule["rule_type"],
                          rule["parameters"], rule["priority"], rule["is_active"]))
                    if cur.rowcount > 0:
                        copied += 1
                except Exception as e:
                    logging.warning(f"Non-critical error copying rule: {e}")

        conn.commit()
        return {"copied": copied, "target_entities": len(target_ids),
                "source_entity_id": source_entity_id}
    finally:
        conn.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest dashboard/app/api/tests/test_routes_cleansing.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/routes/cleansing.py dashboard/app/api/tests/test_routes_cleansing.py
git commit -m "feat(cleansing): add cleansing rules CRUD, functions catalog, and batch-copy API"
```

---

### Task 4: Quality API Extensions + History Engine

**Files:**
- Modify: `dashboard/app/api/routes/quality.py:214`
- Modify: `dashboard/app/api/services/quality_engine.py:257`
- Test: `dashboard/app/api/tests/test_routes_quality_ext.py`

- [ ] **Step 1: Write failing tests**

Create `dashboard/app/api/tests/test_routes_quality_ext.py`:

```python
"""Tests for Quality API extensions — scorecard, history, aggregate."""
import json
import sys
import importlib
import pytest

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import dispatch, _routes


@pytest.fixture(autouse=True)
def setup(tmp_path):
    _routes.clear()
    cpdb.DB_PATH = tmp_path / "test.db"
    cpdb.init_db()

    # Seed test data
    conn = cpdb._get_conn()
    conn.execute("""
        INSERT INTO datasources (DataSourceId, Name, Namespace, Type, IsActive)
        VALUES (1, 'test_db', 'TestSource', 'SQL', 1)
    """)
    conn.execute("""
        INSERT INTO lz_entities (LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, IsActive)
        VALUES (100, 1, 'dbo', 'Table1', 1)
    """)
    conn.execute("""
        INSERT INTO quality_scores (entity_id, completeness_score, freshness_score,
                                     consistency_score, volume_score, composite_score,
                                     quality_tier, trend_7d)
        VALUES (100, 90.0, 85.0, 80.0, 75.0, 84.0, 'gold', -2.5)
    """)
    conn.execute("""
        INSERT INTO quality_history (entity_id, composite_score, completeness_score,
                                      freshness_score, consistency_score, volume_score,
                                      quality_tier, recorded_at)
        VALUES (100, 86.5, 90.0, 87.0, 82.0, 78.0, 'gold', '2026-03-10T00:00:00Z')
    """)
    conn.commit()
    conn.close()

    mod_name = "dashboard.app.api.routes.quality"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


def test_scorecard():
    status, _, body = dispatch("GET", "/api/quality/scorecard", {}, None)
    assert status == 200
    data = json.loads(body)
    assert "average_composite" in data
    assert "tier_distribution" in data
    assert "worst_performers" in data
    assert "biggest_drops" in data


def test_history_for_entity():
    status, _, body = dispatch("GET", "/api/quality/history", {"entity_id": "100", "days": "30"}, None)
    assert status == 200
    data = json.loads(body)
    assert isinstance(data, list)
    assert len(data) >= 1


def test_history_aggregate():
    status, _, body = dispatch("GET", "/api/quality/history/aggregate", {"days": "30"}, None)
    assert status == 200
    data = json.loads(body)
    assert isinstance(data, list)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest dashboard/app/api/tests/test_routes_quality_ext.py -v`
Expected: FAIL — endpoints not registered

- [ ] **Step 3: Add quality history recording to compute_quality_scores()**

In `dashboard/app/api/services/quality_engine.py`, add the following AFTER the `conn.commit()` at line 257 (inside the `try` block, before `finally`):

```python
        # ── Write quality_history for trend tracking ─────────────────────────
        for eid in entity_ids:
            try:
                qs = conn.execute(
                    "SELECT * FROM quality_scores WHERE entity_id = ?", (eid,)
                ).fetchone()
                if qs:
                    conn.execute("""
                        INSERT INTO quality_history
                            (entity_id, composite_score, completeness_score,
                             freshness_score, consistency_score, volume_score,
                             quality_tier, recorded_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (eid,
                          qs["composite_score"], qs["completeness_score"],
                          qs["freshness_score"], qs["consistency_score"],
                          qs["volume_score"], qs["quality_tier"], computed_at))
            except Exception as e:
                logging.warning(f"Non-critical error writing quality history: {e}")

        # Write dimension_details JSON for each scored entity
        for eid in entity_ids:
            try:
                qs = conn.execute(
                    "SELECT completeness_score, freshness_score, consistency_score, volume_score "
                    "FROM quality_scores WHERE entity_id = ?", (eid,)
                ).fetchone()
                if qs:
                    import json as _json
                    details = _json.dumps({
                        "completeness": round(float(qs["completeness_score"] or 0), 2),
                        "freshness": round(float(qs["freshness_score"] or 0), 2),
                        "consistency": round(float(qs["consistency_score"] or 0), 2),
                        "volume": round(float(qs["volume_score"] or 0), 2),
                    })
                    conn.execute(
                        "UPDATE quality_scores SET dimension_details = ? WHERE entity_id = ?",
                        (details, eid))
            except Exception as e:
                logging.warning(f"Non-critical error writing dimension details: {e}")

        # Compute trend_7d for each entity
        seven_days_ago = (now_utc - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        for eid in entity_ids:
            try:
                old = conn.execute("""
                    SELECT composite_score FROM quality_history
                    WHERE entity_id = ? AND recorded_at <= ?
                    ORDER BY recorded_at DESC LIMIT 1
                """, (eid, seven_days_ago)).fetchone()
                if old:
                    current = conn.execute(
                        "SELECT composite_score FROM quality_scores WHERE entity_id = ?",
                        (eid,)).fetchone()
                    if current:
                        trend = round(float(current["composite_score"] or 0)
                                      - float(old["composite_score"] or 0), 2)
                        conn.execute(
                            "UPDATE quality_scores SET trend_7d = ? WHERE entity_id = ?",
                            (trend, eid))
            except Exception as e:
                logging.warning(f"Non-critical error computing 7-day trend: {e}")

        # Prune history older than 90 days
        cutoff = (now_utc - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute("DELETE FROM quality_history WHERE recorded_at < ?", (cutoff,))

        conn.commit()
```

Also add `from datetime import timedelta` to the imports at the top of `quality_engine.py` if not already present. The existing `from datetime import datetime, timezone` should become `from datetime import datetime, timedelta, timezone`.

- [ ] **Step 4: Add 3 new endpoints to quality.py**

Append to `dashboard/app/api/routes/quality.py` (after line 214):

```python
# ---------------------------------------------------------------------------
# GET /api/quality/scorecard
# ---------------------------------------------------------------------------

@route("GET", "/api/quality/scorecard")
def get_scorecard(params: dict) -> dict:
    """Aggregated scorecard with tier distribution, worst performers, biggest drops.

    Response:
        {
          average_composite, tier_distribution: {gold, silver, bronze, unclassified},
          total_entities, worst_performers: [...], biggest_drops: [...]
        }
    """
    conn = cpdb._get_conn()
    try:
        # Tier distribution
        agg = conn.execute("""
            SELECT
                COUNT(*)                AS total,
                AVG(composite_score)    AS avg_composite,
                SUM(CASE WHEN quality_tier='gold' THEN 1 ELSE 0 END)         AS n_gold,
                SUM(CASE WHEN quality_tier='silver' THEN 1 ELSE 0 END)       AS n_silver,
                SUM(CASE WHEN quality_tier='bronze' THEN 1 ELSE 0 END)       AS n_bronze,
                SUM(CASE WHEN quality_tier='unclassified' THEN 1 ELSE 0 END) AS n_unclassified
            FROM quality_scores
        """).fetchone()

        # Worst performers (bottom 20)
        worst = conn.execute("""
            SELECT qs.entity_id, e.SourceName AS entity_name, ds.Namespace AS source_name,
                   qs.composite_score, qs.quality_tier, qs.trend_7d,
                   qs.completeness_score, qs.freshness_score,
                   qs.consistency_score, qs.volume_score
            FROM quality_scores qs
            JOIN lz_entities e  ON qs.entity_id = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            ORDER BY qs.composite_score ASC
            LIMIT 20
        """).fetchall()

        # Biggest drops (top 10 negative trend_7d) — join quality_history for previous_tier
        drops = conn.execute("""
            SELECT qs.entity_id, e.SourceName AS entity_name,
                   ds.Namespace AS source_name,
                   qs.composite_score, qs.quality_tier AS current_tier, qs.trend_7d,
                   (SELECT qh.quality_tier FROM quality_history qh
                    WHERE qh.entity_id = qs.entity_id
                      AND qh.recorded_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')
                    ORDER BY qh.recorded_at DESC LIMIT 1) AS previous_tier
            FROM quality_scores qs
            JOIN lz_entities e  ON qs.entity_id = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE qs.trend_7d < 0
            ORDER BY qs.trend_7d ASC
            LIMIT 10
        """).fetchall()

        return {
            "average_composite": round(float(agg["avg_composite"] or 0), 2),
            "tier_distribution": {
                "gold": int(agg["n_gold"] or 0),
                "silver": int(agg["n_silver"] or 0),
                "bronze": int(agg["n_bronze"] or 0),
                "unclassified": int(agg["n_unclassified"] or 0),
            },
            "total_entities": int(agg["total"] or 0),
            "worst_performers": [
                {
                    "entity_id": int(r["entity_id"]),
                    "entity_name": r["entity_name"] or "",
                    "source_name": r["source_name"] or "",
                    "composite_score": round(float(r["composite_score"] or 0), 2),
                    "quality_tier": r["quality_tier"] or "unclassified",
                    "trend_7d": round(float(r["trend_7d"] or 0), 2),
                    "dimensions": {
                        "completeness": round(float(r["completeness_score"] or 0), 2),
                        "freshness": round(float(r["freshness_score"] or 0), 2),
                        "consistency": round(float(r["consistency_score"] or 0), 2),
                        "volume": round(float(r["volume_score"] or 0), 2),
                    }
                }
                for r in worst
            ],
            "biggest_drops": [
                {
                    "entity_id": int(r["entity_id"]),
                    "entity_name": r["entity_name"] or "",
                    "source_name": r["source_name"] or "",
                    "composite_score": round(float(r["composite_score"] or 0), 2),
                    "trend_7d": round(float(r["trend_7d"] or 0), 2),
                    "previous_tier": r["previous_tier"] or "unclassified",
                    "current_tier": r["current_tier"] or "unclassified",
                }
                for r in drops
            ],
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GET /api/quality/history
# ---------------------------------------------------------------------------

@route("GET", "/api/quality/history")
def get_quality_history(params: dict) -> list:
    """Score trend for a single entity.

    Query params:
        entity_id — required
        days — lookback window (default 30)
    """
    entity_id = params.get("entity_id")
    if not entity_id:
        raise HttpError("entity_id is required", 400)

    try:
        days = int(params.get("days", 30))
    except (TypeError, ValueError):
        days = 30

    conn = cpdb._get_conn()
    try:
        rows = conn.execute("""
            SELECT * FROM quality_history
            WHERE entity_id = ?
              AND recorded_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)
            ORDER BY recorded_at ASC
        """, (int(entity_id), f"-{days} days")).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# GET /api/quality/history/aggregate
# ---------------------------------------------------------------------------

@route("GET", "/api/quality/history/aggregate")
def get_quality_history_aggregate(params: dict) -> list:
    """System-wide average composite score trend.

    Query params:
        days — lookback window (default 30)
    """
    try:
        days = int(params.get("days", 30))
    except (TypeError, ValueError):
        days = 30

    conn = cpdb._get_conn()
    try:
        rows = conn.execute("""
            SELECT DATE(recorded_at) AS date,
                   AVG(composite_score) AS avg_composite,
                   COUNT(*) AS entity_count
            FROM quality_history
            WHERE recorded_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)
            GROUP BY DATE(recorded_at)
            ORDER BY date ASC
        """, (f"-{days} days",)).fetchall()
        return [
            {
                "date": r["date"],
                "avg_composite": round(float(r["avg_composite"] or 0), 2),
                "entity_count": int(r["entity_count"]),
            }
            for r in rows
        ]
    finally:
        conn.close()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest dashboard/app/api/tests/test_routes_quality_ext.py -v`
Expected: ALL PASS

- [ ] **Step 6: Run ALL backend tests to check for regressions**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest dashboard/app/api/tests/ -v --tb=short`
Expected: ALL PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add dashboard/app/api/routes/quality.py dashboard/app/api/services/quality_engine.py dashboard/app/api/tests/test_routes_quality_ext.py
git commit -m "feat(quality): add scorecard, history, aggregate endpoints + trend engine"
```

---

## Chunk 2: Frontend — Data Hooks + Pages

### Task 5: Data Hooks

**Files:**
- Create: `dashboard/app/src/hooks/useGoldDomains.ts`
- Create: `dashboard/app/src/hooks/useCleansingRules.ts`
- Create: `dashboard/app/src/hooks/useQualityScorecard.ts`

- [ ] **Step 1: Create useGoldDomains hook**

Create `dashboard/app/src/hooks/useGoldDomains.ts`:

```typescript
/**
 * Hook for Gold layer domain and model data.
 * Follows the useEntityDigest pattern — module-level cache, inflight dedup, 30s TTL.
 */
import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "";
const TTL_MS = 30_000;

// ── Types ─────────────────────────────────────────────────────────────────

export interface GoldDomain {
  id: number;
  name: string;
  description: string | null;
  workspace_id: string | null;
  lakehouse_name: string | null;
  lakehouse_id: string | null;
  owner: string | null;
  status: string;
  model_count: number;
  last_refreshed: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoldModel {
  id: number;
  domain_id: number;
  model_name: string;
  model_type: string | null;
  business_name: string | null;
  description: string | null;
  source_sql: string | null;
  silver_dependencies: string | null;
  column_count: number;
  row_count_approx: number;
  last_refreshed: string | null;
  status: string;
}

export interface GoldModelColumn {
  id: number;
  model_id: number;
  column_name: string;
  data_type: string | null;
  business_name: string | null;
  description: string | null;
  is_key: number;
  is_nullable: number;
  source_column: string | null;
}

export interface GoldRelationship {
  id: number;
  domain_id: number;
  from_model_id: number;
  from_column: string;
  to_model_id: number;
  to_column: string;
  relationship_type: string | null;
}

export interface GoldDomainDetail extends GoldDomain {
  models: GoldModel[];
}

export interface GoldModelDetail extends GoldModel {
  columns: GoldModelColumn[];
  relationships: GoldRelationship[];
}

// ── Cache ─────────────────────────────────────────────────────────────────

let _domainsCache: { data: GoldDomain[]; fetchedAt: number } | null = null;
let _domainsInflight: Promise<GoldDomain[]> | null = null;

export function invalidateGoldCache() {
  _domainsCache = null;
}

// ── Fetch functions ───────────────────────────────────────────────────────

async function fetchDomains(): Promise<GoldDomain[]> {
  if (_domainsCache && Date.now() - _domainsCache.fetchedAt < TTL_MS) {
    return _domainsCache.data;
  }
  if (_domainsInflight) return _domainsInflight;

  _domainsInflight = (async () => {
    try {
      const resp = await fetch(`${API}/api/gold/domains`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      _domainsCache = { data, fetchedAt: Date.now() };
      return data;
    } finally {
      _domainsInflight = null;
    }
  })();
  return _domainsInflight;
}

export async function fetchDomainDetail(id: number): Promise<GoldDomainDetail> {
  const resp = await fetch(`${API}/api/gold/domains/${id}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchModelDetail(id: number): Promise<GoldModelDetail> {
  const resp = await fetch(`${API}/api/gold/models/${id}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchRelationships(domainId: number): Promise<GoldRelationship[]> {
  const resp = await fetch(`${API}/api/gold/relationships?domain_id=${domainId}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ── Mutation helpers ──────────────────────────────────────────────────────

export async function createDomain(data: Partial<GoldDomain>): Promise<GoldDomain> {
  const resp = await fetch(`${API}/api/gold/domains`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  invalidateGoldCache();
  return resp.json();
}

export async function createModel(data: Partial<GoldModel> & { columns?: Partial<GoldModelColumn>[] }): Promise<GoldModel> {
  const resp = await fetch(`${API}/api/gold/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  invalidateGoldCache();
  return resp.json();
}

export async function createRelationship(data: Partial<GoldRelationship>): Promise<GoldRelationship> {
  const resp = await fetch(`${API}/api/gold/relationships`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useGoldDomains() {
  const [domains, setDomains] = useState<GoldDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDomains();
      if (mountedRef.current) setDomains(data);
    } catch (e: unknown) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const refresh = useCallback(() => {
    invalidateGoldCache();
    load();
  }, [load]);

  return { domains, loading, error, refresh };
}
```

- [ ] **Step 2: Create useCleansingRules hook**

Create `dashboard/app/src/hooks/useCleansingRules.ts`:

```typescript
/**
 * Hook for cleansing rules data.
 */
import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "";

export interface CleansingRule {
  id: number;
  entity_id: number;
  column_name: string;
  rule_type: string;
  parameters: string;
  priority: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface RuleTypeInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  scope: "column" | "entity";
}

// ── Fetch functions ───────────────────────────────────────────────────────

export async function fetchRules(entityId: number): Promise<CleansingRule[]> {
  const resp = await fetch(`${API}/api/cleansing/rules?entity_id=${entityId}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

let _ruleTypesCache: RuleTypeInfo[] | null = null;

export async function fetchRuleTypes(): Promise<RuleTypeInfo[]> {
  if (_ruleTypesCache) return _ruleTypesCache;
  const resp = await fetch(`${API}/api/cleansing/functions`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  _ruleTypesCache = await resp.json();
  return _ruleTypesCache!;
}

export async function createRule(data: Partial<CleansingRule>): Promise<CleansingRule> {
  const resp = await fetch(`${API}/api/cleansing/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

export async function updateRule(id: number, data: Partial<CleansingRule>): Promise<CleansingRule> {
  const resp = await fetch(`${API}/api/cleansing/rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function deleteRule(id: number): Promise<void> {
  const resp = await fetch(`${API}/api/cleansing/rules/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

export async function previewRule(data: {
  entity_id: number;
  column_name: string;
  rule_type: string;
  parameters: Record<string, unknown>;
}): Promise<{ before: string[]; after: string[] }> {
  const resp = await fetch(`${API}/api/cleansing/rules/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function batchCopyRules(sourceEntityId: number, dryRun: boolean = false): Promise<{ affected_count?: number; copied?: number }> {
  const qs = dryRun ? "?dry_run=true" : "";
  const resp = await fetch(`${API}/api/cleansing/rules/batch-copy${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_entity_id: sourceEntityId }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useCleansingRules(entityId: number | null) {
  const [rules, setRules] = useState<CleansingRule[]>([]);
  const [ruleTypes, setRuleTypes] = useState<RuleTypeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    setError(null);
    try {
      const [rulesData, typesData] = await Promise.all([
        fetchRules(entityId),
        fetchRuleTypes(),
      ]);
      if (mountedRef.current) {
        setRules(rulesData);
        setRuleTypes(typesData);
      }
    } catch (e: unknown) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  return { rules, ruleTypes, loading, error, refresh: load };
}
```

- [ ] **Step 3: Create useQualityScorecard hook**

Create `dashboard/app/src/hooks/useQualityScorecard.ts`:

```typescript
/**
 * Hook for DQ Scorecard data.
 */
import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "";
const TTL_MS = 30_000;

export interface ScorecardData {
  average_composite: number;
  tier_distribution: {
    gold: number;
    silver: number;
    bronze: number;
    unclassified: number;
  };
  total_entities: number;
  worst_performers: {
    entity_id: number;
    entity_name: string;
    source_name: string;
    composite_score: number;
    quality_tier: string;
    trend_7d: number;
    dimensions: {
      completeness: number;
      freshness: number;
      consistency: number;
      volume: number;
    };
  }[];
  biggest_drops: {
    entity_id: number;
    entity_name: string;
    source_name: string;
    composite_score: number;
    trend_7d: number;
    previous_tier: string;
    current_tier: string;
  }[];
}

export interface HistoryPoint {
  date: string;
  avg_composite: number;
  entity_count: number;
}

let _scorecardCache: { data: ScorecardData; fetchedAt: number } | null = null;
let _scorecardInflight: Promise<ScorecardData> | null = null;

export function invalidateScorecardCache() {
  _scorecardCache = null;
}

async function fetchScorecard(): Promise<ScorecardData> {
  if (_scorecardCache && Date.now() - _scorecardCache.fetchedAt < TTL_MS) {
    return _scorecardCache.data;
  }
  if (_scorecardInflight) return _scorecardInflight;

  _scorecardInflight = (async () => {
    try {
      const resp = await fetch(`${API}/api/quality/scorecard`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      _scorecardCache = { data, fetchedAt: Date.now() };
      return data;
    } finally {
      _scorecardInflight = null;
    }
  })();
  return _scorecardInflight;
}

export async function fetchHistoryAggregate(days: number = 30): Promise<HistoryPoint[]> {
  const resp = await fetch(`${API}/api/quality/history/aggregate?days=${days}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchEntityHistory(entityId: number, days: number = 30): Promise<unknown[]> {
  const resp = await fetch(`${API}/api/quality/history?entity_id=${entityId}&days=${days}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export function useQualityScorecard() {
  const [scorecard, setScorecard] = useState<ScorecardData | null>(null);
  const [trend, setTrend] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sc, tr] = await Promise.all([
        fetchScorecard(),
        fetchHistoryAggregate(30),
      ]);
      if (mountedRef.current) {
        setScorecard(sc);
        setTrend(tr);
      }
    } catch (e: unknown) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const refresh = useCallback(() => {
    invalidateScorecardCache();
    load();
  }, [load]);

  return { scorecard, trend, loading, error, refresh };
}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/src/hooks/useGoldDomains.ts dashboard/app/src/hooks/useCleansingRules.ts dashboard/app/src/hooks/useQualityScorecard.ts
git commit -m "feat(hooks): add data hooks for Gold domains, cleansing rules, and quality scorecard"
```

---

### Task 6: Gold Model Manager Page + Components

**Files:**
- Create: `dashboard/app/src/components/gold/DomainCard.tsx`
- Create: `dashboard/app/src/components/gold/RelationshipDiagram.tsx`
- Create: `dashboard/app/src/components/gold/ModelDetailPanel.tsx`
- Replace: `dashboard/app/src/pages/GoldModelManager.tsx`

> **IMPORTANT:** Use the `interface-design` skill for this task. The skill must guide visual decisions — domain exploration, signature element, depth strategy, typography — before writing any JSX. Follow the existing Claude Design System (OKLCH tokens, DM Sans, IBM Plex Mono, warm cream palette) from `dashboard/app/src/index.css`.

- [ ] **Step 1: Invoke interface-design skill**

Before writing any component code, invoke the `interface-design` skill. Provide context:
- This is a Gold layer model management page in a data engineering dashboard
- Design system: Claude Design System (OKLCH, DM Sans/IBM Plex Mono, warm cream/terracotta)
- Key components: domain card grid, @xyflow/react relationship diagram, model table, slide-out panel
- The page manages star schema metadata — domains contain fact/dimension/bridge tables with relationships

- [ ] **Step 2: Create DomainCard.tsx**

Create `dashboard/app/src/components/gold/DomainCard.tsx`. This is a card component for the domain grid view. It should show:
- Domain name (font-display, semibold)
- Description (text-muted, truncated)
- Model count with type breakdown ("4 facts, 7 dimensions")
- Workspace name (font-mono, 12px)
- Last synced timestamp
- Health indicator: green if all active, amber if any draft

Use `Card`, `CardHeader`, `CardContent` from `@/components/ui/card` and `cn` from `@/lib/utils`. Follow the KPICard pattern for styling consistency.

- [ ] **Step 3: Create RelationshipDiagram.tsx**

Create `dashboard/app/src/components/gold/RelationshipDiagram.tsx` using `@xyflow/react`. This renders the star schema diagram:
- Import: `ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState` from `@xyflow/react`
- Import: `@xyflow/react/dist/style.css`
- Props: `models: GoldModel[]`, `relationships: GoldRelationship[]`, `onNodeClick: (modelId: number) => void`
- Node layout: facts are wider nodes with copper left border, dimensions are standard nodes
- Edge labels show column names and cardinality
- Auto-layout: simple grid arrangement (facts center, dimensions around)
- Zoom, pan, fit-to-view controls included via `<Controls />`

- [ ] **Step 4: Create ModelDetailPanel.tsx**

Create `dashboard/app/src/components/gold/ModelDetailPanel.tsx`. Slide-out panel showing:
- Model name, business name, type badge, status badge
- Column table: column_name (mono), business_name, data_type, is_key badge, source_column
- Source SQL viewer (if populated): read-only `<pre>` with syntax highlighting colors
- Silver dependencies list as clickable links

- [ ] **Step 5: Replace GoldModelManager.tsx**

Replace the stub in `dashboard/app/src/pages/GoldModelManager.tsx` with the full page:
- Uses `useGoldDomains()` hook
- Default view: Domain card grid using `<DomainCard>`
- Click card → drill into domain detail (local state, not routing)
- Domain detail: header + `<RelationshipDiagram>` + models table
- Click model → `<ModelDetailPanel>` slides out
- "Add Domain" button → modal with name, description, workspace picker, lakehouse name
- "Register Model" button → modal with model fields + optional columns
- "Define Relationship" button → pick two models + columns + cardinality
- Loading state: skeleton cards
- Empty state: "No domains yet. Create your first Gold layer domain to get started."

- [ ] **Step 6: Delete old stub and commit**

Delete the old stub file that is being replaced:
```bash
git rm dashboard/app/src/pages/GoldMlvManager.tsx
```

Then commit:
```bash
git add dashboard/app/src/components/gold/ dashboard/app/src/pages/GoldModelManager.tsx
git commit -m "feat(gold): add Gold Model Manager page with domain cards, relationship diagram, and model detail"
```

---

### Task 7: Cleansing Rule Editor Page + Components

**Files:**
- Create: `dashboard/app/src/components/cleansing/RuleCard.tsx`
- Create: `dashboard/app/src/components/cleansing/RuleEditorForm.tsx`
- Replace: `dashboard/app/src/pages/CleansingRuleEditor.tsx`

> **IMPORTANT:** Use the `interface-design` skill for this task.

- [ ] **Step 1: Invoke interface-design skill**

Before writing component code, invoke the `interface-design` skill. Context:
- Cleansing rule editor for a data engineering dashboard
- Entity picker → two-panel layout (rule list left, editor right)
- 10 rule types with adaptive parameter forms
- Drag handles for reorder

- [ ] **Step 2: Create RuleCard.tsx**

Create `dashboard/app/src/components/cleansing/RuleCard.tsx`. Ordered card in the rule list:
- Column name (font-mono)
- Rule type badge (colored by type)
- Parameter summary (truncated)
- Active/inactive toggle
- Click to select → highlights and loads into editor

- [ ] **Step 3: Create RuleEditorForm.tsx**

Create `dashboard/app/src/components/cleansing/RuleEditorForm.tsx`. Adaptive form that changes based on rule_type:
- Step 1: Column picker (dropdown from entity columns via `column_metadata`)
- Step 2: Rule type picker (dropdown, shows description)
- Step 3: Parameter form — adapts based on rule_type:
  - `normalize_text` → case select (lower/upper/title)
  - `fill_nulls` → text input for default value
  - `replace` → two text inputs (old, new)
  - `regex` → two text inputs (pattern, replacement)
  - `cast_type` → type select (int/float/string/date)
  - `map_values` → key-value pair editor
  - `clamp_range` → two number inputs (min, max)
  - `deduplicate` → multi-select for key columns
  - `trim`, `parse_datetime` → minimal/no params
- JSON preview at bottom (read-only `<pre>`)
- "Save" button calls `createRule()` or `updateRule()` and refreshes list

- [ ] **Step 4: Replace CleansingRuleEditor.tsx**

Replace the stub in `dashboard/app/src/pages/CleansingRuleEditor.tsx`:
- Entity picker at top (searchable dropdown of Silver entities via `/api/entities?layer=silver`)
- Two-panel layout: left = rule list, right = editor form
- `useCleansingRules(selectedEntityId)` for data
- Rule list: `<RuleCard>` components, click to edit
- "Add Rule" button creates new rule in editor
- "Apply to all entities in source" button → confirmation dialog → `batchCopyRules()` (dry_run first for count)
- Empty state when no entity selected: "Select a Silver entity to manage its cleansing rules."
- Empty state when entity selected but no rules: "No cleansing rules defined. Add one to get started."

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/src/components/cleansing/ dashboard/app/src/pages/CleansingRuleEditor.tsx
git commit -m "feat(cleansing): add Cleansing Rule Editor with adaptive form and batch copy"
```

---

### Task 8: DQ Scorecard Page + Components

**Files:**
- Create: `dashboard/app/src/components/quality/TierDistribution.tsx`
- Create: `dashboard/app/src/components/quality/ScoreTrend.tsx`
- Replace: `dashboard/app/src/pages/DqScorecard.tsx`

> **IMPORTANT:** Use the `interface-design` skill for this task.

- [ ] **Step 1: Invoke interface-design skill**

Before writing component code, invoke the `interface-design` skill. Context:
- Quality scorecard dashboard for a data engineering tool
- KPI row with composite score + tier counts
- Two charts: tier distribution (donut/bar) and system trend (area chart)
- Two tables: worst performers, biggest drops
- Entity detail slide-out panel

- [ ] **Step 2: Create TierDistribution.tsx**

Create `dashboard/app/src/components/quality/TierDistribution.tsx` using Recharts:
- Import `PieChart, Pie, Cell, ResponsiveContainer, Tooltip` from `recharts`
- Props: `distribution: { gold: number, silver: number, bronze: number, unclassified: number }`
- Donut chart with 4 segments
- Colors: gold=#FFD700, silver=#C0C0C0, bronze=#CD7F32, unclassified=var(--muted-foreground)
- Center label: total count
- Tooltip shows count + percentage

- [ ] **Step 3: Create ScoreTrend.tsx**

Create `dashboard/app/src/components/quality/ScoreTrend.tsx` using Recharts:
- Import `AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip` from `recharts`
- Props: `data: HistoryPoint[]`
- Area fill with gradient — green above 80, amber 60-80, red below 60
- X-axis: dates, Y-axis: 0-100 score range
- Tooltip shows date, avg composite, entity count

- [ ] **Step 4: Replace DqScorecard.tsx**

Replace the stub in `dashboard/app/src/pages/DqScorecard.tsx`:
- Uses `useQualityScorecard()` hook
- KPI row: 6 KPI cards (use existing `<KPICard>` component from `@/components/KPICard`):
  - Average Composite Score (big number, trend arrow, color-coded)
  - Gold Tier Count (badge)
  - Silver Tier Count (badge)
  - Bronze Tier Count (badge)
  - Unclassified Count (badge)
  - Score Drops (alert count, red if > 0)
- Charts row: `<TierDistribution>` + `<ScoreTrend>` side by side
- Tables: "Worst Performers" (bottom 20) and "Biggest Drops" (top 10 negative trend)
  - Each row: entity name, source, composite score (colored bar), tier badge, trend arrow
  - Click row → entity detail slide-out
- Entity detail panel: 4-dimension bar chart, column null rates, cleansing rule count + link, sparkline
- "Refresh Scores" button → POST `/api/quality/refresh`

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/src/components/quality/ dashboard/app/src/pages/DqScorecard.tsx
git commit -m "feat(quality): add DQ Scorecard with tier distribution, trend chart, and entity detail"
```

---

## Chunk 3: Navigation, Integration & Cleanup

### Task 9: Update Navigation + Routes

**Files:**
- Modify: `dashboard/app/src/components/layout/AppLayout.tsx:75-146`
- Modify: `dashboard/app/src/App.tsx:1-137`

- [ ] **Step 1: Update AppLayout.tsx nav groups**

In `dashboard/app/src/components/layout/AppLayout.tsx`:

1. Add a new "Modeling" nav group BEFORE the "Quality" group (between "Insights" and "Quality"):

```typescript
{
  label: "Modeling",
  items: [
    { icon: Crown, label: "Gold Model Manager", href: "/gold" },
  ],
},
```

2. Update the "Quality" group — remove Gold MLV Manager, update routes for DQ Scorecard and Cleansing Rules:

```typescript
{
  label: "Quality",
  items: [
    { icon: FileCheck, label: "DQ Scorecard", href: "/quality" },
    { icon: Eraser, label: "Cleansing Rules", href: "/cleansing" },
    { icon: History, label: "SCD Audit", href: "/labs/scd-audit" },
  ],
},
```

3. Add the `Crown` icon import from `lucide-react` if not already imported.

- [ ] **Step 2: Update App.tsx routes**

In `dashboard/app/src/App.tsx`:

1. Update imports at top — the page files are the same names, just new routes:
```typescript
import GoldModelManager from '@/pages/GoldModelManager'
import CleansingRuleEditor from '@/pages/CleansingRuleEditor'
import DqScorecard from '@/pages/DqScorecard'
```

2. Replace the existing lab routes with new primary routes + redirects:
```tsx
{/* Graduated pages */}
<Route path="/gold" element={<GoldModelManager />} />
<Route path="/cleansing" element={<CleansingRuleEditor />} />
<Route path="/quality" element={<DqScorecard />} />

{/* Redirects from old lab routes */}
<Route path="/labs/gold-mlv" element={<Navigate to="/gold" replace />} />
<Route path="/labs/cleansing" element={<Navigate to="/cleansing" replace />} />
<Route path="/labs/dq-scorecard" element={<Navigate to="/quality" replace />} />

{/* KEEP existing /labs/scd-audit route as-is — it was NOT graduated */}
```

3. Add `Navigate` import from `react-router-dom` if not already imported.
4. Remove the old `import GoldMlvManager from '@/pages/GoldMlvManager'` line (file was deleted in Task 6).

- [ ] **Step 3: Verify build**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/src/components/layout/AppLayout.tsx dashboard/app/src/App.tsx
git commit -m "feat(nav): graduate Gold/Cleansing/DQ pages from Labs, add Modeling nav group"
```

---

### Task 10: Smoke Test + Final Verification

- [ ] **Step 1: Run all backend tests**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest dashboard/app/api/tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 2: Run frontend build**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Start dev server and smoke test**

Run: `cd c:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app && npm run dev`

Manual verification:
1. Navigate to `/gold` → Domain grid loads (empty state if no data)
2. Navigate to `/cleansing` → Entity picker renders
3. Navigate to `/quality` → KPI row + charts render
4. Navigate to `/labs/gold-mlv` → Redirects to `/gold`
5. Navigate to `/labs/cleansing` → Redirects to `/cleansing`
6. Navigate to `/labs/dq-scorecard` → Redirects to `/quality`
7. Sidebar shows "Modeling" group with Gold Model Manager
8. Sidebar shows "Quality" group with DQ Scorecard + Cleansing Rules (no Gold)

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add dashboard/app/src/ dashboard/app/api/
git commit -m "fix: smoke test fixes for Gold/Cleansing/DQ pages"
```
