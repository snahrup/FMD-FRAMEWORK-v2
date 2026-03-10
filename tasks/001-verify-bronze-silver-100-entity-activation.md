# TASK 001: Verify Bronze/Silver 100% Entity Activation

> **Authority**: Steve Nahrup
> **Created**: 2026-03-09
> **Category**: bug_fix
> **Complexity**: medium
> **Impact**: critical
> **Agent**: database-engineer, backend-architect

---

## Problem Statement

The **activation bug** causes Bronze and Silver entities to be registered with `IsActive = 0` instead of `IsActive = 1`, preventing them from appearing in pipeline queues. This is a **deployment blocker** — pipelines can't execute if entities aren't active.

### Current Behavior (BROKEN)

1. `sp_UpsertPipelineLandingzoneEntity` creates LZ entities with `IsActive = 0`
2. `sp_UpsertPipelineBronzeLayerEntity` creates Bronze entities with `IsActive = 0`
3. `execution.PipelineBronzeLayerEntity` queue is empty or missing entities
4. `execution.PipelineSilverLayerEntity` queue is empty or missing entities
5. Engine execution skips inactive entities

### Target Behavior (FIXED)

1. `sp_UpsertPipelineLandingzoneEntity` defaults `IsActive = 1` on INSERT
2. `sp_UpsertPipelineBronzeLayerEntity` defaults `IsActive = 1` on INSERT
3. All 1,666 entities are `IsActive = 1` across all layers
4. Pipeline queues are fully populated (1,666 rows per layer)
5. Engine executes all entities

---

## Scope

### In Scope

- [x] Fix `sp_UpsertPipelineLandingzoneEntity` stored procedure (default `IsActive = 1`)
- [x] Fix `sp_UpsertPipelineBronzeLayerEntity` stored procedure (default `IsActive = 1`)
- [ ] Update all existing inactive entities to `IsActive = 1`
- [ ] Verify 1,666 entities per layer are active
- [ ] Verify pipeline queues are fully populated
- [ ] Add SQL validation queries to confirm fix

### Out of Scope

- Silver stored procedure (not affected by this bug)
- Gold layer entities (not yet implemented)
- Entity archival/deactivation workflow (different feature)

---

## Acceptance Criteria (Binary Checklist)

### A. Stored Procedure Fixes

| # | Criterion | Validation Query |
|---|-----------|-----------------|
| A.1 | `sp_UpsertPipelineLandingzoneEntity` has `IsActive` default value `1` in INSERT clause | Inspect stored procedure body |
| A.2 | `sp_UpsertPipelineBronzeLayerEntity` has `IsActive` default value `1` in INSERT clause | Inspect stored procedure body |
| A.3 | Both procedures preserve existing `IsActive` value on UPDATE (don't overwrite) | Test upsert behavior |
| A.4 | Both procedures accept `@IsActive` parameter override (default 1, but caller can set 0) | Test parameter passing |

### B. Entity Activation Validation

| # | Criterion | Validation Query |
|---|-----------|-----------------|
| B.1 | All LZ entities are active | `SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE IsActive = 1` = 1,666 |
| B.2 | All Bronze entities are active | `SELECT COUNT(*) FROM integration.PipelineBronzeLayerEntity WHERE IsActive = 1` = 1,666 |
| B.3 | All Silver entities are active | `SELECT COUNT(*) FROM integration.PipelineSilverLayerEntity WHERE IsActive = 1` = 1,666 |
| B.4 | NO entities are inactive | `SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE IsActive = 0` = 0 |
| B.5 | NO entities are inactive | `SELECT COUNT(*) FROM integration.PipelineBronzeLayerEntity WHERE IsActive = 0` = 0 |
| B.6 | NO entities are inactive | `SELECT COUNT(*) FROM integration.PipelineSilverLayerEntity WHERE IsActive = 0` = 0 |

### C. Pipeline Queue Validation

| # | Criterion | Validation Query |
|---|-----------|-----------------|
| C.1 | LZ queue fully populated | `SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity` = 1,666 |
| C.2 | Bronze queue fully populated | `SELECT COUNT(*) FROM execution.PipelineBronzeLayerEntity` = 1,666 |
| C.3 | Silver queue fully populated | `SELECT COUNT(*) FROM execution.PipelineSilverLayerEntity` = 1,666 |
| C.4 | LZ queue joins to active entities | `SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity q INNER JOIN integration.PipelineLandingzoneEntity e ON q.LandingzoneEntityId = e.LandingzoneEntityId WHERE e.IsActive = 1` = 1,666 |
| C.5 | Bronze queue joins to active entities | `SELECT COUNT(*) FROM execution.PipelineBronzeLayerEntity q INNER JOIN integration.PipelineBronzeLayerEntity e ON q.BronzeLayerEntityId = e.BronzeLayerEntityId WHERE e.IsActive = 1` = 1,666 |
| C.6 | Silver queue joins to active entities | `SELECT COUNT(*) FROM execution.PipelineSilverLayerEntity q INNER JOIN integration.PipelineSilverLayerEntity e ON q.SilverLayerEntityId = e.SilverLayerEntityId WHERE e.IsActive = 1` = 1,666 |

### D. Source Breakdown (must match expected)

| # | Source | Expected Count | Validation Query |
|---|--------|---------------|-----------------|
| D.1 | ETQ | 29 | `SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE DataSourceKey = 'ETQ' AND IsActive = 1` = 29 |
| D.2 | MES | 445 | `SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE DataSourceKey = 'MES' AND IsActive = 1` = 445 |
| D.3 | M3 ERP | 596 | `SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE DataSourceKey = 'M3' AND IsActive = 1` = 596 |
| D.4 | M3 Cloud | 187 | `SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE DataSourceKey = 'M3C' AND IsActive = 1` = 187 |
| D.5 | OPTIVA | 409 | `SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE DataSourceKey = 'OPTIVA' AND IsActive = 1` = 409 |
| D.6 | TOTAL | 1,666 | Sum of above = 1,666 |

---

## Implementation Steps

### Step 1: Backup Current State

```sql
-- Backup stored procedures before modifications
SELECT OBJECT_DEFINITION(OBJECT_ID('integration.sp_UpsertPipelineLandingzoneEntity'));
SELECT OBJECT_DEFINITION(OBJECT_ID('integration.sp_UpsertPipelineBronzeLayerEntity'));

-- Snapshot current IsActive state
SELECT
    'Landing Zone' AS Layer,
    COUNT(*) AS Total,
    SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS Active,
    SUM(CASE WHEN IsActive = 0 THEN 1 ELSE 0 END) AS Inactive
FROM integration.PipelineLandingzoneEntity
UNION ALL
SELECT
    'Bronze' AS Layer,
    COUNT(*) AS Total,
    SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS Active,
    SUM(CASE WHEN IsActive = 0 THEN 1 ELSE 0 END) AS Inactive
FROM integration.PipelineBronzeLayerEntity
UNION ALL
SELECT
    'Silver' AS Layer,
    COUNT(*) AS Total,
    SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS Active,
    SUM(CASE WHEN IsActive = 0 THEN 1 ELSE 0 END) AS Inactive
FROM integration.PipelineSilverLayerEntity;
```

### Step 2: Fix Stored Procedures

**File**: `setup/stored_procedures/sp_UpsertPipelineLandingzoneEntity.sql`

Find the INSERT statement and ensure `IsActive` column is set to `1`:

```sql
-- BEFORE (BROKEN)
INSERT INTO integration.PipelineLandingzoneEntity (
    LandingZoneKey,
    TableName,
    ...
    IsActive  -- Defaults to 0 or NULL
)
VALUES (
    @LandingZoneKey,
    @TableName,
    ...
    ISNULL(@IsActive, 0)  -- BAD: defaults to 0
);

-- AFTER (FIXED)
INSERT INTO integration.PipelineLandingzoneEntity (
    LandingZoneKey,
    TableName,
    ...
    IsActive  -- Defaults to 1
)
VALUES (
    @LandingZoneKey,
    @TableName,
    ...
    ISNULL(@IsActive, 1)  -- GOOD: defaults to 1
);
```

**File**: `setup/stored_procedures/sp_UpsertPipelineBronzeLayerEntity.sql`

Same fix for Bronze:

```sql
-- BEFORE (BROKEN)
ISNULL(@IsActive, 0)  -- BAD

-- AFTER (FIXED)
ISNULL(@IsActive, 1)  -- GOOD
```

### Step 3: Deploy Fixed Stored Procedures

```bash
# Deploy to Fabric SQL
python src/deployment/deploy_stored_procedures.py

# Verify deployment
# Should show new modification date
SELECT
    name,
    create_date,
    modify_date
FROM sys.objects
WHERE name IN (
    'sp_UpsertPipelineLandingzoneEntity',
    'sp_UpsertPipelineBronzeLayerEntity'
);
```

### Step 4: Activate All Existing Entities

```sql
-- Update all inactive entities to active
-- BACKUP FIRST!
BEGIN TRANSACTION;

UPDATE integration.PipelineLandingzoneEntity
SET IsActive = 1
WHERE IsActive = 0;

UPDATE integration.PipelineBronzeLayerEntity
SET IsActive = 1
WHERE IsActive = 0;

UPDATE integration.PipelineSilverLayerEntity
SET IsActive = 1
WHERE IsActive = 0;

-- Verify counts before committing
SELECT
    'LZ' AS Layer,
    COUNT(*) AS Active
FROM integration.PipelineLandingzoneEntity
WHERE IsActive = 1
UNION ALL
SELECT
    'Bronze' AS Layer,
    COUNT(*) AS Active
FROM integration.PipelineBronzeLayerEntity
WHERE IsActive = 1
UNION ALL
SELECT
    'Silver' AS Layer,
    COUNT(*) AS Active
FROM integration.PipelineSilverLayerEntity
WHERE IsActive = 1;

-- If all 3 show 1666, commit
COMMIT;
-- If not, ROLLBACK and investigate
```

### Step 5: Verify Pipeline Queues

```sql
-- Regenerate pipeline queues
EXEC execution.sp_RefreshPipelineQueues;

-- Verify all queues are fully populated
SELECT
    'LZ Queue' AS Queue,
    COUNT(*) AS Count
FROM execution.PipelineLandingzoneEntity
UNION ALL
SELECT
    'Bronze Queue' AS Queue,
    COUNT(*) AS Count
FROM execution.PipelineBronzeLayerEntity
UNION ALL
SELECT
    'Silver Queue' AS Queue,
    COUNT(*) AS Count
FROM execution.PipelineSilverLayerEntity;

-- All 3 should show 1666
```

---

## Validation Script

**File**: `scripts/validate_entity_activation.py`

```python
"""Validation script for Task 001 - Verify 100% entity activation."""

import pyodbc
from src.core.config_loader import load_fabric_sql_config

def validate_entity_activation():
    """Run all validation queries and report pass/fail."""

    config = load_fabric_sql_config()
    conn = pyodbc.connect(config['connection_string'])
    cursor = conn.cursor()

    results = {}

    # A. Count active entities per layer
    tests = [
        ("A.1 - LZ Active", "SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE IsActive = 1", 1666),
        ("A.2 - Bronze Active", "SELECT COUNT(*) FROM integration.PipelineBronzeLayerEntity WHERE IsActive = 1", 1666),
        ("A.3 - Silver Active", "SELECT COUNT(*) FROM integration.PipelineSilverLayerEntity WHERE IsActive = 1", 1666),
        ("B.1 - LZ Inactive", "SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE IsActive = 0", 0),
        ("B.2 - Bronze Inactive", "SELECT COUNT(*) FROM integration.PipelineBronzeLayerEntity WHERE IsActive = 0", 0),
        ("B.3 - Silver Inactive", "SELECT COUNT(*) FROM integration.PipelineSilverLayerEntity WHERE IsActive = 0", 0),
        ("C.1 - LZ Queue", "SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity", 1666),
        ("C.2 - Bronze Queue", "SELECT COUNT(*) FROM execution.PipelineBronzeLayerEntity", 1666),
        ("C.3 - Silver Queue", "SELECT COUNT(*) FROM execution.PipelineSilverLayerEntity", 1666),
    ]

    print("\n" + "="*80)
    print("TASK 001 VALIDATION: Entity Activation")
    print("="*80 + "\n")

    passed = 0
    failed = 0

    for test_name, query, expected in tests:
        cursor.execute(query)
        actual = cursor.fetchone()[0]
        status = "✅ PASS" if actual == expected else "❌ FAIL"

        if actual == expected:
            passed += 1
        else:
            failed += 1

        print(f"{status} | {test_name}")
        print(f"       Expected: {expected}, Actual: {actual}")
        if actual != expected:
            print(f"       ⚠️  MISMATCH: Off by {abs(actual - expected)}")
        print()

    # Source breakdown
    print("\n" + "-"*80)
    print("SOURCE BREAKDOWN VALIDATION")
    print("-"*80 + "\n")

    source_tests = [
        ("ETQ", 29),
        ("MES", 445),
        ("M3", 596),
        ("M3C", 187),
        ("OPTIVA", 409),
    ]

    for source_key, expected_count in source_tests:
        query = f"SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE DataSourceKey = '{source_key}' AND IsActive = 1"
        cursor.execute(query)
        actual_count = cursor.fetchone()[0]
        status = "✅ PASS" if actual_count == expected_count else "❌ FAIL"

        if actual_count == expected_count:
            passed += 1
        else:
            failed += 1

        print(f"{status} | {source_key:<10} Expected: {expected_count:>4}, Actual: {actual_count:>4}")

    print("\n" + "="*80)
    print(f"RESULTS: {passed} passed, {failed} failed")
    if failed == 0:
        print("✅ ALL TESTS PASSED - Task 001 is COMPLETE")
    else:
        print("❌ TESTS FAILED - Task 001 is INCOMPLETE")
    print("="*80 + "\n")

    conn.close()

    return failed == 0

if __name__ == "__main__":
    import sys
    success = validate_entity_activation()
    sys.exit(0 if success else 1)
```

**Run validation:**

```bash
python scripts/validate_entity_activation.py
```

Expected output:

```
================================================================================
TASK 001 VALIDATION: Entity Activation
================================================================================

✅ PASS | A.1 - LZ Active
       Expected: 1666, Actual: 1666

✅ PASS | A.2 - Bronze Active
       Expected: 1666, Actual: 1666

✅ PASS | A.3 - Silver Active
       Expected: 1666, Actual: 1666

✅ PASS | B.1 - LZ Inactive
       Expected: 0, Actual: 0

✅ PASS | B.2 - Bronze Inactive
       Expected: 0, Actual: 0

✅ PASS | B.3 - Silver Inactive
       Expected: 0, Actual: 0

✅ PASS | C.1 - LZ Queue
       Expected: 1666, Actual: 1666

✅ PASS | C.2 - Bronze Queue
       Expected: 1666, Actual: 1666

✅ PASS | C.3 - Silver Queue
       Expected: 1666, Actual: 1666

--------------------------------------------------------------------------------
SOURCE BREAKDOWN VALIDATION
--------------------------------------------------------------------------------

✅ PASS | ETQ        Expected:   29, Actual:   29
✅ PASS | MES        Expected:  445, Actual:  445
✅ PASS | M3         Expected:  596, Actual:  596
✅ PASS | M3C        Expected:  187, Actual:  187
✅ PASS | OPTIVA     Expected:  409, Actual:  409

================================================================================
RESULTS: 14 passed, 0 failed
✅ ALL TESTS PASSED - Task 001 is COMPLETE
================================================================================
```

---

## Cross-Reference

- **DEFINITION-OF-DONE.md**: Section 2 (Bronze Layer), Section 3 (Silver Layer), item 2.4 (activation bug fix)
- **TEST-PLAN.md**: T-DATA-06 (entity counts), T-DATA-07 (layer completion)
- **BURNED-BRIDGES.md**: Entry on IsActive=0 bug causing empty pipeline queues

---

## Dependencies

- **Blocks**: Task 002 (Execute Full Bronze/Silver Load) — can't run pipeline with inactive entities
- **Blocks**: Task 010 (Complete Execution Matrix Page) — dashboard needs accurate entity counts
- **Blocked by**: None (this is a foundational fix)

---

## Rollback Plan

If the fix causes issues:

```sql
-- Rollback stored procedures (redeploy old version from git history)
-- Rollback entity activation
UPDATE integration.PipelineLandingzoneEntity SET IsActive = 0;
UPDATE integration.PipelineBronzeLayerEntity SET IsActive = 0;
UPDATE integration.PipelineSilverLayerEntity SET IsActive = 0;
```

---

## Sign-Off

- [ ] All stored procedures fixed and deployed
- [ ] All 1,666 entities active across all layers
- [ ] All pipeline queues fully populated
- [ ] Validation script passes 100%
- [ ] Tested end-to-end pipeline execution with active entities

**Completed by**: ___________
**Date**: ___________
**Verified by**: ___________
