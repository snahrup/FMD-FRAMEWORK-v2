"""Engine API delegation layer.

Registers all /api/engine/* routes and delegates to engine/api.py's
handle_engine_request() via a lightweight HTTP-handler adapter.

Delegation strategy:
    Each @route wrapper builds a _HandlerAdapter that mimics the subset of
    DashboardHandler that engine/api.py actually uses (_json_response,
    _error_response, headers, rfile, wfile).  handle_engine_request() writes
    its response into the adapter; the wrapper then raises HttpError or
    returns the captured dict so the router middleware can serialise it.

SSE delegation:
    @sse_route passes the real http_handler directly to _handle_logs_stream
    because the SSE loop must write to the live socket.
"""

import io
import json
import logging
import urllib.parse

from dashboard.app.api.router import route, sse_route, HttpError

log = logging.getLogger("fmd.routes.engine")

# Config is read lazily so that importing this module during tests does not
# attempt to open config.json before the test has set up the environment.
_CONFIG: dict | None = None


def _get_config() -> dict:
    global _CONFIG
    if _CONFIG is None:
        try:
            from engine.config import load_config
            _CONFIG = load_config().__dict__
        except Exception:
            _CONFIG = {}
    return _CONFIG


# ---------------------------------------------------------------------------
# Minimal HTTP-handler adapter
# ---------------------------------------------------------------------------

class _HandlerAdapter:
    """Adapts the @route params-dict interface to engine/api.py's handler API.

    engine/api.py calls handler._json_response(data, status=200) and
    handler._error_response(msg, status=500).  This adapter captures those
    calls so the @route wrapper can return the data dict (or raise HttpError)
    to the router middleware.
    """

    def __init__(self, body_bytes: bytes = b"", content_length: int = 0):
        # Provide a readable rfile so POST handlers can read the body.
        # engine/api.py's handle_engine_request reads Content-Length from
        # headers then calls rfile.read(n), so we pre-supply both here.
        self.rfile = io.BytesIO(body_bytes)
        self.headers = {"Content-Length": str(content_length)}
        self.wfile = io.BytesIO()            # written to by SSE — not used here

        self._response_data: dict | None = None
        self._response_status: int = 200
        self._error: str | None = None
        self._error_status: int = 500

    # ------------------------------------------------------------------
    # DashboardHandler interface used by engine/api.py
    # ------------------------------------------------------------------

    def _json_response(self, data: dict, status: int = 200) -> None:
        self._response_data = data
        self._response_status = status

    def _error_response(self, message: str, status: int = 500) -> None:
        self._error = message
        self._error_status = status

    def _cors(self):
        pass   # no-op; only needed for SSE which uses the real handler

    # ------------------------------------------------------------------
    # Result extraction
    # ------------------------------------------------------------------

    def result(self):
        """Return the captured response dict, or raise HttpError."""
        if self._error is not None:
            raise HttpError(self._error, self._error_status)
        if self._response_data is not None:
            if self._response_status not in (200, 201, 202):
                raise HttpError(
                    json.dumps(self._response_data), self._response_status
                )
            return self._response_data
        # Handler wrote nothing — return an empty ack
        return {}


def _adapter_for(params: dict) -> "_HandlerAdapter":
    """Build an adapter pre-loaded with the POST body (if any)."""
    body = {k: v for k, v in params.items() if not k.startswith("_")}
    body_bytes = json.dumps(body).encode() if body else b""
    return _HandlerAdapter(body_bytes=body_bytes, content_length=len(body_bytes))


def _delegate(method: str, path: str, params: dict) -> dict:
    """Call handle_engine_request() via the adapter and return the result."""
    from engine.api import handle_engine_request  # lazy import — engine may not be installed

    adapter = _adapter_for(params)

    # Reconstruct the full path with any query parameters that came in via
    # params so engine/api.py can re-parse them (e.g. ?limit=50).
    qs_keys = {k: [str(v)] for k, v in params.items() if not k.startswith("_")}
    if qs_keys and method == "GET":
        qs_str = urllib.parse.urlencode({k: v[0] for k, v in qs_keys.items()})
        full_path = f"{path}?{qs_str}" if qs_str else path
    else:
        full_path = path

    handle_engine_request(
        handler=adapter,
        method=method,
        path=full_path,
        config=_get_config(),
    )
    return adapter.result()


# ---------------------------------------------------------------------------
# GET routes
# ---------------------------------------------------------------------------

@route("GET", "/api/engine/status")
def get_engine_status(params: dict) -> dict:
    return _delegate("GET", "/api/engine/status", params)


@route("GET", "/api/engine/plan")
def get_engine_plan(params: dict) -> dict:
    return _delegate("GET", "/api/engine/plan", params)


@route("GET", "/api/engine/logs")
def get_engine_logs(params: dict) -> dict:
    return _delegate("GET", "/api/engine/logs", params)


@route("GET", "/api/engine/health")
def get_engine_health(params: dict) -> dict:
    return _delegate("GET", "/api/engine/health", params)


@route("GET", "/api/engine/metrics")
def get_engine_metrics(params: dict) -> dict:
    return _delegate("GET", "/api/engine/metrics", params)


@route("GET", "/api/engine/runs")
def get_engine_runs(params: dict) -> dict:
    return _delegate("GET", "/api/engine/runs", params)


@route("GET", "/api/engine/validation")
def get_engine_validation(params: dict) -> dict:
    return _delegate("GET", "/api/engine/validation", params)


@route("GET", "/api/engine/settings")
def get_engine_settings(params: dict) -> dict:
    return _delegate("GET", "/api/engine/settings", params)


@route("GET", "/api/engine/entities")
def get_engine_entities(params: dict) -> dict:
    return _delegate("GET", "/api/engine/entities", params)


# ---------------------------------------------------------------------------
# POST routes
# ---------------------------------------------------------------------------

@route("POST", "/api/engine/start")
def post_engine_start(params: dict) -> dict:
    return _delegate("POST", "/api/engine/start", params)


@route("POST", "/api/engine/stop")
def post_engine_stop(params: dict) -> dict:
    return _delegate("POST", "/api/engine/stop", params)


@route("POST", "/api/engine/retry")
def post_engine_retry(params: dict) -> dict:
    return _delegate("POST", "/api/engine/retry", params)


@route("POST", "/api/engine/abort-run")
def post_engine_abort_run(params: dict) -> dict:
    return _delegate("POST", "/api/engine/abort-run", params)


@route("POST", "/api/engine/settings")
def post_engine_settings(params: dict) -> dict:
    return _delegate("POST", "/api/engine/settings", params)


@route("POST", "/api/engine/entity/{entity_id}/reset")
def post_engine_entity_reset(params: dict) -> dict:
    entity_id = params.get("entity_id", "")
    try:
        int(entity_id)
    except (TypeError, ValueError):
        raise HttpError(f"Invalid entity ID: {entity_id!r}", 400)
    return _delegate("POST", f"/api/engine/entity/{entity_id}/reset", {})


# ---------------------------------------------------------------------------
# SSE route — passes the real HTTP handler directly (no adapter)
# ---------------------------------------------------------------------------

@sse_route("GET", "/api/engine/logs/stream")
def sse_engine_logs_stream(http_handler, params: dict) -> None:
    """Stream engine log events via SSE.

    The @sse_route decorator causes dispatch_sse() to call this with the real
    DashboardHandler, which is exactly what _handle_logs_stream() needs.
    """
    from engine.api import _handle_logs_stream  # noqa: PLC2701
    _handle_logs_stream(http_handler)
