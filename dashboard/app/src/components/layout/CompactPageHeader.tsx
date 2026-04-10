import type { CSSProperties, ReactNode } from "react";

export interface CompactHeaderFact {
  label: string;
  value: string;
  tone?: "accent" | "positive" | "warning" | "neutral";
}

interface CompactPageHeaderProps {
  eyebrow?: string;
  title: string;
  summary?: string;
  meta?: string | null;
  status?: ReactNode;
  actions?: ReactNode;
  facts?: CompactHeaderFact[];
}

function factToneStyle(tone: CompactHeaderFact["tone"]): CSSProperties {
  switch (tone) {
    case "accent":
      return {
        border: "1px solid rgba(180,86,36,0.18)",
        background: "rgba(180,86,36,0.08)",
      };
    case "positive":
      return {
        border: "1px solid rgba(45,106,79,0.18)",
        background: "rgba(45,106,79,0.08)",
      };
    case "warning":
      return {
        border: "1px solid rgba(194,122,26,0.18)",
        background: "rgba(194,122,26,0.08)",
      };
    default:
      return {
        border: "1px solid var(--bp-border)",
        background: "rgba(255,255,255,0.72)",
      };
  }
}

export function CompactPageHeader({
  eyebrow = "Workspace",
  title,
  summary,
  meta,
  status,
  actions,
  facts = [],
}: CompactPageHeaderProps) {
  return (
    <div
      className="bp-card"
      style={{
        padding: 16,
        background: "rgba(255,255,255,0.9)",
        border: "1px solid rgba(120,113,108,0.12)",
      }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div style={{ minWidth: 0, flex: "1 1 560px" }}>
          <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 6 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--bp-copper)",
              }}
            >
              {eyebrow}
            </span>
            {meta ? (
              <span
                style={{
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: "var(--bp-ink-muted)",
                }}
              >
                {meta}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <h1
              className="bp-display"
              style={{
                margin: 0,
                fontSize: 26,
                lineHeight: 1.08,
                color: "var(--bp-ink-primary)",
              }}
            >
              {title}
            </h1>
            {status ? <div className="shrink-0">{status}</div> : null}
          </div>

          {summary ? (
            <p
              style={{
                margin: "8px 0 0",
                maxWidth: 760,
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--bp-ink-secondary)",
                fontFamily: "var(--bp-font-body)",
              }}
            >
              {summary}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
        ) : null}
      </div>

      {facts.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {facts.map((fact) => (
            <div
              key={`${fact.label}-${fact.value}`}
              style={{
                ...factToneStyle(fact.tone),
                borderRadius: 14,
                padding: "10px 12px",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--bp-font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--bp-ink-tertiary)",
                }}
              >
                {fact.label}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1.35,
                  color: "var(--bp-ink-primary)",
                }}
              >
                {fact.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default CompactPageHeader;
