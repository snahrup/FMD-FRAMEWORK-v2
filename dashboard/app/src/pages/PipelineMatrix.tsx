import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Loader2,
  Database,
  Factory,
  ShieldCheck,
  Cloud,
  FlaskConical,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Layers,
  Zap,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EntityDrillDown, type DrillDownConfig } from "@/components/pipeline-matrix/EntityDrillDown";

const API = "";

// ── Types ──

interface LayerData {
  loaded: number;
  registered: number;
  pending?: number;
  status: "complete" | "in_progress" | "partial" | "not_started";
}

interface SourceData {
  key: string;
  name: string;
  icon: string;
  lz: LayerData;
  bronze: LayerData;
  silver: LayerData;
}

interface PipelineRun {
  name: string;
  itemName: string;
  status: string;
  startTime: string;
  endTime: string;
  runId: string;
}

interface RecentRun {
  runId: string;
  pipeline: string;
  layer: string;
  startTime: string;
  endTime: string;
  status: string;
}

interface MatrixData {
  sources: Record<string, SourceData>;
  totals: {
    lz: number;
    bronze: number;
    silver: number;
    bronzePending: number;
    silverPending: number;
  };
  pipelines: PipelineRun[];
  recentRuns: RecentRun[];
  serverTime: string;
}

// ── Helpers ──

const SOURCE_ICONS: Record<string, typeof Database> = {
  factory: Factory,
  "shield-check": ShieldCheck,
  cloud: Cloud,
  "flask-conical": FlaskConical,
  database: Database,
};

const STATUS_COLORS: Record<string, { bg: string; ring: string; text: string; glow: string }> = {
  complete: { bg: "bg-[var(--success-soft)]", ring: "stroke-[var(--cl-success)]", text: "text-[var(--cl-success)]", glow: "shadow-[var(--cl-success)]/20" },
  in_progress: { bg: "bg-[var(--warning-soft)]", ring: "stroke-[var(--cl-warning)]", text: "text-[var(--cl-warning)]", glow: "shadow-[var(--cl-warning)]/20" },
  partial: { bg: "bg-[var(--info-soft)]", ring: "stroke-[var(--cl-info)]", text: "text-[var(--cl-info)]", glow: "shadow-[var(--cl-info)]/20" },
  not_started: { bg: "bg-muted/30", ring: "stroke-muted-foreground/30", text: "text-muted-foreground/50", glow: "" },
};

const PIPELINE_STATUS_COLOR: Record<string, string> = {
  Completed: "text-[var(--cl-success)]",
  InProgress: "text-[var(--cl-warning)]",
  Failed: "text-[var(--cl-error)]",
  NotStarted: "text-muted-foreground",
  Cancelled: "text-muted-foreground",
};

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function pct(loaded: number, registered: number): number {
  if (registered === 0) return 0;
  return Math.min(100, Math.round((loaded / registered) * 100));
}

function timeSince(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function duration(start: string, end: string): string {
  if (!start || !end) return "";
  const ms = new Date(end + (end.endsWith("Z") ? "" : "Z")).getTime() -
    new Date(start + (start.endsWith("Z") ? "" : "Z")).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ── Progress Ring Component ──

function ProgressRing({
  percentage,
  size = 72,
  strokeWidth = 5,
  status,
  children,
}: {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  status: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;
  const colors = STATUS_COLORS[status] || STATUS_COLORS.not_started;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-border"
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(colors.ring, "transition-all duration-1000 ease-out")}
          style={status === "in_progress" ? { filter: "drop-shadow(0 0 4px currentColor)" } : {}}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

// ── Animated Flow Line ──

function FlowLine({ status }: { status: string }) {
  const isActive = status === "complete" || status === "in_progress";
  const isFlowing = status === "in_progress";
  const colors = STATUS_COLORS[status] || STATUS_COLORS.not_started;

  return (
    <div className="flex-1 flex items-center mx-1 relative h-8">
      {/* Base line */}
      <div className={cn(
        "absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full",
        isActive ? "bg-border" : "bg-border/50"
      )} />
      {/* Active glow line */}
      {isActive && (
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full opacity-60"
          style={{
            backgroundColor: status === "complete"
              ? "var(--cl-success)"
              : "var(--cl-warning)",
            opacity: 0.3,
          }}
        />
      )}
      {/* Animated particles */}
      {isFlowing && (
        <>
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full blur-[2px]"
            style={{
              backgroundColor: "var(--cl-warning)",
              opacity: 0.8,
              animation: "flowParticle 2s linear infinite",
            }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
            style={{
              backgroundColor: "var(--cl-warning)",
              opacity: 0.6,
              animation: "flowParticle 2s linear infinite 0.7s",
            }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: "var(--cl-warning)",
              opacity: 0.4,
              animation: "flowParticle 2s linear infinite 1.4s",
            }}
          />
        </>
      )}
      {/* Completed shimmer */}
      {status === "complete" && (
        <div
          className="absolute top-1/2 -translate-y-1/2 w-8 h-[2px] rounded-full"
          style={{
            background: `linear-gradient(to right, transparent, var(--cl-success), transparent)`,
            opacity: 0.5,
            animation: "flowParticle 3s linear infinite",
          }}
        />
      )}
      {/* Arrow head */}
      <ArrowRight className={cn(
        "absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3",
        isActive ? colors.text : "text-muted-foreground/30"
      )} />
    </div>
  );
}

// ── Layer Node Component ──

function LayerNode({
  label,
  layer,
  showPending,
  onClick,
}: {
  label: string;
  layer: LayerData;
  showPending?: boolean;
  onClick?: () => void;
}) {
  const percentage = pct(layer.loaded, layer.registered);
  const colors = STATUS_COLORS[layer.status] || STATUS_COLORS.not_started;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button onClick={onClick} className="cursor-pointer group" title="Click for entity details">
        <ProgressRing percentage={percentage} status={layer.status} size={68} strokeWidth={4}>
          <div className="text-center">
            <div className={cn("text-sm font-bold tabular-nums group-hover:underline", colors.text)}>
              {fmtNum(layer.loaded)}
            </div>
          </div>
        </ProgressRing>
      </button>
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      {showPending && layer.pending && layer.pending > 0 ? (
        <span className="text-[10px] text-[var(--cl-warning)] flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" />
          {layer.pending} pending
        </span>
      ) : layer.status === "complete" ? (
        <span className="text-[10px] text-[var(--cl-success)] opacity-70 flex items-center gap-0.5">
          <CheckCircle2 className="w-2.5 h-2.5" />
          100%
        </span>
      ) : layer.status !== "not_started" ? (
        <span className={cn("text-[10px]", colors.text)}>{percentage}%</span>
      ) : null}
    </div>
  );
}

// ── Source Pipeline Card ──

function SourceCard({ source, isExpanded, onToggle, onDrillDown }: {
  source: SourceData;
  isExpanded: boolean;
  onToggle: () => void;
  onDrillDown: (layer?: string, status?: string) => void;
}) {
  const Icon = SOURCE_ICONS[source.icon] || Database;
  const overallPct = pct(
    source.lz.loaded + source.bronze.loaded + source.silver.loaded,
    source.lz.registered + source.bronze.registered + source.silver.registered
  );

  const allComplete =
    source.lz.status === "complete" &&
    source.bronze.status === "complete" &&
    source.silver.status === "complete";
  const anyInProgress =
    source.lz.status === "in_progress" ||
    source.bronze.status === "in_progress" ||
    source.silver.status === "in_progress";

  const totalPending = (source.bronze.pending || 0) + (source.silver.pending || 0);

  const lzToBronze =
    source.bronze.status === "complete" ? "complete" :
    source.bronze.status === "in_progress" ? "in_progress" :
    source.bronze.loaded > 0 ? "partial" : "not_started";
  const bronzeToSilver =
    source.silver.status === "complete" ? "complete" :
    source.silver.status === "in_progress" ? "in_progress" :
    source.silver.loaded > 0 ? "partial" : "not_started";

  return (
    <div
      className={cn(
        "rounded-[var(--radius-xl)] border transition-all duration-300",
        "bg-card shadow-[var(--shadow-card)]",
        allComplete
          ? "border-[var(--cl-success)]/30"
          : anyInProgress
          ? "border-[var(--cl-warning)]/30"
          : "border-border",
      )}
    >
      {/* Card Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-accent/50 rounded-t-[var(--radius-xl)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-[var(--radius-md)] flex items-center justify-center",
            allComplete ? "bg-[var(--success-soft)] text-[var(--cl-success)]" :
            anyInProgress ? "bg-[var(--warning-soft)] text-[var(--cl-warning)]" :
            "bg-muted text-muted-foreground"
          )}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{source.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground">{source.key}</span>
              {allComplete ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--success-soft)] text-[var(--cl-success)] font-medium">
                  All Layers Complete
                </span>
              ) : totalPending > 0 ? (
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                  anyInProgress
                    ? "bg-[var(--warning-soft)] text-[var(--cl-warning)] animate-pulse"
                    : "bg-[var(--info-soft)] text-[var(--cl-info)]"
                )}>
                  {totalPending} pending
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Mini completion bar */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-1000",
                )}
                style={{
                  width: `${overallPct}%`,
                  backgroundColor: allComplete
                    ? "var(--cl-success)"
                    : anyInProgress
                    ? "var(--cl-warning)"
                    : "var(--cl-info)",
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums w-8">{overallPct}%</span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Pipeline Flow Visualization */}
      <div className="px-5 pb-5">
        <div className="flex items-center justify-center gap-0">
          {/* Source indicator */}
          <div className="flex flex-col items-center mr-2">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <Database className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <span className="text-[9px] text-muted-foreground/60 mt-1">Source</span>
          </div>

          <FlowLine status={source.lz.loaded > 0 ? "complete" : "not_started"} />

          <LayerNode label="Landing Zone" layer={source.lz} onClick={() => onDrillDown("lz")} />

          <FlowLine status={lzToBronze} />

          <LayerNode label="Bronze" layer={source.bronze} showPending onClick={() => onDrillDown("bronze")} />

          <FlowLine status={bronzeToSilver} />

          <LayerNode label="Silver" layer={source.silver} showPending onClick={() => onDrillDown("silver")} />
        </div>
      </div>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {(["lz", "bronze", "silver"] as const).map((layer) => {
              const data = source[layer];
              const layerLabel = layer === "lz" ? "Landing Zone" : layer === "bronze" ? "Bronze" : "Silver";
              const colors = STATUS_COLORS[data.status];
              return (
                <div key={layer} className={cn("rounded-[var(--radius-md)] p-3 border border-border/50", colors.bg)}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-foreground/80">{layerLabel}</span>
                    {data.status === "complete" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[var(--cl-success)]" />
                    ) : data.status === "in_progress" ? (
                      <Loader2 className="w-3.5 h-3.5 text-[var(--cl-warning)] animate-spin" />
                    ) : data.status === "partial" ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-[var(--cl-info)]" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Loaded</span>
                      <span className={cn("font-mono font-bold", colors.text)}>{data.loaded}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Registered</span>
                      <span className="text-foreground/70 font-mono">{data.registered}</span>
                    </div>
                    {data.loaded < data.registered && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Gap</span>
                        <span className="text-[var(--cl-error)] font-mono">{data.registered - data.loaded}</span>
                      </div>
                    )}
                    {"pending" in data && data.pending! > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Pending</span>
                        <span className="text-[var(--cl-warning)] font-mono">{data.pending}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hero Stat Card ──

function HeroStat({
  label,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  subtitle?: string;
  icon: typeof Database;
  color: string;
}) {
  return (
    <div className="rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-card)] p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className={cn("text-3xl font-bold tabular-nums mt-1", color)}>
            {fmtNum(value)}
          </p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className="w-10 h-10 rounded-[var(--radius-md)] flex items-center justify-center bg-muted">
          <Icon className={cn("w-5 h-5", color)} />
        </div>
      </div>
    </div>
  );
}

// ── Active Pipeline Banner ──

function ActivePipelineBanner({ pipelines }: { pipelines: PipelineRun[] }) {
  const running = pipelines.filter(p =>
    p.status === "InProgress" || p.status === "NotStarted"
  );
  if (running.length === 0) return null;

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--cl-warning)]/30 bg-[var(--warning-soft)] px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-[var(--cl-warning)] animate-spin" />
          <span className="text-sm font-medium text-[var(--cl-warning)]">Pipeline Active</span>
        </div>
        <div className="flex-1 flex items-center gap-4 overflow-x-auto">
          {running.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
              <span className="text-foreground font-medium">{p.name}</span>
              <span className="text-border">|</span>
              <span>{timeSince(p.startTime)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──

export default function PipelineMatrix() {
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [drillDown, setDrillDown] = useState<DrillDownConfig | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const resp = await fetch(`${API}/api/pipeline-matrix`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setData(json);
      setError(null);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleSource = (key: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <AlertTriangle className="w-10 h-10 text-[var(--cl-error)]" />
        <p className="text-muted-foreground">{error}</p>
        <button onClick={fetchData} className="text-sm text-[var(--cl-info)] hover:underline">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const sources = Object.values(data.sources);
  const totals = data.totals;
  const totalLoaded = totals.lz + totals.bronze + totals.silver;
  const totalPending = totals.bronzePending + totals.silverPending;

  return (
    <div className="space-y-6">
      {/* CSS for flow animations */}
      <style>{`
        @keyframes flowParticle {
          0% { left: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { left: calc(100% - 12px); opacity: 0; }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Layers className="w-7 h-7 text-[var(--cl-info)]" />
            Data Pipeline Matrix
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time view of data flowing through the medallion architecture
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-muted-foreground/60">
              Updated {timeSince(lastRefresh.toISOString())}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-medium transition-colors cursor-pointer",
              "bg-secondary text-secondary-foreground hover:bg-accent border border-border",
              loading && "opacity-50 cursor-not-allowed"
            )}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Active Pipeline Banner */}
      <ActivePipelineBanner pipelines={data.pipelines} />

      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <HeroStat
          label="Landing Zone"
          value={totals.lz}
          subtitle="tables extracted"
          icon={Database}
          color="text-[var(--cl-info)]"
        />
        <HeroStat
          label="Bronze Layer"
          value={totals.bronze}
          subtitle={totals.bronzePending > 0 ? `${totals.bronzePending} pending` : "all loaded"}
          icon={Layers}
          color="text-[var(--cl-warning)]"
        />
        <HeroStat
          label="Silver Layer"
          value={totals.silver}
          subtitle={totals.silverPending > 0 ? `${totals.silverPending} pending` : "all loaded"}
          icon={Zap}
          color="text-[var(--cl-success)]"
        />
        <HeroStat
          label="Total Loaded"
          value={totalLoaded}
          subtitle={totalPending > 0 ? `${totalPending} still pending` : "across all layers"}
          icon={TrendingUp}
          color="text-primary"
        />
      </div>

      {/* Source Pipeline Cards */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Database className="w-4 h-4" />
          Sources
        </h2>
        {sources.map((source) => (
          <SourceCard
            key={source.key}
            source={source}
            isExpanded={expandedSources.has(source.key)}
            onToggle={() => toggleSource(source.key)}
            onDrillDown={(layer, status) =>
              setDrillDown({ source: source.key, sourceName: source.name, layer, status })
            }
          />
        ))}
      </div>

      {/* Recent Pipeline Runs */}
      {data.pipelines.length > 0 && (
        <div className="rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-card)] p-5">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Latest Pipeline Runs
          </h2>
          <div className="space-y-2">
            {data.pipelines.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 px-3 rounded-[var(--radius-md)] bg-muted/30"
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    p.status === "Completed" ? "bg-[var(--cl-success)]" :
                    p.status === "InProgress" ? "bg-[var(--cl-warning)] animate-pulse" :
                    p.status === "Failed" ? "bg-[var(--cl-error)]" : "bg-muted-foreground/30"
                  )} />
                  <span className="text-sm text-foreground">{p.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className={PIPELINE_STATUS_COLOR[p.status] || "text-muted-foreground"}>
                    {p.status}
                  </span>
                  {p.startTime && p.endTime && (
                    <span>{duration(p.startTime, p.endTime)}</span>
                  )}
                  {p.startTime && !p.endTime && (
                    <span className="text-[var(--cl-warning)]">{timeSince(p.startTime)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Table (compact reference) */}
      <div className="rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-card)] p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Quick Reference
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs uppercase tracking-wider">
                <th className="text-left py-2 px-3">Source</th>
                <th className="text-right py-2 px-3">Landing Zone</th>
                <th className="text-right py-2 px-3">Bronze</th>
                <th className="text-right py-2 px-3">Silver</th>
                <th className="text-right py-2 px-3">Pending</th>
                <th className="text-right py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const allDone = s.lz.status === "complete" && s.bronze.status === "complete" && s.silver.status === "complete";
                const pending = (s.bronze.pending || 0) + (s.silver.pending || 0);
                const openDrill = (layer?: string, status?: string) =>
                  setDrillDown({ source: s.key, sourceName: s.name, layer, status });
                return (
                  <tr key={s.key} className="border-t border-border/50 hover:bg-accent/30">
                    <td className="py-2.5 px-3">
                      <button onClick={() => openDrill()} className="text-foreground font-medium hover:underline cursor-pointer">{s.key}</button>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <button onClick={() => openDrill("lz")} className="text-[var(--cl-info)] hover:underline cursor-pointer">{s.lz.loaded}</button>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <button onClick={() => openDrill("bronze")} className="text-[var(--cl-warning)] hover:underline cursor-pointer">{s.bronze.loaded}</button>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <button onClick={() => openDrill("silver")} className="text-[var(--cl-success)] hover:underline cursor-pointer">{s.silver.loaded}</button>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {pending > 0 ? (
                        <button onClick={() => openDrill(undefined, "pending")} className="text-[var(--cl-warning)] hover:underline cursor-pointer">{pending}</button>
                      ) : (
                        <span className="text-muted-foreground/40">0</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {allDone ? (
                        <span className="text-[var(--cl-success)] text-xs font-medium">Complete</span>
                      ) : pending > 0 ? (
                        <button onClick={() => openDrill(undefined, "pending")} className="text-[var(--cl-warning)] text-xs font-medium hover:underline cursor-pointer">In Progress</button>
                      ) : (
                        <button onClick={() => openDrill(undefined, "partial")} className="text-[var(--cl-info)] text-xs font-medium hover:underline cursor-pointer">Partial</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2.5 px-3 text-foreground">TOTAL</td>
                <td className="py-2.5 px-3 text-right font-mono text-[var(--cl-info)]">{totals.lz}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[var(--cl-warning)]">{totals.bronze}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[var(--cl-success)]">{totals.silver}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[var(--cl-warning)]">
                  {totalPending > 0 ? totalPending : <span className="text-muted-foreground/40">0</span>}
                </td>
                <td className="py-2.5 px-3 text-right">
                  {totalPending === 0 ? (
                    <span className="text-[var(--cl-success)] text-xs font-medium">All Complete</span>
                  ) : (
                    <span className="text-[var(--cl-warning)] text-xs font-medium">{totalPending} pending</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Entity Drill-Down Panel */}
      {drillDown && (
        <EntityDrillDown
          config={drillDown}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}
