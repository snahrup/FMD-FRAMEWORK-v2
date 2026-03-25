import { useEffect, useState, useCallback } from "react";
import { Globe, RefreshCw, Loader2, AlertTriangle, ArrowRight } from "lucide-react";
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
    // Auto-refresh every 30s
    const timer = setInterval(fetchData, 30_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  // ── Loading state ────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] gap-2" style={{ color: "var(--bp-ink-muted)" }}>
        <Loader2 className="animate-spin" size={18} />
        Loading estate overview…
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] gap-2" style={{ color: "var(--bp-fault)" }}>
        <AlertTriangle size={18} />
        {error}
      </div>
    );
  }

  // ── Empty state (no sources registered at all) ───────────────────
  if (data && data.sources.length === 0) {
    return <EmptyEstate onRefresh={fetchData} />;
  }

  const d = data!;

  // Compute flow activity
  const sourcesActive = d.sources.some((s) => s.loadedCount > 0);
  const layersActive = {
    landing: d.layers[0]?.loaded > 0,
    bronze: d.layers[1]?.loaded > 0,
    silver: d.layers[2]?.loaded > 0,
    gold: d.layers[3]?.loaded > 0,
  };
  const governanceActive = d.classification.classifiedColumns > 0;

  // Total entity count
  const totalEntities = d.sources.reduce((sum, s) => sum + s.entityCount, 0);
  const totalLoaded = d.sources.reduce((sum, s) => sum + s.loadedCount, 0);

  return (
    <div className="estate-page" style={{ animation: "fadeIn 400ms var(--ease-claude) both" }}>
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "var(--bp-copper)", color: "#fff" }}
          >
            <Globe size={20} />
          </div>
          <div>
            <h1
              className="text-lg font-semibold"
              style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}
            >
              Data Estate
            </h1>
            <p className="text-[11px]" style={{ color: "var(--bp-ink-tertiary)" }}>
              {totalEntities.toLocaleString()} entities across {d.sources.length} sources
              {totalLoaded > 0 && ` · ${totalLoaded.toLocaleString()} loaded`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {d.freshness.lastSuccessfulLoad && (
            <span className="text-[10px] tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
              Last load:{" "}
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

      {/* ── Three-Zone Pipeline Layout ────────────────────────── */}
      <div className="px-6 pb-6">
        <div className="relative grid grid-cols-[minmax(180px,240px)_1fr_minmax(200px,260px)] gap-5 min-h-[520px]">
          {/* SVG flow connections (background) */}
          <PipelineFlow
            sourcesActive={sourcesActive}
            layersActive={layersActive}
            governanceActive={governanceActive}
          />

          {/* ─── Zone 1: Source Constellation ─────────────── */}
          <div
            className="estate-zone-sources relative z-10 space-y-2"
            style={{ animation: "fadeIn 400ms var(--ease-claude) both" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--bp-ink-tertiary)" }}
              >
                Source Systems
              </span>
              <span className="text-[10px] tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
                {d.sources.length}
              </span>
            </div>
            {d.sources.map((src, i) => (
              <SourceNode
                key={src.name}
                {...src}
                index={i}
                isGhost={src.loadedCount === 0}
              />
            ))}
          </div>

          {/* ─── Zone 2: Medallion Layers ─────────────────── */}
          <div
            className="estate-zone-layers relative z-10 flex flex-col justify-center"
            style={{ animation: "fadeIn 400ms 200ms var(--ease-claude) both" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--bp-ink-tertiary)" }}
              >
                Medallion Architecture
              </span>
            </div>

            <div className="space-y-3">
              {d.layers.map((layer, i) => (
                <div key={layer.key} className="flex items-center gap-3">
                  <div className="flex-1">
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
                  </div>
                  {/* Arrow between layers */}
                  {i < d.layers.length - 1 && (
                    <div className="absolute right-0 translate-x-full" style={{ display: "none" }}>
                      <ArrowRight size={14} style={{ color: "var(--bp-border)" }} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Vertical flow arrows between layers */}
            <div className="absolute left-6 top-14 bottom-4 w-px" style={{ background: "var(--bp-border)" }}>
              {[0, 1, 2].map((i) => {
                const isActive = d.layers[i]?.loaded > 0 && d.layers[i + 1]?.loaded > 0;
                return (
                  <div
                    key={i}
                    className="absolute w-3 h-3 -left-[5px] rounded-full border-2"
                    style={{
                      top: `${(i + 1) * 25}%`,
                      borderColor: isActive ? "var(--bp-copper)" : "var(--bp-border)",
                      background: isActive ? "var(--bp-copper)" : "var(--bp-surface-1)",
                      transition: "all 0.4s var(--ease-claude)",
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* ─── Zone 3: Governance ───────────────────────── */}
          <div
            className="estate-zone-governance relative z-10"
            style={{ animation: "fadeIn 400ms 400ms var(--ease-claude) both" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--bp-ink-tertiary)" }}
              >
                Governance
              </span>
            </div>
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
// EMPTY STATE
// ============================================================================

function EmptyEstate({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div
      className="flex items-center justify-center h-[calc(100vh-4rem)]"
      style={{ animation: "fadeIn 500ms var(--ease-claude) both" }}
    >
      <div className="text-center max-w-lg space-y-5 px-6">
        {/* Ghost pipeline visualization */}
        <div className="flex items-center justify-center gap-4 mb-6 opacity-30">
          {["Sources", "LZ", "Bronze", "Silver", "Gold"].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className="w-14 h-14 rounded-xl border-2 flex items-center justify-center text-[9px] font-semibold uppercase tracking-wider"
                style={{
                  borderColor: "var(--bp-border)",
                  borderStyle: "dashed",
                  color: "var(--bp-ink-muted)",
                  animation: `fadeIn 300ms ${i * 100}ms var(--ease-claude) both`,
                }}
              >
                {label}
              </div>
              {i < 4 && (
                <ArrowRight size={12} style={{ color: "var(--bp-border)" }} />
              )}
            </div>
          ))}
        </div>

        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "var(--bp-copper-soft)", color: "var(--bp-copper)" }}
        >
          <Globe size={28} />
        </div>

        <div>
          <h2
            className="text-xl font-semibold mb-2"
            style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}
          >
            Your data estate is being set up
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--bp-ink-tertiary)" }}>
            Register source systems and run your first load to see data flow
            through the pipeline. Each node lights up as data reaches it.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
          style={{
            background: "var(--bp-copper)",
            color: "#fff",
          }}
        >
          <RefreshCw size={14} />
          Check Again
        </button>
      </div>
    </div>
  );
}
