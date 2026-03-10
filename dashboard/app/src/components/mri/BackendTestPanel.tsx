/**
 * BackendTestPanel — API test results with status, response times, and payload validation.
 */
import { cn } from "@/lib/utils";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Zap, Globe,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { BackendTestResult } from "@/hooks/useMRI";

interface Props {
  results: BackendTestResult[];
}

export default function BackendTestPanel({ results }: Props) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Globe className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No backend API test results yet</p>
        <p className="text-xs mt-1">Configure API tests in .mri/api-tests/*.yaml</p>
      </div>
    );
  }

  const passed = results.filter(r => r.status === "passed").length;
  const failed = results.filter(r => r.status === "failed").length;
  const errored = results.filter(r => r.status === "error").length;
  const avgMs = Math.round(results.reduce((s, r) => s + r.responseTimeMs, 0) / results.length);
  const maxMs = Math.max(...results.map(r => r.responseTimeMs));

  // Chart data
  const chartData = results.map(r => ({
    name: r.name.length > 25 ? r.name.slice(0, 25) + "..." : r.name,
    fullName: r.name,
    responseTimeMs: r.responseTimeMs,
    status: r.status,
  }));

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-[var(--radius-md)] border border-border bg-card p-3 text-center">
          <div className="text-lg font-semibold text-success">{passed}</div>
          <div className="text-[10px] text-muted-foreground uppercase">Passed</div>
        </div>
        <div className="rounded-[var(--radius-md)] border border-border bg-card p-3 text-center">
          <div className="text-lg font-semibold text-destructive">{failed + errored}</div>
          <div className="text-[10px] text-muted-foreground uppercase">Failed</div>
        </div>
        <div className="rounded-[var(--radius-md)] border border-border bg-card p-3 text-center">
          <div className="text-lg font-semibold">{avgMs}ms</div>
          <div className="text-[10px] text-muted-foreground uppercase">Avg Response</div>
        </div>
        <div className="rounded-[var(--radius-md)] border border-border bg-card p-3 text-center">
          <div className="text-lg font-semibold">{maxMs}ms</div>
          <div className="text-[10px] text-muted-foreground uppercase">Slowest</div>
        </div>
      </div>

      {/* Response time chart */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Response Times
        </h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 120, right: 20 }}>
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}ms`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0].payload;
                return (
                  <div className="rounded-[var(--radius-md)] border border-border bg-popover px-3 py-2 shadow-[var(--shadow-md)]">
                    <p className="text-xs font-medium">{data.fullName}</p>
                    <p className="text-xs text-muted-foreground">{data.responseTimeMs}ms</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="responseTimeMs" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    entry.status === "passed"
                      ? "oklch(var(--success))"
                      : entry.status === "failed"
                      ? "oklch(var(--destructive))"
                      : "oklch(var(--warning))"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Results table */}
      <div className="rounded-[var(--radius-lg)] border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30">
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Status</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Test</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Endpoint</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Status Code</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Response</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Payload</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className={cn("border-t border-border", r.status !== "passed" && "bg-destructive/5")}>
                <td className="px-4 py-2">
                  {r.status === "passed" ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : r.status === "failed" ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-warning" />
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className="font-medium">{r.name}</span>
                  {r.error && (
                    <p className="text-xs text-destructive mt-0.5">{r.error}</p>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.endpoint}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  <Badge
                    variant={r.statusCode >= 200 && r.statusCode < 300 ? "secondary" : "destructive"}
                    className="text-[10px]"
                  >
                    {r.statusCode}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right">
                  <span className={cn(
                    "text-xs font-mono",
                    r.responseTimeMs > 5000 ? "text-destructive" : r.responseTimeMs > 2000 ? "text-warning" : "text-muted-foreground"
                  )}>
                    {r.responseTimeMs}ms
                  </span>
                </td>
                <td className="px-4 py-2 text-center">
                  {r.payloadValid ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success mx-auto" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive mx-auto" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
