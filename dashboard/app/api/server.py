"""FMD Operations Dashboard — HTTP Server.

Serves React static files and delegates all /api/* requests to the route
registry.  All handler logic lives in routes/*.py modules.

Usage:
  Development:  python server.py
  Production:   python server.py --config /path/to/config.json
"""
import json
import logging
import mimetypes
import os
import socketserver
import sys
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# ── sys.path — project root must be importable for engine.* imports ──
_project_root = str(Path(__file__).resolve().parent.parent.parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

# ── .env loader (no python-dotenv dependency) ──
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    _env_loaded = 0
    with open(_env_file) as _ef:
        for _line in _ef:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())
                _env_loaded += 1
    print(f"  .env loaded: {_env_loaded} vars from {_env_file}")
else:
    print(f"  WARNING: .env not found at {_env_file}")


# ── Config loading ──

def _resolve_env_vars(obj):
    """Recursively resolve ${ENV_VAR} placeholders from environment variables."""
    if isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
        var_name = obj[2:-1]
        val = os.environ.get(var_name, "")
        if not val:
            print(f"  [WARN] Environment variable {var_name} is not set — using empty default")
        return val
    elif isinstance(obj, dict):
        return {k: _resolve_env_vars(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_resolve_env_vars(v) for v in obj]
    return obj


def load_config(config_path: str = None) -> dict:
    """Load configuration from JSON file, resolving ${ENV_VAR} placeholders."""
    if config_path is None:
        config_path = Path(__file__).parent / "config.json"
    with open(config_path, "r") as f:
        raw = json.load(f)
    return _resolve_env_vars(raw)


CONFIG = load_config(
    sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--config" else None
)

# ── Logging ──
log_cfg = CONFIG.get("logging", {})
log_file = log_cfg.get("file")
log_level = getattr(logging, log_cfg.get("level", "INFO").upper(), logging.INFO)

_log_handlers = [logging.StreamHandler()]
if log_file:
    _log_path = Path(__file__).parent / log_file
    _log_handlers.append(logging.FileHandler(_log_path, encoding="utf-8"))

logging.basicConfig(
    level=log_level,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=_log_handlers,
)
log = logging.getLogger("fmd-dashboard")

# ── Key config values ──
PORT = CONFIG["server"]["port"]
HOST = CONFIG["server"].get("host", "127.0.0.1")
STATIC_DIR = Path(__file__).parent / CONFIG["server"].get("static_dir", "../dist")

# ── Route registry + all route modules ──
# Importing routes package auto-imports every module in routes/ which runs
# all @route / @sse_route decorators, populating the route registry.
from dashboard.app.api.router import dispatch, dispatch_sse  # noqa: E402
import dashboard.app.api.routes  # noqa: F401 — triggers auto-registration

# ── SQLite control plane ──
try:
    from dashboard.app.api import control_plane_db as cpdb
    _CPDB_AVAILABLE = True
except ImportError:
    log.debug("control_plane_db not found via package import, trying direct import")
    try:
        import control_plane_db as cpdb  # type: ignore
        _CPDB_AVAILABLE = True
    except ImportError:
        log.debug("control_plane_db not available — control plane features disabled")
        cpdb = None
        _CPDB_AVAILABLE = False


def _cpdb_available() -> bool:
    return _CPDB_AVAILABLE and cpdb is not None and cpdb.DB_PATH.exists()


def _init_control_plane_db():
    if _CPDB_AVAILABLE and cpdb is not None:
        try:
            cpdb.init_db()
            log.info("SQLite control plane DB initialized at %s", cpdb.DB_PATH)
        except Exception as exc:
            log.warning("Failed to initialize SQLite control plane DB: %s", exc)


# ── Static file serving ──

MIME_TYPES = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
}


def serve_static(handler, url_path: str) -> bool:
    """Serve a static file from STATIC_DIR. Returns True if served."""
    if not STATIC_DIR.exists():
        return False
    clean = url_path.split("?")[0].split("#")[0]
    if clean == "/":
        clean = "/index.html"
    file_path = STATIC_DIR / clean.lstrip("/")
    try:
        file_path.resolve().relative_to(STATIC_DIR.resolve())
    except ValueError:
        log.warning("Blocked path traversal attempt: %s", clean)
        return False
    if file_path.is_file():
        ext = file_path.suffix.lower()
        content_type = MIME_TYPES.get(
            ext, mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        )
        handler.send_response(200)
        handler.send_header("Content-Type", content_type)
        if ext in (".js", ".css", ".woff", ".woff2", ".ttf", ".png", ".jpg", ".svg"):
            handler.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            handler.send_header("Cache-Control", "no-cache")
        handler.end_headers()
        handler.wfile.write(file_path.read_bytes())
        return True
    # SPA fallback: serve index.html for client-side routes
    index = STATIC_DIR / "index.html"
    if index.is_file():
        handler.send_response(200)
        handler.send_header("Content-Type", "text/html")
        handler.send_header("Cache-Control", "no-cache")
        handler.end_headers()
        handler.wfile.write(index.read_bytes())
        return True
    return False


# ── HTTP Handler ──

class DashboardHandler(BaseHTTPRequestHandler):
    """Thin HTTP handler — delegates all /api/* to the route registry."""

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json_response(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _error_response(self, message, status=500):
        log.error("%s → %d: %s", self.path, status, message)
        self._json_response({"error": message}, status)

    def _send(self, status: int, headers: dict, body: str):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def _parse(self):
        """Return (path, query_params) from self.path."""
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        params = {k: v[0] if len(v) == 1 else v for k, v in qs.items()}
        return parsed.path, params

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path, query_params = self._parse()
        if path.startswith("/api/"):
            # Audit artifacts need raw binary serving (not JSON dispatch)
            if path.startswith("/api/audit/artifacts/"):
                parts = path.split("/")
                # /api/audit/artifacts/{runId}/{testDir}/{fn} => 6 parts
                if len(parts) >= 6:
                    from dashboard.app.api.routes.test_audit import serve_audit_artifact
                    run_id = parts[4]
                    test_dir = "/".join(parts[5:-1])  # testDir could have slashes
                    fn = parts[-1]
                    if serve_audit_artifact(self, run_id, test_dir, fn):
                        return
                self._error_response("Artifact not found", 404)
                return
            if dispatch_sse("GET", path, self, query_params):
                return
            status, headers, body = dispatch("GET", path, query_params, None)
            self._send(status, headers, body)
        else:
            if not serve_static(self, self.path):
                self._error_response("Not found", 404)

    def do_POST(self):
        path, query_params = self._parse()
        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length)) if content_length else {}
        status, headers, response_body = dispatch("POST", path, query_params, body)
        self._send(status, headers, response_body)

    def do_PUT(self):
        path, query_params = self._parse()
        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length)) if content_length else {}
        status, headers, response_body = dispatch("PUT", path, query_params, body)
        self._send(status, headers, response_body)

    def do_DELETE(self):
        path, query_params = self._parse()
        status, headers, body = dispatch("DELETE", path, query_params, None)
        self._send(status, headers, body)

    def log_message(self, format, *args):  # noqa: A002
        log.debug("%s %s", self.client_address[0], args[0])


class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


# ── Entry point ──

if __name__ == "__main__":
    mode = "production" if STATIC_DIR.exists() else "api-only"

    log.info("=" * 60)
    log.info("FMD Operations Dashboard")
    log.info("=" * 60)
    log.info("  Mode:       %s", mode)
    log.info("  Server:     http://%s:%s", HOST, PORT)
    if mode == "production":
        log.info("  Static:     %s", STATIC_DIR)
    log.info("  Log file:   %s", log_cfg.get("file", "console only"))
    log.info("  SQLite:     %s (single source of truth)", "ENABLED" if _CPDB_AVAILABLE else "DISABLED")
    log.info("=" * 60)

    _init_control_plane_db()

    # NOTE: entity_status startup sync removed (RP-03, 2026-03-20).
    # entity_status is deprecated — status is now derived from engine_task_log
    # via get_canonical_entity_status(). The sync wrote to a table nobody reads.

    # Start parquet export background thread
    try:
        from dashboard.app.api.parquet_sync import start_export_thread
        start_export_thread()
    except ImportError:
        log.warning("parquet_sync not available (pyarrow missing?) — export disabled")
    except Exception:
        log.exception("Failed to start parquet export thread")

    # Start delta ingest background thread (every 30 minutes)
    try:
        from dashboard.app.api.delta_ingest import start_ingest_thread
        start_ingest_thread(interval_seconds=1800)
    except ImportError:
        log.warning("delta_ingest not available — ingest disabled")
    except Exception:
        log.exception("Failed to start delta ingest thread")

    server = ThreadedHTTPServer((HOST, PORT), DashboardHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down — KeyboardInterrupt received.")
        server.server_close()
