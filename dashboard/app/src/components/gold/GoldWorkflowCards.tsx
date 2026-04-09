import type { ReactNode } from "react";

type Tone = "copper" | "success" | "warning" | "danger" | "info" | "neutral";

interface ActionConfig {
  label: string;
  onClick: () => void;
}

interface ToneConfig {
  border: string;
  bg: string;
  badgeBg: string;
  badgeColor: string;
}

const TONE_CFG: Record<Tone, ToneConfig> = {
  copper: {
    border: "rgba(180,86,36,0.22)",
    bg: "rgba(180,86,36,0.06)",
    badgeBg: "rgba(180,86,36,0.10)",
    badgeColor: "var(--bp-copper)",
  },
  success: {
    border: "rgba(61,124,79,0.22)",
    bg: "rgba(61,124,79,0.06)",
    badgeBg: "rgba(61,124,79,0.10)",
    badgeColor: "var(--bp-operational-green)",
  },
  warning: {
    border: "rgba(194,122,26,0.22)",
    bg: "rgba(194,122,26,0.08)",
    badgeBg: "rgba(194,122,26,0.12)",
    badgeColor: "var(--bp-caution-amber)",
  },
  danger: {
    border: "rgba(185,58,42,0.22)",
    bg: "rgba(185,58,42,0.06)",
    badgeBg: "rgba(185,58,42,0.10)",
    badgeColor: "var(--bp-fault-red)",
  },
  info: {
    border: "rgba(59,130,246,0.22)",
    bg: "rgba(59,130,246,0.06)",
    badgeBg: "rgba(59,130,246,0.10)",
    badgeColor: "var(--bp-info, #2563eb)",
  },
  neutral: {
    border: "var(--bp-border)",
    bg: "var(--bp-surface-1)",
    badgeBg: "var(--bp-surface-inset)",
    badgeColor: "var(--bp-ink-secondary)",
  },
};

function Label({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--bp-font-mono)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--bp-ink-tertiary)",
      }}
    >
      {children}
    </span>
  );
}

function MetaRow({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-md px-3 py-2"
          style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}
        >
          <Label>{item.label}</Label>
          <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-primary)", marginTop: 4 }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionButton({ action }: { action: ActionConfig }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      className="rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
      style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)", fontFamily: "var(--bp-font-body)" }}
    >
      {action.label}
    </button>
  );
}

function Surface({
  tone,
  eyebrow,
  title,
  description,
  children,
  action,
}: {
  tone: Tone;
  eyebrow: string;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  action?: ActionConfig;
}) {
  const toneCfg = TONE_CFG[tone];
  return (
    <section
      className="rounded-xl px-4 py-4"
      style={{
        background: toneCfg.bg,
        border: `1px solid ${toneCfg.border}`,
      }}
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5"
              style={{
                background: toneCfg.badgeBg,
                color: toneCfg.badgeColor,
                fontFamily: "var(--bp-font-mono)",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {eyebrow}
            </span>
          </div>
          <h2 style={{ fontFamily: "var(--bp-font-display)", fontSize: 18, color: "var(--bp-ink-primary)", margin: 0 }}>
            {title}
          </h2>
          <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)", marginTop: 6, lineHeight: 1.55 }}>
            {description}
          </div>
        </div>
        {action && <ActionButton action={action} />}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

export function GoldNextActionPanel({
  title,
  description,
  whyItMatters,
  whatHappensNext,
  action,
  tone = "copper",
}: {
  title: string;
  description: string;
  whyItMatters: string;
  whatHappensNext: string;
  action?: ActionConfig;
  tone?: Tone;
}) {
  return (
    <Surface
      tone={tone}
      eyebrow="Next Best Action"
      title={title}
      description={description}
      action={action}
    >
      <MetaRow
        items={[
          { label: "Why this matters", value: whyItMatters },
          { label: "What happens next", value: whatHappensNext },
        ]}
      />
    </Surface>
  );
}

export function GoldAsyncStatusCard({
  title,
  status,
  lastUpdated,
  elapsed,
  latestMilestone,
  nextMilestone,
  tone = "info",
  action,
}: {
  title: string;
  status: string;
  lastUpdated?: string;
  elapsed?: string;
  latestMilestone?: string;
  nextMilestone?: string;
  tone?: Tone;
  action?: ActionConfig;
}) {
  const meta = [
    { label: "Status", value: status },
    { label: "Last update", value: lastUpdated ?? "Waiting for first progress signal" },
    { label: "Latest milestone", value: latestMilestone ?? "No milestone reported yet" },
    { label: "Next expected change", value: nextMilestone ?? "Waiting for the next system update" },
  ];
  if (elapsed) {
    meta.splice(1, 0, { label: "Elapsed", value: elapsed });
  }
  return (
    <Surface
      tone={tone}
      eyebrow="Background Activity"
      title={title}
      description="This work is still active. You should not have to guess whether the system is moving or stalled."
      action={action}
    >
      <MetaRow items={meta} />
    </Surface>
  );
}

export function GoldCompletionReceipt({
  title,
  summary,
  whatChanged,
  nextStep,
}: {
  title: string;
  summary: string;
  whatChanged: string;
  nextStep: string;
}) {
  return (
    <Surface tone="success" eyebrow="Completed" title={title} description={summary}>
      <MetaRow
        items={[
          { label: "What changed", value: whatChanged },
          { label: "What to do next", value: nextStep },
        ]}
      />
    </Surface>
  );
}

export function GoldFailureReceipt({
  title,
  summary,
  preservedState,
  retryScope,
  action,
}: {
  title: string;
  summary: string;
  preservedState: string;
  retryScope: string;
  action?: ActionConfig;
}) {
  return (
    <Surface tone="danger" eyebrow="Needs Attention" title={title} description={summary} action={action}>
      <MetaRow
        items={[
          { label: "What is preserved", value: preservedState },
          { label: "What retry affects", value: retryScope },
        ]}
      />
    </Surface>
  );
}
