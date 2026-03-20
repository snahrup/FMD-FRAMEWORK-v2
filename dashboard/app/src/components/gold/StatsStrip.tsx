// Stats Strip — Operational counters bar displayed at the top of every Gold Studio page.

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
      className="sticky z-[9] flex items-center justify-center gap-5 px-6 py-2"
      style={{
        top: 0,
        background: "var(--bp-surface-1)",
        borderBottom: "1px solid var(--bp-border)",
      }}
    >
      {items.map((item, i) => {
        const Wrapper = item.onClick ? "button" : "div";
        return (
          <span key={i} className="contents">
            <Wrapper
              className={cn(
                "flex items-center gap-1.5 group",
                item.onClick && "cursor-pointer"
              )}
              {...(item.onClick ? { onClick: item.onClick, type: "button" as const } : {})}
            >
              {/* Label */}
              <span
                className="uppercase"
                style={{
                  fontFamily: "var(--bp-font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.05em",
                  color: "var(--bp-ink-tertiary)",
                }}
              >
                {item.label}
              </span>

              {/* Value */}
              <span
                className={cn(
                  "transition-all duration-150",
                  item.onClick &&
                    "group-hover:underline group-hover:decoration-[var(--bp-copper)] underline-offset-2"
                )}
                style={{
                  fontFamily: "var(--bp-font-display)",
                  fontSize: 18,
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

            {/* Divider between stats */}
            {i < items.length - 1 && (
              <span style={{ width: 1, height: 16, background: "var(--bp-border)" }} />
            )}
          </span>
        );
      })}
    </div>
  );
}
