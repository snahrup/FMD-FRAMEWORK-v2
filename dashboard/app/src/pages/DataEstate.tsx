import { useEffect, useState, useCallback } from "react";
import { Globe, RefreshCw, Loader2, AlertTriangle, ArrowDown, ChevronRight } from "lucide-react";
import { SourceNode } from "@/components/estate/SourceNode";
import { LayerZone } from "@/components/estate/LayerZone";
import { GovernancePanel } from "@/components/estate/GovernancePanel";
import { PipelineFlow } from "@/components/estate/PipelineFlow";

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
  registered: number;
  loaded: number;
  failed: number;
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

  // ── Loading ──────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] gap-2" style={{ color: "var(--bp-ink-muted)" }}>
        <Loader2 className="animate-spin" size={18} />
        <span className="text-sm">Loading estate…</span>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────
  if (error && !data) {
    return (
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
    );
  }

  // ── Empty (no sources) ───────────────────────────────────────────
  if (data && data.sources.length === 0) {
    return <EmptyEstate onRefresh={fetchData} />;
  }

  const d = data!;

  // Derived metrics
  const totalEntities = d.sources.reduce((sum, s) => sum + s.entityCount, 0);
  const totalLoaded = d.sources.reduce((sum, s) => sum + s.loadedCount, 0);
  const totalErrors = d.sources.reduce((sum, s) => sum + s.errorCount, 0);
  const healthySources = d.sources.filter((s) => s.status === "operational").length;

  // Flow activity flags
  const sourcesActive = d.sources.some((s) => s.loadedCount > 0);
  const layersActive = {
    landing: d.layers[0]?.loaded > 0,
    bronze: d.layers[1]?.loaded > 0,
    silver: d.layers[2]?.loaded > 0,
    gold: d.layers[3]?.loaded > 0,
  };
  const governanceActive = d.classification.classifiedColumns > 0;

  return (
    <div className="estate-page" style={{ animation: "fadeIn 400ms var(--ease-claude) both" }}>

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "var(--bp-copper-soft)", color: "var(--bp-copper)" }}
          >
            <Globe size={18} />
          </div>
          <div>
            <h1
              className="text-[17px] font-semibold leading-tight"
              style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}
            >
              Data Estate
            </h1>
            <p className="text-[10px]" style={{ color: "var(--bp-ink-tertiary)" }}>
              Pipeline health across {d.sources.length} source systems
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {d.freshness.lastSuccessfulLoad && (
            <span className="text-[10px] tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
              Last load{" "}
              {new Date(d.freshness.lastSuccessfulLoad).toLocaleDateString(undefined, {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </span>
          )}
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg border transition-colors hover:bg-[var(--bp-surface-inset)]"
            style={{ borderColor: "var(--bp-border)", color: "var(--bp-ink-tertiary)" }}
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Hero KPI Strip ────────────────────────────────────────── */}
      <div className="px-6 pb-4">
        <div className="grid grid-cols-4 gap-3">
          <KpiCard
            label="Entities"
            value={totalEntities.toLocaleString()}
            sub={`${totalLoaded.toLocaleString()} loaded`}
            index={0}
          />
          <KpiCard
            label="Sources"
            value={`${healthySources}/${d.sources.length}`}
            sub="operational"
            color={healthySources === d.sources.length ? "var(--bp-operational)" : "var(--bp-caution)"}
            index={1}
          />
          <KpiCard
            label="Governance"
            value={`${d.classification.coveragePct}%`}
            sub="classified"
            color={d.classification.coveragePct >= 80 ? "var(--bp-operational)" : "var(--bp-caution)"}
            index={2}
          />
          <KpiCard
            label="Errors"
            value={totalErrors.toLocaleString()}
            sub={d.schemaValidation.failed > 0 ? `${d.schemaValidation.failed} validation` : "pipeline"}
            color={totalErrors > 0 ? "var(--bp-fault)" : "var(--bp-operational)"}
            index={3}
          />
        </div>
      </div>

      {/* ── Three-Zone Pipeline Layout ────────────────────────────── */}
      <div className="px-6 pb-6">
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
                    registered={layer.registered}
                    loaded={layer.loaded}
                    failed={layer.failed}
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
  const layers = ["Sources", "LZ", "Bronze", "Silver", "Gold"];

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
            Register source systems and run your first load to see data flow
            through the pipeline. Each node lights up as data reaches it.
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
