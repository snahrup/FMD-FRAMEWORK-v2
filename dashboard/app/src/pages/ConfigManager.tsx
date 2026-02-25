import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  GitBranch,
  Cable,
  Layers3,
  Settings2,
  RefreshCw,
  Pencil,
  Save,
  X,
  Zap,
  FileJson,
  Server,
  ArrowRight,
  Copy,
  Shield,
  ChevronDown,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Rocket,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";

const API = "http://localhost:8787/api";
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CascadeRef {
  location: string;
  target: string;
  params: Record<string, unknown>;
  field: string;
}

interface CascadePrompt {
  oldValue: string;
  newValue: string;
  references: CascadeRef[];
}

interface Mismatch {
  severity: string;
  category: string;
  pipeline?: string;
  field: string;
  current: string;
  expected: string;
  message: string;
}

interface DeployResult {
  success: boolean;
  deployed: number;
  failed: number;
  total: number;
  results: {
    workspace: string;
    pipeline: string;
    success: boolean;
    replacements?: number;
    deactivated?: number;
    httpStatus?: number;
    error?: string;
  }[];
}

interface FabricItem {
  id: string;
  displayName: string;
  type: string;
}

interface ConfigData {
  database: {
    workspaces: Record<string, string>[];
    lakehouses: Record<string, string>[];
    connections: Record<string, string>[];
    datasources: Record<string, string>[];
    pipelines: Record<string, string>[];
  };
  itemConfig: Record<string, any>;
  pipelineConfigs: {
    name: string;
    wsParamDefault: string | null;
    connectionRefs: string[];
    invokeRefs: { name: string; pipelineId: string; workspaceId: string }[];
    allParams: Record<string, string>;
    error?: string;
  }[];
  variableLibrary: {
    variables: { name: string; type: string; value: string }[];
    valueSets: Record<string, { name: string; value: string }[]>;
  };
  dashboardConfig: Record<string, Record<string, string>>;
  mismatches: Mismatch[];
  fabricEntities?: {
    workspaces: Record<string, string>; // guid → displayName
    items: Record<string, FabricItem[]>; // workspace guid → items[]
  };
  fabricConnections?: {
    id: string;
    displayName: string;
    type: string;
    credentialType: string;
  }[];
}

// ── Friendly Name Mappings (Business mode) ──

const FRIENDLY_WORKSPACE_KEYS: Record<string, string> = {
  workspace_data: "Data Workspace (Dev)",
  workspace_code: "Code Workspace (Dev)",
  workspace_config: "Config Workspace",
  workspace_data_prod: "Data Workspace (Prod)",
  workspace_code_prod: "Code Workspace (Prod)",
  workspace_business_domain_data: "Business Domain — Data",
  workspace_business_domain_code: "Business Domain — Code",
  workspace_business_domain_reporting: "Business Domain — Reporting",
};

const FRIENDLY_CONNECTION_KEYS: Record<string, string> = {
  CON_FMD_FABRIC_SQL: "Fabric SQL Connection",
  CON_FMD_FABRIC_PIPELINES: "Fabric Pipelines Connection",
  CON_FMD_ADF_PIPELINES: "ADF Pipelines Connection",
  CON_FMD_FABRIC_NOTEBOOKS: "Fabric Notebooks Connection",
};

const FRIENDLY_DB_KEYS: Record<string, string> = {
  displayName: "Database Name",
  id: "Database ID",
  endpoint: "SQL Endpoint",
};

const FRIENDLY_PIPELINE_NAMES: Record<string, string> = {
  PL_FMD_LOAD_ALL: "Master Orchestrator",
  PL_FMD_LOAD_LANDINGZONE: "Landing Zone Loader",
  PL_FMD_LOAD_BRONZE: "Bronze Layer Loader",
  PL_FMD_LOAD_SILVER: "Silver Layer Loader",
  PL_FMD_LDZ_COMMAND_ADF: "LZ Command — ADF",
  PL_FMD_LDZ_COMMAND_ADLS: "LZ Command — ADLS",
  PL_FMD_LDZ_COMMAND_ASQL: "LZ Command — Azure SQL",
  PL_FMD_LDZ_COMMAND_FTP: "LZ Command — FTP",
  PL_FMD_LDZ_COMMAND_NOTEBOOK: "LZ Command — Notebook",
  PL_FMD_LDZ_COMMAND_ONELAKE: "LZ Command — OneLake",
  PL_FMD_LDZ_COMMAND_ORACLE: "LZ Command — Oracle",
  PL_FMD_LDZ_COMMAND_SFTP: "LZ Command — SFTP",
  PL_FMD_LDZ_COPY_FROM_ADF: "Copy from ADF",
  PL_FMD_LDZ_COPY_FROM_ADLS_01: "Copy from ADLS",
  PL_FMD_LDZ_COPY_FROM_ASQL_01: "Copy from Azure SQL",
  PL_FMD_LDZ_COPY_FROM_CUSTOM_NB: "Copy from Custom Notebook",
  PL_FMD_LDZ_COPY_FROM_FTP_01: "Copy from FTP",
  PL_FMD_LDZ_COPY_FROM_ONELAKE_FILES_01: "Copy from OneLake Files",
  PL_FMD_LDZ_COPY_FROM_ONELAKE_TABLES_01: "Copy from OneLake Tables",
  PL_FMD_LDZ_COPY_FROM_ORACLE_01: "Copy from Oracle",
  PL_FMD_LDZ_COPY_FROM_SFTP_01: "Copy from SFTP",
  PL_TOOLING_POST_ASQL_TO_FMD: "Tooling — Post SQL to FMD",
};

const FRIENDLY_TABLE_NAMES: Record<string, string> = {
  "integration.Workspace": "Workspaces table",
  "integration.Lakehouse": "Lakehouses table",
  "integration.Connection": "Connections table",
  "integration.DataSource": "Data Sources table",
  "integration.Pipeline": "Pipelines table",
};

const FRIENDLY_CONFIG_SECTIONS: Record<string, string> = {
  fabric: "Fabric API Settings",
  sql: "Database Connection",
  server: "Web Server",
  purview: "Purview Integration",
  logging: "Logging",
};

const FRIENDLY_CONFIG_KEYS: Record<string, Record<string, string>> = {
  fabric: {
    tenant_id: "Azure Tenant",
    client_id: "Service Principal ID",
    client_secret: "Service Principal Secret",
    workspace_data_id: "Data Workspace ID",
    workspace_code_id: "Code Workspace ID",
  },
  sql: {
    server: "SQL Server Endpoint",
    database: "Database Name",
    driver: "ODBC Driver",
  },
  server: {
    host: "Listen Address",
    port: "Port",
    static_dir: "Static Files Directory",
  },
  purview: {
    account_name: "Purview Account",
  },
  logging: {
    file: "Log File",
    level: "Log Level",
  },
};

const FRIENDLY_DS_TYPES: Record<string, string> = {
  ASQL_01: "Azure SQL",
  ADLS_01: "Azure Data Lake Storage",
  ONELAKE_FILES_01: "OneLake (Files)",
  ONELAKE_TABLES_01: "OneLake (Tables)",
  FTP_01: "FTP Server",
  SFTP_01: "SFTP Server",
  ORACLE_01: "Oracle Database",
  ADF: "Azure Data Factory",
  CUSTOM_NB: "Custom Notebook",
};

const FRIENDLY_VAR_NAMES: Record<string, string> = {
  VAR_CONFIG_FMD_WORKSPACE_DATA: "Data Workspace GUID",
  VAR_CONFIG_FMD_WORKSPACE_CODE: "Code Workspace GUID",
  VAR_CONFIG_FMD_SQL_SERVER: "SQL Server Endpoint",
  VAR_CONFIG_FMD_SQL_DATABASE: "SQL Database Name",
  VAR_CONFIG_FMD_SQL_DATABASE_ID: "SQL Database ID",
  VAR_CONFIG_FMD_LAKEHOUSE_LDZ: "Landing Zone Lakehouse",
  VAR_CONFIG_FMD_LAKEHOUSE_BRONZE: "Bronze Layer Lakehouse",
  VAR_CONFIG_FMD_LAKEHOUSE_SILVER: "Silver Layer Lakehouse",
};

function friendlyName(key: string, map: Record<string, string>): string {
  return map[key] ?? key;
}

function friendlyCodeRef(ref: string, biz: boolean): string {
  if (!biz) return ref;
  return FRIENDLY_TABLE_NAMES[ref] ?? ref;
}

// ── Helpers ──

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

// ── Shared Components ──

function SectionHeader({ icon: Icon, title, count, defaultOpen = true, children }: {
  icon: React.ElementType; title: string; count?: number; defaultOpen?: boolean; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 mb-3 w-full text-left group cursor-pointer"
      >
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {count !== undefined && (
          <span className="text-sm bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full">{count}</span>
        )}
        <span className="ml-auto text-muted-foreground group-hover:text-foreground transition-colors">
          {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </span>
      </button>
      {open && children}
    </div>
  );
}

function EditableCell({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <span className="group inline-flex items-center gap-1.5">
        <code className="text-sm font-mono text-foreground">{value || <span className="italic text-muted-foreground">empty</span>}</code>
        <button
          onClick={() => { setDraft(value); setEditing(true); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        className="text-sm font-mono bg-background border border-border rounded px-2 py-1 text-foreground w-80 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setSaving(true);
            onSave(draft).then(() => { setEditing(false); setSaving(false); });
          }
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button
        disabled={saving}
        onClick={() => {
          setSaving(true);
          onSave(draft).then(() => { setEditing(false); setSaving(false); });
        }}
        className="p-1 hover:bg-emerald-900/50 rounded"
      >
        <Save className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
      </button>
      <button onClick={() => setEditing(false)} className="p-1 hover:bg-muted rounded">
        <X className="h-4 w-4 text-muted-foreground" />
      </button>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1 hover:bg-muted rounded"
      title="Copy"
    >
      {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-4 w-4 text-muted-foreground hover:text-foreground" />}
    </button>
  );
}

/** Click-to-copy entity display — shows name by default, GUID on demand */
function EntityName({
  guid,
  name,
  showId,
  color = "text-foreground",
}: {
  guid: string;
  name: string | null;
  showId: boolean;
  color?: string;
}) {
  const [copied, setCopied] = useState(false);
  const hasName = !!name;
  const displayName = name || guid;

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className="inline-flex items-center gap-1.5 cursor-pointer group"
        onClick={() => {
          navigator.clipboard.writeText(guid);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        title={`Click to copy ID: ${guid}`}
      >
        <span
          className={`text-sm ${
            hasName ? `font-semibold ${color}` : "font-mono text-muted-foreground"
          }`}
        >
          {displayName}
        </span>
        {copied ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        )}
        {copied && (
          <span className="text-[10px] text-emerald-500 font-medium">Copied!</span>
        )}
      </span>
      {showId && hasName && (
        <code className="text-[10px] font-mono text-muted-foreground/50 select-all">
          {guid}
        </code>
      )}
    </span>
  );
}

function StatusIcon({ match }: { match: boolean | null }) {
  if (match === null) return null;
  return match
    ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
    : <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />;
}

function GuidDisplay({ guid, expected, label }: { guid: string | null; expected?: string; label?: string }) {
  if (!guid) return <span className="text-sm text-muted-foreground italic">not set</span>;
  const match = expected ? guid.toLowerCase() === expected.toLowerCase() : null;
  return (
    <span className="inline-flex items-center gap-2">
      <code className={`text-sm font-mono px-2 py-0.5 rounded ${
        match === false ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 ring-1 ring-red-400/40 dark:ring-red-500/40" : "bg-muted text-foreground"
      }`}>
        {guid.toLowerCase()}
      </code>
      <StatusIcon match={match} />
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </span>
  );
}

/** Label that shows technical key or friendly name depending on mode */
function Label({ technicalName, map, biz }: { technicalName: string; map: Record<string, string>; biz: boolean }) {
  const friendly = map[technicalName];
  if (!biz || !friendly) {
    return <span className="text-xs text-muted-foreground font-medium">{technicalName}</span>;
  }
  return (
    <span className="text-xs text-muted-foreground font-medium">
      {friendly}
      <span className="text-muted-foreground/50 ml-1.5 font-normal">({technicalName})</span>
    </span>
  );
}

/** Inline code reference — in business mode, shows friendly name */
function CodeRef({ children, biz }: { children: string; biz: boolean }) {
  const friendly = FRIENDLY_TABLE_NAMES[children];
  if (biz && friendly) {
    return <span className="font-medium text-foreground">{friendly}</span>;
  }
  return <code className="text-muted-foreground font-mono text-sm">{children}</code>;
}

// ── Table wrapper with consistent styling ──

function ConfigTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {children}
      </table>
    </div>
  );
}

function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="text-left text-muted-foreground border-b-2 border-border text-xs font-semibold uppercase tracking-wider">
        {children}
      </tr>
    </thead>
  );
}

function TH({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`pb-3 pr-6 ${className}`}>{children}</th>;
}

function TD({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-3 pr-6 align-top ${className}`}>{children}</td>;
}

// ── Cascade Update Modal ──

function CascadeModal({
  prompt,
  onConfirm,
  onSkip,
}: {
  prompt: CascadePrompt;
  onConfirm: (selected: CascadeRef[]) => void;
  onSkip: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(prompt.references.filter((r) => r.target !== "yaml_readonly").map((_, i) => i))
  );
  const [applying, setApplying] = useState(false);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const updatable = prompt.references.filter((r) => r.target !== "yaml_readonly");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onSkip} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-700 dark:text-blue-400" />
            Cascade Update
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            This GUID appears in <strong className="text-foreground">{prompt.references.length} location{prompt.references.length > 1 ? "s" : ""}</strong> across the framework.
            Would you like to update them all?
          </p>
          <div className="flex items-center gap-3 mt-3">
            <code className="text-sm font-mono text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-2 py-1 rounded line-through">{prompt.oldValue}</code>
            <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <code className="text-sm font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-1 rounded">{prompt.newValue}</code>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-2">
            {prompt.references.map((ref, i) => {
              const isReadOnly = ref.target === "yaml_readonly";
              const isChecked = selected.has(i);
              return (
                <label
                  key={i}
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                    isReadOnly
                      ? "border-border bg-muted/20 opacity-60 cursor-not-allowed"
                      : isChecked
                      ? "border-blue-400/50 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-900/10 cursor-pointer"
                      : "border-border hover:bg-muted/30 cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isReadOnly ? false : isChecked}
                    disabled={isReadOnly}
                    onChange={() => toggle(i)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground font-medium">{ref.location}</span>
                    {isReadOnly && (
                      <span className="block text-xs text-muted-foreground mt-0.5">Read-only — update manually in source file</span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-t border-border flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {updatable.length > 0 ? `${selected.size} of ${updatable.length} selected` : "No updatable references"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onSkip}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
            >
              Skip
            </button>
            {updatable.length > 0 && (
              <button
                onClick={() => {
                  setApplying(true);
                  const toUpdate = prompt.references.filter((_, i) => selected.has(i) && prompt.references[i].target !== "yaml_readonly");
                  onConfirm(toUpdate);
                }}
                disabled={applying || selected.size === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {applying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Update {selected.size} Reference{selected.size !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function ConfigManager() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const [businessMode, setBusinessMode] = useState(true);
  const [cascadePrompt, setCascadePrompt] = useState<CascadePrompt | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [showDeployPrompt, setShowDeployPrompt] = useState(false);
  const [showIds, setShowIds] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJson<ConfigData>("/config-manager");
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Core update — does NOT check for cascading references (used by cascade modal itself) */
  const doUpdateDirect = async (body: Record<string, unknown>) => {
    const result = await postJson<Record<string, unknown>>("/config-manager/update", body);
    if (result.error) {
      setUpdateLog((prev) => [`ERROR: ${result.error}`, ...prev]);
    } else {
      setUpdateLog((prev) => [`Updated ${body.target}: ${JSON.stringify(result).slice(0, 120)}`, ...prev]);
    }
  };

  /** Smart update — after saving, checks if the OLD value is a GUID that exists elsewhere */
  const doUpdate = async (body: Record<string, unknown>, oldValue?: string) => {
    await doUpdateDirect(body);
    await load();

    // If the old value looks like a GUID, check for remaining references
    if (oldValue && GUID_PATTERN.test(oldValue)) {
      const newValue = (body.newGuid || body.newWorkspaceGuid || body.newValue || "") as string;
      if (newValue && oldValue.toLowerCase() !== newValue.toLowerCase()) {
        try {
          const refData = await fetchJson<{ references: CascadeRef[]; count: number }>(
            `/config-manager/references?guid=${encodeURIComponent(oldValue)}`
          );
          if (refData.count > 0) {
            setCascadePrompt({ oldValue, newValue, references: refData.references });
          }
        } catch {
          // Non-critical — just skip cascade
        }
      }
    }
  };

  const handleCascadeConfirm = async (selected: CascadeRef[]) => {
    for (const ref of selected) {
      await doUpdateDirect({ target: ref.target, ...ref.params, [ref.field]: cascadePrompt!.newValue });
    }
    setCascadePrompt(null);
    await load();
  };

  const biz = businessMode;

  /** Resolve a GUID to its entity name — prefers live Fabric data, falls back to metadata DB */
  const resolveGuid = useCallback((guid: string): string | null => {
    if (!data || !guid) return null;
    const g = guid.toLowerCase();
    const fe = data.fabricEntities;
    const fc = data.fabricConnections;

    // 1. Check live Fabric workspaces
    if (fe?.workspaces) {
      for (const [wsGuid, wsName] of Object.entries(fe.workspaces)) {
        if (wsGuid.toLowerCase() === g) return wsName;
      }
    }
    // 2. Check live Fabric items (pipelines, notebooks, lakehouses etc.)
    if (fe?.items) {
      for (const items of Object.values(fe.items)) {
        const match = items.find((it) => it.id.toLowerCase() === g);
        if (match) return match.displayName;
      }
    }
    // 3. Check live Fabric connections
    if (fc) {
      const conn = fc.find((c) => c.id.toLowerCase() === g);
      if (conn) return conn.displayName;
    }
    // 4. Fall back to metadata DB
    const { database: d } = data;
    const ws = d.workspaces.find((w) => (w.WorkspaceGuid || "").toLowerCase() === g);
    if (ws) return ws.Name;
    const lh = d.lakehouses.find((l) => (l.LakehouseGuid || "").toLowerCase() === g);
    if (lh) return lh.Name;
    const cn = d.connections.find((c) => (c.ConnectionGuid || "").toLowerCase() === g);
    if (cn) return cn.Name;
    const pl = d.pipelines.find((p) => (p.PipelineGuid || "").toLowerCase() === g);
    if (pl) return pl.Name;
    return null;
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="h-8 w-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-500/30 rounded-lg p-6 text-red-700 dark:text-red-300">
          Failed to load configuration: {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { database: db, itemConfig, pipelineConfigs, variableLibrary, dashboardConfig, mismatches } = data;
  const yamlWs = (itemConfig?.workspaces ?? {}) as Record<string, string>;
  const correctDataDev = yamlWs.workspace_data?.toLowerCase() ?? "";

  return (
    <div className="space-y-6 pb-16">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Settings2 className="h-6 w-6" /> Configuration Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every dynamic value in the FMD framework. Hover any value and click the pencil to edit.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Show IDs Toggle */}
          <button
            onClick={() => setShowIds(!showIds)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition-colors ${
              showIds
                ? "bg-amber-600/10 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-600/20"
                : "bg-card border-border text-foreground hover:bg-muted/80"
            }`}
            title={showIds ? "Hide GUID identifiers" : "Show GUID identifiers"}
          >
            {showIds ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            )}
            {showIds ? "IDs Visible" : "IDs Hidden"}
          </button>
          {/* Business / Technical Toggle */}
          <button
            onClick={() => setBusinessMode(!businessMode)}
            className="flex items-center gap-2 px-4 py-2 bg-card hover:bg-muted/80 rounded-lg text-sm text-foreground border border-border transition-colors"
            title={businessMode ? "Switch to technical view" : "Switch to business-friendly view"}
          >
            {businessMode ? (
              <ToggleRight className="h-4 w-4 text-blue-700 dark:text-blue-400" />
            ) : (
              <ToggleLeft className="h-4 w-4 text-muted-foreground" />
            )}
            {businessMode ? "Business" : "Technical"}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg text-sm text-foreground border border-border transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowDeployPrompt(true)}
            disabled={deploying}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600/80 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {deploying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            Deploy
          </button>
        </div>
      </div>

      {/* ── Mismatch Banner ── */}
      {mismatches.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-300 dark:border-red-500/40 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            <h2 className="text-base font-semibold text-red-700 dark:text-red-300">
              {mismatches.length} Configuration Mismatch{mismatches.length > 1 ? "es" : ""} Detected
            </h2>
            <button
              onClick={async () => {
                for (const m of mismatches) {
                  if (m.category === "pipeline_param" && m.pipeline) {
                    await doUpdateDirect({
                      target: "pipeline_param",
                      pipelineName: m.pipeline,
                      paramName: "Data_WorkspaceGuid",
                      newValue: m.expected,
                    });
                  }
                }
                await load();
                setShowDeployPrompt(true);
              }}
              className="ml-auto flex items-center gap-2 px-4 py-2 bg-red-600/80 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Zap className="h-4 w-4" /> Fix All Mismatches
            </button>
          </div>
          <div className="space-y-3">
            {mismatches.map((m, i) => (
              <div key={i} className="flex items-start gap-3 bg-red-100 dark:bg-red-900/60 rounded-lg p-4">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="text-sm text-red-800 dark:text-red-200 font-medium">{m.message}</div>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-sm font-medium text-red-700 dark:text-red-400/80 bg-red-200 dark:bg-red-900/30 px-2 py-0.5 rounded">
                      {GUID_PATTERN.test(m.current) ? (resolveGuid(m.current) || m.current) : m.current}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400/80 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded">
                      {GUID_PATTERN.test(m.expected) ? (resolveGuid(m.expected) || m.expected) : m.expected}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mismatches.length === 0 && !showDeployPrompt && !deployResult && (
        <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-500/30 rounded-xl p-5 flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm text-emerald-700 dark:text-emerald-300">All configuration values are in sync. No mismatches detected.</span>
        </div>
      )}

      {/* ── Deploy Prompt (after Fix All Mismatches) ── */}
      {showDeployPrompt && !deploying && !deployResult && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-300 dark:border-blue-500/40 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <Rocket className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-base font-semibold text-blue-700 dark:text-blue-300">
              Source Files Updated — Deploy to Fabric?
            </h2>
          </div>
          <p className="text-sm text-blue-700/80 dark:text-blue-300/80 mb-4">
            The local pipeline JSON files have been corrected. To push these changes to Fabric so the
            pipelines actually use the new values, deploy them now. This will update all 22 pipelines
            across both DEV and PROD workspaces via the Fabric REST API.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                setDeploying(true);
                setShowDeployPrompt(false);
                try {
                  const result = await postJson<DeployResult>("/deploy-pipelines", {});
                  setDeployResult(result);
                  setUpdateLog((prev) => [
                    `Deployment complete: ${result.deployed} succeeded, ${result.failed} failed`,
                    ...prev,
                  ]);
                } catch (e) {
                  setDeployResult({
                    success: false,
                    deployed: 0,
                    failed: 1,
                    total: 1,
                    results: [{ workspace: "N/A", pipeline: "N/A", success: false, error: String(e) }],
                  });
                } finally {
                  setDeploying(false);
                }
              }}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Rocket className="h-4 w-4" /> Deploy All Pipelines to Fabric
            </button>
            <button
              onClick={() => setShowDeployPrompt(false)}
              className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-sm text-foreground rounded-lg border border-border transition-colors"
            >
              Skip Deployment
            </button>
          </div>
        </div>
      )}

      {/* ── Deploying Spinner ── */}
      {deploying && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-300 dark:border-blue-500/40 rounded-xl p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="h-6 w-6 text-blue-600 dark:text-blue-400 animate-spin" />
            <h2 className="text-base font-semibold text-blue-700 dark:text-blue-300">
              Deploying pipelines to Fabric...
            </h2>
          </div>
          <p className="text-sm text-blue-700/70 dark:text-blue-300/70 mt-2">
            Updating 22 pipelines across DEV + PROD workspaces. This takes about 15–20 seconds.
          </p>
        </div>
      )}

      {/* ── Deploy Results ── */}
      {deployResult && (
        <div
          className={`border rounded-xl p-6 ${
            deployResult.success
              ? "bg-emerald-50 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-500/30"
              : "bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-500/40"
          }`}
        >
          <div className="flex items-center gap-3 mb-4">
            {deployResult.success ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            )}
            <h2
              className={`text-base font-semibold ${
                deployResult.success
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-amber-700 dark:text-amber-300"
              }`}
            >
              Deployment {deployResult.success ? "Succeeded" : "Completed with Errors"}
              {" — "}
              {deployResult.deployed} deployed, {deployResult.failed} failed
            </h2>
            <button
              onClick={() => setDeployResult(null)}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {deployResult.results.map((r, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 text-sm font-mono px-3 py-1.5 rounded ${
                  r.success
                    ? "text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30"
                    : "text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30"
                }`}
              >
                <span className="w-5 text-center">{r.success ? "✓" : "✗"}</span>
                <span className="w-24 flex-shrink-0 text-muted-foreground">[{r.workspace}]</span>
                <span className="flex-1">{r.pipeline}</span>
                {r.success && r.replacements != null && (
                  <span className="text-muted-foreground text-xs">
                    {r.replacements} IDs replaced{r.deactivated ? `, ${r.deactivated} deactivated` : ""}
                  </span>
                )}
                {!r.success && r.error && (
                  <span className="text-red-600 dark:text-red-400 text-xs truncate max-w-xs" title={r.error}>
                    {r.error.slice(0, 80)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Section 1: Source of Truth ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <SectionHeader icon={FileJson} title={biz ? "Source of Truth" : "Source of Truth — item_config.yaml"}>
          <p className="text-sm text-muted-foreground mb-6">
            {biz
              ? "The master reference file. Every other value in the framework should match these."
              : "The master reference. Everything else should match these values."}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div>
              <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider mb-3">Workspaces</h3>
              <div className="space-y-3">
                {Object.entries(yamlWs).map(([key, val]) => {
                  const resolved = resolveGuid(val);
                  return (
                    <div key={key} className="flex flex-col gap-1">
                      <Label technicalName={key} map={FRIENDLY_WORKSPACE_KEYS} biz={biz} />
                      <EntityName guid={val} name={resolved} showId={showIds} color="text-blue-700 dark:text-blue-300" />
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wider mb-3">Connections</h3>
              <div className="space-y-3">
                {Object.entries((itemConfig?.connections ?? {}) as Record<string, string>).map(([key, val]) => {
                  const resolved = resolveGuid(val);
                  const isPlaceholder = val === "00000000-0000-0000-0000-000000000000";
                  return (
                    <div key={key} className="flex flex-col gap-1">
                      <Label technicalName={key} map={FRIENDLY_CONNECTION_KEYS} biz={biz} />
                      {isPlaceholder ? (
                        <span className="text-sm font-medium text-red-500 dark:text-red-400 italic">Not yet created</span>
                      ) : (
                        <EntityName guid={val} name={resolved} showId={showIds} color="text-purple-700 dark:text-purple-300" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-3">Database</h3>
              <div className="space-y-3">
                {Object.entries((itemConfig?.database ?? {}) as Record<string, string>).map(([key, val]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <Label technicalName={key} map={FRIENDLY_DB_KEYS} biz={biz} />
                    <code className="text-sm font-mono text-amber-700 dark:text-amber-300/80 bg-amber-100 dark:bg-amber-900/20 px-2 py-1 rounded break-all" title={val}>{val}</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionHeader>
      </div>

      {/* ── Section 2: Workspaces (DB) ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <SectionHeader icon={Server} title={biz ? "Workspaces" : "Workspaces — Metadata Database"} count={db.workspaces.length}>
          <p className="text-sm text-muted-foreground mb-5">
            {biz
              ? "Workspace registrations in the metadata database. Pipeline views use these GUIDs."
              : <>Stored in <CodeRef biz={biz}>integration.Workspace</CodeRef>. Pipeline views join on these GUIDs.</>}
          </p>
          <ConfigTable>
            <THead>
              <TH>ID</TH>
              <TH>Name</TH>
              <TH>Fabric Workspace</TH>
              <TH>{biz ? "Config Match" : "item_config match"}</TH>
            </THead>
            <tbody>
              {db.workspaces.map((ws) => {
                const yamlMatch = Object.entries(yamlWs).find(
                  ([, v]) => v.toLowerCase() === (ws.WorkspaceGuid || "").toLowerCase()
                );
                const fabricName = resolveGuid(ws.WorkspaceGuid || "");
                return (
                  <tr key={ws.WorkspaceId} className="border-b border-border hover:bg-muted/50">
                    <TD className="text-muted-foreground font-mono">{ws.WorkspaceId}</TD>
                    <TD className="text-foreground font-medium">{ws.Name}</TD>
                    <TD>
                      {showIds ? (
                        <EditableCell
                          value={ws.WorkspaceGuid || ""}
                          onSave={async (v) => doUpdate({ target: "workspace", workspaceId: ws.WorkspaceId, newGuid: v }, ws.WorkspaceGuid)}
                        />
                      ) : (
                        <EntityName guid={ws.WorkspaceGuid || ""} name={fabricName} showId={false} color="text-blue-700 dark:text-blue-300" />
                      )}
                    </TD>
                    <TD>
                      {yamlMatch ? (
                        <span className="inline-flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm">
                          <CheckCircle2 className="h-4 w-4" /> {biz ? friendlyName(yamlMatch[0], FRIENDLY_WORKSPACE_KEYS) : yamlMatch[0]}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm">
                          <AlertTriangle className="h-4 w-4" /> no match
                        </span>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </ConfigTable>
        </SectionHeader>
      </div>

      {/* ── Section 3: Lakehouses ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <SectionHeader icon={Database} title={biz ? "Lakehouses" : "Lakehouses — Metadata Database"} count={db.lakehouses.length}>
          <p className="text-sm text-muted-foreground mb-5">
            {biz
              ? "Lakehouse registrations. The Landing Zone pipeline writes data to these destinations."
              : <>Stored in <CodeRef biz={biz}>integration.Lakehouse</CodeRef>. Landing zone writes to <code className="text-muted-foreground font-mono text-sm">TargetLakehouseGuid</code> from these values.</>}
          </p>
          <div className="space-y-4">
            {db.lakehouses.map((lh) => {
              const wsMatch = correctDataDev && lh.WorkspaceGuid
                ? lh.WorkspaceGuid.toLowerCase() === correctDataDev : null;
              const lhFabricName = resolveGuid(lh.LakehouseGuid || "");
              const wsFabricName = resolveGuid(lh.WorkspaceGuid || "");
              return (
                <div key={lh.LakehouseId} className="bg-muted/30 border border-border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground font-mono text-sm">#{lh.LakehouseId}</span>
                      <span className="text-foreground font-semibold text-base">{lh.Name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${lh.IsActive === "True" ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                        {lh.IsActive === "True" ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs text-muted-foreground font-medium block mb-1">{biz ? "Lakehouse" : "Lakehouse GUID"}</span>
                      {showIds ? (
                        <EditableCell
                          value={lh.LakehouseGuid || ""}
                          onSave={async (v) => doUpdate({ target: "lakehouse", lakehouseId: lh.LakehouseId, newGuid: v }, lh.LakehouseGuid)}
                        />
                      ) : (
                        <EntityName guid={lh.LakehouseGuid || ""} name={lhFabricName} showId={false} color="text-amber-700 dark:text-amber-300" />
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground font-medium block mb-1">{biz ? "Workspace" : "Workspace GUID"}</span>
                      <span className="inline-flex items-center gap-2">
                        {showIds ? (
                          <EditableCell
                            value={lh.WorkspaceGuid || ""}
                            onSave={async (v) => doUpdate({ target: "lakehouse", lakehouseId: lh.LakehouseId, newWorkspaceGuid: v }, lh.WorkspaceGuid)}
                          />
                        ) : (
                          <EntityName guid={lh.WorkspaceGuid || ""} name={wsFabricName} showId={false} color="text-blue-700 dark:text-blue-300" />
                        )}
                        <StatusIcon match={wsMatch} />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionHeader>
      </div>

      {/* ── Section 4: Connections ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <SectionHeader icon={Cable} title={biz ? "Connections" : "Connections — Metadata Database"} count={db.connections.length}>
          <p className="text-sm text-muted-foreground mb-5">
            {biz
              ? "Connection registrations. The Type determines which copy pipeline variant runs for each source."
              : <>The <code className="text-muted-foreground font-mono text-sm">Type</code> column drives pipeline switch routing (SQL, ADLS, ONELAKE, etc.). <code className="text-muted-foreground font-mono text-sm">ConnectionGuid</code> is used by copy activities.</>}
          </p>
          <ConfigTable>
            <THead>
              <TH>ID</TH>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>{biz ? "Fabric Connection" : "Connection GUID"}</TH>
              <TH>Active</TH>
            </THead>
            <tbody>
              {db.connections.map((c) => {
                const connFabricName = resolveGuid(c.ConnectionGuid || "");
                return (
                  <tr key={c.ConnectionId} className="border-b border-border hover:bg-muted/50">
                    <TD className="text-muted-foreground font-mono">{c.ConnectionId}</TD>
                    <TD className="text-foreground font-medium">
                      {biz ? friendlyName(c.Name, FRIENDLY_CONNECTION_KEYS) : c.Name}
                      {biz && FRIENDLY_CONNECTION_KEYS[c.Name] && (
                        <span className="block text-xs text-muted-foreground/60 font-normal">{c.Name}</span>
                      )}
                    </TD>
                    <TD>
                      <EditableCell
                        value={c.Type || ""}
                        onSave={async (v) => doUpdate({ target: "connection", connectionId: c.ConnectionId, newType: v })}
                      />
                    </TD>
                    <TD>
                      {showIds ? (
                        <EditableCell
                          value={c.ConnectionGuid || ""}
                          onSave={async (v) => doUpdate({ target: "connection", connectionId: c.ConnectionId, newGuid: v }, c.ConnectionGuid)}
                        />
                      ) : (
                        <EntityName guid={c.ConnectionGuid || ""} name={connFabricName} showId={false} color="text-purple-700 dark:text-purple-300" />
                      )}
                    </TD>
                    <TD>
                      <span className={`text-sm ${c.IsActive === "True" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        {c.IsActive === "True" ? "Yes" : "No"}
                      </span>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </ConfigTable>
        </SectionHeader>
      </div>

      {/* ── Section 5: Pipeline Parameter Defaults ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <SectionHeader icon={GitBranch} title="Pipeline Parameter Defaults" count={pipelineConfigs.filter((p) => p.wsParamDefault !== null && p.wsParamDefault !== undefined).length}>
          <p className="text-sm text-muted-foreground mb-5">
            {biz
              ? <>Each pipeline's workspace GUID default from the JSON source files. When the master orchestrator invokes child pipelines without passing this parameter, the default kicks in. <strong className="text-foreground">Must match the Data Workspace.</strong></>
              : <>Each pipeline's <code className="text-muted-foreground font-mono text-sm">Data_WorkspaceGuid</code> default from JSON source files. When <code className="text-muted-foreground font-mono text-sm">PL_FMD_LOAD_ALL</code> invokes children without passing this parameter, the default kicks in. <strong className="text-foreground">Must match <code className="text-blue-700 dark:text-blue-400">workspace_data</code>.</strong></>}
          </p>
          <ConfigTable>
            <THead>
              <TH>Pipeline</TH>
              <TH>{biz ? "Data Workspace Default" : "Data_WorkspaceGuid Default"}</TH>
              <TH>Status</TH>
            </THead>
            <tbody>
              {pipelineConfigs
                .filter((p) => p.wsParamDefault !== null && p.wsParamDefault !== undefined)
                .map((p) => {
                  const isCorrect = !p.wsParamDefault || p.wsParamDefault.toLowerCase() === correctDataDev;
                  const isEmpty = !p.wsParamDefault || p.wsParamDefault === "NONE" || p.wsParamDefault === "";
                  const wsResolved = p.wsParamDefault && GUID_PATTERN.test(p.wsParamDefault) ? resolveGuid(p.wsParamDefault) : null;
                  return (
                    <tr key={p.name} className={`border-b border-border hover:bg-muted/50 ${!isCorrect && !isEmpty ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}>
                      <TD className="text-foreground font-mono">
                        {biz ? (
                          <span>
                            {friendlyName(p.name, FRIENDLY_PIPELINE_NAMES)}
                            {FRIENDLY_PIPELINE_NAMES[p.name] && (
                              <span className="block text-xs text-muted-foreground/60 font-normal">{p.name}</span>
                            )}
                          </span>
                        ) : p.name}
                      </TD>
                      <TD>
                        {isEmpty ? (
                          <span className="text-muted-foreground italic text-sm">empty (inherited from parent)</span>
                        ) : showIds ? (
                          <EditableCell
                            value={p.wsParamDefault!}
                            onSave={async (v) =>
                              doUpdate({ target: "pipeline_param", pipelineName: p.name, paramName: "Data_WorkspaceGuid", newValue: v }, p.wsParamDefault || undefined)
                            }
                          />
                        ) : (
                          <EntityName guid={p.wsParamDefault!} name={wsResolved} showId={false} color="text-blue-700 dark:text-blue-300" />
                        )}
                      </TD>
                      <TD>
                        {isEmpty ? (
                          <span className="text-muted-foreground">—</span>
                        ) : isCorrect ? (
                          <span className="inline-flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                            <CheckCircle2 className="h-4 w-4" /> Matches
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2 text-red-700 dark:text-red-400 text-sm font-medium">
                            <AlertTriangle className="h-4 w-4" /> MISMATCH
                          </span>
                        )}
                      </TD>
                    </tr>
                  );
                })}
            </tbody>
          </ConfigTable>
        </SectionHeader>
      </div>

      {/* ── Section 6: Data Sources ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <SectionHeader icon={Layers3} title={biz ? "Data Sources" : "Data Sources — Metadata Database"} count={db.datasources.length}>
          <p className="text-sm text-muted-foreground mb-5">
            {biz
              ? "Registered data sources. The Type determines which copy pipeline variant runs for each source."
              : <>The <code className="text-muted-foreground font-mono text-sm">Type</code> column (e.g. ASQL_01) determines which copy pipeline variant runs.</>}
          </p>
          <ConfigTable>
            <THead>
              <TH>ID</TH>
              <TH>Name</TH>
              <TH>Namespace</TH>
              <TH>Type</TH>
              <TH>Connection</TH>
              <TH>Active</TH>
            </THead>
            <tbody>
              {db.datasources.map((ds) => {
                const conn = db.connections.find((c) => c.ConnectionId === ds.ConnectionId);
                return (
                  <tr key={ds.DataSourceId} className="border-b border-border hover:bg-muted/50">
                    <TD className="text-muted-foreground font-mono">{ds.DataSourceId}</TD>
                    <TD>
                      <EditableCell
                        value={ds.Name || ""}
                        onSave={async (v) => doUpdate({ target: "datasource", dataSourceId: ds.DataSourceId, newName: v })}
                      />
                    </TD>
                    <TD>
                      <EditableCell
                        value={ds.Namespace || ""}
                        onSave={async (v) => doUpdate({ target: "datasource", dataSourceId: ds.DataSourceId, newNamespace: v })}
                      />
                    </TD>
                    <TD>
                      <div className="flex flex-col">
                        <EditableCell
                          value={ds.Type || ""}
                          onSave={async (v) => doUpdate({ target: "datasource", dataSourceId: ds.DataSourceId, newType: v })}
                        />
                        {biz && FRIENDLY_DS_TYPES[ds.Type] && (
                          <span className="text-xs text-muted-foreground/60 mt-0.5">{FRIENDLY_DS_TYPES[ds.Type]}</span>
                        )}
                      </div>
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <EditableCell
                          value={ds.ConnectionId || ""}
                          onSave={async (v) => doUpdate({ target: "datasource", dataSourceId: ds.DataSourceId, newConnectionId: v })}
                        />
                        {conn && <span className="text-xs text-muted-foreground">({biz ? friendlyName(conn.Name, FRIENDLY_CONNECTION_KEYS) : conn.Name})</span>}
                      </div>
                    </TD>
                    <TD>
                      <span className={`text-sm ${ds.IsActive === "True" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        {ds.IsActive === "True" ? "Yes" : "No"}
                      </span>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </ConfigTable>
        </SectionHeader>
      </div>

      {/* ── Section 7: Variable Library ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <SectionHeader icon={Shield} title={biz ? "Variable Library" : "Variable Library — VAR_CONFIG_FMD"} count={variableLibrary.variables.length}>
          <p className="text-sm text-muted-foreground mb-5">
            {biz
              ? "Runtime variables configured in the Fabric workspace. Pipelines read these at execution time. Default values are empty — each workspace sets its own overrides."
              : <>Runtime variables set in the Fabric workspace UI. Pipelines use <code className="text-muted-foreground font-mono text-sm">@pipeline().libraryVariables.VAR_CONFIG_FMD_*</code>. Values in source are empty — configured per workspace in Fabric.</>}
          </p>
          <ConfigTable>
            <THead>
              <TH>Variable Name</TH>
              <TH>Type</TH>
              <TH>Default Value (source)</TH>
              {Object.keys(variableLibrary.valueSets).map((vs) => (
                <TH key={vs}>{vs}</TH>
              ))}
            </THead>
            <tbody>
              {variableLibrary.variables.map((v) => (
                <tr key={v.name} className="border-b border-border hover:bg-muted/50">
                  <TD className="font-mono text-foreground">
                    {biz ? (
                      <span>
                        {friendlyName(v.name, FRIENDLY_VAR_NAMES)}
                        {FRIENDLY_VAR_NAMES[v.name] && (
                          <span className="block text-xs text-muted-foreground/60 font-normal">{v.name}</span>
                        )}
                      </span>
                    ) : v.name}
                  </TD>
                  <TD className="text-muted-foreground">{v.type}</TD>
                  <TD>
                    {v.value ? (
                      GUID_PATTERN.test(v.value) && !showIds ? (
                        <EntityName guid={v.value} name={resolveGuid(v.value)} showId={false} />
                      ) : (
                        <code className="text-sm text-muted-foreground">{v.value}</code>
                      )
                    ) : (
                      <span className="text-sm text-muted-foreground italic">empty</span>
                    )}
                  </TD>
                  {Object.entries(variableLibrary.valueSets).map(([vsName, overrides]) => {
                    const override = overrides.find((o: any) => o.name === v.name);
                    const ovVal = override ? (override as any).value : null;
                    return (
                      <TD key={vsName}>
                        {ovVal ? (
                          GUID_PATTERN.test(ovVal) && !showIds ? (
                            <EntityName guid={ovVal} name={resolveGuid(ovVal)} showId={false} />
                          ) : (
                            <code className="text-sm text-muted-foreground">{ovVal}</code>
                          )
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TD>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </ConfigTable>
        </SectionHeader>
      </div>

      {/* ── Section 8: DB Pipelines ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <SectionHeader icon={GitBranch} title={biz ? "Registered Pipelines" : "Registered Pipelines — Metadata Database"} count={db.pipelines.length} defaultOpen={false}>
          <p className="text-sm text-muted-foreground mb-5">
            {biz
              ? "Pipeline registrations used to trigger and monitor runs via the Fabric REST API."
              : <>Pipeline GUIDs in <CodeRef biz={biz}>integration.Pipeline</CodeRef>. The server uses these to trigger and monitor runs via Fabric REST API.</>}
          </p>
          <div className="max-h-[600px] overflow-y-auto">
            <ConfigTable>
              <THead>
                <TH>ID</TH>
                <TH>Name</TH>
                <TH>{biz ? "Fabric Pipeline" : "Pipeline GUID"}</TH>
                <TH>{biz ? "Workspace" : "Workspace GUID"}</TH>
                <TH>Active</TH>
              </THead>
              <tbody>
                {db.pipelines.map((p) => {
                  const wsMatch = correctDataDev && p.WorkspaceGuid
                    ? p.WorkspaceGuid.toLowerCase() === correctDataDev : null;
                  const plFabricName = resolveGuid(p.PipelineGuid || "");
                  const wsFabricName = resolveGuid(p.WorkspaceGuid || "");
                  return (
                    <tr key={p.PipelineId} className="border-b border-border hover:bg-muted/50">
                      <TD className="text-muted-foreground font-mono">{p.PipelineId}</TD>
                      <TD>
                        {biz ? (
                          <span>
                            <span className="text-foreground font-medium">{friendlyName(p.Name, FRIENDLY_PIPELINE_NAMES)}</span>
                            {FRIENDLY_PIPELINE_NAMES[p.Name] && (
                              <span className="block text-xs text-muted-foreground/60 font-normal">{p.Name}</span>
                            )}
                          </span>
                        ) : (
                          <EditableCell
                            value={p.Name || ""}
                            onSave={async (v) => doUpdate({ target: "pipeline_db", pipelineId: p.PipelineId, newName: v })}
                          />
                        )}
                      </TD>
                      <TD>
                        {showIds ? (
                          <EditableCell
                            value={p.PipelineGuid?.toLowerCase() || ""}
                            onSave={async (v) => doUpdate({ target: "pipeline_db", pipelineId: p.PipelineId, newGuid: v }, p.PipelineGuid)}
                          />
                        ) : (
                          <EntityName guid={p.PipelineGuid || ""} name={plFabricName} showId={false} />
                        )}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          {showIds ? (
                            <>
                              <EditableCell
                                value={p.WorkspaceGuid?.toLowerCase() || ""}
                                onSave={async (v) => doUpdate({ target: "pipeline_db", pipelineId: p.PipelineId, newWorkspaceGuid: v }, p.WorkspaceGuid)}
                              />
                              <StatusIcon match={wsMatch} />
                            </>
                          ) : (
                            <>
                              <EntityName guid={p.WorkspaceGuid || ""} name={wsFabricName} showId={false} color="text-blue-700 dark:text-blue-300" />
                              <StatusIcon match={wsMatch} />
                            </>
                          )}
                        </div>
                      </TD>
                      <TD>
                        <span className={`text-sm ${p.IsActive === "True" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                          {p.IsActive === "True" ? "Yes" : "No"}
                        </span>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </ConfigTable>
          </div>
        </SectionHeader>
      </div>

      {/* ── Section 9: Dashboard Config ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <SectionHeader icon={Settings2} title={biz ? "Dashboard Server Config" : "Dashboard Server Config — config.json"}>
          <p className="text-sm text-muted-foreground mb-2">
            {biz
              ? "The dashboard API's own configuration. Includes tenant info, service principal, workspace IDs, and SQL connection."
              : "The dashboard API's own config. Includes tenant, service principal, workspace IDs, and SQL connection."}
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-400/80 mb-6">
            Server restart required after changes.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {Object.entries(dashboardConfig).map(([section, values]) => {
              if (typeof values !== "object" || values === null) return null;
              const colors: Record<string, string> = {
                fabric: "text-blue-700 dark:text-blue-400", sql: "text-amber-700 dark:text-amber-400", server: "text-foreground",
                purview: "text-purple-700 dark:text-purple-400", logging: "text-muted-foreground",
              };
              const descriptions: Record<string, string> = biz ? {
                fabric: "Service principal and workspace IDs for Fabric API calls",
                sql: "Connection to the FMD metadata database",
                server: "HTTP server configuration",
                purview: "Microsoft Purview governance integration",
                logging: "Log file and verbosity level",
              } : {
                fabric: "Fabric REST API — tenant, service principal, workspace IDs",
                sql: "Metadata DB connection — server, database, driver",
                server: "HTTP server — host, port, static dir",
                purview: "Microsoft Purview integration",
                logging: "Log file and level",
              };
              return (
                <div key={section} className="bg-muted/30 border border-border rounded-lg p-4">
                  <h3 className={`text-sm font-semibold uppercase tracking-wider mb-1 ${colors[section] || "text-muted-foreground"}`}>
                    {biz ? (FRIENDLY_CONFIG_SECTIONS[section] || section) : section}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4">{descriptions[section] || ""}</p>
                  <div className="space-y-3">
                    {Object.entries(values as Record<string, string>).map(([key, val]) => {
                      const isSecret = val?.startsWith?.("${") || key.includes("secret");
                      const friendlyKey = biz ? FRIENDLY_CONFIG_KEYS[section]?.[key] : undefined;
                      const isGuid = val && GUID_PATTERN.test(val);
                      const resolved = isGuid ? resolveGuid(val) : null;
                      return (
                        <div key={key} className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground font-medium">
                            {friendlyKey ? (
                              <>{friendlyKey} <span className="text-muted-foreground/50 font-normal">({key})</span></>
                            ) : key}
                          </span>
                          <div className="flex items-center gap-2 flex-wrap">
                            {isSecret ? (
                              <code className="text-sm font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded italic">
                                {val}
                              </code>
                            ) : isGuid && !showIds ? (
                              <EntityName guid={val} name={resolved} showId={false} color={colors[section] || "text-foreground"} />
                            ) : (
                              <>
                                <EditableCell
                                  value={val || ""}
                                  onSave={async (v) => doUpdate({ target: "dashboard_config", section, key, newValue: v }, val)}
                                />
                                {!isSecret && val && <CopyButton text={val} />}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionHeader>
      </div>

      {/* ── Update Log ── */}
      {updateLog.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Update Log</h2>
            <button onClick={() => setUpdateLog([])} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Clear</button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {updateLog.map((msg, i) => (
              <div key={i} className={`text-sm font-mono ${msg.startsWith("ERROR") ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400/80"}`}>
                {msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Cascade Update Modal ── */}
      {cascadePrompt && (
        <CascadeModal
          prompt={cascadePrompt}
          onConfirm={handleCascadeConfirm}
          onSkip={() => setCascadePrompt(null)}
        />
      )}
    </div>
  );
}
