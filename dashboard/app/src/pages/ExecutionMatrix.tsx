import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Loader2, Search, Filter, Download,
  CheckCircle2, XCircle, AlertTriangle, Clock, Activity,
  ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown,
  Database, Layers, Zap, RotateCcw, Power,
  Play, Pause, AlertOctagon, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { useEntityDigest, type DigestEntity } from "../hooks/useEntityDigest";

// ============================================================================
// TYPES
// ============================================================================

interface EngineStatus {
  status: string;
  current_run_id: string | null;
  uptime_seconds: number;
  engine_version: string;
  last_run: {
    run_id: number;
    started_at: string;
    ended_at: string;
    status: string;
    duration_seconds: number;
  } | null;
}

interface LayerMetric {
  Layer: string;
  TotalTasks: number;
  Succeeded: number;
  Failed: number;
  TotalRowsRead: number;
  AvgDurationSeconds: number;
}

interface SlowestEntity {
  entity_id: number;
  entity_name: string;
  layer: string;
  duration_seconds: number;
}

interface TopError {
  error_message: string;
  count: number;
}

interface EngineMetrics {
  runs: number;
  layers: LayerMetric[];
  slowest_entities: SlowestEntity[];
  top_errors: TopError[];
}

interface EngineRun {
  run_id: number;
  started_at: string;
  ended_at: string | null;
  status: string;
  total_tasks: number;
  succeeded: number;
  failed: number;
  duration_seconds: number | null;
}

interface EngineRunsResponse {
  runs: EngineRun[];
  count: number;
}

interface EngineLog {
  log_id: number;
  run_id: number;
  entity_id: number;
  entity_name: string;
  layer: string;
  status: string;
  rows_read: number;
  rows_written: number;
  duration_seconds: number;
  error_message: string | null;
  started_at: string;
  ended_at: string;
}

interface EngineLogsResponse {
  logs: EngineLog[];
  count: number;
}

// ============================================================================
// HELPERS
// ============================================================================

const API = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function postJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
  }
  return res.json();
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function utc(iso: string): Date {
  return new Date(iso.endsWith("Z") ? iso : iso + "Z");
}

function timeAgo(isoDate: string | null | undefined): string {
  if (!isoDate) return "\u2014";
  const then = utc(isoDate).getTime();
  if (isNaN(then)) return "\u2014";
  const diff = Date.now() - then;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return utc(isoDate).toLocaleDateString();
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  try {
    return utc(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function humanDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return "\u2014";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

type LayerStatus = "loaded" | "pending" | "not_started";

function layerStatusLabel(s: LayerStatus): string {
  if (s === "loaded") return "Succeeded";
  if (s === "pending") return "Pending";
  return "Never Run";
}

function layerStatusCls(s: LayerStatus): string {
  if (s === "loaded") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (s === "pending") return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  return "bg-zinc-500/10 text-zinc-500 border-zinc-500/20";
}

function layerStatusIcon(s: LayerStatus) {
  if (s === "loaded") return <CheckCircle2 className="w-3 h-3" />;
  if (s === "pending") return <Clock className="w-3 h-3" />;
  return <XCircle className="w-3 h-3 opacity-40" />;
}

function overallStatusCls(overall: DigestEntity["overall"]): string {
  if (overall === "complete") return "text-emerald-400";
  if (overall === "error") return "text-red-400";
  if (overall === "partial") return "text-amber-400";
  if (overall === "pending") return "text-blue-400";
  return "text-zinc-500";
}

type SortKey = "id" | "tableName" | "source" | "targetSchema" | "lzStatus" | "bronzeStatus" | "silverStatus" | "lzLastLoad";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "succeeded" | "failed" | "never-run" | "pending";
type TimeRange = "1h" | "6h" | "24h" | "7d";

const TIME_RANGE_HOURS: Record<TimeRange, number> = { "1h": 1, "6h": 6, "24h": 24, "7d": 168 };

const DONUT_COLORS = ["#10b981", "#ef4444", "#71717a"]; // emerald, red, zinc

// ============================================================================
// COMPONENT
// ============================================================================

export default function ExecutionMatrix() {
  // ── Digest data (entity-level status) ──
  const { allEntities, sourceList, totalSummary, data: digestData, loading: digestLoading, error: digestError, refresh: refreshDigest } = useEntityDigest();

  // ── Engine API data ──
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [engineMetrics, setEngineMetrics] = useState<EngineMetrics | null>(null);
  const [engineRuns, setEngineRuns] = useState<EngineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Expanded entity logs ──
  const [expandedEntity, setExpandedEntity] = useState<number | null>(null);
  const [entityLogs, setEntityLogs] = useState<EngineLog[]>([]);
  const [entityLogsLoading, setEntityLogsLoading] = useState(false);

  // ── UI state ──
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("tableName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [errorFilter, setErrorFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [resetConfirm, setResetConfirm] = useState<number | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PAGE_SIZE = 50;

  // ── Normalize engine metrics (pyodbc returns all values as strings) ──
  function normalizeMetrics(raw: Record<string, unknown> | null): EngineMetrics | null {
    if (!raw) return null;
    const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
    const str = (v: unknown) => (v == null ? "" : String(v));
    return {
      runs: num(raw.runs),
      layers: (Array.isArray(raw.layers) ? raw.layers : []).map((l: Record<string, unknown>) => ({
        Layer: str(l.Layer),
        TotalTasks: num(l.TotalTasks),
        Succeeded: num(l.Succeeded),
        Failed: num(l.Failed),
        TotalRowsRead: num(l.TotalRowsRead),
        AvgDurationSeconds: num(l.AvgDurationSeconds),
      })),
      slowest_entities: (Array.isArray(raw.slowest_entities) ? raw.slowest_entities : []).map((s: Record<string, unknown>) => ({
        entity_id: num(s.entity_id ?? s.EntityId),
        entity_name: str(s.entity_name ?? s.SourceName ?? ""),
        layer: str(s.layer ?? s.Layer ?? ""),
        duration_seconds: num(s.duration_seconds ?? s.DurationSeconds),
      })),
      top_errors: (Array.isArray(raw.top_errors) ? raw.top_errors : []).map((e: Record<string, unknown>) => ({
        error_message: str(e.error_message ?? e.ErrorMessage ?? ""),
        count: num(e.count ?? e.Count),
      })),
    };
  }

  // ── Data fetching ──
  const loadEngineData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const hours = TIME_RANGE_HOURS[timeRange];
      const [status, rawMetrics, runsResp] = await Promise.all([
        fetchJson<EngineStatus>("/engine/status").catch(() => null),
        fetchJson<Record<string, unknown>>(`/engine/metrics?hours=${hours}`).catch(() => null),
        fetchJson<EngineRunsResponse>("/engine/runs?limit=20").catch(() => null),
      ]);
      setEngineStatus(status);
      setEngineMetrics(normalizeMetrics(rawMetrics));
      setEngineRuns(runsResp?.runs || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load engine data");
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  const refreshAll = useCallback(() => {
    refreshDigest();
    loadEngineData();
  }, [refreshDigest, loadEngineData]);

  // Load on mount and when timeRange changes
  useEffect(() => {
    loadEngineData();
  }, [loadEngineData]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(refreshAll, 5000);
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh, refreshAll]);

  // ── Entity log expansion ──
  const loadEntityLogs = useCallback(async (entityId: number) => {
    setEntityLogsLoading(true);
    try {
      const resp = await fetchJson<EngineLogsResponse>(`/engine/logs?entity_id=${entityId}&limit=10`);
      setEntityLogs(resp.logs || []);
    } catch {
      setEntityLogs([]);
    } finally {
      setEntityLogsLoading(false);
    }
  }, []);

  const toggleExpand = useCallback((entityId: number) => {
    if (expandedEntity === entityId) {
      setExpandedEntity(null);
      setEntityLogs([]);
    } else {
      setExpandedEntity(entityId);
      loadEntityLogs(entityId);
    }
  }, [expandedEntity, loadEntityLogs]);

  // ── Watermark reset ──
  const handleReset = useCallback(async (entityId: number) => {
    try {
      await postJson(`/engine/entity/${entityId}/reset`);
      setResetConfirm(null);
      refreshAll();
    } catch (e: unknown) {
      alert(`Reset failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }, [refreshAll]);

  // ── Derived: unique source names ──
  const sourceNames = useMemo(() => {
    const names = new Set<string>();
    allEntities.forEach(e => { if (e.source) names.add(e.source); });
    return Array.from(names).sort();
  }, [allEntities]);

  // ── Derived: filter + sort entities ──
  const filteredEntities = useMemo(() => {
    let list = allEntities;

    // Source filter
    if (sourceFilter !== "all") {
      list = list.filter(e => e.source === sourceFilter);
    }

    // Status filter
    if (statusFilter === "succeeded") {
      list = list.filter(e => e.overall === "complete");
    } else if (statusFilter === "failed") {
      list = list.filter(e => e.overall === "error");
    } else if (statusFilter === "never-run") {
      list = list.filter(e => e.overall === "not_started");
    } else if (statusFilter === "pending") {
      list = list.filter(e => e.overall === "pending" || e.overall === "partial");
    }

    // Error filter (from error panel)
    if (errorFilter && engineMetrics) {
      // When error filter is active, show entities with errors
      list = list.filter(e => e.lastError?.message?.includes(errorFilter));
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e =>
        e.tableName.toLowerCase().includes(q) ||
        e.sourceSchema.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        String(e.id).includes(q)
      );
    }

    // Sort
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "id": return dir * (a.id - b.id);
        case "tableName": return dir * a.tableName.localeCompare(b.tableName);
        case "source": return dir * (a.dataSourceName || a.source).localeCompare(b.dataSourceName || b.source);
        case "targetSchema": return dir * (a.targetSchema || "").localeCompare(b.targetSchema || "");
        case "lzStatus": return dir * a.lzStatus.localeCompare(b.lzStatus);
        case "bronzeStatus": return dir * a.bronzeStatus.localeCompare(b.bronzeStatus);
        case "silverStatus": return dir * a.silverStatus.localeCompare(b.silverStatus);
        case "lzLastLoad": {
          const at = a.lzLastLoad ? new Date(a.lzLastLoad).getTime() : 0;
          const bt = b.lzLastLoad ? new Date(b.lzLastLoad).getTime() : 0;
          return dir * (at - bt);
        }
        default: return 0;
      }
    });

    return list;
  }, [allEntities, sourceFilter, statusFilter, searchQuery, sortKey, sortDir, errorFilter, engineMetrics]);

  // Paginated slice
  const totalPages = Math.max(1, Math.ceil(filteredEntities.length / PAGE_SIZE));
  const pagedEntities = filteredEntities.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [sourceFilter, statusFilter, searchQuery, errorFilter]);

  // ── Derived: layer-level counts from digest ──
  const layerCounts = useMemo(() => {
    const lz = { succeeded: 0, failed: 0, pending: 0 };
    const bz = { succeeded: 0, failed: 0, pending: 0 };
    const sv = { succeeded: 0, failed: 0, pending: 0 };

    allEntities.forEach(e => {
      if (e.lzStatus === "loaded") lz.succeeded++;
      else if (e.lzStatus === "pending") lz.pending++;
      else lz.failed++;

      if (e.bronzeStatus === "loaded") bz.succeeded++;
      else if (e.bronzeStatus === "pending") bz.pending++;
      else bz.failed++;

      if (e.silverStatus === "loaded") sv.succeeded++;
      else if (e.silverStatus === "pending") sv.pending++;
      else sv.failed++;
    });

    return { lz, bz, sv };
  }, [allEntities]);

  // ── Derived: success rate for donut ──
  const successRate = useMemo(() => {
    const total = totalSummary.total;
    if (total === 0) return 0;
    return Math.round((totalSummary.complete / total) * 100);
  }, [totalSummary]);

  const donutData = useMemo(() => [
    { name: "Succeeded", value: totalSummary.complete },
    { name: "Failed", value: totalSummary.error },
    { name: "Other", value: totalSummary.pending + totalSummary.partial + totalSummary.not_started },
  ], [totalSummary]);

  // ── Sort toggle ──
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  // ── CSV export ──
  const exportCsv = () => {
    if (!filteredEntities.length) return;
    const header = "Entity ID,Table Name,Schema,Data Source,Target Schema,LZ Status,LZ Last Load,Bronze Status,Bronze Last Load,Silver Status,Silver Last Load,Overall";
    const csvRows = filteredEntities.map(e =>
      `${e.id},"${e.tableName}","${e.sourceSchema}","${e.dataSourceName || e.source}","${e.targetSchema}","${layerStatusLabel(e.lzStatus)}","${e.lzLastLoad || ""}","${layerStatusLabel(e.bronzeStatus)}","${e.bronzeLastLoad || ""}","${layerStatusLabel(e.silverStatus)}","${e.silverLastLoad || ""}","${e.overall}"`
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execution-matrix-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Engine status badge ──
  const engineBadge = () => {
    if (!engineStatus) return <Badge className="bg-zinc-500/10 text-zinc-500 border-zinc-500/20 border"><Power className="w-3 h-3 mr-1" /> Offline</Badge>;
    const s = engineStatus.status?.toLowerCase();
    if (s === "running" || s === "active") return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border animate-pulse"><Activity className="w-3 h-3 mr-1" /> Running</Badge>;
    if (s === "idle") return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 border"><Zap className="w-3 h-3 mr-1" /> Idle</Badge>;
    if (s === "error") return <Badge className="bg-red-500/10 text-red-400 border-red-500/20 border"><AlertOctagon className="w-3 h-3 mr-1" /> Error</Badge>;
    return <Badge className="bg-zinc-500/10 text-zinc-400 border-zinc-500/20 border">{engineStatus.status}</Badge>;
  };

  // ── Layer bar renderer ──
  const LayerBar = ({ label, counts }: { label: string; counts: { succeeded: number; failed: number; pending: number } }) => {
    const total = counts.succeeded + counts.failed + counts.pending;
    if (total === 0) return null;
    const pctSuccess = (counts.succeeded / total) * 100;
    const pctFail = (counts.failed / total) * 100;
    return (
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-foreground">{label}</span>
          <span className="text-[10px] text-muted-foreground">
            <span className="text-emerald-400">{fmt(counts.succeeded)}</span>
            {" / "}
            <span className="text-red-400">{fmt(counts.failed)}</span>
            {" / "}
            <span className="text-zinc-400">{fmt(counts.pending)}</span>
          </span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden bg-zinc-800 flex">
          {counts.succeeded > 0 && <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${pctSuccess}%` }} />}
          {counts.failed > 0 && <div className="bg-red-500 transition-all duration-500" style={{ width: `${pctFail}%` }} />}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[9px] text-emerald-400/70">{Math.round(pctSuccess)}% ok</span>
          {counts.failed > 0 && <span className="text-[9px] text-red-400/70">{Math.round(pctFail)}% fail</span>}
        </div>
      </div>
    );
  };

  // ── RENDER ──

  const isInitialLoading = digestLoading && loading && !digestData;

  return (
    <div className="space-y-6">
      {/* ================================================================ */}
      {/* HEADER BAR */}
      {/* ================================================================ */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-xl font-semibold tracking-tight">Execution Matrix</h1>
          {engineBadge()}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Time range */}
          <div className="flex items-center rounded-md border border-border bg-card overflow-hidden">
            {(["1h", "6h", "24h", "7d"] as TimeRange[]).map(t => (
              <button
                key={t}
                onClick={() => setTimeRange(t)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium transition-colors",
                  t === timeRange ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Source filter */}
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="px-2 py-1.5 rounded-md border border-border bg-card text-foreground text-xs outline-none cursor-pointer"
          >
            <option value="all">All Sources</option>
            {sourceNames.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="px-2 py-1.5 rounded-md border border-border bg-card text-foreground text-xs outline-none cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
            <option value="never-run">Never Run</option>
          </select>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              className="w-48 pl-8 pr-3 py-1.5 rounded-md border border-border bg-card text-foreground text-xs outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground"
              placeholder="Search entities..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Auto-refresh toggle */}
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(a => !a)}
            className="gap-1.5"
          >
            {autoRefresh ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {autoRefresh ? "Live" : "Auto"}
          </Button>

          {/* Refresh */}
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={digestLoading || loading}>
            {(digestLoading || loading) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>

          {/* Export */}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filteredEntities.length}>
            <Download className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {(error || digestError) && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-destructive/30 bg-destructive/5">
          <XCircle className="w-5 h-5 text-destructive flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-destructive">Data load error</div>
            <div className="text-xs text-muted-foreground mt-0.5">{error || digestError}</div>
          </div>
        </div>
      )}

      {/* Error filter active banner */}
      {errorFilter && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <Filter className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-amber-400">Filtered to entities matching error: <strong className="font-mono">{errorFilter.slice(0, 80)}{errorFilter.length > 80 ? "..." : ""}</strong></span>
          <button onClick={() => setErrorFilter(null)} className="ml-auto text-xs text-amber-400 hover:text-amber-300 underline">Clear</button>
        </div>
      )}

      {/* Initial loading state */}
      {isInitialLoading && (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-sm text-muted-foreground">Loading execution matrix...</p>
        </div>
      )}

      {!isInitialLoading && (
        <>
          {/* ================================================================ */}
          {/* SUMMARY CARDS */}
          {/* ================================================================ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Card 1: Total Entities */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-400" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Entities</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums text-foreground">{fmt(totalSummary.total)}</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {sourceList.map(s => (
                    <span key={s.key} className="text-[9px] text-muted-foreground">
                      {s.name}: <span className="text-foreground font-medium">{s.summary.total}</span>
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Card 2: Success Rate with mini donut */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Success Rate</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-bold tabular-nums text-emerald-400">{successRate}%</div>
                  <div className="w-12 h-12 -my-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData}
                          dataKey="value"
                          cx="50%"
                          cy="50%"
                          innerRadius={14}
                          outerRadius={22}
                          strokeWidth={0}
                        >
                          {donutData.map((_, i) => (
                            <Cell key={i} fill={DONUT_COLORS[i]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {fmt(totalSummary.complete)} complete, {fmt(totalSummary.error)} errors
                </div>
              </CardContent>
            </Card>

            {/* Card 3: Last Run */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Last Run</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  // Use engineStatus.last_run first, fallback to most recent engineRun
                  const lr = engineStatus?.last_run as Record<string, unknown> | null | undefined;
                  const fallback = (engineRuns[0] as unknown) as Record<string, unknown> | undefined;
                  const s = (v: unknown) => (v == null ? "" : String(v));
                  const n = (v: unknown) => { const x = Number(v); return isNaN(x) ? 0 : x; };
                  const run = lr
                    ? { status: s(lr.status), started: s(lr.started_at ?? lr.started), ended: s(lr.ended_at ?? lr.completed), duration: n(lr.duration_seconds ?? lr.elapsed_seconds), succeeded: n(lr.succeeded ?? lr.total), failed: n(lr.failed), mode: s(lr.mode) }
                    : fallback
                      ? { status: s(fallback.status), started: s(fallback.started_at), ended: s(fallback.finished_at ?? fallback.ended_at), duration: n(fallback.duration_seconds), succeeded: n(fallback.entities_succeeded ?? fallback.succeeded), failed: n(fallback.entities_failed ?? fallback.failed), mode: s(fallback.mode) }
                      : null;
                  if (!run) return (
                    <>
                      <div className="text-lg font-bold text-muted-foreground/50">{"\u2014"}</div>
                      <div className="text-[10px] text-muted-foreground">No runs recorded</div>
                    </>
                  );
                  const statusNorm = (run.status || "").toLowerCase();
                  const isSuccess = statusNorm === "completed" || statusNorm === "succeeded" || statusNorm === "completed_with_errors";
                  const isFail = statusNorm === "failed";
                  const isRunning = statusNorm === "running";
                  return (
                    <>
                      <div className="text-lg font-bold tabular-nums text-foreground">
                        {timeAgo(run.ended || run.started)}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded border font-mono",
                          isSuccess ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : isFail ? "bg-red-500/10 text-red-400 border-red-500/20"
                            : isRunning ? "bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse"
                            : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                        )}>
                          {run.status}{run.mode ? ` (${run.mode})` : ""}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {humanDuration(run.duration)}
                        </span>
                      </div>
                      {fallback && (run.succeeded > 0 || run.failed > 0) && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          <span className="text-emerald-400">{fmt(run.succeeded)}</span> ok
                          {run.failed > 0 && <>, <span className="text-red-400">{fmt(run.failed)}</span> failed</>}
                        </div>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Card 4: Active Errors */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Active Errors</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={cn("text-2xl font-bold tabular-nums", totalSummary.error > 0 ? "text-red-400" : "text-foreground")}>
                  {fmt(totalSummary.error)}
                </div>
                {engineMetrics?.top_errors && engineMetrics.top_errors.length > 0 ? (
                  <div className="text-[10px] text-muted-foreground mt-1 truncate">
                    Top: {engineMetrics.top_errors[0].error_message?.slice(0, 60) || "Unknown"}
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {totalSummary.error === 0 ? "No errors detected" : "Check entity details for errors"}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ================================================================ */}
          {/* LAYER SUMMARY BAR */}
          {/* ================================================================ */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Layer Health</span>
                <span className="text-[9px] text-muted-foreground ml-auto">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1 align-middle" />succeeded
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1 ml-3 align-middle" />failed
                  <span className="inline-block w-2 h-2 rounded-full bg-zinc-600 mr-1 ml-3 align-middle" />never run
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <LayerBar label="Landing Zone" counts={layerCounts.lz} />
                <LayerBar label="Bronze" counts={layerCounts.bz} />
                <LayerBar label="Silver" counts={layerCounts.sv} />
              </div>
            </CardContent>
          </Card>

          {/* ================================================================ */}
          {/* ENTITY MATRIX TABLE */}
          {/* ================================================================ */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                Showing {fmt(pagedEntities.length)} of {fmt(filteredEntities.length)} entities
                {filteredEntities.length !== allEntities.length && ` (${fmt(allEntities.length)} total)`}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                  <span className="text-xs text-muted-foreground px-2">Page {page + 1} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border overflow-hidden bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="w-8 px-3 py-2.5" />
                      <th className="px-3 py-2.5 text-left">
                        <button onClick={() => toggleSort("id")} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                          ID <SortIcon col="id" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 text-left">
                        <button onClick={() => toggleSort("tableName")} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                          Source Name <SortIcon col="tableName" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 text-left">
                        <button onClick={() => toggleSort("source")} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                          Data Source <SortIcon col="source" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 text-left">
                        <button onClick={() => toggleSort("targetSchema")} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                          Target Schema <SortIcon col="targetSchema" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 text-center">
                        <button onClick={() => toggleSort("lzStatus")} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                          Landing Zone <SortIcon col="lzStatus" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 text-center">
                        <button onClick={() => toggleSort("bronzeStatus")} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                          Bronze <SortIcon col="bronzeStatus" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 text-center">
                        <button onClick={() => toggleSort("silverStatus")} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                          Silver <SortIcon col="silverStatus" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 text-right">
                        <button onClick={() => toggleSort("lzLastLoad")} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                          Last Load <SortIcon col="lzLastLoad" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 text-center">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedEntities.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-12 text-center">
                          <Database className="w-10 h-10 text-muted-foreground/15 mx-auto mb-3" />
                          <p className="text-sm text-muted-foreground">No entities match your filters</p>
                          <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or filter criteria</p>
                        </td>
                      </tr>
                    )}
                    {pagedEntities.map(entity => (
                      <EntityRow
                        key={entity.id}
                        entity={entity}
                        isExpanded={expandedEntity === entity.id}
                        onToggleExpand={() => toggleExpand(entity.id)}
                        logs={expandedEntity === entity.id ? entityLogs : []}
                        logsLoading={expandedEntity === entity.id && entityLogsLoading}
                        resetConfirm={resetConfirm}
                        setResetConfirm={setResetConfirm}
                        onReset={handleReset}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 mt-3">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <span className="text-xs text-muted-foreground px-3">Page {page + 1} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            )}
          </div>

          {/* ================================================================ */}
          {/* ERROR SUMMARY PANEL */}
          {/* ================================================================ */}
          {engineMetrics?.top_errors && engineMetrics.top_errors.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-semibold">Top Errors</span>
                  <span className="text-[10px] text-muted-foreground font-normal ml-1">
                    (last {timeRange})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {engineMetrics.top_errors.slice(0, 5).map((err, i) => (
                    <button
                      key={i}
                      onClick={() => setErrorFilter(errorFilter === err.error_message ? null : err.error_message)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-md border text-left transition-colors",
                        errorFilter === err.error_message
                          ? "border-red-500/30 bg-red-500/10"
                          : "border-border bg-muted hover:bg-muted/50"
                      )}
                    >
                      <span className="flex-shrink-0 w-8 h-8 rounded-md bg-red-500/10 flex items-center justify-center">
                        <span className="text-sm font-bold text-red-400">{err.count}</span>
                      </span>
                      <span className="text-xs text-muted-foreground truncate flex-1 font-mono">
                        {err.error_message || "Unknown error"}
                      </span>
                      <Filter className={cn("w-3.5 h-3.5 flex-shrink-0", errorFilter === err.error_message ? "text-red-400" : "text-muted-foreground/30")} />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ================================================================ */}
          {/* RECENT RUNS (mini bar chart if metrics available) */}
          {/* ================================================================ */}
          {engineMetrics && engineMetrics.layers.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-semibold">Layer Throughput</span>
                  <span className="text-[10px] text-muted-foreground font-normal ml-1">
                    (last {timeRange} &mdash; {engineMetrics.runs} runs)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={engineMetrics.layers} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <XAxis dataKey="Layer" tick={{ fontSize: 11, fill: "#a0a0a0" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} width={40} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #333", borderRadius: "8px", fontSize: "12px" }}
                        labelStyle={{ color: "#eaeaea", fontWeight: 600 }}
                        itemStyle={{ color: "#a0a0a0" }}
                      />
                      <Bar dataKey="Succeeded" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {engineMetrics.slowest_entities.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Slowest Entities</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                      {engineMetrics.slowest_entities.slice(0, 6).map((se, i) => (
                        <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted border border-border">
                          <span className="text-[10px] text-amber-400 font-mono font-bold">{humanDuration(se.duration_seconds)}</span>
                          <span className="text-[10px] text-muted-foreground truncate flex-1">{se.entity_name}</span>
                          <span className="text-[9px] text-muted-foreground/60 uppercase">{se.layer}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// ENTITY ROW SUB-COMPONENT
// ============================================================================

interface EntityRowProps {
  entity: DigestEntity;
  isExpanded: boolean;
  onToggleExpand: () => void;
  logs: EngineLog[];
  logsLoading: boolean;
  resetConfirm: number | null;
  setResetConfirm: (id: number | null) => void;
  onReset: (id: number) => void;
}

function EntityRow({ entity, isExpanded, onToggleExpand, logs, logsLoading, resetConfirm, setResetConfirm, onReset }: EntityRowProps) {
  const e = entity;

  // Find the most recent load time across all layers
  const lastLoadTime = useMemo(() => {
    const times = [e.lzLastLoad, e.bronzeLastLoad, e.silverLastLoad].filter(Boolean);
    if (!times.length) return null;
    return times.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  }, [e.lzLastLoad, e.bronzeLastLoad, e.silverLastLoad]);

  return (
    <>
      <tr
        className={cn(
          "border-b border-border/50 cursor-pointer transition-colors",
          isExpanded ? "bg-muted" : "hover:bg-muted/50"
        )}
        onClick={onToggleExpand}
      >
        {/* Expand chevron */}
        <td className="px-3 py-2">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        </td>

        {/* Entity ID */}
        <td className="px-3 py-2">
          <span className="text-xs font-mono text-muted-foreground">{e.id}</span>
        </td>

        {/* Source Name (schema.table) */}
        <td className="px-3 py-2">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-foreground">{e.tableName}</span>
            <span className="text-[10px] text-muted-foreground">{e.sourceSchema}</span>
          </div>
        </td>

        {/* Data Source */}
        <td className="px-3 py-2">
          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", overallStatusCls(e.overall), "border-current/20 bg-current/5")}>
            {e.dataSourceName || e.source}
          </span>
        </td>

        {/* Target Schema */}
        <td className="px-3 py-2">
          <span className="text-[10px] font-mono text-muted-foreground">{e.targetSchema}</span>
        </td>

        {/* Landing Zone */}
        <td className="px-3 py-2 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium", layerStatusCls(e.lzStatus))}>
              {layerStatusIcon(e.lzStatus)} {layerStatusLabel(e.lzStatus)}
            </span>
            {e.lzLastLoad && <span className="text-[9px] text-muted-foreground">{timeAgo(e.lzLastLoad)}</span>}
          </div>
        </td>

        {/* Bronze */}
        <td className="px-3 py-2 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium", layerStatusCls(e.bronzeStatus))}>
              {layerStatusIcon(e.bronzeStatus)} {layerStatusLabel(e.bronzeStatus)}
            </span>
            {e.bronzeLastLoad && <span className="text-[9px] text-muted-foreground">{timeAgo(e.bronzeLastLoad)}</span>}
          </div>
        </td>

        {/* Silver */}
        <td className="px-3 py-2 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium", layerStatusCls(e.silverStatus))}>
              {layerStatusIcon(e.silverStatus)} {layerStatusLabel(e.silverStatus)}
            </span>
            {e.silverLastLoad && <span className="text-[9px] text-muted-foreground">{timeAgo(e.silverLastLoad)}</span>}
          </div>
        </td>

        {/* Last Load */}
        <td className="px-3 py-2 text-right">
          <span className="text-[10px] text-muted-foreground">{formatTimestamp(lastLoadTime)}</span>
        </td>

        {/* Actions */}
        <td className="px-3 py-2 text-center" onClick={ev => ev.stopPropagation()}>
          {resetConfirm === e.id ? (
            <div className="inline-flex items-center gap-1">
              <Button variant="destructive" size="sm" className="h-6 text-[10px] px-2" onClick={() => onReset(e.id)}>
                Confirm
              </Button>
              <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setResetConfirm(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
              onClick={() => setResetConfirm(e.id)}
              title="Reset watermark"
            >
              <RotateCcw className="w-3 h-3" />
            </Button>
          )}
        </td>
      </tr>

      {/* Expanded row: entity logs */}
      {isExpanded && (
        <tr className="bg-muted">
          <td colSpan={10} className="px-6 py-3">
            <div className="space-y-2">
              {/* Entity metadata summary */}
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground mb-2">
                <span>Watermark: <strong className="text-foreground font-mono">{e.watermarkColumn || "none"}</strong></span>
                <span>Incremental: <strong className="text-foreground">{e.isIncremental ? "Yes" : "No"}</strong></span>
                <span>Bronze ID: <strong className="text-foreground font-mono">{e.bronzeId ?? "\u2014"}</strong></span>
                <span>Silver ID: <strong className="text-foreground font-mono">{e.silverId ?? "\u2014"}</strong></span>
                {e.bronzePKs && <span>PKs: <strong className="text-foreground font-mono">{e.bronzePKs}</strong></span>}
              </div>

              {/* Last error */}
              {e.lastError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-red-500/20 bg-red-500/5">
                  <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-[10px] text-red-400 font-medium">{e.lastError.layer} layer error</span>
                    <span className="text-[10px] text-muted-foreground ml-2">{timeAgo(e.lastError.time)}</span>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{e.lastError.message}</p>
                  </div>
                </div>
              )}

              {/* Diagnosis */}
              {e.diagnosis && (
                <div className="text-[10px] text-muted-foreground italic px-1">
                  {e.diagnosis}
                </div>
              )}

              {/* Recent task logs from engine */}
              {logsLoading && (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading task logs...</span>
                </div>
              )}

              {!logsLoading && logs.length === 0 && (
                <p className="text-[10px] text-muted-foreground/60 py-2 text-center">
                  No engine task logs available for this entity
                </p>
              )}

              {!logsLoading && logs.length > 0 && (
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border">
                        <th className="px-2 py-1.5 text-left text-muted-foreground font-semibold uppercase tracking-wider">Run</th>
                        <th className="px-2 py-1.5 text-left text-muted-foreground font-semibold uppercase tracking-wider">Layer</th>
                        <th className="px-2 py-1.5 text-left text-muted-foreground font-semibold uppercase tracking-wider">Status</th>
                        <th className="px-2 py-1.5 text-right text-muted-foreground font-semibold uppercase tracking-wider">Rows</th>
                        <th className="px-2 py-1.5 text-right text-muted-foreground font-semibold uppercase tracking-wider">Duration</th>
                        <th className="px-2 py-1.5 text-right text-muted-foreground font-semibold uppercase tracking-wider">Time</th>
                        <th className="px-2 py-1.5 text-left text-muted-foreground font-semibold uppercase tracking-wider">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(log => (
                        <tr key={log.log_id} className="border-b border-border/30">
                          <td className="px-2 py-1.5 font-mono text-muted-foreground">#{log.run_id}</td>
                          <td className="px-2 py-1.5 uppercase text-muted-foreground">{log.layer}</td>
                          <td className="px-2 py-1.5">
                            <span className={cn(
                              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-medium",
                              log.status === "succeeded" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                              log.status === "failed" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                              "bg-blue-500/10 text-blue-400 border-blue-500/20"
                            )}>
                              {log.status}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-foreground">
                            {log.rows_read > 0 ? fmt(log.rows_read) : "\u2014"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                            {humanDuration(log.duration_seconds)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">
                            {formatTimestamp(log.ended_at || log.started_at)}
                          </td>
                          <td className="px-2 py-1.5 text-red-400/80 font-mono truncate max-w-[200px]">
                            {log.error_message || "\u2014"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
