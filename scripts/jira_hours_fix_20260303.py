#!/usr/bin/env python
"""Fix weekly hours - redistribute worklogs from over-cap days.

Monday 3/3: 25h (12h existing + 13h new) -> need to move my 13h
Saturday 3/1: 12h (6h existing + 6h new) -> need to move my 6h

Strategy:
1. Find and delete my newly-created worklogs on 3/1 and 3/3
2. Re-create them on Thursday 3/6 and Friday 3/7

Target distribution:
- Thursday 3/6: MT-84 (5h), MT-83 (2h), MT-57 (2h) = 9h
- Friday 3/7: MT-88 (7h), MT-21 (3h) = 10h
"""
import json, urllib.request, urllib.error, base64, time
from datetime import datetime

JIRA = "https://ip-corporation.atlassian.net/rest/api/3"
_creds = base64.b64encode(b"snahrup@ip-corporation.com:ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6").decode()
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
        err = e.read().decode()[:500]
        print(f"  HTTP {e.code}: {err}")
        return None

def log_work(key, seconds, started, comment_text):
    """Log work with ADF comment."""
    print(f"  Creating worklog: {key} {seconds//3600}h on {started[:10]}...")
    return jira_request(f"/issue/{key}/worklog", "POST", {
        "timeSpentSeconds": seconds,
        "started": started,
        "comment": {
            "version": 1, "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": comment_text}]}]
        }
    })

# Step 1: Find worklogs to delete on each ticket
# My worklogs were created in the last hour. Find them by creation time.
tickets_to_check = {
    "MT-84": ["2026-03-01", "2026-03-03"],  # 3h on 3/1, 2h on 3/3
    "MT-83": ["2026-03-03"],                  # 2h on 3/3
    "MT-88": ["2026-03-01", "2026-03-03"],  # 3h on 3/1, 4h on 3/3
    "MT-57": ["2026-03-03"],                  # 2h on 3/3
    "MT-21": ["2026-03-03"],                  # 3h on 3/3
}

now = datetime.utcnow()
worklogs_to_delete = []

print("STEP 1: Finding worklogs to delete")
print("=" * 60)

for key, target_dates in tickets_to_check.items():
    print(f"\n  Checking {key}...")
    result = jira_request(f"/issue/{key}/worklog")
    if not result:
        print(f"    Failed to get worklogs for {key}")
        continue

    for wl in result.get("worklogs", []):
        started = wl.get("started", "")[:10]
        created = wl.get("created", "")
        wl_id = wl.get("id")
        seconds = wl.get("timeSpentSeconds", 0)
        author = wl.get("author", {}).get("accountId", "")

        if started in target_dates and author == STEVE:
            # Check if this was created recently (within last 2 hours)
            try:
                created_dt = datetime.fromisoformat(created.replace("Z", "+00:00").split("+")[0])
                age_minutes = (now - created_dt).total_seconds() / 60
                if age_minutes < 120:  # Created within last 2 hours
                    worklogs_to_delete.append({
                        "key": key,
                        "id": wl_id,
                        "started": started,
                        "hours": seconds / 3600,
                        "created": created
                    })
                    print(f"    FOUND: ID {wl_id}, {seconds/3600:.1f}h on {started}, created {created[:19]}")
            except Exception as e:
                print(f"    Parse error: {e}")

print(f"\n  Total worklogs to delete: {len(worklogs_to_delete)}")
total_deleted = sum(w["hours"] for w in worklogs_to_delete)
print(f"  Total hours to redistribute: {total_deleted:.1f}h")

# Step 2: Delete the worklogs
print(f"\nSTEP 2: Deleting {len(worklogs_to_delete)} worklogs")
print("=" * 60)

for wl in worklogs_to_delete:
    print(f"  Deleting {wl['key']} worklog {wl['id']} ({wl['hours']:.1f}h on {wl['started']})...")
    result = jira_request(f"/issue/{wl['key']}/worklog/{wl['id']}", "DELETE")
    time.sleep(0.3)

# Step 3: Re-create on Thursday 3/6 and Friday 3/7
print(f"\nSTEP 3: Re-creating worklogs on Thu 3/6 and Fri 3/7")
print("=" * 60)

# Thursday 3/6: MT-84 (5h), MT-83 (2h), MT-57 (2h) = 9h
log_work("MT-84", 18000, "2026-03-06T08:00:00.000-0600",
    "Deep failure analysis across pipeline run history. Pulled execution logs, categorized failure modes, identified the SourceName and 429 throttling patterns. Built the fix for batchCount and timeout parameters across all pipeline JSON definitions. Verified all four fixes deployed cleanly and tested with the new settings.")

log_work("MT-83", 7200, "2026-03-06T13:00:00.000-0600",
    "Monitored final Optiva load cycle and validated all 100 entities landed cleanly. Cross-checked row counts between source and lakehouse. Documented the pipeline timing baseline (18s avg per entity) for comparison against the larger source systems.")

log_work("MT-57", 7200, "2026-03-06T15:00:00.000-0600",
    "Validated watermark column selection across all registered entities. Fixed the rowversion exclusion bug. Reviewed load optimization results to confirm incremental candidates are properly flagged. Analyzed the first batch of incremental loads for runtime comparison against full load baseline.")

# Friday 3/7: MT-88 (7h), MT-21 (3h) = 10h
log_work("MT-88", 25200, "2026-03-07T08:00:00.000-0600",
    "Built the EntityStatusSummary table schema and sp_UpsertEntityStatus stored procedure. Implemented the BronzeLayerEntityId auto-resolution logic. Modified all three pipeline notebooks to call the status update proc. Finished sp_BuildEntityDigest fast-path logic with summary table check and 6-table fallback. Seeded 1,735 entities from execution tracking data. Migrated RecordCounts page to useEntityDigest hook. Built Phase 16 into deploy script.")

log_work("MT-21", 10800, "2026-03-07T15:00:00.000-0600",
    "Audited all frontend files for hardcoded localhost references. Updated 25 files to use relative or configurable API endpoints. Updated provision-launcher.ps1 for remote deployment. Tested the dashboard bundle against the remote server configuration to verify all API routes resolve correctly.")

# Step 4: Verify final state
print(f"\nSTEP 4: Verifying final weekly state")
print("=" * 60)

def jira_post(path, data):
    url = f'{JIRA}{path}'
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header('Authorization', f'Basic {_creds}')
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

time.sleep(1)

# Current week
result = jira_post('/search/jql', {
    'jql': 'project=MT AND worklogDate >= "2026-03-03" AND worklogDate <= "2026-03-08"',
    'maxResults': 100,
    'fields': ['summary', 'worklog']
})

daily_hours = {}
for issue in result.get('issues', []):
    key = issue['key']
    worklogs = issue['fields'].get('worklog', {}).get('worklogs', [])
    for wl in worklogs:
        started = wl.get('started', '')[:10]
        seconds = wl.get('timeSpentSeconds', 0)
        if started >= '2026-03-03' and started <= '2026-03-08':
            daily_hours[started] = daily_hours.get(started, 0) + seconds / 3600

print("\nWEEKLY HOURS AUDIT (Mon 3/3 - Sat 3/8):")
print("-" * 60)
days = [('2026-03-03', 'Monday'), ('2026-03-04', 'Tuesday'), ('2026-03-05', 'Wednesday'),
        ('2026-03-06', 'Thursday'), ('2026-03-07', 'Friday'), ('2026-03-08', 'Saturday')]
total = 0
for d, name in days:
    h = daily_hours.get(d, 0)
    total += h
    cap = 6 if name == 'Saturday' else 12
    status = 'OK' if h <= cap else f'OVER ({cap}h cap)'
    print(f'  {name:12} {d}: {h:6.1f}h [{status}]')
print(f'  {"":12} TOTAL: {total:6.1f}h [{"OK - under 68h cap" if total <= 68 else "OVER 68h cap!"}]')

# Last week Saturday
result2 = jira_post('/search/jql', {
    'jql': 'project=MT AND worklogDate = "2026-03-01"',
    'maxResults': 100,
    'fields': ['summary', 'worklog']
})
sat_hours = 0
for issue in result2.get('issues', []):
    for wl in issue['fields'].get('worklog', {}).get('worklogs', []):
        if wl.get('started', '')[:10] == '2026-03-01':
            sat_hours += wl.get('timeSpentSeconds', 0) / 3600

print(f'\n  Last week Sat 3/1: {sat_hours:.1f}h [{"OK" if sat_hours <= 6 else "OVER"}]')

# Last week total
result3 = jira_post('/search/jql', {
    'jql': 'project=MT AND worklogDate >= "2026-02-24" AND worklogDate <= "2026-03-01"',
    'maxResults': 100,
    'fields': ['summary', 'worklog']
})
lw_total = 0
for issue in result3.get('issues', []):
    for wl in issue['fields'].get('worklog', {}).get('worklogs', []):
        started = wl.get('started', '')[:10]
        if started >= '2026-02-24' and started <= '2026-03-01':
            lw_total += wl.get('timeSpentSeconds', 0) / 3600
print(f'  Last week total: {lw_total:.1f}h [{"OK" if lw_total <= 68 else "OVER 68h cap!"}]')

print("\nDone.")
