import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { DeploymentProofCheck, DeploymentValidationResult } from "./types";

interface DeploymentProofProps {
  proof: DeploymentValidationResult | null;
}

function checkColor(status: DeploymentProofCheck["status"]) {
  if (status === "passed") return "var(--bp-operational)";
  if (status === "failed") return "var(--bp-fault)";
  if (status === "warning") return "var(--bp-caution)";
  return "var(--bp-ink-muted)";
}

function checkIcon(status: DeploymentProofCheck["status"]) {
  if (status === "passed") return CheckCircle2;
  if (status === "failed") return XCircle;
  if (status === "warning") return AlertTriangle;
  return CircleDashed;
}

function evidenceToText(evidence: DeploymentProofCheck["evidence"]) {
  if (!evidence) return "";
  return typeof evidence === "string" ? evidence : JSON.stringify(evidence);
}

export function proofPassed(proof: DeploymentValidationResult | null) {
  return !!proof?.ok && proof.checks.every((check) => check.status !== "failed");
}

export function DeploymentProof({ proof }: DeploymentProofProps) {
  if (!proof) {
    return (
      <div className="rounded-xl p-8 text-center text-sm" style={{ border: "1px dashed var(--bp-border-strong)", color: "var(--bp-ink-muted)" }}>
        Validation proof will show Fabric token, resource, OneLake, Delta, SQL metadata, managed execution, and smoke checks reported by the backend.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {proof.warnings?.map((warning) => (
        <div key={warning} className="rounded-lg p-3 text-xs" style={{ border: "1px solid var(--bp-caution)", background: "var(--bp-caution-light)", color: "var(--bp-caution)" }}>
          {warning}
        </div>
      ))}
      <div className="grid gap-3 md:grid-cols-2">
        {proof.checks.map((check) => {
          const Icon = checkIcon(check.status);
          const color = checkColor(check.status);
          const evidence = evidenceToText(check.evidence);
          return (
            <div key={check.id} className="rounded-xl p-4" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                      {check.label || check.id.replace(/_/g, " ")}
                    </p>
                    <span className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]" style={{ border: "1px solid var(--bp-border)", color }}>
                      {check.status}
                    </span>
                  </div>
                  {check.details && <p className="mt-1 text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>{check.details}</p>}
                  {evidence && <p className="mt-2 truncate text-[10px]" style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)" }} title={evidence}>{evidence}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
