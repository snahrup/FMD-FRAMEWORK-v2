# FMD Dashboard Constitution

> **This document is law.** Every Claude Code session working on the FMD dashboard must follow these rules. No exceptions. No silent overrides. If a rule needs to change, change this document first.

**Last updated:** 2026-03-19
**Scope:** All pages, components, routes, and API endpoints in `dashboard/app/`

---

## 1. Audit-First Requirement

**No implementation on any page until a Page Truth Audit exists and is approved.**

This is the single most important rule. It prevents:
- Whack-a-mole bug fixes that create new bugs
- Multi-file changes with unknown blast radius
- "Improvements" that break working functionality
- Stubbed behavior being treated as real

### What counts as an approved audit:
- A completed Page Truth Audit (see `PAGE-TRUTH-AUDIT-TEMPLATE.md`) saved to `docs/superpowers/audits/`
- Covers: purpose, data contracts, state matrix, real vs stubbed, root-cause clusters, repair order
- Reviewed by Steve or explicitly approved in conversation

### Exceptions:
- **Hotfixes**: A production-breaking bug can be fixed without a full audit, but the fix must be scoped to the break only (no adjacent cleanup)
- **New pages**: Brand new pages that don't exist yet follow the spec → implement flow (like Gold Studio)

---

## 2. Blast Radius Control

### Allowed blast radius per change:
- **1 page + its direct API route** = safe
- **2-3 related pages sharing a backend route** = acceptable with justification
- **Shared component change** = requires impact list of all consuming pages
- **Control plane DB schema change** = requires migration plan + downstream audit
- **Router/layout change** = requires full regression check

### Forbidden:
- Changing shared UI components (ui/button, ui/card, etc.) as part of a page fix
- "While I'm here" edits to adjacent pages
- Refactoring imports/exports in files you didn't plan to touch
- Changing the SQLite schema without a migration path

---

## 3. State Truthfulness

Every UI element must accurately represent the actual system state.

### Rules:
- **Never show a count that isn't from a real query.** If you can't get the real count, show "—" or "unavailable", not 0.
- **Never show a success state for an operation that hasn't completed.** Loading spinners, not green checkmarks.
- **Never show mock data as if it were real.** If data is simulated, label it explicitly: "Sample data" or "Demo mode".
- **Never show registered entity counts as physical table/row counts.** Registered ≠ loaded. See memory: `feedback-physical-vs-registered-counts.md`.
- **Loading states are mandatory.** Every async fetch needs: loading, error, and empty states handled.
- **Error states must be specific.** "Something went wrong" is not acceptable. Show the actual error or a meaningful category.

### Stub behavior rules:
- If a page or feature is stubbed/placeholder, it must say so visibly
- Stub pages should not appear in primary navigation (move to Labs or hide behind feature flag)
- A stub that looks like it works but doesn't is worse than a missing page

---

## 4. Data Source Discipline

### Source of truth: `docs/data-source-audit.html`
- Must be updated whenever any visual's data source changes
- Every API endpoint must document its actual data source (SQLite, Fabric SQL, OneLake, on-prem ODBC, hardcoded)

### Rules:
- **SQLite (control_plane_db)** is the primary data source for most dashboard pages
- **Fabric SQL Endpoint** requires token auth and has sync lag (see `memory/sql-endpoint-sync-lag.md`)
- **On-prem ODBC** requires VPN — pages using it must handle connection failures gracefully
- **Never mix data sources in a single aggregation** without documenting the join semantics
- **Hardcoded data is a bug**, not a feature — replace or label it

---

## 5. Navigation & Information Architecture

### Rules:
- **Sidebar must stay minimal.** Consolidate and remove rather than accumulate (see memory: `feedback-nav-simplification.md`)
- **Current structure: 19 items across 5 groups** (Load, Monitor, Explore, Quality, Admin) — new pages must fit into existing groups or justify a new group
- **Stub pages stay out of primary nav.** Use `/labs/*` routes with feature flags
- **Every page needs a clear single purpose.** If you can't describe what the page does in one sentence, it's doing too much

---

## 6. Scalability Requirements

### Rules:
- **All UI must scale to N sources.** Never hardcode source count, source names, or source-specific colors (see memory: `feedback-scalable-sources.md`)
- **Entity tables must handle 1,666+ entities** without pagination bugs or performance degradation
- **Polling intervals**: 5s minimum for status checks, 30s for digest/summary, no sub-second polling
- **useEntityDigest hook**: Module-level singleton cache, 30s TTL, request dedup — use this for entity data, don't re-fetch

---

## 7. Implementation Packets

When implementation is approved after an audit, work must be organized into packets:

### Packet sequence (Gold Studio model):
1. **Packet A: Truth & Alignment** — Fix data contracts, API responses, remove fake state
2. **Packet B: Page Shell** — Layout, navigation, loading/error/empty states
3. **Packet C: Core Workflows** — Primary user interactions and mutations
4. **Packet D: Hardening & Polish** — Edge cases, accessibility, performance, error recovery

### Packet rules:
- Each packet is a self-contained PR-able unit
- Each packet has a verification checklist
- No packet depends on a future packet to work correctly
- Packet A always comes first — fix the data layer before touching the UI

---

## 8. API Route Standards

### Every API route must:
- Return consistent JSON shape: `{ data, error, meta }`
- Handle missing/invalid query params with 400, not 500
- Log errors to console with enough context to diagnose
- Return real data or explicitly empty results — never silently return stale cache

### Forbidden:
- Returning mock arrays of fake data from a production endpoint
- Catching and swallowing exceptions without logging
- SQL injection via string concatenation (use parameterized queries)
- Returning 200 with an error message in the body

---

## 9. Component & Styling Standards

### Rules:
- **Tailwind + shadcn/ui** is the component system — no raw HTML styling
- **No inline styles** except for truly dynamic values (e.g., width from data)
- **Dark mode support** via Tailwind classes (dark: prefix)
- **Responsive by default** — every page must work at 1280px+ width minimum
- **No direct DOM manipulation** — React state drives everything

---

## 10. Testing & Verification

### Before marking any page work as complete:
- [ ] All API endpoints return real data (not mock/stub)
- [ ] Loading, error, and empty states render correctly
- [ ] Page works with 0 entities, 1 entity, and 1000+ entities
- [ ] No console errors or unhandled promise rejections
- [ ] Navigation to/from the page works correctly
- [ ] Data shown matches what the API returns (no transformation bugs)
- [ ] Page purpose matches what CLAUDE.md / audit says it should do

---

## Document References

| Document | Purpose |
|----------|---------|
| `PAGE-TRUTH-AUDIT-TEMPLATE.md` | Reusable template for auditing any page |
| `WHOLE-APP-CENSUS.md` | Inventory + priority matrix of all pages |
| `audits/*.md` | Completed page truth audits |
| `specs/*.md` | Design specifications for new features |
| `plans/*.md` | Implementation plans |
| `docs/data-source-audit.html` | Data source truth for all visuals |
| `CLAUDE_RULES.md` | Operating modes and hard rules |
| `ARCHITECTURE.md` | Paths, GUIDs, schema, pipeline chain |
