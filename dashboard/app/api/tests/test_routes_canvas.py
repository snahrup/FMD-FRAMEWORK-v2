import importlib
import json
import sqlite3
import sys

import pytest

import dashboard.app.api.control_plane_db as cpdb_module
import dashboard.app.api.db as db_module
from dashboard.app.api.router import _routes, dispatch


@pytest.fixture
def tmp_db(tmp_path):
    db_path = tmp_path / "test_canvas.db"
    original_db = db_module.DB_PATH
    original_cpdb = cpdb_module.DB_PATH
    db_module.DB_PATH = db_path
    cpdb_module.DB_PATH = db_path
    db_module.init_db()

    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO connections (ConnectionId, Name, Type, ServerName, DatabaseName) "
        "VALUES (1, 'MES_CONN', 'SQL', 'mes-server', 'MES')"
    )
    conn.execute(
        "INSERT INTO datasources (DataSourceId, ConnectionId, Name, DisplayName, Namespace) "
        "VALUES (1, 1, 'MES', 'MES', 'mes')"
    )
    conn.execute(
        "INSERT INTO lakehouses (LakehouseId, Name, WorkspaceGuid, LakehouseGuid) "
        "VALUES (1, 'LH_DATA_LANDINGZONE', 'ws', 'lh')"
    )
    conn.execute(
        "INSERT INTO lz_entities (LandingzoneEntityId, DataSourceId, LakehouseId, SourceSchema, SourceName, IsActive) "
        "VALUES (599, 1, 1, 'dbo', 'alel_lab_batch_hdr_tbl', 1)"
    )
    conn.commit()
    conn.close()

    yield db_path
    db_module.DB_PATH = original_db
    cpdb_module.DB_PATH = original_cpdb


@pytest.fixture(autouse=True)
def setup_routes(tmp_db):
    _routes.clear()
    mod_name = "dashboard.app.api.routes.canvas"
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)
    yield
    _routes.clear()


def _call(method: str, path: str, query=None, body=None, expected_status=200):
    status, _headers, raw = dispatch(method, path, query or {}, body)
    payload = json.loads(raw)
    assert status == expected_status, payload
    return payload


def test_canvas_routes_registered():
    methods_paths = [(m, p) for (m, p) in _routes.keys()]
    assert ("GET", "/api/canvas/flows") in methods_paths
    assert ("POST", "/api/canvas/flows") in methods_paths
    assert ("POST", "/api/canvas/flows/{flow_id}/dry-run") in methods_paths
    assert ("POST", "/api/canvas/flows/{flow_id}/run") in methods_paths


def test_get_flows_returns_default_flow():
    result = _call("GET", "/api/canvas/flows")
    assert result["count"] == 1
    flow = result["flows"][0]
    assert flow["id"] == "default-fmd-medallion"
    assert flow["nodes"][0]["config"]["entityIds"] == [599]


def test_dry_run_compiles_default_flow():
    result = _call("POST", "/api/canvas/flows/default-fmd-medallion/dry-run")
    assert result["validation"]["ok"] is True
    assert result["runPlan"]["layers"] == ["landing", "bronze", "silver"]
    assert result["runPlan"]["entityIds"] == [599]
    assert result["runPlan"]["launchPayload"]["triggered_by"] == "canvas"


def test_save_invalid_flow_returns_validation_errors():
    bad_flow = {
        "apiVersion": "fmd.flow/v1alpha1",
        "id": "bad",
        "name": "Bad Flow",
        "nodes": [
            {"id": "silver", "type": "silver_transform", "label": "Silver", "config": {"entityIds": [599]}},
        ],
        "edges": [],
    }
    result = _call("POST", "/api/canvas/flows", body={"flow": bad_flow})
    assert result["flow"]["id"] == "bad"
    assert result["validation"]["ok"] is False
    codes = {err["code"] for err in result["validation"]["errors"]}
    assert "missing_bronze_for_silver" in codes
    assert "retry_policy" in codes


def test_run_preview_does_not_call_engine():
    result = _call(
        "POST",
        "/api/canvas/flows/default-fmd-medallion/run",
        body={"previewOnly": True},
    )
    assert result["validation"]["ok"] is True
    assert result["engine"]["previewOnly"] is True
    assert result["runPlan"]["launchPayload"]["entity_ids"] == [599]


def test_secret_literals_are_rejected():
    flow = _call("GET", "/api/canvas/flows/default-fmd-medallion")["flow"]
    flow["nodes"][0]["config"]["password"] = "plain-text-password"
    result = _call(
        "POST",
        "/api/canvas/flows/default-fmd-medallion/validate",
        body={"flow": flow},
    )
    assert result["validation"]["ok"] is False
    codes = {err["code"] for err in result["validation"]["errors"]}
    assert "secret_literal" in codes

