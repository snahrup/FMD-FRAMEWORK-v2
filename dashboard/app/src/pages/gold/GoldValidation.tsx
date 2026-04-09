import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  CheckCheck,
  Database,
  Download,
  Flag,
  Search,
  Sparkles,
} from "lucide-react";
import {
  GoldCompletionReceipt,
  GoldEmpty,
  GoldFailureReceipt,
  GoldLoading,
  GoldNextActionPanel,
  GoldNoResults,
  GoldStudioLayout,
  SlideOver,
  useDomainContext,
  useGoldToast,
} from "@/components/gold";

const API = "/api/gold-studio";

type ReleaseTab = "coverage" | "model" | "appendix";

interface RuleResult {
  rule?: string;
  check?: string;
  type?: "critical" | "warning" | "advisory";
  expected?: string;
  actual?: string;
  status: "passed" | "failed" | "waiver";
  message?: string;
}

interface ValidationResultsPayload {
  checks_run?: number;
  checks_passed?: number;
  checks_failed?: number;
  details?: RuleResult[];
}

interface ReconciliationRow {
  metric: string;
  legacy_value: string | number;
  gold_value: string | number;
  delta: string;
  status: "within_tolerance" | "review" | "out_of_range";
}

interface Waiver {
  reason: string;
  approver: string;
  filed_at: string;
  checks_waived?: string[];
}

interface ValidationRunRow {
  id: number;
  spec_root_id: number;
  spec_version: number;
  started_at: string | null;
  completed_at: string | null;
  status: "queued" | "running" | "passed" | "failed" | "warning";
  results: string | ValidationResultsPayload | RuleResult[] | null;
  reconciliation: string | ReconciliationRow[] | null;
  waiver: string | Waiver | null;
  superseded: boolean;
}

interface SpecRow {
  id: number;
  root_id: number;
  name?: string;
  target_name: string;
  domain: string;
  status: "draft" | "validated" | "needs_revalidation" | "deprecated";
  version: number;
}

interface ReportCoverage {
  id: number;
  domain: string;
  report_name: string;
  report_description?: string;
  report_type?: "power_bi" | "ssrs" | "excel" | "other";
  coverage_status: "not_analyzed" | "analyzed" | "partially_covered" | "fully_covered" | "recreated" | "reconciled";
  contributing_specimen_ids?: string;
  contributing_canonical_ids?: string;
  contributing_spec_ids?: string;
  unresolved_metrics?: string;
  notes?: string;
  assessed_by?: string;
  assessed_at?: string;
  created_at?: string;
  updated_at?: string;
}

interface CoverageMapSummary {
  domain: string | null;
  imported_artifacts: number;
  registered_reports: number;
  field_rows_total: number;
  field_rows_accounted_for: number;
  field_rows_needing_review: number;
  current_specs: number;
  validated_specs: number;
  published_products: number;
  canonical_entities: number;
  updated_at: string;
}

interface CoverageArtifact {
  artifact_id: number;
  artifact_name: string;
  artifact_type: string;
  source_class?: string | null;
  division?: string | null;
  source_system?: string | null;
  job_state?: string | null;
  usage_row_count: number;
  mapped_row_count: number;
  published_row_count: number;
  needs_review_count: number;
  page_count: number;
  visual_count: number;
  proposed_coverage_pct: number;
  canonical_count: number;
  spec_count: number;
  coverage_status: string;
  coverage_note: string;
  sample_gaps: string[];
  catalog_products: string[];
}

interface CoverageReport extends ReportCoverage {
  artifact_names: string[];
  canonical_names: string[];
  spec_names: string[];
  artifact_count: number;
  canonical_count: number;
  spec_count: number;
  unresolved_metric_count: number;
  coverage_note: string;
}

interface CoverageBlocker {
  kind: "spec" | "artifact" | "report";
  name: string;
  status: string;
  reason: string;
}

interface CoverageMapResponse {
  summary: CoverageMapSummary;
  artifacts: CoverageArtifact[];
  reports: CoverageReport[];
  blockers: CoverageBlocker[];
}

interface ProposedModelSummary {
  domain: string | null;
  entity_count: number;
  published_entities: number;
  validated_entities: number;
  entities_needing_specs: number;
  relationship_count: number;
  updated_at: string;
}

interface ProposedModelNode {
  id: number;
  root_id: number;
  name: string;
  business_description?: string | null;
  domain: string;
  entity_type: string;
  grain?: string | null;
  steward?: string | null;
  status?: string | null;
  source_entity_count: number;
  source_artifact_count: number;
  semantic_count: number;
  spec_id?: number | null;
  spec_name?: string | null;
  spec_status?: string | null;
  published_product_count: number;
  columns_preview: Array<{ column_name: string; key_designation?: string | null; fk_target_root_id?: number | null }>;
  column_count: number;
  measures_preview: Array<{ name: string; definition_type?: string | null }>;
  field_reference_count: number;
  artifact_evidence_count: number;
  artifact_names: string[];
  report_count: number;
  relationship_count: number;
  model_state: "published" | "validated" | "designed" | "needs_spec";
  model_note: string;
}

interface ProposedModelRelationship {
  id: number;
  from_root_id: number;
  from_entity: string;
  column_name: string;
  to_root_id: number;
  to_entity: string;
  fk_target_column?: string | null;
}

interface ProposedModelResponse {
  summary: ProposedModelSummary;
  nodes: ProposedModelNode[];
  relationships: ProposedModelRelationship[];
}

interface CoverageAppendixItem {
  kind: string;
  artifact_id: number;
  artifact_name: string;
  artifact_type: string;
  source_class?: string | null;
  domain?: string | null;
  page_name?: string | null;
  visual_type?: string | null;
  visual_id?: string | null;
  source_entity_name?: string | null;
  source_field_name?: string | null;
  field_kind?: string | null;
  usage_type?: string | null;
  canonical_name?: string | null;
  semantic_name?: string | null;
  spec_name?: string | null;
  catalog_name?: string | null;
  mapping_status: string;
  mapping_note: string;
}

interface CoverageAppendixResponse {
  domain: string | null;
  items: CoverageAppendixItem[];
  total: number;
  status_counts: Record<string, number>;
  updated_at: string;
}

interface PublishFormState {
  spec_id: number;
  display_name: string;
  business_description: string;
  grain: string;
  domain: string;
  owner: string;
  steward: string;
  sensitivity_label: string;
  endorsement: string;
  tags: string;
}

interface ModelFlowData {
  node: ProposedModelNode;
  tone: { color: string; bg: string; border: string; label: string };
}

const RELEASE_TABS: Array<{ id: ReleaseTab; label: string; detail: string }> = [
  { id: "coverage", label: "Coverage Map", detail: "Show what the imported evidence and downstream reports demand from the final model." },
  { id: "model", label: "Proposed Semantic Model", detail: "Review the tables, relationships, and release-readiness of the proposed gold domain model." },
  { id: "appendix", label: "Coverage Appendix", detail: "Trace every imported field, query, or report reference to the final gold model accounting." },
];

const REPORT_TYPE_LABELS: Record<string, string> = {
  power_bi: "Power BI",
  ssrs: "SSRS",
  excel: "Excel",
  other: "Other",
};

const COVERAGE_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  fully_accounted_for: { label: "Fully Accounted", color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)" },
  partially_accounted_for: { label: "Partial Coverage", color: "var(--bp-caution-amber)", bg: "var(--bp-caution-light)" },
  missing_model_coverage: { label: "Missing Coverage", color: "var(--bp-fault-red)", bg: "var(--bp-fault-light)" },
  context_only: { label: "Context Only", color: "var(--bp-info, #2563eb)", bg: "var(--bp-info-light, rgba(59,130,246,0.12))" },
  no_field_evidence: { label: "No Field Evidence", color: "var(--bp-ink-muted)", bg: "var(--bp-dismissed-light)" },
  not_analyzed: { label: "Not Analyzed", color: "var(--bp-ink-muted)", bg: "var(--bp-dismissed-light)" },
  analyzed: { label: "Analyzed", color: "var(--bp-copper)", bg: "var(--bp-copper-soft)" },
  partially_covered: { label: "Partially Covered", color: "var(--bp-caution-amber)", bg: "var(--bp-caution-light)" },
  fully_covered: { label: "Fully Covered", color: "var(--bp-info, #2563eb)", bg: "var(--bp-info-light, rgba(59,130,246,0.12))" },
  recreated: { label: "Recreated", color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)" },
  reconciled: { label: "Reconciled", color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)" },
};

const MODEL_STATE_CFG: Record<ProposedModelNode["model_state"], { label: string; color: string; bg: string; border: string }> = {
  published: { label: "Published", color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)", border: "rgba(61,124,79,0.25)" },
  validated: { label: "Validated", color: "var(--bp-info, #2563eb)", bg: "var(--bp-info-light, rgba(59,130,246,0.12))", border: "rgba(59,130,246,0.22)" },
  designed: { label: "Designed", color: "var(--bp-copper)", bg: "var(--bp-copper-soft)", border: "rgba(180,86,36,0.22)" },
  needs_spec: { label: "Needs Spec", color: "var(--bp-fault-red)", bg: "var(--bp-fault-light)", border: "rgba(185,58,42,0.22)" },
};

const MAPPING_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  published: { label: "Published Product", color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)" },
  accounted_for: { label: "Accounted For", color: "var(--bp-info, #2563eb)", bg: "var(--bp-info-light, rgba(59,130,246,0.12))" },
  needs_spec: { label: "Needs Spec", color: "var(--bp-caution-amber)", bg: "var(--bp-caution-light)" },
  needs_semantic_definition: { label: "Needs Semantic Def.", color: "var(--bp-copper)", bg: "var(--bp-copper-soft)" },
  needs_canonical_mapping: { label: "Needs Canonical Map", color: "var(--bp-fault-red)", bg: "var(--bp-fault-light)" },
  unmapped: { label: "Unmapped", color: "var(--bp-fault-red)", bg: "var(--bp-fault-light)" },
  context_only: { label: "Context Only", color: "var(--bp-info, #2563eb)", bg: "var(--bp-info-light, rgba(59,130,246,0.12))" },
  no_field_evidence: { label: "No Field Evidence", color: "var(--bp-ink-muted)", bg: "var(--bp-dismissed-light)" },
  coverage_unmapped: { label: "Report Not Linked", color: "var(--bp-fault-red)", bg: "var(--bp-fault-light)" },
};

const body = (fontSize: number, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: "var(--bp-font-body)",
  fontSize,
  ...extra,
});

const display = (fontSize: number, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: "var(--bp-font-display)",
  fontSize,
  ...extra,
});

const mono = (fontSize = 11, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: "var(--bp-font-mono)",
  fontSize,
  ...extra,
});

function parseJsonField<T>(val: string | T | null | undefined): T | null {
  if (val == null) return null;
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }
  return val as T;
}

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function getCoverageTone(status: string) {
  return COVERAGE_STATUS_CFG[status] ?? COVERAGE_STATUS_CFG.not_analyzed;
}

function getMappingTone(status: string) {
  return MAPPING_STATUS_CFG[status] ?? MAPPING_STATUS_CFG.unmapped;
}

function releaseNodeTone(node: ProposedModelNode) {
  return MODEL_STATE_CFG[node.model_state] ?? MODEL_STATE_CFG.designed;
}

function StatusChip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5" style={{ ...body(11, { color, background: bg, fontWeight: 600 }) }}>
      {label}
    </span>
  );
}

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="gs-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.34)" }} onClick={onClose}>
      <div className="gs-modal-enter w-full max-w-2xl rounded-xl p-5" style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border-strong, var(--bp-border))" }} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span style={{ ...body(11, { color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }) }}>
        {label}{required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}

function SectionCard({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="gs-stagger-card rounded-xl p-4" style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }) }}>{eyebrow}</div>
          <h2 style={{ ...display(18, { color: "var(--bp-ink-primary)", margin: 0 }) }}>{title}</h2>
          {description ? <p style={{ ...body(13, { color: "var(--bp-ink-secondary)", marginTop: 6, lineHeight: 1.55 }) }}>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ProgressRail({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--bp-surface-inset)" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", background: color, transition: "width 600ms var(--ease-claude, ease)" }} />
    </div>
  );
}

function ModelNodeCard({ data }: NodeProps<Node<ModelFlowData>>) {
  const tone = data.tone;
  const previewColumns = data.node.columns_preview.slice(0, 4);
  const previewMeasures = data.node.measures_preview.slice(0, 3);
  return (
    <div className="rounded-xl p-3" style={{ width: 280, background: "var(--bp-surface-1)", border: `1px solid ${tone.border}` }}>
      <Handle type="target" position={Position.Left} style={{ background: tone.color, border: "none", width: 8, height: 8 }} />
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div style={{ ...display(15, { color: "var(--bp-ink-primary)", lineHeight: 1.15 }) }}>{data.node.name}</div>
          <div style={{ ...body(11, { color: "var(--bp-ink-muted)", marginTop: 4 }) }}>{data.node.entity_type.charAt(0).toUpperCase() + data.node.entity_type.slice(1)} • {data.node.domain}</div>
        </div>
        <StatusChip label={tone.label} color={tone.color} bg={tone.bg} />
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div className="rounded-md px-2 py-1.5" style={{ background: "var(--bp-surface-inset)" }}>
          <div style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }) }}>Columns</div>
          <div style={{ ...display(16, { color: "var(--bp-ink-primary)" }) }}>{data.node.column_count}</div>
        </div>
        <div className="rounded-md px-2 py-1.5" style={{ background: "var(--bp-surface-inset)" }}>
          <div style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }) }}>Measures</div>
          <div style={{ ...display(16, { color: "var(--bp-ink-primary)" }) }}>{data.node.semantic_count}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {previewColumns.length > 0 && (
          <div>
            <div style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }) }}>Columns</div>
            {previewColumns.map((column) => (
              <div key={column.column_name} style={{ ...body(11, { color: "var(--bp-ink-secondary)" }) }}>
                {column.key_designation ? `${column.key_designation} · ` : ""}{column.column_name}
              </div>
            ))}
          </div>
        )}
        {previewMeasures.length > 0 && (
          <div>
            <div style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }) }}>Measures</div>
            {previewMeasures.map((measure) => (
              <div key={measure.name} style={{ ...body(11, { color: "var(--bp-ink-secondary)" }) }}>
                {measure.name}
              </div>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: tone.color, border: "none", width: 8, height: 8 }} />
    </div>
  );
}

const MODEL_NODE_TYPES = { semantic: ModelNodeCard };

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function readValidationDetails(run: ValidationRunRow | null) {
  const parsed = parseJsonField<ValidationResultsPayload | RuleResult[]>(run?.results);
  if (Array.isArray(parsed)) {
    return {
      checksRun: parsed.length,
      checksFailed: parsed.filter((row) => row.status === "failed").length,
      details: parsed,
    };
  }
  return {
    checksRun: parsed?.checks_run ?? parsed?.details?.length ?? 0,
    checksFailed: parsed?.checks_failed ?? parsed?.details?.filter((row) => row.status === "failed").length ?? 0,
    details: parsed?.details ?? [],
  };
}

export default function GoldValidation() {
  const { domain: activeDomain } = useDomainContext();
  const { showToast } = useGoldToast();

  const [activeTab, setActiveTab] = useState<ReleaseTab>("coverage");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [specs, setSpecs] = useState<SpecRow[]>([]);
  const [coverageMap, setCoverageMap] = useState<CoverageMapResponse | null>(null);
  const [proposedModel, setProposedModel] = useState<ProposedModelResponse | null>(null);
  const [appendix, setAppendix] = useState<CoverageAppendixResponse | null>(null);

  const [artifactFilter, setArtifactFilter] = useState("all");
  const [reportFilter, setReportFilter] = useState("all");
  const [appendixFilter, setAppendixFilter] = useState("all");
  const [appendixSearch, setAppendixSearch] = useState("");

  const deferredAppendixSearch = useDeferredValue(appendixSearch);

  const [selectedArtifact, setSelectedArtifact] = useState<CoverageArtifact | null>(null);
  const [selectedNode, setSelectedNode] = useState<ProposedModelNode | null>(null);
  const [selectedAppendix, setSelectedAppendix] = useState<CoverageAppendixItem | null>(null);
  const [selectedReport, setSelectedReport] = useState<CoverageReport | ReportCoverage | null>(null);
  const [selectedSpec, setSelectedSpec] = useState<SpecRow | null>(null);
  const [latestRun, setLatestRun] = useState<ValidationRunRow | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationRow[]>([]);
  const [showWaiver, setShowWaiver] = useState(false);
  const [waiverForm, setWaiverForm] = useState({ reason: "", approver: "" });

  const [showPublish, setShowPublish] = useState(false);
  const [publishForm, setPublishForm] = useState<PublishFormState>({
    spec_id: 0,
    display_name: "",
    business_description: "",
    grain: "",
    domain: activeDomain ?? "",
    owner: "",
    steward: "",
    sensitivity_label: "internal",
    endorsement: "none",
    tags: "",
  });

  const [showAddReport, setShowAddReport] = useState(false);
  const [newReport, setNewReport] = useState({
    domain: activeDomain ?? "",
    report_name: "",
    report_description: "",
    report_type: "power_bi",
  });

  const withDomain = useCallback((path: string, extras: Record<string, string | number | undefined> = {}) => {
    const params = new URLSearchParams();
    if (activeDomain) params.set("domain", activeDomain);
    Object.entries(extras).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).length > 0) params.set(key, String(value));
    });
    const query = params.toString();
    return `${API}${path}${query ? `?${query}` : ""}`;
  }, [activeDomain]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [specList, coverage, model, appendixPayload] = await Promise.all([
        fetchJson<{ items: SpecRow[] }>(withDomain("/specs", { limit: 500 })),
        fetchJson<CoverageMapResponse>(withDomain("/release/coverage-map")),
        fetchJson<ProposedModelResponse>(withDomain("/release/proposed-model")),
        fetchJson<CoverageAppendixResponse>(withDomain("/release/coverage-appendix")),
      ]);
      setSpecs(specList.items ?? []);
      setCoverageMap(coverage);
      setProposedModel(model);
      setAppendix(appendixPayload);
      if (!publishForm.domain && activeDomain) {
        setPublishForm((current) => ({ ...current, domain: activeDomain }));
      }
      if (!newReport.domain && activeDomain) {
        setNewReport((current) => ({ ...current, domain: activeDomain }));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load release gate data");
    } finally {
      setLoading(false);
    }
  }, [activeDomain, newReport.domain, publishForm.domain, withDomain]);

  useEffect(() => {
    load();
  }, [load]);

  const publishedSpecIds = useMemo(() => new Set(
    (proposedModel?.nodes ?? [])
      .filter((node) => node.published_product_count > 0 && node.spec_id)
      .map((node) => node.spec_id as number)
  ), [proposedModel]);

  const releaseReadySpecs = useMemo(() => specs.filter((spec) => spec.status === "validated"), [specs]);
  const unpublishedSpecs = useMemo(() => releaseReadySpecs.filter((spec) => !publishedSpecIds.has(spec.id)), [publishedSpecIds, releaseReadySpecs]);

  const filteredArtifacts = useMemo(() => {
    const items = coverageMap?.artifacts ?? [];
    return artifactFilter === "all" ? items : items.filter((item) => item.coverage_status === artifactFilter);
  }, [artifactFilter, coverageMap]);

  const filteredReports = useMemo(() => {
    const items = coverageMap?.reports ?? [];
    return reportFilter === "all" ? items : items.filter((item) => item.coverage_status === reportFilter);
  }, [coverageMap, reportFilter]);

  const filteredAppendix = useMemo(() => {
    const term = deferredAppendixSearch.trim().toLowerCase();
    return (appendix?.items ?? []).filter((item) => {
      if (appendixFilter !== "all" && item.mapping_status !== appendixFilter) return false;
      if (!term) return true;
      return [
        item.artifact_name,
        item.source_entity_name,
        item.source_field_name,
        item.canonical_name,
        item.semantic_name,
        item.spec_name,
        item.catalog_name,
        item.mapping_note,
      ].some((value) => String(value ?? "").toLowerCase().includes(term));
    });
  }, [appendix, appendixFilter, deferredAppendixSearch]);

  const summary = coverageMap?.summary;
  const accountedPct = summary ? Math.round((summary.field_rows_accounted_for / Math.max(summary.field_rows_total, 1)) * 100) : 0;
  const blockersCount = coverageMap?.blockers.length ?? 0;

  const flowNodes = useMemo<Array<Node<ModelFlowData, "semantic">>>(() => {
    const groupOrder = ["dimension", "fact", "bridge", "aggregate", "reference", "other"];
    const grouped = new Map<string, ProposedModelNode[]>();
    (proposedModel?.nodes ?? []).forEach((node) => {
      const normalizedType = node.entity_type.toLowerCase();
      const key = groupOrder.includes(normalizedType) ? normalizedType : "other";
      const bucket = grouped.get(key) ?? [];
      bucket.push(node);
      grouped.set(key, bucket);
    });
    return groupOrder.flatMap((group, columnIndex) => (grouped.get(group) ?? []).map((node, rowIndex) => ({
      id: String(node.root_id),
      type: "semantic",
      position: { x: columnIndex * 340, y: rowIndex * 260 },
      data: { node, tone: releaseNodeTone(node) },
      draggable: false,
      selectable: true,
    })));
  }, [proposedModel]);

  const flowEdges = useMemo<Array<Edge>>(() => (proposedModel?.relationships ?? []).map((relationship) => ({
    id: `${relationship.from_root_id}-${relationship.to_root_id}-${relationship.column_name}`,
    source: String(relationship.from_root_id),
    target: String(relationship.to_root_id),
    label: `${relationship.column_name} → ${relationship.fk_target_column ?? "target"}`,
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
      color: "rgba(180,86,36,0.55)",
    },
    style: {
      stroke: "rgba(180,86,36,0.35)",
      strokeWidth: 1.5,
    },
    labelStyle: {
      fontFamily: "var(--bp-font-mono)",
      fontSize: 10,
      fill: "var(--bp-ink-tertiary)",
    },
  })), [proposedModel]);

  const seedPublishForm = useCallback((spec: SpecRow) => {
    const linkedNode = (proposedModel?.nodes ?? []).find((node) => node.spec_id === spec.id);
    setPublishForm({
      spec_id: spec.id,
      display_name: spec.name ?? spec.target_name,
      business_description: linkedNode?.business_description ?? "",
      grain: linkedNode?.grain ?? "",
      domain: spec.domain ?? activeDomain ?? "",
      owner: linkedNode?.steward ?? "",
      steward: linkedNode?.steward ?? "",
      sensitivity_label: "internal",
      endorsement: "none",
      tags: "",
    });
    setShowPublish(true);
  }, [activeDomain, proposedModel]);

  const openSpec = useCallback(async (spec: SpecRow) => {
    setSelectedSpec(spec);
    setLatestRun(null);
    setReconciliation([]);
    try {
      const runs = await fetchJson<{ items: ValidationRunRow[] }>(`${API}/validation/specs/${spec.id}/runs?limit=1`);
      const current = runs.items?.[0] ?? null;
      setLatestRun(current);
      const parsedReconciliation = parseJsonField<ReconciliationRow[]>(current?.reconciliation);
      setReconciliation(parsedReconciliation ?? []);
    } catch {
      setLatestRun(null);
      setReconciliation([]);
    }
  }, []);

  const openReport = useCallback(async (report: CoverageReport | ReportCoverage) => {
    try {
      const detail = await fetchJson<ReportCoverage>(`${API}/report-coverage/${report.id}`);
      setSelectedReport({ ...report, ...detail });
    } catch {
      setSelectedReport(report);
    }
  }, []);

  const runValidation = useCallback(async (id: number) => {
    try {
      const response = await fetch(`${API}/validation/specs/${id}/validate`, { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showToast("Validation queued", "success");
      load();
      const current = specs.find((row) => row.id === id);
      if (current) openSpec(current);
    } catch {
      showToast("Failed to queue validation", "error");
    }
  }, [load, openSpec, showToast, specs]);

  const submitWaiver = useCallback(async () => {
    if (!latestRun) return;
    try {
      const response = await fetch(`${API}/validation/runs/${latestRun.id}/waiver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(waiverForm),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showToast("Waiver filed", "success");
      setShowWaiver(false);
      setWaiverForm({ reason: "", approver: "" });
      if (selectedSpec) openSpec(selectedSpec);
    } catch {
      showToast("Failed to file waiver", "error");
    }
  }, [latestRun, openSpec, selectedSpec, showToast, waiverForm]);

  const submitPublish = useCallback(async () => {
    if (!publishForm.spec_id) return;
    try {
      const response = await fetch(`${API}/catalog/specs/${publishForm.spec_id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...publishForm,
          tags: publishForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showToast("Published to catalog", "success");
      setShowPublish(false);
      load();
    } catch {
      showToast("Failed to publish this product", "error");
    }
  }, [load, publishForm, showToast]);

  const addReport = useCallback(async () => {
    try {
      const response = await fetch(`${API}/report-coverage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newReport),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showToast("Report registered", "success");
      setShowAddReport(false);
      setNewReport({ domain: activeDomain ?? "", report_name: "", report_description: "", report_type: "power_bi" });
      load();
    } catch {
      showToast("Failed to register report", "error");
    }
  }, [activeDomain, load, newReport, showToast]);

  const updateCoverageStatus = useCallback(async (id: number, status: string) => {
    try {
      const response = await fetch(`${API}/report-coverage/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverage_status: status }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showToast("Coverage status updated", "success");
      setSelectedReport(null);
      load();
    } catch {
      showToast("Failed to update coverage status", "error");
    }
  }, [load, showToast]);

  const openBlocker = useCallback((blocker: CoverageBlocker) => {
    if (blocker.kind === "artifact") {
      const match = coverageMap?.artifacts.find((artifact) => artifact.artifact_name === blocker.name);
      if (match) setSelectedArtifact(match);
      return;
    }
    if (blocker.kind === "report") {
      const match = coverageMap?.reports.find((report) => report.report_name === blocker.name);
      if (match) openReport(match);
      return;
    }
    const match = specs.find((spec) => (spec.name ?? spec.target_name) === blocker.name || spec.target_name === blocker.name);
    if (match) openSpec(match);
  }, [coverageMap, openReport, openSpec, specs]);

  const exportAppendix = useCallback(() => {
    const headers = ["Artifact", "Artifact Type", "Source Entity", "Source Field", "Canonical", "Semantic", "Spec", "Catalog", "Status", "Note"];
    const rows = filteredAppendix.map((item) => [
      item.artifact_name,
      item.artifact_type,
      item.source_entity_name ?? "",
      item.source_field_name ?? "",
      item.canonical_name ?? "",
      item.semantic_name ?? "",
      item.spec_name ?? "",
      item.catalog_name ?? "",
      item.mapping_status,
      item.mapping_note,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeDomain ?? "gold-domain"}-coverage-appendix.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [activeDomain, filteredAppendix]);

  const validationSummary = readValidationDetails(latestRun);

  return (
    <GoldStudioLayout
      activeTab="validation"
      actions={
        <>
          <button type="button" onClick={() => setShowAddReport(true)} className="rounded-md px-3 py-2 text-sm font-medium" style={{ background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)", border: "1px solid var(--bp-border)" }}>
            Register Report
          </button>
          <button type="button" disabled={unpublishedSpecs.length === 0} onClick={() => unpublishedSpecs[0] && seedPublishForm(unpublishedSpecs[0])} className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)" }}>
            Publish Ready Product
          </button>
        </>
      }
    >
      <div style={{ borderBottom: "1px solid var(--bp-border)", padding: "12px 0 14px" }}>
        <div className="flex flex-wrap items-end gap-8">
          {[
            { label: "Model Coverage", value: `${accountedPct}%`, color: accountedPct >= 80 ? "var(--bp-operational-green)" : accountedPct >= 50 ? "var(--bp-caution-amber)" : "var(--bp-fault-red)" },
            { label: "Release Blockers", value: blockersCount, color: blockersCount === 0 ? "var(--bp-operational-green)" : "var(--bp-fault-red)" },
            { label: "Published Products", value: summary?.published_products ?? 0, color: "var(--bp-copper)" },
          ].map((metric, index) => (
            <div key={metric.label} className="gs-hero-enter" style={{ "--i": index } as CSSProperties}>
              <div style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }) }}>{metric.label}</div>
              <div style={{ ...display(36, { color: metric.color, lineHeight: 1, letterSpacing: "-0.03em" }) }}>{metric.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-5">
          {[
            { label: "Imported Artifacts", value: summary?.imported_artifacts ?? 0 },
            { label: "Registered Reports", value: summary?.registered_reports ?? 0 },
            { label: "Validated Specs", value: `${summary?.validated_specs ?? 0}/${summary?.current_specs ?? 0}` },
            { label: "Canonical Objects", value: summary?.canonical_entities ?? 0 },
            { label: "Updated", value: formatDate(summary?.updated_at) },
          ].map((metric, index) => (
            <div key={metric.label} className="gs-stagger-row flex items-center gap-1.5" style={{ "--i": index } as CSSProperties}>
              <span style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }) }}>{metric.label}</span>
              <span style={{ ...display(18, { color: "var(--bp-ink-primary)" }) }}>{metric.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="my-4">
        {error ? (
          <GoldFailureReceipt
            title="Release gate data did not load cleanly"
            summary={error}
            preservedState="Imported evidence, specs, and report registrations remain intact. This failure only affects what the page can currently show."
            retryScope="Retrying reloads the release review workspace only. It does not rerun validation or republish anything."
            action={{ label: "Reload Release Gate", onClick: load }}
          />
        ) : blockersCount > 0 ? (
          <GoldNextActionPanel
            title={`Resolve ${blockersCount} release blocker${blockersCount === 1 ? "" : "s"} before publishing this domain model`}
            description="This release gate now exists to prove that the imported evidence and downstream reports are fully represented by the final semantic model. Anything still red here is an explicit migration risk."
            whyItMatters="If you publish before every required field, measure, relationship, and report dependency is accounted for, downstream migrations will be incomplete or misleading."
            whatHappensNext="Clear missing mappings, finish spec validation, and reconcile report gaps. Then publish the validated products that complete the proposed model."
            tone="warning"
            action={{ label: "Review Blockers", onClick: () => startTransition(() => setActiveTab("coverage")) }}
          />
        ) : (
          <GoldCompletionReceipt
            title="The release gate is clear"
            summary="The imported evidence, downstream reports, and proposed model are currently aligned well enough to move forward with publishing."
            whatChanged="All known blockers have been cleared or intentionally accounted for."
            nextStep={unpublishedSpecs.length > 0 ? "Publish the validated products that complete the domain model." : "Hand the published domain model to Serve for live stewardship and governance."}
          />
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5" style={{ borderBottom: "1px solid var(--bp-border)", paddingBottom: 8 }}>
        {RELEASE_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => startTransition(() => setActiveTab(tab.id))}
              className="relative rounded-md px-3 py-2 text-left transition-colors"
              style={{ color: isActive ? "var(--bp-copper)" : "var(--bp-ink-muted)" }}
            >
              <div style={{ ...body(14, { fontWeight: isActive ? 700 : 500, color: isActive ? "var(--bp-ink-primary)" : "var(--bp-ink-secondary)" }) }}>{tab.label}</div>
              <div style={{ ...body(11, { color: "var(--bp-ink-tertiary)", marginTop: 2, maxWidth: 280, lineHeight: 1.35 }) }}>{tab.detail}</div>
              {isActive ? <span style={{ position: "absolute", left: 12, right: 12, bottom: -9, height: 2.5, borderRadius: "2px 2px 0 0", background: "var(--bp-copper)" }} /> : null}
            </button>
          );
        })}
      </div>

      {loading && !coverageMap ? <GoldLoading label="Assembling release review" rows={6} /> : null}

      {!loading && coverageMap && proposedModel && appendix ? (
        <>
          {activeTab === "coverage" && (
            <CoverageMapView
              coverageMap={coverageMap}
              filteredArtifacts={filteredArtifacts}
              filteredReports={filteredReports}
              artifactFilter={artifactFilter}
              onArtifactFilterChange={setArtifactFilter}
              reportFilter={reportFilter}
              onReportFilterChange={setReportFilter}
              unpublishedSpecs={unpublishedSpecs}
              onOpenArtifact={setSelectedArtifact}
              onOpenBlocker={openBlocker}
              onOpenReport={openReport}
              onOpenSpec={openSpec}
              onPublishSpec={seedPublishForm}
            />
          )}
          {activeTab === "model" && (
            <ProposedModelView
              model={proposedModel}
              flowNodes={flowNodes}
              flowEdges={flowEdges}
              onOpenNode={setSelectedNode}
            />
          )}
          {activeTab === "appendix" && (
            <CoverageAppendixView
              appendix={appendix}
              filteredItems={filteredAppendix}
              appendixFilter={appendixFilter}
              onAppendixFilterChange={setAppendixFilter}
              appendixSearch={appendixSearch}
              onAppendixSearchChange={setAppendixSearch}
              onExport={exportAppendix}
              onOpenItem={setSelectedAppendix}
            />
          )}
        </>
      ) : null}

      {!loading && !coverageMap && !error ? (
        <GoldEmpty
          noun="release review evidence"
          title="No release evidence is available yet"
          message="Import source material, register downstream reports, and build canonical/spec coverage before the release gate can explain what the final semantic model must contain."
        />
      ) : null}

      <SlideOver
        open={!!selectedArtifact}
        onClose={() => setSelectedArtifact(null)}
        title={selectedArtifact?.artifact_name ?? ""}
        subtitle={selectedArtifact ? `${selectedArtifact.artifact_type.toUpperCase()} / ${selectedArtifact.source_system ?? selectedArtifact.division ?? "Imported evidence"}` : ""}
      >
        {selectedArtifact ? <ArtifactDetail artifact={selectedArtifact} /> : null}
      </SlideOver>

      <SlideOver
        open={!!selectedNode}
        onClose={() => setSelectedNode(null)}
        title={selectedNode?.name ?? ""}
        subtitle={selectedNode ? `${selectedNode.entity_type} / ${selectedNode.domain}` : ""}
      >
        {selectedNode ? <SemanticModelDetail node={selectedNode} /> : null}
      </SlideOver>

      <SlideOver
        open={!!selectedAppendix}
        onClose={() => setSelectedAppendix(null)}
        title={selectedAppendix?.artifact_name ?? ""}
        subtitle={selectedAppendix?.source_field_name ?? selectedAppendix?.source_entity_name ?? selectedAppendix?.field_kind ?? ""}
      >
        {selectedAppendix ? <AppendixDetail item={selectedAppendix} /> : null}
      </SlideOver>

      <SlideOver
        open={!!selectedReport}
        onClose={() => setSelectedReport(null)}
        title={selectedReport?.report_name ?? ""}
        subtitle={selectedReport ? `${selectedReport.domain} / ${REPORT_TYPE_LABELS[selectedReport.report_type ?? "other"]}` : ""}
        footer={
          selectedReport ? (
            <div className="flex items-center gap-3">
              <label style={{ ...body(13, { color: "var(--bp-ink-secondary)" }) }}>Coverage Status</label>
              <select
                value={selectedReport.coverage_status}
                onChange={(event) => updateCoverageStatus(selectedReport.id, event.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm"
                style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }}
              >
                {Object.entries(COVERAGE_STATUS_CFG)
                  .filter(([key]) => ["not_analyzed", "analyzed", "partially_covered", "fully_covered", "recreated", "reconciled"].includes(key))
                  .map(([key, tone]) => <option key={key} value={key}>{tone.label}</option>)}
              </select>
            </div>
          ) : undefined
        }
      >
        {selectedReport ? <ReportCoverageDetail report={selectedReport} /> : null}
      </SlideOver>

      <SlideOver
        open={!!selectedSpec}
        onClose={() => setSelectedSpec(null)}
        title={selectedSpec?.name ?? selectedSpec?.target_name ?? ""}
        subtitle={selectedSpec ? `${selectedSpec.domain} / v${selectedSpec.version}` : ""}
        footer={
          selectedSpec ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => runValidation(selectedSpec.id)} className="rounded-md px-4 py-2 text-sm font-medium" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)" }}>
                Run Validation
              </button>
              {latestRun && validationSummary.checksFailed > 0 ? (
                <button type="button" onClick={() => setShowWaiver(true)} className="rounded-md px-4 py-2 text-sm font-medium" style={{ background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)", border: "1px solid var(--bp-border)" }}>
                  File Waiver
                </button>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {selectedSpec ? <ValidationRunDetail spec={selectedSpec} run={latestRun} reconciliation={reconciliation} /> : null}
      </SlideOver>

      <Modal open={showWaiver} onClose={() => setShowWaiver(false)}>
        <h3 style={{ ...display(18, { color: "var(--bp-ink-primary)", margin: 0 }) }}>File Waiver</h3>
        <p style={{ ...body(12, { color: "var(--bp-caution-amber)", marginTop: 8, lineHeight: 1.5 }) }}>
          Waivers are attached to the current validation run only. If the spec changes and a new run is created, the waiver should be reconsidered.
        </p>
        <div className="mt-4 space-y-3">
          <FormField label="Reason" required>
            <textarea value={waiverForm.reason} onChange={(event) => setWaiverForm((current) => ({ ...current, reason: event.target.value }))} rows={4} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
          <FormField label="Approver" required>
            <input value={waiverForm.approver} onChange={(event) => setWaiverForm((current) => ({ ...current, approver: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setShowWaiver(false)} className="rounded-md px-4 py-2 text-sm" style={{ ...body(13, { color: "var(--bp-ink-secondary)" }) }}>Cancel</button>
          <button type="button" disabled={!waiverForm.reason || !waiverForm.approver} onClick={submitWaiver} className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--bp-caution-amber)", color: "var(--bp-surface-1)" }}>
            Submit Waiver
          </button>
        </div>
      </Modal>

      <Modal open={showPublish} onClose={() => setShowPublish(false)}>
        <h3 style={{ ...display(18, { color: "var(--bp-ink-primary)", margin: 0 }) }}>Publish to Catalog</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <FormField label="Validated Spec" required>
            <select
              value={publishForm.spec_id || ""}
              onChange={(event) => {
                const selected = specs.find((spec) => spec.id === Number(event.target.value));
                if (selected) seedPublishForm(selected);
              }}
              className="w-full rounded-md border px-3 py-2"
              style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }}
            >
              <option value="">Select spec...</option>
              {releaseReadySpecs.map((spec) => <option key={spec.id} value={spec.id}>{spec.name ?? spec.target_name}</option>)}
            </select>
          </FormField>
          <FormField label="Display Name" required>
            <input value={publishForm.display_name} onChange={(event) => setPublishForm((current) => ({ ...current, display_name: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
          <FormField label="Business Description" required>
            <textarea value={publishForm.business_description} onChange={(event) => setPublishForm((current) => ({ ...current, business_description: event.target.value }))} rows={4} className="w-full rounded-md border px-3 py-2 md:col-span-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
          <FormField label="Grain" required>
            <input value={publishForm.grain} onChange={(event) => setPublishForm((current) => ({ ...current, grain: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
          <FormField label="Domain" required>
            <input value={publishForm.domain} onChange={(event) => setPublishForm((current) => ({ ...current, domain: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
          <FormField label="Owner" required>
            <input value={publishForm.owner} onChange={(event) => setPublishForm((current) => ({ ...current, owner: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
          <FormField label="Steward" required>
            <input value={publishForm.steward} onChange={(event) => setPublishForm((current) => ({ ...current, steward: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
          <FormField label="Sensitivity">
            <select value={publishForm.sensitivity_label} onChange={(event) => setPublishForm((current) => ({ ...current, sensitivity_label: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }}>
              <option value="public">Public</option>
              <option value="internal">Internal</option>
              <option value="confidential">Confidential</option>
              <option value="restricted">Restricted</option>
            </select>
          </FormField>
          <FormField label="Endorsement">
            <select value={publishForm.endorsement} onChange={(event) => setPublishForm((current) => ({ ...current, endorsement: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }}>
              <option value="none">None</option>
              <option value="promoted">Promoted</option>
              <option value="certified">Certified</option>
            </select>
          </FormField>
          <FormField label="Tags">
            <input value={publishForm.tags} onChange={(event) => setPublishForm((current) => ({ ...current, tags: event.target.value }))} placeholder="finance, scorecard, executive" className="w-full rounded-md border px-3 py-2 md:col-span-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setShowPublish(false)} className="rounded-md px-4 py-2 text-sm" style={{ ...body(13, { color: "var(--bp-ink-secondary)" }) }}>Cancel</button>
          <button type="button" disabled={!publishForm.spec_id || !publishForm.display_name || !publishForm.business_description || !publishForm.grain || !publishForm.domain || !publishForm.owner || !publishForm.steward} onClick={submitPublish} className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)" }}>
            Publish Product
          </button>
        </div>
      </Modal>

      <Modal open={showAddReport} onClose={() => setShowAddReport(false)}>
        <h3 style={{ ...display(18, { color: "var(--bp-ink-primary)", margin: 0 }) }}>Register Downstream Report</h3>
        <p style={{ ...body(12, { color: "var(--bp-ink-secondary)", marginTop: 8, lineHeight: 1.5 }) }}>
          Registering every report, workbook, or model that must migrate into this domain is what makes the coverage map trustworthy.
        </p>
        <div className="mt-4 grid gap-3">
          <FormField label="Domain" required>
            <input value={newReport.domain} onChange={(event) => setNewReport((current) => ({ ...current, domain: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
          <FormField label="Report Name" required>
            <input value={newReport.report_name} onChange={(event) => setNewReport((current) => ({ ...current, report_name: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
          <FormField label="Report Description">
            <textarea value={newReport.report_description} onChange={(event) => setNewReport((current) => ({ ...current, report_description: event.target.value }))} rows={3} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }} />
          </FormField>
          <FormField label="Report Type">
            <select value={newReport.report_type} onChange={(event) => setNewReport((current) => ({ ...current, report_type: event.target.value }))} className="w-full rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }}>
              <option value="power_bi">Power BI</option>
              <option value="ssrs">SSRS</option>
              <option value="excel">Excel</option>
              <option value="other">Other</option>
            </select>
          </FormField>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setShowAddReport(false)} className="rounded-md px-4 py-2 text-sm" style={{ ...body(13, { color: "var(--bp-ink-secondary)" }) }}>Cancel</button>
          <button type="button" disabled={!newReport.domain || !newReport.report_name} onClick={addReport} className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)" }}>
            Register Report
          </button>
        </div>
      </Modal>
    </GoldStudioLayout>
  );
}

function CoverageMapView({
  coverageMap,
  filteredArtifacts,
  filteredReports,
  artifactFilter,
  onArtifactFilterChange,
  reportFilter,
  onReportFilterChange,
  unpublishedSpecs,
  onOpenArtifact,
  onOpenBlocker,
  onOpenReport,
  onOpenSpec,
  onPublishSpec,
}: {
  coverageMap: CoverageMapResponse;
  filteredArtifacts: CoverageArtifact[];
  filteredReports: CoverageReport[];
  artifactFilter: string;
  onArtifactFilterChange: (value: string) => void;
  reportFilter: string;
  onReportFilterChange: (value: string) => void;
  unpublishedSpecs: SpecRow[];
  onOpenArtifact: (artifact: CoverageArtifact) => void;
  onOpenBlocker: (blocker: CoverageBlocker) => void;
  onOpenReport: (report: CoverageReport) => void;
  onOpenSpec: (spec: SpecRow) => void;
  onPublishSpec: (spec: SpecRow) => void;
}) {
  const artifactStatuses = useMemo(() => ["all", ...new Set(coverageMap.artifacts.map((item) => item.coverage_status))], [coverageMap.artifacts]);
  const reportStatuses = useMemo(() => ["all", ...new Set(coverageMap.reports.map((item) => item.coverage_status))], [coverageMap.reports]);

  return (
    <div className="space-y-4 pb-8">
      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <SectionCard
          eyebrow="Imported Evidence"
          title="What the imported artifacts demand from the final model"
          description="Each imported artifact becomes evidence for what the domain model must include. Structural artifacts need field coverage. Supporting/contextual artifacts still matter, but they do not necessarily expose parseable lineage."
          action={<SelectFilter value={artifactFilter} options={artifactStatuses} onChange={onArtifactFilterChange} />}
        >
          <div className="space-y-2">
            {filteredArtifacts.map((artifact, index) => {
              const tone = getCoverageTone(artifact.coverage_status);
              return (
                <button
                  key={artifact.artifact_id}
                  type="button"
                  onClick={() => onOpenArtifact(artifact)}
                  className="gs-stagger-row gs-row-hover w-full rounded-lg px-3 py-3 text-left transition-colors"
                  style={{ "--i": Math.min(index, 15), background: index % 2 === 1 ? "var(--bp-surface-inset)" : "var(--bp-surface-1)", border: "1px solid var(--bp-border)" } as CSSProperties}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span style={{ ...display(15, { color: "var(--bp-ink-primary)" }) }}>{artifact.artifact_name}</span>
                        <StatusChip label={tone.label} color={tone.color} bg={tone.bg} />
                        <span style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{artifact.artifact_type}</span>
                      </div>
                      <p style={{ ...body(12, { color: "var(--bp-ink-secondary)", marginTop: 6, lineHeight: 1.5 }) }}>{artifact.coverage_note}</p>
                      <div className="mt-3">
                        <ProgressRail value={artifact.proposed_coverage_pct} color={tone.color} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-4">
                        <span style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{artifact.mapped_row_count}/{artifact.usage_row_count} field rows accounted</span>
                        <span style={{ ...body(11, { color: "var(--bp-ink-muted)" }) }}>{artifact.page_count} pages • {artifact.visual_count} visuals • {artifact.canonical_count} canonical objects</span>
                      </div>
                    </div>
                    <div className="rounded-lg px-3 py-2" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", minWidth: 130 }}>
                      <div style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }) }}>Needs Review</div>
                      <div style={{ ...display(20, { color: artifact.needs_review_count > 0 ? "var(--bp-fault-red)" : "var(--bp-operational-green)" }) }}>{artifact.needs_review_count}</div>
                    </div>
                  </div>
                </button>
              );
            })}
            {filteredArtifacts.length === 0 ? <GoldNoResults title="No artifacts match the current coverage filter" message="Widen the filter to see all imported evidence that contributes to this release review." /> : null}
          </div>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            eyebrow="Release Blockers"
            title="Everything that still blocks a safe migration"
            description="A blocker here means the final gold model cannot yet prove that it accounts for an imported artifact, a required spec, or a downstream report."
            action={<span style={{ ...display(20, { color: coverageMap.blockers.length === 0 ? "var(--bp-operational-green)" : "var(--bp-fault-red)" }) }}>{coverageMap.blockers.length}</span>}
          >
            <div className="space-y-2">
              {coverageMap.blockers.slice(0, 10).map((blocker, index) => (
                <button
                  key={`${blocker.kind}-${blocker.name}-${index}`}
                  type="button"
                  onClick={() => onOpenBlocker(blocker)}
                  className="gs-stagger-row w-full rounded-lg px-3 py-2 text-left"
                  style={{ "--i": Math.min(index, 15), background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" } as CSSProperties}
                >
                  <div className="flex items-center gap-2">
                    <StatusChip label={blocker.kind.toUpperCase()} color="var(--bp-fault-red)" bg="var(--bp-fault-light)" />
                    <span style={{ ...body(13, { color: "var(--bp-ink-primary)", fontWeight: 600 }) }}>{blocker.name}</span>
                  </div>
                  <p style={{ ...body(12, { color: "var(--bp-ink-secondary)", marginTop: 6, lineHeight: 1.45 }) }}>{blocker.reason}</p>
                </button>
              ))}
              {coverageMap.blockers.length === 0 ? <GoldNoResults title="No blockers are currently open" message="The release gate is clear. If your team agrees with the proposed semantic model, you can move forward with publishing." /> : null}
            </div>
          </SectionCard>

          <SectionCard
            eyebrow="Publish Queue"
            title="Validated specs that still need publishing"
            description="A validated spec is not yet a live gold product. Publishing creates the governed semantic product that reports can actually migrate to."
            action={<span style={{ ...display(20, { color: unpublishedSpecs.length > 0 ? "var(--bp-copper)" : "var(--bp-operational-green)" }) }}>{unpublishedSpecs.length}</span>}
          >
            <div className="space-y-2">
              {unpublishedSpecs.map((spec) => (
                <div key={spec.id} className="rounded-lg px-3 py-3" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button type="button" onClick={() => onOpenSpec(spec)} className="text-left">
                      <div style={{ ...display(15, { color: "var(--bp-ink-primary)" }) }}>{spec.name ?? spec.target_name}</div>
                      <div style={{ ...body(12, { color: "var(--bp-ink-muted)", marginTop: 4 }) }}>{spec.domain} • v{spec.version}</div>
                    </button>
                    <button type="button" onClick={() => onPublishSpec(spec)} className="rounded-md px-3 py-2 text-sm font-medium" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)" }}>
                      Publish
                    </button>
                  </div>
                </div>
              ))}
              {unpublishedSpecs.length === 0 ? <GoldNoResults title="No validated specs are waiting for publishing" message="Either nothing has been validated yet, or everything validated is already represented by a published product." /> : null}
            </div>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        eyebrow="Report Migration"
        title="Downstream reports that must land on the final semantic model"
        description="This is the migration ledger. Each row describes whether a downstream report is already represented by the proposed model or still needs more facts, dimensions, measures, or release work."
        action={<SelectFilter value={reportFilter} options={reportStatuses} onChange={onReportFilterChange} />}
      >
        <div className="space-y-2">
          {filteredReports.map((report, index) => {
            const tone = getCoverageTone(report.coverage_status);
            return (
              <button
                key={report.id}
                type="button"
                onClick={() => onOpenReport(report)}
                className="gs-stagger-row gs-row-hover w-full rounded-lg px-3 py-3 text-left transition-colors"
                style={{ "--i": Math.min(index, 15), background: index % 2 === 1 ? "var(--bp-surface-inset)" : "var(--bp-surface-1)", border: "1px solid var(--bp-border)" } as CSSProperties}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span style={{ ...display(15, { color: "var(--bp-ink-primary)" }) }}>{report.report_name}</span>
                      <StatusChip label={tone.label} color={tone.color} bg={tone.bg} />
                      <span style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{REPORT_TYPE_LABELS[report.report_type ?? "other"]}</span>
                    </div>
                    <p style={{ ...body(12, { color: "var(--bp-ink-secondary)", marginTop: 6, lineHeight: 1.5 }) }}>{report.coverage_note}</p>
                    <div className="mt-2 flex flex-wrap gap-4">
                      <span style={{ ...body(11, { color: "var(--bp-ink-muted)" }) }}>{report.artifact_count} artifact(s)</span>
                      <span style={{ ...body(11, { color: "var(--bp-ink-muted)" }) }}>{report.canonical_count} canonical object(s)</span>
                      <span style={{ ...body(11, { color: report.unresolved_metric_count > 0 ? "var(--bp-fault-red)" : "var(--bp-ink-muted)" }) }}>{report.unresolved_metric_count} unresolved metric(s)</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
          {filteredReports.length === 0 ? <GoldNoResults title="No reports match the current coverage filter" message="Widen the filter to review all downstream report migration evidence." /> : null}
        </div>
      </SectionCard>
    </div>
  );
}

function ProposedModelView({
  model,
  flowNodes,
  flowEdges,
  onOpenNode,
}: {
  model: ProposedModelResponse;
  flowNodes: Array<Node<ModelFlowData, "semantic">>;
  flowEdges: Edge[];
  onOpenNode: (node: ProposedModelNode) => void;
}) {
  const needsSpec = model.nodes.filter((node) => node.model_state === "needs_spec");
  return (
    <div className="space-y-4 pb-8">
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard
          eyebrow="Semantic Model Review"
          title="Proposed final domain model"
          description="This view is the release-time answer to the question, 'What does the single gold semantic model need to contain so every imported artifact and report can migrate to it?'"
          action={<span style={{ ...display(20, { color: "var(--bp-copper)" }) }}>{model.summary.relationship_count}</span>}
        >
          <div style={{ height: 640, background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", borderRadius: 14 }}>
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={MODEL_NODE_TYPES}
              fitView
              minZoom={0.4}
              maxZoom={1.3}
              onNodeClick={(_, node) => onOpenNode((node.data as ModelFlowData).node)}
              nodesDraggable={false}
              elementsSelectable
              proOptions={{ hideAttribution: true }}
            >
              <Background color="rgba(0,0,0,0.03)" gap={24} size={1} />
              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>
          </div>
        </SectionCard>
        <div className="space-y-4">
          <SectionCard
            eyebrow="Release Summary"
            title="How ready the model is"
            description="Published objects are already live products. Validated objects are structurally ready. Designed objects still need the release gate to finish. Needs-spec objects are direct coverage gaps."
            action={<span style={{ ...display(20, { color: needsSpec.length > 0 ? "var(--bp-fault-red)" : "var(--bp-operational-green)" }) }}>{needsSpec.length}</span>}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Entities", value: model.summary.entity_count, icon: Database },
                { label: "Published", value: model.summary.published_entities, icon: CheckCheck },
                { label: "Validated", value: model.summary.validated_entities, icon: Sparkles },
                { label: "Need Specs", value: model.summary.entities_needing_specs, icon: Flag },
              ].map((metric) => {
                const Icon = metric.icon;
                return (
                  <div key={metric.label} className="rounded-lg px-3 py-3" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
                    <div className="flex items-center gap-2">
                      <Icon size={14} style={{ color: "var(--bp-copper)" }} />
                      <span style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{metric.label}</span>
                    </div>
                    <div style={{ ...display(24, { color: "var(--bp-ink-primary)", marginTop: 8 }) }}>{metric.value}</div>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            eyebrow="Coverage Gaps"
            title="Objects that still need concrete specs"
            description="These canonical objects already exist, but the release gate cannot promote them into the final domain model until they have a real gold spec."
            action={<span style={{ ...display(20, { color: needsSpec.length > 0 ? "var(--bp-fault-red)" : "var(--bp-operational-green)" }) }}>{needsSpec.length}</span>}
          >
            <div className="space-y-2">
              {needsSpec.slice(0, 8).map((node) => (
                <button key={node.root_id} type="button" onClick={() => onOpenNode(node)} className="w-full rounded-lg px-3 py-3 text-left" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
                  <div style={{ ...display(15, { color: "var(--bp-ink-primary)" }) }}>{node.name}</div>
                  <p style={{ ...body(12, { color: "var(--bp-ink-secondary)", marginTop: 6, lineHeight: 1.45 }) }}>{node.model_note}</p>
                </button>
              ))}
              {needsSpec.length === 0 ? <GoldNoResults title="Every object in this model has a concrete spec path" message="The model is no longer missing spec definitions. Use the graph to review structure and relationships before publishing." /> : null}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function CoverageAppendixView({
  appendix,
  filteredItems,
  appendixFilter,
  onAppendixFilterChange,
  appendixSearch,
  onAppendixSearchChange,
  onExport,
  onOpenItem,
}: {
  appendix: CoverageAppendixResponse;
  filteredItems: CoverageAppendixItem[];
  appendixFilter: string;
  onAppendixFilterChange: (value: string) => void;
  appendixSearch: string;
  onAppendixSearchChange: (value: string) => void;
  onExport: () => void;
  onOpenItem: (item: CoverageAppendixItem) => void;
}) {
  const statuses = useMemo(() => ["all", ...Object.keys(appendix.status_counts)], [appendix.status_counts]);
  return (
    <div className="space-y-4 pb-8">
      <SectionCard
        eyebrow="Coverage Appendix"
        title="Every imported reference, and how the final model accounts for it"
        description="This appendix is meant for design review, migration planning, and stakeholder walkthroughs. It is the explicit traceability record for how the gold model covers existing reports, queries, and imported assets."
        action={
          <button type="button" onClick={onExport} className="rounded-md px-3 py-2 text-sm font-medium" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)" }}>
            <span className="inline-flex items-center gap-2"><Download size={14} /> Export CSV</span>
          </button>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(appendix.status_counts).map(([status, count]) => {
            const tone = getMappingTone(status);
            return <StatusChip key={status} label={`${tone.label}: ${count}`} color={tone.color} bg={tone.bg} />;
          })}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SelectFilter value={appendixFilter} options={statuses} onChange={onAppendixFilterChange} />
          <div className="relative ml-auto w-full max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--bp-ink-muted)" }} />
            <input value={appendixSearch} onChange={(event) => onAppendixSearchChange(event.target.value)} placeholder="Search appendix rows..." className="w-full rounded-md border py-2 pl-9 pr-3" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-inset)", color: "var(--bp-ink-primary)" }) }} />
          </div>
        </div>
        {filteredItems.length > 0 ? (
          <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--bp-border)" }}>
            <table className="w-full">
              <thead style={{ background: "var(--bp-surface-inset)" }}>
                <tr>
                  {["Artifact", "Source Reference", "Canonical / Semantic", "Spec / Product", "Status"].map((header) => (
                    <th key={header} style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--bp-border)" }) }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, index) => {
                  const tone = getMappingTone(item.mapping_status);
                  return (
                    <tr key={`${item.kind}-${item.artifact_id}-${item.source_field_name ?? index}`} className="gs-stagger-row cursor-pointer transition-colors hover:bg-black/[0.02]" onClick={() => onOpenItem(item)} style={{ "--i": Math.min(index, 15), background: index % 2 === 1 ? "var(--bp-surface-inset)" : "var(--bp-surface-1)" } as CSSProperties}>
                      <td style={{ ...body(12, { color: "var(--bp-ink-primary)", padding: "12px", borderBottom: "1px solid var(--bp-border)" }) }}>
                        <div style={{ fontWeight: 600 }}>{item.artifact_name}</div>
                        <div style={{ ...body(11, { color: "var(--bp-ink-muted)", marginTop: 4 }) }}>{item.artifact_type} • {item.domain ?? "No domain"}</div>
                      </td>
                      <td style={{ ...body(12, { color: "var(--bp-ink-secondary)", padding: "12px", borderBottom: "1px solid var(--bp-border)" }) }}>
                        <div>{item.source_entity_name ?? "No source entity"}</div>
                        <div style={{ ...mono(11, { color: "var(--bp-ink-muted)", marginTop: 4 }) }}>{item.source_field_name ?? item.field_kind ?? "Artifact-level evidence"}</div>
                      </td>
                      <td style={{ ...body(12, { color: "var(--bp-ink-secondary)", padding: "12px", borderBottom: "1px solid var(--bp-border)" }) }}>
                        <div>{item.canonical_name ?? "No canonical object"}</div>
                        <div style={{ ...mono(11, { color: "var(--bp-ink-muted)", marginTop: 4 }) }}>{item.semantic_name ?? "No semantic definition"}</div>
                      </td>
                      <td style={{ ...body(12, { color: "var(--bp-ink-secondary)", padding: "12px", borderBottom: "1px solid var(--bp-border)" }) }}>
                        <div>{item.spec_name ?? "No gold spec"}</div>
                        <div style={{ ...mono(11, { color: "var(--bp-ink-muted)", marginTop: 4 }) }}>{item.catalog_name ?? "No published product"}</div>
                      </td>
                      <td style={{ ...body(12, { color: "var(--bp-ink-secondary)", padding: "12px", borderBottom: "1px solid var(--bp-border)" }) }}>
                        <StatusChip label={tone.label} color={tone.color} bg={tone.bg} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <GoldNoResults title="No appendix rows match the current filter" message="Adjust the status filter or search term to inspect a different slice of the release appendix." />
        )}
      </SectionCard>
    </div>
  );
}

function ArtifactDetail({ artifact }: { artifact: CoverageArtifact }) {
  const tone = getCoverageTone(artifact.coverage_status);
  return (
    <div className="space-y-5">
      <div className="rounded-xl p-4" style={{ background: tone.bg, border: `1px solid color-mix(in srgb, ${tone.color} 22%, transparent)` }}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip label={tone.label} color={tone.color} bg="transparent" />
          <span style={{ ...mono(11, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{artifact.artifact_type}</span>
        </div>
        <p style={{ ...body(13, { color: "var(--bp-ink-primary)", marginTop: 8, lineHeight: 1.6 }) }}>{artifact.coverage_note}</p>
      </div>
      <DetailGrid
        items={[
          ["Source System", artifact.source_system ?? "Not recorded"],
          ["Source Class", artifact.source_class ?? "Not recorded"],
          ["Domain", artifact.division ?? "Not recorded"],
          ["Job State", artifact.job_state ?? "Not recorded"],
          ["Coverage", `${artifact.mapped_row_count}/${artifact.usage_row_count} field rows`],
          ["Published Rows", String(artifact.published_row_count)],
          ["Canonical Objects", String(artifact.canonical_count)],
          ["Gold Specs", String(artifact.spec_count)],
        ]}
      />
      {artifact.sample_gaps.length > 0 ? <EvidenceList title="Representative Gaps" items={artifact.sample_gaps} tone="danger" /> : null}
      {artifact.catalog_products.length > 0 ? <EvidenceList title="Published Products Covered" items={artifact.catalog_products} /> : null}
    </div>
  );
}

function SemanticModelDetail({ node }: { node: ProposedModelNode }) {
  const tone = releaseNodeTone(node);
  return (
    <div className="space-y-5">
      <div className="rounded-xl p-4" style={{ background: tone.bg, border: `1px solid ${tone.border}` }}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip label={tone.label} color={tone.color} bg="transparent" />
          <span style={{ ...mono(11, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{node.entity_type.toUpperCase()}</span>
        </div>
        <p style={{ ...body(13, { color: "var(--bp-ink-primary)", marginTop: 8, lineHeight: 1.6 }) }}>{node.model_note}</p>
      </div>
      <DetailGrid
        items={[
          ["Grain", node.grain ?? "Not recorded"],
          ["Steward", node.steward ?? "Not recorded"],
          ["Artifacts Using It", String(node.artifact_evidence_count)],
          ["Field References", String(node.field_reference_count)],
          ["Reports Depending On It", String(node.report_count)],
          ["Relationships", String(node.relationship_count)],
          ["Gold Spec", node.spec_name ?? "No gold spec"],
          ["Spec Status", node.spec_status ?? "Not recorded"],
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <EvidenceList title="Columns" items={node.columns_preview.map((column) => `${column.key_designation ? `${column.key_designation} · ` : ""}${column.column_name}`)} />
        <EvidenceList title="Measures" items={node.measures_preview.map((measure) => measure.name)} />
      </div>
    </div>
  );
}

function AppendixDetail({ item }: { item: CoverageAppendixItem }) {
  const tone = getMappingTone(item.mapping_status);
  return (
    <div className="space-y-5">
      <div className="rounded-xl p-4" style={{ background: tone.bg, border: `1px solid color-mix(in srgb, ${tone.color} 22%, transparent)` }}>
        <StatusChip label={tone.label} color={tone.color} bg="transparent" />
        <p style={{ ...body(13, { color: "var(--bp-ink-primary)", marginTop: 8, lineHeight: 1.6 }) }}>{item.mapping_note}</p>
      </div>
      <DetailGrid
        items={[
          ["Artifact", item.artifact_name],
          ["Artifact Type", item.artifact_type],
          ["Source Entity", item.source_entity_name ?? "Not recorded"],
          ["Source Field", item.source_field_name ?? "Not recorded"],
          ["Canonical Object", item.canonical_name ?? "Not mapped"],
          ["Semantic Definition", item.semantic_name ?? "Not mapped"],
          ["Gold Spec", item.spec_name ?? "Not mapped"],
          ["Published Product", item.catalog_name ?? "Not mapped"],
          ["Page", item.page_name ?? "Not recorded"],
          ["Visual", item.visual_id ?? item.visual_type ?? "Not recorded"],
        ]}
      />
    </div>
  );
}

function ReportCoverageDetail({ report }: { report: CoverageReport | ReportCoverage }) {
  const tone = getCoverageTone(report.coverage_status);
  const unresolved = parseJsonField<string[]>(report.unresolved_metrics) ?? [];
  const artifactNames = "artifact_names" in report ? report.artifact_names : [];
  const canonicalNames = "canonical_names" in report ? report.canonical_names : [];
  const specNames = "spec_names" in report ? report.spec_names : [];
  return (
    <div className="space-y-5">
      <div className="rounded-xl p-4" style={{ background: tone.bg, border: `1px solid color-mix(in srgb, ${tone.color} 22%, transparent)` }}>
        <StatusChip label={tone.label} color={tone.color} bg="transparent" />
        <p style={{ ...body(13, { color: "var(--bp-ink-primary)", marginTop: 8, lineHeight: 1.6 }) }}>
          {"coverage_note" in report ? report.coverage_note : report.notes ?? "No detailed assessment note recorded yet."}
        </p>
      </div>
      <DetailGrid
        items={[
          ["Report Type", REPORT_TYPE_LABELS[report.report_type ?? "other"]],
          ["Assessed By", report.assessed_by ?? "Not recorded"],
          ["Assessed At", formatDate(report.assessed_at)],
          ["Last Updated", formatDate(report.updated_at)],
        ]}
      />
      {artifactNames.length > 0 || canonicalNames.length > 0 || specNames.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <EvidenceList title="Artifacts" items={artifactNames} />
          <EvidenceList title="Canonical Objects" items={canonicalNames} />
          <EvidenceList title="Gold Specs" items={specNames} />
        </div>
      ) : null}
      {unresolved.length > 0 ? <EvidenceList title="Unresolved Metrics" items={unresolved} tone="danger" /> : null}
    </div>
  );
}

function ValidationRunDetail({ spec, run, reconciliation }: { spec: SpecRow; run: ValidationRunRow | null; reconciliation: ReconciliationRow[] }) {
  const summary = readValidationDetails(run);
  const waiver = parseJsonField<Waiver>(run?.waiver);
  const rules = summary.details;
  return (
    <div className="space-y-5">
      <div className="rounded-xl p-4" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
        <div style={{ ...display(16, { color: "var(--bp-ink-primary)" }) }}>{spec.name ?? spec.target_name}</div>
        <p style={{ ...body(13, { color: "var(--bp-ink-secondary)", marginTop: 8, lineHeight: 1.6 }) }}>
          Use this panel to understand whether the spec is ready for publishing or whether it still needs validation fixes or a formal waiver.
        </p>
      </div>
      <DetailGrid
        items={[
          ["Spec Status", spec.status],
          ["Version", `v${spec.version}`],
          ["Latest Validation Status", run?.status ?? "No validation run yet"],
          ["Started At", formatDate(run?.started_at)],
          ["Completed At", formatDate(run?.completed_at)],
          ["Checks Run", String(summary.checksRun)],
          ["Checks Failed", String(summary.checksFailed)],
          ["Waiver", waiver ? `${waiver.approver} on ${formatDate(waiver.filed_at)}` : "None filed"],
        ]}
      />
      {rules.length > 0 ? (
        <div>
          <div style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }) }}>Validation Checks</div>
          <div className="space-y-2">
            {rules.map((rule, index) => {
              const tone = rule.status === "passed"
                ? { color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)" }
                : rule.status === "waiver"
                  ? { color: "var(--bp-caution-amber)", bg: "var(--bp-caution-light)" }
                  : { color: "var(--bp-fault-red)", bg: "var(--bp-fault-light)" };
              return (
                <div key={`${rule.rule ?? rule.check ?? "rule"}-${index}`} className="rounded-lg px-3 py-3" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip label={rule.status.toUpperCase()} color={tone.color} bg={tone.bg} />
                    <span style={{ ...body(13, { color: "var(--bp-ink-primary)", fontWeight: 600 }) }}>{rule.rule ?? rule.check ?? "Validation rule"}</span>
                  </div>
                  {rule.message ? <p style={{ ...body(12, { color: "var(--bp-ink-secondary)", marginTop: 6, lineHeight: 1.5 }) }}>{rule.message}</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {reconciliation.length > 0 ? (
        <div>
          <div style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }) }}>Reconciliation</div>
          <div className="space-y-2">
            {reconciliation.map((row) => (
              <div key={row.metric} className="rounded-lg px-3 py-3" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
                <div style={{ ...body(13, { color: "var(--bp-ink-primary)", fontWeight: 600 }) }}>{row.metric}</div>
                <div className="mt-1 grid gap-2 lg:grid-cols-3">
                  <span style={{ ...mono(11, { color: "var(--bp-ink-muted)" }) }}>Legacy: {row.legacy_value}</span>
                  <span style={{ ...mono(11, { color: "var(--bp-ink-muted)" }) }}>Gold: {row.gold_value}</span>
                  <span style={{ ...mono(11, { color: row.status === "within_tolerance" ? "var(--bp-operational-green)" : row.status === "review" ? "var(--bp-caution-amber)" : "var(--bp-fault-red)" }) }}>Delta: {row.delta}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SelectFilter({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-md border px-3 py-2" style={{ ...body(13, { borderColor: "var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }) }}>
      {options.map((option) => {
        if (option === "all") return <option key={option} value={option}>All statuses</option>;
        const label = COVERAGE_STATUS_CFG[option]?.label ?? MAPPING_STATUS_CFG[option]?.label ?? option;
        return <option key={option} value={option}>{label}</option>;
      })}
    </select>
  );
}

function DetailGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid gap-3 md:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg px-3 py-3" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
          <dt style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }) }}>{label}</dt>
          <dd style={{ ...body(13, { color: "var(--bp-ink-primary)", marginTop: 8, lineHeight: 1.5 }) }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EvidenceList({ title, items, tone = "neutral" }: { title: string; items: string[]; tone?: "neutral" | "danger" }) {
  if (items.length === 0) {
    return <GoldNoResults title={`No ${title.toLowerCase()} recorded`} message="Nothing is registered in this section yet." />;
  }
  return (
    <div>
      <div style={{ ...mono(10, { color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }) }}>{title}</div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="rounded-lg px-3 py-2" style={{ background: tone === "danger" ? "var(--bp-fault-light)" : "var(--bp-surface-inset)", border: tone === "danger" ? "1px solid rgba(185,58,42,0.16)" : "1px solid var(--bp-border)", ...body(12, { color: "var(--bp-ink-primary)" }) }}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
