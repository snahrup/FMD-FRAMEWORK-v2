import { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity, CheckCircle2, Clock, Database, HardDrive, Loader2,
  RefreshCw, Server, TrendingUp, Zap, Circle, ArrowUpRight,
  BarChart3, Timer, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSourceConfig } from "@/hooks/useSourceConfig";

// ── Types ──

interface OverallProgress {
  TotalEntities: number;
  LoadedEntities: number;
  PendingEntities: number;
  PctComplete: number;
  RunStarted: string | null;
  LastActivity: string | null;
  ElapsedSeconds: number | null;
}

interface SourceProgress {
  Source: string;
  TotalEntities: number;
  LoadedCount: number;
  PendingCount: number;
  PctComplete: number;
  FirstLoaded: string | null;
  LastLoaded: string | null;
}

interface RecentActivity {
  TableName: string;
  Source: string;
  LogType: string;
  LogTime: string;
  Layer: string;
  LogData: string | null;
  EntityId: number;
}

interface LoadedEntity {
  Source: string;
  Schema: string;
  TableName: string;
  LoadedAt: string | null;
  TargetFile: string;
  IsIncremental: boolean;
  EntityId: number;
  RowsCopied: number | null;
  Duration: string | null;
  Status: string;
}

interface PendingBySource {
  Source: string;
  cnt: number;
}

interface ConcurrencyPoint {
  time: string;
  concurrent: number;
  bySource: Record<string, number>;
}

interface LoadData {
  overall: OverallProgress;
  bySource: SourceProgress[];
  recentActivity: RecentActivity[];
  loadedEntities: LoadedEntity[];
  pendingBySource: PendingBySource[];
  concurrencyTimeline: ConcurrencyPoint[];
  serverTime: string;
  error?: string;
}

// ── Helpers ──

function formatDuration(seconds: number | null): string {
  if (!seconds) return "--";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
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

function parseLogData(logData: string | null): { rowsCopied?: number; duration?: string; source?: string } | null {
  if (!logData) return null;
  try { return JSON.parse(logData); } catch { return null; }
}

// ── Normalize API response (all values come back as strings from pyodbc) ──

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
  return !!v;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

function normalizeData(raw: LoadData): LoadData {
  const o = raw.overall;
  return {
    ...raw,
    overall: {
      TotalEntities: num(o.TotalEntities),
      LoadedEntities: num(o.LoadedEntities),
      PendingEntities: num(o.PendingEntities),
      PctComplete: num(o.PctComplete),
      RunStarted: str(o.RunStarted),
      LastActivity: str(o.LastActivity),
      ElapsedSeconds: o.ElapsedSeconds != null ? num(o.ElapsedSeconds) : null,
    },
    bySource: raw.bySource.map((s) => ({
      ...s,
      TotalEntities: num(s.TotalEntities),
      LoadedCount: num(s.LoadedCount),
      PendingCount: num(s.PendingCount),
      PctComplete: num(s.PctComplete),
    })),
    loadedEntities: raw.loadedEntities.map((e) => ({
      ...e,
      EntityId: num(e.EntityId),
      IsIncremental: bool(e.IsIncremental),
      Status: e.Status || (e.LoadedAt ? "Loaded" : "Pending"),
    })),
    recentActivity: raw.recentActivity.map((a) => ({
      ...a,
      EntityId: num(a.EntityId),
    })),
  };
}

// ── Component ──

export default function LoadProgress() {
  const { resolveLabel, getColor } = useSourceConfig();
  const [data, setData] = useState<LoadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<"activity" | "loaded">("activity");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const prevLoadedCount = useRef(0);
  const [recentlyLoaded, setRecentlyLoaded] = useState<Set<number>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      const resp = await fetch("/api/load-progress");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const raw: LoadData = await resp.json();
      if (raw.error) throw new Error(raw.error);
      const d = normalizeData(raw);

      // Track newly loaded entities for animation
      if (data && d.overall.LoadedEntities > prevLoadedCount.current) {
        const newIds = new Set(
          d.loadedEntities
            .slice(0, d.overall.LoadedEntities - prevLoadedCount.current)
            .map((e) => e.EntityId)
        );
        setRecentlyLoaded(newIds);
        setTimeout(() => setRecentlyLoaded(new Set()), 3000);
      }
      prevLoadedCount.current = d.overall.LoadedEntities;

      setData(d);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchData]);

  const overall = data?.overall;
  const isActive = overall && overall.LoadedEntities > 0 && overall.PendingEntities > 0;

  // Filter loaded entities by source
  const filteredLoaded = sourceFilter
    ? data?.loadedEntities.filter((e) => e.Source === sourceFilter) ?? []
    : data?.loadedEntities ?? [];

  const totalRowsLoaded = data?.loadedEntities?.reduce((sum, e) => sum + num(e.RowsCopied), 0) ?? 0;

  const filteredActivity = sourceFilter
    ? data?.recentActivity.filter((e) => e.Source === sourceFilter) ?? []
    : data?.recentActivity ?? [];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Load Progress</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time Landing Zone load monitoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Auto-refresh toggle */}
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all text-xs font-medium",
                autoRefresh
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {autoRefresh ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              ) : (
                <Circle className="h-2 w-2" />
              )}
              {autoRefresh ? "LIVE" : "Paused"}
            </button>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs text-muted-foreground"
            >
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
            </select>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </button>
          {lastRefresh && (
            <span className="text-[10px] text-muted-foreground/60">
              {timeAgo(lastRefresh.toISOString())}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* ── Overall Progress Hero ── */}
      {overall && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-2.5 rounded-xl",
                isActive ? "bg-cyan-500/10" : overall.PctComplete >= 100 ? "bg-emerald-500/10" : "bg-muted"
              )}>
                {isActive ? (
                  <Loader2 className="h-5 w-5 text-cyan-400 animate-spin" />
                ) : overall.PctComplete >= 100 ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : (
                  <Database className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div>
                <div className="text-3xl font-bold tracking-tight">
                  {overall.LoadedEntities.toLocaleString()}
                  <span className="text-lg text-muted-foreground font-normal">
                    {" "}/ {overall.TotalEntities.toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">entities loaded to Landing Zone</p>
              </div>
            </div>

            {/* KPI cards */}
            <div className="flex gap-4">
              <div className="text-center px-4 py-2 rounded-lg bg-muted">
                <div className={cn(
                  "text-2xl font-bold tabular-nums",
                  overall.PctComplete >= 100 ? "text-emerald-400" : overall.PctComplete > 0 ? "text-cyan-400" : "text-muted-foreground"
                )}>
                  {overall.PctComplete}%
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Complete</p>
              </div>
              <div className="text-center px-4 py-2 rounded-lg bg-muted">
                <div className="text-2xl font-bold tabular-nums text-amber-400">
                  {overall.PendingEntities.toLocaleString()}
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending</p>
              </div>
              {totalRowsLoaded > 0 && (
                <div className="text-center px-4 py-2 rounded-lg bg-muted">
                  <div className="text-2xl font-bold tabular-nums text-emerald-400">
                    {totalRowsLoaded.toLocaleString()}
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Rows Loaded</p>
                </div>
              )}
              <div className="text-center px-4 py-2 rounded-lg bg-muted">
                <div className="text-2xl font-bold tabular-nums text-muted-foreground">
                  {formatDuration(overall.ElapsedSeconds)}
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Elapsed</p>
              </div>
              {overall.LastActivity && (
                <div className="text-center px-4 py-2 rounded-lg bg-muted">
                  <div className="text-2xl font-bold tabular-nums text-violet-400">
                    {timeAgo(overall.LastActivity)}
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Load</p>
                </div>
              )}
            </div>
          </div>

          {/* Stacked progress bar — each source gets its own colored segment, same order as cards below */}
          <div className="relative h-3 rounded-full bg-muted/50 overflow-hidden flex">
            {data?.bySource?.map((s) => {
              const pct = overall.TotalEntities > 0
                ? (s.LoadedCount / overall.TotalEntities) * 100
                : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={s.Source}
                  className="h-full transition-all duration-1000 ease-out first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: getColor(s.Source).hex,
                  }}
                  title={`${resolveLabel(s.Source)}: ${s.LoadedCount} / ${s.TotalEntities} (${s.PctComplete}%)`}
                />
              );
            })}
            {isActive && (
              <div
                className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse pointer-events-none"
              />
            )}
          </div>
          {/* Source legend under bar */}
          {data?.bySource && data.bySource.some((s) => s.LoadedCount > 0) && (
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {data.bySource.map((s) => (
                <div key={s.Source} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: getColor(s.Source).hex }}
                  />
                  <span className="font-medium">{resolveLabel(s.Source)}</span>
                  <span className="tabular-nums">{s.LoadedCount} / {s.TotalEntities}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Source Progress Cards ── */}
      {data?.bySource && data.bySource.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {data.bySource.map((s) => {
            const c = getColor(s.Source);
            const isFiltered = sourceFilter === s.Source;
            return (
              <button
                key={s.Source}
                onClick={() => setSourceFilter(isFiltered ? null : s.Source)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-all hover:scale-[1.02]",
                  isFiltered
                    ? `${c.bg} border-2 ${c.ring.replace("ring-", "border-")}`
                    : "border-border bg-card hover:border-muted-foreground/30"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Server className={cn("h-3.5 w-3.5", c.text)} />
                    <span className={cn("text-sm font-bold uppercase tracking-wider", c.text)}>
                      {resolveLabel(s.Source)}
                    </span>
                  </div>
                  <span className={cn(
                    "text-xs font-bold tabular-nums",
                    s.PctComplete >= 100 ? "text-emerald-400" : s.PctComplete > 0 ? c.text : "text-muted-foreground"
                  )}>
                    {s.PctComplete}%
                  </span>
                </div>

                {/* Mini progress bar */}
                <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden mb-2">
                  <div
                    className={cn("h-full rounded-full transition-all duration-1000", c.bar)}
                    style={{ width: `${Math.min(s.PctComplete, 100)}%` }}
                  />
                </div>

                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{s.LoadedCount} loaded</span>
                  <span>{s.PendingCount} pending</span>
                </div>
                <div className="text-[10px] text-muted-foreground/60 mt-1 truncate">
                  {s.TotalEntities} entities
                </div>
                {s.LastLoaded && (
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                    Last: {timeAgo(s.LastLoaded)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Source filter indicator ── */}
      {sourceFilter && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Filtered by:</span>
          <span className={cn(
            "px-2 py-0.5 rounded-full font-bold uppercase text-[10px]",
            getColor(sourceFilter).bg,
            getColor(sourceFilter).text
          )}>
            {resolveLabel(sourceFilter)}
          </span>
          <button
            onClick={() => setSourceFilter(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Concurrency Timeline ── */}
      {data?.concurrencyTimeline && data.concurrencyTimeline.length > 1 && (() => {
        const timeline = data.concurrencyTimeline;
        // Downsample to max 200 points for smooth rendering
        const step = Math.max(1, Math.floor(timeline.length / 200));
        const points = timeline.filter((_, i) => i % step === 0 || i === timeline.length - 1);
        const maxC = Math.max(...points.map(p => p.concurrent), 1);
        const peakC = Math.max(...timeline.map(p => p.concurrent));
        const avgC = Math.round(timeline.reduce((s, p) => s + p.concurrent, 0) / timeline.length);
        // Get unique sources for stacked view
        const allSources = Array.from(new Set(timeline.flatMap(p => Object.keys(p.bySource))));
        const W = 100; // viewBox width percentage
        const H = 60;  // viewBox height

        return (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-cyan-400" />
                <span className="text-sm font-semibold">Concurrent Threads</span>
                <span className="text-[10px] text-muted-foreground ml-1">
                  Adaptive parallelism over time
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="h-3 w-3 text-cyan-400" />
                  <span className="text-muted-foreground">Peak:</span>
                  <span className="font-bold text-cyan-400 tabular-nums">{peakC}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <BarChart3 className="h-3 w-3 text-violet-400" />
                  <span className="text-muted-foreground">Avg:</span>
                  <span className="font-bold text-violet-400 tabular-nums">{avgC}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Timer className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">{points.length} samples</span>
                </div>
              </div>
            </div>
            <div className="relative">
              {/* Y-axis labels */}
              <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-[9px] text-muted-foreground/60 tabular-nums pr-1" style={{ width: '24px' }}>
                <span>{maxC}</span>
                <span>{Math.round(maxC / 2)}</span>
                <span>0</span>
              </div>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                className="w-full h-32 ml-6"
                style={{ width: 'calc(100% - 24px)' }}
              >
                {/* Grid lines */}
                {[0.25, 0.5, 0.75].map(f => (
                  <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} stroke="currentColor" className="text-border" strokeWidth="0.15" />
                ))}
                {/* Stacked areas per source */}
                {allSources.map((src, si) => {
                  const c = getColor(src);
                  const areaPoints = points.map((p, i) => {
                    const x = (i / (points.length - 1)) * W;
                    // Stack: sum of this source and all sources below
                    const below = allSources.slice(0, si).reduce((s, s2) => s + (p.bySource[s2] || 0), 0);
                    const top = below + (p.bySource[src] || 0);
                    const yTop = H - (top / maxC) * H;
                    const yBot = H - (below / maxC) * H;
                    return { x, yTop, yBot };
                  });
                  const pathD = `M ${areaPoints.map(p => `${p.x},${p.yTop}`).join(' L ')} L ${[...areaPoints].reverse().map(p => `${p.x},${p.yBot}`).join(' L ')} Z`;
                  return (
                    <path key={src} d={pathD} fill={c.hex} fillOpacity="0.35" stroke={c.hex} strokeWidth="0.3" />
                  );
                })}
                {/* Total concurrency line on top */}
                <polyline
                  fill="none"
                  stroke="rgb(34,211,238)"
                  strokeWidth="0.4"
                  points={points.map((p, i) => `${(i / (points.length - 1)) * W},${H - (p.concurrent / maxC) * H}`).join(' ')}
                />
              </svg>
              {/* X-axis time labels */}
              <div className="flex justify-between text-[9px] text-muted-foreground/60 tabular-nums ml-6 mt-1" style={{ width: 'calc(100% - 24px)' }}>
                {[0, Math.floor(points.length / 4), Math.floor(points.length / 2), Math.floor(3 * points.length / 4), points.length - 1].map(idx => {
                  const p = points[Math.min(idx, points.length - 1)];
                  const d = new Date(p.time + (p.time.endsWith('Z') ? '' : 'Z'));
                  return <span key={idx}>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
                })}
              </div>
            </div>
            {/* Source legend */}
            {allSources.length > 0 && (
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {allSources.map(src => (
                  <div key={src} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: getColor(src).hex }} />
                    <span>{resolveLabel(src)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Tab bar ── */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted w-fit">
        <button
          onClick={() => setActiveTab("activity")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all",
            activeTab === "activity"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Activity className="h-3.5 w-3.5" />
          Live Activity
          {data?.recentActivity && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {filteredActivity.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("loaded")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all",
            activeTab === "loaded"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          All Entities
          {data?.loadedEntities && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {filteredLoaded.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Live Activity Feed ── */}
      {activeTab === "activity" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-400" />
              <span className="text-sm font-semibold">Recent Copy Activity</span>
              {isActive && (
                <span className="relative flex h-2 w-2 ml-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
                </span>
              )}
            </div>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {filteredActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Clock className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm">No activity yet</p>
                <p className="text-xs mt-1 opacity-60">
                  Activity will appear here when a load is running
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[11px] text-muted-foreground uppercase tracking-wider bg-muted sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Time</th>
                    <th className="text-left px-4 py-2 font-medium">Source</th>
                    <th className="text-left px-4 py-2 font-medium">Table</th>
                    <th className="text-left px-4 py-2 font-medium">Event</th>
                    <th className="text-right px-4 py-2 font-medium">Rows</th>
                    <th className="text-right px-4 py-2 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredActivity.map((a, i) => {
                    const parsed = parseLogData(a.LogData);
                    const isEnd = a.LogType?.includes("End");
                    const isFail = a.LogType?.includes("Fail");
                    const c = getColor(a.Source);
                    return (
                      <tr key={i} className={cn(
                        "hover:bg-muted/50 transition-colors",
                        isFail && "bg-red-500/5"
                      )}>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap text-xs tabular-nums">
                          {timeAgo(a.LogTime)}
                        </td>
                        <td className="px-4 py-2">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                            c.bg, c.text
                          )}>
                            {resolveLabel(a.Source)}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {a.TableName || "--"}
                        </td>
                        <td className="px-4 py-2">
                          <span className={cn(
                            "flex items-center gap-1 text-xs",
                            isEnd ? "text-emerald-400" : isFail ? "text-red-400" : "text-muted-foreground"
                          )}>
                            {isEnd ? <CheckCircle2 className="h-3 w-3" /> :
                             isFail ? <Zap className="h-3 w-3" /> :
                             <ArrowUpRight className="h-3 w-3" />}
                            {a.LogType?.replace("CopyActivity", "") || "--"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {parsed?.rowsCopied?.toLocaleString() ?? "--"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {parsed?.duration ?? "--"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Loaded Entities Table ── */}
      {activeTab === "loaded" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-semibold">
                All Entities
                <span className="ml-2 text-muted-foreground font-normal">
                  ({filteredLoaded.length})
                </span>
              </span>
            </div>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {filteredLoaded.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Database className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm">No entities found</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[11px] text-muted-foreground uppercase tracking-wider bg-muted sticky top-0">
                  <tr>
                    <th className="text-center px-4 py-2 font-medium">Status</th>
                    <th className="text-left px-4 py-2 font-medium">Source</th>
                    <th className="text-left px-4 py-2 font-medium">Schema</th>
                    <th className="text-left px-4 py-2 font-medium">Table</th>
                    <th className="text-right px-4 py-2 font-medium">Rows</th>
                    <th className="text-right px-4 py-2 font-medium">Duration</th>
                    <th className="text-left px-4 py-2 font-medium">Loaded</th>
                    <th className="text-center px-4 py-2 font-medium">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredLoaded.map((e) => {
                    const c = getColor(e.Source);
                    const isNew = recentlyLoaded.has(e.EntityId);
                    return (
                      <tr
                        key={e.EntityId}
                        className={cn(
                          "hover:bg-muted/50 transition-all",
                          isNew && "bg-emerald-500/10 animate-pulse"
                        )}
                      >
                        <td className="px-4 py-2 text-center">
                          {e.Status === "Loaded" ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                              Loaded
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                            c.bg, c.text
                          )}>
                            {resolveLabel(e.Source)}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {e.Schema || "dbo"}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs font-medium">
                          {e.TableName}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {num(e.RowsCopied) > 0 ? num(e.RowsCopied).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {e.Duration || "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                          {timeAgo(e.LoadedAt)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {e.IsIncremental ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-medium">
                              Incremental
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              Full
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      {data?.serverTime && (
        <div className="text-center text-[10px] text-muted-foreground/40">
          Server time: {new Date(data.serverTime).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
