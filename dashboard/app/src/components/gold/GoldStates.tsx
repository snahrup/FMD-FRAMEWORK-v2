import React from "react";

/* ─── Design tokens (inline styles reference CSS custom properties) ─── */

const WIDTHS = ["60%", "80%", "45%", "70%"] as const;

const shimmerStyle = (width: string): React.CSSProperties => ({
  height: 8,
  borderRadius: 2,
  width,
  background:
    "linear-gradient(90deg, var(--bp-surface-inset) 0%, rgba(0,0,0,0.03) 50%, var(--bp-surface-inset) 100%)",
  backgroundSize: "400% 100%",
  animation: "bp-skeleton-shimmer 1.5s ease-in-out infinite",
});

/* ─────────────────────────── GoldLoading ─────────────────────────── */

interface GoldLoadingProps {
  /** Number of skeleton rows */
  rows?: number;
  /** Optional label shown above skeleton */
  label?: string;
}

export function GoldLoading({ rows = 4, label }: GoldLoadingProps) {
  return (
    <div className="py-8 flex flex-col items-center gap-3" style={{ width: "100%" }}>
      {label && (
        <span
          style={{
            fontFamily: "var(--bp-font-mono)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--bp-ink-muted)",
          }}
        >
          {label}
        </span>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={shimmerStyle(WIDTHS[i % WIDTHS.length])}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────── GoldEmpty ───────────────────────────── */

interface GoldEmptyProps {
  /** e.g. "specimens", "clusters", "canonical entities" */
  noun: string;
  /** Optional action button */
  action?: { label: string; onClick: () => void };
}

export function GoldEmpty({ noun, action }: GoldEmptyProps) {
  return (
    <div className="py-12 flex flex-col items-center gap-2 text-center">
      <span
        style={{
          fontFamily: "var(--bp-font-display)",
          fontSize: 16,
          color: "var(--bp-ink-secondary)",
        }}
      >
        No {noun} yet
      </span>
      <span
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 12,
          color: "var(--bp-ink-muted)",
        }}
      >
        Import data or adjust your filters to see {noun} here.
      </span>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 8,
            fontFamily: "var(--bp-font-body)",
            fontSize: 13,
            padding: "6px 14px",
            border: "1px solid var(--bp-border)",
            borderRadius: 4,
            background: "transparent",
            color: "var(--bp-ink-primary)",
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── GoldError ───────────────────────────── */

interface GoldErrorProps {
  message?: string;
  onRetry?: () => void;
}

export function GoldError({ message, onRetry }: GoldErrorProps) {
  return (
    <div className="py-10 flex flex-col items-center gap-2 text-center">
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          border: "1px solid var(--bp-fault)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--bp-fault)",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        &times;
      </div>
      <span
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 13,
          color: "var(--bp-ink-secondary)",
        }}
      >
        {message || "Something went wrong"}
      </span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            fontFamily: "var(--bp-font-body)",
            fontSize: 12,
            color: "var(--bp-copper)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textDecoration: "none",
            padding: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.textDecoration = "underline";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.textDecoration = "none";
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── GoldNoResults ───────────────────────── */

interface GoldNoResultsProps {
  query?: string;
}

export function GoldNoResults({ query }: GoldNoResultsProps) {
  return (
    <div className="py-10 flex flex-col items-center gap-1.5 text-center">
      <span
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 13,
          color: "var(--bp-ink-secondary)",
        }}
      >
        {query ? `No matches for \u201C${query}\u201D` : "No matches found"}
      </span>
      <span
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 12,
          color: "var(--bp-ink-muted)",
        }}
      >
        Try a different search term or clear your filters.
      </span>
    </div>
  );
}
