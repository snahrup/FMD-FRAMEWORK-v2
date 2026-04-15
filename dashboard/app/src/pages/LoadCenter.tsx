import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Play,
  RefreshCw,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Database,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Search,
} from "lucide-react";
import { useEntityDigest } from "@/hooks/useEntityDigest";
import {
  findEntityById,
  findEntityFromParams,
  getEntityMissingLayers,
  isSuccessStatus,
} from "@/lib/exploreWorksurface";
import CompactPageHeader from "@/components/layout/CompactPageHeader";

// ============================================================================
// TYPES
// ============================================================================

interface LayerSummary {
  tables: number;
  rows: number;
  fullLoadTables?: number;
  fullLoadRows?: number;
  incrementalTables?: number;
  incrementalDeltaRows?: number;
  hasRowCounts?: boolean;
}

interface SourceSummary {
  name: string;
  displayName: string;
  lz: LayerSummary;
  bronze: LayerSummary;
  silver: LayerSummary;
}

interface GapRow {
  source: string;
  schema: string;
  table: string;
  missingIn: string[];
}

interface LatestIssue {
  layer: string;
  status: string;
  at: string | null;
  message: string | null;
  runId: string | null;
}

interface SelfHealEvent {
  id: number;
  attemptNumber: number;
  step: string;
  status: string;
  message: string;
  createdAt: string | null;
}

interface SelfHealCase {
  id: number;
  parentRunId: string | null;
  retryRunId: string | null;
  landingEntityId: number;
  targetEntityId: number;
  layer: string;
  status: string;
  currentStep: string;
  attemptCount: number;
  maxAttempts: number;
  agentName?: string | null;
  latestError?: string | null;
  errorSuggestion?: string | null;
  resolutionSummary?: string | null;
  source: string;
  schema: string;
  table: string;
  patchFiles: string[];
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  events: SelfHealEvent[];
}

interface SelfHealPayload {
  enabled: boolean;
  configured: boolean;
  availableAgents: string[];
  selectedAgent?: string | null;
  note?: string | null;
  runtime: {
    status: string;
    currentCaseId: number | null;
    workerPid: number | null;
    agentName?: string | null;
    heartbeatAt: string | null;
    lastMessage?: string | null;
    healthy: boolean;
  };
  summary: {
    queuedCount: number;
    activeCount: number;
    succeededCount: number;
    exhaustedCount: number;
    disabledCount: number;
    totalCount: number;
  };
  cases: SelfHealCase[];
}

interface OutstandingEntity extends GapRow {
  entityId: number;
  layerStatus: Record<string, string>;
  nextAction?: string;
  nextActionLabel?: string;
  planReasonCode?: string;
  planReason?: string;
  needsGapFill: boolean;
  missingRegistrations: string[];
  needsOptimize: boolean;
  actionSummary?: string;
  latestIssue?: LatestIssue | null;
  selfHealCase?: SelfHealCase | null;
}

interface CompletionPlanSummary {
  fullLoadCount: number;
  incrementalCount: number;
  gapFillCount: number;
  needsOptimizeCount: number;
  totalEntities?: number;
}

interface StatusResponse {
  sources: SourceSummary[];
  totals: Record<string, LayerSummary>;
  gapCount: number;
  gaps: GapRow[];
  outstanding: OutstandingEntity[];
  outstandingCount: number;
  toolReadyCount: number;
  completionPlan: { summary: CompletionPlanSummary };
  selfHeal: SelfHealPayload;
  totalRegistered: number;
  unmatchedCount: number;
  dataSource: string;
  scannedAt: string | null;
  refreshRunning: boolean;
  runState: RunState;
  engineRunState?: {
    active: { runId: string; status: string; startedAt?: string | null; endedAt?: string | null; totalEntities?: number } | null;
    resumable: { runId: string; status: string; startedAt?: string | null; endedAt?: string | null; totalEntities?: number } | null;
  };
  queryTimeSec: number;
}

interface RunState {
  active: boolean;
  runId?: number;
  startedAt?: string;
  completedAt?: string;
  phase?: string;
  error?: string;
  plan?: CompletionPlanSummary;
  progress?: Record<string, unknown>;
}

interface RunPlan {
  dryRun: boolean;
  plan: {
    summary: CompletionPlanSummary;
    fullLoad: Array<{ entityId: number; source: string; schema: string; table: string; reason: string }>;
    incremental: Array<{ entityId: number; source: string; schema: string; table: string }>;
    gapFill: Array<{ entityId: number; source: string; schema: string; table: string }>;
    needsOptimize: Array<{ entityId: number; source: string; schema: string; table: string }>;
    totalEntities: number;
  };
}

interface VpnStatus {
  status?: string;
  connected: boolean;
  clientRunning?: boolean;
  checkedAt?: string | null;
  note?: string | null;
  error?: string | null;
  requiredForLocalLoads?: boolean;
  source?: string;
}

interface SourceDetail {
  source: string;
  tables: Array<{
    schema: string;
    table: string;
    lz: number | null;
    bronze: number | null;
    silver: number | null;
    lzRowSource?: string;
    bronzeRowSource?: string;
    silverRowSource?: string;
    isIncremental: boolean;
    registered: boolean;
  }>;
  tableCount: number;
  summary: { lz: number; bronze: number; silver: number; gaps: number };
}

// ============================================================================
// API
// ============================================================================

const API = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ============================================================================
// FORMATTING
// ============================================================================

function fmt(n: number | null | undefined): string {
  if (n == null || n < 0) return "—";
  return n.toLocaleString();
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Build an honest sub-label for a layer's row count.
 *  - Full loads only: "7.7B rows written"
 *  - Incremental only: "42K incremental deltas"
 *  - Mixed: "7.7B rows written (42K are deltas from 52 incremental tables)"
 */
function rowSubLabel(layer: LayerSummary | undefined): string {
  if (!layer) return "—";
  const incr = layer.incrementalDeltaRows ?? 0;
  const incrTables = layer.incrementalTables ?? 0;
  const total = layer.rows ?? 0;
  if (total === 0) return "no rows yet";
  if (incrTables === 0) return `${fmtCompact(total)} rows written`;
  if (incrTables === layer.tables) return `${fmtCompact(total)} incremental deltas`;
  return `${fmtCompact(total)} rows written (${fmtCompact(incr)} deltas from ${incrTables} incr.)`;
}

const SELF_HEAL_WORKFLOW = [
  { key: "queued", label: "Queue failure" },
  { key: "collecting_context", label: "Collect context" },
  { key: "invoking_agent", label: "Invoke local CLI" },
  { key: "validating_patch", label: "Validate patch" },
  { key: "retrying", label: "Retry entity" },
  { key: "resolved", label: "Return to run" },
] as const;

const LAYER_LABELS: Record<string, string> = {
  landing: "Landing",
  bronze: "Bronze",
  silver: "Silver",
};

function layerLabel(layer: string): string {
  return LAYER_LABELS[layer] || layer;
}

function shortRunId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : "—";
}

function truncateText(value: string | null | undefined, max = 180): string {
  if (!value) return "No error text captured.";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function statusTone(status: string | null | undefined): { background: string; color: string } {
  switch ((status || "").toLowerCase()) {
    case "loaded":
    case "succeeded":
      return { background: "rgba(34,197,94,0.12)", color: "#15803d" };
    case "failed":
    case "error":
    case "aborted":
    case "interrupted":
      return { background: "rgba(239,68,68,0.12)", color: "#b91c1c" };
    case "skipped":
      return { background: "rgba(245,158,11,0.12)", color: "#b45309" };
    default:
      return { background: "rgba(148,163,184,0.12)", color: "var(--bp-ink-secondary)" };
  }
}

// ============================================================================
// COMPONENTS
// ============================================================================

/** Small colored pill showing the data source method */
function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    sql_endpoint: "var(--bp-success, #22c55e)",
    filesystem: "var(--bp-warning, #f59e0b)",
    mixed: "var(--bp-warning, #f59e0b)",
    unavailable: "var(--bp-error, #ef4444)",
  };
  const labels: Record<string, string> = {
    sql_endpoint: "Live SQL",
    filesystem: "Filesystem",
    mixed: "Mixed",
    unavailable: "Unavailable",
  };
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: `${colors[method] || colors.unavailable}18`,
        color: colors[method] || colors.unavailable,
        letterSpacing: "0.3px",
      }}
    >
      {labels[method] || method}
    </span>
  );
}

/** Big KPI card */
function KPI({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div
      style={{
        background: "var(--bp-surface-1)",
        border: "1px solid var(--bp-border)",
        borderRadius: 8,
        padding: "16px 20px",
        flex: 1,
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--bp-ink-muted)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent || "var(--bp-ink-primary)", lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: "var(--bp-ink-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/** Layer bar showing table count with visual width */
function LayerBar({ label, layer, maxTables, color }: { label: string; layer: LayerSummary; maxTables: number; color: string }) {
  const pct = maxTables > 0 ? Math.max((layer.tables / maxTables) * 100, 2) : 0;
  const hasIncr = (layer.incrementalTables ?? 0) > 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
      <div style={{ width: 50, fontSize: 11, fontWeight: 600, color: "var(--bp-ink-muted)", textAlign: "right" }}>{label}</div>
      <div style={{ flex: 1, background: "var(--bp-surface-inset)", borderRadius: 4, height: 24, position: "relative", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 4,
            transition: "width 0.3s ease",
            opacity: 0.8,
          }}
        />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
          {layer.tables} tables {layer.rows > 0 && (
            <span style={{ fontWeight: 400, marginLeft: 4, color: "var(--bp-ink-muted)" }}>
              ({fmtCompact(layer.rows)} rows{hasIncr ? "*" : ""})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DETAIL TABLE (per-source drill-down)
// ============================================================================

type SortField = "table" | "lz" | "bronze" | "silver";
type SortDir = "asc" | "desc";

function SourceDetailTable({ detail }: { detail: SourceDetail }) {
  const [sort, setSort] = useState<SortField>("table");
  const [dir, setDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");

  const toggle = (field: SortField) => {
    if (sort === field) setDir(d => d === "asc" ? "desc" : "asc");
    else { setSort(field); setDir(field === "table" ? "asc" : "desc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sort !== field) return <ArrowUpDown style={{ width: 12, height: 12, opacity: 0.3 }} />;
    return dir === "asc" ? <ArrowUp style={{ width: 12, height: 12 }} /> : <ArrowDown style={{ width: 12, height: 12 }} />;
  };

  const filtered = useMemo(() => {
    let rows = detail.tables;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => r.table.toLowerCase().includes(q) || r.schema.toLowerCase().includes(q));
    }
    rows = [...rows].sort((a, b) => {
      const m = dir === "asc" ? 1 : -1;
      if (sort === "table") return a.table.localeCompare(b.table) * m;
      const av = a[sort] ?? -2;
      const bv = b[sort] ?? -2;
      return ((av as number) - (bv as number)) * m;
    });
    return rows;
  }, [detail.tables, search, sort, dir]);

  const thStyle: React.CSSProperties = {
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: "var(--bp-ink-muted)",
    borderBottom: "1px solid var(--bp-border)",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    padding: "6px 12px",
    fontSize: 13,
    borderBottom: "1px solid var(--bp-border-subtle, var(--bp-border))",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Search style={{ width: 14, height: 14, color: "var(--bp-ink-muted)" }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter tables..."
          style={{
            background: "var(--bp-surface-inset)",
            border: "1px solid var(--bp-border)",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 13,
            color: "var(--bp-ink-primary)",
            width: 240,
            outline: "none",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--bp-ink-muted)" }}>{filtered.length} tables</span>
      </div>
      <div style={{ maxHeight: 400, overflowY: "auto", border: "1px solid var(--bp-border)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--bp-surface-1)", zIndex: 1 }}>
            <tr>
              <th style={thStyle} onClick={() => toggle("table")}>Table <SortIcon field="table" /></th>
              <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggle("lz")}>LZ Rows <SortIcon field="lz" /></th>
              <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggle("bronze")}>Bronze Rows <SortIcon field="bronze" /></th>
              <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggle("silver")}>Silver Rows <SortIcon field="silver" /></th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const hasGap = (r.lz !== null && (r.bronze === null || r.silver === null));
              const allMatch = r.lz !== null && r.bronze !== null && r.silver !== null;
              return (
                <tr key={`${r.schema}.${r.table}`} style={{ background: hasGap ? "rgba(239,68,68,0.04)" : undefined }}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 500 }}>{r.table}</span>
                    <span style={{ color: "var(--bp-ink-muted)", fontSize: 11, marginLeft: 6 }}>{r.schema}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {fmt(r.lz)}
                    {r.lzRowSource?.includes("incremental") && <span title="Incremental delta (not total)" style={{ fontSize: 10, color: "var(--bp-copper, #c47a5a)", marginLeft: 3 }}>Δ</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {fmt(r.bronze)}
                    {r.bronzeRowSource?.includes("incremental") && <span title="Incremental delta (not total)" style={{ fontSize: 10, color: "var(--bp-copper, #c47a5a)", marginLeft: 3 }}>Δ</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {fmt(r.silver)}
                    {r.silverRowSource?.includes("incremental") && <span title="Incremental delta (not total)" style={{ fontSize: 10, color: "var(--bp-copper, #c47a5a)", marginLeft: 3 }}>Δ</span>}
                  </td>
                  <td style={tdStyle}>
                    {r.isIncremental
                      ? <span style={{ fontSize: 11, color: "var(--bp-copper, #c47a5a)", fontWeight: 600 }}>Incremental</span>
                      : <span style={{ fontSize: 11, color: "var(--bp-ink-muted)" }}>Full</span>
                    }
                  </td>
                  <td style={tdStyle}>
                    {allMatch ? (
                      <CheckCircle2 style={{ width: 14, height: 14, color: "#22c55e" }} />
                    ) : hasGap ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#ef4444", fontWeight: 500 }}>
                        <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0 }} />
                        {r.bronze === null && r.silver === null ? "No B/S" : r.bronze === null ? "No Bronze" : "No Silver"}
                      </span>
                    ) : (
                      <Clock style={{ width: 14, height: 14, color: "var(--bp-ink-muted)" }} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoadCenterSelfHealRail({
  selfHeal,
  runtimeTone,
  stepState,
  activeCase,
  expanded,
  onToggle,
}: {
  selfHeal: SelfHealPayload;
  runtimeTone: { background: string; color: string; label: string };
  stepState: Array<{ key: string; label: string; state: string }>;
  activeCase: SelfHealCase | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const panelWidth = expanded ? 340 : 104;
  const compactSignal = activeCase
    ? activeCase.status.replaceAll("_", " ")
    : selfHeal.summary.queuedCount > 0
      ? `${selfHeal.summary.queuedCount} queued`
      : runtimeTone.label;

  return (
    <aside
      style={{
        width: panelWidth,
        flex: `0 0 ${panelWidth}px`,
        alignSelf: "flex-start",
        position: "sticky",
        top: 24,
        transition: "width 0.24s ease",
      }}
    >
      <div
        style={{
          border: "1px solid rgba(91,84,76,0.12)",
          borderRadius: 14,
          background: "rgba(255,255,255,0.92)",
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(15,23,42,0.04)",
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          style={{
            width: "100%",
            padding: expanded ? "14px 14px 12px" : "12px 10px",
            display: "flex",
            flexDirection: expanded ? "row" : "column",
            alignItems: expanded ? "center" : "flex-start",
            justifyContent: "space-between",
            gap: expanded ? 12 : 8,
            border: "none",
            background: "rgba(248,250,252,0.78)",
            borderBottom: expanded ? "1px solid rgba(91,84,76,0.10)" : "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--bp-ink-muted)" }}>
              Self-Heal
            </span>
            <span style={{ fontSize: expanded ? 14 : 24, fontWeight: 700, color: "var(--bp-ink-primary)", lineHeight: 1 }}>
              {expanded ? "Queue" : selfHeal.summary.totalCount.toLocaleString()}
            </span>
            <span style={{ fontSize: 11, color: "var(--bp-ink-secondary)", lineHeight: 1.4 }}>
              {expanded ? "Bounded repair flow off the main queue." : compactSignal}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: expanded ? "row" : "column", alignItems: expanded ? "center" : "flex-start", gap: 8 }}>
            {!expanded && (
              <span style={{ padding: "4px 8px", borderRadius: 999, background: runtimeTone.background, color: runtimeTone.color, fontSize: 10, fontWeight: 700 }}>
                {runtimeTone.label}
              </span>
            )}
            {expanded ? <ChevronDown style={{ width: 16, height: 16, color: "var(--bp-ink-muted)" }} /> : <ChevronRight style={{ width: 16, height: 16, color: "var(--bp-ink-muted)" }} />}
          </div>
        </button>

        {expanded && (
          <div style={{ padding: "12px 14px 14px", display: "grid", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
              {selfHeal.note}
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[
                { label: "Queued", value: selfHeal.summary.queuedCount, tone: "#1d4ed8" },
                { label: "Working", value: selfHeal.summary.activeCount, tone: "#c47a5a" },
                { label: "Resolved", value: selfHeal.summary.succeededCount, tone: "#15803d" },
                { label: "Exhausted", value: selfHeal.summary.exhaustedCount, tone: "#b91c1c" },
              ].map((item) => (
                <span key={item.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: `${item.tone}12`, color: item.tone, fontSize: 11, fontWeight: 700 }}>
                  {item.label}: {item.value.toLocaleString()}
                </span>
              ))}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: runtimeTone.background, color: runtimeTone.color, fontSize: 11, fontWeight: 700 }}>
                Daemon: {runtimeTone.label}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: "rgba(148,163,184,0.12)", color: "var(--bp-ink-secondary)", fontSize: 11, fontWeight: 700 }}>
                Agent: {(selfHeal.selectedAgent || "not detected").replaceAll("_", " ")}
              </span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {stepState.map((step) => {
                const tone =
                  step.state === "done"
                    ? { background: "rgba(34,197,94,0.12)", color: "#15803d" }
                    : step.state === "active"
                      ? { background: "rgba(196,122,90,0.14)", color: "var(--bp-copper, #c47a5a)" }
                      : step.state === "standby"
                        ? { background: "rgba(148,163,184,0.12)", color: "var(--bp-ink-secondary)" }
                        : { background: "rgba(59,130,246,0.10)", color: "#1d4ed8" };
                return (
                  <span key={step.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: tone.background, color: tone.color, fontSize: 11, fontWeight: 700 }}>
                    {step.label}
                  </span>
                );
              })}
            </div>

            {activeCase ? (
              <div style={{ border: "1px solid rgba(91,84,76,0.12)", borderRadius: 12, background: "rgba(255,255,255,0.88)", padding: "12px 12px 10px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                  Focus case
                </div>
                <div style={{ fontSize: 12, color: "var(--bp-ink-secondary)", marginTop: 6, lineHeight: 1.55 }}>
                  {activeCase.source}.{activeCase.schema}.{activeCase.table} · {layerLabel(activeCase.layer)}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(59,130,246,0.12)", color: "#1d4ed8", fontSize: 11, fontWeight: 700 }}>
                    {activeCase.status.replaceAll("_", " ")}
                  </span>
                  <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(148,163,184,0.12)", color: "var(--bp-ink-secondary)", fontSize: 11, fontWeight: 700 }}>
                    attempt {activeCase.attemptCount}/{activeCase.maxAttempts}
                  </span>
                </div>
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {activeCase.events.slice(0, 4).map((event) => (
                    <div key={event.id} style={{ borderLeft: "2px solid rgba(59,130,246,0.28)", paddingLeft: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                        {event.step.replaceAll("_", " ")}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--bp-ink-secondary)", lineHeight: 1.5, marginTop: 2 }}>
                        {event.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ border: "1px solid rgba(91,84,76,0.12)", borderRadius: 12, background: "rgba(255,255,255,0.88)", padding: "12px 12px 10px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                  Self-heal standing by
                </div>
                <div style={{ fontSize: 12, color: "var(--bp-ink-secondary)", marginTop: 6, lineHeight: 1.6 }}>
                  Failed entities are queued immediately, but code mutation and targeted retries only start after the active engine run is idle.
                </div>
                <div style={{ fontSize: 11, color: "var(--bp-ink-muted)", marginTop: 8, lineHeight: 1.55 }}>
                  {selfHeal.runtime.lastMessage || "No queued self-heal cases yet."}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function LoadCenter() {
  const [searchParams] = useSearchParams();
  const { allEntities } = useEntityDigest();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [vpnStatus, setVpnStatus] = useState<VpnStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [sourceDetail, setSourceDetail] = useState<SourceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [runPlan, setRunPlan] = useState<RunPlan | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");
  const [queueSourceFilter, setQueueSourceFilter] = useState("all");
  const [queueLayerFilter, setQueueLayerFilter] = useState("all");
  const [queueIssueFilter, setQueueIssueFilter] = useState<"all" | "withIssue" | "withoutIssue">("all");
  const [selfHealExpanded, setSelfHealExpanded] = useState(false);

  const loadStatus = useCallback(async (force = false) => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJson<StatusResponse>(`/load-center/status${force ? "?force=1" : ""}`);
      setStatus(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadVpnStatus = useCallback(async () => {
    try {
      const data = await fetchJson<VpnStatus>("/engine/vpn-status");
      setVpnStatus(data);
    } catch (e: unknown) {
      setVpnStatus({
        status: "unknown",
        connected: false,
        checkedAt: new Date().toISOString(),
        note: "VPN status is unavailable from the dashboard API.",
        error: e instanceof Error ? e.message : "Failed to load VPN status",
      });
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => {
    void loadVpnStatus();
    const iv = setInterval(() => { void loadVpnStatus(); }, 15000);
    return () => clearInterval(iv);
  }, [loadVpnStatus]);

  // Auto-refresh while a run is active
  useEffect(() => {
    if (!status?.runState?.active) return;
    const iv = setInterval(() => {
      void loadStatus();
      void loadVpnStatus();
    }, 5000);
    return () => clearInterval(iv);
  }, [status?.runState?.active, loadStatus, loadVpnStatus]);

  const toggleSource = async (name: string) => {
    if (expandedSource === name) {
      setExpandedSource(null);
      setSourceDetail(null);
      return;
    }
    setExpandedSource(name);
    setDetailLoading(true);
    try {
      const detail = await fetchJson<SourceDetail>(`/load-center/source-detail?source=${encodeURIComponent(name)}`);
      setSourceDetail(detail);
    } catch {
      setSourceDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDryRun = async () => {
    try {
      setRunLoading(true);
      const plan = await postJson<RunPlan>("/load-center/run", { dryRun: true });
      setRunPlan(plan);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Dry run failed");
    } finally {
      setRunLoading(false);
    }
  };

  const handleRun = async () => {
    try {
      setRunLoading(true);
      setRunPlan(null);
      if (resumableEngineRunId) {
        await postJson("/engine/resume", { run_id: resumableEngineRunId });
      } else {
        await postJson("/load-center/run", { dryRun: false });
      }
      // Refresh status to pick up run state
      await loadStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : resumableEngineRunId ? "Resume failed" : "Run failed");
    } finally {
      setRunLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const resp = await postJson<{ status: string }>("/load-center/refresh");
      if (resp.status === "already_running") {
        // Another refresh is in progress — just poll for its completion
      }
      // Poll /status until refreshRunning becomes false
      const poll = async () => {
        for (let i = 0; i < 60; i++) { // max ~2min
          await new Promise(r => setTimeout(r, 2000));
          try {
            const data = await fetchJson<StatusResponse>("/load-center/status");
            setStatus(data);
            if (!data.refreshRunning) return;
          } catch { /* keep polling */ }
        }
      };
      await poll();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const totals = status?.totals;
  const runState = status?.runState;
  const isRunning = runState?.active ?? false;
  const activeEngineRunId = status?.engineRunState?.active?.runId ?? null;
  const resumableEngineRunId = useMemo(() => {
    if (activeEngineRunId || isRunning) return null;
    const backendCandidate = status?.engineRunState?.resumable?.runId;
    if (typeof backendCandidate === "string" && backendCandidate) return backendCandidate;
    if (!runState) return null;
    const phase = (runState.phase ?? "").toLowerCase();
    if (!["interrupted", "failed"].includes(phase)) return null;
    const progress = (runState.progress ?? {}) as {
      load?: { engineResult?: { run_id?: string } };
    };
    const candidate = progress.load?.engineResult?.run_id;
    return typeof candidate === "string" && candidate ? candidate : null;
  }, [activeEngineRunId, isRunning, runState, status?.engineRunState?.resumable?.runId]);
  const primaryActionLabel = resumableEngineRunId ? "Resume Interrupted Run" : "Finish Outstanding";
  const primaryActionLongLabel = resumableEngineRunId ? "Resume Interrupted Engine Run" : "Finish Outstanding Entities";
  const completionSummary = status?.completionPlan?.summary;
  const tablesInScopeCount = status?.totalRegistered ?? 0;
  const missingLandingCount = Math.max(tablesInScopeCount - (totals?.lz?.tables ?? 0), 0);
  const missingBronzeCount = Math.max(tablesInScopeCount - (totals?.bronze?.tables ?? 0), 0);
  const missingSilverCount = Math.max(tablesInScopeCount - (totals?.silver?.tables ?? 0), 0);
  const selfHeal = status?.selfHeal;
  const selfHealCases = selfHeal?.cases ?? [];
  const showSelfHealPanel = Boolean(selfHeal && (selfHeal.configured || selfHeal.selectedAgent || selfHeal.summary.totalCount > 0));
  const activeSelfHealCase = useMemo(() => {
    return selfHealCases.find((caseRow) =>
      ["collecting_context", "invoking_agent", "validating_patch", "retrying"].includes(caseRow.status),
    ) ?? selfHealCases.find((caseRow) =>
      ["queued", "waiting_for_engine_idle"].includes(caseRow.status),
    ) ?? null;
  }, [selfHealCases]);
  const selfHealStepState = useMemo(() => {
    const activeIndex = activeSelfHealCase
      ? Math.max(
          0,
          SELF_HEAL_WORKFLOW.findIndex((step) =>
            step.key === "resolved"
              ? ["succeeded", "resolved"].includes(activeSelfHealCase.status) || activeSelfHealCase.currentStep === "resolved"
              : activeSelfHealCase.status === step.key || activeSelfHealCase.currentStep === step.key,
          ),
        )
      : -1;
    return SELF_HEAL_WORKFLOW.map((step, index) => ({
      ...step,
      state: activeSelfHealCase
        ? index < activeIndex
          ? "done"
          : index === activeIndex
            ? "active"
            : "pending"
        : selfHeal?.summary.totalCount
          ? "pending"
          : "standby",
    }));
  }, [activeSelfHealCase, selfHeal?.summary.totalCount]);
  const selfHealRuntimeTone = useMemo(() => {
    if (!selfHeal) {
      return { background: "rgba(148,163,184,0.12)", color: "var(--bp-ink-secondary)", label: "unknown" };
    }
    if (!selfHeal.runtime.workerPid && selfHeal.runtime.status === "idle") {
      return { background: "rgba(59,130,246,0.12)", color: "#1d4ed8", label: "armed" };
    }
    if (selfHeal.runtime.healthy) {
      return { background: "rgba(34,197,94,0.12)", color: "#15803d", label: selfHeal.runtime.status.replaceAll("_", " ") };
    }
    return { background: "rgba(245,158,11,0.12)", color: "#b45309", label: selfHeal.runtime.status.replaceAll("_", " ") };
  }, [selfHeal]);
  useEffect(() => {
    if (!showSelfHealPanel) {
      setSelfHealExpanded(false);
      return;
    }
    if (activeSelfHealCase && ["collecting_context", "invoking_agent", "validating_patch", "retrying"].includes(activeSelfHealCase.status)) {
      setSelfHealExpanded(true);
    }
  }, [activeSelfHealCase, showSelfHealPanel]);
  const outstandingEntities = useMemo(() => {
    return status?.outstanding ?? [];
  }, [status]);
  const outstandingSourceOptions = useMemo(() => {
    return Array.from(new Set(outstandingEntities.map((row) => row.source))).sort((left, right) => left.localeCompare(right));
  }, [outstandingEntities]);
  const filteredOutstanding = useMemo(() => {
    const query = queueSearch.trim().toLowerCase();
    return outstandingEntities.filter((row) => {
      if (queueSourceFilter !== "all" && row.source !== queueSourceFilter) return false;
      if (queueLayerFilter !== "all" && !row.missingIn.includes(queueLayerFilter)) return false;
      if (queueIssueFilter === "withIssue" && !row.latestIssue) return false;
      if (queueIssueFilter === "withoutIssue" && row.latestIssue) return false;
      if (!query) return true;
      const haystack = [
        row.source,
        row.schema,
        row.table,
        row.nextActionLabel,
        row.planReason,
        row.actionSummary,
        row.latestIssue?.message,
        row.latestIssue?.runId,
        row.selfHealCase?.status,
        row.selfHealCase?.currentStep,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [outstandingEntities, queueIssueFilter, queueLayerFilter, queueSearch, queueSourceFilter]);
  const focusedTable = searchParams.get("table");
  const focusedSource = searchParams.get("source");
  const focusedSchema = searchParams.get("schema");
  const focusedEntityId = searchParams.get("entity");
  const focusedGap = useMemo<GapRow | OutstandingEntity | null>(() => {
    if (!focusedTable || !status) return null;
    return status.outstanding.find((gap) =>
      gap.table.toLowerCase() === focusedTable.toLowerCase()
      && (!focusedSource || gap.source.toLowerCase() === focusedSource.toLowerCase())
    ) || status.gaps.find((gap) =>
      gap.table.toLowerCase() === focusedTable.toLowerCase()
      && (!focusedSource || gap.source.toLowerCase() === focusedSource.toLowerCase())
    ) || null;
  }, [focusedSource, focusedTable, status]);
  const focusedEntity = useMemo(() => {
    return findEntityById(allEntities, focusedEntityId)
      || findEntityFromParams(allEntities, {
        table: focusedTable,
        schema: focusedSchema,
        source: focusedSource,
      });
  }, [allEntities, focusedEntityId, focusedSchema, focusedSource, focusedTable]);
  const focusedMissingLayers = useMemo(() => {
    if (focusedEntity) return getEntityMissingLayers(focusedEntity);
    return focusedGap?.missingIn ?? [];
  }, [focusedEntity, focusedGap]);
  const focusedLayerStatus = focusedEntity ? [
    { label: "Landing", status: focusedEntity.lzStatus, ready: isSuccessStatus(focusedEntity.lzStatus) },
    { label: "Bronze", status: focusedEntity.bronzeStatus, ready: isSuccessStatus(focusedEntity.bronzeStatus) },
    { label: "Silver", status: focusedEntity.silverStatus, ready: isSuccessStatus(focusedEntity.silverStatus) },
  ] : [];
  const focusedEntityLabel = focusedEntity
    ? `${focusedEntity.source}.${focusedEntity.sourceSchema}.${focusedEntity.tableName}`
    : focusedGap
      ? `${focusedGap.source}.${focusedGap.schema}.${focusedGap.table}`
      : null;
  const focusedGapIssue = focusedGap && "latestIssue" in focusedGap ? focusedGap.latestIssue : null;
  const focusedEntityNote = focusedEntity?.lastError
    ? `Last recorded failure: ${focusedEntity.lastError.layer} · ${focusedEntity.lastError.message}`
    : focusedGapIssue?.message
      ? `Latest recorded issue: ${focusedGapIssue.layer} · ${truncateText(focusedGapIssue.message, 220)}`
    : focusedMissingLayers.length > 0
      ? `Still missing ${focusedMissingLayers.join(" + ")} before the asset can re-enter tool mode.`
      : focusedEntity
        ? "This table is in scope, but Load Center should still own the completion workflow."
        : null;
  const maxTables = useMemo(() => {
    if (!status?.sources) return 1;
    return Math.max(...status.sources.flatMap(s => [s.lz.tables, s.bronze.tables, s.silver.tables]), 1);
  }, [status?.sources]);
  const queueHeaderStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--bp-ink-muted)",
    borderBottom: "1px solid var(--bp-border)",
    background: "var(--bp-surface-1)",
    position: "sticky",
    top: 0,
    zIndex: 1,
    textAlign: "left",
  };
  const queueCellStyle: React.CSSProperties = {
    padding: "12px",
    fontSize: 12,
    color: "var(--bp-ink-secondary)",
    borderBottom: "1px solid var(--bp-border-subtle, var(--bp-border))",
    verticalAlign: "top",
    lineHeight: 1.55,
  };
  const controlStyle: React.CSSProperties = {
    background: "var(--bp-surface-inset)",
    border: "1px solid var(--bp-border)",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13,
    color: "var(--bp-ink-primary)",
    minWidth: 180,
  };

  return (
    <div className="bp-page-shell-wide space-y-4">
      <CompactPageHeader
        eyebrow="Load"
        title="Load Center"
        summary="Finish imports, inspect what is still missing across Landing, Bronze, and Silver, and understand exactly what the next completion run will do."
        meta={
          status?.scannedAt
            ? `Physical scan ${timeAgo(status.scannedAt)} · ${status.queryTimeSec}s query`
            : "The single place that finishes imports and reconciles missing layers"
        }
        guideItems={[
          {
            label: "What This Page Is",
            value: "Import completion console",
            detail: "Load Center is the operational workspace for finishing registered entities and reconciling what is still missing in Landing, Bronze, and Silver.",
          },
          {
            label: "Why It Matters",
            value: "Queue truth, not guesswork",
            detail: "This page should answer which entities are still incomplete, why they are incomplete, and whether the next run needs a full load, incremental recovery, or operator intervention.",
          },
          {
            label: "What Happens Next",
            value: "Plan, then execute",
            detail: "Review the outstanding queue, preview the completion plan when needed, then run the finish pass and hand off to Mission Control for live monitoring.",
          },
        ]}
        guideLinks={[
          { label: "Open Mission Control", to: "/load-mission-control" },
          { label: "Open Source Manager", to: "/sources" },
          { label: "Open Data Estate", to: "/estate" },
        ]}
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={handleRefresh}
              disabled={refreshing || status?.refreshRunning}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                border: "1px solid rgba(120,113,108,0.1)", background: "rgba(255,255,255,0.72)",
                color: "var(--bp-ink-secondary)", cursor: "pointer",
                opacity: refreshing ? 0.6 : 1,
              }}
            >
              <RefreshCw style={{ width: 14, height: 14, animation: refreshing ? "spin 1s linear infinite" : undefined }} />
              Refresh Counts
            </button>
            <button
              onClick={handleDryRun}
              disabled={runLoading || isRunning}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                border: "1px solid rgba(120,113,108,0.1)", background: "rgba(255,255,255,0.72)",
                color: "var(--bp-ink-secondary)", cursor: "pointer",
              }}
            >
              <Zap style={{ width: 14, height: 14 }} />
              Preview Plan
            </button>
            <button
              onClick={handleRun}
              disabled={runLoading || isRunning}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 999, fontSize: 12, fontWeight: 700,
                border: "none",
                background: isRunning ? "var(--bp-ink-muted)" : "var(--bp-copper, #c47a5a)",
                color: "#fff", cursor: isRunning ? "not-allowed" : "pointer",
              }}
            >
              {isRunning
                ? <><Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> Running...</>
                : <><Play style={{ width: 14, height: 14 }} /> {primaryActionLabel}</>
              }
            </button>
          </div>
        }
        facts={[
          { label: "Tables In Scope", value: tablesInScopeCount.toLocaleString(), tone: "accent" },
          { label: "Outstanding", value: (status?.outstandingCount ?? 0).toLocaleString(), tone: (status?.outstandingCount ?? 0) > 0 ? "warning" : "positive" },
          { label: "Downstream Gaps", value: (status?.gapCount ?? 0).toLocaleString(), tone: (status?.gapCount ?? 0) > 0 ? "warning" : "positive" },
          { label: "Daemon", value: selfHeal ? selfHealRuntimeTone.label : "Unavailable", tone: selfHeal ? "accent" : "neutral" },
        ]}
      />

      {/* Error banner */}
      {error && (
        <div style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>
          <XCircle style={{ width: 14, height: 14, display: "inline", verticalAlign: "middle", marginRight: 6 }} />
          {error}
        </div>
      )}

      {/* Run state banner */}
      {isRunning && runState && (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(196,122,90,0.08)", border: "1px solid rgba(196,122,90,0.2)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--bp-copper, #c47a5a)" }}>
            <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
            Load in progress — Phase: {runState.phase || "starting"}
            {runState.startedAt && <span style={{ fontWeight: 400, color: "var(--bp-ink-muted)", marginLeft: 8 }}>Started {timeAgo(runState.startedAt)}</span>}
          </div>
          {runState.plan && (
            <div style={{ fontSize: 12, color: "var(--bp-ink-muted)", marginTop: 4 }}>
              {runState.plan.fullLoadCount} full loads, {runState.plan.incrementalCount} incremental, {runState.plan.gapFillCount} gap fills
            </div>
          )}
        </div>
      )}

      {!isRunning && resumableEngineRunId && (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.18)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#b45309" }}>
            <AlertTriangle style={{ width: 14, height: 14 }} />
            Interrupted completion run detected
          </div>
          <div style={{ fontSize: 12, color: "var(--bp-ink-secondary)", marginTop: 4, lineHeight: 1.55 }}>
            The last completion pass already launched engine run <strong style={{ color: "var(--bp-ink-primary)" }}>{resumableEngineRunId.slice(0, 8)}</strong>. The primary action will resume that run instead of rebuilding the queue from scratch.
          </div>
        </div>
      )}

      {/* Run plan preview */}
      {runPlan && (
        <div style={{ padding: "16px", borderRadius: 8, background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--bp-ink-primary)" }}>Completion Plan Preview</div>
          <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
            <div><span style={{ fontWeight: 600 }}>{runPlan.plan.summary?.fullLoadCount ?? 0}</span> <span style={{ color: "var(--bp-ink-muted)" }}>full loads</span></div>
            <div><span style={{ fontWeight: 600 }}>{runPlan.plan.summary?.incrementalCount ?? 0}</span> <span style={{ color: "var(--bp-ink-muted)" }}>incremental</span></div>
            <div><span style={{ fontWeight: 600 }}>{runPlan.plan.summary?.gapFillCount ?? 0}</span> <span style={{ color: "var(--bp-ink-muted)" }}>gap fills</span></div>
            <div><span style={{ fontWeight: 600 }}>{runPlan.plan.summary?.needsOptimizeCount ?? 0}</span> <span style={{ color: "var(--bp-ink-muted)" }}>need optimization</span></div>
            <div><span style={{ fontWeight: 600 }}>{runPlan.plan.totalEntities}</span> <span style={{ color: "var(--bp-ink-muted)" }}>tables in scope</span></div>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button
              onClick={handleRun}
              style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: "none", background: "var(--bp-copper, #c47a5a)", color: "#fff", cursor: "pointer",
              }}
            >
              Confirm & Run
            </button>
            <button
              onClick={() => setRunPlan(null)}
              style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 13,
                border: "1px solid var(--bp-border)", background: "transparent", color: "var(--bp-ink-secondary)", cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status && (
        <div style={{ padding: "18px 20px", borderRadius: 12, background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(244,242,237,0.98) 100%)", border: "1px solid rgba(180,86,36,0.16)", marginBottom: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div style={{ maxWidth: 720 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--bp-copper)" }}>
                Import completion console
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--bp-ink-primary)", margin: "10px 0 0" }}>
                Stop guessing what is missing
              </h2>
              <p style={{ fontSize: 13, color: "var(--bp-ink-secondary)", margin: "10px 0 0", lineHeight: 1.65 }}>
                {status.outstandingCount.toLocaleString()} of {tablesInScopeCount.toLocaleString()} registered entities are still missing at least one clean layer. The queue below shows exactly what is missing, what the next load will do, and the latest recorded reason a prior attempt failed.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <span
                  title={vpnStatus?.error || vpnStatus?.note || undefined}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    background: vpnStatus?.connected ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
                    color: vpnStatus?.connected ? "#15803d" : "#b45309",
                  }}
                >
                  {vpnStatus?.connected
                    ? <CheckCircle2 style={{ width: 14, height: 14 }} />
                    : <AlertTriangle style={{ width: 14, height: 14 }} />
                  }
                  {vpnStatus
                    ? (vpnStatus.connected ? "VPN connected — landing-zone loads can reach source SQL servers." : vpnStatus.note || "VPN status unavailable.")
                    : "Checking VPN reachability…"}
                </span>
                {vpnStatus?.checkedAt && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, fontSize: 12, color: "var(--bp-ink-secondary)", background: "rgba(148,163,184,0.08)" }}>
                    Checked {timeAgo(vpnStatus.checkedAt)}
                  </span>
                )}
              </div>
              {(focusedEntityLabel || focusedGap) && (
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(180,86,36,0.08)", border: "1px solid rgba(180,86,36,0.16)", fontSize: 12, color: "var(--bp-ink-secondary)" }}>
                  <div>
                    Focused entity: <strong style={{ color: "var(--bp-ink-primary)" }}>{focusedEntityLabel}</strong>
                    {focusedMissingLayers.length > 0 ? ` is still missing ${focusedMissingLayers.join(" + ")}.` : " is in scope for completion review."}
                  </div>
                  {focusedEntityNote ? (
                    <div style={{ marginTop: 6, lineHeight: 1.55 }}>
                      {focusedEntityNote}
                    </div>
                  ) : null}
                  {focusedLayerStatus.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                      {focusedLayerStatus.map((layer) => (
                        <span
                          key={layer.label}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            background: layer.ready ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
                            color: layer.ready ? "#15803d" : "#b45309",
                          }}
                        >
                          {layer.label}: {layer.status || "pending"}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={handleRun}
                disabled={runLoading || isRunning}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "10px 16px", borderRadius: 999,
                  fontSize: 13, fontWeight: 600,
                  border: "none",
                  background: isRunning ? "var(--bp-ink-muted)" : "var(--bp-copper, #c47a5a)",
                  color: "#fff", cursor: isRunning ? "not-allowed" : "pointer",
                }}
              >
                {isRunning ? <><Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> Running...</> : <><Play style={{ width: 14, height: 14 }} /> {primaryActionLongLabel}</>}
              </button>
              <button
                onClick={handleDryRun}
                disabled={runLoading || isRunning}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "10px 16px", borderRadius: 999,
                  fontSize: 13, fontWeight: 600,
                  border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)",
                  color: "var(--bp-ink-secondary)", cursor: "pointer",
                }}
              >
                <Zap style={{ width: 14, height: 14 }} />
                Preview Completion Plan
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
            {[
              { label: "Missing Landing", value: missingLandingCount, detail: "Registered entities whose latest landing state is not loaded.", accent: missingLandingCount > 0 ? "#ef4444" : "#22c55e" },
              { label: "Missing Bronze", value: missingBronzeCount, detail: "Entities still blocked before bronze is usable.", accent: missingBronzeCount > 0 ? "#f59e0b" : "#22c55e" },
              { label: "Missing Silver", value: missingSilverCount, detail: "Entities still blocked before silver is usable.", accent: missingSilverCount > 0 ? "#f59e0b" : "#22c55e" },
              { label: "Outstanding Queue", value: status.outstandingCount, detail: "Registered entities still missing at least one clean layer.", accent: status.outstandingCount > 0 ? "#ef4444" : "#22c55e" },
              { label: "Full Loads Next", value: completionSummary?.fullLoadCount ?? 0, detail: "Entities the next run must reseed from source.", accent: (completionSummary?.fullLoadCount ?? 0) > 0 ? "#f59e0b" : "#22c55e" },
              { label: "Incremental Next", value: completionSummary?.incrementalCount ?? 0, detail: "Entities the next run can advance via watermark.", accent: (completionSummary?.incrementalCount ?? 0) > 0 ? "#15803d" : "#22c55e" },
            ].map((item) => (
              <div key={item.label} style={{ border: "1px solid rgba(91,84,76,0.10)", borderRadius: 12, background: "rgba(255,255,255,0.86)", padding: "14px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--bp-ink-muted)" }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: item.accent, marginTop: 6, lineHeight: 1.1 }}>
                  {item.value.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: "var(--bp-ink-secondary)", marginTop: 6, lineHeight: 1.55 }}>
                  {item.detail}
                </div>
              </div>
            ))}
          </div>

          {(outstandingEntities.length > 0 || (showSelfHealPanel && selfHeal)) && (
            <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 16 }}>
              {outstandingEntities.length > 0 && (
                <div style={{ flex: "1 1 860px", minWidth: 0, border: "1px solid rgba(91,84,76,0.10)", borderRadius: 12, background: "rgba(255,255,255,0.86)", padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                  Outstanding entity queue
                </div>
                <div style={{ fontSize: 11, color: "var(--bp-ink-muted)" }}>
                  Showing {filteredOutstanding.length.toLocaleString()} of {status.outstandingCount.toLocaleString()}
                </div>
              </div>
              <p style={{ fontSize: 12, color: "var(--bp-ink-secondary)", lineHeight: 1.6, margin: "0 0 12px" }}>
                This queue is the load truth. It is sorted with the most recent recorded issue first. When an entity has no captured error, the missing layer is still real, but it is inferred from the latest successful layer map rather than a terminal failure log.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                <div style={{ position: "relative", flex: "1 1 260px", minWidth: 220 }}>
                  <Search style={{ width: 14, height: 14, color: "var(--bp-ink-muted)", position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
                  <input
                    value={queueSearch}
                    onChange={(event) => setQueueSearch(event.target.value)}
                    placeholder="Search source, table, reason, or prior failure…"
                    style={{ ...controlStyle, width: "100%", paddingLeft: 32 }}
                  />
                </div>
                <select value={queueSourceFilter} onChange={(event) => setQueueSourceFilter(event.target.value)} style={controlStyle}>
                  <option value="all">All sources</option>
                  {outstandingSourceOptions.map((source) => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </select>
                <select value={queueLayerFilter} onChange={(event) => setQueueLayerFilter(event.target.value)} style={controlStyle}>
                  <option value="all">Any missing layer</option>
                  <option value="landing">Missing landing</option>
                  <option value="bronze">Missing bronze</option>
                  <option value="silver">Missing silver</option>
                </select>
                <select value={queueIssueFilter} onChange={(event) => setQueueIssueFilter(event.target.value as "all" | "withIssue" | "withoutIssue")} style={controlStyle}>
                  <option value="all">All telemetry states</option>
                  <option value="withIssue">Has recorded failure</option>
                  <option value="withoutIssue">No recorded failure</option>
                </select>
              </div>
              <div style={{ maxHeight: 720, overflowY: "auto", border: "1px solid var(--bp-border)", borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={queueHeaderStyle}>Entity</th>
                      <th style={queueHeaderStyle}>Missing / Layer Status</th>
                      <th style={queueHeaderStyle}>What Load Will Do</th>
                      <th style={queueHeaderStyle}>Why</th>
                      <th style={queueHeaderStyle}>Latest Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOutstanding.map((entity) => (
                      <tr key={`${entity.source}.${entity.schema}.${entity.table}`} style={{ background: entity.latestIssue ? "rgba(255,248,235,0.55)" : undefined }}>
                        <td style={queueCellStyle}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--bp-ink-primary)" }}>{entity.table}</div>
                          <div style={{ fontSize: 11, color: "var(--bp-ink-secondary)", marginTop: 2 }}>
                            {entity.source} · {entity.schema} · entity {entity.entityId}
                          </div>
                        </td>
                        <td style={queueCellStyle}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {entity.missingIn.map((layer) => (
                              <span
                                key={`${entity.entityId}-${layer}`}
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  background: "rgba(239,68,68,0.12)",
                                  color: "#b91c1c",
                                }}
                              >
                                Missing {layerLabel(layer)}
                              </span>
                            ))}
                            {entity.missingRegistrations.map((layer) => (
                              <span
                                key={`${entity.entityId}-register-${layer}`}
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  background: "rgba(245,158,11,0.12)",
                                  color: "#b45309",
                                }}
                              >
                                Register {layerLabel(layer)}
                              </span>
                            ))}
                            {entity.needsOptimize && (
                              <span style={{ padding: "4px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: "rgba(59,130,246,0.12)", color: "#1d4ed8" }}>
                                Needs watermark review
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {Object.entries(entity.layerStatus).map(([layer, layerStatus]) => {
                              const tone = statusTone(layerStatus);
                              return (
                                <span
                                  key={`${entity.entityId}-${layer}-status`}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    background: tone.background,
                                    color: tone.color,
                                  }}
                                >
                                  {layerLabel(layer)}: {layerStatus.replaceAll("_", " ")}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td style={queueCellStyle}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                            {entity.nextActionLabel || "Pending plan"}
                          </div>
                          <div style={{ marginTop: 4 }}>
                            {entity.actionSummary || "No action summary available yet."}
                          </div>
                        </td>
                        <td style={queueCellStyle}>
                          <div>{entity.planReason || "No plan reason was captured for this entity."}</div>
                        </td>
                        <td style={queueCellStyle}>
                          {entity.selfHealCase && (
                            <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.16)" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8" }}>
                                  Self-heal {entity.selfHealCase.status.replaceAll("_", " ")}
                                </span>
                                <span style={{ fontSize: 11, color: "var(--bp-ink-secondary)" }}>
                                  case {entity.selfHealCase.id} · attempt {entity.selfHealCase.attemptCount}/{entity.selfHealCase.maxAttempts}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: "var(--bp-ink-secondary)", marginTop: 4, lineHeight: 1.5 }}>
                                {entity.selfHealCase.events[0]?.message || "Queued for bounded CLI-driven self-heal."}
                              </div>
                            </div>
                          )}
                          {entity.latestIssue ? (
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                                <AlertTriangle style={{ width: 14, height: 14, color: "#b45309", flexShrink: 0 }} />
                                {layerLabel(entity.latestIssue.layer)} · {entity.latestIssue.status.replaceAll("_", " ")}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--bp-ink-muted)", marginTop: 4 }}>
                                {entity.latestIssue.at ? `${timeAgo(entity.latestIssue.at)} · ` : ""}run {shortRunId(entity.latestIssue.runId)}
                              </div>
                              <div title={entity.latestIssue.message || undefined} style={{ marginTop: 6 }}>
                                {truncateText(entity.latestIssue.message, 220)}
                              </div>
                            </div>
                          ) : (
                            <div style={{ color: "var(--bp-ink-muted)" }}>
                              No recorded failure. Missing state is inferred from the latest successful telemetry and still needs operator review.
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredOutstanding.length === 0 && (
                  <div style={{ padding: "20px 16px", fontSize: 12, color: "var(--bp-ink-muted)" }}>
                    No entities match the current queue filters.
                  </div>
                )}
              </div>
                </div>
              )}
              {showSelfHealPanel && selfHeal && (
                <LoadCenterSelfHealRail
                  selfHeal={selfHeal}
                  runtimeTone={selfHealRuntimeTone}
                  stepState={selfHealStepState}
                  activeCase={activeSelfHealCase}
                  expanded={selfHealExpanded}
                  onToggle={() => setSelfHealExpanded((value) => !value)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && !status && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 40, justifyContent: "center", color: "var(--bp-ink-muted)" }}>
          <Loader2 style={{ width: 18, height: 18, animation: "spin 1s linear infinite" }} /> Loading physical counts...
        </div>
      )}

      {/* Empty state — sources exist but nothing has been loaded yet */}
      {!loading && status && totals && totals.lz?.tables === 0 && totals.bronze?.tables === 0 && totals.silver?.tables === 0 && (
        <div style={{
          padding: "48px 32px",
          textAlign: "center",
          background: "var(--bp-surface-1)",
          border: "1px solid var(--bp-border)",
          borderRadius: 12,
        }}>
          <Database style={{ width: 40, height: 40, color: "var(--bp-ink-muted)", margin: "0 auto 16px", opacity: 0.5 }} />
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--bp-ink-primary)", margin: "0 0 8px" }}>
            No loaded sources yet
          </h2>
          <p style={{ fontSize: 14, color: "var(--bp-ink-muted)", maxWidth: 480, margin: "0 auto 20px", lineHeight: 1.6 }}>
            Nothing has completed the managed import path yet. Use this page to preview the completion plan or finish the outstanding entities once registration is in place.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={handleDryRun}
              disabled={runLoading}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500,
                border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)",
                color: "var(--bp-ink-secondary)", cursor: "pointer",
              }}
            >
              <Zap style={{ width: 14, height: 14 }} />
              Preview Completion Plan
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500,
                border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)",
                color: "var(--bp-ink-secondary)", cursor: "pointer",
              }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} />
              Refresh from SQL Endpoint
            </button>
          </div>
        </div>
      )}

      {/* KPI row */}
      {totals && (
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <KPI label="Landing Zone" value={fmt(totals.lz?.tables)} sub={rowSubLabel(totals.lz)} accent="#3b82f6" />
          <KPI label="Bronze" value={fmt(totals.bronze?.tables)} sub={rowSubLabel(totals.bronze)} accent="#f59e0b" />
          <KPI label="Silver" value={fmt(totals.silver?.tables)} sub={rowSubLabel(totals.silver)} accent="#8b5cf6" />
          <KPI
            label="Downstream Gaps"
            value={fmt(status?.gapCount ?? 0)}
            sub={status?.gapCount ? "landing succeeded but bronze or silver is still missing" : "no landing → silver gaps in registered scope"}
            accent={status?.gapCount ? "#ef4444" : "#22c55e"}
          />
          <KPI
            label="Tool Ready"
            value={fmt(status?.toolReadyCount ?? 0)}
            sub="registered entities loaded across landing, bronze, and silver"
            accent="#22c55e"
          />
          <KPI label="Sources" value={fmt(status?.sources?.length ?? 0)} />
        </div>
      )}

      {/* Explainer when layer counts differ */}
      {status && status.gapCount > 0 && (
        <div style={{
          background: "rgba(245, 158, 11, 0.06)",
          border: "1px solid rgba(245, 158, 11, 0.2)",
          borderRadius: 8,
          padding: "14px 18px",
          marginBottom: 20,
          fontSize: 13,
          color: "var(--bp-ink-secondary)",
          lineHeight: 1.6,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <AlertTriangle style={{ width: 18, height: 18, color: "#f59e0b", flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ color: "var(--bp-ink-primary)" }}>Why do table counts differ across layers?</strong>
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18 }}>
                <li><strong>Table counts</strong> differ when entities failed during Bronze or Silver processing (schema issues, Delta merge errors) — expand a source and look for red <AlertTriangle style={{ width: 12, height: 12, color: "#ef4444", display: "inline", verticalAlign: "middle" }} /> icons to see which.</li>
                <li><strong>Row counts</strong> should differ: Silver uses SCD Type 2, so it keeps historical versions of changed rows — Silver rows will naturally be &ge; Bronze rows over time.</li>
                <li><strong>The downstream gap count is a subset</strong> of the broader outstanding queue above. Landing failures and inferred missing layers are still real work even when they are not part of the landing → silver gap slice.</li>
              </ul>
              {status.scannedAt && (
                <div style={{ fontSize: 11, color: "var(--bp-ink-muted)", marginTop: 6 }}>
                  Counts last scanned {timeAgo(status.scannedAt)}. Hit <strong>Refresh</strong> to rescan from OneLake.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sources table */}
      {status?.sources && status.sources.length > 0 && (
        <div style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* Header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, 1fr) repeat(3, minmax(100px, 180px)) 60px",
              padding: "10px 16px",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--bp-ink-muted)",
              borderBottom: "1px solid var(--bp-border)",
              background: "var(--bp-surface-inset)",
            }}
          >
            <div>Source</div>
            <div style={{ textAlign: "right" }}>Landing Zone</div>
            <div style={{ textAlign: "right" }}>Bronze</div>
            <div style={{ textAlign: "right" }}>Silver</div>
            <div />
          </div>

          {/* Rows */}
          {status.sources.map(src => {
            const isExpanded = expandedSource === src.name;
            const hasGap = status.gaps.some(g => g.source.toLowerCase() === src.name.toLowerCase());
            return (
              <div key={src.name}>
                <div
                  onClick={() => toggleSource(src.name)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(180px, 1fr) repeat(3, minmax(100px, 180px)) 60px",
                    padding: "12px 16px",
                    fontSize: 14,
                    cursor: "pointer",
                    borderBottom: "1px solid var(--bp-border-subtle, var(--bp-border))",
                    background: isExpanded ? "var(--bp-surface-2, rgba(0,0,0,0.02))" : undefined,
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "var(--bp-surface-2, rgba(0,0,0,0.02))"; }}
                  onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = ""; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isExpanded ? <ChevronDown style={{ width: 16, height: 16 }} /> : <ChevronRight style={{ width: 16, height: 16 }} />}
                    <Database style={{ width: 16, height: 16, color: "var(--bp-copper, #c47a5a)" }} />
                    <span style={{ fontWeight: 600 }}>{src.displayName}</span>
                    {hasGap && <AlertTriangle style={{ width: 14, height: 14, color: "#ef4444", marginLeft: 4 }} />}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontWeight: 600 }}>{src.lz.tables}</span>
                    <span style={{ color: "var(--bp-ink-muted)", fontSize: 12, marginLeft: 6 }}>{fmtCompact(src.lz.rows)}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontWeight: 600 }}>{src.bronze.tables}</span>
                    <span style={{ color: "var(--bp-ink-muted)", fontSize: 12, marginLeft: 6 }}>{fmtCompact(src.bronze.rows)}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontWeight: 600 }}>{src.silver.tables}</span>
                    <span style={{ color: "var(--bp-ink-muted)", fontSize: 12, marginLeft: 6 }}>{fmtCompact(src.silver.rows)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                    {src.lz.tables === src.bronze.tables && src.bronze.tables === src.silver.tables ? (
                      <CheckCircle2 style={{ width: 16, height: 16, color: "#22c55e" }} />
                    ) : (
                      <span title={`LZ: ${src.lz.tables}, Bronze: ${src.bronze.tables}, Silver: ${src.silver.tables} — ${Math.abs(src.lz.tables - Math.min(src.bronze.tables, src.silver.tables))} tables missing from downstream layers`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle style={{ width: 16, height: 16, color: "#f59e0b" }} />
                        <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 500 }}>
                          {src.lz.tables - Math.min(src.bronze.tables, src.silver.tables) > 0
                            ? `-${src.lz.tables - Math.min(src.bronze.tables, src.silver.tables)}`
                            : "gaps"}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ padding: "16px 20px 20px 48px", borderBottom: "1px solid var(--bp-border)", background: "var(--bp-surface-2, rgba(0,0,0,0.01))" }}>
                    {/* Layer bars */}
                    <div style={{ marginBottom: 16 }}>
                      <LayerBar label="LZ" layer={src.lz} maxTables={maxTables} color="#3b82f6" />
                      <LayerBar label="Bronze" layer={src.bronze} maxTables={maxTables} color="#f59e0b" />
                      <LayerBar label="Silver" layer={src.silver} maxTables={maxTables} color="#8b5cf6" />
                    </div>

                    {/* Table detail */}
                    {detailLoading
                      ? <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--bp-ink-muted)", fontSize: 13 }}><Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> Loading table details...</div>
                      : sourceDetail && sourceDetail.source === src.name
                        ? <SourceDetailTable detail={sourceDetail} />
                        : null
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Gaps section */}
      {status && status.gapCount > 0 && (
        <div style={{ marginTop: 24, padding: "16px", borderRadius: 8, background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#ef4444", marginBottom: 8 }}>
            <AlertTriangle style={{ width: 16, height: 16, display: "inline", verticalAlign: "middle", marginRight: 6 }} />
            {status.gapCount} Downstream Gaps Detected
          </div>
          <p style={{ fontSize: 12, color: "var(--bp-ink-muted)", margin: "0 0 8px" }}>
            These tables have a clean landing result but are still missing from Bronze and/or Silver. This is a narrower subset of the full outstanding queue above.
          </p>
          <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 12 }}>
            {status.gaps.slice(0, 50).map((g, i) => (
              <div key={i} style={{ padding: "4px 0", display: "flex", gap: 12 }}>
                <span style={{ fontWeight: 500, minWidth: 80 }}>{g.source}</span>
                <span style={{ color: "var(--bp-ink-secondary)" }}>{g.schema}.{g.table}</span>
                <span style={{ color: "#ef4444" }}>missing: {g.missingIn.join(", ")}</span>
              </div>
            ))}
            {status.gapCount > 50 && <div style={{ color: "var(--bp-ink-muted)", padding: "4px 0" }}>...and {status.gapCount - 50} more</div>}
          </div>
        </div>
      )}

      {/* CSS for spin animation */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
