# FMD Business Portal — Implementation Spec

**Date**: 2026-03-16
**Branch**: `feat/business-portal` (from `feat/server-refactor`)
**Author**: Steve Nahrup
**Source**: `deep-research-report.md` + brainstorming session
**Wireframes**: `.superpowers/brainstorm/130-1773660833/bp-*.html`

---

## 1. Problem Statement

The FMD dashboard is built for engineers. It exposes 42 pages of pipeline internals, entity registries, watermark configs, GUIDs, and debug tools. Business users (analysts, ops leaders, data stewards) need to check data freshness, find tables, understand trust, and request new data — without learning the words "entity," "LZ," "watermark," or "GUID."

## 2. Solution: Two-Mode Interface

A **Business Portal** mode (default) with 6 focused pages and business vocabulary, alongside the existing **Engineering Console** (unchanged, all 42 pages). Users switch between modes via a toggle. No separate codebase — same React app, same API server.

### 2.1 Design Decisions (Locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth/RBAC | Mode toggle only (no auth) | Keep scope manageable. Real RBAC deferred to future phase. |
| Alerts data source | Hybrid — Phase 1 wraps existing ErrorIntelligence data; schema designed for Phase 2 alert engine | Ship fast, evolve later |
| Business metadata | Partially populated from glossary/classification work | Catalog launches with what exists, editing added later |
| Purview integration | We OWN metadata, sync TO Purview | Purview lacks quality scores, business names, SLA tracking. We're the source of truth for business context, Purview is the lineage/discovery layer. |
| Gold layer | Consume `/api/gold/*` endpoints (being built by parallel session) | Catalog shows Gold domains as "Data Collections" — the curated, business-ready layer |
| Source scalability | All UI scales to N sources | Current 5 are just the first wave. No hardcoded source lists anywhere. |
| Vocabulary | "table" is the atomic unit, not "dataset" or "entity" | Business users think in tables — that's what they see in source systems |
| Design system | Apply to Engineering Console too (future phase) | Steve wants unified visual identity across the entire product |

### 2.2 Vocabulary Layer

New module: `src/lib/vocabulary.ts`

```typescript
export type Mode = "business" | "engineering";

const VOCAB: Record<string, Record<Mode, string>> = {
  entity:       { business: "table",                engineering: "entity" },
  dataSource:   { business: "source",               engineering: "data source" },
  register:     { business: "connect",              engineering: "register" },
  landingZone:  { business: "source files",         engineering: "landing zone" },
  bronze:       { business: "raw data",             engineering: "bronze" },
  silver:       { business: "clean data",           engineering: "silver" },
  gold_domain:  { business: "data collection",      engineering: "gold domain" },
  gold_model:   { business: "dataset",              engineering: "gold model" },
  isActive:     { business: "included in updates",  engineering: "active" },
  watermark:    { business: "incremental settings", engineering: "watermark" },
  model_type:   { business: "(hidden)",             engineering: "model type" },
  column_count: { business: "fields",               engineering: "columns" },
  row_count:    { business: "records",              engineering: "rows" },
};

export function t(term: string, mode: Mode): string;
export function useVocabulary(): { t: (term: string) => string; mode: Mode };
```

Wraps `usePersona()` context (already exists in AppLayout). Engineering mode returns terms unchanged.

---

## 3. Design System

**Direction**: Industrial Precision, Light Mode — manufacturing control room meets editorial authority.

### 3.1 Palette (CSS Custom Properties)

Added to `src/index.css` as a Business Portal theme layer:

```css
:root {
  /* Canvas & Surfaces — warm paper */
  --bp-canvas: #F4F2ED;
  --bp-surface-1: #FEFDFB;
  --bp-surface-2: #F9F7F3;
  --bp-surface-inset: #EDEAE4;

  /* Text — warm near-black like printed specs */
  --bp-ink-primary: #1C1917;
  --bp-ink-secondary: #57534E;
  --bp-ink-tertiary: #78716C;
  --bp-ink-muted: #A8A29E;

  /* Accent — copper/terracotta from the manufacturing domain */
  --bp-copper: #B45624;
  --bp-copper-light: #F4E8DF;
  --bp-copper-hover: #9A4A1F;

  /* Status — industrial indicator lights */
  --bp-operational: #3D7C4F;
  --bp-operational-light: #E7F3EB;
  --bp-caution: #C27A1A;
  --bp-caution-light: #FDF3E3;
  --bp-fault: #B93A2A;
  --bp-fault-light: #FBEAE8;

  /* Borders — whisper-quiet */
  --bp-border: rgba(0,0,0,0.08);
  --bp-border-subtle: rgba(0,0,0,0.04);
  --bp-border-strong: rgba(0,0,0,0.14);
}
```

### 3.2 Typography

Google Fonts import added to `index.html`:
- **Display/Headlines**: `Instrument Serif` — editorial authority, page titles and hero KPI numbers only
- **Body/UI**: `Outfit` — geometric sans with warmth, everything else
- **Data/Mono**: `JetBrains Mono` with `font-feature-settings: "tnum"` — numbers, timestamps, table names

### 3.3 Depth Strategy

**Borders-only + surface color shifts. ZERO drop shadows.**
- Cards: `border: 1px solid var(--bp-border)` on `var(--bp-surface-1)`
- Inset areas (search, inputs): `var(--bp-surface-inset)` background
- Separation via canvas vs surface-1 vs surface-2

### 3.4 Signature Element: Status Rail

Every card with a status gets a **3px left-edge color strip** (factory floor status LED):
- `var(--bp-operational)` = healthy/on-time
- `var(--bp-caution)` = degraded/at-risk
- `var(--bp-fault)` = critical/failed (CSS pulse animation)

### 3.5 Spacing & Radius

- Base: 4px. Scale: 4, 8, 12, 16, 24, 32, 48, 64
- Card padding: 20px. Section gaps: 24px. Page padding: 32px.
- Border radius: 6px (small/inputs), 8px (cards), 12px (modals)

---

## 4. Architecture

### 4.1 What Changes

```
src/
├── contexts/
│   └── PersonaContext.tsx          # EXISTS — add mode persistence to localStorage
├── lib/
│   └── vocabulary.ts              # NEW — vocabulary mapping module
├── components/
│   └── layout/
│       └── AppLayout.tsx          # MODIFY — Business Portal nav already defined, wire up design system
│       └── BusinessShell.tsx      # NEW — Business Portal wrapper (applies BP CSS vars, fonts)
│   └── business/                  # NEW directory
│       ├── StatusRail.tsx         # Signature element component
│       ├── KpiCard.tsx            # Reusable KPI card with Instrument Serif number
│       ├── SourceBadge.tsx        # Colored dot + label, dynamic from useSourceConfig
│       ├── SeverityBadge.tsx      # Critical/Warning/Info badge
│       ├── QualityTierBadge.tsx   # Gold/Silver/Bronze metallic badges
│       └── AlertCard.tsx          # Alert list item with status rail
├── pages/
│   └── business/                  # NEW directory — all Business Portal pages
│       ├── BusinessOverview.tsx   # Landing page
│       ├── BusinessAlerts.tsx     # Alert inbox
│       ├── BusinessSources.tsx    # Source browser
│       ├── BusinessCatalog.tsx    # Data catalog (entity digest + Gold domains)
│       ├── DatasetDetail.tsx      # Single table/model detail
│       ├── BusinessRequests.tsx   # Request form + history
│       └── BusinessHelp.tsx       # Glossary + getting started
├── hooks/
│   └── useAlerts.ts              # NEW — computed alerts from existing data
│   └── useVocabulary.ts          # NEW — vocabulary hook wrapping PersonaContext

api/routes/
├── alerts.py                     # NEW — alert computation endpoint
├── requests.py                   # NEW — data request CRUD (SQLite-backed)
```

### 4.2 What Does NOT Change

- All 42 existing Engineering Console pages — untouched
- All existing API endpoints — untouched
- `useEntityDigest`, `useSourceConfig` hooks — consumed as-is
- Python server, router, SQLite DB — no structural changes

### 4.3 Route Changes (App.tsx)

```typescript
// Business Portal routes (inside BusinessShell wrapper)
<Route path="/overview" element={<BusinessOverview />} />
<Route path="/alerts" element={<BusinessAlerts />} />
<Route path="/sources-portal" element={<BusinessSources />} />
<Route path="/catalog-portal" element={<BusinessCatalog />} />
<Route path="/catalog-portal/:id" element={<DatasetDetail />} />
<Route path="/requests" element={<BusinessRequests />} />
<Route path="/help" element={<BusinessHelp />} />

// Default route changes by mode
<Route path="/" element={<Navigate to={isBusiness ? "/overview" : "/matrix"} />} />
```

Engineering routes remain unchanged. Business-only URLs that an engineer navigates to directly show a gentle redirect: "This page is in Business mode" with a switch link.

---

## 5. Page Specifications

### 5.1 Business Overview (`/overview`)

**Wireframe**: `bp-overview.html`
**Data sources**: `/api/control-plane`, `useEntityDigest()`, `useSourceConfig()`
**No new API endpoints needed.**

**Layout**:
- Asymmetric KPI row: Data Freshness (1.5x wide, SVG progress ring) + Open Alerts + Sources Online + Total Tables
- 60/40 main split: Recent Alerts (top 5 from `useAlerts`) | Source Health (scrollable list) + Recent Activity feed

**Freshness calculation**: `(entities where lastLoad < threshold) / totalActive * 100`. Threshold configurable per source (default 4 hours), stored in source config.

### 5.2 Alerts Inbox (`/alerts`)

**Wireframe**: `bp-alerts.html`
**Data sources**: New `useAlerts()` hook composing `/api/control-plane` + `useEntityDigest()` + `/api/gold/domains`
**New API endpoint**: `GET /api/alerts` (computed, no DB in Phase 1)

**Alert types (Phase 1 — derived from existing data)**:

| Type | Source | Severity Logic |
|------|--------|---------------|
| Failed refresh | Pipeline run failures from control-plane | Critical if >10 tables, Warning if 1-10 |
| Freshness SLA breach | lastLoad timestamp vs threshold | Critical if >2x threshold, Warning if >1x |
| Source unreachable | Connection test failures | Critical always |
| Quality drop | Quality scores from `/api/mdm/quality` | Warning if score drops >10% |

**Alert shape**:
```typescript
interface Alert {
  id: string;               // deterministic hash of type+source+timestamp
  type: "failure" | "freshness" | "connection" | "quality";
  severity: "critical" | "warning" | "info";
  source: string;           // dynamic from useSourceConfig
  title: string;            // e.g. "MES — 12 tables failed to refresh"
  detail: string;
  tablesAffected: number;
  firstSeen: string;
  acknowledged: boolean;    // localStorage in Phase 1
}
```

**New backend**: `api/routes/alerts.py` — `GET /api/alerts` computes alerts on-the-fly from control-plane DB + entity digest. No new SQLite tables in Phase 1.

**Phase 2 schema** (designed now, built later):
```sql
CREATE TABLE alerts (
  AlertId INT IDENTITY PRIMARY KEY,
  AlertType VARCHAR(50),
  Severity VARCHAR(20),
  SourceName VARCHAR(100),
  Title NVARCHAR(500),
  Detail NVARCHAR(MAX),
  TablesAffected INT,
  FirstSeen DATETIME2,
  AcknowledgedBy NVARCHAR(100) NULL,
  ResolvedBy NVARCHAR(100) NULL,
  ResolvedAt DATETIME2 NULL,
  ResolutionNotes NVARCHAR(MAX) NULL
);
```

### 5.3 Sources (`/sources-portal`)

**Wireframe**: `bp-sources.html`
**Data sources**: `useSourceConfig()`, `useEntityDigest()`, `/api/connections`
**No new API endpoints.**

**Layout**:
- KPI row: Sources Connected, Total Tables, On Schedule %, New Tables Available
- Auto-wrapping source card grid (CSS `auto-fill`, min 280px — scales to N)
- Each card: source name, status rail, health indicator, table count (large JetBrains Mono), last refresh, "View tables →"
- "Connect New Source" button → opens simplified wizard (existing `SourceOnboardingWizard` with `mode="simple"` prop that hides advanced fields by default)
- Below: searchable table list with source filter dropdown

**What's hidden vs Engineering SourceManager**: GUIDs, watermark columns, PK optimizer, bulk delete, cascade impact, gateway connections, Fabric expression references, dev error messages.

### 5.4 Data Catalog (`/catalog-portal`)

**Wireframe**: `bp-catalog.html`
**Data sources**: `useEntityDigest()`, `/api/gold/domains`, `/api/gold/domains/:id`, `/api/gold/models/:id`, `useSourceConfig()`

**Two browsing modes (tabs)**:

**Tab 1: "Data Collections" (default)** — Gold domains
- Card grid of domains from `/api/gold/domains`
- Each card: domain name, plain-English description, dataset count ("X datasets"), freshness, status indicator
- Click → drill into domain showing models as "Datasets" (use `business_name`, hide `model_name`, `model_type`, `source_sql`, `silver_dependencies`)
- Click a dataset → `/catalog-portal/:id` (DatasetDetail page)

**Tab 2: "All Source Tables"** — Entity digest
- Hero search bar (48px, full-width)
- Filter chips: source (dynamic), quality tier, domain, sort
- Card grid: table name, source badge, domain tag, quality tier badge, description preview, last refreshed
- Click → `/catalog-portal/entity-:id` (DatasetDetail page, entity mode)

**Vocabulary applied**: `gold_domain` → "Data Collection", `gold_model` → "Dataset", `model_type` → hidden, `column_count` → "Fields", `row_count_approx` → "Records"

### 5.5 Dataset Detail (`/catalog-portal/:id`)

**Wireframe**: `bp-dataset-detail.html`
**Data sources**: `/api/gold/models/:id` (for Gold models) OR `useEntityDigest().findEntity()` (for raw tables)

**Layout**:
- Breadcrumb: Catalog → [Collection or Source] → [Table/Dataset name]
- Hero: name in Instrument Serif, source badge, domain tag, quality gauge (SVG circle)
- 60/40 columns:
  - Left: About (description, business name, tags), Freshness (timestamp, frequency, SLA status), Quality (score, tier, top issues)
  - Right: "Where Used" (stub — "Coming soon"), "Technical Details" (collapsed accordion: schema.table, server, database, layer status, PKs, watermark, load type)
- For Gold models: show columns with `business_name` and `description`, hide `source_column`, `is_key`

### 5.6 Requests (`/requests`)

**Wireframe**: `bp-requests.html`
**New API endpoints**: `GET /api/requests`, `POST /api/requests`
**New SQLite table**: `data_requests`

```sql
CREATE TABLE data_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source_name TEXT,
  description TEXT,
  justification TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'submitted',
  admin_response TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Layout**: 55/45 split — request form (left) + request history (right)

### 5.7 Help & Glossary (`/help`)

**Wireframe**: `bp-help.html`
**Data sources**: Static content (hardcoded glossary terms + getting started cards). Future: `/api/glossary` from Purview sync.

**Layout**: 60/40 — searchable glossary (left) + getting started guides (right)

**Glossary terms**: Table, Source, Source Files (LZ), Raw Data (Bronze), Clean Data (Silver), Data Collection (Gold Domain), Dataset (Gold Model), Quality Score, Freshness, SLA, Domain, Full Load, Incremental Load

Each term: business definition + collapsible "Technical equivalent" with engineering term.

---

## 6. Purview Integration Strategy

**Phase 1 (this build)**: We own all business metadata. Stored in SQLite (`entity_annotations`, `quality_scores` tables already exist). Edited via the dashboard UI. No Purview dependency.

**Phase 2 (future)**: Sync our metadata TO Purview via Purview REST API / Atlas API. Push business names, descriptions, domains, tags, quality scores as annotations on Purview assets. This enriches Purview's catalog with our curated context.

**Phase 3 (future)**: Optionally embed Purview's lineage visualization (iframe or API-driven) for cross-estate search and lineage tracing — things Purview does genuinely better than we could build.

**Rationale**: Purview doesn't auto-generate business descriptions, quality scores, SLA tracking, domain assignments, or Gold model business names. We're the source of truth for business context. Purview is the discovery/lineage layer.

---

## 7. New Backend Endpoints Summary

| Endpoint | Method | Module | Purpose |
|----------|--------|--------|---------|
| `GET /api/alerts` | GET | `alerts.py` | Computed alerts from existing data (no new DB) |
| `GET /api/requests` | GET | `requests.py` | List data requests |
| `POST /api/requests` | POST | `requests.py` | Create data request |
| `PATCH /api/requests/{id}` | PATCH | `requests.py` | Update request status/response (admin) |

Gold endpoints (`/api/gold/*`) are being built by a parallel session — not part of this spec.

---

## 8. Implementation Phases

### Phase 1: Foundation (Tasks 1-5)

| # | Task | Effort | Files |
|---|------|--------|-------|
| 1 | Create `vocabulary.ts` + `useVocabulary` hook | Low | `src/lib/vocabulary.ts`, `src/hooks/useVocabulary.ts` |
| 2 | Add BP design tokens to `index.css` + Google Fonts to `index.html` | Low | `index.css`, `index.html` |
| 3 | Create `BusinessShell.tsx` wrapper (applies BP theme when in business mode) | Low | `src/components/layout/BusinessShell.tsx` |
| 4 | Create shared Business Portal components (`StatusRail`, `KpiCard`, `SourceBadge`, `SeverityBadge`, `QualityTierBadge`, `AlertCard`) | Medium | `src/components/business/*.tsx` |
| 5 | Wire Business Portal routes in `App.tsx`, update default route by mode | Low | `src/App.tsx` |

### Phase 2: Core Pages (Tasks 6-10)

| # | Task | Effort | Files | Dependencies |
|---|------|--------|-------|-------------|
| 6 | Build `BusinessOverview.tsx` — KPIs, alerts summary, source health, activity feed | Medium | `src/pages/business/BusinessOverview.tsx` | Tasks 1-5 |
| 7 | Build `alerts.py` backend + `useAlerts` hook + `BusinessAlerts.tsx` | Medium | `api/routes/alerts.py`, `src/hooks/useAlerts.ts`, `src/pages/business/BusinessAlerts.tsx` | Tasks 1-5 |
| 8 | Build `BusinessSources.tsx` — source cards, table browser, simplified wizard | Medium | `src/pages/business/BusinessSources.tsx` | Tasks 1-5 |
| 9 | Build `BusinessCatalog.tsx` — dual-tab (Data Collections + All Tables), card grids | High | `src/pages/business/BusinessCatalog.tsx` | Tasks 1-5, Gold APIs |
| 10 | Build `DatasetDetail.tsx` — detail page for Gold models AND raw entities | High | `src/pages/business/DatasetDetail.tsx` | Task 9 |

### Phase 3: Supporting Pages (Tasks 11-13)

| # | Task | Effort | Files | Dependencies |
|---|------|--------|-------|-------------|
| 11 | Build `requests.py` backend + `BusinessRequests.tsx` | Medium | `api/routes/requests.py`, `src/pages/business/BusinessRequests.tsx` | Tasks 1-5 |
| 12 | Build `BusinessHelp.tsx` — glossary + getting started | Low | `src/pages/business/BusinessHelp.tsx` | Tasks 1-5 |
| 13 | Update `AppLayout.tsx` sidebar — BP design tokens when in business mode, engineering mode unchanged | Medium | `src/components/layout/AppLayout.tsx` | Tasks 1-5 |

### Phase 4: Polish & Integration (Tasks 14-16)

| # | Task | Effort | Files | Dependencies |
|---|------|--------|-------|-------------|
| 14 | Business-safe error states — replace dev instructions with "Contact admin" / "Retry" | Low | Multiple pages | All pages built |
| 15 | URL guard — engineering URLs in business mode show redirect message | Low | `App.tsx` or `BusinessShell.tsx` | Task 5 |
| 16 | QA pass — test all 7 pages at 5, 10, 20 source counts + responsive breakpoints | Medium | — | All tasks |

### Future Phases (Not This Build)

- **Engineering Console reskin** — apply same design system (tokens, typography, status rails) to all 42 engineering pages
- **Real RBAC** — wire into Windows Auth via IIS reverse proxy, AD group → role mapping
- **Purview sync** — push metadata TO Purview via REST API
- **Purview embed** — iframe lineage visualization
- **Alert engine Phase 2** — DB-backed alerts with rules, ownership, resolution tracking, email notifications
- **Analytics** — navigation telemetry to understand which pages business users actually use

---

## 9. Parallel Execution Strategy

Tasks 1-5 (Foundation) must be sequential — each builds on the prior.

Tasks 6-12 (Pages) can be parallelized in 2-3 agent teams after Foundation is complete:
- **Team A**: Overview + Alerts (Tasks 6-7) — these share the alert data pipeline
- **Team B**: Sources + Catalog + Detail (Tasks 8-10) — these share entity/source data
- **Team C**: Requests + Help + AppLayout (Tasks 11-13) — independent pages

Task 13 (AppLayout) should go last in Team C since it touches shared infrastructure.

Tasks 14-16 (Polish) are sequential after all pages are built.

---

## 10. Wireframe Reference

All wireframes at `.superpowers/brainstorm/130-1773660833/`:

| File | Page | Status |
|------|------|--------|
| `bp-overview.html` | Business Overview | Final |
| `bp-alerts.html` | Alerts Inbox | Final |
| `bp-sources.html` | Sources | Final |
| `bp-catalog.html` | Data Catalog | Final (needs Gold Collections tab added) |
| `bp-dataset-detail.html` | Dataset Detail | Final |
| `bp-requests.html` | Requests & Tasks | Final |
| `bp-help.html` | Help & Glossary | Final |
| `bp-navigation.html` | Nav Comparison | Reference only |
| `index.html` | Master Index | Reference only |

---

## 11. Acceptance Criteria

- [ ] Business user can complete 4 key tasks (check freshness, find table, understand quality, request data) without seeing "entity", "LZ", "watermark", or "GUID"
- [ ] Business Portal nav has exactly 6 items
- [ ] Mode toggle persists to localStorage, defaults to Business
- [ ] All source lists render correctly at 5, 10, and 20 sources
- [ ] Alert cards display with status rails and pulse animation for critical
- [ ] Catalog shows both Data Collections (Gold) and All Source Tables (entity digest)
- [ ] Dataset detail works for both Gold models and raw entities
- [ ] Engineering Console is completely unchanged
- [ ] Design system matches wireframes (Instrument Serif, Outfit, JetBrains Mono, copper accent, status rails, no shadows)
