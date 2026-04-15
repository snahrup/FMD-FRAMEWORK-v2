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
 * Design system: BP tokens (--bp-*), borders-only depth, Manrope.
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
  ChevronDown, ChevronRight, Circle, Database, HelpCircle,
  Layers, Loader2, Pause, Play, RefreshCw,
  RotateCcw, Search, Server, Square, Timer, X, XCircle, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AreaChart, Area, ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import CompactPageHeader from "@/components/layout/CompactPageHeader";

const API = import.meta.env.VITE_API_URL || "";

function shortRunId(runId: string): string {
  return runId.length > 8 ? runId.slice(0, 8) : runId;
}

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
  sourceFilter?: string[];
  entityFilter?: number[];
  resolvedEntityCount?: number;
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

interface SourceLayerProgress {
  source: string;
  layer: string;
  succeeded: number;
  failed: number;
  skipped: number;
  rows_read: number;
  bytes: number;
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
  latestError?: string | null;
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

interface ProgressResponse {
  run: LmcRun | null;
  totalActiveEntities: number;
  layers: Record<string, LayerStats>;
  bySource: SourceProgress[];
  bySourceByLayer?: SourceLayerProgress[];
  errorBreakdown: Array<{ ErrorType: string; cnt: number }>;
  loadTypeBreakdown: Array<{ LoadType: string; cnt: number; total_rows: number }>;
  throughput: { rows_per_sec: number; bytes_per_sec: number };
  verification: Verification;
  selfHeal: SelfHealPayload;
  lakehouseState: Record<string, LakehouseLayerState>;
  lakehouseBySource: LakehouseBySourceItem[];
  serverTime: string;
}

interface RunScopeInventoryLayerStatus {
  status: string;
  at: string | null;
  runId: string | null;
  errorMessage: string | null;
  rowsRead: number;
  rowsWritten: number;
}

interface RunScopeHistoryLayerStatus {
  latestStatus: string | null;
  latestAt: string | null;
  latestRunId: string | null;
  everSucceeded: boolean;
  lastSuccessAt: string | null;
  lastSuccessRunId: string | null;
}

interface RunScopePhysicalLayerStatus {
  exists: boolean;
  rowCount: number | null;
  scannedAt: string | null;
  scanFailed: boolean;
}

interface RunScopeInventoryEntity {
  entityId: number;
  source: string;
  sourceDisplay: string;
  schema: string;
  table: string;
  isIncremental: boolean;
  watermarkColumn: string | null;
  lastWatermark: string | null;
  runAttempted: boolean;
  runMissingLayers: string[];
  neverSucceededLayers: string[];
  missingPhysicalLayers: string[];
  nextAction: string;
  nextActionLabel: string;
  nextActionReason: string;
  runLayerStatus: Record<string, RunScopeInventoryLayerStatus>;
  historyLayerStatus: Record<string, RunScopeHistoryLayerStatus>;
  physicalLayerStatus: Record<string, RunScopePhysicalLayerStatus>;
}

interface RunScopeInventoryResponse {
  run: {
    runId: string;
    status: string;
    layersInScope: string[];
    sourceFilter: string[];
    entityFilter: number[];
    resolvedEntityCount: number;
  };
  summary: {
    scopeEntityCount: number;
    attemptedInRunCount: number;
    runGapCount: number;
    runMissingByLayer: Record<string, number>;
    historicalMissingByLayer: Record<string, number>;
    physicalMissingByLayer: Record<string, number>;
  };
  entities: RunScopeInventoryEntity[];
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
  selfHeal: SelfHealPayload;
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

const SELF_HEAL_WORKFLOW = [
  { key: "queued", label: "Queue failure" },
  { key: "collecting_context", label: "Collect context" },
  { key: "invoking_agent", label: "Invoke local CLI" },
  { key: "validating_patch", label: "Validate patch" },
  { key: "retrying", label: "Retry entity" },
  { key: "resolved", label: "Return to run" },
] as const;

const RETRY_BLOCKED_MESSAGE =
  "Retry is unavailable while a run is active. Wait for the current run to finish or stop it first.";

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
  /** Sources selected for the current run (empty = all sources) */
  runSources: string[];
  /** Current page offset for entities/history tabs */
  entityPage: number;
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
  | { type: "SET_RUN_SOURCES"; sources: string[] }
  | { type: "SET_ENTITY_PAGE"; page: number }
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
  runSources: [],
  entityPage: 0,
};

function scopeReducer(state: Scope, action: ScopeAction): Scope {
  switch (action.type) {
    case "SET_RUN":
      return { ...state, selectedRunId: action.runId, selectedEntityId: null };
    case "SET_SOURCES":
      return { ...state, selectedSources: action.sources, entityPage: 0 };
    case "SET_LAYERS":
      return { ...state, selectedLayers: action.layers, entityPage: 0 };
    case "SET_STATUSES":
      return { ...state, selectedStatuses: action.statuses, entityPage: 0 };
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
      return {
        ...state,
        engineStatus: action.status,
        isRunActive: action.isRunActive,
        // Keep runSources sticky — only clear when user explicitly starts a new run
        // or clicks the clear button. Never let polling wipe scope mid-run.
      };
    case "CLICK_MATRIX_CELL":
      return {
        ...state,
        selectedSources: [action.source],
        selectedLayers: [action.layer],
        activeTab: "entities",
      };
    case "SET_RUN_SOURCES":
      return { ...state, runSources: action.sources };
    case "SET_ENTITY_PAGE":
      return { ...state, entityPage: action.page };
    case "CLEAR_SCOPE":
      return { ...initialScope, selectedRunId: state.selectedRunId, engineStatus: state.engineStatus, isRunActive: state.isRunActive, runSources: state.runSources };
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
        sourceFilter: r.SourceFilter ?? r.sourceFilter ?? [],
        entityFilter: r.EntityFilter ?? r.entityFilter ?? [],
        resolvedEntityCount: r.ResolvedEntityCount ?? r.resolvedEntityCount ?? 0,
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

function useRunScopeInventory(runId: string | null, enabled: boolean, pollMs = 15000) {
  const [data, setData] = useState<RunScopeInventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    if (!enabled || !runId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/lmc/run/${runId}/scope-inventory`);
      if (!res.ok) return;
      setData(await res.json());
    } catch { /* swallow */ }
    finally { setLoading(false); }
  }, [enabled, runId]);

  useEffect(() => {
    fetch_();
    if (!enabled || !runId || pollMs <= 0) return;
    const iv = setInterval(fetch_, pollMs);
    return () => clearInterval(iv);
  }, [enabled, fetch_, pollMs, runId]);

  return { data, loading, refetch: fetch_ };
}

function useSSE(enabled: boolean) {
  const [events, setEvents] = useState<Array<{ type: string; data: unknown; ts: number }>>([]);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  const connect = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const es = new EventSource(`${API}/api/engine/logs/stream`);
    esRef.current = es;

    const handler = (eventType: string) => (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents(prev => [...prev.slice(-499), { type: eventType, data: parsed, ts: Date.now() }]);
      } catch { /* ignore malformed */ }
    };

    es.addEventListener("entity_result", handler("entity_result"));
    es.addEventListener("log", handler("log"));
    es.addEventListener("run_complete", handler("run_complete"));
    es.addEventListener("run_error", handler("run_error"));
    es.addEventListener("bulk_progress", handler("bulk_progress"));
    es.onmessage = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents(prev => [...prev.slice(-499), { type: parsed.type ?? "log", data: parsed, ts: Date.now() }]);
      } catch { /* ignore */ }
    };

    es.onopen = () => { retryCountRef.current = 0; };
    es.onerror = () => {
      es.close();
      esRef.current = null;
      // Exponential backoff reconnect: 1s, 2s, 4s, 8s, max 15s
      const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 15000);
      retryCountRef.current++;
      retryRef.current = setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      esRef.current?.close();
      esRef.current = null;
      if (retryRef.current) clearTimeout(retryRef.current);
      retryCountRef.current = 0;
      return;
    }
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [enabled, connect]);

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

// ═══════════════════════════════════════════════════════════════════════════════
// §5  INLINE STYLE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const S = {
  mono: { fontFamily: "var(--bp-font-mono, 'Manrope', sans-serif)" } as React.CSSProperties, // monospace-like contexts (tabular data, logs)
  data: { fontFamily: "var(--bp-font-body, 'Manrope', sans-serif)", fontVariantNumeric: "tabular-nums" } as React.CSSProperties, // numbers with aligned columns
  sans: { fontFamily: "var(--bp-font-body, 'Manrope', sans-serif)" } as React.CSSProperties,
  display: { fontFamily: "var(--bp-font-display, 'Manrope', sans-serif)" } as React.CSSProperties,
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

// ── Extraction method helpers (Task 7) ──
function ExtractionBadge({ method }: { method: string }) {
  const isCx = method === "connectorx";
  return (
    <span style={{
      ...S.badge,
      fontSize: 10,
      padding: "1px 6px",
      background: isCx ? "var(--bp-copper)" : "var(--bp-surface-inset)",
      color: isCx ? "#fff" : "var(--bp-ink-secondary)",
      fontFamily: "var(--bp-font-mono)",
    }}>
      {isCx ? "CX" : method === "pyodbc" ? "ODBC" : "—"}
    </span>
  );
}

function PipelineStack({ method }: { method: string }) {
  const steps = method === "connectorx"
    ? ["ConnectorX", "Polars", "Snappy Parquet", "OneLake"]
    : ["pyodbc", "pandas", "PyArrow Parquet", "OneLake"];
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 8 }}>
      {steps.map((s, i) => (
        <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {i > 0 && <span style={{ color: "var(--bp-ink-tertiary)", fontSize: 10 }}>→</span>}
          <span style={{
            ...S.badge,
            fontSize: 10,
            padding: "2px 8px",
            background: "var(--bp-surface-inset)",
            color: "var(--bp-ink-secondary)",
            fontFamily: "var(--bp-font-mono)",
          }}>{s}</span>
        </span>
      ))}
    </div>
  );
}

// Shared constants (must be before components that use them)
const LAYER_ORDER = ["landing", "bronze", "silver", "gold"] as const;
const LAYER_LABELS: Record<string, string> = { landing: "Landing Zone", bronze: "Bronze", silver: "Silver", gold: "Gold" };

function StatusBadge({ currentRun, engineStatus }: { currentRun: LmcRun | null; engineStatus: string }) {
  const runStatus = currentRun?.status ?? "";
  const showStatus = currentRun ? runStatus : engineStatus;
  // Insert spaces before uppercase letters (InProgress → In Progress, etc.)
  const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
  const label = currentRun ? humanize(runStatus) : humanize(engineStatus);
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
  onStart: (layers: string[], sourceFilter: string[], mode?: string) => void;
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
  const [bulkMode, setBulkMode] = useState(false);

  const currentRun = runs.find(r => r.runId === scope.selectedRunId) ?? null;
  const canResume = Boolean(
    currentRun &&
    scope.engineStatus === "idle" &&
    ["interrupted", "aborted", "failed"].includes(currentRun.status.toLowerCase())
  );
  const canRetry = Boolean(currentRun && ["completed", "failed"].includes(currentRun.status.toLowerCase()));
  const viewingHistoricalRun = Boolean(
    engine?.status === "running" &&
    engine.current_run_id &&
    scope.selectedRunId &&
    engine.current_run_id !== scope.selectedRunId
  );

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
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      ...S.sans,
    }}>
      {/* Main command row */}
      <div style={{ padding: "10px 32px", display: "flex", alignItems: "center", gap: 14 }}>
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
                    {r.status.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status badge — shows selected run's status, or engine status if no run selected */}
        <StatusBadge currentRun={currentRun} engineStatus={scope.engineStatus} />

        {viewingHistoricalRun && engine?.current_run_id && (
          <button
            onClick={() => dispatch({ type: "SET_RUN", runId: engine.current_run_id ?? null })}
            style={{
              ...S.badge,
              cursor: "pointer",
              border: "1px solid rgba(180,86,36,0.18)",
              background: "rgba(180,86,36,0.08)",
              color: "var(--bp-copper)",
              padding: "6px 10px",
              fontSize: 11,
            }}
          >
            <Activity size={12} /> View Active {shortRunId(engine.current_run_id)}
          </button>
        )}

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
          ) : null}
          <button
            onClick={() => window.location.assign(`/load-center${scope.selectedRunId ? `?run=${scope.selectedRunId}` : ""}`)}
            style={{
              ...S.badge, cursor: "pointer", border: "1px solid var(--bp-operational)",
              background: "var(--bp-operational)" + "12", color: "var(--bp-operational)",
              padding: "6px 14px", fontSize: 12,
            }}
          >
            <Play size={12} /> Open Load Center
          </button>
      </div>
    </div>

      {/* Launch modal overlay */}
      {launchOpen && scope.engineStatus !== "running" && (
        <div
          onClick={() => setLaunchOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "slideInUp 0.3s ease-out",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              ...S.card, background: "var(--bp-surface-1)",
              width: 560, maxWidth: "90vw",
              padding: 0, overflow: "hidden",
              border: "2px solid var(--bp-border)",
              animation: "slideInUp 0.4s var(--ease-claude)",
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

              {/* Bulk Snapshot toggle */}
              <button
                onClick={() => {
                  setBulkMode(!bulkMode);
                  if (!bulkMode) setLaunchLayers(["landing"]);
                  else setLaunchLayers(["landing", "bronze", "silver"]);
                }}
                style={{
                  ...S.sans, cursor: "pointer", width: "100%",
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 16px", borderRadius: 8,
                  border: bulkMode ? "1.5px solid var(--bp-operational)" : "1px solid var(--bp-border)",
                  background: bulkMode ? "rgba(34,197,94,0.06)" : "var(--bp-surface-1)",
                  transition: "all 0.15s ease",
                }}>
                <Zap size={16} style={{ color: bulkMode ? "var(--bp-operational)" : "var(--bp-ink-muted)", flexShrink: 0 }} />
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: bulkMode ? "var(--bp-operational)" : "var(--bp-ink)" }}>
                    Bulk Snapshot Mode
                  </div>
                  <div style={{ fontSize: 11, color: "var(--bp-ink-muted)", marginTop: 1 }}>
                    Fast parallel extraction via ConnectorX — no watermarks, no retries. Best for initial loads &amp; backfills.
                  </div>
                </div>
                <div style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: bulkMode ? "var(--bp-operational)" : "var(--bp-border)",
                  position: "relative", transition: "background 0.15s ease",
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: 8,
                    background: "#fff", position: "absolute", top: 2,
                    left: bulkMode ? 18 : 2, transition: "left 0.15s ease",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                  }} />
                </div>
              </button>
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
                  onStart(launchLayers, launchSources.map(s => s), bulkMode ? "bulk" : "run");
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

interface BulkProgressData {
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  totalRows: number;
  totalBytes: number;
  pct: number;
  etaSeconds: number | null;
  activeWorkers: number | null;
}

function KpiStrip({ progress, bulkProgress }: { progress: ProgressResponse | null; bulkProgress?: BulkProgressData | null }) {
  const scope = useScope();
  const hasRunScope = scope.runSources.length > 0;

  if (!progress) return null;

  // When run is scoped to specific sources, derive KPIs from bySource instead of global layers
  const scopedSources = hasRunScope
    ? (progress.bySource ?? []).filter(s => scope.runSources.includes(s.source))
    : (progress.bySource ?? []);

  const allLayers = Object.values(progress.layers);

  // When bulk progress SSE data is available and fresher, use it as the single source of truth
  // This prevents timing mismatches between SSE heartbeat and progress API polling
  const useBulk = bulkProgress && bulkProgress.total > 0 && scope.isRunActive;

  const succeeded = useBulk
    ? bulkProgress.succeeded
    : hasRunScope
      ? scopedSources.reduce((a, s) => a + (s.succeeded ?? 0), 0)
      : allLayers.reduce((a, l) => a + l.succeeded, 0);
  const failed = useBulk
    ? bulkProgress.failed
    : hasRunScope
      ? scopedSources.reduce((a, s) => a + (s.failed ?? 0), 0)
      : allLayers.reduce((a, l) => a + l.failed, 0);
  const skipped = 0; // Bulk doesn't skip; for non-bulk use layer data
  // Use totalActiveEntities as the stable denominator — it's always 1385 and never changes
  // during a run. The scoped source reduce can give inconsistent totals between poll cycles.
  const scopedTotal = useBulk
    ? bulkProgress.total
    : progress.totalActiveEntities;
  const pending = scopedTotal - succeeded - failed - skipped;
  const totalRows = useBulk
    ? bulkProgress.totalRows
    : hasRunScope
      ? scopedSources.reduce((a, s) => a + (s.rows_read ?? 0), 0)
      : allLayers.reduce((a, l) => a + l.total_rows_written, 0);
  const totalDuration = allLayers.reduce((a, l) => a + l.total_duration, 0);

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
            This Run Loaded
          </div>
          <div style={{ ...S.data, fontSize: 32, fontWeight: 700, color: "var(--bp-operational)", lineHeight: 1, marginBottom: 6 }} className="metric-value">
            {formatNumber(succeeded)}
          </div>
          <div style={{ ...S.data, fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            of {formatNumber(scopedTotal)} targeted table{scopedTotal === 1 ? "" : "s"}
          </div>
        </div>

        {/* Failed (alert metric) */}
        <div style={{
          ...S.cardInset, padding: "20px 24px",
          borderLeft: `4px solid ${failed > 0 ? "var(--bp-fault)" : "var(--bp-ink-muted)"}`,
          animation: "slideInUp 0.5s ease-out 0.08s backwards",
        }}>
          <div style={{ ...S.sans, fontSize: 11, fontWeight: 700, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
            This Run Failed
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
            This Run Remaining
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
          <div style={{ ...S.sans, fontSize: 10, fontWeight: 600, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", marginBottom: 4 }}>Rows This Run</div>
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
        {/* Throughput + sparkline (Task 8) */}
        <div style={{ ...S.card, padding: "12px 16px" }}>
          <div style={{ ...S.sans, fontSize: 10, fontWeight: 600, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", marginBottom: 4 }}>Throughput</div>
          <div style={{ ...S.data, fontSize: 18, fontWeight: 600, color: "var(--bp-ink-secondary)" }}>
            {progress.throughput ? `${formatNumber(Math.round(progress.throughput.rows_per_sec))}/s` : "—"}
          </div>
          {(() => {
            const sparklineData = (progress.bySource ?? [])
              .filter(s => (s.rows_read ?? 0) > 0)
              .map(s => ({ rowsPerSec: s.rows_read ?? 0 }));
            return sparklineData.length > 2 ? (
              <div style={{ marginTop: 6, height: 28 }}>
                <ResponsiveContainer width="100%" height={28}>
                  <AreaChart data={sparklineData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <Area
                      type="monotone"
                      dataKey="rowsPerSec"
                      stroke="var(--bp-copper)"
                      fill="var(--bp-copper)"
                      fillOpacity={0.15}
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : null;
          })()}
        </div>
        {/* Run scope */}
        <div style={{ ...S.card, padding: "12px 16px", borderLeft: `3px solid var(--bp-operational)` }}>
          <div style={{ ...S.sans, fontSize: 10, fontWeight: 600, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", marginBottom: 4 }}>Run Scope</div>
          <div style={{ ...S.data, fontSize: 18, fontWeight: 600, color: "var(--bp-operational)" }}>
            {formatNumber(scopedTotal)}
          </div>
          <div style={{ ...S.data, fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            {hasRunScope ? `${scope.runSources.length} selected source${scope.runSources.length === 1 ? "" : "s"}` : "all active sources"}
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
              transition: "all 0.3s var(--ease-claude)",
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
// §9  SELF-HEAL RAIL — queued/active/resolved bounded self-heal visibility
// ═══════════════════════════════════════════════════════════════════════════════

function SelfHealRail({
  selfHeal,
  expanded,
  onToggle,
}: {
  selfHeal: SelfHealPayload | null | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!selfHeal || !(selfHeal.configured || selfHeal.selectedAgent || selfHeal.summary.totalCount > 0)) return null;

  const focus = selfHeal.cases.find((item) =>
    ["collecting_context", "invoking_agent", "validating_patch", "retrying"].includes(item.status),
  ) ?? selfHeal.cases[0];
  const daemonTone = !selfHeal.runtime.workerPid && selfHeal.runtime.status === "idle"
    ? { background: "rgba(59,130,246,0.12)", color: "#1d4ed8", label: "armed" }
    : selfHeal.runtime.healthy
      ? { background: "rgba(34,197,94,0.12)", color: "#15803d", label: selfHeal.runtime.status.replaceAll("_", " ") }
      : { background: "rgba(245,158,11,0.12)", color: "#b45309", label: selfHeal.runtime.status.replaceAll("_", " ") };
  const activeIndex = focus
    ? Math.max(
        0,
        SELF_HEAL_WORKFLOW.findIndex((step) =>
          step.key === "resolved"
            ? ["succeeded", "resolved"].includes(focus.status) || focus.currentStep === "resolved"
            : focus.status === step.key || focus.currentStep === step.key,
        ),
      )
    : -1;
  const compactSignal = focus
    ? focus.status.replaceAll("_", " ")
    : selfHeal.summary.queuedCount > 0
      ? `${selfHeal.summary.queuedCount} queued`
      : daemonTone.label;

  return (
    <div style={{
      width: "100%",
      border: "1px solid rgba(59,130,246,0.18)",
      borderRadius: 12,
      background: "rgba(255,255,255,0.92)",
      overflow: "hidden",
      boxShadow: "0 8px 24px rgba(15,23,42,0.04)",
    }}>
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
          background: "rgba(248,250,252,0.8)",
          borderBottom: expanded ? "1px solid rgba(91,84,76,0.10)" : "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ ...S.sans, fontSize: 10, fontWeight: 700, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Self-Heal
          </span>
          <span style={{ ...S.display, fontSize: expanded ? 14 : 24, fontWeight: 700, color: "var(--bp-ink-primary)", lineHeight: 1 }}>
            {expanded ? "Queue" : selfHeal.summary.totalCount}
          </span>
          <span style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-secondary)", lineHeight: 1.4 }}>
            {expanded ? "Bounded repair flow outside the main rail." : compactSignal}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: expanded ? "row" : "column", alignItems: expanded ? "center" : "flex-start", gap: 8 }}>
          {!expanded && (
            <span style={{
              padding: "4px 8px",
              borderRadius: 999,
              background: daemonTone.background,
              color: daemonTone.color,
              fontSize: 10,
              fontWeight: 700,
            }}>
              {daemonTone.label}
            </span>
          )}
          {expanded ? <ChevronDown size={16} style={{ color: "var(--bp-ink-muted)" }} /> : <ChevronRight size={16} style={{ color: "var(--bp-ink-muted)" }} />}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: "12px 14px 14px", display: "grid", gap: 12 }}>
          <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
            {selfHeal.note}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[
              { label: "Queued", value: selfHeal.summary.queuedCount, color: "#1d4ed8" },
              { label: "Working", value: selfHeal.summary.activeCount, color: "var(--bp-copper)" },
              { label: "Resolved", value: selfHeal.summary.succeededCount, color: "var(--bp-operational)" },
              { label: "Exhausted", value: selfHeal.summary.exhaustedCount, color: "var(--bp-fault)" },
            ].map((item) => (
              <span key={item.label} style={{
                padding: "4px 8px",
                borderRadius: 999,
                background: `${item.color}12`,
                color: item.color,
                fontSize: 11,
                fontWeight: 700,
              }}>
                {item.label}: {item.value}
              </span>
            ))}
            <span style={{
              padding: "4px 8px",
              borderRadius: 999,
              background: daemonTone.background,
              color: daemonTone.color,
              fontSize: 11,
              fontWeight: 700,
            }}>
              Daemon: {daemonTone.label}
            </span>
            <span style={{
              padding: "4px 8px",
              borderRadius: 999,
              background: "rgba(148,163,184,0.12)",
              color: "var(--bp-ink-secondary)",
              fontSize: 11,
              fontWeight: 700,
            }}>
              Agent: {(selfHeal.selectedAgent || "not detected").replaceAll("_", " ")}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SELF_HEAL_WORKFLOW.map((step, index) => {
              const state = focus
                ? index < activeIndex
                  ? "done"
                  : index === activeIndex
                    ? "active"
                    : "pending"
                : selfHeal.summary.totalCount
                  ? "pending"
                  : "standby";
              const tone =
                state === "done"
                  ? { background: "rgba(34,197,94,0.12)", color: "var(--bp-operational)" }
                  : state === "active"
                    ? { background: "rgba(196,122,90,0.14)", color: "var(--bp-copper)" }
                    : state === "standby"
                      ? { background: "rgba(148,163,184,0.12)", color: "var(--bp-ink-secondary)" }
                      : { background: "rgba(59,130,246,0.10)", color: "#1d4ed8" };
              return (
                <span key={step.key} style={{ padding: "4px 8px", borderRadius: 999, background: tone.background, color: tone.color, fontSize: 11, fontWeight: 700 }}>
                  {step.label}
                </span>
              );
            })}
          </div>
          {focus ? (
            <div style={{ border: "1px solid rgba(91,84,76,0.12)", borderRadius: 12, background: "rgba(255,255,255,0.88)", padding: "12px 12px 10px", display: "grid", gap: 10 }}>
              <div style={{ ...S.sans, fontSize: 12, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                Focus case
              </div>
              <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
                {focus.source}.{focus.schema}.{focus.table} · {focus.layer}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(59,130,246,0.12)", color: "#1d4ed8", fontSize: 11, fontWeight: 700 }}>
                  {focus.status.replaceAll("_", " ")}
                </span>
                <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(148,163,184,0.12)", color: "var(--bp-ink-secondary)", fontSize: 11, fontWeight: 700 }}>
                  attempt {focus.attemptCount}/{focus.maxAttempts}
                </span>
                {focus.retryRunId && (
                  <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(196,122,90,0.12)", color: "var(--bp-copper)", fontSize: 11, fontWeight: 700 }}>
                    retry {focus.retryRunId.slice(0, 8)}
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {focus.events.slice(0, 4).map((event) => (
                  <div key={event.id} style={{ borderLeft: "2px solid rgba(59,130,246,0.28)", paddingLeft: 10 }}>
                    <div style={{ ...S.sans, fontSize: 11, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                      {event.step.replaceAll("_", " ")}
                    </div>
                    <div style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-secondary)", lineHeight: 1.5, marginTop: 2 }}>
                      {event.message}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ border: "1px solid rgba(91,84,76,0.12)", borderRadius: 12, background: "rgba(255,255,255,0.88)", padding: "12px 12px 10px", display: "grid", gap: 10 }}>
              <div style={{ ...S.sans, fontSize: 12, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                Self-heal standing by
              </div>
              <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                The engine queues failed entities immediately. Once the active run is idle, the daemon gathers context, invokes the local `claude` or `codex` CLI, validates the patch, launches a targeted retry, then returns operators to the original run truth when the retry passes.
              </div>
              <div style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-muted)" }}>
                {selfHeal.runtime.lastMessage || "No queued self-heal cases yet."}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §9  SOURCE × LAYER MATRIX
// ═══════════════════════════════════════════════════════════════════════════════

function SourceLayerMatrix({ progress, engine, sourceNames }: { progress: ProgressResponse | null; engine: EngineStatusResponse | null; sourceNames: SourceInfo[] }) {
  const scope = useScope();
  const dispatch = useScopeDispatch();
  const hasRunScope = scope.runSources.length > 0;

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
  }, [progress]);

  const layerKeys = ["landing", "bronze", "silver"] as const;
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
  }, [progress]);

  const lhNameForLayer = (layer: string) => {
    switch (layer) {
      case "landing": return "LH_DATA_LANDINGZONE";
      case "bronze": return "LH_BRONZE_LAYER";
      case "silver": return "LH_SILVER_LAYER";
      default: return "";
    }
  };

  // Build per-source-layer lookup from the granular data
  const srcLayerLookup = useMemo(() => {
    const map: Record<string, SourceLayerProgress> = {};
    for (const item of progress?.bySourceByLayer ?? []) {
      map[`${item.source}|${item.layer}`] = item;
    }
    return map;
  }, [progress]);

  const cells: MatrixCell[][] = !progress
    ? []
    : sources.map(source => {
        return layerKeys.map(layer => {
          const srcData = progress.bySource?.find(s => s.source === source);
          const srcTotal = srcData?.total_entities ?? 0;
          // Layer-accurate run data (from bySourceByLayer)
          const layerData = srcLayerLookup[`${source}|${layer}`];
          // Lakehouse physical data for this source × layer
          const lhItem = lhLookup[`${source}|${lhNameForLayer(layer)}`];

          return {
            source,
            layer,
            total: srcTotal,
            // Use layer-specific counts when available, otherwise 0
            // This ensures bulk (landing-only) runs don't show counts in Bronze/Silver
            succeeded: layerData?.succeeded ?? 0,
            failed: layerData?.failed ?? 0,
            skipped: layerData?.skipped ?? 0,
            inProgress: currentLayer != null && currentLayer.includes(layer),
            verified: lhItem != null && lhItem.tables_loaded > 0,
            physicalRows: lhItem?.total_rows ?? null,
          } as MatrixCell;
        });
      });

  if (sources.length === 0) return null;

  const isSelected = (source: string, layer: string) =>
    scope.selectedSources.includes(source) && scope.selectedLayers.includes(layer);

  // Separate in-scope and out-of-scope rows for layout
  const scopedRows = cells.map((row, ri) => ({
    row,
    source: row[0]?.source ?? sources[ri],
    inScope: !hasRunScope || scope.runSources.includes(row[0]?.source ?? sources[ri]),
  }));

  const gridCols = `140px repeat(${layerKeys.length}, 1fr) 80px`;

  // Extracted to avoid complex inline expressions that confuse esbuild's JSX parser
  const cellBorderColor = (cell: MatrixCell, selected: boolean, inScope: boolean) => {
    if (selected) return layerColor(cell.layer);
    if (hasRunScope && inScope) return layerColor(cell.layer) + "40";
    return "var(--bp-border-subtle)";
  };

  return (
    <div style={{ padding: "24px 32px 0", display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Header row */}
      <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 8 }}>
        <div style={{ padding: "4px 8px" }} />
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
      </div>

      {/* Data rows */}
      {scopedRows.map(({ row, source, inScope }) => {
        const srcData = progress?.bySource?.find(s => s.source === source);
        const totalFailed = srcData?.failed ?? 0;

        return (
          <div
            key={source}
            style={{
              display: "grid",
              gridTemplateColumns: gridCols,
              gap: 8,
              width: "100%",
              maxHeight: hasRunScope && !inScope ? 0 : 120,
              opacity: hasRunScope && !inScope ? 0 : 1,
              overflow: "hidden",
              marginTop: hasRunScope && !inScope ? -8 : 0,
              transition: "max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease, margin 0.5s ease",
              pointerEvents: hasRunScope && !inScope ? "none" : "auto",
            }}
          >
            {/* Source label */}
            <div style={{
              padding: "8px 8px",
              ...S.sans, fontSize: 13, fontWeight: 600,
              color: "var(--bp-ink-primary)",
              display: "flex", alignItems: "center", gap: 6,
              overflow: "hidden",
            }}>
              <Server size={12} style={{ color: hasRunScope && inScope ? "var(--bp-copper)" : "var(--bp-ink-muted)", flexShrink: 0, transition: "color 0.3s ease" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayNameMap[source] || source}</span>
            </div>

            {/* Layer cells */}
            {row.map(cell => {
              const selected = isSelected(cell.source, cell.layer);
              const pct = cell.total > 0 ? Math.round((cell.succeeded / cell.total) * 100) : 0;
              const trust = trustBadge(cell.verified ? true : cell.physicalRows != null ? true : null);
              const TrustIcon = trust.icon;
              const border = cellBorderColor(cell, selected, inScope);

              return (
                <div
                  key={cell.layer}
                  onClick={() => dispatch({ type: "CLICK_MATRIX_CELL", source: cell.source, layer: cell.layer })}
                  style={{
                    ...S.cell,
                    padding: "14px 12px 16px",
                    background: selected
                      ? layerLightColor(cell.layer)
                      : cell.inProgress
                        ? layerLightColor(cell.layer)
                        : "var(--bp-surface-1)",
                    borderColor: border,
                    borderWidth: selected ? 2 : 1,
                    position: "relative",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    minHeight: 72, gap: 6,
                    animation: cell.inProgress ? "pulse 2s ease-in-out infinite" : "none",
                    transition: "all 0.3s ease",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = layerColor(cell.layer);
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = border;
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  {/* Count */}
                  <div style={{ ...S.data, fontSize: 16, fontWeight: 700, color: "var(--bp-ink-primary)", lineHeight: 1.2 }}>
                    {formatNumber(cell.succeeded)}
                    <span style={{ color: "var(--bp-ink-muted)", fontWeight: 400, fontSize: 13 }}>{" / "}{formatNumber(cell.total)}</span>
                  </div>
                  {/* Percentage */}
                  {cell.total > 0 && (
                    <div style={{ ...S.data, fontSize: 10, fontWeight: 600, color: pct === 100 ? "var(--bp-operational)" : "var(--bp-ink-muted)" }}>
                      {pct}%
                    </div>
                  )}
                  {/* Progress bar */}
                  <div style={{
                    width: "100%", height: 4, borderRadius: 3,
                    background: "var(--bp-border)", marginTop: 2,
                    overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%", borderRadius: 3,
                      width: `${pct}%`,
                      background: pct === 100 ? "var(--bp-operational)" : cell.failed > 0 ? "var(--bp-fault)" : layerColor(cell.layer),
                      transition: "width 0.5s ease",
                    }} />
                  </div>
                  {/* Trust indicator */}
                  <TrustIcon size={11} style={{
                    position: "absolute", top: 5, right: 5,
                    color: trust.color,
                  }} />
                </div>
              );
            })}

            {/* Failed column */}
            <div
              style={{
                ...S.cell,
                padding: "12px 10px 14px",
                background: totalFailed > 0 ? "var(--bp-fault)" + "0A" : "var(--bp-surface-1)",
                borderColor: totalFailed > 0 ? "var(--bp-fault)" + "30" : "var(--bp-border-subtle)",
                display: "flex", alignItems: "center", justifyContent: "center",
                minHeight: 64,
                cursor: totalFailed > 0 ? "pointer" : "default",
                transition: "all 0.3s ease",
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
            height: "100%", color: "var(--bp-ink-muted)", gap: 12, padding: "40px 20px",
          }}>
            <Activity size={28} style={{ opacity: 0.3, animation: scope.isRunActive ? "pulse 2s ease-in-out infinite" : "none" }} />
            <span style={{ ...S.sans, fontSize: 14, fontWeight: 600, color: "var(--bp-ink-secondary)" }}>
              {scope.isRunActive ? "Waiting for events..." : "No live activity"}
            </span>
            <span style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-muted)", textAlign: "center", maxWidth: 280 }}>
              {scope.isRunActive ? "Events will appear here as tables are processed" : "Start a pipeline run to see real-time events"}
            </span>
          </div>
        ) : (
          events
            .filter(ev => {
              const d = ev.data as Record<string, unknown>;
              // Only show entity results and important log messages — not server access logs
              if (ev.type === "entity_result" || ev.type === "run_complete" || ev.type === "run_error") {
                // Filter by run-scoped sources if active
                if (scope.runSources.length > 0) {
                  const evSource = (d?.source as string) ?? "";
                  if (evSource && !scope.runSources.includes(evSource)) return false;
                }
                return true;
              }
              if (ev.type === "log") {
                const msg = (d?.message as string) ?? "";
                // Filter out empty, access logs, and routine messages
                if (!msg || msg.trim().length === 0) return false;
                if (msg.startsWith("GET ") || msg.startsWith("POST ")) return false;
                if (msg.includes("SSE") || msg.includes("poller")) return false;
                return true;
              }
              // Filter out any events with no displayable content (no table, no message)
              if (!d?.table && !d?.SourceTable && !d?.message) return false;
              return false;
            })
            .map((ev, i) => {
            const parsed = parseEvent(ev);
            // Skip events that parsed to nothing visible (no table, no error, no layer)
            if (!parsed.table && !parsed.error && !parsed.layer) return null;
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

                {/* Error message — show prominently on failures */}
                {parsed.error && (
                  <span
                    title={parsed.error}
                    style={{
                      ...S.mono, fontSize: 11, color: "var(--bp-fault)",
                      flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      marginLeft: "auto",
                    }}
                  >
                    {parsed.error.slice(0, 120)}
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
        padding: "14px 18px",
        borderBottom: "1px solid var(--bp-border-subtle)",
        background: "var(--bp-surface-inset)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Timer size={14} style={{ color: "var(--bp-ink-muted)" }} />
          <span style={{ ...S.sans, fontSize: 14, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
            History
          </span>
          <span style={{ ...S.data, fontSize: 12, color: "var(--bp-ink-muted)" }}>
            {formatNumber(total)} events
          </span>
        </div>
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
                {["Time", "Source", "Table", "Layer", "Status", "Rows", "Duration", "Engine"].map(h => (
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
                  <td style={{ padding: "6px 10px" }}>
                    <ExtractionBadge method={(e as any).ExtractionMethod || (e as any).extractionMethod || "unknown"} />
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
  retryDisabled: boolean;
  onRetryEntity: (entityId: number) => void;
}

function EntitiesTab({ entities, total, loading, retryDisabled, onRetryEntity }: EntitiesTabProps) {
  const scope = useScope();
  const dispatch = useScopeDispatch();
  const [localSearch, setLocalSearch] = useState(scope.searchQuery);
  const page = scope.entityPage;
  const setPage = useCallback((fn: (p: number) => number) => dispatch({ type: "SET_ENTITY_PAGE", page: fn(scope.entityPage) }), [dispatch, scope.entityPage]);
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
        padding: "14px 18px", borderBottom: "1px solid var(--bp-border-subtle)",
        background: "var(--bp-surface-inset)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Database size={14} style={{ color: "var(--bp-ink-muted)" }} />
          <span style={{ ...S.sans, fontSize: 14, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
            Entities
          </span>
          <span style={{ ...S.data, fontSize: 12, color: "var(--bp-ink-muted)" }}>
            {formatNumber(total)} total
          </span>
        </div>
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
                            type="button"
                            disabled={retryDisabled}
                            title={retryDisabled ? RETRY_BLOCKED_MESSAGE : `Retry only ${e.SourceTable}`}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              if (!retryDisabled) onRetryEntity(e.EntityId);
                            }}
                            style={{
                              ...S.badge, fontSize: 10, padding: "2px 8px",
                              cursor: retryDisabled ? "not-allowed" : "pointer",
                              background: "var(--bp-copper-soft)", color: "var(--bp-copper)",
                              border: "1px solid var(--bp-copper)",
                              opacity: retryDisabled ? 0.5 : 1,
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
  retryDisabled: boolean;
  onRetryErrorType: (errorType: string) => void;
}

function TriageTab({ progress, retryDisabled, onRetryErrorType }: TriageTabProps) {
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

      {retryDisabled && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px",
          borderRadius: 6,
          border: "1px solid var(--bp-caution)",
          background: "var(--bp-caution)" + "12",
        }}>
          <Pause size={14} style={{ color: "var(--bp-caution)", flexShrink: 0 }} />
          <span style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-primary)" }}>
            {RETRY_BLOCKED_MESSAGE}
          </span>
        </div>
      )}

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
                  type="button"
                  disabled={retryDisabled}
                  title={retryDisabled ? RETRY_BLOCKED_MESSAGE : `Retry all failed ${err.ErrorType} entities`}
                  onClick={() => { if (!retryDisabled) onRetryErrorType(err.ErrorType); }}
                  style={{
                    ...S.badge, fontSize: 11,
                    cursor: retryDisabled ? "not-allowed" : "pointer",
                    background: "var(--bp-copper-soft)", color: "var(--bp-copper)",
                    border: "1px solid var(--bp-copper)", padding: "4px 12px",
                    opacity: retryDisabled ? 0.5 : 1,
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
  const scope = useScope();
  const dispatch = useScopeDispatch();
  const [inventoryFilter, setInventoryFilter] = useState<"run_gap" | "never_loaded" | "missing_physical" | "all">("run_gap");
  const [loadFilter, setLoadFilter] = useState<"all" | "incremental" | "full">("all");
  const [search, setSearch] = useState("");
  const { data: inventory, loading, refetch } = useRunScopeInventory(
    scope.selectedRunId,
    Boolean(scope.selectedRunId),
    scope.isRunActive ? 5000 : 15000,
  );

  const entities = inventory?.entities ?? [];
  const runLayers = inventory?.run.layersInScope ?? ["landing", "bronze", "silver"];
  const entityGapCount = useMemo(
    () => entities.filter((entity) => entity.runMissingLayers.length > 0).length,
    [entities],
  );
  const neverLoadedCount = useMemo(
    () => entities.filter((entity) => entity.neverSucceededLayers.length > 0).length,
    [entities],
  );
  const missingPhysicalCount = useMemo(
    () => entities.filter((entity) => entity.missingPhysicalLayers.length > 0).length,
    [entities],
  );

  const filteredEntities = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entities.filter((entity) => {
      if (inventoryFilter === "run_gap" && entity.runMissingLayers.length === 0) return false;
      if (inventoryFilter === "never_loaded" && entity.neverSucceededLayers.length === 0) return false;
      if (inventoryFilter === "missing_physical" && entity.missingPhysicalLayers.length === 0) return false;
      if (loadFilter === "incremental" && !entity.isIncremental) return false;
      if (loadFilter === "full" && entity.isIncremental) return false;
      if (!needle) return true;
      const haystack = [
        entity.sourceDisplay,
        entity.source,
        entity.schema,
        entity.table,
        entity.entityId,
        entity.watermarkColumn ?? "",
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [entities, inventoryFilter, loadFilter, search]);

  if (!scope.selectedRunId) {
    return (
      <div style={{ ...S.card, padding: 32, textAlign: "center", color: "var(--bp-ink-muted)", ...S.sans, fontSize: 13 }}>
        Select a run to inspect the original run scope and its missing tables.
      </div>
    );
  }

  if (!inventory && loading) {
    return (
      <div style={{ ...S.card, padding: 32, textAlign: "center", color: "var(--bp-ink-muted)", ...S.sans, fontSize: 13 }}>
        Loading scoped inventory…
      </div>
    );
  }

  if (!inventory) {
    return (
      <div style={{ ...S.card, padding: 32, textAlign: "center", color: "var(--bp-ink-muted)", ...S.sans, fontSize: 13 }}>
        Inventory data is unavailable for this run.
      </div>
    );
  }

  const summaryCards = [
    { label: "Original Scope", value: formatNumber(inventory.summary.scopeEntityCount), detail: "Tables captured in the run scope", color: "var(--bp-ink-primary)", icon: Database },
    { label: "Missed This Run", value: formatNumber(entityGapCount), detail: "Scoped tables that did not finish all scoped layers", color: "var(--bp-copper)", icon: AlertTriangle },
    { label: "Never Loaded", value: formatNumber(neverLoadedCount), detail: "Tables with at least one layer never succeeding historically", color: "var(--bp-fault)", icon: XCircle },
    { label: "Not In Lakehouse", value: formatNumber(missingPhysicalCount), detail: "Tables physically absent from at least one layer", color: "var(--bp-silver)", icon: Layers },
  ];

  const filterButtons = [
    { key: "run_gap" as const, label: "Run Gaps", count: entityGapCount },
    { key: "never_loaded" as const, label: "Never Loaded", count: neverLoadedCount },
    { key: "missing_physical" as const, label: "Missing Physically", count: missingPhysicalCount },
    { key: "all" as const, label: "All Scoped", count: inventory.summary.scopeEntityCount },
  ];

  const loadButtons = [
    { key: "all" as const, label: "All" },
    { key: "incremental" as const, label: "Incremental" },
    { key: "full" as const, label: "Full Load" },
  ];

  const formatStamp = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  const layerBadge = (layer: string, tone: "missing" | "good" | "neutral") => (
    <span
      key={`${layer}-${tone}`}
      style={{
        ...S.badge,
        fontSize: 10,
        padding: "2px 8px",
        background:
          tone === "missing"
            ? `${layerColor(layer)}18`
            : tone === "good"
              ? "var(--bp-operational)" + "12"
              : "var(--bp-surface-inset)",
        color:
          tone === "missing"
            ? layerColor(layer)
            : tone === "good"
              ? "var(--bp-operational)"
              : "var(--bp-ink-secondary)",
        border: `1px solid ${tone === "neutral" ? "var(--bp-border-subtle)" : `${tone === "good" ? "var(--bp-operational)" : layerColor(layer)}30`}`,
      }}
    >
      {layer.toUpperCase()}
    </span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...S.card, padding: "18px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <div style={{ flex: "1 1 420px", minWidth: 280 }}>
          <div style={{ ...S.sans, fontSize: 12, fontWeight: 700, color: "var(--bp-copper)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            Run Scope Truth
          </div>
          <div style={{ ...S.display, fontSize: 24, fontWeight: 700, color: "var(--bp-ink-primary)", marginBottom: 8 }}>
            What this run did not finish
          </div>
          <div style={{ ...S.sans, fontSize: 13, color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
            This view starts from the original scoped tables, then shows what this run missed, what has never succeeded historically, and which lakehouse layers are still physically absent.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, minWidth: 260 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
            <span style={{ ...S.badge, background: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)" }}>
              Run {shortRunId(inventory.run.runId)}
            </span>
            <span style={{ ...S.badge, background: statusColor(inventory.run.status) + "18", color: statusColor(inventory.run.status) }}>
              {inventory.run.status}
            </span>
            <span style={{ ...S.badge, background: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)" }}>
              Layers {runLayers.map((layer) => layer[0].toUpperCase()).join(" / ")}
            </span>
          </div>
          <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-muted)", textAlign: "right" }}>
            Source scope: {inventory.run.sourceFilter.length > 0 ? inventory.run.sourceFilter.join(", ") : "All active sources"}
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            style={{
              ...S.badge,
              cursor: "pointer",
              padding: "6px 12px",
              background: "transparent",
              color: "var(--bp-ink-secondary)",
              border: "1px solid var(--bp-border)",
            }}
          >
            <RefreshCw size={12} /> Refresh inventory
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} style={{ ...S.card, padding: "16px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Icon size={14} style={{ color: card.color, opacity: 0.8 }} />
                <span style={{ ...S.sans, fontSize: 11, fontWeight: 700, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {card.label}
                </span>
              </div>
              <div style={{ ...S.data, fontSize: 24, fontWeight: 700, color: card.color, marginBottom: 6 }}>
                {card.value}
              </div>
              <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)", lineHeight: 1.4 }}>
                {card.detail}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ ...S.card, padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {filterButtons.map((button) => (
            <button
              key={button.key}
              type="button"
              onClick={() => setInventoryFilter(button.key)}
              style={{
                ...S.badge,
                cursor: "pointer",
                padding: "6px 12px",
                background: inventoryFilter === button.key ? "var(--bp-copper-soft)" : "var(--bp-surface-inset)",
                color: inventoryFilter === button.key ? "var(--bp-copper)" : "var(--bp-ink-secondary)",
                border: `1px solid ${inventoryFilter === button.key ? "var(--bp-copper)" : "var(--bp-border-subtle)"}`,
              }}
            >
              {button.label} {formatNumber(button.count)}
            </button>
          ))}
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: "var(--bp-border-subtle)" }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {loadButtons.map((button) => (
            <button
              key={button.key}
              type="button"
              onClick={() => setLoadFilter(button.key)}
              style={{
                ...S.badge,
                cursor: "pointer",
                padding: "6px 12px",
                background: loadFilter === button.key ? "var(--bp-operational)" + "12" : "var(--bp-surface-inset)",
                color: loadFilter === button.key ? "var(--bp-operational)" : "var(--bp-ink-secondary)",
                border: `1px solid ${loadFilter === button.key ? "var(--bp-operational)" : "var(--bp-border-subtle)"}`,
              }}
            >
              {button.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <label style={{ position: "relative", minWidth: 260 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--bp-ink-muted)" }} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search source, schema, table, entity id"
            style={{
              width: "100%",
              padding: "9px 12px 9px 34px",
              borderRadius: 6,
              border: "1px solid var(--bp-border)",
              background: "var(--bp-surface-inset)",
              color: "var(--bp-ink-primary)",
              ...S.sans,
              fontSize: 13,
            }}
          />
        </label>
      </div>

      <div style={{ ...S.card, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--bp-border-subtle)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <div style={{ ...S.sans, fontSize: 13, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
            Scoped Table Inventory
          </div>
          <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)" }}>
            Showing {formatNumber(filteredEntities.length)} of {formatNumber(inventory.summary.scopeEntityCount)} tables from the original scope
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "SET_TAB", tab: "history" });
              dispatch({ type: "SET_STATUSES", statuses: ["failed"] });
            }}
            style={{
              ...S.badge,
              cursor: "pointer",
              padding: "6px 10px",
              background: "transparent",
              color: "var(--bp-ink-secondary)",
              border: "1px solid var(--bp-border)",
            }}
          >
            Open run history
          </button>
        </div>

        {filteredEntities.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", ...S.sans, fontSize: 13, color: "var(--bp-ink-muted)" }}>
            No scoped tables match the current filters.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
              <thead>
                <tr style={{ background: "var(--bp-surface-inset)" }}>
                  {["Table", "Next Load", "Selected Run", "Historical Truth", "Physical Presence"].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: "10px 12px",
                        textAlign: "left",
                        borderBottom: "1px solid var(--bp-border-subtle)",
                        ...S.sans,
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--bp-ink-tertiary)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEntities.map((entity) => {
                  const lastHistoricalSuccess = runLayers
                    .map((layer) => entity.historyLayerStatus[layer]?.lastSuccessAt)
                    .filter(Boolean)
                    .sort()
                    .at(-1) ?? null;

                  return (
                    <tr key={entity.entityId} style={{ borderBottom: "1px solid var(--bp-border-subtle)", verticalAlign: "top" }}>
                      <td style={{ padding: "14px 12px", width: "22%" }}>
                        <div style={{ ...S.sans, fontSize: 12, fontWeight: 700, color: "var(--bp-copper)", marginBottom: 4 }}>
                          {entity.sourceDisplay}
                        </div>
                        <div style={{ ...S.sans, fontSize: 14, fontWeight: 600, color: "var(--bp-ink-primary)", marginBottom: 4 }}>
                          {entity.schema}.{entity.table}
                        </div>
                        <div style={{ ...S.data, fontSize: 11, color: "var(--bp-ink-muted)" }}>
                          Entity {entity.entityId}
                        </div>
                      </td>
                      <td style={{ padding: "14px 12px", width: "18%" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          <span style={{ ...S.badge, background: entity.isIncremental ? "var(--bp-operational)" + "12" : "var(--bp-copper-soft)", color: entity.isIncremental ? "var(--bp-operational)" : "var(--bp-copper)" }}>
                            {entity.nextActionLabel}
                          </span>
                        </div>
                        <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)", lineHeight: 1.5 }}>
                          {entity.nextActionReason}
                        </div>
                        <div style={{ ...S.data, fontSize: 11, color: "var(--bp-ink-muted)", marginTop: 8 }}>
                          Watermark: {entity.watermarkColumn ? `${entity.watermarkColumn} · ${entity.lastWatermark ?? "none yet"}` : "none"}
                        </div>
                      </td>
                      <td style={{ padding: "14px 12px", width: "20%" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          <span style={{ ...S.badge, background: entity.runAttempted ? "var(--bp-operational)" + "12" : "var(--bp-fault)" + "12", color: entity.runAttempted ? "var(--bp-operational)" : "var(--bp-fault)" }}>
                            {entity.runAttempted ? "Attempted" : "Not attempted"}
                          </span>
                          {entity.runMissingLayers.length > 0
                            ? entity.runMissingLayers.map((layer) => layerBadge(layer, "missing"))
                            : [<span key="clean-run" style={{ ...S.badge, background: "var(--bp-operational)" + "12", color: "var(--bp-operational)" }}>No scoped gaps</span>]}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {runLayers.map((layer) => {
                            const status = entity.runLayerStatus[layer];
                            return (
                              <div key={layer} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <span style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-secondary)" }}>{layer}</span>
                                <span style={{ ...S.data, fontSize: 11, color: statusColor(status.status) }}>
                                  {status.status.replace(/_/g, " ")}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td style={{ padding: "14px 12px", width: "20%" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          {entity.neverSucceededLayers.length > 0
                            ? entity.neverSucceededLayers.map((layer) => layerBadge(layer, "missing"))
                            : [<span key="history-clean" style={{ ...S.badge, background: "var(--bp-operational)" + "12", color: "var(--bp-operational)" }}>Loaded across layers</span>]}
                        </div>
                        <div style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-secondary)", lineHeight: 1.5 }}>
                          Last success anywhere: {formatStamp(lastHistoricalSuccess)}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                          {runLayers.map((layer) => {
                            const history = entity.historyLayerStatus[layer];
                            return (
                              <div key={layer} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <span style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-secondary)" }}>{layer}</span>
                                <span style={{ ...S.data, fontSize: 11, color: history.everSucceeded ? "var(--bp-operational)" : "var(--bp-fault)" }}>
                                  {history.everSucceeded ? `Succeeded ${formatStamp(history.lastSuccessAt)}` : "Never succeeded"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td style={{ padding: "14px 12px", width: "20%" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          {entity.missingPhysicalLayers.length > 0
                            ? entity.missingPhysicalLayers.map((layer) => layerBadge(layer, "missing"))
                            : [<span key="physical-clean" style={{ ...S.badge, background: "var(--bp-operational)" + "12", color: "var(--bp-operational)" }}>Present in lakehouse</span>]}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {runLayers.map((layer) => {
                            const physical = entity.physicalLayerStatus[layer];
                            return (
                              <div key={layer} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <span style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-secondary)" }}>{layer}</span>
                                <span style={{ ...S.data, fontSize: 11, color: physical.exists ? "var(--bp-operational)" : "var(--bp-fault)" }}>
                                  {physical.scanFailed
                                    ? "Scan failed"
                                    : physical.exists
                                      ? `${formatNumber(physical.rowCount)} rows`
                                      : "Missing"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {progress && (
        <div style={{ ...S.cardInset, padding: "12px 14px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ ...S.sans, fontSize: 12, fontWeight: 700, color: "var(--bp-ink-secondary)" }}>
            Lakehouse scan snapshot
          </span>
          {(["LandingZone", "Bronze", "Silver"] as const).map((layerKey) => {
            const state = progress.lakehouseState?.[layerKey] ?? progress.lakehouseState?.[layerKey.toLowerCase()] ?? null;
            const label = layerKey === "LandingZone" ? "Landing" : layerKey;
            return (
              <span key={layerKey} style={{ ...S.badge, background: "var(--bp-surface-1)", color: "var(--bp-ink-secondary)", border: "1px solid var(--bp-border-subtle)" }}>
                {label}: {state ? `${formatNumber(state.tablesWithData)} loaded` : "no scan"}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10f  CONTEXT PANEL — Slide-out detail/failure/verification panel
// ═══════════════════════════════════════════════════════════════════════════════

function ContextPanel({
  entity,
  retryDisabled,
  onRetryEntity,
}: {
  entity: TaskEntity | null;
  retryDisabled: boolean;
  onRetryEntity: (entityId: number) => void;
}) {
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
                {retryDisabled && (
                  <div style={{
                    ...S.cardInset,
                    padding: "10px 12px",
                    border: "1px solid var(--bp-caution)",
                    background: "var(--bp-caution)" + "10",
                  }}>
                    <div style={{ ...S.sans, fontSize: 11, color: "var(--bp-ink-primary)", lineHeight: 1.5 }}>
                      {RETRY_BLOCKED_MESSAGE}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  disabled={retryDisabled}
                  title={retryDisabled ? RETRY_BLOCKED_MESSAGE : `Retry only ${entity.SourceTable}`}
                  onClick={() => { if (entity.EntityId && !retryDisabled) onRetryEntity(entity.EntityId); }}
                  style={{
                    ...S.badge,
                    cursor: retryDisabled ? "not-allowed" : "pointer",
                    background: "var(--bp-copper-soft)", color: "var(--bp-copper)",
                    border: "1px solid var(--bp-copper)",
                    padding: "8px 16px", fontSize: 12,
                    justifyContent: "center", marginTop: 4,
                    opacity: retryDisabled ? 0.5 : 1,
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
  const [retryFeedback, setRetryFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  // Fetch runs list
  const { runs, loading: runsLoading, refetch: refetchRuns } = useRuns(20);

  // ── Performance Comparison state (Task 9) ──
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareRunA, setCompareRunA] = useState("");
  const [compareRunB, setCompareRunB] = useState("");
  const [compareData, setCompareData] = useState<any>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [selfHealExpanded, setSelfHealExpanded] = useState(false);

  // Engine status (polls every 5s) — must be before useEffects that reference it
  const { engine } = useEngineStatus(scope.isRunActive ? 3000 : 10000);

  // Fetch progress for selected run (polls every 3s)
  const { data: progress, loading: progressLoading } = useProgress(
    scope.selectedRunId,
    scope.isRunActive ? 3000 : 15000,
  );
  const selectedRunMeta = useMemo(
    () => runs.find(r => r.runId === scope.selectedRunId) ?? null,
    [runs, scope.selectedRunId],
  );
  const selectedRunStatus = (progress?.run?.status ?? selectedRunMeta?.status ?? "").toLowerCase();
  const retryDisabled = scope.isRunActive || selectedRunStatus === "inprogress" || selectedRunStatus === "running";
  const showSelfHealRail = Boolean(progress?.selfHeal && (progress.selfHeal.configured || progress.selfHeal.selectedAgent || progress.selfHeal.summary.totalCount > 0));
  const hasActiveSelfHeal = useMemo(
    () => Boolean(progress?.selfHeal?.cases?.some((item) => ["collecting_context", "invoking_agent", "validating_patch", "retrying"].includes(item.status))),
    [progress?.selfHeal?.cases],
  );
  const selectedRunSourceFilter = useMemo(() => {
    const raw = progress?.run?.sourceFilter ?? selectedRunMeta?.sourceFilter ?? [];
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }, [progress?.run?.sourceFilter, selectedRunMeta?.sourceFilter]);
  const rightRailWidth = scope.contextOpen || selfHealExpanded ? 320 : 96;

  // Auto-select a run if the engine is actively running one
  // Only do this when the user has not manually selected a different run.
  useEffect(() => {
    if (!scope.selectedRunId && engine?.status === "running" && engine?.current_run_id) {
      dispatch({ type: "SET_RUN", runId: engine.current_run_id });
      refetchRuns();
    }
  }, [engine?.status, engine?.current_run_id, scope.selectedRunId, dispatch, refetchRuns]);

  useEffect(() => {
    const next = selectedRunSourceFilter;
    const current = scope.runSources;
    if (next.length === current.length && next.every((value, index) => value === current[index])) return;
    dispatch({ type: "SET_RUN_SOURCES", sources: next });
  }, [selectedRunSourceFilter, scope.runSources, dispatch]);

  useEffect(() => {
    if (!retryFeedback) return;
    const timeoutId = window.setTimeout(() => setRetryFeedback(null), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [retryFeedback]);
  useEffect(() => {
    if (!showSelfHealRail) {
      setSelfHealExpanded(false);
      return;
    }
    if (hasActiveSelfHeal) {
      setSelfHealExpanded(true);
    }
  }, [hasActiveSelfHeal, showSelfHealRail]);

  // ── Compare fetch effect (Task 9) ──
  useEffect(() => {
    if (!compareRunA || !compareRunB || compareRunA === compareRunB) {
      setCompareData(null);
      return;
    }
    const controller = new AbortController();
    setCompareLoading(true);
    fetch(
      `${API}/api/lmc/compare?run_a=${encodeURIComponent(compareRunA)}&run_b=${encodeURIComponent(compareRunB)}`,
      { signal: controller.signal }
    )
      .then(r => r.json())
      .then(setCompareData)
      .catch((err) => { if (err.name !== "AbortError") setCompareData(null); })
      .finally(() => setCompareLoading(false));
    return () => controller.abort();
  }, [compareRunA, compareRunB]);

  // Engine actions
  // Available sources (fast dedicated endpoint, not dependent on slow progress query)
  const availableSources = useSources();

  const handleStart = useCallback(async (layers: string[], sourceFilter: string[], mode?: string) => {
    try {
      // Set run scope IMMEDIATELY before any async work — prevents poller from
      // seeing stale scope between click and engine startup
      dispatch({ type: "SET_RUN_SOURCES", sources: sourceFilter });

      // Resolve source names → entity_ids if source filter is active
      let entityIds: number[] | undefined;
      if (sourceFilter.length > 0) {
        const idsRes = await fetch(
          `${API}/api/lmc/entity-ids-by-source?sources=${encodeURIComponent(sourceFilter.join(","))}`
        );
        if (!idsRes.ok) {
          console.error("Failed to resolve entity IDs for sources:", sourceFilter);
          dispatch({ type: "SET_RUN_SOURCES", sources: [] });
          return; // HARD FAIL — do not launch with wrong scope
        }
        const idsData = await idsRes.json();
        entityIds = idsData.entity_ids;
        if (!entityIds || entityIds.length === 0) {
          console.error("No entities found for sources:", sourceFilter);
          dispatch({ type: "SET_RUN_SOURCES", sources: [] });
          return; // HARD FAIL — empty scope means nothing to load
        }
      }

      const res = await fetch(`${API}/api/engine/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: mode || "run",
          layers: layers.length > 0 ? layers : undefined,
          entity_ids: entityIds,
          triggered_by: "dashboard",
          // Persist the resolved scope on the run record for backend truth
          source_filter: sourceFilter.length > 0 ? sourceFilter : undefined,
          resolved_entity_count: entityIds?.length,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.run_id) {
          dispatch({ type: "SET_RUN", runId: d.run_id });
        }
        refetchRuns();
      }
    } catch (err) { console.error("Engine start failed:", err); }
  }, [dispatch, refetchRuns]);

  const handleStop = useCallback(async () => {
    try { await fetch(`${API}/api/engine/stop`, { method: "POST" }); } catch { /* swallow */ }
  }, []);

  const submitScopedRetry = useCallback(async (request?: { entityIds?: number[]; layers?: string[] }) => {
    if (!scope.selectedRunId) {
      setRetryFeedback({ tone: "error", message: "Select a run before retrying failed work." });
      return false;
    }
    if (retryDisabled) {
      setRetryFeedback({ tone: "error", message: RETRY_BLOCKED_MESSAGE });
      return false;
    }
    try {
      const res = await fetch(`${API}/api/engine/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: scope.selectedRunId,
          entity_ids: request?.entityIds,
          layers: request?.layers,
        }),
      });
      const payload = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        let message = typeof payload.message === "string" ? payload.message : `Retry failed (${res.status})`;
        if (typeof payload.error === "string") {
          message = payload.error;
          try {
            const nested = JSON.parse(payload.error) as Record<string, unknown>;
            if (typeof nested.error === "string") {
              message = nested.error;
              if (typeof nested.current_run_id === "string") {
                message = `${nested.error} (${nested.current_run_id.slice(0, 8)})`;
              }
            }
          } catch {
            // Leave the raw string in place when the route returned a plain-text error.
          }
        }
        setRetryFeedback({ tone: "error", message });
        return false;
      }
      const retryRunId = typeof payload.run_id === "string" ? payload.run_id : null;
      const retryCount = typeof payload.retrying === "number"
        ? payload.retrying
        : request?.entityIds?.length ?? 0;
      if (retryRunId) {
        dispatch({ type: "SET_RUN", runId: retryRunId });
      }
      refetchRuns();
      setRetryFeedback({
        tone: "success",
        message: retryRunId
          ? `Started scoped retry run ${retryRunId.slice(0, 8)} for ${retryCount || "the selected"} failed ${retryCount === 1 ? "entity" : "entities"}.`
          : "Started scoped retry run for the selected failed work.",
      });
      return true;
    } catch {
      setRetryFeedback({ tone: "error", message: "Retry request failed before the API could respond." });
      return false;
    }
  }, [scope.selectedRunId, retryDisabled, dispatch, refetchRuns]);

  const handleRetry = useCallback(async () => {
    await submitScopedRetry({
      layers: scope.selectedLayers.length > 0 ? scope.selectedLayers : undefined,
    });
  }, [scope.selectedLayers, submitScopedRetry]);

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
    offset: scope.entityPage * 100,
  }), [scope.selectedSources, scope.selectedLayers, scope.selectedStatuses, scope.searchQuery, scope.entityPage]);
  const { entities, total: entityTotal, loading: entitiesLoading, refetch: refetchEntities } = useEntities(scope.selectedRunId, entityParams);

  // SSE for live tab
  const { events: sseEvents, clear: clearSse } = useSSE(scope.isRunActive || scope.activeTab === "live");

  // Extract latest bulk_progress from SSE stream + compute ETA client-side
  const bulkProgress = useMemo(() => {
    const bpEvents = sseEvents.filter(e => e.type === "bulk_progress");
    const bp = bpEvents[bpEvents.length - 1];
    if (!bp) return null;
    const d = bp.data as Record<string, unknown>;
    const completed = (d.completed as number) ?? 0;
    const total = (d.total as number) ?? 0;
    const pct = (d.pct as number) ?? 0;

    // Use server-side ETA when available, otherwise compute client-side
    const serverEta = (d.eta_seconds as number) ?? 0;
    let etaSeconds: number | null = serverEta > 0 ? serverEta : null;
    if (!etaSeconds && bpEvents.length >= 2 && completed > 0 && completed < total) {
      const first = bpEvents[0];
      const elapsedMs = bp.ts - first.ts;
      const firstCompleted = ((first.data as Record<string, unknown>).completed as number) ?? 0;
      const entitiesDone = completed - firstCompleted;
      if (entitiesDone > 0 && elapsedMs > 0) {
        const msPerEntity = elapsedMs / entitiesDone;
        etaSeconds = ((total - completed) * msPerEntity) / 1000;
      }
    }

    const workers = (d.active_workers as number) ?? 0;
    return {
      completed,
      total,
      succeeded: (d.succeeded as number) ?? 0,
      failed: (d.failed as number) ?? 0,
      totalRows: (d.total_rows as number) ?? 0,
      totalBytes: (d.total_bytes as number) ?? 0,
      pct,
      etaSeconds,
      activeWorkers: workers > 0 ? workers : null,
    };
  }, [sseEvents]);

  // Selected entity from entities list
  const selectedEntity = useMemo(() => entities.find(e => e.EntityId === scope.selectedEntityId) ?? null, [entities, scope.selectedEntityId]);

  // Entity-level retry handler
  const handleRetryEntity = useCallback(async (entityId: number) => {
    const started = await submitScopedRetry({ entityIds: [entityId] });
    if (started) {
      refetchEntities();
    }
  }, [refetchEntities, submitScopedRetry]);

  // Error-type batch retry handler — queries ALL failed (not capped by client page size)
  const handleRetryErrorType = useCallback(async (errorType: string) => {
    if (!scope.selectedRunId) return;
    if (retryDisabled) {
      setRetryFeedback({ tone: "error", message: RETRY_BLOCKED_MESSAGE });
      return;
    }
    try {
      // Fetch all failed entities of this error type from backend (uncapped)
      const failedRes = await fetch(
        `${API}/api/lmc/run/${scope.selectedRunId}/entities?status=failed&limit=5000`
      );
      if (!failedRes.ok) {
        setRetryFeedback({ tone: "error", message: `Failed to load failed entities for ${errorType}.` });
        return;
      }
      const failedData = await failedRes.json();
      const failed = (failedData.entities ?? [])
        .filter((e: TaskEntity) => e.ErrorType === errorType)
        .map((e: TaskEntity) => e.EntityId);
      if (failed.length === 0) {
        setRetryFeedback({ tone: "error", message: `No failed entities are currently tagged as ${errorType}.` });
        return;
      }

      const started = await submitScopedRetry({ entityIds: failed });
      if (started) {
        refetchEntities();
      }
    } catch {
      setRetryFeedback({ tone: "error", message: `Retry lookup failed for ${errorType}.` });
    }
  }, [scope.selectedRunId, retryDisabled, refetchEntities, submitScopedRetry]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bp-canvas)",
      color: "var(--bp-ink-primary)",
      ...S.sans,
    }}>
      {/* Keyframe for pulse animation */}
      <style>{`
        :root { --ease-claude: cubic-bezier(0.25, 0.1, 0.25, 1); }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-12px); } }
        @keyframes slideInUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes highlight { 0%, 100% { background-color: transparent; } 50% { background-color: var(--bp-copper-soft); } }
        @keyframes scopeIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        .metric-value { transition: color 0.3s var(--ease-claude), font-size 0.2s var(--ease-claude); }
        .metric-value:hover { color: var(--bp-copper); }
      `}</style>

      <div className="bp-page-shell-wide space-y-4" style={{ paddingBottom: 24 }}>
        <CompactPageHeader
          eyebrow="Monitor"
          title="Load Mission Control"
          summary="Watch the active run, inspect failures as they emerge, and keep the operator in one place while execution, triage, and verification move forward."
          meta={
            scope.selectedRunId
              ? `Monitoring run ${shortRunId(scope.selectedRunId)}`
              : "Pipeline operations workbench"
          }
          guideItems={[
            {
              label: "What This Page Is",
              value: "Live operations workbench",
              detail: "Mission Control is the live monitoring surface for active and recently completed runs, including execution posture, source-layer progress, failures, and verification context.",
            },
            {
              label: "Why It Matters",
              value: "One place during execution",
              detail: "Operators should not need to jump between half a dozen pages while a run is active. This page carries the live state, the triage context, and the verification trail in one workspace.",
            },
            {
              label: "What Happens Next",
              value: "Observe, diagnose, verify",
              detail: "Start or finish the run in Load Center, watch the run here, then use the entity and failure context to decide whether to retry, wait, or move into a deeper diagnostic page.",
            },
          ]}
          guideLinks={[
            { label: "Open Load Center", to: "/load-center" },
            { label: "Open Execution Matrix", to: "/matrix" },
            { label: "Open Error Intelligence", to: "/errors" },
          ]}
          status={
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: scope.isRunActive ? "var(--bp-copper)" : "var(--bp-ink-secondary)",
                background: scope.isRunActive ? "rgba(180,86,36,0.08)" : "rgba(255,255,255,0.72)",
                border: scope.isRunActive ? "1px solid rgba(180,86,36,0.16)" : "1px solid rgba(120,113,108,0.1)",
              }}
            >
              {scope.isRunActive ? <Activity size={12} /> : <Circle size={12} />}
              {scope.isRunActive ? "Run Active" : "Standing By"}
            </span>
          }
          facts={[
            { label: "Run", value: scope.selectedRunId ? shortRunId(scope.selectedRunId) : "Not selected", tone: scope.selectedRunId ? "accent" : "neutral" },
            { label: "Sources", value: availableSources.length.toLocaleString(), tone: "accent" },
            { label: "Scope", value: scope.runSources.length > 0 ? `${scope.runSources.length} sources` : "All sources", tone: scope.runSources.length > 0 ? "accent" : "neutral" },
            { label: "Status", value: scope.selectedRunId ? (selectedRunStatus || "pending").replaceAll("_", " ") : "Waiting", tone: scope.isRunActive ? "warning" : scope.selectedRunId ? "positive" : "neutral" },
          ]}
        />
        <div style={{
          background: "var(--bp-surface-1)",
          border: "1px solid var(--bp-border)",
          borderRadius: 18,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}>
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

          {retryFeedback && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              margin: "14px 32px 0",
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid ${retryFeedback.tone === "error" ? "var(--bp-fault)" : "var(--bp-operational)"}`,
              background: retryFeedback.tone === "error"
                ? "var(--bp-fault)" + "12"
                : "var(--bp-operational)" + "12",
            }}>
              {retryFeedback.tone === "error" ? (
                <AlertTriangle size={14} style={{ color: "var(--bp-fault)", flexShrink: 0 }} />
              ) : (
                <CheckCircle2 size={14} style={{ color: "var(--bp-operational)", flexShrink: 0 }} />
              )}
              <span style={{ ...S.sans, fontSize: 12, color: "var(--bp-ink-primary)", flex: 1 }}>
                {retryFeedback.message}
              </span>
              <button
                type="button"
                onClick={() => setRetryFeedback(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--bp-ink-muted)", padding: 0 }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Scoped-run banner — shows when run is filtered to specific sources */}
          {scope.runSources.length > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 32px",
              background: "var(--bp-copper-soft)",
              borderBottom: "1px solid var(--bp-copper)",
              animation: "slideInDown 0.4s var(--ease-claude, ease-out)",
            }}>
              <Server size={14} style={{ color: "var(--bp-copper)", flexShrink: 0 }} />
              <span style={{ ...S.sans, fontSize: 13, fontWeight: 600, color: "var(--bp-copper)" }}>
                Scoped to:
              </span>
              {scope.runSources.map(s => (
                <span key={s} style={{
                  ...S.badge,
                  background: "var(--bp-copper)", color: "#fff",
                  fontSize: 12, padding: "3px 10px",
                }}>
                  {availableSources.find(src => src.name === s)?.displayName || s}
                </span>
              ))}
              <div style={{ flex: 1 }} />
              <button
                onClick={() => dispatch({ type: "SET_RUN_SOURCES", sources: [] })}
                style={{
                  ...S.badge, cursor: "pointer", fontSize: 11,
                  background: "transparent", color: "var(--bp-copper)",
                  border: "1px solid var(--bp-copper)", padding: "4px 12px",
                }}
              >
                Show All Sources
              </button>
            </div>
          )}

          {/* §7 KPI Strip + Matrix — only when a run is selected */}
          {!scope.selectedRunId ? (
            <div style={{
              padding: "48px 32px", display: "flex", flexDirection: "column",
              alignItems: "center", gap: 20, color: "var(--bp-ink-muted)",
              background: "var(--bp-surface-inset)",
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
                  Ready to Go
                </div>
                <div style={{ ...S.sans, fontSize: 15, color: "var(--bp-ink-secondary)", lineHeight: 1.6, marginBottom: 20 }}>
                  Use Load Center to start or finish imports. Mission Control stays here as the place to watch the run, inspect failures, and understand what happened after execution starts.
                </div>
                <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                  <div style={{ ...S.cardInset, padding: "12px 16px", textAlign: "left" }}>
                    <div style={{ ...S.sans, fontSize: 11, fontWeight: 600, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 4 }}>
                      Execution Ownership
                    </div>
                    <div style={{ ...S.sans, fontSize: 13, color: "var(--bp-ink-secondary)" }}>
                      Start and finish imports in Load Center, then come back here to monitor and triage the run
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
                  background: "rgba(244,242,237,0.85)",
                  backdropFilter: "blur(4px)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  ...S.sans, fontSize: 14, color: "var(--bp-ink-secondary)",
                  transition: "opacity 0.3s ease",
                }}>
                  <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "var(--bp-copper)" }} />
                  {progress ? "Refreshing…" : "Loading pipeline data…"}
                </div>
              )}
              <KpiStrip progress={progress} bulkProgress={bulkProgress} />

              {/* Bulk progress ETA banner — visible during active bulk runs */}
              {bulkProgress && bulkProgress.total > 0 && scope.isRunActive && (
                <div style={{
                  margin: "0 32px", padding: "12px 20px",
                  background: "var(--bp-surface-1)", border: "1px solid var(--bp-operational)",
                  borderRadius: 8, display: "flex", alignItems: "center", gap: 16,
                }}>
                  <Zap size={16} style={{ color: "var(--bp-operational)", flexShrink: 0 }} />
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 20 }}>
                    <span style={{ ...S.sans, fontSize: 13, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
                      Bulk Snapshot
                    </span>
                    <span style={{ ...S.data, fontSize: 13, color: "var(--bp-ink-secondary)" }}>
                      {bulkProgress.completed} / {bulkProgress.total} entities ({bulkProgress.pct}%)
                    </span>
                    {bulkProgress.totalRows > 0 && (
                      <span style={{ ...S.data, fontSize: 12, color: "var(--bp-ink-muted)" }}>
                        {formatNumber(bulkProgress.totalRows)} rows
                      </span>
                    )}
                    {bulkProgress.totalBytes > 0 && (
                      <span style={{ ...S.data, fontSize: 12, color: "var(--bp-ink-muted)" }}>
                        {(bulkProgress.totalBytes / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    )}
                    {bulkProgress.activeWorkers != null && (
                      <span style={{ ...S.data, fontSize: 12, color: "var(--bp-ink-muted)" }}>
                        {bulkProgress.activeWorkers}w
                      </span>
                    )}
                  </div>
                  {bulkProgress.etaSeconds != null && bulkProgress.etaSeconds > 0 && (
                    <div style={{
                      ...S.data, fontSize: 14, fontWeight: 700, color: "var(--bp-operational)",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <Timer size={14} />
                      ETA {Math.ceil(bulkProgress.etaSeconds / 60)}m
                    </div>
                  )}
                  {/* Progress bar */}
                  <div style={{
                    width: 120, height: 6, borderRadius: 3,
                    background: "var(--bp-border)", overflow: "hidden", flexShrink: 0,
                  }}>
                    <div style={{
                      height: "100%", borderRadius: 3,
                      width: `${bulkProgress.pct}%`,
                      background: "var(--bp-operational)",
                      transition: "width 0.5s ease",
                    }} />
                  </div>
                </div>
              )}

              <PhaseRail progress={progress} engine={engine} />
              <SourceLayerMatrix progress={progress} engine={engine} sourceNames={availableSources} />
            </div>
          )}

          {/* Section divider */}
          <div style={{ height: 1, background: "var(--bp-border)", margin: "20px 0 0" }} />

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

          {/* Tab content + right rail */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", padding: "24px 32px 40px", gap: 20, minHeight: 520 }}>
            <div style={{ flex: 1, minWidth: 0, animation: "slideInUp 0.5s ease-out 0.1s backwards" }}>
              {scope.activeTab === "live" && <LiveTailTab events={sseEvents} onClear={clearSse} />}
              {scope.activeTab === "history" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* ── Extraction Performance Comparison (Task 9) ── */}
              <div style={{ ...S.card, overflow: "hidden" }}>
                <button
                  onClick={() => setCompareOpen(!compareOpen)}
                  style={{
                    width: "100%", display: "flex", justifyContent: "space-between",
                    alignItems: "center", padding: "12px 16px",
                    background: "var(--bp-surface-1)", border: "none", cursor: "pointer",
                    color: "var(--bp-ink-primary)", ...S.display,
                    fontSize: 14, fontWeight: 600,
                  }}
                >
                  <span>Extraction Performance</span>
                  <ChevronDown size={16} style={{
                    transition: "transform 0.2s",
                    transform: compareOpen ? "rotate(180deg)" : "rotate(0deg)",
                  }} />
                </button>

                {compareOpen && (
                  <div style={{ padding: 16, borderTop: "1px solid var(--bp-border-subtle)" }}>
                    {/* Run Pickers */}
                    <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                      {(["A", "B"] as const).map(label => (
                        <select
                          key={label}
                          value={label === "A" ? compareRunA : compareRunB}
                          onChange={e => label === "A" ? setCompareRunA(e.target.value) : setCompareRunB(e.target.value)}
                          style={{
                            flex: 1, padding: 8, borderRadius: 6,
                            border: "1px solid var(--bp-border)",
                            background: "var(--bp-surface-inset)",
                            color: "var(--bp-ink-primary)",
                            ...S.sans, fontSize: 12,
                          }}
                        >
                          <option value="">Select Run {label}</option>
                          {(runs || []).map((r: any) => (
                            <option key={r.runId || r.RunId} value={r.runId || r.RunId}>
                              {(r.startedAt || r.StartedAt || "").slice(0, 16)} · {
                                (r.extractionMethod || r.extraction_method) === "connectorx" ? "CX" :
                                (r.extractionMethod || r.extraction_method) === "pyodbc" ? "ODBC" : "?"
                              } · {r.totalEntities || r.TotalEntities || "?"} entities
                            </option>
                          ))}
                        </select>
                      ))}
                    </div>

                    {/* Summary Cards + Scatter */}
                    {compareData && !compareLoading && (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                          {[
                            {
                              label: "Duration",
                              a: `${Math.round(compareData.run_a?.wall_clock_duration || compareData.run_a?.entity_duration_sum || 0)}s`,
                              b: `${Math.round(compareData.run_b?.wall_clock_duration || compareData.run_b?.entity_duration_sum || 0)}s`,
                            },
                            {
                              label: "Throughput",
                              a: `${Math.round(compareData.run_a?.rows_per_sec || 0).toLocaleString()} rows/s`,
                              b: `${Math.round(compareData.run_b?.rows_per_sec || 0).toLocaleString()} rows/s`,
                            },
                            {
                              label: "Data Volume",
                              a: `${(compareData.run_a?.total_rows || 0).toLocaleString()} rows`,
                              b: `${(compareData.run_b?.total_rows || 0).toLocaleString()} rows`,
                            },
                            { label: "Speedup", a: "", b: `${compareData.speedup}×`, highlight: true },
                          ].map((card) => (
                            <div key={card.label} style={{
                              padding: 16, borderRadius: 8,
                              border: `1px solid ${card.highlight ? "var(--bp-copper)" : "var(--bp-border)"}`,
                              background: card.highlight ? "color-mix(in srgb, var(--bp-copper) 8%, var(--bp-surface-1))" : "var(--bp-surface-1)",
                            }}>
                              <div style={{ fontSize: 11, color: "var(--bp-ink-tertiary)", marginBottom: 8, ...S.sans, textTransform: "uppercase", letterSpacing: "0.04em" }}>{card.label}</div>
                              {card.highlight ? (
                                <div style={{ fontSize: 28, fontWeight: 700, color: "var(--bp-copper)", ...S.display }}>
                                  {card.b}
                                </div>
                              ) : (
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <div>
                                    <div style={{ fontSize: 10, color: "var(--bp-ink-muted)", ...S.sans }}>Run A</div>
                                    <div style={{ fontSize: 16, fontWeight: 600, ...S.data }}>{card.a}</div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 10, color: "var(--bp-ink-muted)", ...S.sans }}>Run B</div>
                                    <div style={{ fontSize: 16, fontWeight: 600, ...S.data }}>{card.b}</div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Entity Scatter Plot */}
                        {compareData.matched_entities?.length > 0 && (
                          <div style={{ ...S.card, padding: 16 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-secondary)", marginBottom: 8, ...S.sans }}>
                              Per-Entity Duration (dots below diagonal = faster with Run B)
                            </div>
                            <ResponsiveContainer width="100%" height={300}>
                              <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 20 }}>
                                <XAxis dataKey="run_a_duration" name="Run A (s)" type="number"
                                  tick={{ fontSize: 10, fill: "var(--bp-ink-tertiary)" }}
                                  label={{ value: "Run A duration (s)", position: "bottom", fontSize: 10, fill: "var(--bp-ink-tertiary)" }} />
                                <YAxis dataKey="run_b_duration" name="Run B (s)" type="number"
                                  tick={{ fontSize: 10, fill: "var(--bp-ink-tertiary)" }}
                                  label={{ value: "Run B (s)", angle: -90, position: "left", fontSize: 10, fill: "var(--bp-ink-tertiary)" }} />
                                <Tooltip content={({ payload }: any) => {
                                  if (!payload?.length) return null;
                                  const d = payload[0].payload;
                                  return (
                                    <div style={{ ...S.card, padding: 8, fontSize: 11 }}>
                                      <div style={{ fontWeight: 600 }}>{d.source_name}</div>
                                      <div>Rows: {d.rows?.toLocaleString()}</div>
                                      <div>Run A: {d.run_a_duration}s → Run B: {d.run_b_duration}s</div>
                                      <div style={{ color: "var(--bp-copper)", fontWeight: 600 }}>{d.speedup}× faster</div>
                                    </div>
                                  );
                                }} />
                                <ReferenceLine segment={[{ x: 0, y: 0 }, {
                                  x: Math.max(...(compareData.matched_entities || []).map((e: any) => Math.max(e.run_a_duration || 0, e.run_b_duration || 0)), 1),
                                  y: Math.max(...(compareData.matched_entities || []).map((e: any) => Math.max(e.run_a_duration || 0, e.run_b_duration || 0)), 1),
                                }]} stroke="var(--bp-border)" strokeDasharray="4 4" />
                                <Scatter data={compareData.matched_entities} fill="var(--bp-copper)" fillOpacity={0.7} />
                              </ScatterChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </>
                    )}

                    {compareLoading && (
                      <div style={{ textAlign: "center", padding: 24, color: "var(--bp-ink-tertiary)", ...S.sans, fontSize: 13 }}>
                        <Loader2 size={14} style={{ animation: "spin 1s linear infinite", marginRight: 6, display: "inline-block" }} />
                        Loading comparison...
                      </div>
                    )}

                    {!compareRunA && !compareRunB && (
                      <div style={{ textAlign: "center", padding: 24, color: "var(--bp-ink-tertiary)", ...S.sans, fontSize: 13 }}>
                        Select two runs to compare extraction performance
                      </div>
                    )}
                  </div>
                )}
              </div>

                  <HistoryTab entities={entities} total={entityTotal} loading={entitiesLoading} />
                </div>
              )}
              {scope.activeTab === "entities" && <EntitiesTab entities={entities} total={entityTotal} loading={entitiesLoading} retryDisabled={retryDisabled} onRetryEntity={handleRetryEntity} />}
              {scope.activeTab === "triage" && <TriageTab progress={progress} retryDisabled={retryDisabled} onRetryErrorType={handleRetryErrorType} />}
              {scope.activeTab === "inventory" && <InventoryTab progress={progress} />}
            </div>
            {(showSelfHealRail || scope.contextOpen) && (
              <div style={{ width: rightRailWidth, flex: `0 0 ${rightRailWidth}px`, display: "grid", gap: 16, alignSelf: "flex-start", animation: "slideInDown 0.4s ease-out" }}>
                {showSelfHealRail && (
                  <SelfHealRail
                    selfHeal={progress?.selfHeal}
                    expanded={selfHealExpanded}
                    onToggle={() => setSelfHealExpanded((value) => !value)}
                  />
                )}
                {scope.contextOpen && (
                  <ContextPanel entity={selectedEntity} retryDisabled={retryDisabled} onRetryEntity={handleRetryEntity} />
                )}
              </div>
            )}
          </div>
        </div>
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
