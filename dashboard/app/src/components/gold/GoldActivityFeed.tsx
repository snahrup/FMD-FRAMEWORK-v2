interface ActivityItem {
  id: number;
  action: string;
  object_label: string;
  created_at: string;
}

export function GoldActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) return null;

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
      {items.map((item) => (
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
    </div>
  );
}
