// Status Rail — The signature element. 3px left-edge color strip like a factory floor status LED.

import { cn } from "@/lib/utils";

export type RailStatus = "operational" | "caution" | "fault" | "neutral";

const RAIL_CLASS: Record<RailStatus, string> = {
  operational: "bp-rail-operational",
  caution:     "bp-rail-caution",
  fault:       "bp-rail-fault",
  neutral:     "",
};

export function StatusRail({ status }: { status: RailStatus }) {
  if (status === "neutral") return null;
  return <div className={cn("bp-rail", RAIL_CLASS[status])} />;
}

/** Map common status strings to rail status */
export function toRailStatus(
  status: string | undefined | null
): RailStatus {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (s === "operational" || s === "healthy" || s === "success" || s === "loaded" || s === "complete" || s === "on_time")
    return "operational";
  if (s === "degraded" || s === "warning" || s === "at_risk" || s === "partial")
    return "caution";
  if (s === "offline" || s === "error" || s === "critical" || s === "failed" || s === "breached")
    return "fault";
  return "neutral";
}
