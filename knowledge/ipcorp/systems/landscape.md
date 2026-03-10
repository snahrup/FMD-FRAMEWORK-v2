# IP Corp Systems Landscape

> **Purpose**: Complete inventory of all systems with integration details
> **Total Systems**: 28+ identified systems
> **Last Updated**: January 2026

---

## Systems by Category

### ERP Systems

| System | Description | Companies | Key Details |
|--------|-------------|-----------|-------------|
| **M3 On-Prem** | Infor M3 ERP | Interplastic, HK Research | Connects to MES; on M3DB3 |
| **M3 Cloud** | Infor M3 cloud-hosted | NAC, Molding Products | NO MES connection |
| **M3 Prod Actual** | Log shipping copy | All | 30-min delay for reporting |
| **MDP (Metadata Publisher)** | M3 data definitions | All | Essential for 6-char table/field names |

**Future State**: HK and Interplastic will migrate to M3 Cloud

---

### Manufacturing Systems

| System | Purpose | Scope | Key Details |
|--------|---------|-------|-------------|
| **MES** | Manufacturing Execution System | Interplastic & HK ONLY | Home-built; manages batching; on M3DB1; ~98-99% integration success |
| **ANV** | Acidity & Viscosity monitoring | MES companies | Real-time cooking guidance; extension of MES; **belongs on MES side of diagrams** |
| **OATES** | QC Application | MES companies | Tied by Batch ID (O-A-T-E-S is an acronym); **talks to MES** |
| **MPD SHAR** | Big mixer system | Molding Products ONLY | "MES light"; connects to M3 Cloud (not MES) |
| **FactoryTalk Batch** | Rockwell batch management | MES companies | **Current stack** — what they have today |
| **PCD** | Control-system material routing | MES companies | Hatch vs drum vs vessel decisions |

**Systems REMOVED from Architecture**:
- **BatchWorks** — Per Patrick: "we don't use" (Note: Cybertrol SOW contradicts - needs clarification)
- **PlantPAx** — Does NOT exist; FactoryTalk Batch is current

---

### Product & Quality Systems

| System | Purpose | Integration | Key Details |
|--------|---------|-------------|-------------|
| **Optiva** | PLM (Product Lifecycle Management) | MES + M3 | R&D, QC technicians; formulas & raw materials |
| **ETQ** | Excellence Through Quality (HSE, QC) | M3 → ETQ only | **Direct DB loads from M3** (NOT ION/BODs); Matt Francis contact |
| **Sphera IA** | Intelligent Authoring — Safety Data Sheets | Via Optiva | Sphera = vendor; IA = application name |
| **SPC** | Statistical Process Control | Molding Products | QC system (similar to ETQ) |
| **Thermograph** | Viscosity/gel-time testing | MES | Production testing for resin specs |
| **DataColor** | Color matching (legacy) | R&D | Being replaced |
| **X-Rite** | Color matching (newer) | R&D | Replacing DataColor |
| **XRays** | Colorants application | R&D | Color formulation system |

---

### Support Systems

| System | Purpose | Integration | Notes |
|--------|---------|-------------|-------|
| **CPR** | Capital Planning Requests | Loosely tied to M3 | Built off EAM |
| **EAM** | Enterprise Asset Management | Standalone | Maintenance work orders |
| **AS (Advanced Scheduler)** | Production scheduling | Standalone | Reduction scheduling via Gantt |
| **ION** | Infor middleware | M3 (both) | BOD routing; exists in **BOTH cloud and on-prem** |
| **MECH** | Infor component | M3 On-Prem | **On-prem ONLY** |
| **IDM** | Infor Document Management | M3 On-Prem | Hyperlinks from SSRS; **no durable GUID** (links are brittle) |
| **SysAid** | Ticketing system | Standalone | IT help desk |
| **ADP** | HR/Payroll | **STANDALONE** | **NO integration** with any system |

---

### CRM & Sales Systems

| System | Purpose | Integration | Key Details |
|--------|---------|-------------|-------------|
| **Salesforce** | CRM | Bi-directional with M3 | M3 is system of record |
| **DBAmp** | Salesforce integration tool | Salesforce ↔ M3 | Handles sync |
| **Price Supports** | Ancillary sales system | Alongside Salesforce | Sarah Wahlberg for details |

**Salesforce → M3 Sync Schedule**:
- NAC: 5am
- Interplastic: 6am
- Molding Products: 7am
- Repeats every 4 hours

**Salesforce → R&D Flow** (NOT automated):
- Customer inputs from Salesforce **inform** R&D formulations
- Email notifications trigger manual PLM work in Optiva
- Lab Service Requests: Salesforce → lab teams → test runs → samples to customer
- **Loosely coupled**, not automated pipeline

---

### Reporting Systems

| System | Status | Owner | Notes |
|--------|--------|-------|-------|
| **SSRS** | Primary (legacy) | Kerri Voiss | Reports grouped by data source; goal is function-based folders |
| **Power BI** | Growing | Eudias Kifem | Star schema; connected to SQL mini-DWH |
| **SQL Mini-DWH** | Current analytics layer | Eudias | Truncate/reload daily |
| **rpt_view_prod** | Helper DB | IT | On M3 on-prem for stored procs |
| **rpt_live** | Monitoring | IT | SSRS self-monitoring for failed subscriptions |

---

## Database Server Inventory

### Production Servers
| Server | Purpose | Key Databases |
|--------|---------|---------------|
| **M3DB1** | M3 + MES | Largest M3 DB; second largest MES |
| **M3DB2** | Production | M3-related |
| **M3DB3** | On-prem M3 ERP | Interplastic/HK instance |
| **SQL 2016 Live** | Production | Various |
| **SQL 2019 Live** | Production | IPC_PowerData (analytics) |

### Staging/Reporting Servers
| Server | Purpose | Key Details |
|--------|---------|-------------|
| **SQL 2012 Test** | Staging/Reporting | Log-shipped read-only copy; Eudias & Kerri write reports here |
| **M3 Prod Actual** | Reporting | 30-minute log-shipped copy of M3 on-prem |

### Dev/Test Servers
| Server | Purpose | Refresh Schedule |
|--------|---------|------------------|
| **M3DevDB1/2/3** | Non-prod M3 | Quarterly refresh from prod |
| **SQL2019Dev** | Development | IPC_PowerData dev |
| **SQL2016Dev** | ETL/Staging | M3TST-ETL |

---

## Database-to-MCP Connection Mapping

| Server | Database | Purpose | MCP Connection |
|--------|----------|---------|----------------|
| **SQL2019Dev** | IPC_PowerData | SQL Mini-DWH (analytics) | `mssql-powerdata` |
| **SQL2012Test** | MES | Manufacturing Execution | `mssql-mes` |
| **SQL2012Test** | DiverData | Diver Analytics (legacy) | `mssql-mes` |
| **M3Dev-DB1** | M3FDBTST | M3 ERP Test (on-prem) | `mssql-m3-fdb` |
| **SQL2016Dev** | M3TST-ETL | M3 ETL/Staging | `mssql-m3-etl` |

**Authentication**: All connections use SQL Auth with `UsrSQLRead` — Windows Auth has NO database access.

---

## Database Table Counts (Validated)

| Database | Table Count | Status |
|----------|-------------|--------|
| M3FDBTST (M3 ERP) | 3,949 | Validated |
| MES | 351+ | Validated |
| IPC_PowerData | 20+ | Validated |
| DiverData | ~5 key tables | Validated |
| M3TST-ETL | 4 | Validated |

---

## System Integration Matrix

```
M3 ON-PREM (Interplastic, HK Research)
├── [CONFIRMED] ↔ MES (VERY bi-directional, ~98-99% success)
├── [CONFIRMED] ↔ Salesforce (bi-directional via DBAmp)
├── [CONFIRMED] ↔ ION Middleware (BOD routing)
├── [CONFIRMED] → ETQ (direct DB loads, one-way)
├── [CONFIRMED] → SQL 2012 Test (log-shipped for reporting)
├── [CONFIRMED] → M3 Prod Actual (30-min log-ship)
└── [CONFIRMED] → SSRS (via SQL staging)

M3 CLOUD (NAC, Molding Products)
├── [CONFIRMED] ↔ Salesforce (bi-directional via DBAmp)
├── [CONFIRMED] ↔ ION Middleware (BOD routing)
├── [CONFIRMED] NO CONNECTION to MES
└── [CONFIRMED] ↔ MPD SHAR (Molding Products only)

MES (Interplastic & HK ONLY)
├── [CONFIRMED] ↔ M3 On-Prem (VERY bi-directional)
├── [CONFIRMED] ↔ ANV (real-time acidity/viscosity)
├── [CONFIRMED] ↔ OATES (tied by Batch ID)
├── [CONFIRMED] ← Optiva PLM (formulation data)
├── [CONFIRMED] ↔ FactoryTalk Batch
└── [CONFIRMED] ↔ PCD (material routing)

Salesforce
├── [CONFIRMED] ↔ M3 On-Prem (bi-directional via DBAmp)
├── [CONFIRMED] ↔ M3 Cloud (bi-directional via DBAmp)
└── [CONFIRMED] Does NOT directly integrate with MES or Optiva

ADP (HR/Payroll)
└── [CONFIRMED] Standalone — no integration

ION Middleware
├── [CONFIRMED] Exists in BOTH cloud and on-prem
└── [NOTE] MECH is on-prem ONLY
```

---

## Diagramming Notes

Per Patrick Stiller:
- The detailed architecture diagram "has no way to do this clean"
- Consider **separate diagrams** for MES-centric and M3-centric views
- **Prezi-style zooming** would work better for stakeholders
- "MES is operational core; M3 is enterprise core"
