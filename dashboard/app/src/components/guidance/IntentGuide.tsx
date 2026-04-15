import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Info } from "lucide-react";
import { Link } from "react-router-dom";

type IntentTone = "accent" | "warning" | "positive" | "neutral";

export interface IntentItem {
  label: string;
  value: string;
  detail: string;
  tone?: IntentTone;
}

export interface IntentLink {
  label: string;
  to: string;
}

interface IntentGuidePopoverProps {
  title: string;
  summary?: string;
  items?: IntentItem[];
  links?: IntentLink[];
  label?: string;
}

interface IntentSignalRowProps {
  items?: IntentItem[];
  marginTop?: number;
}

const mono: React.CSSProperties = {
  fontFamily: "var(--bp-font-mono)",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

function toneStyle(tone: IntentTone): React.CSSProperties {
  switch (tone) {
    case "accent":
      return {
        border: "1px solid rgba(180,86,36,0.18)",
        background: "rgba(180,86,36,0.08)",
      };
    case "warning":
      return {
        border: "1px solid rgba(194,122,26,0.18)",
        background: "rgba(194,122,26,0.10)",
      };
    case "positive":
      return {
        border: "1px solid rgba(61,124,79,0.18)",
        background: "rgba(61,124,79,0.08)",
      };
    default:
      return {
        border: "1px solid var(--bp-border)",
        background: "rgba(255,255,255,0.74)",
      };
  }
}

function shortLabel(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("next")) return "Next";
  if (lower.includes("why")) return "Why";
  if (lower.includes("what")) return "Page";
  return label;
}

export function IntentSignalRow({ items = [], marginTop = 14 }: IntentSignalRowProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" style={{ marginTop }}>
      {items.map((item, index) => (
        <div
          key={item.label}
          title={item.detail}
          className="min-w-0 rounded-full px-3 py-2"
          style={{
            ...toneStyle(item.tone ?? (index === 0 ? "accent" : "neutral")),
            maxWidth: "100%",
            transition: "transform 160ms ease, border-color 160ms ease, background 160ms ease",
            animation: `fadeIn 320ms ${index * 80}ms var(--ease-claude) both`,
          }}
        >
          <div style={{ ...mono, color: "var(--bp-ink-tertiary)" }}>{shortLabel(item.label)}</div>
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              lineHeight: 1.35,
              color: "var(--bp-ink-primary)",
              fontFamily: "var(--bp-font-body)",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 1,
              overflow: "hidden",
            }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function IntentGuidePopover({
  title,
  summary,
  items = [],
  links = [],
  label = "Page Guide",
}: IntentGuidePopoverProps) {
  const signalCount = items.length + links.length;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition-transform hover:-translate-y-0.5"
          style={{
            border: "1px solid var(--bp-border)",
            background: "rgba(255,255,255,0.82)",
            color: "var(--bp-ink-secondary)",
            fontFamily: "var(--bp-font-body)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <Info size={13} />
          {label}
          {signalCount > 0 ? (
            <span
              className="rounded-full px-1.5 py-0.5"
              style={{
                ...mono,
                fontSize: 9,
                color: "var(--bp-copper)",
                background: "rgba(180,86,36,0.08)",
                border: "1px solid rgba(180,86,36,0.14)",
              }}
            >
              {signalCount}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={10}
          align="end"
          className="gs-modal-enter"
          style={{
            width: "min(420px, calc(100vw - 32px))",
            borderRadius: 18,
            border: "1px solid var(--bp-border-strong)",
            background: "rgba(254,253,251,0.98)",
            padding: 18,
            zIndex: 70,
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div style={{ ...mono, color: "var(--bp-copper)" }}>{label}</div>
              <div
                style={{
                  marginTop: 8,
                  fontFamily: "var(--bp-font-display)",
                  fontSize: 22,
                  lineHeight: 1.08,
                  color: "var(--bp-ink-primary)",
                }}
              >
                {title}
              </div>
            </div>
            {signalCount > 0 ? (
              <span
                className="rounded-full px-2 py-1"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 11,
                  color: "var(--bp-ink-tertiary)",
                  background: "var(--bp-surface-inset)",
                  border: "1px solid var(--bp-border)",
                }}
              >
                {signalCount} signal{signalCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          {summary ? (
            <p
              style={{
                marginTop: 12,
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--bp-ink-secondary)",
                fontFamily: "var(--bp-font-body)",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 3,
                overflow: "hidden",
              }}
            >
              {summary}
            </p>
          ) : null}
          {items.length > 0 ? (
            <div style={{ display: "grid", gap: 10, marginTop: summary ? 14 : 16 }}>
              {items.map((item) => (
                <div
                  key={item.label}
                  style={{
                    ...toneStyle(item.tone ?? "neutral"),
                    padding: 12,
                    borderRadius: 16,
                  }}
                >
                  <div style={{ ...mono, color: "var(--bp-ink-tertiary)" }}>{item.label}</div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 14,
                      lineHeight: 1.35,
                      color: "var(--bp-ink-primary)",
                      fontFamily: "var(--bp-font-body)",
                      fontWeight: 600,
                    }}
                  >
                    {item.value}
                  </div>
                  <div
                    style={{
                      marginTop: 5,
                      fontSize: 12,
                      lineHeight: 1.55,
                      color: "var(--bp-ink-secondary)",
                      fontFamily: "var(--bp-font-body)",
                    }}
                  >
                    {item.detail}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {links.length > 0 ? (
            <div className="flex flex-wrap gap-2" style={{ marginTop: 14 }}>
              {links.map((link) => (
                <Link
                  key={`${link.to}-${link.label}`}
                  to={link.to}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-2"
                  style={{
                    border: "1px solid var(--bp-border)",
                    background: "var(--bp-surface-inset)",
                    color: "var(--bp-ink-primary)",
                    textDecoration: "none",
                    fontFamily: "var(--bp-font-body)",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {link.label}
                  <ArrowRight size={12} />
                </Link>
              ))}
            </div>
          ) : null}
          <Popover.Arrow
            style={{
              fill: "rgba(255,250,246,0.98)",
              stroke: "rgba(180,86,36,0.14)",
              strokeWidth: 1,
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
