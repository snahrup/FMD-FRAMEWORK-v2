from __future__ import annotations

import json

import dashboard.app.api.control_plane_db as cpdb
import dashboard.app.api.db as db
from dashboard.app.api.deployment_validation import validate_deployment_profile


class FakeProvider:
    def get_token(self):
        return "token"


class FakeClient:
    def list_capacities(self):
        return [{"id": "cap-1", "displayName": "F64 East"}]

    def list_workspaces(self):
        return [{"id": "ws-data", "displayName": "Data"}]

    def list_lakehouses(self, workspace_id):
        return [{"id": "lh-bronze", "displayName": "LH_FMD_BRONZE"}]


def test_validation_reports_missing_config_as_failed_sql(tmp_path, monkeypatch):
    db_path = tmp_path / "validation.db"
    original_db = db.DB_PATH
    original_cpdb = cpdb.DB_PATH
    db.DB_PATH = db_path
    cpdb.DB_PATH = db_path
    try:
        db.init_db()
        result = {
            "capacity": {"id": "cap-1", "displayName": "F64 East"},
            "workspaces": {"data_dev": {"id": "ws-data", "displayName": "Data"}},
            "lakehouses": {"bronze": {"id": "lh-bronze", "displayName": "LH_FMD_BRONZE"}},
            "database": {},
        }
        cpdb.upsert_deployment_profile(
            {
                "ProfileKey": "ipcorp-dev",
                "DisplayName": "IP Corp Dev",
                "Status": "deployed",
                "AuthMode": "service_principal",
                "CapacityId": "cap-1",
                "CapacityName": "F64 East",
                "ResultSnapshot": json.dumps(result),
            }
        )
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps({"sql": {}, "engine": {}}), encoding="utf-8")
        monkeypatch.delenv("ONELAKE_MOUNT_PATH", raising=False)

        proof = validate_deployment_profile("ipcorp-dev", client=FakeClient(), token_provider=FakeProvider(), config_path=config_path)

        checks = {item["id"]: item for item in proof["checks"]}
        assert checks["fabric_token"]["status"] == "passed"
        assert checks["sql_metadata"]["status"] == "failed"
        assert proof["ok"] is False
    finally:
        db.DB_PATH = original_db
        cpdb.DB_PATH = original_cpdb
