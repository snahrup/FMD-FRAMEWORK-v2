"""Rewrite today's Jira comments in Steve's voice and update them via API."""
import urllib.request
import urllib.error
import base64
import json
import ssl

JIRA_BASE = "https://ip-corporation.atlassian.net/rest/api/3"
AUTH = base64.b64encode(b"snahrup@ip-corporation.com:ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6").decode()
JIRA_BROWSE = "https://ip-corporation.atlassian.net/browse"

def ic(key):
    """Inline card for a Jira issue."""
    return {"type": "inlineCard", "attrs": {"url": f"{JIRA_BROWSE}/{key}"}}

def text(t, bold=False):
    """ADF text node, optionally bold."""
    node = {"type": "text", "text": t}
    if bold:
        node["marks"] = [{"type": "strong"}]
    return node

def p(*items):
    """ADF paragraph with content items."""
    return {"type": "paragraph", "content": list(items)}

def heading(level, t):
    """ADF heading."""
    return {"type": "heading", "attrs": {"level": level}, "content": [text(t)]}

def bullet_list(*items):
    """ADF bullet list from list of content arrays."""
    return {
        "type": "bulletList",
        "content": [
            {"type": "listItem", "content": [p(*item)] if isinstance(item, (list, tuple)) else [p(item)]}
            for item in items
        ]
    }

def ordered_list(*items):
    """ADF ordered list from list of content arrays."""
    return {
        "type": "orderedList",
        "content": [
            {"type": "listItem", "content": [p(*item)] if isinstance(item, (list, tuple)) else [p(item)]}
            for item in items
        ]
    }

def code_block(code, language="sql"):
    """ADF code block."""
    return {"type": "codeBlock", "attrs": {"language": language}, "content": [text(code)]}

def doc(*content):
    """ADF document wrapper."""
    return {"version": 1, "type": "doc", "content": list(content)}

def update_comment(issue_key, comment_id, body_doc):
    """PUT updated comment body to Jira."""
    url = f"{JIRA_BASE}/issue/{issue_key}/comment/{comment_id}"
    payload = json.dumps({"body": body_doc}).encode()
    req = urllib.request.Request(url, data=payload, method="PUT", headers={
        "Authorization": f"Basic {AUTH}",
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"  OK - {issue_key} comment {comment_id} updated ({resp.status})")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  FAIL - {issue_key} comment {comment_id}: {e.code} {body[:300]}")
        return False

def delete_comment(issue_key, comment_id):
    """DELETE a comment."""
    url = f"{JIRA_BASE}/issue/{issue_key}/comment/{comment_id}"
    req = urllib.request.Request(url, method="DELETE", headers={
        "Authorization": f"Basic {AUTH}",
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"  OK - {issue_key} comment {comment_id} deleted ({resp.status})")
            return True
    except urllib.error.HTTPError as e:
        print(f"  FAIL - {issue_key} comment {comment_id} delete: {e.code}")
        return False

def update_description(issue_key, body_doc):
    """PUT updated description to Jira issue."""
    url = f"{JIRA_BASE}/issue/{issue_key}"
    payload = json.dumps({"fields": {"description": body_doc}}).encode()
    req = urllib.request.Request(url, data=payload, method="PUT", headers={
        "Authorization": f"Basic {AUTH}",
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"  OK - {issue_key} description updated ({resp.status})")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  FAIL - {issue_key} description: {e.code} {body[:300]}")
        return False


# ============================================================
# COMMENT REWRITES
# ============================================================

print("=" * 60)
print("Step 1: Delete duplicate comment on MT-17")
print("=" * 60)
delete_comment("MT-17", "145004")

# ----------------------------------------------------------
# MT-17 Comment 145003 (08:34) - First update of the day
# Context: Initial investigation, found 3 root causes, isolated OPTIVA
# ----------------------------------------------------------
print("\n" + "=" * 60)
print("Step 2: Rewrite MT-17 comment 145003")
print("=" * 60)

mt17_145003 = doc(
    heading(3, "Pivoting to per-source isolation -- OPTIVA first"),
    p(
        text("Alright, new plan. Trying to debug failures across all four sources simultaneously was like trying to find a needle in a haystack while the haystack is on fire. The ForEach in the LZ pipeline has no "),
        text("continueOnError", bold=True),
        text(" -- one bad entity kills the entire run. With 1,255 entities, that's just not workable. So I'm isolating OPTIVA (DataSourceId=8, 480 entities) and proving the full LZ -> Bronze path before touching anything else.")
    ),
    heading(4, "What was actually going wrong"),
    p(text("Dug into the overnight failure logs and found three distinct root causes compounding each other. No wonder things were falling over.")),
    ordered_list(
        [text("Stale execution records (775 of them)", bold=True), text(" -- Failed runs leave behind orphaned PipelineLandingzoneEntity rows. On the next run, the pipeline sees these as 'already processed' and skips them. So entities look like they succeeded when they never actually ran. Sneaky.")],
        [text("Rowversion/timestamp watermark casting (185 entities)", bold=True), text(" -- The Load Optimization Engine found rowversion and timestamp columns and correctly flagged them as watermark candidates. Problem is, LandingzoneEntityLastLoadValue stores everything as varchar. When the Copy Activity tries to cast that varchar back to a rowversion for the WHERE clause... boom. Type mismatch. Reset all 185 to full load for now.")],
        [text("OOM on 3 OPTIVA tables", bold=True), text(" -- FSACTIONWEVENTPARAM, FSACTIONWIPRESULTS, FSDESCRIPTION (LzIds 1386, 1389, 1451) blow the Fabric executor memory limit during parquet conversion. Either crazy wide schemas or blob columns. Deactivated them -- they need a chunked-read strategy (tracked in "), ic("MT-85"), text(").")]
    ),
    heading(4, "How the isolation works"),
    p(
        text("The beauty of the metadata-driven design is that isolation is trivial. The view "),
        text("vw_LoadSourceToLandingzone", bold=True),
        text(" filters by IsActive=1. I deactivated MES (445), ETQ (29), M3 FDB (596), M3 Cloud (185) -- all via simple UPDATE statements. No pipeline changes, no redeployment. Just flip the flag and the pipeline only sees OPTIVA. Clean.")
    ),
    p(text("Pipeline is running now with 477 active OPTIVA entities. 120 will go incremental (datetime watermarks), 357 are full load."))
)
update_comment("MT-17", "145003", mt17_145003)


# ----------------------------------------------------------
# MT-17 Comment 145008 (08:48) - Second update, pipeline running
# Context: OPTIVA fully onboarded, the three root causes fixed, pipeline launched
# ----------------------------------------------------------
print("\n" + "=" * 60)
print("Step 3: Rewrite MT-17 comment 145008")
print("=" * 60)

mt17_145008 = doc(
    heading(3, "OPTIVA onboarded -- pipeline chain running"),
    p(
        text("OPTIVA is the fifth production source to go through the framework and the first one getting the full isolation treatment. DataSourceId=8, 480 registered entities. Here's the play-by-play of what I fixed before kicking this off.")
    ),
    heading(4, "Pre-run cleanup"),
    p(text("All three issues from the overnight failures are resolved:")),
    bullet_list(
        [text("775 stale execution records", bold=True), text(" cleaned from PipelineLandingzoneEntity. These were ghost records making the pipeline think entities had already been processed.")],
        [text("185 rowversion entities", bold=True), text(" reset to full load. The varchar-to-rowversion cast issue is real but it's a schema change -- not blocking the current run. Proper fix is either bigint storage or a type-aware watermark column.")],
        [text("3 OOM tables deactivated", bold=True), text(" -- FSACTIONWEVENTPARAM, FSACTIONWIPRESULTS, FSDESCRIPTION. These need investigation before they can run. Created "), ic("MT-85"), text(" to track.")]
    ),
    heading(4, "What's running"),
    p(
        text("LZ pipeline triggered with 477 active entities. Once LZ completes, I'll validate with gap_report.py (checks for missing parquet files, execution record mismatches, the works), then kick off Bronze and Silver in sequence. The full LZ -> Bronze -> Silver chain for one source, proven end to end, before touching the other four.")
    ),
    p(
        text("The per-source isolation approach is documented in "),
        ic("MT-37"),
        text(". ForEach error tolerance fix is tracked in "),
        ic("MT-84"),
        text(" -- that's the real long-term fix so we don't have to do this isolation dance in production.")
    )
)
update_comment("MT-17", "145008", mt17_145008)


# ----------------------------------------------------------
# MT-83 Comment 145009 - OPTIVA LZ kickoff status
# ----------------------------------------------------------
print("\n" + "=" * 60)
print("Step 4: Rewrite MT-83 comment 145009")
print("=" * 60)

mt83_145009 = doc(
    heading(3, "Pre-run fixes done, OPTIVA LZ pipeline kicked off"),
    p(text("Spent the first chunk of today cleaning up from the overnight failures so this run starts clean. Here's what I fixed before hitting go:")),
    bullet_list(
        [text("Cleaned 775 stale execution records"), text(" from PipelineLandingzoneEntity -- these were making the pipeline think entities were already processed")],
        [text("Reset 185 entities with rowversion/timestamp watermarks"), text(" back to full load (LoadType='F'). The varchar casting issue needs a schema change to fix properly")],
        [text("Deactivated 3 OOM tables"), text(" (FSACTIONWEVENTPARAM, FSACTIONWIPRESULTS, FSDESCRIPTION) -- tracked in "), ic("MT-85")],
        [text("Deactivated all non-OPTIVA sources"), text(" for isolation -- MES (445), ETQ (29), M3 FDB (596), M3C (185) all set to IsActive=0")]
    ),
    p(
        text("Pipeline is running with "),
        text("477 active OPTIVA entities", bold=True),
        text(". Breakdown: 120 incremental (datetime watermarks), 357 full load. Running gap_report.py after completion to validate, then Bronze and Silver follow.")
    )
)
update_comment("MT-83", "145009", mt83_145009)


# ----------------------------------------------------------
# MT-37 Comment 145005 (08:34) - OPTIVA isolation approach
# ----------------------------------------------------------
print("\n" + "=" * 60)
print("Step 5: Rewrite MT-37 comment 145005")
print("=" * 60)

mt37_145005 = doc(
    heading(3, "Going OPTIVA-only -- isolating one source at a time"),
    p(
        text("The multi-source overnight run was a mess. Three different failure categories overlapping, and with no continueOnError on the ForEach, a single bad entity in any source kills everything. Trying to untangle which failures belong to which source across 1,255 entities is a waste of time.")
    ),
    p(
        text("New approach: OPTIVA only. 477 entities active, everything else deactivated via IsActive=0. This way I can prove the LZ -> Bronze path works for one source before reactivating the rest.")
    ),
    p(text("Pre-run fixes:")),
    bullet_list(
        [text("3 OOM entities deactivated"), text(" (FSACTIONWEVENTPARAM, FSACTIONWIPRESULTS, FSDESCRIPTION) -- these need dedicated handling, not a blocker")],
        [text("185 rowversion/timestamp entities reset to full load"), text(" -- the varchar casting thing is a known issue, fix belongs in a future Load Optimization Engine iteration")],
        [text("775 stale execution records cleaned"), text(" so the pipeline doesn't skip entities it thinks already ran")]
    ),
    p(
        text("LZ pipeline is running. After it completes, gap_report.py validates parquet files landed, then Bronze gets triggered. Full multi-source test resumes once OPTIVA proves out end-to-end. See "),
        ic("MT-17"),
        text(" for the full debug story.")
    )
)
update_comment("MT-37", "145005", mt37_145005)


# ----------------------------------------------------------
# MT-37 Comment 145011 (08:48) - Scale-up strategy
# ----------------------------------------------------------
print("\n" + "=" * 60)
print("Step 6: Rewrite MT-37 comment 145011")
print("=" * 60)

mt37_145011 = doc(
    heading(3, "New scale-up plan: one source at a time, then combine"),
    p(
        text("After today's debugging session, I'm done with the 'throw everything at the wall' approach. Here's the order I'm going to validate each source:")
    ),
    ordered_list(
        [text("OPTIVA (480 entities)", bold=True), text(" -- running now, first full isolation test")],
        [text("ETQ (29 entities)", bold=True), text(" -- smallest source, quick validation")],
        [text("M3 Cloud (185 entities)", bold=True), text(" -- medium, connection already proven")],
        [text("MES (445 entities)", bold=True), text(" -- large, known to have some tricky entities")],
        [text("M3 ERP (596 entities)", bold=True), text(" -- biggest source, saved for last")],
        [text("All sources combined", bold=True), text(" -- only after each one passes individually")]
    ),
    p(text("Each source gets the same treatment: clean stale execution records, validate watermark configs, run LZ isolated, run gap report, trigger Bronze, validate Delta tables. Rinse and repeat.")),
    p(
        text("The ForEach continueOnError fix ("),
        ic("MT-84"),
        text(") is critical before the combined run. Right now a single entity failure in a 1,735-entity run would be catastrophic. Once that's in place, individual entity failures become warnings instead of pipeline-killers.")
    )
)
update_comment("MT-37", "145011", mt37_145011)


# ----------------------------------------------------------
# MT-36 Comment 145006 (08:34) - Row count validation plan
# ----------------------------------------------------------
print("\n" + "=" * 60)
print("Step 7: Rewrite MT-36 comment 145006")
print("=" * 60)

mt36_145006 = doc(
    heading(3, "OPTIVA validation plan -- simpler than M3 at least"),
    p(
        text("Good news: OPTIVA's SQL server doesn't have that sys.partitions returning -1 issue that made M3 ERP row counts unreliable. So validation here is more straightforward.")
    ),
    p(text("Once the LZ run finishes, the gap report checks:")),
    bullet_list(
        [text("477 active entities should each have a parquet file"), text(" in the LZ lakehouse")],
        [text("Execution records in PipelineLandingzoneEntity"), text(" should show completion status for all 477")],
        [text("Spot-check row counts"), text(" via direct SELECT COUNT(*) against OPTIVA SQL for the high-value tables")]
    ),
    p(
        text("The 3 deactivated OOM entities (LzIds 1386, 1389, 1451) are excluded from everything -- no execution records expected, no validation targets. They simply shouldn't appear anywhere in this run.")
    )
)
update_comment("MT-36", "145006", mt36_145006)


# ----------------------------------------------------------
# MT-36 Comment 145012 (08:48) - gap_report.py built
# ----------------------------------------------------------
print("\n" + "=" * 60)
print("Step 8: Rewrite MT-36 comment 145012")
print("=" * 60)

mt36_145012 = doc(
    heading(3, "Built gap_report.py for cross-layer validation"),
    p(
        text("Wrote a proper validation tool -- gap_report.py -- that compares entity registration across all layers end to end. For OPTIVA:")
    ),
    bullet_list(
        [text("LZ check:"), text(" 477 active entities should have parquet files in the lakehouse")],
        [text("Execution records:"), text(" PipelineLandingzoneEntity should show completion status for every entity")],
        [text("Bronze Delta tables:"), text(" 477 tables created with non-zero row counts")],
        [text("Source spot-checks:"), text(" direct COUNT(*) queries against OPTIVA SQL for high-value tables")]
    ),
    p(
        text("The 3 deactivated OOM entities won't appear in any of these checks -- they're excluded from the active set entirely. This tool will be reusable for every source as I work through the per-source validation plan in "),
        ic("MT-37"),
        text(".")
    )
)
update_comment("MT-36", "145012", mt36_145012)


# ----------------------------------------------------------
# MT-57 Comment 145007 (08:34) - Rowversion issue discovery
# ----------------------------------------------------------
print("\n" + "=" * 60)
print("Step 9: Rewrite MT-57 comment 145007")
print("=" * 60)

mt57_145007 = doc(
    heading(3, "Found a real problem with rowversion watermarks"),
    p(
        text("Ran into an important edge case while prepping OPTIVA. The Load Optimization Engine correctly identifies rowversion and timestamp columns as the best watermark candidates -- and they "),
        text("are", bold=True),
        text(" the best candidates, in theory. The priority chain (rowversion > modified datetime > created datetime > identity) is sound. But there's a fundamental type mismatch in how we store the values.")
    ),
    p(
        text("LandingzoneEntityLastLoadValue is a varchar column. When the Copy Activity tries to use a stored varchar as a rowversion comparison in the WHERE clause... it blows up. Can't cast varchar to rowversion. Same issue with timestamp columns.")
    ),
    heading(4, "What I did for now"),
    p(
        text("Reset all 185 affected entities to full load (LoadType='F', WatermarkColumn=NULL). This is the pragmatic fix -- it unblocks the pipeline run. The proper fix is one of:")
    ),
    ordered_list(
        [text("Bigint storage", bold=True), text(" -- SQL Server rowversion is an 8-byte binary that can be safely cast to bigint. Store as bigint in metadata, convert back in the Copy Activity. Cleanest option.")],
        [text("Type-aware watermark column", bold=True), text(" -- Add a WatermarkDataType to LandingzoneEntity so the Copy Activity knows how to handle the cast. More flexible, but it's a schema change.")]
    ),
    heading(4, "Net impact on OPTIVA"),
    p(
        text("120 out of 480 entities (25%) still run incrementally -- these all use datetime watermarks, no rowversion issues. The other 357 active entities are full load. 3 OOM entities are completely deactivated.")
    ),
    p(
        text("This doesn't block "),
        ic("MT-17"),
        text(" or "),
        ic("MT-37"),
        text(" -- the pipeline validation work continues. The rowversion fix is a follow-on enhancement for the Load Optimization Engine.")
    )
)
update_comment("MT-57", "145007", mt57_145007)


# ----------------------------------------------------------
# MT-57 Comment 145010 (08:48) - Refinement of incremental strategy
# ----------------------------------------------------------
print("\n" + "=" * 60)
print("Step 10: Rewrite MT-57 comment 145010")
print("=" * 60)

mt57_145010 = doc(
    heading(3, "Incremental strategy -- where things stand after OPTIVA"),
    p(
        text("The OPTIVA onboarding really stress-tested the watermark handling. The Load Optimization Engine's discovery logic is solid -- it correctly finds the right columns. But the "),
        text("storage", bold=True),
        text(" side has a gap: LandingzoneEntityLastLoadValue is varchar, and rowversion/timestamp types don't survive the round-trip through varchar storage.")
    ),
    heading(4, "Fix options"),
    ordered_list(
        [text("Bigint storage", bold=True), text(" -- rowversion is 8 bytes, cast-able to bigint. Store as bigint, convert back in Copy Activity. Least disruptive.")],
        [text("WatermarkDataType column", bold=True), text(" -- Add a type hint column so the Copy Activity knows the cast target. More flexible for future edge cases, but bigger schema change.")]
    ),
    p(text("For this run, all 185 rowversion/timestamp entities are reset to full load. Not ideal for long-term performance, but it gets us through validation.")),
    p(
        text("OPTIVA breakdown: 120 entities (25%) running incremental with datetime watermarks. 357 running full load. 3 deactivated for OOM (tracked in "),
        ic("MT-85"),
        text("). Also built gap_report.py that checks entity status across all layers for all sources -- catches any gaps in registration or execution.")
    )
)
update_comment("MT-57", "145010", mt57_145010)

print("\n" + "=" * 60)
print("ALL COMMENT UPDATES COMPLETE")
print("=" * 60)
