"""Build GUID mapping from DEV items to PROD items by display name."""
import os
import json
from urllib.request import Request, urlopen
from urllib.parse import urlencode

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")
API = "https://api.fabric.microsoft.com/v1"

def get_token():
    url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
    data = urlencode({
        "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
        "scope": "https://api.fabric.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode()
    req = Request(url, data=data, method="POST")
    with urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]

def get_items(token, ws_id):
    req = Request(f"{API}/workspaces/{ws_id}/items", headers={"Authorization": f"Bearer {token}"})
    with urlopen(req) as r:
        return json.loads(r.read()).get("value", [])

token = get_token()

pairs = [
    ("CODE (D)", "146fe38c-f6c3-4e9d-a18c-5c01cad5941e", "CODE (P)", "1284458c-1976-46a6-b9d8-af17c7d11a59"),
    ("DATA (D)", "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a", "DATA (P)", "4c4b6bf5-8728-4aac-a132-b008a11b96d7"),
]

guid_map = {
    # Workspace-level GUIDs
    "146fe38c-f6c3-4e9d-a18c-5c01cad5941e": "1284458c-1976-46a6-b9d8-af17c7d11a59",  # CODE D→P
    "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a": "4c4b6bf5-8728-4aac-a132-b008a11b96d7",  # DATA D→P
}

for dev_label, dev_ws, prod_label, prod_ws in pairs:
    dev_items = get_items(token, dev_ws)
    prod_items = get_items(token, prod_ws)
    prod_by_name = {i["displayName"]: i["id"] for i in prod_items}

    print(f"\n=== {dev_label} -> {prod_label} ===")
    for item in sorted(dev_items, key=lambda x: x["displayName"]):
        name = item["displayName"]
        dev_id = item["id"]
        prod_id = prod_by_name.get(name)
        if prod_id:
            guid_map[dev_id] = prod_id
            print(f"  {name:50} {dev_id[:12]}... -> {prod_id[:12]}...")
        else:
            print(f"  {name:50} {dev_id[:12]}... -> MISSING!")

print(f"\n=== Total mappings: {len(guid_map)} ===")

with open("guid_map.json", "w") as f:
    json.dump(guid_map, f, indent=2)
print("Saved guid_map.json")
