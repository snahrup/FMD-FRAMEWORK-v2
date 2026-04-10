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

function Label({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--bp-font-mono)",
        fontSize: 10,
        color: "var(--bp-ink-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </div>
  );
}

function ContextCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning";
}) {
  const border = tone === "warning" ? "rgba(194,122,26,0.22)" : "var(--bp-border)";
  const background = tone === "warning" ? "rgba(194,122,26,0.06)" : "var(--bp-surface-1)";
  const valueColor = tone === "warning" ? "var(--bp-caution-amber)" : "var(--bp-ink-primary)";

  return (
    <div
      className="rounded-lg px-3 py-3"
      style={{ border: `1px solid ${border}`, background }}
    >
      <Label>{label}</Label>
      <div
        style={{
          fontFamily: "var(--bp-font-display)",
          fontSize: 16,
          color: valueColor,
          lineHeight: 1.2,
          marginTop: 4,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 12,
          color: "var(--bp-ink-secondary)",
          lineHeight: 1.45,
          marginTop: 6,
        }}
      >
        {detail}
      </div>
    </div>
  );
}

export function GoldContextBar({ context }: { context: GoldContextSummary | null }) {
  if (!context) return null;

  return (
    <div
      className="grid gap-2 px-6 py-3 md:grid-cols-2 xl:grid-cols-5"
      style={{ borderBottom: "1px solid var(--bp-border)" }}
    >
      <ContextCard
        label="Active Scope"
        value={context.domain_display_name}
        detail={context.scope_note}
      />
      <ContextCard
        label="Current Focus"
        value={context.focus_label}
        detail={`${context.focus_kind}. ${context.focus_note}`}
      />
      <ContextCard
        label="Owner Or Steward"
        value={context.owner_label}
        detail={context.owner_note}
      />
      <ContextCard
        label="Needs Attention"
        value={`${context.unresolved_issues}`}
        detail="Open issues spanning blocked intake, unresolved clusters, draft definitions, or release gaps."
        tone={context.unresolved_issues > 0 ? "warning" : "default"}
      />
      <ContextCard
        label="Last Refreshed"
        value={context.last_updated}
        detail="Timestamp for the latest workflow shell refresh. Use page-level evidence panels for deeper detail."
      />
    </div>
  );
}
