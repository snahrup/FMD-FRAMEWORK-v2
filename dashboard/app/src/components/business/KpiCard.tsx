// KPI Card — Oversized number in display font, label above, subtitle below.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  /** Optional right-side element (e.g., progress ring SVG) */
  adornment?: ReactNode;
  /** If true, value text is colored red (for alert counts) */
  alert?: boolean;
  className?: string;
}

export function KpiCard({ label, value, subtitle, adornment, alert, className }: KpiCardProps) {
  return (
    <div className={cn("bp-card p-5", className)}>
      <div className="flex items-center gap-5">
        <div className="flex-1 min-w-0">
          <div
            className="text-[11px] font-medium uppercase tracking-wider mb-2"
            style={{ color: "var(--bp-ink-tertiary)" }}
          >
            {label}
          </div>
          <div
            className={cn(
              "bp-mono text-[40px] font-medium leading-none",
              alert ? "text-[var(--bp-fault)]" : ""
            )}
            style={!alert ? { color: "var(--bp-ink-primary)" } : undefined}
          >
            {value}
          </div>
          {subtitle && (
            <div
              className="text-[13px] mt-1.5"
              style={{ color: "var(--bp-ink-tertiary)" }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {adornment && <div className="shrink-0">{adornment}</div>}
      </div>
    </div>
  );
}
