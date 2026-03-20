import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import StrataBar from "@/components/data/StrataBar";
import LayerStatusDot, { normalizeStatus } from "@/components/data/LayerStatusDot";
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
  AlertTriangle,
  Beaker,
} from "lucide-react";

// ============================================================================
// CONSTANTS — BP palette for medallion layers
// ============================================================================

const API = "/api";

const LAYERS = [
  { key: "source",  label: "Source",       color: "var(--bp-ink-muted)",     hex: "#A8A29E", icon: Database,  bg: "bg-[var(--bp-surface-inset)]", border: "border-[var(--bp-border)]" },
  { key: "landing", label: "Landing Zone", color: "var(--bp-ink-muted)",     hex: "#A8A29E", icon: HardDrive, bg: "bg-[var(--bp-surface-inset)]", border: "border-[var(--bp-border)]" },
  { key: "bronze",  label: "Bronze",       color: "#9A4A1F",                hex: "#9A4A1F", icon: Table2,    bg: "bg-[#EDCFBD]",                 border: "border-[var(--bp-border)]" },
  { key: "silver",  label: "Silver",       color: "#475569",                hex: "#475569", icon: Sparkles,  bg: "bg-[#E2E8F0]",                 border: "border-[var(--bp-border)]" },
  { key: "gold",    label: "Gold",         color: "var(--bp-operational)",   hex: "#3D7C4F", icon: Crown,     bg: "bg-[var(--bp-operational-light)]", border: "border-[var(--bp-border)]" },
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
    onelakeSchema?: string;
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
    onelakeSchema?: string;
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
    onelakeSchema?: string;
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

// ============================================================================
// HELPERS
// ============================================================================

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "\u2014";
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
        const isActive = i <= maxIdx + 1;
        const isCurrent = layer.key === maxLayer;
        const Icon = layer.icon;

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
          label3 = `${fmt(data.bronze.rowCount)} rows \u00b7 ${data.bronze.columnCount} cols`;
        } else if (layer.key === "silver" && data.silver) {
          label2 = `${data.silver.schema}.${data.silver.name}`;
          label3 = `${fmt(data.silver.rowCount)} rows \u00b7 ${data.silver.columnCount} cols`;
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
                    ? "ring-2 ring-offset-2 scale-110"
                    : ""
                }`}
                style={{
                  borderColor: isActive ? layer.hex : "rgba(128,128,128,0.2)",
                  backgroundColor: isActive ? `${layer.hex}15` : "transparent",
                  ringColor: isCurrent ? layer.hex : undefined,
                  ...(isCurrent ? { ringColor: layer.hex, ["--tw-ring-offset-color" as string]: "var(--bp-canvas)" } : {}),
                }}
              >
                <Icon
                  className="w-5 h-5"
                  style={{ color: isActive ? layer.hex : "rgba(128,128,128,0.3)" }}
                />
              </div>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: isActive ? layer.hex : "rgba(128,128,128,0.3)" }}
              >
                {layer.label}
              </span>
              {label2 && (
                <span className="text-[10px] truncate max-w-[160px]" title={label2} style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-secondary)" }}>
                  {label2}
                </span>
              )}
              {label3 && (
                <span className="text-[9px] truncate max-w-[160px]" style={{ color: "var(--bp-ink-muted)" }}>
                  {label3}
                </span>
              )}
              {!isActive && i > 1 && (
                <span className="text-[9px] italic" style={{ color: "var(--bp-ink-muted)", opacity: 0.5 }}>pending</span>
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
                        ? `repeating-linear-gradient(90deg, ${layer.hex} 0px, ${layer.hex} 6px, transparent 6px, transparent 10px)`
                        : "repeating-linear-gradient(90deg, rgba(128,128,128,0.15) 0px, rgba(128,128,128,0.15) 4px, transparent 4px, transparent 8px)",
                    backgroundSize: i < maxIdx + 1 ? "16px 2px" : "8px 2px",
                    animation: i < maxIdx + 1 ? "flowDash 1s linear infinite" : "none",
                  }}
                />
                <ArrowRight
                  className="w-3 h-3 -ml-1 flex-shrink-0"
                  style={{
                    color: i < maxIdx + 1 ? LAYERS[i + 1].hex : "rgba(128,128,128,0.15)",
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
      className="rounded-xl p-4 transition-all duration-300"
      style={{
        border: reached ? "1px solid var(--bp-border)" : "1px solid rgba(0,0,0,0.04)",
        backgroundColor: reached ? "var(--bp-surface-1)" : "var(--bp-surface-2)",
        opacity: reached ? 1 : 0.4,
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: fromLayer.hex }}>
          {fromLayer.label}
        </span>
        <ArrowRight className="w-3 h-3" style={{ color: "var(--bp-ink-muted)" }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: toLayer.hex }}>
          {toLayer.label}
        </span>
      </div>
      <div className="space-y-2 text-sm" style={{ color: "var(--bp-ink-secondary)" }}>{children}</div>
    </div>
  );
}

/** Inline stat with icon */
function Stat({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5" style={{ color: "var(--bp-ink-muted)" }} />
      <span className="text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>{label}:</span>
      <span className={`text-xs font-medium ${color || ""}`} style={!color ? { color: "var(--bp-ink-primary)" } : undefined}>{value}</span>
    </div>
  );
}

/** Schema diff status badge */
function DiffBadge({ status }: { status: string }) {
  const styles: Record<string, { label: string; bgColor: string; textColor: string; borderColor: string }> = {
    unchanged:       { label: "Match",         bgColor: "var(--bp-operational-light)", textColor: "var(--bp-operational)", borderColor: "rgba(61,124,79,0.2)" },
    type_changed:    { label: "Type Changed",  bgColor: "var(--bp-caution-light)",     textColor: "var(--bp-caution)",     borderColor: "rgba(194,122,26,0.2)" },
    added_in_silver: { label: "+ Silver",      bgColor: "#E2E8F0",                    textColor: "#475569",               borderColor: "rgba(71,85,105,0.2)" },
    bronze_only:     { label: "Bronze Only",   bgColor: "#EDCFBD",                    textColor: "#9A4A1F",               borderColor: "rgba(154,74,31,0.2)" },
  };
  const s = styles[status] || styles.unchanged;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ backgroundColor: s.bgColor, color: s.textColor, border: `1px solid ${s.borderColor}` }}
    >
      {s.label}
    </span>
  );
}

/** Profile link — navigates to dedicated Data Profiler page */
function ProfilePanel({
  lakehouse,
  schema,
  table,
  layer,
}: {
  lakehouse: string;
  schema: string;
  table: string;
  layer: "landing" | "bronze" | "silver";
}) {
  const profileUrl = `/profile?lakehouse=${encodeURIComponent(lakehouse)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}&layer=${encodeURIComponent(layer)}`;

  const blenderUrl = `/blender?table=${encodeURIComponent(table)}&schema=${encodeURIComponent(schema)}&layer=${encodeURIComponent(layer)}`;

  return (
    <div className="mt-3 flex items-center gap-2">
      <Link
        to={profileUrl}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
        style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-secondary)" }}
      >
        <BarChart3 className="w-3 h-3" />
        Profile Columns
      </Link>
      <Link
        to={blenderUrl}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
        style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-secondary)" }}
      >
        <Beaker className="w-3 h-3" />
        Profile in Blender
      </Link>
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
  const hasLoadedOnce = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [diffTab, setDiffTab] = useState<"diff" | "bronze" | "silver">("diff");

  // Load journey when entity is selected
  const loadJourney = useCallback(
    async (id: number) => {
      if (!hasLoadedOnce.current) setLoading(true);
      setError(null);
      try {
        const data = await fetchJson<JourneyData>(`/journey?entity=${id}`);
        if (data.error) {
          setError(data.error);
          setJourney(null);
        } else {
          setJourney(data);
          hasLoadedOnce.current = true;
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
    if (entityIdParam && /^\d+$/.test(entityIdParam)) {
      loadJourney(parseInt(entityIdParam, 10));
    } else if (tableParam && entities.length > 0) {
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
      hasLoadedOnce.current = false;
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

  // Group entities by source
  const groupedEntities = useMemo(() => {
    const groups: Record<string, DigestEntity[]> = {};
    filteredEntities.forEach((e) => {
      const key = e.source || "Unknown";
      (groups[key] ||= []).push(e);
    });
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
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bp-canvas)" }}>
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4" style={{ borderBottom: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)", zIndex: 100, position: "relative" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <GitBranch className="w-5 h-5" style={{ color: "var(--bp-copper)" }} />
            <h1 style={{ fontFamily: "var(--bp-font-display)", fontSize: "32px", color: "var(--bp-ink-primary)", lineHeight: "1.1" }}>Data Journey</h1>
            {journey && (
              <span className="text-sm" style={{ color: "var(--bp-ink-secondary)" }}>
                — {journey.source.namespace || journey.source.dataSourceName}: {journey.landing.fileName || journey.source.name}
              </span>
            )}
          </div>
          {journey && (
            <button
              onClick={() => loadJourney(journey.entityId)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
              style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
        </div>

        {/* Entity Selector */}
        <div ref={selectorRef} className="relative max-w-2xl">
          <div
            className="flex items-center rounded-lg transition-colors cursor-pointer"
            style={{
              border: dropdownOpen ? "1px solid var(--bp-copper)" : "1px solid var(--bp-border)",
              backgroundColor: dropdownOpen ? "var(--bp-surface-1)" : "var(--bp-surface-1)",
              ...(dropdownOpen ? { boxShadow: "0 0 0 1px rgba(180,86,36,0.2)" } : {}),
            }}
            onClick={() => !dropdownOpen && setDropdownOpen(true)}
          >
            <Search className="w-4 h-4 ml-3 flex-shrink-0" style={{ color: "var(--bp-ink-muted)" }} />
            {dropdownOpen ? (
              <input
                type="text"
                autoFocus
                placeholder={listLoading ? "Loading entities..." : `Filter ${entities.length} entities...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2.5 bg-transparent text-sm outline-none"
                style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
              />
            ) : (
              <div className="w-full px-3 py-2.5 text-sm">
                {selectedEntity ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--bp-copper-light)", color: "var(--bp-copper)", border: "1px solid rgba(180,86,36,0.2)" }}>
                      {selectedEntity.source}
                    </span>
                    <span style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-primary)" }}>{selectedEntity.tableName}</span>
                  </div>
                ) : (
                  <span style={{ color: "var(--bp-ink-muted)" }}>Select an entity...</span>
                )}
              </div>
            )}
            {entityIdParam && !dropdownOpen && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  hasLoadedOnce.current = false;
                  setSearchParams({}, { replace: true });
                  setJourney(null);
                  setSearchQuery("");
                }}
                className="mr-2"
                style={{ color: "var(--bp-ink-muted)" }}
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}
            <ChevronDown className={`w-4 h-4 mr-3 flex-shrink-0 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} style={{ color: "var(--bp-ink-muted)" }} />
          </div>

          {/* Dropdown list */}
          {dropdownOpen && !listLoading && (
            <div className="absolute z-[200] mt-1 w-full max-h-[60vh] overflow-y-auto rounded-lg shadow-2xl" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
              {Object.entries(groupedEntities).map(([source, items]) => (
                <div key={source}>
                  <div className="sticky top-0 px-3 py-2 backdrop-blur-sm flex items-center justify-between" style={{ backgroundColor: "var(--bp-surface-inset)", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--bp-copper)" }}>
                      {source}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>{items.length} entities</span>
                  </div>
                  {items.map((e) => {
                    const idStr = String(e.id);
                    return (
                      <button
                        key={idStr}
                        onClick={() => selectEntity(idStr)}
                        className="w-full text-left px-3 py-2 transition-colors flex items-center justify-between gap-2"
                        style={{
                          ...(entityIdParam === idStr ? { backgroundColor: "var(--bp-copper-light)", borderLeft: "2px solid var(--bp-copper)" } : {}),
                        }}
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="text-sm truncate" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-primary)" }}>
                            {e.tableName}
                          </span>
                          {e.sourceSchema !== "dbo" && (
                            <span className="text-[10px] flex-shrink-0" style={{ color: "var(--bp-ink-muted)" }}>{e.sourceSchema}</span>
                          )}
                        </div>
                        <span className="text-[10px] flex-shrink-0" style={{ color: "var(--bp-ink-muted)", opacity: 0.5 }}>
                          #{idStr}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {Object.keys(groupedEntities).length === 0 && (
                <div className="px-3 py-6 text-center text-sm" style={{ color: "var(--bp-ink-muted)" }}>
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
          <div className="flex items-center justify-center h-64 gap-2" style={{ color: "var(--bp-ink-secondary)" }}>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading entity journey...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-64 gap-2" style={{ color: "var(--bp-fault)" }}>
            <XCircle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {!loading && !error && !journey && (
          <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color: "var(--bp-ink-muted)" }}>
            <GitBranch className="w-10 h-10" />
            <p className="text-sm">Select an entity above to trace its data journey</p>
            <p className="text-xs">See how your data transforms through Source &rarr; Landing &rarr; Bronze &rarr; Silver &rarr; Gold</p>
          </div>
        )}

        {journey && !loading && (
          <div className="p-6 space-y-6 max-w-6xl mx-auto">
            {/* Layer Timeline */}
            <div className="rounded-xl p-4" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
              <LayerTimeline data={journey} />
            </div>

            {/* Entity Status Strip — StrataBar + pipeline status dots + root cause */}
            {selectedEntity && (
              <div className="rounded-xl p-4" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
                <div className="flex items-center gap-6">
                  {/* Strata bar */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--bp-ink-muted)" }}>
                        Layer Presence
                      </span>
                    </div>
                    <StrataBar
                      lz={journey.bronze?.rowCount ?? (journey.landing ? 1 : null)}
                      bronze={journey.bronze?.rowCount ?? null}
                      silver={journey.silver?.rowCount ?? null}
                      mode="count"
                      size="lg"
                      showLabels
                    />
                  </div>

                  {/* Pipeline status dots */}
                  <div style={{ flexShrink: 0 }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--bp-ink-muted)" }}>
                        Pipeline Status
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <LayerStatusDot status={normalizeStatus(selectedEntity.lzStatus)} size="md" label="LZ" />
                      <LayerStatusDot status={normalizeStatus(selectedEntity.bronzeStatus)} size="md" label="Bronze" />
                      <LayerStatusDot status={normalizeStatus(selectedEntity.silverStatus)} size="md" label="Silver" />
                    </div>
                  </div>

                  {/* Cross-page links */}
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <Link
                      to={`/record-counts?search=${encodeURIComponent(selectedEntity.tableName)}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
                      style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-secondary)" }}
                    >
                      <BarChart3 className="w-3 h-3" /> View Counts
                    </Link>
                    <Link
                      to={`/blender?table=${encodeURIComponent(selectedEntity.tableName)}&schema=${encodeURIComponent(selectedEntity.onelakeSchema || selectedEntity.sourceSchema)}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
                      style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-secondary)" }}
                    >
                      <Beaker className="w-3 h-3" /> Profile in Blender
                    </Link>
                  </div>
                </div>

                {/* Root cause trace — only show when there's an error */}
                {selectedEntity.lastError && (
                  <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: "var(--bp-fault-light)", border: "1px solid rgba(185,58,42,0.2)" }}>
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--bp-fault)" }} />
                      <div>
                        <span className="text-xs font-semibold" style={{ color: "var(--bp-fault)" }}>
                          Root Cause: {selectedEntity.lastError.layer} layer failure
                        </span>
                        <p className="text-xs mt-1" style={{ color: "var(--bp-ink-secondary)" }}>
                          {selectedEntity.lastError.message}
                        </p>
                        <span className="text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>
                          {selectedEntity.lastError.time ? new Date(selectedEntity.lastError.time).toLocaleString() : ""}
                        </span>
                        {selectedEntity.diagnosis && (
                          <p className="text-xs mt-1 italic" style={{ color: "var(--bp-ink-tertiary)" }}>
                            Diagnosis: {selectedEntity.diagnosis}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Transition Cards */}
            <div className="grid gap-4">
              {/* Source → Landing Zone */}
              <TransitionCard from="source" to="landing" reached={true}>
                <Stat icon={FileText} label="Load Type" value={journey.landing.isIncremental ? "Incremental" : "Full Load"} />
                <Stat icon={FileText} label="Format" value={journey.landing.fileType || "PARQUET"} />
                <Stat icon={FileText} label="Path" value={journey.landing.filePath || "\u2014"} />
                <Stat icon={Database} label="Connection" value={`${journey.source.connectionName} (${journey.source.connectionType})`} />
                {journey.landing.isIncremental && journey.landing.incrementalColumn && (
                  <Stat icon={ArrowUpDown} label="Watermark Column" value={journey.landing.incrementalColumn} />
                )}
                {journey.landing.customSelect && (
                  <Stat icon={FileText} label="Custom SQL" value="Yes \u2014 custom SELECT query" />
                )}
                <p className="text-xs mt-1 italic" style={{ color: "var(--bp-ink-muted)" }}>
                  Raw data extracted from {journey.source.schema}.{journey.source.name} via {journey.source.connectionType} gateway,
                  saved as {journey.landing.fileType?.toLowerCase() || "parquet"} file in {journey.landing.lakehouse}.
                </p>
              </TransitionCard>

              {/* Landing Zone → Bronze */}
              <TransitionCard from="landing" to="bronze" reached={!!journey.bronze}>
                {journey.bronze ? (
                  <>
                    <Stat icon={Key} label="Primary Keys" value={journey.bronze.primaryKeys || "None specified"} />
                    <Stat icon={FileText} label="Format" value={`${journey.landing.fileType} \u2192 ${journey.bronze.fileType}`} />
                    <Stat icon={Columns3} label="Columns" value={`${journey.bronze.columnCount}`} />
                    <Stat icon={BarChart3} label="Row Count" value={fmt(journey.bronze.rowCount)} />
                    <Stat icon={Database} label="Lakehouse" value={journey.bronze.lakehouse} />
                    <p className="text-xs mt-1 italic" style={{ color: "var(--bp-ink-muted)" }}>
                      {journey.landing.fileType?.toLowerCase() || "Parquet"} files loaded into Delta table with schema enforcement.
                      {journey.bronze.primaryKeys
                        ? ` Primary key (${journey.bronze.primaryKeys}) used for upsert/merge operations.`
                        : " Append-only load (no merge keys specified)."}
                    </p>
                    <ProfilePanel
                      lakehouse={journey.bronze.lakehouse}
                      schema={journey.bronze.onelakeSchema || journey.bronze.schema}
                      table={journey.bronze.name}
                      layer="bronze"
                    />
                  </>
                ) : (
                  <p className="text-xs italic" style={{ color: "var(--bp-ink-muted)" }}>
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
                        value={`${rowDelta >= 0 ? "+" : ""}${fmt(rowDelta)} (${fmt(journey.bronze?.rowCount)} \u2192 ${fmt(journey.silver.rowCount)})`}
                        color={rowDelta === 0 ? "text-[var(--bp-operational)]" : rowDelta < 0 ? "text-[var(--bp-caution)]" : "text-[var(--bp-copper)]"}
                      />
                    )}
                    {colDelta !== null && (
                      <Stat
                        icon={Columns3}
                        label="Column Delta"
                        value={`${colDelta >= 0 ? "+" : ""}${colDelta} (${journey.bronze?.columnCount} \u2192 ${journey.silver.columnCount})`}
                        color={colDelta === 0 ? "text-[var(--bp-operational)]" : "text-[#475569]"}
                      />
                    )}
                    {addedInSilver.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Plus className="w-3.5 h-3.5 mt-0.5" style={{ color: "#475569" }} />
                        <div>
                          <span className="text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>Added in Silver: </span>
                          <span className="text-xs" style={{ fontFamily: "var(--bp-font-mono)", color: "#475569" }}>
                            {addedInSilver.map((d) => d.columnName).join(", ")}
                          </span>
                        </div>
                      </div>
                    )}
                    {bronzeOnly.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Minus className="w-3.5 h-3.5 mt-0.5" style={{ color: "var(--bp-caution)" }} />
                        <div>
                          <span className="text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>Dropped from Bronze: </span>
                          <span className="text-xs" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-caution)" }}>
                            {bronzeOnly.map((d) => d.columnName).join(", ")}
                          </span>
                        </div>
                      </div>
                    )}
                    {typeChanged.length > 0 && (
                      <div className="flex items-start gap-2">
                        <ArrowUpDown className="w-3.5 h-3.5 mt-0.5" style={{ color: "var(--bp-caution)" }} />
                        <div>
                          <span className="text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>Type changes: </span>
                          <span className="text-xs" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-caution)" }}>
                            {typeChanged.map((d) => `${d.columnName} (${d.bronzeType}\u2192${d.silverType})`).join(", ")}
                          </span>
                        </div>
                      </div>
                    )}
                    <Stat icon={Database} label="Lakehouse" value={journey.silver.lakehouse} />
                    <p className="text-xs mt-1 italic" style={{ color: "var(--bp-ink-muted)" }}>
                      Data quality rules applied, audit columns added.
                      {rowDelta !== null && rowDelta < 0
                        ? ` ${Math.abs(rowDelta).toLocaleString()} rows removed during cleansing.`
                        : rowDelta !== null && rowDelta > 0
                        ? ` ${rowDelta.toLocaleString()} rows added (SCD history expansion).`
                        : " Row count preserved through transformation."}
                    </p>
                    <ProfilePanel
                      lakehouse={journey.silver.lakehouse}
                      schema={journey.silver.onelakeSchema || journey.silver.schema}
                      table={journey.silver.name}
                      layer="silver"
                    />
                  </>
                ) : (
                  <p className="text-xs italic" style={{ color: "var(--bp-ink-muted)" }}>
                    {journey.bronze
                      ? "Not yet loaded to Silver. Run the Silver pipeline to apply DQ rules and cleansing."
                      : "Waiting for Bronze layer to be populated first."}
                  </p>
                )}
              </TransitionCard>

              {/* Silver → Gold */}
              <TransitionCard from="silver" to="gold" reached={false}>
                <p className="text-xs italic" style={{ color: "var(--bp-ink-muted)" }}>
                  Gold layer (Materialized Lakehouse Views) coming soon. Will contain business-ready dimensional models.
                </p>
              </TransitionCard>
            </div>

            {/* Schema Diff Table */}
            {(journey.bronze || journey.silver) && journey.schemaDiff.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
                {/* Tabs */}
                <div className="flex" style={{ borderBottom: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-inset)" }}>
                  {[
                    { key: "diff" as const, label: "Schema Diff", count: journey.schemaDiff.length },
                    ...(journey.bronze ? [{ key: "bronze" as const, label: "Bronze Columns", count: journey.bronze.columnCount }] : []),
                    ...(journey.silver ? [{ key: "silver" as const, label: "Silver Columns", count: journey.silver.columnCount }] : []),
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setDiffTab(tab.key)}
                      className="px-4 py-2.5 text-xs font-medium transition-colors border-b-2"
                      style={
                        diffTab === tab.key
                          ? { color: "var(--bp-ink-primary)", borderColor: "var(--bp-copper)" }
                          : { color: "var(--bp-ink-secondary)", borderColor: "transparent" }
                      }
                    >
                      {tab.label}
                      <span className="ml-1.5" style={{ color: "var(--bp-ink-muted)" }}>({tab.count})</span>
                    </button>
                  ))}
                </div>

                {/* Diff Table */}
                {diffTab === "diff" && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" style={{ fontFamily: "var(--bp-font-mono)" }}>
                      <thead>
                        <tr style={{ backgroundColor: "var(--bp-surface-inset)", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Column</th>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: "#9A4A1F" }}>Bronze Type</th>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: "#475569" }}>Silver Type</th>
                          <th className="text-center px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Status</th>
                          <th className="text-center px-4 py-2 font-medium" style={{ color: "#9A4A1F" }}>Nullable (B)</th>
                          <th className="text-center px-4 py-2 font-medium" style={{ color: "#475569" }}>Nullable (S)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journey.schemaDiff.map((d) => (
                          <tr key={d.columnName} className="hover:bg-[var(--bp-surface-inset)] transition-colors" style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                            <td className="px-4 py-2" style={{ color: "var(--bp-ink-primary)" }}>{d.columnName}</td>
                            <td className="px-4 py-2" style={{ color: "var(--bp-ink-secondary)" }}>{d.bronzeType || "\u2014"}</td>
                            <td className="px-4 py-2" style={{ color: "var(--bp-ink-secondary)" }}>{d.silverType || "\u2014"}</td>
                            <td className="px-4 py-2 text-center"><DiffBadge status={d.status} /></td>
                            <td className="px-4 py-2 text-center">
                              {d.bronzeNullable === "YES" ? (
                                <span style={{ color: "var(--bp-caution)" }}>YES</span>
                              ) : d.bronzeNullable === "NO" ? (
                                <span style={{ color: "var(--bp-operational)" }}>NO</span>
                              ) : (
                                <span style={{ color: "var(--bp-ink-muted)", opacity: 0.3 }}>\u2014</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {d.silverNullable === "YES" ? (
                                <span style={{ color: "var(--bp-caution)" }}>YES</span>
                              ) : d.silverNullable === "NO" ? (
                                <span style={{ color: "var(--bp-operational)" }}>NO</span>
                              ) : (
                                <span style={{ color: "var(--bp-ink-muted)", opacity: 0.3 }}>\u2014</span>
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
                    <table className="w-full text-xs" style={{ fontFamily: "var(--bp-font-mono)" }}>
                      <thead>
                        <tr style={{ backgroundColor: "var(--bp-surface-inset)", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>#</th>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Column</th>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Type</th>
                          <th className="text-center px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Nullable</th>
                          <th className="text-right px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Max Length</th>
                          <th className="text-right px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Precision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journey.bronze.columns.map((c) => (
                          <tr key={c.COLUMN_NAME} className="hover:bg-[var(--bp-surface-inset)] transition-colors" style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                            <td className="px-4 py-2" style={{ color: "var(--bp-ink-muted)" }}>{c.ORDINAL_POSITION}</td>
                            <td className="px-4 py-2" style={{ color: "var(--bp-ink-primary)" }}>{c.COLUMN_NAME}</td>
                            <td className="px-4 py-2" style={{ color: "var(--bp-ink-secondary)" }}>{c.DATA_TYPE}</td>
                            <td className="px-4 py-2 text-center">
                              {c.IS_NULLABLE === "YES" ? (
                                <span style={{ color: "var(--bp-caution)" }}>YES</span>
                              ) : (
                                <span style={{ color: "var(--bp-operational)" }}>NO</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right" style={{ color: "var(--bp-ink-muted)" }}>{c.CHARACTER_MAXIMUM_LENGTH || "\u2014"}</td>
                            <td className="px-4 py-2 text-right" style={{ color: "var(--bp-ink-muted)" }}>
                              {c.NUMERIC_PRECISION ? `${c.NUMERIC_PRECISION}${c.NUMERIC_SCALE ? `,${c.NUMERIC_SCALE}` : ""}` : "\u2014"}
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
                    <table className="w-full text-xs" style={{ fontFamily: "var(--bp-font-mono)" }}>
                      <thead>
                        <tr style={{ backgroundColor: "var(--bp-surface-inset)", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>#</th>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Column</th>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Type</th>
                          <th className="text-center px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Nullable</th>
                          <th className="text-right px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Max Length</th>
                          <th className="text-right px-4 py-2 font-medium" style={{ color: "var(--bp-ink-secondary)" }}>Precision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journey.silver.columns.map((c) => (
                          <tr key={c.COLUMN_NAME} className="hover:bg-[var(--bp-surface-inset)] transition-colors" style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                            <td className="px-4 py-2" style={{ color: "var(--bp-ink-muted)" }}>{c.ORDINAL_POSITION}</td>
                            <td className="px-4 py-2" style={{ color: "var(--bp-ink-primary)" }}>{c.COLUMN_NAME}</td>
                            <td className="px-4 py-2" style={{ color: "var(--bp-ink-secondary)" }}>{c.DATA_TYPE}</td>
                            <td className="px-4 py-2 text-center">
                              {c.IS_NULLABLE === "YES" ? (
                                <span style={{ color: "var(--bp-caution)" }}>YES</span>
                              ) : (
                                <span style={{ color: "var(--bp-operational)" }}>NO</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right" style={{ color: "var(--bp-ink-muted)" }}>{c.CHARACTER_MAXIMUM_LENGTH || "\u2014"}</td>
                            <td className="px-4 py-2 text-right" style={{ color: "var(--bp-ink-muted)" }}>
                              {c.NUMERIC_PRECISION ? `${c.NUMERIC_PRECISION}${c.NUMERIC_SCALE ? `,${c.NUMERIC_SCALE}` : ""}` : "\u2014"}
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
              <div className="rounded-xl p-4 flex items-start gap-3" style={{ border: "1px solid rgba(180,86,36,0.2)", backgroundColor: "var(--bp-copper-light)" }}>
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--bp-copper)" }} />
                <div className="text-sm">
                  <p className="font-medium" style={{ color: "var(--bp-copper)" }}>Landing Zone Only</p>
                  <p className="text-xs mt-1" style={{ color: "var(--bp-ink-secondary)" }}>
                    This entity has been registered but hasn't been processed through the Bronze or Silver pipelines yet.
                    Run the Landing Zone &rarr; Bronze pipeline to see schema and row count details.
                    Column schemas cannot be read from raw {journey.landing.fileType?.toLowerCase() || "parquet"} files in the landing zone &mdash;
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
