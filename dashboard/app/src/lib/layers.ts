import { Database, HardDrive, Table2, Sparkles, Crown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface LayerDef {
  key: string;
  label: string;
  color: string;
  icon: LucideIcon;
  description: string;
}

export const LAYERS: LayerDef[] = [
  { key: "source", label: "Source", color: "#64748b", icon: Database, description: "On-premises SQL Server" },
  { key: "landing", label: "Landing Zone", color: "#3b82f6", icon: HardDrive, description: "Raw Parquet files" },
  { key: "bronze", label: "Bronze", color: "#f59e0b", icon: Table2, description: "Delta Lake — cleansed, deduped" },
  { key: "silver", label: "Silver", color: "#8b5cf6", icon: Sparkles, description: "Delta Lake — SCD2, versioned" },
  { key: "gold", label: "Gold", color: "#10b981", icon: Crown, description: "Business-ready views" },
];

export const LAYER_MAP = Object.fromEntries(LAYERS.map(l => [l.key, l]));

// Source system colors for Sankey and other multi-source views
export const SOURCE_COLORS: Record<string, string> = {
  MES: "#f97316",      // orange
  ETQ: "#06b6d4",      // cyan
  "M3 Cloud": "#8b5cf6", // violet
  "M3 ERP": "#ec4899",   // pink
  OPTIVA: "#22c55e",     // green
};

export function getSourceColor(name: string): string {
  return SOURCE_COLORS[name] || "#64748b";
}
