"""Tests for Source Manager import launching the real engine path."""

import unittest

from dashboard.app.api.routes import engine as engine_routes
from dashboard.app.api.routes import source_manager


class DelegateRecorder:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, *args):
        self.calls.append(args)
        if len(self.responses) == 1:
            return self.responses[0]
        return self.responses.pop(0)


class SourceImportRealLaunchTests(unittest.TestCase):
    def test_source_import_launches_framework_run_for_scoped_entities(self):
        job = source_manager.ImportJob("job-1", "MES", 2)
        delegate = DelegateRecorder([
            {"status": "passed", "checks": []},
            {"run_id": "run-12345678", "status": "started"},
        ])

        original_export = source_manager._queue_export
        original_delegate = engine_routes._delegate
        try:
            source_manager._queue_export = lambda _table: None
            engine_routes._delegate = delegate
            source_manager._run_source_import(
                job,
                {
                    "datasourceId": 9,
                    "datasourceName": "MES",
                    "tables": [{"schema": "dbo", "table": "A"}, {"schema": "dbo", "table": "B"}],
                    "entityIds": [101, 102],
                    "sourceFilter": ["MES"],
                },
            )
        finally:
            source_manager._queue_export = original_export
            engine_routes._delegate = original_delegate

        self.assertEqual(job.phase, "complete")
        self.assertEqual(job.engine_run_id, "run-12345678")
        self.assertEqual(job.to_dict()["engineRunId"], "run-12345678")
        self.assertEqual(len(delegate.calls), 2)

        launch_body = delegate.calls[1][2]
        self.assertEqual(launch_body["dagster_mode"], "framework")
        self.assertEqual(launch_body["entity_ids"], [101, 102])
        self.assertEqual(launch_body["source_filter"], ["MES"])
        self.assertEqual(launch_body["triggered_by"], "source_onboarding")

    def test_source_import_refuses_to_widen_when_no_entities_resolved(self):
        job = source_manager.ImportJob("job-2", "MES", 0)
        delegate = DelegateRecorder([{"status": "passed"}])

        original_export = source_manager._queue_export
        original_delegate = engine_routes._delegate
        try:
            source_manager._queue_export = lambda _table: None
            engine_routes._delegate = delegate
            source_manager._run_source_import(
                job,
                {
                    "datasourceId": 9,
                    "datasourceName": "MES",
                    "tables": [],
                    "entityIds": [],
                    "sourceFilter": ["MES"],
                },
            )
        finally:
            source_manager._queue_export = original_export
            engine_routes._delegate = original_delegate

        self.assertEqual(job.phase, "failed")
        self.assertIn("No active entities", job.error or "")
        self.assertEqual(delegate.calls, [])

    def test_source_import_surfaces_preflight_failure(self):
        job = source_manager.ImportJob("job-3", "MES", 1)
        delegate = DelegateRecorder([
            {
                "status": "failed",
                "checks": [
                    {
                        "label": "Runtime mode",
                        "status": "failed",
                        "message": "Dagster is still in dry-run mode.",
                    }
                ],
            }
        ])

        original_export = source_manager._queue_export
        original_delegate = engine_routes._delegate
        try:
            source_manager._queue_export = lambda _table: None
            engine_routes._delegate = delegate
            source_manager._run_source_import(
                job,
                {
                    "datasourceId": 9,
                    "datasourceName": "MES",
                    "tables": [{"schema": "dbo", "table": "A"}],
                    "entityIds": [101],
                    "sourceFilter": ["MES"],
                },
            )
        finally:
            source_manager._queue_export = original_export
            engine_routes._delegate = original_delegate

        self.assertEqual(job.phase, "failed")
        self.assertIn("Real-load preflight failed", job.error or "")
        self.assertEqual(len(delegate.calls), 1)


if __name__ == "__main__":
    unittest.main()
