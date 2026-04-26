"""Idempotent Microsoft Fabric deployment client."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Callable


RequestFn = Callable[..., tuple[int, Any, dict[str, str]]]


class FabricDeploymentError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.payload = payload


def fabric_error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        if isinstance(payload.get("message"), str) and payload["message"]:
            return payload["message"]
        error = payload.get("error")
        if isinstance(error, dict):
            if isinstance(error.get("message"), str) and error["message"]:
                return error["message"]
            if isinstance(error.get("code"), str) and error["code"]:
                return error["code"]
        if isinstance(error, str) and error:
            return error
        if isinstance(payload.get("errorCode"), str) and payload["errorCode"]:
            return payload["errorCode"]
    if isinstance(payload, str) and payload.strip():
        return payload.strip()
    return fallback


def _default_request(
    method: str,
    url: str,
    *,
    token: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 30,
) -> tuple[int, Any, dict[str, str]]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Authorization": f"Bearer {token}"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            parsed = json.loads(raw) if raw else {}
            return resp.status, parsed, dict(resp.headers.items())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed: Any = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = raw
        return exc.code, parsed, dict(exc.headers.items())


def _display_name(item: dict[str, Any]) -> str:
    return str(item.get("displayName") or item.get("name") or "").strip()


def find_by_display_name(items: list[dict[str, Any]], display_name: str) -> dict[str, Any] | None:
    target = display_name.strip().lower()
    for item in items:
        if _display_name(item).lower() == target:
            return item
    return None


class FabricDeploymentClient:
    def __init__(
        self,
        token_provider,
        *,
        base_url: str = "https://api.fabric.microsoft.com/v1",
        request_fn: RequestFn | None = None,
        poll_sleep_seconds: float = 5.0,
    ) -> None:
        self.token_provider = token_provider
        self.base_url = base_url.rstrip("/")
        self.request_fn = request_fn or _default_request
        self.poll_sleep_seconds = poll_sleep_seconds

    def _token(self) -> str:
        return self.token_provider.get_token()

    def _request(
        self,
        method: str,
        path_or_url: str,
        *,
        payload: dict[str, Any] | None = None,
        timeout: int = 30,
    ) -> tuple[int, Any, dict[str, str]]:
        url = path_or_url if path_or_url.startswith("http") else f"{self.base_url}{path_or_url}"
        return self.request_fn(method, url, token=self._token(), payload=payload, timeout=timeout)

    def _expect_success(self, status: int, payload: Any, fallback: str) -> None:
        if status >= 400:
            raise FabricDeploymentError(
                fabric_error_message(payload, fallback),
                status=status,
                payload=payload,
            )

    def _poll_operation(self, location: str, *, timeout_seconds: int = 300) -> None:
        deadline = time.time() + timeout_seconds
        sleep_seconds = self.poll_sleep_seconds
        while time.time() < deadline:
            status, payload, headers = self._request("GET", location, timeout=30)
            self._expect_success(status, payload, "Fabric operation failed")
            if status == 202:
                sleep_seconds = float(headers.get("Retry-After") or sleep_seconds)
                time.sleep(max(0.1, min(sleep_seconds, 30)))
                continue
            op_status = str((payload or {}).get("status", "")).lower()
            if not op_status or op_status in {"succeeded", "completed"}:
                return
            if op_status in {"failed", "cancelled", "canceled"}:
                raise FabricDeploymentError(fabric_error_message(payload, "Fabric operation failed"))
            sleep_seconds = float(headers.get("Retry-After") or sleep_seconds)
            time.sleep(max(0.1, min(sleep_seconds, 30)))
        raise FabricDeploymentError("Timed out waiting for Fabric operation to complete")

    def _list_values(self, path: str, fallback: str) -> list[dict[str, Any]]:
        status, payload, _headers = self._request("GET", path, timeout=30)
        self._expect_success(status, payload, fallback)
        return list((payload or {}).get("value", []))

    def list_capacities(self) -> list[dict[str, Any]]:
        return self._list_values("/capacities", "Failed to list Fabric capacities")

    def list_workspaces(self) -> list[dict[str, Any]]:
        return self._list_values("/workspaces", "Failed to list Fabric workspaces")

    def list_lakehouses(self, workspace_id: str) -> list[dict[str, Any]]:
        return self._list_values(
            f"/workspaces/{workspace_id}/lakehouses",
            "Failed to list Fabric lakehouses",
        )

    def list_sql_databases(self, workspace_id: str) -> list[dict[str, Any]]:
        return self._list_values(
            f"/workspaces/{workspace_id}/sqlDatabases",
            "Failed to list Fabric SQL databases",
        )

    def list_items(self, workspace_id: str, item_type: str | None = None) -> list[dict[str, Any]]:
        path = f"/workspaces/{workspace_id}/items"
        if item_type:
            path = f"{path}?type={item_type}"
        return self._list_values(path, "Failed to list Fabric items")

    def _wait_for_named(
        self,
        list_fn: Callable[[], list[dict[str, Any]]],
        display_name: str,
        *,
        timeout_seconds: int = 300,
    ) -> dict[str, Any]:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            match = find_by_display_name(list_fn(), display_name)
            if match:
                return match
            time.sleep(max(0.1, self.poll_sleep_seconds))
        raise FabricDeploymentError(f"Fabric resource '{display_name}' did not appear after creation")

    def create_or_reuse_workspace(
        self,
        display_name: str,
        capacity_id: str | None = None,
    ) -> tuple[dict[str, Any], str]:
        existing = find_by_display_name(self.list_workspaces(), display_name)
        if existing:
            if capacity_id and existing.get("capacityId") != capacity_id:
                self.assign_workspace_to_capacity(str(existing["id"]), capacity_id)
                existing["capacityId"] = capacity_id
            return existing, "reuse"

        status, payload, headers = self._request(
            "POST",
            "/workspaces",
            payload={
                "displayName": display_name,
                "description": "Provisioned by FMD one-click deployment.",
            },
            timeout=30,
        )
        self._expect_success(status, payload, f"Failed to create workspace '{display_name}'")
        location = headers.get("Location")
        if location:
            self._poll_operation(location, timeout_seconds=300)
        item = payload if isinstance(payload, dict) and payload.get("id") else None
        if item is None:
            item = self._wait_for_named(self.list_workspaces, display_name, timeout_seconds=300)
        if capacity_id:
            self.assign_workspace_to_capacity(str(item["id"]), capacity_id)
            item["capacityId"] = capacity_id
        return item, "create"

    def assign_workspace_to_capacity(self, workspace_id: str, capacity_id: str) -> None:
        status, payload, headers = self._request(
            "POST",
            f"/workspaces/{workspace_id}/assignToCapacity",
            payload={"capacityId": capacity_id},
            timeout=30,
        )
        self._expect_success(status, payload, "Failed to assign workspace to capacity")
        location = headers.get("Location")
        if status == 202 and location:
            self._poll_operation(location, timeout_seconds=300)

    def create_or_reuse_lakehouse(
        self,
        workspace_id: str,
        display_name: str,
    ) -> tuple[dict[str, Any], str]:
        existing = find_by_display_name(self.list_lakehouses(workspace_id), display_name)
        if existing:
            return existing, "reuse"
        status, payload, headers = self._request(
            "POST",
            f"/workspaces/{workspace_id}/lakehouses",
            payload={
                "displayName": display_name,
                "description": "Provisioned by FMD one-click deployment.",
                "creationPayload": {"enableSchemas": True},
            },
            timeout=30,
        )
        self._expect_success(status, payload, f"Failed to create lakehouse '{display_name}'")
        location = headers.get("Location")
        if location:
            self._poll_operation(location, timeout_seconds=300)
        item = payload if isinstance(payload, dict) and payload.get("id") else None
        if item is None:
            item = self._wait_for_named(
                lambda: self.list_lakehouses(workspace_id),
                display_name,
                timeout_seconds=300,
            )
        return item, "create"

    def create_or_reuse_sql_database(
        self,
        workspace_id: str,
        display_name: str,
    ) -> tuple[dict[str, Any], str]:
        existing = find_by_display_name(self.list_sql_databases(workspace_id), display_name)
        if existing:
            return existing, "reuse"
        status, payload, headers = self._request(
            "POST",
            f"/workspaces/{workspace_id}/sqlDatabases",
            payload={
                "displayName": display_name,
                "description": "Provisioned by FMD one-click deployment.",
            },
            timeout=30,
        )
        self._expect_success(status, payload, f"Failed to create SQL database '{display_name}'")
        location = headers.get("Location")
        if location:
            self._poll_operation(location, timeout_seconds=600)
        item = payload if isinstance(payload, dict) and payload.get("id") else None
        if item is None:
            item = self._wait_for_named(
                lambda: self.list_sql_databases(workspace_id),
                display_name,
                timeout_seconds=600,
            )
        return item, "create"

    def create_or_reuse_item(
        self,
        workspace_id: str,
        display_name: str,
        item_type: str,
        *,
        definition: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any] | None, str]:
        existing = find_by_display_name(self.list_items(workspace_id, item_type), display_name)
        if existing:
            return existing, "reuse"
        if definition is None:
            return None, "warning"
        payload = {
            "displayName": display_name,
            "type": item_type,
            "definition": definition,
        }
        status, response, headers = self._request(
            "POST",
            f"/workspaces/{workspace_id}/items",
            payload=payload,
            timeout=30,
        )
        self._expect_success(status, response, f"Failed to create Fabric item '{display_name}'")
        location = headers.get("Location")
        if location:
            self._poll_operation(location, timeout_seconds=600)
        item = response if isinstance(response, dict) and response.get("id") else None
        if item is None:
            item = self._wait_for_named(
                lambda: self.list_items(workspace_id, item_type),
                display_name,
                timeout_seconds=600,
            )
        return item, "create"
