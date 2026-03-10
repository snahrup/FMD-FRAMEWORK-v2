const BASE = "http://127.0.0.1:3200/api";
const CO = "ab7025c3-7ed0-42eb-b2c6-e1db6dcf4ab3";

async function main() {
  const agents = await fetch(`${BASE}/companies/${CO}/agents`).then(r => r.json());
  const agentMap = Object.fromEntries(agents.map(a => [a.id, a]));

  // Use company-wide endpoint
  const runs = await fetch(`${BASE}/companies/${CO}/heartbeat-runs?limit=20`).then(r => r.json()).catch(() => []);
  console.log(`${runs.length} recent runs\n`);

  for (const r of runs.slice(0, 10)) {
    const agent = agentMap[r.agentId];
    const name = agent?.name || r.agentId.slice(0,8);
    console.log(`=== ${name} | ${r.status} | exit: ${r.exitCode} ===`);
    if (r.error) console.log(`  error: ${r.error.slice(0, 500)}`);
    if (r.stderrExcerpt) console.log(`  stderr: ${r.stderrExcerpt.slice(0, 500)}`);
    if (r.errorCode) console.log(`  errorCode: ${r.errorCode}`);
    if (r.errorMeta) console.log(`  errorMeta: ${JSON.stringify(r.errorMeta)}`);
    console.log();
  }
}

main().catch(e => console.error(e));
