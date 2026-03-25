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
// Uses BP design system CSS classes (bp-badge-*) instead of Tailwind color classes.

export interface StatusConfig {
  label: string;
  icon: LucideIcon;
  badgeClass: string;   // BP badge variant class
  pulse?: boolean;      // animate-pulse for active states
  // Legacy — kept for pages that use inline text color
  color: string;
  bg: string;
  border: string;
}

// Shared config builders to keep the map DRY
const success = (label: string, icon: LucideIcon): StatusConfig => ({
  label, icon,
  badgeClass: "bp-badge-operational",
  color: "text-emerald-800 dark:text-emerald-300",
  bg: "bg-emerald-100 dark:bg-emerald-950/40",
  border: "border-emerald-300 dark:border-emerald-700/60",
});

const failure = (label: string, icon: LucideIcon): StatusConfig => ({
  label, icon,
  badgeClass: "bp-badge-critical",
  color: "text-red-800 dark:text-red-300",
  bg: "bg-red-100 dark:bg-red-950/40",
  border: "border-red-300 dark:border-red-700/60",
});

const active = (label: string, icon: LucideIcon): StatusConfig => ({
  label, icon,
  badgeClass: "bp-badge-active",
  pulse: true,
  color: "text-blue-800 dark:text-blue-300",
  bg: "bg-blue-100 dark:bg-blue-950/40",
  border: "border-blue-300 dark:border-blue-700/60",
});

const warning = (label: string, icon: LucideIcon): StatusConfig => ({
  label, icon,
  badgeClass: "bp-badge-warning",
  color: "text-amber-800 dark:text-amber-300",
  bg: "bg-amber-100 dark:bg-amber-950/40",
  border: "border-amber-300 dark:border-amber-700/60",
});

const inactive = (label: string, icon: LucideIcon): StatusConfig => ({
  label, icon,
  badgeClass: "bp-badge-info",
  color: "text-slate-600 dark:text-slate-300",
  bg: "bg-slate-100 dark:bg-slate-950/40",
  border: "border-slate-300 dark:border-slate-700/60",
});

export const STATUS_MAP: Record<string, StatusConfig> = {
  // ── Success states ──
  success:   success("Success", CheckCircle2),
  succeeded: success("Succeeded", CheckCircle2),
  completed: success("Completed", CheckCircle2),
  loaded:    success("Loaded", CheckCircle2),
  idle:      success("Idle", CheckCircle2),

  // ── Failure states ──
  failed:    failure("Failed", XCircle),
  error:     failure("Error", XCircle),

  // ── Active states ──
  running:    active("Running", Loader2),
  inprogress: active("In Progress", Loader2),

  // ── Pending/queued states ──
  pending:     warning("Pending", Timer),
  notstarted:  warning("Queued", Timer),
  not_started: warning("Not Started", Timer),

  // ── Warning states ──
  warning:  warning("Warning", AlertCircle),
  stopping: warning("Stopping", AlertCircle),
  aborted:  warning("Aborted", AlertCircle),

  // ── Inactive states ──
  cancelled: inactive("Cancelled", Ban),
  deduped:   inactive("Deduped", SkipForward),
  unknown:   inactive("Unknown", Info),
  none:      { label: "No Runs", icon: Clock, badgeClass: "bp-badge-info", color: "text-muted-foreground", bg: "bg-muted/30", border: "border-border" },
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
