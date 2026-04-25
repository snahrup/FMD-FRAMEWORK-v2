export const FLOW_SCHEMA_VERSION = "fmd.flow/v1alpha1" as const;

export type CanvasNodeType =
  | "sql_source"
  | "landing_zone"
  | "bronze_transform"
  | "silver_transform"
  | "quality_gate"
  | "approval_gate"
  | "fabric_pipeline"
  | "fabric_notebook"
  | "external_adapter";

export type MedallionLayer = "landing" | "bronze" | "silver";

export interface FmdCanvasNodeConfig {
  sourceSystem?: string;
  schema?: string;
  object?: string;
  entityIds?: number[];
  loadStrategy?: "full" | "incremental";
  watermarkColumn?: string;
  connectionRef?: string;
  format?: string;
  retryPolicy?: "standard" | "aggressive" | "manual" | string;
  executor?: "fmd_framework" | "fabric_pipeline" | "fabric_notebook" | "external_adapter" | string;
  schemaDriftPolicy?: "fail" | "warn" | "allow" | string;
  qualityPolicy?: string;
  policy?: string;
  blocking?: boolean;
  approvalRole?: string;
  referenceName?: string;
  adapter?: "nifi" | "hop" | "airbyte" | "windmill" | "kestra" | string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface FmdCanvasNode {
  id: string;
  type: CanvasNodeType;
  label: string;
  config: FmdCanvasNodeConfig;
}

export interface FmdCanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface FmdCanvasFlow {
  apiVersion: typeof FLOW_SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  status: "draft" | "validated" | "published" | "archived" | string;
  metadata: {
    owner: string;
    domain: string;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
  };
  nodes: FmdCanvasNode[];
  edges: FmdCanvasEdge[];
}

export interface FmdValidationMessage {
  code: string;
  message: string;
}

export interface FmdValidationResult {
  ok: boolean;
  errors: FmdValidationMessage[];
  warnings: FmdValidationMessage[];
  summary: {
    nodeCount: number;
    edgeCount: number;
    executableNodeCount: number;
  };
  checkedAt?: string;
}

export interface FmdRunPlanStep {
  nodeId: string;
  label: string;
  type: CanvasNodeType;
  layer?: MedallionLayer;
  executor: string;
  entityIds: number[];
  retryPolicy: string;
  status?: string;
  note?: string;
}

export interface FmdRunPlan {
  flowId: string;
  flowName: string;
  layers: MedallionLayer[];
  entityIds: number[];
  steps: FmdRunPlanStep[];
  adapterSteps: FmdRunPlanStep[];
  launchPayload: {
    orchestrator: "dagster";
    mode: "run";
    dry_run: boolean;
    dagster_mode: "framework";
    layers: MedallionLayer[];
    entity_ids: number[];
    triggered_by: "canvas";
    resolved_entity_count: number;
    canvas_flow_id: string;
    canvas_flow_name: string;
  };
  summary: {
    layerCount: number;
    entityCount: number;
    stepCount: number;
    adapterStepCount: number;
  };
  compiledAt?: string;
}

export interface CanvasFlowsResponse {
  flows: FmdCanvasFlow[];
  count: number;
  serverTime: string;
}

export interface CanvasFlowResponse {
  flow: FmdCanvasFlow;
  validation?: FmdValidationResult;
  serverTime: string;
}

export interface CanvasDryRunResponse {
  flowId: string;
  validation: FmdValidationResult;
  runPlan: FmdRunPlan;
  serverTime: string;
}

export interface CanvasRunResponse extends CanvasDryRunResponse {
  engine: {
    previewOnly?: boolean;
    run_id?: string;
    status?: string;
    error?: string;
    [key: string]: unknown;
  };
}

export interface NodeTemplate {
  type: CanvasNodeType;
  label: string;
  eyebrow: string;
  description: string;
  palette: "source" | "layer" | "gate" | "fabric" | "adapter";
  future?: boolean;
  defaults: FmdCanvasNodeConfig;
}

