import { cn } from "@/lib/utils";
import { CheckCircle2, RefreshCw, Clock, FileCode, GitBranch, type LucideIcon } from "lucide-react";
import SwarmStatusBadge from "./SwarmStatusBadge";

interface KPICardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtitle?: string;
  color: string;
}

function KPICard({ icon: Icon, label, value, subtitle, color }: KPICardProps) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-4 flex items-start gap-3">
      <div className={cn("rounded-[var(--radius)] p-2", color)}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-xl font-semibold tracking-tight text-foreground">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

interface KPIRowProps {
  testsPassing: number;
  testsTotal: number;
  iterations: number;
  maxIterations: number;
  duration: number;
  filesChanged: number;
  linesChanged: { added: number; removed: number };
  status: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export default function KPIRow({ testsPassing, testsTotal, iterations, maxIterations, duration, filesChanged, linesChanged, status }: KPIRowProps) {
  const allPassing = testsPassing === testsTotal && testsTotal > 0;
  const passColor = allPassing ? "bg-[var(--cl-success)]" : testsPassing > 0 ? "bg-[var(--cl-warning)]" : "bg-[var(--cl-error)]";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground tracking-wide uppercase">Swarm Overview</h2>
        <SwarmStatusBadge status={status as never} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard
          icon={CheckCircle2}
          label="Tests Passing"
          value={`${testsPassing}/${testsTotal}`}
          subtitle={allPassing ? "All green" : `${testsTotal - testsPassing} failing`}
          color={passColor}
        />
        <KPICard
          icon={RefreshCw}
          label="Iterations"
          value={`${iterations}/${maxIterations}`}
          color="bg-[var(--cl-info)]"
        />
        <KPICard
          icon={Clock}
          label="Duration"
          value={formatDuration(duration)}
          color="bg-muted-foreground/80"
        />
        <KPICard
          icon={FileCode}
          label="Files Changed"
          value={filesChanged}
          color="bg-[var(--cl-warning)]"
        />
        <KPICard
          icon={GitBranch}
          label="Lines Changed"
          value={`+${linesChanged.added} -${linesChanged.removed}`}
          subtitle="net delta"
          color="bg-primary"
        />
      </div>
    </div>
  );
}
