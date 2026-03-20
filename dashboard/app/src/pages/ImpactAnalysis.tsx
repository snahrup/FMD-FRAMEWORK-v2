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
  AlertTriangle, GitBranch, Database, Sparkles,
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
                <ArrowRight className="h-4 w-4" style={{ color: l.isActive ? 'var(--bp-caution)' : 'var(--bp-ink-muted)' }} />
              )}
              <div
                className={cn(
                  "flex flex-col items-center gap-1 px-4 py-3 rounded-lg border text-xs font-medium transition-all min-w-[90px]",
                  l.isActive ? "" : "opacity-30"
                )}
                style={{
                  ...(l.isActive || isOrigin ? { color: layerDef?.color, backgroundColor: `${layerDef?.color}10`, borderColor: `${layerDef?.color}30` } : {}),
                  ...(isOrigin ? { boxShadow: `0 0 0 2px var(--bp-surface-1), 0 0 0 4px ${layerDef?.color || 'var(--bp-copper)'}` } : {}),
                }}
              >
                <Icon className="h-4 w-4" />
                <span>{layerDef?.label ?? l.layer}</span>
                {l.isActive && !isOrigin && (
                  <span className="text-[9px] font-semibold" style={{ color: 'var(--bp-caution)' }}>IMPACTED</span>
                )}
                {isOrigin && (
                  <span className="text-[9px] font-semibold" style={{ color: 'var(--bp-copper)' }}>ORIGIN</span>
                )}
                {l.rowCount != null && (
                  <span className="text-[9px] font-mono text-[var(--bp-ink-muted)]">{formatRowCount(l.rowCount)} rows</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Impact summary */}
      <div className="p-3 rounded-md" style={{ background: 'var(--bp-caution-light)', border: '1px solid var(--bp-caution)' }}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" style={{ color: 'var(--bp-caution)' }} />
          <div>
            <p className="text-sm font-medium">
              {result.totalDownstream} downstream layer{result.totalDownstream !== 1 ? "s" : ""} affected
            </p>
            <p className="text-xs text-[var(--bp-ink-muted)] mt-0.5">
              A schema or data change to <span className="font-mono">{result.origin.sourceSchema}.{result.origin.tableName}</span> in
              <span style={{ color: getSourceColor(resolveSourceLabel(result.origin.source)) }}> {resolveSourceLabel(result.origin.source)}</span>
              {(() => {
                const activeLayers = result.impactedLayers.filter((l) => l.isActive && l.layer !== "source").map((l) => LAYER_MAP[l.layer]?.label).filter(Boolean);
                return activeLayers.length > 0
                  ? <> would propagate through {activeLayers.join(" \u2192 ")}.</>
                  : <> has no active downstream layers yet.</>;
              })()}
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
    <div className="space-y-6" style={{ padding: 32, maxWidth: 1280, margin: '0 auto' }}>
      <div>
        <h1 className="flex items-center gap-2" style={{ fontFamily: 'var(--bp-font-display)', fontSize: 32, color: 'var(--bp-ink-primary)', fontWeight: 400, lineHeight: 1.2 }}>
          <Zap className="h-5 w-5" style={{ color: 'var(--bp-copper)' }} /> Impact Analysis
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--bp-ink-secondary)' }}>
          Analyze downstream impact when a source entity changes — what breaks if this table is modified?
        </p>
      </div>

      <KpiRow>
        <KpiCard label="Total Entities" value={formatRowCount(allEntities.length)} icon={Database} iconColor="text-[var(--bp-ink-secondary)]" />
        <KpiCard label="Full Chain" value={formatRowCount(fullChain)} icon={GitBranch} iconColor="text-[var(--bp-operational)]" subtitle="LZ + Bronze + Silver" />
        <KpiCard label="Partial Chain" value={formatRowCount(partialChain)} icon={Layers} iconColor="text-[var(--bp-caution)]" subtitle="Missing downstream layers" />
        <KpiCard label="Not Started" value={formatRowCount(notStarted)} icon={AlertTriangle} iconColor="text-[var(--bp-ink-muted)]" subtitle="No loads yet" />
      </KpiRow>

      {/* Entity Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Select an Entity to Analyze</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--bp-ink-muted)]" />
            <Input
              placeholder="Type an entity name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
            {suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg z-20 max-h-64 overflow-y-auto" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
                {suggestions.map((e) => (
                  <button
                    key={e.id}
                    className="w-full text-left px-3 py-2 transition-colors flex items-center justify-between"
                    style={{ background: 'var(--bp-surface-1)' }}
                    onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'var(--bp-surface-2)'; }}
                    onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'var(--bp-surface-1)'; }}
                    onClick={() => handleSelect(e)}
                  >
                    <div>
                      <span className="font-mono text-xs">{e.tableName}</span>
                      <span className="text-[10px] text-[var(--bp-ink-muted)] ml-2">{e.sourceSchema}</span>
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
              <span className="text-[var(--bp-ink-muted)]">Selected:</span>
              <span className="font-mono font-medium">{selectedEntity.sourceSchema}.{selectedEntity.tableName}</span>
              <span style={{ color: getSourceColor(resolveSourceLabel(selectedEntity.source)) }}>
                ({resolveSourceLabel(selectedEntity.source)})
              </span>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-1" onClick={() => { setSelectedEntity(null); setImpactResult(null); }}>
                <span className="text-[var(--bp-ink-muted)] text-xs">×</span>
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
            <Sparkles className="h-6 w-6 mx-auto mb-2 text-[var(--bp-ink-muted)]/40" />
            <p className="text-sm text-[var(--bp-ink-muted)]">
              Column-level impact analysis coming in Phase 2 — requires <code className="px-1 rounded text-xs" style={{ fontFamily: 'var(--bp-font-mono)', background: 'var(--bp-surface-inset)' }}>ColumnLineage</code> table population.
            </p>
            <p className="text-xs text-[var(--bp-ink-muted)] mt-1">
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
                <HardDrive className="h-4 w-4 text-[var(--bp-ink-muted)]" />
                Source Impact Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-[var(--bp-ink-muted)] mb-4">
                Each source system feeds entities through the medallion pipeline. If a source schema changes, every downstream layer is affected.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--bp-border)' }}>
                      <th className="text-left py-2 px-3 text-[10px] text-[var(--bp-ink-muted)] uppercase tracking-wider font-medium">Source</th>
                      <th className="text-center py-2 px-2 text-[10px] text-[var(--bp-ink-muted)] uppercase tracking-wider font-medium">Entities</th>
                      <th className="text-center py-2 px-2 text-[10px] text-[var(--bp-ink-muted)] uppercase tracking-wider font-medium">LZ</th>
                      <th className="text-center py-2 px-2 text-[10px] text-[var(--bp-ink-muted)] uppercase tracking-wider font-medium">Bronze</th>
                      <th className="text-center py-2 px-2 text-[10px] text-[var(--bp-ink-muted)] uppercase tracking-wider font-medium">Silver</th>
                      <th className="text-center py-2 px-2 text-[10px] text-[var(--bp-ink-muted)] uppercase tracking-wider font-medium">Full Chain</th>
                      <th className="text-center py-2 px-2 text-[10px] text-[var(--bp-ink-muted)] uppercase tracking-wider font-medium">Errors</th>
                      <th className="text-right py-2 px-3 text-[10px] text-[var(--bp-ink-muted)] uppercase tracking-wider font-medium">Blast Radius</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceBreakdown.map((src) => {
                      const blastPct = src.total > 0 ? (src.total / allEntities.length) * 100 : 0;
                      return (
                        <tr key={src.source} className="transition-colors" style={{ borderBottom: '1px solid var(--bp-border-subtle)' }}>
                          <td className="py-2 px-3">
                            <span className="text-xs font-medium" style={{ color: getSourceColor(resolveSourceLabel(src.source)) }}>
                              {resolveSourceLabel(src.source)}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center font-mono text-xs">{src.total}</td>
                          <td className="py-2 px-2 text-center">
                            <span className="font-mono text-xs" style={{ color: src.lz > 0 ? 'var(--bp-operational)' : 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>{src.lz}</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="font-mono text-xs" style={{ color: src.bronze > 0 ? 'var(--bp-operational)' : 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>{src.bronze}</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="font-mono text-xs" style={{ color: src.silver > 0 ? 'var(--bp-operational)' : 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>{src.silver}</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="font-mono text-xs" style={{ color: src.fullChain > 0 ? 'var(--bp-operational)' : 'var(--bp-ink-muted)', fontWeight: src.fullChain > 0 ? 500 : 400, fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>{src.fullChain}</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="font-mono text-xs" style={{ color: src.errors > 0 ? 'var(--bp-fault)' : 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>{src.errors}</span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bp-surface-inset)' }}>
                                <div
                                  className="h-full rounded-full"
                                  style={{ backgroundColor: 'var(--bp-caution)', width: `${blastPct}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-[var(--bp-ink-muted)] w-8 text-right">{formatPercent(blastPct, 0)}</span>
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
                  <AlertTriangle className="h-4 w-4" style={{ color: 'var(--bp-caution)' }} />
                  At-Risk Entities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-[var(--bp-ink-muted)] mb-3">
                  Entities with errors or incomplete pipeline chains — highest priority for impact investigation.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {riskEntities.map((e) => (
                    <button
                      key={e.id}
                      className="flex items-center justify-between p-3 rounded-md transition-all text-left"
                      style={{ border: '1px solid var(--bp-border)' }}
                      onClick={() => handleSelect(e)}
                    >
                      <div className="min-w-0">
                        <span className="block font-mono text-xs truncate">{e.tableName}</span>
                        <span className="block text-[10px] text-[var(--bp-ink-muted)] truncate">{e.sourceSchema}</span>
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
              <Sparkles className="h-6 w-6 mx-auto mb-2 text-[var(--bp-ink-muted)]/40" />
              <p className="text-sm text-[var(--bp-ink-muted)]">
                Select an entity above to trace its full downstream impact through the medallion pipeline.
              </p>
              <p className="text-xs text-[var(--bp-ink-muted)] mt-1">
                Column-level impact analysis coming in Phase 2 — Claude via Foundry (Phase 3) will add natural language impact queries.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
