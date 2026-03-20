// ============================================================================
// KPICard — Reusable KPI summary card for dashboard pages
//
// Displays a metric value with icon, label, optional detail line, and optional
// inline chart (e.g., mini donut). Follows the CDS card styling.
// ============================================================================

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface KPICardProps {
  /** Icon rendered to the left of the label */
  icon: ReactNode;
  /** Color class applied to the icon (e.g., "text-blue-400") */
  iconColor?: string;
  /** Short uppercase label (e.g., "Total Entities") */
  label: string;
  /** Primary metric value (large font) */
  value: ReactNode;
  /** Optional color class for the value */
  valueColor?: string;
  /** Optional secondary detail line below the value */
  detail?: ReactNode;
  /** Optional inline element rendered next to the value (e.g., mini chart) */
  inline?: ReactNode;
  /** Additional className on the Card root */
  className?: string;
}

export function KPICard({
  icon,
  iconColor,
  label,
  value,
  valueColor,
  detail,
  inline,
  className,
}: KPICardProps) {
  return (
    <Card className={className} data-testid="kpi-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <span className={cn("w-4 h-4", iconColor)}>{icon}</span>
          <span style={{ fontSize: "12px", fontWeight: 500, color: "#78716C", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
            {label}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "tabular-nums",
              valueColor
            )}
            style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "'tnum'", fontSize: "32px", fontWeight: 500, color: valueColor ? undefined : "#1C1917" }}
          >
            {value}
          </div>
          {inline}
        </div>
        {detail && (
          <div className="mt-1" style={{ fontSize: "13px", color: "#78716C" }}>{detail}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default KPICard;
