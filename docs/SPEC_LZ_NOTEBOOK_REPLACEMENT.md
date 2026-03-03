# FMD Landing Zone: Pipeline-to-Notebook Migration Spec
## Why We're Replacing the LZ Pipeline Layer (and Only That Layer)

**Author:** Steve Nahrup
**Date:** 2026-02-27
**Status:** Draft / Pending Approval

---

## Executive Summary

The FMD Framework's Bronze and Silver layers already execute via PySpark notebooks with proper error handling, parallelism, and retry logic. Only the Landing Zone (LZ) layer uses Fabric Data Pipelines with Copy Activities — and that's where every failure has occurred.

This spec proposes replacing the LZ pipeline chain with a single notebook that reads from the same metadata views, writes to the same lakehouses, and logs to the same tables. Everything downstream (Bronze, Silver, orchestration, metadata) stays exactly as-is.

**Scope:** Replace 11 LZ pipelines with 1 notebook. Zero changes to Bronze, Silver, metadata DB, or entity registrations.

---

## The Problem: What's Broken and Why

### Current LZ Pipeline Architecture

```
PL_FMD_LOAD_LANDINGZONE
  └─ LK_GET_ENTITIES (Lookup: SELECT DISTINCT ConnectionType FROM vw_LoadSourceToLandingzone)
  └─ FE_ENTITY (ForEach ConnectionType — NO continueOnError)
       └─ SW_CHECK_DATASOURCENAME (Switch on ConnectionType)
            ├─ SQL  → PL_FMD_LDZ_COMMAND_ASQL
            │         └─ LK_GET_ENTITIES (Lookup: SELECT DatasourceType ... GROUP BY)
            │         └─ FE_ENTITY (ForEach DatasourceType — NO continueOnError)
            │              └─ PL_FMD_LDZ_COPY_FROM_ASQL_01
            │                   └─ LK_GET_LASTLOADDATE (Lookup against source)
            │                   └─ CP_source_datalandingzone (Copy Activity)
            ├─ ADLS → PL_FMD_LDZ_COMMAND_ADLS → PL_FMD_LDZ_COPY_FROM_ADLS_01
            ├─ SFTP → PL_FMD_LDZ_COMMAND_SFTP → PL_FMD_LDZ_COPY_FROM_SFTP_01
            └─ ... (8 connection types, 11 total pipelines)
```

**That's 3 levels of nested ForEach loops, none with error tolerance.**

### Failure Modes Observed (2026-02-26 through 2026-02-27)

| # | Root Cause | Impact | Pipeline Response |
|---|-----------|--------|-------------------|
| 1 | Stale `PipelineLandingzoneEntity` records from previous failed runs | Entities re-processed unnecessarily | Entire pipeline fails |
| 2 | 185 entities with `timestamp`/`rowversion` incremental columns | `varchar→timestamp` implicit conversion error | Entire pipeline fails |
| 3 | 3 OPTIVA tables too large for parquet writer (OOM) | `OutOfMemoryException` at parquet-cpp layer | Entire pipeline fails |
| 4 | 163 OPTIVA entities not accessible via gateway connection | `UserErrorInvalidTableName` at `LK_GET_LASTLOADDATE` | Entire pipeline fails |
| 5 | Non-OPTIVA entities failing during OPTIVA-targeted runs | M3 FDB connection timeouts, file write failures | Entire pipeline fails |

**Every single failure mode produces the same result: the entire pipeline aborts.** This is because the ForEach activities have `isSequential: false` (parallel) but no `continueOnError` setting. One bad entity out of 1,700+ kills the run for all 1,700.

### Why "Just Fix the Pipelines" Is Inadequate

| Fix | Why It's Not Enough |
|-----|-------------------|
| Add `continueOnError` to ForEach | Requires modifying pipeline JSON and redeploying via API. Still no per-entity retry, no chunked reads for OOM, no pre-flight validation. |
| Deactivate bad entities | Treats symptoms. New bad entities will appear as sources change. Need runtime resilience, not pre-run cleanup. |
| Fix the gateway connection | Doesn't address OOM, stale records, or future unknown failures. |
| Add retry policies to Copy Activities | Pipeline retry = retry the entire copy. No partial recovery. |

The fundamental issue: **Fabric Data Pipeline Copy Activities are black boxes.** You can't add try/catch, you can't chunk large tables, you can't validate connectivity before attempting a copy, you can't log granular error details. When something fails, you get a generic "inner activity failed" message and the entire chain aborts.

---

## The Solution: What Changes and What Doesn't

### What STAYS (zero changes)

| Component | Description | Why It's Untouched |
|-----------|-------------|-------------------|
| **Metadata SQL Database** | All `integration.*`, `execution.*`, `logging.*` schemas | The brain of the framework. Notebooks read the same views. |
| **`vw_LoadSourceToLandingzone`** | Execution view that drives LZ entity selection | New notebook queries this exact view |
| **`vw_LoadToBronzeLayer`** | Execution view for Bronze | Unchanged — Bronze already uses notebooks |
| **`vw_LoadToSilverLayer`** | Execution view for Silver | Unchanged — Silver already uses notebooks |
| **Entity registrations** | All `LandingzoneEntity`, `BronzeLayerEntity`, `SilverLayerEntity` records | Registered once, consumed by all layers |
| **Bronze layer** | `NB_FMD_LOAD_LANDING_BRONZE` via `NB_FMD_PROCESSING_PARALLEL_MAIN` | Already notebook-based with parallelism |
| **Silver layer** | `NB_FMD_LOAD_BRONZE_SILVER` via `NB_FMD_PROCESSING_PARALLEL_MAIN` | Already notebook-based with SCD Type 2 |
| **Logging tables** | `logging.CopyActivityExecution`, `logging.PipelineExecution` | New notebook writes to these same tables |
| **Stored procedures** | `sp_UpsertPipelineLandingzoneEntity`, `sp_AuditNotebook`, etc. | Called by new notebook, same interface |
| **Lakehouse structure** | LZ/Bronze/Silver lakehouses, file paths, Delta tables | Same output paths and formats |
| **Cleansing rules** | `SilverLayerEntity.CleansingRules` JSON | Applied at Silver, not LZ |
| **Orchestrator pipeline** | `PL_FMD_LOAD_ALL` chains LZ → Bronze → Silver | Updated to call new LZ notebook instead of old LZ pipeline |
| **Variable Libraries** | `VAR_FMD`, `VAR_CONFIG_FMD` | Same config, same references |

### What CHANGES

| Current (Pipeline) | New (Notebook) | Why |
|---|---|---|
| `PL_FMD_LOAD_LANDINGZONE` | `NB_FMD_LOAD_LANDINGZONE_MAIN` | Orchestrator — queries view, groups entities, manages parallelism |
| `PL_FMD_LDZ_COMMAND_ASQL` | (eliminated) | Redundant routing layer |
| `PL_FMD_LDZ_COPY_FROM_ASQL_01` | `NB_FMD_LDZ_COPY_SQL` | Per-entity extraction with error handling |
| `PL_FMD_LDZ_COPY_FROM_ADLS_01` | Handled within main notebook | ADLS reads via Spark natively |
| `PL_FMD_LDZ_COPY_FROM_SFTP_01` | (keep pipeline or convert later) | Low priority, few entities |
| `PL_FMD_LDZ_COPY_FROM_FTP_01` | (keep pipeline or convert later) | Low priority, few entities |
| `LK_GET_LASTLOADDATE` | Inline SQL in notebook | No separate lookup needed |
| Copy Activity (black box) | PyODBC + Spark + Parquet write | Full control over chunking, retries, error details |

**Net change: 11 pipelines replaced by 1-2 notebooks. 6 notebooks and all downstream pipelines unchanged.**

---

## New LZ Notebook Architecture

### NB_FMD_LOAD_LANDINGZONE_MAIN

```
1. Query vw_LoadSourceToLandingzone (filtered by WorkspaceGuid + IsActive)
2. Group entities by ConnectionType + DataSourceId
3. For each entity (parallel within groups, configurable concurrency):
   a. PRE-FLIGHT: Validate source connectivity
      - SQL: Test connection with SELECT 1
      - Skip entity if unreachable, log to CopyActivityExecution
   b. GET LAST LOAD VALUE:
      - Run LastLoadValue query against source (inline, not separate lookup)
      - Handle errors gracefully (log + skip, don't abort)
   c. EXTRACT DATA:
      - SQL sources: PyODBC query with chunked fetch (fetchmany)
      - ADLS sources: Spark read from ABFSS path
      - Write parquet to LZ lakehouse at TargetFilePath/TargetFileName
      - For large tables (>1M rows): Write in batches to avoid OOM
   d. REGISTER IN EXECUTION:
      - Call sp_UpsertPipelineLandingzoneEntity (marks file for Bronze pickup)
      - Update LandingzoneEntityLastLoadValue with new watermark
   e. LOG RESULT:
      - Success: Log EndCopyActivity to CopyActivityExecution
      - Failure: Log FailedCopyActivity with full error details
      - Either way: Continue to next entity
4. Return summary: {total, succeeded, failed, failures[]}
```

### Key Reliability Improvements

| Feature | Pipeline (Current) | Notebook (New) |
|---------|-------------------|----------------|
| **Error isolation** | One failure kills everything | Try/except per entity, continue processing |
| **Pre-flight validation** | None | Test source connectivity before extraction |
| **OOM handling** | Crash with parquet-cpp OOM | Chunked reads (OFFSET/FETCH) for large tables |
| **Retry logic** | Pipeline retry = retry entire pipeline | Per-entity retry (configurable, e.g., 2 retries with backoff) |
| **Error messages** | "inner activity failed" | Full Python traceback + SQL error details |
| **Debugging** | Open Fabric UI, navigate 3 pipeline levels | Read notebook output, grep for entity name |
| **Invalid tables** | Pipeline aborts on LK_GET_LASTLOADDATE | Catch error, mark entity as invalid, continue |
| **Incremental loads** | Generated SQL in view, executed blind | Validate column exists + type before generating WHERE clause |
| **Monitoring** | Poll Fabric API for pipeline status | Notebook outputs progress to stdout in real-time |
| **Concurrency control** | Fixed parallelism, no throttling | Configurable: `max_concurrent_entities`, `batch_size` |

### Compatibility Guarantees

1. **Same output format:** Parquet files at the same `FilePath + '/' + Namespace + '/yyyy/MM/dd'` paths
2. **Same file naming:** `FileName_yyyyMMddHHmm.FileType`
3. **Same execution tracking:** `sp_UpsertPipelineLandingzoneEntity` called with same parameters
4. **Same logging:** `StartCopyActivity`, `EndCopyActivity`, `FailedCopyActivity` written to `logging.CopyActivityExecution`
5. **Same audit trail:** `sp_AuditNotebook` called at start/end
6. **Same watermark updates:** `LandingzoneEntityLastLoadValue` updated on success
7. **Bronze picks up seamlessly:** `vw_LoadToBronzeLayer` joins on `PipelineLandingzoneEntity.IsProcessed = 0` — same entries, same view, same downstream

### Connection Type Support

| ConnectionType | Extraction Method | Notes |
|---|---|---|
| **SQL** | PyODBC via on-prem data gateway connection | Same gateway, same credentials. Chunked fetch for large tables. |
| **ADLS** | Spark `spark.read.format("parquet").load(abfss://...)` | Native Spark, no Copy Activity needed |
| **ONELAKE** | Spark `spark.read.format("delta").load(abfss://...)` | Already in Fabric, trivial read |
| **SFTP/FTP** | Keep existing pipeline OR use paramiko/ftplib | Phase 2 — low priority, few entities |
| **ORACLE** | PyODBC or cx_Oracle via gateway | Same pattern as SQL |
| **NOTEBOOK** | `notebookutils.notebook.run()` | Already supported, same mechanism |

---

## Risk Assessment

### Risks of Staying on Current Pipelines

| Risk | Likelihood | Impact |
|------|-----------|--------|
| Pipeline continues to fail on any single entity error | **Certain** | Full pipeline abort, no data loaded |
| New entities registered from source schema catalogs cause failures | **High** | Same abort behavior |
| OOM on large tables as data grows | **High** | Pipeline abort |
| Unable to debug failures without Fabric UI access | **High** | Slow troubleshooting |
| Production handoff requires manual entity curation before every run | **High** | Operational burden |

### Risks of Notebook Migration

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PyODBC performance differs from Copy Activity | **Medium** | Slower extraction for some entities | Chunked fetch + parallelism offset this. Benchmark during testing. |
| Gateway connection behavior differs in notebook context | **Low** | Connection failures | Same gateway, same credentials. Test with OPTIVA first. |
| Spark parquet write format differs from Copy Activity output | **Very Low** | Bronze notebook can't read files | Parquet is Parquet. Standard format. |
| NotebookUtils API changes in future Fabric updates | **Low** | Code needs updating | Same risk exists for current notebooks (Bronze/Silver already use this) |

---

## Implementation Plan

### Phase 1: OPTIVA LZ Notebook (Week 1)
- Build `NB_FMD_LOAD_LANDINGZONE_MAIN` for SQL connection type
- Test with 317 known-good OPTIVA entities
- Validate output matches current pipeline output (same file paths, same parquet format)
- Verify Bronze picks up files correctly (vw_LoadToBronzeLayer)
- Run full chain: LZ notebook → Bronze notebook → Silver notebook

### Phase 2: All SQL Sources (Week 2)
- Extend to MES (445 entities), ETQ (29), M3C (185), M3 FDB (596)
- Add chunked read for large tables (M3 FDB OOM tables)
- Add pre-flight validation (test connection before bulk extraction)
- Performance benchmarking vs pipeline Copy Activity

### Phase 3: Non-SQL Sources (Week 3, if needed)
- ADLS, ONELAKE: Trivial Spark reads, add to notebook
- SFTP/FTP: Evaluate whether to keep existing pipelines or convert
- ORACLE: Same PyODBC pattern as SQL

### Phase 4: Production Cutover (Week 4)
- Update `PL_FMD_LOAD_ALL` to call new LZ notebook
- Decommission old LZ pipeline chain (keep in repo, just don't trigger)
- Production validation with all sources
- Operational runbook update

---

## Comparison: Why Notebooks Win for LZ

The FMD Framework vendor already made this choice for Bronze and Silver. They use `NB_FMD_PROCESSING_PARALLEL_MAIN` to orchestrate notebook execution with:
- Parallelism via `runMultiple()` DAG
- Grouping and dependency management
- Error capture and continuation
- Summary reporting

The LZ layer is the ONLY layer still using raw pipeline Copy Activities. This spec aligns LZ with the same pattern the vendor already chose for Bronze and Silver.

**We're not reinventing the framework. We're finishing what the vendor started.**

---

## Appendix: Pipeline Inventory

### Pipelines to Decommission (11)

| Pipeline | Purpose | Replaced By |
|----------|---------|-------------|
| `PL_FMD_LOAD_LANDINGZONE` | LZ orchestrator | `NB_FMD_LOAD_LANDINGZONE_MAIN` |
| `PL_FMD_LDZ_COMMAND_ASQL` | SQL routing | Eliminated (inline) |
| `PL_FMD_LDZ_COMMAND_ADLS` | ADLS routing | Eliminated (inline) |
| `PL_FMD_LDZ_COMMAND_ONELAKE` | OneLake routing | Eliminated (inline) |
| `PL_FMD_LDZ_COMMAND_ADF` | ADF routing | Eliminated (inline) |
| `PL_FMD_LDZ_COMMAND_NOTEBOOK` | Notebook routing | Eliminated (inline) |
| `PL_FMD_LDZ_COPY_FROM_ASQL_01` | SQL copy | `NB_FMD_LDZ_COPY_SQL` |
| `PL_FMD_LDZ_COPY_FROM_ADLS_01` | ADLS copy | Spark read in main notebook |
| `PL_FMD_LDZ_COPY_FROM_ONELAKE_TABLES_01` | OneLake tables copy | Spark read |
| `PL_FMD_LDZ_COPY_FROM_ONELAKE_FILES_01` | OneLake files copy | Spark read |
| `PL_FMD_LDZ_COPY_FROM_CUSTOM_NB` | Custom notebook | Direct notebook.run() |

### Pipelines to Keep (10)

| Pipeline | Purpose | Why Keep |
|----------|---------|---------|
| `PL_FMD_LOAD_ALL` | Master orchestrator | Updated to call new LZ notebook |
| `PL_FMD_LOAD_BRONZE` | Bronze orchestrator | Already uses notebooks |
| `PL_FMD_LOAD_SILVER` | Silver orchestrator | Already uses notebooks |
| `PL_FMD_LDZ_COPY_FROM_SFTP_01` | SFTP copy | Phase 3 conversion |
| `PL_FMD_LDZ_COPY_FROM_FTP_01` | FTP copy | Phase 3 conversion |
| `PL_FMD_LDZ_COPY_FROM_ORACLE_01` | Oracle copy | Phase 3 conversion |
| `PL_FMD_LDZ_COMMAND_SFTP` | SFTP routing | Phase 3 |
| `PL_FMD_LDZ_COMMAND_FTP` | FTP routing | Phase 3 |
| `PL_FMD_LDZ_COMMAND_ORACLE` | Oracle routing | Phase 3 |
| (any scheduling pipelines) | Trigger/schedule | Unchanged |
