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
  MessageSquareMore,
} from "lucide-react";
import { getLabsFlags, setLabsFlag, type LabsFlags } from "@/lib/featureFlags";
import DeploymentManager from "./settings/DeploymentManager";
import AgentCollaboration from "./settings/AgentCollaboration";

const API = "http://localhost:8787/api";

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
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const LAB_FEATURES: LabFeature[] = [
  {
    key: "cleansingRuleEditor",
    label: "Cleansing Rule Editor",
    description:
      "View and manage the JSON cleansing rules applied during Bronze → Silver transformation. Build rules visually instead of writing SQL inserts.",
    icon: Sparkles,
    color: "text-violet-500",
  },
  {
    key: "scdAuditView",
    label: "SCD Audit View",
    description:
      "Track inserts, updates, and deletes per Silver table per pipeline run. Surfaces the SCD Type 2 change tracking that the framework already logs.",
    icon: ClipboardCheck,
    color: "text-emerald-500",
  },
  {
    key: "goldMlvManager",
    label: "Gold Layer / MLV Manager",
    description:
      "View which Materialized Lakehouse Views exist in the Gold layer, what Silver tables they reference, and their current state.",
    icon: Layers3,
    color: "text-amber-500",
  },
  {
    key: "dqScorecard",
    label: "DQ Scorecard",
    description:
      "Data quality metrics per table — null rates, duplicate counts, cleansing rule pass/fail rates. Surfaces checks already run by the DQ cleansing notebook.",
    icon: ShieldCheck,
    color: "text-sky-500",
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
  const [securityGroups, setSecurityGroups] = useState<{ id: string; displayName: string; description: string }[]>([]);
  const [fabricLoading, setFabricLoading] = useState(false);

  // Load existing config + live Fabric data to populate dropdowns
  useEffect(() => {
    if (step === "config") {
      setFabricLoading(true);

      // Fetch existing config, live workspaces, connections, and security groups in parallel
      Promise.all([
        fetchJson<{
          itemConfig: { workspaces?: Record<string, string>; connections?: Record<string, string> };
        }>("/notebook-config").catch(() => null),
        fetchJson<{ workspaces: { id: string; displayName: string }[] }>("/fabric/workspaces").catch(() => ({ workspaces: [] })),
        fetchJson<{ connections: { id: string; displayName: string; type: string }[] }>("/fabric/connections").catch(() => ({ connections: [] })),
        fetchJson<{ groups: { id: string; displayName: string; description: string }[] }>("/fabric/security-groups").catch(() => ({ groups: [] })),
      ]).then(([config, ws, conns, groups]) => {
        setFabricWorkspaces(ws?.workspaces ?? []);
        setFabricConnections(conns?.connections ?? []);
        setSecurityGroups(groups?.groups ?? []);

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
      // Auto-scroll log
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

    const firstPoll = setTimeout(() => {
      poll();
      pollRef.current = setInterval(poll, 5000);
    }, 5000);
    pollRef.current = firstPoll as unknown as ReturnType<typeof setInterval>;
  }, [stopPolling]);

  const handleDeploy = async () => {
    setStep("running");
    setError(null);
    setJobStatus(null);
    setLogMessages([]);
    phasesEmitted.current = 0;

    try {
      // Step 1: Save config values
      setLogMessages(["Saving configuration values..."]);
      await postJson("/notebook-config/update", {
        target: "item_config",
        section: "workspaces",
        key: "workspace_config",
        newValue: fields.workspace_config,
      });
      await postJson("/notebook-config/update", {
        target: "item_config",
        section: "connections",
        key: "CON_FMD_FABRIC_SQL",
        newValue: fields.con_fmd_fabric_sql,
      });
      setLogMessages((prev) => [...prev, "Configuration saved."]);

      // Step 2: Wipe old workspaces + trigger notebook
      setLogMessages((prev) => [...prev, "Deleting old workspaces and triggering setup notebook..."]);
      const res = await postJson<{
        success?: boolean;
        notebookId?: string;
        workspaceId?: string;
        error?: string;
        deleteLog?: string[];
      }>("/deploy/wipe-and-trigger", {});

      // Show the delete log entries
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
      // Set phasesEmitted past the first 2 phases (we already logged them manually)
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
        <p className="text-sm text-muted-foreground leading-relaxed">
          Run the setup notebook to deploy or redeploy the entire FMD framework to Microsoft Fabric.
          This creates workspaces, lakehouses, pipelines, connections, variable libraries, and the
          metadata database.
        </p>
        <button
          onClick={() => setStep("config")}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
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
    // Filter to only FabricSql connections for the SQL dropdown
    const sqlConnections = fabricConnections.filter(
      (c) => c.type === 'FabricSql' || c.displayName.startsWith('CON_FMD')
    );

    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Select your Fabric resources below. {fabricLoading ? "Loading live data from Fabric..." : "Dropdowns are populated from your live Fabric environment."}
        </p>

        {fabricLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Connecting to Fabric and loading workspaces &amp; connections...
          </div>
        )}

        <div className="space-y-5">
          {/* Config Workspace — dropdown */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              Config Workspace <span className="text-red-500 text-xs">*</span>
              {prefilledFrom.includes("workspace_config") && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/10 rounded px-1.5 py-0.5">
                  Pre-filled
                </span>
              )}
            </label>
            <p className="text-xs text-muted-foreground">The workspace that holds NB_SETUP_FMD. This workspace survives the wipe.</p>
            <select
              value={fields.workspace_config || ""}
              onChange={(e) => setFields({ ...fields, workspace_config: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            >
              <option value="">Select a workspace...</option>
              {fabricWorkspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.displayName}
                </option>
              ))}
            </select>
            {selectedWsName && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {selectedWsName}
                <span className="text-muted-foreground/50 font-mono ml-1">({fields.workspace_config})</span>
              </p>
            )}
          </div>

          {/* Fabric SQL Connection — dropdown */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              Fabric SQL Connection <span className="text-red-500 text-xs">*</span>
              {prefilledFrom.includes("con_fmd_fabric_sql") && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/10 rounded px-1.5 py-0.5">
                  Pre-filled
                </span>
              )}
            </label>
            <p className="text-xs text-muted-foreground">The CON_FMD_FABRIC_SQL connection. Must be created manually in Fabric first.</p>
            <select
              value={fields.con_fmd_fabric_sql || ""}
              onChange={(e) => setFields({ ...fields, con_fmd_fabric_sql: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            >
              <option value="">Select a connection...</option>
              {sqlConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} ({c.type})
                </option>
              ))}
              {/* If the pre-filled value isn't in the filtered list, show all connections */}
              {fields.con_fmd_fabric_sql && !sqlConnections.find((c) => c.id === fields.con_fmd_fabric_sql) && (
                <option value={fields.con_fmd_fabric_sql}>
                  {fabricConnections.find((c) => c.id === fields.con_fmd_fabric_sql)?.displayName || fields.con_fmd_fabric_sql}
                </option>
              )}
            </select>
            {selectedConnName && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {selectedConnName}
                <span className="text-muted-foreground/50 font-mono ml-1">({fields.con_fmd_fabric_sql})</span>
              </p>
            )}
          </div>

          {/* Lakehouse Schemas — simple toggle-style select */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              Enable Lakehouse Schemas <span className="text-red-500 text-xs">*</span>
            </label>
            <p className="text-xs text-muted-foreground">Create lakehouses with schema support enabled.</p>
            <select
              value={fields.lakehouse_schema_enabled || "true"}
              onChange={(e) => setFields({ ...fields, lakehouse_schema_enabled: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            >
              <option value="true">Yes (recommended)</option>
              <option value="false">No</option>
            </select>
          </div>

          {/* Workspace & Connection Roles — multi-select chip style */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Workspace &amp; Connection Roles
            </label>
            <p className="text-xs text-muted-foreground">Principals auto-assigned to all created workspaces and connections.</p>
            <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-background px-3 py-2.5 min-h-[38px]">
              <span className="inline-flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 rounded-full pl-2.5 pr-2 py-1 text-xs font-medium">
                Fabric-PowerBI-API
                <span className="text-[9px] text-blue-500/70 font-normal">Contributor</span>
              </span>
              <span className="inline-flex items-center gap-1.5 bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300 rounded-full pl-2.5 pr-2 py-1 text-xs font-medium">
                FabricAdmins
                <span className="text-[9px] text-violet-500/70 font-normal">Admin</span>
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground/60">
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
                // Save config first so preflight reads fresh values
                await postJson("/notebook-config/update", {
                  target: "item_config", section: "workspaces",
                  key: "workspace_config", newValue: fields.workspace_config,
                });
                await postJson("/notebook-config/update", {
                  target: "item_config", section: "connections",
                  key: "CON_FMD_FABRIC_SQL", newValue: fields.con_fmd_fabric_sql,
                });
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
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            }`}
          >
            {preflightLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Scanning Fabric...</>
            ) : (
              <>Continue <ArrowRight className="h-4 w-4" /></>
            )}
          </button>
          <button
            onClick={reset}
            className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
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
        <p className="text-sm text-muted-foreground">
          Scanned your Fabric environment. Here's what was found:
        </p>

        {/* Workspaces */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Workspaces</h3>
          <div className="space-y-1">
            {preflight.workspaces.map((ws) => (
              <div key={ws.label} className="flex items-center gap-3 text-sm px-3 py-2.5 rounded-lg bg-muted/50">
                {ws.exists ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-zinc-400 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-medium">
                      {ws.displayName || ws.label}
                    </span>
                    {ws.displayName && ws.displayName !== ws.label && (
                      <span className="text-[10px] text-muted-foreground">({ws.label})</span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground/60 block">{ws.id || "—"}</span>
                </div>
                {ws.exists && ws.willDelete && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-red-500 bg-red-500/10 rounded px-1.5 py-0.5 flex-shrink-0">
                    Will be deleted
                  </span>
                )}
                {ws.exists && !ws.willDelete && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/10 rounded px-1.5 py-0.5 flex-shrink-0">
                    Kept
                  </span>
                )}
                {!ws.exists && ws.willDelete && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-blue-500 bg-blue-500/10 rounded px-1.5 py-0.5 flex-shrink-0">
                    Will be created
                  </span>
                )}
                {!ws.exists && !ws.willDelete && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-red-500 bg-red-500/10 rounded px-1.5 py-0.5 flex-shrink-0">
                    Not found
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Connections */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Connections</h3>
          <div className="space-y-1">
            {preflight.connections.map((conn) => (
              <div key={conn.label} className="flex items-center gap-3 text-sm px-3 py-2.5 rounded-lg bg-muted/50">
                {conn.exists ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-zinc-400 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-medium">
                      {conn.displayName || conn.label}
                    </span>
                    {conn.displayName && conn.displayName !== conn.label && (
                      <span className="text-[10px] text-muted-foreground">({conn.label})</span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground/60 block">{conn.id || "—"}</span>
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 flex-shrink-0 ${
                  conn.exists
                    ? "text-emerald-500 bg-emerald-500/10"
                    : "text-amber-500 bg-amber-500/10"
                }`}>
                  {conn.exists ? "Found" : "Missing"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Setup Notebook */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Setup Notebook</h3>
          <div className="flex items-center gap-3 text-sm px-3 py-2.5 rounded-lg bg-muted/50">
            {preflight.notebook?.exists ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <span className="text-foreground font-medium">{preflight.notebook?.name ?? "NB_SETUP_FMD"}</span>
              {preflight.notebook?.id && (
                <span className="text-[10px] font-mono text-muted-foreground/60 block">{preflight.notebook.id}</span>
              )}
            </div>
            <span className={`text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 flex-shrink-0 ${
              preflight.notebook?.exists
                ? "text-emerald-500 bg-emerald-500/10"
                : "text-red-500 bg-red-500/10"
            }`}>
              {preflight.notebook?.exists ? "Ready" : "Not found"}
            </span>
          </div>
        </div>

        {!preflight.ready && (
          <div className="bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-500/40 rounded-lg p-3">
            <p className="text-xs text-red-700 dark:text-red-400">
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
              preflight.ready
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            }`}
          >
            Continue to Deploy
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setStep("config")}
            className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
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
        <div className="bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-500/40 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-300">
              This will deploy the entire FMD framework
            </span>
          </div>
          <div className="text-sm text-red-700 dark:text-red-400 space-y-2">
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
              This typically takes <strong>5–15 minutes</strong>.
            </p>
          </div>

          <div className="bg-red-100 dark:bg-red-900/40 rounded-lg p-3 space-y-1">
            <p className="text-xs font-semibold text-red-700 dark:text-red-300">What happens when you click Deploy:</p>
            <ul className="text-xs text-red-600 dark:text-red-400 space-y-0.5">
              <li>• Old DEV and PROD workspaces will be <strong>automatically deleted</strong></li>
              <li>• The CONFIG workspace is preserved (it holds the setup notebook)</li>
              <li>• The setup notebook will recreate everything from scratch</li>
            </ul>
          </div>
        </div>

        <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1.5 text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Config Workspace:</span>
            <span className="text-foreground font-medium">
              {fabricWorkspaces.find((w) => w.id === fields.workspace_config)?.displayName || fields.workspace_config}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>SQL Connection:</span>
            <span className="text-foreground font-medium">
              {fabricConnections.find((c) => c.id === fields.con_fmd_fabric_sql)?.displayName || fields.con_fmd_fabric_sql}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>Lakehouse Schemas:</span>
            <span className="text-foreground font-medium">{fields.lakehouse_schema_enabled === "true" ? "Enabled" : "Disabled"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Roles:</span>
            <span className="text-foreground font-medium">Fabric-PowerBI-API (Contributor) + FabricAdmins (Admin)</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleDeploy}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Rocket className="h-4 w-4" />
            Deploy Now
          </button>
          <button
            onClick={() => setStep("preflight")}
            className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
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
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-300 dark:border-blue-500/30 rounded-xl p-5">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                Framework deployment in progress...
              </p>
              <div className="flex items-center gap-4 mt-1">
                <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatElapsed(elapsed)}
                </span>
                {jobStatus && (
                  <span className="text-xs text-blue-600 dark:text-blue-400 font-mono">
                    Fabric: {jobStatus.status}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Activity log */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-zinc-400">Deployment Log</span>
          </div>
          <div className="px-4 py-3 max-h-64 overflow-y-auto font-mono text-xs space-y-1.5">
            {logMessages.map((msg, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-zinc-600 flex-shrink-0 select-none">
                  {formatElapsed(DEPLOY_PHASES[i]?.after ?? 0)}
                </span>
                <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                <span className="text-zinc-300">{msg}</span>
              </div>
            ))}
            {/* Current activity indicator */}
            {phasesEmitted.current < DEPLOY_PHASES.length && (
              <div className="flex items-start gap-2 text-zinc-500">
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

        <p className="text-[10px] text-muted-foreground/60">
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
        <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-500/30 rounded-xl p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Framework deployed successfully
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                Completed in {formatElapsed(elapsed)}
                {jobStatus?.endTime && (
                  <> &bull; Finished at {new Date(jobStatus.endTime).toLocaleTimeString()}</>
                )}
              </p>
            </div>
          </div>
          <div className="mt-3 text-xs text-emerald-600 dark:text-emerald-400 space-y-1">
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
          className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
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
        <div className="bg-red-50 dark:bg-red-950 border border-red-300 dark:border-red-500/30 rounded-xl p-5">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                Deployment failed
              </p>
              {error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-mono break-all">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStep("confirm")}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg border border-border text-foreground transition-colors"
          >
            Retry
          </button>
          <button
            onClick={reset}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
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
  { id: 'agents', label: 'Agent Collab', icon: MessageSquareMore },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

// ============================================================================
// GENERAL TAB CONTENT (original Settings content)
// ============================================================================

function GeneralTab() {
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
          <Rocket className="w-5 h-5 text-blue-500" />
          <div>
            <h2 className="font-display text-base font-semibold">Notebook Deployment</h2>
            <p className="text-xs text-muted-foreground">
              Deploy via the setup notebook (legacy). For script-based deployment, use the Deployment tab.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card px-5 py-5">
          <DeployWizard />
        </div>
      </div>

      {/* ── Labs Section ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-5 h-5 text-amber-500" />
          <div>
            <h2 className="font-display text-base font-semibold">Labs</h2>
            <p className="text-xs text-muted-foreground">
              Experimental features under active development. Enable them to add new pages to the sidebar.
            </p>
          </div>
          {enabledCount > 0 && (
            <span className="ml-auto text-[10px] font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
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
                className={`rounded-lg border bg-card px-5 py-4 transition-all ${
                  enabled ? "border-primary/30 shadow-sm" : "border-border"
                }`}
              >
                <div className="flex items-start gap-4">
                  <feature.icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${feature.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{feature.label}</h3>
                      {enabled && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/10 rounded px-1.5 py-0.5">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                  <button
                    onClick={() => toggle(feature.key)}
                    className="flex-shrink-0 cursor-pointer text-foreground/60 hover:text-foreground transition-colors"
                    title={enabled ? "Disable" : "Enable"}
                  >
                    {enabled ? (
                      <ToggleRight className="w-8 h-8 text-primary" />
                    ) : (
                      <ToggleLeft className="w-8 h-8" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-muted-foreground/60 ml-8">
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
    <div className="flex gap-6 min-h-0">
      {/* Left sub-nav */}
      <div className="w-44 flex-shrink-0">
        <div className="flex items-center gap-2 mb-4 px-2">
          <SettingsIcon className="w-4 h-4 text-muted-foreground" />
          <h1 className="font-display text-sm font-semibold tracking-tight text-muted-foreground">
            Settings
          </h1>
        </div>
        <nav className="space-y-0.5">
          {SETTINGS_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card border border-transparent'
                }`}
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
        {activeTab === 'agents' && <AgentCollaboration />}
      </div>
    </div>
  );
}
