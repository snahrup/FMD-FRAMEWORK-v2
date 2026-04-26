from __future__ import annotations

import importlib
import json
import sys

import pytest

import dashboard.app.api.control_plane_db as cpdb
import dashboard.app.api.db as db
from dashboard.app.api.router import _routes, dispatch


class FakeProvider:
    def get_token(self):
        return "token"


class FakeClient:
    def __init__(self, provider):
        self.provider = provider

    def list_capacities(self):
        return [{"id": "cap-1", "displayName": "F64 East"}]

    def list_workspaces(self):
        return [{"id": "ws-existing", "displayName": "Existing Workspace"}]

    def list_lakehouses(self, workspace_id):
        return []

    def list_sql_databases(self, workspace_id):
        return []

    def list_items(self, workspace_id, item_type=None):
        return []

    def create_or_reuse_workspace(self, display_name, capacity_id=None):
        return {"id": f"ws-{display_name.lower().replace(' ', '-')}", "displayName": display_name}, "create"

    def assign_workspace_to_capacity(self, workspace_id, capacity_id):
        return None

    def create_or_reuse_lakehouse(self, workspace_id, display_name):
        return {"id": f"lh-{display_name.lower().replace(' ', '-')}", "displayName": display_name}, "create"

    def create_or_reuse_sql_database(self, workspace_id, display_name):
        return {
            "id": "sql-1",
            "displayName": display_name,
            "properties": {"serverFqdn": "server.database.fabric.microsoft.com", "databaseName": display_name},
        }, "create"

    def create_or_reuse_item(self, workspace_id, display_name, item_type, definition=None):
        return None, "warning"


@pytest.fixture
def temp_db(tmp_path):
    db_path = tmp_path / "deployment_routes.db"
    original_db = db.DB_PATH
    original_cpdb = cpdb.DB_PATH
    db.DB_PATH = db_path
    cpdb.DB_PATH = db_path
    db.init_db()
    yield db_path
    db.DB_PATH = original_db
    cpdb.DB_PATH = original_cpdb


@pytest.fixture(autouse=True)
def setup_routes(temp_db, monkeypatch):
    _routes.clear()
    mod_name = "dashboard.app.api.routes.deployment"
    module = importlib.reload(sys.modules[mod_name]) if mod_name in sys.modules else importlib.import_module(mod_name)
    monkeypatch.setattr(module, "get_deployment_token_provider", lambda auth_mode: FakeProvider())
    monkeypatch.setattr(module, "FabricDeploymentClient", FakeClient)
    yield
    _routes.clear()


def _call(method, path, body=None, query=None, expected=200):
    status, _headers, raw = dispatch(method, path, query or {}, body)
    payload = json.loads(raw)
    assert status == expected, payload
    return payload


def _resource_names():
    return {
        "profileKey": "ipcorp-dev",
        "displayName": "IP Corp Dev",
        "authMode": "service_principal",
        "capacityId": "cap-1",
        "capacityDisplayName": "F64 East",
        "workspaces": {
            "data_dev": "IPCorp FMD Data Dev",
            "code_dev": "IPCorp FMD Code Dev",
            "config": "IPCorp FMD Config",
            "data_prod": "IPCorp FMD Data Prod",
            "code_prod": "IPCorp FMD Code Prod",
        },
        "lakehouses": {"landing": "LH_FMD_LANDING", "bronze": "LH_FMD_BRONZE", "silver": "LH_FMD_SILVER"},
        "database": {"metadata": "SQL_FMD_CONTROL_PLANE"},
        "items": {
            "landingBronzeNotebook": "NB_FMD_LOAD_LANDING_BRONZE",
            "bronzeSilverNotebook": "NB_FMD_LOAD_BRONZE_SILVER",
            "copySqlPipeline": "PL_FMD_LDZ_COPY_SQL",
        },
    }


def test_auth_status_route():
    result = _call("GET", "/api/deployments/auth/status")
    assert "authModes" in result
    assert "service_principal" in result["authModes"]


def test_capacities_route_uses_deployment_client():
    result = _call("GET", "/api/deployments/capacities", query={"authMode": "service_principal"})
    assert result["capacities"][0]["id"] == "cap-1"


def test_preview_requires_capacity():
    body = _resource_names()
    body["capacityId"] = ""
    _call("POST", "/api/deployments/preview", body=body, expected=400)


def test_preview_persists_planned_profile():
    result = _call("POST", "/api/deployments/preview", body=_resource_names())

    assert result["status"] == "planned"
    assert result["steps"]
    profile = cpdb.get_deployment_profile("ipcorp-dev")
    assert profile is not None
    assert profile["Status"] == "planned"


def test_execute_persists_result_and_warning_items():
    result = _call("POST", "/api/deployments/execute", body=_resource_names())

    assert result["status"] == "deployed"
    assert any(step["status"] == "warning" for step in result["steps"])
    profile = cpdb.get_deployment_profile("ipcorp-dev")
    assert profile is not None
    assert json.loads(profile["ResultSnapshot"])["workspaces"]["data_dev"]["id"].startswith("ws-")
