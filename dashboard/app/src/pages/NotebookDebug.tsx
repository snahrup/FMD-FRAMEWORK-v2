import { useState, useEffect, useCallback, useRef } from "react";
import {
  Play, Loader2, AlertCircle, CheckCircle2, Database,
  RefreshCw, Clock, XCircle, ChevronDown, ChevronRight,
  Timer, Activity, AlertTriangle, Layers, Zap,
  ArrowRight, Server, FlaskConical, Settings2, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API = "http://localhost:8787/api";

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

const LAYER_INFO: Record<string, { label: string; description: string; color: string; step: number }> = {
  landing: {
    label: "Extract from Source",
    description: "Pull raw data from SQL databases into the Landing Zone",
    color: "blue",
    step: 1,
  },
  bronze: {
    label: "Load to Bronze",
    description: "Move landing zone data into structured Bronze tables",
    color: "amber",
    step: 2,
  },
  silver: {
    label: "Transform to Silver",
    description: "Apply business rules and SCD Type 2 transformations",
    color: "purple",
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
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
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

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showEntityPreview, setShowEntityPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Load notebooks on mount
  useEffect(() => {
    fetch(`${API}/notebook-debug/notebooks`)
      .then((r) => r.json())
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
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setEntities(data.entities || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load entities");
    } finally {
      setLoading(false);
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
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">
            Pipeline Testing
          </h1>
          <p className="text-muted-foreground mt-1">
            Validate your data pipeline by running individual processing steps on a controlled set of tables
          </p>
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="rounded-lg p-4 flex items-center justify-between bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
          </div>
          <button onClick={() => setError("")} className="text-muted-foreground hover:text-foreground text-sm">Dismiss</button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
           STEP 1 — What do you want to test?
         ════════════════════════════════════════════════════════ */}
      <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/20 dark:to-slate-900/10 rounded-xl border border-slate-200/50 dark:border-slate-800/30 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          What do you want to test?
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
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
                className={cn(
                  "relative text-left p-4 rounded-xl border transition-all",
                  isActive
                    ? `bg-${info.color}-50 dark:bg-${info.color}-950/20 border-${info.color}-300 dark:border-${info.color}-700/50 shadow-sm`
                    : "bg-card border-border hover:border-muted-foreground/30"
                )}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold",
                    isActive
                      ? `bg-${info.color}-100 dark:bg-${info.color}-900/40 text-${info.color}-700 dark:text-${info.color}-300`
                      : "bg-muted text-muted-foreground"
                  )}>
                    {info.step}
                  </div>
                  <span className={cn(
                    "text-sm font-semibold",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {info.label}
                  </span>
                </div>
                <p className={cn(
                  "text-xs leading-relaxed",
                  isActive ? "text-muted-foreground" : "text-muted-foreground/70"
                )}>
                  {info.description}
                </p>
                {isActive && (
                  <div className={`absolute top-3 right-3 w-2 h-2 rounded-full bg-${info.color}-500 dark:bg-${info.color}-400`} />
                )}
              </button>
            );
          })}
        </div>

        {/* Data Source + Table Count — side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          {/* Data Source */}
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block font-medium">
              Data Source
            </label>
            <select
              className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={dsFilter}
              onChange={(e) => setDsFilter(e.target.value)}
            >
              <option value="">All sources ({entities.length} tables)</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>
                  {ns.toUpperCase()} ({entities.filter((e) => e.namespace === ns).length} tables)
                </option>
              ))}
            </select>
          </div>

          {/* How many tables */}
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block font-medium">
              How many tables to test?
            </label>
            <div className="flex gap-1.5">
              {[1, 5, 10, 25, 50, 0].map((n) => (
                <button
                  key={n}
                  onClick={() => setMaxEntities(n)}
                  className={cn(
                    "flex-1 py-2.5 rounded-lg text-xs font-medium transition-all border text-center",
                    maxEntities === n
                      ? "bg-primary/10 text-primary border-primary/30 font-semibold"
                      : "bg-muted text-muted-foreground border-border hover:text-foreground"
                  )}
                >
                  {n === 0 ? "All" : n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* What will happen — plain English summary */}
        <div className="rounded-lg bg-muted/40 border border-border p-4 mb-5">
          <p className="text-sm text-foreground">
            {loading ? (
              <span className="text-muted-foreground">Loading...</span>
            ) : (
              <>
                This will <strong>{layerInfo.label.toLowerCase()}</strong> for{" "}
                <strong className="text-primary">{willProcess} table{willProcess !== 1 ? "s" : ""}</strong>
                {dsFilter && (
                  <> from <strong>{dsFilter.toUpperCase()}</strong></>
                )}
                {!dsFilter && <> across all data sources</>}.
                {willProcess > 50 && (
                  <span className="text-muted-foreground"> Tables will be processed in batches of 50.</span>
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
              ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/30 cursor-wait"
              : !selectedNb || loading
              ? "bg-muted text-muted-foreground border border-border cursor-not-allowed opacity-50"
              : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
          )}
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
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-3 transition-colors"
        >
          <Settings2 className="w-3 h-3" />
          Advanced options
          {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>

        {showAdvanced && (
          <div className="mt-3 pt-3 border-t border-border space-y-3">
            {/* Notebook Override */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notebook</label>
              <select
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
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
              <label className="text-xs text-muted-foreground mb-1 block">Processing mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setChunkMode("")}
                  className={cn(
                    "flex-1 py-1.5 px-3 rounded-lg text-xs transition-all border",
                    chunkMode === ""
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-muted text-muted-foreground border-border hover:text-foreground"
                  )}
                >
                  Auto (chunked if &gt;50)
                </button>
                <button
                  onClick={() => setChunkMode("batch")}
                  className={cn(
                    "flex-1 py-1.5 px-3 rounded-lg text-xs transition-all border",
                    chunkMode === "batch"
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-muted text-muted-foreground border-border hover:text-foreground"
                  )}
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
        <div className={cn(
          "rounded-xl border p-6 shadow-sm transition-all",
          isComplete && "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30",
          isFailed && "bg-red-50 dark:bg-red-950/20 border-red-200/50 dark:border-red-800/30",
          isRunning && "bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30",
          !isComplete && !isFailed && !isRunning && "bg-card border-border"
        )}>
          {/* Big status headline */}
          <div className="flex items-center gap-4 mb-4">
            {isComplete && (
              <>
                <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-emerald-800 dark:text-emerald-300">
                    Test passed
                  </h3>
                  <p className="text-sm text-emerald-700 dark:text-emerald-400/80">
                    {runResult.entityCount} table{runResult.entityCount !== 1 ? "s" : ""} processed successfully
                    {durationMs != null && <> in {friendlyDuration(durationMs)}</>}
                  </p>
                </div>
              </>
            )}
            {isFailed && (
              <>
                <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                  <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-red-800 dark:text-red-300">
                    Test failed
                  </h3>
                  <p className="text-sm text-red-700 dark:text-red-400/80">
                    The pipeline encountered an error after {durationMs != null ? friendlyDuration(durationMs) : "running"}
                  </p>
                </div>
              </>
            )}
            {isRunning && (
              <>
                <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-amber-600 dark:text-amber-400 animate-spin" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-300">
                    Running...
                  </h3>
                  <p className="text-sm text-amber-700 dark:text-amber-400/80">
                    Processing {runResult.entityCount} table{runResult.entityCount !== 1 ? "s" : ""}
                    {jobStatus?.startTime && <> — started at {friendlyTime(jobStatus.startTime)}</>}
                  </p>
                </div>
              </>
            )}
            {!isComplete && !isFailed && !isRunning && jobStatus && (
              <>
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <Clock className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{jobStatus.status}</h3>
                  <p className="text-sm text-muted-foreground">Waiting for Fabric to process the request...</p>
                </div>
              </>
            )}
          </div>

          {/* Error details — in plain language */}
          {jobStatus?.failureReason && (
            <div className="rounded-lg bg-red-100/50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-800/30 p-4 mb-4">
              <p className="text-sm text-red-800 dark:text-red-300 font-medium mb-1">
                What went wrong
              </p>
              <p className="text-sm text-red-700 dark:text-red-400">
                {jobStatus.failureReason.message === "Job instance failed without detail error"
                  ? "The Fabric notebook failed to execute. This usually means the notebook couldn't connect to the SQL database, the Spark session failed to start, or a required variable library is misconfigured."
                  : jobStatus.failureReason.message}
              </p>
              <p className="text-xs text-red-600/60 dark:text-red-400/40 mt-2 font-mono">
                Error code: {jobStatus.failureReason.errorCode || "unknown"}
              </p>
            </div>
          )}

          {/* Technical details — collapsible */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Technical details
            {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>

          {showAdvanced && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Tables", value: `${runResult.entityCount}${runResult.originalCount !== runResult.entityCount ? ` / ${runResult.originalCount}` : ""}` },
                { label: "Mode", value: runResult.chunkMode || "auto" },
                { label: "Source", value: runResult.dataSourceFilter || "all" },
                { label: "Job ID", value: runResult.jobInstanceId?.slice(0, 12) + "..." },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-muted/30 border border-border p-3">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{item.label}</div>
                  <div className="text-xs font-mono text-foreground mt-1 truncate">{item.value}</div>
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
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/10 transition-colors"
          >
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Run History
              <span className="text-xs text-muted-foreground font-normal">({recentJobs.length} recent)</span>
            </h3>
            {showHistory ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </button>

          {showHistory && (
            <div className="border-t border-border divide-y divide-border/50">
              {recentJobs.map((job, i) => {
                const dur = (job.startTime && job.endTime)
                  ? friendlyDuration(new Date(job.endTime).getTime() - new Date(job.startTime).getTime())
                  : null;
                return (
                  <div
                    key={job.id || i}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors"
                  >
                    {job.status === "Completed" && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />}
                    {job.status === "Failed" && <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />}
                    {(job.status === "InProgress" || job.status === "Running") && <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />}
                    {!["Completed", "Failed", "InProgress", "Running"].includes(job.status) && <Clock className="w-4 h-4 text-muted-foreground shrink-0" />}

                    <span className={cn(
                      "text-xs font-medium min-w-[60px]",
                      job.status === "Completed" && "text-emerald-600 dark:text-emerald-400",
                      job.status === "Failed" && "text-red-600 dark:text-red-400",
                      (job.status === "InProgress" || job.status === "Running") && "text-amber-600 dark:text-amber-400",
                    )}>
                      {job.status === "Completed" ? "Passed" : job.status === "Failed" ? "Failed" : job.status}
                    </span>

                    <span className="text-xs text-muted-foreground">
                      {job.startTime ? friendlyTime(job.startTime) : "—"}
                    </span>

                    {dur && (
                      <span className="text-xs text-muted-foreground">({dur})</span>
                    )}

                    {job.failureReason && (
                      <span className="text-xs text-red-600 dark:text-red-400 truncate flex-1">
                        {job.failureReason.message === "Job instance failed without detail error"
                          ? "Notebook execution failed"
                          : job.failureReason.message?.slice(0, 60)}
                      </span>
                    )}

                    <span className="text-[10px] text-muted-foreground font-mono ml-auto">
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
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          onClick={() => setShowEntityPreview(!showEntityPreview)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/10 transition-colors"
        >
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Database className="w-4 h-4 text-muted-foreground" />
            Tables Included in Test
            <span className="text-xs text-muted-foreground font-normal">
              ({previewEntities.length} of {filteredEntities.length})
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); loadEntities(); }}
              className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            </button>
            {showEntityPreview ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>

        {showEntityPreview && (
          <div className="border-t border-border">
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8 px-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading...</span>
              </div>
            ) : previewEntities.length === 0 ? (
              <div className="text-muted-foreground py-8 text-sm text-center">
                No tables found for the selected layer and source
              </div>
            ) : (
              <div className="overflow-auto max-h-[400px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-muted/60">
                    <tr>
                      <th className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">#</th>
                      <th className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Source</th>
                      <th className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Schema</th>
                      <th className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Table</th>
                      <th className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">File</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {previewEntities.map((e, i) => (
                      <tr key={i} className="hover:bg-muted/10 transition-colors">
                        <td className="px-3 py-2.5 text-muted-foreground font-mono">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs px-2 py-0.5 rounded border text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 border-blue-200/50 dark:border-blue-800/30">
                            {e.namespace}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-foreground">{e.schema}</td>
                        <td className="px-3 py-2.5 text-foreground font-medium">{e.table}</td>
                        <td className="px-3 py-2.5 text-muted-foreground font-mono truncate max-w-[200px]">{e.fileName}</td>
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
