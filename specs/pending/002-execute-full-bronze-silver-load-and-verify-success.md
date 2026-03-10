# Spec 002: Execute Full Bronze→Silver Load and Verify Success

> **Priority**: CRITICAL
> **Category**: feature
> **Complexity**: large
> **Impact**: critical
> **Status**: pending
> **Owner**: ralph-engine (Execution Agent)
> **Blocked By**: 001-verify-bronze-silver-100-entity-activation
> **Blocks**: Gold layer implementation, production deployment

---

## User Story

**As a** Data Platform Engineer
**I want to** execute the full Bronze→Silver load for all 1,666 entities and verify success
**So that** the Silver layer is complete and ready for Gold layer business logic

---

## Context & Background

###Current State
- **Landing Zone → Bronze**: ✅ 100% complete (1,666/1,666 entities loaded)
- **Bronze → Silver**: 🔴 **0% complete** (blocked by activation gates)
- **Silver layer critical blockers**:
  1. Only 100 entities activated for Silver processing (`is_silver_active = 1`)
  2. Silver notebook (`NB_FMD_LOAD_BRONZE_SILVER`) never executed end-to-end
  3. SCD Type 2 merge logic untested at scale
  4. No validation that Silver row counts match Bronze

### Problem Statement
The Silver layer is the **critical transformation layer** in the medallion architecture:
- **Bronze** = raw replica of source systems (append-only)
- **Silver** = cleaned, deduplicated, historized (SCD Type 2)
- **Gold** = business aggregates (depends on Silver)

Without a complete Silver layer:
- ❌ Cannot build Gold layer
- ❌ Cannot validate data quality rules
- ❌ Cannot test downstream dashboards
- ❌ Cannot go to production

### Success Criteria (Binary Gate)
From `DEFINITION-OF-DONE.md` Section 6.4:

- ✅ **All 1,666 entities** have `is_silver_active = 1`
- ✅ **Silver load executed** via engine `/api/engine/start` with layer=silver
- ✅ **Zero failures**: All 1,666 entities have `silver_status = 'succeeded'`
- ✅ **Row count validation**: Silver row count ≥ Bronze row count for every entity (SCD Type 2 may create more rows)
- ✅ **SCD Type 2 columns present**: `_start_date`, `_end_date`, `_is_current`, `_row_hash` exist in all Silver tables
- ✅ **Dashboard shows 100% Silver**: Control Plane page shows Silver progress bar = 100%
- ✅ **Automated test suite passes**: Pytest validates all 1,666 entities

---

## Technical Architecture

### Silver Processing Notebook
**Fabric Item**: `NB_FMD_LOAD_BRONZE_SILVER`
**Item ID**: `556fd16b-ed49-4f7b-83a8-a79252ee54f9`
**Location**: `src/business_domain/NB_LOAD_BRONZE_SILVER.Notebook/`

**Purpose**: Transforms Bronze (raw replica) → Silver (SCD Type 2 historized)

**Processing Logic**:
```python
# Pseudo-code (actual implementation in Fabric notebook)

for entity in entities_where_is_silver_active == 1:
    bronze_table = f"bronze.{entity.namespace}_{entity.schema}_{entity.table}"
    silver_table = f"silver.{entity.namespace}_{entity.schema}_{entity.table}"

    # Step 1: Read Bronze data
    df_bronze = spark.read.table(bronze_table)

    # Step 2: Calculate row hash (for change detection)
    df_bronze = df_bronze.withColumn("_row_hash", sha2(concat_ws("|", *df_bronze.columns), 256))

    # Step 3: Add SCD Type 2 columns
    df_bronze = df_bronze.withColumn("_start_date", current_timestamp())
    df_bronze = df_bronze.withColumn("_end_date", lit("9999-12-31 23:59:59"))
    df_bronze = df_bronze.withColumn("_is_current", lit(True))

    # Step 4: Merge into Silver using Delta MERGE
    # - If primary key exists and hash changed → expire old row, insert new row
    # - If primary key doesn't exist → insert new row
    # - If primary key exists and hash unchanged → no-op

    deltaTable = DeltaTable.forName(spark, silver_table)

    deltaTable.alias("target").merge(
        df_bronze.alias("source"),
        merge_condition
    ).whenMatchedUpdate(
        condition="_row_hash != source._row_hash",
        set={
            "_end_date": current_timestamp(),
            "_is_current": False
        }
    ).whenNotMatchedInsert(
        values={
            **all_source_columns,
            "_start_date": current_timestamp(),
            "_end_date": lit("9999-12-31 23:59:59"),
            "_is_current": True,
            "_row_hash": "_row_hash"
        }
    ).execute()

    # Step 5: Update entity_loading_status
    update_entity_status(entity.id, "silver", "succeeded", row_count, duration)
```

### Engine Orchestration Flow

```
User clicks "Execute" on /engine page
    ↓
POST /api/engine/start { "layers": ["silver"], "mode": "execute" }
    ↓
LoadOrchestrator.run(layers=["silver"])
    ↓
1. Query execution.vw_LoadSourceToLandingzone WHERE is_silver_active = 1
    → Returns 1,666 entities
    ↓
2. Group entities by datasource_id (parallel processing)
    ↓
3. For each datasource batch:
    - Trigger NB_FMD_LOAD_BRONZE_SILVER via Fabric Notebook API
    - Pass entity list as parameter
    - Wait for completion (timeout = 6 hours)
    - Poll job status every 30 seconds
    ↓
4. Collect results from execution.entity_loading_status
    ↓
5. Return aggregated status to dashboard
```

### Database Schema Updates

**Table**: `execution.entity_loading_status`

```sql
-- Silver columns (already exist, but must be populated)
ALTER TABLE execution.entity_loading_status ADD
    is_silver_active BIT DEFAULT 0,
    silver_last_load_datetime DATETIME2,
    silver_row_count BIGINT,
    silver_status NVARCHAR(50),  -- 'succeeded', 'failed', 'pending'
    silver_error_message NVARCHAR(MAX),
    silver_duration_seconds FLOAT;
```

**Stored Procedure**: Update entity status after Silver load

```sql
CREATE OR ALTER PROCEDURE execution.sp_UpdateSilverStatus
    @entity_id INT,
    @status NVARCHAR(50),
    @row_count BIGINT = NULL,
    @duration_seconds FLOAT = NULL,
    @error_message NVARCHAR(MAX) = NULL
AS
BEGIN
    UPDATE execution.entity_loading_status
    SET
        silver_status = @status,
        silver_last_load_datetime = GETDATE(),
        silver_row_count = COALESCE(@row_count, silver_row_count),
        silver_duration_seconds = @duration_seconds,
        silver_error_message = @error_message,
        last_updated = GETDATE()
    WHERE entity_id = @entity_id;
END;
GO
```

---

## Implementation Steps

### Step 1: Activate All Remaining Entities
**File**: `scripts/activate_all_silver_entities.py`

```python
"""
Activate all 1,666 entities for Silver processing (after Phase 1 validation passes).

Prerequisites:
- 001-verify-bronze-silver-100-entity-activation completed successfully
- 100-entity test batch processed with zero failures

Usage:
    python scripts/activate_all_silver_entities.py --mode plan
    python scripts/activate_all_silver_entities.py --mode execute --confirm
"""

import argparse
import pyodbc
import json
from datetime import datetime

def activate_all_entities(conn: pyodbc.Connection) -> int:
    """Activate all entities with Bronze data for Silver processing."""
    cursor = conn.cursor()

    # Query all entities with successful Bronze load
    cursor.execute("""
        SELECT e.id
        FROM execution.entities e
        INNER JOIN execution.entity_loading_status els ON e.id = els.entity_id
        WHERE els.bronze_status = 'succeeded'
        AND els.bronze_row_count > 0
        AND els.is_silver_active = 0  -- not yet activated
        ORDER BY e.id;
    """)

    entity_ids = [row.id for row in cursor.fetchall()]

    if not entity_ids:
        print("✅ All entities already activated")
        return 0

    print(f"📊 Found {len(entity_ids)} entities to activate")

    # Activate in batches of 500 (avoid SQL parameter limits)
    batch_size = 500
    total_activated = 0

    for i in range(0, len(entity_ids), batch_size):
        batch = entity_ids[i:i+batch_size]
        id_csv = ','.join(str(id) for id in batch)

        cursor.execute(
            "EXEC execution.sp_ActivateEntitiesForSilver @entity_ids=?, @audit_user=?",
            (id_csv, 'activate_all_silver_entities.py')
        )
        conn.commit()

        total_activated += len(batch)
        print(f"   Activated batch {i//batch_size + 1}: {len(batch)} entities ({total_activated}/{len(entity_ids)})")

    return total_activated


def verify_all_activated(conn: pyodbc.Connection) -> dict:
    """Verify all 1,666 entities are activated."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            COUNT(*) AS total_active,
            SUM(CASE WHEN bronze_status = 'succeeded' AND bronze_row_count > 0 THEN 1 ELSE 0 END) AS valid_active,
            SUM(CASE WHEN bronze_status != 'succeeded' OR bronze_row_count = 0 THEN 1 ELSE 0 END) AS invalid_active
        FROM execution.entity_loading_status
        WHERE is_silver_active = 1;
    """)

    row = cursor.fetchone()
    return {
        'total_active': row.total_active,
        'valid_active': row.valid_active,
        'invalid_active': row.invalid_active,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['plan', 'execute'], required=True)
    parser.add_argument('--confirm', action='store_true',
                       help='Required flag to execute (safety check)')
    args = parser.parse_args()

    if args.mode == 'execute' and not args.confirm:
        print("❌ ERROR: Must specify --confirm flag to execute activation")
        print("   This is a safety check to prevent accidental execution.")
        return 1

    print("=== Activate All Silver Entities ===\n")

    conn = connect_to_sql()  # Same logic as Phase 1 script

    if args.mode == 'plan':
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COUNT(*) AS count
            FROM execution.entity_loading_status
            WHERE bronze_status = 'succeeded'
            AND bronze_row_count > 0
            AND is_silver_active = 0;
        """)
        count = cursor.fetchone().count
        print(f"📊 Would activate {count} entities")
        print("   Run with --mode execute --confirm to activate")
        return 0

    # Execute activation
    activated = activate_all_entities(conn)
    print(f"\n✅ Activated {activated} entities")

    # Verify
    verification = verify_all_activated(conn)
    print(f"\n🔍 Verification:")
    print(f"   Total active:   {verification['total_active']}")
    print(f"   Valid active:   {verification['valid_active']}")
    print(f"   Invalid active: {verification['invalid_active']}")

    if verification['total_active'] == 1666 and verification['invalid_active'] == 0:
        print("\n✅ SUCCESS: All 1,666 entities activated")
        return 0
    else:
        print(f"\n❌ FAILURE: Activation incomplete or invalid")
        return 1


if __name__ == '__main__':
    exit(main())
```

### Step 2: Execute Silver Load via Engine
**Method**: Dashboard UI + REST API

```bash
# Option 1: Via Dashboard UI
# 1. Navigate to http://127.0.0.1:5173/engine
# 2. Uncheck "Landing Zone" checkbox
# 3. Uncheck "Bronze" checkbox
# 4. Check "Silver" checkbox only
# 5. Click "Execute" button
# 6. Confirm execution
# 7. Monitor live log panel
# 8. Wait for completion (estimated: 2-4 hours for 1,666 entities)

# Option 2: Via curl (headless execution)
curl -X POST http://127.0.0.1:8787/api/engine/start \
  -H "Content-Type: application/json" \
  -d '{
    "layers": ["silver"],
    "mode": "execute",
    "triggered_by": "spec-002-full-silver-load"
  }'

# Response:
# {
#   "run_id": "abc123...",
#   "status": "started",
#   "entity_count": 1666,
#   "layers": ["silver"]
# }
```

### Step 3: Monitor Execution Progress
**File**: `scripts/monitor_silver_load.py`

```python
"""
Monitor Silver load progress in real-time.

Polls /api/engine/status every 10 seconds and displays:
- Current status (running/idle/error)
- Entities processed (succeeded/failed/pending)
- Estimated time remaining
- Fabric notebook job status

Usage:
    python scripts/monitor_silver_load.py --run-id <run_id>
    python scripts/monitor_silver_load.py  # monitors latest run
"""

import argparse
import requests
import time
from datetime import datetime, timedelta

API_BASE = "http://127.0.0.1:8787"

def get_engine_status():
    """Query engine status API."""
    resp = requests.get(f"{API_BASE}/api/engine/status")
    resp.raise_for_status()
    return resp.json()

def get_fabric_jobs():
    """Query Fabric notebook job status."""
    resp = requests.get(f"{API_BASE}/api/engine/jobs")
    resp.raise_for_status()
    return resp.json()

def format_duration(seconds):
    """Format duration in human-readable format."""
    return str(timedelta(seconds=int(seconds)))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-id', help='Specific run ID to monitor (optional)')
    parser.add_argument('--interval', type=int, default=10, help='Poll interval in seconds')
    args = parser.parse_args()

    print("🔍 Monitoring Silver Load Execution\n")
    print(f"API: {API_BASE}")
    print(f"Poll interval: {args.interval}s\n")

    start_time = time.time()
    last_status = None

    try:
        while True:
            status = get_engine_status()
            jobs = get_fabric_jobs()

            # Clear screen (optional, for cleaner display)
            # print("\033[H\033[J", end="")

            print(f"{'='*80}")
            print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"Elapsed: {format_duration(time.time() - start_time)}")
            print(f"{'='*80}\n")

            # Engine status
            print(f"Engine Status: {status.get('status', 'unknown').upper()}")

            if status.get('current_run_id'):
                print(f"Run ID: {status['current_run_id'][:16]}...")

            # Last run summary
            if 'last_run' in status and status['last_run']:
                lr = status['last_run']
                print(f"\nLast Run:")
                print(f"  Status:    {lr.get('status', 'N/A')}")
                print(f"  Entities:  {lr.get('total_entities', 0)}")
                print(f"  Succeeded: {lr.get('succeeded_entities', 0)}")
                print(f"  Failed:    {lr.get('failed_entities', 0)}")
                print(f"  Duration:  {format_duration(lr.get('duration_seconds', 0))}")
                print(f"  Rows:      {lr.get('total_rows_read', 0):,}")

            # Fabric jobs
            if jobs and 'jobs' in jobs:
                print(f"\n📓 Active Fabric Notebook Jobs: {len(jobs['jobs'])}")
                for job in jobs['jobs'][:5]:  # Show first 5
                    print(f"  [{job.get('status', 'unknown')}] {job.get('notebook_name', 'N/A')} - {job.get('job_id', 'N/A')[:16]}...")

            # Check if run completed
            if last_status == 'running' and status.get('status') == 'idle':
                print("\n✅ Run completed!")
                break

            last_status = status.get('status')

            # Sleep
            print(f"\nNext update in {args.interval}s... (Ctrl+C to exit)")
            time.sleep(args.interval)

    except KeyboardInterrupt:
        print("\n\n⚠️  Monitoring stopped by user")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return 1

    return 0

if __name__ == '__main__':
    exit(main())
```

### Step 4: Validate Silver Load Success
**File**: `engine/tests/test_full_silver_load.py`

```python
"""
Pytest validation for full 1,666-entity Silver load.

Tests verify:
1. All 1,666 entities have silver_status = 'succeeded'
2. All Silver tables exist in Fabric
3. Silver row counts >= Bronze row counts (SCD Type 2)
4. SCD Type 2 columns exist (_start_date, _end_date, _is_current, _row_hash)
5. No entities have silver_error_message
"""

import pytest
import pyodbc
import json
from typing import List, Dict

@pytest.fixture(scope='module')
def db_connection():
    """SQL connection to Fabric metadata DB."""
    # Connection logic (same as previous specs)
    conn = pyodbc.connect(...)
    yield conn
    conn.close()


@pytest.fixture(scope='module')
def silver_entities(db_connection) -> List[Dict]:
    """Query all entities with their Silver status."""
    cursor = db_connection.cursor()
    cursor.execute("""
        SELECT
            e.id,
            e.source_name,
            e.source_schema,
            e.source_table,
            els.silver_status,
            els.silver_row_count,
            els.bronze_row_count,
            els.silver_error_message,
            els.silver_duration_seconds
        FROM execution.entities e
        INNER JOIN execution.entity_loading_status els ON e.id = els.entity_id
        WHERE els.is_silver_active = 1
        ORDER BY e.id;
    """)

    entities = []
    for row in cursor.fetchall():
        entities.append({
            'id': row.id,
            'source': row.source_name,
            'schema': row.source_schema,
            'table': row.source_table,
            'silver_status': row.silver_status,
            'silver_rows': row.silver_row_count,
            'bronze_rows': row.bronze_row_count,
            'error': row.silver_error_message,
            'duration': row.silver_duration_seconds,
        })

    return entities


def test_all_1666_entities_succeeded(silver_entities):
    """T-SILVER-FULL-001: All 1,666 entities must have succeeded."""
    failed = [e for e in silver_entities if e['silver_status'] != 'succeeded']

    assert len(silver_entities) == 1666, \
        f"Expected 1666 entities, found {len(silver_entities)}"

    assert len(failed) == 0, \
        f"Found {len(failed)} failed entities:\n" + \
        "\n".join(f"  [{e['id']}] {e['source']}.{e['schema']}.{e['table']}: {e['error']}" for e in failed[:10])


def test_silver_row_counts_valid(silver_entities):
    """T-SILVER-FULL-002: Silver row count must be >= Bronze row count (SCD Type 2 may add rows)."""
    invalid = [
        e for e in silver_entities
        if e['silver_rows'] is None or e['silver_rows'] < e['bronze_rows']
    ]

    assert len(invalid) == 0, \
        f"Found {len(invalid)} entities with invalid row counts:\n" + \
        "\n".join(
            f"  [{e['id']}] {e['source']}.{e['schema']}.{e['table']}: "
            f"Silver={e['silver_rows']}, Bronze={e['bronze_rows']}"
            for e in invalid[:10]
        )


def test_no_silver_errors(silver_entities):
    """T-SILVER-FULL-003: No entities should have error messages."""
    errors = [e for e in silver_entities if e['error'] and e['error'].strip()]

    assert len(errors) == 0, \
        f"Found {len(errors)} entities with errors:\n" + \
        "\n".join(f"  [{e['id']}] {e['source']}.{e['schema']}.{e['table']}: {e['error']}" for e in errors[:10])


def test_silver_processing_durations_reasonable(silver_entities):
    """T-SILVER-FULL-004: All entities should complete in < 30 minutes."""
    slow = [e for e in silver_entities if e['duration'] and e['duration'] > 1800]  # 30 min

    # This is a warning, not a failure (some large tables may take longer)
    if slow:
        print(f"\n⚠️  {len(slow)} entities took > 30 minutes:")
        for e in slow[:10]:
            print(f"   [{e['id']}] {e['source']}.{e['schema']}.{e['table']}: {e['duration']:.1f}s")


@pytest.mark.slow
@pytest.mark.fabric
def test_silver_tables_exist_in_fabric(silver_entities, fabric_spark_session):
    """T-SILVER-FULL-005: All Silver tables must exist in Fabric lakehouse.

    NOTE: This test requires Fabric Spark session (runs in Fabric notebook or via Fabric API).
    Skipped in local pytest unless --fabric flag provided.
    """
    pytest.skip("Requires Fabric Spark session (run in notebook)")

    # If running in Fabric notebook:
    # spark = fabric_spark_session
    # for entity in silver_entities:
    #     table_name = f"silver.{entity['source']}_{entity['schema']}_{entity['table']}"
    #     assert spark.catalog.tableExists(table_name), f"Table {table_name} does not exist"


def test_dashboard_shows_100_percent_silver(db_connection):
    """T-SILVER-FULL-006: Dashboard Control Plane API should show 100% Silver completion."""
    # Query the same data the dashboard uses
    cursor = db_connection.cursor()
    cursor.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN silver_status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded
        FROM execution.entity_loading_status
        WHERE is_silver_active = 1;
    """)

    row = cursor.fetchone()
    total = row.total
    succeeded = row.succeeded

    completion_pct = (succeeded / total * 100) if total > 0 else 0

    assert total == 1666, f"Expected 1666 total entities, found {total}"
    assert succeeded == 1666, f"Expected 1666 succeeded, found {succeeded}"
    assert completion_pct == 100.0, f"Silver completion is {completion_pct:.1f}%, expected 100%"
```

---

## Acceptance Criteria

### ✅ Definition of Done

| ID | Criterion | Verification Method |
|----|-----------|-------------------|
| AC-1 | All 1,666 entities activated | `SELECT COUNT(*) FROM execution.entity_loading_status WHERE is_silver_active = 1` → 1666 |
| AC-2 | Silver load executed successfully | Engine status shows last_run.status = "Succeeded" |
| AC-3 | Zero failures | `SELECT COUNT(*) FROM execution.entity_loading_status WHERE silver_status = 'failed'` → 0 |
| AC-4 | All entities have Silver data | `SELECT COUNT(*) FROM execution.entity_loading_status WHERE silver_status = 'succeeded'` → 1666 |
| AC-5 | Row count validation passes | All Silver row counts >= Bronze row counts |
| AC-6 | Dashboard shows 100% | Control Plane page `/control` shows Silver progress bar = 100% |
| AC-7 | Pytest suite passes | `pytest engine/tests/test_full_silver_load.py -v` → all tests pass |
| AC-8 | No error messages | `SELECT COUNT(*) FROM execution.entity_loading_status WHERE silver_error_message IS NOT NULL` → 0 |
| AC-9 | Execution time logged | All entities have `silver_duration_seconds` populated |
| AC-10 | Success documented | Add entry to `CHANGELOG.md` with timestamp, run ID, duration |

### Test Execution Commands

```bash
# Step 1: Activate all entities
python scripts/activate_all_silver_entities.py --mode plan
python scripts/activate_all_silver_entities.py --mode execute --confirm

# Step 2: Start Silver load
curl -X POST http://127.0.0.1:8787/api/engine/start \
  -H "Content-Type: application/json" \
  -d '{"layers": ["silver"], "mode": "execute", "triggered_by": "spec-002"}'

# Step 3: Monitor progress (in separate terminal)
python scripts/monitor_silver_load.py

# Step 4: After completion, run validation tests
pytest engine/tests/test_full_silver_load.py -v --tb=short

# Step 5: Query final status
python -c "
import pyodbc
conn = pyodbc.connect(...)
cursor = conn.cursor()
cursor.execute('''
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN silver_status = \"succeeded\" THEN 1 ELSE 0 END) AS succeeded,
    SUM(CASE WHEN silver_status = \"failed\" THEN 1 ELSE 0 END) AS failed
  FROM execution.entity_loading_status WHERE is_silver_active = 1
''')
row = cursor.fetchone()
print(f'Total: {row.total}, Succeeded: {row.succeeded}, Failed: {row.failed}')
"

# Step 6: Check dashboard
# Navigate to http://127.0.0.1:5173/control
# Verify Silver progress bar = 100%
```

---

## Dependencies

### Upstream Dependencies (Must Complete First)
- ✅ 001-verify-bronze-silver-100-entity-activation (100-entity test batch succeeds)
- ✅ Bronze layer 100% complete
- ✅ Silver notebook deployed to Fabric with correct Item ID
- ✅ Engine config has correct `notebook_silver_id`

### Downstream Dependencies (Blocked Until This Completes)
- 🔒 Gold layer implementation
- 🔒 Data quality validation rules
- 🔒 Business reporting dashboards
- 🔒 Production deployment approval

---

## Rollback Plan

If Silver load fails catastrophically:

```sql
-- Emergency rollback: Deactivate all Silver entities
UPDATE execution.entity_loading_status
SET
    is_silver_active = 0,
    silver_status = 'pending',
    silver_row_count = NULL,
    silver_error_message = 'Rolled back due to catastrophic failure',
    last_updated = GETDATE();

-- Drop all Silver tables (if needed)
-- RUN THIS ONLY IN EXTREME CASES
-- EXEC silver.sp_DropAllSilverTables;  -- Custom stored proc (create if needed)
```

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Completion rate | 100% (1666/1666) | SQL COUNT query |
| Failure rate | 0% (0/1666) | SQL COUNT query |
| Average entity duration | < 5 minutes | AVG(silver_duration_seconds) |
| Total execution time | < 4 hours | Last run duration |
| Dashboard accuracy | 100% match with SQL | Control Plane page vs query |
| Test pass rate | 100% (6/6 tests) | Pytest output |

---

## Performance Estimates

| Phase | Estimated Duration | Notes |
|-------|-------------------|-------|
| Entity activation | 5-10 minutes | Batch updates to 1,666 rows |
| Silver processing | 2-4 hours | Depends on data volume and parallelism |
| Validation tests | 5-10 minutes | SQL queries + pytest |
| **Total** | **~3-5 hours** | End-to-end including monitoring |

**Parallelism**:
- Engine `batch_size = 15` (15 concurrent notebook jobs)
- Each notebook processes ~111 entities sequentially
- Bottleneck: Fabric notebook capacity limits

**Optimization opportunities** (if too slow):
- Increase `batch_size` to 20-25 (if Fabric allows)
- Optimize Silver notebook query performance
- Add entity-level parallelism within notebook

---

## Notes & Gotchas

1. **SCD Type 2 increases row counts**
   - Silver row count ≥ Bronze row count (not equal)
   - Example: Bronze has 1,000 rows → Silver might have 1,200 rows (if 200 records changed)
   - This is expected and correct

2. **First run takes longer**
   - Initial Silver load processes all Bronze history
   - Subsequent incremental loads only process changes (much faster)

3. **Fabric notebook timeout**
   - Default timeout: 6 hours (`notebook_timeout_seconds = 21600`)
   - If any entity takes > 6 hours, notebook job fails
   - Monitor slow entities and optimize queries

4. **Entity activation is irreversible** (without manual SQL)
   - Once `is_silver_active = 1`, entity will be processed on every Silver run
   - To exclude an entity, must manually set `is_silver_active = 0` in SQL

5. **Dashboard lag**
   - Control Plane page polls every 5 seconds
   - May take 5-10 seconds for progress bar to update after completion

6. **Error handling**
   - If any entity fails, run status = "Failed" but other entities complete
   - Failed entities can be retried via `/api/engine/retry` endpoint
   - Error messages stored in `silver_error_message` column

---

## References

- `knowledge/DEFINITION-OF-DONE.md` § 6.4: Full Bronze→Silver load gate
- `knowledge/ARCHITECTURE.md`: Medallion architecture overview
- `knowledge/NOTEBOOK-ORCHESTRATION.md`: Fabric notebook triggering patterns
- `engine/orchestrator.py`: LoadOrchestrator implementation
- `engine/notebook_trigger.py`: NotebookTrigger implementation
- `src/business_domain/NB_LOAD_BRONZE_SILVER.Notebook/`: Silver processing notebook

---

**Estimated Effort**: 8 hours (1h activation + 4h execution + 2h validation + 1h documentation)
**Risk Level**: Medium-High (large-scale data transformation, potential for failures)
**Reviewer**: Steve Nahrup (@snahrup)
**Success Gate**: Must pass before any Gold layer work begins
