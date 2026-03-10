// ── Canonical Formatting Helpers ──
// Consolidated from 8+ pages that re-implemented these.

/** Format an ISO timestamp to a human-readable relative or absolute string. */
export function formatTimestamp(iso: string | null | undefined, opts?: { relative?: boolean }): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";

  if (opts?.relative) {
    return formatRelativeTime(d);
  }
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Format a Date to relative time (e.g., "3m ago", "2h ago", "yesterday"). */
export function formatRelativeTime(d: Date): string {
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Format a duration in seconds to human-readable (e.g., "1h 23m", "45s", "2m 10s"). */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "—";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;

  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/** Format a duration in milliseconds. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return formatDuration(ms / 1000);
}

/** Format a row count with locale separators (e.g., 1,234,567). */
export function formatRowCount(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

/** Format a row count with compact notation (e.g., 1.2M, 45.3K). */
export function formatRowCountCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1_000) return n.toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/** Format a percentage (e.g., 98.5%). */
export function formatPercent(n: number | null | undefined, decimals = 1): string {
  if (n == null) return "—";
  return `${n.toFixed(decimals)}%`;
}

/** Format bytes to human-readable (e.g., 1.2 GB, 450 MB). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
