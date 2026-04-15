import { useState, useMemo, useEffect } from "react";
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
import { isSuccessStatus } from "@/lib/exploreWorksurface";
import {
  Shield, Search, Lock, UserX,
  Tag, BarChart3, Columns3, Sparkles,
} from "lucide-react";
import type { SensitivityLevel } from "@/types/governance";

// ── Sensitivity heatmap cell — BP warm gradient ──

const SENSITIVITY_COLORS: Record<SensitivityLevel, string> = {
  public: "var(--bp-surface-inset)",      // #EDEAE4 — baseline
  internal: "var(--bp-copper-light)",      // #F4E8DF — warm
  confidential: "var(--bp-caution-light)", // #FDF3E3 — caution
  restricted: "var(--bp-fault-light)",     // #FBEAE8 — fault-light
  pii: "var(--bp-fault)",                  // #B93A2A — fault
};

// Ink colors for count numbers inside heatmap cells
const SENSITIVITY_INK: Record<SensitivityLevel, string> = {
  public: "var(--bp-ink-muted)",
  internal: "var(--bp-copper)",
  confidential: "var(--bp-caution)",
  restricted: "var(--bp-fault)",
  pii: "var(--bp-surface-1)",
};

const SENSITIVITY_ORDER: SensitivityLevel[] = ["public", "internal", "confidential", "restricted", "pii"];

interface HeatmapCell {
  source: string;
  level: SensitivityLevel;
  count: number;
}

// ── Classification data from real API ──

interface BySourceEntry {
  source: string;
  total: number;
  classified: number;
  piiCount: number;
  confidentialCount: number;
}

interface ClassificationData {
  totalEntities: number;
  totalColumns: number;
  classifiedColumns: number;
  coveragePercent: number;
  bySensitivity: Record<SensitivityLevel, number>;
  bySource: BySourceEntry[];
  heatmap: HeatmapCell[];
  sources: string[];
}

function _fallback(entities: DigestEntity[]): ClassificationData {
  const sources = [...new Set(entities.map((e) => e.source).filter(Boolean))];
  const heatmap: HeatmapCell[] = [];
  sources.forEach((src) => {
    SENSITIVITY_ORDER.forEach((level) => {
      heatmap.push({ source: src, level, count: 0 });
    });
  });
  const bySource: BySourceEntry[] = sources.map((s) => ({
    source: s,
    total: 0,
    classified: 0,
    piiCount: 0,
    confidentialCount: 0,
  }));
  return {
    totalEntities: entities.length,
    totalColumns: 0,
    classifiedColumns: 0,
    coveragePercent: 0,
    bySensitivity: { public: 0, internal: 0, confidential: 0, restricted: 0, pii: 0 },
    bySource,
    heatmap,
    sources,
  };
}

function useClassificationData(entities: DigestEntity[]): ClassificationData {
  const [data, setData] = useState<ClassificationData | null>(null);

  useEffect(() => {
    fetch("/api/classification/summary")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((api) => {
        // Build heatmap from bySource
        const bySource: BySourceEntry[] = (api.bySource ?? []).map((s: BySourceEntry) => ({
          source: s.source,
          total: s.total ?? 0,
          classified: s.classified ?? 0,
          piiCount: s.piiCount ?? 0,
          confidentialCount: s.confidentialCount ?? 0,
        }));

        const sources = bySource.map((s) => s.source);

        const heatmap: HeatmapCell[] = [];
        bySource.forEach((src) => {
          SENSITIVITY_ORDER.forEach((level) => {
            let count = 0;
            if (level === "pii") count = src.piiCount;
            else if (level === "confidential") count = src.confidentialCount;
            else if (level === "public") count = Math.max(0, src.total - src.classified);
            heatmap.push({ source: src.source, level, count });
          });
        });

        const bySensitivity: Record<SensitivityLevel, number> = {
          public: api.bySensitivity?.public ?? 0,
          internal: api.bySensitivity?.internal ?? 0,
          confidential: api.bySensitivity?.confidential ?? 0,
          restricted: api.bySensitivity?.restricted ?? 0,
          pii: api.bySensitivity?.pii ?? 0,
        };

        setData({
          totalEntities: api.totalEntities ?? 0,
          totalColumns: api.totalColumns ?? 0,
          classifiedColumns: api.classifiedColumns ?? 0,
          coveragePercent: api.coveragePercent ?? 0,
          bySensitivity,
          bySource,
          heatmap,
          sources,
        });
      })
      .catch((err) => {
        console.warn("Classification summary fetch failed:", err);
        setData(_fallback(entities));
      });
  // Only re-fetch when entities list changes (source list may differ)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities.length]);

  // While the API call is in flight, use the fallback based on entity digest
  return data ?? _fallback(entities);
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
    <div className="space-y-6 px-8 py-8 max-w-[1280px] mx-auto">
      {/* Header */}
      <div>
        <h1
          className="flex items-center gap-2 font-semibold"
          style={{ fontFamily: "var(--bp-font-display)", fontSize: 32, color: "var(--bp-ink-primary)" }}
        >
          <Shield className="h-6 w-6" style={{ color: "var(--bp-copper)" }} /> Data Classification
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--bp-ink-secondary)" }}>
          Tag entities and columns with sensitivity levels — track classification coverage across the pipeline
        </p>
      </div>

      {/* KPIs */}
      <KpiRow>
        <KpiCard label="Tables In Scope" value={formatRowCount(classData.totalEntities)} icon={Tag} iconColor="text-[var(--bp-ink-muted)]" />
        <KpiCard label="Est. Columns" value={formatRowCount(classData.totalColumns)} icon={Columns3} iconColor="text-[var(--bp-copper)]" />
        <KpiCard
          label="Classified"
          value={formatRowCount(classData.classifiedColumns)}
          icon={Shield}
          iconColor="text-[var(--bp-operational)]"
          subtitle={formatPercent(classData.coveragePercent) + " coverage"}
        />
        <KpiCard label="PII Detected" value={formatRowCount(classData.bySensitivity.pii)} icon={UserX} iconColor="text-[var(--bp-fault)]" />
        <KpiCard label="Confidential" value={formatRowCount(classData.bySensitivity.confidential)} icon={Lock} iconColor="text-[var(--bp-caution)]" />
      </KpiRow>

      {/* Classification Status Banner */}
      <Card
        className="border"
        style={{ borderColor: "var(--bp-caution)", background: "var(--bp-caution-light)" }}
      >
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5" style={{ color: "var(--bp-caution)" }} />
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--bp-ink-primary)" }}>Classification Engine Not Yet Active</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--bp-ink-secondary)" }}>
                Column schema capture needs to run during next Bronze/Silver load. Once the <code className="px-1 rounded" style={{ fontFamily: "var(--bp-font-mono)", background: "var(--bp-surface-inset)" }}>ColumnMetadata</code> table is populated,
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--bp-ink-muted)" }} />
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
            <CardTitle className="text-sm" style={{ fontFamily: "var(--bp-font-body)", fontWeight: 600, fontSize: 18, color: "var(--bp-ink-primary)" }}>Source × Sensitivity Matrix</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--bp-border)" }}>
                    <th className="text-left py-2 px-3 text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>Source</th>
                    {SENSITIVITY_ORDER.map((level) => (
                      <th key={level} className="text-center py-2 px-3 text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>
                        {level}
                      </th>
                    ))}
                    <th className="text-center py-2 px-3 text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>Unclassified</th>
                  </tr>
                </thead>
                <tbody>
                  {classData.bySource.map((src) => (
                    <tr key={src.source} style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}>
                      <td className="py-2 px-3 font-medium text-xs">
                        <span style={{ color: getSourceColor(resolveSourceLabel(src.source)) }}>
                          {resolveSourceLabel(src.source)}
                        </span>
                        <span className="ml-1 text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>({src.total} cols)</span>
                      </td>
                      {SENSITIVITY_ORDER.map((level) => {
                        const cell = classData.heatmap.find((h) => h.source === src.source && h.level === level);
                        const count = cell?.count ?? 0;
                        return (
                          <td key={level} className="text-center py-2 px-3">
                            <div
                              className="inline-block w-10 h-6 rounded text-[10px] leading-6"
                              style={{
                                fontFamily: "var(--bp-font-mono)",
                                fontVariantNumeric: "tabular-nums",
                                backgroundColor: count > 0 ? SENSITIVITY_COLORS[level] : "var(--bp-surface-inset)",
                                color: count > 0 ? SENSITIVITY_INK[level] : "var(--bp-ink-muted)",
                              }}
                            >
                              {count}
                            </div>
                          </td>
                        );
                      })}
                      <td className="text-center py-2 px-3">
                        <div
                          className="inline-block w-10 h-6 rounded text-[10px] leading-6"
                          style={{
                            fontFamily: "var(--bp-font-mono)",
                            fontVariantNumeric: "tabular-nums",
                            background: "var(--bp-surface-inset)",
                            color: "var(--bp-ink-muted)",
                          }}
                        >
                          {Math.max(0, src.total - src.classified)}
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
                <thead className="sticky top-0 z-10" style={{ background: "var(--bp-surface-1)", borderBottom: "1px solid var(--bp-border)" }}>
                  <tr className="text-[10px] uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>
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
                    <tr><td colSpan={6} className="text-center py-8" style={{ color: "var(--bp-ink-muted)" }}>Loading...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8" style={{ color: "var(--bp-ink-muted)" }}>
                      {search || sourceFilter !== "all" ? "No entities match the current filters." : "No entities found."}
                    </td></tr>
                  ) : filtered.map((e) => (
                    <tr key={e.id} className="hover:bg-[var(--bp-surface-2)] transition-colors" style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}>
                      <td className="py-1.5 px-3 text-xs" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-primary)" }}>{e.tableName}</td>
                      <td className="py-1.5 px-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: getSourceColor(resolveSourceLabel(e.source)) }}>
                          {resolveSourceLabel(e.source)}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>{e.sourceSchema}</td>
                      <td className="py-1.5 px-2 text-center">
                        <div className="flex gap-0.5 justify-center">
                          {isSuccessStatus(e.lzStatus) && <LayerBadge layer="landing" size="sm" showIcon={false} />}
                          {isSuccessStatus(e.bronzeStatus) && <LayerBadge layer="bronze" size="sm" showIcon={false} />}
                          {isSuccessStatus(e.silverStatus) && <LayerBadge layer="silver" size="sm" showIcon={false} />}
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <CertificationBadge status="none" />
                      </td>
                      <td className="py-1.5 px-3 text-right text-xs" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-muted)" }}>&mdash;</td>
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
