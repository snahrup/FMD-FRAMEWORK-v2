const BASE = "http://127.0.0.1:3200/api";
const COMPANY = "ab7025c3-7ed0-42eb-b2c6-e1db6dcf4ab3";

const WAKE_REASONS = {
  "Architect": "Launch: Review state, create tasks for all domain leads. You are CTO.",
  "Engine Lead": "Launch: Check backlog for engine tasks. Pick up IPC-3 (load optimization) if available.",
  "API Lead": "Launch: Check backlog for API tasks. Review server.py endpoints, fix issues found.",
  "Frontend Lead": "Launch: Check backlog for frontend tasks. Dashboard build verification, fix broken pages.",
  "Fabric Engineer": "Launch: Continue IPC-2 (Bronze/Silver activation). Verify notebook execution.",
  "DevOps Lead": "Launch: Pick up IPC-7 (deploy script dry-run on vsc-fabric). Validate deployment.",
  "QA Lead": "Launch: Pick up IPC-6 (engine unit tests). Define test strategy, coordinate with QA Engineer.",
  "QA Engineer": "Launch: Pick up IPC-5 (Playwright E2E setup). Write tests for critical paths.",
};

async function main() {
  const agents = await fetch(`${BASE}/companies/${COMPANY}/agents`).then(r => r.json());
  const active = agents.filter(a => a.status !== "terminated");

  console.log(`\n=== Waking ${active.length} agents ===\n`);

  for (const agent of active) {
    const reason = WAKE_REASONS[agent.name] || `Launch: Check backlog and start working.`;
    try {
      const res = await fetch(`${BASE}/agents/${agent.id}/wakeup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "on_demand", reason })
      });
      const data = await res.json();
      const status = data.status || "unknown";
      console.log(`  ✓ ${agent.name.padEnd(20)} | ${res.status} | run: ${data.id?.slice(0,8) || "n/a"} | ${status}`);
    } catch (e) {
      console.log(`  ✗ ${agent.name.padEnd(20)} | ERROR: ${e.message}`);
    }
  }

  console.log(`\n=== All agents woken ===`);
}

main().catch(e => console.error(e));
