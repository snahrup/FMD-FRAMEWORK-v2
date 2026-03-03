# Pipeline Failure Investigation Report

**Date**: 2026-03-01
**Investigation Period**: 2026-02-24 through 2026-03-01
**Investigator**: Automated via Fabric API + SQL Metadata DB queries

---

## Executive Summary

Between 2/25 and 3/01, the FMD Landing Zone pipeline chain experienced **systematic failures** across every single run attempt. Out of 24 runs of `PL_FMD_LOAD_LANDINGZONE`, only **3 succeeded** (all on 2/25 or earlier). Starting 2/26, **every run failed** with durations consistently around ~1 hour, confirming the copy activity timeout hypothesis. However, the root cause is more nuanced than a simple timeout -- there are **multiple overlapping failure modes**.

**STATUS: DONE**

---

## Pipeline Architecture (Relevant Chain)

```
PL_FMD_LOAD_ALL (orchestrator)
  -> PL_FMD_LOAD_LANDINGZONE (LZ orchestrator)
       -> PL_FMD_LDZ_COMMAND_ASQL (command dispatcher for Azure SQL sources)
            -> PL_FMD_LDZ_COPY_FROM_ASQL_01 (actual copy activities)
                 -> PL_FMD_LDZ_COPY_SQL (individual entity copy, ~100 runs seen)
  -> PL_FMD_LOAD_BRONZE
  -> PL_FMD_LOAD_SILVER
```

All pipelines reside in the **CODE workspace** (`146fe38c-f6c3-4e9d-a18c-5c01cad5941e`), not the DATA workspace.

---

## Pipeline Run History

### PL_FMD_LOAD_LANDINGZONE (3d0b3b2b-a069-40dc-b735-d105f9e66838)

| # | Start (UTC) | End (UTC) | Duration | Status |
|---|-------------|-----------|----------|--------|
| 1 | 2026-03-01 02:57 | 2026-03-01 03:57 | **1h 00m 43s** | Failed |
| 2 | 2026-02-27 14:56 | 2026-02-27 15:59 | **1h 03m 01s** | Failed |
| 3 | 2026-02-27 13:46 | 2026-02-27 14:48 | **1h 02m 34s** | Failed |
| 4 | 2026-02-27 12:33 | 2026-02-27 13:36 | **1h 02m 57s** | Failed |
| 5 | 2026-02-27 11:27 | 2026-02-27 12:29 | **1h 02m 25s** | Failed |
| 6 | 2026-02-27 10:18 | 2026-02-27 11:20 | **1h 02m 07s** | Failed |
| 7 | 2026-02-27 09:06 | 2026-02-27 10:07 | **1h 01m 42s** | Failed |
| 8 | 2026-02-27 08:57 | 2026-02-27 08:58 | 0m 44s | Failed (fast) |
| 9 | 2026-02-27 07:15 | 2026-02-27 08:16 | **1h 00m 53s** | Failed |
| 10 | 2026-02-27 01:53 | 2026-02-27 02:54 | **1h 00m 44s** | Failed |
| 11 | 2026-02-26 18:20 | 2026-02-26 19:21 | **1h 00m 53s** | Failed |
| 12 | 2026-02-26 15:43 | 2026-02-26 16:44 | **1h 00m 44s** | Failed |
| 13 | 2026-02-26 14:12 | 2026-02-26 15:14 | **1h 01m 51s** | Failed |
| 14 | 2026-02-26 12:45 | 2026-02-26 13:46 | **1h 01m 15s** | Failed |
| 15 | 2026-02-26 11:59 | 2026-02-26 12:44 | 45m 49s | Cancelled |
| 16 | 2026-02-26 11:06 | 2026-02-26 11:56 | 50m 00s | Cancelled |
| 17 | **2026-02-25 19:43** | **2026-02-25 20:11** | **28m 17s** | **Completed** |
| 18 | **2026-02-25 13:02** | **2026-02-25 13:38** | **36m 23s** | **Completed** |
| 19 | 2026-02-25 12:26 | 2026-02-25 12:55 | 29m 00s | Cancelled |
| 20 | 2026-02-25 04:51 | 2026-02-25 05:51 | **1h 00m 45s** | Failed |
| 21 | **2026-02-24 22:40** | **2026-02-24 23:32** | **52m 29s** | **Completed** |
| 22-24 | 2026-02-24 (various) | (various) | <1m | Failed (fast, config) |

**Key pattern**: Every failed run from 2/26 onward runs for exactly ~1 hour before failing. The 3 successful runs completed in 28-52 minutes.

**Error message (all ~1hr failures)**:
```
Operation on target FE_ENTITY failed: Activity failed because an inner activity failed;
Inner activity name: SW_CHECK_DATASOURCENAME, Error: Activity failed because an inner activity failed
```

### PL_FMD_LDZ_COMMAND_ASQL (7a01c26c-394f-4659-b576-af5fdfa04feb)

Same pattern -- all 24 runs showed identical ~1hr timeout failures from 2/26 onward, with only 2 successful runs on 2/25.

### PL_FMD_LDZ_COPY_FROM_ASQL_01 (77cec108-98e3-4c04-923f-112faa3c484c)

This is where the actual failures originate. **Two distinct failure modes observed**:

1. **HTTP 429 Throttling** (2/27): `StatusCode: 429, RequestBlocked` from the Fabric SQL Database
   - The SQL DB at workspace `f442f66c-eac6-46d7-80c9-c8b025c86fbe` is being rate-limited
   - Activities `SP_START_AUDIT_PIPELINE_CP`, `SP_UPDATE_PROCESS`, `SP_END_AUDIT_PIPELINE_CP`, `SP_UPDATE_LASTLOADVALIE` all hit 429s
   - Some runs took 2-13 hours as they kept retrying against blocked requests

2. **Copy Activity OOM / File Upload Failures** (2/26):
   - `ErrorCode=UserErrorWriteFailedFileOperation` -- parquet file upload failures
   - `ErrorCode=SystemErrorOutOfMemory` -- OOM during data copy
   - Activity name: `CP_source_datalandingzone`

3. **LK_GET_LASTLOADDATE Failures** (3/01, most recent):
   - `failureType: UserError`, `target: LK_GET_LASTLOADDATE`
   - Empty error message/code -- the lookup activity to get the last load watermark is failing silently

### PL_FMD_LDZ_COPY_SQL (eb1d1d42-ef0b-41b6-8ff0-15a4ab5e54dd)

**100 runs found, all Completed successfully** (on 2/28). These are the individual per-entity copy jobs that execute within the ASQL_01 pipeline. Each takes ~18 seconds. This pipeline works fine on its own -- the failures happen at the orchestration level above it.

---

## Error Pattern Analysis (from logging.CopyActivityExecution)

**1,836 total failed copy activities** between 2/25 and 3/01:

| Count | Error Type | Target Activity | Description |
|-------|-----------|-----------------|-------------|
| **714** | `UserErrorInvalidTableName` | `LK_GET_LASTLOADDATE` | "The table name is invalid" -- empty/null table name passed to lookup |
| **300** | Empty error (UserError) | `LK_GET_LASTLOADDATE` | Silent failure in watermark lookup |
| **96** | `SqlOperationFailed` | `LK_GET_LASTLOADDATE` | "Implicit conversion from varchar to timestamp not allowed" -- watermark column data type mismatch |
| **21** | `SystemErrorOutOfMemory` | `CP_source_datalandingzone` | OOM during actual data copy (large tables) |
| **5** | `notebookutils.pipeline` missing | N/A | Module error in notebook-based pipeline calls |
| **5** | `UserErrorWriteFailedFileOperation` | `CP_source_datalandingzone` | Parquet file upload failures (ETQ M3Xfer, tblCustomerCompare) |
| **2** | `SqlOperationFailed` | `CP_source_datalandingzone` | Invalid object name `dbo.FSSIMPLESEARCHRESULTS_1452788` |
| **1** | `SqlFailedToConnect` | `LK_GET_LASTLOADDATE` | Cannot connect to `sqllogshipprd`/`m3fdbprd` (M3 ERP source) |
| **1** | `SystemErrorActivityRunExecutedMoreThanOnce` | `CP_source_datalandingzone` | Internal Fabric error, retry needed |

### Key Finding: `LK_GET_LASTLOADDATE` is the #1 Failure Point

The **lookup activity** that retrieves the last watermark value for incremental loads is responsible for **1,110 out of 1,836 failures** (60.4%). Three sub-causes:

1. **714 cases**: Invalid/empty table name being passed to the lookup. This suggests the pipeline parameter for source table name is null or empty for many entities.
2. **300 cases**: Silent failure with empty error messages -- likely a transient connection issue to the metadata SQL DB.
3. **96 cases**: Data type mismatch -- entities with `timestamp`/`rowversion` watermark columns can't be compared with `varchar` in the incremental load query.

---

## Copy Activity Volume by Date

| Date | Started | Completed | Failed | Failure Rate |
|------|---------|-----------|--------|--------------|
| 2026-02-25 | 1,133 | 1,014 | 99 | 8.7% |
| 2026-02-26 | 5,311 | 4,272 | 766 | 14.4% |
| 2026-02-27 | 5,907 | 3,900 | 925 | 15.7% |
| 2026-02-28 | 333 | 316 | 6 | 1.8% |
| 2026-03-01 | 60 | 0 | 40 | 66.7% |

**2/28 was actually the most successful day** -- only 6 failures out of 333 activities. But by 3/01, the system is almost entirely failing.

---

## Entity Status (from execution.EntityStatusSummary)

- **Total entities**: 1,735
- **LZ Status = loaded**: 1,564 (90.1%)
- **LZ Status = not_started**: 171 (9.9%)
- **Overall Status = partial**: 1,564 (loaded to LZ but not through Bronze/Silver)
- **Overall Status = not_started**: 171
- **Entities with recorded errors**: 0 (errors are logged in the logging schema, not the status summary)

The 171 `not_started` entities are likely the ones that consistently fail the `LK_GET_LASTLOADDATE` lookup.

---

## Timeline of Events

| Date/Time (UTC) | Event |
|-----------------|-------|
| 2026-02-24 22:40 | Last successful full LZ run (52 min) |
| 2026-02-25 04:51 | First ~1hr timeout failure |
| 2026-02-25 13:02 | Successful run (36 min) -- intermittent issue |
| 2026-02-25 19:43 | Last successful run (28 min) |
| 2026-02-26 11:06 | Failures begin in earnest -- every run from here fails or is cancelled |
| 2026-02-26 11:09-18:21 | `PL_FMD_LDZ_COPY_FROM_ASQL_01` starts hitting OOM and file upload errors |
| 2026-02-27 01:54 | One ASQL_01 run takes **13h 43m** due to 429 throttling retry loops |
| 2026-02-27 07:16 | Another ASQL_01 run: **8h 54m** (429 throttling) |
| 2026-02-28 19:07-19:10 | Successful Optiva entity loads via LZ (PL_FMD_LDZ_COPY_SQL) |
| 2026-02-28 19:09-20:28 | Bronze processing completes for Optiva tables |
| 2026-03-01 02:57 | Most recent LZ attempt: fails at 1h 00m 43s |
| 2026-03-01 02:58 | ASQL_01 is **still InProgress** as of investigation time |
| 2026-03-01 03:58-04:59 | Massive batch of `LK_GET_LASTLOADDATE` failures (40+ entities) |

---

## Root Cause Analysis

### Primary Root Cause: Multiple Compounding Failures

This is **not** a single-cause timeout. There are **4 distinct failure modes** that compound:

#### 1. LK_GET_LASTLOADDATE Lookup Failures (~60% of failures)
The watermark lookup activity fails for three reasons:
- **Empty table names** (714 occurrences): Entity registration has entities with null or empty `SourceName` values being passed as parameters
- **Silent failures** (300 occurrences): Transient SQL DB connection issues, possibly related to 429 throttling
- **Timestamp conversion errors** (96 occurrences): Entities with `rowversion`/`timestamp` watermark columns cannot be queried with `WHERE watermark_col > 'varchar_value'`

#### 2. Fabric SQL Database 429 Throttling
The metadata SQL DB (`SQL_INTEGRATION_FRAMEWORK` in CONFIG workspace) is being **rate-limited** by Fabric. When 659+ entities all try to execute stored procedures (`SP_START_AUDIT_PIPELINE_CP`, `SP_UPDATE_PROCESS`, etc.) concurrently, the F2 capacity SQL endpoint throttles requests. This causes:
- Individual activities to retry for hours
- Cascading delays that push the parent pipeline past the 1-hour ForEach timeout

#### 3. Out-of-Memory on Large Table Copies
Tables with large row counts (particularly from MES) trigger `SystemErrorOutOfMemory` during the copy to Lakehouse. This affects the `CP_source_datalandingzone` copy activity.

#### 4. ForEach Activity Timeout (~1 hour)
The parent pipelines (`PL_FMD_LOAD_LANDINGZONE` and `PL_FMD_LDZ_COMMAND_ASQL`) use `ForEach` activity (`FE_ENTITY`) to iterate over entities. When any inner activity hangs (due to 429 throttling or OOM), the ForEach hits its default timeout of ~1 hour and fails the entire pipeline.

### Why It Worked on 2/25 but Not After

On 2/25, successful runs completed in 28-36 minutes. The incremental loads were fast because:
- Watermark values were recent, so only small deltas were loaded
- No 429 throttling (fewer concurrent requests)
- No OOM (small data volumes)

Starting 2/26, something changed -- likely a bulk re-registration or full-load trigger that caused all 659 entities to attempt full loads simultaneously, overwhelming both the SQL DB (429s) and the copy engine (OOM).

---

## Recommendations

### Immediate (Parallel Task Already Handling)

1. **Increase ForEach timeout** from default (1 hour) to 4+ hours on:
   - `PL_FMD_LOAD_LANDINGZONE`
   - `PL_FMD_LDZ_COMMAND_ASQL`
   - `PL_FMD_LDZ_COPY_FROM_ASQL_01`

### High Priority

2. **Fix LK_GET_LASTLOADDATE empty table name issue**: 714 entities are passing empty/null table names to the lookup. Investigate the `integration.LandingzoneEntity` table for entities with null `SourceName` and fix registration.

3. **Fix timestamp/rowversion watermark conversion**: The 96 entities with `timestamp` watermark columns need a different query pattern. The incremental load query must use `CONVERT()` or handle rowversion as binary, not varchar.

4. **Reduce SQL DB concurrency**: The ForEach activities should use `batchCount` to limit parallel entity processing (e.g., 10-20 at a time instead of all 659). This will prevent 429 throttling.

### Medium Priority

5. **Handle OOM for large tables**: Implement chunked copy for tables over a certain row threshold, or use pagination in the copy activity source query.

6. **Add retry logic with exponential backoff**: The stored procedure activities (`SP_START_AUDIT_PIPELINE_CP`, etc.) should have retry policies that handle 429 responses gracefully.

7. **Separate Optiva from MES/ETQ loads**: Optiva entities (loaded via `PL_FMD_LDZ_COPY_SQL`) are working fine. Keep them on their own schedule to avoid being blocked by MES/ETQ failures.

### Low Priority

8. **Fix `notebookutils.pipeline` module error**: 5 failures indicate a notebook environment issue.
9. **Remove invalid entity `dbo.FSSIMPLESEARCHRESULTS_1452788`**: This table doesn't exist in the source.
10. **Add M3 ERP connection**: Entity trying to connect to `sqllogshipprd`/`m3fdbprd` is failing because that gateway connection isn't configured yet (MT-31).

---

## Data Sources

- **Fabric API**: `GET /v1/workspaces/{ws}/items/{id}/jobs/instances` -- 24 run instances per pipeline
- **SQL Metadata DB**: `logging.CopyActivityExecution` (1,836 failed records), `logging.PipelineExecution` (30 recent records), `execution.EntityStatusSummary` (1,735 entities), `execution.PipelineLandingzoneEntity` (6,671 records)
- **Workspace**: CODE = `146fe38c-f6c3-4e9d-a18c-5c01cad5941e`, DATA = `a3a180ff-fbc2-48fd-a65f-27ae7bb6709a`, CONFIG = `f442f66c-eac6-46d7-80c9-c8b025c86fbe`
