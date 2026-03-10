import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { LayerBadge } from "@/components/ui/layer-badge";
import { KpiCard, KpiRow } from "@/components/ui/kpi-card";
import { formatTimestamp, formatRowCount } from "@/lib/formatters";
import { LAYERS, LAYER_MAP, getSourceColor } from "@/lib/layers";
import { resolveSourceLabel } from "@/hooks/useSourceConfig";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import {
  GitBranch, Search, ChevronRight, ChevronDown, Database, HardDrive,
  Table2, Sparkles, Crown, ArrowRight, Columns3, Filter, X, Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MedallionLayer, LineageRelationshipType } from "@/types/governance";

// ── Types ──

interface LayerColumn {
  name: string;
  dataType: string;
  isSystemColumn: boolean;
  isPrimaryKey: boolean;
}

interface EntityLineage {
  entityId: number;
  name: string;
  schema: string;
  dataSource: string;
  sourceServer?: string;
  sourceDatabase?: string;
  layers: {
    layer: MedallionLayer;
    entityId: number;
    status: string;
    lastLoaded?: string;
    rowCount?: number;
    columns: LayerColumn[];
  }[];
}

// ── Column Lineage Row ──

function ColumnLineageRow({ col, layers }: { col: string; layers: MedallionLayer[] }) {
  const isSystem = ["HashedPKColumn", "HashedNonKeyColumns", "IsDeleted", "IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate"].includes(col);
  const startsAt: MedallionLayer = isSystem
    ? (["IsDeleted", "IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "HashedNonKeyColumns"].includes(col) ? "silver" : "bronze")
    : "source";

  return (
    <div className="flex items-center gap-1 py-1 px-2 text-[11px] font-mono hover:bg-muted/50 rounded transition-colors">
      <span className={cn("w-48 truncate", isSystem ? "text-muted-foreground italic" : "text-foreground")}>{col}</span>
      {(["source", "landing", "bronze", "silver", "gold"] as MedallionLayer[]).map((layer) => {
        const present = layers.includes(layer);
        const isOrigin = layer === startsAt;
        const layerDef = LAYER_MAP[layer];
        return (
          <div key={layer} className="flex items-center gap-1">
            {layer !== "source" && (
              <ArrowRight className={cn("h-3 w-3", present ? "text-muted-foreground/60" : "text-muted-foreground/20")} />
            )}
            <div
              className={cn(
                "w-16 h-5 rounded text-center text-[9px] leading-5 font-medium border",
                present
                  ? isOrigin
                    ? "border-current font-semibold"
                    : "opacity-80"
                  : "bg-muted text-muted-foreground/30 border-transparent"
              )}
              style={present ? { color: layerDef?.color, backgroundColor: `${layerDef?.color}15`, borderColor: `${layerDef?.color}40` } : undefined}
            >
              {present ? (isSystem && isOrigin ? "NEW" : "✓") : "—"}
            </div>
          </div>
        );
      })}
      <span className={cn("ml-2 text-[9px] px-1.5 py-0.5 rounded", isSystem ? "bg-violet-500/10 text-violet-400" : "bg-blue-500/10 text-blue-400")}>
        {isSystem ? "computed" : "passthrough"}
      </span>
    </div>
  );
}

// ── Entity Lineage Detail Panel ──

function EntityLineageDetail({ entity, digest, onClose }: { entity: DigestEntity; digest: DigestEntity[]; onClose: () => void }) {
  const [columnView, setColumnView] = useState(false);
  const [columns, setColumns] = useState<{ layer: string; columns: string[] }[]>([]);
  const [loading, setLoading] = useState(false);

  const loadColumns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/microscope/${entity.id}`);
      if (res.ok) {
        const data = await res.json();
        // Extract column names from microscope data
        const layerCols: { layer: string; columns: string[] }[] = [];
        for (const layer of ["source", "landing", "bronze", "silver"]) {
          if (data[layer]?.columns) {
            layerCols.push({ layer, columns: data[layer].columns.map((c: { name: string }) => c.name) });
          }
        }
        setColumns(layerCols);
      }
    } catch { /* */ }
    setLoading(false);
  }, [entity.id]);

  useEffect(() => {
    if (columnView && columns.length === 0) loadColumns();
  }, [columnView, columns.length, loadColumns]);

  // All unique column names across all layers
  const allColumns = useMemo(() => {
    const set = new Set<string>();
    columns.forEach((lc) => lc.columns.forEach((c) => set.add(c)));
    return Array.from(set).sort((a, b) => {
      const aSystem = a.startsWith("Hashed") || ["IsDeleted", "IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate"].includes(a);
      const bSystem = b.startsWith("Hashed") || ["IsDeleted", "IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate"].includes(b);
      if (aSystem !== bSystem) return aSystem ? 1 : -1;
      return a.localeCompare(b);
    });
  }, [columns]);

  const availableLayers = useMemo(() => {
    const layers: MedallionLayer[] = ["source"];
    if (entity.lzStatus === "loaded") layers.push("landing");
    if (entity.bronzeStatus === "loaded") layers.push("bronze");
    if (entity.silverStatus === "loaded") layers.push("silver");
    return layers;
  }, [entity]);

  return (
    <Card className="border-l-2 border-l-[var(--cl-accent)]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-display">{entity.sourceSchema}.{entity.tableName}</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {resolveSourceLabel(entity.source)} · {entity.connection?.server}/{entity.connection?.database}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0"><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex gap-2 mt-2">
          <Button variant={!columnView ? "default" : "outline"} size="sm" className="text-xs h-7" onClick={() => setColumnView(false)}>
            <GitBranch className="h-3 w-3 mr-1" /> Table Lineage
          </Button>
          <Button variant={columnView ? "default" : "outline"} size="sm" className="text-xs h-7" onClick={() => setColumnView(true)}>
            <Columns3 className="h-3 w-3 mr-1" /> Column Lineage
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!columnView ? (
          // ── Table-level lineage ──
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {(["source", "landing", "bronze", "silver", "gold"] as MedallionLayer[]).map((layer, i) => {
                const isActive = availableLayers.includes(layer);
                const layerDef = LAYER_MAP[layer];
                const Icon = layerDef?.icon ?? Database;
                return (
                  <div key={layer} className="flex items-center gap-2">
                    {i > 0 && <ArrowRight className={cn("h-4 w-4", isActive ? "text-muted-foreground" : "text-muted-foreground/20")} />}
                    <div
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all",
                        isActive ? "shadow-sm" : "opacity-30"
                      )}
                      style={isActive ? { color: layerDef?.color, backgroundColor: `${layerDef?.color}10`, borderColor: `${layerDef?.color}30` } : undefined}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {layerDef?.label ?? layer}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="p-2 rounded bg-muted border">
                <span className="text-muted-foreground">LZ Status</span>
                <div className="mt-1"><StatusBadge status={entity.lzStatus || "none"} size="sm" /></div>
                {entity.lzLastLoad && <div className="text-[10px] text-muted-foreground mt-1">{formatTimestamp(entity.lzLastLoad, { relative: true })}</div>}
              </div>
              <div className="p-2 rounded bg-muted border">
                <span className="text-muted-foreground">Bronze Status</span>
                <div className="mt-1"><StatusBadge status={entity.bronzeStatus || "none"} size="sm" /></div>
                {entity.bronzeLastLoad && <div className="text-[10px] text-muted-foreground mt-1">{formatTimestamp(entity.bronzeLastLoad, { relative: true })}</div>}
              </div>
              <div className="p-2 rounded bg-muted border">
                <span className="text-muted-foreground">Silver Status</span>
                <div className="mt-1"><StatusBadge status={entity.silverStatus || "none"} size="sm" /></div>
                {entity.silverLastLoad && <div className="text-[10px] text-muted-foreground mt-1">{formatTimestamp(entity.silverLastLoad, { relative: true })}</div>}
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">
                Rows: —
              </div>
          </div>
        ) : (
          // ── Column-level lineage ──
          <div>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Loading column data...</div>
            ) : allColumns.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No column data available. Run a load first to capture schema.</div>
            ) : (
              <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
                <div className="flex items-center gap-1 py-1 px-2 text-[9px] font-medium text-muted-foreground uppercase tracking-wider sticky top-0 bg-card z-10">
                  <span className="w-48">Column</span>
                  {(["source", "landing", "bronze", "silver", "gold"] as MedallionLayer[]).map((layer) => (
                    <div key={layer} className="flex items-center gap-1">
                      {layer !== "source" && <span className="w-3" />}
                      <span className="w-16 text-center">{LAYER_MAP[layer]?.label?.slice(0, 6) ?? layer}</span>
                    </div>
                  ))}
                  <span className="ml-2 w-16">Type</span>
                </div>
                {allColumns.map((col) => {
                  const presentIn = columns.filter((lc) => lc.columns.includes(col)).map((lc) => lc.layer as MedallionLayer);
                  return <ColumnLineageRow key={col} col={col} layers={presentIn} />;
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ──

export default function DataLineage() {
  const { allEntities, loading: digestLoading } = useEntityDigest();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedEntity, setSelectedEntity] = useState<DigestEntity | null>(null);

  const sources = useMemo(() => {
    const s = new Set<string>();
    allEntities.forEach((e) => { if (e.source) s.add(e.source); });
    return Array.from(s).sort();
  }, [allEntities]);

  const filtered = useMemo(() => {
    return allEntities.filter((e) => {
      if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          e.tableName?.toLowerCase().includes(q) ||
          e.sourceSchema?.toLowerCase().includes(q) ||
          e.source?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allEntities, search, sourceFilter]);

  // KPI calculations
  const totalEntities = allEntities.length;
  const withLz = allEntities.filter((e) => e.lzStatus === "loaded").length;
  const withBronze = allEntities.filter((e) => e.bronzeStatus === "loaded").length;
  const withSilver = allEntities.filter((e) => e.silverStatus === "loaded").length;
  const fullChain = allEntities.filter((e) => e.lzStatus === "loaded" && e.bronzeStatus === "loaded" && e.silverStatus === "loaded").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-semibold flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-[var(--cl-accent)]" /> Data Lineage
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Trace entity data flow across the medallion architecture — Source → Landing Zone → Bronze → Silver → Gold
          </p>
        </div>
      </div>

      {/* KPIs */}
      <KpiRow>
        <KpiCard label="Total Entities" value={formatRowCount(totalEntities)} icon={Database} iconColor="text-slate-400" />
        <KpiCard label="Landing Zone" value={formatRowCount(withLz)} icon={HardDrive} iconColor="text-blue-400" subtitle={`${totalEntities ? ((withLz / totalEntities) * 100).toFixed(0) : 0}% coverage`} />
        <KpiCard label="Bronze" value={formatRowCount(withBronze)} icon={Table2} iconColor="text-amber-400" subtitle={`${totalEntities ? ((withBronze / totalEntities) * 100).toFixed(0) : 0}% coverage`} />
        <KpiCard label="Silver" value={formatRowCount(withSilver)} icon={Sparkles} iconColor="text-violet-400" subtitle={`${totalEntities ? ((withSilver / totalEntities) * 100).toFixed(0) : 0}% coverage`} />
        <KpiCard label="Full Chain" value={formatRowCount(fullChain)} icon={Crown} iconColor="text-emerald-400" subtitle="Source → Silver complete" />
      </KpiRow>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search entities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <div className="flex gap-1.5">
          <Button
            variant={sourceFilter === "all" ? "default" : "outline"}
            size="sm"
            className="text-xs h-7"
            onClick={() => setSourceFilter("all")}
          >
            All Sources
          </Button>
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
      </div>

      {/* Main content */}
      <div className={cn("grid gap-4", selectedEntity ? "grid-cols-[1fr_420px]" : "grid-cols-1")}>
        {/* Entity list */}
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-340px)] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10 border-b">
                  <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    <th className="text-left py-2 px-3 font-medium">Entity</th>
                    <th className="text-left py-2 px-3 font-medium">Source</th>
                    <th className="text-center py-2 px-2 font-medium">LZ</th>
                    <th className="text-center py-2 px-2 font-medium">Bronze</th>
                    <th className="text-center py-2 px-2 font-medium">Silver</th>
                    <th className="text-center py-2 px-2 font-medium">Gold</th>
                    <th className="text-right py-2 px-3 font-medium">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {digestLoading ? (
                    <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading entities...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No entities found</td></tr>
                  ) : (
                    filtered.map((e) => {
                      const isSelected = selectedEntity?.id === e.id;
                      return (
                        <tr
                          key={e.id}
                          className={cn(
                            "border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors",
                            isSelected && "bg-muted/50 border-l-2 border-l-[var(--cl-accent)]"
                          )}
                          onClick={() => setSelectedEntity(isSelected ? null : e)}
                        >
                          <td className="py-1.5 px-3">
                            <div className="font-mono text-xs">{e.tableName}</div>
                            <div className="text-[10px] text-muted-foreground">{e.sourceSchema}</div>
                          </td>
                          <td className="py-1.5 px-3">
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: getSourceColor(resolveSourceLabel(e.source)), backgroundColor: `${getSourceColor(resolveSourceLabel(e.source))}15` }}>
                              {resolveSourceLabel(e.source)}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-center"><StatusBadge status={e.lzStatus || "none"} size="sm" showIcon={false} /></td>
                          <td className="py-1.5 px-2 text-center"><StatusBadge status={e.bronzeStatus || "none"} size="sm" showIcon={false} /></td>
                          <td className="py-1.5 px-2 text-center"><StatusBadge status={e.silverStatus || "none"} size="sm" showIcon={false} /></td>
                          <td className="py-1.5 px-2 text-center"><StatusBadge status="none" size="sm" showIcon={false} label="—" /></td>
                          <td className="py-1.5 px-3 text-right font-mono text-xs text-muted-foreground">—</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Detail panel */}
        {selectedEntity && (
          <EntityLineageDetail
            entity={selectedEntity}
            digest={allEntities}
            onClose={() => setSelectedEntity(null)}
          />
        )}
      </div>
    </div>
  );
}
