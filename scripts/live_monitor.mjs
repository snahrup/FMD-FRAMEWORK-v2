const BASE = "http://127.0.0.1:3200/api";
const COMPANY = "ab7025c3-7ed0-42eb-b2c6-e1db6dcf4ab3";

const ICONS = {
  running: "🟢", idle: "⚪", error: "🔴", queued: "🟡",
  succeeded: "✅", failed: "❌", paused: "⏸️"
};

function ago(ts) {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

async function poll() {
  try {
    const [agents, activity, runs] = await Promise.all([
      fetch(`${BASE}/companies/${COMPANY}/agents`).then(r => r.json()),
      fetch(`${BASE}/companies/${COMPANY}/activity?limit=15`).then(r => r.json()).catch(() => []),
      fetch(`${BASE}/companies/${COMPANY}/heartbeat-runs?limit=16`).then(r => r.json()).catch(() => []),
    ]);

    const active = agents.filter(a => a.status !== "terminated");
    const agentMap = Object.fromEntries(active.map(a => [a.id, a]));

    // Clear screen
    process.stdout.write("\x1b[2J\x1b[H");

    console.log("\x1b[36m╔══════════════════════════════════════════════════════════════════╗\x1b[0m");
    console.log("\x1b[36m║\x1b[0m  \x1b[1m\x1b[33mFMD AGENT TEAM — LIVE MONITOR\x1b[0m          " + new Date().toLocaleTimeString() + "  \x1b[36m║\x1b[0m");
    console.log("\x1b[36m╚══════════════════════════════════════════════════════════════════╝\x1b[0m\n");

    // Agent status
    console.log("\x1b[1m AGENTS\x1b[0m\n");
    for (const a of active) {
      const icon = ICONS[a.status] || "❓";
      const hb = ago(a.lastHeartbeatAt);
      const spent = a.spentMonthlyCents ? `$${(a.spentMonthlyCents/100).toFixed(2)}` : "$0.00";
      console.log(`  ${icon} ${a.name.padEnd(20)} ${a.status.padEnd(10)} HB: ${hb.padEnd(10)} Spent: ${spent}`);
    }

    // Recent runs
    const recentRuns = runs.filter(r => {
      const a = agentMap[r.agentId];
      return a && (r.status === "running" || r.status === "queued");
    });

    if (recentRuns.length > 0) {
      console.log("\n\x1b[1m ACTIVE RUNS\x1b[0m\n");
      for (const r of recentRuns.slice(0, 8)) {
        const agent = agentMap[r.agentId];
        const name = agent?.name || r.agentId.slice(0,8);
        const dur = r.startedAt ? ago(r.startedAt).replace(' ago','') : "queued";
        console.log(`  ${ICONS[r.status]} ${name.padEnd(20)} running for ${dur}`);
      }
    }

    // Activity feed
    if (Array.isArray(activity) && activity.length > 0) {
      console.log("\n\x1b[1m ACTIVITY FEED\x1b[0m\n");
      for (const ev of activity.slice(0, 12)) {
        const who = ev.actorType === "agent" ? (agentMap[ev.actorId]?.name || "agent") : "board";
        const when = ago(ev.createdAt);
        const action = ev.action || "unknown";
        const detail = ev.details?.title || ev.details?.status || ev.details?.reason || "";
        console.log(`  \x1b[2m${when.padEnd(10)}\x1b[0m ${who.padEnd(18)} \x1b[33m${action.padEnd(25)}\x1b[0m ${detail.slice(0, 50)}`);
      }
    }

    // Issues
    const issues = await fetch(`${BASE}/companies/${COMPANY}/issues?limit=20`).then(r => r.json()).catch(() => []);
    if (Array.isArray(issues) && issues.length > 0) {
      console.log("\n\x1b[1m ISSUES\x1b[0m\n");
      const statusIcon = { done: "✅", in_progress: "🔧", backlog: "📋", todo: "📝", blocked: "🚫" };
      for (const iss of issues) {
        const assignee = iss.assigneeAgentId ? (agentMap[iss.assigneeAgentId]?.name || "?") : "unassigned";
        const icon = statusIcon[iss.status] || "❓";
        console.log(`  ${icon} ${(iss.identifier || "").padEnd(6)} ${iss.title?.slice(0, 40).padEnd(42)} ${assignee.padEnd(18)} ${iss.status}`);
      }
    }

    console.log("\n\x1b[2m  Refreshing every 5s... Ctrl+C to stop\x1b[0m");
  } catch (e) {
    console.error("Monitor error:", e.message);
  }
}

// Run immediately, then every 5s
poll();
setInterval(poll, 5000);
