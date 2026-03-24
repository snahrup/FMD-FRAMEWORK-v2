/**
 * Radial gauge showing test pass rate — fills green as tests converge to 100%.
 * Uses CDS OKLCH tokens. Pure SVG, no extra deps.
 */

import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "framer-motion";

// BP token hex values for SVG attributes (CSS var() not supported in SVG attrs)
const BP_OPERATIONAL = "#3D7C4F";
const BP_CAUTION = "#C27A1A";
const BP_FAULT = "#B93A2A";

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
    arcColor = BP_OPERATIONAL;
    glowColor = `${BP_OPERATIONAL}4D`; // 30% opacity
  } else if (pct >= 50) {
    arcColor = BP_CAUTION;
    glowColor = `${BP_CAUTION}40`; // 25% opacity
  } else {
    arcColor = BP_FAULT;
    glowColor = `${BP_FAULT}40`; // 25% opacity
  }

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-sm" role="img" aria-label={`${Math.round(pct)}% pass rate: ${passed} of ${total} tests passing`}>
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(168,162,158,0.15)"
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
            stroke={`${BP_OPERATIONAL}66`}
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
