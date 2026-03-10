import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useState, useEffect } from "react";
import { TrendingUp, ChevronDown, ChevronRight } from "lucide-react";

interface TrendPoint {
  time: string;
  coverage: number;
  entityCount: number;
  withData: number;
  totalRows: number;
}

interface DqTrendChartProps {
  className?: string;
}

export function DqTrendChart({ className = "" }: DqTrendChartProps) {
  const [data, setData] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/labs/dq-trends?hours=168")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => setData(d.points || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={`bg-card backdrop-blur-sm border border-border/50 rounded-xl overflow-hidden ${className}`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        <TrendingUp className="w-4 h-4 text-[var(--cl-accent)]" />
        <span className="text-sm font-semibold">7-Day DQ Trend</span>
        {data.length > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto">{data.length} snapshots</span>
        )}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4">
          {loading ? (
            <div className="flex items-center justify-center h-[180px] text-muted-foreground text-xs">
              Loading trend data...
            </div>
          ) : data.length < 2 ? (
            <div className="flex flex-col items-center justify-center h-[180px] text-muted-foreground">
              <TrendingUp className="w-8 h-8 opacity-30 mb-2" />
              <p className="text-xs">Trend data building up...</p>
              <p className="text-[10px] mt-1">Snapshots are recorded periodically</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="dqCovGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dqRowGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#666" />
                <YAxis tick={{ fontSize: 10 }} stroke="#666" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--bg-surface, #1F1E1B)",
                    border: "1px solid var(--cl-border, rgba(108,106,96,0.25))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "var(--text-primary, #EEE)",
                  }}
                  formatter={((value: number | undefined, name: string | undefined) => [
                    name === "coverage" ? `${(value ?? 0).toFixed(1)}%` : (value ?? 0).toLocaleString(),
                    name === "coverage" ? "Coverage" : "With Data",
                  ]) as any}
                />
                <Area
                  type="monotone"
                  dataKey="coverage"
                  name="coverage"
                  stroke="#34d399"
                  fillOpacity={1}
                  fill="url(#dqCovGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="withData"
                  name="withData"
                  stroke="#38bdf8"
                  fillOpacity={1}
                  fill="url(#dqRowGrad)"
                  yAxisId={0}
                  hide
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
}
