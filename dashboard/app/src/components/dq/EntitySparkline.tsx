import { LineChart, Line, ResponsiveContainer } from "recharts";

interface EntitySparklineProps {
  data: number[];  // array of row counts (7 values for 7 days)
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}

export function EntitySparkline({
  data,
  color = "#34d399",
  width = 60,
  height = 24,
  className = "",
}: EntitySparklineProps) {
  if (!data || data.length < 2) {
    return (
      <div
        className={`flex items-center justify-center text-muted-foreground/30 ${className}`}
        style={{ width, height }}
      >
        <svg width={width} height={2}>
          <line x1={0} y1={1} x2={width} y2={1} stroke="currentColor" strokeWidth={1} strokeDasharray="3,3" />
        </svg>
      </div>
    );
  }

  const chartData = data.map((v, i) => ({ i, v }));

  return (
    <div className={className} style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
