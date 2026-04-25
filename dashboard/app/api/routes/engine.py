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
from datetime import datetime, timezone
from pathlib import Path

from dashboard.app.api.router import route, sse_route, HttpError

log = logging.getLogger("fmd.routes.engine")

# Config is read lazily so that importing this module during tests does not
# attempt to open config.json before the test has set up the environment.
_CONFIG: dict | None = None


def _get_config() -> dict:
    global _CONFIG
    if _CONFIG is None:
        try:
            cfg_path = Path(__file__).resolve().parent.parent / "config.json"
            _CONFIG = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception as e:
            log.warning("Failed to load engine config: %s", e)
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


@route("GET", "/api/engine/runtime")
def get_engine_runtime(params: dict) -> dict:
    return _delegate("GET", "/api/engine/runtime", params)


@route("GET", "/api/engine/vpn-status")
def get_engine_vpn_status(params: dict) -> dict:
    checked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        from engine.vpn import is_vpn_up, _is_vpn_client_running  # noqa: PLC2701

        connected = bool(is_vpn_up(timeout_seconds=1.5))
        client_running = bool(_is_vpn_client_running())
        return {
            "status": "connected" if connected else "disconnected",
            "connected": connected,
            "clientRunning": client_running,
            "requiredForLocalLoads": True,
            "source": "engine.vpn.is_vpn_up",
            "checkedAt": checked_at,
            "note": (
                "Source SQL servers are reachable through the current VPN session."
                if connected
                else "Source SQL servers are unreachable. Landing-zone extraction will fail until VPN access is restored."
            ),
        }
    except Exception as exc:
        log.warning("VPN status check failed: %s", exc)
        return {
            "status": "unknown",
            "connected": False,
            "clientRunning": False,
            "requiredForLocalLoads": True,
            "source": "engine.vpn.is_vpn_up",
            "checkedAt": checked_at,
            "note": "VPN status could not be verified from the dashboard API.",
            "error": str(exc),
        }


@route("GET", "/api/engine/self-heal/status")
def get_engine_self_heal_status(params: dict) -> dict:
    from engine.self_heal import get_self_heal_status_payload

    run_id = params.get("run_id")
    limit_cases = int(params.get("limit_cases", 12) or 12)
    limit_events = int(params.get("limit_events", 8) or 8)
    return get_self_heal_status_payload(
        run_id=run_id or None,
        limit_cases=max(1, min(limit_cases, 50)),
        limit_events=max(1, min(limit_events, 20)),
    )


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


@route("GET", "/api/engine/smoke-entity")
def get_engine_smoke_entity(params: dict) -> dict:
    return _delegate("GET", "/api/engine/smoke-entity", params)


# ---------------------------------------------------------------------------
# POST routes
# ---------------------------------------------------------------------------

@route("POST", "/api/engine/start")
def post_engine_start(params: dict) -> dict:
    return _delegate("POST", "/api/engine/start", params)


@route("POST", "/api/engine/preflight")
def post_engine_preflight(params: dict) -> dict:
    return _delegate("POST", "/api/engine/preflight", params)


@route("POST", "/api/engine/stop")
def post_engine_stop(params: dict) -> dict:
    return _delegate("POST", "/api/engine/stop", params)


@route("POST", "/api/engine/retry")
def post_engine_retry(params: dict) -> dict:
    return _delegate("POST", "/api/engine/retry", params)


@route("POST", "/api/engine/abort-run")
def post_engine_abort_run(params: dict) -> dict:
    return _delegate("POST", "/api/engine/abort-run", params)


@route("POST", "/api/engine/cleanup-runs")
def post_engine_cleanup_runs(params: dict) -> dict:
    return _delegate("POST", "/api/engine/cleanup-runs", params)


@route("POST", "/api/engine/resume")
def post_engine_resume(params: dict) -> dict:
    return _delegate("POST", "/api/engine/resume", params)


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


# ---------------------------------------------------------------------------
# Optimize All — discover PKs + watermarks from source DBs, update SQLite
# ---------------------------------------------------------------------------

@route("POST", "/api/engine/optimize-all")
def post_engine_optimize_all(params: dict) -> dict:
    """Connect to each on-prem source DB, discover PKs and watermarks,
    classify every entity as incremental or full-load, update SQLite.
    Requires VPN to reach source servers."""
    import pyodbc
    import sqlite3
    from engine.optimizer import (
        build_pk_query, build_watermark_query,
        parse_pk_rows, parse_watermark_rows,
        classify_entity,
    )
    from dashboard.app.api import db
    try:
        from dashboard.app.api import control_plane_db as cpdb
    except ImportError:
        log.debug("control_plane_db not found via package import, trying direct import")
        import control_plane_db as cpdb  # type: ignore

    SQL_DRIVER = "ODBC Driver 18 for SQL Server"

    # Get all source connections
    sources = db.query("""
        SELECT c.ConnectionId, c.ServerName, c.DatabaseName,
               ds.DataSourceId, ds.Name AS DSName, ds.Namespace
        FROM connections c
        JOIN datasources ds ON ds.ConnectionId = c.ConnectionId
        WHERE c.Type = 'SQL' AND c.ServerName IS NOT NULL
        ORDER BY c.Name
    """)

    # Get all LZ entities
    lz_entities = db.query("""
        SELECT le.LandingzoneEntityId, le.DataSourceId, le.SourceSchema, le.SourceName,
               le.IsIncremental, le.IsIncrementalColumn
        FROM lz_entities le WHERE le.IsActive = 1
    """)
    entities_by_ds = {}
    for e in lz_entities:
        entities_by_ds.setdefault(e["DataSourceId"], []).append(e)

    stats = {
        "total_entities": len(lz_entities),
        "pk_discovered": 0,
        "watermark_discovered": 0,
        "already_optimized": 0,
        "errors": [],
        "sources_processed": [],
    }

    pk_sql = build_pk_query()
    wm_sql = build_watermark_query()
    conn_db = sqlite3.connect(str(cpdb.DB_PATH))

    try:
        conn_db.execute("BEGIN")

        for src in sources:
            ds_id = src["DataSourceId"]
            server = src["ServerName"]
            database = src["DatabaseName"]
            ds_name = src["DSName"]
            entities = entities_by_ds.get(ds_id, [])

            if not entities:
                continue

            log.info("Optimizing %d entities from %s (%s/%s)", len(entities), ds_name, server, database)

            try:
                conn_str = (
                    f"DRIVER={{{SQL_DRIVER}}};"
                    f"SERVER={server};"
                    f"DATABASE={database};"
                    f"Trusted_Connection=yes;TrustServerCertificate=yes;"
                    f"Connect Timeout=15;"
                )
                src_conn = pyodbc.connect(conn_str, timeout=15)
            except Exception as e:
                err_msg = f"{ds_name} ({server}/{database}): {str(e)[:100]}"
                log.warning("Connection failed: %s", err_msg)
                stats["errors"].append(err_msg)
                continue

            try:
                cursor = src_conn.cursor()

                # Bulk PK discovery
                try:
                    cursor.execute(pk_sql)
                    pk_rows = [(r[0], r[1], r[2]) for r in cursor.fetchall()]
                    pk_map = parse_pk_rows(pk_rows)
                except Exception as e:
                    log.warning("PK query failed on %s: %s", ds_name, str(e)[:80])
                    pk_map = {}

                # Bulk watermark discovery
                try:
                    cursor.execute(wm_sql)
                    wm_rows = [(r[0], r[1], r[2], r[3], r[4]) for r in cursor.fetchall()]
                    wm_map = parse_watermark_rows(wm_rows)
                except Exception as e:
                    log.warning("Watermark query failed on %s: %s", ds_name, str(e)[:80])
                    wm_map = {}

                cursor.close()

                # Classify and update each entity
                src_pk = 0
                src_wm = 0
                for ent in entities:
                    schema = ent.get("SourceSchema") or "dbo"
                    table = ent.get("SourceName", "")
                    eid = ent["LandingzoneEntityId"]
                    key = (schema, table)

                    pk_cols = pk_map.get(key, [])
                    wm_candidates = wm_map.get(key, [])

                    result = classify_entity(
                        eid, schema, table,
                        pk_columns=pk_cols,
                        watermark_candidates=[
                            {"column": c.column, "type": c.data_type, "is_identity": c.is_identity}
                            for c in wm_candidates
                        ],
                    )

                    # Update bronze PKs
                    if result.primary_keys:
                        conn_db.execute(
                            "UPDATE bronze_entities SET PrimaryKeys = ? "
                            "WHERE LandingzoneEntityId = ?",
                            (result.primary_keys, eid),
                        )
                        src_pk += 1

                    # Update LZ incremental flag
                    if result.is_incremental and result.watermark_column:
                        conn_db.execute(
                            "UPDATE lz_entities SET IsIncremental = 1, "
                            "IsIncrementalColumn = ? "
                            "WHERE LandingzoneEntityId = ?",
                            (result.watermark_column, eid),
                        )
                        src_wm += 1

                stats["pk_discovered"] += src_pk
                stats["watermark_discovered"] += src_wm
                stats["sources_processed"].append({
                    "name": ds_name, "entities": len(entities),
                    "pks": src_pk, "watermarks": src_wm,
                })
                log.info("  %s: %d PKs, %d watermarks from %d entities",
                         ds_name, src_pk, src_wm, len(entities))

            finally:
                src_conn.close()

        conn_db.commit()
    finally:
        conn_db.close()

    # Recount
    updated = db.query("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN IsIncremental = 1 THEN 1 ELSE 0 END) as incremental
        FROM lz_entities
    """)
    if updated:
        stats["final_incremental"] = updated[0].get("incremental", 0)
        stats["final_total"] = updated[0].get("total", 0)

    log.info("Optimize-all complete: %s", stats)
    return stats
