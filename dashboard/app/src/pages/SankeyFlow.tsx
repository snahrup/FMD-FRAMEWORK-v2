import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  sankey as d3Sankey,
  sankeyLinkHorizontal,
  type SankeyNode,
  type SankeyLink,
} from "d3-sankey";
import {
  useEntityDigest,
  type DigestSource,
} from "@/hooks/useEntityDigest";
import { LAYERS, getSourceColor } from "@/lib/layers";
import { isSuccessStatus } from "@/lib/exploreWorksurface";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  X,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Circle,
} from "lucide-react";

// ============================================================================
// TYPES
// ============================================================================

/** Internal node shape before d3-sankey processes it. */
interface SankeyNodeDatum {
  id: string;
  label: string;
  color: string;
  count: number;
  type: "source" | "layer";
  sourceKey?: string; // only set for source-type nodes
}

/** Internal link shape before d3-sankey processes it. */
interface SankeyLinkDatum {
  source: string; // node id
  target: string; // node id
  value: number;
  sourceColor: string;
  targetColor: string;
}

type ProcessedNode = SankeyNode<SankeyNodeDatum, SankeyLinkDatum>;
type ProcessedLink = SankeyLink<SankeyNodeDatum, SankeyLinkDatum>;

// ============================================================================
// CONSTANTS
// ============================================================================

const LAYER_COLOR_MAP: Record<string, string> = Object.fromEntries(
  LAYERS.map((l) => [l.key, l.color])
);

const STATUS_STYLES: Record<string, { color: string; icon: typeof CheckCircle2; label: string }> = {
  complete: { color: "text-[var(--bp-operational)]", icon: CheckCircle2, label: "Complete" },
  partial: { color: "text-[var(--bp-caution)]", icon: Clock, label: "Partial" },
  pending: { color: "text-[var(--bp-copper)]", icon: Clock, label: "Pending" },
  error: { color: "text-[var(--bp-fault)]", icon: AlertTriangle, label: "Error" },
  not_started: { color: "text-[var(--bp-ink-muted)]", icon: Circle, label: "Not Started" },
};

const SANKEY_PADDING = { top: 80, right: 60, bottom: 40, left: 60 };
const NODE_WIDTH = 28;
const NODE_PADDING = 24;
const ANIM_DURATION_MS = 300;

// ============================================================================
// HELPERS
// ============================================================================

/** Build the gradient ID for a specific link. */
function gradId(sourceId: string, targetId: string): string {
  return `grad-${sourceId}-${targetId}`.replace(/\s+/g, "_");
}

/** Format a timestamp string into a short human-readable form. */
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

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Status badge used in the slide-out panel. */
function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.not_started;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${s.color}`}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

/** Slide-out panel showing entities for a selected source. */
function SourcePanel({
  source,
  onClose,
}: {
  source: DigestSource;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    // Delay listener so the click that opened the panel doesn't immediately close it
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, []);

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Group by status
  const grouped = useMemo(() => {
    const order = ["error", "partial", "pending", "complete", "not_started"];
    const sorted = [...source.entities].sort((a, b) => {
      const ai = order.indexOf(a.overall);
      const bi = order.indexOf(b.overall);
      if (ai !== bi) return ai - bi;
      return a.tableName.localeCompare(b.tableName);
    });
    return sorted;
  }, [source.entities]);

  const srcColor = getSourceColor(source.name);

  return (
    <div
      ref={panelRef}
      className="fixed top-0 right-0 h-full w-[400px] z-[300] flex flex-col animate-[slideInRight_0.25s_ease-out]"
      style={{ background: 'var(--bp-surface-1)', borderLeft: '1px solid var(--bp-border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: srcColor }}
          />
          <div>
            <h2 className="text-sm font-semibold text-foreground">{source.name}</h2>
            <p className="text-[10px] text-muted-foreground/60">
              {source.entities.length} entities
              {source.connection && ` \u00B7 ${source.connection.server}/${source.connection.database}`}
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

      {/* Summary bar */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border/20 flex-shrink-0">
        {(["complete", "partial", "pending", "error", "not_started"] as const).reduce<{ el: React.ReactNode[]; idx: number }>((acc, status) => {
          const count = source.summary[status];
          if (!count) return acc;
          const s = STATUS_STYLES[status];
          acc.el.push(
            <span key={status} className={`gs-stagger-row text-[10px] font-medium ${s.color}`} style={{ '--i': acc.idx } as React.CSSProperties}>
              {count} {s.label.toLowerCase()}
            </span>
          );
          acc.idx++;
          return acc;
        }, { el: [], idx: 0 }).el}
      </div>

      {/* Entity list */}
      <div className="flex-1 overflow-y-auto">
        {grouped.map((entity, i) => (
          <div
            key={entity.id}
            className={`gs-stagger-row flex items-center justify-between px-5 py-2.5 border-b border-border/10 hover:bg-muted/50 transition-colors ${i % 2 === 1 ? 'bg-muted/20' : ''}`}
            style={{ '--i': Math.min(i, 15) } as React.CSSProperties}
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

export default function SankeyFlow() {
  const { data, loading, error, refresh, sourceList, totalSummary } = useEntityDigest();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<DigestSource | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 960, height: 600 });
  const hasLoadedOnce = useRef(false);

  // Track first successful load for anti-flash pattern
  if (data && !hasLoadedOnce.current) hasLoadedOnce.current = true;

  // ── Responsive dimensions ──
  // Re-run when data first loads so the ResizeObserver attaches after the
  // loading spinner is replaced by the real layout (containerRef is null
  // during the loading state because of the early return).
  const dataReady = !!data;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setDimensions({
        width: Math.max(rect.width, 600),
        height: Math.max(rect.height, 400),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [dataReady]);

  // ── Build Sankey data from digest ──
  const { nodes, links, sankeyNodes, sankeyLinks } = useMemo(() => {
    if (!data || sourceList.length === 0) {
      return { nodes: [], links: [], sankeyNodes: [], sankeyLinks: [] };
    }

    // -- Nodes --
    const nodeMap = new Map<string, SankeyNodeDatum>();

    // Source nodes (one per source system)
    for (const src of sourceList) {
      nodeMap.set(`src-${src.key}`, {
        id: `src-${src.key}`,
        label: src.name,
        color: getSourceColor(src.name),
        count: src.summary.total,
        type: "source",
        sourceKey: src.key,
      });
    }

    // Layer nodes (aggregated)
    const layerKeys = ["landing", "bronze", "silver", "gold"] as const;
    const layerCounts: Record<string, number> = { landing: 0, bronze: 0, silver: 0, gold: 0 };

    for (const src of sourceList) {
      for (const entity of src.entities) {
        if (isSuccessStatus(entity.lzStatus)) layerCounts.landing++;
        if (isSuccessStatus(entity.bronzeStatus)) layerCounts.bronze++;
        if (isSuccessStatus(entity.silverStatus)) layerCounts.silver++;
        // Gold: none yet, but keep the node for visual completeness
      }
    }

    for (const lk of layerKeys) {
      nodeMap.set(`layer-${lk}`, {
        id: `layer-${lk}`,
        label: LAYERS.find((l) => l.key === lk)?.label || lk,
        color: LAYER_COLOR_MAP[lk] || "#A8A29E",
        count: layerCounts[lk],
        type: "layer",
      });
    }

    const nodes = Array.from(nodeMap.values());

    // -- Links --
    const linkList: SankeyLinkDatum[] = [];

    // Source → Landing Zone (per-source links)
    for (const src of sourceList) {
      const entityCount = src.summary.total;
      if (entityCount > 0) {
        linkList.push({
          source: `src-${src.key}`,
          target: "layer-landing",
          value: entityCount,
          sourceColor: getSourceColor(src.name),
          targetColor: LAYER_COLOR_MAP.landing,
        });
      }
    }

    // Landing → Bronze (single aggregate link)
    if (layerCounts.bronze > 0) {
      linkList.push({
        source: "layer-landing",
        target: "layer-bronze",
        value: layerCounts.bronze,
        sourceColor: LAYER_COLOR_MAP.landing,
        targetColor: LAYER_COLOR_MAP.bronze,
      });
    }

    // Bronze → Silver (single aggregate link)
    if (layerCounts.silver > 0) {
      linkList.push({
        source: "layer-bronze",
        target: "layer-silver",
        value: layerCounts.silver,
        sourceColor: LAYER_COLOR_MAP.bronze,
        targetColor: LAYER_COLOR_MAP.silver,
      });
    }

    // Silver → Gold (single aggregate, may be 0)
    if (layerCounts.gold > 0) {
      linkList.push({
        source: "layer-silver",
        target: "layer-gold",
        value: layerCounts.gold,
        sourceColor: LAYER_COLOR_MAP.silver,
        targetColor: LAYER_COLOR_MAP.gold,
      });
    }

    // -- d3-sankey layout --
    const innerWidth = dimensions.width - SANKEY_PADDING.left - SANKEY_PADDING.right;
    const innerHeight = dimensions.height - SANKEY_PADDING.top - SANKEY_PADDING.bottom;

    const generator = d3Sankey<SankeyNodeDatum, SankeyLinkDatum>()
      .nodeId((d) => d.id)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .extent([
        [SANKEY_PADDING.left, SANKEY_PADDING.top],
        [SANKEY_PADDING.left + innerWidth, SANKEY_PADDING.top + innerHeight],
      ])
      .nodeAlign((node) => {
        // Manual column assignment for clean left-to-right layout
        const id = (node as unknown as SankeyNodeDatum).id;
        if (id.startsWith("src-")) return 0;
        if (id === "layer-landing") return 1;
        if (id === "layer-bronze") return 2;
        if (id === "layer-silver") return 3;
        if (id === "layer-gold") return 4;
        return 0;
      });

    const result = generator({
      nodes: nodes.map((n) => ({ ...n })),
      links: linkList.map((link) => ({ ...link })) as unknown as SankeyLinkDatum[],
    });

    return {
      nodes,
      links: linkList,
      sankeyNodes: result.nodes as ProcessedNode[],
      sankeyLinks: result.links as ProcessedLink[],
    };
  }, [data, sourceList, dimensions]);

  // ── Link path generator ──
  const linkPath = useMemo(() => sankeyLinkHorizontal(), []);

  // ── Interaction helpers ──

  /** Returns true if a link should be highlighted given current hover state. */
  const isLinkHighlighted = useCallback(
    (link: ProcessedLink): boolean => {
      const srcNode = link.source as ProcessedNode;
      const tgtNode = link.target as ProcessedNode;
      const linkId = `${srcNode.id}->${tgtNode.id}`;

      if (hoveredLink) return hoveredLink === linkId;
      if (hoveredNode) return srcNode.id === hoveredNode || tgtNode.id === hoveredNode;
      return true; // no hover state = all visible
    },
    [hoveredNode, hoveredLink]
  );

  /** Returns true if a node should be highlighted given current hover state. */
  const isNodeHighlighted = useCallback(
    (nodeId: string): boolean => {
      if (!hoveredNode && !hoveredLink) return true;
      if (hoveredNode === nodeId) return true;
      if (hoveredLink) {
        const [src, tgt] = hoveredLink.split("->");
        return src === nodeId || tgt === nodeId;
      }
      // Check if any connected link involves this node
      if (hoveredNode) {
        return sankeyLinks.some((link) => {
          const s = (link.source as ProcessedNode).id;
          const t = (link.target as ProcessedNode).id;
          return (
            (s === hoveredNode && t === nodeId) ||
            (t === hoveredNode && s === nodeId)
          );
        });
      }
      return false;
    },
    [hoveredNode, hoveredLink, sankeyLinks]
  );

  const handleNodeClick = useCallback(
    (node: ProcessedNode) => {
      if (node.type === "source" && node.sourceKey && data?.sources[node.sourceKey]) {
        setSelectedSource(data.sources[node.sourceKey]);
      }
    },
    [data]
  );

  // ── Render ──

  // Loading state — only show spinner before first successful load
  if (loading && !hasLoadedOnce.current) {
    return (
      <div className="flex items-center justify-center gap-3 text-muted-foreground" style={{ height: 'calc(100vh - 3rem)' }}>
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading data flow...</span>
      </div>
    );
  }

  // Error state — only show full-page error if we have no stale data to display
  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3" style={{ height: 'calc(100vh - 3rem)' }}>
        <AlertCircle className="w-8 h-8 text-[var(--bp-fault)] gs-float" />
        <p className="text-sm text-[var(--bp-fault)]">{error}</p>
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

  // No data state
  if (!data || sourceList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground/40" style={{ height: 'calc(100vh - 3rem)' }}>
        <AlertCircle className="w-10 h-10 gs-float" />
        <p className="text-sm">No entity data available</p>
      </div>
    );
  }

  const hasHoverState = hoveredNode !== null || hoveredLink !== null;

  return (
    <div className="flex flex-col relative gs-page-enter" style={{ backgroundColor: 'var(--bp-canvas, #F4F2ED)', height: 'calc(100vh - 3rem)' }}>
      {/* Title bar */}
      <div className="flex-shrink-0 px-6 py-4 flex items-center justify-between z-10" style={{ borderBottom: '1px solid var(--bp-border-subtle)', background: 'var(--bp-surface-1)' }}>
        <div>
          <h1 className="text-[32px] font-normal tracking-tight" style={{ fontFamily: 'var(--bp-font-display)', color: 'var(--bp-ink-primary)' }}>Data Flow</h1>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            {totalSummary.total.toLocaleString()} entities across {sourceList.length} sources
            {data.generatedAt && (
              <span className="ml-2 text-muted-foreground/40">
                &middot; {shortTime(data.generatedAt)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {error && data && (
            <span className="text-[10px] text-[var(--bp-fault)] mr-1">Refresh failed</span>
          )}
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* SVG canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden">
        <svg
          width={dimensions.width}
          height={dimensions.height}
          className="w-full h-full"
          onMouseLeave={() => {
            setHoveredNode(null);
            setHoveredLink(null);
          }}
        >
          {/* Gradient definitions */}
          <defs>
            {sankeyLinks.map((link) => {
              const src = link.source as ProcessedNode;
              const tgt = link.target as ProcessedNode;
              const gid = gradId(src.id, tgt.id);
              return (
                <linearGradient
                  key={gid}
                  id={gid}
                  gradientUnits="userSpaceOnUse"
                  x1={src.x1}
                  x2={tgt.x0}
                >
                  <stop offset="0%" stopColor={src.color} />
                  <stop offset="100%" stopColor={tgt.color} />
                </linearGradient>
              );
            })}
          </defs>

          {/* Links */}
          <g className="links">
            {sankeyLinks.map((link) => {
              const src = link.source as ProcessedNode;
              const tgt = link.target as ProcessedNode;
              const linkId = `${src.id}->${tgt.id}`;
              const gid = gradId(src.id, tgt.id);
              const highlighted = isLinkHighlighted(link);
              const pathD = linkPath(link as never);

              return (
                <g key={linkId}>
                  {/* Invisible wider hit area for easier hovering */}
                  <path
                    d={pathD || undefined}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max((link.width || 1) + 12, 16)}
                    onMouseEnter={() => {
                      setHoveredLink(linkId);
                      setHoveredNode(null);
                    }}
                    onMouseLeave={() => setHoveredLink(null)}
                    style={{ cursor: "default" }}
                  />
                  {/* Visible link */}
                  <path
                    d={pathD || undefined}
                    fill="none"
                    stroke={`url(#${gid})`}
                    strokeWidth={Math.max(link.width || 1, 2)}
                    strokeOpacity={hasHoverState ? (highlighted ? 0.8 : 0.1) : 0.4}
                    style={{
                      transition: `stroke-opacity ${ANIM_DURATION_MS}ms ease`,
                      pointerEvents: "none",
                    }}
                  />
                  {/* Animated flow overlay (only on highlighted links) */}
                  <path
                    d={pathD || undefined}
                    fill="none"
                    stroke={`url(#${gid})`}
                    strokeWidth={Math.max((link.width || 1) * 0.3, 1.5)}
                    strokeOpacity={hasHoverState ? (highlighted ? 0.6 : 0) : 0.2}
                    strokeDasharray="8 12"
                    style={{
                      transition: `stroke-opacity ${ANIM_DURATION_MS}ms ease`,
                      animation: "sankeyFlow 4s linear infinite",
                      pointerEvents: "none",
                    }}
                  />
                </g>
              );
            })}
          </g>

          {/* Link value labels on hover */}
          {hoveredLink &&
            sankeyLinks.map((link) => {
              const src = link.source as ProcessedNode;
              const tgt = link.target as ProcessedNode;
              const linkId = `${src.id}->${tgt.id}`;
              if (linkId !== hoveredLink) return null;

              const midX = ((src.x1 ?? 0) + (tgt.x0 ?? 0)) / 2;
              const midY = ((link.y0 ?? 0) + (link.y1 ?? 0)) / 2;

              return (
                <g key={`label-${linkId}`}>
                  <rect
                    x={midX - 28}
                    y={midY - 12}
                    width={56}
                    height={24}
                    rx={6}
                    fill="var(--bp-surface-1, #FEFDFB)"
                    stroke="rgba(0,0,0,0.08)"
                    strokeWidth={1}
                    opacity={0.95}
                  />
                  <text
                    x={midX}
                    y={midY + 4}
                    textAnchor="middle"
                    className="text-[11px] font-semibold"
                    fill="var(--bp-ink-primary, #1C1917)"
                  >
                    {(link.value ?? 0).toLocaleString()}
                  </text>
                </g>
              );
            })}

          {/* Nodes */}
          <g className="nodes">
            {sankeyNodes.map((node) => {
              const x = node.x0 ?? 0;
              const y = node.y0 ?? 0;
              const w = (node.x1 ?? 0) - x;
              const h = (node.y1 ?? 0) - y;
              const highlighted = isNodeHighlighted(node.id);
              const isSource = node.type === "source";

              return (
                <g
                  key={node.id}
                  onMouseEnter={() => {
                    setHoveredNode(node.id);
                    setHoveredLink(null);
                  }}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => handleNodeClick(node)}
                  style={{
                    cursor: isSource ? "pointer" : "default",
                    transition: `opacity ${ANIM_DURATION_MS}ms ease`,
                    opacity: hasHoverState ? (highlighted ? 1 : 0.25) : 1,
                  }}
                >
                  {/* Node rectangle */}
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    rx={8}
                    fill={node.color}
                    fillOpacity={0.8}
                    stroke={node.color}
                    strokeWidth={highlighted && hasHoverState ? 2 : 1}
                    strokeOpacity={0.6}
                  />

                  {/* Node label — positioned to the left or right of the rect */}
                  {isSource ? (
                    // Source nodes: label to the left
                    <g>
                      <text
                        x={x - 10}
                        y={y + h / 2 - 6}
                        textAnchor="end"
                        className="text-[12px] font-semibold"
                        fill="var(--bp-ink-primary, #1C1917)"
                        style={{ transition: `opacity ${ANIM_DURATION_MS}ms ease` }}
                      >
                        {node.label}
                      </text>
                      <text
                        x={x - 10}
                        y={y + h / 2 + 10}
                        textAnchor="end"
                        className="text-[10px]"
                        fill="var(--bp-ink-muted, #A8A29E)"
                        fillOpacity={0.6}
                      >
                        {node.count.toLocaleString()} entities
                      </text>
                    </g>
                  ) : (
                    // Layer nodes: label to the right
                    <g>
                      <text
                        x={x + w + 10}
                        y={y + h / 2 - 6}
                        textAnchor="start"
                        className="text-[12px] font-semibold"
                        fill="var(--bp-ink-primary, #1C1917)"
                        style={{ transition: `opacity ${ANIM_DURATION_MS}ms ease` }}
                      >
                        {node.label}
                      </text>
                      <text
                        x={x + w + 10}
                        y={y + h / 2 + 10}
                        textAnchor="start"
                        className="text-[10px]"
                        fill="var(--bp-ink-muted, #A8A29E)"
                        fillOpacity={0.6}
                      >
                        {node.count > 0
                          ? `${node.count.toLocaleString()} entities`
                          : "Coming soon"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {/* Column headers */}
          <g className="headers">
            {[
              { x: SANKEY_PADDING.left, label: "Sources" },
              { x: null, label: "Landing Zone", layerKey: "landing" },
              { x: null, label: "Bronze", layerKey: "bronze" },
              { x: null, label: "Silver", layerKey: "silver" },
              { x: null, label: "Gold", layerKey: "gold" },
            ].map((col, i) => {
              // Compute the x position from the sankey nodes in that column
              let xPos = col.x;
              if (xPos === null) {
                const matchingNode = sankeyNodes.find((n) => n.id === `layer-${col.layerKey}`);
                if (matchingNode) {
                  xPos = ((matchingNode.x0 ?? 0) + (matchingNode.x1 ?? 0)) / 2;
                } else {
                  return null;
                }
              }
              const layerDef = col.layerKey ? LAYERS.find((l) => l.key === col.layerKey) : null;
              const headerColor = layerDef?.color || "#A8A29E";

              return (
                <text
                  key={col.label}
                  x={xPos}
                  y={SANKEY_PADDING.top - 20}
                  textAnchor={i === 0 ? "start" : "middle"}
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  fill={headerColor}
                  fillOpacity={0.5}
                >
                  {col.label}
                </text>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Slide-out source panel */}
      {/* Backdrop overlay for slide-out panel */}
      {selectedSource && (
        <div className="gs-modal-backdrop fixed inset-0 z-[299]" />
      )}

      {/* Slide-out source panel */}
      {selectedSource && (
        <SourcePanel
          source={selectedSource}
          onClose={() => setSelectedSource(null)}
        />
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes sankeyFlow {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -40; }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
