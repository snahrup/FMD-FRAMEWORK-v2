# FMD Canvas Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a governed drag-and-drop FMD pipeline canvas inside the dashboard that compiles visual flows into a validated FMD Flow DSL, dry-run plan, and existing engine/Dagster launch request.

**Architecture:** The dashboard owns the visual authoring surface with `@xyflow/react`. A lightweight Python route persists flow drafts in SQLite, validates medallion constraints, compiles a run plan, and launches through `/api/engine/start` semantics rather than inventing a separate runtime. Fabric pipeline, Fabric notebook/Spark, NiFi, Hop, Airbyte, Windmill, and Kestra appear as typed future adapter nodes, but only FMD/Fabric execution is active in this MVP.

**Tech Stack:** React 19, TypeScript, Vite, `@xyflow/react`, lucide-react, stdlib Python route decorators, SQLite control-plane DB.

---

## File Structure

- Create `dashboard/app/api/routes/canvas.py`: SQLite-backed canvas API, DSL validation, dry-run compiler, launch proxy.
- Create `dashboard/app/api/tests/test_routes_canvas.py`: route-level coverage for default flow, validation, dry-run, save/list, and launch payload construction.
- Create `dashboard/app/src/features/canvas/types.ts`: shared Flow DSL, node, validation, and API types.
- Create `dashboard/app/src/features/canvas/flowCompiler.ts`: client-side DSL normalization, validation, stats, and medallion utility functions.
- Create `dashboard/app/src/features/canvas/FmdPipelineCanvas.tsx`: full React Flow page shell, palette, canvas, node config panel, validation panel, run plan, and launch action.
- Create `dashboard/app/src/pages/PipelineCanvas.tsx`: route wrapper.
- Modify `dashboard/app/src/App.tsx`: add `/canvas` route.
- Modify `dashboard/app/src/components/layout/AppLayout.tsx`: add Canvas Builder to the Load/Monitor navigation.
- Modify `dashboard/app/src/index.css`: add canvas-specific React Flow styling aligned with the IP Corp/FMD design system.

## Design Direction

- Intent: data/platform operators need to author a safe medallion flow, understand what will happen, and launch only when the flow is valid.
- Palette: white canvas, cool gray grid/lines, IP blue for active authoring, green/amber/red for state, bronze/silver/gold only when they communicate layers.
- Depth: borders-only, no shadows, status rails and subtle surface shifts.
- Surfaces: sidebar palette, central grid, right inspector, bottom receipt/plan strip.
- Typography: existing Manrope/BP tokens and tabular numeric treatment.
- Spacing: 4px grid with dense operator layout, not a spacious marketing canvas.

## Execution Tasks

### Task 1: Backend Canvas Contract

**Files:**
- Create: `dashboard/app/api/routes/canvas.py`
- Create: `dashboard/app/api/tests/test_routes_canvas.py`

- [ ] Add SQLite table bootstrap for `canvas_flows`.
- [ ] Implement `GET /api/canvas/flows` returning saved flows and a default governed sample.
- [ ] Implement `POST /api/canvas/flows` to create/update drafts.
- [ ] Implement `GET /api/canvas/flows/{flow_id}`.
- [ ] Implement `POST /api/canvas/flows/{flow_id}/validate`.
- [ ] Implement `POST /api/canvas/flows/{flow_id}/dry-run`.
- [ ] Implement `POST /api/canvas/flows/{flow_id}/run` that validates, compiles, and delegates to `/api/engine/start` payload shape.
- [ ] Cover route behavior with focused API tests.

### Task 2: Shared Canvas DSL

**Files:**
- Create: `dashboard/app/src/features/canvas/types.ts`
- Create: `dashboard/app/src/features/canvas/flowCompiler.ts`

- [ ] Define constrained node kinds: `sql_source`, `landing_zone`, `bronze_transform`, `silver_transform`, `quality_gate`, `approval_gate`, `fabric_pipeline`, `fabric_notebook`, `external_adapter`.
- [ ] Define canvas DSL shape with metadata, nodes, edges, validation, run plan, and adapter status.
- [ ] Implement default flow seed matching SQL Server -> Landing -> Bronze -> Silver.
- [ ] Implement medallion-order validation, orphan detection, source-to-target checks, secret hygiene, and executable-node retry-policy checks.
- [ ] Implement run-plan compilation into layers, entity IDs, adapter steps, and `/api/engine/start` request preview.

### Task 3: React Flow Authoring Surface

**Files:**
- Create: `dashboard/app/src/features/canvas/FmdPipelineCanvas.tsx`
- Create: `dashboard/app/src/pages/PipelineCanvas.tsx`
- Modify: `dashboard/app/src/index.css`

- [ ] Build IP Corp page shell with intent header, status receipt, and action rail.
- [ ] Build draggable palette with governed node types and disabled/future adapter labels.
- [ ] Build React Flow canvas with custom node cards, layer rails, minimap, controls, and snap grid.
- [ ] Build config inspector for label, entity IDs, source object, watermark, retry policy, executor, and adapter type.
- [ ] Build validation panel and dry-run plan panel that make it clear what will run and what is blocked.
- [ ] Build save/validate/dry-run/launch buttons with loading, success, and error states.

### Task 4: Routing And Navigation

**Files:**
- Modify: `dashboard/app/src/App.tsx`
- Modify: `dashboard/app/src/components/layout/AppLayout.tsx`

- [ ] Add `/canvas` route.
- [ ] Add `Canvas Builder` to Engineering navigation near Load Center and Source Manager.
- [ ] Include `/canvas` in managed shell routes so spacing matches modern dashboard pages.

### Task 5: Verification

**Commands:**
- `python -m pytest dashboard/app/api/tests/test_routes_canvas.py -q`
- `python -m pytest engine/tests/test_api.py engine/tests/test_lmc_api.py engine/tests/test_logging_db.py -q`
- `npx tsc -b --pretty false`
- `npx vite build`

- [ ] Fix failures without weakening validation.
- [ ] Check `git diff --stat` and ensure no generated logs/previews are staged.
- [ ] Commit the canvas implementation separately from the baseline checkpoint.

## Fabric Compute Extension Notes

- Fabric Data Pipelines and Fabric notebooks should be represented as adapter nodes, not the canonical flow store.
- The DSL must store `executor.kind` and named references, never raw workspace/lakehouse GUIDs or credentials.
- The first active executor remains FMD/Dagster because it already writes engine run/task logs and supports the dashboard's monitoring pages.
- Later implementation can map Fabric notebook nodes to Spark jobs and Fabric pipeline nodes to pipeline invocations while keeping FMD run manifests canonical.

