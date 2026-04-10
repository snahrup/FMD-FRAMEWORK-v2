import { ArrowRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import {
  IntentGuidePopover,
  type IntentItem,
  type IntentLink,
} from "@/components/guidance/IntentGuide";

export interface WorkbenchFact {
  label: string;
  value: string;
  detail?: string;
  tone?: "accent" | "positive" | "warning" | "neutral";
}

export interface WorkbenchAction {
  label: string;
  to?: string;
  onClick?: () => void;
  icon?: LucideIcon;
  tone?: "primary" | "secondary" | "quiet";
}

interface ExploreWorkbenchHeaderProps {
  title: string;
  summary: string;
  eyebrow?: string;
  meta?: string | null;
  facts?: WorkbenchFact[];
  guideItems?: IntentItem[];
  guideLinks?: IntentLink[];
  actions?: WorkbenchAction[];
  aside?: ReactNode;
}

function factToneStyles(tone: WorkbenchFact["tone"]) {
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
        background: "var(--bp-surface-inset)",
      };
  }
}

function ActionPill({ action }: { action: WorkbenchAction }) {
  const Icon = action.icon;
  const baseStyle: CSSProperties = action.tone === "primary"
    ? {
        color: "var(--bp-copper)",
        border: "1px solid rgba(180,86,36,0.18)",
        background: "rgba(180,86,36,0.08)",
      }
    : action.tone === "quiet"
      ? {
          color: "var(--bp-ink-secondary)",
          border: "1px solid rgba(120,113,108,0.1)",
          background: "rgba(255,255,255,0.6)",
        }
      : {
          color: "var(--bp-ink-primary)",
          border: "1px solid var(--bp-border)",
          background: "rgba(255,255,255,0.72)",
        };

  const content = (
    <>
      {Icon ? <Icon size={13} /> : null}
      {action.label}
      {action.to ? <ArrowRight size={12} /> : null}
    </>
  );

  const className = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-transform hover:-translate-y-0.5";
  const style: CSSProperties = {
    ...baseStyle,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "var(--bp-font-body)",
    textDecoration: "none",
  };

  if (action.to) {
    return <Link to={action.to} className={className} style={style}>{content}</Link>;
  }

  return (
    <button type="button" onClick={action.onClick} className={className} style={style}>
      {content}
    </button>
  );
}

export function ExploreWorkbenchHeader({
  title,
  summary,
  eyebrow = "Explore",
  meta,
  facts = [],
  guideItems = [],
  guideLinks = [],
  actions = [],
  aside,
}: ExploreWorkbenchHeaderProps) {
  return (
    <div
      className="bp-card"
      style={{
        padding: 16,
        background: "rgba(255,255,255,0.88)",
        border: "1px solid rgba(120,113,108,0.12)",
      }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div style={{ maxWidth: 940, flex: "1 1 640px" }}>
          <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 6 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--bp-copper)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {eyebrow}
            </span>
            {meta ? (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--bp-ink-muted)",
                  fontFamily: "var(--bp-font-body)",
                }}
              >
                {meta}
              </span>
            ) : null}
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div style={{ flex: "1 1 420px", minWidth: 0 }}>
              <h1
                className="bp-display"
                style={{
                  fontSize: 26,
                  lineHeight: 1.1,
                  color: "var(--bp-ink-primary)",
                  margin: 0,
                }}
              >
                {title}
              </h1>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "var(--bp-ink-secondary)",
                  fontFamily: "var(--bp-font-body)",
                  maxWidth: 760,
                }}
              >
                {summary}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {guideItems.length > 0 || guideLinks.length > 0 ? (
                <IntentGuidePopover title={title} items={guideItems} links={guideLinks} label="Tool Guide" />
              ) : null}
              {actions.map((action) => (
                <ActionPill key={`${action.label}-${action.to || "button"}`} action={action} />
              ))}
            </div>
          </div>
        </div>
        {aside ? <div style={{ flex: "0 0 auto" }}>{aside}</div> : null}
      </div>

      {facts.length > 0 ? (
        <div
          className="grid gap-2"
          style={{
            marginTop: 14,
            gridTemplateColumns: `repeat(${Math.min(Math.max(facts.length, 1), 4)}, minmax(0, 1fr))`,
          }}
        >
          {facts.map((fact) => (
            <div
              key={fact.label}
              style={{
                ...factToneStyles(fact.tone),
                borderRadius: 14,
                padding: 10,
                minWidth: 0,
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
                  color: "var(--bp-ink-primary)",
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1.35,
                }}
              >
                {fact.value}
              </div>
              {fact.detail ? (
                <div
                  style={{
                    marginTop: 4,
                    color: "var(--bp-ink-secondary)",
                    fontFamily: "var(--bp-font-body)",
                    fontSize: 11,
                    lineHeight: 1.45,
                  }}
                >
                  {fact.detail}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
