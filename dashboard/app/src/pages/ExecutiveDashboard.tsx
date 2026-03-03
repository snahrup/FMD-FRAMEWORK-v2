import { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Database,
  ArrowRight,
  Layers,
  HardDrive,
  TrendingUp,
  Clock,
  Eye,
  EyeOff,
  Zap,
  BarChart3,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ── Types ──

interface LayerInfo {
  total: number;
  loaded?: number;
  pending?: number;
  completion?: number;
}

interface SourceLayerInfo {
  count: number;
  active?: number;
  total?: number;
  loaded?: number;
  completion?: number;
}

interface Source {
  name: string;
  namespace: string;
  entityCount: number;
  layers: {
    landing: SourceLayerInfo;
    bronze: SourceLayerInfo;
    silver: SourceLayerInfo;
  };
  rowCounts?: { bronze: number; silver: number };
}

interface PipelineActivity {
  description: string;
  pipeline: string;
  layer: string;
  status: string;
  duration: string;
  startTime: string | null;
  endTime: string | null;
}

interface Issue {
  pipeline: string;
  layer: string;
  message: string;
  time: string;
}

interface HealthTrend {
  captured_at: string;
  health: string;
  lz_count: number;
  bronze_count: number;
  silver_count: number;
  bronze_rows: number;
  silver_rows: number;
  pipeline_success_rate: number;
}

interface ExecData {
  timestamp: string;
  health: "healthy" | "warning" | "critical" | "setup" | "offline";
  dataSources: number;
  overview: {
    totalEntities: number;
    layers: {
      landing: LayerInfo;
      bronze: LayerInfo;
      silver: LayerInfo;
    };
    rowCounts: { bronze: number; silver: number; landing: number };
  };
  sources: Source[];
  pipelineHealth: {
    totalRuns: number;
    succeeded: number;
    failed: number;
    running: number;
    successRate: number;
  };
  recentActivity: PipelineActivity[];
  issues: Issue[];
  trends: {
    health: HealthTrend[];
    layers: unknown[];
    pipelineRate: { total: number; succeeded: number; failed: number; running: number; successRate: number };
  };
}

// ── Display Name Mappings (business-friendly) ──

const FRIENDLY_SOURCE_NAMES: Record<string, string> = {
  mes: "MES",
  MES: "MES",
  ETQStagingPRD: "ETQ",
  ETQ: "ETQ",
  m3fdbprd: "M3",
  M3: "M3",
  M3C: "M3 Cloud",
  DI_PRD_Staging: "M3 Cloud",
  "M3 Cloud": "M3 Cloud",
};

const FRIENDLY_LAYER_NAMES: Record<string, string> = {
  landing: "Landing Zone",
  bronze: "Bronze (Raw)",
  silver: "Silver (Cleansed)",
};

const FRIENDLY_PIPELINE_NAMES: Record<string, string> = {
  PL_FMD_LOAD_BRONZE: "Bronze Layer Load",
  PL_FMD_LOAD_SILVER: "Silver Layer Load",
  PL_FMD_LOAD_ALL: "Full Orchestration",
};

// ── Helpers ──

const API = "/api";

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function friendlySourceName(raw: string, technical: boolean): string {
  if (technical) return raw;
  return FRIENDLY_SOURCE_NAMES[raw] || raw;
}

function friendlyLayerName(raw: string, technical: boolean): string {
  if (technical) return raw;
  return FRIENDLY_LAYER_NAMES[raw] || raw;
}

// ── Health Badge ──

function HealthBadge({ health }: { health: string }) {
  const config: Record<string, { bg: string; text: string; label: string; dot: string }> = {
    healthy: { bg: "bg-[var(--success-soft)]", text: "text-[var(--cl-success)]", label: "All Systems Operational", dot: "bg-[var(--cl-success)]" },
    warning: { bg: "bg-[var(--warning-soft)]", text: "text-[var(--cl-warning)]", label: "Attention Needed", dot: "bg-[var(--cl-warning)]" },
    critical: { bg: "bg-[var(--error-soft)]", text: "text-[var(--cl-error)]", label: "Issues Detected", dot: "bg-[var(--cl-error)]" },
    setup: { bg: "bg-[var(--info-soft)]", text: "text-[var(--cl-info)]", label: "Initial Setup", dot: "bg-[var(--cl-info)]" },
    offline: { bg: "bg-muted", text: "text-muted-foreground", label: "Offline", dot: "bg-muted-foreground" },
  };
  const c = config[health] || config.offline;
  return (
    <div className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium", c.bg, c.text)}>
      <div className={cn("h-2.5 w-2.5 rounded-full animate-pulse", c.dot)} />
      {c.label}
    </div>
  );
}

// ── Progress Bar ──

function ProgressBar({ value, max, color = "success" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const colors: Record<string, string> = {
    success: "bg-[var(--cl-success)]",
    warning: "bg-[var(--cl-warning)]",
    info: "bg-[var(--cl-info)]",
    accent: "bg-primary",
    error: "bg-[var(--cl-error)]",
  };
  return (
    <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all duration-700 ease-out", colors[color] || colors.success)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Stat Card ──

function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-5 flex items-start gap-4">
      <div className={cn("p-3 rounded-lg", color)}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Data Flow Node ──

function FlowNode({
  label,
  count,
  total,
  rows,
  completion,
  color,
  isLast,
}: {
  label: string;
  count: number;
  total?: number;
  rows?: number;
  completion?: number;
  color: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex items-center gap-0 flex-1">
      <div className={cn(
        "flex-1 rounded-xl border p-4 text-center relative overflow-hidden",
        "bg-card/60 backdrop-blur-sm border-border/50"
      )}>
        {/* Top accent bar */}
        <div className={cn("absolute top-0 left-0 right-0 h-1", color)} />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1">{label}</p>
        <p className="text-3xl font-bold text-foreground mt-1">{fmtNum(count)}</p>
        {total !== undefined && total > 0 && total !== count && (
          <p className="text-[10px] text-muted-foreground">of {fmtNum(total)}</p>
        )}
        {completion !== undefined && (
          <p className="text-xs mt-1">
            <span className={cn(
              "font-semibold",
              completion >= 95 ? "text-[var(--cl-success)]" : completion >= 80 ? "text-[var(--cl-warning)]" : "text-[var(--cl-error)]"
            )}>
              {fmtPct(completion)}
            </span>
            <span className="text-muted-foreground"> loaded</span>
          </p>
        )}
        {rows !== undefined && rows > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1">{fmtNum(rows)} total rows</p>
        )}
      </div>
      {!isLast && (
        <div className="flex items-center px-1 text-muted-foreground/40">
          <ArrowRight className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}

// ── Source Card ──

function SourceCard({ source, technical }: { source: Source; technical: boolean }) {
  const name = friendlySourceName(source.name, technical);
  const layers = source.layers;

  // Entity-level progress: how many distinct tables loaded into each layer
  const lzMax = layers.landing.total ?? layers.landing.count;
  const brzMax = layers.bronze.total ?? layers.bronze.count;
  const lzVal = layers.landing.loaded ?? 0;
  const brzVal = layers.bronze.loaded ?? 0;
  // Silver: count = registered entities, no per-source processing yet
  const slvCount = layers.silver.count;

  return (
    <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-foreground">{name}</h3>
          {technical && source.namespace !== source.name && (
            <p className="text-[10px] text-muted-foreground font-mono">{source.namespace}</p>
          )}
        </div>
        <span className="text-sm font-medium text-muted-foreground">{source.entityCount} entities</span>
      </div>

      <div className="space-y-3">
        {/* Landing Zone */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">{friendlyLayerName("landing", technical)}</span>
            <span className="font-medium">
              <span className="text-foreground">{fmtNum(lzVal)}</span>
              {lzMax > 0 && (
                <span className="text-muted-foreground"> / {fmtNum(lzMax)}</span>
              )}
              {layers.landing.completion !== undefined && layers.landing.completion > 0 && (
                <span className={cn(
                  "ml-1.5 text-[10px]",
                  layers.landing.completion >= 95 ? "text-[var(--cl-success)]" : layers.landing.completion >= 50 ? "text-[var(--cl-warning)]" : "text-[var(--cl-error)]"
                )}>
                  {fmtPct(layers.landing.completion)}
                </span>
              )}
            </span>
          </div>
          <ProgressBar value={lzVal} max={lzMax || 1} color="info" />
        </div>

        {/* Bronze */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">{friendlyLayerName("bronze", technical)}</span>
            <span className="font-medium">
              <span className="text-foreground">{fmtNum(brzVal)}</span>
              {brzMax > 0 && (
                <span className="text-muted-foreground"> / {fmtNum(brzMax)}</span>
              )}
              {layers.bronze.completion !== undefined && layers.bronze.completion > 0 && (
                <span className={cn(
                  "ml-1.5 text-[10px]",
                  layers.bronze.completion >= 95 ? "text-[var(--cl-success)]" : layers.bronze.completion >= 50 ? "text-[var(--cl-warning)]" : "text-[var(--cl-error)]"
                )}>
                  {fmtPct(layers.bronze.completion)}
                </span>
              )}
            </span>
          </div>
          <ProgressBar value={brzVal} max={brzMax || 1} color="warning" />
        </div>

        {/* Silver */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">{friendlyLayerName("silver", technical)}</span>
            <span className="font-medium text-foreground">{slvCount} registered</span>
          </div>
          <ProgressBar value={slvCount} max={layers.landing.count || 1} color="success" />
        </div>
      </div>

      {/* Row counts */}
      {source.rowCounts && (source.rowCounts.bronze > 0 || source.rowCounts.silver > 0) && (
        <div className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Bronze: {fmtNum(source.rowCounts.bronze)} rows</span>
          <span>Silver: {fmtNum(source.rowCounts.silver)} rows</span>
        </div>
      )}
    </div>
  );
}

// ── Activity Item ──

function ActivityItem({ item, technical }: { item: PipelineActivity; technical: boolean }) {
  const statusConfig: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
    Succeeded: { icon: CheckCircle2, color: "text-[var(--cl-success)]" },
    Failed: { icon: XCircle, color: "text-[var(--cl-error)]" },
    InProgress: { icon: Loader2, color: "text-[var(--cl-info)]" },
  };
  const cfg = statusConfig[item.status] || { icon: Info, color: "text-muted-foreground" };
  const Icon = cfg.icon;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/20 last:border-0">
      <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", cfg.color, item.status === "InProgress" && "animate-spin")} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">
          {technical ? item.pipeline : item.description}
        </p>
        <div className="flex items-center gap-3 mt-0.5">
          {item.layer && (
            <span className="text-[10px] text-muted-foreground">
              {friendlyLayerName(item.layer.toLowerCase(), technical)}
            </span>
          )}
          {item.startTime && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo(item.startTime)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──

export default function ExecutiveDashboard() {
  const [data, setData] = useState<ExecData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [technical, setTechnical] = useState(false);
  const lastHash = useRef("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/executive`);
      if (!res.ok) throw new Error(`${res.status}`);
      const d: ExecData = await res.json();
      // Only update state if meaningful data changed (ignore timestamp)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { timestamp, ...rest } = d;
      const hash = JSON.stringify(rest);
      if (hash !== lastHash.current) {
        lastHash.current = hash;
        setData(d);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + poll every 2 minutes (no SSE — executive dashboards don't need real-time)
  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 120_000);
    return () => clearInterval(id);
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <XCircle className="h-12 w-12 text-[var(--cl-error)]" />
        <p className="text-muted-foreground">Could not load dashboard data</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-card border border-border rounded-lg text-sm hover:bg-accent transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { overview, sources, pipelineHealth, recentActivity, issues, trends } = data;
  const layers = overview.layers;

  // Build trend chart data from health trends
  const trendData = (trends.health || []).map((h: HealthTrend) => ({
    time: new Date(h.captured_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    bronze: h.bronze_count,
    silver: h.silver_count,
    landing: h.lz_count,
  }));

  return (
    <div className="space-y-6" style={{ contain: "layout style" }}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Data Pipeline Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data.dataSources} data sources &middot; {fmtNum(overview.totalEntities)} entities &middot; Updated {timeAgo(data.timestamp)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Technical / Business toggle */}
          <button
            onClick={() => setTechnical(!technical)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border",
              technical
                ? "bg-[var(--warning-soft)] border-[var(--cl-warning)]/30 text-[var(--cl-warning)]"
                : "bg-card border-border/50 text-muted-foreground hover:text-foreground"
            )}
            title={technical ? "Showing technical names" : "Showing business names"}
          >
            {technical ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {technical ? "Technical" : "Business"}
          </button>

          <HealthBadge health={data.health} />

          <button
            onClick={fetchData}
            className="p-2 rounded-lg bg-card border border-border/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Refresh now"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── Hero Stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Entities"
          value={fmtNum(overview.totalEntities)}
          subtitle={`${data.dataSources} sources · ${fmtNum(layers.landing.loaded ?? 0)} of ${fmtNum(layers.landing.total)} loaded to LZ`}
          icon={Database}
          color="bg-primary"
        />
        <StatCard
          label={technical ? "Bronze Processing" : "Data Ingested"}
          value={fmtPct(layers.bronze.completion ?? 0)}
          subtitle={`${fmtNum(layers.bronze.loaded ?? 0)} of ${fmtNum(layers.bronze.total)} entities loaded`}
          icon={Layers}
          color="bg-[var(--cl-success)]"
        />
        <StatCard
          label={technical ? "Silver Processing" : "Data Cleansed"}
          value={fmtPct(layers.silver.completion ?? 0)}
          subtitle={`${fmtNum(layers.silver.loaded ?? 0)} of ${fmtNum(layers.silver.total)} entities loaded`}
          icon={HardDrive}
          color="bg-[var(--cl-accent)]"
        />
        <StatCard
          label="Pipeline Success"
          value={pipelineHealth.totalRuns > 0 ? fmtPct(pipelineHealth.successRate) : "N/A"}
          subtitle={pipelineHealth.totalRuns > 0
            ? `${pipelineHealth.succeeded} passed, ${pipelineHealth.failed} failed`
            : "No recent runs"
          }
          icon={Activity}
          color={pipelineHealth.failed > 0 ? "bg-[var(--cl-warning)]" : "bg-[var(--cl-success)]"}
        />
      </div>

      {/* ── Data Flow Pipeline ── */}
      <div className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-[#AE5630]" />
          Data Flow
        </h2>
        <div className="flex items-stretch gap-0">
          <FlowNode
            label={technical ? "Landing Zone" : "Source Files"}
            count={layers.landing.loaded ?? 0}
            total={layers.landing.total}
            rows={overview.rowCounts.landing}
            completion={layers.landing.completion}
            color="bg-[var(--cl-info)]"
          />
          <FlowNode
            label={technical ? "Bronze Layer" : "Raw Data"}
            count={layers.bronze.loaded ?? 0}
            total={layers.bronze.total}
            rows={overview.rowCounts.bronze}
            completion={layers.bronze.completion}
            color="bg-[var(--cl-warning)]"
          />
          <FlowNode
            label={technical ? "Silver Layer" : "Clean Data"}
            count={layers.silver.loaded ?? 0}
            total={layers.silver.total}
            rows={overview.rowCounts.silver}
            completion={layers.silver.completion}
            color="bg-[var(--cl-success)]"
            isLast
          />
        </div>
      </div>

      {/* ── Source Systems + Trends ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sources */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <Database className="h-4 w-4 text-[var(--cl-info)]" />
            Source Systems
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sources
              .filter((src) => src.entityCount > 0)
              .map((src) => (
              <SourceCard key={src.namespace} source={src} technical={technical} />
            ))}
          </div>
        </div>

        {/* Trends */}
        <div>
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[var(--cl-success)]" />
            Trend (24h)
          </h2>
          <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-4">
            {trendData.length > 1 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="colorBronze" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#5FB87A" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#5FB87A" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorSilver" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#AE5630" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#AE5630" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#666" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#666" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--bg-surface, #1F1E1B)",
                      border: "1px solid var(--cl-border, rgba(108,106,96,0.25))",
                      borderRadius: "var(--radius-md, 8px)",
                      fontSize: "12px",
                      color: "var(--text-primary, #EEE)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="bronze"
                    name={technical ? "Bronze" : "Ingested"}
                    stroke="#5FB87A"
                    fillOpacity={1}
                    fill="url(#colorBronze)"
                  />
                  <Area
                    type="monotone"
                    dataKey="silver"
                    name={technical ? "Silver" : "Cleansed"}
                    stroke="#AE5630"
                    fillOpacity={1}
                    fill="url(#colorSilver)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                <BarChart3 className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-xs">Trend data building up...</p>
                <p className="text-[10px] mt-1">Check back in a few minutes</p>
              </div>
            )}

            {/* Pipeline rate summary */}
            <div className="mt-4 pt-3 border-t border-border/30">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Pipeline success rate (24h)</span>
                <span className={cn(
                  "font-semibold",
                  (trends.pipelineRate?.successRate ?? 0) >= 80 ? "text-[var(--cl-success)]" : "text-[var(--cl-warning)]"
                )}>
                  {trends.pipelineRate?.total ? fmtPct(trends.pipelineRate.successRate) : "—"}
                </span>
              </div>
              <div className="mt-2">
                <ProgressBar
                  value={trends.pipelineRate?.succeeded ?? 0}
                  max={trends.pipelineRate?.total ?? 1}
                  color={((trends.pipelineRate?.successRate ?? 0) >= 80) ? "success" : "warning"}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent Activity + Issues ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Timeline */}
        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--cl-info)]" />
            Recent Activity
          </h2>
          {recentActivity.length > 0 ? (
            <div className="max-h-[320px] overflow-y-auto pr-1">
              {recentActivity.map((item, i) => (
                <ActivityItem key={i} item={item} technical={technical} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No recent pipeline activity</p>
          )}
        </div>

        {/* Issues / Attention */}
        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--cl-warning)]" />
            Attention Needed
          </h2>
          {issues.length > 0 ? (
            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
              {issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--error-soft)] border border-[var(--cl-error)]/10">
                  <XCircle className="h-4 w-4 text-[var(--cl-error)] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                      {technical ? issue.pipeline : FRIENDLY_PIPELINE_NAMES[issue.pipeline] || issue.pipeline}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{issue.message}</p>
                    {issue.time && (
                      <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(issue.time)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 text-[var(--cl-success)]/50 mb-2" />
              <p className="text-sm">No issues in the last hour</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 pt-2">
        <span>FMD Pipeline Control &middot; Auto-refreshing every 30s via SSE</span>
        <span>Last snapshot: {data.timestamp ? new Date(data.timestamp).toLocaleString() : "—"}</span>
      </div>
    </div>
  );
}
