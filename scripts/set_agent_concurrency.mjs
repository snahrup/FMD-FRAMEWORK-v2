const BASE = "http://127.0.0.1:3200/api";
const COMPANY = "ab7025c3-7ed0-42eb-b2c6-e1db6dcf4ab3";

async function main() {
  const agents = await fetch(`${BASE}/companies/${COMPANY}/agents`).then(r => r.json());
  const active = agents.filter(a => a.status !== "terminated");

  console.log(`Updating ${active.length} agents to maxConcurrentRuns: 10\n`);

  for (const agent of active) {
    const rc = agent.runtimeConfig || {};
    const hb = rc.heartbeat || {};

    const newConfig = {
      ...rc,
      heartbeat: {
        ...hb,
        maxConcurrentRuns: 10,
        enabled: true,
        wakeOnDemand: true
      }
    };

    const res = await fetch(`${BASE}/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtimeConfig: newConfig })
    });

    if (res.ok) {
      const updated = await res.json();
      const maxRuns = updated.runtimeConfig?.heartbeat?.maxConcurrentRuns ?? "?";
      console.log(`  ✓ ${agent.name.padEnd(20)} | maxConcurrentRuns: ${maxRuns}`);
    } else {
      console.log(`  ✗ ${agent.name.padEnd(20)} | ${res.status}: ${(await res.text()).slice(0, 100)}`);
    }
  }

  console.log("\nDone.");
}

main().catch(e => console.error(e));
