/**
 * MRI — Machine Regression Intelligence
 * Unified dashboard: visual testing, backend API testing, AI analysis, and swarm fix loop.
 * 5-tab layout: Overview | Visual | Backend | Swarm | History
 */
import { useState, useEffect, lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play, RefreshCw, Eye, Globe, Bug, History,
  LayoutGrid, Activity, Loader2, BrainCircuit,
  XCircle, Camera, Zap,
} from "lucide-react";
import { useMRI } from "@/hooks/useMRI";
import UnifiedKPIRow from "@/components/mri/UnifiedKPIRow";
import ScreenshotGallery from "@/components/mri/ScreenshotGallery";
import VisualDiffViewer from "@/components/mri/VisualDiffViewer";
import BaselineManager from "@/components/mri/BaselineManager";
import AIAnnotationCard from "@/components/mri/AIAnnotationCard";
import BackendTestPanel from "@/components/mri/BackendTestPanel";
import FlakeGraph from "@/components/mri/FlakeGraph";
import CoverageHeatmap from "@/components/mri/CoverageHeatmap";
import CrossBranchCompare from "@/components/mri/CrossBranchCompare";

// Lazy-load TestSwarm content (heavy, only needed in Swarm tab)
const TestSwarm = lazy(() => import("@/pages/TestSwarm"));

type Tab = "overview" | "visual" | "backend" | "swarm" | "history";

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "visual", label: "Visual", icon: Eye },
  { id: "backend", label: "Backend", icon: Globe },
  { id: "swarm", label: "Swarm", icon: Bug },
  { id: "history", label: "History", icon: History },
];

function formatElapsed(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0s";
  const clamped = Math.floor(s);
  const m = Math.floor(clamped / 60);
  const sec = clamped % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// Phase labels for the scanning banner
const SCAN_PHASES = [
  { after: 0, label: "Initializing", icon: Zap },
  { after: 3, label: "Launching browsers", icon: Globe },
  { after: 8, label: "Running tests", icon: Play },
  { after: 15, label: "Capturing screenshots", icon: Camera },
  { after: 30, label: "Analyzing results", icon: BrainCircuit },
  { after: 60, label: "Processing diffs", icon: Eye },
  { after: 120, label: "Deep analysis", icon: Activity },
];

function getScanPhase(elapsed: number) {
  let phase = SCAN_PHASES[0];
  for (const p of SCAN_PHASES) {
    if (elapsed >= p.after) phase = p;
  }
  return phase;
}

export default function MRI() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [selectedDiff, setSelectedDiff] = useState<ReturnType<typeof useMRI>["visualDiffs"][0] | null>(null);
  const [visualFilter, setVisualFilter] = useState<"all" | "mismatch" | "new" | "match">("all");

  const mri = useMRI();
  const latestSummary = mri.runs[0]?.summary ?? null;
  const phase = getScanPhase(mri.scanElapsed);
  const PhaseIcon = phase.icon;

  // Keep selectedDiff in sync with refreshed visualDiffs data
  useEffect(() => {
    if (selectedDiff && mri.visualDiffs.length > 0) {
      const fresh = mri.visualDiffs.find(d => d.testName === selectedDiff.testName);
      if (fresh && fresh !== selectedDiff) {
        setSelectedDiff(fresh);
      } else if (!fresh) {
        setSelectedDiff(null);
      }
    }
  }, [mri.visualDiffs]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6" style={{ padding: 32, maxWidth: 1280, margin: '0 auto' }}>
      {/* ═══ SCANNING BANNER — Sticky, non-blocking, always visible during scan ═══ */}
      {mri.scanning && (
        <div className="sticky top-0 z-40 -mx-8 -mt-8 mb-2">
          <div className="px-6 py-3" style={{ background: 'var(--bp-copper-light)', borderBottom: '2px solid var(--bp-copper)' }}>
            <div className="flex items-center justify-between">
              {/* Left: status + phase */}
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full animate-ping" style={{ background: 'var(--bp-copper-light)', animationDuration: "2s" }} />
                  <BrainCircuit className="h-5 w-5 relative z-10 animate-pulse" style={{ color: 'var(--bp-copper)' }} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)' }}>MRI Scan Running</span>
                    <Badge variant="outline" className="text-[10px] animate-pulse" style={{ fontFamily: 'var(--bp-font-mono)', borderColor: 'var(--bp-copper)', color: 'var(--bp-copper)' }}>
                      {phase.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {/* Progress dots */}
                    <div className="flex items-center gap-1" role="progressbar" aria-label="Scan progress" aria-valuenow={SCAN_PHASES.filter(p => mri.scanElapsed >= p.after).length} aria-valuemin={0} aria-valuemax={SCAN_PHASES.length}>
                      {SCAN_PHASES.map((p, i) => (
                        <div
                          key={i}
                          className={cn(
                            "h-1.5 rounded-full transition-all duration-500",
                            mri.scanElapsed >= p.after
                              ? "w-4"
                              : "w-1.5"
                          )}
                          style={{ background: mri.scanElapsed >= p.after ? 'var(--bp-copper)' : 'var(--bp-border)' }}
                        />
                      ))}
                    </div>
                    <span className="text-xs" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-mono)' }}>
                      <PhaseIcon className="inline h-3 w-3 mr-1 animate-spin" style={{ animationDuration: "3s" }} />
                      {phase.label}...
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: timer */}
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold" style={{ fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--bp-copper)' }}>
                  {formatElapsed(mri.scanElapsed)}
                </span>
                {/* Scanning progress bar */}
                <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bp-surface-inset)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(95, (mri.scanElapsed / 60) * 80 + 5)}%`,
                      transition: "width 1s ease",
                      background: 'var(--bp-copper)',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontFamily: 'var(--bp-font-display)', fontSize: 32, color: 'var(--bp-ink-primary)', fontWeight: 400, lineHeight: 1.2 }}>MRI</h1>
            <Badge variant="outline" className="text-[10px] tracking-wider" style={{ fontFamily: 'var(--bp-font-mono)', borderColor: 'var(--bp-border-strong)', color: 'var(--bp-ink-tertiary)' }}>
              Machine Regression Intelligence
            </Badge>
            {mri.scanning && (
              <Badge className="gap-1.5 animate-pulse" style={{ background: 'var(--bp-copper)', color: 'var(--bp-surface-1)' }}>
                <Loader2 className="h-3 w-3 animate-spin" />
                Scanning · {formatElapsed(mri.scanElapsed)}
              </Badge>
            )}
            {!mri.scanning && mri.status?.active && (
              <Badge className="gap-1 animate-pulse" style={{ background: 'var(--bp-operational)', color: 'var(--bp-surface-1)' }}>
                <Activity className="h-3 w-3" />
                Running
              </Badge>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--bp-ink-secondary)' }}>
            Visual testing, backend API tests, AI analysis, and autonomous fix loop
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={mri.refresh} disabled={mri.loading} className="gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", mri.loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={mri.triggerRun}
            disabled={mri.scanning}
            className={cn("gap-1.5 transition-all", mri.scanning && "opacity-70")}
          >
            {mri.scanning ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Run MRI Scan
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Tab bar — BP chip/toggle pattern */}
      <div className="flex items-center gap-2 pb-1" role="tablist" aria-label="MRI dashboard sections" style={{ borderBottom: '1px solid var(--bp-border)' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`mri-tabpanel-${id}`}
            id={`mri-tab-${id}`}
            onClick={() => setActiveTab(id)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer rounded-md"
            style={activeTab === id
              ? { background: 'var(--bp-copper-light)', border: '1px solid var(--bp-copper)', color: 'var(--bp-copper)', fontFamily: 'var(--bp-font-body)' }
              : { background: 'transparent', border: '1px solid transparent', color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {mri.error && (
        <div className="rounded-md px-4 py-3 flex items-center gap-3" style={{ border: '1px solid var(--bp-fault)', background: 'var(--bp-fault-light)' }}>
          <XCircle className="h-4 w-4 shrink-0" style={{ color: 'var(--bp-fault)' }} />
          <p className="text-sm" style={{ color: 'var(--bp-fault)' }}>{mri.error}</p>
        </div>
      )}

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="space-y-6" role="tabpanel" id="mri-tabpanel-overview" aria-labelledby="mri-tab-overview">
          <UnifiedKPIRow
            summary={latestSummary}
            visualDiffs={mri.visualDiffs}
            backendResults={mri.backendResults}
            aiAnalyses={mri.aiAnalyses}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Coverage */}
            <CoverageHeatmap
              visualDiffs={mri.visualDiffs}
              backendResults={mri.backendResults}
              totalTests={latestSummary?.testsAfter?.total ?? 0}
            />

            {/* AI Risk Summary */}
            <div className="rounded-lg p-4" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
              <h4 className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)', fontWeight: 600 }}>
                AI Risk Analysis
              </h4>
              <AIAnnotationCard analyses={mri.aiAnalyses} compact />
            </div>
          </div>

          {/* Screenshot gallery preview (mismatches + new only) */}
          {mri.visualDiffs.filter(d => d.status !== "match").length > 0 && (
            <div>
              <h3 className="text-sm mb-3" style={{ fontFamily: 'var(--bp-font-body)', fontWeight: 600, fontSize: 18, color: 'var(--bp-ink-primary)' }}>Visual Diffs Needing Attention</h3>
              <ScreenshotGallery
                diffs={mri.visualDiffs.filter(d => d.status !== "match")}
                aiAnalyses={mri.aiAnalyses}
                runId={mri.selectedRunId || ""}
                onSelect={(diff) => {
                  setSelectedDiff(diff);
                  setActiveTab("visual");
                }}
              />
            </div>
          )}
        </div>
      )}

      {activeTab === "visual" && (
        <div className="space-y-6" role="tabpanel" id="mri-tabpanel-visual" aria-labelledby="mri-tab-visual">
          {/* Filter row */}
          <div className="flex items-center gap-2">
            {(["all", "mismatch", "new", "match"] as const).map((f) => (
              <Button
                key={f}
                variant={visualFilter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setVisualFilter(f)}
                className="text-xs capitalize"
              >
                {f} {f !== "all" && `(${mri.visualDiffs.filter(d => d.status === f).length})`}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Gallery */}
            <div className="xl:col-span-1">
              <ScreenshotGallery
                diffs={mri.visualDiffs}
                aiAnalyses={mri.aiAnalyses}
                runId={mri.selectedRunId || ""}
                onSelect={setSelectedDiff}
                filter={visualFilter}
              />
            </div>

            {/* Diff viewer */}
            <div className="xl:col-span-2 space-y-4">
              {selectedDiff ? (
                <>
                  <VisualDiffViewer
                    diff={selectedDiff}
                    analysis={mri.aiAnalyses.find(a => a.testName === selectedDiff.testName)}
                    runId={mri.selectedRunId || ""}
                  />
                  {/* AI analysis for selected test */}
                  {mri.aiAnalyses.find(a => a.testName === selectedDiff.testName) && (
                    <AIAnnotationCard
                      analyses={mri.aiAnalyses.filter(a => a.testName === selectedDiff.testName)}
                    />
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 rounded-lg" style={{ color: 'var(--bp-ink-muted)', border: '1px dashed var(--bp-border)' }}>
                  <Eye className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-sm">Select a screenshot to view the diff</p>
                </div>
              )}
            </div>
          </div>

          {/* Baseline manager */}
          <BaselineManager
            diffs={mri.visualDiffs}
            baselines={mri.baselines}
            onAccept={mri.acceptBaseline}
            onAcceptAll={mri.acceptAllBaselines}
          />

          {/* Flake detection */}
          <FlakeGraph results={mri.flakeResults} />
        </div>
      )}

      {activeTab === "backend" && (
        <div className="space-y-6" role="tabpanel" id="mri-tabpanel-backend" aria-labelledby="mri-tab-backend">
          <div className="flex items-center justify-between">
            <h3 style={{ fontFamily: 'var(--bp-font-body)', fontWeight: 600, fontSize: 18, color: 'var(--bp-ink-primary)' }}>API Test Results</h3>
            <Button variant="outline" size="sm" onClick={mri.triggerApiTests} className="gap-1.5">
              <Play className="h-3.5 w-3.5" />
              Run API Tests
            </Button>
          </div>
          <BackendTestPanel results={mri.backendResults} />
        </div>
      )}

      {activeTab === "swarm" && (
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--bp-ink-muted)' }} />
            </div>
          }
        >
          <TestSwarm />
        </Suspense>
      )}

      {activeTab === "history" && (
        <CrossBranchCompare
          runs={mri.runs}
          selectedRunId={mri.selectedRunId}
          onSelectRun={mri.setSelectedRunId}
        />
      )}
    </div>
  );
}
