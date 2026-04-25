import {
  FLOW_SCHEMA_VERSION,
  type CanvasNodeType,
  type FmdCanvasFlow,
  type FmdCanvasNode,
  type FmdRunPlan,
  type FmdRunPlanStep,
  type FmdValidationMessage,
  type FmdValidationResult,
  type MedallionLayer,
  type NodeTemplate,
} from "./types";

export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    type: "sql_source",
    label: "SQL Source",
    eyebrow: "Origin",
    description: "Registered source table from SQL Server, M3, MES, ETQ, or Optiva.",
    palette: "source",
    defaults: {
      sourceSystem: "MES",
      schema: "dbo",
      object: "alel_lab_batch_hdr_tbl",
      entityIds: [599],
      loadStrategy: "full",
      connectionRef: "secret://connections/mes",
    },
  },
  {
    type: "landing_zone",
    label: "Landing Zone",
    eyebrow: "Raw copy",
    description: "Extract into OneLake Landing Zone with scoped entity IDs.",
    palette: "layer",
    defaults: {
      entityIds: [599],
      format: "parquet",
      retryPolicy: "standard",
      executor: "fmd_framework",
    },
  },
  {
    type: "bronze_transform",
    label: "Bronze Delta",
    eyebrow: "Structured",
    description: "Normalize raw files into Bronze Delta tables.",
    palette: "layer",
    defaults: {
      entityIds: [599],
      retryPolicy: "standard",
      schemaDriftPolicy: "warn",
      executor: "fmd_framework",
    },
  },
  {
    type: "silver_transform",
    label: "Silver SCD2",
    eyebrow: "Business-ready",
    description: "Apply Silver transformation, SCD handling, and quality policy.",
    palette: "layer",
    defaults: {
      entityIds: [599],
      retryPolicy: "standard",
      qualityPolicy: "silver_standard",
      executor: "fmd_framework",
    },
  },
  {
    type: "quality_gate",
    label: "Quality Gate",
    eyebrow: "Control",
    description: "Block promotion when row count, schema, or Delta checks fail.",
    palette: "gate",
    defaults: {
      policy: "row_count_schema_and_delta_log",
      blocking: true,
    },
  },
  {
    type: "approval_gate",
    label: "Approval Gate",
    eyebrow: "Governance",
    description: "Capture data owner or operations approval before publish.",
    palette: "gate",
    defaults: {
      approvalRole: "data_owner",
      blocking: true,
    },
  },
  {
    type: "fabric_pipeline",
    label: "Fabric Pipeline",
    eyebrow: "Compute",
    description: "Future adapter for calling a named Fabric Data Pipeline.",
    palette: "fabric",
    future: true,
    defaults: {
      executor: "fabric_pipeline",
      referenceName: "PL_FMD_LOAD_ALL",
      retryPolicy: "standard",
      enabled: false,
    },
  },
  {
    type: "fabric_notebook",
    label: "Fabric Notebook",
    eyebrow: "Spark",
    description: "Future adapter for Spark-backed notebook compute.",
    palette: "fabric",
    future: true,
    defaults: {
      executor: "fabric_notebook",
      referenceName: "NB_FMD_LOAD_BRONZE_SILVER",
      retryPolicy: "standard",
      enabled: false,
    },
  },
  {
    type: "external_adapter",
    label: "External Adapter",
    eyebrow: "Extension",
    description: "Modeled seam for NiFi, Hop, Airbyte, Windmill, or Kestra.",
    palette: "adapter",
    future: true,
    defaults: {
      executor: "external_adapter",
      adapter: "nifi",
      retryPolicy: "manual",
      enabled: false,
    },
  },
];

const EXECUTABLE_TYPES = new Set<CanvasNodeType>([
  "landing_zone",
  "bronze_transform",
  "silver_transform",
  "fabric_pipeline",
  "fabric_notebook",
  "external_adapter",
]);

const LAYER_BY_TYPE: Partial<Record<CanvasNodeType, MedallionLayer>> = {
  landing_zone: "landing",
  bronze_transform: "bronze",
  silver_transform: "silver",
};

const RANK_BY_TYPE: Record<CanvasNodeType, number> = {
  sql_source: 0,
  landing_zone: 1,
  bronze_transform: 2,
  silver_transform: 3,
  quality_gate: 4,
  approval_gate: 5,
  fabric_pipeline: 6,
  fabric_notebook: 6,
  external_adapter: 6,
};

export function createDefaultFlow(): FmdCanvasFlow {
  return {
    apiVersion: FLOW_SCHEMA_VERSION,
    id: "default-fmd-medallion",
    name: "FMD Medallion Load",
    description: "Governed SQL Server source through Landing Zone, Bronze, and Silver.",
    status: "draft",
    metadata: {
      owner: "FMD Platform",
      domain: "MES",
    },
    nodes: [
      {
        id: "source-sql",
        type: "sql_source",
        label: "MES SQL Source",
        config: { ...NODE_TEMPLATES[0].defaults },
      },
      {
        id: "landing-zone",
        type: "landing_zone",
        label: "Landing Zone",
        config: { ...NODE_TEMPLATES[1].defaults },
      },
      {
        id: "bronze",
        type: "bronze_transform",
        label: "Bronze Delta",
        config: { ...NODE_TEMPLATES[2].defaults },
      },
      {
        id: "silver",
        type: "silver_transform",
        label: "Silver SCD2",
        config: { ...NODE_TEMPLATES[3].defaults },
      },
      {
        id: "quality-gate",
        type: "quality_gate",
        label: "Quality Gate",
        config: { ...NODE_TEMPLATES[4].defaults },
      },
    ],
    edges: [
      { id: "e-source-landing", source: "source-sql", target: "landing-zone" },
      { id: "e-landing-bronze", source: "landing-zone", target: "bronze" },
      { id: "e-bronze-silver", source: "bronze", target: "silver" },
      { id: "e-silver-quality", source: "silver", target: "quality-gate" },
    ],
  };
}

export function templateForType(type: CanvasNodeType): NodeTemplate {
  return NODE_TEMPLATES.find((template) => template.type === type) ?? NODE_TEMPLATES[0];
}

export function normalizeEntityIds(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const ids: number[] = [];
  for (const item of raw) {
    const parsed = Number(item);
    if (Number.isFinite(parsed) && parsed > 0 && !ids.includes(parsed)) {
      ids.push(parsed);
    }
  }
  return ids;
}

export function entityIdsToInput(ids: number[] | undefined): string {
  return (ids ?? []).join(", ");
}

export function parseEntityIdsInput(value: string): number[] {
  return normalizeEntityIds(value);
}

function hasCycle(flow: FmdCanvasFlow): boolean {
  const graph = new Map<string, string[]>();
  for (const node of flow.nodes) {
    graph.set(node.id, []);
  }
  for (const edge of flow.edges) {
    if (graph.has(edge.source) && graph.has(edge.target)) {
      graph.get(edge.source)?.push(edge.target);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const child of graph.get(nodeId) ?? []) {
      if (visit(child)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return flow.nodes.some((node) => visit(node.id));
}

function scanSecrets(value: unknown, path: string, errors: FmdValidationMessage[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSecrets(item, `${path}[${index}]`, errors));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = path ? `${path}.${key}` : key;
    if (/(password|secret|token|key|client_secret)/i.test(key)) {
      if (typeof nested === "string" && nested && !nested.startsWith("secret://")) {
        errors.push({
          code: "secret_literal",
          message: `${nestedPath} must use a secret:// reference, not a literal value.`,
        });
      }
    }
    scanSecrets(nested, nestedPath, errors);
  }
}

export function validateFlow(flow: FmdCanvasFlow): FmdValidationResult {
  const errors: FmdValidationMessage[] = [];
  const warnings: FmdValidationMessage[] = [];
  const nodeById = new Map(flow.nodes.map((node) => [node.id, node]));
  const incoming = new Map(flow.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(flow.nodes.map((node) => [node.id, 0]));

  if (flow.apiVersion !== FLOW_SCHEMA_VERSION) {
    errors.push({ code: "api_version", message: `apiVersion must be ${FLOW_SCHEMA_VERSION}.` });
  }

  if (nodeById.size !== flow.nodes.length) {
    errors.push({ code: "duplicate_node_id", message: "Every node id must be unique." });
  }

  for (const edge of flow.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source) {
      errors.push({ code: "unknown_edge_source", message: `Edge source ${edge.source} does not exist.` });
      continue;
    }
    if (!target) {
      errors.push({ code: "unknown_edge_target", message: `Edge target ${edge.target} does not exist.` });
      continue;
    }
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    if (RANK_BY_TYPE[target.type] < RANK_BY_TYPE[source.type]) {
      errors.push({
        code: "medallion_back_edge",
        message: `${source.label} cannot flow backward into ${target.label}.`,
      });
    }
    if (source.type === "sql_source" && !["landing_zone", "fabric_pipeline", "external_adapter"].includes(target.type)) {
      errors.push({ code: "source_skip", message: "SQL source nodes must land data before Bronze or Silver." });
    }
  }

  if (hasCycle(flow)) {
    errors.push({ code: "cycle", message: "The canvas contains a cycle. FMD flows must be acyclic." });
  }

  for (const node of flow.nodes) {
    if (node.type !== "sql_source" && (incoming.get(node.id) ?? 0) === 0) {
      errors.push({ code: "orphan_node", message: `${node.label} has no upstream input.` });
    }
    if (node.type === "sql_source" && (outgoing.get(node.id) ?? 0) === 0) {
      errors.push({ code: "orphan_source", message: `${node.label} is not connected to a load step.` });
    }
    if (EXECUTABLE_TYPES.has(node.type) && !node.config.retryPolicy) {
      errors.push({ code: "retry_policy", message: `${node.label} needs a retry policy before it can run.` });
    }
    if (LAYER_BY_TYPE[node.type] && normalizeEntityIds(node.config.entityIds).length === 0) {
      errors.push({ code: "entity_scope", message: `${node.label} needs at least one LandingzoneEntityId.` });
    }
    if (["fabric_pipeline", "fabric_notebook", "external_adapter"].includes(node.type) && node.config.enabled !== true) {
      warnings.push({
        code: "adapter_modeled",
        message: `${node.label} is modeled for the plan, but MVP launch delegates through the FMD/Dagster runtime.`,
      });
    }
  }

  const nodeTypes = new Set(flow.nodes.map((node) => node.type));
  if (!nodeTypes.has("landing_zone")) {
    errors.push({ code: "missing_landing", message: "A runnable FMD flow needs a Landing Zone node." });
  }
  if (nodeTypes.has("silver_transform") && !nodeTypes.has("bronze_transform")) {
    errors.push({ code: "missing_bronze_for_silver", message: "Silver requires Bronze first." });
  }

  scanSecrets(flow, "", errors);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      nodeCount: flow.nodes.length,
      edgeCount: flow.edges.length,
      executableNodeCount: flow.nodes.filter((node) => EXECUTABLE_TYPES.has(node.type)).length,
    },
    checkedAt: new Date().toISOString(),
  };
}

export function compileRunPlan(flow: FmdCanvasFlow): FmdRunPlan {
  const layers: MedallionLayer[] = [];
  const entityIds: number[] = [];
  const steps: FmdRunPlanStep[] = [];
  const adapterSteps: FmdRunPlanStep[] = [];

  for (const node of flow.nodes) {
    const layer = LAYER_BY_TYPE[node.type];
    const nodeEntityIds = normalizeEntityIds(node.config.entityIds);
    for (const entityId of nodeEntityIds) {
      if (!entityIds.includes(entityId)) entityIds.push(entityId);
    }
    if (layer && !layers.includes(layer)) layers.push(layer);
    if (EXECUTABLE_TYPES.has(node.type)) {
      const step: FmdRunPlanStep = {
        nodeId: node.id,
        label: node.label,
        type: node.type,
        layer,
        executor: String(node.config.executor || "fmd_framework"),
        entityIds: nodeEntityIds,
        retryPolicy: String(node.config.retryPolicy || "standard"),
      };
      steps.push(step);
      if (["fabric_pipeline", "fabric_notebook", "external_adapter"].includes(node.type)) {
        adapterSteps.push({
          ...step,
          status: "modeled",
          note: "Adapter node is planned, but execution remains routed through FMD/Dagster until the adapter is activated.",
        });
      }
    }
  }

  return {
    flowId: flow.id,
    flowName: flow.name,
    layers: layers.length ? layers : ["landing", "bronze", "silver"],
    entityIds,
    steps,
    adapterSteps,
    launchPayload: {
      orchestrator: "dagster",
      mode: "run",
      dry_run: false,
      dagster_mode: "framework",
      layers: layers.length ? layers : ["landing", "bronze", "silver"],
      entity_ids: entityIds,
      triggered_by: "canvas",
      resolved_entity_count: entityIds.length,
      canvas_flow_id: flow.id,
      canvas_flow_name: flow.name,
    },
    summary: {
      layerCount: layers.length,
      entityCount: entityIds.length,
      stepCount: steps.length,
      adapterStepCount: adapterSteps.length,
    },
    compiledAt: new Date().toISOString(),
  };
}

export function cloneNodeFromTemplate(type: CanvasNodeType, positionIndex: number): FmdCanvasNode {
  const template = templateForType(type);
  const suffix = `${type.replaceAll("_", "-")}-${Date.now().toString(36)}-${positionIndex}`;
  return {
    id: suffix,
    type,
    label: template.label,
    config: { ...template.defaults },
  };
}

export function layerTone(type: CanvasNodeType): { color: string; label: string } {
  switch (type) {
    case "sql_source":
      return { color: "var(--bp-ink-tertiary)", label: "Source" };
    case "landing_zone":
      return { color: "var(--bp-copper)", label: "Landing" };
    case "bronze_transform":
      return { color: "var(--bp-bronze, #b7791f)", label: "Bronze" };
    case "silver_transform":
      return { color: "var(--bp-silver, #64748b)", label: "Silver" };
    case "quality_gate":
      return { color: "var(--bp-operational)", label: "Quality" };
    case "approval_gate":
      return { color: "var(--bp-caution)", label: "Approval" };
    case "fabric_pipeline":
    case "fabric_notebook":
      return { color: "var(--bp-copper)", label: "Fabric" };
    case "external_adapter":
      return { color: "var(--bp-ink-muted)", label: "Adapter" };
    default:
      return { color: "var(--bp-ink-muted)", label: "Node" };
  }
}

