# Microsoft Fabric Migration Strategy

> **Purpose**: Architecture and implementation strategy for the Fabric data platform
> **Last Updated**: January 2026

---

## Strategic Vision

Transform IP Corp's fragmented data landscape into a **unified analytics platform** using Microsoft Fabric's **Medallion Architecture** (Bronze/Silver/Gold).

### Target Outcomes
- Single source of truth across all companies
- Self-service analytics with governance
- Manufacturing intelligence from MES data
- Column-level lineage via Microsoft Purview

---

## Current State Assessment

### Data Infrastructure Today

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        M3 ERP (Source of Truth)                              │
│                                                                              │
│  Interplastic + HK Research (On-Prem)    NAC + Molding Products (Cloud)     │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │
                              │ ETL (Scheduled Jobs)
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
        ▼                                           ▼
┌───────────────────────┐                ┌───────────────────────┐
│    DiverData          │                │    IPC_PowerData      │
│    (SQL2012Test)      │                │    (SQL2019Live)      │
│  • Legacy analytics   │                │  • Modern analytics   │
│  • Interplastic + HK  │                │  • MP + NAC data      │
└───────────┬───────────┘                └───────────┬───────────┘
            │                                        │
            ▼                                        ▼
┌───────────────────────┐                ┌───────────────────────┐
│  Interplastic Sales   │                │    MP Sales BI        │
│  Power BI Model       │                │    Power BI Model     │
└───────────────────────┘                └───────────────────────┘
```

### Key Issues with Current State
| Issue | Impact |
|-------|--------|
| Siloed data sources | No unified view across companies |
| Manual ETL | Not metadata-driven; truncate/reload daily |
| Schema inconsistencies | M3 On-Prem vs Cloud differences |
| Limited self-service | Business depends on IT for reports |
| No lineage tracking | Can't trace data origin or changes |

---

## Target Architecture: Medallion in Fabric

### Workspace Strategy

**Decision**: 1 capacity per entity with domains separated within

```
IP Corp Fabric Tenant
│
├── Interplastic Capacity (F64)
│   ├── Bronze Lakehouse
│   │   ├── m3_raw (M3 ERP tables)
│   │   ├── mes_raw (MES tables)
│   │   └── sf_raw (Salesforce staging)
│   ├── Silver Lakehouse
│   │   ├── sales_cleaned
│   │   ├── manufacturing_cleaned
│   │   └── customer_cleaned
│   ├── Gold Warehouse
│   │   ├── dim_product
│   │   ├── dim_customer
│   │   ├── fact_sales
│   │   └── fact_production
│   └── Semantic Models
│       └── interplastic_sales
│
├── HK Research Capacity (F64)
│   └── (Same structure as Interplastic)
│
├── NAC Capacity (F64)
│   ├── Bronze Lakehouse
│   │   ├── m3_raw (M3 Cloud tables)
│   │   └── sf_raw (Salesforce staging)
│   ├── Silver/Gold (Same pattern)
│   └── NOTE: No manufacturing domain
│
├── Molding Products Capacity (F64)
│   └── (Same pattern, MPD SHAR for manufacturing)
│
└── Enterprise Capacity
    ├── Gold Warehouse (aggregated cross-company)
    └── Executive Semantic Models
```

### Why This Structure?

| Decision | Rationale |
|----------|-----------|
| **1 capacity per entity** | Company isolation requirement; cost allocation |
| **Domains within capacity** | Logical separation without cross-capacity limitations |
| **Separate Enterprise capacity** | Cross-company reporting without drill-through |

### Fabric Limitation to Know
> "You can't do it across — like you can't say I want to pull data from this semantic model in this capacity" — Steve

**Workaround**: Reports connect directly to Gold warehouse for cross-capacity needs, not semantic models.

---

## Data Layer Definitions

### Bronze Layer (Raw Data Landing)
| Attribute | Value |
|-----------|-------|
| **Purpose** | Ingest raw data with minimal transformation |
| **Format** | Delta tables in Lakehouse |
| **Transformations** | Add audit columns (load_date, source_system) |
| **Retention** | Full history for audit/replay |
| **Refresh** | Incremental where possible; full reload for small tables |

### Silver Layer (Cleansed & Conformed)
| Attribute | Value |
|-----------|-------|
| **Purpose** | Clean, deduplicate, apply business rules |
| **Format** | Delta tables in Lakehouse |
| **Transformations** | Data type standardization, null handling, cross-source conformance |
| **Key Activities** | M3 On-Prem/Cloud schema normalization, date standardization |

### Gold Layer (Business-Ready)
| Attribute | Value |
|-----------|-------|
| **Purpose** | Star schema for analytics |
| **Format** | SQL Warehouse tables |
| **Transformations** | Dimension/fact modeling, aggregations, KPI calculations |
| **Consumption** | Semantic models, direct query, ad-hoc analysis |

---

## Data Domain Strategy

### Starting Domain: Product
**Why Product first?**
- Shared across all companies
- Well-understood data structure
- Foundation for Sales and Manufacturing domains
- Explicitly agreed with CIO (Dec 13 meeting)

### Domain Roadmap

| Phase | Domain | Source Systems | Companies |
|-------|--------|----------------|-----------|
| **POC** | Product | M3 (MITMAS) | All |
| **Phase 2** | Sales | M3, Salesforce, IPC_PowerData | All |
| **Phase 3** | Manufacturing | MES, M3 (MWOHED, MWOMAT) | Interplastic, HK only |
| **Phase 4** | Customer | M3 (OCUSMA), Salesforce | All |
| **Phase 5** | Finance | M3 financials | All (isolated) |

---

## Data Pipeline Patterns

### Pattern 1: M3 ERP Ingestion
```
M3 Source (MVXJDTA.MITMAS)
    │
    └── Data Pipeline (copy activity)
           │
           ├── Bronze: m3_raw.mitmas
           │     └── Add: load_timestamp, source_instance
           │
           └── Silver: products_cleaned.items
                 └── Transform: normalize schema (On-Prem vs Cloud)
                 └── Transform: standardize dates (YYYYMMDD → DATE)
                 └── Transform: decode status codes
```

### Pattern 2: MES Manufacturing Data
```
MES Source (mes_batch_* tables)
    │
    └── Data Pipeline
           │
           ├── Bronze: mes_raw.batches
           │     └── Key: batch_id (universal key)
           │
           └── Silver: manufacturing_cleaned.production_batches
                 └── Join: ANV (acidity/viscosity)
                 └── Join: OATES (QC results)
                 └── Calculate: yield metrics
```

### Pattern 3: Cross-System Gold
```
Silver.products_cleaned + Silver.sales_cleaned + Silver.customers_cleaned
    │
    └── Gold Warehouse
           │
           ├── dim_product (SCD Type 2)
           ├── dim_customer (SCD Type 2)
           ├── dim_date (calendar)
           └── fact_sales (grain: invoice line)
```

---

## Environment Strategy

### Decision: Wipe Trial and Start Fresh

Per Mike Spencer (Dec 13): "Wipe the Fabric trial and start clean with a proper Dev/Test/Prod strategy."

### Proposed Environment Model

| Environment | Purpose | Data | Refresh |
|-------------|---------|------|---------|
| **Dev** | Pipeline development | Sample/synthetic | Manual |
| **Test** | Integration testing | Production subset | Daily |
| **Prod** | Production workloads | Full production | Per schedule |

### Data Gateway Requirements
- **On-prem gateway**: SQL2012Test, SQL2019Dev, M3Dev-DB1
- **Cloud gateway**: M3 Cloud connection (if direct connect supported)
- **Existing gateways**: May reuse if available

---

## Governance Framework

### Naming Conventions
| Object | Pattern | Example |
|--------|---------|---------|
| **Lakehouse** | `{entity}_{layer}` | `interplastic_bronze` |
| **Table** | `{domain}_{object}` | `sales_invoices` |
| **Pipeline** | `pl_{source}_{target}` | `pl_m3_bronze_products` |
| **Dataflow** | `df_{domain}_{action}` | `df_sales_cleanse` |
| **Semantic Model** | `sm_{entity}_{domain}` | `sm_interplastic_sales` |

### Access Control
| Layer | Access Pattern |
|-------|---------------|
| **Bronze** | Data engineers only |
| **Silver** | Data engineers + analysts (read) |
| **Gold** | All authorized users |
| **Semantic Models** | Business users |

### Row-Level Security
Required for any cross-company views:
- Filter by company code
- Use Purview policies where possible
- No financial drill-through across companies

---

## Microsoft Purview Integration

### Why Purview?

Microsoft Purview provides the **data governance layer** for the entire Fabric implementation:

| Capability | Business Value |
|------------|----------------|
| **Data Catalog** | Searchable inventory of all data assets |
| **Business Glossary** | Standardized definitions across IP Corp |
| **Column-Level Lineage** | Source-to-report traceability |
| **Impact Analysis** | Understand downstream effects of changes |
| **Data Classification** | Automated PCI, PII, SSN detection |
| **Policy Management** | Centralized access governance |

### Lineage Vision

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    PURVIEW COLUMN-LEVEL LINEAGE                               │
│                                                                               │
│  M3 ERP                      Fabric                         Power BI         │
│  ┌─────────┐               ┌─────────────┐               ┌─────────────┐     │
│  │ MITMAS  │──────────────►│   Bronze    │───────────────►│            │     │
│  │ MMITNO  │   copy        │  m3_mitmas  │  transform    │  dim_product│     │
│  │ MMITDS  │               │  item_no    │───────────────►│  product_id│     │
│  │ MMITGR  │               │  item_desc  │               │  product_nm │     │
│  └─────────┘               │  item_group │               │            │     │
│                            └──────┬──────┘               └──────┬──────┘     │
│                                   │                              │           │
│                                   ▼                              ▼           │
│                            ┌─────────────┐               ┌─────────────┐     │
│                            │   Silver    │───────────────►│   Report    │     │
│                            │  products   │               │  Sales by   │     │
│                            │  cleaned    │               │  Product    │     │
│                            └──────┬──────┘               └─────────────┘     │
│                                   │                                          │
│                                   ▼                                          │
│                            ┌─────────────┐                                   │
│                            │    Gold     │        ◄── Impact Analysis:       │
│                            │ dim_product │            "What reports break    │
│                            │             │             if I change this      │
│                            └─────────────┘             column?"              │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Key Purview Capabilities

#### 1. Data Catalog
- Automatically scan and catalog all Fabric artifacts
- Searchable by business users ("find all sales data")
- Asset descriptions and ownership

#### 2. Business Glossary
- Standardized term definitions
- Link glossary terms to physical columns
- Example: "Batch ID" → definition + linked columns across all systems

#### 3. Column-Level Lineage
- **Source to Target**: Track data from M3 table → Bronze → Silver → Gold → Power BI
- **Automated**: Purview scans Fabric pipelines automatically
- **No Manual Documentation**: Mike Spencer requirement met

#### 4. Impact Analysis
- "What happens if I modify this column?"
- Identify all downstream dependencies
- Plan changes with full visibility

#### 5. Data Classification
| Classification | Policy Status |
|----------------|---------------|
| PCI | In simulation |
| SSN | In simulation |
| PII | In simulation |

### Purview Implementation Phases

| Phase | Activities |
|-------|------------|
| **Phase 1** | Enable Fabric-Purview integration; scan Bronze/Silver/Gold |
| **Phase 2** | Build business glossary (starting with key terms) |
| **Phase 3** | Configure classification policies for production |
| **Phase 4** | Train data stewards on lineage and impact analysis |

### Governance Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Microsoft Purview                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Catalog   │  │   Glossary  │  │   Lineage   │             │
│  │  (Assets)   │  │  (Terms)    │  │  (Tracing)  │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                      │
│         └────────────────┼────────────────┘                      │
│                          │                                       │
│                          ▼                                       │
│                   ┌─────────────┐                                │
│                   │   Policies  │                                │
│                   │ (Access,    │                                │
│                   │ Classification)│                             │
│                   └─────────────┘                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Microsoft Fabric                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐    │
│  │ Bronze  │──│ Silver  │──│  Gold   │──│ Semantic Models │    │
│  │Lakehouse│  │Lakehouse│  │Warehouse│  │    (Power BI)   │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Approach

### Parallel Run Strategy
1. Build Fabric pipeline alongside existing ETL
2. Compare outputs for validation
3. Gradual migration of downstream reports
4. Decommission legacy only after validation

### Existing Report Migration
| Current State | Migration Path |
|---------------|----------------|
| SSRS reports | Rebuild in Power BI on Fabric |
| Power BI (DiverData) | Repoint to Gold warehouse |
| Power BI (IPC_PowerData) | Repoint to Gold warehouse |

---

## Cost Estimation

### Fabric Capacity Pricing (Estimated)

| SKU | CU/hour | Monthly Cost | Recommended For |
|-----|---------|--------------|-----------------|
| F2 | 2 | ~$263 | Dev/test |
| F64 | 64 | ~$8,424 | Production start |
| F128 | 128 | ~$16,848 | Growth |
| F256 | 256 | ~$33,696 | Enterprise |

### Recommended Starting Point
- **4 × F64** (one per entity): ~$33,700/month
- **1 × F2** (Enterprise/Dev): ~$263/month
- **Total**: ~$34,000/month (~$408K/year)

### Cost Optimization
- Auto-pause for non-production capacities
- Start with smaller SKUs, scale as needed
- Monitor CU consumption and right-size

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Schema differences (On-Prem vs Cloud) | Normalize in Silver layer; document transformations |
| MES-only companies have different data | Separate manufacturing domain; don't assume universal |
| Performance at scale | Start small; benchmark; scale capacity as needed |
| User adoption | Training not an afterthought; brand with corporate look |
| Legacy report dependencies | Parallel run; don't decommission until validated |

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Data freshness | < 1 hour for critical data |
| Report creation time | < 1 day for standard reports |
| Self-service adoption | 50%+ of new reports by business users |
| Data quality score | > 95% completeness in Gold |
| Cross-company report time | < 5 seconds for standard views |
