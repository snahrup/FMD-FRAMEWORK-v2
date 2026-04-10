import { ArrowRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

interface LaunchTileProps {
  to: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  summary: string;
  ctaLabel: string;
  accent?: string;
  statLabel?: string;
  statValue?: string;
  features?: string[];
}

export function LaunchTile({
  to,
  icon: Icon,
  eyebrow,
  title,
  summary,
  ctaLabel,
  accent = "var(--bp-copper)",
  statLabel,
  statValue,
  features = [],
}: LaunchTileProps) {
  return (
    <Link
      to={to}
      className="group block rounded-[22px] p-5 transition-transform duration-200 hover:-translate-y-1"
      style={{
        border: "1px solid rgba(120,113,108,0.12)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(247,244,239,0.96) 100%)",
        textDecoration: "none",
        boxShadow: "0 20px 40px rgba(28,25,23,0.06)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{
            background: `color-mix(in srgb, ${accent} 14%, white)`,
            color: accent,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 18%, transparent)`,
          }}
        >
          <Icon size={18} />
        </div>
        {statValue ? (
          <div className="rounded-2xl px-3 py-2 text-right" style={{ background: "rgba(255,255,255,0.78)", border: "1px solid rgba(120,113,108,0.08)" }}>
            {statLabel ? (
              <div
                style={{
                  fontFamily: "var(--bp-font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--bp-ink-tertiary)",
                }}
              >
                {statLabel}
              </div>
            ) : null}
            <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700, color: "var(--bp-ink-primary)" }}>
              {statValue}
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 18 }}>
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
          style={{
            margin: "8px 0 0",
            fontSize: 22,
            lineHeight: 1.08,
            color: "var(--bp-ink-primary)",
            fontFamily: "var(--bp-font-display)",
          }}
        >
          {title}
        </h3>
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--bp-ink-secondary)",
            fontFamily: "var(--bp-font-body)",
          }}
        >
          {summary}
        </p>
      </div>

      {features.length > 0 ? (
        <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>
          {features.map((feature) => (
            <span
              key={feature}
              className="rounded-full px-3 py-1.5"
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--bp-ink-secondary)",
                background: "rgba(255,255,255,0.82)",
                border: "1px solid rgba(120,113,108,0.08)",
              }}
            >
              {feature}
            </span>
          ))}
        </div>
      ) : null}

      <div
        className="mt-5 inline-flex items-center gap-1.5 rounded-full px-3 py-2"
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: accent,
          background: `color-mix(in srgb, ${accent} 10%, white)`,
          border: `1px solid color-mix(in srgb, ${accent} 18%, transparent)`,
        }}
      >
        {ctaLabel}
        <ArrowRight size={12} className="transition-transform duration-200 group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
