# Gold Layer Backend — Handoff for Business Portal Agent

> **From:** FMD_FRAMEWORK engineering session (Gold layer spec)
> **For:** The session building the Business Portal (bp-overview.html, bp-alerts.html, etc.)
> **Date:** 2026-03-16
> **Status:** Design approved, implementation pending

---

## Context

The Engineering UI session is building Gold layer management — domain-based star schemas that sit on top of the Silver layer. The Business Portal needs a **Catalog page** that lets business users browse what's available in Gold without seeing any engineering internals.

The Gold layer models are created externally (Dataflow Gen2, Fabric notebooks, SQL views). FMD's dashboard tracks them as metadata in SQLite.

---

## API Endpoints the Catalog Page Should Consume

```
GET /api/gold/domains
→ [{ id, name, description, model_count, last_refreshed, status }]

GET /api/gold/domains/:id
→ {
    id, name, description,
    models: [{
      id, model_name, model_type, business_name, description,
      column_count, row_count_approx, last_refreshed, status
    }]
  }

GET /api/gold/models/:id
→ {
    id, model_name, model_type, business_name, description,
    columns: [{ column_name, business_name, description, data_type }],
    last_refreshed, row_count_approx
  }
```

---

## What the Catalog Page Should Show

Business users see domains as **"Data Collections"** — never "Gold Models" or "Star Schemas."

### Catalog Landing
- Card grid of domains
- Each card: domain name, plain-English description, number of available datasets, freshness indicator
- Use the same panel/card patterns from `bp-overview.html`

### Domain Drill-In
- List of models within the domain, labeled as **"Datasets"** or **"Views"**
- Show `business_name` (NOT `model_name`), description, column count, freshness
- **Hide**: `model_type`, `source_sql`, Silver dependencies — those are engineering concerns

### Dataset Detail
- Column list showing `business_name`, `description`, `data_type`
- **Hide**: `source_column` lineage, `is_key` flags, `is_nullable`

---

## Terminology Mapping

| Engineering (API field) | Business Portal Label |
|---|---|
| `gold_domains` | Data Collections |
| `gold_models` | Datasets |
| `model_type` (fact/dimension/bridge/aggregate) | Hidden |
| `model_name` | Hidden (use `business_name` instead) |
| `source_sql` | Hidden |
| `silver_dependencies` | Hidden |
| `last_refreshed` | Last updated |
| `column_count` | Fields |
| `row_count_approx` | Records |
| `status: active` | Available |
| `status: draft` | Coming soon |
| `status: deprecated` | Hidden entirely |

---

## Expected Domains (IP Corp)

These are the Gold layer domains that will exist. The Catalog page should handle N domains dynamically, but these are the known ones:

| Domain | Description | Key Datasets |
|---|---|---|
| **Sales Analytics** | Orders, shipments, customer activity | FactOrderLines, DimCustomer, DimProduct, DimDate |
| **Production Analytics** | Batch tracking, cycle times, quality | FactBatches, DimFormula, DimVessel, DimShift |
| **Enterprise Core** | Shared dimensions used across all domains | DimCustomer, DimProduct, DimPlant, DimDate |
| **OT/Process Analytics** | (Future) Process parameters, golden batch | Not yet populated |

---

## Sidebar Nav

The Catalog page is already in the Business Portal sidebar (`bp-overview.html` line 520-522):
```html
<a class="nav-item" href="bp-catalog.html">
  <svg><!-- book icon --></svg>
  Catalog
</a>
```

---

## Design Tokens (Same as bp-overview.html)

- **Fonts:** Instrument Serif (page titles), Outfit (body), JetBrains Mono (counts/data values)
- **Canvas:** `#F4F2ED`
- **Surface:** `#FEFDFB`
- **Copper accent:** `#B45624` (links, active states)
- **Panels:** 8px radius, `1px solid rgba(0,0,0,0.08)`, panel-header with `border-bottom`
- **Operational green:** `#3D7C4F` (freshness/healthy indicators)
- **Caution:** `#C27A1A` (stale data warnings)

---

## SQLite Schema (For Reference)

```sql
CREATE TABLE gold_domains (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    description     TEXT,
    workspace_id    TEXT,
    lakehouse_name  TEXT,
    lakehouse_id    TEXT,
    owner           TEXT,
    status          TEXT DEFAULT 'active',
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE gold_models (
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
    status              TEXT DEFAULT 'draft',
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE gold_model_columns (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id        INTEGER NOT NULL REFERENCES gold_models(id),
    column_name     TEXT NOT NULL,
    data_type       TEXT,
    business_name   TEXT,
    description     TEXT,
    is_key          INTEGER DEFAULT 0,
    is_nullable     INTEGER DEFAULT 1,
    source_column   TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE gold_relationships (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id           INTEGER NOT NULL REFERENCES gold_domains(id),
    from_model_id       INTEGER NOT NULL REFERENCES gold_models(id),
    from_column         TEXT NOT NULL,
    to_model_id         INTEGER NOT NULL REFERENCES gold_models(id),
    to_column           TEXT NOT NULL,
    relationship_type   TEXT CHECK(relationship_type IN ('one-to-many','many-to-one','one-to-one','many-to-many')),
    created_at          TEXT DEFAULT (datetime('now'))
);
```

---

## What's NOT the Business Portal's Concern

- Relationship diagram (Engineering UI only)
- Model registration / sync from lakehouse
- Silver dependency tracking
- Source SQL viewing/editing
- Cleansing rule management
- Domain/model CRUD operations (Engineering UI only)

The Business Portal is **read-only** for Gold layer data. All management happens in Engineering mode.
