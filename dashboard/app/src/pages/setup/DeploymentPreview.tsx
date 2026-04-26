import { AlertTriangle, CheckCircle2, CircleDashed, Copy, ShieldAlert } from "lucide-react";
import type { DeploymentStep } from "./types";

interface DeploymentPreviewProps {
  steps: DeploymentStep[];
}

const ACTION_STYLE = {
  create: { label: "Create", color: "var(--bp-copper)", bg: "var(--bp-copper-light)" },
  reuse: { label: "Reuse", color: "var(--bp-operational)", bg: "var(--bp-operational-light)" },
  blocked: { label: "Blocked", color: "var(--bp-fault)", bg: "var(--bp-fault-light)" },
  warning: { label: "Warning", color: "var(--bp-caution)", bg: "var(--bp-caution-light)" },
};

function detailsToText(details: DeploymentStep["details"]) {
  if (!details) return "";
  return typeof details === "string" ? details : JSON.stringify(details);
}

export function hasRequiredBlockedSteps(steps: DeploymentStep[]) {
  return steps.some((step) => step.action === "blocked" && step.required !== false);
}

export function DeploymentPreview({ steps }: DeploymentPreviewProps) {
  if (!steps.length) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ border: "1px dashed var(--bp-border-strong)", color: "var(--bp-ink-muted)" }}>
        <CircleDashed className="mx-auto mb-3 h-8 w-8" />
        <p className="text-sm">Run preview to see exactly what Fabric will create, reuse, warn on, or block.</p>
      </div>
    );
  }

  const blocked = hasRequiredBlockedSteps(steps);

  return (
    <div className="space-y-3">
      {blocked && (
        <div className="flex items-start gap-2 rounded-lg p-3 text-xs" style={{ border: "1px solid var(--bp-fault)", background: "var(--bp-fault-light)", color: "var(--bp-fault)" }}>
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Required blocked steps must be resolved before execution. Warning steps remain visible but do not block deployment.
        </div>
      )}
      <div className="overflow-hidden rounded-xl" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
        {steps.map((step) => {
          const style = ACTION_STYLE[step.action] ?? ACTION_STYLE.warning;
          const details = detailsToText(step.details) || step.errorMessage;
          return (
            <div key={step.stepKey} className="grid gap-3 px-4 py-3 md:grid-cols-[140px_1fr_auto]" style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ background: style.bg, color: style.color }}>
                {step.action === "blocked" ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                {style.label}
              </span>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--bp-ink-primary)" }}>{step.displayName}</p>
                <p className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)" }}>{step.stepKey}</p>
                {details && <p className="mt-1 text-xs" style={{ color: step.action === "blocked" ? "var(--bp-fault)" : "var(--bp-ink-tertiary)" }}>{details}</p>}
              </div>
              {step.fabricResourceId && (
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(step.fabricResourceId || "")}
                  className="flex max-w-[220px] items-center gap-1.5 self-start rounded-md px-2 py-1 text-[10px]"
                  style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)" }}
                  title={step.fabricResourceId}
                >
                  <Copy className="h-3 w-3 shrink-0" />
                  <span className="truncate">{step.fabricResourceId}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
