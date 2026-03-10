const BASE = "http://127.0.0.1:3200/api";
const COMPANY = "ab7025c3-7ed0-42eb-b2c6-e1db6dcf4ab3";

async function main() {
  // Get current company settings
  const company = await fetch(`${BASE}/companies/${COMPANY}`).then(r => r.json());
  console.log("Company:", company.name);
  console.log("Current heartbeat config:", JSON.stringify(company.heartbeat || "not set"));

  // Update heartbeat maxConcurrentRuns to 10
  const res = await fetch(`${BASE}/companies/${COMPANY}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      heartbeat: {
        ...(company.heartbeat || {}),
        maxConcurrentRuns: 10
      }
    })
  });

  if (!res.ok) {
    console.log("PATCH status:", res.status);
    const text = await res.text();
    console.log("Response:", text);

    // Try alternative: check if there's a settings endpoint
    const settingsRes = await fetch(`${BASE}/companies/${COMPANY}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heartbeat: { maxConcurrentRuns: 10 } })
    }).catch(() => null);

    if (settingsRes) {
      console.log("Settings PATCH:", settingsRes.status);
      console.log(await settingsRes.text());
    }
  } else {
    const updated = await res.json();
    console.log("Updated heartbeat:", JSON.stringify(updated.heartbeat || "check response"));
    console.log("SUCCESS: maxConcurrentRuns set to 10");
  }

  // Verify
  const verify = await fetch(`${BASE}/companies/${COMPANY}`).then(r => r.json());
  console.log("\nVerification - heartbeat:", JSON.stringify(verify.heartbeat || "not set"));
}

main().catch(e => console.error(e));
