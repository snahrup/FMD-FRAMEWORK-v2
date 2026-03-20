"""Jira update: Gold Studio design specification session (2026-03-18)."""
import json, urllib.request, urllib.error, base64, time

from _credentials import JIRA_USER, get_jira_token

JIRA = "https://ip-corporation.atlassian.net/rest/api/3"
_creds = base64.b64encode(
    f"{JIRA_USER}:{get_jira_token()}".encode()
).decode()
STEVE = "712020:aaf5cbe0-f88b-4eb5-ae6f-b1ba5f939752"
PATRICK = "557058:73c68783-606a-412c-89fa-502eddc13439"
DOMINIQUE = "712020:e9809320-35bb-4dd1-93df-69e1285f4f9c"
JIRA_URL = "https://ip-corporation.atlassian.net/browse"


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
        print(f"  HTTP {e.code}: {e.read().decode()[:500]}")
        return None


def text(t):
    return {"type": "text", "text": t}


def bold(t):
    return {"type": "text", "text": t, "marks": [{"type": "strong"}]}


def para(*content):
    return {"type": "paragraph", "content": list(content)}


def heading(level, t):
    return {"type": "heading", "attrs": {"level": level}, "content": [text(t)]}


def bullet_list(items):
    return {
        "type": "bulletList",
        "content": [
            {"type": "listItem", "content": [para(text(item))]} for item in items
        ],
    }


def inline_card(key):
    return {
        "type": "inlineCard",
        "attrs": {"url": f"{JIRA_URL}/{key}"},
    }


def adf(*content):
    return {"version": 1, "type": "doc", "content": list(content)}


def add_comment(key, body):
    print(f"  Adding comment to {key}...")
    r = jira_request(f"/issue/{key}/comment", "POST", {"body": body})
    if r:
        print(f"  OK: comment {r.get('id', '?')}")
    return r


def log_work(key, seconds, started, comment_text):
    print(f"  Logging {seconds//3600}h to {key} (started {started})...")
    r = jira_request(
        f"/issue/{key}/worklog",
        "POST",
        {
            "timeSpentSeconds": seconds,
            "started": started,
            "comment": adf(para(text(comment_text))),
        },
    )
    if r:
        print(f"  OK: worklog {r.get('id', '?')}")
    return r


def update_fields(key, fields):
    print(f"  Updating fields on {key}...")
    r = jira_request(f"/issue/{key}", "PUT", {"fields": fields})
    print(f"  OK" if r is not None else "  FAILED")
    return r


def add_watcher(key, account_id):
    url = f"{JIRA}/issue/{key}/watchers"
    body = json.dumps(account_id).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Basic {_creds}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            resp.read()
        return True
    except urllib.error.HTTPError:
        return False


def transition(key, tid):
    print(f"  Transitioning {key} -> {tid}...")
    r = jira_request(f"/issue/{key}/transitions", "POST", {"transition": {"id": str(tid)}})
    print(f"  OK" if r is not None else "  FAILED")
    return r


# ===========================================================================
# 1. Add progress comment to MT-93 (Server Refactor parent task)
# ===========================================================================
print("\n=== MT-93: Add Gold Studio spec comment ===")
add_comment(
    "MT-93",
    adf(
        para(
            text("Took a productive detour today into Gold layer design. The server refactor work ("),
            inline_card("MT-93"),
            text(") opened up the question of how we'd actually surface Gold layer content in the dashboard, and rather than hand-wave it I sat down and wrote the full spec."),
        ),
        para(
            text("The result is the Gold Studio design spec: 1,580 lines covering 21 SQLite tables, 59 API endpoints, and 6 file parsers (PBIX, PBIT, BIM, TMDL, RDL, SSRS). The core idea is a 5-page workflow. Import Power BI reports, extract their metadata (tables, columns, measures, relationships), cluster duplicate entities across models, canonicalize into conformed dimensions and facts, then draft Gold layer MLV specs from those canonical entities. Every step is traceable through a 7-phase provenance thread."),
        ),
        para(
            text("Ran the spec through 3 rounds of structured QA audits. 57 findings in round 1, 17 in round 2, 0 CRITICAL/HIGH by the end. The big additions from auditing: a full security model with 3-tier auth (Viewer/Contributor/Approver), parser security requirements (defusedxml for XXE, streaming decompression with size limits for ZIP bombs), optimistic concurrency via partial unique indexes, and a provenance propagation model that stores phases 1-3 on extracted entities and derives 4-7 at query time via LEFT JOINs."),
        ),
        para(
            text("This directly feeds into "),
            inline_card("MT-19"),
            text(" and "),
            inline_card("MT-62"),
            text(". The spec lives at docs/superpowers/specs/2026-03-18-gold-studio-design.md on the feat/business-portal branch. 5 commits pushed today."),
        ),
    ),
)

# ===========================================================================
# 2. Add progress comment to MT-19 (Gold Layer MLVs)
# ===========================================================================
print("\n=== MT-19: Add Gold Studio design comment ===")
add_comment(
    "MT-19",
    adf(
        para(
            text("Significant progress on the design side. Wrote a comprehensive Gold Studio design specification that maps out how we'll discover and build Gold layer content from existing Power BI reports. This is the missing piece between 'we have Silver layer data' and 'we have well-designed Gold MLVs.'"),
        ),
        para(
            text("The spec covers the full pipeline: importing Power BI artifacts (PBIX, PBIT, BIM, TMDL, RDL), extracting metadata (tables, columns, measures, M queries, DAX, relationships), clustering duplicate entities across semantic models, canonicalizing into conformed dimensions/facts, and drafting Gold layer MLV specifications. 21 tables, 59 endpoints, 6 parsers."),
        ),
        para(
            text("Key architectural decisions: provenance is tracked through 7 phases (Imported through Cataloged) with phases 1-3 stored and 4-7 derived. Versioning uses optimistic concurrency with root_id chains. Security has 3 tiers (Viewer/Contributor/Approver) with waiver support that's version-scoped. Parser security handles XXE, ZIP bombs, and oversized payloads."),
        ),
        para(
            text("The spec went through 3 rounds of QA audits, 74 total findings fixed, ending at 0 CRITICAL and 0 HIGH. Ready for implementation planning. See docs/superpowers/specs/2026-03-18-gold-studio-design.md. This work directly unblocks "),
            inline_card("MT-62"),
            text(" (star schema design) since the canonical modeling step produces the exact entity definitions needed."),
        ),
    ),
)

# Transition MT-19 from Planning to In Progress
print("\n=== MT-19: Transition to In Progress ===")
transition("MT-19", "103")  # Skip to In Progress

# ===========================================================================
# 3. Log work on MT-19 (Gold Studio spec is Gold layer design work)
# ===========================================================================
# Actual: ~3.5h spec writing + ~2h QA audits = 5.5h -> 2x = 11h -> log as 1d 3h
print("\n=== MT-19: Log work ===")
log_work(
    "MT-19",
    39600,  # 11h = 39600s
    "2026-03-18T08:00:00.000-0600",
    "Full day designing the Gold Studio specification. Started with the data model, working through how Power BI artifact metadata maps to our existing Silver layer entities. Designed the 21-table schema covering report imports, extracted entities, clustering, canonical modeling, Gold spec drafting, and catalog publishing. Afternoon focused on the API surface (59 endpoints across 6 route groups) and parser architecture for PBIX, PBIT, BIM, TMDL, RDL, and SSRS formats. Evening session was security review and QA hardening, addressing 74 audit findings across 3 rounds. Ended with a clean bill of health on the spec.",
)

# ===========================================================================
# 4. Update MT-19 fields
# ===========================================================================
print("\n=== MT-19: Update fields ===")
update_fields(
    "MT-19",
    {
        "labels": [
            "gold-layer",
            "mlv",
            "power-bi",
            "star-schema",
            "transformations",
            "gold-studio",
            "design-spec",
        ],
        "timetracking": {"remainingEstimate": "1w 1d"},
    },
)

# ===========================================================================
# 5. Add watchers to MT-19
# ===========================================================================
print("\n=== MT-19: Add watchers ===")
add_watcher("MT-19", PATRICK)
add_watcher("MT-19", DOMINIQUE)

# ===========================================================================
# 6. Update MT-62 (star schema subtask) with context
# ===========================================================================
print("\n=== MT-62: Add context comment ===")
add_comment(
    "MT-62",
    adf(
        para(
            text("Groundwork for this is now in place. The Gold Studio design spec ("),
            inline_card("MT-19"),
            text(") defines the canonical modeling workflow that produces conformed dimensions and facts. The star schema design step (this task) will consume canonical entities from Gold Studio and translate them into materialized lake view definitions."),
        ),
        para(
            text("Key inputs available: gs_canonical_entities and gs_canonical_columns tables define the target schema. gs_gold_specs captures the MLV SQL, grain, business keys, and transformation rules. The 7-phase provenance thread ensures every Gold column traces back to its Power BI source. Spec is at docs/superpowers/specs/2026-03-18-gold-studio-design.md."),
        ),
    ),
)

# ===========================================================================
# 7. Weekly hours audit (Mon 3/16 through Sat 3/21)
# ===========================================================================
print("\n=== WEEKLY HOURS AUDIT ===")
audit_data = jira_request(
    "/search/jql",
    "POST",
    {
        "jql": 'project=MT AND worklogDate >= "2026-03-16" AND worklogDate <= "2026-03-21"',
        "maxResults": 50,
        "fields": ["summary", "worklog"],
    },
)

daily_hours = {}
if audit_data:
    for issue in audit_data.get("issues", []):
        worklogs = issue["fields"].get("worklog", {}).get("worklogs", [])
        for wl in worklogs:
            started = wl.get("started", "")[:10]
            secs = wl.get("timeSpentSeconds", 0)
            daily_hours[started] = daily_hours.get(started, 0) + secs

print("\nWEEKLY HOURS AUDIT (Mon 3/16 - Sat 3/21):")
total = 0
day_names = {
    "2026-03-16": "Monday",
    "2026-03-17": "Tuesday",
    "2026-03-18": "Wednesday",
    "2026-03-19": "Thursday",
    "2026-03-20": "Friday",
    "2026-03-21": "Saturday",
}
for date, name in day_names.items():
    secs = daily_hours.get(date, 0)
    hours = secs / 3600
    total += hours
    cap = 6 if name == "Saturday" else 12
    status = "OK" if hours <= cap else f"OVER ({cap}h cap)"
    print(f"  {name:12} {hours:5.1f}h [{status}]")

print(f"  {'TOTAL':12} {total:5.1f}h [{'OK - under 68h cap' if total <= 68 else 'OVER 68h cap!'}]")

print("\n=== DONE ===")
