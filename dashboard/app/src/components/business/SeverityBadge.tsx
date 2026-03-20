// Severity Badge — Critical / Warning / Info styled badge.

import { cn } from "@/lib/utils";

export type Severity = "critical" | "warning" | "info";

const BADGE_CLASS: Record<Severity, string> = {
  critical: "bp-badge-critical",
  warning:  "bp-badge-warning",
  info:     "bp-badge-info",
};

const LABEL: Record<Severity, string> = {
  critical: "Critical",
  warning:  "Warning",
  info:     "Info",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={cn("bp-badge", BADGE_CLASS[severity])}>
      {LABEL[severity]}
    </span>
  );
}

/** Map raw status strings to severity */
export function toSeverity(status: string | undefined | null): Severity {
  if (!status) return "info";
  const s = status.toLowerCase();
  if (s === "error" || s === "critical" || s === "failed" || s === "fault") return "critical";
  if (s === "warning" || s === "degraded" || s === "at_risk") return "warning";
  return "info";
}
