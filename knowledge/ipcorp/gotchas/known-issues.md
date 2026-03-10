# Known Issues and Gotchas

> **Purpose**: Critical pitfalls, workarounds, and important warnings
> **Last Updated**: January 2026

---

## Critical Rules

### 1. Database Authentication

| Rule | Details |
|------|---------|
| **ALWAYS use SQL Authentication** | Windows Auth has NO database access |
| **Account** | `UsrSQLRead` |
| **Impact** | High — queries will fail silently with wrong auth |

**Example Error Pattern**:
```
INTERPLASTIC\SNahrup has NO database access
```

**Solution**: Always use SQL Authentication credentials, never Windows Auth.

---

### 2. MES Data Availability

| Company | MES Data? | Notes |
|---------|-----------|-------|
| **Interplastic** | Yes | Full MES integration |
| **HK Research** | Yes | Full MES integration |
| **NAC** | **NO** | Distribution only, no manufacturing |
| **Molding Products** | **Limited** | MPD SHAR only ("MES Light") |

**Impact**: High — Don't assume manufacturing metrics exist for all companies.

**Rule**: Only query MES data for Interplastic and HK Research.

---

### 3. M3 Data Freshness

| Database | Delay | Notes |
|----------|-------|-------|
| M3 Prod Actual | ~30 minutes | Log-shipped replica |
| DiverData | Daily | ETL refresh from M3 |
| IPC_PowerData | Daily | ETL refresh from M3 |

**Impact**: Medium — Account for delay in reporting requirements.

**Rule**: Don't use log-shipped databases for real-time data needs.

---

### 4. Cross-Company Financial Isolation

| Restriction | Details |
|-------------|---------|
| **NAC cannot see Interplastic numbers** | Financial data isolation required from Day 1 |
| **Company cost visibility** | Careful handling needed |

**Impact**: High — Security and compliance requirement.

**Solution**: Implement row-level security (RLS) in all reporting layers.

---

## Systems That Do NOT Exist

| System | Status | Use Instead |
|--------|--------|-------------|
| **PlantPAx** | Does NOT exist | FactoryTalk Batch |

**Note**: If anyone mentions PlantPAx, they likely mean FactoryTalk Batch.

---

## M3 ERP Gotchas

### 6-Character Naming Convention

M3 uses cryptic 6-character names for ALL database objects:
- `MITMAS` = Item Master
- `OOLINE` = Order Lines
- `OCUSMA` = Customer Master

**Solution**: Use Metadata Publisher (MDP) to decode table/field names.

### Schema Differences

| Environment | Schema Pattern |
|-------------|----------------|
| M3 On-Prem | `MVXJDTA.TableName` |
| M3 Cloud | No schema prefix |

**Impact**: Data pipelines must normalize schema differences in Silver layer.

### Date Storage

M3 stores dates as 8-digit integers (YYYYMMDD format):
```sql
-- Convert M3 date to actual date
CAST(CAST(OAORDT AS VARCHAR) AS DATE)
```

### Decimal Fields

Many M3 fields have implied decimals:
```sql
-- Some quantity fields store 1000 meaning 10.00
OBORQA / 100.0 AS ActualQuantity
```

---

## Power BI Gotchas

### 1. YTD Margin Calculation Bug

**Evidence**: Exec Dashboard shows YTD Margin ($0M) with -103.21% change

**Problem**: Can't aggregate a percentage with DATESYTD
```dax
// PROBLEMATIC
Margin% YTD = CALCULATE([Margin %], DATESYTD('Date Table'[Date]))

// FIX
Margin% YTD = DIVIDE([Margin YTD], [Sales Amt YTD], 0) * 100
```

### 2. Yesterday's Sales Always Blank

**Problem**: Uses `TODAY()` but data may not include today-1 yet

```dax
// PROBLEMATIC - uses TODAY()
Yesterday's Sales = CALCULATE([Sales AMT Total],
    FILTER(ALL('Date Table'), 'Date Table'[Date] = TODAY() - 1))

// FIX - use Max Sales Date
Yesterday's Sales =
VAR LastDate = MAX('Sales Data'[invoice_date])
RETURN CALCULATE([Sales AMT Total], 'Date Table'[Date] = LastDate)
```

### 3. IsPast Filter for YTD Comparisons

**Rule**: Always use `IsPast` filter when comparing YTD to LYTD
```dax
Sales Amt LYTD = CALCULATE(
    [Sales Amt YTD],
    SAMEPERIODLASTYEAR('Date Table'[Date]),
    'Date Table'[IsPast] = TRUE()  -- Critical!
)
```

**Reason**: Prevents comparing full prior year to partial current year.

---

## Integration Gotchas

### MES ↔ M3 Integration

| Fact | Details |
|------|---------|
| **Success Rate** | ~98-99% |
| **Failures** | Logged, require manual intervention |
| **Direction** | Bi-directional |

> "We've gotten it down to probably about 98–99% of them make it through... but there's always something" — Matt Pennaz

### Salesforce ↔ M3 Integration

| Aspect | Details |
|--------|---------|
| **Tool** | DBAmp |
| **Direction** | Bi-directional |
| **System of Record** | **M3** (not Salesforce) |
| **Sync Schedule** | NAC 5am, Interplastic 6am, MP 7am, then every 4 hours |

**Rule**: M3 is the system of record. Salesforce data can be overwritten by M3.

### ETQ Integration

| Aspect | Details |
|--------|---------|
| **Method** | Direct DB loads from M3 |
| **NOT** | Through ION/BODs |

---

## DiverData Gotchas

### Not a Source System of Record

> "DiverData is technically not the source system of record. It's actually the 'DataWarehouse' information for Sales coming from M3. There are scheduled jobs that purge recent data and pull updated data back down." — Patrick Stiller

**Impact**: Design for eventual consistency; recent data may be refreshed.

---

## M3 Table Discovery Pain Point

> "There's nothing telling you that if you're looking for this, look at this table. You have to go in there and be like 'I'm looking for this. Does this table have the things I am trying to get?'" — Eudias

**Solution for Fabric**: Build a metadata catalog in Bronze layer that documents M3 table purposes.

---

## Quick Reference: What NOT to Assume

| Assumption | Reality |
|------------|---------|
| Windows Auth works | NO — use SQL Auth |
| All companies have MES data | NO — only Interplastic & HK Research |
| Data is real-time | NO — log-shipping has 30-min delay |
| PlantPAx exists | NO — it's FactoryTalk Batch |
| Salesforce is system of record | NO — M3 is the source of truth |
| M3 Cloud has schema prefix | NO — only On-Prem has schema |
| Companies can see each other's financials | NO — isolation required |
