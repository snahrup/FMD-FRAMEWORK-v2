import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  RotateCcw,
  RefreshCw,
  Loader2,
  XCircle,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  Layers,
  Database,
  HardDrive,
  Table2,
  Sparkles,
  Crown,
  X,
  Route,
} from "lucide-react";
import { useEntityDigest } from "@/hooks/useEntityDigest";
import type { DigestEntity, DigestSource } from "@/hooks/useEntityDigest";

// ============================================================================
// TYPES — connections, datasources, pipelines still fetched individually
// ============================================================================

interface Connection {
  ConnectionId: string;
  ConnectionGuid: string;
  Name: string;
  Type: string;
  IsActive: string;
}

interface DataSource {
  DataSourceId: string;
  Name: string;
  Namespace: string;
  Type: string;
  Description: string | null;
  IsActive: string;
  ConnectionName: string;
}

interface Pipeline {
  PipelineId: string;
  PipelineGuid: string;
  WorkspaceGuid: string;
  Name: string;
  IsActive: string;
}

// ============================================================================
// LAYER DEFINITIONS — plain English, idiot-proof
// ============================================================================

const LAYERS = [
  {
    key: "source",
    label: "Source",
    color: "#64748b",
    icon: Database,
    description: "Where your data lives. Databases on company servers.",
  },
  {
    key: "landing",
    label: "Landing Zone",
    color: "#3b82f6",
    icon: HardDrive,
    description: "Raw copies staged here first. Like a loading dock.",
  },
  {
    key: "bronze",
    label: "Bronze",
    color: "#f59e0b",
    icon: Table2,
    description: "Organized into structured tables. Sorted and shelved.",
  },
  {
    key: "silver",
    label: "Silver",
    color: "#8b5cf6",
    icon: Sparkles,
    description: "Cleaned, validated, business rules applied. Ready to use.",
  },
  {
    key: "gold",
    label: "Gold",
    color: "#10b981",
    icon: Crown,
    description: "Polished data shaped for reports and dashboards.",
  },
];

// ============================================================================
// ENTITY FLOW — represents one entity's journey through all layers
// ============================================================================

interface EntityFlow {
  id: string;
  dataSourceName: string;
  dataSourceType: string;
  connectionName: string;
  namespace: string;
  // Source
  sourceSchema: string;
  sourceName: string;
  // Landing Zone
  lzEntityId: string;
  lzFileName: string;
  lzFilePath: string;
  lzFileType: string;
  isIncremental: boolean;
  // Bronze (may not exist yet)
  bronzeEntityId: string | null;
  bronzeSchema: string | null;
  bronzeName: string | null;
  bronzeFileType: string | null;
  bronzePrimaryKeys: string | null;
  // Silver (may not exist yet)
  silverEntityId: string | null;
  silverSchema: string | null;
  silverName: string | null;
  silverFileType: string | null;
  // Gold (future)
  goldEntityId: string | null;
  goldName: string | null;
  // How far the entity has progressed
  maxLayer: "source" | "landing" | "bronze" | "silver" | "gold";
}

interface SourceGroup {
  dataSourceName: string;
  dataSourceType: string;
  connectionName: string;
  namespace: string;
  flows: EntityFlow[];
  landingCount: number;
  bronzeCount: number;
  silverCount: number;
  goldCount: number;
}

// ============================================================================
// API HELPER
// ============================================================================

const API = "http://localhost:8787/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/** Format numbers with commas for readability (1234 → "1,234") */
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// ============================================================================
// NARRATIVE BUILDER — plain English flow description
// ============================================================================

function buildNarrative(flow: EntityFlow): { step: string; title: string; detail: string; layer: string; reached: boolean }[] {
  const steps = [
    {
      step: "1",
      title: "Originates from Source Database",
      detail: `This data lives in the ${flow.sourceSchema}.${flow.sourceName} table inside the ${flow.dataSourceName} database. It's connected through a ${flow.dataSourceType === "ASQL_01" ? "SQL Server gateway" : flow.dataSourceType} connection.`,
      layer: "source",
      reached: true,
    },
    {
      step: "2",
      title: "Copied to Landing Zone",
      detail: `A raw copy is extracted and saved as "${flow.lzFileName}" (${flow.lzFileType} format) in the Landing Zone lakehouse. ${flow.isIncremental ? "Only new/changed rows are copied each run (incremental)." : "The entire table is copied fresh each run (full load)."}`,
      layer: "landing",
      reached: true,
    },
    {
      step: "3",
      title: "Structured in Bronze Layer",
      detail: flow.bronzeName
        ? `Raw files are converted into a structured Delta table called "${flow.bronzeSchema}.${flow.bronzeName}". Data types are enforced and the table is queryable.${flow.bronzePrimaryKeys ? ` Primary key: ${flow.bronzePrimaryKeys}.` : ""}`
        : "Not yet processed. The Bronze layer conversion has not been configured for this entity.",
      layer: "bronze",
      reached: !!flow.bronzeName,
    },
    {
      step: "4",
      title: "Cleaned & Validated in Silver",
      detail: flow.silverName
        ? `Business rules and data quality checks are applied, producing the clean "${flow.silverSchema}.${flow.silverName}" table. This data is analytics-ready.`
        : "Not yet configured. Silver layer transformations have not been set up for this entity.",
      layer: "silver",
      reached: !!flow.silverName,
    },
    {
      step: "5",
      title: "Shaped for Reports in Gold",
      detail: flow.goldName
        ? `Data is shaped into a dimensional model (${flow.goldName}) optimized for dashboards and reports.`
        : "Coming soon. The Gold layer dimensional model has not been created yet.",
      layer: "gold",
      reached: !!flow.goldName,
    },
  ];
  return steps;
}

// ============================================================================
// SOURCE TYPE BADGE
// ============================================================================

function sourceTypeBadge(type: string) {
  const labels: Record<string, string> = {
    ASQL_01: "SQL Server",
    ORACLE_01: "Oracle",
    ADLS_01: "Azure Storage",
    FTP_01: "FTP",
    SFTP_01: "Secure FTP",
    ONELAKE_TABLES: "OneLake Tables",
    ONELAKE_FILES: "OneLake Files",
    ADF_01: "Data Factory",
    CUSTOM_NB: "Custom Notebook",
  };
  return labels[type] || type;
}

// ============================================================================
// FRAMEWORK ARCHITECTURE — single-node topology with fan-out
// Shared nodes appear ONCE. Source-specific pipelines fan out in the middle.
//
// Layout:
//   [Config DB] → [Orchestrator] ──┬── [Route SQL] → [Copy SQL] ──┬── [Landing Zone] → [Notebook] → [Bronze] → [Silver]
//                                  ├── [Route Oracle] → [Copy Oracle]┤
//                                  └── [Route FTP] → [Copy FTP] ────┘
// ============================================================================

interface ArchSourcePath {
  id: string;
  sourceType: string;
  friendlySource: string;
  connectionName: string;
  commandName: string;
  friendlyCommand: string;
  copyName: string;
  friendlyCopy: string;
}

function buildArchSourcePaths(pipelines: Pipeline[], connections: Connection[]): ArchSourcePath[] {
  const active = pipelines.filter(p => p.IsActive === "True");

  const sourceTypes: { key: string; friendly: string; cmdMatch: string; copyMatch: string }[] = [
    { key: "ASQL", friendly: "SQL Server", cmdMatch: "COMMAND_ASQL", copyMatch: "COPY_FROM_ASQL_01" },
    { key: "ORACLE", friendly: "Oracle", cmdMatch: "COMMAND_ORACLE", copyMatch: "COPY_FROM_ORACLE_01" },
    { key: "ADLS", friendly: "Azure Storage", cmdMatch: "COMMAND_ADLS", copyMatch: "COPY_FROM_ADLS_01" },
    { key: "FTP", friendly: "FTP", cmdMatch: "COMMAND_FTP", copyMatch: "COPY_FROM_FTP_01" },
    { key: "SFTP", friendly: "Secure FTP", cmdMatch: "COMMAND_SFTP", copyMatch: "COPY_FROM_SFTP_01" },
    { key: "ONELAKE_T", friendly: "OneLake Tables", cmdMatch: "COMMAND_ONELAKE", copyMatch: "COPY_FROM_ONELAKE_TABLES" },
    { key: "ONELAKE_F", friendly: "OneLake Files", cmdMatch: "COMMAND_ONELAKE", copyMatch: "COPY_FROM_ONELAKE_FILES" },
    { key: "ADF", friendly: "Data Factory", cmdMatch: "COMMAND_ADF", copyMatch: "COPY_FROM_ADF" },
    { key: "NOTEBOOK", friendly: "Custom Notebook", cmdMatch: "COMMAND_NOTEBOOK", copyMatch: "COPY_FROM_CUSTOM_NB" },
  ];

  return sourceTypes.map(st => {
    const cmd = active.find(p => p.Name.includes(st.cmdMatch));
    const copy = active.find(p => p.Name.includes(st.copyMatch));
    const conn = connections.find(c => c.IsActive === "True" && c.Name.includes(st.key.replace("_T", "").replace("_F", "")));
    return {
      id: st.key,
      sourceType: st.key,
      friendlySource: st.friendly,
      connectionName: conn?.Name || `CON_FMD_${st.key}`,
      commandName: cmd?.Name || `PL_FMD_LDZ_${st.cmdMatch}`,
      friendlyCommand: `Route ${st.friendly}`,
      copyName: copy?.Name || `PL_FMD_LDZ_${st.copyMatch}`,
      friendlyCopy: `Copy ${st.friendly}`,
    };
  }).filter(row => {
    return active.some(p => p.Name.includes(row.sourceType.replace("_T", "").replace("_F", "")));
  });
}

// Colors for shared infrastructure nodes
const NODE_COLORS = {
  config: "#64748B",
  orchestrator: "#EF4444",
  command: "#F97316",
  copy: "#06B6D4",
  landing: "#3b82f6",
  notebook: "#A855F7",
  bronze: "#f59e0b",
  silver: "#8b5cf6",
};

function FrameworkArchView({
  pipelines,
  connections,
  labelMode,
  searchQuery,
}: {
  pipelines: Pipeline[];
  connections: Connection[];
  labelMode: "tech" | "exec";
  searchQuery: string;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  const sourcePaths = buildArchSourcePaths(pipelines, connections);
  const activePipes = pipelines.filter(p => p.IsActive === "True");
  const orchPipeline = activePipes.find(p => p.Name === "PL_FMD_LOAD_ALL") || activePipes.find(p => p.Name.includes("LOAD_LANDINGZONE"));

  const filtered = searchQuery.trim()
    ? sourcePaths.filter(r => {
        const q = searchQuery.toLowerCase();
        return r.friendlySource.toLowerCase().includes(q) ||
               r.commandName.toLowerCase().includes(q) ||
               r.copyName.toLowerCase().includes(q);
      })
    : sourcePaths;

  const anyActive = selectedPath || hoveredPath;
  const isPathActive = (id: string) => id === selectedPath || (!selectedPath && id === hoveredPath);

  // Shared node style helper
  const sharedNode = (label: string, techLabel: string, subtitle: string, color: string, isHighlighted: boolean) => (
    <div
      className={`flow-node rounded-lg border-2 px-3 py-2 bg-card transition-all duration-300 ${
        isHighlighted ? "flow-node-active" : anyActive ? "opacity-40" : ""
      }`}
      style={{ borderColor: `${color}50`, minWidth: 110 }}
      title={techLabel}
    >
      <div className="text-[11px] font-bold truncate" style={{ color }}>
        {labelMode === "exec" ? label : techLabel}
      </div>
      <div className="text-[8px] text-muted-foreground font-medium">{subtitle}</div>
    </div>
  );

  // Connector between shared nodes
  const sharedConnector = (color: string, isHighlighted: boolean) => (
    <div className="w-8 flex items-center justify-center flex-shrink-0">
      <div
        className={`w-full ${isHighlighted ? "flow-connector-active" : anyActive ? "flow-connector-dimmed" : "flow-connector-inactive"}`}
        style={{ "--fc": color } as React.CSSProperties}
      />
    </div>
  );

  // Is any path highlighted (for shared nodes glow)
  const sharedHighlight = !!selectedPath || !!hoveredPath;

  return (
    <div>
      {/* Architecture topology: shared → fan-out → shared */}
      <div className="flex items-stretch gap-0">

        {/* ── LEFT SHARED: Config DB → Orchestrator ── */}
        <div className="flex flex-col justify-center flex-shrink-0 pr-1">
          <div className="flex items-center">
            {sharedNode("Config DB", "SQL_FMD_FRAMEWORK", "metadata store", NODE_COLORS.config, sharedHighlight)}
            {sharedConnector(NODE_COLORS.orchestrator, sharedHighlight)}
            {sharedNode("Orchestrator", orchPipeline?.Name || "PL_FMD_LOAD_ALL", "coordinates all", NODE_COLORS.orchestrator, sharedHighlight)}
          </div>
        </div>

        {/* ── FAN-OUT BRACKET (left) ── */}
        <div className="flex items-stretch flex-shrink-0 mx-1">
          <div className="w-6 flex items-center justify-center">
            <div
              className={`w-full transition-all duration-300 ${sharedHighlight ? "flow-connector-active" : "flow-connector-inactive"}`}
              style={{ "--fc": NODE_COLORS.command } as React.CSSProperties}
            />
          </div>
          <div
            className={`w-1.5 rounded-r-md transition-all duration-300 ${
              sharedHighlight
                ? "border-t-2 border-r-2 border-b-2"
                : anyActive ? "border-t border-r border-b border-border/20" : "border-t border-r border-b border-border/40"
            }`}
            style={sharedHighlight ? { borderColor: `${NODE_COLORS.command}60` } : undefined}
          />
        </div>

        {/* ── MIDDLE FAN-OUT: source-specific Command Router → Copy Pipeline ── */}
        <div className="flex-1 min-w-0 py-1">
          <div className="space-y-1">
            {filtered.map(path => {
              const active = isPathActive(path.id);
              const isDimmed = anyActive && !active;

              return (
                <div
                  key={path.id}
                  className={`flex items-center gap-0 px-1 py-1.5 rounded-md border cursor-pointer transition-all duration-300 ${
                    isDimmed ? "opacity-[0.10] border-transparent" :
                    active ? "border-primary/30 bg-primary/[0.03]" :
                    "border-border/20 hover:border-border/40 hover:bg-muted/20"
                  }`}
                  onClick={() => setSelectedPath(selectedPath === path.id ? null : path.id)}
                  onMouseEnter={() => !selectedPath && setHoveredPath(path.id)}
                  onMouseLeave={() => setHoveredPath(null)}
                >
                  {/* Command Router */}
                  <div
                    className={`flow-node rounded border px-2 py-1.5 bg-card flex-1 min-w-0 ${active ? "flow-node-active" : ""}`}
                    style={{ borderColor: `${NODE_COLORS.command}30` }}
                    title={path.commandName}
                  >
                    <div className="text-[10px] font-semibold truncate" style={{ color: NODE_COLORS.command }}>
                      {labelMode === "exec" ? path.friendlyCommand : path.commandName}
                    </div>
                    <div className="text-[8px] text-muted-foreground">command router</div>
                  </div>

                  {/* → */}
                  <div className="w-5 flex items-center justify-center flex-shrink-0">
                    <div
                      className={`w-full ${active ? "flow-connector-active" : "flow-connector-inactive"}`}
                      style={{ "--fc": NODE_COLORS.copy } as React.CSSProperties}
                    />
                  </div>

                  {/* Copy Pipeline */}
                  <div
                    className={`flow-node rounded border px-2 py-1.5 bg-card flex-1 min-w-0 ${active ? "flow-node-active" : ""}`}
                    style={{ borderColor: `${NODE_COLORS.copy}30` }}
                    title={path.copyName}
                  >
                    <div className="text-[10px] font-semibold truncate" style={{ color: NODE_COLORS.copy }}>
                      {labelMode === "exec" ? path.friendlyCopy : path.copyName}
                    </div>
                    <div className="text-[8px] text-muted-foreground">data extractor</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── FAN-IN BRACKET (right) ── */}
        <div className="flex items-stretch flex-shrink-0 mx-1">
          <div
            className={`w-1.5 rounded-l-md transition-all duration-300 ${
              sharedHighlight
                ? "border-t-2 border-l-2 border-b-2"
                : anyActive ? "border-t border-l border-b border-border/20" : "border-t border-l border-b border-border/40"
            }`}
            style={sharedHighlight ? { borderColor: `${NODE_COLORS.landing}60` } : undefined}
          />
          <div className="w-6 flex items-center justify-center">
            <div
              className={`w-full transition-all duration-300 ${sharedHighlight ? "flow-connector-active" : "flow-connector-inactive"}`}
              style={{ "--fc": NODE_COLORS.landing } as React.CSSProperties}
            />
          </div>
        </div>

        {/* ── RIGHT SHARED: Landing Zone → Notebook → Bronze → Silver ── */}
        <div className="flex flex-col justify-center flex-shrink-0 pl-1">
          <div className="flex items-center">
            {sharedNode("Landing Zone", "LH_DATA_LANDINGZONE", "raw files", NODE_COLORS.landing, sharedHighlight)}
            {sharedConnector(NODE_COLORS.notebook, sharedHighlight)}
            {sharedNode("Notebook", "NB_FMD_LOAD_*", "transforms", NODE_COLORS.notebook, sharedHighlight)}
            {sharedConnector(NODE_COLORS.bronze, sharedHighlight)}
            {sharedNode("Bronze", "LH_BRONZE_LAYER", "structured", NODE_COLORS.bronze, sharedHighlight)}
            {sharedConnector(NODE_COLORS.silver, sharedHighlight)}
            {sharedNode("Silver", "LH_SILVER_LAYER", "clean data", NODE_COLORS.silver, sharedHighlight)}
          </div>
        </div>
      </div>

      {/* Narrative: explain what clicking does */}
      {selectedPath && (() => {
        const path = sourcePaths.find(p => p.id === selectedPath);
        if (!path) return null;
        return (
          <div className="mt-4 px-4 py-3 rounded-lg border border-primary/20 bg-primary/[0.02] narrative-panel">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {path.friendlySource} Pipeline Path
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              When the <span className="font-semibold" style={{ color: NODE_COLORS.orchestrator }}>Orchestrator</span> finds
              {" "}<span className="font-semibold" style={{ color: NODE_COLORS.command }}>{path.friendlySource}</span> sources
              to process, it hands them to the{" "}
              <span className="font-semibold" style={{ color: NODE_COLORS.command }}>{labelMode === "exec" ? path.friendlyCommand : path.commandName}</span> pipeline,
              which determines how to connect and extract from that source type.
              It then calls{" "}
              <span className="font-semibold" style={{ color: NODE_COLORS.copy }}>{labelMode === "exec" ? path.friendlyCopy : path.copyName}</span> to
              pull the data into the <span className="font-semibold" style={{ color: NODE_COLORS.landing }}>Landing Zone</span>.
              From there, the standard transformation path takes over: notebooks process the raw files
              through <span className="font-semibold" style={{ color: NODE_COLORS.bronze }}>Bronze</span> and{" "}
              <span className="font-semibold" style={{ color: NODE_COLORS.silver }}>Silver</span> layers.
              The only thing unique to {path.friendlySource} is the command router and copy pipeline. Everything else is shared infrastructure.
            </p>
          </div>
        );
      })()}

      {/* How it works */}
      {!selectedPath && (
        <div className="mt-4 px-3 py-3 rounded-lg border border-border/30 bg-muted/[0.03]">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">How the framework works</div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            The <span className="font-semibold" style={{ color: NODE_COLORS.config }}>Config Database</span> tells
            the <span className="font-semibold" style={{ color: NODE_COLORS.orchestrator }}>Orchestrator</span> what to load.
            The orchestrator fans out to <span className="font-semibold" style={{ color: NODE_COLORS.command }}>Command Routers</span> (one per source type),
            each calling the matching <span className="font-semibold" style={{ color: NODE_COLORS.copy }}>Copy Pipeline</span> to extract data.
            All paths converge into a single <span className="font-semibold" style={{ color: NODE_COLORS.landing }}>Landing Zone</span>,
            then flow through shared <span className="font-semibold" style={{ color: NODE_COLORS.notebook }}>Notebooks</span>,{" "}
            <span className="font-semibold" style={{ color: NODE_COLORS.bronze }}>Bronze</span>, and{" "}
            <span className="font-semibold" style={{ color: NODE_COLORS.silver }}>Silver</span> layers.
            Click any source type to trace its path. No pipeline contains source-specific logic beyond the command router and copy pipeline.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground px-2">
        <span>{fmt(filtered.length)} source type paths</span>
        <span className="text-border">|</span>
        <span>{fmt(activePipes.length)} active pipelines</span>
        <span className="text-border">|</span>
        <span>{fmt(connections.filter(c => c.IsActive === "True").length)} connections</span>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function FlowExplorer() {
  // ── Entity Digest (replaces /entities, /bronze-entities, /silver-entities) ──
  const {
    allEntities,
    sourceList,
    loading: digestLoading,
    error: digestError,
    refresh: refreshDigest,
  } = useEntityDigest();

  // ── Remaining non-digest fetches: connections, datasources, pipelines ──
  const [auxLoading, setAuxLoading] = useState(true);
  const [auxError, setAuxError] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [labelMode, setLabelMode] = useState<"tech" | "exec">("exec");
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [selectedFlow, setSelectedFlow] = useState<EntityFlow | null>(null);
  const [hoveredSource, setHoveredSource] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"data" | "arch">("data");
  // Scaling: progressive reveal per source group
  const PAGE_SIZE = 25;
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [groupSearch, setGroupSearch] = useState<Record<string, string>>({});

  // Fetch auxiliary data (connections, datasources, pipelines)
  const loadAuxData = useCallback(async () => {
    setAuxLoading(true);
    setAuxError(null);
    try {
      const [conn, ds, pipes] = await Promise.all([
        fetchJson<Connection[]>("/connections"),
        fetchJson<DataSource[]>("/datasources"),
        fetchJson<Pipeline[]>("/pipelines"),
      ]);
      setConnections(conn);
      setDataSources(ds);
      setPipelines(pipes);
    } catch (err) {
      setAuxError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setAuxLoading(false);
    }
  }, []);

  useEffect(() => { loadAuxData(); }, [loadAuxData]);

  // Combined loading / error state
  const loading = digestLoading || auxLoading;
  const error = digestError || auxError;

  const loadData = useCallback(() => {
    refreshDigest();
    loadAuxData();
  }, [refreshDigest, loadAuxData]);

  // ── Build a DataSource-type lookup so we can stamp flows with Type/Namespace ──
  const dsLookup = new Map(dataSources.map((ds) => [ds.Name, ds]));

  // Helper: convert a DigestEntity into an EntityFlow
  function digestToFlow(ent: DigestEntity, ds: DataSource | undefined): EntityFlow {
    let maxLayer: EntityFlow["maxLayer"] = "landing";
    if (ent.silverId != null) maxLayer = "silver";
    else if (ent.bronzeId != null) maxLayer = "bronze";

    return {
      id: String(ent.id),
      dataSourceName: ent.source,
      dataSourceType: ds?.Type || "ASQL_01",
      connectionName: ent.connection?.connectionName || ds?.ConnectionName || "",
      namespace: ds?.Namespace || "",
      sourceSchema: ent.sourceSchema,
      sourceName: ent.tableName,
      lzEntityId: String(ent.id),
      lzFileName: ent.tableName,
      lzFilePath: ent.sourceSchema,
      lzFileType: "PARQUET",
      isIncremental: ent.isIncremental,
      bronzeEntityId: ent.bronzeId != null ? String(ent.bronzeId) : null,
      bronzeSchema: ent.bronzeId != null ? ent.sourceSchema : null,
      bronzeName: ent.bronzeId != null ? ent.tableName : null,
      bronzeFileType: ent.bronzeId != null ? "DELTA" : null,
      bronzePrimaryKeys: ent.bronzePKs || null,
      silverEntityId: ent.silverId != null ? String(ent.silverId) : null,
      silverSchema: ent.silverId != null ? ent.sourceSchema : null,
      silverName: ent.silverId != null ? ent.tableName : null,
      silverFileType: ent.silverId != null ? "DELTA" : null,
      goldEntityId: null,
      goldName: null,
      maxLayer,
    };
  }

  // Build entity flows from digest source groups
  const sourceGroups: SourceGroup[] = sourceList.map((src: DigestSource) => {
    const ds = dsLookup.get(src.name);

    const flows: EntityFlow[] = src.entities.map((ent) => digestToFlow(ent, ds));

    return {
      dataSourceName: src.name,
      dataSourceType: ds?.Type || "ASQL_01",
      connectionName: src.connection?.connectionName || ds?.ConnectionName || "",
      namespace: ds?.Namespace || "",
      flows,
      landingCount: flows.length,
      bronzeCount: flows.filter((f) => f.bronzeName).length,
      silverCount: flows.filter((f) => f.silverName).length,
      goldCount: 0,
    };
  });

  // Search filter
  const filteredGroups = sourceGroups.map((g) => {
    if (!searchQuery.trim()) return g;
    const q = searchQuery.toLowerCase();
    const filtered = g.flows.filter(
      (f) =>
        f.sourceName.toLowerCase().includes(q) ||
        f.sourceSchema.toLowerCase().includes(q) ||
        f.lzFileName.toLowerCase().includes(q) ||
        (f.bronzeName || "").toLowerCase().includes(q) ||
        (f.silverName || "").toLowerCase().includes(q) ||
        f.dataSourceName.toLowerCase().includes(q)
    );
    return { ...g, flows: filtered, landingCount: filtered.length, bronzeCount: filtered.filter((f) => f.bronzeName).length, silverCount: filtered.filter((f) => f.silverName).length };
  }).filter((g) => g.flows.length > 0);

  // Stats
  const totalFlows = sourceGroups.reduce((acc, g) => acc + g.flows.length, 0);
  const totalBronze = sourceGroups.reduce((acc, g) => acc + g.bronzeCount, 0);
  const totalSilver = sourceGroups.reduce((acc, g) => acc + g.silverCount, 0);
  const activePipelines = pipelines.filter((p) => p.IsActive === "True").length;

  const toggleSource = (name: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectEntity = (flow: EntityFlow) => {
    setSelectedFlow(flow);
  };

  const clearSelection = () => {
    setSelectedFlow(null);
  };

  // Loading / error states
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading framework data from Fabric...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-4">
        <XCircle className="w-12 h-12 text-destructive" />
        <p className="text-destructive font-medium">{error}</p>
        <button onClick={loadData} className="px-4 py-2 rounded-md border border-border bg-card text-sm hover:bg-muted">
          <RefreshCw className="w-4 h-4 inline mr-2" />Retry
        </button>
      </div>
    );
  }

  const narrative = selectedFlow ? buildNarrative(selectedFlow) : [];

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      {/* CSS Animations */}
      <style>{`
        @keyframes flowRight {
          from { background-position: 0 0; }
          to { background-position: 16px 0; }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(var(--flow-rgb), 0.3); }
          50% { box-shadow: 0 0 12px 4px rgba(var(--flow-rgb), 0.15); }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .flow-connector-active {
          height: 2px;
          background: repeating-linear-gradient(90deg, var(--fc) 0px, var(--fc) 6px, transparent 6px, transparent 10px);
          background-size: 16px 2px;
          animation: flowRight 0.6s linear infinite;
        }
        .flow-connector-inactive {
          height: 2px;
          background: repeating-linear-gradient(90deg, var(--fc) 0px, var(--fc) 4px, transparent 4px, transparent 8px);
          background-size: 8px 2px;
          opacity: 0.15;
        }
        .flow-connector-dimmed {
          height: 1px;
          background: rgba(128,128,128,0.08);
        }
        .flow-node {
          transition: all 0.3s ease;
        }
        .flow-node-active {
          --flow-rgb: 139, 92, 246;
          animation: pulseGlow 2s ease-in-out infinite;
        }
        .lane-row {
          transition: opacity 0.3s ease, transform 0.2s ease;
        }
        .narrative-panel {
          animation: slideInRight 0.3s ease-out;
        }
      `}</style>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="font-display text-base font-semibold tracking-tight">Flow Explorer</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              {viewMode === "data" ? "How your data moves through the system" : "The complete framework infrastructure"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-4 border-l border-border">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            <span className="font-mono text-[10px]">{fmt(totalFlows)} Tables</span>
            <span className="text-border mx-1">|</span>
            <span className="font-mono text-[10px]">{fmt(sourceGroups.length)} Sources</span>
            <span className="text-border mx-1">|</span>
            <span className="font-mono text-[10px]">{fmt(activePipelines)} Pipelines</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center h-8 rounded-md border border-border overflow-hidden">
            <button
              className={`px-3 h-full text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                viewMode === "data" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              onClick={() => setViewMode("data")}
            >
              Data Flow
            </button>
            <div className="w-px h-4 bg-border" />
            <button
              className={`px-3 h-full text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                viewMode === "arch" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              onClick={() => setViewMode("arch")}
            >
              Framework
            </button>
          </div>

          {/* Tech / Exec Toggle */}
          <div className="flex items-center gap-2 px-3 border-l border-r border-border h-8">
            <span
              className={`text-[10px] uppercase tracking-wider cursor-pointer font-medium transition-colors ${
                labelMode === "tech" ? "text-primary font-semibold" : "text-muted-foreground"
              }`}
              onClick={() => setLabelMode("tech")}
            >
              Technical
            </span>
            <div
              className={`relative w-10 h-5 rounded-full cursor-pointer transition-all duration-300 ${
                labelMode === "exec" ? "bg-primary/15 border border-primary/30" : "bg-muted border border-border"
              }`}
              onClick={() => setLabelMode((m) => (m === "tech" ? "exec" : "tech"))}
            >
              <div
                className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ${
                  labelMode === "exec" ? "left-[22px] bg-primary" : "left-0.5 bg-muted-foreground"
                }`}
              />
            </div>
            <span
              className={`text-[10px] uppercase tracking-wider cursor-pointer font-medium transition-colors ${
                labelMode === "exec" ? "text-primary font-semibold" : "text-muted-foreground"
              }`}
              onClick={() => setLabelMode("exec")}
            >
              Simple
            </span>
          </div>

          <button
            onClick={() => { clearSelection(); setSearchQuery(""); setExpandedSources(new Set()); }}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md border border-border bg-card text-muted-foreground text-xs font-medium cursor-pointer hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md border border-border bg-card text-muted-foreground text-xs font-medium cursor-pointer hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex flex-1 min-h-0">
        {viewMode === "arch" ? (
          /* ============ FRAMEWORK ARCHITECTURE VIEW ============ */
          <div className="flex-1 overflow-auto p-4">
            {/* Search (shared) */}
            <div className="mb-4 max-w-md">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-background text-foreground text-xs outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground"
                  placeholder="Search pipelines, notebooks, connections..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <FrameworkArchView pipelines={pipelines} connections={connections} labelMode={labelMode} searchQuery={searchQuery} />
          </div>
        ) : (
        /* ============ DATA FLOW VIEW ============ */
        <>
        <div className="flex-1 overflow-auto p-4">
          {/* Search */}
          <div className="mb-4 max-w-md">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-background text-foreground text-xs outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground"
                placeholder="Search tables, sources, schemas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Layer Headers */}
          <div className="flex items-stretch gap-0 mb-2 px-2">
            {LAYERS.map((layer, i) => {
              const Icon = layer.icon;
              return (
                <div key={layer.key} className="flex items-center" style={{ width: i === 0 ? 200 : undefined, flex: i === 0 ? undefined : 1 }}>
                  {i > 0 && (
                    <div className="flex-shrink-0 w-8 flex items-center justify-center">
                      <ArrowRight className="w-3 h-3 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: layer.color }} />
                      <span className="text-[11px] font-semibold" style={{ color: layer.color }}>{layer.label}</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-tight">{layer.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-b border-border/50 mb-3" />

          {/* Source Groups */}
          {filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Layers className="w-12 h-12 opacity-20 mb-3" />
              <p className="text-sm">
                {searchQuery ? "No tables match your search." : "No data sources registered yet."}
              </p>
              <p className="text-xs mt-1">
                {searchQuery ? "Try a different search term." : "Register sources in the Source Manager to see data flow."}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredGroups.map((group) => {
                const isExpanded = expandedSources.has(group.dataSourceName);
                const isSelected = selectedFlow?.dataSourceName === group.dataSourceName;
                const isDimmed = selectedFlow && !isSelected;

                return (
                  <div key={group.dataSourceName} className={`lane-row rounded-lg border transition-all duration-300 ${
                    isDimmed ? "opacity-[0.12] border-border/20" : "border-border/50"
                  } ${isSelected && !selectedFlow ? "border-primary/30 bg-primary/[0.02]" : ""}`}>
                    {/* Source Header Row */}
                    <div
                      className="flex items-center gap-0 px-2 py-2.5 cursor-pointer hover:bg-muted/30 rounded-t-lg"
                      onClick={() => toggleSource(group.dataSourceName)}
                      onMouseEnter={() => !selectedFlow && setHoveredSource(group.dataSourceName)}
                      onMouseLeave={() => setHoveredSource(null)}
                    >
                      {/* Expand icon */}
                      <div className="w-5 flex-shrink-0">
                        {isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                      </div>

                      {/* Source node */}
                      <div className="flow-node rounded-md border px-3 py-1.5 bg-card" style={{ width: 175, borderColor: `${LAYERS[0].color}30` }}>
                        <div className="text-[11px] font-semibold text-foreground truncate" title={labelMode === "exec" ? group.dataSourceName : group.connectionName}>
                          {labelMode === "exec" ? group.dataSourceName : group.connectionName}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {sourceTypeBadge(group.dataSourceType)}
                        </div>
                      </div>

                      {/* Connector → Landing */}
                      <div className="flex-1 min-w-4 flex items-center px-1">
                        <div className={`w-full ${hoveredSource === group.dataSourceName || isSelected ? "flow-connector-active" : "flow-connector-inactive"}`}
                          style={{ "--fc": LAYERS[1].color } as React.CSSProperties} />
                      </div>

                      {/* Landing node */}
                      <div className="flow-node rounded-md border px-3 py-1.5 bg-card" style={{ minWidth: 100, borderColor: `${LAYERS[1].color}30` }}>
                        <div className="text-[11px] font-semibold tabular-nums" style={{ color: LAYERS[1].color }}>{fmt(group.landingCount)}</div>
                        <div className="text-[9px] text-muted-foreground">{group.landingCount === 1 ? "table" : "tables"}</div>
                      </div>

                      {/* Connector → Bronze */}
                      <div className="flex-1 min-w-4 flex items-center px-1">
                        <div className={`w-full ${group.bronzeCount > 0 && (hoveredSource === group.dataSourceName || isSelected) ? "flow-connector-active" : group.bronzeCount > 0 ? "flow-connector-inactive" : "flow-connector-dimmed"}`}
                          style={{ "--fc": LAYERS[2].color } as React.CSSProperties} />
                      </div>

                      {/* Bronze node */}
                      <div className={`flow-node rounded-md border px-3 py-1.5 ${group.bronzeCount > 0 ? "bg-card" : "bg-muted/30"}`}
                        style={{ minWidth: 100, borderColor: group.bronzeCount > 0 ? `${LAYERS[2].color}30` : "transparent" }}>
                        <div className="text-[11px] font-semibold tabular-nums" style={{ color: group.bronzeCount > 0 ? LAYERS[2].color : "var(--muted-foreground)" }}>
                          {group.bronzeCount ? fmt(group.bronzeCount) : "—"}
                        </div>
                        <div className="text-[9px] text-muted-foreground">{group.bronzeCount > 0 ? (group.bronzeCount === 1 ? "table" : "tables") : "pending"}</div>
                      </div>

                      {/* Connector → Silver */}
                      <div className="flex-1 min-w-4 flex items-center px-1">
                        <div className={`w-full ${group.silverCount > 0 && (hoveredSource === group.dataSourceName || isSelected) ? "flow-connector-active" : group.silverCount > 0 ? "flow-connector-inactive" : "flow-connector-dimmed"}`}
                          style={{ "--fc": LAYERS[3].color } as React.CSSProperties} />
                      </div>

                      {/* Silver node */}
                      <div className={`flow-node rounded-md border px-3 py-1.5 ${group.silverCount > 0 ? "bg-card" : "bg-muted/30"}`}
                        style={{ minWidth: 100, borderColor: group.silverCount > 0 ? `${LAYERS[3].color}30` : "transparent" }}>
                        <div className="text-[11px] font-semibold tabular-nums" style={{ color: group.silverCount > 0 ? LAYERS[3].color : "var(--muted-foreground)" }}>
                          {group.silverCount ? fmt(group.silverCount) : "—"}
                        </div>
                        <div className="text-[9px] text-muted-foreground">{group.silverCount > 0 ? (group.silverCount === 1 ? "table" : "tables") : "pending"}</div>
                      </div>

                      {/* Connector → Gold */}
                      <div className="flex-1 min-w-4 flex items-center px-1">
                        <div className="w-full flow-connector-dimmed" style={{ "--fc": LAYERS[4].color } as React.CSSProperties} />
                      </div>

                      {/* Gold node */}
                      <div className="flow-node rounded-md border px-3 py-1.5 bg-muted/30" style={{ width: 120, borderColor: "transparent" }}>
                        <div className="text-[11px] font-semibold text-muted-foreground">—</div>
                        <div className="text-[9px] text-muted-foreground">coming soon</div>
                      </div>
                    </div>

                    {/* Expanded: Individual Entity Rows with progressive loading */}
                    {isExpanded && (() => {
                      const gsKey = group.dataSourceName;
                      const gsq = groupSearch[gsKey] || "";
                      const allFlows = gsq.trim()
                        ? group.flows.filter(f => {
                            const q = gsq.toLowerCase();
                            return f.sourceName.toLowerCase().includes(q) ||
                                   f.sourceSchema.toLowerCase().includes(q) ||
                                   f.lzFileName.toLowerCase().includes(q) ||
                                   (f.bronzeName || "").toLowerCase().includes(q) ||
                                   (f.silverName || "").toLowerCase().includes(q);
                          })
                        : group.flows;
                      const visCount = visibleCounts[gsKey] || PAGE_SIZE;
                      const visibleFlows = allFlows.slice(0, visCount);
                      const remaining = allFlows.length - visibleFlows.length;

                      return (
                      <div className="border-t border-border/30 bg-muted/[0.03]">
                        {/* In-group search bar — only shows for large groups */}
                        {group.flows.length > PAGE_SIZE && (
                          <div className="px-3 py-2 border-b border-border/20 flex items-center gap-2">
                            <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            <input
                              type="text"
                              className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
                              placeholder={`Filter ${fmt(group.flows.length)} tables...`}
                              value={gsq}
                              onChange={(e) => setGroupSearch(prev => ({ ...prev, [gsKey]: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                            />
                            {gsq && (
                              <span className="text-[9px] text-muted-foreground">{fmt(allFlows.length)} match{allFlows.length !== 1 ? "es" : ""}</span>
                            )}
                          </div>
                        )}

                        {visibleFlows.map((flow) => {
                          const isFlowSelected = selectedFlow?.id === flow.id;
                          const isFlowDimmed = selectedFlow && !isFlowSelected;

                          return (
                            <div
                              key={flow.id}
                              className={`lane-row flex items-center gap-0 px-2 py-1.5 cursor-pointer border-b border-border/10 last:border-b-0 transition-all duration-300 ${
                                isFlowSelected
                                  ? "bg-primary/[0.04]"
                                  : isFlowDimmed
                                    ? "opacity-[0.12]"
                                    : "hover:bg-muted/40"
                              }`}
                              onClick={() => isFlowSelected ? clearSelection() : selectEntity(flow)}
                            >
                              {/* Indent spacer */}
                              <div className="w-5 flex-shrink-0" />

                              {/* Source */}
                              <div
                                className={`flow-node rounded border px-2 py-1 ${isFlowSelected ? "flow-node-active border-[#64748b]/50 bg-[#64748b]/5" : "border-border/30 bg-card"}`}
                                style={{ width: 175 }}
                                title={`${flow.sourceSchema}.${flow.sourceName}`}
                              >
                                <div className="text-[10px] font-semibold text-foreground truncate">
                                  {labelMode === "exec" ? flow.sourceName : `${flow.sourceSchema}.${flow.sourceName}`}
                                </div>
                                <div className="text-[8px] text-muted-foreground truncate">
                                  {labelMode === "exec" ? flow.dataSourceName : flow.sourceSchema}
                                </div>
                              </div>

                              {/* → Landing */}
                              <div className="flex-1 min-w-4 flex items-center px-1">
                                <div className={`w-full ${isFlowSelected ? "flow-connector-active" : "flow-connector-inactive"}`}
                                  style={{ "--fc": LAYERS[1].color } as React.CSSProperties} />
                              </div>
                              <div
                                className={`flow-node rounded border px-2 py-1 ${isFlowSelected ? "flow-node-active border-[#3b82f6]/50 bg-[#3b82f6]/5" : "border-border/30 bg-card"}`}
                                style={{ width: 120 }}
                                title={`${flow.lzFilePath}/${flow.lzFileName}`}
                              >
                                <div className="text-[10px] font-medium truncate" style={{ color: LAYERS[1].color }}>
                                  {labelMode === "exec" ? flow.lzFileName.replace(/\.[^.]+$/, "") : flow.lzFileName}
                                </div>
                                <div className="text-[8px] text-muted-foreground">
                                  {flow.lzFileType} {flow.isIncremental ? "INC" : "FULL"}
                                </div>
                              </div>

                              {/* → Bronze */}
                              <div className="flex-1 min-w-4 flex items-center px-1">
                                <div className={`w-full ${flow.bronzeName ? (isFlowSelected ? "flow-connector-active" : "flow-connector-inactive") : "flow-connector-dimmed"}`}
                                  style={{ "--fc": LAYERS[2].color } as React.CSSProperties} />
                              </div>
                              <div
                                className={`flow-node rounded border px-2 py-1 ${
                                  !flow.bronzeName ? "border-dashed border-border/20 bg-muted/20" :
                                  isFlowSelected ? "flow-node-active border-[#f59e0b]/50 bg-[#f59e0b]/5" : "border-border/30 bg-card"
                                }`}
                                style={{ width: 120 }}
                                title={flow.bronzeName ? `${flow.bronzeSchema}.${flow.bronzeName}` : undefined}
                              >
                                {flow.bronzeName ? (
                                  <>
                                    <div className="text-[10px] font-medium truncate" style={{ color: LAYERS[2].color }}>
                                      {labelMode === "exec" ? flow.bronzeName : `${flow.bronzeSchema}.${flow.bronzeName}`}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">{flow.bronzeFileType}</div>
                                  </>
                                ) : (
                                  <div className="text-[9px] text-muted-foreground/50 italic">not yet</div>
                                )}
                              </div>

                              {/* → Silver */}
                              <div className="flex-1 min-w-4 flex items-center px-1">
                                <div className={`w-full ${flow.silverName ? (isFlowSelected ? "flow-connector-active" : "flow-connector-inactive") : "flow-connector-dimmed"}`}
                                  style={{ "--fc": LAYERS[3].color } as React.CSSProperties} />
                              </div>
                              <div
                                className={`flow-node rounded border px-2 py-1 ${
                                  !flow.silverName ? "border-dashed border-border/20 bg-muted/20" :
                                  isFlowSelected ? "flow-node-active border-[#8b5cf6]/50 bg-[#8b5cf6]/5" : "border-border/30 bg-card"
                                }`}
                                style={{ width: 120 }}
                                title={flow.silverName ? `${flow.silverSchema}.${flow.silverName}` : undefined}
                              >
                                {flow.silverName ? (
                                  <>
                                    <div className="text-[10px] font-medium truncate" style={{ color: LAYERS[3].color }}>
                                      {labelMode === "exec" ? flow.silverName : `${flow.silverSchema}.${flow.silverName}`}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">{flow.silverFileType}</div>
                                  </>
                                ) : (
                                  <div className="text-[9px] text-muted-foreground/50 italic">not yet</div>
                                )}
                              </div>

                              {/* → Gold */}
                              <div className="flex-1 min-w-4 flex items-center px-1">
                                <div className="w-full flow-connector-dimmed" style={{ "--fc": LAYERS[4].color } as React.CSSProperties} />
                              </div>
                              <div className="flow-node rounded border border-dashed border-border/20 bg-muted/20 px-2 py-1" style={{ width: 120 }}>
                                <div className="text-[9px] text-muted-foreground/50 italic">coming soon</div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Show more button */}
                        {remaining > 0 && (
                          <div
                            className="px-2 py-2 text-center cursor-pointer hover:bg-muted/30 border-t border-border/20 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setVisibleCounts(prev => ({ ...prev, [gsKey]: visCount + PAGE_SIZE }));
                            }}
                          >
                            <span className="text-[10px] font-medium text-primary">
                              Show {fmt(Math.min(remaining, PAGE_SIZE))} more
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-1">
                              ({fmt(remaining)} remaining of {fmt(allFlows.length)})
                            </span>
                          </div>
                        )}
                      </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}

          {/* Flow Summary Footer */}
          {filteredGroups.length > 0 && (
            <div className="mt-4 flex items-center gap-4 text-[10px] text-muted-foreground px-2">
              <span>{fmt(totalFlows)} total tables across {fmt(sourceGroups.length)} sources</span>
              <span className="text-border">|</span>
              <span style={{ color: LAYERS[1].color }}>{fmt(totalFlows)} in Landing Zone</span>
              <span style={{ color: LAYERS[2].color }}>{fmt(totalBronze)} in Bronze</span>
              <span style={{ color: LAYERS[3].color }}>{fmt(totalSilver)} in Silver</span>
              <span style={{ color: LAYERS[4].color }}>0 in Gold</span>
            </div>
          )}
        </div>

        {/* Right Panel — Detail / Narrative */}
        <div className="w-[360px] border-l border-border bg-card flex flex-col flex-shrink-0">
          {selectedFlow ? (
            <div className="narrative-panel flex flex-col h-full">
              {/* Header */}
              <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
                <div>
                  <div className="text-xs font-semibold text-foreground">
                    {selectedFlow.sourceName}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {selectedFlow.dataSourceName} &middot; {sourceTypeBadge(selectedFlow.dataSourceType)}
                  </div>
                </div>
                <button onClick={clearSelection} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Progress bar */}
              <div className="px-4 py-3 border-b border-border/50 flex-shrink-0">
                <div className="text-[10px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">Data Journey Progress</div>
                <div className="flex items-center gap-1">
                  {LAYERS.map((layer, i) => {
                    const step = narrative[i];
                    const reached = step?.reached;
                    return (
                      <div key={layer.key} className="flex items-center flex-1">
                        <div
                          className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${reached ? "" : "bg-muted"}`}
                          style={reached ? { backgroundColor: layer.color } : undefined}
                        />
                        {i < LAYERS.length - 1 && <div className="w-0.5" />}
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1">
                  {LAYERS.map((layer) => (
                    <span key={layer.key} className="text-[8px] text-muted-foreground">{layer.label}</span>
                  ))}
                </div>
              </div>

              {/* Narrative Steps */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <div className="text-[10px] font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                  What happens to this data
                </div>
                <div className="space-y-0">
                  {narrative.map((step, i) => {
                    const layer = LAYERS[i];
                    const Icon = layer.icon;
                    return (
                      <div key={step.step} className="flex gap-3">
                        {/* Vertical connector */}
                        <div className="flex flex-col items-center flex-shrink-0">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                              step.reached
                                ? "border-current bg-current/10"
                                : "border-muted bg-muted/30"
                            }`}
                            style={step.reached ? { color: layer.color, borderColor: layer.color } : undefined}
                          >
                            <Icon className="w-3.5 h-3.5" style={step.reached ? { color: layer.color } : { color: "var(--muted-foreground)" }} />
                          </div>
                          {i < narrative.length - 1 && (
                            <div
                              className={`w-0.5 flex-1 min-h-4 ${step.reached && narrative[i + 1]?.reached ? "" : "bg-muted"}`}
                              style={step.reached && narrative[i + 1]?.reached ? { backgroundColor: layer.color, opacity: 0.3 } : undefined}
                            />
                          )}
                        </div>

                        {/* Content */}
                        <div className={`pb-4 flex-1 min-w-0 ${!step.reached ? "opacity-40" : ""}`}>
                          <div className="text-[11px] font-semibold text-foreground">{step.title}</div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">{step.detail}</p>

                          {/* Technical details for reached steps */}
                          {step.reached && step.layer === "landing" && (
                            <div className="mt-1.5 px-2 py-1 rounded bg-muted/50 border border-border/30">
                              <div className="text-[9px] font-mono text-muted-foreground">
                                {selectedFlow.lzFilePath}/{selectedFlow.lzFileName}
                              </div>
                            </div>
                          )}
                          {step.reached && step.layer === "bronze" && selectedFlow.bronzeName && (
                            <div className="mt-1.5 px-2 py-1 rounded bg-muted/50 border border-border/30">
                              <div className="text-[9px] font-mono text-muted-foreground">
                                {selectedFlow.bronzeSchema}.{selectedFlow.bronzeName}
                              </div>
                            </div>
                          )}
                          {step.reached && step.layer === "silver" && selectedFlow.silverName && (
                            <div className="mt-1.5 px-2 py-1 rounded bg-muted/50 border border-border/30">
                              <div className="text-[9px] font-mono text-muted-foreground">
                                {selectedFlow.silverSchema}.{selectedFlow.silverName}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Entity details footer */}
              <div className="px-4 py-3 border-t border-border flex-shrink-0 bg-muted/30">
                <div className="grid grid-cols-2 gap-2">
                  <div className="px-2 py-1.5 rounded bg-card border border-border/30">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Load Type</div>
                    <div className="text-[11px] font-semibold text-foreground mt-0.5">
                      {selectedFlow.isIncremental ? "Incremental" : "Full Load"}
                    </div>
                  </div>
                  <div className="px-2 py-1.5 rounded bg-card border border-border/30">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Format</div>
                    <div className="text-[11px] font-semibold text-foreground mt-0.5">{selectedFlow.lzFileType}</div>
                  </div>
                  <div className="px-2 py-1.5 rounded bg-card border border-border/30">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Connection</div>
                    <div className="text-[11px] font-semibold text-foreground mt-0.5 truncate" title={selectedFlow.connectionName}>{selectedFlow.connectionName}</div>
                  </div>
                  <div className="px-2 py-1.5 rounded bg-card border border-border/30">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Progress</div>
                    <div className="text-[11px] font-semibold mt-0.5" style={{ color: LAYERS[LAYERS.findIndex(l => l.key === selectedFlow.maxLayer)].color }}>
                      {selectedFlow.maxLayer === "landing" ? "Landing Zone" : selectedFlow.maxLayer.charAt(0).toUpperCase() + selectedFlow.maxLayer.slice(1)} Layer
                    </div>
                  </div>
                </div>
                <Link
                  to={`/journey?entity=${selectedFlow.lzEntityId}`}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-primary/30 bg-primary/5 text-primary text-[11px] font-medium hover:bg-primary/10 transition-colors"
                >
                  <Route className="w-3.5 h-3.5" />
                  Deep Dive — Schema &amp; Transformation Details
                </Link>
              </div>
            </div>
          ) : (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3 px-8">
              <Layers className="w-14 h-14 opacity-15" />
              <div>
                <p className="text-[13px] font-medium text-foreground/60 mb-1">Select a table to explore</p>
                <p className="text-[11px] leading-relaxed">
                  Expand a data source on the left, then click any table to see exactly how your data flows through
                  each layer of the system, explained in plain English.
                </p>
              </div>
              <div className="mt-4 text-left w-full space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">How to read the flow</div>
                {LAYERS.map((layer) => {
                  const Icon = layer.icon;
                  return (
                    <div key={layer.key} className="flex items-start gap-2">
                      <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: layer.color }} />
                      <div>
                        <span className="text-[10px] font-semibold" style={{ color: layer.color }}>{layer.label}</span>
                        <span className="text-[10px] text-muted-foreground ml-1">{layer.description}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
