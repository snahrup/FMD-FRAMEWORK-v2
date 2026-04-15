import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import dashboard.app.api.control_plane_db as cpdb
import dashboard.app.api.db as dashboard_db
import engine.self_heal as self_heal


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "self_heal_control_plane.db"
    monkeypatch.setattr(cpdb, "DB_PATH", db_path, raising=False)
    monkeypatch.setattr(dashboard_db, "DB_PATH", db_path, raising=False)
    monkeypatch.setattr(self_heal, "_db_initialized", False, raising=False)
    cpdb.init_db()
    yield db_path
    monkeypatch.setattr(self_heal, "_db_initialized", False, raising=False)


def _seed_registered_entity():
    cpdb.upsert_connection({
        "ConnectionId": 1,
        "ConnectionGuid": "conn-guid-1",
        "Name": "CON_MES",
        "Type": "SQL",
        "ServerName": "m3-db1",
        "DatabaseName": "mes",
        "IsActive": 1,
    })
    cpdb.upsert_datasource({
        "DataSourceId": 1,
        "ConnectionId": 1,
        "Name": "MES",
        "Namespace": "MES",
        "Type": "Database",
        "Description": "Manufacturing Execution System",
        "IsActive": 1,
    })
    cpdb.upsert_lakehouse({
        "LakehouseId": 1,
        "Name": "LH_LANDINGZONE",
        "WorkspaceGuid": "ws-guid",
        "LakehouseGuid": "lh-guid",
    })
    cpdb.upsert_lz_entity({
        "LandingzoneEntityId": 101,
        "DataSourceId": 1,
        "LakehouseId": 1,
        "SourceSchema": "dbo",
        "SourceName": "CUSCONGB",
        "FileName": "CUSCONGB.parquet",
        "FilePath": "MES",
        "IsActive": 1,
    })


def test_queue_failure_case_creates_visible_case(monkeypatch):
    _seed_registered_entity()
    monkeypatch.setattr(self_heal, "ensure_daemon_started", lambda settings=None: 4321)

    case_id = self_heal.queue_failure_case(
        parent_run_id="run-1",
        layer="landing",
        landing_entity_id=101,
        target_entity_id=101,
        latest_error="VPN timeout",
        error_suggestion="Reconnect and retry.",
        context={"sourceSchema": "dbo", "sourceName": "CUSCONGB"},
    )

    assert case_id is not None

    payload = self_heal.get_self_heal_status_payload(limit_cases=5, limit_events=3)
    assert payload["summary"]["queuedCount"] == 1
    assert payload["summary"]["totalCount"] == 1
    assert payload["selectedAgent"] in {"claude", "codex"}

    queued_case = payload["cases"][0]
    assert queued_case["id"] == case_id
    assert queued_case["landingEntityId"] == 101
    assert queued_case["targetEntityId"] == 101
    assert queued_case["source"] == "MES"
    assert queued_case["schema"] == "dbo"
    assert queued_case["table"] == "CUSCONGB"
    assert queued_case["events"][0]["step"] == "queued"


def test_queue_failure_case_reuses_open_case(monkeypatch):
    _seed_registered_entity()
    monkeypatch.setattr(self_heal, "ensure_daemon_started", lambda settings=None: 4321)

    first = self_heal.queue_failure_case(
        parent_run_id="run-2",
        layer="bronze",
        landing_entity_id=101,
        target_entity_id=201,
        latest_error="Delta write failed",
        error_suggestion="Inspect ADLS write path.",
        context={"layer": "bronze"},
    )
    second = self_heal.queue_failure_case(
        parent_run_id="run-2",
        layer="bronze",
        landing_entity_id=101,
        target_entity_id=201,
        latest_error="Delta write failed again",
        error_suggestion="Retry after bounded fix.",
        context={"layer": "bronze", "attempt": 2},
    )

    assert first == second

    payload = self_heal.get_self_heal_status_payload(limit_cases=5, limit_events=3)
    assert payload["summary"]["totalCount"] == 1
    assert payload["cases"][0]["latestError"] == "Delta write failed again"
