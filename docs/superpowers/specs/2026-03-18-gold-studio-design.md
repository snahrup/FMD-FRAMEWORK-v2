# Gold Studio — Design Specification

**Date:** 2026-03-18
**Status:** Draft
**Branch:** `feat/business-portal`
**Author:** Steve Nahrup

---

## 1. Product Vision

Gold Studio is a persistent assay ledger for report artifacts, where every import is extracted, cataloged, normalized, and refined into traceable Gold-layer specifications.

**Product thesis:** Nothing gets lost, everything is traceable.

Gold Studio translates a 6-phase metadata-first methodology (Inventory → Extract → Normalize → Canonical Model → Gold Design → Validate) into a dashboard-native workflow. The system does the heavy lifting — parsing files, discovering schemas, detecting duplicates, generating specs — while the human makes every judgment call.

### What Gold Studio Is

- A persistent asset registry for Power BI reports, RDL files, PBIX/PBIP projects, and raw SQL queries
- An extraction engine that cracks open artifacts and catalogs their contents (tables, columns, queries, measures, relationships)
- A normalization workspace for resolving overlapping tables across reports into canonical business entities
- A Gold layer specification generator that produces Materialized Lake View designs from approved canonical entities
- A governance pipeline that ensures every Gold asset is validated, enriched with metadata, and published to the catalog

### What Gold Studio Is Not

- Not a report builder or BI tool
- Not an automated canonical modeler — the system suggests, the human decides
- Not a data loading pipeline — that's what LZ → Bronze → Silver already does
- Not a one-time import tool — everything persists as a browsable, searchable registry

### Design Identity

**Metaphor:** Assay office — raw material comes in messy, gets inspected, tagged, broken down, graded, and certified. The ledger is permanent. Output quality depends on disciplined refinement.

**Vocabulary in UI:** Ledger, Specimen, Provenance, Cluster, Certification — used confidently. "Assay" and "ore" stay in the vision, not the interface. UI labels are practical.

**Visual identity:** Warm paper canvas, copper accent for in-progress work, warm gold for certified completions. Zero shadows, borders-only depth. Dense data presentation in JetBrains Mono. The Provenance Thread as the universal signature element.

---

## 2. Provenance Thread

The signature UI element. A horizontal series of dots connected by a thin line, representing an entity's progression through the methodology.

### Seven Phases

```
●───●───●───●───●───●───●
Imported  Extracted  Clustered  Canonicalized  Gold Drafted  Validated  Cataloged
```

### Visual Encoding

| Dot State | Appearance | Meaning |
|---|---|---|
| Filled copper | Solid copper circle | Phase completed |
| Pulsing copper | Copper circle with subtle pulse animation | Current phase (work available) |
| Empty | Hollow circle, muted border | Future phase |
| Filled gold | Solid warm gold circle | Terminal state reached |

### Phase Transition Rules

| Transition | Trigger | Gate Type |
|---|---|---|
| → Imported | Specimen created in Ledger | Automatic |
| → Extracted | Parser succeeded + schema discovery complete (or skipped) | Automatic |
| → Clustered | Assigned to approved cluster OR reviewed as standalone | Human |
| → Canonicalized | Canonical entity status set to Approved, all required fields populated | Human |
| → Gold Drafted | Gold spec generated from approved canonical entity | Automatic |
| → Validated | All critical validation rules pass + user confirms (or waiver filed) | Human |
| → Cataloged | All required catalog fields populated + user clicks Certify & Publish | Human |

### Terminal State Visual

When an entity reaches Cataloged, the entire thread transitions to gold (gold dots, gold connecting line). This is the visual payoff — scannable at a glance across a table of entities.

### Thread Dimensions

- 7 dots, 6px diameter each
- 1px connecting lines
- ~160px total width
- Compact enough for table columns, distinct enough to read

---

## 3. Information Architecture

### Navigation

Gold Studio is a top-level sidebar group in the engineering console, sitting between Explore and Quality:

```
Gold Studio
├── Ledger          /gold/ledger       — Asset registry (home base)
├── Clusters        /gold/clusters     — System-detected overlap groups awaiting review
├── Canonical       /gold/canonical    — Approved business entities and conformed definitions
├── Specifications  /gold/specs        — Gold layer Materialized Lake View designs
└── Validation      /gold/validation   — Reconciliation, readiness & catalog certification
```

**Two navigation layers:**
1. Console sidebar → Gold Studio entry point (icon + label)
2. Horizontal sub-nav tab strip within Gold Studio → 5 pages

The tab strip appears below the page title on all Gold Studio pages, reinforcing that these are views of one system. Active tab gets a 2px copper underline.

**Existing `/gold` route** redirects to `/gold/ledger`.

### Business Portal Mapping

| Engineering | Business Portal | Visible |
|---|---|---|
| Ledger | Source Reports | Yes |
| Clusters | — | Hidden |
| Canonical | Data Collections | Yes |
| Specifications | Datasets | Yes |
| Validation | — | Hidden |

Business portal views show trust badges (Certified / Promoted / Pending) on published assets without exposing the underlying methodology.

### First-Class Objects

Five object types in the system. All UI centers on these:

| Object | Description | Created By |
|---|---|---|
| **Specimen** | Imported artifact (RDL, PBIX, PBIP, SQL, TMDL, BIM) | Import action |
| **Cluster** | System-suggested group of overlapping entities | Duplicate detection |
| **Canonical Entity** | Approved business object with defined grain, keys, and columns | Cluster resolution or standalone promotion |
| **Specification** | Gold layer MLV design generated from a canonical entity | Spec generation |
| **Catalog Entry** | Governed, published Gold asset with full metadata | Catalog publication |

### Page Layout Pattern

Every Gold Studio page shares:

- **Top bar:** "GOLD STUDIO" title + division selector + import button (Ledger only)
- **Sub-nav:** Horizontal tab strip (Ledger | Clusters | Canonical | Specifications | Validation)
- **Stats strip:** 5-7 hero numbers in Instrument Serif with Outfit small-caps labels. Clickable as filter shortcuts.
- **Filter bar:** Search + contextual filters + saved views
- **Main area:** Page-specific content

Stats strip, sub-nav, and filter bar are sticky on scroll.

---

## 4. The Ledger (`/gold/ledger`)

Home base. The permanent registry of every artifact imported and every entity extracted.

### Stats Strip

| Specimens | Tables Extracted | Columns Cataloged | Unresolved Clusters | Canonical Approved | Gold Specs | Certification Rate |
|---|---|---|---|---|---|---|
| 14 | 87 | 1,240 | 6 | 34 | 22 | 64% |

Mixes intake, transformation, approval, and readiness metrics.

### View Toggle

Two modes at the top of the main area:

**By Specimen (default):** Specimens as primary rows, extracted entities nested in accordion expansions.

**By Extracted Entity:** Flat list of all extracted entities across all specimens, with specimen name as a column. Groupable by cluster status, canonical status, source system, or source database. Designed for cross-specimen entity hunting.

### Specimen Rows (By Specimen Mode)

Two-line card rows on `#FEFDFB` surface with `rgba(0,0,0,0.08)` border:

- **Line 1:** Name + type badge + source system + steward + provenance thread
- **Line 2 (muted, smaller):** Summary counts (tables, columns) + job state badge

**3px left status rail** (BP signature):
- Copper `#B45624` — in progress
- Operational green `#3D7C4F` — fully validated
- Warm gold `#C2952B` — cataloged
- Muted stone `#A8A29E` — imported, not yet extracted

**Type badges:** `RDL` `PBIX` `PBIP` `SQL` `TMDL` `BIM` — JetBrains Mono, small, `rgba(180,86,36,0.1)` background, rounded.

**Job state badges** (separate from provenance):

| State | Badge Color | Meaning |
|---|---|---|
| Queued | Muted stone | Waiting for extraction |
| Extracting | Copper pulse | Parser running |
| Schema Discovery | Copper pulse | Querying source DBs |
| Extracted | Operational green | All content parsed, schemas resolved |
| Parse Warning | Caution amber | Extracted with issues |
| Parse Failed | Fault red | Parser error — needs intervention |
| Needs Connection | Info blue | Source DB not mapped |
| Schema Pending | Muted stone | Extraction done, schema waiting on VPN |

### Accordion Expansion

Clicking a specimen row expands inline on `#F9F7F3` inset surface.

**Inner tabs:** Tables | Queries | Measures | Relationships — controls which content type is shown. Default: Tables. Prevents vertical sprawl.

**Tables tab:** Top 5 rows by default with "Show all N" expander. Columns: Table Name, Source DB, Cols, Joins To, Cluster (with `⚠` unresolved / `✓` resolved badge), Provenance Thread.

**Queries tab:** Extracted SQL in JetBrains Mono with syntax highlighting, collapsible for long queries. Copy button. Full-screen expand. All queries stored permanently.

**Metadata section:** Always visible below inner tabs. Description, import timestamp, imported by (session), steward, "Raw artifact retained ✓" with download link. Raw file path de-emphasized — not shown in main view.

### Import Actions

Top-right button group on Ledger page:

**Import button** (dropdown): Upload File | Paste SQL | Bulk Import

**Upload File modal:**
- File dropzone (accepts `.rdl`, `.pbix`, `.pbip`, `.tmdl`, `.bim`)
- Fields: Name (auto-populated), Division (required dropdown), Source System (dropdown), Steward (required text), Description (text area), Tags (freeform chips)
- Submit → file stored → specimen created → extraction queued as background job

**Paste SQL modal:**
- Full-height code editor (JetBrains Mono, line numbers, dark inset `#2B2A27` background)
- Fields: Query Name (required), Source Database (dropdown + manual entry), Division, Source System, Steward, Description, Tags
- Submit → query stored as `.sql` → specimen created → extraction begins

**Bulk Import modal:**
- Folder picker → preview table of supported files with per-file override columns
- Shared metadata (Division, Steward) applied to all, with per-file Source System and Description overrides
- Submit → all specimens created → extraction queued as background jobs

### Search, Filters & Saved Views

**Search:** Specimen name, table name, column name, query text, source DB.

**Filters:** Division, Type, Steward, Source System, Job State, Provenance State, Cluster Status, Imported Date Range.

**Saved views:** Needs clustering, Ready for canonical review, Gold drafted pending validation, Imported this week, by division.

---

## 5. Import & Extraction Pipeline

### Parser Architecture

Each file type has a dedicated parser. All parsers produce a normalized output contract.

**Parser hierarchy (priority order):**
1. PBIP/TMDL — first-class, already decompiled text files
2. BIM — Tabular Model JSON, straightforward parsing
3. RDL — XML-based, SQL queries embedded directly
4. Raw SQL — SQL is the input, just needs analysis
5. PBIX — ZIP archive fallback, requires extraction + DataModelSchema parsing

**v2 (not in v1):** XMLA/TOM-based model interrogation via endpoint.

**Parser modules** (`dashboard/app/api/parsers/`):

| Module | File Types | Extraction Method |
|---|---|---|
| `rdl_parser.py` | `.rdl`, `.rdlc` | XML parse `<DataSets>`, `<CommandText>`, `<Fields>`, `<DataSources>` |
| `pbix_parser.py` | `.pbix` | ZIP extract → `DataModelSchema` JSON |
| `pbip_parser.py` | `.pbip` folders | TMDL file reading + `model.bim` fallback |
| `bim_parser.py` | `.bim` | Tabular Model JSON direct parse |
| `sql_parser.py` | `.sql`, pasted SQL | FROM/JOIN/SELECT analysis, table/alias extraction |
| `schema_discovery.py` | All | Source DB metadata resolution |

**Normalized output contract:**

```python
@dataclass
class ExtractionResult:
    tables: list[ExtractedTable]
    columns: list[ExtractedColumn]
    queries: list[ExtractedQuery]
    measures: list[ExtractedMeasure]
    relationships: list[ExtractedRelationship]
    data_source_refs: list[DataSourceRef]
    warnings: list[str]
    errors: list[str]
```

### Schema Discovery

After extraction, for every referenced source table, the system resolves schema metadata from the appropriate source database.

**Primary methods (in order):**
1. `sp_describe_first_result_set` — for raw SQL batches with parameters
2. `sys.dm_exec_describe_first_result_set` — function-based path
3. Direct catalog queries (`INFORMATION_SCHEMA.COLUMNS`, `sys.columns`) — for known tables/views

**Fallback methods:**
4. `SELECT TOP 0 * FROM [table]` — simple object introspection
5. `UseFMTONLY=true` — escape hatch for known metadata edge cases only

Returns column names, data types, nullable, PK indicators.

**Connection resolution:** Maps source references to existing FMD connections via `config.json`. Supports multi-source per specimen:

- Multiple SQL databases
- Fabric Lakehouses and Warehouses
- Semantic model references
- Mixed storage modes (Import, DirectQuery, DirectLake, Dual) per table/partition

If a source DB can't be matched → job state `Needs Connection`. If VPN is down → job state `Schema Pending` with retry.

### Async Job Model

Extraction, schema discovery, bulk import, and validation are all **asynchronous background jobs**, not blocking request-thread work.

**API pattern:**
1. `POST` request → creates job, returns `{job_id, status: "queued"}`
2. Job runs in FastAPI background task
3. `GET /jobs/{job_id}` → poll for status + results
4. Optional: WebSocket event on completion (v2)

### Post-Extraction Automation

After successful extraction:
1. All extracted entities registered with provenance `Imported`
2. Auto-advance to `Extracted` (if parser succeeded + schema resolved)
3. Duplicate detection runs — fuzzy matches table names, column signatures, query patterns across all entities in same division
4. Cluster suggestions surface as `⚠` badges on Ledger entity rows

### File Storage

```
data/gold-studio/specimens/{specimen_id}/
├── original.*              — raw imported artifact (never modified)
└── extraction/
    ├── tables.json         — parsed table definitions
    ├── columns.json        — parsed column catalog
    ├── queries.json        — extracted SQL/M queries
    ├── measures.json       — extracted measures
    ├── relationships.json  — extracted joins/FKs
    └── parse_log.json      — extraction warnings/errors
```

Raw artifacts stored on disk. Parsed metadata in both JSON (inspection/debugging) and SQLite (API queries). JSON files serve as extraction cache — re-extractable from original without re-uploading.

---

## 6. Clustering (`/gold/clusters`)

**Subtitle:** *System-detected groups of overlapping tables, fields, and entities awaiting review.*

### Core Principle

Clusters are **suggestions, not merges**. The system proposes. The human reviews, adjusts, and resolves. Nothing advances to Canonical without explicit approval.

Clusters may represent repeated physical tables, repeated shaped datasets, or different query paths to the same business object.

### Detection Strategies

Three matching strategies, each producing a confidence score:

| Strategy | Signal | Confidence |
|---|---|---|
| **Name Match** | Exact or fuzzy table name match across specimens | High |
| **Column Signature** | >70% column name overlap between entities (configurable) | Medium |
| **Query Pattern** | Similar FROM tables, JOIN patterns, WHERE clauses | Lower |

Scores combine with penalties (e.g., cross-source mismatch: -5) into an aggregate 0-100 confidence.

**Confidence is always explainable.** Every cluster card shows a breakdown:

```
Name +40 · Columns +30 · Query +17 · Cross-source -5 = 82%
```

### Stats Strip

| Total Clusters | Unresolved | Resolved | Avg Confidence | Not Clustered |
|---|---|---|---|---|
| 23 | 6 | 17 | 82% | 31 |

### Cluster Cards

Clusters display as full-width cards (not table rows). Copper left rail for unresolved, green for resolved, gold for promoted to canonical.

**Card anatomy:**
- **Header:** Cluster ID, dominant table name, user-editable label, confidence %, resolution status
- **Members table:** Entity name, source specimen, column count, match type (Name: exact, Col: 78%, etc.)
- **Column Overlap bar:** Filled copper bar showing shared/union fraction and percentage
- **Unique columns:** Text line calling out columns present in only one member
- **Confidence breakdown:** Always visible, compact single line
- **Cross-source badge:** `⚠ Cross-source` when members span different source systems
- **Actions:** Confirm Grouping | Split ▼ | Merge With... | Dismiss

### Cluster Statuses

| Status | Meaning |
|---|---|
| Unresolved | Detected, not yet reviewed |
| Resolved | Decision made (approved, split, merged, or dismissed) |
| Dismissed | Reviewed and rejected — members returned to unclustered |
| Pending Steward | Decision requires business owner input |

### Resolution Actions

**Confirm Grouping** — All members represent the same business object. Opens column reconciliation slide-over before finalizing. Union of columns becomes candidate column set.

**Split** (dropdown):
- **Create Sub-clusters** — Drag members into sub-groups
- **Remove Member** — Eject individual member to unclustered
- **Mark Standalone** — Eject member as confirmed standalone entity

**Merge With...** — Combine with another cluster. Picker shows other clusters with affinity score.

**Dismiss** — Not the same thing despite surface similarity. Members return to unclustered with audit note.

All actions logged in audit log.

### Column Reconciliation

Opens in slide-over when "Confirm Grouping" is clicked. Matrix showing each column across all cluster members:

**Row anatomy (two lines):**
- Line 1: Column name, data type, presence indicators (✓/—) per member, decision dropdown
- Line 2 (muted, smaller): Source expression preview for each member

**Decision options per column:**
- **Include** — part of canonical entity (sub-option: PK / BK / FK / None)
- **Exclude** — report-specific hack, calculated field, deprecated
- **Review** — insufficient information, flag for steward

**Auto-defaults:**
- Present in ALL members → Include
- Present in ONE member → Review

**Cannot approve** until all Review items resolved to Include or Exclude.

**Source expression expand:** Click any column row to reveal full source expression from each specimen. Prevents alias-masking errors.

### Unclustered Entities

Separate tab showing entities not assigned to any cluster:

| Entity | Specimen | Source DB | Columns | Action |
|---|---|---|---|---|
| `ETQ_AUDIT_LOG` | Quality_Report.rdl | ETQStagingPRD | 18 | [Promote to Canonical] [Ignore] |

Standalone entities promote directly to Canonical without clustering — they ARE the canonical version.

### Filters

Status (Unresolved / Resolved / Dismissed / Pending Steward / All), Confidence (High >80% / Medium 50-80% / Low <50%), Division, Source System, search by cluster label / entity name / column name.

**Preset views:** Needs decision, Pending steward input, High confidence unresolved, Cross-source clusters.

### Provenance Advancement

`Extracted` → `Clustered` when:
- Assigned to an approved cluster, OR
- Explicitly reviewed as standalone

Suggestions do not auto-advance. The suggestion is not the decision.

---

## 7. Canonical Modeling (`/gold/canonical`)

**Subtitle:** *Approved business entities and conformed definitions.*

### Canonical Entity Definition

| Field | Description | Required |
|---|---|---|
| Canonical Name | Business-standard name (e.g., `OrderLines`, `DimCustomer`) | Yes |
| Business Description | Plain language — what, who, what grain | Yes |
| Domain | Business domain (Sales, Production, Finance, etc.) | Yes |
| Entity Type | Fact / Dimension / Bridge / Reference / Aggregate | Yes |
| Grain | What one row represents | Yes |
| Business Keys | Column(s) uniquely identifying a row at declared grain | Yes |
| Steward | Business owner responsible for definition | Yes |
| Source Systems | Which source databases feed this entity | Auto |
| Source Specimens | Which imported artifacts contribute | Auto |
| Upstream Clusters | Cluster ID(s) derived from | Auto |
| Column Set | Approved columns from reconciliation | From cluster |
| Shared Dimensions | FK relationships to other canonical entities | Manual |
| Status | Draft / Approved / Deprecated | Yes |
| Version | Immutable version number (new version on material change) | Auto |

### Stats Strip

| Canonical Entities | Dimensions | Facts | Bridges | Approved | Draft | Pending Steward |
|---|---|---|---|---|---|---|
| 34 | 18 | 12 | 4 | 28 | 4 | 2 |

### Domain Grid View (default)

Grouped by business domain. Collapsible sections, entity count in header. Rows show: Entity, Type (badge), Grain, Columns, Status, Provenance Thread.

**Type badges:** Fact (copper background), Dimension (muted), Bridge (blue-tinted), Reference (stone).

**Status badges:** `✓ Approved` (green), `◌ Draft` (copper), `⚠ Pending Steward` (amber), `✗ Deprecated` (muted strikethrough).

### Relationship Map View

`@xyflow/react` diagram. Fact nodes wider with copper border (2px). Dimension nodes standard with muted border (1px). Edge labels show cardinality. Domain filter at top.

**Read-only in v1.** Visual sanity check, not an editing surface. Click any node → opens canonical entity detail slide-over.

### Detail Slide-Over

**Content tabs:** Definition | Columns | Lineage | Relationships | Measures | Cluster History | Phase History

**Definition tab:** Business description, grain statement, steward, domain, status, version.

**Columns tab:** Full column list with name, type, nullable, key designation (PK/BK/FK/None), source expression, classification (PII/Confidential/Internal/Public), business description.

**Lineage tab:** Compact diagram: Specimens → Extracted Entities → Cluster → This Canonical Entity. Clickable nodes.

**Relationships tab:** Declared FKs to other canonical entities with cardinality (1:M, M:1, M:M). Editable — user adds/removes here.

**Measures tab:** Not embedded on the canonical entity row. Stored in separate `gs_semantic_definitions` table. Shows associated measures/KPIs with name, expression (DAX/SQL), type, description, source reference.

### Approval Gate

`Clustered` → `Canonicalized` when:
- Status set to **Approved**
- All required fields populated (name, description, domain, type, grain, business keys, steward)
- At least one source specimen linked

Human gate. No auto-advance.

---

## 8. Gold Specifications (`/gold/specs`)

**Subtitle:** *Gold layer Materialized Lake View designs.*

### Spec Generation

When user clicks **Generate Gold Spec** on an approved canonical entity, the system produces:

| Field | Source |
|---|---|
| Target Object Name | Canonical name + naming convention (e.g., `Gold_Fact_OrderLines`) |
| Object Type | Materialized Lake View |
| Business Description | From canonical entity |
| Grain | From canonical entity |
| Primary Keys | From business keys |
| Source Lineage | Full chain: Specimen → Extract → Cluster → Canonical |
| Source SQL | Generated SELECT from Silver layer tables with transforms |
| Transformation Rules | From column reconciliation + manual additions |
| Included Columns | Approved column set with target names, types, descriptions |
| Excluded Columns | From reconciliation Exclude decisions with reasoning |
| Relationship Expectations | Declared referential relationships (not physical FK constraints) |
| Downstream Reports | Original specimens/reports that used this data |
| Refresh Strategy | User-selected: Full / Incremental / Hybrid |
| Validation Rules | Auto-generated (row count, key uniqueness, NULL rates, referential integrity) + user-added |
| Version | Immutable version number |

**Gold specs are physical MLV designs only.** Semantic definitions (measures, KPIs, calculated groups) remain associated with the canonical entity, not embedded in the spec.

### Stats Strip

| Gold Specs | Ready to Deploy | Pending Validation | Needs Revalidation | Deprecated |
|---|---|---|---|---|
| 22 | 14 | 5 | 3 | 0 |

### Spec Table

Two-line rows:
- Line 1: Spec name, Type badge, Domain, Sources, Validation status, Provenance Thread
- Line 2 (muted): Version, column count, refresh strategy

**Validation badges:** `✓ Pass` (green), `⚠ Pending` (amber), `✗ Failed` (red), `↻ Needs Reval.` (copper with rotation icon — visually distinct from "not yet validated").

### Spec Detail Slide-Over

**Content tabs:** Overview | SQL | Columns | Transforms | Impact | History

**SQL tab:** Dark inset code block (`#2B2A27` background). Syntax highlighting. Copy button. Full-screen expand (`⤢`). Referenced Silver tables highlighted and clickable. Warning banner: "Editing SQL will mark this spec as Needs Revalidation."

**Impact tab:** Downstream reports, affected semantic models, affected Gold specs/dimensions. The "what breaks if I change this" view.

**History tab:** Version history + validation run history + audit log.

### Revalidation Rule

Editing any of these triggers automatic invalidation:
- Source SQL
- Transformation rules
- Included/excluded columns
- Relationship expectations
- Validation thresholds

Previous validation runs retained but marked as `superseded`. Spec status → `needs_revalidation`.

### Provenance

`Canonicalized` → `Gold Drafted`: Automatic when spec is generated.

`Gold Drafted` → `Validated`: When all critical validation rules pass + user confirms (or waiver filed for critical failures).

---

## 9. Validation & Catalog Publication (`/gold/validation`)

**Subtitle:** *Reconciliation, readiness & catalog certification.*

### Validation Runs

Each Gold spec can have multiple validation runs. A run executes all validation rules and stores results.

**Validation rule types:**

| Type | Behavior |
|---|---|
| Critical | Must pass for Validated status (unless waiver filed) |
| Warning | Flagged, doesn't block |
| Advisory | Informational, for legacy reconciliation |

**Standard auto-generated rules:**
- Row count > 0 (Critical)
- PK uniqueness = 100% (Critical)
- No schema drift from spec (Critical)
- NULL rate per column vs threshold (Warning)
- FK integrity vs referenced dimensions (Warning)
- Row count vs legacy report ±5% (Advisory)

### Waiver Model

If a critical rule fails, the spec **cannot be validated** unless a formal exception is filed:

| Field | Required |
|---|---|
| Reason | Yes — why this failure is acceptable |
| Approver | Yes — who authorized the exception |
| Timestamp | Auto |
| Review Date | Yes — when this waiver should be re-evaluated |

Waiver-validated specs show `⚠ Waiver` status with `✗†` indicator on critical rule counts.

### Reconciliation Log

For high-value facts, compares Gold output against legacy report behavior:

| Metric | Legacy | Gold | Delta | Status |
|---|---|---|---|---|
| Total rows | 139,812 | 142,847 | +2.2% | ✓ Within tolerance |
| Revenue | $14.2M | $14.2M | +0.01% | ✓ Match |
| Distinct customers | 1,847 | 1,853 | +6 | ⚠ Review |

### Catalog Publication

The terminal state. A Gold entity is not complete until published with governance metadata.

**Required fields (block publication if empty):**

| Field | Source |
|---|---|
| Display Name | From canonical entity |
| Technical Name | From Gold spec (e.g., `Gold_Fact_OrderLines`) |
| Business Description | From canonical entity |
| Grain | From canonical entity |
| Domain | From canonical entity |
| Owner | From steward |
| Steward | From canonical entity |
| Source Systems | Auto from lineage |
| Sensitivity Label | Public / Internal / Confidential / Restricted |
| Endorsement | None / Promoted / Certified |

**Optional but recommended:**

Tags, Intended Audience, Usage Type (BI / Analytics / AI / Operational), Glossary Terms, Certification Notes, Contact / Team, Refresh SLA, Data Retention.

**Implementation metadata (technical block):**

Workspace, Lakehouse / Warehouse, Schema, Object Name, Deployment Environment, Last Validation Run, Last Published Timestamp.

### Endorsement (Separate from Provenance)

Provenance terminal state = **Cataloged** (published with required metadata).

Endorsement is a separate attribute:

| Endorsement | Meaning | Badge |
|---|---|---|
| None | Published but not endorsed | Muted |
| Promoted | Recommended for use | Copper |
| Certified | Formally certified as trusted | Green |

### Publish Action

**Certify & Publish** button:
1. Writes all metadata to `gs_catalog_entries` table
2. Updates provenance to Cataloged (gold thread)
3. Syncs to FMD Data Catalog (`/catalog`) and Business Portal (`/catalog-portal`)
4. Future (v2): pushes to Fabric/Purview via REST API

### Validation Page Layout

**Stats Strip:**

| Validated | Cataloged | Pending Validation | Failed | Reconciliation Warnings |
|---|---|---|---|---|
| 14 | 11 | 5 | 1 | 3 |

**Tab 1: Validation Status** — All specs with latest validation run results. Sorted: failed first, then waiver, then pending, then passed. Columns: Spec, Status, Critical rules (fraction), Warnings, Last Run.

**Tab 2: Catalog Registry** — All published Gold assets with governance metadata summary. Trust badges. This feeds the Data Catalog and Business Portal.

---

## 10. Backend Architecture

### Database Schema (17 Tables)

All tables in `fmd_control_plane.db`, prefixed `gs_`. Soft deletes via `deleted_at` column on all user-facing mutable tables. No `ON DELETE CASCADE`. Versioning uses immutable version rows with `root_id` pattern.

#### Specimen Management (3 tables)

```sql
CREATE TABLE gs_specimens (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK(type IN ('rdl','pbix','pbip','tmdl','bim','sql')),
    division        TEXT NOT NULL,
    source_system   TEXT,
    steward         TEXT NOT NULL,
    imported_by     TEXT,
    description     TEXT,
    tags            TEXT,                   -- JSON array
    file_path       TEXT,
    job_state       TEXT DEFAULT 'queued' CHECK(job_state IN (
        'queued','extracting','schema_discovery','extracted',
        'parse_warning','parse_failed','needs_connection','schema_pending'
    )),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME
);

CREATE TABLE gs_extraction_jobs (
    id              INTEGER PRIMARY KEY,
    specimen_id     INTEGER NOT NULL REFERENCES gs_specimens(id),
    started_at      DATETIME,
    completed_at    DATETIME,
    status          TEXT CHECK(status IN ('queued','running','completed','warning','failed')),
    parser_type     TEXT,
    warnings        TEXT,                   -- JSON array
    errors          TEXT,                   -- JSON array
    metadata        TEXT                    -- JSON: parser stats
);

CREATE TABLE gs_specimen_queries (
    id              INTEGER PRIMARY KEY,
    specimen_id     INTEGER NOT NULL REFERENCES gs_specimens(id),
    query_name      TEXT,
    query_text      TEXT NOT NULL,
    query_type      TEXT CHECK(query_type IN ('native_sql','m_query','dax','stored_proc')),
    source_database TEXT,
    parameters      TEXT,                   -- JSON array
    ordinal         INTEGER
);
```

#### Extracted Entities (3 tables)

```sql
CREATE TABLE gs_extracted_entities (
    id              INTEGER PRIMARY KEY,
    specimen_id     INTEGER NOT NULL REFERENCES gs_specimens(id),
    query_id        INTEGER REFERENCES gs_specimen_queries(id),
    entity_name     TEXT NOT NULL,
    schema_name     TEXT,
    source_database TEXT,
    source_system   TEXT,
    column_count    INTEGER DEFAULT 0,
    provenance      TEXT DEFAULT 'imported' CHECK(provenance IN (
        'imported','extracted','clustered','canonicalized',
        'gold_drafted','validated','cataloged'
    )),
    cluster_id      INTEGER REFERENCES gs_clusters(id),
    canonical_id    INTEGER REFERENCES gs_canonical_entities(id),
    metadata        TEXT,                   -- JSON
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME
);

CREATE TABLE gs_extracted_columns (
    id              INTEGER PRIMARY KEY,
    entity_id       INTEGER NOT NULL REFERENCES gs_extracted_entities(id),
    column_name     TEXT NOT NULL,
    data_type       TEXT,
    nullable        BOOLEAN DEFAULT 1,
    is_key          BOOLEAN DEFAULT 0,
    source_expression TEXT,
    is_calculated   BOOLEAN DEFAULT 0,
    ordinal         INTEGER,
    metadata        TEXT
);

CREATE TABLE gs_extracted_relationships (
    id              INTEGER PRIMARY KEY,
    specimen_id     INTEGER NOT NULL REFERENCES gs_specimens(id),
    from_entity_id  INTEGER NOT NULL REFERENCES gs_extracted_entities(id),
    from_column     TEXT NOT NULL,
    to_entity_id    INTEGER REFERENCES gs_extracted_entities(id),
    to_entity_name  TEXT,
    to_column       TEXT NOT NULL,
    join_type       TEXT,
    cardinality     TEXT,
    detected_from   TEXT CHECK(detected_from IN ('query_parse','model_metadata','manual'))
);
```

#### Source Bindings (1 table)

```sql
CREATE TABLE gs_source_bindings (
    id              INTEGER PRIMARY KEY,
    specimen_id     INTEGER REFERENCES gs_specimens(id),
    entity_id       INTEGER REFERENCES gs_extracted_entities(id),
    binding_type    TEXT NOT NULL CHECK(binding_type IN (
        'sql_db','lakehouse','warehouse','semantic_model','other'
    )),
    source_system   TEXT,
    source_name     TEXT,
    workspace       TEXT,
    item_id         TEXT,
    connection_id   TEXT,
    database_name   TEXT,
    schema_name     TEXT,
    object_name     TEXT,
    partition_name  TEXT,
    storage_mode    TEXT CHECK(storage_mode IN ('import','direct_query','direct_lake','dual')),
    metadata        TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### Measures (1 table)

```sql
CREATE TABLE gs_extracted_measures (
    id              INTEGER PRIMARY KEY,
    specimen_id     INTEGER NOT NULL REFERENCES gs_specimens(id),
    entity_id       INTEGER REFERENCES gs_extracted_entities(id),
    measure_name    TEXT NOT NULL,
    expression      TEXT NOT NULL,
    expression_type TEXT CHECK(expression_type IN ('dax','m','sql')),
    description     TEXT,
    source_table    TEXT,
    metadata        TEXT
);
```

#### Schema Discovery (1 table)

```sql
CREATE TABLE gs_schema_discovery (
    id              INTEGER PRIMARY KEY,
    entity_id       INTEGER NOT NULL REFERENCES gs_extracted_entities(id),
    source_database TEXT NOT NULL,
    source_table    TEXT NOT NULL,
    discovered_columns TEXT NOT NULL,       -- JSON: [{name, type, nullable, is_pk}]
    discovery_method TEXT CHECK(discovery_method IN (
        'sp_describe','catalog','top0','fmtonly'
    )),
    discovered_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    connection_id   TEXT
);
```

#### Clustering (2 tables)

```sql
CREATE TABLE gs_clusters (
    id              INTEGER PRIMARY KEY,
    division        TEXT NOT NULL,
    label           TEXT,
    dominant_name   TEXT,
    confidence      INTEGER CHECK(confidence BETWEEN 0 AND 100),
    confidence_breakdown TEXT,              -- JSON: {name_match, column_overlap, query_pattern, penalties}
    status          TEXT DEFAULT 'unresolved' CHECK(status IN (
        'unresolved','resolved','dismissed','pending_steward'
    )),
    resolution      TEXT CHECK(resolution IN ('approved','split','merged','dismissed')),
    resolved_by     TEXT,
    resolved_at     DATETIME,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME
);

CREATE TABLE gs_cluster_column_decisions (
    id              INTEGER PRIMARY KEY,
    cluster_id      INTEGER NOT NULL REFERENCES gs_clusters(id),
    column_name     TEXT NOT NULL,
    decision        TEXT NOT NULL CHECK(decision IN ('include','exclude','review')),
    reason          TEXT,
    key_designation TEXT CHECK(key_designation IN ('pk','bk','fk','none')),
    decided_by      TEXT,
    decided_at      DATETIME
);
```

#### Canonical Entities (1 table, immutable versions)

```sql
CREATE TABLE gs_canonical_entities (
    id              INTEGER PRIMARY KEY,
    root_id         INTEGER NOT NULL,       -- shared across versions of same entity
    version         INTEGER NOT NULL DEFAULT 1,
    is_current      BOOLEAN NOT NULL DEFAULT 1,
    name            TEXT NOT NULL,
    business_description TEXT NOT NULL,
    domain          TEXT NOT NULL,
    entity_type     TEXT NOT NULL CHECK(entity_type IN (
        'fact','dimension','bridge','reference','aggregate'
    )),
    grain           TEXT NOT NULL,
    business_keys   TEXT NOT NULL,          -- JSON array
    steward         TEXT NOT NULL,
    source_systems  TEXT,                   -- JSON array
    source_cluster_ids TEXT,                -- JSON array
    status          TEXT DEFAULT 'draft' CHECK(status IN ('draft','approved','deprecated')),
    shared_dimensions TEXT,                 -- JSON: [{canonical_root_id, fk_column, cardinality}]
    approval_gate   TEXT,                   -- JSON: {approved_by, approved_at, notes}
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME,
    UNIQUE(root_id, version)
);
```

#### Semantic Definitions (1 table)

```sql
CREATE TABLE gs_semantic_definitions (
    id              INTEGER PRIMARY KEY,
    canonical_root_id INTEGER NOT NULL,     -- references gs_canonical_entities.root_id
    version         INTEGER DEFAULT 1,
    name            TEXT NOT NULL,
    definition_type TEXT NOT NULL CHECK(definition_type IN (
        'measure','kpi','calc_group','semantic_note'
    )),
    expression      TEXT,
    expression_type TEXT CHECK(expression_type IN ('dax','sql','other')),
    description     TEXT,
    source_ref      TEXT,                   -- specimen/entity this was extracted from
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME
);
```

#### Gold Specifications (1 table, immutable versions)

```sql
CREATE TABLE gs_gold_specs (
    id              INTEGER PRIMARY KEY,
    root_id         INTEGER NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    is_current      BOOLEAN NOT NULL DEFAULT 1,
    canonical_root_id INTEGER NOT NULL,     -- references gs_canonical_entities.root_id
    target_name     TEXT NOT NULL,
    object_type     TEXT DEFAULT 'mlv' CHECK(object_type IN ('mlv','view','table')),
    source_sql      TEXT,
    transformation_rules TEXT,              -- JSON array
    included_columns TEXT,                  -- JSON array
    excluded_columns TEXT,                  -- JSON array with reasons
    relationship_expectations TEXT,         -- JSON: declared referential relationships
    downstream_reports TEXT,                -- JSON: specimen references
    refresh_strategy TEXT CHECK(refresh_strategy IN ('full','incremental','hybrid')),
    validation_rules TEXT,                  -- JSON array
    status          TEXT DEFAULT 'draft' CHECK(status IN (
        'draft','needs_revalidation','validated','cataloged'
    )),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME,
    UNIQUE(root_id, version)
);
```

#### Validation & Catalog (2 tables)

```sql
CREATE TABLE gs_validation_runs (
    id              INTEGER PRIMARY KEY,
    spec_id         INTEGER NOT NULL REFERENCES gs_gold_specs(id),
    spec_version    INTEGER NOT NULL,
    started_at      DATETIME,
    completed_at    DATETIME,
    status          TEXT CHECK(status IN ('queued','running','passed','failed','warning')),
    results         TEXT NOT NULL,          -- JSON: [{rule, type, expected, actual, status}]
    reconciliation  TEXT,                   -- JSON: legacy vs Gold metrics
    waiver          TEXT,                   -- JSON: {reason, approver, timestamp, review_date}
    superseded      BOOLEAN DEFAULT 0
);

CREATE TABLE gs_catalog_entries (
    id              INTEGER PRIMARY KEY,
    root_id         INTEGER NOT NULL,
    revision        INTEGER NOT NULL DEFAULT 1,
    is_current      BOOLEAN NOT NULL DEFAULT 1,
    spec_root_id    INTEGER NOT NULL,
    spec_version    INTEGER NOT NULL,
    display_name    TEXT NOT NULL,
    technical_name  TEXT NOT NULL,
    business_description TEXT NOT NULL,
    grain           TEXT NOT NULL,
    domain          TEXT NOT NULL,
    owner           TEXT NOT NULL,
    steward         TEXT NOT NULL,
    source_systems  TEXT NOT NULL,          -- JSON array
    sensitivity_label TEXT NOT NULL CHECK(sensitivity_label IN (
        'public','internal','confidential','restricted'
    )),
    endorsement     TEXT DEFAULT 'none' CHECK(endorsement IN ('none','promoted','certified')),
    tags            TEXT,                   -- JSON array
    intended_audience TEXT,
    usage_type      TEXT CHECK(usage_type IN ('bi','analytics','ai','operational')),
    glossary_terms  TEXT,                   -- JSON array
    certification_notes TEXT,
    refresh_sla     TEXT,
    data_retention  TEXT,
    workspace       TEXT,
    lakehouse       TEXT,
    schema_name     TEXT,
    object_name     TEXT,
    deployment_env  TEXT,
    published_at    DATETIME,
    published_by    TEXT,
    last_validation_run_id INTEGER REFERENCES gs_validation_runs(id),
    deleted_at      DATETIME,
    UNIQUE(root_id, revision)
);
```

#### Audit Log (1 table)

```sql
CREATE TABLE gs_audit_log (
    id              INTEGER PRIMARY KEY,
    object_type     TEXT NOT NULL CHECK(object_type IN (
        'specimen','entity','cluster','canonical','spec','validation','catalog'
    )),
    object_id       INTEGER NOT NULL,
    action          TEXT NOT NULL,
    previous_value  TEXT,                   -- JSON
    new_value       TEXT,                   -- JSON
    performed_by    TEXT,
    performed_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes           TEXT
);
```

### API Routes

New module: `dashboard/app/api/routes/gold_studio.py`

#### Specimens (`/api/gold-studio/specimens`)

| Method | Path | Description |
|---|---|---|
| POST | `/` | Create specimen (file upload or SQL paste) |
| GET | `/` | List (filters: division, type, steward, job_state) |
| GET | `/{id}` | Detail + extracted entities + queries |
| DELETE | `/{id}` | Soft delete |
| POST | `/{id}/extract` | Trigger extraction (async job) |
| GET | `/{id}/queries` | List extracted queries |
| POST | `/bulk` | Bulk import (async job) |

#### Extracted Entities (`/api/gold-studio/entities`)

| Method | Path | Description |
|---|---|---|
| GET | `/` | List all (filters: specimen_id, cluster_id, provenance, source_system, division) |
| GET | `/{id}` | Detail + columns + relationships + schema |
| GET | `/{id}/columns` | Column catalog |
| GET | `/{id}/schema` | Schema discovery results |
| POST | `/{id}/discover-schema` | Trigger schema discovery (async job) |

#### Clusters (`/api/gold-studio/clusters`)

| Method | Path | Description |
|---|---|---|
| GET | `/` | List (filters: status, confidence_min, division) |
| GET | `/{id}` | Detail + members + column reconciliation |
| PUT | `/{id}` | Update (label, status, notes) |
| POST | `/{id}/resolve` | Resolve (approve/split/merge/dismiss) |
| GET | `/{id}/column-decisions` | Column reconciliation state |
| PUT | `/{id}/column-decisions` | Update column decisions |
| POST | `/detect` | Run duplicate detection for division (async job) |
| GET | `/unclustered` | Entities not in any cluster |

#### Canonical Entities (`/api/gold-studio/canonical`)

| Method | Path | Description |
|---|---|---|
| GET | `/` | List (filters: domain, type, status) |
| GET | `/{id}` | Detail + columns + relationships + lineage |
| POST | `/` | Create from cluster or standalone |
| PUT | `/{id}` | Update (creates new version if material change) |
| POST | `/{id}/approve` | Set Approved (validates required fields) |
| POST | `/{id}/generate-spec` | Generate Gold spec (async job) |
| GET | `/{id}/versions` | Version history |
| GET | `/domains` | Distinct domains with counts |
| GET | `/relationships` | All cross-entity relationships |

#### Semantic Definitions (`/api/gold-studio/semantic`)

| Method | Path | Description |
|---|---|---|
| GET | `/?canonical_root_id=` | List for canonical entity |
| POST | `/` | Create |
| PUT | `/{id}` | Update |
| DELETE | `/{id}` | Soft delete |

#### Gold Specs (`/api/gold-studio/specs`)

| Method | Path | Description |
|---|---|---|
| GET | `/` | List (filters: domain, status) |
| GET | `/{id}` | Detail + columns + transforms + validation |
| PUT | `/{id}` | Update (triggers needs_revalidation) |
| PUT | `/{id}/sql` | Update source SQL (triggers needs_revalidation) |
| GET | `/{id}/versions` | Version history |
| GET | `/{id}/impact` | Downstream impact analysis |

#### Validation (`/api/gold-studio/validation`)

| Method | Path | Description |
|---|---|---|
| POST | `/specs/{id}/validate` | Run validation (async job) |
| GET | `/specs/{id}/runs` | Run history |
| GET | `/runs/{id}` | Single run detail |
| POST | `/runs/{id}/waiver` | File exception waiver |
| GET | `/specs/{id}/reconciliation` | Legacy vs Gold comparison |

#### Catalog (`/api/gold-studio/catalog`)

| Method | Path | Description |
|---|---|---|
| POST | `/specs/{id}/publish` | Publish (validates required fields) |
| GET | `/` | List published entries |
| GET | `/{id}` | Entry detail |
| PUT | `/{id}` | Update metadata (new revision) |
| GET | `/{id}/revisions` | Revision history |

#### Jobs (`/api/gold-studio/jobs`)

| Method | Path | Description |
|---|---|---|
| GET | `/{id}` | Job status + results |
| GET | `/` | List recent jobs |

#### Audit (`/api/gold-studio/audit`)

| Method | Path | Description |
|---|---|---|
| GET | `/log` | Audit log (filters: object_type, object_id, action, date_range) |

**Total: ~40 endpoints.**

### Integration Points

**Reads from:** `config.json` (connections), `entity_registration.json` (Silver/Bronze entities for lineage), existing control plane tables (quality scores, glossary, entity metadata).

**Writes to:** Data Catalog page (`/catalog`), Business Portal Catalog (`/catalog-portal`), Entity Digest (Gold entities registered for cross-dashboard visibility), Quality system (validation results feed quality scores).

**Future (v2):** Fabric REST API (Purview metadata push), XMLA endpoint (semantic model interrogation as import source), Fabric SQL Analytics Endpoint (Gold spec deployment/materialization).

---

## 11. Interface Design System

### Design Tokens

Working within the existing Business Portal design system:

| Token | Value | Usage |
|---|---|---|
| Canvas | `#F4F2ED` | Page background |
| Surface-1 | `#FEFDFB` | Cards, rows, slide-overs |
| Surface-inset | `#F9F7F3` | Accordion expansions, code blocks (light mode) |
| Code-block | `#2B2A27` | SQL editor, query display (dark inset) |
| Ink-primary | `#1C1917` | Primary text |
| Ink-secondary | `#57534E` | Supporting text |
| Ink-muted | `#A8A29E` | Metadata, timestamps |
| Copper | `#B45624` | Accent, in-progress, primary actions |
| Copper-soft | `rgba(180,86,36,0.1)` | Badge backgrounds, hover states |
| Warm-gold | `#C2952B` | Certified/cataloged state |
| Operational-green | `#3D7C4F` | Validated, approved, passed |
| Caution-amber | `#C27A1A` | Warnings, pending steward |
| Fault-red | `#B93A2A` | Failed, errors |
| Border-standard | `rgba(0,0,0,0.08)` | Card borders, dividers |
| Border-emphasis | `rgba(0,0,0,0.14)` | Focus, active states |

### Typography

| Role | Font | Weight | Size | Tracking |
|---|---|---|---|---|
| Page title | Instrument Serif | 400 | 24px | -0.02em |
| Hero numbers | Instrument Serif | 400 | 32px | -0.01em |
| Stat labels | Outfit | 500 | 11px | 0.05em (small-caps) |
| Body | Outfit | 400 | 14px | 0 |
| Labels | Outfit | 500 | 13px | 0 |
| Table headers | Outfit | 600 | 12px | 0.02em |
| Data cells | JetBrains Mono | 400 | 13px | 0 (tabular) |
| Code/SQL | JetBrains Mono | 400 | 13px | 0 |
| Provenance labels | JetBrains Mono | 400 | 10px | 0.03em |

### Depth Strategy

Borders only. Zero shadows (all shadow tokens set to `none`).

- Cards: `1px solid rgba(0,0,0,0.08)`
- Active/selected: `1px solid rgba(0,0,0,0.14)`
- Status rail: 3px left border (BP signature)
- Surface elevation via background tint, never shadow

### Spacing

4px base unit.

| Context | Value |
|---|---|
| Micro (icon gaps) | 4px |
| Component (button padding, input padding) | 8-12px |
| Section (between card groups) | 16-24px |
| Major (between page sections) | 32px |

### Slide-Over Pattern

Consistent across all Gold Studio pages:

| Element | Spec |
|---|---|
| Default width | 70% viewport |
| Expanded width | 88-92% viewport |
| Full-screen mode | For SQL editor, matrices |
| Fixed header | Object name, version, type badge, domain, provenance thread, status, actions |
| Tab strip | Content-specific tabs (never scrolls) |
| Content area | Scrolls independently of header |
| Footer | Contextual next-step action, always visible |
| Dismiss | Click outside, Escape, or X button |
| Backdrop | `rgba(0,0,0,0.3)` |

### Status Rail Colors

| State | Color | Hex |
|---|---|---|
| In progress | Copper | `#B45624` |
| Validated | Operational green | `#3D7C4F` |
| Gold drafted | Warm gold | `#C2952B` |
| Cataloged | Warm gold | `#C2952B` |
| Pending/queued | Muted stone | `#A8A29E` |
| Failed | Fault red | `#B93A2A` |
| Warning | Caution amber | `#C27A1A` |

---

## 12. Interaction Appendix

### A. Import Flow Edge States

| Scenario | Behavior |
|---|---|
| Unsupported file type | File picker rejects. If dragged: toast error "Unsupported file type. Accepted: .rdl, .pbix, .pbip, .tmdl, .bim" |
| Duplicate file name | Warning: "A specimen named X already exists. Import anyway?" — allows duplicate (different version/steward) |
| Partial bulk success | Each file imports independently. Failures shown in result table with per-file error. Successful imports proceed. |
| Parse warning | Specimen created, job state `parse_warning`. Specimen row shows amber rail. Extraction results available but flagged. |
| Parse failed | Specimen created, job state `parse_failed`. Red rail. Error details in expansion. "Retry" and "Delete" actions. |
| Needs connection | Extraction succeeds but source DB can't be mapped. Job state `needs_connection`. Blue badge. "Map Connection" action opens connection picker. |
| Schema pending | Extraction succeeds, schema discovery fails (VPN down). Job state `schema_pending`. "Retry Schema Discovery" button. Entities still advance to Imported provenance. |

### B. Column Reconciliation Interactions

| Interaction | Behavior |
|---|---|
| Bulk include/exclude | Checkbox column on rows. "Set Selected to Include/Exclude" toolbar action. |
| Keyboard navigation | Tab between rows, Enter to toggle decision, arrow keys for decision options. |
| Sort within matrix | Click column headers. Sort by: column name, presence count, decision status, data type. |
| Filter within matrix | Quick filter: "Show only Review", "Show only unresolved", search by column name. |
| Source expression expand | Click row → expands below with per-member source expressions, data types, calculated flags. |
| Key conflict detection | If two columns both marked as PK, warning banner: "Multiple PK candidates detected. Review grain definition." |
| Auto-suggest keys | Columns detected as PK in schema discovery get a subtle key icon suggestion. User confirms/overrides. |

### C. Validation → Waiver → Publish Flow

| State | Allowed Actions | Blocked Actions |
|---|---|---|
| Gold Drafted, no validation run | Run Validation | Publish, Certify |
| Validation running | View progress | Edit SQL, Publish |
| All critical pass | Mark Validated, then Publish | — |
| Critical failure, no waiver | File Waiver, Re-edit spec | Mark Validated, Publish |
| Critical failure + waiver filed | Mark Validated (with waiver badge), then Publish | — |
| Validated, not published | Publish to Catalog | — |
| Published, endorsement = None | Update Endorsement to Promoted or Certified | — |
| Published, spec later edited | Status → Needs Revalidation. Previous catalog entry stays but marked "source updated". Must revalidate + republish. | Publish stale version |
| Republish after version change | Creates new catalog revision. Previous revision retained in history. | Overwrite previous revision |

---

## 13. Scope Boundaries

### In v1

- All 5 Gold Studio pages (Ledger, Clusters, Canonical, Specifications, Validation)
- File parsers: RDL, PBIX, PBIP/TMDL, BIM, raw SQL
- Schema discovery via `sp_describe_first_result_set` + catalog + fallbacks
- Duplicate detection (name, column signature, query pattern)
- Column reconciliation
- Canonical entity management with versioning
- Gold spec generation with source SQL
- Validation runs with waiver model
- Catalog publication with governance metadata
- Audit log
- Business Portal integration (Data Collections, Datasets views)
- All 17 SQLite tables + ~40 API endpoints

### In v2

- XMLA/TOM-based semantic model interrogation
- Fabric REST API push to Purview
- Gold spec deployment/materialization to Fabric
- WebSocket events for async job completion
- Advanced column profiling (on-demand, not during extraction)
- Saved views persistence
- Multi-user steward workflow (assignment, approval chains)
- Relationship map editing (currently read-only)

### Not Planned

- Direct Power BI report rendering
- Data loading (LZ → Bronze → Silver handles this)
- Real-time source DB monitoring
- Automated canonical modeling without human review
