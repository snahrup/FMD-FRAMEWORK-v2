import { AlertTriangle, CheckCircle2, Copy, Loader2, XCircle } from "lucide-react";
import type { DeploymentStep, SaveResult } from "./types";

interface DeploymentProgressProps {
  steps: DeploymentStep[];
  propagation?: SaveResult[];
}

function statusIcon(status: DeploymentStep["status"]) {
  if (status === "running" || status === "pending") return Loader2;
  if (status === "failed") return XCircle;
  if (status === "warning" || status === "skipped") return AlertTriangle;
  return CheckCircle2;
}

function statusColor(status: DeploymentStep["status"]) {
  if (status === "failed") return "var(--bp-fault)";
  if (status === "warning" || status === "skipped") return "var(--bp-caution)";
  if (status === "running" || status === "pending") return "var(--bp-copper)";
  return "var(--bp-operational)";
}

function detailsToText(details: DeploymentStep["details"]) {
  if (!details) return "";
  return typeof details === "string" ? details : JSON.stringify(details);
}

export function deploymentSucceeded(steps: DeploymentStep[]) {
  return steps.length > 0 && steps.every((step) => step.required === false || ["succeeded", "warning", "skipped"].includes(step.status));
}

export function DeploymentProgress({ steps, propagation = [] }: DeploymentProgressProps) {
  if (!steps.length) {
    return (
      <div className="rounded-xl p-8 text-center text-sm" style={{ border: "1px dashed var(--bp-border-strong)", color: "var(--bp-ink-muted)" }}>
        Execution results will appear here with exact created or reused Fabric IDs.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
        {steps.map((step) => {
          const Icon = statusIcon(step.status);
          const color = statusColor(step.status);
          const details = detailsToText(step.details) || step.errorMessage;
          return (
            <div key={step.stepKey} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center" style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}>
              <Icon className={`h-4 w-4 shrink-0 ${step.status === "running" ? "animate-spin" : ""}`} style={{ color }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium" style={{ color: "var(--bp-ink-primary)" }}>{step.displayName}</p>
                  <span className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]" style={{ border: "1px solid var(--bp-border)", color }}>
                    {step.action} · {step.status}
                  </span>
                </div>
                {details && <p className="mt-1 text-xs" style={{ color: step.status === "failed" ? "var(--bp-fault)" : "var(--bp-ink-tertiary)" }}>{details}</p>}
              </div>
              <div className="flex flex-col gap-1 md:w-[260px]">
                {step.fabricResourceId && (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(step.fabricResourceId || "")}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[10px]"
                    style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)" }}
                    title={step.fabricResourceId}
                  >
                    <Copy className="h-3 w-3 shrink-0" />
                    <span className="truncate">{step.fabricResourceId}</span>
                  </button>
                )}
                {step.fabricWorkspaceId && (
                  <span className="truncate text-[10px]" style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)" }}>
                    ws {step.fabricWorkspaceId}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {propagation.length > 0 && (
        <div className="rounded-xl p-4" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-inset)" }}>
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--bp-ink-tertiary)" }}>
            Backend-reported config propagation
          </h4>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {propagation.map((target) => (
              <div key={target.target} className="rounded-lg p-3 text-xs" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium" style={{ color: "var(--bp-ink-primary)" }}>{target.target}</span>
                  <span style={{ color: target.status === "ok" ? "var(--bp-operational)" : target.status === "warning" ? "var(--bp-caution)" : "var(--bp-fault)" }}>
                    {target.status}
                  </span>
                </div>
                {target.details && <p className="mt-1" style={{ color: "var(--bp-ink-muted)" }}>{target.details}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
