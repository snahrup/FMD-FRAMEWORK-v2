# AUDIT: SqlExplorer.tsx

**Date**: 2026-03-13
**Frontend**: `dashboard/app/src/pages/SqlExplorer.tsx` + `dashboard/app/src/components/sql-explorer/ObjectTree.tsx` + `dashboard/app/src/components/sql-explorer/TableDetail.tsx`
**Backend handler**: `dashboard/app/api/routes/sql_explorer.py`
**Types**: `dashboard/app/src/types/sqlExplorer.ts`
**Endpoints consumed**:
- `GET /api/sql-explorer/servers` -- registered source servers + reachability
- `GET /api/sql-explorer/databases?server=<srv>` -- databases on a server
- `GET /api/sql-explorer/schemas?server=<srv>&database=<db>` -- schemas in a database
- `GET /api/sql-explorer/tables?server=<srv>&database=<db>&schema=<sch>` -- tables
- `GET /api/sql-explorer/columns?server=<srv>&database=<db>&schema=<sch>&table=<tbl>` -- column metadata
- `GET /api/sql-explorer/preview?server=<srv>&database=<db>&schema=<sch>&table=<tbl>&limit=500` -- data preview
- `POST /api/sql-explorer/server-label` -- save custom display label
- `GET /api/sql-explorer/lakehouses` -- registered Fabric lakehouses
- `GET /api/sql-explorer/lakehouse-schemas?lakehouse=<name>` -- schemas in a lakehouse
- `GET /api/sql-explorer/lakehouse-tables?lakehouse=<name>&schema=<sch>` -- tables in a lakehouse schema
- `GET /api/sql-explorer/lakehouse-columns?lakehouse=<name>&schema=<sch>&table=<tbl>` -- column metadata
- `GET /api/sql-explorer/lakehouse-preview?lakehouse=<name>&schema=<sch>&table=<tbl>&limit=500` -- data preview
- `GET /api/sql-explorer/lakehouse-files?lakehouse=<name>` -- OneLake file listing
- `GET /api/sql-explorer/lakehouse-file-tables?lakehouse=<name>&namespace=<ns>` -- file-backed delta table folders

---

## Purpose

SqlExplorer is a dual-mode database object browser:
1. **Source SQL Servers** -- browse on-premises SQL Server databases via ODBC (requires VPN)
2. **Fabric Lakehouses** -- browse lakehouse tables via the SQL Analytics Endpoint

The page uses a resizable sidebar (ObjectTree) for server/database/schema/table navigation, and a detail panel (TableDetail) for column metadata and data preview.

## Data Flow

### ObjectTree Component
1. **On mount**: Fetches servers and lakehouses in parallel.
2. **On server expand**: Fetches databases for that server.
3. **On database expand**: Fetches schemas for that database.
4. **On schema expand**: Fetches tables for that schema.
5. **On lakehouse expand**: Fetches lakehouse schemas.
6. **On lakehouse schema expand**: Fetches lakehouse tables.
7. **On "Files" node expand**: Fetches OneLake files, then file-backed tables per namespace.
8. **On table click**: Calls `onSelectTable({server, database, schema, table, type})`.

### TableDetail Component
1. **On table selection**: Fetches columns (or lakehouse-columns).
2. **On "Data" tab click**: Fetches preview (or lakehouse-preview) with limit=500.

## API Call Trace

| Frontend Call | Backend Route | Data Source | Status |
|---|---|---|---|
| `GET /api/sql-explorer/servers` | `sql_explorer.py:get_sql_explorer_servers()` | SQLite: `connections` + `datasources` JOIN; pyodbc connectivity check | OK |
| `GET /api/sql-explorer/databases` | `sql_explorer.py:get_sql_explorer_databases()` | ODBC: `sys.databases` + per-DB table count | OK |
| `GET /api/sql-explorer/schemas` | `sql_explorer.py:get_sql_explorer_schemas()` | ODBC: `INFORMATION_SCHEMA.TABLES` GROUP BY schema | OK |
| `GET /api/sql-explorer/tables` | `sql_explorer.py:get_sql_explorer_tables()` | ODBC: `INFORMATION_SCHEMA.TABLES` filtered by schema | OK |
| `GET /api/sql-explorer/columns` | `sql_explorer.py:get_sql_explorer_columns()` | ODBC: `INFORMATION_SCHEMA.COLUMNS` + PK detection + `sys.partitions` row count | OK |
| `GET /api/sql-explorer/preview` | `sql_explorer.py:get_sql_explorer_preview()` | ODBC: `SELECT TOP N * FROM [schema].[table]` | OK |
| `POST /api/sql-explorer/server-label` | `sql_explorer.py:post_server_label()` | SQLite: `admin_config` table write | OK |
| `GET /api/sql-explorer/lakehouses` | `sql_explorer.py:get_sql_explorer_lakehouses()` | SQLite: `lakehouses` table | OK |
| `GET /api/sql-explorer/lakehouse-schemas` | `sql_explorer.py:get_sql_explorer_lakehouse_schemas()` | Fabric SQL: `INFORMATION_SCHEMA.TABLES` via SQL Analytics Endpoint | OK |
| `GET /api/sql-explorer/lakehouse-tables` | `sql_explorer.py:get_sql_explorer_lakehouse_tables()` | Fabric SQL: `INFORMATION_SCHEMA.TABLES` filtered | OK |
| `GET /api/sql-explorer/lakehouse-columns` | `sql_explorer.py:get_sql_explorer_lakehouse_columns()` | Fabric SQL: `INFORMATION_SCHEMA.COLUMNS` + `SELECT COUNT(*)` | OK |
| `GET /api/sql-explorer/lakehouse-preview` | `sql_explorer.py:get_sql_explorer_lakehouse_preview()` | Fabric SQL: `SELECT TOP N * FROM [schema].[table]` | OK |
| `GET /api/sql-explorer/lakehouse-files` | `sql_explorer.py:get_sql_explorer_lakehouse_files()` | OneLake REST API (DFS) + SQLite: `lakehouses` for GUIDs | OK |
| `GET /api/sql-explorer/lakehouse-file-tables` | `sql_explorer.py:get_sql_explorer_lakehouse_file_tables()` | OneLake REST API (DFS) + SQLite: `lakehouses` for GUIDs | OK |

## Data Source Correctness Analysis

### Server listing (SQLite + ODBC)

**Backend SQL**: JOINs `connections` and `datasources` tables, then performs live ODBC connectivity check per unique server.
**SQLite tables used**: `connections` (columns: `ConnectionId, Name, ServerName, DatabaseName, Type`), `datasources` (columns: `Name, Namespace, Description, ConnectionId`).
**Schema match**: All referenced columns exist in the schema. `ServerName` and `DatabaseName` are in `connections`. `Name`, `Namespace`, `Description` are in `datasources`. CORRECT.
**Server label lookup**: Reads `admin_config` table with keys like `server_label_{server}`.
**Correctness**: CORRECT.

### Database/Schema/Table listing (ODBC)

All use standard SQL Server `INFORMATION_SCHEMA` views and `sys.databases`/`sys.partitions` for metadata. These are well-defined system views.
**Security**: Server is validated against `connections` table allowlist via `_validate_server()` before any ODBC connection. Input sanitized via `_sanitize()`.
**Correctness**: CORRECT.

### Column metadata (ODBC/Fabric SQL)

**Source server columns**: Uses `INFORMATION_SCHEMA.COLUMNS` joined with `TABLE_CONSTRAINTS` and `KEY_COLUMN_USAGE` to detect primary keys. Returns `COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, ORDINAL_POSITION, COLUMN_DEFAULT, IS_PK`.
**Frontend TypeScript**: `SourceColumn` interface in `sqlExplorer.ts` defines exactly these field names (all uppercase).
**Correctness**: CORRECT -- field names match exactly.

**Lakehouse columns**: Uses same `INFORMATION_SCHEMA.COLUMNS` but via Fabric SQL Analytics Endpoint. Returns same fields EXCEPT `IS_PK` is hardcoded to `'0'` (line 553 of sql_explorer.py) because lakehouse tables don't have PK constraints in `INFORMATION_SCHEMA`.
**Frontend handling**: `col.IS_PK === '1'` check works correctly -- lakehouse tables simply never show PK badges.
**Correctness**: CORRECT.

### Data preview (ODBC/Fabric SQL)

Both source and lakehouse preview use `SELECT TOP N * FROM [schema].[table]` with limit capped at 1000 server-side.
**Response shape**: `{server, database, schema, table, limit, rowCount, columns: string[], rows: Record<string, string|null>[]}`.
**Frontend TypeScript**: `TablePreview` interface matches exactly.
**Correctness**: CORRECT.

### Lakehouse listing (SQLite)

**Backend SQL**: `SELECT Name FROM lakehouses ORDER BY Name`.
**Schema match**: `lakehouses` table has `Name` column. CORRECT.
**Response transform**: Converts name like `LH_FMD_BRONZE_D` to display name `Fmd Bronze D` via `.replace("LH_", "").replace("_", " ").title()`.
**Frontend consumption**: Uses `name` and `display` fields from `FabricLakehouse` interface.
**Correctness**: CORRECT.

### Server labels (SQLite)

**Read**: `SELECT key, value FROM admin_config WHERE key LIKE 'server_label_%'`
**Write**: `INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)`
**Schema match**: `admin_config` has `key TEXT PRIMARY KEY, value TEXT`. CORRECT.
**Note**: The code also checks a `server_labels` table for labels (referenced in schema), but the actual implementation uses `admin_config`. The `server_labels` table exists in the schema but has 0 rows and is not used by any route. Minor inconsistency but not a bug.

### OneLake file listing (REST API + SQLite)

**SQLite lookup**: `SELECT LakehouseGuid, WorkspaceGuid FROM lakehouses WHERE Name = ?`
**REST API**: OneLake DFS endpoint `https://onelake.dfs.fabric.microsoft.com/{ws_id}/{lh_id}/Files?resource=filesystem&recursive=false`
**Correctness**: CORRECT. Uses proper Fabric token with `storage.azure.com/.default` scope.

## Issues Found

### 1. MINOR -- Unused `server_labels` table

The schema defines a `server_labels` table (`server TEXT PRIMARY KEY, label TEXT`), but `sql_explorer.py` reads/writes labels from `admin_config` with `server_label_` key prefix instead. The `server_labels` table has 0 rows and is dead.

**Impact**: None -- the code works correctly using `admin_config`.

### 2. LOW -- Lakehouse file detail returns stub

`GET /api/sql-explorer/lakehouse-file-detail` (line 662) returns a hardcoded `note: "Delta table detail not yet implemented"`. The frontend ObjectTree does not appear to call this endpoint, so this is a backend-only stub.

**Impact**: None -- endpoint is not consumed by the frontend.

### 3. LOW -- f-string SQL in table/schema queries (sanitized)

Backend uses f-string interpolation for schema/table names in ODBC queries (e.g., `WHERE TABLE_SCHEMA = ?` with parameterized values preferred, or `f"WHERE TABLE_SCHEMA = '{s_sch}'"` where `s_sch` is sanitized via `_sanitize()` which strips to `[a-zA-Z0-9_- ]`). Identifiers (schema/table names) cannot use `?` placeholders in SQL — they must be validated/sanitized instead. Source servers are validated against the allowlist. Sanitization prevents SQL injection for identifiers.

**Impact**: Low -- defense in depth is adequate.

## Verdict

**Page Status: FULLY FUNCTIONAL** -- All 14 endpoints are migrated and correct. Data sources include SQLite (`connections`, `datasources`, `lakehouses`, `admin_config`), ODBC (on-prem SQL Servers), and Fabric SQL Analytics Endpoint (lakehouses). All field names match between backend responses and frontend TypeScript interfaces. Security measures (server allowlist, input sanitization) are in place.
