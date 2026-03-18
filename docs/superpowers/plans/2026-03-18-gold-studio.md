# Gold Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete Gold Studio feature — 19 database tables, 57 API endpoints, 5 frontend pages, 6 parsers, the Provenance Thread component, and sidebar navigation — as specified in `docs/superpowers/specs/2026-03-18-gold-studio-design.md`.

**Architecture:** SQLite tables (gs_* prefix) in the existing `fmd_control_plane.db`. Python API routes using the existing `@route` decorator pattern in `dashboard/app/api/routes/`. React/TypeScript frontend pages using the existing Business Portal design system (Instrument Serif, Outfit, JetBrains Mono; copper/gold/stone palette). All parsers in a new `dashboard/app/api/parsers/` module.

**Tech Stack:** Python 3.11+ (FastAPI-style routes via custom router), SQLite WAL, React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, @xyflow/react (relationship map), lucide-react (icons).

**Spec reference:** `docs/superpowers/specs/2026-03-18-gold-studio-design.md` (1,582 lines)

---

## File Structure

### Backend (Python)

| File | Purpose | Status |
|------|---------|--------|
| `dashboard/app/api/control_plane_db.py` | Add 19 gs_* tables to `init_db()` | Modify |
| `dashboard/app/api/routes/gold_studio.py` | All 57 Gold Studio API endpoints | Create |
| `dashboard/app/api/parsers/__init__.py` | Parser package init | Create |
| `dashboard/app/api/parsers/base.py` | ExtractionResult dataclass + base parser | Create |
| `dashboard/app/api/parsers/sql_parser.py` | SQL file/paste parser (FROM/JOIN extraction) | Create |
| `dashboard/app/api/parsers/rdl_parser.py` | RDL/RDLC XML parser (defusedxml) | Create |
| `dashboard/app/api/parsers/bim_parser.py` | BIM Tabular Model JSON parser | Create |
| `dashboard/app/api/parsers/pbix_parser.py` | PBIX ZIP archive parser | Create |
| `dashboard/app/api/parsers/pbip_parser.py` | PBIP/TMDL project parser | Create |
| `dashboard/app/api/parsers/schema_discovery.py` | Source DB schema resolution | Create |

### Frontend (TypeScript/React)

| File | Purpose | Status |
|------|---------|--------|
| `dashboard/app/src/components/gold/ProvenanceThread.tsx` | 7-phase dot connector component | Create |
| `dashboard/app/src/components/gold/GoldStudioLayout.tsx` | Shared layout with sub-nav tab strip | Create |
| `dashboard/app/src/components/gold/SpecimenCard.tsx` | Ledger specimen row with accordion | Create |
| `dashboard/app/src/components/gold/ClusterCard.tsx` | Cluster card with members + overlap | Create |
| `dashboard/app/src/components/gold/ColumnReconciliation.tsx` | Column decision matrix slide-over | Create |
| `dashboard/app/src/components/gold/SlideOver.tsx` | Shared slide-over panel component | Create |
| `dashboard/app/src/components/gold/StatsStrip.tsx` | Hero numbers strip component | Create |
| `dashboard/app/src/pages/gold/GoldLedger.tsx` | Ledger page (home base) | Create |
| `dashboard/app/src/pages/gold/GoldClusters.tsx` | Clusters page | Create |
| `dashboard/app/src/pages/gold/GoldCanonical.tsx` | Canonical modeling page | Create |
| `dashboard/app/src/pages/gold/GoldSpecs.tsx` | Specifications page | Create |
| `dashboard/app/src/pages/gold/GoldValidation.tsx` | Validation & catalog page | Create |
| `dashboard/app/src/App.tsx` | Add /gold/* routes | Modify |
| `dashboard/app/src/components/layout/AppLayout.tsx` | Add Gold Studio sidebar group | Modify |

### Storage

| Path | Purpose |
|------|---------|
| `dashboard/app/api/data/gold-studio/specimens/` | Uploaded artifacts + extraction output |

---

## Task Breakdown

### Task 1: Database Schema — 19 gs_* tables

**Files:**
- Modify: `dashboard/app/api/control_plane_db.py`

This is the foundation. All 19 tables from spec Section 10, with CHECK constraints, partial unique indexes, and JSON validation.

- [ ] **Step 1: Add all 19 gs_* table CREATE statements to init_db()**

Add after the existing tables in `init_db()`. Tables in order:
1. `gs_specimens` — imported artifacts
2. `gs_jobs` — async job tracking
3. `gs_specimen_queries` — extracted queries
4. `gs_extracted_entities` — parsed entities
5. `gs_extracted_columns` — column catalog
6. `gs_extracted_relationships` — joins/FKs
7. `gs_source_bindings` — connection mappings
8. `gs_extracted_measures` — DAX/M/SQL measures
9. `gs_schema_discovery` — resolved schemas
10. `gs_clusters` — duplicate detection groups
11. `gs_cluster_column_decisions` — reconciliation state
12. `gs_canonical_entities` — approved business entities (versioned)
13. `gs_canonical_columns` — approved column set per version
14. `gs_semantic_definitions` — measures/KPIs associated with canonical entities
15. `gs_gold_specs` — MLV designs (versioned)
16. `gs_validation_runs` — validation run results
17. `gs_catalog_entries` — published governance metadata (versioned)
18. `gs_audit_log` — append-only audit trail
19. `gs_report_field_usage` — visual-level field references

All SQL is specified in spec Section 10 "Database Schema (19 Tables)". Copy verbatim with `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. Add the 3 partial unique indexes for versioned tables.

- [ ] **Step 2: Add storage directory creation**

In `init_db()`, after table creation, add:
```python
(Path(__file__).parent / 'data' / 'gold-studio' / 'specimens').mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 3: Verify tables created**

```bash
cd dashboard/app && python -c "from api.control_plane_db import init_db; init_db(); print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/control_plane_db.py
git commit -m "feat(gold-studio): add 19 gs_* database tables

All Gold Studio tables per spec Section 10. Includes CHECK
constraints, partial unique indexes for versioned tables,
JSON validation, and audit log index.

Author: Steve Nahrup"
```

---

### Task 2: Parser Framework + SQL Parser

**Files:**
- Create: `dashboard/app/api/parsers/__init__.py`
- Create: `dashboard/app/api/parsers/base.py`
- Create: `dashboard/app/api/parsers/sql_parser.py`

The parser framework defines the normalized output contract. SQL parser is simplest — start here.

- [ ] **Step 1: Create parsers package with base dataclasses**

`dashboard/app/api/parsers/__init__.py`:
```python
"""Gold Studio artifact parsers."""
```

`dashboard/app/api/parsers/base.py`:
```python
"""Base parser types and ExtractionResult contract."""
from dataclasses import dataclass, field

@dataclass
class ExtractedTable:
    name: str
    schema_name: str | None = None
    source_database: str | None = None
    source_system: str | None = None
    entity_kind: str = "physical"  # physical|view|calculated|semantic_output|unknown
    columns: list["ExtractedColumn"] = field(default_factory=list)

@dataclass
class ExtractedColumn:
    column_name: str
    data_type: str | None = None
    nullable: bool = True
    is_key: bool = False
    source_expression: str | None = None
    is_calculated: bool = False
    ordinal: int | None = None

@dataclass
class ExtractedQuery:
    query_name: str | None = None
    query_text: str = ""
    query_type: str = "native_sql"  # native_sql|m_query|dax|stored_proc
    source_database: str | None = None
    parameters: list[str] | None = None

@dataclass
class ExtractedMeasure:
    measure_name: str
    expression: str
    expression_type: str = "dax"  # dax|m|sql
    description: str | None = None
    source_table: str | None = None

@dataclass
class ExtractedRelationship:
    from_entity: str
    from_column: str
    to_entity: str
    to_column: str
    join_type: str | None = None
    cardinality: str | None = None
    detected_from: str = "query_parse"  # query_parse|model_metadata|manual

@dataclass
class DataSourceRef:
    source_name: str
    source_type: str | None = None  # sql_db|lakehouse|warehouse|semantic_model|other
    database_name: str | None = None
    schema_name: str | None = None

@dataclass
class ExtractionResult:
    tables: list[ExtractedTable] = field(default_factory=list)
    columns: list[ExtractedColumn] = field(default_factory=list)
    queries: list[ExtractedQuery] = field(default_factory=list)
    measures: list[ExtractedMeasure] = field(default_factory=list)
    relationships: list[ExtractedRelationship] = field(default_factory=list)
    data_source_refs: list[DataSourceRef] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
```

- [ ] **Step 2: Create SQL parser**

`dashboard/app/api/parsers/sql_parser.py` — Parses raw SQL to extract table references (FROM/JOIN), column names from SELECT, and relationships from JOINs. Uses regex-based static analysis only — SQL is NEVER executed. See spec Section 5 parser security requirements.

Key behavior:
- Extract table references from FROM and JOIN clauses
- Extract column names from SELECT (handling aliases)
- Detect JOIN relationships (columns, types)
- Handle multi-statement SQL, CTEs, subqueries (best-effort)
- Return ExtractionResult

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/parsers/
git commit -m "feat(gold-studio): parser framework + SQL parser

ExtractionResult dataclass contract and SQL parser with
FROM/JOIN/SELECT extraction. Static analysis only, no execution.

Author: Steve Nahrup"
```

---

### Task 3: RDL, BIM, PBIX, PBIP Parsers

**Files:**
- Create: `dashboard/app/api/parsers/rdl_parser.py`
- Create: `dashboard/app/api/parsers/bim_parser.py`
- Create: `dashboard/app/api/parsers/pbix_parser.py`
- Create: `dashboard/app/api/parsers/pbip_parser.py`
- Create: `dashboard/app/api/parsers/schema_discovery.py`

These can be built in parallel (independent). Each returns ExtractionResult.

- [ ] **Step 1: RDL parser** — Uses defusedxml (or stdlib with DTD disabled). Parses `<DataSets>`, `<CommandText>`, `<Fields>`, `<DataSources>`. Extracts queries, tables, columns, data source refs. Max file size 200MB.

- [ ] **Step 2: BIM parser** — Parses Tabular Model JSON (model.bim). Extracts tables, columns, measures, relationships, partitions with storage mode. Max 50MB, depth limit 100 levels. HTML-escape all field values.

- [ ] **Step 3: PBIX parser** — ZIP archive extraction with bomb protection (max 500MB decompressed, max 10k entries, max 3 nesting levels). Extracts DataModelSchema JSON, then delegates to BIM-style parsing.

- [ ] **Step 4: PBIP parser** — TMDL file reader + model.bim fallback. Path traversal protection (resolve all paths, reject symlinks, validate within upload boundary).

- [ ] **Step 5: Schema discovery module** — Stub that defines the interface for source DB metadata resolution. Methods: `sp_describe_first_result_set`, `catalog_query`, `top0_introspection`. Actual DB connections require VPN — this is a skeleton with the right interfaces that gracefully degrades when connections aren't available.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/api/parsers/
git commit -m "feat(gold-studio): RDL, BIM, PBIX, PBIP parsers + schema discovery

All 5 artifact parsers with security mitigations per spec:
XXE protection (RDL), ZIP bomb protection (PBIX), path
traversal protection (PBIP), depth limits (BIM).

Author: Steve Nahrup"
```

---

### Task 4: Gold Studio API Routes — Specimens, Entities, Jobs

**Files:**
- Create: `dashboard/app/api/routes/gold_studio.py`

The main API route file. Start with specimen CRUD, entity queries, and job tracking. Uses the `@route` decorator from `dashboard.app.api.router`.

- [ ] **Step 1: Create route file with specimen endpoints**

Endpoints (spec Section 10 "API Routes"):
- `POST /api/gold-studio/specimens` — create specimen (metadata only, file upload separate)
- `GET /api/gold-studio/specimens` — list with filters (division, type, steward, job_state)
- `GET /api/gold-studio/specimens/{id}` — detail + extracted entities + queries
- `PUT /api/gold-studio/specimens/{id}` — update metadata
- `DELETE /api/gold-studio/specimens/{id}` — soft delete
- `POST /api/gold-studio/specimens/{id}/extract` — trigger extraction (background thread)
- `GET /api/gold-studio/specimens/{id}/queries` — list extracted queries
- `POST /api/gold-studio/specimens/bulk` — bulk import

All endpoints follow the existing pattern:
```python
from dashboard.app.api.router import route, HttpError
import dashboard.app.api.control_plane_db as cpdb

@route("GET", "/api/gold-studio/specimens")
def gs_list_specimens(params: dict) -> dict:
    ...
```

- [ ] **Step 2: Add extracted entity endpoints**

- `GET /api/gold-studio/entities` — list all (filters: specimen_id, cluster_id, provenance, source_system, division)
- `GET /api/gold-studio/entities/{id}` — detail + columns + relationships + schema
- `GET /api/gold-studio/entities/{id}/columns` — column catalog
- `GET /api/gold-studio/entities/{id}/schema` — schema discovery results
- `POST /api/gold-studio/entities/{id}/discover-schema` — trigger schema discovery

- [ ] **Step 3: Add job tracking endpoints**

- `GET /api/gold-studio/jobs/{id}` — job status + results
- `GET /api/gold-studio/jobs` — list recent jobs

- [ ] **Step 4: Add stats endpoint**

- `GET /api/gold-studio/stats` — all stats for all pages in single response (30s cache)

- [ ] **Step 5: Add audit log endpoint**

- `GET /api/gold-studio/audit/log` — filtered audit log (object_type, object_id, action, date_range). Requires pagination.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/api/routes/gold_studio.py
git commit -m "feat(gold-studio): specimen, entity, job, stats, audit API endpoints

20 endpoints for specimen CRUD, entity queries, job tracking,
aggregate stats, and audit log. Auto-registered via route decorator.

Author: Steve Nahrup"
```

---

### Task 5: Gold Studio API Routes — Clusters, Canonical, Specs, Validation, Catalog

**Files:**
- Modify: `dashboard/app/api/routes/gold_studio.py`

Continue adding the remaining endpoint groups.

- [ ] **Step 1: Add cluster endpoints**

- `GET /api/gold-studio/clusters` — list (filters: status, confidence_min, division)
- `GET /api/gold-studio/clusters/{id}` — detail + members + column reconciliation
- `PUT /api/gold-studio/clusters/{id}` — update (label, status, notes)
- `POST /api/gold-studio/clusters/{id}/resolve` — resolve (approve/split/merge/dismiss)
- `GET /api/gold-studio/clusters/{id}/column-decisions` — column reconciliation state
- `PUT /api/gold-studio/clusters/{id}/column-decisions` — update column decisions
- `POST /api/gold-studio/clusters/detect` — run duplicate detection
- `GET /api/gold-studio/clusters/unclustered` — entities not in any cluster

- [ ] **Step 2: Add canonical entity endpoints**

- `GET /api/gold-studio/canonical` — list (filters: domain, type, status)
- `GET /api/gold-studio/canonical/{id}` — detail + columns + relationships + lineage
- `POST /api/gold-studio/canonical` — create from cluster or standalone
- `PUT /api/gold-studio/canonical/{id}` — update (new version if material change)
- `POST /api/gold-studio/canonical/{id}/approve` — set Approved
- `POST /api/gold-studio/canonical/{id}/generate-spec` — generate Gold spec
- `GET /api/gold-studio/canonical/{id}/versions` — version history
- `GET /api/gold-studio/canonical/domains` — distinct domains with counts
- `GET /api/gold-studio/canonical/relationships` — all cross-entity relationships

- [ ] **Step 3: Add semantic definition endpoints**

- `GET /api/gold-studio/semantic` — list for canonical entity
- `POST /api/gold-studio/semantic` — create
- `PUT /api/gold-studio/semantic/{id}` — update
- `DELETE /api/gold-studio/semantic/{id}` — soft delete

- [ ] **Step 4: Add Gold spec endpoints**

- `GET /api/gold-studio/specs` — list (filters: domain, status)
- `GET /api/gold-studio/specs/{id}` — detail
- `PUT /api/gold-studio/specs/{id}` — update (triggers needs_revalidation)
- `PUT /api/gold-studio/specs/{id}/sql` — update source SQL
- `GET /api/gold-studio/specs/{id}/versions` — version history
- `GET /api/gold-studio/specs/{id}/impact` — downstream impact

- [ ] **Step 5: Add validation endpoints**

- `POST /api/gold-studio/validation/specs/{id}/validate` — run validation
- `GET /api/gold-studio/validation/specs/{id}/runs` — run history
- `GET /api/gold-studio/validation/runs/{id}` — single run detail
- `POST /api/gold-studio/validation/runs/{id}/waiver` — file exception
- `GET /api/gold-studio/validation/specs/{id}/reconciliation` — legacy vs Gold

- [ ] **Step 6: Add catalog endpoints**

- `POST /api/gold-studio/catalog/specs/{id}/publish` — publish to catalog
- `GET /api/gold-studio/catalog` — list published entries
- `GET /api/gold-studio/catalog/{id}` — entry detail
- `PUT /api/gold-studio/catalog/{id}` — update metadata (new version)
- `GET /api/gold-studio/catalog/{id}/versions` — version history

- [ ] **Step 7: Add field usage endpoints**

- `GET /api/gold-studio/field-usage` — field usage (specimen_id, entity_id, column_name filters)

- [ ] **Step 8: Commit**

```bash
git add dashboard/app/api/routes/gold_studio.py
git commit -m "feat(gold-studio): complete API — clusters, canonical, specs, validation, catalog

37 additional endpoints completing all 57 Gold Studio API routes.
Includes cluster resolution, canonical approval with versioning,
spec generation, validation with waiver model, catalog publication.

Author: Steve Nahrup"
```

---

### Task 6: Shared Gold Studio Components

**Files:**
- Create: `dashboard/app/src/components/gold/ProvenanceThread.tsx`
- Create: `dashboard/app/src/components/gold/GoldStudioLayout.tsx`
- Create: `dashboard/app/src/components/gold/StatsStrip.tsx`
- Create: `dashboard/app/src/components/gold/SlideOver.tsx`

The reusable components used across all 5 Gold Studio pages.

- [ ] **Step 1: ProvenanceThread component**

The signature UI element. A horizontal series of 7 dots connected by thin lines. Props:
```typescript
interface ProvenanceThreadProps {
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7
  size?: 'sm' | 'md'  // sm for table cells, md for detail headers
}
```

Visual encoding per spec Section 2:
- Filled copper = phase completed
- Pulsing copper = current phase (CSS animation)
- Empty = future phase
- Filled gold = terminal state (all 7 = cataloged)
- 7 dots, 6px diameter, 1px connecting lines, ~160px total width
- Labels: Imported, Extracted, Clustered, Canonicalized, Gold Drafted, Validated, Cataloged
- Labels use JetBrains Mono 10px with 0.03em tracking

- [ ] **Step 2: GoldStudioLayout component**

Shared layout wrapper for all Gold Studio pages:
- Title bar: "GOLD STUDIO" in Instrument Serif + optional division selector
- Horizontal tab strip: Ledger | Clusters | Canonical | Specifications | Validation
- Active tab gets 2px copper underline
- Children slot for page content
- Tab strip is sticky on scroll

```typescript
interface GoldStudioLayoutProps {
  activeTab: 'ledger' | 'clusters' | 'canonical' | 'specs' | 'validation'
  children: React.ReactNode
  actions?: React.ReactNode  // right-aligned action buttons (e.g. Import)
}
```

- [ ] **Step 3: StatsStrip component**

Hero numbers strip. Each stat is clickable (acts as filter shortcut).

```typescript
interface StatItem {
  label: string
  value: number | string
  onClick?: () => void
}
interface StatsStripProps {
  items: StatItem[]
}
```

Uses Instrument Serif 32px for numbers, Outfit 11px small-caps for labels. Sticky on scroll.

- [ ] **Step 4: SlideOver component**

Reusable panel that slides in from the right:
- Default 70% viewport width, expandable to 88-92%
- Full-screen mode for SQL editor
- Fixed header (name, version, type badge, provenance, status, actions)
- Tab strip for content sections
- Scrollable content area
- Fixed footer with contextual action
- Dismiss: click outside, Escape, X button
- Backdrop: `rgba(0,0,0,0.3)`

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/src/components/gold/
git commit -m "feat(gold-studio): shared components — ProvenanceThread, layout, stats, slide-over

Four reusable components used across all Gold Studio pages.
ProvenanceThread is the signature 7-phase dot connector.

Author: Steve Nahrup"
```

---

### Task 7: Ledger Page (`/gold/ledger`)

**Files:**
- Create: `dashboard/app/src/pages/gold/GoldLedger.tsx`
- Create: `dashboard/app/src/components/gold/SpecimenCard.tsx`

The home base — permanent registry of every artifact imported and every entity extracted.

- [ ] **Step 1: SpecimenCard component**

Two-line card rows on `#FEFDFB` surface with `rgba(0,0,0,0.08)` border:
- Line 1: Name + type badge (RDL/PBIX/etc) + source system + steward + ProvenanceThread
- Line 2: Summary counts + job state badge
- 3px left status rail (copper/green/gold/stone per spec)
- Accordion expansion on click → inner tabs (Tables | Queries | Measures | Relationships)
- Tables tab: table name, source DB, cols, joins to, cluster badge, provenance thread
- Queries tab: syntax-highlighted SQL in JetBrains Mono (dark `#2B2A27` block)

- [ ] **Step 2: GoldLedger page**

Sections per spec Section 4:
- StatsStrip: Specimens, Tables Extracted, Columns Cataloged, Unresolved Clusters, Canonical Approved, Gold Specs, Certification Rate
- View toggle: "By Specimen" (default) / "By Extracted Entity"
- Search: specimen name, table name, column name, query text, source DB
- Filters: Division, Type, Steward, Source System, Job State, Provenance State
- Import button dropdown: Upload File | Paste SQL | Bulk Import
- Import modals (Upload File, Paste SQL, Bulk Import) per spec Section 4

Data fetching:
- `GET /api/gold-studio/stats` → stats strip
- `GET /api/gold-studio/specimens?...` → specimen list
- `GET /api/gold-studio/entities?...` → entity list (By Entity view)

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/src/pages/gold/ dashboard/app/src/components/gold/SpecimenCard.tsx
git commit -m "feat(gold-studio): Ledger page with specimen cards, import modals, dual view

Home base page with By Specimen and By Entity views, import
flow (Upload/Paste/Bulk), search, filters, accordion expansion.

Author: Steve Nahrup"
```

---

### Task 8: Clusters Page (`/gold/clusters`)

**Files:**
- Create: `dashboard/app/src/pages/gold/GoldClusters.tsx`
- Create: `dashboard/app/src/components/gold/ClusterCard.tsx`
- Create: `dashboard/app/src/components/gold/ColumnReconciliation.tsx`

- [ ] **Step 1: ClusterCard component**

Full-width cards per spec Section 6:
- Header: cluster ID, dominant name, user-editable label, confidence %, status
- Members table: entity name, source specimen, column count, match type
- Column overlap bar (filled copper bar showing shared/union %)
- Unique columns text line
- Confidence breakdown: `Name +40 · Columns +30 · Query +17 · Cross-source -5 = 82%`
- Actions: Confirm Grouping | Split ▼ | Merge With... | Dismiss
- Status rail: copper (unresolved), green (resolved), gold (promoted)

- [ ] **Step 2: ColumnReconciliation slide-over**

Opens when "Confirm Grouping" is clicked. Matrix per spec Section 6:
- Rows: column name, data type, presence indicators (✓/—) per member, decision dropdown
- Decision options: Include (PK/BK/FK/None), Exclude, Review
- Auto-defaults: all members → Include, one member → Review
- Cannot approve until all Review resolved
- Source expression expand on row click
- Bulk include/exclude via checkboxes

- [ ] **Step 3: GoldClusters page**

- StatsStrip: Total Clusters, Unresolved, Resolved, Avg Confidence, Not Clustered
- Cluster cards list with filters (Status, Confidence, Division, Source System)
- Unclustered entities tab with "Promote to Canonical" action
- Search by cluster label, entity name, column name

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/src/pages/gold/GoldClusters.tsx dashboard/app/src/components/gold/ClusterCard.tsx dashboard/app/src/components/gold/ColumnReconciliation.tsx
git commit -m "feat(gold-studio): Clusters page with cards, reconciliation, resolution actions

Cluster detection review with confidence breakdown, column
reconciliation matrix, and resolution workflow (approve/split/merge/dismiss).

Author: Steve Nahrup"
```

---

### Task 9: Canonical Modeling Page (`/gold/canonical`)

**Files:**
- Create: `dashboard/app/src/pages/gold/GoldCanonical.tsx`

- [ ] **Step 1: Domain Grid View (default)**

Per spec Section 7:
- StatsStrip: Canonical Entities, Dimensions, Facts, Bridges, Approved, Draft, Pending Steward
- Grouped by business domain with collapsible sections
- Rows: Entity, Type badge (Fact/Dim/Bridge/Ref), Grain, Columns, Status, ProvenanceThread
- Type badges: Fact (copper bg), Dimension (muted), Bridge (blue-tinted), Reference (stone)
- Status badges: ✓ Approved (green), ◌ Draft (copper), ⚠ Pending Steward (amber), ✗ Deprecated (muted)

- [ ] **Step 2: Relationship Map View**

@xyflow/react diagram:
- Fact nodes: wider, 2px copper border
- Dimension nodes: standard, 1px muted border
- Edge labels: cardinality
- Domain filter at top
- Read-only in v1 — click node opens detail slide-over

- [ ] **Step 3: Detail slide-over**

Tabs: Definition | Columns | Lineage | Relationships | Measures | Cluster History | Phase History
- Definition: business description, grain, steward, domain, status, version
- Columns: name, type, nullable, key designation, source expression, classification, description
- Lineage: compact diagram (Specimens → Extracted → Cluster → Canonical)
- Relationships: declared FKs with cardinality (editable)
- Measures: from gs_semantic_definitions

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/src/pages/gold/GoldCanonical.tsx
git commit -m "feat(gold-studio): Canonical modeling page with domain grid + relationship map

Domain-grouped entity grid, @xyflow/react relationship diagram,
detail slide-over with 7 content tabs, approval workflow.

Author: Steve Nahrup"
```

---

### Task 10: Specifications Page (`/gold/specs`)

**Files:**
- Create: `dashboard/app/src/pages/gold/GoldSpecs.tsx`

- [ ] **Step 1: Spec table and page**

Per spec Section 8:
- StatsStrip: Gold Specs, Ready to Deploy, Pending Validation, Needs Revalidation, Deprecated
- Two-line rows: spec name, type badge, domain, sources, validation status, provenance thread
- Line 2: version, column count, refresh strategy
- Validation badges: ✓ Pass (green), ◌ Pending (amber), ✗ Failed (red), ↻ Needs Reval (copper)

- [ ] **Step 2: Spec detail slide-over**

Tabs: Overview | SQL | Columns | Transforms | Impact | History
- SQL tab: dark inset code block (`#2B2A27`), syntax highlighting, copy, full-screen expand
- Warning banner: "Editing SQL will mark this spec as Needs Revalidation"
- Impact tab: downstream reports, affected semantic models, affected Gold specs
- History tab: version history + validation run history

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/src/pages/gold/GoldSpecs.tsx
git commit -m "feat(gold-studio): Specifications page with spec table + detail slide-over

Gold layer MLV designs with SQL editor, column mapping,
impact analysis, and revalidation tracking.

Author: Steve Nahrup"
```

---

### Task 11: Validation & Catalog Page (`/gold/validation`)

**Files:**
- Create: `dashboard/app/src/pages/gold/GoldValidation.tsx`

- [ ] **Step 1: Validation Status tab**

Per spec Section 9:
- StatsStrip: Validated, Cataloged, Pending Validation, Failed, Reconciliation Warnings
- All specs with latest validation run results
- Sorted: failed first, then waiver, then pending, then passed
- Columns: Spec, Status, Critical rules (fraction), Warnings, Last Run
- Waiver model: reason, approver, timestamp, review date

- [ ] **Step 2: Catalog Registry tab**

- All published Gold assets with governance metadata
- Endorsement badges: None (muted), Promoted (copper), Certified (green)
- Required fields form for publication: Display Name, Technical Name, Business Description, Grain, Domain, Owner, Steward, Source Systems, Sensitivity Label, Endorsement
- "Publish to Catalog" action with field validation

- [ ] **Step 3: Reconciliation log**

For high-value facts: Legacy vs Gold comparison table:
- Metrics: Total rows, Revenue, Distinct customers, etc.
- Delta and status (✓ Within tolerance / ⚠ Review)

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/src/pages/gold/GoldValidation.tsx
git commit -m "feat(gold-studio): Validation & Catalog page with runs, waivers, publication

Validation runs with waiver model, reconciliation log,
and catalog publication with governance metadata.

Author: Steve Nahrup"
```

---

### Task 12: Navigation Wiring — Routes + Sidebar

**Files:**
- Modify: `dashboard/app/src/App.tsx`
- Modify: `dashboard/app/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Add Gold Studio routes to App.tsx**

Add after the Governance pages section:
```tsx
{/* Gold Studio pages */}
<Route path="/gold" element={<Navigate to="/gold/ledger" replace />} />
<Route path="/gold/ledger" element={<GoldLedger />} />
<Route path="/gold/clusters" element={<GoldClusters />} />
<Route path="/gold/canonical" element={<GoldCanonical />} />
<Route path="/gold/specs" element={<GoldSpecs />} />
<Route path="/gold/validation" element={<GoldValidation />} />
```

Add lazy imports at top:
```tsx
const GoldLedger = lazy(() => import('@/pages/gold/GoldLedger'))
const GoldClusters = lazy(() => import('@/pages/gold/GoldClusters'))
const GoldCanonical = lazy(() => import('@/pages/gold/GoldCanonical'))
const GoldSpecs = lazy(() => import('@/pages/gold/GoldSpecs'))
const GoldValidation = lazy(() => import('@/pages/gold/GoldValidation'))
```

Wrap in Suspense.

- [ ] **Step 2: Add Gold Studio sidebar group to AppLayout.tsx**

Add to CORE_GROUPS array between "Explore" and "Quality" (per spec Section 3):
```typescript
{
  label: "Gold Studio",
  items: [
    { icon: Crown, label: "Ledger", href: "/gold/ledger" },
    { icon: Layers, label: "Clusters", href: "/gold/clusters" },
    { icon: Gem, label: "Canonical", href: "/gold/canonical" },
    { icon: FileCode, label: "Specifications", href: "/gold/specs" },
    { icon: ShieldCheck, label: "Validation", href: "/gold/validation" },
  ],
},
```

Import new icons: `Layers, Gem, FileCode, ShieldCheck` from lucide-react.

Remove old "Gold MLV Manager" entry from Quality group.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/src/App.tsx dashboard/app/src/components/layout/AppLayout.tsx
git commit -m "feat(gold-studio): wire routes + sidebar navigation

5 Gold Studio routes, lazy-loaded pages, sidebar group between
Explore and Quality. Old Gold MLV Manager entry removed.

Author: Steve Nahrup"
```

---

### Task 13: Build Verification & TypeScript Check

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript compilation check**

```bash
cd dashboard/app && npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Run Vite build**

```bash
cd dashboard/app && npm run build
```

Fix any build errors.

- [ ] **Step 3: Verify Python imports**

```bash
cd dashboard/app && python -c "
from api.control_plane_db import init_db
from api.routes import gold_studio
from api.parsers import sql_parser, rdl_parser, bim_parser, pbix_parser, pbip_parser
print(f'Routes registered: {len([r for r in gold_studio.__dict__ if not r.startswith(\"_\")])}'  )
print('All imports OK')
"
```

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(gold-studio): resolve build and type errors

Author: Steve Nahrup"
```

---

## Parallelization Strategy

Tasks that can run concurrently (no shared files):

| Parallel Group | Tasks | Why Independent |
|---|---|---|
| Group A | Task 2 (SQL parser) + Task 3 (other parsers) | Different files in parsers/ |
| Group B | Task 4 (API specimens/entities) + Task 6 (shared components) | Backend vs frontend |
| Group C | Task 7 (Ledger) + Task 8 (Clusters) + Task 9 (Canonical) + Task 10 (Specs) + Task 11 (Validation) | Independent page files |

Sequential dependencies:
- Task 1 (DB schema) → must be first
- Tasks 2-3 (parsers) → before Task 4 (API routes reference parsers)
- Task 4-5 (API) → before Tasks 7-11 (pages call API)
- Task 6 (shared components) → before Tasks 7-11 (pages use them)
- Task 12 (wiring) → after Tasks 7-11
- Task 13 (build check) → last

## Execution Order

```
Task 1 (DB)
    ↓
Task 2+3 (parsers, parallel)
    ↓
Task 4+5+6 (API + shared components, parallel)
    ↓
Task 7+8+9+10+11 (all 5 pages, parallel)
    ↓
Task 12 (wiring)
    ↓
Task 13 (build verification)
```
