// ============================================================================
// CoworkHero — Cowork-inspired hero for the FMD overview page.
//
// Impact pass (2026-04-17):
//   - Entrance choreography: asterisk → greeting → signal → tiles → refresh.
//   - Rotating narrative: greeting → latest signal → directional prompt (6s).
//   - Asymmetric tile grid with a dominant primary tile ("Load a source").
//   - Conditional border-beam on "Watch a run" while a pipeline is running.
//   - Quiet icon-only refresh; seam dissolves into the page canvas.
//   - Full prefers-reduced-motion fallback (freezes rotation + animations).
//
// Design DNA from Cowork — warm cream canvas, serif greeting (Fraunces),
// single terracotta accent, restrained tile grid. Visual language only;
// FMD remains a data pipeline dashboard — all tiles link to real FMD pages.
// ============================================================================

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
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
  primary?: boolean;
  /** If true, the primary tile represents an active pipeline run and gets
      the border-beam + a small "live" badge. */
  live?: boolean;
}

// Four stable secondary tiles — always the same 4 jobs, no matter the state.
// Keeps the bento grid spatially consistent between idle and running states.
const FMD_SECONDARY_JOBS: HeroTile[] = [
  { to: "/sources",     icon: Cable,         title: "Manage sources",   hint: "Connect, scope, schedule" },
  { to: "/profile",     icon: Microscope,    title: "Profile a table",  hint: "Distributions, nulls, drift" },
  { to: "/gold/intake", icon: Crown,         title: "Promote to Gold",  hint: "Intake → spec → release" },
  { to: "/errors",      icon: AlertTriangle, title: "Check alerts",     hint: "Failures, blocked, regressions" },
];

/** The primary (dominant) tile flips between two states:
    - idle: invite the user to start a load
    - running: invite the user to watch the live run (beam + live badge) */
const PRIMARY_IDLE: HeroTile = {
  to: "/load-center",
  icon: Play,
  title: "Load a source",
  hint: "Start or finish an import — pick a source and we'll handle Landing, Bronze, and Silver in order.",
  primary: true,
};
const PRIMARY_RUNNING: HeroTile = {
  to: "/load-mission-control",
  icon: Radar,
  title: "A pipeline is running — watch it live",
  hint: "Open Mission Control to follow execution, see row diffs, and catch failures the moment they happen.",
  primary: true,
  live: true,
};

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
  loading: boolean;
}): string {
  if (opts.loading)               return "Bringing you the latest pipeline state";
  if (opts.sourcesDegraded > 0)   return `${opts.sourcesDegraded} source${opts.sourcesDegraded === 1 ? "" : "s"} need attention`;
  if (opts.blockedTables > 0)     return `${opts.blockedTables} table${opts.blockedTables === 1 ? "" : "s"} blocked before tool mode`;
  if (opts.pipelinesHealthy)      return "Pipelines healthy — pick something to work on";
  return "Pick where to take the data next";
}

/** Current hour-of-day, refreshed once a minute (Issue 13). */
function useHourOfDay(): number {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const t = setInterval(() => {
      const h = new Date().getHours();
      setHour((prev) => (prev === h ? prev : h));
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return hour;
}

/** Tracks prefers-reduced-motion. Freezes narrative rotation + animations. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

interface CoworkHeroProps {
  latestSignal: string;
  pipelinesHealthy: boolean;
  blockedTables: number;
  sourcesDegraded: number;
  onRefresh: () => void;
  refreshing?: boolean;
  /** True while the overview's first data load is still in flight. */
  loading?: boolean;
  /** True when at least one pipeline run is currently executing — drives
      the informational border-beam on "Watch a run". */
  anyRunning?: boolean;
}

type NarrativeKind = "greet" | "signal" | "prompt";
interface NarrativeMessage { id: NarrativeKind; text: string; }

const NARRATIVE_INTERVAL_MS = 6000;

export default function CoworkHero({
  latestSignal,
  pipelinesHealthy,
  blockedTables,
  sourcesDegraded,
  onRefresh,
  refreshing = false,
  loading = false,
  anyRunning = false,
}: CoworkHeroProps) {
  const hour = useHourOfDay();
  const greeting = useMemo(() => greetingForHour(hour), [hour]);
  const heroLine = useMemo(
    () => heroLineForState({ pipelinesHealthy, blockedTables, sourcesDegraded, loading }),
    [pipelinesHealthy, blockedTables, sourcesDegraded, loading],
  );
  const reduceMotion = useReducedMotion();

  const messages = useMemo<NarrativeMessage[]>(() => [
    { id: "greet",  text: `${greeting}. ${heroLine}.` },
    { id: "signal", text: latestSignal },
    { id: "prompt", text: "Load a source. Watch a run. Promote to Gold." },
  ], [greeting, heroLine, latestSignal]);

  const [narrativeIndex, setNarrativeIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Reset to greeting when the hour changes — new context, new arc.
  useEffect(() => { setNarrativeIndex(0); }, [greeting]);

  useEffect(() => {
    if (loading || reduceMotion || paused) return;
    const t = setInterval(() => {
      setNarrativeIndex((i) => (i + 1) % messages.length);
    }, NARRATIVE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [loading, reduceMotion, paused, messages.length]);

  const current = messages[narrativeIndex] ?? messages[0];

  // Track whether first paint has passed. On first paint we delay the
  // message entrance so it arrives after the asterisk + container fade-in.
  // Subsequent rotations animate immediately (no delay) for snappy feel.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => { setHasMounted(true); }, []);

  return (
    <section
      aria-label="Overview hero"
      className="cw-dotgrid cw-dotgrid-fade cw-hero cw-hero-blended gs-page-enter"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      style={{
        position: "relative",
        padding: "44px 32px 48px",
        marginBottom: 0,
        borderRadius: 16,
        background:
          "linear-gradient(180deg, var(--bp-canvas) 0%, var(--bp-surface-1) 55%, var(--bp-canvas) 100%)",
        border: "1px solid var(--bp-border-subtle)",
        borderBottomColor: "transparent",
        overflow: "hidden",
      }}
    >
      {/* Greeting row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18, maxWidth: 900 }}>
        <span aria-hidden className="cw-asterisk cw-hero-asterisk" style={{ marginTop: 6, flexShrink: 0 }}>✻</span>

        <div style={{ minWidth: 0, flex: 1 }}>
          {/* h1 deliberately NOT aria-live — rotating it would spam screen
              readers every 6s. SR users get the canonical state via the
              subtitle line below (which has aria-live) and never see the
              rotation (reduced-motion freezes it to the greet message).

              min-height reserves 2 lines of greeting space so rotating
              between 1-line and 2-line messages does NOT shift the subtitle
              and tile grid below — the user complaint was the jarring
              layout shift when text length changed. */}
          <h1
            className="cw-greeting"
            style={{ margin: 0, minHeight: "2.1em", display: "block" }}
          >
            {reduceMotion ? (
              <span>{current.text}</span>
            ) : (
              <AnimatePresence mode="wait">
                <motion.span
                  key={narrativeIndex}
                  className="cw-hero-msg"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6, transition: { duration: 0.32, ease: [0.4, 0, 1, 1] } }}
                  transition={{
                    duration: 0.75,
                    ease: [0.25, 0.1, 0.25, 1],
                    delay: hasMounted ? 0 : 0.28,
                  }}
                >
                  {current.text}
                </motion.span>
              </AnimatePresence>
            )}
          </h1>

          {/* Subtitle — always rendered so the layout doesn't jolt when the
              hero message changes length. Mild redundancy during state B
              (hero showing signal) is worth the stability. */}
          <div
            className="cw-hero-signal-in"
            aria-live="polite"
            style={{
              marginTop: 14,
              fontSize: 14,
              lineHeight: 1.45,
              color: "var(--bp-ink-secondary)",
              fontFamily: "var(--bp-font-body)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span className="cw-live-dot" aria-hidden />
            <span>
              <span style={{ color: "var(--bp-ink-tertiary)" }}>Latest signal · </span>
              {latestSignal}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={refreshing ? "Refreshing overview" : "Refresh overview"}
          aria-busy={refreshing || undefined}
          title={refreshing ? "Refreshing…" : "Refresh"}
          className="cw-refresh-quiet cw-hero-refresh-in"
          style={{ marginLeft: "auto" }}
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Bento tile grid — 4 cols × 2 rows, fills hero width edge-to-edge.
          Primary tile (2×2) swaps between idle ("Load a source") and running
          ("watch the live run") based on anyRunning. When running, the beam
          orbits the primary and a small live badge sits below the hint. */}
      <ul
        className="cw-tile-grid"
        style={{ listStyle: "none", margin: "34px 0 0", padding: 0 }}
      >
        {[anyRunning ? PRIMARY_RUNNING : PRIMARY_IDLE, ...FMD_SECONDARY_JOBS].map((tile, index) => {
          const beam = tile.primary && !!tile.live;
          const linkClass = [
            "cw-tile",
            "cw-hero-tile-in",
            tile.primary ? "cw-tile-primary" : "",
            beam ? "cw-beam" : "",
          ].filter(Boolean).join(" ");
          const iconSize = tile.primary ? 22 : 15;
          const chipSize = tile.primary ? 44 : 28;

          return (
            <li
              key={tile.to + (tile.primary ? (tile.live ? ":live" : ":idle") : "")}
              className={tile.primary ? "cw-tile-primary-cell" : undefined}
              style={{ listStyle: "none" }}
            >
              <Link
                to={tile.to}
                className={linkClass}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  "--i": index,
                } as CSSProperties}
                aria-label={beam ? `${tile.title} (pipeline run in progress)` : undefined}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: chipSize,
                    height: chipSize,
                    borderRadius: tile.primary ? 12 : 10,
                    background: tile.primary ? "var(--bp-copper-soft)" : "var(--bp-surface-inset)",
                    color: tile.primary ? "var(--bp-copper)" : "var(--bp-ink-secondary)",
                    flexShrink: 0,
                  }}
                >
                  <tile.icon size={iconSize} strokeWidth={1.75} />
                </span>

                {/* Title + hint pushed to the bottom of the primary's 2×2 square
                    via margin-top:auto on the title. Secondary tiles remain
                    a compact top-aligned stack. */}
                <span className="cw-tile-title">{tile.title}</span>
                <span className="cw-tile-hint">{tile.hint}</span>

                {tile.primary && tile.live && (
                  <span className="cw-primary-live" aria-hidden>
                    Live
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
