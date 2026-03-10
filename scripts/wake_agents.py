"""Wake FMD_FRAMEWORK agents via Paperclip API."""
import json
import urllib.request

BASE = "http://127.0.0.1:3200/api"
COMPANY_ID = "ab7025c3-7ed0-42eb-b2c6-e1db6dcf4ab3"


def api_get(path):
    req = urllib.request.Request(f"{BASE}{path}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def api_post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def main():
    # 1. List agents
    agents = api_get(f"/companies/{COMPANY_ID}/agents")
    active = [a for a in agents if a.get("status") != "terminated"]

    print(f"\n=== {len(active)} Active Agents ===")
    for a in active:
        print(f"  {a['name']:20s} | {a['status']:10s} | {a['id']}")

    # 2. Find CTO (Architect)
    cto = next((a for a in active if a["name"] == "Architect"), None)
    if not cto:
        print("ERROR: Architect (CTO) agent not found!")
        return

    print(f"\n=== Waking CTO: {cto['name']} ({cto['id']}) ===")
    result = api_post(f"/agents/{cto['id']}/wakeup", {
        "source": "on_demand",
        "reason": "Launch sequence: Review project state, decompose backlog into tasks for domain leads.",
        "idempotencyKey": "fmd-launch-cto-2026-03-09"
    })
    print(f"Wakeup response: {json.dumps(result, indent=2)}")


if __name__ == "__main__":
    main()
