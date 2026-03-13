# AUDIT: DataMicroscope

**Audited:** 2026-03-13
**File:** `dashboard/app/src/pages/DataMicroscope.tsx` (~1130 lines)
**Backend route:** NONE — endpoint does not exist
**Hooks:** `useMicroscope` from `@/hooks/useMicroscope.ts`, `useMicroscopePks` (same file), `useEntityDigest` from `@/hooks/useEntityDigest.ts`
**Shared components:** `EntitySelector` from `@/components/EntitySelector.tsx`
**Schema ref:** `dashboard/app/audits/SCHEMA_REFERENCE.txt`

---

## Overview

DataMicroscope is a cross-layer row inspection tool. Users select an entity, search for a primary key value, and the page displays that specific row as it appears across Source, Landing Zone, Bronze, and Silver layers in a side-by-side diff grid. It highlights cell-level changes (added, changed, not_present), shows SCD2 version navigation for Silver, displays transformation pipeline steps, and provides click-to-inspect popovers.

### Architecture

```
EntitySelector (shared component)
  └─ useEntityDigest() → GET /api/entity-digest → SQLite

PkSearchInput
  └─ useMicroscopePks(entityId, searchQuery) → GET /api/microscope/pks?entity=N&q=X&limit=20
       → ENDPOINT DOES NOT EXIST (404)

DiffGrid
  └─ useMicroscope(entityId, pkValue) → GET /api/microscope?entity=N&pk=V
       → ENDPOINT DOES NOT EXIST (404)
```

---

## API Endpoint Trace

### 1. GET /api/entity-digest (entity list for EntitySelector)

| Frontend | Backend | SQL Tables | Correct? |
|----------|---------|------------|----------|
| `useEntityDigest()` in DataMicroscope | `entities.py:get_entity_digest()` | `lz_entities`, `datasources`, `connections`, `lakehouses`, `bronze_entities`, `silver_entities`, `entity_status` | YES |

- Fields consumed: `id`, `tableName`, `sourceSchema`, `source`, `bronzePKs`
- All correctly sourced from SQLite. No issues.

### 2. GET /api/microscope?entity=N&pk=V (cross-layer row data)

| Frontend | Backend | SQL Tables | Correct? |
|----------|---------|-------------|----------|
| `useMicroscope()` hook line 104 | **DOES NOT EXIST** | N/A | NO |

- The `useMicroscope` hook at `dashboard/app/src/hooks/useMicroscope.ts` line 104 fetches `${API}/api/microscope?entity=N&pk=V`.
- No handler for `/api/microscope` exists in any route file under `dashboard/app/api/routes/`.
- No handler exists in the refactored `server.py`.
- The old `server.py.bak` also did not have this endpoint (confirmed by prior audit `AUDIT-DataMicroscope.md` at app root).
- The request returns 404, the hook catches the error, and the page displays an error banner.

### 3. GET /api/microscope/pks?entity=N&q=X&limit=20 (PK autocomplete)

| Frontend | Backend | SQL Tables | Correct? |
|----------|---------|-------------|----------|
| `useMicroscopePks()` hook line 212 | **DOES NOT EXIST** | N/A | NO |

- The `useMicroscopePks` hook at `dashboard/app/src/hooks/useMicroscope.ts` line 212 fetches `${API}/api/microscope/pks?entity=N&q=X&limit=20`.
- No handler exists. The hook catches the error silently and sets `pks` to `[]`.
- The PK search input never returns autocomplete results. Users must manually type exact PK values (which also fails since the main microscope endpoint is missing).

---

## Issues Found

### B1. CRITICAL — /api/microscope endpoint does not exist

**Problem:** The `useMicroscope` hook calls `GET /api/microscope?entity=N&pk=V` but no handler exists anywhere in the backend. The router will return 404 for this path. This means the entire cross-layer row inspection feature is non-functional. Selecting an entity and entering a PK will always result in an error.

**Expected response shape** (from `MicroscopeData` interface in `useMicroscope.ts`):
```typescript
{
  entityId: number;
  entityName: string;
  primaryKeys: string[];
  pkValue: string;
  source: {
    available: boolean;
    server?: string;
    database?: string;
    row: Record<string, unknown> | null;       // actual row from source SQL Server
  };
  landing: { available: boolean; note: string; row: null; };
  bronze: {
    available: boolean;
    lakehouse?: string;
    row: Record<string, unknown> | null;       // actual row from Bronze lakehouse
  };
  silver: {
    available: boolean;
    lakehouse?: string;
    versions: Record<string, unknown>[];       // SCD2 versions from Silver lakehouse
    currentVersion: number;
  };
  cleansingRules: { bronze: []; silver: []; };
  transformations: TransformationStep[];       // pipeline step descriptions
}
```

**Fix needed:** Implement `GET /api/microscope` in a new or existing route file that:
1. Looks up the entity in `lz_entities` + `bronze_entities` + `silver_entities` (SQLite)
2. Resolves the PK column from `bronze_entities.PrimaryKeys`
3. Queries the source SQL Server (if VPN-reachable) for the row by PK
4. Queries Bronze lakehouse for the row by PK
5. Queries Silver lakehouse for all SCD2 versions of the row by PK
6. Returns the assembled `MicroscopeData` structure

### B2. CRITICAL — /api/microscope/pks endpoint does not exist

**Problem:** The `useMicroscopePks` hook calls `GET /api/microscope/pks?entity=N&q=X&limit=20` for PK autocomplete. No handler exists. The PK search input will always fail silently (the hook catches errors and sets `pks` to `[]`), so users see a search box that never returns results.

**Expected response shape** (from `PkSearchResult` in `useMicroscope.ts`):
```typescript
{
  values: string[];     // array of PK values matching the search query
  pkColumn?: string;    // name of the PK column
}
```

**Fix needed:** Implement `GET /api/microscope/pks` that:
1. Resolves the PK column from `bronze_entities.PrimaryKeys` for the given entity
2. Queries the Bronze lakehouse `SELECT DISTINCT TOP N {pkCol} FROM [schema].[table] WHERE CAST({pkCol} AS VARCHAR) LIKE '%query%'`
3. Returns `{values: [...], pkColumn: "..."}`

---

## Frontend-Only Components (no backend issues)

| Component | Data Source | Notes |
|-----------|-------------|-------|
| DiffGrid | `MicroscopeData` (from hook) | Pure display — cell diff logic is correct IF data arrives |
| CellPopover | `MicroscopeData.transformations` | Shows before/after values and transformation details |
| TransformationCards | `MicroscopeData.transformations` | Displays pipeline step descriptions |
| getCellStatus() | Local logic | Determines cell color/status based on cross-layer comparison — logic is sound |
| SCD2 version selector | `MicroscopeData.silver.versions` | Dropdown with RecordStartDate/IsCurrent — correct |

---

## Mock / Hardcoded Data Check

| Item | Status |
|------|--------|
| Entity list | LIVE — from `/api/entity-digest` via SQLite |
| Microscope row data | DEAD — endpoint does not exist, returns 404 |
| PK autocomplete | DEAD — endpoint does not exist, fails silently |
| System column sets | HARDCODED `BRONZE_SYSTEM_COLS`, `SILVER_SYSTEM_COLS` — matches actual FMD column names |
| Layer definitions | HARDCODED `LAYER_META` — cosmetic, no data issue |
| Notebook references | HARDCODED in CellPopover (`NB_FMD_LOAD_LANDING_BRONZE`, `NB_FMD_LOAD_BRONZE_SILVER`) — correct names |

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 2 | Both `/api/microscope` and `/api/microscope/pks` endpoints do not exist. The entire page is non-functional — entity selection works (via entity-digest), but any attempt to inspect row data or search PKs returns 404. |
| MEDIUM | 0 | — |
| LOW | 0 | — |

**Bottom line:** The frontend code is well-structured and the diff/comparison logic is correct, but the page is 100% broken because neither backend endpoint has been implemented. This was also flagged in the prior audit at `dashboard/app/AUDIT-DataMicroscope.md` (2026-03-11) and has not been addressed.
