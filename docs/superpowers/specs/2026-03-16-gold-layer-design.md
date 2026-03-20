# Gold Layer, Cleansing Rules & DQ Scorecard — Design Spec

> **Author:** Steve Nahrup
> **Date:** 2026-03-16
> **Branch:** `feat/server-refactor`
> **Status:** Approved — ready for implementation planning
> **Scope:** Gold layer management, cleansing rule editor, DQ scorecard
> **Jira:** MT-93 (parent epic)

---

## 1. Objective

Complete the medallion architecture by adding Gold layer management, cleansing rule editing, and a quality scorecard to the FMD dashboard. Gold layer models are created externally (Dataflow Gen2, Fabric notebooks, SQL views). FMD tracks them as metadata and provides management tooling.

### What this spec covers

1. **Gold Model Manager** — Register, track, and visualize domain-based star schemas in the Engineering UI
2. **Cleansing Rule Editor** — Define and manage JSON cleansing rules applied during Bronze → Silver transformation
3. **DQ Scorecard** — Quality scoring dashboard with trend tracking and tier distribution
4. **Business Portal integration** — Read-only Catalog page consuming Gold layer metadata (handoff to Business Portal agent)

### What this spec does NOT cover

- Actual Gold layer data creation (that's Dataflow Gen2 / notebooks / SQL)
- AI-assisted model building (noted as future vision in Section 10)
- Business Portal implementation (separate agent, handoff doc at `docs/handoffs/gold-layer-for-business-portal.md`)

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     External (Fabric)                            │
│  Dataflow Gen2 / Notebooks / SQL Views → Gold Lakehouse(s)      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Sync endpoint discovers
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SQLite (fmd_control_plane.db)                │
│                                                                  │
│  gold_domains ──┬── gold_models ──┬── gold_model_columns         │
│                 │                 └── gold_relationships          │
│                 │                                                 │
│  cleansing_rules (per Silver entity)                             │
│                                                                  │
│  quality_scores (extended) + quality_history (new)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌──────────────────────┐   ┌──────────────────────┐
│   Engineering UI     │   │   Business Portal    │
│   (full management)  │   │   (read-only Catalog)│
│                      │   │                      │
│   Gold Model Manager │   │   "Data Collections" │
│   Cleansing Rules    │   │   "Datasets"         │
│   DQ Scorecard       │   │   Quality indicators │
└──────────────────────┘   └──────────────────────┘
```

---

## 3. SQLite Schema

### 3.1 Gold Layer Tables (NEW)

```sql
-- Business domains (Sales Analytics, Production Analytics, etc.)
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

-- Individual tables/views within a domain
-- Note: API soft-deletes (status → deprecated), never hard-deletes.
-- No ON DELETE CASCADE — prevent accidental data loss.
CREATE TABLE IF NOT EXISTS gold_models (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id           INTEGER NOT NULL REFERENCES gold_domains(id),
    model_name          TEXT NOT NULL,
    model_type          TEXT CHECK(model_type IN ('fact','dimension','bridge','aggregate')),
    business_name       TEXT,
    description         TEXT,
    source_sql          TEXT,
    silver_dependencies TEXT,  -- JSON array of Silver entity IDs
    column_count        INTEGER DEFAULT 0,
    row_count_approx    INTEGER DEFAULT 0,
    last_refreshed      TEXT,
    status              TEXT DEFAULT 'draft' CHECK(status IN ('active','draft','deprecated')),
    created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(domain_id, model_name)
);

-- Column metadata for each model
CREATE TABLE IF NOT EXISTS gold_model_columns (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id        INTEGER NOT NULL REFERENCES gold_models(id),
    column_name     TEXT NOT NULL,
    data_type       TEXT,
    business_name   TEXT,
    description     TEXT,
    is_key          INTEGER DEFAULT 0,
    is_nullable     INTEGER DEFAULT 1,
    source_column   TEXT,  -- Silver lineage: "source.schema.table.column"
    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(model_id, column_name)
);

-- Relationships between models (for diagram rendering)
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

-- Indexes for Gold layer queries
CREATE INDEX IF NOT EXISTS idx_gold_models_domain ON gold_models(domain_id);
CREATE INDEX IF NOT EXISTS idx_gold_model_columns_model ON gold_model_columns(model_id);
CREATE INDEX IF NOT EXISTS idx_gold_relationships_domain ON gold_relationships(domain_id);
CREATE INDEX IF NOT EXISTS idx_gold_relationships_from ON gold_relationships(from_model_id);
CREATE INDEX IF NOT EXISTS idx_gold_relationships_to ON gold_relationships(to_model_id);
```

### 3.2 Cleansing Rules Table (NEW)

```sql
CREATE TABLE IF NOT EXISTS cleansing_rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id       INTEGER NOT NULL,  -- LandingzoneEntityId (universal cross-layer key used for LZ, Bronze, and Silver entities)
    column_name     TEXT NOT NULL,
    rule_type       TEXT NOT NULL CHECK(rule_type IN (
        'normalize_text', 'fill_nulls', 'parse_datetime', 'trim',
        'replace', 'regex', 'cast_type', 'map_values', 'clamp_range', 'deduplicate'
    )),
    parameters      TEXT DEFAULT '{}',  -- JSON parameters for the rule
    priority        INTEGER DEFAULT 0,  -- Execution order within an entity
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_cleansing_rules_entity ON cleansing_rules(entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cleansing_rules_dedup ON cleansing_rules(entity_id, column_name, rule_type);  -- prevents duplicate rules at DB level
```

### 3.3 Quality Schema Extensions

```sql
-- Add trend_7d and dimension_details to existing quality_scores CREATE TABLE statement
-- in control_plane_db.py _ensure_schema(). Do NOT use ALTER TABLE — SQLite throws
-- an error if the column already exists and there is no IF NOT EXISTS for ALTER TABLE.
-- Just add these columns directly to the CREATE TABLE IF NOT EXISTS block:
--   trend_7d        REAL DEFAULT 0.0,
--   dimension_details TEXT DEFAULT '{}'

-- New: quality score history for trend charts
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

-- Retention: quality_history rows older than 90 days should be pruned.
-- Add a cleanup call in compute_quality_scores() after inserting new rows:
-- DELETE FROM quality_history WHERE recorded_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-90 days');

CREATE INDEX IF NOT EXISTS idx_quality_history_entity_date ON quality_history(entity_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_quality_history_recorded ON quality_history(recorded_at);  -- for 90-day pruning
```

---

## 4. API Routes

### 4.1 Gold Layer — `dashboard/app/api/routes/gold.py`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/gold/domains` | List all domains (model_count and last_refreshed are computed via COUNT/MAX aggregation, not stored columns) |
| `POST` | `/api/gold/domains` | Create a domain |
| `GET` | `/api/gold/domains/:id` | Domain detail with all models |
| `PUT` | `/api/gold/domains/:id` | Update domain metadata |
| `DELETE` | `/api/gold/domains/:id` | Soft-delete (status → deprecated) |
| `GET` | `/api/gold/models?domain_id=` | List models, filterable by domain |
| `POST` | `/api/gold/models` | Register a model with columns + dependencies |
| `GET` | `/api/gold/models/:id` | Model detail with columns and relationships |
| `PUT` | `/api/gold/models/:id` | Update model metadata |
| `DELETE` | `/api/gold/models/:id` | Deprecate model |
| `GET` | `/api/gold/relationships?domain_id=` | All relationships for a domain |
| `POST` | `/api/gold/relationships` | Define a relationship |
| `DELETE` | `/api/gold/relationships/:id` | Remove a relationship |
| `POST` | `/api/gold/domains/:id/sync` | Discover tables from Gold lakehouse |

#### Sync Endpoint Detail

`POST /api/gold/domains/:id/sync` scans the Gold lakehouse for this domain:

1. Read the domain's `workspace_id` and `lakehouse_id`
2. Query the lakehouse's SQL Analytics Endpoint for `INFORMATION_SCHEMA.TABLES` and `INFORMATION_SCHEMA.COLUMNS`
3. For each table found:
   - If not in `gold_models` → insert as new model (status: draft)
   - If already in `gold_models` → update `column_count`, `row_count_approx`, `last_refreshed`
4. For each column found → upsert into `gold_model_columns`
5. Return summary: `{ new_models: N, updated_models: N, new_columns: N }`

**Note:** This requires Fabric SQL Analytics Endpoint access. If the lakehouse isn't accessible (no VPN, no SP token), the endpoint returns 503 with an explanation. Manual model registration via POST is the fallback.

### 4.2 Cleansing Rules — `dashboard/app/api/routes/cleansing.py`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/cleansing/rules?entity_id=` | Rules for a Silver entity |
| `POST` | `/api/cleansing/rules` | Create a rule |
| `PUT` | `/api/cleansing/rules/:id` | Update a rule |
| `DELETE` | `/api/cleansing/rules/:id` | Remove a rule |
| `GET` | `/api/cleansing/functions` | Available rule types + parameter schemas |
| `POST` | `/api/cleansing/rules/preview` | Dry-run before/after on sample data |
| `POST` | `/api/cleansing/rules/batch-copy` | Copy rules from one entity to all entities in same source |

#### Rule Types and Parameters

| Rule Type | Parameters | Example |
|-----------|-----------|---------|
| `normalize_text` | `{"case": "lower"\|"upper"\|"title"}` | Standardize casing |
| `fill_nulls` | `{"default": value}` | Replace NULLs |
| `parse_datetime` | `{"format": "YYYYMMDD"}` | Parse M3 int dates |
| `trim` | `{}` | Strip whitespace (critical for MES batch_id) |
| `replace` | `{"old": str, "new": str}` | String replacement |
| `regex` | `{"pattern": str, "replacement": str}` | Regex substitution |
| `cast_type` | `{"target_type": "int"\|"float"\|"string"\|"date"}` | Type coercion |
| `map_values` | `{"mapping": {"old1": "new1", ...}}` | Value remapping |
| `clamp_range` | `{"min": num, "max": num}` | Constrain numeric range |
| `deduplicate` | `{"key_columns": ["col1", "col2"]}` | Remove duplicate rows (entity-level rule, not column-level — `column_name` should be set to `'*'`) |

#### Preview Endpoint Detail

`POST /api/cleansing/rules/preview` accepts:
```json
{
  "entity_id": 123,
  "column_name": "MMITDS",
  "rule_type": "normalize_text",
  "parameters": {"case": "title"}
}
```

Returns 5 sample rows showing before/after values. Data source: queries distinct values from the entity's source database via the existing `data_access.py` `get_column_profile()` pattern (ODBC connection, `SELECT DISTINCT TOP 5`). If the source is unreachable (no VPN), returns 503. This is a lightweight query — 5 rows only. No Fabric query needed.

### 4.3 Quality Extensions — extend `dashboard/app/api/routes/quality.py`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/quality/scorecard` | Aggregated scorecard summary |
| `GET` | `/api/quality/history?entity_id=&days=30` | Score trend for one entity |
| `GET` | `/api/quality/history/aggregate?days=30` | System-wide trend |

#### Scorecard Response Shape

```json
{
  "average_composite": 78.4,
  "tier_distribution": {
    "gold": 342,
    "silver": 891,
    "bronze": 312,
    "unclassified": 121
  },
  "total_entities": 1666,
  "worst_performers": [
    {
      "entity_id": 456,
      "entity_name": "OOLINE",
      "source_name": "M3 ERP",  // JOIN datasources ON datasources.DatasourceId = entities.DatasourceId → datasources.Namespace
      "composite_score": 31.2,
      "quality_tier": "unclassified",
      "trend_7d": -8.5,
      "dimensions": {
        "completeness": 42.0,
        "freshness": 25.0,
        "consistency": 38.0,
        "volume": 20.0
      }
    }
  ],
  "biggest_drops": [
    {
      "entity_id": 456,
      "entity_name": "OOLINE",
      "composite_score": 31.2,
      "trend_7d": -8.5,
      "previous_tier": "silver",
      "current_tier": "unclassified"
    }
  ]
}
```

#### Quality History Recording

The `quality_engine.py` `compute_quality_scores()` function is extended:
1. After computing scores, insert a row into `quality_history` for each entity
2. Compute `trend_7d` by comparing current score to the score from 7 days ago in `quality_history`
3. Store `dimension_details` JSON with per-dimension breakdowns
4. Update `quality_scores.trend_7d` and `quality_scores.dimension_details`

---

## 5. Engineering UI — Gold Model Manager

**Route:** `/gold` (graduated from `/labs/gold-mlv`)
**File:** `dashboard/app/src/pages/GoldModelManager.tsx` (replaces `GoldMlvManager.tsx`)

### 5.1 Domain Grid (Default View)

- Cards for each domain
- Each card shows:
  - Domain name (font-display, 18px, semibold)
  - Description (text-muted, 13px)
  - Model count with type breakdown ("4 facts, 7 dimensions")
  - Workspace name (mono, 12px)
  - Last synced timestamp
  - Health indicator: green if all models active, amber if any draft/stale
- "Add Domain" button → modal: name, description, workspace picker, lakehouse name
- Click card → drills into Domain Detail

### 5.2 Domain Detail View

- **Header:** Domain name, description, workspace badge, "Sync Now" button, "Edit" button
- **Relationship Diagram** (centerpiece):
  - Uses `@xyflow/react` (already in project dependencies)
  - Models rendered as nodes, relationships as edges
  - Fact tables: wider nodes, copper left border
  - Dimension tables: standard nodes, muted border
  - Bridge tables: dashed border
  - Click node → shows column list in a tooltip/panel
  - Click edge → shows join definition (columns, cardinality)
  - Zoom, pan, fit-to-view controls
- **Models Table** below diagram:
  - Sortable columns: Name, Type (badge), Columns, Rows, Silver Dependencies (clickable links), Last Refreshed, Status (badge)
  - "Register Model" button → form for manual registration
  - "Define Relationship" button → pick two models, columns, cardinality

### 5.3 Model Detail Panel (Slide-out)

- Column list: column name, business name, data type, nullable badge, source lineage
- Source SQL viewer: read-only code block with syntax highlighting (if `source_sql` populated)
- Silver dependency list with links to Silver entity pages

---

## 6. Engineering UI — Cleansing Rule Editor

**Route:** `/cleansing` (graduated from `/labs/cleansing`)
**File:** `dashboard/app/src/pages/CleansingRuleEditor.tsx` (replaces stub)

### 6.1 Layout

- **Entity picker** at top: searchable dropdown filtered to Silver entities. Shows entity name + source name.
- Once entity selected → two-panel layout:

**Left Panel: Rule List**
- Ordered cards for each rule on this entity
- Each card shows: column name (mono), rule type (badge), parameter summary (truncated), active/inactive toggle
- Drag handles for reorder (changes priority)
- Click card → loads into editor panel
- Empty state: "No cleansing rules defined for this entity. Add one to get started."

**Right Panel: Rule Editor**
- Step 1: Pick column (dropdown from entity's column_metadata)
- Step 2: Pick rule type (dropdown with descriptions)
- Step 3: Parameter form (adapts based on rule_type — see Section 4.2)
- JSON preview at bottom (read-only, shows the raw rule definition)
- "Preview" button → calls `/api/cleansing/rules/preview`, shows before/after table
- "Save" button → POST or PUT

### 6.2 Batch Operations

- "Apply to all entities in source" button: calls `POST /api/cleansing/rules/batch-copy` with `{ source_entity_id, target_source_id }`
- Backend copies all rules from the source entity to every entity sharing the same `DatasourceId`, skipping entities that already have rules for the same column + rule_type
- Confirmation dialog shows how many entities will be affected (preflight: same POST endpoint with `?dry_run=true` query param — returns `{ affected_count: N }` without writing)

---

## 7. Engineering UI — DQ Scorecard

**Route:** `/quality` (graduated from `/labs/dq-scorecard`)
**File:** `dashboard/app/src/pages/DqScorecard.tsx` (replaces stub)

### 7.1 KPI Row

| KPI | Display | Color |
|-----|---------|-------|
| Average Composite Score | Big number (mono, 42px) with trend arrow | Green if > 80, amber if > 60, red if < 60 |
| Gold Tier Count | Badge with count | `--cl-success` |
| Silver Tier Count | Badge with count | `--cl-info` |
| Bronze Tier Count | Badge with count | `--cl-warning` |
| Unclassified Count | Badge with count | `--text-muted` |
| Score Drops (7d) | Alert count | `--cl-error` if > 0 |

### 7.2 Charts

**Tier Distribution** — Horizontal stacked bar or donut chart showing gold/silver/bronze/unclassified proportions. Uses Recharts (already in project). Colors match quality tier palette.

**System Trend** — Line chart showing average composite score over last 30 days from `/api/quality/history/aggregate`. Single line, area fill, green when above 80, transitions to amber/red.

### 7.3 Tables

**Worst Performers** (bottom 20 by composite score):

| Column | Source |
|--------|--------|
| Entity Name | entity_name |
| Source | source_name |
| Composite Score | composite_score (colored bar) |
| Completeness | completeness_score (mini bar) |
| Freshness | freshness_score (mini bar) |
| Consistency | consistency_score (mini bar) |
| Volume | volume_score (mini bar) |
| Tier | quality_tier (badge) |
| Trend | trend_7d (arrow + value) |

**Biggest Drops** (top 10 by negative trend_7d):

| Column | Source |
|--------|--------|
| Entity Name | entity_name |
| Previous Tier | (derived from history) |
| Current Tier | quality_tier |
| Score | composite_score |
| 7d Change | trend_7d (red, with arrow) |

### 7.4 Entity Detail Panel

Click any entity in either table → slide-out panel:
- 4-dimension radar/bar chart (completeness, freshness, consistency, volume)
- Column-level null rates (from column_metadata)
- Cleansing rule count + link to Cleansing Rule Editor for this entity
- Score history sparkline (last 30 days from quality_history)

---

## 8. Business Portal Integration

The Business Portal (built by a separate agent) consumes Gold layer data as read-only through the same API endpoints. See full handoff doc at `docs/handoffs/gold-layer-for-business-portal.md`.

**Terminology mapping summary:**

| Engineering | Business Portal |
|---|---|
| gold_domains | Data Collections |
| gold_models | Datasets |
| model_type | Hidden |
| model_name | Hidden (use business_name) |
| source_sql | Hidden |
| silver_dependencies | Hidden |
| last_refreshed | Last updated |
| column_count | Fields |
| row_count_approx | Records |
| status: deprecated | Hidden entirely |

The Catalog page in the Business Portal renders domain cards and dataset lists. Quality indicators appear as simple health badges (green/amber/red) derived from the composite score.

---

## 9. Navigation Changes

### Engineering UI (AppLayout.tsx)

Graduate all three pages from Labs to the Quality nav group:

| Page | Old Route | New Route | Nav Group |
|------|-----------|-----------|-----------|
| Gold Model Manager | `/labs/gold-mlv` (currently in Quality group) | `/gold` | Modeling (new group) |
| Cleansing Rule Editor | `/labs/cleansing` (currently in Quality group) | `/cleansing` | Quality |
| DQ Scorecard | `/labs/dq-scorecard` (currently in Quality group) | `/quality` | Quality |

Create a new "Modeling" nav group in `AppLayout.tsx` for Gold Model Manager. Update `App.tsx` route definitions. Keep old `/labs/*` routes as redirects for bookmarks.

### Business Portal

Add "Catalog" page (already in nav). No changes to Engineering sidebar needed for the Business Portal — it has its own navigation.

---

## 10. Future Vision: AI-Assisted Gold Model Builder

> **Status:** Noted for future implementation. Not in scope for this spec.

The ideal Gold layer experience uses natural language to generate star schemas:

1. User describes what they need: "I need a sales analysis model with order lines, customer info, and product details"
2. Claude Agent SDK generates optimal SQL using the IP Corp knowledge base (glossary, column metadata, source system context)
3. The system already knows that MMCFI4 is deprecated, that OBCONO maps to Customer Number, that Batch ID is the universal cross-system key
4. Result renders as a Power BI-style relationship diagram
5. User tweaks if needed, then one-click deploy creates the lakehouse views

**Why this approach is ideal:** It prevents duplicate one-off tables/reports. Each domain gets ONE canonical Gold model that has everything users need. They include/exclude tables or columns from the model, but the model itself is the single source of truth. Everyone uses the same terminology, column names, and descriptions.

**Prerequisites:** Claude API integration in the dashboard, schema-aware prompt engineering with the knowledge base, the visual relationship diagram component (built in this spec), and a deployment pipeline from SQL definition to lakehouse view.

---

## 11. IP Corp Domain Reference

Expected Gold layer domains based on the IP Corp knowledge base (`fabric_toolbox/knowledge/fabric-migration-strategy.md`):

### Sales Analytics
- **Fact tables:** FactOrderLines (OOLINE + OOHEAD), FactShipments, FactInvoices
- **Dimensions:** DimCustomer (OCUSMA), DimProduct (MITMAS), DimDate (already built), DimPlant
- **Sources:** M3 ERP primarily, Salesforce for CRM enrichment
- **Key joins:** OBORNO (order number), OBCUNO (customer number), OBITNO (item number)

### Production Analytics
- **Fact tables:** FactBatches (MES batch_hdr + batch_dtl), FactCycleTimes, FactQualityTests
- **Dimensions:** DimProduct (MITMAS), DimFormula (Optiva), DimVessel, DimShift, DimDate
- **Sources:** MES + M3 ERP + Optiva (cross-source)
- **Key joins:** Batch ID (universal key), item_id via mes_batch_order_xref_tbl
- **Critical:** MES data only exists for Interplastic and HK Research (not NAC, not Molding Products)

### Enterprise Core (Shared Dimensions)
- DimCustomer, DimProduct, DimPlant, DimDate
- Referenced by all other domains via shortcuts or foreign keys
- DimDate notebook already production-ready (`src/business_domain/NB_CREATE_DIMDATE.Notebook`)

### OT/Process Analytics (Future — Cybertrol coordination required)
- **Fact tables:** FactProcessParameters, FactGoldenBatch
- **Dimensions:** DimPlant, DimKettle, DimProduct, DimDate
- **Sources:** PLC tags, BatchWorks, FactoryTalk Batch, Rockwell Historian
- **Note:** Depends on Cybertrol initiative and tenant decision (see fabric-migration-strategy.md)

---

## 12. Design Constraints

- All UI follows the existing Claude Design System (OKLCH tokens, DM Sans/IBM Plex Mono, warm cream palette)
- Business Portal pages follow the Business Portal design system (Instrument Serif, Outfit, JetBrains Mono, copper/canvas palette)
- All new tables go in `control_plane_db.py` `_ensure_schema()` method
- All new routes use the `@route()` decorator pattern in `dashboard/app/api/routes/`
- SQL injection prevention: all user input goes through parameterized queries
- Relationship diagram uses `@xyflow/react` (already in `package.json`)
- Charts use Recharts (already in `package.json`)
- Must scale to N domains, N models — never hardcode the 3-4 known domains

---

## 13. Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `dashboard/app/api/routes/gold.py` | Gold layer domain/model/relationship CRUD + sync |
| `dashboard/app/api/routes/cleansing.py` | Cleansing rule CRUD + preview |
| `dashboard/app/src/pages/GoldModelManager.tsx` | Gold Model Manager (replaces stub) |
| `dashboard/app/src/pages/CleansingRuleEditor.tsx` | Cleansing Rule Editor (replaces stub) |
| `dashboard/app/src/pages/DqScorecard.tsx` | DQ Scorecard (replaces stub) |
| `dashboard/app/src/components/gold/RelationshipDiagram.tsx` | @xyflow/react relationship diagram |
| `dashboard/app/src/components/gold/DomainCard.tsx` | Domain card for grid view |
| `dashboard/app/src/components/gold/ModelDetailPanel.tsx` | Slide-out model detail |
| `dashboard/app/src/components/cleansing/RuleCard.tsx` | Draggable rule card |
| `dashboard/app/src/components/cleansing/RuleEditor.tsx` | Adaptive rule form |
| `dashboard/app/src/components/quality/TierDistribution.tsx` | Tier chart component |
| `dashboard/app/src/components/quality/ScoreTrend.tsx` | Trend line chart |
| `dashboard/app/src/hooks/useGoldDomains.ts` | Gold domain data hook |
| `dashboard/app/src/hooks/useCleansingRules.ts` | Cleansing rules data hook |
| `dashboard/app/src/hooks/useQualityScorecard.ts` | Scorecard data hook |

### Modified Files
| File | Change |
|------|--------|
| `dashboard/app/api/control_plane_db.py` | Add Gold + cleansing + quality_history tables to `_ensure_schema()` |
| `dashboard/app/api/services/quality_engine.py` | Extend `compute_quality_scores()` to write history + compute trends |
| `dashboard/app/api/routes/quality.py` | Add scorecard + history endpoints |
| `dashboard/app/api/routes/microscope.py` | Wire `cleansingRules` to real `cleansing_rules` table |
| `dashboard/app/src/App.tsx` | Update routes: `/gold`, `/cleansing`, `/quality` |
| `dashboard/app/src/components/layout/AppLayout.tsx` | Graduate pages from Labs, update nav |
