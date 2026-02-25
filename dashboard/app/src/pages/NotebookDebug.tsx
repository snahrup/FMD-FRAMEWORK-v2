import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play, Loader2, AlertCircle, CheckCircle2, Database,
  Bug, RefreshCw, Filter, Hash, Clock, ChevronDown,
  Terminal, Layers, Zap, XCircle, FileCode,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API = "http://localhost:8787/api";

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
  jobs?: Array<{
    id: string;
    status: string;
    startTime: string;
    endTime: string;
    failureReason?: { message: string; errorCode: string };
  }>;
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

export default function NotebookDebug() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedNb, setSelectedNb] = useState("");
  const [layer, setLayer] = useState<"bronze" | "silver" | "landing">("bronze");
  const [maxEntities, setMaxEntities] = useState(5);
  const [dsFilter, setDsFilter] = useState("");
  const [chunkMode, setChunkMode] = useState<"" | "batch">("");
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [totalEntities, setTotalEntities] = useState(0);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobStatus["jobs"]>([]);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load notebooks on mount
  useEffect(() => {
    fetch(`${API}/notebook-debug/notebooks`)
      .then((r) => r.json())
      .then((data) => {
        if (data.notebooks) setNotebooks(data.notebooks);
        // Auto-select NB_FMD_PROCESSING_PARALLEL_MAIN if present
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
      if (data.error) {
        setError(data.error);
        return;
      }
      setEntities(data.entities || []);
      setTotalEntities(data.totalCount || 0);
      // Get unique namespaces for filter
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load entities");
    } finally {
      setLoading(false);
    }
  }, [layer]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  // Poll job status
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = useCallback(
    (notebookId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `${API}/notebook-debug/job-status?notebookId=${notebookId}`
          );
          const data = await res.json();
          if (data.jobs && data.jobs.length > 0) {
            setRecentJobs(data.jobs);
            const latest = data.jobs[0];
            setJobStatus({
              status: latest.status,
              startTime: latest.startTime,
              endTime: latest.endTime,
              failureReason: latest.failureReason,
            });
            if (
              latest.status === "Completed" ||
              latest.status === "Failed" ||
              latest.status === "Cancelled"
            ) {
              setRunning(false);
              if (pollRef.current) clearInterval(pollRef.current);
            }
          }
        } catch {
          // Ignore polling errors
        }
      }, 5000);
    },
    []
  );

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
      if (data.error) {
        setError(data.error);
        setRunning(false);
        return;
      }
      setRunResult(data);
      startPolling(selectedNb);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to trigger run");
      setRunning(false);
    }
  };

  // Filtered entities for preview
  const filteredEntities = dsFilter
    ? entities.filter((e) => e.namespace === dsFilter)
    : entities;
  const previewEntities = filteredEntities.slice(
    0,
    maxEntities > 0 ? maxEntities : undefined
  );

  // Unique namespaces for filter dropdown
  const namespaces = [...new Set(entities.map((e) => e.namespace))].sort();

  const statusColor = (s: string) => {
    if (s === "Completed") return "text-emerald-400";
    if (s === "Failed") return "text-red-400";
    if (s === "InProgress" || s === "Running") return "text-amber-400";
    if (s === "Cancelled") return "text-gray-400";
    return "text-slate-400";
  };

  const statusIcon = (s: string) => {
    if (s === "Completed")
      return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    if (s === "Failed") return <XCircle className="w-4 h-4 text-red-400" />;
    if (s === "InProgress" || s === "Running")
      return <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />;
    return <Clock className="w-4 h-4 text-slate-400" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bug className="w-6 h-6 text-amber-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Notebook Debug Runner</h1>
          <p className="text-sm text-slate-400">
            Run notebooks directly with controlled parameters. Bypass the pipeline for fast iteration.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-300">{error}</span>
          <button onClick={() => setError("")} className="ml-auto text-red-400 hover:text-red-300">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <Card className="bg-slate-900/50 border-slate-700 lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-slate-200 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-blue-400" />
              Run Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Notebook Selection */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Notebook</label>
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white"
                value={selectedNb}
                onChange={(e) => setSelectedNb(e.target.value)}
              >
                <option value="">Select notebook...</option>
                {notebooks.map((nb) => (
                  <option key={nb.id} value={nb.id}>
                    {nb.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Layer */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Entity Layer</label>
              <div className="flex gap-2">
                {(["landing", "bronze", "silver"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLayer(l)}
                    className={cn(
                      "flex-1 py-1.5 px-2 rounded text-xs font-medium transition",
                      layer === l
                        ? l === "landing"
                          ? "bg-slate-600 text-white"
                          : l === "bronze"
                          ? "bg-amber-600 text-white"
                          : "bg-purple-600 text-white"
                        : "bg-slate-800 text-slate-400 hover:text-white"
                    )}
                  >
                    {l.charAt(0).toUpperCase() + l.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Data Source Filter */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                <Filter className="w-3 h-3 inline mr-1" />
                Data Source Filter
              </label>
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white"
                value={dsFilter}
                onChange={(e) => setDsFilter(e.target.value)}
              >
                <option value="">All Data Sources</option>
                {namespaces.map((ns) => (
                  <option key={ns} value={ns}>
                    {ns} ({entities.filter((e) => e.namespace === ns).length})
                  </option>
                ))}
              </select>
            </div>

            {/* Max Entities */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                <Hash className="w-3 h-3 inline mr-1" />
                Max Entities
              </label>
              <div className="flex gap-2 flex-wrap">
                {[1, 5, 10, 25, 50, 0].map((n) => (
                  <button
                    key={n}
                    onClick={() => setMaxEntities(n)}
                    className={cn(
                      "px-3 py-1.5 rounded text-xs font-mono transition",
                      maxEntities === n
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-400 hover:text-white"
                    )}
                  >
                    {n === 0 ? "ALL" : n}
                  </button>
                ))}
              </div>
            </div>

            {/* Chunk Mode */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                <Layers className="w-3 h-3 inline mr-1" />
                Chunk Mode
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setChunkMode("")}
                  className={cn(
                    "flex-1 py-1.5 px-2 rounded text-xs font-medium transition",
                    chunkMode === ""
                      ? "bg-blue-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:text-white"
                  )}
                >
                  Auto (chunking if &gt;50)
                </button>
                <button
                  onClick={() => setChunkMode("batch")}
                  className={cn(
                    "flex-1 py-1.5 px-2 rounded text-xs font-medium transition",
                    chunkMode === "batch"
                      ? "bg-amber-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:text-white"
                  )}
                >
                  Batch (direct runMultiple)
                </button>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-slate-800/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Available entities:</span>
                <span className="text-white font-mono">
                  {loading ? "..." : filteredEntities.length}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Will process:</span>
                <span className="text-amber-400 font-mono font-bold">
                  {loading
                    ? "..."
                    : maxEntities > 0
                    ? Math.min(maxEntities, filteredEntities.length)
                    : filteredEntities.length}
                </span>
              </div>
            </div>

            {/* Run Button */}
            <Button
              className="w-full"
              disabled={!selectedNb || running || loading}
              onClick={handleRun}
              variant={running ? "outline" : "default"}
            >
              {running ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Run Notebook
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Entity Preview + Results */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Run Status */}
          {runResult && (
            <Card className="bg-slate-900/50 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  Active Run
                  {jobStatus && (
                    <span
                      className={cn(
                        "ml-auto text-sm font-mono",
                        statusColor(jobStatus.status)
                      )}
                    >
                      {statusIcon(jobStatus.status)}
                      <span className="ml-1">{jobStatus.status}</span>
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <div className="bg-slate-800 rounded p-2">
                    <div className="text-xs text-slate-400">Entities</div>
                    <div className="text-lg font-mono text-white">
                      {runResult.entityCount}
                      {runResult.originalCount !== runResult.entityCount && (
                        <span className="text-xs text-slate-500">
                          /{runResult.originalCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded p-2">
                    <div className="text-xs text-slate-400">Chunk Mode</div>
                    <div className="text-sm font-mono text-white">{runResult.chunkMode}</div>
                  </div>
                  <div className="bg-slate-800 rounded p-2">
                    <div className="text-xs text-slate-400">Filter</div>
                    <div className="text-sm font-mono text-white">
                      {runResult.dataSourceFilter || "none"}
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded p-2">
                    <div className="text-xs text-slate-400">Job ID</div>
                    <div className="text-xs font-mono text-slate-300 truncate">
                      {runResult.jobInstanceId}
                    </div>
                  </div>
                </div>
                {jobStatus?.failureReason && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                    <div className="text-xs text-red-400 font-medium mb-1">
                      {jobStatus.failureReason.errorCode || "Error"}
                    </div>
                    <div className="text-sm text-red-300 font-mono">
                      {jobStatus.failureReason.message}
                    </div>
                  </div>
                )}
                {jobStatus?.startTime && (
                  <div className="flex gap-4 text-xs text-slate-400 mt-2">
                    <span>
                      Started: {new Date(jobStatus.startTime).toLocaleTimeString()}
                    </span>
                    {jobStatus.endTime && (
                      <span>
                        Ended: {new Date(jobStatus.endTime).toLocaleTimeString()}
                      </span>
                    )}
                    {jobStatus.startTime && jobStatus.endTime && (
                      <span>
                        Duration:{" "}
                        {Math.round(
                          (new Date(jobStatus.endTime).getTime() -
                            new Date(jobStatus.startTime).getTime()) /
                            1000
                        )}
                        s
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Recent Jobs */}
          {recentJobs && recentJobs.length > 0 && (
            <Card className="bg-slate-900/50 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  Recent Jobs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {recentJobs.map((job, i) => (
                    <div
                      key={job.id || i}
                      className="flex items-center gap-3 py-1.5 px-2 rounded bg-slate-800/50 text-xs"
                    >
                      {statusIcon(job.status)}
                      <span className={cn("font-medium", statusColor(job.status))}>
                        {job.status}
                      </span>
                      <span className="text-slate-500 font-mono">
                        {job.startTime
                          ? new Date(job.startTime).toLocaleTimeString()
                          : "—"}
                      </span>
                      {job.endTime && job.startTime && (
                        <span className="text-slate-500">
                          ({Math.round(
                            (new Date(job.endTime).getTime() -
                              new Date(job.startTime).getTime()) /
                              1000
                          )}s)
                        </span>
                      )}
                      {job.failureReason && (
                        <span className="text-red-400 truncate flex-1">
                          {job.failureReason.message?.slice(0, 80)}
                        </span>
                      )}
                      <span className="text-slate-600 font-mono ml-auto">
                        {job.id?.slice(0, 8)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Entity Preview Table */}
          <Card className="bg-slate-900/50 border-slate-700">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-400" />
                  Entity Preview
                  <span className="text-xs text-slate-500 font-normal ml-1">
                    (showing {previewEntities.length} of {filteredEntities.length})
                  </span>
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadEntities}
                  className="text-slate-400"
                >
                  <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 text-slate-400 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading entities...
                </div>
              ) : previewEntities.length === 0 ? (
                <div className="text-slate-500 py-4 text-sm">No entities found</div>
              ) : (
                <div className="overflow-auto max-h-[400px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-900">
                      <tr className="text-slate-400">
                        <th className="text-left py-1 px-2">#</th>
                        <th className="text-left py-1 px-2">Namespace</th>
                        <th className="text-left py-1 px-2">Schema</th>
                        <th className="text-left py-1 px-2">Table</th>
                        <th className="text-left py-1 px-2">File</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewEntities.map((e, i) => (
                        <tr
                          key={i}
                          className="border-t border-slate-800 hover:bg-slate-800/50"
                        >
                          <td className="py-1 px-2 text-slate-500 font-mono">{i + 1}</td>
                          <td className="py-1 px-2 text-blue-300 font-mono">
                            {e.namespace}
                          </td>
                          <td className="py-1 px-2 text-slate-300">{e.schema}</td>
                          <td className="py-1 px-2 text-white font-medium">{e.table}</td>
                          <td className="py-1 px-2 text-slate-400 truncate max-w-[200px]">
                            {e.fileName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
