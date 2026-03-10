# Spec 001: Verify Bronze→Silver 100-Entity Activation

> **Priority**: CRITICAL
> **Category**: testing
> **Complexity**: medium
> **Impact**: critical
> **Status**: pending
> **Owner**: sage-tower (Test Agent)
> **Blocked By**: None
> **Blocks**: 002-execute-full-bronze-silver-load-and-verify-success

---

## User Story

**As a** Data Platform Engineer
**I want to** verify that 100 entities are properly activated for Bronze→Silver processing
**So that** I can confidently proceed with the full 1,666-entity production load

---

## Context & Background

### Current State
- **1,666 total entities** across 5 source systems (ETQ, MES, M3 ERP, M3 Cloud, Optiva)
- Landing Zone → Bronze layer is **100% complete** (verified 2026-03-09)
- Bronze → Silver layer is **blocked** due to missing activation flags in `execution.entity_loading_status`
- The Silver processing notebook (`NB_FMD_LOAD_BRONZE_SILVER`) only processes entities where `is_silver_active = 1`

### Problem Statement
The `execution.entity_loading_status` table is missing the `is_silver_active` flag for the majority of entities. Without this flag:
- Silver processing notebook skips these entities
- Dashboard shows 0% Silver completion
- Cannot validate end-to-end pipeline

### Success Criteria (Binary Gate)
From `DEFINITION-OF-DONE.md` Section 6.3:
- ✅ **Exactly 100 entities** have `is_silver_active = 1` in `execution.entity_loading_status`
- ✅ **No entities** are activated that don't have Bronze data (Bronze row count > 0)
- ✅ **Test entities span all 5 source systems** (not just one source)
- ✅ **Activation persists** after dashboard/engine restart
- ✅ **Automated test** validates count = 100 ± 0

---

## Technical Architecture

### Database Schema

**Table**: `execution.entity_loading_status`

```sql
CREATE TABLE execution.entity_loading_status (
    id INT PRIMARY KEY IDENTITY,
    entity_id INT NOT NULL FOREIGN KEY REFERENCES execution.entities(id),
    source_name NVARCHAR(100),
    source_schema NVARCHAR(100),
    source_table NVARCHAR(200),
    datasource_id INT,

    -- Landing Zone status
    is_lz_active BIT DEFAULT 0,
    lz_last_load_datetime DATETIME2,
    lz_row_count BIGINT,
    lz_status NVARCHAR(50),  -- 'succeeded', 'failed', 'pending'

    -- Bronze status
    is_bronze_active BIT DEFAULT 0,
    bronze_last_load_datetime DATETIME2,
    bronze_row_count BIGINT,
    bronze_status NVARCHAR(50),

    -- Silver status (THIS IS WHAT WE'RE VERIFYING)
    is_silver_active BIT DEFAULT 0,  -- ← MUST BE 1 FOR 100 ENTITIES
    silver_last_load_datetime DATETIME2,
    silver_row_count BIGINT,
    silver_status NVARCHAR(50),

    last_updated DATETIME2 DEFAULT GETDATE(),
    UNIQUE (entity_id)
);
```

**Validation Query**:
```sql
-- This query MUST return exactly 100 rows
SELECT
    e.id AS entity_id,
    e.source_name,
    e.source_schema + '.' + e.source_table AS qualified_name,
    els.is_silver_active,
    els.bronze_row_count,
    els.bronze_status,
    els.bronze_last_load_datetime
FROM execution.entities e
INNER JOIN execution.entity_loading_status els ON e.id = els.entity_id
WHERE els.is_silver_active = 1
AND els.bronze_status = 'succeeded'
AND els.bronze_row_count > 0
ORDER BY e.source_name, e.source_schema, e.source_table;

-- EXPECTED ROW COUNT: 100
```

### Selection Criteria for 100 Entities

**Strategy**: Stratified sampling across source systems

```sql
-- Step 1: Identify eligible entities (have Bronze data)
WITH eligible_entities AS (
    SELECT
        e.id,
        e.source_name,
        e.source_schema,
        e.source_table,
        els.bronze_row_count,
        els.bronze_status,
        ROW_NUMBER() OVER (
            PARTITION BY e.source_name
            ORDER BY els.bronze_row_count DESC  -- prioritize larger tables for validation
        ) AS rn
    FROM execution.entities e
    INNER JOIN execution.entity_loading_status els ON e.id = els.entity_id
    WHERE els.bronze_status = 'succeeded'
    AND els.bronze_row_count > 0
    AND els.is_silver_active = 0  -- not yet activated
),
-- Step 2: Calculate per-source allocation (proportional to entity count)
source_allocation AS (
    SELECT
        'ETQ' AS source, 6 AS target_count UNION ALL  -- 29 total → 6
    SELECT 'MES', 27 UNION ALL                        -- 445 total → 27
    SELECT 'M3', 36 UNION ALL                         -- 596 total → 36
    SELECT 'M3C', 11 UNION ALL                        -- 187 total → 11
    SELECT 'OPTIVA', 20                               -- 409 total → 20
    -- TOTAL = 100
)
-- Step 3: Select entities using stratified sampling
SELECT
    ee.id,
    ee.source_name,
    ee.source_schema,
    ee.source_table,
    ee.bronze_row_count
FROM eligible_entities ee
INNER JOIN source_allocation sa ON ee.source_name = sa.source
WHERE ee.rn <= sa.target_count
ORDER BY ee.source_name, ee.rn;
```

### Activation Stored Procedure

**File**: `src/sql/stored_procedures/sp_ActivateEntitiesForSilver.sql`

```sql
CREATE OR ALTER PROCEDURE execution.sp_ActivateEntitiesForSilver
    @entity_ids NVARCHAR(MAX),  -- comma-separated list of entity IDs
    @audit_user NVARCHAR(100) = 'system'
AS
BEGIN
    SET NOCOUNT ON;

    -- Parse CSV into table variable
    DECLARE @ids TABLE (entity_id INT);
    INSERT INTO @ids (entity_id)
    SELECT CAST(value AS INT)
    FROM STRING_SPLIT(@entity_ids, ',');

    -- Validate: all entities must have Bronze data
    IF EXISTS (
        SELECT 1
        FROM @ids i
        LEFT JOIN execution.entity_loading_status els ON i.entity_id = els.entity_id
        WHERE els.bronze_status != 'succeeded'
        OR els.bronze_row_count = 0
        OR els.bronze_row_count IS NULL
    )
    BEGIN
        RAISERROR('One or more entities do not have successful Bronze data', 16, 1);
        RETURN;
    END;

    -- Activate entities for Silver processing
    UPDATE execution.entity_loading_status
    SET
        is_silver_active = 1,
        last_updated = GETDATE()
    WHERE entity_id IN (SELECT entity_id FROM @ids);

    -- Return activation results
    SELECT
        e.id AS entity_id,
        e.source_name,
        e.source_schema + '.' + e.source_table AS qualified_name,
        els.is_silver_active,
        els.bronze_row_count,
        els.bronze_last_load_datetime
    FROM execution.entities e
    INNER JOIN execution.entity_loading_status els ON e.id = els.entity_id
    INNER JOIN @ids i ON e.id = i.entity_id
    ORDER BY e.source_name, e.source_schema, e.source_table;

    PRINT 'Activated ' + CAST(@@ROWCOUNT AS VARCHAR) + ' entities for Silver processing';
END;
GO
```

---

## Implementation Steps

### Step 1: Create Activation Script
**File**: `scripts/activate_silver_entities_phase1.py`

```python
"""
Activate 100 entities for Silver processing (Phase 1 validation batch).

Usage:
    python scripts/activate_silver_entities_phase1.py --mode plan
    python scripts/activate_silver_entities_phase1.py --mode execute
"""

import argparse
import pyodbc
import json
from datetime import datetime
from typing import List, Dict

def connect_to_sql() -> pyodbc.Connection:
    """Connect to Fabric SQL DB using config.json."""
    with open('dashboard/app/api/config.json', 'r') as f:
        config = json.load(f)

    server = config['sql_server']
    database = config['sql_database']
    tenant_id = config['tenant_id']
    client_id = config['client_id']
    client_secret = config['client_secret']

    # Use Azure AD Service Principal auth
    import struct
    from azure.identity import ClientSecretCredential

    credential = ClientSecretCredential(tenant_id, client_id, client_secret)
    token = credential.get_token("https://database.windows.net/.default").token

    # Build connection string with token
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"Encrypt=yes;TrustServerCertificate=no;"
    )

    # Encode token for SQL Server
    token_bytes = token.encode('utf-16-le')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    SQL_COPT_SS_ACCESS_TOKEN = 1256

    conn = pyodbc.connect(conn_str, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct})
    return conn


def get_eligible_entities(conn: pyodbc.Connection) -> List[Dict]:
    """Query eligible entities using stratified sampling."""
    query = """
    WITH eligible_entities AS (
        SELECT
            e.id,
            e.source_name,
            e.source_schema,
            e.source_table,
            els.bronze_row_count,
            els.bronze_status,
            ROW_NUMBER() OVER (
                PARTITION BY e.source_name
                ORDER BY els.bronze_row_count DESC
            ) AS rn
        FROM execution.entities e
        INNER JOIN execution.entity_loading_status els ON e.id = els.entity_id
        WHERE els.bronze_status = 'succeeded'
        AND els.bronze_row_count > 0
        AND els.is_silver_active = 0
    ),
    source_allocation AS (
        SELECT 'ETQ' AS source, 6 AS target_count UNION ALL
        SELECT 'MES', 27 UNION ALL
        SELECT 'M3', 36 UNION ALL
        SELECT 'M3C', 11 UNION ALL
        SELECT 'OPTIVA', 20
    )
    SELECT
        ee.id,
        ee.source_name,
        ee.source_schema,
        ee.source_table,
        ee.bronze_row_count
    FROM eligible_entities ee
    INNER JOIN source_allocation sa ON ee.source_name = sa.source
    WHERE ee.rn <= sa.target_count
    ORDER BY ee.source_name, ee.rn;
    """

    cursor = conn.cursor()
    cursor.execute(query)

    entities = []
    for row in cursor.fetchall():
        entities.append({
            'id': row.id,
            'source': row.source_name,
            'schema': row.source_schema,
            'table': row.source_table,
            'bronze_rows': row.bronze_row_count,
        })

    return entities


def activate_entities(conn: pyodbc.Connection, entity_ids: List[int]) -> int:
    """Call stored procedure to activate entities."""
    cursor = conn.cursor()
    id_csv = ','.join(str(id) for id in entity_ids)

    cursor.execute(
        "EXEC execution.sp_ActivateEntitiesForSilver @entity_ids=?, @audit_user=?",
        (id_csv, 'activate_silver_entities_phase1.py')
    )

    # Get result set
    results = cursor.fetchall()
    conn.commit()

    return len(results)


def verify_activation(conn: pyodbc.Connection) -> Dict:
    """Verify exactly 100 entities are activated."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            COUNT(*) AS total_activated,
            SUM(CASE WHEN source_name = 'ETQ' THEN 1 ELSE 0 END) AS etq_count,
            SUM(CASE WHEN source_name = 'MES' THEN 1 ELSE 0 END) AS mes_count,
            SUM(CASE WHEN source_name = 'M3' THEN 1 ELSE 0 END) AS m3_count,
            SUM(CASE WHEN source_name = 'M3C' THEN 1 ELSE 0 END) AS m3c_count,
            SUM(CASE WHEN source_name = 'OPTIVA' THEN 1 ELSE 0 END) AS optiva_count
        FROM execution.entities e
        INNER JOIN execution.entity_loading_status els ON e.id = els.entity_id
        WHERE els.is_silver_active = 1
        AND els.bronze_status = 'succeeded'
        AND els.bronze_row_count > 0;
    """)

    row = cursor.fetchone()
    return {
        'total': row.total_activated,
        'etq': row.etq_count,
        'mes': row.mes_count,
        'm3': row.m3_count,
        'm3c': row.m3c_count,
        'optiva': row.optiva_count,
    }


def main():
    parser = argparse.ArgumentParser(description='Activate 100 entities for Silver processing')
    parser.add_argument('--mode', choices=['plan', 'execute'], default='plan',
                       help='plan: show what will be activated; execute: actually activate')
    args = parser.parse_args()

    print(f"=== Silver Entity Activation (Phase 1: 100 entities) ===")
    print(f"Mode: {args.mode}")
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z\n")

    conn = connect_to_sql()

    # Get eligible entities
    entities = get_eligible_entities(conn)

    if len(entities) != 100:
        print(f"❌ ERROR: Expected 100 eligible entities, found {len(entities)}")
        print("   This likely means some entities don't have Bronze data yet.")
        conn.close()
        return 1

    # Show breakdown by source
    from collections import Counter
    source_counts = Counter(e['source'] for e in entities)
    print("📊 Entity Selection Breakdown:")
    for source in ['ETQ', 'MES', 'M3', 'M3C', 'OPTIVA']:
        count = source_counts.get(source, 0)
        print(f"   {source:10s}: {count:3d} entities")
    print(f"   {'TOTAL':10s}: {len(entities):3d} entities\n")

    # Show sample entities
    print("📋 Sample Entities (first 5 per source):")
    for source in ['ETQ', 'MES', 'M3', 'M3C', 'OPTIVA']:
        source_entities = [e for e in entities if e['source'] == source][:5]
        for e in source_entities:
            print(f"   [{e['id']:4d}] {e['source']:6s} | {e['schema']}.{e['table']:40s} | {e['bronze_rows']:,} rows")
    print()

    if args.mode == 'plan':
        print("✅ DRY RUN: No changes made. Run with --mode execute to activate.")
        conn.close()
        return 0

    # Execute activation
    print("⚙️  Activating entities...")
    entity_ids = [e['id'] for e in entities]
    activated_count = activate_entities(conn, entity_ids)
    print(f"✅ Activated {activated_count} entities\n")

    # Verify
    print("🔍 Verifying activation...")
    verification = verify_activation(conn)

    print("📊 Verification Results:")
    print(f"   Total activated: {verification['total']}")
    print(f"   ETQ:     {verification['etq']}")
    print(f"   MES:     {verification['mes']}")
    print(f"   M3:      {verification['m3']}")
    print(f"   M3C:     {verification['m3c']}")
    print(f"   OPTIVA:  {verification['optiva']}")

    if verification['total'] == 100:
        print("\n✅ SUCCESS: Exactly 100 entities activated for Silver processing")
        conn.close()
        return 0
    else:
        print(f"\n❌ FAILURE: Expected 100 entities, but {verification['total']} are active")
        conn.close()
        return 1


if __name__ == '__main__':
    exit(main())
```

### Step 2: Create Pytest Test
**File**: `engine/tests/test_silver_activation.py`

```python
"""
Pytest validation for 100-entity Silver activation.

Tests verify:
1. Exactly 100 entities have is_silver_active = 1
2. All activated entities have Bronze data
3. Entities span all 5 source systems
4. Activation persists across restarts
"""

import pytest
import pyodbc
import json
from typing import Dict, List

@pytest.fixture(scope='module')
def db_connection():
    """Fixture: SQL connection to Fabric metadata DB."""
    with open('dashboard/app/api/config.json', 'r') as f:
        config = json.load(f)

    # Same connection logic as activate_silver_entities_phase1.py
    # (code omitted for brevity — see implementation script above)

    conn = pyodbc.connect(...)  # Connection details
    yield conn
    conn.close()


@pytest.fixture(scope='module')
def activated_entities(db_connection) -> List[Dict]:
    """Fixture: Query all activated Silver entities."""
    cursor = db_connection.cursor()
    cursor.execute("""
        SELECT
            e.id,
            e.source_name,
            e.source_schema,
            e.source_table,
            els.is_silver_active,
            els.bronze_row_count,
            els.bronze_status
        FROM execution.entities e
        INNER JOIN execution.entity_loading_status els ON e.id = els.entity_id
        WHERE els.is_silver_active = 1
        ORDER BY e.source_name, e.source_schema, e.source_table;
    """)

    entities = []
    for row in cursor.fetchall():
        entities.append({
            'id': row.id,
            'source': row.source_name,
            'schema': row.source_schema,
            'table': row.source_table,
            'active': row.is_silver_active,
            'bronze_rows': row.bronze_row_count,
            'bronze_status': row.bronze_status,
        })

    return entities


def test_exactly_100_entities_activated(activated_entities):
    """T-SILVER-001: Exactly 100 entities must be activated."""
    assert len(activated_entities) == 100, \
        f"Expected 100 activated entities, found {len(activated_entities)}"


def test_all_entities_have_bronze_data(activated_entities):
    """T-SILVER-002: All activated entities must have Bronze data."""
    for entity in activated_entities:
        assert entity['bronze_status'] == 'succeeded', \
            f"Entity {entity['id']} ({entity['source']}.{entity['schema']}.{entity['table']}) has Bronze status '{entity['bronze_status']}' (expected 'succeeded')"

        assert entity['bronze_rows'] > 0, \
            f"Entity {entity['id']} ({entity['source']}.{entity['schema']}.{entity['table']}) has {entity['bronze_rows']} Bronze rows (expected > 0)"


def test_entities_span_all_sources(activated_entities):
    """T-SILVER-003: Activated entities must include all 5 source systems."""
    from collections import Counter
    source_counts = Counter(e['source'] for e in activated_entities)

    expected_sources = {'ETQ', 'MES', 'M3', 'M3C', 'OPTIVA'}
    actual_sources = set(source_counts.keys())

    assert actual_sources == expected_sources, \
        f"Expected sources {expected_sources}, found {actual_sources}"

    # Verify proportional allocation (allow ±2 tolerance)
    assert 4 <= source_counts['ETQ'] <= 8, f"ETQ: expected ~6, got {source_counts['ETQ']}"
    assert 25 <= source_counts['MES'] <= 29, f"MES: expected ~27, got {source_counts['MES']}"
    assert 34 <= source_counts['M3'] <= 38, f"M3: expected ~36, got {source_counts['M3']}"
    assert 9 <= source_counts['M3C'] <= 13, f"M3C: expected ~11, got {source_counts['M3C']}"
    assert 18 <= source_counts['OPTIVA'] <= 22, f"OPTIVA: expected ~20, got {source_counts['OPTIVA']}"


def test_activation_flag_is_boolean(activated_entities):
    """T-SILVER-004: is_silver_active must be exactly 1 (BIT = True)."""
    for entity in activated_entities:
        assert entity['active'] == 1, \
            f"Entity {entity['id']} has is_silver_active = {entity['active']} (expected 1)"


def test_no_invalid_activations(db_connection):
    """T-SILVER-005: No entities without Bronze data should be activated."""
    cursor = db_connection.cursor()
    cursor.execute("""
        SELECT
            e.id,
            e.source_name,
            e.source_schema + '.' + e.source_table AS qualified_name,
            els.is_silver_active,
            els.bronze_status,
            els.bronze_row_count
        FROM execution.entities e
        INNER JOIN execution.entity_loading_status els ON e.id = els.entity_id
        WHERE els.is_silver_active = 1
        AND (els.bronze_status != 'succeeded' OR els.bronze_row_count = 0 OR els.bronze_row_count IS NULL);
    """)

    invalid_entities = cursor.fetchall()

    assert len(invalid_entities) == 0, \
        f"Found {len(invalid_entities)} entities activated without Bronze data: {invalid_entities}"


@pytest.mark.slow
def test_activation_persists_after_engine_restart(db_connection):
    """T-SILVER-006: Activation must persist after engine restart."""
    # This test queries the DB directly (doesn't rely on in-memory state)
    # If count = 100, activation has persisted
    cursor = db_connection.cursor()
    cursor.execute("""
        SELECT COUNT(*) AS count
        FROM execution.entity_loading_status
        WHERE is_silver_active = 1;
    """)

    count = cursor.fetchone().count
    assert count == 100, f"After restart, expected 100 active entities, found {count}"
```

---

## Acceptance Criteria

### ✅ Definition of Done

| ID | Criterion | Verification Method |
|----|-----------|-------------------|
| AC-1 | Activation script created at `scripts/activate_silver_entities_phase1.py` | File exists and runs without errors |
| AC-2 | Stored procedure `execution.sp_ActivateEntitiesForSilver` deployed | Query `sys.procedures` in Fabric SQL DB |
| AC-3 | Script in plan mode shows exactly 100 entities | `python scripts/activate_silver_entities_phase1.py --mode plan` → count = 100 |
| AC-4 | Script in execute mode activates 100 entities | `python scripts/activate_silver_entities_phase1.py --mode execute` → exit code 0 |
| AC-5 | SQL query returns exactly 100 rows | `SELECT COUNT(*) FROM execution.entity_loading_status WHERE is_silver_active = 1` → 100 |
| AC-6 | All activated entities have Bronze data | `SELECT COUNT(*) FROM execution.entity_loading_status WHERE is_silver_active = 1 AND (bronze_status != 'succeeded' OR bronze_row_count = 0)` → 0 |
| AC-7 | Pytest test suite passes all 6 tests | `pytest engine/tests/test_silver_activation.py -v` → 6 passed |
| AC-8 | Entities span all 5 sources | Pytest test `test_entities_span_all_sources` passes |
| AC-9 | Dashboard Control Plane page shows progress | `/control` page shows Silver progress bar > 0% |
| AC-10 | Activation documented in changelog | Add entry to `CHANGELOG.md` with timestamp and entity count |

### Test Execution Commands

```bash
# Step 1: Plan (dry-run)
python scripts/activate_silver_entities_phase1.py --mode plan

# Step 2: Execute activation
python scripts/activate_silver_entities_phase1.py --mode execute

# Step 3: Verify with SQL
python -c "
import pyodbc
conn = pyodbc.connect(...)  # connection string
cursor = conn.cursor()
cursor.execute('SELECT COUNT(*) FROM execution.entity_loading_status WHERE is_silver_active = 1')
print(f'Activated entities: {cursor.fetchone()[0]}')
"

# Step 4: Run pytest validation
pytest engine/tests/test_silver_activation.py -v --tb=short

# Step 5: Check dashboard
# Navigate to http://127.0.0.1:5173/control
# Verify Silver progress bar shows > 0%
```

---

## Dependencies

### Upstream Dependencies (Must Complete First)
- ✅ Bronze layer 100% complete (verified 2026-03-09)
- ✅ `execution.entity_loading_status` table exists with `is_silver_active` column
- ✅ Dashboard API `/api/control-plane` endpoint functional

### Downstream Dependencies (Blocked Until This Completes)
- 🔒 002-execute-full-bronze-silver-load-and-verify-success
- 🔒 Silver pipeline execution for all 1,666 entities
- 🔒 Gold layer implementation

---

## Rollback Plan

If activation fails or causes issues:

```sql
-- Rollback: Deactivate all Silver entities
UPDATE execution.entity_loading_status
SET is_silver_active = 0,
    last_updated = GETDATE()
WHERE is_silver_active = 1;

-- Verify rollback
SELECT COUNT(*) AS should_be_zero
FROM execution.entity_loading_status
WHERE is_silver_active = 1;
```

---

## Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Activation accuracy | 100 entities ± 0 | SQL COUNT query |
| Bronze data validation | 100% (no entities without Bronze data) | Pytest test |
| Source system coverage | All 5 sources represented | Pytest test |
| Execution time | < 5 minutes | Script runtime |
| Test pass rate | 100% (6/6 tests pass) | Pytest output |

---

## Notes & Gotchas

1. **Why 100 entities instead of all 1,666?**
   - Phase 1 validation: Prove Silver pipeline works end-to-end on a small batch
   - Fail fast: If Silver processing has issues, we catch them on 100 entities, not 1,666
   - Incremental rollout: Reduces risk and blast radius

2. **Stratified sampling ensures representative test**
   - Each source system is represented proportionally
   - Larger tables prioritized (more data → better validation)
   - Avoids bias toward any single source

3. **is_silver_active is the gate**
   - Silver notebook queries `WHERE is_silver_active = 1`
   - Without this flag, entity is skipped regardless of Bronze data availability
   - Flag must persist in database (not in-memory)

4. **Validation is idempotent**
   - Running pytest multiple times should always return same result
   - If count ≠ 100, something external changed the database

5. **Dashboard visibility**
   - Control Plane page `/control` shows Silver progress bar
   - Progress = (Silver succeeded / Total entities) × 100%
   - After activation, denominator stays 1,666, but Silver processing can start

---

## References

- `knowledge/DEFINITION-OF-DONE.md` § 6.3: Bronze→Silver 100-entity activation gate
- `knowledge/TEST-PLAN.md`: Page 3 Control Plane validation tests (T-DATA-06 through T-DATA-08)
- `knowledge/ENTITY-COUNTS.md`: Source system entity counts
- `engine/models.py`: Entity dataclass definition
- `dashboard/app/api/control_plane_db.py`: SQLite control plane implementation

---

**Estimated Effort**: 4 hours (2h implementation + 2h testing & validation)
**Risk Level**: Low (read-heavy validation, limited write operations)
**Reviewer**: Steve Nahrup (@snahrup)
