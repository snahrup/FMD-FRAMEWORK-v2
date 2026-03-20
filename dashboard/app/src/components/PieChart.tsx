// ============================================================================
// StatusPieChart — Donut/pie chart for entity layer status breakdown
//
// Wraps Recharts PieChart into a reusable component with configurable data,
// colors, and an optional center label. Used for success/fail/other breakdowns.
// ============================================================================

import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface PieSlice {
  name: string;
  value: number;
}

export interface StatusPieChartProps {
  /** Data slices to display */
  data: PieSlice[];
  /** Colors for each slice (order matches data array) */
  colors: string[];
  /** Width/height in pixels (chart is always square) */
  size?: number;
  /** Inner radius for donut hole (0 = solid pie) */
  innerRadius?: number;
  /** Outer radius */
  outerRadius?: number;
  /** Show recharts tooltip on hover */
  showTooltip?: boolean;
  /** Additional className on the wrapper */
  className?: string;
}

const DEFAULT_COLORS = ["#3D7C4F", "#B93A2A", "#A8A29E"];

export function StatusPieChart({
  data,
  colors = DEFAULT_COLORS,
  size = 48,
  innerRadius = 14,
  outerRadius = 22,
  showTooltip = false,
  className,
}: StatusPieChartProps) {
  // Skip rendering if all values are 0
  const hasData = data.some((d) => d.value > 0);
  if (!hasData) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        data-testid="pie-chart-empty"
      />
    );
  }

  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      data-testid="pie-chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <RechartsPieChart>
          <Pie
            data={data}
            dataKey="value"
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          {showTooltip && (
            <Tooltip
              contentStyle={{
                backgroundColor: "#FEFDFB",
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "#1C1917", fontWeight: 600 }}
              itemStyle={{ color: "#57534E" }}
            />
          )}
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default StatusPieChart;
