import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import {
  Search,
  RefreshCw,
  Loader2,
  Database,
  HardDrive,
  Table2,
  Sparkles,
  Crown,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FileText,
  Key,
  GitBranch,
  Info,
  ArrowUpDown,
  CheckCircle,
  XCircle,
  Plus,
  Minus,
  BarChart3,
  Columns3,
} from "lucide-react";

// ============================================================================
// CONSTANTS
// ============================================================================

const API = "http://localhost:8787/api";

const LAYERS = [
  { key: "source",  label: "Source",       color: "#64748b", icon: Database,  bg: "bg-slate-500/10",   border: "border-slate-500/30" },
  { key: "landing", label: "Landing Zone", color: "#3b82f6", icon: HardDrive, bg: "bg-blue-500/10",    border: "border-blue-500/30" },
  { key: "bronze",  label: "Bronze",       color: "#f59e0b", icon: Table2,    bg: "bg-amber-500/10",   border: "border-amber-500/30" },
  { key: "silver",  label: "Silver",       color: "#8b5cf6", icon: Sparkles,  bg: "bg-violet-500/10",  border: "border-violet-500/30" },
  { key: "gold",    label: "Gold",         color: "#10b981", icon: Crown,     bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
];

// ============================================================================
// TYPES
// ============================================================================

interface ColumnInfo {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: string;
  CHARACTER_MAXIMUM_LENGTH: string | null;
  NUMERIC_PRECISION: string | null;
  NUMERIC_SCALE: string | null;
  ORDINAL_POSITION: string;
}

interface SchemaDiffEntry {
  columnName: string;
  inBronze: boolean;
  inSilver: boolean;
  bronzeType: string | null;
  silverType: string | null;
  bronzeNullable: string | null;
  silverNullable: string | null;
  status: "unchanged" | "type_changed" | "added_in_silver" | "bronze_only";
}

interface JourneyData {
  entityId: number;
  error?: string;
  source: {
    schema: string;
    name: string;
    dataSourceName: string;
    dataSourceType: string;
    namespace: string;
    connectionName: string;
    connectionType: string;
  };
  landing: {
    entityId: number;
    fileName: string;
    filePath: string;
    fileType: string;
    lakehouse: string;
    isIncremental: boolean;
    incrementalColumn: string | null;
    customSelect: string | null;
    customNotebook: string | null;
  };
  bronze: {
    entityId: number;
    schema: string;
    name: string;
    primaryKeys: string | null;
    fileType: string;
    lakehouse: string;
    rowCount: number | null;
    columns: ColumnInfo[];
    columnCount: number;
  } | null;
  silver: {
    entityId: number;
    schema: string;
    name: string;
    fileType: string;
    lakehouse: string;
    rowCount: number | null;
    columns: ColumnInfo[];
    columnCount: number;
  } | null;
  gold: null;
  schemaDiff: SchemaDiffEntry[];
}

interface ProfileData {
  rowCount: number;
  columnCount: number;
  columns: Array<{
    name: string;
    dataType: string;
    nullable: boolean;
    distinctCount: number;
    nullCount: number;
    nullPercentage: number;
    completeness: number;
    minValue: string | null;
    maxValue: string | null;
  }>;
}

// ============================================================================
// HELPERS
// ============================================================================

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function getMaxLayer(data: JourneyData): string {
  if (data.silver) return "silver";
  if (data.bronze) return "bronze";
  return "landing";
}

function layerIndex(key: string): number {
  return LAYERS.findIndex((l) => l.key === key);
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Horizontal flow timeline showing the entity at each layer */
function LayerTimeline({ data }: { data: JourneyData }) {
  const maxLayer = getMaxLayer(data);
  const maxIdx = layerIndex(maxLayer);

  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto py-4 px-2">
      {LAYERS.map((layer, i) => {
        const reached = i <= maxIdx + 1; // source is always "reached"
        const Icon = layer.icon;
        const isActive = i <= maxIdx + 1;
        const isCurrent = layer.key === maxLayer;

        // Per-node stats
        let label2 = "";
        let label3 = "";
        if (layer.key === "source") {
          label2 = `${data.source.schema}.${data.source.name}`;
          label3 = data.source.dataSourceName;
        } else if (layer.key === "landing") {
          label2 = data.landing.fileName || data.source.name;
          label3 = data.landing.fileType;
        } else if (layer.key === "bronze" && data.bronze) {
          label2 = `${data.bronze.schema}.${data.bronze.name}`;
          label3 = `${fmt(data.bronze.rowCount)} rows · ${data.bronze.columnCount} cols`;
        } else if (layer.key === "silver" && data.silver) {
          label2 = `${data.silver.schema}.${data.silver.name}`;
          label3 = `${fmt(data.silver.rowCount)} rows · ${data.silver.columnCount} cols`;
        }

        return (
          <div key={layer.key} className="flex items-center flex-1 min-w-0">
            {/* Node */}
            <div
              className={`flex flex-col items-center gap-1.5 min-w-[120px] max-w-[180px] mx-auto transition-all duration-300 ${
                isActive ? "opacity-100" : "opacity-30"
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center border-2 transition-all duration-300 ${
                  isCurrent
                    ? "ring-2 ring-offset-2 ring-offset-background scale-110"
                    : ""
                }`}
                style={{
                  borderColor: isActive ? layer.color : "rgba(128,128,128,0.2)",
                  backgroundColor: isActive ? `${layer.color}15` : "transparent",
                  ...(isCurrent ? { ringColor: layer.color } : {}),
                }}
              >
                <Icon
                  className="w-5 h-5"
                  style={{ color: isActive ? layer.color : "rgba(128,128,128,0.3)" }}
                />
              </div>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: isActive ? layer.color : "rgba(128,128,128,0.3)" }}
              >
                {layer.label}
              </span>
              {label2 && (
                <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[160px]" title={label2}>
                  {label2}
                </span>
              )}
              {label3 && (
                <span className="text-[9px] text-muted-foreground/60 truncate max-w-[160px]">
                  {label3}
                </span>
              )}
              {!isActive && i > 1 && (
                <span className="text-[9px] text-muted-foreground/30 italic">pending</span>
              )}
            </div>

            {/* Connector arrow (except after last) */}
            {i < LAYERS.length - 1 && (
              <div className="flex-1 flex items-center min-w-[30px] mx-1">
                <div
                  className="w-full h-[2px]"
                  style={{
                    background:
                      i < maxIdx + 1
                        ? `repeating-linear-gradient(90deg, ${layer.color} 0px, ${layer.color} 6px, transparent 6px, transparent 10px)`
                        : "repeating-linear-gradient(90deg, rgba(128,128,128,0.15) 0px, rgba(128,128,128,0.15) 4px, transparent 4px, transparent 8px)",
                    backgroundSize: i < maxIdx + 1 ? "16px 2px" : "8px 2px",
                    animation: i < maxIdx + 1 ? "flowDash 1s linear infinite" : "none",
                  }}
                />
                <ArrowRight
                  className="w-3 h-3 -ml-1 flex-shrink-0"
                  style={{
                    color: i < maxIdx + 1 ? LAYERS[i + 1].color : "rgba(128,128,128,0.15)",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A card describing what happens at a layer transition */
function TransitionCard({
  from,
  to,
  children,
  reached,
}: {
  from: string;
  to: string;
  children: React.ReactNode;
  reached: boolean;
}) {
  const fromLayer = LAYERS.find((l) => l.key === from)!;
  const toLayer = LAYERS.find((l) => l.key === to)!;

  return (
    <div
      className={`rounded-xl border p-4 transition-all duration-300 ${
        reached
          ? "bg-card/80 border-border/50"
          : "bg-card/20 border-border/20 opacity-40"
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: fromLayer.color }}>
          {fromLayer.label}
        </span>
        <ArrowRight className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: toLayer.color }}>
          {toLayer.label}
        </span>
      </div>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

/** Inline stat with icon */
function Stat({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground/50" />
      <span className="text-muted-foreground/70 text-xs">{label}:</span>
      <span className={`text-xs font-medium ${color || "text-foreground"}`}>{value}</span>
    </div>
  );
}

/** Schema diff status badge */
function DiffBadge({ status }: { status: string }) {
  const styles: Record<string, { label: string; cls: string }> = {
    unchanged: { label: "Match", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    type_changed: { label: "Type Changed", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    added_in_silver: { label: "+ Silver", cls: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
    bronze_only: { label: "Bronze Only", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  };
  const s = styles[status] || styles.unchanged;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${s.cls}`}>
      {s.label}
    </span>
  );
}

/** On-demand profiling panel */
function ProfilePanel({
  lakehouse,
  schema,
  table,
  layerColor,
}: {
  lakehouse: string;
  schema: string;
  table: string;
  layerColor: string;
}) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (profile) {
      setExpanded(!expanded);
      return;
    }
    setLoading(true);
    setExpanded(true);
    setProfileError(null);
    try {
      const data = await fetchJson<ProfileData>(
        `/blender/profile?lakehouse=${encodeURIComponent(lakehouse)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`
      );
      if (!data || !data.columns || data.columns.length === 0) {
        setProfileError("No column data available. Table may not have been loaded yet.");
        setProfile(null);
      } else {
        setProfile(data);
      }
    } catch (e) {
      setProfileError(
        e instanceof Error ? e.message : "Failed to profile table. Data may not have been loaded to this layer yet."
      );
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [lakehouse, schema, table, profile, expanded]);

  return (
    <div className="mt-3">
      <button
        onClick={loadProfile}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/50 bg-card/50 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <BarChart3 className="w-3 h-3" />
        )}
        {expanded ? "Hide Profile" : "Profile Columns"}
      </button>

      {expanded && profileError && (
        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <span className="text-xs text-amber-400/80">{profileError}</span>
        </div>
      )}

      {expanded && profile && (
        <div className="mt-2 rounded-lg border border-border/30 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30 border-b border-border/20">
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Column</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Type</th>
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Distinct</th>
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Nulls</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Completeness</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Min</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Max</th>
              </tr>
            </thead>
            <tbody>
              {profile.columns.map((col) => (
                <tr key={col.name} className="border-b border-border/10 hover:bg-muted/10">
                  <td className="px-3 py-1.5 font-mono text-foreground">{col.name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{col.dataType}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{fmt(col.distinctCount)}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{fmt(col.nullCount)}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${col.completeness}%`,
                            backgroundColor: col.completeness > 95 ? "#10b981" : col.completeness > 80 ? "#f59e0b" : "#ef4444",
                          }}
                        />
                      </div>
                      <span className="text-muted-foreground/60 text-[10px]">{col.completeness.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground/60 font-mono text-[10px] max-w-[100px] truncate" title={col.minValue || ""}>
                    {col.minValue || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground/60 font-mono text-[10px] max-w-[100px] truncate" title={col.maxValue || ""}>
                    {col.maxValue || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function DataJourney() {
  const [searchParams, setSearchParams] = useSearchParams();
  const entityIdParam = searchParams.get("entity");
  const tableParam = searchParams.get("table");
  const schemaParam = searchParams.get("schema");

  const { allEntities: entities, loading: listLoading } = useEntityDigest();
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [diffTab, setDiffTab] = useState<"diff" | "bronze" | "silver">("diff");

  // Load journey when entity is selected
  const loadJourney = useCallback(
    async (id: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJson<JourneyData>(`/journey?entity=${id}`);
        if (data.error) {
          setError(data.error);
          setJourney(null);
        } else {
          setJourney(data);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load journey");
        setJourney(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Resolve URL params on mount
  useEffect(() => {
    if (entityIdParam) {
      loadJourney(parseInt(entityIdParam, 10));
    } else if (tableParam && entities.length > 0) {
      // Reverse lookup: find entity by table name
      const match = entities.find(
        (e) =>
          e.tableName.toLowerCase() === tableParam.toLowerCase() &&
          (!schemaParam || e.sourceSchema.toLowerCase() === schemaParam.toLowerCase())
      );
      if (match) {
        const idStr = String(match.id);
        setSearchParams({ entity: idStr }, { replace: true });
        loadJourney(match.id);
      }
    }
  }, [entityIdParam, tableParam, schemaParam, entities.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Select an entity
  const selectEntity = useCallback(
    (id: string) => {
      setSearchParams({ entity: id }, { replace: true });
      setDropdownOpen(false);
      setSearchQuery("");
      loadJourney(parseInt(id, 10));
    },
    [setSearchParams, loadJourney]
  );

  // Filtered entity list for dropdown
  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return entities;
    const q = searchQuery.toLowerCase();
    return entities.filter(
      (e) =>
        e.tableName.toLowerCase().includes(q) ||
        e.sourceSchema.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q)
    );
  }, [entities, searchQuery]);

  // Group entities by source (friendly label)
  const groupedEntities = useMemo(() => {
    const groups: Record<string, DigestEntity[]> = {};
    filteredEntities.forEach((e) => {
      const key = e.source || "Unknown";
      (groups[key] ||= []).push(e);
    });
    // Sort groups alphabetically
    return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
  }, [filteredEntities]);

  // Compute transition stats
  const rowDelta = journey?.bronze?.rowCount != null && journey?.silver?.rowCount != null
    ? journey.silver.rowCount - journey.bronze.rowCount
    : null;
  const colDelta = journey?.bronze && journey?.silver
    ? journey.silver.columnCount - journey.bronze.columnCount
    : null;
  const addedInSilver = journey?.schemaDiff.filter((d) => d.status === "added_in_silver") || [];
  const bronzeOnly = journey?.schemaDiff.filter((d) => d.status === "bronze_only") || [];
  const typeChanged = journey?.schemaDiff.filter((d) => d.status === "type_changed") || [];

  // Ref for click-outside detection
  const selectorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Find selected entity for display
  const selectedEntity = entities.find((e) => String(e.id) === entityIdParam);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border/50 bg-card/30 px-6 py-4" style={{ zIndex: 100, position: "relative" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <GitBranch className="w-5 h-5 text-primary" />
            <h1 className="font-display text-lg font-semibold">Data Journey</h1>
            {journey && (
              <span className="text-muted-foreground text-sm">
                — {journey.source.namespace || journey.source.dataSourceName}: {journey.landing.fileName || journey.source.name}
              </span>
            )}
          </div>
          {journey && (
            <button
              onClick={() => loadJourney(journey.entityId)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
        </div>

        {/* Entity Selector — proper combobox dropdown */}
        <div ref={selectorRef} className="relative max-w-2xl">
          {/* Trigger button / search input */}
          <div
            className={`flex items-center border rounded-lg transition-colors cursor-pointer ${
              dropdownOpen
                ? "border-primary/50 bg-card/80 ring-1 ring-primary/20"
                : "border-border/50 bg-card/50 hover:border-border"
            }`}
            onClick={() => !dropdownOpen && setDropdownOpen(true)}
          >
            <Search className="w-4 h-4 text-muted-foreground/50 ml-3 flex-shrink-0" />
            {dropdownOpen ? (
              <input
                type="text"
                autoFocus
                placeholder={listLoading ? "Loading entities..." : `Filter ${entities.length} entities...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2.5 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
              />
            ) : (
              <div className="w-full px-3 py-2.5 text-sm">
                {selectedEntity ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                      {selectedEntity.source}
                    </span>
                    <span className="font-mono text-foreground">{selectedEntity.tableName}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground/40">Select an entity...</span>
                )}
              </div>
            )}
            {entityIdParam && !dropdownOpen && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSearchParams({}, { replace: true });
                  setJourney(null);
                  setSearchQuery("");
                }}
                className="mr-2 text-muted-foreground/40 hover:text-muted-foreground"
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}
            <ChevronDown className={`w-4 h-4 text-muted-foreground/40 mr-3 flex-shrink-0 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
          </div>

          {/* Dropdown list */}
          {dropdownOpen && !listLoading && (
            <div className="absolute z-[200] mt-1 w-full max-h-[60vh] overflow-y-auto rounded-lg border border-border/50 bg-popover shadow-2xl">
              {Object.entries(groupedEntities).map(([source, items]) => (
                <div key={source}>
                  <div className="sticky top-0 px-3 py-2 bg-muted/80 backdrop-blur-sm border-b border-border/20 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                      {source}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">{items.length} entities</span>
                  </div>
                  {items.map((e) => {
                    const idStr = String(e.id);
                    return (
                      <button
                        key={idStr}
                        onClick={() => selectEntity(idStr)}
                        className={`w-full text-left px-3 py-2 hover:bg-primary/5 transition-colors flex items-center justify-between gap-2 ${
                          entityIdParam === idStr ? "bg-primary/10 border-l-2 border-primary" : ""
                        }`}
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="text-sm font-mono text-foreground truncate">
                            {e.tableName}
                          </span>
                          {e.sourceSchema !== "dbo" && (
                            <span className="text-[10px] text-muted-foreground/40 flex-shrink-0">{e.sourceSchema}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground/30 flex-shrink-0">
                          #{idStr}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {Object.keys(groupedEntities).length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground/40">
                  No entities match "{searchQuery}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading entity journey...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-64 gap-2 text-red-400">
            <XCircle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {!loading && !error && !journey && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/40">
            <GitBranch className="w-10 h-10" />
            <p className="text-sm">Select an entity above to trace its data journey</p>
            <p className="text-xs">See how your data transforms through Source → Landing → Bronze → Silver → Gold</p>
          </div>
        )}

        {journey && !loading && (
          <div className="p-6 space-y-6 max-w-6xl mx-auto">
            {/* Layer Timeline */}
            <div className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm p-4">
              <LayerTimeline data={journey} />
            </div>

            {/* Transition Cards */}
            <div className="grid gap-4">
              {/* Source → Landing Zone */}
              <TransitionCard from="source" to="landing" reached={true}>
                <Stat icon={FileText} label="Load Type" value={journey.landing.isIncremental ? "Incremental" : "Full Load"} />
                <Stat icon={FileText} label="Format" value={journey.landing.fileType || "PARQUET"} />
                <Stat icon={FileText} label="Path" value={journey.landing.filePath || "—"} />
                <Stat icon={Database} label="Connection" value={`${journey.source.connectionName} (${journey.source.connectionType})`} />
                {journey.landing.isIncremental && journey.landing.incrementalColumn && (
                  <Stat icon={ArrowUpDown} label="Watermark Column" value={journey.landing.incrementalColumn} />
                )}
                {journey.landing.customSelect && (
                  <Stat icon={FileText} label="Custom SQL" value="Yes — custom SELECT query" />
                )}
                <p className="text-xs text-muted-foreground/50 mt-1 italic">
                  Raw data extracted from {journey.source.schema}.{journey.source.name} via {journey.source.connectionType} gateway,
                  saved as {journey.landing.fileType?.toLowerCase() || "parquet"} file in {journey.landing.lakehouse}.
                </p>
              </TransitionCard>

              {/* Landing Zone → Bronze */}
              <TransitionCard from="landing" to="bronze" reached={!!journey.bronze}>
                {journey.bronze ? (
                  <>
                    <Stat icon={Key} label="Primary Keys" value={journey.bronze.primaryKeys || "None specified"} />
                    <Stat icon={FileText} label="Format" value={`${journey.landing.fileType} → ${journey.bronze.fileType}`} />
                    <Stat icon={Columns3} label="Columns" value={`${journey.bronze.columnCount}`} />
                    <Stat icon={BarChart3} label="Row Count" value={fmt(journey.bronze.rowCount)} />
                    <Stat icon={Database} label="Lakehouse" value={journey.bronze.lakehouse} />
                    <p className="text-xs text-muted-foreground/50 mt-1 italic">
                      {journey.landing.fileType?.toLowerCase() || "Parquet"} files loaded into Delta table with schema enforcement.
                      {journey.bronze.primaryKeys
                        ? ` Primary key (${journey.bronze.primaryKeys}) used for upsert/merge operations.`
                        : " Append-only load (no merge keys specified)."}
                    </p>
                    <ProfilePanel
                      lakehouse={journey.bronze.lakehouse}
                      schema={journey.bronze.schema}
                      table={journey.bronze.name}
                      layerColor="#f59e0b"
                    />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground/40 italic">
                    Not yet loaded to Bronze. Run the Bronze pipeline to transform landing zone files into structured Delta tables.
                  </p>
                )}
              </TransitionCard>

              {/* Bronze → Silver */}
              <TransitionCard from="bronze" to="silver" reached={!!journey.silver}>
                {journey.silver ? (
                  <>
                    {rowDelta !== null && (
                      <Stat
                        icon={rowDelta >= 0 ? Plus : Minus}
                        label="Row Delta"
                        value={`${rowDelta >= 0 ? "+" : ""}${fmt(rowDelta)} (${fmt(journey.bronze?.rowCount)} → ${fmt(journey.silver.rowCount)})`}
                        color={rowDelta === 0 ? "text-emerald-400" : rowDelta < 0 ? "text-amber-400" : "text-blue-400"}
                      />
                    )}
                    {colDelta !== null && (
                      <Stat
                        icon={Columns3}
                        label="Column Delta"
                        value={`${colDelta >= 0 ? "+" : ""}${colDelta} (${journey.bronze?.columnCount} → ${journey.silver.columnCount})`}
                        color={colDelta === 0 ? "text-emerald-400" : "text-violet-400"}
                      />
                    )}
                    {addedInSilver.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Plus className="w-3.5 h-3.5 text-violet-400 mt-0.5" />
                        <div>
                          <span className="text-xs text-muted-foreground/70">Added in Silver: </span>
                          <span className="text-xs font-mono text-violet-400">
                            {addedInSilver.map((d) => d.columnName).join(", ")}
                          </span>
                        </div>
                      </div>
                    )}
                    {bronzeOnly.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Minus className="w-3.5 h-3.5 text-amber-400 mt-0.5" />
                        <div>
                          <span className="text-xs text-muted-foreground/70">Dropped from Bronze: </span>
                          <span className="text-xs font-mono text-amber-400">
                            {bronzeOnly.map((d) => d.columnName).join(", ")}
                          </span>
                        </div>
                      </div>
                    )}
                    {typeChanged.length > 0 && (
                      <div className="flex items-start gap-2">
                        <ArrowUpDown className="w-3.5 h-3.5 text-amber-400 mt-0.5" />
                        <div>
                          <span className="text-xs text-muted-foreground/70">Type changes: </span>
                          <span className="text-xs font-mono text-amber-400">
                            {typeChanged.map((d) => `${d.columnName} (${d.bronzeType}→${d.silverType})`).join(", ")}
                          </span>
                        </div>
                      </div>
                    )}
                    <Stat icon={Database} label="Lakehouse" value={journey.silver.lakehouse} />
                    <p className="text-xs text-muted-foreground/50 mt-1 italic">
                      Data quality rules applied, audit columns added.
                      {rowDelta !== null && rowDelta < 0
                        ? ` ${Math.abs(rowDelta).toLocaleString()} rows removed during cleansing.`
                        : rowDelta !== null && rowDelta > 0
                        ? ` ${rowDelta.toLocaleString()} rows added (SCD history expansion).`
                        : " Row count preserved through transformation."}
                    </p>
                    <ProfilePanel
                      lakehouse={journey.silver.lakehouse}
                      schema={journey.silver.schema}
                      table={journey.silver.name}
                      layerColor="#8b5cf6"
                    />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground/40 italic">
                    {journey.bronze
                      ? "Not yet loaded to Silver. Run the Silver pipeline to apply DQ rules and cleansing."
                      : "Waiting for Bronze layer to be populated first."}
                  </p>
                )}
              </TransitionCard>

              {/* Silver → Gold */}
              <TransitionCard from="silver" to="gold" reached={false}>
                <p className="text-xs text-muted-foreground/40 italic">
                  Gold layer (Materialized Lakehouse Views) coming soon. Will contain business-ready dimensional models.
                </p>
              </TransitionCard>
            </div>

            {/* Schema Diff Table */}
            {(journey.bronze || journey.silver) && journey.schemaDiff.length > 0 && (
              <div className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm overflow-hidden">
                {/* Tabs */}
                <div className="flex border-b border-border/30 bg-muted/10">
                  {[
                    { key: "diff" as const, label: "Schema Diff", count: journey.schemaDiff.length },
                    ...(journey.bronze ? [{ key: "bronze" as const, label: "Bronze Columns", count: journey.bronze.columnCount }] : []),
                    ...(journey.silver ? [{ key: "silver" as const, label: "Silver Columns", count: journey.silver.columnCount }] : []),
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setDiffTab(tab.key)}
                      className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                        diffTab === tab.key
                          ? "text-foreground border-primary"
                          : "text-muted-foreground border-transparent hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                      <span className="ml-1.5 text-muted-foreground/40">({tab.count})</span>
                    </button>
                  ))}
                </div>

                {/* Diff Table */}
                {diffTab === "diff" && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/20 border-b border-border/20">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Column</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground" style={{ color: "#f59e0b" }}>Bronze Type</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground" style={{ color: "#8b5cf6" }}>Silver Type</th>
                          <th className="text-center px-4 py-2 font-medium text-muted-foreground">Status</th>
                          <th className="text-center px-4 py-2 font-medium text-muted-foreground" style={{ color: "#f59e0b" }}>Nullable (B)</th>
                          <th className="text-center px-4 py-2 font-medium text-muted-foreground" style={{ color: "#8b5cf6" }}>Nullable (S)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journey.schemaDiff.map((d) => (
                          <tr key={d.columnName} className="border-b border-border/10 hover:bg-muted/10">
                            <td className="px-4 py-2 font-mono text-foreground">{d.columnName}</td>
                            <td className="px-4 py-2 font-mono text-muted-foreground">{d.bronzeType || "—"}</td>
                            <td className="px-4 py-2 font-mono text-muted-foreground">{d.silverType || "—"}</td>
                            <td className="px-4 py-2 text-center"><DiffBadge status={d.status} /></td>
                            <td className="px-4 py-2 text-center">
                              {d.bronzeNullable === "YES" ? (
                                <span className="text-amber-400/60">YES</span>
                              ) : d.bronzeNullable === "NO" ? (
                                <span className="text-emerald-400/60">NO</span>
                              ) : (
                                <span className="text-muted-foreground/20">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {d.silverNullable === "YES" ? (
                                <span className="text-amber-400/60">YES</span>
                              ) : d.silverNullable === "NO" ? (
                                <span className="text-emerald-400/60">NO</span>
                              ) : (
                                <span className="text-muted-foreground/20">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Bronze columns tab */}
                {diffTab === "bronze" && journey.bronze && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/20 border-b border-border/20">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">#</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Column</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                          <th className="text-center px-4 py-2 font-medium text-muted-foreground">Nullable</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">Max Length</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">Precision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journey.bronze.columns.map((c) => (
                          <tr key={c.COLUMN_NAME} className="border-b border-border/10 hover:bg-muted/10">
                            <td className="px-4 py-2 text-muted-foreground/40">{c.ORDINAL_POSITION}</td>
                            <td className="px-4 py-2 font-mono text-foreground">{c.COLUMN_NAME}</td>
                            <td className="px-4 py-2 font-mono text-muted-foreground">{c.DATA_TYPE}</td>
                            <td className="px-4 py-2 text-center">
                              {c.IS_NULLABLE === "YES" ? (
                                <span className="text-amber-400/60">YES</span>
                              ) : (
                                <span className="text-emerald-400/60">NO</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right text-muted-foreground/60">{c.CHARACTER_MAXIMUM_LENGTH || "—"}</td>
                            <td className="px-4 py-2 text-right text-muted-foreground/60">
                              {c.NUMERIC_PRECISION ? `${c.NUMERIC_PRECISION}${c.NUMERIC_SCALE ? `,${c.NUMERIC_SCALE}` : ""}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Silver columns tab */}
                {diffTab === "silver" && journey.silver && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/20 border-b border-border/20">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">#</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Column</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                          <th className="text-center px-4 py-2 font-medium text-muted-foreground">Nullable</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">Max Length</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">Precision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journey.silver.columns.map((c) => (
                          <tr key={c.COLUMN_NAME} className="border-b border-border/10 hover:bg-muted/10">
                            <td className="px-4 py-2 text-muted-foreground/40">{c.ORDINAL_POSITION}</td>
                            <td className="px-4 py-2 font-mono text-foreground">{c.COLUMN_NAME}</td>
                            <td className="px-4 py-2 font-mono text-muted-foreground">{c.DATA_TYPE}</td>
                            <td className="px-4 py-2 text-center">
                              {c.IS_NULLABLE === "YES" ? (
                                <span className="text-amber-400/60">YES</span>
                              ) : (
                                <span className="text-emerald-400/60">NO</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right text-muted-foreground/60">{c.CHARACTER_MAXIMUM_LENGTH || "—"}</td>
                            <td className="px-4 py-2 text-right text-muted-foreground/60">
                              {c.NUMERIC_PRECISION ? `${c.NUMERIC_PRECISION}${c.NUMERIC_SCALE ? `,${c.NUMERIC_SCALE}` : ""}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Summary footer for LZ-only entities */}
            {!journey.bronze && !journey.silver && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-blue-400 font-medium">Landing Zone Only</p>
                  <p className="text-muted-foreground/60 text-xs mt-1">
                    This entity has been registered but hasn't been processed through the Bronze or Silver pipelines yet.
                    Run the Landing Zone → Bronze pipeline to see schema and row count details.
                    Column schemas cannot be read from raw {journey.landing.fileType?.toLowerCase() || "parquet"} files in the landing zone —
                    they'll appear once the data is loaded into a Delta table at the Bronze layer.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CSS for connector animation */}
      <style>{`
        @keyframes flowDash {
          from { background-position: 0 0; }
          to { background-position: 16px 0; }
        }
      `}</style>
    </div>
  );
}
