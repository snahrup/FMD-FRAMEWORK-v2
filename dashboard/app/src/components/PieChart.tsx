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

const DEFAULT_COLORS = ["#10b981", "#ef4444", "#71717a"];

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
                backgroundColor: "#1a1a2e",
                border: "1px solid #333",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "#eaeaea", fontWeight: 600 }}
              itemStyle={{ color: "#a0a0a0" }}
            />
          )}
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default StatusPieChart;
