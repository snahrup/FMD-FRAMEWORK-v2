# Silver Pipeline Debugging Log

## Problem Statement
Silver layer is 0% loaded across ALL 1,572 entities despite Silver pipeline completing successfully.

## Evidence Gathered

### 1. Silver pipeline runs and shows "Completed" in Fabric API
- 3/01 04:00→04:03 (3 min) = Completed
- 2/28 22:34→23:38 (1 hr) = Completed
- Multiple earlier runs also Completed

### 2. Silver notebook IS executing
- `logging.NotebookExecution` WHERE EntityLayer='Silver':
  - 3,695 StartNotebookActivity entries
  - 2,077 EndNotebookActivity entries (ALL successful, no Failed entries)
  - ~1,618 notebooks started but never logged End (44% failure rate)
- All End entries show Optiva tables (OPTIVA_*) with 6-54 second runtimes

### 3. PipelineBronzeLayerEntity: 2,084 processed, 3 unprocessed
- 2,081 have LoadEndDateTime set (dates match Silver pipeline run times)
- This confirms Silver IS marking Bronze records as processed
- The Silver notebook calls `sp_UpsertPipelineBronzeLayerEntity` with @IsProcessed="True" (line 179-184)

### 4. PipelineSilverLayerEntity: 0 records
- This is the critical gap
- The Silver notebook calls `sp_UpsertPipelineSilverLayerEntity` (line 187-192, called at lines 454 and 765)

### 5. EntityStatusSummary: Silver = not_started for ALL 1,572 entities
- Silver notebook calls `sp_UpsertEntityStatus` with @Layer='silver' (line 235-241)
- BUT it passes BronzeLayerEntityId as @LandingzoneEntityId (BUG - see below)

### 6. Stored proc test: sp_UpsertPipelineSilverLayerEntity WORKS manually
- Direct EXEC via pyodbc successfully inserted a test record
- Proc logic is correct: IF NOT EXISTS → INSERT, ELSE IF @IsProcessed=1 → UPDATE

## Root Cause Hypotheses

### CONFIRMED BUG #1: EntityStatus uses wrong ID
**File**: `NB_FMD_LOAD_BRONZE_SILVER.Notebook/notebook-content.py` line 237
```python
UpsertEntityStatusLoaded = (
    f"[execution].[sp_UpsertEntityStatus] "
    f"@LandingzoneEntityId = {BronzeLayerEntityId}, "  # WRONG! Should be LandingzoneEntityId
    f"@Layer = 'silver', "
    f"@Status = 'loaded', "
    f"@UpdatedBy = 'notebook-silver'"
)
```
- The notebook receives BronzeLayerEntityId from params but NOT LandingzoneEntityId
- It passes BronzeLayerEntityId as @LandingzoneEntityId
- The proc looks up by LandingzoneEntityId, so it either updates the wrong entity or no entity
- This is why EntityStatusSummary shows Silver=not_started for everything
- This is wrapped in try/except so it fails silently

### HYPOTHESIS #2: sp_UpsertPipelineSilverLayerEntity has no output SELECT
**File**: Stored proc `execution.sp_UpsertPipelineSilverLayerEntity`
- The Bronze proc (`sp_UpsertPipelineBronzeLayerEntity`) ends with:
  ```sql
  SELECT @BronzeLayerEntityId AS BronzeLayerEntityId, ...
  ```
- The Silver proc does NOT have this output SELECT
- The notebook uses `execute_with_outputs()` (defined in NB_FMD_UTILITY_FUNCTIONS)
- If `execute_with_outputs` expects a result set and doesn't get one, it might:
  - Not commit the transaction
  - Silently swallow the error
  - Skip the operation entirely
- **This would explain why PipelineSilverLayerEntity has 0 records**
- **NEEDS VERIFICATION**: Check `execute_with_outputs` implementation in NB_FMD_UTILITY_FUNCTIONS

### HYPOTHESIS #3: execute_with_outputs may not autocommit
- My manual test worked because I called `conn.commit()` explicitly
- If `execute_with_outputs` doesn't commit, the INSERT would be rolled back
- But then `sp_UpsertPipelineBronzeLayerEntity` (called on the same connection) would also not commit
- Yet Bronze records ARE updated... so this hypothesis is UNLIKELY unless the Bronze proc's SELECT output triggers different behavior

## Next Steps
1. **Check NB_FMD_UTILITY_FUNCTIONS** for `execute_with_outputs` implementation
2. **Fix sp_UpsertPipelineSilverLayerEntity** to add output SELECT (match Bronze pattern)
3. **Fix EntityStatus bug** - resolve LandingzoneEntityId from BronzeLayerEntityId chain
4. **Re-upload Silver notebook to Fabric**
5. **Reset PipelineBronzeLayerEntity** processed records back to 0 so Silver can reprocess
6. **Run LOAD_ALL** to test end-to-end

## Key File Locations
- Silver notebook: `src/NB_FMD_LOAD_BRONZE_SILVER.Notebook/notebook-content.py`
- Utility functions: `src/NB_FMD_UTILITY_FUNCTIONS.Notebook/` (need to find)
- Silver pipeline: `src/PL_FMD_LOAD_SILVER.DataPipeline/pipeline-content.json`
- Parallel runner: `src/NB_FMD_PROCESSING_PARALLEL_MAIN.Notebook/notebook-content.py`
- Silver stored procs: `execution.sp_UpsertPipelineSilverLayerEntity`, `execution.sp_GetSilverlayerEntity`, `execution.sp_GetSilverlayerEntity_Full`
