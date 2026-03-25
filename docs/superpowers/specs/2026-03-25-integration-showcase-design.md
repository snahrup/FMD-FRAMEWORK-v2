# Integration Showcase — Performance & Governance Visualization

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Enhance existing pages (Load Mission Control, Data Estate) to showcase pipeline tooling integrations — no new pages.

---

## Context

Five integration packets were added to the FMD pipeline:

| Packet | What | Status |
|--------|------|--------|
| A — ConnectorX | Rust-native SQL extraction via ConnectorX → Polars → Snappy Parquet | Fully wired, default extraction path |
| B — Pandera | Schema-as-code validation between extract and upload | Engine validates but never POSTs results to dashboard |
| C — Classification | Column-level PII/sensitivity scanning with pattern + Presidio | Fully wired end-to-end |
| D — Purview | Microsoft Purview sync scaffolding | Routes exist, actual API calls deferred until account configured |
| E — Data Estate | Executive overview visualization | Fully wired after 5 backend fixes |

The integrations work but aren't visible. Users can't see that extraction is 5-13x faster, can't see schema validation results, and can't see the full governance posture. This spec adds elegant, non-intrusive enhancements to existing pages.

## Audience

Primary: Steve + technical team for validation. Secondary: exec demos. The comparison section is temporary — confirm the speedup, then optionally remove it.

---

## Part 1: Data Layer — Extraction Method Tracking

### 1.1 RunResult Enhancement

**File:** `engine/models.py`

Add field to the `RunResult` dataclass:

```python
extraction_method: str = "unknown"  # "connectorx" | "pyodbc" | "unknown"
```

### 1.2 Extractor Tagging

**File:** `engine/extractor.py`

- `_extract_connectorx()` sets `extraction_method="connectorx"` on its returned RunResult
- The pyodbc fallback path sets `extraction_method="pyodbc"` on its returned RunResult

### 1.3 Database Schema

**File:** `dashboard/app/api/control_plane_db.py`

Add column to `engine_task_log`:

```sql
ALTER TABLE engine_task_log ADD COLUMN ExtractionMethod TEXT DEFAULT 'unknown';
```

Use SQLite's `ALTER TABLE ADD COLUMN` with default — no migration needed. Old rows get `"unknown"`, new runs get the real value.

### 1.4 Log Writer

**File:** `dashboard/app/api/control_plane_db.py` (insert function for engine_task_log)

Include `ExtractionMethod` in the INSERT statement, sourced from the RunResult.

### 1.5 Packet B Callback — Wire Validation Results

**File:** `engine/orchestrator.py` (after line ~1363 where `v_result` is computed)

After schema validation runs, POST the result to the dashboard:

```python
def _log_validation(self, run_id: str, entity_id: int, v_result) -> None:
    """POST validation result to control plane."""
    import json, urllib.request
    data = json.dumps({
        "run_id": run_id,
        "entity_id": entity_id,
        "layer": "landing",
        "passed": v_result.passed,
        "error_count": v_result.error_count,
        "errors": v_result.errors[:20],  # cap at 20 errors
        "schema_name": v_result.schema_name,
    })
    try:
        req = urllib.request.Request(
            f"http://localhost:8787/api/schema-validation/result",
            data=data.encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception as exc:
        log.debug("Failed to POST validation result: %s", exc)
```

Call `_log_validation()` immediately after `v_result` is assigned — for **both passed and failed** validations. This gives the dashboard full visibility into validation health. In `enforce` mode, where validation failure causes an early return (line ~1365), call `_log_validation()` before the return. Failure to POST is non-blocking (debug log only).

---

## Part 2: API Enhancements

### 2.1 Extend `/api/lmc/run/{run_id}`

**File:** `dashboard/app/api/routes/load_mission_control.py`

Add `ExtractionMethod` to the per-entity result rows. No new endpoint — just include it in the existing SELECT.

### 2.2 New Endpoint: `/api/lmc/compare`

**File:** `dashboard/app/api/routes/load_mission_control.py`

```
GET /api/lmc/compare?run_a={run_id}&run_b={run_id}
```

**Response:**

```json
{
  "run_a": {
    "run_id": "abc",
    "total_duration": 872.5,
    "total_rows": 245000,
    "rows_per_sec": 1200.3,
    "bytes_per_sec": 2048000,
    "extraction_method": "pyodbc",
    "entity_count": 349
  },
  "run_b": {
    "run_id": "def",
    "total_duration": 138.2,
    "total_rows": 245000,
    "rows_per_sec": 8400.7,
    "bytes_per_sec": 14500000,
    "extraction_method": "connectorx",
    "entity_count": 349
  },
  "speedup": 6.3,
  "matched_entities": [
    {
      "entity_id": 42,
      "source_name": "MITMAS",
      "rows": 125000,
      "run_a_duration": 45.2,
      "run_b_duration": 6.8,
      "speedup": 6.6
    }
  ]
}
```

**Query logic:**
- INNER JOIN `engine_task_log` for both run IDs on `EntityId + Layer = 'landing'` — only entities present in **both** runs are included (unmatched entities are excluded)
- Guard against divide-by-zero: `speedup = COALESCE(run_a_duration / NULLIF(run_b_duration, 0), 0)`
- Aggregate throughput: `SUM(RowsRead) / NULLIF(SUM(DurationSeconds), 0)` per run
- If fewer than 2 completed runs exist, return `{"error": "Need at least 2 completed runs to compare"}`

---

## Part 3: Load Mission Control UI Enhancements

### 3.1 Extraction Method Badges

In the entity results table, add a small pill badge per row:
- `CX` — copper accent (`--bp-copper`) background, white text — ConnectorX
- `ODBC` — muted gray (`--bp-surface-2`) background — pyodbc
- Placed next to the duration column

### 3.2 Pipeline Stack on Entity Drill-in

When expanding an entity detail row, show a horizontal flow of the actual tech stack used:

**ConnectorX path:**
`ConnectorX → Polars → Snappy Parquet → OneLake`

**pyodbc path:**
`pyodbc → pandas → PyArrow Parquet → OneLake`

Each step is a subtle chip/badge. Informational only — shows the tech lineage for that extraction.

### 3.3 Throughput Sparkline

Add to the existing run summary card (top of LMC):
- Small sparkline (Recharts `<Sparkline>` or `<AreaChart>` with no axes) showing rows/sec per entity in extraction order
- Shows throughput consistency vs. spikes across the run
- Muted color, fits within existing card height

### 3.4 Performance Comparison Section

New collapsible section at top of LMC, **collapsed by default**. Header: "Extraction Performance".

**Run Picker:**
- Two dropdowns: "Run A" and "Run B"
- Populate from last 20 completed runs (Status = 'completed') via existing `/api/lmc/runs` endpoint
- Show run date + extraction method + entity count in dropdown labels (e.g., "Mar 25 14:32 · CX · 349 entities")
- If fewer than 2 completed runs exist, show empty state: "Run at least 2 loads to compare performance"

**Summary Cards (side-by-side, 4 cards):**

| Card | Run A | Run B |
|------|-------|-------|
| Total Duration | `14m 32s` | `2m 18s` |
| Throughput | `1,200 rows/s` | `8,400 rows/s` |
| Data Volume | `1.2 GB` | `1.2 GB` |
| **Speedup** | — | `6.3×` (large, copper accent, AnimatedCounter) |

The speedup card is visually dominant — larger font, copper color, animated on load.

**Entity Scatter Plot (below cards):**
- Recharts `<ScatterChart>`
- Each dot = one entity present in both runs
- X axis = Run A duration (seconds)
- Y axis = Run B duration (seconds)
- Diagonal reference line = "same speed" (y = x)
- Dots below diagonal = ConnectorX was faster (the expected case)
- Dot size = row count (bigger tables are bigger dots)
- Dot color: copper (`--bp-copper`) if faster, muted gray if same/slower
- Hover tooltip: entity name, source, row count, both durations, speedup factor
- Responsive: scales down gracefully on narrow viewports

---

## Part 4: Data Estate Governance Panel Enhancements

### 4.1 Schema Validation — Wire to Real Data

**Current:** Shows zeros (Packet B callback not wired).
**After Packet B callback (Part 1.5):** Shows real pass/fail counts.

Enhance the existing schema validation section in GovernancePanel:
- **Pass/fail bar** — small horizontal proportional bar (green = passed, red = failed)
- **Entity coverage** — "42 of 1,385 entities have schemas" with a subtle progress track
- **Click-through** — clicking the section navigates to `/schema-validation`

### 4.2 Classification Section — Richer Detail

Enhance the existing classification section:
- **Sensitivity breakdown** — tiny stacked horizontal bar showing proportions: public (gray), internal (blue), confidential (amber), restricted (orange), PII (red)
- **Last scan timestamp** — "Scanned 2h ago" in muted text (`--bp-ink-3`)
- **Rescan button** — small icon button (RefreshCw icon) that calls `POST /api/classification/scan` (endpoint exists at `dashboard/app/api/routes/classification.py` line 168)

### 4.3 Purview Section — Status Journey

Enhance the existing Purview section:
- **Mapping count** — "18 type mappings active"
- **Last sync** — timestamp + direction badge (Push/Pull)
- **Status progression** — Three-step indicator: Pending → Ready → Synced. Maps directly to `purview.status` values (`"pending"`, `"ready"`, `"synced"`). Current step highlighted, future steps muted. Shows where you are on the governance journey.

### 4.4 Governance Score — Real Composite Calculation

**File:** `dashboard/app/src/components/estate/GovernanceScore.tsx`

Wire the score ring to a real weighted composite:

| Component | Weight | Source | Score Logic |
|-----------|--------|--------|-------------|
| Classification coverage | 40% | `classification.coveragePct` | Direct percentage |
| Schema validation pass rate | 40% | `schemaValidation.passed / schemaValidation.total` | Pass rate as percentage (0 if no validations yet) |
| Purview sync status | 20% | `purview.status` | `"synced"` = 100, `"ready"` = 50, `"pending"` = 0 |

Formula: `score = (classification * 0.4) + (validation * 0.4) + (purview * 0.2)`

Rationale: Purview is scaffolded only (no real account configured), so its weight is lower. Classification and validation are the two active governance levers. Matches the existing GovernanceScore.tsx weighting.

This gives a real number that improves as integrations are adopted. The ring color transitions from red (<40) → amber (40-70) → green (>70).

---

## Part 5: Design System Compliance

All UI enhancements follow the existing BP design system:

- **Tokens:** `--bp-ink`, `--bp-surface`, `--bp-copper`, `--bp-border`, `--bp-canvas`
- **Depth:** Borders-only (no shadows), consistent with existing cards
- **Typography:** `--font-family` cascade (Manrope default), `--bp-font-display` for headings
- **Spacing:** 4px grid
- **Motion:** Framer Motion spring transitions, AnimatedCounter for numbers
- **Status Rail:** 3px left-edge color bar on cards where applicable

Implementation must invoke `/modernize` and `/interface-design` skills for UI components.

---

## Files Modified

| File | Changes |
|------|---------|
| `engine/models.py` | Add `extraction_method` to RunResult |
| `engine/extractor.py` | Set extraction_method in both code paths |
| `engine/orchestrator.py` | Add `_log_validation()` callback after schema validation |
| `dashboard/app/api/control_plane_db.py` | Add ExtractionMethod column, include in INSERT |
| `dashboard/app/api/routes/load_mission_control.py` | Add ExtractionMethod to run results, new `/api/lmc/compare` endpoint |
| `dashboard/app/src/pages/LoadMissionControl.tsx` | Extraction badges, pipeline stack, sparkline, comparison section |
| `dashboard/app/src/components/estate/GovernancePanel.tsx` | Richer classification/validation/purview sections |
| `dashboard/app/src/components/estate/GovernanceScore.tsx` | Real composite score calculation |

## Temporary Elements

The Performance Comparison section (Part 3.4) is explicitly temporary — built to validate the ConnectorX speedup claim. Once confirmed, it can be collapsed further or removed. The extraction method badges and pipeline stack (Parts 3.1-3.2) are permanent.

## Success Criteria

1. Running a load with `use_connectorx=true` tags every entity result as `"connectorx"`
2. Running a load with `use_connectorx=false` tags every entity result as `"pyodbc"`
3. The comparison section shows a measurable speedup when comparing the two runs
4. Schema validation results appear in the Data Estate governance panel after a load
5. Governance score reflects real integration adoption state
6. All UI renders at 60fps, follows BP design system tokens
