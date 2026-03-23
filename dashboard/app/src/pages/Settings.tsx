import { useState, useCallback, useEffect, useRef } from "react";
import {
  Settings as SettingsIcon,
  FlaskConical,
  Sparkles,
  ClipboardCheck,
  Layers3,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Rocket,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronRight,
  ArrowRight,
  RotateCcw,
  Cog,
} from "lucide-react";
import { getLabsFlags, setLabsFlag, type LabsFlags } from "@/lib/featureFlags";
import DeploymentManager from "./settings/DeploymentManager";

const API = "/api";

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

// ============================================================================
// LAB FEATURE DEFINITIONS
// ============================================================================

interface LabFeature {
  key: keyof LabsFlags;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  colorVar: string;
}

const LAB_FEATURES: LabFeature[] = [
  {
    key: "cleansingRuleEditor",
    label: "Cleansing Rule Editor",
    description:
      "View and manage the JSON cleansing rules applied during Bronze → Silver transformation. Build rules visually instead of writing SQL inserts.",
    icon: Sparkles,
    colorVar: "var(--bp-copper)",
  },
  {
    key: "scdAuditView",
    label: "SCD Audit View",
    description:
      "Track inserts, updates, and deletes per Silver table per pipeline run. Surfaces the SCD Type 2 change tracking that the framework already logs.",
    icon: ClipboardCheck,
    colorVar: "var(--bp-operational)",
  },
  {
    key: "goldMlvManager",
    label: "Gold Layer / MLV Manager",
    description:
      "View which Materialized Lakehouse Views exist in the Gold layer, what Silver tables they reference, and their current state.",
    icon: Layers3,
    colorVar: "var(--bp-caution)",
  },
  {
    key: "dqScorecard",
    label: "DQ Scorecard",
    description:
      "Data quality metrics per table — null rates, duplicate counts, cleansing rule pass/fail rates. Surfaces checks already run by the DQ cleansing notebook.",
    icon: ShieldCheck,
    colorVar: "var(--bp-ink-secondary)",
  },
];

// ============================================================================
// DEPLOY WIZARD TYPES
// ============================================================================

type DeployStep = "idle" | "config" | "preflight" | "confirm" | "running" | "done" | "failed";

interface PreflightResult {
  workspaces: { label: string; id: string; exists: boolean; willDelete: boolean; displayName?: string | null }[];
  connections: { label: string; id: string; exists: boolean; displayName?: string | null }[];
  notebook: { id: string | null; name: string; exists: boolean } | null;
  ready: boolean;
}

interface DeployField {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
  sensitive?: boolean;
  hint?: string;
}

const DEPLOY_FIELDS: DeployField[] = [
  {
    key: "workspace_config",
    label: "Config Workspace ID",
    placeholder: "c6d2ec61-...",
    required: true,
    hint: "The workspace that holds NB_SETUP_FMD. This workspace survives the wipe.",
  },
  {
    key: "con_fmd_fabric_sql",
    label: "Fabric SQL Connection GUID",
    placeholder: "0f86f6a1-...",
    required: true,
    hint: "Create this connection manually in the Fabric portal first (the CLI can't auto-create SQL connections).",
  },
  {
    key: "lakehouse_schema_enabled",
    label: "Enable Lakehouse Schemas",
    placeholder: "true",
    required: true,
    hint: "Set to 'true' to create lakehouses with schema support enabled.",
  },
];

// Known phases the setup notebook goes through (in order). Used for the progress log.
const DEPLOY_PHASES = [
  { after: 0, msg: "Saving configuration values..." },
  { after: 2, msg: "Triggering setup notebook in Fabric..." },
  { after: 8, msg: "Notebook started. Authenticating with service principal..." },
  { after: 15, msg: "Creating DEV workspaces (DATA, CODE)..." },
  { after: 30, msg: "Assigning workspace roles and managed identities..." },
  { after: 45, msg: "Creating lakehouses (Landing Zone, Bronze, Silver)..." },
  { after: 70, msg: "Deploying variable libraries (VAR_CONFIG_FMD, VAR_FMD)..." },
  { after: 90, msg: "Creating SQL metadata database..." },
  { after: 120, msg: "Deploying notebooks..." },
  { after: 160, msg: "Deploying data pipelines (replacing template IDs with real IDs)..." },
  { after: 200, msg: "Deactivating activities for missing connections..." },
  { after: 240, msg: "Creating PROD workspaces and deploying PROD items..." },
  { after: 300, msg: "Creating Fabric Pipelines connection..." },
  { after: 340, msg: "Assigning workspace folders and descriptions..." },
  { after: 380, msg: "Setting workspace icons..." },
  { after: 420, msg: "Finalizing deployment and writing mapping table..." },
];

interface JobStatus {
  id: string;
  status: string;
  startTime?: string;
  endTime?: string;
  failureReason?: string;
}

// ============================================================================
// DEPLOY WIZARD COMPONENT
// ============================================================================

function DeployWizard() {
  const [step, setStep] = useState<DeployStep>("idle");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [prefilledFrom, setPrefilledFrom] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notebookInfo, setNotebookInfo] = useState<{ workspaceId: string; notebookId: string } | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phasesEmitted = useRef(0);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [fabricWorkspaces, setFabricWorkspaces] = useState<{ id: string; displayName: string }[]>([]);
  const [fabricConnections, setFabricConnections] = useState<{ id: string; displayName: string; type: string }[]>([]);
  const [fabricLoading, setFabricLoading] = useState(false);

  // Load existing config + live Fabric data to populate dropdowns
  useEffect(() => {
    if (step === "config") {
      setFabricLoading(true);

      Promise.all([
        fetchJson<{
          itemConfig: { workspaces?: Record<string, string>; connections?: Record<string, string> };
        }>("/notebook-config").catch(() => null),
        fetchJson<{ workspaces: { id: string; displayName: string }[] }>("/fabric/workspaces").catch(() => ({ workspaces: [] })),
        fetchJson<{ connections: { id: string; displayName: string; type: string }[] }>("/fabric/connections").catch(() => ({ connections: [] })),
      ]).then(([config, ws, conns]) => {
        setFabricWorkspaces(ws?.workspaces ?? []);
        setFabricConnections(conns?.connections ?? []);

        const prefilled: string[] = [];
        const vals: Record<string, string> = { lakehouse_schema_enabled: 'true', ...fields };

        if (config) {
          const wsId = config.itemConfig?.workspaces?.workspace_config;
          if (wsId && wsId !== "TBD") {
            vals.workspace_config = wsId;
            prefilled.push("workspace_config");
          }

          const sql = config.itemConfig?.connections?.CON_FMD_FABRIC_SQL;
          if (sql) {
            vals.con_fmd_fabric_sql = sql;
            prefilled.push("con_fmd_fabric_sql");
          }
        }

        setFields(vals);
        setPrefilledFrom(prefilled);
        setFabricLoading(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const allRequiredFilled = DEPLOY_FIELDS.filter((f) => f.required).every(
    (f) => fields[f.key]?.trim()
  );

  // Emit phase-based log messages as time passes
  useEffect(() => {
    if (step !== "running") return;
    const nextPhase = DEPLOY_PHASES[phasesEmitted.current];
    if (nextPhase && elapsed >= nextPhase.after) {
      setLogMessages((prev) => [...prev, nextPhase.msg]);
      phasesEmitted.current += 1;
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [elapsed, step]);

  const startPolling = useCallback((wsId: string, nbId: string) => {
    stopPolling();
    setElapsed(0);
    setLogMessages([]);
    phasesEmitted.current = 0;
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    const poll = async () => {
      try {
        const res = await fetchJson<{ jobs?: JobStatus[]; error?: string }>(
          `/notebook/job-status?workspaceId=${wsId}&notebookId=${nbId}`
        );
        if (res.error) {
          setStep("failed");
          setError(res.error);
          stopPolling();
          return;
        }
        const latest = res.jobs?.[0];
        if (!latest) return;
        setJobStatus(latest);

        if (latest.status === "Completed") {
          setStep("done");
          stopPolling();
        } else if (latest.status === "Failed" || latest.status === "Cancelled") {
          setStep("failed");
          setError(latest.failureReason || `Job ${latest.status.toLowerCase()}`);
          stopPolling();
        }
      } catch {
        // transient error, keep polling
      }
    };

    const delayId = setTimeout(() => {
      poll();
      pollRef.current = setInterval(poll, 5000);
    }, 5000);
    pollRef.current = delayId as unknown as ReturnType<typeof setInterval>;
  }, [stopPolling]);

  const handleDeploy = async () => {
    setStep("running");
    setError(null);
    setJobStatus(null);
    setLogMessages([]);
    phasesEmitted.current = 0;

    try {
      setLogMessages(["Saving configuration values..."]);
      const cfgRes1 = await postJson<{ error?: string }>("/notebook-config/update", {
        target: "item_config",
        section: "workspaces",
        key: "workspace_config",
        newValue: fields.workspace_config,
      });
      if (cfgRes1.error) throw new Error(cfgRes1.error);
      const cfgRes2 = await postJson<{ error?: string }>("/notebook-config/update", {
        target: "item_config",
        section: "connections",
        key: "CON_FMD_FABRIC_SQL",
        newValue: fields.con_fmd_fabric_sql,
      });
      if (cfgRes2.error) throw new Error(cfgRes2.error);
      setLogMessages((prev) => [...prev, "Configuration saved."]);

      setLogMessages((prev) => [...prev, "Deleting old workspaces and triggering setup notebook..."]);
      const res = await postJson<{
        success?: boolean;
        notebookId?: string;
        workspaceId?: string;
        error?: string;
        deleteLog?: string[];
      }>("/deploy/wipe-and-trigger", {});

      if (res.deleteLog) {
        setLogMessages((prev) => [...prev, ...(res.deleteLog ?? [])]);
      }

      if (res.error) {
        setStep("failed");
        setError(res.error);
        return;
      }

      setLogMessages((prev) => [
        ...prev,
        `Setup notebook triggered (${res.notebookId?.slice(0, 8)}...)`,
        "Polling for notebook job status...",
      ]);
      phasesEmitted.current = 2;

      setNotebookInfo({ workspaceId: res.workspaceId!, notebookId: res.notebookId! });
      startPolling(res.workspaceId!, res.notebookId!);
    } catch (e) {
      setStep("failed");
      setError(e instanceof Error ? e.message : "Failed to trigger deployment");
    }
  };

  const reset = () => {
    stopPolling();
    setStep("idle");
    setError(null);
    setJobStatus(null);
    setNotebookInfo(null);
    setElapsed(0);
    setFields({});
    setPrefilledFrom([]);
  };

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  // ── IDLE ──
  if (step === "idle") {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--bp-ink-secondary)', fontFamily: 'var(--bp-font-body)' }}>
          Run the setup notebook to deploy or redeploy the entire FMD framework to Microsoft Fabric.
          This creates workspaces, lakehouses, pipelines, connections, variable libraries, and the
          metadata database.
        </p>
        <button
          onClick={() => setStep("config")}
          className="bp-btn-primary flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Rocket className="h-4 w-4" />
          Start Deployment
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── CONFIG — collect required values via live Fabric dropdowns ──
  if (step === "config") {
    const selectedWsName = fabricWorkspaces.find((w) => w.id === fields.workspace_config)?.displayName;
    const selectedConnName = fabricConnections.find((c) => c.id === fields.con_fmd_fabric_sql)?.displayName;
    const sqlConnections = fabricConnections.filter(
      (c) => c.type === 'FabricSql' || (c.displayName ?? '').startsWith('CON_FMD')
    );

    return (
      <div className="space-y-5">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--bp-ink-secondary)', fontFamily: 'var(--bp-font-body)' }}>
          Select your Fabric resources below. {fabricLoading ? "Loading live data from Fabric..." : "Dropdowns are populated from your live Fabric environment."}
        </p>

        {fabricLoading && (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--bp-ink-tertiary)' }}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Connecting to Fabric and loading workspaces &amp; connections...
          </div>
        )}

        <div className="space-y-5">
          {/* Config Workspace — dropdown */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>
              Config Workspace <span className="text-xs" style={{ color: 'var(--bp-fault)' }}>*</span>
              {prefilledFrom.includes("workspace_config") && (
                <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5" style={{ color: 'var(--bp-operational)', background: 'var(--bp-operational-light)' }}>
                  Pre-filled
                </span>
              )}
            </label>
            <p className="text-xs" style={{ color: 'var(--bp-ink-tertiary)' }}>The workspace that holds NB_SETUP_FMD. This workspace survives the wipe.</p>
            <select
              value={fields.workspace_config || ""}
              onChange={(e) => setFields({ ...fields, workspace_config: e.target.value })}
              aria-label="Config Workspace"
              className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
              style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border)', color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}
            >
              <option value="">Select a workspace...</option>
              {fabricWorkspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.displayName}
                </option>
              ))}
            </select>
            {selectedWsName && (
              <p className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--bp-operational)' }}>
                <CheckCircle2 className="h-3 w-3" />
                {selectedWsName}
                <span className="ml-1" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)' }}>({fields.workspace_config})</span>
              </p>
            )}
          </div>

          {/* Fabric SQL Connection — dropdown */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>
              Fabric SQL Connection <span className="text-xs" style={{ color: 'var(--bp-fault)' }}>*</span>
              {prefilledFrom.includes("con_fmd_fabric_sql") && (
                <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5" style={{ color: 'var(--bp-operational)', background: 'var(--bp-operational-light)' }}>
                  Pre-filled
                </span>
              )}
            </label>
            <p className="text-xs" style={{ color: 'var(--bp-ink-tertiary)' }}>The CON_FMD_FABRIC_SQL connection. Must be created manually in Fabric first.</p>
            <select
              value={fields.con_fmd_fabric_sql || ""}
              onChange={(e) => setFields({ ...fields, con_fmd_fabric_sql: e.target.value })}
              aria-label="Fabric SQL Connection"
              className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
              style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border)', color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}
            >
              <option value="">Select a connection...</option>
              {sqlConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} ({c.type})
                </option>
              ))}
              {fields.con_fmd_fabric_sql && !sqlConnections.find((c) => c.id === fields.con_fmd_fabric_sql) && (
                <option value={fields.con_fmd_fabric_sql}>
                  {fabricConnections.find((c) => c.id === fields.con_fmd_fabric_sql)?.displayName || fields.con_fmd_fabric_sql}
                </option>
              )}
            </select>
            {selectedConnName && (
              <p className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--bp-operational)' }}>
                <CheckCircle2 className="h-3 w-3" />
                {selectedConnName}
                <span className="ml-1" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)' }}>({fields.con_fmd_fabric_sql})</span>
              </p>
            )}
          </div>

          {/* Lakehouse Schemas — simple toggle-style select */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>
              Enable Lakehouse Schemas <span className="text-xs" style={{ color: 'var(--bp-fault)' }}>*</span>
            </label>
            <p className="text-xs" style={{ color: 'var(--bp-ink-tertiary)' }}>Create lakehouses with schema support enabled.</p>
            <select
              value={fields.lakehouse_schema_enabled || "true"}
              onChange={(e) => setFields({ ...fields, lakehouse_schema_enabled: e.target.value })}
              aria-label="Enable Lakehouse Schemas"
              className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
              style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border)', color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}
            >
              <option value="true">Yes (recommended)</option>
              <option value="false">No</option>
            </select>
          </div>

          {/* Workspace & Connection Roles — multi-select chip style */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>
              Workspace &amp; Connection Roles
            </label>
            <p className="text-xs" style={{ color: 'var(--bp-ink-tertiary)' }}>Principals auto-assigned to all created workspaces and connections.</p>
            <div className="flex flex-wrap gap-2 rounded-lg px-3 py-2.5 min-h-[38px]" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-inset)' }}>
              <span className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-2 py-1 text-xs font-medium" style={{ background: 'var(--bp-copper-light)', border: '1px solid var(--bp-copper)', color: 'var(--bp-ink-primary)' }}>
                Fabric-PowerBI-API
                <span className="text-[9px] font-normal" style={{ color: 'var(--bp-ink-muted)' }}>Contributor</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-2 py-1 text-xs font-medium" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border-strong)', color: 'var(--bp-ink-primary)' }}>
                FabricAdmins
                <span className="text-[9px] font-normal" style={{ color: 'var(--bp-ink-muted)' }}>Admin</span>
              </span>
            </div>
            <p className="text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>
              Configured in the setup notebook. To change, edit NB_SETUP_FMD &rarr; Workspace Roles Configuration.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={async () => {
              setPreflightLoading(true);
              setPreflight(null);
              try {
                const r1 = await postJson<{ error?: string }>("/notebook-config/update", {
                  target: "item_config", section: "workspaces",
                  key: "workspace_config", newValue: fields.workspace_config,
                });
                if (r1.error) throw new Error(r1.error);
                const r2 = await postJson<{ error?: string }>("/notebook-config/update", {
                  target: "item_config", section: "connections",
                  key: "CON_FMD_FABRIC_SQL", newValue: fields.con_fmd_fabric_sql,
                });
                if (r2.error) throw new Error(r2.error);
                const pf = await fetchJson<PreflightResult>("/deploy/preflight");
                setPreflight(pf);
                setStep("preflight");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Pre-flight check failed");
                setStep("failed");
              } finally {
                setPreflightLoading(false);
              }
            }}
            disabled={!allRequiredFilled || preflightLoading || fabricLoading}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              allRequiredFilled && !preflightLoading && !fabricLoading
                ? "bp-btn-primary"
                : ""
            }`}
            style={!(allRequiredFilled && !preflightLoading && !fabricLoading) ? { background: 'var(--bp-surface-inset)', color: 'var(--bp-ink-muted)', cursor: 'not-allowed' } : undefined}
          >
            {preflightLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Scanning Fabric...</>
            ) : (
              <>Continue <ArrowRight className="h-4 w-4" /></>
            )}
          </button>
          <button
            onClick={reset}
            className="px-4 py-2.5 text-sm transition-colors"
            style={{ color: 'var(--bp-ink-tertiary)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── PRE-FLIGHT — show what exists in Fabric ──
  if (step === "preflight" && preflight) {
    return (
      <div className="space-y-5">
        <p className="text-sm" style={{ color: 'var(--bp-ink-secondary)' }}>
          Scanned your Fabric environment. Here's what was found:
        </p>

        {/* Workspaces */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--bp-ink-tertiary)' }}>Workspaces</h3>
          <div className="space-y-1">
            {preflight.workspaces.map((ws) => (
              <div key={ws.label} className="flex items-center gap-3 text-sm px-3 py-2.5 rounded-lg" style={{ background: 'var(--bp-surface-inset)' }}>
                {ws.exists ? (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--bp-operational)' }} />
                ) : (
                  <XCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--bp-ink-muted)' }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>
                      {ws.displayName || ws.label}
                    </span>
                    {ws.displayName && ws.displayName !== ws.label && (
                      <span className="text-[10px]" style={{ color: 'var(--bp-ink-tertiary)' }}>({ws.label})</span>
                    )}
                  </div>
                  <span className="text-[10px] block" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-muted)' }}>{ws.id || "\u2014"}</span>
                </div>
                {ws.exists && ws.willDelete && (
                  <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 flex-shrink-0" style={{ color: 'var(--bp-fault)', background: 'var(--bp-fault-light)' }}>
                    Will be deleted
                  </span>
                )}
                {ws.exists && !ws.willDelete && (
                  <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 flex-shrink-0" style={{ color: 'var(--bp-operational)', background: 'var(--bp-operational-light)' }}>
                    Kept
                  </span>
                )}
                {!ws.exists && ws.willDelete && (
                  <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 flex-shrink-0" style={{ color: 'var(--bp-copper)', background: 'var(--bp-copper-light)' }}>
                    Will be created
                  </span>
                )}
                {!ws.exists && !ws.willDelete && (
                  <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 flex-shrink-0" style={{ color: 'var(--bp-fault)', background: 'var(--bp-fault-light)' }}>
                    Not found
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Connections */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--bp-ink-tertiary)' }}>Connections</h3>
          <div className="space-y-1">
            {preflight.connections.map((conn) => (
              <div key={conn.label} className="flex items-center gap-3 text-sm px-3 py-2.5 rounded-lg" style={{ background: 'var(--bp-surface-inset)' }}>
                {conn.exists ? (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--bp-operational)' }} />
                ) : (
                  <XCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--bp-ink-muted)' }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>
                      {conn.displayName || conn.label}
                    </span>
                    {conn.displayName && conn.displayName !== conn.label && (
                      <span className="text-[10px]" style={{ color: 'var(--bp-ink-tertiary)' }}>({conn.label})</span>
                    )}
                  </div>
                  <span className="text-[10px] block" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-muted)' }}>{conn.id || "\u2014"}</span>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 flex-shrink-0" style={
                  conn.exists
                    ? { color: 'var(--bp-operational)', background: 'var(--bp-operational-light)' }
                    : { color: 'var(--bp-caution)', background: 'var(--bp-caution-light)' }
                }>
                  {conn.exists ? "Found" : "Missing"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Setup Notebook */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--bp-ink-tertiary)' }}>Setup Notebook</h3>
          <div className="flex items-center gap-3 text-sm px-3 py-2.5 rounded-lg" style={{ background: 'var(--bp-surface-inset)' }}>
            {preflight.notebook?.exists ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--bp-operational)' }} />
            ) : (
              <XCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--bp-fault)' }} />
            )}
            <div className="flex-1 min-w-0">
              <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>{preflight.notebook?.name ?? "NB_SETUP_FMD"}</span>
              {preflight.notebook?.id && (
                <span className="text-[10px] block" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-muted)' }}>{preflight.notebook.id}</span>
              )}
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 flex-shrink-0" style={
              preflight.notebook?.exists
                ? { color: 'var(--bp-operational)', background: 'var(--bp-operational-light)' }
                : { color: 'var(--bp-fault)', background: 'var(--bp-fault-light)' }
            }>
              {preflight.notebook?.exists ? "Ready" : "Not found"}
            </span>
          </div>
        </div>

        {!preflight.ready && (
          <div className="rounded-lg p-3" style={{ background: 'var(--bp-fault-light)', border: '1px solid var(--bp-fault)' }}>
            <p className="text-xs" style={{ color: 'var(--bp-fault)' }}>
              The setup notebook was not found in the Config workspace. Deploy it to the Config
              workspace before running the deployment wizard.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => setStep("confirm")}
            disabled={!preflight.ready}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              preflight.ready ? "bp-btn-primary" : ""
            }`}
            style={!preflight.ready ? { background: 'var(--bp-surface-inset)', color: 'var(--bp-ink-muted)', cursor: 'not-allowed' } : undefined}
          >
            Continue to Deploy
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setStep("config")}
            className="px-4 py-2.5 text-sm transition-colors"
            style={{ color: 'var(--bp-ink-tertiary)' }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // ── CONFIRM — final warning ──
  if (step === "confirm") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--bp-fault-light)', border: '1px solid var(--bp-fault)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" style={{ color: 'var(--bp-fault)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--bp-fault)' }}>
              This will deploy the entire FMD framework
            </span>
          </div>
          <div className="text-sm space-y-2" style={{ color: 'var(--bp-ink-secondary)' }}>
            <p>The setup notebook will:</p>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li>Create or update DEV and PROD workspaces</li>
              <li>Deploy all lakehouses, pipelines, notebooks, and variable libraries</li>
              <li>Create the SQL metadata database</li>
              <li>Create the Fabric Pipelines connection</li>
              <li>Assign workspace roles and managed identities</li>
              <li>Replace all template IDs with real deployed IDs</li>
            </ul>
            <p className="text-xs mt-2">
              Existing items with matching names will be overwritten.
              This typically takes <strong>5-15 minutes</strong>.
            </p>
          </div>

          <div className="rounded-lg p-3 space-y-1" style={{ background: 'var(--bp-fault-light)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--bp-fault)' }}>What happens when you click Deploy:</p>
            <ul className="text-xs space-y-0.5" style={{ color: 'var(--bp-ink-secondary)' }}>
              <li>Old DEV and PROD workspaces will be <strong>automatically deleted</strong></li>
              <li>The CONFIG workspace is preserved (it holds the setup notebook)</li>
              <li>The setup notebook will recreate everything from scratch</li>
            </ul>
          </div>
        </div>

        <div className="rounded-lg p-3 text-xs space-y-1.5" style={{ background: 'var(--bp-surface-inset)', color: 'var(--bp-ink-tertiary)' }}>
          <div className="flex items-center gap-2">
            <span>Config Workspace:</span>
            <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>
              {fabricWorkspaces.find((w) => w.id === fields.workspace_config)?.displayName || fields.workspace_config}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>SQL Connection:</span>
            <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>
              {fabricConnections.find((c) => c.id === fields.con_fmd_fabric_sql)?.displayName || fields.con_fmd_fabric_sql}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>Lakehouse Schemas:</span>
            <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>{fields.lakehouse_schema_enabled === "true" ? "Enabled" : "Disabled"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Roles:</span>
            <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>Fabric-PowerBI-API (Contributor) + FabricAdmins (Admin)</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleDeploy}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--bp-fault)', color: 'var(--bp-surface-1)' }}
          >
            <Rocket className="h-4 w-4" />
            Deploy Now
          </button>
          <button
            onClick={() => setStep("preflight")}
            className="px-4 py-2.5 text-sm transition-colors"
            style={{ color: 'var(--bp-ink-tertiary)' }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // ── RUNNING — live status with log feed ──
  if (step === "running") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--bp-copper-light)', border: '1px solid var(--bp-copper)' }}>
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" style={{ color: 'var(--bp-copper)' }} />
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: 'var(--bp-ink-primary)' }}>
                Framework deployment in progress...
              </p>
              <div className="flex items-center gap-4 mt-1">
                <span className="text-xs flex items-center gap-1" style={{ color: 'var(--bp-copper)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                  <Clock className="h-3 w-3" /> {formatElapsed(elapsed)}
                </span>
                {jobStatus && (
                  <span className="text-xs" style={{ color: 'var(--bp-copper)', fontFamily: 'var(--bp-font-mono)' }}>
                    Fabric: {jobStatus.status}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Activity log — terminal keeps dark bg per spec */}
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bp-code-block)', border: '1px solid var(--bp-border)' }}>
          <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--bp-operational)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>Deployment Log</span>
          </div>
          <div className="px-4 py-3 max-h-64 overflow-y-auto text-xs space-y-1.5" style={{ fontFamily: 'var(--bp-font-mono)' }}>
            {logMessages.map((msg, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="flex-shrink-0 select-none" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {DEPLOY_PHASES[i] != null ? formatElapsed(DEPLOY_PHASES[i].after) : '\u00A0\u00A0\u00A0'}
                </span>
                <CheckCircle2 className="h-3 w-3 flex-shrink-0 mt-0.5" style={{ color: 'var(--bp-operational)' }} />
                <span style={{ color: 'rgba(255,255,255,0.8)' }}>{msg}</span>
              </div>
            ))}
            {phasesEmitted.current < DEPLOY_PHASES.length && (
              <div className="flex items-start gap-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <span className="flex-shrink-0 select-none">&nbsp;&nbsp;&nbsp;&nbsp;</span>
                <Loader2 className="h-3 w-3 animate-spin flex-shrink-0 mt-0.5" />
                <span className="animate-pulse">
                  {DEPLOY_PHASES[phasesEmitted.current]?.msg.replace("...", "") ?? "Processing"}...
                </span>
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        <p className="text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>
          Log messages are estimated based on typical deployment timing.
          The notebook continues running in Fabric regardless of this view.
        </p>
      </div>
    );
  }

  // ── DONE ──
  if (step === "done") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--bp-operational-light)', border: '1px solid var(--bp-operational)' }}>
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--bp-operational)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--bp-operational)' }}>
                Framework deployed successfully
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--bp-ink-secondary)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                Completed in {formatElapsed(elapsed)}
                {jobStatus?.endTime && !isNaN(new Date(jobStatus.endTime).getTime()) && (
                  <> &bull; Finished at {new Date(jobStatus.endTime).toLocaleTimeString()}</>
                )}
              </p>
            </div>
          </div>
          <div className="mt-3 text-xs space-y-1" style={{ color: 'var(--bp-ink-secondary)' }}>
            <p>Next steps:</p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li>Refresh the dashboard to pick up new workspace/pipeline data</li>
              <li>Check the Config Manager to verify all GUIDs match</li>
              <li>Register data sources in the Source Manager</li>
            </ul>
          </div>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-2 px-4 py-2 text-sm transition-colors"
          style={{ color: 'var(--bp-ink-tertiary)' }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Back to Settings
        </button>
      </div>
    );
  }

  // ── FAILED ──
  if (step === "failed") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--bp-fault-light)', border: '1px solid var(--bp-fault)' }}>
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--bp-fault)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--bp-fault)' }}>
                Deployment failed
              </p>
              {error && (
                <p className="text-xs mt-1 break-all" style={{ color: 'var(--bp-ink-secondary)', fontFamily: 'var(--bp-font-mono)' }}>
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStep("confirm")}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors"
            style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border)', color: 'var(--bp-ink-primary)' }}
          >
            Retry
          </button>
          <button
            onClick={reset}
            className="px-4 py-2 text-sm transition-colors"
            style={{ color: 'var(--bp-ink-tertiary)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ============================================================================
// SUB-NAVIGATION TABS
// ============================================================================

const SETTINGS_TABS = [
  { id: 'general', label: 'General', icon: Cog },
  { id: 'deployment', label: 'Deployment', icon: Rocket },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

// ============================================================================
// GENERAL TAB CONTENT (original Settings content)
// ============================================================================

export function GeneralTab() {
  const [flags, setFlags] = useState<LabsFlags>(getLabsFlags);

  const toggle = useCallback((key: keyof LabsFlags) => {
    const updated = setLabsFlag(key, !flags[key]);
    setFlags(updated);
  }, [flags]);

  const enabledCount = Object.values(flags).filter(Boolean).length;

  return (
    <div className="space-y-8 max-w-2xl">
      {/* ── Notebook Deployment (legacy) ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Rocket className="w-5 h-5" style={{ color: 'var(--bp-copper)' }} />
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-display)' }}>Notebook Deployment</h2>
            <p className="text-xs" style={{ color: 'var(--bp-ink-tertiary)' }}>
              Deploy via the setup notebook (legacy). For script-based deployment, use the Deployment tab.
            </p>
          </div>
        </div>

        <div className="rounded-lg px-5 py-5" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
          <DeployWizard />
        </div>
      </div>

      {/* ── Labs Section ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-5 h-5" style={{ color: 'var(--bp-caution)' }} />
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-display)' }}>Labs</h2>
            <p className="text-xs" style={{ color: 'var(--bp-ink-tertiary)' }}>
              Experimental features under active development. Enable them to add new pages to the sidebar.
            </p>
          </div>
          {enabledCount > 0 && (
            <span className="ml-auto text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ color: 'var(--bp-caution)', background: 'var(--bp-caution-light)', border: '1px solid var(--bp-caution)' }}>
              {enabledCount} enabled
            </span>
          )}
        </div>

        <div className="space-y-3">
          {LAB_FEATURES.map((feature) => {
            const enabled = flags[feature.key];
            return (
              <div
                key={feature.key}
                className="rounded-lg px-5 py-4 transition-all"
                style={{
                  border: enabled ? '1px solid var(--bp-copper)' : '1px solid var(--bp-border)',
                  background: 'var(--bp-surface-1)',
                  boxShadow: enabled ? '0 1px 3px rgba(0,0,0,0.04)' : 'none',
                }}
              >
                <div className="flex items-start gap-4">
                  <feature.icon className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: feature.colorVar }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)' }}>{feature.label}</h3>
                      {enabled && (
                        <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5" style={{ color: 'var(--bp-operational)', background: 'var(--bp-operational-light)' }}>
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--bp-ink-tertiary)' }}>
                      {feature.description}
                    </p>
                  </div>
                  <button
                    onClick={() => toggle(feature.key)}
                    className="flex-shrink-0 cursor-pointer transition-colors"
                    title={enabled ? "Disable" : "Enable"}
                    aria-label={`${enabled ? "Disable" : "Enable"} ${feature.label}`}
                    aria-pressed={enabled}
                    role="switch"
                  >
                    {enabled ? (
                      <ToggleRight className="w-8 h-8" style={{ color: 'var(--bp-copper)' }} />
                    ) : (
                      <ToggleLeft className="w-8 h-8" style={{ color: 'var(--bp-ink-muted)' }} />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] ml-8" style={{ color: 'var(--bp-ink-muted)' }}>
          Changes take effect immediately. Labs features appear under the "Labs" group in the sidebar.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN SETTINGS COMPONENT (with sub-navigation)
// ============================================================================

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('tab') as SettingsTab) || 'general';
  });

  // Sync tab to URL
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeTab === 'general') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', activeTab);
    }
    window.history.replaceState({}, '', url.toString());
  }, [activeTab]);

  return (
    <div className="flex gap-6 min-h-0" style={{ padding: '32px', maxWidth: '1280px' }}>
      {/* Left sub-nav */}
      <div className="w-44 flex-shrink-0">
        <div className="flex items-center gap-2 mb-4 px-2">
          <SettingsIcon className="w-4 h-4" style={{ color: 'var(--bp-ink-tertiary)' }} />
          <h1 style={{ fontFamily: "var(--bp-font-display)", fontSize: '32px', color: 'var(--bp-ink-primary)', lineHeight: '1.1' }}>
            Settings
          </h1>
        </div>
        <nav className="space-y-0.5" aria-label="Settings sections">
          {SETTINGS_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                aria-current={isActive ? 'page' : undefined}
                style={isActive
                  ? { background: 'var(--bp-copper-light)', color: 'var(--bp-copper)', border: '1px solid var(--bp-copper)' }
                  : { color: 'var(--bp-ink-tertiary)', border: '1px solid transparent' }
                }
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {activeTab === 'general' && <GeneralTab />}
        {activeTab === 'deployment' && <DeploymentManager />}
      </div>
    </div>
  );
}
