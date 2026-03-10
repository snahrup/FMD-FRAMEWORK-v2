"""Create Jira ticket for Fabric Mirroring feasibility assessment."""
import json, urllib.request, urllib.error, base64

JIRA = "https://ip-corporation.atlassian.net/rest/api/3"
_creds = base64.b64encode(b"snahrup@ip-corporation.com:ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6").decode()
STEVE = "712020:aaf5cbe0-f88b-4eb5-ae6f-b1ba5f939752"
PATRICK = "557058:73c68783-606a-412c-89fa-502eddc13439"
DOMINIQUE = "712020:e9809320-35bb-4dd1-93df-69e1285f4f9c"

def jira_request(path, method="GET", data=None):
    url = f"{JIRA}{path}"
    if isinstance(data, str):
        body = data.encode()
    elif data is not None:
        body = json.dumps(data).encode()
    else:
        body = None
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

# ADF helpers
def text(t, marks=None):
    node = {"type": "text", "text": t}
    if marks:
        node["marks"] = marks
    return node

def bold(t):
    return text(t, [{"type": "strong"}])

def paragraph(*content):
    return {"type": "paragraph", "content": list(content)}

def heading(level, t):
    return {"type": "heading", "attrs": {"level": level}, "content": [text(t)]}

def bullet_list(*items):
    return {"type": "bulletList", "content": [
        {"type": "listItem", "content": [paragraph(text(item))]} for item in items
    ]}

def ordered_list(*items):
    return {"type": "orderedList", "content": [
        {"type": "listItem", "content": [paragraph(text(item))]} for item in items
    ]}

def code_block(lang, code):
    return {"type": "codeBlock", "attrs": {"language": lang}, "content": [text(code)]}

def table_row(*cells, header=False):
    cell_type = "tableHeader" if header else "tableCell"
    return {"type": "tableRow", "content": [
        {"type": cell_type, "content": [paragraph(text(c))]} for c in cells
    ]}

def table(*rows):
    return {"type": "table", "content": list(rows)}

def inline_card(key):
    return {"type": "inlineCard", "attrs": {"url": f"https://ip-corporation.atlassian.net/browse/{key}"}}


# ── Step 1: Create ticket with minimal fields ────────────────────────────
print("Step 1: Creating ticket...")
create_data = {
    "fields": {
        "project": {"key": "MT"},
        "summary": "Feasibility Assessment: Fabric Mirroring to Replace Landing Zone Copy Activities",
        "issuetype": {"name": "Task"},
        "parent": {"key": "MT-12"},
        "assignee": {"accountId": STEVE},
        "priority": {"name": "Priority 2"},
        "labels": ["fabric-mirroring", "architecture", "feasibility", "landing-zone"],
        "duedate": "2026-03-14",
        "timetracking": {"originalEstimate": "2d"}
    }
}
result = jira_request("/issue", "POST", create_data)
if not result:
    print("FAILED to create ticket")
    exit(1)

ticket_key = result["key"]
print(f"  Created: {ticket_key}")


# ── Step 2: Add rich ADF description ─────────────────────────────────────
print("Step 2: Adding description...")

description = {
    "version": 1,
    "type": "doc",
    "content": [
        heading(2, "Objective"),
        paragraph(
            text("Evaluate Microsoft Fabric Mirroring as a replacement for the current Copy Activity-based Landing Zone ingestion layer. Mirroring uses CDC to continuously replicate on-prem SQL Server tables into OneLake, potentially eliminating the entire LZ pipeline stage and the class of bugs that consumed weeks of debugging effort.")
        ),

        heading(2, "Context & Motivation"),

        heading(3, "The SQL Analytics Endpoint Sync Lag Problem (KI-1092)"),
        paragraph(
            text("During weeks of pipeline debugging, I discovered that the Lakehouse SQL Analytics Endpoint operates on an "),
            bold("eventually consistent"),
            text(" model, not strongly consistent. After data is written to a Lakehouse, the SQL endpoint can take anywhere from 0 seconds to 30+ minutes to reflect changes. This is Microsoft Known Issue KI-1092.")
        ),
        paragraph(
            text("This non-deterministic lag caused repeated misdiagnosis of working pipelines as broken, leading to code changes that introduced real bugs on top of phantom ones. The cascade: stale SQL reads trigger investigation, investigation leads to fixes on working code, those fixes create actual bugs, which then compound with the next stale read. This pattern repeated for approximately 2-3 weeks before identifying the root cause.")
        ),

        heading(3, "Current Architecture Pain Points"),
        paragraph(
            text("The Landing Zone layer (Copy Activity-based) is where the majority of pipeline failures originate:")
        ),
        bullet_list(
            "714 entities with empty SourceName causing LK_GET_LASTLOADDATE lookup failures (55% of all failures)",
            "Fabric SQL 429 throttling from 659 entities hitting metadata DB in parallel (one run took 13hr 43min)",
            "OutOfMemory on large table copies (21+ failures)",
            "ForEach timeout at 1hr killing activities that would eventually succeed",
            "Watermark management complexity across rowversion, datetime, and identity columns",
            "Pipeline timeout tuning (Copy 4hr, ExecutePipeline 6hr, ForEach 12hr)"
        ),

        heading(2, "Fabric Mirroring: Technical Assessment"),

        heading(3, "What It Is"),
        paragraph(
            text("Fabric Mirroring continuously replicates SQL Server tables into OneLake as Delta/Parquet using Change Data Capture (CDC). It is GA for SQL Server 2016-2022 running on-premises, on Azure VMs, and on non-Azure clouds. An on-premises data gateway provides secure connectivity.")
        ),

        heading(3, "Source Compatibility"),
        table(
            table_row("Source", "Server", "Registered Entities", "Under 1000 Limit", "PK Audit", header=True),
            table_row("MES", "m3-db1", "445", "Yes", "Needed"),
            table_row("ETQ", "M3-DB3", "29", "Yes", "Needed"),
            table_row("M3 Cloud", "sql2016live", "185", "Yes", "Needed"),
            table_row("M3 ERP", "sqllogshipprd", "Select from 3,973", "Need <=1000", "Needed")
        ),

        heading(3, "What It Eliminates"),
        bullet_list(
            "All Copy Activities and ForEach batching logic",
            "Pipeline timeout tuning across 3 levels (Copy, ExecutePipeline, ForEach)",
            "429 throttling from parallel metadata DB hits",
            "OutOfMemory on large table copies",
            "Watermark/incremental load management (CDC handles this natively)",
            "SourceName/LastLoadValue seeding logic in deploy script"
        ),

        heading(3, "What It Requires"),
        bullet_list(
            "On-premises data gateway (or VNet gateway) for secure connectivity",
            "CDC enabled on each source database (SQL Server 2016-2022)",
            "sysadmin access on source SQL Server instances for initial CDC configuration",
            "ALTER ANY EXTERNAL MIRROR permission on source databases",
            "IT/DBA approval for CDC configuration on production databases"
        ),

        heading(3, "Known Limitations"),
        ordered_list(
            "SQL Analytics Endpoint sync lag still applies. Mirrored data uses the same read-only SQL endpoint with the same eventual consistency. Force-refresh API call still needed before querying.",
            "Primary key required for SQL Server 2016-2022. Tables without PKs cannot be mirrored.",
            "Unsupported column types: rowversion/timestamp, xml, geometry, geography, hierarchyid, sql_variant, image, text/ntext, computed columns, CLR types, json, vector.",
            "DDL changes break mirroring on 2016-2022. Requires manual CDC re-enable via sp_cdc_disable_table / sp_cdc_enable_table.",
            "1000 table limit per mirrored database.",
            "LOB columns greater than 1MB truncated to 1MB in OneLake.",
            "datetime2(7) precision loss: 7th decimal digit is trimmed.",
            "Stopping mirroring triggers full reseed. No incremental restart."
        ),

        heading(3, "Revised Architecture"),
        code_block("text",
            "Current:  On-Prem SQL -> Copy Activity -> LZ Lakehouse -> Bronze -> Silver -> Gold\n"
            "Proposed: On-Prem SQL -> Fabric Mirror (CDC) -> Mirrored DB in OneLake -> Bronze -> Silver -> Gold"
        ),
        paragraph(
            text("The mirrored data in OneLake serves as the Landing Zone equivalent. Bronze/Silver transformations continue as-is but read from the mirrored tables instead of LZ lakehouse tables.")
        ),

        heading(2, "Action Items"),
        ordered_list(
            "PK audit: Query all 4 source databases to identify tables without primary keys",
            "Column type audit: Identify tables using unsupported types (rowversion, xml, geometry, etc.)",
            "Gateway assessment: Determine if existing on-prem data gateway can be reused or if new setup is needed",
            "DBA coordination: Get approval for CDC enablement on production SQL Server instances",
            "Proof of concept: Mirror ETQ (29 tables) end-to-end as smallest-scope test",
            "Impact analysis: Map which pipeline JSONs, notebooks, and stored procs need modification"
        ),

        heading(2, "Decision Criteria"),
        bullet_list(
            "If >90% of registered entities have PKs and compatible column types: strong candidate",
            "If DBA team approves CDC on production: proceed with POC",
            "If POC demonstrates reliable near-real-time sync: plan full migration"
        ),

        heading(2, "References"),
        bullet_list(
            "Microsoft Learn: Fabric Mirrored Databases From SQL Server",
            "Microsoft Learn: Mirroring Limitations for SQL Server",
            "Known Issue KI-1092: Delayed data availability in SQL Analytics Endpoint",
            "Fabric Community: Programmatic SQL Analytics Endpoint Refresh"
        ),
    ]
}

desc_result = jira_request(f"/issue/{ticket_key}", "PUT", {"fields": {"description": description}})
if desc_result is not None:
    print("  Description added")
else:
    print("  Description may have failed (check ticket)")


# ── Step 3: Add opening comment in Steve's voice ─────────────────────────
print("Step 3: Adding comment...")
comment_body = {
    "version": 1,
    "type": "doc",
    "content": [
        paragraph(
            text("Came across a couple Reddit threads about Fabric's SQL Analytics Endpoint sync lag and it clicked. The Lakehouse SQL endpoint is eventually consistent, not strongly consistent. After a notebook writes data to a lakehouse, the SQL endpoint can take anywhere from instant to 30+ minutes to reflect the change. Microsoft calls it KI-1092.")
        ),
        paragraph(
            text("This explains a huge chunk of what we've been chasing for the last 2-3 weeks. I'd query a lakehouse table, see zero rows or stale counts, assume something was broken, and go fix it. Except the data was actually there in the delta tables. The SQL endpoint just hadn't synced yet. Those fixes introduced real bugs on top of phantom ones. Classic cascading failure from a false premise.")
        ),
        paragraph(
            text("So now I'm looking at Fabric Mirroring as a way to cut out the entire Landing Zone Copy Activity layer. CDC-based continuous replication from on-prem SQL Server straight into OneLake. No more ForEach batching, no more timeout tuning, no more 429 throttling, no more watermark management. The mirrored data becomes the landing zone. Bronze and Silver transformations still run the same way, just reading from mirrored tables instead.")
        ),
        paragraph(
            text("It's GA for SQL Server 2016-2022 on-prem, which covers all four of our sources. Main requirements are an on-premises data gateway and CDC enabled on the source databases, which means getting DBA approval. There are some limitations to work through: tables need primary keys, certain column types aren't supported (rowversion, xml, geometry), and the 1000-table limit means M3 ERP needs careful table selection.")
        ),
        paragraph(
            text("First step is running a PK and column type audit across all four source databases to see what percentage of our registered entities are actually eligible. If it's north of 90%, this is worth a POC with ETQ (29 tables, smallest scope). Related to the root cause findings that drove "),
            inline_card("MT-84"),
            text(" and the pipeline work in "),
            inline_card("MT-17"),
            text(".")
        ),
    ]
}

jira_request(f"/issue/{ticket_key}/comment", "POST", {"body": comment_body})
print("  Comment added")


# ── Step 4: Add watchers ─────────────────────────────────────────────────
print("Step 4: Adding watchers...")
for watcher_id in [PATRICK, DOMINIQUE]:
    jira_request(f"/issue/{ticket_key}/watchers", "POST", json.dumps(watcher_id))
print("  Watchers added (Patrick + Dominique)")


# ── Step 5: Transition to Research/Discovery ─────────────────────────────
print("Step 5: Transitioning to Research/Discovery...")
jira_request(f"/issue/{ticket_key}/transitions", "POST", {"transition": {"id": "101"}})
print("  Transitioned to Research/Discovery")


# ── Step 6: Link to related tickets ──────────────────────────────────────
print("Step 6: Linking to related tickets...")
for related_key in ["MT-84", "MT-17"]:
    jira_request("/issueLink", "POST", {
        "type": {"name": "Relates"},
        "inwardIssue": {"key": ticket_key},
        "outwardIssue": {"key": related_key}
    })
    print(f"  Linked to {related_key}")


print(f"\nDone! Ticket: https://ip-corporation.atlassian.net/browse/{ticket_key}")
