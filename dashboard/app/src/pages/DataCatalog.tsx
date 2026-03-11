import { useState, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KpiCard, KpiRow } from "@/components/ui/kpi-card";
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
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        {/* Fixed header */}
        <div className="px-6 pt-6 pb-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-base pr-8">
              <Table2 className="h-5 w-5 text-[var(--cl-accent)] shrink-0" />
              <span className="font-mono truncate">{entity.tableName}</span>
            </DialogTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1.5 flex-wrap">
              <span className="font-mono text-foreground/70">{entity.sourceSchema}</span>
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
          <div className="flex gap-1 border-b mt-4">
            {(["overview", "columns", "lineage", "quality"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-3 py-2 text-xs font-medium border-b-2 transition-colors capitalize",
                  tab === t
                    ? "border-[var(--cl-accent)] text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
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
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Layer Coverage</h4>
                <div className="grid grid-cols-3 gap-3">
                  {layers.map((l) => {
                    const isLoaded = l.status === "loaded";
                    return (
                      <div
                        key={l.key}
                        className={cn(
                          "p-3 rounded-lg border transition-colors",
                          isLoaded ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted border-border"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <LayerBadge layer={l.key === "lz" ? "landing" : l.key} size="sm" />
                          {isLoaded ? (
                            <StatusBadge status="loaded" size="sm" />
                          ) : (
                            <span className="text-[10px] text-muted-foreground/60 italic">Not loaded</span>
                          )}
                        </div>
                        {l.loaded ? (
                          <p className="text-[10px] text-muted-foreground">{formatTimestamp(l.loaded, { relative: true })}</p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground/40">Awaiting first load</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Source Connection */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Source Connection</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-muted border">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Server</span>
                    <p className="font-mono mt-1 text-foreground">{entity.connection?.server || "—"}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted border">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Database</span>
                    <p className="font-mono mt-1 text-foreground">{entity.connection?.database || "—"}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted border">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Schema</span>
                    <p className="font-mono mt-1 text-foreground">{entity.sourceSchema}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted border">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Load Type</span>
                    <p className="font-mono mt-1 text-foreground">{entity.isIncremental ? "Incremental" : "Full"}</p>
                  </div>
                </div>
              </div>

              {/* Primary Keys — only show when we have real PK data */}
              {hasPKs && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Primary Keys</h4>
                  <div className="flex gap-1.5 flex-wrap">
                    {entity.bronzePKs.split(",").map((pk: string) => (
                      <span key={pk} className="text-[10px] font-mono px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {pk.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Entity metadata */}
              {(entity.watermarkColumn || entity.lastError) && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Metadata</h4>
                  <div className="space-y-2 text-xs">
                    {entity.watermarkColumn && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Watermark:</span>
                        <span className="font-mono text-foreground">{entity.watermarkColumn}</span>
                      </div>
                    )}
                    {entity.lastError && (
                      <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                        <span className="text-red-400 font-medium text-[10px] uppercase">Last Error</span>
                        <p className="font-mono text-red-300/80 mt-1 text-[11px] break-all">{typeof entity.lastError === "string" ? entity.lastError : entity.lastError.message ?? "Unknown error"}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "columns" && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <Columns3 className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-foreground/60">Column metadata not yet captured</p>
              <p className="text-xs mt-1.5 max-w-sm mx-auto">
                Schema capture runs automatically during Bronze/Silver loads.
                Check the <span className="font-mono text-[var(--cl-accent)]">integration.ColumnMetadata</span> table after the next run.
              </p>
            </div>
          )}

          {tab === "lineage" && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-foreground/60">Table-level lineage</p>
              <p className="text-xs mt-1.5">
                View this entity's full pipeline lineage on the{" "}
                <a href="/lineage" className="text-[var(--cl-accent)] underline hover:text-[var(--cl-accent)]/80">Data Lineage</a> page.
              </p>
            </div>
          )}

          {tab === "quality" && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-foreground/60">Quality scoring not configured</p>
              <p className="text-xs mt-1.5">
                DQ rules need to be set up first. See{" "}
                <a href="/labs/dq-scorecard" className="text-[var(--cl-accent)] underline hover:text-[var(--cl-accent)]/80">Labs → DQ Scorecard</a>.
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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-display font-semibold flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-[var(--cl-accent)]" /> Data Catalog
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Browse all registered entities with business context, ownership, and cross-references
        </p>
      </div>

      <KpiRow>
        <KpiCard label="Registered Entities" value={formatRowCount(allEntities.length)} icon={Database} iconColor="text-slate-400" />
        <KpiCard label="Data Sources" value={sources.length.toString()} icon={HardDrive} iconColor="text-blue-400" />
        <KpiCard label="Loaded" value={formatPercent(loadedPct, 0)} icon={Sparkles} iconColor="text-emerald-400" />
      </KpiRow>

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-400">Failed to load entity digest</p>
              <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
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
          <div className="col-span-3 text-center py-12 text-muted-foreground">No entities match your search.</div>
        ) : (
          filtered.slice(0, 150).map((e) => (
            <Card
              key={e.id}
              className="cursor-pointer hover:border-[var(--cl-accent)]/40 hover:shadow-md transition-all group"
              onClick={() => setSelectedEntity(e)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-medium truncate group-hover:text-[var(--cl-accent)] transition-colors">
                      {e.tableName}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{e.sourceSchema}</p>
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
                    <span className="text-[10px] text-muted-foreground">Not loaded</span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                  {e.lzLastLoad && <span>{formatTimestamp(e.lzLastLoad, { relative: true })}</span>}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      {filtered.length > 150 && (
        <p className="text-center text-xs text-muted-foreground">Showing first 150 of {filtered.length} entities. Use search to narrow results.</p>
      )}

      <EntityDetailModal entity={selectedEntity} open={!!selectedEntity} onClose={() => setSelectedEntity(null)} />
    </div>
  );
}
