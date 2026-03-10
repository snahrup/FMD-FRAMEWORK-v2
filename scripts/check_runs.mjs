const BASE = "http://127.0.0.1:3200/api";
const COMPANY = "ab7025c3-7ed0-42eb-b2c6-e1db6dcf4ab3";

async function main() {
  const agents = await fetch(`${BASE}/companies/${COMPANY}/agents`).then(r => r.json());
  const active = agents.filter(a => a.status !== "terminated");

  console.log("=== Agent Status ===\n");
  for (const a of active) {
    console.log(`${a.name.padEnd(20)} | status: ${a.status.padEnd(10)} | lastHB: ${a.lastHeartbeatAt || "never"}`);
  }

  // Get recent heartbeat runs
  const runs = await fetch(`${BASE}/companies/${COMPANY}/heartbeat-runs?limit=20`).then(r => r.json()).catch(() => []);

  if (runs.length) {
    console.log("\n=== Recent Runs ===\n");
    for (const r of runs.slice(0, 16)) {
      const agent = active.find(a => a.id === r.agentId);
      const name = agent?.name || r.agentId.slice(0,8);
      const err = r.error ? r.error.slice(0, 120) : "";
      const stderr = r.stderrExcerpt ? r.stderrExcerpt.slice(0, 120) : "";
      console.log(`${name.padEnd(20)} | ${r.status.padEnd(10)} | exit: ${r.exitCode ?? "?"} | err: ${err || stderr || "none"}`);
    }
  } else {
    // Try individual agent runs
    console.log("\n=== Checking runs per agent ===\n");
    for (const a of active) {
      const aruns = await fetch(`${BASE}/agents/${a.id}/heartbeat-runs?limit=2`).then(r=>r.json()).catch(()=>[]);
      if (aruns.length) {
        const r = aruns[0];
        const err = r.error ? r.error.slice(0, 150) : "";
        const stderr = r.stderrExcerpt ? r.stderrExcerpt.slice(0, 150) : "";
        console.log(`${a.name.padEnd(20)} | ${r.status.padEnd(10)} | exit: ${r.exitCode ?? "?"} | err: ${err || stderr || "none"}`);
      } else {
        console.log(`${a.name.padEnd(20)} | no runs found`);
      }
    }
  }
}

main().catch(e => console.error(e));
