import { IntentSignalRow, type IntentItem } from "@/components/guidance/IntentGuide";

interface GoldContextSummary {
  domain_display_name: string;
  scope_note: string;
  focus_label: string;
  focus_kind: string;
  focus_note: string;
  owner_label: string;
  owner_note: string;
  unresolved_issues: number;
  last_updated: string;
}

export function GoldContextBar({ context }: { context: GoldContextSummary | null }) {
  if (!context) return null;

  const items: IntentItem[] = [
    {
      label: "Scope",
      value: context.domain_display_name,
      detail: context.scope_note,
      tone: "accent",
    },
    {
      label: "Focus",
      value: context.focus_label,
      detail: `${context.focus_kind}. ${context.focus_note}`,
    },
    {
      label: "Owner",
      value: context.owner_label,
      detail: context.owner_note,
    },
    {
      label: "Needs Attention",
      value: `${context.unresolved_issues}`,
      detail: "Open issues spanning blocked intake, unresolved clusters, draft definitions, or release gaps.",
      tone: context.unresolved_issues > 0 ? "warning" : "positive",
    },
    {
      label: "Updated",
      value: context.last_updated,
      detail: "Timestamp for the latest workflow shell refresh. Use page-level evidence panels for deeper detail.",
    },
  ];

  return (
    <div className="px-6 py-3" style={{ borderBottom: "1px solid var(--bp-border)" }}>
      <IntentSignalRow items={items} marginTop={0} />
    </div>
  );
}
