from __future__ import annotations

import pytest

from dashboard.app.api.fabric_deployment import FabricDeploymentClient, FabricDeploymentError


class TokenProvider:
    def get_token(self):
        return "token"


class FakeFabric:
    def __init__(self):
        self.workspaces = [{"id": "ws-existing", "displayName": "Existing Workspace"}]
        self.lakehouses = {"ws-existing": [{"id": "lh-existing", "displayName": "Existing Lakehouse"}]}
        self.calls = []

    def request(self, method, url, *, token, payload=None, timeout=30):
        self.calls.append((method, url, payload))
        if url.endswith("/workspaces") and method == "GET":
            return 200, {"value": self.workspaces}, {}
        if url.endswith("/workspaces") and method == "POST":
            item = {"id": "ws-new", "displayName": payload["displayName"]}
            self.workspaces.append(item)
            return 201, item, {}
        if url.endswith("/assignToCapacity"):
            return 200, {}, {}
        if url.endswith("/workspaces/ws-existing/lakehouses") and method == "GET":
            return 200, {"value": self.lakehouses["ws-existing"]}, {}
        if url.endswith("/workspaces/ws-existing/lakehouses") and method == "POST":
            item = {"id": "lh-new", "displayName": payload["displayName"]}
            self.lakehouses["ws-existing"].append(item)
            return 201, item, {}
        if "/items" in url and method == "GET":
            return 200, {"value": []}, {}
        if "/sqlDatabases" in url and method == "GET":
            return 200, {"value": []}, {}
        return 404, {"message": "not found"}, {}


def test_create_or_reuse_workspace_reuses_existing():
    fake = FakeFabric()
    client = FabricDeploymentClient(TokenProvider(), request_fn=fake.request)

    item, action = client.create_or_reuse_workspace("Existing Workspace", "cap-1")

    assert action == "reuse"
    assert item["id"] == "ws-existing"


def test_create_or_reuse_lakehouse_creates_when_missing():
    fake = FakeFabric()
    client = FabricDeploymentClient(TokenProvider(), request_fn=fake.request)

    item, action = client.create_or_reuse_lakehouse("ws-existing", "New Lakehouse")

    assert action == "create"
    assert item["id"] == "lh-new"


def test_missing_item_definition_returns_warning_not_fake_success():
    fake = FakeFabric()
    client = FabricDeploymentClient(TokenProvider(), request_fn=fake.request)

    item, action = client.create_or_reuse_item("ws-existing", "Missing Pipeline", "DataPipeline")

    assert item is None
    assert action == "warning"


def test_api_error_is_normalized():
    def request(method, url, *, token, payload=None, timeout=30):
        return 403, {"error": {"message": "Forbidden by Fabric"}}, {}

    client = FabricDeploymentClient(TokenProvider(), request_fn=request)

    with pytest.raises(FabricDeploymentError, match="Forbidden by Fabric"):
        client.list_workspaces()
