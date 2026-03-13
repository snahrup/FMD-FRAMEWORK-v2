# AUDIT: DataManager.tsx — Data Source Correctness

**Date**: 2026-03-13
**Page**: `dashboard/app/src/pages/DataManager.tsx`
**Backend**: `dashboard/app/api/routes/data_manager.py`
**DB Layer**: `dashboard/app/api/db.py` (thin wrapper around `fmd_control_plane.db`)

---

## API Calls Made by Frontend

| # | API Call | Trigger | Used For |
|---|----------|---------|----------|
| 1 | `GET /api/data-manager/tables` | Initial load | Sidebar table list with row counts |
| 2 | `GET /api/data-manager/table/{name}` | Table selection | Paginated table data, column metadata, FK resolution |
| 3 | `PUT /api/data-manager/table/{name}/{pk}` | Save row edit | Update single row in editable table |

---

## Route 1: `GET /api/data-manager/tables` -> `list_tables()`

### Logic
Iterates `TABLE_REGISTRY` (hardcoded Python dict defining all exposed tables) and runs `SELECT COUNT(*) FROM [{table_name}]` for each.

### Tables Registered

| Table Name | Display Name | Category | Editable | DB Row Count |
|------------|-------------|----------|----------|-------------|
| `connections` | Connections | Source Systems | Yes | 10 |
| `datasources` | Data Sources | Source Systems | Yes | 8 |
| `lz_entities` | Landing Zone Entities | Data Entities | Yes | 1666 |
| `bronze_entities` | Bronze Layer Entities | Data Entities | Yes | 1666 |
| `silver_entities` | Silver Layer Entities | Data Entities | Yes | 1666 |
| `entity_status` | Entity Load Status | Load Status | No | 4998 |
| `watermarks` | Incremental Watermarks | Load Status | No | 0 |
| `engine_runs` | Engine Runs | Run History | No | 4 |
| `engine_task_log` | Task Execution Log | Run History | No | 0 |
| `pipeline_lz_entity` | Landing Zone Queue | Pipeline Queues | No | **0** |
| `pipeline_bronze_entity` | Bronze Queue | Pipeline Queues | No | **0** |
| `pipeline_audit` | Pipeline Audit Log | Audit Trail | No | 4 |
| `notebook_executions` | Notebook Executions | Audit Trail | No | 0 |

**CORRECT**: All table names match actual SQLite tables. Row counts are live from `SELECT COUNT(*)`.

### Empty Tables Exposed

The Data Manager exposes `pipeline_lz_entity` (0 rows) and `pipeline_bronze_entity` (0 rows) in the "Pipeline Queues" category. These are correctly labeled as read-only queues. They will show "No data in this table" in the grid.

**INFO**: Not a bug. The Data Manager is a database explorer — showing empty tables is expected behavior. The user can see these tables exist but have no data, which is informative (it means the Fabric pipeline queue mechanism hasn't been used).

---

## Route 2: `GET /api/data-manager/table/{name}` -> `get_table_data()`

### SQL Query Pattern
```sql
SELECT [{col1}], [{col2}], ... FROM [{table_name}]
[WHERE (...search conditions...)]
[ORDER BY [{sort_col}] ASC|DESC]
LIMIT ? OFFSET ?
```

Columns are defined per-table in `TABLE_REGISTRY`. Let me verify each table's column definitions match the actual schema.

### Table: `connections`

| Registry Column | Actual DB Column | Type | Match? |
|----------------|-----------------|------|--------|
| `ConnectionId` | `ConnectionId INTEGER PRIMARY KEY` | hidden | CORRECT |
| `DisplayName` | `DisplayName TEXT` | editable text | CORRECT |
| `Name` | `Name TEXT NOT NULL` | text | CORRECT |
| `Type` | `Type TEXT` | editable text | CORRECT |
| `ServerName` | `ServerName TEXT` | editable text | CORRECT |
| `DatabaseName` | `DatabaseName TEXT` | editable text | CORRECT |
| `IsActive` | `IsActive INTEGER DEFAULT 1` | editable boolean | CORRECT |
| `updated_at` | `updated_at TEXT` | datetime | CORRECT |

**CORRECT**: All columns exist in schema.

### Table: `datasources`

| Registry Column | Actual DB Column | Type | Match? |
|----------------|-----------------|------|--------|
| `DataSourceId` | `DataSourceId INTEGER PRIMARY KEY` | hidden | CORRECT |
| `DisplayName` | `DisplayName TEXT` | editable text | CORRECT |
| `Name` | `Name TEXT NOT NULL` | text | CORRECT |
| `ConnectionId` | `ConnectionId INTEGER NOT NULL` | editable FK -> connections.Name | CORRECT |
| `Namespace` | `Namespace TEXT` | text | CORRECT |
| `Type` | `Type TEXT` | text | CORRECT |
| `Description` | `Description TEXT` | editable text | CORRECT |
| `IsActive` | `IsActive INTEGER DEFAULT 1` | editable boolean | CORRECT |
| `updated_at` | `updated_at TEXT` | datetime | CORRECT |

**CORRECT**: FK relationship `ConnectionId -> connections.ConnectionId` with display=`Name` is correct.

### Table: `lz_entities`

| Registry Column | Actual DB Column | Type | Match? |
|----------------|-----------------|------|--------|
| `LandingzoneEntityId` | `LandingzoneEntityId INTEGER PRIMARY KEY` | hidden | CORRECT |
| `DataSourceId` | `DataSourceId INTEGER NOT NULL` | FK -> datasources.Name | CORRECT |
| `SourceSchema` | `SourceSchema TEXT` | text | CORRECT |
| `SourceName` | `SourceName TEXT NOT NULL` | text | CORRECT |
| `FileName` | `FileName TEXT` | text | CORRECT |
| `FilePath` | `FilePath TEXT` | text | CORRECT |
| `FileType` | `FileType TEXT DEFAULT 'parquet'` | text | CORRECT |
| `IsIncremental` | `IsIncremental INTEGER DEFAULT 0` | editable boolean | CORRECT |
| `IsIncrementalColumn` | `IsIncrementalColumn TEXT` | editable text | CORRECT |
| `SourceCustomSelect` | `SourceCustomSelect TEXT` | editable text | CORRECT |
| `CustomNotebookName` | `CustomNotebookName TEXT` | editable text | CORRECT |
| `IsActive` | `IsActive INTEGER DEFAULT 1` | editable boolean | CORRECT |
| `updated_at` | `updated_at TEXT` | datetime | CORRECT |

**CORRECT**: All columns exist. FK `DataSourceId -> datasources.DataSourceId` with display=`Name` is correct.

**Note**: `LakehouseId` column exists in schema but is NOT exposed in the registry. This is intentional — it's an internal FK not useful for business users.

### Table: `bronze_entities`

| Registry Column | Actual DB Column | Type | Match? |
|----------------|-----------------|------|--------|
| `BronzeLayerEntityId` | `BronzeLayerEntityId INTEGER PRIMARY KEY` | hidden | CORRECT |
| `LandingzoneEntityId` | `LandingzoneEntityId INTEGER NOT NULL` | FK -> lz_entities.SourceName | CORRECT |
| `Schema_` | `Schema_ TEXT` | text | CORRECT |
| `Name` | `Name TEXT NOT NULL` | text | CORRECT |
| `PrimaryKeys` | `PrimaryKeys TEXT` | editable text | CORRECT |
| `FileType` | `FileType TEXT DEFAULT 'Delta'` | text | CORRECT |
| `IsActive` | `IsActive INTEGER DEFAULT 1` | editable boolean | CORRECT |
| `updated_at` | `updated_at TEXT` | datetime | CORRECT |

**CORRECT**: FK `LandingzoneEntityId -> lz_entities.LandingzoneEntityId` with display=`SourceName` is correct and useful (shows the source table name instead of a raw ID).

### Table: `silver_entities`

| Registry Column | Actual DB Column | Type | Match? |
|----------------|-----------------|------|--------|
| `SilverLayerEntityId` | `SilverLayerEntityId INTEGER PRIMARY KEY` | hidden | CORRECT |
| `BronzeLayerEntityId` | `BronzeLayerEntityId INTEGER NOT NULL` | FK -> bronze_entities.Name | CORRECT |
| `Schema_` | `Schema_ TEXT` | text | CORRECT |
| `Name` | `Name TEXT NOT NULL` | text | CORRECT |
| `FileType` | `FileType TEXT DEFAULT 'delta'` | text | CORRECT |
| `IsActive` | `IsActive INTEGER DEFAULT 1` | editable boolean | CORRECT |
| `updated_at` | `updated_at TEXT` | datetime | CORRECT |

**CORRECT**: FK `BronzeLayerEntityId -> bronze_entities.BronzeLayerEntityId` with display=`Name` is correct.

### Table: `entity_status`

| Registry Column | Actual DB Column | Type | Match? |
|----------------|-----------------|------|--------|
| `LandingzoneEntityId` | `LandingzoneEntityId INTEGER NOT NULL` | FK -> lz_entities.SourceName | CORRECT |
| `Layer` | `Layer TEXT NOT NULL` | text | CORRECT |
| `Status` | `Status TEXT` | text | CORRECT |
| `LoadEndDateTime` | `LoadEndDateTime TEXT` | datetime | CORRECT |
| `ErrorMessage` | `ErrorMessage TEXT` | text | CORRECT |
| `UpdatedBy` | `UpdatedBy TEXT` | text | CORRECT |

**CORRECT**: Composite PK `(LandingzoneEntityId, Layer)` is correctly defined. Read-only, no editable fields. The Status column correctly shows processing status values ('loaded', 'not_started', etc.), not IsActive.

### Table: `watermarks`

| Registry Column | Actual DB Column | Type | Match? |
|----------------|-----------------|------|--------|
| `LandingzoneEntityId` | `LandingzoneEntityId INTEGER PRIMARY KEY` | FK -> lz_entities.SourceName | CORRECT |
| `LoadValue` | `LoadValue TEXT` | text | CORRECT |
| `LastLoadDatetime` | `LastLoadDatetime TEXT` | datetime | CORRECT |

**CORRECT**: 0 rows currently but schema mapping is accurate.

### Table: `engine_runs`

| Registry Column | Actual DB Column | Match? |
|----------------|-----------------|--------|
| `RunId` | `RunId TEXT PRIMARY KEY` | CORRECT |
| `Mode` | `Mode TEXT` | CORRECT |
| `Status` | `Status TEXT NOT NULL` | CORRECT |
| `TotalEntities` | `TotalEntities INTEGER DEFAULT 0` | CORRECT |
| `SucceededEntities` | `SucceededEntities INTEGER DEFAULT 0` | CORRECT |
| `FailedEntities` | `FailedEntities INTEGER DEFAULT 0` | CORRECT |
| `SkippedEntities` | `SkippedEntities INTEGER DEFAULT 0` | CORRECT |
| `TotalRowsRead` | `TotalRowsRead INTEGER DEFAULT 0` | CORRECT |
| `TotalRowsWritten` | `TotalRowsWritten INTEGER DEFAULT 0` | CORRECT |
| `TotalDurationSeconds` | `TotalDurationSeconds REAL DEFAULT 0` | CORRECT |
| `Layers` | `Layers TEXT` | CORRECT |
| `TriggeredBy` | `TriggeredBy TEXT` | CORRECT |
| `StartedAt` | `StartedAt TEXT` | CORRECT |
| `EndedAt` | `EndedAt TEXT` | CORRECT |

**CORRECT**: All columns match. Note: `TotalBytesTransferred` and `ErrorSummary` exist in schema but are not exposed — intentional omission for cleaner display.

### Table: `engine_task_log`

| Registry Column | Actual DB Column | Match? |
|----------------|-----------------|--------|
| `id` | `id INTEGER PRIMARY KEY AUTOINCREMENT` | CORRECT (hidden) |
| `RunId` | `RunId TEXT NOT NULL` | CORRECT |
| `EntityId` | `EntityId INTEGER NOT NULL` | CORRECT |
| `Layer` | `Layer TEXT` | CORRECT |
| `Status` | `Status TEXT NOT NULL` | CORRECT |
| `SourceTable` | `SourceTable TEXT` | CORRECT |
| `RowsRead` | `RowsRead INTEGER DEFAULT 0` | CORRECT |
| `RowsWritten` | `RowsWritten INTEGER DEFAULT 0` | CORRECT |
| `DurationSeconds` | `DurationSeconds REAL DEFAULT 0` | CORRECT |
| `LoadType` | `LoadType TEXT` | CORRECT |
| `ErrorType` | `ErrorType TEXT` | CORRECT |
| `ErrorMessage` | `ErrorMessage TEXT` | CORRECT |

**CORRECT**: Subset of available columns — intentional for usability.

### Table: `pipeline_lz_entity` (EMPTY — 0 rows)

| Registry Column | Actual DB Column | Match? |
|----------------|-----------------|--------|
| `id` | `id INTEGER PRIMARY KEY AUTOINCREMENT` | CORRECT (hidden) |
| `LandingzoneEntityId` | `LandingzoneEntityId INTEGER NOT NULL` | CORRECT (FK -> lz_entities.SourceName) |
| `FileName` | `FileName TEXT` | CORRECT |
| `FilePath` | `FilePath TEXT` | CORRECT |
| `InsertDateTime` | `InsertDateTime TEXT` | CORRECT |
| `IsProcessed` | `IsProcessed INTEGER DEFAULT 0` | CORRECT |

**CORRECT**: Schema matches. Table is empty because the Fabric pipeline LZ queue mechanism hasn't populated it.

### Table: `pipeline_bronze_entity` (EMPTY — 0 rows)

| Registry Column | Actual DB Column | Match? |
|----------------|-----------------|--------|
| `id` | `id INTEGER PRIMARY KEY AUTOINCREMENT` | CORRECT (hidden) |
| `BronzeLayerEntityId` | `BronzeLayerEntityId INTEGER NOT NULL` | CORRECT (FK -> bronze_entities.Name) |
| `TableName` | `TableName TEXT` | CORRECT |
| `SchemaName` | `SchemaName TEXT` | CORRECT |
| `InsertDateTime` | `InsertDateTime TEXT` | CORRECT |
| `IsProcessed` | `IsProcessed INTEGER DEFAULT 0` | CORRECT |

**CORRECT**: Schema matches. Table is empty for the same reason.

### Table: `pipeline_audit`

| Registry Column | Actual DB Column | Match? |
|----------------|-----------------|--------|
| `id` | `id INTEGER PRIMARY KEY AUTOINCREMENT` | CORRECT (hidden) |
| `PipelineRunGuid` | `PipelineRunGuid TEXT` | CORRECT |
| `PipelineName` | `PipelineName TEXT` | CORRECT |
| `EntityLayer` | `EntityLayer TEXT` | CORRECT |
| `TriggerType` | `TriggerType TEXT` | CORRECT |
| `LogType` | `LogType TEXT` | CORRECT |
| `LogDateTime` | `LogDateTime TEXT` | CORRECT |
| `EntityId` | `EntityId INTEGER` | CORRECT |

**CORRECT**: LogData column exists in schema but is not exposed — intentional (it's raw JSON that's not user-friendly).

### Table: `notebook_executions`

| Registry Column | Actual DB Column | Match? |
|----------------|-----------------|--------|
| `id` | `id INTEGER PRIMARY KEY AUTOINCREMENT` | CORRECT (hidden) |
| `NotebookName` | `NotebookName TEXT` | CORRECT |
| `PipelineRunGuid` | `PipelineRunGuid TEXT` | CORRECT |
| `EntityId` | `EntityId INTEGER` | CORRECT |
| `EntityLayer` | `EntityLayer TEXT` | CORRECT |
| `Status` | `Status TEXT` | CORRECT |
| `LogType` | `LogType TEXT` | CORRECT |
| `StartedAt` | `StartedAt TEXT` | CORRECT |
| `EndedAt` | `EndedAt TEXT` | CORRECT |

**CORRECT**: All columns match schema.

---

## Route 3: `PUT /api/data-manager/table/{name}/{pk}` -> `update_row()`

### Write Logic
1. Validates table exists in registry and is editable
2. Parses composite PK from URL
3. Extracts only editable columns from request body
4. Validates boolean types (converts to 0/1)
5. Validates FK references exist in target table
6. Executes: `UPDATE [{table}] SET [{col}] = ? WHERE [{pk_col}] = ?`

**CORRECT**: The update mechanism is sound. Only editable columns can be modified. FK validation prevents orphan references. The `_queue_export()` call triggers Parquet sync after writes.

### Editable Column Safety

| Table | Editable Columns | Safe? |
|-------|-----------------|-------|
| `connections` | DisplayName, Type, ServerName, DatabaseName, IsActive | CORRECT — config columns only |
| `datasources` | DisplayName, ConnectionId, Description, IsActive | CORRECT |
| `lz_entities` | IsIncremental, IsIncrementalColumn, SourceCustomSelect, CustomNotebookName, IsActive | CORRECT — load config + status |
| `bronze_entities` | PrimaryKeys, IsActive | CORRECT |
| `silver_entities` | IsActive | CORRECT |

**CORRECT**: PK columns, timestamps, and structural FKs (DataSourceId, LandingzoneEntityId, BronzeLayerEntityId) are NOT editable. Only business-configurable fields are exposed.

---

## IsActive vs Processing Status Confusion Check

| Table | Column | Registry Type | Purpose | Correct? |
|-------|--------|---------------|---------|----------|
| `connections.IsActive` | boolean | Editable | Registration active flag | CORRECT |
| `datasources.IsActive` | boolean | Editable | Registration active flag | CORRECT |
| `lz_entities.IsActive` | boolean | Editable | Entity registration active flag | CORRECT |
| `bronze_entities.IsActive` | boolean | Editable | Entity registration active flag | CORRECT |
| `silver_entities.IsActive` | boolean | Editable | Entity registration active flag | CORRECT |
| `entity_status.Status` | text | Read-only | Processing status (loaded/not_started) | CORRECT |

**No confusion.** The Data Manager correctly separates:
- `IsActive` (boolean, editable) = "Is this entity/source enabled for pipeline processing?"
- `entity_status.Status` (text, read-only) = "What is the last processing outcome for this entity?"

These are displayed in different tables under different categories (Data Entities vs Load Status).

---

## FK Resolution Correctness

| FK Column | FK Table | FK Display | FK PK | Correct? |
|-----------|----------|-----------|-------|----------|
| `datasources.ConnectionId` | `connections` | `Name` | `ConnectionId` | CORRECT |
| `lz_entities.DataSourceId` | `datasources` | `Name` | `DataSourceId` | CORRECT |
| `bronze_entities.LandingzoneEntityId` | `lz_entities` | `SourceName` | `LandingzoneEntityId` | CORRECT |
| `silver_entities.BronzeLayerEntityId` | `bronze_entities` | `Name` | `BronzeLayerEntityId` | CORRECT |
| `entity_status.LandingzoneEntityId` | `lz_entities` | `SourceName` | `LandingzoneEntityId` | CORRECT |
| `watermarks.LandingzoneEntityId` | `lz_entities` | `SourceName` | `LandingzoneEntityId` | CORRECT |
| `pipeline_lz_entity.LandingzoneEntityId` | `lz_entities` | `SourceName` | `LandingzoneEntityId` | CORRECT |
| `pipeline_bronze_entity.BronzeLayerEntityId` | `bronze_entities` | `Name` | `BronzeLayerEntityId` | CORRECT |

**All FK resolutions are correct.** Display columns are human-readable (entity/table names instead of raw IDs).

---

## Tables NOT in Registry (intentionally omitted)

| Table | Rows | Why Omitted |
|-------|------|-------------|
| `copy_activity_audit` | 0 | Verbose pipeline logging — not useful for business users |
| `sync_metadata` | 1 | Internal sync tracking |
| `admin_config` | 0 | Internal dashboard settings |
| `import_jobs` | 0 | Transient import state |
| `SourceOnboarding` | 0 | Onboarding wizard state |
| `server_labels` | 0 | SQL Explorer display config |

**CORRECT**: These are internal/operational tables. Omitting them from the Data Manager is the right call.

---

## Summary

| Category | Finding | Severity |
|----------|---------|----------|
| CORRECT | All 13 registered tables have column definitions matching actual SQLite schema | - |
| CORRECT | All FK resolutions point to correct tables with correct PK/display columns | - |
| CORRECT | IsActive (registration) and entity_status.Status (processing) are in separate tables, never confused | - |
| CORRECT | Editable columns are limited to safe business-configurable fields; PKs and structural FKs are read-only | - |
| CORRECT | Empty tables (pipeline_lz_entity, pipeline_bronze_entity) are shown as read-only queues — expected behavior | - |
| CORRECT | Row counts use live `SELECT COUNT(*)` — always accurate | - |
| INFO | `pipeline_lz_entity` and `pipeline_bronze_entity` are exposed but always show 0 rows — technically correct but could confuse users | Informational |
| INFO | 6 internal tables (copy_activity_audit, sync_metadata, admin_config, import_jobs, SourceOnboarding, server_labels) are correctly excluded from the registry | - |
