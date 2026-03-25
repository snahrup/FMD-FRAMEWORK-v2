import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ClipboardCheck, Loader2, RefreshCw, AlertTriangle,
  ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown,
  Database, Clock, CheckCircle2, TrendingUp, Layers, Search,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";

// ============================================================================
// TYPES
// ============================================================================

interface ScdEntity {
  entityId: number;
  entityName: string;
  source: string;
  rowsRead: number;
  rowsWritten: number;
  delta: number;
  status: string;
  loadType: string;
  durationSeconds: number;
  lastRun: string;
}

interface ScdRun {
  runId: string;
  rowsRead: number;
  rowsWritten: number;
  delta: number;
  loadType: string;
  status: string;
  durationSeconds: number;
  timestamp: string;
}

interface ScdKpis {
  totalEntities: number;
  lastRunTimestamp: string | null;
  totalRowsWritten: number;
  successRate: number;
}

interface ScdSummaryResponse {
  items: ScdEntity[];
  total: number;
  limit: number;
  offset: number;
  sources: string[];
  kpis: ScdKpis;
}

interface ScdEntityHistoryResponse {
  entityId: number;
  entityName: string;
  source: string;
  runs: ScdRun[];
}

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

function statusRailColor(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "success" || s === "succeeded" || s === "complete") return "var(--bp-operational)";
  if (s === "failed" || s === "error") return "var(--bp-fault)";
  return "var(--bp-caution)";
}

type SortField = "entityName" | "source" | "rowsRead" | "rowsWritten" | "delta" | "loadType" | "status" | "durationSeconds" | "lastRun";
type SortDir = "asc" | "desc";

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** SVG ring gauge for success rate */
function SuccessRing({ value, size = 64 }: { value: number; size?: number }) {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 90 ? "var(--bp-operational)" : value >= 70 ? "var(--bp-caution)" : "var(--bp-fault)";

  return (
    <svg width={size} height={size} className="block">
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--bp-border)"
        strokeWidth={strokeWidth}
      />
      {/* Fill */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 800ms cubic-bezier(0.4, 0, 0.2, 1)" }}
      />
      {/* Center text */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontSize: size >= 64 ? 16 : 12,
          fontWeight: 700,
          fontFamily: "var(--bp-font-body)",
          fill: color,
          fontFeatureSettings: "'tnum' 1",
        }}
      >
        {value}%
      </text>
    </svg>
  );
}

/** Delta bar — tiny inline horizontal bar proportional to magnitude */
function DeltaBar({ delta, maxDelta }: { delta: number; maxDelta: number }) {
  const magnitude = Math.abs(delta);
  const widthPct = maxDelta > 0 ? Math.max(2, (magnitude / maxDelta) * 100) : 0;
  const color = delta > 0 ? "var(--bp-operational)" : delta < 0 ? "var(--bp-fault)" : "var(--bp-caution)";

  return (
    <div className="flex items-center gap-2 justify-end">
      <span
        className="tabular-nums font-semibold text-sm"
        style={{
          color,
          fontFeatureSettings: "'tnum' 1",
        }}
      >
        {delta > 0 ? "+" : ""}{fmt(delta)}
      </span>
      <div
        className="h-[6px] rounded-full flex-shrink-0"
        style={{
          width: 60,
          background: "var(--bp-border-subtle)",
        }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${widthPct}%`,
            maxWidth: 60,
            background: color,
            transition: "width 400ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      </div>
    </div>
  );
}

/** KPI strip — audit ledger style */
function KpiStrip({ kpis }: { kpis: ScdKpis }) {
  const tiles = [
    {
      key: "entities",
      rail: "var(--bp-silver)",
      label: "Silver Entities",
      content: (
        <div
          className="font-semibold tabular-nums"
          style={{
            fontFamily: "var(--bp-font-display)",
            fontSize: 36,
            lineHeight: 1.1,
            color: "var(--bp-ink-primary)",
          }}
        >
          {fmt(kpis.totalEntities)}
        </div>
      ),
      sub: "Entities with Silver layer runs",
    },
    {
      key: "success",
      rail: "var(--bp-operational)",
      label: "Success Rate",
      content: (
        <div className="flex items-center gap-3">
          <SuccessRing value={kpis.successRate} size={56} />
        </div>
      ),
      sub: `${kpis.totalEntities} entities in latest runs`,
    },
    {
      key: "lastrun",
      rail: "var(--bp-copper)",
      label: "Last Run",
      content: (
        <div
          className="font-semibold"
          style={{
            fontFamily: "var(--bp-font-display)",
            fontSize: 24,
            lineHeight: 1.2,
            color: "var(--bp-ink-primary)",
          }}
        >
          {timeAgo(kpis.lastRunTimestamp)}
        </div>
      ),
      sub: kpis.lastRunTimestamp ? new Date(kpis.lastRunTimestamp).toLocaleString() : undefined,
    },
    {
      key: "rows",
      rail: "var(--bp-ink-muted)",
      label: "Total Rows Written",
      content: (
        <div className="flex items-baseline gap-1.5">
          <span
            className="font-semibold tabular-nums"
            style={{
              fontFamily: "var(--bp-font-display)",
              fontSize: 28,
              lineHeight: 1.1,
              color: "var(--bp-ink-primary)",
              fontFeatureSettings: "'tnum' 1",
            }}
          >
            {fmt(kpis.totalRowsWritten)}
          </span>
          <span className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>rows</span>
        </div>
      ),
      sub: "Sum of latest run per entity",
    },
  ];

  return (
    <div className="flex flex-wrap gap-4" role="region" aria-label="Key metrics">
      {tiles.map((tile, idx) => (
        <div
          key={tile.key}
          className="rounded-lg flex-1 min-w-[200px] overflow-hidden"
          style={{
            background: "var(--bp-surface-1)",
            border: "1px solid var(--bp-border)",
            animation: `fadeIn 400ms ease both`,
            animationDelay: `${idx * 80}ms`,
          }}
          role="group"
          aria-label={tile.label}
        >
          <div className="flex h-full">
            {/* Status rail */}
            <div
              className="w-[3px] flex-shrink-0"
              style={{ background: tile.rail }}
            />
            <div className="px-5 py-4 flex-1">
              <div
                className="text-[11px] font-medium uppercase tracking-wider mb-2"
                style={{ color: "var(--bp-ink-muted)" }}
              >
                {tile.label}
              </div>
              {tile.content}
              {tile.sub && (
                <div className="text-[11px] mt-1.5" style={{ color: "var(--bp-ink-muted)" }}>
                  {tile.sub}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Expandable run history for a single entity — timeline feel */
function EntityRunHistory({ entityId }: { entityId: number }) {
  const [runs, setRuns] = useState<ScdRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/scd/entity/${entityId}?limit=10`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: ScdEntityHistoryResponse) => {
        if (!cancelled) setRuns(data.runs);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [entityId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 px-8" style={{ color: "var(--bp-ink-muted)" }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading run history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-6 px-8" style={{ color: "var(--bp-fault)" }}>
        <AlertTriangle className="w-4 h-4" />
        <span className="text-sm">Failed to load history: {error}</span>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="py-6 px-8 text-sm" style={{ color: "var(--bp-ink-muted)" }}>
        No run history found.
      </div>
    );
  }

  // Trend indicator: compare latest two runs' rowsWritten
  const trend = runs.length >= 2
    ? runs[0].rowsWritten - runs[1].rowsWritten
    : 0;

  return (
    <div
      className="px-6 pb-5 pt-3"
      style={{ background: "var(--bp-surface-inset)" }}
    >
      {/* Trend pill */}
      {trend !== 0 && (
        <div className="mb-3">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full"
            style={{
              background: trend > 0 ? "var(--bp-operational-light)" : "var(--bp-fault-light)",
              color: trend > 0 ? "var(--bp-operational)" : "var(--bp-fault)",
              border: `1px solid ${trend > 0 ? "rgba(61,124,79,0.15)" : "rgba(185,58,42,0.15)"}`,
            }}
          >
            <TrendingUp className={cn("w-3 h-3", trend < 0 && "rotate-180")} />
            Row count {trend > 0 ? "growing" : "shrinking"} ({trend > 0 ? "+" : ""}{fmt(trend)} vs previous)
          </span>
        </div>
      )}

      {/* Timeline run list */}
      <div className="relative">
        {/* Vertical connector line */}
        <div
          className="absolute left-[15px] top-[12px] bottom-[12px] w-px"
          style={{ background: "var(--bp-border-strong)" }}
        />

        {runs.map((run, idx) => {
          const isSuccess = (run.status || "").toLowerCase() === "success" || (run.status || "").toLowerCase() === "succeeded";
          const dotColor = isSuccess ? "var(--bp-operational)" : "var(--bp-fault)";
          const railColor = isSuccess ? "var(--bp-operational)" : "var(--bp-fault)";

          return (
            <div
              key={`${run.runId}-${idx}`}
              className="relative flex items-start gap-4 mb-2 last:mb-0"
              style={{
                animation: `fadeIn 300ms ease both`,
                animationDelay: `${idx * 40}ms`,
              }}
            >
              {/* Timeline dot */}
              <div className="relative z-10 flex-shrink-0 mt-3">
                <div
                  className="w-[9px] h-[9px] rounded-full"
                  style={{
                    background: dotColor,
                    border: "2px solid var(--bp-surface-inset)",
                    marginLeft: 11,
                  }}
                />
              </div>

              {/* Run card */}
              <div
                className="flex-1 rounded-md overflow-hidden"
                style={{
                  background: "var(--bp-surface-1)",
                  border: "1px solid var(--bp-border)",
                }}
              >
                <div className="flex">
                  {/* Status rail */}
                  <div
                    className="w-[3px] flex-shrink-0"
                    style={{ background: railColor }}
                  />
                  <div className="flex-1 px-4 py-2.5">
                    <div className="flex items-center flex-wrap gap-x-6 gap-y-1">
                      {/* Run ID */}
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{
                          fontFamily: "var(--bp-font-mono)",
                          background: "var(--bp-copper-light)",
                          color: "var(--bp-ink-secondary)",
                          border: "1px solid rgba(180,86,36,0.1)",
                        }}
                      >
                        {run.runId ? run.runId.slice(0, 8) + "\u2026" : "\u2014"}
                      </span>

                      {/* Timestamp */}
                      <span className="text-xs" style={{ color: "var(--bp-ink-secondary)" }}>
                        {run.timestamp ? new Date(run.timestamp).toLocaleString() : "\u2014"}
                      </span>

                      {/* Status */}
                      <StatusBadge status={run.status} size="sm" />

                      {/* Type */}
                      <Badge variant="secondary">{run.loadType || "\u2014"}</Badge>

                      {/* Spacer */}
                      <div className="flex-1" />

                      {/* Metrics cluster */}
                      <div className="flex items-center gap-4 text-xs tabular-nums" style={{ fontFeatureSettings: "'tnum' 1" }}>
                        <span style={{ color: "var(--bp-ink-secondary)" }}>
                          <span style={{ color: "var(--bp-ink-muted)" }}>R</span> {fmt(run.rowsRead)}
                        </span>
                        <span style={{ color: "var(--bp-ink-secondary)" }}>
                          <span style={{ color: "var(--bp-ink-muted)" }}>W</span> {fmt(run.rowsWritten)}
                        </span>
                        <span
                          className="font-medium"
                          style={{
                            color: run.delta > 0
                              ? "var(--bp-operational)"
                              : run.delta < 0
                                ? "var(--bp-fault)"
                                : "var(--bp-caution)",
                          }}
                        >
                          {run.delta > 0 ? "+" : ""}{fmt(run.delta)}
                        </span>
                        <span style={{ color: "var(--bp-ink-muted)" }}>
                          {humanDuration(run.durationSeconds)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ScdAudit() {
  // -- Data state --
  const [data, setData] = useState<ScdSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -- UI state --
  const [sourceFilter, setSourceFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [sortField, setSortField] = useState<SortField>("lastRun");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // -- Fetch --
  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    params.set("limit", "500"); // fetch all for client-side sort/filter
    params.set("offset", "0");

    fetch(`/api/scd/summary?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ScdSummaryResponse) => {
        setData(d);
        setPage(0);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sourceFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // -- Sort + search (client-side) --
  const sortedItems = useMemo(() => {
    if (!data?.items) return [];
    let items = [...data.items];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (e) =>
          e.entityName.toLowerCase().includes(q) ||
          e.source.toLowerCase().includes(q)
      );
    }

    // Sort
    items.sort((a, b) => {
      let cmp = 0;
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === "string" && typeof bv === "string") {
        cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      } else if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return items;
  }, [data, searchQuery, sortField, sortDir]);

  // Max delta for proportional bars
  const maxDelta = useMemo(() => {
    if (!sortedItems.length) return 1;
    return Math.max(...sortedItems.map((e) => Math.abs(e.delta)), 1);
  }, [sortedItems]);

  // -- Pagination --
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const pageItems = sortedItems.slice(page * pageSize, (page + 1) * pageSize);

  // -- Column sort handler --
  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "entityName" || field === "source" ? "asc" : "desc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3" style={{ color: "var(--bp-copper)" }} />
      : <ArrowDown className="w-3 h-3" style={{ color: "var(--bp-copper)" }} />;
  }

  // -- KPI values --
  const kpis = data?.kpis;

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div
      className="space-y-6 px-8 py-8 max-w-[1400px] mx-auto"
      style={{ animation: "fadeIn 400ms ease both" }}
    >
      {/* -- Header -- */}
      <div
        className="flex items-start justify-between pb-5"
        style={{ borderBottom: "1px solid var(--bp-border)" }}
      >
        <div>
          <div className="flex items-center gap-2.5">
            <ClipboardCheck className="w-5 h-5" style={{ color: "var(--bp-silver)" }} />
            <h1
              style={{ fontFamily: "var(--bp-font-display)", fontSize: 32, color: "var(--bp-ink-primary)" }}
              className="font-semibold tracking-tight"
            >
              SCD Audit View
            </h1>
            <span
              className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
              style={{
                background: "var(--bp-copper-light)",
                color: "var(--bp-copper)",
                border: "1px solid rgba(180,86,36,0.15)",
              }}
            >
              Labs
            </span>
          </div>
          <p className="text-sm mt-1.5" style={{ color: "var(--bp-ink-secondary)" }}>
            Track SCD Type 2 merge results across Silver layer tables — inserts, updates, and version churn per entity
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          style={{
            background: "var(--bp-surface-1)",
            color: "var(--bp-ink-secondary)",
            border: "1px solid var(--bp-border)",
          }}
          aria-label="Refresh data"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* -- KPI Strip -- */}
      {kpis && !error && <KpiStrip kpis={kpis} />}

      {/* -- Filter Toolbar -- */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
        style={{
          background: "var(--bp-surface-1)",
          border: "1px solid var(--bp-border)",
        }}
      >
        <div className="relative flex-1 max-w-xs">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 transition-colors"
            style={{
              color: searchFocused ? "var(--bp-copper)" : "var(--bp-ink-muted)",
            }}
          />
          <input
            type="text"
            placeholder="Search entities..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full h-8 pl-8 pr-3 rounded-md text-sm outline-none"
            style={{
              background: "var(--bp-canvas)",
              border: searchFocused ? "1px solid var(--bp-copper)" : "1px solid var(--bp-border)",
              color: "var(--bp-ink-primary)",
              transition: "border-color 150ms ease",
            }}
            aria-label="Search entities"
          />
        </div>
        <Select
          value={sourceFilter}
          onValueChange={(v) => { setSourceFilter(v); setPage(0); }}
          aria-label="Filter by source"
        >
          <option value="all">All Sources</option>
          {(data?.sources || []).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <div className="flex-1" />
        <span className="text-xs tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
          Showing {sortedItems.length} of {data?.items.length ?? 0} entities
        </span>
      </div>

      {/* -- Loading state -- */}
      {loading && !data && (
        <div
          className="flex flex-col items-center justify-center py-24 gap-3"
          role="status"
          aria-label="Loading"
        >
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--bp-silver)" }} />
          <span className="text-sm" style={{ color: "var(--bp-ink-muted)" }}>
            Loading Silver layer audit data...
          </span>
        </div>
      )}

      {/* -- Error state -- */}
      {error && (
        <div
          className="flex flex-col items-center justify-center py-16 gap-3 rounded-lg"
          style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}
          role="alert"
        >
          <AlertTriangle className="w-8 h-8" style={{ color: "var(--bp-fault)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--bp-fault)" }}>
            Failed to load SCD audit data
          </span>
          <span className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>{error}</span>
          <button
            onClick={fetchData}
            className="mt-2 px-4 py-1.5 rounded-md text-sm font-medium"
            style={{
              background: "var(--bp-copper)",
              color: "#fff",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* -- Empty state -- */}
      {!loading && !error && data && data.items.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-24 gap-3 rounded-lg"
          style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}
        >
          <Inbox className="w-10 h-10" style={{ color: "var(--bp-ink-muted)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--bp-ink-secondary)" }}>
            No Silver layer runs found
          </span>
          <span className="text-xs max-w-md text-center" style={{ color: "var(--bp-ink-muted)" }}>
            The Bronze to Silver pipeline hasn't run yet, or no Silver task log entries exist.
            Run a Silver layer load to see SCD2 merge statistics here.
          </span>
        </div>
      )}

      {/* -- Entity Table -- */}
      {!loading && !error && pageItems.length > 0 && (
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: "1px solid var(--bp-border)" }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table" aria-label="SCD audit entities">
              <thead>
                <tr
                  style={{ background: "var(--bp-surface-1)" }}
                  className="text-[11px] uppercase tracking-wider"
                >
                  {/* Expand toggle */}
                  <th className="w-8 px-2 py-3" aria-label="Expand" />
                  {/* Status rail spacer */}
                  <th className="w-[3px] p-0" />
                  {([
                    ["entityName", "Entity Name", "text-left"],
                    ["source", "Source", "text-left"],
                    ["rowsRead", "Rows Read", "text-right"],
                    ["rowsWritten", "Rows Written", "text-right"],
                    ["delta", "Delta", "text-right"],
                    ["loadType", "Type", "text-left"],
                    ["status", "Status", "text-left"],
                    ["durationSeconds", "Duration", "text-right"],
                    ["lastRun", "Last Run", "text-right"],
                  ] as [SortField, string, string][]).map(([field, label, align]) => (
                    <th
                      key={field}
                      className={cn("px-3 py-3 font-medium cursor-pointer select-none whitespace-nowrap", align)}
                      style={{ color: "var(--bp-ink-muted)" }}
                      onClick={() => toggleSort(field)}
                      role="columnheader"
                      aria-sort={sortField === field ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <SortIcon field={field} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              {pageItems.map((entity, rowIdx) => {
                const isExpanded = expandedId === entity.entityId;
                const isEven = rowIdx % 2 === 0;
                const rail = statusRailColor(entity.status);

                return (
                  <tbody key={entity.entityId}>
                    <tr
                      className="cursor-pointer transition-colors"
                      style={{
                        borderTop: "1px solid var(--bp-border)",
                        background: isExpanded
                          ? "var(--bp-surface-1)"
                          : isEven
                            ? "var(--bp-canvas)"
                            : "var(--bp-surface-inset)",
                        animation: `fadeIn 300ms ease both`,
                        animationDelay: `${rowIdx * 20}ms`,
                      }}
                      onClick={() => setExpandedId(isExpanded ? null : entity.entityId)}
                      role="row"
                      aria-expanded={isExpanded}
                    >
                      <td className="w-8 px-2 py-2.5 text-center">
                        {isExpanded
                          ? <ChevronDown className="w-4 h-4 inline" style={{ color: "var(--bp-copper)" }} />
                          : <ChevronRight className="w-4 h-4 inline" style={{ color: "var(--bp-ink-muted)" }} />}
                      </td>
                      {/* Status rail */}
                      <td className="w-[3px] p-0">
                        <div className="w-[3px] h-full min-h-[40px]" style={{ background: rail }} />
                      </td>
                      <td className="px-3 py-2.5 font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                        {entity.entityName}
                      </td>
                      <td className="px-3 py-2.5" style={{ color: "var(--bp-ink-secondary)" }}>
                        {entity.source}
                      </td>
                      <td
                        className="px-3 py-2.5 text-right tabular-nums"
                        style={{ color: "var(--bp-ink-primary)", fontFeatureSettings: "'tnum' 1" }}
                      >
                        {fmt(entity.rowsRead)}
                      </td>
                      <td
                        className="px-3 py-2.5 text-right tabular-nums"
                        style={{ color: "var(--bp-ink-primary)", fontFeatureSettings: "'tnum' 1" }}
                      >
                        {fmt(entity.rowsWritten)}
                      </td>
                      <td className="px-3 py-2.5">
                        <DeltaBar delta={entity.delta} maxDelta={maxDelta} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant="secondary">{entity.loadType || "\u2014"}</Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={entity.status} size="sm" />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
                        {humanDuration(entity.durationSeconds)}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap" style={{ color: "var(--bp-ink-muted)" }}>
                        {timeAgo(entity.lastRun)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={11} className="p-0">
                          <EntityRunHistory entityId={entity.entityId} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>

          {/* -- Pagination -- */}
          {totalPages > 1 && (
            <div
              className="flex items-center justify-between px-4 py-3 text-sm"
              style={{ borderTop: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}
            >
              <span className="tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
                Page {page + 1} of {totalPages} ({sortedItems.length} entities)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 rounded text-sm disabled:opacity-40 transition-colors"
                  style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 rounded text-sm disabled:opacity-40 transition-colors"
                  style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
