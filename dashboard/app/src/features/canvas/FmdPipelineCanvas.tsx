import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Database,
  GitBranch,
  GripVertical,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
  SquareArrowOutUpRight,
  Sparkles,
  Workflow,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  cloneNodeFromTemplate,
  compileRunPlan,
  createDefaultFlow,
  entityIdsToInput,
  layerTone,
  NODE_TEMPLATES,
  parseEntityIdsInput,
  templateForType,
  validateFlow,
} from "./flowCompiler";
import type {
  CanvasDryRunResponse,
  CanvasFlowsResponse,
  CanvasNodeType,
  CanvasRunResponse,
  FmdCanvasFlow,
  FmdCanvasNode,
  FmdRunPlan,
  FmdValidationResult,
  NodeTemplate,
} from "./types";

interface CanvasNodeData extends Record<string, unknown> {
  canvasNode: FmdCanvasNode;
  issues: number;
  warnings: number;
  runState?: "queued" | "running" | "complete";
}

type RFNode = Node<CanvasNodeData>;
type RFEdge = Edge;
type RightPanelMode = "inspect" | "review";

interface ActiveCanvasRun {
  runId: string;
}

const NODE_ICON: Record<CanvasNodeType, LucideIcon> = {
  sql_source: Database,
  landing_zone: Layers,
  bronze_transform: Workflow,
  silver_transform: Sparkles,
  quality_gate: ShieldCheck,
  approval_gate: CheckCircle2,
  fabric_pipeline: ServerCog,
  fabric_notebook: Zap,
  external_adapter: GitBranch,
};

const DEFAULT_POSITIONS: Record<string, { x: number; y: number }> = {
  "source-sql": { x: 24, y: 56 },
  "landing-zone": { x: 240, y: 56 },
  bronze: { x: 456, y: 56 },
  silver: { x: 672, y: 56 },
  "quality-gate": { x: 888, y: 56 },
};

function apiErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `API error ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function issueCounts(node: FmdCanvasNode, validation: FmdValidationResult): { issues: number; warnings: number } {
  const label = node.label || node.id;
  const issues = validation.errors.filter((item) => item.message.includes(label) || item.message.includes(node.id)).length;
  const warnings = validation.warnings.filter((item) => item.message.includes(label) || item.message.includes(node.id)).length;
  return { issues, warnings };
}

function toReactNodes(flow: FmdCanvasFlow, validation: FmdValidationResult): RFNode[] {
  return flow.nodes.map((canvasNode, index) => {
    const storedPosition = canvasNode.config.position as { x?: number; y?: number } | undefined;
    const position = {
      x: Number(storedPosition?.x ?? DEFAULT_POSITIONS[canvasNode.id]?.x ?? 80 + index * 240),
      y: Number(storedPosition?.y ?? DEFAULT_POSITIONS[canvasNode.id]?.y ?? 140),
    };
    return {
      id: canvasNode.id,
      type: "fmdNode",
      position,
      data: {
        canvasNode,
        ...issueCounts(canvasNode, validation),
      },
    };
  });
}

function toReactEdges(flow: FmdCanvasFlow): RFEdge[] {
  return flow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: false,
    type: "smoothstep",
    style: { stroke: "var(--bp-copper)", strokeWidth: 1.65 },
  }));
}

function buildFlowFromReactState(base: FmdCanvasFlow, nodes: RFNode[], edges: RFEdge[]): FmdCanvasFlow {
  return {
    ...base,
    metadata: {
      ...base.metadata,
      updatedAt: new Date().toISOString(),
    },
    nodes: nodes.map((node) => ({
      ...node.data.canvasNode,
      config: {
        ...node.data.canvasNode.config,
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: typeof edge.label === "string" ? edge.label : undefined,
    })),
  };
}

function CanvasNodeCard(props: NodeProps<Node<CanvasNodeData>>) {
  const { data, selected } = props;
  const node = data.canvasNode;
  const tone = layerTone(node.type);
  const Icon = NODE_ICON[node.type] ?? Workflow;
  const template = templateForType(node.type);
  const runState = data.runState;
  const stateLabel = runState === "running" ? "Running" : runState === "complete" ? "Handed off" : runState === "queued" ? "Queued" : null;
  return (
    <div className={`fmd-canvas-node gs-stagger-card ${selected ? "fmd-canvas-node--selected" : ""} ${runState ? `fmd-canvas-node--${runState}` : ""}`} style={{ "--node-tone": tone.color } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="fmd-canvas-node__handle" />
      <div className="fmd-canvas-node__rail" />
      <div className="fmd-canvas-node__top">
        <span className="fmd-canvas-node__icon"><Icon size={15} /></span>
        <span className="fmd-canvas-node__eyebrow">{tone.label}</span>
        {data.issues > 0 ? <XCircle size={14} className="fmd-canvas-node__bad" /> : data.warnings > 0 ? <AlertTriangle size={14} className="fmd-canvas-node__warn" /> : <CheckCircle2 size={14} className="fmd-canvas-node__ok" />}
      </div>
      <strong>{node.label}</strong>
      <p>{template.description}</p>
      <div className="fmd-canvas-node__meta">
        {stateLabel ? <span className="fmd-canvas-node__run-state">{stateLabel}</span> : null}
        {node.config.entityIds?.length ? <span>{node.config.entityIds.length} entities</span> : <span>{template.eyebrow}</span>}
        {node.config.retryPolicy ? <span>{String(node.config.retryPolicy)} retry</span> : null}
      </div>
      <Handle type="source" position={Position.Right} className="fmd-canvas-node__handle" />
    </div>
  );
}

const NODE_TYPES = { fmdNode: CanvasNodeCard };

function PaletteCard({ template, index }: { template: NodeTemplate; index: number }) {
  const Icon = NODE_ICON[template.type] ?? Workflow;
  const tone = layerTone(template.type);
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/fmd-node-type", template.type);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="fmd-canvas-palette__card gs-stagger-card"
      style={{ "--node-tone": tone.color, "--i": Math.min(index, 15) } as React.CSSProperties}
    >
      <span className="fmd-canvas-palette__icon"><Icon size={15} /></span>
      <span>
        <strong>{template.label}</strong>
        <small>{template.future ? "Modeled seam" : template.eyebrow}</small>
      </span>
      <GripVertical size={14} />
    </button>
  );
}

function ValidationPanel({ validation }: { validation: FmdValidationResult }) {
  const messages = [...validation.errors, ...validation.warnings];
  return (
    <section className="fmd-canvas-panel">
      <div className="fmd-canvas-panel__header">
        <span>{validation.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span>
        <div>
          <h3>Validation</h3>
          <p>{validation.ok ? "Flow can be dry-run and launched." : `${validation.errors.length} blocking issue(s) need attention.`}</p>
        </div>
      </div>
      <div className="fmd-canvas-validation-list">
        {messages.length === 0 ? (
          <div className="fmd-canvas-empty-row">
            <CheckCircle2 size={15} />
            No validation issues found.
          </div>
        ) : messages.map((item, index) => (
          <div key={`${item.code}-${index}`} className={`fmd-canvas-validation-row ${validation.errors.includes(item) ? "is-error" : "is-warning"}`}>
            {validation.errors.includes(item) ? <XCircle size={14} /> : <AlertTriangle size={14} />}
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RunPlanPanel({ plan }: { plan: FmdRunPlan }) {
  return (
    <section className="fmd-canvas-panel">
      <div className="fmd-canvas-panel__header">
        <span><Play size={15} /></span>
        <div>
          <h3>Compiled Run Plan</h3>
          <p>{plan.summary.entityCount} entities across {plan.layers.join(", ") || "no layers"}</p>
        </div>
      </div>
      <div className="fmd-canvas-plan">
        {plan.steps.map((step) => (
          <div key={step.nodeId} className="fmd-canvas-plan__step">
            <span>{step.layer ?? "adapter"}</span>
            <strong>{step.label}</strong>
            <small>{step.entityIds.length ? `${step.entityIds.length} scoped entities` : step.executor}</small>
          </div>
        ))}
      </div>
      <details className="fmd-canvas-details">
        <summary>Launch payload</summary>
        <pre className="fmd-canvas-payload">{JSON.stringify(plan.launchPayload, null, 2)}</pre>
      </details>
    </section>
  );
}

function NodeInspector({
  selected,
  onUpdate,
  onDelete,
}: {
  selected: FmdCanvasNode | null;
  onUpdate: (node: FmdCanvasNode) => void;
  onDelete: (nodeId: string) => void;
}) {
  if (!selected) {
    return (
      <section className="fmd-canvas-panel fmd-canvas-inspector-empty">
        <Circle size={26} />
        <h3>Select a node</h3>
        <p>Click a canvas node to edit entity scope, retry policy, source object, and execution settings.</p>
      </section>
    );
  }

  const setConfig = (key: string, value: unknown) => {
    onUpdate({ ...selected, config: { ...selected.config, [key]: value } });
  };

  return (
    <section className="fmd-canvas-panel fmd-canvas-inspector">
      <div className="fmd-canvas-panel__header">
        <span><Workflow size={15} /></span>
        <div>
          <h3>Node Inspector</h3>
          <p>{templateForType(selected.type).description}</p>
        </div>
      </div>
      <label>
        Label
        <input value={selected.label} onChange={(event) => onUpdate({ ...selected, label: event.target.value })} />
      </label>
      {selected.type === "sql_source" && (
        <>
          <label>
            Source system
            <input value={String(selected.config.sourceSystem ?? "")} onChange={(event) => setConfig("sourceSystem", event.target.value)} />
          </label>
          <div className="fmd-canvas-inspector__grid">
            <label>
              Schema
              <input value={String(selected.config.schema ?? "")} onChange={(event) => setConfig("schema", event.target.value)} />
            </label>
            <label>
              Object
              <input value={String(selected.config.object ?? "")} onChange={(event) => setConfig("object", event.target.value)} />
            </label>
          </div>
          <label>
            Watermark column
            <input value={String(selected.config.watermarkColumn ?? "")} onChange={(event) => setConfig("watermarkColumn", event.target.value)} placeholder="Optional" />
          </label>
          <label>
            Connection reference
            <input value={String(selected.config.connectionRef ?? "")} onChange={(event) => setConfig("connectionRef", event.target.value)} />
          </label>
        </>
      )}
      {selected.type !== "sql_source" && (
        <>
          <label>
            LandingzoneEntityId scope
            <input
              value={entityIdsToInput(selected.config.entityIds)}
              onChange={(event) => setConfig("entityIds", parseEntityIdsInput(event.target.value))}
              placeholder="599, 600"
            />
          </label>
          <div className="fmd-canvas-inspector__grid">
            <label>
              Executor
              <select value={String(selected.config.executor ?? "fmd_framework")} onChange={(event) => setConfig("executor", event.target.value)}>
                <option value="fmd_framework">FMD / Dagster</option>
                <option value="fabric_pipeline">Fabric Pipeline</option>
                <option value="fabric_notebook">Fabric Notebook</option>
                <option value="external_adapter">External Adapter</option>
              </select>
            </label>
            <label>
              Retry policy
              <select value={String(selected.config.retryPolicy ?? "")} onChange={(event) => setConfig("retryPolicy", event.target.value)}>
                <option value="">Required</option>
                <option value="standard">Standard</option>
                <option value="aggressive">Aggressive</option>
                <option value="manual">Manual</option>
              </select>
            </label>
          </div>
        </>
      )}
      {selected.type === "external_adapter" && (
        <label>
          Adapter
          <select value={String(selected.config.adapter ?? "nifi")} onChange={(event) => setConfig("adapter", event.target.value)}>
            <option value="nifi">Apache NiFi</option>
            <option value="hop">Apache Hop</option>
            <option value="airbyte">Airbyte</option>
            <option value="windmill">Windmill</option>
            <option value="kestra">Kestra</option>
          </select>
        </label>
      )}
      <button type="button" className="fmd-canvas-danger" onClick={() => onDelete(selected.id)}>
        Remove node
      </button>
    </section>
  );
}

function FmdPipelineCanvasInner() {
  const navigate = useNavigate();
  const [baseFlow, setBaseFlow] = useState<FmdCanvasFlow>(createDefaultFlow());
  const [validation, setValidation] = useState<FmdValidationResult>(() => validateFlow(createDefaultFlow()));
  const [runPlan, setRunPlan] = useState<FmdRunPlan>(() => compileRunPlan(createDefaultFlow()));
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(toReactNodes(createDefaultFlow(), validateFlow(createDefaultFlow())));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toReactEdges(createDefaultFlow()));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode | null>(null);
  const [reactFlow, setReactFlow] = useState<ReactFlowInstance<RFNode, RFEdge> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [activeRun, setActiveRun] = useState<ActiveCanvasRun | null>(null);
  const [runPulse, setRunPulse] = useState(0);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; message: string } | null>(null);
  const hasFitInitialViewport = useRef(false);

  const currentFlow = useMemo(() => buildFlowFromReactState(baseFlow, nodes, edges), [baseFlow, nodes, edges]);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId)?.data.canvasNode ?? null, [nodes, selectedNodeId]);
  const localValidation = useMemo(() => validateFlow(currentFlow), [currentFlow]);
  const localRunPlan = useMemo(() => compileRunPlan(currentFlow), [currentFlow]);
  const runStepNodeIds = useMemo(() => runPlan.steps.map((step) => step.nodeId), [runPlan.steps]);
  const activeRunStepIndex = activeRun && runStepNodeIds.length > 0 ? Math.min(runPulse, runStepNodeIds.length - 1) : -1;
  const activeRunNodeId = activeRunStepIndex >= 0 ? runStepNodeIds[activeRunStepIndex] : null;
  const completedRunNodeIds = useMemo(
    () => new Set(activeRun ? runStepNodeIds.slice(0, activeRunStepIndex) : []),
    [activeRun, activeRunStepIndex, runStepNodeIds],
  );
  const missionControlUrl = activeRun ? `/load-mission-control?run_id=${encodeURIComponent(activeRun.runId)}` : "/load-mission-control";

  const renderedNodes = useMemo(() => nodes.map((node) => {
    const counts = issueCounts(node.data.canvasNode, validation);
    const runState: CanvasNodeData["runState"] = !activeRun
      ? undefined
      : node.id === activeRunNodeId
        ? "running"
        : completedRunNodeIds.has(node.id)
          ? "complete"
          : runStepNodeIds.includes(node.id)
            ? "queued"
            : undefined;
    return { ...node, data: { ...node.data, ...counts, runState } };
  }), [activeRun, activeRunNodeId, completedRunNodeIds, nodes, runStepNodeIds, validation]);
  const renderedEdges = useMemo(() => edges.map((edge) => {
    if (!activeRun) return edge;
    const targetIndex = runStepNodeIds.indexOf(String(edge.target));
    const sourceIndex = runStepNodeIds.indexOf(String(edge.source));
    const isActiveEdge = targetIndex === activeRunStepIndex && sourceIndex === activeRunStepIndex - 1;
    const isCompleteEdge = targetIndex >= 0 && targetIndex < activeRunStepIndex;
    return {
      ...edge,
      animated: isActiveEdge,
      className: isActiveEdge ? "fmd-canvas-edge--running" : isCompleteEdge ? "fmd-canvas-edge--complete" : "fmd-canvas-edge--queued",
      style: {
        ...(edge.style ?? {}),
        stroke: isActiveEdge || isCompleteEdge ? "var(--bp-copper)" : "var(--bp-border-strong)",
        strokeWidth: isActiveEdge ? 2.5 : isCompleteEdge ? 2 : 1.3,
        opacity: isActiveEdge || isCompleteEdge ? 1 : 0.42,
      },
    };
  }), [activeRun, activeRunStepIndex, edges, runStepNodeIds]);

  useEffect(() => {
    setValidation(localValidation);
    setRunPlan(localRunPlan);
  }, [localValidation, localRunPlan]);

  useEffect(() => {
    if (!activeRun) return;
    setRunPulse(0);
    const interval = window.setInterval(() => {
      setRunPulse((value) => value + 1);
    }, 1150);
    return () => window.clearInterval(interval);
  }, [activeRun]);

  useEffect(() => {
    if (!reactFlow || renderedNodes.length === 0 || loading || hasFitInitialViewport.current) return;
    hasFitInitialViewport.current = true;
    window.requestAnimationFrame(() => {
      void reactFlow.fitView({
        padding: 0.14,
        minZoom: 0.68,
        maxZoom: 0.96,
        duration: 220,
      });
    });
  }, [loading, reactFlow, renderedNodes.length]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const payload = await fetchJson<CanvasFlowsResponse>("/api/canvas/flows");
        const flow = payload.flows[0] ?? createDefaultFlow();
        const nextValidation = validateFlow(flow);
        if (!cancelled) {
          setBaseFlow(flow);
          setValidation(nextValidation);
          setRunPlan(compileRunPlan(flow));
          setNodes(toReactNodes(flow, nextValidation));
          setEdges(toReactEdges(flow));
        }
      } catch (error) {
        if (!cancelled) {
          setNotice({ tone: "warning", message: `Canvas API unavailable; using local draft. ${apiErrorMessage(error)}` });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [setEdges, setNodes]);

  const onConnect = useCallback<OnConnect>((connection: Connection) => {
    setEdges((currentEdges) => addEdge({ ...connection, type: "smoothstep", id: `e-${connection.source}-${connection.target}-${Date.now()}` }, currentEdges));
  }, [setEdges]);

  const updateSelectedNode = useCallback((nextNode: FmdCanvasNode) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === nextNode.id
        ? { ...node, data: { ...node.data, canvasNode: nextNode } }
        : node
    )));
  }, [setNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== nodeId));
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId, setEdges, setNodes]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/fmd-node-type") as CanvasNodeType;
    if (!type || !reactFlow) return;
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const canvasNode = cloneNodeFromTemplate(type, nodes.length);
    const nextNode: RFNode = {
      id: canvasNode.id,
      type: "fmdNode",
      position,
      data: { canvasNode, issues: 0, warnings: 0 },
    };
    setNodes((currentNodes) => [...currentNodes, nextNode]);
    setSelectedNodeId(canvasNode.id);
    setRightPanelMode("inspect");
  }, [nodes.length, reactFlow, setNodes]);

  const saveFlow = useCallback(async () => {
    setSaving(true);
    setNotice(null);
    try {
      const payload = await fetchJson<{ flow: FmdCanvasFlow; validation: FmdValidationResult }>("/api/canvas/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: currentFlow }),
      });
      setBaseFlow(payload.flow);
      setValidation(payload.validation);
      setNotice({ tone: "success", message: "Canvas draft saved and validated." });
    } catch (error) {
      setNotice({ tone: "error", message: apiErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }, [currentFlow]);

  const dryRun = useCallback(async () => {
    setNotice(null);
    try {
      const payload = await fetchJson<CanvasDryRunResponse>(`/api/canvas/flows/${encodeURIComponent(currentFlow.id)}/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: currentFlow }),
      });
      setValidation(payload.validation);
      setRunPlan(payload.runPlan);
      setRightPanelMode("review");
      setNotice({ tone: payload.validation.ok ? "success" : "warning", message: payload.validation.ok ? "Dry run compiled successfully." : "Dry run compiled with blocking validation issues." });
    } catch (error) {
      setNotice({ tone: "error", message: apiErrorMessage(error) });
    }
  }, [currentFlow]);

  const launch = useCallback(async () => {
    setLaunching(true);
    setNotice(null);
    try {
      const payload = await fetchJson<CanvasRunResponse>(`/api/canvas/flows/${encodeURIComponent(currentFlow.id)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: currentFlow }),
      });
      setValidation(payload.validation);
      setRunPlan(payload.runPlan);
      setRightPanelMode("review");
      const rawRunId = payload.engine.run_id || payload.engine.current_run_id || "";
      const runId = typeof rawRunId === "string" && rawRunId.trim() ? rawRunId.trim() : "";
      if (runId) {
        setActiveRun({ runId });
        setNotice(null);
      } else {
        setNotice({ tone: "success", message: "Pipeline launch accepted. Open Mission Control to confirm the live run." });
      }
    } catch (error) {
      setNotice({ tone: "error", message: apiErrorMessage(error) });
    } finally {
      setLaunching(false);
    }
  }, [currentFlow]);

  const shellClassName = [
    "fmd-canvas-shell",
    isPaletteOpen ? "is-palette-open" : "",
    rightPanelMode ? "is-panel-open" : "",
  ].filter(Boolean).join(" ");

  return (
    <main className="fmd-canvas gs-page-enter">
      <section className="fmd-canvas-hero">
        <div className="fmd-canvas-hero__copy">
          <div className="fmd-canvas-kicker"><Workflow size={14} /> FMD governed canvas</div>
          <h1>Build the pipeline path.</h1>
          <p>
            Start with the graph. Open node tools, inspection, and run review only when you need them.
          </p>
        </div>
      </section>

      {notice && <div className={`fmd-canvas-notice fmd-canvas-notice--${notice.tone}`}>{notice.message}</div>}
      {activeRun && (
        <section className="fmd-canvas-run-handoff gs-modal-enter" aria-live="polite">
          <div className="fmd-canvas-run-handoff__signal">
            <span />
          </div>
          <div>
            <strong>Pipeline is running</strong>
            <p>Run {activeRun.runId.slice(0, 8)} is animating through this canvas. Mission Control is the live operating view for source progress, failures, retries, and completion.</p>
          </div>
          <button type="button" onClick={() => navigate(missionControlUrl)}>
            <SquareArrowOutUpRight size={14} /> View in Mission Control
          </button>
        </section>
      )}

      <section className={shellClassName}>
        {isPaletteOpen && (
        <aside className="fmd-canvas-palette gs-modal-enter">
          <div className="fmd-canvas-sidebar-title">
            <h2>Node Palette</h2>
            <p>Drag in only the building blocks that this flow needs.</p>
          </div>
          <div className="fmd-canvas-palette__group">
            {NODE_TEMPLATES.map((template, index) => <PaletteCard key={template.type} template={template} index={index} />)}
          </div>
          <div className="fmd-canvas-fabric-note">
            <ServerCog size={16} />
            <span>Fabric compute nodes are available as modeled seams. Activating them later will map named pipelines/notebooks into this same run-plan contract.</span>
          </div>
        </aside>
        )}

        <section className="fmd-canvas-workbench">
          <div className="fmd-canvas-toolbar">
            <div>
              <h2>{currentFlow.name}</h2>
              <p>{currentFlow.description}</p>
            </div>
            <div className="fmd-canvas-actions">
              <button type="button" aria-pressed={isPaletteOpen} className={isPaletteOpen ? "is-active" : ""} onClick={() => setPaletteOpen((value) => !value)}>
                <Layers size={14} /> Add nodes
              </button>
              <button
                type="button"
                aria-pressed={rightPanelMode === "inspect"}
                className={rightPanelMode === "inspect" ? "is-active" : ""}
                onClick={() => setRightPanelMode((mode) => mode === "inspect" ? null : "inspect")}
              >
                <Workflow size={14} /> Inspect
              </button>
              <button
                type="button"
                aria-pressed={rightPanelMode === "review"}
                className={rightPanelMode === "review" ? "is-active" : ""}
                onClick={() => setRightPanelMode((mode) => mode === "review" ? null : "review")}
              >
                <ShieldCheck size={14} /> Review
              </button>
              <button type="button" onClick={saveFlow} disabled={saving}>
                {saving ? <Loader2 size={14} className="fmd-spin" /> : <Save size={14} />} Save
              </button>
              <button type="button" onClick={dryRun}>
                <RefreshCw size={14} /> Dry run
              </button>
              <button type="button" className="fmd-canvas-actions__primary" onClick={launch} disabled={launching || !validation.ok}>
                {launching ? <Loader2 size={14} className="fmd-spin" /> : <Play size={14} />} Start Pipeline
              </button>
            </div>
          </div>
          <div
            className="fmd-canvas-flow"
            onDrop={handleDrop}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
          >
            {loading && <div className="fmd-canvas-loading"><Loader2 size={16} className="fmd-spin" /> Loading canvas...</div>}
            <ReactFlow
              nodes={renderedNodes}
              edges={renderedEdges}
              nodeTypes={NODE_TYPES}
              onInit={(instance) => setReactFlow(instance as ReactFlowInstance<RFNode, RFEdge>)}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => {
                setSelectedNodeId(node.id);
                setRightPanelMode("inspect");
              }}
              onPaneClick={() => setSelectedNodeId(null)}
              defaultViewport={{ x: 80, y: 132, zoom: 0.88 }}
              minZoom={0.65}
              maxZoom={1.25}
              snapToGrid
              snapGrid={[24, 24]}
            >
              <Background color="var(--bp-border)" gap={24} size={1} />
              <Controls />
              <MiniMap pannable zoomable nodeStrokeWidth={3} />
            </ReactFlow>
          </div>
        </section>

        {rightPanelMode && (
        <aside className="fmd-canvas-right gs-modal-enter">
          <div className="fmd-canvas-panel-switcher">
            <button type="button" className={rightPanelMode === "inspect" ? "is-active" : ""} onClick={() => setRightPanelMode("inspect")}>Inspect</button>
            <button type="button" className={rightPanelMode === "review" ? "is-active" : ""} onClick={() => setRightPanelMode("review")}>Review plan</button>
          </div>
          {rightPanelMode === "inspect" ? (
            <NodeInspector selected={selectedNode} onUpdate={updateSelectedNode} onDelete={deleteNode} />
          ) : (
            <>
              <ValidationPanel validation={validation} />
              <RunPlanPanel plan={runPlan} />
            </>
          )}
        </aside>
        )}
      </section>
    </main>
  );
}

export default function FmdPipelineCanvas() {
  return (
    <ReactFlowProvider>
      <FmdPipelineCanvasInner />
    </ReactFlowProvider>
  );
}
