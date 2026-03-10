"""Fetch all comments from specified Jira issues and save to JSON files."""
import urllib.request
import urllib.error
import base64
import json
import os

JIRA_BASE = "https://ip-corporation.atlassian.net/rest/api/3"
AUTH = base64.b64encode(b"snahrup@ip-corporation.com:ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6").decode()

ISSUES = ["MT-17", "MT-83", "MT-84", "MT-85", "MT-37", "MT-36", "MT-57"]

OUT_DIR = os.path.join(os.path.dirname(__file__), "jira_comments_dump")
os.makedirs(OUT_DIR, exist_ok=True)

def extract_text(node):
    """Recursively extract plain text from ADF nodes."""
    parts = []
    if isinstance(node, dict):
        if node.get("type") == "text":
            parts.append(node.get("text", ""))
        for child in node.get("content", []):
            parts.extend(extract_text(child))
    elif isinstance(node, list):
        for item in node:
            parts.extend(extract_text(item))
    return parts

for issue_key in ISSUES:
    url = f"{JIRA_BASE}/issue/{issue_key}/comment"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Basic {AUTH}",
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"ERROR {issue_key}: {e.code} {e.reason}")
        continue

    # Save full JSON
    out_file = os.path.join(OUT_DIR, f"{issue_key}_comments.json")
    with open(out_file, "w") as f:
        json.dump(data, f, indent=2)

    comments = data.get("comments", [])
    print(f"\n{'='*60}")
    print(f"{issue_key} - {len(comments)} comment(s)")
    print(f"{'='*60}")

    for c in comments:
        created = c.get("created", "")
        cid = c.get("id", "")
        author = c.get("author", {}).get("displayName", "unknown")
        body = c.get("body", {})
        text = " ".join(extract_text(body))
        is_today = "2026-02-27" in created

        if is_today:
            marker = " *** TODAY ***"
        else:
            marker = ""

        print(f"\n  Comment ID: {cid}{marker}")
        print(f"  Author: {author}")
        print(f"  Created: {created}")
        print(f"  Preview: {text[:300]}")
        print(f"  ---")

print("\n\nDone. Full JSON saved to:", OUT_DIR)
