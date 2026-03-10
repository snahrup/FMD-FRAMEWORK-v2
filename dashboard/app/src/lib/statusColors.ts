import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  PauseCircle,
  AlertCircle,
  Ban,
  SkipForward,
  Timer,
  Info,
  type LucideIcon,
} from "lucide-react";

// ── Canonical Status Configuration ──
// Single source of truth for all status → color/icon mappings across the dashboard.
// Import this instead of defining inline status configs per page.

export interface StatusConfig {
  label: string;
  icon: LucideIcon;
  color: string;       // text color class
  bg: string;           // background class
  border: string;       // border class
  pulse?: boolean;      // animate-pulse for active states
}

export const STATUS_MAP: Record<string, StatusConfig> = {
  // ── Success states ──
  success:   { label: "Success",     icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30",  border: "border-emerald-200 dark:border-emerald-800/50" },
  succeeded: { label: "Succeeded",   icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30",  border: "border-emerald-200 dark:border-emerald-800/50" },
  completed: { label: "Completed",   icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30",  border: "border-emerald-200 dark:border-emerald-800/50" },
  loaded:    { label: "Loaded",      icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30",  border: "border-emerald-200 dark:border-emerald-800/50" },
  idle:      { label: "Idle",        icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30",  border: "border-emerald-200 dark:border-emerald-800/50" },

  // ── Failure states ──
  failed:    { label: "Failed",      icon: XCircle,      color: "text-red-600 dark:text-red-400",        bg: "bg-red-50 dark:bg-red-950/30",          border: "border-red-200 dark:border-red-800/50" },
  error:     { label: "Error",       icon: XCircle,      color: "text-red-600 dark:text-red-400",        bg: "bg-red-50 dark:bg-red-950/30",          border: "border-red-200 dark:border-red-800/50" },

  // ── Active states ──
  running:    { label: "Running",     icon: Loader2, color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-950/30",         border: "border-blue-200 dark:border-blue-800/50",  pulse: true },
  inprogress: { label: "In Progress", icon: Loader2, color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-950/30",         border: "border-blue-200 dark:border-blue-800/50",  pulse: true },

  // ── Pending/queued states ──
  pending:    { label: "Pending",    icon: Timer,        color: "text-amber-600 dark:text-amber-400",    bg: "bg-amber-50 dark:bg-amber-950/30",       border: "border-amber-200 dark:border-amber-800/50" },
  notstarted: { label: "Queued",     icon: Timer,        color: "text-amber-600 dark:text-amber-400",    bg: "bg-amber-50 dark:bg-amber-950/30",       border: "border-amber-200 dark:border-amber-800/50" },
  not_started:{ label: "Not Started",icon: Timer,        color: "text-amber-600 dark:text-amber-400",    bg: "bg-amber-50 dark:bg-amber-950/30",       border: "border-amber-200 dark:border-amber-800/50" },

  // ── Warning states ──
  warning:  { label: "Warning",      icon: AlertCircle,  color: "text-amber-600 dark:text-amber-400",    bg: "bg-amber-50 dark:bg-amber-950/30",       border: "border-amber-200 dark:border-amber-800/50" },
  stopping: { label: "Stopping",     icon: AlertCircle,  color: "text-amber-600 dark:text-amber-400",    bg: "bg-amber-50 dark:bg-amber-950/30",       border: "border-amber-200 dark:border-amber-800/50" },
  aborted:  { label: "Aborted",      icon: AlertCircle,  color: "text-amber-600 dark:text-amber-400",    bg: "bg-amber-50 dark:bg-amber-950/30",       border: "border-amber-200 dark:border-amber-800/50" },

  // ── Inactive states ──
  cancelled: { label: "Cancelled",   icon: Ban,          color: "text-slate-500 dark:text-slate-400",    bg: "bg-slate-50 dark:bg-slate-950/30",       border: "border-slate-200 dark:border-slate-800/50" },
  deduped:   { label: "Deduped",     icon: SkipForward,  color: "text-slate-500 dark:text-slate-400",    bg: "bg-slate-50 dark:bg-slate-950/30",       border: "border-slate-200 dark:border-slate-800/50" },
  unknown:   { label: "Unknown",     icon: Info,         color: "text-slate-500 dark:text-slate-400",    bg: "bg-slate-50 dark:bg-slate-950/30",       border: "border-slate-200 dark:border-slate-800/50" },
  none:      { label: "No Runs",     icon: Clock,        color: "text-muted-foreground",                 bg: "bg-muted/30",                            border: "border-border" },
};

const FALLBACK: StatusConfig = STATUS_MAP.unknown;

/** Resolve a status string (any casing) to its canonical config. */
export function resolveStatus(raw: string | null | undefined): StatusConfig {
  if (!raw) return FALLBACK;
  const exact = raw.toLowerCase();
  const normalized = exact.replace(/[\s_-]+/g, "");
  // Try exact match first (preserves underscores), then normalized
  return STATUS_MAP[exact] ?? STATUS_MAP[normalized] ?? FALLBACK;
}

/** Get just the text color class for a status (for inline use). */
export function statusTextColor(raw: string): string {
  return resolveStatus(raw).color;
}

/** Get the CSS variable shorthand used by ExecutionMatrix-style pages. */
export function statusCssVar(raw: string): string {
  const s = raw.toLowerCase();
  if (["success", "succeeded", "completed", "loaded", "idle"].includes(s)) return "var(--cl-success)";
  if (["failed", "error"].includes(s)) return "var(--cl-error)";
  if (["running", "inprogress", "in_progress"].includes(s)) return "var(--cl-warning)";
  if (["pending", "notstarted", "not_started"].includes(s)) return "var(--cl-info)";
  return "var(--text-muted)";
}

// ── Quality score color (for DQ/profiling pages) ──
export function qualityColor(pct: number): string {
  if (pct >= 98) return "#10b981";  // emerald
  if (pct >= 90) return "#22c55e";  // green
  if (pct >= 80) return "#84cc16";  // lime
  if (pct >= 60) return "#f59e0b";  // amber
  if (pct >= 40) return "#f97316";  // orange
  return "#ef4444";                 // red
}

export function qualityLabel(pct: number): string {
  if (pct >= 98) return "Excellent";
  if (pct >= 90) return "Good";
  if (pct >= 80) return "Fair";
  if (pct >= 60) return "Needs Review";
  if (pct >= 40) return "Poor";
  return "Critical";
}
