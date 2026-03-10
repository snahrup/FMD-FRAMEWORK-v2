"""
Weekly Hours Audit — Fix over-budget worklogs
Brings this week's total from 120.8h down to within the 68h cap.
"""
import json
import urllib.request
import urllib.error
import base64
from datetime import datetime, timedelta
from collections import defaultdict

JIRA = "https://ip-corporation.atlassian.net/rest/api/3"
AUTH_USER = "snahrup@ip-corporation.com"
AUTH_TOKEN = "ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6"
_creds = base64.b64encode(f"{AUTH_USER}:{AUTH_TOKEN}".encode()).decode()

# Caps
MAX_WEEKDAY = 12 * 3600  # 12h
MAX_SATURDAY = 6 * 3600  # 6h
MAX_WEEK = 68 * 3600     # 68h

WEEK_START = "2026-02-23"  # Monday
WEEK_END = "2026-02-28"    # Saturday


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
        body = e.read().decode()
        print(f"  HTTP {e.code}: {body[:300]}")
        return None


def fmt_hours(secs):
    h = secs / 3600
    return f"{h:.1f}h"


def get_day_name(date_str):
    return datetime.strptime(date_str, "%Y-%m-%d").strftime("%A")


# ── Step 1: Get all worklogs for this week ──
print("=" * 60)
print("WEEKLY HOURS AUDIT — Mon 2/23 through Sat 2/28")
print("=" * 60)

print("\n[1] Fetching all issues with worklogs this week...")
result = jira_request("/search/jql", "POST", {
    "jql": f"project=MT AND worklogDate >= {WEEK_START} AND worklogDate <= {WEEK_END} ORDER BY key ASC",
    "maxResults": 50,
    "fields": ["summary", "worklog"]
})

if not result:
    print("FAILED to fetch issues")
    exit(1)

# Collect all worklogs
all_worklogs = []  # (issue_key, summary, worklog_id, date, seconds, started_full)
by_day = defaultdict(int)
by_ticket = defaultdict(lambda: {"summary": "", "seconds": 0})

for issue in result.get("issues", []):
    key = issue["key"]
    summary = issue["fields"]["summary"]
    worklogs = issue["fields"].get("worklog", {}).get("worklogs", [])

    for wl in worklogs:
        started = wl.get("started", "")
        date_str = started[:10]
        if WEEK_START <= date_str <= WEEK_END:
            secs = wl.get("timeSpentSeconds", 0)
            wl_id = wl.get("id")
            comment_body = wl.get("comment", {})
            # Extract plain text from ADF comment
            comment_text = ""
            if comment_body and comment_body.get("content"):
                for block in comment_body["content"]:
                    for c in block.get("content", []):
                        comment_text += c.get("text", "")

            all_worklogs.append({
                "key": key,
                "summary": summary[:50],
                "wl_id": wl_id,
                "date": date_str,
                "seconds": secs,
                "started": started,
                "comment": comment_text[:200]
            })
            by_day[date_str] += secs
            by_ticket[key]["summary"] = summary[:50]
            by_ticket[key]["seconds"] += secs

total_before = sum(by_day.values())
print(f"\n[2] BEFORE — Total: {fmt_hours(total_before)}")
print("-" * 50)
for date in sorted(by_day.keys()):
    day = get_day_name(date)
    secs = by_day[date]
    cap = MAX_SATURDAY if day == "Saturday" else MAX_WEEKDAY
    status = "OVER" if secs > cap else "OK"
    print(f"  {day:12} {date}  {fmt_hours(secs):>8}  [{status}]  (cap: {fmt_hours(cap)})")
print(f"  {'TOTAL':12} {'':>10}  {fmt_hours(total_before):>8}  [{'OVER' if total_before > MAX_WEEK else 'OK'}]  (cap: {fmt_hours(MAX_WEEK)})")

if total_before <= MAX_WEEK:
    print("\nWeekly total is within cap. No adjustments needed.")
    exit(0)

# ── Step 3: Calculate target distribution ──
print(f"\n[3] Need to reduce from {fmt_hours(total_before)} to under {fmt_hours(MAX_WEEK)}...")

# Target: distribute 66h across the week (leave 2h buffer under 68h cap)
TARGET_TOTAL = 66 * 3600
days = sorted(by_day.keys())

# Target per day: proportional to current, but capped
day_targets = {}
for date in days:
    day = get_day_name(date)
    cap = MAX_SATURDAY if day == "Saturday" else MAX_WEEKDAY
    # Proportional share of target
    proportion = by_day[date] / total_before
    target = int(TARGET_TOTAL * proportion)
    # Cap it
    target = min(target, cap)
    day_targets[date] = target

# Adjust if sum of targets doesn't match (distribute remainder)
target_sum = sum(day_targets.values())
if target_sum < TARGET_TOTAL:
    # Add remainder to days with most headroom
    remainder = TARGET_TOTAL - target_sum
    for date in sorted(days, key=lambda d: (MAX_SATURDAY if get_day_name(d) == "Saturday" else MAX_WEEKDAY) - day_targets[d], reverse=True):
        cap = MAX_SATURDAY if get_day_name(date) == "Saturday" else MAX_WEEKDAY
        headroom = cap - day_targets[date]
        add = min(headroom, remainder)
        day_targets[date] += add
        remainder -= add
        if remainder <= 0:
            break

print("\nTarget distribution:")
for date in sorted(day_targets.keys()):
    day = get_day_name(date)
    print(f"  {day:12} {date}  {fmt_hours(by_day[date]):>8} -> {fmt_hours(day_targets[date]):>8}")
print(f"  TOTAL: {fmt_hours(sum(day_targets.values()))}")

# ── Step 4: For each over-budget day, find and reduce worklogs ──
print(f"\n[4] Adjusting worklogs...")

adjustments = 0
for date in sorted(days):
    current = by_day[date]
    target = day_targets[date]

    if current <= target:
        continue

    reduction_needed = current - target
    # Get worklogs for this day, sorted by largest first
    day_wls = sorted(
        [w for w in all_worklogs if w["date"] == date],
        key=lambda w: w["seconds"],
        reverse=True
    )

    print(f"\n  {get_day_name(date)} {date}: need to reduce by {fmt_hours(reduction_needed)}")

    for wl in day_wls:
        if reduction_needed <= 0:
            break

        # Reduce this worklog proportionally
        proportion_of_day = wl["seconds"] / current
        reduce_by = int(reduction_needed * proportion_of_day)
        # Don't reduce below 1h minimum
        new_seconds = max(3600, wl["seconds"] - reduce_by)
        actual_reduction = wl["seconds"] - new_seconds

        if actual_reduction <= 0:
            continue

        print(f"    {wl['key']}: {fmt_hours(wl['seconds'])} -> {fmt_hours(new_seconds)} (-{fmt_hours(actual_reduction)})")

        # Delete old worklog
        del_result = jira_request(f"/issue/{wl['key']}/worklog/{wl['wl_id']}", "DELETE")

        # Re-create with reduced time
        new_wl = jira_request(f"/issue/{wl['key']}/worklog", "POST", {
            "timeSpentSeconds": new_seconds,
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
            reduction_needed -= actual_reduction
        else:
            print(f"    FAILED to recreate worklog for {wl['key']}")

# ── Step 5: Verify ──
print(f"\n[5] Verifying final state...")
result2 = jira_request("/search/jql", "POST", {
    "jql": f"project=MT AND worklogDate >= {WEEK_START} AND worklogDate <= {WEEK_END} ORDER BY key ASC",
    "maxResults": 50,
    "fields": ["summary", "worklog"]
})

by_day_after = defaultdict(int)
for issue in result2.get("issues", []):
    for wl in issue["fields"].get("worklog", {}).get("worklogs", []):
        date_str = wl.get("started", "")[:10]
        if WEEK_START <= date_str <= WEEK_END:
            by_day_after[date_str] += wl.get("timeSpentSeconds", 0)

total_after = sum(by_day_after.values())

print(f"\nAFTER — Total: {fmt_hours(total_after)}")
print("-" * 50)
for date in sorted(by_day_after.keys()):
    day = get_day_name(date)
    secs = by_day_after[date]
    cap = MAX_SATURDAY if day == "Saturday" else MAX_WEEKDAY
    status = "OVER" if secs > cap else "OK"
    print(f"  {day:12} {date}  {fmt_hours(secs):>8}  [{status}]")
print(f"  {'TOTAL':12} {'':>10}  {fmt_hours(total_after):>8}  [{'OVER' if total_after > MAX_WEEK else 'OK'}]")

print(f"\n{'=' * 60}")
print(f"ADJUSTMENTS: {adjustments} worklogs modified")
print(f"BEFORE: {fmt_hours(total_before)} -> AFTER: {fmt_hours(total_after)}")
print(f"Weekly cap: {fmt_hours(MAX_WEEK)} — {'PASS' if total_after <= MAX_WEEK else 'FAIL'}")
print(f"{'=' * 60}")
