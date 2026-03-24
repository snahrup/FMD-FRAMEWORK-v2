import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ShieldCheck,
  RefreshCw,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Database,
  Beaker,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DqScoreRing } from "@/components/dq/DqScoreRing";
import { DqTrendChart } from "@/components/dq/DqTrendChart";
import { AnimatedCounter } from "@/components/dq/AnimatedCounter";

// ============================================================================
// TYPES
// ============================================================================

interface QualityItem {
  entityId: number;
  entityName: string;
  source: string;
  completeness: number;
  freshness: number;
  consistency: number;
  volume: number;
  composite: number;
  tier: "gold" | "silver" | "bronze" | "unclassified";
  computedAt: string;
}

interface QualitySummary {
  total: number;
  tiers: { gold: number; silver: number; bronze: number; unclassified: number };
  averageComposite: number;
  averageCompleteness: number;
  averageFreshness: number;
  averageConsistency: number;
  averageVolume: number;
  lastComputed: string | null;
}

interface QualityResponse {
  items: QualityItem[];
  total: number;
  limit: number;
  offset: number;
  summary: QualitySummary;
}

type TierFilter = "all" | "gold" | "silver" | "bronze" | "unclassified";
type SortField = "entityName" | "source" | "composite" | "completeness" | "freshness" | "consistency" | "volume" | "computedAt";
type SortDir = "asc" | "desc";

// ============================================================================
// CONSTANTS
// ============================================================================

const TIER_COLORS: Record<string, { bg: string; text: string; border: string; bar: string }> = {
  gold:         { bg: "var(--bp-gold, #C6A84E)",       text: "#92752A", border: "rgba(198,168,78,0.3)",  bar: "var(--bp-gold, #C6A84E)" },
  silver:       { bg: "var(--bp-silver, #8B9DAF)",     text: "#5E7085", border: "rgba(139,157,175,0.3)", bar: "var(--bp-silver, #8B9DAF)" },
  bronze:       { bg: "var(--bp-bronze, #B07D4F)",     text: "#8A5E33", border: "rgba(176,125,79,0.3)",  bar: "var(--bp-bronze, #B07D4F)" },
  unclassified: { bg: "var(--bp-ink-muted, #888)",     text: "#666",    border: "rgba(128,128,128,0.2)", bar: "var(--bp-ink-muted, #888)" },
};

const TIER_LABELS: Record<string, string> = {
  all: "All",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
  unclassified: "Unclassified",
};

const PAGE_SIZE = 50;

// ============================================================================
// COMPONENT
// ============================================================================

export default function DqScorecard() {
  // ── State ─────────────────────────────────────────────────────────────────
  const [data, setData] = useState<QualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [sortField, setSortField] = useState<SortField>("composite");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // ── Data Fetching ─────────────────────────────────────────────────────────
  const fetchScores = useCallback(async (tier?: TierFilter, pageNum?: number) => {
    const activeTier = tier ?? tierFilter;
    const activeOffset = (pageNum ?? page) * PAGE_SIZE;
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(activeOffset) });
    if (activeTier !== "all") qs.set("tier", activeTier);

    try {
      const res = await fetch(`/api/quality/scores?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: QualityResponse = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch quality scores");
    } finally {
      setLoading(false);
    }
  }, [tierFilter, page]);

  useEffect(() => {
    setLoading(true);
    fetchScores();
  }, [fetchScores]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/quality/refresh", { method: "POST" });
      if (!res.ok) throw new Error(`Refresh failed: HTTP ${res.status}`);
      // Refetch scores after refresh
      await fetchScores();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const handleTierChange = (tier: TierFilter) => {
    setTierFilter(tier);
    setPage(0);
    setExpandedRow(null);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "entityName" || field === "source" ? "asc" : "desc");
    }
  };

  // ── Sorted items (client-side sort within current page) ───────────────────
  const sortedItems = useMemo(() => {
    if (!data?.items) return [];
    return [...data.items].sort((a, b) => {
      let cmp = 0;
      const fa = a[sortField];
      const fb = b[sortField];
      if (typeof fa === "number" && typeof fb === "number") {
        cmp = fa - fb;
      } else {
        cmp = String(fa).localeCompare(String(fb), undefined, { sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data?.items, sortField, sortDir]);

  const summary = data?.summary;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 px-8 py-8 max-w-[1400px] mx-auto">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" style={{ color: "var(--bp-copper)" }} />
            <h1
              style={{ fontFamily: "var(--bp-font-display)", fontSize: 32, color: "var(--bp-ink-primary)" }}
              className="font-semibold tracking-tight"
            >
              DQ Scorecard
            </h1>
            <span
              className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
              style={{ background: "var(--bp-copper-light)", color: "var(--bp-copper)", border: "1px solid rgba(180,86,36,0.15)" }}
            >
              Labs
            </span>
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--bp-ink-secondary)" }}>
            Entity quality scores across completeness, freshness, consistency, and volume dimensions
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            "border hover:opacity-80 disabled:opacity-50"
          )}
          style={{
            background: "var(--bp-copper)",
            color: "#fff",
            borderColor: "var(--bp-copper)",
          }}
          aria-label="Refresh quality scores"
        >
          {refreshing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {refreshing ? "Refreshing..." : "Refresh Scores"}
        </button>
      </div>

      {/* ═══ LOADING STATE ═══ */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--bp-copper)" }} />
          <p className="text-sm" style={{ color: "var(--bp-ink-muted)" }}>Loading quality scores...</p>
        </div>
      )}

      {/* ═══ ERROR STATE ═══ */}
      {error && !loading && (
        <div
          className="flex items-center gap-3 px-5 py-4 rounded-xl"
          style={{ background: "var(--bp-fault, #B93A2A)10", border: "1px solid var(--bp-fault, #B93A2A)30" }}
          role="alert"
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: "var(--bp-fault)" }} />
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--bp-fault)" }}>Failed to load quality scores</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--bp-ink-muted)" }}>{error}</p>
          </div>
          <button
            onClick={() => { setLoading(true); setError(null); fetchScores(); }}
            className="ml-auto text-xs font-medium px-3 py-1.5 rounded-md"
            style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ═══ EMPTY STATE ═══ */}
      {!loading && !error && data && data.total === 0 && tierFilter === "all" && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: "var(--bp-copper-light)" }}
          >
            <Beaker className="w-8 h-8" style={{ color: "var(--bp-ink-muted)" }} />
          </div>
          <h2
            className="text-lg font-semibold mb-3"
            style={{ fontFamily: "var(--bp-font-body)", color: "var(--bp-ink-primary)" }}
          >
            No Quality Scores Yet
          </h2>
          <p className="max-w-md text-sm mb-4" style={{ color: "var(--bp-ink-secondary)" }}>
            Quality scores haven't been computed. Click <strong>Refresh Scores</strong> above to trigger
            the quality engine, which will analyze completeness, freshness, consistency, and volume
            for all active entities.
          </p>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: "var(--bp-copper)", color: "#fff" }}
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Compute Scores Now
          </button>
        </div>
      )}

      {/* ═══ MAIN CONTENT (when data exists) ═══ */}
      {!loading && !error && data && (summary?.total ?? 0) > 0 && (
        <>
          {/* ── KPI STRIP ── */}
          <div
            className="rounded-xl p-5"
            style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-6">
              {/* Score Rings */}
              <div className="flex items-center gap-8">
                <DqScoreRing
                  score={Math.round(summary?.averageComposite ?? 0)}
                  label="Overall"
                  size={100}
                />
                <DqScoreRing
                  score={Math.round(summary?.averageCompleteness ?? 0)}
                  label="Complete"
                  size={80}
                />
                <DqScoreRing
                  score={Math.round(summary?.averageFreshness ?? 0)}
                  label="Fresh"
                  size={80}
                />
                <DqScoreRing
                  score={Math.round(summary?.averageConsistency ?? 0)}
                  label="Consist."
                  size={80}
                />
              </div>

              {/* Stats */}
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: "var(--bp-ink-primary)" }}>
                    <AnimatedCounter value={summary?.total ?? 0} />
                  </div>
                  <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--bp-ink-muted)" }}>
                    Entities Scored
                  </div>
                </div>

                {/* Tier mini-badges */}
                <div className="flex flex-col gap-1.5">
                  {(["gold", "silver", "bronze", "unclassified"] as const).map((tier) => {
                    const count = summary?.tiers?.[tier] ?? 0;
                    const tc = TIER_COLORS[tier];
                    return (
                      <div key={tier} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ background: tc.bg }} />
                        <span className="text-xs font-medium tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
                          {count}
                        </span>
                        <span className="text-[10px] capitalize" style={{ color: "var(--bp-ink-muted)" }}>
                          {tier}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Last computed timestamp */}
            {summary?.lastComputed && (
              <div className="mt-3 text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>
                Last computed: {new Date(summary.lastComputed).toLocaleString()}
              </div>
            )}
          </div>

          {/* ── TIER DISTRIBUTION BAR ── */}
          <TierDistributionBar tiers={summary?.tiers ?? { gold: 0, silver: 0, bronze: 0, unclassified: 0 }} total={summary?.total ?? 0} />

          {/* ── TIER FILTER TABS ── */}
          <div
            className="flex items-center gap-1 p-1 rounded-lg w-fit"
            style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border-subtle)" }}
            role="tablist"
            aria-label="Filter by quality tier"
          >
            {(["all", "gold", "silver", "bronze", "unclassified"] as const).map((tier) => {
              const active = tierFilter === tier;
              const count = tier === "all" ? (summary?.total ?? 0) : (summary?.tiers?.[tier] ?? 0);
              return (
                <button
                  key={tier}
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleTierChange(tier)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                    active ? "shadow-sm" : "hover:opacity-80"
                  )}
                  style={active
                    ? { background: "var(--bp-copper)", color: "#fff" }
                    : { color: "var(--bp-ink-secondary)" }
                  }
                >
                  {TIER_LABELS[tier]}
                  <span
                    className="text-[10px] tabular-nums"
                    style={{ opacity: active ? 0.85 : 0.6 }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── ENTITY TABLE ── */}
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="grid">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--bp-border)" }}>
                    {([
                      { field: "entityName" as SortField, label: "Entity" },
                      { field: "source" as SortField, label: "Source" },
                      { field: "composite" as SortField, label: "Composite" },
                      { field: "completeness" as SortField, label: "Complete" },
                      { field: "freshness" as SortField, label: "Fresh" },
                      { field: "consistency" as SortField, label: "Consist." },
                      { field: "volume" as SortField, label: "Volume" },
                      { field: "computedAt" as SortField, label: "Computed" },
                    ]).map(({ field, label }) => (
                      <th
                        key={field}
                        className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold cursor-pointer select-none hover:opacity-80 transition-opacity"
                        style={{ color: "var(--bp-ink-muted)" }}
                        onClick={() => handleSort(field)}
                        role="columnheader"
                        aria-sort={sortField === field ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                      >
                        <span className="flex items-center gap-1">
                          {label}
                          {sortField === field ? (
                            sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-sm" style={{ color: "var(--bp-ink-muted)" }}>
                        No entities in this tier
                      </td>
                    </tr>
                  )}
                  {sortedItems.map((item) => {
                    const isExpanded = expandedRow === item.entityId;
                    return (
                      <EntityRow
                        key={item.entityId}
                        item={item}
                        isExpanded={isExpanded}
                        onToggle={() => setExpandedRow(isExpanded ? null : item.entityId)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderTop: "1px solid var(--bp-border)" }}
              >
                <span className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>
                  Showing {data.offset + 1}–{Math.min(data.offset + data.limit, data.total)} of{" "}
                  <span className="font-medium tabular-nums">{data.total}</span> entities
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-30 transition-opacity"
                    style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
                  >
                    Prev
                  </button>
                  <span className="px-2 text-xs tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-30 transition-opacity"
                    style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── 7-DAY TREND ── */}
          <DqTrendChart />
        </>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Horizontal stacked bar showing tier distribution */
function TierDistributionBar({ tiers, total }: { tiers: QualitySummary["tiers"]; total: number }) {
  if (total === 0) return null;

  const segments = (["gold", "silver", "bronze", "unclassified"] as const).map((tier) => ({
    tier,
    count: tiers[tier],
    pct: (tiers[tier] / total) * 100,
    color: TIER_COLORS[tier],
  }));

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--bp-ink-muted)" }}>
          Tier Distribution
        </span>
        <span className="text-xs tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
          {total} entities
        </span>
      </div>

      {/* Stacked bar */}
      <div className="h-5 rounded-full overflow-hidden flex" style={{ background: "var(--bp-border-subtle)" }}>
        {segments.map(
          (seg) =>
            seg.pct > 0 && (
              <div
                key={seg.tier}
                className="h-full transition-all duration-700"
                style={{ width: `${seg.pct}%`, background: seg.color.bg }}
                title={`${seg.tier}: ${seg.count} (${seg.pct.toFixed(1)}%)`}
                role="meter"
                aria-label={`${seg.tier} tier: ${seg.count} entities`}
                aria-valuenow={seg.count}
                aria-valuemin={0}
                aria-valuemax={total}
              />
            ),
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mt-3">
        {segments.map((seg) => (
          <div key={seg.tier} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: seg.color.bg }} />
            <span className="text-[11px] capitalize" style={{ color: "var(--bp-ink-secondary)" }}>
              {seg.tier}
            </span>
            <span className="text-[11px] font-medium tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
              {seg.count} ({seg.pct.toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Single table row with expandable detail panel */
function EntityRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: QualityItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const tc = TIER_COLORS[item.tier] ?? TIER_COLORS.unclassified;

  return (
    <>
      <tr
        className="cursor-pointer transition-colors hover:brightness-95"
        style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}
        onClick={onToggle}
        role="row"
        aria-expanded={isExpanded}
      >
        {/* Expand chevron + Entity name */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--bp-ink-muted)" }} />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--bp-ink-muted)" }} />
            )}
            <span className="font-medium" style={{ color: "var(--bp-ink-primary)" }}>
              {item.entityName}
            </span>
          </div>
        </td>

        {/* Source */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Database className="w-3 h-3" style={{ color: "var(--bp-ink-muted)" }} />
            <span style={{ color: "var(--bp-ink-secondary)" }}>{item.source}</span>
          </div>
        </td>

        {/* Composite */}
        <td className="px-4 py-3">
          <ScorePill score={item.composite} />
        </td>

        {/* Tier badge — placed here after composite for visual pairing */}

        {/* Completeness */}
        <td className="px-4 py-3 tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
          {item.completeness.toFixed(1)}
        </td>

        {/* Freshness */}
        <td className="px-4 py-3 tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
          {item.freshness.toFixed(1)}
        </td>

        {/* Consistency */}
        <td className="px-4 py-3 tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
          {item.consistency.toFixed(1)}
        </td>

        {/* Volume */}
        <td className="px-4 py-3 tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
          {item.volume.toFixed(1)}
        </td>

        {/* Computed At */}
        <td className="px-4 py-3 text-xs" style={{ color: "var(--bp-ink-muted)" }}>
          {item.computedAt ? new Date(item.computedAt).toLocaleDateString() : "—"}
        </td>
      </tr>

      {/* Expanded detail row */}
      {isExpanded && (
        <tr style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}>
          <td colSpan={8} className="px-4 py-4" style={{ background: "var(--bp-canvas)" }}>
            <EntityDetail item={item} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Colored score pill */
function ScorePill({ score }: { score: number }) {
  const color =
    score >= 90 ? "var(--bp-operational, #3D7C4F)" :
    score >= 70 ? "var(--bp-caution, #C27A1A)" :
    "var(--bp-fault, #B93A2A)";

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold tabular-nums"
      style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}
    >
      {score.toFixed(1)}
    </span>
  );
}

/** Expanded detail: dimension breakdown with mini bars + tier badge */
function EntityDetail({ item }: { item: QualityItem }) {
  const tc = TIER_COLORS[item.tier] ?? TIER_COLORS.unclassified;
  const dimensions = [
    { label: "Completeness", score: item.completeness },
    { label: "Freshness", score: item.freshness },
    { label: "Consistency", score: item.consistency },
    { label: "Volume", score: item.volume },
  ];

  return (
    <div className="flex flex-wrap gap-6">
      {/* Tier badge */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--bp-ink-muted)" }}>
          Quality Tier
        </span>
        <span
          className="px-3 py-1 rounded-full text-xs font-bold capitalize"
          style={{ background: `${tc.bg}20`, color: tc.text, border: `1px solid ${tc.border}` }}
        >
          {item.tier}
        </span>
      </div>

      {/* Dimension bars */}
      {dimensions.map((dim) => {
        const barColor =
          dim.score >= 90 ? "var(--bp-operational, #3D7C4F)" :
          dim.score >= 70 ? "var(--bp-caution, #C27A1A)" :
          "var(--bp-fault, #B93A2A)";

        return (
          <div key={dim.label} className="flex-1 min-w-[140px]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--bp-ink-muted)" }}>
                {dim.label}
              </span>
              <span className="text-xs font-bold tabular-nums" style={{ color: barColor }}>
                {dim.score.toFixed(1)}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bp-border-subtle)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${dim.score}%`, background: barColor }}
              />
            </div>
          </div>
        );
      })}

      {/* Composite */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--bp-ink-muted)" }}>
          Composite
        </span>
        <span className="text-xl font-bold tabular-nums" style={{
          color: item.composite >= 90 ? "var(--bp-operational)" : item.composite >= 70 ? "var(--bp-caution)" : "var(--bp-fault)"
        }}>
          {item.composite.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
