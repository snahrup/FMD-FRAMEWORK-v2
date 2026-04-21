// ============================================================================
// Business Overview — Shared landing page for Business and Engineering personas.
//
// Design system: Industrial Precision, Light Mode
// Data: /api/metric-contract, /api/overview/sources, /api/overview/activity
// ============================================================================

import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  Crown,
  Network,
  Radar,
  Play,
} from "lucide-react";
import { useMetricContract } from "@/hooks/useMetricContract";
import { useTerminology } from "@/hooks/useTerminology";
import { resolveSourceLabel, getSourceColor } from "@/hooks/useSourceConfig";
import {
  StatusRail,
  toRailStatus,
  SourceBadge,
  SeverityBadge,
  toSeverity,
} from "@/components/business";
import OverviewEstateCard from "@/components/overview/OverviewEstateCard";
import OverviewWorkbenchCard from "@/components/overview/OverviewWorkbenchCard";
import CoworkHero from "@/components/overview/CoworkHero";

const API = import.meta.env.VITE_API_URL || "";

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

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded ${className ?? ""}`}
      style={{
        background:
          "linear-gradient(90deg, var(--bp-surface-inset) 25%, var(--bp-surface-2) 50%, var(--bp-surface-inset) 75%)",
        backgroundSize: "200% 100%",
        animation: "bp-skeleton-shimmer 2s ease-in-out infinite",
      }}
    />
  );
}

function OverviewMetricCard({
  label,
  value,
  denominator,
  detail,
  tone,
  index,
}: {
  label: string;
  value: number;
  denominator: number;
  detail: string;
  tone: string;
  index: number;
}) {
  const progress = denominator > 0 ? Math.max(0, Math.min(1, value / denominator)) : 0;

  return (
    <div
      className="bp-card gs-stagger-card"
      style={{
        "--i": index,
        padding: 16,
        minHeight: 132,
        background: `linear-gradient(180deg, color-mix(in srgb, ${tone} 4%, var(--bp-surface-1)) 0%, var(--bp-surface-1) 100%)`,
      } as CSSProperties}
    >
      <div className="bp-rail" style={{ background: tone, top: 12, bottom: 12 }} />
      <div style={{ paddingLeft: 6 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--bp-ink-secondary)",
            marginBottom: 8,
          }}
        >
          {label}
        </div>
        <div
          className="bp-mono"
          style={{
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1,
            color: "var(--bp-ink-primary)",
          }}
        >
          {value.toLocaleString("en-US")}
          <span
            style={{
              marginLeft: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--bp-ink-tertiary)",
            }}
          >
            / {denominator.toLocaleString("en-US")}
          </span>
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            lineHeight: 1.35,
            color: "var(--bp-ink-muted)",
          }}
        >
          {detail}
        </div>
        <div
          style={{
            marginTop: 14,
            height: 6,
            width: "100%",
            borderRadius: 999,
            background: "rgba(120,113,108,0.12)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              borderRadius: 999,
              background: tone,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function MetricSkeletonCard({ index }: { index: number }) {
  return (
    <div
      className="bp-card"
      style={{
        "--i": index,
        padding: 16,
        minHeight: 132,
      } as CSSProperties}
    >
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-7 w-28 mb-2" />
      <Skeleton className="h-3 w-32 mb-4" />
      <Skeleton className="h-1.5 w-full" />
    </div>
  );
}

export default function BusinessOverview() {
  const { t, layer } = useTerminology();
  const {
    data: metrics,
    loading: contractLoading,
    error: contractError,
    refresh: refreshMetrics,
  } = useMetricContract();

  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchAll() {
    try {
      const [srcResult, actResult] = await Promise.allSettled([
        fetch(`${API}/api/overview/sources`).then((r) =>
          r.ok ? r.json() : Promise.reject(r.statusText)
        ),
        fetch(`${API}/api/overview/activity`).then((r) =>
          r.ok ? r.json() : Promise.reject(r.statusText)
        ),
      ]);

      if (srcResult.status === "fulfilled") setSources(srcResult.value);
      if (actResult.status === "fulfilled") setActivity(actResult.value);

      const failures = [srcResult, actResult].filter(
        (result) => result.status === "rejected"
      );
      if (failures.length === 2) {
        setError("Overview activity and source health failed");
      } else {
        setError(null);
      }
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load overview data"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchAll();
    const timer = setInterval(() => {
      void fetchAll();
      void refreshMetrics();
    }, 30_000);
    return () => clearInterval(timer);
  }, [refreshMetrics]);

  const alerts = activity
    .filter((a) => a.status === "error" || a.status === "warning")
    .slice(0, 5);

  const recentActivity = activity
    .filter(
      (a) =>
        a.status === "success" ||
        a.status === "running" ||
        a.status === "pending"
    )
    .slice(0, 8);

  const sourceCount = metrics?.sources.total ?? sources.length;
  const healthySources =
    metrics?.sources.operational ??
    (sourceCount > 0
      ? sources.filter((source) => source.status === "operational").length
      : 0);
  const tablesInScope = metrics?.tables.inScope.value ?? 0;
  const landingLoaded = metrics?.tables.landingLoaded.value ?? 0;
  const bronzeLoaded = metrics?.tables.bronzeLoaded.value ?? 0;
  const silverLoaded = metrics?.tables.silverLoaded.value ?? 0;
  const toolReady = metrics?.tables.toolReady.value ?? 0;
  const blockedTables = metrics?.tables.blocked.value ?? 0;
  const pageLoading = loading || contractLoading;
  const pageError = contractError || error;
  const contractReady = Boolean(metrics);
  const latestActivity = recentActivity[0] ?? null;

  const latestSignal = latestActivity
    ? `${latestActivity.entityName} ${
        latestActivity.status === "running"
          ? "loading"
          : latestActivity.status === "pending"
            ? "waiting"
            : "refreshed"
      } · ${resolveSourceLabel(latestActivity.source)} · ${layer(latestActivity.layer)}`
    : metrics?.lastSuccess.silver
      ? `Silver last moved ${relativeTime(metrics.lastSuccess.silver)}`
      : "Waiting for fresh activity";

  const overviewCards = [
    {
      to: "/load-center",
      icon: Play,
      eyebrow: "Finish the pipeline",
      title: "Load Center",
      summary:
        "Start and finish imports in one place, see missing layers clearly, and stop guessing what still has not landed in the managed path.",
      ctaLabel: "Open Load Center",
      accent: "var(--bp-copper)",
      statLabel: "Landing Loaded",
      statValue: contractReady ? landingLoaded.toLocaleString("en-US") : "—",
      statDetail: contractReady
        ? `${tablesInScope.toLocaleString("en-US")} in scope`
        : undefined,
    },
    {
      to: "/load-mission-control",
      icon: Radar,
      eyebrow: "Watch active work",
      title: "Mission Control",
      summary:
        "Use the monitoring workspace after execution starts to inspect failures, execution state, and what changed during the load.",
      ctaLabel: "Open Mission Control",
      accent: "var(--bp-silver)",
      statLabel: "Silver Loaded",
      statValue: contractReady ? silverLoaded.toLocaleString("en-US") : "—",
      statDetail: contractReady
        ? `${tablesInScope.toLocaleString("en-US")} in scope`
        : undefined,
    },
    {
      to: "/explore",
      icon: Network,
      eyebrow: "Choose the right tool",
      title: "Explore",
      summary:
        "Start here when the question is which investigative surface to use before moving into catalog, lineage, profiler, blender, or SQL Explorer.",
      ctaLabel: "Open Explore",
      accent: "var(--bp-operational)",
      statLabel: "Tool-Ready",
      statValue: contractReady ? toolReady.toLocaleString("en-US") : "—",
      statDetail: contractReady
        ? `${tablesInScope.toLocaleString("en-US")} in scope`
        : undefined,
    },
    {
      to: "/gold/intake",
      icon: Crown,
      eyebrow: "Build the publish path",
      title: "Gold Studio",
      summary:
        "Open the guided gold workflow when the question is how to take a curated asset from intake through release and serving without losing context.",
      ctaLabel: "Open Gold Studio",
      accent: "var(--bp-gold)",
      statLabel: "Quality Avg",
      statValue: metrics
        ? `${metrics.quality.averageScore.toFixed(0)}%`
        : "—",
      statDetail: blockedTables > 0 ? `${blockedTables.toLocaleString("en-US")} blocked` : "Release posture",
    },
  ];

  const sourcesDegraded = sources.filter((s) => s.status !== "operational").length;
  const pipelinesHealthy = sourcesDegraded === 0 && blockedTables === 0;
  // Drives the informational border-beam on "Watch a run" — only on while a
  // pipeline is actually executing, never as decoration.
  const anyRunning = activity.some((a) => a.status === "running");

  return (
    <div className="bp-page-shell-wide space-y-6">
      <CoworkHero
        latestSignal={latestSignal}
        pipelinesHealthy={pipelinesHealthy}
        blockedTables={blockedTables}
        sourcesDegraded={sourcesDegraded}
        loading={pageLoading && !contractReady}
        anyRunning={anyRunning}
        onRefresh={() => {
          void refreshMetrics();
          void fetchAll();
        }}
        refreshing={pageLoading}
      />

      {/* Layer-fill metrics — Landing/Bronze/Silver/Tool-Ready */}
      <div
        className="bp-card gs-page-enter"
        style={{ padding: 18 }}
      >
        <div className="bp-rail bp-rail-caution" style={{ top: 14, bottom: 14 }} />
        <div style={{ paddingLeft: 6 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--bp-ink-tertiary)",
              marginBottom: 14,
            }}
          >
            Estate Fill — Landing → Tool-Ready
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {pageLoading && !metrics ? (
              [0, 1, 2, 3].map((index) => <MetricSkeletonCard key={index} index={index} />)
            ) : (
              <>
                <OverviewMetricCard
                  label="Landing Loaded"
                  value={landingLoaded}
                  denominator={tablesInScope}
                  detail="Tables confirmed in Landing"
                  tone="var(--bp-copper)"
                  index={0}
                />
                <OverviewMetricCard
                  label="Bronze Loaded"
                  value={bronzeLoaded}
                  denominator={tablesInScope}
                  detail="Tables materialized in Bronze"
                  tone="var(--bp-bronze)"
                  index={1}
                />
                <OverviewMetricCard
                  label="Silver Loaded"
                  value={silverLoaded}
                  denominator={tablesInScope}
                  detail="Tables available in Silver"
                  tone="var(--bp-silver)"
                  index={2}
                />
                <OverviewMetricCard
                  label="Tool-Ready"
                  value={toolReady}
                  denominator={tablesInScope}
                  detail={
                    blockedTables > 0
                      ? `${blockedTables.toLocaleString("en-US")} still blocked before tool mode`
                      : `${t("Tables")} are clear for downstream investigation`
                  }
                  tone="var(--bp-operational)"
                  index={3}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {pageError ? (
        <div
          style={{
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
          {pageError}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(252px,0.9fr)_minmax(0,1.55fr)_minmax(252px,0.9fr)]">
        <div className="order-2 grid grid-cols-2 gap-4 xl:order-1 xl:grid-cols-1">
          {overviewCards.slice(0, 2).map((card, index) => (
            <OverviewWorkbenchCard key={card.to} {...card} />
          ))}
        </div>

        <div className="order-1 xl:order-2 xl:row-span-2">
          <OverviewEstateCard
            tablesInScope={tablesInScope}
            landingLoaded={landingLoaded}
            bronzeLoaded={bronzeLoaded}
            silverLoaded={silverLoaded}
            toolReady={toolReady}
            blockedTables={blockedTables}
            healthySources={healthySources}
            sourceCount={sourceCount}
          />
        </div>

        <div className="order-3 grid grid-cols-2 gap-4 xl:grid-cols-1">
          {overviewCards.slice(2).map((card) => (
            <OverviewWorkbenchCard key={card.to} {...card} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bp-card" style={{ minHeight: 240 }}>
          <div className="bp-panel-header">
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--bp-ink-primary)",
              }}
            >
              Recent Alerts
            </span>
            <Link to="/errors" className="bp-link" style={{ fontSize: 13 }}>
              View all alerts →
            </Link>
          </div>

          {loading ? (
            <div>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    padding: "14px 18px",
                    borderBottom: "1px solid var(--bp-border-subtle)",
                  }}
                >
                  <Skeleton className="h-3 w-28 mb-2" />
                  <Skeleton className="h-4 w-44 mb-1.5" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div
              style={{
                padding: "52px 20px",
                textAlign: "center",
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--bp-ink-secondary)",
              }}
            >
              <div
                className="bp-display"
                style={{
                  fontSize: 16,
                  lineHeight: 1.05,
                  color: "var(--bp-ink-primary)",
                }}
              >
                No active alerts
              </div>
              <div style={{ marginTop: 6 }}>All systems normal</div>
            </div>
          ) : (
            <div>
              {alerts.map((alert, index) => (
                <div
                  key={`${alert.entityName}-${index}`}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "14px 18px",
                    borderBottom:
                      index < alerts.length - 1
                        ? "1px solid var(--bp-border-subtle)"
                        : "none",
                    position: "relative",
                  }}
                >
                  <StatusRail status={toRailStatus(alert.status)} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <SeverityBadge severity={toSeverity(alert.status)} />
                      <SourceBadge source={alert.source} />
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--bp-ink-primary)",
                        lineHeight: 1.25,
                      }}
                    >
                      {alert.entityName}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--bp-ink-muted)",
                        marginTop: 4,
                      }}
                    >
                      {layer(alert.layer)} layer
                      {alert.lastLoadDate
                        ? ` · First seen ${relativeTime(alert.lastLoadDate)}`
                        : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bp-card" style={{ minHeight: 240 }}>
          <div className="bp-panel-header">
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--bp-ink-primary)",
              }}
            >
              Source Health
            </span>
            <Link to="/sources" className="bp-link" style={{ fontSize: 13 }}>
              All sources →
            </Link>
          </div>

          <div
            style={{
              maxHeight: 268,
              overflowY: "auto",
              scrollbarWidth: "thin",
              scrollbarColor: "var(--bp-border-strong) transparent",
            }}
          >
            {loading ? (
              <div>
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 18px",
                      borderBottom: "1px solid var(--bp-border-subtle)",
                    }}
                  >
                    <Skeleton className="h-2.5 w-2.5 rounded-full" />
                    <Skeleton className="h-3 w-24 flex-1" />
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-3 w-8" />
                  </div>
                ))}
              </div>
            ) : sources.length === 0 ? (
              <div
                style={{
                  padding: "40px 20px",
                  textAlign: "center",
                  fontSize: 13,
                  color: "var(--bp-ink-muted)",
                }}
              >
                No sources configured
              </div>
            ) : (
              <div>
                {sources.map((source, index) => {
                  const srcColor = getSourceColor(source.name);
                  const label = source.displayName || resolveSourceLabel(source.name);
                  const statusColor =
                    source.status === "operational"
                      ? "var(--bp-operational)"
                      : source.status === "degraded"
                        ? "var(--bp-caution)"
                        : "var(--bp-fault)";

                  return (
                    <div
                      key={source.name}
                      className="gs-stagger-row"
                      style={{
                        "--i": index,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "12px 18px",
                        borderBottom:
                          index < sources.length - 1
                            ? "1px solid var(--bp-border-subtle)"
                            : "none",
                        fontSize: 13,
                      } as CSSProperties}
                    >
                      <span
                        className="bp-source-dot"
                        style={{ backgroundColor: srcColor.hex }}
                      />
                      <span
                        style={{
                          flex: 1,
                          fontWeight: 600,
                          color: "var(--bp-ink-primary)",
                        }}
                      >
                        {label}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: statusColor,
                          textTransform: "capitalize",
                        }}
                      >
                        {source.status}
                      </span>
                      <span
                        className="bp-mono"
                        style={{
                          fontSize: 12,
                          color: "var(--bp-ink-tertiary)",
                          minWidth: 40,
                          textAlign: "right",
                        }}
                      >
                        {source.entityCount.toLocaleString("en-US")}
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
  );
}
