import { useEffect, useState, useCallback, useMemo } from "react";
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

interface StatusResponse {
  sources: SourceSummary[];
  totals: Record<string, LayerSummary>;
  gapCount: number;
  gaps: Array<{ source: string; schema: string; table: string; missingIn: string[] }>;
  totalRegistered: number;
  unmatchedCount: number;
  dataSource: string;
  scannedAt: string | null;
  refreshRunning: boolean;
  runState: RunState;
  queryTimeSec: number;
}

interface RunState {
  active: boolean;
  startedAt?: string;
  completedAt?: string;
  phase?: string;
  error?: string;
  plan?: { fullLoadCount: number; incrementalCount: number; gapFillCount: number; needsOptimizeCount: number };
  progress?: Record<string, unknown>;
}

interface RunPlan {
  dryRun: boolean;
  plan: {
    summary: RunState["plan"];
    fullLoad: Array<{ entityId: number; source: string; schema: string; table: string; reason: string }>;
    incremental: Array<{ entityId: number; source: string; schema: string; table: string }>;
    gapFill: Array<{ entityId: number; source: string; schema: string; table: string }>;
    needsOptimize: Array<{ entityId: number; source: string; schema: string; table: string }>;
    totalEntities: number;
  };
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

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function LoadCenter() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [sourceDetail, setSourceDetail] = useState<SourceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [runPlan, setRunPlan] = useState<RunPlan | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Auto-refresh while a run is active
  useEffect(() => {
    if (!status?.runState?.active) return;
    const iv = setInterval(() => loadStatus(), 5000);
    return () => clearInterval(iv);
  }, [status?.runState?.active, loadStatus]);

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
      await postJson("/load-center/run", { dryRun: false });
      // Refresh status to pick up run state
      await loadStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Run failed");
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
  const maxTables = useMemo(() => {
    if (!status?.sources) return 1;
    return Math.max(...status.sources.flatMap(s => [s.lz.tables, s.bronze.tables, s.silver.tables]), 1);
  }, [status?.sources]);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--bp-ink-primary)", margin: 0 }}>Load Center</h1>
          <p style={{ fontSize: 13, color: "var(--bp-ink-muted)", margin: "4px 0 0" }}>
            Successfully loaded tables and rows from engine run history.
            {status?.scannedAt && <> Physical scan: {timeAgo(status.scannedAt)}.</>}
            {status && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--bp-ink-muted)" }}>({status.queryTimeSec}s)</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleRefresh}
            disabled={refreshing || status?.refreshRunning}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 6, fontSize: 13, fontWeight: 500,
              border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)",
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
              padding: "8px 14px", borderRadius: 6, fontSize: 13, fontWeight: 500,
              border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)",
              color: "var(--bp-ink-secondary)", cursor: "pointer",
            }}
          >
            <Zap style={{ width: 14, height: 14 }} />
            Preview Run
          </button>
          <button
            onClick={handleRun}
            disabled={runLoading || isRunning}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600,
              border: "none",
              background: isRunning ? "var(--bp-ink-muted)" : "var(--bp-copper, #c47a5a)",
              color: "#fff", cursor: isRunning ? "not-allowed" : "pointer",
            }}
          >
            {isRunning
              ? <><Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> Running...</>
              : <><Play style={{ width: 14, height: 14 }} /> Load Everything</>
            }
          </button>
        </div>
      </div>

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

      {/* Run plan preview */}
      {runPlan && (
        <div style={{ padding: "16px", borderRadius: 8, background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--bp-ink-primary)" }}>Load Plan Preview</div>
          <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
            <div><span style={{ fontWeight: 600 }}>{runPlan.plan.summary?.fullLoadCount ?? 0}</span> <span style={{ color: "var(--bp-ink-muted)" }}>full loads</span></div>
            <div><span style={{ fontWeight: 600 }}>{runPlan.plan.summary?.incrementalCount ?? 0}</span> <span style={{ color: "var(--bp-ink-muted)" }}>incremental</span></div>
            <div><span style={{ fontWeight: 600 }}>{runPlan.plan.summary?.gapFillCount ?? 0}</span> <span style={{ color: "var(--bp-ink-muted)" }}>gap fills</span></div>
            <div><span style={{ fontWeight: 600 }}>{runPlan.plan.summary?.needsOptimizeCount ?? 0}</span> <span style={{ color: "var(--bp-ink-muted)" }}>need optimization</span></div>
            <div><span style={{ fontWeight: 600 }}>{runPlan.plan.totalEntities}</span> <span style={{ color: "var(--bp-ink-muted)" }}>total entities</span></div>
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
            The Load Center shows table and row counts from engine run history.
            Register entities in the Source Manager, then run a load to see data here.
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
              Preview Run
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
            label="Gaps"
            value={fmt(status?.gapCount ?? 0)}
            sub={status?.gapCount ? "tables missing from layers" : "all layers in sync"}
            accent={status?.gapCount ? "#ef4444" : "#22c55e"}
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
            {status.gapCount} Table Gaps Detected
          </div>
          <p style={{ fontSize: 12, color: "var(--bp-ink-muted)", margin: "0 0 8px" }}>
            These tables exist in Landing Zone but are missing from Bronze and/or Silver. Click "Load Everything" to fill these gaps automatically.
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
