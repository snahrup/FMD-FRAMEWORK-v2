// Source Badge — Colored dot + source label. Color from useSourceConfig.

import { resolveSourceLabel, getSourceColor } from "@/hooks/useSourceConfig";

interface SourceBadgeProps {
  source: string;
  className?: string;
}

export function SourceBadge({ source, className }: SourceBadgeProps) {
  const label = resolveSourceLabel(source);
  const color = getSourceColor(source);

  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] ${className ?? ""}`}>
      <span
        className="bp-source-dot"
        style={{ backgroundColor: color.hex }}
      />
      <span style={{ color: "var(--bp-ink-secondary)" }}>{label}</span>
    </span>
  );
}
