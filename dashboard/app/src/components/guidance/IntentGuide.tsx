import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Info } from "lucide-react";
import { Link } from "react-router-dom";

export interface IntentItem {
  label: string;
  value: string;
  detail: string;
}

export interface IntentLink {
  label: string;
  to: string;
}

interface IntentGuidePopoverProps {
  title: string;
  items?: IntentItem[];
  links?: IntentLink[];
  label?: string;
}

interface IntentSignalRowProps {
  items?: IntentItem[];
}

const mono: React.CSSProperties = {
  fontFamily: "var(--bp-font-mono)",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

function shortLabel(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("next")) return "Next";
  if (lower.includes("why")) return "Why";
  if (lower.includes("what")) return "Page";
  return label;
}

export function IntentSignalRow({ items = [] }: IntentSignalRowProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" style={{ marginTop: 14 }}>
      {items.map((item, index) => (
        <div
          key={item.label}
          title={item.detail}
          className="rounded-full px-3 py-2"
          style={{
            border: "1px solid var(--bp-border)",
            background: index === 0 ? "rgba(180,86,36,0.08)" : "var(--bp-surface-inset)",
            minWidth: 0,
            transition: "transform 160ms ease, border-color 160ms ease, background 160ms ease",
            animation: `fadeIn 320ms ${index * 80}ms var(--ease-claude) both`,
          }}
        >
          <div style={{ ...mono, color: "var(--bp-ink-tertiary)" }}>{shortLabel(item.label)}</div>
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              lineHeight: 1.35,
              color: "var(--bp-ink-primary)",
              fontFamily: "var(--bp-font-body)",
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
  items = [],
  links = [],
  label = "Page Guide",
}: IntentGuidePopoverProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full px-3 py-2 transition-transform hover:-translate-y-0.5"
          style={{
            border: "1px solid rgba(180,86,36,0.18)",
            background: "rgba(180,86,36,0.08)",
            color: "var(--bp-copper)",
            fontFamily: "var(--bp-font-body)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <Info size={14} />
          {label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={10}
          align="end"
          style={{
            width: "min(380px, calc(100vw - 32px))",
            borderRadius: 16,
            border: "1px solid rgba(180,86,36,0.14)",
            background: "rgba(255,250,246,0.98)",
            padding: 16,
            zIndex: 70,
          }}
        >
          <div style={{ ...mono, color: "var(--bp-copper)" }}>{label}</div>
          <div
            style={{
              marginTop: 8,
              fontFamily: "var(--bp-font-display)",
              fontSize: 24,
              lineHeight: 1.08,
              color: "var(--bp-ink-primary)",
            }}
          >
            {title}
          </div>
          {items.length > 0 ? (
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              {items.map((item) => (
                <div
                  key={item.label}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.72)",
                    border: "1px solid rgba(120,113,108,0.1)",
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
