import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SaveResult, ValidationCheck } from "../types";

const STATUS_CONFIG = {
  ok: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  warning: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10" },
  error: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
};

export function SaveResults({ results }: { results: SaveResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">Save Results</h4>
      {results.map((r, i) => {
        const cfg = STATUS_CONFIG[r.status];
        const Icon = cfg.icon;
        return (
          <div
            key={i}
            className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-xs", cfg.bg)}
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
            <span className="font-medium text-foreground">{r.target}</span>
            {r.details && (
              <span className="text-muted-foreground ml-auto truncate max-w-[200px]" title={r.details}>
                {r.details}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ValidationResultsView({ checks }: { checks: ValidationCheck[] }) {
  if (checks.length === 0) return null;
  const allOk = checks.every((c) => c.status === "ok");
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">
        Validation {allOk ? "— All checks passed" : ""}
      </h4>
      {checks.map((c, i) => {
        const cfg = STATUS_CONFIG[c.status];
        const Icon = cfg.icon;
        return (
          <div
            key={i}
            className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-xs", cfg.bg)}
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
            <span className="font-medium text-foreground">{c.check}</span>
            {c.details && (
              <span className="text-muted-foreground ml-auto truncate max-w-[250px]" title={c.details}>
                {c.details}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
