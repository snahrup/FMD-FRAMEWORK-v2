import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { SaveResult, ValidationCheck } from "../types";

const STATUS_CONFIG = {
  ok: { icon: CheckCircle2, color: "var(--bp-operational)", bg: "var(--bp-operational-light)" },
  warning: { icon: AlertTriangle, color: "var(--bp-caution)", bg: "var(--bp-caution-light)" },
  error: { icon: XCircle, color: "var(--bp-fault)", bg: "var(--bp-fault-light)" },
};

export function SaveResults({ results }: { results: SaveResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>Save Results</h4>
      {results.map((r, i) => {
        const cfg = STATUS_CONFIG[r.status];
        const Icon = cfg.icon;
        return (
          <div
            key={i}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
            style={{ background: cfg.bg }}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: cfg.color }} />
            <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>{r.target}</span>
            {r.details && (
              <span className="ml-auto truncate max-w-[200px]" style={{ color: 'var(--bp-ink-tertiary)' }} title={r.details}>
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
      <h4 className="text-xs font-medium" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
        Validation {allOk ? "— All checks passed" : ""}
      </h4>
      {checks.map((c, i) => {
        const cfg = STATUS_CONFIG[c.status];
        const Icon = cfg.icon;
        return (
          <div
            key={i}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
            style={{ background: cfg.bg }}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: cfg.color }} />
            <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>{c.check}</span>
            {c.details && (
              <span className="ml-auto truncate max-w-[250px]" style={{ color: 'var(--bp-ink-tertiary)' }} title={c.details}>
                {c.details}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
