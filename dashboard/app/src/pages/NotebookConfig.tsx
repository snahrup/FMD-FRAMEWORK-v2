import { useState, useEffect, useCallback, useRef } from "react";
import {
  BookOpen,
  RefreshCw,
  Pencil,
  Save,
  X,
  Copy,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Database,
  Cable,
  Layers3,
  GitBranch,
  AlertTriangle,
  Server,
  Rocket,
  Loader2,
  XCircle,
  Clock,
  Play,
} from "lucide-react";

const API = "/api";

interface VarEntry {
  name: string;
  note: string;
  type: string;
  value: string;
}

interface NotebookConfigData {
  itemConfig: {
    workspaces?: Record<string, string>;
    connections?: Record<string, string>;
    database?: Record<string, string>;
  };
  varConfigFmd: { variables: VarEntry[]; valueSets: Record<string, unknown[]> };
  varFmd: { variables: VarEntry[]; valueSets: Record<string, unknown[]> };
  templateMapping: Record<
    string,
    {
      workspaceId: string;
      idReplacements: Record<string, string>;
      pipelineIds: Record<string, string>;
      replacementCount: number;
      pipelineCount: number;
    }
  >;
  missingConnections: string[];
}

function fetchJson<T>(path: string): Promise<T> {
  return fetch(`${API}${path}`).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });
}

// ── Friendly name mappings ──

const FRIENDLY_YAML_KEYS: Record<string, string> = {
  workspace_data: "Data Workspace (Dev)",
  workspace_code: "Code Workspace (Dev)",
  workspace_config: "Config Workspace",
  workspace_data_prod: "Data Workspace (Prod)",
  workspace_code_prod: "Code Workspace (Prod)",
  CON_FMD_FABRIC_SQL: "Fabric SQL Connection",
  CON_FMD_FABRIC_PIPELINES: "Fabric Pipelines Connection",
  CON_FMD_ADF_PIPELINES: "ADF Pipelines Connection",
  CON_FMD_FABRIC_NOTEBOOKS: "Fabric Notebooks Connection",
  displayName: "Database Name",
  id: "Database ID",
  endpoint: "SQL Endpoint",
};

const FRIENDLY_VAR_CONFIG: Record<string, string> = {
  fmd_fabric_db_connection: "SQL Server Endpoint",
  fmd_fabric_db_name: "Database Name",
  fmd_config_workspace_guid: "Config Workspace GUID",
  fmd_config_database_guid: "Config Database GUID",
};

const FRIENDLY_VAR_FMD: Record<string, string> = {
  key_vault_uri_name: "Key Vault URI",
  key_vault_tenant_id: "Tenant ID",
  key_vault_client_id: "Client ID (SP)",
  kv_credential_ref: "Client Secret Name (KV)",
  lakehouse_schema_enabled: "Lakehouse Schemas Enabled",
};

// ── Components ──

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="transition-colors"
      style={{ color: copied ? 'var(--bp-operational)' : 'var(--bp-ink-muted)' }}
      title="Copy"
    >
      {copied ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  children,
  defaultOpen = true,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full text-left"
      >
        <Icon className="h-5 w-5" style={{ color: 'var(--bp-ink-secondary)' }} />
        <h2 className="flex-1" style={{ fontFamily: 'var(--bp-font-body)', fontSize: '18px', fontWeight: 600, color: 'var(--bp-ink-primary)' }}>{title}</h2>
        {open ? (
          <ChevronDown className="h-4 w-4" style={{ color: 'var(--bp-ink-muted)' }} />
        ) : (
          <ChevronRight className="h-4 w-4" style={{ color: 'var(--bp-ink-muted)' }} />
        )}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}

function EditableValue({
  label,
  technicalName,
  value,
  isSensitive,
  onSave,
}: {
  label: string;
  technicalName: string;
  value: string;
  isSensitive?: boolean;
  onSave: (newVal: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  // Sync draft with prop when not actively editing
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const handleSave = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      setDraft(value);
    } finally {
      setSaving(false);
    }
  };

  const isEmpty = !value || value.trim() === "";
  const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

  return (
    <div className="flex flex-col gap-1 group">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>{label}</span>
        <span className="text-xs" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)' }}>({technicalName})</span>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type={isSensitive ? "password" : "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
            className="flex-1 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:ring-2"
            style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-copper)', fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-primary)', boxShadow: '0 0 0 2px rgba(180, 86, 36, 0.15)' }}
            autoFocus
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-1.5"
            style={{ color: 'var(--bp-operational)' }}
          >
            <Save className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setDraft(value);
              setEditing(false);
            }}
            className="p-1.5"
            style={{ color: 'var(--bp-ink-muted)' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {isEmpty ? (
            <span className="text-sm px-2 py-1 rounded" style={{ fontFamily: 'var(--bp-font-mono)', background: 'var(--bp-caution-light)', color: 'var(--bp-caution)', border: '1px solid var(--bp-caution)' }}>
              (empty — needs value)
            </span>
          ) : (
            <code
              className="text-sm px-2 py-1 rounded"
              style={{
                fontFamily: 'var(--bp-font-mono)',
                color: isGuid ? 'var(--bp-copper)' : 'var(--bp-ink-primary)',
                background: isGuid ? 'var(--bp-copper-light)' : 'var(--bp-surface-inset)',
              }}
            >
              {isSensitive ? "••••••••" : value}
            </code>
          )}
          {!isEmpty && <CopyButton text={value} />}
          <button
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 transition-opacity"
            style={{ color: 'var(--bp-ink-muted)' }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {isEmpty && (
            <button
              onClick={() => {
                setDraft("");
                setEditing(true);
              }}
              className="text-xs hover:underline"
              style={{ color: 'var(--bp-copper)' }}
            >
              Set value
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

type DeployPhase = "idle" | "confirm" | "triggering" | "running" | "completed" | "failed";

interface JobStatus {
  id: string;
  status: string;
  startTime?: string;
  endTime?: string;
  failureReason?: string;
}

export default function NotebookConfig() {
  const [data, setData] = useState<NotebookConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const hasLoadedOnce = useRef(false);

  // Deploy state
  const [deployPhase, setDeployPhase] = useState<DeployPhase>("idle");
  const [deployError, setDeployError] = useState<string | null>(null);
  const [notebookInfo, setNotebookInfo] = useState<{ workspaceId: string; notebookId: string } | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true);
    setError(null);
    try {
      const result = await fetchJson<NotebookConfigData>("/notebook-config");
      setData(result);
      hasLoadedOnce.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doUpdate = async (body: Record<string, unknown>) => {
    try {
      const result = await postJson<Record<string, unknown>>("/notebook-config/update", body);
      if (result.error) {
        setUpdateLog((prev) => [`ERROR: ${result.error}`, ...prev]);
      } else {
        setUpdateLog((prev) => [
          `Updated ${body.target}: ${JSON.stringify(result).slice(0, 120)}`,
          ...prev,
        ]);
      }
      await load();
    } catch (e) {
      setUpdateLog((prev) => [
        `ERROR: ${e instanceof Error ? e.message : "Network error"}`,
        ...prev,
      ]);
    }
  };

  // ── Deploy logic ──

  const initDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (initDelayRef.current) { clearTimeout(initDelayRef.current); initDelayRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback((wsId: string, nbId: string) => {
    stopPolling();
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);

    const poll = async () => {
      try {
        const res = await fetchJson<{ jobs?: JobStatus[]; error?: string }>(
          `/notebook/job-status?workspaceId=${wsId}&notebookId=${nbId}`
        );
        if (res.error) {
          setDeployPhase("failed");
          setDeployError(res.error);
          stopPolling();
          return;
        }
        const latest = res.jobs?.[0];
        if (!latest) return;
        setJobStatus(latest);

        if (latest.status === "Completed") {
          setDeployPhase("completed");
          stopPolling();
        } else if (latest.status === "Failed" || latest.status === "Cancelled") {
          setDeployPhase("failed");
          setDeployError(latest.failureReason || `Job ${latest.status.toLowerCase()}`);
          stopPolling();
        }
      } catch {
        // Ignore transient fetch errors, keep polling
      }
    };

    // First poll after 5s (notebook needs time to spin up)
    initDelayRef.current = setTimeout(() => {
      initDelayRef.current = null;
      poll();
      pollRef.current = setInterval(poll, 5000);
    }, 5000);
  }, [stopPolling]);

  const handleTriggerNotebook = async () => {
    setDeployPhase("triggering");
    setDeployError(null);
    setJobStatus(null);
    try {
      const res = await postJson<{
        success?: boolean;
        notebookId?: string;
        workspaceId?: string;
        error?: string;
      }>("/notebook/trigger", {});
      if (res.error || !res.workspaceId || !res.notebookId) {
        setDeployPhase("failed");
        setDeployError(res.error || "Missing workspaceId or notebookId in response");
        return;
      }
      setNotebookInfo({ workspaceId: res.workspaceId, notebookId: res.notebookId });
      setDeployPhase("running");
      startPolling(res.workspaceId, res.notebookId);
    } catch (e) {
      setDeployPhase("failed");
      setDeployError(e instanceof Error ? e.message : "Failed to trigger notebook");
    }
  };

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  if (!hasLoadedOnce.current && loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="h-8 w-8 animate-spin" style={{ color: 'var(--bp-ink-muted)' }} />
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="p-8">
        <div className="rounded-xl p-6 flex items-center justify-between" style={{ background: 'var(--bp-fault-light)', border: '1px solid var(--bp-fault)' }}>
          <p style={{ color: 'var(--bp-fault)' }}>{error}</p>
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
            style={{ background: 'var(--bp-fault-light)', color: 'var(--bp-fault)', border: '1px solid var(--bp-fault)' }}
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { itemConfig, varConfigFmd, varFmd, templateMapping, missingConnections } = data;
  const yamlWs = itemConfig.workspaces || {};
  const yamlConn = itemConfig.connections || {};
  const yamlDb = itemConfig.database || {};

  // Count empty values for readiness check
  const emptyVarConfig = varConfigFmd.variables.filter((v) => !v.value).length;
  const emptyVarFmd = varFmd.variables.filter((v) => !v.value).length;
  const emptyYaml =
    Object.values(yamlWs).filter((v) => !v || v === "TBD").length +
    Object.values(yamlConn).filter((v) => !v).length +
    Object.values(yamlDb).filter((v) => !v).length;
  const totalEmpty = emptyVarConfig + emptyVarFmd + emptyYaml;

  return (
    <div className="space-y-6" style={{ padding: '32px', maxWidth: '1280px' }}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3" style={{ fontFamily: 'var(--bp-font-display)', fontSize: '32px', color: 'var(--bp-ink-primary)' }}>
            <BookOpen className="h-7 w-7" /> Setup Notebook Configuration
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            Edit all values the NB_UTILITIES_SETUP_FMD notebook reads. Update here, then run the
            notebook in Fabric.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="bp-btn-ghost flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* ── Readiness Banner ── */}
      {totalEmpty > 0 ? (
        <div className="rounded-xl p-5 flex items-center gap-3" style={{ background: 'var(--bp-caution-light)', border: '1px solid var(--bp-caution)' }}>
          <AlertTriangle className="h-6 w-6" style={{ color: 'var(--bp-caution)' }} />
          <span className="text-sm" style={{ color: 'var(--bp-caution)', fontFamily: 'var(--bp-font-body)' }}>
            <strong>{totalEmpty} value{totalEmpty > 1 ? "s" : ""}</strong> still need to be set
            before running the setup notebook. Fill in the highlighted fields below.
          </span>
        </div>
      ) : (
        <div className="rounded-xl p-5 flex items-center gap-3" style={{ background: 'var(--bp-operational-light)', border: '1px solid var(--bp-operational)' }}>
          <CheckCircle2 className="h-6 w-6" style={{ color: 'var(--bp-operational)' }} />
          <span className="text-sm" style={{ color: 'var(--bp-operational)', fontFamily: 'var(--bp-font-body)' }}>
            All configuration values are set. The setup notebook is ready to run.
          </span>
        </div>
      )}

      {/* ── One-Click Deploy ── */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
        <SectionHeader icon={Rocket} title="Run Setup Notebook">
          <p className="text-sm mb-4" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            Trigger <strong>NB_UTILITIES_SETUP_FMD</strong> remotely via the Fabric Jobs API.
            This deploys the entire framework — workspaces, lakehouses, pipelines, connections,
            variable libraries, and the metadata database.
          </p>

          {/* Idle — show the deploy button */}
          {deployPhase === "idle" && (
            <button
              onClick={() => setDeployPhase("confirm")}
              disabled={totalEmpty > 0}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-colors ${
                totalEmpty > 0 ? "cursor-not-allowed" : "bp-btn-primary"
              }`}
              style={totalEmpty > 0 ? { background: 'var(--bp-surface-inset)', color: 'var(--bp-ink-muted)' } : undefined}
            >
              <Rocket className="h-5 w-5" />
              {totalEmpty > 0
                ? `Fill ${totalEmpty} empty value${totalEmpty > 1 ? "s" : ""} first`
                : "Deploy Framework"}
            </button>
          )}

          {/* Confirm — are you sure? */}
          {deployPhase === "confirm" && (
            <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--bp-caution-light)', border: '1px solid var(--bp-caution)' }}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" style={{ color: 'var(--bp-caution)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--bp-caution)', fontFamily: 'var(--bp-font-body)' }}>
                  This will deploy the entire FMD framework to Fabric.
                </span>
              </div>
              <p className="text-sm" style={{ color: 'var(--bp-caution)' }}>
                The setup notebook will create/update workspaces, lakehouses, pipelines,
                connections, and the SQL database. Existing items with matching names will
                be updated in-place. This operation typically takes 5-15 minutes.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTriggerNotebook}
                  className="bp-btn-primary flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  <Play className="h-4 w-4" />
                  Yes, Deploy Now
                </button>
                <button
                  onClick={() => setDeployPhase("idle")}
                  className="bp-btn-ghost px-4 py-2.5 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Triggering — sending to Fabric */}
          {deployPhase === "triggering" && (
            <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'var(--bp-copper-light)', border: '1px solid var(--bp-border)' }}>
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--bp-copper)' }} />
              <span className="text-sm" style={{ color: 'var(--bp-copper)', fontFamily: 'var(--bp-font-body)' }}>
                Triggering setup notebook via Fabric Jobs API...
              </span>
            </div>
          )}

          {/* Running — live status */}
          {deployPhase === "running" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'var(--bp-copper-light)', border: '1px solid var(--bp-border)' }}>
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--bp-copper)' }} />
                <div className="flex-1">
                  <span className="text-sm font-medium" style={{ color: 'var(--bp-copper)', fontFamily: 'var(--bp-font-body)' }}>
                    Setup notebook is running...
                  </span>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-xs flex items-center gap-1" style={{ color: 'var(--bp-ink-secondary)' }}>
                      <Clock className="h-3 w-3" /> Elapsed: {formatElapsed(elapsedSeconds)}
                    </span>
                    {jobStatus && (
                      <span className="text-xs" style={{ color: 'var(--bp-ink-secondary)', fontFamily: 'var(--bp-font-mono)' }}>
                        Status: {jobStatus.status}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { stopPolling(); setDeployPhase("idle"); }}
                  className="bp-btn-ghost px-3 py-1.5 text-xs rounded-lg"
                >
                  Dismiss
                </button>
              </div>
              {notebookInfo && (
                <p className="text-xs" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)' }}>
                  Notebook: {notebookInfo.notebookId} &bull; Workspace: {notebookInfo.workspaceId}
                </p>
              )}
            </div>
          )}

          {/* Completed */}
          {deployPhase === "completed" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'var(--bp-operational-light)', border: '1px solid var(--bp-operational)' }}>
                <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--bp-operational)' }} />
                <div className="flex-1">
                  <span className="text-sm font-medium" style={{ color: 'var(--bp-operational)', fontFamily: 'var(--bp-font-body)' }}>
                    Framework deployed successfully!
                  </span>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-xs" style={{ color: 'var(--bp-operational)' }}>
                      Completed in {formatElapsed(elapsedSeconds)}
                    </span>
                    {jobStatus?.endTime && !isNaN(new Date(jobStatus.endTime).getTime()) && (
                      <span className="text-xs" style={{ color: 'var(--bp-operational)', fontFamily: 'var(--bp-font-mono)' }}>
                        Finished: {new Date(jobStatus.endTime).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setDeployPhase("idle"); setJobStatus(null); }}
                  className="px-3 py-1.5 text-xs rounded-lg transition-colors"
                  style={{ color: 'var(--bp-operational)', background: 'var(--bp-operational-light)', border: '1px solid var(--bp-operational)' }}
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Failed */}
          {deployPhase === "failed" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'var(--bp-fault-light)', border: '1px solid var(--bp-fault)' }}>
                <XCircle className="h-5 w-5" style={{ color: 'var(--bp-fault)' }} />
                <div className="flex-1">
                  <span className="text-sm font-medium" style={{ color: 'var(--bp-fault)', fontFamily: 'var(--bp-font-body)' }}>
                    Deployment failed
                  </span>
                  {deployError && (
                    <p className="text-xs mt-1" style={{ color: 'var(--bp-fault)', fontFamily: 'var(--bp-font-mono)' }}>
                      {deployError}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { setDeployPhase("idle"); setDeployError(null); setJobStatus(null); }}
                  className="px-3 py-1.5 text-xs rounded-lg transition-colors"
                  style={{ color: 'var(--bp-fault)', background: 'var(--bp-fault-light)', border: '1px solid var(--bp-fault)' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </SectionHeader>
      </div>

      {/* ── Section 1: item_config.yaml — Workspaces ── */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
        <SectionHeader icon={Layers3} title="Workspaces (item_config.yaml)">
          <p className="text-sm mb-4" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            Target workspace GUIDs for DEV and PROD environments. The setup notebook uses these to
            deploy items into the correct workspaces.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(yamlWs).map(([key, val]) => (
              <EditableValue
                key={key}
                label={FRIENDLY_YAML_KEYS[key] || key}
                technicalName={key}
                value={val}
                onSave={(newVal) =>
                  doUpdate({ target: "item_config", section: "workspaces", key, newValue: newVal })
                }
              />
            ))}
          </div>
        </SectionHeader>
      </div>

      {/* ── Section 2: item_config.yaml — Connections ── */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
        <SectionHeader icon={Cable} title="Connections (item_config.yaml)">
          <p className="text-sm mb-4" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            Connection GUIDs referenced by pipelines and the setup notebook. These must match the
            actual Fabric connection IDs.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(yamlConn).map(([key, val]) => (
              <EditableValue
                key={key}
                label={FRIENDLY_YAML_KEYS[key] || key}
                technicalName={key}
                value={val}
                onSave={(newVal) =>
                  doUpdate({
                    target: "item_config",
                    section: "connections",
                    key,
                    newValue: newVal,
                  })
                }
              />
            ))}
          </div>
          {missingConnections.length > 0 && (
            <div className="mt-4 p-3 rounded-lg" style={{ background: 'var(--bp-caution-light)', border: '1px solid var(--bp-caution)' }}>
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--bp-caution)' }}>
                Missing Connections (deactivated during deployment)
              </p>
              {missingConnections.map((c) => (
                <code
                  key={c}
                  className="text-xs block"
                  style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-caution)' }}
                >
                  {c}
                </code>
              ))}
            </div>
          )}
        </SectionHeader>
      </div>

      {/* ── Section 3: item_config.yaml — Database ── */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
        <SectionHeader icon={Database} title="SQL Database (item_config.yaml)">
          <p className="text-sm mb-4" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            SQL_FMD_FRAMEWORK database identifiers. The setup notebook creates/finds the database
            and populates these after deployment.
          </p>
          <div className="grid grid-cols-1 gap-4">
            {Object.entries(yamlDb).map(([key, val]) => (
              <EditableValue
                key={key}
                label={FRIENDLY_YAML_KEYS[key] || key}
                technicalName={key}
                value={val}
                onSave={(newVal) =>
                  doUpdate({ target: "item_config", section: "database", key, newValue: newVal })
                }
              />
            ))}
          </div>
        </SectionHeader>
      </div>

      {/* ── Section 4: VAR_CONFIG_FMD ── */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
        <SectionHeader icon={Server} title="Variable Library — VAR_CONFIG_FMD">
          <p className="text-sm mb-4" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            Framework configuration variables. These are set by the setup notebook after deploying
            the SQL database. Pipelines read them at runtime via{" "}
            <code className="text-xs px-1 py-0.5 rounded" style={{ background: 'var(--bp-surface-inset)', fontFamily: 'var(--bp-font-mono)' }}>
              @pipeline().libraryVariables.VAR_CONFIG_FMD_*
            </code>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {varConfigFmd.variables.map((v) => (
              <EditableValue
                key={v.name}
                label={FRIENDLY_VAR_CONFIG[v.name] || v.name}
                technicalName={v.name}
                value={v.value}
                onSave={(newVal) =>
                  doUpdate({
                    target: "var_config_fmd",
                    variableName: v.name,
                    newValue: newVal,
                  })
                }
              />
            ))}
          </div>
        </SectionHeader>
      </div>

      {/* ── Section 5: VAR_FMD ── */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
        <SectionHeader icon={KeyRound} title="Variable Library — VAR_FMD">
          <p className="text-sm mb-4" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            Key Vault and runtime variables. These are passed to the setup notebook as parameters
            for service principal authentication.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {varFmd.variables.map((v) => (
              <EditableValue
                key={v.name}
                label={FRIENDLY_VAR_FMD[v.name] || v.name}
                technicalName={v.name}
                value={v.value}
                isSensitive={v.name.includes("secret")}
                onSave={(newVal) =>
                  doUpdate({
                    target: "var_fmd",
                    variableName: v.name,
                    newValue: newVal,
                  })
                }
              />
            ))}
          </div>
        </SectionHeader>
      </div>

      {/* ── Section 6: Template → Real ID Mapping ── */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
        <SectionHeader icon={GitBranch} title="Template → Real ID Mapping" defaultOpen={false}>
          <p className="text-sm mb-4" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
            During deployment, template GUIDs from the Git source files are replaced with real
            deployed GUIDs per workspace. This mapping is used by both the setup notebook and the
            dashboard&apos;s Deploy function.
          </p>
          {Object.entries(templateMapping).map(([wsLabel, ws]) => (
            <div key={wsLabel} className="mb-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--bp-copper)' }}>
                {wsLabel}{" "}
                <span className="font-normal normal-case" style={{ color: 'var(--bp-ink-tertiary)' }}>
                  — {ws.replacementCount} ID replacements, {ws.pipelineCount} pipelines
                </span>
              </h3>
              <div className="rounded-lg p-3 max-h-60 overflow-y-auto" style={{ background: 'var(--bp-surface-inset)' }}>
                <table className="w-full text-xs" style={{ fontFamily: 'var(--bp-font-mono)', fontFeatureSettings: '"tnum"' }}>
                  <thead>
                    <tr style={{ color: 'var(--bp-ink-muted)', borderBottom: '1px solid var(--bp-border)' }}>
                      <th className="text-left py-1 pr-4">Template ID</th>
                      <th className="text-left py-1">→ Real ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(ws.idReplacements).map(([tmpl, real]) => (
                      <tr key={tmpl} style={{ borderBottom: '1px solid var(--bp-border-subtle)' }}>
                        <td className="py-1 pr-4" style={{ color: 'var(--bp-fault)' }}>{tmpl}</td>
                        <td className="py-1" style={{ color: 'var(--bp-operational)' }}>{real}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </SectionHeader>
      </div>

      {/* ── Update Log ── */}
      {updateLog.length > 0 && (
        <div className="rounded-xl p-6" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
          <SectionHeader icon={BookOpen} title="Update Log" defaultOpen={false}>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {updateLog.map((msg, i) => (
                <div
                  key={i}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    fontFamily: 'var(--bp-font-mono)',
                    color: msg.startsWith("ERROR") ? 'var(--bp-fault)' : 'var(--bp-ink-tertiary)',
                    background: msg.startsWith("ERROR") ? 'var(--bp-fault-light)' : 'var(--bp-surface-inset)',
                  }}
                >
                  {msg}
                </div>
              ))}
            </div>
          </SectionHeader>
        </div>
      )}
    </div>
  );
}
