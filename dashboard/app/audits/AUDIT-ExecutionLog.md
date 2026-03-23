# AUDIT: ExecutionLog
**File**: `dashboard/app/src/pages/ExecutionLog.tsx`
**Backend routes**: `dashboard/app/api/routes/pipeline.py`, `dashboard/app/api/routes/monitoring.py`
**DB layer**: `dashboard/app/api/db.py` (thin wrapper around `fmd_control_plane.db`)
**Audited**: 2026-03-13 (original), **2026-03-23 (updated)**
**Focus**: Data source correctness

---

## Architecture Summary

ExecutionLog has three tabs that each call a separate API endpoint:

1. **Pipeline Runs** -> `GET /api/pipeline-executions` -> `pipeline.py`
2. **Copy Activities** -> `GET /api/copy-executions` -> `monitoring.py`
3. **Notebook Runs** -> `GET /api/notebook-executions` -> `monitoring.py`

The frontend normalizes all three into a common `PipelineRun` shape via `normalizeRun()`.

---

## Data Points Verified

### 1. Pipeline Runs Tab
- **Frontend call** (line 181): `fetch('/api/pipeline-executions')`
- **Backend route** (pipeline.py:343-372): Queries `engine_runs` table with proper aliasing:
  - `StartedAt AS StartTime`, `EndedAt AS EndTime`, `ErrorSummary AS ErrorMessage`
  - Hardcoded `'FMD_ENGINE_V3' AS Name` for all rows
  - Returns `RunId`, `PipelineMode`, `Status`, `StartTime`, `EndTime`, entity counts, row/byte metrics, `Layers`, `TriggeredBy`, `ErrorMessage`
  - `ORDER BY COALESCE(StartedAt, EndedAt, updated_at) DESC LIMIT 100`
- **Status**: **CORRECT** — backend pre-aliases all fields so the frontend receives `Status`, `StartTime`, `EndTime`, `ErrorMessage`, `Name` directly. Duration works. Error messages surface.

### 2. Copy Activities Tab
- **Frontend call** (line 182): `fetch('/api/copy-executions')`
- **Backend route** (monitoring.py:148-210): Queries `copy_activity_audit` with rich JSON extraction from `LogData`:
  - `CopyActivityName AS Name`
  - `LogType` normalized to `Status` via SQL CASE
  - `LogDateTime AS StartTime`, computed `EndTime` from duration
  - Extracts `DurationSeconds`, `RowsRead`, `RowsWritten`, `BytesTransferred`, `SourceServer`, `SourceDatabase`, `SourceTable`, `ErrorMessage` from `LogData` JSON
  - `ORDER BY id DESC LIMIT 500`
- **Status**: **CORRECT** — queries the correct SQLite table with structured metric extraction.

### 3. Notebook Runs Tab
- **Frontend call** (line 183): `fetch('/api/notebook-executions')`
- **Backend route** (monitoring.py:213-253): Queries `engine_task_log` (not the empty `notebook_executions` table):
  - `Layer || '_Entity_' || EntityId AS Name`
  - `Status` normalized via SQL CASE
  - `created_at AS StartTime`, computed `EndTime` from `DurationSeconds`
  - Returns `RunId`, `EntityId`, `Layer`, `SourceServer/Database/Table`, row/byte metrics, `LoadType`, `ErrorType`, `ErrorMessage`, `TargetLakehouse`
  - `ORDER BY id DESC LIMIT 500`
- **Status**: **CORRECT** — queries the actual source of truth for engine processing tasks.

### 4. Status Normalization
- **Frontend** (lines 34-41): `normalizeLogType()` handles a full set of LogType values.
- **Status**: CORRECT. Largely redundant now since backend pre-normalizes Status via SQL CASE for copy and notebook tabs, and `engine_runs` already stores proper Status values.

### 5. Row Key Generation
- **Frontend** (lines 78-89): `rowKey()` fallback chain:
  1. `PipelineExecutionId` / `CopyActivityExecutionId` / `NotebookExecutionId` (Fabric SQL IDs — not returned by current backends)
  2. `PipelineRunGuid` + `LogType` + `LogDateTime` (composite — relevant for copy_activity_audit rows)
  3. `RunId` (engine_runs — used by pipeline and notebook tabs)
  4. Array index (last resort)
- **Status**: CORRECT — `RunId` is present in pipeline and notebook data; copy data has `PipelineRunGuid` + `LogType` + `LogDateTime`.

### 6. Quick Stats
- **Frontend** (lines 252-260): Counts `succeeded`, `failed`, `running` from normalized Status field.
- **Status**: CORRECT across all three tabs.

### 7. Duration Calculation
- **Frontend** (lines 93-103): `humanDuration(startStr, endStr)` computes diff between StartTime and EndTime.
- **Pipeline tab**: Backend aliases `StartedAt AS StartTime` and `EndedAt AS EndTime` — duration works.
- **Copy tab**: Backend provides `StartTime` (from LogDateTime) and computed `EndTime` — duration works.
- **Notebook tab**: Backend provides `StartTime` (from created_at) and computed `EndTime` — duration works.
- **Status**: CORRECT across all three tabs.

### 8. Business View Summary
- **Frontend** (lines 140-158): `businessSummary(run)` builds human-readable text from `Name`, `Status`, duration, and `ErrorMessage`.
- **Pipeline tab**: `Name` = `'FMD_ENGINE_V3'` (hardcoded in backend), `ErrorMessage` aliased from `ErrorSummary` — works.
- **Copy tab**: `Name` = `CopyActivityName`, `ErrorMessage` extracted from `LogData` JSON — works.
- **Notebook tab**: `Name` = `Layer_Entity_EntityId`, `ErrorMessage` from column — works.
- **Status**: CORRECT across all three tabs.

---

## Previously Reported Bugs — Status Update

### B1 — Pipeline Runs queried `pipeline_audit` instead of `engine_runs` — FIXED
- **Original issue**: Endpoint returned individual log events from `pipeline_audit`, not execution records. A single pipeline run appeared as multiple rows.
- **Fix applied**: `pipeline.py:343-372` now queries `engine_runs` with proper aliasing. Each row is a single engine run with start/end timestamps, status, and aggregated metrics.
- **Verified**: 2026-03-23. Duration, error messages, and status all work correctly.

### B2 — Copy Executions queried non-existent `CopyActivityExecution` table — FIXED
- **Original issue**: `SELECT * FROM CopyActivityExecution` — table did not exist in SQLite. Silently returned `[]`.
- **Fix applied**: `monitoring.py:148-210` now queries `copy_activity_audit` with rich JSON extraction from `LogData` for metrics, source info, and errors.
- **Verified**: 2026-03-23. Route queries correct table with structured output.

### B3 — Notebook Executions queried non-existent `NotebookExecution` table — FIXED
- **Original issue**: `SELECT * FROM NotebookExecution` — table did not exist in SQLite. Silently returned `[]`.
- **Fix applied**: `monitoring.py:213-253` now queries `engine_task_log` which stores per-entity processing tasks (the actual execution records for bronze/silver processing).
- **Verified**: 2026-03-23. Route queries correct table with proper aliasing.

### B4 — Duration always showed "---" for pipeline audit rows — RESOLVED BY B1 FIX
- **Original issue**: `pipeline_audit` only had `LogDateTime` (no EndTime), so duration was always blank.
- **Resolution**: B1 fix switched to `engine_runs` which has both `StartedAt` and `EndedAt`. Backend aliases them as `StartTime`/`EndTime`. Duration now works.

### B5 — Error message missing for pipeline audit rows — RESOLVED BY B1 FIX
- **Original issue**: `pipeline_audit` stored errors in `LogData` JSON, not a dedicated column.
- **Resolution**: B1 fix switched to `engine_runs` which has `ErrorSummary`. Backend aliases it as `ErrorMessage`. Business view now shows error details.

### B6 — normalizeRun() engine_runs fallback aliases were dead code — NOW PARTIALLY DEAD (harmless)
- **Original issue**: `normalizeRun()` had fallback mappings for `StartedAt->StartTime`, `EndedAt->EndTime`, `ErrorSummary->ErrorMessage` that never matched because the backend returned `pipeline_audit` data.
- **Current state**: Backend now pre-aliases these fields in SQL (`StartedAt AS StartTime`, etc.), so the frontend receives the final column names directly. The `normalizeRun()` fallback aliases for `StartedAt`, `EndedAt`, and `ErrorSummary` (lines 58-68) are still dead code — they exist but never trigger because the backend handles the mapping. This is harmless but unnecessary.

---

## Remaining Observations (non-blocking)

### O1 — Pipeline name hardcoded as "FMD_ENGINE_V3" [COSMETIC]
- **Location**: `pipeline.py:353` — `'FMD_ENGINE_V3' AS Name`
- **Impact**: Every pipeline run shows the same name. Cosmetic only — there is currently only one engine, so this is accurate. If additional engines or pipeline types are added, this would need dynamic naming.
- **Severity**: Low / cosmetic.

### O2 — "Notebook Runs" tab label is slightly misleading [COSMETIC]
- **Location**: `ExecutionLog.tsx:338` — tab label says "Notebook Runs"
- **Impact**: The tab actually shows `engine_task_log` entries (per-entity processing tasks for bronze/silver layers), not actual Fabric notebook execution records. The data is useful and correct, but the label implies Fabric notebook runs. A more accurate label would be "Processing Tasks" or "Engine Tasks."
- **Severity**: Low / cosmetic.

### O3 — No pagination (all records rendered to DOM) [MINOR]
- **Location**: Backend limits are `LIMIT 100` (pipeline) and `LIMIT 500` (copy, notebook). Frontend renders all returned records into the DOM at once.
- **Impact**: With up to 500 rows of copy/notebook data, the DOM could get heavy. No virtual scrolling or client-side pagination. Not a problem at current data volumes but could become one at scale.
- **Severity**: Low. Server-side LIMIT provides an implicit cap.

### O4 — normalizeRun() fallback aliases are dead code [TRIVIAL]
- **Location**: `ExecutionLog.tsx:58-68` — `StartedAt->StartTime`, `EndedAt->EndTime`, `ErrorSummary->ErrorMessage` mappings
- **Impact**: These branches never execute because the backend pre-aliases all fields in SQL. The code is harmless — it provides defense-in-depth if the backend aliasing were ever removed — but it is technically unreachable.
- **Severity**: Trivial / no functional impact.

---

## Summary

| # | Data Point | Source Table | Status |
|---|-----------|-------------|--------|
| 1 | Pipeline Runs tab | `engine_runs` | **CORRECT** |
| 2 | Copy Activities tab | `copy_activity_audit` | **CORRECT** |
| 3 | Notebook Runs tab | `engine_task_log` | **CORRECT** |
| 4 | Status normalization | (derived) | CORRECT |
| 5 | Row keys | (derived) | CORRECT |
| 6 | Quick stats | (derived) | CORRECT |
| 7 | Duration | (derived from Start/EndTime) | **CORRECT** |
| 8 | Business summary | (derived) | **CORRECT** |

**Overall verdict**: **PASS with notes.** All three tabs query correct SQLite tables with proper aliasing. Duration, error messages, status normalization, and business summaries all work. The three CRITICAL/BROKEN bugs (B1-B3) from the 2026-03-13 audit are fully resolved. Remaining observations are cosmetic or trivial (hardcoded pipeline name, misleading tab label, no pagination, dead normalizer fallbacks). No code changes needed.
