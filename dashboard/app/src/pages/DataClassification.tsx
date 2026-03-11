import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KpiCard, KpiRow } from "@/components/ui/kpi-card";
import { CertificationBadge } from "@/components/ui/sensitivity-badge";
import { LayerBadge } from "@/components/ui/layer-badge";
import { formatRowCount, formatPercent } from "@/lib/formatters";
import { getSourceColor } from "@/lib/layers";
import { resolveSourceLabel } from "@/hooks/useSourceConfig";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import {
  Shield, Search, Lock, UserX,
  Tag, BarChart3, Columns3, Sparkles,
} from "lucide-react";
import type { SensitivityLevel } from "@/types/governance";

// ── Sensitivity heatmap cell ──

const SENSITIVITY_COLORS: Record<SensitivityLevel, string> = {
  public: "#10b981",
  internal: "#3b82f6",
  confidential: "#f59e0b",
  restricted: "#ef4444",
  pii: "#f43f5e",
};

const SENSITIVITY_ORDER: SensitivityLevel[] = ["public", "internal", "confidential", "restricted", "pii"];

interface HeatmapCell {
  source: string;
  level: SensitivityLevel;
  count: number;
}

// ── Mock classification data (replaced by API when backend is ready) ──

function useClassificationData(entities: DigestEntity[]) {
  return useMemo(() => {
    // Generate realistic classification estimates based on entity metadata
    const sources = [...new Set(entities.map((e) => e.source).filter(Boolean))];
    const totalColumns = entities.length * 15; // avg ~15 columns per entity

    // Pattern-based classification simulation
    // In production this comes from integration.ColumnClassification table
    const classifiedPct = 0; // 0% until classification engine runs
    const bySensitivity: Record<SensitivityLevel, number> = {
      public: 0,
      internal: 0,
      confidential: 0,
      restricted: 0,
      pii: 0,
    };

    const heatmap: HeatmapCell[] = [];
    sources.forEach((src) => {
      SENSITIVITY_ORDER.forEach((level) => {
        heatmap.push({ source: src, level, count: 0 });
      });
    });

    const bySource = sources.map((s) => {
      const sourceEntities = entities.filter((e) => e.source === s);
      return {
        source: s,
        entityCount: sourceEntities.length,
        estimatedColumns: sourceEntities.length * 15,
        classified: 0,
        piiCandidates: 0,
      };
    });

    return {
      totalEntities: entities.length,
      totalColumns,
      classifiedColumns: 0,
      coveragePercent: classifiedPct,
      bySensitivity,
      bySource,
      heatmap,
      sources,
    };
  }, [entities]);
}

// ── Main Page ──

export default function DataClassification() {
  const { allEntities, loading } = useEntityDigest();
  const classData = useClassificationData(allEntities);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [view, setView] = useState<"heatmap" | "entities">("entities");

  const filtered = useMemo(() => {
    return allEntities.filter((e) => {
      if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return e.tableName?.toLowerCase().includes(q) || e.sourceSchema?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [allEntities, search, sourceFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-display font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5 text-[var(--cl-accent)]" /> Data Classification
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Tag entities and columns with sensitivity levels — track classification coverage across the pipeline
        </p>
      </div>

      {/* KPIs */}
      <KpiRow>
        <KpiCard label="Total Entities" value={formatRowCount(classData.totalEntities)} icon={Tag} iconColor="text-slate-400" />
        <KpiCard label="Est. Columns" value={formatRowCount(classData.totalColumns)} icon={Columns3} iconColor="text-blue-400" />
        <KpiCard
          label="Classified"
          value={formatRowCount(classData.classifiedColumns)}
          icon={Shield}
          iconColor="text-emerald-400"
          subtitle={formatPercent(classData.coveragePercent) + " coverage"}
        />
        <KpiCard label="PII Detected" value={formatRowCount(classData.bySensitivity.pii)} icon={UserX} iconColor="text-rose-400" />
        <KpiCard label="Confidential" value={formatRowCount(classData.bySensitivity.confidential)} icon={Lock} iconColor="text-amber-400" />
      </KpiRow>

      {/* Classification Status Banner */}
      <Card className="border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-medium">Classification Engine Not Yet Active</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Column schema capture needs to run during next Bronze/Silver load. Once the <code className="font-mono bg-muted px-1 rounded">ColumnMetadata</code> table is populated,
                pattern-based classification will tag columns automatically. Claude via Foundry will add AI-powered classification in Phase 3.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* View toggle + filters */}
      <div className="flex gap-3 items-center">
        <div className="flex gap-1">
          <Button variant={view === "entities" ? "default" : "outline"} size="sm" className="text-xs h-7" onClick={() => setView("entities")}>
            <Tag className="h-3 w-3 mr-1" /> Entity View
          </Button>
          <Button variant={view === "heatmap" ? "default" : "outline"} size="sm" className="text-xs h-7" onClick={() => setView("heatmap")}>
            <BarChart3 className="h-3 w-3 mr-1" /> Heatmap
          </Button>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search entities..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <div className="flex gap-1.5">
          <Button variant={sourceFilter === "all" ? "default" : "outline"} size="sm" className="text-xs h-7" onClick={() => setSourceFilter("all")}>All</Button>
          {classData.sources.map((s) => (
            <Button
              key={s}
              variant={sourceFilter === s ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setSourceFilter(s)}
            >
              {resolveSourceLabel(s)}
            </Button>
          ))}
        </div>
      </div>

      {/* Content */}
      {view === "heatmap" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Source × Sensitivity Matrix</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Source</th>
                    {SENSITIVITY_ORDER.map((level) => (
                      <th key={level} className="text-center py-2 px-3 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                        {level}
                      </th>
                    ))}
                    <th className="text-center py-2 px-3 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Unclassified</th>
                  </tr>
                </thead>
                <tbody>
                  {classData.bySource.map((src) => (
                    <tr key={src.source} className="border-b border-border/50">
                      <td className="py-2 px-3 font-medium text-xs">
                        <span style={{ color: getSourceColor(resolveSourceLabel(src.source)) }}>
                          {resolveSourceLabel(src.source)}
                        </span>
                        <span className="text-muted-foreground ml-1 text-[10px]">({src.entityCount} entities)</span>
                      </td>
                      {SENSITIVITY_ORDER.map((level) => {
                        const cell = classData.heatmap.find((h) => h.source === src.source && h.level === level);
                        const count = cell?.count ?? 0;
                        return (
                          <td key={level} className="text-center py-2 px-3">
                            <div
                              className="inline-block w-10 h-6 rounded text-[10px] leading-6 font-mono"
                              style={{
                                backgroundColor: count > 0 ? `${SENSITIVITY_COLORS[level]}20` : "var(--bg-muted)",
                                color: count > 0 ? SENSITIVITY_COLORS[level] : "var(--text-muted)",
                              }}
                            >
                              {count}
                            </div>
                          </td>
                        );
                      })}
                      <td className="text-center py-2 px-3">
                        <div className="inline-block w-10 h-6 rounded text-[10px] leading-6 font-mono bg-muted text-muted-foreground">
                          {src.estimatedColumns}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-420px)] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10 border-b">
                  <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    <th className="text-left py-2 px-3 font-medium">Entity</th>
                    <th className="text-left py-2 px-3 font-medium">Source</th>
                    <th className="text-left py-2 px-3 font-medium">Schema</th>
                    <th className="text-center py-2 px-2 font-medium">Layers</th>
                    <th className="text-center py-2 px-2 font-medium">Classification</th>
                    <th className="text-right py-2 px-3 font-medium">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && allEntities.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">
                      {search || sourceFilter !== "all" ? "No entities match the current filters." : "No entities found."}
                    </td></tr>
                  ) : filtered.map((e) => (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                      <td className="py-1.5 px-3 font-mono text-xs">{e.tableName}</td>
                      <td className="py-1.5 px-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: getSourceColor(resolveSourceLabel(e.source)) }}>
                          {resolveSourceLabel(e.source)}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-xs text-muted-foreground">{e.sourceSchema}</td>
                      <td className="py-1.5 px-2 text-center">
                        <div className="flex gap-0.5 justify-center">
                          {e.lzStatus === "loaded" && <LayerBadge layer="landing" size="sm" showIcon={false} />}
                          {e.bronzeStatus === "loaded" && <LayerBadge layer="bronze" size="sm" showIcon={false} />}
                          {e.silverStatus === "loaded" && <LayerBadge layer="silver" size="sm" showIcon={false} />}
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <CertificationBadge status="none" />
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono text-xs text-muted-foreground">&mdash;</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
