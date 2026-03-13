# MDM Enhancement Design Spec

**Date:** 2026-03-13
**Author:** calm-vault
**Branch:** feat/server-refactor
**Status:** Approved

## Overview

Five enhancements to make the Master Data Management pages (Data Profiler, Data Classification, Data Lineage, Business Glossary, Data Quality) functional with real data. Currently, the Data Profiler returns skeleton data, Classification shows all zeros, Lineage column-level 404s, and there's no glossary or quality scoring engine.

**Approach:** Lightweight libraries (`pip install`) + restored SQL logic + custom engines. No new infrastructure. All changes are backend Python + minor frontend wiring.

**New dependency:** `presidio-analyzer` + `spacy` (for PII detection in classification engine). Everything else is pure Python + SQL.

---

## 1. Data Profiler — Restore Rich Profiling

### Problem
`get_blender_profile()` in `dashboard/app/api/routes/data_access.py` (lines 715-750) returns raw `INFORMATION_SCHEMA.COLUMNS` with only `COLUMN_NAME`, `DATA_TYPE`, `IS_NULLABLE`, and a `COUNT(*)`. The frontend (`DataProfiler.tsx`) expects per-column statistics: `distinctCount`, `nullCount`, `nullPercentage`, `uniqueness`, `completeness`, `minValue`, `maxValue`, `maxLength`, `precision`, `scale`, `ordinal`.

### Solution
Restore the rich profiling logic from the old `server.py.bak` (worktree backup at `.claude/worktrees/agent-a8b5bfe2/dashboard/app/api/server.py` lines 1226-1337).

### Changes

**File:** `dashboard/app/api/routes/data_access.py`

Replace `get_blender_profile()` with restored logic:

1. Query `INFORMATION_SCHEMA.COLUMNS` with all fields:
   ```sql
   SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
          CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
          ORDINAL_POSITION
   FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = '{s}' AND TABLE_NAME = '{t}'
   ORDER BY ORDINAL_POSITION
   ```
   Where `s` and `t` are sanitized via `_sanitize()` (allows only `[a-zA-Z0-9-_ ]`).

2. Build per-column profiling query (limit to first 50 columns for performance, with `SELECT TOP 100000` row sampling for large tables):
   ```sql
   SELECT COUNT(*) AS _row_count,
     COUNT(DISTINCT [Col1]) AS [Col1__distinct],
     SUM(CASE WHEN [Col1] IS NULL THEN 1 ELSE 0 END) AS [Col1__nulls],
     MIN(CAST([Col1] AS NVARCHAR(200))) AS [Col1__min],
     MAX(CAST([Col1] AS NVARCHAR(200))) AS [Col1__max],
     -- ... repeated for each column
   FROM [schema].[table]
   ```

3. Compute derived metrics:
   - `nullPercentage = (nullCount / rowCount) * 100`
   - `uniqueness = (distinctCount / rowCount) * 100`
   - `completeness = 100 - nullPercentage`

4. Return response matching frontend `ProfileColumn` interface:
   ```json
   {
     "lakehouse": "LH_BRONZE_LAYER",
     "schema": "dbo",
     "table": "MITMAS",
     "rowCount": 3973,
     "columnCount": 45,
     "profiledColumns": 45,
     "columns": [
       {
         "name": "MMITNO",
         "dataType": "nvarchar",
         "nullable": true,
         "maxLength": 15,
         "precision": null,
         "scale": null,
         "ordinal": 1,
         "distinctCount": 3901,
         "nullCount": 0,
         "nullPercentage": 0.0,
         "minValue": "001-00001",
         "maxValue": "ZZZ-99999",
         "uniqueness": 98.19,
         "completeness": 100.0
       }
     ]
   }
   ```

**Adaption notes:**
- Use `_query_lakehouse()` (not old `query_lakehouse()`)
- Use `_sanitize()` for SQL injection prevention (existing function in data_access.py, allows only `[a-zA-Z0-9-_ ]`)
- Bracket-quote identifiers: `[{s}].[{t}]` matching existing code pattern
- MIN/MAX only for sortable types (int, bigint, decimal, float, date, datetime, varchar, nvarchar, char, nchar — skip binary, image, xml, geography, geometry)
- Handle empty tables gracefully (rowCount=0 → all percentages=0)
- Row sampling: use `SELECT TOP 100000` in the profiling query to prevent timeouts on large tables. Fabric SQL Analytics Endpoints are not optimized for full-table scans on multi-million-row tables
- Cache profiling results in `column_metadata` SQLite table for reuse by lineage/classification

### Frontend Changes
None. `DataProfiler.tsx` already expects this exact shape.

---

## 2. Data Classification — New Engine

### Problem
`useClassificationData()` in `DataClassification.tsx` is a mock function that returns all zeros. No backend classification exists. The frontend banner correctly states "Classification Engine Not Yet Active."

### Solution
Build a classification engine that:
1. Captures column schemas from all lakehouses
2. Runs pattern-based classification on column names
3. Runs Presidio PII detection on sampled string column values
4. Stores results in SQLite
5. Serves via new API endpoints

### New Files

#### `dashboard/app/api/services/classification_engine.py`

Core classification logic:

```python
# Pattern-based classification rules
COLUMN_PATTERNS = {
    "pii": [
        r"(?i)(ssn|social.?sec|tin|tax.?id)",
        r"(?i)(email|e.?mail)",
        r"(?i)(phone|mobile|cell|fax|tel)",
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
```

**Classification pipeline:**

1. **Schema capture** (`capture_column_schemas()`):
   - For each registered entity in SQLite (lz_entities, bronze_entities, silver_entities)
   - Query `INFORMATION_SCHEMA.COLUMNS` from the appropriate lakehouse
   - Store in `column_metadata` table

2. **Pattern classification** (`classify_by_pattern()`):
   - Match column names against `COLUMN_PATTERNS` regex rules
   - Assign highest-severity match (pii > restricted > confidential > internal > public)
   - Store with `classifiedBy: 'auto:pattern'`

3. **Presidio PII scan** (`classify_by_presidio()`):
   - For string columns (varchar, nvarchar, char, nchar, text)
   - Sample 100 rows from the lakehouse
   - Run `AnalyzerEngine().analyze()` on concatenated sample values
   - If PII entities detected (PERSON, EMAIL, PHONE, SSN, CREDIT_CARD, etc.), upgrade classification
   - Store with `classifiedBy: 'auto:presidio'`

4. **Results aggregation** (`get_classification_summary()`):
   - Count by sensitivity level, by source, by entity
   - Return `ClassificationSummary` shape matching `governance.ts` types

### New SQLite Tables

Add to `control_plane_db.py`:

```sql
CREATE TABLE IF NOT EXISTS column_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL,
    layer TEXT NOT NULL,           -- 'landing', 'bronze', 'silver'
    column_name TEXT NOT NULL,
    data_type TEXT,
    ordinal_position INTEGER,
    is_nullable INTEGER DEFAULT 1,
    max_length INTEGER,
    numeric_precision INTEGER,
    numeric_scale INTEGER,
    captured_at TEXT DEFAULT (datetime('now')),
    UNIQUE(entity_id, layer, column_name)
);

CREATE TABLE IF NOT EXISTS column_classifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL,
    layer TEXT NOT NULL,
    column_name TEXT NOT NULL,
    sensitivity_level TEXT NOT NULL DEFAULT 'public',
    certification_status TEXT NOT NULL DEFAULT 'none',  -- 'certified','pending','draft','deprecated','none'
    classified_by TEXT NOT NULL,    -- 'auto:pattern', 'auto:presidio', 'manual:steve'
    confidence REAL DEFAULT 1.0,
    pii_entities TEXT,              -- JSON array of detected PII types
    classified_at TEXT DEFAULT (datetime('now')),
    UNIQUE(entity_id, layer, column_name)
);
```

### New API Endpoints

Add to a new route module `dashboard/app/api/routes/classification.py`:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/classification/scan` | Trigger classification scan (runs in background `threading.Thread`, same pattern as `import_jobs` in source_manager.py) |
| `GET` | `/api/classification/data` | Paginated classification results with filters |
| `GET` | `/api/classification/summary` | Aggregated summary for KPIs and heatmap |
| `GET` | `/api/classification/status` | Scan job status (running/complete/idle) |

### Frontend Changes

**File:** `dashboard/app/src/pages/DataClassification.tsx`

- Replace `useClassificationData()` mock with `useSWR('/api/classification/summary')` or equivalent fetch
- Add "Run Scan" button that POSTs to `/api/classification/scan`
- Update banner: show scan status when running, show results when complete
- Keep the existing Entity View and Heatmap UI — they already render the right shape

### Dependencies

```
pip install presidio-analyzer
python -m spacy download en_core_web_sm
```

**Note:** Using `en_core_web_sm` (~12MB) for initial deployment. `en_core_web_lg` (~560MB) available for improved NER accuracy if needed later. Pattern-based classification works without spaCy entirely — Presidio PII scan is an optional enhancement layer.

### TypeScript Type Update

**File:** `dashboard/app/src/types/governance.ts` (line 13)

Extend `ClassifiedBy` to include Presidio variant:
```typescript
export type ClassifiedBy = `auto:pattern` | `auto:presidio` | `auto:claude` | `manual:${string}`;
```

The `/api/classification/summary` response must match `ClassificationSummary` from governance.ts:
```typescript
bySource: Array<{
  source: string;
  total: number;        // total columns for this source
  classified: number;   // columns with non-'public' classification
  piiCount: number;     // columns classified as 'pii'
  confidentialCount: number;  // columns classified as 'confidential'
}>
```
The frontend mock in `DataClassification.tsx` uses different field names (`entityCount`, `estimatedColumns`, `piiCandidates`) — these will be updated to match the governance.ts canonical shape when the mock is replaced.

---

## 3. Data Lineage Column-Level — New Endpoint

### Problem
`DataLineage.tsx` calls `GET /api/microscope/{entity.id}` for column-level schema across layers. This endpoint doesn't exist — the microscope routes use query params (`/api/microscope?entity=X&pk=Y`) for row-level inspection, not entity-level column schema.

### Solution
Add a new endpoint that returns column schemas per layer for an entity.

### New Endpoint

Add to a new route module `dashboard/app/api/routes/lineage.py`:

```
GET /api/lineage/columns/{entityId}
```

**Logic:**
1. Look up entity in SQLite: `lz_entities` → get `SourceSchema`, `SourceName`, `DataSourceId`
2. Resolve lakehouse names from `lakehouses` table (LZ, Bronze, Silver)
3. For each layer where entity has status='loaded' (from `entity_status`):
   - Query `INFORMATION_SCHEMA.COLUMNS` from that lakehouse
   - Return column names and data types
4. For "source" layer: use LZ columns as proxy (same schema)

**Response shape** (matches what `DataLineage.tsx` expects):
```json
{
  "source": {
    "columns": [
      {"name": "MMITNO", "dataType": "nvarchar", "isPrimaryKey": false},
      {"name": "MMITDS", "dataType": "nvarchar", "isPrimaryKey": false}
    ]
  },
  "landing": {
    "columns": [
      {"name": "MMITNO", "dataType": "nvarchar", "isPrimaryKey": false},
      {"name": "MMITDS", "dataType": "nvarchar", "isPrimaryKey": false}
    ]
  },
  "bronze": {
    "columns": [
      {"name": "MMITNO", "dataType": "nvarchar", "isPrimaryKey": false},
      {"name": "MMITDS", "dataType": "nvarchar", "isPrimaryKey": false},
      {"name": "HashedPKColumn", "dataType": "binary", "isPrimaryKey": false}
    ]
  },
  "silver": {
    "columns": [
      {"name": "MMITNO", "dataType": "nvarchar", "isPrimaryKey": false},
      {"name": "MMITDS", "dataType": "nvarchar", "isPrimaryKey": false},
      {"name": "HashedPKColumn", "dataType": "binary", "isPrimaryKey": false},
      {"name": "IsDeleted", "dataType": "bit", "isPrimaryKey": false},
      {"name": "IsCurrent", "dataType": "bit", "isPrimaryKey": false},
      {"name": "RecordStartDate", "dataType": "datetime2", "isPrimaryKey": false},
      {"name": "RecordEndDate", "dataType": "datetime2", "isPrimaryKey": false},
      {"name": "RecordModifiedDate", "dataType": "datetime2", "isPrimaryKey": false}
    ]
  }
}
```

### Frontend Changes

**File:** `dashboard/app/src/pages/DataLineage.tsx` (line 79)

Change:
```typescript
const res = await fetch(`/api/microscope/${entity.id}`, { signal: controller.signal });
```
To:
```typescript
const res = await fetch(`/api/lineage/columns/${entity.id}`, { signal: controller.signal });
```

### Caching Strategy
- Cache column schemas in `column_metadata` SQLite table (same table used by classification engine)
- Serve from cache if captured within last 24 hours
- Fall back to live lakehouse query if stale/missing

---

## 4. Business Glossary — Seed from IP Corp Knowledge Base

### Problem
Data Catalog has no descriptions, business names, or tags for entities. The IP Corp knowledge base at `fabric_toolbox/knowledge/` has comprehensive catalogs that aren't being used.

### Solution
Import IP Corp knowledge base into SQLite and serve via API. Match catalog entries to registered entities.

### New SQLite Tables

Add to `control_plane_db.py`:

```sql
CREATE TABLE IF NOT EXISTS business_glossary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term TEXT NOT NULL UNIQUE,
    definition TEXT NOT NULL,
    category TEXT,                  -- 'business', 'technical', 'system', 'identifier'
    related_systems TEXT,           -- JSON array
    synonyms TEXT,                  -- JSON array
    source TEXT,                    -- 'ip-corp-glossary', 'ip-corp-m3-catalog', 'manual'
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entity_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL,
    business_name TEXT,             -- Human-readable name (e.g., "Item Master" for MITMAS)
    description TEXT,               -- Business context
    domain TEXT,                    -- 'manufacturing', 'sales', 'quality', 'finance', etc.
    tags TEXT,                      -- JSON array of tag strings
    source TEXT,                    -- 'ip-corp-m3-catalog', 'ip-corp-mes-catalog', 'manual'
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(entity_id)
);
```

### Seed Script

**New file:** `scripts/seed_glossary.py`

**Source:** IP Corp knowledge base lives in a sibling project at `~/CascadeProjects/fabric_toolbox/knowledge/` (NOT inside this repo). The seed script reads from there at runtime via absolute path resolved from `KNOWLEDGE_BASE_PATH` env var or defaults to `~/CascadeProjects/fabric_toolbox/knowledge`.

Imports from (all paths relative to the knowledge base root):
1. `entities/glossary.json` → 6 business terms → `business_glossary`
2. `entities/systems.json` → 28 system entries → `business_glossary` (category='system')
3. `entities/identifiers.json` → cross-system keys → `business_glossary` (category='identifier')
4. `agents/m3-analyst/m3-table-catalog.json` → 3,949 M3 table descriptions → `entity_annotations` (matched by table name to `lz_entities.SourceName`)
5. `agents/mes-analyst/mes-table-catalog.json` → MES table descriptions → `entity_annotations`

**Note:** Some knowledge base files are Markdown (e.g., `knowledge-docs/08-Business-Glossary.md`). The seed script should parse both JSON and Markdown formats. JSON files are preferred where they exist; Markdown files are parsed with simple regex extraction for terms/definitions.

**Matching logic:**
- Normalize table names (strip schema prefix, case-insensitive)
- Match `m3-table-catalog` entries to entities where `source` = M3 ERP / M3 Cloud
- Match `mes-table-catalog` entries to entities where `source` = MES
- Mark unmatched entities as `domain: 'unknown'` for manual curation

### New API Endpoints

Add to a new route module `dashboard/app/api/routes/glossary.py`:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/glossary` | Paginated glossary with `?q=search&category=X` |
| `GET` | `/api/glossary/entity/{entityId}` | Annotations + related terms for an entity |
| `POST` | `/api/glossary/seed` | Re-run seed script (idempotent) |

### Frontend Changes

**File:** `dashboard/app/src/pages/DataCatalog.tsx`

- In the entity detail modal, fetch `/api/glossary/entity/{id}` to populate:
  - `description` field
  - `businessName` field
  - `tags` array
  - Related glossary terms

### Integration with Data Catalog

The `CatalogEntity` type in `governance.ts` already has `description`, `businessName`, `tags`, and `owners` fields. The entity digest endpoint (`/api/entity-digest`) should be enriched to LEFT JOIN `entity_annotations` so the catalog can display business context inline without extra API calls.

---

## 5. Data Quality Scoring — Computed from Existing Data

### Problem
DQ Scorecard and quality-related pages have no scoring engine. Quality tier is always "unclassified".

### Solution
Compute quality scores from data we already have — no new libraries needed.

### Quality Dimensions

| Dimension | Weight | Source | Calculation |
|-----------|--------|--------|-------------|
| **Completeness** | 40% | Profiler data OR column_metadata | Avg completeness across profiled columns. If no profiler data exists for an entity, default to 75 (neutral score) to avoid penalizing unvisited entities |
| **Freshness** | 25% | `entity_status.LoadEndDateTime` | Hours since last load → 100 if <24h, decays linearly to 0 at 7 days |
| **Consistency** | 20% | `entity_status` | % of expected layers loaded (LZ+Bronze+Silver = 3 layers) |
| **Volume** | 15% | `engine_task_log.RowsRead` | 100 if latest load rows > 0, 50 if rows == 0, 0 if failed |

**Composite score:** `completeness*0.4 + freshness*0.25 + consistency*0.2 + volume*0.15`

**Quality tier mapping:**
- Gold: >= 90
- Silver: >= 70
- Bronze: >= 50
- Unclassified: < 50

### New SQLite Table

```sql
CREATE TABLE IF NOT EXISTS quality_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL,
    completeness_score REAL,
    freshness_score REAL,
    consistency_score REAL,
    volume_score REAL,
    composite_score REAL,
    quality_tier TEXT,             -- 'gold', 'silver', 'bronze', 'unclassified'
    computed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(entity_id)
);
```

### New Module

**File:** `dashboard/app/api/services/quality_engine.py`

- `compute_quality_scores()` — iterates all entities, computes 4 dimensions + composite
- `get_quality_summary()` — aggregated stats for dashboard KPIs
- Runs on-demand via API or on a 1-hour background timer

### New API Endpoints

Add to a new route module `dashboard/app/api/routes/quality.py`:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/quality/scores` | All entity quality scores with filters |
| `GET` | `/api/quality/score/{entityId}` | Single entity breakdown |
| `POST` | `/api/quality/refresh` | Trigger recomputation |

### Frontend Integration
- Entity digest enriched with `qualityTier` from `quality_scores` table
- DQ Scorecard page wired to `/api/quality/scores`
- Data Catalog entity modal shows quality tier badge

---

## File Inventory

### New Files
| File | Purpose |
|------|---------|
| `dashboard/app/api/services/__init__.py` | Package init for new services directory |
| `dashboard/app/api/services/classification_engine.py` | Presidio + pattern-based column classification |
| `dashboard/app/api/services/quality_engine.py` | Quality score computation |
| `dashboard/app/api/routes/classification.py` | Classification API endpoints |
| `dashboard/app/api/routes/lineage.py` | Column lineage API endpoint |
| `dashboard/app/api/routes/glossary.py` | Business glossary API endpoints |
| `dashboard/app/api/routes/quality.py` | Quality scoring API endpoints |
| `scripts/seed_glossary.py` | Import IP Corp knowledge base into SQLite |

### Modified Files
| File | Change |
|------|--------|
| `dashboard/app/api/routes/data_access.py` | Restore rich profiling in `get_blender_profile()` |
| `dashboard/app/api/control_plane_db.py` | Add 5 new tables (column_metadata, column_classifications, business_glossary, entity_annotations, quality_scores) |
| `dashboard/app/api/routes/entities.py` | Enrich entity digest with glossary + quality data |
| `dashboard/app/src/pages/DataClassification.tsx` | Replace mock with real API call |
| `dashboard/app/src/pages/DataLineage.tsx` | Update fetch URL to `/api/lineage/columns/{id}` |
| `dashboard/app/src/pages/DataCatalog.tsx` | Fetch glossary annotations in detail modal |

### Dependencies
```
# requirements.txt additions
presidio-analyzer>=2.2.0
spacy>=3.7.0
# Post-install: python -m spacy download en_core_web_sm
```

---

## Execution Order

1. **Capability 1: Data Profiler fix** (no dependencies, highest impact, unblocks quality scoring)
2. **Capability 3: Data Lineage column-level** (no dependencies, small change)
3. **Infrastructure: SQLite schema additions + services directory** (prerequisite for steps 4-6)
4. **Capability 4: Business Glossary seeding** (needs schema from step 3)
5. **Capability 2: Data Classification engine** (needs schema + column_metadata from step 3)
6. **Capability 5: Data Quality scoring** (needs profiler working from step 1 + schema from step 3)

Steps 1 and 2 can run in parallel. Steps 4, 5, 6 can run in parallel after step 3.

**Note:** Route auto-discovery is handled by `dashboard/app/api/routes/__init__.py` which uses `pkgutil.iter_modules()` — new route modules in that directory are automatically imported at startup. No explicit registration needed.

---

## Out of Scope (Future Phases)

- **sqlglot column-level lineage** — requires captured transformation SQL (Phase 2)
- **DataProfiler ML classification** — heavier TensorFlow-based classifier (Phase 3)
- **Claude via Foundry AI classification** — mentioned in existing banner (Phase 3)
- **Great Expectations** — per-entity custom expectation rules (Phase 2)
- **OpenMetadata integration** — full catalog platform if needed at scale (Phase 4)
- **Data stewardship workflows** — ownership assignment, approval chains (Phase 3)
