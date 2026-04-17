// ============================================================================
// CoworkHero — Cowork-inspired hero for the FMD overview page.
//
// Design DNA from Cowork:
//   - Warm cream canvas + subtle dot-pattern texture
//   - Serif greeting (Fraunces) — used ONLY here, single accent (terracotta asterisk)
//   - Restrained tile grid linking to canonical FMD jobs
//   - Single subtle status line (the "Latest Signal" pulled from real overview data)
//
// IMPORTANT: This is a visual-language adaptation, NOT a feature clone.
// There is NO chat composer, model selector, or "How can I help you today?" input.
// FMD is a data pipeline dashboard — the tiles link to real FMD pages.
// ============================================================================

import { Link } from "react-router-dom";
import {
  Play,
  Radar,
  Cable,
  Microscope,
  Crown,
  AlertTriangle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

interface HeroTile {
  to: string;
  icon: LucideIcon;
  title: string;
  hint: string;
}

const FMD_CANONICAL_JOBS: HeroTile[] = [
  { to: "/load-center",          icon: Play,           title: "Load a source",       hint: "Start or finish an import" },
  { to: "/load-mission-control", icon: Radar,          title: "Watch a run",         hint: "Live execution + diffs" },
  { to: "/sources",              icon: Cable,          title: "Manage sources",      hint: "Connect, scope, schedule" },
  { to: "/profile",              icon: Microscope,     title: "Profile a table",     hint: "Distributions, nulls, drift" },
  { to: "/gold/intake",          icon: Crown,          title: "Promote to Gold",     hint: "Intake → spec → release" },
  { to: "/errors",               icon: AlertTriangle,  title: "Check alerts",        hint: "Failures, blocked, regressions" },
];

function greetingForHour(hour: number): string {
  if (hour < 5)  return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Working late";
}

function heroLineForState(opts: {
  pipelinesHealthy: boolean;
  blockedTables: number;
  sourcesDegraded: number;
}): string {
  if (opts.sourcesDegraded > 0)  return `${opts.sourcesDegraded} source${opts.sourcesDegraded === 1 ? "" : "s"} need attention`;
  if (opts.blockedTables > 0)    return `${opts.blockedTables} table${opts.blockedTables === 1 ? "" : "s"} blocked before tool mode`;
  if (opts.pipelinesHealthy)     return "Pipelines healthy — pick something to work on";
  return "Pick where to take the data next";
}

interface CoworkHeroProps {
  latestSignal: string;
  pipelinesHealthy: boolean;
  blockedTables: number;
  sourcesDegraded: number;
  onRefresh: () => void;
  refreshing?: boolean;
}

export default function CoworkHero({
  latestSignal,
  pipelinesHealthy,
  blockedTables,
  sourcesDegraded,
  onRefresh,
  refreshing = false,
}: CoworkHeroProps) {
  const now = new Date();
  const greeting = greetingForHour(now.getHours());
  const heroLine = heroLineForState({ pipelinesHealthy, blockedTables, sourcesDegraded });

  return (
    <section
      aria-label="Overview hero"
      className="cw-dotgrid cw-dotgrid-fade gs-page-enter"
      style={{
        padding: "44px 32px 32px",
        marginBottom: 8,
        borderRadius: 16,
        background:
          "linear-gradient(180deg, var(--bp-canvas) 0%, var(--bp-surface-1) 100%)",
        border: "1px solid var(--bp-border-subtle)",
        overflow: "hidden",   // keep dot pattern inside rounded corners
      }}
    >
      {/* Greeting row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18, maxWidth: 880 }}>
        <span aria-hidden className="cw-asterisk" style={{ marginTop: 6, flexShrink: 0 }}>✻</span>
        <div style={{ minWidth: 0 }}>
          <h1 className="cw-greeting" style={{ margin: 0 }}>
            {greeting}. {heroLine}.
          </h1>
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "var(--bp-ink-tertiary)",
              fontFamily: "var(--bp-font-body)",
            }}
          >
            <span style={{ color: "var(--bp-ink-secondary)" }}>Latest signal:</span>{" "}
            <span style={{ color: "var(--bp-ink-secondary)" }}>{latestSignal}</span>
          </div>
        </div>

        {/* Refresh — restrained, top-right */}
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh overview"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            border: "1px solid var(--bp-border)",
            borderRadius: 999,
            background: "var(--bp-surface-1)",
            color: "var(--bp-ink-secondary)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Canonical-job tiles — 6 real FMD pages */}
      <div
        role="list"
        style={{
          marginTop: 32,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 12,
          maxWidth: 980,
        }}
      >
        {FMD_CANONICAL_JOBS.map((tile) => (
          <Link
            key={tile.to}
            to={tile.to}
            role="listitem"
            className="cw-tile"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "var(--bp-surface-inset)",
                color: "var(--bp-ink-secondary)",
              }}
            >
              <tile.icon size={15} strokeWidth={1.75} />
            </span>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                color: "var(--bp-ink-primary)",
                lineHeight: 1.2,
              }}
            >
              {tile.title}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--bp-ink-tertiary)",
                lineHeight: 1.35,
              }}
            >
              {tile.hint}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
