# Dashboard Census — Packet Map & Audit Coverage

> Complete inventory of every dashboard page: what's been audited, what hasn't, and what needs work.
> Date: 2026-03-22 | Author: Steve Nahrup

---

## How to Read This

Every nav-visible page is listed with an **audit status** and findings classified into **4 buckets**:

| Bucket | Abbrev | What It Covers |
|--------|--------|---------------|
| **Data Truth** | DT | Source-of-truth issues — wrong table, wrong query, wrong metric formula |
| **Workflow** | WF | State management, integration, broken buttons, missing endpoints |
| **UI Consistency** | UI | Visual drift — mismatched fonts, spacing, badge styles, layout inconsistencies |
| **Design Tokens** | TK | Hardcoded colors/fonts instead of `var(--bp-*)` tokens |

Audit status per page:

| Status | Meaning |
|--------|---------|
| **PACKETIZED** | Audit → triage → repair packet → PR → merged |
| **PARTIALLY** | Has audit doc OR incidental fixes, not fully through workflow |
| **NOT YET** | No audit, no packet |

**Packetization rule**: DT and WF issues get **truth repair packets** (RP-NN). UI and TK issues get separate **UI packets** (UP-NN). Never mix them unless the change is tiny and directly adjacent.

---

## Page-by-Page Inventory

### 1. Overview — `/overview` — BusinessOverview.tsx
**Audit status: PACKETIZED** | Packets: RP-02, RP-03

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | AUDIT-003: Freshness showed 0% after failed run → two-tier freshness (RP-02). AUDIT-005: Registered shown as loaded → loaded/registered split (RP-02). AUDIT-004: entity_status disagreement → all routes on engine_task_log (RP-03). | REPAIRED |
| WF | Activity panel status enum mismatch: backend returns `"loaded"`, frontend filters for `"success"`/`"error"` → panel shows empty. | OPEN (P2) |
| UI | Clean. Uses `.bp-card`, `SeverityBadge`, `SourceBadge` components. Best example to follow. | GOOD |
| TK | Compliant — proper `var(--bp-font-*)` and `var(--bp-*)` token usage throughout. | GOOD |

**Truth repair candidate**: WF activity panel enum mismatch (P2)
**UI packet candidate**: None needed

---

### 2. Load Center — `/load-center` — LoadCenter.tsx
**Audit status: PACKETIZED** | Packets: RP-01, RP-04, RP-05

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | AUDIT-001: Read empty `lakehouse_row_counts` → engine_task_log (RP-01). AUDIT-002: Drill-down dashes → fallback chain (RP-01). AUDIT-007: Incremental shown as total → Δ labels (RP-04). AUDIT-006: Auto-refresh never fires → demoted to P3. | REPAIRED (P3 residual) |
| WF | AUDIT-008: Run state lost on nav → SQLite persistence (RP-05). "Load Everything" + "Preview Run" buttons crash: `_build_source_lookup` undefined. | OPEN (P1) |
| UI | Consistent BP token usage. `thStyle` object reused for table headers. | GOOD |
| TK | Compliant — hardcoded padding values (not tokens) but colors are tokenized. | MINOR |

**Truth repair candidate**: WF button crash (P1 — needs its own packet)
**UI packet candidate**: None needed

---

### 3. Source Manager — `/sources` — SourceManager.tsx
**Audit status: PARTIALLY** | Packets: RP-03 (entity_status removal only)

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | entity_status dependency removed (RP-03). No other DT issues found. | REPAIRED |
| WF | `/api/gateway-connections` has no backend route (P1). `/api/analyze-source` returns wrong object structure (P2). Import phases 2-5 stubbed (P2). VPN required for discovery/optimization. | OPEN |
| UI | Consistent BP token usage. | GOOD |
| TK | Compliant. | GOOD |

**Truth repair candidate**: WF missing endpoint + shape mismatch (needs packet)
**UI packet candidate**: None needed
**Existing audit doc**: AUDIT-SourceManager.md

---

### 4. Execution Matrix — `/matrix` — ExecutionMatrix.tsx
**Audit status: PARTIALLY** | Packets: RP-03 (entity_status removal only)

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Status derivation fixed via `get_canonical_entity_status()` (RP-03). | REPAIRED |
| WF | No known issues. | OK |
| UI | Recharts bar chart has hardcoded colors in tick/tooltip. Badge styles are inline (no reusable component). | MODERATE |
| TK | 7+ hardcoded hex colors: `#1C1917`, `#78716C`, `#A8A29E`, `#FEFDFB`, `#57534E`, `#3D7C4F`, `#B93A2A`. Wrong font token: `var(--font-display)` (missing `bp-` prefix). | CRITICAL |

**Truth repair candidate**: None
**UI packet candidate**: YES — token violations (hardcoded hex, wrong font var)

---

### 5. Error Intelligence — `/errors` — ErrorIntelligence.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Reads engine_task_log directly — likely correct but unverified. | UNAUDITED |
| WF | Unaudited. | UNAUDITED |
| UI | Uses `<Badge>` component + inline styles (clean pattern). Consistent across severity levels. | GOOD |
| TK | Compliant — proper BP token usage. | GOOD |

**Truth repair candidate**: Needs audit (users diagnose failures here)
**UI packet candidate**: None needed

---

### 6. Execution Log — `/logs` — ExecutionLog.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Reads pipeline execution tables — unverified. | UNAUDITED |
| WF | Unaudited. | UNAUDITED |
| UI | Mixed Tailwind + inline styles for status badges. Table headers use `text-muted-foreground` (generic) instead of BP tokens. | MODERATE |
| TK | Wrong font token: `var(--font-mono)` and `var(--font-display)` (missing `bp-` prefix). Hardcoded `#1C1917` in cell styles. | HIGH |

**Truth repair candidate**: Needs audit
**UI packet candidate**: YES — font token fix + hardcoded color

---

### 7. SQL Explorer — `/sql-explorer` — SqlExplorer.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Standalone query tool — low DT risk. | LOW RISK |
| WF | Unaudited. | UNAUDITED |
| UI | Mostly compliant. Badge at line 139 mixes hardcoded `rgba(180,86,36,0.2)` with BP token. | MINOR |
| TK | One badge opacity hardcoded, otherwise compliant. | MINOR |

**Truth repair candidate**: Low priority (standalone tool)
**UI packet candidate**: Minor badge fix

---

### 8. Data Blender — `/blender` — DataBlender.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Standalone join analysis tool — low DT risk. | LOW RISK |
| WF | Unaudited. | UNAUDITED |
| UI | Clean layout. | OK |
| TK | Wrong font token: `var(--font-display)` (missing `bp-` prefix). Hardcoded `#1C1917`. | HIGH |

**Truth repair candidate**: Low priority (standalone tool)
**UI packet candidate**: YES — font token fix

---

### 9. Data Lineage — `/lineage` — DataLineage.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Column-level lineage — unverified. | UNAUDITED |
| WF | Unaudited. | UNAUDITED |
| UI | Hardcoded layer badge colors (`#E2E8F0`, `#475569`). Mixed `rgba` borders. | MODERATE |
| TK | Hardcoded hex in badge backgrounds. Table headers mix tokens with hardcoded rgba. | HIGH |

**Truth repair candidate**: Needs audit
**UI packet candidate**: YES — hardcoded layer colors

---

### 10. Data Catalog — `/catalog` — DataCatalog.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Entity catalog — unverified. | UNAUDITED |
| WF | Unaudited. | UNAUDITED |
| UI | Grid-based layout (no tables). Compliant. | GOOD |
| TK | Compliant — no violations found. | GOOD |

**Truth repair candidate**: Needs audit
**UI packet candidate**: None needed

---

### 11. Data Profiler — `/profile` — DataProfiler.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Column profiling — unverified. | UNAUDITED |
| WF | Unaudited. | UNAUDITED |
| UI | Inconsistent spacing. | MODERATE |
| TK | **30+ hardcoded hex colors** in `TYPE_MAP` and `LAYER_COLORS` constants. Hardcoded `#EDEAE4`, `#FEFDFB`, `#78716C` in inline styles. | CRITICAL |

**Truth repair candidate**: Needs audit
**UI packet candidate**: YES — worst token violator in the codebase

---

### 12–16. Gold Studio — `/gold/*`
**Audit status: PACKETIZED (Clusters, Validation) / PARTIALLY (Ledger, Canonical, Specs)**

| Page | Route | Packets | DT | WF | UI | TK |
|------|-------|---------|----|----|----|----|
| Ledger | `/gold/ledger` | — | Extraction REAL (Packet G) | OK | GOOD | GOOD |
| Clusters | `/gold/clusters` | RP-07 | AUDIT-011: naive name matching → honest labels | OK | GOOD | GOOD |
| Canonical | `/gold/canonical` | — | REAL functionality | OK | GOOD | GOOD |
| Specs | `/gold/specs` | — | REAL functionality | OK | GOOD | GOOD |
| Validation | `/gold/validation` | RP-07 | AUDIT-011: 3 structure checks → honest labels | OK | GOOD | GOOD |

Gold Studio pages are the most design-system-compliant in the codebase (built latest, with BP tokens from the start).

**Truth repair candidate**: None remaining (RP-07 covered honest labels)
**UI packet candidate**: None needed

---

### 17. DQ Scorecard — `/labs/dq-scorecard` — DqScorecard.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Unaudited. | UNAUDITED |
| WF | Unaudited. | UNAUDITED |
| UI | "Coming Soon" placeholder. Redundant className + inline fontFamily. | MINOR |
| TK | Compliant (minimal content). | OK |

---

### 18. Cleansing Rules — `/labs/cleansing` — CleansingRuleEditor.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Unaudited. | UNAUDITED |
| WF | Unaudited. | UNAUDITED |
| UI | "Coming Soon" placeholder. Same redundancy as DQ Scorecard. | MINOR |
| TK | Compliant (minimal content). | OK |

---

### 19. SCD Audit — `/labs/scd-audit` — ScdAudit.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Unaudited. | UNAUDITED |
| WF | Unaudited. | UNAUDITED |
| UI | "Coming Soon" placeholder. Same redundancy. | MINOR |
| TK | Compliant (minimal content). | OK |

---

### 20. Config Manager — `/config` — ConfigManager.tsx
**Audit status: PARTIALLY** | Existing audit: AUDIT-ConfigManager.md

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Pipeline GUID columns blank (missing in SELECT). | OPEN (P2) |
| WF | Cascade modal never triggers (`refData.count` always undefined). Deploy endpoint returns 501. | OPEN (P2, P3) |
| UI | Clean layout. | OK |
| TK | Hardcoded `#fff` white text, hardcoded `#FEFDFB` backgrounds. | MODERATE |

**Truth repair candidate**: YES — blank GUIDs, broken cascade modal
**UI packet candidate**: Minor token fixes

---

### 21. Database Explorer — `/db-explorer` — DatabaseExplorer.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | Raw table browser on control plane DB — low DT risk. | LOW RISK |
| WF | Unaudited. | UNAUDITED |
| UI | Mostly compliant. | GOOD |
| TK | One hardcoded `#fff` white text. Otherwise compliant. | MINOR |

---

### 22. Environment Setup — `/setup` — EnvironmentSetup.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT–TK | Unaudited. Multi-file setup wizard. | UNAUDITED |

---

### 23. Settings — `/settings` — Settings.tsx
**Audit status: NOT YET**

| Bucket | Findings | Status |
|--------|----------|--------|
| DT–TK | Unaudited. Multi-file settings area. | UNAUDITED |

---

### 24. Engine Control — `/engine` — EngineControl.tsx (hidden from nav)
**Audit status: PARTIALLY** | Existing audit: AUDIT-EngineControl.md

| Bucket | Findings | Status |
|--------|----------|--------|
| DT | All capabilities real (start/stop/plan/retry/metrics/logs/SSE). | OK |
| WF | Ghost endpoint `/api/engine/jobs` polled every 15s → always 404 (P2). Type mismatches in `last_run` + `layers` response fields (P2). | OPEN |
| UI | Table headers use `bg-muted` (generic Tailwind) instead of BP tokens. RunSummaryModal uses `shadow-2xl` (BP uses zero shadows). | MODERATE |
| TK | LogLine component: 8 hardcoded hex colors (`#f87171`, `#fbbf24`, `#93c5fd`, `#9ca3af`, `#fca5a5`, `#fde68a`, `#e2e8f0`, `#6b7280`). | CRITICAL |

**Truth repair candidate**: YES — ghost endpoint, type mismatches
**UI packet candidate**: YES — LogLine hex colors, table header tokens

---

### Business Portal Pages (25–29)

| # | Page | Route | DT | WF | UI | TK |
|---|------|-------|----|----|----|-----|
| 25 | Alerts | `/alerts` | UNAUDITED (reads engine_task_log) | UNAUDITED | OK | Select missing fontFamily (line 505) |
| 26 | Sources | `/sources-portal` | RP-03 (entity_status removed) | UNAUDITED | OK | OK |
| 27 | Catalog | `/catalog-portal` | RP-03 (entity_status removed) | UNAUDITED | OK | OK |
| 28 | Requests | `/requests` | UNAUDITED | UNAUDITED | OK | OK |
| 29 | Help | `/help` | N/A | N/A | OK | OK |

---

## Coverage Summary

| Category | Count | Packetized | Partially | Not Yet |
|----------|-------|-----------|-----------|---------|
| **Nav-visible (engineering)** | 23 | 4 | 5 | 14 |
| **Nav-visible (portal)** | 6 | 1 | 2 | 3 |
| **Hidden routes** | 24 | 0 | 1 | 23 |
| **Total** | 53 | **5 (9%)** | **8 (15%)** | **40 (75%)** |

---

## Candidate Packet List

### Truth Repair Candidates (RP-NN)

| Priority | Page | Issue | Severity | Existing Audit |
|----------|------|-------|----------|----------------|
| **1** | Load Center | "Load Everything" + "Preview Run" crash (`_build_source_lookup` undefined) | P1 | AUDIT-LoadCenter.md |
| **2** | Source Manager | Missing `/api/gateway-connections` endpoint + analyze-source shape mismatch + stubbed imports | P1/P2 | AUDIT-SourceManager.md |
| **3** | Engine Control | Ghost endpoint `/api/engine/jobs` (404 noise) + type mismatches | P2 | AUDIT-EngineControl.md |
| **4** | Config Manager | Blank pipeline GUIDs + broken cascade modal | P2 | AUDIT-ConfigManager.md |
| **5** | Overview | Activity panel status enum mismatch | P2 | (in AUDIT-BusinessOverview.md) |
| **6** | Error Intelligence | Unaudited — users diagnose failures here | — | None |
| **7** | Business Alerts | Unaudited — reads engine_task_log, same enum bug class as Overview | — | None |
| **8** | Execution Log | Unaudited — pipeline execution history | — | None |

### UI Packet Candidates (UP-NN)

| Priority | Scope | Issue | Severity | Pages |
|----------|-------|-------|----------|-------|
| **1** | Font token fix | `var(--font-display)` → `var(--bp-font-display)` everywhere | CRITICAL | ExecutionMatrix, ExecutionLog, DataBlender, DataProfiler |
| **2** | DataProfiler hex purge | 30+ hardcoded colors in TYPE_MAP / LAYER_COLORS | CRITICAL | DataProfiler |
| **3** | ExecutionMatrix hex purge | 7+ hardcoded hex in chart tick/tooltip/bar colors | CRITICAL | ExecutionMatrix |
| **4** | EngineControl LogLine | 8 hardcoded hex for log level colors | CRITICAL | EngineControl |
| **5** | DataLineage layer badges | Hardcoded `#E2E8F0`, `#475569` in badge backgrounds | HIGH | DataLineage |
| **6** | Table header standardization | Some use `bg-muted` (generic), some `var(--bp-surface-1)` (correct) | MODERATE | EngineControl, ExecutionLog |
| **7** | Minor token fixes | Scattered `#fff`, `#FEFDFB` hardcodes | LOW | ConfigManager, DatabaseExplorer, DataBlender |

### Mixed Candidates (truth + UI in same page, but keep packets separate)
- **Engine Control**: truth packet for ghost endpoint/type mismatches + separate UI packet for LogLine hex
- **Execution Log**: truth audit first, then UI packet for font tokens

---

## Existing Truth Docs Index

### Foundation (4)
- `FMD_DATA_BIBLE.md` — data flow and storage layers
- `FMD_DATA_REGISTRY.yaml` — page → endpoint → table map
- `FMD_METRIC_DEFINITIONS.md` — KPI formulas
- `FMD_PIPELINE_TRUTH_AUDIT.md` — 14 AUDIT entries

### Decisions (12)
D-001 through D-012 in `FMD_DECISIONS_LOG.md`

### Repair Packets (9)
RP-01 through RP-07 (including RP-06B, RP-06C)

### Page Audit Docs (5)
`AUDIT-BusinessOverview.md`, `AUDIT-LoadCenter.md`, `AUDIT-EngineControl.md`, `AUDIT-ConfigManager.md`, `AUDIT-SourceManager.md` — all in `docs/superpowers/audits/`
