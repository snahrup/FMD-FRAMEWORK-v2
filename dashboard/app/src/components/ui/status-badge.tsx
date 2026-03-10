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
        "inline-flex items-center gap-1 rounded border font-medium transition-colors",
        config.bg, config.color, config.border,
        config.pulse && "animate-pulse",
        size === "sm" && "text-[10px] px-1.5 py-0.5",
        size === "md" && "text-xs px-2.5 py-0.5",
        className
      )}
    >
      {showIcon && <Icon className={cn(size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5")} />}
      {label ?? config.label}
    </span>
  );
}
