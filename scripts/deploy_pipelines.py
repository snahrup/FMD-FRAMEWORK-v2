"""
Deploy all pipeline definitions to Fabric workspaces via REST API.
Replaces template IDs (from GitHub source) with real deployed IDs.
"""
import json
import os
import sys
import base64
import urllib.request
import urllib.error
import time

# ── Auth ──
TENANT_ID = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID = "ac937c5d-4bdd-438f-be8b-84a850021d2d"

def get_client_secret():
    env_path = os.path.join(os.path.dirname(__file__), "..", "dashboard", "app", "api", ".env")
    with open(env_path) as f:
        for line in f:
            if line.startswith("FABRIC_CLIENT_SECRET="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("FABRIC_CLIENT_SECRET not found in .env")

def get_token():
    data = (
        f"grant_type=client_credentials&client_id={CLIENT_ID}"
        f"&client_secret={get_client_secret()}"
        f"&scope=https://api.fabric.microsoft.com/.default"
    )
    req = urllib.request.Request(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data=data.encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    return json.loads(urllib.request.urlopen(req).read())["access_token"]

# ── Template → Real ID Mappings ──
# These are per-workspace because each workspace has its own deployed items

TEMPLATE_TO_REAL = {
    # CODE_DEV workspace
    "0bd63996-3a38-493b-825e-b6f26a04ae99": {
        # Workspace & Lakehouse IDs (template -> DATA_DEV)
        "40e27fdc-775a-4ee2-84d5-48893c92d7cc": "1d947c6d-4350-48c5-8b98-9c21d8862fe7",  # workspace_data
        "4b4840bc-5a9f-434e-8345-3f528d1f39bf": "37216369-bcf6-403d-bd61-831b895ee36a",  # LH_DATA_LANDINGZONE
        # Pipelines
        "456ec477-b392-4576-8070-ad5cf1fd5a30": "631720ce-a9d3-4c98-943f-99a4b776550f",  # COPY_FROM_ASQL_01
        "740e290a-ea29-474f-a3d6-91768f5466ea": "16fdd640-4b73-41bc-8f31-70cedc100f3a",  # COPY_FROM_ADLS_01
        "bfe7a852-2306-4ea1-8605-0cd7473dadf8": "71ac3394-accc-44eb-b8df-2d02fc2b3777",  # COPY_FROM_ADF
        "4972831f-6320-ab73-46e2-336d0bc59199": "f2f2b693-2692-453c-9c0c-2fb5285cc937",  # COPY_FROM_FTP_01
        "bdb7c7d1-db6c-b117-483a-06fac2abc979": "2114cfd3-6e59-4950-a4a1-3cb359985b45",  # COPY_FROM_SFTP_01
        "d20eb24b-abeb-92d0-4c84-932ed3597147": "3269810b-9a33-41b9-bbfc-71e1bc585950",  # COPY_FROM_ONELAKE_FILES_01
        "a7f32c61-f86b-4484-b2e2-366d839bcb42": "2c54becd-5b1d-4ad7-ba90-f56bc6e44dbf",  # COPY_FROM_ONELAKE_TABLES_01
        "2d7d2d52-be18-b5ea-4ccd-b7c0abb80439": "7da96b25-5027-48e4-a16e-2e39437a0ca2",  # COPY_FROM_ORACLE_01
        "38f17b20-2d5a-8f67-4801-9c6bcb0f651b": "cdeca701-a720-4336-b93c-f1a242834ee7",  # COPY_FROM_CUSTOM_NB
        "5c592df9-8582-4572-9e4e-d6166ef575df": "d8686569-8c8e-4544-b25a-1d7878b2ff5e",  # COMMAND_ASQL
        "a5918d08-0395-45ba-9c8c-f53d78b465eb": "6c008157-5441-4f95-a2a1-241e95156892",  # COMMAND_ADLS
        "36346796-f9dc-47b9-a248-c440a11c1aa0": "be7f5e16-3053-4c62-80a6-0bc3e29950ee",  # COMMAND_ONELAKE
        "28c5f888-0efc-4b60-b568-c82f47680680": "e06e964c-28e3-4cab-9bc0-27054f8c8007",  # COMMAND_ADF
        "76f19233-94ef-a100-48dd-7f32bec279e3": "a6dfd4fe-6661-4aeb-a344-5fdd44e47a59",  # COMMAND_SFTP
        "e3793389-17ee-b401-4669-ef22ffe790e1": "8dab42f0-2b98-44b4-99f4-1871b22f823c",  # COMMAND_FTP
        "4ee59a0f-ce5b-81d5-4477-eeac0e61c8a5": "a81c22a2-a7e1-4436-850e-3a3e76ff0c9a",  # COMMAND_NOTEBOOK
        "03e51795-feb0-b062-472f-81f44460c3b8": "044b65c9-2deb-40d6-8fb5-8fa4df7e9af8",  # COMMAND_ORACLE
        "5d74cbab-2d1e-4b8a-a438-86cbab219dc9": "596bc924-1b23-4771-a11e-81e2c4b574f2",  # LOAD_BRONZE
        "693d01c3-999c-4022-9da6-a94134c7e57e": "a6563d8d-247d-4789-82c4-9dd42810eba1",  # LOAD_SILVER
        "38f06ae6-bf9a-4f2c-a364-461c66b8f104": "c2be11ec-4294-4cd0-aa51-9cd984c7f01a",  # LOAD_LANDINGZONE
        "1b6d7d0d-d04b-4bc2-a6da-7a876216561d": "ec06fc10-3328-4bec-b8b1-e3c6b5c02fff",  # LOAD_ALL
        "20cbc814-b94e-9c75-4cf3-c5bb3886877b": "e1fddeb4-84d3-47c3-8b1a-93913ae8b9fa",  # TOOLING_POST_ASQL
        # Notebooks
        "bf2101e2-a101-b8df-43bf-5f6ba130a279": "a576b2cf-9c04-46f7-a069-fe8c0906b5ac",  # PROCESSING_PARALLEL_MAIN
        "a69cb3e2-52a1-abee-4335-29721d1d5828": "2006ff28-c4bb-4995-9913-6b251f0f5e0e",  # PROCESSING_LANDINGZONE_MAIN
    },
    # CODE_PROD workspace
    "1d1ae6c6-70a1-4f7e-849d-60820ea13646": {
        # Workspace & Lakehouse IDs (template -> DATA_PROD)
        "40e27fdc-775a-4ee2-84d5-48893c92d7cc": "350f08db-936e-42d9-8d3e-70fdee0d3df8",  # workspace_data
        "4b4840bc-5a9f-434e-8345-3f528d1f39bf": "a9f1bc85-c478-414a-989f-12658b9ab80d",  # LH_DATA_LANDINGZONE
        # Pipelines
        "456ec477-b392-4576-8070-ad5cf1fd5a30": "b7dfe5e3-c1df-4f1d-a2fc-ee8d4cf406e2",  # COPY_FROM_ASQL_01
        "740e290a-ea29-474f-a3d6-91768f5466ea": "caf59496-344a-438c-938a-67728a8be871",  # COPY_FROM_ADLS_01
        "bfe7a852-2306-4ea1-8605-0cd7473dadf8": "355d6931-88e7-4978-94ab-e94b7fa170ec",  # COPY_FROM_ADF
        "4972831f-6320-ab73-46e2-336d0bc59199": "13a9b6c1-761f-4d02-88d4-c1e2888f1ee8",  # COPY_FROM_FTP_01
        "bdb7c7d1-db6c-b117-483a-06fac2abc979": "5c309197-3a85-4d12-a49c-962f41b347c4",  # COPY_FROM_SFTP_01
        "d20eb24b-abeb-92d0-4c84-932ed3597147": "441c35a5-3fbd-44ab-b42a-3f9f8685af2c",  # COPY_FROM_ONELAKE_FILES_01
        "a7f32c61-f86b-4484-b2e2-366d839bcb42": "c4de0075-e830-474c-b1de-de412ba2801c",  # COPY_FROM_ONELAKE_TABLES_01
        "2d7d2d52-be18-b5ea-4ccd-b7c0abb80439": "bb6ff0b7-f099-4c8e-81b4-615e6a12c482",  # COPY_FROM_ORACLE_01
        "38f17b20-2d5a-8f67-4801-9c6bcb0f651b": "ff6227de-3766-45bd-bed0-c5c7c5b33693",  # COPY_FROM_CUSTOM_NB
        "5c592df9-8582-4572-9e4e-d6166ef575df": "29a7e1e9-7186-4505-ac38-a1252cebe733",  # COMMAND_ASQL
        "a5918d08-0395-45ba-9c8c-f53d78b465eb": "707abdba-52d3-4d8b-9a80-9888c47bbb2f",  # COMMAND_ADLS
        "36346796-f9dc-47b9-a248-c440a11c1aa0": "60482ef6-0887-41f6-9291-58b469af1a5e",  # COMMAND_ONELAKE
        "28c5f888-0efc-4b60-b568-c82f47680680": "ff8b9d11-8421-4143-9bfb-026045fadc24",  # COMMAND_ADF
        "76f19233-94ef-a100-48dd-7f32bec279e3": "3812ffb2-aa54-42b8-bf20-bc74190def91",  # COMMAND_SFTP
        "e3793389-17ee-b401-4669-ef22ffe790e1": "73d2fd50-b0bd-4278-ab0c-6c3b4e3b98cc",  # COMMAND_FTP
        "4ee59a0f-ce5b-81d5-4477-eeac0e61c8a5": "d7d1063e-8d9e-48f1-b705-2d343176274f",  # COMMAND_NOTEBOOK
        "03e51795-feb0-b062-472f-81f44460c3b8": "66ba6ea1-5c2a-48ce-a02c-64731598de9b",  # COMMAND_ORACLE
        "5d74cbab-2d1e-4b8a-a438-86cbab219dc9": "048ce567-83f2-4815-b781-500cfda132dc",  # LOAD_BRONZE
        "693d01c3-999c-4022-9da6-a94134c7e57e": "5bb26855-97a2-4cae-a797-1e95463d3059",  # LOAD_SILVER
        "38f06ae6-bf9a-4f2c-a364-461c66b8f104": "5835aa29-bdbf-4b2d-8473-4b414a77f34f",  # LOAD_LANDINGZONE
        "1b6d7d0d-d04b-4bc2-a6da-7a876216561d": "2b752ca4-5aa8-4ed0-9831-e86c1b3ad37b",  # LOAD_ALL
        "20cbc814-b94e-9c75-4cf3-c5bb3886877b": "cd4361a9-dcd2-4079-8443-6509a773fea8",  # TOOLING_POST_ASQL
        # Notebooks
        "bf2101e2-a101-b8df-43bf-5f6ba130a279": "17897811-5d9e-49e1-ab3d-2484977570f3",  # PROCESSING_PARALLEL_MAIN
        "a69cb3e2-52a1-abee-4335-29721d1d5828": "2c38dfb5-9052-4bb2-a4b3-62c7062d3f23",  # PROCESSING_LANDINGZONE_MAIN
    },
}

# Real pipeline IDs per workspace (for the updateDefinition URL)
REAL_PIPELINE_IDS = {
    "0bd63996-3a38-493b-825e-b6f26a04ae99": {
        "PL_FMD_LDZ_COMMAND_ADF": "e06e964c-28e3-4cab-9bc0-27054f8c8007",
        "PL_FMD_LDZ_COMMAND_ADLS": "6c008157-5441-4f95-a2a1-241e95156892",
        "PL_FMD_LDZ_COMMAND_ASQL": "d8686569-8c8e-4544-b25a-1d7878b2ff5e",
        "PL_FMD_LDZ_COMMAND_FTP": "8dab42f0-2b98-44b4-99f4-1871b22f823c",
        "PL_FMD_LDZ_COMMAND_NOTEBOOK": "a81c22a2-a7e1-4436-850e-3a3e76ff0c9a",
        "PL_FMD_LDZ_COMMAND_ONELAKE": "be7f5e16-3053-4c62-80a6-0bc3e29950ee",
        "PL_FMD_LDZ_COMMAND_ORACLE": "044b65c9-2deb-40d6-8fb5-8fa4df7e9af8",
        "PL_FMD_LDZ_COMMAND_SFTP": "a6dfd4fe-6661-4aeb-a344-5fdd44e47a59",
        "PL_FMD_LDZ_COPY_FROM_ADF": "71ac3394-accc-44eb-b8df-2d02fc2b3777",
        "PL_FMD_LDZ_COPY_FROM_ADLS_01": "16fdd640-4b73-41bc-8f31-70cedc100f3a",
        "PL_FMD_LDZ_COPY_FROM_ASQL_01": "631720ce-a9d3-4c98-943f-99a4b776550f",
        "PL_FMD_LDZ_COPY_FROM_CUSTOM_NB": "cdeca701-a720-4336-b93c-f1a242834ee7",
        "PL_FMD_LDZ_COPY_FROM_FTP_01": "f2f2b693-2692-453c-9c0c-2fb5285cc937",
        "PL_FMD_LDZ_COPY_FROM_ONELAKE_FILES_01": "3269810b-9a33-41b9-bbfc-71e1bc585950",
        "PL_FMD_LDZ_COPY_FROM_ONELAKE_TABLES_01": "2c54becd-5b1d-4ad7-ba90-f56bc6e44dbf",
        "PL_FMD_LDZ_COPY_FROM_ORACLE_01": "7da96b25-5027-48e4-a16e-2e39437a0ca2",
        "PL_FMD_LDZ_COPY_FROM_SFTP_01": "2114cfd3-6e59-4950-a4a1-3cb359985b45",
        "PL_FMD_LOAD_ALL": "ec06fc10-3328-4bec-b8b1-e3c6b5c02fff",
        "PL_FMD_LOAD_BRONZE": "596bc924-1b23-4771-a11e-81e2c4b574f2",
        "PL_FMD_LOAD_LANDINGZONE": "c2be11ec-4294-4cd0-aa51-9cd984c7f01a",
        "PL_FMD_LOAD_SILVER": "a6563d8d-247d-4789-82c4-9dd42810eba1",
        "PL_TOOLING_POST_ASQL_TO_FMD": "e1fddeb4-84d3-47c3-8b1a-93913ae8b9fa",
    },
    "1d1ae6c6-70a1-4f7e-849d-60820ea13646": {
        "PL_FMD_LDZ_COMMAND_ADF": "ff8b9d11-8421-4143-9bfb-026045fadc24",
        "PL_FMD_LDZ_COMMAND_ADLS": "707abdba-52d3-4d8b-9a80-9888c47bbb2f",
        "PL_FMD_LDZ_COMMAND_ASQL": "29a7e1e9-7186-4505-ac38-a1252cebe733",
        "PL_FMD_LDZ_COMMAND_FTP": "73d2fd50-b0bd-4278-ab0c-6c3b4e3b98cc",
        "PL_FMD_LDZ_COMMAND_NOTEBOOK": "d7d1063e-8d9e-48f1-b705-2d343176274f",
        "PL_FMD_LDZ_COMMAND_ONELAKE": "60482ef6-0887-41f6-9291-58b469af1a5e",
        "PL_FMD_LDZ_COMMAND_ORACLE": "66ba6ea1-5c2a-48ce-a02c-64731598de9b",
        "PL_FMD_LDZ_COMMAND_SFTP": "3812ffb2-aa54-42b8-bf20-bc74190def91",
        "PL_FMD_LDZ_COPY_FROM_ADF": "355d6931-88e7-4978-94ab-e94b7fa170ec",
        "PL_FMD_LDZ_COPY_FROM_ADLS_01": "caf59496-344a-438c-938a-67728a8be871",
        "PL_FMD_LDZ_COPY_FROM_ASQL_01": "b7dfe5e3-c1df-4f1d-a2fc-ee8d4cf406e2",
        "PL_FMD_LDZ_COPY_FROM_CUSTOM_NB": "ff6227de-3766-45bd-bed0-c5c7c5b33693",
        "PL_FMD_LDZ_COPY_FROM_FTP_01": "13a9b6c1-761f-4d02-88d4-c1e2888f1ee8",
        "PL_FMD_LDZ_COPY_FROM_ONELAKE_FILES_01": "441c35a5-3fbd-44ab-b42a-3f9f8685af2c",
        "PL_FMD_LDZ_COPY_FROM_ONELAKE_TABLES_01": "c4de0075-e830-474c-b1de-de412ba2801c",
        "PL_FMD_LDZ_COPY_FROM_ORACLE_01": "bb6ff0b7-f099-4c8e-81b4-615e6a12c482",
        "PL_FMD_LDZ_COPY_FROM_SFTP_01": "5c309197-3a85-4d12-a49c-962f41b347c4",
        "PL_FMD_LOAD_ALL": "2b752ca4-5aa8-4ed0-9831-e86c1b3ad37b",
        "PL_FMD_LOAD_BRONZE": "048ce567-83f2-4815-b781-500cfda132dc",
        "PL_FMD_LOAD_LANDINGZONE": "5835aa29-bdbf-4b2d-8473-4b414a77f34f",
        "PL_FMD_LOAD_SILVER": "5bb26855-97a2-4cae-a797-1e95463d3059",
        "PL_TOOLING_POST_ASQL_TO_FMD": "cd4361a9-dcd2-4079-8443-6509a773fea8",
    },
}

# Source directory
SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")


MISSING_CONNECTIONS = {
    "02e107b8-e97e-4b00-a28c-668cf9ce3d9a",  # CON_FMD_ADF_PIPELINES (doesn't exist)
    "5929775e-aff1-430c-b56e-f855d0bc63b8",  # CON_FMD_FABRIC_NOTEBOOKS (doesn't exist)
}


def deactivate_missing_connections(data):
    """Set activities referencing missing connections to Inactive."""
    deactivated = 0

    def process_activities(activities):
        nonlocal deactivated
        for act in activities:
            # Check all connection refs in the activity
            has_missing = _has_missing_connection(act)
            if has_missing:
                act["state"] = "Inactive"
                act["onInactiveMarkAs"] = "Succeeded"
                deactivated += 1
            # Recurse into ForEach
            if act.get("type") == "ForEach":
                inner = act.get("typeProperties", {}).get("activities", [])
                process_activities(inner)

    process_activities(data.get("properties", {}).get("activities", []))
    return deactivated


def _has_missing_connection(activity):
    """Check if an activity references any missing connection."""
    content = json.dumps(activity)
    for conn_id in MISSING_CONNECTIONS:
        if conn_id in content:
            return True
    return False


def prepare_pipeline_json(pipeline_name, workspace_id):
    """Read source JSON, replace all template IDs with real ones for the target workspace."""
    src_path = os.path.join(SRC_DIR, f"{pipeline_name}.DataPipeline", "pipeline-content.json")
    with open(src_path) as f:
        content = f.read()

    # Replace all template IDs with real IDs for this workspace
    id_map = TEMPLATE_TO_REAL[workspace_id]
    replacements = 0
    for template_id, real_id in id_map.items():
        count = content.count(template_id)
        if count > 0:
            content = content.replace(template_id, real_id)
            replacements += count

    # Deactivate activities with missing connections
    data = json.loads(content)
    deactivated = deactivate_missing_connections(data)
    if deactivated > 0:
        content = json.dumps(data)

    return content, replacements, deactivated


def deploy_pipeline(token, workspace_id, pipeline_name, pipeline_id, content):
    """Deploy a single pipeline definition via updateDefinition API."""
    encoded = base64.b64encode(content.encode()).decode()

    payload = {
        "definition": {
            "parts": [
                {
                    "path": "pipeline-content.json",
                    "payload": encoded,
                    "payloadType": "InlineBase64",
                }
            ]
        }
    }

    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{pipeline_id}/updateDefinition"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        resp = urllib.request.urlopen(req)
        return True, resp.status, ""
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return False, e.code, body


def main():
    print("=" * 60)
    print("FMD Pipeline Deployment Script")
    print("=" * 60)

    token = get_token()
    print("[OK] Authenticated with Fabric API\n")

    workspace_labels = {
        "0bd63996-3a38-493b-825e-b6f26a04ae99": "CODE_DEV",
        "1d1ae6c6-70a1-4f7e-849d-60820ea13646": "CODE_PROD",
    }

    total_success = 0
    total_fail = 0
    failures = []

    for ws_id, ws_label in workspace_labels.items():
        print(f"\n{'-' * 50}")
        print(f"Deploying to {ws_label} ({ws_id})")
        print(f"{'-' * 50}")

        pipelines = REAL_PIPELINE_IDS[ws_id]

        for pl_name, pl_id in sorted(pipelines.items()):
            content, replacements, deactivated = prepare_pipeline_json(pl_name, ws_id)

            ok, status, err = deploy_pipeline(token, ws_id, pl_name, pl_id, content)

            deact_msg = f", {deactivated} deactivated" if deactivated else ""
            if ok:
                print(f"  [OK]   {pl_name} ({replacements} IDs replaced{deact_msg})")
                total_success += 1
            else:
                # Try to extract error message
                try:
                    err_data = json.loads(err)
                    err_msg = err_data.get("errorCode", "") + ": " + err_data.get("message", err)[:120]
                except Exception:
                    err_msg = err[:150]
                print(f"  [FAIL] {pl_name} -> HTTP {status}: {err_msg}")
                total_fail += 1
                failures.append((ws_label, pl_name, status, err_msg))

            # Small delay to avoid throttling
            time.sleep(0.3)

    print(f"\n{'=' * 60}")
    print(f"RESULTS: {total_success} succeeded, {total_fail} failed (of {total_success + total_fail} total)")
    print(f"{'=' * 60}")

    if failures:
        print("\nFailed pipelines:")
        for ws, name, status, msg in failures:
            print(f"  [{ws}] {name}: HTTP {status} - {msg}")

    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
