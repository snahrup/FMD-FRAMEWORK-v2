/**
 * MRI — Machine Regression Intelligence
 * Unified dashboard: visual testing, backend API testing, AI analysis, and swarm fix loop.
 * 5-tab layout: Overview | Visual | Backend | Swarm | History
 */
import { useState, lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play, RefreshCw, Eye, Globe, Bug, History,
  LayoutGrid, Activity, Loader2, BrainCircuit,
  CheckCircle2, XCircle, Camera, Zap,
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
  const m = Math.floor(s / 60);
  const sec = s % 60;
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

  return (
    <div className="space-y-6">
      {/* ═══ SCANNING BANNER — Sticky, non-blocking, always visible during scan ═══ */}
      {mri.scanning && (
        <div className="sticky top-0 z-40 -mx-6 -mt-6 mb-2">
          <div className="bg-primary/5 border-b-2 border-primary/40 px-6 py-3">
            <div className="flex items-center justify-between">
              {/* Left: status + phase */}
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: "2s" }} />
                  <BrainCircuit className="h-5 w-5 text-primary relative z-10 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">MRI Scan Running</span>
                    <Badge variant="outline" className="text-[10px] font-mono animate-pulse">
                      {phase.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {/* Progress dots */}
                    <div className="flex items-center gap-1">
                      {SCAN_PHASES.map((p, i) => (
                        <div
                          key={i}
                          className={cn(
                            "h-1.5 rounded-full transition-all duration-500",
                            mri.scanElapsed >= p.after
                              ? "w-4 bg-primary"
                              : "w-1.5 bg-muted-foreground/20"
                          )}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">
                      <PhaseIcon className="inline h-3 w-3 mr-1 animate-spin" style={{ animationDuration: "3s" }} />
                      {phase.label}...
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: timer */}
              <div className="flex items-center gap-3">
                <span className="font-mono text-lg font-bold tabular-nums text-primary">
                  {formatElapsed(mri.scanElapsed)}
                </span>
                {/* Scanning progress bar */}
                <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{
                      width: `${Math.min(95, (mri.scanElapsed / 60) * 80 + 5)}%`,
                      transition: "width 1s ease",
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
            <h1 className="text-2xl font-display font-semibold tracking-tight">MRI</h1>
            <Badge variant="outline" className="text-[10px] font-mono tracking-wider">
              Machine Regression Intelligence
            </Badge>
            {mri.scanning && (
              <Badge className="gap-1.5 bg-primary/90 animate-pulse">
                <Loader2 className="h-3 w-3 animate-spin" />
                Scanning · {formatElapsed(mri.scanElapsed)}
              </Badge>
            )}
            {!mri.scanning && mri.status?.active && (
              <Badge className="gap-1 animate-pulse">
                <Activity className="h-3 w-3" />
                Running
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
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

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative cursor-pointer",
              "hover:text-foreground",
              activeTab === id
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {activeTab === id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Error state */}
      {mri.error && (
        <div className="rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-center gap-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{mri.error}</p>
        </div>
      )}

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="space-y-6">
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
            <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                AI Risk Analysis
              </h4>
              <AIAnnotationCard analyses={mri.aiAnalyses} compact />
            </div>
          </div>

          {/* Screenshot gallery preview (mismatches + new only) */}
          {mri.visualDiffs.filter(d => d.status !== "match").length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3">Visual Diffs Needing Attention</h3>
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
        <div className="space-y-6">
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
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border border-dashed border-border rounded-[var(--radius-lg)]">
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
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">API Test Results</h3>
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
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
