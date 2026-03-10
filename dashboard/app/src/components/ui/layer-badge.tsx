import { cn } from "@/lib/utils";
import { LAYER_MAP, type LayerDef } from "@/lib/layers";

interface LayerBadgeProps {
  layer: string;
  size?: "sm" | "md";
  showIcon?: boolean;
  className?: string;
}

export function LayerBadge({ layer, size = "sm", showIcon = true, className }: LayerBadgeProps) {
  const def: LayerDef | undefined = LAYER_MAP[layer.toLowerCase()];
  const Icon = def?.icon;
  const label = def?.label ?? layer;
  const color = def?.color ?? "#64748b";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border font-mono",
        size === "sm" && "text-[10px] px-1.5 py-0.5",
        size === "md" && "text-xs px-2 py-0.5",
        className
      )}
      style={{
        color,
        backgroundColor: `${color}15`,
        borderColor: `${color}30`,
      }}
    >
      {showIcon && Icon && <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />}
      {label}
    </span>
  );
}
