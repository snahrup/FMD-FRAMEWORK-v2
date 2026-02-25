#!/usr/bin/env python3
"""Upload modified notebooks to Fabric workspace (convert .py -> .ipynb)."""

import base64, json, os, sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
CODE_WS = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"
FABRIC_API = "https://api.fabric.microsoft.com/v1"

def get_token():
    token_url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
    data = urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope": "https://api.fabric.microsoft.com/.default"
    }).encode()
    req = Request(token_url, data=data, method="POST")
    resp = json.loads(urlopen(req).read())
    return resp["access_token"]

def fabric_get(path, token):
    req = Request(f"{FABRIC_API}/{path}", headers={"Authorization": f"Bearer {token}"})
    return json.loads(urlopen(req).read())

def fabric_py_to_ipynb(py_content):
    """Convert Fabric notebook .py format to standard .ipynb format."""
    lines = py_content.split("\n")
    cells = []
    notebook_meta = {}

    i = 0
    while i < len(lines):
        line = lines[i]

        # Skip header
        if line.strip() == "# Fabric notebook source":
            i += 1
            continue

        # Notebook-level metadata (before any cells)
        if line.strip() == "# METADATA ********************" and not cells:
            i += 1
            meta_lines = []
            while i < len(lines) and lines[i].startswith("# META"):
                mt = lines[i]
                if mt.startswith("# META   "):
                    mt = mt[9:]
                elif mt.startswith("# META  "):
                    mt = mt[8:]
                elif mt.startswith("# META "):
                    mt = mt[7:]
                elif mt == "# META":
                    mt = ""
                else:
                    mt = mt[6:]
                meta_lines.append(mt)
                i += 1
            try:
                notebook_meta = json.loads("\n".join(meta_lines))
            except:
                pass
            continue

        # Code cell
        if line.strip() in ("# CELL ********************", "# PARAMETERS CELL ********************"):
            is_params = "PARAMETERS" in line
            i += 1
            source_lines = []
            cell_meta = {}

            while i < len(lines):
                if lines[i].strip() == "# METADATA ********************":
                    # Parse cell metadata
                    i += 1
                    meta_lines = []
                    while i < len(lines) and lines[i].startswith("# META"):
                        mt = lines[i]
                        if mt.startswith("# META   "):
                            mt = mt[9:]
                        elif mt.startswith("# META  "):
                            mt = mt[8:]
                        elif mt.startswith("# META "):
                            mt = mt[7:]
                        elif mt == "# META":
                            mt = ""
                        else:
                            mt = mt[6:]
                        meta_lines.append(mt)
                        i += 1
                    try:
                        cell_meta = json.loads("\n".join(meta_lines))
                    except:
                        pass
                    break
                elif lines[i].strip() in ("# CELL ********************", "# MARKDOWN ********************", "# PARAMETERS CELL ********************"):
                    break
                else:
                    source_lines.append(lines[i])
                    i += 1

            # Trim trailing empty lines
            while source_lines and source_lines[-1].strip() == "":
                source_lines.pop()

            if source_lines or is_params:
                src = []
                for idx, sl in enumerate(source_lines):
                    if idx < len(source_lines) - 1:
                        src.append(sl + "\n")
                    else:
                        src.append(sl)
                cell = {
                    "cell_type": "code",
                    "source": src,
                    "metadata": cell_meta if cell_meta else {},
                    "outputs": [],
                    "execution_count": None
                }
                if is_params:
                    cell["metadata"]["tags"] = ["parameters"]
                cells.append(cell)
            continue

        # Markdown cell
        if line.strip() == "# MARKDOWN ********************":
            i += 1
            source_lines = []

            while i < len(lines):
                if lines[i].strip() in ("# METADATA ********************", "# CELL ********************",
                                         "# MARKDOWN ********************", "# PARAMETERS CELL ********************"):
                    break
                else:
                    md_line = lines[i]
                    if md_line.startswith("# "):
                        md_line = md_line[2:]
                    elif md_line == "#":
                        md_line = ""
                    source_lines.append(md_line)
                    i += 1

            # Trim trailing empty lines
            while source_lines and source_lines[-1].strip() == "":
                source_lines.pop()

            if source_lines:
                src = []
                for idx, sl in enumerate(source_lines):
                    if idx < len(source_lines) - 1:
                        src.append(sl + "\n")
                    else:
                        src.append(sl)
                cell = {
                    "cell_type": "markdown",
                    "source": src,
                    "metadata": {}
                }
                cells.append(cell)
            continue

        # Skip standalone metadata blocks
        if line.strip() == "# METADATA ********************":
            i += 1
            while i < len(lines) and lines[i].startswith("# META"):
                i += 1
            continue

        i += 1

    nb = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "cells": cells,
        "metadata": {
            "kernel_info": notebook_meta.get("kernel_info", {"name": "synapse_pyspark"}),
            "language_info": {"name": "python"},
            "dependencies": notebook_meta.get("dependencies", {})
        }
    }
    return json.dumps(nb)

def main():
    token = get_token()
    print("[OK] Got Fabric API token")

    # List notebooks in workspace
    items = fabric_get(f"workspaces/{CODE_WS}/items?type=Notebook", token)
    nb_map = {}
    for item in items.get("value", []):
        nb_map[item["displayName"]] = item["id"]
        print(f"  Found: {item['displayName']} -> {item['id']}")

    notebooks_to_upload = [
        "NB_FMD_LOAD_LANDING_BRONZE",
        "NB_FMD_LOAD_BRONZE_SILVER",
        "NB_FMD_DQ_CLEANSING",
        "NB_FMD_PROCESSING_PARALLEL_MAIN",
    ]

    for nb_name in notebooks_to_upload:
        if nb_name not in nb_map:
            print(f"[SKIP] {nb_name} not found in workspace")
            continue

        item_id = nb_map[nb_name]
        py_path = os.path.join("src", f"{nb_name}.Notebook", "notebook-content.py")

        if not os.path.exists(py_path):
            print(f"[SKIP] {py_path} not found locally")
            continue

        with open(py_path, "r", encoding="utf-8") as f:
            py_content = f.read()

        # Convert to ipynb
        ipynb_json = fabric_py_to_ipynb(py_content)
        ipynb_b64 = base64.b64encode(ipynb_json.encode("utf-8")).decode("utf-8")

        payload = json.dumps({
            "definition": {
                "format": "ipynb",
                "parts": [{
                    "path": "notebook-content.ipynb",
                    "payload": ipynb_b64,
                    "payloadType": "InlineBase64",
                }]
            }
        }).encode()

        url = f"{FABRIC_API}/workspaces/{CODE_WS}/items/{item_id}/updateDefinition"
        req = Request(url, data=payload, method="POST",
                      headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            resp = urlopen(req)
            print(f"[OK] {nb_name} -> HTTP {resp.status}")
        except HTTPError as e:
            body = e.read().decode()[:300]
            print(f"[FAIL] {nb_name} -> HTTP {e.code}: {body}")

    print("\nDone.")

if __name__ == "__main__":
    main()
