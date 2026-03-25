"""Integration test for extraction method tracking and compare endpoint."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "dashboard", "app"))

import api.control_plane_db as cpdb


def test_extraction_method_column_exists():
    """DB migration adds ExtractionMethod column."""
    conn = cpdb._get_conn()

    # Seed engine_runs for wall-clock duration
    conn.execute("""
        INSERT OR IGNORE INTO engine_runs (RunId, Status, StartedAt, EndedAt, TotalDurationSeconds)
        VALUES ('test-run-cx', 'completed', '2026-03-25T10:00:00Z', '2026-03-25T10:02:00Z', 120)
    """)
    conn.execute("""
        INSERT OR IGNORE INTO engine_runs (RunId, Status, StartedAt, EndedAt, TotalDurationSeconds)
        VALUES ('test-run-pyodbc', 'completed', '2026-03-25T09:00:00Z', '2026-03-25T09:15:00Z', 900)
    """)

    # Seed task_log entries
    conn.execute("""
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsRead, DurationSeconds, ExtractionMethod, SourceTable)
        VALUES ('test-run-cx', 1, 'landing', 'succeeded', 1000, 5.0, 'connectorx', 'TestTable')
    """)
    conn.execute("""
        INSERT INTO engine_task_log (RunId, EntityId, Layer, Status, RowsRead, DurationSeconds, ExtractionMethod, SourceTable)
        VALUES ('test-run-pyodbc', 1, 'landing', 'succeeded', 1000, 25.0, 'pyodbc', 'TestTable')
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
    assert result["matched_entities"][0]["entity_id"] == 1

    # Cleanup
    conn.execute("DELETE FROM engine_task_log WHERE RunId IN ('test-run-cx', 'test-run-pyodbc')")
    conn.execute("DELETE FROM engine_runs WHERE RunId IN ('test-run-cx', 'test-run-pyodbc')")
    conn.commit()
    print("Integration test PASSED")


if __name__ == "__main__":
    test_extraction_method_column_exists()
