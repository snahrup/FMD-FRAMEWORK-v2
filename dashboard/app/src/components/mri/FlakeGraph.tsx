/**
 * FlakeGraph — Pass rate over N runs per test, highlighting flaky tests.
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Shuffle, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import type { FlakeResult } from "@/hooks/useMRI";

interface Props {
  results: FlakeResult[];
}

export default function FlakeGraph({ results }: Props) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Shuffle className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No flake detection data</p>
        <p className="text-xs mt-1">Run flake detection to identify unstable tests</p>
      </div>
    );
  }

  const flakyCount = results.filter(r => r.isFlaky).length;
  const stableCount = results.filter(r => !r.isFlaky).length;

  // Chart data — sorted by pass rate ascending (worst first)
  const chartData = [...results]
    .sort((a, b) => a.passRate - b.passRate)
    .map(r => ({
      name: r.testName.length > 30 ? r.testName.slice(0, 30) + "..." : r.testName,
      fullName: r.testName,
      passRate: Math.round(r.passRate * 100),
      isFlaky: r.isFlaky,
      runs: r.runs,
      passed: r.passed,
      failed: r.failed,
    }));

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4">
        <Badge variant={flakyCount > 0 ? "destructive" : "secondary"} className="gap-1">
          <Shuffle className="h-3 w-3" />
          {flakyCount} flaky
        </Badge>
        <Badge variant="secondary" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {stableCount} stable
        </Badge>
        <span className="text-xs text-muted-foreground">
          across {results[0]?.runs ?? 0} runs per test
        </span>
      </div>

      {/* Pass rate chart */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Pass Rate by Test
        </h4>
        <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 28)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 140, right: 20 }}>
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
            <ReferenceLine x={80} stroke="oklch(var(--warning))" strokeDasharray="4 4" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0].payload;
                return (
                  <div className="rounded-[var(--radius-md)] border border-border bg-popover px-3 py-2 shadow-[var(--shadow-md)]">
                    <p className="text-xs font-medium">{data.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {data.passRate}% pass rate ({data.passed}/{data.runs} runs)
                    </p>
                    {data.isFlaky && (
                      <p className="text-xs text-warning mt-0.5">Flaky — inconsistent results</p>
                    )}
                  </div>
                );
              }}
            />
            <Bar dataKey="passRate" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    entry.passRate >= 100
                      ? "oklch(var(--success))"
                      : entry.isFlaky
                      ? "oklch(var(--warning))"
                      : "oklch(var(--destructive))"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Flaky tests detail */}
      {flakyCount > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <AlertTriangle className="inline h-3 w-3 mr-1" />
            Flaky Tests
          </h4>
          {results.filter(r => r.isFlaky).map((r) => (
            <div key={r.testName} className="rounded-[var(--radius-md)] border border-warning/30 bg-warning/5 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{r.testName}</span>
                <span className="text-xs text-warning font-mono">{Math.round(r.passRate * 100)}% pass rate</span>
              </div>
              {r.failures.length > 0 && (
                <div className="mt-2 space-y-1">
                  {r.failures.slice(0, 3).map((f, i) => (
                    <p key={i} className="text-xs text-muted-foreground font-mono truncate">{f}</p>
                  ))}
                  {r.failures.length > 3 && (
                    <p className="text-xs text-muted-foreground">+{r.failures.length - 3} more</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
