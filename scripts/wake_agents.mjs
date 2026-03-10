const BASE = "http://127.0.0.1:3200/api";
const COMPANY = "ab7025c3-7ed0-42eb-b2c6-e1db6dcf4ab3";

async function main() {
  const agents = await fetch(`${BASE}/companies/${COMPANY}/agents`).then(r => r.json());
  const active = agents.filter(a => a.status !== "terminated");

  console.log(`\n=== ${active.length} Active Agents ===`);
  for (const a of active) {
    console.log(`  ${a.name.padEnd(20)} | ${a.status.padEnd(10)} | ${a.id}`);
  }

  const cto = active.find(a => a.name === "Architect");
  if (!cto) { console.error("ERROR: Architect not found"); return; }

  console.log(`\n=== Waking CTO: ${cto.name} (${cto.id}) ===`);
  const res = await fetch(`${BASE}/agents/${cto.id}/wakeup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "on_demand",
      reason: "Launch: Review state, create tasks for all domain leads, then wake team."
    })
  });
  const data = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`Response: ${data}`);
}

main().catch(e => console.error(e));
