#!/usr/bin/env python3
"""
FMD Packet Command Center — auto-generating dashboard.

Reads curated packet/page data + live GitHub PR state to produce
docs/PACKET_COMMAND_CENTER.html

Run manually:  python scripts/update_command_center.py
Auto-trigger:  Claude Code PostToolUse hook after `gh pr merge`
"""

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "docs" / "PACKET_COMMAND_CENTER.html"

# ──────────────────────────────────────────────────────────────
# CURATED DATA — update these when scoping new packets
# ──────────────────────────────────────────────────────────────

PACKETS = [
    # Truth lane (RP-NN)
    # "why" = plain-English impact shown in the dashboard's signal boxes
    {"id": "RP-01", "title": "Load Center rewired to engine_task_log", "prs": [3, 4, 5], "lane": "truth",
     "why": "Load Center was showing zeros for all table counts because it read from an empty cache table instead of the real engine log."},
    {"id": "RP-02", "title": "Overview two-tier freshness + loaded/registered", "prs": [3, 4, 5], "lane": "truth",
     "why": "Overview was claiming 0% data freshness after any failed run, and showing registered entity counts as if they were loaded tables."},
    {"id": "RP-03", "title": "Entity Status routes migrated from deprecated table", "prs": [3, 4, 5], "lane": "truth",
     "why": "Multiple pages were reading from a deprecated entity_status table that disagreed with actual engine results, causing phantom failures."},
    {"id": "RP-04", "title": "Full vs incremental row distinction", "prs": [3, 4, 5], "lane": "truth",
     "why": "Incremental load deltas were being displayed as total row counts, making it look like tables had far fewer rows than reality."},
    {"id": "RP-05", "title": "Run state persisted to SQLite", "prs": [3, 4, 5], "lane": "truth",
     "why": "Load Center lost all run state when you navigated away or refreshed the page. Now persists through restarts."},
    {"id": "RP-06", "title": "3/20 extraction failure audit", "prs": [7], "lane": "truth",
     "why": "Root-caused why the 3/20 extraction run failed: VPN outage, watermark type mismatches, and phantom source tables."},
    {"id": "RP-06B", "title": "Watermark remediation + seed hardening", "prs": [8], "lane": "truth",
     "why": "255 watermark entries had wrong column types, causing incremental loads to silently skip data. Seed script now validates types."},
    {"id": "RP-06C", "title": "Connectivity verified, all 5 sources extract", "prs": [9], "lane": "truth",
     "why": "Confirmed all 5 source databases are reachable and extracting cleanly after the VPN outage fix."},
    {"id": "RP-07", "title": "Gold Studio honest labels", "prs": [10], "lane": "truth",
     "why": "Gold Studio was presenting naive clustering and structure-only validation as production-ready features. Labels now disclose limitations."},
    {"id": "RP-08", "title": "Load Center refresh polling + empty state", "prs": [12], "lane": "truth",
     "why": "Load Center had a hardcoded 2-second delay instead of real polling, and showed a confusing blank page on fresh installs."},
    # Census / docs
    {"id": "Census", "title": "Dashboard packet map and audit baseline", "prs": [11], "lane": "truth",
     "why": "Established the master inventory of all 53 routes, what's been audited, and what packets are needed."},
    {"id": "RP-09", "title": "Source Manager truth alignment", "prs": [13], "lane": "truth",
     "why": "Clicking 'Analyze' on a source shows 'undefined' everywhere because the frontend expects a rich analysis result the backend doesn't return. Also, 'Discover & Register' silently misses SqlServer-type connections due to a filter bug."},
    {"id": "RP-10", "title": "Gateway connection infrastructure", "prs": [14], "lane": "truth",
     "why": "The Gateway Connections section is completely broken — no backend endpoint exists. Connections KPI always shows 0. Wizard Step 1 can't list available databases."},
    {"id": "RP-11", "title": "Config Manager GUIDs + cascade modal", "prs": [17], "lane": "truth",
     "why": "Config Manager shows blank pipeline GUIDs and the cascade deletion modal has display issues, making it unsafe to manage pipeline configs."},
    {"id": "RP-12", "title": "Overview activity panel enum mismatch", "prs": [16], "lane": "truth",
     "why": "Overview activity feed may show wrong icons or labels because the frontend status enums don't match what the backend actually sends."},
    # Audits
    {"id": "AUDIT-EI", "title": "Error Intelligence audit + dedup fix", "prs": [20], "lane": "truth",
     "why": "Error counts were inflated by duplicate queries hitting the same table twice. Status case mismatch caused the primary query to miss lowercase 'failed' rows."},
    {"id": "AUDIT-BA", "title": "Business Alerts type alignment", "prs": [19], "lane": "truth",
     "why": "Backend sends 'pending' alerts the frontend can't render (undefined label). 'Failure' type was declared but never produced — dead filter chip."},
    {"id": "AUDIT-EL", "title": "Execution Log audit refresh", "prs": [24], "lane": "truth",
     "why": "Audit doc was stale — said all 3 tabs were broken (wrong tables). They've been fixed since. Doc now reflects current PASS state."},
    {"id": "AUDIT-DC", "title": "Data Catalog audit refresh", "prs": [22], "lane": "truth",
     "why": "Confirmed PASS verdict still holds. Documented 5 enhancement opportunities (quality tab, pagination, enrichment fields)."},
    # UI lane (UP-NN)
    {"id": "UP-01", "title": "Font token fix (--font-display → --bp-font-display)", "prs": [15], "lane": "ui",
     "why": "9 pages use the wrong CSS variable for display fonts, so they fall back to the browser default instead of the design system font."},
    {"id": "UP-02", "title": "DataProfiler hex purge (130+ hardcoded colors)", "prs": [21], "lane": "ui",
     "why": "DataProfiler has 130+ hardcoded hex/rgba colors that won't respond to theme changes and look inconsistent with the rest of the dashboard."},
    {"id": "UP-03", "title": "ExecutionMatrix hex purge (12 chart colors)", "prs": [18], "lane": "ui",
     "why": "Chart colors in Execution Matrix are hardcoded hex values instead of design tokens, breaking visual consistency."},
    {"id": "UP-04", "title": "EngineControl LogLine + chart hex purge (21 colors)", "prs": [25], "lane": "ui",
     "why": "Log level colors, chart fills, and panel backgrounds are hardcoded hex instead of semantic tokens, making them inconsistent with the design system."},
    {"id": "UP-05", "title": "DataLineage layer badge hex purge (6 colors)", "prs": [23], "lane": "ui",
     "why": "Layer badge colors and border values in Data Lineage are hardcoded, so they don't match the design system convention."},
    {"id": "UP-06", "title": "Table header standardization", "prs": [], "lane": "ui",
     "why": "Some tables use generic Tailwind backgrounds while others use design system surface tokens, creating visible inconsistency."},
    {"id": "UP-07", "title": "Minor token cleanup (ConfigManager, DatabaseExplorer)", "prs": [26], "lane": "ui",
     "why": "Scattered hardcoded #fff and #FEFDFB values that should be design system tokens."},
    # Audits (batch 4)
    {"id": "AUDIT-PS", "title": "Portal Sources audit + LastLoadDate fix", "prs": [28], "lane": "truth",
     "why": "LastLoadDate showed stale LZ timestamp even when Silver was fresher. Dead imports cleaned. Audit doc established."},
    {"id": "AUDIT-PC", "title": "Portal Catalog audit + quality/domain fixes", "prs": [27], "lane": "truth",
     "why": "Quality tier badges were blank (response shape mismatch). Gold domain cards showed '0 datasets' and broken links. Both fixed."},
    # Audits (batch 5)
    {"id": "AUDIT-ST", "title": "Settings page audit + accessibility fixes", "prs": [29], "lane": "truth",
     "why": "6 hardcoded hex colors, 3 dead code blocks, 6 missing accessibility attributes. Labs toggles lacked proper switch semantics."},
    {"id": "AUDIT-ES", "title": "EnvironmentSetup page audit + ARIA fixes", "prs": [30], "lane": "truth",
     "why": "12 unused imports, hardcoded hex, missing tabpanel/tablist ARIA associations, missing aria-labels on buttons and selects."},
]

PAGES = [
    {"name": "Overview", "route": "/overview", "lane": "Truth", "packets": ["RP-02", "RP-12"],
     "focus": "Open workflow enum mismatch", "next": "RP-12 candidate"},
    {"name": "Load Center", "route": "/load-center", "lane": "Truth", "packets": ["RP-01", "RP-04", "RP-05", "RP-08"],
     "focus": "Closed after RP-08", "next": "Done for now"},
    {"name": "Source Manager", "route": "/sources", "lane": "Truth", "packets": ["RP-09", "RP-10"],
     "focus": "Best next repair target", "next": "RP-09"},
    {"name": "Execution Matrix", "route": "/matrix", "lane": "UI", "packets": ["UP-03"],
     "focus": "Critical token drift", "next": "UP-03"},
    {"name": "Error Intelligence", "route": "/errors", "lane": "Truth", "packets": ["AUDIT-EI"],
     "focus": "Dedup + case fix merged", "next": "Done for now"},
    {"name": "Execution Log", "route": "/logs", "lane": "Truth", "packets": ["UP-01", "UP-06", "AUDIT-EL"],
     "focus": "Audit refreshed — PASS", "next": "UP-06 token cleanup"},
    {"name": "Data Blender", "route": "/blender", "lane": "UI", "packets": ["UP-01"],
     "focus": "Low truth risk, font drift", "next": "UP-01"},
    {"name": "Data Lineage", "route": "/lineage", "lane": "Audit/UI", "packets": ["UP-05"],
     "focus": "Lineage truth unknown", "next": "Audit / UP-05"},
    {"name": "Data Catalog", "route": "/catalog", "lane": "Truth", "packets": ["AUDIT-DC"],
     "focus": "Audit refreshed — PASS", "next": "Enhancement opportunities documented"},
    {"name": "Data Profiler", "route": "/profile", "lane": "Audit/UI", "packets": ["UP-02"],
     "focus": "Worst token violator", "next": "Audit / UP-02"},
    {"name": "Gold Clusters", "route": "/gold/clusters", "lane": "Gold", "packets": ["RP-07"],
     "focus": "Honesty pass merged", "next": "Done"},
    {"name": "Gold Validation", "route": "/gold/validation", "lane": "Gold", "packets": ["RP-07"],
     "focus": "Structure-only labeling fixed", "next": "Done"},
    {"name": "Config Manager", "route": "/config", "lane": "Truth/UI", "packets": ["RP-11", "UP-07"],
     "focus": "Token cleanup merged", "next": "Done for now"},
    {"name": "Engine Control", "route": "/engine", "lane": "Truth/UI", "packets": ["UP-04"],
     "focus": "Token cleanup merged", "next": "Done for now"},
    {"name": "Database Explorer", "route": "/explorer", "lane": "UI", "packets": ["UP-07"],
     "focus": "Token cleanup merged", "next": "Done for now"},
    {"name": "Portal Sources", "route": "/sources-portal", "lane": "Truth", "packets": ["AUDIT-PS"],
     "focus": "Audited — LastLoadDate fix + dead code cleanup", "next": "UP-06 candidate (has table headers)"},
    {"name": "Portal Catalog", "route": "/catalog-portal", "lane": "Truth", "packets": ["AUDIT-PC"],
     "focus": "Audited — quality + domain response shape fixes", "next": "Backend enhancements (BE-1, BE-2)"},
    {"name": "Business Alerts", "route": "/alerts", "lane": "Truth", "packets": ["AUDIT-BA"],
     "focus": "Type alignment fixed", "next": "Done for now"},
    {"name": "Settings", "route": "/settings", "lane": "Truth", "packets": ["AUDIT-ST"],
     "focus": "Audited — token + dead code + a11y fixes", "next": "Done for now"},
    {"name": "Environment Setup", "route": "/setup", "lane": "Truth", "packets": ["AUDIT-ES"],
     "focus": "Audited — imports + ARIA tablist/tabpanel fixes", "next": "Done for now"},
    {"name": "Hidden routes (24 total)", "route": "hidden", "lane": "Audit", "packets": [],
     "focus": "Mostly still unaudited", "next": "Expand later"},
]

# ──────────────────────────────────────────────────────────────
# LIVE PR STATE
# ──────────────────────────────────────────────────────────────

def get_pr_state():
    """Fetch merged + open PRs from GitHub CLI."""
    merged, opened = [], []
    try:
        out = subprocess.run(
            ["gh", "pr", "list", "--state", "merged", "--json", "number,title,mergedAt", "--limit", "100"],
            capture_output=True, text=True, timeout=15, cwd=str(ROOT)
        )
        if out.returncode == 0:
            merged = json.loads(out.stdout)
    except Exception:
        pass
    try:
        out = subprocess.run(
            ["gh", "pr", "list", "--state", "open", "--json", "number,title,headRefName,reviewDecision", "--limit", "50"],
            capture_output=True, text=True, timeout=15, cwd=str(ROOT)
        )
        if out.returncode == 0:
            opened = json.loads(out.stdout)
    except Exception:
        pass
    return merged, opened


def compute_state(merged_prs, open_prs):
    """Compute packet and page states from live PR data."""
    merged_nums = {pr["number"] for pr in merged_prs}
    open_nums = {pr["number"] for pr in open_prs}

    packet_states = {}
    for pkt in PACKETS:
        pid = pkt["id"]
        prs = pkt["prs"]
        if not prs:
            packet_states[pid] = "queued"
        elif all(pr in merged_nums for pr in prs):
            packet_states[pid] = "merged"
        elif any(pr in open_nums for pr in prs):
            packet_states[pid] = "open"
        else:
            packet_states[pid] = "queued"

    page_states = {}
    for page in PAGES:
        pkts = page["packets"]
        if not pkts:
            page_states[page["name"]] = "NOT YET"
        else:
            states = [packet_states.get(p, "queued") for p in pkts]
            if all(s == "merged" for s in states):
                page_states[page["name"]] = "PACKETIZED"
            elif any(s == "merged" for s in states):
                page_states[page["name"]] = "PARTIALLY"
            else:
                page_states[page["name"]] = "NOT YET"

    # Special cases
    if "Hidden routes (24 total)" in page_states:
        page_states["Hidden routes (24 total)"] = "MIXED"

    return packet_states, page_states


# ──────────────────────────────────────────────────────────────
# METRICS
# ──────────────────────────────────────────────────────────────

def compute_metrics(packet_states, page_states):
    total_routes = len(PAGES)
    packetized = sum(1 for s in page_states.values() if s == "PACKETIZED")
    partial = sum(1 for s in page_states.values() if s in ("PARTIALLY", "MIXED"))
    not_yet = total_routes - packetized - partial

    merged_truth = sum(1 for p in PACKETS if p["lane"] == "truth" and packet_states.get(p["id"]) == "merged")
    open_truth = sum(1 for p in PACKETS if p["lane"] == "truth" and packet_states.get(p["id"]) != "merged")
    open_ui = sum(1 for p in PACKETS if p["lane"] == "ui" and packet_states.get(p["id"]) != "merged")

    return {
        "total_routes": total_routes,
        "packetized": packetized,
        "partial": partial,
        "not_yet": not_yet,
        "touched": packetized + partial,
        "merged_truth": merged_truth,
        "open_truth": open_truth,
        "open_ui": open_ui,
        "pct_packetized": round(packetized / total_routes * 100),
        "pct_touched": round((packetized + partial) / total_routes * 100),
        "pct_not_yet": round(not_yet / total_routes * 100),
    }


# ──────────────────────────────────────────────────────────────
# SEQUENCING LOGIC
# ──────────────────────────────────────────────────────────────

def find_current_sequence(packet_states):
    """Find the last merged, current active, and next queued packet."""
    truth_packets = [p for p in PACKETS if p["lane"] == "truth"]

    # Last merged = merged packet with highest PR number (most recent merge)
    merged_pkts = [p for p in truth_packets if packet_states.get(p["id"]) == "merged"]
    last_merged = max(merged_pkts, key=lambda p: max(p["prs"]) if p["prs"] else 0) if merged_pkts else None

    # Current = first non-merged in list order (open PR > queued)
    current = None
    next_up = None
    for pkt in truth_packets:
        state = packet_states.get(pkt["id"])
        if state in ("open", "queued"):
            if current is None:
                current = pkt
            elif next_up is None:
                next_up = pkt
                break

    return last_merged, current, next_up


# ──────────────────────────────────────────────────────────────
# HTML GENERATION
# ──────────────────────────────────────────────────────────────

def pill(label, css_class):
    return f'<span class="pill {css_class}">{label}</span>'


def status_pill(status):
    cls = {"PACKETIZED": "packetized", "PARTIALLY": "partial", "NOT YET": "notyet", "MIXED": "mixed"}
    return pill(status, cls.get(status, "neutral"))


def lane_pill(lane):
    cls = {"Truth": "truth", "UI": "ui", "Audit": "audit", "Gold": "gold",
           "Truth/UI": "truth", "Audit/UI": "ui"}
    return pill(lane, cls.get(lane, "neutral"))


def packet_state_pill(state):
    cls = {"merged": "merged", "open": "truth", "queued": "neutral"}
    labels = {"merged": "Merged", "open": "Open PR", "queued": "Queued"}
    return pill(labels.get(state, state), cls.get(state, "neutral"))


def generate_html(metrics, packet_states, page_states, merged_prs, open_prs, seq):
    last_merged, current, next_up = seq
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    m = metrics

    # Build merged checkpoint cards
    merged_packets = [p for p in PACKETS if packet_states.get(p["id"]) == "merged"]
    # Group by PR for display
    pr_to_packets = {}
    for pkt in merged_packets:
        for pr in pkt["prs"]:
            pr_to_packets.setdefault(pr, []).append(pkt)

    # Deduplicate: show each unique PR group once
    seen_pr_groups = set()
    checkpoint_cards = []
    for pkt in merged_packets:
        pr_key = tuple(sorted(pkt["prs"])) if pkt["prs"] else (pkt["id"],)
        if pr_key in seen_pr_groups:
            continue
        seen_pr_groups.add(pr_key)
        pr_label = ", ".join(f"#{p}" for p in pkt["prs"]) if pkt["prs"] else "—"
        # If multiple packets share the same PR set, combine titles
        if pkt["prs"]:
            sibling_pkts = pr_to_packets.get(pkt["prs"][0], [pkt])
            if len(sibling_pkts) > 1 and len(pkt["prs"]) > 1:
                pkt_label = f'{sibling_pkts[0]["id"]}–{sibling_pkts[-1]["id"]}'
                title = sibling_pkts[0]["title"].split(" ")[0] + " foundation"
            else:
                pkt_label = pkt["id"]
                title = pkt["title"]
        else:
            pkt_label = pkt["id"]
            title = pkt["title"]

        checkpoint_cards.append(f'''<div class="mini-card">
        <div class="mini-top">{pill(pr_label, "merged")}{pill(pkt_label, "packet")}</div>
        <div class="mini-title">{title}</div>
    </div>''')

    checkpoints_html = "\n".join(checkpoint_cards)

    # Sequencing flow
    def flow_card(pkt, label, css):
        if pkt is None:
            return f'''<div class="flow-card">
            {pill(label, css)}
            <h3>TBD</h3>
            <p>No packet scoped yet.</p>
          </div>'''
        return f'''<div class="flow-card">
            {pill(label, css)}
            <h3>{pkt["id"]} — {pkt["title"]}</h3>
            <p>{"Merged and closed." if label == "Done" else "Scoped and ready." if label == "Now" else "Next in queue."}</p>
          </div>'''

    last_label = f'{last_merged["id"]} merged' if last_merged else "—"
    flow_html = f'''<div class="flow-row">
          {flow_card(last_merged, "Done", "merged")}
          <div class="arrow">→</div>
          {flow_card(current, "Now", "truth")}
          <div class="arrow">→</div>
          {flow_card(next_up, "Next", "audit")}
        </div>'''

    # Truth lane table
    truth_rows = []
    for pkt in PACKETS:
        if pkt["lane"] != "truth":
            continue
        state = packet_states.get(pkt["id"], "queued")
        if state == "merged":
            continue  # Don't show merged in the queue
        # Find which page
        page_name = "—"
        for pg in PAGES:
            if pkt["id"] in pg.get("packets", []):
                page_name = pg["name"]
                break
        state_label = "Ready now" if state == "open" or pkt == current else "Queued"
        if not pkt["prs"] and pkt.get("id", "").startswith("RP-") is False:
            state_label = "Unaudited"
        truth_rows.append(f'<tr><td><strong>{pkt["id"]}</strong></td><td>{page_name}</td><td>{pkt["title"]}</td><td>{state_label}</td></tr>')

    # Add unaudited pages that have no packets
    for pg in PAGES:
        if not pg["packets"] and pg["lane"] in ("Audit", "Audit/UI") and pg["name"] != "Hidden routes (24 total)":
            truth_rows.append(f'<tr><td><strong>Audit</strong></td><td>{pg["name"]}</td><td>Needs first audit</td><td>Unaudited</td></tr>')

    truth_table = "\n".join(truth_rows)

    # UI lane table
    ui_rows = []
    for pkt in PACKETS:
        if pkt["lane"] != "ui":
            continue
        state = packet_states.get(pkt["id"], "queued")
        if state == "merged":
            continue
        pages_list = ", ".join(pg["name"] for pg in PAGES if pkt["id"] in pg.get("packets", []))
        ui_rows.append(f'<tr><td><strong>{pkt["id"]}</strong></td><td>{pkt["title"].split("(")[0].strip()}</td><td>{pkt["title"]}</td><td>{pages_list or "—"}</td></tr>')

    ui_table = "\n".join(ui_rows)

    # Page detail data for modal popups
    pkt_by_id = {p["id"]: p for p in PACKETS}
    page_detail_data = {}
    for pg in PAGES:
        packets_detail = []
        for pid in pg.get("packets", []):
            pkt = pkt_by_id.get(pid)
            if not pkt:
                continue
            pkt_state = packet_states.get(pid, "queued")
            pr_nums = pkt.get("prs", [])
            pr_links = [{"num": n, "merged": n in {pr["number"] for pr in merged_prs}} for n in pr_nums]
            packets_detail.append({
                "id": pid,
                "title": pkt["title"],
                "lane": pkt["lane"],
                "state": pkt_state,
                "why": pkt.get("why", ""),
                "prs": pr_links,
            })
        page_detail_data[pg["name"]] = {
            "name": pg["name"],
            "route": pg["route"],
            "lane": pg["lane"],
            "focus": pg["focus"],
            "next": pg["next"],
            "status": page_states.get(pg["name"], "NOT YET"),
            "packets": packets_detail,
        }

    page_detail_json = json.dumps(page_detail_data, indent=None)

    # Page-by-page table
    page_rows = []
    for pg in PAGES:
        status = page_states.get(pg["name"], "NOT YET")
        search_str = f'{pg["name"]} {pg["route"]} {pg["focus"]} {pg["next"]}'.lower()
        esc_name = pg["name"].replace("'", "\\'")
        page_rows.append(f'''<tr data-status="{status}" data-lane="{pg["lane"]}" data-search="{search_str}" class="page-row" onclick="showPageDetail('{esc_name}')">
      <td><strong>{pg["name"]}</strong><div class="route">{pg["route"]}</div></td>
      <td>{status_pill(status)}</td>
      <td>{lane_pill(pg["lane"])}</td>
      <td>{pg["focus"]}</td>
      <td>{pg["next"]}</td>
    </tr>''')

    pages_table = "\n".join(page_rows)

    # Open PRs section
    open_pr_rows = []
    for pr in open_prs:
        num = pr.get("number", "?")
        title = pr.get("title", "")
        branch = pr.get("headRefName", "")
        review = pr.get("reviewDecision", "")
        review_pill = pill("Approved", "merged") if review == "APPROVED" else pill("Pending", "neutral")
        open_pr_rows.append(f'<tr><td>#{num}</td><td>{title}</td><td><code>{branch}</code></td><td>{review_pill}</td></tr>')

    open_prs_html = "\n".join(open_pr_rows) if open_pr_rows else '<tr><td colspan="4" style="color:var(--muted)">No open PRs</td></tr>'

    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>FMD Packet Command Center</title>
<!-- AUTO-GENERATED by scripts/update_command_center.py — do not hand-edit -->
<!-- Last updated: {now} -->
<style>
:root {{
  --bg:#0f1115; --panel:#151922; --panel2:#1b2230; --line:rgba(255,255,255,.08);
  --ink:#f4f6fa; --muted:#a6afbd; --muted2:#7f8998;
  --green:#4ec47d; --greenbg:rgba(78,196,125,.14);
  --amber:#f0b24b; --amberbg:rgba(240,178,75,.14);
  --red:#f06f5b; --redbg:rgba(240,111,91,.14);
  --blue:#63a8ff; --bluebg:rgba(99,168,255,.14);
  --purple:#a987ff; --purplebg:rgba(169,135,255,.14);
  --teal:#57d0c9; --tealbg:rgba(87,208,201,.14);
  --copper:#d88a57; --copperbg:rgba(216,138,87,.14);
}}
* {{ box-sizing:border-box; }}
body {{
  margin:0; color:var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  background:
    radial-gradient(circle at top right, rgba(99,168,255,.08), transparent 28%),
    radial-gradient(circle at top left, rgba(87,208,201,.06), transparent 24%),
    var(--bg);
}}
.wrap {{ max-width:1600px; margin:0 auto; padding:26px; }}
.hero, .section {{
  background:linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.015));
  border:1px solid var(--line); border-radius:22px;
}}
.hero {{ padding:24px; }}
.section {{ margin-top:18px; padding:18px; }}
.kicker {{ font-size:12px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); margin-bottom:10px; }}
h1 {{ margin:0 0 10px; font-size:36px; line-height:1.04; }}
h2 {{ margin:0 0 12px; font-size:22px; }}
.subtitle {{ color:var(--muted); max-width:1050px; line-height:1.65; font-size:14px; }}
.hero-grid {{ display:grid; grid-template-columns: 1.15fr .85fr; gap:18px; }}
.hero-right {{ display:grid; gap:12px; }}
.signal {{
  background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:14px;
}}
.signal strong {{ display:block; font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:6px; }}
.signal span {{ font-size:14px; line-height:1.55; }}
.metrics {{
  display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:12px; margin-top:18px;
}}
.metric {{
  background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:16px;
}}
.metric .label {{ font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:6px; }}
.metric .value {{ font-size:30px; font-weight:760; line-height:1.04; }}
.metric .hint {{ margin-top:6px; color:var(--muted2); font-size:12px; line-height:1.5; }}
.tri-band {{
  display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin-top:18px;
}}
.band {{
  background:var(--panel); border:1px solid var(--line); border-radius:18px; padding:16px;
}}
.band-head {{ display:flex; justify-content:space-between; align-items:end; gap:10px; margin-bottom:10px; }}
.band h3 {{ margin:0; font-size:17px; }}
.band .ratio {{ font-size:14px; color:var(--muted); }}
.bar {{ height:14px; background:#0f1320; border:1px solid var(--line); border-radius:999px; overflow:hidden; }}
.fill {{ height:100%; border-radius:999px; }}
.band p {{ color:var(--muted); font-size:13px; line-height:1.55; margin:8px 0 0; }}
.grid-2 {{ display:grid; grid-template-columns: 1fr 1fr; gap:18px; }}
.grid-3 {{ display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:14px; }}
.mini-grid {{ display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:12px; }}
.mini-card, .track-card, .flow-card {{
  background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:14px;
}}
.mini-top, .track-top {{ display:flex; justify-content:space-between; gap:8px; align-items:center; margin-bottom:10px; }}
.mini-title {{ font-size:15px; font-weight:700; }}
.track-card h3 {{ margin:0 0 8px; font-size:18px; }}
.track-card p {{ margin:0; color:var(--muted); font-size:13px; line-height:1.55; }}
.flow-row {{
  display:grid; grid-template-columns: 1fr 60px 1fr 60px 1fr; gap:10px; align-items:stretch;
}}
.arrow {{
  display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:28px;
}}
.callout {{
  margin-top:14px; background:rgba(99,168,255,.08); border:1px solid rgba(99,168,255,.18); border-radius:14px; padding:14px; font-size:13px; line-height:1.65;
}}
.pill {{
  display:inline-flex; align-items:center; padding:4px 9px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
}}
.packetized {{ color:var(--green); background:var(--greenbg); }}
.partial {{ color:var(--amber); background:var(--amberbg); }}
.notyet {{ color:var(--red); background:var(--redbg); }}
.mixed {{ color:var(--blue); background:var(--bluebg); }}
.truth {{ color:var(--blue); background:var(--bluebg); }}
.ui {{ color:var(--purple); background:var(--purplebg); }}
.audit {{ color:var(--amber); background:var(--amberbg); }}
.gold {{ color:var(--teal); background:var(--tealbg); }}
.neutral {{ color:var(--muted); background:rgba(255,255,255,.06); }}
.packet {{ color:var(--teal); background:var(--tealbg); }}
.merged {{ color:var(--green); background:var(--greenbg); }}
.route {{ color:var(--muted2); font-size:12px; margin-top:3px; }}
.controls {{ display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; }}
input, select {{
  background:var(--panel2); color:var(--ink); border:1px solid var(--line); border-radius:12px; padding:10px 12px; font-size:13px;
}}
table {{ width:100%; border-collapse:collapse; }}
th, td {{ padding:10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; font-size:13px; }}
th {{ font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); background:rgba(255,255,255,.03); }}
ul {{ margin:8px 0 0 18px; padding:0; }}
li {{ margin:6px 0; color:var(--muted); }}
code {{ background:var(--panel2); padding:2px 6px; border-radius:6px; font-size:12px; }}
.footer-note {{ margin-top:14px; font-size:12px; color:var(--muted); line-height:1.7; }}
.timestamp {{ text-align:right; font-size:11px; color:var(--muted2); margin-top:6px; }}
.page-row {{ cursor:pointer; transition:background .15s; }}
.page-row:hover {{ background:rgba(255,255,255,.04); }}
/* ── Modal ── */
.modal-overlay {{
  position:fixed; inset:0; z-index:1000; background:rgba(0,0,0,.65); backdrop-filter:blur(6px);
  display:none; align-items:center; justify-content:center; padding:24px;
}}
.modal-overlay.active {{ display:flex; }}
.modal {{
  background:var(--panel); border:1px solid var(--line); border-radius:22px;
  width:100%; max-width:720px; max-height:85vh; overflow-y:auto;
  padding:28px; position:relative;
  box-shadow: 0 24px 80px rgba(0,0,0,.5);
}}
.modal-close {{
  position:absolute; top:16px; right:18px; background:none; border:none; color:var(--muted);
  font-size:22px; cursor:pointer; padding:4px 8px; border-radius:8px; transition:color .15s, background .15s;
}}
.modal-close:hover {{ color:var(--ink); background:rgba(255,255,255,.08); }}
.modal h2 {{ margin:0 0 4px; font-size:24px; }}
.modal .modal-route {{ color:var(--muted2); font-size:13px; font-family:monospace; margin-bottom:16px; }}
.modal .modal-meta {{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }}
.modal hr {{ border:none; border-top:1px solid var(--line); margin:18px 0; }}
.pkt-card {{
  background:var(--panel2); border:1px solid var(--line); border-radius:14px; padding:16px; margin-bottom:12px;
}}
.pkt-card-head {{ display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap; }}
.pkt-card-head h3 {{ margin:0; font-size:16px; font-weight:700; }}
.pkt-card .pkt-why {{
  color:var(--muted); font-size:13px; line-height:1.65; margin:0;
}}
.pkt-card .pkt-prs {{ margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; }}
.pkt-pr {{
  display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:8px;
  font-size:11px; font-weight:700; text-decoration:none;
}}
.pkt-pr.pr-merged {{ color:var(--green); background:var(--greenbg); }}
.pkt-pr.pr-open {{ color:var(--amber); background:var(--amberbg); }}
.modal .empty-state {{ color:var(--muted2); font-size:14px; padding:20px 0; text-align:center; }}
@media (max-width: 1280px) {{
  .hero-grid, .grid-2, .grid-3, .mini-grid, .flow-row {{ grid-template-columns: 1fr; }}
  .arrow {{ display:none; }}
  .metrics, .tri-band {{ grid-template-columns: repeat(2, minmax(0,1fr)); }}
}}
@media (max-width: 760px) {{
  .metrics, .tri-band {{ grid-template-columns: 1fr; }}
  .wrap {{ padding:16px; }}
}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div class="hero-grid">
      <div>
        <div class="kicker">Executive dashboard</div>
        <h1>FMD Packet Command Center</h1>
        <div class="subtitle">
          Auto-generated from live GitHub PR state. Separates <strong>route coverage</strong> from <strong>packet lane progress</strong>.
          Truth lane packets fix correctness; UI lane packets fix tokens and design-system compliance.
        </div>
        <div class="timestamp">Last regenerated: {now}</div>
      </div>
      <div class="hero-right">
        <div class="signal">
          <strong>In progress</strong>
          <span>{"<strong>" + current["id"] + ": " + current["title"] + "</strong>" if current else "All scoped truth packets are merged."}</span>
        </div>
        <div class="signal">
          <strong>Why this matters</strong>
          <span>{current.get("why", "No active packet.") if current else "No active packet — all scoped truth work is merged."}</span>
        </div>
        <div class="signal">
          <strong>What comes next</strong>
          <span>{"<strong>" + next_up["id"] + ":</strong> " + next_up.get("why", next_up["title"]) if next_up else "No further packets scoped yet."}</span>
        </div>
      </div>
    </div>

    <div class="metrics">
      <div class="metric"><div class="label">Total routes</div><div class="value">{m["total_routes"]}</div><div class="hint">Engineering, portal, and hidden routes combined.</div></div>
      <div class="metric"><div class="label">Merged truth packets</div><div class="value" style="color:var(--blue)">{m["merged_truth"]}</div><div class="hint">RP packets merged to main.</div></div>
      <div class="metric"><div class="label">Open truth candidates</div><div class="value" style="color:var(--amber)">{m["open_truth"]}</div><div class="hint">Remaining truth/workflow queue.</div></div>
      <div class="metric"><div class="label">Open UI candidates</div><div class="value" style="color:var(--purple)">{m["open_ui"]}</div><div class="hint">UI/token cleanup queue.</div></div>
    </div>

    <div class="tri-band">
      <div class="band">
        <div class="band-head"><h3>Fully packetized routes</h3><div class="ratio">{m["packetized"]} / {m["total_routes"]} &bull; {m["pct_packetized"]}%</div></div>
        <div class="bar"><div class="fill" style="width:{m["pct_packetized"]}%; background:linear-gradient(90deg,var(--green),#7be5a3)"></div></div>
        <p>Routes that have gone through audit → packet → PR → merged.</p>
      </div>
      <div class="band">
        <div class="band-head"><h3>Touched coverage</h3><div class="ratio">{m["touched"]} / {m["total_routes"]} &bull; {m["pct_touched"]}%</div></div>
        <div class="bar"><div class="fill" style="width:{m["pct_touched"]}%; background:linear-gradient(90deg,var(--amber),#ffd37f)"></div></div>
        <p>Packetized plus partially covered. Useful but not the same as done.</p>
      </div>
      <div class="band">
        <div class="band-head"><h3>Still not yet packetized</h3><div class="ratio">{m["not_yet"]} / {m["total_routes"]} &bull; {m["pct_not_yet"]}%</div></div>
        <div class="bar"><div class="fill" style="width:{m["pct_not_yet"]}%; background:linear-gradient(90deg,var(--red),#ff9a87)"></div></div>
        <p>Routes still needing first audit or first packet pass.</p>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>What is done vs what is next</h2>
    <div class="grid-2">
      <div>
        <div class="kicker">Merged checkpoint trail</div>
        <div class="mini-grid">
          {checkpoints_html}
        </div>
      </div>
      <div>
        <div class="kicker">Immediate sequencing</div>
        {flow_html}
        <div class="callout">
          <strong>Do not jump to UI cleanup by default.</strong><br/>
          Close the next truth packet first, then start the dedicated UI lane with <strong>UP-01 — Font token cleanup</strong>.
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Open pull requests</h2>
    <table>
      <thead><tr><th>PR</th><th>Title</th><th>Branch</th><th>Review</th></tr></thead>
      <tbody>{open_prs_html}</tbody>
    </table>
  </div>

  <div class="grid-2">
    <div class="section">
      <h2>Truth lane queue</h2>
      <div style="color:var(--muted); font-size:13px; line-height:1.55; margin-bottom:12px;">
        Packets affecting correctness, real workflows, broken endpoints, state, and source-of-truth behavior.
      </div>
      <table>
        <thead><tr><th>Packet</th><th>Page</th><th>Issue</th><th>State</th></tr></thead>
        <tbody>{truth_table}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>UI lane queue</h2>
      <div style="color:var(--muted); font-size:13px; line-height:1.55; margin-bottom:12px;">
        Packets affecting fonts, colors, tokens, spacing, charts, and design-system compliance.
      </div>
      <table>
        <thead><tr><th>Packet</th><th>Scope</th><th>Issue</th><th>Pages</th></tr></thead>
        <tbody>{ui_table}</tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <h2>Page-by-page map</h2>
    <div class="controls">
      <input id="search" type="text" placeholder="Search by page, route, focus, or next step..."/>
      <select id="statusFilter">
        <option value="ALL">All statuses</option>
        <option value="PACKETIZED">Packetized</option>
        <option value="PARTIALLY">Partially</option>
        <option value="NOT YET">Not yet</option>
        <option value="MIXED">Mixed</option>
      </select>
      <select id="laneFilter">
        <option value="ALL">All lanes</option>
        <option value="Truth">Truth</option>
        <option value="UI">UI</option>
        <option value="Audit">Audit</option>
        <option value="Gold">Gold</option>
        <option value="Truth/UI">Truth/UI</option>
        <option value="Audit/UI">Audit/UI</option>
      </select>
    </div>
    <table id="pagesTable">
      <thead>
        <tr>
          <th>Page</th>
          <th>Status</th>
          <th>Lane</th>
          <th>Current focus</th>
          <th>Next step</th>
        </tr>
      </thead>
      <tbody>
        {pages_table}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>What has to happen before 100% covered</h2>
    <ul>
      <li>Every route must be at least audited. Census currently shows {m["not_yet"]} of {m["total_routes"]} routes as NOT YET.</li>
      <li>All remaining truth/workflow candidates must be repaired, merged, or consciously waived with docs updated.</li>
      <li>All UI/token candidates must be resolved or explicitly accepted as design debt.</li>
      <li>Hidden routes cannot stay a blind spot.</li>
      <li>The census, truth audit, and decisions log must be refreshed after each major packet lane closes.</li>
    </ul>
    <div class="footer-note">
      Current system state: <strong>{m["pct_packetized"]}% fully packetized route coverage</strong>.
      {m["merged_truth"]} truth packets merged, {m["open_truth"]} remaining. {m["open_ui"]} UI packets queued.
    </div>
  </div>
</div>

<!-- Page detail modal -->
<div class="modal-overlay" id="pageModal" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()" title="Close">&times;</button>
    <div id="modalContent"></div>
  </div>
</div>

<script>
const search = document.getElementById('search');
const statusFilter = document.getElementById('statusFilter');
const laneFilter = document.getElementById('laneFilter');
const rows = Array.from(document.querySelectorAll('#pagesTable tbody tr'));

function applyFilters() {{
  const q = (search.value || '').toLowerCase().trim();
  const sf = statusFilter.value;
  const lf = laneFilter.value;
  rows.forEach(row => {{
    const text = row.dataset.search || '';
    const status = row.dataset.status || '';
    const lane = row.dataset.lane || '';
    const matchSearch = !q || text.includes(q);
    const matchStatus = sf === 'ALL' || status === sf;
    const matchLane = lf === 'ALL' || lane === lf;
    row.style.display = (matchSearch && matchStatus && matchLane) ? '' : 'none';
  }});
}}
search.addEventListener('input', applyFilters);
statusFilter.addEventListener('change', applyFilters);
laneFilter.addEventListener('change', applyFilters);

/* ── Page detail modal ── */
const PAGE_DATA = {page_detail_json};

function pillHtml(label, cls) {{
  return '<span class="pill ' + cls + '">' + label + '</span>';
}}

function statusClass(s) {{
  return {{PACKETIZED:'packetized',PARTIALLY:'partial','NOT YET':'notyet',MIXED:'mixed'}}[s] || 'neutral';
}}

function laneClass(l) {{
  return {{Truth:'truth',UI:'ui',Audit:'audit',Gold:'gold','Truth/UI':'truth','Audit/UI':'ui'}}[l] || 'neutral';
}}

function pktStateClass(s) {{
  return {{merged:'merged',open:'truth',queued:'neutral'}}[s] || 'neutral';
}}

function pktStateLabel(s) {{
  return {{merged:'Merged',open:'Open PR',queued:'Queued'}}[s] || s;
}}

function showPageDetail(name) {{
  const pg = PAGE_DATA[name];
  if (!pg) return;

  let html = '<h2>' + pg.name + '</h2>';
  html += '<div class="modal-route">' + pg.route + '</div>';
  html += '<div class="modal-meta">';
  html += pillHtml(pg.status, statusClass(pg.status));
  html += pillHtml(pg.lane, laneClass(pg.lane));
  html += '</div>';

  html += '<table style="margin-bottom:4px"><tbody>';
  html += '<tr><td style="width:120px;color:var(--muted);font-weight:600">Current focus</td><td>' + pg.focus + '</td></tr>';
  html += '<tr><td style="color:var(--muted);font-weight:600">Next step</td><td>' + pg.next + '</td></tr>';
  html += '</tbody></table>';

  html += '<hr>';

  if (pg.packets.length === 0) {{
    html += '<div class="empty-state">No packets have touched this page yet.</div>';
  }} else {{
    html += '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:12px">'
          + pg.packets.length + ' packet' + (pg.packets.length !== 1 ? 's' : '') + ' applied</div>';

    pg.packets.forEach(function(pkt) {{
      html += '<div class="pkt-card">';
      html += '<div class="pkt-card-head">';
      html += '<h3>' + pkt.id + '</h3>';
      html += '<div style="display:flex;gap:6px">';
      html += pillHtml(pkt.lane === 'truth' ? 'Truth' : 'UI', pkt.lane === 'truth' ? 'truth' : 'ui');
      html += pillHtml(pktStateLabel(pkt.state), pktStateClass(pkt.state));
      html += '</div></div>';

      html += '<div style="font-size:14px;font-weight:600;margin-bottom:6px;color:var(--ink)">' + pkt.title + '</div>';

      if (pkt.why) {{
        html += '<p class="pkt-why">' + pkt.why + '</p>';
      }}

      if (pkt.prs && pkt.prs.length > 0) {{
        html += '<div class="pkt-prs">';
        pkt.prs.forEach(function(pr) {{
          const cls = pr.merged ? 'pr-merged' : 'pr-open';
          const icon = pr.merged ? '&#10003; ' : '&#9679; ';
          html += '<span class="pkt-pr ' + cls + '">' + icon + 'PR #' + pr.num + '</span>';
        }});
        html += '</div>';
      }}

      html += '</div>';
    }});
  }}

  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('pageModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}}

function closeModal() {{
  document.getElementById('pageModal').classList.remove('active');
  document.body.style.overflow = '';
}}

document.addEventListener('keydown', function(e) {{
  if (e.key === 'Escape') closeModal();
}});
</script>
</body>
</html>'''


# ──────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────

def main():
    print("Fetching PR state from GitHub...")
    merged_prs, open_prs = get_pr_state()
    print(f"  {len(merged_prs)} merged, {len(open_prs)} open")

    packet_states, page_states = compute_state(merged_prs, open_prs)
    metrics = compute_metrics(packet_states, page_states)
    seq = find_current_sequence(packet_states)

    html = generate_html(metrics, packet_states, page_states, merged_prs, open_prs, seq)

    OUTPUT.write_text(html, encoding="utf-8")
    print(f"Dashboard written to {OUTPUT}")
    print(f"  Routes: {metrics['total_routes']} total, {metrics['packetized']} packetized ({metrics['pct_packetized']}%)")
    print(f"  Truth: {metrics['merged_truth']} merged, {metrics['open_truth']} remaining")
    print(f"  UI: {metrics['open_ui']} queued")


if __name__ == "__main__":
    main()
