import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  iconColor?: string;       // Tailwind text-* class for icon
  trend?: {
    value: number;           // +/- percentage change
    label?: string;          // e.g., "vs last run"
  };
  subtitle?: string;
  className?: string;
}

export function KpiCard({ label, value, icon: Icon, iconColor, trend, subtitle, className }: KpiCardProps) {
  const trendPositive = trend && trend.value > 0;
  const trendNegative = trend && trend.value < 0;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card p-4 shadow-sm",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
            {label}
          </p>
          <p className="text-2xl font-semibold font-mono tracking-tight text-foreground">
            {value}
          </p>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
          )}
          {trend && (
            <p
              className={cn(
                "text-[11px] font-medium",
                trendPositive && "text-[#3D7C4F]",
                trendNegative && "text-[#B93A2A]",
                !trendPositive && !trendNegative && "text-muted-foreground"
              )}
            >
              {trendPositive && "+"}{trend.value.toFixed(1)}%
              {trend.label && <span className="text-muted-foreground ml-1">{trend.label}</span>}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn("rounded-md p-2 bg-muted/50", iconColor)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </div>
  );
}

interface KpiRowProps {
  children: React.ReactNode;
  className?: string;
}

export function KpiRow({ children, className }: KpiRowProps) {
  return (
    <div className={cn("grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-6", className)}>
      {children}
    </div>
  );
}
