// Progress Ring — SVG circular gauge. Used in KPI cards (freshness %) and dataset detail (quality score).

interface ProgressRingProps {
  /** Percentage 0-100 */
  pct: number;
  /** Diameter in px */
  size?: number;
  /** Stroke width in px */
  strokeWidth?: number;
}

export function ProgressRing({ pct, size = 72, strokeWidth = 5 }: ProgressRingProps) {
  const r = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(pct, 100) / 100);
  const center = size / 2;

  const color =
    pct >= 95 ? "var(--bp-operational)" :
    pct >= 80 ? "var(--bp-caution)" :
    "var(--bp-fault)";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle
        cx={center} cy={center} r={r}
        fill="none"
        stroke="var(--bp-surface-inset)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={center} cy={center} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{
          transform: "rotate(-90deg)",
          transformOrigin: "center",
          transition: "stroke-dashoffset 0.5s ease",
        }}
      />
    </svg>
  );
}
