import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KpiCard, KpiRow } from "@/components/ui/kpi-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { LayerBadge } from "@/components/ui/layer-badge";
import { formatRowCount, formatPercent } from "@/lib/formatters";
import { LAYER_MAP, getSourceColor } from "@/lib/layers";
import { resolveSourceLabel } from "@/hooks/useSourceConfig";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import {
  Zap, Search, ArrowRight,
  AlertTriangle, GitBranch, Database, Table2, Sparkles,
  Download, HardDrive, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MedallionLayer } from "@/types/governance";

// ── Impact trace for an entity ──
// Since LZ→Bronze→Silver is 1:1, every entity's "impact" is deterministic:
// changing the source affects LZ, Bronze, Silver (and eventually Gold).

interface ImpactResult {
  origin: DigestEntity;
  impactedLayers: Array<{
    layer: MedallionLayer;
    status: string;
    rowCount?: number;
    isActive: boolean;
  }>;
  totalDownstream: number;
}

function computeImpact(entity: DigestEntity): ImpactResult {
  const layers: ImpactResult["impactedLayers"] = [
    { layer: "source", status: "origin", rowCount: undefined, isActive: true },
    { layer: "landing", status: entity.lzStatus || "not_started", rowCount: undefined, isActive: entity.lzStatus === "loaded" },
    { layer: "bronze", status: entity.bronzeStatus || "not_started", rowCount: undefined, isActive: entity.bronzeStatus === "loaded" },
    { layer: "silver", status: entity.silverStatus || "not_started", rowCount: undefined, isActive: entity.silverStatus === "loaded" },
    { layer: "gold", status: "not_started", rowCount: undefined, isActive: false },
  ];
  return {
    origin: entity,
    impactedLayers: layers,
    totalDownstream: layers.filter((l) => l.isActive && l.layer !== "source").length,
  };
}

// ── Impact visualization ──

function ImpactChain({ result }: { result: ImpactResult }) {
  return (
    <div className="space-y-4">
      {/* Visual chain */}
      <div className="flex items-center gap-2 flex-wrap">
        {result.impactedLayers.map((l, i) => {
          const layerDef = LAYER_MAP[l.layer];
          const Icon = layerDef?.icon ?? Database;
          const isOrigin = l.layer === "source";
          return (
            <div key={l.layer} className="flex items-center gap-2">
              {i > 0 && (
                <ArrowRight className={cn("h-4 w-4", l.isActive ? "text-amber-400" : "text-muted-foreground/20")} />
              )}
              <div
                className={cn(
                  "flex flex-col items-center gap-1 px-4 py-3 rounded-lg border text-xs font-medium transition-all min-w-[90px]",
                  isOrigin && "ring-2 ring-[var(--cl-accent)] ring-offset-2 ring-offset-background",
                  l.isActive ? "shadow-sm" : "opacity-30"
                )}
                style={l.isActive || isOrigin ? { color: layerDef?.color, backgroundColor: `${layerDef?.color}10`, borderColor: `${layerDef?.color}30` } : undefined}
              >
                <Icon className="h-4 w-4" />
                <span>{layerDef?.label ?? l.layer}</span>
                {l.isActive && !isOrigin && (
                  <span className="text-[9px] text-amber-400 font-semibold">IMPACTED</span>
                )}
                {isOrigin && (
                  <span className="text-[9px] text-[var(--cl-accent)] font-semibold">ORIGIN</span>
                )}
                {l.rowCount != null && (
                  <span className="text-[9px] font-mono text-muted-foreground">{formatRowCount(l.rowCount)} rows</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Impact summary */}
      <div className="p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
          <div>
            <p className="text-sm font-medium">
              {result.totalDownstream} downstream layer{result.totalDownstream !== 1 ? "s" : ""} affected
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              A schema or data change to <span className="font-mono">{result.origin.sourceSchema}.{result.origin.tableName}</span> in
              <span style={{ color: getSourceColor(resolveSourceLabel(result.origin.source)) }}> {resolveSourceLabel(result.origin.source)}</span> would
              propagate through {result.impactedLayers.filter((l) => l.isActive && l.layer !== "source").map((l) => LAYER_MAP[l.layer]?.label).join(" → ")}.
              {result.origin.silverStatus === "loaded" && " All downstream SCD2 records in Silver would need reprocessing."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──

export default function ImpactAnalysis() {
  const { allEntities, loading } = useEntityDigest();
  const [search, setSearch] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<DigestEntity | null>(null);
  const [impactResult, setImpactResult] = useState<ImpactResult | null>(null);

  const suggestions = useMemo(() => {
    if (!search || search.length < 2) return [];
    const q = search.toLowerCase();
    return allEntities
      .filter((e) => e.tableName?.toLowerCase().includes(q) || e.sourceSchema?.toLowerCase().includes(q))
      .slice(0, 10);
  }, [allEntities, search]);

  const handleSelect = useCallback((entity: DigestEntity) => {
    setSelectedEntity(entity);
    setImpactResult(computeImpact(entity));
    setSearch("");
  }, []);

  const exportReport = useCallback(() => {
    if (!impactResult) return;
    const e = impactResult.origin;
    const lines = [
      `# Impact Analysis Report`,
      `## Origin: ${e.sourceSchema}.${e.tableName}`,
      `- **Source**: ${resolveSourceLabel(e.source)} (${e.connection?.server ?? "—"}/${e.connection?.database ?? "—"})`,
      `- **Downstream layers affected**: ${impactResult.totalDownstream}`,
      ``,
      `## Layer Impact`,
      ...impactResult.impactedLayers.map((l) => {
        const label = LAYER_MAP[l.layer]?.label ?? l.layer;
        return `- **${label}**: ${l.isActive ? "IMPACTED" : "Not active"} ${l.rowCount != null ? `(${formatRowCount(l.rowCount)} rows)` : ""}`;
      }),
      ``,
      `## Notes`,
      `- Column-level impact analysis will be available after the ColumnLineage table is populated.`,
      `- Gold layer impact will be available after MLVs are defined.`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `impact-${e.tableName}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [impactResult]);

  // KPIs
  const fullChain = allEntities.filter((e) => e.lzStatus === "loaded" && e.bronzeStatus === "loaded" && e.silverStatus === "loaded").length;
  const partialChain = allEntities.filter((e) => e.lzStatus === "loaded" && (e.bronzeStatus !== "loaded" || e.silverStatus !== "loaded")).length;
  const notStarted = allEntities.filter((e) => !e.lzStatus || e.lzStatus === "not_started").length;
  const withErrors = allEntities.filter((e) => e.lastError).length;

  // Source breakdown
  const sourceBreakdown = useMemo(() => {
    const map = new Map<string, { source: string; total: number; lz: number; bronze: number; silver: number; fullChain: number; errors: number }>();
    allEntities.forEach((e) => {
      const src = e.source || "unknown";
      if (!map.has(src)) map.set(src, { source: src, total: 0, lz: 0, bronze: 0, silver: 0, fullChain: 0, errors: 0 });
      const entry = map.get(src)!;
      entry.total++;
      if (e.lzStatus === "loaded") entry.lz++;
      if (e.bronzeStatus === "loaded") entry.bronze++;
      if (e.silverStatus === "loaded") entry.silver++;
      if (e.lzStatus === "loaded" && e.bronzeStatus === "loaded" && e.silverStatus === "loaded") entry.fullChain++;
      if (e.lastError) entry.errors++;
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [allEntities]);

  // Highest-risk entities — those with errors or partial chains
  const riskEntities = useMemo(() => {
    return allEntities
      .filter((e) => e.lastError || (e.lzStatus === "loaded" && (e.bronzeStatus !== "loaded" || e.silverStatus !== "loaded")))
      .slice(0, 10);
  }, [allEntities]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-display font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5 text-[var(--cl-accent)]" /> Impact Analysis
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Analyze downstream impact when a source entity changes — what breaks if this table is modified?
        </p>
      </div>

      <KpiRow>
        <KpiCard label="Total Entities" value={formatRowCount(allEntities.length)} icon={Database} iconColor="text-slate-400" />
        <KpiCard label="Full Chain" value={formatRowCount(fullChain)} icon={GitBranch} iconColor="text-emerald-400" subtitle="LZ + Bronze + Silver" />
        <KpiCard label="Partial Chain" value={formatRowCount(partialChain)} icon={Layers} iconColor="text-amber-400" subtitle="Missing downstream layers" />
        <KpiCard label="Not Started" value={formatRowCount(notStarted)} icon={AlertTriangle} iconColor="text-slate-400" subtitle="No loads yet" />
      </KpiRow>

      {/* Entity Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Select an Entity to Analyze</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Type an entity name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
            {suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-lg shadow-lg z-20 max-h-64 overflow-y-auto">
                {suggestions.map((e) => (
                  <button
                    key={e.id}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-center justify-between"
                    onClick={() => handleSelect(e)}
                  >
                    <div>
                      <span className="font-mono text-xs">{e.tableName}</span>
                      <span className="text-[10px] text-muted-foreground ml-2">{e.sourceSchema}</span>
                    </div>
                    <span className="text-[10px]" style={{ color: getSourceColor(resolveSourceLabel(e.source)) }}>
                      {resolveSourceLabel(e.source)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedEntity && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Selected:</span>
              <span className="font-mono font-medium">{selectedEntity.sourceSchema}.{selectedEntity.tableName}</span>
              <span style={{ color: getSourceColor(resolveSourceLabel(selectedEntity.source)) }}>
                ({resolveSourceLabel(selectedEntity.source)})
              </span>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-1" onClick={() => { setSelectedEntity(null); setImpactResult(null); }}>
                <span className="text-muted-foreground text-xs">×</span>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Impact Results */}
      {impactResult && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Impact Trace</CardTitle>
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={exportReport}>
                <Download className="h-3 w-3 mr-1" /> Export Report
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ImpactChain result={impactResult} />
          </CardContent>
        </Card>
      )}

      {/* Column-level coming soon */}
      {impactResult && (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center">
            <Sparkles className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Column-level impact analysis coming in Phase 2 — requires <code className="font-mono bg-muted px-1 rounded text-xs">ColumnLineage</code> table population.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Claude via Foundry (Phase 3) will add natural language impact queries: &quot;What reports break if OKCUNO changes format?&quot;
            </p>
          </CardContent>
        </Card>
      )}

      {/* Source Impact Overview — always visible */}
      {!impactResult && !loading && sourceBreakdown.length > 0 && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                Source Impact Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-4">
                Each source system feeds entities through the medallion pipeline. If a source schema changes, every downstream layer is affected.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Source</th>
                      <th className="text-center py-2 px-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Entities</th>
                      <th className="text-center py-2 px-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">LZ</th>
                      <th className="text-center py-2 px-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Bronze</th>
                      <th className="text-center py-2 px-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Silver</th>
                      <th className="text-center py-2 px-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Full Chain</th>
                      <th className="text-center py-2 px-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Errors</th>
                      <th className="text-right py-2 px-3 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Blast Radius</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceBreakdown.map((src) => {
                      const blastPct = src.total > 0 ? (src.total / allEntities.length) * 100 : 0;
                      return (
                        <tr key={src.source} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                          <td className="py-2 px-3">
                            <span className="text-xs font-medium" style={{ color: getSourceColor(resolveSourceLabel(src.source)) }}>
                              {resolveSourceLabel(src.source)}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center font-mono text-xs">{src.total}</td>
                          <td className="py-2 px-2 text-center">
                            <span className={cn("font-mono text-xs", src.lz > 0 ? "text-emerald-400" : "text-muted-foreground/40")}>{src.lz}</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={cn("font-mono text-xs", src.bronze > 0 ? "text-emerald-400" : "text-muted-foreground/40")}>{src.bronze}</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={cn("font-mono text-xs", src.silver > 0 ? "text-emerald-400" : "text-muted-foreground/40")}>{src.silver}</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={cn("font-mono text-xs", src.fullChain > 0 ? "text-emerald-400 font-medium" : "text-muted-foreground/40")}>{src.fullChain}</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={cn("font-mono text-xs", src.errors > 0 ? "text-red-400" : "text-muted-foreground/40")}>{src.errors}</span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-amber-500/60"
                                  style={{ width: `${blastPct}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{formatPercent(blastPct, 0)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* At-risk entities */}
          {riskEntities.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  At-Risk Entities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">
                  Entities with errors or incomplete pipeline chains — highest priority for impact investigation.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {riskEntities.map((e) => (
                    <button
                      key={e.id}
                      className="flex items-center justify-between p-3 rounded-lg border hover:border-[var(--cl-accent)]/40 hover:bg-muted/50 transition-all text-left"
                      onClick={() => handleSelect(e)}
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-xs truncate">{e.tableName}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{e.sourceSchema}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        {e.lastError && <StatusBadge status="error" size="sm" />}
                        <div className="flex gap-0.5">
                          {e.lzStatus === "loaded" && <LayerBadge layer="landing" size="sm" showIcon={false} />}
                          {e.bronzeStatus === "loaded" && <LayerBadge layer="bronze" size="sm" showIcon={false} />}
                          {e.silverStatus === "loaded" && <LayerBadge layer="silver" size="sm" showIcon={false} />}
                        </div>
                        <span className="text-[10px]" style={{ color: getSourceColor(resolveSourceLabel(e.source)) }}>
                          {resolveSourceLabel(e.source)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* How it works */}
          <Card className="border-dashed">
            <CardContent className="py-6 text-center">
              <Sparkles className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Select an entity above to trace its full downstream impact through the medallion pipeline.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Column-level impact analysis coming in Phase 2 — Claude via Foundry (Phase 3) will add natural language impact queries.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
