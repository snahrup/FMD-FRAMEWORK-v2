# M3 Analyst - IP Corp Internal Discoveries

> **Scope:** IP Corp-specific M3 findings, patterns, and learnings
> **Last Updated:** 2025-12-28
> **Status:** Seeded from Feed - needs continuous enrichment

---

## Company Configuration

| Company | CONO | ERP Instance | MES Integration |
|---------|------|--------------|-----------------|
| Interplastic (IPC) | 100 | M3 On-Prem | YES - Bi-directional |
| HK Research | 200 | M3 On-Prem | YES - Bi-directional |
| NAC | TBD | M3 Cloud | NO |
| Molding Products | TBD | M3 Cloud | NO |

**Discovery Note:** Exact CONO values need verification from live queries.

---

## Database Connections

| Purpose | Server | Database | MCP Tool |
|---------|--------|----------|----------|
| M3 Production Data | M3Dev-DB1 | M3FDBTST | `mcp__mssql-m3-fdb__execute_sql` |
| ETL Staging | SQL2016Dev | M3TST-ETL | `mcp__mssql-m3-etl__execute_sql` |

**Discovery:** M3FDBTST contains ~3,949 tables (needs verification when accessible)

---

## Integration Patterns

### Batch ID as Universal Key

The **Batch ID** is the universal cross-system identifier:

```
MES (Origin) ──► M3 On-Prem ──► ETL Staging ──► IPC_PowerData ──► Power BI
```

**Key Finding:** MES ↔ M3 sync has ~98-99% success rate. The 1-2% failures require manual investigation.

### M3 → MES Sync

- Work orders created in M3 sync to MES for execution
- Material issues recorded in MES sync back to M3
- Batch completion in MES triggers M3 inventory updates

### M3 → ETL Flow

- ETL jobs pull from M3 On-Prem nightly
- Staging tables in M3TST-ETL normalize data
- Final load to IPC_PowerData for analytics

---

## Known Tables (Verified in IP Corp)

### Core Tables Used

| Table | Purpose | IP Corp Usage |
|-------|---------|---------------|
| MITMAS | Item Master | All products/items |
| OOLINE | Order Lines | Sales order details |
| OOHEAD | Order Headers | Sales orders |
| OCUSMA | Customer Master | Customer data |
| CIDMAS | Company/Division | Company structure |
| MITBAL | Item Balance | Inventory levels |
| MWOHED | Work Order Header | Manufacturing orders |
| MWOMAT | Work Order Material | MO materials |

### Custom/Extension Tables

| Table | Purpose | Notes |
|-------|---------|-------|
| *To be discovered* | | Run schema discovery when DB accessible |

---

## Schema Patterns (IP Corp Specific)

### On-Prem Schema Usage

```sql
-- Interplastic/HK Research use these schemas:
SELECT * FROM MVXJDTA.MITMAS WHERE MMCONO = 100
-- or
SELECT * FROM MBXJDTA.MITMAS WHERE MMCONO = 100
```

**Discovery Needed:** Which schema (MVXJDTA vs MBXJDTA) is primary?

---

## Known Issues & Gotchas

### 1. Company Filter Required
**Issue:** Queries without CONO filter return cross-company data
**Solution:** ALWAYS include `WHERE xxCONO = [company]`

### 2. Date Format
**Issue:** Dates stored as INT (YYYYMMDD)
**Solution:** Cast to VARCHAR then DATE for formatting

### 3. Implied Decimals
**Issue:** Some quantity fields have implied decimal places
**Solution:** Check field definition, divide by 100 or 10000 as needed

### 4. Schema Prefix (On-Prem Only)
**Issue:** Cloud queries fail with schema prefix, On-Prem fails without
**Solution:** Use MVXJDTA or MBXJDTA for On-Prem only

---

## Unanswered Questions

These questions need investigation:

1. What is the exact CONO for each company?
2. Which schema (MVXJDTA vs MBXJDTA) is standard?
3. What custom Z-tables exist?
4. What CUGEX* extension tables are used?
5. How are lot numbers structured?
6. What is the work order numbering sequence?

---

## Discovery Log

| Date | Discovery | Source | Verified |
|------|-----------|--------|----------|
| 2025-12-28 | Seeded with Feed knowledge | Feed doc | Partial |

---

## Related Resources

- [Industry Expertise](./industry-expertise.md) - General M3 knowledge
- [Table Catalog](./table-catalog.json) - Full table inventory
- [Integration Mapper Agent](../integration-mapper/) - Cross-system flows
