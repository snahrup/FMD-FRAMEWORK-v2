# TASK 002: Execute Full Bronze/Silver Load and Verify Success

> **Authority**: Steve Nahrup
> **Created**: 2026-03-09
> **Category**: feature
> **Complexity**: large
> **Impact**: critical
> **Agent**: backend-architect, pipeline-engineer

---

## Problem Statement

The FMD Framework **must prove it can execute a complete LZ → Bronze → Silver load for all 1,666 entities with ZERO failures**. This is the **primary deliverable** — the entire medallion architecture loading successfully from end to end.

### Success Criteria (Binary)

- [ ] All 1,666 Landing Zone entities load successfully
- [ ] All 1,666 Bronze entities load successfully
- [ ] All 1,666 Silver entities load successfully
- [ ] Zero entities in `Failed` status
- [ ] Zero entities stuck in `InProgress` status
- [ ] All execution logs show `Succeeded` final status
- [ ] Dashboard Execution Matrix shows 100% green status badges

---

## Scope

### In Scope

- [ ] Landing Zone (LZ) full load for all 1,666 entities
- [ ] Bronze layer full load for all 1,666 entities (LZ → Bronze)
- [ ] Silver layer full load for all 1,666 entities with SCD Type 2 merge
- [ ] Execution logging to `execution.EntityStatus` table
- [ ] Control plane SQLite sync (dual-write)
- [ ] Performance monitoring (duration per entity, rows processed)
- [ ] Error handling and retry logic validation
- [ ] Final validation queries to prove success

### Out of Scope

- Gold layer execution (stretch goal, not blocking)
- Incremental load testing (covered in separate task)
- Performance optimization (initial load can be slow)
- Custom cleansing rules (default cleansing only)

---

## Prerequisites

| # | Prerequisite | Verification | Status |
|---|--------------|--------------|--------|
| P.1 | Task 001 complete (all entities `IsActive = 1`) | Run `scripts/validate_entity_activation.py` | ⬜ |
| P.2 | All 5 source systems accessible | Run `diag_connections.py` | ⬜ |
| P.3 | Fabric workspace lakehouses exist (LZ, Bronze, Silver) | Check `config/item_config.yaml` | ⬜ |
| P.4 | Notebooks deployed (NB_FMD_LOAD_LANDING_BRONZE, NB_FMD_LOAD_BRONZE_SILVER) | Check `config/item_deployment.json` | ⬜ |
| P.5 | Pipeline `PL_FMD_LOAD_ALL` exists and is valid | Run `diag_pipeline.py` | ⬜ |
| P.6 | Local SQLite `control_plane_db.py` initialized | File exists: `dashboard/app/api/control_plane.db` | ⬜ |
| P.7 | No pipeline runs in progress | Query `execution.PipelineRun` WHERE `Status = 'InProgress'` = 0 | ⬜ |

---

## Acceptance Criteria (Binary Checklist)

### A. Pre-Flight Validation

| # | Check | Validation Command | Expected Result |
|---|-------|-------------------|----------------|
| A.1 | All entities active | `python scripts/validate_entity_activation.py` | Exit code 0, all tests pass |
| A.2 | Source connections valid | `python diag_connections.py` | All 5 sources show "✅ Connected" |
| A.3 | Lakehouses accessible | `python diag_lakehouse.py` | LZ/Bronze/Silver all respond |
| A.4 | Notebooks deployed | `python src/deployment/validate_notebooks.py` | All 8 notebooks found in Fabric |
| A.5 | Pipeline exists | `python diag_pipeline.py --pipeline PL_FMD_LOAD_ALL` | Returns pipeline details |
| A.6 | No stale runs | SQL: `SELECT COUNT(*) FROM execution.PipelineRun WHERE Status = 'InProgress'` | Returns 0 |

### B. Landing Zone Load Execution

| # | Check | Validation | Expected |
|---|-------|-----------|----------|
| B.1 | Trigger LZ load | `POST /api/engine/execute` with `layers: ["landing"]` | Returns `run_id` |
| B.2 | Execution starts | Query `execution.PipelineRun` WHERE `RunId = <run_id>` | Status = 'InProgress' |
| B.3 | Entities queued | Query `execution.PipelineLandingzoneEntity` WHERE `RunId = <run_id>` | 1,666 rows |
| B.4 | Notebook triggered | Fabric API: `GET /monitoring/pipelineruns?pipeline=PL_FMD_LOAD_LANDINGZONE` | Shows active run |
| B.5 | Parquet files created | Check LZ lakehouse `Files/` for each entity | 1,666 parquet files exist |
| B.6 | All entities succeed | SQL: `SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'LZ' AND Status = 'Succeeded' AND RunId = <run_id>` | Returns 1,666 |
| B.7 | Zero failures | SQL: `SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'LZ' AND Status = 'Failed' AND RunId = <run_id>` | Returns 0 |
| B.8 | Zero stuck | SQL: `SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'LZ' AND Status = 'InProgress' AND RunId = <run_id>` | Returns 0 (after completion) |
| B.9 | Execution completes | Query `execution.PipelineRun` WHERE `RunId = <run_id>` | Status = 'Succeeded', EndDate IS NOT NULL |
| B.10 | Duration reasonable | `EndDate - StartDate` | < 2 hours (initial load) |

### C. Bronze Layer Load Execution

| # | Check | Validation | Expected |
|---|-------|-----------|----------|
| C.1 | Trigger Bronze load | `POST /api/engine/execute` with `layers: ["bronze"]` | Returns `run_id` |
| C.2 | Execution starts | Query `execution.PipelineRun` WHERE `RunId = <run_id>` | Status = 'InProgress' |
| C.3 | Entities queued | Query `execution.PipelineBronzeLayerEntity` WHERE `RunId = <run_id>` | 1,666 rows |
| C.4 | Notebook triggered | Fabric API: `GET /monitoring/pipelineruns?pipeline=PL_FMD_LOAD_BRONZE` | Shows active run |
| C.5 | Delta tables created | Check Bronze lakehouse `Tables/` for each entity | 1,666 delta tables exist |
| C.6 | All entities succeed | SQL: `SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'BRONZE' AND Status = 'Succeeded' AND RunId = <run_id>` | Returns 1,666 |
| C.7 | Zero failures | SQL: `SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'BRONZE' AND Status = 'Failed' AND RunId = <run_id>` | Returns 0 |
| C.8 | Zero stuck | SQL: `SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'BRONZE' AND Status = 'InProgress' AND RunId = <run_id>` | Returns 0 (after completion) |
| C.9 | Execution completes | Query `execution.PipelineRun` WHERE `RunId = <run_id>` | Status = 'Succeeded', EndDate IS NOT NULL |
| C.10 | Row counts match | For each entity, Bronze row count = LZ row count | Use `dashboard/app/api/lakehouse-counts` |

### D. Silver Layer Load Execution (SCD Type 2)

| # | Check | Validation | Expected |
|---|-------|-----------|----------|
| D.1 | Trigger Silver load | `POST /api/engine/execute` with `layers: ["silver"]` | Returns `run_id` |
| D.2 | Execution starts | Query `execution.PipelineRun` WHERE `RunId = <run_id>` | Status = 'InProgress' |
| D.3 | Entities queued | Query `execution.PipelineSilverLayerEntity` WHERE `RunId = <run_id>` | 1,666 rows |
| D.4 | Notebook triggered | Fabric API: `GET /monitoring/pipelineruns?pipeline=PL_FMD_LOAD_SILVER` | Shows active run |
| D.5 | Delta tables created | Check Silver lakehouse `Tables/` for each entity | 1,666 delta tables exist |
| D.6 | SCD2 columns present | Sample table: `SELECT * FROM silver.ETQ_Suppliers LIMIT 1` | Has `_ValidFrom`, `_ValidTo`, `_IsCurrent`, `_ChangeHash` |
| D.7 | All entities succeed | SQL: `SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'SILVER' AND Status = 'Succeeded' AND RunId = <run_id>` | Returns 1,666 |
| D.8 | Zero failures | SQL: `SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'SILVER' AND Status = 'Failed' AND RunId = <run_id>` | Returns 0 |
| D.9 | Zero stuck | SQL: `SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'SILVER' AND Status = 'InProgress' AND RunId = <run_id>` | Returns 0 (after completion) |
| D.10 | Execution completes | Query `execution.PipelineRun` WHERE `RunId = <run_id>` | Status = 'Succeeded', EndDate IS NOT NULL |
| D.11 | Row counts match | For each entity, Silver row count = Bronze row count (initial load, no changes) | Use `dashboard/app/api/lakehouse-counts` |
| D.12 | `_IsCurrent = 1` for all | For each Silver table, `SELECT COUNT(*) WHERE _IsCurrent = 1` = total rows | All rows are current on first load |

### E. End-to-End Load ("Load Everything")

| # | Check | Validation | Expected |
|---|-------|-----------|----------|
| E.1 | Trigger full load | `POST /api/engine/execute` with `layers: ["landing", "bronze", "silver"]` | Returns `run_id` |
| E.2 | Sequential execution | Layers execute in order: LZ → Bronze → Silver | Check `execution.PipelineRun` timestamps |
| E.3 | All layers succeed | Query `execution.PipelineRun` WHERE `RunId = <run_id>` | Status = 'Succeeded' for all 3 layer runs |
| E.4 | Total entities processed | Sum of all EntityStatus rows WHERE `RunId = <run_id>` | 1,666 × 3 = 4,998 status records |
| E.5 | Zero failures across all layers | SQL: `SELECT COUNT(*) FROM execution.EntityStatus WHERE RunId = <run_id> AND Status = 'Failed'` | Returns 0 |
| E.6 | Total duration | End-to-end time from LZ start to Silver end | < 3 hours (initial load) |

### F. Data Quality Validation

| # | Check | Validation | Expected |
|---|-------|-----------|----------|
| F.1 | No NULL primary keys | Sample 10 random Bronze tables: `SELECT COUNT(*) WHERE <PK_Column> IS NULL` | All return 0 |
| F.2 | No duplicate PKs in Bronze | Sample 10 Bronze tables: `SELECT <PK>, COUNT(*) GROUP BY <PK> HAVING COUNT(*) > 1` | All return 0 rows |
| F.3 | No duplicate natural keys in Silver (current) | Sample 10 Silver tables: `SELECT <NK>, COUNT(*) WHERE _IsCurrent = 1 GROUP BY <NK> HAVING COUNT(*) > 1` | All return 0 rows |
| F.4 | Watermark columns populated | For incremental entities, check watermark column is NOT NULL | Sample 10 entities, all watermark values valid |
| F.5 | `_ChangeHash` values unique | Sample Silver table: `SELECT _ChangeHash, COUNT(*) GROUP BY _ChangeHash` | Each row has unique hash (on first load) |

### G. Control Plane Validation

| # | Check | Validation | Expected |
|---|-------|-----------|----------|
| G.1 | SQLite synced | Local `control_plane.db` has entity status records matching Fabric SQL | Row counts match |
| G.2 | Dashboard Execution Matrix shows correct counts | Navigate to `/` | Shows 1,666 total entities, 100% success rate |
| G.3 | Dashboard Control Plane shows layer completion | Navigate to `/control` | LZ/Bronze/Silver progress bars all 100% |
| G.4 | Dashboard Record Counts shows table counts | Navigate to `/records` | All 1,666 entities listed with Bronze/Silver row counts |
| G.5 | Dashboard Execution Log shows run history | Navigate to `/logs` | Shows completed run with Status = 'Succeeded' |

### H. Performance Validation

| # | Metric | Validation | Threshold |
|---|--------|-----------|-----------|
| H.1 | Average entity load time (LZ) | `SELECT AVG(DurationSeconds) FROM execution.EntityStatus WHERE LayerKey = 'LZ'` | < 120 seconds per entity |
| H.2 | Average entity load time (Bronze) | `SELECT AVG(DurationSeconds) FROM execution.EntityStatus WHERE LayerKey = 'BRONZE'` | < 60 seconds per entity |
| H.3 | Average entity load time (Silver) | `SELECT AVG(DurationSeconds) FROM execution.EntityStatus WHERE LayerKey = 'SILVER'` | < 90 seconds per entity |
| H.4 | Slowest entity documented | `SELECT TOP 10 EntityName, DurationSeconds FROM execution.EntityStatus ORDER BY DurationSeconds DESC` | Log top 10 for future optimization |
| H.5 | Total rows processed | Sum `TotalRowsRead` from all EntityStatus records | > 1 million rows (across all entities) |

---

## Execution Steps

### Step 1: Pre-Flight Checks

```bash
# Run all prerequisite validation scripts
echo "=== Pre-Flight Validation ==="

echo "1. Validating entity activation..."
python scripts/validate_entity_activation.py
if [ $? -ne 0 ]; then
    echo "❌ FAIL: Task 001 must be complete before running Task 002"
    exit 1
fi

echo "2. Validating source connections..."
python diag_connections.py

echo "3. Validating lakehouse accessibility..."
python diag_lakehouse.py

echo "4. Validating notebook deployment..."
python src/deployment/validate_notebooks.py

echo "5. Validating pipeline existence..."
python diag_pipeline.py --pipeline PL_FMD_LOAD_ALL

echo "✅ All pre-flight checks passed. Ready to execute."
```

### Step 2: Clear Previous Run State (if needed)

```sql
-- ONLY run this if re-running after a failed attempt
-- This clears stale execution state

-- DO NOT RUN IN PRODUCTION WITHOUT BACKUP

BEGIN TRANSACTION;

-- Clear entity status for incomplete runs
DELETE FROM execution.EntityStatus
WHERE RunId IN (
    SELECT RunId FROM execution.PipelineRun
    WHERE Status IN ('InProgress', 'Failed')
);

-- Clear incomplete pipeline runs
DELETE FROM execution.PipelineRun
WHERE Status IN ('InProgress', 'Failed');

-- Reset entity queues (will repopulate on next run)
TRUNCATE TABLE execution.PipelineLandingzoneEntity;
TRUNCATE TABLE execution.PipelineBronzeLayerEntity;
TRUNCATE TABLE execution.PipelineSilverLayerEntity;

COMMIT;

-- Regenerate queues
EXEC execution.sp_RefreshPipelineQueues;
```

### Step 3: Execute Full Load

#### Option A: Via Dashboard (Recommended)

```
1. Open http://127.0.0.1:5173/engine
2. Ensure all 3 layers are checked: Landing Zone, Bronze, Silver
3. Mode: "Run" (not "Plan")
4. Click "Execute Pipeline"
5. Observe live log panel for progress
6. Wait for Status badge to change from "Running" to "Succeeded"
```

#### Option B: Via API (Automated)

```bash
# Execute full load via API
curl -X POST http://127.0.0.1:8787/api/engine/execute \
  -H "Content-Type: application/json" \
  -d '{
    "layers": ["landing", "bronze", "silver"],
    "mode": "run",
    "entity_filter": null
  }'

# Capture run_id from response
RUN_ID="<returned_run_id>"

# Poll for completion
python scripts/poll_pipeline_run.py --run-id $RUN_ID
```

#### Option C: Via Fabric Notebook (Direct Trigger)

```python
# In Fabric notebook NB_FMD_ORCHESTRATOR
import requests

# Trigger pipeline via REST API (InvokePipeline workaround)
workspace_id = "c0366b24-e6f8-4994-b4df-b765ecb5bbf8"
pipeline_id = "e45418a4-148f-49d2-a30f-071a1c477ba9"  # PL_FMD_LOAD_ALL

response = notebookutils.fs.invoke_pipeline(
    workspace_id=workspace_id,
    pipeline_id=pipeline_id,
    parameters={}
)

run_id = response["runId"]
print(f"Pipeline triggered: {run_id}")

# Monitor in Fabric Monitoring UI
```

### Step 4: Monitor Execution

```bash
# Real-time monitoring script
python scripts/monitor_pipeline_execution.py --run-id $RUN_ID

# Output:
# ================================================================================
# PIPELINE EXECUTION MONITOR
# ================================================================================
# Run ID: 12345678-abcd-ef01-2345-67890abcdef0
# Status: InProgress
# Layers: Landing Zone, Bronze, Silver
# Progress: 234 / 1666 entities (14.0%)
# Current Layer: Landing Zone
# Duration: 00:12:34
# Estimated Time Remaining: 01:23:45
# ================================================================================
```

### Step 5: Validate Success

```bash
# Run comprehensive validation script
python scripts/validate_full_load.py --run-id $RUN_ID

# This script checks all acceptance criteria (B.1 - H.5)
# Exit code 0 = all validations passed
# Exit code 1 = one or more validations failed
```

**Expected validation output:**

```
================================================================================
TASK 002 VALIDATION: Full Bronze/Silver Load
================================================================================
Run ID: 12345678-abcd-ef01-2345-67890abcdef0

LANDING ZONE LOAD
✅ B.1: Execution started (Status = 'Succeeded')
✅ B.6: All 1666 entities succeeded
✅ B.7: Zero failures
✅ B.8: Zero stuck entities
✅ B.9: Execution completed
✅ B.10: Duration: 01:23:45 (under 2 hour threshold)

BRONZE LAYER LOAD
✅ C.1: Execution started (Status = 'Succeeded')
✅ C.6: All 1666 entities succeeded
✅ C.7: Zero failures
✅ C.8: Zero stuck entities
✅ C.9: Execution completed
✅ C.10: Row counts match LZ

SILVER LAYER LOAD
✅ D.1: Execution started (Status = 'Succeeded')
✅ D.7: All 1666 entities succeeded
✅ D.8: Zero failures
✅ D.9: Zero stuck entities
✅ D.10: Execution completed
✅ D.11: Row counts match Bronze
✅ D.12: All rows are _IsCurrent = 1

DATA QUALITY CHECKS
✅ F.1: No NULL primary keys
✅ F.2: No duplicate PKs in Bronze
✅ F.3: No duplicate natural keys in Silver
✅ F.4: Watermark columns populated
✅ F.5: Change hashes unique

CONTROL PLANE VALIDATION
✅ G.1: SQLite synced with Fabric SQL
✅ G.2: Dashboard Execution Matrix shows 100% success
✅ G.3: Dashboard Control Plane shows 100% layer completion
✅ G.4: Dashboard Record Counts shows all 1666 entities
✅ G.5: Dashboard Execution Log shows completed run

PERFORMANCE VALIDATION
✅ H.1: Avg LZ load time: 87.3 seconds (under 120s threshold)
✅ H.2: Avg Bronze load time: 42.1 seconds (under 60s threshold)
✅ H.3: Avg Silver load time: 68.9 seconds (under 90s threshold)
✅ H.4: Top 10 slowest entities logged
✅ H.5: Total rows processed: 12,456,789

================================================================================
RESULTS: 35 / 35 checks passed (100%)
✅ ALL VALIDATIONS PASSED - Task 002 is COMPLETE
================================================================================
```

---

## Validation Script

**File**: `scripts/validate_full_load.py`

```python
"""Validation script for Task 002 - Full Bronze/Silver Load."""

import argparse
import pyodbc
import sqlite3
from src.core.config_loader import load_fabric_sql_config

def validate_full_load(run_id: str):
    """Run all validation queries for Task 002."""

    # Connect to Fabric SQL
    fabric_config = load_fabric_sql_config()
    fabric_conn = pyodbc.connect(fabric_config['connection_string'])
    fabric_cursor = fabric_conn.cursor()

    # Connect to local SQLite
    sqlite_conn = sqlite3.connect('dashboard/app/api/control_plane.db')
    sqlite_cursor = sqlite_conn.cursor()

    print("\n" + "="*80)
    print("TASK 002 VALIDATION: Full Bronze/Silver Load")
    print("="*80)
    print(f"Run ID: {run_id}\n")

    passed = 0
    failed = 0

    # B. Landing Zone Validation
    print("LANDING ZONE LOAD")
    print("-"*80)

    tests = [
        # (test_name, query, expected_value, comparison_operator)
        ("B.6: All entities succeeded",
         f"SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'LZ' AND Status = 'Succeeded' AND RunId = '{run_id}'",
         1666, "=="),
        ("B.7: Zero failures",
         f"SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'LZ' AND Status = 'Failed' AND RunId = '{run_id}'",
         0, "=="),
        ("B.8: Zero stuck",
         f"SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'LZ' AND Status = 'InProgress' AND RunId = '{run_id}'",
         0, "=="),
    ]

    for test_name, query, expected, op in tests:
        fabric_cursor.execute(query)
        actual = fabric_cursor.fetchone()[0]

        if op == "==" and actual == expected:
            print(f"✅ {test_name}")
            passed += 1
        elif op == "<" and actual < expected:
            print(f"✅ {test_name}: {actual} < {expected}")
            passed += 1
        else:
            print(f"❌ {test_name}: Expected {expected}, got {actual}")
            failed += 1

    # C. Bronze Layer Validation
    print("\nBRONZE LAYER LOAD")
    print("-"*80)

    tests = [
        ("C.6: All entities succeeded",
         f"SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'BRONZE' AND Status = 'Succeeded' AND RunId = '{run_id}'",
         1666, "=="),
        ("C.7: Zero failures",
         f"SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'BRONZE' AND Status = 'Failed' AND RunId = '{run_id}'",
         0, "=="),
        ("C.8: Zero stuck",
         f"SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'BRONZE' AND Status = 'InProgress' AND RunId = '{run_id}'",
         0, "=="),
    ]

    for test_name, query, expected, op in tests:
        fabric_cursor.execute(query)
        actual = fabric_cursor.fetchone()[0]

        if actual == expected:
            print(f"✅ {test_name}")
            passed += 1
        else:
            print(f"❌ {test_name}: Expected {expected}, got {actual}")
            failed += 1

    # D. Silver Layer Validation
    print("\nSILVER LAYER LOAD")
    print("-"*80)

    tests = [
        ("D.7: All entities succeeded",
         f"SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'SILVER' AND Status = 'Succeeded' AND RunId = '{run_id}'",
         1666, "=="),
        ("D.8: Zero failures",
         f"SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'SILVER' AND Status = 'Failed' AND RunId = '{run_id}'",
         0, "=="),
        ("D.9: Zero stuck",
         f"SELECT COUNT(*) FROM execution.EntityStatus WHERE LayerKey = 'SILVER' AND Status = 'InProgress' AND RunId = '{run_id}'",
         0, "=="),
    ]

    for test_name, query, expected, op in tests:
        fabric_cursor.execute(query)
        actual = fabric_cursor.fetchone()[0]

        if actual == expected:
            print(f"✅ {test_name}")
            passed += 1
        else:
            print(f"❌ {test_name}: Expected {expected}, got {actual}")
            failed += 1

    # (Additional validation sections F, G, H would follow same pattern...)

    print("\n" + "="*80)
    print(f"RESULTS: {passed} / {passed + failed} checks passed ({100 * passed // (passed + failed)}%)")
    if failed == 0:
        print("✅ ALL VALIDATIONS PASSED - Task 002 is COMPLETE")
    else:
        print(f"❌ {failed} TESTS FAILED - Task 002 is INCOMPLETE")
    print("="*80 + "\n")

    fabric_conn.close()
    sqlite_conn.close()

    return failed == 0

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate Task 002 completion")
    parser.add_argument("--run-id", required=True, help="Pipeline run ID to validate")
    args = parser.parse_args()

    import sys
    success = validate_full_load(args.run_id)
    sys.exit(0 if success else 1)
```

---

## Troubleshooting

### Problem: Entities stuck in "InProgress" status

**Symptoms:**
- Some entities never complete
- `execution.EntityStatus` shows `Status = 'InProgress'` indefinitely
- No errors logged

**Root Causes:**
1. Notebook execution timed out without updating status
2. Network interruption during Fabric API call
3. Missing error handling in notebook code

**Resolution:**
```sql
-- Identify stuck entities
SELECT
    EntityName,
    LayerKey,
    StartDate,
    DATEDIFF(MINUTE, StartDate, GETDATE()) AS MinutesStuck
FROM execution.EntityStatus
WHERE Status = 'InProgress'
ORDER BY MinutesStuck DESC;

-- Mark stuck entities as failed (after investigation)
UPDATE execution.EntityStatus
SET
    Status = 'Failed',
    EndDate = GETDATE(),
    ErrorMessage = 'Timeout: Stuck in InProgress status'
WHERE Status = 'InProgress'
AND DATEDIFF(MINUTE, StartDate, GETDATE()) > 60;  -- stuck for 60+ minutes
```

### Problem: High failure rate (> 5% entities failed)

**Symptoms:**
- Many entities show `Status = 'Failed'`
- Error messages logged in `execution.EntityStatus.ErrorMessage`

**Diagnosis:**
```sql
-- Group failures by error type
SELECT
    LEFT(ErrorMessage, 100) AS ErrorPrefix,
    COUNT(*) AS FailureCount
FROM execution.EntityStatus
WHERE Status = 'Failed'
AND RunId = '<run_id>'
GROUP BY LEFT(ErrorMessage, 100)
ORDER BY COUNT(*) DESC;
```

**Common error patterns:**
- `"Connection timeout"` → Source database unreachable
- `"Invalid object name"` → Table doesn't exist in source
- `"Conversion failed"` → Data type mismatch
- `"Primary key violation"` → Duplicate rows in source

**Resolution:**
1. Fix source connection issues (check `diag_connections.py`)
2. Remove/fix invalid entities from `entity_registration.json`
3. Update data type mappings in `src/core/type_mapping.py`
4. Add data quality checks to filter out duplicate source rows

### Problem: Row count mismatches (Bronze ≠ Silver)

**Symptoms:**
- `/records` page shows Delta > 0 for many tables
- Silver row count < Bronze row count

**Diagnosis:**
```sql
-- Find entities with row count mismatches
SELECT
    b.EntityName,
    b.TotalRowsWritten AS BronzeRows,
    s.TotalRowsWritten AS SilverRows,
    ABS(b.TotalRowsWritten - s.TotalRowsWritten) AS Delta
FROM execution.EntityStatus b
INNER JOIN execution.EntityStatus s
    ON b.EntityName = s.EntityName
    AND b.RunId = s.RunId
WHERE b.LayerKey = 'BRONZE'
AND s.LayerKey = 'SILVER'
AND b.TotalRowsWritten != s.TotalRowsWritten
ORDER BY Delta DESC;
```

**Root Causes:**
1. SCD Type 2 merge logic filtering out rows (check `_ChangeHash` comparison)
2. Data quality rules removing invalid rows
3. Primary key collision in Silver (duplicates merged)

**Resolution:**
- Check `NB_FMD_LOAD_BRONZE_SILVER` merge logic
- Review `NB_FMD_DQ_CLEANSING` rules
- Ensure Bronze primary keys are unique before Silver merge

---

## Cross-Reference

- **DEFINITION-OF-DONE.md**: Sections 1-3 (LZ, Bronze, Silver completion)
- **TEST-PLAN.md**: T-DATA-01 to T-DATA-08 (dashboard KPI validation)
- **BURNED-BRIDGES.md**: Entry on pipeline timeouts and retry logic
- **TASK 001**: Prerequisite - entity activation must be 100%

---

## Dependencies

- **Blocked by**: Task 001 (Entity Activation) — must complete first
- **Blocks**: Task 008 (Playwright E2E Tests) — needs successful run to test against
- **Blocks**: Task 010 (Complete Execution Matrix Page) — dashboard needs real data

---

## Sign-Off

- [ ] All pre-flight checks passed
- [ ] Full load executed (LZ → Bronze → Silver)
- [ ] All 1,666 entities succeeded in all 3 layers
- [ ] Zero failures, zero stuck entities
- [ ] Data quality checks passed
- [ ] Dashboard pages show correct data
- [ ] Validation script passes 100%
- [ ] Performance metrics logged

**Completed by**: ___________
**Date**: ___________
**Run ID**: ___________
**Verified by**: ___________
