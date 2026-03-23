# AUDIT-DC2: DataClassification Page

**Files**: `dashboard/app/src/pages/DataClassification.tsx`, `dashboard/app/api/routes/classification.py`
**Audited**: 2026-03-23
**Verdict**: 4 findings (1 HIGH, 2 MEDIUM, 1 LOW) — all FIXED

---

## Findings

### DC2-01 — Fabricated column counts in fallback (HIGH) — FIXED

**File**: `DataClassification.tsx`, `_fallback()` function (lines 74-84)
**Description**: The fallback function (used during API loading and on API failure) fabricated column counts using a `* 15` multiplier: `totalColumns: entities.length * 15` and per-source `total: entities.filter(...).length * 15`. This displayed fake numbers to the user whenever the classification API was slow or unreachable.
**Fix**: Changed fabricated counts to `0`. The fallback now reports zero columns instead of invented numbers. The "Est. Columns" KPI will show 0 during loading rather than a made-up number.

### DC2-02 — Hardcoded hex color (MEDIUM) — FIXED

**File**: `DataClassification.tsx`, line 34
**Description**: `SENSITIVITY_INK.pii` used hardcoded `"#FEFDFB"` instead of a design token. This value corresponds to `--bp-surface-1`.
**Fix**: Replaced `"#FEFDFB"` with `"var(--bp-surface-1)"`.

### DC2-03 — Shallow copy of mutable scan job state (MEDIUM) — FIXED

**File**: `classification.py`, `get_classification_status()` (line 204)
**Description**: The endpoint returned `dict(_scan_job)`, a shallow copy. Since `_scan_job` contains a mutable `result` sub-dict, concurrent reads could see mutated state if the background scan thread updated the result dict between the copy and serialization.
**Fix**: Changed to `copy.deepcopy(_scan_job)` under the existing lock. Added `import copy`.

### DC2-04 — No validation on `level` query parameter (LOW) — FIXED

**File**: `classification.py`, `get_classification_data()` (line 243)
**Description**: The `level` query parameter was passed directly to a parameterized SQL query (no injection risk), but arbitrary values were silently accepted, returning empty results without any signal to the caller.
**Fix**: Added allowlist validation against `{"public", "internal", "confidential", "restricted", "pii"}`. Invalid values now return HTTP 400.

---

## Deferred Items

None. All findings were in scope and fixed.

---

## Items Reviewed — No Issues

| Check | Result |
|-------|--------|
| Truth bugs beyond DC2-01 | PASS — KPIs source from real API; banner correctly discloses engine not active |
| Dead code / unused imports | PASS — all imports used |
| Error handling (frontend) | PASS — fetch has `.catch()` that falls back gracefully; `res.ok` checked |
| SQL injection (backend) | PASS — all queries use `?` parameterized bindings |
| Accessibility | PASS — table headers present, interactive elements are buttons with text |
| Loading states | PASS — entity table shows "Loading..." row; fallback data now shows zeros |
| Empty states | PASS — "No entities match" and "No entities found" messages present |
| API response shape | PASS — frontend defensively defaults all fields with `?? 0` / `?? []` |
| Scalability | PASS — sources are dynamic from API/digest, not hardcoded |
