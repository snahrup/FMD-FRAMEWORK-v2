import { Sparkles, Wrench, ArrowRight } from "lucide-react";

export default function CleansingRuleEditor() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-violet-500" />
          <h1 className="font-display text-xl font-semibold tracking-tight">Cleansing Rule Editor</h1>
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
            Labs
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Manage JSON cleansing rules applied during Bronze → Silver transformation
        </p>
      </div>

      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-6">
          <Wrench className="w-8 h-8 text-violet-500/40" />
        </div>
        <h2 className="text-lg font-semibold text-foreground/60 mb-3">Coming Soon</h2>
        <div className="max-w-md space-y-3 text-sm text-muted-foreground">
          <p>This page will provide a visual interface for configuring the cleansing rules stored in the FMD metadata database.</p>
          <div className="text-left space-y-2 bg-card border border-border rounded-lg px-5 py-4">
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-violet-500 flex-shrink-0" />
              <span>Browse cleansing rules per Silver entity</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-violet-500 flex-shrink-0" />
              <span>Visual rule builder: pick column, function, parameters</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-violet-500 flex-shrink-0" />
              <span>Built-in functions: normalize_text, fill_nulls, parse_datetime</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-violet-500 flex-shrink-0" />
              <span>JSON preview and validation before save</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
