/**
 * CrossBranchCompare — Same test across runs/time. Shows trend of pass/fail + visual diff over history.
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { History, CheckCircle2, XCircle, Clock, TrendingUp } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { MRIRunEntry } from "@/hooks/useMRI";

interface Props {
  runs: MRIRunEntry[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}

export default function CrossBranchCompare({ runs, selectedRunId, onSelectRun }: Props) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <History className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No run history yet</p>
      </div>
    );
  }

  // Build chart data from run summaries
  const chartData = [...runs]
    .reverse()
    .filter(r => r.summary)
    .map((r) => ({
      runId: r.runId,
      label: formatRunLabel(r.runId),
      passed: r.summary!.testsAfter?.passed ?? 0,
      failed: r.summary!.testsAfter?.failed ?? 0,
      total: r.summary!.testsAfter?.total ?? 0,
      visual: r.summary!.visualSummary?.mismatches ?? 0,
      duration: r.summary!.totalDuration,
    }));

  return (
    <div className="space-y-4">
      {/* Trend chart */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          <TrendingUp className="inline h-3 w-3 mr-1" />
          Test Health Over Time
        </h4>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{ left: 0, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0].payload;
                return (
                  <div className="rounded-[var(--radius-md)] border border-border bg-popover px-3 py-2 shadow-[var(--shadow-md)]">
                    <p className="text-xs font-medium">{data.label}</p>
                    <p className="text-xs text-success">{data.passed} passed</p>
                    <p className="text-xs text-destructive">{data.failed} failed</p>
                    {data.visual > 0 && (
                      <p className="text-xs text-warning">{data.visual} visual diffs</p>
                    )}
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="passed"
              stackId="1"
              stroke="oklch(var(--success))"
              fill="oklch(var(--success) / 0.2)"
            />
            <Area
              type="monotone"
              dataKey="failed"
              stackId="1"
              stroke="oklch(var(--destructive))"
              fill="oklch(var(--destructive) / 0.2)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Run history list */}
      <div className="rounded-[var(--radius-lg)] border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30">
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Run</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Status</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Tests</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Visual</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const s = r.summary;
              const isSelected = r.runId === selectedRunId;
              return (
                <tr
                  key={r.runId}
                  onClick={() => onSelectRun(r.runId)}
                  className={cn(
                    "border-t border-border cursor-pointer transition-colors",
                    isSelected ? "bg-primary/5" : "hover:bg-accent/50"
                  )}
                >
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs">{formatRunLabel(r.runId)}</span>
                    {isSelected && <Badge variant="outline" className="ml-2 text-[9px]">selected</Badge>}
                  </td>
                  <td className="px-4 py-2">
                    {s ? (
                      <Badge
                        variant={s.status === "complete" ? "secondary" : s.status === "in_progress" ? "outline" : "destructive"}
                        className="text-[10px]"
                      >
                        {s.status}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">--</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {s ? (
                      <span className="text-xs">
                        <span className="text-success">{s.testsAfter?.passed ?? 0}</span>
                        {(s.testsAfter?.failed ?? 0) > 0 && (
                          <span className="text-destructive ml-1">/{s.testsAfter.failed}F</span>
                        )}
                      </span>
                    ) : "--"}
                  </td>
                  <td className="px-4 py-2 text-right text-xs">
                    {s?.visualSummary?.mismatches ?? "--"}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                    <Clock className="inline h-3 w-3 mr-1" />
                    {s ? formatDuration(s.totalDuration) : "--"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatRunLabel(runId: string): string {
  // Run IDs are timestamps like "1709654400000"
  const num = Number(runId);
  if (!isNaN(num) && num > 1_000_000_000_000) {
    return new Date(num).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }
  return runId.slice(0, 12);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}
