"""Dagster UI bridge routes.

These routes keep the FMD dashboard aware of the local Dagster webserver
without proxying Dagster itself. The frontend embeds Dagster directly and uses
this endpoint only for health/configuration context.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dashboard.app.api.router import route


_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"


def _load_config() -> dict:
    try:
        return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _strip_trailing_slash(value: str) -> str:
    return value.rstrip("/")


def _dagster_urls() -> tuple[str, str]:
    config = _load_config()
    dagster_cfg = config.get("dagster", {}) if isinstance(config, dict) else {}
    base_url = (
        os.environ.get("FMD_DAGSTER_UI_URL")
        or dagster_cfg.get("ui_url")
        or os.environ.get("FMD_DAGSTER_BASE_URL")
        or "http://127.0.0.1:3006"
    )
    base_url = _strip_trailing_slash(str(base_url))
    graphql_url = (
        os.environ.get("FMD_DAGSTER_GRAPHQL_URL")
        or dagster_cfg.get("graphql_url")
        or f"{base_url}/graphql"
    )
    return base_url, str(graphql_url)


def _probe_graphql(graphql_url: str) -> tuple[bool, str | None]:
    payload = json.dumps({"query": "query FmdDagsterPing { __typename }"}).encode("utf-8")
    request = Request(
        graphql_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=2.0) as response:
        body = response.read().decode("utf-8", errors="replace")
        if response.status >= 400:
            return False, f"GraphQL returned HTTP {response.status}"
        parsed = json.loads(body or "{}")
        if parsed.get("errors"):
            return False, "GraphQL responded with errors"
        return True, None


@route("GET", "/api/dagster/status")
def dagster_status(params: dict) -> dict:
    base_url, graphql_url = _dagster_urls()
    now = datetime.now(timezone.utc).isoformat()

    available = False
    reason = None
    try:
        available, reason = _probe_graphql(graphql_url)
    except HTTPError as exc:
        reason = f"Dagster GraphQL returned HTTP {exc.code}"
    except URLError as exc:
        reason = f"Dagster is not reachable at {graphql_url}: {exc.reason}"
    except TimeoutError:
        reason = f"Dagster probe timed out at {graphql_url}"
    except Exception as exc:
        reason = f"Dagster probe failed: {exc}"

    return {
        "available": available,
        "baseUrl": base_url,
        "graphqlUrl": graphql_url,
        "checkedAt": now,
        "message": "Dagster UI is reachable." if available else reason,
        "pages": [
            {"id": "overview", "label": "Overview", "dashboardPath": "/dagster", "dagsterPath": "/overview"},
            {"id": "runs", "label": "Runs", "dashboardPath": "/dagster/runs", "dagsterPath": "/runs"},
            {"id": "catalog", "label": "Catalog", "dashboardPath": "/dagster/catalog", "dagsterPath": "/assets", "aliases": ["/dagster/assets"]},
            {"id": "jobs", "label": "Jobs", "dashboardPath": "/dagster/jobs", "dagsterPath": "/jobs"},
            {"id": "automation", "label": "Automation", "dashboardPath": "/dagster/automation", "dagsterPath": "/automation", "aliases": ["/dagster/schedules", "/dagster/sensors"]},
            {"id": "lineage", "label": "Lineage", "dashboardPath": "/dagster/lineage", "dagsterPath": "/asset-graph"},
            {"id": "deployment", "label": "Deployment", "dashboardPath": "/dagster/deployment", "dagsterPath": "/locations", "aliases": ["/dagster/locations"]},
        ],
    }
