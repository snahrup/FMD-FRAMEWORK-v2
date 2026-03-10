/**
 * UnifiedKPIRow — Combined KPI strip for MRI: tests, visual diffs, API tests, AI risk.
 */
import { cn } from "@/lib/utils";
import {
  CheckCircle2, XCircle, Eye, Scan, Activity, ShieldAlert, Gauge, Clock,
} from "lucide-react";
import type { MRIRunSummary, BackendTestResult, VisualDiff, AIAnalysis } from "@/hooks/useMRI";

interface Props {
  summary: MRIRunSummary | null;
  visualDiffs: VisualDiff[];
  backendResults: BackendTestResult[];
  aiAnalyses: AIAnalysis[];
}

interface KPICard {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
}

export default function UnifiedKPIRow({ summary, visualDiffs, backendResults, aiAnalyses }: Props) {
  const testsPassed = summary?.testsAfter?.passed ?? 0;
  const testsFailed = summary?.testsAfter?.failed ?? 0;
  const testsTotal = summary?.testsAfter?.total ?? 0;

  const visualMismatches = visualDiffs.filter(d => d.status === "mismatch").length;
  const visualNew = visualDiffs.filter(d => d.status === "new").length;

  const apiPassed = backendResults.filter(r => r.status === "passed").length;
  const apiFailed = backendResults.filter(r => r.status !== "passed").length;
  const avgResponseMs = backendResults.length > 0
    ? Math.round(backendResults.reduce((s, r) => s + r.responseTimeMs, 0) / backendResults.length)
    : 0;

  const highRisk = aiAnalyses.filter(a => a.riskLevel === "high").length;
  const medRisk = aiAnalyses.filter(a => a.riskLevel === "medium").length;

  const riskLabel = highRisk > 0 ? "High" : medRisk > 0 ? "Medium" : "Low";
  const riskColor = highRisk > 0 ? "text-destructive" : medRisk > 0 ? "text-warning" : "text-success";

  const cards: KPICard[] = [
    {
      label: "Tests",
      value: `${testsPassed}/${testsTotal}`,
      sub: testsFailed > 0 ? `${testsFailed} failed` : "all passing",
      icon: testsFailed > 0 ? XCircle : CheckCircle2,
      color: testsFailed > 0 ? "text-destructive" : "text-success",
    },
    {
      label: "Visual Diffs",
      value: visualMismatches,
      sub: visualNew > 0 ? `+${visualNew} new` : `${visualDiffs.length} total`,
      icon: Eye,
      color: visualMismatches > 0 ? "text-warning" : "text-success",
    },
    {
      label: "API Tests",
      value: `${apiPassed}/${backendResults.length}`,
      sub: apiFailed > 0 ? `${apiFailed} failed` : `avg ${avgResponseMs}ms`,
      icon: Activity,
      color: apiFailed > 0 ? "text-destructive" : "text-success",
    },
    {
      label: "AI Risk",
      value: riskLabel,
      sub: `${aiAnalyses.length} analyzed`,
      icon: highRisk > 0 ? ShieldAlert : Scan,
      color: riskColor,
    },
    {
      label: "Iterations",
      value: summary?.iterations ?? 0,
      sub: summary?.testsFixed ? `${summary.testsFixed} fixed` : "no fixes",
      icon: Gauge,
      color: "text-info",
    },
    {
      label: "Duration",
      value: summary?.totalDuration
        ? summary.totalDuration < 60000
          ? `${Math.round(summary.totalDuration / 1000)}s`
          : `${Math.round(summary.totalDuration / 60000)}m`
        : "--",
      sub: summary?.status ?? "idle",
      icon: Clock,
      color: "text-muted-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-[var(--radius-lg)] border border-border bg-card p-4 shadow-[var(--shadow-sm)] transition-all duration-[var(--duration-fast)] hover:shadow-[var(--shadow-md)]"
        >
          <div className="flex items-center gap-2 mb-2">
            <card.icon className={cn("h-4 w-4", card.color)} />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {card.label}
            </span>
          </div>
          <div className={cn("text-2xl font-display font-semibold tracking-tight", card.color)}>
            {card.value}
          </div>
          {card.sub && (
            <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}
