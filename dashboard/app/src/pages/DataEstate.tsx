import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Globe, RefreshCw, Loader2, AlertTriangle, ArrowDown, ChevronRight } from "lucide-react";
import { SourceNode } from "@/components/estate/SourceNode";
import { LayerZone } from "@/components/estate/LayerZone";
import { GovernancePanel } from "@/components/estate/GovernancePanel";
import { PipelineFlow } from "@/components/estate/PipelineFlow";
import CompactPageHeader from "@/components/layout/CompactPageHeader";

// ============================================================================
// TYPES
// ============================================================================

interface EstateSource {
  name: string;
  displayName: string;
  status: "operational" | "degraded" | "offline";
  entityCount: number;
  loadedCount: number;
  errorCount: number;
  lastRefreshed: string | null;
}

interface EstateLayer {
  name: string;
  key: string;
  color: string;
  inScope: number;
  loaded: number;
  missing: number;
  lastLoad: string | null;
  coveragePct: number;
}

interface EstateOverview {
  sources: EstateSource[];
  layers: EstateLayer[];
  classification: {
    classifiedColumns: number;
    totalColumns: number;
    coveragePct: number;
    piiCount: number;
  };
  schemaValidation: {
    total: number;
    passed: number;
    failed: number;
  };
  purview: {
    mappingCount: number;
    lastSyncStatus: string | null;
    lastSyncAt: string | null;
    status: "synced" | "ready" | "pending";
  };
  freshness: {
    lastSuccessfulLoad: string | null;
    lastRun: { runId: string; status: string; startedAt: string; completedAt: string } | null;
  };
  generatedAt: string;
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function DataEstate() {
  const [data, setData] = useState<EstateOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/estate/overview");
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load estate data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30_000);
    return () => clearInterval(timer);
  }, [fetchData]);
  const d = data;
  const sourceCount = d?.sources.length ?? 0;
  const hasPopulatedEstate = !!d && d.sources.length > 0;

  // Derived metrics
  const totalEntities = hasPopulatedEstate ? d.sources.reduce((sum, s) => sum + s.entityCount, 0) : 0;
  const landingLoaded = hasPopulatedEstate ? (d.layers[0]?.loaded ?? 0) : 0;
  const bronzeLoaded = hasPopulatedEstate ? (d.layers[1]?.loaded ?? 0) : 0;
  const silverLoaded = hasPopulatedEstate ? (d.layers[2]?.loaded ?? 0) : 0;
  const totalBlockers = hasPopulatedEstate ? d.sources.reduce((sum, s) => sum + s.errorCount, 0) : 0;

  // Flow activity flags
  const sourcesActive = hasPopulatedEstate ? d.sources.some((s) => s.loadedCount > 0) : false;
  const layersActive = {
    landing: hasPopulatedEstate ? (d.layers[0]?.loaded ?? 0) > 0 : false,
    bronze: hasPopulatedEstate ? (d.layers[1]?.loaded ?? 0) > 0 : false,
    silver: hasPopulatedEstate ? (d.layers[2]?.loaded ?? 0) > 0 : false,
  };
  const governanceActive = hasPopulatedEstate ? d.classification.classifiedColumns > 0 : false;
  const estateGuideItems = [
    {
      label: "What This Page Is",
      value: "Fabric load map",
      detail: `Track ${sourceCount} scoped source systems and see exactly how many tables are physically present in Landing, Bronze, and Silver without translating internal framework state.`,
    },
    {
      label: "Why It Matters",
      value: "One load story across the app",
      detail: "If this page and the rest of the app disagree about Fabric load counts, every walkthrough loses credibility immediately.",
    },
    {
      label: "What Happens Next",
      value: "Move into the right workspace",
      detail: "Use this page to decide whether the next stop should be Load Center for execution, Mission Control for active runs, or governance tools for downstream verification.",
    },
  ];
  const estateGuideLinks = [
    { label: "Open Load Center", to: "/load-center" },
    { label: "Open Source Manager", to: "/sources" },
    { label: "Back to Overview", to: "/overview" },
  ];

  return (
    <div className="estate-page bp-page-shell-wide space-y-6">
      <CompactPageHeader
          eyebrow="Orient"
          title="Data Estate"
          meta={
            hasPopulatedEstate
              ? `Fabric layer load across ${d.sources.length} source systems`
              : loading
                ? "Loading estate…"
                : "Waiting for estate activity"
          }
          summary="This page answers the simple version first: how many tables are in scope, and how many have actually landed in Landing, Bronze, and Silver inside Fabric. Governance detail stays visible, but it no longer competes with the load story."
          guideItems={estateGuideItems}
          guideLinks={estateGuideLinks}
          actions={
            <div className="flex items-center gap-2">
              <Link
                to="/load-center"
                className="inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold transition-transform hover:-translate-y-0.5"
                style={{
                  textDecoration: "none",
                  color: "var(--bp-ink-secondary)",
                  border: "1px solid rgba(120,113,108,0.1)",
                  background: "rgba(255,255,255,0.72)",
                }}
              >
                Load Center
              </Link>
              <button
                onClick={fetchData}
                className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-transform hover:-translate-y-0.5"
                style={{
                  border: "1px solid rgba(120,113,108,0.1)",
                  background: "rgba(255,255,255,0.72)",
                  color: "var(--bp-ink-secondary)",
                }}
                disabled={loading}
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          }
          facts={[
            { label: "Sources", value: sourceCount.toLocaleString(), tone: sourceCount > 0 ? "positive" : "neutral" },
            { label: "Tables In Scope", value: totalEntities.toLocaleString(), tone: "accent" },
            { label: "Silver Loaded", value: silverLoaded.toLocaleString(), tone: silverLoaded === totalEntities && totalEntities > 0 ? "positive" : "warning" },
            { label: "Blockers", value: totalBlockers.toLocaleString(), tone: totalBlockers === 0 ? "positive" : "warning" },
          ]}
        />
      {loading && !d ? (
        <div className="flex items-center justify-center h-[calc(100vh-4rem)] gap-2" style={{ color: "var(--bp-ink-muted)" }}>
          <Loader2 className="animate-spin" size={18} />
          <span className="text-sm">Loading estate…</span>
        </div>
      ) : error && !d ? (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] gap-3">
          <AlertTriangle size={24} style={{ color: "var(--bp-fault)" }} />
          <p className="text-sm" style={{ color: "var(--bp-ink-secondary)" }}>{error}</p>
          <button
            onClick={fetchData}
            className="text-[11px] px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bp-surface-inset)]"
            style={{ borderColor: "var(--bp-border)", color: "var(--bp-ink-tertiary)" }}
          >
            Retry
          </button>
        </div>
      ) : d && d.sources.length === 0 ? (
        <EmptyEstate onRefresh={fetchData} />
      ) : d ? (
        <>
          <div className="flex items-center gap-3" style={{ marginTop: -4 }}>
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "var(--bp-copper-soft)", color: "var(--bp-copper)" }}
            >
              <Globe size={18} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--bp-ink-tertiary)",
                }}
              >
                Current Estate Snapshot
              </div>
              <p className="text-[12px]" style={{ color: "var(--bp-ink-secondary)", margin: "4px 0 0" }}>
                Landing, Bronze, and Silver posture for the managed Fabric estate.
              </p>
            </div>
          </div>

          {/* ── Hero KPI Strip ────────────────────────────────────────── */}
          <div>
            <div className="grid grid-cols-4 gap-3">
              <KpiCard
                label="Tables In Scope"
                value={totalEntities.toLocaleString()}
                sub="managed pipeline scope"
                index={0}
              />
              <KpiCard
                label="Landing Loaded"
                value={landingLoaded.toLocaleString()}
                sub={`${Math.round((landingLoaded / Math.max(totalEntities, 1)) * 100)}% of scope`}
                color={landingLoaded === totalEntities ? "var(--bp-operational)" : "var(--bp-caution)"}
                index={1}
              />
              <KpiCard
                label="Bronze Loaded"
                value={bronzeLoaded.toLocaleString()}
                sub={`${Math.round((bronzeLoaded / Math.max(totalEntities, 1)) * 100)}% of scope`}
                color={bronzeLoaded === totalEntities ? "var(--bp-operational)" : "var(--bp-caution)"}
                index={2}
              />
              <KpiCard
                label="Silver Loaded"
                value={silverLoaded.toLocaleString()}
                sub={totalBlockers > 0 ? `${totalBlockers.toLocaleString()} blocked` : "ready for downstream tools"}
                color={silverLoaded === totalEntities && totalBlockers === 0 ? "var(--bp-operational)" : totalBlockers > 0 ? "var(--bp-fault)" : "var(--bp-caution)"}
                index={3}
              />
            </div>
          </div>

          {/* ── Three-Zone Pipeline Layout ────────────────────────────── */}
          <div>
            <div className="relative grid grid-cols-[minmax(200px,260px)_1fr_minmax(220px,280px)] gap-6 min-h-[480px]">

              {/* SVG flow connectors (behind everything) */}
              <PipelineFlow
                sourcesActive={sourcesActive}
                layersActive={layersActive}
                governanceActive={governanceActive}
              />

              {/* ─── Zone 1: Source Systems ─────────────────────── */}
              <div className="relative z-10">
                <ZoneLabel label="Source Systems" count={d.sources.length} />
                <div className="space-y-2">
                  {d.sources.map((src, i) => (
                    <SourceNode
                      key={src.name}
                      {...src}
                      index={i}
                      isGhost={src.loadedCount === 0}
                    />
                  ))}
                </div>
              </div>

              {/* ─── Zone 2: Pipeline Layers ────────────────────── */}
              <div className="relative z-10 flex flex-col">
                <ZoneLabel label="Pipeline Layers" />

                <div className="flex-1 flex flex-col justify-center gap-2">
                  {d.layers.map((layer, i) => (
                    <div key={layer.key}>
                      <LayerZone
                        name={layer.name}
                        layerKey={layer.key}
                        inScope={layer.inScope}
                        loaded={layer.loaded}
                        missing={layer.missing}
                        coveragePct={layer.coveragePct}
                        lastLoad={layer.lastLoad}
                        index={i}
                      />

                      {/* Flow connector between layers */}
                      {i < d.layers.length - 1 && (
                        <div className="flex justify-center py-1">
                          <ArrowDown
                            size={14}
                            style={{
                              color: (d.layers[i]?.loaded > 0 && d.layers[i + 1]?.loaded > 0)
                                ? "var(--bp-copper)"
                                : "var(--bp-border)",
                              transition: "color 0.4s var(--ease-claude)",
                              opacity: 0.5,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* ─── Zone 3: Governance ─────────────────────────── */}
              <div className="relative z-10">
                <ZoneLabel label="Governance" />
                <GovernancePanel
                  classification={d.classification}
                  schemaValidation={d.schemaValidation}
                  purview={d.purview}
                />
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ============================================================================
// ZONE LABEL — consistent section header across all three zones
// ============================================================================

function ZoneLabel({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-display)" }}
      >
        {label}
      </span>
      {count !== undefined && (
        <span
          className="text-[9px] tabular-nums px-1.5 py-0.5 rounded-full"
          style={{ background: "var(--bp-copper-soft)", color: "var(--bp-copper)" }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ============================================================================
// KPI CARD — compact hero metric for the strip
// ============================================================================

function KpiCard({
  label,
  value,
  sub,
  color,
  index,
}: {
  label: string;
  value: string;
  sub: string;
  color?: string;
  index: number;
}) {
  return (
    <div
      className="relative rounded-xl border px-4 py-3 overflow-hidden"
      style={{
        "--i": index,
        animation: `fadeIn 400ms calc(var(--i) * 80ms) var(--ease-claude) both`,
        background: "var(--bp-surface-1)",
        borderColor: "var(--bp-border-strong)",
      } as React.CSSProperties}
    >
      {/* Status rail */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
        style={{ background: color || "var(--bp-copper)" }}
      />

      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--bp-ink-tertiary)" }}>
        {label}
      </div>
      <div
        className="text-xl font-bold tabular-nums leading-none"
        style={{ color: color || "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}
      >
        {value}
      </div>
      <div className="text-[10px] mt-1 tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
        {sub}
      </div>
    </div>
  );
}

// ============================================================================
// EMPTY STATE
// ============================================================================

function EmptyEstate({ onRefresh }: { onRefresh: () => void }) {
  const layers = ["Sources", "LZ", "Bronze", "Silver"];

  return (
    <div
      className="flex items-center justify-center h-[calc(100vh-4rem)]"
      style={{ animation: "fadeIn 500ms var(--ease-claude) both" }}
    >
      <div className="text-center max-w-md space-y-5 px-6">
        {/* Ghost pipeline — dashed nodes with arrows */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {layers.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className="w-12 h-12 rounded-xl border-2 flex items-center justify-center text-[8px] font-semibold uppercase tracking-wider"
                style={{
                  "--i": i,
                  animation: `fadeIn 300ms calc(var(--i) * 80ms) var(--ease-claude) both`,
                  borderColor: "var(--bp-border)",
                  borderStyle: "dashed",
                  color: "var(--bp-ink-muted)",
                  opacity: 0.35,
                } as React.CSSProperties}
              >
                {label}
              </div>
              {i < layers.length - 1 && (
                <ChevronRight size={10} style={{ color: "var(--bp-border)", opacity: 0.4 }} />
              )}
            </div>
          ))}
        </div>

        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "var(--bp-copper-soft)", color: "var(--bp-copper)" }}
        >
          <Globe size={24} />
        </div>

        <div>
          <h2
            className="text-lg font-semibold mb-1.5"
            style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}
          >
            Your data estate is being set up
          </h2>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--bp-ink-tertiary)" }}>
            Connect source systems and run your first load to see data move
            through Landing, Bronze, and Silver. Each node lights up when Fabric confirms the load.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all hover:opacity-90"
          style={{ background: "var(--bp-copper)", color: "#fff" }}
        >
          <RefreshCw size={14} />
          Check Again
        </button>
      </div>
    </div>
  );
}
