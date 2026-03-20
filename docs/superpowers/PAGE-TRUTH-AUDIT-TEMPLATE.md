# Page Truth Audit Template

> **Copy this template for each page/subsystem audit.** Save completed audits to `docs/superpowers/audits/AUDIT-{PageName}.md`. Fill in every section — mark "N/A" if genuinely not applicable, never leave blank.

---

```markdown
# Page Truth Audit: {PageName}

**Date:** YYYY-MM-DD
**Auditor:** {session name or "Claude"}
**Route:** `/{route-path}`
**Health:** 🟢 Stable | 🟡 Fragile | 🔴 Broken | ⚪ Stub

---

## 1. Purpose

> One sentence: what is this page for? What user job does it serve?

{description}

**Primary user jobs:**
1. {job 1 — e.g., "See which entities loaded successfully in the last run"}
2. {job 2}
3. {job 3}

---

## 2. File Map

| Role | File | Lines |
|------|------|-------|
| Page component | `dashboard/app/src/pages/{Page}.tsx` | {n} |
| Child component(s) | `dashboard/app/src/components/{...}.tsx` | {n} |
| API route | `dashboard/app/api/routes/{route}.py` | {n} |
| Types | `dashboard/app/src/types/{...}.ts` | {n} |
| Hooks | `dashboard/app/src/hooks/{...}.ts` | {n} |

---

## 3. Backend Dependencies

### API Endpoints Consumed

| Endpoint | Method | Backend Handler | Data Source | Status |
|----------|--------|-----------------|-------------|--------|
| `/api/{...}` | GET | `{file}:{function}` | SQLite / Fabric SQL / ODBC / OneLake / Hardcoded | ✅ Real / ⚠️ Partial / ❌ Stub / 🔴 Broken |

### External Dependencies
- [ ] Requires VPN (on-prem ODBC)
- [ ] Requires Fabric token (SQL Endpoint / API)
- [ ] Requires engine running (engine/* endpoints)
- [ ] Requires OneLake mount
- [ ] None — SQLite only

---

## 4. Data Contracts

For each major data fetch, document the expected shape:

### {Endpoint name}
```json
// Expected response shape
{
  "field": "type — where it comes from"
}
```

**Frontend assumptions about this data:**
- {assumption 1 — e.g., "assumes `rows` is never null"}
- {assumption 2}

**Mismatches found:**
- {mismatch — e.g., "Frontend expects `entityCount` but backend returns `entity_count`"}

---

## 5. State Matrix

Document every significant UI state and whether it's handled:

| State | Trigger | Handled? | What renders |
|-------|---------|----------|-------------|
| Loading | Initial fetch | ✅/❌ | {spinner / skeleton / nothing} |
| Error | API 500 / network failure | ✅/❌ | {error message / crash / nothing} |
| Empty | No data returned | ✅/❌ | {empty state / blank / misleading} |
| Success | Data loaded | ✅ | {normal render} |
| Partial | Some endpoints fail | ✅/❌ | {partial render / crash} |
| Stale | Cache expired, re-fetching | ✅/❌ | {stale-while-revalidate / blank} |
| Offline | VPN/Fabric unavailable | ✅/❌ | {graceful degradation / crash} |

---

## 6. Real vs Stubbed Behavior

Classify every major feature/workflow on this page:

| Feature/Workflow | Classification | Evidence |
|-----------------|---------------|----------|
| {feature 1} | 🟢 Real and working | {how you verified} |
| {feature 2} | 🟡 Real but incomplete | {what's missing} |
| {feature 3} | 🟠 Stub / simulated | {what makes it fake} |
| {feature 4} | 🔴 Broken | {what fails and why} |
| {feature 5} | ⚫ Missing | {should exist but doesn't} |

### Misleading UI/State

List every place the frontend overstates reality:

1. **{Element}** — Shows {what it shows} but actually {what's really happening}
2. **{Element}** — Implies {implication} but {reality}

---

## 7. Mutation Flows

For any page that writes/modifies data:

| Action | Endpoint | Method | What it changes | Validation | Optimistic? |
|--------|----------|--------|-----------------|------------|-------------|
| {action} | `/api/{...}` | POST/PUT/DELETE | {what changes} | {client/server/none} | {yes/no} |

**Mutation concerns:**
- {concern — e.g., "No confirmation dialog before delete"}

---

## 8. Root-Cause Bug Clusters

Group bugs by underlying cause, not by symptom:

### Cluster 1: {Root cause name — e.g., "Missing error handling on async fetches"}
- **Symptom A**: {description}
- **Symptom B**: {description}
- **Fix**: {single fix that addresses the root cause}
- **Files**: `{file1}`, `{file2}`

### Cluster 2: {Root cause name}
- ...

---

## 9. Minimal Repair Order

Ordered list of fixes, from most impactful to least:

| Priority | Fix | Cluster | Effort | Impact |
|----------|-----|---------|--------|--------|
| 1 | {fix description} | Cluster {n} | S/M/L | Critical / High / Medium / Low |
| 2 | {fix description} | Cluster {n} | S/M/L | Critical / High / Medium / Low |

---

## 10. Proposed Packet Sequence

### Packet A: Truth & Alignment
**Goal:** Fix the data layer so the page shows reality
- [ ] {task 1}
- [ ] {task 2}

### Packet B: Page Shell
**Goal:** Layout, navigation, loading/error/empty states
- [ ] {task 1}
- [ ] {task 2}

### Packet C: Core Workflows
**Goal:** Primary user interactions working end-to-end
- [ ] {task 1}
- [ ] {task 2}

### Packet D: Hardening & Polish
**Goal:** Edge cases, error recovery, performance
- [ ] {task 1}
- [ ] {task 2}

---

## 11. Verification Checklist

- [ ] All API endpoints return real data (not mock/stub)
- [ ] Loading, error, and empty states render correctly
- [ ] Page works with 0 entities, 1 entity, and 1000+ entities
- [ ] No console errors or unhandled promise rejections
- [ ] Navigation to/from page works correctly
- [ ] Data matches API response (no transformation bugs)
- [ ] Mutations have confirmation dialogs where appropriate
- [ ] Page purpose matches what census says it should do
- [ ] No misleading UI elements remain
```

---

## How to Use This Template

### For Claude Code sessions:

1. **Copy the template** above into `docs/superpowers/audits/AUDIT-{PageName}.md`
2. **Read the page component** — trace every `fetch()`, `useEffect`, and state variable
3. **Read the API route** — trace every endpoint to its data source
4. **Compare frontend assumptions to backend reality** — this is where most bugs live
5. **Fill in every section** — skipping sections defeats the purpose
6. **Classify honestly** — a stub is a stub, don't call it "partially implemented" to be nice

### For prioritization:

- Pages with more 🔴 Broken and 🟠 Stub entries get higher priority
- Pages with misleading UI get higher priority than pages with missing features
- Pages that users actually visit daily get higher priority than admin tools

### After the audit:

- Get approval from Steve before starting implementation
- Convert Section 10 (Packet Sequence) into a formal implementation plan
- Execute packets in order — never skip Packet A
