const BASE = "http://127.0.0.1:3200/api";
const COMPANY = "ab7025c3-7ed0-42eb-b2c6-e1db6dcf4ab3";

const REASONS = {
  "Architect": "Launch: Review state, create tasks for all domain leads.",
  "Engine Lead": "Launch: Pick up engine tasks from backlog.",
  "API Lead": "Launch: Review and fix API endpoints.",
  "Frontend Lead": "Launch: Dashboard build verification, fix broken pages.",
  "Fabric Engineer": "Launch: Continue Bronze/Silver activation verification.",
  "DevOps Lead": "Launch: Deploy script dry-run on vsc-fabric.",
  "QA Lead": "Launch: Define test strategy, coordinate QA Engineer.",
  "QA Engineer": "Launch: Set up Playwright E2E, write tests.",
};

async function main() {
  const agents = await fetch(`${BASE}/companies/${COMPANY}/agents`).then(r => r.json());
  const active = agents.filter(a => a.status !== "terminated");

  // Step 1: Reset all agents from error to idle
  console.log("=== Resetting agents to idle ===\n");
  for (const a of active) {
    if (a.status === "error") {
      const res = await fetch(`${BASE}/agents/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "idle" })
      });
      console.log(`  ${a.name.padEnd(20)} | error → idle | ${res.status}`);
    } else {
      console.log(`  ${a.name.padEnd(20)} | already ${a.status}`);
    }
  }

  // Step 2: Wake all agents
  console.log("\n=== Waking all agents ===\n");
  for (const a of active) {
    const reason = REASONS[a.name] || "Launch: Check backlog and start working.";
    const res = await fetch(`${BASE}/agents/${a.id}/wakeup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "on_demand", reason })
    });
    const data = await res.json().catch(() => ({}));
    console.log(`  ${a.name.padEnd(20)} | ${res.status} | ${data.status || "?"} | run: ${(data.id || "").slice(0,8)}`);
  }

  console.log("\n=== Done ===");
}

main().catch(e => console.error(e));
