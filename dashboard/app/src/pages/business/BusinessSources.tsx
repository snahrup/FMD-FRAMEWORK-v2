// ============================================================================
// Business Sources — Source browser page for Business Portal.
//
// Design system: Industrial Precision, Light Mode
// All styles use BP CSS custom properties (--bp-*)
// Data: /api/overview/sources, /api/overview/kpis, /api/control-plane
// ============================================================================

import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTerminology } from "@/hooks/useTerminology";
import { useSourceConfig, resolveSourceLabel, getSourceColor } from "@/hooks/useSourceConfig";
import {
  BusinessIntentHeader,
  KpiCard,
  ProgressRing,
  SourceBadge,
} from "@/components/business";
import { RefreshCw, Search, ChevronRight, Database } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

interface KPIData {
  freshness_pct: number;
  freshness_on_time: number;
  freshness_total: number;
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

interface LZEntity {
  LandingzoneEntityId: number;
  SourceName: string;         // source system name from API
  SourceDisplayName: string;  // display name for the source
  SchemaName: string;         // schema (e.g., "dbo")
  TableName: string;          // table name
  DataSourceId: number;
  IsActive: boolean;
  LastLoadDate?: string | null;
  BronzeStatus?: string | null;
  SilverStatus?: string | null;
}

// ── Helpers ──

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "\u2014";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded ${className ?? ""}`}
      style={{
        background: "linear-gradient(90deg, var(--bp-surface-inset) 25%, var(--bp-surface-2) 50%, var(--bp-surface-inset) 75%)",
        backgroundSize: "200% 100%",
        animation: "bp-skeleton-shimmer 2s ease-in-out infinite",
      }}
    />
  );
}

// ── Skeleton rows ──

function KPIRowSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-5 mb-6">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bp-card p-5">
          <Skeleton className="h-3 w-24 mb-3" />
          <Skeleton className="h-10 w-20 mb-2" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

function SourceCardsSkeleton() {
  return (
    <div
      className="mb-8"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: "20px",
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="bp-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-8 w-16 mb-1" />
          <Skeleton className="h-3 w-12 mb-3" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function TableListSkeleton() {
  return (
    <div>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-5 py-3"
          style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}
        >
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-24 ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ── Source Card ──

function SourceCard({ src }: { src: SourceHealth }) {
  const srcColor = getSourceColor(src.name);
  const label = src.displayName || resolveSourceLabel(src.name);

  const statusLabel =
    src.status === "operational" ? "Operational" :
    src.status === "degraded" ? "Degraded" : "Offline";

  const badgeClass =
    src.status === "operational" ? "bp-badge bp-badge-operational" :
    src.status === "degraded" ? "bp-badge bp-badge-warning" :
    "bp-badge bp-badge-critical";

  return (
    <div className="bp-card p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="bp-source-dot"
          style={{ backgroundColor: srcColor.hex }}
        />
        <span
          className="text-[16px] font-medium truncate"
          style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
        >
          {label}
        </span>
        <span className={badgeClass} style={{ marginLeft: "auto" }}>{statusLabel}</span>
      </div>

      <div
        className="bp-mono text-[28px] font-medium leading-none"
        style={{ color: "var(--bp-ink-primary)" }}
      >
        {src.entityCount.toLocaleString()}
      </div>
      <div
        className="text-[13px] mt-1 mb-4"
        style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-body)" }}
      >
        tables
      </div>

      <div className="mt-auto flex items-center justify-between">
        <span
          className="bp-mono text-[12px]"
          style={{ color: "var(--bp-ink-muted)" }}
        >
          {relativeTime(src.lastRefreshed)}
        </span>
        <Link
          to={`/sources-portal?source=${encodeURIComponent(src.name)}`}
          className="bp-link text-[13px] inline-flex items-center gap-1"
          onClick={(e) => {
            e.preventDefault();
            // Scroll to table list and set filter
            const el = document.getElementById("sources-table-list");
            if (el) el.scrollIntoView({ behavior: "smooth" });
            // Dispatch custom event to set source filter
            window.dispatchEvent(
              new CustomEvent("bp-source-filter", { detail: src.name })
            );
          }}
        >
          View tables <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function BusinessSources() {
  const { t } = useTerminology();
  useSourceConfig(); // trigger cache hydration for resolveSourceLabel / getSourceColor

  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [lzEntities, setLzEntities] = useState<LZEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Table list filters
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  // Listen for source-filter events from source cards
  useEffect(() => {
    function handleSourceFilter(e: Event) {
      const custom = e as CustomEvent;
      setSourceFilter(custom.detail);
    }
    window.addEventListener("bp-source-filter", handleSourceFilter);
    return () => window.removeEventListener("bp-source-filter", handleSourceFilter);
  }, []);

  async function fetchAll() {
    try {
      setError(null);
      const [kpiRes, srcRes, entRes] = await Promise.all([
        fetch(`${API}/api/overview/kpis`),
        fetch(`${API}/api/overview/sources`),
        fetch(`${API}/api/overview/entities`),
      ]);

      if (!kpiRes.ok || !srcRes.ok || !entRes.ok) {
        throw new Error("One or more endpoints returned an error");
      }

      const [kpiData, srcData, entData] = await Promise.all([
        kpiRes.json(),
        srcRes.json(),
        entRes.json(),
      ]);

      setKpis(kpiData);
      setSources(srcData);
      setLzEntities(entData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load source data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 30_000);
    return () => clearInterval(timer);
  }, []);

  // Filtered table list
  const filteredEntities = useMemo(() => {
    let result = lzEntities;
    if (sourceFilter !== "all") {
      result = result.filter(
        (e) => e.SourceName?.toLowerCase() === sourceFilter.toLowerCase()
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.TableName?.toLowerCase().includes(q) ||
          e.SchemaName?.toLowerCase().includes(q) ||
          e.SourceName?.toLowerCase().includes(q) ||
          e.SourceDisplayName?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [lzEntities, sourceFilter, search]);

  // Unique source names for filter dropdown
  const uniqueSources = useMemo(() => {
    const names = new Set(lzEntities.map((e) => e.SourceName).filter(Boolean));
    return Array.from(names).sort();
  }, [lzEntities]);

  return (
    <div className="p-8 max-w-[1280px]">
      <BusinessIntentHeader
        title="Sources"
        meta={
          kpis
            ? `${kpis.sources_online} of ${kpis.sources_total} sources connected`
            : loading
            ? "Loading source health…"
            : `${sources.length} sources in scope`
        }
        summary="This page explains which operational systems are feeding the platform, whether they are healthy, and how much table coverage each source contributes. It is the quickest way to separate platform issues from source-system issues."
        items={[
          {
            label: "What This Page Is",
            value: "Source connectivity and coverage view",
            detail: "Use this page to understand which source systems are online, how recently they refreshed, and which tables each source contributes to the broader estate.",
          },
          {
            label: "Why It Matters",
            value: "Bad source health becomes bad business trust",
            detail: "When a source is offline or stale, downstream dashboards can look incomplete or contradictory even if the transformation layer is working correctly.",
          },
          {
            label: "What Happens Next",
            value: "Move from source health into table detail",
            detail: "Inspect table-level coverage below, open the engineering source manager when a connector needs work, or return to overview if you need the higher-level operating picture first.",
          },
        ]}
        links={[
          { label: "Open Overview", to: "/overview" },
          { label: "Inspect Data Estate", to: "/estate" },
          { label: "Open Source Manager", to: "/sources" },
        ]}
        actions={
          <button
            onClick={fetchAll}
            className="ml-auto flex items-center gap-1.5 text-[12px] transition-colors"
            style={{ color: "var(--bp-ink-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--bp-copper)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--bp-ink-muted)")}
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        }
      />

      {/* Error banner */}
      {error && (
        <div
          className="mb-5 flex items-center gap-2 rounded-lg px-4 py-3 text-[13px]"
          style={{
            background: "var(--bp-fault-light)",
            color: "var(--bp-fault)",
            border: "1px solid var(--bp-fault)",
            borderColor: "rgba(185, 58, 42, 0.2)",
          }}
        >
          {error}
        </div>
      )}

      {/* KPI Row */}
      {loading ? (
        <KPIRowSkeleton />
      ) : (
        <div className="grid grid-cols-4 gap-5 mb-6">
          <KpiCard
            label="Sources Connected"
            value={kpis ? `${kpis.sources_online} / ${kpis.sources_total}` : "\u2014"}
            subtitle={
              kpis && kpis.sources_online === kpis.sources_total
                ? "All sources connected"
                : kpis
                ? `${kpis.sources_total - kpis.sources_online} offline`
                : undefined
            }
          />
          <KpiCard
            label={`Total ${t("Tables")}`}
            value={kpis ? kpis.total_entities.toLocaleString() : "\u2014"}
            subtitle={kpis ? `Across ${kpis.sources_total} sources` : undefined}
          />
          <KpiCard
            label="On Schedule"
            value={kpis ? `${kpis.freshness_pct.toFixed(1)}%` : "\u2014"}
            subtitle={
              kpis
                ? `${kpis.freshness_on_time.toLocaleString()} of ${kpis.freshness_total.toLocaleString()} on time`
                : undefined
            }
            adornment={<ProgressRing pct={kpis?.freshness_pct ?? 0} size={56} />}
          />
          <KpiCard
            label="Average Quality"
            value={kpis?.quality_avg != null ? `${kpis.quality_avg.toFixed(0)}%` : "\u2014"}
            subtitle="Across all tables"
            adornment={<ProgressRing pct={kpis?.quality_avg ?? 0} size={56} />}
          />
        </div>
      )}

      {/* Source Cards Grid */}
      {loading ? (
        <SourceCardsSkeleton />
      ) : sources.length === 0 ? (
        <div
          className="bp-card p-12 text-center mb-8"
          style={{ color: "var(--bp-ink-muted)" }}
        >
          <Database className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <div
            className="text-[16px] font-medium mb-1"
            style={{ fontFamily: "var(--bp-font-body)" }}
          >
            No sources configured
          </div>
          <div className="text-[13px]">
            Sources will appear here once data connections are established.
          </div>
        </div>
      ) : (
        <div
          className="mb-8"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "20px",
          }}
        >
          {sources.map((src) => (
            <SourceCard key={src.name} src={src} />
          ))}
        </div>
      )}

      {/* Table List Panel */}
      <div id="sources-table-list" className="bp-card">
        <div className="bp-panel-header">
          <span
            className="text-[14px] font-semibold"
            style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
          >
            All Tables
          </span>
          <span
            className="bp-mono text-[12px]"
            style={{ color: "var(--bp-ink-muted)" }}
          >
            {filteredEntities.length.toLocaleString()} {filteredEntities.length === 1 ? "table" : "tables"}
          </span>
        </div>

        {/* Search + Filter row */}
        <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}>
          <div
            className="flex-1 flex items-center gap-2 rounded-lg px-4"
            style={{
              background: "var(--bp-surface-inset)",
              height: "48px",
            }}
          >
            <Search className="h-4 w-4 shrink-0" style={{ color: "var(--bp-ink-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${lzEntities.length.toLocaleString()} tables...`}
              className="w-full bg-transparent outline-none text-[14px]"
              style={{
                color: "var(--bp-ink-primary)",
                fontFamily: "var(--bp-font-body)",
              }}
            />
          </div>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg px-3 text-[13px] outline-none cursor-pointer"
            style={{
              background: "var(--bp-surface-inset)",
              color: "var(--bp-ink-secondary)",
              height: "48px",
              border: "none",
              fontFamily: "var(--bp-font-body)",
            }}
          >
            <option value="all">All Sources</option>
            {uniqueSources.map((s) => (
              <option key={s} value={s}>
                {resolveSourceLabel(s)}
              </option>
            ))}
          </select>
        </div>

        {/* Table list */}
        {loading ? (
          <TableListSkeleton />
        ) : filteredEntities.length === 0 ? (
          <div
            className="px-5 py-12 text-center text-[14px]"
            style={{ color: "var(--bp-ink-muted)" }}
          >
            {search || sourceFilter !== "all"
              ? "No tables match your filters"
              : "No tables found"}
          </div>
        ) : (
          <div className="max-h-[480px] overflow-y-auto">
            {/* Table header */}
            <div
              className="flex items-center gap-4 px-5 py-2 text-[11px] font-medium uppercase tracking-wider sticky top-0"
              style={{
                color: "var(--bp-ink-tertiary)",
                background: "var(--bp-surface-1)",
                borderBottom: "1px solid var(--bp-border-subtle)",
              }}
            >
              <span className="flex-1">Table</span>
              <span className="w-[100px]">Source</span>
              <span className="w-[140px] text-center">Layers</span>
              <span className="w-[100px] text-right">Last Refreshed</span>
            </div>

            {filteredEntities.slice(0, 200).map((entity, i) => (
              <Link
                key={entity.LandingzoneEntityId}
                to={`/catalog-portal/entity-${entity.LandingzoneEntityId}`}
                className="flex items-center gap-4 px-5 py-3 transition-colors no-underline"
                style={{
                  borderBottom:
                    i < Math.min(filteredEntities.length, 200) - 1
                      ? "1px solid var(--bp-border-subtle)"
                      : "none",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--bp-surface-2)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {/* Entity name */}
                <div className="flex-1 min-w-0">
                  <span
                    className="bp-mono text-[13px] font-medium truncate block"
                    style={{ color: "var(--bp-ink-primary)" }}
                  >
                    {entity.SchemaName ? `${entity.SchemaName}.${entity.TableName}` : entity.TableName}
                  </span>
                </div>

                {/* Source badge */}
                <div className="w-[100px]">
                  <SourceBadge source={entity.SourceName} />
                </div>

                {/* Layer status indicators */}
                <div className="w-[140px] flex items-center justify-center gap-2">
                  <LayerDot label="LZ" active />
                  <LayerDot label="B" active={!!entity.BronzeStatus} />
                  <LayerDot label="S" active={!!entity.SilverStatus} />
                </div>

                {/* Last refreshed */}
                <span
                  className="bp-mono text-[12px] w-[100px] text-right"
                  style={{ color: "var(--bp-ink-muted)" }}
                >
                  {relativeTime(entity.LastLoadDate)}
                </span>
              </Link>
            ))}

            {filteredEntities.length > 200 && (
              <div
                className="px-5 py-3 text-center text-[13px]"
                style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-body)" }}
              >
                Showing 200 of {filteredEntities.length.toLocaleString()} tables. Use search to narrow results.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Layer Dot indicator ──

function LayerDot({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className="inline-flex items-center justify-center text-[10px] font-medium rounded-full"
      style={{
        width: "24px",
        height: "24px",
        background: active ? "var(--bp-operational-light, rgba(34, 139, 34, 0.1))" : "var(--bp-surface-inset)",
        color: active ? "var(--bp-operational)" : "var(--bp-ink-muted)",
        fontFamily: "var(--bp-font-mono)",
      }}
    >
      {label}
    </span>
  );
}
