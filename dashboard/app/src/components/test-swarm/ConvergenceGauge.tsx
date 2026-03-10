/**
 * Radial gauge showing test pass rate — fills green as tests converge to 100%.
 * Uses CDS OKLCH tokens. Pure SVG, no extra deps.
 */

import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "framer-motion";

interface ConvergenceGaugeProps {
  passed: number;
  total: number;
  label?: string;
  size?: number;
  className?: string;
}

export default function ConvergenceGauge({ passed, total, label, size = 160, className }: ConvergenceGaugeProps) {
  const shouldReduceMotion = useReducedMotion();
  const pct = total > 0 ? (passed / total) * 100 : 0;
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;
  const center = size / 2;

  // Color transitions through CDS semantic hues
  // 0-50%: error red, 50-80%: warning amber, 80-100%: success green
  let arcColor: string;
  let glowColor: string;
  if (pct >= 80) {
    arcColor = "oklch(0.68 0.16 145)"; // --cl-success
    glowColor = "oklch(0.68 0.16 145 / 0.3)";
  } else if (pct >= 50) {
    arcColor = "oklch(0.75 0.15 70)";  // --cl-warning
    glowColor = "oklch(0.75 0.15 70 / 0.25)";
  } else {
    arcColor = "oklch(0.58 0.2 25)";   // --cl-error
    glowColor = "oklch(0.58 0.2 25 / 0.25)";
  }

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-sm">
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="oklch(0.5 0 0 / 0.08)"
          strokeWidth={10}
          strokeLinecap="round"
        />

        {/* Glow layer (behind the arc) */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={glowColor}
          strokeWidth={16}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ filter: "blur(6px)" }}
        />

        {/* Main arc */}
        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={arcColor}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 1, ease: [0.25, 0.1, 0.25, 1] }}
          transform={`rotate(-90 ${center} ${center})`}
        />

        {/* Center text */}
        <text
          x={center}
          y={center - 8}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-foreground"
          style={{ fontSize: size * 0.18, fontWeight: 700, fontFamily: "var(--font-sans)" }}
        >
          {Math.round(pct)}%
        </text>
        <text
          x={center}
          y={center + 12}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-muted-foreground"
          style={{ fontSize: size * 0.085, fontWeight: 500, fontFamily: "var(--font-sans)" }}
        >
          {passed}/{total} passing
        </text>

        {/* 100% target tick mark */}
        {pct < 100 && (
          <line
            x1={center}
            y1={center - radius + 14}
            x2={center}
            y2={center - radius + 4}
            stroke="oklch(0.68 0.16 145 / 0.4)"
            strokeWidth={2}
            strokeLinecap="round"
            transform={`rotate(0 ${center} ${center})`}
          />
        )}
      </svg>

      {label && (
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      )}
    </div>
  );
}
