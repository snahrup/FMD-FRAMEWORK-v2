// ============================================================================
// LayerNode — Custom React Flow node for the Impact Pulse architecture diagram
//
// Renders source systems and medallion layer nodes with pulsing activity
// indicators, health badges, and entity count overlays.
// ============================================================================

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export interface LayerNodeData {
  label: string;
  type: "source" | "layer";
  color: string;
  entityCount: number;
  loadedCount: number;
  errorCount: number;
  isActive: boolean;
  lastActivity?: string;
  [key: string]: unknown;
}

function healthLevel(total: number, loaded: number, errors: number): "green" | "amber" | "red" {
  if (total === 0) return "amber";
  if (errors > 0 && loaded / total < 0.5) return "red";
  const ratio = loaded / total;
  if (ratio >= 0.9) return "green";
  if (ratio >= 0.5) return "amber";
  return "red";
}

const HEALTH_COLORS: Record<string, string> = {
  green: "bg-[#3D7C4F]",
  amber: "bg-[#C27A1A]",
  red: "bg-[#B93A2A]",
};

const HEALTH_RING: Record<string, string> = {
  green: "ring-[#3D7C4F]/30",
  amber: "ring-[#C27A1A]/30",
  red: "ring-[#B93A2A]/30",
};

function LayerNodeComponent({ data }: NodeProps) {
  const d = data as unknown as LayerNodeData;
  const health = healthLevel(d.entityCount, d.loadedCount, d.errorCount);
  const isSource = d.type === "source";

  // Pulse speed: active = fast (1.5s), idle = slow (4s), error = fast red
  const pulseStyle: React.CSSProperties = {
    "--pulse-color": d.errorCount > 0 && d.isActive
      ? "rgba(239, 68, 68, 0.4)"
      : `${d.color}66`,
  } as React.CSSProperties;

  const pulseClass = d.isActive
    ? "animate-[layerPulse_1.5s_ease-out_infinite]"
    : "animate-[layerPulse_4s_ease-out_infinite]";

  return (
    <div
      className={cn(
        "relative rounded-2xl backdrop-blur-sm border-2 bg-card/90 transition-all duration-200",
        isSource ? "min-w-[160px] min-h-[80px] px-4 py-3" : "min-w-[180px] min-h-[100px] px-5 py-4",
        pulseClass,
      )}
      style={{
        borderColor: d.color,
        ...pulseStyle,
      }}
    >
      {/* Health indicator dot — top right */}
      <div className="absolute -top-1.5 -right-1.5 z-10">
        <div
          className={cn(
            "w-3.5 h-3.5 rounded-full ring-2",
            HEALTH_COLORS[health],
            HEALTH_RING[health],
          )}
        />
      </div>

      {/* Active ring glow */}
      {d.isActive && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            boxShadow: `0 0 20px 2px ${d.color}40, inset 0 0 12px 0 ${d.color}10`,
          }}
        />
      )}

      {/* Content */}
      <div className="flex flex-col gap-1 relative z-[1]">
        <span className="font-display font-semibold text-sm text-foreground leading-tight">
          {d.label}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {d.entityCount.toLocaleString()} entities
        </span>

        {/* Status row */}
        <div className="flex items-center gap-2 mt-0.5">
          {d.loadedCount > 0 && (
            <span className="text-[10px] font-medium text-[#3D7C4F]">
              {d.loadedCount.toLocaleString()} loaded
            </span>
          )}
          {d.errorCount > 0 && (
            <span className="text-[10px] font-medium text-[#B93A2A]">
              {d.errorCount.toLocaleString()} errors
            </span>
          )}
          {d.loadedCount === 0 && d.errorCount === 0 && d.entityCount > 0 && (
            <span className="text-[10px] text-muted-foreground/50">idle</span>
          )}
        </div>
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !border-2 !rounded-full !-left-[6px]"
        style={{ borderColor: d.color, background: "var(--color-card)" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !border-2 !rounded-full !-right-[6px]"
        style={{ borderColor: d.color, background: "var(--color-card)" }}
      />
    </div>
  );
}

export default memo(LayerNodeComponent);
