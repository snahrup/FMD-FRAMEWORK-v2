import { cn } from "@/lib/utils";
import { Globe, Building, Lock, ShieldAlert, UserX } from "lucide-react";
import type { SensitivityLevel, CertificationStatus } from "@/types/governance";
import type { LucideIcon } from "lucide-react";

// ── Sensitivity Level Badge ──

const SENSITIVITY_CONFIG: Record<SensitivityLevel, { label: string; icon: LucideIcon; color: string; bg: string; border: string }> = {
  public:       { label: "Public",       icon: Globe,       color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800/50" },
  internal:     { label: "Internal",     icon: Building,    color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-950/30",       border: "border-blue-200 dark:border-blue-800/50" },
  confidential: { label: "Confidential", icon: Lock,        color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-950/30",     border: "border-amber-200 dark:border-amber-800/50" },
  restricted:   { label: "Restricted",   icon: ShieldAlert, color: "text-red-600 dark:text-red-400",         bg: "bg-red-50 dark:bg-red-950/30",         border: "border-red-200 dark:border-red-800/50" },
  pii:          { label: "PII",          icon: UserX,       color: "text-rose-600 dark:text-rose-400",       bg: "bg-rose-50 dark:bg-rose-950/30",       border: "border-rose-200 dark:border-rose-800/50" },
};

interface SensitivityBadgeProps {
  level: SensitivityLevel;
  className?: string;
  showIcon?: boolean;
}

export function SensitivityBadge({ level, className, showIcon = true }: SensitivityBadgeProps) {
  const config = SENSITIVITY_CONFIG[level];
  const Icon = config.icon;

  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium", config.bg, config.color, config.border, className)}>
      {showIcon && <Icon className="w-3 h-3" />}
      {config.label}
    </span>
  );
}

// ── Certification Status Badge ──

const CERT_CONFIG: Record<CertificationStatus, { label: string; color: string; bg: string; border: string }> = {
  certified:  { label: "Certified",  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800/50" },
  pending:    { label: "Pending",    color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-950/30",     border: "border-amber-200 dark:border-amber-800/50" },
  draft:      { label: "Draft",      color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-950/30",       border: "border-blue-200 dark:border-blue-800/50" },
  deprecated: { label: "Deprecated", color: "text-slate-500 dark:text-slate-400",     bg: "bg-slate-50 dark:bg-slate-950/30",     border: "border-slate-200 dark:border-slate-800/50" },
  none:       { label: "Unclassified",color:"text-slate-500 dark:text-slate-400",     bg: "bg-slate-50 dark:bg-slate-950/30",     border: "border-slate-200 dark:border-slate-800/50" },
};

interface CertificationBadgeProps {
  status: CertificationStatus;
  className?: string;
}

export function CertificationBadge({ status, className }: CertificationBadgeProps) {
  const config = CERT_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border font-medium", config.bg, config.color, config.border, className)}>
      {config.label}
    </span>
  );
}
