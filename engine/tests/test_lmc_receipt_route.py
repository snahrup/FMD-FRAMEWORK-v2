"""Unit tests for Mission Control real-load receipt route."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from dashboard.app.api.routes import load_mission_control as lmc


class _FakeDb:
    def __init__(self, rows_by_sql: dict[str, list[dict]]):
        self.rows_by_sql = rows_by_sql

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        if "FROM engine_runs" in sql:
            return self.rows_by_sql.get("engine_runs", [])
        if "FROM engine_task_log" in sql:
            return self.rows_by_sql.get("engine_task_log", [])
        return []


class LmcReceiptRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._original_db = lmc.db
        self._original_receipt_path = lmc._receipt_path_for_run

    def tearDown(self) -> None:
        lmc.db = self._original_db
        lmc._receipt_path_for_run = self._original_receipt_path

    def test_returns_task_log_artifacts_when_receipt_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            missing_receipt = Path(temp) / "missing" / "receipt.json"
            lmc._receipt_path_for_run = lambda run_id: missing_receipt
            lmc.db = _FakeDb({
                "engine_runs": [{"RunId": "run-001", "Status": "Succeeded"}],
                "engine_task_log": [{
                    "EntityId": 599,
                    "Layer": "landing",
                    "Status": "succeeded",
                    "SourceTable": "dbo.TableA",
                    "RowsRead": 5,
                    "RowsWritten": 5,
                    "BytesTransferred": 512,
                    "TargetPath": "LZ/Files/MES/TableA.parquet",
                    "created_at": "2026-04-25T00:00:00Z",
                }],
            })

            payload = lmc.get_lmc_run_receipt({"run_id": "run-001"})

        self.assertFalse(payload["available"])
        self.assertEqual(payload["summary"]["notChecked"], 1)
        self.assertEqual(payload["artifacts"][0]["artifactStatus"], "not_checked")

    def test_flattens_machine_receipt_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            receipt_path = Path(temp) / "receipt.json"
            receipt_path.write_text(json.dumps({
                "ok": True,
                "generatedAt": "2026-04-25T00:00:00Z",
                "summary": {"passed": 2, "warnings": 0, "notChecked": 0, "failed": 0},
                "checks": [{"id": "engine_run", "status": "passed", "message": "ok"}],
                "entities": [{
                    "landingEntityId": 599,
                    "qualifiedName": "dbo.TableA",
                    "layers": {
                        "landing": {
                            "status": "passed",
                            "entityId": 599,
                            "task": {"Status": "succeeded", "RowsRead": 5, "RowsWritten": 5, "BytesTransferred": 512},
                            "artifactCheck": {
                                "status": "passed",
                                "targetPath": "LZ/Files/MES/TableA.parquet",
                                "localPath": "C:/OneLake/LH.Lakehouse/Files/MES/TableA.parquet",
                                "message": "Landing parquet exists.",
                            },
                        },
                    },
                }],
            }), encoding="utf-8")
            lmc._receipt_path_for_run = lambda run_id: receipt_path
            lmc.db = _FakeDb({
                "engine_runs": [{"RunId": "run-001", "Status": "Succeeded"}],
                "engine_task_log": [],
            })

            payload = lmc.get_lmc_run_receipt({"run_id": "run-001"})

        self.assertTrue(payload["available"])
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["artifacts"][0]["localPath"], "C:/OneLake/LH.Lakehouse/Files/MES/TableA.parquet")


if __name__ == "__main__":
    unittest.main()
