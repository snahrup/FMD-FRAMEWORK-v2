import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { RefreshCw, History } from "lucide-react";
import KPIRow from "@/components/test-swarm/KPIRow";
import RunTimeline, { type TimelineNode } from "@/components/test-swarm/RunTimeline";
import ConvergenceChart from "@/components/test-swarm/ConvergenceChart";
import ConvergenceGauge from "@/components/test-swarm/ConvergenceGauge";
import TestHeatmap from "@/components/test-swarm/TestHeatmap";
import IterationDetail from "@/components/test-swarm/IterationDetail";
import SwarmStatusBadge from "@/components/test-swarm/SwarmStatusBadge";
import SwarmSkeleton from "@/components/test-swarm/SwarmSkeleton";

const API = "/api";

interface RunListEntry {
  runId: string;
  summary: {
    status: string;
    startedAt: number;
    completedAt?: number;
    totalDuration: number;
    iterations: number;
    testsBefore: { total: number; passed: number; failed: number };
    testsAfter: { total: number; passed: number; failed: number };
    testsFixed: number;
    filesChanged: string[];
    config: Record<string, unknown>;
  } | null;
}

interface ConvergencePoint {
  iteration: number;
  passed: number;
  failed: number;
  delta: number;
}

interface IterationData {
  iteration: number;
  timestamp: number;
  duration: number;
  testsBefore: { total: number; passed: number; failed: number };
  testsAfter: { total: number; passed: number; failed: number };
  filesChanged: Array<{ file: string; added: number; removed: number }>;
  summary: string;
  agentLog?: string;
  diff?: string;
  persistentFailures?: string[];
  tests?: Array<{ name: string; status: "passed" | "failed" | "skipped" | "error"; duration?: number; error?: string; file?: string }>;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export default function TestSwarm() {
  const [runs, setRuns] = useState<RunListEntry[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [convergence, setConvergence] = useState<ConvergencePoint[]>([]);
  const [iterations, setIterations] = useState<Map<number, IterationData>>(new Map());
  const [selectedIteration, setSelectedIteration] = useState<number | null>(null);
  const [openIteration, setOpenIteration] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(`${API}/test-swarm/runs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: RunListEntry[] = await res.json();
      setRuns(data);
      if (data.length > 0 && !selectedRunId) {
        setSelectedRunId(data[0].runId);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, [selectedRunId]);

  const fetchRunDetail = useCallback(async (runId: string) => {
    try {
      const [convRes] = await Promise.all([
        fetch(`${API}/test-swarm/runs/${runId}/convergence`),
      ]);
      if (convRes.ok) {
        const convData: ConvergencePoint[] = await convRes.json();
        setConvergence(convData);
      }
    } catch {
      // Best effort
    }
  }, []);

  const fetchIteration = useCallback(async (runId: string, n: number) => {
    try {
      const res = await fetch(`${API}/test-swarm/runs/${runId}/iteration/${n}`);
      if (!res.ok) return;
      const data: IterationData = await res.json();
      setIterations(prev => new Map(prev).set(n, data));
    } catch {
      // Best effort
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    const id = setInterval(fetchRuns, 10_000);
    return () => clearInterval(id);
  }, [fetchRuns]);

  useEffect(() => {
    if (selectedRunId) {
      fetchRunDetail(selectedRunId);
      setIterations(new Map());
      setSelectedIteration(null);
      setOpenIteration(null);

      // Eagerly load all iterations for heatmap (up to 10)
      const run = runs.find(r => r.runId === selectedRunId);
      const iterCount = run?.summary?.iterations || 0;
      for (let i = 1; i <= Math.min(iterCount, 10); i++) {
        fetchIteration(selectedRunId, i);
      }
    }
  }, [selectedRunId, fetchRunDetail, runs, fetchIteration]);

  useEffect(() => {
    if (selectedRunId && selectedIteration != null) {
      if (!iterations.has(selectedIteration)) {
        fetchIteration(selectedRunId, selectedIteration);
      }
    }
  }, [selectedRunId, selectedIteration, fetchIteration, iterations]);

  const selectedRun = runs.find(r => r.runId === selectedRunId);
  const summary = selectedRun?.summary;

  // Build timeline nodes from convergence data
  const timelineNodes: TimelineNode[] = convergence.map(c => ({
    iteration: c.iteration,
    passed: c.passed,
    total: c.passed + c.failed,
    failed: c.failed,
    delta: c.delta,
    active: summary?.status === "in_progress" && c.iteration === convergence.length - 1,
  }));

  // Calculate lines changed from loaded iterations
  const totalLinesAdded = Array.from(iterations.values()).reduce(
    (sum, iter) => sum + iter.filesChanged.reduce((s, f) => s + f.added, 0), 0
  );
  const totalLinesRemoved = Array.from(iterations.values()).reduce(
    (sum, iter) => sum + iter.filesChanged.reduce((s, f) => s + f.removed, 0), 0
  );

  const isActive = summary?.status === "in_progress";

  // Build heatmap data from loaded iterations
  const heatmapData = new Map<number, Array<{ name: string; status: "passed" | "failed" | "skipped" | "error" }>>();
  for (const [iterNum, iterData] of iterations) {
    if (iterData.tests && iterData.tests.length > 0) {
      heatmapData.set(iterNum, iterData.tests);
    }
  }

  if (loading && runs.length === 0) {
    return <SwarmSkeleton />;
  }

  return (
    <div className="space-y-6" style={{ contain: "layout style" }}>
      {/* Run selector (if multiple runs) */}
      {runs.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <History className="h-4 w-4 text-muted-foreground shrink-0" />
          {runs.slice(0, 10).map(run => (
            <button
              key={run.runId}
              onClick={() => setSelectedRunId(run.runId)}
              className={cn(
                "flex items-center gap-2 rounded-[var(--radius)] px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                selectedRunId === run.runId
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground border border-border/30"
              )}
            >
              <SwarmStatusBadge status={(run.summary?.status || "idle") as never} className="scale-90" />
              <span>{run.runId.substring(0, 16)}</span>
              {run.summary && (
                <span className="text-muted-foreground">
                  {run.summary.testsAfter.passed}/{run.summary.testsAfter.total}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !summary && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--cl-error)]/20 bg-[var(--cl-error)]/5 p-6 text-center">
          <p className="text-sm text-[var(--cl-error)]">{error}</p>
          <p className="text-xs text-muted-foreground mt-2">Make sure the dashboard API is running and test-swarm has been used at least once.</p>
        </div>
      )}

      {/* No runs state */}
      {!error && runs.length === 0 && (
        <div className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-12 text-center space-y-3">
          <RefreshCw className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">No test-swarm runs found</p>
          <p className="text-xs text-muted-foreground/70">
            Run <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-foreground">/test-swarm</code> in Claude Code to get started
          </p>
        </div>
      )}

      {/* Main content */}
      {summary && (
        <>
          {/* KPI Row */}
          <KPIRow
            testsPassing={summary.testsAfter.passed}
            testsTotal={summary.testsAfter.total}
            iterations={summary.iterations}
            maxIterations={(summary.config?.max_iterations as number) || 5}
            duration={summary.totalDuration}
            filesChanged={summary.filesChanged.length}
            linesChanged={{ added: totalLinesAdded, removed: totalLinesRemoved }}
            status={summary.status}
          />

          {/* Timeline + Chart + Gauge row */}
          <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-3">
              <RunTimeline
                nodes={timelineNodes}
                selectedIteration={selectedIteration}
                onSelect={(n) => {
                  setSelectedIteration(n);
                  setOpenIteration(n);
                }}
              />
            </div>
            <div className="lg:col-span-2">
              <ConvergenceChart
                data={convergence}
                total={summary.testsAfter.total || summary.testsBefore.total}
                isActive={isActive}
              />
            </div>
            <div className="lg:col-span-1 rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-4 flex items-center justify-center">
              <ConvergenceGauge
                passed={summary.testsAfter.passed}
                total={summary.testsAfter.total || summary.testsBefore.total}
                label={isActive ? "In Progress" : "Pass Rate"}
              />
            </div>
          </div>

          {/* Heatmap (only shown when we have test-level data) */}
          {heatmapData.size > 0 && (
            <TestHeatmap
              iterations={heatmapData}
              iterationCount={summary.iterations}
            />
          )}

          {/* Iteration details */}
          {convergence.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground tracking-wide uppercase">Iteration Details</h3>
              {convergence
                .filter(c => c.iteration > 0)
                .map(c => (
                  <IterationDetail
                    key={c.iteration}
                    iteration={iterations.get(c.iteration) || null}
                    isOpen={openIteration === c.iteration}
                    onToggle={() => {
                      if (openIteration === c.iteration) {
                        setOpenIteration(null);
                      } else {
                        setOpenIteration(c.iteration);
                        setSelectedIteration(c.iteration);
                      }
                    }}
                  />
                ))}
              {convergence.filter(c => c.iteration > 0).length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-4">
                  All tests passed on the initial run — no fix iterations needed
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
