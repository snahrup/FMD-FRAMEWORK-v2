import { useState, useEffect, useCallback, useRef } from "react";
import {
  Play, Loader2, AlertCircle, CheckCircle2, Database,
  RefreshCw, Clock, XCircle, ChevronDown, ChevronRight,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API = "/api";

// ── Types ──

interface Notebook {
  id: string;
  name: string;
}

interface EntitySummary {
  namespace: string;
  schema: string;
  table: string;
  fileName: string;
}

interface JobStatus {
  status: string;
  percentComplete?: number;
  startTime?: string;
  endTime?: string;
  error?: unknown;
  failureReason?: { message: string; errorCode: string };
  jobs?: JobEntry[];
}

interface JobEntry {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  failureReason?: { message: string; errorCode: string };
}

interface RunResult {
  success: boolean;
  jobInstanceId: string;
  notebookId: string;
  workspaceId: string;
  entityCount: number;
  originalCount: number;
  dataSourceFilter: string | null;
  chunkMode: string;
  error?: string;
}

// ── Helpers ──

const LAYER_INFO: Record<string, {
  label: string; description: string; step: number;
}> = {
  landing: {
    label: "Extract from Source",
    description: "Pull raw data from SQL databases into the Landing Zone",
    step: 1,
  },
  bronze: {
    label: "Load to Bronze",
    description: "Move landing zone data into structured Bronze tables",
    step: 2,
  },
  silver: {
    label: "Transform to Silver",
    description: "Apply business rules and SCD Type 2 transformations",
    step: 3,
  },
};

function friendlyDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function friendlyTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

// ── Component ──

export default function NotebookDebug() {
  // Data state
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedNb, setSelectedNb] = useState("");
  const [layer, setLayer] = useState<"bronze" | "silver" | "landing">("bronze");
  const [maxEntities, setMaxEntities] = useState(5);
  const [dsFilter, setDsFilter] = useState("");
  const [chunkMode, setChunkMode] = useState<"" | "batch">("");
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobEntry[]>([]);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasLoadedOnce = useRef(false);

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showEntityPreview, setShowEntityPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Load notebooks on mount
  useEffect(() => {
    fetch(`${API}/notebook-debug/notebooks`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load notebooks (${r.status})`);
        return r.json();
      })
      .then((data) => {
        if (data.notebooks) setNotebooks(data.notebooks);
        const main = data.notebooks?.find(
          (n: Notebook) => n.name === "NB_FMD_PROCESSING_PARALLEL_MAIN"
        );
        if (main) setSelectedNb(main.id);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Load entities when layer changes
  const loadEntities = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/notebook-debug/entities?layer=${layer}`);
      if (!res.ok) throw new Error(`Failed to load entities (${res.status})`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setEntities(data.entities || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load entities");
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true;
    }
  }, [layer]);

  useEffect(() => { loadEntities(); }, [loadEntities]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ── Polling ──

  const startPolling = useCallback(
    (notebookId: string, jobInstanceId?: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const params = jobInstanceId
            ? `jobId=${jobInstanceId}&notebookId=${notebookId}`
            : `notebookId=${notebookId}`;
          const res = await fetch(`${API}/notebook-debug/job-status?${params}`);
          if (!res.ok) throw new Error(`Job status poll failed (${res.status})`);
          const data = await res.json();

          if (data.jobs && data.jobs.length > 0) {
            setRecentJobs(data.jobs);
            const latest = data.jobs[0];
            setJobStatus({ status: latest.status, startTime: latest.startTime, endTime: latest.endTime, failureReason: latest.failureReason });
            if (["Completed", "Failed", "Cancelled"].includes(latest.status)) {
              setRunning(false);
              if (pollRef.current) clearInterval(pollRef.current);
            }
          } else if (data.status) {
            setJobStatus({ status: data.status, startTime: data.startTime, endTime: data.endTime, failureReason: data.failureReason });
            if (["Completed", "Failed", "Cancelled"].includes(data.status)) {
              setRunning(false);
              if (pollRef.current) clearInterval(pollRef.current);
              fetch(`${API}/notebook-debug/job-status?notebookId=${notebookId}`)
                .then((r) => r.json())
                .then((d) => { if (d.jobs) setRecentJobs(d.jobs); })
                .catch(() => {});
            }
          }
        } catch { /* ignore */ }
      }, 5000);
    }, []
  );

  // ── Run Handler ──

  const handleRun = async () => {
    setRunning(true);
    setError("");
    setRunResult(null);
    setJobStatus(null);
    setRecentJobs([]);

    try {
      const res = await fetch(`${API}/notebook-debug/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId: selectedNb,
          layer,
          maxEntities: maxEntities || 0,
          dataSourceFilter: dsFilter,
          chunkMode,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Trigger failed (${res.status})`);
      }
      const data = await res.json();
      if (data.error) { setError(data.error); setRunning(false); return; }
      setRunResult(data);
      startPolling(selectedNb, data.jobInstanceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to trigger run");
      setRunning(false);
    }
  };

  // ── Derived data ──

  const filteredEntities = dsFilter
    ? entities.filter((e) => e.namespace === dsFilter)
    : entities;
  const previewEntities = filteredEntities.slice(0, maxEntities > 0 ? maxEntities : undefined);
  const namespaces = [...new Set(entities.map((e) => e.namespace))].sort();
  const willProcess = loading ? 0 : maxEntities > 0 ? Math.min(maxEntities, filteredEntities.length) : filteredEntities.length;
  const layerInfo = LAYER_INFO[layer];

  // Status helpers
  const isComplete = jobStatus?.status === "Completed";
  const isFailed = jobStatus?.status === "Failed";
  const isRunning = jobStatus?.status === "InProgress" || jobStatus?.status === "Running";

  const durationMs = (jobStatus?.startTime && jobStatus?.endTime)
    ? new Date(jobStatus.endTime).getTime() - new Date(jobStatus.startTime).getTime()
    : null;

  return (
    <div className="space-y-6" style={{ padding: '32px', maxWidth: '1280px' }}>
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 style={{ fontFamily: 'var(--bp-font-display)', fontSize: '32px', color: 'var(--bp-ink-primary)' }}>
            Pipeline Testing
          </h1>
          <p className="mt-1" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            Validate your data pipeline by running individual processing steps on a controlled set of tables
          </p>
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="rounded-lg p-4 flex items-center justify-between" style={{ background: 'var(--bp-fault-light)', border: '1px solid var(--bp-fault)' }}>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0" style={{ color: 'var(--bp-fault)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--bp-fault)' }}>{error}</p>
          </div>
          <button onClick={() => setError("")} className="text-sm" style={{ color: 'var(--bp-ink-muted)' }}>Dismiss</button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
           STEP 1 — What do you want to test?
         ════════════════════════════════════════════════════════ */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
        <h2 className="mb-1" style={{ fontFamily: 'var(--bp-font-body)', fontSize: '18px', fontWeight: 600, color: 'var(--bp-ink-primary)' }}>
          What do you want to test?
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
          Choose which step of the data pipeline to run, and how many tables to include
        </p>

        {/* Pipeline Step Selection */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          {(["landing", "bronze", "silver"] as const).map((l) => {
            const info = LAYER_INFO[l];
            const isActive = layer === l;
            return (
              <button
                key={l}
                onClick={() => setLayer(l)}
                className="relative text-left p-4 rounded-xl transition-all"
                style={{
                  background: isActive ? 'var(--bp-copper-light)' : 'var(--bp-surface-1)',
                  border: isActive ? '1px solid var(--bp-copper)' : '1px solid var(--bp-border)',
                }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                    style={{
                      background: isActive ? 'var(--bp-copper)' : 'var(--bp-surface-inset)',
                      color: isActive ? '#FFFFFF' : 'var(--bp-ink-muted)',
                    }}
                  >
                    {info.step}
                  </div>
                  <span className="text-sm font-semibold" style={{ color: isActive ? 'var(--bp-ink-primary)' : 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
                    {info.label}
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: isActive ? 'var(--bp-ink-secondary)' : 'var(--bp-ink-muted)' }}>
                  {info.description}
                </p>
                {isActive && (
                  <div className="absolute top-3 right-3 w-2 h-2 rounded-full" style={{ background: 'var(--bp-copper)' }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Data Source + Table Count — side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          {/* Data Source */}
          <div>
            <label className="text-xs uppercase tracking-wider mb-2 block font-medium" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
              Data Source
            </label>
            <select
              className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border)', color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}
              value={dsFilter}
              onChange={(e) => setDsFilter(e.target.value)}
            >
              <option value="">All sources ({entities.length} tables)</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>
                  {(ns || "").toUpperCase()} ({entities.filter((e) => e.namespace === ns).length} tables)
                </option>
              ))}
            </select>
          </div>

          {/* How many tables */}
          <div>
            <label className="text-xs uppercase tracking-wider mb-2 block font-medium" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
              How many tables to test?
            </label>
            <div className="flex gap-1.5">
              {[1, 5, 10, 25, 50, 0].map((n) => (
                <button
                  key={n}
                  onClick={() => setMaxEntities(n)}
                  className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-all text-center"
                  style={{
                    background: maxEntities === n ? 'var(--bp-copper-light)' : 'var(--bp-surface-inset)',
                    color: maxEntities === n ? 'var(--bp-copper)' : 'var(--bp-ink-tertiary)',
                    border: maxEntities === n ? '1px solid var(--bp-copper)' : '1px solid var(--bp-border)',
                    fontFamily: 'var(--bp-font-body)',
                    fontWeight: maxEntities === n ? 600 : 500,
                  }}
                >
                  {n === 0 ? "All" : n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* What will happen — plain English summary */}
        <div className="rounded-lg p-4 mb-5" style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border-subtle)' }}>
          <p className="text-sm" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>
            {loading && !hasLoadedOnce.current ? (
              <span style={{ color: 'var(--bp-ink-muted)' }}>Loading...</span>
            ) : loading ? (
              <span style={{ color: 'var(--bp-ink-muted)' }}>Refreshing...</span>
            ) : (
              <>
                This will <strong>{layerInfo.label.toLowerCase()}</strong> for{" "}
                <strong style={{ color: 'var(--bp-copper)' }}>{willProcess} table{willProcess !== 1 ? "s" : ""}</strong>
                {dsFilter && (
                  <> from <strong>{dsFilter.toUpperCase()}</strong></>
                )}
                {!dsFilter && <> across all data sources</>}.
                {willProcess > 50 && (
                  <span style={{ color: 'var(--bp-ink-muted)' }}> Tables will be processed in batches of 50.</span>
                )}
              </>
            )}
          </p>
        </div>

        {/* Run Button */}
        <button
          className={cn(
            "w-full flex items-center justify-center gap-2.5 px-6 py-3.5 text-sm font-medium rounded-lg transition-all",
            running
              ? "cursor-wait"
              : !selectedNb || loading
              ? "cursor-not-allowed opacity-50"
              : "bp-btn-primary"
          )}
          style={
            running
              ? { background: 'var(--bp-caution-light)', color: 'var(--bp-caution)', border: '1px solid var(--bp-caution)' }
              : !selectedNb || loading
              ? { background: 'var(--bp-surface-inset)', color: 'var(--bp-ink-muted)', border: '1px solid var(--bp-border)' }
              : undefined
          }
          disabled={!selectedNb || running || loading}
          onClick={handleRun}
        >
          {running ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Running pipeline test...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run Test
            </>
          )}
        </button>

        {/* Advanced Settings Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs mt-3 transition-colors"
          style={{ color: 'var(--bp-ink-tertiary)' }}
        >
          <Settings2 className="w-3 h-3" />
          Advanced options
          {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>

        {showAdvanced && (
          <div className="mt-3 pt-3 space-y-3" style={{ borderTop: '1px solid var(--bp-border)' }}>
            {/* Notebook Override */}
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--bp-ink-muted)' }}>Notebook</label>
              <select
                className="w-full rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1"
                style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border)', color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-mono)' }}
                value={selectedNb}
                onChange={(e) => setSelectedNb(e.target.value)}
              >
                <option value="">Select notebook...</option>
                {notebooks.map((nb) => (
                  <option key={nb.id} value={nb.id}>{nb.name}</option>
                ))}
              </select>
            </div>

            {/* Processing Mode */}
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--bp-ink-muted)' }}>Processing mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setChunkMode("")}
                  className="flex-1 py-1.5 px-3 rounded-lg text-xs transition-all"
                  style={{
                    background: chunkMode === "" ? 'var(--bp-copper-light)' : 'var(--bp-surface-inset)',
                    color: chunkMode === "" ? 'var(--bp-copper)' : 'var(--bp-ink-tertiary)',
                    border: chunkMode === "" ? '1px solid var(--bp-copper)' : '1px solid var(--bp-border)',
                  }}
                >
                  Auto (chunked if &gt;50)
                </button>
                <button
                  onClick={() => setChunkMode("batch")}
                  className="flex-1 py-1.5 px-3 rounded-lg text-xs transition-all"
                  style={{
                    background: chunkMode === "batch" ? 'var(--bp-copper-light)' : 'var(--bp-surface-inset)',
                    color: chunkMode === "batch" ? 'var(--bp-copper)' : 'var(--bp-ink-tertiary)',
                    border: chunkMode === "batch" ? '1px solid var(--bp-copper)' : '1px solid var(--bp-border)',
                  }}
                >
                  Direct batch
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
           RESULTS — Only shown after a run
         ════════════════════════════════════════════════════════ */}
      {runResult && (
        <div
          className="rounded-xl p-6 transition-all"
          style={{
            background: isComplete ? 'var(--bp-operational-light)' : isFailed ? 'var(--bp-fault-light)' : isRunning ? 'var(--bp-caution-light)' : 'var(--bp-surface-1)',
            border: `1px solid ${isComplete ? 'var(--bp-operational)' : isFailed ? 'var(--bp-fault)' : isRunning ? 'var(--bp-caution)' : 'var(--bp-border)'}`,
          }}
        >
          {/* Big status headline */}
          <div className="flex items-center gap-4 mb-4">
            {isComplete && (
              <>
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--bp-operational-light)' }}>
                  <CheckCircle2 className="w-6 h-6" style={{ color: 'var(--bp-operational)' }} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--bp-operational)' }}>
                    Test passed
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--bp-operational)' }}>
                    {runResult.entityCount} table{runResult.entityCount !== 1 ? "s" : ""} processed successfully
                    {durationMs != null && <> in {friendlyDuration(durationMs)}</>}
                  </p>
                </div>
              </>
            )}
            {isFailed && (
              <>
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--bp-fault-light)' }}>
                  <XCircle className="w-6 h-6" style={{ color: 'var(--bp-fault)' }} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--bp-fault)' }}>
                    Test failed
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--bp-fault)' }}>
                    The pipeline encountered an error after {durationMs != null ? friendlyDuration(durationMs) : "running"}
                  </p>
                </div>
              </>
            )}
            {isRunning && (
              <>
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--bp-caution-light)' }}>
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--bp-caution)' }} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--bp-caution)' }}>
                    Running...
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--bp-caution)' }}>
                    Processing {runResult.entityCount} table{runResult.entityCount !== 1 ? "s" : ""}
                    {jobStatus?.startTime && <> — started at {friendlyTime(jobStatus.startTime)}</>}
                  </p>
                </div>
              </>
            )}
            {!isComplete && !isFailed && !isRunning && jobStatus && (
              <>
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--bp-surface-inset)' }}>
                  <Clock className="w-6 h-6" style={{ color: 'var(--bp-ink-muted)' }} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--bp-ink-primary)' }}>{jobStatus.status}</h3>
                  <p className="text-sm" style={{ color: 'var(--bp-ink-tertiary)' }}>Waiting for Fabric to process the request...</p>
                </div>
              </>
            )}
          </div>

          {/* Error details — in plain language */}
          {jobStatus?.failureReason && (
            <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--bp-fault-light)', border: '1px solid var(--bp-fault)' }}>
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--bp-fault)' }}>
                What went wrong
              </p>
              <p className="text-sm" style={{ color: 'var(--bp-fault)' }}>
                {jobStatus.failureReason.message === "Job instance failed without detail error"
                  ? "The Fabric notebook failed to execute. This usually means the notebook couldn't connect to the SQL database, the Spark session failed to start, or a required variable library is misconfigured."
                  : jobStatus.failureReason.message}
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)' }}>
                Error code: {jobStatus.failureReason.errorCode || "unknown"}
              </p>
            </div>
          )}

          {/* Technical details — collapsible */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: 'var(--bp-ink-tertiary)' }}
          >
            Technical details
            {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>

          {showDetails && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Tables", value: `${runResult.entityCount}${runResult.originalCount !== runResult.entityCount ? ` / ${runResult.originalCount}` : ""}` },
                { label: "Mode", value: runResult.chunkMode || "auto" },
                { label: "Source", value: runResult.dataSourceFilter || "all" },
                { label: "Job ID", value: runResult.jobInstanceId ? runResult.jobInstanceId.slice(0, 12) + "..." : "—" },
              ].map((item) => (
                <div key={item.label} className="rounded-lg p-3" style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border)' }}>
                  <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--bp-ink-muted)' }}>{item.label}</div>
                  <div className="text-xs mt-1 truncate" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-primary)' }}>{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
           RUN HISTORY — Collapsible
         ════════════════════════════════════════════════════════ */}
      {recentJobs.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between px-4 py-3 transition-colors"
          >
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--bp-ink-primary)' }}>
              <Clock className="w-4 h-4" style={{ color: 'var(--bp-ink-muted)' }} />
              Run History
              <span className="text-xs font-normal" style={{ color: 'var(--bp-ink-muted)' }}>({recentJobs.length} recent)</span>
            </h3>
            {showHistory ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--bp-ink-muted)' }} /> : <ChevronRight className="w-4 h-4" style={{ color: 'var(--bp-ink-muted)' }} />}
          </button>

          {showHistory && (
            <div style={{ borderTop: '1px solid var(--bp-border)' }}>
              {recentJobs.map((job, i) => {
                const dur = (job.startTime && job.endTime)
                  ? friendlyDuration(new Date(job.endTime).getTime() - new Date(job.startTime).getTime())
                  : null;
                return (
                  <div
                    key={job.id || i}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors"
                    style={{ borderBottom: '1px solid var(--bp-border-subtle)' }}
                  >
                    {job.status === "Completed" && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--bp-operational)' }} />}
                    {job.status === "Failed" && <XCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--bp-fault)' }} />}
                    {(job.status === "InProgress" || job.status === "Running") && <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: 'var(--bp-caution)' }} />}
                    {!["Completed", "Failed", "InProgress", "Running"].includes(job.status) && <Clock className="w-4 h-4 shrink-0" style={{ color: 'var(--bp-ink-muted)' }} />}

                    <span
                      className="text-xs font-medium min-w-[60px]"
                      style={{
                        color: job.status === "Completed" ? 'var(--bp-operational)' : job.status === "Failed" ? 'var(--bp-fault)' : (job.status === "InProgress" || job.status === "Running") ? 'var(--bp-caution)' : 'var(--bp-ink-tertiary)',
                      }}
                    >
                      {job.status === "Completed" ? "Passed" : job.status === "Failed" ? "Failed" : job.status}
                    </span>

                    <span className="text-xs" style={{ color: 'var(--bp-ink-muted)' }}>
                      {job.startTime ? friendlyTime(job.startTime) : "—"}
                    </span>

                    {dur && (
                      <span className="text-xs" style={{ color: 'var(--bp-ink-muted)' }}>({dur})</span>
                    )}

                    {job.failureReason && (
                      <span className="text-xs truncate flex-1" style={{ color: 'var(--bp-fault)' }}>
                        {job.failureReason.message === "Job instance failed without detail error"
                          ? "Notebook execution failed"
                          : (job.failureReason.message || "Unknown error").slice(0, 60)}
                      </span>
                    )}

                    <span className="text-[10px] ml-auto" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)' }}>
                      {job.id?.slice(0, 8)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
           ENTITY PREVIEW — Collapsible
         ════════════════════════════════════════════════════════ */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
        <button
          onClick={() => setShowEntityPreview(!showEntityPreview)}
          className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        >
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--bp-ink-primary)' }}>
            <Database className="w-4 h-4" style={{ color: 'var(--bp-ink-muted)' }} />
            Tables Included in Test
            <span className="text-xs font-normal" style={{ color: 'var(--bp-ink-muted)' }}>
              ({previewEntities.length} of {filteredEntities.length})
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); loadEntities(); }}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: 'var(--bp-ink-muted)' }}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            </button>
            {showEntityPreview ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--bp-ink-muted)' }} /> : <ChevronRight className="w-4 h-4" style={{ color: 'var(--bp-ink-muted)' }} />}
          </div>
        </button>

        {showEntityPreview && (
          <div style={{ borderTop: '1px solid var(--bp-border)' }}>
            {loading ? (
              <div className="flex items-center gap-2 py-8 px-4 justify-center" style={{ color: 'var(--bp-ink-muted)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading...</span>
              </div>
            ) : previewEntities.length === 0 ? (
              <div className="py-8 text-sm text-center" style={{ color: 'var(--bp-ink-muted)' }}>
                No tables found for the selected layer and source
              </div>
            ) : (
              <div className="overflow-auto max-h-[400px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10" style={{ background: 'var(--bp-surface-inset)' }}>
                    <tr>
                      <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--bp-ink-muted)' }}>#</th>
                      <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--bp-ink-muted)' }}>Source</th>
                      <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--bp-ink-muted)' }}>Schema</th>
                      <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--bp-ink-muted)' }}>Table</th>
                      <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--bp-ink-muted)' }}>File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewEntities.map((e, i) => (
                      <tr key={i} className="transition-colors" style={{ borderBottom: '1px solid var(--bp-border-subtle)' }}>
                        <td className="px-3 py-2.5" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)' }}>{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--bp-copper)', background: 'var(--bp-copper-light)', border: '1px solid var(--bp-border)' }}>
                            {e.namespace}
                          </span>
                        </td>
                        <td className="px-3 py-2.5" style={{ color: 'var(--bp-ink-primary)' }}>{e.schema}</td>
                        <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--bp-ink-primary)' }}>{e.table}</td>
                        <td className="px-3 py-2.5 truncate max-w-[200px]" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)' }}>{e.fileName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
