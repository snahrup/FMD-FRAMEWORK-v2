// ============================================================================
// Business Overview — The default landing page for Business Portal mode.
//
// Design system: Industrial Precision, Light Mode
// Matches wireframe: .superpowers/brainstorm/130-1773660833/bp-overview.html
// Font: Manrope (all weights). All styles use BP CSS custom properties (--bp-*)
// Data: /api/overview/kpis, /api/overview/sources, /api/overview/activity
// ============================================================================

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Crown,
  Globe,
  Network,
  Radar,
  RefreshCw,
  Play,
} from "lucide-react";
import { useTerminology } from "@/hooks/useTerminology";
import { resolveSourceLabel, getSourceColor } from "@/hooks/useSourceConfig";
import { ProgressRing, StatusRail, toRailStatus, SourceBadge, SeverityBadge, toSeverity } from "@/components/business";
import { LaunchTile } from "@/components/navigation/LaunchTile";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

interface KPIData {
  freshness_pct: number;
  freshness_on_time: number;
  freshness_total: number;
  freshness_ever_loaded: number;
  freshness_last_success: string | null;
  open_alerts: number;
  sources_online: number;
  sources_total: number;
  total_entities: number;
  loaded_entities: number;
  quality_avg: number;
}

interface SourceHealth {
  name: string;
  displayName: string;
  status: "operational" | "degraded" | "offline";
  entityCount: number;
  lastRefreshed: string | null;
}

interface ActivityEvent {
  entityName: string;
  source: string;
  layer: string;
  status: "success" | "error" | "warning" | "running" | "pending";
  lastLoadDate: string | null;
}

// ── Helpers ──

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Skeleton ──

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded ${className ?? ""}`}
      style={{
        background: "linear-gradient(90deg, var(--bp-surface-inset) 25%, var(--bp-surface-2) 50%, var(--bp-surface-inset) 75%)",
        backgroundSize: "200% 100%",
        animation: "bp-skeleton-shimmer 2s ease-in-out infinite",
      }}
    />
  );
}

function KPIRowSkeleton() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bp-card" style={{ padding: 20 }}>
          <Skeleton className="h-3 w-24 mb-3" />
          <Skeleton className="h-10 w-20 mb-2" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──

export default function BusinessOverview() {
  const { t, layer } = useTerminology();

  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchAll() {
    try {
      const [kpiResult, srcResult, actResult] = await Promise.allSettled([
        fetch(`${API}/api/overview/kpis`).then((r) => r.ok ? r.json() : Promise.reject(r.statusText)),
        fetch(`${API}/api/overview/sources`).then((r) => r.ok ? r.json() : Promise.reject(r.statusText)),
        fetch(`${API}/api/overview/activity`).then((r) => r.ok ? r.json() : Promise.reject(r.statusText)),
      ]);

      if (kpiResult.status === "fulfilled") setKpis(kpiResult.value);
      if (srcResult.status === "fulfilled") setSources(srcResult.value);
      if (actResult.status === "fulfilled") setActivity(actResult.value);

      const failures = [kpiResult, srcResult, actResult].filter((r) => r.status === "rejected");
      if (failures.length === 3) {
        setError("All overview endpoints failed");
      } else if (failures.length > 0) {
        setError(null); // partial data is better than no data
      } else {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 30_000);
    return () => clearInterval(timer);
  }, []);

  const alerts = activity
    .filter((a) => a.status === "error" || a.status === "warning")
    .slice(0, 5);

  const recentActivity = activity
    .filter((a) => a.status === "success" || a.status === "running" || a.status === "pending")
    .slice(0, 8);
  const sourceCount = sources.length;
  const totalEntities = sourceCount > 0 ? sources.reduce((sum, source) => sum + source.entityCount, 0) : 0;
  const totalLoaded = kpis?.loaded_entities ?? 0;
  const totalErrors = alerts.length;
  const healthySources = sourceCount > 0 ? sources.filter((source) => source.status === "operational").length : 0;
  const outstandingLoads = Math.max((kpis?.total_entities || 0) - (kpis?.loaded_entities || 0), 0);
  const launchCards = [
    {
      to: "/load-center",
      icon: Play,
      eyebrow: "Finish the pipeline",
      title: "Load Center",
      summary: "Start and finish imports in one place, see missing layers clearly, and stop guessing what still has not landed in the managed path.",
      ctaLabel: "Open Load Center",
      accent: "var(--bp-copper)",
      statLabel: "Outstanding",
      statValue: outstandingLoads.toLocaleString("en-US"),
      features: ["Completion plan", "Gap queue", "Single entry point"],
    },
    {
      to: "/explore",
      icon: Network,
      eyebrow: "Choose the right tool",
      title: "Explore",
      summary: "Start here when the question is which investigative surface to use, then jump into catalog, lineage, profiler, blender, or SQL Explorer with less explanation on each page.",
      ctaLabel: "Open Explore",
      accent: "var(--bp-operational)",
      statLabel: "Usable now",
      statValue: (kpis?.loaded_entities || 0).toLocaleString("en-US"),
      features: ["Tool previews", "Direct launch", "Lower page clutter"],
    },
    {
      to: "/load-mission-control",
      icon: Radar,
      eyebrow: "Watch active work",
      title: "Mission Control",
      summary: "Use the monitoring workspace after execution starts to watch run state, inspect failures, and understand what happened during the load.",
      ctaLabel: "Open Mission Control",
      accent: "var(--bp-silver)",
      statLabel: "Blockers",
      statValue: (kpis?.open_alerts || 0).toLocaleString("en-US"),
      features: ["Run telemetry", "Failure triage", "Execution evidence"],
    },
    {
      to: "/estate",
      icon: Globe,
      eyebrow: "See the whole map",
      title: "Data Estate",
      summary: "Use the estate map when the question is coverage, source posture, or whether a weak zone upstream is making every downstream tool feel inconsistent.",
      ctaLabel: "Open Estate",
      accent: "var(--bp-ink-primary)",
      statLabel: "Healthy sources",
      statValue: `${healthySources.toLocaleString("en-US")}/${sourceCount.toLocaleString("en-US")}`,
      features: ["Source posture", "Layer coverage", "Governance map"],
    },
    {
      to: "/gold/intake",
      icon: Crown,
      eyebrow: "Build the publish path",
      title: "Gold Studio",
      summary: "Open the guided gold workflow when the question is how to take a curated asset from intake through release and serving without losing context.",
      ctaLabel: "Open Gold Studio",
      accent: "var(--bp-copper-hover)",
      statLabel: "Quality avg",
      statValue: kpis ? `${kpis.quality_avg.toFixed(0)}%` : "—",
      features: ["Guided stages", "Context carry-forward", "Release evidence"],
    },
  ];

  return (
    <div style={{ padding: 32, maxWidth: 1280 }}>
      <div
        className="bp-card"
        style={{
          padding: 22,
          marginBottom: 20,
          background: "linear-gradient(135deg, rgba(180,86,36,0.05) 0%, rgba(255,255,255,0.98) 44%, rgba(244,242,237,0.98) 100%)",
        }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div style={{ maxWidth: 860 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--bp-copper)",
              }}
            >
              Front Door
            </div>
            <h1
              className="bp-display"
              style={{
                margin: "10px 0 0",
                fontSize: 34,
                lineHeight: 1.06,
                color: "var(--bp-ink-primary)",
              }}
            >
              Start here, then move into the right workspace
            </h1>
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 14,
                lineHeight: 1.6,
                color: "var(--bp-ink-secondary)",
              }}
            >
              Use Overview to see what needs attention, understand what each major section is for, and jump directly into the next surface without every page carrying a giant instructional billboard.
            </p>
          </div>
          <button
            onClick={fetchAll}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 transition-transform hover:-translate-y-0.5"
            style={{
              border: "1px solid var(--bp-border)",
              background: "rgba(255,255,255,0.82)",
              color: "var(--bp-ink-secondary)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh overview
          </button>
        </div>

        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 18 }}
        >
          {launchCards.map((card) => (
            <LaunchTile key={card.to} {...card} />
          ))}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          style={{
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 13,
            background: "var(--bp-fault-light)",
            color: "var(--bp-fault)",
            border: "1px solid rgba(185, 58, 42, 0.2)",
          }}
        >
          {error}
        </div>
      )}

      {/* ── KPI Row — asymmetric: freshness 1.5x wider ── */}
      {loading ? (
        <KPIRowSkeleton />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
          {/* Freshness — hero value + progress ring */}
          <div className="bp-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "var(--bp-ink-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    marginBottom: 8,
                  }}
                >
                  Data Freshness
                </div>
                {kpis && kpis.freshness_total > 0 ? (
                  <>
                    <div
                      className="bp-mono"
                      style={{
                        fontSize: 42,
                        fontWeight: 500,
                        color: "var(--bp-ink-primary)",
                        lineHeight: 1,
                      }}
                    >
                      {kpis.freshness_pct.toFixed(1)}%
                    </div>
                    {kpis.freshness_on_time > 0 ? (
                      <div style={{ fontSize: 13, color: "var(--bp-ink-tertiary)", marginTop: 6 }}>
                        {kpis.freshness_on_time.toLocaleString()} of {kpis.freshness_total.toLocaleString()} {t("tables")} refreshed in last 24h
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: "var(--bp-ink-tertiary)", marginTop: 6 }}>
                        {kpis.freshness_ever_loaded.toLocaleString()} of {kpis.freshness_total.toLocaleString()} {t("tables")} ever loaded
                        {kpis.freshness_last_success && (
                          <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--bp-ink-muted)" }}>
                            Last success: {relativeTime(kpis.freshness_last_success)}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div
                      className="bp-mono"
                      style={{
                        fontSize: 42,
                        fontWeight: 500,
                        color: "var(--bp-ink-muted)",
                        lineHeight: 1,
                      }}
                    >
                      —
                    </div>
                    <div style={{ fontSize: 13, color: "var(--bp-ink-tertiary)", marginTop: 6 }}>
                      No load data yet
                    </div>
                  </>
                )}
              </div>
              <ProgressRing pct={kpis && kpis.freshness_total > 0 ? kpis.freshness_pct : 0} size={72} strokeWidth={5} />
            </div>
          </div>

          {/* Open Blockers */}
          <div className="bp-card" style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--bp-ink-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: 8,
              }}
            >
              Open Blockers
            </div>
            <div
              className="bp-mono"
              style={{
                fontSize: 42,
                fontWeight: 500,
                lineHeight: 1,
                color: kpis && kpis.open_alerts > 0 ? "var(--bp-fault)" : "var(--bp-ink-primary)",
              }}
            >
              {kpis?.open_alerts ?? "—"}
            </div>
            <div style={{ fontSize: 13, color: "var(--bp-ink-tertiary)", marginTop: 6 }}>
              {kpis?.open_alerts === 0
                ? "All clear"
                : `${kpis?.open_alerts} outstanding in the chain`}
            </div>
          </div>

          {/* Sources Online — split size for "N / M" */}
          <div className="bp-card" style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--bp-ink-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: 8,
              }}
            >
              Sources Online
            </div>
            <div className="bp-mono" style={{ fontSize: 42, fontWeight: 500, lineHeight: 1, color: "var(--bp-ink-primary)" }}>
              {kpis ? (
                <>
                  {kpis.sources_online}
                  <span style={{ fontSize: 24, color: "var(--bp-ink-tertiary)" }}> / {kpis.sources_total}</span>
                </>
              ) : (
                "—"
              )}
            </div>
            <div style={{ fontSize: 13, color: "var(--bp-ink-tertiary)", marginTop: 6 }}>
              {kpis && kpis.sources_online === kpis.sources_total
                ? "All sources connected"
                : kpis
                ? `${kpis.sources_total - kpis.sources_online} offline`
                : "—"}
            </div>
          </div>

          {/* Total Tables */}
          <div className="bp-card" style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--bp-ink-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: 8,
              }}
            >
              {t("Tables")}
            </div>
            <div className="bp-mono" style={{ fontSize: 42, fontWeight: 500, lineHeight: 1, color: "var(--bp-ink-primary)" }}>
              {kpis ? (
                <>
                  {kpis.loaded_entities.toLocaleString()}
                  <span style={{ fontSize: 24, color: "var(--bp-ink-tertiary)" }}> / {kpis.total_entities.toLocaleString()}</span>
                </>
              ) : "—"}
            </div>
            <div style={{ fontSize: 13, color: "var(--bp-ink-tertiary)", marginTop: 6 }}>
              {kpis ? `${kpis.loaded_entities.toLocaleString()} loaded of ${kpis.total_entities.toLocaleString()} registered` : "—"}
            </div>
          </div>
        </div>
      )}

      {/* ── Content: 60/40 split ── */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 24 }}>
        {/* ── Left: Recent Alerts ── */}
        <div className="bp-card">
          <div className="bp-panel-header">
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
              Recent Alerts
            </span>
            <Link to="/alerts" className="bp-link" style={{ fontSize: 13 }}>
              View all alerts →
            </Link>
          </div>

          {loading ? (
            <div>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{ padding: "14px 20px", borderBottom: "1px solid var(--bp-border-subtle)" }}
                >
                  <Skeleton className="h-3 w-40 mb-2" />
                  <Skeleton className="h-4 w-64 mb-1.5" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div
              style={{ padding: "48px 20px", textAlign: "center", fontSize: 14, color: "var(--bp-ink-muted)" }}
            >
              No active alerts — all systems normal
            </div>
          ) : (
            <div>
              {alerts.map((alert, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "14px 20px",
                    borderBottom: i < alerts.length - 1 ? "1px solid var(--bp-border-subtle)" : "none",
                    position: "relative",
                  }}
                >
                  {/* Status rail */}
                  <StatusRail status={toRailStatus(alert.status)} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <SeverityBadge severity={toSeverity(alert.status)} />
                      <SourceBadge source={alert.source} />
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--bp-ink-primary)",
                        lineHeight: 1.3,
                      }}
                    >
                      {alert.entityName}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--bp-ink-muted)", marginTop: 4 }}>
                      {layer(alert.layer)} layer
                      {alert.lastLoadDate ? ` · First seen ${relativeTime(alert.lastLoadDate)}` : ""}
                    </div>
                  </div>

                  <span
                    className="bp-mono"
                    style={{
                      fontSize: 11,
                      color: "var(--bp-ink-muted)",
                      whiteSpace: "nowrap",
                      alignSelf: "flex-start",
                      marginTop: 2,
                    }}
                  >
                    {relativeTime(alert.lastLoadDate)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: Stacked panels ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Source Health */}
          <div className="bp-card">
            <div className="bp-panel-header">
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
                Source Health
              </span>
              <Link to="/sources-portal" className="bp-link" style={{ fontSize: 13 }}>
                All sources →
              </Link>
            </div>

            <div style={{ maxHeight: 220, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "var(--bp-border-strong) transparent" }}>
              {loading ? (
                <div>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 20px",
                        borderBottom: "1px solid var(--bp-border-subtle)",
                      }}
                    >
                      <Skeleton className="h-2.5 w-2.5 rounded-full" />
                      <Skeleton className="h-3 w-24 flex-1" />
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-3 w-8" />
                    </div>
                  ))}
                </div>
              ) : sources.length === 0 ? (
                <div
                  style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: "var(--bp-ink-muted)" }}
                >
                  No sources configured
                </div>
              ) : (
                <div>
                  {sources.map((src, i) => {
                    const srcColor = getSourceColor(src.name);
                    const label = src.displayName || resolveSourceLabel(src.name);
                    const statusColor =
                      src.status === "operational"
                        ? "var(--bp-operational)"
                        : src.status === "degraded"
                        ? "var(--bp-caution)"
                        : "var(--bp-fault)";

                    return (
                      <div
                        key={src.name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 20px",
                          borderBottom: i < sources.length - 1 ? "1px solid var(--bp-border-subtle)" : "none",
                          fontSize: 13,
                        }}
                      >
                        <span className="bp-source-dot" style={{ backgroundColor: srcColor.hex }} />
                        <span style={{ flex: 1, fontWeight: 500, color: "var(--bp-ink-primary)" }}>
                          {label}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: statusColor, textTransform: "capitalize" }}>
                          {src.status}
                        </span>
                        <span
                          className="bp-mono"
                          style={{
                            fontSize: 12,
                            color: "var(--bp-ink-tertiary)",
                            minWidth: 48,
                            textAlign: "right",
                          }}
                        >
                          {src.entityCount.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bp-card">
            <div className="bp-panel-header">
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
                Recent Activity
              </span>
            </div>

            <div style={{ maxHeight: 200, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "var(--bp-border-strong) transparent" }}>
              {loading ? (
                <div>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      style={{ padding: "10px 20px", borderBottom: "1px solid var(--bp-border-subtle)" }}
                    >
                      <Skeleton className="h-3 w-48 mb-1.5" />
                      <Skeleton className="h-2.5 w-16" />
                    </div>
                  ))}
                </div>
              ) : recentActivity.length === 0 ? (
                <div
                  style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: "var(--bp-ink-muted)" }}
                >
                  No recent activity
                </div>
              ) : (
                <div>
                  {recentActivity.map((evt, i) => {
                    const srcLabel = resolveSourceLabel(evt.source);
                    const statusLabel =
                      evt.status === "success"
                        ? "refreshed"
                        : evt.status === "running"
                        ? "loading"
                        : "pending";
                    const statusColor =
                      evt.status === "running"
                        ? "var(--bp-caution)"
                        : evt.status === "pending"
                        ? "var(--bp-ink-muted)"
                        : undefined;
                    return (
                      <div
                        key={i}
                        style={{
                          padding: "10px 20px",
                          borderBottom: i < recentActivity.length - 1 ? "1px solid var(--bp-border-subtle)" : "none",
                          fontSize: 13,
                          color: "var(--bp-ink-secondary)",
                          lineHeight: 1.4,
                          opacity: evt.status === "pending" ? 0.65 : 1,
                        }}
                      >
                        <span style={{ fontWeight: 500, color: statusColor ?? "var(--bp-ink-primary)" }}>
                          {evt.entityName}
                        </span>
                        {" "}{statusLabel} from {srcLabel} · {layer(evt.layer)}
                        <br />
                        <span
                          className="bp-mono"
                          style={{ fontSize: 11, color: "var(--bp-ink-muted)" }}
                        >
                          {evt.status === "running"
                            ? "In progress"
                            : evt.status === "pending"
                            ? "Not started"
                            : relativeTime(evt.lastLoadDate)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
