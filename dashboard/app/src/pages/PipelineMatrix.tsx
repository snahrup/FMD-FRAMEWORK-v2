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

const API = import.meta.env.VITE_API_URL || "";

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
  serverTime: string;
}

// ── Source icon mapping by namespace key ──

const SOURCE_ICON_MAP: Record<string, string> = {
  MES: "factory",
  ETQ: "shield-check",
  M3C: "cloud",
  OPTIVA: "flask-conical",
  M3: "database",
};

// ── Build MatrixData from entity-digest + control-plane responses ──

function buildMatrixData(digest: Record<string, unknown>, controlPlane: Record<string, unknown> | null): MatrixData {
  // entity-digest returns sources as either a dict (Fabric SQL path) or a list (SQLite path)
  const rawSources = (digest as Record<string, unknown>).sources;
  const sourceEntries: Array<{ key: string; entities: Array<Record<string, unknown>>; summary: Record<string, number>; name?: string }> = [];

  if (Array.isArray(rawSources)) {
    // SQLite path: sources is an array of {name, displayName, entities, statusCounts}
    for (const s of rawSources) {
      sourceEntries.push({
        key: (s as Record<string, unknown>).name as string || "Unknown",
        entities: ((s as Record<string, unknown>).entities as Array<Record<string, unknown>>) || [],
        summary: ((s as Record<string, unknown>).statusCounts as Record<string, number>) || {},
        name: ((s as Record<string, unknown>).displayName as string) || ((s as Record<string, unknown>).name as string),
      });
    }
  } else if (rawSources && typeof rawSources === "object") {
    // Fabric SQL path: sources is Record<string, DigestSource>
    for (const [key, val] of Object.entries(rawSources as Record<string, Record<string, unknown>>)) {
      sourceEntries.push({
        key,
        entities: (val.entities as Array<Record<string, unknown>>) || [],
        summary: (val.summary as Record<string, number>) || {},
        name: (val.name as string) || key,
      });
    }
  }

  const sources: Record<string, SourceData> = {};
  let totalLz = 0, totalBronze = 0, totalSilver = 0;
  let totalBronzePending = 0, totalSilverPending = 0;

  for (const src of sourceEntries) {
    const entities = src.entities;
    let lzLoaded = 0, bronzeLoaded = 0, silverLoaded = 0;
    let lzPending = 0, bronzePending = 0, silverPending = 0;
    const registered = entities.length;

    for (const e of entities) {
      const lzS = e.lzStatus as string || "not_started";
      const brS = e.bronzeStatus as string || "not_started";
      const slS = e.silverStatus as string || "not_started";

      if (["loaded", "complete", "Succeeded"].includes(lzS)) lzLoaded++;
      else if (["pending", "InProgress", "running"].includes(lzS)) lzPending++;

      if (["loaded", "complete", "Succeeded"].includes(brS)) bronzeLoaded++;
      else if (["pending", "InProgress", "running"].includes(brS)) bronzePending++;

      if (["loaded", "complete", "Succeeded"].includes(slS)) silverLoaded++;
      else if (["pending", "InProgress", "running"].includes(slS)) silverPending++;
    }

    const layerStatus = (loaded: number, pending: number, total: number): LayerData["status"] => {
      if (total === 0) return "not_started";
      if (loaded >= total) return "complete";
      if (pending > 0) return "in_progress";
      if (loaded > 0) return "partial";
      return "not_started";
    };

    sources[src.key] = {
      key: src.key,
      name: src.name || src.key,
      icon: SOURCE_ICON_MAP[src.key] || "database",
      lz: { loaded: lzLoaded, registered, pending: lzPending, status: layerStatus(lzLoaded, lzPending, registered) },
      bronze: { loaded: bronzeLoaded, registered, pending: bronzePending, status: layerStatus(bronzeLoaded, bronzePending, registered) },
      silver: { loaded: silverLoaded, registered, pending: silverPending, status: layerStatus(silverLoaded, silverPending, registered) },
    };

    totalLz += lzLoaded;
    totalBronze += bronzeLoaded;
    totalSilver += silverLoaded;
    totalBronzePending += bronzePending;
    totalSilverPending += silverPending;
  }

  // Extract pipeline runs from control-plane response
  const pipelines: PipelineRun[] = [];
  if (controlPlane) {
    const recentRuns = (controlPlane.recentRuns as Array<Record<string, string>>) || [];
    for (const run of recentRuns) {
      pipelines.push({
        name: run.PipelineName || "",
        itemName: run.PipelineName || "",
        status: run.Status || "Unknown",
        startTime: run.StartTime || "",
        endTime: run.EndTime || "",
        runId: run.RunGuid || "",
      });
    }
  }

  return {
    sources,
    totals: {
      lz: totalLz,
      bronze: totalBronze,
      silver: totalSilver,
      bronzePending: totalBronzePending,
      silverPending: totalSilverPending,
    },
    pipelines,
    serverTime: (digest as Record<string, string>).generatedAt || new Date().toISOString(),
  };
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
  complete: { bg: "bg-[#E7F3EB]", ring: "stroke-[#3D7C4F]", text: "text-[#3D7C4F]", glow: "" },
  in_progress: { bg: "bg-[#FDF3E3]", ring: "stroke-[#C27A1A]", text: "text-[#C27A1A]", glow: "" },
  partial: { bg: "bg-[#F4E8DF]", ring: "stroke-[#B45624]", text: "text-[#B45624]", glow: "" },
  not_started: { bg: "bg-[#EDEAE4]", ring: "stroke-[#A8A29E]", text: "text-[#A8A29E]", glow: "" },
};

const PIPELINE_STATUS_COLOR: Record<string, string> = {
  Completed: "text-[#3D7C4F]",
  InProgress: "text-[#C27A1A]",
  Failed: "text-[#B93A2A]",
  NotStarted: "text-[#78716C]",
  Cancelled: "text-[#78716C]",
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
          stroke="rgba(0,0,0,0.08)"
          strokeWidth={strokeWidth}
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

  return (
    <div className="flex-1 flex items-center mx-1 relative h-8">
      {/* Base line */}
      <div className={cn(
        "absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full",
        isActive ? "bg-[rgba(0,0,0,0.08)]" : "bg-[rgba(0,0,0,0.04)]"
      )} />
      {/* Active glow line */}
      {isActive && (
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full"
          style={{
            backgroundColor: status === "complete"
              ? "var(--bp-operational)"
              : "var(--bp-caution)",
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
              backgroundColor: "var(--bp-caution)",
              opacity: 0.8,
              animation: "flowParticle 2s linear infinite",
            }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
            style={{
              backgroundColor: "var(--bp-caution)",
              opacity: 0.6,
              animation: "flowParticle 2s linear infinite 0.7s",
            }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: "var(--bp-caution)",
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
            background: `linear-gradient(to right, transparent, var(--bp-operational), transparent)`,
            opacity: 0.5,
            animation: "flowParticle 3s linear infinite",
          }}
        />
      )}
      {/* Arrow head */}
      <ArrowRight className={cn(
        "absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3",
        isActive ? (status === "complete" ? "text-[#3D7C4F]" : "text-[#C27A1A]") : "text-[#A8A29E]"
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
      <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>{label}</span>
      {showPending && layer.pending && layer.pending > 0 ? (
        <span className="text-[10px] flex items-center gap-0.5" style={{ color: "var(--bp-caution)" }}>
          <Clock className="w-2.5 h-2.5" />
          {layer.pending} pending
        </span>
      ) : layer.status === "complete" ? (
        <span className="text-[10px] opacity-70 flex items-center gap-0.5" style={{ color: "var(--bp-operational)" }}>
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

  const borderColor = allComplete
    ? "rgba(61,124,79,0.3)"
    : anyInProgress
    ? "rgba(194,122,26,0.3)"
    : "rgba(0,0,0,0.08)";

  return (
    <div
      className="rounded-lg border transition-all duration-300"
      style={{ backgroundColor: "var(--bp-surface-1)", borderColor }}
    >
      {/* Card Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left rounded-t-lg transition-colors cursor-pointer hover:bg-[#F9F7F3]"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-md flex items-center justify-center"
            style={{
              backgroundColor: allComplete ? "var(--bp-operational-light)" :
                anyInProgress ? "var(--bp-caution-light)" : "var(--bp-surface-inset)",
              color: allComplete ? "var(--bp-operational)" :
                anyInProgress ? "var(--bp-caution)" : "var(--bp-ink-tertiary)",
            }}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>{source.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>{source.key}</span>
              {allComplete ? (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: "var(--bp-operational-light)", color: "var(--bp-operational)" }}
                >
                  All Layers Complete
                </span>
              ) : totalPending > 0 ? (
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                    anyInProgress && "animate-pulse"
                  )}
                  style={{
                    backgroundColor: anyInProgress ? "var(--bp-caution-light)" : "var(--bp-copper-light, #F4E8DF)",
                    color: anyInProgress ? "var(--bp-caution)" : "var(--bp-copper)",
                  }}
                >
                  {totalPending} pending
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Mini completion bar */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bp-surface-inset)" }}>
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${overallPct}%`,
                  backgroundColor: allComplete
                    ? "var(--bp-operational)"
                    : anyInProgress
                    ? "var(--bp-caution)"
                    : "var(--bp-copper)",
                }}
              />
            </div>
            <span className="text-xs tabular-nums w-8" style={{ color: "var(--bp-ink-tertiary)" }}>{overallPct}%</span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" style={{ color: "var(--bp-ink-tertiary)" }} />
          ) : (
            <ChevronDown className="w-4 h-4" style={{ color: "var(--bp-ink-tertiary)" }} />
          )}
        </div>
      </button>

      {/* Pipeline Flow Visualization */}
      <div className="px-5 pb-5">
        <div className="flex items-center justify-center gap-0">
          {/* Source indicator */}
          <div className="flex flex-col items-center mr-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--bp-surface-inset)" }}>
              <Database className="w-3.5 h-3.5" style={{ color: "var(--bp-ink-tertiary)" }} />
            </div>
            <span className="text-[9px] mt-1" style={{ color: "var(--bp-ink-muted)" }}>Source</span>
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
        <div className="px-5 pb-5 pt-4 space-y-3" style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
          <div className="grid grid-cols-3 gap-3">
            {(["lz", "bronze", "silver"] as const).map((layer) => {
              const data = source[layer];
              const layerLabel = layer === "lz" ? "Landing Zone" : layer === "bronze" ? "Bronze" : "Silver";
              const colors = STATUS_COLORS[data.status];
              return (
                <div key={layer} className={cn("rounded-md p-3 border", colors.bg)} style={{ borderColor: "rgba(0,0,0,0.08)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium" style={{ color: "var(--bp-ink-primary)" }}>{layerLabel}</span>
                    {data.status === "complete" ? (
                      <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--bp-operational)" }} />
                    ) : data.status === "in_progress" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--bp-caution)" }} />
                    ) : data.status === "partial" ? (
                      <AlertTriangle className="w-3.5 h-3.5" style={{ color: "var(--bp-copper)" }} />
                    ) : (
                      <Clock className="w-3.5 h-3.5" style={{ color: "var(--bp-ink-muted)" }} />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span style={{ color: "var(--bp-ink-tertiary)" }}>Loaded</span>
                      <span className={cn("font-mono font-bold", colors.text)}>{data.loaded}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span style={{ color: "var(--bp-ink-tertiary)" }}>Registered</span>
                      <span className="font-mono" style={{ color: "var(--bp-ink-secondary)" }}>{data.registered}</span>
                    </div>
                    {data.loaded < data.registered && (
                      <div className="flex justify-between text-xs">
                        <span style={{ color: "var(--bp-ink-tertiary)" }}>Gap</span>
                        <span className="font-mono" style={{ color: "var(--bp-fault)" }}>{data.registered - data.loaded}</span>
                      </div>
                    )}
                    {"pending" in data && data.pending! > 0 && (
                      <div className="flex justify-between text-xs">
                        <span style={{ color: "var(--bp-ink-tertiary)" }}>Pending</span>
                        <span className="font-mono" style={{ color: "var(--bp-caution)" }}>{data.pending}</span>
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
    <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(0,0,0,0.08)" }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>{label}</p>
          <p className={cn("text-3xl font-bold tabular-nums mt-1", color)}>
            {fmtNum(value)}
          </p>
          {subtitle && <p className="text-xs mt-1" style={{ color: "var(--bp-ink-tertiary)" }}>{subtitle}</p>}
        </div>
        <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ backgroundColor: "var(--bp-surface-inset)" }}>
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
    <div className="rounded-lg px-5 py-3" style={{ border: "1px solid rgba(194,122,26,0.3)", backgroundColor: "var(--bp-caution-light)" }}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--bp-caution)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--bp-caution)" }}>Pipeline Active</span>
        </div>
        <div className="flex-1 flex items-center gap-4 overflow-x-auto">
          {running.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-xs whitespace-nowrap" style={{ color: "var(--bp-ink-tertiary)" }}>
              <span className="font-medium" style={{ color: "var(--bp-ink-primary)" }}>{p.name}</span>
              <span style={{ color: "rgba(0,0,0,0.08)" }}>|</span>
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
      // Fetch entity digest (primary data) and control plane (pipeline runs) in parallel
      const [digestResp, cpResp] = await Promise.all([
        fetch(`${API}/api/entity-digest`),
        fetch(`${API}/api/control-plane`).catch(() => null),
      ]);
      if (!digestResp.ok) throw new Error(`HTTP ${digestResp.status}`);
      const digest = await digestResp.json();
      const controlPlane = cpResp && cpResp.ok ? await cpResp.json() : null;
      setData(buildMatrixData(digest, controlPlane));
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
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--bp-ink-muted)" }} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <AlertTriangle className="w-10 h-10" style={{ color: "var(--bp-fault)" }} />
        <p style={{ color: "var(--bp-ink-tertiary)" }}>{error}</p>
        <button onClick={fetchData} className="text-sm hover:underline" style={{ color: "var(--bp-copper)" }}>
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
          <h1 className="text-2xl font-bold flex items-center gap-3" style={{ color: "var(--bp-ink-primary)" }}>
            <Layers className="w-7 h-7" style={{ color: "var(--bp-copper)" }} />
            Data Pipeline Matrix
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--bp-ink-tertiary)" }}>
            Real-time view of data flowing through the medallion architecture
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>
              Updated {timeSince(lastRefresh.toISOString())}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer",
              loading && "opacity-50 cursor-not-allowed"
            )}
            style={{
              backgroundColor: "var(--bp-surface-inset)",
              color: "var(--bp-ink-secondary)",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
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
          color="text-[#B45624]"
        />
        <HeroStat
          label="Bronze Layer"
          value={totals.bronze}
          subtitle={totals.bronzePending > 0 ? `${totals.bronzePending} pending` : "all loaded"}
          icon={Layers}
          color="text-[#C27A1A]"
        />
        <HeroStat
          label="Silver Layer"
          value={totals.silver}
          subtitle={totals.silverPending > 0 ? `${totals.silverPending} pending` : "all loaded"}
          icon={Zap}
          color="text-[#3D7C4F]"
        />
        <HeroStat
          label="Total Loaded"
          value={totalLoaded}
          subtitle={totalPending > 0 ? `${totalPending} still pending` : "across all layers"}
          icon={TrendingUp}
          color="text-[#1C1917]"
        />
      </div>

      {/* Source Pipeline Cards */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--bp-ink-tertiary)" }}>
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
        <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(0,0,0,0.08)" }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--bp-ink-tertiary)" }}>
            <Clock className="w-4 h-4" />
            Latest Pipeline Runs
          </h2>
          <div className="space-y-2">
            {data.pipelines.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 px-3 rounded-md"
                style={{ backgroundColor: "var(--bp-surface-inset)" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full",
                      p.status === "InProgress" && "animate-pulse"
                    )}
                    style={{
                      backgroundColor:
                        p.status === "Completed" ? "var(--bp-operational)" :
                        p.status === "InProgress" ? "var(--bp-caution)" :
                        p.status === "Failed" ? "var(--bp-fault)" : "var(--bp-ink-muted)",
                    }}
                  />
                  <span className="text-sm" style={{ color: "var(--bp-ink-primary)" }}>{p.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>
                  <span className={PIPELINE_STATUS_COLOR[p.status] || "text-[#78716C]"}>
                    {p.status}
                  </span>
                  {p.startTime && p.endTime && (
                    <span>{duration(p.startTime, p.endTime)}</span>
                  )}
                  {p.startTime && !p.endTime && (
                    <span style={{ color: "var(--bp-caution)" }}>{timeSince(p.startTime)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Table (compact reference) */}
      <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(0,0,0,0.08)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--bp-ink-tertiary)" }}>
          <BarChart3 className="w-4 h-4" />
          Quick Reference
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>
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
                  <tr key={s.key} className="hover:bg-[#F9F7F3]" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                    <td className="py-2.5 px-3">
                      <button onClick={() => openDrill()} className="font-medium hover:underline cursor-pointer" style={{ color: "var(--bp-ink-primary)" }}>{s.key}</button>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <button onClick={() => openDrill("lz")} className="hover:underline cursor-pointer" style={{ color: "var(--bp-copper)" }}>{s.lz.loaded}</button>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <button onClick={() => openDrill("bronze")} className="hover:underline cursor-pointer" style={{ color: "var(--bp-caution)" }}>{s.bronze.loaded}</button>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <button onClick={() => openDrill("silver")} className="hover:underline cursor-pointer" style={{ color: "var(--bp-operational)" }}>{s.silver.loaded}</button>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {pending > 0 ? (
                        <button onClick={() => openDrill(undefined, "pending")} className="hover:underline cursor-pointer" style={{ color: "var(--bp-caution)" }}>{pending}</button>
                      ) : (
                        <span style={{ color: "var(--bp-ink-muted)" }}>0</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {allDone ? (
                        <span className="text-xs font-medium" style={{ color: "var(--bp-operational)" }}>Complete</span>
                      ) : pending > 0 ? (
                        <button onClick={() => openDrill(undefined, "pending")} className="text-xs font-medium hover:underline cursor-pointer" style={{ color: "var(--bp-caution)" }}>In Progress</button>
                      ) : (
                        <button onClick={() => openDrill(undefined, "partial")} className="text-xs font-medium hover:underline cursor-pointer" style={{ color: "var(--bp-copper)" }}>Partial</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="font-semibold" style={{ borderTop: "2px solid rgba(0,0,0,0.08)" }}>
                <td className="py-2.5 px-3" style={{ color: "var(--bp-ink-primary)" }}>TOTAL</td>
                <td className="py-2.5 px-3 text-right font-mono" style={{ color: "var(--bp-copper)" }}>{totals.lz}</td>
                <td className="py-2.5 px-3 text-right font-mono" style={{ color: "var(--bp-caution)" }}>{totals.bronze}</td>
                <td className="py-2.5 px-3 text-right font-mono" style={{ color: "var(--bp-operational)" }}>{totals.silver}</td>
                <td className="py-2.5 px-3 text-right font-mono" style={{ color: "var(--bp-caution)" }}>
                  {totalPending > 0 ? totalPending : <span style={{ color: "var(--bp-ink-muted)" }}>0</span>}
                </td>
                <td className="py-2.5 px-3 text-right">
                  {totalPending === 0 ? (
                    <span className="text-xs font-medium" style={{ color: "var(--bp-operational)" }}>All Complete</span>
                  ) : (
                    <span className="text-xs font-medium" style={{ color: "var(--bp-caution)" }}>{totalPending} pending</span>
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
