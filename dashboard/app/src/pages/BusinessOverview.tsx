import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useTerminology } from "@/hooks/useTerminology";
import { resolveSourceLabel, getSourceColor } from "@/hooks/useSourceConfig";
import { AlertCircle, RefreshCw } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

interface KPIData {
  freshness_pct: number;
  freshness_on_time: number;
  freshness_total: number;
  open_alerts: number;
  sources_online: number;
  sources_total: number;
  total_entities: number;
  quality_avg: number;
}

interface SourceHealth {
  name: string;
  displayName: string;
  status: "operational" | "degraded" | "offline";
  entityCount: number;
  lastRefreshed: string | null;
}

interface ActivityEvent {
  entityName: string;
  source: string;
  layer: string;
  status: "success" | "error" | "warning" | "running";
  lastLoadDate: string | null;
}

// ── Helpers ──

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function sourceStatusLabel(status: SourceHealth["status"]): string {
  if (status === "operational") return "Operational";
  if (status === "degraded") return "Degraded";
  return "Offline";
}

function sourceStatusClass(status: SourceHealth["status"]): string {
  if (status === "operational") return "text-emerald-600 dark:text-emerald-400";
  if (status === "degraded") return "text-amber-600 dark:text-amber-400";
  return "text-red-500 dark:text-red-400";
}

function alertSeverityClass(status: ActivityEvent["status"]): string {
  if (status === "error") return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400";
  if (status === "warning") return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

function alertSeverityLabel(status: ActivityEvent["status"]): string {
  if (status === "error") return "Critical";
  if (status === "warning") return "Warning";
  return "Info";
}

function alertRailClass(status: ActivityEvent["status"]): string {
  if (status === "error") return "bg-red-500";
  if (status === "warning") return "bg-amber-500";
  return "bg-border";
}

// ── Progress Ring ──

function ProgressRing({ pct }: { pct: number }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(pct, 100) / 100);

  const strokeColor =
    pct >= 95 ? "#22c55e" : pct >= 80 ? "#f59e0b" : "#ef4444";

  return (
    <svg width="72" height="72" viewBox="0 0 80 80" className="shrink-0" aria-hidden="true">
      <circle
        cx="40" cy="40" r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        className="text-muted/30"
      />
      <circle
        cx="40" cy="40" r={r}
        fill="none"
        stroke={strokeColor}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dashoffset 0.5s ease" }}
      />
    </svg>
  );
}

// ── Skeleton ──

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted/50", className)} />;
}

function KPIRowSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-lg p-5">
          <Skeleton className="h-3 w-24 mb-3" />
          <Skeleton className="h-10 w-20 mb-2" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──

export default function BusinessOverview() {
  const { t, layer } = useTerminology();

  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchAll() {
    try {
      const [kpiRes, srcRes, actRes] = await Promise.all([
        fetch(`${API}/api/overview/kpis`),
        fetch(`${API}/api/overview/sources`),
        fetch(`${API}/api/overview/activity`),
      ]);

      if (!kpiRes.ok || !srcRes.ok || !actRes.ok) {
        throw new Error("One or more overview endpoints returned an error");
      }

      const [kpiData, srcData, actData] = await Promise.all([
        kpiRes.json(),
        srcRes.json(),
        actRes.json(),
      ]);

      setKpis(kpiData);
      setSources(srcData);
      setActivity(actData);
      setLastRefreshed(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 30_000);
    return () => clearInterval(timer);
  }, []);

  const alerts = activity.filter((a) => a.status === "error" || a.status === "warning").slice(0, 5);
  const recentActivity = activity.slice(0, 8);

  // ── Render ──

  return (
    <div className="p-8 max-w-[1280px]">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-6">
        <h1 className="text-3xl font-display font-semibold text-foreground tracking-tight">
          Overview
        </h1>
        <span className="text-sm text-muted-foreground">
          {lastRefreshed ? `Last refreshed: ${relativeTime(lastRefreshed.toISOString())}` : "Loading…"}
        </span>
        <button
          onClick={fetchAll}
          className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* KPI Row */}
      {loading ? (
        <KPIRowSkeleton />
      ) : (
        <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-4 mb-6">
          {/* Data Freshness */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center gap-5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Data Freshness
                </div>
                <div className="font-mono text-4xl font-medium text-foreground tabular-nums leading-none">
                  {kpis ? `${kpis.freshness_pct.toFixed(1)}%` : "—"}
                </div>
                <div className="text-sm text-muted-foreground mt-1.5">
                  {kpis
                    ? `${kpis.freshness_on_time.toLocaleString()} of ${kpis.freshness_total.toLocaleString()} ${t("Entities").toLowerCase()} on schedule`
                    : "—"}
                </div>
              </div>
              <ProgressRing pct={kpis?.freshness_pct ?? 0} />
            </div>
          </div>

          {/* Open Alerts */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Open Alerts
            </div>
            <div
              className={cn(
                "font-mono text-4xl font-medium tabular-nums leading-none",
                kpis && kpis.open_alerts > 0 ? "text-red-500 dark:text-red-400" : "text-foreground"
              )}
            >
              {kpis?.open_alerts ?? "—"}
            </div>
            <div className="text-sm text-muted-foreground mt-1.5">
              {kpis?.open_alerts === 0 ? "All clear" : kpis?.open_alerts === 1 ? "1 needs attention" : `${kpis?.open_alerts} need attention`}
            </div>
          </div>

          {/* Sources Online */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Sources Online
            </div>
            <div className="font-mono text-4xl font-medium text-foreground tabular-nums leading-none">
              {kpis ? (
                <>
                  {kpis.sources_online}
                  <span className="text-2xl text-muted-foreground"> / {kpis.sources_total}</span>
                </>
              ) : "—"}
            </div>
            <div className="text-sm text-muted-foreground mt-1.5">
              {kpis && kpis.sources_online === kpis.sources_total
                ? "All sources connected"
                : kpis
                ? `${kpis.sources_total - kpis.sources_online} offline`
                : "—"}
            </div>
          </div>

          {/* Total Data Assets */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t("Total Entities")}
            </div>
            <div className="font-mono text-4xl font-medium text-foreground tabular-nums leading-none">
              {kpis ? kpis.total_entities.toLocaleString() : "—"}
            </div>
            <div className="text-sm text-muted-foreground mt-1.5">
              Across {kpis ? kpis.sources_total : "—"} sources
            </div>
          </div>
        </div>
      )}

      {/* Content Split */}
      <div className="grid grid-cols-[3fr_2fr] gap-6">
        {/* Left: Recent Alerts */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground">Recent Alerts</span>
            <a
              href="#/alerts"
              className="text-[13px] text-primary hover:text-primary/80 font-medium transition-colors"
            >
              View all alerts →
            </a>
          </div>

          {loading ? (
            <div className="divide-y divide-border/50">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="px-5 py-4 pl-8">
                  <Skeleton className="h-3 w-40 mb-2" />
                  <Skeleton className="h-4 w-64 mb-1.5" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No active alerts — all systems normal
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {alerts.map((alert, i) => {
                const srcLabel = resolveSourceLabel(alert.source);
                const srcColor = getSourceColor(alert.source);
                return (
                  <div key={i} className="relative flex gap-3 px-5 py-4 pl-8">
                    {/* Severity rail */}
                    <div
                      className={cn(
                        "absolute left-0 top-0 bottom-0 w-[3px]",
                        alertRailClass(alert.status),
                        alert.status === "error" && "animate-pulse"
                      )}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={cn(
                            "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded",
                            alertSeverityClass(alert.status)
                          )}
                        >
                          {alertSeverityLabel(alert.status)}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className="inline-block w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: srcColor.hex }}
                          />
                          {srcLabel}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-foreground leading-snug">
                        {alert.entityName}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {layer(alert.layer)} layer
                        {alert.lastLoadDate ? ` · ${relativeTime(alert.lastLoadDate)}` : ""}
                      </div>
                    </div>

                    <span className="font-mono text-[11px] text-muted-foreground self-start mt-0.5 whitespace-nowrap">
                      {relativeTime(alert.lastLoadDate)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Stacked panels */}
        <div className="flex flex-col gap-5">
          {/* Source Health */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground">Source Health</span>
              <a
                href="#/sources"
                className="text-[13px] text-primary hover:text-primary/80 font-medium transition-colors"
              >
                All sources →
              </a>
            </div>

            <div className="max-h-[220px] overflow-y-auto scrollbar-thin">
              {loading ? (
                <div className="divide-y divide-border/50">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-2.5">
                      <Skeleton className="h-2.5 w-2.5 rounded-full" />
                      <Skeleton className="h-3 w-24 flex-1" />
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-3 w-8" />
                    </div>
                  ))}
                </div>
              ) : sources.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No sources configured
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {sources.map((src) => {
                    const srcColor = getSourceColor(src.name);
                    const label = src.displayName || resolveSourceLabel(src.name);
                    return (
                      <div key={src.name} className="flex items-center gap-2.5 px-5 py-2.5 text-[13px]">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: srcColor.hex }}
                        />
                        <span className="flex-1 font-medium text-foreground truncate">{label}</span>
                        <span className={cn("text-xs font-medium", sourceStatusClass(src.status))}>
                          {sourceStatusLabel(src.status)}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground min-w-[36px] text-right tabular-nums">
                          {src.entityCount.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground">Recent Activity</span>
            </div>

            <div className="max-h-[200px] overflow-y-auto scrollbar-thin">
              {loading ? (
                <div className="divide-y divide-border/50">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="px-5 py-2.5">
                      <Skeleton className="h-3 w-48 mb-1.5" />
                      <Skeleton className="h-2.5 w-16" />
                    </div>
                  ))}
                </div>
              ) : recentActivity.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No recent activity
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {recentActivity.map((evt, i) => {
                    const srcLabel = resolveSourceLabel(evt.source);
                    return (
                      <div key={i} className="px-5 py-2.5 text-[13px] text-muted-foreground leading-snug">
                        <span className="font-medium text-foreground">{evt.entityName}</span>
                        {" "}refreshed from {srcLabel}
                        {" "}· {layer(evt.layer)}
                        <br />
                        <span className="font-mono text-[11px] text-muted-foreground/70">
                          {relativeTime(evt.lastLoadDate)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
