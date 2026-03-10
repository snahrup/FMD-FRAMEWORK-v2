Username: UsrSQLRead
Password: Ku7T@hoqFDmDPqG4deMgrrxQ9


Tenant ID: ca81e9fd-06dd-49cf-b5a9-ee7441ff5303
Service Principal ID: ac937c5d-4bdd-438f-be8b-84a850021d2d
Service Principal Key: Te.8Q~YR_kQ~s-iJvlN-bpO8VCwtObo5pl24pbfu



    "CON_FMD_ADF_PIPELINES":    {"id": "02e107b8-e97e-4b00-a28c-668cf9ce3d9a", "type": "AzureDataFactory"},
    "CON_FMD_FABRIC_NOTEBOOKS": {"id": "5929775e-aff1-430c-b56e-f855d0bc63b8", "type": "Notebook"},





/ralph-loop "Fix the FMD pipeline end-to-end. All 4 data sources must successfully load through Landing Zone -> Bronze -> Silver. Sources: ETQ=DS9 (29 entities), M3 Cloud/DI_PRD_Staging=DS7 (185 entities), MES=DS4 (445 entities), M3 ERP/m3fdbprd (NOT YET REGISTERED - must register ALL tables first using the Load Optimization Engine pattern from register_entities.py or deploy_from_scratch.py Phase 13). Step 1: Check if M3 ERP gateway connection MT-31 exists and works. Step 2: Register ALL M3 ERP tables into metadata DB with auto-cascade to Bronze+Silver. Step 3: Investigate why Bronze pipeline exits FILE_NOT_FOUND at NB_FMD_LOAD_LANDING_BRONZE line 311 - check what files actually exist in OneLake LZ vs what SQL metadata expects. Step 4: Fix path mismatches and re-run pipelines. Step 5: Verify data in all 3 layers. The LZ pipeline already ran successfully (28-36 min). Signal procs already deployed. Save findings to memory/bronze-pipeline-debugging.md each iteration. Fabric API: tenant ca81e9fd, client ac937c5d, secret in dashboard/app/api/.env. SQL uses SP token auth (pyodbc attrs_before). Workspaces: DATA=a3a180ff, CODE=146fe38c. Lakehouses: LZ=2aef4ede, Bronze=cf57e8bf, Silver=44a0993f. Gateway connections: CON_FMD_M3DB1_M3 for M3 ERP." --completion-promise "All ETQ, M3 Cloud, MES, and M3 ERP entities have been registered and successfully loaded data through Landing Zone, Bronze, and Silver layers with verified parquet files in each lakehouse"
