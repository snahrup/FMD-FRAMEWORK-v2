import { IntentGuidePopover, type IntentItem } from "@/components/guidance/IntentGuide";

interface ActivityItem {
  id: number;
  action: string;
  object_label: string;
  created_at: string;
}

export function GoldActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) return null;

  const preview = items.slice(0, 2);
  const overflow = items.length - preview.length;
  const guideItems: IntentItem[] = items.slice(0, 6).map((item) => ({
    label: item.created_at,
    value: `${item.object_label} ${item.action}`,
    detail: `Recorded workflow activity at ${item.created_at}.`,
  }));

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-6 py-3"
      style={{ borderBottom: "1px solid var(--bp-border)" }}
    >
      <span
        style={{
          fontFamily: "var(--bp-font-mono)",
          fontSize: 10,
          color: "var(--bp-ink-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Recent Activity
      </span>
      {preview.map((item) => (
        <span
          key={item.id}
          className="rounded-full px-2.5 py-1"
          style={{
            fontFamily: "var(--bp-font-body)",
            fontSize: 11,
            color: "var(--bp-ink-secondary)",
            background: "var(--bp-surface-1)",
            border: "1px solid var(--bp-border)",
          }}
        >
          {item.object_label} {item.action} · {item.created_at}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="rounded-full px-2.5 py-1"
          style={{
            fontFamily: "var(--bp-font-body)",
            fontSize: 11,
            color: "var(--bp-ink-tertiary)",
            background: "var(--bp-surface-inset)",
            border: "1px solid var(--bp-border)",
          }}
        >
          +{overflow} more
        </span>
      ) : null}
      {items.length > 2 ? (
        <div className="ml-auto">
          <IntentGuidePopover
            title="Recent Activity"
            summary="Latest workflow receipts across intake, review, release, and live stewardship."
            items={guideItems}
            label="View feed"
          />
        </div>
      ) : null}
    </div>
  );
}
