import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Dot } from "recharts";
import { useReducedMotion } from "framer-motion";

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
      {passed && <p className="text-[var(--cl-success)]">{passed.value} passing</p>}
      {failed && <p className="text-[var(--cl-error)]">{failed.value} failing</p>}
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
        <circle cx={cx} cy={cy} r={12} fill="none" stroke="oklch(0.68 0.16 145)" strokeWidth={2} opacity={0.3}>
          <animate attributeName="r" values="6;14;6" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0.1;0.5" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Solid dot */}
      <circle cx={cx} cy={cy} r={5} fill="oklch(0.68 0.16 145)" stroke="white" strokeWidth={2} />
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
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--cl-info)]">
            <span className={shouldReduceMotion ? "" : "animate-pulse"}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--cl-info)]" />
            </span>
            LIVE
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="passedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="oklch(0.68 0.16 145)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="oklch(0.68 0.16 145)" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="oklch(0.58 0.2 25)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="oklch(0.58 0.2 25)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.1)" />
          <XAxis
            dataKey="iteration"
            tick={{ fill: "oklch(0.5 0 0)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "oklch(0.5 0 0 / 0.2)" }}
            label={{ value: "Iteration", position: "insideBottomRight", offset: -5, style: { fontSize: 10, fill: "oklch(0.5 0 0)" } }}
          />
          <YAxis
            domain={[0, total || "auto"]}
            tick={{ fill: "oklch(0.5 0 0)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "oklch(0.5 0 0 / 0.2)" }}
          />
          <Tooltip content={<CustomTooltip />} />
          {total > 0 && (
            <ReferenceLine
              y={total}
              stroke="oklch(0.68 0.16 145)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: "Target", position: "right", style: { fontSize: 10, fill: "oklch(0.68 0.16 145)" } }}
            />
          )}
          <Area
            type="monotone"
            dataKey="passed"
            stroke="oklch(0.68 0.16 145)"
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
            stroke="oklch(0.58 0.2 25)"
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
