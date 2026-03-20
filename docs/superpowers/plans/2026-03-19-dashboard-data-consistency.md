# Dashboard Data Consistency — Single-Shot Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `entity_status` table with `engine_task_log`-derived status as the single source of truth for every dashboard page that shows entity load status or row counts.

**Architecture:** One new canonical query function in `control_plane_db.py` derives per-entity per-layer status from `engine_task_log` (75K+ real rows). The entity-digest endpoint switches to this function. All 8 affected pages automatically get correct data through the existing `useEntityDigest` hook. Three unredeemable pages are hidden from nav. Row counts use physical lakehouse scan only — never `RowsWritten` as a display total.

**Tech Stack:** Python (FastAPI backend), SQLite, React/TypeScript (Vite frontend)

---

## Root Cause Summary

| Problem | Root Cause | Impact |
|---------|-----------|--------|
| entity_status has 5,184 stale rows | Seeded by filesystem sync (`onelake-filesystem-sync`), never updated by engine (PascalCase `LandingZone` vs lowercase `landing` PK mismatch) | Every page using entity_digest shows wrong status |
| RowsWritten shown as table row count | `engine_task_log.RowsWritten` is rows-written-in-one-load (delta), not cumulative total | Load Center, Record Counts show nonsensical numbers |
| Physical scan failures | Silver Delta table scan fails for 99.9% of tables (returns -1) | Fallback to RowsWritten makes things worse |
| Orphan physical tables | 600+ Bronze tables not in registration (old test data) | Inflated table counts on physical-scan-based pages |

## Data Source Truth Table

| Data | Trustworthy Source | DO NOT USE |
|------|--------------------|------------|
| Entity load status (succeeded/failed/skipped) | `engine_task_log` (75K+ real rows, 2026-03-04 to present) | `entity_status` (stale seed data) |
| Last load timestamp | `engine_task_log.created_at` (per entity per layer) | `entity_status.LoadEndDateTime` |
| Row count per table | Physical lakehouse scan (`lakehouse_row_counts`) where >0 | `engine_task_log.RowsWritten` (per-load delta, NOT total) |
| Rows loaded in last run | `engine_task_log.RowsWritten` (labeled as "last load") | — |
| Entity registration | `lz_entities` + `bronze_entities` + `silver_entities` | — |

## Affected Pages (8 direct + 6 indirect via useEntityDigest)

### Direct consumers of entity_status or entity_digest:
1. **Execution Matrix** (`/matrix`) — shows "Never Run" for everything
2. **Load Center** (`/load-center`) — mismatched row counts across layers
3. **Record Counts** (`/record-counts`) — uses RowsWritten as row total
4. **Business Overview** (`/overview`) — freshness KPIs from entity_status
5. **Control Plane** (`/control`) — entity counts by layer
6. **Flow Explorer** (`/flow`) — entity status dots per layer
7. **Pipeline Matrix** (`/pipeline-matrix`) — loaded/registered/pending per source
8. **Overview entities** (`/api/overview/entities`) — entity list with status

### Indirect via `useEntityDigest` hook (auto-fixed when digest is fixed):
- Execution Matrix, Flow Explorer, Pipeline Matrix, Record Counts, Data Microscope, Data Catalog

### Pages to hide from nav (broken/redundant, routes kept alive):
- **Load Progress** (`/load-progress`) — duplicate of Load Center
- **Live Monitor** (`/live`) — depends on pipeline_audit (no data)
- **Validation Checklist** (`/validation`) — static checklist, no real data

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `dashboard/app/api/control_plane_db.py` | **Modify** | Add `get_canonical_entity_status()` — derives status from engine_task_log |
| `dashboard/app/api/routes/entities.py` | **Modify** | Switch `_build_sqlite_entity_digest()` from `entity_status` → canonical function |
| `dashboard/app/api/routes/overview.py` | **Modify** | Switch freshness/activity queries to engine_task_log |
| `dashboard/app/api/routes/monitoring.py` | **Modify** | Fix `lzProcessed`/`brzProcessed`/`slvProcessed` counts |
| `dashboard/app/api/routes/load_center.py` | **Modify** | Remove RowsWritten-as-row-count, use physical scan only |
| `dashboard/app/api/routes/control_plane.py` | **Modify** | Fix `_build_execution_matrix()` line 226 + summary counts to use canonical status |
| `dashboard/app/api/routes/data_access.py` | **Modify** | Deprecate `/api/entity-status/sync`, disable `sync_entity_status_from_filesystem()` |
| `dashboard/app/src/pages/RecordCounts.tsx` | **Modify** | Handle null row counts gracefully (show "—" not 0) |
| `dashboard/app/src/components/layout/AppLayout.tsx` | **Verify** | Confirm 3 pages already hidden from nav |
| `dashboard/app/api/tests/test_canonical_status.py` | **Create** | Tests for new canonical status function |

---

## Task 1: Build canonical entity status function

**Files:**
- Modify: `dashboard/app/api/control_plane_db.py` (near line 1659)
- Create: `dashboard/app/api/tests/test_canonical_status.py`

This is the foundation. One SQL query against `engine_task_log` that returns the same shape as `entity_status` so the digest builder can swap in with minimal changes.

**Important:** The test file goes in `dashboard/app/api/tests/` (not `dashboard/app/tests/`). Use the existing `temp_db` fixture pattern from `test_control_plane_db.py` — it overrides `cpdb.DB_PATH` directly.

- [ ] **Step 1: Write the failing test**

```python
# dashboard/app/api/tests/test_canonical_status.py
"""Tests for get_canonical_entity_status() — derives entity status from engine_task_log."""
import os
import sys
import pytest

# Match existing import pattern from test_control_plane_db.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import control_plane_db as cpdb


@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    """Override DB_PATH with a fresh temp file, init schema, restore afterwards."""
    db_path = tmp_path / 'test_canonical.db'
    original_path = cpdb.DB_PATH
    cpdb.DB_PATH = db_path
    cpdb.init_db()
    yield db_path
    cpdb.DB_PATH = original_path


def _seed_task_log(db_path):
    """Seed engine_task_log with test data."""
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        -- Entity 1: succeeded in all 3 layers
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-1', 1, 'landing', 'succeeded', 100, '2026-03-19T10:00:00Z');
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-1', 1, 'bronze', 'succeeded', 100, '2026-03-19T10:01:00Z');
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-1', 1, 'silver', 'succeeded', 100, '2026-03-19T10:02:00Z');

        -- Entity 2: landing succeeded, bronze failed, silver never ran
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-1', 2, 'landing', 'succeeded', 50, '2026-03-19T10:00:00Z');
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at, ErrorMessage)
        VALUES ('run-1', 2, 'bronze', 'failed', 0, '2026-03-19T10:01:00Z', 'timeout');

        -- Entity 3: skipped in landing (e.g. incremental with no changes)
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-2', 3, 'landing', 'skipped', 0, '2026-03-19T11:00:00Z');

        -- Entity 1: second run — succeeded again (should pick latest)
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-2', 1, 'landing', 'succeeded', 20, '2026-03-19T12:00:00Z');
    """)
    conn.close()


def test_canonical_status_returns_latest_per_entity_per_layer(temp_db):
    """Latest succeeded status should win over older entries."""
    _seed_task_log(temp_db)
    result = cpdb.get_canonical_entity_status()

    # Build lookup: (EntityId, Layer) -> row
    lookup = {(r["LandingzoneEntityId"], r["Layer"]): r for r in result}

    # Entity 1 landing: latest is run-2 (12:00)
    e1_lz = lookup[(1, "landing")]
    assert e1_lz["Status"] == "succeeded"
    assert e1_lz["LoadEndDateTime"] == "2026-03-19T12:00:00Z"

    # Entity 1 bronze: from run-1
    assert lookup[(1, "bronze")]["Status"] == "succeeded"

    # Entity 1 silver: from run-1
    assert lookup[(1, "silver")]["Status"] == "succeeded"

    # Entity 2 landing: succeeded
    assert lookup[(2, "landing")]["Status"] == "succeeded"

    # Entity 2 bronze: failed
    assert lookup[(2, "bronze")]["Status"] == "failed"
    assert lookup[(2, "bronze")]["ErrorMessage"] == "timeout"

    # Entity 2 silver: should NOT exist (never ran)
    assert (2, "silver") not in lookup

    # Entity 3 landing: skipped
    assert lookup[(3, "landing")]["Status"] == "skipped"


def test_canonical_status_prefers_success_over_old_failure(temp_db):
    """If entity failed then succeeded later, status should be succeeded."""
    import sqlite3
    conn = sqlite3.connect(str(temp_db))
    conn.executescript("""
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, created_at, ErrorMessage)
        VALUES ('run-1', 10, 'landing', 'failed', '2026-03-18T08:00:00Z', 'connection refused');
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsWritten, created_at)
        VALUES ('run-2', 10, 'landing', 'succeeded', 500, '2026-03-19T08:00:00Z');
    """)
    conn.close()

    result = cpdb.get_canonical_entity_status()
    lookup = {(r["LandingzoneEntityId"], r["Layer"]): r for r in result}
    assert lookup[(10, "landing")]["Status"] == "succeeded"
    assert lookup[(10, "landing")]["ErrorMessage"] is None  # success clears error
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/app/api && python -m pytest tests/test_canonical_status.py -v`
Expected: FAIL — `AttributeError: module 'control_plane_db' has no attribute 'get_canonical_entity_status'`

- [ ] **Step 3: Implement `get_canonical_entity_status()` in control_plane_db.py**

Add this function near the existing `get_entity_status_all()` (around line 1659):

```python
def get_canonical_entity_status() -> list[dict]:
    """Derive entity status from engine_task_log — the ONLY trustworthy source.

    Returns rows shaped like entity_status:
      {LandingzoneEntityId, Layer, Status, LoadEndDateTime, ErrorMessage, UpdatedBy}

    For each (EntityId, Layer) pair, picks the most recent row.
    Priority: succeeded > failed > skipped (within the same timestamp).
    """
    conn = _get_conn()
    try:
        rows = conn.execute("""
            WITH ranked AS (
                SELECT
                    EntityId       AS LandingzoneEntityId,
                    Layer,
                    Status,
                    created_at     AS LoadEndDateTime,
                    ErrorMessage,
                    'engine'       AS UpdatedBy,
                    ROW_NUMBER() OVER (
                        PARTITION BY EntityId, Layer
                        ORDER BY created_at DESC,
                                 CASE Status
                                     WHEN 'succeeded' THEN 1
                                     WHEN 'failed'    THEN 2
                                     WHEN 'skipped'   THEN 3
                                     ELSE 4
                                 END
                    ) AS rn
                FROM engine_task_log
            )
            SELECT LandingzoneEntityId, Layer, Status, LoadEndDateTime,
                   CASE WHEN Status = 'succeeded' THEN NULL ELSE ErrorMessage END AS ErrorMessage,
                   UpdatedBy
            FROM ranked
            WHERE rn = 1
        """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard/app/api && python -m pytest tests/test_canonical_status.py -v`
Expected: PASS (all 2 tests)

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/control_plane_db.py dashboard/app/api/tests/test_canonical_status.py
git commit -m "feat: add get_canonical_entity_status() deriving status from engine_task_log"
```

---

## Task 2: Switch entity-digest to canonical status

**Files:**
- Modify: `dashboard/app/api/routes/entities.py` (lines 78, 82-98)

The entity-digest endpoint is the single funnel that feeds 6+ pages via `useEntityDigest`. Fixing this one function fixes most of the dashboard.

- [ ] **Step 1: Replace entity_status with canonical status in digest builder**

In `_build_sqlite_entity_digest()` (line 78), change:

```python
# OLD (line 78):
    statuses = cpdb.get_entity_status_all()

# NEW:
    statuses = cpdb.get_canonical_entity_status()
```

- [ ] **Step 2: Normalize status values from engine_task_log**

The digest builder checks for `"loaded"` and `"complete"` as success statuses (lines 137-146), but engine_task_log uses `"succeeded"`. Add `"succeeded"` to the success checks. In `_build_sqlite_entity_digest()`, find and update these lines:

```python
# OLD (line 137):
        if all(s in ("loaded", "complete", "succeeded") for s in statuses_list):

# This line already includes "succeeded" — VERIFY the other checks too.
# Lines 186-191 also check these values — verify they include "succeeded".
```

The existing code at line 137 already handles "succeeded" — verify all status checks in the function accept "succeeded", "failed", "skipped" (the 3 values from engine_task_log). The existing code already does this — look at lines 96, 137, 139, 143, 186-191.

- [ ] **Step 3: Verify digest works end-to-end**

Run the dashboard backend and check the entity-digest response:

```bash
cd dashboard/app && python -c "
from api.routes.entities import _build_sqlite_entity_digest
d = _build_sqlite_entity_digest()
for src_name, src_data in d.get('sources', {}).items():
    ents = src_data.get('entities', [])
    statuses = {}
    for e in ents:
        o = e.get('overall', 'unknown')
        statuses[o] = statuses.get(o, 0) + 1
    print(f'{src_name}: {len(ents)} entities — {statuses}')
"
```

Expected: Should show realistic status distribution (mostly "complete" for entities that have loaded, "error" for failed ones) instead of the current "all not_started" or "all partial".

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/routes/entities.py
git commit -m "fix: entity-digest now derives status from engine_task_log instead of stale entity_status"
```

---

## Task 3: Fix overview endpoints (freshness, alerts, activity, source status)

**Files:**
- Modify: `dashboard/app/api/routes/overview.py` (lines 45-60, 74-86, 179-201, 251-272)

The overview endpoints query `entity_status` directly in 4 places. All must switch to `engine_task_log`. **Critical:** Preserve the `_SYSTEM_SOURCES` exclusion filter in every query.

- [ ] **Step 1: Fix `/api/overview/kpis` freshness query (lines 45-60)**

Replace the freshness query at lines 45-60 with:

```python
        # OLD: JOIN entity_status es ... WHERE es.Status = 'loaded'
        # NEW: JOIN engine_task_log for real succeeded timestamps
        freshness_row = conn.execute(
            """
            SELECT
                COUNT(DISTINCT e.LandingzoneEntityId) AS total,
                COUNT(DISTINCT CASE
                    WHEN t.Status = 'succeeded'
                         AND t.created_at >= datetime('now', '-24 hours')
                    THEN e.LandingzoneEntityId END) AS fresh
            FROM lz_entities e
            LEFT JOIN engine_task_log t ON t.EntityId = e.LandingzoneEntityId
            LEFT JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE e.IsActive = 1
              AND ds.Name NOT IN ({placeholders})
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchone()
```

- [ ] **Step 2: Fix `/api/overview/kpis` open alerts query (lines 74-86)**

Replace the error count query at lines 74-86 with:

```python
        # OLD: entity_status WHERE Status IN ('error', 'failed')
        # NEW: engine_task_log — count entities whose LATEST status is 'failed'
        error_row = conn.execute(
            """
            WITH latest AS (
                SELECT EntityId, Status,
                       ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
                FROM engine_task_log
            )
            SELECT COALESCE(COUNT(DISTINCT l.EntityId), 0) AS error_count
            FROM latest l
            JOIN lz_entities e ON l.EntityId = e.LandingzoneEntityId
            JOIN datasources ds ON e.DataSourceId = ds.DataSourceId
            WHERE l.rn = 1
              AND l.Status = 'failed'
              AND e.IsActive = 1
              AND ds.Name NOT IN ({placeholders})
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchone()
        open_alerts = error_row[0] if error_row else 0
```

- [ ] **Step 3: Fix `/api/overview/sources` endpoint (lines 179-201)**

Replace the source health query at lines 179-201 with:

```python
        rows = conn.execute(
            """
            WITH latest_status AS (
                SELECT EntityId, Status, created_at,
                       ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
                FROM engine_task_log
            )
            SELECT
                ds.DataSourceId,
                ds.Name,
                ds.DisplayName,
                ds.IsActive,
                COUNT(e.LandingzoneEntityId)                                          AS entity_count,
                SUM(CASE WHEN ls.Status = 'succeeded' THEN 1 ELSE 0 END)             AS loaded_count,
                SUM(CASE WHEN ls.Status = 'failed' THEN 1 ELSE 0 END)                AS error_count,
                MAX(CASE WHEN ls.Status = 'succeeded' THEN ls.created_at ELSE NULL END)
                                                                                       AS last_refreshed
            FROM datasources ds
            LEFT JOIN lz_entities  e  ON e.DataSourceId = ds.DataSourceId
                                       AND e.IsActive = 1
            LEFT JOIN latest_status ls ON ls.EntityId = e.LandingzoneEntityId AND ls.rn = 1
            WHERE ds.Name NOT IN ({placeholders})
            GROUP BY ds.DataSourceId
            HAVING entity_count > 0
            ORDER BY ds.DisplayName
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchall()
```

The Python processing code after this query (lines 203-228) stays identical — it already reads `loaded_count`, `error_count`, `entity_count`, `last_refreshed`.

- [ ] **Step 4: Fix `/api/overview/activity` endpoint (lines 251-272)**

Replace the activity query at lines 251-272 with:

```python
        rows = conn.execute(
            """
            SELECT
                CASE
                    WHEN e.SourceSchema IS NOT NULL AND e.SourceSchema != ''
                    THEN e.SourceSchema || '.' || e.SourceName
                    ELSE e.SourceName
                END AS entity_name,
                ds.Name             AS source,
                t.Layer             AS layer,
                t.Status            AS status,
                t.created_at        AS last_load_date
            FROM engine_task_log t
            JOIN lz_entities  e  ON t.EntityId = e.LandingzoneEntityId
            JOIN datasources  ds ON e.DataSourceId = ds.DataSourceId
            WHERE t.created_at IS NOT NULL
              AND ds.Name NOT IN ({placeholders})
            ORDER BY t.created_at DESC
            LIMIT 20
            """.format(placeholders=",".join("?" for _ in _SYSTEM_SOURCES)),
            tuple(_SYSTEM_SOURCES),
        ).fetchall()
```

Update the `_STATUS_MAP` below this query (line 277) to add engine_task_log values:

```python
        _STATUS_MAP = {
            "loaded": "success",
            "succeeded": "success",    # <-- ADD THIS
            "not_started": "pending",
            "skipped": "pending",      # <-- ADD THIS
            "error": "error",
            "failed": "error",
            "running": "running",
            "in_progress": "running",
            "": "pending",
        }
```

- [ ] **Step 5: Update the module docstring (lines 10-15)**

Change the schema comment to reflect the new data source:

```python
# OLD:
#     entity_status  — (LandingzoneEntityId, Layer[...], Status[...], LoadEndDateTime, ...)
# NEW:
#     engine_task_log — (EntityId, Layer['landing'|'bronze'|'silver'],
#                        Status['succeeded'|'failed'|'skipped'], created_at, ...)
```

- [ ] **Step 6: Verify overview endpoints return realistic data**

```bash
curl -s http://localhost:8787/api/overview/kpis | python -m json.tool
curl -s http://localhost:8787/api/overview/sources | python -m json.tool
curl -s http://localhost:8787/api/overview/activity | python -m json.tool
```

Expected: Freshness should show ~1,599 entities (those that have succeeded), not 0. Sources should show "operational" status with realistic entity counts. Activity should show recent real load events with "success"/"error" statuses.

- [ ] **Step 7: Commit**

```bash
git add dashboard/app/api/routes/overview.py
git commit -m "fix: overview endpoints use engine_task_log instead of stale entity_status"
```

---

## Task 4: Fix monitoring endpoint counts and entity lists

**Files:**
- Modify: `dashboard/app/api/routes/monitoring.py` (lines 99-139)

The `/api/live-monitor` endpoint has 3 places reading from `entity_status`:
1. Processed counts (lines 99-112)
2. Recently processed Bronze entities (lines 118-127)
3. Recently processed LZ entities (lines 130-139)

All must switch to `engine_task_log`.

- [ ] **Step 1: Replace processed count queries (lines 99-112)**

Replace the `status_rows` query and `status_map` logic (lines 99-111) with:

```python
        # Processed counts from engine_task_log (the ONLY trustworthy source)
        status_rows = _safe_query(
            "SELECT Layer, COUNT(DISTINCT EntityId) AS cnt FROM engine_task_log "
            "WHERE Status = 'succeeded' GROUP BY Layer"
        )
        status_map = {r["Layer"]: r["cnt"] for r in status_rows} if status_rows else {}

        result["counts"] = {
            "lzRegistered": lz_total[0]["cnt"] if lz_total else 0,
            "brzRegistered": brz_total[0]["cnt"] if brz_total else 0,
            "slvRegistered": slv_total[0]["cnt"] if slv_total else 0,
            "lzProcessed": status_map.get("landing", 0),
            "brzProcessed": status_map.get("bronze", 0),
            "slvProcessed": status_map.get("silver", 0),
        }
```

- [ ] **Step 2: Replace Bronze entities query (lines 118-127)**

Replace the `bronzeEntities` query with:

```python
    # Recently processed Bronze entities from engine_task_log
    result["bronzeEntities"] = _safe_query(
        "SELECT t.EntityId AS BronzeLayerEntityId, "
        "e.SourceSchema AS SchemaName, e.SourceName AS TableName, "
        "t.created_at AS InsertDateTime, "
        "CASE WHEN t.Status = 'succeeded' THEN 1 ELSE 0 END AS IsProcessed, "
        "t.created_at AS LoadEndDateTime "
        "FROM engine_task_log t "
        "JOIN lz_entities e ON e.LandingzoneEntityId = t.EntityId "
        "WHERE t.Layer = 'bronze' "
        "ORDER BY t.created_at DESC LIMIT 20"
    )
```

- [ ] **Step 3: Replace LZ entities query (lines 130-139)**

Replace the `lzEntities` query with:

```python
    # Recently processed LZ entities from engine_task_log
    result["lzEntities"] = _safe_query(
        "SELECT t.EntityId AS LandingzoneEntityId, "
        "e.FilePath, e.FileName, "
        "t.created_at AS InsertDateTime, "
        "CASE WHEN t.Status = 'succeeded' THEN 1 ELSE 0 END AS IsProcessed, "
        "t.created_at AS LoadEndDateTime "
        "FROM engine_task_log t "
        "JOIN lz_entities e ON e.LandingzoneEntityId = t.EntityId "
        "WHERE t.Layer = 'landing' "
        "ORDER BY t.created_at DESC LIMIT 20"
    )
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/routes/monitoring.py
git commit -m "fix: monitoring counts and entity lists use engine_task_log instead of entity_status"
```

---

## Task 5: Fix Load Center row count display

**Files:**
- Modify: `dashboard/app/api/routes/load_center.py` (lines 301-318, source-detail endpoint)
- Modify: `dashboard/app/src/pages/LoadCenter.tsx`

Load Center must NEVER display `RowsWritten` as a table's total row count. The RowsWritten fallback is at **lines 310-313** of `load_center.py` in the source-detail endpoint (not the status summary).

- [ ] **Step 1: Remove RowsWritten fallback at lines 310-313**

In the source-detail endpoint, find the per-entity per-layer loop (line 301+). The current code:

```python
# CURRENT (lines 308-313):
            if phys_rows is not None and phys_rows >= 0:
                entry[layer_key] = phys_rows
            elif log_entry:
                # No physical scan yet — show engine log as fallback
                # but mark it so frontend can distinguish
                entry[layer_key] = int(log_entry.get("RowsWritten") or 0)
```

Change to:

```python
# NEW: Physical scan only. No RowsWritten fallback for display counts.
            if phys_rows is not None and phys_rows >= 0:
                entry[layer_key] = phys_rows
            # If physical scan failed or not available, leave as None
            # The frontend shows "—" for null counts
```

Delete the `elif log_entry` block entirely (lines 310-313).

- [ ] **Step 2: Add separate `lastLoadRows` field**

After the layer loop (around line 318), add per-entity last-load metadata from `log_lookup`:

```python
            if log_entry and layer_key == "lz":
                entry["lastLoaded"] = log_entry.get("created_at")
                entry["lastLoadRows"] = int(log_entry.get("RowsWritten") or 0)
```

This makes `lastLoadRows` available as a separate field from the row count.

- [ ] **Step 3: Update LoadCenter.tsx labels**

In `LoadCenter.tsx`, if `lastLoadRows` is displayed anywhere, label it clearly as "Last Load" not "Rows":

```tsx
{entity.lastLoadRows != null && (
  <span className="text-xs text-[var(--bp-muted)]">
    {entity.lastLoadRows.toLocaleString()} rows in last load
  </span>
)}
```

For null row counts where physical scan failed, show "—":

```tsx
const fmtCount = (n: number | null | undefined) =>
  n != null && n >= 0 ? n.toLocaleString() : "—";
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/routes/load_center.py dashboard/app/src/pages/LoadCenter.tsx
git commit -m "fix: Load Center uses physical scan only for row counts, removes RowsWritten fallback"
```

---

## Task 6: Fix Record Counts page

**Files:**
- Modify: `dashboard/app/src/pages/RecordCounts.tsx`

**Note:** The `/api/lakehouse-counts` endpoint (data_access.py lines 819-852) reads from the `lakehouse_row_counts` SQLite cache table — it does NOT read `engine_task_log.RowsWritten` directly. The backend is already correct. The fix is frontend-only: handle `-1` (scan failed) and `null` counts gracefully instead of showing them as `0`.

- [ ] **Step 1: Read RecordCounts.tsx to understand current count display**

Read `dashboard/app/src/pages/RecordCounts.tsx` fully. Identify where row counts are displayed and how -1/null values are handled.

- [ ] **Step 2: Handle null/negative row counts in the frontend**

Add a display formatter that treats -1 and null as "unavailable":

```tsx
// Show "—" for unavailable counts instead of 0
const fmtCount = (n: number | null | undefined) =>
  n != null && n >= 0 ? n.toLocaleString() : "—";
```

Apply this formatter to all row count displays (LZ, Bronze, Silver columns).

- [ ] **Step 3: Fix match rate calculation to exclude unavailable counts**

Update the match rate ring to only include entities where both Bronze and Silver have real (non-negative) counts:

```tsx
// Only count entities where BOTH bronze and silver have real counts
const matchable = rows.filter(
  (e) => e.bronzeCount != null && e.bronzeCount >= 0
      && e.silverCount != null && e.silverCount >= 0
);
const matchRate = matchable.length > 0
  ? matchable.filter(e => e.bronzeCount === e.silverCount).length / matchable.length * 100
  : 0;
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/src/pages/RecordCounts.tsx
git commit -m "fix: Record Counts handles null/negative row counts gracefully"
```

---

## Task 7: Hide redundant pages from navigation

**Files:**
- Modify: `dashboard/app/src/components/layout/AppLayout.tsx` (lines 53-112)

Three pages are permanently hidden from the sidebar. Their routes remain alive (bookmarks still work) but they're removed from discovery.

- [ ] **Step 1: Verify pages to hide are NOT in current nav**

Check the current `CORE_GROUPS` array in `AppLayout.tsx` (lines 53-112). Based on earlier reading:
- `/load-progress` (Load Progress) — NOT in current nav ✓
- `/live` (Live Monitor) — NOT in current nav ✓
- `/validation` (Validation Checklist) — NOT in current nav ✓

These were already removed from nav in the earlier nav restructure. **If they're already hidden, this task is a no-op — skip to commit.**

- [ ] **Step 2: If any are still present, remove them**

Remove any `NavItem` entries for these paths from `CORE_GROUPS`.

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: verify LoadProgress, LiveMonitor, ValidationChecklist hidden from nav"
```

---

## Task 8: Fix Control Plane — execution matrix AND summary counts

**Files:**
- Modify: `dashboard/app/api/routes/control_plane.py` (line 226, and any summary count queries)

**CRITICAL:** This file contains `_build_execution_matrix()` (line 220) which is the backend for the Execution Matrix page — the most visibly broken page (shows "Never Run" for everything). Line 226 calls `cpdb.get_entity_status_all()` and builds the same kind of `status_map` as the entity-digest builder. This is the #1 fix in this task.

- [ ] **Step 1: Fix `_build_execution_matrix()` at line 226**

Change line 226 from `entity_status` to canonical status:

```python
# OLD (line 226):
    statuses = cpdb.get_entity_status_all()

# NEW:
    statuses = cpdb.get_canonical_entity_status()
```

The rest of `_build_execution_matrix()` (lines 230-249) already normalizes layer values and handles "succeeded"/"loaded"/"failed" — no other changes needed in this function.

- [ ] **Step 2: Check for any other entity_status references in control_plane.py**

Search for any other `entity_status` or `get_entity_status_all` references in the file. If the summary endpoint (around line 200) reads loaded counts from entity_status, fix those too:

```bash
grep -n "entity_status\|get_entity_status" dashboard/app/api/routes/control_plane.py
```

Fix any found references to use `engine_task_log` or `get_canonical_entity_status()`.

- [ ] **Step 3: Verify execution matrix returns real data**

```bash
curl -s http://localhost:8787/api/execution-matrix | python -c "
import json, sys
rows = json.load(sys.stdin)
statuses = {}
for r in rows:
    s = r.get('lzStatus', 'unknown')
    statuses[s] = statuses.get(s, 0) + 1
print(f'Total: {len(rows)} entities')
print(f'Status distribution: {statuses}')
"
```

Expected: ~1,666 entities, mostly with `lzStatus` = "succeeded" (not "not_started" or empty).

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/routes/control_plane.py
git commit -m "fix: execution matrix + control plane use canonical status from engine_task_log"
```

---

## Task 9: Deprecate entity_status table and sync function

**Files:**
- Modify: `dashboard/app/api/control_plane_db.py` (upsert_entity_status function)
- Modify: `dashboard/app/api/routes/data_access.py` (lines 180-293, line 883-887)

Now that nothing reads from `entity_status`, stop writing to it and mark it deprecated.

**Important:** `data_access.py` contains `sync_entity_status_from_filesystem()` (lines 180-293) which is a large function that scans OneLake and populates `entity_status`. This function was responsible for the 5,184 stale rows. It must be disabled to prevent re-populating stale data.

- [ ] **Step 1: Add deprecation comment to `upsert_entity_status` in control_plane_db.py**

```python
def upsert_entity_status(row: dict):
    """DEPRECATED: entity_status is no longer read by any endpoint.
    Status is now derived from engine_task_log via get_canonical_entity_status().
    This function is retained only for backward compatibility with the engine.
    """
    # ... existing code unchanged ...
```

- [ ] **Step 2: Disable `sync_entity_status_from_filesystem()` in data_access.py**

Replace the function body at lines 180-293 with a no-op:

```python
def sync_entity_status_from_filesystem() -> dict:
    """DEPRECATED: entity_status is no longer the source of truth.
    Status is now derived from engine_task_log via get_canonical_entity_status().
    This function is a no-op to prevent re-populating stale data.
    """
    return {
        "status": "deprecated",
        "message": "Entity status is now derived from engine_task_log. Filesystem sync disabled.",
        "synced": 0,
    }
```

- [ ] **Step 3: Disable the `/api/entity-status/sync` endpoint (line 883)**

Replace the endpoint handler at line 883-887:

```python
@route("POST", "/api/entity-status/sync")
def post_entity_status_sync(params: dict) -> dict:
    """Deprecated — entity status is now derived from engine_task_log."""
    return sync_entity_status_from_filesystem()  # returns deprecation notice
```

- [ ] **Step 4: Check if sync is called from a background thread**

Search for any background thread or startup code that calls `sync_entity_status_from_filesystem`:

```bash
grep -rn "sync_entity_status" dashboard/app/api/
```

If found in `server.py` startup or a background scheduler, comment it out with a deprecation note.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/control_plane_db.py dashboard/app/api/routes/data_access.py
git commit -m "chore: deprecate entity_status — filesystem sync disabled, status derived from engine_task_log"
```

**Rollback note:** The `entity_status` table is NOT dropped — it remains intact in case rollback is needed. To revert, restore the old `sync_entity_status_from_filesystem()` body and change `get_entity_status_all()` calls back in entities.py and control_plane.py.

---

## Task 10: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Start the dashboard**

```bash
cd dashboard/app && python api/server.py &
npm run dev &
```

- [ ] **Step 2: Verify entity-digest returns correct status**

```bash
curl -s http://localhost:8787/api/entity-digest | python -c "
import json, sys
d = json.load(sys.stdin)
for name, src in d.get('sources', {}).items():
    counts = src.get('statusCounts', {})
    total = len(src.get('entities', []))
    print(f'{name}: {total} entities — {counts}')
print(f'Total: {d.get(\"totalEntities\", 0)}')
"
```

Expected: ~1,666 entities, mostly "complete" status (1,595+ have succeeded across all 3 layers).

- [ ] **Step 3: Verify Execution Matrix shows real data**

Open `http://localhost:5173/matrix` in the browser. Check:
- Success rate should be ~96% (1,595 succeeded out of 1,666)
- Landing Zone should show ~1,599 succeeded
- Bronze should show ~1,595 succeeded
- Silver should show ~1,595 succeeded
- Per-entity rows should show "Succeeded" not "Never Run"

- [ ] **Step 4: Verify Load Center shows consistent counts**

Open `http://localhost:5173/load-center`. Check:
- Table counts should match between layers (same registered entities)
- Row counts should come from physical scan (may show "—" where scan fails)
- No RowsWritten masquerading as total row counts

- [ ] **Step 5: Verify Business Overview freshness**

Open `http://localhost:5173/overview`. Check:
- Freshness KPI should show realistic percentage
- Source cards should show online/operational status
- Activity feed should show recent real load events

- [ ] **Step 6: Verify Record Counts handles nulls**

Open `http://localhost:5173/record-counts`. Check:
- Match rate ring should only include entities with real counts
- "—" shown for tables where physical scan failed
- No random small numbers from RowsWritten

- [ ] **Step 7: Final verification complete**

No commit needed for verification — all changes were committed in Tasks 1-9. If any fixup was needed during verification, commit only the specific files changed.

---

## Status Mapping Reference

For anyone implementing this plan, here's the status value translation:

| Source | Success | Failure | No Data |
|--------|---------|---------|---------|
| `engine_task_log` | `succeeded` | `failed` | `skipped` |
| `entity_status` (OLD) | `loaded` | `error` / `failed` | `not_started` |
| Entity Digest (output) | `complete` | `error` | `not_started` |

The digest builder (entities.py lines 137-146) already maps all three systems — just make sure `"succeeded"` is in the success set (it already is at line 137).
