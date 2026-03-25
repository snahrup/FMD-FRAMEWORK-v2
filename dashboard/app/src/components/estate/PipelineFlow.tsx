/**
 * PipelineFlow — Animated SVG flow connectors between the three estate zones.
 *
 * Uses a viewBox-based coordinate system that maps to the 3-column grid.
 * Horizontal lines bridge Source→Layers and Layers→Governance.
 * Vertical connectors link the four medallion layer cards.
 *
 * Active connections (data has flowed) animate with flowDash keyframe at
 * copper→green gradient. Ghost connections are static, muted dashed lines.
 */

interface PipelineFlowProps {
  sourcesActive: boolean;
  layersActive: { landing: boolean; bronze: boolean; silver: boolean; gold: boolean };
  governanceActive: boolean;
}

export function PipelineFlow({ sourcesActive, layersActive, governanceActive }: PipelineFlowProps) {
  // Horizontal bridges
  const srcToLayers = sourcesActive;
  const layersToGov = governanceActive;

  // Vertical layer-to-layer
  const lzToBronze = layersActive.landing && layersActive.bronze;
  const bronzeToSilver = layersActive.bronze && layersActive.silver;
  const silverToGold = layersActive.silver && layersActive.gold;

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
    >
      <defs>
        <linearGradient id="estate-flow-active" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--bp-copper)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--bp-operational)" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="estate-flow-active-v" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bp-copper)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--bp-operational)" stopOpacity="0.35" />
        </linearGradient>
      </defs>

      {/* Source → Layers bridge */}
      <FlowPath
        d="M 230,300 C 270,300 290,300 330,300"
        active={srcToLayers}
      />

      {/* Layers → Governance bridge */}
      <FlowPath
        d="M 670,300 C 710,300 730,300 770,300"
        active={layersToGov}
      />

      {/* LZ → Bronze */}
      <FlowPath d="M 500,165 L 500,225" active={lzToBronze} vertical />
      {/* Bronze → Silver */}
      <FlowPath d="M 500,285 L 500,345" active={bronzeToSilver} vertical />
      {/* Silver → Gold */}
      <FlowPath d="M 500,405 L 500,465" active={silverToGold} vertical />

      {/* Flow junction dots — where horizontal meets vertical */}
      <FlowDot cx={330} cy={300} active={srcToLayers} />
      <FlowDot cx={670} cy={300} active={layersToGov} />
    </svg>
  );
}

function FlowPath({ d, active, vertical }: { d: string; active: boolean; vertical?: boolean }) {
  const ghostColor = "var(--bp-ink-muted)";

  return (
    <path
      d={d}
      stroke={active ? `url(#estate-flow-active${vertical ? "-v" : ""})` : ghostColor}
      strokeWidth={active ? 2 : 1}
      strokeDasharray={active ? "6 10" : "3 8"}
      strokeLinecap="round"
      strokeOpacity={active ? 0.8 : 0.12}
      style={{
        animation: active ? "flowDash 2.5s linear infinite" : undefined,
      }}
    />
  );
}

function FlowDot({ cx, cy, active }: { cx: number; cy: number; active: boolean }) {
  return (
    <circle
      cx={cx} cy={cy} r={3}
      fill={active ? "var(--bp-copper)" : "var(--bp-border)"}
      opacity={active ? 0.6 : 0.2}
      style={{ transition: "fill 0.4s var(--ease-claude), opacity 0.4s var(--ease-claude)" }}
    />
  );
}
