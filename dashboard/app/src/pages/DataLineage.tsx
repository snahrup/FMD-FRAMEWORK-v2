import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTimestamp, formatRowCount } from "@/lib/formatters";
import { getSourceColor } from "@/lib/layers";
import { resolveSourceLabel } from "@/hooks/useSourceConfig";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import { ExploreWorkbenchHeader } from "@/components/explore/ExploreWorkbenchHeader";
import { FocusedLineagePath, type FocusedLineageStage } from "@/components/explore/FocusedLineagePath";
import { PipelineResolutionPanel } from "@/components/explore/PipelineResolutionPanel";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Columns3,
  Crown,
  DatabaseZap,
  Eye,
  GitBranch,
  Network,
  Orbit,
  Search,
  Sparkles,
  Table2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MedallionLayer } from "@/types/governance";
import {
  buildEntityBlenderUrl,
  buildEntityCatalogUrl,
  buildEntityProfileUrl,
  buildEntitySourceSqlUrl,
  findEntityFromParams,
  getBlockedEntities,
  getEntityResolutionAction,
  getEntityRecommendedAction,
  getLoadedLayerCount,
  getToolReadyEntities,
  isEntityToolReady,
  isSuccessStatus,
} from "@/lib/exploreWorksurface";

type LineageLayerKey = FocusedLineageStage["key"];

interface LineageColumnSnapshot {
  columns?: { name: string }[];
  status?: string;
}

interface LineageColumnsResponse {
  entityId: number;
  entityName: string;
  source?: LineageColumnSnapshot;
  landing?: LineageColumnSnapshot;
  bronze?: LineageColumnSnapshot;
  silver?: LineageColumnSnapshot;
}

const STAGE_ORDER: LineageLayerKey[] = ["source", "landing", "bronze", "silver", "gold"];

const SYSTEM_COLUMNS = new Set([
  "HashedPKColumn",
  "HashedNonKeyColumns",
  "IsDeleted",
  "IsCurrent",
  "RecordStartDate",
  "RecordEndDate",
  "RecordModifiedDate",
  "RecordLoadDate",
]);

function labelForStage(stage: LineageLayerKey): string {
  if (stage === "source") return "Source";
  if (stage === "landing") return "Landing";
  if (stage === "bronze") return "Bronze";
  if (stage === "silver") return "Silver";
  return "Gold";
}

function columnsForStage(data: LineageColumnsResponse | null, stage: LineageLayerKey): string[] {
  if (!data || stage === "gold") return [];
  const snapshot = data[stage];
  return (snapshot?.columns || []).map((column) => column.name);
}

function determineFocusStage(entity: DigestEntity): LineageLayerKey {
  const errorLayer = entity.lastError?.layer?.toLowerCase();
  if (errorLayer === "landing" || errorLayer === "bronze" || errorLayer === "silver") {
    return errorLayer as LineageLayerKey;
  }
  if (isSuccessStatus(entity.silverStatus)) return "silver";
  if (isSuccessStatus(entity.bronzeStatus)) return "bronze";
  if (isSuccessStatus(entity.lzStatus)) return "landing";
  return "source";
}

function stageStatus(entity: DigestEntity, data: LineageColumnsResponse | null, stage: LineageLayerKey): string {
  if (stage === "source") return data?.source?.status || "loaded";
  if (stage === "landing") return data?.landing?.status || entity.lzStatus || "pending";
  if (stage === "bronze") return data?.bronze?.status || entity.bronzeStatus || "pending";
  if (stage === "silver") return data?.silver?.status || entity.silverStatus || "pending";
  return isSuccessStatus(entity.silverStatus) ? "pending" : "not_started";
}

function stageNarrative(
  stage: LineageLayerKey,
  entity: DigestEntity,
  currentColumns: string[],
  previousColumns: string[],
): { highlight: string; note: string; deltaFromPrevious?: string } {
  const added = currentColumns.filter((column) => !previousColumns.includes(column));
  const removed = previousColumns.filter((column) => !currentColumns.includes(column));

  if (stage === "source") {
    return {
      highlight: "Registered source contract",
      note: "The raw schema defines the starting point for every downstream handoff.",
    };
  }

  if (stage === "gold") {
    return isSuccessStatus(entity.silverStatus)
      ? {
          highlight: "Ready for modeled outputs",
          note: "Gold should now inherit the silver contract instead of re-discovering structure from scratch.",
          deltaFromPrevious: "awaiting model design",
        }
      : {
          highlight: "Not ready for gold",
          note: "Gold should remain blocked until the silver contract is stable.",
          deltaFromPrevious: "silver not ready",
        };
  }

  if (!currentColumns.length) {
    return {
      highlight: `Awaiting ${labelForStage(stage).toLowerCase()} handoff`,
      note: "This stage has not materialized yet, so the operator should resolve the upstream break before expecting downstream coverage.",
      deltaFromPrevious: "no load yet",
    };
  }

  if (added.length > 0) {
    return {
      highlight: `${added.length} field${added.length === 1 ? "" : "s"} introduced`,
      note: stage === "bronze"
        ? "Bronze is adding structural lineage fields and survivability metadata."
        : stage === "silver"
          ? "Silver is introducing serving-ready stewardship and temporal fields."
          : "This handoff changed the contract instead of simply carrying it forward.",
      deltaFromPrevious: `+${added.length} new`,
    };
  }

  if (removed.length > 0) {
    return {
      highlight: `${removed.length} field${removed.length === 1 ? "" : "s"} dropped`,
      note: "The contract narrowed at this step, so confirm the loss was intentional before consumers depend on it.",
      deltaFromPrevious: `-${removed.length} removed`,
    };
  }

  return {
    highlight: "Shape preserved",
    note: `The ${labelForStage(stage).toLowerCase()} handoff kept the prior contract intact, which is the fastest path to downstream trust.`,
    deltaFromPrevious: "no shape change",
  };
}

function lineageStateLabel(entity: DigestEntity): string {
  if (entity.lastError?.layer) return `${entity.lastError.layer} issue`;
  if (isSuccessStatus(entity.silverStatus)) return "silver ready";
  if (isSuccessStatus(entity.bronzeStatus)) return "stops before silver";
  if (isSuccessStatus(entity.lzStatus)) return "stops before bronze";
  return "source only";
}

function ColumnLineageRow({ col, layers }: { col: string; layers: MedallionLayer[] }) {
  const isSystem = SYSTEM_COLUMNS.has(col);
  const startsAt: MedallionLayer = isSystem
    ? (["IsDeleted", "IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "HashedNonKeyColumns"].includes(col) ? "silver" : "bronze")
    : "source";

  return (
    <div className="flex items-center gap-1 py-1 px-2 text-[11px] rounded transition-colors" style={{ fontFamily: "var(--bp-font-mono)" }}>
      <span className={cn("w-48 truncate", isSystem ? "italic" : "")} style={{ color: isSystem ? "var(--bp-ink-secondary)" : "var(--bp-ink-primary)" }}>{col}</span>
      {(["source", "landing", "bronze", "silver", "gold"] as MedallionLayer[]).map((layer) => {
        const present = layers.includes(layer);
        const isOrigin = layer === startsAt;
        return (
          <div key={layer} className="flex items-center gap-1">
            {layer !== "source" ? <ArrowRight className="h-3 w-3" style={{ color: present ? "var(--bp-ink-muted)" : "var(--bp-border)" }} /> : null}
            <div
              className={cn("w-16 h-5 rounded text-center text-[9px] leading-5 font-medium", present ? (isOrigin ? "font-semibold" : "opacity-80") : "")}
              style={present
                ? {
                    color: layer === "gold" ? "var(--bp-copper)" : "var(--bp-ink-primary)",
                    backgroundColor: layer === startsAt ? "rgba(180,86,36,0.14)" : "rgba(45,106,79,0.10)",
                    border: `1px solid ${layer === startsAt ? "rgba(180,86,36,0.25)" : "rgba(45,106,79,0.20)"}`,
                  }
                : { backgroundColor: "var(--bp-surface-inset)", color: "var(--bp-ink-muted)", opacity: 0.3, border: "1px solid transparent" }}
            >
              {present ? (isSystem && isOrigin ? "NEW" : "✓") : "—"}
            </div>
          </div>
        );
      })}
      <span
        className="ml-2 text-[9px] px-1.5 py-0.5 rounded"
        style={isSystem
          ? { backgroundColor: "rgba(180,86,36,0.10)", color: "var(--bp-copper)" }
          : { backgroundColor: "rgba(45,106,79,0.10)", color: "var(--bp-operational)" }}
      >
        {isSystem ? "computed" : "carried"}
      </span>
    </div>
  );
}

function EntityLineageDetail({ entity, onClose }: { entity: DigestEntity; onClose: () => void }) {
  const [activeStage, setActiveStage] = useState<LineageLayerKey>(() => determineFocusStage(entity));
  const [showColumnMatrix, setShowColumnMatrix] = useState(false);
  const [lineageData, setLineageData] = useState<LineageColumnsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setActiveStage(determineFocusStage(entity));
    setShowColumnMatrix(false);
  }, [entity]);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setFetchError(null);

    (async () => {
      try {
        const response = await fetch(`/api/lineage/columns/${entity.id}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as LineageColumnsResponse;
        if (!controller.signal.aborted) {
          setLineageData(data);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setFetchError(loadError instanceof Error ? loadError.message : "Failed to load lineage evidence");
          setLineageData(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [entity.id]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const recommended = useMemo(() => getEntityRecommendedAction(entity), [entity]);
  const sourceSql = useMemo(() => buildEntitySourceSqlUrl(entity), [entity]);
  const silverReady = isSuccessStatus(entity.silverStatus);
  const bronzeReady = isSuccessStatus(entity.bronzeStatus);
  const loadedLayers = getLoadedLayerCount(entity);

  const stages = useMemo<FocusedLineageStage[]>(() => (
    STAGE_ORDER.map((stage, index) => {
      const currentColumns = columnsForStage(lineageData, stage);
      const previousColumns = index > 0 ? columnsForStage(lineageData, STAGE_ORDER[index - 1]) : [];
      const narrative = stageNarrative(stage, entity, currentColumns, previousColumns);
      return {
        key: stage,
        label: labelForStage(stage),
        status: stageStatus(entity, lineageData, stage),
        columnCount: currentColumns.length,
        highlight: narrative.highlight,
        note: narrative.note,
        deltaFromPrevious: narrative.deltaFromPrevious,
      };
    })
  ), [entity, lineageData]);

  const activeStageMetrics = useMemo(() => {
    const stageIndex = STAGE_ORDER.indexOf(activeStage);
    const currentColumns = columnsForStage(lineageData, activeStage);
    const previousColumns = stageIndex > 0 ? columnsForStage(lineageData, STAGE_ORDER[stageIndex - 1]) : [];
    const addedColumns = currentColumns.filter((column) => !previousColumns.includes(column));
    const removedColumns = previousColumns.filter((column) => !currentColumns.includes(column));
    const carriedColumns = currentColumns.filter((column) => previousColumns.includes(column));
    return {
      currentColumns,
      previousColumns,
      addedColumns,
      removedColumns,
      carriedColumns,
    };
  }, [activeStage, lineageData]);

  const activeNarrative = useMemo(() => stageNarrative(
    activeStage,
    entity,
    activeStageMetrics.currentColumns,
    activeStageMetrics.previousColumns,
  ), [activeStage, activeStageMetrics.currentColumns, activeStageMetrics.previousColumns, entity]);

  const allColumns = useMemo(() => {
    const rows: { layer: MedallionLayer; columns: string[] }[] = [
      { layer: "source", columns: columnsForStage(lineageData, "source") },
      { layer: "landing", columns: columnsForStage(lineageData, "landing") },
      { layer: "bronze", columns: columnsForStage(lineageData, "bronze") },
      { layer: "silver", columns: columnsForStage(lineageData, "silver") },
    ];
    const unique = new Set<string>();
    rows.forEach((row) => row.columns.forEach((column) => unique.add(column)));
    return Array.from(unique)
      .sort((a, b) => {
        const aSystem = SYSTEM_COLUMNS.has(a);
        const bSystem = SYSTEM_COLUMNS.has(b);
        if (aSystem !== bSystem) return aSystem ? 1 : -1;
        return a.localeCompare(b);
      })
      .map((column) => ({
        column,
        layers: rows.filter((row) => row.columns.includes(column)).map((row) => row.layer),
      }));
  }, [lineageData]);

  return (
    <div className="space-y-4">
      <Card style={{ borderColor: "rgba(180,86,36,0.16)", backgroundColor: "var(--bp-surface-1)" }}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] px-2 py-1 rounded-full font-medium" style={{ color: getSourceColor(resolveSourceLabel(entity.source)), backgroundColor: `${getSourceColor(resolveSourceLabel(entity.source))}15` }}>
                  {resolveSourceLabel(entity.source)}
                </span>
                {entity.domain ? <span className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)" }}>{entity.domain}</span> : null}
                {entity.qualityTier ? <span className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: "rgba(45,106,79,0.10)", color: "var(--bp-operational)" }}>{entity.qualityTier} trust</span> : null}
              </div>
              <div className="mt-3 text-lg" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>
                {entity.businessName || `${entity.sourceSchema}.${entity.tableName}`}
              </div>
              <p className="mt-1 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                {entity.diagnosis || "Use the focused path to see where the chain changes and move directly into the next operator tool."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={entity.overall || "unknown"} size="sm" />
              <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 rounded-full p-0" aria-label="Close detail panel">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-4 text-[11px]">
            {[
              { label: "Loaded", value: `${loadedLayers}/3`, detail: "managed layers ready" },
              { label: "Focus", value: labelForStage(activeStage), detail: activeNarrative.highlight },
              { label: "Last signal", value: entity.lastError?.layer || "No active error", detail: entity.lastError ? "latest failure layer" : "digest is clean" },
              { label: "Next move", value: recommended.label, detail: recommended.detail },
            ].map((item) => (
              <div key={item.label} className="rounded-[18px] px-3 py-3" style={{ border: "1px solid rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.88)" }}>
                <div style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>{item.label}</div>
                <div className="mt-1 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>{item.value}</div>
                <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.45 }}>{item.detail}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={recommended.to} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2" style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-surface-1)", backgroundColor: "var(--bp-copper)", textDecoration: "none", boxShadow: "0 14px 28px rgba(180,86,36,0.16)" }}>
              <Orbit size={13} />
              {recommended.label}
            </Link>
            <Link to={buildEntityCatalogUrl(entity)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2" style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", textDecoration: "none" }}>
              <Network size={13} />
              Open catalog
            </Link>
            <Link to={buildEntityBlenderUrl(entity, activeStage === "landing" ? "landing" : activeStage === "bronze" ? "bronze" : "silver")} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2" style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", textDecoration: "none" }}>
              <Sparkles size={13} />
              Open blender
            </Link>
            {silverReady ? (
              <Link to={buildEntityProfileUrl(entity, "silver")} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2" style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", textDecoration: "none" }}>
                <Bot size={13} />
                Profile silver
              </Link>
            ) : bronzeReady ? (
              <Link to={buildEntityProfileUrl(entity, "bronze")} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2" style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", textDecoration: "none" }}>
                <Bot size={13} />
                Profile bronze
              </Link>
            ) : null}
            {sourceSql ? (
              <Link to={sourceSql} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2" style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", textDecoration: "none" }}>
                <DatabaseZap size={13} />
                Inspect source
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <FocusedLineagePath stages={stages} activeStage={activeStage} onSelectStage={setActiveStage} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(91,84,76,0.12)" }}>
            <CardContent className="p-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                    <GitBranch className="h-3.5 w-3.5" />
                    Break signal
                  </div>
                  <h3 className="mt-2 text-base" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                    Where the chain is asking for attention
                  </h3>
                  <div className="mt-4 rounded-[20px] border px-4 py-4" style={{ borderColor: "rgba(180,86,36,0.14)", background: "rgba(255,255,255,0.88)" }}>
                    <div className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                      {entity.lastError
                        ? `${entity.lastError.layer} reported the most recent failure`
                        : silverReady
                          ? "The chain has reached silver and is ready for downstream use"
                          : `${labelForStage(activeStage)} is the current operator focus`}
                    </div>
                    <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                      {entity.diagnosis || activeNarrative.note}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                    <Columns3 className="h-3.5 w-3.5" />
                    Contract shift
                  </div>
                  <h3 className="mt-2 text-base" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                    What changed at {labelForStage(activeStage).toLowerCase()}
                  </h3>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
                    {[
                      { label: "Columns here", value: activeStageMetrics.currentColumns.length, detail: "currently materialized" },
                      { label: "Introduced", value: activeStageMetrics.addedColumns.length, detail: "new at this stage" },
                      { label: "Dropped", value: activeStageMetrics.removedColumns.length, detail: "missing from prior stage" },
                    ].map((item) => (
                      <div key={item.label} className="rounded-[18px] px-3 py-3" style={{ border: "1px solid rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.88)" }}>
                        <div style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>{item.label}</div>
                        <div className="mt-1 text-lg font-semibold" style={{ color: "var(--bp-ink-primary)" }}>{item.value}</div>
                        <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>{item.detail}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(activeStageMetrics.addedColumns.length > 0 ? activeStageMetrics.addedColumns : activeStageMetrics.currentColumns).slice(0, 6).map((column) => (
                      <span
                        key={column}
                        className="rounded-full px-2.5 py-1 text-[10px]"
                        style={{
                          background: SYSTEM_COLUMNS.has(column) ? "rgba(180,86,36,0.10)" : "rgba(45,106,79,0.10)",
                          color: SYSTEM_COLUMNS.has(column) ? "var(--bp-copper)" : "var(--bp-operational)",
                        }}
                      >
                        {column}
                      </span>
                    ))}
                    {activeStageMetrics.currentColumns.length === 0 ? <span className="text-[12px]" style={{ color: "var(--bp-ink-secondary)" }}>No materialized columns at this stage yet.</span> : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {showColumnMatrix ? (
            <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(91,84,76,0.12)" }}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                      <Columns3 className="h-3.5 w-3.5" />
                      Column matrix
                    </div>
                    <h3 className="mt-2 text-base" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                      Full carry-forward view
                    </h3>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 rounded-full px-4 text-xs" onClick={() => setShowColumnMatrix(false)}>
                    Hide matrix
                  </Button>
                </div>
                <div className="mt-4 max-h-[420px] overflow-y-auto">
                  <div className="flex items-center gap-1 py-1 px-2 text-[9px] font-medium uppercase tracking-wider sticky top-0 z-10" style={{ color: "var(--bp-ink-tertiary)", backgroundColor: "var(--bp-surface-1)" }}>
                    <span className="w-48">Column</span>
                    {(["source", "landing", "bronze", "silver", "gold"] as MedallionLayer[]).map((layer) => (
                      <div key={layer} className="flex items-center gap-1">
                        {layer !== "source" ? <span className="w-3" /> : null}
                        <span className="w-16 text-center">{labelForStage(layer as LineageLayerKey).slice(0, 6)}</span>
                      </div>
                    ))}
                    <span className="ml-2 w-16">Type</span>
                  </div>
                  <div className="space-y-0.5">
                    {allColumns.map((row) => (
                      <ColumnLineageRow key={row.column} col={row.column} layers={row.layers} />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(91,84,76,0.12)" }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                <Eye className="h-3.5 w-3.5" />
                Stage evidence
              </div>
              <h3 className="mt-2 text-base" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                Evidence for {labelForStage(activeStage).toLowerCase()}
              </h3>
              <div className="mt-4 space-y-3">
                {loading ? (
                  <div className="rounded-[20px] border px-4 py-5 text-sm" style={{ borderColor: "rgba(91,84,76,0.12)", background: "rgba(255,255,255,0.88)", color: "var(--bp-ink-secondary)" }}>
                    Loading lineage evidence for the selected entity.
                  </div>
                ) : fetchError ? (
                  <div className="rounded-[20px] border px-4 py-5 text-sm" style={{ borderColor: "rgba(185,58,42,0.22)", background: "var(--bp-fault-light)", color: "var(--bp-fault)" }}>
                    {fetchError}
                  </div>
                ) : (
                  <>
                    <div className="rounded-[18px] border px-3 py-3" style={{ borderColor: "rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.88)" }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>{activeNarrative.highlight}</div>
                        <StatusBadge status={stageStatus(entity, lineageData, activeStage)} size="sm" />
                      </div>
                      <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>{activeNarrative.note}</p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      {[
                        { label: "Current", value: activeStageMetrics.currentColumns.length, detail: "columns here" },
                        { label: "New", value: activeStageMetrics.addedColumns.length, detail: "introduced now" },
                        { label: "Carry", value: activeStageMetrics.carriedColumns.length, detail: "carried forward" },
                      ].map((item) => (
                        <div key={item.label} className="rounded-[16px] px-3 py-3" style={{ border: "1px solid rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.88)" }}>
                          <div style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>{item.label}</div>
                          <div className="mt-1 text-lg font-semibold" style={{ color: "var(--bp-ink-primary)" }}>{item.value}</div>
                          <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>{item.detail}</div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {(activeStageMetrics.addedColumns.length > 0 ? activeStageMetrics.addedColumns : activeStageMetrics.currentColumns).slice(0, 8).map((column) => (
                        <span key={`evidence-${column}`} className="rounded-full px-2.5 py-1 text-[10px]" style={{ background: SYSTEM_COLUMNS.has(column) ? "rgba(180,86,36,0.10)" : "rgba(45,106,79,0.10)", color: SYSTEM_COLUMNS.has(column) ? "var(--bp-copper)" : "var(--bp-operational)" }}>
                          {column}
                        </span>
                      ))}
                      {activeStageMetrics.currentColumns.length === 0 ? <span className="text-[12px]" style={{ color: "var(--bp-ink-secondary)" }}>No materialized columns for this stage yet.</span> : null}
                    </div>

                    <Button variant="outline" className="h-10 w-full rounded-full" onClick={() => setShowColumnMatrix((current) => !current)}>
                      <Columns3 className="mr-2 h-4 w-4" />
                      {showColumnMatrix ? "Hide full column matrix" : "Inspect full column matrix"}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(91,84,76,0.12)" }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                <Table2 className="h-3.5 w-3.5" />
                Readiness rail
              </div>
              <h3 className="mt-2 text-base" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                Stage posture
              </h3>
              <div className="mt-4 space-y-2.5">
                {[
                  { label: "Landing", status: entity.lzStatus || "none", loaded: entity.lzLastLoad },
                  { label: "Bronze", status: entity.bronzeStatus || "none", loaded: entity.bronzeLastLoad },
                  { label: "Silver", status: entity.silverStatus || "none", loaded: entity.silverLastLoad },
                  { label: "Gold", status: silverReady ? "pending" : "not_started", loaded: null },
                ].map((stage) => (
                  <div key={stage.label} className="flex items-center justify-between rounded-[16px] border px-3 py-3" style={{ borderColor: "rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.86)" }}>
                    <div>
                      <div className="text-sm font-medium" style={{ color: "var(--bp-ink-primary)" }}>{stage.label}</div>
                      <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>{stage.loaded ? formatTimestamp(stage.loaded, { relative: true }) : "Awaiting signal"}</div>
                    </div>
                    <StatusBadge status={stage.status} size="sm" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function DataLineage() {
  const { allEntities, loading: digestLoading, error } = useEntityDigest();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [focusFilter, setFocusFilter] = useState<"all" | "trusted">("all");
  const [selectedEntity, setSelectedEntity] = useState<DigestEntity | null>(null);
  const toolReadyEntities = useMemo(() => getToolReadyEntities(allEntities), [allEntities]);
  const blockedEntities = useMemo(() => getBlockedEntities(allEntities), [allEntities]);
  const blockedSelectedEntity = selectedEntity && !isEntityToolReady(selectedEntity) ? selectedEntity : null;
  const activeEntity = selectedEntity && isEntityToolReady(selectedEntity) ? selectedEntity : null;
  const sources = useMemo(() => {
    const set = new Set<string>();
    toolReadyEntities.forEach((entity) => {
      if (entity.source) set.add(entity.source);
    });
    return Array.from(set).sort();
  }, [toolReadyEntities]);

  const filtered = useMemo(() => {
    const result = toolReadyEntities.filter((entity) => {
      if (sourceFilter !== "all" && entity.source !== sourceFilter) return false;
      if (search) {
        const query = search.toLowerCase();
        const matches = (
          entity.tableName?.toLowerCase().includes(query) ||
          entity.sourceSchema?.toLowerCase().includes(query) ||
          entity.source?.toLowerCase().includes(query) ||
          entity.businessName?.toLowerCase().includes(query) ||
          entity.domain?.toLowerCase().includes(query)
        );
        if (!matches) return false;
      }

      if (focusFilter === "trusted") {
        return (entity.qualityScore || 0) >= 80 || entity.qualityTier === "silver";
      }
      return true;
    });

    return result.sort((a, b) => {
      const aTrust = (a.qualityScore || 0);
      const bTrust = (b.qualityScore || 0);
      if (aTrust !== bTrust) return bTrust - aTrust;
      return a.tableName.localeCompare(b.tableName);
    });
  }, [focusFilter, search, sourceFilter, toolReadyEntities]);

  const totalEntities = allEntities.length;
  const withLanding = allEntities.filter((entity) => isSuccessStatus(entity.lzStatus)).length;
  const withBronze = allEntities.filter((entity) => isSuccessStatus(entity.bronzeStatus)).length;
  const withSilver = allEntities.filter((entity) => isSuccessStatus(entity.silverStatus)).length;
  const fullChain = toolReadyEntities.length;
  const blockedCount = blockedEntities.length;
  const trustedCount = toolReadyEntities.filter((entity) => (entity.qualityScore || 0) >= 80 || entity.qualityTier === "silver").length;
  const visibleEntities = filtered.slice(0, 180);

  const handleSelectEntity = useCallback((entity: DigestEntity | null) => {
    setSelectedEntity(entity);
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

  useEffect(() => {
    if (!selectedEntity) return;
    if (isEntityToolReady(selectedEntity) && !filtered.some((entity) => entity.id === selectedEntity.id)) {
      setSelectedEntity(null);
    }
  }, [filtered, selectedEntity]);

  const resolutionAction = blockedSelectedEntity ? getEntityResolutionAction(blockedSelectedEntity) : null;

  return (
    <div className="space-y-6 gs-page-enter" style={{ padding: "28px 32px", maxWidth: "1500px", margin: "0 auto" }}>
      <ExploreWorkbenchHeader
        title="Data Lineage"
        summary="Follow one tool-ready entity chain, spot the contract shift, and move into the next diagnostic step with the right context already carried forward."
        meta={`${formatRowCount(filtered.length)} tool-ready chains currently in view`}
        facts={[
          { label: "Tool-Ready Chains", value: `${formatRowCount(fullChain)} / ${formatRowCount(totalEntities)}`, detail: "Only full-chain entities are allowed into lineage tool mode.", tone: "positive" },
          { label: "Blocked Assets", value: formatRowCount(blockedCount), detail: "Incomplete chains are routed to Load Center instead of this page.", tone: blockedCount > 0 ? "warning" : "positive" },
          { label: "Landing Coverage", value: `${totalEntities ? ((withLanding / totalEntities) * 100).toFixed(0) : 0}%`, detail: "Source registration that has at least reached landing.", tone: "neutral" },
          { label: "Trusted", value: formatRowCount(trustedCount), detail: "Higher-confidence chains worth operational focus first.", tone: trustedCount > 0 ? "positive" : "neutral" },
        ]}
        actions={[
          { label: "Explore hub", to: "/explore", tone: "quiet", icon: Search },
          { label: "Trusted only", onClick: () => setFocusFilter("trusted"), tone: focusFilter === "trusted" ? "primary" : "secondary", icon: Crown },
          blockedCount > 0 ? { label: "Open Load Center", to: "/load-center", tone: "secondary", icon: Orbit } : undefined,
          focusFilter !== "all" ? { label: "Clear focus", onClick: () => setFocusFilter("all"), tone: "quiet" } : undefined,
        ].filter(Boolean) as never[]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--bp-ink-muted)" }} />
          <Input
            placeholder="Search lineage by table, schema, source, or domain..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 pl-9 text-sm"
            aria-label="Search lineage entities"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant={sourceFilter === "all" ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setSourceFilter("all")}>
            All sources
          </Button>
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
            { key: "all", label: "All chains" },
            { key: "trusted", label: `Trusted (${trustedCount})` },
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
        </div>
      </div>

      {error ? (
        <Card style={{ border: "1px solid rgba(185,58,42,0.24)", backgroundColor: "var(--bp-fault-light)" }}>
          <CardContent className="flex items-center gap-3 p-5">
            <AlertCircle className="h-5 w-5 shrink-0" style={{ color: "var(--bp-fault)" }} />
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--bp-fault)" }}>Failed to load entity digest</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--bp-ink-secondary)" }}>{error}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {blockedCount > 0 ? (
        <Card style={{ border: "1px solid rgba(180,86,36,0.16)", backgroundColor: "rgba(180,86,36,0.04)" }}>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="text-[11px]" style={{ color: "var(--bp-copper)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                  Tool readiness gate
                </div>
                <h2 className="mt-2 text-lg" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                  Incomplete chains are held out until the import path is complete
                </h2>
                <p className="mt-2 text-sm" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.65 }}>
                  {formatRowCount(blockedCount)} registered entities are not shown as selectable lineage paths because they still stop before the full managed chain. Load Center is the single place to finish those imports.
                </p>
              </div>
              <Link
                to="/load-center"
                className="inline-flex items-center gap-2 rounded-full px-4 py-2.5"
                style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-surface-1)", backgroundColor: "var(--bp-copper)", textDecoration: "none" }}
              >
                <Orbit size={14} />
                Open Load Center
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className={cn("grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]")}>
        <Card style={{ backgroundColor: "var(--bp-surface-1)", borderColor: "rgba(91,84,76,0.12)" }}>
          <CardContent className="p-0">
            <div className="border-b px-4 py-4" style={{ borderColor: "rgba(91,84,76,0.10)" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                    Chain queue
                  </div>
                  <h2 className="mt-2 text-lg" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                    Select the path that matters now
                  </h2>
                </div>
                <div className="rounded-full px-3 py-1 text-[11px]" style={{ background: "rgba(91,84,76,0.08)", color: "var(--bp-ink-secondary)" }}>
                  {formatRowCount(visibleEntities.length)} shown
                </div>
              </div>
              <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
                Only full-chain entities are selectable here. Incomplete imports stay in Load Center until the path is actually usable.
              </p>
            </div>
            <div className="max-h-[calc(100vh-350px)] overflow-y-auto p-3">
              {digestLoading ? (
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
                  No entities match your current filters.
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleEntities.map((entity, index) => {
                    const isFocused = selectedEntity?.id === entity.id;
                    const sourceColor = getSourceColor(resolveSourceLabel(entity.source));
                    return (
                      <button
                        key={entity.id}
                        type="button"
                        className="gs-stagger-card w-full rounded-[20px] border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-[2px]"
                        style={{
                          "--i": Math.min(index, 15),
                          borderColor: isFocused ? "rgba(180,86,36,0.24)" : "rgba(91,84,76,0.12)",
                          background: isFocused ? "linear-gradient(180deg, rgba(180,86,36,0.10) 0%, rgba(255,255,255,0.98) 100%)" : "rgba(255,255,255,0.88)",
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
                              {entity.sourceSchema}.{entity.tableName}
                            </div>
                          </div>
                          <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: `${sourceColor}15`, color: sourceColor }}>
                            {resolveSourceLabel(entity.source)}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
                          <span>{lineageStateLabel(entity)}</span>
                          <span>{getLoadedLayerCount(entity)}/3 layers</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex gap-1.5">
                            <StatusBadge status={entity.lzStatus || "none"} size="sm" showIcon={false} />
                            <StatusBadge status={entity.bronzeStatus || "none"} size="sm" showIcon={false} />
                            <StatusBadge status={entity.silverStatus || "none"} size="sm" showIcon={false} />
                          </div>
                          <span className="text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
                            {entity.lastError ? entity.lastError.layer : entity.silverLastLoad ? formatTimestamp(entity.silverLastLoad, { relative: true }) : "awaiting silver"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {activeEntity ? (
          <EntityLineageDetail entity={activeEntity} onClose={() => handleSelectEntity(null)} />
        ) : blockedSelectedEntity && resolutionAction ? (
          <PipelineResolutionPanel
            entity={blockedSelectedEntity}
            action={resolutionAction}
            summary="This entity stops before a full managed chain exists. Lineage stays honest and routes you to Load Center instead of rendering an incomplete path as if it were actionable."
          />
        ) : (
          <section className="rounded-[28px] border" style={{ borderColor: "rgba(91,84,76,0.14)", background: "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,242,237,0.96) 100%)" }}>
            <div className="flex min-h-[500px] flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>
                <GitBranch className="h-8 w-8 gs-float" />
              </div>
              <div>
                <div className="text-base font-semibold" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                  Focus one lineage path
                </div>
                <p className="mt-2 max-w-md text-sm" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.65 }}>
                  Select an entity from the queue. The detail surface will then show where the contract starts, what each layer adds, and which tool should take over next.
                </p>
              </div>
            </div>
          </section>
        )}
      </div>

      {filtered.length > visibleEntities.length ? (
        <p className="text-center text-xs" style={{ color: "var(--bp-ink-muted)" }}>
          Showing the first {visibleEntities.length} of {filtered.length} entities in the queue. Use search or focus filters to narrow the scope.
        </p>
      ) : null}
    </div>
  );
}
