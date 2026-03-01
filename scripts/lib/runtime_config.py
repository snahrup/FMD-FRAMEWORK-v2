from __future__ import annotations

import json
import re
from pathlib import Path

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")


class ConfigValidationError(ValueError):
    pass


def load_registry(path: Path) -> dict:
    return json.loads(path.read_text())


def validate_runtime_config(payload: dict) -> list[str]:
    errors: list[str] = []
    tenant = payload.get("tenant", {})
    for key in ("tenant_id", "client_id"):
        value = tenant.get(key)
        if not isinstance(value, str) or not UUID_RE.match(value):
            errors.append(f"tenant.{key} must be a valid GUID")

    workspace_ids = payload.get("workspaces", {})
    for key in ("data", "business_domain"):
        value = workspace_ids.get(key)
        if not isinstance(value, str) or not UUID_RE.match(value):
            errors.append(f"workspaces.{key} must be a valid GUID")

    connections = payload.get("connections", {})
    if not isinstance(connections.get("sql"), str) or not connections.get("sql"):
        errors.append("connections.sql must be configured")

    serialized = json.dumps(payload)
    for marker in ("00000000-0000-0000-0000-000000000000", "REPLACE_ME", "TODO"):
        if marker in serialized:
            errors.append(f"placeholder marker detected: {marker}")

    return errors
