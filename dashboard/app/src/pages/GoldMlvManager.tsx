// Gold MLV Manager — browse and manage Gold layer objects (MLVs, views, tables).
// Route: /gold/serve

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Layers3, Search, Database, Table2, Eye, ChevronDown, ChevronRight,
  Loader2, AlertTriangle, BarChart3, Box, Grid3X3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GoldStudioLayout, useDomainContext } from "@/components/gold/GoldStudioLayout";
import { GoldNextActionPanel } from "@/components/gold/GoldWorkflowCards";

/* ---------- api helpers ---------- */
const API = "/api/gold";
async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ---------- types ---------- */
interface MlvItem {
  id: number;
  root_id?: number;
  target_name: string;
  source_sql: string;
  source_sql_preview: string;
  status: string;
  object_type: string;
  version?: number;
  canonical_name?: string;
  domain?: string;
  entity_type?: string;
  grain?: string;
  created_at?: string;
  updated_at?: string;
}

interface MlvDetail extends MlvItem {
  validation_runs?: Array<Record<string, unknown>>;
  transformation_rules?: string;
  included_columns?: string;
  excluded_columns?: string;
  downstream_reports?: string;
  refresh_strategy?: string;
}

interface DomainSummary {
  domain: string;
  count: number;
  facts: number;
  dimensions: number;
}

interface Summary {
  total: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  by_domain: DomainSummary[];
}

/* ---------- style helpers ---------- */
const display = (sz: number) => ({ fontFamily: "var(--bp-font-display)", fontSize: sz } as const);
const body = (sz: number) => ({ fontFamily: "var(--bp-font-body)", fontSize: sz } as const);
const mono = { fontFamily: "var(--bp-font-mono)", fontSize: 11 } as const;

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  draft:              { bg: "var(--bp-copper-light, #fdf0e2)", color: "var(--bp-copper)" },
  validated:          { bg: "var(--bp-operational-light, #e6f5ec)", color: "var(--bp-operational-green)" },
  approved:           { bg: "var(--bp-gold-light)", color: "var(--bp-gold)" },
  published:          { bg: "var(--bp-info-light, #dbeafe)", color: "var(--bp-info-blue, #2563eb)" },
  needs_revalidation: { bg: "var(--bp-caution-light, #fef3c7)", color: "var(--bp-caution-amber)" },
  deprecated:         { bg: "var(--bp-surface-inset)", color: "var(--bp-ink-muted)" },
};

/** Maps status to left-rail color */
const STATUS_RAIL_COLORS: Record<string, string> = {
  draft:              "var(--bp-copper)",
  validated:          "var(--bp-operational-green)",
  approved:           "var(--bp-gold)",
  published:          "var(--bp-info-blue, #2563eb)",
  needs_revalidation: "var(--bp-caution-amber)",
  deprecated:         "var(--bp-ink-muted)",
};

const TYPE_ICONS: Record<string, typeof Database> = {
  mlv: Layers3,
  view: Eye,
  table: Table2,
};

const TYPE_BG: Record<string, { bg: string; color: string }> = {
  mlv:   { bg: "var(--bp-gold-light)", color: "var(--bp-gold)" },
  view:  { bg: "var(--bp-info-light, #dbeafe)", color: "var(--bp-info-blue, #2563eb)" },
  table: { bg: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)" },
};

/* ---------- keyframes (injected once) ---------- */
const STYLE_ID = "gold-mlv-animations";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes goldFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes goldFadeInRow {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .gold-fade-in {
      animation: goldFadeIn var(--duration-smooth, 300ms) var(--ease-claude, cubic-bezier(0.4,0,0.2,1)) both;
    }
    .gold-stagger-card {
      animation: goldFadeIn var(--duration-smooth, 300ms) var(--ease-claude, cubic-bezier(0.4,0,0.2,1)) both;
    }
    .gold-stagger-row {
      animation: goldFadeInRow var(--duration-fast, 150ms) var(--ease-claude, cubic-bezier(0.4,0,0.2,1)) both;
    }
  `;
  document.head.appendChild(style);
}

/* ---------- sub-components ---------- */

function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: bg, color, border: `1px solid ${color}22` }}
    >
      {label}
    </span>
  );
}

/** Tiny stacked ratio bar showing fact/dimension proportion */
function RatioBar({ facts, dimensions }: { facts: number; dimensions: number }) {
  const total = facts + dimensions;
  if (total === 0) return null;
  const factPct = Math.round((facts / total) * 100);
  return (
    <div
      className="w-full h-[3px] rounded-full overflow-hidden mt-2.5"
      style={{ background: "var(--bp-border)" }}
      aria-label={`${facts} facts, ${dimensions} dimensions`}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${factPct}%`,
          background: "var(--bp-copper)",
          transition: `width var(--duration-smooth, 300ms) var(--ease-claude)`,
        }}
      />
    </div>
  );
}

function DomainCard({
  domain, onClick, active, index,
}: { domain: DomainSummary; onClick: () => void; active: boolean; index: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="gold-stagger-card gs-row-hover rounded-lg text-left transition-all relative overflow-hidden"
      style={{
        animationDelay: `${index * 30}ms`,
        background: active ? "var(--bp-gold-light)" : "var(--bp-surface-1)",
        border: `1px solid ${active ? "var(--bp-gold)" : "var(--bp-border)"}`,
        padding: "0",
      }}
      aria-pressed={active}
      aria-label={`Filter by domain: ${domain.domain}`}
    >
      {/* Status rail */}
      <div className="flex h-full">
        <div
          className="w-[3px] shrink-0 self-stretch rounded-l"
          style={{
            background: active ? "var(--bp-gold)" : "var(--bp-gold-light)",
            transition: `background var(--duration-fast, 150ms) var(--ease-claude)`,
          }}
        />
        <div className="flex-1 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <span style={{ ...body(13), color: "var(--bp-ink-primary)" }} className="font-medium truncate">
              {domain.domain}
            </span>
            <span style={{ ...display(16), color: "var(--bp-gold)" }} className="font-bold">
              {domain.count}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            {domain.facts > 0 && (
              <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--bp-ink-secondary)" }}>
                <BarChart3 size={10} aria-hidden="true" /> {domain.facts} fact{domain.facts !== 1 ? "s" : ""}
              </span>
            )}
            {domain.dimensions > 0 && (
              <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--bp-ink-secondary)" }}>
                <Box size={10} aria-hidden="true" /> {domain.dimensions} dim{domain.dimensions !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <RatioBar facts={domain.facts} dimensions={domain.dimensions} />
        </div>
      </div>
    </button>
  );
}

function SelectFilter({
  label, value, options, onChange,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <span style={{ ...body(11), color: "var(--bp-ink-secondary)" }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md px-2 py-1.5 outline-none cursor-pointer"
        style={{ ...body(12), background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-primary)" }}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o === "All" ? `All ${label}s` : o}</option>
        ))}
      </select>
    </label>
  );
}

/* ---------- main component ---------- */
export default function GoldMlvManager() {
  const { domain, setDomain } = useDomainContext();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<MlvItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [domainFilter, setDomainFilter] = useState(domain ?? "All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Expanded rows
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MlvDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Derived filter options
  const statusOptions = ["All", ...Object.keys(summary?.by_status ?? {}).sort()];
  const typeOptions = ["All", ...Object.keys(summary?.by_type ?? {}).sort()];

  // Hero stats: inline breakdown
  const typeBreakdown = useMemo(() => {
    if (!summary) return [];
    return [
      { label: "MLVs", value: summary.by_type.mlv ?? 0, accent: "var(--bp-copper)" },
      { label: "Views", value: summary.by_type.view ?? 0, accent: "var(--bp-info-blue, #2563eb)" },
      { label: "Tables", value: summary.by_type.table ?? 0, accent: "var(--bp-ink-secondary)" },
    ];
  }, [summary]);

  /* --- load summary --- */
  const loadSummary = useCallback(() => {
    const summaryPath = domainFilter !== "All" ? `${API}/mlvs/summary?domain=${encodeURIComponent(domainFilter)}` : `${API}/mlvs/summary`;
    fetchJSON<Summary>(summaryPath)
      .then(setSummary)
      .catch(() => {});
  }, [domainFilter]);

  /* --- load list --- */
  const loadList = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
    if (domainFilter !== "All") qs.set("domain", domainFilter);
    if (statusFilter !== "All") qs.set("status", statusFilter);
    if (typeFilter !== "All") qs.set("type", typeFilter);
    if (searchQuery.trim()) qs.set("q", searchQuery.trim());

    fetchJSON<{ items: MlvItem[]; total: number }>(`${API}/mlvs?${qs}`)
      .then((r) => {
        setItems(r.items ?? []);
        setTotal(r.total ?? 0);
      })
      .catch((err) => setError(err?.message ?? "Failed to load Gold objects"))
      .finally(() => setLoading(false));
  }, [domainFilter, statusFilter, typeFilter, searchQuery, page]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { setDomainFilter(domain ?? "All"); }, [domain]);

  /* --- load detail on expand --- */
  const toggleExpand = useCallback((id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setDetailLoading(true);
    fetchJSON<MlvDetail>(`${API}/mlvs/${id}`)
      .then(setDetail)
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  }, [expandedId]);

  /* --- domain card click --- */
  const handleDomainClick = useCallback((clickedDomain: string) => {
    const next = domainFilter === clickedDomain ? "All" : clickedDomain;
    setDomainFilter(next);
    setDomain(next === "All" ? null : next);
    setPage(0);
  }, [domainFilter, setDomain]);

  const totalPages = Math.ceil(total / pageSize);
  const showFrom = page * pageSize + 1;
  const showTo = Math.min((page + 1) * pageSize, total);

  /* ========== render ========== */
  return (
    <GoldStudioLayout activeTab="serve">
    <div className="gold-fade-in space-y-6 px-2 pb-8 pt-3 max-w-[1400px] mx-auto">

      {/* ── Header: Hero Number ── */}
      <div className="flex items-end justify-between gap-6">
        <div className="flex items-end gap-6">
          {/* Hero number */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Layers3 className="w-5 h-5" style={{ color: "var(--bp-gold)" }} aria-hidden="true" />
              <span
                className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
                style={{ background: "var(--bp-copper-light)", color: "var(--bp-copper)", border: "1px solid rgba(180,86,36,0.15)" }}
              >
                Serve
              </span>
            </div>
            <span
              className="block font-bold leading-none"
              style={{ ...display(48), color: "var(--bp-gold)" }}
              aria-label={`${summary?.total ?? 0} Gold layer objects`}
            >
              {summary?.total ?? "\u2014"}
            </span>
            <span
              className="block mt-1"
              style={{ ...body(13), color: "var(--bp-ink-secondary)" }}
            >
              Gold Layer Objects
            </span>
          </div>

          {/* Type breakdown inline stats */}
          {summary && (
            <div
              className="flex items-center gap-5 pl-6 self-end mb-1"
              style={{ borderLeft: "1px solid var(--bp-border)" }}
              role="region"
              aria-label="Gold object type breakdown"
            >
              {typeBreakdown.map((t) => (
                <div key={t.label} className="flex items-center gap-1.5">
                  <span style={{ ...display(18), color: t.accent }} className="font-bold leading-none">
                    {t.value}
                  </span>
                  <span style={{ ...body(11), color: "var(--bp-ink-muted)" }}>
                    {t.label}
                  </span>
                </div>
              ))}
              <div className="w-px h-5" style={{ background: "var(--bp-border)" }} aria-hidden="true" />
              <div className="flex items-center gap-1.5">
                <span style={{ ...display(18), color: "var(--bp-gold)" }} className="font-bold leading-none">
                  {summary.by_domain.length}
                </span>
                <span style={{ ...body(11), color: "var(--bp-ink-muted)" }}>
                  Domains
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <GoldNextActionPanel
        title={total > 0 ? `Review ${total} live gold object${total === 1 ? "" : "s"}` : "Wait for the first released product to go live"}
        description="This is the live stewardship stage. Users should be able to see what exists in production, who owns it, and whether it is healthy without hunting across the rest of the workflow."
        whyItMatters="Release is not the end of the product story. Governance, freshness, ownership, and downstream confidence all continue here."
        whatHappensNext="Open a live object to inspect details, ownership, and release lineage. If something looks wrong, route the issue back to the appropriate upstream stage."
        tone={total > 0 ? "success" : "copper"}
      />

      {/* ── Domain Cards ── */}
      {summary && summary.by_domain.length > 0 && (
        <div role="region" aria-label="Business domains">
          <h2 style={{ ...body(13), color: "var(--bp-ink-secondary)" }} className="font-medium mb-2 flex items-center gap-1.5">
            <Grid3X3 size={14} aria-hidden="true" /> Business Domains
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
            {summary.by_domain.map((d, i) => (
              <DomainCard
                key={d.domain}
                domain={d}
                active={domainFilter === d.domain}
                onClick={() => handleDomainClick(d.domain)}
                index={i}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Filter Bar — single cohesive toolbar ── */}
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-2.5"
        style={{
          borderTop: "1px solid var(--bp-border)",
          borderBottom: "1px solid var(--bp-border)",
        }}
      >
        <SelectFilter label="Status" value={statusFilter} options={statusOptions} onChange={(v) => { setStatusFilter(v); setPage(0); }} />
        <SelectFilter label="Type" value={typeFilter} options={typeOptions} onChange={(v) => { setTypeFilter(v); setPage(0); }} />
        {domainFilter !== "All" && (
          <span className="flex items-center gap-1">
            <Badge label={domainFilter} bg="var(--bp-gold-light)" color="var(--bp-gold)" />
            <button
              type="button"
              onClick={() => {
                setDomainFilter("All");
                setDomain(null);
              }}
              className="text-xs hover:underline"
              style={{ color: "var(--bp-ink-muted)" }}
              aria-label="Clear domain filter"
            >
              clear
            </button>
          </span>
        )}
        <div className="relative ml-auto" style={{ width: 240 }}>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--bp-ink-muted)" }} aria-hidden="true" />
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
            placeholder="Search by name..."
            aria-label="Search Gold objects"
            className="w-full rounded-md pl-8 pr-3 py-1.5 outline-none"
            style={{ ...body(13), background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-primary)" }}
          />
        </div>
        <span style={{ ...body(11), color: "var(--bp-ink-muted)" }} className="whitespace-nowrap">
          {total} result{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div
          className="rounded-lg px-4 py-3 flex items-center gap-3"
          role="alert"
          style={{ background: "var(--bp-fault-light)", border: "1px solid var(--bp-fault-red)" }}
        >
          <AlertTriangle size={16} style={{ color: "var(--bp-fault-red)" }} aria-hidden="true" />
          <span style={{ ...body(13), color: "var(--bp-fault-red)" }}>{error}</span>
          <button
            type="button"
            onClick={loadList}
            className="rounded px-2 py-1 text-xs ml-auto"
            style={{ background: "var(--bp-fault-red)", color: "var(--bp-surface-1)" }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && items.length === 0 && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--bp-gold)" }} aria-label="Loading" />
        </div>
      )}

      {/* ── Empty State ── */}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="gs-float w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
            style={{ background: "var(--bp-gold-light)" }}
          >
            <Database className="w-7 h-7" style={{ color: "var(--bp-gold)" }} aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ ...display(18), color: "var(--bp-ink-tertiary)" }}>
            No Gold Objects Found
          </h2>
          <p className="max-w-sm" style={{ ...body(13), color: "var(--bp-ink-secondary)" }}>
            Gold layer specs are created in Gold Studio. Once canonical entities have been defined and specs generated,
            they will appear here for management and deployment tracking.
          </p>
        </div>
      )}

      {/* ── MLV Table with integrated pagination ── */}
      {items.length > 0 && (
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: "1px solid var(--bp-border)" }}
          role="region"
          aria-label="Gold objects table"
        >
          <table className="w-full" style={{ ...body(13) }}>
            <thead>
              <tr style={{ background: "var(--bp-surface-1)", borderBottom: "1px solid var(--bp-border)" }}>
                <th style={{ width: 3, padding: 0 }} />
                <Th style={{ width: 32 }}>{""}</Th>
                <Th>Target Name</Th>
                <Th style={{ width: 80 }}>Type</Th>
                <Th>Domain</Th>
                <Th style={{ width: 100 }}>Entity Type</Th>
                <Th style={{ width: 110 }}>Status</Th>
                <Th>Grain</Th>
                <Th style={{ width: 100 }}>Created</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const expanded = expandedId === item.id;
                const TypeIcon = TYPE_ICONS[item.object_type] ?? Layers3;
                const sc = STATUS_COLORS[item.status] ?? STATUS_COLORS.draft;
                return (
                  <MlvRow
                    key={item.id}
                    item={item}
                    expanded={expanded}
                    detail={expanded ? detail : null}
                    detailLoading={expanded && detailLoading}
                    onToggle={() => toggleExpand(item.id)}
                    TypeIcon={TypeIcon}
                    statusColors={sc}
                    index={idx}
                    isOddRow={idx % 2 === 1}
                  />
                );
              })}
            </tbody>
            {/* Integrated pagination footer */}
            {totalPages > 1 && (
              <tfoot>
                <tr style={{ background: "var(--bp-surface-1)", borderTop: "1px solid var(--bp-border)" }}>
                  <td colSpan={9} className="px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <span style={{ ...body(12), color: "var(--bp-ink-muted)" }}>
                        Showing {showFrom}\u2013{showTo} of {total}
                      </span>
                      <div className="flex items-center gap-3">
                        <span style={{ ...body(12), color: "var(--bp-ink-muted)" }}>
                          Page {page + 1} of {totalPages}
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={page === 0}
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            className="rounded-md px-3 py-1 text-sm disabled:opacity-40 transition-colors"
                            style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-primary)" }}
                            aria-label="Previous page"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            disabled={page >= totalPages - 1}
                            onClick={() => setPage((p) => p + 1)}
                            className="rounded-md px-3 py-1 text-sm disabled:opacity-40 transition-colors"
                            style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-primary)" }}
                            aria-label="Next page"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
    </GoldStudioLayout>
  );
}

/* ---------- table sub-components ---------- */

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--bp-ink-muted)", borderBottom: "1px solid var(--bp-border)", ...style }}
      scope="col"
    >
      {children}
    </th>
  );
}

function MlvRow({
  item, expanded, detail, detailLoading, onToggle, TypeIcon, statusColors, index, isOddRow,
}: {
  item: MlvItem;
  expanded: boolean;
  detail: MlvDetail | null;
  detailLoading: boolean;
  onToggle: () => void;
  TypeIcon: typeof Database;
  statusColors: { bg: string; color: string };
  index: number;
  isOddRow: boolean;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const typeMeta = TYPE_BG[item.object_type] ?? TYPE_BG.mlv;

  return (
    <>
      <tr
        className="gold-stagger-row gs-stagger-row cursor-pointer transition-colors"
        style={{
          "--i": Math.min(index, 15),
          animationDelay: `${index * 20}ms`,
          background: expanded ? "var(--bp-gold-light)" : isOddRow ? "var(--bp-surface-inset)" : "transparent",
          borderBottom: expanded ? "none" : "1px solid var(--bp-border-subtle, rgba(0,0,0,0.04))",
        } as React.CSSProperties}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${item.target_name} — click to ${expanded ? "collapse" : "expand"}`}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      >
        {/* Status rail cell */}
        <td style={{ width: 3, padding: 0, background: STATUS_RAIL_COLORS[item.status] ?? "var(--bp-ink-muted)" }} />
        {/* Chevron */}
        <td className="py-2.5 relative" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <div className="flex items-center justify-center pl-2 pr-1">
            <Chevron size={14} style={{ color: "var(--bp-ink-muted)" }} aria-hidden="true" />
          </div>
        </td>
        <td className="px-3 py-2.5 font-medium" style={{ color: "var(--bp-ink-primary)", ...body(13) }}>
          {item.target_name}
        </td>
        <td className="px-3 py-2.5">
          <span
            className="inline-flex items-center gap-1 rounded-md px-2 py-1"
            style={{ background: typeMeta.bg }}
          >
            <TypeIcon size={12} style={{ color: typeMeta.color }} aria-hidden="true" />
            <span className="text-[11px] uppercase font-medium" style={{ color: typeMeta.color }}>
              {item.object_type ?? "mlv"}
            </span>
          </span>
        </td>
        <td className="px-3 py-2.5" style={{ ...body(12), color: "var(--bp-ink-secondary)" }}>
          {item.domain ?? "\u2014"}
        </td>
        <td className="px-3 py-2.5">
          {item.entity_type ? (
            <Badge
              label={item.entity_type}
              bg={item.entity_type === "fact" ? "var(--bp-copper-light, #fdf0e2)" : "var(--bp-info-light, #dbeafe)"}
              color={item.entity_type === "fact" ? "var(--bp-copper)" : "var(--bp-info-blue, #2563eb)"}
            />
          ) : (
            <span style={{ color: "var(--bp-ink-muted)" }}>{"\u2014"}</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <Badge label={item.status ?? "draft"} bg={statusColors.bg} color={statusColors.color} />
        </td>
        <td className="px-3 py-2.5" style={{ ...body(12), color: "var(--bp-ink-secondary)" }}>
          {item.grain ?? "\u2014"}
        </td>
        <td className="px-3 py-2.5" style={{ ...mono, color: "var(--bp-ink-muted)" }}>
          {item.created_at ? new Date(item.created_at).toLocaleDateString() : "\u2014"}
        </td>
      </tr>

      {/* Expanded detail panel */}
      {expanded && (
        <tr className="gs-stagger-row" style={{ "--i": 0 } as React.CSSProperties}>
          <td colSpan={9} style={{ background: "var(--bp-surface-1)", borderBottom: "1px solid var(--bp-border)" }}>
            <div className="px-6 py-4 space-y-5">
              {detailLoading && (
                <div className="flex items-center gap-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--bp-gold)" }} aria-label="Loading detail" />
                  <span style={{ ...body(12), color: "var(--bp-ink-muted)" }}>Loading details...</span>
                </div>
              )}

              {detail && (
                <>
                  {/* Canonical entity info */}
                  <div
                    className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-4"
                    style={{ borderBottom: "1px solid var(--bp-border-subtle, rgba(0,0,0,0.04))" }}
                  >
                    <DetailField label="Canonical Name" value={detail.canonical_name} />
                    <DetailField label="Domain" value={detail.domain} />
                    <DetailField label="Entity Type" value={detail.entity_type} />
                    <DetailField label="Grain" value={detail.grain} />
                    <DetailField label="Version" value={detail.version?.toString()} />
                    <DetailField label="Refresh Strategy" value={detail.refresh_strategy} />
                    <DetailField label="Updated" value={detail.updated_at ? new Date(detail.updated_at).toLocaleString() : undefined} />
                  </div>

                  {/* Source SQL — dark code block */}
                  {detail.source_sql && (
                    <div>
                      <h4
                        className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                        style={{ color: "var(--bp-ink-muted)" }}
                      >
                        Source SQL
                      </h4>
                      <div
                        className="rounded-md overflow-hidden"
                        style={{ border: "1px solid var(--bp-border)" }}
                      >
                        <pre
                          className="overflow-x-auto max-h-[300px] overflow-y-auto"
                          style={{
                            fontFamily: "var(--bp-font-mono)",
                            fontSize: 12,
                            lineHeight: 1.7,
                            background: "var(--bp-code-block, #2B2A27)",
                            color: "var(--bp-code-text, #E8E4DB)",
                            margin: 0,
                            padding: 0,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          <code className="block">
                            {detail.source_sql.split("\n").map((line, i) => (
                              <div key={i} className="flex">
                                <span
                                  className="shrink-0 text-right select-none pr-3 pl-3"
                                  style={{
                                    color: "rgba(255,255,255,0.2)",
                                    width: 48,
                                    background: "rgba(0,0,0,0.15)",
                                    userSelect: "none",
                                  }}
                                >
                                  {i + 1}
                                </span>
                                <span className="px-3 flex-1">{line || "\u00A0"}</span>
                              </div>
                            ))}
                          </code>
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Validation runs */}
                  {detail.validation_runs && detail.validation_runs.length > 0 && (
                    <div
                      className="pt-4"
                      style={{ borderTop: "1px solid var(--bp-border-subtle, rgba(0,0,0,0.04))" }}
                    >
                      <h4
                        className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                        style={{ color: "var(--bp-ink-muted)" }}
                      >
                        Recent Validation Runs
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {detail.validation_runs.map((run, i) => (
                          <span
                            key={i}
                            className="rounded px-2 py-1 text-[11px]"
                            style={{
                              background: run.status === "pass" ? "var(--bp-operational-light)" : "var(--bp-caution-light)",
                              color: run.status === "pass" ? "var(--bp-operational-green)" : "var(--bp-caution-amber)",
                              border: "1px solid var(--bp-border)",
                            }}
                          >
                            {String(run.status ?? "unknown")} — {run.started_at ? new Date(String(run.started_at)).toLocaleDateString() : "n/a"}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {!detailLoading && !detail && (
                <p style={{ ...body(12), color: "var(--bp-ink-muted)" }}>
                  Unable to load detail for this object.
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="text-[10px] font-semibold uppercase tracking-wider block" style={{ color: "var(--bp-ink-muted)" }}>
        {label}
      </span>
      <span style={{ ...body(13), color: value ? "var(--bp-ink-primary)" : "var(--bp-ink-muted)" }}>
        {value || "\u2014"}
      </span>
    </div>
  );
}
