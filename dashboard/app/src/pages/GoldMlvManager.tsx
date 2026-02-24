import { Layers3, Wrench, ArrowRight } from "lucide-react";

export default function GoldMlvManager() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Layers3 className="w-5 h-5 text-amber-500" />
          <h1 className="font-display text-xl font-semibold tracking-tight">Gold Layer / MLV Manager</h1>
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
            Labs
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Manage Materialized Lakehouse Views and custom Gold layer notebooks
        </p>
      </div>

      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-6">
          <Wrench className="w-8 h-8 text-amber-500/40" />
        </div>
        <h2 className="text-lg font-semibold text-foreground/60 mb-3">Coming Soon</h2>
        <div className="max-w-md space-y-3 text-sm text-muted-foreground">
          <p>This page will show the Gold layer's Materialized Lakehouse Views and their relationship to Silver tables.</p>
          <div className="text-left space-y-2 bg-card border border-border rounded-lg px-5 py-4">
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-amber-500 flex-shrink-0" />
              <span>Inventory of all MLVs with Silver table dependencies</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-amber-500 flex-shrink-0" />
              <span>Fact vs Dimension classification</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-amber-500 flex-shrink-0" />
              <span>Custom Gold notebooks (DimDate, etc.) and their status</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-amber-500 flex-shrink-0" />
              <span>Business domain workspace association</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
