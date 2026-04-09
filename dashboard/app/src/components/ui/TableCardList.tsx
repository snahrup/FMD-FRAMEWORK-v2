import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface TableCardListStat {
  label: string;
  value: React.ReactNode;
}

export interface TableCardListProps<T>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  items: T[];
  getId: (item: T) => string;
  getTitle: (item: T) => React.ReactNode;
  getStats: (item: T) => TableCardListStat[];
  getSubtitle?: (item: T) => React.ReactNode;
  renderExpanded?: (item: T) => React.ReactNode;
  expandedItemId?: string | null;
  onExpandedItemChange?: (itemId: string | null, item: T) => void;
  onCardClick?: (item: T) => void;
  emptyState?: React.ReactNode;
  loadingState?: React.ReactNode;
  isLoading?: boolean;
  cardClassName?: string;
}

export function TableCardList<T>({
  items,
  getId,
  getTitle,
  getStats,
  getSubtitle,
  renderExpanded,
  expandedItemId = null,
  onExpandedItemChange,
  onCardClick,
  emptyState,
  loadingState,
  isLoading = false,
  className,
  cardClassName,
  ...props
}: TableCardListProps<T>) {
  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)} {...props}>
        {loadingState ?? (
          <Card className="p-4">
            <p className="text-small text-[var(--bp-ink-tertiary)]">Loading rows...</p>
          </Card>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={cn("space-y-3", className)} {...props}>
        {emptyState ?? (
          <Card className="p-4">
            <p className="text-small text-[var(--bp-ink-tertiary)]">No rows to display.</p>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)} {...props}>
      {items.map((item) => {
        const itemId = getId(item);
        const stats = getStats(item).slice(0, 4);
        const subtitle = getSubtitle?.(item);
        const isExpanded = expandedItemId === itemId;
        const canExpand = Boolean(renderExpanded && onExpandedItemChange);
        const isClickable = Boolean(onCardClick);

        return (
          <Card
            key={itemId}
            data-testid={`table-card-${itemId}`}
            className={cn(
              "overflow-hidden rounded-xl border border-[var(--bp-border)] bg-[var(--bp-surface-1)]",
              cardClassName
            )}
          >
            <div
              className={cn(
                "flex items-start gap-3 p-4",
                isClickable && "cursor-pointer",
                canExpand && "pb-3"
              )}
              role={isClickable ? "button" : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onClick={() => onCardClick?.(item)}
              onKeyDown={(event) => {
                if (!isClickable) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onCardClick?.(item);
                }
              }}
            >
              <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-1">
                  <div
                    className="text-h3 truncate font-semibold text-[var(--bp-ink-primary)]"
                    title={typeof getTitle(item) === "string" ? (getTitle(item) as string) : undefined}
                  >
                    {getTitle(item)}
                  </div>
                  {subtitle ? (
                    <div className="text-small text-[var(--bp-ink-tertiary)]">{subtitle}</div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {stats.map((stat) => (
                    <div
                      key={`${itemId}-${stat.label}`}
                      className="min-h-[32px] rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-inset)] px-3 py-1.5"
                      data-testid={`table-card-${itemId}-stat-${stat.label}`}
                    >
                      <div className="text-caption uppercase tracking-[0.04em] text-[var(--bp-ink-muted)]">
                        {stat.label}
                      </div>
                      <div className="text-small font-medium text-[var(--bp-ink-primary)]">
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {canExpand ? (
                <button
                  type="button"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-inset)] text-[var(--bp-ink-secondary)] transition-colors hover:bg-[var(--bp-copper-light)] hover:text-[var(--bp-copper)]"
                  aria-expanded={isExpanded}
                  aria-controls={`table-card-expanded-${itemId}`}
                  aria-label={isExpanded ? "Collapse row details" : "Expand row details"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onExpandedItemChange?.(isExpanded ? null : itemId, item);
                  }}
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              ) : null}
            </div>

            {canExpand && isExpanded && renderExpanded ? (
              <div
                id={`table-card-expanded-${itemId}`}
                className="border-t border-[var(--bp-border)] bg-[var(--bp-surface-inset)] px-4 py-3"
                data-testid={`table-card-expanded-${itemId}`}
              >
                {renderExpanded(item)}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

export default TableCardList;
