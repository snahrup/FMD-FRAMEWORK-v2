# IP Corp Company Structure

> **Purpose**: Understanding the multi-company structure and its implications for data architecture
> **Last Updated**: January 2026

---

## Corporate Hierarchy

```
IP Corporation (Parent/Holding Company)
├── Interplastic Corporation (Resin Manufacturing)
│   └── HAS full MES integration
├── HK Research Corporation (Gel Coat Manufacturing)
│   └── HAS full MES integration
├── North American Composites - NAC (Distribution)
│   └── NO MES, distributes competitor + Interplastic products
└── Molding Products LLC (SMC/BMC Manufacturing)
    └── Has MPD SHAR ("MES Light"), uses SPC for QC
```

---

## Company Profiles

### Interplastic Corporation
| Attribute | Value |
|-----------|-------|
| **Business** | Resin Manufacturing (Polyester, Vinyl Ester) |
| **ERP** | M3 On-Prem |
| **Manufacturing System** | Full MES Integration |
| **Key Systems** | MES, ANV, OATES, Optiva, FactoryTalk Batch |
| **M3 Company Number** | Typically 100 |
| **Locations** | Fort Wright KY, Minneapolis MN, Hawthorne CA, Pryor OK |

### HK Research Corporation
| Attribute | Value |
|-----------|-------|
| **Business** | Gel Coat Manufacturing |
| **ERP** | M3 On-Prem |
| **Manufacturing System** | Full MES Integration |
| **Key Systems** | MES, ANV, OATES, Optiva, X-Rite (color matching) |
| **M3 Company Number** | Typically 200 |
| **Relationship** | Shares customer service teams/tools with Interplastic |

### North American Composites (NAC)
| Attribute | Value |
|-----------|-------|
| **Business** | Composites Distribution |
| **ERP** | M3 Cloud |
| **Manufacturing System** | NONE |
| **Business Model** | Distributes both Interplastic products AND competitor products |
| **Key Systems** | M3 Cloud, Salesforce |
| **Note** | Pure distribution - no manufacturing visibility |

### Molding Products LLC
| Attribute | Value |
|-----------|-------|
| **Business** | SMC/BMC Manufacturing |
| **ERP** | M3 Cloud |
| **Manufacturing System** | MPD SHAR ("MES Light") |
| **Quality System** | SPC (Statistical Process Control) |
| **Location** | South Bend IN |
| **Spelling** | M-O-L-D-I-N-G (not "Moulding") |

---

## Critical Business Boundaries

### Security Isolation (Non-Negotiable)

> "NAC can't see Interplastic's numbers." — Mike Spencer, CIO

| Boundary | Requirement |
|----------|-------------|
| **Financial data** | Complete company isolation |
| **Cross-company cost visibility** | Requires careful handling |
| **Executive reporting** | Aggregated only, no drill-through to other company details |

### ERP Instance Mapping

| M3 Instance | Companies | Database Pattern |
|-------------|-----------|------------------|
| **M3 On-Prem** | Interplastic, HK Research | Schema prefixes (MBXJDTA, MVXJDTA) |
| **M3 Cloud** | NAC, Molding Products | No schema prefix |

### MES Integration Boundary

**CRITICAL**: MES only integrates with M3 On-Prem companies

| Company | MES Integration |
|---------|-----------------|
| Interplastic | Full bi-directional |
| HK Research | Full bi-directional |
| NAC | NO integration |
| Molding Products | MPD SHAR only (limited) |

This means:
- **Batch ID traceability**: Interplastic & HK Research ONLY
- **Real-time manufacturing metrics**: Not available for NAC
- **Different data pipelines required**: Cloud vs On-Prem normalization

---

## Organizational Dynamics

### Team Structure
- Interplastic & HK share **customer service teams and tools**
- Centralized IT team manages all companies
- Separate P&L per company

### Terminology Sensitivity

| Term | Status | Notes |
|------|--------|-------|
| "TRD" | AVOID | No longer used, may cause offense |
| "MPD" | AVOID | No longer used, may cause offense |
| "NAC" | ACCEPTABLE | Still commonly used |

### Cultural Notes
- Some **stronger personalities** will be more critical (per Patrick)
- Better approach: "What will make your job easier?" not "here's how you do it"
- If challenges arise, escalate to Patrick Stiller

---

## Future State Vision

> HK and Interplastic will migrate to M3 Cloud — part of the current initiative. MES will need to adapt.

### Cloud Migration Implications
1. Schema changes (On-Prem prefixes → no prefix)
2. MES integration patterns will need to change
3. ION middleware already exists in both environments
4. Timeline TBD - still an open question for Mike/Patrick

---

## Implications for Fabric Architecture

### Recommended Workspace Structure
```
1 capacity per entity + domains within:

├── Interplastic Capacity
│   ├── Sales Domain
│   ├── Manufacturing Domain (full MES data)
│   ├── Quality Domain
│   └── Finance Domain
│
├── HK Research Capacity
│   └── (Same structure as Interplastic)
│
├── NAC Capacity
│   ├── Sales Domain
│   ├── NO Manufacturing Domain
│   └── Finance Domain
│
├── Molding Products Capacity
│   ├── Sales Domain
│   ├── Manufacturing Domain (MPD SHAR only)
│   ├── Quality Domain (SPC)
│   └── Finance Domain
│
└── Enterprise Capacity
    └── Gold-level aggregated data for executive reporting
```

### Cross-Company Reporting Pattern
- Semantic models CANNOT be shared across capacities
- Reports must connect directly to Gold warehouse
- Row-level security for any cross-company views
