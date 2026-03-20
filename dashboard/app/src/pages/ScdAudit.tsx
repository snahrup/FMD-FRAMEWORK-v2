import { ClipboardCheck, Wrench, ArrowRight } from "lucide-react";

export default function ScdAudit() {
  return (
    <div className="space-y-6 px-8 py-8 max-w-[1280px] mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5" style={{ color: "var(--bp-copper)" }} />
          <h1 style={{ fontFamily: "var(--bp-font-display)", fontSize: 32, color: "var(--bp-ink-primary)" }} className="font-semibold tracking-tight">SCD Audit View</h1>
          <span
            className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
            style={{ background: "var(--bp-copper-light)", color: "var(--bp-copper)", border: "1px solid rgba(180,86,36,0.15)" }}
          >
            Labs
          </span>
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--bp-ink-secondary)" }}>
          Track SCD Type 2 change events across Silver layer tables per pipeline run
        </p>
      </div>

      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6" style={{ background: "var(--bp-copper-light)" }}>
          <Wrench className="w-8 h-8" style={{ color: "var(--bp-ink-muted)" }} />
        </div>
        <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: "var(--bp-font-body)", color: "var(--bp-ink-tertiary)" }}>Coming Soon</h2>
        <div className="max-w-md space-y-3 text-sm" style={{ color: "var(--bp-ink-secondary)" }}>
          <p>This page will surface the insert, update, and delete metrics that the Bronze &rarr; Silver notebook already tracks.</p>
          <div className="text-left space-y-2 rounded-lg px-5 py-4" style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "var(--bp-copper)" }} />
              <span>Per-table change breakdown: inserts, updates, soft deletes</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "var(--bp-copper)" }} />
              <span>Run-over-run trend showing record churn</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "var(--bp-copper)" }} />
              <span>IsCurrent / IsDeleted distribution per table</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "var(--bp-copper)" }} />
              <span>Drill into specific pipeline runs for delta detail</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
