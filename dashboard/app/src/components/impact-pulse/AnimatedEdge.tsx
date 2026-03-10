// ============================================================================
// AnimatedEdge — Custom React Flow edge with flowing particle animation
//
// Renders a bezier path with animated dash particles that flow from source
// to target. Edge width scales with entity count, and animation speed
// reflects whether the connection is actively processing.
// ============================================================================

import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

export interface AnimatedEdgeData {
  color: string;
  entityCount: number;
  isActive: boolean;
  [key: string]: unknown;
}

function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
}: EdgeProps) {
  const d = (data || {}) as AnimatedEdgeData;
  const color = d.color || "#64748b";
  const entityCount = d.entityCount || 0;
  const isActive = d.isActive || false;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.35,
  });

  // Edge width proportional to entity count: min 2px, max 8px
  const strokeWidth = Math.min(Math.max(2, Math.log2(entityCount + 1) * 1.2), 8);

  // Animation duration: active = 1.5s (fast), idle = 4s (slow)
  const animDuration = isActive ? "1.5s" : "4s";

  return (
    <>
      {/* Base edge — semi-transparent */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: color,
          strokeWidth,
          strokeOpacity: isActive ? 0.5 : 0.25,
          fill: "none",
        }}
      />

      {/* Animated particle overlay — dashed stroke that flows */}
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={Math.max(strokeWidth * 0.5, 1.5)}
        strokeOpacity={isActive ? 0.9 : 0.45}
        strokeDasharray="5 15"
        strokeLinecap="round"
        style={{
          animation: `flowDash ${animDuration} linear infinite`,
        }}
      />

      {/* Secondary particles for active edges — smaller, offset timing */}
      {isActive && (
        <path
          d={edgePath}
          fill="none"
          stroke={color}
          strokeWidth={1}
          strokeOpacity={0.6}
          strokeDasharray="3 20"
          strokeLinecap="round"
          style={{
            animation: `flowDash 2.2s linear infinite`,
            animationDelay: "-0.8s",
          }}
        />
      )}
    </>
  );
}

export default memo(AnimatedEdgeComponent);
