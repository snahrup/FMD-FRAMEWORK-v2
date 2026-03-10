# TOOLS.md -- Engine Lead Available Tools

## Access Policy

You have **read-write** access to `engine/` and `engine/tests/`. Read-only everywhere else. SQL writes go through stored procs only. Destructive operations require CTO approval.

---

## 1. Paperclip API (Task Management)

Base URL: Injected via `PAPERCLIP_API_URL` env var.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agents/me` | GET | Confirm identity, role, chain of command |
| `/api/companies/{companyId}/issues` | GET | List your assigned tasks |
| `/api/issues/{id}` | GET | Read task details |
| `/api/issues/{id}` | PATCH | Update status (include specific test results) |
| `/api/issues/{id}/checkout` | POST | Claim a task (409 = claimed by another, skip) |
| `/api/issues/{id}/comments` | POST | Progress updates (always include test counts) |

**Headers**: Always include `X-Paperclip-Run-Id` on POST/PATCH.

---

## 2. Nexus API (Cross-Session Coordination)

Base URL: `http://localhost:3777`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/messages/unread/{sessionId}` | GET | Check for alerts about engine issues |
| `/api/messages` | POST | Alert CTO about engine failures or data loss risks |
| `/api/memory/context` | GET | Read shared context (CTO decisions, peer updates) |
| `/api/memory` | POST | Share engine discoveries and heartbeat summaries |

---

## 3. mssql-powerdata (Fabric SQL Metadata DB) -- PRIMARY TOOL

This is your most-used tool. The metadata DB is the engine's brain.

### Key Tables (Read)

| Schema | Table | What It Holds |
|--------|-------|---------------|
| `integration` | `LandingzoneEntity` | All 659 entity definitions (source, schema, table, GUIDs, IsActive) |
| `integration` | `BronzeLayerEntity` | Bronze layer entity config (1:1 with LZ entities) |
| `integration` | `SilverLayerEntity` | Silver layer entity config (1:1 with Bronze entities) |
| `integration` | `PipelineLandingzoneEntity` | LZ pipeline queue (must be populated for runs) |
| `integration` | `PipelineBronzeLayerEntity` | Bronze pipeline queue |
| `integration` | `DataSource` | Source system definitions (MES=4, M3Cloud=7, ETQ=9) |
| `execution` | `LandingzoneEntityLastLoadValue` | Watermark positions per entity (SACRED -- do not corrupt) |
| `execution` | `EntityStatusSummary` | Aggregated entity status across layers |
| `execution` | `EngineRun` | Engine run records (lifecycle tracking) |
| `execution` | `EngineTaskLog` | Per-task granular execution logs |

### Stored Procs (Write Path -- ONLY Way to Write)

| Proc | Purpose | Key Params |
|------|---------|------------|
| `sp_UpsertLandingzoneEntity` | Register/update LZ entity | @DataSourceId, @SchemaName, @TableName, @IsActive |
| `sp_UpsertPipelineLandingzoneEntity` | Populate LZ pipeline queue | @LandingzoneEntityId |
| `sp_AuditPipeline` | Log pipeline execution | @PipelineRunId, @PipelineName, @Status |
| `sp_AuditCopyActivity` | Log copy activity details | @PipelineRunId, @EntityId, @RowsCopied, @Duration |
| `sp_UpsertEngineRun` | Create/update engine run record | @RunId, @RunType, @Status, @EntityCount |
| `sp_InsertEngineTaskLog` | Log individual task within a run | @RunId, @TaskName, @EntityId, @Status, @Message |
| `sp_UpsertEntityStatus` | Update entity layer status | @EntityId, @Layer, @Status, @RowCount |
| `sp_BuildEntityDigest` | Rebuild entity status digest | (no params -- reads EntityStatusSummary with 6-table fallback) |

### Common Diagnostic Queries

```sql
-- Entity health overview
SELECT DataSourceId, COUNT(*) as total,
       SUM(CASE WHEN IsActive=1 THEN 1 ELSE 0 END) as active
FROM integration.LandingzoneEntity GROUP BY DataSourceId

-- Recent engine runs
SELECT TOP 10 RunId, RunType, Status, EntityCount, StartedAt, CompletedAt
FROM execution.EngineRun ORDER BY StartedAt DESC

-- Failed tasks in last 24h
SELECT TaskName, EntityId, Status, Message, DurationMs
FROM execution.EngineTaskLog
WHERE Status = 'Failed' AND CreatedAt > DATEADD(hour, -24, GETUTCDATE())

-- Watermark health check (entities with null or suspiciously old watermarks)
SELECT e.TableName, lv.LastLoadValue, lv.LastLoadDate
FROM execution.LandingzoneEntityLastLoadValue lv
JOIN integration.LandingzoneEntity e ON e.LandingzoneEntityId = lv.LandingzoneEntityId
WHERE lv.LastLoadValue IS NULL OR lv.LastLoadDate < DATEADD(day, -7, GETUTCDATE())

-- Queue population check
SELECT 'LZ' as layer, COUNT(*) as queued FROM integration.PipelineLandingzoneEntity
UNION ALL SELECT 'Bronze', COUNT(*) FROM integration.PipelineBronzeLayerEntity
```

### Auth Pattern (Reference)
```python
import struct
token_bytes = token.encode('utf-8')
attrs_before = {1256: struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)}
# Scope: https://analysis.windows.net/powerbi/api/.default (NOT database.windows.net)
```

---

## 4. mssql-m3-fdb, mssql-m3-etl, mssql-mes (On-Prem Sources)

**Requires VPN.** Use for source schema inspection and row count verification.

| Server | Alias | Database | Entity Count |
|--------|-------|----------|--------------|
| `m3-db1` | mssql-mes | `mes` | 445 (DS 4) |
| `M3-DB3` | mssql-m3-etl | `ETQStagingPRD` | 29 (DS 9) |
| `sql2016live` | mssql-m3-etl | `DI_PRD_Staging` | 185 (DS 7) |
| `sqllogshipprd` | mssql-m3-fdb | `m3fdbprd` | 3973 (not yet registered) |

- Auth: Windows auth (`Trusted_Connection=yes`)
- Driver: ODBC Driver 18 for SQL Server
- Do NOT use `.ipaper.com` suffix

Common use: Verify source row counts match what the engine loaded.

---

## 5. fabric-mcp (Fabric Platform)

Use for:
- Checking notebook job status when `notebook_trigger.py` reports issues.
- Verifying pipeline run status when `pipeline_runner.py` polls time out.
- Inspecting lakehouse metadata for entity path issues.

Key operations:
- List workspace items
- Get notebook/pipeline run status
- Check lakehouse file existence

---

## 6. Git (Local -- engine/ Only)

| Command | Purpose |
|---------|---------|
| `git diff engine/` | Review your uncommitted changes |
| `git log --oneline -5 -- engine/` | Recent engine commits |
| `git blame engine/{file}.py` | Understand change history for a specific file |

**Never run** `git reset`, `git checkout .`, or `git clean` on engine files without CTO approval.

---

## 7. Python Testing

```bash
# Run all engine tests
cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest engine/tests/ -v

# Run with coverage
cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest engine/tests/ --cov=engine --cov-report=term-missing

# Run a specific test file
cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest engine/tests/test_models.py -v

# Run tests matching a pattern
cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest engine/tests/ -k "watermark" -v
```

---

## 8. Engine API Endpoints

Base URL: `http://localhost:8787`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/engine/status` | GET | Current engine state |
| `/api/engine/runs` | GET | Recent run history |
| `/api/engine/preflight` | POST | Trigger preflight validation |
| `/api/engine/trigger` | POST | Trigger a load (LZ, Bronze, or Silver) |
| `/api/entity-digest` | GET | Entity status digest (reads EntityStatusSummary) |

---

## Tool Selection Guidelines

- **Load failure?** Start with `execution.EngineTaskLog` (failed tasks) -> `execution.EngineRun` (run context) -> `integration.LandingzoneEntity` (entity config) -> source DB (row counts).
- **Watermark issue?** Query `execution.LandingzoneEntityLastLoadValue` directly. Compare with source DB max values.
- **Queue empty?** Check `integration.PipelineLandingzoneEntity` and `PipelineBronzeLayerEntity`. If empty, the pipeline will process zero entities.
- **Entity not loading?** Check IsActive, check queue table, check watermark, check Fabric job status. In that order.
- **Test failure?** Run the specific test with `-v --tb=long`. Read the assertion. Read the code. Fix it or file it.
