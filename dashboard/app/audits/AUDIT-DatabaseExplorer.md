# AUDIT: DatabaseExplorer.tsx

**Date**: 2026-03-13
**Frontend**: `dashboard/app/src/pages/DatabaseExplorer.tsx`
**Backend handler**: `dashboard/app/api/routes/db_explorer.py`
**Endpoints consumed**:
- `GET /api/db-explorer/tables` -- list all SQLite tables
- `GET /api/db-explorer/table/{name}?page=N&per_page=N` -- paginated table data
- `GET /api/db-explorer/table/{name}/schema` -- column metadata via PRAGMA
- `POST /api/db-explorer/query` -- execute read-only SQL

---

## Purpose

DatabaseExplorer is a generic SQLite browser for the local control plane database (`fmd_control_plane.db`). It provides a sidebar listing all tables with row counts, a Data tab showing paginated rows, a Schema tab showing column metadata via `PRAGMA table_info`, and a Query tab for running arbitrary read-only SQL.

## Data Flow

1. **On mount**: Fetches `GET /api/db-explorer/tables` to populate the sidebar table list.
2. **On table select**: Simultaneously fetches table data (page 1) and schema.
3. **On pagination**: Fetches `GET /api/db-explorer/table/{name}?page=N&per_page=50`.
4. **On query execute**: POSTs to `POST /api/db-explorer/query` with `{sql: "..."}`.

## API Call Trace

| Frontend Call | Backend Route | Data Source | Status |
|---|---|---|---|
| `GET /api/db-explorer/tables` | `db_explorer.py:list_tables()` | SQLite: `SELECT name FROM sqlite_master WHERE type='table'` + per-table `SELECT COUNT(*)` | OK |
| `GET /api/db-explorer/table/{name}` | `db_explorer.py:get_table_data()` | SQLite: `SELECT * FROM [{table}] LIMIT ? OFFSET ?` + `SELECT COUNT(*)` | OK |
| `GET /api/db-explorer/table/{name}/schema` | `db_explorer.py:get_table_schema()` | SQLite: `PRAGMA table_info([{table}])` | OK |
| `POST /api/db-explorer/query` | `db_explorer.py:execute_query()` | SQLite: user-provided SQL (SELECT/PRAGMA only) | OK |

## Data Source Correctness Analysis

### GET /api/db-explorer/tables

**Backend SQL**: `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
**Supplementary**: For each table, runs `SELECT COUNT(*) as cnt FROM [{table_name}]`
**Response**: `[{name: str, row_count: int}, ...]`
**Frontend consumption**: Maps to `TableInfo[]` with `{name, row_count}`. Displays in sidebar with `t.name` and `t.row_count.toLocaleString()`.
**Correctness**: CORRECT. The query properly excludes SQLite internal tables. Row counts are accurate per-table. The frontend correctly renders both fields.

### GET /api/db-explorer/table/{name}

**Backend SQL**: `SELECT * FROM [{table}] LIMIT ? OFFSET ?` with parameterized pagination.
**Security**: Table name is validated via `_validate_table_name()` which checks `sqlite_master` before any query.
**Response**: `{rows: [...], total: int, page: int, per_page: int}`
**Frontend consumption**: Uses `tableData.rows`, `tableData.total`, `tableData.page` for data grid and pagination. Uses `perPage=50` client-side.
**Correctness**: CORRECT. Backend caps `per_page` at 500 (line 40). Frontend hard-codes 50. Pagination math `(page-1)*per_page` is correct. Total rows from `SELECT COUNT(*)` matches the table's actual row count.

### GET /api/db-explorer/table/{name}/schema

**Backend SQL**: `PRAGMA table_info([{table}])`
**Response**: `[{name, type, notnull, pk}, ...]`
**Frontend consumption**: Maps to `ColumnInfo[]` with `{name, type, notnull, pk}`. Displays column name, type (or "--" if empty), NOT NULL badge, and PK badge.
**Correctness**: CORRECT. `PRAGMA table_info` returns `cid, name, type, notnull, dflt_value, pk`. Backend extracts `name, type, notnull, pk` -- all valid column attributes. Frontend correctly checks `col.notnull` (truthy for 1) and `col.pk` (truthy for non-zero).

### POST /api/db-explorer/query

**Backend validation**: Requires SQL to start with `SELECT` or `PRAGMA` (case-insensitive after stripping). Uses `db.query(sql)` which runs a single statement.
**Response**: `{rows: [...], count: int}`
**Frontend consumption**: Displays `queryResult.count` and renders rows via `renderDataGrid()`.
**Correctness**: CORRECT. The read-only enforcement is appropriate. `count` is `len(rows)` which is accurate for the returned result set. Note: there is no LIMIT enforcement server-side, so a `SELECT * FROM lz_entities` (1666 rows) will return all rows. The frontend renders all of them.

## Issues Found

### 1. LOW -- No server-side row limit on free-form queries

`POST /api/db-explorer/query` executes the SQL as-is with no LIMIT cap. A query like `SELECT * FROM lz_entities` returns all 1666 rows in a single response. For the largest tables (bronze_entities: 1666, silver_entities: 1666, entity_status: 4998), this could mean large response payloads.

**Impact**: Very low -- this is a dev tool and the tables are small. A `SELECT * FROM entity_status` returns ~5000 rows (~1MB JSON), which is manageable.

### 2. LOW -- Frontend generates bracket-wrapped SQL but SQLite uses bracket quoting

When a table is selected, the frontend pre-populates the query textarea with `SELECT * FROM [${name}] LIMIT 100` (line 147). This uses SQL Server-style bracket quoting, which SQLite also supports. Correct behavior but potentially confusing for users expecting backtick quoting.

### 3. NONE -- Security measures are appropriate

- Table names validated against `sqlite_master` before use in f-string SQL
- Query endpoint restricted to SELECT/PRAGMA
- Python's `sqlite3.execute()` runs single statements only (no stacked injection)
- `per_page` capped at 500 server-side

## Verdict

**Page Status: FULLY FUNCTIONAL** -- All 4/4 endpoints are migrated and correct. Data sources are appropriate (local SQLite via `db.query()`). No schema mismatches. No missing fields.
