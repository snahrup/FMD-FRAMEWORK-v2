import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Loader2, Search, Filter,
  XCircle, AlertTriangle, Clock, Activity,
  Database, Layers, Zap, Power,
  Play, Pause, AlertOctagon, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import { useEngineStatus, type TimeRange, type EngineLog } from "@/hooks/useEngineStatus";
import { KPICard } from "@/components/KPICard";
import { StatusPieChart } from "@/components/PieChart";
import { TimeRangeSelector } from "@/components/TimeRangeSelector";
import { EntityTable } from "@/components/EntityTable";

// ============================================================================
// HELPERS
// ============================================================================

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function timeAgo(isoDate: string | null | undefined): string {
  if (!isoDate) return "\u2014";
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  if (isNaN(then)) return "\u2014";
  const diff = now - then;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

function humanDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return "\u2014";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

type StatusFilter = "all" | "succeeded" | "failed" | "never-run" | "pending";

const DONUT_COLORS = ["#3D7C4F", "#B93A2A", "#A8A29E"]; // operational, fault, muted

// ============================================================================
// COMPONENT
// ============================================================================

export default function ExecutionMatrix() {
  // ── Digest data (entity-level status) ──
  const {
    allEntities,
    sourceList,
    totalSummary,
    data: digestData,
    loading: digestLoading,
    error: digestError,
    refresh: refreshDigest,
  } = useEntityDigest();

  // ── UI state ──
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [errorFilter, setErrorFilter] = useState<string | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Engine data via shared hook ──
  const {
    engineStatus,
    engineMetrics,
    loading: engineLoading,
    error: engineError,
    refresh: refreshEngine,
    fetchEntityLogs,
    resetEntityWatermark,
  } = useEngineStatus({ timeRange });

  // ── Refresh all data ──
  const refreshAll = useCallback(() => {
    refreshDigest();
    refreshEngine();
  }, [refreshDigest, refreshEngine]);

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

  // ── Derived: unique source names ──
  const sourceNames = useMemo(() => {
    const names = new Set<string>();
    allEntities.forEach((e) => {
      if (e.source) names.add(e.source);
    });
    return Array.from(names).sort();
  }, [allEntities]);

  // ── Derived: filter entities (sort is handled by EntityTable) ──
  const filteredEntities = useMemo(() => {
    let list = allEntities;

    // Source filter
    if (sourceFilter !== "all") {
      list = list.filter((e) => e.source === sourceFilter);
    }

    // Status filter
    if (statusFilter === "succeeded") {
      list = list.filter((e) => e.overall === "complete");
    } else if (statusFilter === "failed") {
      list = list.filter((e) => e.overall === "error");
    } else if (statusFilter === "never-run") {
      list = list.filter((e) => e.overall === "not_started");
    } else if (statusFilter === "pending") {
      list = list.filter((e) => e.overall === "pending" || e.overall === "partial");
    }

    // Error filter (from error panel)
    if (errorFilter) {
      list = list.filter((e) => e.lastError?.message?.includes(errorFilter));
    }

    // Search (defensive: coerce to string in case backend sends null/undefined)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          (e.tableName || "").toLowerCase().includes(q) ||
          (e.sourceSchema || "").toLowerCase().includes(q) ||
          (e.source || "").toLowerCase().includes(q) ||
          String(e.id).includes(q)
      );
    }

    return list;
  }, [allEntities, sourceFilter, statusFilter, searchQuery, errorFilter]);

  // ── Derived: layer-level counts from digest ──
  // NOTE: The entity_status.Status column may contain values beyond the
  // canonical "loaded"/"pending"/"not_started" — e.g., "Succeeded", "complete",
  // "Failed", "error", "InProgress". We bucket them correctly here.
  const layerCounts = useMemo(() => {
    const SUCCESS_VALUES = new Set(["loaded", "complete", "succeeded"]);
    const PENDING_VALUES = new Set(["pending", "inprogress", "running"]);

    const bucket = (status: string) => {
      const s = status.toLowerCase();
      if (SUCCESS_VALUES.has(s)) return "succeeded" as const;
      if (PENDING_VALUES.has(s)) return "pending" as const;
      // "not_started", "failed", "error", or anything unknown → pending-bucket
      // except actual failure statuses
      if (s === "not_started" || s === "") return "pending" as const;
      return "failed" as const;
    };

    const lz = { succeeded: 0, failed: 0, pending: 0 };
    const bz = { succeeded: 0, failed: 0, pending: 0 };
    const sv = { succeeded: 0, failed: 0, pending: 0 };

    allEntities.forEach((e) => {
      lz[bucket(e.lzStatus)]++;
      bz[bucket(e.bronzeStatus)]++;
      sv[bucket(e.silverStatus)]++;
    });

    return { lz, bz, sv };
  }, [allEntities]);

  // ── Derived: success rate for donut ──
  const successRate = useMemo(() => {
    const total = totalSummary.total;
    if (total === 0) return 0;
    return Math.round((totalSummary.complete / total) * 100);
  }, [totalSummary]);

  const donutData = useMemo(
    () => [
      { name: "Succeeded", value: totalSummary.complete },
      { name: "Failed", value: totalSummary.error },
      { name: "Other", value: totalSummary.pending + totalSummary.partial + totalSummary.not_started },
    ],
    [totalSummary]
  );

  // ── Engine status badge ──
  const engineBadge = () => {
    if (!engineStatus) {
      return (
        <Badge style={{ background: "var(--bp-surface-inset)", color: "var(--bp-ink-muted)", border: "1px solid var(--bp-border)" }}>
          <Power className="w-3 h-3 mr-1" /> Offline
        </Badge>
      );
    }
    const s = engineStatus.status?.toLowerCase();
    if (s === "running" || s === "active") {
      return (
        <Badge className="animate-pulse" style={{ background: "var(--bp-operational-light)", color: "var(--bp-operational)", border: "1px solid var(--bp-operational)" }}>
          <Activity className="w-3 h-3 mr-1" /> Running
        </Badge>
      );
    }
    if (s === "idle") {
      return (
        <Badge style={{ background: "var(--bp-copper-light)", color: "var(--bp-copper)", border: "1px solid var(--bp-copper)" }}>
          <Zap className="w-3 h-3 mr-1" /> Idle
        </Badge>
      );
    }
    if (s === "error") {
      return (
        <Badge style={{ background: "var(--bp-fault-light)", color: "var(--bp-fault)", border: "1px solid var(--bp-fault)" }}>
          <AlertOctagon className="w-3 h-3 mr-1" /> Error
        </Badge>
      );
    }
    return (
      <Badge style={{ background: "var(--bp-surface-inset)", color: "var(--bp-ink-muted)", border: "1px solid var(--bp-border)" }}>
        {engineStatus.status}
      </Badge>
    );
  };

  // ── Layer bar renderer ──
  const LayerBar = ({
    label,
    counts,
  }: {
    label: string;
    counts: { succeeded: number; failed: number; pending: number };
  }) => {
    const total = counts.succeeded + counts.failed + counts.pending;
    if (total === 0) return null;
    const pctSuccess = (counts.succeeded / total) * 100;
    const pctFail = (counts.failed / total) * 100;
    return (
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold" style={{ fontFamily: "var(--bp-font-body)", color: "var(--bp-ink-primary)" }}>{label}</span>
          <span className="text-[10px]" style={{ fontFamily: "var(--bp-font-mono)", fontFeatureSettings: "'tnum'", color: "var(--bp-ink-muted)" }}>
            <span style={{ color: "var(--bp-operational)" }}>{fmt(counts.succeeded)}</span>
            {" / "}
            <span style={{ color: "var(--bp-fault)" }}>{fmt(counts.failed)}</span>
            {" / "}
            <span style={{ color: "var(--bp-ink-muted)" }}>{fmt(counts.pending)}</span>
          </span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: "var(--bp-surface-inset)" }}>
          {counts.succeeded > 0 && (
            <div
              className="transition-all duration-500"
              style={{ width: `${pctSuccess}%`, background: "var(--bp-operational)" }}
            />
          )}
          {counts.failed > 0 && (
            <div
              className="transition-all duration-500"
              style={{ width: `${pctFail}%`, background: "var(--bp-fault)" }}
            />
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[9px]" style={{ color: "var(--bp-operational)" }}>{Math.round(pctSuccess)}% ok</span>
          {counts.failed > 0 && (
            <span className="text-[9px]" style={{ color: "var(--bp-fault)" }}>{Math.round(pctFail)}% fail</span>
          )}
        </div>
      </div>
    );
  };

  // ── Callbacks for EntityTable ──
  const handleFetchLogs = useCallback(
    async (entityId: number): Promise<EngineLog[]> => {
      return fetchEntityLogs(entityId);
    },
    [fetchEntityLogs]
  );

  const handleResetWatermark = useCallback(
    async (entityId: number): Promise<void> => {
      await resetEntityWatermark(entityId);
      refreshAll();
    },
    [resetEntityWatermark, refreshAll]
  );

  // ── RENDER ──

  const isInitialLoading = digestLoading && engineLoading && !digestData;

  return (
    <div className="space-y-6" style={{ padding: "32px", maxWidth: "1280px" }} data-testid="execution-matrix">
      {/* ================================================================ */}
      {/* HEADER BAR */}
      {/* ================================================================ */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "32px", color: "#1C1917", lineHeight: "1.1" }}>Execution Matrix</h1>
          {engineBadge()}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Time range */}
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />

          {/* Source filter */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-2 py-1.5 rounded-md border border-border bg-card text-foreground text-xs outline-none cursor-pointer"
            data-testid="source-filter"
          >
            <option value="all">All Sources</option>
            {sourceNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-2 py-1.5 rounded-md border border-border bg-card text-foreground text-xs outline-none cursor-pointer"
            data-testid="status-filter"
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
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="search-input"
            />
          </div>

          {/* Auto-refresh toggle */}
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh((a) => !a)}
            className="gap-1.5"
            data-testid="auto-refresh-toggle"
          >
            {autoRefresh ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {autoRefresh ? "Live" : "Auto"}
          </Button>

          {/* Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={digestLoading || engineLoading}
            data-testid="refresh-button"
          >
            {digestLoading || engineLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {(engineError || digestError) && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-lg border border-destructive/30 bg-destructive/5"
          data-testid="error-banner"
        >
          <XCircle className="w-5 h-5 text-destructive flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-destructive">Data load error</div>
            <div className="text-xs text-muted-foreground mt-0.5">{engineError || digestError}</div>
          </div>
        </div>
      )}

      {/* Error filter active banner */}
      {errorFilter && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg border"
          style={{ borderColor: "var(--bp-caution)", background: "var(--bp-caution-light)" }}
          data-testid="error-filter-banner"
        >
          <Filter className="w-4 h-4" style={{ color: "var(--bp-caution)" }} />
          <span className="text-xs" style={{ color: "var(--bp-caution)" }}>
            Filtered to entities matching error:{" "}
            <strong style={{ fontFamily: "var(--bp-font-mono)" }}>
              {errorFilter.slice(0, 80)}
              {errorFilter.length > 80 ? "..." : ""}
            </strong>
          </span>
          <button
            onClick={() => setErrorFilter(null)}
            className="ml-auto text-xs underline"
            style={{ color: "var(--bp-caution)" }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Initial loading state */}
      {isInitialLoading && (
        <div className="flex flex-col items-center justify-center py-24" data-testid="loading-state">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-sm text-muted-foreground">Loading execution matrix...</p>
        </div>
      )}

      {!isInitialLoading && (
        <>
          {/* ================================================================ */}
          {/* SUMMARY CARDS (KPI) */}
          {/* ================================================================ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="kpi-grid">
            {/* Card 1: Total Entities */}
            <KPICard
              icon={<Database className="w-4 h-4" />}
              iconColor="text-[var(--bp-copper)]"
              label="Total Entities"
              value={fmt(totalSummary.total)}
              detail={
                <div className="flex items-center gap-2 flex-wrap">
                  {sourceList.map((s) => (
                    <span key={s.key} className="text-[9px] text-muted-foreground">
                      {s.name}:{" "}
                      <span className="text-foreground font-medium">{s.summary.total}</span>
                    </span>
                  ))}
                </div>
              }
            />

            {/* Card 2: Success Rate with mini donut */}
            <KPICard
              icon={<TrendingUp className="w-4 h-4" />}
              iconColor="text-[var(--bp-operational)]"
              label="Success Rate"
              value={`${successRate}%`}
              valueColor="text-[var(--bp-operational)]"
              inline={
                <StatusPieChart
                  data={donutData}
                  colors={DONUT_COLORS}
                  size={48}
                  innerRadius={14}
                  outerRadius={22}
                  className="-my-1"
                />
              }
              detail={`${fmt(totalSummary.complete)} complete, ${fmt(totalSummary.error)} errors`}
            />

            {/* Card 3: Last Run */}
            <KPICard
              icon={<Clock className="w-4 h-4" />}
              iconColor="text-[var(--bp-caution)]"
              label="Last Run"
              value={
                engineStatus?.last_run ? (
                  <span className="text-lg">
                    {timeAgo(engineStatus.last_run.ended_at || engineStatus.last_run.started_at)}
                  </span>
                ) : (
                  <span className="text-lg text-muted-foreground/50">{"\u2014"}</span>
                )
              }
              detail={
                engineStatus?.last_run ? (
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded border font-mono"
                      style={{
                        ...(engineStatus.last_run.status === "completed" || engineStatus.last_run.status === "succeeded"
                          ? { background: "var(--bp-operational-light)", color: "var(--bp-operational)", borderColor: "var(--bp-operational)" }
                          : engineStatus.last_run.status === "failed"
                            ? { background: "var(--bp-fault-light)", color: "var(--bp-fault)", borderColor: "var(--bp-fault)" }
                            : { background: "var(--bp-copper-light)", color: "var(--bp-copper)", borderColor: "var(--bp-copper)" }),
                      }}
                    >
                      {engineStatus.last_run.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {humanDuration(engineStatus.last_run.duration_seconds)}
                    </span>
                  </div>
                ) : (
                  "No runs recorded"
                )
              }
            />

            {/* Card 4: Active Errors */}
            <KPICard
              icon={<AlertTriangle className="w-4 h-4" />}
              iconColor="text-[var(--bp-fault)]"
              label="Active Errors"
              value={fmt(totalSummary.error)}
              valueColor={totalSummary.error > 0 ? "text-[var(--bp-fault)]" : undefined}
              detail={
                engineMetrics?.top_errors && engineMetrics.top_errors.length > 0 ? (
                  <span className="truncate">
                    Top: {engineMetrics.top_errors[0].error_message?.slice(0, 60) || "Unknown"}
                  </span>
                ) : totalSummary.error === 0 ? (
                  "No errors detected"
                ) : (
                  "Check entity details for errors"
                )
              }
            />
          </div>

          {/* ================================================================ */}
          {/* LAYER SUMMARY BAR */}
          {/* ================================================================ */}
          <Card data-testid="layer-health">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Layer Health
                </span>
                <span className="text-[9px] ml-auto" style={{ color: "var(--bp-ink-muted)" }}>
                  <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: "var(--bp-operational)" }} />
                  succeeded
                  <span className="inline-block w-2 h-2 rounded-full mr-1 ml-3 align-middle" style={{ background: "var(--bp-fault)" }} />
                  failed
                  <span className="inline-block w-2 h-2 rounded-full mr-1 ml-3 align-middle" style={{ background: "var(--bp-ink-muted)" }} />
                  never run
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
          <EntityTable
            entities={filteredEntities}
            totalCount={allEntities.length}
            onFetchLogs={handleFetchLogs}
            onResetWatermark={handleResetWatermark}
          />

          {/* ================================================================ */}
          {/* ERROR SUMMARY PANEL */}
          {/* ================================================================ */}
          {engineMetrics?.top_errors && engineMetrics.top_errors.length > 0 && (
            <Card data-testid="error-panel">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4" style={{ color: "var(--bp-fault)" }} />
                  <span style={{ fontSize: "18px", fontWeight: 600, color: "#1C1917" }}>Top Errors</span>
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
                      onClick={() =>
                        setErrorFilter(errorFilter === err.error_message ? null : err.error_message)
                      }
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-md border text-left transition-colors",
                        errorFilter === err.error_message
                          ? "border"
                          : "hover:opacity-80"
                      )}
                      style={errorFilter === err.error_message
                        ? { borderColor: "var(--bp-fault)", background: "var(--bp-fault-light)" }
                        : { borderColor: "var(--bp-border)", background: "var(--bp-surface-2)" }
                      }
                    >
                      <span className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "var(--bp-fault-light)" }}>
                        <span className="text-sm font-bold" style={{ color: "var(--bp-fault)", fontFamily: "var(--bp-font-mono)" }}>{err.count}</span>
                      </span>
                      <span className="text-xs truncate flex-1" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-secondary)" }}>
                        {err.error_message || "Unknown error"}
                      </span>
                      <Filter
                        className="w-3.5 h-3.5 flex-shrink-0"
                        style={{ color: errorFilter === err.error_message ? "var(--bp-fault)" : "var(--bp-ink-muted)" }}
                      />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ================================================================ */}
          {/* LAYER THROUGHPUT (bar chart from engine metrics) */}
          {/* ================================================================ */}
          {engineMetrics && engineMetrics.layers.length > 0 && (
            <Card data-testid="throughput-chart">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-4 h-4" style={{ color: "var(--bp-copper)" }} />
                  <span style={{ fontSize: "18px", fontWeight: 600, color: "#1C1917" }}>Layer Throughput</span>
                  <span className="text-[10px] text-muted-foreground font-normal ml-1">
                    (last {timeRange} &mdash; {engineMetrics.runs} runs)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48" data-testid="bar-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={engineMetrics.layers}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <XAxis
                        dataKey="Layer"
                        tick={{ fontSize: 11, fill: "#78716C" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#A8A29E" }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#FEFDFB",
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        labelStyle={{ color: "#1C1917", fontWeight: 600 }}
                        itemStyle={{ color: "#57534E" }}
                      />
                      <Bar dataKey="Succeeded" fill="#3D7C4F" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Failed" fill="#B93A2A" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {engineMetrics.slowest_entities.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Slowest Entities
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                      {engineMetrics.slowest_entities.slice(0, 6).map((se, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/30 border border-border"
                        >
                          <span className="text-[10px] font-bold" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-caution)" }}>
                            {humanDuration(se.duration_seconds)}
                          </span>
                          <span className="text-[10px] text-muted-foreground truncate flex-1">
                            {se.entity_name}
                          </span>
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
