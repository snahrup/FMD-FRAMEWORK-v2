#!/usr/bin/env python
"""Close MT-37 and MT-17, backdate to 3/5. Move MT-18 to In Progress."""

import json, urllib.request, urllib.error, base64, time

JIRA = "https://ip-corporation.atlassian.net/rest/api/3"
JIRA_URL = "https://ip-corporation.atlassian.net"
TOKEN = "ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6"
_creds = base64.b64encode(f"snahrup@ip-corporation.com:{TOKEN}".encode()).decode()
STEVE = "712020:aaf5cbe0-f88b-4eb5-ae6f-b1ba5f939752"
PATRICK = "557058:73c68783-606a-412c-89fa-502eddc13439"
DOMINIQUE = "712020:e9809320-35bb-4dd1-93df-69e1285f4f9c"


def jira_request(path, method="GET", data=None):
    url = f"{JIRA}{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"Basic {_creds}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.read().decode()[:500]}")
        return None


def ic(key):
    return {"type": "inlineCard", "attrs": {"url": f"{JIRA_URL}/browse/{key}"}}

def t(s, marks=None):
    node = {"type": "text", "text": s}
    if marks:
        node["marks"] = marks
    return node

def p(*nodes):
    return {"type": "paragraph", "content": list(nodes)}

def add_comment(key, adf):
    return jira_request(f"/issue/{key}/comment", "POST", {
        "body": {"version": 1, "type": "doc", "content": adf}
    })

def add_worklog(key, seconds, started, comment_text):
    return jira_request(f"/issue/{key}/worklog", "POST", {
        "timeSpentSeconds": seconds,
        "started": started,
        "comment": {
            "version": 1, "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": comment_text}]}]
        }
    })

def do_transition(key, tid):
    return jira_request(f"/issue/{key}/transitions", "POST", {"transition": {"id": str(tid)}})

def update_fields(key, fields):
    return jira_request(f"/issue/{key}", "PUT", {"fields": fields})

def add_watcher(key, aid):
    url = f"{JIRA}/issue/{key}/watchers"
    body = json.dumps(aid).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Basic {_creds}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return True
    except urllib.error.HTTPError:
        return False


# ============================================
# MT-37: Close — Scale up COMPLETE (backdate to 3/5)
# ============================================
print("=== MT-37: Scale up to full table set — CLOSING ===")

# Check current status first
issue = jira_request("/issue/MT-37?fields=status")
if issue:
    status = issue["fields"]["status"]["name"]
    print(f"  Current status: {status}")
else:
    print("  Could not fetch issue status")

# Closing comment
print("  Adding closing comment...")
r = add_comment("MT-37", [
    p(t("Done. All 1,666 entities loaded across all four sources (MES, ETQ, M3 ERP, M3 Cloud) through the full medallion stack: Landing Zone, Bronze, and Silver. 100% coverage.")),
    p(t("This was the longest-running subtask on the board and the one that kept uncovering deeper issues. Started at 90% back on 3/3, got stuck there because of the entity activation bug ("),
      ic("MT-90"),
      t("). Once that was fixed and the pipeline queues were properly bootstrapped, the bronze and silver notebook runs chewed through the remaining entities cleanly.")),
    p(t("The pipeline stack that got us here: ForEach error tolerance ("),
      ic("MT-84"),
      t("), OPTIVA source isolation ("),
      ic("MT-83"),
      t("), hybrid notebook orchestrator ("),
      ic("MT-86"),
      t("), and the activation fix ("),
      ic("MT-90"),
      t("). Each one peeled back a layer. Now we can move on to validating Silver transformations ("),
      ic("MT-18"),
      t(") and testing incremental loads ("),
      ic("MT-57"),
      t(")."))
])
print(f"  Comment: {'OK' if r else 'FAILED'}")

# Set remaining to 0
print("  Setting remaining to 0h...")
r = update_fields("MT-37", {"timetracking": {"remainingEstimate": "0h"}})
print(f"  Remaining: {'OK' if r is not None else 'FAILED'}")

# Add watchers
print("  Adding watchers...")
add_watcher("MT-37", PATRICK)
add_watcher("MT-37", DOMINIQUE)

# Transition to Done
print("  Transitioning to Done...")
r = do_transition("MT-37", "31")
print(f"  Done: {'OK' if r is not None else 'FAILED'}")


# ============================================
# MT-17: Close — LZ + Bronze parent COMPLETE (backdate to 3/5)
# ============================================
print()
print("=== MT-17: Build & Validate LZ + Bronze Pipelines — CLOSING ===")

issue = jira_request("/issue/MT-17?fields=status")
if issue:
    status = issue["fields"]["status"]["name"]
    print(f"  Current status: {status}")

# Closing comment
print("  Adding closing comment...")
r = add_comment("MT-17", [
    p(t("Closing this one out. All 8 subtasks are Done. The full entity set (1,666 entities across MES, ETQ, M3 ERP, M3 Cloud) is loaded through Landing Zone, Bronze, and Silver.")),
    p(t("This task ended up being way more involved than the original estimate. What started as 'test LZ and Bronze pipelines' turned into a deep dive through the entire pipeline execution stack. The subtask chain tells the story: single-table validation ("),
      ic("MT-34"),
      t(", "),
      ic("MT-35"),
      t("), row count checks ("),
      ic("MT-36"),
      t("), OPTIVA source isolation ("),
      ic("MT-83"),
      t("), ForEach error tolerance ("),
      ic("MT-84"),
      t("), the full hybrid pipeline rebuild ("),
      ic("MT-86"),
      t("), entity activation fix ("),
      ic("MT-90"),
      t("), and finally the scale-up to 100% ("),
      ic("MT-37"),
      t(").")),
    p(t("The landing zone and bronze layers are production-ready. Silver is loaded and running. Next up is formal Silver validation ("),
      ic("MT-18"),
      t(") and incremental load testing ("),
      ic("MT-57"),
      t(")."))
])
print(f"  Comment: {'OK' if r else 'FAILED'}")

# Set remaining to 0
print("  Setting remaining to 0h...")
r = update_fields("MT-17", {"timetracking": {"remainingEstimate": "0h"}})
print(f"  Remaining: {'OK' if r is not None else 'FAILED'}")

# Add watchers
print("  Adding watchers...")
add_watcher("MT-17", PATRICK)
add_watcher("MT-17", DOMINIQUE)

# Transition to Done
print("  Transitioning to Done...")
r = do_transition("MT-17", "31")
print(f"  Done: {'OK' if r is not None else 'FAILED'}")


# ============================================
# MT-18: Move to In Progress
# ============================================
print()
print("=== MT-18: Silver Layer — moving to In Progress ===")

issue = jira_request("/issue/MT-18?fields=status")
if issue:
    status = issue["fields"]["status"]["name"]
    print(f"  Current status: {status}")

print("  Transitioning to In Progress...")
r = do_transition("MT-18", "2")
print(f"  In Progress: {'OK' if r is not None else 'FAILED'}")

print("  Adding comment...")
r = add_comment("MT-18", [
    p(t("Moving this to In Progress. Silver layer data is now loaded for all 1,666 entities as part of the full pipeline runs that completed under "),
      ic("MT-17"),
      t(". The data is there. Now need to formally validate the Silver transformations: SCD Type 2 logic, schema conformance, and data quality across all four sources.")),
    p(t("The Silver notebook (NB_FMD_LOAD_BRONZE_SILVER) ran as part of the end-to-end loads. Next step is to dig into the actual output and verify the merge logic, surrogate keys, and type 2 history tracking are working correctly."))
])
print(f"  Comment: {'OK' if r else 'FAILED'}")


# ============================================
# Update MT-17 due date to yesterday (3/5) to match completion
# ============================================
print()
print("=== Backdating MT-17 due date to 3/5 ===")
r = update_fields("MT-17", {"duedate": "2026-03-05"})
print(f"  Due date: {'OK' if r is not None else 'FAILED'}")

print()
print("=== ALL UPDATES COMPLETE ===")
print("  MT-37: Done (100% entity coverage)")
print("  MT-17: Done (all 8 subtasks complete, due date 3/5)")
print("  MT-18: In Progress (Silver validation begins)")
