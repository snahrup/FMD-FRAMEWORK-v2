"""Structural test: engine/api.py must not reference Fabric SQL query_sql interface.

After Task 12, all DB access in engine/api.py goes through SQLite via
control_plane_db (cpdb) or dashboard.app.api.db — never through query_sql_fn.
"""

import inspect


def test_no_query_sql_references():
    import engine.api as api
    source = inspect.getsource(api)
    assert "query_sql" not in source, "Found 'query_sql' in engine/api.py"
    assert "query_sql_fn" not in source, "Found 'query_sql_fn' in engine/api.py"
    assert "_query_sql" not in source, "Found '_query_sql' in engine/api.py"
    assert "_exec_proc" not in source, "Found '_exec_proc' in engine/api.py"
    assert "_call_proc" not in source, "Found '_call_proc' in engine/api.py"


def test_no_fabric_sql_table_refs():
    """engine/api.py must not reference Fabric SQL schema-qualified table names."""
    import engine.api as api
    source = inspect.getsource(api)
    fabric_patterns = [
        "execution.EngineRun",
        "execution.EngineTaskLog",
        "execution.PipelineLandingzoneEntity",
        "execution.PipelineBronzeLayerEntity",
        "execution.EntityStatusSummary",
        "integration.LandingzoneEntity",
        "integration.BronzeLayerEntity",
        "integration.SilverLayerEntity",
        "integration.DataSource",
        "integration.Connection",
        "execution.LandingzoneEntityLastLoadValue",
        "SYSUTCDATETIME",
        "DATEADD(HOUR",
    ]
    for pat in fabric_patterns:
        assert pat not in source, f"Found Fabric SQL reference '{pat}' in engine/api.py"


def test_handle_engine_request_no_query_sql_param():
    """handle_engine_request() must not accept query_sql_fn parameter."""
    import inspect
    from engine.api import handle_engine_request
    sig = inspect.signature(handle_engine_request)
    assert "query_sql_fn" not in sig.parameters, (
        "handle_engine_request still has query_sql_fn parameter"
    )
