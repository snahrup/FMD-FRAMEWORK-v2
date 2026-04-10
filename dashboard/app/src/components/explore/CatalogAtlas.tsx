import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import type { DigestEntity } from "@/hooks/useEntityDigest";
import { resolveSourceLabel } from "@/hooks/useSourceConfig";
import { getSourceColor } from "@/lib/layers";
import type { DerivedRelationship } from "@/lib/exploreRelationships";
import { formatTimestamp } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Expand, Link2, Maximize2, Minimize2, Orbit, Play, Radar, RefreshCw, Sparkles } from "lucide-react";

export interface CatalogJoinCandidate {
  id: string;
  entity: DigestEntity | null;
  title: string;
  subtitle: string;
  confidence: number;
  joinLabel: string;
  explanation: string;
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

export interface CatalogAnalysisStatus {
  status: string;
  message?: string;
  lastUpdated?: string;
  candidateCount?: number;
  tableCount?: number;
}

interface CatalogAtlasProps {
  selected: DigestEntity | null;
  relationships: DerivedRelationship[];
  joinCandidates: CatalogJoinCandidate[];
  analysisStatus: CatalogAnalysisStatus | null;
  analysisBusy?: boolean;
  onRunAnalysis?: () => void;
  onSelectEntity?: (entity: DigestEntity) => void;
}

type OrbitItem = {
  id: string;
  label: string;
  subtitle: string;
  detail: string;
  tone: "join" | "strong" | "moderate" | "emerging";
  onClick?: () => void;
};

type GraphNode = {
  id: string;
  x: number;
  y: number;
  title: string;
  subtitle: string;
  accent: string;
};

const STANDARD_GRAPH = { width: 1160, height: 720 };
const EXPANDED_GRAPH = { width: 1360, height: 860 };

function orbitPoint(index: number, total: number, width: number, height: number) {
  const center = { x: width / 2, y: height / 2 };
  const startAngle = -90;
  const angle = (startAngle + (360 / Math.max(total, 1)) * index) * (Math.PI / 180);
  return {
    x: center.x + Math.cos(angle) * width * 0.29,
    y: center.y + Math.sin(angle) * height * 0.22,
  };
}

function edgeColor(tone: OrbitItem["tone"]): string {
  if (tone === "join") return "rgba(45,106,79,0.42)";
  if (tone === "strong") return "rgba(180,86,36,0.34)";
  if (tone === "moderate") return "rgba(180,86,36,0.24)";
  return "rgba(91,84,76,0.16)";
}

function nodeStyles(tone: OrbitItem["tone"]): CSSProperties {
  if (tone === "join") {
    return {
      border: "1px solid rgba(45,106,79,0.20)",
      background: "linear-gradient(180deg, rgba(45,106,79,0.12) 0%, rgba(255,255,255,0.98) 100%)",
    };
  }
  if (tone === "strong") {
    return {
      border: "1px solid rgba(180,86,36,0.22)",
      background: "linear-gradient(180deg, rgba(180,86,36,0.11) 0%, rgba(255,255,255,0.98) 100%)",
    };
  }
  if (tone === "moderate") {
    return {
      border: "1px solid rgba(180,86,36,0.16)",
      background: "linear-gradient(180deg, rgba(180,86,36,0.08) 0%, rgba(255,255,255,0.98) 100%)",
    };
  }
  return {
    border: "1px solid rgba(91,84,76,0.12)",
    background: "linear-gradient(180deg, rgba(91,84,76,0.05) 0%, rgba(255,255,255,0.98) 100%)",
  };
}

function contextStatusLabel(status: CatalogAnalysisStatus | null): string {
  if (!status) return "Checking staged relationship status";
  if (status.status === "ready") {
    return status.candidateCount != null && status.candidateCount > 0
      ? `${status.candidateCount} staged relationships indexed`
      : "Staged atlas ready";
  }
  if (status.status === "not_analyzed") return "Lakehouse relationship stage has not been prepared yet";
  if (status.status === "running") return "Refreshing staged relationship map";
  return status.message || "Relationship analysis unavailable";
}

function fitScale(
  viewportWidth: number,
  viewportHeight: number,
  graphWidth: number,
  graphHeight: number,
): number {
  if (!viewportWidth || !viewportHeight) return 1;
  return Math.min(1, (viewportWidth - 24) / graphWidth, (viewportHeight - 24) / graphHeight);
}

export function CatalogAtlas({
  selected,
  relationships,
  joinCandidates,
  analysisStatus,
  analysisBusy = false,
  onRunAnalysis,
  onSelectEntity,
}: CatalogAtlasProps) {
  const [expanded, setExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const fullscreenRef = useRef<HTMLDivElement | null>(null);
  const lastViewportWidth = useRef(0);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const initialWidth = Math.round(node.clientWidth);
    lastViewportWidth.current = initialWidth;
    setViewportWidth(initialWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.round(entry.contentRect.width);
      if (Math.abs(nextWidth - lastViewportWidth.current) < 2) return;
      lastViewportWidth.current = nextWidth;
      setViewportWidth(nextWidth);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === fullscreenRef.current);
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    const node = fullscreenRef.current;
    if (!node || typeof node.requestFullscreen !== "function") return;
    if (document.fullscreenElement === node) {
      await document.exitFullscreen();
      return;
    }
    await node.requestFullscreen();
  };

  if (!selected) {
    return (
      <section
        className="rounded-[28px] border gs-page-enter"
        style={{ borderColor: "rgba(91,84,76,0.14)", background: "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,242,237,0.96) 100%)" }}
      >
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>
            <Orbit className="h-8 w-8 gs-float" />
          </div>
          <div>
            <div className="text-base font-semibold" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
              Relationship Atlas
            </div>
            <p className="mt-2 max-w-md text-sm" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.65 }}>
              Select an asset to see the estate context around it, how the staged pipeline places it, and whether the atlas is showing context clues or staged evidence.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const graph = isFullscreen || expanded ? EXPANDED_GRAPH : STANDARD_GRAPH;
  const stageHeight = isFullscreen ? Math.max(760, windowHeight - 104) : expanded ? 680 : 520;
  const scale = fitScale(viewportWidth || graph.width, stageHeight, graph.width, graph.height);
  const scaledWidth = graph.width * scale;
  const scaledHeight = graph.height * scale;
  const offsetX = Math.max(8, ((viewportWidth || graph.width) - scaledWidth) / 2);
  const offsetY = Math.max(8, (stageHeight - scaledHeight) / 2);
  const center = { x: graph.width / 2, y: graph.height / 2 };
  const sourceLabel = resolveSourceLabel(selected.source);
  const sourceColor = getSourceColor(sourceLabel);

  const orbitItems: OrbitItem[] = joinCandidates.length > 0
    ? joinCandidates.slice(0, 6).map((candidate) => ({
        id: candidate.id,
        label: candidate.title,
        subtitle: candidate.subtitle,
        detail: `${candidate.confidence}% · ${candidate.joinLabel}`,
        tone: "join",
        onClick: candidate.entity && onSelectEntity ? () => onSelectEntity(candidate.entity!) : undefined,
      }))
    : relationships.slice(0, 6).map((relationship) => ({
        id: String(relationship.entity.id),
        label: relationship.entity.businessName || relationship.entity.tableName,
        subtitle: relationship.entity.domain || resolveSourceLabel(relationship.entity.source),
        detail: relationship.reasons[0] || relationship.edgeLabel,
        tone: relationship.confidence,
        onClick: onSelectEntity ? () => onSelectEntity(relationship.entity) : undefined,
      }));

  const contextNodes: GraphNode[] = [
    {
      id: "source",
      x: graph.width * 0.17,
      y: graph.height * 0.17,
      title: sourceLabel,
      subtitle: selected.connection ? `${selected.connection.server}/${selected.connection.database}` : "source registration",
      accent: sourceColor,
    },
    {
      id: "domain",
      x: graph.width * 0.83,
      y: graph.height * 0.17,
      title: selected.domain || "Unassigned domain",
      subtitle: selected.targetSchema || selected.sourceSchema,
      accent: "var(--bp-copper)",
    },
    {
      id: "analysis",
      x: graph.width * 0.83,
      y: graph.height * 0.83,
      title: analysisStatus?.status === "ready" ? "Staged atlas ready" : "Relationship stage",
      subtitle: contextStatusLabel(analysisStatus),
      accent: analysisStatus?.status === "ready" ? "var(--bp-operational)" : "var(--bp-ink-secondary)",
    },
    {
      id: "trust",
      x: graph.width * 0.17,
      y: graph.height * 0.83,
      title: selected.qualityScore != null ? `${selected.qualityScore.toFixed(0)}% trust` : "Trust not scored",
      subtitle: selected.qualityTier || "scoring pending",
      accent: (selected.qualityScore || 0) >= 80 ? "var(--bp-operational)" : "var(--bp-copper)",
    },
  ];

  const orbitPoints = orbitItems.map((_, index) => orbitPoint(index, orbitItems.length, graph.width, graph.height));

  return (
    <section
      className="rounded-[28px] border p-4 md:p-5"
      style={{
        borderColor: "rgba(180,86,36,0.14)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,242,237,0.96) 100%)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px]" style={{ background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>
            <Radar className="h-3.5 w-3.5" />
            Estate relationship atlas
          </div>
          <h3 className="mt-3 text-[22px]" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>
            {selected.businessName || selected.tableName}
          </h3>
          <p className="mt-1 text-sm" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
            {joinCandidates.length > 0
              ? "Staged column evidence is leading the orbit, so the closest nodes reflect the pipeline evidence instead of guesswork."
              : "The atlas is still using staged context clues until the relationship stage is refreshed for this estate snapshot."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {analysisStatus?.lastUpdated ? (
            <div className="rounded-full px-3 py-1 text-[11px]" style={{ background: "rgba(91,84,76,0.08)", color: "var(--bp-ink-secondary)" }}>
              Updated {formatTimestamp(analysisStatus.lastUpdated, { relative: true })}
            </div>
          ) : null}
          {analysisStatus?.status !== "ready" && onRunAnalysis ? (
            <Button size="sm" className="h-8 rounded-full px-4 text-xs" onClick={onRunAnalysis} disabled={analysisBusy}>
              {analysisBusy ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
              {analysisBusy ? "Refreshing map" : "Build staged relationship map"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-[24px] border" style={{ borderColor: "rgba(180,86,36,0.12)", background: "rgba(255,255,255,0.72)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "rgba(180,86,36,0.10)", background: "rgba(244,242,237,0.74)" }}>
          <div className="text-[11px]" style={{ color: "var(--bp-ink-secondary)", fontFamily: "var(--bp-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Auto-fit viewport keeps every node in frame
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 rounded-full px-3 text-xs" onClick={() => setExpanded((current) => !current)}>
              {expanded ? <Minimize2 className="mr-1.5 h-3.5 w-3.5" /> : <Maximize2 className="mr-1.5 h-3.5 w-3.5" />}
              {expanded ? "Compact atlas" : "Maximize atlas"}
            </Button>
            <Button variant="outline" size="sm" className="h-8 rounded-full px-3 text-xs" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize2 className="mr-1.5 h-3.5 w-3.5" /> : <Expand className="mr-1.5 h-3.5 w-3.5" />}
              {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            </Button>
          </div>
        </div>

        <div
          ref={fullscreenRef}
          className="relative overflow-hidden"
          style={{
            borderTop: "1px solid rgba(180,86,36,0.06)",
            background: "radial-gradient(circle at top, rgba(180,86,36,0.08) 0%, rgba(255,255,255,0.96) 52%, rgba(244,242,237,0.98) 100%)",
          }}
        >
          <div ref={viewportRef} className="relative w-full" style={{ minHeight: stageHeight }}>
            <div
              className="absolute left-0 top-0"
              style={{
                width: graph.width,
                height: graph.height,
                transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <svg viewBox={`0 0 ${graph.width} ${graph.height}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
                <defs>
                  <radialGradient id="catalogAtlasGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(180,86,36,0.12)" />
                    <stop offset="100%" stopColor="rgba(180,86,36,0)" />
                  </radialGradient>
                </defs>
                <circle cx={center.x} cy={center.y} r={graph.width * 0.22} fill="url(#catalogAtlasGlow)" />
                {contextNodes.map((node) => (
                  <path
                    key={`context-${node.id}`}
                    d={`M ${center.x} ${center.y} Q ${(center.x + node.x) / 2} ${(center.y + node.y) / 2 - 26} ${node.x} ${node.y}`}
                    fill="none"
                    stroke="rgba(91,84,76,0.16)"
                    strokeWidth="1.6"
                    strokeDasharray="6 8"
                  />
                ))}
                {orbitPoints.map((point, index) => (
                  <path
                    key={`edge-${orbitItems[index]?.id || index}`}
                    d={`M ${center.x} ${center.y} Q ${(center.x + point.x) / 2} ${(center.y + point.y) / 2 - 14} ${point.x} ${point.y}`}
                    fill="none"
                    stroke={edgeColor(orbitItems[index]?.tone || "emerging")}
                    strokeWidth={orbitItems[index]?.tone === "join" ? 2.4 : 1.8}
                    strokeDasharray={orbitItems[index]?.tone === "join" ? undefined : "7 8"}
                  />
                ))}
              </svg>

              {contextNodes.map((node, index) => (
                <div
                  key={node.id}
                  className="absolute gs-stagger-card w-[188px] -translate-x-1/2 -translate-y-1/2 rounded-[20px] border px-4 py-3"
                  style={{
                    left: node.x,
                    top: node.y,
                    borderColor: "rgba(91,84,76,0.12)",
                    background: "rgba(255,255,255,0.90)",
                    "--i": Math.min(index, 15),
                  } as CSSProperties}
                >
                  <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)" }}>
                    {node.id}
                  </div>
                  <div className="mt-1 text-sm font-semibold" style={{ color: node.accent }}>
                    {node.title}
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.45 }}>
                    {node.subtitle}
                  </div>
                </div>
              ))}

              <div
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[26px] border px-5 py-4"
                style={{
                  left: center.x,
                  top: center.y,
                  width: 280,
                  borderColor: "rgba(180,86,36,0.22)",
                  background: "linear-gradient(180deg, rgba(180,86,36,0.14) 0%, rgba(255,255,255,0.98) 100%)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)" }}>
                      Selected asset
                    </div>
                    <div className="mt-1 text-lg font-semibold" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                      {selected.tableName}
                    </div>
                    <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
                      {selected.businessName || selected.sourceSchema}
                    </div>
                  </div>
                  <div className="rounded-full px-2 py-1 text-[10px] font-medium" style={{ background: `${sourceColor}15`, color: sourceColor }}>
                    {sourceLabel}
                  </div>
                </div>
                <p className="mt-3 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
                  {selected.description || selected.diagnosis || "Use the orbit to see which assets sit closest to this table and why."}
                </p>
              </div>

              {orbitItems.map((item, index) => {
                const point = orbitPoints[index];
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={cn(
                      "absolute gs-stagger-card -translate-x-1/2 -translate-y-1/2 rounded-[22px] px-4 py-3 text-left transition-all duration-200",
                      item.onClick ? "cursor-pointer hover:-translate-y-[52%]" : "cursor-default",
                    )}
                    style={{
                      left: point.x,
                      top: point.y,
                      width: 208,
                      ...nodeStyles(item.tone),
                      "--i": Math.min(index + 4, 15),
                    } as CSSProperties}
                    onClick={item.onClick}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                          {item.label}
                        </div>
                        <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
                          {item.subtitle}
                        </div>
                      </div>
                      <span
                        className="rounded-full px-2 py-1 text-[10px] font-medium"
                        style={{
                          background: item.tone === "join" ? "rgba(45,106,79,0.10)" : "rgba(180,86,36,0.10)",
                          color: item.tone === "join" ? "var(--bp-operational)" : "var(--bp-copper)",
                        }}
                      >
                        {item.tone === "join" ? "staged" : "context"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: item.tone === "join" ? "var(--bp-operational)" : "var(--bp-ink-secondary)" }}>
                      <Link2 className="h-3.5 w-3.5" />
                      {item.detail}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-[22px] border p-4 gs-stagger-card" style={{ borderColor: "rgba(91,84,76,0.12)", background: "rgba(255,255,255,0.88)", "--i": 1 } as CSSProperties}>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
            <Sparkles className="h-3.5 w-3.5" />
            Analysis stage
          </div>
          <div className="mt-2 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
            {contextStatusLabel(analysisStatus)}
          </div>
          <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
            Newly landed and incremental data should pass through an explicit staged relationship pass before the atlas claims anything is truly joinable.
          </p>
        </div>
        <div className="rounded-[22px] border p-4 gs-stagger-card" style={{ borderColor: "rgba(91,84,76,0.12)", background: "rgba(255,255,255,0.88)", "--i": 2 } as CSSProperties}>
          <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
            What is closest
          </div>
          <div className="mt-2 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
            {joinCandidates[0]?.title || relationships[0]?.entity.businessName || relationships[0]?.entity.tableName || "No close relationship in view"}
          </div>
          <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
            {joinCandidates[0]?.explanation || relationships[0]?.reasons.join(" · ") || "Select a different asset or refresh the staged relationship map to surface stronger evidence."}
          </p>
        </div>
        <div className="rounded-[22px] border p-4 gs-stagger-card" style={{ borderColor: "rgba(91,84,76,0.12)", background: "rgba(255,255,255,0.88)", "--i": 3 } as CSSProperties}>
          <div className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
            Why it matters
          </div>
          <div className="mt-2 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
            This atlas should remove the hunt
          </div>
          <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
            Operators should understand where this asset belongs, what else clusters with it, and whether the relationship is inferred or staged before they jump into blending, profiling, or SQL inspection.
          </p>
        </div>
      </div>
    </section>
  );
}
