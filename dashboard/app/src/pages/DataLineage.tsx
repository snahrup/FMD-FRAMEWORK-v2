import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { KpiCard, KpiRow } from "@/components/ui/kpi-card";
import { formatTimestamp, formatRowCount } from "@/lib/formatters";
import { LAYER_MAP, getSourceColor } from "@/lib/layers";
import { resolveSourceLabel } from "@/hooks/useSourceConfig";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import {
  GitBranch, Search, Database, HardDrive,
  Table2, Sparkles, Crown, ArrowRight, Columns3, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MedallionLayer } from "@/types/governance";

// ── Column Lineage Row ──

function ColumnLineageRow({ col, layers }: { col: string; layers: MedallionLayer[] }) {
  const isSystem = ["HashedPKColumn", "HashedNonKeyColumns", "IsDeleted", "IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate"].includes(col);
  const startsAt: MedallionLayer = isSystem
    ? (["IsDeleted", "IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "HashedNonKeyColumns"].includes(col) ? "silver" : "bronze")
    : "source";

  return (
    <div className="flex items-center gap-1 py-1 px-2 text-[11px] rounded transition-colors" style={{ fontFamily: "var(--bp-font-mono)" }}>
      <span className={cn("w-48 truncate", isSystem ? "italic" : "")} style={{ color: isSystem ? "var(--bp-ink-secondary)" : "var(--bp-ink-primary)" }}>{col}</span>
      {(["source", "landing", "bronze", "silver", "gold"] as MedallionLayer[]).map((layer) => {
        const present = layers.includes(layer);
        const isOrigin = layer === startsAt;
        const layerDef = LAYER_MAP[layer];
        return (
          <div key={layer} className="flex items-center gap-1">
            {layer !== "source" && (
              <ArrowRight className={cn("h-3 w-3")} style={{ color: present ? "var(--bp-ink-muted)" : "var(--bp-border)" }} />
            )}
            <div
              className={cn(
                "w-16 h-5 rounded text-center text-[9px] leading-5 font-medium",
                present
                  ? isOrigin
                    ? "font-semibold"
                    : "opacity-80"
                  : ""
              )}
              style={present ? { color: layerDef?.color, backgroundColor: `${layerDef?.color}15`, border: `1px solid ${layerDef?.color}40` } : { backgroundColor: "var(--bp-surface-inset)", color: "var(--bp-ink-muted)", opacity: 0.3, border: "1px solid transparent" }}
            >
              {present ? (isSystem && isOrigin ? "NEW" : "\u2713") : "\u2014"}
            </div>
          </div>
        );
      })}
      <span
        className="ml-2 text-[9px] px-1.5 py-0.5 rounded"
        style={isSystem
          ? { backgroundColor: "var(--bp-silver-light)", color: "var(--bp-silver)" }
          : { backgroundColor: "var(--bp-copper-light)", color: "var(--bp-copper)" }
        }
      >
        {isSystem ? "computed" : "passthrough"}
      </span>
    </div>
  );
}

// ── Entity Lineage Detail Panel ──

function EntityLineageDetail({ entity, onClose }: { entity: DigestEntity; onClose: () => void }) {
  const [columnView, setColumnView] = useState(false);
  const [columns, setColumns] = useState<{ layer: string; columns: string[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadColumns = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/lineage/columns/${entity.id}`, { signal: controller.signal });
      if (!res.ok) {
        setFetchError(`API returned ${res.status}`);
        setLoading(false);
        return;
      }
      let data: Record<string, { columns?: { name: string }[] }>;
      try {
        data = await res.json();
      } catch {
        setFetchError("Invalid JSON response");
        setLoading(false);
        return;
      }
      const layerCols: { layer: string; columns: string[] }[] = [];
      for (const layer of ["source", "landing", "bronze", "silver"]) {
        if (data[layer]?.columns) {
          layerCols.push({ layer, columns: data[layer].columns.map((c) => c.name) });
        }
      }
      if (!controller.signal.aborted) {
        setColumns(layerCols);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setFetchError("Failed to load column data");
    }
    if (!controller.signal.aborted) {
      setLoading(false);
    }
  }, [entity.id]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (columnView && columns.length === 0) loadColumns();
  }, [columnView, columns.length, loadColumns]);

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
    <Card style={{ borderLeft: "2px solid var(--bp-copper)", backgroundColor: "var(--bp-surface-1)" }}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>{entity.sourceSchema}.{entity.tableName}</CardTitle>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--bp-ink-secondary)" }}>
              {resolveSourceLabel(entity.source)}{entity.connection ? ` \u00b7 ${entity.connection.server}/${entity.connection.database}` : ""}
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
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {(["source", "landing", "bronze", "silver", "gold"] as MedallionLayer[]).map((layer, i) => {
                const isActive = availableLayers.includes(layer);
                const layerDef = LAYER_MAP[layer];
                const Icon = layerDef?.icon ?? Database;
                return (
                  <div key={layer} className="flex items-center gap-2">
                    {i > 0 && <ArrowRight className={cn("h-4 w-4")} style={{ color: isActive ? "var(--bp-ink-secondary)" : "var(--bp-ink-muted)" }} />}
                    <div
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all",
                        isActive ? "" : "opacity-30"
                      )}
                      style={isActive ? { color: layerDef?.color, backgroundColor: `${layerDef?.color}10`, border: `1px solid ${layerDef?.color}30` } : { border: "1px solid var(--bp-border)" }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {layerDef?.label ?? layer}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              {[
                { label: "LZ Status", status: entity.lzStatus, lastLoad: entity.lzLastLoad },
                { label: "Bronze Status", status: entity.bronzeStatus, lastLoad: entity.bronzeLastLoad },
                { label: "Silver Status", status: entity.silverStatus, lastLoad: entity.silverLastLoad },
              ].map((item) => (
                <div key={item.label} className="p-2 rounded" style={{ backgroundColor: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
                  <span style={{ color: "var(--bp-ink-secondary)" }}>{item.label}</span>
                  <div className="mt-1"><StatusBadge status={item.status || "none"} size="sm" /></div>
                  {item.lastLoad && <div className="text-[10px] mt-1" style={{ color: "var(--bp-ink-muted)" }}>{formatTimestamp(item.lastLoad, { relative: true })}</div>}
                </div>
              ))}
            </div>
            <div className="text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
                Rows: \u2014
              </div>
          </div>
        ) : (
          <div>
            {loading ? (
              <div className="text-center py-8 text-sm" style={{ color: "var(--bp-ink-secondary)" }}>Loading column data...</div>
            ) : fetchError ? (
              <div className="text-center py-8 text-sm" style={{ color: "var(--bp-fault)" }}>{fetchError}</div>
            ) : allColumns.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: "var(--bp-ink-secondary)" }}>No column data available. Run a load first to capture schema.</div>
            ) : (
              <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
                <div className="flex items-center gap-1 py-1 px-2 text-[9px] font-medium uppercase tracking-wider sticky top-0 z-10" style={{ color: "var(--bp-ink-tertiary)", backgroundColor: "var(--bp-surface-1)" }}>
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
    <div className="space-y-6" style={{ padding: "32px", maxWidth: "1280px" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 style={{ fontFamily: "var(--bp-font-display)", fontSize: "32px", color: "var(--bp-ink-primary)", lineHeight: "1.1" }} className="flex items-center gap-2">
            <GitBranch className="h-7 w-7" style={{ color: "var(--bp-copper)" }} /> Data Lineage
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--bp-ink-secondary)" }}>
            Trace entity data flow across the medallion architecture — Source &rarr; Landing Zone &rarr; Bronze &rarr; Silver &rarr; Gold
          </p>
        </div>
      </div>

      {/* KPIs */}
      <KpiRow>
        <KpiCard label="Total Entities" value={formatRowCount(totalEntities)} icon={Database} iconColor="text-[var(--bp-ink-muted)]" />
        <KpiCard label="Landing Zone" value={formatRowCount(withLz)} icon={HardDrive} iconColor="text-[var(--bp-ink-muted)]" subtitle={`${totalEntities ? ((withLz / totalEntities) * 100).toFixed(0) : 0}% coverage`} />
        <KpiCard label="Bronze" value={formatRowCount(withBronze)} icon={Table2} iconColor="text-[var(--bp-copper-hover)]" subtitle={`${totalEntities ? ((withBronze / totalEntities) * 100).toFixed(0) : 0}% coverage`} />
        <KpiCard label="Silver" value={formatRowCount(withSilver)} icon={Sparkles} iconColor="text-[var(--bp-silver)]" subtitle={`${totalEntities ? ((withSilver / totalEntities) * 100).toFixed(0) : 0}% coverage`} />
        <KpiCard label="Full Chain" value={formatRowCount(fullChain)} icon={Crown} iconColor="text-[var(--bp-operational)]" subtitle="Source \u2192 Silver complete" />
      </KpiRow>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--bp-ink-muted)" }} />
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
        <Card style={{ backgroundColor: "var(--bp-surface-1)" }}>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-340px)] overflow-y-auto">
              <table className="w-full text-sm" style={{ fontFamily: "var(--bp-font-mono)" }}>
                <thead className="sticky top-0 z-10" style={{ backgroundColor: "var(--bp-surface-1)", borderBottom: "1px solid var(--bp-border)" }}>
                  <tr className="text-[10px] uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>
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
                    <tr><td colSpan={7} className="text-center py-8" style={{ color: "var(--bp-ink-secondary)" }}>Loading entities...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8" style={{ color: "var(--bp-ink-secondary)" }}>No entities found</td></tr>
                  ) : (
                    filtered.map((e) => {
                      const isSelected = selectedEntity?.id === e.id;
                      return (
                        <tr
                          key={e.id}
                          className="cursor-pointer transition-colors"
                          style={{
                            borderBottom: "1px solid var(--bp-border-subtle)",
                            ...(isSelected ? { backgroundColor: "var(--bp-surface-inset)", borderLeft: "2px solid var(--bp-copper)" } : {}),
                          }}
                          onClick={() => setSelectedEntity(isSelected ? null : e)}
                        >
                          <td className="py-1.5 px-3">
                            <div className="text-xs" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-primary)" }}>{e.tableName}</div>
                            <div className="text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>{e.sourceSchema}</div>
                          </td>
                          <td className="py-1.5 px-3">
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: getSourceColor(resolveSourceLabel(e.source)), backgroundColor: `${getSourceColor(resolveSourceLabel(e.source))}15` }}>
                              {resolveSourceLabel(e.source)}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-center"><StatusBadge status={e.lzStatus || "none"} size="sm" showIcon={false} /></td>
                          <td className="py-1.5 px-2 text-center"><StatusBadge status={e.bronzeStatus || "none"} size="sm" showIcon={false} /></td>
                          <td className="py-1.5 px-2 text-center"><StatusBadge status={e.silverStatus || "none"} size="sm" showIcon={false} /></td>
                          <td className="py-1.5 px-2 text-center"><StatusBadge status="none" size="sm" showIcon={false} label="\u2014" /></td>
                          <td className="py-1.5 px-3 text-right text-xs" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-muted)" }}>\u2014</td>
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
            onClose={() => setSelectedEntity(null)}
          />
        )}
      </div>
    </div>
  );
}
