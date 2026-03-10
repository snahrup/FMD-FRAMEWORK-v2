# Spec 005: Write control_plane_db.py Unit Test Suite (60-80% Coverage)

> **Priority**: HIGH
> **Category**: testing
> **Complexity**: medium
> **Impact**: high
> **Status**: pending
> **Owner**: sage-tower (Test Agent)
> **Blocked By**: None
> **Blocks**: CI/CD pipeline setup, production deployment

---

## User Story

**As a** Backend Developer
**I want to** have comprehensive unit tests for `control_plane_db.py` with 60-80% code coverage
**So that** the local SQLite control plane is reliable, maintainable, and regression-proof

---

## Context & Background

### Current State
**File**: `dashboard/app/api/control_plane_db.py`
**Purpose**: Local SQLite database that mirrors critical metadata from Fabric SQL DB
**Current Test Coverage**: **0%** (no tests exist)

**Why This Matters**:
- Control plane DB is the **primary data source** for the dashboard
- It stores entity status, run history, and metrics
- Dual-write architecture: writes go to both SQLite (primary) and Fabric SQL (secondary)
- If control plane DB has bugs, the entire dashboard breaks

**Architecture Decision**: See `specs/completed/029-document-local-sqlite-architecture-decision.md`
- SQLite for local reads (fast, no network latency)
- Fabric SQL for distributed writes (audit trail, cross-system access)

### Problem Statement
From `TECH-DEBT.md` Item #2:
> **control_plane_db.py has ZERO test coverage**. This is the backbone of the dashboard data layer. Needs pytest suite covering:
> - Schema creation (`init_db()`)
> - Entity CRUD operations
> - Run tracking (start/end/error)
> - Metrics aggregation
> - Concurrent write handling
> - Database migration logic
>
> **Target**: 60-80% line coverage (not 100% — that's diminishing returns)

### Success Criteria (Binary Gate)
- ✅ **60-80% code coverage** measured by `pytest-cov`
- ✅ **All critical functions tested**: `init_db`, `upsert_entity_status`, `log_run_start`, `log_run_end`, `get_metrics`
- ✅ **Edge cases covered**: NULL values, concurrent writes, schema migration, DB corruption recovery
- ✅ **Tests run in < 5 seconds** (fast feedback loop)
- ✅ **No flaky tests** (100% reproducible)
- ✅ **CI-ready**: Tests pass in GitHub Actions environment

---

## Technical Architecture

### File Under Test
**Path**: `dashboard/app/api/control_plane_db.py`
**Lines of Code**: ~600 (estimated)
**Key Functions** (must all be tested):

```python
# Schema management
def init_db() -> None
def get_db_connection() -> sqlite3.Connection
def migrate_schema(conn: sqlite3.Connection, from_version: int, to_version: int) -> None

# Entity operations
def upsert_entity_status(entity_id: int, layer: str, status: str, **kwargs) -> None
def get_entity_status(entity_id: int) -> Dict
def get_all_entities() -> List[Dict]
def update_entity_activation(entity_id: int, layer: str, is_active: bool) -> None

# Run tracking
def log_run_start(run_id: str, mode: str, entity_count: int, layers: List[str], triggered_by: str) -> None
def log_run_end(run_id: str, status: str, **metrics) -> None
def log_run_error(run_id: str, error: str) -> None
def get_run_history(limit: int = 50) -> List[Dict]
def get_latest_run() -> Optional[Dict]

# Metrics
def get_metrics(hours: int = 24) -> Dict
def get_entity_digest() -> Dict  # Source breakdown, layer completion percentages
def get_layer_stats() -> Dict

# Cleanup
def cleanup_old_runs(days: int = 30) -> int
def vacuum_database() -> None
```

### Test File Structure
**Path**: `dashboard/app/api/tests/test_control_plane_db.py`

```python
"""
Unit tests for control_plane_db.py — Local SQLite control plane.

Test Categories:
- Schema: Database initialization, migration, schema validation
- Entity CRUD: Insert, update, query, delete operations
- Run Tracking: Start/end/error logging, history queries
- Metrics: Aggregation, time-windowed queries, digest generation
- Concurrency: Thread-safe writes, race conditions
- Edge Cases: NULL handling, invalid inputs, DB corruption
- Performance: Query speed, bulk operations

Coverage Target: 60-80%
Run Time Target: < 5 seconds
"""

import pytest
import sqlite3
import os
import tempfile
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List

# Import module under test
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import control_plane_db as cpdb


# ============================================================================
# FIXTURES
# ============================================================================

@pytest.fixture
def temp_db():
    """Create a temporary SQLite database for testing."""
    fd, db_path = tempfile.mkstemp(suffix='.db')
    os.close(fd)

    # Override global DB path in module
    original_path = cpdb.DB_PATH
    cpdb.DB_PATH = db_path

    yield db_path

    # Cleanup
    cpdb.DB_PATH = original_path
    if os.path.exists(db_path):
        os.unlink(db_path)


@pytest.fixture
def initialized_db(temp_db):
    """Create and initialize a test database with schema."""
    cpdb.init_db()
    return temp_db


@pytest.fixture
def db_with_sample_data(initialized_db):
    """Create database with sample entity and run data."""
    conn = cpdb.get_db_connection()

    # Insert sample entities
    for i in range(1, 101):
        cpdb.upsert_entity_status(
            entity_id=i,
            layer='bronze',
            status='succeeded',
            row_count=1000 + i,
            duration_seconds=float(i % 60),
            source_name=['ETQ', 'MES', 'M3', 'M3C', 'OPTIVA'][i % 5],
        )

    # Insert sample runs
    cpdb.log_run_start(
        run_id='test-run-001',
        mode='execute',
        entity_count=100,
        layers=['landing', 'bronze'],
        triggered_by='pytest',
    )
    cpdb.log_run_end(
        run_id='test-run-001',
        status='Succeeded',
        total_entities=100,
        succeeded_entities=98,
        failed_entities=2,
        total_rows_read=50000,
        duration_seconds=300.0,
    )

    conn.close()
    return initialized_db


# ============================================================================
# SCHEMA TESTS
# ============================================================================

def test_init_db_creates_schema(temp_db):
    """T-CPDB-001: init_db() creates all required tables."""
    cpdb.init_db()

    conn = cpdb.get_db_connection()
    cursor = conn.cursor()

    # Check that all expected tables exist
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
    tables = [row[0] for row in cursor.fetchall()]

    expected_tables = ['entity_status', 'run_history', 'task_logs', 'schema_version']
    for table in expected_tables:
        assert table in tables, f"Table {table} not created"

    conn.close()


def test_init_db_idempotent(temp_db):
    """T-CPDB-002: Calling init_db() multiple times is safe."""
    cpdb.init_db()
    cpdb.init_db()  # Should not raise error or duplicate tables

    conn = cpdb.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table';")
    table_count = cursor.fetchone()[0]

    # Exact count depends on schema, but should be consistent
    cpdb.init_db()  # Third call
    cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table';")
    assert cursor.fetchone()[0] == table_count, "Table count changed after multiple init_db calls"

    conn.close()


def test_schema_version_table_exists(initialized_db):
    """T-CPDB-003: schema_version table tracks current schema version."""
    conn = cpdb.get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT version FROM schema_version ORDER BY applied_at DESC LIMIT 1;")
    version = cursor.fetchone()

    assert version is not None, "No schema version recorded"
    assert version[0] >= 1, f"Schema version {version[0]} is invalid (expected >= 1)"

    conn.close()


# ============================================================================
# ENTITY CRUD TESTS
# ============================================================================

def test_upsert_entity_status_insert(initialized_db):
    """T-CPDB-004: upsert_entity_status() inserts new entity."""
    cpdb.upsert_entity_status(
        entity_id=999,
        layer='bronze',
        status='succeeded',
        row_count=5000,
        duration_seconds=120.5,
        source_name='ETQ',
    )

    entity = cpdb.get_entity_status(999)

    assert entity is not None
    assert entity['entity_id'] == 999
    assert entity['bronze_status'] == 'succeeded'
    assert entity['bronze_row_count'] == 5000
    assert entity['source_name'] == 'ETQ'


def test_upsert_entity_status_update(initialized_db):
    """T-CPDB-005: upsert_entity_status() updates existing entity."""
    # Insert
    cpdb.upsert_entity_status(entity_id=1, layer='bronze', status='pending', row_count=0)

    # Update
    cpdb.upsert_entity_status(entity_id=1, layer='bronze', status='succeeded', row_count=1000)

    entity = cpdb.get_entity_status(1)
    assert entity['bronze_status'] == 'succeeded'
    assert entity['bronze_row_count'] == 1000


def test_get_entity_status_not_found(initialized_db):
    """T-CPDB-006: get_entity_status() returns None for missing entity."""
    entity = cpdb.get_entity_status(99999)
    assert entity is None


def test_get_all_entities_empty(initialized_db):
    """T-CPDB-007: get_all_entities() returns empty list when no data."""
    entities = cpdb.get_all_entities()
    assert entities == []


def test_get_all_entities_with_data(db_with_sample_data):
    """T-CPDB-008: get_all_entities() returns all entities."""
    entities = cpdb.get_all_entities()

    assert len(entities) == 100
    assert all('entity_id' in e for e in entities)
    assert all('source_name' in e for e in entities)


def test_update_entity_activation(initialized_db):
    """T-CPDB-009: update_entity_activation() sets activation flag."""
    cpdb.upsert_entity_status(entity_id=1, layer='silver', status='pending')

    cpdb.update_entity_activation(entity_id=1, layer='silver', is_active=True)

    entity = cpdb.get_entity_status(1)
    assert entity['is_silver_active'] == 1  # SQLite BIT = integer 1

    cpdb.update_entity_activation(entity_id=1, layer='silver', is_active=False)

    entity = cpdb.get_entity_status(1)
    assert entity['is_silver_active'] == 0


# ============================================================================
# RUN TRACKING TESTS
# ============================================================================

def test_log_run_start(initialized_db):
    """T-CPDB-010: log_run_start() creates run record."""
    run_id = 'test-run-abc123'

    cpdb.log_run_start(
        run_id=run_id,
        mode='execute',
        entity_count=100,
        layers=['landing', 'bronze', 'silver'],
        triggered_by='pytest-user',
    )

    run = cpdb.get_latest_run()

    assert run is not None
    assert run['run_id'] == run_id
    assert run['status'] == 'InProgress'
    assert run['total_entities'] == 100
    assert run['triggered_by'] == 'pytest-user'


def test_log_run_end_updates_status(initialized_db):
    """T-CPDB-011: log_run_end() updates run with final metrics."""
    run_id = 'test-run-def456'

    cpdb.log_run_start(run_id=run_id, mode='execute', entity_count=50, layers=['bronze'], triggered_by='test')

    cpdb.log_run_end(
        run_id=run_id,
        status='Succeeded',
        total_entities=50,
        succeeded_entities=48,
        failed_entities=2,
        total_rows_read=100000,
        duration_seconds=600.0,
    )

    run = cpdb.get_latest_run()

    assert run['run_id'] == run_id
    assert run['status'] == 'Succeeded'
    assert run['succeeded_entities'] == 48
    assert run['failed_entities'] == 2
    assert run['total_rows_read'] == 100000
    assert run['duration_seconds'] == 600.0


def test_log_run_error(initialized_db):
    """T-CPDB-012: log_run_error() records error message."""
    run_id = 'test-run-error'

    cpdb.log_run_start(run_id=run_id, mode='execute', entity_count=10, layers=['landing'], triggered_by='test')

    cpdb.log_run_error(run_id=run_id, error='Catastrophic failure: Network timeout')

    run = cpdb.get_latest_run()

    assert run['run_id'] == run_id
    assert run['status'] == 'Failed'
    assert 'Network timeout' in run['error_summary']


def test_get_run_history_limit(db_with_sample_data):
    """T-CPDB-013: get_run_history() respects limit parameter."""
    # Insert 10 runs
    for i in range(10):
        cpdb.log_run_start(f'run-{i}', 'execute', 100, ['landing'], 'test')
        cpdb.log_run_end(f'run-{i}', 'Succeeded', total_entities=100, succeeded_entities=100)

    history = cpdb.get_run_history(limit=5)

    assert len(history) == 5


def test_get_run_history_order(db_with_sample_data):
    """T-CPDB-014: get_run_history() returns most recent runs first."""
    history = cpdb.get_run_history(limit=10)

    # Should be sorted by started_at DESC
    for i in range(len(history) - 1):
        assert history[i]['started_at'] >= history[i+1]['started_at'], \
            "Run history not sorted by descending timestamp"


# ============================================================================
# METRICS TESTS
# ============================================================================

def test_get_metrics_empty_db(initialized_db):
    """T-CPDB-015: get_metrics() returns zeros for empty database."""
    metrics = cpdb.get_metrics(hours=24)

    assert metrics['total_entities'] == 0
    assert metrics['succeeded_entities'] == 0
    assert metrics['failed_entities'] == 0


def test_get_metrics_with_data(db_with_sample_data):
    """T-CPDB-016: get_metrics() aggregates entity status."""
    metrics = cpdb.get_metrics(hours=24)

    assert metrics['total_entities'] == 100
    # Sample data has 100 entities with status 'succeeded'
    assert metrics['succeeded_entities'] > 0


def test_get_entity_digest(db_with_sample_data):
    """T-CPDB-017: get_entity_digest() returns source breakdown."""
    digest = cpdb.get_entity_digest()

    assert 'total_entities' in digest
    assert 'source_breakdown' in digest
    assert len(digest['source_breakdown']) == 5  # ETQ, MES, M3, M3C, OPTIVA

    # Verify source counts sum to total
    source_sum = sum(s['count'] for s in digest['source_breakdown'])
    assert source_sum == digest['total_entities']


def test_get_layer_stats(db_with_sample_data):
    """T-CPDB-018: get_layer_stats() returns layer completion percentages."""
    stats = cpdb.get_layer_stats()

    assert 'landing' in stats
    assert 'bronze' in stats
    assert 'silver' in stats

    for layer in ['landing', 'bronze', 'silver']:
        assert 'succeeded' in stats[layer]
        assert 'failed' in stats[layer]
        assert 'pending' in stats[layer]
        assert 'completion_pct' in stats[layer]


# ============================================================================
# CONCURRENCY TESTS
# ============================================================================

def test_concurrent_writes(initialized_db):
    """T-CPDB-019: Database handles concurrent writes without corruption."""
    def writer(entity_id):
        for i in range(10):
            cpdb.upsert_entity_status(
                entity_id=entity_id,
                layer='bronze',
                status='succeeded',
                row_count=i * 100,
            )
            time.sleep(0.001)  # Simulate some work

    threads = []
    for entity_id in range(1, 11):
        t = threading.Thread(target=writer, args=(entity_id,))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    # All 10 entities should exist with final row count = 900
    for entity_id in range(1, 11):
        entity = cpdb.get_entity_status(entity_id)
        assert entity is not None
        assert entity['bronze_row_count'] == 900


def test_concurrent_run_tracking(initialized_db):
    """T-CPDB-020: Multiple runs can be tracked concurrently."""
    def run_tracker(run_id):
        cpdb.log_run_start(run_id, 'execute', 50, ['landing'], 'test')
        time.sleep(0.01)
        cpdb.log_run_end(run_id, 'Succeeded', total_entities=50, succeeded_entities=50)

    threads = []
    for i in range(5):
        t = threading.Thread(target=run_tracker, args=(f'concurrent-run-{i}',))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    history = cpdb.get_run_history(limit=10)
    assert len(history) >= 5


# ============================================================================
# EDGE CASE TESTS
# ============================================================================

def test_upsert_entity_status_null_values(initialized_db):
    """T-CPDB-021: upsert_entity_status() handles NULL values correctly."""
    cpdb.upsert_entity_status(
        entity_id=1,
        layer='bronze',
        status='failed',
        row_count=None,  # NULL row count (entity failed)
        duration_seconds=None,
        error_message='Connection timeout',
    )

    entity = cpdb.get_entity_status(1)

    assert entity['bronze_status'] == 'failed'
    assert entity['bronze_row_count'] is None
    assert entity['bronze_error_message'] == 'Connection timeout'


def test_get_metrics_time_window(initialized_db):
    """T-CPDB-022: get_metrics() respects time window parameter."""
    # Insert old entity (25 hours ago)
    old_timestamp = datetime.utcnow() - timedelta(hours=25)
    conn = cpdb.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO entity_status (entity_id, bronze_status, bronze_last_load_datetime)
        VALUES (?, ?, ?);
    """, (999, 'succeeded', old_timestamp.isoformat()))
    conn.commit()

    # Insert recent entity (1 hour ago)
    cpdb.upsert_entity_status(entity_id=1, layer='bronze', status='succeeded')

    # Query last 24 hours
    metrics_24h = cpdb.get_metrics(hours=24)

    # Old entity should NOT be included (outside 24h window)
    assert metrics_24h['total_entities'] == 1  # Only entity 1


def test_cleanup_old_runs(db_with_sample_data):
    """T-CPDB-023: cleanup_old_runs() deletes runs older than X days."""
    # Insert old run (35 days ago)
    old_timestamp = datetime.utcnow() - timedelta(days=35)
    conn = cpdb.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO run_history (run_id, status, total_entities, started_at)
        VALUES (?, ?, ?, ?);
    """, ('old-run-999', 'Succeeded', 100, old_timestamp.isoformat()))
    conn.commit()

    # Cleanup runs older than 30 days
    deleted_count = cpdb.cleanup_old_runs(days=30)

    assert deleted_count >= 1

    # Verify old run was deleted
    cursor.execute("SELECT COUNT(*) FROM run_history WHERE run_id = 'old-run-999';")
    assert cursor.fetchone()[0] == 0


def test_vacuum_database(db_with_sample_data):
    """T-CPDB-024: vacuum_database() reclaims space and defragments."""
    # Get DB size before vacuum
    conn = cpdb.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA page_count;")
    pages_before = cursor.fetchone()[0]

    # Delete some data
    cursor.execute("DELETE FROM entity_status WHERE entity_id > 50;")
    conn.commit()

    # Vacuum
    cpdb.vacuum_database()

    # Check size after vacuum (should be same or smaller)
    cursor.execute("PRAGMA page_count;")
    pages_after = cursor.fetchone()[0]

    assert pages_after <= pages_before


# ============================================================================
# PERFORMANCE TESTS
# ============================================================================

@pytest.mark.slow
def test_bulk_insert_performance(initialized_db):
    """T-CPDB-025: Bulk inserting 1,666 entities completes in < 2 seconds."""
    start = time.time()

    for i in range(1, 1667):
        cpdb.upsert_entity_status(
            entity_id=i,
            layer='bronze',
            status='succeeded',
            row_count=1000,
        )

    duration = time.time() - start

    assert duration < 2.0, f"Bulk insert took {duration:.2f}s (expected < 2s)"


@pytest.mark.slow
def test_query_performance_large_dataset(initialized_db):
    """T-CPDB-026: Querying entity digest with 1,666 entities completes in < 0.5s."""
    # Insert 1,666 entities
    for i in range(1, 1667):
        cpdb.upsert_entity_status(entity_id=i, layer='bronze', status='succeeded', row_count=1000)

    start = time.time()
    digest = cpdb.get_entity_digest()
    duration = time.time() - start

    assert duration < 0.5, f"Entity digest query took {duration:.2f}s (expected < 0.5s)"
    assert digest['total_entities'] == 1666


# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    pytest.main([__file__, '-v', '--cov=control_plane_db', '--cov-report=term-missing'])
```

---

## Acceptance Criteria

### ✅ Definition of Done

| ID | Criterion | Verification Method |
|----|-----------|-------------------|
| AC-1 | Test file created at `dashboard/app/api/tests/test_control_plane_db.py` | File exists |
| AC-2 | All 26 tests pass | `pytest dashboard/app/api/tests/test_control_plane_db.py -v` → 26 passed |
| AC-3 | Code coverage 60-80% | `pytest --cov=control_plane_db --cov-report=term` → coverage % in range |
| AC-4 | Tests run in < 5 seconds | `pytest --durations=0` → total time < 5s |
| AC-5 | No flaky tests | Run tests 10 times, all pass 100% |
| AC-6 | Coverage report generated | HTML report at `htmlcov/index.html` |
| AC-7 | All critical functions tested | Schema, CRUD, run tracking, metrics all covered |
| AC-8 | Concurrency tests pass | Tests T-CPDB-019 and T-CPDB-020 pass |
| AC-9 | Edge cases covered | NULL handling, time windows, cleanup tested |
| AC-10 | Performance tests pass | Bulk insert < 2s, query < 0.5s |

### Test Execution Commands

```bash
# Step 1: Run all tests
pytest dashboard/app/api/tests/test_control_plane_db.py -v

# Step 2: Generate coverage report
pytest dashboard/app/api/tests/test_control_plane_db.py \
  --cov=dashboard.app.api.control_plane_db \
  --cov-report=term-missing \
  --cov-report=html

# Step 3: Check coverage percentage
pytest dashboard/app/api/tests/test_control_plane_db.py \
  --cov=dashboard.app.api.control_plane_db \
  --cov-report=term \
  | grep "TOTAL"

# Expected output:
# TOTAL    600    120    80%   60-80% coverage

# Step 4: Run specific test categories
pytest dashboard/app/api/tests/test_control_plane_db.py -k "schema"  # Schema tests only
pytest dashboard/app/api/tests/test_control_plane_db.py -k "entity"  # Entity CRUD tests
pytest dashboard/app/api/tests/test_control_plane_db.py -k "run"     # Run tracking tests
pytest dashboard/app/api/tests/test_control_plane_db.py -k "metrics" # Metrics tests
pytest dashboard/app/api/tests/test_control_plane_db.py -k "concurrent"  # Concurrency tests

# Step 5: Check test duration
pytest dashboard/app/api/tests/test_control_plane_db.py --durations=10

# Step 6: Test flakiness (run 10 times)
for i in {1..10}; do pytest dashboard/app/api/tests/test_control_plane_db.py -q || exit 1; done

# Step 7: Open HTML coverage report
# Windows: start htmlcov/index.html
# Linux/Mac: open htmlcov/index.html
```

---

## Dependencies

### Upstream Dependencies
- ✅ `control_plane_db.py` exists and is functional
- ✅ pytest and pytest-cov installed (`pip install pytest pytest-cov`)

### Downstream Dependencies
- 🔒 009-set-up-continuous-integration-pipeline (CI needs tests to run)
- 🔒 Production deployment (requires test coverage gate)

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Code coverage | 60-80% | pytest-cov report |
| Test count | ≥ 25 tests | pytest collection |
| Pass rate | 100% | All tests pass |
| Execution time | < 5 seconds | pytest --durations |
| Flakiness | 0% | 10 consecutive runs, all pass |
| Lines covered | ≥ 360/600 | pytest-cov line report |

---

## Notes & Gotchas

1. **Why 60-80% coverage, not 100%?**
   - Diminishing returns: Last 20% often trivial (getters, simple error paths)
   - Focus on critical business logic, not boilerplate
   - 80%+ can lead to brittle tests that test implementation, not behavior

2. **SQLite threading model**
   - SQLite has limited concurrency (single writer at a time)
   - Tests use `threading` to simulate concurrent writes
   - Real-world: Web server has multiple request threads

3. **Temporary database fixture**
   - Each test gets a fresh database (no state pollution)
   - `temp_db` fixture creates new file, `initialized_db` initializes schema
   - Cleanup happens automatically after test

4. **Performance test caveats**
   - Marked with `@pytest.mark.slow` (can skip with `pytest -m "not slow"`)
   - Performance varies by machine (may need to adjust thresholds)
   - Use these as regression detectors, not absolute benchmarks

5. **Coverage blind spots** (intentionally not tested):
   - Error handling for disk full (hard to simulate)
   - Database corruption recovery (rare edge case)
   - Platform-specific code paths (Windows vs Linux)

---

## References

- `dashboard/app/api/control_plane_db.py`: Module under test
- `specs/completed/029-document-local-sqlite-architecture-decision.md`: Rationale for SQLite architecture
- `knowledge/TECH-DEBT.md` Item #2: Control plane DB test coverage debt
- pytest documentation: https://docs.pytest.org/
- pytest-cov documentation: https://pytest-cov.readthedocs.io/

---

**Estimated Effort**: 6 hours (4h test writing + 2h debugging & refinement)
**Risk Level**: Low (pure testing, no production code changes)
**Reviewer**: sage-tower (@sage-tower)
