# IP Corp Stakeholders and Contacts

> **Purpose**: Key people, roles, communication preferences, and team dynamics
> **Last Updated**: January 2026

---

## Primary Contacts

### Patrick (Pat) Stiller
| Attribute | Value |
|-----------|-------|
| **Role** | IT Manager - Development Services |
| **Relevance** | **Primary contact** for IP Corp engagement |
| **Communication** | Teams (primary), Text (urgent) |
| **Expertise** | IT strategy, development oversight, project coordination |
| **Reports to** | Mike Spencer (CIO) |
| **Notes** | Main point of contact; coordinates with all technical staff. Go to Pat first for any issues or questions. |

### Mike Spencer
| Attribute | Value |
|-----------|-------|
| **Role** | CIO |
| **Relevance** | Decision maker; executive sponsor |
| **Communication** | Email via Patrick |
| **Expertise** | Executive decisions, budget approval, strategic direction |
| **Key Meeting** | Dec 13 Architecture Meeting — alignment reached |
| **Next** | ELT introduction mid-February |

---

## Technical Team

### Matt Pennaz
| Attribute | Value |
|-----------|-------|
| **Role** | Senior Developer |
| **Relevance** | MES expert; manufacturing + M3 knowledge |
| **Communication** | Teams |
| **Expertise** | MES, manufacturing systems, M3 integration, shop floor data |
| **Key Insight** | "We've gotten it down to probably about 98–99% of them make it through... but there's always something" (MES-M3 integration) |
| **Notes** | Deep knowledge of MES-M3 integration patterns; interested in AI/LLM |

### Matt Francis
| Attribute | Value |
|-----------|-------|
| **Role** | Data Engineer |
| **Relevance** | M3 data expert; Salesforce ↔ M3 integration |
| **Communication** | Teams |
| **Expertise** | M3 data, Salesforce, DBAmp, ETQ, system integrations |
| **Notes** | Key for understanding data flows between systems. Contact for BOD examples and ETQ integration details. |

### Eudias Kifem
| Attribute | Value |
|-----------|-------|
| **Role** | Data Analyst |
| **Relevance** | DBA → Power BI transition; building star schema |
| **Communication** | Teams |
| **Expertise** | Power BI, star schema, data modeling, SQL, DiverData ETL |
| **Database Access Authority** | DiverData (SQL2012Test), IPC_PowerData |
| **Known Procedures** | usp_trd_CustomerDim, usp_trd_ProductDim, usp_trd_SalesRepDim, usp_trd_WarehouseDim, usp_load_m3_diver_data_new |
| **Key Meeting** | Dec 17 Database Exploration — 2hr 12min deep dive |
| **Key Insights** | "M3 cloud doesn't have schema"; "There's nothing telling you that if you're looking for this, look at this table" |
| **Notes** | Working on modernizing reporting infrastructure. Can grant database access permissions. Self-motivated learner. |

### Kerri Voiss
| Attribute | Value |
|-----------|-------|
| **Role** | SSRS & Reporting Lead |
| **Relevance** | Owns SSRS portal; ~19 years at company |
| **Communication** | Teams |
| **Expertise** | SSRS, reporting, historical knowledge, organizational context |
| **Notes** | Long tenure — invaluable for historical context and relationships. Described as "social connective tissue" — go-to for intros. |

---

## IT and Infrastructure

### Stuart Langley
| Attribute | Value |
|-----------|-------|
| **Role** | IT (Admin/Access) |
| **Relevance** | SA credentials, system access setup |
| **Communication** | Email/Teams |
| **Key Meeting** | Dec 16 — SSL VPN, Fabric trial, M3 POC planning |
| **Action Items** | ESA account setup, SQL read access, Fabric user groups in Entra |

### Lori
| Attribute | Value |
|-----------|-------|
| **Role** | IT |
| **Relevance** | Azure access provisioning |
| **Communication** | Teams |
| **Action Items** | Set up Azure access for Steve |

### Greg
| Attribute | Value |
|-----------|-------|
| **Role** | IT |
| **Relevance** | Systems overview; session host |
| **Communication** | Teams |

### Chris Herbst
| Attribute | Value |
|-----------|-------|
| **Role** | CIO/CISO |
| **Relevance** | Technology counterpart |
| **Communication** | Via Patrick |

---

## Business Contacts

### Sarah Wahlberg
| Attribute | Value |
|-----------|-------|
| **Role** | Sales/Finance |
| **Relevance** | Price support process details |
| **Communication** | Email |
| **Notes** | Contact for understanding the Price Supports system alongside Salesforce |

### Robert LaMontagne
| Attribute | Value |
|-----------|-------|
| **Role** | OT (Operational Technology) Contact / Process Control Manager |
| **Relevance** | OT systems and manufacturing floor integration |
| **Communication** | Email (rlamontagne@ip-corporation.com) |
| **Expertise** | OT systems, manufacturing floor, Rockwell/FactoryTalk |
| **Notes** | 12+ years at IP Corp; led MES modernization. Key contact for OT/manufacturing data questions. |

### Dominique Mathers
| Attribute | Value |
|-----------|-------|
| **Role** | Project Coordination |
| **Relevance** | ELT introduction coordination |
| **Action Items** | Coordinate ELT intro and JIRA setup |

---

## Team Dynamics

### Communication Preferences

| Person | Primary | Secondary | Notes |
|--------|---------|-----------|-------|
| Patrick Stiller | Teams | Text (urgent) | Always go through Patrick first |
| Mike Spencer | Email via Patrick | — | Executive sponsor |
| Technical team | Teams | — | Matt P, Matt F, Eudias, Kerri |
| Robert LaMontagne | Email | — | OT contact |

### Cultural Considerations

From Patrick Stiller:

> "Some **stronger personalities** will be more critical — I'm working on calling that tone."

**Best Approach**:
- Lead with "What will make your job easier?" not "here's how you do it"
- If challenges arise, talk to Patrick first
- Be patient with the discovery process
- Respect the deep institutional knowledge

### Organizational Notes

| Topic | Insight |
|-------|---------|
| **Divisions** | Some people take offense to "TRD" and "MPD" — they're no longer divisions. "NAC" is still acceptable. |
| **Shared Resources** | Interplastic & HK share customer service teams and tools |
| **Decision Making** | Data stewards vs. decision makers distinction still needs clarification for each domain |

---

## Meeting History

### Key Meetings Completed

| Date | Meeting | Participants | Key Outcomes |
|------|---------|--------------|--------------|
| Dec 8 | Monday Kickoff | Patrick | Project kickoff |
| Dec 8 | Data Architecture Discovery | Team | Initial system inventory |
| Dec 9 | Data Architecture Review | Team | DB systems overview |
| Dec 10 | Diagram Review | Patrick | MAJOR corrections to architecture |
| Dec 10 | MDM Systems Lite | Team | MDM approach discussion |
| Dec 10 | Database Walkthrough | Team | Fabric toolbox discussion |
| Dec 11 | IT Systems & Reporting | Team | Infrastructure deep dive |
| Dec 11 | M3 Salesforce Integration | Matt Francis | Integration patterns |
| Dec 11 | MES Integration & Traceability | Matt Pennaz | MES-M3 integration details |
| Dec 11 | Project Kickoff Wrap-Up | Team | Summary and next steps |
| Dec 13 | CIO Architecture Meeting | Mike Spencer | **Alignment reached** on future state |
| Dec 16 | Stuart Langley Intro | Stuart | SSL VPN, Fabric trial, M3 POC |
| Dec 17 | Database Exploration | Eudias | SQL access verified, M3 structure, Fabric capacity |

### Upcoming Meetings

| Target | Meeting | Participants | Purpose |
|--------|---------|--------------|---------|
| Mid-January | POC Kickoff | Data team | M3 Product domain |
| Mid-February | ELT Introduction | Executive team | Strategic alignment |
| TBD | Site Visit | Steve + team | In-person kickoff |

---

## Contact Quick Reference

| Need | Contact |
|------|---------|
| **General coordination** | Patrick Stiller |
| **Executive decisions** | Mike Spencer (via Patrick) |
| **M3 data questions** | Matt Francis |
| **MES/manufacturing questions** | Matt Pennaz |
| **Power BI/reporting** | Eudias Kifem |
| **SSRS/historical context** | Kerri Voiss |
| **System access** | Stuart Langley |
| **Azure access** | Lori |
| **OT/manufacturing floor** | Robert LaMontagne |
| **Price support process** | Sarah Wahlberg |
