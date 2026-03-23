# AUDIT: FlowExplorer.tsx

**Page**: `dashboard/app/src/pages/FlowExplorer.tsx`
**Date**: 2026-03-23 (revision of 2026-03-13 audit)
**Auditor**: Claude (Opus)
**Verdict**: MEDIUM RISK — Two broken navigation links, misleading layer progress, hardcoded hex colors.

---

## NAVIGATION FLOW MAP

### Outbound Links (from FlowExplorer)

| # | Trigger | Target Route | Params Passed | Target Page | Target Consumes Params? | Status |
|---|---------|-------------|---------------|-------------|------------------------|--------|
| 1 | "Deep Dive" button (detail panel footer) | `/journey?entity={lzEntityId}` | `entity` = LZ entity ID (numeric string) | DataJourney.tsx | YES — `searchParams.get("entity")` at line 369, calls `loadJourney(parseInt(...))` | WORKING |
| 2 | "Manage Source" button (detail panel footer) | `/source-manager?source={dataSourceName}` | `source` = data source name (e.g. "MES") | SourceManager.tsx | PARTIALLY — SourceManager reads `searchParams.get('source')` at line 205. But the route is `/sources`, not `/source-manager`. | **BROKEN — FIXED** |

### Inbound Links (to FlowExplorer)

| # | Source Page | Link Target | Params | FlowExplorer Consumes? | Status |
|---|-----------|-------------|--------|----------------------|--------|
| 1 | SourceManager.tsx (line 952) | `/flow-explorer?source={sourceName}` | `source` | FlowExplorer reads `searchParams.get('source')` at line 607 | **BROKEN** (route is `/flow`, not `/flow-explorer`) |
| 2 | SourceManager.tsx (line 1027) | `/flow-explorer?source={DataSourceName}&table={SourceName}` | `source`, `table` | FlowExplorer reads both at lines 607-608 | **BROKEN** (same route mismatch) |
| 3 | AdminGateway.tsx (line 41) | `/flow` | none | N/A | WORKING |

### Navigation Context Contract

**FlowExplorer -> DataJourney**: Passes `entity={lzEntityId}` (numeric ID from LZ entities table). DataJourney resolves this via `/api/journey?entity={id}` which fetches the full journey record. The contract is clean and both sides agree.

**FlowExplorer -> SourceManager**: Passes `source={dataSourceName}` (string name like "MES"). SourceManager filters its registered entities list to that source. The contract is clean — the route path was wrong, now fixed.

**SourceManager -> FlowExplorer**: SourceManager passes `source` and optionally `table`. FlowExplorer consumes both at lines 607-612, using them to set the search query and auto-expand the source group. The contract is clean — but the route path in SourceManager is wrong (`/flow-explorer` vs `/flow`). **This is OUT OF SCOPE for this audit** (cannot edit SourceManager.tsx). Documented for AUDIT-SM.

### Notes for Other Audit Agents

- **AUDIT-DJ (DataJourney)**: FlowExplorer sends `entity={lzEntityId}` as a numeric string. DataJourney correctly parses it with `parseInt()`. No issues on the handoff.
- **AUDIT-CE (ColumnEvolution)**: FlowExplorer has NO direct links to ColumnEvolution. Any FlowExplorer -> ColumnEvolution path goes through DataJourney as an intermediary.
- **AUDIT-SM (SourceManager)**: SourceManager links to `/flow-explorer?source=...` but the route is `/flow`. These links (lines 952, 1027) need to be fixed in SourceManager.tsx.

---

## FINDINGS

### FE-01 (HIGH): Broken `/source-manager` navigation link — FIXED

**Lines**: 1397
**Description**: The "Manage Source" button linked to `/source-manager?source=...` but the actual React Router route is `/sources` (App.tsx line 101). Clicking this button would show a blank page / 404.
**Fix**: Changed to `/sources?source=...`.

### FE-02 (MEDIUM): Layer progress based on registration, not load status — FIXED

**Lines**: 631-661 (`digestToFlow`)
**Description**: `maxLayer`, `bronzeName`, `silverName` were determined by checking `ent.bronzeId != null` / `ent.silverId != null`. Since all 1,666 entities are registered across all 3 layers, every entity appeared as "fully progressed to Silver" regardless of actual load status. The `bronzeStatus` and `silverStatus` fields from the digest were ignored.
**Impact**: All flow connectors were always active. All source group counts showed equal landing/bronze/silver. The narrative falsely claimed data was cleaned and validated for entities that were never loaded.
**Fix**: Added `bronzeLoaded` and `silverLoaded` guards that check both ID presence AND status !== "not_started". Only entities that have actually been loaded (or attempted) now show as progressed.

### FE-03 (MEDIUM): Hardcoded hex colors instead of design tokens — FIXED

**Lines**: Multiple (726-737, 798, 851-860, 911-912, 931-932, 1224, 1255, 1391)
**Description**: Inline `style` attributes used raw hex colors (`#B45624`, `#78716C`, `#B93A2A`, `#57534E`, `#FEFDFB`, `#1C1917`, `#A8A29E`) and `rgba(0,0,0,0.08)` instead of the design system CSS custom properties (`var(--bp-copper)`, `var(--bp-ink-tertiary)`, `var(--bp-fault)`, etc.).
**Fix**: Replaced all inline style hex values with their `var(--bp-*)` equivalents. The `LAYERS` and `NODE_COLORS` constants still use hex because they're interpolated into dynamic expressions like `${color}50` for opacity variants — these cannot use CSS variables in JS template strings.

### FE-04 (LOW): `ConnectionGuid` missing from API response

**Description**: The `Connection` interface declares `ConnectionGuid: string` but `cpdb.get_connections()` does not SELECT it. However, FlowExplorer never reads `ConnectionGuid`, so this is a cosmetic type mismatch with no runtime impact.
**Status**: DEFERRED — Not a visible bug. Would require backend change (out of scope).

### FE-05 (INFO): Hardcoded file type values

**Description**: `lzFileType: "PARQUET"`, `bronzeFileType: "DELTA"`, `silverFileType: "DELTA"` are hardcoded. These are factually correct for this framework but the actual `FileName` / `FilePath` / `FileType` fields from `lz_entities` are not passed through the digest endpoint.
**Status**: DEFERRED — Correct for current architecture. Would require backend digest enrichment.

### FE-06 (INFO): `lzFilePath` semantics incorrect

**Description**: `lzFilePath` is set to `ent.sourceSchema` (e.g., "dbo") which is the source schema, not the actual landing zone file path. The actual path would be `{Namespace}/{Table}` per ARCHITECTURE.md. The value is only shown in the detail panel's technical details section.
**Status**: DEFERRED — Would require digest endpoint to include the actual `FilePath` field.

### FE-07 (INFO): Inbound links from SourceManager use wrong route

**Description**: SourceManager.tsx lines 952 and 1027 link to `/flow-explorer?source=...` but the route is `/flow`. These links are dead.
**Status**: DEFERRED — Out of scope (SourceManager.tsx). Documented for AUDIT-SM.

---

## API Calls Traced

| Endpoint | Backend | SQL Tables | Status |
|----------|---------|-----------|--------|
| `GET /api/entity-digest` (via `useEntityDigest`) | `entities.py:get_entity_digest()` | `lz_entities`, `datasources`, `connections`, `entity_status`, `bronze_entities`, `silver_entities` | CORRECT |
| `GET /api/connections` | `control_plane.py:get_connections()` | `connections` | PARTIAL (missing ConnectionGuid) |
| `GET /api/datasources` | `control_plane.py:get_datasources()` | `datasources JOIN connections` | CORRECT |
| `GET /api/pipelines` | `pipeline.py:get_pipelines()` | `pipelines` | CORRECT |

---

## Standard Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Truth bugs (fake data) | FIXED (FE-02) | Layer progress was misleading |
| Dead code | CLEAN | No unused imports, no commented-out blocks, no unreachable branches |
| Error handling | GOOD | Loading state, error state with retry, aux error shown inline non-blocking |
| Hardcoded hex | FIXED (FE-03) | Inline styles converted to CSS vars. LAYERS/NODE_COLORS constants retain hex for JS interpolation. |
| Accessibility | FAIR | Buttons have titles, flow nodes have title tooltips. Missing explicit aria-labels on toggle controls. |
| Loading states | GOOD | Full-page spinner on initial load, inline warning for aux data failure |
| Empty states | GOOD | Both "no sources registered" and "no search results" states handled |
| Visualization correctness | GOOD (after FE-02 fix) | Flow connectors and layer counts now reflect actual load status |
