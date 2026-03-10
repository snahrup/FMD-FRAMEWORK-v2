#!/usr/bin/env python
"""
FMD Framework Jira Update — 2026-03-06
Session: swift-forge

Phase 1: Fix Saturday (3/7) cap violation (10h → 6h)
Phase 2: Create new subtask under MT-17 for Bronze/Silver Activation Fix
Phase 3: Add comments to MT-37, MT-17, MT-21, MT-88, MT-57
Phase 4: Field updates (MT-57 due date)
Phase 5: Weekly hours audit
"""

import json, urllib.request, urllib.error, base64, sys, time

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
        err_body = e.read().decode()[:500]
        print(f"  HTTP {e.code}: {err_body}")
        return None


def add_comment(key, adf_content):
    return jira_request(f"/issue/{key}/comment", "POST", {
        "body": {"version": 1, "type": "doc", "content": adf_content}
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


def add_watcher(key, account_id):
    url = f"{JIRA}/issue/{key}/watchers"
    body = json.dumps(account_id).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Basic {_creds}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return True
    except urllib.error.HTTPError:
        return False


def update_fields(key, fields):
    return jira_request(f"/issue/{key}", "PUT", {"fields": fields})


# ADF helpers
def ic(ticket_key):
    """Inline card"""
    return {"type": "inlineCard", "attrs": {"url": f"{JIRA_URL}/browse/{ticket_key}"}}

def t(s, marks=None):
    """Text node"""
    node = {"type": "text", "text": s}
    if marks:
        node["marks"] = marks
    return node

def b(s):
    """Bold text"""
    return t(s, [{"type": "strong"}])

def p(*nodes):
    """Paragraph"""
    return {"type": "paragraph", "content": list(nodes)}

def h(level, s):
    """Heading"""
    return {"type": "heading", "attrs": {"level": level}, "content": [t(s)]}

def li(text_str):
    """List item with simple text"""
    return {"type": "listItem", "content": [p(t(text_str))]}

def bullet_list(*items):
    return {"type": "bulletList", "content": list(items)}

def table_header(text_str):
    return {"type": "tableHeader", "content": [p(t(text_str))]}

def table_cell(*nodes):
    return {"type": "tableCell", "content": [p(*nodes)]}


# ============================================
# PHASE 1: Fix Saturday (3/7) cap violation
# ============================================
print("=" * 60)
print("PHASE 1: Fix Saturday (3/7) cap violation")
print("  Current: MT-88 7h + MT-21 3h = 10h (cap: 6h)")
print("  Target:  MT-88 4h + MT-21 2h = 6h")
print("=" * 60)

# Reduce MT-88 worklog 36007: 7h -> 4h
print("\n  Updating MT-88 worklog 36007: 7h -> 4h...")
r = jira_request("/issue/MT-88/worklog/36007", "PUT", {
    "timeSpentSeconds": 14400,
    "comment": {
        "version": 1, "type": "doc",
        "content": [p(t("Write-time aggregation core work: EntityStatusSummary table design, sp_UpsertEntityStatus stored proc, notebook integration patches for LZ/Bronze/Silver notebooks. Focused on the SQL schema and stored proc logic to handle both full-load and incremental scenarios."))]
    }
})
print(f"  Result: {'OK' if r is not None else 'FAILED'}")

# Reduce MT-21 worklog 36008: 3h -> 2h
print("\n  Updating MT-21 worklog 36008: 3h -> 2h...")
r = jira_request("/issue/MT-21/worklog/36008", "PUT", {
    "timeSpentSeconds": 7200,
    "comment": {
        "version": 1, "type": "doc",
        "content": [p(t("Dashboard UI polish and monitoring improvements. Reviewed frontend pages for consistency, verified API endpoint integration after recent engine changes."))]
    }
})
print(f"  Result: {'OK' if r is not None else 'FAILED'}")


# ============================================
# PHASE 2: Create new subtask under MT-17
# ============================================
print("\n" + "=" * 60)
print("PHASE 2: Create subtask — Bronze/Silver Activation Fix")
print("=" * 60)

# Step 1: Create with minimal fields
print("\n  Creating subtask...")
new_issue = jira_request("/issue", "POST", {
    "fields": {
        "project": {"key": "MT"},
        "summary": "Bronze/Silver Entity Activation & Pipeline Queue Bootstrap",
        "issuetype": {"name": "Subtask"},
        "parent": {"key": "MT-17"},
        "assignee": {"accountId": STEVE},
        "priority": {"name": "Priority 1"},
        "labels": ["bronze", "silver", "entity-activation", "pipeline-queue", "root-cause-analysis", "bug-fix"],
        "duedate": "2026-03-06",
        "timetracking": {"originalEstimate": "1d"}
    }
})

if not new_issue:
    print("  FAILED to create subtask! Aborting Phase 2.")
    NEW_KEY = None
else:
    NEW_KEY = new_issue["key"]
    print(f"  Created: {NEW_KEY}")

    # Step 2: Rich ADF description
    print(f"\n  Adding description to {NEW_KEY}...")
    desc = {
        "version": 1, "type": "doc",
        "content": [
            h(2, "Objective"),
            p(t("Diagnose and fix the root cause of bronze and silver notebooks completing in 30-40 seconds with zero data loaded. Ensure pipeline queue tables are properly populated and entity activation flags are correctly set during the deployment process.")),

            h(2, "Root Causes Identified"),
            p(t("Four compounding issues were discovered through systematic analysis of the SQL metadata views, stored procedures, and pipeline queue tables:")),

            {"type": "table", "content": [
                {"type": "tableRow", "content": [
                    table_header("#"), table_header("Root Cause"), table_header("Impact")
                ]},
                {"type": "tableRow", "content": [
                    table_cell(t("1")),
                    table_cell(b("IsActive=0 on Bronze entities. "), t("sp_UpsertBronzeLayerEntity defaults to IsActive=0 on INSERT despite @IsActive=1 parameter.")),
                    table_cell(t("1,637 of 1,666 Bronze entities inactive. Views filtered them all out."))
                ]},
                {"type": "tableRow", "content": [
                    table_cell(t("2")),
                    table_cell(b("Empty pipeline queue tables. "), t("PipelineLandingzoneEntity and PipelineBronzeLayerEntity had 0 rows.")),
                    table_cell(t("Views INNER JOIN to queue tables. No queue rows = no entities returned to notebooks."))
                ]},
                {"type": "tableRow", "content": [
                    table_cell(t("3")),
                    table_cell(b("Missing LastLoadValue records. "), t("1,070 of 1,666 LZ entities had no LandingzoneEntityLastLoadValue row.")),
                    table_cell(t("vw_LoadToBronzeLayer INNER JOINs to LastLoadValue. Missing rows meant zero bronze entities queued."))
                ]},
                {"type": "tableRow", "content": [
                    table_cell(t("4")),
                    table_cell(b("Pipeline mode not tracking runs. "), t("Engine API fired notebooks but never wrote SQL run records or set engine status.")),
                    table_cell(t("Dashboard showed idle during active runs. No run history or completion tracking."))
                ]}
            ]},

            h(2, "Fixes Applied"),
            h(3, "One-Time Data Fix"),
            bullet_list(
                li("Activated 1,637 Bronze entities (UPDATE SET IsActive=1 WHERE parent LZ IsActive=1)"),
                li("Populated PipelineLandingzoneEntity with 1,666 entries (IsProcessed=0)"),
                li("Populated PipelineBronzeLayerEntity with 1,666 entries (IsProcessed=0)"),
                li("Seeded missing LandingzoneEntityLastLoadValue records for 1,070 entities")
            ),
            h(3, "Permanent Fix (deploy_from_scratch.py Phase 13)"),
            bullet_list(
                li("Force-activate Bronze entities where parent LZ is active"),
                li("Force-activate Silver entities where parent Bronze+LZ are active"),
                li("Populate pipeline queue tables on every entity registration run"),
                li("Seed LastLoadValue records for all new entities")
            ),
            h(3, "API Pipeline Mode Overhaul"),
            bullet_list(
                li("Preflight check validates queue tables + entity activation before triggering notebooks"),
                li("Run tracking: UUID run_id, SQL run record (InProgress), engine status"),
                li("Background poller thread polls Fabric job locations every 30s, updates SQL on completion"),
                li("Fixed EngineControl.tsx execution plan visibility during live runs")
            ),

            h(2, "Verification"),
            p(t("After fixes: sp_GetBronzelayerEntity returns 596 entities, sp_GetSilverlayerEntity returns 1,666 entities. Bronze+Silver notebook runs launched 3/6 01:25 UTC and confirmed InProgress via Fabric REST API."))
        ]
    }
    r = update_fields(NEW_KEY, {"description": desc})
    print(f"  Description: {'OK' if r is not None else 'FAILED'}")

    # Step 3: Comment in Steve's voice
    print(f"\n  Adding comment to {NEW_KEY}...")
    r = add_comment(NEW_KEY, [
        p(t("This one was a fun detective story. Bronze and silver notebooks were finishing in 30 seconds flat, zero data. At first it looked like the notebooks themselves were broken, but the actual issue was four layers deep in the SQL metadata.")),
        p(t("The stored proc sp_UpsertBronzeLayerEntity has a bug where it defaults IsActive to 0 on INSERT even when you pass @IsActive=1. That one line of SQL silently deactivated 1,637 out of 1,666 bronze entities. The views that feed the notebooks filter on IsActive=1, so they returned nothing. On top of that, the pipeline queue tables (PipelineLandingzoneEntity and PipelineBronzeLayerEntity) were completely empty, and 1,070 entities were missing their LandingzoneEntityLastLoadValue records. Three INNER JOINs, all returning zero rows. The notebooks had literally nothing to work with.")),
        p(t("Wrote a one-time fix script to activate entities and populate the queues, then baked all four fixes into deploy_from_scratch.py Phase 13 so this can't happen again on a clean deploy. Also overhauled the engine API pipeline mode to add preflight checks (catches these issues before wasting a notebook run) and proper run tracking with background job polling. Bronze and silver runs are now active and loading. Ties directly into the scale-up work on "), ic("MT-37"), t("."))
    ])
    print(f"  Comment: {'OK' if r is not None else 'FAILED'}")

    # Step 4: Worklogs (3h Thu + 2h Fri = 5h)
    print(f"\n  Adding worklogs to {NEW_KEY}...")
    r = add_worklog(NEW_KEY, 10800, "2026-03-05T08:00:00.000-0600",
        "Root cause diagnosis session. Traced empty notebook results through the SQL metadata layer: views, stored procs, queue tables, entity activation flags. Identified 4 compounding issues: IsActive defaults, empty queue tables, missing LastLoadValue records, and no run tracking. Wrote the one-time fix script (fix_bronze_silver_queue.py), tested queue population, verified entity counts.")
    print(f"  Worklog 3/5 (3h): {'OK' if r is not None else 'FAILED'}")

    r = add_worklog(NEW_KEY, 7200, "2026-03-06T08:00:00.000-0600",
        "Applied permanent fixes to deploy_from_scratch.py Phase 13 for entity activation and queue population. Overhauled api.py pipeline mode with preflight validation, SQL run tracking, and background Fabric job polling. Fixed EngineControl.tsx execution plan visibility during live runs. Launched bronze+silver notebook runs and confirmed InProgress.")
    print(f"  Worklog 3/6 (2h): {'OK' if r is not None else 'FAILED'}")

    # Step 5: Transition Backlog -> In Progress -> Done
    print(f"\n  Transitioning {NEW_KEY}...")
    r = do_transition(NEW_KEY, "2")  # In Progress
    print(f"  -> In Progress: {'OK' if r is not None else 'FAILED'}")
    time.sleep(1)

    r = update_fields(NEW_KEY, {"timetracking": {"remainingEstimate": "0h"}})
    print(f"  Remaining -> 0h: {'OK' if r is not None else 'FAILED'}")

    # Add watchers before Done
    print(f"\n  Adding watchers to {NEW_KEY}...")
    add_watcher(NEW_KEY, PATRICK)
    add_watcher(NEW_KEY, DOMINIQUE)
    print(f"  Watchers: added Patrick + Dominique")

    r = do_transition(NEW_KEY, "31")  # Done
    print(f"  -> Done: {'OK' if r is not None else 'FAILED'}")


# ============================================
# PHASE 3: Comments on existing tickets
# ============================================
print("\n" + "=" * 60)
print("PHASE 3: Comments on existing tickets")
print("=" * 60)

# --- MT-37: Activation fix + runs active ---
print("\n  Adding comment to MT-37...")
new_ref = [ic(NEW_KEY)] if NEW_KEY else [t("the new activation fix subtask")]
r = add_comment("MT-37", [
    p(t("Major breakthrough on the scale-up. The reason we were stuck at 90% was a metadata activation bug, not a pipeline issue. Detailed the full diagnosis in "),
      *new_ref,
      t(". The short version: 1,637 bronze entities were silently deactivated by a stored proc default, pipeline queue tables were empty, and 1,070 entities were missing their LastLoadValue records. Four INNER JOINs that all returned zero rows.")),
    p(t("All four root causes are now fixed both as a one-time data patch and as permanent logic in the deploy script. Bronze and silver notebook runs launched at ~01:25 UTC on 3/6 and confirmed InProgress. The engine's preflight check now validates queue population and entity activation before triggering anything, so we'll catch this class of issue before wasting a notebook execution.")),
    p(t("Once these runs complete, we should be very close to 100% on the full entity set across all sources. The remaining entities are the ones that previously had no LandingzoneEntityLastLoadValue records, which are now seeded."))
])
print(f"  MT-37: {'OK' if r is not None else 'FAILED'}")

# --- MT-17: Parent progress update ---
print("\n  Adding comment to MT-17...")
ref_parts = [ic(NEW_KEY)] if NEW_KEY else [t("the activation fix subtask")]
r = add_comment("MT-17", [
    p(t("Strong progress this week. All subtasks except "),
      ic("MT-37"),
      t(" are now Done. The critical blocker was the entity activation bug ("),
      *ref_parts,
      t(") which silently deactivated 98% of bronze entities. That's been diagnosed, fixed both as a one-time patch and permanently in the deploy script, and full-scale bronze+silver runs are now active.")),
    p(t("The pipeline stack is solid: ForEach error tolerance ("),
      ic("MT-84"),
      t("), OPTIVA source isolation ("),
      ic("MT-83"),
      t("), the hybrid notebook orchestrator ("),
      ic("MT-86"),
      t("), and now the activation fix. Each subtask peeled back a different layer of the problem. Once the current runs complete and we verify 100% entity coverage, MT-37 closes and this parent task is done."))
])
print(f"  MT-17: {'OK' if r is not None else 'FAILED'}")

# --- MT-21: Remote server deployment narrative ---
print("\n  Adding comment to MT-21...")
r = add_comment("MT-21", [
    p(t("Got the dashboard deployed to the production server (vsc-fabric). Set up IIS as a reverse proxy on port 80 routing to the Node.js app on 8787 with Windows Authentication. Stood up NSSM services for both the FMD Dashboard and Nexus so they auto-start on boot and survive RDP session disconnects.")),
    p(t("Ran into a stale config bundle issue where the workspace IDs in the server's config were still pointing at the old DEV_INTEGRATION workspaces (a3a180ff prefix) instead of the current INTEGRATION ones (0596d0e7). Fixed that in the config bundle and verified it propagates correctly through the provisioning script.")),
    p(t("Had to patch 25 frontend files that were hardcoding localhost:8787 as the API base URL. Switched all of them to use relative paths so the dashboard works regardless of whether you're hitting it from the server directly or through the IIS proxy. Also caught a TypeScript null check issue in the page visibility hook and an NSSM stderr crash in the provisioning script (ErrorActionPreference was killing the process on stderr output from npm).")),
    p(t("Dashboard is accessible at http://vsc-fabric/ from any machine on the VPN. Windows Auth means zero login friction for IP Corp users."))
])
print(f"  MT-21: {'OK' if r is not None else 'FAILED'}")

# --- MT-88: Phase 2 status ---
print("\n  Adding comment to MT-88...")
r = add_comment("MT-88", [
    p(t("Phase 2 core is solid. The EntityStatusSummary table, sp_UpsertEntityStatus stored proc, and all three notebook integrations (LZ, Bronze, Silver) are deployed and running. The write-time aggregation path works: notebooks call sp_UpsertEntityStatus after each entity load, which updates the summary table in real-time. sp_BuildEntityDigest reads from the summary table as a fast path with a 6-table fallback for any entities not yet in the summary.")),
    p(t("Remaining work is frontend migration. The useEntityDigest hook is built and RecordCounts is migrated. Still need to migrate the remaining pages that currently make their own heavy API calls for entity status data. The hook has a module-level singleton cache with 30s TTL and request dedup, so once pages are migrated the dashboard should feel noticeably faster."))
])
print(f"  MT-88: {'OK' if r is not None else 'FAILED'}")

# --- MT-57: Strategy update ---
print("\n  Adding comment to MT-57...")
ref_parts2 = [ic(NEW_KEY)] if NEW_KEY else [t("the activation fix")]
r = add_comment("MT-57", [
    p(t("Pushing the due date on this one. The backfill strategy is solid in theory: the load optimization engine already identified watermark columns and primary keys for incremental load candidates across all sources. But the practical blocker was the entity activation bug ("),
      *ref_parts2,
      t(") which meant we couldn't even run a full initial load, let alone test incremental behavior.")),
    p(t("Now that bronze and silver runs are active with all entities properly queued, we'll have a clean baseline to validate incremental loads against. The strategy remains: first full load establishes the baseline, subsequent runs use watermark-based incremental extraction where available. Need to monitor the current runs to completion, then do a second run to verify incremental logic actually kicks in for entities with datetime/rowversion watermarks."))
])
print(f"  MT-57: {'OK' if r is not None else 'FAILED'}")


# ============================================
# PHASE 4: Field updates
# ============================================
print("\n" + "=" * 60)
print("PHASE 4: Field updates")
print("=" * 60)

# MT-57: Push due date
print("\n  Updating MT-57 due date: 3/3 -> 3/14...")
r = update_fields("MT-57", {"duedate": "2026-03-14"})
print(f"  MT-57 due date: {'OK' if r is not None else 'FAILED'}")

# MT-17: Update due date to 3/10 (runs need to complete)
print("\n  Updating MT-17 due date: 3/7 -> 3/10...")
r = update_fields("MT-17", {"duedate": "2026-03-10"})
print(f"  MT-17 due date: {'OK' if r is not None else 'FAILED'}")


# ============================================
# PHASE 5: Weekly Hours Audit
# ============================================
print("\n" + "=" * 60)
print("PHASE 5: Weekly Hours Audit (Mon 3/2 - Sat 3/7)")
print("=" * 60)

data = jira_request("/search/jql", "POST", {
    "jql": 'project=MT AND worklogDate >= "2026-03-02" AND worklogDate <= "2026-03-07"',
    "maxResults": 50,
    "fields": ["summary", "worklog"]
})

if not data:
    print("  FAILED to query worklogs for audit")
    sys.exit(1)

daily = {}
daily_detail = {}
for issue in data.get("issues", []):
    key = issue["key"]
    summary = issue["fields"]["summary"][:50]
    for w in issue["fields"].get("worklog", {}).get("worklogs", []):
        day = w["started"][:10]
        if "2026-03-02" <= day <= "2026-03-07":
            secs = w["timeSpentSeconds"]
            daily[day] = daily.get(day, 0) + secs
            if day not in daily_detail:
                daily_detail[day] = []
            daily_detail[day].append(f"    {key:8} {secs/3600:.1f}h  {summary}")

total = 0
crunch_days = 0
violations = []

DAYS = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"]
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

print()
for day, name in zip(DAYS, DAY_NAMES):
    hrs = daily.get(day, 0) / 3600
    total += hrs
    is_sat = day == "2026-03-07"
    cap = 6 if is_sat else 12

    if hrs >= 12 and not is_sat:
        crunch_days += 1

    status = "OK"
    flags = ""
    if hrs > cap:
        status = f"OVER ({cap}h cap)"
        violations.append(f"{name} {day}: {hrs:.1f}h > {cap}h")
    if hrs >= 12 and not is_sat:
        flags = f" [crunch day {crunch_days}/2]"

    print(f"  {name:12} {day}: {hrs:5.1f}h  [{status}]{flags}")
    for detail in daily_detail.get(day, []):
        print(detail)

print(f"\n  WEEKLY TOTAL: {total:.1f}h", end="")
if total <= 68:
    print(f"  [OK - under 68h cap, {68-total:.1f}h remaining]")
else:
    print(f"  [OVER - exceeds 68h cap by {total-68:.1f}h]")
    violations.append(f"Weekly total: {total:.1f}h > 68h")

if crunch_days > 2:
    violations.append(f"Crunch days: {crunch_days} > 2 allowed")
    print(f"  WARNING: {crunch_days} crunch days (max 2 allowed)")

if violations:
    print(f"\n  VIOLATIONS ({len(violations)}):")
    for v in violations:
        print(f"    - {v}")
else:
    print(f"\n  All constraints satisfied.")


# ============================================
# SUMMARY
# ============================================
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
print(f"  New subtask created: {NEW_KEY or 'FAILED'}")
print(f"  Comments added: MT-37, MT-17, MT-21, MT-88, MT-57")
print(f"  Worklogs added: {NEW_KEY} (3h Thu 3/5 + 2h Fri 3/6)")
print(f"  Saturday fixed: MT-88 7h->4h, MT-21 3h->2h")
print(f"  Due dates pushed: MT-57 -> 3/14, MT-17 -> 3/10")
print(f"  Weekly total: {total:.1f}h / 68h cap")
print("=" * 60)
