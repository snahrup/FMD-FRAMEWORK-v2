import { cn } from "@/lib/utils";
import { Globe, Building, Lock, ShieldAlert, UserX } from "lucide-react";
import type { SensitivityLevel, CertificationStatus } from "@/types/governance";
import type { LucideIcon } from "lucide-react";

// ── Sensitivity Level Badge ──

const SENSITIVITY_CONFIG: Record<SensitivityLevel, { label: string; icon: LucideIcon; color: string; bg: string; border: string }> = {
  public:       { label: "Public",       icon: Globe,       color: "text-[#3D7C4F]",  bg: "bg-[#E7F3EB]",  border: "border-[#3D7C4F]/30" },
  internal:     { label: "Internal",     icon: Building,    color: "text-[#B45624]",  bg: "bg-[#F4E8DF]",  border: "border-[#B45624]/30" },
  confidential: { label: "Confidential", icon: Lock,        color: "text-[#C27A1A]",  bg: "bg-[#FDF3E3]",  border: "border-[#C27A1A]/30" },
  restricted:   { label: "Restricted",   icon: ShieldAlert, color: "text-[#B93A2A]",  bg: "bg-[#FBEAE8]",  border: "border-[#B93A2A]/30" },
  pii:          { label: "PII",          icon: UserX,       color: "text-[#B93A2A]",  bg: "bg-[#FBEAE8]",  border: "border-[#B93A2A]/30" },
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
  certified:  { label: "Certified",   color: "text-[#3D7C4F]",  bg: "bg-[#E7F3EB]",  border: "border-[#3D7C4F]/30" },
  pending:    { label: "Pending",     color: "text-[#C27A1A]",  bg: "bg-[#FDF3E3]",  border: "border-[#C27A1A]/30" },
  draft:      { label: "Draft",       color: "text-[#B45624]",  bg: "bg-[#F4E8DF]",  border: "border-[#B45624]/30" },
  deprecated: { label: "Deprecated",  color: "text-[#A8A29E]",  bg: "bg-[#EDEAE4]",  border: "border-[#A8A29E]/30" },
  none:       { label: "Unclassified",color: "text-[#A8A29E]",  bg: "bg-[#EDEAE4]",  border: "border-[#A8A29E]/30" },
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
