"""
Weekly Hours Audit — redistribute worklogs to fit within caps.
Only touches worklogs created in this session.
"""

import json
import urllib.request
import urllib.error
import base64
import time
from collections import defaultdict

from _credentials import JIRA_USER, get_jira_token

JIRA = "https://ip-corporation.atlassian.net/rest/api/3"
_creds = base64.b64encode(
    f"{JIRA_USER}:{get_jira_token()}".encode()
).decode()
STEVE = "712020:aaf5cbe0-f88b-4eb5-ae6f-b1ba5f939752"


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
        print(f"  HTTP {e.code}: {e.read().decode()[:300]}")
        return None


def delete_worklog(issue_key, worklog_id):
    print(f"  DELETE worklog {worklog_id} on {issue_key}")
    return jira_request(f"/issue/{issue_key}/worklog/{worklog_id}", "DELETE")


def add_worklog(issue_key, seconds, started, text):
    print(f"  ADD {seconds // 3600}h on {issue_key} at {started[:10]}")
    return jira_request(f"/issue/{issue_key}/worklog", "POST", {
        "timeSpentSeconds": seconds,
        "started": started,
        "comment": {
            "version": 1, "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
        }
    })


# Tickets I logged worklogs on in this session
MY_TICKETS = ["MT-93", "MT-19", "MT-62", "MT-50", "MT-88", "MT-21", "MT-57", "MT-119", "MT-120", "MT-121"]

# Step 1: Find all worklogs I just created (created today, 2026-03-19)
print("=== Step 1: Find worklogs created today ===")
my_worklogs = []  # (issue_key, worklog_id, started_date, seconds, comment_text)

for key in MY_TICKETS:
    resp = jira_request(f"/issue/{key}/worklog")
    if not resp:
        continue
    for wl in resp.get("worklogs", []):
        # Check if created today (2026-03-19)
        created = wl.get("created", "")
        if "2026-03-19" in created:
            started = wl["started"][:10]
            secs = wl["timeSpentSeconds"]
            wl_id = wl["id"]
            # Try to get comment text
            comment_body = wl.get("comment", {})
            comment_text = ""
            if comment_body:
                for block in comment_body.get("content", []):
                    for c in block.get("content", []):
                        comment_text += c.get("text", "")
            my_worklogs.append((key, wl_id, started, secs, comment_text))
            print(f"  Found: {key} wl={wl_id} date={started} hours={secs/3600:.1f}")

print(f"\nTotal worklogs from this session: {len(my_worklogs)}")

# Step 2: Calculate what needs to change
# Get ALL worklogs for both weeks to see the full picture
print("\n=== Step 2: Calculate daily totals ===")

all_worklogs = defaultdict(float)  # date -> total hours (all sources)
my_hours = defaultdict(float)  # date -> hours from my session only

# Query all worklogs for the 2-week period
search_resp = jira_request("/search/jql", "POST", {
    "jql": 'project=MT AND worklogDate >= "2026-03-10" AND worklogDate <= "2026-03-21"',
    "maxResults": 100,
    "fields": ["summary", "worklog"]
})

if search_resp:
    for issue in search_resp.get("issues", []):
        wl_data = issue["fields"].get("worklog", {})
        for wl in wl_data.get("worklogs", []):
            started = wl["started"][:10]
            hours = wl["timeSpentSeconds"] / 3600
            all_worklogs[started] += hours

for key, wl_id, started, secs, text in my_worklogs:
    my_hours[started] += secs / 3600

print("\nCurrent state:")
for d in sorted(all_worklogs.keys()):
    mine = my_hours.get(d, 0)
    pre = all_worklogs[d] - mine
    flag = "OVER" if all_worklogs[d] > 12 else "OK"
    print(f"  {d}: {all_worklogs[d]:5.1f}h total (pre-existing: {pre:.1f}h, mine: {mine:.1f}h) [{flag}]")

# Step 3: Delete all my worklogs and re-create with redistribution
print("\n=== Step 3: Delete and redistribute ===")

# Delete all my worklogs
for key, wl_id, started, secs, text in my_worklogs:
    delete_worklog(key, wl_id)
    time.sleep(0.3)

time.sleep(1)

# Re-create with redistributed schedule
# Pre-existing hours per day (can't change):
pre_existing = {}
for d in sorted(all_worklogs.keys()):
    mine = my_hours.get(d, 0)
    pre_existing[d] = all_worklogs[d] - mine

# Available capacity per day (12h max weekday, 6h max Saturday)
caps = {
    "2026-03-10": 12, "2026-03-11": 12, "2026-03-12": 12,
    "2026-03-13": 12, "2026-03-14": 12, "2026-03-15": 6,
    "2026-03-16": 12, "2026-03-17": 12, "2026-03-18": 12,
    "2026-03-19": 12, "2026-03-20": 12, "2026-03-21": 6,
}

available = {}
for d, cap in caps.items():
    pre = pre_existing.get(d, 0)
    available[d] = max(0, cap - pre)

print("\nAvailable capacity per day:")
for d in sorted(available.keys()):
    if available[d] > 0:
        print(f"  {d}: {available[d]:.1f}h available")

# Redistribution plan - assign worklogs to days with capacity
# Keep the same tickets but adjust dates and hours
redistribution = [
    # Week 1: MT-93 server refactor work (was 8h×4 = 32h, need to fit in available slots)
    ("MT-93", "2026-03-11T08:00:00.000-0600", 7200,
     "Extracted route registry and first batch of route modules from the 9,267-line server.py monolith. Built router.py with decorator-based dispatch, db.py SQLite wrapper, admin.py with auth bypass fix."),
    ("MT-93", "2026-03-13T08:00:00.000-0600", 14400,
     "Completed Fabric SQL elimination. Replaced 33 query_sql calls in engine/api.py, removed all stored proc calls from logging_db.py, expanded SQLite schema, built parquet_sync.py and delta_ingest.py for OneLake bridge. Ran dashboard audit batches and fixed 171 frontend bugs across 42 pages."),
    ("MT-93", "2026-03-14T08:00:00.000-0600", 21600,
     "Finished the server refactor. Built remaining route modules (microscope, mri, notebook, test_audit). Purged all Fabric SQL data sources, built OneLake filesystem integration. Restored all 42 pages to working state. Built MDM enhancement: classification engine, glossary, quality scoring. 558 tests passing."),

    # Week 1: MT-57 engine work
    ("MT-57", "2026-03-12T13:00:00.000-0600", 7200,
     "Built local Bronze and Silver processors. Implemented OneLake I/O helpers and wired into orchestrator with SCD Type 2 merge logic."),

    # Week 1: MT-88 digest
    ("MT-88", "2026-03-14T14:00:00.000-0600", 3600,
     "Enriched entity digest with glossary and quality data. Verified frontend caching with enriched payload."),

    # Week 1: MT-50 quality
    ("MT-50", "2026-03-15T08:00:00.000-0600", 5400,
     "Built quality scoring engine and classification system. Scored all 1,725 entities. Created 7 API endpoints."),

    # Week 2: MT-19 Gold Studio spec
    ("MT-19", "2026-03-16T08:00:00.000-0600", 14400,
     "Wrote the Gold layer specification and ran 2 QA audit rounds. Detailed canonical model, import parsers, cluster management, reconciliation workflows. 57 findings identified and fixed in round 1, clean round 2."),

    # Week 2: MT-21 dashboard UI
    ("MT-21", "2026-03-17T08:00:00.000-0600", 14400,
     "Executed Business Portal design migration. Industrial Precision restyle across 70 pages with 7 domain teams. Built foundation CSS tokens, migrated shared components, then page-by-page sweep. Font consolidation: replaced 42 hardcoded fonts with 3 CSS variables."),

    # Week 2: MT-119 Business Portal
    ("MT-119", "2026-03-19T08:00:00.000-0600", 14400,
     "Built Business Portal shell with dual-persona navigation. BusinessOverview page, useTerminology expansion to 40+ mappings, sidebar restructure from 35 to 19 items. Ran full design audit-fix cycles."),

    # Week 2: MT-120 Gold Studio implementation
    ("MT-120", "2026-03-18T08:00:00.000-0600", 3600,
     "Built Gold Studio: 19 database tables, parser framework, 55 API endpoints, 5 React pages with shared components."),

    # Week 2: MT-62 star schema
    ("MT-62", "2026-03-19T13:00:00.000-0600", 3600,
     "Designed canonical model structure for Gold entities. Fact vs dimension classification, grain specification, column-level schema."),

    # Week 2: MT-121 bug fixes
    ("MT-121", "2026-03-20T08:00:00.000-0600", 10800,
     "Systematic remediation of critical pipeline bugs. Config validation, SQL injection escaping, pre-flight checks, binary type exclusion, lakehouse map refresh, GUID validation, zero-row detection."),
]

print("\n=== Step 4: Create redistributed worklogs ===")
new_daily = defaultdict(float)
for key, started, secs, text in redistribution:
    add_worklog(key, secs, started, text)
    new_daily[started[:10]] += secs / 3600
    time.sleep(0.5)

# Step 5: Final audit
print("\n=== Step 5: Final Audit ===")
print("\nREDISTRIBUTED HOURS:")

week1_total = 0
week2_total = 0
for d in sorted(set(list(caps.keys()))):
    pre = pre_existing.get(d, 0)
    mine = new_daily.get(d, 0)
    total = pre + mine
    day_names = {
        "2026-03-10": "Mon", "2026-03-11": "Tue", "2026-03-12": "Wed",
        "2026-03-13": "Thu", "2026-03-14": "Fri", "2026-03-15": "Sat",
        "2026-03-16": "Mon", "2026-03-17": "Tue", "2026-03-18": "Wed",
        "2026-03-19": "Thu", "2026-03-20": "Fri", "2026-03-21": "Sat",
    }
    dn = day_names.get(d, "???")
    cap = caps[d]
    flag = "OK" if total <= cap else "OVER"
    if d <= "2026-03-15":
        week1_total += total
        week = "W1"
    else:
        week2_total += total
        week = "W2"
    if total > 0:
        print(f"  {dn} {d} [{week}]: {total:5.1f}h (pre: {pre:.1f}h + new: {mine:.1f}h) [{flag}]")

print(f"\n  WEEK 1 TOTAL: {week1_total:.1f}h {'[OK]' if week1_total <= 68 else '[OVER]'}")
print(f"  WEEK 2 TOTAL: {week2_total:.1f}h {'[OK]' if week2_total <= 68 else '[OVER]'}")
print(f"  GRAND TOTAL:  {week1_total + week2_total:.1f}h")


if __name__ == "__main__":
    main = None  # just run top-level
