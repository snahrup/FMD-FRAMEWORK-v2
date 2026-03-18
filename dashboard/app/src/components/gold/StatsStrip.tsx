// Stats Strip — Hero numbers bar displayed at the top of every Gold Studio page.

import { cn } from "@/lib/utils";

interface StatItem {
  label: string;
  value: number | string;
  onClick?: () => void;
  /** If true, render the number in copper */
  highlight?: boolean;
}

interface StatsStripProps {
  items: StatItem[];
}

export function StatsStrip({ items }: StatsStripProps) {
  return (
    <div
      className="sticky z-[9] flex items-center justify-evenly px-6 py-4"
      style={{
        top: 0, // will stack below the GoldStudioLayout sticky header naturally
        background: "var(--bp-surface-1)",
        borderBottom: "1px solid var(--bp-border)",
      }}
    >
      {items.map((item, i) => {
        const Wrapper = item.onClick ? "button" : "div";
        return (
          <Wrapper
            key={i}
            className={cn(
              "flex flex-col items-center gap-1 group",
              item.onClick && "cursor-pointer"
            )}
            {...(item.onClick ? { onClick: item.onClick, type: "button" as const } : {})}
          >
            {/* Label */}
            <span
              className="font-medium uppercase"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 11,
                fontVariantCaps: "all-small-caps",
                letterSpacing: "0.05em",
                color: "var(--bp-ink-muted)",
              }}
            >
              {item.label}
            </span>

            {/* Value */}
            <span
              className={cn(
                item.onClick &&
                  "group-hover:underline group-hover:decoration-[var(--bp-copper)] underline-offset-4"
              )}
              style={{
                fontFamily: "var(--bp-font-display)",
                fontSize: 32,
                letterSpacing: "-0.01em",
                lineHeight: 1,
                color: item.highlight
                  ? "var(--bp-copper)"
                  : "var(--bp-ink-primary)",
              }}
            >
              {item.value}
            </span>
          </Wrapper>
        );
      })}
    </div>
  );
}
