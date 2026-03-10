# IP Corp Data Architecture

> **Purpose**: Data flows, cross-system identifiers, and ETL patterns
> **Last Updated**: January 2026

---

## The Universal Key: Batch ID

**Batch ID is THE cross-system key** for manufacturing traceability at IP Corp.

```
BATCH ID FLOW: MES → M3 → ETL → Analytics

┌─────────────────────────────────────────────────────────────────────┐
│  1. MES (Origin)                                                    │
│     • Batch created when production starts                          │
│     • Tables: MES.dbo.* (54 ANV tables, 18 OATES tables)           │
│     • Links to: ANV (acidity/viscosity), OATES, Optiva (formulas)  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Bi-directional (~98-99% success)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. M3 On-Prem (ERP Integration)                                    │
│     • Receives: Consumption data, finished goods                    │
│     • Sends: Product IDs, GUIDs, formulation links                 │
│     • Updates: Raw material reduction, FG inventory increase        │
│     • Database: M3FDBTST on M3Dev-DB1                              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Log-shipped (30-min delay)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. M3 Prod Actual / ETL Staging                                    │
│     • Read-only reporting copy                                      │
│     • Database: M3TST-ETL on SQL2016Dev                            │
│     • Daily stored proc → staging tables                           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ ETL refresh (daily)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. SQL Mini-DWH / Power BI                                         │
│     • Denormalized analytics views                                  │
│     • Database: IPC_PowerData on SQL2019Dev                        │
│     • Batch ID enables: Traceability, yield analysis, QC linkage   │
└─────────────────────────────────────────────────────────────────────┘
```

**Critical Constraint**: Batch ID flow is **Interplastic & HK Research ONLY**. NAC and Molding Products have NO MES integration.

---

## Key Identifiers Across Systems

| Identifier | Scope | Systems | Details |
|------------|-------|---------|---------|
| **Batch ID** | Universal manufacturing key | MES, ANV, OATES, M3 On-Prem | THE key for traceability |
| **GUID (per batch)** | Batch-to-formula link | MES ↔ M3 On-Prem | Links MES batch to M3 formulation |
| **Item Number (MMITNO)** | Product identifier | M3, Optiva, MES | Alphanumeric; 6-char M3 field naming |
| **Customer Number (OKCUNO)** | Customer identifier | M3, Salesforce | Synced via DBAmp |
| **Order Number (OAORNO)** | Sales/production order | M3, Salesforce, MES | Links sales to manufacturing |
| **KONO+SUNO** | M3 natural key | M3, Salesforce | With DIVI/WHLO scope |

---

## M3 ERP Data Architecture

### Naming Convention
M3 uses a strict **6-character naming convention** for ALL database objects.

**Structure**: `PPNNNN`
- **PP** (2 chars): Program/Module prefix
- **NNNN** (4 chars): Object identifier

### Core M3 Tables

| Table | Full Name | Purpose | Key Fields |
|-------|-----------|---------|------------|
| **MITMAS** | Item Master | Product/item definitions | MMITNO, MMITDS, MMITGR, MMITCL |
| **OOLINE** | Order Lines | Sales order line items | OBORNO, OBPONR, OBITNO, OBORQT |
| **OOHEAD** | Order Headers | Sales order headers | OAORNO, OACUNO, OAORDT |
| **OCUSMA** | Customer Master | Customer definitions | OKCUNO, OKCUNM, OKSTAT |
| **CIDMAS** | Company/Division | Company/division master | CCCONO, CCDIVI |
| **MITBAL** | Item Balance | Inventory balances | MBWHLO, MBITNO, MBSTQT |
| **MWOHED** | Work Order Header | Manufacturing orders | VHWHLO, VHPRNO, VHMFNO |
| **MWOMAT** | Work Order Material | MO material requirements | VMWHLO, VMMFNO, VMMTNO |

### Schema Differences

| Environment | Schema Pattern | Example |
|-------------|----------------|---------|
| **M3 On-Prem** | `MBXJDTA.TableName` or `MVXJDTA.TableName` | `MVXJDTA.MITMAS` |
| **M3 Cloud** | No schema prefix | `MITMAS` |

**Implication**: Data pipelines must normalize schema differences in Silver layer.

### M3 Data Type Quirks

**Dates**: Stored as 8-digit integers (YYYYMMDD format)
```sql
-- Convert M3 date
CAST(CAST(OAORDT AS VARCHAR) AS DATE)
```

**Decimals**: Many fields have implied decimals
```sql
-- Some quantity fields store 1000 meaning 10.00
OBORQA / 100.0 AS ActualQuantity
```

---

## MES Database Architecture

### Table Categories

| Prefix | Count | Purpose |
|--------|-------|---------|
| `mes_*` | 239 | Core MES functionality |
| `anv_*` | 54 | Acidity & Viscosity system |
| `ipc_*` | 44 | IP Corp specific tables |
| `oates_*` | 18 | OATES integration |
| `optiva_*` | 9 | Optiva PLM integration |
| `AS_*` | 13 | Application Server |

### Key MES Table Patterns

| Pattern | Purpose | Key Tables |
|---------|---------|------------|
| `mes_batch*` | Batch processing | ~100 tables |
| `mes_oates*` | QC integration | `mes_oates_tests_tran_tbl` |
| `mes_optiva*` | Formula integration | `mes_optiva_change_notify_tbl` |

---

## Current ETL Architecture

### DiverData ETL (Interplastic Analytics)

**Source**: M3 ERP
**Target**: DiverData on SQL2012Test
**Pattern**: Truncate/reload via stored procedures

| Procedure | Purpose |
|-----------|---------|
| `usp_trd_CustomerDim` | Populates CustomerDim |
| `usp_trd_ProductDim` | Populates ProductDim |
| `usp_trd_SalesRepDim` | Populates SalesRepDim |
| `usp_trd_WarehouseDim` | Populates WarehouseDim |
| `usp_load_m3_diver_data_new` | Main sales fact loader |

**Important**: DiverData is NOT a source system of record. It's a data warehouse aggregating sales data from M3 via scheduled ETL jobs.

> "DiverData is technically not the source system of record. It's actually the 'DataWarehouse' information for Sales coming from M3. There are scheduled jobs that purge recent data and pull updated data back down." — Patrick Stiller

### Current Table Inventory (DiverData)

| Table | Rows | Purpose |
|-------|------|---------|
| `M3_trd_sales_ssrs_tbl` | 213,703 | Main sales fact |
| `ProductDim` | 17,802 | Product dimension |
| `CustomerDim` | 1,873 | Customer dimension |
| `SalesRepDim` | 45 | Sales rep dimension |
| `WarehouseDim` | 22 | Warehouse dimension |

### IPC_PowerData ETL (MP/NAC Analytics)

| Schema | Table | Purpose |
|--------|-------|---------|
| `sales` | `ipc_mp_sales` | MP division sales fact |
| `sales` | `ipc_nac_Sales` | NAC sales data |
| `dbo` | Various Dims | Dimension tables |

---

## Data Flow Diagrams

### MES ↔ M3 On-Prem (Critical Integration)

```
┌─────────────────┐           ┌─────────────────┐
│       MES       │           │   M3 On-Prem    │
│  (Home-built)   │◄─────────►│   (Infor M3)    │
│                 │           │                 │
│ • Batch start   │ ────────► │ • Raw material  │
│ • Consumption   │           │   reduction     │
│ • Yield data    │           │ • FG inventory  │
│                 │           │   increase      │
│ • Formulations  │ ◄──────── │ • Product IDs   │
│ • GUIDs         │           │ • GUIDs         │
└─────────────────┘           └─────────────────┘
        │                              │
        │    ~98-99% Success Rate      │
        │    Failures: logged,         │
        │    manual intervention       │
        └──────────────────────────────┘
```

### Salesforce ↔ M3 (Both Instances)

```
┌─────────────────┐           ┌─────────────────┐
│   Salesforce    │           │      M3         │
│     (CRM)       │◄─────────►│ (System of      │
│                 │   DBAmp   │  Record)        │
│ • Customer      │           │                 │
│   updates       │ ────────► │ • Customer      │
│ • Order         │           │   master        │
│   requests      │           │                 │
│                 │ ◄──────── │ • Product info  │
│                 │           │ • Pricing       │
└─────────────────┘           └─────────────────┘

Sync Schedule:
  NAC: 5am
  Interplastic: 6am
  MP: 7am
  Repeats every 4 hours
```

### ETQ Data Flow (One-Way)

```
M3 ERP ──── Direct DB Loads ───► ETQ
                                 (HSE, QC)

Note: NOT through ION/BODs
Contact: Matt Francis
```

---

## Data Quality Considerations

### Known Data Quality Patterns

| System | Issue | Mitigation |
|--------|-------|------------|
| M3 | 6-char field names hard to interpret | Use Metadata Publisher (MDP) |
| MES | Exception records when integration fails | Build error handling |
| DiverData | Purge/reload creates gaps | Design for eventual consistency |
| Salesforce | Bi-directional sync conflicts | M3 is system of record |

### M3 Table Discovery Pain Point

> "There's nothing telling you that if you're looking for this, look at this table. You have to go in there and be like 'I'm looking for this. Does this table have the things I am trying to get?'" — Eudias

**Solution for Fabric**: Build a metadata catalog in Bronze layer that documents M3 table purposes.

---

## Data Lineage Requirements

### Microsoft Purview Integration

From Mike Spencer meeting:
- **Column-level lineage** required via Purview
- Documentation should NOT be manual
- Purview policies already in simulation (PCI, SSN, PII)

### Lineage Tracking Strategy

| Layer | Lineage Requirement |
|-------|---------------------|
| **Bronze** | Source system, extraction timestamp |
| **Silver** | Transformation applied, source Bronze table |
| **Gold** | Business rules, source Silver tables, calculation logic |
| **Semantic Model** | Measure definitions, source Gold tables |

---

## Access and Authentication

### Database Access Pattern

**Rule**: Always use SQL Authentication
- Account: `UsrSQLRead`
- Windows Auth (INTERPLASTIC\SNahrup) has NO database access

### MCP Connection Mapping

| MCP Server | Database | Access Status |
|------------|----------|---------------|
| `mssql-powerdata` | IPC_PowerData | Full |
| `mssql-mes` | MES, DiverData | Full |
| `mssql-m3-fdb` | M3FDBPRD | Full |
| `mssql-m3-etl` | M3TST-ETL | Full |
