/**
 * LayerStatusDot — Small colored indicator for entity pipeline status.
 *
 * Replaces ad-hoc status badges across Data pages with a consistent,
 * compact visual indicator.
 */

export interface LayerStatusDotProps {
  status: "loaded" | "pending" | "error" | "not_started" | "partial" | "in_progress";
  size?: "sm" | "md";
  pulse?: boolean;
  /** Optional label shown to the right of the dot */
  label?: string;
  className?: string;
}

const STATUS_COLORS: Record<LayerStatusDotProps["status"], string> = {
  loaded: "var(--bp-operational)",
  pending: "var(--bp-caution)",
  error: "var(--bp-fault)",
  not_started: "var(--bp-ink-muted)",
  partial: "var(--bp-caution)",
  in_progress: "var(--bp-lz)",
};

const STATUS_LABELS: Record<LayerStatusDotProps["status"], string> = {
  loaded: "Loaded",
  pending: "Pending",
  error: "Error",
  not_started: "Not started",
  partial: "Partial",
  in_progress: "In progress",
};

/**
 * Normalize raw status strings from the digest engine into canonical values.
 * The backend may return "Succeeded", "complete", "Failed", "InProgress", etc.
 */
export function normalizeStatus(raw: string | null | undefined): LayerStatusDotProps["status"] {
  if (!raw) return "not_started";
  const s = raw.toLowerCase().trim();
  if (s === "loaded" || s === "succeeded" || s === "complete" || s === "success") return "loaded";
  if (s === "pending" || s === "queued") return "pending";
  if (s === "error" || s === "failed" || s === "failure") return "error";
  if (s === "partial") return "partial";
  if (s === "inprogress" || s === "in_progress" || s === "running") return "in_progress";
  return "not_started";
}

const SIZE_PX = { sm: 6, md: 8 } as const;

export default function LayerStatusDot({
  status,
  size = "sm",
  pulse = false,
  label,
  className = "",
}: LayerStatusDotProps) {
  const px = SIZE_PX[size];
  const color = STATUS_COLORS[status];
  const shouldPulse = pulse || status === "in_progress";

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
      title={label || STATUS_LABELS[status]}
    >
      <span
        style={{
          width: px,
          height: px,
          borderRadius: "50%",
          backgroundColor: color,
          flexShrink: 0,
          animation: shouldPulse ? "bp-fault-pulse 2s ease-in-out infinite" : undefined,
        }}
      />
      {label && (
        <span
          style={{
            fontSize: size === "sm" ? 10 : 11,
            fontFamily: "var(--bp-font-body)",
            color: "var(--bp-ink-secondary)",
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
