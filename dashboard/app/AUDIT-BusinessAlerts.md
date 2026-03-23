# AUDIT — Business Alerts Page

**Date**: 2026-03-23
**Files audited**:
- `dashboard/app/src/pages/business/BusinessAlerts.tsx`
- `dashboard/app/api/routes/alerts.py`

**Endpoint**: `GET /api/alerts`

---

## Issue 1 — "pending" type invisible on frontend [FIXED]

**Severity**: High
**Location**: `BusinessAlerts.tsx` lines 20-39, `alerts.py` line 186

Backend emits `type: "pending"` for never-loaded entities (Section 2 of alerts.py, ~line 186). Frontend `Alert` interface only declared `type: "failure" | "freshness" | "connection"` — no `"pending"` variant. `TYPE_LABELS` had no `"pending"` entry. Pending alerts rendered with `undefined` as the type label text.

**Fix applied**: Added `"pending"` to the `Alert.type` union and `AlertType`. Added `pending: "Never Loaded"` to `TYPE_LABELS`. Added a "Never Loaded" filter chip.

---

## Issue 2 — "failure" type declared but never produced [FIXED]

**Severity**: Medium
**Location**: `BusinessAlerts.tsx` lines 22, 33, 36; `alerts.py` (no failure query exists)

Frontend declared `type: "failure"` with label "Failed Refresh" and a "Failures" filter chip. Backend never emits a failure-type alert — there is no query in `alerts.py` for recently-failed entities. The filter chip was dead UI that could never match any data.

**Fix applied**: Removed `"failure"` from the `Alert.type` union, `AlertType`, and `TYPE_LABELS`. Removed the "Failures" filter chip. A backend failure-alert query can be added later as a separate feature; when it is, re-add `"failure"` to the frontend types.

---

## Issue 3 — Connection alert has empty entities array [NOT FIXED]

**Severity**: Low
**Location**: `alerts.py` line 252

Connection alerts always set `"entities": []`. The `AlertCard` component silently skips the entity chips section when the array is empty (line 214: `alert.entities.length > 0`), so the card renders correctly but provides no entity-level detail.

**Root cause**: The offline query (Section 3 of alerts.py) groups by datasource and does not `GROUP_CONCAT` individual entity names. Adding entity names would require joining `lz_entities` rows with a `GROUP_CONCAT` similar to the freshness and pending queries.

**Recommendation**: Low priority. Add `GROUP_CONCAT` of entity names to the offline query and populate the first 5 entities in a future pass.

---

## Issue 4 — Freshness hours hardwired to 24 [NOT FIXED]

**Severity**: Low
**Location**: `alerts.py` line 59, `BusinessAlerts.tsx` line 284

Backend accepts `freshness_hours` query parameter (defaults to 24). Frontend never passes this parameter — `fetch(\`${API}/api/alerts\`)` uses no query string. The 24-hour SLA is effectively hardcoded.

**Recommendation**: Add a dropdown or numeric input to the filter bar allowing users to select freshness threshold (e.g., 12h / 24h / 48h / 72h). Pass as `?freshness_hours=N`.

---

## Issue 5 — firstSeen semantics misleading [NOT FIXED]

**Severity**: Low
**Location**: `alerts.py` line 89

`firstSeen` for freshness alerts is computed as `MIN(ls.created_at)` — the earliest `created_at` timestamp of any stale entity's last successful load in the group. This represents when the oldest successful load happened, not when the staleness condition was first detected.

The frontend displays this as a relative time label (e.g., "3d ago") next to "X entities affected", which could mislead users into thinking the alert has been active for that duration.

**Recommendation**: Either rename the field to `oldestLoad` / `lastSuccessfulLoad` for clarity, or compute actual alert-onset time (when the entity first crossed the SLA threshold). The latter requires tracking alert state across refreshes, which is out of scope for this page's stateless computation model.

---

## Issue 6 — Pending/connection alert overlap [NOT FIXED]

**Severity**: Medium
**Location**: `alerts.py` Sections 2 and 3

Sources with zero successful loads trigger both:
1. A **pending** alert (Section 2: active entities with no successful load record)
2. A **connection** alert (Section 3: `loaded_count = 0` in the `HAVING` clause)

This means every never-loaded source generates two alerts — one saying "N tables awaiting initial load" and another saying "source offline". The connection alert's `loaded_count = 0` condition overlaps with the pending alert's logic. For a source that is actually active but simply hasn't been run yet, the "source offline" label is misleading.

**Recommendation**: Refine the connection alert query to only fire when `ds.IsActive = 0` (truly deactivated), and remove the `loaded_count = 0` condition. Alternatively, deduplicate by suppressing the connection alert when a pending alert already exists for the same source.

---

## Files changed in this audit

| File | Change |
|------|--------|
| `dashboard/app/src/pages/business/BusinessAlerts.tsx` | Removed `"failure"` type, added `"pending"` type + filter chip |
| `dashboard/app/AUDIT-BusinessAlerts.md` | This document (new) |

## Compile status

`npx tsc --noEmit` — PASS (no errors)

## Residual risks

1. **Connection/pending overlap** (Issue 6) will produce noisy duplicate alerts for any source that hasn't been loaded yet. Not a crash risk but a UX noise issue.
2. **No failure alerts at all** — removing the "failure" type means the page has no way to surface recently-failed entities. This should be built as a separate feature ticket.
3. **firstSeen mislabeling** (Issue 5) may confuse operators who interpret it as alert duration rather than last-load age.
