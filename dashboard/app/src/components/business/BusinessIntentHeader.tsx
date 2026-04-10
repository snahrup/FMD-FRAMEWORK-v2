import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import {
  IntentGuidePopover,
  IntentSignalRow,
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
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        className="bp-card"
        style={{
          padding: 20,
          background: "linear-gradient(135deg, rgba(180,86,36,0.08) 0%, rgba(250,247,243,0.96) 46%, rgba(255,255,255,0.96) 100%)",
          overflow: "hidden",
        }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div style={{ maxWidth: 900, flex: "1 1 640px" }}>
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
                fontSize: 32,
                lineHeight: 1.1,
                color: "var(--bp-ink-primary)",
                margin: 0,
              }}
            >
              {title}
            </h1>
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 14,
                lineHeight: 1.6,
                color: "var(--bp-ink-secondary)",
                fontFamily: "var(--bp-font-body)",
                maxWidth: 860,
              }}
            >
              {summary}
            </p>

            <IntentSignalRow items={items} />

            {links.length > 0 ? (
              <div className="flex gap-2 flex-wrap" style={{ marginTop: 14 }}>
                {links.map((link, index) => (
                  <Link
                    key={`${link.to}-${link.label}`}
                    to={link.to}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-2 transition-transform hover:-translate-y-0.5"
                    style={{
                      fontSize: 12,
                      color: index === 0 ? "var(--bp-surface-1)" : "var(--bp-ink-primary)",
                      textDecoration: "none",
                      fontFamily: "var(--bp-font-body)",
                      border: index === 0 ? "1px solid rgba(180,86,36,0.24)" : "1px solid var(--bp-border)",
                      background: index === 0 ? "var(--bp-copper)" : "var(--bp-surface-1)",
                      fontWeight: 600,
                      boxShadow: index === 0 ? "0 14px 28px rgba(180,86,36,0.18)" : "none",
                    }}
                  >
                    {link.label}
                    <ArrowRight size={12} />
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {items.length > 0 || links.length > 0 ? (
              <IntentGuidePopover title={title} items={items} links={links} />
            ) : null}
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
