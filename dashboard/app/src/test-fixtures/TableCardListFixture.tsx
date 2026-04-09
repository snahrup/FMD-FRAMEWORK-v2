import { useState } from "react";
import TableCardList, { type TableCardListStat } from "@/components/ui/TableCardList";

interface FixtureRow {
  id: string;
  title: string;
  subtitle: string;
  stats: TableCardListStat[];
  detail: string;
}

const rows: FixtureRow[] = [
  {
    id: "mes-orders",
    title: "MES Orders",
    subtitle: "Landing Zone ready",
    stats: [
      { label: "Status", value: "Ready" },
      { label: "Rows", value: "14,281" },
      { label: "Latency", value: "4m" },
    ],
    detail: "MES Orders is configured for incremental refresh and the latest run completed without retries.",
  },
  {
    id: "m3-items",
    title: "M3 Items",
    subtitle: "Bronze load delayed",
    stats: [
      { label: "Status", value: "Delayed" },
      { label: "Rows", value: "2,188" },
      { label: "Errors", value: "3" },
    ],
    detail: "M3 Items is waiting on watermark advancement before the next Bronze sync can start.",
  },
];

export default function TableCardListFixture() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="mx-auto min-h-screen max-w-md bg-[var(--bp-canvas)] px-4 py-6">
      <div className="mb-4 space-y-1">
        <h1 className="text-h1 text-[var(--bp-ink-primary)]">TableCardList fixture</h1>
        <p className="text-small text-[var(--bp-ink-tertiary)]">
          Test route for mobile table to card rendering.
        </p>
      </div>

      <TableCardList
        items={rows}
        getId={(row) => row.id}
        getTitle={(row) => row.title}
        getSubtitle={(row) => row.subtitle}
        getStats={(row) => row.stats}
        expandedItemId={expandedId}
        onExpandedItemChange={(itemId) => setExpandedId(itemId)}
        renderExpanded={(row) => (
          <div className="space-y-2">
            <p className="text-small text-[var(--bp-ink-secondary)]">{row.detail}</p>
            <div className="text-caption text-[var(--bp-ink-muted)]">Fixture detail content</div>
          </div>
        )}
      />
    </div>
  );
}
