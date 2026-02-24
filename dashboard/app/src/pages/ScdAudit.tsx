import { ClipboardCheck, Wrench, ArrowRight } from "lucide-react";

export default function ScdAudit() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-emerald-500" />
          <h1 className="font-display text-xl font-semibold tracking-tight">SCD Audit View</h1>
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
            Labs
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Track SCD Type 2 change events across Silver layer tables per pipeline run
        </p>
      </div>

      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-6">
          <Wrench className="w-8 h-8 text-emerald-500/40" />
        </div>
        <h2 className="text-lg font-semibold text-foreground/60 mb-3">Coming Soon</h2>
        <div className="max-w-md space-y-3 text-sm text-muted-foreground">
          <p>This page will surface the insert, update, and delete metrics that the Bronze → Silver notebook already tracks.</p>
          <div className="text-left space-y-2 bg-card border border-border rounded-lg px-5 py-4">
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-emerald-500 flex-shrink-0" />
              <span>Per-table change breakdown: inserts, updates, soft deletes</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-emerald-500 flex-shrink-0" />
              <span>Run-over-run trend showing record churn</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-emerald-500 flex-shrink-0" />
              <span>IsCurrent / IsDeleted distribution per table</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-emerald-500 flex-shrink-0" />
              <span>Drill into specific pipeline runs for delta detail</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
