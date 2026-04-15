import type { CSSProperties, ReactNode } from "react";
import {
  IntentGuidePopover,
  type IntentItem,
  type IntentLink,
} from "@/components/guidance/IntentGuide";

export interface CompactHeaderFact {
  label: string;
  value: string;
  tone?: "accent" | "positive" | "warning" | "neutral";
  detail?: string;
}

interface CompactPageHeaderProps {
  eyebrow?: string;
  title: string;
  summary?: string;
  meta?: string | null;
  status?: ReactNode;
  actions?: ReactNode;
  facts?: CompactHeaderFact[];
  guideItems?: IntentItem[];
  guideLinks?: IntentLink[];
  guideLabel?: string;
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
  guideItems = [],
  guideLinks = [],
  guideLabel = "Guide",
}: CompactPageHeaderProps) {
  const hasAside = Boolean(actions) || facts.length > 0;

  return (
    <div
      className="bp-card gs-page-enter"
      style={{
        padding: 16,
        background: "linear-gradient(135deg, rgba(180,86,36,0.04) 0%, rgba(250,247,243,0.96) 52%, rgba(255,255,255,0.96) 100%)",
        border: "1px solid rgba(120,113,108,0.12)",
        overflow: "hidden",
      }}
    >
      <div className="bp-rail bp-rail-caution" style={{ top: 14, bottom: 14 }} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div style={{ minWidth: 0, flex: "1 1 560px", paddingLeft: 6 }}>
          <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 6 }}>
            <span
              style={{
                fontSize: 11,
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
                fontSize: 28,
                lineHeight: 1.08,
                color: "var(--bp-ink-primary)",
              }}
            >
              {title}
            </h1>
            {status ? <div className="shrink-0">{status}</div> : null}
            {summary ? (
              <IntentGuidePopover
                title={title}
                summary={summary}
                items={guideItems}
                links={guideLinks}
                label={guideLabel}
              />
            ) : null}
          </div>

          {summary ? (
            <p
              style={{
                margin: "6px 0 0",
                maxWidth: 760,
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--bp-ink-secondary)",
                fontFamily: "var(--bp-font-body)",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
              }}
            >
              {summary}
            </p>
          ) : null}
        </div>

        {hasAside ? (
          <div
            className="flex flex-col gap-2 lg:items-end"
            style={{ flex: "0 1 520px", minWidth: 0 }}
          >
            {actions ? (
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
            ) : null}
            {facts.length > 0 ? (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {facts.map((fact) => (
                  <div
                    key={`${fact.label}-${fact.value}`}
                    data-metric-label={fact.label}
                    data-metric-value={fact.value}
                    title={fact.detail}
                    className="min-w-0 rounded-full px-3 py-2"
                    style={{
                      ...factToneStyle(fact.tone),
                      maxWidth: "100%",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--bp-font-mono)",
                        fontSize: 10,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--bp-ink-tertiary)",
                      }}
                    >
                      {fact.label}
                    </span>
                    <span
                      style={{
                        marginLeft: 8,
                        fontFamily: "var(--bp-font-body)",
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        color: "var(--bp-ink-primary)",
                      }}
                    >
                      {fact.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default CompactPageHeader;
