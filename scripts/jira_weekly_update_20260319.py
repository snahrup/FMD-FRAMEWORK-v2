"""
FMD Framework Weekly Jira Update — March 10-19, 2026
69 commits across 6 major work streams.
"""

import json
import urllib.request
import urllib.error
import base64
import time
import sys

from _credentials import JIRA_USER, get_jira_token

JIRA = "https://ip-corporation.atlassian.net/rest/api/3"
_creds = base64.b64encode(
    f"{JIRA_USER}:{get_jira_token()}".encode()
).decode()

STEVE = "712020:aaf5cbe0-f88b-4eb5-ae6f-b1ba5f939752"
PATRICK = "557058:73c68783-606a-412c-89fa-502eddc13439"
DOMINIQUE = "712020:e9809320-35bb-4dd1-93df-69e1285f4f9c"
BROWSE = "https://ip-corporation.atlassian.net/browse"


def jira_request(path, method="GET", data=None):
    url = f"{JIRA}{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"Basic {_creds}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.read().decode()[:500]}")
        return None


def transition(key, tid):
    print(f"  Transitioning {key} -> {tid}")
    return jira_request(f"/issue/{key}/transitions", "POST", {"transition": {"id": str(tid)}})


def comment(key, adf_content):
    print(f"  Commenting on {key}")
    return jira_request(f"/issue/{key}/comment", "POST", {
        "body": {"version": 1, "type": "doc", "content": adf_content}
    })


def worklog(key, seconds, started, text):
    print(f"  Logging {seconds // 3600}h on {key} at {started}")
    return jira_request(f"/issue/{key}/worklog", "POST", {
        "timeSpentSeconds": seconds,
        "started": started,
        "comment": {
            "version": 1, "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
        }
    })


def update_fields(key, fields):
    print(f"  Updating fields on {key}")
    return jira_request(f"/issue/{key}", "PUT", {"fields": fields})


def add_watcher(key, account_id):
    url = f"{JIRA}/issue/{key}/watchers"
    body = json.dumps(account_id).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Basic {_creds}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return True
    except urllib.error.HTTPError:
        return False


def add_watchers(key):
    add_watcher(key, PATRICK)
    add_watcher(key, DOMINIQUE)


def p(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def bold_p(bold_text, normal_text):
    return {"type": "paragraph", "content": [
        {"type": "text", "text": bold_text, "marks": [{"type": "strong"}]},
        {"type": "text", "text": normal_text}
    ]}


def heading(level, text):
    return {"type": "heading", "attrs": {"level": level}, "content": [{"type": "text", "text": text}]}


def inline_card(key):
    return {"type": "inlineCard", "attrs": {"url": f"{BROWSE}/{key}"}}


def bullet_list(items):
    return {"type": "bulletList", "content": [
        {"type": "listItem", "content": [p(item)]} for item in items
    ]}


# ============================================================
# PHASE 1: Update MT-93 (Server Architecture Refactor)
# ============================================================
def phase1_mt93():
    print("\n=== PHASE 1: MT-93 Server Architecture Refactor ===")

    # Comment 1: Server refactor completion
    comment("MT-93", [
        p("Wrapped up the server refactor this week. The big headline: server.py went from 9,267 lines with 125 elif route clauses down to 306 lines. That's a 96.8% reduction. Built a decorator-based route registry in router.py that auto-discovers routes, handles middleware, and dispatches cleanly. The old monolith is gone."),
        p("Extracted 13 route modules total. The core six went in first (admin, control_plane, entities, engine, pipeline, monitoring), then config_manager, data_access, sql_explorer, source_manager. Later added microscope, mri, notebook, and test_audit to cover the remaining pages. Each module owns its endpoints, its validation, and its error handling."),
        p("The bigger architectural shift: Fabric SQL is completely eliminated from the read path. Every dashboard query now hits SQLite. Built parquet_sync.py for write-behind (SQLite changes get exported to Parquet on OneLake) and delta_ingest.py for read-behind (Delta tables on OneLake get ingested back into SQLite with watermarks). This solved the 2-3 day sync lag we'd been chasing for weeks with the SQL Analytics Endpoint."),
        p("Replaced all 33 query_sql calls in engine/api.py with SQLite equivalents. Deleted the MetadataDB class from connections.py entirely. Removed 120 stored proc activities from 21 pipeline JSONs. Updated 4 Fabric notebooks to write Delta tables instead of calling stored procs. The Fabric SQL database still exists for the notebooks, but the dashboard never touches it anymore."),
        p("Security was a big focus during the audit. Found and fixed 5 SQL injection points (ConfigManager, SqlExplorer, DataBlender, PipelineMatrix, build_entity_digest), an ODBC injection vulnerability, and an admin auth bypass where an empty password would succeed when the env var wasn't set. All patched."),
        p("Also built the Database Explorer page as a natural outcome of the SQLite migration. Browse tables, run read-only queries, inspect schema. Useful for debugging and for understanding what the dashboard sees."),
    ])
    time.sleep(1)

    # Comment 2: Dashboard audit + MDM
    comment("MT-93", [
        p("The dashboard audit was systematic. Went through all 42 pages in 7 batches of 6, plus a deep audit of 12 core pages. Total: 171 frontend bugs fixed, 164 backend issues documented in AUDIT-*.md files. Every page now has anti-flash loading patterns, graceful API error handling, and correct data contracts between frontend and backend."),
        p("Built 5 MDM capabilities on top of the new architecture as Chunks 1-4. Data Profiler now returns 13 stats per column (distinctCount, nullCount, uniqueness, completeness, min/max). Column Lineage traces across all medallion layers with 24h SQLite caching. Classification Engine uses 25+ regex patterns plus optional Presidio NLP for PII detection. Business Glossary seeds 278 terms from the IP Corp knowledge base with 240 entity annotations. Quality Scoring rates all 1,725 entities across 4 dimensions (Completeness 40%, Freshness 25%, Consistency 20%, Volume 15%)."),
        p("That's 11 new API endpoints, 5 new SQLite tables, 7 new backend modules. The entity digest now includes businessName, description, domain, tags, qualityScore, and qualityTier. 558 tests passing, zero build errors."),
    ])
    time.sleep(1)

    # Worklogs spread across the week
    worklog("MT-93", 28800, "2026-03-10T08:00:00.000-0600",
            "Deep audit of 12 core dashboard pages. Went through each page methodically, testing every API call, every loading state, every error path. Fixed 60+ frontend bugs including anti-flash patterns and graceful error handling. Documented all backend issues found.")
    worklog("MT-93", 28800, "2026-03-11T08:00:00.000-0600",
            "Built the route registry and extracted the first 8 route modules. Rewrote server.py from 9,267 lines down to the registry pattern. Created db.py SQLite wrapper, admin.py with auth bypass fix, control_plane.py, entities.py, engine.py, pipeline.py, monitoring.py. Also ran audit Batches 3-7 covering 30 pages.")
    worklog("MT-93", 28800, "2026-03-12T08:00:00.000-0600",
            "Scorched earth on Fabric SQL. Migrated engine/api.py (33 query_sql calls replaced), logging_db.py (all stored proc calls removed), deleted MetadataDB class, expanded SQLite schema. Built parquet_sync.py and delta_ingest.py for the write-behind/read-behind bridge. Updated 21 pipeline JSONs to remove 120 stored proc activities. Updated 4 notebooks to write Delta.")
    worklog("MT-93", 28800, "2026-03-13T08:00:00.000-0600",
            "Finished the data source purge and OneLake filesystem integration. Built the MDM enhancement in 4 chunks: rich profiling, column lineage, classification engine, glossary, quality scoring. Restored all 42 pages to working state with 5 new route modules. 558 tests passing.")
    time.sleep(1)

    # Update fields
    update_fields("MT-93", {
        "timetracking": {"remainingEstimate": "0h"},
        "labels": ["dashboard", "data-access", "infrastructure", "onelake", "optimization",
                   "server-refactor", "security", "sqlite", "mdm", "completed"],
    })

    # Add watchers before Done
    add_watchers("MT-93")

    # Transition to Done
    transition("MT-93", "31")
    print("  MT-93 -> Done")


# ============================================================
# PHASE 2: Update MT-19 (Gold Layer / Gold Studio)
# ============================================================
def phase2_mt19():
    print("\n=== PHASE 2: MT-19 Gold Layer / Gold Studio ===")

    comment("MT-19", [
        p("Major progress on Gold this week. Started by writing a comprehensive design specification for Gold Studio, which is the tooling layer that sits on top of the Gold lakehouses. The spec covers the full lifecycle: importing external definitions (Power BI semantic models, Excel mappings, SQL views), parsing them into a canonical internal format, clustering related definitions, reconciling column-level conflicts, and producing validated Gold entity specs."),
        p("The spec went through 2 full QA audit rounds. Round 1 caught 57 findings (6 critical, 13 high). The critical ones were around security (no auth model), parser safety (no XXE/ZIP bomb protection), and missing provenance propagation. Fixed all of them. Round 2 came back clean on critical and high, just 17 refinements. Final spec is 1,580 lines covering 21 SQLite tables and 59 API endpoints."),
        p("Then I built the whole thing. 19 gs_* database tables in SQLite. A parser framework with 6 parsers (Power BI, Excel, SQL, CSV, dbt, manual). 55 API endpoints across 12 route groups. 5 React pages: GoldCanonical (canonical entity definitions), GoldClusters (cluster management), GoldLedger (audit trail), GoldSpecs (spec editor), GoldValidation (validation rules). Built shared components including ProvenanceThread, SpecimenCard, ClusterCard, ColumnReconciliation, GoldStudioLayout, StatsStrip, and SlideOver."),
        p("Security model has 3 auth tiers: Viewer (read-only), Contributor (import/edit), Approver (promote/lock). Provenance is derived for phases 4-7 rather than stored, which keeps the data model clean. Versioning uses optimistic concurrency via expected_version fields."),
        p("Addressed 7 QA findings after implementation (5 HIGH, 2 MEDIUM), including a flexShrink CSS property that was causing layout issues in GoldLedger. All routes wired into the sidebar navigation. This feeds directly into " ),
        inline_card("MT-62"),
        {"type": "text", "text": " for star schema design and "},
        inline_card("MT-52"),
        {"type": "text", "text": " for Power BI semantic models."},
    ])
    time.sleep(1)

    # Worklogs
    worklog("MT-19", 14400, "2026-03-16T08:00:00.000-0600",
            "Wrote the Gold layer specification and Business Portal handoff document. Detailed the canonical model definition, import parsers, cluster management, and reconciliation workflows. Linked to the broader Gold architecture.")
    worklog("MT-19", 21600, "2026-03-18T08:00:00.000-0600",
            "Built Gold Studio end to end. Design spec QA (2 rounds, 57 findings fixed), implementation plan, 19 database tables, parser framework with 6 parsers, 55 API endpoints, 5 React pages, shared components. Wired navigation and addressed 7 QA findings.")
    time.sleep(1)

    update_fields("MT-19", {
        "labels": ["design-spec", "gold-layer", "gold-studio", "mlv", "power-bi",
                   "star-schema", "transformations", "implementation"],
    })


# ============================================================
# PHASE 3: Update MT-62 (Star Schema Design)
# ============================================================
def phase3_mt62():
    print("\n=== PHASE 3: MT-62 Star Schema Design ===")

    comment("MT-62", [
        p("Started working through this as part of Gold Studio. The canonical model in Gold Studio is essentially the star schema definition tool. Each Gold entity spec defines whether it's a fact or dimension, its grain, its columns (with types, nullability, business descriptions), and its relationships to other Gold entities."),
        p("The gs_canonical_entities and gs_canonical_columns tables capture the star schema structure. The cluster management system groups related imports that map to the same target entity, and the reconciliation workflow resolves column-level conflicts (type mismatches, naming differences, business rule disagreements)."),
        p("This is still in progress because the actual Gold lakehouse tables haven't been materialized yet. The schema design is done in the tooling layer, but the MLV definitions that produce the physical tables are the next step. Keeping this in progress until the first fact/dimension tables exist on OneLake."),
    ])
    time.sleep(1)

    worklog("MT-62", 7200, "2026-03-18T13:00:00.000-0600",
            "Designed canonical model structure for Gold entities. Defined fact vs dimension classification, grain specification, column-level schema with types and business descriptions, and entity relationships within Gold Studio.")

    transition("MT-62", "2")  # Backlog -> In Progress
    update_fields("MT-62", {
        "labels": ["data-modeling", "gold-layer", "gold-studio", "star-schema", "canonical-model"],
    })


# ============================================================
# PHASE 4: Update MT-50 (Data Quality & Cleansing Rules)
# ============================================================
def phase4_mt50():
    print("\n=== PHASE 4: MT-50 Data Quality & Cleansing Rules ===")

    comment("MT-50", [
        p("Built the quality scoring engine and classification system as part of the MDM enhancement work. The quality scorer evaluates all 1,725 entities across 4 dimensions: Completeness (40% weight), Freshness (25%), Consistency (20%), and Volume (15%). Each dimension pulls from actual data in SQLite. Completeness looks at null percentages, freshness checks last-loaded timestamps against expected cadence, consistency checks for type mismatches and naming conventions, volume compares current row counts against historical baselines."),
        p("Results break down into tiers: 198 Gold (score >= 0.9), 1,455 Silver (>= 0.7), 3 Bronze (>= 0.5), 69 Unclassified (below 0.5 or insufficient data). The entity digest endpoint now returns qualityScore and qualityTier for every entity, so any dashboard page that uses the digest gets quality data for free."),
        p("The classification engine runs 25+ regex pattern rules against column names to detect PII (SSN, email, phone), restricted (salary, credit), confidential (cost, margin), and internal (audit, system) columns. Optional Presidio NLP integration does value-level scanning for entities where name-based patterns aren't sufficient. Background thread execution with progress polling so the UI stays responsive during full scans."),
        p("Three new API endpoints for quality (summary, entity detail, refresh) and four for classification (scan, status, summary, data). This moves us from the 'Not Yet Active' placeholder into a real quality and classification system. Cleansing rules are the next piece. Connecting this to "),
        inline_card("MT-93"),
        {"type": "text", "text": " where all the backend infrastructure was built."},
    ])
    time.sleep(1)

    worklog("MT-50", 14400, "2026-03-13T08:00:00.000-0600",
            "Built the quality scoring engine (4-dimension scorer with configurable weights) and classification engine (25+ regex patterns, optional Presidio PII detection). Scored all 1,725 entities, created 7 API endpoints, wired DataClassification.tsx to real backend data.")

    transition("MT-50", "2")  # Planning -> In Progress
    update_fields("MT-50", {
        "labels": ["bronze-silver", "cleansing", "data-quality", "fmd-framework",
                   "classification", "pii-detection", "quality-scoring"],
    })


# ============================================================
# PHASE 5: Update MT-88 (Entity Digest Phase 2)
# ============================================================
def phase5_mt88():
    print("\n=== PHASE 5: MT-88 Entity Digest Phase 2 ===")

    comment("MT-88", [
        p("Entity digest enrichment is complete. The digest endpoint now returns businessName, description, domain, tags, qualityScore, and qualityTier for every entity, pulled from the glossary annotations and quality scoring tables. This means any page using useEntityDigest gets the full business context automatically."),
        p("The frontend hook uses a module-level singleton cache with 30-second TTL and request deduplication, so multiple components mounting simultaneously don't hammer the endpoint. The enrichment itself runs at query time by joining across entity_annotations and quality_scores in SQLite. Fast enough (sub-100ms for the full 1,725 entity set) that we don't need a materialized view."),
        p("RecordCounts page was migrated to use the digest. ControlPlane stays on its own server-aggregated endpoint since it needs a different data shape. This wraps up the digest engine work started in "),
        inline_card("MT-87"),
        {"type": "text", "text": "."},
    ])
    time.sleep(1)

    worklog("MT-88", 7200, "2026-03-13T14:00:00.000-0600",
            "Enriched entity digest with glossary and quality data. Added businessName, description, domain, tags, qualityScore, qualityTier fields. Verified frontend useEntityDigest hook caching works correctly with the enriched payload.")

    update_fields("MT-88", {"timetracking": {"remainingEstimate": "0h"}})
    add_watchers("MT-88")
    transition("MT-88", "31")  # -> Done
    print("  MT-88 -> Done")


# ============================================================
# PHASE 6: Update MT-21 (Fabric Console UI)
# ============================================================
def phase6_mt21():
    print("\n=== PHASE 6: MT-21 Fabric Console UI ===")

    comment("MT-21", [
        p("Big UI push this week. The dashboard went through a complete visual overhaul. Started with a full audit of all 42 pages (171 bugs fixed), then migrated the entire design system from the OKLCH dark theme to a warm light-mode palette called 'Industrial Precision'. Canvas (#F4F2ED), Surface (#FEFDFB), Ink (#1C1917), with Copper, Operational, Caution, and Fault accent colors."),
        p("Ran the migration with 7 parallel teams: Foundation (shared components, index.css, Tailwind config), then 6 domain teams covering Core Monitoring, Data Exploration, Pipeline & Viz, Quality & Governance, Analysis & Testing, and Admin/Settings/Setup. 70 out of 70 pages migrated with 2,766 var(--bp-*) token references replacing the old CDS classes."),
        p("Consolidated the font stack too. Found 42 hardcoded font-family declarations scattered across the codebase. Replaced all of them with 3 CSS custom properties: --font-sans (Outfit), --font-display (Instrument Serif), --font-mono (JetBrains Mono). Removed 2 unused Google Fonts imports saving about 30KB."),
        p("The useTerminology hook got expanded from 23 to 40+ mappings with business-friendly labels. 'Landing Zone' becomes 'Source Files', internal jargon gets translated to something a business user would understand. Also built the Business Portal shell with dual-persona navigation (engineering view vs business view) and a BusinessOverview page."),
        p("New pages this week: Database Explorer (browse SQLite), Load Center (one-click smart loading), Business Portal overview. Sidebar was restructured from 35 items down to 19 across 5 groups."),
    ])
    time.sleep(1)

    worklog("MT-21", 21600, "2026-03-16T08:00:00.000-0600",
            "Executed the Business Portal design migration across 70 pages. Ran 7 parallel teams for the Industrial Precision restyle. Built foundation CSS tokens, migrated all shared components and UI primitives, then swept through every page in the dashboard. Two rounds of audit-fix to clean up remaining issues.")
    worklog("MT-21", 7200, "2026-03-17T08:00:00.000-0600",
            "Font consolidation pass. Audited every file for hardcoded font-family strings, replaced 42 instances with CSS custom properties, removed 2 unused Google Fonts imports. Verified with 4 parallel audit agents across 100+ files.")

    update_fields("MT-21", {
        "labels": ["fabric-console", "frontend", "monitoring", "ui",
                   "design-system", "business-portal", "typography"],
    })


# ============================================================
# PHASE 7: Update MT-57 (Historical Data Backfill)
# ============================================================
def phase7_mt57():
    print("\n=== PHASE 7: MT-57 Historical Data Backfill ===")

    comment("MT-57", [
        p("Engine improvements this week to support local Bronze/Silver processing. Built a local Bronze processor that reads LZ parquet files and writes Bronze Delta tables, and a local Silver processor with SCD Type 2 merge logic. Added OneLake I/O helpers for reading and writing both parquet and Delta table formats. New data models: BronzeEntity and SilverEntity with all the fields needed for local processing."),
        p("Wired the local processors into the orchestrator so they can run alongside the Fabric notebook-based pipeline. Also rewrote the engine validation queries to use entity_status as the source of truth instead of the old execution tracking tables."),
        p("On the data discovery side: 1,724 entities now registered (up from 1,666 after discovering 58 new tables, mostly in OPTIVA). Ran optimize-all: 1,341 PKs discovered (78%), 325 incremental watermarks set. Bumped MAX_INCREMENTAL_PRIORITY from 3 to 4 to include identity columns, which pushed incremental load percentage from 6% to 18.9%."),
    ])
    time.sleep(1)

    worklog("MT-57", 14400, "2026-03-12T08:00:00.000-0600",
            "Built the local Bronze and Silver processors with Delta table support. Implemented OneLake I/O helpers, BronzeEntity/SilverEntity data models, and wired everything into the orchestrator. Added SCD Type 2 merge logic for the Silver processor.")


# ============================================================
# PHASE 8: Create New Tickets
# ============================================================
def phase8_new_tickets():
    print("\n=== PHASE 8: Create New Tickets ===")

    # Ticket 1: Business Portal
    print("  Creating Business Portal ticket...")
    result = jira_request("/issue", "POST", {
        "fields": {
            "project": {"key": "MT"},
            "summary": "Business Portal: Dual-Persona Navigation & Industrial Precision Design System",
            "issuetype": {"name": "Task"},
            "parent": {"key": "MT-12"},
            "assignee": {"accountId": STEVE},
            "priority": {"name": "Priority 2"},
            "labels": ["business-portal", "design-system", "frontend", "typography", "ux"],
            "duedate": "2026-03-17",
            "timetracking": {"originalEstimate": "3d"},
        }
    })
    bp_key = result.get("key") if result else None
    if bp_key:
        print(f"  Created {bp_key}")
        time.sleep(1)
        # Add description
        update_fields(bp_key, {
            "description": {
                "version": 1, "type": "doc",
                "content": [
                    heading(2, "Objective"),
                    p("Build a dual-persona Business Portal that provides both engineering and business views of the FMD dashboard, with a new Industrial Precision design system replacing the OKLCH dark theme."),
                    heading(2, "Scope"),
                    bullet_list([
                        "BusinessShell layout with engineering/business persona toggle",
                        "BusinessOverview page with high-level KPIs and entity health",
                        "useTerminology hook expanded from 23 to 40+ business-friendly mappings",
                        "Industrial Precision design system: warm light palette with OKLCH tokens",
                        "Font stack: Instrument Serif (headings), Outfit (body), JetBrains Mono (data)",
                        "70/70 pages migrated to new design tokens (2,766 var(--bp-*) references)",
                        "Sidebar restructured: 35 items consolidated to 19 across 5 groups",
                        "42 hardcoded font-family declarations replaced with 3 CSS custom properties",
                    ]),
                    heading(2, "Architecture"),
                    p("The design system uses CSS custom properties defined in index.css as the single source of truth. Tailwind semantic classes are remapped so existing pages automatically resolve to BP colors. The .dark CSS block mirrors :root (light-only theme). All --shadow-* properties set to none (zero-shadow rule)."),
                    heading(2, "Acceptance Criteria"),
                    bullet_list([
                        "All 70 pages render with BP tokens, zero old CDS color classes",
                        "useTerminology returns business-friendly labels for all internal vocabulary",
                        "Font audit passes: zero hardcoded font-family strings in codebase",
                        "Build passes with zero errors",
                    ]),
                ]
            }
        })
        time.sleep(1)
        comment(bp_key, [
            p("Built this across two focused sessions. The foundation went in first: 19 new CSS tokens in index.css, Tailwind semantic class remapping, shared component updates (card, button, badge, input, select, dialog), and the 3 KPI components. Then ran 7 parallel teams to migrate every page in the dashboard."),
            p("The useTerminology hook was the key insight for the business portal. Instead of building separate 'business' pages, we just translate the internal vocabulary at the component level. 'Landing Zone' becomes 'Source Files', 'Bronze' becomes 'Raw Data', etc. The BusinessShell provides a toggle between the engineering view (full sidebar) and the business view (simplified nav with translated labels)."),
            p("Font consolidation was a separate pass after the color migration. Found fonts scattered everywhere: inline styles, Tailwind classes, component-level overrides. Cleaned all 42 instances down to 3 CSS variables. Removed DM Sans and IBM Plex Mono imports that nobody was using."),
        ])
        time.sleep(1)
        worklog(bp_key, 21600, "2026-03-16T08:00:00.000-0600",
                "Built the Business Portal shell, BusinessOverview page, and ran the Industrial Precision design migration across all 70 pages with 7 parallel teams. Foundation CSS tokens, shared component migration, then domain-by-domain page sweep.")
        worklog(bp_key, 7200, "2026-03-17T08:00:00.000-0600",
                "Font consolidation pass. Audited and replaced 42 hardcoded font-family strings with 3 CSS custom properties. Removed unused Google Fonts imports. Ran multi-agent audit to verify 100% compliance.")
        update_fields(bp_key, {"timetracking": {"remainingEstimate": "0h"}})
        add_watchers(bp_key)
        transition(bp_key, "31")  # -> Done
        print(f"  {bp_key} -> Done")
    time.sleep(1)

    # Ticket 2: Gold Studio Implementation
    print("  Creating Gold Studio ticket...")
    result = jira_request("/issue", "POST", {
        "fields": {
            "project": {"key": "MT"},
            "summary": "Gold Studio: Full-Stack Implementation (Schema, Parsers, API, UI)",
            "issuetype": {"name": "Task"},
            "parent": {"key": "MT-12"},
            "assignee": {"accountId": STEVE},
            "priority": {"name": "Priority 2"},
            "labels": ["gold-layer", "gold-studio", "full-stack", "parsers", "api", "frontend"],
            "duedate": "2026-03-19",
            "timetracking": {"originalEstimate": "2d"},
        }
    })
    gs_key = result.get("key") if result else None
    if gs_key:
        print(f"  Created {gs_key}")
        time.sleep(1)
        update_fields(gs_key, {
            "description": {
                "version": 1, "type": "doc",
                "content": [
                    heading(2, "Objective"),
                    p("Implement the Gold Studio tooling layer end-to-end: database schema, parser framework, API routes, and React UI pages. Gold Studio manages the lifecycle of Gold entity definitions from import through validation."),
                    heading(2, "Implementation"),
                    bullet_list([
                        "19 gs_* SQLite tables (canonical entities, columns, imports, parsers, clusters, reconciliation, validations, jobs, lineage)",
                        "Parser framework with 6 parsers: Power BI semantic model, Excel mapping, SQL view, CSV, dbt, manual entry",
                        "55 API endpoints across 12 route groups (imports, parsers, canonical, clusters, reconciliation, specs, validation, lineage, audit, jobs, reports, admin)",
                        "5 React pages: GoldCanonical, GoldClusters, GoldLedger, GoldSpecs, GoldValidation",
                        "Shared components: ProvenanceThread, SpecimenCard, ClusterCard, ColumnReconciliation, GoldStudioLayout, StatsStrip, SlideOver",
                        "Security: 3 auth tiers (Viewer, Contributor, Approver)",
                        "Versioning: optimistic concurrency via expected_version fields",
                    ]),
                    heading(2, "Design Specification"),
                    p("1,580-line design spec went through 2 QA audit rounds. Round 1: 57 findings (6 CRITICAL, 13 HIGH), all fixed. Round 2: 0 CRITICAL, 0 HIGH. 96.4% methodology compliance."),
                    heading(2, "Acceptance Criteria"),
                    bullet_list([
                        "All 19 gs_* tables created in SQLite schema",
                        "All 6 parsers handle their format correctly",
                        "All 5 pages render and connect to real API data",
                        "Build passes with zero errors",
                    ]),
                ]
            }
        })
        time.sleep(1)
        comment(gs_key, [
            p("This went from spec to fully implemented in a focused push. Started with the design spec, put it through two QA audit rounds to make sure the architecture was solid before writing any code. The spec covers the full lifecycle: import external definitions, parse them into canonical format, cluster related definitions, reconcile conflicts, produce validated specs."),
            p("The parser framework was the most interesting piece. Each parser implements a common interface but handles wildly different input formats. The Power BI parser reads .pbix semantic model definitions. The Excel parser handles mapping spreadsheets. The SQL parser extracts column definitions from view statements. All of them produce the same canonical output structure."),
            p("The reconciliation workflow is where it gets real. When multiple imports map to the same target entity (e.g., DimCustomer defined in both a Power BI model and an Excel mapping), the system detects column-level conflicts and presents them for resolution. Type mismatches, naming differences, business rule disagreements all surface in the ColumnReconciliation component."),
            p("Feeds directly into "),
            inline_card("MT-19"),
            {"type": "text", "text": " and "},
            inline_card("MT-62"),
            {"type": "text", "text": "."},
        ])
        time.sleep(1)
        worklog(gs_key, 28800, "2026-03-18T08:00:00.000-0600",
                "Built Gold Studio from spec to implementation. Created 19 database tables, parser framework with 6 parsers, 55 API endpoints across 12 route groups, 5 React pages with shared components. Wired sidebar navigation and addressed 7 QA findings.")
        update_fields(gs_key, {"timetracking": {"remainingEstimate": "0h"}})
        add_watchers(gs_key)
        transition(gs_key, "31")  # -> Done
        print(f"  {gs_key} -> Done")
    time.sleep(1)

    # Ticket 3: Load Pipeline Bug Fixes
    print("  Creating Load Pipeline Bug Fixes ticket...")
    result = jira_request("/issue", "POST", {
        "fields": {
            "project": {"key": "MT"},
            "summary": "Load Pipeline Critical Bug Fixes (7 of 12 Critical Bugs Resolved)",
            "issuetype": {"name": "Task"},
            "parent": {"key": "MT-12"},
            "assignee": {"accountId": STEVE},
            "priority": {"name": "Priority 1"},
            "labels": ["bug-fix", "engine", "pipeline", "security", "critical"],
            "duedate": "2026-03-17",
            "timetracking": {"originalEstimate": "2d"},
        }
    })
    bug_key = result.get("key") if result else None
    if bug_key:
        print(f"  Created {bug_key}")
        time.sleep(1)
        update_fields(bug_key, {
            "description": {
                "version": 1, "type": "doc",
                "content": [
                    heading(2, "Objective"),
                    p("Remediate critical bugs identified during the comprehensive load pipeline audit. 87+ bugs total (12 CRITICAL, 12 HIGH), prioritizing the blockers that cause silent data loss, security vulnerabilities, and pipeline hangs."),
                    heading(2, "Bugs Fixed (7 of 12 Critical)"),
                    bullet_list([
                        "Config validation: EngineConfig.__post_init__() now validates all required fields at startup (was silently timing out after 30s)",
                        "SQL injection escape: Entity.build_source_query() escapes single quotes in watermark values",
                        "Entity pre-flight validation: 6 new checks in preflight.py (whitespace-only source names, missing PKs, invalid watermarks)",
                        "Binary type exclusion: extractor.py now excludes geometry, geography, xml, hierarchyid, sql_variant",
                        "Lakehouse map refresh: loader.py rebuilds GUID-to-name mapping every 50 entities (was stale for entire run)",
                        "Workspace GUID validation: _upload_adls() validates UUIDs before upload attempts",
                        "Zero-row detection: extractor.py distinguishes empty tables vs missing tables with diagnostics",
                    ]),
                    heading(2, "Remaining (5 of 12 Critical)"),
                    bullet_list([
                        "Run timeout (60% complete, framework added, integration needed)",
                        "Error context propagation (needs exception hierarchy)",
                        "OOM on large tables (needs streaming Parquet)",
                        "Entity snapshot at load start (deactivation safety)",
                        "Token refresh race (clock skew validation)",
                    ]),
                    heading(2, "Files Modified"),
                    p("engine/models.py, engine/extractor.py, engine/preflight.py, engine/loader.py, engine/orchestrator.py"),
                ]
            }
        })
        time.sleep(1)
        comment(bug_key, [
            p("Ran a comprehensive audit of the entire load pipeline and found 87+ bugs across 12 CRITICAL, 12 HIGH, and dozens of MEDIUM/LOW. The critical ones were causing silent data loss, security vulnerabilities, and indefinite pipeline hangs. Prioritized the 7 that could be fixed without major refactoring."),
            p("The worst one was the config validation gap. If any required field was missing from the engine config, the system would silently fall back to defaults and then timeout after 30 seconds with no error message. Now it validates everything at startup and fails fast with a clear error. The SQL injection in watermark values was also nasty. If a table had a string watermark with a quote character, the generated query would break or worse."),
            p("The remaining 5 need deeper work. OOM on large tables requires streaming Parquet writes instead of buffering entire DataFrames. The token refresh race needs clock skew detection. These are queued but not blocking day-to-day loads."),
        ])
        time.sleep(1)
        worklog(bug_key, 14400, "2026-03-17T08:00:00.000-0600",
                "Systematic remediation of critical pipeline bugs. Worked through the audit findings methodically: config validation, SQL injection escaping, pre-flight checks, binary type exclusion, lakehouse map refresh, GUID validation, zero-row detection. Tested each fix against the full entity set.")
        update_fields(bug_key, {"timetracking": {"remainingEstimate": "4h"}})
        add_watchers(bug_key)
        transition(bug_key, "2")  # -> In Progress (still 5 bugs remaining)
        print(f"  {bug_key} -> In Progress")

    return bp_key, gs_key, bug_key


# ============================================================
# PHASE 9: Link new tickets
# ============================================================
def phase9_links(gs_key):
    print("\n=== PHASE 9: Issue Links ===")
    if gs_key:
        # Gold Studio relates to MT-19
        jira_request("/issueLink", "POST", {
            "type": {"name": "Relates"},
            "inwardIssue": {"key": gs_key},
            "outwardIssue": {"key": "MT-19"}
        })
        print(f"  Linked {gs_key} <-> MT-19")


# ============================================================
# MAIN
# ============================================================
def main():
    print("=" * 60)
    print("FMD Framework Weekly Jira Update")
    print("March 10-19, 2026 | 69 commits | 6 work streams")
    print("=" * 60)

    phase1_mt93()
    time.sleep(2)
    phase2_mt19()
    time.sleep(2)
    phase3_mt62()
    time.sleep(2)
    phase4_mt50()
    time.sleep(2)
    phase5_mt88()
    time.sleep(2)
    phase6_mt21()
    time.sleep(2)
    phase7_mt57()
    time.sleep(2)
    bp_key, gs_key, bug_key = phase8_new_tickets()
    time.sleep(2)
    phase9_links(gs_key)

    print("\n" + "=" * 60)
    print("SUMMARY OF ACTIONS:")
    print("=" * 60)
    print("  MT-93: 2 comments, 4 worklogs (4d), fields updated, -> Done")
    print("  MT-19: 1 comment, 2 worklogs (10h), labels updated")
    print("  MT-62: 1 comment, 1 worklog (2h), -> In Progress")
    print("  MT-50: 1 comment, 1 worklog (4h), -> In Progress")
    print("  MT-88: 1 comment, 1 worklog (2h), -> Done")
    print("  MT-21: 1 comment, 2 worklogs (8h), labels updated")
    print("  MT-57: 1 comment, 1 worklog (4h)")
    if bp_key:
        print(f"  {bp_key}: NEW - Business Portal, description, comment, 2 worklogs (8h), -> Done")
    if gs_key:
        print(f"  {gs_key}: NEW - Gold Studio, description, comment, 1 worklog (8h), -> Done")
    if bug_key:
        print(f"  {bug_key}: NEW - Bug Fixes, description, comment, 1 worklog (4h), -> In Progress")
    print()
    print("Total worklogs: ~54h across Mar 10-18")
    print("New tickets created: 3")
    print("Tickets transitioned to Done: MT-93, MT-88, BP, Gold Studio")
    print("Tickets transitioned to In Progress: MT-62, MT-50, Bug Fixes")


if __name__ == "__main__":
    main()
