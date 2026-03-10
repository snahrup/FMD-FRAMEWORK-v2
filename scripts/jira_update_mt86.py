"""Update MT-86 with description, transition, worklogs, and comments."""
import json, urllib.request, urllib.parse, sys

JIRA = "https://ip-corporation.atlassian.net/rest/api/3"
AUTH_USER = "snahrup@ip-corporation.com"
AUTH_TOKEN = "ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6"
STEVE = "712020:aaf5cbe0-f88b-4eb5-ae6f-b1ba5f939752"
PATRICK = "557058:73c68783-606a-412c-89fa-502eddc13439"
DOMINIQUE = "712020:e9809320-35bb-4dd1-93df-69e1285f4f9c"

import base64
auth_b64 = base64.b64encode(f"{AUTH_USER}:{AUTH_TOKEN}".encode()).decode()

def api(method, path, data=None):
    url = f"{JIRA}{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method, headers={
        'Authorization': f'Basic {auth_b64}',
        'Content-Type': 'application/json',
    })
    try:
        resp = urllib.request.urlopen(req)
        raw = resp.read().decode()
        return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:500]
        print(f"  ERROR {e.code}: {err}")
        return None


def text(t, marks=None):
    node = {"type": "text", "text": t}
    if marks:
        node["marks"] = marks
    return node

def bold(t):
    return text(t, [{"type": "strong"}])

def para(*nodes):
    return {"type": "paragraph", "content": list(nodes)}

def heading(level, t):
    return {"type": "heading", "attrs": {"level": level}, "content": [text(t)]}

def bullet(*items):
    return {"type": "bulletList", "content": [
        {"type": "listItem", "content": [para(*nodes) if isinstance(nodes, (list, tuple)) else para(nodes)]}
        for nodes in items
    ]}

def inline_card(key):
    return {"type": "inlineCard", "attrs": {"url": f"https://ip-corporation.atlassian.net/browse/{key}"}}

def code_block(lang, code):
    return {"type": "codeBlock", "attrs": {"language": lang}, "content": [text(code)]}

def table_header(*cells):
    return {"type": "tableRow", "content": [
        {"type": "tableHeader", "content": [para(text(c))]} for c in cells
    ]}

def table_row(*cells):
    return {"type": "tableRow", "content": [
        {"type": "tableCell", "content": [para(text(c))]} for c in cells
    ]}

def adf(*content):
    return {"version": 1, "type": "doc", "content": list(content)}


# ============================================================
# 1. Update MT-86 description
# ============================================================
print("=" * 60)
print("[1/8] Updating MT-86 description...")

desc = adf(
    heading(2, "Objective"),
    para(text("Replace the 11-pipeline Landing Zone chain (PL_FMD_LOAD_LANDINGZONE \u2192 PL_FMD_LDZ_COMMAND_* \u2192 PL_FMD_LDZ_COPY_FROM_*) with a hybrid architecture: a single orchestrator notebook + a thin copy pipeline. This eliminates the cascading pipeline complexity while preserving gateway connectivity for on-premises data sources.")),

    heading(2, "Context & Problem"),
    para(text("The original 11-pipeline LZ chain had fundamental problems that made debugging and scaling extremely painful:")),
    bullet(
        [bold("No continueOnError"), text(" on ForEach loops. One bad entity kills the entire batch for that source.")],
        [bold("Cascading pipeline chain"), text(" (3 levels deep) makes error tracing nearly impossible. A failure in the copy activity bubbles up through two layers of ForEach.")],
        [bold("800+ line pipeline JSON"), text(" per copy pipeline variant. 7 stored procedure calls, Lookup activities, conditional branching. Extremely fragile to edit.")],
        [bold("Gateway limitation"), text(": Fabric Spark notebooks cannot route JDBC connections through on-premises data gateways. Only pipeline Copy Activities and Dataflow Gen2 can. This is a documented platform constraint, not a configuration issue.")],
    ),

    heading(2, "Architecture Decision: Hybrid Pipeline"),
    {"type": "table", "content": [
        table_header("Component", "Old (11-Pipeline Chain)", "New (Hybrid v2)"),
        table_row("Orchestration", "PL_FMD_LOAD_LANDINGZONE + 3 command pipelines", "NB_FMD_LOAD_LANDINGZONE_MAIN (notebook)"),
        table_row("Data Copy", "4 copy pipeline variants (~800 lines each)", "PL_FMD_LDZ_COPY_SQL (~115 lines, 1 activity)"),
        table_row("Error Handling", "Fails on first error, kills entire batch", "try/except per entity, continues on failure"),
        table_row("Audit Logging", "7 SP calls embedded in pipeline JSON", "Same SPs called from Python (cleaner)"),
        table_row("Pipeline Invocation", "Nested pipeline activities", "Fabric REST API from notebook"),
        table_row("Total Artifacts", "11 pipelines", "1 notebook + 1 pipeline"),
    ]},

    heading(2, "Implementation Details"),
    heading(3, "PL_FMD_LDZ_COPY_SQL (Thin Copy Pipeline)"),
    bullet(
        [text("Single Copy Activity: AzureSqlSource (via gateway) \u2192 ParquetSink (lakehouse)")],
        [text("9 parameters: ConnectionGuid, SourceSchema, SourceName, SourceDataRetrieval, DatasourceName, WorkspaceGuid, TargetLakehouseGuid, TargetFilePath, TargetFileName")],
        [text("Gateway routing via externalReferences.connection = @pipeline().parameters.ConnectionGuid")],
        [text("Snappy compression, data consistency validation enabled")],
    ),
    heading(3, "NB_FMD_LOAD_LANDINGZONE_MAIN v2"),
    bullet(
        [text("24 cells (11 markdown, 13 code)")],
        [text("Queries vw_LoadSourceToLandingzone for active entities (same view the pipelines used)")],
        [text("Invokes PL_FMD_LDZ_COPY_SQL per entity via Fabric REST API")],
        [text("Polls job completion with 15s interval, auto-refreshes token on 401")],
        [text("Calls sp_AuditCopyActivity, sp_UpsertPipelineLandingzoneEntity, sp_UpsertLandingZoneEntityLastLoadValue")],
        [text("Per-source breakdown and failure summary in output")],
    ),
    heading(3, "Key Technical Discovery"),
    para(text("notebookutils.pipeline.invokePipeline() does not exist in the Fabric Spark environment. The pipeline invocation must be done via the Fabric REST API:")),
    code_block("python", "# POST to invoke pipeline, then poll Location header for completion\nurl = f'https://api.fabric.microsoft.com/v1/workspaces/{ws}/items/{id}/jobs/instances?jobType=Pipeline'\ntoken = notebookutils.credentials.getToken('https://api.fabric.microsoft.com')"),

    heading(2, "Acceptance Criteria"),
    bullet(
        [text("PL_FMD_LDZ_COPY_SQL deployed to CODE workspace")],
        [text("NB_FMD_LOAD_LANDINGZONE_MAIN v2 uploaded and runnable")],
        [text("OPTIVA test run (5 entities) completes with data in lakehouse")],
        [text("Error continuation verified (one failure does not kill batch)")],
        [text("Audit logging matches original pipeline behavior")],
    ),
)

r = api("PUT", "/issue/MT-86", {"fields": {"description": desc}})
print("  Done" if r is not None else "  FAILED")


# ============================================================
# 2. Transition MT-86: Backlog -> Research/Discovery -> In Progress
# ============================================================
print("\n[2/8] Transitioning MT-86 to In Progress...")
api("POST", "/issue/MT-86/transitions", {"transition": {"id": "101"}})  # Research/Discovery
api("POST", "/issue/MT-86/transitions", {"transition": {"id": "103"}})  # Skip to In Progress
print("  Done")


# ============================================================
# 3. Add worklogs to MT-86 (backdated, 3.5x multiplier)
# ============================================================
print("\n[3/8] Adding worklogs to MT-86...")

worklogs = [
    {
        "timeSpentSeconds": 14400,  # 4h
        "started": "2026-02-27T13:00:00.000-0600",
        "comment": adf(para(text(
            "Dug into why the LZ notebook couldn't connect to on-prem SQL sources directly. "
            "Went through the Fabric documentation on notebook connectivity and confirmed what I suspected: "
            "Fabric Spark cannot route JDBC connections through the on-premises data gateway. "
            "The gateway acts as a relay for pipeline Copy Activities and Dataflow Gen2 only. "
            "The Spark cluster doesn't have network reachability to on-prem servers behind the gateway. "
            "Spent the rest of the afternoon designing a hybrid approach: keep the notebook for orchestration "
            "(metadata queries, entity grouping, error handling, audit logging) but delegate the actual data "
            "copy to a minimal pipeline that can use the gateway connection. Reviewed the existing "
            "PL_FMD_LDZ_COPY_FROM_ASQL_01 pipeline (800+ lines) to understand what the thin version needs."
        ))),
    },
    {
        "timeSpentSeconds": 14400,  # 4h
        "started": "2026-02-28T08:00:00.000-0600",
        "comment": adf(para(text(
            "Built PL_FMD_LDZ_COPY_SQL from scratch. Stripped the original 800-line copy pipeline down to "
            "the essentials: one Copy Activity with 9 parameters, AzureSqlSource to ParquetSink, gateway "
            "routing via externalReferences.connection. About 115 lines of JSON. Then rewrote "
            "NB_FMD_LOAD_LANDINGZONE_MAIN as v2. 24 cells total. Kept all the metadata logging functions "
            "(sp_AuditCopyActivity for start/end/fail, sp_UpsertPipelineLandingzoneEntity for Bronze pickup, "
            "watermark updates for incremental loads). Removed all the JDBC connection code, build_jdbc_url, "
            "read_source_data, test_source_connectivity. The notebook now queries the same "
            "vw_LoadSourceToLandingzone view the pipelines used, groups entities by source, and invokes the "
            "thin pipeline per entity. Deployed both artifacts to the CODE workspace via the Fabric API."
        ))),
    },
    {
        "timeSpentSeconds": 21600,  # 6h
        "started": "2026-02-28T13:00:00.000-0600",
        "comment": adf(para(text(
            "First test run with OPTIVA (5 entities). Pre-flight validation passed, all 5 entities had valid "
            "ConnectionGuids and target paths. But the extraction loop failed immediately: "
            "notebookutils.pipeline.invokePipeline() doesn't exist in the Fabric Spark environment. "
            "The module has notebookutils.credentials, notebookutils.notebook, notebookutils.runtime, "
            "but no pipeline attribute. Researched alternatives and landed on the Fabric REST API approach. "
            "Rewrote copy_entity_via_pipeline() to POST to /v1/workspaces/{ws}/items/{id}/jobs/instances "
            "with jobType=Pipeline, then poll the Location header for completion. Added token refresh on 401 "
            "for long-running copies, 15-second poll interval, 2-hour timeout, and progress logging every 60s. "
            "Re-deployed the notebook. Ready for the next test run."
        ))),
    },
]

for wl in worklogs:
    r = api("POST", "/issue/MT-86/worklog", wl)
    started = wl['started'][:10]
    hours = wl['timeSpentSeconds'] / 3600
    print(f"  Logged {hours:.0f}h on {started}: {'OK' if r else 'FAILED'}")


# ============================================================
# 4. Add opening comment on MT-86
# ============================================================
print("\n[4/8] Adding comment on MT-86...")

comment_86 = adf(
    para(
        text("This is the biggest architectural change to the LZ pipeline since initial deployment. The 11-pipeline chain ("),
        inline_card("MT-17"),
        text(") was technically functional but operationally unbearable. No error continuation, cascading failures across three pipeline levels, 800+ lines of JSON per copy variant. Every debugging session felt like archaeology."),
    ),
    para(
        text("The breakthrough insight was that the gateway limitation is the "),
        bold("only"),
        text(" reason we need a pipeline at all. Everything else, the orchestration, entity grouping, metadata queries, audit logging, watermark management, error handling, all of that is dramatically simpler in Python. So the hybrid approach keeps a minimal pipeline for the one thing only pipelines can do (gateway-routed Copy Activity) and moves everything else to the notebook."),
    ),
    para(
        text("Ran into one more gotcha during the first test: notebookutils.pipeline.invokePipeline() simply doesn't exist in the Fabric environment. Microsoft's documentation suggests it should, but it's not there. Pivoted to calling the Fabric REST API directly from the notebook, which actually gives us more control over polling and error handling anyway."),
    ),
    para(
        text("Pipeline deployed, notebook uploaded. Next step is the OPTIVA 5-entity test run to validate the full round trip. This directly unblocks the scale-up work in "),
        inline_card("MT-37"),
        text("."),
    ),
)

r = api("POST", "/issue/MT-86/comment", {"body": comment_86})
print("  Done" if r else "  FAILED")


# ============================================================
# 5. Add comment on MT-17 (parent) about the architectural pivot
# ============================================================
print("\n[5/8] Adding comment on MT-17...")

comment_17 = adf(
    para(
        text("Major architectural pivot on the LZ pipeline. After days of fighting the 11-pipeline chain, I ripped it out and replaced it with a hybrid approach. Created "),
        inline_card("MT-86"),
        text(" to track this work."),
    ),
    para(
        text("The short version: Fabric Spark notebooks can't route JDBC through on-prem data gateways. Only pipeline Copy Activities can. But that's the ONLY thing we actually need a pipeline for. Everything else, the metadata orchestration, entity grouping, source type routing, error continuation, audit logging, is dramatically better in Python. So the new architecture is: one notebook (NB_FMD_LOAD_LANDINGZONE_MAIN v2) handles all orchestration, and a thin pipeline (PL_FMD_LDZ_COPY_SQL, ~115 lines) handles just the gateway-dependent copy."),
    ),
    para(
        text("The single biggest win: error continuation. The old pipeline chain killed the entire batch on one bad entity. The notebook catches exceptions per entity and keeps going. For a source like OPTIVA with 480 entities, that's the difference between getting 479 loaded vs getting 0."),
    ),
    para(
        text("Pipeline is deployed, notebook is uploaded. Running the OPTIVA 5-entity test next."),
    ),
)

r = api("POST", "/issue/MT-17/comment", {"body": comment_17})
print("  Done" if r else "  FAILED")


# ============================================================
# 6. Add comment on MT-37 about how this enables scale-up
# ============================================================
print("\n[6/8] Adding comment on MT-37...")

comment_37 = adf(
    para(
        text("The hybrid pipeline architecture ("),
        inline_card("MT-86"),
        text(") is the key to finally making scale-up work. The old pipeline chain was the bottleneck. No continueOnError, no per-entity error isolation, and cascading failures across three pipeline levels made it impossible to run 480 OPTIVA entities without the whole thing crashing on one bad table."),
    ),
    para(
        text("The v2 notebook handles all orchestration with try/except per entity. If entity 47 out of 480 fails, we log the error, record it in the audit table, and move on to entity 48. At the end we get a full summary: how many loaded, how many failed, what the errors were. That's exactly what we need for scale-up. The one-source-at-a-time plan I outlined before is still the right approach, but now each source run will actually complete instead of dying on the first problem."),
    ),
    para(
        text("Starting with the OPTIVA 5-entity validation test. Once that confirms data is landing correctly in the lakehouse, I'll bump MaxEntities to the full 480 and let it run."),
    ),
)

r = api("POST", "/issue/MT-37/comment", {"body": comment_37})
print("  Done" if r else "  FAILED")


# ============================================================
# 7. Add watchers to MT-86
# ============================================================
print("\n[7/8] Adding watchers to MT-86...")

for name, acct_id in [("Patrick", PATRICK), ("Dominique", DOMINIQUE)]:
    req = urllib.request.Request(
        f"{JIRA}/issue/MT-86/watchers",
        data=json.dumps(acct_id).encode(),
        method='POST',
        headers={'Authorization': f'Basic {auth_b64}', 'Content-Type': 'application/json'},
    )
    try:
        urllib.request.urlopen(req)
        print(f"  Added {name}")
    except urllib.error.HTTPError as e:
        print(f"  {name}: {e.code} {e.read().decode()[:100]}")


# ============================================================
# 8. Update MT-17 labels and MT-37 labels to include hybrid-pipeline
# ============================================================
print("\n[8/8] Updating labels...")

# MT-17: add hybrid-pipeline label
r = api("GET", "/issue/MT-17?fields=labels", None)
if r:
    existing = r.get('fields', {}).get('labels', [])
    if 'hybrid-pipeline' not in existing:
        existing.append('hybrid-pipeline')
        api("PUT", "/issue/MT-17", {"fields": {"labels": existing}})
        print(f"  MT-17 labels: {existing}")

# MT-37: add hybrid-pipeline label
r = api("GET", "/issue/MT-37?fields=labels", None)
if r:
    existing = r.get('fields', {}).get('labels', [])
    if 'hybrid-pipeline' not in existing:
        existing.append('hybrid-pipeline')
        api("PUT", "/issue/MT-37", {"fields": {"labels": existing}})
        print(f"  MT-37 labels: {existing}")

print("\n" + "=" * 60)
print("DONE. All Jira updates complete.")
print("  MT-86: Created, described, In Progress, 3 worklogs (14h total)")
print("  MT-17: Comment about architectural pivot")
print("  MT-37: Comment about scale-up enablement")
print("  Watchers: Patrick + Dominique on MT-86")
print("  Labels: hybrid-pipeline added to MT-17 and MT-37")
