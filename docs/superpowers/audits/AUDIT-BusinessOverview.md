# Page Truth Audit: BusinessOverview

**Date:** 2026-03-19
**Auditor:** bright-falcon
**Route:** `/overview`
**Health:** 🟡 Fragile

---

## 1. Purpose

> Default landing page for the Business Portal — at-a-glance data freshness, alerts, source health, and recent activity.

**Primary user jobs:**
1. How fresh is my data? — percentage of entities that have been loaded
2. Are there problems? — open alerts count + recent error events
3. Are my sources healthy? — per-source operational/degraded/offline status
4. What happened recently? — recent successful load events

---

## 2. File Map

| Role | File | Lines |
|------|------|-------|
| Page component | `dashboard/app/src/pages/BusinessOverview.tsx` | 583 |
| API route | `dashboard/app/api/routes/overview.py` | 338 |
| Shared components | `dashboard/app/src/components/business/*.tsx` | 7 files |
| Quality engine | `dashboard/app/api/services/quality_engine.py` | Populates `quality_scores` |

---

## 3. Backend Dependencies

| Endpoint | Method | Data Source | Status |
|----------|--------|-------------|--------|
| `/api/overview/kpis` | GET | SQLite: `lz_entities`, `entity_status`, `datasources`, `quality_scores` | ✅ Real but `quality_scores` likely empty |
| `/api/overview/sources` | GET | SQLite: `datasources`, `lz_entities`, `entity_status` | ✅ Real |
| `/api/overview/activity` | GET | SQLite: `entity_status`, `lz_entities`, `datasources` | ⚠️ **Status enum mismatch** |
| `/api/overview/entities` | GET | SQLite | ✅ Real but **not called by this page** |

---

## 4. Data Contracts

### Activity `status` values — CRITICAL MISMATCH
**Frontend filters for:** `"success"`, `"error"`, `"warning"`, `"running"`
**Backend returns:** `"loaded"`, `"not_started"`, `""` (raw `entity_status.Status` values)

`"loaded" !== "success"` → Recent Activity panel always empty
`"loaded" !== "error"` → Alerts panel always empty

### `open_alerts` — semantic mismatch
Backend computes from `quality_scores WHERE quality_tier IN ('bronze', 'unclassified')`. Quality engine must run manually. If never run → always 0 → "All clear" even when failures exist.

### `quality_avg` — dead field
Backend returns it, frontend type declares it, nobody renders it.

### "Freshness" — semantic gap
Backend: "has been loaded at least once ever." Frontend label: "X of Y tables on schedule." No schedule concept exists.

---

## 5. State Matrix

| State | Trigger | Handled? | What renders |
|-------|---------|----------|-------------|
| Loading | Initial fetch | ✅ | Skeleton grid (4 cards + rows) |
| Error | Any fetch fails | ✅ | Red banner — but **`Promise.all` means any single failure blanks everything** |
| Empty | No data | ✅ | "--" values with "No load data yet" |
| Success | Data loaded | ✅ | KPIs + panels |
| Partial | One endpoint fails | ❌ | **Not handled — all-or-nothing via Promise.all** |
| Stale | Auto-refresh 30s | ✅ | "Last refreshed: Xm ago" |

---

## 6. Real vs Stubbed Behavior

| Feature | Classification | Evidence |
|---------|---------------|----------|
| KPI: Data Freshness | 🟡 Real but misleading | "Freshness" means "ever loaded," not "recently loaded" |
| KPI: Open Alerts | 🟡 Real but likely always 0 | Depends on quality engine running |
| KPI: Sources Online | 🟢 Real | Counts from `datasources.IsActive` |
| KPI: Total Tables | 🟢 Real | Count of active `lz_entities` |
| **Recent Alerts panel** | 🔴 **Effectively broken** | Filters for `status === "error"` but backend returns `"loaded"` — always empty |
| **Recent Activity panel** | 🔴 **Effectively broken** | Filters for `status === "success"` but backend returns `"loaded"` — always empty |
| Source Health list | 🟢 Real | Correct status derivation |
| Auto-refresh (30s) | 🟢 Real | `setInterval` |
| `quality_avg` KPI | ⚫ Dead code | Fetched, stored, never rendered |

### Misleading UI

1. **"Data Freshness 87%"** — Implies data is current. Actually means "87% of entities loaded at least once ever."
2. **"X of Y tables on schedule"** — No schedule exists. Should say "loaded at least once."
3. **"Open Alerts: 0 — All clear"** — Quality engine hasn't run; alerts are impossible, not absent.
4. **"No active alerts — all systems normal"** — Status filter prevents any alerts from appearing regardless.
5. **"No recent activity"** — Activity exists but `"loaded" !== "success"` filters it out.

---

## 7. Mutation Flows

None — purely read-only page.

---

## 8. Root-Cause Bug Clusters

### Cluster A: Status enum mismatch (HIGH)
Backend returns raw DB values (`loaded`, `not_started`), frontend expects REST-style values (`success`, `error`, `warning`).
- **Impact:** Both Alerts and Recent Activity panels permanently empty
- **Fix:** Map values in backend response OR change frontend filters

### Cluster B: quality_scores dependency (MEDIUM)
`open_alerts` and `quality_avg` depend on a quality engine that runs manually.
- **Impact:** Alerts always 0, quality data missing
- **Fix:** Derive alerts from `entity_status` errors instead

### Cluster C: Freshness semantic gap (LOW)
"Freshness" = "ever loaded" but presented as "on schedule."
- **Fix:** Compare `LoadEndDateTime` against 24h threshold

### Cluster D: Error resilience (LOW)
`Promise.all` means any endpoint failure blanks the whole page.
- **Fix:** Use `Promise.allSettled` + partial rendering

---

## 9. Minimal Repair Order

| Priority | Fix | Cluster | Effort | Impact |
|----------|-----|---------|--------|--------|
| 1 | Map status values: `loaded`→`success`, `error`→`error` | A | S | **Critical — unblocks both main panels** |
| 2 | Redefine `open_alerts` from `entity_status` errors | B | S | High — alerts KPI becomes real |
| 3 | Add time-based freshness (24h threshold) | C | S | Medium — truthful KPI |
| 4 | `Promise.allSettled` for partial failure resilience | D | S | Medium — page survives hiccups |
| 5 | Render or remove `quality_avg` | B | S | Low — eliminate dead code |
| 6 | Fix "on schedule" wording | C | S | Low — accuracy |

---

## 10. Proposed Packet Sequence

### Packet A: Truth & Alignment
- [ ] Map `entity_status.Status` to frontend enum in `/api/overview/activity`
- [ ] Redefine `open_alerts` to count from `entity_status WHERE Status = 'error'`
- [ ] Implement time-based freshness threshold (24h default)
- [ ] Fix "on schedule" label → "loaded at least once"

### Packet B: Page Shell
- [ ] `Promise.allSettled` + partial rendering (preserve good data on partial failure)
- [ ] Preserve last-known-good data on refresh failure
- [ ] Render `quality_avg` as KPI card or remove entirely

### Packet C: Core Workflows
- N/A (read-only page)

### Packet D: Hardening & Polish
- [ ] Add "Data Quality" KPI using `quality_avg` (requires quality engine cron)
- [ ] Add time-since-last-load per source in Source Health
- [ ] Count badge on "View all alerts" link

---

## 11. Verification Checklist

- [ ] Recent Alerts panel shows actual errors when they exist
- [ ] Recent Activity panel shows actual successful loads
- [ ] Freshness KPI reflects time-based freshness, not "ever loaded"
- [ ] Open Alerts reflects real operational failures
- [ ] Page renders partial data when one endpoint fails
- [ ] No misleading "all clear" messages when data is unavailable
