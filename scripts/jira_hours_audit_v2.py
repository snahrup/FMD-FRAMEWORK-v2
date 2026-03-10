"""
Weekly Hours Audit v2 — More aggressive reduction
Targets specific large worklogs that are still over-budget after v1.
"""
import json
import urllib.request
import urllib.error
import base64
from collections import defaultdict
from datetime import datetime

JIRA = "https://ip-corporation.atlassian.net/rest/api/3"
AUTH_USER = "snahrup@ip-corporation.com"
AUTH_TOKEN = "ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6"
_creds = base64.b64encode(f"{AUTH_USER}:{AUTH_TOKEN}".encode()).decode()

MAX_WEEKDAY = 12 * 3600
MAX_SATURDAY = 6 * 3600
MAX_WEEK = 68 * 3600
WEEK_START = "2026-02-23"
WEEK_END = "2026-02-28"


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


def fmt(secs):
    return f"{secs/3600:.1f}h"


def day_name(d):
    return datetime.strptime(d, "%Y-%m-%d").strftime("%A")


# Fetch current state
print("Fetching current worklogs...")
result = jira_request("/search/jql", "POST", {
    "jql": f"project=MT AND worklogDate >= {WEEK_START} AND worklogDate <= {WEEK_END} ORDER BY key ASC",
    "maxResults": 50,
    "fields": ["summary", "worklog"]
})

# Build full worklog inventory
worklogs = []
by_day = defaultdict(int)

for issue in result.get("issues", []):
    key = issue["key"]
    summary = issue["fields"]["summary"]
    for wl in issue["fields"].get("worklog", {}).get("worklogs", []):
        started = wl.get("started", "")
        date = started[:10]
        if WEEK_START <= date <= WEEK_END:
            secs = wl.get("timeSpentSeconds", 0)
            comment_text = ""
            cb = wl.get("comment", {})
            if cb and cb.get("content"):
                for block in cb["content"]:
                    for c in block.get("content", []):
                        comment_text += c.get("text", "")

            worklogs.append({
                "key": key, "summary": summary[:50], "wl_id": wl["id"],
                "date": date, "seconds": secs, "started": started,
                "comment": comment_text[:200]
            })
            by_day[date] += secs

total = sum(by_day.values())
print(f"\nCurrent total: {fmt(total)}")
for d in sorted(by_day):
    print(f"  {day_name(d):12} {d}  {fmt(by_day[d])}")

if total <= MAX_WEEK:
    print(f"\nAlready under {fmt(MAX_WEEK)} cap. Done.")
    exit(0)

over = total - MAX_WEEK
print(f"\nNeed to cut {fmt(over)} more.")

# Strategy: for each over-budget day, find the LARGEST worklogs and cut them hard
# Priority: cut days furthest over their cap first
days_sorted = sorted(by_day.keys(), key=lambda d: by_day[d], reverse=True)

adjustments = 0
for date in days_sorted:
    if over <= 0:
        break

    cap = MAX_SATURDAY if day_name(date) == "Saturday" else MAX_WEEKDAY
    day_total = by_day[date]
    day_over = day_total - cap

    if day_over <= 0:
        continue

    # How much to cut from this day
    cut_from_day = min(day_over, over)
    remaining_cut = cut_from_day

    # Sort this day's worklogs largest first
    day_wls = sorted([w for w in worklogs if w["date"] == date], key=lambda w: w["seconds"], reverse=True)

    print(f"\n  {day_name(date)} {date}: cutting {fmt(cut_from_day)} (day total: {fmt(day_total)}, cap: {fmt(cap)})")

    for wl in day_wls:
        if remaining_cut <= 0:
            break

        # Cut aggressively — reduce by up to 60% of the worklog
        max_cut = int(wl["seconds"] * 0.6)
        actual_cut = min(max_cut, remaining_cut)
        # Don't go below 30 min
        new_secs = max(1800, wl["seconds"] - actual_cut)
        actual_cut = wl["seconds"] - new_secs

        if actual_cut < 600:  # less than 10 min, not worth it
            continue

        print(f"    {wl['key']}: {fmt(wl['seconds'])} -> {fmt(new_secs)} (-{fmt(actual_cut)})")

        # Delete and recreate
        jira_request(f"/issue/{wl['key']}/worklog/{wl['wl_id']}", "DELETE")
        new_wl = jira_request(f"/issue/{wl['key']}/worklog", "POST", {
            "timeSpentSeconds": new_secs,
            "started": wl["started"],
            "comment": {
                "version": 1, "type": "doc",
                "content": [{"type": "paragraph", "content": [
                    {"type": "text", "text": wl["comment"] if wl["comment"] else "Development work."}
                ]}]
            }
        })
        if new_wl:
            adjustments += 1
            remaining_cut -= actual_cut
            over -= actual_cut
            by_day[date] -= actual_cut
            wl["seconds"] = new_secs

# Verify
print(f"\n{'='*60}")
result2 = jira_request("/search/jql", "POST", {
    "jql": f"project=MT AND worklogDate >= {WEEK_START} AND worklogDate <= {WEEK_END} ORDER BY key ASC",
    "maxResults": 50,
    "fields": ["summary", "worklog"]
})
final_by_day = defaultdict(int)
for issue in result2.get("issues", []):
    for wl in issue["fields"].get("worklog", {}).get("worklogs", []):
        d = wl.get("started", "")[:10]
        if WEEK_START <= d <= WEEK_END:
            final_by_day[d] += wl.get("timeSpentSeconds", 0)

final_total = sum(final_by_day.values())
print(f"FINAL RESULT:")
for d in sorted(final_by_day):
    cap = MAX_SATURDAY if day_name(d) == "Saturday" else MAX_WEEKDAY
    s = final_by_day[d]
    print(f"  {day_name(d):12} {d}  {fmt(s):>8}  [{'OK' if s <= cap else 'OVER'}]")
print(f"  {'TOTAL':25}  {fmt(final_total):>8}  [{'OK' if final_total <= MAX_WEEK else 'OVER'}]")
print(f"\nAdjustments: {adjustments}")
print(f"Status: {'PASS' if final_total <= MAX_WEEK else 'FAIL - need manual intervention'}")
