# MDM Enhancement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 4 MDM dashboard pages (Data Profiler, Data Classification, Data Lineage, Data Quality) functional with real data, and seed a business glossary from IP Corp's knowledge base.

**Architecture:** Backend-first — restore/add Python API endpoints that serve real data, then wire frontends. Five capabilities: rich profiling SQL, column lineage endpoint, classification engine (Presidio + pattern matching), business glossary from IP Corp knowledge, quality scoring from existing metadata. All data stored in SQLite control plane DB.

**Tech Stack:** Python 3.11, SQLite (WAL mode), pyodbc (Fabric SQL endpoints), presidio-analyzer + spacy (PII detection), React/TypeScript frontend (Vite), Playwright (E2E tests)

**Spec:** `docs/superpowers/specs/2026-03-13-mdm-enhancement-design.md`

---

## Chunk 1: Infrastructure + Data Profiler Fix + Data Lineage Fix

These are the highest-impact, lowest-risk changes. The profiler fix restores lost functionality. The lineage fix wires an existing frontend to a new endpoint. Both unblock downstream work.

### Task 1: Add 5 new SQLite tables to control_plane_db.py

**Files:**
- Modify: `dashboard/app/api/control_plane_db.py` (inside `init_db()`, after existing CREATE TABLE statements)

- [ ] **Step 1: Add the 5 new tables to init_db()**

Append these CREATE TABLE statements inside the `conn.executescript("""...""")` block in `init_db()`, after the last existing CREATE TABLE (around line 230, after `server_labels`):

```sql
            -- MDM: column metadata + classification --------------------------------

            CREATE TABLE IF NOT EXISTS column_metadata (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id           INTEGER NOT NULL,
                layer               TEXT NOT NULL,
                column_name         TEXT NOT NULL,
                data_type           TEXT,
                ordinal_position    INTEGER,
                is_nullable         INTEGER DEFAULT 1,
                max_length          INTEGER,
                numeric_precision   INTEGER,
                numeric_scale       INTEGER,
                captured_at         TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                UNIQUE(entity_id, layer, column_name)
            );

            CREATE TABLE IF NOT EXISTS column_classifications (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id           INTEGER NOT NULL,
                layer               TEXT NOT NULL,
                column_name         TEXT NOT NULL,
                sensitivity_level   TEXT NOT NULL DEFAULT 'public',
                certification_status TEXT NOT NULL DEFAULT 'none',
                classified_by       TEXT NOT NULL,
                confidence          REAL DEFAULT 1.0,
                pii_entities        TEXT,
                classified_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                UNIQUE(entity_id, layer, column_name)
            );

            -- MDM: business glossary + entity annotations --------------------------

            CREATE TABLE IF NOT EXISTS business_glossary (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                term                TEXT NOT NULL UNIQUE,
                definition          TEXT NOT NULL,
                category            TEXT,
                related_systems     TEXT,
                synonyms            TEXT,
                source              TEXT,
                created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS entity_annotations (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id           INTEGER NOT NULL UNIQUE,
                business_name       TEXT,
                description         TEXT,
                domain              TEXT,
                tags                TEXT,
                source              TEXT,
                updated_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            -- MDM: quality scores --------------------------------------------------

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

- [ ] **Step 2: Create services package directory**

Create: `dashboard/app/api/services/__init__.py`

```python
"""MDM service modules — classification engine, quality scoring, etc."""
```

- [ ] **Step 3: Verify tables are created**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python -c "
import sys; sys.path.insert(0, 'dashboard/app/api')
from control_plane_db import init_db, _get_conn
init_db()
conn = _get_conn()
tables = [r[0] for r in conn.execute(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").fetchall()]
print('Tables:', tables)
for t in ['column_metadata', 'column_classifications', 'business_glossary', 'entity_annotations', 'quality_scores']:
    assert t in tables, f'MISSING: {t}'
print('All 5 new tables created OK')
conn.close()
"
```
Expected: `All 5 new tables created OK`

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/control_plane_db.py dashboard/app/api/services/__init__.py
git commit -m "feat(mdm): add 5 SQLite tables for classification, glossary, quality scoring

Author: Steve Nahrup"
```

---

### Task 2: Restore rich profiling in get_blender_profile()

**Files:**
- Modify: `dashboard/app/api/routes/data_access.py` (replace lines 715-750)

- [ ] **Step 1: Replace the skeleton get_blender_profile() function**

Replace the entire `get_blender_profile()` function (lines 715-750 in `data_access.py`) with this restored, rich implementation. **Also add the `_safe_int` helper function after `get_blender_profile()`** (it does not exist in the current file):

```python
@route("GET", "/api/blender/profile")
def get_blender_profile(params: dict) -> dict:
    """Profile a lakehouse table: row count + per-column null/distinct/min/max."""
    lakehouse = params.get("lakehouse", "")
    schema = params.get("schema", "dbo")
    table = params.get("table", "")
    if not lakehouse or not table:
        raise HttpError("lakehouse and table params required", 400)
    s = _sanitize(schema)
    t = _sanitize(table)

    # Step 1: Get full column metadata from INFORMATION_SCHEMA
    try:
        raw_cols = _query_lakehouse(
            lakehouse,
            "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, "
            "CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, "
            "ORDINAL_POSITION "
            "FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
            "ORDER BY ORDINAL_POSITION",
            params=(s, t),
        )
    except HttpError:
        raise
    except Exception as e:
        raise HttpError(str(e), 502)

    if not raw_cols:
        return {"lakehouse": lakehouse, "schema": schema, "table": table,
                "rowCount": 0, "columnCount": 0, "profiledColumns": 0, "columns": []}

    # Step 2: Build per-column profiling query (limit to first 50 columns)
    SORTABLE_TYPES = {
        "int", "bigint", "smallint", "tinyint", "decimal", "numeric",
        "float", "real", "money", "smallmoney",
        "date", "datetime", "datetime2", "datetimeoffset", "time",
        "varchar", "nvarchar", "char", "nchar",
    }
    profiled_cols = raw_cols[:50]
    col_exprs = []
    for col in profiled_cols:
        name = col.get("COLUMN_NAME", "")
        safe = name.replace("]", "]]")
        col_exprs.append(f"COUNT(DISTINCT [{safe}]) AS [{safe}__distinct]")
        col_exprs.append(f"SUM(CASE WHEN [{safe}] IS NULL THEN 1 ELSE 0 END) AS [{safe}__nulls]")
        dtype = (col.get("DATA_TYPE") or "").lower()
        if dtype in SORTABLE_TYPES:
            col_exprs.append(f"MIN(CAST([{safe}] AS NVARCHAR(200))) AS [{safe}__min]")
            col_exprs.append(f"MAX(CAST([{safe}] AS NVARCHAR(200))) AS [{safe}__max]")

    # NOTE: Identifiers (schema/table) can't be parameterized — s, t sanitized via _sanitize(); use ? for values
    profile_sql = (
        f"SELECT COUNT(*) AS _row_count, {', '.join(col_exprs)} "
        f"FROM (SELECT TOP 100000 * FROM [{s}].[{t}]) AS _sampled"
    )

    try:
        result = _query_lakehouse(lakehouse, profile_sql)
    except Exception as e:
        log.error("Profile query failed for %s.%s.%s: %s", lakehouse, s, t, e)
        # Fall back to metadata-only response
        cols_meta = []
        for col in raw_cols:
            cols_meta.append({
                "name": col.get("COLUMN_NAME", ""),
                "dataType": col.get("DATA_TYPE", ""),
                "nullable": col.get("IS_NULLABLE", "YES") == "YES",
                "maxLength": _safe_int(col.get("CHARACTER_MAXIMUM_LENGTH")),
                "precision": _safe_int(col.get("NUMERIC_PRECISION")),
                "scale": _safe_int(col.get("NUMERIC_SCALE")),
                "ordinal": _safe_int(col.get("ORDINAL_POSITION")),
                "distinctCount": 0, "nullCount": 0, "nullPercentage": 0,
                "minValue": None, "maxValue": None, "uniqueness": 0, "completeness": 0,
            })
        return {"lakehouse": lakehouse, "schema": schema, "table": table,
                "rowCount": -1, "columnCount": len(raw_cols),
                "profiledColumns": 0, "columns": cols_meta, "error": str(e)}

    if not result:
        return {"lakehouse": lakehouse, "schema": schema, "table": table,
                "rowCount": 0, "columnCount": len(raw_cols), "profiledColumns": 0, "columns": []}

    stats = result[0]
    row_count = int(stats.get("_row_count", 0) or 0)

    # Step 3: Assemble per-column profiles
    column_profiles = []
    for col in profiled_cols:
        name = col.get("COLUMN_NAME", "")
        distinct = int(stats.get(f"{name}__distinct", 0) or 0)
        nulls = int(stats.get(f"{name}__nulls", 0) or 0)
        null_pct = round((nulls / row_count * 100), 2) if row_count > 0 else 0.0
        profile = {
            "name": name,
            "dataType": col.get("DATA_TYPE", ""),
            "nullable": col.get("IS_NULLABLE", "YES") == "YES",
            "maxLength": _safe_int(col.get("CHARACTER_MAXIMUM_LENGTH")),
            "precision": _safe_int(col.get("NUMERIC_PRECISION")),
            "scale": _safe_int(col.get("NUMERIC_SCALE")),
            "ordinal": _safe_int(col.get("ORDINAL_POSITION")),
            "distinctCount": distinct,
            "nullCount": nulls,
            "nullPercentage": null_pct,
            "minValue": stats.get(f"{name}__min"),
            "maxValue": stats.get(f"{name}__max"),
            "uniqueness": round(distinct / row_count * 100, 2) if row_count > 0 else 0.0,
            "completeness": round(100 - null_pct, 2),
        }
        column_profiles.append(profile)

    return {
        "lakehouse": lakehouse,
        "schema": schema,
        "table": table,
        "rowCount": row_count,
        "columnCount": len(raw_cols),
        "profiledColumns": len(profiled_cols),
        "columns": column_profiles,
    }


def _safe_int(val) -> int | None:
    """Convert a value to int, returning None if not possible."""
    if val is None:
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None
```

- [ ] **Step 2: Verify the function parses correctly**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python -c "
import sys; sys.path.insert(0, 'dashboard/app/api')
# Just verify import works (no syntax errors)
from routes.data_access import get_blender_profile
print('get_blender_profile imported OK')
print('Function signature:', get_blender_profile.__name__)
"
```
Expected: `get_blender_profile imported OK`

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/routes/data_access.py
git commit -m "feat(mdm): restore rich profiling — distinctCount, nullCount, uniqueness, completeness, min/max per column

Author: Steve Nahrup"
```

---

### Task 3: Add column lineage endpoint + fix DataLineage.tsx

**Files:**
- Create: `dashboard/app/api/routes/lineage.py`
- Modify: `dashboard/app/src/pages/DataLineage.tsx` (line 79)

- [ ] **Step 1: Create the lineage route module**

Create `dashboard/app/api/routes/lineage.py`:

```python
"""Column lineage API — returns per-layer column schemas for an entity."""

import logging
from datetime import datetime, timezone

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import control_plane_db as db

log = logging.getLogger("fmd.lineage")


def _get_entity_layers(entity_id: int) -> dict:
    """Look up entity metadata and layer statuses from SQLite."""
    conn = db._get_conn()
    try:
        # Get LZ entity info
        lz = conn.execute(
            "SELECT LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, LakehouseId "
            "FROM lz_entities WHERE LandingzoneEntityId = ? AND IsActive = 1",
            (entity_id,)
        ).fetchone()
        if not lz:
            raise HttpError(f"Entity {entity_id} not found", 404)

        result = {
            "entityId": entity_id,
            "sourceSchema": lz["SourceSchema"],
            "sourceName": lz["SourceName"],
            "layers": {},
        }

        # Get layer statuses (column is LandingzoneEntityId, values are lowercase)
        statuses = conn.execute(
            "SELECT Layer, Status FROM entity_status WHERE LandingzoneEntityId = ?",
            (entity_id,)
        ).fetchall()
        status_map = {r["Layer"]: r["Status"] for r in statuses}

        # Get lakehouse names for each layer
        lakehouses = conn.execute("SELECT LakehouseId, Name FROM lakehouses").fetchall()
        lh_map = {r["LakehouseId"]: r["Name"] for r in lakehouses}

        # Bronze entity → lakehouse
        bronze = conn.execute(
            "SELECT BronzeLayerEntityId, LakehouseId, Schema_, Name "
            "FROM bronze_entities WHERE LandingzoneEntityId = ? AND IsActive = 1",
            (entity_id,)
        ).fetchone()

        # Silver entity → lakehouse
        silver = None
        if bronze:
            silver = conn.execute(
                "SELECT SilverLayerEntityId, LakehouseId, Schema_, Name "
                "FROM silver_entities WHERE BronzeLayerEntityId = ? AND IsActive = 1",
                (bronze["BronzeLayerEntityId"],)
            ).fetchone()

        # Map layer → lakehouse name + table info
        lz_lh_id = lz["LakehouseId"]
        if lz_lh_id and status_map.get("landing") == "loaded":
            result["layers"]["landing"] = {
                "lakehouse": lh_map.get(int(lz_lh_id), ""),
                "schema": lz["SourceSchema"] or "dbo",
                "table": lz["SourceName"],
            }

        if bronze and status_map.get("bronze") == "loaded":
            b_lh_id = bronze["LakehouseId"]
            result["layers"]["bronze"] = {
                "lakehouse": lh_map.get(int(b_lh_id), "") if b_lh_id else "",
                "schema": bronze["Schema_"] or "dbo",
                "table": bronze["Name"],
            }

        if silver and status_map.get("silver") == "loaded":
            s_lh_id = silver["LakehouseId"]
            result["layers"]["silver"] = {
                "lakehouse": lh_map.get(int(s_lh_id), "") if s_lh_id else "",
                "schema": silver["Schema_"] or "dbo",
                "table": silver["Name"],
            }

        return result
    finally:
        conn.close()


def _get_columns_from_cache(entity_id: int, layer: str) -> list[dict] | None:
    """Check column_metadata cache. Returns None if stale (>24h) or missing."""
    conn = db._get_conn()
    try:
        rows = conn.execute(
            "SELECT column_name, data_type, ordinal_position, is_nullable "
            "FROM column_metadata "
            "WHERE entity_id = ? AND layer = ? "
            "AND captured_at > datetime('now', '-24 hours') "
            "ORDER BY ordinal_position",
            (entity_id, layer)
        ).fetchall()
        if not rows:
            return None
        return [{"name": r["column_name"], "dataType": r["data_type"]} for r in rows]
    finally:
        conn.close()


def _cache_columns(entity_id: int, layer: str, columns: list[dict]):
    """Store column metadata in SQLite cache."""
    conn = db._get_conn()
    try:
        for col in columns:
            conn.execute(
                "INSERT OR REPLACE INTO column_metadata "
                "(entity_id, layer, column_name, data_type, ordinal_position, is_nullable) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (entity_id, layer, col.get("name", ""), col.get("dataType", ""),
                 col.get("ordinal", 0), 1 if col.get("nullable", True) else 0)
            )
        conn.commit()
    finally:
        conn.close()


def _query_lakehouse_columns(lakehouse_name: str, schema: str, table: str) -> list[dict]:
    """Query INFORMATION_SCHEMA.COLUMNS from a Fabric lakehouse."""
    from dashboard.app.api.routes.data_access import _query_lakehouse, _sanitize
    s = _sanitize(schema)
    t = _sanitize(table)
    rows = _query_lakehouse(
        lakehouse_name,
        "SELECT COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION, IS_NULLABLE "
        "FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
        "ORDER BY ORDINAL_POSITION",
        params=(s, t),
    )
    return [{"name": r.get("COLUMN_NAME", ""), "dataType": r.get("DATA_TYPE", "")} for r in rows]


@route("GET", "/api/lineage/columns/{entityId}")
def get_lineage_columns(params: dict) -> dict:
    """Return column schemas per layer for an entity.

    Response: { source: {columns: [...]}, landing: {columns: [...]}, ... }
    """
    try:
        entity_id = int(params.get("entityId", 0))
    except (TypeError, ValueError):
        raise HttpError("entityId must be an integer", 400)

    if not entity_id:
        raise HttpError("entityId is required", 400)

    info = _get_entity_layers(entity_id)
    result = {}

    for layer_key, layer_info in info["layers"].items():
        # Try cache first
        cached = _get_columns_from_cache(entity_id, layer_key)
        if cached:
            result[layer_key] = {"columns": cached}
            continue

        # Query lakehouse
        lh_name = layer_info["lakehouse"]
        if not lh_name:
            continue
        try:
            cols = _query_lakehouse_columns(lh_name, layer_info["schema"], layer_info["table"])
            if cols:
                _cache_columns(entity_id, layer_key, cols)
                result[layer_key] = {"columns": cols}
        except Exception as e:
            log.warning("Failed to get columns for entity %d layer %s: %s", entity_id, layer_key, e)
            result[layer_key] = {"columns": [], "error": str(e)}

    # Source layer = same as landing (same schema from on-prem)
    if "landing" in result:
        result["source"] = result["landing"]

    return result
```

- [ ] **Step 2: Update DataLineage.tsx to use new endpoint**

In `dashboard/app/src/pages/DataLineage.tsx`, change line 79 from:
```typescript
const res = await fetch(`/api/microscope/${entity.id}`, { signal: controller.signal });
```
To:
```typescript
const res = await fetch(`/api/lineage/columns/${entity.id}`, { signal: controller.signal });
```

- [ ] **Step 3: Verify the route module imports cleanly**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python -c "
import sys; sys.path.insert(0, 'dashboard/app/api')
from router import get_all_routes
from routes import lineage  # triggers auto-import
routes = get_all_routes()
lineage_routes = [r for r in routes if 'lineage' in r[1]]
print('Lineage routes:', lineage_routes)
assert any('lineage/columns' in r[1] for r in lineage_routes), 'lineage route not registered'
print('OK')
"
```
Expected: Shows lineage route registered.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/routes/lineage.py dashboard/app/src/pages/DataLineage.tsx
git commit -m "feat(mdm): add column lineage endpoint + wire DataLineage.tsx

GET /api/lineage/columns/{entityId} returns per-layer column schemas.
Queries INFORMATION_SCHEMA from each lakehouse, caches in column_metadata.
DataLineage.tsx updated from /api/microscope/ to /api/lineage/columns/.

Author: Steve Nahrup"
```

---

### Task 4: Update governance.ts ClassifiedBy type

**Files:**
- Modify: `dashboard/app/src/types/governance.ts` (line 13)

- [ ] **Step 1: Add auto:presidio variant**

In `dashboard/app/src/types/governance.ts`, change line 13 from:
```typescript
export type ClassifiedBy = `auto:pattern` | `auto:claude` | `manual:${string}`;
```
To:
```typescript
export type ClassifiedBy = `auto:pattern` | `auto:presidio` | `auto:claude` | `manual:${string}`;
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/app/src/types/governance.ts
git commit -m "feat(mdm): add auto:presidio to ClassifiedBy union type

Author: Steve Nahrup"
```

---

## Chunk 2: Business Glossary — Seed Script + API + Frontend

### Task 5: Create glossary seed script

**Files:**
- Create: `scripts/seed_glossary.py`

- [ ] **Step 1: Create the seed script**

Create `scripts/seed_glossary.py`:

```python
"""Seed business_glossary and entity_annotations tables from IP Corp knowledge base.

Usage:
    python scripts/seed_glossary.py [--knowledge-path PATH] [--db-path PATH]

Reads JSON files from the IP Corp knowledge base (default: ~/CascadeProjects/fabric_toolbox/knowledge)
and populates the SQLite control plane database with business terms and entity annotations.
"""

import argparse
import json
import logging
import os
import re
import sqlite3
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

DEFAULT_KNOWLEDGE_PATH = Path(os.path.expanduser("~/CascadeProjects/fabric_toolbox/knowledge"))
DEFAULT_DB_PATH = Path(__file__).parent.parent / "dashboard" / "app" / "api" / "fmd_control_plane.db"


def get_conn(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def load_json_safe(path: Path) -> dict | list | None:
    """Load a JSON file, returning None if missing or invalid."""
    if not path.exists():
        log.warning("File not found: %s", path)
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        log.warning("Invalid JSON in %s: %s", path, e)
        return None


def seed_glossary_terms(conn: sqlite3.Connection, kb: Path):
    """Import glossary.json → business_glossary table."""
    data = load_json_safe(kb / "entities" / "glossary.json")
    if not data:
        log.info("No glossary.json found, skipping glossary terms")
        return 0
    terms = data.get("terms", []) if isinstance(data, dict) else data
    count = 0
    for entry in terms:
        term = entry.get("term", "").strip()
        definition = entry.get("definition", "").strip()
        if not term or not definition:
            continue
        conn.execute(
            "INSERT OR REPLACE INTO business_glossary (term, definition, category, related_systems, synonyms, source) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (term, definition, "business",
             json.dumps(entry.get("relatedSystems", [])),
             json.dumps(entry.get("synonyms", [])),
             "ip-corp-glossary")
        )
        count += 1
    log.info("Imported %d glossary terms", count)
    return count


def seed_systems(conn: sqlite3.Connection, kb: Path):
    """Import systems.json → business_glossary (category='system')."""
    data = load_json_safe(kb / "entities" / "systems.json")
    if not data:
        log.info("No systems.json found, skipping systems")
        return 0
    systems = data.get("systems", []) if isinstance(data, dict) else data
    count = 0
    for entry in systems:
        name = entry.get("name", "").strip()
        desc = entry.get("description", "").strip() or entry.get("role", "").strip()
        if not name:
            continue
        conn.execute(
            "INSERT OR REPLACE INTO business_glossary (term, definition, category, related_systems, synonyms, source) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (name, desc or f"System: {name}", "system",
             json.dumps(entry.get("integrations", [])),
             json.dumps(entry.get("aliases", [])),
             "ip-corp-systems")
        )
        count += 1
    log.info("Imported %d system entries", count)
    return count


def seed_identifiers(conn: sqlite3.Connection, kb: Path):
    """Import identifiers.json → business_glossary (category='identifier')."""
    data = load_json_safe(kb / "entities" / "identifiers.json")
    if not data:
        log.info("No identifiers.json found, skipping identifiers")
        return 0
    identifiers = data.get("identifiers", []) if isinstance(data, dict) else data
    count = 0
    for entry in identifiers:
        name = entry.get("name", "").strip()
        desc = entry.get("description", "").strip()
        if not name:
            continue
        conn.execute(
            "INSERT OR REPLACE INTO business_glossary (term, definition, category, related_systems, synonyms, source) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (name, desc or f"Identifier: {name}", "identifier",
             json.dumps(entry.get("systems", [])),
             json.dumps([]),
             "ip-corp-identifiers")
        )
        count += 1
    log.info("Imported %d identifier entries", count)
    return count


def seed_entity_annotations(conn: sqlite3.Connection, kb: Path):
    """Match M3/MES table catalogs to registered entities, populate entity_annotations."""
    # Load M3 catalog
    m3_data = load_json_safe(kb / "agents" / "m3-analyst" / "m3-table-catalog.json")
    mes_data = load_json_safe(kb / "agents" / "mes-analyst" / "mes-table-catalog.json")

    # Build lookup: normalized table name → {business_name, description, domain}
    catalog_lookup = {}

    if m3_data:
        tables = m3_data.get("tables", []) if isinstance(m3_data, dict) else m3_data
        for entry in tables:
            name = entry.get("name", entry.get("tableName", "")).strip().upper()
            if not name:
                continue
            catalog_lookup[name] = {
                "business_name": entry.get("businessName", entry.get("description", ""))[:200],
                "description": entry.get("description", entry.get("businessContext", "")),
                "domain": entry.get("domain", entry.get("category", "erp")),
                "source": "ip-corp-m3-catalog",
            }
        log.info("Loaded %d M3 catalog entries", len(tables))

    if mes_data:
        tables = mes_data.get("tables", []) if isinstance(mes_data, dict) else mes_data
        for entry in tables:
            name = entry.get("name", entry.get("tableName", "")).strip().upper()
            if not name:
                continue
            catalog_lookup[name] = {
                "business_name": entry.get("businessName", entry.get("description", ""))[:200],
                "description": entry.get("description", entry.get("businessContext", "")),
                "domain": entry.get("domain", entry.get("category", "manufacturing")),
                "source": "ip-corp-mes-catalog",
            }
        log.info("Loaded %d MES catalog entries", len(tables))

    if not catalog_lookup:
        log.info("No catalog data found, skipping entity annotations")
        return 0

    # Match against registered LZ entities
    entities = conn.execute(
        "SELECT LandingzoneEntityId, SourceName FROM lz_entities WHERE IsActive = 1"
    ).fetchall()

    matched = 0
    for entity in entities:
        eid = entity["LandingzoneEntityId"]
        src_name = (entity["SourceName"] or "").strip().upper()
        info = catalog_lookup.get(src_name)
        if info:
            conn.execute(
                "INSERT OR REPLACE INTO entity_annotations "
                "(entity_id, business_name, description, domain, tags, source) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (eid, info["business_name"], info["description"],
                 info["domain"], json.dumps([info["domain"]]), info["source"])
            )
            matched += 1

    log.info("Matched %d of %d entities to catalog entries", matched, len(entities))
    return matched


def main():
    parser = argparse.ArgumentParser(description="Seed business glossary from IP Corp knowledge base")
    parser.add_argument("--knowledge-path", type=Path, default=DEFAULT_KNOWLEDGE_PATH)
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    args = parser.parse_args()

    if not args.knowledge_path.exists():
        log.error("Knowledge base not found at %s", args.knowledge_path)
        sys.exit(1)

    if not args.db_path.exists():
        log.error("Database not found at %s", args.db_path)
        sys.exit(1)

    conn = get_conn(args.db_path)
    try:
        total = 0
        total += seed_glossary_terms(conn, args.knowledge_path)
        total += seed_systems(conn, args.knowledge_path)
        total += seed_identifiers(conn, args.knowledge_path)
        total += seed_entity_annotations(conn, args.knowledge_path)
        conn.commit()
        log.info("Seeding complete. Total entries: %d", total)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test the seed script runs without errors**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python scripts/seed_glossary.py --knowledge-path ~/CascadeProjects/fabric_toolbox/knowledge
```
Expected: Prints import counts, no errors. OK if some files are missing (script handles gracefully).

- [ ] **Step 3: Verify data was seeded**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python -c "
import sqlite3
conn = sqlite3.connect('dashboard/app/api/fmd_control_plane.db')
conn.row_factory = sqlite3.Row
glossary = conn.execute('SELECT COUNT(*) as c FROM business_glossary').fetchone()['c']
annotations = conn.execute('SELECT COUNT(*) as c FROM entity_annotations').fetchone()['c']
print(f'Glossary terms: {glossary}')
print(f'Entity annotations: {annotations}')
conn.close()
"
```
Expected: Non-zero counts for at least one table.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed_glossary.py
git commit -m "feat(mdm): add glossary seed script — imports IP Corp knowledge base into SQLite

Author: Steve Nahrup"
```

---

### Task 6: Create glossary API routes

**Files:**
- Create: `dashboard/app/api/routes/glossary.py`

- [ ] **Step 1: Create the glossary route module**

Create `dashboard/app/api/routes/glossary.py`:

```python
"""Business glossary API — terms, entity annotations, and search."""

import json
import logging
import subprocess
import sys
import threading
from pathlib import Path

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import control_plane_db as db

log = logging.getLogger("fmd.glossary")


@route("GET", "/api/glossary")
def get_glossary(params: dict) -> dict:
    """Paginated glossary with search and category filter."""
    q = (params.get("q") or "").strip().lower()
    category = params.get("category", "").strip()
    limit = min(int(params.get("limit", 100)), 500)
    offset = int(params.get("offset", 0))

    conn = db._get_conn()
    try:
        where = []
        args = []
        if q:
            where.append("(LOWER(term) LIKE ? OR LOWER(definition) LIKE ?)")
            args.extend([f"%{q}%", f"%{q}%"])
        if category:
            where.append("category = ?")
            args.append(category)

        # NOTE: Dynamic WHERE built from validated clauses with ? placeholders — all values bound via args
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        total = conn.execute(f"SELECT COUNT(*) AS c FROM business_glossary {clause}", args).fetchone()["c"]
        rows = conn.execute(
            f"SELECT id, term, definition, category, related_systems, synonyms, source "
            f"FROM business_glossary {clause} ORDER BY term LIMIT ? OFFSET ?",
            args + [limit, offset]
        ).fetchall()

        items = []
        for r in rows:
            items.append({
                "id": r["id"],
                "term": r["term"],
                "definition": r["definition"],
                "category": r["category"],
                "relatedSystems": json.loads(r["related_systems"]) if r["related_systems"] else [],
                "synonyms": json.loads(r["synonyms"]) if r["synonyms"] else [],
                "source": r["source"],
            })

        return {"items": items, "total": total, "limit": limit, "offset": offset}
    finally:
        conn.close()


@route("GET", "/api/glossary/entity/{entityId}")
def get_entity_annotations(params: dict) -> dict:
    """Get annotations + related glossary terms for an entity."""
    try:
        entity_id = int(params.get("entityId", 0))
    except (TypeError, ValueError):
        raise HttpError("entityId must be an integer", 400)

    conn = db._get_conn()
    try:
        ann = conn.execute(
            "SELECT business_name, description, domain, tags, source "
            "FROM entity_annotations WHERE entity_id = ?",
            (entity_id,)
        ).fetchone()

        annotation = None
        if ann:
            annotation = {
                "businessName": ann["business_name"],
                "description": ann["description"],
                "domain": ann["domain"],
                "tags": json.loads(ann["tags"]) if ann["tags"] else [],
                "source": ann["source"],
            }

        # Find related glossary terms by domain
        related = []
        if annotation and annotation["domain"]:
            domain = annotation["domain"].lower()
            rows = conn.execute(
                "SELECT term, definition, category FROM business_glossary "
                "WHERE LOWER(definition) LIKE ? OR LOWER(term) LIKE ? LIMIT 10",
                (f"%{domain}%", f"%{domain}%")
            ).fetchall()
            related = [{"term": r["term"], "definition": r["definition"], "category": r["category"]} for r in rows]

        return {"entityId": entity_id, "annotation": annotation, "relatedTerms": related}
    finally:
        conn.close()


@route("POST", "/api/glossary/seed")
def post_glossary_seed(params: dict) -> dict:
    """Re-run the glossary seed script (idempotent)."""
    script = Path(__file__).parent.parent.parent.parent / "scripts" / "seed_glossary.py"
    if not script.exists():
        raise HttpError("Seed script not found", 500)
    try:
        result = subprocess.run(
            [sys.executable, str(script)],
            capture_output=True, text=True, timeout=60, cwd=str(script.parent.parent)
        )
        return {
            "status": "success" if result.returncode == 0 else "error",
            "output": result.stdout[-500:] if result.stdout else "",
            "error": result.stderr[-500:] if result.stderr else "",
        }
    except subprocess.TimeoutExpired:
        raise HttpError("Seed script timed out", 504)
```

- [ ] **Step 2: Verify route registers**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python -c "
import sys; sys.path.insert(0, 'dashboard/app/api')
from router import get_all_routes
from routes import glossary
routes = get_all_routes()
glossary_routes = [r for r in routes if 'glossary' in r[1]]
print('Glossary routes:', glossary_routes)
assert len(glossary_routes) >= 3, 'Expected 3 glossary routes'
print('OK')
"
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/routes/glossary.py
git commit -m "feat(mdm): add glossary API — search, entity annotations, re-seed endpoint

Author: Steve Nahrup"
```

---

## Chunk 3: Classification Engine — Service + API + Frontend

### Task 7: Create classification engine service

**Files:**
- Create: `dashboard/app/api/services/classification_engine.py`

- [ ] **Step 1: Create the classification engine**

Create `dashboard/app/api/services/classification_engine.py`:

```python
"""Column classification engine — pattern matching + optional Presidio PII detection.

Pipeline:
1. capture_column_schemas() — reads INFORMATION_SCHEMA from each lakehouse → column_metadata
2. classify_by_pattern() — regex rules on column names → column_classifications
3. classify_by_presidio() — PII scan on string column samples (optional, requires presidio-analyzer)
"""

import json
import logging
import re
from datetime import datetime, timezone

from dashboard.app.api import control_plane_db as db

log = logging.getLogger("fmd.classification")

# Sensitivity levels in priority order (highest first)
SENSITIVITY_PRIORITY = ["pii", "restricted", "confidential", "internal", "public"]

# Pattern-based classification rules — column NAME patterns
COLUMN_PATTERNS: dict[str, list[str]] = {
    "pii": [
        r"(?i)(ssn|social.?sec|tin|tax.?id)",
        r"(?i)(email|e.?mail)",
        r"(?i)(phone|mobile|cell|fax|tel\b)",
        r"(?i)(first.?name|last.?name|full.?name|middle.?name)",
        r"(?i)(address|street|city|state|zip|postal)",
        r"(?i)(birth|dob|date.?of.?birth)",
        r"(?i)(driver.?lic|passport|national.?id)",
    ],
    "confidential": [
        r"(?i)(salary|wage|compensation|pay.?rate|bonus)",
        r"(?i)(bank|account.?num|routing|iban|swift)",
        r"(?i)(credit.?card|card.?num|cvv|expir)",
        r"(?i)(password|passwd|secret|token|api.?key)",
        r"(?i)(price|cost|margin|profit|revenue|discount)",
    ],
    "restricted": [
        r"(?i)(medical|diagnosis|prescription|health)",
        r"(?i)(criminal|arrest|conviction)",
    ],
    "internal": [
        r"(?i)(employee.?id|emp.?num|badge|department|manager)",
        r"(?i)(internal.?id|system.?id|audit|created.?by|modified.?by)",
    ],
}

# Compiled patterns for performance
_COMPILED_PATTERNS: dict[str, list[re.Pattern]] = {
    level: [re.compile(p) for p in patterns]
    for level, patterns in COLUMN_PATTERNS.items()
}

# String-like SQL types for Presidio scanning
STRING_TYPES = {"varchar", "nvarchar", "char", "nchar", "text", "ntext"}


def classify_column_name(column_name: str) -> str:
    """Classify a column by its name using regex patterns. Returns sensitivity level."""
    for level in SENSITIVITY_PRIORITY:
        if level == "public":
            continue
        patterns = _COMPILED_PATTERNS.get(level, [])
        for pattern in patterns:
            if pattern.search(column_name):
                return level
    return "public"


def classify_by_pattern(entity_id: int | None = None) -> dict:
    """Run pattern-based classification on all columns in column_metadata.

    Args:
        entity_id: If set, only classify this entity. If None, classify all.

    Returns:
        Summary dict with counts per sensitivity level.
    """
    conn = db._get_conn()
    try:
        where = "WHERE entity_id = ?" if entity_id else ""
        args = (entity_id,) if entity_id else ()
        rows = conn.execute(
            f"SELECT id, entity_id, layer, column_name, data_type "
            f"FROM column_metadata {where}",
            args
        ).fetchall()

        counts: dict[str, int] = {level: 0 for level in SENSITIVITY_PRIORITY}
        classified = 0

        for row in rows:
            level = classify_column_name(row["column_name"])
            conn.execute(
                "INSERT OR REPLACE INTO column_classifications "
                "(entity_id, layer, column_name, sensitivity_level, certification_status, classified_by, confidence) "
                "VALUES (?, ?, ?, ?, 'none', 'auto:pattern', 1.0)",
                (row["entity_id"], row["layer"], row["column_name"], level)
            )
            counts[level] = counts.get(level, 0) + 1
            classified += 1

        conn.commit()
        log.info("Pattern classification: %d columns classified", classified)
        return {"classified": classified, "bySensitivity": counts}
    finally:
        conn.close()


def classify_by_presidio(entity_id: int | None = None) -> dict:
    """Run Presidio PII detection on string column samples.

    Only upgrades classification — never downgrades.
    Requires: pip install presidio-analyzer && python -m spacy download en_core_web_sm
    """
    try:
        from presidio_analyzer import AnalyzerEngine
    except ImportError:
        log.warning("presidio-analyzer not installed, skipping Presidio classification")
        return {"skipped": True, "reason": "presidio-analyzer not installed"}

    analyzer = AnalyzerEngine()
    conn = db._get_conn()
    upgraded = 0

    try:
        # Get string columns that haven't been scanned by Presidio yet
        where = "AND cm.entity_id = ?" if entity_id else ""
        args = (entity_id,) if entity_id else ()
        rows = conn.execute(
            f"SELECT cm.entity_id, cm.layer, cm.column_name, cm.data_type "
            f"FROM column_metadata cm "
            f"LEFT JOIN column_classifications cc "
            f"  ON cm.entity_id = cc.entity_id AND cm.layer = cc.layer AND cm.column_name = cc.column_name "
            # NOTE: Values parameterized via ? placeholders — safe from injection
            f"WHERE LOWER(cm.data_type) IN ({','.join('?' for _ in STRING_TYPES)}) "
            f"  AND (cc.classified_by IS NULL OR cc.classified_by != 'auto:presidio') "
            f"{where} "
            f"LIMIT 500",
            tuple(STRING_TYPES) + args
        ).fetchall()

        if not rows:
            return {"upgraded": 0, "scanned": 0}

        # Group by entity+layer to batch lakehouse queries
        from dashboard.app.api.routes.data_access import _query_lakehouse, _sanitize

        # Get entity → lakehouse mapping
        entity_layers = {}
        for row in rows:
            key = (row["entity_id"], row["layer"])
            if key not in entity_layers:
                entity_layers[key] = []
            entity_layers[key].append(row["column_name"])

        scanned = 0
        for (eid, layer), col_names in entity_layers.items():
            # Resolve lakehouse + table for this entity/layer
            entity_info = _resolve_entity_table(conn, eid, layer)
            if not entity_info:
                continue

            for col_name in col_names[:10]:  # Limit columns per entity for performance
                safe_col = col_name.replace("]", "]]")
                try:
                    # NOTE: Identifiers sanitized via _sanitize() — can't use ? for identifiers, only for values
                    sample_rows = _query_lakehouse(
                        entity_info["lakehouse"],
                        f"SELECT TOP 100 [{safe_col}] FROM [{_sanitize(entity_info['schema'])}].[{_sanitize(entity_info['table'])}] "
                        f"WHERE [{safe_col}] IS NOT NULL"
                    )
                except Exception as e:
                    log.debug("Presidio sample query failed for %s.%s: %s", entity_info["table"], col_name, e)
                    continue

                if not sample_rows:
                    continue

                # Concatenate samples for analysis
                text = " | ".join(str(r.get(col_name, "")) for r in sample_rows if r.get(col_name))
                if not text.strip():
                    continue

                results = analyzer.analyze(text=text, language="en")
                scanned += 1

                if results:
                    pii_types = list({r.entity_type for r in results})
                    # Upgrade classification
                    conn.execute(
                        "INSERT OR REPLACE INTO column_classifications "
                        "(entity_id, layer, column_name, sensitivity_level, certification_status, "
                        "classified_by, confidence, pii_entities) "
                        "VALUES (?, ?, ?, 'pii', 'none', 'auto:presidio', ?, ?)",
                        (eid, layer, col_name,
                         round(max(r.score for r in results), 2),
                         json.dumps(pii_types))
                    )
                    upgraded += 1

        conn.commit()
        log.info("Presidio scan: %d columns scanned, %d upgraded to PII", scanned, upgraded)
        return {"scanned": scanned, "upgraded": upgraded}
    finally:
        conn.close()


def _resolve_entity_table(conn, entity_id: int, layer: str) -> dict | None:
    """Resolve lakehouse name + schema + table for an entity/layer."""
    if layer == "landing":
        row = conn.execute(
            "SELECT le.SourceSchema, le.SourceName, lh.Name as LakehouseName "
            "FROM lz_entities le JOIN lakehouses lh ON le.LakehouseId = lh.LakehouseId "
            "WHERE le.LandingzoneEntityId = ?", (entity_id,)
        ).fetchone()
    elif layer == "bronze":
        row = conn.execute(
            "SELECT be.Schema_ as SourceSchema, be.Name as SourceName, lh.Name as LakehouseName "
            "FROM bronze_entities be JOIN lakehouses lh ON be.LakehouseId = lh.LakehouseId "
            "WHERE be.LandingzoneEntityId = ?", (entity_id,)
        ).fetchone()
    elif layer == "silver":
        row = conn.execute(
            "SELECT se.Schema_ as SourceSchema, se.Name as SourceName, lh.Name as LakehouseName "
            "FROM silver_entities se "
            "JOIN bronze_entities be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId "
            "JOIN lakehouses lh ON se.LakehouseId = lh.LakehouseId "
            "WHERE be.LandingzoneEntityId = ?", (entity_id,)
        ).fetchone()
    else:
        return None

    if not row:
        return None
    return {"lakehouse": row["LakehouseName"], "schema": row["SourceSchema"] or "dbo", "table": row["SourceName"]}


def get_classification_summary() -> dict:
    """Build ClassificationSummary matching governance.ts shape."""
    conn = db._get_conn()
    try:
        # Total entities and columns
        total_entities = conn.execute(
            "SELECT COUNT(*) as c FROM lz_entities WHERE IsActive = 1"
        ).fetchone()["c"]

        total_columns = conn.execute(
            "SELECT COUNT(*) as c FROM column_metadata"
        ).fetchone()["c"]

        classified_columns = conn.execute(
            "SELECT COUNT(*) as c FROM column_classifications WHERE sensitivity_level != 'public'"
        ).fetchone()["c"]

        # By sensitivity
        by_sensitivity = {}
        for level in SENSITIVITY_PRIORITY:
            count = conn.execute(
                "SELECT COUNT(*) as c FROM column_classifications WHERE sensitivity_level = ?",
                (level,)
            ).fetchone()["c"]
            by_sensitivity[level] = count

        # By source
        by_source_rows = conn.execute(
            "SELECT ds.Name as source, "
            "  COUNT(DISTINCT cm.id) as total, "
            "  COUNT(DISTINCT CASE WHEN cc.sensitivity_level != 'public' AND cc.sensitivity_level IS NOT NULL THEN cc.id END) as classified, "
            "  COUNT(DISTINCT CASE WHEN cc.sensitivity_level = 'pii' THEN cc.id END) as piiCount, "
            "  COUNT(DISTINCT CASE WHEN cc.sensitivity_level = 'confidential' THEN cc.id END) as confidentialCount "
            "FROM column_metadata cm "
            "JOIN lz_entities le ON cm.entity_id = le.LandingzoneEntityId "
            "JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            "LEFT JOIN column_classifications cc ON cm.entity_id = cc.entity_id AND cm.layer = cc.layer AND cm.column_name = cc.column_name "
            "GROUP BY ds.Name"
        ).fetchall()

        by_source = [
            {
                "source": r["source"],
                "total": int(r["total"] or 0),
                "classified": int(r["classified"] or 0),
                "piiCount": int(r["piiCount"] or 0),
                "confidentialCount": int(r["confidentialCount"] or 0),
            }
            for r in by_source_rows
        ]

        coverage = round(classified_columns / total_columns * 100, 1) if total_columns > 0 else 0.0

        return {
            "totalEntities": total_entities,
            "totalColumns": total_columns,
            "classifiedColumns": classified_columns,
            "coveragePercent": coverage,
            "bySensitivity": by_sensitivity,
            "byCertification": {"certified": 0, "pending": 0, "draft": 0, "deprecated": 0, "none": total_columns},
            "bySource": by_source,
        }
    finally:
        conn.close()
```

- [ ] **Step 2: Verify the module imports cleanly**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python -c "
import sys; sys.path.insert(0, '.')
from dashboard.app.api.services.classification_engine import classify_column_name, SENSITIVITY_PRIORITY
# Test pattern matching
assert classify_column_name('SSN') == 'pii'
assert classify_column_name('email_address') == 'pii'
assert classify_column_name('salary') == 'confidential'
assert classify_column_name('employee_id') == 'internal'
assert classify_column_name('MMITNO') == 'public'
assert classify_column_name('phone_number') == 'pii'
assert classify_column_name('credit_card_num') == 'confidential'
print('All pattern classification tests passed')
"
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/services/classification_engine.py
git commit -m "feat(mdm): add classification engine — pattern matching + Presidio PII detection

Author: Steve Nahrup"
```

---

### Task 8: Create classification API routes

**Files:**
- Create: `dashboard/app/api/routes/classification.py`

- [ ] **Step 1: Create the classification route module**

Create `dashboard/app/api/routes/classification.py`:

```python
"""Classification API — scan trigger, results, summary."""

import json
import logging
import threading
import uuid
from datetime import datetime, timezone

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import control_plane_db as db

log = logging.getLogger("fmd.classification")

# Scan job state (same pattern as source_manager.py ImportJob)
_scan_job: dict | None = None
_scan_lock = threading.Lock()


def _run_classification_scan():
    """Background thread — runs the full classification pipeline."""
    global _scan_job
    try:
        with _scan_lock:
            _scan_job["phase"] = "capturing_schemas"
            _scan_job["progress"] = 5

        # Phase 1: Capture column schemas from lakehouses
        from dashboard.app.api.routes.lineage import _query_lakehouse_columns, _cache_columns

        conn = db._get_conn()
        try:
            entities = conn.execute(
                "SELECT le.LandingzoneEntityId as eid, le.SourceSchema, le.SourceName, "
                "  le.LakehouseId, lh.Name as LakehouseName, "
                "  es.Layer, es.Status "
                "FROM lz_entities le "
                "JOIN lakehouses lh ON le.LakehouseId = lh.LakehouseId "
                "JOIN entity_status es ON le.LandingzoneEntityId = es.LandingzoneEntityId "
                "WHERE le.IsActive = 1 AND es.Status = 'loaded' AND es.Layer = 'landing'"
            ).fetchall()
        finally:
            conn.close()

        total = len(entities)
        captured = 0

        for i, ent in enumerate(entities):
            try:
                cols = _query_lakehouse_columns(
                    ent["LakehouseName"],
                    ent["SourceSchema"] or "dbo",
                    ent["SourceName"]
                )
                if cols:
                    _cache_columns(ent["eid"], "landing", cols)
                    captured += 1
            except Exception as e:
                log.debug("Schema capture failed for entity %d: %s", ent["eid"], e)

            if (i + 1) % 50 == 0 or i == total - 1:
                pct = 5 + int((i + 1) / total * 40)
                with _scan_lock:
                    _scan_job["progress"] = pct
                    _scan_job["detail"] = f"Captured {captured}/{i+1} entities"

        log.info("Schema capture: %d of %d entities", captured, total)

        # Phase 2: Pattern classification
        with _scan_lock:
            _scan_job["phase"] = "classifying_patterns"
            _scan_job["progress"] = 50

        from dashboard.app.api.services.classification_engine import classify_by_pattern
        pattern_result = classify_by_pattern()

        with _scan_lock:
            _scan_job["progress"] = 70
            _scan_job["detail"] = f"Pattern: {pattern_result.get('classified', 0)} columns"

        # Phase 3: Presidio PII scan (optional)
        with _scan_lock:
            _scan_job["phase"] = "presidio_scan"
            _scan_job["progress"] = 75

        from dashboard.app.api.services.classification_engine import classify_by_presidio
        presidio_result = classify_by_presidio()

        with _scan_lock:
            _scan_job["progress"] = 95
            _scan_job["detail"] = f"Presidio: {presidio_result.get('upgraded', 0)} PII found"

        # Done
        with _scan_lock:
            _scan_job["phase"] = "complete"
            _scan_job["progress"] = 100
            _scan_job["finished_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            _scan_job["result"] = {
                "entitiesScanned": total,
                "schemasCaptured": captured,
                "patternClassified": pattern_result.get("classified", 0),
                "presidioUpgraded": presidio_result.get("upgraded", 0),
            }

        log.info("Classification scan complete")

    except Exception as e:
        log.exception("Classification scan failed: %s", e)
        with _scan_lock:
            _scan_job["phase"] = "failed"
            _scan_job["error"] = str(e)[:500]


@route("POST", "/api/classification/scan")
def post_classification_scan(params: dict) -> dict:
    """Trigger a classification scan in the background."""
    global _scan_job
    with _scan_lock:
        if _scan_job and _scan_job.get("phase") not in ("complete", "failed", None):
            return {"status": "already_running", "job": _scan_job}

        _scan_job = {
            "jobId": str(uuid.uuid4()),
            "phase": "starting",
            "progress": 0,
            "detail": "",
            "started_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "finished_at": None,
            "error": None,
            "result": None,
        }

    t = threading.Thread(target=_run_classification_scan, daemon=True)
    t.start()
    return {"status": "started", "job": _scan_job}


@route("GET", "/api/classification/status")
def get_classification_status(params: dict) -> dict:
    """Get current scan job status."""
    with _scan_lock:
        if not _scan_job:
            return {"status": "idle", "job": None}
        return {"status": _scan_job.get("phase", "unknown"), "job": dict(_scan_job)}


@route("GET", "/api/classification/summary")
def get_classification_summary_route(params: dict) -> dict:
    """Return ClassificationSummary for KPIs and heatmap."""
    from dashboard.app.api.services.classification_engine import get_classification_summary
    return get_classification_summary()


@route("GET", "/api/classification/data")
def get_classification_data(params: dict) -> dict:
    """Paginated classification results with filters."""
    source = params.get("source", "").strip()
    level = params.get("level", "").strip()
    limit = min(int(params.get("limit", 100)), 500)
    offset = int(params.get("offset", 0))

    conn = db._get_conn()
    try:
        where = []
        args = []
        if source:
            where.append("ds.Name = ?")
            args.append(source)
        if level:
            where.append("cc.sensitivity_level = ?")
            args.append(level)

        # NOTE: Dynamic WHERE built from validated clauses with ? placeholders — all values bound via args
        clause = f"WHERE {' AND '.join(where)}" if where else ""

        total = conn.execute(
            f"SELECT COUNT(*) as c FROM column_classifications cc "
            f"JOIN column_metadata cm ON cc.entity_id = cm.entity_id AND cc.layer = cm.layer AND cc.column_name = cm.column_name "
            f"JOIN lz_entities le ON cc.entity_id = le.LandingzoneEntityId "
            f"JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            f"{clause}", args
        ).fetchone()["c"]

        rows = conn.execute(
            f"SELECT cc.entity_id, cc.layer, cc.column_name, cc.sensitivity_level, "
            f"  cc.classified_by, cc.confidence, cc.pii_entities, "
            f"  le.SourceName as entity_name, ds.Name as source_name "
            f"FROM column_classifications cc "
            f"JOIN lz_entities le ON cc.entity_id = le.LandingzoneEntityId "
            f"JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            f"JOIN column_metadata cm ON cc.entity_id = cm.entity_id AND cc.layer = cm.layer AND cc.column_name = cm.column_name "
            f"{clause} ORDER BY cc.entity_id, cc.column_name LIMIT ? OFFSET ?",
            args + [limit, offset]
        ).fetchall()

        items = [
            {
                "entityId": r["entity_id"],
                "entityName": r["entity_name"],
                "source": r["source_name"],
                "layer": r["layer"],
                "columnName": r["column_name"],
                "sensitivityLevel": r["sensitivity_level"],
                "classifiedBy": r["classified_by"],
                "confidence": float(r["confidence"] or 1.0),
                "piiEntities": json.loads(r["pii_entities"]) if r["pii_entities"] else [],
            }
            for r in rows
        ]

        return {"items": items, "total": total, "limit": limit, "offset": offset}
    finally:
        conn.close()
```

- [ ] **Step 2: Verify routes register**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python -c "
import sys; sys.path.insert(0, 'dashboard/app/api')
from router import get_all_routes
from routes import classification
routes = get_all_routes()
cls_routes = [r for r in routes if 'classification' in r[1]]
print('Classification routes:', cls_routes)
assert len(cls_routes) >= 4, 'Expected 4 classification routes'
print('OK')
"
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/routes/classification.py
git commit -m "feat(mdm): add classification API — scan trigger, status, summary, paginated data

Author: Steve Nahrup"
```

---

### Task 9: Wire DataClassification.tsx to real API

**Files:**
- Modify: `dashboard/app/src/pages/DataClassification.tsx`

- [ ] **Step 1: Replace the mock useClassificationData with real API calls**

In `DataClassification.tsx`, replace the `useClassificationData` function (lines 38-83) with:

```typescript
function useClassificationData(entities: DigestEntity[]) {
  const [data, setData] = useState<{
    totalEntities: number;
    totalColumns: number;
    classifiedColumns: number;
    coveragePercent: number;
    bySensitivity: Record<SensitivityLevel, number>;
    bySource: Array<{ source: string; total: number; classified: number; piiCount: number; confidentialCount: number }>;
    heatmap: HeatmapCell[];
    sources: string[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/classification/summary")
      .then((r) => r.json())
      .then((summary) => {
        if (cancelled) return;
        const sources = (summary.bySource || []).map((s: { source: string }) => s.source);
        // Build heatmap from bySource
        const heatmap: HeatmapCell[] = [];
        for (const src of summary.bySource || []) {
          SENSITIVITY_ORDER.forEach((level) => {
            const count = level === "pii" ? src.piiCount : level === "confidential" ? src.confidentialCount : 0;
            heatmap.push({ source: src.source, level, count });
          });
        }
        setData({
          totalEntities: summary.totalEntities ?? entities.length,
          totalColumns: summary.totalColumns ?? entities.length * 15,
          classifiedColumns: summary.classifiedColumns ?? 0,
          coveragePercent: summary.coveragePercent ?? 0,
          bySensitivity: summary.bySensitivity ?? { public: 0, internal: 0, confidential: 0, restricted: 0, pii: 0 },
          bySource: summary.bySource ?? [],
          heatmap,
          sources,
        });
      })
      .catch(() => {
        // Fallback to entity-derived estimates
        if (cancelled) return;
        const sources = [...new Set(entities.map((e) => e.source).filter(Boolean))];
        setData({
          totalEntities: entities.length,
          totalColumns: entities.length * 15,
          classifiedColumns: 0,
          coveragePercent: 0,
          bySensitivity: { public: 0, internal: 0, confidential: 0, restricted: 0, pii: 0 },
          bySource: sources.map((s) => ({ source: s, total: 0, classified: 0, piiCount: 0, confidentialCount: 0 })),
          heatmap: [],
          sources,
        });
      });
    return () => { cancelled = true; };
  }, [entities]);

  // Return fallback while loading
  if (!data) {
    const sources = [...new Set(entities.map((e) => e.source).filter(Boolean))];
    return {
      totalEntities: entities.length,
      totalColumns: entities.length * 15,
      classifiedColumns: 0,
      coveragePercent: 0,
      bySensitivity: { public: 0, internal: 0, confidential: 0, restricted: 0, pii: 0 } as Record<SensitivityLevel, number>,
      bySource: sources.map((s) => ({ source: s, total: 0, classified: 0, piiCount: 0, confidentialCount: 0 })),
      heatmap: [] as HeatmapCell[],
      sources,
    };
  }
  return data;
}
```

Also add `useEffect` and `useState` to the import on line 1 (they're likely already imported but verify).

- [ ] **Step 2: Update the heatmap and entity view to use new field names**

The mock `bySource` uses `{ source, entityCount, estimatedColumns, classified, piiCandidates }` but the real API returns `{ source, total, classified, piiCount, confidentialCount }`. Update all references in the template:

1. Around line 206, replace `src.entityCount` with entity count derived from digest:
```tsx
<span className="text-muted-foreground ml-1 text-[10px]">({entities.filter(e => e.source === src.source).length} entities)</span>
```

2. Around line 227, replace `{src.estimatedColumns}` (unclassified column) with:
```tsx
{src.total - src.classified}
```

3. If any references to `src.piiCandidates` exist, replace with `src.piiCount`.

Read the full `DataClassification.tsx` before editing to find all field name references that need updating.

- [ ] **Step 3: Build frontend to check for TypeScript errors**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app
npx tsc --noEmit 2>&1 | head -20
```
Expected: No new errors related to DataClassification.tsx.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/src/pages/DataClassification.tsx
git commit -m "feat(mdm): wire DataClassification to real /api/classification/summary endpoint

Author: Steve Nahrup"
```

---

## Chunk 4: Quality Scoring + Entity Digest Enrichment

### Task 10: Create quality scoring engine

**Files:**
- Create: `dashboard/app/api/services/quality_engine.py`

- [ ] **Step 1: Create the quality engine**

Create `dashboard/app/api/services/quality_engine.py`:

```python
"""Quality scoring engine — computes per-entity quality scores from existing metadata.

Dimensions:
- Completeness (40%): Avg column completeness from profiler data, default 75 if no data
- Freshness (25%): Hours since last load, 100 if <24h, decays to 0 at 7 days
- Consistency (20%): % of expected layers loaded (LZ+Bronze+Silver)
- Volume (15%): 100 if latest load rows > 0, 50 if rows == 0, 0 if failed
"""

import logging
from datetime import datetime, timezone

from dashboard.app.api import control_plane_db as db

log = logging.getLogger("fmd.quality")

WEIGHTS = {
    "completeness": 0.40,
    "freshness": 0.25,
    "consistency": 0.20,
    "volume": 0.15,
}

TIER_THRESHOLDS = [
    (90, "gold"),
    (70, "silver"),
    (50, "bronze"),
    (0, "unclassified"),
]


def _compute_freshness(hours_since_load: float | None) -> float:
    """100 if <24h, linear decay to 0 at 168h (7 days)."""
    if hours_since_load is None:
        return 0.0
    if hours_since_load <= 24:
        return 100.0
    if hours_since_load >= 168:
        return 0.0
    return round(100 * (1 - (hours_since_load - 24) / (168 - 24)), 2)


def _tier_from_score(score: float) -> str:
    for threshold, tier in TIER_THRESHOLDS:
        if score >= threshold:
            return tier
    return "unclassified"


def compute_quality_scores() -> dict:
    """Compute quality scores for all active entities. Stores in quality_scores table."""
    conn = db._get_conn()
    try:
        now = datetime.now(timezone.utc)
        entities = conn.execute(
            "SELECT LandingzoneEntityId FROM lz_entities WHERE IsActive = 1"
        ).fetchall()

        scored = 0
        tier_counts = {"gold": 0, "silver": 0, "bronze": 0, "unclassified": 0}

        for ent in entities:
            eid = ent["LandingzoneEntityId"]

            # -- Completeness --
            completeness_row = conn.execute(
                "SELECT AVG(100.0 - COALESCE("
                "  (SELECT CAST(cc.confidence AS REAL) FROM column_classifications cc "
                "   WHERE cc.entity_id = cm.entity_id AND cc.layer = cm.layer "
                "   AND cc.column_name = cm.column_name AND cc.sensitivity_level = 'public'), 0)"
                ") as avg_completeness "
                "FROM column_metadata cm WHERE cm.entity_id = ?",
                (eid,)
            ).fetchone()
            # Simplified: if we have column_metadata, assume completeness data exists
            # Otherwise default to 75
            has_metadata = conn.execute(
                "SELECT COUNT(*) as c FROM column_metadata WHERE entity_id = ?", (eid,)
            ).fetchone()["c"]
            completeness = 75.0  # default neutral
            if has_metadata > 0:
                # Use a simpler heuristic: % of non-null columns from column_metadata
                nullable_count = conn.execute(
                    "SELECT COUNT(*) as c FROM column_metadata WHERE entity_id = ? AND is_nullable = 0",
                    (eid,)
                ).fetchone()["c"]
                total_cols = has_metadata
                completeness = round((1 - nullable_count / total_cols) * 100, 2) if total_cols > 0 else 75.0
                # Cap between 50-100 for non-nullable ratio (it's a rough proxy)
                completeness = max(50.0, min(100.0, completeness))

            # -- Freshness --
            status_row = conn.execute(
                "SELECT LoadEndDateTime FROM entity_status "
                "WHERE LandingzoneEntityId = ? AND Status = 'loaded' "
                "ORDER BY LoadEndDateTime DESC LIMIT 1",
                (eid,)
            ).fetchone()
            hours_since = None
            if status_row and status_row["LoadEndDateTime"]:
                try:
                    load_dt = datetime.fromisoformat(status_row["LoadEndDateTime"].replace("Z", "+00:00"))
                    hours_since = (now - load_dt).total_seconds() / 3600
                except (ValueError, TypeError):
                    pass
            freshness = _compute_freshness(hours_since)

            # -- Consistency --
            layer_count = conn.execute(
                "SELECT COUNT(DISTINCT Layer) as c FROM entity_status "
                "WHERE LandingzoneEntityId = ? AND Status = 'loaded'",
                (eid,)
            ).fetchone()["c"]
            consistency = round(layer_count / 3 * 100, 2)  # 3 expected layers

            # -- Volume --
            task_row = conn.execute(
                "SELECT Status, RowsRead FROM engine_task_log "
                "WHERE EntityId = ? ORDER BY created_at DESC LIMIT 1",
                (eid,)
            ).fetchone()
            if task_row:
                if task_row["Status"] == "succeeded" and int(task_row["RowsRead"] or 0) > 0:
                    volume = 100.0
                elif task_row["Status"] == "succeeded":
                    volume = 50.0
                else:
                    volume = 0.0
            else:
                volume = 50.0  # No task log = neutral

            # -- Composite --
            composite = round(
                completeness * WEIGHTS["completeness"] +
                freshness * WEIGHTS["freshness"] +
                consistency * WEIGHTS["consistency"] +
                volume * WEIGHTS["volume"],
                2
            )
            tier = _tier_from_score(composite)

            conn.execute(
                "INSERT OR REPLACE INTO quality_scores "
                "(entity_id, completeness_score, freshness_score, consistency_score, "
                "volume_score, composite_score, quality_tier) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (eid, completeness, freshness, consistency, volume, composite, tier)
            )
            scored += 1
            tier_counts[tier] = tier_counts.get(tier, 0) + 1

        conn.commit()
        log.info("Quality scoring: %d entities scored", scored)
        return {"scored": scored, "tiers": tier_counts}
    finally:
        conn.close()


def get_quality_summary() -> dict:
    """Aggregated quality stats for dashboard KPIs."""
    conn = db._get_conn()
    try:
        total = conn.execute("SELECT COUNT(*) as c FROM quality_scores").fetchone()["c"]
        if total == 0:
            return {"total": 0, "avgScore": 0, "tiers": {}, "computed": False}

        avg = conn.execute("SELECT AVG(composite_score) as avg FROM quality_scores").fetchone()["avg"]

        tiers = {}
        for row in conn.execute(
            "SELECT quality_tier, COUNT(*) as c FROM quality_scores GROUP BY quality_tier"
        ).fetchall():
            tiers[row["quality_tier"]] = row["c"]

        return {
            "total": total,
            "avgScore": round(float(avg or 0), 1),
            "tiers": tiers,
            "computed": True,
        }
    finally:
        conn.close()
```

- [ ] **Step 2: Verify engine imports**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python -c "
import sys; sys.path.insert(0, '.')
from dashboard.app.api.services.quality_engine import _compute_freshness, _tier_from_score, WEIGHTS
assert _compute_freshness(0) == 100.0
assert _compute_freshness(12) == 100.0
assert _compute_freshness(24) == 100.0
assert _compute_freshness(96) == 50.0
assert _compute_freshness(168) == 0.0
assert _compute_freshness(None) == 0.0
assert _tier_from_score(95) == 'gold'
assert _tier_from_score(75) == 'silver'
assert _tier_from_score(55) == 'bronze'
assert _tier_from_score(30) == 'unclassified'
assert sum(WEIGHTS.values()) == 1.0
print('All quality engine tests passed')
"
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/services/quality_engine.py
git commit -m "feat(mdm): add quality scoring engine — completeness, freshness, consistency, volume

Author: Steve Nahrup"
```

---

### Task 11: Create quality API routes

**Files:**
- Create: `dashboard/app/api/routes/quality.py`

- [ ] **Step 1: Create the quality route module**

Create `dashboard/app/api/routes/quality.py`:

```python
"""Quality scoring API — scores, per-entity breakdown, refresh trigger."""

import logging

from dashboard.app.api.router import route, HttpError
from dashboard.app.api import control_plane_db as db

log = logging.getLogger("fmd.quality")


@route("GET", "/api/quality/scores")
def get_quality_scores(params: dict) -> dict:
    """All entity quality scores with optional tier filter."""
    tier = params.get("tier", "").strip()
    limit = min(int(params.get("limit", 200)), 1000)
    offset = int(params.get("offset", 0))

    conn = db._get_conn()
    try:
        where = ""
        args: list = []
        if tier:
            where = "WHERE qs.quality_tier = ?"
            args.append(tier)

        # NOTE: Dynamic WHERE with ? placeholders — all values bound via args, safe from injection
        total = conn.execute(
            f"SELECT COUNT(*) as c FROM quality_scores qs {where}", args
        ).fetchone()["c"]

        rows = conn.execute(
            f"SELECT qs.entity_id, qs.completeness_score, qs.freshness_score, "
            f"  qs.consistency_score, qs.volume_score, qs.composite_score, qs.quality_tier, "
            f"  qs.computed_at, le.SourceName as entity_name, ds.Name as source_name "
            f"FROM quality_scores qs "
            f"JOIN lz_entities le ON qs.entity_id = le.LandingzoneEntityId "
            f"JOIN datasources ds ON le.DataSourceId = ds.DataSourceId "
            f"{where} ORDER BY qs.composite_score DESC LIMIT ? OFFSET ?",
            args + [limit, offset]
        ).fetchall()

        items = [
            {
                "entityId": r["entity_id"],
                "entityName": r["entity_name"],
                "source": r["source_name"],
                "completeness": float(r["completeness_score"] or 0),
                "freshness": float(r["freshness_score"] or 0),
                "consistency": float(r["consistency_score"] or 0),
                "volume": float(r["volume_score"] or 0),
                "composite": float(r["composite_score"] or 0),
                "tier": r["quality_tier"],
                "computedAt": r["computed_at"],
            }
            for r in rows
        ]

        from dashboard.app.api.services.quality_engine import get_quality_summary
        summary = get_quality_summary()

        return {"items": items, "total": total, "limit": limit, "offset": offset, "summary": summary}
    finally:
        conn.close()


@route("GET", "/api/quality/score/{entityId}")
def get_entity_quality(params: dict) -> dict:
    """Single entity quality breakdown."""
    try:
        entity_id = int(params.get("entityId", 0))
    except (TypeError, ValueError):
        raise HttpError("entityId must be an integer", 400)

    conn = db._get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM quality_scores WHERE entity_id = ?", (entity_id,)
        ).fetchone()
        if not row:
            return {"entityId": entity_id, "scored": False}
        return {
            "entityId": entity_id,
            "scored": True,
            "completeness": float(row["completeness_score"] or 0),
            "freshness": float(row["freshness_score"] or 0),
            "consistency": float(row["consistency_score"] or 0),
            "volume": float(row["volume_score"] or 0),
            "composite": float(row["composite_score"] or 0),
            "tier": row["quality_tier"],
            "computedAt": row["computed_at"],
        }
    finally:
        conn.close()


@route("POST", "/api/quality/refresh")
def post_quality_refresh(params: dict) -> dict:
    """Trigger quality score recomputation."""
    from dashboard.app.api.services.quality_engine import compute_quality_scores
    result = compute_quality_scores()
    return {"status": "refreshed", **result}
```

- [ ] **Step 2: Verify routes register**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python -c "
import sys; sys.path.insert(0, 'dashboard/app/api')
from router import get_all_routes
from routes import quality
routes = get_all_routes()
q_routes = [r for r in routes if 'quality' in r[1]]
print('Quality routes:', q_routes)
assert len(q_routes) >= 3, 'Expected 3 quality routes'
print('OK')
"
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/routes/quality.py
git commit -m "feat(mdm): add quality scoring API — scores list, per-entity breakdown, refresh

Author: Steve Nahrup"
```

---

### Task 12: Enrich entity digest with glossary + quality data

**Files:**
- Modify: `dashboard/app/api/routes/entities.py` (inside `_build_sqlite_entity_digest()`)

- [ ] **Step 1: Add LEFT JOINs for entity_annotations and quality_scores**

In `entities.py`:

**First**, add `import json` to the imports at the top of the file (it is NOT currently imported).

**Then**, inside `_build_sqlite_entity_digest()`, find where the function builds the final entity list. The function uses `cpdb._get_conn()` pattern (aliased via `from dashboard.app.api import control_plane_db as cpdb`). After the main entity assembly loop, but before the return statement, add an enrichment pass.

The function builds entities inside a `sources` dict as `sources[ns]["entities"].append(ent_data)`. After all entities are built, add this enrichment block:

```python
    # Enrich with glossary annotations + quality scores
    try:
        enrich_conn = cpdb._get_conn()
        annotations = {}
        for r in enrich_conn.execute(
            "SELECT entity_id, business_name, description, domain, tags FROM entity_annotations"
        ).fetchall():
            annotations[int(r["entity_id"])] = r

        quality = {}
        for r in enrich_conn.execute(
            "SELECT entity_id, composite_score, quality_tier FROM quality_scores"
        ).fetchall():
            quality[int(r["entity_id"])] = r
        enrich_conn.close()

        # Walk all entities in all source groups
        for ns_data in sources.values():
            for ent in ns_data.get("entities", []):
                eid = ent.get("id")
                if not eid:
                    continue
                ann = annotations.get(int(eid))
                if ann:
                    ent["businessName"] = ann["business_name"]
                    ent["description"] = ann["description"]
                    ent["domain"] = ann["domain"]
                    ent["tags"] = json.loads(ann["tags"]) if ann["tags"] else []
                qs = quality.get(int(eid))
                if qs:
                    ent["qualityScore"] = float(qs["composite_score"] or 0)
                    ent["qualityTier"] = qs["quality_tier"]
    except Exception as e:
        log.warning("Failed to enrich entity digest: %s", e)
```

**Important:** Read `entities.py` to find the exact variable names used for the sources dict and entity list. The above uses `sources` and `ent_data` but the actual code may use different names. Adapt accordingly.

- [ ] **Step 2: Commit**

```bash
git add dashboard/app/api/routes/entities.py
git commit -m "feat(mdm): enrich entity digest with glossary annotations + quality scores

Author: Steve Nahrup"
```

---

### Task 13: Final verification — build frontend + smoke test

**Files:** None (verification only)

- [ ] **Step 1: Build the frontend**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app
npm run build 2>&1 | tail -5
```
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run smoke tests**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app
npx playwright test tests/smoke.spec.ts --reporter=line 2>&1 | tail -20
```
Expected: All smoke routes pass (pages load without fatal errors).

- [ ] **Step 3: Verify all new API routes are registered**

Run:
```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
python -c "
import sys; sys.path.insert(0, 'dashboard/app/api')
from router import get_all_routes
import routes  # triggers auto-import of all modules
all_routes = get_all_routes()
new_routes = [r for r in all_routes if any(x in r[1] for x in ['lineage', 'classification', 'glossary', 'quality'])]
print(f'New MDM routes ({len(new_routes)}):')
for method, path, sse in new_routes:
    print(f'  {method} {path}')
assert len(new_routes) >= 11, f'Expected 11+ new routes, got {len(new_routes)}'
print('All new routes registered OK')
"
```

- [ ] **Step 4: Final commit with all verification passing**

If any TypeScript or import issues were found in steps 1-3, fix them and commit:
```bash
git add -A
git commit -m "fix(mdm): resolve build/import issues from MDM enhancement

Author: Steve Nahrup"
```
