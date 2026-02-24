import { ShieldCheck, Wrench, ArrowRight } from "lucide-react";

export default function DqScorecard() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-sky-500" />
          <h1 className="font-display text-xl font-semibold tracking-tight">DQ Scorecard</h1>
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
            Labs
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Data quality metrics and cleansing rule pass/fail rates per table
        </p>
      </div>

      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-sky-500/10 flex items-center justify-center mb-6">
          <Wrench className="w-8 h-8 text-sky-500/40" />
        </div>
        <h2 className="text-lg font-semibold text-foreground/60 mb-3">Coming Soon</h2>
        <div className="max-w-md space-y-3 text-sm text-muted-foreground">
          <p>This page will aggregate the data quality checks already run by the DQ cleansing notebook into a unified scorecard.</p>
          <div className="text-left space-y-2 bg-card border border-border rounded-lg px-5 py-4">
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-sky-500 flex-shrink-0" />
              <span>Per-table quality score with trend over time</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-sky-500 flex-shrink-0" />
              <span>Column-level null rates, duplicate counts, format compliance</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-sky-500 flex-shrink-0" />
              <span>Cleansing rule pass/fail breakdown per entity</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-sky-500 flex-shrink-0" />
              <span>Configurable quality thresholds and alerting</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
