import type { ReactNode } from "react";
import {
  IntentGuidePopover,
  type IntentItem,
  type IntentLink,
} from "@/components/guidance/IntentGuide";

interface BusinessIntentHeaderProps {
  title: string;
  summary: string;
  meta?: string | null;
  eyebrow?: string;
  items?: IntentItem[];
  links?: IntentLink[];
  actions?: ReactNode;
}

export function BusinessIntentHeader({
  title,
  summary,
  meta,
  eyebrow = "Orient",
  items = [],
  links = [],
  actions,
}: BusinessIntentHeaderProps) {
  const previewSignal = items[0];

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        className="bp-card gs-page-enter"
        style={{
          padding: 18,
          background: "var(--bp-surface-1)",
          border: "1px solid var(--bp-border)",
          overflow: "hidden",
        }}
      >
        <div className="bp-rail bp-rail-caution" style={{ top: 14, bottom: 14 }} />
        <div className="flex items-start justify-between gap-4 flex-wrap" style={{ paddingLeft: 6 }}>
          <div style={{ maxWidth: 900, flex: "1 1 640px", minWidth: 0 }}>
            <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 8 }}>
              <span
                style={{
                  fontSize: 11,
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
                    fontSize: 13,
                    color: "var(--bp-ink-muted)",
                    fontFamily: "var(--bp-font-body)",
                  }}
                >
                  {meta}
                </span>
              ) : null}
            </div>
            <h1
              className="bp-display"
              style={{
                fontSize: 30,
                lineHeight: 1.1,
                color: "var(--bp-ink-primary)",
                margin: 0,
              }}
            >
              {title}
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--bp-ink-secondary)",
                fontFamily: "var(--bp-font-body)",
                maxWidth: 860,
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
              }}
            >
              {summary}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {previewSignal ? (
              <div
                title={previewSignal.detail}
                className="rounded-full px-3 py-2"
                style={{
                  border: "1px solid rgba(180,86,36,0.16)",
                  background: "rgba(180,86,36,0.08)",
                  maxWidth: 240,
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
                  {previewSignal.label}
                </span>
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--bp-ink-primary)",
                    fontFamily: "var(--bp-font-body)",
                  }}
                >
                  {previewSignal.value}
                </span>
              </div>
            ) : null}
            {summary || items.length > 0 || links.length > 0 ? (
              <IntentGuidePopover title={title} summary={summary} items={items} links={links} />
            ) : null}
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
