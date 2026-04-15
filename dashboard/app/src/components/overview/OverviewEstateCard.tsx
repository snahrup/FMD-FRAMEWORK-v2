import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowRight, Database, Minus, Move, Plus, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";

interface OverviewEstateCardProps {
  tablesInScope: number;
  landingLoaded: number;
  bronzeLoaded: number;
  silverLoaded: number;
  toolReady: number;
  blockedTables: number;
  healthySources: number;
  sourceCount: number;
}

type NodeId = "sources" | "landing" | "bronze" | "silver" | "ready";

interface StagePosition {
  x: number;
  y: number;
}

interface StageNode {
  id: NodeId;
  label: string;
  value: string;
  subtitle: string;
  color: string;
  x: number;
  y: number;
}

type DragState =
  | { type: "pan"; pointerId: number; startX: number; startY: number; originX: number; originY: number }
  | { type: "node"; pointerId: number; id: NodeId; offsetX: number; offsetY: number }
  | null;

const VIEWPORT = {
  width: 1000,
  height: 320,
};

const DEFAULT_POSITIONS: Record<NodeId, StagePosition> = {
  sources: { x: 112, y: 164 },
  landing: { x: 304, y: 164 },
  bronze: { x: 496, y: 164 },
  silver: { x: 688, y: 164 },
  ready: { x: 880, y: 164 },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPair(value: number, total: number) {
  return `${value.toLocaleString("en-US")} / ${total.toLocaleString("en-US")}`;
}

function connectorPath(from: StagePosition, to: StagePosition) {
  const control = Math.max(82, Math.abs(to.x - from.x) * 0.38);
  return `M ${from.x + 38} ${from.y} C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x - 38} ${to.y}`;
}

function EstateMetricChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "quiet" | "healthy";
}) {
  const healthy = tone === "healthy";
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3 py-2"
      style={{
        border: healthy
          ? "1px solid color-mix(in srgb, var(--bp-operational) 22%, transparent)"
          : "1px solid var(--bp-border)",
        background: healthy
          ? "color-mix(in srgb, var(--bp-operational) 10%, white)"
          : "rgba(255,255,255,0.86)",
      }}
    >
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full"
        style={{
          background: healthy
            ? "color-mix(in srgb, var(--bp-operational) 16%, white)"
            : "var(--bp-surface-inset)",
          color: healthy ? "var(--bp-operational)" : "var(--bp-ink-secondary)",
        }}
      >
        <Database size={11} />
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1,
          color: healthy ? "var(--bp-operational)" : "var(--bp-ink-secondary)",
        }}
      >
        {label}
      </span>
      <span
        className="bp-mono"
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--bp-ink-primary)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function StageDatabaseNode({
  node,
  selected,
  active,
  onPointerDown,
}: {
  node: StageNode;
  selected: boolean;
  active: boolean;
  onPointerDown: (id: NodeId, event: ReactPointerEvent<SVGGElement>) => void;
}) {
  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      onPointerDown={(event) => onPointerDown(node.id, event)}
      style={{ cursor: "grab" }}
    >
      {selected ? (
        <circle
          r="54"
          fill={`color-mix(in srgb, ${node.color} 18%, transparent)`}
          opacity="0.9"
        />
      ) : null}
      {active ? (
        <circle
          r="44"
          fill={`color-mix(in srgb, ${node.color} 14%, transparent)`}
          style={{ animation: "bp-fault-pulse 3.4s ease-in-out infinite" }}
        />
      ) : null}

      <ellipse
        cx="0"
        cy="-24"
        rx="34"
        ry="11"
        fill={`color-mix(in srgb, ${node.color} 18%, white)`}
        stroke={`color-mix(in srgb, ${node.color} 32%, rgba(120,113,108,0.24))`}
        strokeWidth="1.5"
      />
      <rect
        x="-34"
        y="-24"
        width="68"
        height="48"
        rx="10"
        fill={`color-mix(in srgb, ${node.color} 22%, white)`}
        stroke={`color-mix(in srgb, ${node.color} 28%, rgba(120,113,108,0.18))`}
        strokeWidth="1.5"
      />
      <ellipse
        cx="0"
        cy="24"
        rx="34"
        ry="11"
        fill={`color-mix(in srgb, ${node.color} 28%, white)`}
        stroke={`color-mix(in srgb, ${node.color} 32%, rgba(120,113,108,0.24))`}
        strokeWidth="1.5"
      />
      <line x1="-28" y1="-4" x2="28" y2="-4" stroke="rgba(120,113,108,0.18)" strokeWidth="1" />
      <line x1="-28" y1="12" x2="28" y2="12" stroke="rgba(120,113,108,0.14)" strokeWidth="1" />

      <text
        x="0"
        y="56"
        textAnchor="middle"
        style={{
          fontSize: 12,
          fontWeight: 700,
          fill: "var(--bp-ink-primary)",
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        {node.label}
      </text>
      <text
        x="0"
        y="74"
        textAnchor="middle"
        className="bp-mono"
        style={{
          fontSize: 11,
          fontWeight: 700,
          fill: selected ? "var(--bp-copper)" : "var(--bp-ink-secondary)",
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        {node.value}
      </text>
    </g>
  );
}

export function OverviewEstateCard({
  tablesInScope,
  landingLoaded,
  bronzeLoaded,
  silverLoaded,
  toolReady,
  blockedTables,
  healthySources,
  sourceCount,
}: OverviewEstateCardProps) {
  const stageRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState>(null);

  const [positions, setPositions] = useState(DEFAULT_POSITIONS);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<NodeId>("landing");

  const nodes = useMemo<StageNode[]>(
    () => [
      {
        id: "sources",
        label: "Sources",
        value: `${healthySources.toLocaleString("en-US")}/${sourceCount.toLocaleString("en-US")}`,
        subtitle: "Healthy source systems connected to the estate.",
        color: "var(--bp-info)",
        ...positions.sources,
      },
      {
        id: "landing",
        label: "Landing",
        value: formatPair(landingLoaded, tablesInScope),
        subtitle: "Raw ingestion landed from source into the managed path.",
        color: "var(--bp-copper)",
        ...positions.landing,
      },
      {
        id: "bronze",
        label: "Bronze",
        value: formatPair(bronzeLoaded, tablesInScope),
        subtitle: "Bronze materialization after initial standardization and shape control.",
        color: "var(--bp-bronze)",
        ...positions.bronze,
      },
      {
        id: "silver",
        label: "Silver",
        value: formatPair(silverLoaded, tablesInScope),
        subtitle: "Silver-ready assets surfaced for governed downstream analysis.",
        color: "var(--bp-silver)",
        ...positions.silver,
      },
      {
        id: "ready",
        label: "Tool-Ready",
        value: formatPair(toolReady, tablesInScope),
        subtitle: blockedTables > 0
          ? `${blockedTables.toLocaleString("en-US")} tables still blocked before downstream tooling.`
          : "Downstream tooling can operate against the full usable path.",
        color: "var(--bp-operational)",
        ...positions.ready,
      },
    ],
    [blockedTables, bronzeLoaded, healthySources, landingLoaded, positions, silverLoaded, sourceCount, tablesInScope, toolReady],
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[1];

  const connectors = useMemo(
    () => [
      { id: "sources-landing", from: "sources" as const, to: "landing" as const, active: landingLoaded > 0, color: "var(--bp-copper)" },
      { id: "landing-bronze", from: "landing" as const, to: "bronze" as const, active: bronzeLoaded > 0, color: "var(--bp-bronze)" },
      { id: "bronze-silver", from: "bronze" as const, to: "silver" as const, active: silverLoaded > 0, color: "var(--bp-silver)" },
      { id: "silver-ready", from: "silver" as const, to: "ready" as const, active: toolReady > 0, color: "var(--bp-operational)" },
    ],
    [bronzeLoaded, landingLoaded, silverLoaded, toolReady],
  );

  function toViewportPoint(clientX: number, clientY: number) {
    const svg = stageRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * VIEWPORT.width;
    const svgY = ((clientY - rect.top) / rect.height) * VIEWPORT.height;
    return {
      x: (svgX - pan.x) / zoom,
      y: (svgY - pan.y) / zoom,
    };
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<SVGRectElement>) {
    const svg = stageRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    const point = toViewportPoint(event.clientX, event.clientY);
    dragRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      originX: pan.x,
      originY: pan.y,
    };
  }

  function handleNodePointerDown(id: NodeId, event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation();
    const svg = stageRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    setSelectedNodeId(id);
    const point = toViewportPoint(event.clientX, event.clientY);
    dragRef.current = {
      type: "node",
      pointerId: event.pointerId,
      id,
      offsetX: point.x - positions[id].x,
      offsetY: point.y - positions[id].y,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = toViewportPoint(event.clientX, event.clientY);

    if (drag.type === "pan") {
      setPan({
        x: drag.originX + (point.x - drag.startX),
        y: drag.originY + (point.y - drag.startY),
      });
      return;
    }

    setPositions((current) => ({
      ...current,
      [drag.id]: {
        x: clamp(point.x - drag.offsetX, 80, VIEWPORT.width - 80),
        y: clamp(point.y - drag.offsetY, 84, VIEWPORT.height - 88),
      },
    }));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      stageRef.current?.releasePointerCapture(event.pointerId);
    }
  }

  function adjustZoom(delta: number) {
    setZoom((current) => clamp(Number((current + delta).toFixed(2)), 0.7, 1.6));
  }

  function resetView() {
    setPositions(DEFAULT_POSITIONS);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }

  return (
    <div
      className="bp-card gs-stagger-card h-full"
      style={{
        minHeight: 468,
        padding: 22,
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(circle at 18% 16%, rgba(180,86,36,0.08), transparent 28%), radial-gradient(circle at 82% 26%, rgba(61,124,79,0.07), transparent 26%), linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(250,247,243,0.98) 100%)",
      }}
    >
      <div
        className="bp-rail"
        style={{
          background: blockedTables > 0 ? "var(--bp-copper)" : "var(--bp-operational)",
          top: 14,
          bottom: 14,
        }}
      />

      <div style={{ paddingLeft: 6, display: "flex", flexDirection: "column", flex: 1 }}>
        <div className="flex items-start justify-between gap-4">
          <div style={{ maxWidth: 680 }}>
            <div
              style={{
                fontFamily: "var(--bp-font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--bp-copper)",
              }}
            >
              See the whole map
            </div>
            <h2
              className="bp-display"
              style={{
                margin: "6px 0 0",
                fontSize: 26,
                lineHeight: 1.02,
                color: "var(--bp-ink-primary)",
              }}
            >
              Data Estate
            </h2>
            <p
              style={{
                margin: "10px 0 0",
                maxWidth: 620,
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--bp-ink-secondary)",
              }}
            >
              Follow the estate when the question is whether data is moving cleanly
              through the sequential load path from source to landing, bronze, silver,
              and finally tool-ready consumption.
            </p>
          </div>

          <div
            className="rounded-[18px] px-4 py-3 text-right"
            style={{
              border: "1px solid var(--bp-border)",
              background: "rgba(255,255,255,0.82)",
              minWidth: 132,
            }}
          >
            <div
              style={{
                fontFamily: "var(--bp-font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--bp-ink-tertiary)",
              }}
            >
              Outstanding
            </div>
            <div
              className="bp-mono"
              style={{
                marginTop: 4,
                fontSize: 28,
                fontWeight: 700,
                lineHeight: 1,
                color: "var(--bp-ink-primary)",
              }}
            >
              {blockedTables.toLocaleString("en-US")}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
          <EstateMetricChip
            label="Healthy Sources"
            value={`${healthySources.toLocaleString("en-US")}/${sourceCount.toLocaleString("en-US")}`}
            tone="healthy"
          />
          <EstateMetricChip
            label="Interaction"
            value="Drag · Select · Zoom"
          />
        </div>

        <div
          className="relative overflow-hidden rounded-[22px]"
          style={{
            marginTop: 18,
            flex: 1,
            minHeight: 332,
            padding: "18px 18px 82px",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.54) 0%, rgba(249,247,243,0.22) 100%)",
            border: "1px solid rgba(120,113,108,0.08)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(rgba(120,113,108,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(120,113,108,0.05) 1px, transparent 1px)",
              backgroundSize: "58px 58px",
              opacity: 0.5,
              maskImage: "linear-gradient(180deg, rgba(0,0,0,0.74), rgba(0,0,0,0.3))",
            }}
          />

          <div
            className="rounded-[18px] px-4 py-3"
            style={{
              position: "absolute",
              top: 18,
              right: 18,
              zIndex: 3,
              width: 256,
              border: "1px solid rgba(120,113,108,0.14)",
              background: "rgba(255,255,255,0.88)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--bp-font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--bp-ink-tertiary)",
              }}
            >
              Selected Stage
            </div>
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: selectedNode.color,
                  boxShadow: `0 0 0 6px color-mix(in srgb, ${selectedNode.color} 18%, transparent)`,
                }}
              />
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  color: "var(--bp-ink-primary)",
                }}
              >
                {selectedNode.label}
              </div>
            </div>
            <div
              className="bp-mono"
              style={{
                marginTop: 10,
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1,
                color: "var(--bp-ink-primary)",
              }}
            >
              {selectedNode.value}
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--bp-ink-secondary)",
              }}
            >
              {selectedNode.subtitle}
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              top: 18,
              left: 18,
              zIndex: 3,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span
              className="rounded-full px-3 py-2"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--bp-info)",
                background: "color-mix(in srgb, var(--bp-info) 10%, white)",
                border: "1px solid color-mix(in srgb, var(--bp-info) 18%, transparent)",
              }}
            >
              Sequential Load Path
            </span>
            <span
              className="rounded-full px-3 py-2"
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--bp-ink-secondary)",
                background: "rgba(255,255,255,0.84)",
                border: "1px solid var(--bp-border)",
              }}
            >
              Drag nodes to compare posture
            </span>
          </div>

          <div
            style={{
              position: "absolute",
              left: 18,
              right: 18,
              top: 72,
              bottom: 74,
            }}
          >
            <svg
              ref={stageRef}
              className="h-full w-full"
              viewBox={`0 0 ${VIEWPORT.width} ${VIEWPORT.height}`}
              preserveAspectRatio="none"
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onWheel={(event) => {
                event.preventDefault();
                adjustZoom(event.deltaY > 0 ? -0.08 : 0.08);
              }}
              aria-label="Interactive data estate map"
            >
              <rect
                x="0"
                y="0"
                width={VIEWPORT.width}
                height={VIEWPORT.height}
                fill="transparent"
                onPointerDown={handleCanvasPointerDown}
              />

              <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                {connectors.map((connector) => {
                  const from = positions[connector.from];
                  const to = positions[connector.to];
                  const path = connectorPath(from, to);
                  return (
                    <g key={connector.id}>
                      <path
                        d={path}
                        fill="none"
                        stroke="rgba(120,113,108,0.14)"
                        strokeWidth="10"
                        strokeLinecap="round"
                      />
                      <path
                        d={path}
                        fill="none"
                        stroke={connector.color}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray="10 14"
                        strokeOpacity={connector.active ? 0.78 : 0.24}
                        style={{
                          animation: connector.active ? "flowDash 2.8s linear infinite" : undefined,
                        }}
                      />
                    </g>
                  );
                })}

                {nodes.map((node) => (
                  <StageDatabaseNode
                    key={node.id}
                    node={node}
                    selected={selectedNodeId === node.id}
                    active={
                      node.id === "sources"
                        ? healthySources > 0
                        : node.id === "landing"
                          ? landingLoaded > 0
                          : node.id === "bronze"
                            ? bronzeLoaded > 0
                            : node.id === "silver"
                              ? silverLoaded > 0
                              : toolReady > 0
                    }
                    onPointerDown={handleNodePointerDown}
                  />
                ))}
              </g>
            </svg>
          </div>

          <div
            style={{
              position: "absolute",
              left: 18,
              right: 18,
              bottom: 18,
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div className="flex flex-wrap gap-2">
              <Link
                to="/estate"
                className="rounded-full px-3 py-2"
                style={{
                  textDecoration: "none",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--bp-ink-secondary)",
                  background: "rgba(255,255,255,0.82)",
                  border: "1px solid var(--bp-border)",
                }}
              >
                Source posture
              </Link>
              <Link
                to="/estate"
                className="rounded-full px-3 py-2"
                style={{
                  textDecoration: "none",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--bp-ink-secondary)",
                  background: "rgba(255,255,255,0.82)",
                  border: "1px solid var(--bp-border)",
                }}
              >
                Layer coverage
              </Link>
              <Link
                to="/schema-validation"
                className="rounded-full px-3 py-2"
                style={{
                  textDecoration: "none",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--bp-ink-secondary)",
                  background: "rgba(255,255,255,0.82)",
                  border: "1px solid var(--bp-border)",
                }}
              >
                Governance map
              </Link>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div
                className="rounded-full px-2 py-1.5"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(255,255,255,0.86)",
                  border: "1px solid var(--bp-border)",
                }}
              >
                <button
                  type="button"
                  onClick={() => adjustZoom(-0.08)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    border: "1px solid var(--bp-border)",
                    background: "white",
                    color: "var(--bp-ink-secondary)",
                    cursor: "pointer",
                  }}
                >
                  <Minus size={12} />
                </button>
                <span className="bp-mono" style={{ minWidth: 44, textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => adjustZoom(0.08)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    border: "1px solid var(--bp-border)",
                    background: "white",
                    color: "var(--bp-ink-secondary)",
                    cursor: "pointer",
                  }}
                >
                  <Plus size={12} />
                </button>
                <button
                  type="button"
                  onClick={resetView}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    border: "1px solid var(--bp-border)",
                    background: "white",
                    color: "var(--bp-ink-secondary)",
                    cursor: "pointer",
                  }}
                >
                  <RotateCcw size={12} />
                </button>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--bp-ink-secondary)", paddingInline: 6 }}>
                  <Move size={12} />
                  Pan
                </span>
              </div>

              <Link
                to="/estate"
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2"
                style={{
                  textDecoration: "none",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--bp-copper)",
                  background: "color-mix(in srgb, var(--bp-copper) 10%, white)",
                  border: "1px solid color-mix(in srgb, var(--bp-copper) 18%, transparent)",
                }}
              >
                Open Estate
                <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OverviewEstateCard;
