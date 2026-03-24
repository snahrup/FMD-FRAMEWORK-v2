/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Load Mission Control — Operational Workbench for FMD Load Pipeline
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Architecture: Single-file component with five phases.
 *
 *   Phase 1 — Types, Shared Scope State (context + reducer), API hooks
 *   Phase 2 — Main shell: Command Band, KPI Strip, Phase Rail, Source×Layer Matrix
 *   Phase 3 — Tab panels: Live stream, History, Entities table, Triage, Inventory
 *   Phase 4 — Context panel (slide-out): Entity detail, Failures, Verification
 *   Phase 5 — Orchestration wiring: SSE live feed, auto-refresh, keyboard shortcuts
 *
 * Design system: BP tokens (--bp-*), borders-only depth, Outfit/JetBrains Mono.
 * State management: React context + useReducer for cross-component scope sharing.
 * Data: All reads from /api/lmc/*, /api/engine/*, /api/load-center/* endpoints.
 *
 * This file is the Phase 1-2 foundation. Phases 3-5 are appended below.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  useState, useEffect, useCallback, useRef, useMemo,
  createContext, useContext, useReducer,
  type ReactNode, type Dispatch,
} from "react";
import {
  Activity, AlertTriangle, ArrowRight, Check, CheckCircle2,
  ChevronDown, Circle, Database, HelpCircle,
  Layers, Loader2, Pause, Play, RefreshCw,
  RotateCcw, Search, Server, Square, Timer, X, XCircle, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API = import.meta.env.VITE_API_URL || "";

// ═══════════════════════════════════════════════════════════════════════════════
// §1  TYPES — matched exactly to backend response shapes
// ═══════════════════════════════════════════════════════════════════════════════

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
  created_at: string;
  source: string;
  lz_physical_rows: number | null;
  brz_physical_rows: number | null;
  slv_physical_rows: number | null;
  lz_scanned_at: string | null;
  brz_scanned_at: string | null;
  slv_scanned_at: string | null;
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

interface ProgressResponse {
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

interface EngineStatusResponse {
  status: string;
  current_run_id: string | null;
  last_run: {
    worker_pid: number | null;
    worker_alive: boolean;
    heartbeat_at: string | null;
    current_layer: string | null;
    completed_units: number;
    resumable: boolean;
  } | null;
}

interface EntitiesResponse {
  entities: TaskEntity[];
  total: number;
}

interface RunDetailResponse {
  run: LmcRun;
  layerSource: Record<string, Record<string, LayerStats>>;
  failures: TaskEntity[];
  loadTypes: Array<{ load_type: string; count: number }>;
  watermarkUpdates: number;
  timeline: Array<{ ts: string; event: string; detail: string }>;
}

// Source × Layer matrix cell data (computed client-side)
interface MatrixCell {
  source: string;
  layer: string;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  inProgress: boolean;
  verified: boolean;
  physicalRows: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2  SHARED SCOPE STATE — context + reducer
// ═══════════════════════════════════════════════════════════════════════════════

interface Scope {
  selectedRunId: string | null;
  selectedSources: string[];
  selectedLayers: string[];
  selectedStatuses: string[];
  selectedEntityId: number | null;
  searchQuery: string;
  activeTab: "live" | "history" | "entities" | "triage" | "inventory";
  contextMode: "details" | "failures" | "verification";
  contextOpen: boolean;
  engineStatus: "idle" | "running" | "stopping" | "error";
  isRunActive: boolean;
}

type ScopeAction =
  | { type: "SET_RUN"; runId: string | null }
  | { type: "SET_SOURCES"; sources: string[] }
  | { type: "SET_LAYERS"; layers: string[] }
  | { type: "SET_STATUSES"; statuses: string[] }
  | { type: "SET_ENTITY"; entityId: number | null }
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_TAB"; tab: Scope["activeTab"] }
  | { type: "SET_CONTEXT_MODE"; mode: Scope["contextMode"] }
  | { type: "TOGGLE_CONTEXT" }
  | { type: "SET_ENGINE_STATUS"; status: Scope["engineStatus"]; isRunActive: boolean }
  | { type: "CLICK_MATRIX_CELL"; source: string; layer: string }
  | { type: "CLEAR_SCOPE" };

const initialScope: Scope = {
  selectedRunId: null,
  selectedSources: [],
  selectedLayers: [],
  selectedStatuses: [],
  selectedEntityId: null,
  searchQuery: "",
  activeTab: "live",
  contextMode: "details",
  contextOpen: false,
  engineStatus: "idle",
  isRunActive: false,
};

function scopeReducer(state: Scope, action: ScopeAction): Scope {
  switch (action.type) {
    case "SET_RUN":
      return { ...state, selectedRunId: action.runId, selectedEntityId: null };
    case "SET_SOURCES":
      return { ...state, selectedSources: action.sources };
    case "SET_LAYERS":
      return { ...state, selectedLayers: action.layers };
    case "SET_STATUSES":
      return { ...state, selectedStatuses: action.statuses };
    case "SET_ENTITY":
      return { ...state, selectedEntityId: action.entityId, contextOpen: action.entityId !== null };
    case "SET_SEARCH":
      return { ...state, searchQuery: action.query };
    case "SET_TAB":
      return { ...state, activeTab: action.tab };
    case "SET_CONTEXT_MODE":
      return { ...state, contextMode: action.mode };
    case "TOGGLE_CONTEXT":
      return { ...state, contextOpen: !state.contextOpen };
    case "SET_ENGINE_STATUS":
      return { ...state, engineStatus: action.status, isRunActive: action.isRunActive };
    case "CLICK_MATRIX_CELL":
      return {
        ...state,
        selectedSources: [action.source],
        selectedLayers: [action.layer],
        activeTab: "entities",
      };
    case "CLEAR_SCOPE":
      return { ...initialScope, selectedRunId: state.selectedRunId, engineStatus: state.engineStatus, isRunActive: state.isRunActive };
    default:
      return state;
  }
}

const ScopeContext = createContext<Scope>(initialScope);
const ScopeDispatchContext = createContext<Dispatch<ScopeAction>>(() => {});

function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, dispatch] = useReducer(scopeReducer, initialScope);
  return (
    <ScopeContext.Provider value={scope}>
      <ScopeDispatchContext.Provider value={dispatch}>
        {children}
      </ScopeDispatchContext.Provider>
    </ScopeContext.Provider>
  );
}

function useScope() { return useContext(ScopeContext); }
function useScopeDispatch() { return useContext(ScopeDispatchContext); }

// ═══════════════════════════════════════════════════════════════════════════════
// §3  API HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

function useRuns(limit = 20) {
  const [runs, setRuns] = useState<LmcRun[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/lmc/runs?limit=${limit}`);
      if (!res.ok) return;
      const data = await res.json();
      // Backend returns PascalCase keys — map to camelCase
      const mapped = (data.runs ?? []).map((r: Record<string, unknown>) => ({
        runId: r.RunId ?? r.runId ?? "",
        mode: r.Mode ?? r.mode ?? "",
        status: r.Status ?? r.status ?? "",
        totalEntities: r.TotalEntities ?? r.totalEntities ?? 0,
        layers: r.Layers ?? r.layers ?? "",
        triggeredBy: r.TriggeredBy ?? r.triggeredBy ?? "",
        startedAt: r.StartedAt ?? r.startedAt ?? null,
        endedAt: r.EndedAt ?? r.endedAt ?? null,
        errorSummary: r.ErrorSummary ?? r.errorSummary ?? "",
      })) as LmcRun[];
      setRuns(mapped);
    } catch { /* swallow */ }
    finally { setLoading(false); }
  }, [limit]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { runs, loading, refetch: fetch_ };
}

function useProgress(runId: string | null, pollMs = 3000) {
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch_ = useCallback(async () => {
    if (!runId) { setData(null); setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/lmc/progress?run_id=${runId}`);
      if (!res.ok) return;
      setData(await res.json());
    } catch { /* swallow */ }
    finally { setLoading(false); }
  }, [runId]);

  useEffect(() => {
    fetch_();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetch_, pollMs);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetch_, pollMs]);

  return { data, loading, refetch: fetch_ };
}

function useEngineStatus(pollMs = 5000) {
  const [engine, setEngine] = useState<EngineStatusResponse | null>(null);
  const dispatch = useScopeDispatch();

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/engine/status`);
      if (!res.ok) return;
      const d: EngineStatusResponse = await res.json();
      setEngine(d);
      const isRunning = d.status === "running";
      const mapped = d.status === "running" ? "running"
        : d.status === "stopping" ? "stopping"
        : d.status === "error" ? "error"
        : "idle" as Scope["engineStatus"];
      dispatch({ type: "SET_ENGINE_STATUS", status: mapped, isRunActive: isRunning });
    } catch { /* swallow */ }
  }, [dispatch]);

  useEffect(() => {
    fetch_();
    const iv = setInterval(fetch_, pollMs);
    return () => clearInterval(iv);
  }, [fetch_, pollMs]);

  return { engine, refetch: fetch_ };
}

function useEntities(
  runId: string | null,
  params: { source?: string; layer?: string; status?: string; search?: string; limit?: number; offset?: number }
) {
  const [data, setData] = useState<EntitiesResponse>({ entities: [], total: 0 });
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    if (!runId) { setData({ entities: [], total: 0 }); return; }
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (params.source) q.set("source", params.source);
      if (params.layer) q.set("layer", params.layer);
      if (params.status) q.set("status", params.status);
      if (params.search) q.set("search", params.search);
      if (params.limit) q.set("limit", String(params.limit));
      if (params.offset) q.set("offset", String(params.offset));
      const res = await fetch(`${API}/api/lmc/run/${runId}/entities?${q.toString()}`);
      if (!res.ok) return;
      setData(await res.json());
    } catch { /* swallow */ }
    finally { setLoading(false); }
  }, [runId, params.source, params.layer, params.status, params.search, params.limit, params.offset]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { ...data, loading, refetch: fetch_ };
}

function useSSE(enabled: boolean) {
  const [events, setEvents] = useState<Array<{ type: string; data: unknown; ts: number }>>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    const es = new EventSource(`${API}/api/engine/logs/stream`);
    esRef.current = es;

    const handler = (eventType: string) => (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents(prev => [...prev.slice(-499), { type: eventType, data: parsed, ts: Date.now() }]);
      } catch { /* ignore malformed */ }
    };
    // Listen for ALL named event types the server sends
    es.addEventListener("entity_result", handler("entity_result"));
    es.addEventListener("log", handler("log"));
    es.addEventListener("run_complete", handler("run_complete"));
    es.addEventListener("run_error", handler("run_error"));
    // Also catch unnamed events as fallback
    es.onmessage = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents(prev => [...prev.slice(-499), { type: parsed.type ?? "log", data: parsed, ts: Date.now() }]);
      } catch { /* ignore */ }
    };
    es.onerror = () => { es.close(); };
    return () => { es.close(); };
  }, [enabled]);

  const clear = useCallback(() => setEvents([]), []);
  return { events, clear };
}

interface SourceInfo { name: string; displayName: string; entityCount: number; }

function useSources() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  useEffect(() => {
    fetch(`${API}/api/lmc/sources`)
      .then(r => r.ok ? r.json() : { sources: [] })
      .then(d => setSources(d.sources ?? []))
      .catch(() => {});
  }, []);
  return sources;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "succeeded": case "success": case "completed": return "var(--bp-operational)";
    case "failed": case "error": return "var(--bp-fault)";
    case "running": case "in_progress": return "var(--bp-copper)";
    case "skipped": return "var(--bp-ink-muted)";
    case "idle": return "var(--bp-ink-tertiary)";
    default: return "var(--bp-ink-secondary)";
  }
}

function layerColor(layer: string): string {
  switch (layer.toLowerCase()) {
    case "landing": case "landingzone": case "lz": return "var(--bp-lz)";
    case "bronze": case "brz": return "var(--bp-bronze)";
    case "silver": case "slv": return "var(--bp-silver)";
    case "gold": return "var(--bp-gold)";
    default: return "var(--bp-ink-tertiary)";
  }
}

function layerLightColor(layer: string): string {
  switch (layer.toLowerCase()) {
    case "landing": case "landingzone": case "lz": return "var(--bp-lz-light)";
    case "bronze": case "brz": return "var(--bp-bronze-light)";
    case "silver": case "slv": return "var(--bp-silver-light)";
    case "gold": return "var(--bp-gold-light)";
    default: return "var(--bp-surface-inset)";
  }
}

function trustBadge(verified: boolean | null): { icon: typeof Check; color: string; label: string } {
  if (verified === true) return { icon: Check, color: "var(--bp-operational)", label: "Verified" };
  if (verified === false) return { icon: XCircle, color: "var(--bp-fault)", label: "Mismatch" };
  return { icon: HelpCircle, color: "var(--bp-ink-muted)", label: "Unverified" };
}

function engineActionLabel(status: Scope["engineStatus"]): string {
  switch (status) {
    case "running": return "Stop";
    case "stopping": return "Stopping…";
    default: return "Start";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5  INLINE STYLE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const S = {
  mono: { fontFamily: "'JetBrains Mono', monospace" } as React.CSSProperties, // ONLY for log output, code, watermarks
  data: { fontFamily: "'Manrope', sans-serif", fontVariantNumeric: "tabular-nums" } as React.CSSProperties, // numbers with aligned columns
  sans: { fontFamily: "'Manrope', sans-serif" } as React.CSSProperties,
  display: { fontFamily: "'Instrument Serif', serif" } as React.CSSProperties,
  card: {
    background: "var(--bp-surface-1)",
    border: "1px solid var(--bp-border)",
    borderRadius: 6,
  } as React.CSSProperties,
  cardInset: {
    background: "var(--bp-surface-inset)",
    border: "1px solid var(--bp-border-subtle)",
    borderRadius: 6,
  } as React.CSSProperties,
  cell: {
    borderRadius: 4,
    border: "1px solid var(--bp-border-subtle)",
    cursor: "pointer",
    transition: "border-color 0.15s ease",
  } as React.CSSProperties,
  badge: {
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.02em",
    lineHeight: "18px",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  } as React.CSSProperties,
} as const;

// Shared constants (must be before components that use them)
const LAYER_ORDER = ["landing", "bronze", "silver", "gold"] as const;
const LAYER_LABELS: Record<string, string> = { landing: "Landing Zone", bronze: "Bronze", silver: "Silver", gold: "Gold" };

function StatusBadge({ currentRun, engineStatus }: { currentRun: LmcRun | null; engineStatus: string }) {
  const runStatus = currentRun?.status ?? "";
  const showStatus = currentRun ? runStatus : engineStatus;
  const label = currentRun
    ? runStatus.charAt(0).toUpperCase() + runStatus.slice(1)
    : engineStatus.toUpperCase();
  const isActive = engineStatus === "running";
  return (
    <div style={{
      ...S.badge, ...S.data,
      background: statusColor(showStatus) + "18",
      color: statusColor(showStatus),
    }}>
      {isActive && <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />}
      {label}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6  COMMAND BAND — Sticky top bar with run selector + controls
// ═══════════════════════════════════════════════════════════════════════════════

function CommandBand({
  runs,
  engine,
  sources,
  onStart,
  onStop,
  onRetry,
  onResume,
}: {
  runs: LmcRun[];
  engine: EngineStatusResponse | null;
  sources: SourceInfo[];
  onStart: (layers: string[], sourceFilter: string[]) => void;
  onStop: () => void;
  onRetry: () => void;
  onResume: () => void;
}) {
  const scope = useScope();
  const dispatch = useScopeDispatch();
  const [runDropOpen, setRunDropOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchLayers, setLaunchLayers] = useState<string[]>(["landing", "bronze", "silver"]);
  const [launchSources, setLaunchSources] = useState<string[]>([]);

  const currentRun = runs.find(r => r.runId === scope.selectedRunId) ?? runs[0] ?? null;
  const canResume = engine?.last_run?.resumable === true && scope.engineStatus === "idle";
  const canRetry = currentRun?.status === "completed" || currentRun?.status === "failed";

  const allLayers = ["landing", "bronze", "silver"] as const;

  const toggleLayer = (l: string) =>
    setLaunchLayers(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]);
  const toggleSource = (s: string) =>
    setLaunchSources(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 40,
      background: "var(--bp-surface-1)",
      borderBottom: "1px solid var(--bp-border)",
      ...S.sans,
    }}>
      {/* Main command row */}
      <div style={{ padding: "8px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        {/* Run selector */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setRunDropOpen(!runDropOpen)}
            style={{
              ...S.card, ...S.data,
              padding: "6px 12px", fontSize: 13,
              display: "flex", alignItems: "center", gap: 8,
              cursor: "pointer", background: "var(--bp-surface-inset)",
              minWidth: 220,
            }}
          >
            <Database size={14} style={{ color: "var(--bp-ink-tertiary)", flexShrink: 0 }} />
            <span style={{ color: currentRun ? "var(--bp-ink-primary)" : "var(--bp-operational)", flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: currentRun ? 400 : 600 }}>
              {currentRun ? `Run ${currentRun.runId.slice(0, 8)}` : "⬤ New Run"}
            </span>
            <ChevronDown size={14} style={{ color: "var(--bp-ink-muted)", flexShrink: 0, transform: runDropOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </button>
          {runDropOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0,
              ...S.card, padding: 4,
              minWidth: 300, maxHeight: 320, overflowY: "auto", zIndex: 50,
              background: "var(--bp-surface-1)",
            }}>
              {runs.map(r => (
                <button
                  key={r.runId}
                  onClick={() => { dispatch({ type: "SET_RUN", runId: r.runId }); setRunDropOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", padding: "6px 8px", borderRadius: 4,
                    border: "none", cursor: "pointer", textAlign: "left",
                    background: r.runId === scope.selectedRunId ? "var(--bp-copper-soft)" : "transparent",
                    ...S.data, fontSize: 12,
                  }}
                >
                  <Circle size={8} fill={statusColor(r.status)} stroke="none" />
                  <span style={{ color: "var(--bp-ink-primary)", flex: 1 }}>{r.runId.slice(0, 8)}</span>
                  <span style={{ color: "var(--bp-ink-muted)", fontSize: 11 }}>
                    {r.startedAt ? new Date(r.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </span>
                  <span style={{ ...S.badge, background: statusColor(r.status) + "18", color: statusColor(r.status) }}>
                    {r.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status badge — shows selected run's status, or engine status if no run selected */}
        <StatusBadge currentRun={currentRun} engineStatus={scope.engineStatus} />

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Active scope chips */}
        {scope.selectedSources.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {scope.selectedSources.map(s => (
              <span key={s} style={{ ...S.badge, background: "var(--bp-copper-soft)", color: "var(--bp-copper)", fontSize: 11 }}>
                {s}
                <X size={10} style={{ cursor: "pointer" }} onClick={() => dispatch({ type: "SET_SOURCES", sources: scope.selectedSources.filter(x => x !== s) })} />
              </span>
            ))}
          </div>
        )}
        {scope.selectedLayers.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {scope.selectedLayers.map(l => (
              <span key={l} style={{ ...S.badge, background: layerLightColor(l), color: layerColor(l), fontSize: 11 }}>
                {l}
                <X size={10} style={{ cursor: "pointer" }} onClick={() => dispatch({ type: "SET_LAYERS", layers: scope.selectedLayers.filter(x => x !== l) })} />
              </span>
            ))}
          </div>
        )}
        {(scope.selectedSources.length > 0 || scope.selectedLayers.length > 0) && (
          <button
            onClick={() => dispatch({ type: "CLEAR_SCOPE" })}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--bp-ink-muted)", fontSize: 11, padding: "4px 8px" }}
          >
            Clear
          </button>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {scope.engineStatus === "running" ? (
            <button onClick={onStop} style={{
              ...S.badge, cursor: "pointer", border: "1px solid var(--bp-fault)",
              background: "var(--bp-fault)" + "12", color: "var(--bp-fault)",
              padding: "6px 14px", fontSize: 12,
            }}>
              <Square size={12} /> Stop
          </button>
        ) : (
          <button onClick={() => setLaunchOpen(!launchOpen)} style={{
            ...S.badge, cursor: "pointer", border: "1px solid var(--bp-operational)",
            background: launchOpen ? "var(--bp-operational)" : "var(--bp-operational)" + "12",
            color: launchOpen ? "#fff" : "var(--bp-operational)",
            padding: "6px 14px", fontSize: 12,
          }}>
            <Play size={12} /> Run Pipeline
          </button>
        )}
        {canResume && (
          <button onClick={onResume} style={{
            ...S.badge, cursor: "pointer", border: "1px solid var(--bp-caution)",
            background: "var(--bp-caution)" + "12", color: "var(--bp-caution)",
            padding: "6px 14px", fontSize: 12,
          }}>
            <RotateCcw size={12} /> Resume
          </button>
        )}
        {canRetry && (
          <button onClick={onRetry} style={{
            ...S.badge, cursor: "pointer", border: "1px solid var(--bp-copper)",
            background: "var(--bp-copper-soft)", color: "var(--bp-copper)",
            padding: "6px 14px", fontSize: 12,
          }}>
            <RefreshCw size={12} /> Retry Failed
          </button>
        )}
      </div>
    </div>

      {/* Launch modal overlay */}
      {launchOpen && scope.engineStatus !== "running" && (
        <div
          onClick={() => setLaunchOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              ...S.card, background: "var(--bp-surface-1)",
              width: 520, maxWidth: "90vw",
              padding: 0, overflow: "hidden",
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--bp-border)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ ...S.sans, fontSize: 16, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                New Pipeline Run
              </div>
              <button onClick={() => setLaunchOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--bp-ink-muted)", padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div style={{ padding: "20px 20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Layers */}
              <div>
                <div style={{ ...S.sans, fontSize: 12, fontWeight: 600, color: "var(--bp-ink-secondary)", marginBottom: 10 }}>
                  Layers
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {allLayers.map(l => {
                    const active = launchLayers.includes(l);
                    return (
                      <button
                        key={l}
                        onClick={() => toggleLayer(l)}
                        style={{
                          ...S.sans, cursor: "pointer", fontSize: 13, padding: "8px 16px",
                          borderRadius: 6,
                          border: `1.5px solid ${active ? layerColor(l) : "var(--bp-border)"}`,
                          background: active ? layerLightColor(l) : "var(--bp-surface-1)",
                          color: active ? layerColor(l) : "var(--bp-ink-muted)",
                          fontWeight: active ? 600 : 400,
                          display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "center",
                        }}
                      >
                        {active && <Check size={12} />}
                        {LAYER_LABELS[l] ?? l}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sources */}
              <div>
                <div style={{ ...S.sans, fontSize: 12, fontWeight: 600, color: "var(--bp-ink-secondary)", marginBottom: 10 }}>
                  Sources
                  <span style={{ fontWeight: 400, color: "var(--bp-ink-muted)", marginLeft: 8 }}>
                    {launchSources.length === 0 ? "All sources" : `${launchSources.length} of ${sources.length} selected`}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {sources.map(s => {
                    const active = launchSources.includes(s.name);
                    return (
                      <button
                        key={s.name}
                        onClick={() => toggleSource(s.name)}
                        style={{
                          ...S.sans, cursor: "pointer", fontSize: 13, padding: "10px 16px",
                          borderRadius: 6,
                          border: `1.5px solid ${active ? "var(--bp-copper)" : "var(--bp-border)"}`,
                          background: active ? "var(--bp-copper-soft)" : "var(--bp-surface-1)",
                          color: active ? "var(--bp-copper)" : "var(--bp-ink-secondary)",
                          fontWeight: active ? 600 : 400,
                          display: "flex", alignItems: "center", gap: 8,
                          flex: "1 1 calc(50% - 4px)", minWidth: 180,
                        }}
                      >
                        <div style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          border: `1.5px solid ${active ? "var(--bp-copper)" : "var(--bp-border)"}`,
                          background: active ? "var(--bp-copper)" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {active && <Check size={11} color="#fff" />}
                        </div>
                        <div style={{ flex: 1, textAlign: "left" }}>
                          <div style={{ fontWeight: 600 }}>{s.displayName}</div>
                          <div style={{ ...S.data, fontSize: 11, color: "var(--bp-ink-muted)", marginTop: 1 }}>
                            {formatNumber(s.entityCount)} tables · {s.name}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Summary */}
              <div style={{
                ...S.card, background: "var(--bp-surface-inset)", padding: "12px 16px",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <Layers size={16} style={{ color: "var(--bp-ink-muted)", flexShrink: 0 }} />
                <div style={{ ...S.sans, fontSize: 13, color: "var(--bp-ink-secondary)", flex: 1 }}>
                  {launchLayers.length === 0
                    ? "Select at least one layer"
                    : <>
                        <strong>{launchLayers.map(l => LAYER_LABELS[l] ?? l).join(" → ")}</strong>
                        {" · "}
                        {launchSources.length === 0
                          ? `All ${sources.reduce((a, s) => a + s.entityCount, 0).toLocaleString()} entities across ${sources.length} sources`
                          : `${sources.filter(s => launchSources.includes(s.name)).reduce((a, s) => a + s.entityCount, 0).toLocaleString()} entities from ${sources.filter(s => launchSources.includes(s.name)).map(s => s.displayName).join(", ")}`
                        }
                      </>
                  }
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div style={{
              padding: "12px 20px 16px",
              borderTop: "1px solid var(--bp-border)",
              display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12,
            }}>
              <button
                onClick={() => setLaunchOpen(false)}
                style={{
                  ...S.sans, cursor: "pointer", fontSize: 13, padding: "8px 20px",
                  borderRadius: 6, border: "1px solid var(--bp-border)",
                  background: "var(--bp-surface-1)", color: "var(--bp-ink-secondary)",
                }}
              >
                Cancel
              </button>
              <button
                disabled={launchLayers.length === 0}
                onClick={() => {
                  onStart(launchLayers, launchSources.map(s => s));
                  setLaunchOpen(false);
                }}
                style={{
                  ...S.sans, cursor: launchLayers.length === 0 ? "not-allowed" : "pointer",
                  fontSize: 13, fontWeight: 600, padding: "8px 24px",
                  borderRadius: 6, border: "none",
                  background: "var(--bp-operational)", color: "#fff",
                  opacity: launchLayers.length === 0 ? 0.4 : 1,
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                <Play size={14} /> Start Pipeline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7  KPI STRIP — Seven key metrics in a horizontal strip
// ═══════════════════════════════════════════════════════════════════════════════

function KpiStrip({ progress }: { progress: ProgressResponse | null }) {
  if (!progress) return null;

  const allLayers = Object.values(progress.layers);
  const succeeded = allLayers.reduce((a, l) => a + l.succeeded, 0);
  const failed = allLayers.reduce((a, l) => a + l.failed, 0);
  const skipped = allLayers.reduce((a, l) => a + l.skipped, 0);
  const pending = progress.totalActiveEntities - succeeded - failed - skipped;
  const totalRows = allLayers.reduce((a, l) => a + l.total_rows_written, 0);
  const totalDuration = allLayers.reduce((a, l) => a + l.total_duration, 0);
  const verified = (progress.verification?.lz_verified ?? 0) + (progress.verification?.brz_verified ?? 0) + (progress.verification?.slv_verified ?? 0);
  const totalActive = progress.verification?.total_active ?? progress.totalActiveEntities;

  return (
    <div style={{
      padding: "24px 32px", display: "flex", flexDirection: "column", gap: 24,
    }}>
      {/* Tier 1: Dominant Status Capsule */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16,
      }}>
        {/* Loaded (primary metric) */}
        <div style={{
          ...S.cardInset, padding: "20px 24px",
          borderLeft: `4px solid var(--bp-operational)`,
          animation: "slideInUp 0.5s ease-out 0s",
        }}>
          <div style={{ ...S.sans, fontSize: 11, fontWeight: 700, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
            Entities Loaded
          </div>
          <div style={{ ...S.data, fontSize: 32, fontWeight: 700, color: "var(--bp-operational)", lineHeight: 1, marginBottom: 6 }} className="metric-value">
            {formatNumber(succeeded)}
          </div>
          <div style={{ ...S.data, fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            of {formatNumber(progress.totalActiveEntities)} total
          </div>
        </div>

        {/* Failed (alert metric) */}
        <div style={{
          ...S.cardInset, padding: "20px 24px",
          borderLeft: `4px solid ${failed > 0 ? "var(--bp-fault)" : "var(--bp-ink-muted)"}`,
          animation: "slideInUp 0.5s ease-out 0.08s backwards",
        }}>
          <div style={{ ...S.sans, fontSize: 11, fontWeight: 700, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
            Failed Entities
          </div>
          <div style={{ ...S.data, fontSize: 32, fontWeight: 700, color: failed > 0 ? "var(--bp-fault)" : "var(--bp-ink-tertiary)", lineHeight: 1, marginBottom: 6 }} className="metric-value">
            {formatNumber(failed)}
          </div>
          <div style={{ ...S.data, fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            {failed > 0 ? "Requires attention" : "None"}
          </div>
        </div>

        {/* Pending */}
        <div style={{
          ...S.cardInset, padding: "20px 24px",
          borderLeft: `4px solid ${pending > 0 ? "var(--bp-caution)" : "var(--bp-ink-muted)"}`,
          animation: "slideInUp 0.5s ease-out 0.16s backwards",
        }}>
          <div style={{ ...S.sans, fontSize: 11, fontWeight: 700, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
            In Progress
          </div>
          <div style={{ ...S.data, fontSize: 32, fontWeight: 700, color: pending > 0 ? "var(--bp-caution)" : "var(--bp-ink-tertiary)", lineHeight: 1, marginBottom: 6 }} className="metric-value">
            {formatNumber(pending > 0 ? pending : 0)}
          </div>
          <div style={{ ...S.data, fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            {pending > 0 ? "Currently running" : "All processed"}
          </div>
        </div>
      </div>

      {/* Tier 2: Supporting Metrics — Compact horizontal layout */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12,
      }}>
        {/* Rows */}
        <div style={{ ...S.card, padding: "12px 16px" }}>
          <div style={{ ...S.sans, fontSize: 10, fontWeight: 600, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", marginBottom: 4 }}>Rows</div>
          <div style={{ ...S.data, fontSize: 18, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
            {formatNumber(totalRows)}
          </div>
        </div>
        {/* Elapsed */}
        <div style={{ ...S.card, padding: "12px 16px" }}>
          <div style={{ ...S.sans, fontSize: 10, fontWeight: 600, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", marginBottom: 4 }}>Elapsed</div>
          <div style={{ ...S.data, fontSize: 18, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
            {formatDuration(totalDuration)}
          </div>
        </div>
        {/* Throughput */}
        <div style={{ ...S.card, padding: "12px 16px" }}>
          <div style={{ ...S.sans, fontSize: 10, fontWeight: 600, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", marginBottom: 4 }}>Throughput</div>
          <div style={{ ...S.data, fontSize: 18, fontWeight: 600, color: "var(--bp-ink-secondary)" }}>
            {progress.throughput ? `${formatNumber(Math.round(progress.throughput.rows_per_sec))}/s` : "—"}
          </div>
        </div>
        {/* Verified */}
        <div style={{ ...S.card, padding: "12px 16px", borderLeft: `3px solid var(--bp-operational)` }}>
          <div style={{ ...S.sans, fontSize: 10, fontWeight: 600, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", marginBottom: 4 }}>Verified</div>
          <div style={{ ...S.data, fontSize: 18, fontWeight: 600, color: verified > 0 ? "var(--bp-operational)" : "var(--bp-ink-muted)" }}>
            {formatNumber(verified)}/{formatNumber(totalActive)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §8  PHASE RAIL — Landing → Bronze → Silver → Gold flow indicator
// ═══════════════════════════════════════════════════════════════════════════════

function PhaseRail({ progress, engine }: { progress: ProgressResponse | null; engine: EngineStatusResponse | null }) {
  const scope = useScope();
  const engineRunning = scope.engineStatus === "running";
  const currentLayer = engineRunning ? (engine?.last_run?.current_layer?.toLowerCase() ?? null) : null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "20px 32px 24px",
      background: "var(--bp-surface-inset)",
      margin: "0 32px",
      borderRadius: 8,
      border: "1px solid var(--bp-border-subtle)",
    }}>
      {LAYER_ORDER.map((layer, i) => {
        const stats = progress?.layers?.[layer] ?? progress?.layers?.[layer.charAt(0).toUpperCase() + layer.slice(1)] ?? null;
        const isActive = engineRunning && currentLayer != null && currentLayer.toLowerCase().includes(layer);
        const isDone = stats != null && stats.succeeded > 0 && stats.failed === 0 && stats.succeeded === stats.unique_entities;
        const hasFailed = (stats?.failed ?? 0) > 0;

        return (
          <div key={layer} style={{ display: "flex", alignItems: "center", animation: `slideInUp 0.5s ease-out ${i * 0.1}s backwards` }}>
            {i > 0 && (
              <ArrowRight size={18} style={{ color: "var(--bp-ink-muted)", margin: "0 8px", flexShrink: 0, opacity: 0.4 }} />
            )}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 16px",
              borderRadius: 6,
              border: isActive ? `2px solid ${layerColor(layer)}` : `1.5px solid var(--bp-border)`,
              background: isActive ? layerLightColor(layer) : "var(--bp-surface-1)",
              transition: "all 0.3s ease",
              boxShadow: isActive ? `0 0 0 3px ${layerColor(layer)}20` : "none",
            }}>
              {isActive && <Loader2 size={16} style={{ color: layerColor(layer), animation: "spin 1s linear infinite", flexShrink: 0 }} />}
              {isDone && <CheckCircle2 size={16} style={{ color: "var(--bp-operational)", flexShrink: 0 }} />}
              {hasFailed && !isActive && <AlertTriangle size={16} style={{ color: "var(--bp-fault)", flexShrink: 0 }} />}
              {!isActive && !isDone && !hasFailed && <Circle size={6} fill="var(--bp-ink-muted)" stroke="none" style={{ flexShrink: 0 }} />}
              <div>
                <div style={{ ...S.sans, fontSize: 13, fontWeight: 700, color: isActive ? layerColor(layer) : "var(--bp-ink-primary)" }}>
                  {LAYER_LABELS[layer]}
                </div>
                {stats && (
                  <div style={{ ...S.data, fontSize: 11, color: "var(--bp-ink-muted)", marginTop: 2 }}>
                    {formatNumber(stats.succeeded)}/{formatNumber(stats.unique_entities)} entities
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §9  SOURCE × LAYER MATRIX
// ═══════════════════════════════════════════════════════════════════════════════

function SourceLayerMatrix({ progress, engine, sourceNames }: { progress: ProgressResponse | null; engine: EngineStatusResponse | null; sourceNames: SourceInfo[] }) {
  const scope = useScope();
  const dispatch = useScopeDispatch();

  // Build display name lookup
  const displayNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of sourceNames) m[s.name] = s.displayName;
    return m;
  }, [sourceNames]);

  // Build matrix data from progress.bySource + progress.layers
  const sources = useMemo(() => {
    if (!progress?.bySource) return [];
    return progress.bySource.map(s => s.source).sort();
  }, [progress?.bySource]);

  const layerKeys = ["landing", "bronze", "silver", "gold"] as const;
  const currentLayer = engine?.last_run?.current_layer?.toLowerCase() ?? null;

  // Build lookup from lakehouseBySource array → { "source|lakehouse": { tables_loaded, total_rows } }
  const lhLookup = useMemo(() => {
    const map: Record<string, LakehouseBySourceItem> = {};
    if (Array.isArray(progress?.lakehouseBySource)) {
      for (const item of progress.lakehouseBySource) {
        map[`${item.source}|${item.lakehouse}`] = item;
      }
    }
    return map;
  }, [progress?.lakehouseBySource]);

  const lhNameForLayer = (layer: string) => {
    switch (layer) {
      case "landing": return "LH_DATA_LANDINGZONE";
      case "bronze": return "LH_BRONZE_LAYER";
      case "silver": return "LH_SILVER_LAYER";
      default: return "";
    }
  };

  const cells = useMemo((): MatrixCell[][] => {
    if (!progress) return [];

    return sources.map(source => {
      return layerKeys.map(layer => {
        const srcData = progress.bySource?.find(s => s.source === source);
        const srcTotal = srcData?.total_entities ?? 0;
        // Lakehouse physical data for this source × layer
        const lhItem = lhLookup[`${source}|${lhNameForLayer(layer)}`];

        return {
          source,
          layer,
          total: srcTotal,
          succeeded: srcData?.succeeded ?? 0,
          failed: srcData?.failed ?? 0,
          skipped: srcData?.skipped ?? 0,
          inProgress: currentLayer != null && currentLayer.includes(layer),
          verified: lhItem != null && lhItem.tables_loaded > 0,
          physicalRows: lhItem?.total_rows ?? null,
        } satisfies MatrixCell;
      });
    });
  }, [progress, sources, currentLayer, lhLookup]);

  if (sources.length === 0) return null;

  const isSelected = (source: string, layer: string) =>
    scope.selectedSources.includes(source) && scope.selectedLayers.includes(layer);

  return (
    <div style={{ padding: "24px 32px 0" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: `140px repeat(${layerKeys.length}, 1fr) 80px`,
        gap: 8,
      }}>
        {/* Header row */}
        <div style={{ padding: "4px 8px" }} /> {/* empty corner */}
        {layerKeys.map(l => (
          <div key={l} style={{
            padding: "6px 8px", textAlign: "center",
            ...S.sans, fontSize: 11, fontWeight: 600,
            color: layerColor(l), textTransform: "uppercase", letterSpacing: "0.04em",
          }}>
            {LAYER_LABELS[l] ?? l}
          </div>
        ))}
        <div style={{
          padding: "6px 8px", textAlign: "center",
          ...S.sans, fontSize: 11, fontWeight: 600,
          color: "var(--bp-fault)", textTransform: "uppercase", letterSpacing: "0.04em",
        }}>
          Failed
        </div>

        {/* Data rows */}
        {cells.map((row, ri) => {
          const source = sources[ri];
          const srcData = progress?.bySource?.find(s => s.source === source);
          const totalFailed = srcData?.failed ?? 0;

          return (
            <div key={source} style={{ display: "contents" }}>
              {/* Source label */}
              <div style={{
                padding: "8px 8px",
                ...S.sans, fontSize: 13, fontWeight: 600,
                color: "var(--bp-ink-primary)",
                display: "flex", alignItems: "center", gap: 6,
                overflow: "hidden",
              }}>
                <Server size={12} style={{ color: "var(--bp-ink-muted)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayNameMap[source] || source}</span>
              </div>

              {/* Layer cells */}
              {row.map(cell => {
                const selected = isSelected(cell.source, cell.layer);
                const pct = cell.total > 0 ? Math.round((cell.succeeded / cell.total) * 100) : 0;
                const trust = trustBadge(cell.verified ? true : cell.physicalRows != null ? true : null);
                const TrustIcon = trust.icon;

                return (
                  <div
                    key={cell.layer}
                    onClick={() => dispatch({ type: "CLICK_MATRIX_CELL", source: cell.source, layer: cell.layer })}
                    style={{
                      ...S.cell,
                      padding: "12px 10px 14px",
                      background: selected
                        ? layerLightColor(cell.layer)
                        : cell.inProgress
                          ? layerLightColor(cell.layer)
                          : "var(--bp-surface-1)",
                      borderColor: selected
                        ? layerColor(cell.layer)
                        : "var(--bp-border-subtle)",
                      borderWidth: selected ? 2 : 1,
                      position: "relative",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      minHeight: 64,
                      animation: cell.inProgress ? "pulse 2s ease-in-out infinite" : "none",
                    }}
                  >
                    {/* Count */}
                    <div style={{ ...S.data, fontSize: 15, fontWeight: 700, color: "var(--bp-ink-primary)", lineHeight: 1.2 }}>
                      {formatNumber(cell.succeeded)}<span style={{ color: "var(--bp-ink-muted)", fontWeight: 400 }}> / {formatNumber(cell.total)}</span>
                    </div>
                    {/* Percent bar */}
                    <div style={{
                      width: "100%", height: 3, borderRadius: 2,
                      background: "var(--bp-border)", marginTop: 4,
                      overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%", borderRadius: 2,
                        width: `${pct}%`,
                        background: pct === 100 ? "var(--bp-operational)" : layerColor(cell.layer),
                        transition: "width 0.3s ease",
                      }} />
                    </div>
                    {/* Trust indicator */}
                    <TrustIcon size={10} style={{
                      position: "absolute", top: 4, right: 4,
                      color: trust.color,
                    }} />
                  </div>
                );
              })}

              {/* Failed column */}
              <div style={{
                ...S.cell,
                padding: "12px 10px 14px",
                background: totalFailed > 0 ? "var(--bp-fault)" + "0A" : "var(--bp-surface-1)",
                borderColor: totalFailed > 0 ? "var(--bp-fault)" + "30" : "var(--bp-border-subtle)",
                display: "flex", alignItems: "center", justifyContent: "center",
                minHeight: 64,
                cursor: totalFailed > 0 ? "pointer" : "default",
              }}
                onClick={() => {
                  if (totalFailed > 0) {
                    dispatch({ type: "SET_SOURCES", sources: [source] });
                    dispatch({ type: "SET_STATUSES", statuses: ["failed"] });
                    dispatch({ type: "SET_TAB", tab: "triage" });
                  }
                }}
              >
                <span style={{
                  ...S.data, fontSize: 15, fontWeight: 700,
                  color: totalFailed > 0 ? "var(--bp-fault)" : "var(--bp-ink-muted)",
                }}>
                  {formatNumber(totalFailed)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10a  LIVE TAIL TAB — Real-time SSE event stream
// ═══════════════════════════════════════════════════════════════════════════════

interface LiveTailTabProps {
  events: Array<{ type: string; data: unknown; ts: number }>;
  onClear: () => void;
}

function LiveTailTab({ events, onClear }: LiveTailTabProps) {
  const scope = useScope();
  const dispatch = useScopeDispatch();
  const [autoFollow, setAutoFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sseConnected = scope.isRunActive || scope.activeTab === "live";

  useEffect(() => {
    if (autoFollow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, autoFollow]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // Un-follow if user scrolled up more than 60px from bottom
    if (scrollHeight - scrollTop - clientHeight > 60) {
      setAutoFollow(false);
    }
  }, []);

  const parseEvent = (ev: { type: string; data: unknown; ts: number }) => {
    const d = ev.data as Record<string, unknown>;
    return {
      time: d.timestamp ? new Date(d.timestamp as string).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : new Date(ev.ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      source: (d.source as string) || "",
      table: (d.table as string) || (d.SourceTable as string) || "",
      layer: (d.layer as string) || (d.Layer as string) || "",
      status: (d.status as string) || (d.Status as string) || ev.type,
      rows: (d.rows_written as number) || (d.RowsWritten as number) || 0,
      duration: (d.duration as number) || (d.DurationSeconds as number) || 0,
      error: (d.error as string) || (d.ErrorMessage as string) || "",
      entityId: (d.entity_id as number) || (d.EntityId as number) || 0,
    };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 480 }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid var(--bp-border-subtle)",
        background: "var(--bp-surface-1)",
        borderRadius: "6px 6px 0 0",
        border: "1px solid var(--bp-border)",
        borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: sseConnected ? "var(--bp-operational)" : "var(--bp-ink-muted)",
            animation: sseConnected ? "pulse 2s ease-in-out infinite" : "none",
          }} />
          <span style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)" }}>
            {sseConnected ? "Connected" : "Disconnected"}
          </span>
          <span style={{ ...S.data, fontSize: 11, color: "var(--bp-ink-muted)" }}>
            {events.length} events
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setAutoFollow(!autoFollow)}
            style={{
              ...S.badge, cursor: "pointer", fontSize: 11,
              background: autoFollow ? "var(--bp-copper-soft)" : "transparent",
              color: autoFollow ? "var(--bp-copper)" : "var(--bp-ink-muted)",
              border: `1px solid ${autoFollow ? "var(--bp-copper)" : "var(--bp-border)"}`,
            }}
          >
            Auto-follow {autoFollow ? "ON" : "OFF"}
          </button>
          <button
            onClick={onClear}
            style={{
              ...S.badge, cursor: "pointer", fontSize: 11,
              background: "transparent", color: "var(--bp-ink-muted)",
              border: "1px solid var(--bp-border)",
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Event log */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1, overflowY: "auto", overflowX: "hidden",
          background: "var(--bp-surface-inset)",
          border: "1px solid var(--bp-border)",
          borderTop: "none",
          borderRadius: "0 0 6px 6px",
          padding: "4px 0",
        }}
      >
        {events.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            height: "100%", color: "var(--bp-ink-muted)", gap: 8,
          }}>
            <Activity size={24} style={{ opacity: 0.4 }} />
            <span style={{ ...S.sans, fontSize: 13 }}>No live activity</span>
            <span style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-muted)" }}>
              {scope.isRunActive ? "Waiting for events..." : "Start a run to see live events"}
            </span>
          </div>
        ) : (
          events
            .filter(ev => {
              // Only show entity results and important log messages — not server access logs
              if (ev.type === "entity_result" || ev.type === "run_complete" || ev.type === "run_error") return true;
              if (ev.type === "log") {
                const msg = (ev.data as Record<string, unknown>)?.message as string ?? "";
                // Filter out GET/POST access logs and routine messages
                if (msg.startsWith("GET ") || msg.startsWith("POST ")) return false;
                if (msg.includes("SSE") || msg.includes("poller")) return false;
                return true;
              }
              return false;
            })
            .map((ev, i) => {
            const parsed = parseEvent(ev);
            const isFailed = parsed.status.toLowerCase().includes("fail") || parsed.status.toLowerCase().includes("error");
            const isSucceeded = parsed.status.toLowerCase().includes("succeed") || parsed.status.toLowerCase().includes("success") || parsed.status.toLowerCase().includes("complet");
            const isRunning = parsed.status.toLowerCase().includes("running") || parsed.status.toLowerCase().includes("progress");

            return (
              <div
                key={`${ev.ts}-${i}`}
                onClick={() => {
                  if (parsed.entityId) {
                    dispatch({ type: "SET_ENTITY", entityId: parsed.entityId });
                  }
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "8px 14px 10px",
                  cursor: parsed.entityId ? "pointer" : "default",
                  borderLeft: `3px solid ${isFailed ? "var(--bp-fault)" : isSucceeded ? "var(--bp-operational)" : "var(--bp-border-subtle)"}`,
                  background: i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.015)",
                  transition: "all 0.2s ease",
                  animation: `slideInUp 0.4s ease-out ${i * 0.03}s backwards`,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bp-copper-soft)"; (e.currentTarget as HTMLDivElement).style.borderLeftColor = "var(--bp-copper)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.015)"; (e.currentTarget as HTMLDivElement).style.borderLeftColor = isFailed ? "var(--bp-fault)" : isSucceeded ? "var(--bp-operational)" : "var(--bp-border-subtle)"; }}
              >
                {/* Status icon (leftmost) */}
                <div style={{ flexShrink: 0, width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {isSucceeded && <Check size={14} style={{ color: "var(--bp-operational)" }} />}
                  {isFailed && <XCircle size={14} style={{ color: "var(--bp-fault)" }} />}
                  {isRunning && <Loader2 size={14} style={{ animation: "spin 1s linear infinite", color: "var(--bp-caution)" }} />}
                  {!isSucceeded && !isFailed && !isRunning && <Circle size={6} fill="var(--bp-ink-muted)" stroke="none" />}
                </div>

                {/* Timestamp */}
                <span style={{ ...S.mono, fontSize: 11, color: "var(--bp-ink-muted)", flexShrink: 0, width: 60 }}>
                  {parsed.time}
                </span>

                {/* Source.Table (primary detail) */}
                {parsed.table && (
                  <span style={{
                    ...S.mono, fontSize: 12, color: "var(--bp-ink-primary)", fontWeight: 500,
                    maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                  }}>
                    {parsed.source ? `${parsed.source}.` : ""}{parsed.table}
                  </span>
                )}

                {/* Layer badge (color-coded) */}
                {parsed.layer && (
                  <span style={{
                    ...S.badge, fontSize: 10, padding: "2px 7px", fontWeight: 600,
                    background: layerLightColor(parsed.layer), color: layerColor(parsed.layer),
                    flexShrink: 0,
                  }}>
                    {parsed.layer.slice(0, 3).toUpperCase()}
                  </span>
                )}

                {/* Rows metric */}
                {parsed.rows > 0 && (
                  <span style={{ ...S.mono, fontSize: 11, color: "var(--bp-ink-secondary)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {formatNumber(parsed.rows)} rows
                  </span>
                )}

                {/* Duration */}
                {parsed.duration > 0 && (
                  <span style={{ ...S.mono, fontSize: 11, color: "var(--bp-ink-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {formatDuration(parsed.duration)}
                  </span>
                )}

                {/* Error snippet — show first on errors */}
                {parsed.error && (
                  <span style={{
                    ...S.mono, fontSize: 10, color: "var(--bp-fault)",
                    maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    flexShrink: 0, marginLeft: "auto",
                  }}>
                    {parsed.error.slice(0, 60)}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10b  HISTORY TAB — Completed events for current run
// ═══════════════════════════════════════════════════════════════════════════════

interface HistoryTabProps {
  entities: TaskEntity[];
  total: number;
  loading: boolean;
}

function HistoryTab({ entities, total, loading }: HistoryTabProps) {
  const dispatch = useScopeDispatch();
  const scope = useScope();
  const [page, setPage] = useState(0);
  const [localSearch, setLocalSearch] = useState(scope.searchQuery);
  const pageSize = 100;

  // Debounced search dispatch
  useEffect(() => {
    const t = setTimeout(() => dispatch({ type: "SET_SEARCH", query: localSearch }), 300);
    return () => clearTimeout(t);
  }, [localSearch, dispatch]);

  const sorted = useMemo(() =>
    [...entities].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [entities]
  );

  const pageCount = Math.ceil(total / pageSize);

  return (
    <div style={{ ...S.card, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: "1px solid var(--bp-border-subtle)",
      }}>
        <span style={{ ...S.sans, fontSize: 13, fontWeight: 600, color: "var(--bp-ink-secondary)" }}>
          History — {formatNumber(total)} events
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 4,
            border: "1px solid var(--bp-border)",
            background: "var(--bp-surface-inset)",
          }}>
            <Search size={12} style={{ color: "var(--bp-ink-muted)" }} />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Filter by table name..."
              style={{
                border: "none", outline: "none", background: "transparent",
                ...S.data, fontSize: 12, color: "var(--bp-ink-primary)", width: 180,
              }}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 32, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--bp-ink-muted)" }}>
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
          <span style={{ ...S.sans, fontSize: 13 }}>Loading...</span>
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--bp-ink-muted)", ...S.sans, fontSize: 13 }}>
          No history for this run
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", ...S.data, fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}>
                {["Time", "Source", "Table", "Layer", "Status", "Rows", "Duration"].map(h => (
                  <th key={h} style={{
                    padding: "8px 10px", textAlign: "left",
                    ...S.sans, fontSize: 11, fontWeight: 600, color: "var(--bp-ink-tertiary)",
                    textTransform: "uppercase", letterSpacing: "0.04em",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((e, i) => (
                <tr
                  key={e.id || i}
                  onClick={() => dispatch({ type: "SET_ENTITY", entityId: e.EntityId })}
                  style={{
                    borderBottom: "1px solid var(--bp-border-subtle)",
                    cursor: "pointer",
                    background: scope.selectedEntityId === e.EntityId ? "var(--bp-copper-soft)" : "transparent",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(ev) => { if (scope.selectedEntityId !== e.EntityId) (ev.currentTarget as HTMLTableRowElement).style.background = "rgba(0,0,0,0.02)"; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLTableRowElement).style.background = scope.selectedEntityId === e.EntityId ? "var(--bp-copper-soft)" : "transparent"; }}
                >
                  <td style={{ padding: "6px 10px", color: "var(--bp-ink-muted)", whiteSpace: "nowrap" }}>
                    {e.created_at ? new Date(e.created_at).toLocaleTimeString("en-US", { hour12: false }) : "—"}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--bp-ink-secondary)" }}>{e.source || e.SourceDatabase}</td>
                  <td style={{ padding: "6px 10px", color: "var(--bp-ink-primary)", fontWeight: 500 }}>{e.SourceTable}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <span style={{ ...S.badge, fontSize: 10, padding: "1px 6px", background: layerLightColor(e.Layer), color: layerColor(e.Layer) }}>
                      {e.Layer}
                    </span>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Circle size={7} fill={statusColor(e.Status)} stroke="none" />
                      <span style={{ color: statusColor(e.Status) }}>{e.Status}</span>
                    </span>
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--bp-ink-secondary)" }}>
                    {formatNumber(e.RowsWritten)}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--bp-ink-muted)" }}>
                    {formatDuration(e.DurationSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 14px", borderTop: "1px solid var(--bp-border-subtle)",
        }}>
          <span style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-muted)" }}>
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              style={{
                ...S.badge, cursor: page === 0 ? "default" : "pointer", fontSize: 11,
                background: "transparent", color: page === 0 ? "var(--bp-ink-muted)" : "var(--bp-ink-secondary)",
                border: "1px solid var(--bp-border)", opacity: page === 0 ? 0.5 : 1,
              }}
            >
              Prev
            </button>
            <button
              disabled={page >= pageCount - 1}
              onClick={() => setPage(p => p + 1)}
              style={{
                ...S.badge, cursor: page >= pageCount - 1 ? "default" : "pointer", fontSize: 11,
                background: "transparent", color: page >= pageCount - 1 ? "var(--bp-ink-muted)" : "var(--bp-ink-secondary)",
                border: "1px solid var(--bp-border)", opacity: page >= pageCount - 1 ? 0.5 : 1,
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10c  ENTITIES TAB — Core operations table
// ═══════════════════════════════════════════════════════════════════════════════

interface EntitiesTabProps {
  entities: TaskEntity[];
  total: number;
  loading: boolean;
  onRetryEntity: (entityId: number) => void;
}

function EntitiesTab({ entities, total, loading, onRetryEntity }: EntitiesTabProps) {
  const scope = useScope();
  const dispatch = useScopeDispatch();
  const [localSearch, setLocalSearch] = useState(scope.searchQuery);
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<string>("Time");
  const [sortAsc, setSortAsc] = useState(false);
  const pageSize = 100;

  useEffect(() => {
    const t = setTimeout(() => dispatch({ type: "SET_SEARCH", query: localSearch }), 300);
    return () => clearTimeout(t);
  }, [localSearch, dispatch]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  const sorted = useMemo(() => {
    const arr = [...entities];
    const dir = sortAsc ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortCol) {
        case "Source": return dir * (a.source || a.SourceDatabase || "").localeCompare(b.source || b.SourceDatabase || "");
        case "Table": return dir * (a.SourceTable || "").localeCompare(b.SourceTable || "");
        case "Layer": return dir * (a.Layer || "").localeCompare(b.Layer || "");
        case "Status": return dir * (a.Status || "").localeCompare(b.Status || "");
        case "Rows": return dir * ((a.RowsWritten || 0) - (b.RowsWritten || 0));
        case "Duration": return dir * ((a.DurationSeconds || 0) - (b.DurationSeconds || 0));
        case "Load Type": return dir * (a.LoadType || "").localeCompare(b.LoadType || "");
        case "Time": return dir * (new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
        default: return 0;
      }
    });
    return arr;
  }, [entities, sortCol, sortAsc]);

  const pageCount = Math.ceil(total / pageSize);
  const columns = ["Source", "Table", "Layer", "Status", "Rows", "Duration", "Load Type", "Watermark", "Verified", "Time", "Actions"];

  return (
    <div style={{ ...S.card, overflow: "hidden" }}>
      {/* Header bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: "1px solid var(--bp-border-subtle)",
      }}>
        <span style={{ ...S.sans, fontSize: 13, fontWeight: 600, color: "var(--bp-ink-secondary)" }}>
          Entities — {formatNumber(total)} total
        </span>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 10px", borderRadius: 4,
          border: "1px solid var(--bp-border)", background: "var(--bp-surface-inset)",
        }}>
          <Search size={12} style={{ color: "var(--bp-ink-muted)" }} />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search tables..."
            style={{
              border: "none", outline: "none", background: "transparent",
              ...S.data, fontSize: 12, color: "var(--bp-ink-primary)", width: 180,
            }}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 32, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--bp-ink-muted)" }}>
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
          <span style={{ ...S.sans, fontSize: 13 }}>Loading entities...</span>
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--bp-ink-muted)", ...S.sans, fontSize: 13 }}>
          No entities match current filters
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", ...S.data, fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}>
                {columns.map(h => (
                  <th
                    key={h}
                    onClick={() => h !== "Actions" && h !== "Verified" && h !== "Watermark" ? handleSort(h) : undefined}
                    style={{
                      padding: "8px 10px", textAlign: "left",
                      ...S.sans, fontSize: 11, fontWeight: 600, color: "var(--bp-ink-tertiary)",
                      textTransform: "uppercase", letterSpacing: "0.04em",
                      cursor: h !== "Actions" && h !== "Verified" && h !== "Watermark" ? "pointer" : "default",
                      whiteSpace: "nowrap",
                      userSelect: "none",
                    }}
                  >
                    {h}
                    {sortCol === h && <span style={{ marginLeft: 4 }}>{sortAsc ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((e, i) => {
                const isSelected = scope.selectedEntityId === e.EntityId;
                const isFailed = e.Status?.toLowerCase().includes("fail") || e.Status?.toLowerCase().includes("error");
                const vStatus = e.lz_physical_rows != null || e.brz_physical_rows != null || e.slv_physical_rows != null;
                const tb = trustBadge(vStatus ? true : null);
                const TbIcon = tb.icon;

                return (
                  <tr
                    key={e.id || i}
                    onClick={() => dispatch({ type: "SET_ENTITY", entityId: e.EntityId })}
                    style={{
                      borderBottom: "1px solid var(--bp-border-subtle)",
                      cursor: "pointer",
                      background: isSelected ? "var(--bp-copper-soft)" : "transparent",
                      borderLeft: isFailed ? "3px solid var(--bp-fault)" : "3px solid transparent",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(ev) => { if (!isSelected) (ev.currentTarget as HTMLTableRowElement).style.background = "rgba(0,0,0,0.02)"; }}
                    onMouseLeave={(ev) => { (ev.currentTarget as HTMLTableRowElement).style.background = isSelected ? "var(--bp-copper-soft)" : "transparent"; }}
                  >
                    <td style={{ padding: "6px 10px", color: "var(--bp-ink-secondary)" }}>{e.source || e.SourceDatabase}</td>
                    <td style={{ padding: "6px 10px", color: "var(--bp-ink-primary)", fontWeight: 500 }}>{e.SourceTable}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ ...S.badge, fontSize: 10, padding: "1px 6px", background: layerLightColor(e.Layer), color: layerColor(e.Layer) }}>
                        {e.Layer}
                      </span>
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Circle size={7} fill={statusColor(e.Status)} stroke="none" />
                        <span style={{ color: statusColor(e.Status), fontSize: 11 }}>{e.Status}</span>
                      </span>
                    </td>
                    <td style={{ padding: "6px 10px", color: "var(--bp-ink-secondary)" }}>{formatNumber(e.RowsWritten)}</td>
                    <td style={{ padding: "6px 10px", color: "var(--bp-ink-muted)" }}>{formatDuration(e.DurationSeconds)}</td>
                    <td style={{ padding: "6px 10px", color: "var(--bp-ink-secondary)" }}>{e.LoadType || "—"}</td>
                    <td style={{ padding: "6px 10px", color: "var(--bp-ink-muted)", fontSize: 11, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.WatermarkColumn ? `${e.WatermarkColumn}` : "—"}
                    </td>
                    <td style={{ padding: "6px 10px" }} title={tb.label}>
                      <TbIcon size={14} style={{ color: tb.color }} />
                    </td>
                    <td style={{ padding: "6px 10px", color: "var(--bp-ink-muted)", whiteSpace: "nowrap" }}>
                      {e.created_at ? new Date(e.created_at).toLocaleTimeString("en-US", { hour12: false }) : "—"}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {isFailed && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); onRetryEntity(e.EntityId); }}
                            style={{
                              ...S.badge, fontSize: 10, padding: "2px 8px", cursor: "pointer",
                              background: "var(--bp-copper-soft)", color: "var(--bp-copper)",
                              border: "1px solid var(--bp-copper)",
                            }}
                          >
                            <RotateCcw size={9} /> Retry
                          </button>
                        )}
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            dispatch({ type: "SET_ENTITY", entityId: e.EntityId });
                            if (!scope.contextOpen) dispatch({ type: "TOGGLE_CONTEXT" });
                          }}
                          style={{
                            ...S.badge, fontSize: 10, padding: "2px 8px", cursor: "pointer",
                            background: "transparent", color: "var(--bp-ink-secondary)",
                            border: "1px solid var(--bp-border)",
                          }}
                        >
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination footer */}
      {pageCount > 1 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 14px", borderTop: "1px solid var(--bp-border-subtle)",
        }}>
          <span style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-muted)" }}>
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              style={{
                ...S.badge, cursor: page === 0 ? "default" : "pointer", fontSize: 11,
                background: "transparent", color: page === 0 ? "var(--bp-ink-muted)" : "var(--bp-ink-secondary)",
                border: "1px solid var(--bp-border)", opacity: page === 0 ? 0.5 : 1,
              }}
            >
              Prev
            </button>
            <button
              disabled={page >= pageCount - 1}
              onClick={() => setPage(p => p + 1)}
              style={{
                ...S.badge, cursor: page >= pageCount - 1 ? "default" : "pointer", fontSize: 11,
                background: "transparent", color: page >= pageCount - 1 ? "var(--bp-ink-muted)" : "var(--bp-ink-secondary)",
                border: "1px solid var(--bp-border)", opacity: page >= pageCount - 1 ? 0.5 : 1,
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10d  TRIAGE TAB — Error breakdown with WHY/FIX explanations
// ═══════════════════════════════════════════════════════════════════════════════

const ERROR_KNOWLEDGE: Record<string, { why: string; fix: string }> = {
  timeout: {
    why: "Source database unreachable — usually VPN disconnected or server down",
    fix: "Check VPN connection, verify source server is online, then retry",
  },
  connection: {
    why: "Connection dropped mid-query — transient network issue",
    fix: "Usually self-resolves. Retry the affected entities. If persistent, check network stability.",
  },
  OutOfMemory: {
    why: "Table too large for single extraction — needs chunked extraction",
    fix: "Enable chunked extraction for this entity or increase worker memory allocation",
  },
  QueryTimeout: {
    why: "Query took longer than the configured timeout threshold",
    fix: "Increase query timeout in engine config, or optimize the source query with better indexing",
  },
  SchemaEvolution: {
    why: "Source schema changed since last load — columns added, removed, or type-changed",
    fix: "Run schema discovery to detect changes, update entity metadata, then retry",
  },
  DeltaMergeConflict: {
    why: "Concurrent write conflict in lakehouse — another process was writing to the same table",
    fix: "Wait for the other process to complete, then retry. Consider serializing writes to this table.",
  },
  ConnectionThrottle: {
    why: "Too many concurrent connections to source server",
    fix: "Reduce engine concurrency, stagger source extraction windows, or increase source connection limits",
  },
};

interface TriageTabProps {
  progress: ProgressResponse | null;
  onRetryErrorType: (errorType: string) => void;
}

function TriageTab({ progress, onRetryErrorType }: TriageTabProps) {
  const dispatch = useScopeDispatch();
  const errors = progress?.errorBreakdown ?? [];

  if (errors.length === 0) {
    return (
      <div style={{
        ...S.card, padding: "32px 24px",
        display: "flex", alignItems: "center", gap: 12,
        borderLeft: "4px solid var(--bp-operational)",
      }}>
        <CheckCircle2 size={24} style={{ color: "var(--bp-operational)", flexShrink: 0 }} />
        <div>
          <div style={{ ...S.sans, fontSize: 15, fontWeight: 600, color: "var(--bp-operational)" }}>
            All clear — no failures in this run
          </div>
          <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)", marginTop: 4 }}>
            All entities processed successfully. No triage needed.
          </div>
        </div>
      </div>
    );
  }

  const totalFailed = errors.reduce((a, e) => a + e.cnt, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Triage summary */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
        background: "var(--bp-fault)" + "0A",
        border: "1px solid var(--bp-fault)" + "30",
        borderRadius: 6,
      }}>
        <AlertTriangle size={20} style={{ color: "var(--bp-fault)", flexShrink: 0 }} />
        <div>
          <span style={{ ...S.sans, fontSize: 14, fontWeight: 600, color: "var(--bp-fault)" }}>
            {formatNumber(totalFailed)} failed entities across {errors.length} error type{errors.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Error type cards */}
      {errors.map(err => {
        const knowledge = ERROR_KNOWLEDGE[err.ErrorType] ?? ERROR_KNOWLEDGE[err.ErrorType.toLowerCase()] ?? {
          why: "Unexpected error type — check the error messages for details",
          fix: "Investigate individual entity errors and retry after resolving the root cause",
        };

        return (
          <div key={err.ErrorType} style={{
            ...S.card, padding: 0, overflow: "hidden",
            borderLeft: "4px solid var(--bp-fault)",
          }}>
            {/* Card header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid var(--bp-border-subtle)",
              background: "var(--bp-fault)" + "06",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  ...S.badge, ...S.data,
                  background: "var(--bp-fault)" + "18", color: "var(--bp-fault)",
                  fontSize: 12, padding: "3px 10px",
                }}>
                  {err.ErrorType}
                </span>
                <span style={{ ...S.data, fontSize: 13, fontWeight: 700, color: "var(--bp-fault)" }}>
                  {formatNumber(err.cnt)} entit{err.cnt === 1 ? "y" : "ies"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => onRetryErrorType(err.ErrorType)}
                  style={{
                    ...S.badge, cursor: "pointer", fontSize: 11,
                    background: "var(--bp-copper-soft)", color: "var(--bp-copper)",
                    border: "1px solid var(--bp-copper)", padding: "4px 12px",
                  }}
                >
                  <RotateCcw size={10} /> Retry these
                </button>
                <button
                  onClick={() => {
                    dispatch({ type: "SET_STATUSES", statuses: ["failed"] });
                    dispatch({ type: "SET_TAB", tab: "entities" });
                  }}
                  style={{
                    ...S.badge, cursor: "pointer", fontSize: 11,
                    background: "transparent", color: "var(--bp-ink-secondary)",
                    border: "1px solid var(--bp-border)", padding: "4px 12px",
                  }}
                >
                  View entities
                </button>
              </div>
            </div>

            {/* WHY + FIX */}
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ ...S.sans, fontSize: 11, fontWeight: 700, color: "var(--bp-fault)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                  WHY
                </div>
                <div style={{ ...S.sans, fontSize: 13, color: "var(--bp-ink-primary)", lineHeight: 1.5 }}>
                  {knowledge.why}
                </div>
              </div>
              <div>
                <div style={{ ...S.sans, fontSize: 11, fontWeight: 700, color: "var(--bp-operational)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                  HOW TO FIX
                </div>
                <div style={{ ...S.sans, fontSize: 13, color: "var(--bp-ink-primary)", lineHeight: 1.5 }}>
                  {knowledge.fix}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10e  INVENTORY TAB — Entity classification + lakehouse state
// ═══════════════════════════════════════════════════════════════════════════════

function InventoryTab({ progress }: { progress: ProgressResponse | null }) {
  if (!progress) {
    return (
      <div style={{ ...S.card, padding: 32, textAlign: "center", color: "var(--bp-ink-muted)", ...S.sans, fontSize: 13 }}>
        Select a run to view inventory data
      </div>
    );
  }

  const incremental = (progress.loadTypeBreakdown ?? [])
    .filter(lt => lt.LoadType?.toLowerCase().includes("incremental"))
    .reduce((a, lt) => a + lt.cnt, 0);
  const fullOnly = (progress.loadTypeBreakdown ?? [])
    .filter(lt => !lt.LoadType?.toLowerCase().includes("incremental"))
    .reduce((a, lt) => a + lt.cnt, 0);
  const v = progress.verification;
  const verifiedTotal = (v?.lz_verified ?? 0) + (v?.brz_verified ?? 0) + (v?.slv_verified ?? 0);
  const verifiedPossible = (v?.total_active ?? 0) * 3;

  const summaryCards = [
    { label: "Total Registered", value: formatNumber(progress.totalActiveEntities), color: "var(--bp-ink-primary)", icon: Database },
    { label: "Incremental-Ready", value: formatNumber(incremental), color: "var(--bp-operational)", icon: Zap },
    { label: "Full-Load Only", value: formatNumber(fullOnly), color: "var(--bp-caution)", icon: Layers },
    { label: "Verification Coverage", value: verifiedPossible > 0 ? `${Math.round((verifiedTotal / verifiedPossible) * 100)}%` : "—", color: "var(--bp-lz)", icon: CheckCircle2 },
  ];

  const layerEntries = [
    { key: "LandingZone", label: "Landing Zone", color: "var(--bp-lz)" },
    { key: "Bronze", label: "Bronze", color: "var(--bp-bronze)" },
    { key: "Silver", label: "Silver", color: "var(--bp-silver)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {summaryCards.map(c => {
          const Icon = c.icon;
          return (
            <div key={c.label} style={{ ...S.card, padding: "16px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Icon size={14} style={{ color: c.color, opacity: 0.7 }} />
                <span style={{ ...S.sans, fontSize: 11, fontWeight: 600, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {c.label}
                </span>
              </div>
              <div style={{ ...S.data, fontSize: 24, fontWeight: 700, color: c.color }}>
                {c.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-layer lakehouse state */}
      <div style={{ ...S.card, overflow: "hidden" }}>
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid var(--bp-border-subtle)",
          ...S.sans, fontSize: 13, fontWeight: 600, color: "var(--bp-ink-secondary)",
        }}>
          Lakehouse Physical State
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0 }}>
          {layerEntries.map((le, idx) => {
            const state = progress.lakehouseState?.[le.key] ?? progress.lakehouseState?.[le.key.toLowerCase()] ?? null;
            return (
              <div key={le.key} style={{
                padding: "16px 20px",
                borderRight: idx < 2 ? "1px solid var(--bp-border-subtle)" : "none",
              }}>
                <div style={{
                  ...S.sans, fontSize: 12, fontWeight: 700, color: le.color,
                  textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 12,
                }}>
                  {le.label}
                </div>
                {state ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)" }}>Tables with data</span>
                      <span style={{ ...S.data, fontSize: 12, fontWeight: 600, color: "var(--bp-operational)" }}>{formatNumber(state.tablesWithData)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)" }}>Empty tables</span>
                      <span style={{ ...S.data, fontSize: 12, color: state.emptyTables > 0 ? "var(--bp-caution)" : "var(--bp-ink-muted)" }}>{formatNumber(state.emptyTables)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)" }}>Scan failed</span>
                      <span style={{ ...S.data, fontSize: 12, color: state.scanFailed > 0 ? "var(--bp-fault)" : "var(--bp-ink-muted)" }}>{formatNumber(state.scanFailed)}</span>
                    </div>
                    <div style={{ height: 1, background: "var(--bp-border-subtle)", margin: "4px 0" }} />
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)" }}>Total rows</span>
                      <span style={{ ...S.data, fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)" }}>{formatNumber(state.totalRows)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)" }}>Size</span>
                      <span style={{ ...S.data, fontSize: 12, color: "var(--bp-ink-secondary)" }}>{formatBytes(state.totalBytes)}</span>
                    </div>
                    {state.lastScan && (
                      <div style={{ ...S.data, fontSize: 10, color: "var(--bp-ink-muted)", marginTop: 4 }}>
                        Last scan: {new Date(state.lastScan).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-muted)" }}>
                    No scan data available
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Load type breakdown */}
      {(progress.loadTypeBreakdown ?? []).length > 0 && (
        <div style={{ ...S.card, overflow: "hidden" }}>
          <div style={{
            padding: "12px 16px", borderBottom: "1px solid var(--bp-border-subtle)",
            ...S.sans, fontSize: 13, fontWeight: 600, color: "var(--bp-ink-secondary)",
          }}>
            Load Type Distribution
          </div>
          <div style={{ padding: "8px 0" }}>
            {progress.loadTypeBreakdown.map(lt => (
              <div key={lt.LoadType} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 16px",
              }}>
                <span style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-primary)" }}>{lt.LoadType || "Unknown"}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ ...S.data, fontSize: 12, color: "var(--bp-ink-secondary)" }}>
                    {formatNumber(lt.cnt)} entities
                  </span>
                  <span style={{ ...S.data, fontSize: 12, color: "var(--bp-ink-muted)" }}>
                    {formatNumber(lt.total_rows)} rows
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10f  CONTEXT PANEL — Slide-out detail/failure/verification panel
// ═══════════════════════════════════════════════════════════════════════════════

function ContextPanel({ entity }: { entity: TaskEntity | null }) {
  const scope = useScope();
  const dispatch = useScopeDispatch();

  const modes: Array<{ key: Scope["contextMode"]; label: string }> = [
    { key: "details", label: "Details" },
    { key: "failures", label: "Failures" },
    { key: "verification", label: "Verification" },
  ];

  return (
    <div style={{
      width: 320, flexShrink: 0,
      ...S.card,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      alignSelf: "flex-start",
      position: "sticky", top: 56,
      maxHeight: "calc(100vh - 72px)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: "1px solid var(--bp-border-subtle)",
      }}>
        <div style={{ display: "flex", gap: 0 }}>
          {modes.map(m => (
            <button
              key={m.key}
              onClick={() => dispatch({ type: "SET_CONTEXT_MODE", mode: m.key })}
              style={{
                padding: "4px 10px",
                ...S.sans, fontSize: 11, fontWeight: 600,
                color: scope.contextMode === m.key ? "var(--bp-copper)" : "var(--bp-ink-tertiary)",
                borderBottom: scope.contextMode === m.key ? "2px solid var(--bp-copper)" : "2px solid transparent",
                background: "none", border: "none", borderBottomStyle: "solid",
                cursor: "pointer",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => dispatch({ type: "TOGGLE_CONTEXT" })}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--bp-ink-muted)", padding: 4 }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {!entity ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            height: 200, color: "var(--bp-ink-muted)", gap: 8,
          }}>
            <Database size={24} style={{ opacity: 0.3 }} />
            <span style={{ ...S.sans, fontSize: 12 }}>Select an entity to view details</span>
          </div>
        ) : scope.contextMode === "details" ? (
          /* DETAILS MODE */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ ...S.sans, fontSize: 14, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
              {entity.SourceTable}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {([
                ["Source", entity.source || entity.SourceDatabase],
                ["Server", entity.SourceServer],
                ["Layer", entity.Layer],
                ["Status", entity.Status],
                ["Load Type", entity.LoadType],
                ["Rows Read", formatNumber(entity.RowsRead)],
                ["Rows Written", formatNumber(entity.RowsWritten)],
                ["Bytes", formatBytes(entity.BytesTransferred)],
                ["Duration", formatDuration(entity.DurationSeconds)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-tertiary)" }}>{label}</span>
                  <span style={{
                    ...S.data, fontSize: 12,
                    color: label === "Status" ? statusColor(value) : "var(--bp-ink-primary)",
                  }}>
                    {value || "—"}
                  </span>
                </div>
              ))}
            </div>
            {/* Watermark */}
            {entity.WatermarkColumn && (
              <div style={{
                ...S.cardInset, padding: "10px 12px", marginTop: 4,
              }}>
                <div style={{ ...S.sans, fontSize: 10, fontWeight: 700, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Watermark ({entity.WatermarkColumn})
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ ...S.data, fontSize: 11, color: "var(--bp-ink-muted)" }}>
                    {entity.WatermarkBefore || "—"}
                  </span>
                  <ArrowRight size={10} style={{ color: "var(--bp-ink-muted)" }} />
                  <span style={{ ...S.data, fontSize: 11, color: "var(--bp-ink-primary)", fontWeight: 600 }}>
                    {entity.WatermarkAfter || "—"}
                  </span>
                </div>
              </div>
            )}
            {/* Timestamps */}
            <div style={{ marginTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-tertiary)" }}>Processed at</span>
                <span style={{ ...S.data, fontSize: 11, color: "var(--bp-ink-muted)" }}>
                  {entity.created_at ? new Date(entity.created_at).toLocaleString() : "—"}
                </span>
              </div>
            </div>
          </div>
        ) : scope.contextMode === "failures" ? (
          /* FAILURES MODE */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {entity.ErrorType || entity.ErrorMessage ? (
              <>
                <div style={{ ...S.sans, fontSize: 14, fontWeight: 700, color: "var(--bp-fault)" }}>
                  {entity.SourceTable}
                </div>
                {entity.ErrorType && (
                  <div>
                    <div style={{ ...S.sans, fontSize: 10, fontWeight: 700, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                      Error Type
                    </div>
                    <span style={{
                      ...S.badge, ...S.data,
                      background: "var(--bp-fault)" + "18", color: "var(--bp-fault)",
                      fontSize: 12,
                    }}>
                      {entity.ErrorType}
                    </span>
                  </div>
                )}
                {entity.ErrorMessage && (
                  <div>
                    <div style={{ ...S.sans, fontSize: 10, fontWeight: 700, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                      Error Message
                    </div>
                    <div style={{
                      ...S.data, fontSize: 11, color: "var(--bp-ink-primary)", lineHeight: 1.6,
                      ...S.cardInset, padding: "10px 12px",
                      wordBreak: "break-word",
                    }}>
                      {entity.ErrorMessage}
                    </div>
                  </div>
                )}
                {entity.ErrorSuggestion && (
                  <div>
                    <div style={{ ...S.sans, fontSize: 10, fontWeight: 700, color: "var(--bp-operational)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                      Suggested Fix
                    </div>
                    <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-primary)", lineHeight: 1.5 }}>
                      {entity.ErrorSuggestion}
                    </div>
                  </div>
                )}
                {/* Retry button */}
                <button
                  onClick={() => {
                    if (entity.EntityId) {
                      fetch(`${API}/api/engine/retry`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ entity_ids: [entity.EntityId] }),
                      }).catch(() => {});
                    }
                  }}
                  style={{
                    ...S.badge, cursor: "pointer",
                    background: "var(--bp-copper-soft)", color: "var(--bp-copper)",
                    border: "1px solid var(--bp-copper)",
                    padding: "8px 16px", fontSize: 12,
                    justifyContent: "center", marginTop: 4,
                  }}
                >
                  <RotateCcw size={12} /> Retry this entity
                </button>
              </>
            ) : (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                height: 160, color: "var(--bp-ink-muted)", gap: 8,
              }}>
                <CheckCircle2 size={24} style={{ opacity: 0.4, color: "var(--bp-operational)" }} />
                <span style={{ ...S.sans, fontSize: 12 }}>No failure for this entity</span>
              </div>
            )}
          </div>
        ) : (
          /* VERIFICATION MODE */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ ...S.sans, fontSize: 14, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
              {entity.SourceTable}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Engine reported */}
              <div style={{ ...S.cardInset, padding: "10px 12px" }}>
                <div style={{ ...S.sans, fontSize: 10, fontWeight: 700, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Engine Reported
                </div>
                <div style={{ ...S.data, fontSize: 16, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
                  {formatNumber(entity.RowsWritten)} rows
                </div>
              </div>
              {/* Physical scan per layer */}
              {([
                ["Landing Zone", entity.lz_physical_rows, entity.lz_scanned_at, "var(--bp-lz)"],
                ["Bronze", entity.brz_physical_rows, entity.brz_scanned_at, "var(--bp-bronze)"],
                ["Silver", entity.slv_physical_rows, entity.slv_scanned_at, "var(--bp-silver)"],
              ] as [string, number | null, string | null, string][]).map(([label, rows, scanAt, color]) => {
                const hasData = rows != null;
                const matches = hasData && entity.RowsWritten > 0 && rows === entity.RowsWritten;
                const mismatched = hasData && entity.RowsWritten > 0 && rows !== entity.RowsWritten;

                return (
                  <div key={label} style={{ ...S.cardInset, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ ...S.sans, fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {label}
                      </span>
                      {matches && <Check size={14} style={{ color: "var(--bp-operational)" }} />}
                      {mismatched && <AlertTriangle size={14} style={{ color: "var(--bp-caution)" }} />}
                    </div>
                    {hasData ? (
                      <>
                        <div style={{ ...S.data, fontSize: 14, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
                          {formatNumber(rows)} rows
                        </div>
                        {mismatched && (
                          <div style={{ ...S.sans, fontSize: 10, color: "var(--bp-caution)", marginTop: 4 }}>
                            Mismatch: engine wrote {formatNumber(entity.RowsWritten)}, physical has {formatNumber(rows)}
                          </div>
                        )}
                        {scanAt && (
                          <div style={{ ...S.data, fontSize: 10, color: "var(--bp-ink-muted)", marginTop: 4 }}>
                            Scanned: {new Date(scanAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-muted)" }}>
                        No physical verification data
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §11  MAIN COMPONENT — Shell with all Phase 1-2 pieces
// ═══════════════════════════════════════════════════════════════════════════════

function LoadMissionControlInner() {
  const scope = useScope();
  const dispatch = useScopeDispatch();

  // Fetch runs list
  const { runs, loading: runsLoading, refetch: refetchRuns } = useRuns(20);

  // Engine status (polls every 5s) — must be before useEffects that reference it
  const { engine } = useEngineStatus(scope.isRunActive ? 3000 : 10000);

  // Fetch progress for selected run (polls every 3s)
  const { data: progress, loading: progressLoading } = useProgress(
    scope.selectedRunId,
    scope.isRunActive ? 3000 : 15000,
  );

  // Auto-select a run if the engine is actively running one
  // Otherwise stay on "New Run" (selectedRunId = null)
  useEffect(() => {
    if (engine?.status === "running" && engine?.current_run_id && engine.current_run_id !== scope.selectedRunId) {
      dispatch({ type: "SET_RUN", runId: engine.current_run_id });
      refetchRuns();
    }
  }, [engine?.status, engine?.current_run_id, scope.selectedRunId, dispatch, refetchRuns]);

  // Engine actions
  // Available sources (fast dedicated endpoint, not dependent on slow progress query)
  const availableSources = useSources();

  const handleStart = useCallback(async (layers: string[], sourceFilter: string[]) => {
    try {
      // If sources are filtered, we need to get entity_ids for those sources
      let entityIds: number[] | undefined;
      if (sourceFilter.length > 0) {
        // Query entities for the selected sources
        const srcSet = new Set(sourceFilter.map(s => s.toLowerCase()));
        const allEntities = await fetch(`${API}/api/lmc/run/${scope.selectedRunId || "_"}/entities?limit=5000`).then(r => r.json()).catch(() => ({ entities: [] }));
        // Actually, we need active entity IDs by source from the DB, not from a run.
        // Use load-center status which has source-level detail
        const lcStatus = await fetch(`${API}/api/load-center/status`).then(r => r.json()).catch(() => null);
        // For now, pass source info — the engine will filter by entity_ids if we can get them
        // Simplification: start without entity_ids filter, let it run all.
        // TODO: Add source-filtered entity_ids endpoint
      }
      const res = await fetch(`${API}/api/engine/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layers: layers.length > 0 ? layers : undefined,
          triggered_by: "dashboard",
        }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.run_id) dispatch({ type: "SET_RUN", runId: d.run_id });
        refetchRuns();
      }
    } catch { /* swallow */ }
  }, [dispatch, refetchRuns, scope.selectedRunId]);

  const handleStop = useCallback(async () => {
    try { await fetch(`${API}/api/engine/stop`, { method: "POST" }); } catch { /* swallow */ }
  }, []);

  const handleRetry = useCallback(async () => {
    if (!scope.selectedRunId) return;
    try {
      await fetch(`${API}/api/engine/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: scope.selectedRunId, layers: scope.selectedLayers.length > 0 ? scope.selectedLayers : undefined }),
      });
      refetchRuns();
    } catch { /* swallow */ }
  }, [scope.selectedRunId, scope.selectedLayers, refetchRuns]);

  const handleResume = useCallback(async () => {
    if (!scope.selectedRunId) return;
    try {
      await fetch(`${API}/api/engine/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: scope.selectedRunId }),
      });
      refetchRuns();
    } catch { /* swallow */ }
  }, [scope.selectedRunId, refetchRuns]);

  // ── Phase 3-5 data hooks ──────────────────────────────────────────────────
  const entityParams = useMemo(() => ({
    source: scope.selectedSources[0],
    layer: scope.selectedLayers[0],
    status: scope.selectedStatuses[0],
    search: scope.searchQuery,
    limit: 100,
    offset: 0,
  }), [scope.selectedSources, scope.selectedLayers, scope.selectedStatuses, scope.searchQuery]);
  const { entities, total: entityTotal, loading: entitiesLoading, refetch: refetchEntities } = useEntities(scope.selectedRunId, entityParams);

  // SSE for live tab
  const { events: sseEvents, clear: clearSse } = useSSE(scope.isRunActive || scope.activeTab === "live");

  // Selected entity from entities list
  const selectedEntity = useMemo(() => entities.find(e => e.EntityId === scope.selectedEntityId) ?? null, [entities, scope.selectedEntityId]);

  // Entity-level retry handler
  const handleRetryEntity = useCallback(async (entityId: number) => {
    if (!scope.selectedRunId) return;
    try {
      await fetch(`${API}/api/engine/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: scope.selectedRunId, entity_ids: [entityId] }),
      });
      refetchEntities();
    } catch { /* swallow */ }
  }, [scope.selectedRunId, refetchEntities]);

  // Error-type batch retry handler
  const handleRetryErrorType = useCallback(async (errorType: string) => {
    if (!scope.selectedRunId) return;
    const failed = entities.filter(e => e.ErrorType === errorType).map(e => e.EntityId);
    if (failed.length === 0) return;
    try {
      await fetch(`${API}/api/engine/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: scope.selectedRunId, entity_ids: failed }),
      });
      refetchEntities();
    } catch { /* swallow */ }
  }, [scope.selectedRunId, entities, refetchEntities]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bp-canvas)",
      color: "var(--bp-ink-primary)",
      ...S.sans,
    }}>
      {/* Keyframe for pulse animation */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-12px); } }
        @keyframes slideInUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes highlight { 0%, 100% { background-color: transparent; } 50% { background-color: var(--bp-copper-soft); } }
        .metric-value { transition: color 0.3s ease, font-size 0.2s ease; }
        .metric-value:hover { color: var(--bp-copper); }
      `}</style>

      {/* §6 Command Band */}
      <CommandBand
        runs={runs}
        engine={engine}
        sources={availableSources}
        onStart={handleStart}
        onStop={handleStop}
        onRetry={handleRetry}
        onResume={handleResume}
      />

      {/* §7 KPI Strip + Matrix — only when a run is selected */}
      {!scope.selectedRunId ? (
        <div style={{
          padding: "48px 32px", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 20, color: "var(--bp-ink-muted)",
          background: "linear-gradient(135deg, var(--bp-surface-inset) 0%, var(--bp-canvas) 100%)",
          minHeight: "600px", justifyContent: "center",
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 12,
            background: "var(--bp-operational)" + "12",
            border: "2px solid var(--bp-operational)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "float 3s ease-in-out infinite",
          }}>
            <Play size={32} style={{ color: "var(--bp-operational)" }} />
          </div>
          <div style={{ textAlign: "center", maxWidth: 480 }}>
            <div style={{ ...S.display, fontSize: 32, fontWeight: 700, color: "var(--bp-ink-primary)", marginBottom: 12, lineHeight: 1.2 }}>
              Pipeline Ready
            </div>
            <div style={{ ...S.sans, fontSize: 15, color: "var(--bp-ink-secondary)", lineHeight: 1.6, marginBottom: 20 }}>
              Start a new pipeline run to begin loading data across the Landing Zone, Bronze, and Silver layers. Monitor progress in real-time with live metrics and detailed per-entity tracking.
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <div style={{ ...S.cardInset, padding: "12px 16px", textAlign: "left" }}>
                <div style={{ ...S.sans, fontSize: 11, fontWeight: 600, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 4 }}>
                  Quick Start
                </div>
                <div style={{ ...S.sans, fontSize: 13, color: "var(--bp-ink-secondary)" }}>
                  Click "Run Pipeline" above to configure
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div style={{ position: "relative" }}>
        {progressLoading && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 10,
            background: "rgba(244,242,237,0.75)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            ...S.sans, fontSize: 13, color: "var(--bp-ink-secondary)",
          }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "var(--bp-copper)" }} />
            {progress ? "Refreshing…" : "Loading pipeline data…"}
          </div>
        )}
        <KpiStrip progress={progress} />
        <PhaseRail progress={progress} engine={engine} />
        <SourceLayerMatrix progress={progress} engine={engine} sourceNames={availableSources} />
      </div>
      )}

      {/* Section divider */}
      <div style={{ height: 1, background: "linear-gradient(90deg, transparent, var(--bp-border), transparent)", margin: "20px 0 0" }} />

      {/* Tab bar — Redesigned with premium appearance and motion */}
      <div style={{
        display: "flex", gap: 0, padding: "24px 32px 0",
        borderBottom: "1px solid var(--bp-border)",
      }}>
        {(["live", "history", "entities", "triage", "inventory"] as const).map((tab, idx) => (
          <div key={tab} style={{ position: "relative" }}>
            <button
              onClick={() => dispatch({ type: "SET_TAB", tab })}
              style={{
                padding: "12px 20px 16px",
                ...S.sans, fontSize: 14, fontWeight: scope.activeTab === tab ? 700 : 500,
                color: scope.activeTab === tab ? "var(--bp-ink-primary)" : "var(--bp-ink-tertiary)",
                background: "none", border: "none",
                cursor: "pointer",
                textTransform: "capitalize",
                transition: "color 0.2s ease",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              {tab === "live" && <Activity size={16} style={{ opacity: 0.7 }} />}
              {tab}
            </button>
            {scope.activeTab === tab && (
              <div style={{
                position: "absolute", bottom: -1, left: 0, right: 0,
                height: 2, background: "var(--bp-copper)",
                animation: "slideInUp 0.3s ease-out",
              }} />
            )}
          </div>
        ))}
      </div>

      {/* Tab content + Context panel */}
      <div style={{ display: "flex", padding: "24px 32px 40px", gap: 20, minHeight: 520 }}>
        <div style={{ flex: 1, minWidth: 0, animation: "slideInUp 0.5s ease-out 0.1s backwards" }}>
          {scope.activeTab === "live" && <LiveTailTab events={sseEvents} onClear={clearSse} />}
          {scope.activeTab === "history" && <HistoryTab entities={entities} total={entityTotal} loading={entitiesLoading} />}
          {scope.activeTab === "entities" && <EntitiesTab entities={entities} total={entityTotal} loading={entitiesLoading} onRetryEntity={handleRetryEntity} />}
          {scope.activeTab === "triage" && <TriageTab progress={progress} onRetryErrorType={handleRetryErrorType} />}
          {scope.activeTab === "inventory" && <InventoryTab progress={progress} />}
        </div>
        {scope.contextOpen && (
          <div style={{ animation: "slideInDown 0.4s ease-out" }}>
            <ContextPanel entity={selectedEntity} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoadMissionControl() {
  return (
    <ScopeProvider>
      <LoadMissionControlInner />
    </ScopeProvider>
  );
}

// --- END PHASE 1-2 --- // Phases 3-5 continue below
