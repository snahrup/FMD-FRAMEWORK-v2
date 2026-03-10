// ============================================================================
// ImpactPulse — Living architecture diagram with animated particle flows
//
// A full-bleed React Flow canvas showing data movement through the FMD
// medallion layers. Source systems fan into Landing Zone, then cascade
// through Bronze, Silver, and Gold. Animated edges pulse with activity,
// nodes glow when pipelines are running, and a slide-out drawer shows
// layer details on click.
// ============================================================================

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Radar,
  RefreshCw,
  X,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Circle,
  Loader2,
  AlertCircle,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useEntityDigest,
  type DigestEntity,
  type DigestSource,
} from "@/hooks/useEntityDigest";
import { getSourceColor, LAYERS, SOURCE_COLORS } from "@/lib/layers";
import LayerNodeComponent, { type LayerNodeData } from "@/components/impact-pulse/LayerNode";
import AnimatedEdgeComponent, { type AnimatedEdgeData } from "@/components/impact-pulse/AnimatedEdge";

// ── Constants ──

const API = import.meta.env.VITE_API_URL || "";

const nodeTypes: NodeTypes = {
  layerNode: LayerNodeComponent,
};

const edgeTypes: EdgeTypes = {
  animated: AnimatedEdgeComponent,
};

// ── Live Monitor Types ──

interface PipelineEvent {
  PipelineName: string;
  LogType: string;
  LogDateTime: string;
  LogData: string | null;
  PipelineRunGuid: string;
  EntityLayer: string;
}

interface NotebookEvent {
  NotebookName: string;
  LogType: string;
  LogDateTime: string;
  LogData: string | null;
  EntityId: string | null;
  EntityLayer: string;
  PipelineRunGuid: string;
}

interface CopyEvent {
  CopyActivityName: string;
  EntityName: string;
  LogType: string;
  LogDateTime: string;
  LogData: string | null;
  EntityId: string | null;
  EntityLayer: string;
  PipelineRunGuid: string;
}

interface LiveData {
  pipelineEvents: PipelineEvent[];
  notebookEvents: NotebookEvent[];
  copyEvents: CopyEvent[];
  serverTime: string;
}

type AnyEvent = PipelineEvent | NotebookEvent | CopyEvent;

// ── Status Helpers ──

const STATUS_META: Record<string, { color: string; icon: typeof CheckCircle2; label: string }> = {
  complete: { color: "text-emerald-400", icon: CheckCircle2, label: "Complete" },
  partial: { color: "text-amber-400", icon: Clock, label: "Partial" },
  pending: { color: "text-blue-400", icon: Clock, label: "Pending" },
  error: { color: "text-red-400", icon: AlertTriangle, label: "Error" },
  not_started: { color: "text-muted-foreground/40", icon: Circle, label: "Not Started" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_META[status] || STATUS_META.not_started;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${s.color}`}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

function shortTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Layer Stats Computation ──

interface LayerStats {
  total: number;
  loaded: number;
  error: number;
  pending: number;
}

function computeLayerStats(allEntities: DigestEntity[]): Record<string, LayerStats> {
  const stats: Record<string, LayerStats> = {
    lz: { total: 0, loaded: 0, error: 0, pending: 0 },
    bronze: { total: 0, loaded: 0, error: 0, pending: 0 },
    silver: { total: 0, loaded: 0, error: 0, pending: 0 },
    gold: { total: 0, loaded: 0, error: 0, pending: 0 },
  };

  for (const e of allEntities) {
    // Landing Zone
    stats.lz.total++;
    if (e.lzStatus === "loaded") stats.lz.loaded++;
    else if (e.lzStatus === "pending") stats.lz.pending++;
    if (e.lastError?.layer === "landing") stats.lz.error++;

    // Bronze
    if (e.bronzeId !== null) {
      stats.bronze.total++;
      if (e.bronzeStatus === "loaded") stats.bronze.loaded++;
      else if (e.bronzeStatus === "pending") stats.bronze.pending++;
      if (e.lastError?.layer === "bronze") stats.bronze.error++;
    }

    // Silver
    if (e.silverId !== null) {
      stats.silver.total++;
      if (e.silverStatus === "loaded") stats.silver.loaded++;
      else if (e.silverStatus === "pending") stats.silver.pending++;
      if (e.lastError?.layer === "silver") stats.silver.error++;
    }
  }

  return stats;
}

// Determine if a layer has recent activity (within last 5 minutes)
function isLayerActive(liveEvents: AnyEvent[], layerKeyword: string): boolean {
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  return liveEvents.some((e) => {
    const layer = (e as { EntityLayer?: string }).EntityLayer || "";
    const time = (e as { LogDateTime?: string }).LogDateTime;
    if (!time) return false;
    const ts = new Date(time.endsWith("Z") ? time : time + "Z").getTime();
    return layer.toLowerCase().includes(layerKeyword.toLowerCase()) && ts > fiveMinAgo;
  });
}

// ── Drawer Component ──

function LayerDrawer({
  nodeId,
  nodeLabel,
  nodeColor,
  stats,
  allEntities,
  liveEvents,
  sourceList,
  onClose,
}: {
  nodeId: string;
  nodeLabel: string;
  nodeColor: string;
  stats: LayerStats;
  allEntities: DigestEntity[];
  liveEvents: AnyEvent[];
  sourceList: DigestSource[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as globalThis.Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Figure out what entities belong to this node
  const relevantEntities = useMemo(() => {
    // Source nodes
    if (nodeId.startsWith("source-")) {
      const sourceKey = nodeId.replace("source-", "");
      const src = sourceList.find((s) => s.key === sourceKey);
      return src?.entities || [];
    }

    // Layer nodes — filter based on layer status
    const layerKey = nodeId; // lz, bronze, silver, gold
    return allEntities.filter((e) => {
      if (layerKey === "lz") return true; // all entities have LZ
      if (layerKey === "bronze") return e.bronzeId !== null;
      if (layerKey === "silver") return e.silverId !== null;
      return false;
    });
  }, [nodeId, allEntities, sourceList]);

  // Sort: errors first, then pending, then loaded
  const sortedEntities = useMemo(() => {
    const order = ["error", "partial", "pending", "complete", "not_started"];
    return [...relevantEntities].sort((a, b) => {
      const ai = order.indexOf(a.overall);
      const bi = order.indexOf(b.overall);
      if (ai !== bi) return ai - bi;
      return a.tableName.localeCompare(b.tableName);
    });
  }, [relevantEntities]);

  // Recent events matching this layer/source
  const recentEvents = useMemo(() => {
    const keyword = nodeId.startsWith("source-") ? "" : nodeId;
    return liveEvents
      .filter((e) => {
        const layer = (e as { EntityLayer?: string }).EntityLayer || "";
        if (keyword && !layer.toLowerCase().includes(keyword)) return false;
        return true;
      })
      .slice(0, 15);
  }, [liveEvents, nodeId]);

  const progressPct = stats.total > 0 ? Math.round((stats.loaded / stats.total) * 100) : 0;

  return (
    <div
      ref={panelRef}
      className="fixed top-0 right-0 h-full w-[400px] z-[300] bg-card border-l border-border/50 shadow-2xl flex flex-col animate-[slideInRight_0.25s_ease-out]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: nodeColor }} />
          <div>
            <h2 className="text-sm font-semibold text-foreground">{nodeLabel}</h2>
            <p className="text-[10px] text-muted-foreground/60">
              {stats.total.toLocaleString()} entities
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-5 py-3 border-b border-border/20 flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-muted-foreground/60">Progress</span>
          <span className="text-[10px] font-mono text-foreground">{progressPct}%</span>
        </div>
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              backgroundColor: nodeColor,
            }}
          />
        </div>
        <div className="flex items-center gap-3 mt-2">
          {stats.loaded > 0 && (
            <span className="text-[10px] font-medium text-emerald-400">
              {stats.loaded.toLocaleString()} loaded
            </span>
          )}
          {stats.pending > 0 && (
            <span className="text-[10px] font-medium text-blue-400">
              {stats.pending.toLocaleString()} pending
            </span>
          )}
          {stats.error > 0 && (
            <span className="text-[10px] font-medium text-red-400">
              {stats.error.toLocaleString()} errors
            </span>
          )}
        </div>
      </div>

      {/* Recent activity */}
      {recentEvents.length > 0 && (
        <div className="px-5 py-3 border-b border-border/20 flex-shrink-0 max-h-[200px] overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-2">
            Recent Activity
          </p>
          {recentEvents.map((evt, i) => {
            const name = (evt as PipelineEvent).PipelineName
              || (evt as NotebookEvent).NotebookName
              || (evt as CopyEvent).CopyActivityName
              || "Event";
            const logType = (evt as { LogType?: string }).LogType || "";
            const time = (evt as { LogDateTime?: string }).LogDateTime || "";
            return (
              <div key={i} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <Activity className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                  <span className="text-[10px] text-foreground truncate">{name}</span>
                  <span className={cn(
                    "text-[9px] font-mono px-1 py-0.5 rounded",
                    logType === "Error" ? "bg-red-500/10 text-red-400" :
                    logType === "End" ? "bg-emerald-500/10 text-emerald-400" :
                    "bg-muted text-muted-foreground/60",
                  )}>
                    {logType}
                  </span>
                </div>
                <span className="text-[9px] text-muted-foreground/40 flex-shrink-0 ml-2">
                  {shortTime(time)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Entity list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-2 sticky top-0 bg-card/95 backdrop-blur-sm z-10">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
            Entities ({sortedEntities.length})
          </p>
        </div>
        {sortedEntities.map((entity) => (
          <div
            key={entity.id}
            className="flex items-center justify-between px-5 py-2 border-b border-border/10 hover:bg-muted/50 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <span className="text-xs font-mono text-foreground truncate block">
                {entity.tableName}
              </span>
              {entity.sourceSchema !== "dbo" && (
                <span className="text-[10px] text-muted-foreground/40">{entity.sourceSchema}</span>
              )}
            </div>
            <StatusBadge status={entity.overall} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ImpactPulse() {
  const { data, loading, error, refresh, allEntities, sourceList, totalSummary } = useEntityDigest();
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // ── Fetch live events every 30 seconds ──
  useEffect(() => {
    const fetchLive = async () => {
      try {
        const res = await fetch(`${API}/api/live-monitor?minutes=30`);
        if (res.ok) {
          const d = await res.json();
          setLiveData(d);
        }
      } catch {
        // Silent — live data is supplementary
      }
    };
    fetchLive();
    const interval = setInterval(fetchLive, 30000);
    return () => clearInterval(interval);
  }, []);

  // Merge all live events into a single timeline
  const allLiveEvents: AnyEvent[] = useMemo(() => {
    if (!liveData) return [];
    return [
      ...(liveData.pipelineEvents || []),
      ...(liveData.notebookEvents || []),
      ...(liveData.copyEvents || []),
    ].sort((a, b) => {
      const ta = (a as { LogDateTime?: string }).LogDateTime || "";
      const tb = (b as { LogDateTime?: string }).LogDateTime || "";
      return tb.localeCompare(ta); // newest first
    });
  }, [liveData]);

  // ── Compute layer stats from digest data ──
  const layerStats = useMemo(() => computeLayerStats(allEntities), [allEntities]);

  // ── Build source stats ──
  const sourceStats = useMemo(() => {
    const map: Record<string, LayerStats> = {};
    for (const src of sourceList) {
      map[src.key] = {
        total: src.summary.total,
        loaded: src.summary.complete + src.summary.partial,
        error: src.summary.error,
        pending: src.summary.pending + src.summary.not_started,
      };
    }
    return map;
  }, [sourceList]);

  // ── Activity detection ──
  const layerActivity = useMemo(() => ({
    lz: isLayerActive(allLiveEvents, "landing") || isLayerActive(allLiveEvents, "LZ") || isLayerActive(allLiveEvents, "Landingzone"),
    bronze: isLayerActive(allLiveEvents, "bronze"),
    silver: isLayerActive(allLiveEvents, "silver"),
    gold: isLayerActive(allLiveEvents, "gold"),
  }), [allLiveEvents]);

  const isSourceActive = useCallback((sourceName: string) => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    return allLiveEvents.some((e) => {
      const name = (e as CopyEvent).EntityName || (e as NotebookEvent).NotebookName || "";
      const time = (e as { LogDateTime?: string }).LogDateTime;
      if (!time) return false;
      const ts = new Date(time.endsWith("Z") ? time : time + "Z").getTime();
      return name.toLowerCase().includes(sourceName.toLowerCase()) && ts > fiveMinAgo;
    });
  }, [allLiveEvents]);

  // ── Build React Flow nodes ──
  const nodes: Node[] = useMemo(() => {
    if (!data || sourceList.length === 0) return [];

    const sources: Node[] = sourceList.map((s, i) => ({
      id: `source-${s.key}`,
      type: "layerNode",
      position: { x: 50, y: 100 + i * 140 },
      data: {
        label: s.name,
        type: "source",
        color: getSourceColor(s.name),
        entityCount: s.summary.total,
        loadedCount: s.summary.complete + s.summary.partial,
        errorCount: s.summary.error,
        isActive: isSourceActive(s.name),
      } satisfies LayerNodeData,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }));

    // Center the layer nodes vertically relative to source spread
    const sourceSpread = sourceList.length * 140;
    const centerY = 100 + (sourceSpread - 140) / 2;

    const layers: Node[] = [
      {
        id: "lz",
        type: "layerNode",
        position: { x: 350, y: centerY },
        data: {
          label: "Landing Zone",
          type: "layer",
          color: "#3b82f6",
          entityCount: layerStats.lz.total,
          loadedCount: layerStats.lz.loaded,
          errorCount: layerStats.lz.error,
          isActive: layerActivity.lz,
        } satisfies LayerNodeData,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
      {
        id: "bronze",
        type: "layerNode",
        position: { x: 650, y: centerY },
        data: {
          label: "Bronze",
          type: "layer",
          color: "#f59e0b",
          entityCount: layerStats.bronze.total,
          loadedCount: layerStats.bronze.loaded,
          errorCount: layerStats.bronze.error,
          isActive: layerActivity.bronze,
        } satisfies LayerNodeData,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
      {
        id: "silver",
        type: "layerNode",
        position: { x: 950, y: centerY },
        data: {
          label: "Silver",
          type: "layer",
          color: "#8b5cf6",
          entityCount: layerStats.silver.total,
          loadedCount: layerStats.silver.loaded,
          errorCount: layerStats.silver.error,
          isActive: layerActivity.silver,
        } satisfies LayerNodeData,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
      {
        id: "gold",
        type: "layerNode",
        position: { x: 1250, y: centerY },
        data: {
          label: "Gold",
          type: "layer",
          color: "#10b981",
          entityCount: layerStats.gold.total,
          loadedCount: layerStats.gold.loaded,
          errorCount: layerStats.gold.error,
          isActive: layerActivity.gold,
        } satisfies LayerNodeData,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
    ];

    return [...sources, ...layers];
  }, [data, sourceList, layerStats, layerActivity, isSourceActive]);

  // ── Build React Flow edges ──
  const edges: Edge[] = useMemo(() => {
    if (!data || sourceList.length === 0) return [];

    const result: Edge[] = [];

    // Source -> Landing Zone
    for (const src of sourceList) {
      const srcColor = getSourceColor(src.name);
      result.push({
        id: `e-source-${src.key}-to-lz`,
        source: `source-${src.key}`,
        target: "lz",
        type: "animated",
        data: {
          color: srcColor,
          entityCount: src.summary.total,
          isActive: isSourceActive(src.name) || layerActivity.lz,
        } satisfies AnimatedEdgeData,
      });
    }

    // LZ -> Bronze
    result.push({
      id: "e-lz-to-bronze",
      source: "lz",
      target: "bronze",
      type: "animated",
      data: {
        color: "#3b82f6",
        entityCount: layerStats.bronze.total,
        isActive: layerActivity.bronze,
      } satisfies AnimatedEdgeData,
    });

    // Bronze -> Silver
    result.push({
      id: "e-bronze-to-silver",
      source: "bronze",
      target: "silver",
      type: "animated",
      data: {
        color: "#f59e0b",
        entityCount: layerStats.silver.total,
        isActive: layerActivity.silver,
      } satisfies AnimatedEdgeData,
    });

    // Silver -> Gold
    result.push({
      id: "e-silver-to-gold",
      source: "silver",
      target: "gold",
      type: "animated",
      data: {
        color: "#8b5cf6",
        entityCount: layerStats.gold.total || 0,
        isActive: layerActivity.gold,
      } satisfies AnimatedEdgeData,
    });

    return result;
  }, [data, sourceList, layerStats, layerActivity, isSourceActive]);

  // ── Node click -> open drawer ──
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id);
  }, []);

  // Resolve drawer props from selectedNode
  const drawerProps = useMemo(() => {
    if (!selectedNode) return null;

    let label = "";
    let color = "#64748b";
    let stats: LayerStats = { total: 0, loaded: 0, error: 0, pending: 0 };

    if (selectedNode.startsWith("source-")) {
      const key = selectedNode.replace("source-", "");
      const src = sourceList.find((s) => s.key === key);
      if (!src) return null;
      label = src.name;
      color = getSourceColor(src.name);
      stats = sourceStats[key] || stats;
    } else {
      const layerMap: Record<string, { label: string; color: string }> = {
        lz: { label: "Landing Zone", color: "#3b82f6" },
        bronze: { label: "Bronze", color: "#f59e0b" },
        silver: { label: "Silver", color: "#8b5cf6" },
        gold: { label: "Gold", color: "#10b981" },
      };
      const layer = layerMap[selectedNode];
      if (!layer) return null;
      label = layer.label;
      color = layer.color;
      stats = layerStats[selectedNode] || stats;
    }

    return { nodeId: selectedNode, nodeLabel: label, nodeColor: color, stats };
  }, [selectedNode, sourceList, sourceStats, layerStats]);

  // ── Loading state ──
  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading architecture diagram...</span>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ──
  if (!data || sourceList.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground/40">
        <AlertCircle className="w-10 h-10" />
        <p className="text-sm">No entity data available</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative bg-background">
      {/* ── Floating header (glassmorphic, overlaid on canvas) ── */}
      <div className="absolute top-4 left-4 right-4 z-50 pointer-events-none">
        <div className="pointer-events-auto inline-flex items-center gap-4 bg-card/80 backdrop-blur-md border border-border/40 rounded-xl px-5 py-3 shadow-lg">
          {/* Title */}
          <div className="flex items-center gap-2.5">
            <Radar className="w-5 h-5 text-primary" />
            <div>
              <h1 className="font-display text-sm font-semibold text-foreground leading-none">
                Impact Pulse
              </h1>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {totalSummary.total.toLocaleString()} entities &middot;{" "}
                {shortTime(data.generatedAt)}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-border/40" />

          {/* Source legend */}
          <div className="flex items-center gap-3">
            {sourceList.map((src) => (
              <div key={src.key} className="flex items-center gap-1.5">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getSourceColor(src.name) }}
                />
                <span className="text-[10px] text-muted-foreground/70 font-medium">
                  {src.name}
                </span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-border/40" />

          {/* Refresh */}
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── React Flow Canvas ── */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnScroll={true}
      >
        <Background gap={20} size={1} color="var(--color-border)" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          nodeStrokeWidth={3}
          nodeColor={(node: Node) => (node.data as LayerNodeData)?.color || "#64748b"}
          style={{ background: "var(--color-card)" }}
          maskColor="rgba(0,0,0,0.15)"
        />
      </ReactFlow>

      {/* ── Layer Detail Drawer ── */}
      {drawerProps && (
        <LayerDrawer
          nodeId={drawerProps.nodeId}
          nodeLabel={drawerProps.nodeLabel}
          nodeColor={drawerProps.nodeColor}
          stats={drawerProps.stats}
          allEntities={allEntities}
          liveEvents={allLiveEvents}
          sourceList={sourceList}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* Inline CSS for drawer animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }

        /* React Flow overrides for dark/theme consistency */
        .react-flow__controls {
          background: var(--color-card) !important;
          border: 1px solid var(--color-border) !important;
          border-radius: 8px !important;
          box-shadow: var(--shadow-md) !important;
        }
        .react-flow__controls-button {
          background: var(--color-card) !important;
          border-color: var(--color-border) !important;
          fill: var(--color-foreground) !important;
        }
        .react-flow__controls-button:hover {
          background: var(--color-muted) !important;
        }
        .react-flow__minimap {
          border: 1px solid var(--color-border) !important;
          border-radius: 8px !important;
          box-shadow: var(--shadow-md) !important;
        }
      `}</style>
    </div>
  );
}
