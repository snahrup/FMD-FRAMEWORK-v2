import { cn } from "@/lib/utils";
import { resolveStatus } from "@/lib/statusColors";

interface StatusBadgeProps {
  status: string;
  label?: string;         // override the default label
  className?: string;
  showIcon?: boolean;
  size?: "sm" | "md";
}

export function StatusBadge({ status, label, className, showIcon = true, size = "md" }: StatusBadgeProps) {
  const config = resolveStatus(status);
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "bp-badge",
        config.badgeClass,
        config.pulse && "animate-pulse",
        size === "sm" && "bp-badge-sm",
        className
      )}
    >
      {showIcon && <Icon className={cn(size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5")} />}
      {label ?? config.label}
    </span>
  );
}
