# MES Analyst - IP Corp Internal Discoveries

> **Scope:** IP Corp-specific MES findings, patterns, and learnings
> **Last Updated:** 2025-12-28
> **Status:** Seeded from database exploration - needs continuous enrichment

---

## Database Connection

| Property | Value |
|----------|-------|
| Server | SQL2012Test |
| Database | MES |
| MCP Tool | `mcp__mssql-mes__execute_sql` |
| Table Count | 443 tables |
| Access | Read-only |

---

## Company Scope

**MES serves ONLY:**
- Interplastic (IPC) - Primary resin manufacturing
- HK Research - Gel coat manufacturing

**MES does NOT serve:**
- NAC - Different system
- Molding Products - Uses MPD SHAR instead

---

## Table Categories (Verified 2025-12-28)

### ANV Tables (~64 tables)
Acidity and Viscosity monitoring system.

| Table | Purpose | Key Fields |
|-------|---------|------------|
| anv_results_hdr_tbl | Test session header | result_hdr_id, batch_id, product |
| anv_results_dtl_tbl | Individual readings | result_hdr_id, acid_number, viscosity, act_time |
| anv_product_config_hdr_tbl | Product test setup | prod_config_id, product |
| anv_product_target_tbl | Target curves | Target values by product |
| anv_viscometer_calibration_tbl | Equipment calibration | Calibration data |
| anv_ooc_comment_tbl | Out-of-control comments | OOC explanations |

### MES Batch Tables (~50 tables)
Core batch tracking.

| Table | Purpose | Key Fields |
|-------|---------|------------|
| mes_batch_hdr_tbl | Batch header (80 columns) | batch_id, item_id, batch_status, batch_date |
| mes_batch_dtl_tbl | Batch ingredients | batch_id, item_id, qty, stage_no |
| mes_batch_disp_tbl | Batch disposition | Disposition tracking |
| mes_batch_order_xref_tbl | M3 order links | batch_id ↔ M3 order |
| mes_batch_hdr_ext_tbl | Extended attributes | Additional batch data |
| mes_batch_custom_add_tbl | Custom additions | Non-formula additions |

### MES QC Tables (~42 tables)
Quality control testing.

| Table | Purpose | Key Fields |
|-------|---------|------------|
| mes_QC_test_result_hdr_tbl | Test result header | test_result_id, batch_id, status |
| mes_QC_test_result_dtl_tbl | Test result details | final_result_num, spec_id |
| mes_QC_spec_hdr_tbl | Specification header | Spec definitions |
| mes_QC_spec_dtl_tbl | Specification detail | Test limits |
| mes_QC_BEng_* | Business engineering specs | OATES integration |

### MES Formula Tables (~25 tables)
Formula management.

| Table | Purpose | Key Fields |
|-------|---------|------------|
| mes_frmla_hdr_tbl | Master formula header | formula_id, formula_rev |
| mes_frmla_dtl_tbl | Formula ingredients | Percentages, items |
| mes_frmla_whs_hdr_tbl | Warehouse formula header | Plant-specific |
| mes_frmla_whs_dtl_tbl | Warehouse formula detail | Local adjustments |
| mes_frmla_stage_tbl | Formula stages | Process stages |

### MES Cycle Time Tables (~35 tables)
Production efficiency tracking.

| Table | Purpose |
|-------|---------|
| mes_cycle_time_batch_tbl | Actual batch times |
| mes_cycle_time_std_hdr_tbl | Standard time headers |
| mes_cycle_time_std_dtl_tbl | Standard time details |
| mes_cycle_time_between_batch_tbl | Changeover times |

### Integration Tables

| Table | Purpose |
|-------|---------|
| mes_batch_order_xref_tbl | MES ↔ M3 order link |
| mes_m3_batch_lot_xref_tbl | Batch/lot cross-reference |
| mes_oates_tests_tran_tbl | OATES test transfer |
| mes_css_* | CSS (legacy) data |
| ipc_CSS_* | Legacy system tables |

### ALEL Tables (~13 tables)
Elemental analysis (lab system).

| Table | Purpose |
|-------|---------|
| alel_results_hdr_tbl | Elemental test header |
| alel_results_dtl_tbl | Elemental test detail |
| alel_product_pes_* | Product/PES configuration |

### AS Tables (~14 tables)
AspenTech scheduling integration.

| Table | Purpose |
|-------|---------|
| AS_ProcessBatch | Scheduled batches |
| AS_Orders | Order schedule |
| AS_Resource | Resource availability |

---

## Key Field Mappings

### mes_batch_hdr_tbl Critical Fields

| Field | Type | Purpose | Sample Values |
|-------|------|---------|---------------|
| batch_id | varchar(20) | Primary key | "23096", "2310456" |
| item_id | varchar(20) | Product code | "COR75-AA-066MS" |
| cmp_id | varchar(2) | Company | "CS" |
| whs_id | varchar(4) | Warehouse | "102" |
| formula_id | varchar(20) | Formula reference | Same as item_id |
| batch_status | varchar(20) | Status | "created", "active", "closed" |
| batch_date | date | Production date | |
| batch_size | int | Target size | |
| batch_yield | int | Actual yield | |
| vessel_id | varchar(10) | Production vessel | |
| created_by | varchar(56) | Creator | |
| sample_status | varchar(15) | QC sample status | "Approved to Ship" |
| ship_status | varchar(20) | Shipping status | |

### anv_results_dtl_tbl Critical Fields

| Field | Type | Purpose |
|-------|------|---------|
| result_hdr_id | int | FK to header |
| batch_id | varchar(25) | Batch reference |
| stage_no | int | Process stage |
| acid_number | float | Acid reading |
| viscosity | float | Viscosity reading |
| act_time | datetime | Test time |
| rx_temp | varchar(25) | Reaction temp |
| suggested_adj | varchar(50) | System suggestion |
| actual_adj | varchar(50) | Operator action |

---

## Status Codes

### Batch Status (mes_batch_hdr_tbl.batch_status)

| Code | Meaning |
|------|---------|
| created | Initial state |
| released | Ready for production |
| active | In production |
| completed | Production complete |
| closed | Fully finalized |

### Sample Status (mes_batch_hdr_tbl.sample_status)

| Value | Meaning |
|-------|---------|
| "Approved to Ship" | QC passed, ready to ship |
| NULL | Not yet tested |

---

## Integration Patterns

### Batch ID Flow

```
MES (batch_id: "2310456")
    ↓
mes_m3_batch_lot_xref_tbl
    ↓
M3 (MILOMA.MLBANO)
    ↓
ETL Pipeline
    ↓
IPC_PowerData
    ↓
Power BI Reports
```

### M3 Order Integration

```
M3 Work Order → mes_batch_order_xref_tbl → MES Batch
                        ↓
             batch_id ↔ M3 order number
```

---

## Known Data Patterns

### 1. Batch ID Format
- Numeric strings: "23096", "2310456"
- May have leading spaces in some tables
- Use TRIM() when joining

### 2. Date Storage
- batch_date: DATE type
- crt_dt/chg_dt: DATETIME type
- No integer date format (unlike M3)

### 3. Company Codes
- "CS" = Interplastic (likely)
- Need to verify other codes

### 4. Warehouse Codes
- "102" = Verified warehouse
- Full warehouse list needs discovery

---

## Archive Tables

Several tables have archive versions (suffix _ARC):
- mes_QC_test_result_hdr_tbl_ARC
- mes_QC_test_result_dtl_tbl_ARC
- mes_cycle_time_batch_tbl_ARC
- mes_oates_tests_tran_tbl_arc

**Pattern:** Historical data moved to archive for performance.

---

## Temporary/Work Tables

Tables with tmp_, x_, X_ prefixes are temporary/backup:
- tmp_* - Temporary work tables
- x_* - Archived/backup copies
- X_* - Same as x_

**Do not use for production queries.**

---

## Unanswered Questions

These need investigation:

1. What are all valid cmp_id (company) codes?
2. What are all valid whs_id (warehouse) codes?
3. How does OATES integration work exactly?
4. What triggers mes_oates_tests_tran_tbl population?
5. How are formulas versioned in practice?
6. What is the AS_* (AspenTech) integration status?
7. What is the mes_css_* legacy system relationship?

---

## Discovery Log

| Date | Discovery | Source | Verified |
|------|-----------|--------|----------|
| 2025-12-28 | 443 tables total | INFORMATION_SCHEMA | Yes |
| 2025-12-28 | mes_batch_hdr_tbl has 80 columns | Schema query | Yes |
| 2025-12-28 | Sample batch from 2006 exists | Data sample | Yes |
| 2025-12-28 | cmp_id "CS" in use | Data sample | Yes |
| 2025-12-28 | whs_id "102" in use | Data sample | Yes |

---

## Related Resources

- [Industry Expertise](./industry-expertise.md) - General MES knowledge
- [Table Catalog](./table-catalog.json) - Full table inventory
- [Integration Mapper Agent](../integration-mapper/) - Cross-system flows
- [M3 Analyst](../m3-analyst/) - ERP side of integration
