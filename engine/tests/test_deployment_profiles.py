from __future__ import annotations

import json

import dashboard.app.api.control_plane_db as cpdb
import dashboard.app.api.db as db
from dashboard.app.api.deployment_profiles import (
    deployment_result_to_environment_config,
    save_environment_config,
)


def test_deployment_tables_created(tmp_path):
    db_path = tmp_path / "deployments.db"
    original_db = db.DB_PATH
    original_cpdb = cpdb.DB_PATH
    db.DB_PATH = db_path
    cpdb.DB_PATH = db_path
    try:
        db.init_db()
        rows = db.query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
            "('deployment_profiles', 'deployment_steps')"
        )
        assert {row["name"] for row in rows} == {"deployment_profiles", "deployment_steps"}
    finally:
        db.DB_PATH = original_db
        cpdb.DB_PATH = original_cpdb


def test_deployment_profile_and_steps_round_trip(tmp_path):
    db_path = tmp_path / "deployments.db"
    original_db = db.DB_PATH
    original_cpdb = cpdb.DB_PATH
    db.DB_PATH = db_path
    cpdb.DB_PATH = db_path
    try:
        db.init_db()
        cpdb.upsert_deployment_profile(
            {
                "ProfileKey": "ipcorp-dev",
                "DisplayName": "IP Corp Dev",
                "Status": "planned",
                "AuthMode": "service_principal",
                "CapacityId": "cap-001",
                "CapacityName": "F64 East",
                "ResourcePlan": json.dumps({"steps": 1}),
            }
        )
        cpdb.upsert_deployment_step(
            {
                "ProfileKey": "ipcorp-dev",
                "StepKey": "workspace.data_dev",
                "StepType": "workspace",
                "DisplayName": "IPCorp FMD Data Dev",
                "Status": "succeeded",
                "FabricResourceId": "ws-001",
                "Action": "reuse",
                "Details": json.dumps({"displayName": "IPCorp FMD Data Dev"}),
            }
        )

        profile = cpdb.get_deployment_profile("ipcorp-dev")
        steps = cpdb.list_deployment_steps("ipcorp-dev")

        assert profile is not None
        assert profile["Status"] == "planned"
        assert profile["CapacityId"] == "cap-001"
        assert len(steps) == 1
        assert steps[0]["StepKey"] == "workspace.data_dev"
        assert steps[0]["Action"] == "reuse"
    finally:
        db.DB_PATH = original_db
        cpdb.DB_PATH = original_cpdb


def test_deployment_result_maps_to_config_and_sqlite(tmp_path):
    db_path = tmp_path / "deployments.db"
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps({"fabric": {}, "engine": {}, "sql": {}}), encoding="utf-8")
    original_db = db.DB_PATH
    original_cpdb = cpdb.DB_PATH
    db.DB_PATH = db_path
    cpdb.DB_PATH = db_path
    try:
        db.init_db()
        result = {
            "capacity": {"id": "cap-1", "displayName": "F64 East"},
            "workspaces": {
                "data_dev": {"id": "ws-data", "displayName": "Data Dev"},
                "code_dev": {"id": "ws-code", "displayName": "Code Dev"},
                "config": {"id": "ws-config", "displayName": "Config"},
            },
            "lakehouses": {
                "landing": {"id": "lh-landing", "displayName": "LH_FMD_LANDING", "workspaceGuid": "ws-data"},
                "bronze": {"id": "lh-bronze", "displayName": "LH_FMD_BRONZE", "workspaceGuid": "ws-data"},
                "silver": {"id": "lh-silver", "displayName": "LH_FMD_SILVER", "workspaceGuid": "ws-data"},
            },
            "database": {
                "id": "sql-1",
                "displayName": "SQL_FMD_CONTROL_PLANE",
                "serverFqdn": "server.database.fabric.microsoft.com",
                "databaseName": "SQL_FMD_CONTROL_PLANE",
            },
            "items": {
                "copySqlPipeline": {"id": "pl-1", "displayName": "PL_FMD_LDZ_COPY_SQL"},
            },
        }

        config = deployment_result_to_environment_config(result)
        propagation = save_environment_config(config, profile_key="ipcorp-dev", config_path=config_path)

        saved = json.loads(config_path.read_text(encoding="utf-8"))
        assert saved["fabric"]["workspace_data_id"] == "ws-data"
        assert saved["engine"]["bronze_lakehouse_id"] == "lh-bronze"
        assert saved["engine"]["pipeline_copy_sql_id"] == "pl-1"
        assert any(item["target"] == "item_config.yaml" and item["status"] == "warning" for item in propagation)
        assert cpdb.get_workspaces()
        assert cpdb.get_lakehouses()
        assert cpdb.get_pipelines()
    finally:
        db.DB_PATH = original_db
        cpdb.DB_PATH = original_cpdb
