// ============================================================================
// Business Catalog — Data catalog with dual tabs for Business Portal.
//
// Design system: Industrial Precision, Light Mode
// All styles use BP CSS custom properties (--bp-*)
// Tab 1: Data Collections (Gold domains)
// Tab 2: All Source Tables (from control-plane)
// ============================================================================

import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { useSourceConfig, resolveSourceLabel, getSourceColor } from "@/hooks/useSourceConfig";
import {
  BusinessIntentHeader,
  SourceBadge,
  QualityTierBadge,
  scoreToTier,
  type QualityTier,
} from "@/components/business";
import { Search, ChevronRight, Database, Layers, FolderOpen } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

interface GoldDomain {
  id: number | string;
  name: string;
  description?: string;
  model_count?: number;
}

interface LZEntity {
  LandingzoneEntityId: number;
  SourceName: string;         // source system name
  SourceDisplayName?: string;
  SchemaName: string;
  TableName: string;
  DataSourceId: number;
  IsActive: boolean;
  LastLoadDate?: string | null;
  BronzeStatus?: string | null;
  SilverStatus?: string | null;
}

interface DataSourceInfo {
  DataSourceId: number;
  Name: string;
  DisplayName?: string;
}

interface QualityScore {
  entity_id: number;
  score: number;
}

interface Annotation {
  entity_id: number;
  business_name: string;
  description: string;
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

// ── Tab type ──

type TabId = "collections" | "tables";

// ── Domain Card ──

function DomainCard({ domain }: { domain: GoldDomain }) {
  return (
    <div
      className="bp-card p-5 flex flex-col transition-colors"
      style={{ minHeight: "160px" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bp-surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bp-surface-1)")}
    >
      <div className="flex items-center gap-2 mb-3">
        <FolderOpen
          className="h-4 w-4 shrink-0"
          style={{ color: "var(--bp-copper)" }}
        />
        <span
          className="text-[15px] font-semibold truncate"
          style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
        >
          {domain.name}
        </span>
      </div>

      <p
        className="text-[13px] leading-relaxed mb-4 flex-1"
        style={{
          color: "var(--bp-ink-secondary)",
          fontFamily: "var(--bp-font-body)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {domain.description || "No description"}
      </p>

      <div className="flex items-center mt-auto">
        <span
          className="bp-mono text-[12px]"
          style={{ color: "var(--bp-ink-muted)" }}
        >
          {domain.model_count ?? 0} dataset{(domain.model_count ?? 0) !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// ── Table Card ──

function TableCard({ entity, qualityMap, description }: { entity: LZEntity; qualityMap: Map<number, number>; description?: string }) {
  const score = qualityMap.get(entity.LandingzoneEntityId);
  const tier = scoreToTier(score ?? null);
  const desc = description || null;

  return (
    <Link
      to={`/catalog-portal/entity-${entity.LandingzoneEntityId}`}
      className="bp-card p-5 flex flex-col no-underline transition-colors"
      style={{ minHeight: "140px" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bp-surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bp-surface-1)")}
    >
      <div
        className="bp-mono text-[14px] font-medium truncate mb-2"
        style={{ color: "var(--bp-ink-primary)" }}
        title={entity.SchemaName ? `${entity.SchemaName}.${entity.TableName}` : entity.TableName}
      >
        {entity.SchemaName ? `${entity.SchemaName}.${entity.TableName}` : entity.TableName}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <SourceBadge source={entity.SourceName} />
        {tier !== "unscored" && <QualityTierBadge tier={tier} />}
      </div>

      <p
        className="text-[13px] mb-3 flex-1"
        style={{
          color: desc ? "var(--bp-ink-secondary)" : "var(--bp-ink-muted)",
          fontFamily: "var(--bp-font-body)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {desc || "No description"}
      </p>

      <div className="mt-auto">
        <span
          className="bp-mono text-[11px]"
          style={{ color: "var(--bp-ink-muted)" }}
        >
          {relativeTime(entity.LastLoadDate)}
        </span>
      </div>
    </Link>
  );
}

// ── Source Chip (filter chip) ──

function SourceChip({
  label,
  colorHex,
  active,
  onClick,
}: {
  label: string;
  colorHex: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer"
      style={{
        background: active ? "var(--bp-copper-light)" : "var(--bp-surface-inset)",
        color: active ? "var(--bp-copper)" : "var(--bp-ink-secondary)",
        border: active ? "1px solid var(--bp-copper)" : "1px solid transparent",
        fontFamily: "var(--bp-font-body)",
      }}
    >
      <span
        className="rounded-full"
        style={{
          width: "8px",
          height: "8px",
          backgroundColor: colorHex,
          display: "inline-block",
        }}
      />
      {label}
    </button>
  );
}

// ── Tier Chip (filter chip) ──

function TierChip({
  tier,
  label,
  active,
  onClick,
}: {
  tier: QualityTier;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const tierClass =
    tier === "gold" ? "bp-tier-gold" :
    tier === "silver" ? "bp-tier-silver" :
    tier === "bronze" ? "bp-tier-bronze" : "";

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${active && tierClass ? `bp-badge ${tierClass}` : ""}`}
      style={{
        background: active && !tierClass ? "var(--bp-copper-light)" : active ? undefined : "var(--bp-surface-inset)",
        color: active && !tierClass ? "var(--bp-copper)" : active ? undefined : "var(--bp-ink-secondary)",
        border: active ? "1px solid var(--bp-copper)" : "1px solid transparent",
        fontFamily: "var(--bp-font-body)",
      }}
    >
      {label}
    </button>
  );
}

// ── Skeleton blocks ──

function DomainGridSkeleton() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: "20px",
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bp-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-3/4 mb-4" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function TableGridSkeleton() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: "20px",
      }}
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="bp-card p-5">
          <Skeleton className="h-4 w-40 mb-3" />
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──

export default function BusinessCatalog() {
  const { sources: sourceConfigs } = useSourceConfig();

  const [activeTab, setActiveTab] = useState<TabId>("collections");
  const [domains, setDomains] = useState<GoldDomain[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [domainsError, setDomainsError] = useState(false);

  const [lzEntities, setLzEntities] = useState<LZEntity[]>([]);
  const [qualityScores, setQualityScores] = useState<QualityScore[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [sourceFilters, setSourceFilters] = useState<Set<string>>(new Set());
  const [tierFilters, setTierFilters] = useState<Set<QualityTier>>(new Set());

  // ── Fetch gold domains ──
  useEffect(() => {
    fetch(`${API}/api/gold/domains`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((data) => {
        // Backend returns [{name, entityCount}] — normalise to GoldDomain shape
        const arr: GoldDomain[] = (Array.isArray(data) ? data : []).map(
          (d: Record<string, unknown>) => ({
            id: (d.id as string | number) ?? null,
            name: (d.name as string) ?? "",
            description: (d.description as string) ?? undefined,
            model_count: (d.entityCount as number) ?? (d.model_count as number) ?? 0,
          })
        );
        setDomains(arr);
      })
      .catch(() => {
        setDomainsError(true);
        setDomains([]);
      })
      .finally(() => setDomainsLoading(false));
  }, []);

  // ── Fetch enriched entities + quality + annotations ──
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/overview/entities`).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(`${API}/api/mdm/quality/scores?limit=500`).then((r) => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
      fetch(`${API}/api/glossary/annotations/bulk`).then((r) => r.ok ? r.json() : []).catch(() => []),
    ])
      .then(([entData, qData, annData]) => {
        setLzEntities(Array.isArray(entData) ? entData : []);
        // Backend returns {items: [{entityId, composite, ...}]} — normalise to QualityScore[]
        const rawItems = Array.isArray(qData?.items) ? qData.items : (Array.isArray(qData) ? qData : []);
        const scores: QualityScore[] = rawItems.map((q: Record<string, unknown>) => ({
          entity_id: (q.entityId ?? q.entity_id) as number,
          score: (q.composite ?? q.score ?? 0) as number,
        }));
        setQualityScores(scores);
        setAnnotations(Array.isArray(annData) ? annData : []);
      })
      .catch(() => {
        // Silently degrade
      })
      .finally(() => setTablesLoading(false));
  }, []);

  // ── Quality map ──
  const qualityMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const q of qualityScores) {
      m.set(q.entity_id, q.score);
    }
    return m;
  }, [qualityScores]);

  // ── Annotation map (entity_id → description) ──
  const annotationMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of annotations) {
      if (a.description) m.set(a.entity_id, a.description);
    }
    return m;
  }, [annotations]);

  // ── Unique sources for chips ──
  const uniqueSources = useMemo(() => {
    const names = new Set(lzEntities.map((e) => e.SourceName).filter(Boolean));
    return Array.from(names).sort();
  }, [lzEntities]);

  // ── Toggle helpers ──
  const toggleSourceFilter = useCallback((source: string) => {
    setSourceFilters((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  }, []);

  const toggleTierFilter = useCallback((tier: QualityTier) => {
    setTierFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) {
        next.delete(tier);
      } else {
        next.add(tier);
      }
      return next;
    });
  }, []);

  // ── Filtered entities ──
  const filteredEntities = useMemo(() => {
    let result = lzEntities;

    if (sourceFilters.size > 0) {
      result = result.filter((e) => sourceFilters.has(e.SourceName));
    }

    if (tierFilters.size > 0) {
      result = result.filter((e) => {
        const score = qualityMap.get(e.LandingzoneEntityId);
        const tier = scoreToTier(score ?? null);
        return tierFilters.has(tier);
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.TableName?.toLowerCase().includes(q) ||
          e.SchemaName?.toLowerCase().includes(q) ||
          e.SourceName?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [lzEntities, sourceFilters, tierFilters, search, qualityMap]);

  return (
    <div className="p-8 max-w-[1280px]">
      <BusinessIntentHeader
        title="Catalog"
        meta={
          activeTab === "collections"
            ? `${domains.length.toLocaleString()} collections in scope`
            : `${lzEntities.length.toLocaleString()} source tables searchable`
        }
        summary={
          activeTab === "collections"
            ? "This page is the business-facing catalog of trusted collections and the broader source-table estate behind them. Start here when the user knows the business question but not the technical implementation."
            : "This page is the business-facing catalog of trusted collections and the broader source-table estate behind them. Start here when the user needs to find a specific table, quality signal, or source-backed asset."
        }
        items={[
          {
            label: "What This Page Is",
            value: activeTab === "collections" ? "Collection and dataset front door" : "Searchable table inventory",
            detail: activeTab === "collections"
              ? "Browse curated business collections first, then move into the deeper source inventory only when a business question requires raw table coverage."
              : "Search across source tables, filter by source and quality, and open individual data assets without navigating engineering-only screens.",
          },
          {
            label: "Why It Matters",
            value: "Discovery must feel trustworthy",
            detail: "If users cannot quickly tell what data exists and how trustworthy it is, every downstream request becomes slower, noisier, and more dependent on tribal knowledge.",
          },
          {
            label: "What Happens Next",
            value: "Open detail or raise a gap",
            detail: "Move into the item that looks relevant, then either use it confidently, verify its freshness and quality, or submit a request when the catalog does not yet cover the need.",
          },
        ]}
        links={[
          { label: "Open Overview", to: "/overview" },
          { label: "Browse Sources", to: "/sources-portal" },
          { label: "Submit a Request", to: "/requests" },
        ]}
      />

      {/* Tab Bar */}
      <div
        className="flex gap-0 mb-8"
        style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}
      >
        <TabButton
          label="Data Collections"
          active={activeTab === "collections"}
          onClick={() => setActiveTab("collections")}
        />
        <TabButton
          label="All Source Tables"
          active={activeTab === "tables"}
          onClick={() => setActiveTab("tables")}
        />
      </div>

      {/* Tab Content */}
      {activeTab === "collections" ? (
        <CollectionsTab
          domains={domains}
          loading={domainsLoading}
          error={domainsError}
          onSwitchToTables={() => setActiveTab("tables")}
        />
      ) : (
        <TablesTab
          entities={filteredEntities}
          totalCount={lzEntities.length}
          loading={tablesLoading}
          search={search}
          onSearchChange={setSearch}
          uniqueSources={uniqueSources}
          sourceFilters={sourceFilters}
          onToggleSource={toggleSourceFilter}
          tierFilters={tierFilters}
          onToggleTier={toggleTierFilter}
          qualityMap={qualityMap}
          annotationMap={annotationMap}
        />
      )}
    </div>
  );
}

// ── Tab Button ──

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-5 pb-3 text-[14px] font-medium transition-colors cursor-pointer relative"
      style={{
        background: "transparent",
        border: "none",
        color: active ? "var(--bp-copper)" : "var(--bp-ink-tertiary)",
        fontFamily: "var(--bp-font-body)",
      }}
    >
      {label}
      {active && (
        <span
          style={{
            position: "absolute",
            bottom: "-1px",
            left: 0,
            right: 0,
            height: "2px",
            background: "var(--bp-copper)",
            borderRadius: "1px 1px 0 0",
          }}
        />
      )}
    </button>
  );
}

// ── Collections Tab ──

function CollectionsTab({
  domains,
  loading,
  error,
  onSwitchToTables,
}: {
  domains: GoldDomain[];
  loading: boolean;
  error: boolean;
  onSwitchToTables: () => void;
}) {
  if (loading) return <DomainGridSkeleton />;

  if (error || domains.length === 0) {
    return (
      <div
        className="bp-card p-12 text-center"
        style={{ color: "var(--bp-ink-muted)" }}
      >
        <Layers className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <div
          className="text-[16px] font-medium mb-2"
          style={{ fontFamily: "var(--bp-font-body)", color: "var(--bp-ink-secondary)" }}
        >
          Data Collections are being set up
        </div>
        <div className="text-[13px] mb-4" style={{ fontFamily: "var(--bp-font-body)" }}>
          Browse{" "}
          <button
            onClick={onSwitchToTables}
            className="bp-link cursor-pointer"
            style={{ background: "none", border: "none", font: "inherit" }}
          >
            All Source Tables
          </button>
          {" "}in the meantime.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: "20px",
      }}
    >
      {domains.map((d) => (
        <DomainCard key={d.id} domain={d} />
      ))}
    </div>
  );
}

// ── Tables Tab ──

function TablesTab({
  entities,
  totalCount,
  loading,
  search,
  onSearchChange,
  uniqueSources,
  sourceFilters,
  onToggleSource,
  tierFilters,
  onToggleTier,
  qualityMap,
  annotationMap,
}: {
  entities: LZEntity[];
  totalCount: number;
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  uniqueSources: string[];
  sourceFilters: Set<string>;
  onToggleSource: (s: string) => void;
  tierFilters: Set<QualityTier>;
  onToggleTier: (t: QualityTier) => void;
  qualityMap: Map<number, number>;
  annotationMap: Map<number, string>;
}) {
  const tierOptions: { tier: QualityTier; label: string }[] = [
    { tier: "gold", label: "Gold" },
    { tier: "silver", label: "Silver" },
    { tier: "bronze", label: "Bronze" },
    { tier: "unscored", label: "Unscored" },
  ];

  return (
    <div>
      {/* Hero Search */}
      <div
        className="flex items-center gap-3 rounded-lg px-5 mb-5"
        style={{
          background: "var(--bp-surface-inset)",
          height: "48px",
        }}
      >
        <Search className="h-5 w-5 shrink-0" style={{ color: "var(--bp-ink-muted)" }} />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={`Search ${totalCount.toLocaleString()} tables...`}
          className="w-full bg-transparent outline-none text-[14px]"
          style={{
            color: "var(--bp-ink-primary)",
            fontFamily: "var(--bp-font-body)",
          }}
        />
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {/* Source chips */}
        {uniqueSources.map((src) => {
          const color = getSourceColor(src);
          const label = resolveSourceLabel(src);
          return (
            <SourceChip
              key={src}
              label={label}
              colorHex={color.hex}
              active={sourceFilters.has(src)}
              onClick={() => onToggleSource(src)}
            />
          );
        })}

        {/* Separator */}
        {uniqueSources.length > 0 && (
          <span
            style={{
              width: "1px",
              height: "20px",
              background: "var(--bp-border-subtle)",
              display: "inline-block",
              margin: "0 4px",
            }}
          />
        )}

        {/* Tier chips */}
        {tierOptions.map(({ tier, label }) => (
          <TierChip
            key={tier}
            tier={tier}
            label={label}
            active={tierFilters.has(tier)}
            onClick={() => onToggleTier(tier)}
          />
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <TableGridSkeleton />
      ) : entities.length === 0 ? (
        <div
          className="bp-card p-12 text-center"
          style={{ color: "var(--bp-ink-muted)" }}
        >
          <Database className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <div
            className="text-[15px] font-medium mb-1"
            style={{ fontFamily: "var(--bp-font-body)", color: "var(--bp-ink-secondary)" }}
          >
            {search || sourceFilters.size > 0 || tierFilters.size > 0
              ? "No tables match your filters"
              : "No tables found"}
          </div>
        </div>
      ) : (
        <>
          {/* Result count */}
          <div
            className="mb-4 text-[13px]"
            style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-body)" }}
          >
            {entities.length === totalCount
              ? `${totalCount.toLocaleString()} tables`
              : `${entities.length.toLocaleString()} of ${totalCount.toLocaleString()} tables`}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "20px",
            }}
          >
            {entities.slice(0, 120).map((entity) => (
              <TableCard
                key={entity.LandingzoneEntityId}
                entity={entity}
                qualityMap={qualityMap}
                description={annotationMap.get(entity.LandingzoneEntityId)}
              />
            ))}
          </div>

          {entities.length > 120 && (
            <div
              className="mt-6 text-center text-[13px]"
              style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-body)" }}
            >
              Showing 120 of {entities.length.toLocaleString()} tables. Use search or filters to narrow results.
            </div>
          )}
        </>
      )}
    </div>
  );
}
