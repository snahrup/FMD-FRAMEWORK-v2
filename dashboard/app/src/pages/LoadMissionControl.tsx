/**
 * Load Mission Control — the single source of truth for load monitoring.
 *
 * Replaces the old LoadProgress page. Every section is backed by real data
 * from /api/lmc/* endpoints, with physical verification from lakehouse_row_counts.
 *
 * Packets:
 *   B — Run Header + KPI strip + Run selector + Start/Stop
 *   C — Layer Progress Lanes (LZ → Bronze → Silver)
 *   D — Live Event Stream (SSE from /api/engine/logs/stream)
 *   E — Entity table with verification + drill-down
 *   F — Error breakdown + optimization visibility
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp,
  CheckCircle2, ChevronDown, ChevronRight, Clock, Database,
  Filter, Layers, Loader2, Play, RefreshCw, Search,
  Server, ShieldCheck, ShieldX, Square, Timer,
  X, XCircle, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSourceConfig } from "@/hooks/useSourceConfig";

// ═══════════════════════════════════════════════════════════════════════════
// Types — matched exactly to backend response shapes (proven via test)
// ═══════════════════════════════════════════════════════════════════════════

interface LmcRun {
  runId: string;
  mode: string;
  status: string;
  totalEntities: number;
  layers: string;
  triggeredBy: string;
  startedAt: string | null;
  endedAt: string | null;
  errorSummary: string;
}

interface LayerStats {
  succeeded: number;
  failed: number;
  skipped: number;
  total_rows_read: number;
  total_rows_written: number;
  total_bytes: number;
  total_duration: number;
  avg_duration: number;
  unique_entities: number;
}

interface SourceProgress {
  source: string;
  total_entities: number;
  succeeded: number;
  failed: number;
  skipped: number;
  rows_read: number;
  bytes: number;
}

interface Verification {
  total_active: number;
  lz_verified: number;
  brz_verified: number;
  slv_verified: number;
  lz_last_scan: string | null;
  brz_last_scan: string | null;
}

interface LakehouseLayerState {
  tablesWithData: number;
  emptyTables: number;
  scanFailed: number;
  totalRows: number;
  totalBytes: number;
  lastScan: string | null;
}

interface LakehouseBySourceItem {
  lakehouse: string;
  source: string;
  tables_loaded: number;
  total_rows: number;
}

interface LmcProgressResponse {
  run: LmcRun | null;
  totalActiveEntities: number;
  layers: Record<string, LayerStats>;
  bySource: SourceProgress[];
  errorBreakdown: Array<{ ErrorType: string; cnt: number }>;
  loadTypeBreakdown: Array<{ LoadType: string; cnt: number; total_rows: number }>;
  throughput: { rows_per_sec: number; bytes_per_sec: number };
  verification: Verification;
  lakehouseState: Record<string, LakehouseLayerState>;
  lakehouseBySource: LakehouseBySourceItem[];
  serverTime: string;
}

interface RunListItem {
  RunId: string;
  Mode: string;
  Status: string;
  TotalEntities: number;
  Layers: string;
  TriggeredBy: string;
  ErrorSummary: string;
  StartedAt: string | null;
  EndedAt: string | null;
  TotalDurationSeconds: number;
  actualSucceeded: number;
  actualFailed: number;
  actualSkipped: number;
  totalRowsRead: number;
  totalBytes: number;
  totalTaskLogs: number;
}

interface TaskEntity {
  id: number;
  EntityId: number;
  Layer: string;
  Status: string;
  SourceServer: string;
  SourceDatabase: string;
  SourceTable: string;
  RowsRead: number;
  RowsWritten: number;
  BytesTransferred: number;
  DurationSeconds: number;
  LoadType: string;
  WatermarkColumn: string;
  WatermarkBefore: string;
  WatermarkAfter: string;
  ErrorType: string;
  ErrorMessage: string;
  ErrorSuggestion: string;
  SourceQuery: string;
  created_at: string;
  source: string;
  lz_physical_rows: number | null;
  lz_scanned_at: string | null;
  brz_physical_rows: number | null;
  brz_scanned_at: string | null;
  slv_physical_rows: number | null;
  slv_scanned_at: string | null;
}

interface EntityResponse {
  entities: TaskEntity[];
  total: number;
  limit: number;
  offset: number;
}

interface SseLogEvent {
  timestamp: string;
  level: string;
  message: string;
  run_id?: string;
  entity_id?: number;
  layer?: string;
  status?: string;
  rows?: number;
  duration?: number;
  table?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds === 0) return "--";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "--";
  const diff = (Date.now() - new Date(dateStr + (dateStr.endsWith("Z") ? "" : "Z")).getTime()) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "succeeded": case "inprogress": return "var(--bp-operational)";
    case "failed": return "var(--bp-fault)";
    case "aborted": return "var(--bp-caution)";
    case "skipped": return "var(--bp-ink-muted)";
    default: return "var(--bp-ink-tertiary)";
  }
}

function runStatusBadge(status: string) {
  const s = status.toLowerCase();
  const styles: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    inprogress: { bg: "var(--bp-operational-light)", text: "var(--bp-operational)", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    succeeded: { bg: "var(--bp-operational-light)", text: "var(--bp-operational)", icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { bg: "var(--bp-fault-light)", text: "var(--bp-fault)", icon: <XCircle className="h-3 w-3" /> },
    aborted: { bg: "var(--bp-caution-light)", text: "var(--bp-caution)", icon: <AlertTriangle className="h-3 w-3" /> },
  };
  const st = styles[s] || { bg: "var(--bp-surface-inset)", text: "var(--bp-ink-tertiary)", icon: <Clock className="h-3 w-3" /> };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: st.bg, color: st.text }}>
      {st.icon} {status}
    </span>
  );
}

/** Physical verification badge for an entity row */
function verificationBadge(physicalRows: number | null, scannedAt: string | null) {
  if (physicalRows == null) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
        style={{ color: "var(--bp-ink-muted)", backgroundColor: "var(--bp-surface-inset)" }}
        title="No lakehouse scan data — table not found in physical scan">
        <ShieldX className="h-3 w-3" /> Not found
      </span>
    );
  }
  if (physicalRows <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
        style={{ color: "var(--bp-caution)", backgroundColor: "var(--bp-caution-light)" }}
        title={`Table present but no rows confirmed. Scanned: ${scannedAt || "unknown"}`}>
        <AlertTriangle className="h-3 w-3" /> Unconfirmed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={{ color: "var(--bp-operational)", backgroundColor: "var(--bp-operational-light)" }}
      title={`${formatNumber(physicalRows)} rows physically confirmed. Scanned: ${scannedAt || "unknown"}`}>
      <ShieldCheck className="h-3 w-3" /> {formatNumber(physicalRows)}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export default function LoadMissionControl() {
  const { resolveLabel, getColor } = useSourceConfig();

  // ── State ──
  const [progress, setProgress] = useState<LmcProgressResponse | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [entities, setEntities] = useState<TaskEntity[]>([]);
  const [entityTotal, setEntityTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Entity table controls
  const [entityFilter, setEntityFilter] = useState<{ source?: string; status?: string; layer?: string; search?: string }>({});
  const [entitySort, setEntitySort] = useState<{ col: string; order: "asc" | "desc" }>({ col: "created_at", order: "desc" });
  const [entityOffset, setEntityOffset] = useState(0);
  const [expandedEntity, setExpandedEntity] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"entities" | "events" | "errors">("entities");

  // SSE
  const [sseEvents, setSseEvents] = useState<SseLogEvent[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  // Run selector
  const [runDropdownOpen, setRunDropdownOpen] = useState(false);

  // ── Fetch progress ──
  const fetchProgress = useCallback(async (runId?: string): Promise<LmcProgressResponse | null> => {
    try {
      const qs = runId ? `?run_id=${runId}` : "";
      const resp = await fetch(`/api/lmc/progress${qs}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: LmcProgressResponse = await resp.json();
      setProgress(data);
      if (data.run && !selectedRunId) {
        setSelectedRunId(data.run.runId);
      }
      setError(null);
      setLastRefresh(new Date());
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch progress");
      return null;
    } finally {
      setLoading(false);
    }
  }, [selectedRunId]);

  // ── Fetch runs ──
  const fetchRuns = useCallback(async () => {
    try {
      const resp = await fetch("/api/lmc/runs?limit=20");
      if (!resp.ok) return;
      const data = await resp.json();
      setRuns(data.runs || []);
    } catch { /* silent */ }
  }, []);

  // ── Fetch entities ──
  const fetchEntities = useCallback(async (runId: string) => {
    try {
      const params = new URLSearchParams();
      if (entityFilter.source) params.set("source", entityFilter.source);
      if (entityFilter.status) params.set("status", entityFilter.status);
      if (entityFilter.layer) params.set("layer", entityFilter.layer);
      if (entityFilter.search) params.set("search", entityFilter.search);
      params.set("sort", entitySort.col);
      params.set("order", entitySort.order);
      params.set("limit", "100");
      params.set("offset", String(entityOffset));

      const resp = await fetch(`/api/lmc/run/${runId}/entities?${params}`);
      if (!resp.ok) {
        console.error(`[LMC] Entity fetch failed: HTTP ${resp.status} for run ${runId}`);
        return;
      }
      const data: EntityResponse = await resp.json();
      setEntities(data.entities || []);
      setEntityTotal(data.total || 0);
    } catch (err) {
      console.error("[LMC] Entity fetch error:", err);
    }
  }, [entityFilter, entitySort, entityOffset]);

  // ── SSE connection ──
  const connectSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
    }
    try {
      const es = new EventSource("/api/engine/logs/stream");
      es.onopen = () => setSseConnected(true);
      es.onmessage = (e) => {
        try {
          const evt: SseLogEvent = JSON.parse(e.data);
          setSseEvents(prev => [evt, ...prev].slice(0, 500));
        } catch { /* ignore malformed */ }
      };
      es.onerror = () => {
        setSseConnected(false);
        es.close();
        // Reconnect after 5s
        setTimeout(connectSse, 5000);
      };
      sseRef.current = es;
    } catch {
      setSseConnected(false);
    }
  }, []);

  // ── Engine start/stop/retry ──
  const [engineBusy, setEngineBusy] = useState(false);

  const startEngine = useCallback(async () => {
    setEngineBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/engine/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layers: ["landing", "bronze", "silver"], mode: "run", triggered_by: "mission_control" }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      // Switch to Live Events tab and refresh
      setActiveTab("events");
      setTimeout(() => { fetchProgress(); fetchRuns(); setEngineBusy(false); }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start engine");
      setEngineBusy(false);
    }
  }, [fetchProgress, fetchRuns]);

  const stopEngine = useCallback(async () => {
    setEngineBusy(true);
    try {
      await fetch("/api/engine/stop", { method: "POST" });
      setTimeout(() => { fetchProgress(); fetchRuns(); setEngineBusy(false); }, 1500);
    } catch {
      setEngineBusy(false);
    }
  }, [fetchProgress, fetchRuns]);

  const retryFailed = useCallback(async () => {
    if (!selectedRunId) return;
    setEngineBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/engine/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: selectedRunId }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      setActiveTab("events");
      setTimeout(() => { fetchProgress(); fetchRuns(); setEngineBusy(false); }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry");
      setEngineBusy(false);
    }
  }, [selectedRunId, fetchProgress, fetchRuns]);

  // ── Effects ──
  useEffect(() => {
    async function init() {
      const data = await fetchProgress();
      fetchRuns();
      // Chain entity fetch — don't rely on selectedRunId state update timing
      if (data?.run?.runId) {
        fetchEntities(data.run.runId);
      }
      connectSse();
    }
    init();
    return () => { sseRef.current?.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(() => {
      fetchProgress(selectedRunId || undefined);
      if (selectedRunId) fetchEntities(selectedRunId);
    }, refreshInterval * 1000);
    return () => clearInterval(iv);
  }, [autoRefresh, refreshInterval, selectedRunId, fetchProgress, fetchEntities]);

  // Fetch entities when run or filters change
  useEffect(() => {
    if (selectedRunId) fetchEntities(selectedRunId);
  }, [selectedRunId, entityFilter, entitySort, entityOffset, fetchEntities]);

  // ── Derived ──
  const run = progress?.run;
  const isRunning = run?.status?.toLowerCase() === "inprogress";
  const layers = progress?.layers || {};
  const layerOrder = ["landing", "bronze", "silver"];
  const layerLabels: Record<string, string> = { landing: "Landing Zone", bronze: "Bronze", silver: "Silver" };
  const layerTokens: Record<string, string> = { landing: "var(--bp-copper)", bronze: "var(--bp-bronze)", silver: "var(--bp-silver)" };
  // Map frontend layer keys to physical lakehouse names in lakehouse_row_counts
  const layerToLakehouse: Record<string, string> = { landing: "LH_DATA_LANDINGZONE", bronze: "LH_BRONZE_LAYER", silver: "LH_SILVER_LAYER" };
  const lhState = progress?.lakehouseState || {};

  // Totals across all layers for this run
  const totalSucceeded = Object.values(layers).reduce((s, l) => s + l.succeeded, 0);
  const totalFailed = Object.values(layers).reduce((s, l) => s + l.failed, 0);
  const totalRows = Object.values(layers).reduce((s, l) => s + l.total_rows_read, 0);
  const totalPending = (progress?.totalActiveEntities || 0) - totalSucceeded - totalFailed;

  // Wall clock duration (not sum of parallel tasks)
  const wallClockSeconds = run?.startedAt
    ? (run.endedAt ? new Date(run.endedAt).getTime() : Date.now()) - new Date(run.startedAt + (run.startedAt.endsWith("Z") ? "" : "Z")).getTime()
    : 0;
  const wallClockDuration = wallClockSeconds > 0 ? wallClockSeconds / 1000 : 0;

  // Unique sources for filter dropdown
  const sources = useMemo(() => (progress?.bySource || []).map(s => s.source), [progress]);

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div style={{ padding: 32, maxWidth: 1400, margin: "0 auto" }}>
      {/* ── PACKET B: Run Header ── */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[32px] font-normal tracking-tight"
            style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>
            Load Mission Control
          </h1>
          <p className="text-sm mt-0.5" style={{ fontFamily: "var(--font-sans)", color: "var(--bp-ink-secondary)" }}>
            Every entity, every layer, every row — verified against the physical lakehouse
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* SSE indicator */}
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: sseConnected ? "var(--bp-operational)" : "var(--bp-fault)" }}>
            <span className="relative flex h-2 w-2">
              {sseConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: "var(--bp-operational)" }} />}
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: sseConnected ? "var(--bp-operational)" : "var(--bp-fault)" }} />
            </span>
            {sseConnected ? "LIVE" : "Disconnected"}
          </div>

          {/* Auto-refresh */}
          <button onClick={() => setAutoRefresh(!autoRefresh)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all"
            style={{
              border: `1px solid ${autoRefresh ? "var(--bp-operational)" : "var(--bp-border)"}`,
              backgroundColor: autoRefresh ? "var(--bp-operational-light)" : "transparent",
              color: autoRefresh ? "var(--bp-operational)" : "var(--bp-ink-muted)",
            }}>
            <RefreshCw className={cn("h-3 w-3", autoRefresh && "animate-spin")} style={{ animationDuration: "3s" }} />
            {autoRefresh ? `${refreshInterval}s` : "Paused"}
          </button>
          <select value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))}
            className="rounded px-2 py-1 text-[11px]"
            style={{ backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-tertiary)" }}>
            <option value={3}>3s</option>
            <option value={5}>5s</option>
            <option value={10}>10s</option>
            <option value={30}>30s</option>
          </select>

          {/* Start / Stop / Retry */}
          {isRunning ? (
            <button onClick={stopEngine} disabled={engineBusy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
              style={{ backgroundColor: "var(--bp-fault-light)", color: "var(--bp-fault)", border: "1px solid var(--bp-fault)" }}>
              {engineBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} Stop
            </button>
          ) : (
            <>
              {totalFailed > 0 && (
                <button onClick={retryFailed} disabled={engineBusy}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                  style={{ backgroundColor: "var(--bp-caution-light)", color: "var(--bp-caution)", border: "1px solid var(--bp-caution)" }}>
                  {engineBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Retry {formatNumber(totalFailed)} Failed
                </button>
              )}
              <button onClick={startEngine} disabled={engineBusy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                style={{ backgroundColor: "var(--bp-copper)", color: "#fff", border: "1px solid var(--bp-copper)" }}>
                {engineBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start Run
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm mb-4"
          style={{ border: "1px solid var(--bp-fault)", backgroundColor: "var(--bp-fault-light)", color: "var(--bp-fault)" }}>
          {error}
        </div>
      )}

      {loading && !progress && (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin mb-3" style={{ color: "var(--bp-copper)" }} />
          <p className="text-sm" style={{ color: "var(--bp-ink-muted)" }}>Loading mission control...</p>
        </div>
      )}

      {progress && (
        <>
          {/* ── Run Selector + Status ── */}
          <div className="flex items-center gap-4 mb-5">
            <div className="relative">
              <button onClick={() => setRunDropdownOpen(!runDropdownOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all"
                style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
                <span className="font-mono text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>
                  {run?.runId?.slice(0, 8) || "No runs"}
                </span>
                {run && runStatusBadge(run.status)}
                <ChevronDown className="h-3 w-3" style={{ color: "var(--bp-ink-muted)" }} />
              </button>
              {runDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden w-[480px] max-h-[300px] overflow-y-auto"
                  style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
                  {runs.map(r => (
                    <button key={r.RunId}
                      onClick={() => { setSelectedRunId(r.RunId); setRunDropdownOpen(false); fetchProgress(r.RunId); }}
                      className={cn("w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-colors",
                        r.RunId === selectedRunId ? "bg-[var(--bp-copper-light)]" : "hover:bg-[var(--bp-surface-inset)]"
                      )}>
                      <span className="font-mono w-16 shrink-0" style={{ color: "var(--bp-ink-tertiary)" }}>
                        {r.RunId.slice(0, 8)}
                      </span>
                      {runStatusBadge(r.Status)}
                      <span className="tabular-nums" style={{ color: "var(--bp-operational)" }}>
                        {r.actualSucceeded}
                      </span>
                      <span>/</span>
                      <span className="tabular-nums" style={{ color: "var(--bp-fault)" }}>
                        {r.actualFailed}
                      </span>
                      <span className="tabular-nums ml-auto" style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--font-mono)" }}>
                        {formatNumber(r.totalRowsRead || 0)} rows
                      </span>
                      <span style={{ color: "var(--bp-ink-muted)" }}>
                        {timeAgo(r.StartedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {run?.startedAt && (
              <span className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>
                Started {timeAgo(run.startedAt)}
                {run.triggeredBy && <> · by <span className="font-medium">{run.triggeredBy}</span></>}
              </span>
            )}

            {lastRefresh && (
              <span className="text-[10px] ml-auto" style={{ color: "var(--bp-ink-muted)" }}>
                Refreshed {timeAgo(lastRefresh.toISOString())}
              </span>
            )}
          </div>

          {/* ── KPI Strip ── */}
          <div className="grid grid-cols-5 gap-3 mb-5">
            {[
              { label: "Loaded", value: formatNumber(totalSucceeded), color: "var(--bp-operational)", icon: <CheckCircle2 className="h-4 w-4" /> },
              { label: "Errors", value: formatNumber(totalFailed), color: "var(--bp-fault)", icon: <XCircle className="h-4 w-4" /> },
              { label: "Pending", value: formatNumber(Math.max(0, totalPending)), color: "var(--bp-caution)", icon: <Clock className="h-4 w-4" /> },
              { label: "Rows Extracted", value: formatNumber(totalRows), color: "var(--bp-copper)", icon: <Database className="h-4 w-4" /> },
              { label: "Elapsed", value: formatDuration(wallClockDuration), color: "var(--bp-ink-secondary)", icon: <Timer className="h-4 w-4" /> },
            ].map((kpi, i) => (
              <div key={i} className="rounded-lg px-4 py-3"
                style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)", borderLeft: `3px solid ${kpi.color}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ color: kpi.color }}>{kpi.icon}</span>
                  <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--bp-ink-muted)" }}>
                    {kpi.label}
                  </span>
                </div>
                <div className="text-xl font-bold tabular-nums" style={{ fontFamily: "var(--bp-font-display)", color: kpi.color, fontFeatureSettings: '"tnum"' }}>
                  {kpi.value}
                </div>
              </div>
            ))}
          </div>

          {/* ── Physical Verification Banner ── */}
          {progress.verification && (
            <div className="rounded-lg px-5 py-3 mb-5 flex items-center gap-6"
              style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-inset)" }}>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" style={{ color: "var(--bp-operational)" }} />
                <span className="text-xs font-semibold" style={{ color: "var(--bp-ink-primary)" }}>Physical Verification</span>
              </div>
              {[
                { label: "Landing Zone", verified: progress.verification.lz_verified, total: progress.verification.total_active, scan: progress.verification.lz_last_scan },
                { label: "Bronze", verified: progress.verification.brz_verified, total: progress.verification.total_active, scan: progress.verification.brz_last_scan },
                { label: "Silver", verified: progress.verification.slv_verified, total: progress.verification.total_active, scan: null },
              ].map(v => (
                <div key={v.label} className="flex items-center gap-2 text-xs">
                  <span style={{ color: "var(--bp-ink-tertiary)" }}>{v.label}:</span>
                  <span className="font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)", color: v.verified > 0 ? "var(--bp-operational)" : "var(--bp-ink-muted)" }}>
                    {formatNumber(v.verified)}
                  </span>
                  <span style={{ color: "var(--bp-ink-muted)" }}>/ {formatNumber(v.total)}</span>
                </div>
              ))}
              <span className="ml-auto text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>
                Last scan: {timeAgo(progress.verification.lz_last_scan)}
              </span>
            </div>
          )}

          {/* ── PACKET C: Layer Progress Lanes ── */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {layerOrder.map(layerKey => {
              const stats = layers[layerKey];
              const total = progress.totalActiveEntities;
              const succeeded = stats?.succeeded || 0;
              const failed = stats?.failed || 0;
              const accent = layerTokens[layerKey];

              // Physical lakehouse reality — the ground truth from scans
              const lhName = layerToLakehouse[layerKey];
              const physical = lhState[lhName];
              const physicalTables = physical?.tablesWithData || 0;
              const physicalRows = physical?.totalRows || 0;
              const physicalBytes = physical?.totalBytes || 0;
              const physicalEmpty = physical?.emptyTables || 0;
              const hasPhysicalData = physicalTables > 0;
              const hasEngineData = succeeded > 0 || failed > 0;

              // Status: physical data is the truth, engine data supplements
              let layerStatus: { label: string; color: string } = { label: "Not started", color: "var(--bp-ink-muted)" };
              if (hasPhysicalData && physicalTables >= total) layerStatus = { label: "Complete", color: "var(--bp-operational)" };
              else if (hasEngineData && isRunning) layerStatus = { label: "In progress", color: "var(--bp-copper)" };
              else if (hasPhysicalData && failed > 0) layerStatus = { label: `${failed} errors`, color: "var(--bp-fault)" };
              else if (hasPhysicalData) layerStatus = { label: `${physicalTables} tables loaded`, color: "var(--bp-operational)" };

              // Progress bar based on physical tables
              const barPct = total > 0 ? Math.min((physicalTables / total) * 100, 100) : 0;

              return (
                <div key={layerKey} className="rounded-lg p-4"
                  style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)", borderTop: `3px solid ${accent}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4" style={{ color: accent }} />
                      <span className="text-sm font-semibold">{layerLabels[layerKey]}</span>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ color: layerStatus.color, backgroundColor: layerStatus.color + "18" }}>
                      {layerStatus.label}
                    </span>
                  </div>

                  {/* Progress bar — physical tables loaded */}
                  {hasPhysicalData || hasEngineData ? (
                    <div className="h-2 rounded-full overflow-hidden flex mb-3" style={{ backgroundColor: "var(--bp-surface-inset)" }}>
                      {barPct > 0 && (
                        <div className="h-full transition-all duration-700" style={{ width: `${barPct}%`, backgroundColor: "var(--bp-operational)" }} />
                      )}
                      {failed > 0 && (
                        <div className="h-full transition-all duration-700" style={{ width: `${total > 0 ? (failed / total) * 100 : 0}%`, backgroundColor: "var(--bp-fault)" }} />
                      )}
                    </div>
                  ) : (
                    <div className="h-2 rounded-full mb-3" style={{ backgroundColor: "var(--bp-surface-inset)" }} />
                  )}

                  {/* Clear counts — physical reality first */}
                  <div className="space-y-1.5 text-xs">
                    {hasPhysicalData ? (
                      <>
                        <div className="flex justify-between">
                          <span style={{ color: "var(--bp-ink-muted)" }}>Tables with data</span>
                          <span className="font-bold tabular-nums" style={{ color: "var(--bp-operational)" }}>
                            {formatNumber(physicalTables)} <span className="font-normal" style={{ color: "var(--bp-ink-muted)" }}>of {formatNumber(total)}</span>
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: "var(--bp-ink-muted)" }}>Total rows</span>
                          <span className="font-mono tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>{formatNumber(physicalRows)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: "var(--bp-ink-muted)" }}>Size</span>
                          <span className="font-mono tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>{formatBytes(physicalBytes)}</span>
                        </div>
                        {physicalEmpty > 0 && (
                          <div className="flex justify-between">
                            <span style={{ color: "var(--bp-ink-muted)" }}>Empty tables</span>
                            <span className="font-mono tabular-nums" style={{ color: "var(--bp-ink-tertiary)" }}>{formatNumber(physicalEmpty)}</span>
                          </div>
                        )}
                        {failed > 0 && (
                          <div className="flex justify-between">
                            <span style={{ color: "var(--bp-fault)" }}>Engine errors</span>
                            <span className="font-bold tabular-nums" style={{ color: "var(--bp-fault)" }}>{formatNumber(failed)}</span>
                          </div>
                        )}
                        {physical?.lastScan && (
                          <div className="text-[10px] pt-1" style={{ color: "var(--bp-ink-tertiary)" }}>
                            Scanned {new Date(physical.lastScan).toLocaleDateString()}
                          </div>
                        )}
                      </>
                    ) : hasEngineData ? (
                      <>
                        <div className="flex justify-between">
                          <span style={{ color: "var(--bp-ink-muted)" }}>Loaded (engine)</span>
                          <span className="font-bold tabular-nums" style={{ color: succeeded > 0 ? "var(--bp-operational)" : "var(--bp-ink-muted)" }}>
                            {formatNumber(succeeded)} <span className="font-normal" style={{ color: "var(--bp-ink-muted)" }}>of {formatNumber(total)}</span>
                          </span>
                        </div>
                        {failed > 0 && (
                          <div className="flex justify-between">
                            <span style={{ color: "var(--bp-fault)" }}>Errors</span>
                            <span className="font-bold tabular-nums" style={{ color: "var(--bp-fault)" }}>{formatNumber(failed)}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span style={{ color: "var(--bp-ink-muted)" }}>Rows extracted</span>
                          <span className="font-mono tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>{formatNumber(stats?.total_rows_read || 0)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-2" style={{ color: "var(--bp-ink-muted)" }}>
                        No data yet
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Source Progress Cards ── */}
          {(progress.bySource || []).length > 0 && (
            <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
              {progress.bySource.map(src => {
                const c = getColor(src.source);
                const pct = src.total_entities > 0 ? Math.round((src.succeeded / src.total_entities) * 100) : 0;
                return (
                  <div key={src.source} className="rounded-lg p-4 cursor-pointer transition-all hover:scale-[1.01]"
                    onClick={() => setEntityFilter(f => f.source === src.source ? {} : { ...f, source: src.source })}
                    style={{
                      border: `1px solid ${entityFilter.source === src.source ? c.hex : "var(--bp-border)"}`,
                      backgroundColor: "var(--bp-surface-1)",
                      borderLeft: `3px solid ${c.hex}`,
                    }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Server className="h-3.5 w-3.5" style={{ color: c.hex }} />
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: c.hex }}>{resolveLabel(src.source)}</span>
                      </div>
                      <span className="text-xs font-bold tabular-nums" style={{ color: pct >= 100 ? "var(--bp-operational)" : c.hex }}>
                        {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ backgroundColor: "var(--bp-surface-inset)" }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: c.hex }} />
                    </div>
                    <div className="flex justify-between text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>
                      <span><span className="font-bold" style={{ color: "var(--bp-operational)" }}>{src.succeeded}</span> / {src.total_entities}</span>
                      {src.failed > 0 && <span style={{ color: "var(--bp-fault)" }}>{src.failed} failed</span>}
                    </div>
                    <div className="text-[10px] mt-1 font-mono tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
                      {formatNumber(src.rows_read)} rows · {formatBytes(src.bytes)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Tab Bar ── */}
          <div className="flex gap-1 p-1 rounded-lg w-fit mb-4" style={{ backgroundColor: "var(--bp-surface-inset)" }}>
            {([
              { key: "entities" as const, label: "Entity Detail", icon: <Database className="h-3.5 w-3.5" />, count: entityTotal },
              { key: "events" as const, label: "Live Events", icon: <Activity className="h-3.5 w-3.5" />, count: sseEvents.length },
              { key: "errors" as const, label: "Errors", icon: <AlertTriangle className="h-3.5 w-3.5" />, count: totalFailed },
            ]).map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={cn("flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all",
                  activeTab === tab.key ? "text-[var(--bp-ink-primary)]" : "text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-primary)]"
                )}
                style={activeTab === tab.key ? { backgroundColor: "var(--bp-surface-1)" } : {}}>
                {tab.icon}
                {tab.label}
                <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: "var(--bp-surface-inset)", color: "var(--bp-ink-muted)" }}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* ── PACKET E: Entity Table ── */}
          {activeTab === "entities" && (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
              {/* Filters */}
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: "1px solid var(--bp-border)" }}>
                <Filter className="h-3.5 w-3.5" style={{ color: "var(--bp-ink-muted)" }} />
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3" style={{ color: "var(--bp-ink-muted)" }} />
                  <input type="text" placeholder="Search tables..."
                    value={entityFilter.search || ""}
                    onChange={e => { setEntityFilter(f => ({ ...f, search: e.target.value || undefined })); setEntityOffset(0); }}
                    className="pl-7 pr-3 py-1.5 rounded text-xs w-48"
                    style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-inset)", color: "var(--bp-ink-primary)" }} />
                </div>
                <select value={entityFilter.status || ""} onChange={e => { setEntityFilter(f => ({ ...f, status: e.target.value || undefined })); setEntityOffset(0); }}
                  className="rounded px-2 py-1.5 text-xs"
                  style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-inset)", color: "var(--bp-ink-primary)" }}>
                  <option value="">All statuses</option>
                  <option value="succeeded">Succeeded</option>
                  <option value="failed">Failed</option>
                  <option value="skipped">Skipped</option>
                </select>
                <select value={entityFilter.layer || ""} onChange={e => { setEntityFilter(f => ({ ...f, layer: e.target.value || undefined })); setEntityOffset(0); }}
                  className="rounded px-2 py-1.5 text-xs"
                  style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-inset)", color: "var(--bp-ink-primary)" }}>
                  <option value="">All layers</option>
                  <option value="landing">Landing Zone</option>
                  <option value="bronze">Bronze</option>
                  <option value="silver">Silver</option>
                </select>
                <select value={entityFilter.source || ""} onChange={e => { setEntityFilter(f => ({ ...f, source: e.target.value || undefined })); setEntityOffset(0); }}
                  className="rounded px-2 py-1.5 text-xs"
                  style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-inset)", color: "var(--bp-ink-primary)" }}>
                  <option value="">All sources</option>
                  {sources.map(s => <option key={s} value={s}>{resolveLabel(s)}</option>)}
                </select>
                {Object.values(entityFilter).some(Boolean) && (
                  <button onClick={() => { setEntityFilter({}); setEntityOffset(0); }}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded"
                    style={{ color: "var(--bp-fault)" }}>
                    <X className="h-3 w-3" /> Clear
                  </button>
                )}
                <span className="ml-auto text-[11px] tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
                  {formatNumber(entityTotal)} results
                </span>
              </div>

              {/* Table */}
              <div className="max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--bp-ink-tertiary)", backgroundColor: "var(--bp-surface-inset)" }}>
                    <tr>
                      <th className="w-6 px-2 py-2" />
                      <th className="text-left px-3 py-2 font-medium cursor-pointer"
                        onClick={() => setEntitySort(s => ({ col: "status", order: s.col === "status" && s.order === "asc" ? "desc" : "asc" }))}>
                        Status {entitySort.col === "status" && (entitySort.order === "asc" ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />)}
                      </th>
                      <th className="text-left px-3 py-2 font-medium">Source</th>
                      <th className="text-left px-3 py-2 font-medium cursor-pointer"
                        onClick={() => setEntitySort(s => ({ col: "table", order: s.col === "table" && s.order === "asc" ? "desc" : "asc" }))}>
                        Table
                      </th>
                      <th className="text-left px-3 py-2 font-medium">Layer</th>
                      <th className="text-right px-3 py-2 font-medium cursor-pointer"
                        onClick={() => setEntitySort(s => ({ col: "rows", order: s.col === "rows" && s.order === "desc" ? "asc" : "desc" }))}>
                        Rows
                      </th>
                      <th className="text-right px-3 py-2 font-medium cursor-pointer"
                        onClick={() => setEntitySort(s => ({ col: "duration", order: s.col === "duration" && s.order === "desc" ? "asc" : "desc" }))}>
                        Duration
                      </th>
                      <th className="text-center px-3 py-2 font-medium">Type</th>
                      <th className="text-center px-3 py-2 font-medium">Verified</th>
                      <th className="text-left px-3 py-2 font-medium cursor-pointer"
                        onClick={() => setEntitySort(s => ({ col: "created_at", order: s.col === "created_at" && s.order === "desc" ? "asc" : "desc" }))}>
                        Time
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entities.length === 0 && (
                      <tr>
                        <td colSpan={10} className="text-center py-16" style={{ color: "var(--bp-ink-muted)" }}>
                          <Database className="h-8 w-8 mx-auto mb-3 opacity-40" />
                          <p className="text-sm">No entities found for this run</p>
                        </td>
                      </tr>
                    )}
                    {entities.map(e => {
                      const c = getColor(e.source);
                      const isExpanded = expandedEntity === e.id;
                      const isFailed = e.Status === "failed";

                      // Pick the right verification column based on entity layer
                      let physRows = e.lz_physical_rows;
                      let physScan = e.lz_scanned_at;
                      if (e.Layer === "bronze") { physRows = e.brz_physical_rows; physScan = e.brz_scanned_at; }
                      if (e.Layer === "silver") { physRows = e.slv_physical_rows; physScan = e.slv_scanned_at; }

                      return (
                        <>
                          <tr key={e.id}
                            onClick={() => setExpandedEntity(isExpanded ? null : e.id)}
                            className="cursor-pointer transition-colors"
                            style={{
                              borderBottom: "1px solid var(--bp-border)",
                              borderLeft: `3px solid ${statusColor(e.Status)}`,
                              backgroundColor: isFailed ? "var(--bp-fault-light)" : isExpanded ? "var(--bp-surface-inset)" : "transparent",
                            }}>
                            <td className="px-2 py-2">
                              {isExpanded ? <ChevronDown className="h-3 w-3" style={{ color: "var(--bp-ink-muted)" }} /> : <ChevronRight className="h-3 w-3" style={{ color: "var(--bp-ink-muted)" }} />}
                            </td>
                            <td className="px-3 py-2">
                              {e.Status === "succeeded" ? <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--bp-operational)" }} />
                                : e.Status === "failed" ? <XCircle className="h-3.5 w-3.5" style={{ color: "var(--bp-fault)" }} />
                                : <Clock className="h-3.5 w-3.5" style={{ color: "var(--bp-ink-muted)" }} />}
                            </td>
                            <td className="px-3 py-2">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase" style={{ backgroundColor: c.hex + "18", color: c.hex }}>
                                {resolveLabel(e.source)}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono font-medium" style={{ color: "var(--bp-ink-primary)" }}>
                              {e.SourceTable}
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: "var(--bp-surface-inset)", color: layerTokens[e.Layer] || "var(--bp-ink-tertiary)" }}>
                                {e.Layer}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
                              {e.RowsRead > 0 ? formatNumber(e.RowsRead) : "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
                              {formatDuration(e.DurationSeconds)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{
                                  backgroundColor: e.LoadType === "incremental" ? "var(--bp-copper-light)" : "var(--bp-surface-inset)",
                                  color: e.LoadType === "incremental" ? "var(--bp-copper)" : "var(--bp-ink-muted)",
                                }}>
                                {e.LoadType || "full"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              {verificationBadge(physRows, physScan)}
                            </td>
                            <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: "var(--bp-ink-muted)" }}>
                              {timeAgo(e.created_at)}
                            </td>
                          </tr>
                          {/* Expanded detail row */}
                          {isExpanded && (
                            <tr key={`${e.id}-detail`} style={{ backgroundColor: "var(--bp-surface-inset)" }}>
                              <td colSpan={10} className="px-6 py-4">
                                <div className="grid grid-cols-2 gap-4 text-xs">
                                  <div>
                                    <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: "var(--bp-ink-muted)" }}>Source</div>
                                    <div className="font-mono" style={{ color: "var(--bp-ink-secondary)" }}>
                                      {e.SourceServer} · {e.SourceDatabase} · {e.SourceTable}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: "var(--bp-ink-muted)" }}>Metrics</div>
                                    <div className="font-mono tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
                                      Read: {formatNumber(e.RowsRead)} · Written: {formatNumber(e.RowsWritten)} · {formatBytes(e.BytesTransferred)} · {formatDuration(e.DurationSeconds)}
                                    </div>
                                  </div>
                                  {e.WatermarkColumn && (
                                    <div>
                                      <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: "var(--bp-ink-muted)" }}>Watermark</div>
                                      <div className="font-mono" style={{ color: "var(--bp-ink-secondary)" }}>
                                        <span style={{ color: "var(--bp-ink-muted)" }}>{e.WatermarkColumn}:</span>{" "}
                                        {e.WatermarkBefore || "—"} → {e.WatermarkAfter || "—"}
                                      </div>
                                    </div>
                                  )}
                                  <div>
                                    <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: "var(--bp-ink-muted)" }}>Physical Verification</div>
                                    <div className="flex items-center gap-3">
                                      <span>LZ: {verificationBadge(e.lz_physical_rows, e.lz_scanned_at)}</span>
                                      <span>BRZ: {verificationBadge(e.brz_physical_rows, e.brz_scanned_at)}</span>
                                      <span>SLV: {verificationBadge(e.slv_physical_rows, e.slv_scanned_at)}</span>
                                    </div>
                                  </div>
                                  {isFailed && e.ErrorMessage && (
                                    <div className="col-span-2">
                                      <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: "var(--bp-fault)" }}>Error</div>
                                      <div className="rounded p-3 font-mono text-[11px]"
                                        style={{ backgroundColor: "var(--bp-fault-light)", border: "1px solid var(--bp-fault)", color: "var(--bp-fault)" }}>
                                        <div className="font-bold mb-1">{e.ErrorType}</div>
                                        <div style={{ wordBreak: "break-all" }}>{e.ErrorMessage}</div>
                                        {e.ErrorSuggestion && (
                                          <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--bp-fault)", color: "var(--bp-ink-secondary)" }}>
                                            💡 {e.ErrorSuggestion}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  {e.SourceQuery && (
                                    <div className="col-span-2">
                                      <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: "var(--bp-ink-muted)" }}>Query</div>
                                      <div className="rounded p-3 font-mono text-[11px] overflow-x-auto"
                                        style={{ backgroundColor: "#2B2A27", color: "#E0DDD6" }}>
                                        {e.SourceQuery}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {entityTotal > 100 && (
                <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid var(--bp-border)" }}>
                  <span className="text-[11px]" style={{ color: "var(--bp-ink-muted)" }}>
                    Showing {entityOffset + 1}–{Math.min(entityOffset + 100, entityTotal)} of {formatNumber(entityTotal)}
                  </span>
                  <div className="flex gap-2">
                    <button disabled={entityOffset === 0} onClick={() => setEntityOffset(Math.max(0, entityOffset - 100))}
                      className="px-3 py-1 rounded text-xs disabled:opacity-30"
                      style={{ border: "1px solid var(--bp-border)" }}>
                      Prev
                    </button>
                    <button disabled={entityOffset + 100 >= entityTotal} onClick={() => setEntityOffset(entityOffset + 100)}
                      className="px-3 py-1 rounded text-xs disabled:opacity-30"
                      style={{ border: "1px solid var(--bp-border)" }}>
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── PACKET D: Live Event Stream ── */}
          {activeTab === "events" && (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--bp-border)" }}>
                <Activity className="h-4 w-4" style={{ color: "var(--bp-copper)" }} />
                <span className="text-sm font-semibold">Live Engine Events</span>
                <span className="relative flex h-2 w-2 ml-1">
                  {sseConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: "var(--bp-copper)" }} />}
                  <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: sseConnected ? "var(--bp-copper)" : "var(--bp-ink-muted)" }} />
                </span>
                <span className="ml-auto text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>
                  {sseEvents.length} events captured
                </span>
              </div>
              <div className="max-h-[600px] overflow-y-auto font-mono text-[11px]"
                style={{ backgroundColor: "#2B2A27", color: "#E0DDD6" }}>
                {sseEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16" style={{ color: "#777" }}>
                    <Activity className="h-8 w-8 mb-3 opacity-40" />
                    <p>Waiting for engine events...</p>
                    <p className="text-[10px] mt-1 opacity-60">
                      {sseConnected ? "Connected to SSE stream — events will appear when a load is running" : "SSE disconnected — will reconnect automatically"}
                    </p>
                  </div>
                ) : (
                  sseEvents.map((evt, i) => {
                    const isError = evt.level === "ERROR" || evt.status === "failed";
                    return (
                      <div key={i} className="px-4 py-1.5 flex items-start gap-3"
                        style={{ borderBottom: "1px solid #3a3937", backgroundColor: isError ? "#3a2020" : "transparent" }}>
                        <span style={{ color: "#666", minWidth: 70 }}>
                          {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : "--"}
                        </span>
                        <span style={{
                          color: isError ? "#ff6b6b" : evt.status === "succeeded" ? "#6bcb77" : "#ccc",
                          minWidth: 60,
                        }}>
                          {evt.level || evt.status || "INFO"}
                        </span>
                        <span className="flex-1" style={{ wordBreak: "break-all" }}>
                          {evt.message}
                          {evt.table && <span style={{ color: "#b0a080" }}> [{evt.table}]</span>}
                          {evt.rows != null && <span style={{ color: "#80b0a0" }}> {formatNumber(evt.rows)} rows</span>}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ── PACKET F: Errors Tab ── */}
          {activeTab === "errors" && (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--bp-border)" }}>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" style={{ color: "var(--bp-fault)" }} />
                  <span className="text-sm font-semibold">Error Breakdown</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold tabular-nums"
                    style={{ backgroundColor: "var(--bp-fault-light)", color: "var(--bp-fault)" }}>
                    {totalFailed}
                  </span>
                </div>
                {totalFailed > 0 && (
                  <div className="flex items-center gap-2">
                    <button onClick={retryFailed} disabled={engineBusy || isRunning}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                      style={{ backgroundColor: "var(--bp-caution-light)", color: "var(--bp-caution)", border: "1px solid var(--bp-caution)" }}>
                      <RefreshCw className="h-3 w-3" /> Retry {formatNumber(totalFailed)} Failed
                    </button>
                    <button onClick={() => { setEntityFilter({ status: "failed" }); setActiveTab("entities"); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{ backgroundColor: "var(--bp-copper)", color: "#fff" }}>
                      <Search className="h-3 w-3" /> View All Failed Entities
                    </button>
                  </div>
                )}
              </div>

              {totalFailed === 0 ? (
                <div className="flex flex-col items-center justify-center py-16" style={{ color: "var(--bp-ink-muted)" }}>
                  <CheckCircle2 className="h-8 w-8 mb-3 opacity-40" style={{ color: "var(--bp-operational)" }} />
                  <p className="text-sm">No errors in this run</p>
                </div>
              ) : (
                <div className="p-4 space-y-4">
                  {/* Error type cards with explanations */}
                  <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                    {(progress.errorBreakdown || []).map(eb => {
                      const explanations: Record<string, { why: string; fix: string }> = {
                        timeout: { why: "Source database unreachable — usually means VPN is disconnected or the on-prem server is down", fix: "Check VPN connection, then retry" },
                        connection: { why: "Connection established but dropped mid-query — network instability or server overload", fix: "Wait a few minutes and retry" },
                        auth: { why: "Authentication rejected — credentials may have expired or permissions changed", fix: "Verify service principal credentials" },
                        conversion: { why: "Data type mismatch — source column has values that can't convert to the target type", fix: "Check source data quality, may need custom select" },
                        other: { why: "Unexpected error — see individual entity details for specifics", fix: "Review error messages in Entity Detail tab" },
                      };
                      const info = explanations[eb.ErrorType.toLowerCase()] || explanations.other;
                      return (
                        <div key={eb.ErrorType} className="rounded-lg p-4"
                          style={{ border: "1px solid var(--bp-fault)", backgroundColor: "var(--bp-fault-light)" }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-bold uppercase" style={{ color: "var(--bp-fault)" }}>{eb.ErrorType}</span>
                            <span className="text-lg font-bold tabular-nums" style={{ color: "var(--bp-fault)" }}>{eb.cnt}</span>
                          </div>
                          <p className="text-xs mb-2" style={{ color: "var(--bp-ink-secondary)" }}>{info.why}</p>
                          <p className="text-xs font-medium" style={{ color: "var(--bp-copper)" }}>→ {info.fix}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Load type summary */}
                  {(progress.loadTypeBreakdown || []).length > 0 && (
                    <div className="flex items-center gap-4 pt-2" style={{ borderTop: "1px solid var(--bp-border)" }}>
                      <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--bp-ink-muted)" }}>Load Types:</span>
                      {progress.loadTypeBreakdown.map(lt => (
                        <div key={lt.LoadType} className="flex items-center gap-2 text-xs">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{
                              backgroundColor: lt.LoadType === "incremental" ? "var(--bp-copper-light)" : "var(--bp-surface-inset)",
                              color: lt.LoadType === "incremental" ? "var(--bp-copper)" : "var(--bp-ink-muted)",
                            }}>
                            {lt.LoadType}
                          </span>
                          <span className="font-bold tabular-nums">{lt.cnt}</span>
                          <span className="font-mono tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
                            ({formatNumber(lt.total_rows)} rows)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
