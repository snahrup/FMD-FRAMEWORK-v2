import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, AlertTriangle, ShieldAlert, CheckCircle2, Filter } from "lucide-react";
import {
  BusinessIntentHeader,
  StatusRail,
  KpiCard,
  SeverityBadge,
  SourceBadge,
  type Severity,
  type RailStatus,
} from "@/components/business";
import { useTerminology } from "@/hooks/useTerminology";
import { cn } from "@/lib/utils";

const API = import.meta.env.VITE_API_URL || "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Alert {
  id: string;
  type: "freshness" | "pending" | "connection";
  severity: Severity;
  source: string;
  sourceDisplay: string;
  title: string;
  detail: string;
  tablesAffected: number;
  firstSeen: string | null;
  entities: string[];
}

type AlertType = "freshness" | "pending" | "connection";

const TYPE_LABELS: Record<AlertType, string> = {
  freshness: "Freshness SLA",
  pending: "Never Loaded",
  connection: "Source Offline",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "\u2014";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function severityToRail(sev: Severity): RailStatus {
  if (sev === "critical") return "fault";
  if (sev === "warning") return "caution";
  return "operational";
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function KpiSkeleton() {
  return (
    <div className="bp-card p-5">
      <div
        className="h-3 w-24 rounded mb-3"
        style={{ background: "var(--bp-surface-inset)" }}
      />
      <div
        className="h-10 w-16 rounded mb-2"
        style={{
          background: "linear-gradient(90deg, var(--bp-surface-inset) 25%, var(--bp-surface-2) 50%, var(--bp-surface-inset) 75%)",
          backgroundSize: "200% 100%",
          animation: "bp-skeleton-shimmer 2s ease-in-out infinite",
        }}
      />
      <div
        className="h-3 w-32 rounded"
        style={{ background: "var(--bp-surface-inset)" }}
      />
    </div>
  );
}

function AlertCardSkeleton() {
  return (
    <div className="bp-card p-0 flex overflow-hidden">
      <div style={{ width: 3, background: "var(--bp-surface-inset)" }} />
      <div className="flex-1 p-4">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="h-5 w-14 rounded"
            style={{
              background: "linear-gradient(90deg, var(--bp-surface-inset) 25%, var(--bp-surface-2) 50%, var(--bp-surface-inset) 75%)",
              backgroundSize: "200% 100%",
              animation: "bp-skeleton-shimmer 2s ease-in-out infinite",
            }}
          />
          <div
            className="h-5 w-20 rounded"
            style={{ background: "var(--bp-surface-inset)" }}
          />
        </div>
        <div
          className="h-4 w-64 rounded mb-2"
          style={{ background: "var(--bp-surface-inset)" }}
        />
        <div
          className="h-3 w-full rounded mb-3"
          style={{ background: "var(--bp-surface-inset)" }}
        />
        <div className="flex items-center gap-3">
          <div
            className="h-3 w-28 rounded"
            style={{ background: "var(--bp-surface-inset)" }}
          />
          <div
            className="h-3 w-16 rounded"
            style={{ background: "var(--bp-surface-inset)" }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter chip
// ---------------------------------------------------------------------------

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-[12px] font-medium transition-colors border",
        "cursor-pointer"
      )}
      style={{
        fontFamily: "var(--bp-font-body)",
        background: active ? "var(--bp-copper-light)" : "var(--bp-surface-1)",
        color: active ? "var(--bp-copper)" : "var(--bp-ink-secondary)",
        borderColor: active ? "var(--bp-copper)" : "var(--bp-border)",
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Alert card
// ---------------------------------------------------------------------------

function AlertCard({ alert }: { alert: Alert }) {
  const { t } = useTerminology();
  return (
    <div className="bp-card p-0 flex overflow-hidden">
      <StatusRail status={severityToRail(alert.severity)} />
      <div className="flex-1 p-4 min-w-0">
        {/* top row: badges + type */}
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <SeverityBadge severity={alert.severity} />
          <SourceBadge source={alert.source} />
          <span
            className="text-[11px] font-medium uppercase tracking-wider"
            style={{
              color: "var(--bp-ink-tertiary)",
              fontFamily: "var(--bp-font-body)",
            }}
          >
            {TYPE_LABELS[alert.type]}
          </span>
        </div>

        {/* title */}
        <div
          className="text-[14px] font-medium mb-1"
          style={{
            color: "var(--bp-ink-primary)",
            fontFamily: "var(--bp-font-body)",
          }}
        >
          {alert.title}
        </div>

        {/* detail */}
        <div
          className="text-[13px] mb-3 leading-relaxed"
          style={{
            color: "var(--bp-ink-tertiary)",
            fontFamily: "var(--bp-font-body)",
          }}
        >
          {alert.detail}
        </div>

        {/* entity chips */}
        {alert.entities.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {alert.entities.map((name) => (
              <span
                key={name}
                className="bp-badge text-[11px]"
                style={{
                  background: "var(--bp-surface-inset)",
                  color: "var(--bp-ink-secondary)",
                  fontFamily: "var(--bp-font-mono)",
                }}
              >
                {name}
              </span>
            ))}
            {alert.tablesAffected > alert.entities.length && (
              <span
                className="text-[11px]"
                style={{
                  color: "var(--bp-ink-muted)",
                  fontFamily: "var(--bp-font-mono)",
                }}
              >
                +{alert.tablesAffected - alert.entities.length} more
              </span>
            )}
          </div>
        )}

        {/* bottom row: count + timestamp */}
        <div className="flex items-center gap-4">
          <span
            className="bp-mono text-[12px]"
            style={{ color: "var(--bp-ink-secondary)" }}
          >
            {alert.tablesAffected} {alert.tablesAffected === 1 ? t("entity") : t("entities")} affected
          </span>
          <span
            className="bp-mono text-[12px]"
            style={{ color: "var(--bp-ink-muted)" }}
          >
            {relativeTime(alert.firstSeen)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BusinessAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [typeFilter, setTypeFilter] = useState<AlertType | "all">("all");

  const { t } = useTerminology();

  const fetchAlerts = useCallback(async (isAutoRefresh = false) => {
    if (!isAutoRefresh) setRefreshing(true);
    try {
      const res = await fetch(`${API}/api/alerts`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Alert[] = await res.json();
      setAlerts(data);
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch alerts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load + auto-refresh every 30s
  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(() => fetchAlerts(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Derived data
  const sources = useMemo(
    () => [...new Set(alerts.map((a) => a.source))].sort(),
    [alerts]
  );

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (sourceFilter !== "all" && a.source !== sourceFilter) return false;
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      return true;
    });
  }, [alerts, sourceFilter, severityFilter, typeFilter]);

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const allClear = alerts.length === 0 && !loading;

  // ----- Render ----------------------------------------------------------

  if (loading) {
    return (
      <div
        className="p-6 lg:p-8 min-h-screen"
        style={{ background: "var(--bp-canvas)" }}
      >
        {/* Header skeleton */}
        <div className="mb-8">
          <div
            className="h-8 w-32 rounded mb-2"
            style={{ background: "var(--bp-surface-inset)" }}
          />
          <div
            className="h-4 w-48 rounded"
            style={{ background: "var(--bp-surface-inset)" }}
          />
        </div>
        {/* KPI skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
        </div>
        {/* Card skeletons */}
        <div className="flex flex-col gap-3">
          <AlertCardSkeleton />
          <AlertCardSkeleton />
          <AlertCardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div
      className="p-6 lg:p-8 min-h-screen"
      style={{ background: "var(--bp-canvas)" }}
    >
      <BusinessIntentHeader
        title="Alerts"
        meta={lastRefreshed ? `Last refreshed ${relativeTime(lastRefreshed.toISOString())}` : "Loading…"}
        summary="This page translates freshness breaches, pending source onboarding, and connector outages into a business-readable attention list. It is the place to understand what looks risky before users trust downstream data."
        items={[
          {
            label: "What This Page Is",
            value: "Attention queue for trust issues",
            detail: "Use this page to review the issues most likely to break confidence in reports, requests, or day-to-day business use.",
          },
          {
            label: "Why It Matters",
            value: "Alert truth before escalation",
            detail: "A business user should be able to see what is wrong, how severe it is, and whether the issue is source, freshness, or onboarding related without reading technical logs.",
          },
          {
            label: "What Happens Next",
            value: "Route into the right fix path",
            detail: "Open source coverage when a system is offline, move into the data estate when the wider platform looks unhealthy, or submit a request when the gap is missing access rather than broken data.",
          },
        ]}
        links={[
          { label: "Open Overview", to: "/overview" },
          { label: "Browse Sources", to: "/sources-portal" },
          { label: "Submit a Request", to: "/requests" },
        ]}
        actions={
          <button
            onClick={() => fetchAlerts()}
            disabled={refreshing}
            className="bp-btn-secondary inline-flex items-center gap-2 text-[13px]"
            style={{ fontFamily: "var(--bp-font-body)" }}
          >
            <RefreshCw
              size={14}
              className={refreshing ? "animate-spin" : ""}
            />
            Refresh
          </button>
        }
      />

      {/* ---- Error banner ---- */}
      {error && (
        <div
          className="bp-card-railed mb-6 p-4 flex items-center gap-3"
          style={{ borderLeftColor: "var(--bp-fault)" }}
        >
          <AlertTriangle
            size={16}
            style={{ color: "var(--bp-fault)", flexShrink: 0 }}
          />
          <span
            className="text-[13px]"
            style={{
              color: "var(--bp-ink-secondary)",
              fontFamily: "var(--bp-font-body)",
            }}
          >
            Failed to load alerts: {error}
          </span>
        </div>
      )}

      {/* ---- KPI Row ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <KpiCard
          label="Critical Alerts"
          value={criticalCount}
          alert={criticalCount > 0}
          subtitle={
            criticalCount > 0 ? "Require immediate attention" : "None active"
          }
          adornment={
            <ShieldAlert
              size={28}
              style={{
                color:
                  criticalCount > 0
                    ? "var(--bp-fault)"
                    : "var(--bp-ink-muted)",
              }}
            />
          }
        />
        <KpiCard
          label="Warning Alerts"
          value={warningCount}
          alert={warningCount > 0}
          subtitle={
            warningCount > 0 ? "Approaching threshold" : "None active"
          }
          adornment={
            <AlertTriangle
              size={28}
              style={{
                color:
                  warningCount > 0
                    ? "var(--bp-caution)"
                    : "var(--bp-ink-muted)",
              }}
            />
          }
        />
        <KpiCard
          label="System Status"
          value={allClear ? "All Clear" : `${alerts.length} Active`}
          subtitle={
            allClear
              ? "All systems operating normally"
              : `Across ${sources.length} source${sources.length !== 1 ? "s" : ""}`
          }
          adornment={
            <CheckCircle2
              size={28}
              style={{
                color: allClear
                  ? "var(--bp-operational)"
                  : "var(--bp-ink-muted)",
              }}
            />
          }
        />
      </div>

      {/* ---- Filter bar ---- */}
      {alerts.length > 0 && (
        <div
          className="flex items-center gap-4 mb-6 flex-wrap"
          style={{ fontFamily: "var(--bp-font-body)" }}
        >
          <div className="flex items-center gap-1.5">
            <Filter
              size={14}
              style={{ color: "var(--bp-ink-tertiary)" }}
            />
            <span
              className="text-[12px] font-medium uppercase tracking-wider"
              style={{ color: "var(--bp-ink-tertiary)" }}
            >
              Filters
            </span>
          </div>

          {/* Source dropdown */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded border px-2.5 py-1 text-[13px]"
            style={{
              fontFamily: "var(--bp-font-body)",
              background: "var(--bp-surface-1)",
              color: "var(--bp-ink-primary)",
              borderColor: "var(--bp-border)",
            }}
          >
            <option value="all">All Sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Severity chips */}
          <div className="flex items-center gap-1.5">
            <FilterChip
              label="All"
              active={severityFilter === "all"}
              onClick={() => setSeverityFilter("all")}
            />
            <FilterChip
              label="Critical"
              active={severityFilter === "critical"}
              onClick={() =>
                setSeverityFilter(
                  severityFilter === "critical" ? "all" : "critical"
                )
              }
            />
            <FilterChip
              label="Warning"
              active={severityFilter === "warning"}
              onClick={() =>
                setSeverityFilter(
                  severityFilter === "warning" ? "all" : "warning"
                )
              }
            />
          </div>

          {/* Type chips */}
          <div className="flex items-center gap-1.5">
            <FilterChip
              label="Freshness"
              active={typeFilter === "freshness"}
              onClick={() =>
                setTypeFilter(typeFilter === "freshness" ? "all" : "freshness")
              }
            />
            <FilterChip
              label="Never Loaded"
              active={typeFilter === "pending"}
              onClick={() =>
                setTypeFilter(typeFilter === "pending" ? "all" : "pending")
              }
            />
            <FilterChip
              label="Offline"
              active={typeFilter === "connection"}
              onClick={() =>
                setTypeFilter(
                  typeFilter === "connection" ? "all" : "connection"
                )
              }
            />
          </div>
        </div>
      )}

      {/* ---- Alert list ---- */}
      {allClear && (
        <div
          className="bp-card p-8 text-center"
          style={{ borderLeft: "3px solid var(--bp-operational)" }}
        >
          <CheckCircle2
            size={36}
            className="mx-auto mb-3"
            style={{ color: "var(--bp-operational)" }}
          />
          <div
            className="text-[16px] font-medium mb-1"
            style={{
              color: "var(--bp-ink-primary)",
              fontFamily: "var(--bp-font-body)",
            }}
          >
            No active alerts
          </div>
          <div
            className="text-[13px]"
            style={{
              color: "var(--bp-ink-tertiary)",
              fontFamily: "var(--bp-font-body)",
            }}
          >
            All systems normal — all {t("entities")} are refreshing within SLA thresholds.
          </div>
        </div>
      )}

      {!allClear && filtered.length === 0 && (
        <div
          className="bp-card p-6 text-center"
        >
          <div
            className="text-[14px]"
            style={{
              color: "var(--bp-ink-tertiary)",
              fontFamily: "var(--bp-font-body)",
            }}
          >
            No alerts match the current filters.
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((alert) => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
      </div>

      {/* ---- Footer count ---- */}
      {filtered.length > 0 && (
        <div
          className="mt-4 text-[12px] text-right"
          style={{
            color: "var(--bp-ink-muted)",
            fontFamily: "var(--bp-font-mono)",
          }}
        >
          Showing {filtered.length} of {alerts.length} alert
          {alerts.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
