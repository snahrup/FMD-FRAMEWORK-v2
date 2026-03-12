# Data Manager — Business-Friendly Database Explorer

**Date**: 2026-03-12
**Status**: Approved
**Route**: `/data-manager`
**Sidebar**: "Data Manager" in Data group

## Objective

Build a business-friendly page for browsing and editing the FMD control plane database (SQLite). Business users see human-readable table/column names, formatted values, FK-resolved references, and can inline-edit configuration rows — without ever seeing raw database internals.

## Architecture

### Layout

Two-panel layout:

- **Left sidebar** (~250px): Search input, collapsible category sections, table names with row counts, selected table highlighted
- **Main panel**: Table display name header with row count and editable badge, paginated data grid (50 rows/page), row-level edit mode, column-header sorting

### Route & Navigation

- Route: `/data-manager`
- Sidebar entry: "Data Manager" under **Data** group, between "Data Journey" and "Record Counts"
- Icon: `TableProperties` from lucide-react
- The existing Database Explorer (`/db-explorer`) remains as-is for developer/admin use. Both pages coexist.

## Table Registry

Each table entry in `TABLE_REGISTRY` defines:
- `displayName`: Human-readable table name
- `category`: Sidebar group
- `editable`: Whether rows can be edited
- `pk`: Primary key column(s) — string for single PK, list for composite
- `columns`: Ordered list of column configs (key, label, type, editable, hidden, fk)

### Primary Key Definitions

| Table | PK Column(s) | PK Type |
|---|---|---|
| `connections` | `ConnectionId` | Single integer |
| `datasources` | `DataSourceId` | Single integer |
| `lz_entities` | `LandingzoneEntityId` | Single integer |
| `bronze_entities` | `BronzeLayerEntityId` | Single integer |
| `silver_entities` | `SilverLayerEntityId` | Single integer |
| `entity_status` | `LandingzoneEntityId` + `Layer` | Composite |
| `watermarks` | `LandingzoneEntityId` | Single integer |
| `engine_runs` | `RunId` | Single text |
| `engine_task_log` | `id` | Single integer |
| `pipeline_lz_entity` | `id` | Single integer |
| `pipeline_bronze_entity` | `id` | Single integer |
| `pipeline_audit` | `id` | Single integer |
| `notebook_executions` | `id` | Single integer |

For composite PKs, `_pk` in the response is a JSON string (e.g., `"1|landing"`). The PUT path uses the same encoding.

### Visible Tables

| Category | Table | Display Name | Editable |
|---|---|---|---|
| **Source Systems** | `connections` | Connections | Yes |
| | `datasources` | Data Sources | Yes |
| **Data Entities** | `lz_entities` | Landing Zone Entities | Yes |
| | `bronze_entities` | Bronze Layer Entities | Yes |
| | `silver_entities` | Silver Layer Entities | Yes |
| **Load Status** | `entity_status` | Entity Load Status | No |
| | `watermarks` | Incremental Watermarks | No |
| **Run History** | `engine_runs` | Engine Runs | No |
| | `engine_task_log` | Task Execution Log | No |
| **Pipeline Queues** | `pipeline_lz_entity` | Landing Zone Queue | No |
| | `pipeline_bronze_entity` | Bronze Queue | No |
| **Audit Trail** | `pipeline_audit` | Pipeline Audit Log | No |
| | `notebook_executions` | Notebook Executions | No |

### Hidden Tables

`sync_metadata`, `admin_config`, `import_jobs`, `server_labels`, `workspaces`, `lakehouses`, `pipelines`, `copy_activity_audit`

## Column Treatment

### Hidden Columns

Internal PKs and autoincrement IDs are hidden from the grid but used internally for row identity and FK resolution:
- `ConnectionId`, `DataSourceId`, `LandingzoneEntityId` (when it's a PK, not an FK), `BronzeLayerEntityId`, `SilverLayerEntityId`
- Autoincrement `id` columns on queue/audit tables
- `LakehouseId` columns (internal FK to hidden `lakehouses` table)
- `ConnectionGuid` on `connections` (Fabric internal GUID)

**Exception**: When a PK column is also the only meaningful identifier (e.g., `watermarks.LandingzoneEntityId`), it is shown as an FK-resolved display column instead of hidden.

### FK Resolution

Foreign key columns display the resolved name from the referenced table instead of the raw integer ID:

| FK Column | Source Table | Display Column | Edit Widget |
|---|---|---|---|
| `DataSourceId` | `datasources` | `Name` | Dropdown select |
| `ConnectionId` | `connections` | `Name` | Dropdown select |
| `LandingzoneEntityId` (as FK) | `lz_entities` | `SourceName` | Read-only display |
| `BronzeLayerEntityId` (as FK) | `bronze_entities` | `Name` | Read-only display |

In view mode: shows resolved name text.
In edit mode (where applicable): dropdown populated from referenced table.

### Column Rename Maps

Per-table column definitions. Columns not listed are hidden.

**connections** (editable):
| Raw | Display | Type | Editable |
|---|---|---|---|
| `Name` | Connection Name | text | Yes |
| `Type` | Type | text | No (lock) |
| `ServerName` | Server | text | No (lock) |
| `DatabaseName` | Database | text | No (lock) |
| `IsActive` | Active | boolean | Yes |
| `updated_at` | Last Modified | datetime | No |

**datasources** (editable):
| Raw | Display | Type | Editable |
|---|---|---|---|
| `Name` | Source Name | text | Yes |
| `ConnectionId` | Connection | fk | Yes (dropdown) |
| `Namespace` | Namespace | text | No (lock) |
| `Type` | Type | text | No (lock) |
| `Description` | Description | text | Yes |
| `IsActive` | Active | boolean | Yes |
| `updated_at` | Last Modified | datetime | No |

**lz_entities** (editable):
| Raw | Display | Type | Editable |
|---|---|---|---|
| `DataSourceId` | Data Source | fk | No (display) |
| `SourceSchema` | Source Schema | text | No (lock) |
| `SourceName` | Source Table | text | No (lock) |
| `FileName` | File Name | text | No (lock) |
| `FilePath` | File Path | text | No (lock) |
| `FileType` | Format | text | No (lock) |
| `IsIncremental` | Incremental Load | boolean | Yes |
| `IsIncrementalColumn` | Watermark Column | text | Yes |
| `SourceCustomSelect` | Custom SQL Query | text | Yes |
| `CustomNotebookName` | Custom Notebook | text | Yes |
| `IsActive` | Active | boolean | Yes |
| `updated_at` | Last Modified | datetime | No |

**bronze_entities** (editable):
| Raw | Display | Type | Editable |
|---|---|---|---|
| `LandingzoneEntityId` | Landing Zone Entity | fk | No (display) |
| `Schema_` | Schema | text | No (lock) |
| `Name` | Table Name | text | No (lock) |
| `PrimaryKeys` | Primary Keys | text | Yes |
| `FileType` | Format | text | No (lock) |
| `IsActive` | Active | boolean | Yes |
| `updated_at` | Last Modified | datetime | No |

**silver_entities** (editable):
| Raw | Display | Type | Editable |
|---|---|---|---|
| `BronzeLayerEntityId` | Bronze Entity | fk | No (display) |
| `Schema_` | Schema | text | No (lock) |
| `Name` | Table Name | text | No (lock) |
| `FileType` | Format | text | No (lock) |
| `IsActive` | Active | boolean | Yes |
| `updated_at` | Last Modified | datetime | No |

**entity_status** (read-only, composite PK: `LandingzoneEntityId` + `Layer`):
| Raw | Display | Type |
|---|---|---|
| `LandingzoneEntityId` | Entity | fk (resolved to SourceName) |
| `Layer` | Layer | text |
| `Status` | Status | text |
| `LoadEndDateTime` | Last Loaded | datetime |
| `ErrorMessage` | Error | text |
| `UpdatedBy` | Updated By | text |

**watermarks** (read-only, PK: `LandingzoneEntityId`):
| Raw | Display | Type |
|---|---|---|
| `LandingzoneEntityId` | Entity | fk (resolved to SourceName) |
| `LoadValue` | Last Load Value | text |
| `LastLoadDatetime` | Last Load Time | datetime |

**engine_runs** (read-only):
| Raw | Display | Type |
|---|---|---|
| `RunId` | Run ID | text |
| `Mode` | Mode | text |
| `Status` | Status | text |
| `TotalEntities` | Total Entities | number |
| `SucceededEntities` | Succeeded | number |
| `FailedEntities` | Failed | number |
| `SkippedEntities` | Skipped | number |
| `TotalRowsRead` | Rows Read | number |
| `TotalRowsWritten` | Rows Written | number |
| `TotalDurationSeconds` | Duration | number |
| `Layers` | Layers | text |
| `TriggeredBy` | Triggered By | text |
| `StartedAt` | Started | datetime |
| `EndedAt` | Ended | datetime |

**engine_task_log** (read-only):
| Raw | Display | Type |
|---|---|---|
| `RunId` | Run ID | text |
| `EntityId` | Entity ID | number |
| `Layer` | Layer | text |
| `Status` | Status | text |
| `SourceTable` | Source Table | text |
| `RowsRead` | Rows Read | number |
| `RowsWritten` | Rows Written | number |
| `DurationSeconds` | Duration | number |
| `LoadType` | Load Type | text |
| `ErrorType` | Error Type | text |
| `ErrorMessage` | Error | text |
| `StartedAt` | Started | datetime |

Hidden from task log: `SourceServer`, `SourceDatabase`, `SourceQuery`, `BytesTransferred`, `TargetLakehouse`, `TargetPath`, `WatermarkColumn`, `WatermarkBefore`, `WatermarkAfter`, `ErrorStackTrace`, `ErrorSuggestion`, `LogData`

**pipeline_lz_entity** (read-only):
| Raw | Display | Type |
|---|---|---|
| `LandingzoneEntityId` | Entity | fk (resolved to SourceName) |
| `FileName` | File Name | text |
| `FilePath` | File Path | text |
| `InsertDateTime` | Queued At | datetime |
| `IsProcessed` | Processed | boolean |

**pipeline_bronze_entity** (read-only):
| Raw | Display | Type |
|---|---|---|
| `BronzeLayerEntityId` | Entity | fk (resolved to Name) |
| `TableName` | Table | text |
| `SchemaName` | Schema | text |
| `InsertDateTime` | Queued At | datetime |
| `IsProcessed` | Processed | boolean |

**pipeline_audit** (read-only):
| Raw | Display | Type |
|---|---|---|
| `PipelineRunGuid` | Pipeline Run | text |
| `PipelineName` | Pipeline | text |
| `EntityLayer` | Layer | text |
| `TriggerType` | Trigger | text |
| `LogType` | Log Type | text |
| `LogDateTime` | Timestamp | datetime |
| `EntityId` | Entity ID | number |

Hidden from audit: `LogData` (large JSON blob)

**notebook_executions** (read-only):
| Raw | Display | Type |
|---|---|---|
| `NotebookName` | Notebook | text |
| `PipelineRunGuid` | Pipeline Run | text |
| `EntityId` | Entity ID | number |
| `EntityLayer` | Layer | text |
| `Status` | Status | text |
| `LogType` | Log Type | text |
| `StartedAt` | Started | datetime |
| `EndedAt` | Ended | datetime |

Hidden from notebook executions: `LogDateTime`, `LogData`

### Value Formatting

All formatting is server-side. The frontend renders what it receives.

| Type | View Mode | Edit Mode |
|---|---|---|
| Boolean (0/1) | Green "Active" / Red "Inactive" badge | Toggle switch |
| Timestamp (ISO) | "Mar 12, 2026 2:30 PM" | (read-only formatted) |
| Null | Subtle em-dash | Empty input |
| Large text (>100 chars) | Truncated with "..." expand on click | Textarea |
| FK integer | Resolved name from referenced table | Dropdown select |
| Numbers | Locale-formatted with commas | Number input |

### Locked Columns

Columns that are structurally important to the pipeline engine are non-editable even on editable tables. They show a subtle lock icon on hover with a tooltip: "This field is used by the pipeline engine and cannot be modified here."

## Editing Flow (Row Edit Mode)

1. User clicks pencil icon on a row
2. Editable cells become inputs (text, toggle, dropdown depending on type)
3. Locked cells show lock icon, remain non-interactive
4. Save and Cancel buttons appear at the end of the row
5. Save: `PUT /api/data-manager/table/{name}/{pk}` with changed fields only
6. On success: row exits edit mode, values refresh, success toast
7. On error: error toast with message, row stays in edit mode
8. Only one row editable at a time

## Backend

### Prerequisites

**Add `do_PUT` to `server.py`**: The HTTP handler currently supports GET, POST, DELETE, OPTIONS. Add `do_PUT` that delegates to the route registry (same pattern as `do_POST`). Update CORS `Access-Control-Allow-Methods` in both `router.py` and `server.py` to include PUT.

### New File: `dashboard/app/api/routes/data_manager.py`

Contains:
- `TABLE_REGISTRY` dict: all table metadata (display names, categories, column configs, FK maps, editability, PK definitions)
- 3 route handlers
- FK resolution logic
- Value formatting logic

### Endpoints

**`GET /api/data-manager/tables`**

Returns visible table list with metadata:
```json
[
  {
    "name": "connections",
    "displayName": "Connections",
    "category": "Source Systems",
    "rowCount": 10,
    "editable": true
  }
]
```

**`GET /api/data-manager/table/{name}?page=1&per_page=50&search=&sort=&order=asc`**

Returns paginated data with column metadata. Supports:
- `search`: filters rows where any visible text column contains the search string
- `sort`: column key to sort by
- `order`: `asc` or `desc`

```json
{
  "table": "connections",
  "displayName": "Connections",
  "category": "Source Systems",
  "editable": true,
  "total": 10,
  "page": 1,
  "perPage": 50,
  "columns": [
    {"key": "Name", "label": "Connection Name", "type": "text", "editable": true},
    {"key": "Type", "label": "Type", "type": "text", "editable": false},
    {"key": "IsActive", "label": "Active", "type": "boolean", "editable": true}
  ],
  "rows": [
    {"_pk": "1", "Name": "CON_FMD_MES", "Type": "SqlServer", "IsActive": true}
  ],
  "fkOptions": {
    "ConnectionId": [{"value": 1, "label": "CON_FMD_MES"}, {"value": 2, "label": "CON_FMD_ETQ"}]
  }
}
```

Note: `_pk` is always a string. For composite PKs it's pipe-delimited (e.g., `"1|landing"`).

**`PUT /api/data-manager/table/{name}/{pk}`**

Body: `{"Name": "M3 Cloud", "IsActive": true}`
- Validates table exists in `TABLE_REGISTRY` and is editable
- Validates only columns marked `editable: true` are being changed
- Type-validates values (booleans must be bool/0/1, FK values must exist in referenced table)
- Executes parameterized UPDATE
- Calls `parquet_sync.queue_export(table_name)` to trigger sync
- Returns updated row in same format as GET

### Security

- Table name validated against `TABLE_REGISTRY` (not arbitrary table access)
- Only columns marked `editable: true` can be updated via PUT
- PUT only available on tables marked `editable: true` in registry
- SQL fully parameterized (no string interpolation for values)
- Type validation on PUT body (booleans, FK references, text lengths)

## Frontend

### New File: `dashboard/app/src/pages/DataManager.tsx`

Single-file component. If it exceeds ~800 lines, extract `DataManagerSidebar` and `DataManagerGrid` as sub-components.

### Key Behaviors

- Sidebar categories are collapsible, default all expanded
- Table selection updates URL params (`?table=connections`) for deep-linking
- Search filters across all table display names in sidebar
- In-table search bar filters rows (hits GET with `?search=` param)
- Column headers are clickable for sorting (asc/desc toggle)
- Grid columns auto-size based on content type
- Boolean columns render as colored badges (view) / toggles (edit)
- FK columns render as resolved names (view) / dropdowns (edit)
- Locked columns show lock icon on hover
- Pagination at bottom of grid
- Empty state when no table selected

### Router Registration

Add to `App.tsx` route config and `AppLayout.tsx` sidebar nav (Data group).
