# IP Corp Source Databases

> **Purpose**: Connection details and characteristics of all 4 on-premises source databases used by the FMD Framework
> **Last Updated**: March 2026

---

## Connection Summary

| Source | Server | Database | IP Address | Tables | Status |
|--------|--------|----------|------------|--------|--------|
| **MES** | `m3-db1` | `mes` | 172.29.97.151 | 586 | Active |
| **ETQ** | `M3-DB3` | `ETQStagingPRD` | 172.29.97.162 | 29 | Active |
| **M3 ERP** | `sqllogshipprd` | `m3fdbprd` | 172.29.97.115 | 3,973 | Active |
| **M3 Cloud** | `sql2016live` | `DI_PRD_Staging` | 172.29.97.101 | 188 | Active |

### Authentication

| Property | Value |
|----------|-------|
| **Method** | Windows Authentication via VPN |
| **Connection String** | `Trusted_Connection=yes;TrustServerCertificate=yes` |
| **Driver** | `ODBC Driver 18 for SQL Server` |
| **VPN Required** | Yes -- all source databases are on-premises behind the corporate network |

**IMPORTANT**: Use short hostnames only. Do NOT append `.ipaper.com` suffix -- DNS resolution will fail.

---

## MES (Manufacturing Execution System)

| Property | Value |
|----------|-------|
| **Server** | `m3-db1` |
| **Database** | `mes` |
| **IP Address** | 172.29.97.151 |
| **Table Count** | 586 |
| **Registered Entities** | 445 |
| **Data Source ID** | 4 |
| **Companies Served** | Interplastic, HK Research ONLY |

### Table Categories

| Prefix | Count | Purpose |
|--------|-------|---------|
| `mes_batch_*` | ~100 | Core batch tracking (header, detail, disposition, cross-refs) |
| `anv_*` | ~64 | Acidity & Viscosity monitoring (real-time cooking guidance) |
| `mes_QC_*` | ~42 | Quality control testing results and specifications |
| `mes_frmla_*` | ~25 | Formula management (master + warehouse formulas) |
| `mes_cycle_time_*` | ~35 | Production efficiency tracking and changeover times |
| `AS_*` | ~14 | AspenTech scheduling integration |
| `alel_*` | ~13 | Elemental analysis (lab system) |
| `ipc_*` | ~44 | IP Corp-specific custom tables |

### Key Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `mes_batch_hdr_tbl` | Batch header (80 columns) | `batch_id`, `item_id`, `batch_status`, `batch_date` |
| `mes_batch_dtl_tbl` | Batch ingredients | `batch_id`, `item_id`, `qty`, `stage_no` |
| `anv_results_hdr_tbl` | ANV test session header | `result_hdr_id`, `batch_id`, `product` |
| `anv_results_dtl_tbl` | ANV individual readings | `acid_number`, `viscosity`, `act_time` |
| `mes_QC_test_result_hdr_tbl` | QC test result header | `test_result_id`, `batch_id`, `status` |
| `mes_batch_order_xref_tbl` | MES-to-M3 order link | `batch_id` to M3 order number |

### Notes
- Home-built system -- not commercial software
- **Batch ID** is the universal cross-system key linking MES, ANV, OATES, and M3
- MES-M3 integration success rate: ~98-99%; failures require manual intervention
- Archive tables use `_ARC` suffix (e.g., `mes_QC_test_result_hdr_tbl_ARC`)
- Temporary/work tables use `tmp_`, `x_`, `X_` prefixes -- do NOT use for production queries
- Company code `cmp_id = "CS"` = Interplastic (verified)

---

## ETQ (Excellence Through Quality)

| Property | Value |
|----------|-------|
| **Server** | `M3-DB3` |
| **Database** | `ETQStagingPRD` |
| **IP Address** | 172.29.97.162 |
| **Table Count** | 29 |
| **Registered Entities** | 29 |
| **Data Source ID** | 9 |
| **Companies Served** | All |

### Integration Pattern
- Receives data via **direct DB loads from M3** (NOT through ION/BODs)
- One-way: M3 --> ETQ only
- HSE (Health, Safety, Environment) and QC system
- Contact: Matt Francis for integration details

---

## M3 ERP (On-Premises)

| Property | Value |
|----------|-------|
| **Server** | `sqllogshipprd` |
| **Database** | `m3fdbprd` |
| **IP Address** | 172.29.97.115 |
| **Table Count** | 3,973 |
| **Registered Entities** | Not yet registered (depends on gateway connection MT-31) |
| **Companies Served** | Interplastic (CONO 100), HK Research (CONO 200) |

### Schema Pattern
- On-Prem uses schema prefixes: `MVXJDTA.TableName` or `MBXJDTA.TableName`
- Example: `SELECT * FROM MVXJDTA.MITMAS WHERE MMCONO = 100`

### Core Tables

| Table | Full Name | Purpose | Key Fields |
|-------|-----------|---------|------------|
| `MITMAS` | Item Master | Product/item definitions | `MMITNO`, `MMITDS`, `MMITGR` |
| `OOLINE` | Order Lines | Sales order line items | `OBORNO`, `OBPONR`, `OBITNO` |
| `OOHEAD` | Order Headers | Sales order headers | `OAORNO`, `OACUNO`, `OAORDT` |
| `OCUSMA` | Customer Master | Customer definitions | `OKCUNO`, `OKCUNM`, `OKSTAT` |
| `CIDMAS` | Company/Division | Company/division master | `CCCONO`, `CCDIVI` |
| `MITBAL` | Item Balance | Inventory balances | `MBWHLO`, `MBITNO`, `MBSTQT` |
| `MWOHED` | Work Order Header | Manufacturing orders | `VHWHLO`, `VHPRNO`, `VHMFNO` |
| `MWOMAT` | Work Order Material | MO material requirements | `VMWHLO`, `VMMFNO`, `VMMTNO` |

### M3 Data Quirks
- **6-character naming**: All table and field names use cryptic `PPNNNN` format (PP = module prefix, NNNN = identifier)
- **Dates as integers**: Stored as YYYYMMDD -- cast via `CAST(CAST(OAORDT AS VARCHAR) AS DATE)`
- **Implied decimals**: Some quantity fields store `1000` meaning `10.00` -- divide by 100
- **Company filter required**: Queries without `WHERE xxCONO = [company]` return cross-company data
- **Log-shipped replica**: ~30-minute delay from production; do NOT use for real-time needs
- Use **Metadata Publisher (MDP)** to decode table/field names

---

## M3 Cloud (DI_PRD_Staging)

| Property | Value |
|----------|-------|
| **Server** | `sql2016live` |
| **Database** | `DI_PRD_Staging` |
| **IP Address** | 172.29.97.101 |
| **Table Count** | 188 |
| **Registered Entities** | 185 |
| **Data Source ID** | 7 |
| **Companies Served** | NAC, Molding Products |

### Schema Pattern
- Cloud has **NO schema prefix** -- just `SELECT * FROM MITMAS`
- Same M3 table names as on-prem but no `MVXJDTA.` / `MBXJDTA.` prefix
- Data pipelines must normalize schema differences in the Silver layer

### Key Differences from On-Prem
| Aspect | On-Prem | Cloud |
|--------|---------|-------|
| Schema prefix | `MVXJDTA.Table` | No prefix |
| Companies | Interplastic, HK Research | NAC, Molding Products |
| MES integration | Full bi-directional | NONE |
| ION middleware | Yes | Yes |
| MECH component | Yes | No (on-prem only) |

---

## FMD Framework Connection Configuration

### Connection IDs in SQL Metadata Database

| Connection Name | Connection ID | Type | Source |
|-----------------|---------------|------|--------|
| CON_FMD_M3DB1_MES | `eace5b34-df2e-4057-a01f-5770ab3f9003` | SQL | MES |
| CON_FMD_M3DB3_ETQSTAGINGPRD | `c5cd66d8-3503-44de-9934-e04715697906` | SQL | ETQ |
| CON_FMD_FABRIC_SQL | `0f86f6a1-9f84-44d1-b977-105b5179c678` | SQL | Fabric SQL DB |

### Entity Registration Summary

| Source | Entities | LZ | Bronze | Silver | Registration |
|--------|----------|----|--------|--------|--------------|
| MES (DS 4) | 445 | 445 | 445 | 445 | Complete |
| ETQ (DS 9) | 29 | 29 | 29 | 29 | Complete |
| M3 Cloud (DS 7) | 185 | 185 | 185 | 185 | Complete |
| M3 ERP (on-prem) | -- | -- | -- | -- | Pending (MT-31) |
| **Total** | **659** | **659** | **659** | **659** | |

---

## Related Files

- [source-databases/m3/internal-discoveries.md](source-databases/m3/internal-discoveries.md) -- M3 ERP specific findings
- [source-databases/mes/internal-discoveries.md](source-databases/mes/internal-discoveries.md) -- MES database findings
- [data-flows/architecture.md](data-flows/architecture.md) -- Cross-system data flows and Batch ID lineage
- [systems/landscape.md](systems/landscape.md) -- Full 28+ system inventory
