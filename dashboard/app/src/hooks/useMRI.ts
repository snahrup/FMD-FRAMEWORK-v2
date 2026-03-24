/**
 * useMRI — data-fetching hook for the MRI (Machine Regression Intelligence) dashboard.
 * Fetches visual diffs, backend API results, AI analyses, baselines, and run history.
 */
import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

export interface VisualDiff {
  testName: string;
  baselinePath: string;
  actualPath: string;
  diffPath: string;
  mismatchPixels: number;
  mismatchPercentage: number;
  dimensions: { width: number; height: number };
  status: "match" | "mismatch" | "new" | "missing_baseline";
}

export interface AIAnalysis {
  testName: string;
  screenshotDescription: string;
  visualChanges: string[];
  suggestedFixes: string[];
  riskLevel: "low" | "medium" | "high";
  timestamp: number;
}

export interface BackendTestResult {
  name: string;
  endpoint: string;
  method: string;
  status: "passed" | "failed" | "error";
  statusCode: number;
  expectedStatusCode: number | number[];
  responseTimeMs: number;
  payloadValid: boolean;
  error?: string;
}

export interface FlakeResult {
  testName: string;
  runs: number;
  passed: number;
  failed: number;
  passRate: number;
  isFlaky: boolean;
  failures: string[];
}

export interface BaselineEntry {
  testName: string;
  viewport: string;
  path: string;
  lastUpdated: number;
}

export interface MRIIteration {
  iteration: number;
  timestamp: number;
  duration: number;
  testsBefore: { total: number; passed: number; failed: number };
  testsAfter: { total: number; passed: number; failed: number };
  visualDiffs?: VisualDiff[];
  aiAnalyses?: AIAnalysis[];
  filesChanged: Array<{ file: string; added: number; removed: number }>;
  summary: string;
}

export interface MRIRunSummary {
  runId: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  totalDuration: number;
  iterations: number;
  testsBefore: { total: number; passed: number; failed: number };
  testsAfter: { total: number; passed: number; failed: number };
  testsFixed: number;
  visualSummary?: {
    totalScreenshots: number;
    mismatches: number;
    newScreenshots: number;
    matches: number;
  };
  backendSummary?: {
    total: number;
    passed: number;
    failed: number;
    avgResponseMs: number;
  };
  aiSummary?: {
    analyzed: number;
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
  };
}

export interface MRIRunEntry {
  runId: string;
  summary: MRIRunSummary | null;
}

export interface MRIStatus {
  active: boolean;
  lastRun: MRIRunEntry | null;
}

// ── Hook ──

interface UseMRIOptions {
  pollInterval?: number;
  autoFetch?: boolean;
}

interface UseMRIReturn {
  // Run list + status
  runs: MRIRunEntry[];
  status: MRIStatus | null;
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;

  // Run detail
  convergence: Array<{ iteration: number; passed: number; failed: number; delta: number }>;
  iteration: MRIIteration | null;
  selectedIteration: number;
  setSelectedIteration: (n: number) => void;

  // Visual
  visualDiffs: VisualDiff[];
  baselines: BaselineEntry[];

  // Backend
  backendResults: BackendTestResult[];

  // AI
  aiAnalyses: AIAnalysis[];

  // Flake
  flakeResults: FlakeResult[];

  // Actions
  refresh: () => void;
  acceptBaseline: (testName: string) => Promise<void>;
  acceptAllBaselines: () => Promise<void>;
  triggerRun: () => Promise<void>;
  triggerApiTests: () => Promise<void>;

  // State
  loading: boolean;
  scanning: boolean;
  scanElapsed: number;
  error: string | null;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(`${API}${url}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function useMRI(options: UseMRIOptions = {}): UseMRIReturn {
  const { pollInterval = 15_000, autoFetch = true } = options;

  const [runs, setRuns] = useState<MRIRunEntry[]>([]);
  const [status, setStatus] = useState<MRIStatus | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [convergence, setConvergence] = useState<Array<{ iteration: number; passed: number; failed: number; delta: number }>>([]);
  const [iteration, setIteration] = useState<MRIIteration | null>(null);
  const [selectedIteration, setSelectedIteration] = useState(0);
  const [visualDiffs, setVisualDiffs] = useState<VisualDiff[]>([]);
  const [baselines, setBaselines] = useState<BaselineEntry[]>([]);
  const [backendResults, setBackendResults] = useState<BackendTestResult[]>([]);
  const [aiAnalyses, setAiAnalyses] = useState<AIAnalysis[]>([]);
  const [flakeResults, setFlakeResults] = useState<FlakeResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanElapsed, setScanElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const scanPollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Fetch top-level data (runs list + status)
  const fetchTopLevel = useCallback(async () => {
    try {
      const [runsData, statusData] = await Promise.all([
        fetchJSON<MRIRunEntry[]>("/api/mri/runs"),
        fetchJSON<MRIStatus>("/api/mri/status"),
      ]);
      setRuns(runsData);
      setStatus(statusData);

      // Auto-select latest run if none selected
      if (!selectedRunId && runsData.length > 0) {
        setSelectedRunId(runsData[0].runId);
      }

      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch MRI data");
    } finally {
      setLoading(false);
    }
  }, [selectedRunId]);

  // Fetch run detail when selectedRunId changes
  const fetchRunDetail = useCallback(async (runId: string) => {
    try {
      const [conv, vis, backend, ai, flakes] = await Promise.all([
        fetchJSON<Array<{ iteration: number; passed: number; failed: number; delta: number }>>(`/api/mri/runs/${runId}/convergence`),
        fetchJSON<VisualDiff[]>(`/api/mri/runs/${runId}/visual-diffs`),
        fetchJSON<BackendTestResult[]>(`/api/mri/runs/${runId}/backend-results`),
        fetchJSON<AIAnalysis[]>(`/api/mri/runs/${runId}/ai-analyses`),
        fetchJSON<FlakeResult[]>(`/api/mri/runs/${runId}/flake-results`),
      ]);
      setConvergence(conv);
      setVisualDiffs(vis);
      setBackendResults(backend);
      setAiAnalyses(ai);
      setFlakeResults(flakes);
    } catch {
      // Partial data is fine — individual endpoints may not have data yet
    }
  }, []);

  // Fetch iteration detail
  useEffect(() => {
    if (!selectedRunId || selectedIteration <= 0) {
      setIteration(null);
      return;
    }
    fetchJSON<MRIIteration>(`/api/mri/runs/${selectedRunId}/iteration/${selectedIteration}`)
      .then(setIteration)
      .catch(() => setIteration(null));
  }, [selectedRunId, selectedIteration]);

  // Fetch baselines
  const fetchBaselines = useCallback(async () => {
    try {
      setBaselines(await fetchJSON<BaselineEntry[]>("/api/mri/baselines"));
    } catch { /* no baselines yet */ }
  }, []);

  // Initial fetch
  useEffect(() => {
    if (autoFetch) {
      fetchTopLevel();
      fetchBaselines();
    }
  }, [autoFetch, fetchTopLevel, fetchBaselines]);

  // Fetch run detail when run changes
  useEffect(() => {
    if (selectedRunId) fetchRunDetail(selectedRunId);
  }, [selectedRunId, fetchRunDetail]);

  // Polling
  useEffect(() => {
    if (pollInterval > 0) {
      pollRef.current = setInterval(fetchTopLevel, pollInterval);
      return () => clearInterval(pollRef.current);
    }
  }, [pollInterval, fetchTopLevel]);

  // Actions
  const refresh = useCallback(() => {
    setLoading(true);
    fetchTopLevel();
    fetchBaselines();
    if (selectedRunId) fetchRunDetail(selectedRunId);
  }, [fetchTopLevel, fetchBaselines, fetchRunDetail, selectedRunId]);

  const acceptBaseline = useCallback(async (testName: string) => {
    try {
      const res = await fetch(`${API}/api/mri/baselines/${encodeURIComponent(testName)}`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to accept baseline");
    }
    fetchBaselines();
    if (selectedRunId) fetchRunDetail(selectedRunId);
  }, [fetchBaselines, fetchRunDetail, selectedRunId]);

  const acceptAllBaselines = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/mri/baselines/accept-all`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to accept all baselines");
    }
    fetchBaselines();
    if (selectedRunId) fetchRunDetail(selectedRunId);
  }, [fetchBaselines, fetchRunDetail, selectedRunId]);

  // Start scan elapsed timer
  const startScanTimer = useCallback(() => {
    setScanning(true);
    const start = Date.now();
    setScanElapsed(0);
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    scanTimerRef.current = setInterval(() => {
      setScanElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
  }, []);

  const stopScanTimer = useCallback(() => {
    setScanning(false);
    setScanElapsed(0);
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = undefined;
    }
  }, []);

  // On mount + after each top-level fetch: check if a scan is already active (page nav / server restart recovery)
  useEffect(() => {
    if (status?.active && !scanning) {
      startScanTimer();
      // Start polling for completion
      const poll = setInterval(async () => {
        try {
          const s = await fetchJSON<MRIStatus>(`/api/mri/status`);
          if (!s?.active) {
            clearInterval(poll);
            stopScanTimer();
            fetchTopLevel();
          }
        } catch { /* ignore */ }
      }, 3000);
      return () => clearInterval(poll);
    } else if (!status?.active && scanning) {
      stopScanTimer();
    }
  }, [status?.active]);

  const triggerRun = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/mri/run`, { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setError(null);
      startScanTimer();
      // Clear any existing scan poll
      if (scanPollRef.current) clearInterval(scanPollRef.current);
      // Poll for completion
      scanPollRef.current = setInterval(async () => {
        try {
          const s = await fetchJSON<MRIStatus>(`/api/mri/status`);
          setStatus(s);
          if (!s?.active) {
            if (scanPollRef.current) clearInterval(scanPollRef.current);
            scanPollRef.current = undefined;
            stopScanTimer();
            fetchTopLevel();
          }
        } catch { /* ignore */ }
      }, 3000);
      // Safety timeout: stop polling after 5 minutes
      setTimeout(() => {
        if (scanPollRef.current) {
          clearInterval(scanPollRef.current);
          scanPollRef.current = undefined;
        }
        stopScanTimer();
      }, 300_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to trigger MRI scan");
      stopScanTimer();
    }
  }, [fetchTopLevel, startScanTimer, stopScanTimer]);

  const triggerApiTests = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/mri/api-tests/run`, { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setError(null);
      setTimeout(fetchTopLevel, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to trigger API tests");
    }
  }, [fetchTopLevel]);

  return {
    runs, status, selectedRunId, setSelectedRunId,
    convergence, iteration, selectedIteration, setSelectedIteration,
    visualDiffs, baselines, backendResults, aiAnalyses, flakeResults,
    refresh, acceptBaseline, acceptAllBaselines, triggerRun, triggerApiTests,
    loading, scanning, scanElapsed, error,
  };
}
