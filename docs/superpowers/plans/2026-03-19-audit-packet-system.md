# FMD Dashboard: Audit-First Packet System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a repeatable, audit-first planning system for the entire FMD dashboard, then use it to systematically repair pages by priority.

**Architecture:** Three-layer system — Constitution (house law) → Page Truth Audit (reusable template) → Packet Factory (implementation chunks). Every page gets audited before implementation. Audits produce packetized repair plans. Packets execute in dependency order (truth first, then shell, then workflows, then hardening).

**Tech Stack:** React/TypeScript (Vite, Tailwind, shadcn/ui) frontend, Python FastAPI backend, SQLite control plane DB.

---

## System Documents (Created)

| Document | Path | Purpose |
|----------|------|---------|
| **Dashboard Constitution** | `docs/superpowers/DASHBOARD-CONSTITUTION.md` | House law — 10 rules that govern all dashboard work |
| **Page Truth Audit Template** | `docs/superpowers/PAGE-TRUTH-AUDIT-TEMPLATE.md` | Reusable template for auditing any page |
| **Whole-App Census** | `docs/superpowers/WHOLE-APP-CENSUS.md` | 55-page inventory with 5-tier priority matrix |
| **5 Page Audits** | `docs/superpowers/audits/AUDIT-{Page}.md` | Deep truth audits for top 5 priority pages |

---

## How the System Works

### Rule Zero
**No implementation on any page until a Page Truth Audit exists and is approved.**

### Workflow
```
Census → Audit → Approve → Packetize → Implement → Verify
  │         │        │          │           │          │
  │         │        │          │           │          └─ Verification checklist
  │         │        │          │           └─ One packet at a time, A→B→C→D
  │         │        │          └─ Convert audit Section 10 to implementation plan
  │         │        └─ Steve reviews audit, approves or requests changes
  │         └─ Fill Page Truth Audit Template for the target page
  └─ Update WHOLE-APP-CENSUS.md if page inventory changed
```

### Packet Sequence (always in this order)
1. **Packet A: Truth & Alignment** — Fix data contracts, API responses, remove fake state
2. **Packet B: Page Shell** — Layout, navigation, loading/error/empty states
3. **Packet C: Core Workflows** — Primary user interactions and mutations
4. **Packet D: Hardening & Polish** — Edge cases, accessibility, performance, error recovery

---

## Current State: Top 5 Audits Complete

### Critical Findings Summary

| Page | Health | Showstopper | Quick Win |
|------|--------|-------------|-----------|
| **SourceManager** | 🟡 | 2 missing endpoints (`/api/gateway-connections`, `POST /api/connections`), import pipeline stubs phases 2-5 | Fix discover-all Type filter (5 min) |
| **EngineControl** | 🟡 | Ghost `/engine/jobs` endpoint (constant 404s), no SSE-disconnect indicator | Remove dead polling (15 min) |
| **LoadCenter** | 🟡 | `_build_source_lookup` undefined — **both run buttons crash** | Remove or implement the function call (30 min) |
| **BusinessOverview** | 🟡 | Status enum mismatch — **Alerts and Activity panels permanently empty** | Map `loaded`→`success` in backend (15 min) |
| **ConfigManager** | 🟡 | Pipelines SELECT missing 2 columns, cascade modal never triggers | Add columns to SELECT (5 min) |

### Estimated Quick-Fix Pass (Packet A only, all 5 pages)
**~4 hours of targeted work** to ground all 5 pages in truth:
- SourceManager: 2-4h (missing endpoints)
- EngineControl: 30 min (remove ghost polling, add SSE indicator)
- LoadCenter: 30 min (fix undefined function)
- BusinessOverview: 30 min (status mapping + alerts fix)
- ConfigManager: 30 min (SELECT fix + cascade count + handler)

---

## Recommended Next Steps

### Immediate (this week)
- [ ] **Approve or adjust the 5 page audits** — they're in `docs/superpowers/audits/`
- [ ] **Execute Packet A for BusinessOverview** — 15 min fix unblocks 2 dead panels (highest ROI)
- [ ] **Execute Packet A for LoadCenter** — 30 min fix unblocks the headline feature
- [ ] **Execute Packet A for ConfigManager** — 30 min fix unblocks 3 broken features
- [ ] **Execute Packet A for EngineControl** — 30 min cleanup of ghost endpoint

### Next Wave (after Packet A)
- [ ] **Audit Wave 2 pages** (PipelineMonitor, DataMicroscope, FlowExplorer, RecordCounts, ExecutionMatrix)
- [ ] **Execute Packet B+C for completed pages** (only after all Packet A fixes verified)

### Ongoing
- [ ] **Before touching any page**: Check if it has an audit in `docs/superpowers/audits/`
- [ ] **If no audit exists**: Create one using the template before implementing
- [ ] **After implementation**: Update the audit to reflect current state

---

## Wave Schedule

| Wave | Pages | Focus | Est. Audit Time | Est. Packet A Time |
|------|-------|-------|-----------------|-------------------|
| **1 (done)** | SourceManager, EngineControl, LoadCenter, BusinessOverview, ConfigManager | Core operations | ✅ Complete | ~4h |
| **2** | PipelineMonitor, DataMicroscope, FlowExplorer, RecordCounts, ExecutionMatrix | Monitoring + visualization | ~2h | ~3h |
| **3** | DataCatalog, DataClassification, ImpactAnalysis | Mock data → real or remove | ~1h | ~4h (need backends) |
| **4** | Remaining 22 fragile pages | Audit when touched | On-demand | Varies |
| **5** | 4 stub pages | Keep, kill, or build | ~30 min | Decision needed |

---

## For Claude Code Sessions

### Starting work on a page:
1. Check `docs/superpowers/audits/AUDIT-{PageName}.md`
2. If exists → read it, follow the packet sequence
3. If missing → create one using `PAGE-TRUTH-AUDIT-TEMPLATE.md`
4. Get approval before implementing
5. Execute packets in order: A → B → C → D

### After completing a packet:
1. Update the audit doc to reflect changes
2. Run the verification checklist
3. Commit with message referencing the packet: `fix(page): Packet A — truth alignment for {PageName}`

### Constitution reference:
Read `docs/superpowers/DASHBOARD-CONSTITUTION.md` — it defines the 10 rules that govern all dashboard work.

---

## Recommendation: Next Subsystem After Gold Studio

**BusinessOverview + LoadCenter** — these are the two pages users see most, and both have trivial-to-fix showstoppers:
- BusinessOverview: 15-minute status mapping fix unblocks both main panels
- LoadCenter: 30-minute function fix unblocks the headline feature

After those, **SourceManager** is the next big subsystem — the onboarding wizard needs real backend endpoints, which is a larger lift but extremely high value for the product vision (one-click source import).
