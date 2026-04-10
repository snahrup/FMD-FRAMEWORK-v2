import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
// KpiCard/KpiRow removed — replaced with inline tiered KPI layout
import { StatusBadge } from "@/components/ui/status-badge";
import { LayerBadge } from "@/components/ui/layer-badge";
import { formatRowCount, formatTimestamp } from "@/lib/formatters";
import { getSourceColor } from "@/lib/layers";
import { resolveSourceLabel } from "@/hooks/useSourceConfig";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import { ExploreWorkbenchHeader } from "@/components/explore/ExploreWorkbenchHeader";
import { CatalogAtlas, type CatalogAnalysisStatus, type CatalogJoinCandidate } from "@/components/explore/CatalogAtlas";
import { CatalogAnalystPanel, type CatalogAnalystPromptMode, type CatalogAnalystResponse } from "@/components/explore/CatalogAnalystPanel";
import { PipelineResolutionPanel } from "@/components/explore/PipelineResolutionPanel";
import {
  BookOpen, Search, Table2, Sparkles,
  ArrowUpDown, Columns3, AlertCircle, Orbit, Eye, DatabaseZap, Radar, RefreshCw, Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildEntityBlenderUrl,
  buildEntityLineageUrl,
  buildEntityProfileUrl,
  buildEntitySourceSqlUrl,
  findEntityFromParams,
  getBlockedEntities,
  getEntityRecommendedAction,
  getEntityResolutionAction,
  getLoadedLayerCount,
  getToolReadyEntities,
  isEntityToolReady,
  isSuccessStatus,
} from "@/lib/exploreWorksurface";
import { deriveEntityRelationships } from "@/lib/exploreRelationships";

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

  const loadedLayers = layers.filter((l) => isSuccessStatus(l.status)).length;
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
                    const isLoaded = isSuccessStatus(l.status);
                    return (
                      <div
                        key={l.key}
                        className="p-3 rounded-lg transition-colors"
                        style={{
                          border: isSuccessStatus(l.status) ? "1px solid var(--bp-operational)" : "1px solid var(--bp-border)",
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

interface JoinDiscoveryRecord {
  source_table: string;
  target_table: string;
  source_column: string;
  target_column: string;
  join_type: string;
  confidence_score: number;
  reason: string;
  source_system_src?: string;
  source_system_tgt?: string;
  analysis_stage?: string;
  evidence?: {
    kind: string;
    label: string;
    detail: string;
    provenance: {
      type: string;
      sourceRef: string;
      fields: string[];
      layer?: string;
    };
  }[];
}

interface JoinDiscoveryTableResponse {
  outbound_joins?: { candidates?: JoinDiscoveryRecord[] };
  inbound_joins?: { candidates?: JoinDiscoveryRecord[] };
}

interface JoinDiscoveryStatusResponse {
  status: string;
  message?: string;
  mode?: string;
  last_updated?: string;
  statistics?: {
    total_tables_analyzed?: number;
    total_join_candidates?: number;
  };
}

function splitQualifiedTableName(value?: string | null): { source: string; table: string } {
  const parts = (value || "").split(".").filter(Boolean);
  if (parts.length === 0) return { source: "", table: "" };
  return {
    source: parts[0] || "",
    table: parts[parts.length - 1] || parts[0] || "",
  };
}

function matchEntityForRelationship(
  entities: DigestEntity[],
  sourceName: string,
  tableName: string,
): DigestEntity | null {
  const normalizedSource = sourceName.trim().toLowerCase();
  const normalizedTable = tableName.trim().toLowerCase();
  return entities.find((entity) => {
    if (entity.tableName.toLowerCase() !== normalizedTable) return false;
    return resolveSourceLabel(entity.source).toLowerCase() === normalizedSource
      || entity.source.toLowerCase() === normalizedSource;
  }) || null;
}

export default function DataCatalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { allEntities, loading, error } = useEntityDigest();
  const hasLoadedOnce = useRef(false);
  if (!loading && allEntities.length > 0) hasLoadedOnce.current = true;
  const showSkeleton = loading && !hasLoadedOnce.current;
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [focusFilter, setFocusFilter] = useState<"all" | "trusted" | "attention" | "profile_ready">("all");
  const [sortKey, setSortKey] = useState<"name" | "source">("name");
  const [selectedEntity, setSelectedEntity] = useState<DigestEntity | null>(null);
  const [detailEntity, setDetailEntity] = useState<DigestEntity | null>(null);
  const [joinStatus, setJoinStatus] = useState<CatalogAnalysisStatus | null>(null);
  const [joinCandidates, setJoinCandidates] = useState<CatalogJoinCandidate[]>([]);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analystMode, setAnalystMode] = useState<CatalogAnalystPromptMode>("overview");
  const [analystBusy, setAnalystBusy] = useState(false);
  const [analystError, setAnalystError] = useState<string | null>(null);
  const [analystCache, setAnalystCache] = useState<Record<string, CatalogAnalystResponse>>({});
  const toolReadyEntities = useMemo(() => getToolReadyEntities(allEntities), [allEntities]);
  const blockedEntities = useMemo(() => getBlockedEntities(allEntities), [allEntities]);
  const blockedLandingCount = useMemo(
    () => blockedEntities.filter((entity) => !isSuccessStatus(entity.lzStatus)).length,
    [blockedEntities],
  );
  const blockedPipelineCount = blockedEntities.length - blockedLandingCount;

  const sources = useMemo(() => {
    const s = new Set<string>();
    toolReadyEntities.forEach((e) => { if (e.source) s.add(e.source); });
    return Array.from(s).sort();
  }, [toolReadyEntities]);

  const filtered = useMemo(() => {
    let result = toolReadyEntities.filter((e) => {
      if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const matches = e.tableName?.toLowerCase().includes(q) || e.sourceSchema?.toLowerCase().includes(q) || e.source?.toLowerCase().includes(q) || e.businessName?.toLowerCase().includes(q) || e.domain?.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (focusFilter === "trusted") return (e.qualityScore || 0) >= 80 || e.qualityTier === "silver";
      if (focusFilter === "attention") return Boolean(e.lastError) || (getLoadedLayerCount(e) > 0 && !isSuccessStatus(e.silverStatus));
      if (focusFilter === "profile_ready") return isSuccessStatus(e.silverStatus) || isSuccessStatus(e.bronzeStatus);
      return true;
    });

    result.sort((a, b) => {
      if (sortKey === "name") return (a.tableName ?? "").localeCompare(b.tableName ?? "");
      if (sortKey === "source") return (a.source ?? "").localeCompare(b.source ?? "");
      return 0;
    });

    return result;
  }, [focusFilter, search, sortKey, sourceFilter, toolReadyEntities]);

  const readyCount = toolReadyEntities.length;
  const trustedCount = toolReadyEntities.filter((e) => (e.qualityScore || 0) >= 80 || e.qualityTier === "silver").length;
  const attentionCount = blockedEntities.length;
  const profileReadyCount = toolReadyEntities.length;
  const blockedSelectedEntity = selectedEntity && !isEntityToolReady(selectedEntity) ? selectedEntity : null;
  const activeEntity = selectedEntity && isEntityToolReady(selectedEntity) ? selectedEntity : null;

  useEffect(() => {
    if (!selectedEntity) return;
    if (isEntityToolReady(selectedEntity) && !filtered.some((entity) => entity.id === selectedEntity.id)) {
      setSelectedEntity(null);
    }
  }, [filtered, selectedEntity]);

  const handleSelectEntity = useCallback((entity: DigestEntity | null) => {
    setSelectedEntity(entity);
    setAnalystMode("overview");
    setAnalystError(null);
    const next = new URLSearchParams(searchParams);
    if (!entity) {
      next.delete("table");
      next.delete("schema");
      next.delete("source");
    } else {
      next.set("table", entity.tableName);
      next.set("schema", entity.sourceSchema);
      next.set("source", entity.source);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const matched = findEntityFromParams(allEntities, {
      table: searchParams.get("table"),
      schema: searchParams.get("schema"),
      source: searchParams.get("source"),
    });
    if (matched && matched.id !== selectedEntity?.id) {
      setSelectedEntity(matched);
    }
  }, [allEntities, searchParams, selectedEntity?.id]);

  const refreshJoinStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/join-discovery/status");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as JoinDiscoveryStatusResponse;
      setJoinStatus({
        status: payload.status,
        message: payload.message,
        lastUpdated: payload.last_updated,
        candidateCount: payload.statistics?.total_join_candidates,
        tableCount: payload.statistics?.total_tables_analyzed,
      });
    } catch (joinError) {
      setJoinStatus({
        status: "error",
        message: joinError instanceof Error ? joinError.message : "Unable to load relationship analysis status",
      });
    }
  }, []);

  useEffect(() => {
    void refreshJoinStatus();
  }, [refreshJoinStatus]);

  useEffect(() => {
    if (!activeEntity || joinStatus?.status !== "ready") {
      setJoinCandidates((current) => current.length > 0 ? [] : current);
      return;
    }

    let cancelled = false;
    const selectedSource = resolveSourceLabel(activeEntity.source);
    const url = `/api/join-discovery/table?source=${encodeURIComponent(selectedSource)}&table=${encodeURIComponent(activeEntity.tableName)}`;

    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as JoinDiscoveryTableResponse;
        if (cancelled) return;

        const outbound = payload.outbound_joins?.candidates ?? [];
        const inbound = payload.inbound_joins?.candidates ?? [];
        const nextCandidates = [...outbound, ...inbound].map((candidate, index) => {
          const counterpart = outbound.includes(candidate) ? splitQualifiedTableName(candidate.target_table) : splitQualifiedTableName(candidate.source_table);
          const counterpartSource = outbound.includes(candidate)
            ? (candidate.source_system_tgt || counterpart.source)
            : (candidate.source_system_src || counterpart.source);
          const matchedEntity = matchEntityForRelationship(allEntities, counterpartSource, counterpart.table);
          const confidence = candidate.confidence_score > 1
            ? Math.round(candidate.confidence_score)
            : Math.round(candidate.confidence_score * 100);
          return {
            id: `${candidate.source_table}-${candidate.target_table}-${candidate.source_column}-${candidate.target_column}-${index}`,
            entity: matchedEntity,
            title: matchedEntity?.businessName || matchedEntity?.tableName || counterpart.table,
            subtitle: matchedEntity?.domain || counterpartSource || "candidate relationship",
            confidence,
            joinLabel: `${candidate.source_column} ↔ ${candidate.target_column}`,
            explanation: candidate.reason,
            evidence: candidate.evidence ?? [],
          } satisfies CatalogJoinCandidate;
        }).slice(0, 8);

        setJoinCandidates(nextCandidates);
      } catch {
        if (!cancelled) setJoinCandidates([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeEntity, allEntities, joinStatus?.status]);

  const runRelationshipAnalysis = useCallback(async () => {
    setAnalysisBusy(true);
    setJoinStatus((current) => ({
      status: "running",
      message: current?.message,
      lastUpdated: current?.lastUpdated,
      candidateCount: current?.candidateCount,
      tableCount: current?.tableCount,
    }));
    try {
      const response = await fetch("/api/join-discovery/run-analysis", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.json();
      await refreshJoinStatus();
    } catch (analysisError) {
      setJoinStatus({
        status: "error",
        message: analysisError instanceof Error ? analysisError.message : "Relationship analysis failed",
      });
    } finally {
      setAnalysisBusy(false);
    }
  }, [refreshJoinStatus]);

  const analystCacheKey = activeEntity ? `${activeEntity.id}:${analystMode}` : null;
  const analystResult = analystCacheKey ? analystCache[analystCacheKey] ?? null : null;

  const generateAnalystRead = useCallback(async (mode: CatalogAnalystPromptMode) => {
    if (!activeEntity) return;
    setAnalystMode(mode);
    setAnalystError(null);

    const cacheKey = `${activeEntity.id}:${mode}`;
    if (analystCache[cacheKey]) return;

    setAnalystBusy(true);
    try {
      const response = await fetch("/api/join-discovery/analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: resolveSourceLabel(activeEntity.source),
          table: activeEntity.tableName,
          promptMode: mode,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as CatalogAnalystResponse;
      if (payload.status !== "success") throw new Error("Analyst response did not complete successfully");
      setAnalystCache((current) => ({ ...current, [cacheKey]: payload }));
      if (joinStatus?.status !== "ready") {
        void refreshJoinStatus();
      }
    } catch (analystIssue) {
      setAnalystError(analystIssue instanceof Error ? analystIssue.message : "Unable to generate the catalog analyst read");
    } finally {
      setAnalystBusy(false);
    }
  }, [activeEntity, analystCache, joinStatus?.status, refreshJoinStatus]);

  useEffect(() => {
    setAnalystError(null);
  }, [selectedEntity?.id]);

  useEffect(() => {
    if (!activeEntity || analystResult || analystBusy || analystError) return;
    void generateAnalystRead(analystMode);
  }, [activeEntity, analystBusy, analystError, analystMode, analystResult, generateAnalystRead]);

  const recommended = selectedEntity ? getEntityRecommendedAction(selectedEntity) : null;
  const resolutionAction = blockedSelectedEntity ? getEntityResolutionAction(blockedSelectedEntity) : null;
  const sourceSql = activeEntity ? buildEntitySourceSqlUrl(activeEntity) : null;
  const relatedAssets = useMemo(
    () => activeEntity ? deriveEntityRelationships(activeEntity, toolReadyEntities, 6) : [],
    [activeEntity, toolReadyEntities],
  );
  const visibleEntities = filtered.slice(0, 180);

  return (
    <div className="space-y-6 gs-page-enter" style={{ padding: "28px 32px", maxWidth: "1500px", margin: "0 auto" }}>
      <ExploreWorkbenchHeader
        title="Data Catalog"
        summary="See where a tool-ready asset belongs, what sits closest to it, and whether that relationship is contextual or evidence-backed."
        meta={`${formatRowCount(filtered.length)} tool-ready assets currently in view`}
        facts={[
          { label: "Tool-Ready Assets", value: formatRowCount(readyCount), detail: "Only full-chain assets are allowed into Explore tool mode.", tone: "positive" },
          { label: "Trusted Assets", value: formatRowCount(trustedCount), detail: "High-trust or silver-tier assets already usable for operators.", tone: trustedCount > 0 ? "positive" : "neutral" },
          {
            label: "Atlas Mode",
            value: joinStatus?.status === "ready" ? "Staged evidence" : "Context clues",
            detail: joinStatus?.status === "ready"
              ? "Relationship analysis is staged from lakehouse-ready assets and candidate relationships are available."
              : "The orbit is using domain, source, schema, and trust proximity until the staged map is rebuilt.",
            tone: joinStatus?.status === "ready" ? "positive" : "accent",
          },
          { label: "Blocked Assets", value: formatRowCount(attentionCount), detail: "Held out of tool mode until registration or pipeline issues are resolved.", tone: attentionCount > 0 ? "warning" : "neutral" },
        ]}
        actions={[
          { label: "Explore hub", to: "/explore", tone: "quiet", icon: BookOpen },
          { label: "Trusted only", onClick: () => setFocusFilter("trusted"), tone: focusFilter === "trusted" ? "primary" : "secondary", icon: Eye },
          { label: "Needs attention", onClick: () => setFocusFilter("attention"), tone: focusFilter === "attention" ? "primary" : "secondary", icon: Orbit },
          { label: "Profile-ready", onClick: () => setFocusFilter("profile_ready"), tone: focusFilter === "profile_ready" ? "primary" : "secondary", icon: Sparkles },
          joinStatus?.status !== "ready"
            ? { label: analysisBusy ? "Staging..." : "Build staged relationship map", onClick: runRelationshipAnalysis, tone: "quiet", icon: RefreshCw }
            : undefined,
          focusFilter !== "all" ? { label: "Clear focus", onClick: () => setFocusFilter("all"), tone: "quiet" } : undefined,
        ].filter(Boolean) as never[]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--bp-ink-muted)" }} />
          <Input
            placeholder="Search assets, domains, or sources..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 pl-9 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant={sourceFilter === "all" ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setSourceFilter("all")}>All sources</Button>
          {sources.map((source) => (
            <Button
              key={source}
              variant={sourceFilter === source ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setSourceFilter(source)}
              style={sourceFilter === source ? { backgroundColor: getSourceColor(resolveSourceLabel(source)) } : undefined}
            >
              {resolveSourceLabel(source)}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {([
            { key: "all", label: "All" },
            { key: "trusted", label: `Trusted (${trustedCount})` },
            { key: "attention", label: `Attention (${attentionCount})` },
            { key: "profile_ready", label: `Ready (${profileReadyCount})` },
          ] as const).map((option) => (
            <Button
              key={option.key}
              variant={focusFilter === option.key ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setFocusFilter(option.key)}
            >
              {option.label}
            </Button>
          ))}
          {(["name", "source"] as const).map((key) => (
            <Button key={key} variant={sortKey === key ? "default" : "ghost"} size="sm" className="h-8 text-[11px]" onClick={() => setSortKey(key)}>
              <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
              {key}
            </Button>
          ))}
        </div>
      </div>

      {error && !hasLoadedOnce.current ? (
        <Card style={{ border: "1px solid rgba(185, 58, 42, 0.3)", backgroundColor: "var(--bp-fault-light)" }}>
          <CardContent className="flex items-center gap-3 p-6">
            <AlertCircle className="h-5 w-5 shrink-0" style={{ color: "var(--bp-fault)" }} />
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--bp-fault)" }}>Failed to load entity digest</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--bp-ink-secondary)" }}>{error}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {blockedEntities.length > 0 ? (
        <Card style={{ border: "1px solid rgba(180,86,36,0.16)", backgroundColor: "rgba(180,86,36,0.04)" }}>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="text-[11px]" style={{ color: "var(--bp-copper)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                  Tool readiness gate
                </div>
                <h2 className="mt-2 text-lg" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                  Blocked assets stay out of Explore until Load Center finishes the path
                </h2>
                <p className="mt-2 text-sm" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.65 }}>
                  {formatRowCount(blockedEntities.length)} registered assets are currently held out of tool mode so users do not land on dead-end pages. {formatRowCount(blockedLandingCount)} still have not reached landing, and {formatRowCount(blockedPipelineCount)} still need bronze or silver completion. Load Center is now the single place that finishes those imports.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/load-center"
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2.5"
                  style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-surface-1)", backgroundColor: "var(--bp-copper)", textDecoration: "none" }}
                >
                  <Radar size={14} />
                  Open Load Center
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(91,84,76,0.12)" }}>
          <CardContent className="p-0">
            <div className="border-b px-4 py-4" style={{ borderColor: "rgba(91,84,76,0.10)" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                    Asset index
                  </div>
                  <h2 className="mt-2 text-lg" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                    Browse the estate quietly
                  </h2>
                </div>
                <div className="rounded-full px-3 py-1 text-[11px]" style={{ background: "rgba(91,84,76,0.08)", color: "var(--bp-ink-secondary)" }}>
                  {formatRowCount(visibleEntities.length)} shown
                </div>
              </div>
              <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
                Pick one asset at a time. The main canvas handles the heavy lifting instead of flooding you with cards.
              </p>
            </div>
            <div className="max-h-[calc(100vh-350px)] overflow-y-auto p-3">
              {showSkeleton ? (
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Card key={index} className="animate-pulse">
                      <CardContent className="h-20 p-4" />
                    </Card>
                  ))}
                </div>
              ) : visibleEntities.length === 0 ? (
                <div className="py-12 text-center" style={{ color: "var(--bp-ink-muted)" }}>
                  <Search className="mx-auto mb-3 h-8 w-8 gs-float" style={{ opacity: 0.3 }} />
                  No assets match your current filters.
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleEntities.map((entity, index) => {
                    const isFocused = selectedEntity?.id === entity.id;
                    const sourceColor = getSourceColor(resolveSourceLabel(entity.source));
                    return (
                      <button
                        type="button"
                        key={entity.id}
                        className="gs-stagger-card w-full rounded-[20px] border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-[2px]"
                        style={{
                          '--i': Math.min(index, 15),
                          borderColor: isFocused ? "rgba(180,86,36,0.26)" : "rgba(91,84,76,0.12)",
                          background: isFocused
                            ? "linear-gradient(180deg, rgba(180,86,36,0.10) 0%, rgba(255,255,255,0.98) 100%)"
                            : "rgba(255,255,255,0.88)",
                          boxShadow: isFocused ? "0 18px 36px rgba(180,86,36,0.08)" : "none",
                        } as React.CSSProperties}
                        onClick={() => handleSelectEntity(entity)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                              {entity.businessName || entity.tableName}
                            </div>
                            <div className="mt-1 truncate text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
                              {entity.tableName} · {entity.sourceSchema}
                            </div>
                          </div>
                          <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: `${sourceColor}15`, color: sourceColor }}>
                            {resolveSourceLabel(entity.source)}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {isSuccessStatus(entity.lzStatus) ? <LayerBadge layer="landing" size="sm" showIcon={false} /> : null}
                          {isSuccessStatus(entity.bronzeStatus) ? <LayerBadge layer="bronze" size="sm" showIcon={false} /> : null}
                          {isSuccessStatus(entity.silverStatus) ? <LayerBadge layer="silver" size="sm" showIcon={false} /> : null}
                          {entity.domain ? (
                            <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "rgba(91,84,76,0.08)", color: "var(--bp-ink-secondary)" }}>
                              {entity.domain}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
                          <span>{entity.qualityScore != null ? `${entity.qualityScore.toFixed(0)}% trust` : "Trust pending"}</span>
                          <span>{entity.lzLastLoad ? formatTimestamp(entity.lzLastLoad, { relative: true }) : "Awaiting first load"}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {blockedSelectedEntity && resolutionAction ? (
            <PipelineResolutionPanel
              entity={blockedSelectedEntity}
              action={resolutionAction}
              summary="This asset is registered, but it is still missing part of the managed load path. Catalog stops here instead of pretending the downstream tool stack is usable."
            />
          ) : (
            <>
              <CatalogAtlas
                selected={activeEntity}
                relationships={relatedAssets}
                joinCandidates={joinCandidates}
                analysisStatus={joinStatus}
                analysisBusy={analysisBusy}
                onRunAnalysis={runRelationshipAnalysis}
                onSelectEntity={handleSelectEntity}
              />

              <CatalogAnalystPanel
                selected={activeEntity}
                analysis={analystResult}
                busy={analystBusy}
                error={analystError}
                activeMode={analystMode}
                onAnalyze={(mode) => void generateAnalystRead(mode)}
              />

              <div className="grid gap-4 lg:grid-cols-2">
            <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(91,84,76,0.12)" }}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                  <Link2 className="h-3.5 w-3.5" />
                  Staged relationships
                </div>
                <h3 className="mt-2 text-base" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                  Relationship evidence
                </h3>
                <div className="mt-4 space-y-3">
                  {activeEntity && joinCandidates.length > 0 ? (
                    joinCandidates.slice(0, 4).map((candidate, index) => (
                      <button
                        type="button"
                        key={candidate.id}
                        className="gs-stagger-row w-full rounded-[18px] border px-3 py-3 text-left transition-colors hover:bg-[var(--bp-operational-light)]/60"
                        style={{ '--i': Math.min(index, 15), borderColor: "rgba(45,106,79,0.16)", background: "rgba(45,106,79,0.05)" } as React.CSSProperties}
                        onClick={() => candidate.entity ? handleSelectEntity(candidate.entity) : undefined}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                              {candidate.title}
                            </div>
                            <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
                              {candidate.subtitle}
                            </div>
                          </div>
                          <span className="rounded-full px-2 py-1 text-[10px] font-medium" style={{ background: "rgba(45,106,79,0.10)", color: "var(--bp-operational)" }}>
                            {candidate.confidence}%
                          </span>
                        </div>
                        <div className="mt-3 text-[11px]" style={{ color: "var(--bp-operational)" }}>
                          {candidate.joinLabel}
                        </div>
                        <p className="mt-1 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
                          {candidate.explanation}
                        </p>
                        {candidate.evidence && candidate.evidence.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {candidate.evidence.slice(0, 2).map((item) => (
                              <span
                                key={`${candidate.id}-${item.label}`}
                                className="rounded-full px-2 py-1 text-[10px]"
                                style={{ background: "rgba(255,255,255,0.86)", color: "var(--bp-ink-secondary)", border: "1px solid rgba(45,106,79,0.12)" }}
                              >
                                {item.label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </button>
                    ))
                  ) : joinStatus?.status === "ready" ? (
                    <div className="rounded-[20px] border px-4 py-5 text-sm" style={{ borderColor: "rgba(91,84,76,0.12)", background: "rgba(255,255,255,0.88)", color: "var(--bp-ink-secondary)" }}>
                      No staged relationship candidates are strong enough for this asset yet. The atlas is still showing contextual neighbors to reduce the discovery burden without overstating certainty.
                    </div>
                  ) : (
                    <div className="rounded-[20px] border px-4 py-5 text-sm" style={{ borderColor: "rgba(180,86,36,0.16)", background: "rgba(180,86,36,0.05)", color: "var(--bp-ink-secondary)" }}>
                      The staged relationship map has not been rebuilt yet, so the catalog is being honest about what it knows and what still needs stronger evidence.
                      <div className="mt-3">
                        <Button size="sm" className="h-8 rounded-full px-4 text-xs" onClick={runRelationshipAnalysis} disabled={analysisBusy}>
                          {analysisBusy ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Radar className="mr-1.5 h-3.5 w-3.5" />}
                          {analysisBusy ? "Staging map" : "Build staged relationship map"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(91,84,76,0.12)" }}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                  <Orbit className="h-3.5 w-3.5" />
                  Closest assets
                </div>
                <h3 className="mt-2 text-base" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                  Why the atlas grouped them
                </h3>
                <div className="mt-4 space-y-3">
                  {activeEntity && relatedAssets.length > 0 ? (
                    relatedAssets.slice(0, 4).map((relationship, index) => (
                      <button
                        type="button"
                        key={relationship.entity.id}
                        className="gs-stagger-row w-full rounded-[18px] border px-3 py-3 text-left transition-colors hover:bg-[var(--bp-copper-light)]/60"
                        style={{ '--i': Math.min(index, 15), borderColor: "rgba(180,86,36,0.14)", background: "rgba(255,255,255,0.88)" } as React.CSSProperties}
                        onClick={() => handleSelectEntity(relationship.entity)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                              {relationship.entity.businessName || relationship.entity.tableName}
                            </div>
                            <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
                          {relationship.entity.tableName} · {relationship.entity.domain || resolveSourceLabel(relationship.entity.source)}
                        </div>
                      </div>
                      <span className="rounded-full px-2 py-1 text-[10px] font-medium" style={{ background: "rgba(180,86,36,0.10)", color: "var(--bp-copper)" }}>
                        {relationship.confidence}
                          </span>
                        </div>
                        <p className="mt-3 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
                          {relationship.reasons.join(" · ")}
                        </p>
                        {relationship.evidence.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {relationship.evidence.slice(0, 2).map((item) => (
                              <span
                                key={`${relationship.entity.id}-${item.label}`}
                                className="rounded-full px-2 py-1 text-[10px]"
                                style={{ background: "rgba(255,255,255,0.86)", color: "var(--bp-ink-secondary)", border: "1px solid rgba(180,86,36,0.12)" }}
                              >
                                {item.label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <div className="rounded-[20px] border px-4 py-5 text-sm" style={{ borderColor: "rgba(91,84,76,0.12)", background: "rgba(255,255,255,0.88)", color: "var(--bp-ink-secondary)" }}>
                      Pick an asset to see which other tables sit closest to it by domain, source, schema, trust posture, and staged context.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
              </div>
            </>
          )}
        </div>

        <div className="space-y-4">
          <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: selectedEntity ? "rgba(180,86,36,0.16)" : "rgba(91,84,76,0.12)" }}>
            <CardContent className="p-4">
              {activeEntity ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[10px] px-2 py-1 rounded-full font-medium"
                          style={{ color: getSourceColor(resolveSourceLabel(activeEntity.source)), backgroundColor: `${getSourceColor(resolveSourceLabel(activeEntity.source))}15` }}
                        >
                          {resolveSourceLabel(activeEntity.source)}
                        </span>
                        {activeEntity.domain ? (
                          <span className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)" }}>
                            {activeEntity.domain}
                          </span>
                        ) : null}
                        {activeEntity.qualityTier ? (
                          <span className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: "rgba(45,106,79,0.10)", color: "var(--bp-operational)" }}>
                            {activeEntity.qualityTier} trust
                          </span>
                        ) : null}
                      </div>
                      <h2 className="mt-3 text-lg" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>
                        {activeEntity.businessName || activeEntity.tableName}
                      </h2>
                      <p className="mt-1 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                        {activeEntity.description || activeEntity.diagnosis || "The rail keeps the next action and the supporting evidence in one place."}
                      </p>
                    </div>
                    <StatusBadge status={activeEntity.overall || "unknown"} size="sm" />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                    {[
                      {
                        label: "Trust",
                        value: activeEntity.qualityScore != null ? `${activeEntity.qualityScore.toFixed(0)}%` : "Pending",
                        detail: activeEntity.qualityTier || "score not staged",
                      },
                      {
                        label: "Loaded",
                        value: `${getLoadedLayerCount(activeEntity)}/3`,
                        detail: "managed layers ready",
                      },
                      {
                        label: "Relationships",
                        value: joinCandidates.length > 0 ? `${joinCandidates.length}` : `${relatedAssets.length}`,
                        detail: joinCandidates.length > 0 ? "staged candidates" : "context neighbors",
                      },
                      {
                        label: "Next move",
                        value: recommended?.label || "Review context",
                        detail: recommended?.detail || "choose the next operator path",
                      },
                    ].map((item) => (
                      <div key={item.label} className="rounded-[18px] px-3 py-3" style={{ border: "1px solid rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.85)" }}>
                        <div style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>
                          {item.label}
                        </div>
                        <div className="mt-1 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                          {item.value}
                        </div>
                        <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.45 }}>
                          {item.detail}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-2">
                    {recommended ? (
                      <Link
                        to={recommended.to}
                        className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5"
                        style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-surface-1)", backgroundColor: "var(--bp-copper)", textDecoration: "none", boxShadow: "0 16px 32px rgba(180,86,36,0.16)" }}
                      >
                        <Orbit size={14} />
                        {recommended.label}
                      </Link>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={buildEntityLineageUrl(activeEntity)}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-2"
                        style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", textDecoration: "none" }}
                      >
                        <Eye size={13} />
                        Open lineage
                      </Link>
                      {(isSuccessStatus(activeEntity.silverStatus) || isSuccessStatus(activeEntity.bronzeStatus)) ? (
                        <Link
                          to={buildEntityProfileUrl(activeEntity, isSuccessStatus(activeEntity.silverStatus) ? "silver" : "bronze")}
                          className="inline-flex items-center gap-1.5 rounded-full px-3 py-2"
                          style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", textDecoration: "none" }}
                        >
                          <Sparkles size={13} />
                          {isSuccessStatus(activeEntity.silverStatus) ? "Profile silver" : "Profile bronze"}
                        </Link>
                      ) : null}
                      <Link
                        to={buildEntityBlenderUrl(activeEntity, isSuccessStatus(activeEntity.silverStatus) ? "silver" : "bronze")}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-2"
                        style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", textDecoration: "none" }}
                      >
                        <BookOpen size={13} />
                        Open blender
                      </Link>
                      {sourceSql ? (
                        <Link
                          to={sourceSql}
                          className="inline-flex items-center gap-1.5 rounded-full px-3 py-2"
                          style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", textDecoration: "none" }}
                        >
                          <DatabaseZap size={13} />
                          Inspect source
                        </Link>
                      ) : null}
                    </div>
                    <Button variant="outline" className="h-10 rounded-full" onClick={() => setDetailEntity(activeEntity)}>
                      Inspect full asset detail
                    </Button>
                  </div>
                </>
              ) : blockedSelectedEntity && resolutionAction ? (
                <div className="space-y-4">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px]" style={{ background: "rgba(180,86,36,0.10)", color: "var(--bp-copper)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                      Held out of tool mode
                    </div>
                    <h2 className="mt-3 text-lg" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>
                      {blockedSelectedEntity.businessName || blockedSelectedEntity.tableName}
                    </h2>
                    <p className="mt-1 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                      This asset is blocked before full exploration. The rail keeps the fix path here instead of exposing broken tool actions.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {[
                      {
                        label: "Loaded",
                        value: `${getLoadedLayerCount(blockedSelectedEntity)}/3`,
                        detail: "managed layers ready",
                      },
                      {
                        label: "Resolution",
                        value: resolutionAction.label,
                        detail: resolutionAction.detail,
                      },
                    ].map((item) => (
                      <div key={item.label} className="rounded-[18px] px-3 py-3" style={{ border: "1px solid rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.85)" }}>
                        <div style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>
                          {item.label}
                        </div>
                        <div className="mt-1 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                          {item.value}
                        </div>
                        <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.45 }}>
                          {item.detail}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-2">
                    <Link
                      to={resolutionAction.to}
                      className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5"
                      style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-surface-1)", backgroundColor: "var(--bp-copper)", textDecoration: "none", boxShadow: "0 16px 32px rgba(180,86,36,0.16)" }}
                    >
                      <Orbit size={14} />
                      {resolutionAction.label}
                    </Link>
                    <Button variant="outline" className="h-10 rounded-full" onClick={() => setDetailEntity(blockedSelectedEntity)}>
                      Inspect full asset detail
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>
                    <Table2 className="h-7 w-7 gs-float" />
                  </div>
                  <div>
                    <div className="text-base font-semibold" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                      Operator rail
                    </div>
                    <p className="mt-2 max-w-xs text-sm" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                      Select one asset from the index. This rail then exposes the shortest path into lineage, profiling, blending, and source inspection.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(91,84,76,0.12)" }}>
            <CardContent className="p-4">
              <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                Pipeline posture
              </div>
              <h3 className="mt-2 text-base" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                Stage readiness at a glance
              </h3>
              <div className="mt-4 space-y-2.5">
                {selectedEntity ? (
                  [
                    { label: "Landing", status: selectedEntity.lzStatus || "none", loaded: selectedEntity.lzLastLoad },
                    { label: "Bronze", status: selectedEntity.bronzeStatus || "none", loaded: selectedEntity.bronzeLastLoad },
                    { label: "Silver", status: selectedEntity.silverStatus || "none", loaded: selectedEntity.silverLastLoad },
                    { label: "Relationship stage", status: activeEntity ? joinStatus?.status || "pending" : "blocked", loaded: activeEntity ? joinStatus?.lastUpdated : null },
                  ].map((stage) => (
                    <div key={stage.label} className="flex items-center justify-between rounded-[16px] border px-3 py-3" style={{ borderColor: "rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.86)" }}>
                      <div>
                        <div className="text-sm font-medium" style={{ color: "var(--bp-ink-primary)" }}>{stage.label}</div>
                        <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
                          {stage.loaded ? formatTimestamp(stage.loaded, { relative: true }) : "Awaiting signal"}
                        </div>
                      </div>
                      <StatusBadge status={stage.status} size="sm" />
                    </div>
                  ))
                ) : (
                  <div className="rounded-[20px] border px-4 py-5 text-sm" style={{ borderColor: "rgba(91,84,76,0.12)", background: "rgba(255,255,255,0.88)", color: "var(--bp-ink-secondary)" }}>
                    The stage rail appears once an asset is selected so the readiness gaps and the next operator move are visible without scanning the whole catalog.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(91,84,76,0.12)" }}>
            <CardContent className="p-4">
              <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                Provenance notes
              </div>
              <h3 className="mt-2 text-base" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                What is driving the grouping
              </h3>
              <div className="mt-4 space-y-3">
                {selectedEntity && joinCandidates.length > 0 ? (
                  joinCandidates.slice(0, 2).map((candidate) => (
                    <div key={`rail-${candidate.id}`} className="rounded-[18px] border px-3 py-3" style={{ borderColor: "rgba(45,106,79,0.16)", background: "rgba(45,106,79,0.05)" }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>{candidate.title}</div>
                        <span className="rounded-full px-2 py-1 text-[10px] font-medium" style={{ background: "rgba(45,106,79,0.10)", color: "var(--bp-operational)" }}>
                          {candidate.confidence}%
                        </span>
                      </div>
                      <div className="mt-1 text-[11px]" style={{ color: "var(--bp-operational)" }}>{candidate.joinLabel}</div>
                      <p className="mt-1 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>{candidate.explanation}</p>
                      {candidate.evidence && candidate.evidence.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {candidate.evidence.slice(0, 2).map((item) => (
                            <span
                              key={`rail-${candidate.id}-${item.label}`}
                              className="rounded-full px-2 py-1 text-[10px]"
                              style={{ background: "rgba(255,255,255,0.86)", color: "var(--bp-ink-secondary)", border: "1px solid rgba(45,106,79,0.12)" }}
                            >
                              {item.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : selectedEntity && relatedAssets.length > 0 ? (
                  relatedAssets.slice(0, 2).map((relationship) => (
                    <div key={`rail-${relationship.entity.id}`} className="rounded-[18px] border px-3 py-3" style={{ borderColor: "rgba(180,86,36,0.14)", background: "rgba(255,255,255,0.88)" }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                          {relationship.entity.businessName || relationship.entity.tableName}
                        </div>
                        <span className="rounded-full px-2 py-1 text-[10px] font-medium" style={{ background: "rgba(180,86,36,0.10)", color: "var(--bp-copper)" }}>
                          {relationship.confidence}
                        </span>
                      </div>
                      <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
                        {relationship.reasons.join(" · ")}
                      </p>
                      {relationship.evidence.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {relationship.evidence.slice(0, 2).map((item) => (
                            <span
                              key={`rail-${relationship.entity.id}-${item.label}`}
                              className="rounded-full px-2 py-1 text-[10px]"
                              style={{ background: "rgba(255,255,255,0.86)", color: "var(--bp-ink-secondary)", border: "1px solid rgba(180,86,36,0.12)" }}
                            >
                              {item.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-[20px] border px-4 py-5 text-sm" style={{ borderColor: "rgba(91,84,76,0.12)", background: "rgba(255,255,255,0.88)", color: "var(--bp-ink-secondary)" }}>
                    Once you focus an asset, this panel explains whether the atlas is relying on staged column evidence or lighter contextual similarity before the analyst turns it into documentation.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      {filtered.length > visibleEntities.length && (
        <p className="text-center text-xs" style={{ color: "var(--bp-ink-muted)" }}>
          Showing the first {visibleEntities.length} of {filtered.length} assets in the index. Use search or focus filters to narrow the view.
        </p>
      )}

      <EntityDetailModal entity={detailEntity} open={!!detailEntity} onClose={() => setDetailEntity(null)} />
    </div>
  );
}
