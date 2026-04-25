# Fabric Pipeline Mirror Target

## Current State

Canvas Fabric nodes are planned mirror nodes. They appear in the compiled run plan, but they do not yet create, update, or run Microsoft Fabric Data Factory pipeline artifacts.

Current execution still routes through FMD/Dagster. The dashboard config must also be in Dagster `framework` mode before any real extraction/write path is allowed.

## Target Behavior

When a user selects `Fabric Pipeline mirror` on a canvas node, the canvas becomes the source of truth for a real Fabric pipeline artifact:

1. Compile the canvas graph into an execution contract.
2. Translate the selected canvas branch into a Fabric pipeline definition.
3. Create or update the Fabric pipeline artifact in the configured workspace.
4. Store the mapping from `canvas_flow_id` and `node_id` to Fabric artifact IDs.
5. Launch the Fabric pipeline run from the dashboard/Dagster control plane.
6. Poll Fabric run status and stream progress back into Mission Control.
7. Mark canvas nodes, connectors, task log rows, and run history from the same run ID.

## Control Plane Contract

Dagster remains the orchestration control plane. Fabric runs are compute/execution targets, not a separate untracked launch path.

The run record should keep:

- FMD run ID
- Dagster run ID
- Fabric workspace ID
- Fabric pipeline artifact ID
- Fabric job/run instance ID
- Canvas flow ID
- Canvas node ID
- Layers and entity IDs scoped by the node

## Safety Rules

- Never auto-create a full-estate Fabric pipeline without explicit scope.
- Never silently widen an empty source/entity selection to all entities.
- Show a preflight receipt before real Fabric artifact creation.
- Surface Fabric API errors directly in Mission Control.
- Keep generated Fabric artifacts identifiable as FMD-managed.

## Implementation Slices

1. Add a Fabric artifact registry table to the control-plane database.
2. Build a Fabric REST client for pipeline create/update/run/status.
3. Add canvas-to-Fabric pipeline compiler output.
4. Add `/api/canvas/flows/{flow_id}/fabric/preview` for dry-run artifact preview.
5. Add `/api/canvas/flows/{flow_id}/fabric/sync` to create/update the real artifact.
6. Extend Dagster launch payloads with Fabric target metadata.
7. Sync Fabric run status into `engine_task_log`, SSE, and Mission Control.
8. Add UI receipts showing planned artifact changes before sync.

