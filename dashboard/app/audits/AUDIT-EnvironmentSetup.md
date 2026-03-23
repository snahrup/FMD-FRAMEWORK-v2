# AUDIT: EnvironmentSetup Page

**Files**: `EnvironmentSetup.tsx`, `setup/SetupWizard.tsx`, `setup/SetupSettings.tsx`, `setup/ProvisionAll.tsx`, `setup/steps/*.tsx`, `setup/components/*.tsx`, `routes/admin.py`
**Audited**: 2026-03-23
**Verdict**: Functional with missing backend routes for wizard/provision workflows; UI is well-tokenized

---

## Summary Table

| ID | Severity | Description | File | Status |
|----|----------|-------------|------|--------|
| ES-01 | LOW | Hardcoded `#FFFFFF` hex color on active step indicator | StepIndicator.tsx:39 | Fixed |
| ES-02 | LOW | Unused imports: `FabricCapacity`, `FabricEntity`, `FabricConnection`, `FabricSqlDatabase`, `LakehouseAssignment` | SetupWizard.tsx:11-20 | Fixed |
| ES-03 | LOW | Unused import: `FabricEntity` | CapacityStep.tsx:2 | Fixed |
| ES-04 | LOW | Unused import: `EnvironmentConfig` | ConnectionStep.tsx:2 | Fixed |
| ES-05 | LOW | Unused import: `FabricEntity` | DatabaseStep.tsx:2 | Fixed |
| ES-06 | LOW | Unused imports: `FabricEntity`, `NAMING_CONVENTIONS` | LakehouseStep.tsx:2 | Fixed |
| ES-07 | LOW | Unused import: `NAMING_CONVENTIONS` | WorkspaceStep.tsx:2 | Fixed |
| ES-08 | LOW | Unused imports: `cn` | ProvisionAll.tsx:18, ReviewStep.tsx:4 | Fixed |
| ES-09 | MEDIUM | No `aria-label` on mode toggle buttons, no `role="tablist"` | EnvironmentSetup.tsx:79-101 | Fixed |
| ES-10 | MEDIUM | No `aria-label` on refresh icon button in FabricDropdown | FabricDropdown.tsx:138-146 | Fixed |
| ES-11 | MEDIUM | No `aria-label` on select element in FabricDropdown | FabricDropdown.tsx:159 | Fixed |
| ES-12 | MEDIUM | No `aria-label` on retry button | EnvironmentSetup.tsx:108-118 | Fixed |
| ES-13 | MEDIUM | No `aria-label` on Copy IDs button | ProvisionAll.tsx:230-237 | Fixed |
| ES-14 | LOW | ReviewStep table header missing `scope="col"` and status column has no text | ReviewStep.tsx:99-103 | Fixed |
| ES-15 | LOW | Error banners missing `role="alert"` for screen readers | EnvironmentSetup.tsx, ProvisionAll.tsx, ReviewStep.tsx | Fixed |
| ES-16 | CRITICAL | `/api/setup/provision-all` backend route missing | ProvisionAll.tsx:89 | Deferred — needs Fabric API |
| ES-17 | CRITICAL | `/api/setup/save-config` backend route missing | ReviewStep.tsx:53 | Deferred — needs backend work |
| ES-18 | HIGH | `/api/setup/validate` backend route missing | ReviewStep.tsx:68 | Deferred — needs backend work |
| ES-19 | HIGH | `/api/setup/capacities` backend route missing | CapacityStep, ProvisionAll | Deferred — needs Fabric API |
| ES-20 | HIGH | `/api/setup/workspaces/{id}/lakehouses` backend route missing | LakehouseStep, SetupSettings | Deferred — needs Fabric API |
| ES-21 | HIGH | `/api/setup/workspaces/{id}/sql-databases` backend route missing | DatabaseStep, SetupSettings | Deferred — needs Fabric API |
| ES-22 | HIGH | `/api/setup/workspaces/{id}/notebooks` backend route missing | SetupSettings | Deferred — needs Fabric API |
| ES-23 | HIGH | `/api/setup/workspaces/{id}/pipelines` backend route missing | SetupSettings | Deferred — needs Fabric API |
| ES-24 | HIGH | `/api/setup/create-workspace` backend route missing | WorkspaceStep, SetupSettings | Deferred — needs Fabric API |
| ES-25 | HIGH | `/api/setup/create-lakehouse` backend route missing | LakehouseStep, SetupSettings | Deferred — needs Fabric API |
| ES-26 | HIGH | `/api/setup/create-sql-database` backend route missing | DatabaseStep, SetupSettings | Deferred — needs Fabric API |
| ES-27 | INFO | `rgba(0,0,0,0.06)` used for box-shadow on mode toggle | EnvironmentSetup.tsx:94 | Won't Fix — shadow tokens not in design system |
| ES-28 | INFO | `current-config` route returns `null` for database, config workspace, prod workspaces | admin.py:186-209 | Deferred — shared route, partial data only |

---

## Detailed Findings

### ES-01: Hardcoded `#FFFFFF` in StepIndicator

The active step circle used `#FFFFFF` for text color instead of a design token. Replaced with `var(--bp-surface-1)` which is the lightest surface color (`#FEFDFB`), providing sufficient contrast on the `--bp-copper` background.

### ES-02 through ES-08: Dead Imports

Multiple files imported types and utilities that were never referenced in the component body. All cleaned up:
- **SetupWizard.tsx**: Removed 5 unused type imports (`FabricCapacity`, `FabricEntity`, `FabricConnection`, `FabricSqlDatabase`, `LakehouseAssignment`)
- **CapacityStep.tsx**: Removed `FabricEntity`
- **ConnectionStep.tsx**: Removed `EnvironmentConfig`
- **DatabaseStep.tsx**: Removed `FabricEntity`
- **LakehouseStep.tsx**: Removed `FabricEntity`, `NAMING_CONVENTIONS`
- **WorkspaceStep.tsx**: Removed `NAMING_CONVENTIONS`
- **ProvisionAll.tsx**: Removed `cn` (from `@/lib/utils`)
- **ReviewStep.tsx**: Removed `cn` (from `@/lib/utils`)

### ES-09 through ES-13: Accessibility — Missing ARIA Attributes

- Mode toggle buttons had no `role="tablist"`, `role="tab"`, or `aria-selected` attributes
- FabricDropdown refresh icon button had no `aria-label`
- FabricDropdown `<select>` had no `aria-label` (only visual label via separate `<label>` element not associated via `htmlFor`)
- Retry button in error banner had no `aria-label`
- Copy IDs button had no `aria-label`

### ES-14: Table Header Accessibility

ReviewStep review table's `<th>` elements lacked `scope="col"`. The third column (status icons) had an empty `<th>` with no screen-reader text. Added `scope="col"` to all headers and a visually-hidden "Status" label.

### ES-15: Error Banners Missing `role="alert"`

Error/warning banners in EnvironmentSetup, ProvisionAll, and ReviewStep were not announced to screen readers. Added `role="alert"` to all three.

### ES-16 through ES-26: Missing Backend Routes (Deferred)

The previous audit (2026-03-13) identified that `/api/setup/current-config` and `/api/setup/provision-all` were missing. Since then, `current-config` has been implemented in `admin.py` (line 144). However, the following routes remain missing:

| Route | Method | Used By | Purpose |
|-------|--------|---------|---------|
| `/api/setup/provision-all` | POST | ProvisionAll | Creates all workspaces, lakehouses, DB in one shot |
| `/api/setup/save-config` | POST | ReviewStep | Persists config to yaml/json/SQL/var libs |
| `/api/setup/validate` | GET | ReviewStep | Validates config consistency |
| `/api/setup/capacities` | GET | CapacityStep, ProvisionAll | Lists Fabric capacities |
| `/api/setup/workspaces/{id}/lakehouses` | GET | LakehouseStep, SetupSettings | Lists lakehouses in workspace |
| `/api/setup/workspaces/{id}/sql-databases` | GET | DatabaseStep, SetupSettings | Lists SQL databases in workspace |
| `/api/setup/workspaces/{id}/notebooks` | GET | SetupSettings | Lists notebooks in workspace |
| `/api/setup/workspaces/{id}/pipelines` | GET | SetupSettings | Lists pipelines in workspace |
| `/api/setup/create-workspace` | POST | WorkspaceStep, SetupSettings | Creates a Fabric workspace |
| `/api/setup/create-lakehouse` | POST | LakehouseStep, SetupSettings | Creates a lakehouse |
| `/api/setup/create-sql-database` | POST | DatabaseStep, SetupSettings | Creates a SQL database |

All of these require Fabric REST API integration with service principal auth. The frontend handles missing routes gracefully (FabricDropdown shows error states, ProvisionAll shows error banner).

### ES-27: rgba in Box Shadow

The mode toggle uses `rgba(0,0,0,0.06)` for a subtle box shadow. There is no `--bp-shadow-*` token in the design system, and this is a standard shadow pattern. Won't fix.

### ES-28: Incomplete current-config Route

The existing `GET /api/setup/current-config` route in `admin.py` returns `null` for the database, config workspace, and production workspaces. It reads from `config.json` which only stores `workspace_data_id` and `workspace_code_id`. This is a shared route used beyond EnvironmentSetup, so marked as deferred.

---

## What's Working Well

1. **Token compliance**: Nearly 100% — all colors, fonts, borders, and backgrounds use `var(--bp-*)` tokens (only one `#FFFFFF` found and fixed)
2. **Error handling**: All fetch calls have try/catch with user-visible error states
3. **Loading states**: FabricDropdown shows loading spinners; main page has centered loader
4. **Empty states**: FabricDropdown shows "-- Select --"; disabled state shows explanation message
5. **Idempotent design**: Provisioning is explicitly documented as safe to re-run
6. **Type safety**: Strong TypeScript types throughout with `EnvironmentConfig` as the central shape
7. **AbortController**: Main page properly cancels in-flight requests on unmount
