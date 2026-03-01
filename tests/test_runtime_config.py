from scripts.lib.runtime_config import validate_runtime_config


def test_validate_runtime_config_ok():
    payload = {
        "tenant": {
            "tenant_id": "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303",
            "client_id": "ac937c5d-4bdd-438f-be8b-84a850021d2d",
        },
        "workspaces": {
            "data": "11111111-1111-4111-8111-111111111111",
            "business_domain": "22222222-2222-4222-8222-222222222222",
        },
        "connections": {"sql": "SQL_FMD_FRAMEWORK"},
    }
    assert validate_runtime_config(payload) == []


def test_validate_runtime_config_missing_fields():
    payload = {"tenant": {"tenant_id": "bad"}, "workspaces": {}, "connections": {"sql": ""}}
    errors = validate_runtime_config(payload)
    assert len(errors) >= 3
