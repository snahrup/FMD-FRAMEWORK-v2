import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useReducedMotion } from "framer-motion";

// BP token hex values for SVG attributes (CSS var() not supported in Recharts SVG props)
const BP_OPERATIONAL = "#3D7C4F";
const BP_FAULT = "#B93A2A";
const BP_INK_MUTED = "#A8A29E";

interface ConvergencePoint {
  iteration: number;
  passed: number;
  failed: number;
  delta: number;
}

interface ConvergenceChartProps {
  data: ConvergencePoint[];
  total: number;
  isActive?: boolean;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) {
  if (!active || !payload) return null;
  const passed = payload.find(p => p.name === "passed");
  const failed = payload.find(p => p.name === "failed");

  return (
    <div className="rounded-[var(--radius)] border border-border/50 bg-card p-2.5 shadow-md text-xs">
      <p className="font-medium text-foreground mb-1">Iteration {label}</p>
      {passed && <p className="text-[var(--bp-operational)]">{passed.value} passing</p>}
      {failed && <p className="text-[var(--bp-fault)]">{failed.value} failing</p>}
    </div>
  );
}

/** Pulsing dot rendered on the last data point when the run is active */
function LivePulseDot(props: Record<string, unknown>) {
  const { cx, cy, index, dataLength, isActive, shouldReduceMotion } = props as {
    cx: number; cy: number; index: number; dataLength: number; isActive: boolean; shouldReduceMotion: boolean;
  };
  // Only render on the last point and only when active
  if (index !== dataLength - 1 || !isActive) return null;

  return (
    <g>
      {/* Glow ring */}
      {!shouldReduceMotion && (
        <circle cx={cx} cy={cy} r={12} fill="none" stroke={BP_OPERATIONAL} strokeWidth={2} opacity={0.3}>
          <animate attributeName="r" values="6;14;6" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0.1;0.5" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Solid dot */}
      <circle cx={cx} cy={cy} r={5} fill={BP_OPERATIONAL} stroke="white" strokeWidth={2} />
    </g>
  );
}

export default function ConvergenceChart({ data, total, isActive = false }: ConvergenceChartProps) {
  const shouldReduceMotion = useReducedMotion();

  if (data.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-6 text-center text-muted-foreground text-sm h-[260px] flex items-center justify-center">
        No convergence data
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-6">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-medium text-muted-foreground tracking-wide uppercase">Convergence</h3>
        {isActive && (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--bp-info)]">
            <span className={shouldReduceMotion ? "" : "animate-pulse"}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--bp-info)]" />
            </span>
            LIVE
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="passedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={BP_OPERATIONAL} stopOpacity={0.4} />
              <stop offset="95%" stopColor={BP_OPERATIONAL} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={BP_FAULT} stopOpacity={0.3} />
              <stop offset="95%" stopColor={BP_FAULT} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,162,158,0.2)" />
          <XAxis
            dataKey="iteration"
            tick={{ fill: BP_INK_MUTED, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "rgba(168,162,158,0.3)" }}
            label={{ value: "Iteration", position: "insideBottomRight", offset: -5, style: { fontSize: 10, fill: BP_INK_MUTED } }}
          />
          <YAxis
            domain={[0, total || "auto"]}
            tick={{ fill: BP_INK_MUTED, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "rgba(168,162,158,0.3)" }}
          />
          <Tooltip content={<CustomTooltip />} />
          {total > 0 && (
            <ReferenceLine
              y={total}
              stroke={BP_OPERATIONAL}
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: "Target", position: "right", style: { fontSize: 10, fill: BP_OPERATIONAL } }}
            />
          )}
          <Area
            type="monotone"
            dataKey="passed"
            stroke={BP_OPERATIONAL}
            strokeWidth={2}
            fill="url(#passedGradient)"
            animationDuration={shouldReduceMotion ? 0 : 600}
            animationEasing="ease-out"
            dot={(props: Record<string, unknown>) => (
              <LivePulseDot {...props} dataLength={data.length} isActive={isActive} shouldReduceMotion={!!shouldReduceMotion} />
            )}
          />
          <Area
            type="monotone"
            dataKey="failed"
            stroke={BP_FAULT}
            strokeWidth={1.5}
            fill="url(#failedGradient)"
            animationDuration={shouldReduceMotion ? 0 : 600}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
