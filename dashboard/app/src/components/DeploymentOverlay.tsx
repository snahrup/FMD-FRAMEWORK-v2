import { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, XCircle, Server, Database, FolderGit2, Cable } from "lucide-react";

const API = "http://localhost:8787";

interface DeploymentJob {
  id: string;
  status: string;
  startTime: string;
  endTime: string | null;
  failureReason: string | null;
}

interface DeploymentStatus {
  status: "idle" | "running" | "completed" | "failed" | "no_notebook" | "error";
  message?: string;
  job: DeploymentJob | null;
  newWorkspaces: Record<string, string | null> | null;
  newSqlEndpoint: {
    id: string;
    displayName: string;
    server: string;
    database: string;
    connectionString: string;
  } | null;
  newItems: Record<string, number> | null;
}

function formatElapsed(startTime: string): string {
  const start = new Date(startTime + "Z");
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const mins = Math.floor(diffMs / 60000);
  const secs = Math.floor((diffMs % 60000) / 1000);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

const WORKSPACE_LABELS: Record<string, string> = {
  workspace_data: "DATA (Dev)",
  workspace_code: "CODE (Dev)",
  workspace_data_prod: "DATA (Prod)",
  workspace_code_prod: "CODE (Prod)",
  config_workspace: "CONFIG",
};

const PHASE_MESSAGES = [
  "Creating workspaces...",
  "Deploying connections...",
  "Setting up lakehouses...",
  "Deploying SQL database...",
  "Building GUID mapping table...",
  "Importing pipelines (DEV)...",
  "Importing pipelines (PROD)...",
  "Configuring security roles...",
  "Final validation...",
];

export function DeploymentOverlay() {
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [elapsed, setElapsed] = useState("");
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Persist dismissed state in sessionStorage so it survives navigation/re-mounts
  const [dismissed, setDismissedState] = useState(() => {
    try { return sessionStorage.getItem("deployment-overlay-dismissed") === "true"; }
    catch { return false; }
  });
  const setDismissed = (val: boolean) => {
    setDismissedState(val);
    try { if (val) sessionStorage.setItem("deployment-overlay-dismissed", "true"); }
    catch { /* noop */ }
  };

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/api/deployment/status`);
      const data: DeploymentStatus = await resp.json();
      setStatus(data);

      // If a new job appears, clear the dismissed flag so fresh deployments show
      if (data.job?.id) {
        try {
          const prevJobId = sessionStorage.getItem("deployment-overlay-job-id");
          if (prevJobId && prevJobId !== data.job.id) {
            sessionStorage.removeItem("deployment-overlay-dismissed");
            setDismissedState(false);
          }
          sessionStorage.setItem("deployment-overlay-job-id", data.job.id);
        } catch { /* noop */ }
      }

      // Auto-apply config when deployment completes
      if (data.status === "completed" && data.newWorkspaces && !applied && !applying) {
        // Check if we have meaningful new workspace data
        const hasWorkspaces = Object.values(data.newWorkspaces).some(v => v != null);
        if (hasWorkspaces) {
          setApplying(true);
          try {
            const applyResp = await fetch(`${API}/api/deployment/apply-config`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workspaces: data.newWorkspaces,
                sqlEndpoint: data.newSqlEndpoint || {},
              }),
            });
            const result = await applyResp.json();
            if (result.success) {
              setApplied(true);
            }
          } catch {
            // Config apply failed — user can retry from Settings
          } finally {
            setApplying(false);
          }
        }
      }
    } catch {
      // API not reachable — don't show overlay
    }
  }, [applied, applying]);

  // Poll every 15 seconds
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Update elapsed timer every second when running
  useEffect(() => {
    if (status?.status !== "running" || !status.job?.startTime) return;
    const tick = () => setElapsed(formatElapsed(status.job!.startTime));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status?.status, status?.job?.startTime]);

  // Cycle through phase messages
  useEffect(() => {
    if (status?.status !== "running") return;
    const interval = setInterval(() => {
      setPhaseIdx(i => (i + 1) % PHASE_MESSAGES.length);
    }, 12000);
    return () => clearInterval(interval);
  }, [status?.status]);

  // Advance phase based on discovered workspaces
  useEffect(() => {
    if (status?.status !== "running" || !status.newWorkspaces) return;
    const found = Object.values(status.newWorkspaces).filter(v => v != null).length;
    if (found >= 4) setPhaseIdx(i => Math.max(i, 3)); // past workspace creation
    if (found >= 5) setPhaseIdx(i => Math.max(i, 4)); // config workspace found too
  }, [status?.status, status?.newWorkspaces]);

  // Don't show overlay when idle or dismissed
  if (!status || status.status === "idle" || status.status === "no_notebook" || status.status === "error") return null;
  if (dismissed) return null;

  const isRunning = status.status === "running";
  const isCompleted = status.status === "completed";
  const isFailed = status.status === "failed";

  // Count discovered workspaces
  const wsEntries = status.newWorkspaces
    ? Object.entries(status.newWorkspaces).filter(([k]) => k in WORKSPACE_LABELS)
    : [];
  const wsFound = wsEntries.filter(([, v]) => v != null).length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="max-w-lg w-full mx-4 space-y-8">
        {/* Main Status */}
        <div className="text-center space-y-4">
          {isRunning && (
            <>
              <div className="relative mx-auto w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-blue-500/20" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 animate-spin" />
                <div className="absolute inset-3 rounded-full border-4 border-transparent border-t-amber-500 animate-spin" style={{ animationDuration: "1.5s", animationDirection: "reverse" }} />
                <Server className="absolute inset-0 m-auto h-6 w-6 text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">Environment Setup In Progress</h2>
                <p className="text-sm text-muted-foreground mt-1">{PHASE_MESSAGES[phaseIdx]}</p>
                <p className="text-xs text-muted-foreground/60 mt-2 font-mono">{elapsed} elapsed</p>
              </div>
            </>
          )}

          {isCompleted && (
            <>
              <div className="mx-auto w-20 h-20 flex items-center justify-center">
                <CheckCircle2 className="h-16 w-16 text-emerald-500 animate-[fadeIn_0.5s_ease-out]" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">Environment Ready</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {applied
                    ? "Configuration updated — reload the page to connect."
                    : applying
                    ? "Applying new configuration..."
                    : "Deployment completed successfully."}
                </p>
              </div>
            </>
          )}

          {isFailed && (
            <>
              <div className="mx-auto w-20 h-20 flex items-center justify-center">
                <XCircle className="h-16 w-16 text-red-500" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">Deployment Failed</h2>
                <p className="text-sm text-red-400 mt-1">{status.message || "Unknown error"}</p>
                {status.job?.id && (
                  <p className="text-xs text-muted-foreground/60 mt-2 font-mono">Job: {status.job.id}</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Workspace Discovery */}
        {wsEntries.length > 0 && (
          <div className="bg-card/50 border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FolderGit2 className="h-4 w-4 text-blue-400" />
              <span>Workspaces</span>
              <span className="ml-auto text-xs text-muted-foreground">{wsFound}/{wsEntries.length} discovered</span>
            </div>
            <div className="space-y-1.5">
              {wsEntries.map(([key, val]) => (
                <div key={key} className="flex items-center gap-2 text-xs">
                  {val ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 text-muted-foreground/40 animate-spin flex-shrink-0" />
                  )}
                  <span className={val ? "text-foreground" : "text-muted-foreground/50"}>
                    {WORKSPACE_LABELS[key] || key}
                  </span>
                  {val && (
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground/40">{val.slice(0, 8)}...</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SQL Endpoint */}
        {status.newSqlEndpoint && (
          <div className="bg-card/50 border border-border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Database className="h-4 w-4 text-amber-400" />
              <span>SQL Database</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-auto" />
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {status.newSqlEndpoint.displayName}
            </div>
          </div>
        )}

        {/* Items Summary */}
        {status.newItems && Object.keys(status.newItems).length > 0 && (
          <div className="bg-card/50 border border-border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Cable className="h-4 w-4 text-purple-400" />
              <span>Deployed Items</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(status.newItems).map(([role, count]) => (
                <div key={role} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{WORKSPACE_LABELS[role] || role}</span>
                  <span className="font-mono">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-center gap-3">
          {applied && (
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Reload Dashboard
            </button>
          )}
          {(isCompleted || isFailed) && (
            <button
              onClick={() => setDismissed(true)}
              className="px-4 py-2 rounded-md bg-card border border-border text-foreground text-sm hover:bg-accent transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>

        {/* Job ID footer */}
        {status.job?.id && (
          <p className="text-center text-[10px] text-muted-foreground/30 font-mono">
            Job {status.job.id}
          </p>
        )}
      </div>
    </div>
  );
}
