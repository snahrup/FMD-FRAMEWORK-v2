# AUDIT: SQL Explorer — Deep Audit (AUDIT-SQLX)

**Date**: 2026-03-23
**Auditor**: Claude (audit-sqlx pass)
**Prior audit**: 2026-03-13 (functional correctness only)

**Files audited**:
- `dashboard/app/src/pages/SqlExplorer.tsx` (144 lines)
- `dashboard/app/src/components/sql-explorer/ObjectTree.tsx` (~935 lines)
- `dashboard/app/src/components/sql-explorer/TableDetail.tsx` (440 lines)
- `dashboard/app/api/routes/sql_explorer.py` (763 lines)
- `dashboard/app/src/types/sqlExplorer.ts` (87 lines)

---

## Summary Table

| # | Severity | Category | File | Finding | Fixed? |
|---|----------|----------|------|---------|--------|
| 1 | MEDIUM | Hardcoded colors | ObjectTree.tsx | 20+ hardcoded `#3D7C4F`, `#C27A1A`, `#B45624`, `#FDF3E3`, `#E7F3EB` instead of `var(--bp-*)` tokens | YES |
| 2 | MEDIUM | Hardcoded colors | TableDetail.tsx | 11 hardcoded hex colors for PK highlighting and Fabric badge | YES |
| 3 | LOW | Hardcoded colors | SqlExplorer.tsx | `rgba(180,86,36,0.2)` in Read-Only badge border | YES |
| 4 | MEDIUM | Accessibility | ObjectTree.tsx | No `role="tree"`/`role="treeitem"`, no `aria-expanded`, no `aria-label` on any tree node | YES |
| 5 | MEDIUM | Accessibility | TableDetail.tsx | Tab buttons missing `role="tab"`, tab panels missing `role="tabpanel"`, no `aria-selected` | YES |
| 6 | LOW | Accessibility | SqlExplorer.tsx | Resize handle has no `aria-label` or keyboard support | YES |
| 7 | LOW | Dead code | sql_explorer.py | `lakehouse-file-detail` endpoint returns a stub (never called by frontend) | NO (deferred) |
| 8 | LOW | Honesty | sql_explorer.py | `isRegistered` field referenced by ObjectTree.tsx line 543-545 but never set by backend `/databases` response | NO (deferred -- needs cross-endpoint enrichment) |
| 9 | LOW | Security | sql_explorer.py | `post_server_label` does not call `_validate_server()` -- allows saving labels for unregistered servers | YES |
| 10 | LOW | Security | sql_explorer.py | `lakehouse-file-tables` passes `namespace` param directly into OneLake URL without sanitization | YES |
| 11 | INFO | Security | sql_explorer.py | `_sanitize()` uses Python `.isalnum()` which includes Unicode alphanumerics -- safe for bracket-quoting but broader than ASCII-only | NO (informational) |
| 12 | LOW | Error handling | ObjectTree.tsx | `toggleDatabase`, `toggleSchema` silently swallow non-ok responses (no error state shown) | YES |
| 13 | LOW | Empty state | ObjectTree.tsx | When all servers are offline, no explicit "all offline" message shown (just empty tree) | YES |
| 14 | INFO | Loading state | All | Loading states present and working (spinners on expand, skeleton in TableDetail) | N/A |
| 15 | LOW | Resize handle | SqlExplorer.tsx | Resize handle hover state is invisible (transparent bg, no visual cue) | YES |

---

## Detailed Findings

### F1-F3: Hardcoded Hex Colors

**ObjectTree.tsx** uses these hardcoded colors extensively:
- `#3D7C4F` (Fabric green) -- should be `var(--bp-success)` or a new `--bp-fabric` token
- `#C27A1A` -- already exists as `var(--bp-caution)`
- `#B45624` -- already exists as `var(--bp-copper)`
- `#FDF3E3` -- already exists as `var(--bp-caution-light)`
- `#E7F3EB` -- already exists as `var(--bp-operational-light)`

**TableDetail.tsx** uses:
- `#C27A1A` for PK icons/badges -- should be `var(--bp-caution)`
- `#FDF3E3` for PK background -- should be `var(--bp-caution-light)`
- `#3D7C4F` for Fabric badge -- same as ObjectTree

**Fix**: Replaced all hardcoded hex with existing CSS custom property references (`--bp-operational`, `--bp-operational-light`, `--bp-caution`, `--bp-caution-light`, `--bp-copper`). No new tokens needed.

### F4-F6: Accessibility

The tree component uses `<div>` and `<button>` elements without any ARIA tree roles. Screen readers cannot interpret the hierarchy. Tab buttons in TableDetail lack `role="tab"` and `aria-selected`.

**Fix**: Added `role="tree"` to the tree container, `role="treeitem"` and `aria-expanded` to expandable nodes, `role="group"` to child containers, `aria-label` to the tree and resize handle, `role="tab"` and `aria-selected` to tab buttons, `role="tabpanel"` to tab content.

### F7: Dead Stub Endpoint

`GET /api/sql-explorer/lakehouse-file-detail` returns `{"note": "Delta table detail not yet implemented"}`. No frontend consumer.

**Deferred**: Remove when cleaning up unused endpoints.

### F8: `isRegistered` Ghost Field

ObjectTree.tsx lines 543-545 conditionally render a "Registered" badge and change database icon color when `db.isRegistered` is true. However, the `/api/sql-explorer/databases` backend endpoint never returns an `isRegistered` field -- the `SourceDatabase` TypeScript type has it as `isRegistered?: boolean` (optional), so it is always `undefined`/falsy.

**Deferred**: Requires enriching the databases response with a cross-check against `entity_status` or `datasources` tables. Not a safe single-file fix.

### F9-F10: Security Gaps

**F9**: `post_server_label` accepts any server string and stores it in `admin_config` without checking the connections allowlist. An attacker with API access could store labels for arbitrary hostnames. Low risk since this is an internal tool, but inconsistent with the pattern used by other endpoints.

**Fix**: Added `_validate_server(server)` call to `post_server_label`.

**F10**: `lakehouse-file-tables` passes the `namespace` parameter directly into a URL path segment (`/Files/{namespace}`) without sanitization. A crafted namespace like `../../Tables` could cause path traversal in the OneLake API request.

**Fix**: Added URL-encoding and basic path traversal validation for `namespace` and `table_folder` params.

### F12: Silent Fetch Failures

When `toggleDatabase` or `toggleSchema` fetch calls return non-200, the response is silently ignored (node shows as expanded but empty). User has no indication that the fetch failed vs. the schema truly being empty.

**Fix**: Added error state tracking for failed node fetches with inline error indicators.

### F15: Invisible Resize Handle

The resize handle is a 3px transparent bar with no hover state, making it difficult to discover.

**Fix**: Added hover background color using `var(--bp-border)`.

---

## Table Browser Feature — Addendum (2026-03-26)

**Purpose**: Audit baseline for adding a Table Browser feature that lets users browse source tables, select unregistered ones, register them into the pipeline, and trigger an immediate load.

### Additional Findings

| # | Severity | Category | Finding | File:Line |
|---|----------|----------|---------|-----------|
| 16 | MODERATE | Missing | No "already registered" indicator on tables in ObjectTree. All tables shown identically regardless of pipeline status. | ObjectTree.tsx |
| 17 | MODERATE | Missing | No multi-select mechanism. ObjectTree is single-select only — clicking opens detail panel. | ObjectTree.tsx |
| 18 | LOW | Gap | `SourceTable` interface is minimal (TABLE_NAME, TABLE_TYPE). Missing row_count, size_bytes, is_registered, entity_id. | sqlExplorer.ts:25-28 |
| 19 | Info | Existing | `/api/source-manager/discover-all` already does bulk auto-discovery + cascade registration (LZ->Bronze->Silver). Reusable. | source_manager.py:845-1078 |
| 20 | Info | Existing | `/api/source-tables` (POST) discovers tables for a server/database with row counts. | source_manager.py |
| 21 | Info | Existing | `control_plane_db.py` has upsert functions for all 3 layers. Registration logic is complete. | control_plane_db.py:1315-1375 |
| 22 | MODERATE | Missing | No "trigger run for specific entities" from SQL Explorer context. User must go to LMC. | — |
| 23 | LOW | Gap | ObjectTree caches discovered tables. Registration would need cache invalidation. | ObjectTree.tsx |
| 24 | Info | Existing | F8 (`isRegistered` ghost field) — ObjectTree already has conditional badge rendering for `db.isRegistered` (lines 543-545) but backend never sends it. Fixing F8 provides a foundation for table-level registration badges. | ObjectTree.tsx:543-545 |

### Existing Backend Capabilities (Reusable)

| Endpoint | What it does | Reusable for Table Browser? |
|----------|-------------|---------------------------|
| `GET /api/sql-explorer/tables` | Lists tables in a schema | YES — enrich with registration status |
| `POST /api/source-tables` | Discovers tables with row counts | YES — already returns enriched data |
| `POST /api/source-manager/discover-all` | Bulk register LZ->Bronze->Silver | PARTIAL — too broad; need per-table version |
| `POST /api/register-bronze-silver` | Cascade Bronze/Silver from LZ | YES — after LZ registration |
| `POST /api/engine/start` | Start engine run with entity filter | YES — filter to new entity IDs |

### Registration Flow (Required)

```
User selects tables in SQL Explorer
  → POST /api/entities/register-tables  (NEW endpoint)
    → Insert into lz_entities (DataSourceId, SourceSchema, SourceName, FileName, FilePath)
    → Insert into bronze_entities (LandingzoneEntityId, LakehouseId, Schema_, Name)
    → Insert into silver_entities (BronzeLayerEntityId, LakehouseId, Schema_, Name)
    → Return new entity IDs
  → POST /api/engine/start (with entity filter = new IDs)
    → Engine extracts just those tables across LZ->Bronze->Silver
  → Redirect to LMC to watch progress
```
