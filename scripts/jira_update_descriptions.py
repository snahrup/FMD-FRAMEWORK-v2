"""Rewrite descriptions on MT-83, MT-84, MT-85 in Steve's voice."""
import urllib.request
import urllib.error
import base64
import json

JIRA_BASE = "https://ip-corporation.atlassian.net/rest/api/3"
AUTH = base64.b64encode(b"snahrup@ip-corporation.com:ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6").decode()
JIRA_BROWSE = "https://ip-corporation.atlassian.net/browse"

def ic(key):
    return {"type": "inlineCard", "attrs": {"url": f"{JIRA_BROWSE}/{key}"}}

def text(t, bold=False, code=False):
    node = {"type": "text", "text": t}
    marks = []
    if bold:
        marks.append({"type": "strong"})
    if code:
        marks.append({"type": "code"})
    if marks:
        node["marks"] = marks
    return node

def p(*items):
    return {"type": "paragraph", "content": list(items)}

def heading(level, t):
    return {"type": "heading", "attrs": {"level": level}, "content": [text(t)]}

def bullet_list(*items):
    return {
        "type": "bulletList",
        "content": [
            {"type": "listItem", "content": [p(*item)] if isinstance(item, (list, tuple)) else [p(item)]}
            for item in items
        ]
    }

def ordered_list(*items):
    return {
        "type": "orderedList",
        "content": [
            {"type": "listItem", "content": [p(*item)] if isinstance(item, (list, tuple)) else [p(item)]}
            for item in items
        ]
    }

def table(headers, rows):
    """ADF table with header row and data rows."""
    header_cells = [
        {"type": "tableHeader", "content": [p(text(h, bold=True))]}
        for h in headers
    ]
    header_row = {"type": "tableRow", "content": header_cells}

    data_rows = []
    for row in rows:
        cells = []
        for cell in row:
            if isinstance(cell, str):
                cells.append({"type": "tableCell", "content": [p(text(cell))]})
            elif isinstance(cell, (list, tuple)):
                cells.append({"type": "tableCell", "content": [p(*cell)]})
            else:
                cells.append({"type": "tableCell", "content": [p(cell)]})
        data_rows.append({"type": "tableRow", "content": cells})

    return {"type": "table", "attrs": {"isNumberColumnEnabled": False, "layout": "default"}, "content": [header_row] + data_rows}

def doc(*content):
    return {"version": 1, "type": "doc", "content": list(content)}

def update_description(issue_key, body_doc):
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
        print(f"  FAIL - {issue_key}: {e.code} {body[:500]}")
        return False


# ============================================================
# MT-83: OPTIVA Source - Full Medallion Load (LZ/Bronze/Silver)
# ============================================================
print("=" * 60)
print("MT-83: Rewriting description")
print("=" * 60)

mt83_desc = doc(
    heading(2, "What this is"),
    p(
        text("Run OPTIVA (DataSourceId=8, 480 entities) through the full pipeline -- LZ, Bronze, Silver -- using a per-source isolation strategy. This is the first source to get the isolation treatment after the multi-source overnight runs proved that debugging 1,255+ entities from 5 sources at once is a losing game.")
    ),
    heading(2, "Why isolation"),
    p(
        text("The "),
        text("vw_LoadSourceToLandingzone", code=True),
        text(" view filters by IsActive=1. Deactivate everything except OPTIVA, run the pipeline, and the framework only sees OPTIVA entities. No pipeline config changes, no redeployment. The metadata-driven design makes this trivial -- which is exactly what it was built for.")
    ),
    heading(2, "Pre-run fixes (from overnight failure analysis)"),
    p(text("Three root causes found and fixed before kicking off this run:")),
    table(
        ["Issue", "Count", "Fix"],
        [
            ["Stale execution records", "775 cleaned", "Orphaned PipelineLandingzoneEntity rows from failed runs"],
            ["Rowversion watermark casting", "185 entities", "Reset to full load (LoadType='F', WatermarkColumn=NULL)"],
            ["OOM tables", "3 deactivated", "FSACTIONWEVENTPARAM, FSACTIONWIPRESULTS, FSDESCRIPTION"],
        ]
    ),
    heading(2, "Entity breakdown"),
    table(
        ["Category", "Count", "Load Strategy"],
        [
            ["Incremental", "120", "Datetime watermark"],
            ["Full load", "357", "No watermark or rowversion reset"],
            ["Deactivated (OOM)", "3", "Needs chunked-read strategy"],
        ]
    ),
    heading(2, "Done when"),
    bullet_list(
        [text("477 active OPTIVA entities land successfully in LZ lakehouse")],
        [text("Bronze pipeline merges all 477 into Delta tables")],
        [text("Silver pipeline creates corresponding Silver tables")],
        [text("gap_report.py shows zero missing entities across all layers")],
        [text("Row count spot-checks pass against OPTIVA SQL source")]
    ),
    heading(2, "Related"),
    bullet_list(
        [ic("MT-17"), text(" -- parent pipeline testing task")],
        [ic("MT-84"), text(" -- ForEach continueOnError fix (needed for combined runs)")],
        [ic("MT-85"), text(" -- OOM entity resolution")]
    )
)
update_description("MT-83", mt83_desc)


# ============================================================
# MT-84: Pipeline ForEach Error Tolerance Fix (continueOnError)
# ============================================================
print("\n" + "=" * 60)
print("MT-84: Rewriting description")
print("=" * 60)

mt84_desc = doc(
    heading(2, "The problem"),
    p(
        text("The "),
        text("FE_ENTITY", code=True),
        text(" ForEach activity in the LZ, Bronze, and Silver pipelines has no "),
        text("continueOnError", code=True),
        text(" setting. When any single entity throws an exception -- OOM, timeout, schema mismatch, whatever -- the ForEach kills "),
        text("all", bold=True),
        text(" in-flight parallel Copy Activities and marks the entire pipeline as failed.")
    ),
    p(
        text("With 477+ entities per source (and 1,735+ across all five sources), this is a non-starter. One bad table shouldn't take down a multi-hour pipeline run. Right now I'm working around it by deactivating known-bad entities before each run, but that's manual and fragile.")
    ),
    heading(2, "What needs to happen"),
    ordered_list(
        [text("Add continueOnError:true to FE_ENTITY ForEach", bold=True), text(" -- The pipeline keeps processing remaining entities even when some fail. This is the critical fix.")],
        [text("Error logging in the failure path", bold=True), text(" -- When an entity fails, log the details (LzId, error message, timestamp) to an execution error table. Right now you have to dig through Fabric Monitor to find what went wrong.")],
        [text("Pipeline-level summary", bold=True), text(" -- After the ForEach completes, report how many entities succeeded vs failed. Pipeline should show 'Succeeded with warnings' if some entities failed but the run completed.")]
    ),
    heading(2, "Why this matters now"),
    p(
        text("I'm currently running sources in isolation (see "),
        ic("MT-37"),
        text(") specifically because this fix doesn't exist yet. Each source is validated individually before combining. But once I need to run all 1,735 entities together, a single failure can't be allowed to abort the entire thing. This is the production blocker.")
    ),
    heading(2, "Done when"),
    bullet_list(
        [text("ForEach has continueOnError:true in all three pipeline stages (LZ, Bronze, Silver)")],
        [text("Failed entities are logged to an error table with enough detail to diagnose")],
        [text("Pipeline completes even when individual entities fail")],
        [text("A combined all-source run (1,735 entities) can survive individual entity failures")]
    )
)
update_description("MT-84", mt84_desc)


# ============================================================
# MT-85: OOM Entity Resolution - Large OPTIVA Tables
# ============================================================
print("\n" + "=" * 60)
print("MT-85: Rewriting description")
print("=" * 60)

mt85_desc = doc(
    heading(2, "What happened"),
    p(
        text("Three OPTIVA tables blow the Fabric executor memory limit during parquet conversion. They're deactivated (IsActive=0) for now so they don't block the rest of the OPTIVA pipeline run.")
    ),
    heading(2, "The tables"),
    table(
        ["Table", "LzId", "Status", "Likely cause"],
        [
            ["FSACTIONWEVENTPARAM", "1386", "Deactivated", "Wide schema + high row count"],
            ["FSACTIONWIPRESULTS", "1389", "Deactivated", "High-cardinality blob columns"],
            ["FSDESCRIPTION", "1451", "Deactivated", "Extremely wide or BLOB-heavy"],
        ]
    ),
    heading(2, "What I need to figure out"),
    ordered_list(
        [text("Profile each table", bold=True), text(" -- Column count, data types (especially varchar(max), ntext, image, varbinary), row count, avg row size, total size in bytes. Need to know if it's a width problem, a volume problem, or both.")],
        [text("Try chunked reads", bold=True), text(" -- Can the Copy Activity be parameterized with TOP/OFFSET or date-range partitioning to load in smaller batches? The framework supports parameterized queries, so this might be doable without pipeline changes.")],
        [text("Column exclusion", bold=True), text(" -- If specific BLOB/LOB columns aren't needed downstream, configure column mapping to exclude them. Might be the quickest win.")],
        [text("Capacity scaling", bold=True), text(" -- Last resort: temporarily bump the Fabric capacity for large-table loads. Not ideal, but it's an option if the tables legitimately need every column and row.")]
    ),
    heading(2, "Done when"),
    bullet_list(
        [text("All 3 tables load into LZ without OOM errors")],
        [text("Loading strategy is documented and reusable for other large tables across sources")],
        [text("Entities reactivated (IsActive=1) and included in normal pipeline runs")]
    ),
    heading(2, "Related"),
    bullet_list(
        [ic("MT-83"), text(" -- OPTIVA full medallion load (parent task)")],
        [ic("MT-17"), text(" -- Pipeline testing")]
    )
)
update_description("MT-85", mt85_desc)


print("\n" + "=" * 60)
print("ALL DESCRIPTION UPDATES COMPLETE")
print("=" * 60)
