# dashboard/app/api/tests/test_router.py
import json
import pytest
from dashboard.app.api.router import route, sse_route, dispatch, HttpError, _routes

@pytest.fixture(autouse=True)
def clear_routes():
    _routes.clear()
    yield
    _routes.clear()

def test_register_and_dispatch_get():
    @route("GET", "/api/test")
    def handler(params):
        return {"ok": True}

    status, headers, body = dispatch("GET", "/api/test", query_params={}, body=None)
    assert status == 200
    result = json.loads(body)
    assert result == {"ok": True}

def test_dispatch_404_for_unknown_path():
    status, headers, body = dispatch("GET", "/api/nonexistent", query_params={}, body=None)
    assert status == 404

def test_http_error_returns_custom_status():
    @route("POST", "/api/fail")
    def handler(params):
        raise HttpError("bad input", 400)

    status, headers, body = dispatch("POST", "/api/fail", query_params={}, body={})
    assert status == 400
    result = json.loads(body)
    assert "bad input" in result["error"]

def test_unhandled_exception_returns_500():
    @route("GET", "/api/crash")
    def handler(params):
        raise RuntimeError("boom")

    status, headers, body = dispatch("GET", "/api/crash", query_params={}, body=None)
    assert status == 500
    result = json.loads(body)
    assert "error" in result

def test_path_params_extracted():
    @route("GET", "/api/entities/{id}")
    def handler(params):
        return {"id": params["id"]}

    status, _, body = dispatch("GET", "/api/entities/42", query_params={}, body=None)
    assert status == 200
    assert json.loads(body)["id"] == "42"

def test_query_params_merged_into_params():
    @route("GET", "/api/search")
    def handler(params):
        return {"q": params.get("q")}

    status, _, body = dispatch("GET", "/api/search", query_params={"q": "hello"}, body=None)
    assert json.loads(body)["q"] == "hello"

def test_post_body_merged_into_params():
    @route("POST", "/api/create")
    def handler(params):
        return {"name": params.get("name")}

    status, _, body = dispatch("POST", "/api/create", query_params={}, body={"name": "test"})
    assert json.loads(body)["name"] == "test"

def test_sse_route_flagged():
    @sse_route("GET", "/api/stream")
    def handler(http_handler, params):
        pass

    entry = _routes[("GET", "/api/stream")]
    assert isinstance(entry, dict) and entry["sse"] is True

def test_cors_headers_present():
    @route("GET", "/api/cors-test")
    def handler(params):
        return {}

    _, headers, _ = dispatch("GET", "/api/cors-test", query_params={}, body=None)
    assert headers["Access-Control-Allow-Origin"] == "*"

def test_delete_method():
    @route("DELETE", "/api/items/{id}")
    def handler(params):
        return {"deleted": params["id"]}

    status, _, body = dispatch("DELETE", "/api/items/7", query_params={}, body=None)
    assert status == 200
    assert json.loads(body)["deleted"] == "7"
