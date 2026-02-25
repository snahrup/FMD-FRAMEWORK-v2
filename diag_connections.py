#!/usr/bin/env python3
"""Check Fabric connections and try to validate them."""

import json
import os
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = ""
FABRIC_API = "https://api.fabric.microsoft.com/v1"
CODE_WS = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"
CONFIG_WS = "f442f66c-eac6-46d7-80c9-c8b025c86fbe"

# Connection GUIDs from metadata
CONNECTIONS = {
    "CON_FMD_FABRIC_SQL": "0f86f6a1-9f84-44d1-b977-105b5179c678",
    "CON_FMD_FABRIC_PIPELINES": "6b2e33a1-b441-4137-b41d-260ffa8258cf",
    "CON_FMD_FABRIC_NOTEBOOKS": "f4d3220c-0cd3-4f76-9641-b4154e192645",
    "CON_FMD_M3DB1_MES": "eace5b34-df2e-4057-a01f-5770ab3f9003",
    "CON_FMD_M3DB3_ETQSTAGINGPRD": "c5cd66d8-3503-44de-9934-e04715697906",
}

env_path = os.path.join(os.path.dirname(__file__), "dashboard", "app", "api", ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                CLIENT_SECRET = line.split("=", 1)[1].strip()

_token_cache = {}
def get_token(scope="https://api.fabric.microsoft.com/.default"):
    key = scope
    if key in _token_cache and time.time() < _token_cache[key]["expires"] - 60:
        return _token_cache[key]["token"]
    data = urlencode({"grant_type":"client_credentials","client_id":CLIENT_ID,
        "client_secret":CLIENT_SECRET,"scope":scope}).encode()
    req = Request(f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
                  data=data, method="POST")
    with urlopen(req) as resp:
        result = json.loads(resp.read())
    _token_cache[key] = {"token":result["access_token"],"expires":time.time()+result.get("expires_in",3600)}
    return _token_cache[key]["token"]

def api_call(url):
    token = get_token()
    req = Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except HTTPError as e:
        raw = e.read().decode()
        return e.code, raw[:500]

def main():
    get_token()
    print("[OK] Authenticated\n")

    # Try to get each connection via Fabric API
    print("=== Checking connections via Fabric API ===\n")
    for name, guid in CONNECTIONS.items():
        # Try the connections API
        status, data = api_call(f"{FABRIC_API}/connections/{guid}")
        print(f"{name} ({guid}):")
        if status == 200:
            print(f"  Status: OK")
            if isinstance(data, dict):
                print(f"  Type: {data.get('connectivityType', '?')}")
                print(f"  Gateway: {data.get('gatewayId', 'none')}")
                cd = data.get("connectionDetails", {})
                print(f"  Details: {json.dumps(cd)[:200]}")
                creds = data.get("credentialDetails", {})
                print(f"  Cred type: {creds.get('credentialType', '?')}")
        else:
            print(f"  Status: {status}")
            if isinstance(data, str):
                print(f"  Error: {data[:200]}")
            else:
                print(f"  Error: {json.dumps(data)[:200]}")
        print()

    # Try listing all connections
    print("=== All accessible connections ===")
    status, data = api_call(f"{FABRIC_API}/connections")
    if status == 200 and isinstance(data, dict):
        for conn in data.get("value", []):
            print(f"  {conn.get('displayName', '?')} ({conn.get('id', '?')})")
            print(f"    type: {conn.get('connectivityType', '?')}, gateway: {conn.get('gatewayId', 'none')}")
    else:
        print(f"  Status: {status}, Response: {str(data)[:200]}")

if __name__ == "__main__":
    main()
