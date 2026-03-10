import urllib.request
import urllib.parse
import json
import struct
import pyodbc
from datetime import datetime, timezone

TENANT = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
SECRET = "Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu"
WORKSPACE = "146fe38c-f6c3-4e9d-a18c-5c01cad5941e"
PIPELINE_ID = "3d0b3b2b-a069-40dc-b735-d105f9e66838"
JOB_ID = "34865624-2735-4803-a0c4-fb6def60a702"
SQL_SERVER = "7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433"
SQL_DB = "SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0"
TOTAL_EXPECTED = 596

def get_token(scope):
    url = "https://login.microsoftonline.com/" + TENANT + "/oauth2/v2.0/token"
    data = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": CLIENT, "client_secret": SECRET, "scope": scope}).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]

def check_pipeline():
    token = get_token("https://api.fabric.microsoft.com/.default")
    url = "https://api.fabric.microsoft.com/v1/workspaces/" + WORKSPACE + "/items/" + PIPELINE_ID + "/jobs/instances/" + JOB_ID
    req = urllib.request.Request(url)
    req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        return {"error": "HTTP " + str(e.code), "detail": body}

def check_sql():
    token = get_token("https://database.windows.net/.default")
    token_bytes = token.encode("utf-16-le")
    token_struct = struct.pack("<I" + str(len(token_bytes)) + "s", len(token_bytes), token_bytes)
    conn_str = "DRIVER={ODBC Driver 18 for SQL Server};SERVER=" + SQL_SERVER + ";DATABASE=" + SQL_DB + ";Encrypt=yes;TrustServerCertificate=no;"
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM execution.PipelineLandingzoneEntity PLE INNER JOIN integration.LandingzoneEntity LE ON PLE.LandingzoneEntityId = LE.LandingzoneEntityId WHERE LE.DataSourceId = 6")
    count = cursor.fetchone()[0]
    conn.close()
    return count

if __name__ == "__main__":
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    sep = "=" * 60
    print()
    print(sep)
    print("  M3 ERP Landing Zone Pipeline Progress Check")
    print("  " + now)
    print(sep)
    print()
    print("[1] Checking pipeline run status...")
    pdata = check_pipeline()
    if "error" in pdata:
        print("    Status: ERROR - " + pdata["error"])
        print("    Detail: " + pdata.get("detail", "")[:300])
    else:
        print("    Pipeline Job:  " + JOB_ID)
        print("    Status:        " + pdata.get("status", "Unknown"))
        print("    Start:         " + str(pdata.get("startTimeUtc", "?")))
        print("    End:           " + str(pdata.get("endTimeUtc", "?")))
        fail = pdata.get("failureReason")
        if fail:
            print("    Failure:       " + str(fail))
    print()
    print("[2] Checking M3 ERP (DS6) loaded LZ entities...")
    try:
        loaded = check_sql()
        pct = round((loaded / TOTAL_EXPECTED) * 100, 1)
        print("    Loaded:    " + str(loaded) + " / " + str(TOTAL_EXPECTED) + "  (" + str(pct) + "%)")
        remaining = TOTAL_EXPECTED - loaded
        if remaining > 0:
            print("    Remaining: " + str(remaining) + " entities")
        else:
            print("    COMPLETE - all entities loaded")
    except Exception as e:
        print("    SQL Error: " + str(e))
    print()
    print(sep)
    print()
