import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Zap, Loader2, Clock } from "lucide-react";

type SwarmStatus = "converged" | "max_iterations" | "circuit_breaker" | "in_progress" | "error" | "idle";

const STATUS_CONFIG: Record<SwarmStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  converged: { label: "Converged", color: "bg-[var(--cl-success)] text-white", icon: CheckCircle2 },
  in_progress: { label: "In Progress", color: "bg-[var(--cl-info)] text-white", icon: Loader2 },
  max_iterations: { label: "Max Iterations", color: "bg-[var(--cl-warning)] text-white", icon: Clock },
  circuit_breaker: { label: "Circuit Breaker", color: "bg-[var(--cl-error)] text-white", icon: Zap },
  error: { label: "Error", color: "bg-[var(--cl-error)] text-white", icon: XCircle },
  idle: { label: "Idle", color: "bg-muted text-muted-foreground", icon: Clock },
};

interface SwarmStatusBadgeProps {
  status: SwarmStatus;
  className?: string;
}

export default function SwarmStatusBadge({ status, className }: SwarmStatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        config.color,
        status === "in_progress" && "animate-pulse",
        className
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", status === "in_progress" && "animate-spin")} />
      {config.label}
    </span>
  );
}
