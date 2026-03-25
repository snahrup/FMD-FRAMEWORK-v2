# Integration Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance Load Mission Control and Data Estate pages to showcase ConnectorX performance, schema validation results, and governance posture — no new pages.

**Architecture:** Add `extraction_method` tracking to the engine → DB → API → UI chain. Wire the missing Packet B validation callback. Enhance LMC with comparison section and extraction badges. Enrich Data Estate governance panel with real data and composite scoring.

**Tech Stack:** Python (engine), SQLite, React 19, TypeScript, Tailwind CSS 4, Recharts, Framer Motion, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-25-integration-showcase-design.md`

**MANDATORY SKILLS FOR ALL UI TASKS (Tasks 7-12):**
- Invoke `/interface-design` skill BEFORE writing any UI component code. Read `.interface-design/system.md` and apply its tokens, spacing, depth strategy, and patterns.
- Invoke `/modernize` skill BEFORE writing any UI component code. Apply premium UX treatment (motion, states, responsive).
- These are NOT optional. Every UI task must invoke both skills before any code is written. The implementing agent must call `Skill("interface-design")` and `Skill("modernize")` at the start of each UI task.
- **MINIMIZE INLINE STYLES.** The code examples in this plan use inline styles for clarity, but the implementing agent MUST use existing design tokens, CSS classes (`.bp-*`), and reusable components from the design system. Only use inline styles for truly one-off values. If a style pattern repeats, extract it to a component or CSS class. The `/interface-design` and `/modernize` skills will guide this.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `engine/models.py` | Modify (line 174-193) | Add `extraction_method` field to RunResult |
| `engine/extractor.py` | Modify (lines 217-227, 331-338, 236-243, etc.) | Tag extraction method on all RunResult returns |
| `engine/orchestrator.py` | Modify (lines 1352-1377) | Add `_log_validation()` callback |
| `dashboard/app/api/control_plane_db.py` | Modify (lines 163-189, 1391-1418) | Add ExtractionMethod column + update INSERT |
| `dashboard/app/api/routes/load_mission_control.py` | Modify (lines 368-464) + new endpoint | Add ExtractionMethod to run detail, new `/api/lmc/compare` |
| `dashboard/app/src/pages/LoadMissionControl.tsx` | Modify (lines 1686-1753, 2231-2264) | Extraction badges, sparkline, comparison section |
| `dashboard/app/src/components/estate/GovernancePanel.tsx` | Modify (lines 58-140) | Richer classification/validation/purview sections |
| `dashboard/app/src/components/estate/GovernanceScore.tsx` | Modify (line 23) | Wire real composite score (already 40/40/20) |

---

## Task 1: Add `extraction_method` to RunResult

**Files:**
- Modify: `engine/models.py:174-193`

- [ ] **Step 1: Add the field**

In `engine/models.py`, add `extraction_method` to the RunResult dataclass after `watermark_after`:

```python
watermark_after: Optional[str] = None
extraction_method: str = "unknown"        # "connectorx" | "pyodbc" | "unknown"
```

- [ ] **Step 2: Verify no import/syntax errors**

Run: `python -c "from engine.models import RunResult; r = RunResult(entity_id=1, layer='landing', status='succeeded'); print(r.extraction_method)"`
Expected: `unknown`

- [ ] **Step 3: Commit**

```bash
git add engine/models.py
git commit -m "feat(engine): add extraction_method field to RunResult"
```

---

## Task 2: Tag extraction method in extractor

**Files:**
- Modify: `engine/extractor.py` (multiple return sites)

The extractor has two code paths and multiple return statements. Every RunResult must get tagged.

- [ ] **Step 1: Tag ConnectorX success path (line ~331)**

In `_extract_connectorx()`, the success RunResult around line 331. Add `extraction_method="connectorx"`:

```python
return parquet_bytes, RunResult(
    entity_id=entity.id, layer="landing", status="succeeded",
    rows_read=rows_read, rows_written=rows_read,
    bytes_transferred=len(parquet_bytes),
    duration_seconds=round(elapsed, 2),
    watermark_before=entity.last_load_value,
    watermark_after=new_watermark,
    extraction_method="connectorx",
)
```

- [ ] **Step 2: Tag ConnectorX error path (line ~287)**

In `_extract_connectorx()`, the error RunResult around line 287. Add `extraction_method="connectorx"`:

```python
return None, RunResult(
    entity_id=entity.id, layer="landing", status="failed",
    rows_read=0, rows_written=0, bytes_transferred=0,
    duration_seconds=round(elapsed, 2), error=error_msg,
    error_suggestion=self._diagnose_error(error_msg, entity),
    extraction_method="connectorx",
)
```

- [ ] **Step 3: Tag ConnectorX zero-rows path (line ~305)**

The zero-row return in `_extract_connectorx()`. Add `extraction_method="connectorx"`.

- [ ] **Step 4: Tag pyodbc success path (line ~217)**

The pyodbc success RunResult. Add `extraction_method="pyodbc"`:

```python
return parquet_bytes, RunResult(
    entity_id=entity.id, layer="landing", status="succeeded",
    rows_read=rows_read, rows_written=rows_read,
    bytes_transferred=len(parquet_bytes),
    duration_seconds=round(elapsed, 2),
    watermark_before=entity.last_load_value,
    watermark_after=new_watermark,
    extraction_method="pyodbc",
)
```

- [ ] **Step 5: Tag pyodbc error path (line ~236)**

Add `extraction_method="pyodbc"` to the pyodbc error RunResult.

- [ ] **Step 6: Tag pyodbc zero-rows path (line ~180)**

Add `extraction_method="pyodbc"` to the zero-rows RunResult in the pyodbc path.

- [ ] **Step 7: Tag all early-exit error returns**

The extract method has early returns for empty SourceName (~line 82), no columns (~line 116), and general exceptions (~line 251). These fire before choosing a method, so tag them `extraction_method="unknown"` (the default — no change needed, but verify they inherit the default).

- [ ] **Step 8: Verify**

Run: `python -c "from engine.extractor import DataExtractor; print('import ok')"`
Expected: `import ok`

- [ ] **Step 9: Commit**

```bash
git add engine/extractor.py
git commit -m "feat(engine): tag extraction_method on all RunResult returns"
```

---

## Task 3: Add ExtractionMethod column to engine_task_log

**Files:**
- Modify: `dashboard/app/api/control_plane_db.py` (lines 163-189, 1391-1418)

- [ ] **Step 1: Add column to CREATE TABLE (line ~188)**

In the `engine_task_log` CREATE TABLE statement, add before `created_at`:

```sql
ExtractionMethod    TEXT DEFAULT 'unknown',
created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
```

- [ ] **Step 2: Add ALTER TABLE for existing databases**

In the `_ensure_tables()` function, after the CREATE TABLE block, add a safe ALTER:

```python
# Migration: add ExtractionMethod if missing
try:
    conn.execute("SELECT ExtractionMethod FROM engine_task_log LIMIT 1")
except Exception:
    conn.execute("ALTER TABLE engine_task_log ADD COLUMN ExtractionMethod TEXT DEFAULT 'unknown'")
```

- [ ] **Step 3: Update INSERT function (line ~1391)**

In `insert_engine_task_log()`, add `ExtractionMethod` to both the column list and the VALUES placeholders. Add the parameter to the function signature with default `"unknown"`.

Find the current INSERT columns list (line ~1396-1401) and add `ExtractionMethod` after `LogData`:

```python
def insert_engine_task_log(conn, *, run_id, entity_id, layer, status,
                           source_server="", source_database="", source_table="",
                           source_query="", rows_read=0, rows_written=0,
                           bytes_transferred=0, duration_seconds=0,
                           target_lakehouse="", target_path="",
                           watermark_column="", watermark_before="",
                           watermark_after="", load_type="",
                           error_type="", error_message="",
                           error_stack_trace="", error_suggestion="",
                           log_data="", extraction_method="unknown"):
```

Add `ExtractionMethod` to the INSERT SQL column list and `extraction_method` to the values tuple.

- [ ] **Step 4: Verify**

Run: `python -c "import dashboard.app.api.control_plane_db as cpdb; cpdb._ensure_tables(); print('schema ok')"`
Expected: `schema ok`

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/control_plane_db.py
git commit -m "feat(db): add ExtractionMethod column to engine_task_log"
```

---

## Task 4: Wire Packet B validation callback

**Files:**
- Modify: `engine/orchestrator.py` (lines 1352-1377)

- [ ] **Step 1: Add `_log_validation()` method to the orchestrator class**

Add this method to the orchestrator class (before the `_process_entity` method or in the helpers section):

**IMPORTANT: URL must be config-driven, not hardcoded. Timeout must be short (1s max).**

First, add `control_plane_url` to `EngineConfig` in `engine/models.py` (with the existing fields):

```python
control_plane_url: str = "http://localhost:8787"  # Dashboard control plane base URL
```

And wire it from config in `engine/config.py`:

```python
control_plane_url=engine_section.get("control_plane_url", "http://localhost:8787"),
```

Then add the callback method:

```python
def _log_validation(self, run_id: str, entity_id: int, v_result) -> None:
    """POST schema validation result to control plane dashboard."""
    import json
    import urllib.request
    base_url = getattr(self._config, "control_plane_url", "http://localhost:8787")
    data = json.dumps({
        "run_id": run_id,
        "entity_id": entity_id,
        "layer": "landing",
        "passed": v_result.passed,
        "error_count": v_result.error_count,
        "errors": v_result.errors[:20],
        "schema_name": v_result.schema_name,
    })
    try:
        req = urllib.request.Request(
            f"{base_url}/api/schema-validation/result",
            data=data.encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=1)  # Short timeout — non-blocking, log and move on
    except Exception as exc:
        log.debug("Failed to POST validation result for entity %d: %s", entity_id, exc)
```

- [ ] **Step 2: Call it after v_result is assigned (line ~1363)**

After `v_result = validate_extraction(...)` (line ~1360-1363), insert:

```python
self._log_validation(run_id, entity.id, v_result)
```

This must go BEFORE the enforce-mode early return check (line ~1364), so both pass and fail get logged.

- [ ] **Step 3: Verify syntax**

Run: `python -c "from engine.orchestrator import Orchestrator; print('import ok')"`
Expected: `import ok`

- [ ] **Step 4: Commit**

```bash
git add engine/orchestrator.py
git commit -m "feat(engine): wire Packet B validation callback to dashboard"
```

---

## Task 5: Add ExtractionMethod to LMC run detail endpoint

**Files:**
- Modify: `dashboard/app/api/routes/load_mission_control.py` (lines 368-464)

- [ ] **Step 1: Add ExtractionMethod to the run detail SELECT**

In `get_lmc_run_detail()` (line ~368), find the SELECT statement that queries `engine_task_log` for per-entity results (line ~382-398). Add `ExtractionMethod` to the SELECT column list.

- [ ] **Step 2: Include it in the response dict**

In the row-to-dict mapping, add:

```python
"extractionMethod": row["ExtractionMethod"] or "unknown",
```

- [ ] **Step 3: Also add to the runs list endpoint**

In `get_lmc_runs()` (line ~334), add a subquery to show the **dominant** extraction method per run (most frequent non-unknown value, not arbitrary LIMIT 1):

```sql
(
  SELECT ExtractionMethod
  FROM engine_task_log
  WHERE RunId = er.RunId
    AND ExtractionMethod != 'unknown'
  GROUP BY ExtractionMethod
  ORDER BY COUNT(*) DESC
  LIMIT 1
) AS extraction_method
```

- [ ] **Step 4: Verify**

Run: `python -c "from dashboard.app.api.routes import load_mission_control; print('import ok')"`
Expected: `import ok`

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/routes/load_mission_control.py
git commit -m "feat(api): add ExtractionMethod to LMC run detail endpoint"
```

---

## Task 6: New `/api/lmc/compare` endpoint

**Files:**
- Modify: `dashboard/app/api/routes/load_mission_control.py`

- [ ] **Step 1: Add the compare endpoint**

**IMPORTANT: Deduplication + wall-clock vs. summed duration.**

The compare endpoint must:
1. Use a CTE to isolate the **latest succeeded landing record per entity per run** (dedupe retries)
2. Return **both** wall-clock run duration (from `engine_runs.StartedAt/EndedAt`) AND summed entity duration
3. Base the headline "speedup" on wall-clock duration, not summed entity duration
4. Include median and p95 per-entity duration for honest reporting

```python
@route("GET", "/api/lmc/compare")
def compare_runs(params, body=None, headers=None):
    """Compare two runs side-by-side for performance benchmarking."""
    run_a = params.get("run_a", "").strip()
    run_b = params.get("run_b", "").strip()
    if not run_a or not run_b:
        raise HttpError(400, "run_a and run_b query params required")

    conn = cpdb._get_conn()

    def _run_stats(rid):
        # Wall-clock duration from engine_runs
        run_row = conn.execute("""
            SELECT StartedAt, EndedAt,
                   ROUND((julianday(EndedAt) - julianday(StartedAt)) * 86400, 2) AS wall_clock_secs
            FROM engine_runs WHERE RunId = ?
        """, (rid,)).fetchone()
        wall_clock = run_row[2] if run_row and run_row[2] else None

        # Deduplicated entity stats (latest succeeded landing per entity)
        row = conn.execute("""
            WITH deduped AS (
                SELECT EntityId, RowsRead, BytesTransferred, DurationSeconds, ExtractionMethod,
                       ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
                FROM engine_task_log
                WHERE RunId = ? AND Status = 'succeeded' AND Layer = 'landing'
            )
            SELECT COUNT(*) AS entity_count,
                   SUM(RowsRead) AS total_rows,
                   ROUND(SUM(DurationSeconds), 2) AS entity_duration_sum,
                   ROUND(SUM(RowsRead) * 1.0 / NULLIF(SUM(DurationSeconds), 0), 1) AS rows_per_sec,
                   ROUND(SUM(BytesTransferred) * 1.0 / NULLIF(SUM(DurationSeconds), 0), 1) AS bytes_per_sec,
                   (SELECT ExtractionMethod FROM engine_task_log
                    WHERE RunId = ? AND ExtractionMethod != 'unknown'
                    GROUP BY ExtractionMethod ORDER BY COUNT(*) DESC LIMIT 1) AS extraction_method
            FROM deduped WHERE rn = 1
        """, (rid, rid)).fetchone()
        if not row or not row[0]:
            return None

        # Median and p95 entity duration
        durations = conn.execute("""
            WITH deduped AS (
                SELECT DurationSeconds,
                       ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
                FROM engine_task_log
                WHERE RunId = ? AND Status = 'succeeded' AND Layer = 'landing'
            )
            SELECT DurationSeconds FROM deduped WHERE rn = 1 ORDER BY DurationSeconds
        """, (rid,)).fetchall()
        dur_list = [d[0] for d in durations if d[0]]
        median_dur = dur_list[len(dur_list) // 2] if dur_list else 0
        p95_dur = dur_list[int(len(dur_list) * 0.95)] if dur_list else 0

        return {
            "run_id": rid,
            "entity_count": row[0] or 0,
            "total_rows": row[1] or 0,
            "entity_duration_sum": row[2] or 0,
            "wall_clock_duration": wall_clock,
            "rows_per_sec": row[3] or 0,
            "bytes_per_sec": row[4] or 0,
            "extraction_method": row[5] or "unknown",
            "median_entity_duration": round(median_dur, 2),
            "p95_entity_duration": round(p95_dur, 2),
        }

    stats_a = _run_stats(run_a)
    stats_b = _run_stats(run_b)
    if not stats_a or not stats_b:
        raise HttpError(404, "One or both runs not found or have no succeeded entities")

    # Matched entities — deduplicated (latest succeeded landing per entity per run)
    matched = conn.execute("""
        WITH deduped_a AS (
            SELECT EntityId, SourceTable, RowsRead, DurationSeconds,
                   ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
            FROM engine_task_log
            WHERE RunId = ? AND Status = 'succeeded' AND Layer = 'landing'
        ),
        deduped_b AS (
            SELECT EntityId, RowsRead, DurationSeconds,
                   ROW_NUMBER() OVER (PARTITION BY EntityId ORDER BY created_at DESC) AS rn
            FROM engine_task_log
            WHERE RunId = ? AND Status = 'succeeded' AND Layer = 'landing'
        )
        SELECT a.EntityId, a.SourceTable,
               a.RowsRead AS rows,
               a.DurationSeconds AS dur_a,
               b.DurationSeconds AS dur_b,
               ROUND(a.DurationSeconds / NULLIF(b.DurationSeconds, 0), 2) AS speedup
        FROM deduped_a a
        INNER JOIN deduped_b b ON a.EntityId = b.EntityId
        WHERE a.rn = 1 AND b.rn = 1
        ORDER BY speedup DESC
    """, (run_a, run_b)).fetchall()

    # Use wall-clock for headline speedup when available, fall back to entity sum
    dur_a = stats_a.get("wall_clock_duration") or stats_a["entity_duration_sum"]
    dur_b = stats_b.get("wall_clock_duration") or stats_b["entity_duration_sum"]
    speedup = round(dur_a / max(dur_b, 0.01), 1)

    return {
        "run_a": stats_a,
        "run_b": stats_b,
        "speedup": speedup,
        "speedup_basis": "wall_clock" if stats_a.get("wall_clock_duration") else "entity_sum",
        "matched_entities": [
            {
                "entity_id": r[0],
                "source_name": r[1] or "",
                "rows": r[2] or 0,
                "run_a_duration": r[3] or 0,
                "run_b_duration": r[4] or 0,
                "speedup": r[5] or 0,
            }
            for r in matched
        ],
    }
```

- [ ] **Step 2: Verify**

Run: `python -c "from dashboard.app.api.routes import load_mission_control; print('import ok')"`
Expected: `import ok`

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/routes/load_mission_control.py
git commit -m "feat(api): add /api/lmc/compare endpoint for run benchmarking"
```

---

## Task 7: LMC UI — Extraction method badges + pipeline stack

**Files:**
- Modify: `dashboard/app/src/pages/LoadMissionControl.tsx` (lines 1686-1753)

- [ ] **Step 0: MANDATORY — Invoke design skills**

Run `Skill("interface-design")` and `Skill("modernize")` before writing any code. Read `.interface-design/system.md` for tokens, spacing, depth. Apply premium UX treatment from modernize.

- [ ] **Step 1: Add extraction method badge component**

Near the top of the file (in the component helpers section), add a small inline component:

```tsx
function ExtractionBadge({ method }: { method: string }) {
  const isCx = method === "connectorx";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "var(--bp-font-mono)",
        background: isCx ? "var(--bp-copper)" : "var(--bp-surface-inset)",
        color: isCx ? "#fff" : "var(--bp-ink-secondary)",
        letterSpacing: "0.02em",
      }}
    >
      {isCx ? "CX" : method === "pyodbc" ? "ODBC" : "—"}
    </span>
  );
}
```

- [ ] **Step 2: Add badge to entity results table**

In the entity results table (line ~1701-1710), add an "Engine" column header. In the table body row mapping (line ~1713-1750), add:

```tsx
<td><ExtractionBadge method={entity.extractionMethod || "unknown"} /></td>
```

- [ ] **Step 3: Add pipeline stack to entity drill-in**

If the entity detail/expanded row exists, add a horizontal flow showing the tech stack:

```tsx
function PipelineStack({ method }: { method: string }) {
  const steps = method === "connectorx"
    ? ["ConnectorX", "Polars", "Snappy Parquet", "OneLake"]
    : ["pyodbc", "pandas", "PyArrow Parquet", "OneLake"];
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 8 }}>
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <span style={{ color: "var(--bp-ink-tertiary)", fontSize: 10 }}>→</span>}
          <span style={{
            padding: "2px 8px", borderRadius: 4, fontSize: 11,
            background: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)",
            fontFamily: "var(--bp-font-mono)",
          }}>{s}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd dashboard/app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/src/pages/LoadMissionControl.tsx
git commit -m "feat(ui): add extraction method badges and pipeline stack to LMC"
```

---

## Task 8: LMC UI — Throughput sparkline

**Files:**
- Modify: `dashboard/app/src/pages/LoadMissionControl.tsx` (lines 2231-2264)

- [ ] **Step 0: MANDATORY — Invoke design skills (if not already active in this session)**

Run `Skill("interface-design")` and `Skill("modernize")`. Follow `.interface-design/system.md`.

- [ ] **Step 1: Add Recharts import**

At top of file, add:

```tsx
import { AreaChart, Area, ResponsiveContainer } from "recharts";
```

- [ ] **Step 2: Build sparkline from entity data**

In the run summary section (line ~2231), after the existing summary cards, compute sparkline data from the entity results. **Sort by completion time** so the sparkline shows throughput progression over the run, not arbitrary order:

```tsx
const sparklineData = useMemo(() => {
  if (!runDetail?.entities) return [];
  return runDetail.entities
    .filter((e: any) => e.status === "succeeded" && e.durationSeconds > 0)
    .sort((a: any, b: any) => (a.completedAt || "").localeCompare(b.completedAt || ""))
    .map((e: any) => ({
      rowsPerSec: Math.round(e.rowsRead / e.durationSeconds),
    }));
}, [runDetail]);
```

Note: If `completedAt` is not available on entity results, the API endpoint must include it (it's `created_at` from `engine_task_log`). Add it to the SELECT in Task 5 if missing.

- [ ] **Step 3: Render sparkline in run summary card area**

Add a small sparkline card alongside existing summary cards:

```tsx
{sparklineData.length > 2 && (
  <div style={{
    height: 48, width: 160,
    borderRadius: 8,
    border: "1px solid var(--bp-border)",
    padding: "4px 8px",
  }}>
    <div style={{ fontSize: 10, color: "var(--bp-ink-tertiary)", marginBottom: 2 }}>Throughput</div>
    <ResponsiveContainer width="100%" height={28}>
      <AreaChart data={sparklineData}>
        <Area
          type="monotone"
          dataKey="rowsPerSec"
          stroke="var(--bp-copper)"
          fill="var(--bp-copper)"
          fillOpacity={0.15}
          strokeWidth={1.5}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  </div>
)}
```

- [ ] **Step 4: Verify build**

Run: `cd dashboard/app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/src/pages/LoadMissionControl.tsx
git commit -m "feat(ui): add throughput sparkline to LMC run summary"
```

---

## Task 9: LMC UI — Performance comparison section

**Files:**
- Modify: `dashboard/app/src/pages/LoadMissionControl.tsx`

This is the largest UI task. It adds a collapsible comparison section with run picker, summary cards, and scatter plot.

- [ ] **Step 0: MANDATORY — Invoke design skills (if not already active in this session)**

Run `Skill("interface-design")` and `Skill("modernize")`. Follow `.interface-design/system.md`.

- [ ] **Step 1: Add comparison state and fetch hook**

Near the existing state declarations, add:

**IMPORTANT: Use AbortController to cancel stale requests when user changes selections fast. Use encodeURIComponent on run IDs.**

```tsx
const [compareOpen, setCompareOpen] = useState(false);
const [compareRunA, setCompareRunA] = useState("");
const [compareRunB, setCompareRunB] = useState("");
const [compareData, setCompareData] = useState<any>(null);
const [compareLoading, setCompareLoading] = useState(false);

useEffect(() => {
  if (!compareRunA || !compareRunB || compareRunA === compareRunB) {
    setCompareData(null);
    return;
  }
  const controller = new AbortController();
  setCompareLoading(true);
  fetch(
    `/api/lmc/compare?run_a=${encodeURIComponent(compareRunA)}&run_b=${encodeURIComponent(compareRunB)}`,
    { signal: controller.signal }
  )
    .then(r => r.json())
    .then(setCompareData)
    .catch((err) => { if (err.name !== "AbortError") setCompareData(null); })
    .finally(() => setCompareLoading(false));
  return () => controller.abort();
}, [compareRunA, compareRunB]);
```

- [ ] **Step 2: Add ScatterChart import**

```tsx
import { AreaChart, Area, ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
```

- [ ] **Step 3: Build the collapsible comparison section**

Add above the existing entity results table. This should be a collapsible section:

```tsx
{/* Performance Comparison — collapsible */}
<div style={{
  border: "1px solid var(--bp-border)",
  borderRadius: 8,
  marginBottom: 16,
  overflow: "hidden",
}}>
  <button
    onClick={() => setCompareOpen(!compareOpen)}
    style={{
      width: "100%", display: "flex", justifyContent: "space-between",
      alignItems: "center", padding: "12px 16px",
      background: "var(--bp-surface)", border: "none", cursor: "pointer",
      color: "var(--bp-ink)", fontFamily: "var(--bp-font-display)",
      fontSize: 14, fontWeight: 600,
    }}
  >
    <span>Extraction Performance</span>
    <ChevronDown style={{
      width: 16, height: 16, transition: "transform 0.2s",
      transform: compareOpen ? "rotate(180deg)" : "rotate(0deg)",
    }} />
  </button>

  {compareOpen && (
    <div style={{ padding: 16 }}>
      {/* Run Pickers */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <select value={compareRunA} onChange={e => setCompareRunA(e.target.value)}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid var(--bp-border)", background: "var(--bp-surface)", color: "var(--bp-ink)" }}>
          <option value="">Select Run A</option>
          {(runs || []).map((r: any) => (
            <option key={r.runId} value={r.runId}>
              {r.startedAt?.slice(0, 16)} · {r.extractionMethod === "connectorx" ? "CX" : r.extractionMethod === "pyodbc" ? "ODBC" : "?"} · {r.entityCount} entities
            </option>
          ))}
        </select>
        <select value={compareRunB} onChange={e => setCompareRunB(e.target.value)}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid var(--bp-border)", background: "var(--bp-surface)", color: "var(--bp-ink)" }}>
          <option value="">Select Run B</option>
          {(runs || []).map((r: any) => (
            <option key={r.runId} value={r.runId}>
              {r.startedAt?.slice(0, 16)} · {r.extractionMethod === "connectorx" ? "CX" : r.extractionMethod === "pyodbc" ? "ODBC" : "?"} · {r.entityCount} entities
            </option>
          ))}
        </select>
      </div>

      {/* Summary Cards + Scatter — render when data loaded */}
      {compareData && !compareLoading && (
        <>
          {/* 4 summary cards */}
          {/* Scatter plot */}
        </>
      )}

      {compareLoading && <div style={{ textAlign: "center", padding: 24, color: "var(--bp-ink-tertiary)" }}>Loading comparison...</div>}

      {!compareRunA && !compareRunB && (
        <div style={{ textAlign: "center", padding: 24, color: "var(--bp-ink-tertiary)", fontSize: 13 }}>
          Select two runs to compare extraction performance
        </div>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 4: Build the 4 comparison summary cards**

Inside the `compareData && !compareLoading` block:

```tsx
<div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
  {[
    { label: "Duration", a: `${Math.round(compareData.run_a.total_duration)}s`, b: `${Math.round(compareData.run_b.total_duration)}s` },
    { label: "Throughput", a: `${Math.round(compareData.run_a.rows_per_sec).toLocaleString()} rows/s`, b: `${Math.round(compareData.run_b.rows_per_sec).toLocaleString()} rows/s` },
    { label: "Data Volume", a: `${Math.round(compareData.run_a.total_rows).toLocaleString()} rows`, b: `${Math.round(compareData.run_b.total_rows).toLocaleString()} rows` },
    { label: "Speedup", a: "", b: `${compareData.speedup}×`, highlight: true },
  ].map((card) => (
    <div key={card.label} style={{
      padding: 16, borderRadius: 8,
      border: `1px solid ${card.highlight ? "var(--bp-copper)" : "var(--bp-border)"}`,
      background: card.highlight ? "color-mix(in srgb, var(--bp-copper) 8%, var(--bp-surface))" : "var(--bp-surface)",
    }}>
      <div style={{ fontSize: 11, color: "var(--bp-ink-tertiary)", marginBottom: 8 }}>{card.label}</div>
      {card.highlight ? (
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--bp-copper)", fontFamily: "var(--bp-font-display)" }}>
          {card.b}
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 10, color: "var(--bp-ink-tertiary)" }}>Run A</div><div style={{ fontSize: 16, fontWeight: 600 }}>{card.a}</div></div>
          <div><div style={{ fontSize: 10, color: "var(--bp-ink-tertiary)" }}>Run B</div><div style={{ fontSize: 16, fontWeight: 600 }}>{card.b}</div></div>
        </div>
      )}
    </div>
  ))}
</div>
```

- [ ] **Step 5: Build the entity scatter plot**

Below the summary cards:

```tsx
{compareData.matched_entities.length > 0 && (
  <div style={{ border: "1px solid var(--bp-border)", borderRadius: 8, padding: 16 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-secondary)", marginBottom: 8 }}>
      Per-Entity Duration (dots below diagonal = faster with Run B)
    </div>
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 20 }}>
        <XAxis dataKey="run_a_duration" name="Run A (s)" type="number"
          tick={{ fontSize: 10, fill: "var(--bp-ink-tertiary)" }}
          label={{ value: "Run A duration (s)", position: "bottom", fontSize: 10, fill: "var(--bp-ink-tertiary)" }} />
        <YAxis dataKey="run_b_duration" name="Run B (s)" type="number"
          tick={{ fontSize: 10, fill: "var(--bp-ink-tertiary)" }}
          label={{ value: "Run B duration (s)", angle: -90, position: "left", fontSize: 10, fill: "var(--bp-ink-tertiary)" }} />
        <Tooltip content={({ payload }) => {
          if (!payload?.length) return null;
          const d = payload[0].payload;
          return (
            <div style={{ background: "var(--bp-surface)", border: "1px solid var(--bp-border)", borderRadius: 6, padding: 8, fontSize: 11 }}>
              <div style={{ fontWeight: 600 }}>{d.source_name}</div>
              <div>Rows: {d.rows?.toLocaleString()}</div>
              <div>Run A: {d.run_a_duration}s → Run B: {d.run_b_duration}s</div>
              <div style={{ color: "var(--bp-copper)", fontWeight: 600 }}>{d.speedup}× faster</div>
            </div>
          );
        }} />
        {/* Diagonal scales to actual data max, not hardcoded */}
        <ReferenceLine segment={[{ x: 0, y: 0 }, {
          x: Math.max(...compareData.matched_entities.map((e: any) => Math.max(e.run_a_duration, e.run_b_duration)), 1),
          y: Math.max(...compareData.matched_entities.map((e: any) => Math.max(e.run_a_duration, e.run_b_duration)), 1),
        }]} stroke="var(--bp-border)" strokeDasharray="4 4" />
        <Scatter data={compareData.matched_entities} fill="var(--bp-copper)" fillOpacity={0.7} />
      </ScatterChart>
    </ResponsiveContainer>
  </div>
)}
```

- [ ] **Step 6: Verify build**

Run: `cd dashboard/app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add dashboard/app/src/pages/LoadMissionControl.tsx
git commit -m "feat(ui): add performance comparison section to LMC"
```

---

## Task 9.5: Confirm / extend Data Estate API governance contract

**Files:**
- Verify: `dashboard/app/api/routes/data_estate.py` (lines 128-167)
- Possibly modify: `dashboard/app/api/routes/data_estate.py`

The UI tasks that follow (10-12) depend on specific fields in the `/api/estate/overview` response. Confirm they exist before building UI against them.

- [ ] **Step 1: Verify classification section returns breakdown data**

Read `_classification()` in data_estate.py. Check if it returns per-sensitivity-level counts. If NOT, add a breakdown query:

```python
breakdown_rows = conn.execute("""
    SELECT sensitivity_level, COUNT(*) AS cnt
    FROM column_classifications
    GROUP BY sensitivity_level
""").fetchall()
total_classified = sum(r[1] for r in breakdown_rows) or 1
breakdown = {r[0]: round(r[1] / total_classified * 100, 1) for r in breakdown_rows}
```

Add `"breakdown": breakdown` to the classification return dict.

- [ ] **Step 2: Verify schemaValidation returns total/passed/failed**

Confirm `_schema_validation()` returns `{"total": N, "passed": N, "failed": N}`. It should — this was fixed earlier.

- [ ] **Step 3: Verify purview returns mappingCount**

Confirm `_purview()` returns `mappingCount`. It should — already checked.

- [ ] **Step 4: Verify entity results include completedAt for sparkline ordering**

In `/api/lmc/run/{run_id}`, check that per-entity results include `created_at` (or equivalent timestamp). If missing, add it to the SELECT so the sparkline in Task 8 can sort by completion time.

- [ ] **Step 5: Commit if changes made**

```bash
git add dashboard/app/api/routes/data_estate.py dashboard/app/api/routes/load_mission_control.py
git commit -m "feat(api): extend governance and LMC API contracts for UI enhancements"
```

---

## Task 10: Enhance GovernancePanel — Classification section

**Files:**
- Modify: `dashboard/app/src/components/estate/GovernancePanel.tsx` (lines 58-89)

- [ ] **Step 0: MANDATORY — Invoke design skills**

Run `Skill("interface-design")` and `Skill("modernize")`. Follow `.interface-design/system.md`.

- [ ] **Step 1: Add sensitivity breakdown bar**

In the classification section (line ~58-89), after the existing coverage display, add a stacked horizontal bar:

```tsx
{/* Sensitivity breakdown bar */}
<div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginTop: 8 }}>
  {[
    { key: "public", color: "var(--bp-ink-muted)" },
    { key: "internal", color: "#5B8DEF" },
    { key: "confidential", color: "#E9A23B" },
    { key: "restricted", color: "#E07A3B" },
    { key: "pii", color: "#DC3545" },
  ].map(level => {
    const pct = classification.breakdown?.[level.key] || 0;
    return pct > 0 ? <div key={level.key} style={{ width: `${pct}%`, background: level.color }} /> : null;
  })}
</div>
```

Note: This requires the API to include `breakdown` in the classification response. If not available, fall back to a simple coverage bar.

- [ ] **Step 2: Add rescan button**

```tsx
<button
  onClick={() => fetch("/api/classification/scan", { method: "POST" })}
  style={{
    background: "none", border: "none", cursor: "pointer",
    color: "var(--bp-ink-tertiary)", padding: 4,
  }}
  title="Rescan classifications"
>
  <RefreshCw style={{ width: 14, height: 14 }} />
</button>
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/src/components/estate/GovernancePanel.tsx
git commit -m "feat(ui): enrich classification section in GovernancePanel"
```

---

## Task 11: Enhance GovernancePanel — Schema Validation + Purview sections

**Files:**
- Modify: `dashboard/app/src/components/estate/GovernancePanel.tsx` (lines 91-140)

- [ ] **Step 0: MANDATORY — Invoke design skills (if not already active in this session)**

Run `Skill("interface-design")` and `Skill("modernize")`. Follow `.interface-design/system.md`.

- [ ] **Step 1: Add pass/fail proportional bar to schema validation section**

In the schema validation section (line ~91-114):

```tsx
{schemaValidation.total > 0 && (
  <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginTop: 8 }}>
    <div style={{
      width: `${(schemaValidation.passed / schemaValidation.total) * 100}%`,
      background: "var(--bp-operational)",
    }} />
    <div style={{
      width: `${(schemaValidation.failed / schemaValidation.total) * 100}%`,
      background: "var(--bp-fault)",
    }} />
  </div>
)}
```

Add click-through to schema validation page:

```tsx
<div onClick={() => window.location.href = "/schema-validation"} style={{ cursor: "pointer" }}>
```

- [ ] **Step 2: Add Purview status progression**

In the Purview section (line ~116-140), replace or enhance the status badge with a 3-step indicator:

```tsx
<div style={{ display: "flex", gap: 4, marginTop: 8 }}>
  {(["pending", "ready", "synced"] as const).map((step, i) => {
    const isActive = step === purview.status;
    const isPast = ["pending", "ready", "synced"].indexOf(purview.status) >= i;
    return (
      <div key={step} style={{
        flex: 1, height: 4, borderRadius: 2,
        background: isPast ? (isActive ? "var(--bp-copper)" : "var(--bp-operational)") : "var(--bp-surface-inset)",
        transition: "background 0.3s",
      }} />
    );
  })}
</div>
<div style={{ fontSize: 10, color: "var(--bp-ink-tertiary)", marginTop: 4, textTransform: "capitalize" }}>
  {purview.status}
  {purview.mappingCount > 0 && ` · ${purview.mappingCount} mappings`}
</div>
```

- [ ] **Step 3: Verify build**

Run: `cd dashboard/app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/src/components/estate/GovernancePanel.tsx
git commit -m "feat(ui): enrich schema validation and Purview sections in GovernancePanel"
```

---

## Task 12: Wire GovernanceScore to real composite

**Files:**
- Modify: `dashboard/app/src/components/estate/GovernanceScore.tsx` (line 23)

- [ ] **Step 0: MANDATORY — Invoke design skills (if not already active in this session)**

Run `Skill("interface-design")` and `Skill("modernize")`. Follow `.interface-design/system.md`.

- [ ] **Step 1: Verify current weighting matches spec**

Read GovernanceScore.tsx line 23. It should already be:
```tsx
const composite = Math.round(classificationPct * 0.4 + validationPct * 0.4 + purviewPct * 0.2);
```

If it matches the spec (40/40/20), no code change needed — just verify the props are being passed real data from GovernancePanel.

- [ ] **Step 2: Verify color thresholds**

Check lines 50-53:
- Green (operational): >= 80 → lower to >= 70 (spec says >70 = green)
- Amber (caution): >= 50 → lower to >= 40 (spec says 40-70 = amber)
- Red (fault): < 50 → change to < 40

Update if needed:
```tsx
const color = composite >= 70 ? "var(--bp-operational)" : composite >= 40 ? "var(--bp-caution)" : "var(--bp-fault)";
```

- [ ] **Step 3: Commit (if changes made)**

```bash
git add dashboard/app/src/components/estate/GovernanceScore.tsx
git commit -m "fix(ui): align GovernanceScore thresholds with spec (70/40)"
```

---

## Task 12.5: Seeded backend integration test

**Files:**
- Create: `tests/test_integration_showcase.py` (or add to existing test file if one exists)

This test seeds sample data into the SQLite DB and verifies the full chain works.

- [ ] **Step 1: Write integration test**

```python
"""Integration test for extraction method tracking and compare endpoint."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "dashboard", "app"))

import api.control_plane_db as cpdb

def test_extraction_method_column_exists():
    """DB migration adds ExtractionMethod column."""
    conn = cpdb._get_conn()
    # Insert a row with ExtractionMethod
    conn.execute("""
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsRead, DurationSeconds, ExtractionMethod)
        VALUES ('test-run-cx', 1, 'landing', 'succeeded', 1000, 5.0, 'connectorx')
    """)
    conn.execute("""
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsRead, DurationSeconds, ExtractionMethod)
        VALUES ('test-run-pyodbc', 1, 'landing', 'succeeded', 1000, 25.0, 'pyodbc')
    """)
    conn.commit()

    # Verify ExtractionMethod persisted
    row = conn.execute("SELECT ExtractionMethod FROM engine_task_log WHERE RunId = 'test-run-cx' LIMIT 1").fetchone()
    assert row[0] == "connectorx", f"Expected 'connectorx', got {row[0]}"

    # Verify compare endpoint returns data
    from api.routes.load_mission_control import compare_runs
    result = compare_runs({"run_a": "test-run-pyodbc", "run_b": "test-run-cx"})
    assert result["speedup"] > 0, "Speedup should be positive"
    assert len(result["matched_entities"]) == 1, "Should have 1 matched entity"

    # Cleanup
    conn.execute("DELETE FROM engine_task_log WHERE RunId IN ('test-run-cx', 'test-run-pyodbc')")
    conn.commit()
    print("Integration test PASSED")

if __name__ == "__main__":
    test_extraction_method_column_exists()
```

- [ ] **Step 2: Run the test**

Run: `python tests/test_integration_showcase.py`
Expected: `Integration test PASSED`

- [ ] **Step 3: Commit**

```bash
git add tests/test_integration_showcase.py
git commit -m "test: add seeded integration test for extraction method tracking"
```

---

## Task 13: Final verification

- [ ] **Step 1: TypeScript check**

Run: `cd dashboard/app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Python import check**

Run:
```bash
python -c "from engine.models import RunResult; r = RunResult(entity_id=1, layer='l', status='s', extraction_method='connectorx'); print(r.extraction_method)"
python -c "from dashboard.app.api.routes import load_mission_control; print('lmc ok')"
python -c "from dashboard.app.api.routes import data_estate; r = data_estate.get_estate_overview({}); print(len(r.get('layers', [])))"
```
Expected: `connectorx`, `lmc ok`, `4`

- [ ] **Step 3: Verify estate endpoint still returns all 7 sections**

Run:
```bash
python -c "
from dashboard.app.api.routes import data_estate
r = data_estate.get_estate_overview({})
for k in ['sources','layers','classification','schemaValidation','purview','freshness','generatedAt']:
    print(f'{k}: {type(r.get(k)).__name__}')
"
```
Expected: All 7 keys present with correct types

- [ ] **Step 4: Final commit with all remaining changes**

```bash
git add -A
git commit -m "feat: integration showcase — ConnectorX badges, comparison section, governance enhancements"
```
