"""Route registry with decorator-based registration and middleware pipeline.

Usage:
    from dashboard.app.api.router import route, sse_route, dispatch, HttpError

    @route("GET", "/api/things")
    def get_things(params):
        return {"items": [...]}

    # In server.py do_GET/do_POST:
    status, headers, body = dispatch(method, path, query_params, body)
"""
import json
import logging
import re

log = logging.getLogger("fmd.router")

_routes: dict = {}


class HttpError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def route(method: str, path: str):
    """Register a handler. Supports exact match and {param} placeholders."""
    def decorator(fn):
        _routes[(method, path)] = fn
        return fn
    return decorator


def sse_route(method: str, path: str):
    """Register an SSE streaming handler. Bypasses JSON middleware."""
    def decorator(fn):
        _routes[(method, path)] = {"handler": fn, "sse": True}
        return fn
    return decorator


def _match_route(method: str, path: str):
    """Find a matching route. Exact match first, then pattern match with {params}."""
    # Exact match
    key = (method, path)
    if key in _routes:
        return _routes[key], {}

    # Pattern match with path params
    for (m, pattern), handler in _routes.items():
        if m != method:
            continue
        if "{" not in pattern:
            continue
        # Convert /api/entities/{id} to regex /api/entities/(?P<id>[^/]+)
        regex = re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern)
        match = re.fullmatch(regex, path)
        if match:
            return handler, match.groupdict()

    return None, {}


_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


def dispatch(method: str, path: str, query_params: dict, body: dict | None):
    """Middleware pipeline: match -> execute -> catch -> serialize.

    Returns (status_code, headers_dict, body_string).
    SSE routes are NOT dispatched through here — use dispatch_sse().
    """
    handler, path_params = _match_route(method, path)

    if handler is None:
        headers = {"Content-Type": "application/json", **_CORS_HEADERS}
        return 404, headers, json.dumps({"error": "Not found"})

    # SSE routes should not go through JSON dispatch
    if isinstance(handler, dict) and handler.get("sse"):
        headers = {"Content-Type": "application/json", **_CORS_HEADERS}
        return 400, headers, json.dumps({"error": "SSE route — use dispatch_sse()"})

    # Merge params: path params + query params + body
    params = {}
    params.update(path_params)
    if query_params:
        params.update(query_params)
    if body:
        params.update(body)

    headers = {"Content-Type": "application/json", **_CORS_HEADERS}

    try:
        log.info("%s %s", method, path)
        result = handler(params)
        return 200, headers, json.dumps(result, default=str)
    except HttpError as e:
        log.warning("%s %s -> %d: %s", method, path, e.status, e)
        return e.status, headers, json.dumps({"error": str(e)})
    except Exception:
        log.exception("Unhandled error in %s %s", method, path)
        return 500, headers, json.dumps({"error": "Internal server error"})


def dispatch_sse(method: str, path: str, http_handler, query_params: dict):
    """Dispatch an SSE route. Returns True if handled, False if no match."""
    handler, path_params = _match_route(method, path)
    if handler is None:
        return False

    if isinstance(handler, dict) and handler.get("sse"):
        params = {}
        params.update(path_params)
        if query_params:
            params.update(query_params)
        handler["handler"](http_handler, params)
        return True

    return False


def get_all_routes() -> list[tuple[str, str, bool]]:
    """Return all registered routes as (method, path, is_sse) tuples."""
    result = []
    for (method, path), handler in _routes.items():
        is_sse = isinstance(handler, dict) and handler.get("sse", False)
        result.append((method, path, is_sse))
    return sorted(result)
