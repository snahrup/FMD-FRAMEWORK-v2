import { ArrowRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

interface OverviewWorkbenchCardProps {
  to: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  summary: string;
  ctaLabel: string;
  accent: string;
  statLabel: string;
  statValue: string;
  statDetail?: string;
}

export function OverviewWorkbenchCard({
  to,
  icon: Icon,
  eyebrow,
  title,
  summary,
  ctaLabel,
  accent,
  statLabel,
  statValue,
  statDetail,
}: OverviewWorkbenchCardProps) {
  return (
    <div
      className="bp-card gs-stagger-card h-full"
      style={{
        minHeight: 244,
        padding: 20,
        background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 4%, var(--bp-surface-1)) 0%, var(--bp-surface-1) 100%)`,
      }}
    >
      <div className="bp-rail" style={{ background: accent, top: 14, bottom: 14 }} />
      <div className="flex h-full flex-col" style={{ paddingLeft: 6 }}>
        <div className="flex items-start justify-between gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-[16px]"
            style={{
              background: `color-mix(in srgb, ${accent} 12%, white)`,
              color: accent,
              border: `1px solid color-mix(in srgb, ${accent} 18%, transparent)`,
            }}
          >
            <Icon size={18} />
          </div>

          <div
            className="rounded-[18px] px-3 py-2 text-right"
            style={{
              border: "1px solid var(--bp-border)",
              background: "rgba(255,255,255,0.84)",
              minWidth: 112,
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
              {statLabel}
            </div>
            <div
              className="bp-mono"
              style={{
                marginTop: 4,
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1,
                color: "var(--bp-ink-primary)",
              }}
            >
              {statValue}
            </div>
            {statDetail ? (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  lineHeight: 1.3,
                  color: "var(--bp-ink-muted)",
                }}
              >
                {statDetail}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 18, flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--bp-font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            {eyebrow}
          </div>
          <h3
            className="bp-display"
            style={{
              margin: "8px 0 0",
              fontSize: 22,
              lineHeight: 1.03,
              color: "var(--bp-ink-primary)",
            }}
          >
            {title}
          </h3>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--bp-ink-secondary)",
            }}
          >
            {summary}
          </p>
        </div>

        <div style={{ marginTop: 18 }}>
          <Link
            to={to}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2"
            style={{
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 700,
              color: accent,
              background: `color-mix(in srgb, ${accent} 10%, white)`,
              border: `1px solid color-mix(in srgb, ${accent} 18%, transparent)`,
            }}
          >
            {ctaLabel}
            <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default OverviewWorkbenchCard;
