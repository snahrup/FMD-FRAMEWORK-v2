# IP Corp Knowledge Base

IP Corporation is a multi-company manufacturing conglomerate comprising Interplastic Corporation (resin manufacturing), HK Research Corporation (gel coat manufacturing), North American Composites/NAC (composites distribution), and Molding Products LLC (SMC/BMC manufacturing). They run on Infor M3 ERP (both on-prem and cloud instances), a home-built MES system, and 25+ supporting systems. The FMD Framework is migrating their fragmented data landscape into Microsoft Fabric using a metadata-driven medallion architecture.

---

## Quick Reference Files (Start Here)

These 5 files give an AI agent full IP Corp context without reading the entire codebase:

| File | Description |
|------|-------------|
| [company-structure.md](company-structure.md) | Corporate hierarchy, 4 subsidiary companies, ERP mapping, security boundaries, terminology sensitivity |
| [source-databases.md](source-databases.md) | All 4 on-premises source databases: MES (586 tables), ETQ (29), M3 ERP (3,973), M3 Cloud (188). Connection strings, auth, key tables, entity registration status |
| [fabric-environment.md](fabric-environment.md) | Workspace IDs, lakehouse IDs, SQL DB endpoint, service principal, connection IDs, variable libraries, pipeline IDs, deployment method, remote server details |
| [known-issues.md](known-issues.md) | Critical gotchas: SQL endpoint sync lag, auth quirks, InvokePipeline SP limitation, pipeline root causes, deployment pitfalls, M3/MES data quirks, business rules |
| [fabric-migration-strategy.md](fabric-migration-strategy.md) | Target Fabric architecture, medallion layer definitions, domain roadmap, workspace strategy, Purview integration, cost estimation |

---

## Deep-Dive Documents

| File | Description |
|------|-------------|
| [systems/landscape.md](systems/landscape.md) | Full inventory of 28+ systems with integration details, server inventory, MCP connection mapping |
| [data-flows/architecture.md](data-flows/architecture.md) | Data flows, Batch ID as universal key, cross-system identifiers, ETL patterns, lineage |
| [glossary/business-terms.md](glossary/business-terms.md) | Terms, definitions, acronyms, M3 6-character naming conventions, Fabric/Purview terminology |
| [contacts/stakeholders.md](contacts/stakeholders.md) | Key people (Patrick Stiller, Mike Spencer, Matt Pennaz, Matt Francis, Eudias Kifem, Kerri Voiss), roles, communication preferences, meeting history |
| [source-databases/m3/internal-discoveries.md](source-databases/m3/internal-discoveries.md) | M3 ERP specific findings -- schemas, tables, integration patterns, company configuration |
| [source-databases/mes/internal-discoveries.md](source-databases/mes/internal-discoveries.md) | MES database findings -- 443+ tables, batch tracking, QC, ANV, formula management |
| [gotchas/known-issues.md](gotchas/known-issues.md) | Original known issues file (January 2026 snapshot, pre-deployment) |

---

## Key Facts for AI Agents

- **4 companies**: Interplastic (CONO 100), HK Research (CONO 200), NAC, Molding Products
- **MES serves only**: Interplastic and HK Research (not NAC, not Molding Products)
- **Financial isolation**: NAC cannot see Interplastic numbers (CIO mandate)
- **659 entities registered** across 3 sources (MES 445, M3 Cloud 185, ETQ 29); M3 ERP on-prem pending
- **Medallion architecture**: Landing Zone --> Bronze --> Silver --> Gold
- **Deployed via Python scripts** (`deploy_from_scratch.py`), NOT via NB_SETUP_FMD notebook
- **VPN required** for all source database connections
- **Batch ID** is the universal cross-system key for manufacturing traceability
- **M3 is the system of record** -- Salesforce data can be overwritten by M3
