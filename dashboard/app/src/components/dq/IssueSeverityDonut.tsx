import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface Issue {
  column: string;
  issue: string;
  severity: string;
  detail: string;
}

interface IssueSeverityDonutProps {
  issues: Issue[];
  size?: number;
  onSegmentClick?: (severity: string) => void;
  className?: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#B93A2A",
  warning: "#C27A1A",
  info: "#B45624",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

export function IssueSeverityDonut({
  issues,
  size = 120,
  onSegmentClick,
  className = "",
}: IssueSeverityDonutProps) {
  const counts = issues.reduce<Record<string, number>>((acc, i) => {
    acc[i.severity] = (acc[i.severity] || 0) + 1;
    return acc;
  }, {});

  const data = Object.entries(counts).map(([severity, count]) => ({
    name: SEVERITY_LABELS[severity] || severity,
    value: count,
    severity,
    color: SEVERITY_COLORS[severity] || "#94a3b8",
  }));

  if (data.length === 0) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
        <div className="text-center">
          <div className="text-lg font-bold text-[#3D7C4F]">0</div>
          <div className="text-[10px] text-muted-foreground">issues</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={size * 0.3}
            outerRadius={size * 0.44}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
            onClick={(entry) => onSegmentClick?.(entry.severity)}
            className="cursor-pointer"
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--bg-surface, #1F1E1B)",
              border: "1px solid var(--cl-border, rgba(108,106,96,0.25))",
              borderRadius: "8px",
              fontSize: "12px",
              color: "var(--text-primary, #EEE)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <div className="text-lg font-bold">{issues.length}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">issues</div>
        </div>
      </div>
    </div>
  );
}
