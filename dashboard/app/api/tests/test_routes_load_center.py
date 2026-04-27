import importlib
import sys
import types

import pytest


@pytest.fixture
def load_center_module():
    mod_name = "dashboard.app.api.routes.load_center"
    if mod_name in sys.modules:
        return importlib.reload(sys.modules[mod_name])
    return importlib.import_module(mod_name)


def test_get_outstanding_registered_entities_excludes_completed_entities(load_center_module):
    truth = {
        "registered": [
            {
                "entity_id": 1,
                "data_source_id": 7,
                "schema": "dbo",
                "table_name": "done_table",
                "source_name": "MES",
                "source_display": "MES",
            },
            {
                "entity_id": 2,
                "data_source_id": 7,
                "schema": "dbo",
                "table_name": "todo_table",
                "source_name": "MES",
                "source_display": "MES",
            },
        ],
        "logLookup": {
            ("lz", 7, "dbo", "done_table"): {},
            ("bronze", 7, "dbo", "done_table"): {},
            ("silver", 7, "dbo", "done_table"): {},
            ("lz", 7, "dbo", "todo_table"): {},
        },
    }

    result = load_center_module._get_outstanding_registered_entities(truth)

    assert [row["entity_id"] for row in result] == [2]


def test_post_load_center_run_dry_run_defaults_to_active_catalog(monkeypatch, load_center_module):
    truth = {
        "registered": [
            {
                "entity_id": 1,
                "data_source_id": 7,
                "schema": "dbo",
                "table_name": "done_table",
                "source_name": "MES",
                "source_display": "MES",
            },
            {
                "entity_id": 2,
                "data_source_id": 7,
                "schema": "dbo",
                "table_name": "todo_table",
                "source_name": "MES",
                "source_display": "MES",
            },
            {
                "entity_id": 3,
                "data_source_id": 8,
                "schema": "dbo",
                "table_name": "other_source_todo",
                "source_name": "ETQ",
                "source_display": "ETQ",
            },
        ],
        "logLookup": {
            ("lz", 7, "dbo", "done_table"): {},
            ("bronze", 7, "dbo", "done_table"): {},
            ("silver", 7, "dbo", "done_table"): {},
            ("lz", 7, "dbo", "todo_table"): {},
        },
    }
    captured: dict[str, list[int]] = {}

    monkeypatch.setattr(load_center_module, "_build_canonical_pipeline_truth", lambda: truth)

    def fake_build_completion_plan(entities):
        captured["entity_ids"] = [int(entity["entity_id"]) for entity in entities]
        return {
            "plan": {
                "fullLoad": [],
                "incremental": [],
                "gapFill": [],
                "needsOptimize": [],
                "totalEntities": len(entities),
                "summary": {"totalEntities": len(entities)},
            },
            "byEntity": {},
        }

    monkeypatch.setattr(load_center_module, "_build_completion_plan", fake_build_completion_plan)
    load_center_module._run_state.clear()
    load_center_module._run_state.update({"active": False})

    result = load_center_module.post_load_center_run({"dryRun": True, "sources": ["MES"]})

    assert captured["entity_ids"] == [1, 2]
    assert result["runScope"] == "active_catalog"
    assert result["plan"]["summary"]["totalEntities"] == 2


def test_post_load_center_run_can_scope_to_outstanding_entities(monkeypatch, load_center_module):
    truth = {
        "registered": [
            {
                "entity_id": 1,
                "data_source_id": 7,
                "schema": "dbo",
                "table_name": "done_table",
                "source_name": "MES",
                "source_display": "MES",
            },
            {
                "entity_id": 2,
                "data_source_id": 7,
                "schema": "dbo",
                "table_name": "todo_table",
                "source_name": "MES",
                "source_display": "MES",
            },
            {
                "entity_id": 3,
                "data_source_id": 8,
                "schema": "dbo",
                "table_name": "other_source_todo",
                "source_name": "ETQ",
                "source_display": "ETQ",
            },
        ],
        "logLookup": {
            ("lz", 7, "dbo", "done_table"): {},
            ("bronze", 7, "dbo", "done_table"): {},
            ("silver", 7, "dbo", "done_table"): {},
            ("lz", 7, "dbo", "todo_table"): {},
        },
    }
    captured: dict[str, list[int]] = {}

    monkeypatch.setattr(load_center_module, "_build_canonical_pipeline_truth", lambda: truth)

    def fake_build_completion_plan(entities):
        captured["entity_ids"] = [int(entity["entity_id"]) for entity in entities]
        return {
            "plan": {
                "fullLoad": [],
                "incremental": [],
                "gapFill": [],
                "needsOptimize": [],
                "totalEntities": len(entities),
                "summary": {"totalEntities": len(entities)},
            },
            "byEntity": {},
        }

    monkeypatch.setattr(load_center_module, "_build_completion_plan", fake_build_completion_plan)
    load_center_module._run_state.clear()
    load_center_module._run_state.update({"active": False})

    result = load_center_module.post_load_center_run({
        "dryRun": True,
        "sources": ["MES"],
        "scope": "outstanding",
    })

    assert captured["entity_ids"] == [2]
    assert result["runScope"] == "outstanding"
    assert result["plan"]["summary"]["totalEntities"] == 1


def test_execute_smart_load_dispatches_real_dagster_framework_run(monkeypatch, load_center_module):
    captured: dict[str, object] = {}

    monkeypatch.setattr(load_center_module, "_persist_run", lambda *args, **kwargs: 1)
    monkeypatch.setitem(sys.modules, "dashboard.app.api.routes.engine", types.ModuleType("engine"))

    def fake_dispatch(method, path, query, body):
        captured["method"] = method
        captured["path"] = path
        captured["body"] = body
        return 200, {}, '{"run_id":"engine-run-1"}'

    monkeypatch.setattr(load_center_module, "dispatch", fake_dispatch)

    plan = {
        "gapFill": [],
        "fullLoad": [{"entityId": 11}],
        "incremental": [{"entityId": 12}],
    }
    state = {
        "runId": 123,
        "progress": {},
        "requestedSources": ["MES"],
        "runScope": "active_catalog",
    }

    load_center_module._execute_smart_load(plan, state)

    assert captured["method"] == "POST"
    assert captured["path"] == "/api/engine/start"
    assert captured["body"]["orchestrator"] == "dagster"
    assert captured["body"]["dagster_mode"] == "framework"
    assert captured["body"]["runtime_mode"] == "framework"
    assert captured["body"]["dry_run"] is False
    assert captured["body"]["entity_ids"] == [11, 12]
    assert captured["body"]["source_filter"] == ["MES"]
    assert state["phase"] == "engine_running"
    assert state["progress"]["load"]["engineRunId"] == "engine-run-1"
