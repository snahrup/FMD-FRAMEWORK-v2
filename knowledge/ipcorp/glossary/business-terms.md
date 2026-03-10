# IP Corp Business Glossary

> **Purpose**: Terms, definitions, acronyms, and system relationships
> **Last Updated**: January 2026

---

## ERP & Core Systems

| Term | Definition |
|------|------------|
| **M3** | Infor M3 — the ERP system. Two instances exist: Cloud (NAC, Molding Products) and On-Prem (Interplastic, HK Research) |
| **MES** | Manufacturing Execution System — **Interplastic & HK Research only**; home-built system; manages batching; on M3DB1 |
| **MDP** | Metadata Publisher — Infor tool for M3 data definitions; essential for understanding 6-character table/field names |
| **ION** | Infor Open Network — middleware for BOD (Business Object Document) routing; exists in **both cloud and on-prem** |
| **MECH** | Infor component — **on-prem ONLY** |
| **BOD** | Business Object Document — standard message format used by ION middleware |

---

## Manufacturing Systems

| Term | Definition |
|------|------------|
| **ANV** | Acidity & Viscosity — real-time cooking guidance system; extension of MES; **belongs on MES side of architecture** |
| **OATES** | O-A-T-E-S (acronym) — QC application in MES database; tied by Batch ID; **talks to MES, not directly to M3** |
| **FactoryTalk Batch** | Rockwell batch management — **current production stack** at IP Corp |
| **PCD** | Control-system material routing — manages hatch vs drum vs vessel decisions |
| **MPD SHAR** | "MES Light" for Molding Products only — big mixer system; connects to M3 Cloud (not main MES) |
| **Batch ID** | Universal cross-system key — links MES, ANV, OATES, and M3 for complete production traceability |
| **S3/S4** | Mass-balance/yield accounting terminology used in MES |

**Systems That Do NOT Exist**:
| System | Status |
|--------|--------|
| **BatchWorks** | Per Patrick: "we don't use" — BUT Cybertrol SOW lists it as data source. **NEEDS CLARIFICATION** |
| **PlantPAx** | Does NOT exist at IP Corp; FactoryTalk Batch is current |

---

## Product & Quality Systems

| Term | Definition |
|------|------------|
| **Optiva** | PLM (Product Lifecycle Management) — used by R&D and QC technicians; manages formulas & raw materials; talks to **both MES and M3** |
| **ETQ** | Excellence Through Quality — HSE (Health, Safety, Environment) and QC system; receives data via **direct DB loads from M3** (NOT through ION/BODs) |
| **Sphera IA** | Intelligent Authoring — Safety Data Sheets application; Sphera is the vendor, IA is the application name; generates SDS via Optiva |
| **SPC** | Statistical Process Control — QC system used at **Molding Products** (similar function to ETQ) |
| **Thermograph** | Viscosity/gel-time testing — production testing application for resin specs |
| **DataColor** | Color matching system (legacy) — R&D gel coat color matching; being replaced by X-Rite |
| **X-Rite** | Color matching system (newer) — replacing DataColor for R&D gel coat color matching |
| **XRays** | Colorants application — color formulation system |

---

## CRM & Sales Systems

| Term | Definition |
|------|------------|
| **Salesforce** | CRM system — **bi-directional with M3** (both Cloud and On-Prem); however, M3 is the system of record, not Salesforce |
| **DBAmp** | Salesforce integration tool — handles M3 ↔ Salesforce synchronization |
| **Price Supports** | Ancillary sales system — works alongside Salesforce; contact Sarah Wahlberg for details |

---

## Support & Infrastructure

| Term | Definition |
|------|------------|
| **CPR** | Capital Planning Requests — built off EAM; loosely tied to M3 |
| **EAM** | Enterprise Asset Management — maintenance work orders tracking |
| **AS** | Advanced Scheduler — production scheduling tool; reduction scheduling via Gantt |
| **IDM** | Infor Document Management — on-prem; provides hyperlinks from SSRS; **no durable GUID** (links are brittle) |
| **SysAid** | IT ticketing system / help desk |
| **ADP** | HR/Payroll system — **standalone with NO integration** to other systems |

---

## Reporting & Analytics

| Term | Definition |
|------|------------|
| **SSRS** | SQL Server Reporting Services — current primary reporting platform; owned by Kerri Voiss |
| **Power BI** | Microsoft Power BI — growing deployment; Eudias building star schema models |
| **SQL Mini-DWH** | Current reporting layer — Eudias pulls from ERP → SQL → Power BI; truncate/reload daily |
| **DiverData** | Analytics database on SQL2012Test — aggregates M3 ERP sales data for Interplastic; **NOT a source system of record** |
| **IPC_PowerData** | Analytics database on SQL2019Live — modern analytics layer for MP and NAC data |
| **rpt_view_prod** | Helper database on M3 on-prem server — used for stored procs/functions (can't use log-shipped DB for this) |
| **rpt_live** | Monitoring database — SSRS portal self-monitoring for failed subscriptions |

---

## Companies

| Term | Definition |
|------|------------|
| **IP Corporation** | Parent/holding company |
| **Interplastic** | Resin Manufacturing (Polyester, Vinyl Ester) — M3 On-Prem, full MES integration |
| **HK Research** | Gel Coat Manufacturing — M3 On-Prem, full MES integration; shares customer service with Interplastic |
| **NAC** | North American Composites — **distribution only**, no MES; distributes both Interplastic products AND competitor products |
| **Molding Products** | SMC/BMC Manufacturing — M3 Cloud, MPD SHAR ("MES Light"); **Spelling: M-O-L-D-I-N-G** (not "Moulding") |

**Terminology Sensitivity**:
- "TRD" and "MPD" are no longer divisions — some people take offense to these terms
- "NAC" is still commonly used and acceptable

---

## M3 ERP Terminology

| Term | Definition |
|------|------------|
| **MITMAS** | M3 Item Master table — product/item definitions |
| **OOLINE** | M3 Order Lines table — sales order line items |
| **OOHEAD** | M3 Order Headers table — sales order headers |
| **OCUSMA** | M3 Customer Master table — customer definitions |
| **CIDMAS** | M3 Company/Division Master table |
| **MITBAL** | M3 Item Balance table — inventory balances |
| **MWOHED** | M3 Work Order Header table — manufacturing orders |
| **MWOMAT** | M3 Work Order Material table — MO material requirements |
| **KUZMA** | M3 table name for Customer (example of 6-character naming convention) |
| **KONO+SUNO** | M3 natural key pattern — used with DIVI/WHLO scope for Salesforce integration |

### M3 6-Character Naming Convention

M3 uses a strict `PPNNNN` format:
- **PP** (2 chars): Program/Module prefix
- **NNNN** (4 chars): Object identifier

| Prefix | Module |
|--------|--------|
| MM | Item Master fields |
| OB | Order Line fields |
| OA | Order Header fields |
| OK | Customer fields |
| MB | Item Balance fields |
| VH | Work Order Header fields |
| VM | Work Order Material fields |
| CC | Company/Division fields |

### M3 Schema Patterns

| Environment | Schema Pattern | Example |
|-------------|----------------|---------|
| **On-Prem** | `MBXJDTA.Table` or `MVXJDTA.Table` | `MVXJDTA.MITMAS` |
| **Cloud** | No schema prefix | `MITMAS` |

---

## Data & Integration Terms

| Term | Definition |
|------|------------|
| **GUID** | Globally Unique Identifier — used per batch to link MES batch to M3 formulation |
| **Batch ID** | Universal cross-system key — THE key for manufacturing traceability across MES, ANV, OATES, M3 |
| **Log-shipped** | Database replication method — M3 Prod Actual has ~30-minute delay from production |
| **Star Schema** | Data modeling pattern — fact tables surrounded by dimension tables; used in current Power BI models |
| **Medallion Architecture** | Bronze/Silver/Gold layered data architecture — target pattern for Microsoft Fabric |

---

## Microsoft Fabric Terms

| Term | Definition |
|------|------------|
| **OneLake** | Unified data lake storage in Microsoft Fabric |
| **Lakehouse** | Fabric artifact combining data lake and warehouse capabilities — used for Bronze and Silver layers |
| **Warehouse** | Fabric SQL-based data warehouse — used for Gold layer |
| **Semantic Model** | Power BI data model on Fabric — replaces "dataset" terminology |
| **Capacity** | Fabric compute resource — measured in CUs (Capacity Units) |
| **DirectLake** | Fabric mode that queries Delta tables directly without import — recommended for large datasets |

---

## Microsoft Purview Terms

| Term | Definition |
|------|------------|
| **Purview** | Microsoft data governance platform — provides lineage, policies, data catalog, and classification |
| **Data Catalog** | Searchable inventory of all data assets (tables, columns, reports) with metadata and ownership |
| **Business Glossary** | Centralized repository of standardized business term definitions that link to physical data assets |
| **Column-Level Lineage** | Visual tracing of data from source system column → Bronze → Silver → Gold → Power BI report column |
| **Impact Analysis** | Visualization showing downstream dependencies — answers "what breaks if I change this column?" |
| **Data Classification** | Automated detection and labeling of sensitive data (PCI, PII, SSN) using built-in or custom policies |
| **Data Map** | Visual representation of the data estate showing sources, transformations, and consumption |
| **Sensitivity Labels** | Classifications applied to data assets (e.g., Confidential, Public, Restricted) |
| **Collection** | Logical grouping of data assets in Purview for access control and organization |

---

## Key Abbreviations

| Abbreviation | Full Form |
|--------------|-----------|
| ERP | Enterprise Resource Planning |
| MES | Manufacturing Execution System |
| PLM | Product Lifecycle Management |
| CRM | Customer Relationship Management |
| HSE | Health, Safety, Environment |
| QC | Quality Control |
| ETL | Extract, Transform, Load |
| DWH | Data Warehouse |
| BOD | Business Object Document |
| SDS | Safety Data Sheets |
| SMC | Sheet Molding Compound |
| BMC | Bulk Molding Compound |
| OT | Operational Technology |
