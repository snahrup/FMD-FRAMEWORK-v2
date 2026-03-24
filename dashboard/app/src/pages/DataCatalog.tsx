import { useState, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
// KpiCard/KpiRow removed — replaced with inline tiered KPI layout
import { StatusBadge } from "@/components/ui/status-badge";
import { LayerBadge } from "@/components/ui/layer-badge";
import { formatRowCount, formatTimestamp, formatPercent } from "@/lib/formatters";
import { getSourceColor } from "@/lib/layers";
import { resolveSourceLabel } from "@/hooks/useSourceConfig";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import {
  BookOpen, Search, Database, Table2, HardDrive, Sparkles,
  ArrowUpDown, Columns3, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Entity Detail Modal ──
// Inspired by fabric_toolbox's TableDetailModal.tsx (802 lines)
// Tabs: Overview, Columns, Lineage, Quality

function EntityDetailModal({ entity, open, onClose }: { entity: DigestEntity | null; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "columns" | "lineage" | "quality">("overview");

  if (!entity) return null;

  const layers = [
    { key: "lz", label: "Landing Zone", status: entity.lzStatus, loaded: entity.lzLastLoad },
    { key: "bronze", label: "Bronze", status: entity.bronzeStatus, loaded: entity.bronzeLastLoad },
    { key: "silver", label: "Silver", status: entity.silverStatus, loaded: entity.silverLastLoad },
  ];

  const loadedLayers = layers.filter((l) => l.status === "loaded").length;
  const hasPKs = entity.bronzePKs && entity.bronzePKs.trim() !== "" && entity.bronzePKs.trim() !== "N/A";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden gs-modal-enter" style={{ backgroundColor: "var(--bp-surface-1)" }}>
        {/* Fixed header */}
        <div className="px-6 pt-6 pb-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base pr-8" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>
              <Table2 className="h-5 w-5 shrink-0" style={{ color: "var(--bp-copper)" }} />
              <span style={{ fontFamily: "var(--bp-font-mono)" }} className="truncate">{entity.tableName}</span>
            </DialogTitle>
            <div className="flex items-center gap-2 text-xs mt-1.5 flex-wrap" style={{ color: "var(--bp-ink-secondary)" }}>
              <span style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-primary)", opacity: 0.7 }}>{entity.sourceSchema}</span>
              <span>·</span>
              <span
                className="px-1.5 py-0.5 rounded font-medium"
                style={{ color: getSourceColor(resolveSourceLabel(entity.source)), backgroundColor: `${getSourceColor(resolveSourceLabel(entity.source))}15` }}
              >
                {resolveSourceLabel(entity.source)}
              </span>
              <span>·</span>
              <span>{loadedLayers}/3 layers</span>
              <span>·</span>
              <span>{entity.isIncremental ? "Incremental" : "Full Load"}</span>
            </div>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex gap-1 mt-4" style={{ borderBottom: "1px solid var(--bp-border)" }}>
            {(["overview", "columns", "lineage", "quality"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-3 py-2 transition-colors capitalize",
                  tab === t
                    ? "text-[var(--bp-ink-primary)]"
                    : "border-transparent hover:text-[var(--bp-ink-primary)]"
                )}
                style={{
                  fontSize: "14px",
                  fontWeight: tab === t ? 700 : 500,
                  borderBottom: tab === t ? "2.5px solid var(--bp-copper)" : "2.5px solid transparent",
                  color: tab === t ? "var(--bp-ink-primary)" : "var(--bp-ink-secondary)",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable tab content */}
        <div className="px-6 pb-6 pt-4 overflow-y-auto max-h-[60vh]">
          {tab === "overview" && (
            <div className="space-y-5">
              {/* Layer Coverage */}
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: "var(--bp-ink-tertiary)" }}>Layer Coverage</h4>
                <div className="grid grid-cols-3 gap-3">
                  {layers.map((l) => {
                    const isLoaded = l.status === "loaded";
                    return (
                      <div
                        key={l.key}
                        className="p-3 rounded-lg transition-colors"
                        style={{
                          border: isLoaded ? "1px solid var(--bp-operational)" : "1px solid var(--bp-border)",
                          backgroundColor: isLoaded ? "var(--bp-operational-light)" : "var(--bp-surface-inset)",
                          opacity: isLoaded ? 1 : 0.85,
                        }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <LayerBadge layer={l.key === "lz" ? "landing" : l.key} size="sm" />
                          {isLoaded ? (
                            <StatusBadge status="loaded" size="sm" />
                          ) : (
                            <span className="text-[10px] italic" style={{ color: "var(--bp-ink-muted)" }}>Not loaded</span>
                          )}
                        </div>
                        {l.loaded ? (
                          <p className="text-[10px]" style={{ color: "var(--bp-ink-secondary)" }}>{formatTimestamp(l.loaded, { relative: true })}</p>
                        ) : (
                          <p className="text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>Awaiting first load</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Source Connection */}
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: "var(--bp-ink-tertiary)" }}>Source Connection</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: "Server", value: entity.connection?.server || "\u2014" },
                    { label: "Database", value: entity.connection?.database || "\u2014" },
                    { label: "Schema", value: entity.sourceSchema },
                    { label: "Load Type", value: entity.isIncremental ? "Incremental" : "Full" },
                  ].map((item) => (
                    <div key={item.label} className="p-2.5 rounded-lg" style={{ backgroundColor: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
                      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>{item.label}</span>
                      <p className="mt-1" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-primary)" }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Primary Keys — only show when we have real PK data */}
              {hasPKs && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: "var(--bp-ink-tertiary)" }}>Primary Keys</h4>
                  <div className="flex gap-1.5 flex-wrap">
                    {entity.bronzePKs.split(",").map((pk: string) => (
                      <span key={pk} className="text-[10px] px-2 py-1 rounded-md" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-copper)", backgroundColor: "var(--bp-copper-light)", border: "1px solid var(--bp-copper)", borderColor: "rgba(180, 86, 36, 0.2)" }}>
                        {pk.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Entity metadata */}
              {(entity.watermarkColumn || entity.lastError) && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: "var(--bp-ink-tertiary)" }}>Metadata</h4>
                  <div className="space-y-2 text-xs">
                    {entity.watermarkColumn && (
                      <div className="flex items-center gap-2">
                        <span style={{ color: "var(--bp-ink-secondary)" }}>Watermark:</span>
                        <span style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-primary)" }}>{entity.watermarkColumn}</span>
                      </div>
                    )}
                    {entity.lastError && (
                      <div className="p-2.5 rounded-lg" style={{ backgroundColor: "var(--bp-fault-light)", border: "1px solid var(--bp-fault)", borderColor: "rgba(185, 58, 42, 0.2)" }}>
                        <span className="font-medium text-[10px] uppercase" style={{ color: "var(--bp-fault)" }}>Last Error</span>
                        <p className="mt-1 text-[11px] break-all" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-fault)", opacity: 0.8 }}>{typeof entity.lastError === "string" ? entity.lastError : entity.lastError.message ?? "Unknown error"}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "columns" && (
            <div className="text-center py-10 text-sm" style={{ color: "var(--bp-ink-secondary)" }}>
              <Columns3 className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>Column metadata not yet captured</p>
              <p className="text-xs mt-1.5 max-w-sm mx-auto">
                Schema capture runs automatically during Bronze/Silver loads.
                Check the <span style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-copper)" }}>integration.ColumnMetadata</span> table after the next run.
              </p>
            </div>
          )}

          {tab === "lineage" && (
            <div className="text-center py-10 text-sm" style={{ color: "var(--bp-ink-secondary)" }}>
              <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>Table-level lineage</p>
              <p className="text-xs mt-1.5">
                View this entity's full pipeline lineage on the{" "}
                <a href="/lineage" style={{ color: "var(--bp-copper)" }} className="underline hover:opacity-80">Data Lineage</a> page.
              </p>
            </div>
          )}

          {tab === "quality" && (
            <div className="text-center py-10 text-sm" style={{ color: "var(--bp-ink-secondary)" }}>
              <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>Quality scoring not configured</p>
              <p className="text-xs mt-1.5">
                DQ rules need to be set up first. See{" "}
                <a href="/labs/dq-scorecard" style={{ color: "var(--bp-copper)" }} className="underline hover:opacity-80">Labs &rarr; DQ Scorecard</a>.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──

export default function DataCatalog() {
  const { allEntities, loading, error } = useEntityDigest();
  const hasLoadedOnce = useRef(false);
  if (!loading && allEntities.length > 0) hasLoadedOnce.current = true;
  const showSkeleton = loading && !hasLoadedOnce.current;
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"name" | "source">("name");
  const [selectedEntity, setSelectedEntity] = useState<DigestEntity | null>(null);

  const sources = useMemo(() => {
    const s = new Set<string>();
    allEntities.forEach((e) => { if (e.source) s.add(e.source); });
    return Array.from(s).sort();
  }, [allEntities]);

  const filtered = useMemo(() => {
    let result = allEntities.filter((e) => {
      if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return e.tableName?.toLowerCase().includes(q) || e.sourceSchema?.toLowerCase().includes(q) || e.source?.toLowerCase().includes(q);
      }
      return true;
    });

    result.sort((a, b) => {
      if (sortKey === "name") return (a.tableName ?? "").localeCompare(b.tableName ?? "");
      if (sortKey === "source") return (a.source ?? "").localeCompare(b.source ?? "");
      return 0;
    });

    return result;
  }, [allEntities, search, sourceFilter, sortKey]);

  const loadedPct = allEntities.length > 0 ? (allEntities.filter((e) => e.lzStatus === "loaded").length / allEntities.length) * 100 : 0;

  return (
    <div className="space-y-6 gs-page-enter" style={{ padding: "32px", maxWidth: "1280px" }}>
      <div>
        <h1 style={{ fontFamily: "var(--bp-font-display)", fontSize: "32px", color: "var(--bp-ink-primary)", lineHeight: "1.1" }} className="flex items-center gap-2">
          <BookOpen className="h-7 w-7" style={{ color: "var(--bp-copper)" }} /> Data Catalog
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--bp-ink-secondary)" }}>
          Browse all registered entities with business context, ownership, and cross-references
        </p>
      </div>

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Registered Entities", value: formatRowCount(allEntities.length), icon: Database },
          { label: "Loaded", value: formatPercent(loadedPct, 0), icon: Sparkles, sub: "across all layers" },
        ].map((kpi, i) => (
          <div
            key={kpi.label}
            className="gs-hero-enter rounded-lg p-4"
            style={{ '--i': i, backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" } as React.CSSProperties}
          >
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon className="h-4 w-4" style={{ color: "var(--bp-ink-muted)" }} />
              <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>{kpi.label}</span>
            </div>
            <div style={{ fontFamily: "var(--bp-font-display)", fontSize: "36px", color: "var(--bp-ink-primary)", lineHeight: 1.1 }}>{kpi.value}</div>
            {kpi.sub && <div className="text-[11px] mt-1" style={{ color: "var(--bp-ink-secondary)" }}>{kpi.sub}</div>}
          </div>
        ))}
      </div>

      {/* Supporting KPI */}
      <div className="grid grid-cols-1 gap-3 max-w-md">
        <div
          className="gs-stagger-row rounded-lg px-4 py-2.5 flex items-center justify-between"
          style={{ '--i': 0, backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" } as React.CSSProperties}
        >
          <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>Data Sources</span>
          <span style={{ fontFamily: "var(--bp-font-body)", fontSize: "14px", color: "var(--bp-ink-primary)", fontWeight: 600 }}>{sources.length}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--bp-ink-muted)" }} />
          <Input placeholder="Search entities, schemas, sources..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <div className="flex gap-1.5">
          <Button variant={sourceFilter === "all" ? "default" : "outline"} size="sm" className="text-xs h-7" onClick={() => setSourceFilter("all")}>All</Button>
          {sources.map((s) => (
            <Button
              key={s}
              variant={sourceFilter === s ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setSourceFilter(s)}
              style={sourceFilter === s ? { backgroundColor: getSourceColor(resolveSourceLabel(s)) } : undefined}
            >
              {resolveSourceLabel(s)}
            </Button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {(["name", "source"] as const).map((k) => (
            <Button key={k} variant={sortKey === k ? "default" : "ghost"} size="sm" className="text-[10px] h-6" onClick={() => setSortKey(k)}>
              <ArrowUpDown className="h-3 w-3 mr-0.5" /> {k}
            </Button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && !hasLoadedOnce.current && (
        <Card style={{ border: "1px solid rgba(185, 58, 42, 0.3)", backgroundColor: "var(--bp-fault-light)" }}>
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0" style={{ color: "var(--bp-fault)" }} />
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--bp-fault)" }}>Failed to load entity digest</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--bp-ink-secondary)" }}>{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entity Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {showSkeleton ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 h-24" />
            </Card>
          ))
        ) : filtered.length === 0 ? (
          <div className="col-span-3 text-center py-12" style={{ color: "var(--bp-ink-muted)" }}>
            <Search className="h-8 w-8 mx-auto mb-3 gs-float" style={{ color: "var(--bp-ink-muted)", opacity: 0.3 }} />
            No entities match your search.
          </div>
        ) : (
          filtered.slice(0, 150).map((e, index) => (
            <Card
              key={e.id}
              className="cursor-pointer transition-all group gs-stagger-card"
              style={{ '--i': index <= 15 ? index : undefined, backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" } as React.CSSProperties}
              onClick={() => setSelectedEntity(e)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate transition-colors group-hover:text-[var(--bp-copper)]" style={{ fontFamily: "var(--bp-font-mono)" }}>
                      {e.tableName}
                    </p>
                    <p className="text-[10px] truncate" style={{ color: "var(--bp-ink-muted)" }}>{e.sourceSchema}</p>
                  </div>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
                    style={{ color: getSourceColor(resolveSourceLabel(e.source)), backgroundColor: `${getSourceColor(resolveSourceLabel(e.source))}15` }}
                  >
                    {resolveSourceLabel(e.source)}
                  </span>
                </div>
                <div className="flex gap-1 mt-2">
                  {e.lzStatus === "loaded" && <LayerBadge layer="landing" size="sm" showIcon={false} />}
                  {e.bronzeStatus === "loaded" && <LayerBadge layer="bronze" size="sm" showIcon={false} />}
                  {e.silverStatus === "loaded" && <LayerBadge layer="silver" size="sm" showIcon={false} />}
                  {!e.lzStatus && !e.bronzeStatus && !e.silverStatus && (
                    <span className="text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>Not loaded</span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-2 text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>
                  {e.lzLastLoad && <span>{formatTimestamp(e.lzLastLoad, { relative: true })}</span>}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      {filtered.length > 150 && (
        <p className="text-center text-xs" style={{ color: "var(--bp-ink-muted)" }}>Showing first 150 of {filtered.length} entities. Use search to narrow results.</p>
      )}

      <EntityDetailModal entity={selectedEntity} open={!!selectedEntity} onClose={() => setSelectedEntity(null)} />
    </div>
  );
}
