import os
import urllib.request
import urllib.parse
from urllib.error import HTTPError
import json
import time

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")
WORKSPACE_ID = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"

def get_token(scope="https://api.fabric.microsoft.com/.default"):
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "client_secret": SECRET,
        "scope": scope,
        "grant_type": "client_credentials",
    }).encode()
    req = urllib.request.Request(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data=data, method="POST",
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    return resp["access_token"]


def fabric_request(method, path, token, payload=None):
    url = f"https://api.fabric.microsoft.com/v1/{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    body = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req)
        raw = resp.read()
        return json.loads(raw) if raw else None
    except HTTPError as e:
        body = e.read().decode()
        print(f"HTTP ERROR {e.code} on {method} {url}")
        print(body)
        raise
        
if __name__ == "__main__":
    token = get_token()
    
    items = fabric_request("GET", f"workspaces/{WORKSPACE_ID}/items", token)
    item_id = None
    for item in items.get("value", []):
         if item["displayName"] == "NB_M3_TEMP_REGISTRATION" and item["type"] == "Notebook":
             item_id = item["id"]
             print(f"Found created notebook: {item_id}")
             break
             
    if item_id:
        print(f"Triggering Notebook Job for {item_id}...")
        run_payload = {
            "executionData": {
                "parameters": {}
            }
        }
        try:
            job_res = fabric_request("POST", f"workspaces/{WORKSPACE_ID}/items/{item_id}/jobs/instances?jobType=RunNotebook", token, run_payload)
            print("Job Response:")
            print(json.dumps(job_res, indent=2))
        except Exception as e:
            print("Failed to run notebook.")
    else:
        print("Notebook not found. Creation must still be pending.")
