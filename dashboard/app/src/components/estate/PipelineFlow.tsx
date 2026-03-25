/**
 * PipelineFlow — Animated SVG connections between estate zones.
 *
 * Draws flowing dashed lines between source constellation, medallion layers,
 * and the governance panel. Uses CSS keyframe animation (flowDash) for
 * 60fps GPU-composited particle flow effect.
 *
 * The flow lines are drawn as SVG paths with animated stroke-dashoffset.
 * "Active" connections (where data has flowed) animate faster with
 * semantic coloring. "Ghost" connections are static dashed lines.
 */

interface FlowConnection {
  id: string;
  active: boolean;
  color?: string;
}

interface PipelineFlowProps {
  /** Whether sources have loaded data */
  sourcesActive: boolean;
  /** Which layers have loaded data */
  layersActive: { landing: boolean; bronze: boolean; silver: boolean; gold: boolean };
  /** Whether classification has data */
  governanceActive: boolean;
}

export function PipelineFlow({ sourcesActive, layersActive, governanceActive }: PipelineFlowProps) {
  const connections: FlowConnection[] = [
    { id: "src-lz", active: sourcesActive },
    { id: "lz-bronze", active: layersActive.landing && layersActive.bronze },
    { id: "bronze-silver", active: layersActive.bronze && layersActive.silver },
    { id: "silver-gold", active: layersActive.silver && layersActive.gold },
    { id: "layers-gov", active: governanceActive },
  ];

  return (
    <svg
      className="estate-flow-svg absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
      preserveAspectRatio="none"
    >
      <defs>
        {/* Gradient for active connections */}
        <linearGradient id="flow-active" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--bp-copper)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--bp-operational)" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id="flow-ghost" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--bp-ink-muted)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--bp-ink-muted)" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {connections.map((conn) => (
        <FlowLine key={conn.id} id={conn.id} active={conn.active} />
      ))}
    </svg>
  );
}

function FlowLine({ id, active }: { id: string; active: boolean }) {
  // Positions are percentage-based and match the 3-zone layout
  const paths: Record<string, { d: string }> = {
    "src-lz": { d: "M 25,50 C 30,50 32,50 35,50" },
    "lz-bronze": { d: "M 38,30 L 38,42" },
    "bronze-silver": { d: "M 38,58 L 38,70" },
    "silver-gold": { d: "M 38,82 L 38,92" },
    "layers-gov": { d: "M 55,50 C 60,50 62,50 65,50" },
  };

  const pathData = paths[id];
  if (!pathData) return null;

  return (
    <path
      d={pathData.d}
      fill="none"
      stroke={active ? "url(#flow-active)" : "url(#flow-ghost)"}
      strokeWidth={active ? 2 : 1}
      strokeDasharray={active ? "4 8" : "2 6"}
      strokeLinecap="round"
      style={{
        animation: active ? "flowDash 2s linear infinite" : undefined,
        opacity: active ? 1 : 0.4,
      }}
    />
  );
}
