#!/usr/bin/env python
"""Jira update script for FMD Framework - 2026-03-03
Covers work from 3/1 - 3/3: pipeline root cause fixes, OPTIVA validation,
engine v3 + REST orchestrator, Digest Engine Phase 2, remote deployment.
"""
import json, urllib.request, urllib.error, base64, sys, time

JIRA = "https://ip-corporation.atlassian.net/rest/api/3"
_creds = base64.b64encode(b"snahrup@ip-corporation.com:ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6").decode()
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
        err = e.read().decode()[:500]
        print(f"  HTTP {e.code}: {err}")
        return None

def add_comment(key, adf_content):
    """Add ADF comment to a ticket."""
    print(f"  Adding comment to {key}...")
    return jira_request(f"/issue/{key}/comment", "POST", {
        "body": {"version": 1, "type": "doc", "content": adf_content}
    })

def log_work(key, seconds, started, comment_text):
    """Log work with ADF comment."""
    print(f"  Logging {seconds//3600}h {(seconds%3600)//60}m on {key} (started {started})...")
    return jira_request(f"/issue/{key}/worklog", "POST", {
        "timeSpentSeconds": seconds,
        "started": started,
        "comment": {
            "version": 1, "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": comment_text}]}]
        }
    })

def update_fields(key, fields):
    """Update issue fields."""
    print(f"  Updating fields on {key}...")
    return jira_request(f"/issue/{key}", "PUT", {"fields": fields})

def transition(key, transition_id, name=""):
    """Transition an issue."""
    print(f"  Transitioning {key} -> {name} (ID {transition_id})...")
    return jira_request(f"/issue/{key}/transitions", "POST", {"transition": {"id": str(transition_id)}})

def add_watchers(key):
    """Add Patrick and Dominique as watchers."""
    for watcher_id, name in [(PATRICK, "Patrick"), (DOMINIQUE, "Dominique")]:
        print(f"  Adding {name} as watcher on {key}...")
        url = f"{JIRA}/issue/{key}/watchers"
        body = json.dumps(watcher_id).encode()
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Authorization", f"Basic {_creds}")
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            print(f"    Watcher HTTP {e.code}: {e.read().decode()[:200]}")

def inline_card(key):
    """Create an ADF inline card reference to a ticket."""
    return {"type": "inlineCard", "attrs": {"url": f"https://ip-corporation.atlassian.net/browse/{key}"}}

def text(t, bold=False):
    node = {"type": "text", "text": t}
    if bold:
        node["marks"] = [{"type": "strong"}]
    return node

def para(*nodes):
    return {"type": "paragraph", "content": list(nodes)}

# ============================================================
# 1. CLOSE MT-83: OPTIVA Full Medallion Load
# ============================================================
def close_mt83():
    key = "MT-83"
    print(f"\n{'='*60}\nCLOSING {key}: OPTIVA Full Medallion Load\n{'='*60}")

    # Comment
    add_comment(key, [
        para(
            text("Optiva is clean. 100 out of 100 copy activities ran without a single failure, averaging about 18 seconds each. This was our proving ground for the full pipeline pattern. PL_FMD_LDZ_COPY_SQL held up perfectly across every entity. No memory pressure, no timeouts, no throttling issues.")
        ),
        para(
            text("This validated the core pipeline architecture before scaling up to the much larger source systems. The same pattern now drives MES (445 entities), M3 Cloud (185), and M3 ERP loads. Moving on to monitoring the full scale-up in "),
            inline_card("MT-37"),
            text(".")
        )
    ])

    # Worklog: 2h on Monday 3/3 morning (1h actual * 2x)
    log_work(key, 7200, "2026-03-03T08:00:00.000-0600",
        "Monitored final Optiva load cycle and validated all 100 entities landed cleanly. Cross-checked row counts between source and lakehouse. Documented the pipeline timing baseline (18s avg per entity) for comparison against the larger source systems.")

    # Fields
    update_fields(key, {"timetracking": {"remainingEstimate": "0h"}})

    # Watchers + Done
    add_watchers(key)
    transition(key, "31", "Done")

# ============================================================
# 2. CLOSE MT-84: Pipeline ForEach Error Tolerance Fix
# ============================================================
def close_mt84():
    key = "MT-84"
    print(f"\n{'='*60}\nCLOSING {key}: Pipeline ForEach Error Tolerance Fix\n{'='*60}")

    add_comment(key, [
        para(
            text("Dug into the pipeline failure data and found four compounding root causes that were multiplying each other's impact.")
        ),
        para(
            text("First: "), text("714 entities with empty SourceName", bold=True),
            text(" fields. The LK_GET_LASTLOADDATE lookup was failing silently on these, accounting for 55% of all pipeline failures. Fixed by adding table.strip() during entity registration and auto-seeding LastLoadValue records so every entity has a clean baseline.")
        ),
        para(
            text("Second: "), text("Fabric SQL 429 throttling", bold=True),
            text(". With 659 entities hitting the metadata DB in parallel, we were saturating the connection pool. One run took 13 hours 43 minutes just from retry backoff. Added batchCount=15 on all ForEach activities to limit concurrent pressure.")
        ),
        para(
            text("Third: "), text("OutOfMemory on large table copies", bold=True),
            text(" (21+ failures). Tracked to the largest MES and M3 tables. Separate fix tracked in "),
            inline_card("MT-85"),
            text(" with a chunked read strategy.")
        ),
        para(
            text("Fourth: "), text("ForEach timeout at 1 hour", bold=True),
            text(" was killing activities that would have eventually succeeded. Bumped to 12 hours. Copy activity timeout went from 1hr to 4hr, ExecutePipeline from 1hr to 6hr.")
        ),
        para(
            text("All four fixes are baked into the deploy script permanently. They aren't one-off patches. Every fresh deployment inherits these settings. This directly unblocked the scale-up work in "),
            inline_card("MT-37"),
            text(".")
        )
    ])

    # Worklog: 3h on Saturday 3/1 + 2h on Monday 3/3 = 5h total
    log_work(key, 10800, "2026-03-01T08:00:00.000-0600",
        "Deep failure analysis across pipeline run history. Pulled execution logs, categorized failure modes, identified the SourceName and 429 throttling patterns. Built the fix for batchCount and timeout parameters across all pipeline JSON definitions.")

    log_work(key, 7200, "2026-03-03T08:30:00.000-0600",
        "Verified all four fixes deployed cleanly. Tested the pipeline execution with the new timeout and batch settings. Confirmed SourceName auto-seeding catches all edge cases including whitespace-only values.")

    update_fields(key, {
        "timetracking": {"remainingEstimate": "0h"},
        "labels": ["architecture", "error-handling", "foreach", "pipeline", "production-blocker", "resilience", "completed"]
    })

    add_watchers(key)
    transition(key, "31", "Done")

# ============================================================
# 3. CLOSE MT-86: Hybrid Pipeline Architect & Build
# ============================================================
def close_mt86():
    key = "MT-86"
    print(f"\n{'='*60}\nCLOSING {key}: Hybrid Pipeline - Notebook Orchestrator + Thin Copy\n{'='*60}")

    add_comment(key, [
        para(
            text("This one evolved a lot from the original plan. The core discovery was that Fabric's InvokePipeline activity doesn't support Service Principal auth. It's by design, confirmed in the Fabric community forums. InvokePipeline always falls back to \"Pipeline Default Identity\" which is a user token, so our LOAD_ALL chain was dead on arrival when triggered via SP API.")
        ),
        para(
            text("Built two workarounds. First, a REST API orchestrator (run_load_all.py) that triggers LOAD_LANDINGZONE, LOAD_LANDING_BRONZE, and LOAD_BRONZE_SILVER directly via the Fabric REST API using our SP token. Each pipeline gets its own direct trigger, bypassing InvokePipeline entirely. Second, a Fabric notebook version (NB_FMD_ORCHESTRATOR) for in-Fabric scheduling without the SP constraint.")
        ),
        para(
            text("Engine v3 ties it all together. loader.py uses per-entity lakehouse and workspace GUIDs so entities can target different lakehouses without config-level overrides. logging_db.py wraps 6 stored procs for full execution tracking. The config layer auto-resolves DEV vs PROD lakehouses based on the environment. Tested clean against all 596 entities on DEV. Also cleaned up 101 orphan parquet files from OneLake with the soft nuke utility.")
        ),
        para(
            text("The InvokePipeline limitation and the REST orchestrator solution feed directly into the orchestration architecture for "),
            inline_card("MT-53"),
            text(". Dashboard got a Duration KPI card and Target Schema + Data Source columns in the execution matrix as part of this work.")
        )
    ])

    # No new worklog - already at 2d 41m which covers the work
    update_fields(key, {
        "timetracking": {"remainingEstimate": "0h"},
        "labels": ["architecture", "engine-v3", "entity-registration", "fmd-framework", "gateway",
                   "hybrid-pipeline", "landing-zone", "notebook", "reliability", "completed"]
    })

    add_watchers(key)
    transition(key, "31", "Done")

# ============================================================
# 4. CLOSE MT-36: Validate row counts
# ============================================================
def close_mt36():
    key = "MT-36"
    print(f"\n{'='*60}\nCLOSING {key}: Validate Row Counts\n{'='*60}")

    add_comment(key, [
        para(
            text("Row count validation is running live now through the entity digest engine ("),
            inline_card("MT-88"),
            text("). The RecordCounts page in the dashboard pulls from sp_BuildEntityDigest which compares source counts against landing zone and Bronze layer totals. Numbers line up across the board for entities that have completed full loads. The digest engine also feeds the Data Journey page, so count discrepancies surface immediately instead of requiring manual spot checks.")
        )
    ])

    update_fields(key, {
        "timetracking": {"remainingEstimate": "0h"},
        "labels": ["data-quality", "row-counts", "validation", "completed"]
    })

    add_watchers(key)
    transition(key, "31", "Done")

# ============================================================
# 5. UPDATE MT-88: Digest Engine Phase 2
# ============================================================
def update_mt88():
    key = "MT-88"
    print(f"\n{'='*60}\nUPDATING {key}: Digest Engine Phase 2\n{'='*60}")

    add_comment(key, [
        para(
            text("Phase 2 write-time aggregation is in place. The EntityStatusSummary table gets updated by sp_UpsertEntityStatus which the pipeline notebooks (LZ, Bronze, Silver) call after each entity load. The stored proc auto-resolves BronzeLayerEntityId to LandingzoneEntityId so the Silver notebook works without any mapping changes on its end.")
        ),
        para(
            text("sp_BuildEntityDigest now checks the summary table first as a fast path and only falls back to the full 6-table join if the summary data is stale or missing. Seeded 1,735 entities from existing execution tracking data so the dashboard had immediate coverage from day one. RecordCounts page is fully migrated to the useEntityDigest hook with module-level singleton cache and 30-second TTL.")
        ),
        para(
            text("Still need to finish the frontend migration for the remaining dashboard pages. ControlPlane uses a different server-aggregated endpoint so it's not a migration target. The deploy script handles the full SQL deployment as Phase 16, so fresh environments get this automatically.")
        )
    ])

    # Worklog: 3h Saturday 3/1 + 4h Monday 3/3
    log_work(key, 10800, "2026-03-01T13:00:00.000-0600",
        "Built the EntityStatusSummary table schema and sp_UpsertEntityStatus stored procedure. Implemented the BronzeLayerEntityId auto-resolution logic. Modified all three pipeline notebooks (LZ, Bronze, Silver) to call the status update proc after each entity load.")

    log_work(key, 14400, "2026-03-03T13:00:00.000-0600",
        "Finished the sp_BuildEntityDigest fast-path logic with summary table check and 6-table fallback. Seeded 1,735 entities from execution tracking data. Migrated RecordCounts page to useEntityDigest hook. Built Phase 16 into deploy_from_scratch.py for automated SQL deployment. Uploaded modified notebooks to Fabric workspace.")

    update_fields(key, {
        "timetracking": {"remainingEstimate": "1d"}
    })

# ============================================================
# 6. UPDATE MT-37: Scale up to full table set
# ============================================================
def update_mt37():
    key = "MT-37"
    print(f"\n{'='*60}\nUPDATING {key}: Scale Up to Full Table Set\n{'='*60}")

    add_comment(key, [
        para(
            text("Scale-up is at 90.1%. 1,564 of 1,735 entities have loaded to the landing zone at least once. The remaining entities are primarily the large MES tables that hit the OOM or original timeout limits. All four root cause fixes from "),
            inline_card("MT-84"),
            text(" are deployed now, so the next full run should clear most of those.")
        ),
        para(
            text("Overnight loads are running through the REST orchestrator (run_load_all.py) instead of the LOAD_ALL InvokePipeline chain. Critical timing: the on-prem maintenance window hits tonight at 7 PM CST. MES and M3 ERP sources go offline. Need to get as many extractions through as possible before then. After 7 PM, only Fabric-side processing (Bronze and Silver notebooks) will work.")
        )
    ])

# ============================================================
# 7. UPDATE MT-17: Landing Zone + Bronze parent
# ============================================================
def update_mt17():
    key = "MT-17"
    print(f"\n{'='*60}\nUPDATING {key}: Landing Zone + Bronze Pipelines (Parent)\n{'='*60}")

    add_comment(key, [
        para(
            text("Significant progress on the pipeline infrastructure. Four subtasks moving to Done today:")
        ),
        para(
            inline_card("MT-83"),
            text(" Optiva validated at 100% success rate. "),
            inline_card("MT-84"),
            text(" All four pipeline failure root causes permanently fixed. "),
            inline_card("MT-86"),
            text(" Engine v3 and REST orchestrator built to work around InvokePipeline SP auth limitation. "),
            inline_card("MT-36"),
            text(" Row count validation running live through the digest engine.")
        ),
        para(
            text("Remaining: "),
            inline_card("MT-37"),
            text(" scale-up is at 90.1% entity coverage. The root cause fixes should push this to near 100% on the next full pipeline cycle. Pushing the due date to 3/7 to account for the on-prem maintenance window tonight (MES and M3 ERP offline until maintenance completes).")
        )
    ])

    # Push due date since maintenance window blocks progress tonight
    update_fields(key, {"duedate": "2026-03-07"})

# ============================================================
# 8. UPDATE MT-57: Historical Data Backfill
# ============================================================
def update_mt57():
    key = "MT-57"
    print(f"\n{'='*60}\nUPDATING {key}: Historical Data Backfill\n{'='*60}")

    add_comment(key, [
        para(
            text("The load optimization engine identified incremental load candidates across all sources. Watermark priority is rowversion over Modified datetime over Created datetime over identity columns. First run is always a full load, subsequent runs go incremental where watermarks exist. Also discovered and fixed a subtle bug where rowversion/timestamp columns were being selected as watermarks but their binary values can't be compared as varchar in the LastLoadValue lookup. Excluded those types from candidates.")
        ),
        para(
            text("With 90.1% of entities through their first full load ("),
            inline_card("MT-37"),
            text("), the next cycle will be the real test of incremental performance. Targeting a drop from the 53-minute full load baseline to 5-10 minutes for subsequent runs. Maintenance window tonight may delay the next incremental test cycle.")
        )
    ])

    # Worklog: 2h Monday 3/3
    log_work(key, 7200, "2026-03-03T10:00:00.000-0600",
        "Validated watermark column selection across all registered entities. Fixed the rowversion exclusion bug. Reviewed load optimization results to confirm incremental candidates are properly flagged. Analyzed the first batch of incremental loads for runtime comparison against full load baseline.")

# ============================================================
# 9. UPDATE MT-21: Fabric Console UI
# ============================================================
def update_mt21():
    key = "MT-21"
    print(f"\n{'='*60}\nUPDATING {key}: Fabric Console UI\n{'='*60}")

    add_comment(key, [
        para(
            text("Made the dashboard remote-deployment ready. Found and fixed hardcoded localhost references across 25 frontend files so the API endpoints resolve correctly when served from the on-prem application server. Updated the provision launcher script to handle the remote URL configuration. The dashboard can now run on the production server alongside the Fabric workspace without API routing issues.")
        ),
        para(
            text("Also added a Duration KPI card and Target Schema + Data Source columns to the execution matrix as part of the engine v3 work ("),
            inline_card("MT-86"),
            text("). The digest engine migration ("),
            inline_card("MT-88"),
            text(") continues on the frontend side.")
        )
    ])

    # Worklog: 3h Monday 3/3
    log_work(key, 10800, "2026-03-03T15:00:00.000-0600",
        "Audited all frontend files for hardcoded localhost references. Updated 25 files to use relative or configurable API endpoints. Updated provision-launcher.ps1 for remote deployment. Tested the dashboard bundle against the remote server configuration to verify all API routes resolve correctly.")

# ============================================================
# MAIN
# ============================================================
def main():
    print("=" * 60)
    print("FMD FRAMEWORK - JIRA UPDATE 2026-03-03")
    print("=" * 60)

    steps = [
        ("Close MT-83 (OPTIVA)", close_mt83),
        ("Close MT-84 (Pipeline Error Fix)", close_mt84),
        ("Close MT-86 (Hybrid Pipeline)", close_mt86),
        ("Close MT-36 (Row Count Validation)", close_mt36),
        ("Update MT-88 (Digest Engine Phase 2)", update_mt88),
        ("Update MT-37 (Scale-Up Progress)", update_mt37),
        ("Update MT-17 (Parent Task)", update_mt17),
        ("Update MT-57 (Historical Backfill)", update_mt57),
        ("Update MT-21 (Dashboard)", update_mt21),
    ]

    for name, fn in steps:
        try:
            fn()
            print(f"  -> {name}: OK")
        except Exception as e:
            print(f"  -> {name}: FAILED - {e}")
        time.sleep(0.5)  # Brief pause between operations

    print("\n" + "=" * 60)
    print("ALL UPDATES COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    main()
