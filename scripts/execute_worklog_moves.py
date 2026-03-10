"""
Execute all worklog moves via Jira REST API.
Reads moves from worklog_moves.json and PUTs each one.
"""
import json
import os
import sys
import time
import urllib.request
import base64

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JIRA_URL = "https://ip-corporation.atlassian.net/rest/api/3"
AUTH = base64.b64encode(b"snahrup@ip-corporation.com:ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6").decode()

with open(os.path.join(SCRIPT_DIR, 'worklog_moves.json')) as f:
    moves = json.load(f)

print(f"Executing {len(moves)} worklog moves...")
success = 0
failed = 0

for i, move in enumerate(moves):
    url = f"{JIRA_URL}/issue/{move['key']}/worklog/{move['worklog_id']}"
    body = json.dumps({
        "started": move['new_started'],
        "timeSpentSeconds": move['seconds']
    }).encode('utf-8')

    req = urllib.request.Request(url, data=body, method='PUT')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', f'Basic {AUTH}')

    try:
        resp = urllib.request.urlopen(req)
        status = resp.getcode()
        if status == 200:
            success += 1
            print(f"  [{i+1}/{len(moves)}] OK  {move['key']} wid={move['worklog_id']} {move['old_date']} -> {move['new_date']} ({move['hours']}h)")
        else:
            failed += 1
            print(f"  [{i+1}/{len(moves)}] {status} {move['key']} wid={move['worklog_id']}")
    except urllib.error.HTTPError as e:
        failed += 1
        err_body = e.read().decode('utf-8', errors='replace')[:200]
        print(f"  [{i+1}/{len(moves)}] FAIL {e.code} {move['key']} wid={move['worklog_id']}: {err_body}")
    except Exception as e:
        failed += 1
        print(f"  [{i+1}/{len(moves)}] ERR  {move['key']} wid={move['worklog_id']}: {str(e)[:100]}")

    # Small delay to avoid rate limiting
    if (i + 1) % 10 == 0:
        time.sleep(0.5)

print(f"\nDone: {success} success, {failed} failed out of {len(moves)}")
