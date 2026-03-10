import urllib.request
import base64
import json

AUTH = base64.b64encode(b"snahrup@ip-corporation.com:ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6").decode()

for issue in ["MT-17", "MT-36", "MT-37", "MT-57"]:
    url = f"https://ip-corporation.atlassian.net/rest/api/3/issue/{issue}?fields=comment,timetracking,summary"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Basic {AUTH}")
    req.add_header("Content-Type", "application/json")
    resp = urllib.request.urlopen(req)
    d = json.loads(resp.read().decode())
    f = d.get("fields", {})
    comments = f.get("comment", {}).get("comments", [])
    tt = f.get("timetracking", {})
    last = comments[-1] if comments else {}
    print(f"{issue} | {f.get('summary','')[:55]}")
    print(f"  Comments: {len(comments)} | Last: {last.get('created','')[:19]}")
    print(f"  Time Spent: {tt.get('timeSpent','none')} | Remaining: {tt.get('remainingEstimate','none')}")
    print()
